#!/usr/bin/env node
'use strict';
/*
 * plan-complete - close an exec plan out: move it from docs/exec-plans/active/
 * to docs/exec-plans/completed/ under the DATE-LED name, and record why.
 *
 *     node scripts/plan-complete.js <active-plan-path> "<Shipped vX.Y.Z | Abandoned(why)>" [--apply]
 *
 * Dry-run by default: prints every action it WOULD take. `--apply` executes.
 *
 * What it does (the convention test/unit/exec-plans-census.test.js enforces):
 *   1. NAME.  A plan is `YYYY-MM-DD-<slug>.md` (or `YYYY-MM-DD-<slug>/plan.md`
 *      for a directory plan - the date goes on the directory). The date is the
 *      day the plan was MADE: an explicit date the document itself declares
 *      (frontmatter `date:`/`prepared:`/`created:`, or "Prepared <date>" in
 *      its opening lines) wins; otherwise the commit that first added the
 *      file (`git log --diff-filter=A --follow`); otherwise today (an
 *      uncommitted plan - reported). A name that is already date-led is kept.
 *   2. MOVE.  `git mv` (never delete + create) into completed/.
 *   3. RECORD. A v2 plan (YAML frontmatter) gets its `status:` rewritten to
 *      the terminal value. A v1 plan (no frontmatter) gets ONE line prepended:
 *      `> Completed: shipped in vX.Y.Z (moved <today>; see ROADMAP.md).` (or
 *      the Abandoned equivalent). Every other byte is unchanged.
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

const DATED = /^(\d{4}-\d{2}-\d{2})-([a-z0-9][a-z0-9.-]*)$/;
const STATUS_OK = /^(Shipped v?\d+\.\d+\.\d+|Abandoned\(.+\))$/;

function usage(msg) {
  if (msg) console.error(`plan-complete: ${msg}`);
  console.error('usage: node scripts/plan-complete.js <active-plan-path> "<Shipped vX.Y.Z | Abandoned(why)>" [--apply]');
  process.exit(2);
}

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function today() {
  return new Date().toISOString().slice(0, 10);
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

// The date the plan was MADE (see the header). Returns { date, source }.
function deriveDate(repo, planRel, text) {
  const head = text.split('\n').slice(0, 15);
  const inFm = text.startsWith('---\n');
  for (const line of head) {
    if (inFm && /^---\s*$/.test(line) && line !== head[0]) break;
    const fm = inFm && line.match(/^(?:date|prepared|created):\s*(\d{4}-\d{2}-\d{2})/i);
    if (fm) return { date: fm[1], source: 'frontmatter' };
  }
  for (const line of head) {
    const m = line.match(/\bPrepared\b[^0-9]{0,20}(\d{4}-\d{2}-\d{2})/);
    if (m) return { date: m[1], source: 'the document ("Prepared <date>")' };
  }
  let added = '';
  try {
    added = git(repo, ['log', '--diff-filter=A', '--follow', '--format=%ad', '--date=short', '--', planRel]);
  } catch {}
  const first = added.split('\n').filter(Boolean).pop();
  if (first) return { date: first, source: 'git (the commit that first added the file)' };
  return { date: today(), source: 'today (the file has no commit yet - commit it and re-run if that is wrong)' };
}

function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const args = argv.filter((a) => a !== '--apply');
  if (args.length !== 2) usage();
  const [planArg, status] = args;
  if (!STATUS_OK.test(status)) usage(`status must be "Shipped vX.Y.Z" or "Abandoned(<why>)", got "${status}"`);

  const abs = path.resolve(planArg);
  if (!fs.existsSync(abs)) usage(`no such file: ${planArg}`);
  const repo = findRepo(abs);
  if (!repo) usage(`${planArg} is not inside a repo with docs/exec-plans`);
  const active = path.join(repo, 'docs', 'exec-plans', 'active');
  const completed = path.join(repo, 'docs', 'exec-plans', 'completed');

  // The spine + the unit that moves: a flat file moves itself; a <dir>/plan.md
  // moves its whole directory (the date goes on the directory name).
  const isDirPlan = path.basename(abs) === 'plan.md' && path.dirname(path.dirname(abs)) === active;
  const isFlat = path.dirname(abs) === active && abs.endsWith('.md');
  if (!isDirPlan && !isFlat) usage(`${planArg} is not a flat active/*.md plan or an active/<slug>/plan.md`);
  const unitAbs = isDirPlan ? path.dirname(abs) : abs;
  const unitName = path.basename(unitAbs);
  const stem = isDirPlan ? unitName : unitName.replace(/\.md$/, '');

  const text = fs.readFileSync(abs, 'utf8');
  const planRel = path.relative(repo, abs);
  const lines = text.split('\n');
  const isV2 = lines[0].trim() === '---';

  // 1. the date-led name
  let newStem;
  let dateNote;
  const already = stem.match(DATED);
  if (already) {
    newStem = stem;
    dateNote = `name already date-led (${already[1]}), kept`;
  } else {
    const { date, source } = deriveDate(repo, planRel, text);
    newStem = `${date}-${stem}`;
    dateNote = `date ${date} from ${source}`;
  }
  const newUnitAbs = path.join(completed, isDirPlan ? newStem : `${newStem}.md`);
  const newSpineAbs = isDirPlan ? path.join(newUnitAbs, 'plan.md') : newUnitAbs;
  if (fs.existsSync(newUnitAbs)) usage(`target already exists: ${path.relative(repo, newUnitAbs)}`);

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
      ? `shipped in ${status.replace(/^Shipped\s+v?/, 'v')}`
      : `abandoned - ${status.replace(/^Abandoned\((.*)\)$/, '$1')}`;
    const banner = `> Completed: ${why} (moved ${today()}; see ROADMAP.md).`;
    newText = `${banner}\n${text}`;
    recordNote = `prepend line 1: ${banner}`;
  }

  const rel = (p) => path.relative(repo, p);
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'}  ${rel(abs)}`);
  console.log(`  kind:   ${isV2 ? 'v2 (frontmatter)' : 'v1 (prose status)'}${isDirPlan ? ', directory plan' : ''}`);
  console.log(`  name:   ${dateNote}`);
  console.log(`  move:   git mv ${rel(unitAbs)} ${rel(newUnitAbs)}`);
  console.log(`  record: ${recordNote}`);

  if (!apply) {
    console.log('  (dry-run: nothing changed; re-run with --apply)');
    return;
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
  let refs = '';
  try { refs = git(repo, ['grep', '-nF', stem, '--', '.', `:(exclude)${rel(newUnitAbs)}`]); } catch {}
  const hits = refs.split('\n').filter(Boolean);
  if (hits.length) {
    console.log(`  references to "${stem}" still in the tree (${hits.length}) - update the path-shaped ones:`);
    for (const h of hits.slice(0, 40)) console.log(`    ${h.slice(0, 160)}`);
    if (hits.length > 40) console.log(`    ... ${hits.length - 40} more (git grep -nF ${stem})`);
  }
  console.log(`  next:   git add ${rel(newUnitAbs)}   (the rename is staged; the edit is not)`);
  console.log('          bash .harness/lib/check-markers.sh && node --test test/unit/exec-plans-census.test.js');
}

main();
