'use strict';
// The visual job's contracts (plan D10.5) that need no browser: the CI container pins the
// same Playwright as tools/capture's lockfile, the job refuses to pass without baselines, the
// rebaseline job is dispatch-only and the only one that writes baselines, and the fixture
// clock is pinned on both the server (clock-shim.js) and the browser (installPinnedClock).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..', '..');
const WF = yaml.load(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'visual.yml'), 'utf8'));
const LOCK = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'capture', 'package-lock.json'), 'utf8'));
const PW = LOCK.packages['node_modules/playwright'].version;
const runs = (job) => WF.jobs[job].steps.map((s) => s.run || '').join('\n');

test('both jobs run in the Playwright container that matches tools/capture\'s pinned Playwright', () => {
  assert.match(PW, /^\d+\.\d+\.\d+$/);
  for (const job of ['visual', 'rebaseline']) {
    assert.strictEqual(WF.jobs[job].container.image, `mcr.microsoft.com/playwright:v${PW}-jammy`, job);
    assert.ok(runs(job).includes(`v !== '${PW}'`), `${job}: the version guard step checks ${PW}`);
    assert.ok(runs(job).includes('npm ci --prefix tools/capture'), `${job}: installs the capture tools from their lockfile`);
  }
});

test('visual runs the geometry checks and the diff; only the dispatch-only rebaseline job writes baselines', () => {
  assert.strictEqual(WF.jobs.visual.if, "github.event_name != 'workflow_dispatch'");
  assert.strictEqual(WF.jobs.rebaseline.if, "github.event_name == 'workflow_dispatch'");
  assert.ok(WF.on && 'workflow_dispatch' in WF.on && 'push' in WF.on && 'pull_request' in WF.on);
  assert.match(runs('visual'), /npm run test:geometry\b/);
  assert.match(runs('visual'), /node test\/visual\/run\.js /);
  assert.doesNotMatch(runs('visual'), /--update/);
  assert.match(runs('rebaseline'), /node test\/visual\/run\.js --update/);
  const upload = WF.jobs.rebaseline.steps.find((s) => s.uses && s.uses.startsWith('actions/upload-artifact'));
  assert.ok(upload && /test\/visual\/baselines/.test(upload.with.path));
  const report = WF.jobs.visual.steps.find((s) => s.uses && s.uses.startsWith('actions/upload-artifact'));
  assert.strictEqual(report.if, 'failure()');
});

test('run.js refuses to pass without baselines (exit 2, the rebaseline instruction) before booting anything', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-visual-nobase-'));
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'test', 'visual', 'run.js'), '--baselines', empty], { encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /no baselines - run the rebaseline job/);
  } finally { fs.rmSync(empty, { recursive: true, force: true }); }
});

test('start-server.sh boots read-only with every background poller off and TZ pinned', () => {
  const sh = fs.readFileSync(path.join(ROOT, 'test', 'visual', 'start-server.sh'), 'utf8');
  const cmd = sh.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  for (const want of ['FILETUBE_READONLY=1', 'FILETUBE_READ_ONLY_MEDIA=1', 'FILETUBE_YTDLP_POLL_MINUTES=0', 'TZ=UTC', 'clock-shim.js']) {
    assert.ok(cmd.includes(want), want);
  }
  const seed = fs.readFileSync(path.join(ROOT, 'test', 'visual', 'seed.js'), 'utf8');
  assert.match(seed, /settings: \{ pollMinutes: 0 \}/, 'the podcast feed poll is off in the fixture');
  assert.match(seed, /settingsStore\.set\('scanIntervalMinutes', 0\)/, 'the library re-scan timer is off in the fixture');
});

test('clock-shim.js: Date.now and new Date() start at FILETUBE_CLOCK_MS and flow; Date(x) and Date() behave', () => {
  const pinned = Date.UTC(2026, 8, 1, 13, 0, 0);
  const code = 'const a = Date.now(); const b = new Date().getTime(); const c = new Date(5).getTime(); const d = typeof Date(); const e = new Date() instanceof Date;'
    + 'console.log(JSON.stringify({ a, b, c, d, e }))';
  const r = spawnSync(process.execPath, ['--require', path.join(ROOT, 'test', 'visual', 'clock-shim.js'), '-e', code],
    { encoding: 'utf8', env: { ...process.env, FILETUBE_CLOCK_MS: String(pinned) } });
  assert.strictEqual(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.ok(o.a >= pinned && o.a - pinned < 5000, `Date.now() ${o.a} vs ${pinned}`);
  assert.ok(o.b >= o.a && o.b - pinned < 5000);
  assert.deepStrictEqual([o.c, o.d, o.e], [5, 'string', true]);
  const off = spawnSync(process.execPath, ['--require', path.join(ROOT, 'test', 'visual', 'clock-shim.js'), '-e', 'console.log(Date.now())'],
    { encoding: 'utf8', env: { ...process.env, FILETUBE_CLOCK_MS: '' } });
  assert.ok(Math.abs(Number(off.stdout) - Date.now()) < 5000, 'unset = the real clock');
});

test('capture.js installPinnedClock: the browser Date starts at the fixture clock', () => {
  const { installPinnedClock, MASK_CSS, CONTEXT_PINS } = require('../visual/capture.js');
  const pinned = Date.UTC(2026, 8, 1, 13, 0, 0);
  const win = { Date };
  const ctx = vm.createContext(win);
  ctx.window = ctx;
  vm.runInContext(`(${installPinnedClock.toString()})(${pinned}); globalThis.out = JSON.stringify([Date.now(), new Date().getTime(), new Date(7).getTime(), typeof Date()])`, ctx);
  ctx.out = JSON.parse(ctx.out);
  assert.ok(ctx.out[0] >= pinned && ctx.out[0] - pinned < 5000);
  assert.deepStrictEqual(ctx.out.slice(2), [7, 'string']);
  assert.ok(MASK_CSS.includes('#file-path-text'), 'the watch page file path (the DATA_DIR) is masked');
  assert.deepStrictEqual(CONTEXT_PINS, { timezoneId: 'UTC', locale: 'en-US', colorScheme: 'light' });
});
