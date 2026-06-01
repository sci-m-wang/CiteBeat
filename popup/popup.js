// popup.js
const $ = (id) => document.getElementById(id);

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

function baselineModeLabel(settings) {
  const mode = settings?.baselineMode || 'manual';
  if (mode === 'weekly') return '每周一';
  if (mode === 'monthly') return '每月 1 号';
  if (mode === 'interval') {
    const days = Math.max(1, parseInt(settings?.baselineIntervalDays, 10) || 10);
    return `每 ${days} 天`;
  }
  return '手动';
}

function computeGrowth(current, baseline) {
  const positive = [];   // papers with delta > 0 — shown in the growth list
  const negative = [];   // papers with delta < 0 OR removed from current
  if (!baseline) return { positive, negative };
  const baseByTitle = buildTitleIndex(baseline);
  const matchedBaseIds = new Set();

  for (const id of Object.keys(current)) {
    const cur = current[id];
    // Match by id first, fall back to normalized title (Scholar sometimes
    // rotates citation_for_view ids or merges/splits paper entries).
    let base = baseline[id];
    if (base) {
      matchedBaseIds.add(id);
    } else {
      base = baseByTitle[normTitle(cur.title)];
      if (base) matchedBaseIds.add(base.id);
    }
    const baseC = base ? (base.citations || 0) : 0;
    const delta = (cur.citations || 0) - baseC;
    if (delta > 0) {
      positive.push({
        id,
        title: cur.title,
        url: cur.url,
        citations: cur.citations,
        delta,
        isNew: !base
      });
    } else if (delta < 0) {
      // Citation count dropped on a still-present paper (Scholar
      // reclassified self-citations or absorbed a duplicate into another entry).
      negative.push({
        id,
        title: cur.title,
        url: cur.url,
        citations: cur.citations,
        delta,
        kind: 'dropped'
      });
    }
  }

  // Papers that existed in baseline but no longer in current — typically
  // because Scholar merged two entries together and one of them disappeared.
  for (const id of Object.keys(baseline)) {
    if (!matchedBaseIds.has(id)) {
      const b = baseline[id];
      negative.push({
        id,
        title: b.title,
        url: b.url,
        citations: 0,
        delta: -(b.citations || 0),
        kind: 'removed'
      });
    }
  }

  positive.sort((a, b) => b.delta - a.delta);
  negative.sort((a, b) => a.delta - b.delta); // most negative first
  return { positive, negative };
}

