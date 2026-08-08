const DEFAULTS = {
  source: 'scholar',
  scholarId: '',
  semanticScholarId: '',
  periodMinutes: 30,
  baselineMode: 'manual',
  baselineIntervalDays: 10,
  endpointEnabled: false,
  endpointUrl: '',
  endpointIntervalDays: 1,
  endpointAuthType: 'none'
};

const BACKUP_VERSION = 1;
const STORAGE_SCHEMA_VERSION = 2;
const HISTORY_LIMIT = 1000;
// NOTE: `endpointSecret` is deliberately NOT part of the backup payload —
// the token is a credential and must never leave the machine in a file.
const BACKUP_DATA_KEYS = [
  'settings',
  'citations',
  'metrics',
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

  $('endpointEnabled').checked = !!s.endpointEnabled;
  $('endpointUrl').value = s.endpointUrl || '';
  $('endpointIntervalDays').value = s.endpointIntervalDays || 1;
  $('endpointAuthType').value = ['none', 'bearer'].includes(s.endpointAuthType)
    ? s.endpointAuthType
    : 'none';
  // Never echo the stored token back into the DOM; blank means "keep current".
  $('endpointSecret').value = '';
  updateEndpointSecretVisibility();
  await renderEndpointStatus();

  // Show welcome banner if nothing configured yet.
  if (!s.scholarId && !s.semanticScholarId) {
    $('welcome').classList.add('show');
  }
}

function setEndpointStatus(msg, kind = '') {
  const el = $('endpointStatus');
  el.textContent = msg;
  el.className = 'hint' + (kind ? ' ' + kind : '');
}

function fmtTime(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return new Date(n).toLocaleString();
}

async function renderEndpointStatus() {
  const stored = await chrome.storage.local.get([
    'endpointLastSentAt',
    'endpointLastAttemptAt',
    'endpointLastStatus',
    'endpointLastError',
    'endpointLastHttpStatus',
    'endpointSecret'
  ]);
  const hasSecret = typeof stored.endpointSecret === 'string' && stored.endpointSecret.length > 0;
  const parts = [];
  parts.push(`上次成功：${fmtTime(stored.endpointLastSentAt)}`);
  if (stored.endpointLastHttpStatus) parts.push(`HTTP ${stored.endpointLastHttpStatus}`);
  parts.push(hasSecret ? 'Token：已保存' : 'Token：未设置');
  if (stored.endpointLastStatus === 'error' && stored.endpointLastError) {
    parts.push(`上次错误（${fmtTime(stored.endpointLastAttemptAt)}）：${stored.endpointLastError}`);
    setEndpointStatus(parts.join(' · '), 'err');
    return;
  }
  setEndpointStatus(parts.join(' · '), stored.endpointLastStatus === 'ok' ? 'ok' : '');
}

function updateEndpointSecretVisibility() {
  const type = $('endpointAuthType').value;
  $('endpointSecretRow').classList.toggle('hidden', type !== 'bearer');
}

function originPatternFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('节点地址必须以 http:// 或 https:// 开头');
  }
  return `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}/*`;
}

// Host permission must be requested from a user gesture, so it happens here
// in the options page rather than in the service worker.
async function ensureEndpointPermission(rawUrl) {
  let pattern;
  try {
    pattern = originPatternFromUrl(rawUrl);
  } catch (e) {
    throw new Error(e && e.message || '节点地址不是合法 URL');
  }
  if (await chrome.permissions.contains({ origins: [pattern] })) return pattern;
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) throw new Error(`未授权访问 ${pattern}，无法上报`);
  return pattern;
}

