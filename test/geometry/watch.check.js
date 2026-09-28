#!/usr/bin/env node
'use strict';
// UI professionalism pass, sweep S3: the watch page's geometry, measured in a real engine
// (jsdom cannot lay out). Against a running seeded instance, at a 390px phone and a 1440px
// desktop, in one era x mode:
//   Dean's complaint ("the notification glyph not aligned with the text"): on the channel row
//     the bell's and the pin's glyph centre-y sit within 0.5px of the Subscribed pill's LABEL
//     centre-y, and each glyph within 0.5px of its own button's centre (G2);
//   G3        the channel row's three controls share one top and one height; the action
//             bar's buttons share one top (one row) and one height, and equal widths (D4.9
//             equal columns); the stacked glyph is centred on its caption (x);
//   F21/v1.340 a toggle's WIDTH never changes with its state: Subscribe <-> Subscribed and
//             Like <-> Liked measured in both states (the stable label stack) - the lock the
//             v1.340 gate found deletable (stable-toggle-label, a risky conversion);
//   D4.9      nothing moves on subscribe: Subscribe's and the pin's boxes are identical on a
//             subscribed and an unsubscribed channel (the bell's slot is reserved, invisible);
//   D8.4      "About this file" opens to its key/value rows; the path row carries a Copy button;
//   no horizontal overflow.
// Read-only (every context from tools/capture/request-policy.js newGuardedContext).
//
//   node test/geometry/watch.check.js --base http://127.0.0.1:PORT --data DIR [--era 2021] [--mode dark]
//        [--mutate NAME]   inject one of MUTATIONS below: the run must then FAIL (the proof
//                          that each check can go red - LESSONS 2)
//
// Exit 0 = every check holds; 1 = a check failed (listed); 2 = the run itself broke.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CAP = path.resolve(__dirname, '..', '..', 'tools', 'capture');
const { newGuardedContext } = require(path.join(CAP, 'request-policy.js'));
const { playwright } = require('../visual/capture.js');

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const BASE = (arg('--base', process.env.BASE_URL || 'http://127.0.0.1:3917')).replace(/\/$/, '');
const DATA = path.resolve(arg('--data', process.env.VISUAL_DATA_DIR || path.join(os.tmpdir(), 'filetube-visual-data')));
const ERA = arg('--era', '2021');
const MODE = arg('--mode', 'dark');
const MUTATE = arg('--mutate', null);
const FX = JSON.parse(fs.readFileSync(path.join(DATA, 'fixtures.json'), 'utf8'));
const TOL = 0.5;

// Each must turn the run red (checked by hand with --mutate; the Build log records the run).
const MUTATIONS = {
  // v1.340's bell: the glyph below its row's text centre line
  'bell-low': '#notify-channel-btn .ui-btn__icon{position:relative!important;top:1px!important}',
  // the stable stack collapsed: an idle label stops holding its width (v1.340 gate r1 W1)
  'stack-collapse': '.ui-btn__stack > .ui-btn__slot[data-idle]{display:none!important}',
  // the reserved bell slot collapses: the pin moves when you subscribe
  'bell-slot-collapse': '#notify-channel-btn[data-reserved]{display:none!important}',
  // the action bar's equal columns: one column sized to content
  'bar-unequal': '#watch-actions{grid-auto-columns:auto!important}',
  // a taller pin
  'pin-tall': '#pin-channel-btn{height:36px!important}',
};

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

