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

function computeGrowth(current, baseline) {
  const positive = [];   // papers with delta > 0 — shown in the list
  let negativeDelta = 0; // sum of negative deltas — surfaced as a reconciliation line
  let removedCount = 0;  // baseline papers that no longer exist in current
  if (!baseline) return { positive, negativeDelta, removedCount };
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
      // Citation count dropped on a still-present paper (rare; Scholar
      // occasionally reclassifies self-citations or removes duplicates).
      negativeDelta += delta;
    }
  }

  // Papers that existed in baseline but no longer in current. Most common
  // cause: Scholar merged two entries together. Their baseline citations
  // are now "missing" and need to be accounted for to keep the math
  // consistent with the headline total.
  for (const id of Object.keys(baseline)) {
    if (!matchedBaseIds.has(id)) {
      negativeDelta -= (baseline[id].citations || 0);
      removedCount += 1;
    }
  }

  positive.sort((a, b) => b.delta - a.delta);
  return { positive, negativeDelta, removedCount };
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
  $('baselineAt').textContent = state.baselineAt ? `基线: ${fmtTime(state.baselineAt)}` : '';

  if (!configured) {
    $('err').innerHTML = '还未配置作者 ID。<a href="#" id="goOpt">点此前往设置</a>';
    $('err').classList.remove('hidden');
    const link = document.getElementById('goOpt');
    if (link) link.addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
  } else if (state.lastError) {
    $('err').textContent = '错误: ' + state.lastError;
    $('err').classList.remove('hidden');
  } else {
    $('err').classList.add('hidden');
  }

  const { positive: rows, negativeDelta, removedCount } = computeGrowth(state.currentPapers || {}, state.baselinePapers);
  const list = $('growthList');
  list.innerHTML = '';
  const positiveSum = rows.reduce((a, r) => a + r.delta, 0);
  const netDelta = positiveSum + negativeDelta; // negativeDelta is <= 0

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

  // Reconciliation note when paper-level positives don't match the
  // headline delta (e.g. Scholar merged 2 entries into 1, so +2 papers
  // gained citations but the headline only rose by +1).
  const noteEl = $('reconcileNote');
  if (noteEl) {
    const mismatch = headlineDelta !== positiveSum;
    if (mismatch && (rows.length > 0 || removedCount > 0)) {
      const parts = [];
      if (positiveSum > 0) parts.push(`本周期 ${rows.length} 篇论文新增 +${positiveSum} 引用`);
      if (removedCount > 0) parts.push(`${removedCount} 篇基线论文被 Scholar 合并/移除（${negativeDelta} 引用并入其他条目）`);
      if (headlineDelta !== positiveSum + negativeDelta && headlineDelta !== 0) {
        parts.push(`总数较基线净变化 ${headlineDelta >= 0 ? '+' : ''}${headlineDelta}`);
      }
      noteEl.textContent = parts.join('；') + '。';
      noteEl.classList.remove('hidden');
    } else {
      noteEl.classList.add('hidden');
    }
  }

  if (rows.length === 0) {
    if (headlineDelta > 0) {
      $('growthEmpty').innerHTML =
        `总引用较基线 <b>+${headlineDelta}</b>，但未能定位到具体论文（可能因 Google Scholar 调整了论文 ID 或该论文不在前几页）。<br/>可点"重置基线"以当前状态重新开始统计。`;
    } else if (headlineDelta < 0) {
      $('growthEmpty').innerHTML =
        `总引用较基线 <b>${headlineDelta}</b>（Scholar 可能合并或移除了论文）。可点"重置基线"以当前状态重新开始统计。`;
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
  if (!confirm('将当前引用状态保存为新基线？之后显示的增长将从现在开始计算。')) return;
  await chrome.runtime.sendMessage({ type: 'resetBaseline' });
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
