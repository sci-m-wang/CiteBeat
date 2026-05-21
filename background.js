// background.js — service worker
// Supports two sources: Google Scholar and Semantic Scholar.
// Tracks per-paper citations and surfaces papers with growth since baseline.

const DEFAULT_SETTINGS = {
  source: 'scholar',          // 'scholar' | 'semanticscholar'
  scholarId: '',              // Google Scholar user id (user must set in options)
  semanticScholarId: '',      // Semantic Scholar author id (user must set in options)
  periodMinutes: 30
};

// ---------- Storage helpers ----------
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function getState() {
  const data = await chrome.storage.local.get(['citations', 'currentPapers', 'baselinePapers', 'baselineAt', 'lastUpdatedAt', 'lastError']);
  return {
    citations: data.citations || '',
    currentPapers: data.currentPapers || {},
    baselinePapers: data.baselinePapers || null,
    baselineAt: data.baselineAt || null,
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
    const titleMatch = row.match(/<a[^>]*class="gsc_a_at"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const citeMatch = row.match(/<a[^>]*class="gsc_a_ac[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    const href = decodeHtml(titleMatch[1]);
    const title = stripTags(decodeHtml(titleMatch[2])).trim();
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

// ---------- Core update ----------
async function updateCitations() {
  const settings = await getSettings();
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

    // First time: seed baseline
    const prev = await chrome.storage.local.get(['baselinePapers', 'baselineAt']);
    const patch = {
      citations: total,
      currentPapers: result.papers,
      lastUpdatedAt: now,
      lastError: ''
    };
    if (!prev.baselinePapers || !prev.baselineAt) {
      patch.baselinePapers = result.papers;
      patch.baselineAt = now;
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
        const { currentPapers } = await getState();
        await chrome.storage.local.set({ baselinePapers: currentPapers, baselineAt: Date.now() });
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
