'use strict';
// The pre-commit RELATED-TESTS selector (ci slim, 2026-10-11): a staged file selects the unit
// tests that name it, and EVERY doubt falls back to the whole unit suite (fail toward MORE).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'precommit-related-tests.js');
const { select, referencePatterns, MAX_SOURCE_FILES } = require(SCRIPT);

// A throwaway tree: test/unit/<name> files with given text, plus any extra files.
function fixture(unit, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'related-'));
  fs.mkdirSync(path.join(root, 'test', 'unit'), { recursive: true });
  for (const [n, text] of Object.entries(unit)) fs.writeFileSync(path.join(root, 'test', 'unit', n), text);
  for (const [rel, text] of Object.entries(extra)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

test('a staged unit test runs itself', () => {
  const root = fixture({ 'a.test.js': 'x', 'b.test.js': 'y' });
  const r = select(['test/unit/a.test.js'], root);
  assert.deepStrictEqual(r.tests, ['test/unit/a.test.js']);
  assert.strictEqual(r.fallback, false);
});

test('a source file selects every unit test that names its path, basename or extensionless require', () => {
  const root = fixture({
    'path.test.js': "fs.readFileSync('public/js/ui.js')",
    'req.test.js': "require('../../lib/store')",
    'join.test.js': "path.join(ROOT, 'lib', 'store.js')",
    'other.test.js': 'nothing here',
  });
  assert.deepStrictEqual(select(['public/js/ui.js'], root).tests, ['test/unit/path.test.js']);
  assert.deepStrictEqual(select(['lib/store.js'], root).tests.sort(), ['test/unit/join.test.js', 'test/unit/req.test.js']);
});

test('FALLBACK: a source file no unit test names runs the whole suite', () => {
  const root = fixture({ 'a.test.js': 'lib/known.js' });
  const r = select(['lib/known.js', 'public/css/orphan.css'], root);
  assert.strictEqual(r.fallback, true);
  assert.match(r.reason, /no unit test names public\/css\/orphan\.css/);
});

test('FALLBACK: shared machinery (test/helpers, hooks, scripts, package*.json) runs the whole suite', () => {
  const root = fixture({ 'a.test.js': 'lib/known.js test/helpers/x.js hooks/pre-commit scripts/y.js package.json' });
  for (const p of ['test/helpers/x.js', 'hooks/pre-commit', 'scripts/y.js', 'package.json', 'package-lock.json']) {
    const r = select(['lib/known.js', p], root);
    assert.strictEqual(r.fallback, true, `${p} must fall back even though a test names it`);
    assert.match(r.reason, /shared machinery/);
  }
});

test('FALLBACK: more than the source-file cap runs the whole suite; exactly the cap does not', () => {
  const names = Array.from({ length: MAX_SOURCE_FILES + 1 }, (_, i) => `lib/f${i}.js`);
  const root = fixture({ 'a.test.js': names.join(' ') });
  assert.strictEqual(select(names, root).fallback, true);
  assert.match(select(names, root).reason, /source files staged/);
  assert.strictEqual(select(names.slice(0, MAX_SOURCE_FILES), root).fallback, false);
});

test('a docs path adds the docs-reading tests; a mixed commit keeps both sets', () => {
  const root = fixture({ 'docs.test.js': "readFileSync('docs/x.md')", 'src.test.js': 'lib/a.js', 'none.test.js': 'z' });
  const r = select(['docs/plan.md', 'lib/a.js'], root);
  assert.deepStrictEqual(r.tests.sort(), ['test/unit/docs.test.js', 'test/unit/src.test.js']);
});

test('a non-unit test file selects only unit tests naming it, and never forces a fallback', () => {
  const root = fixture({ 'a.test.js': 'nothing' });
  const r = select(['test/integration/api.test.js'], root);
  assert.strictEqual(r.fallback, false);
  assert.deepStrictEqual(r.tests, []);
});

test('nothing staged selects nothing; a deleted staged unit test is not run', () => {
  const root = fixture({ 'a.test.js': 'x' });
  assert.deepStrictEqual(select([], root).tests, []);
  assert.deepStrictEqual(select(['test/unit/gone.test.js'], root).tests, []);
});

test('referencePatterns escapes regex characters in a path', () => {
  assert.ok(referencePatterns('public/js/a+b.js').test("'public/js/a+b.js'"));
  assert.ok(!referencePatterns('public/js/a+b.js').test("'public/js/aab.js'"));
});

test('CLI: exit 3 (fallback) on a staged script, exit 0 with the list on a related source, in a real repo', () => {
  const root = fixture({ 'a.test.js': 'lib/known.js' }, { 'lib/known.js': '1', 'scripts/s.js': '2' });
  const env = {};
  for (const k of Object.keys(process.env)) if (!k.startsWith('GIT_') && k !== 'NODE_TEST_CONTEXT') env[k] = process.env[k];
  const git = (...a) => spawnSync('git', a, { cwd: root, env, encoding: 'utf8' });
  git('init', '-q');
  git('add', 'lib/known.js');
  const ok = spawnSync(process.execPath, [SCRIPT], { cwd: root, env, encoding: 'utf8' });
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.strictEqual(ok.stdout.trim(), 'test/unit/a.test.js');
  git('add', 'scripts/s.js');
  const fb = spawnSync(process.execPath, [SCRIPT], { cwd: root, env, encoding: 'utf8' });
  assert.strictEqual(fb.status, 3);
  assert.match(fb.stderr, /whole unit suite/);
});

test('CLI: a selector crash (not a git repo) exits 3 = whole suite, never 0', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'related-nogit-'));
  const env = {};
  for (const k of Object.keys(process.env)) if (!k.startsWith('GIT_') && k !== 'NODE_TEST_CONTEXT') env[k] = process.env[k];
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: root, env, encoding: 'utf8' });
  assert.strictEqual(r.status, 3, r.stderr);
  assert.strictEqual(r.stdout, '', 'a crash selects nothing on stdout');
});

test('the hook wires the selector in and keeps the whole-suite fallback, lint and the UI ratchet', () => {
  const hook = fs.readFileSync(path.join(ROOT, 'hooks', 'pre-commit'), 'utf8');
  assert.match(hook, /precommit-related-tests\.js/);
  assert.match(hook, /npm run --silent test:unit/, 'the whole-suite fallback is still there');
  assert.match(hook, /npm run --silent lint\n/);
  assert.match(hook, /npm run --silent lint:ui/);
  assert.match(hook, /precommit-docs-fast-path\.js/, 'the docs-only fast path stays');
});
