'use strict';
// Fixture suite for scripts/ledger-check.js (the Step 3 ledger drift gate).
// Pure-function coverage only - the repo-bound collectSites() path is
// exercised at Step 3 time by `npm run ledger:check`, deliberately not in
// CI (unrelated waves may legitimately move governed declarations; drift
// blocks Step 3, not their release). Each failure mode below exists
// because a checker hole here would let a stale ledger green a 3a-3g
// commit - the exact class the metric tooling keeps teaching us about.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectSites, parseLedger, ledgerCheck } = require('../../scripts/ledger-check.js');

const site = (key, decl) => ({ key, decl });

test('clean: every site ledgered once with matching decl', () => {
  const sites = [site('public/css/style.css:10', 'padding: 18px'), site('public/js/stats.js:342', 'color: #cc0000')];
  const rows = [site('public/css/style.css:10', 'padding: 18px'), site('public/js/stats.js:342', 'color: #cc0000')];
  assert.deepStrictEqual(ledgerCheck(sites, rows), []);
});

test('unledgered site is reported with its declaration', () => {
  const problems = ledgerCheck([site('public/css/style.css:10', 'padding: 18px')], []);
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /UNLEDGERED site public\/css\/style\.css:10/);
  assert.match(problems[0], /padding: 18px/);
});

test('stale declaration text is reported from BOTH sides (byte-exact comparison)', () => {
  const problems = ledgerCheck(
    [site('public/css/style.css:10', 'padding: 16px')],
    [site('public/css/style.css:10', 'padding: 18px')]
  );
  // Multiset semantics: the live decl with no row AND the row with no live
  // decl each surface - two problems, so neither direction can be missed.
  assert.strictEqual(problems.length, 2);
  assert.ok(problems.some((p) => /STALE ledger decl at public\/css\/style\.css:10/.test(p) && /padding: 16px/.test(p)));
  assert.ok(problems.some((p) => /STALE\/DUPLICATE ledger row at public\/css\/style\.css:10/.test(p) && /padding: 18px/.test(p)));
});

test('multi-declaration lines: several rows per file:line are legitimate, not duplicates', () => {
  // cssText strings and single-line CSS rules put many governed
  // declarations on ONE line - the linter reports each separately.
  const sites = [
    site('public/js/stats.js:161', 'gap: 10px'),
    site('public/js/stats.js:161', 'padding: 8px 4px'),
  ];
  assert.deepStrictEqual(ledgerCheck(sites, [sites[1], sites[0]]), []);
});

test('ghost ledger row (site vanished or moved lines) is reported', () => {
  const problems = ledgerCheck([], [site('public/css/style.css:10', 'padding: 18px')]);
  assert.strictEqual(problems.length, 1);
  assert.match(problems[0], /GHOST ledger row public\/css\/style\.css:10/);
});

test('duplicate ledger rows for one site are reported', () => {
  const problems = ledgerCheck(
    [site('public/css/style.css:10', 'padding: 18px')],
    [site('public/css/style.css:10', 'padding: 18px'), site('public/css/style.css:10', 'padding: 18px')]
  );
  assert.strictEqual(problems.filter((p) => /DUPLICATE/.test(p)).length, 1);
});

test('a moved line reports BOTH unledgered and ghost (not a silent pass)', () => {
  // The same declaration drifting from line 10 to line 12 must not cancel
  // out - key includes the line number by design.
  const problems = ledgerCheck(
    [site('public/css/style.css:12', 'padding: 18px')],
    [site('public/css/style.css:10', 'padding: 18px')]
  );
  assert.strictEqual(problems.length, 2);
});

test('parseLedger: takes cells 1 and 3, strips backticks, skips headers/separators/prose', () => {
  const md = [
    '# 3a spacing drift',
    'Prose with | a pipe stays ignored.',
    '| file:line | selector | declaration | bucket | after | delta |',
    '|---|---|---|---|---|---|',
    '| public/css/style.css:1035 | .dropdown-item | `padding: 7px 12px` | B2-DRIFT | `padding: var(--space-3) var(--space-6)` | 7px->6px |',
    '| lib/ytdlp/views/subscriptions.html:44 | .sub-row | margin: 9px | B2-DRIFT | margin: var(--space-4) | 9px->8px |',
  ].join('\n');
  assert.deepStrictEqual(parseLedger(md), [
    { key: 'public/css/style.css:1035', decl: 'padding: 7px 12px' },
    { key: 'lib/ytdlp/views/subscriptions.html:44', decl: 'margin: 9px' },
  ]);
});

test('parseLedger: a row with too few cells or a non-site first cell contributes nothing', () => {
  assert.deepStrictEqual(parseLedger('| just | two |\n| not-a-site | x | padding: 4px |'), []);
});

test('parseLedger: a struck first cell (~~file:line~~) hides the row - the done-marking convention', () => {
  // The Step 3 protocol strikes adopted rows; the checker must stop
  // seeing them or every completed batch turns the gate red.
  const md = [
    '| ~~public/css/style.css:10~~ | .done | padding: var(--space-4) | B2-DRIFT | - | done |',
    '| public/css/style.css:11 | .live | padding: 18px | B2-DRIFT | x | 18px->16px |',
  ].join('\n');
  assert.deepStrictEqual(parseLedger(md), [{ key: 'public/css/style.css:11', decl: 'padding: 18px' }]);
});

test('collectSites: keys carry file AND line; two same-file sites stay distinct', () => {
  // Kills the mutant that drops the line number from the key - with it,
  // every multi-hit file collapses into bogus DUPLICATEs at runtime.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-fixture-'));
  fs.mkdirSync(path.join(root, 'public/css'), { recursive: true });
  fs.mkdirSync(path.join(root, 'public/js'), { recursive: true });
  fs.mkdirSync(path.join(root, 'lib/ytdlp/views'), { recursive: true });
  fs.mkdirSync(path.join(root, 'lib/ytdlp/client'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public/css/style.css'),
    '.a {\n  padding: 7px;\n}\n.b {\n  margin: 9px;\n}\n');
  fs.writeFileSync(path.join(root, 'lib/ytdlp/views/subscriptions.html'), '<html></html>\n');
  try {
    const sites = collectSites(root);
    const cssKeys = sites.map((s) => s.key).filter((k) => k.startsWith('public/css/style.css:'));
    assert.strictEqual(cssKeys.length, 2);
    assert.strictEqual(new Set(cssKeys).size, 2, 'same-file sites must not share a key');
    for (const k of cssKeys) assert.match(k, /^public\/css\/style\.css:\d+$/);
    assert.deepStrictEqual(ledgerCheck(sites, sites.map((s) => ({ ...s }))), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
