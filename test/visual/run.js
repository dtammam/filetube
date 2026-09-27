#!/usr/bin/env node
'use strict';
// The visual job (plan D10.5): seed -> a FRESH read-only server -> capture the scene matrix
// (scenes 01-30 + 40-42 x 4 eras x 2 modes x phone/landscape/desktop, reduced motion, pinned
// clock, volatile text masked) -> diff against test/visual/baselines/ at 0 changed pixels
// (tools/capture/compare.js, channel threshold 16, AA-suppressed) -> report + crops.
//
//   node test/visual/run.js [--update] [--data DIR] [--out DIR] [--era 2021,2005|all]
//        [--only 04,18] [--jobs N] [--dpr N] [--baselines DIR]
//
// --update writes the captured shots as the new baselines (the CI rebaseline job,
// .github/workflows/visual.yml; D10.5: committed baselines come ONLY from the pinned CI
// container - a local --update is for experiments, never for a commit). Without baselines
// the run fails loudly before capturing anything.
//
// Exit: 0 = every shot identical to its baseline; 1 = a changed, missing or extra shot, or a
// scene that failed to capture; 2 = no baselines / bad arguments.
// Output: <out>/shots/*.png, <out>/report/{report.md,report.json,*.sbs.png}, <out>/server.log.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { seed, boot } = require('./server.js');
const { ERAS } = require('./capture.js');
const { compareDirs } = require('../../tools/capture/compare.js');

const REPO = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const UPDATE = args.includes('--update');
const BASELINES = path.resolve(arg('--baselines', path.join(__dirname, 'baselines')));
// A FIXED data dir by default: media ids hash the file path, and the CI baselines are shot
// from this exact path.
const DATA = path.resolve(arg('--data', process.env.VISUAL_DATA_DIR || '/tmp/filetube-visual-data'));
const OUT = path.resolve(arg('--out', path.join(os.tmpdir(), 'filetube-visual-run')));
const eraArg = arg('--era', 'all');
const eras = eraArg === 'all' ? ERAS : eraArg.split(',');
const ONLY = arg('--only', '');
const JOBS = Math.max(1, Number(arg('--jobs', '1')) || 1);
const DPR = arg('--dpr', '1');
const THRESHOLD = 16;

function die(code, msg) { console.error(msg); process.exit(code); }
for (const e of eras) if (!ERAS.includes(e)) die(2, `run: --era must be 2021, 2014, 2009, 2005, a comma list of them, or all (got ${eraArg})`);

const pngs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : []);
if (!UPDATE && pngs(BASELINES).length === 0) {
  die(2, `visual: FAIL - no baselines - run the rebaseline job (GitHub Actions: workflow "visual", Run workflow -> rebaseline), then commit its artifact into ${path.relative(REPO, BASELINES)}/.\n(${BASELINES} holds no .png files; a visual job without baselines would pass vacuously, so it refuses.)`);
}

