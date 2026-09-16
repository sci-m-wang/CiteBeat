#!/usr/bin/env node
// Render the real popup/options UI to PNG for store screenshots.
//
// Rather than hand-writing mock markup (which drifts from the real UI), this
// injects a chrome.* stub and lets the actual popup.js / options.js run, so
// the DOM is produced by the same render path users see. Only the data is
// seeded.
//
// Usage: node scripts/render_ui.mjs

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs');

function findChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('Chrome not found; add its path to findChrome().');
}

// ---- Seeded state ----
const now = Date.now();
const day = 86400000;
const KEY = 'scholar:dcqk_mMAAAAJ';

const paper = (id, title, citations, url) => ({ id, title, citations, url });
const CURRENT = {
  p1: paper('p1', 'Towards Emotionally Intelligent Dialogue Systems for Mental Health Support', 214, '#'),
  p2: paper('p2', 'A Survey on Large Language Models for Psychological Counseling', 132, '#'),
  p3: paper('p3', 'Modeling Defense Mechanisms in Counseling Conversations', 96, '#'),
  p4: paper('p4', 'Retrieval-Augmented Generation for Low-Resource Domains', 74, '#'),
  p5: paper('p5', 'Cross-Lingual Transfer for Affective Computing', 55, '#')
};
// Baseline is slightly behind so the growth list has content to show.
// Sizes are chosen so the numbers reconcile to a clear positive headline:
// positives +8, one merged-away duplicate -3, net +5.
const BASELINE = {
  p1: paper('p1', CURRENT.p1.title, 209, '#'),
  p2: paper('p2', CURRENT.p2.title, 129, '#'),
  p3: paper('p3', CURRENT.p3.title, 96, '#'),
  p4: paper('p4', CURRENT.p4.title, 74, '#'),
  p5: paper('p5', CURRENT.p5.title, 55, '#'),
  p6: paper('p6', 'Duplicate Entry Merged By Scholar', 3, '#')
};

const STATE = {
  settings: {
    source: 'scholar', scholarId: 'dcqk_mMAAAAJ', semanticScholarId: '',
    periodMinutes: 30, baselineMode: 'weekly', baselineIntervalDays: 10,
    endpointEnabled: true, endpointMode: 'github', endpointUrl: '',
    endpointIntervalDays: 1, endpointAuthType: 'none',
    githubOwner: 'sci-m-wang', githubRepo: 'sci-m-wang.github.io',
    githubBranch: 'main', githubPath: 'data/citations.json',
    githubCommitMessage: 'chore(citebeat): update citation snapshot'
  },
  citations: '571',
  metrics: { citations: 571, hIndex: 12, i10Index: 15, paperCount: 5, trackingKey: KEY, updatedAt: now },
  currentPapers: CURRENT,
  currentPapersKey: KEY,
  baselinePapers: BASELINE,
  baselineAt: now - 5 * day,
  baselineKey: KEY,
  lastUpdatedAt: now - 6 * 60000,
  lastError: '',
  citationHistory: [
    { ts: now - 28 * day, total: 498, trackingKey: KEY },
    { ts: now - 24 * day, total: 512, trackingKey: KEY },
    { ts: now - 20 * day, total: 519, trackingKey: KEY },
    { ts: now - 16 * day, total: 530, trackingKey: KEY },
    { ts: now - 12 * day, total: 541, trackingKey: KEY },
    { ts: now - 8 * day,  total: 548, trackingKey: KEY },
    { ts: now - 5 * day,  total: 563, trackingKey: KEY },
    { ts: now - 2 * day,  total: 568, trackingKey: KEY },
    { ts: now,            total: 571, trackingKey: KEY }
  ],
  // Reporting looks configured and healthy, but no token is present.
  endpointLastSentAt: now - 20 * 3600000,
  endpointLastStatus: 'ok',
  endpointLastError: '',
  endpointLastHttpStatus: 200,
  endpointLastDetail: '已更新 sci-m-wang/sci-m-wang.github.io@main:data/citations.json (a1b2c3d)'
};

const STUB = `<script>
(function () {
  const STATE = ${JSON.stringify(STATE)};
  const noop = () => {};
  window.chrome = {
    storage: {
      local: {
        get: (keys) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) if (k in STATE) out[k] = STATE[k];
          return Promise.resolve(out);
        },
        set: () => Promise.resolve(),
        remove: () => Promise.resolve()
      },
      onChanged: { addListener: noop }
    },
    runtime: {
      sendMessage: () => Promise.resolve({ ok: true }),
      openOptionsPage: noop,
      getURL: (p) => p,
      getManifest: () => ({ version: '0.3.2' })
    },
    permissions: {
      contains: () => Promise.resolve(true),
      request: () => Promise.resolve(true)
    }
  };
})();
</script>`;

function renderPage(srcHtmlRel, outPng, width, height) {
  const srcPath = path.join(ROOT, srcHtmlRel);
  const dir = path.dirname(srcPath);
  const tmpHtml = path.join(dir, '__render_tmp.html');

  let html = fs.readFileSync(srcPath, 'utf8');
  // Inject the stub before any extension script runs.
  html = html.replace(/<script /i, `${STUB}\n  <script `);
  fs.writeFileSync(tmpHtml, html, 'utf8');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-render-'));
  try {
    execFileSync(findChrome(), [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      `--screenshot=${outPng}`,
      'file:///' + tmpHtml.replace(/\\/g, '/')
    ], { stdio: 'pipe', timeout: 60000 });
  } finally {
    fs.rmSync(tmpHtml, { force: true });
    fs.rmSync(profile, { recursive: true, force: true });
  }
  const { size } = fs.statSync(outPng);
  console.log(`${path.relative(ROOT, outPng)}  (${(size / 1024).toFixed(0)} KB)`);
}

fs.mkdirSync(OUT, { recursive: true });
renderPage('popup/popup.html',     path.join(OUT, 'screenshot-popup.png'),   400, 520);
renderPage('options/options.html', path.join(OUT, 'screenshot-options.png'), 760, 1180);
console.log('Done. Now run: python scripts/make_store_screenshots.py');
