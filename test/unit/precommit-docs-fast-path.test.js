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

test('docsReadingTests: the real test/unit selection carries every docs census and nothing unrelated', () => {
  const picked = docsReadingTests(ROOT);
  for (const census of ['docs-link-census', 'docs-status-census', 'exec-plans-census', 'tech-debt-census']) {
    assert.ok(picked.includes(`test/unit/${census}.test.js`), `${census} must run on a docs-only commit`);
  }
  assert.ok(picked.includes('test/unit/precommit-docs-fast-path.test.js'), 'this file reads docs/ paths too');
  assert.ok(!picked.includes('test/unit/player-state.test.js'), 'a test that never reads docs/ is skipped');
  assert.ok(picked.length < fs.readdirSync(path.join(ROOT, 'test', 'unit')).length / 4, 'the fast path is a small slice');
});

// Drive the real CLI in a throwaway git repo: the exit code is the hook's contract.
// THIS FILE RUNS INSIDE THE PRE-COMMIT HOOK, where git exports GIT_DIR /
// GIT_INDEX_FILE / GIT_WORK_TREE for the repo being committed. A child git that
// inherits them operates on THAT repo, not the sandbox: the first cut of this
// test committed its fixture onto the real branch, staged its fixture paths in
// the real index, and its `git init` flipped the real repo's core.bare to true.
// Every child therefore gets an env with EVERY GIT_* variable removed, and the
// sandbox proves its git dir is its own before any write.
const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-precommit-fast-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: CLEAN_ENV });
  git('init', '-q');
  const gitDir = fs.realpathSync(path.resolve(dir, git('rev-parse', '--git-dir').trim()));
  assert.equal(gitDir, path.join(fs.realpathSync(dir), '.git'), 'the sandbox git dir must be the sandbox, never the repo under test');
  fs.mkdirSync(path.join(dir, 'test', 'unit'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'exec-plans', 'active'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'test', 'unit', 'census.test.js'), "read('docs/x.md')\n");
  fs.writeFileSync(path.join(dir, 'test', 'unit', 'other.test.js'), "read('lib/x.js')\n");
  const run = () => spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: 'utf8', env: CLEAN_ENV });
  return { dir, git, run };
}

test('CLI: a docs-only stage exits 0 and prints exactly the docs-reading tests', (t) => {
  const s = sandbox();
  t.after(() => fs.rmSync(s.dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(s.dir, 'docs', 'exec-plans', 'active', 'p.md'), '# plan\n');
  s.git('add', 'docs/exec-plans/active/p.md');
  const r = s.run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), ['test/unit/census.test.js']);
});

test('CLI: a stage with any code path exits 1 (the full hook runs)', (t) => {
  const s = sandbox();
  t.after(() => fs.rmSync(s.dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(s.dir, 'docs', 'p.md'), '# plan\n');
  fs.writeFileSync(path.join(s.dir, 'lib', 'x.js'), '1;\n');
  s.git('add', 'docs/p.md', 'lib/x.js');
  const r = s.run();
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
});

test('CLI: a rename OUT of docs/ into code is seen on both sides and exits 1', (t) => {
  const s = sandbox();
  t.after(() => fs.rmSync(s.dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(s.dir, 'docs', 'p.md'), '# plan\n'.repeat(20));
  s.git('add', 'docs/p.md');
  s.git('-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'sandbox-seed');
  s.git('mv', 'docs/p.md', 'lib/p.js');
  assert.equal(s.run().status, 1);
});

test('CLI: docs-only but no docs-reading test found exits 2 (never a silent zero-test pass)', (t) => {
  const s = sandbox();
  t.after(() => fs.rmSync(s.dir, { recursive: true, force: true }));
  fs.rmSync(path.join(s.dir, 'test', 'unit', 'census.test.js'));
  fs.writeFileSync(path.join(s.dir, 'docs', 'p.md'), '# plan\n');
  s.git('add', 'docs/p.md');
  const r = s.run();
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
});

test('CLI: nothing staged exits 1', (t) => {
  const s = sandbox();
  t.after(() => fs.rmSync(s.dir, { recursive: true, force: true }));
  assert.equal(s.run().status, 1);
});

test('the hook wires the fast path BEFORE the full checks, beside itself, and keeps the full path', () => {
  const hook = fs.readFileSync(path.join(ROOT, 'hooks', 'pre-commit'), 'utf8')
    .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const fast = hook.indexOf('precommit-docs-fast-path.js');
  assert.ok(fast > 0, 'the hook calls the selector');
  assert.match(hook, /fast_path="\$\(dirname "\$0"\)\/\.\.\/scripts\/precommit-docs-fast-path\.js"/, 'resolved beside the hook, not the committing tree');
  assert.match(hook, /if \[ -f "\$fast_path" \] && docs_tests="\$\(node "\$fast_path"\)"; then/, 'a missing selector or a non-zero exit falls through');
  assert.match(hook, /node --require \.\/test\/helpers\/tmp-cleanup\.js --test "\$\{docs_test_files\[@\]\}"/);
  const lint = hook.indexOf('npm run --silent lint');
  const unit = hook.indexOf('npm run --silent test:unit');
  assert.ok(lint > fast && unit > fast, 'the full checks still exist, after the fast path');
});
