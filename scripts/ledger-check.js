#!/usr/bin/env node
'use strict';
/*
 * ledger-check - binds the Tier 3 Step 3 expected-delta ledger to reality.
 *
 * The ledger (docs/exec-plans/active/tokens-tier3-step3-ledger.md) claims a
 * complete census: every site the css-token-lint metric reports appears in
 * exactly one ledger row, with the declaration text the linter sees. Any
 * CSS/JS change that lands between ledger authoring and Step 3 execution
 * invalidates those claims silently - this script makes the invalidation
 * loud. Run it at Step 3 start and before every 3a-3g commit:
 *
 *     npm run ledger:check
 *
 * Deliberately NOT part of `npm test`: unrelated waves may touch governed
 * declarations legitimately; drift must block STEP 3, not their release.
 *
 * Ledger row contract (all tables in the ledger file): cell 1 `file:line`,
 * cell 3 the declaration exactly as the linter reports it (`prop: value`).
 * Rows whose first cell does not match file:line syntax are ignored, so
 * table headers, prose, and struck done-rows (~~file:line~~) all survive.
 * Backticks in cells are stripped. A raw `|` inside a decl cell would
 * truncate the parsed decl - failure mode is a LOUD stale+unledgered
 * pair, never a silent pass, but keep pipes out of cells regardless.
 */

const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const LEDGER = path.join(REPO, 'docs/exec-plans/active/tokens-tier3-step3-ledger.md');

function collectSites(root = REPO) {
  // Mirrors css-token-lint's main() collection exactly (same module, same
  // scope) so the two tools can never disagree about what a "site" is.
  // `root` exists for the fixture suite only; production runs use REPO.
  const { lintCss, lintJs } = require('./css-token-lint.js');
  const out = [];
  lintCss(fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8'), 'public/css/style.css', 0, out);
  const subsHtml = fs.readFileSync(path.join(root, 'lib/ytdlp/views/subscriptions.html'), 'utf8');
  const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(subsHtml);
  if (styleMatch) {
    const offset = subsHtml.slice(0, styleMatch.index).split('\n').length - 1;
    lintCss(styleMatch[1], 'lib/ytdlp/views/subscriptions.html', offset, out);
  }
  for (const dir of ['public/js', 'lib/ytdlp/client']) {
    for (const f of fs.readdirSync(path.join(root, dir))) {
      if (!f.endsWith('.js')) continue;
      lintJs(fs.readFileSync(path.join(root, dir, f), 'utf8'), dir + '/' + f, out);
    }
  }
  return out.map((v) => ({ key: `${v.file}:${v.line}`, decl: `${v.prop}: ${v.value}` }));
}

function parseLedger(text) {
  const rows = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim().replace(/`/g, ''));
    if (cells.length < 3) continue;
    if (!/^[\w./-]+:\d+$/.test(cells[0])) continue; // header/separator/prose rows
    rows.push({ key: cells[0], decl: cells[2] });
  }
  return rows;
}

function ledgerCheck(sites, rows) {
  // One source line can carry SEVERAL governed declarations (cssText
  // strings, single-line CSS rules), so (file:line, decl) pairs are
  // matched as MULTISETS: every problem class - unledgered, ghost,
  // stale, duplicate rows - surfaces as a count imbalance on some pair.
  const problems = [];
  const count = new Map(); // "key decl" -> sites minus rows
  const pair = (x) => `${x.key} ${x.decl}`;
  for (const s of sites) count.set(pair(s), (count.get(pair(s)) || 0) + 1);
  for (const r of rows) count.set(pair(r), (count.get(pair(r)) || 0) - 1);
  const keysWithSites = new Set(sites.map((s) => s.key));
  const keysWithRows = new Set(rows.map((r) => r.key));
  for (const [p, c] of count) {
    if (c === 0) continue;
    const sp = p.indexOf(' '); const key = p.slice(0, sp); const decl = p.slice(sp + 1); // first space only - decls contain spaces
    if (c > 0) {
      const hint = keysWithRows.has(key) ? 'STALE ledger decl at' : 'UNLEDGERED site';
      problems.push(`${hint} ${key}  (live "${decl}" has no matching row${c > 1 ? ` x${c}` : ''})`);
    } else {
      const hint = keysWithSites.has(key)
        ? 'STALE/DUPLICATE ledger row at'
        : 'GHOST ledger row';
      problems.push(`${hint} ${key}  (ledger "${decl}" matches no live declaration${c < -1 ? ` x${-c}` : ''})`);
    }
  }
  return problems;
}

module.exports = { collectSites, parseLedger, ledgerCheck };

if (require.main === module) {
  const ledgerPath = process.argv[2] || LEDGER;
  if (!fs.existsSync(ledgerPath)) {
    console.error(`ledger-check: no ledger at ${ledgerPath}`);
    process.exit(2);
  }
  const problems = ledgerCheck(collectSites(), parseLedger(fs.readFileSync(ledgerPath, 'utf8')));
  if (problems.length === 0) {
    console.log('ledger-check: CLEAN - every linter site has exactly one current ledger row');
    process.exit(0);
  }
  console.error(`ledger-check: ${problems.length} problem(s) - the ledger no longer matches the tree; re-verify before ANY 3a-3g commit`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
