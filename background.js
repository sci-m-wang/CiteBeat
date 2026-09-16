// background.js — service worker
// Supports two sources: Google Scholar and Semantic Scholar.
// Tracks per-paper citations and surfaces papers with growth since baseline.

const DEFAULT_SETTINGS = {
  source: 'scholar',          // 'scholar' | 'semanticscholar'
  scholarId: '',              // Google Scholar user id (user must set in options)
  semanticScholarId: '',      // Semantic Scholar author id (user must set in options)
  periodMinutes: 30,
  baselineMode: 'manual',     // 'manual' | 'weekly' | 'monthly' | 'interval'
  baselineIntervalDays: 10,
  // --- Optional homepage/endpoint reporting ---
  endpointEnabled: false,     // master switch; off by default
  endpointMode: 'generic',    // 'generic' (plain POST) | 'github' (Contents API)
  endpointUrl: '',            // generic mode: user-provided absolute http(s) URL
  endpointIntervalDays: 1,    // how often the snapshot is pushed
  endpointAuthType: 'none',   // generic mode: 'none' | 'bearer'
  // GitHub Pages target (github mode). The token lives under its own key.
  githubOwner: '',
  githubRepo: '',
  githubBranch: 'main',
  githubPath: 'data/citations.json',
  githubCommitMessage: 'chore(citebeat): update citation snapshot'
};

const HISTORY_LIMIT = 1000;
const HISTORY_CHANGE_LIMIT = 10;
const STORAGE_SCHEMA_VERSION = 2;
const PAPER_COUNT_DROP_MIN = 20;
const PAPER_COUNT_DROP_RATIO = 0.7;

// --- Endpoint reporting ---
const SNAPSHOT_SCHEMA = 'citation.snapshot';
const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_PAPER_LIMIT = 200;
const SNAPSHOT_TREND_LIMIT = 60;
const ENDPOINT_TIMEOUT_MS = 15000;
const ENDPOINT_MAX_ATTEMPTS = 3;
const ENDPOINT_RETRY_BASE_MS = 1500;
const ENDPOINT_CHECK_ALARM = 'endpointReport';
const ENDPOINT_CHECK_MINUTES = 60;

// --- GitHub Contents API (for GitHub Pages homepages) ---
const GITHUB_API = 'https://api.github.com';
const GITHUB_ORIGIN_PATTERN = 'https://api.github.com/*';
const GITHUB_API_VERSION = '2022-11-28';

// ---------- Storage helpers ----------
async function ensureStorageSchema() {
  const { storageSchemaVersion } = await chrome.storage.local.get('storageSchemaVersion');
  const current = Number(storageSchemaVersion);
  if (!Number.isFinite(current) || current < STORAGE_SCHEMA_VERSION) {
    await chrome.storage.local.set({ storageSchemaVersion: STORAGE_SCHEMA_VERSION });
  }
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function getState() {
  const data = await chrome.storage.local.get([
    'citations',
    'currentPapers',
    'currentPapersKey',
    'baselinePapers',
    'baselineAt',
    'baselineKey',
    'lastUpdatedAt',
    'lastError'
  ]);
  return {
    citations: data.citations || '',
    currentPapers: data.currentPapers || {},
    currentPapersKey: data.currentPapersKey || '',
    baselinePapers: data.baselinePapers || null,
    baselineAt: data.baselineAt || null,
    baselineKey: data.baselineKey || '',
    lastUpdatedAt: data.lastUpdatedAt || null,
    lastError: data.lastError || ''
  };
}

// ---------- Source: Google Scholar ----------
async function fetchScholar(userId) {
  // Total citations from the first page; papers paginated via cstart.
  const firstUrl = `https://scholar.google.com/citations?user=${encodeURIComponent(userId)}&hl=en&cstart=0&pagesize=100`;
  const firstRes = await fetch(firstUrl, { credentials: 'omit' });
  if (!firstRes.ok) throw new Error(`Google Scholar HTTP ${firstRes.status}`);
  const firstHtml = await firstRes.text();

  // The right-hand stats table lists, in order:
  //   Citations(all, since) / h-index(all, since) / i10-index(all, since)
  const stats = parseScholarStats(firstHtml);
  const total = stats.citations == null ? null : String(stats.citations);

  const papers = {};
  parseScholarRows(firstHtml, papers);

  // Paginate remaining pages while a page returns close to a full window.
  // Scholar caps pagesize at 100; loop until a page returns < 100 rows.
  let cstart = 100;
  const hardCap = 2000;
  let lastCount = Object.keys(papers).length;
  while (lastCount >= cstart && cstart < hardCap) {
    const url = `https://scholar.google.com/citations?user=${encodeURIComponent(userId)}&hl=en&cstart=${cstart}&pagesize=100`;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) break;
    const html = await res.text();
    const before = Object.keys(papers).length;
    parseScholarRows(html, papers);
    const after = Object.keys(papers).length;
    if (after === before) break; // no new rows; done
    cstart += 100;
    lastCount = after;
  }

  const fetched = Object.keys(papers).length;
  const summed = sumCitations(papers);
  // Fall back to locally computed indices when the profile markup changes.
  const metrics = {
    hIndex: stats.hIndex != null ? stats.hIndex : computeHIndex(papers),
    i10Index: stats.i10Index != null ? stats.i10Index : computeI10Index(papers),
    hIndexSource: stats.hIndex != null ? 'profile' : 'computed',
    i10IndexSource: stats.i10Index != null ? 'profile' : 'computed'
  };
  console.log('[Scholar] total=%s, sum(papers)=%s, papers fetched=%s, h=%s, i10=%s',
    total, summed, fetched, metrics.hIndex, metrics.i10Index);

  return { total: total ?? String(summed), papers, metrics };
}

