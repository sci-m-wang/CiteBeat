#!/usr/bin/env node
// Regression tests for the fetch/update pipeline in background.js.
//
// Loads the real service worker source with a chrome.* stub and a scripted
// fetch(), so the actual parsing and storage logic runs end to end.
//
// Usage: node scripts/test_background.mjs [path/to/background.js]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_PATH = path.resolve(process.argv[2] || path.join(ROOT, 'background.js'));
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

// The code under test logs freely, and its error stacks embed the data: URL the
// module is loaded from, which floods the terminal. Keep our own output and
// silence the rest unless VERBOSE=1.
const say = console.log.bind(console);
if (!process.env.VERBOSE) {
  for (const m of ['log', 'warn', 'error']) console[m] = () => {};
}

const KEY = 'scholar:U';

// ---- Fixtures ----
const ROW = (id, title, n) =>
  `<tr class="gsc_a_tr"><td class="gsc_a_t"><a href="/citations?view_op=view_citation&amp;hl=en&amp;user=U&amp;citation_for_view=U:${id}" class="gsc_a_at">${title}</a></td>`
  + `<td class="gsc_a_c"><a class="gsc_a_ac gs_ibl">${n}</a></td></tr>`;

const PROFILE = (rows, s = { c: 571, h: 12, i: 15 }) => `<html><body>
<div id="gsc_prf_in">Test Author</div>
<table id="gsc_rsb_st"><tbody>
<tr><td class="gsc_rsb_sc1"><a>Citations</a></td><td class="gsc_rsb_std">${s.c}</td><td class="gsc_rsb_std">${s.c}</td></tr>
<tr><td class="gsc_rsb_sc1"><a>h-index</a></td><td class="gsc_rsb_std">${s.h}</td><td class="gsc_rsb_std">${s.h}</td></tr>
<tr><td class="gsc_rsb_sc1"><a>i10-index</a></td><td class="gsc_rsb_std">${s.i}</td><td class="gsc_rsb_std">${s.i}</td></tr>
</tbody></table>
<table><tbody id="gsc_a_b">${rows}</tbody></table></body></html>`;

// What Scholar actually serves to a rate-limited client: HTTP 200, no profile.
const CAPTCHA = `<html><head><title>Google Scholar</title></head><body>
<div id="gs_captcha_c"></div>Please show you&#39;re not a robot<div class="g-recaptcha"></div></body></html>`;
const UNKNOWN = `<html><head><title>Google Scholar</title></head><body><p>Something else entirely</p></body></html>`;

const GOOD_ROWS = ROW('a', 'Paper A', 300) + ROW('b', 'Paper B', 200) + ROW('c', 'Paper C', 71);

function goodState() {
  const papers = {
    a: { id: 'a', title: 'Paper A', citations: 300, url: 'u' },
    b: { id: 'b', title: 'Paper B', citations: 200, url: 'u' },
    c: { id: 'c', title: 'Paper C', citations: 71, url: 'u' }
  };
  return {
    settings: { source: 'scholar', scholarId: 'U', baselineMode: 'manual' },
    citations: '571',
    metrics: { citations: 571, hIndex: 12, i10Index: 15, hIndexSource: 'profile', i10IndexSource: 'profile',
               paperCount: 3, trackingKey: KEY, updatedAt: 2 },
    currentPapers: papers, currentPapersKey: KEY,
    baselinePapers: papers, baselineAt: 1, baselineKey: KEY,
    citationHistory: [
      { ts: 1, total: 560, trackingKey: KEY, paperCount: 3 },
      { ts: 2, total: 571, trackingKey: KEY, paperCount: 3 }
    ],
    lastUpdatedAt: 2
  };
}

