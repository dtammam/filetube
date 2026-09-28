#!/usr/bin/env node
'use strict';
// Geometry checks G1-G4 (UI professionalism pass, plan D10.2) against a seeded, read-only
// FileTube in headless Chromium. See checks.js for what each check measures, scenes.js for
// what it measures it on, mutations.js for the proofs that each can go red.
//
//   npm run test:geometry                  G1-G3 on every live surface x 4 eras x 2 modes x
//                                          phone/desktop, then G4 on every sequence
//   npm run test:geometry:fast             G1-G3 on the 4 pre-push scenes (FAST_SCENES)
//   node test/geometry/run.js --mutants    every mutation must turn its check red
//   node test/geometry/run.js [--only G1,G4] [--mutate NAME] [--json FILE]
//        [--base URL --data DIR]           reuse a running fixture server instead of booting one
//
// By default the run seeds its own DATA_DIR (a fresh temp dir) and boots a FRESH server on a
// free port (test/visual/server.js), and stops it at the end.
//
// Expected failures: test/geometry/expected-failures.json lists check ids that fail today for
// a known reason and the sweep that fixes them (G4 on the Pocket rotation = F23, S7). A
// listed failure is reported as XFAIL and does not fail the run; a listed id that PASSES
// fails the run (XPASS: the fix landed - delete the entry), so the list can only shrink.
//
// Exit: 0 = no unexpected failure; 1 = a failure, a vacuous check, an XPASS, a surviving
// mutant, or a scene that could not load; 3 = Playwright is not installed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const capture = require('../visual/capture.js');
const { seed, boot } = require('../visual/server.js');
const checks = require('./checks.js');
const { SURFACES, ERAS, MODES, FAST_SCENES, G4_SEQUENCES } = require('./scenes.js');
const { MUTATIONS } = require('./mutations.js');

const EXPECTED_PATH = path.join(__dirname, 'expected-failures.json');

function parseArgs(argv) {
  const arg = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
  return {
    fast: argv.includes('--fast'),
    mutants: argv.includes('--mutants'),
    mutate: arg('--mutate', null),
    only: arg('--only', null) ? arg('--only').split(',') : null,
    base: arg('--base', null),
    data: arg('--data', null),
    json: arg('--json', null),
  };
}

// Entries: {id, owner, reason, match?}. `id` may end in `*` (a prefix: "G3/kit/*" = every kit
// scene). `match` narrows the entry to the failures whose text contains it; the scene's
// other failures still FAIL. An entry that matched no failure on a scene it covers is XPASS.
function loadExpected(file = EXPECTED_PATH) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!j || !Array.isArray(j.entries)) throw new Error(`${file}: expected {comment, entries: [{id, owner, reason, match?}]}`);
  for (const e of j.entries) if (!e.id || !e.reason || !e.owner) throw new Error(`${file}: every entry needs id, reason and owner (${JSON.stringify(e)})`);
  return j.entries;
}

function expectedFor(entries, id) {
  return entries.filter((e) => (e.id.endsWith('*') ? id.startsWith(e.id.slice(0, -1)) : id === e.id));
}

const sceneId = (s) => `${s.surface}/${s.era}-${s.mode}-${s.vp}`;

// All G1-G3 scenes of a run.
function planScenes(opts) {
  if (opts.fast) return FAST_SCENES.map((s) => ({ ...s }));
  const out = [];
  for (const surf of SURFACES) {
    if (surf.pending) continue;
    for (const era of ERAS) for (const mode of MODES) for (const vp of (surf.vps || ['phone', 'desktop'])) out.push({ surface: surf.id, era, mode, vp });
  }
  return out;
}

// Check id -> its in-page collector and pure evaluator. HDR / NAV (sweep S1) are the chrome's
// rendered contracts (checks.js); G1-G3 take the surface's optional `scope` selector.
const COLLECT = { G1: checks.collectG1, G2: checks.collectG2, G3: checks.collectG3, HDR: checks.collectHeader, NAV: checks.collectBottomBar, SHD: checks.collectSheetHeader };
const EVALUATE = { G1: checks.evalG1, G2: checks.evalG2, G3: checks.evalG3, HDR: checks.evalHeader, NAV: checks.evalBottomBar, SHD: checks.evalSheetHeader };

