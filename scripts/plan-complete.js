#!/usr/bin/env node
'use strict';
/*
 * plan-complete - close an exec plan out: move it from docs/exec-plans/active/
 * to docs/exec-plans/completed/ under the DATE-LED name, and record why.
 *
 *     node scripts/plan-complete.js <active-plan> "<Shipped vX.Y.Z | Abandoned(why)>" [--apply]
 *
 * <active-plan> is a flat `active/<name>.md`, or a directory plan given as
 * either `active/<slug>/plan.md` or `active/<slug>` (the whole directory moves).
 * Dry-run by default: prints every action it WOULD take. `--apply` executes.
 * Exit codes: 0 done (or dry-run) / 1 the post-move verify failed (inspect
 * before committing) / 2 refused - usage, a malformed status, a path outside
 * active/, an untracked plan, an existing target; nothing is touched on 2.
 *
 * What it does (the convention test/unit/exec-plans-census.test.js enforces):
 *   1. NAME.  A plan is `YYYY-MM-DD-<slug>.md` (or `YYYY-MM-DD-<slug>/plan.md`
 *      for a directory plan - the date goes on the directory). The date is the
 *      day the plan was MADE: the commit that first added the file (`git log
 *      --diff-filter=A`, without --follow first so copy detection can never
 *      inherit another file's date; --follow only as the fallback for a path
 *      that was itself moved before). A date the document declares itself
 *      (frontmatter `date:`/`prepared:`/`created:`, or "Prepared <date>" /
 *      "captured <date>" in its opening lines) wins ONLY when it is a real
 *      calendar date EARLIER than the commit date (a plan is never made after
 *      it is committed). No commit yet: today, reported. A name that is
 *      already date-led is kept (an upper-case slug is lower-cased).
 *   2. MOVE.  `git mv` (never delete + create) into completed/.
 *   3. RECORD. A v2 plan (YAML frontmatter) gets its `status:` rewritten to
 *      the terminal value. A v1 plan (no frontmatter) gets ONE line prepended:
 *      `> Completed: shipped in vX.Y.Z (moved <today>; see ROADMAP.md).` (or
 *      the Abandoned equivalent). Every other byte is unchanged. A version
 *      given without the `v` is normalised to `vX.Y.Z` on both paths.
 *   4. VERIFY. Re-reads the file at its NEW path and confirms the status /
 *      banner is really there (the renames-only trap: a git mv plus an edit
 *      can silently no-op the edit). Then lists every tracked reference to
 *      the old name so the caller can update them.
 *
 * It stages the rename (git mv does) but NOT the content edit - the follow-up
 * `git add <new-path>` is printed, so staging stays explicit and by name.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DATED = /^(\d{4}-\d{2}-\d{2})-([a-z0-9][a-z0-9.-]*)$/i;
const STATUS_OK = /^(Shipped v?\d+\.\d+\.\d+|Abandoned\(.+\))$/;
const HEAD_LINES = 15;

function usage(msg) {
  if (msg) console.error(`plan-complete: ${msg}`);
  console.error('usage: node scripts/plan-complete.js <active-plan> "<Shipped vX.Y.Z | Abandoned(why)>" [--apply]');
  process.exit(2);
}

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function realDate(s) {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return dt.getUTCFullYear() === +m[1] && dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3];
}

// Walk up from the plan to the directory that CONTAINS docs/exec-plans.
function findRepo(abs) {
  let dir = path.dirname(abs);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'docs', 'exec-plans'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

// The date the document declares for itself, if any: a frontmatter date
// field (scanned by INDEX up to the closing `---`, never into the body), else
// "Prepared <date>" / "captured <date>" within the opening lines.
function declaredDate(lines) {
  if (lines[0].trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (/^---\s*$/.test(lines[i])) break;
      const fm = lines[i].match(/^(?:date|prepared|created):\s*(\d{4}-\d{2}-\d{2})/i);
      if (fm) return { date: fm[1], source: 'frontmatter' };
    }
  }
  for (const line of lines.slice(0, HEAD_LINES)) {
    const m = line.match(/\b(Prepared|captured)\b[^0-9]{0,20}(\d{4}-\d{2}-\d{2})/i);
    if (m) return { date: m[2], source: `the document ("${m[1]} <date>")` };
  }
  return null;
}

// The commit that first added the file: plain first, --follow as the fallback
// for a path that was itself renamed earlier (copy detection under --follow
// can otherwise inherit a similar file's date).
function gitAddDate(repo, planRel) {
  for (const extra of [[], ['--follow']]) {
    let out = '';
    try {
      out = git(repo, ['log', '--diff-filter=A', ...extra, '--format=%ad', '--date=short', '--', planRel]);
    } catch {}
    const first = out.split('\n').filter(Boolean).pop();
    if (first) return first;
  }
  return '';
}

// The date the plan was MADE (see the header). Returns { date, source }.
function deriveDate(repo, planRel, text) {
  const committed = gitAddDate(repo, planRel);
  const declared = declaredDate(text.split('\n'));
  if (declared) {
    if (!realDate(declared.date)) {
      console.log(`  note:   ${declared.source} says ${declared.date}, not a calendar date - ignored`);
    } else if (!committed || declared.date < committed) {
      return { date: declared.date, source: declared.source };
    } else if (declared.date > committed) {
      console.log(`  note:   ${declared.source} says ${declared.date}, later than the commit date ${committed} - ignored`);
    }
  }
  if (committed) return { date: committed, source: 'git (the commit that first added the file)' };
  return { date: today(), source: 'today (the file has no commit yet - commit it and re-run if that is wrong)' };
}

function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const args = argv.filter((a) => a !== '--apply');
  if (args.length !== 2) usage();
  const [planArg, rawStatus] = args;
  if (!STATUS_OK.test(rawStatus)) usage(`status must be "Shipped vX.Y.Z" or "Abandoned(<why>)", got "${rawStatus}"`);
  const status = rawStatus.replace(/^Shipped\s+v?/, 'Shipped v');

  let abs = path.resolve(planArg);
  if (!fs.existsSync(abs)) usage(`no such file: ${planArg}`);
  const repo = findRepo(abs);
  if (!repo) usage(`${planArg} is not inside a repo with docs/exec-plans`);
  const active = path.join(repo, 'docs', 'exec-plans', 'active');
  const completed = path.join(repo, 'docs', 'exec-plans', 'completed');

  // A directory plan may be named by its directory; the spine is its plan.md.
  if (fs.statSync(abs).isDirectory() && path.dirname(abs) === active && fs.existsSync(path.join(abs, 'plan.md'))) {
    abs = path.join(abs, 'plan.md');
  }

  // The spine + the unit that moves: a flat file moves itself; a <dir>/plan.md
  // moves its whole directory (the date goes on the directory name).
  const isDirPlan = path.basename(abs) === 'plan.md' && path.dirname(path.dirname(abs)) === active;
  const isFlat = path.dirname(abs) === active && abs.endsWith('.md') && fs.statSync(abs).isFile();
  if (!isDirPlan && !isFlat) usage(`${planArg} is not a flat active/*.md plan, an active/<slug>/plan.md, or an active/<slug>/ directory plan`);
  const unitAbs = isDirPlan ? path.dirname(abs) : abs;
  const unitName = path.basename(unitAbs);
  const stem = isDirPlan ? unitName : unitName.replace(/\.md$/, '');

  const text = fs.readFileSync(abs, 'utf8');
  const planRel = path.relative(repo, abs);
  const lines = text.split('\n');
  const isV2 = lines[0].trim() === '---';

  const rel = (p) => path.relative(repo, p);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'}  ${rel(abs)}`);
  console.log(`  kind:   ${isV2 ? 'v2 (frontmatter)' : 'v1 (prose status)'}${isDirPlan ? ', directory plan' : ''}`);

  // 1. the date-led name
  let newStem;
  let dateNote;
  const already = stem.match(DATED);
  if (already) {
    newStem = stem.toLowerCase();
    dateNote = `name already date-led (${already[1]}), kept${newStem !== stem ? ' (lower-cased)' : ''}`;
  } else {
    const { date, source } = deriveDate(repo, planRel, text);
    newStem = `${date}-${stem.toLowerCase()}`;
    dateNote = `date ${date} from ${source}`;
  }
  const newUnitAbs = path.join(completed, isDirPlan ? newStem : `${newStem}.md`);
  const newSpineAbs = isDirPlan ? path.join(newUnitAbs, 'plan.md') : newUnitAbs;
  if (fs.existsSync(newUnitAbs)) usage(`target already exists: ${rel(newUnitAbs)}`);

  // 3. the record
  let newText;
  let recordNote;
  if (isV2) {
    let done = false;
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (i > 0 && !done && /^---\s*$/.test(lines[i])) { out.push(lines[i]); done = true; continue; }
      if (i > 0 && !done && /^status:/.test(lines[i])) { out.push(`status: ${status}`); done = true; continue; }
      out.push(lines[i]);
    }
    if (!out.some((l) => l === `status: ${status}`)) usage('v2 plan has no status: field in its frontmatter - add one, then re-run');
    newText = out.join('\n');
    recordNote = `frontmatter status: -> "${status}"`;
  } else {
    const why = status.startsWith('Shipped')
      ? `shipped in ${status.replace(/^Shipped\s+/, '')}`
      : `abandoned - ${status.replace(/^Abandoned\((.*)\)$/, '$1')}`;
    const banner = `> Completed: ${why} (moved ${today()}; see ROADMAP.md).`;
    newText = `${banner}\n${text}`;
    recordNote = `prepend line 1: ${banner}`;
  }

  console.log(`  name:   ${dateNote}`);
  console.log(`  move:   git mv ${rel(unitAbs)} ${rel(newUnitAbs)}`);
  console.log(`  record: ${recordNote}`);

  if (!apply) {
    console.log('  (dry-run: nothing changed; re-run with --apply)');
    return;
  }

  // git mv needs a TRACKED plan (an untracked one has no history to move).
  try { git(repo, ['ls-files', '--error-unmatch', '--', planRel]); } catch {
    usage(`${rel(abs)} is not tracked by git - commit it first (git mv has nothing to move)`);
  }
  git(repo, ['mv', rel(unitAbs), rel(newUnitAbs)]);
  fs.writeFileSync(newSpineAbs, newText);

  // 4. verify at the NEW path (the renames-only trap)
  const check = fs.readFileSync(newSpineAbs, 'utf8');
  const ok = isV2 ? check.split('\n').includes(`status: ${status}`) : check.startsWith('> Completed:');
  if (!ok) {
    console.error(`plan-complete: VERIFY FAILED - ${rel(newSpineAbs)} does not carry the status/banner; inspect before committing`);
    process.exit(1);
  }
  console.log(`  verified: ${rel(newSpineAbs)} carries the ${isV2 ? 'terminal status' : 'Completed banner'}`);

  // References to the old name, so the caller updates them (never silently).
  // `-e` keeps a `-`-leading stem from being read as a git option.
  let refs = '';
  try { refs = git(repo, ['grep', '-nF', '-e', stem, '--', '.', `:(exclude)${rel(newUnitAbs)}`]); } catch {}
  const hits = refs.split('\n').filter(Boolean);
  if (hits.length) {
    console.log(`  references to "${stem}" still in the tree (${hits.length}) - update the path-shaped ones:`);
    for (const h of hits.slice(0, 40)) console.log(`    ${h.slice(0, 160)}`);
    if (hits.length > 40) console.log(`    ... ${hits.length - 40} more (git grep -nF -e ${stem})`);
  }
  console.log(`  next:   git add ${rel(newUnitAbs)}   (the rename is staged; the edit is not)`);
  console.log('          bash .harness/lib/check-markers.sh && node --test test/unit/exec-plans-census.test.js');
}

main();
