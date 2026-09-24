'use strict';
// The pre-commit DOCS-ONLY fast path (Dean, 2026-09-24): a commit whose every
// staged path is Markdown under docs/ runs only the docs-reading unit tests.
// The classifier must fail toward MORE testing: anything that is not provably
// docs-only takes the full hook.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'precommit-docs-fast-path.js');
const { isDocsOnly, docsReadingTests } = require(SCRIPT);

// THIS FILE RUNS INSIDE THE PRE-COMMIT HOOK, where git exports GIT_DIR /
// GIT_INDEX_FILE (and, in a worktree, GIT_CONFIG_PARAMETERS) for the repo being
// committed. A child git that inherits them operates on THAT repo, not the
// sandbox: the first cut of this test committed its fixture onto the real
// branch, staged fixture paths in the real index, and its `git init` flipped the
// real repo's core.bare to true. The ONLY protection is the env: every child
// gets CLEAN_ENV, with every GIT_* variable removed (and NODE_TEST_CONTEXT, so a
// nested `node --test` inside the sandbox hook reports on its own). The check
// below runs at load, BEFORE any child process exists, so a sanitizer that stops
// sanitizing fails here instead of writing anywhere. (A post-init rev-parse
// check only DETECTS damage: under a worktree hook's env, `git init` has already
// written the shared config by then.)
const CLEAN_ENV = Object.fromEntries(Object.entries(process.env)
  .filter(([k]) => !k.startsWith('GIT_') && k !== 'NODE_TEST_CONTEXT'));
assert.deepEqual(Object.keys(CLEAN_ENV).filter((k) => k.startsWith('GIT_')), [], 'no GIT_* variable may reach a sandbox child');

test('isDocsOnly: only a non-empty set of docs/**/*.md paths qualifies', () => {
  assert.equal(isDocsOnly(['docs/exec-plans/active/2026-09-24-x.md']), true);
  assert.equal(isDocsOnly(['docs/exec-plans/active/a.md', 'docs/exec-plans/tech-debt-tracker.md']), true);
  // a plan close-out: the rename seen on both sides, both under docs/
  assert.equal(isDocsOnly(['docs/exec-plans/active/a.md', 'docs/exec-plans/completed/a.md']), true);
  assert.equal(isDocsOnly([]), false, 'nothing staged is not docs-only');
  assert.equal(isDocsOnly(['docs/a.md', 'lib/x.js']), false, 'one code path spoils it');
  assert.equal(isDocsOnly(['docs/releases.json']), false, 'the ledger is JSON with its own checker test');
  assert.equal(isDocsOnly(['ROADMAP.md']), false, 'root Markdown is outside docs/');
  assert.equal(isDocsOnly(['docs/a.md.js']), false, 'the extension is anchored');
  assert.equal(isDocsOnly(['public/docs/a.md']), false, 'docs/ is anchored at the root');
  assert.equal(isDocsOnly(['docs/diagram.svg']), false, 'non-Markdown under docs/ is not fast');
});

// Every unit test measured to touch docs/ AT RUNTIME (gate r1: a file-access
// trace over the whole unit suite, including spawned node CLIs). Each must stay
// in the selection; dropping any alternative of READS_DOCS that finds one fails.
const RUNTIME_DOCS_READERS = [
  'audit-check', 'comment-debt-census', 'critter-manager', 'docs-diagrams-census',
  'docs-link-census', 'docs-status-census', 'exec-plans-census', 'precommit-docs-fast-path',
  'release-ledger', 'shimmer-tranche2', 'tech-debt-census',
];

test('docsReadingTests: the real selection carries every measured runtime docs reader and skips unrelated tests', () => {
  const picked = docsReadingTests(ROOT);
  for (const name of RUNTIME_DOCS_READERS) {
    assert.ok(picked.includes(`test/unit/${name}.test.js`), `${name} reads docs/ at runtime and must run on a docs-only commit`);
  }
  assert.ok(!picked.includes('test/unit/player-state.test.js'), 'a test that never reads docs/ is skipped');
  assert.ok(picked.length < fs.readdirSync(path.join(ROOT, 'test', 'unit')).length / 4, 'the fast path is a small slice');
});

// A throwaway git repo. Cleanup is registered BEFORE any work so a throw never leaks the dir.
function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-precommit-fast-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: CLEAN_ENV });
  git('init', '-q');
  const gitDir = fs.realpathSync(path.resolve(dir, git('rev-parse', '--git-dir').trim()));
  assert.equal(gitDir, path.join(fs.realpathSync(dir), '.git'), 'the sandbox git dir must be the sandbox, never the repo under test');
  const write = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  };
  const commit = (msg) => git('-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg);
  for (const d of ['docs', 'lib']) fs.mkdirSync(path.join(dir, d));
  write('test/unit/census.test.js', "read('docs/x.md')\n");
  write('test/unit/other.test.js', "read('lib/x.js')\n");
  const run = () => spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', env: CLEAN_ENV });
  return { dir, git, write, commit, run };
}

test('CLI: a docs-only stage exits 0 and prints exactly the docs-reading tests', (t) => {
  const s = sandbox(t);
  s.write('docs/exec-plans/active/p.md', '# plan\n');
  s.git('add', 'docs/exec-plans/active/p.md');
  const r = s.run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), ['test/unit/census.test.js']);
});

test('CLI: a stage with any code path exits 1 (the full hook runs)', (t) => {
  const s = sandbox(t);
  s.write('docs/p.md', '# plan\n');
  s.write('lib/x.js', '1;\n');
  s.git('add', 'docs/p.md', 'lib/x.js');
  const r = s.run();
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
});

