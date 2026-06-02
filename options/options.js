const DEFAULTS = {
  source: 'scholar',
  scholarId: '',
  semanticScholarId: '',
  periodMinutes: 30,
  baselineMode: 'manual',
  baselineIntervalDays: 10
};

const BACKUP_VERSION = 1;
const STORAGE_SCHEMA_VERSION = 1;
const HISTORY_LIMIT = 1000;
const BACKUP_DATA_KEYS = [
  'settings',
  'citations',
  'currentPapers',
  'currentPapersKey',
  'baselinePapers',
  'baselineAt',
  'baselineKey',
  'lastBaselineReset',
  'citationHistory',
  'lastUpdatedAt'
];

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

function fmtBackupDate(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function buildBackupData(stored) {
  const data = {};
  for (const key of BACKUP_DATA_KEYS) {
    data[key] = Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null;
  }
  data.settings = stored.settings && typeof stored.settings === 'object' ? stored.settings : null;
  data.citationHistory = Array.isArray(stored.citationHistory)
    ? stored.citationHistory.slice(-HISTORY_LIMIT)
    : [];
  return data;
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function exportBackup() {
  const stored = await chrome.storage.local.get([...BACKUP_DATA_KEYS, 'storageSchemaVersion']);
  const exportedAt = Date.now();
  const backup = {
    app: 'CiteBeat',
    backupVersion: BACKUP_VERSION,
    extensionVersion: chrome.runtime.getManifest().version,
    exportedAt,
    storageSchemaVersion: STORAGE_SCHEMA_VERSION,
    data: buildBackupData(stored)
  };
  downloadJson(`citebeat-backup-${fmtBackupDate(exportedAt)}.json`, backup);
  setStatus('已导出备份');
}

function validateBackupSettings(settings) {
  if (settings == null) return;
  if (typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('备份中的设置格式不正确');
  }
  const source = settings.source || DEFAULTS.source;
  if (!['scholar', 'semanticscholar'].includes(source)) {
    throw new Error('备份中的数据来源不受支持');
  }
  const baselineMode = settings.baselineMode || DEFAULTS.baselineMode;
  if (!['manual', 'weekly', 'monthly', 'interval'].includes(baselineMode)) {
    throw new Error('备份中的统计周期不受支持');
  }
  if (settings.periodMinutes != null && (!Number.isFinite(Number(settings.periodMinutes)) || Number(settings.periodMinutes) < 1)) {
    throw new Error('备份中的刷新间隔不正确');
  }
  if (settings.baselineIntervalDays != null
    && (!Number.isFinite(Number(settings.baselineIntervalDays)) || Number(settings.baselineIntervalDays) < 1)) {
    throw new Error('备份中的自动周期天数不正确');
  }
}

function parseCiteBeatBackup(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('备份文件格式不正确');
  }
  if (raw.app !== 'CiteBeat') {
    throw new Error('这不是 CiteBeat 备份文件');
  }
  if (raw.backupVersion !== BACKUP_VERSION) {
    throw new Error('不支持的备份版本');
  }
  const data = raw.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('备份数据缺失或格式不正确');
  }
  const history = data.citationHistory == null ? [] : data.citationHistory;
  if (!Array.isArray(history)) {
    throw new Error('备份中的历史记录格式不正确');
  }
  validateBackupSettings(data.settings);

  const restored = {};
  for (const key of BACKUP_DATA_KEYS) {
    restored[key] = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
  }
  restored.citationHistory = history.slice(-HISTORY_LIMIT);
  restored.storageSchemaVersion = STORAGE_SCHEMA_VERSION;
  restored.lastError = '';
  restored.restoreInProgress = true;
  return restored;
}

async function importBackupFile(file) {
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch (_) {
    throw new Error('无法解析备份 JSON');
  }
  const restored = parseCiteBeatBackup(raw);
  const historyCount = restored.citationHistory.length;
  const ok = confirm(`将用备份数据覆盖当前本地数据。当前设置、统计周期和历史记录都会被替换，确定继续？`);
  if (!ok) {
    setStatus('已取消导入');
    return;
  }
  await chrome.storage.local.set(restored);
  await chrome.storage.local.remove('restoreInProgress');
  await load();
  setStatus(`已导入备份（${historyCount} 条历史）`);
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

$('exportBackup').addEventListener('click', async () => {
  try {
    await exportBackup();
  } catch (e) {
    setStatus('导出失败: ' + (e && e.message || e), true);
  }
});

$('importBackup').addEventListener('click', () => {
  $('backupFile').value = '';
  $('backupFile').click();
});

$('backupFile').addEventListener('change', async () => {
  const file = $('backupFile').files && $('backupFile').files[0];
  if (!file) return;
  try {
    await importBackupFile(file);
  } catch (e) {
    setStatus('导入失败: ' + (e && e.message || e), true);
  } finally {
    $('backupFile').value = '';
  }
});

load();