// ---- Harness ----
async function makeEnv(initial, fetchHandler) {
  const store = JSON.parse(JSON.stringify(initial || {}));
  const listeners = { storageChanged: [] };
  const badge = { text: null, color: null };
  const fetchLog = [];
  const noop = () => {};

  const chromeStub = {
    runtime: { onInstalled: { addListener: noop }, onStartup: { addListener: noop },
               onMessage: { addListener: noop }, getManifest: () => ({ version: 'test' }),
               openOptionsPage: noop },
    alarms: { onAlarm: { addListener: noop }, create: noop, clear: async () => {} },
    storage: {
      local: {
        get: async (k) => {
          const keys = Array.isArray(k) ? k : [k];
          const out = {};
          for (const key of keys) if (key in store) out[key] = JSON.parse(JSON.stringify(store[key]));
          return out;
        },
        set: async (patch) => { Object.assign(store, JSON.parse(JSON.stringify(patch))); },
        remove: async (k) => { delete store[k]; }
      },
      onChanged: { addListener: (fn) => listeners.storageChanged.push(fn) }
    },
    action: {
      setBadgeText: ({ text }) => { badge.text = text; },
      setBadgeBackgroundColor: ({ color }) => { badge.color = color; }
    },
    permissions: { contains: async () => false, request: async () => false }
  };

  globalThis.__chrome = chromeStub;
  globalThis.fetch = async (url) => {
    fetchLog.push(String(url));
    const body = await fetchHandler(String(url));
    const status = body.status ?? 200;
    const text = typeof body.body === 'string' ? body.body : JSON.stringify(body.body ?? {});
    return { status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text) };
  };

  const wanted = ['updateCitations', 'healPoisonedState', 'ensureStorageSchema'];
  const exported = wanted.filter(n => new RegExp(`function ${n}\\b`).test(SRC));
  const code = `const chrome = globalThis.__chrome;\n${SRC}\nexport { ${exported.join(', ')} };`;
  const mod = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64') + `#${Math.random()}`);
  return { store, badge, fetchLog, listeners, mod };
}

// ---- Tiny runner ----
let passed = 0, failed = 0;
const failures = [];
function check(label, cond, detail = '') {
  if (cond) { passed++; say(`  PASS  ${label}`); }
  else { failed++; failures.push(label); say(`  FAIL  ${label}${detail ? '  -> ' + detail : ''}`); }
}
const scholar = (html) => async () => ({ body: html });

say(`Testing: ${path.relative(ROOT, SRC_PATH)}\n`);

// 1. The reported bug: captcha page (HTTP 200) must not overwrite a good total.
{
  say('[1] captcha page, previous data present');
  const env = await makeEnv(goodState(), scholar(CAPTCHA));
  const ok = await env.mod.updateCitations();
  check('update reports failure', ok === false);
  check("total still '571' (not overwritten with 0)", env.store.citations === '571', `citations=${JSON.stringify(env.store.citations)}`);
  check('metrics untouched', env.store.metrics.citations === 571 && env.store.metrics.hIndex === 12,
        JSON.stringify(env.store.metrics));
  check('history not polluted', env.store.citationHistory.length === 2 && env.store.citationHistory.every(h => h.total > 0),
        JSON.stringify(env.store.citationHistory.map(h => h.total)));
  check('error mentions the verification page', /人机验证|验证码/.test(env.store.lastError || ''), `lastError=${JSON.stringify(env.store.lastError)}`);
  check('papers + baseline untouched', Object.keys(env.store.currentPapers).length === 3 && Object.keys(env.store.baselinePapers).length === 3);
}

// 2. Unrecognised page (markup change / bad id) must also fail loudly.
{
  say('[2] unrecognised page, previous data present');
  const env = await makeEnv(goodState(), scholar(UNKNOWN));
  const ok = await env.mod.updateCitations();
  check('update reports failure', ok === false);
  check("total still '571'", env.store.citations === '571', `citations=${JSON.stringify(env.store.citations)}`);
  check('error says it is not a profile page', /不是作者主页|未能识别/.test(env.store.lastError || ''), `lastError=${JSON.stringify(env.store.lastError)}`);
}

// 3. Normal path must keep working.
{
  say('[3] normal profile page');
  const rows = ROW('a', 'Paper A', 302) + ROW('b', 'Paper B', 202) + ROW('c', 'Paper C', 71);
  const env = await makeEnv(goodState(), scholar(PROFILE(rows, { c: 575, h: 13, i: 16 })));
  const ok = await env.mod.updateCitations();
  check('update succeeds', ok === true, `lastError=${env.store.lastError}`);
  check("total updated to '575'", env.store.citations === '575', `citations=${env.store.citations}`);
  check('h-index / i10 parsed from profile', env.store.metrics.hIndex === 13 && env.store.metrics.i10Index === 16);
  check('history appended with correct delta', env.store.citationHistory.length === 3
        && env.store.citationHistory[2].deltaFromPrevious === 4,
        JSON.stringify(env.store.citationHistory[2]));
  check('badge shows 575', env.badge.text === '575', `badge=${env.badge.text}`);
}

// 4. Profile structure present but completely empty, while we hold real data.
{
  say('[4] empty-looking profile while previous data exists');
  const env = await makeEnv(goodState(), scholar(PROFILE('', { c: 0, h: 0, i: 0 })));
  const ok = await env.mod.updateCitations();
  check('treated as failure', ok === false);
  check("total still '571'", env.store.citations === '571', `citations=${env.store.citations}`);
}