function parseScholarStats(html) {
  // Grab the stats table first so unrelated numbers elsewhere on the page
  // cannot shift the cell ordering.
  const table = html.match(/<table[^>]*id="gsc_rsb_st"[^>]*>([\s\S]*?)<\/table>/i);
  const scope = table ? table[1] : html;
  const cells = [];
  const cellRe = /<td[^>]*class="[^"]*gsc_rsb_std[^"]*"[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = cellRe.exec(scope)) !== null) {
    cells.push(parseTotal(stripTags(decodeHtml(m[1])).trim()));
  }
  // Columns are [all, since-YYYY] per row, so all-time values are even indices.
  return {
    citations: cells.length > 0 ? cells[0] : null,
    hIndex: cells.length > 2 ? cells[2] : null,
    i10Index: cells.length > 4 ? cells[4] : null
  };
}

function parseScholarRows(html, papers) {
  const rowRe = /<tr[^>]*class="gsc_a_tr"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const row = m[1];
    // The title <a> carries class="gsc_a_at" and an href to the citation
    // detail page; attribute order on the tag is not guaranteed, so match
    // href and class independently and the <a> as a whole separately.
    const titleAnchor = row.match(/<a\b[^>]*\bclass="gsc_a_at"[^>]*>([\s\S]*?)<\/a>/i);
    const hrefMatch = titleAnchor && titleAnchor[0].match(/\bhref="([^"]+)"/i);
    const citeMatch = row.match(/<a[^>]*class="gsc_a_ac[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleAnchor || !hrefMatch) continue;
    const href = decodeHtml(hrefMatch[1]);
    const title = stripTags(decodeHtml(titleAnchor[1])).trim();
    const citeText = citeMatch ? stripTags(decodeHtml(citeMatch[1])).trim() : '';
    const citations = /^\d+$/.test(citeText) ? parseInt(citeText, 10) : 0;
    const idMatch = href.match(/citation_for_view=([^&]+)/);
    const id = idMatch ? idMatch[1] : href;
    papers[id] = {
      id,
      title,
      citations,
      url: href.startsWith('http') ? href : `https://scholar.google.com${href}`
    };
  }
}

// ---------- Source: Semantic Scholar ----------
async function fetchSemanticScholar(authorId) {
  const base = `https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(authorId)}`;
  // Author metadata for total & expected paperCount
  const authorRes = await fetch(`${base}?fields=citationCount,paperCount,hIndex,name`, { credentials: 'omit' });
  if (!authorRes.ok) throw new Error(`Semantic Scholar author HTTP ${authorRes.status}`);
  const author = await authorRes.json();
  const expectedPaperCount = Number.isFinite(author.paperCount) ? author.paperCount : null;
  const authorCitationCount = Number.isFinite(author.citationCount) ? author.citationCount : null;
  const authorHIndex = Number.isFinite(author.hIndex) ? author.hIndex : null;

  // Papers — paginate until exhausted; follow API's `next` where available.
  const papers = {};
  let offset = 0;
  const limit = 100;
  // Safety cap grows with expected paperCount.
  const hardCap = Math.max(2000, (expectedPaperCount || 0) + 200);
  while (true) {
    const url = `${base}/papers?fields=title,citationCount,externalIds,url&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`Semantic Scholar papers HTTP ${res.status}`);
    const data = await res.json();
    const items = Array.isArray(data.data) ? data.data : [];
    for (const p of items) {
      const id = p.paperId;
      if (!id) continue;
      papers[id] = {
        id,
        title: p.title || '(untitled)',
        citations: Number.isFinite(p.citationCount) ? p.citationCount : 0,
        url: p.url || `https://www.semanticscholar.org/paper/${id}`
      };
    }
    // Prefer API-provided `next`; fall back to short-page detection.
    if (Number.isFinite(data.next)) {
      if (data.next === offset) break; // prevent infinite loop
      offset = data.next;
    } else if (items.length < limit) {
      break;
    } else {
      offset += limit;
    }
    if (offset >= hardCap) break;
  }

  const fetched = Object.keys(papers).length;
  const summed = sumCitations(papers);
  // Prefer the larger of the two signals; S2 author.citationCount often lags or
  // under-counts vs the author page which sums the paper list.
  const totalNum = Math.max(authorCitationCount || 0, summed);
  const total = String(totalNum);

  console.log('[S2] author.citationCount=%s, sum(papers.citationCount)=%s, chosen=%s, papers fetched=%s / expected=%s',
    authorCitationCount, summed, total, fetched, expectedPaperCount);
  if (expectedPaperCount != null && fetched < expectedPaperCount) {
    console.warn('[S2] fetched fewer papers than paperCount; total may undercount.');
  }

  // S2 exposes hIndex directly but has no i10-index field, so derive it.
  const metrics = {
    hIndex: authorHIndex != null ? authorHIndex : computeHIndex(papers),
    i10Index: computeI10Index(papers),
    hIndexSource: authorHIndex != null ? 'api' : 'computed',
    i10IndexSource: 'computed'
  };

  return { total, papers, metrics };
}

