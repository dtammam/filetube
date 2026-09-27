#!/usr/bin/env node
'use strict';
// UI professionalism pass, AC7 (app-contained): the Playwright half of the
// native-interaction policy (plan D6). jsdom cannot compute the cascade; a real
// engine can. Against a running instance this reads, in a desktop and a phone
// context:
//   - computed user-select is `none` on 20 chrome elements across index, watch,
//     Subscriptions and Settings (and the tap highlight is transparent);
//   - computed user-select is `text` on the inputs, textareas and selects there;
//   - the viewport meta each page ends up with (zoom locked; read.html is the
//     listed exception, not sampled here).
// It is self-contained (no shared runner) and read-only (every context comes from
// tools/capture/request-policy.js newGuardedContext).
//
//   node test/visual/seed.js --data DIR
//   test/visual/start-server.sh DIR PORT &
//   node test/geometry/native-interaction.check.js --base http://127.0.0.1:PORT [--data DIR]
//
// Needs Playwright from tools/capture (cd tools/capture && npm install && npx
// playwright install chromium). The login comes from the seeded dir's fixtures.json
// (--data, else $VISUAL_DATA_DIR, else <tmpdir>/filetube-visual-data), or --user/--pass.
// Exit 0 = every sample holds; 1 = a sample failed (listed); 2 = the run itself broke.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CAP = path.resolve(__dirname, '..', '..', 'tools', 'capture');
const { chromium } = require(path.join(CAP, 'node_modules', 'playwright'));
const { newGuardedContext } = require(path.join(CAP, 'request-policy.js'));

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const BASE = (arg('--base', process.env.BASE_URL || 'http://127.0.0.1:3917')).replace(/\/$/, '');
const DATA = path.resolve(arg('--data', process.env.VISUAL_DATA_DIR || path.join(os.tmpdir(), 'filetube-visual-data')));
let USER = arg('--user', null);
let PASS = arg('--pass', null);
let FX = {};
if (!USER || !PASS) {
  FX = JSON.parse(fs.readFileSync(path.join(DATA, 'fixtures.json'), 'utf8'));
  USER = FX.user; PASS = FX.password;
}

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CONTEXTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IOS_UA },
};
const LOCKED_VIEWPORT = 'width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no';

// [page path, wait-for selector, chrome samples (20 across the four pages), field samples]
const PAGES = [
  ['/', '.video-card', [
    '.logo', '.sidebar-item', '#search-btn', '#notif-bell-btn', '#queue-btn',
    '.section-title', '.video-card', '.video-card .video-title', '.video-card img',
  ], ['#search-input']],
  ['/watch.html?v=' + (FX.video || ''), '#media-title', [
    '#media-title', '#media-player', '#more-actions-btn', '.pc-time', '.pc-btn',
  ], ['#new-comment-text', '#search-input']],
  ['/subscriptions', '.sub-row-kebab', [
    '.sub-row-kebab', '.sub-row', '.sub-pill',
  ], ['#search-input']],
  ['/setup.html', '.setup-select', [
    '.setup-subhead', '.setup-check-label', '.md-row',
  ], ['.setup-select', '#search-input']],
];

async function login(browser, record) {
  const ctx = await newGuardedContext(browser, {}, record, { scene: 'login' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#login-username, input[name="username"], input[type="text"]', USER);
  await page.fill('#login-password, input[name="password"], input[type="password"]', PASS);
  await page.click('button[type="submit"], .login-submit');
  await page.waitForURL((u) => !String(u).includes('login'), { timeout: 10000 });
  const st = await ctx.storageState();
  await ctx.close();
  return st;
}

function readSample(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { tag: el.tagName.toLowerCase(), userSelect: cs.userSelect || cs.webkitUserSelect, tap: cs.webkitTapHighlightColor || '' };
  }, sel);
}

(async () => {
  const record = { captured: [], failed: [], blockedRequests: [], blockedExpected: [], imageWait: [], rotation: [] };
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
  const failures = [];
  const rows = [];
  try {
    const st = await login(browser, record);
    for (const [ctxName, opts] of Object.entries(CONTEXTS)) {
      let chrome = 0;
      let fields = 0;
      for (const [url, waitSel, chromeSels, fieldSels] of PAGES) {
        const ctx = await newGuardedContext(browser, { ...opts, storageState: st, reducedMotion: 'reduce' }, record, { scene: 'native-interaction' });
        const page = await ctx.newPage();
        await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 20000 });
        await page.waitForSelector(waitSel, { state: 'attached', timeout: 12000 });
        const meta = await page.evaluate(() => { const m = document.querySelector('meta[name="viewport"]'); return m ? m.getAttribute('content') : null; });
        if (meta !== LOCKED_VIEWPORT) failures.push(`${ctxName} ${url}: viewport "${meta}"`);
        for (const sel of chromeSels) {
          const s = await readSample(page, sel);
          chrome++;
          rows.push(`${ctxName}\t${url.split('?')[0]}\tchrome\t${sel}\t${s ? s.tag + ' user-select=' + s.userSelect + ' tap=' + s.tap : 'MISSING'}`);
          if (!s) failures.push(`${ctxName} ${url}: ${sel} not found`);
          else {
            if (s.userSelect !== 'none') failures.push(`${ctxName} ${url}: ${sel} user-select=${s.userSelect} (want none)`);
            if (s.tap && s.tap !== 'rgba(0, 0, 0, 0)' && s.tap !== 'transparent') failures.push(`${ctxName} ${url}: ${sel} tap highlight ${s.tap}`);
          }
        }
        for (const sel of fieldSels) {
          const s = await readSample(page, sel);
          fields++;
          rows.push(`${ctxName}\t${url.split('?')[0]}\tfield\t${sel}\t${s ? s.tag + ' user-select=' + s.userSelect : 'MISSING'}`);
          if (!s) failures.push(`${ctxName} ${url}: field ${sel} not found`);
          else if (s.userSelect !== 'text') failures.push(`${ctxName} ${url}: field ${sel} user-select=${s.userSelect} (want text)`);
        }
        await ctx.close();
      }
      if (chrome !== 20) failures.push(`${ctxName}: sampled ${chrome} chrome elements, the check promises 20`);
      rows.push(`${ctxName}: ${chrome} chrome samples, ${fields} field samples`);
    }
  } finally {
    await browser.close();
  }
  console.log(rows.join('\n'));
  if (record.blockedRequests.length) failures.push(`unexpected blocked requests: ${record.blockedRequests.length}`);
  if (failures.length) {
    console.log(`\nnative-interaction: FAIL (${failures.length})\n  ` + failures.join('\n  '));
    process.exit(1);
  }
  console.log('\nnative-interaction: PASS');
})().catch((e) => { console.error(e); process.exit(2); });
