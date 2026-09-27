'use strict';

// [UNIT] The shrink-only ratchet on docs/ui-exceptions.json (UI professionalism pass, plan D10.3).
//
// ui-lint --enforce holds the file EQUAL to the live debt, so a commit that adds debt must also
// add an entry. This test is the other half: against the merge-base with origin/main
// (`git show $(git merge-base HEAD origin/main):docs/ui-exceptions.json`), the file may only
// shrink - a key added or a count raised fails. It SKIPS with a notice when there is no git, no
// origin/main (a shallow CI checkout needs fetch-depth: 0) or no base file (before the baseline
// lands on main).
//
// LESSONS 13 (hook env): this file runs inside the pre-commit hook, where git exports GIT_DIR /
// GIT_INDEX_FILE (and, in a worktree, GIT_CONFIG_PARAMETERS) for the repo being committed. Every
// git call here runs with the GIT_* variables scrubbed and an explicit cwd, so it reads the repo
// it names, never the hook's.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { compareRatchet, validateExceptions } = require('../../scripts/ui-lint.js');

const REPO = path.join(__dirname, '..', '..');
const REL = 'docs/ui-exceptions.json';

function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return env;
}
function git(args, cwd) {
  return execFileSync('git', args, { cwd, env: cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** {skip: reason} or {problems: [...]} for the tree at `root`. */
function ratchetCheck(root) {
  let base;
  try {
    base = git(['merge-base', 'HEAD', 'origin/main'], root).trim();
  } catch (e) {
    return { skip: `no merge-base with origin/main (${String(e.stderr || e.message).split('\n')[0].trim()})` };
  }
  let baseText = null;
  try { baseText = git(['show', `${base}:${REL}`], root); } catch { /* no file at the base */ }
  if (baseText == null) return { skip: `the merge-base ${base.slice(0, 8)} has no ${REL}` };
  const curPath = path.join(root, REL);
  if (!fs.existsSync(curPath)) return { problems: [`${REL} was deleted; the ratchet file may only shrink`] };
  let baseData, cur;
  try { baseData = JSON.parse(baseText); } catch (e) { return { problems: [`the merge-base's ${REL} is not JSON: ${e.message}`] }; }
  try { cur = JSON.parse(fs.readFileSync(curPath, 'utf8')); } catch (e) { return { problems: [`${REL} is not JSON: ${e.message}`] }; }
  const shape = validateExceptions(cur);
  if (shape.length) return { problems: shape.map((s) => `${REL} malformed: ${s}`) };
  return { problems: compareRatchet(baseData, cur) };
}

test('docs/ui-exceptions.json only shrinks against the merge-base with origin/main', (t) => {
  let r;
  try { r = ratchetCheck(REPO); } catch (e) { r = { skip: `git unavailable: ${e.message}` }; }
  if (r.skip) {
    t.diagnostic(`ui-exceptions ratchet SKIPPED: ${r.skip}`);
    t.skip(r.skip);
    return;
  }
  assert.deepStrictEqual(r.problems, [], `the exceptions file grew:\n${r.problems.join('\n')}`);
});

test('compareRatchet: a key added or a count raised fails; lowered, removed and equal pass', () => {
  const base = { rules: { 'hover-gated': [{ key: 'a', count: 2 }, { key: 'b', count: 1 }], icons: [{ key: 'c', count: 3 }] } };
  const clone = () => JSON.parse(JSON.stringify(base));
  assert.deepStrictEqual(compareRatchet(base, clone()), []);
  const lowered = clone(); lowered.rules['hover-gated'][0].count = 1; lowered.rules.icons = [];
  assert.deepStrictEqual(compareRatchet(base, lowered), []);
  const raised = clone(); raised.rules.icons[0].count = 4;
  assert.deepStrictEqual(compareRatchet(base, raised), ['icons: count raised: c 3 -> 4']);
  const added = clone(); added.rules['hover-gated'].push({ key: 'z', count: 1 });
  assert.deepStrictEqual(compareRatchet(base, added), ['hover-gated: key added: z (count 1)']);
  const moved = clone(); moved.rules['z-ladder'] = [moved.rules['hover-gated'].pop()];
  assert.deepStrictEqual(compareRatchet(base, moved), ['z-ladder: key added: b (count 1)'], 'a key is per rule: moving it to another rule is an add');
});

test('ratchetCheck reads the merge-base through git with the hook env scrubbed', (t) => {
  try { git(['--version'], REPO); } catch { t.skip('no git'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ui-ratchet-'));
  const g = (...args) => git(['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], dir);
  const write = (data) => fs.writeFileSync(path.join(dir, REL), JSON.stringify(data));
  const file = (count, extra) => ({ comment: 'c', rules: { 'hover-gated': [{ key: 'k', count, reason: 'r', added: '2026-09-27' }, ...(extra || [])] } });
  try {
    g('init', '-q', '-b', 'work');
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'README'), 'x');
    g('add', 'README');
    g('commit', '-q', '-m', 'no file yet');
    g('update-ref', 'refs/remotes/origin/main', 'HEAD');
    write(file(2));
    assert.match(ratchetCheck(dir).skip || '', /has no docs\/ui-exceptions\.json/, 'no base file: skip');

    g('add', REL);
    g('commit', '-q', '-m', 'baseline');
    g('update-ref', 'refs/remotes/origin/main', 'HEAD');
    g('commit', '-q', '--allow-empty', '-m', 'branch work');
    assert.deepStrictEqual(ratchetCheck(dir).problems, [], 'unchanged');
    write(file(1));
    assert.deepStrictEqual(ratchetCheck(dir).problems, [], 'shrunk');
    write(file(3));
    assert.deepStrictEqual(ratchetCheck(dir).problems, ['hover-gated: count raised: k 2 -> 3']);
    write(file(2, [{ key: 'new', count: 1, reason: 'r', added: '2026-09-27' }]));
    assert.deepStrictEqual(ratchetCheck(dir).problems, ['hover-gated: key added: new (count 1)']);
    write({ comment: 'c', rules: { 'hover-gated': [{ key: 'k', count: 0 }] } });
    assert.match(ratchetCheck(dir).problems.join('\n'), /malformed/);
    fs.rmSync(path.join(dir, REL));
    assert.deepStrictEqual(ratchetCheck(dir).problems, [`${REL} was deleted; the ratchet file may only shrink`]);

    // a hostile hook env pointing git elsewhere is ignored
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(os.tmpdir(), 'filetube-no-such-git-dir');
    try {
      write(file(3));
      assert.deepStrictEqual(ratchetCheck(dir).problems, ['hover-gated: count raised: k 2 -> 3']);
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = saved;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