// Runs in the page: the numbers, rounded to 0.01px. Also toggles the two stable-width
// toggles through ui.setPressed (the writer the page uses) and restores them.
function measure() {
  const r = (el) => el.getBoundingClientRect();
  const round = (n) => Math.round(n * 100) / 100;
  const cy = (b) => b.top + b.height / 2;
  const cx = (b) => b.left + b.width / 2;
  const box = (el) => { const b = r(el); return { left: round(b.left), top: round(b.top), width: round(b.width), height: round(b.height) }; };
  const q = (s) => document.querySelector(s);
  const out = { viewportW: window.innerWidth, docW: document.documentElement.scrollWidth };
  const sub = q('#subscribe-btn-mock');
  const bell = q('#notify-channel-btn');
  const pin = q('#pin-channel-btn');
  out.channel = {
    reserved: !!(bell && bell.hasAttribute('data-reserved')),
    bellVisibility: bell ? getComputedStyle(bell).visibility : null,
    buttons: [sub, bell, pin].filter(Boolean).map((b) => ({ id: b.id, ...box(b) })),
    pin: pin ? box(pin) : null,
  };
  const label = sub && sub.querySelector('.ui-btn__label');
  const glyphs = [];
  for (const b of [bell, pin]) {
    if (!b || getComputedStyle(b).visibility === 'hidden') continue;
    const ic = r(b.querySelector('.ui-icon'));
    glyphs.push({
      id: b.id,
      vsLabel: label ? round(cy(ic) - cy(r(label))) : null,
      dx: round(cx(ic) - cx(r(b))), dy: round(cy(ic) - cy(r(b))),
    });
  }
  out.channel.glyphs = glyphs;
  // the stable-width toggles, both states
  const widths = (btn) => {
    if (!btn || !window.ui) return null;
    const was = btn.getAttribute('aria-pressed') === 'true';
    const w = {};
    for (const on of [false, true]) { window.ui.setPressed(btn, on); w[on ? 'on' : 'off'] = round(r(btn).width); }
    window.ui.setPressed(btn, was);
    return w;
  };
  out.toggles = { subscribe: widths(sub), like: widths(q('#like-media-btn')) };
  // the action bar
  out.bar = Array.from(document.querySelectorAll('#watch-actions > .ui-btn')).map((b) => {
    const ic = r(b.querySelector('.ui-icon'));
    const lab = r(b.querySelector('.ui-btn__label'));
    return { id: b.id, ...box(b), glyphDx: round(cx(ic) - cx(lab)) };
  });
  return out;
}

function check(m, label, fails) {
  const f = (msg) => fails.push(`${label}: ${msg}`);
  if (m.docW > m.viewportW) f(`horizontal overflow: document ${m.docW} > viewport ${m.viewportW}`);
  const btns = m.channel.buttons;
  if (btns.length !== 3) f(`channel row: expected Subscribe + bell + pin, found ${btns.map((b) => b.id).join(',')}`);
  if (new Set(btns.map((b) => b.top)).size !== 1) f(`G3 channel row tops differ: ${btns.map((b) => `${b.id}=${b.top}`).join(' ')}`);
  if (new Set(btns.map((b) => b.height)).size !== 1) f(`G3 channel row heights differ: ${btns.map((b) => `${b.id}=${b.height}`).join(' ')}`);
  for (const g of m.channel.glyphs) {
    if (Math.abs(g.dx) > TOL || Math.abs(g.dy) > TOL) f(`G2 ${g.id} glyph off its button's centre dx=${g.dx} dy=${g.dy}`);
    if (g.vsLabel === null || Math.abs(g.vsLabel) > TOL) f(`G2 ${g.id} glyph centre-y is ${g.vsLabel}px from the Subscribe label's`);
  }
  for (const [k, w] of Object.entries(m.toggles)) {
    if (!w) { f(`the ${k} toggle is missing`); continue; }
    if (Math.abs(w.on - w.off) > TOL) f(`F21 the ${k} toggle changes width with its state: off ${w.off} / on ${w.on}`);
  }
  if (m.bar.length < 3) f(`the action bar has ${m.bar.length} buttons (expected Like, Listen and More at least)`);
  if (new Set(m.bar.map((b) => b.top)).size !== 1) f('G3 the action bar wraps (tops differ)');
  if (new Set(m.bar.map((b) => b.height)).size !== 1) f('G3 the action bar heights differ');
  if (Math.max(...m.bar.map((b) => b.width)) - Math.min(...m.bar.map((b) => b.width)) > TOL) f(`D4.9 unequal columns: ${m.bar.map((b) => b.width).join(', ')}`);
  for (const b of m.bar) if (Math.abs(b.glyphDx) > TOL) f(`G2 ${b.id} glyph ${b.glyphDx}px off its caption's centre`);
}

