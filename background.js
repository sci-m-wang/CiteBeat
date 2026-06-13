// background.js — service worker
// Supports two sources: Google Scholar and Semantic Scholar.
// Tracks per-paper citations and surfaces papers with growth since baseline.

const DEFAULT_SETTINGS = {
  source: 'scholar',          // 'scholar' | 'semanticscholar'
  scholarId: '',              // Google Scholar user id (user must set in options)
  semanticScholarId: '',      // Semantic Scholar author id (user must set in options)
  periodMinutes: 30,
  baselineMode: 'manual',     // 'manual' | 'weekly' | 'monthly' | 'interval'
  baselineIntervalDays: 10
};

const HISTORY_LIMIT = 1000;
const HISTORY_CHANGE_LIMIT = 10;
const STORAGE_SCHEMA_VERSION = 1;
const PAPER_COUNT_DROP_MIN = 20;
const PAPER_COUNT_DROP_RATIO = 0.7;

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

  // Total citations (first gsc_rsb_std cell = all-time total)
  const totalMatch = firstHtml.match(/<td[^>]*class="gsc_rsb_std"[^>]*>([\d,]+)<\/td>/i);
  const total = totalMatch ? totalMatch[1].replace(/,/g, '') : null;

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
  console.log('[Scholar] total=%s, sum(papers)=%s, papers fetched=%s', total, summed, fetched);

  return { total: total ?? String(summed), papers };
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
  const authorRes = await fetch(`${base}?fields=citationCount,paperCount,name`, { credentials: 'omit' });
  if (!authorRes.ok) throw new Error(`Semantic Scholar author HTTP ${authorRes.status}`);
  const author = await authorRes.json();
  const expectedPaperCount = Number.isFinite(author.paperCount) ? author.paperCount : null;
  const authorCitationCount = Number.isFinite(author.citationCount) ? author.citationCount : null;

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

  return { total, papers };
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
    return true;
  } catch (err) {
    console.error('[citations] failed:', err);
    await chrome.storage.local.set({ lastError: String(err && err.message || err) });
    chrome.action.setBadgeBackgroundColor({ color: '#b00020' });
    chrome.action.setBadgeText({ text: 'ERR' });
    return false;
  }
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
  delayedUpdateWithRetry();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'periodicUpdate') updateCitations();
});

// React to settings changes: if period / source / id changed, re-sync.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) {
    await ensureAlarm();
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
      } else {
        sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true; // keep channel open for async sendResponse
});
