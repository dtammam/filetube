'use strict';

// [UNIT] v1.129 Wave C (C4) - the tech-debt tracker census, checker-first.
//
// External review round 2: "the tracker's structure is misleading - most rows
// explicitly marked OPEN sit after ## Closed, while the session-start hook
// counts only the earlier Active section" (the hook injected 42 into every
// session while ~114 items were actually open). Two invariants, both bound
// here:
//   1. STRUCTURE HONESTY - no OPEN-status row may sit under a heading that
//      claims closure. (The fix retitles the chronological region to
//      "## Ledger"; the STATUS cell is authoritative, not the heading.)
//   2. HOOK TRUTH - the count .claude/hooks/session-start.sh injects must
//      equal the count THIS test derives independently (legacy Active-table
//      rows + OPEN-status rows anywhere). The test EXECUTES the real hook -
//      a drifted awk expression fails here, not silently in every session.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..');
const TRACKER = path.join(REPO, 'docs', 'exec-plans', 'tech-debt-tracker.md');
const HOOK = path.join(REPO, '.claude', 'hooks', 'session-start.sh');

function parseTracker() {
  const lines = fs.readFileSync(TRACKER, 'utf8').split('\n');
  let heading = '';
  let inActiveTable = false;
  const rows = [];
  for (const line of lines) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) { heading = h[1]; inActiveTable = /^Active\b/.test(heading); continue; }
    // The id cell may carry an annotation: `| 12 (AF1) | ...` (three such rows
    // in the Active table; the first checker run missed them and disagreed
    // with the hook by exactly 3).
    const r = line.match(/^\|\s*(\d+)\s*(?:\([^)|]*\))?\s*\|/);
    if (!r) continue;
    // The LAST cell (trailing `| ... |`) carries the status in the ledger
    // layout; the legacy Active table has no status cell (presence = open).
    const lastMatch = line.match(/\|\s*([^|]*)\|\s*$/);
    // Strip leading emphasis markup before the OPEN test (gate W2: a bolded
    // `**OPEN**` cell silently vanished from BOTH this parse and the hook's
    // grep - the divergent-spelling class inside the very census built to
    // kill it). The hook's grep tolerates the same markup; if the two ever
    // disagree on a new variant, the hook-truth test below goes red.
    const lastCell = (lastMatch ? lastMatch[1] : '').trim().replace(/^[*_]+/, '');
    rows.push({ id: Number(r[1]), heading, inActiveTable, openCell: /^OPEN\b/.test(lastCell) });
  }
  return rows;
}

test('every OPEN row lives under an Active or Ledger heading (structure honesty)', () => {
  // The review's find: OPEN rows were appended into the region following
  // "## Closed" (their nearest heading was a stale numbered section), so a
  // reader scanning headings took them for closed history. An OPEN row may
  // live only under the legacy "## Active" table or the chronological
  // "## Ledger" (whose preamble states the STATUS cell is authoritative).
  const offenders = parseTracker()
    .filter((r) => (r.openCell || r.inActiveTable) && !/^(Active|Ledger)\b/.test(r.heading))
    .map((r) => `#${r.id} under "## ${r.heading}"`);
  assert.deepStrictEqual(offenders, [],
    `OPEN row(s) outside the Active/Ledger sections - a new row belongs in the\n`
    + `Ledger (append, status cell last); a heading must never imply an open row is\n`
    + `closed:\n  ${offenders.join('\n  ')}`);
});

test('the session-start hook injects the TRUE open count (hook executed, not assumed)', () => {
  const rows = parseTracker();
  const trueOpen = rows.filter((r) => r.inActiveTable || r.openCell).length;
  assert.ok(trueOpen > 0, 'sanity: some open debt exists');

  const out = execFileSync('bash', [HOOK], { cwd: REPO, encoding: 'utf8' });
  const m = out.match(/Tech debt items:\s*(\d+)/);
  assert.ok(m, `the hook printed no "Tech debt items: N" line:\n${out}`);
  assert.strictEqual(Number(m[1]), trueOpen,
    `the session-start hook injects ${m[1]} but ${trueOpen} rows are actually open `
    + `(Active-table rows + OPEN-status rows anywhere) - fix the hook's expression or the tracker`);
});