(async () => {
  const pw = playwright();
  const record = { blockedRequests: [], blockedExpected: [] };
  const browser = await pw.chromium.launch();
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
      const ctx = await newGuardedContext(browser, { ...opts, storageState, reducedMotion: 'reduce' }, record, { scene: 'watch-geometry', vp });
      await ctx.addInitScript(([m, e]) => { try { localStorage.setItem('ft-era', e); localStorage.setItem('ft-mode', m); } catch (_) { /* storage off */ } }, [MODE, ERA]);
      const errs = [];
      const open = async (id, ready) => {
        const page = await ctx.newPage();
        page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
        await page.goto(BASE + '/watch.html?v=' + id, { waitUntil: 'networkidle' });
        await page.waitForSelector(ready, { state: 'attached', timeout: 12000 });
        if (MUTATE) await page.addStyleTag({ content: MUTATIONS[MUTATE] });
        await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true));
        return page;
      };
      const subPage = await open(FX.video, '#notify-channel-btn:not([data-reserved])');
      await subPage.waitForSelector('#watch-actions:not([data-loading]) #more-actions-btn');
      const sub = await subPage.evaluate(measure);
      check(sub, `${vp} subscribed`, fails);
      if (sub.channel.reserved) fails.push(`${vp}: the subscribed channel's bell is reserved (not live)`);
      // D8.4: About this file opens to its rows; the path row has its Copy button
      await subPage.click('#about-file-toggle');
      const about = await subPage.evaluate(() => {
        const body = document.getElementById('about-file-body');
        const path = document.getElementById('file-path-text');
        return {
          expanded: document.getElementById('about-file-toggle').getAttribute('aria-expanded'),
          shown: !!body && !body.hidden && body.getBoundingClientRect().height > 0,
          rows: body ? body.querySelectorAll('.ui-row').length : 0,
          copy: !!(path && path.closest('.ui-row').querySelector('.ui-btn[aria-label="Copy the file path"]')),
          mono: path ? getComputedStyle(path).fontFamily.includes('mono') : null,
        };
      });
      if (about.expanded !== 'true' || !about.shown || about.rows < 3 || !about.copy || about.mono) fails.push(`${vp}: About this file ${JSON.stringify(about)}`);
      const unsubPage = await open(FX.videoUnsub, '#notify-channel-btn[data-reserved]');
      const unsub = await unsubPage.evaluate(measure);
      check(unsub, `${vp} unsubscribed`, fails);
      if (!unsub.channel.reserved || unsub.channel.bellVisibility !== 'hidden') fails.push(`${vp}: the unsubscribed bell slot is not reserved-and-invisible (${unsub.channel.reserved}, ${unsub.channel.bellVisibility})`);
      // the row's controls hold their places across the two states (the row is end-aligned, so
      // a collapsed bell slot would move Subscribe, and a moved bell would move the pin)
      for (const id of ['subscribe-btn-mock', 'pin-channel-btn']) {
        const a = sub.channel.buttons.find((b) => b.id === id);
        const b = unsub.channel.buttons.find((x) => x.id === id);
        if (!a || !b || Math.abs(a.left - b.left) > TOL || Math.abs(a.width - b.width) > TOL) {
          fails.push(`${vp}: D4.9 ${id} moves with the subscription: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
        }
      }
      if (errs.length) fails.push(`${vp}: page errors ${errs.join(' | ')}`);
      report[vp] = { subscribed: sub, unsubscribed: unsub, about };
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ era: ERA, mode: MODE, mutate: MUTATE, report, unexpectedBlocked: record.blockedRequests.length }, null, 1));
  if (fails.length) {
    console.error(`watch.check: ${fails.length} failure(s)\n  ${fails.join('\n  ')}`);
    process.exit(1);
  }
  console.error('watch.check: every check holds');
})().catch((e) => { console.error('watch.check: run broke:', e); process.exit(2); });