// ---------- Utilities ----------
function stripTags(s) { return String(s).replace(/<[^>]*>/g, ''); }
function decodeHtml(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
function sumCitations(papers) {
  return Object.values(papers).reduce((acc, p) => acc + (p.citations || 0), 0);
}
function parseTotal(text) {
  const n = parseInt(String(text || '').replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
function getActiveAuthorId(settings) {
  return settings.source === 'semanticscholar' ? settings.semanticScholarId : settings.scholarId;
}
function getProfileUrl(settings) {
  const id = getActiveAuthorId(settings);
  if (!id) return '';
  return settings.source === 'semanticscholar'
    ? `https://www.semanticscholar.org/author/${encodeURIComponent(id)}`
    : `https://scholar.google.com/citations?user=${encodeURIComponent(id)}`;
}
function computeHIndex(papers) {
  const counts = Object.values(papers || {})
    .map(p => p.citations || 0)
    .sort((a, b) => b - a);
  let h = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] >= i + 1) h = i + 1;
    else break;
  }
  return h;
}
function computeI10Index(papers) {
  return Object.values(papers || {}).filter(p => (p.citations || 0) >= 10).length;
}
function getTrackingKey(settings) {
  return `${settings.source}:${getActiveAuthorId(settings) || ''}`;
}
function normTitle(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '').slice(0, 80);
}
function buildTitleIndex(papers) {
  const idx = {};
  for (const id of Object.keys(papers || {})) {
    const key = normTitle(papers[id].title);
    if (key) idx[key] = papers[id];
  }
  return idx;
}
function summarizePaper(paper, delta, kind) {
  const summary = {
    id: paper.id,
    title: paper.title,
    delta,
    citations: paper.citations || 0,
    url: paper.url
  };
  if (kind) summary.kind = kind;
  return summary;
}
function computePaperChanges(current, previous) {
  if (!previous || Object.keys(previous).length === 0) return null;

  const positive = [];
  const negative = [];
  const previousByTitle = buildTitleIndex(previous);
  const matchedPreviousIds = new Set();

  for (const id of Object.keys(current || {})) {
    const cur = current[id];
    let prev = previous[id];
    if (prev) {
      matchedPreviousIds.add(id);
    } else {
      prev = previousByTitle[normTitle(cur.title)];
      if (prev) matchedPreviousIds.add(prev.id);
    }

    const previousCitations = prev ? (prev.citations || 0) : 0;
    const delta = (cur.citations || 0) - previousCitations;
    if (delta > 0) {
      positive.push(summarizePaper(cur, delta));
    } else if (delta < 0) {
      negative.push(summarizePaper(cur, delta, 'dropped'));
    }
  }

  for (const id of Object.keys(previous || {})) {
    if (!matchedPreviousIds.has(id)) {
      const prev = previous[id];
      negative.push(summarizePaper({ ...prev, citations: 0 }, -(prev.citations || 0), 'removed'));
    }
  }

  positive.sort((a, b) => b.delta - a.delta);
  negative.sort((a, b) => a.delta - b.delta);

  const positiveCount = positive.length;
  const negativeCount = negative.length;
  if (positiveCount === 0 && negativeCount === 0) {
    return {
      positiveTop: [],
      negativeTop: [],
      positiveCount,
      negativeCount,
      netPaperDelta: 0
    };
  }

  const netPaperDelta = positive.reduce((acc, p) => acc + p.delta, 0)
    + negative.reduce((acc, p) => acc + p.delta, 0);
  return {
    positiveTop: positive.slice(0, HISTORY_CHANGE_LIMIT),
    negativeTop: negative.slice(0, HISTORY_CHANGE_LIMIT),
    positiveCount,
    negativeCount,
    netPaperDelta
  };
}
function isPaperListSuspicious(previousPapers, previousKey, trackingKey, paperCount) {
  if (previousKey !== trackingKey) return false;
  const previousCount = Object.keys(previousPapers || {}).length;
  if (previousCount < PAPER_COUNT_DROP_MIN || paperCount === 0) return false;
  return paperCount < previousCount * PAPER_COUNT_DROP_RATIO;
}
function trimBadge(text) {
  // Chrome badge supports ~4 chars; use k suffix for large numbers
  const n = parseInt(String(text).replace(/,/g, ''), 10);
  if (Number.isFinite(n)) {
    if (n >= 100000) return Math.round(n / 1000) + 'k';
    if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }
  return String(text).slice(0, 4);
}

