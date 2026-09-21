'use strict';

// [UNIT] v1.129 Wave C (C4) - the tech-debt tracker census, checker-first.
//
// External review round 2: "the tracker's structure is misleading - most rows
// explicitly marked OPEN sit after ## Closed, while the session-start hook
// counts only the earlier Active section" (the hook injected 42 into every
// session while ~114 items were actually open). The invariant bound here:
//   1. STRUCTURE HONESTY - no OPEN-status row may sit under a heading that
//      claims closure. (The fix retitles the chronological region to
//      "## Ledger"; the STATUS cell is authoritative, not the heading.)
//
// A second invariant, HOOK TRUTH, used to assert that
// .claude/hooks/session-start.sh injected this same open count. It was RETIRED
// on the handoff-harness v2 adoption (2026-09-21): the v2 SessionStart hook
// deliberately injects only git- and marker-derived facts, never a stored or
// derived count that can silently rot - so there is no longer a hook-injected
// count to bind. The structure invariant above is the surviving, substantive
// check on the tracker document itself.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const TRACKER = path.join(REPO, 'docs', 'exec-plans', 'tech-debt-tracker.md');

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
    // Strip leading emphasis markup before the OPEN test (gate W2): a bolded
    // `**OPEN**` status cell must still be recognized as open by the `openCell`
    // check below, or the divergent-spelling class - the same status slipping
    // past a naive match - lets an open row read as closed. The strip is what
    // this census exists to keep honest.
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
