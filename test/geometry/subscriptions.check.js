#!/usr/bin/env node
'use strict';
// UI professionalism pass, sweep S5: the Subscriptions page's geometry, measured in a
// real engine (jsdom cannot lay out). Against a running seeded instance it checks, at a
// 390px phone and a 1440px desktop:
//   G1 (AC5)  every channel row's slot x-offsets (media, body, each of the three trailing
//             slots) are identical across rows - pinned and unpinned, errored and ok;
//   G2 (AC4)  every row control's glyph centre is within 0.5px of its button's centre,
//             and the toolbar primary's glyph centre-y within 0.5px of its label's;
//   G3 (AC3)  the toolbar's buttons share one top (one line at 390px) and one height;
//   F62       the same measurements after an in-app round trip Home -> Subscriptions ->
//             Home -> Subscriptions through the SPA router (only #view-root is swapped,
//             so a style the view needs must live in a global sheet), and no <style>
//             ever appears in #view-root.
// Read-only (every context from tools/capture/request-policy.js newGuardedContext).
//
//   node test/visual/seed.js --data DIR
//   test/visual/start-server.sh DIR PORT &
//   node test/geometry/subscriptions.check.js --base http://127.0.0.1:PORT [--data DIR] [--era 2021]
//
// Exit 0 = every check holds; 1 = a check failed (listed); 2 = the run itself broke.
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
const ERA = arg('--era', '2021');
const MODE = arg('--mode', 'dark');
const FX = JSON.parse(fs.readFileSync(path.join(DATA, 'fixtures.json'), 'utf8'));
const TOL = 0.5;

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

// Runs in the page: every number the checks need, rounded to 0.01px.
function measure() {
  const r = (el) => el.getBoundingClientRect();
  const round = (n) => Math.round(n * 100) / 100;
  const cy = (b) => b.top + b.height / 2;
  const cx = (b) => b.left + b.width / 2;
  const rows = Array.from(document.querySelectorAll('.ui-row[data-sub-id]')).map((row) => ({
    id: row.getAttribute('data-sub-id'),
    pinned: !!row.querySelector('.subs-pin[aria-pressed="true"]'),
    error: !!row.querySelector('.subs-meta[data-tone="error"]'),
    media: round(r(row.querySelector('.ui-row__media')).left),
    body: round(r(row.querySelector('.ui-row__body')).left),
    actions: Array.from(row.querySelector('.ui-row__actions').children).map((c) => round(r(c).left)),
  }));
  const toolbar = Array.from(document.querySelectorAll('.subs-toolbar > .ui-btn')).map((b) => ({
    label: b.textContent.trim(), top: round(r(b).top), height: round(r(b).height), right: round(r(b).right),
  }));
  const centres = [];
  document.querySelectorAll('.ui-row[data-sub-id] .ui-btn--icon').forEach((b) => {
    const ic = r(b.querySelector('.ui-icon'));
    const br = r(b);
    centres.push({ what: b.className.split(' ').pop(), dx: round(cx(ic) - cx(br)), dy: round(cy(ic) - cy(br)) });
  });
  document.querySelectorAll('.subs-toolbar > .ui-btn').forEach((b) => {
    const ic = b.querySelector('.ui-icon');
    const lab = b.querySelector('.ui-btn__label');
    if (ic && lab) centres.push({ what: 'toolbar:' + lab.textContent, dx: 0, dy: round(cy(r(ic)) - cy(r(lab))) });
  });
  return {
    rows, toolbar, centres,
    viewportW: window.innerWidth,
    docW: document.documentElement.scrollWidth,
    viewStyleTags: document.querySelectorAll('#view-root style').length,
    toolbarDisplay: getComputedStyle(document.querySelector('.subs-toolbar')).display,
  };
}