// 5. A genuinely new author with zero papers must still be accepted.
{
  say('[5] genuine empty profile, no previous data');
  const env = await makeEnv({ settings: { source: 'scholar', scholarId: 'U' } }, scholar(PROFILE('', { c: 0, h: 0, i: 0 })));
  const ok = await env.mod.updateCitations();
  check('accepted', ok === true, `lastError=${env.store.lastError}`);
  check("total is '0'", env.store.citations === '0');
}

// 6. Semantic Scholar returning an empty body must be guarded the same way.
{
  say('[6] Semantic Scholar empty response, previous data present');
  const s = goodState();
  s.settings = { source: 'semanticscholar', semanticScholarId: '123' };
  s.currentPapersKey = s.baselineKey = s.metrics.trackingKey = 'semanticscholar:123';
  s.citationHistory.forEach(h => { h.trackingKey = 'semanticscholar:123'; });
  const env = await makeEnv(s, async (url) => (
    /\/papers\?/.test(url) ? { body: { data: [] } } : { body: { citationCount: 0, paperCount: 0, hIndex: 0 } }
  ));
  const ok = await env.mod.updateCitations();
  check('treated as failure', ok === false);
  check("total still '571'", env.store.citations === '571', `citations=${env.store.citations}`);
}

// 7. State already damaged by the old bug must self-heal without a network call.
{
  say('[7] heal state poisoned by the old bug');
  const s = goodState();
  s.citations = '0';
  s.metrics = { citations: 0, hIndex: 0, i10Index: 0, hIndexSource: 'computed', i10IndexSource: 'computed',
                paperCount: 0, trackingKey: KEY, updatedAt: 3 };
  s.citationHistory.push({ ts: 3, total: 0, trackingKey: KEY, paperCount: 0, deltaFromPrevious: -571 });
  const env = await makeEnv(s, scholar(CAPTCHA));
  if (typeof env.mod.healPoisonedState !== 'function') {
    check('healPoisonedState exists', false);
  } else {
    await env.mod.healPoisonedState();
    check("total restored to '571'", env.store.citations === '571', `citations=${env.store.citations}`);
    check('poisoned history entry removed', env.store.citationHistory.length === 2
          && env.store.citationHistory.every(h => h.total > 0), JSON.stringify(env.store.citationHistory.map(h => h.total)));
    check('metrics repaired from intact paper list', env.store.metrics.citations === 571 && env.store.metrics.hIndex === 3,
          JSON.stringify(env.store.metrics));
    check('badge restored', env.badge.text === '571', `badge=${env.badge.text}`);
    const before = JSON.stringify(env.store);
    await env.mod.healPoisonedState();
    check('idempotent', JSON.stringify(env.store) === before);
    check('no network used', env.fetchLog.length === 0);
  }
}

// 8. Healthy state must be left strictly alone by the heal step.
{
  say('[8] heal leaves healthy state untouched');
  const env = await makeEnv(goodState(), scholar(CAPTCHA));
  if (typeof env.mod.healPoisonedState === 'function') {
    const before = JSON.stringify(env.store);
    await env.mod.healPoisonedState();
    check('unchanged', JSON.stringify(env.store) === before);
  } else {
    check('healPoisonedState exists', false);
  }
}

// 9. Editing endpoint settings must not trigger a Scholar request.
{
  say('[9] settings listener only refetches when the data source changes');
  const base = { source: 'scholar', scholarId: 'U', periodMinutes: 30, endpointEnabled: false, endpointUrl: '' };
  const env = await makeEnv(goodState(), scholar(PROFILE(GOOD_ROWS)));
  const fire = async (oldV, newV) => {
    env.fetchLog.length = 0;
    for (const fn of env.listeners.storageChanged) await fn({ settings: { oldValue: oldV, newValue: newV } }, 'local');
    await new Promise(r => setTimeout(r, 50));
    return env.fetchLog.length;
  };
  check('endpoint edit -> no Scholar request', await fire(base, { ...base, endpointUrl: 'https://x.test/a', endpointEnabled: true }) === 0);
  check('refresh interval edit -> no request', await fire(base, { ...base, periodMinutes: 60 }) === 0);
  check('scholarId change -> request', await fire(base, { ...base, scholarId: 'V' }) > 0);
  check('source change -> request', await fire(base, { ...base, source: 'semanticscholar' }) > 0);
  check('first save (no previous value) -> request', await fire(undefined, base) > 0);
}

say(`\n${passed} passed, ${failed} failed`);
if (failed) { say('Failed:\n  - ' + failures.join('\n  - ')); process.exit(1); }
