#!/usr/bin/env node
'use strict';
// HDK (v1.376.0 W4, Dean's ruling R4): the handoff card ("Listening on <device> / Continue here") never
// covers the mini player. Measured in headless Chromium against the seeded fixture server:
//   phone (html.is-phone) at 390 and 320 wide: with no mini player the card is the full card; with the
//     mini player showing it is a ONE-LINE bar (cover, headline, Continue here, dismiss on one row, at
//     most 56px tall) whose bottom sits at least 4px above the dock's top and at or above the bottom nav,
//     never intersecting the dock; every control of both (the card's cover, Continue here and dismiss;
//     the dock's picture, play / pause and close) is the element under its own centre (elementFromPoint).
//     The CLEAR axis, from that populated state: a real tap on the dock's close returns the card to the
//     full card's exact box and drops html.has-player-dock; a second dock, then a real tap on the dock
//     (back to the watch page), drops it too.
//   desktop 1440: the card's box with the dock showing is the SAME box as without it (desktop unchanged),
//     and the two never meet.
// The card's data is the fixture's /api/handoff answered by page.route (the geometry only: the real
// driver, another device's /api/progress -> /api/handoff -> the card, was proven against the real server
// in the v1.376.0 build). Nothing reaches the server: every context is a newGuardedContext.
//
// Wired into test/geometry/run.js (full runs and --mutants: each mutant below must turn it red).
// Standalone, against a running seeded server:
//   node test/geometry/handoff-dock.js --base http://127.0.0.1:PORT --data DIR [--mutate NAME]
const path = require('node:path');
const capture = require('../visual/capture.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP_MIN = 4; // the rule's gap is --space-4 (8px); 4 leaves room for rounding, never for an overlap
const BAR_MAX_H = 56; // one row: the cover (16:9 at --av-lg) and a small button, plus the bar's padding

// Each must turn HDK red (run.js --mutants). css: injected after load; js: player.js served rewritten.
const MUTANTS = {
  // the stacking dropped: the bar sits on the dock's row again
  'hdk-stack-off': { css: 'html.is-phone.has-player-dock #handoff-card{bottom:calc(var(--mobile-bottom-nav-h) + var(--space-4))!important}' },
  // the one-line form dropped: the stacked card lays its parts out as a column again
  'hdk-compact-off': { css: 'html.is-phone.has-player-dock #handoff-card{flex-direction:column!important}' },
  // the desktop card follows the dock signal (desktop must be unchanged)
  'hdk-desktop-follows': { css: 'html.has-player-dock #handoff-card{padding:2px!important}' },
  // the clear axis: the signal is set on a show and never cleared on an exit
  'hdk-clear-off': { js: { needle: 'root.classList.toggle(DOCK_SHOWN_CLASS, !!shown);', replace: 'if (shown) root.classList.add(DOCK_SHOWN_CLASS);' } },
  // the height never measured: the bar stacks above a zero-height dock
  'hdk-height-off': { js: { needle: "root.style.setProperty(DOCK_HEIGHT_PROP, Math.ceil(h) + 'px');", replace: "root.style.setProperty(DOCK_HEIGHT_PROP, '0px');" } },
};

const CASES = [
  { id: 'phone-390', vp: 'phone', w: 390, h: 844 },
  { id: 'phone-320', vp: 'phone', w: 320, h: 568 },
  { id: 'desktop-1440', vp: 'desktop', w: 1440, h: 900 },
];

function presence(FX) {
  const id = FX.videoUnsub;
  return { deviceId: 'geometry-mac', deviceLabel: 'Work MacBook Air', kind: 'media', mediaId: id, state: 'playing', position: 66,
    ageSeconds: 2, title: 'A video on the Mac', subtitle: 'Northbound Field Notes', thumbnailUrl: '/thumbnail/' + encodeURIComponent(id),
    href: '/watch.html?v=' + encodeURIComponent(id), listen: true, duration: 480 };
}

// In-page: boxes, the one-row read and the hit tests.
function measureIn() {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
  const card = document.getElementById('handoff-card');
  const dock = document.getElementById('player-dock');
  const shown = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
  const hit = (el) => {
    if (!shown(el)) return null;
    const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!t && (t === el || el.contains(t));
  };
  const q = (sel) => document.querySelector(sel);
  const parts = card ? {
    cover: q('#handoff-card .handoff-cover'), headline: q('#handoff-card .handoff-headline'),
    go: q('#handoff-card .ui-btn--primary'), dismiss: q('#handoff-card .handoff-head .ui-btn'),
  } : {};
  const mids = Object.fromEntries(Object.entries(parts).map(([k, el]) => [k, shown(el) ? (() => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; })() : null]));
  const nav = q('.bottom-nav');
  return {
    cls: document.documentElement.classList.contains('has-player-dock'),
    cardShown: shown(card), dockShown: shown(dock),
    card: box(card), dock: shown(dock) ? box(dock) : null, nav: shown(nav) ? box(nav) : null, mids,
    hits: {
      cover: hit(parts.cover), go: hit(parts.go), dismiss: hit(parts.dismiss),
      dockPicture: hit(q('#player-dock #media-player')), dockPlay: hit(q('#player-dock #pp-btn')), dockClose: hit(q('#player-dock .player-dock-close')),
    },
    state: window.FileTube && window.FileTube.player && window.FileTube.player.getState(),
  };
}