function startOfLocalWeek(ts) {
  const d = new Date(ts);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start.getTime();
}

function startOfLocalMonth(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function getAutomaticBaselineReason(settings, baselineAt, now) {
  if (!baselineAt) return '';
  if (settings.baselineMode === 'weekly') {
    return startOfLocalWeek(now) > startOfLocalWeek(baselineAt) ? 'weekly' : '';
  }
  if (settings.baselineMode === 'monthly') {
    return startOfLocalMonth(now) > startOfLocalMonth(baselineAt) ? 'monthly' : '';
  }
  if (settings.baselineMode === 'interval') {
    const days = Math.max(1, Number(settings.baselineIntervalDays) || 10);
    return now - Number(baselineAt) >= days * 24 * 60 * 60 * 1000 ? 'interval' : '';
  }
  return '';
}

function maybeAppendHistory(history, entry) {
  const items = Array.isArray(history) ? history : [];
  if (entry.total == null || !entry.trackingKey) return { items, changed: false };

  const last = items[items.length - 1];
  const previousForKey = [...items].reverse().find(item => item.trackingKey === entry.trackingKey);
  const hasPaperChanges = !!entry.changesSincePrevious
    && (entry.changesSincePrevious.positiveCount > 0 || entry.changesSincePrevious.negativeCount > 0);
  const shouldAppend = !last
    || last.trackingKey !== entry.trackingKey
    || !previousForKey
    || previousForKey.total !== entry.total
    || hasPaperChanges;

  if (!shouldAppend) return { items, changed: false };
  const previousTotal = previousForKey && Number.isFinite(previousForKey.total)
    ? previousForKey.total
    : null;
  const nextEntry = {
    ...entry,
    deltaFromPrevious: previousTotal == null ? null : entry.total - previousTotal
  };
  return { items: [...items, nextEntry].slice(-HISTORY_LIMIT), changed: true };
}

// ---------- Core update ----------
async function updateCitations() {
  await ensureStorageSchema();
  const settings = await getSettings();
  const trackingKey = getTrackingKey(settings);
  try {
    let result;
    if (settings.source === 'semanticscholar') {
      if (!settings.semanticScholarId) throw new Error('未设置 Semantic Scholar 作者 ID，请在扩展选项页填写');
      result = await fetchSemanticScholar(settings.semanticScholarId);
    } else {
      if (!settings.scholarId) throw new Error('未设置 Google Scholar user id，请在扩展选项页填写');
      result = await fetchScholar(settings.scholarId);
    }

    const total = result.total || String(sumCitations(result.papers));
    const now = Date.now();
    const paperCount = Object.keys(result.papers).length;
    const totalNum = parseTotal(total);

    // Don't poison the baseline with an empty paper map. If the fetch
    // somehow returned 0 parsed papers (Scholar markup change, partial
    // response, transient block), keep whatever we already have.
    const prev = await chrome.storage.local.get([
      'baselinePapers',
      'baselineAt',
      'baselineKey',
      'currentPapers',
      'currentPapersKey',
      'citationHistory'
    ]);
    const patch = {
      citations: total,
      metrics: {
        citations: totalNum,
        hIndex: result.metrics ? result.metrics.hIndex : null,
        i10Index: result.metrics ? result.metrics.i10Index : null,
        hIndexSource: result.metrics ? result.metrics.hIndexSource : null,
        i10IndexSource: result.metrics ? result.metrics.i10IndexSource : null,
        paperCount,
        trackingKey,
        updatedAt: now
      },
      lastUpdatedAt: now,
      lastError: ''
    };
    const previousKey = typeof prev.baselineKey === 'string' && prev.baselineKey.length > 0
      ? prev.baselineKey
      : '';
    const previousCurrentKey = typeof prev.currentPapersKey === 'string' && prev.currentPapersKey.length > 0
      ? prev.currentPapersKey
      : previousKey;
    const suspiciousPaperList = isPaperListSuspicious(
      prev.currentPapers,
      previousCurrentKey,
      trackingKey,
      paperCount
    );
    const canComparePapers = paperCount > 0
      && !suspiciousPaperList
      && previousCurrentKey === trackingKey
      && prev.currentPapers
      && Object.keys(prev.currentPapers).length > 0;
    const changesSincePrevious = canComparePapers
      ? computePaperChanges(result.papers, prev.currentPapers)
      : null;
    const nextHistory = maybeAppendHistory(prev.citationHistory, {
      ts: now,
      total: totalNum,
      source: settings.source,
      authorId: getActiveAuthorId(settings),
      trackingKey,
      paperCount,
      changesSincePrevious
    });
    if (nextHistory.changed) {
      patch.citationHistory = nextHistory.items;
    }

    if (suspiciousPaperList) {
      const previousCount = Object.keys(prev.currentPapers || {}).length;
      patch.lastError = `本次只抓到 ${paperCount}/${previousCount} 篇论文，可能是数据源临时返回不完整；已保留上一份论文明细`;
      console.warn('[citations] suspicious paper list: fetched %s / previous %s; keeping previous currentPapers/baseline',
        paperCount, previousCount);
    } else if (paperCount > 0) {
      patch.currentPapers = result.papers;
      patch.currentPapersKey = trackingKey;
      // Seed the current statistics period only when we have real paper data
      // AND no previous period yet (or the existing one is empty).
      const baselineEmpty = !prev.baselinePapers
        || Object.keys(prev.baselinePapers).length === 0
        || !prev.baselineAt;
      const hasBaselineKey = previousKey.length > 0;
      const trackingChanged = hasBaselineKey && prev.baselineKey !== trackingKey;
      const automaticReason = !baselineEmpty && !trackingChanged
        ? getAutomaticBaselineReason(settings, prev.baselineAt, now)
        : '';

      if (baselineEmpty) {
        patch.baselinePapers = result.papers;
        patch.baselineAt = now;
        patch.baselineKey = trackingKey;
      } else if (!hasBaselineKey) {
        // Legacy v0.1.x users have a valid baseline but no key yet. Attach
        // the current key without losing their active comparison period.
        patch.baselineKey = trackingKey;
      } else if (trackingChanged) {
        patch.baselinePapers = result.papers;
        patch.baselineAt = now;
        patch.baselineKey = trackingKey;
      } else if (automaticReason) {
        patch.baselinePapers = result.papers;
        patch.baselineAt = now;
        patch.baselineKey = trackingKey;
        patch.lastBaselineReset = { ts: now, reason: automaticReason };
      }
    } else {
      console.warn('[citations] fetch returned 0 papers; keeping previous currentPapers/baseline');
    }
    await chrome.storage.local.set(patch);

    chrome.action.setBadgeBackgroundColor({ color: '#1e4fc2' });
    chrome.action.setBadgeText({ text: trimBadge(total) });
    console.log('[citations] updated:', total, 'papers:', Object.keys(result.papers).length);
    // Reporting is opt-in and must never break a successful refresh.
    maybeReportSnapshot({ reason: 'scheduled' }).catch(err => {
      console.warn('[endpoint] scheduled report failed:', err);
    });
    return true;
  } catch (err) {
    console.error('[citations] failed:', err);
    await chrome.storage.local.set({ lastError: String(err && err.message || err) });
    chrome.action.setBadgeBackgroundColor({ color: '#b00020' });
    chrome.action.setBadgeText({ text: 'ERR' });
    return false;
  }
}

// ---------- Endpoint reporting (opt-in) ----------
// Everything below only runs when the user has explicitly enabled reporting
// and granted host permission for their own endpoint origin.

function normalizeEndpointUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) throw new Error('未填写节点地址');
  let url;
  try {
    url = new URL(value);
  } catch (_) {
    throw new Error('节点地址不是合法 URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('节点地址必须以 http:// 或 https:// 开头');
  }
  return url;
}

