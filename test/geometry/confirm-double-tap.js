#!/usr/bin/env node
'use strict';
// DBLTAP (gate r1, adversary 1 CRITICAL): the second tap of a double-tap must never answer
// the ui.confirm the first tap opened. Measured in headless Chromium against the seeded
// fixture server, with REAL input at SCREEN POSITIONS (page.touchscreen.tap on the phone,
// page.mouse.click on the desktop; never element.click()):
//   1. open Stats > Videos and audio and read where the delete confirm's OK button sits
//      (one confirm opened and closed with Esc, which the guard does not gate);
//   2. for each gap: tap a row's delete button, then tap the OK button's centre `gap` ms
//      later. At 60/180/300ms no non-GET request may leave the page and the dialog stays
//      up; at 700ms exactly one DELETE /api/videos/<that row's id> leaves.
// Anti-vacuity: the page records both taps' pointerdown timeStamps; an early gap that
// really landed at >= ui.ACTIVATION_GUARD_MS (a starved CPU) or a tap the OK never received
// is VACUOUS, which fails the run, never passes it.
// Nothing reaches the server: every context is a newGuardedContext (tools/capture/request-
// policy.js), which fulfils each mutating request with an empty 200 and records it. This
// check reads its OWN record, so its intended DELETEs are not the REQUEST-POLICY alarm.
//
// Wired into test/geometry/run.js (every run, --fast included, and --mutants: the guard
// mutated away, by serving ui.js with ACTIVATION_GUARD_MS = 0, must turn it red).
// Standalone, against a running seeded server:
//   node test/geometry/confirm-double-tap.js --base http://127.0.0.1:PORT --data DIR [--mutate-guard]
const path = require('node:path');
const capture = require('../visual/capture.js');

const EARLY_GAPS = [60, 180, 300];
const LATE_GAP = 700;
const GUARD_MS = 450; // public/js/ui.js ACTIVATION_GUARD_MS; the page's own value is read back and must match
const VIEWPORTS = ['phone', 'desktop'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Serves ui.js with the guard constant at 0 (the mutant). Fails loudly if the needle moved.
async function mutateGuard(page) {
  await page.route('**/js/ui.js', async (route) => {
    const resp = await route.fetch();
    const src = await resp.text();
    const needle = 'var ACTIVATION_GUARD_MS = 450;';
    if (!src.includes(needle)) throw new Error('DBLTAP mutant: the ACTIVATION_GUARD_MS needle is not in ui.js');
    await route.fulfill({ response: resp, body: src.replace(needle, 'var ACTIVATION_GUARD_MS = 0;') });
  });
}

async function tapAt(page, vp, x, y) {
  if (vp === 'phone') await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

const rectOf = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}, sel);
const OK_SEL = '.ui-sheet--dialog:not(.is-closing) .ui-confirm__actions .ui-btn:last-child';
const dialogOpen = (page) => page.evaluate(() => !!document.querySelector('.ui-sheet--dialog:not(.is-closing)'));
const mutating = (rec) => rec.blockedRequests.filter((b) => b.method !== 'GET');

async function closeDialog(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.ui-sheet'), null, { timeout: 5000 });
}

