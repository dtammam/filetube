'use strict';
// scripts/prepush-scope.js: the pre-push hook skips its checks ONLY for branch deletes and
// docs-only commits; anything else, or anything unclear, runs them.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { classify, isDocsPath } = require('../../scripts/prepush-scope.js');

const Z = '0'.repeat(40);
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const line = (local, remote) => `refs/heads/x ${local} refs/heads/x ${remote}`;
const files = (list) => () => list;

test('a branch delete skips the checks', () => {
  assert.strictEqual(classify([line(Z, A)], () => { throw new Error('a delete is never diffed'); }).skip, true);
});

test('a push whose commits touch only .md files and docs/ skips the checks', () => {
  assert.strictEqual(classify([line(A, B)], files(['ROADMAP.md', 'docs/RELEASING.md', 'docs/releases.json'])).skip, true);
  assert.strictEqual(classify([line(A, Z), line(Z, B)], files(['README.md'])).skip, true, 'a new docs branch plus a delete');
});

test('any code change runs the checks', () => {
  const r = classify([line(A, B)], files(['docs/RELEASING.md', 'public/js/ui.js']));
  assert.strictEqual(r.skip, false);
  assert.match(r.why, /public\/js\/ui\.js/);
  assert.strictEqual(classify([line(Z, A), line(A, B)], files(['server.js'])).skip, false, 'a delete does not excuse a code ref beside it');
  for (const f of ['hooks/pre-push', 'test/visual/seed.js', '.github/workflows/visual.yml', 'package.json', 'docs.js', 'mydocs/x.md.js']) {
    assert.strictEqual(isDocsPath(f), false, f);
  }
});

test('anything unclear runs the checks: no lines, a malformed line, an undiffable sha, no changed files', () => {
  assert.strictEqual(classify([], files([])).skip, false);
  assert.strictEqual(classify(['', '  '], files([])).skip, false);
  assert.strictEqual(classify(['garbage'], files(['README.md'])).skip, false);
  assert.strictEqual(classify([line(A, B)], () => null).skip, false);
  assert.strictEqual(classify([line(A, B)], files([])).skip, false);
});

test('a rename counts both paths: code moved into docs/ or renamed to .md runs the checks (gate r1 W3)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'prepush-scope.js'), 'utf8');
  assert.match(src, /git\('diff', '--name-only', '--no-renames',/);
  // With both paths listed, the old code path is not docs.
  assert.strictEqual(classify([line(A, B)], files(['docs/a.js', 'lib/a.js'])).skip, false);
});

test('hooks/pre-push runs the scope first and exits only when it says skip', () => {
  const hook = fs.readFileSync(path.join(__dirname, '..', '..', 'hooks', 'pre-push'), 'utf8');
  const scope = hook.indexOf('if node scripts/prepush-scope.js; then exit 0; fi');
  assert.ok(scope !== -1, 'the hook calls the scope script');
  for (const step of ['npm run --silent lint', 'npm test']) assert.ok(hook.indexOf(step) > scope, `${step} runs after the scope check`);
});