function originPatternFromUrl(url) {
  return `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}/*`;
}

async function getEndpointSecret() {
  const { endpointSecret } = await chrome.storage.local.get('endpointSecret');
  return typeof endpointSecret === 'string' ? endpointSecret : '';
}

function toIso(ts) {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
}

// Build the standard `citation.snapshot` payload from local state only.
async function buildSnapshot() {
  const settings = await getSettings();
  const stored = await chrome.storage.local.get([
    'citations',
    'metrics',
    'currentPapers',
    'currentPapersKey',
    'baselinePapers',
    'baselineAt',
    'citationHistory',
    'lastUpdatedAt'
  ]);

  const trackingKey = getTrackingKey(settings);
  const authorId = getActiveAuthorId(settings);
  if (!authorId) throw new Error('尚未配置作者 ID');

  const currentPapers = stored.currentPapers && stored.currentPapersKey === trackingKey
    ? stored.currentPapers
    : {};
  const totalNum = parseTotal(stored.citations);
  if (totalNum == null) throw new Error('尚无可上报的引用数据，请先成功刷新一次');

  const baselinePapers = stored.baselinePapers || null;
  const baselineSum = baselinePapers ? sumCitations(baselinePapers) : null;
  const baseByTitle = baselinePapers ? buildTitleIndex(baselinePapers) : null;

  const papers = Object.values(currentPapers)
    .map(p => {
      let base = baselinePapers ? baselinePapers[p.id] : null;
      if (!base && baseByTitle) base = baseByTitle[normTitle(p.title)];
      const delta = base ? (p.citations || 0) - (base.citations || 0) : null;
      return {
        id: p.id,
        title: p.title,
        citations: p.citations || 0,
        delta,
        url: p.url
      };
    })
    .sort((a, b) => b.citations - a.citations)
    .slice(0, SNAPSHOT_PAPER_LIMIT);

  const trend = (Array.isArray(stored.citationHistory) ? stored.citationHistory : [])
    .filter(item => item && item.trackingKey === trackingKey && Number.isFinite(item.total))
    .slice(-SNAPSHOT_TREND_LIMIT)
    .map(item => ({ at: toIso(item.ts), citations: item.total }));

  const metrics = stored.metrics && stored.metrics.trackingKey === trackingKey
    ? stored.metrics
    : null;

  return {
    schema: SNAPSHOT_SCHEMA,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    generator: {
      name: 'CiteBeat',
      version: chrome.runtime.getManifest().version
    },
    source: {
      provider: settings.source === 'semanticscholar' ? 'semanticscholar' : 'scholar',
      authorId,
      profileUrl: getProfileUrl(settings),
      fetchedAt: toIso(stored.lastUpdatedAt)
    },
    metrics: {
      citations: totalNum,
      hIndex: metrics ? metrics.hIndex : null,
      i10Index: metrics ? metrics.i10Index : null,
      paperCount: Object.keys(currentPapers).length
    },
    period: {
      mode: settings.baselineMode,
      startedAt: toIso(stored.baselineAt),
      citationDelta: baselineSum == null ? null : totalNum - baselineSum
    },
    papers,
    trend
  };
}

function shouldRetryStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

// Single HTTP attempt with a hard timeout. Returns the full body so callers
// can parse it; error messages slice it down before display.
async function requestOnce(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(String(url), {
      credentials: 'omit',
      ...init,
      signal: controller.signal
    });
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch (_) { /* body is optional */ }
    return { status: res.status, ok: res.ok, body: bodyText };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    throw new Error(`网络请求失败：${String(err && err.message || err)}`);
  } finally {
    clearTimeout(timer);
  }
}

// Bounded retry wrapper. `describeError` turns a non-ok response into an Error.
async function requestWithRetry(url, init, describeError) {
  let lastError = null;
  for (let attempt = 1; attempt <= ENDPOINT_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await requestOnce(url, init, ENDPOINT_TIMEOUT_MS);
      if (res.ok) return { ...res, attempts: attempt };
      // Let the caller inspect non-retryable statuses (e.g. 404/409) itself.
      if (!shouldRetryStatus(res.status)) return { ...res, attempts: attempt };
      lastError = describeError(res);
    } catch (err) {
      lastError = err;
    }
    if (attempt < ENDPOINT_MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, ENDPOINT_RETRY_BASE_MS * attempt));
    }
  }
  throw lastError || new Error('请求失败');
}

// ---- Generic mode: plain JSON POST ----
async function deliverGeneric(payload, settings, secret) {
  const url = normalizeEndpointUrl(settings.endpointUrl);
  const headers = {
    'Content-Type': 'application/json',
    'X-CiteBeat-Schema': `${SNAPSHOT_SCHEMA}/${SNAPSHOT_SCHEMA_VERSION}`
  };
  if (settings.endpointAuthType === 'bearer' && secret) {
    headers.Authorization = `Bearer ${secret}`;
  }
  const describe = (res) => new Error(
    `节点返回 HTTP ${res.status}${res.body ? '：' + res.body.slice(0, 300) : ''}`
  );
  const res = await requestWithRetry(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  }, describe);
  if (!res.ok) throw describe(res);
  return { status: res.status, attempts: res.attempts, detail: `HTTP ${res.status}` };
}

// ---- GitHub mode: commit a JSON file via the Contents API ----