function check(m, label, fails) {
  const f = (msg) => fails.push(`${label}: ${msg}`);
  if (m.rows.length < 2) f(`expected the seeded rows, found ${m.rows.length}`);
  if (!m.rows.some((x) => x.pinned) || !m.rows.some((x) => !x.pinned)) f('the fixture needs a pinned and an unpinned row');
  if (!m.rows.some((x) => x.error) || !m.rows.some((x) => !x.error)) f('the fixture needs an errored and an ok row');
  const ref = m.rows[0];
  for (const row of m.rows) {
    for (const k of ['media', 'body']) if (Math.abs(row[k] - ref[k]) > TOL) f(`G1 ${row.id} ${k} ${row[k]} != ${ref[k]}`);
    if (row.actions.length !== 3) f(`G1 ${row.id} has ${row.actions.length} trailing slots, not 3`);
    row.actions.forEach((x, i) => { if (Math.abs(x - ref.actions[i]) > TOL) f(`G1 ${row.id} slot ${i} ${x} != ${ref.actions[i]}`); });
  }
  for (const c of m.centres) {
    if (Math.abs(c.dx) > TOL || Math.abs(c.dy) > TOL) f(`G2 ${c.what} glyph off-centre dx=${c.dx} dy=${c.dy}`);
  }
  const tops = new Set(m.toolbar.map((b) => b.top));
  const heights = new Set(m.toolbar.map((b) => b.height));
  if (m.toolbar.length !== 4) f(`G3 expected 4 toolbar buttons, found ${m.toolbar.length}`);
  if (tops.size !== 1) f(`G3 the toolbar wraps: tops ${[...tops].join(', ')}`);
  if (heights.size !== 1) f(`G3 unequal toolbar heights ${[...heights].join(', ')}`);
  if (m.toolbar.some((b) => b.right > m.viewportW)) f('G3 a toolbar button overflows the viewport');
  if (m.docW > m.viewportW) f(`no horizontal overflow: document ${m.docW} > viewport ${m.viewportW}`);
  if (m.viewStyleTags !== 0) f('F62 a <style> sits inside #view-root');
  if (m.toolbarDisplay !== 'flex') f(`F62 the toolbar lost its global style (display ${m.toolbarDisplay})`);
}

(async () => {
  const record = { blockedRequests: [], blockedExpected: [] };
  const browser = await chromium.launch();
  const fails = [];
  const report = {};
  try {
    const loginCtx = await newGuardedContext(browser, {}, record, { scene: 'login' });
    const lp = await loginCtx.newPage();
    await lp.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await lp.fill('#login-username, input[name="username"], input[type="text"]', FX.user);
    await lp.fill('#login-password, input[name="password"], input[type="password"]', FX.password);
    await lp.click('button[type="submit"], .login-submit');
    await lp.waitForURL((u) => !String(u).includes('login'), { timeout: 10000 });
    const storageState = await loginCtx.storageState();
    await loginCtx.close();

    for (const [vp, opts] of Object.entries(VIEWPORTS)) {
      const ctx = await newGuardedContext(browser, { ...opts, storageState, reducedMotion: 'reduce' }, record, { scene: 'subs-geometry', vp });
      await ctx.addInitScript(([m, e]) => { try { localStorage.setItem('ft-era', e); localStorage.setItem('ft-mode', m); } catch (_) { /* storage off */ } }, [MODE, ERA]);
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
      await page.goto(BASE + '/subscriptions', { waitUntil: 'networkidle' });
      await page.waitForSelector('.subs-more', { timeout: 12000 });
      const hard = await page.evaluate(measure);
      check(hard, `${vp} hard load`, fails);
      for (const to of ['/', '/subscriptions', '/', '/subscriptions']) {
        await page.evaluate((u) => window.FileTube.navigate(u), to);
        await page.waitForSelector(to === '/' ? '.video-card' : '.subs-more', { timeout: 12000 });
      }
      const spa = await page.evaluate(measure);
      check(spa, `${vp} after SPA round trip`, fails);
      if (JSON.stringify(spa) !== JSON.stringify(hard)) fails.push(`${vp}: F62 the page measures differently after the SPA round trip`);
      if (errs.length) fails.push(`${vp}: page errors ${errs.join(' | ')}`);
      report[vp] = { hard, spaIdentical: JSON.stringify(spa) === JSON.stringify(hard) };
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ era: ERA, mode: MODE, report, unexpectedBlocked: record.blockedRequests.length }, null, 1));
  if (fails.length) {
    console.error(`subscriptions.check: ${fails.length} failure(s)\n  ${fails.join('\n  ')}`);
    process.exit(1);
  }
  console.error('subscriptions.check: every check holds');
})().catch((e) => { console.error('subscriptions.check: run broke:', e); process.exit(2); });