// One viewport: returns { id, measured, failures }.
async function runViewport(env, vp, opts) {
  const record = capture.newRecord(env.base);
  const { ctx, page } = await capture.newScenePage(env.browser, { vp, mode: 'dark', era: '2021', storageState: env.st,
    tag: { scene: 'geometry:dbltap-' + vp, rm: 'no-preference' }, record, dpr: 1 });
  const failures = [];
  const measured = [];
  try {
    if (opts.mutateGuard) await mutateGuard(page);
    await page.goto(env.base + '/stats.html', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForSelector('.md-row[data-md-target="videos-audio"]', { state: 'attached', timeout: 12000 });
    await page.evaluate(() => document.querySelector('.md-row[data-md-target="videos-audio"]').click());
    await page.waitForSelector('#stats-av-list .stats-delete-btn', { timeout: 12000 });
    const guard = await page.evaluate(() => window.ui && window.ui.ACTIVATION_GUARD_MS);
    if (!opts.mutateGuard && guard !== GUARD_MS) failures.push(`the page's ui.ACTIVATION_GUARD_MS is ${guard}, this check expects ${GUARD_MS}`);
    // Every pointerdown's timeStamp and target, for the anti-vacuity reads.
    await page.evaluate(() => {
      window.__dbl = [];
      document.addEventListener('pointerdown', (e) => {
        const t = e.target;
        window.__dbl.push({ ts: e.timeStamp, ok: !!(t && t.closest && t.closest('.ui-confirm__actions .ui-btn:last-child')) });
      }, true);
    });
    const rows = await page.evaluate(() => document.querySelectorAll('#stats-av-list .stats-delete-btn').length);
    if (rows < EARLY_GAPS.length + 1) throw new Error(`only ${rows} delete buttons; the check needs ${EARLY_GAPS.length + 1}`);

    // Where the OK sits (the dialog is centred: one read serves every gap).
    await page.evaluate(() => document.querySelector('#stats-av-list .stats-delete-btn').click());
    await page.waitForSelector(OK_SEL, { timeout: 5000 });
    await sleep(600);
    const ok = await rectOf(page, OK_SEL);
    await closeDialog(page);
    record.blockedRequests.length = 0;

    for (const [i, gap] of [...EARLY_GAPS, LATE_GAP].entries()) {
      const late = gap === LATE_GAP;
      // The trigger: row i's delete button, scrolled into view.
      const trig = await page.evaluate((k) => {
        const b = document.querySelectorAll('#stats-av-list .stats-delete-btn')[k];
        b.scrollIntoView({ block: 'center' });
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, label: b.getAttribute('aria-label') };
      }, i);
      await sleep(250);
      await page.evaluate(() => { window.__dbl.length = 0; });
      const t0 = Date.now();
      await tapAt(page, vp, trig.x, trig.y);
      const wait = gap - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      await tapAt(page, vp, ok.x, ok.y);
      await sleep(900);
      const downs = await page.evaluate(() => window.__dbl.slice());
      const realGap = downs.length >= 2 ? Math.round(downs[downs.length - 1].ts - downs[0].ts) : null;
      const onOk = downs.length >= 2 && downs[downs.length - 1].ok;
      const sent = mutating(record).map((b) => `${b.method} ${new URL(b.url).pathname}`);
      const open = await dialogOpen(page);
      measured.push(`${gap}ms (real ${realGap}ms): ${sent.length ? sent.join(', ') : 'nothing sent'}${open ? ', dialog up' : ''}`);
      if (!onOk) failures.push(`VACUOUS: gap ${gap}ms: the second tap did not land on the OK button`);
      if (late) {
        if (realGap !== null && realGap < GUARD_MS) failures.push(`VACUOUS: the late tap landed at ${realGap}ms, inside the guard`);
        if (sent.length !== 1 || !/^DELETE \/api\/videos\/[^/]+$/.test(sent[0])) failures.push(`a tap at ${gap}ms must send exactly one DELETE /api/videos/<id>; sent [${sent.join(', ')}]`);
      } else {
        if (realGap === null || realGap >= GUARD_MS) failures.push(`VACUOUS: gap ${gap}ms really landed at ${realGap}ms, not inside the ${GUARD_MS}ms guard`);
        if (sent.length) failures.push(`the second tap of a double-tap ${realGap}ms apart answered the confirm: ${sent.join(', ')} (${trig.label})`);
        if (!open) failures.push(`gap ${gap}ms: the dialog closed; the second tap must leave it up and unanswered`);
      }
      if (await dialogOpen(page)) await closeDialog(page);
      await sleep(300);
      record.blockedRequests.length = 0;
    }
  } catch (e) {
    failures.push(`the check did not run: ${String(e).split('\n')[0]}`);
  } finally {
    await ctx.close();
  }
  return { id: `DBLTAP/stats-delete-${vp}`, measured: `(${measured.join('; ')})`, failures };
}

async function run(env, opts = {}) {
  const out = [];
  for (const vp of VIEWPORTS) out.push(await runViewport(env, vp, opts));
  return out;
}

module.exports = { run, EARLY_GAPS, LATE_GAP, GUARD_MS };

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
      const res = await run({ browser, st, base, FX }, { mutateGuard: args.includes('--mutate-guard') });
      for (const r of res) console.log(`${r.failures.length ? 'FAIL' : 'ok  '} ${r.id} ${r.measured}${r.failures.map((f) => '\n     ' + f).join('')}`);
      process.exitCode = res.some((r) => r.failures.length) ? 1 : 0;
    } finally { await browser.close(); }
  })().catch((e) => { console.error(e); process.exitCode = 2; });
}