// btoa() only handles latin1; paper titles are frequently non-ASCII, so encode
// to UTF-8 bytes first and feed btoa a binary string.
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Each path segment must be encoded separately so "/" stays a separator.
function encodeContentPath(path) {
  return String(path)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

function normalizeGitHubTarget(settings) {
  const owner = String(settings.githubOwner || '').trim();
  const repo = String(settings.githubRepo || '').trim();
  const branch = String(settings.githubBranch || '').trim() || 'main';
  const path = String(settings.githubPath || '').trim().replace(/^\/+/, '');
  if (!owner) throw new Error('未填写 GitHub 用户名/组织');
  if (!repo) throw new Error('未填写 GitHub 仓库名');
  if (!path) throw new Error('未填写目标文件路径');
  if (path.endsWith('/')) throw new Error('目标路径必须是文件，不能以 / 结尾');
  if (!/^[\w.-]+$/.test(owner)) throw new Error('GitHub 用户名/组织含非法字符');
  if (!/^[\w.-]+$/.test(repo)) throw new Error('GitHub 仓库名含非法字符');
  return { owner, repo, branch, path };
}

function githubHeaders(token) {
  return {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'Authorization': `Bearer ${token}`
  };
}

function describeGitHubError(res) {
  let message = '';
  try {
    const parsed = JSON.parse(res.body);
    message = parsed && parsed.message ? parsed.message : '';
  } catch (_) { /* non-JSON error body */ }
  if (res.status === 401) return new Error('GitHub 拒绝了 Token（401），请检查是否过期或填错');
  if (res.status === 403) {
    return new Error(`GitHub 拒绝访问（403）${message ? '：' + message : '，可能是 Token 缺少 Contents 写权限或触发限流'}`);
  }
  if (res.status === 404) {
    return new Error('仓库或分支不存在（404），也可能是 Token 没有该私有仓库的权限');
  }
  if (res.status === 422) {
    return new Error(`GitHub 拒绝了提交（422）${message ? '：' + message : '，通常是文件 sha 不匹配'}`);
  }
  return new Error(`GitHub 返回 HTTP ${res.status}${message ? '：' + message : ''}`);
}

// Returns the blob sha of the existing file, or null when it does not exist yet.
async function getGitHubFileSha(target, token) {
  const url = `${GITHUB_API}/repos/${target.owner}/${target.repo}/contents/${encodeContentPath(target.path)}`
    + `?ref=${encodeURIComponent(target.branch)}`;
  const res = await requestWithRetry(url, {
    method: 'GET',
    headers: githubHeaders(token)
  }, describeGitHubError);

  if (res.status === 404) return null; // first commit of this file
  if (!res.ok) throw describeGitHubError(res);

  let data;
  try {
    data = JSON.parse(res.body);
  } catch (_) {
    throw new Error('无法解析 GitHub 返回的文件信息');
  }
  if (Array.isArray(data)) {
    throw new Error('目标路径是一个目录，请指定到具体文件，例如 data/citations.json');
  }
  return data && data.sha ? data.sha : null;
}

async function putGitHubFile(target, token, payload, sha, message) {
  const url = `${GITHUB_API}/repos/${target.owner}/${target.repo}/contents/${encodeContentPath(target.path)}`;
  const body = {
    message,
    content: utf8ToBase64(JSON.stringify(payload, null, 2) + '\n'),
    branch: target.branch
  };
  if (sha) body.sha = sha;
  return requestWithRetry(url, {
    method: 'PUT',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, describeGitHubError);
}

async function deliverGitHub(payload, settings, token) {
  if (!token) throw new Error('未填写 GitHub Token');
  const target = normalizeGitHubTarget(settings);
  const message = String(settings.githubCommitMessage || '').trim()
    || DEFAULT_SETTINGS.githubCommitMessage;

  let sha = await getGitHubFileSha(target, token);
  let res = await putGitHubFile(target, token, payload, sha, message);

  // 409 means someone else committed between our GET and PUT; refresh and retry once.
  if (res.status === 409) {
    sha = await getGitHubFileSha(target, token);
    res = await putGitHubFile(target, token, payload, sha, message);
  }
  if (!res.ok) throw describeGitHubError(res);

  let commitSha = '';
  try {
    const parsed = JSON.parse(res.body);
    commitSha = parsed && parsed.commit && parsed.commit.sha ? parsed.commit.sha.slice(0, 7) : '';
  } catch (_) { /* commit info is optional */ }

  const action = sha ? '更新' : '创建';
  return {
    status: res.status,
    attempts: res.attempts,
    detail: `已${action} ${target.owner}/${target.repo}@${target.branch}:${target.path}${commitSha ? ` (${commitSha})` : ''}`
  };
}

function isReportDue(settings, lastSentAt, now) {
  if (!lastSentAt) return true;
  const days = Math.max(1, Number(settings.endpointIntervalDays) || 1);
  return now - Number(lastSentAt) >= days * 24 * 60 * 60 * 1000;
}

function getEndpointMode(settings) {
  return settings.endpointMode === 'github' ? 'github' : 'generic';
}

// Resolve which origin we need permission for, and fail early on bad config.
function resolveEndpointTarget(settings) {
  if (getEndpointMode(settings) === 'github') {
    normalizeGitHubTarget(settings);
    return { mode: 'github', originPattern: GITHUB_ORIGIN_PATTERN };
  }
  const url = normalizeEndpointUrl(settings.endpointUrl);
  return { mode: 'generic', originPattern: originPatternFromUrl(url) };
}

async function hasOriginPermission(originPattern) {
  try {
    return await chrome.permissions.contains({ origins: [originPattern] });
  } catch (_) {
    return false;
  }
}

// Core entry point. `force` bypasses the interval check (manual send / test).
async function maybeReportSnapshot({ reason = 'scheduled', force = false } = {}) {
  const settings = await getSettings();
  if (!settings.endpointEnabled && !force) return { ok: false, skipped: 'disabled' };

  let target;
  try {
    target = resolveEndpointTarget(settings);
  } catch (err) {
    if (force) throw err;
    return { ok: false, skipped: 'no-target' };
  }

  const now = Date.now();
  const { endpointLastSentAt } = await chrome.storage.local.get('endpointLastSentAt');
  if (!force && !isReportDue(settings, endpointLastSentAt, now)) {
    return { ok: false, skipped: 'not-due' };
  }

  if (!(await hasOriginPermission(target.originPattern))) {
    const message = '尚未授权访问目标域名，请在设置页点击“测试”或“立即发送”完成授权';
    await chrome.storage.local.set({
      endpointLastStatus: 'error',
      endpointLastError: message,
      endpointLastAttemptAt: now
    });
    if (force) throw new Error(message);
    return { ok: false, skipped: 'no-permission' };
  }

  const payload = await buildSnapshot();
  try {
    let res;
    if (target.mode === 'github') {
      const { githubToken } = await chrome.storage.local.get('githubToken');
      res = await deliverGitHub(payload, settings, typeof githubToken === 'string' ? githubToken : '');
    } else {
      res = await deliverGeneric(payload, settings, await getEndpointSecret());
    }
    await chrome.storage.local.set({
      endpointLastSentAt: now,
      endpointLastAttemptAt: now,
      endpointLastStatus: 'ok',
      endpointLastError: '',
      endpointLastHttpStatus: res.status,
      endpointLastDetail: res.detail || ''
    });
    console.log('[endpoint] reported (%s/%s) %s', reason, target.mode, res.detail || res.status);
    return { ok: true, status: res.status, attempts: res.attempts, detail: res.detail || '' };
  } catch (err) {
    const message = String(err && err.message || err);
    await chrome.storage.local.set({
      endpointLastAttemptAt: now,
      endpointLastStatus: 'error',
      endpointLastError: message
    });
    console.warn('[endpoint] report failed:', message);
    if (force) throw err;
    return { ok: false, error: message };
  }
}

async function ensureEndpointAlarm() {
  const settings = await getSettings();
  await chrome.alarms.clear(ENDPOINT_CHECK_ALARM);
  if (!settings.endpointEnabled) return;
  chrome.alarms.create(ENDPOINT_CHECK_ALARM, { periodInMinutes: ENDPOINT_CHECK_MINUTES });
}

// ---------- Delayed first run ----------
async function delayedUpdateWithRetry() {
  await new Promise(r => setTimeout(r, 5000));
  const ok = await updateCitations();
  if (!ok) {
    await new Promise(r => setTimeout(r, 15000));
    await updateCitations();
  }
}

async function ensureAlarm() {
  const settings = await getSettings();
  const period = Math.max(1, Number(settings.periodMinutes) || 30);
  await chrome.alarms.clear('periodicUpdate');
  chrome.alarms.create('periodicUpdate', { periodInMinutes: period });
}

// ---------- Event listeners ----------
chrome.runtime.onInstalled.addListener(async (details) => {
  await ensureStorageSchema();
  await ensureAlarm();
  await ensureEndpointAlarm();
  // First-time install with no ID: open options page so user can configure.
  if (details && details.reason === 'install') {
    const s = await getSettings();
    if (!s.scholarId && !s.semanticScholarId) {
      chrome.action.setBadgeBackgroundColor({ color: '#b00020' });
      chrome.action.setBadgeText({ text: 'SET' });
      try { chrome.runtime.openOptionsPage(); } catch (_) {}
      return;
    }
  }
  delayedUpdateWithRetry();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureStorageSchema();
  await ensureAlarm();
  await ensureEndpointAlarm();
  delayedUpdateWithRetry();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'periodicUpdate') updateCitations();
  if (alarm.name === ENDPOINT_CHECK_ALARM) {
    maybeReportSnapshot({ reason: 'alarm' }).catch(err => {
      console.warn('[endpoint] alarm report failed:', err);
    });
  }
});

// React to settings changes: if period / source / id changed, re-sync.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) {
    await ensureAlarm();
    await ensureEndpointAlarm();
    if (changes.restoreInProgress) return;
    updateCitations();
  }
});