async function render() {
  const { settings } = await chrome.storage.local.get('settings');
  const state = await chrome.storage.local.get([
    'citations', 'currentPapers', 'baselinePapers', 'baselineAt', 'lastUpdatedAt', 'lastError'
  ]);

  const configured = settings && (
    (settings.source === 'semanticscholar' && settings.semanticScholarId) ||
    (settings.source !== 'semanticscholar' && settings.scholarId)
  );

  const src = (settings && settings.source) === 'semanticscholar' ? 'Semantic Scholar' : 'Google Scholar';
  $('sourceTag').textContent = src;
  $('total').textContent = state.citations || '—';
  $('updatedAt').textContent = state.lastUpdatedAt ? `更新: ${fmtTime(state.lastUpdatedAt)}` : '尚未更新';
  $('baselineAt').textContent = state.baselineAt
    ? `本周期从 ${fmtTime(state.baselineAt)} 开始 · ${baselineModeLabel(settings)}`
    : '';

  if (!configured) {
    $('err').innerHTML = '还未配置作者 ID。<a href="#" id="goOpt">点此前往设置</a>';
    $('err').classList.remove('hidden');
    const link = document.getElementById('goOpt');
    if (link) link.addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
  } else if (state.lastError) {
    const isWarning = state.lastError.startsWith('本次只抓到');
    $('err').textContent = (isWarning ? '提示: ' : '错误: ') + state.lastError;
    $('err').classList.remove('hidden');
  } else {
    $('err').classList.add('hidden');
  }

  const { positive: rows, negative: drops } = computeGrowth(state.currentPapers || {}, state.baselinePapers);
  const list = $('growthList');
  const dropList = $('dropList');
  const dropHdr = $('dropHdr');
  list.innerHTML = '';
  if (dropList) dropList.innerHTML = '';
  if (dropHdr) dropHdr.classList.add('hidden');
  if (dropList) dropList.classList.add('hidden');
  const positiveSum = rows.reduce((a, r) => a + r.delta, 0);
  const negativeSum = drops.reduce((a, r) => a + r.delta, 0); // <= 0
  const removedCount = drops.filter(d => d.kind === 'removed').length;
  const netDelta = positiveSum + negativeSum;

  // Cross-check against the headline number. If overall citations grew but
  // we couldn't attribute the delta to any paper (id rotation, paper removed,
  // missing fetch page, etc.), surface the unattributed delta so the user
  // doesn't think the extension is broken.
  const baselineSum = state.baselinePapers
    ? Object.values(state.baselinePapers).reduce((a, p) => a + (p.citations || 0), 0)
    : 0;
  const currentTotal = parseInt(String(state.citations || '').replace(/,/g, ''), 10);
  const headlineDelta = Number.isFinite(currentTotal) && baselineSum
    ? currentTotal - baselineSum
    : 0;

  // Prefer the headline delta when paper-level math is messy (Scholar
  // merges, removed papers, id rotation). Fall back to our paper sum.
  const displayedDelta = headlineDelta !== 0 ? headlineDelta : netDelta;
  $('growthTotal').textContent = (displayedDelta >= 0 ? '+' : '') + displayedDelta;

  // Reconciliation note: explain the gap between the headline delta and
  // the per-paper math. Now that we render the negative papers in their
  // own list, the note only needs to call out residual unattributed gap.
  const noteEl = $('reconcileNote');
  if (noteEl) {
    const gap = headlineDelta - netDelta;
    const showNote = gap !== 0 && (rows.length > 0 || drops.length > 0);
    if (showNote) {
      const parts = [];
      parts.push(`列表内净变化 ${netDelta >= 0 ? '+' : ''}${netDelta}，但总引用较本周期起点变化 ${headlineDelta >= 0 ? '+' : ''}${headlineDelta}`);
      if (gap < 0) {
        parts.push(`差额 ${gap}：Scholar 可能把同一次新引用同时计入了多篇论文（合并集群）`);
      } else {
        parts.push(`差额 +${gap}：可能有论文超出抓取范围或 ID 已变化`);
      }
      noteEl.textContent = parts.join('；') + '。';
      noteEl.classList.remove('hidden');
    } else if (rows.length === 0 && drops.length === 0 && removedCount === 0) {
      noteEl.classList.add('hidden');
    } else {
      noteEl.classList.add('hidden');
    }
  }

  if (rows.length === 0 && drops.length === 0) {
    if (headlineDelta > 0) {
      $('growthEmpty').innerHTML =
        `总引用较本周期起点 <b>+${headlineDelta}</b>，但未能定位到具体论文（可能因 Google Scholar 调整了论文 ID 或该论文不在前几页）。<br/>可点"开始新周期"以当前状态重新开始统计。`;
    } else if (headlineDelta < 0) {
      $('growthEmpty').innerHTML =
        `总引用较本周期起点 <b>${headlineDelta}</b>（Scholar 可能合并或移除了论文）。可点"开始新周期"以当前状态重新开始统计。`;
    } else {
      $('growthEmpty').textContent = '本周期内暂无引用增长。';
    }
    $('growthEmpty').classList.remove('hidden');
    return;
  }
  $('growthEmpty').classList.add('hidden');

  for (const r of rows) {
    const li = document.createElement('li');
    li.className = 'item';
    const a = document.createElement('a');
    a.className = 't';
    a.textContent = r.title + (r.isNew ? '  · NEW' : '');
    a.href = r.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    const d = document.createElement('div');
    d.className = 'd';
    d.textContent = '+' + r.delta;
    const c = document.createElement('div');
    c.className = 'c';
    c.textContent = r.citations;
    li.append(a, d, c);
    list.appendChild(li);
  }

  // Render the "decreased / merged-away" papers in their own labelled
  // sub-section so the user can see exactly which paper(s) lost citations.
  if (dropList && dropHdr) {
    if (drops.length > 0) {
      dropHdr.classList.remove('hidden');
      dropList.classList.remove('hidden');
      for (const r of drops) {
        const li = document.createElement('li');
        li.className = 'item drop';
        const a = document.createElement('a');
        a.className = 't';
        const tag = r.kind === 'removed' ? '  · 已合并/移除' : '  · 引用减少';
        a.textContent = r.title + tag;
        if (r.url) {
          a.href = r.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
        const d = document.createElement('div');
        d.className = 'd neg';
        d.textContent = String(r.delta); // already negative
        const c = document.createElement('div');
        c.className = 'c';
        c.textContent = r.kind === 'removed' ? '—' : String(r.citations);
        li.append(a, d, c);
        dropList.appendChild(li);
      }
    } else {
      dropHdr.classList.add('hidden');
      dropList.classList.add('hidden');
    }
  }
}

$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;
  $('refresh').textContent = '刷新中…';
  try {
    await chrome.runtime.sendMessage({ type: 'refresh' });
  } finally {
    $('refresh').disabled = false;
    $('refresh').textContent = '刷新';
    render();
  }
});

$('resetBaseline').addEventListener('click', async () => {
  if (!confirm('将当前引用状态设为新统计周期的起点？之后的新增引用将从现在开始计算。')) return;
  const res = await chrome.runtime.sendMessage({ type: 'resetBaseline' });
  if (res && !res.ok) {
    $('err').textContent = '提示: ' + (res.error || '无法开始新周期');
    $('err').classList.remove('hidden');
    return;
  }
  render();
});

$('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Live update while popup is open
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') render();
});

render();