async function measureScene(env, scene, mutationCss) {
  const surf = SURFACES.find((s) => s.id === scene.surface);
  const { ctx, page } = await capture.newScenePage(env.browser, { vp: scene.vp, mode: scene.mode, era: scene.era, storageState: env.st,
    tag: { scene: 'geometry:' + sceneId(scene) }, record: env.record, clockMs: env.FX.viewNow, dpr: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  try {
    await page.goto(env.base + surf.path(env.FX, scene.era, scene.mode), { waitUntil: 'networkidle', timeout: 20000 });
    if (surf.open) await surf.open(page, scene.vp, { capture });
    await page.waitForSelector(surf.ready, { state: 'attached', timeout: 10000 });
    await page.addStyleTag({ content: capture.FREEZE_CSS + (mutationCss || '') });
    await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const res = {};
    for (const c of surf.checks) {
      if (env.only && !env.only.includes(c)) continue;
      const data = await page.evaluate(COLLECT[c], surf.scope || null);
      const ev = EVALUATE[c](data);
      const floor = (surf.min && surf.min[c]) || {};
      const vacuous = Object.entries(floor).filter(([k, v]) => !(ev.measured[k] >= v)).map(([k, v]) => `${k} ${ev.measured[k]} < ${v}`);
      res[c] = { ...ev, vacuous };
    }
    return { res, errors };
  } finally { await ctx.close(); }
}

// ---- G4 ----
async function setOrientation(page, cdp, portrait) {
  const [w, h] = portrait ? [390, 844] : [844, 390];
  await page.setViewportSize({ width: w, height: h });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true,
    screenWidth: w, screenHeight: h, screenOrientation: portrait ? { type: 'portraitPrimary', angle: 0 } : { type: 'landscapePrimary', angle: 90 } });
}

async function recordStep(page, fn, settleMs = 1500, ignore = null) {
  await page.evaluate(checks.startG4Recorder, { max: 2500, ignore });
  await capture.sleep(120); // a few unchanged frames before the step (frame 0 = before)
  const how = await fn();
  await capture.sleep(settleMs);
  await page.evaluate(() => { window.__g4.on = false; });
  const r = await page.evaluate(`(${checks.evalG4.toString()})(window.__g4.frames, ${checks.G4_TOL})`);
  return { ...r, how: typeof how === 'string' ? how : undefined };
}