// Messages from popup / options.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'refresh') {
        const ok = await updateCitations();
        sendResponse({ ok });
      } else if (msg?.type === 'resetBaseline') {
        await ensureStorageSchema();
        const settings = await getSettings();
        const { currentPapers, currentPapersKey } = await getState();
        const trackingKey = getTrackingKey(settings);
        if (currentPapersKey !== trackingKey) {
          sendResponse({ ok: false, error: '请先成功刷新当前作者数据后再开始新周期' });
          return;
        }
        if (!currentPapers || Object.keys(currentPapers).length === 0) {
          sendResponse({ ok: false, error: '当前没有可用的论文明细，请先刷新成功后再开始新周期' });
          return;
        }
        const now = Date.now();
        await chrome.storage.local.set({
          baselinePapers: currentPapers,
          baselineAt: now,
          baselineKey: trackingKey,
          lastBaselineReset: { ts: now, reason: 'manual' }
        });
        sendResponse({ ok: true });
      } else if (msg?.type === 'previewSnapshot') {
        const snapshot = await buildSnapshot();
        sendResponse({ ok: true, snapshot });
      } else if (msg?.type === 'sendSnapshot') {
        const res = await maybeReportSnapshot({ reason: msg.reason || 'manual', force: true });
        sendResponse({ ok: true, ...res });
      } else {
        sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true; // keep channel open for async sendResponse
});
