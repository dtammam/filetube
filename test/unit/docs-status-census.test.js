'use strict';

// [UNIT] v1.129 Wave C (C1) - the completed-plan STATUS census, checker-first.
//
// The divergent-spelling class has now struck the SAME docs sweep THREE times:
// v1.125's reset caught `Status:`-at-line-start but 8 all-caps `STATUS` lines
// survived; its own follow-up then missed the bullet+bold `- **Status:**`
// spelling (external review round 2 caught three completed plans still opening
// with `- **Status:** APPROVED ...`). The lesson this file enforces: a cleanup
// sweep is DERIVED by a checker that recognizes every observed spelling, never
// a hand-aimed grep. This census scans every completed plan for its FIRST
// status-like line and fails unless the value is TERMINAL - so a plan can
// never again sit in completed/ describing itself as in-flight.
//
// Terminal = the plan's first status line starts (after markup) with one of:
// SHIPPED / CLOSED / SUPERSEDED / ARCHIVED / MERGED / DONE / COMPLETE(D) /
// RETIRED. Case-insensitive. Anything else (APPROVED, IN PROGRESS, PLANNED,
// DRAFT, ...) is a violation listed by file with its offending line.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const COMPLETED_DIR = path.join(__dirname, '..', '..', 'docs', 'exec-plans', 'completed');

// Every status-line spelling OBSERVED in this repo's history (the class keeps
// finding new costumes; add the new spelling here WITH a comment when it does):
//   `Status: X`  ·  `**Status:** X`  ·  `- **Status:** X`  ·  `- Status: X`
//   `STATUS: X`  ·  `## Status` (heading followed by the value on the line)
// The regex: optional list marker, optional bold markers, the word status
// (any case), optional closing bold, a colon (inside or outside the bold),
// then the value.
const STATUS_LINE = /^\s*(?:[-*]\s+)?(?:\*\*)?status(?::\*\*|\*\*:|:)\s*(.+)$/i;

// An optional leading version token is allowed ("Status: **v1.42.0 SHIPPED
// ...**" - a real spelling this checker itself surfaced on its first run;
// terminal in substance, version-first in shape).
const TERMINAL = /^(?:\*\*)?\s*(?:v?\d+[\w.]*\s+)?(shipped|closed|superseded|archived|merged|done|completed?|retired)\b/i;

function firstStatus(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(STATUS_LINE);
    if (m) return { line: i + 1, value: m[1].trim(), raw: lines[i].trim() };
  }
  return null;
}

test('every completed plan\'s FIRST status line is TERMINAL (checker-first, the divergent-spelling class)', () => {
  const files = fs.readdirSync(COMPLETED_DIR).filter((f) => f.endsWith('.md'));
  assert.ok(files.length > 30, `sanity: the completed dir has real content (found ${files.length})`);
  const violations = [];
  const statusless = [];
  for (const f of files) {
    const full = path.join(COMPLETED_DIR, f);
    const st = firstStatus(full);
    if (!st) { statusless.push(f); continue; }
    if (!TERMINAL.test(st.value)) violations.push(`${f}:${st.line}  ${st.raw}`);
  }
  assert.deepStrictEqual(violations, [],
    `completed plan(s) whose FIRST status is NOT terminal - a completed plan must open\n`
    + `SHIPPED/CLOSED/SUPERSEDED/ARCHIVED/... (fix the doc, or if this is a NEW status\n`
    + `spelling, add it to STATUS_LINE with a comment):\n  ${violations.join('\n  ')}`);
  // Status-less plans: 37 early-era docs (2026-07-04..07-10) predate the
  // Status convention entirely. Editing 37 historical docs to add one is
  // exactly the hand-enumerated churn this checker exists to replace, so the
  // count is a RATCHET instead (the CSS-token-census pattern): it may only go
  // DOWN. A NEW completed plan without a terminal Status line pushes it up
  // and fails here - lower the ceiling when any historical doc gains one.
  const STATUSLESS_CEILING = 37;
  assert.ok(statusless.length <= STATUSLESS_CEILING,
    `status-less completed plans grew (${statusless.length} > ratchet ${STATUSLESS_CEILING}) - a NEW completed plan must carry a terminal Status line:\n  ${statusless.join('\n  ')}`);
});