async function runSequence(env, seq, mode, mutationCss) {
  const { ctx, page } = await capture.newScenePage(env.browser, { vp: 'phone', mode, era: '2021', storageState: env.st,
    tag: { scene: 'geometry:' + seq.id, rotation: true }, record: env.record, clockMs: env.FX.viewNow, dpr: 1 });
  const cdp = await ctx.newCDPSession(page);
  const steps = [];
  try {
    await setOrientation(page, cdp, true);
    if (seq.id === 'pocket-rotation') {
      const { openPocket } = capture.sceneKit(env.FX, env.base);
      await page.goto(env.base + '/music', { waitUntil: 'networkidle', timeout: 20000 });
      await openPocket(page, 'ipod', 'phone');
      await capture.pausePlayback(page);
      if (mutationCss) await page.addStyleTag({ content: mutationCss });
      const seqSteps = capture.rotationSteps(page, 'spec', (portrait) => setOrientation(page, cdp, portrait));
      for (const [name, fn, prep] of seqSteps) { if (prep) await prep(); steps.push({ step: name, ...(await recordStep(page, fn, 1500, seq.ignore || null)) }); } // a step's prep runs before its recording (capture.js rotationSteps)
    } else {
      await page.goto(env.base + '/ui-kit.html?era=2021&mode=' + mode, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForSelector('.ui-list .ui-row', { timeout: 10000 });
      if (mutationCss) await page.addStyleTag({ content: mutationCss });
      await capture.sleep(300);
      steps.push({ step: '1-to-landscape', ...(await recordStep(page, () => setOrientation(page, cdp, false))) });
      steps.push({ step: '2-to-portrait', ...(await recordStep(page, () => setOrientation(page, cdp, true))) });
    }
  } finally { await ctx.close(); }
  const failures = [];
  for (const s of steps) {
    if (s.moved.length) failures.push(`${s.step}: ${s.moved.length} box(es) moved after frame ${s.firstChange} (worst ${s.moved[0].delta}px at frame ${s.moved[0].frame}: ${s.moved[0].key})`);
    if (!s.changed) failures.push(`${s.step}: VACUOUS - the layout never changed (${s.frames} frames)`);
    if (!s.settled) failures.push(`${s.step}: not settled - the last two frames still differ`);
    if (s.frames < 10) failures.push(`${s.step}: VACUOUS - only ${s.frames} frames recorded`);
  }
  return { steps, failures };
}

// ---- reporting ----
// -> { fail, lines, counts }. Status per result: ok | FAIL | XFAIL (every failure expected) |
// XPASS (an expected entry matched nothing: the fix landed, delete the entry).
function summarize(results, entries) {
  let fail = 0;
  const lines = [];
  const counts = { ok: 0, FAIL: 0, XFAIL: 0, XPASS: 0 };
  const text = (f) => (typeof f === 'string' ? f : JSON.stringify(f));
  const told = new Set();
  for (const r of results) {
    const xs = expectedFor(entries, r.id);
    const isExpected = (f) => xs.some((e) => !e.match || text(f).includes(e.match));
    const unexpected = r.failures.filter((f) => !isExpected(f));
    const unmatched = xs.filter((e) => !r.failures.some((f) => !e.match || text(f).includes(e.match)));
    let status;
    if (unexpected.length) status = 'FAIL';
    else if (unmatched.length) status = 'XPASS';
    else if (r.failures.length) status = 'XFAIL';
    else status = 'ok';
    counts[status]++;
    if (status === 'FAIL' || status === 'XPASS') fail++;
    lines.push(`${status.padEnd(5)} ${r.id}  ${r.measured || ''}`);
    for (const e of unmatched) lines.push(`      XPASS: expected-failure entry "${e.id}"${e.match ? ` (match "${e.match}")` : ''} (${e.owner}: ${e.reason}) did not fail here - delete it from test/geometry/expected-failures.json`);
    if (status === 'XFAIL' || (status === 'FAIL' && unexpected.length < r.failures.length)) {
      for (const e of xs) {
        lines.push(`      expected (${e.owner})${told.has(e) ? ' - see above' : ': ' + e.reason}`);
        told.add(e);
      }
    }
    const show = status === 'FAIL' ? unexpected : r.failures;
    for (const f of show.slice(0, 12)) lines.push(`      ${status === 'FAIL' ? '' : '(expected) '}${text(f)}`);
    if (show.length > 12) lines.push(`      ... ${show.length - 12} more`);
  }
  return { fail, lines, counts };
}

function describe(check, ev) {
  const m = ev.measured;
  if (check === 'G1') return `(${m.lists} lists, ${m.rows} rows)`;
  if (check === 'G2') return `(${m.items} icon/label pairs)`;
  if (check === 'HDR') return `(${m.buttons} header buttons, ${m.sidebar} sidebar rows)`;
  if (check === 'NAV') return `(${m.tabs} tabs)`;
  if (check === 'SHD') return `(${m.headers} sheet headers, ${m.titleless} titleless)`;
  return `(${m.groups} groups)`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let pw;
  try { pw = capture.playwright(); } catch {
    console.error('geometry: Playwright is not installed in tools/capture (cd tools/capture && npm ci && npx playwright install chromium).');
    return 3;
  }
  if (opts.mutate && !MUTATIONS[opts.mutate]) { console.error(`geometry: unknown mutation ${opts.mutate}; known: ${Object.keys(MUTATIONS).join(', ')}`); return 1; }
  const expected = loadExpected();
  const t0 = Date.now();
  let dataDir = opts.data;
  let server = null;
  let made = null;
  if (!opts.base) {
    made = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-geometry-'));
    dataDir = made;
    seed(dataDir);
    server = await boot(dataDir, { logFile: path.join(made, 'server.log') });
    // An interrupted run must not leave its fixture server (or its temp dir) behind.
    for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { server.stop().then(() => { fs.rmSync(made, { recursive: true, force: true }); process.exit(130); }); });
  }
  const base = opts.base || server.base;
  const FX = capture.readFixtures(dataDir);
  const browser = await pw.chromium.launch({ args: capture.LAUNCH_ARGS });
  const record = capture.newRecord(base);
  let code = 0;
  try {
    const st = await capture.login(browser, base, FX, record);
    const env = { browser, st, record, FX, base, only: opts.only };

    // A failure an expected-failure entry covers is not evidence either way (mutants mode).
    const unexpectedOnly = (id, failures) => {
      const xs = expectedFor(expected, id);
      const t = (f) => (typeof f === 'string' ? f : JSON.stringify(f));
      return failures.filter((f) => !xs.some((e) => !e.match || t(f).includes(e.match)));
    };
    if (opts.mutants) {
      console.log('geometry --mutants: each mutation must turn its check red on its target; the same scene unmutated must be green.');
      let survived = 0;
      for (const [name, m] of Object.entries(MUTATIONS)) {
        const run = async (css) => {
          if (m.check === 'G4') {
            const seq = G4_SEQUENCES.find((s) => s.id === m.target.sequence);
            return unexpectedOnly(`G4/${seq.id}/${m.target.mode}`, (await runSequence(env, seq, m.target.mode, css)).failures);
          }
          const { res } = await measureScene({ ...env, only: [m.check] }, m.target, css);
          return unexpectedOnly(`${m.check}/${sceneId(m.target)}`, res[m.check].failures.concat(res[m.check].vacuous));
        };
        const control = await run('');
        const mutated = await run(m.css);
        const red = mutated.length > 0;
        const ok = red && control.length === 0;
        if (!ok) survived++;
        console.log(`${ok ? 'KILLED  ' : 'SURVIVED'} ${name} (${m.check} on ${m.target.surface ? sceneId(m.target) : m.target.sequence + '/' + m.target.mode}): control ${control.length} failure(s), mutated ${mutated.length} failure(s)`);
        if (red) console.log(`         first: ${JSON.stringify(mutated[0]).slice(0, 220)}`);
        if (control.length) console.log(`         control not green: ${JSON.stringify(control[0]).slice(0, 220)}`);
      }
      console.log(`geometry --mutants: ${Object.keys(MUTATIONS).length - survived} of ${Object.keys(MUTATIONS).length} killed, ${survived} survived (${Math.round((Date.now() - t0) / 1000)}s)`);
      return survived ? 1 : 0;
    }

    const mutation = opts.mutate ? MUTATIONS[opts.mutate] : null;
    const results = [];
    const scenes = planScenes(opts);
    for (const scene of scenes) {
      let out;
      try {
        out = await measureScene(env, scene, mutation ? mutation.css : '');
      } catch (e) {
        results.push({ id: `LOAD/${sceneId(scene)}`, failures: [`the scene did not load: ${String(e).split('\n')[0]}`] });
        continue;
      }
      for (const [c, ev] of Object.entries(out.res)) {
        results.push({ id: `${c}/${sceneId(scene)}`, measured: describe(c, ev), failures: [...ev.failures, ...ev.vacuous.map((v) => `VACUOUS: ${v}`)] });
      }
      if (out.errors.length) results.push({ id: `PAGEERROR/${sceneId(scene)}`, failures: out.errors });
    }
    if (!opts.fast && (!opts.only || opts.only.includes('G4'))) {
      for (const seq of G4_SEQUENCES) {
        for (const mode of seq.modes) {
          const css = mutation && mutation.check === 'G4' && mutation.target.sequence === seq.id ? mutation.css : '';
          let r;
          try { r = await runSequence(env, seq, mode, css); } catch (e) { r = { steps: [], failures: [`the sequence did not run: ${String(e).split('\n')[0]}`] }; }
          results.push({ id: `G4/${seq.id}/${mode}`, measured: `(${r.steps.map((s) => `${s.step}: ${s.frames} frames, change@${s.firstChange}, ${s.moved.length} moved`).join('; ')})`, failures: r.failures });
        }
      }
    }
    if (record.blockedRequests.length) results.push({ id: 'REQUEST-POLICY', failures: record.blockedRequests.map((b) => `${b.scene} ${b.method} ${b.url}`) });

    const { fail, lines, counts } = summarize(results, expected);
    console.log(lines.join('\n'));
    const pending = SURFACES.filter((s) => s.pending);
    if (pending.length && !opts.fast) console.log(`pending surfaces (not measured until their sweep lands): ${pending.map((s) => `${s.id} (${s.pending})`).join(', ')}`);
    console.log(`geometry${opts.fast ? ' (fast)' : ''}${opts.mutate ? ' [mutation ' + opts.mutate + ']' : ''}: ${results.length} checks - ${counts.ok} ok, ${counts.FAIL} FAIL, ${counts.XFAIL} XFAIL (expected), ${counts.XPASS} XPASS; ${scenes.length} scenes in ${Math.round((Date.now() - t0) / 1000)}s`);
    if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(results, null, 1));
    code = fail ? 1 : 0;
  } finally {
    await browser.close();
    if (server) await server.stop();
    if (made) fs.rmSync(made, { recursive: true, force: true });
  }
  return code;
}

if (require.main === module) {
  main().then((c) => { process.exitCode = c; }, (e) => { console.error(e); process.exitCode = 1; });
}

module.exports = { parseArgs, planScenes, summarize, loadExpected, expectedFor };
