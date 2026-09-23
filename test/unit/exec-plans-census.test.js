'use strict';

// [UNIT] the exec-plans NAMING + PLACEMENT census (Dean, 2026-09-23: "i need
// the exec-plans that are done to be moved to completed. i need them led
// with the date they were made. and i need our system to properly move
// completed ones to complete and also name them that way.").
//
// Three invariants over docs/exec-plans/{active,completed}, derived by a
// checker (never a hand-aimed sweep - the docs-status-census lesson):
//
//   1. NAMING. Every entry is DATE-LED: a flat plan is
//      `YYYY-MM-DD-<slug>.md`, a directory (a `<slug>/plan.md` plan, or a
//      sibling-briefs folder) is `YYYY-MM-DD-<slug>`. The date is the day the
//      plan was MADE (the commit that first added it), and it is a real
//      calendar date. `scripts/plan-complete.js` derives it for you.
//   2. PLACEMENT (v2 plans, YAML frontmatter). A terminal `status:`
//      (`Shipped ...` / `Abandoned(...)`) may not sit under active/, and a
//      non-terminal one may not sit under completed/. This mirrors
//      .harness/lib/check-markers.sh items 1 + 5 in the unit suite, so the
//      pre-commit hook catches it before the pre-push checker does.
//   3. NO ROT. A completed v1 plan (no frontmatter) states WHY it lives in
//      completed/ - it opens with the `> Completed: ...` banner or a terminal
//      Status line (test/unit/docs-status-census.test.js owns the terminal
//      vocabulary; this file only insists the banner, when present, is the
//      FIRST line so a reader sees it before the stale prose status).
//
// Slug charset: lower-case letters, digits, `-` and `.` - the dot is there
// because 34 already-dated plans carry a `vX.Y` token (`2026-07-06-v1.13-
// polish.md`); renaming frozen history to purge a dot is churn, not truth.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PLANS = path.join(__dirname, '..', '..', 'docs', 'exec-plans');
const BUCKETS = ['active', 'completed'];

// The ONLY non-plan names allowed beside the plans. `tech-debt-tracker.md`
// lives one level up (docs/exec-plans/) and is out of this census's scope;
// nothing else is exempt. A README explaining the convention would be the
// one legitimate undated file in a bucket, so it is pre-allowed.
const ALLOWLIST = new Set(['README.md']);

const DATED_FILE = /^(\d{4})-(\d{2})-(\d{2})-[a-z0-9][a-z0-9.-]*\.md$/;
const DATED_DIR = /^(\d{4})-(\d{2})-(\d{2})-[a-z0-9][a-z0-9.-]*$/;
const TERMINAL = /^(Shipped|Abandoned)\b/;

function realDate(y, m, d) {
  const dt = new Date(Date.UTC(+y, +m - 1, +d));
  return dt.getUTCFullYear() === +y && dt.getUTCMonth() === +m - 1 && dt.getUTCDate() === +d;
}

// Frontmatter `status:` (the block between the first two `---` lines), or
// null when the file has no frontmatter (a v1 plan). Body text never matches.
function frontmatterStatus(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  if (lines[0].trim() !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return '';
    const m = lines[i].match(/^status:\s*(.*)$/);
    if (m) return m[1].trim();
  }
  return '';
}

function entries(bucket) {
  const dir = path.join(PLANS, bucket);
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, full: path.join(dir, e.name), isDir: e.isDirectory(), bucket }));
}

// The plan SPINES: flat *.md + <dir>/plan.md (never research/*.md siblings).
function spines(bucket) {
  const out = [];
  for (const e of entries(bucket)) {
    if (!e.isDir && e.name.endsWith('.md') && !ALLOWLIST.has(e.name)) out.push({ ...e, rel: `${bucket}/${e.name}` });
    if (e.isDir && fs.existsSync(path.join(e.full, 'plan.md'))) {
      out.push({ ...e, full: path.join(e.full, 'plan.md'), rel: `${bucket}/${e.name}/plan.md` });
    }
  }
  return out;
}

test('every plan under active/ and completed/ is date-led: YYYY-MM-DD-<slug>.md or YYYY-MM-DD-<slug>/', () => {
  const bad = [];
  let seen = 0;
  for (const bucket of BUCKETS) {
    for (const e of entries(bucket)) {
      if (!e.isDir && ALLOWLIST.has(e.name)) continue;
      seen++;
      const m = e.name.match(e.isDir ? DATED_DIR : DATED_FILE);
      if (!m) { bad.push(`${bucket}/${e.name}  (not date-led)`); continue; }
      if (!realDate(m[1], m[2], m[3])) bad.push(`${bucket}/${e.name}  (not a calendar date)`);
    }
  }
  assert.ok(seen > 100, `sanity: the plans dirs have real content (found ${seen})`);
  assert.deepStrictEqual(bad, [],
    `plan(s) not named YYYY-MM-DD-<slug> (the date the plan was MADE = its first git\n`
    + `commit; \`node scripts/plan-complete.js <path> "Shipped vX.Y.Z"\` derives and renames):\n  ${bad.join('\n  ')}`);
});

test('a v2 plan sits where its frontmatter status says: terminal in completed/, non-terminal in active/', () => {
  const misplaced = [];
  let v2 = 0;
  for (const s of spines('active')) {
    const st = frontmatterStatus(s.full);
    if (st === null) continue;
    v2++;
    if (TERMINAL.test(st)) misplaced.push(`${s.rel}: status '${st}' is terminal - move it to completed/`);
  }
  for (const s of spines('completed')) {
    const st = frontmatterStatus(s.full);
    if (st === null) continue;
    v2++;
    if (!TERMINAL.test(st)) misplaced.push(`${s.rel}: status '${st || '(empty)'}' is not Shipped/Abandoned`);
  }
  assert.ok(v2 > 5, `sanity: v2 (frontmatter) plans exist (found ${v2})`);
  assert.deepStrictEqual(misplaced, [],
    `plan(s) whose frontmatter status contradicts their directory (the checker\n`
    + `.harness/lib/check-markers.sh flags the same on pre-push):\n  ${misplaced.join('\n  ')}`);
});

test('a completed v1 plan that carries the Completed banner carries it on line 1', () => {
  // The banner is how a reader learns why a prose-status plan ("Status:
  // ACTIVE ...") lives in completed/. Buried below the stale status it is
  // useless, so: present anywhere => present as the very first line.
  const buried = [];
  for (const s of spines('completed')) {
    if (frontmatterStatus(s.full) !== null) continue;
    const lines = fs.readFileSync(s.full, 'utf8').split('\n');
    const at = lines.findIndex((l) => /^> Completed:/.test(l));
    if (at > 0) buried.push(`${s.rel}:${at + 1}`);
  }
  assert.deepStrictEqual(buried, [],
    `Completed banner(s) not on line 1 (scripts/plan-complete.js prepends it):\n  ${buried.join('\n  ')}`);
});
