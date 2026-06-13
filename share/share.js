(function (root) {
  'use strict';

  const CARD_W = 1200;
  const CARD_H = 630;
  const DEFAULT_LINK_URL = 'https://github.com/sci-m-wang/CiteBeat';
  const STORAGE_KEYS = [
    'settings',
    'citations',
    'currentPapers',
    'baselinePapers',
    'baselineAt',
    'lastUpdatedAt',
    'citationHistory'
  ];

  const COLORS = {
    blue: '#1e4fc2',
    blueDark: '#163d98',
    ink: '#191b1f',
    muted: '#6f7278',
    lightText: '#8a8d93',
    surface: '#ffffff',
    page: '#f5f7fb',
    line: '#e7ecf5',
    softBlue: '#e8efff',
    chip: '#eef4ff',
    success: '#0a7a2f'
  };

  const DEFAULT_SETTINGS = {
    source: 'scholar',
    scholarId: '',
    semanticScholarId: '',
    baselineMode: 'manual',
    baselineIntervalDays: 10
  };

  const $ = (id) => document.getElementById(id);

  function parseTotal(value) {
    const n = parseInt(String(value || '').replace(/,/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }

  function formatNumber(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString('en-US');
  }

  function formatSigned(value) {
    const n = Number(value) || 0;
    return `${n >= 0 ? '+' : ''}${formatNumber(n)}`;
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function getSource(settings) {
    return settings?.source === 'semanticscholar' ? 'semanticscholar' : 'scholar';
  }

  function sourceLabel(settings) {
    return getSource(settings) === 'semanticscholar' ? 'Semantic Scholar' : 'Google Scholar';
  }

  function getActiveAuthorId(settings) {
    return getSource(settings) === 'semanticscholar'
      ? (settings.semanticScholarId || '')
      : (settings.scholarId || '');
  }

  function getTrackingKey(settings) {
    const authorId = getActiveAuthorId(settings);
    return authorId ? `${getSource(settings)}:${authorId}` : '';
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

  function sumCitations(papers) {
    return Object.values(papers || {}).reduce((acc, p) => acc + (Number(p.citations) || 0), 0);
  }

  function computePaperChanges(current, baseline) {
    const positive = [];
    const negative = [];
    if (!baseline || Object.keys(baseline).length === 0) return { positive, negative, netDelta: 0 };

    const baseByTitle = buildTitleIndex(baseline);
    const matchedBaseIds = new Set();
    for (const id of Object.keys(current || {})) {
      const cur = current[id];
      let base = baseline[id];
      if (base) {
        matchedBaseIds.add(id);
      } else {
        base = baseByTitle[normTitle(cur.title)];
        if (base) matchedBaseIds.add(base.id);
      }
      const baseC = base ? (Number(base.citations) || 0) : 0;
      const delta = (Number(cur.citations) || 0) - baseC;
      if (delta > 0) {
        positive.push({ title: cur.title || 'Untitled paper', delta, citations: Number(cur.citations) || 0 });
      } else if (delta < 0) {
        negative.push({ title: cur.title || 'Untitled paper', delta, citations: Number(cur.citations) || 0 });
      }
    }

    for (const id of Object.keys(baseline || {})) {
      if (matchedBaseIds.has(id)) continue;
      const base = baseline[id];
      negative.push({ title: base.title || 'Untitled paper', delta: -(Number(base.citations) || 0), citations: 0 });
    }

    positive.sort((a, b) => b.delta - a.delta);
    negative.sort((a, b) => a.delta - b.delta);
    const netDelta = positive.reduce((acc, p) => acc + p.delta, 0)
      + negative.reduce((acc, p) => acc + p.delta, 0);
    return { positive, negative, netDelta };
  }

  function getTrendRows(settings, history) {
    const trackingKey = getTrackingKey(settings);
    return (Array.isArray(history) ? history : [])
      .filter(item => item && item.trackingKey === trackingKey && Number.isFinite(Number(item.total)))
      .map(item => ({ ts: Number(item.ts) || 0, total: Number(item.total) }))
      .filter(item => item.ts > 0)
      .sort((a, b) => a.ts - b.ts)
      .slice(-30);
  }

  function periodLabel(baselineAt, lastUpdatedAt) {
    if (!baselineAt || !lastUpdatedAt) return 'Current period';
    const days = Math.max(1, Math.round((Number(lastUpdatedAt) - Number(baselineAt)) / (24 * 60 * 60 * 1000)));
    return days === 1 ? '1 day' : `${days} days`;
  }

  function buildShareModel(rawState) {
    const settings = { ...DEFAULT_SETTINGS, ...(rawState.settings || {}) };
    const total = parseTotal(rawState.citations);
    const lastUpdatedAt = Number(rawState.lastUpdatedAt) || 0;
    const currentPapers = rawState.currentPapers || {};
    const baselinePapers = rawState.baselinePapers || {};
    const baselineSum = sumCitations(baselinePapers);
    const paperChanges = computePaperChanges(currentPapers, baselinePapers);
    const headlineDelta = total != null && baselineSum > 0 ? total - baselineSum : null;
    const periodDelta = headlineDelta != null && headlineDelta !== 0 ? headlineDelta : paperChanges.netDelta;
    const trendRows = getTrendRows(settings, rawState.citationHistory);
    const ready = total != null && lastUpdatedAt > 0;
    const snapshotMode = periodDelta === 0;

    return {
      ready,
      error: ready ? '' : '请先成功刷新一次引用数据，再生成分享图。',
      linkUrl: DEFAULT_LINK_URL,
      settings,
      source: sourceLabel(settings),
      authorId: getActiveAuthorId(settings),
      trackingKey: getTrackingKey(settings),
      total,
      lastUpdatedAt,
      baselineAt: Number(rawState.baselineAt) || 0,
      periodLabel: periodLabel(rawState.baselineAt, lastUpdatedAt),
      periodDelta,
      snapshotMode,
      mainTitle: snapshotMode ? 'Citation Snapshot' : (periodDelta > 0 ? 'Citation Growth' : 'Citation Shift'),
      mainValue: snapshotMode ? formatNumber(total) : formatSigned(periodDelta),
      mainUnit: snapshotMode
        ? 'total citations'
        : (periodDelta > 0 ? 'new citations this period' : 'citation change this period'),
      topPapers: paperChanges.positive.slice(0, 3),
      trendRows
    };
  }

  async function loadShareModel() {
    const rawState = await chrome.storage.local.get(STORAGE_KEYS);
    return buildShareModel(rawState);
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function drawRoundedFill(ctx, x, y, w, h, r, fill, stroke) {
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function fitText(ctx, text, maxWidth, initialSize, minSize, weight = '700') {
    let size = initialSize;
    do {
      ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      if (ctx.measureText(text).width <= maxWidth) return size;
      size -= 4;
    } while (size >= minSize);
    return minSize;
  }

  function truncateText(ctx, text, maxWidth) {
    const value = String(text || '');
    if (ctx.measureText(value).width <= maxWidth) return value;
    let lo = 0;
    let hi = value.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(value.slice(0, mid) + '…').width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return value.slice(0, Math.max(0, lo)) + '…';
  }

  function drawIconFallback(ctx, x, y, size) {
    drawRoundedFill(ctx, x, y, size, size, 13, COLORS.blue);
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.round(size * 0.46)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Cb', x + size / 2, y + size / 2 + 1);
  }

  function drawBrand(ctx, iconImage) {
    const x = 74;
    const y = 58;
    const size = 52;
    if (iconImage) {
      ctx.save();
      roundRect(ctx, x, y, size, size, 13);
      ctx.clip();
      ctx.drawImage(iconImage, x, y, size, size);
      ctx.restore();
    } else {
      drawIconFallback(ctx, x, y, size);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.ink;
    ctx.font = '700 30px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('CiteBeat', x + 68, y + 27);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '400 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('Academic citation tracking', x + 68, y + 50);
  }

  function drawPill(ctx, text, x, y) {
    ctx.font = '600 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const width = Math.ceil(ctx.measureText(text).width) + 34;
    drawRoundedFill(ctx, x - width, y - 23, width, 38, 19, COLORS.chip);
    ctx.fillStyle = COLORS.blue;
    ctx.textAlign = 'right';
    ctx.fillText(text, x - 16, y + 2);
  }

  function drawTrendChart(ctx, rows, x, y, w, h) {
    drawRoundedFill(ctx, x, y, w, h, 18, '#fbfdff', COLORS.line);
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, 18);
    ctx.clip();

    ctx.strokeStyle = '#edf1f8';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i += 1) {
      const yy = y + (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(x + 24, yy);
      ctx.lineTo(x + w - 24, yy);
      ctx.stroke();
    }

    if (!rows || rows.length < 2) {
      ctx.fillStyle = COLORS.lightText;
      ctx.font = '600 22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Trend building', x + w / 2, y + h / 2 + 8);
      ctx.restore();
      return;
    }

    const totals = rows.map(r => r.total);
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    const span = max - min;
    const padX = 34;
    const padY = 28;
    const points = rows.map((row, idx) => ({
      x: x + padX + (idx / (rows.length - 1)) * (w - padX * 2),
      y: span === 0 ? y + h / 2 : y + padY + ((max - row.total) / span) * (h - padY * 2)
    }));

    const areaGradient = ctx.createLinearGradient(0, y + 20, 0, y + h - 20);
    areaGradient.addColorStop(0, 'rgba(30, 79, 194, 0.22)');
    areaGradient.addColorStop(1, 'rgba(30, 79, 194, 0.02)');
    ctx.beginPath();
    points.forEach((point, idx) => idx === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
    ctx.lineTo(points[points.length - 1].x, y + h - padY);
    ctx.lineTo(points[0].x, y + h - padY);
    ctx.closePath();
    ctx.fillStyle = areaGradient;
    ctx.fill();

    ctx.beginPath();
    points.forEach((point, idx) => idx === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
    ctx.strokeStyle = COLORS.blue;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    const first = points[0];
    const last = points[points.length - 1];
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = COLORS.blue;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(first.x, first.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.blue;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = COLORS.lightText;
    ctx.font = '500 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(formatNumber(max), x + 26, y + 28);
    ctx.fillText(formatNumber(min), x + 26, y + h - 18);
    ctx.restore();
  }

  function drawTopMovers(ctx, topPapers, x, y, w) {
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.ink;
    ctx.font = '700 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('Top movers', x, y);

    if (!topPapers || topPapers.length === 0) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = '500 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText('Paper-level movers will appear after citation changes are recorded.', x, y + 36);
      return;
    }

    topPapers.slice(0, 3).forEach((paper, idx) => {
      const rowY = y + 36 + idx * 35;
      ctx.fillStyle = COLORS.lightText;
      ctx.font = '700 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText(String(idx + 1).padStart(2, '0'), x, rowY);

      ctx.fillStyle = COLORS.ink;
      ctx.font = '500 17px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillText(truncateText(ctx, paper.title, w - 98), x + 38, rowY);

      const chip = `+${paper.delta}`;
      ctx.font = '700 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      const chipW = Math.max(44, Math.ceil(ctx.measureText(chip).width) + 22);
      drawRoundedFill(ctx, x + w - chipW, rowY - 23, chipW, 28, 14, '#eaf7ef');
      ctx.fillStyle = COLORS.success;
      ctx.textAlign = 'center';
      ctx.fillText(chip, x + w - chipW / 2, rowY - 4);
      ctx.textAlign = 'left';
    });
  }

  function drawFooter(ctx, model) {
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(74, 554);
    ctx.lineTo(984, 554);
    ctx.stroke();

    ctx.fillStyle = COLORS.ink;
    ctx.font = '700 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Tracked by CiteBeat', 74, 585);
    ctx.fillStyle = COLORS.blue;
    ctx.font = '600 17px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(model.linkUrl.replace(/^https?:\/\//, ''), 306, 585);

    drawRoundedFill(ctx, 1014, 456, 112, 112, 18, '#fff', COLORS.line);
    root.CiteBeatQR.draw(ctx, model.linkUrl, 1024, 466, 92, { foreground: COLORS.ink });
    ctx.fillStyle = COLORS.muted;
    ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Scan for repo', 1070, 588);
  }

  function drawEmptyCard(ctx, message) {
    ctx.clearRect(0, 0, CARD_W, CARD_H);
    drawRoundedFill(ctx, 0, 0, CARD_W, CARD_H, 0, COLORS.page);
    drawRoundedFill(ctx, 54, 54, CARD_W - 108, CARD_H - 108, 30, COLORS.surface, COLORS.line);
    drawIconFallback(ctx, 116, 116, 58);
    ctx.fillStyle = COLORS.ink;
    ctx.font = '700 42px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('CiteBeat share image', 116, 242);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '500 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(message, 116, 292);
  }

  async function loadIcon() {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = '../icons/icon128.png';
    });
  }

  async function renderShareCard(canvas, model, iconImage) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CARD_W, CARD_H);

    if (!model.ready) {
      drawEmptyCard(ctx, model.error);
      return;
    }

    const bg = ctx.createLinearGradient(0, 0, 0, CARD_H);
    bg.addColorStop(0, '#f9fbff');
    bg.addColorStop(1, '#f3f6fb');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
    drawRoundedFill(ctx, 36, 36, CARD_W - 72, CARD_H - 72, 30, COLORS.surface, COLORS.line);

    drawBrand(ctx, iconImage);
    drawPill(ctx, `${model.source} · ${model.periodLabel}`, 1126, 86);

    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.blue;
    ctx.font = '700 25px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(model.mainTitle, 76, 178);

    ctx.fillStyle = COLORS.ink;
    const mainSize = fitText(ctx, model.mainValue, 480, 148, 84, '800');
    ctx.font = `800 ${mainSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.fillText(model.mainValue, 72, 320);

    ctx.fillStyle = COLORS.muted;
    ctx.font = '600 27px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(model.mainUnit, 82, 362);

    ctx.fillStyle = COLORS.lightText;
    ctx.font = '500 17px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText(`Generated ${fmtDate(Date.now())} · Latest refresh ${fmtDate(model.lastUpdatedAt)}`, 82, 392);

    ctx.fillStyle = COLORS.ink;
    ctx.font = '800 48px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(formatNumber(model.total), 1124, 178);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '600 19px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('total citations', 1124, 205);

    drawTrendChart(ctx, model.trendRows, 686, 230, 438, 182);
    drawTopMovers(ctx, model.topPapers, 76, 438, 680);
    drawFooter(ctx, model);
  }

  function setStatus(message, isError = false) {
    const el = $('status');
    if (!el) return;
    el.textContent = message;
    el.className = 'status' + (isError ? ' err' : '');
  }

  function updateMeta(model) {
    $('metricTotal').textContent = `总引用 ${model.ready ? formatNumber(model.total) : '—'}`;
    $('metricDelta').textContent = `本周期 ${model.ready ? (model.snapshotMode ? '0' : formatSigned(model.periodDelta)) : '—'}`;
    $('metricSource').textContent = `数据源 ${model.ready ? model.source : '—'}`;
  }

  async function renderPage() {
    const canvas = $('shareCanvas');
    const downloadButton = $('download');
    downloadButton.disabled = true;
    setStatus('正在生成…');

    try {
      const model = await loadShareModel();
      const icon = await loadIcon();
      await renderShareCard(canvas, model, icon);
      updateMeta(model);
      if (!model.ready) {
        setStatus(model.error, true);
        return model;
      }
      downloadButton.disabled = false;
      setStatus('分享图已生成，可下载 PNG。');
      root.__lastShareModel = model;
      return model;
    } catch (err) {
      drawEmptyCard(canvas.getContext('2d'), '生成失败，请稍后重试。');
      setStatus('生成失败: ' + (err && err.message || err), true);
      throw err;
    }
  }

  function downloadCanvas(canvas) {
    canvas.toBlob((blob) => {
      if (!blob) {
        setStatus('下载失败: 无法生成 PNG', true);
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `citebeat-share-${fmtDate(Date.now())}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }, 'image/png');
  }

  function init() {
    $('download').addEventListener('click', () => downloadCanvas($('shareCanvas')));
    $('rerender').addEventListener('click', () => { renderPage(); });
    renderPage();
  }

  const api = {
    buildShareModel,
    computePaperChanges,
    getTrendRows,
    renderShareCard,
    drawTrendChart,
    truncateText,
    formatNumber,
    formatSigned
  };
  root.CiteBeatShare = api;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : globalThis);