// Persist endpoint settings before any send so the worker reads current values.
async function saveEndpointSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  const current = { ...DEFAULTS, ...(settings || {}) };
  const endpointUrl = $('endpointUrl').value.trim();
  const endpointAuthType = $('endpointAuthType').value === 'bearer' ? 'bearer' : 'none';
  const next = {
    ...current,
    endpointEnabled: $('endpointEnabled').checked,
    endpointUrl,
    endpointIntervalDays: Math.max(1, parseInt($('endpointIntervalDays').value, 10) || 1),
    endpointAuthType
  };
  const patch = { settings: next };
  const secret = $('endpointSecret').value;
  if (endpointAuthType === 'bearer' && secret) {
    patch.endpointSecret = secret;
  }
  await chrome.storage.local.set(patch);
  $('endpointSecret').value = '';
  return next;
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
  const endpointAuthType = settings.endpointAuthType || DEFAULTS.endpointAuthType;
  if (!['none', 'bearer'].includes(endpointAuthType)) {
    throw new Error('备份中的鉴权方式不受支持');
  }
  if (settings.endpointIntervalDays != null
    && (!Number.isFinite(Number(settings.endpointIntervalDays)) || Number(settings.endpointIntervalDays) < 1)) {
    throw new Error('备份中的上报周期不正确');
  }
  if (settings.endpointUrl) {
    try {
      originPatternFromUrl(String(settings.endpointUrl));
    } catch (_) {
      throw new Error('备份中的节点地址不是合法 URL');
    }
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
  const endpointEnabled = $('endpointEnabled').checked;
  const endpointUrl = $('endpointUrl').value.trim();
  const endpointIntervalDays = Math.max(1, parseInt($('endpointIntervalDays').value, 10) || 1);
  const endpointAuthType = $('endpointAuthType').value === 'bearer' ? 'bearer' : 'none';

  if (source === 'scholar' && !scholarId) {
    setStatus('请填写 Google Scholar user id', true); return;
  }
  if (source === 'semanticscholar' && !semanticScholarId) {
    setStatus('请填写 Semantic Scholar author id', true); return;
  }
  if (endpointEnabled && !endpointUrl) {
    setStatus('启用上报时必须填写节点地址', true); return;
  }
  if (endpointUrl) {
    try {
      originPatternFromUrl(endpointUrl);
    } catch (e) {
      setStatus('节点地址无效: ' + (e && e.message || e), true); return;
    }
  }
  // Requesting permission needs the click gesture, so do it during save.
  if (endpointEnabled && endpointUrl) {
    try {
      await ensureEndpointPermission(endpointUrl);
    } catch (e) {
      setStatus(String(e && e.message || e), true); return;
    }
  }

  const patch = {
    settings: {
      source,
      scholarId,
      semanticScholarId,
      periodMinutes,
      baselineMode,
      baselineIntervalDays,
      endpointEnabled,
      endpointUrl,
      endpointIntervalDays,
      endpointAuthType
    }
  };
  const secret = $('endpointSecret').value;
  if (endpointAuthType === 'bearer' && secret) {
    patch.endpointSecret = secret;
  }
  await chrome.storage.local.set(patch);
  $('endpointSecret').value = '';
  $('welcome').classList.remove('show');
  await renderEndpointStatus();
  setStatus('已保存，正在刷新…');
});

$('endpointAuthType').addEventListener('change', updateEndpointSecretVisibility);

$('testEndpoint').addEventListener('click', async () => {
  const url = $('endpointUrl').value.trim();
  if (!url) { setEndpointStatus('请先填写节点地址', 'err'); return; }
  setEndpointStatus('测试中…');
  try {
    await ensureEndpointPermission(url);
    await saveEndpointSettings();
    const res = await chrome.runtime.sendMessage({ type: 'sendSnapshot', reason: 'test' });
    if (res && res.ok) {
      setEndpointStatus(`测试成功：HTTP ${res.status}（${res.attempts} 次尝试）`, 'ok');
    } else {
      setEndpointStatus('测试失败: ' + (res && res.error || '未知错误'), 'err');
    }
  } catch (e) {
    setEndpointStatus('测试失败: ' + (e && e.message || e), 'err');
  } finally {
    await renderEndpointStatus();
  }
});

$('sendNow').addEventListener('click', async () => {
  const url = $('endpointUrl').value.trim();
  if (!url) { setEndpointStatus('请先填写节点地址', 'err'); return; }
  setEndpointStatus('发送中…');
  try {
    await ensureEndpointPermission(url);
    await saveEndpointSettings();
    const res = await chrome.runtime.sendMessage({ type: 'sendSnapshot', reason: 'manual' });
    if (res && res.ok) {
      setEndpointStatus(`发送成功：HTTP ${res.status}`, 'ok');
    } else {
      setEndpointStatus('发送失败: ' + (res && res.error || '未知错误'), 'err');
    }
  } catch (e) {
    setEndpointStatus('发送失败: ' + (e && e.message || e), 'err');
  } finally {
    await renderEndpointStatus();
  }
});

$('previewSnapshot').addEventListener('click', async () => {
  const pre = $('snapshotPreview');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'previewSnapshot' });
    if (!res || !res.ok) throw new Error(res && res.error || '无法生成快照');
    pre.textContent = JSON.stringify(res.snapshot, null, 2);
    pre.classList.remove('hidden');
    setEndpointStatus('已生成本地预览，未发送任何数据', 'ok');
  } catch (e) {
    pre.classList.add('hidden');
    setEndpointStatus('预览失败: ' + (e && e.message || e), 'err');
  }
});

$('clearSecret').addEventListener('click', async () => {
  await chrome.storage.local.remove('endpointSecret');
  $('endpointSecret').value = '';
  await renderEndpointStatus();
  setEndpointStatus('已清除本地保存的 Token', 'ok');
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
