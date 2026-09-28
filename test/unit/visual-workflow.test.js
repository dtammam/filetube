'use strict';
// The visual job's contracts (plan D10.5) that need no browser: the CI container pins the
// same Playwright as tools/capture's lockfile, the job refuses to pass without baselines, the
// rebaseline job (dispatch, or a push to rebaseline/*) is the only one that writes baselines, and the fixture
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

test('visual runs the geometry checks and the diff; only the rebaseline job (dispatch or rebaseline/*) writes baselines', () => {
  // The rebaseline job also runs on a push to rebaseline/* (a workflow is dispatchable only
  // once it is on the default branch); the diff never runs there, so the two never overlap.
  assert.strictEqual(WF.jobs.visual.if, "github.event_name != 'workflow_dispatch' && !startsWith(github.ref, 'refs/heads/rebaseline/')");
  assert.strictEqual(WF.jobs.rebaseline.if, "github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && startsWith(github.ref, 'refs/heads/rebaseline/'))");
  assert.ok(WF.on && 'workflow_dispatch' in WF.on && 'push' in WF.on && 'pull_request' in WF.on);
  // A PR branch runs once (pull_request); push covers main and the rebaseline/* trigger only.
  assert.deepStrictEqual(WF.on.push.branches, ['main', 'rebaseline/**']);
  assert.match(runs('visual'), /npm run test:geometry\b/);
  assert.match(runs('visual'), /node test\/visual\/run\.js /);
  assert.doesNotMatch(runs('visual'), /--update/);
  assert.match(runs('rebaseline'), /node test\/visual\/run\.js --update/);
  const upload = WF.jobs.rebaseline.steps.find((s) => s.uses && s.uses.startsWith('actions/upload-artifact'));
  assert.ok(upload && /test\/visual\/baselines/.test(upload.with.path));
  const report = WF.jobs.visual.steps.find((s) => s.uses && s.uses.startsWith('actions/upload-artifact'));
  assert.strictEqual(report.if, 'failure()');
});

test('both jobs run one leg per era x viewport, and the legs together cover every shot capture.js takes', () => {
  // 12 legs in parallel (it was one ~50 min job). The matrix IS capture.js's ERAS x viewports(), so
  // an era or viewport added there without a leg here would never be diffed.
  const { ERAS, viewports } = require('../visual/capture.js');
  const VPS = Object.keys(viewports(1));
  for (const job of ['visual', 'rebaseline']) {
    assert.deepStrictEqual([...WF.jobs[job].strategy.matrix.era].sort(), [...ERAS].sort(), job);
    assert.deepStrictEqual([...WF.jobs[job].strategy.matrix.vp].sort(), [...VPS].sort(), job);
    assert.strictEqual(WF.jobs[job].strategy['fail-fast'], false, `${job}: one leg failing must not cancel the others`);
    assert.match(runs(job), /node test\/visual\/run\.js .*--era \$\{\{ matrix\.era \}\} --vp \$\{\{ matrix\.vp \}\}/, `${job}: each leg runs only its era and viewport`);
  }
  // The geometry checks run ONCE (on the 2021 desktop leg), not 12 times.
  const geo = WF.jobs.visual.steps.find((s) => /npm run test:geometry/.test(s.run || ''));
  assert.strictEqual(geo.if, "matrix.era == '2021' && matrix.vp == 'desktop'");
  const uploads = WF.jobs.visual.steps.filter((s) => s.uses && s.uses.startsWith('actions/upload-artifact'));
  for (const u of uploads) {
    assert.strictEqual(u.if, 'failure()', 'the visual legs upload only on failure');
    assert.match(u.with.name, /\$\{\{ matrix\.era \}\}-\$\{\{ matrix\.vp \}\}$/, 'per-leg artifact names (they must not collide)');
  }
  // One run for an intended change: a failing leg uploads the shots it took; visual-shots joins them.
  const shots = uploads.find((u) => /^visual-shots-/.test(u.with.name));
  assert.ok(shots && shots.with.path === 'test-results/visual/shots/*.png');
  const vs = WF.jobs['visual-shots'];
  assert.strictEqual(vs.needs, 'visual');
  assert.strictEqual(vs.if, "${{ always() && needs.visual.result == 'failure' }}");
  const vm1 = vs.steps.find((s) => s.uses && s.uses.startsWith('actions/upload-artifact/merge'));
  assert.deepStrictEqual([vm1.with.name, vm1.with.pattern, vm1.with['separate-directories']], ['visual-shots', 'visual-shots-*', undefined]);
  // A rebaseline leg uploads ONLY its own shots: the checkout's committed baselines go first.
  const cap = WF.jobs.rebaseline.steps.find((s) => /--update/.test(s.run || ''));
  assert.ok(cap.run.indexOf('rm -f test/visual/baselines/*.png') !== -1 && cap.run.indexOf('rm -f test/visual/baselines/*.png') < cap.run.indexOf('--update'));
  const up = WF.jobs.rebaseline.steps.find((s) => s.uses && s.uses.startsWith('actions/upload-artifact'));
  assert.strictEqual(up.with.name, 'visual-baselines-${{ matrix.era }}-${{ matrix.vp }}');
  // ...and the merge joins the 12 into ONE flat `visual-baselines`, only when EVERY leg passed:
  // a plain `needs` with no `if` (an `always()` would publish a partial set), no per-leg folders.
  const merge = WF.jobs['rebaseline-merge'];
  assert.strictEqual(merge.needs, 'rebaseline');
  assert.strictEqual(merge.if, undefined, 'rebaseline-merge must not run when a leg failed');
  const m = merge.steps.find((s) => s.uses && s.uses.startsWith('actions/upload-artifact/merge'));
  assert.deepStrictEqual([m.with.name, m.with.pattern, m.with['separate-directories']], ['visual-baselines', 'visual-baselines-*', undefined]);
});