test('CLI: a rename of CODE INTO docs/ is seen on both sides and exits 1 (the --no-renames guard)', (t) => {
  // With rename detection on, `git diff --cached --name-only` lists only the NEW
  // (docs) path, so deleting code by moving it to docs/x.md would look docs-only.
  const s = sandbox(t);
  s.write('lib/x.js', 'module.exports = 1;\n'.repeat(20));
  s.git('add', 'lib/x.js');
  s.commit('sandbox-seed');
  s.git('mv', 'lib/x.js', 'docs/x.md');
  assert.equal(s.run().status, 1);
});

test('CLI: a rename OUT of docs/ into code exits 1', (t) => {
  const s = sandbox(t);
  s.write('docs/p.md', '# plan\n'.repeat(20));
  s.git('add', 'docs/p.md');
  s.commit('sandbox-seed');
  s.git('mv', 'docs/p.md', 'lib/p.js');
  assert.equal(s.run().status, 1);
});

test('CLI: docs-only but no docs-reading test found exits 2 (never a silent zero-test pass)', (t) => {
  const s = sandbox(t);
  fs.rmSync(path.join(s.dir, 'test', 'unit', 'census.test.js'));
  s.write('docs/p.md', '# plan\n');
  s.git('add', 'docs/p.md');
  const r = s.run();
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
});

test('CLI: nothing staged exits 1', (t) => {
  const s = sandbox(t);
  assert.equal(s.run().status, 1);
});

// The REAL hook, end to end, in a sandbox repo: a docs-only commit that breaks a
// docs-reading test is REFUSED (non-zero, HEAD unchanged); a good one lands.
// This binds the hook's own wiring (an `|| true`, an early `exit 0`, `set +e`, a
// disabled run), which a source lock cannot.
test('the real hook on a docs-only commit: a failing docs test refuses the commit, a passing one lands', (t) => {
  const s = sandbox(t);
  fs.mkdirSync(path.join(s.dir, 'hooks'));
  fs.copyFileSync(path.join(ROOT, 'hooks', 'pre-commit'), path.join(s.dir, 'hooks', 'pre-commit'));
  fs.chmodSync(path.join(s.dir, 'hooks', 'pre-commit'), 0o755);
  s.write('scripts/precommit-docs-fast-path.js', fs.readFileSync(SCRIPT, 'utf8'));
  s.write('test/helpers/tmp-cleanup.js', fs.readFileSync(path.join(ROOT, 'test', 'helpers', 'tmp-cleanup.js'), 'utf8'));
  // node_modules resolves the way the hook does: walking UP from the tree (a worktree has none of its own).
  let nm = ROOT;
  while (!fs.existsSync(path.join(nm, 'node_modules')) && path.dirname(nm) !== nm) nm = path.dirname(nm);
  fs.symlinkSync(path.join(nm, 'node_modules'), path.join(s.dir, 'node_modules'));
  s.write('test/unit/census.test.js', [
    "'use strict';",
    "const test = require('node:test'); const assert = require('node:assert'); const fs = require('fs');",
    "test('docs/p.md is sound', () => { assert.doesNotMatch(fs.readFileSync('docs/p.md', 'utf8'), /BROKEN/); });",
    '',
  ].join('\n'));
  s.write('docs/p.md', '# plan\n');
  s.git('add', 'docs/p.md', 'test/unit/census.test.js', 'test/unit/other.test.js');
  s.commit('sandbox-seed');
  const head = () => s.git('rev-parse', 'HEAD').trim();
  const hooked = (msg) => spawnSync('git', ['-c', 'core.hooksPath=hooks', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg],
    { cwd: s.dir, encoding: 'utf8', env: CLEAN_ENV });

  const seed = head();
  s.write('docs/p.md', '# plan\nBROKEN\n');
  s.git('add', 'docs/p.md');
  const bad = hooked('bad docs');
  assert.match(bad.stdout + bad.stderr, /docs-only commit: the docs-reading unit tests/, 'the fast path was the one taken');
  assert.notEqual(bad.status, 0, 'a failing docs-reading test must refuse the commit');
  assert.equal(head(), seed, 'the refused commit did not land');

  s.write('docs/p.md', '# plan\nfine\n');
  s.git('add', 'docs/p.md');
  const good = hooked('good docs');
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout + good.stderr, /Pre-commit checks passed \(docs-only\)\./);
  assert.notEqual(head(), seed, 'the passing commit landed');
});

test('the hook resolves the selector BESIDE ITSELF and keeps the full checks after the fast path', () => {
  const hook = fs.readFileSync(path.join(ROOT, 'hooks', 'pre-commit'), 'utf8')
    .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const fast = hook.indexOf('precommit-docs-fast-path.js');
  assert.ok(fast > 0, 'the hook calls the selector');
  assert.match(hook, /fast_path="\$\(dirname "\$0"\)\/\.\.\/scripts\/precommit-docs-fast-path\.js"/, 'resolved beside the hook, not the committing tree');
  assert.match(hook, /if \[ -f "\$fast_path" \] && docs_tests="\$\(node "\$fast_path"\)"; then/, 'a missing selector or a non-zero exit falls through');
  const lint = hook.indexOf('npm run --silent lint');
  const unit = hook.indexOf('npm run --silent test:unit');
  assert.ok(lint > fast && unit > fast, 'the full checks still exist, after the fast path');
});
