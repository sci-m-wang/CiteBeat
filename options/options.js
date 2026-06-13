const DEFAULTS = {
  source: 'scholar',
  scholarId: '',
  semanticScholarId: '',
  periodMinutes: 30,
  baselineMode: 'manual',
  baselineIntervalDays: 10
};

const $ = (id) => document.getElementById(id);

async function load() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = { ...DEFAULTS, ...(settings || {}) };
  const baselineMode = ['manual', 'weekly', 'monthly', 'interval'].includes(s.baselineMode)
    ? s.baselineMode
    : 'manual';
  document.querySelectorAll('input[name=source]').forEach(el => {
    el.checked = (el.value === s.source);
  });
  $('scholarId').value = s.scholarId || '';
  $('semanticScholarId').value = s.semanticScholarId || '';
  $('periodMinutes').value = s.periodMinutes || 30;
  document.querySelectorAll('input[name=baselineMode]').forEach(el => {
    el.checked = (el.value === baselineMode);
  });
  $('baselineIntervalDays').value = s.baselineIntervalDays || 10;
  updateBaselineIntervalVisibility();

  // Show welcome banner if nothing configured yet.
  if (!s.scholarId && !s.semanticScholarId) {
    $('welcome').classList.add('show');
  }
}

function setStatus(msg, isErr = false) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (isErr ? ' err' : '');
  if (msg) setTimeout(() => { el.textContent = ''; }, 3000);
}

function updateBaselineIntervalVisibility() {
  const mode = document.querySelector('input[name=baselineMode]:checked')?.value || 'manual';
  $('baselineIntervalRow').classList.toggle('hidden', mode !== 'interval');
}

document.querySelectorAll('input[name=baselineMode]').forEach(el => {
  el.addEventListener('change', updateBaselineIntervalVisibility);
});

$('save').addEventListener('click', async () => {
  const source = document.querySelector('input[name=source]:checked')?.value || 'scholar';
  const scholarId = $('scholarId').value.trim();
  const semanticScholarId = $('semanticScholarId').value.trim();
  const periodMinutes = Math.max(1, parseInt($('periodMinutes').value, 10) || 30);
  const baselineMode = document.querySelector('input[name=baselineMode]:checked')?.value || 'manual';
  const baselineIntervalDays = Math.max(1, parseInt($('baselineIntervalDays').value, 10) || 10);

  if (source === 'scholar' && !scholarId) {
    setStatus('请填写 Google Scholar user id', true); return;
  }
  if (source === 'semanticscholar' && !semanticScholarId) {
    setStatus('请填写 Semantic Scholar author id', true); return;
  }

  await chrome.storage.local.set({
    settings: {
      source,
      scholarId,
      semanticScholarId,
      periodMinutes,
      baselineMode,
      baselineIntervalDays
    }
  });
  $('welcome').classList.remove('show');
  setStatus('已保存，正在刷新…');
});

$('refresh').addEventListener('click', async () => {
  setStatus('刷新中…');
  const res = await chrome.runtime.sendMessage({ type: 'refresh' });
  if (res && res.ok) setStatus('刷新完成');
  else setStatus('刷新失败: ' + (res && res.error || ''), true);
});

load();