const intersects = (a, b) => !!a && !!b && Math.min(a.r, b.r) - Math.max(a.x, b.x) > 0.5 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 0.5;
const fmt = (b) => (b ? `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}` : 'none');
const sameBox = (a, b) => !!a && !!b && ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) <= 0.5);

async function waitCard(page) {
  await page.waitForFunction(() => { const c = document.getElementById('handoff-card'); return c && !c.hidden; }, null, { timeout: 10000 });
  await sleep(150);
}
async function dockFromWatch(page, base, FX) {
  await page.evaluate((u) => window.FileTube.navigate(u), '/watch.html?v=' + encodeURIComponent(FX.video));
  await page.waitForFunction(() => window.FileTube.player && window.FileTube.player.currentId && window.FileTube.player.getState() === 'full', null, { timeout: 12000 });
  await page.evaluate(() => window.FileTube.navigate('/'));
  await page.waitForFunction(() => location.pathname === '/' && window.FileTube.player.getState() === 'docked', null, { timeout: 12000 });
  // the controller's own re-poll path (a visible tab polls on visibilitychange)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await waitCard(page);
  await sleep(300);
}
async function tapCentre(page, vp, sel) {
  const c = await page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  if (vp === 'phone') await page.touchscreen.tap(c.x, c.y); else await page.mouse.click(c.x, c.y);
}

