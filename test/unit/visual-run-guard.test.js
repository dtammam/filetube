'use strict';

// Gate r1 (qa 4, NOTE 9): test/visual/run.js empties --out on every run and --update rewrites
// test/visual/baselines/. Both are tooling that deletes paths, so both carry a guard, bound
// here on temp dirs (test/visual/run-fs.js) and, for the wiring, through the real run.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const { OUT_MARKER, outDirRefusal, prepareOutDir, replaceBaselines } = require('../visual/run-fs.js');

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

test('prepareOutDir refuses a non-empty dir without the marker and deletes nothing in it', () => {
  const dir = tmp('ft-visual-out-');
  try {
    fs.writeFileSync(path.join(dir, 'precious.txt'), 'keep me');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'also.txt'), 'keep me too');
    assert.throws(() => prepareOutDir(dir), /refusing to empty --out: .*not made by run\.js/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'precious.txt'), 'utf8'), 'keep me');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'sub', 'also.txt'), 'utf8'), 'keep me too');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('prepareOutDir empties a dir it made before (marker), and makes an absent or empty one', () => {
  const parent = tmp('ft-visual-out-');
  try {
    const absent = path.join(parent, 'fresh');
    prepareOutDir(absent);
    assert.deepStrictEqual(fs.readdirSync(absent), [OUT_MARKER]);
    fs.writeFileSync(path.join(absent, 'old-shot.png'), 'x');
    prepareOutDir(absent);
    assert.deepStrictEqual(fs.readdirSync(absent), [OUT_MARKER], 'a marked dir is emptied (the run before it is gone)');
    const empty = path.join(parent, 'empty');
    fs.mkdirSync(empty);
    prepareOutDir(empty);
    assert.deepStrictEqual(fs.readdirSync(empty), [OUT_MARKER]);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('the root, the repo root, $HOME and any dir containing them are refused even with a marker', () => {
  const home = tmp('ft-visual-home-');
  const repo = path.join(home, 'projects', 'repo');
  try {
    fs.mkdirSync(repo, { recursive: true });
    for (const d of [home, repo, path.join(home, 'projects')]) fs.writeFileSync(path.join(d, OUT_MARKER), '');
    const opts = { repo, home };
    assert.match(outDirRefusal('/', opts), /filesystem root/);
    assert.match(outDirRefusal(repo, opts), /the repo root/);
    assert.match(outDirRefusal(home, opts), /\$HOME|the repo root/);
    assert.match(outDirRefusal(path.join(home, 'projects'), opts), /the repo root/);
    assert.match(outDirRefusal(path.dirname(home), opts), /\$HOME|the repo root/);
    assert.throws(() => prepareOutDir(repo, opts), /refusing/);
    assert.ok(fs.existsSync(path.join(repo, OUT_MARKER)), 'nothing was deleted');
    // A marked dir INSIDE the repo is fine (CI's test-results/visual).
    const inside = path.join(repo, 'test-results', 'visual');
    assert.strictEqual(outDirRefusal(inside, opts), null);
    // The defaults are the real repo and the real $HOME.
    assert.match(outDirRefusal(ROOT), /the repo root/);
    assert.match(outDirRefusal(os.homedir()), /\$HOME|the repo root/);
    // A file is never emptied.
    const file = path.join(home, 'a-file');
    fs.writeFileSync(file, 'x');
    assert.match(outDirRefusal(file, opts), /not a directory/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('run.js refuses an unmarked non-empty --out with exit 2 before seeding, and leaves it intact', () => {
  const out = tmp('ft-visual-out-');
  const base = tmp('ft-visual-base-');
  const data = path.join(tmp('ft-visual-data-'), 'never-made');
  try {
    fs.writeFileSync(path.join(out, 'precious.txt'), 'keep me');
    fs.writeFileSync(path.join(base, '01-home--phone.png'), 'x');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'test', 'visual', 'run.js'), '--out', out, '--baselines', base, '--data', data],
      { encoding: 'utf8', timeout: 30000 });
    assert.strictEqual(r.status, 2, r.stderr);
    assert.match(r.stderr, /refusing to empty --out/);
    assert.strictEqual(fs.readFileSync(path.join(out, 'precious.txt'), 'utf8'), 'keep me');
    assert.ok(!fs.existsSync(data), 'nothing was seeded');
  } finally {
    for (const d of [out, base, path.dirname(data)]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test('replaceBaselines: a filtered --update replaces only the baselines in its scope', () => {
  const base = tmp('ft-visual-base-');
  const shots = tmp('ft-visual-shots-');
  try {
    for (const f of ['04-a--phone.png', '04-a--phone-2005.png', '18-b--desktop.png', '18-b--desktop-2005.png']) fs.writeFileSync(path.join(base, f), 'old');
    fs.writeFileSync(path.join(shots, '04-a--phone.png'), 'new');
    // The filter run.js builds for --only 04 --era 2021.
    const inScope = (f) => f.startsWith('04') && !/-(2014|2009|2005)\.png$/.test(f);
    const r = replaceBaselines(base, shots, inScope);
    assert.deepStrictEqual(r, { removed: 1, written: 1, total: 4 });
    assert.strictEqual(fs.readFileSync(path.join(base, '04-a--phone.png'), 'utf8'), 'new');
    for (const f of ['04-a--phone-2005.png', '18-b--desktop.png', '18-b--desktop-2005.png']) {
      assert.strictEqual(fs.readFileSync(path.join(base, f), 'utf8'), 'old', `${f} is outside the filter and kept`);
    }
  } finally { for (const d of [base, shots]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('replaceBaselines: a full --update replaces the whole set (a retired scene drops out)', () => {
  const base = tmp('ft-visual-base-');
  const shots = tmp('ft-visual-shots-');
  try {
    for (const f of ['04-a--phone.png', '99-retired--phone.png']) fs.writeFileSync(path.join(base, f), 'old');
    fs.writeFileSync(path.join(shots, '04-a--phone.png'), 'new');
    const r = replaceBaselines(base, shots, null);
    assert.deepStrictEqual(r, { removed: 2, written: 1, total: 1 });
    assert.deepStrictEqual(fs.readdirSync(base), ['04-a--phone.png']);
  } finally { for (const d of [base, shots]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('run.js wires both: the guard before seeding and the scope into --update', () => {
  const src = fs.readFileSync(path.join(ROOT, 'test', 'visual', 'run.js'), 'utf8');
  assert.match(src, /replaceBaselines\(BASELINES, shots, FILTERED \? scope : null\)/);
  assert.ok(!/fs\.rmSync\(OUT/.test(src), 'no unguarded rmSync of --out');
  assert.ok(!/unlinkSync/.test(src), 'no baseline unlink outside replaceBaselines');
});
