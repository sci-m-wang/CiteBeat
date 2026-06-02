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

function getActiveAuthorId(settings) {
  if (!settings) return '';
  return settings.source === 'semanticscholar'
    ? (settings.semanticScholarId || '')
    : (settings.scholarId || '');
}

function getTrackingKey(settings) {
  const source = settings?.source === 'semanticscholar' ? 'semanticscholar' : 'scholar';
  const authorId = getActiveAuthorId(settings);
  return authorId ? `${source}:${authorId}` : '';
}

function fmtSigned(n) {
  return `${n >= 0 ? '+' : ''}${n}`;
}

function fmtTrendTick(ts, includeTime) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getMonth() + 1}/${d.getDate()}`;
  return includeTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

function sameLocalDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

function buildTrendSvg(rows) {
  const w = 336;
  const h = 104;
  const padX = 18;
  const padTop = 18;
  const padBottom = 24;
  const plotW = w - padX * 2;
  const plotH = h - padTop - padBottom;
  const totals = rows.map(r => r.total);
  const min = Math.min(...totals);
  const max = Math.max(...totals);
  const span = max - min;
  const yFor = (total) => span === 0
    ? padTop + plotH / 2
    : padTop + ((max - total) / span) * plotH;
  const points = rows.map((row, idx) => {
    const x = padX + (idx / (rows.length - 1)) * plotW;
    const y = yFor(row.total);
    return { x, y };
  });
  const path = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const baselineY = h - padBottom;
  const area = `${path} L ${points[points.length - 1].x.toFixed(1)} ${baselineY.toFixed(1)} L ${points[0].x.toFixed(1)} ${baselineY.toFixed(1)} Z`;
  const firstPoint = points[0];
  const last = points[points.length - 1];
  const first = rows[0];
  const final = rows[rows.length - 1];
  const includeTime = sameLocalDay(first.ts, final.ts);
  const dots = rows.length <= 12
    ? points.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2" fill="#fff" stroke="#1e4fc2" stroke-width="1.5"/>`).join('')
    : '';

  return `
    <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="引用趋势图">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#d8e5ff" stop-opacity="0.95"/>
          <stop offset="100%" stop-color="#d8e5ff" stop-opacity="0.08"/>
        </linearGradient>
      </defs>
      <line x1="${padX}" y1="${padTop}" x2="${w - padX}" y2="${padTop}" stroke="#edf1f8" stroke-width="1"/>
      <line x1="${padX}" y1="${padTop + plotH / 2}" x2="${w - padX}" y2="${padTop + plotH / 2}" stroke="#edf1f8" stroke-width="1"/>
      <line x1="${padX}" y1="${baselineY}" x2="${w - padX}" y2="${baselineY}" stroke="#edf1f8" stroke-width="1"/>
      <path d="${area}" fill="url(#trendFill)"/>
      <path d="${path}" fill="none" stroke="#1e4fc2" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}
      <circle cx="${firstPoint.x.toFixed(1)}" cy="${firstPoint.y.toFixed(1)}" r="3" fill="#fff" stroke="#1e4fc2" stroke-width="1.8"/>
      <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4" fill="#1e4fc2" stroke="#fff" stroke-width="1.5"/>
      <text x="${padX}" y="12" fill="#8a8a8e" font-size="9">${max}</text>
      <text x="${padX}" y="${baselineY - 4}" fill="#8a8a8e" font-size="9">${min}</text>
      <text x="${padX}" y="${h - 7}" fill="#8a8a8e" font-size="9">${fmtTrendTick(first.ts, includeTime)}</text>
      <text x="${w - padX}" y="${h - 7}" text-anchor="end" fill="#8a8a8e" font-size="9">${fmtTrendTick(final.ts, includeTime)}</text>
    </svg>`;
}

function renderTrend(settings, history) {
  const chart = $('trendChart');
  const empty = $('trendEmpty');
  const meta = $('trendMeta');
  const trackingKey = getTrackingKey(settings);
  const rows = (Array.isArray(history) ? history : [])
    .filter(item => item && item.trackingKey === trackingKey && Number.isFinite(Number(item.total)))
    .map(item => ({ ts: Number(item.ts) || 0, total: Number(item.total) }))
    .filter(item => item.ts > 0)
    .sort((a, b) => a.ts - b.ts)
    .slice(-30);

  chart.innerHTML = '';
  meta.textContent = '';
  if (!trackingKey || rows.length < 2) {
    chart.classList.add('hidden');
    empty.textContent = trackingKey ? '积累 2 次变化后显示趋势。' : '配置作者 ID 后显示趋势。';
    empty.classList.remove('hidden');
    return;
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  meta.textContent = `${rows.length} 次记录 · ${fmtSigned(last.total - first.total)} · 最新 ${last.total}`;
  chart.innerHTML = buildTrendSvg(rows);
  chart.classList.remove('hidden');
  empty.classList.add('hidden');
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
    'citations', 'currentPapers', 'baselinePapers', 'baselineAt', 'lastUpdatedAt', 'lastError', 'citationHistory'
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
  renderTrend(settings, state.citationHistory);

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