async function runCase(env, cs, mutant) {
  const failures = [];
  const measured = [];
  const record = capture.newRecord(env.base);
  const { ctx, page } = await capture.newScenePage(env.browser, { vp: cs.vp, mode: 'light', era: '2021', storageState: env.st,
    tag: { scene: 'geometry:hdk-' + cs.id }, record, dpr: 1 });
  try {
    await page.setViewportSize({ width: cs.w, height: cs.h });
    const pres = presence(env.FX);
    await page.route('**/api/handoff?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ presence: pres }) }));
    if (mutant && mutant.js) {
      await page.route('**/js/player.js*', async (route) => {
        const resp = await route.fetch();
        const src = await resp.text();
        if (!src.includes(mutant.js.needle)) throw new Error('HDK mutant: the needle is not in player.js: ' + mutant.js.needle);
        await route.fulfill({ response: resp, body: src.replace(mutant.js.needle, mutant.js.replace) });
      });
    }
    await page.goto(env.base + '/', { waitUntil: 'networkidle', timeout: 20000 });
    await page.addStyleTag({ content: capture.FREEZE_CSS + ((mutant && mutant.css) || '') });
    await waitCard(page);
    const full = await page.evaluate(measureIn);
    const phone = cs.vp === 'phone';
    const isPhone = await page.evaluate(() => document.documentElement.classList.contains('is-phone'));
    if (isPhone !== phone) failures.push(`VACUOUS: html.is-phone is ${isPhone} on ${cs.id}`);
    if (!full.cardShown) failures.push('VACUOUS: the card never showed');

    await dockFromWatch(page, env.base, env.FX);
    const st = await page.evaluate(measureIn);
    measured.push(`full ${fmt(full.card)}; docked card ${fmt(st.card)} dock ${fmt(st.dock)}`);
    if (!st.dockShown || st.state !== 'docked') failures.push(`VACUOUS: the mini player is not showing (state ${st.state})`);
    if (!st.cardShown) failures.push('VACUOUS: the card hid when the dock showed');
    if (!st.cls) failures.push('html.has-player-dock is missing while the mini player shows');
    if (intersects(st.card, st.dock)) failures.push(`the card ${fmt(st.card)} overlaps the mini player ${fmt(st.dock)}`);
    for (const [k, ok] of Object.entries(st.hits)) if (ok === false) failures.push(`${k} is covered: elementFromPoint at its centre is not it`);
    for (const k of ['cover', 'go', 'dismiss', 'dockPicture', 'dockPlay', 'dockClose']) if (st.hits[k] == null) failures.push(`VACUOUS: ${k} is not showing`);
    if (phone) {
      if (st.card && st.dock && st.dock.y - st.card.b < GAP_MIN) failures.push(`the bar's bottom ${st.card.b.toFixed(1)} is not ${GAP_MIN}px above the dock's top ${st.dock.y.toFixed(1)}`);
      if (st.card && st.nav && st.card.b > st.nav.y + 0.5) failures.push('the bar reaches into the bottom nav');
      if (st.card && st.card.h > BAR_MAX_H) failures.push(`the stacked card is ${st.card.h.toFixed(1)}px tall, not one line (max ${BAR_MAX_H})`);
      const ys = Object.values(st.mids).filter((v) => v != null);
      if (ys.length !== 4) failures.push(`VACUOUS: ${ys.length} of the bar's 4 parts showing (cover, headline, Continue here, dismiss)`);
      else if (Math.max(...ys) - Math.min(...ys) > 3) failures.push(`the bar's parts are not on one row (centres ${ys.map((v) => v.toFixed(1)).join(', ')})`);
    } else if (!sameBox(st.card, full.card)) {
      failures.push(`desktop changed: the card is ${fmt(st.card)} with the dock, ${fmt(full.card)} without`);
    }

    // CLEAR axis 1, from the populated state: the dock's close (a real tap at its centre).
    await tapCentre(page, cs.vp, '#player-dock .player-dock-close');
    await page.waitForFunction(() => window.FileTube.player.getState() === 'closed', null, { timeout: 8000 }).catch(() => {});
    await sleep(300);
    const closed = await page.evaluate(measureIn);
    measured.push(`after close ${fmt(closed.card)}`);
    if (closed.state !== 'closed') failures.push(`VACUOUS: the dock's close did not close the player (state ${closed.state})`);
    if (closed.cls) failures.push('html.has-player-dock survived the mini player\'s close');
    if (!sameBox(closed.card, full.card)) failures.push(`after the close the card is ${fmt(closed.card)}, not the full card ${fmt(full.card)}`);

    // CLEAR axis 2: dock again, then a real tap on the dock returns to the watch page (an expand).
    await dockFromWatch(page, env.base, env.FX);
    const again = await page.evaluate(measureIn);
    if (!again.cls) failures.push('html.has-player-dock missing on the second dock');
    await tapCentre(page, cs.vp, '#player-dock #media-player');
    await page.waitForFunction(() => window.FileTube.player.getState() === 'full', null, { timeout: 12000 }).catch(() => {});
    await sleep(300);
    const expanded = await page.evaluate(measureIn);
    if (expanded.state !== 'full') failures.push(`VACUOUS: the dock tap did not expand the player (state ${expanded.state})`);
    if (expanded.cls) failures.push('html.has-player-dock survived the expand back to the watch page');
  } catch (e) {
    failures.push(`the check did not run: ${String(e).split('\n')[0]}`);
  } finally {
    await ctx.close();
  }
  return { id: `HDK/${cs.id}`, measured: `(${measured.join('; ')})`, failures };
}

async function run(env, opts = {}) {
  const mutant = opts.mutate ? MUTANTS[opts.mutate] : null;
  if (opts.mutate && !mutant) throw new Error('HDK: unknown mutant ' + opts.mutate);
  const out = [];
  for (const cs of CASES) out.push(await runCase(env, cs, mutant));
  return out;
}

module.exports = { run, MUTANTS, CASES };

if (require.main === module) {
  const args = process.argv.slice(2);
  const arg = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
  const base = arg('--base', process.env.BASE_URL || 'http://127.0.0.1:3917').replace(/\/$/, '');
  const data = path.resolve(arg('--data', process.env.VISUAL_DATA_DIR || ''));
  (async () => {
    const pw = capture.playwright();
    const FX = capture.readFixtures(data);
    const browser = await pw.chromium.launch({ args: capture.LAUNCH_ARGS });
    try {
      const record = capture.newRecord(base);
      const st = await capture.login(browser, base, FX, record);
      const res = await run({ browser, st, base, FX }, { mutate: arg('--mutate', null) });
      for (const r of res) console.log(`${r.failures.length ? 'FAIL' : 'ok  '} ${r.id} ${r.measured}${r.failures.map((f) => '\n     ' + f).join('')}`);
      process.exitCode = res.some((r) => r.failures.length) ? 1 : 0;
    } finally { await browser.close(); }
  })().catch((e) => { console.error(e); process.exitCode = 2; });
}