const children = new Set();
function captureEra(era, base, shots) {
  return new Promise((resolve) => {
    const cargs = [path.join(__dirname, 'capture.js'), '--data', DATA, '--out', path.join(shots, `.era-${era}`), '--era', era, '--dpr', DPR, '--no-rotation'];
    if (ONLY) cargs.push('--only', ONLY);
    const child = spawn(process.execPath, cargs, { cwd: REPO, env: { ...process.env, BASE_URL: base }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    const tag = (s) => s.toString().split('\n').filter(Boolean).map((l) => `  [${era}] ${l}`).join('\n');
    child.stdout.on('data', (d) => console.log(tag(d)));
    child.stderr.on('data', (d) => console.error(tag(d)));
    child.on('exit', (code) => { children.delete(child); resolve(code); });
  });
}

(async () => {
  const t0 = Date.now();
  fs.rmSync(OUT, { recursive: true, force: true });
  const shots = path.join(OUT, 'shots');
  fs.mkdirSync(shots, { recursive: true });
  console.log(`visual: seeding ${DATA}`);
  seed(DATA);
  const srv = await boot(DATA, { logFile: path.join(OUT, 'server.log'), log: console.log });
  // An interrupted run must not leave its fixture server behind.
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { for (const c of children) c.kill('SIGTERM'); srv.stop().then(() => process.exit(130)); });
  const failures = [];
  const blocked = [];
  let captured = 0;
  try {
    const queue = [...eras];
    const worker = async () => {
      while (queue.length) {
        const era = queue.shift();
        const code = await captureEra(era, srv.base, shots);
        const dir = path.join(shots, `.era-${era}`);
        const recPath = path.join(dir, 'run-record.json');
        if (!fs.existsSync(recPath)) { failures.push({ fname: `(era ${era})`, error: `capture exited ${code} without a run record` }); continue; }
        const rec = JSON.parse(fs.readFileSync(recPath, 'utf8'));
        captured += rec.captured.length;
        failures.push(...rec.failed);
        blocked.push(...rec.blockedRequests);
        for (const f of pngs(dir)) if (!f.startsWith('FAILED-')) fs.renameSync(path.join(dir, f), path.join(shots, f));
        fs.renameSync(recPath, path.join(OUT, `run-record-${era}.json`));
      }
    };
    await Promise.all(Array.from({ length: Math.min(JOBS, eras.length) }, worker));
  } finally {
    await srv.stop();
  }
  console.log(`visual: captured ${captured} shots in ${Math.round((Date.now() - t0) / 1000)}s; capture failures ${failures.length}; unexpected blocked requests ${blocked.length}`);
  for (const f of failures) console.log(`  CAPTURE FAIL ${f.fname}: ${f.error}`);
  for (const b of blocked) console.log(`  BLOCKED ${b.scene} ${b.method} ${b.url}`);
  if (failures.length || blocked.length) process.exitCode = 1;

  if (UPDATE) {
    if (failures.length || blocked.length) die(1, 'visual: --update refused: the capture was not clean (above); the baselines are unchanged.');
    fs.mkdirSync(BASELINES, { recursive: true });
    for (const f of pngs(BASELINES)) fs.unlinkSync(path.join(BASELINES, f));
    for (const f of pngs(shots)) fs.copyFileSync(path.join(shots, f), path.join(BASELINES, f));
    console.log(`visual: wrote ${pngs(BASELINES).length} baselines to ${BASELINES}`);
    return;
  }

  // Compare against the baselines this run was asked to cover (--era/--only select a subset).
  const taken = new Set(pngs(shots));
  const scope = (f) => {
    const era = (f.match(/-(2014|2009|2005)\.png$/) || [null, '2021'])[1];
    if (!eras.includes(era)) return false;
    return !ONLY || ONLY.split(',').some((s) => f.startsWith(s) || f.split('--')[0].includes(s));
  };
  const baseDir = path.join(OUT, '.baselines-in-scope');
  fs.mkdirSync(baseDir, { recursive: true });
  for (const f of pngs(BASELINES).filter(scope)) fs.copyFileSync(path.join(BASELINES, f), path.join(baseDir, f));
  const report = path.join(OUT, 'report');
  const results = compareDirs(baseDir, shots, report, THRESHOLD);
  fs.rmSync(baseDir, { recursive: true, force: true });
  const changed = results.filter((r) => r.changed > 0);
  const missing = results.filter((r) => r.changed === -1);
  const same = results.filter((r) => r.changed === 0);
  console.log(`visual: ${results.length} shots compared (threshold ${THRESHOLD}): ${same.length} identical, ${changed.length} changed, ${missing.length} missing/extra/size-changed`);
  for (const r of changed.slice(0, 40)) console.log(`  CHANGED ${r.scene}: ${r.changed} px (${r.pct}%)${r.crop ? ' crop ' + r.crop : ''}`);
  for (const r of missing.slice(0, 40)) console.log(`  MISSING ${r.scene}: ${r.note}`);
  if (taken.size === 0) console.log('  (no shots were captured)');
  console.log(`visual: report ${report}/report.md`);
  if (changed.length || missing.length || taken.size === 0) process.exitCode = 1;
  console.log(process.exitCode ? 'visual: FAIL' : 'visual: PASS (0 changed pixels)');
})().catch((e) => { console.error(e); process.exit(1); });