test('run.js --vp scopes the compare by the shot name, and a name it cannot parse stays in scope', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'test', 'visual', 'run.js'), '--vp', 'tablet'], { encoding: 'utf8', timeout: 30000 });
  assert.strictEqual(r.status, 2, r.stderr);
  assert.match(r.stderr, /--vp must be phone, land, desktop/);
  const src = fs.readFileSync(path.join(ROOT, 'test', 'visual', 'run.js'), 'utf8');
  assert.match(src, /if \(VPS\.includes\(vp\) && !vps\.includes\(vp\)\) return false;/, 'only a KNOWN other viewport leaves the scope');
  assert.match(src, /'--vp', vps\.join\(','\)/, 'the capture shoots the same viewports the compare covers');
});

test('a docs-only change (.md files, docs/) skips the workflow; nothing the app renders lives there', () => {
  const skip = ['**/*.md', 'docs/**'];
  assert.deepStrictEqual(WF.on.push['paths-ignore'], skip);
  assert.deepStrictEqual(WF.on.pull_request['paths-ignore'], skip);
  // The premise: no server or client CODE names a docs/ path or a .md file at all (comments
  // aside), however it would build the path. The one docs reader, scripts/sync-github-releases.js,
  // is a CI script, not the app.
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (/\.(js|html)$/.test(e.name)) files.push(p); } };
  for (const d of ['lib', 'public']) walk(path.join(ROOT, d));
  files.push(path.join(ROOT, 'server.js'));
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const names = /['"`](\.{1,2}\/)*docs['"`/]|\bdocs\/[\w.-]+\.(json|md)\b|['"`][^'"`\n]*\.md['"`]/;
  // Prose that only NAMES a doc for the reader (an error or log message), reviewed; a new mention
  // anywhere fails until someone checks it is not a read and adds it here.
  const PROSE = [['lib/db/sqlite.js', '(rollback floor: docs/RELEASING.md)'], ['lib/db/sqlite.js', '(docs/CONFIGURATION.md, "The database")'],
    ['server.js', 'see docs/CONFIGURATION.md.)']];
  const hits = files.filter((f) => {
    let src = strip(fs.readFileSync(f, 'utf8'));
    for (const [file, phrase] of PROSE) if (path.relative(ROOT, f) === file) src = src.split(phrase).join('');
    return names.test(src);
  }).map((f) => path.relative(ROOT, f));
  assert.deepStrictEqual(hits, [], 'app code names docs/ or a .md file: a docs-only change CAN change a page, so the skip is wrong');
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
  // The book scanner stamps addedAt from the real clock; unpinned, books indexed in the same
  // millisecond flipped order between runs (48 shots of books and search changed on an identical
  // tree). The seed must pin every book's addedAt from NOW, and refuse a book it cannot pin.
  assert.match(seed, /ns\.items\[b\.id\]\.addedAt = new Date\(NOW - /, 'the seed pins each book\'s addedAt from the fixture clock');
  assert.match(seed, /cannot pin addedAt for book/, 'an unpinnable book fails the seed instead of drifting');
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
  const { installSeededRandom } = require('../visual/capture.js');
  const seq = () => { const c = vm.createContext({}); c.window = c; vm.runInContext(`(${installSeededRandom.toString()})(42); globalThis.out = JSON.stringify([Math.random(), Math.random(), Math.random()])`, c); return JSON.parse(c.out); };
  const a = seq();
  assert.deepStrictEqual(seq(), a, 'Math.random repeats per document');
  assert.ok(a.every((v) => v >= 0 && v < 1) && new Set(a).size === 3);
  assert.ok(MASK_CSS.includes('#file-path-text'), 'the watch page file path (the DATA_DIR) is masked');
  assert.deepStrictEqual(CONTEXT_PINS, { timezoneId: 'UTC', locale: 'en-US', colorScheme: 'light' });
});
