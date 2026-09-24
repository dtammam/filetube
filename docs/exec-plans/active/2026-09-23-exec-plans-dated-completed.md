---
plan: exec-plans-dated-completed
harness: v2 · lean
branch: chore/exec-plans-dated-completed
anchor: outcome
status: Building
next: gate (adversary + qa + security-brief; a lib/ytdlp/client comment path forces the full table), then merge into main (no release: docs + a test + a script; the next release's ROADMAP entry mentions it)
design: Approved 2026-09-23 @3d719e77 (Dean's ask, verbatim below; a chore, outcome anchor - the outcome IS the design; bound to the branch tip after the main v1.316.0 merge)
gate: pending
---

# Exec plans: date-led names, the done ones in completed/, and a flow that keeps it so

Dean (2026-09-23, verbatim): "i need the exec-plans that are done to be moved to completed. i
need them led with the date they were made. and i need our system to properly move completed
ones to complete and also name them that way."

Built by a general-purpose subagent in an isolated worktree off main 8536f399 (v1.315.0), then
main 6ea45237 (v1.316.0) merged in. Nothing in app code changed except three comment lines that
pointed at moved plan paths.

## Outcome (what "done" means)

1. Every plan under `docs/exec-plans/active/` and `docs/exec-plans/completed/` is named
   `YYYY-MM-DD-<slug>.md` (or `YYYY-MM-DD-<slug>/` for a directory plan), the date being the
   date the plan was MADE: the git commit that first added the file, unless the document itself
   states an earlier "Prepared"/captured date (one case: watch-habits, in-doc 2026-09-05 vs git
   2026-09-06).
2. Every plan that shipped or was abandoned lives in `completed/`; a v2 (frontmatter) plan
   carries a terminal `status:`, a legacy v1 plan carries one prepended line
   `> Completed: shipped in vX.Y.Z (moved 2026-09-23; see ROADMAP.md).` Every other byte of
   each plan is unchanged EXCEPT the five in-plan link edits (a moved plan pointing at another
   moved plan: audio-routing x2, listen-mode, podcasts-on-skin, ambient-glow-rebuild). Plans
   that are genuinely open stay in `active/` (renamed).
3. No living reference in docs/ or in the references the sweep touched (ROADMAP, lib/, public/js,
   the plans themselves) points at a path this branch moved; the nine living TEST comments that
   pointed at three plans already moved by earlier waves (subscription-push-bell, sub-bell-polish,
   ambient-glow-polish) were fixed in gate r1. Frozen-history mentions the docs-link census
   excludes by design stay (listed in the build record).
4. The flow enforces it: `test/unit/exec-plans-census.test.js` fails on an undated plan, a bad
   calendar date, a non-terminal v2 plan under completed/, a terminal one under active/, or a
   v1 banner not on line 1; `scripts/plan-complete.js <plan> "<Shipped vX.Y.Z | Abandoned(why)>"
   [--apply]` (dry-run by default) does the rename + move + marker and lists stale references;
   `docs/RELEASING.md` step 1 names the convention and the script; AGENTS.md's Project-context
   region carries one bullet.

## Build record (the subagent's report, checked by the gate)

- 72 renames via `git mv`, 8 plans moved active -> completed with evidence per plan:
  audio-routing-and-desktop-podcasts (v1.251.0), cross-device-sync (v1.265.0), listen-mode
  (v1.252.0), media-nav-back-stack (v1.217.0, deferred slices in the tracker), music-redesign
  (v1.212.0 Slice 1; slices 2-4 superseded by the v1.213 pivot, arc through v1.244.0),
  podcasts-on-skin (v1.246.0 F1/F3/F5 + v1.247.0 F2 - the r1 banner wrongly said "F2 deferred";
  the tracker has no F2 row and ROADMAP v1.247.0 "completes the podcast mega-wave's last piece
  (F2)"), tray-player
  (v1.257.0), universal-audio (v1.242.0). Kept in active/: watch-habits-recommendations-and-purge
  (PARKED) and wheel-haptics (its current chapter is the live v1.274 tuning handoff - Dean's call;
  one script command flips it).
- 54 completed/ flat files dated from their first-add commit; `completed/wave7b-briefs/` ->
  `2026-09-14-wave7b-briefs/`; the one already-dated upper-case slug `...-stopB.md` -> `...-stopb.md`
  (its ROADMAP reference updated). `docs/exec-plans/archive/` untouched (out of scope).
- References updated: ROADMAP.md (5), lib/user/routes.js:24, lib/ytdlp/client/subscriptions.js:3591
  (post-merge line), lib/music/libraryAudio.js:10 (a pre-existing stale path), public/js/skin-surface.js
  (2), public/js/prefs-sync.js:11, public/js/common.js (2, one pre-existing stale), two tests, five
  in-plan links; in r1, nine more living test comments (test/unit/{ytdlp-subscriptions-client,
  ytdlp-store, push-delivery, sub-row-chip-btn-family, sub-bell-in-place, ambient-glow-engine} +
  test/integration/{ytdlp-patch-pause, scan-push-bridge, backup-restore}) that pointed at
  `active/` paths of three plans earlier waves had already moved. Left as frozen history:
  ROADMAP.md:6196 and :9371 (post-merge lines) + five completed plans (tranche-4-shimmer:6,
  v1.98:4, v1.99:4, v1.101:4, wave-c-docs-truth:20 line-wrapped) pointing at
  `active/critter-mode-skeleton.md` / `active/fouc-shimmer-audit.md` (the latter lives in archive/).
- `test/unit/docs-status-census.test.js` learned the `> Completed:` banner spelling and
  `abandoned` as a terminal word (7 of the 8 moved v1 plans keep a stale "Status: ACTIVE" prose
  line below the banner; audio-routing already read "Status: SHIPPED as v1.251.0").
- Dots in slugs: 74 already-dated plans on the tree carry a `vX.Y` token (62 on main before this
  branch dated the twelve v1.96-v1.160 files), so the census slug charset keeps `.`.
- Gate r1 fixes (one commit): the nine test comments; the podcasts-on-skin and music-redesign
  banners; "pre-push" prose corrected in RELEASING.md + the census header (the checker runs at
  session start and by hand, never on pre-push); plan-complete.js deriveDate (frontmatter scan
  bounded by index, only an EARLIER real-calendar in-doc date beats git, `captured` recognised,
  no-follow git date first, upper-case dated stem lower-cased not double-dated, directory path
  accepted, untracked plan refused with exit 2, `git grep -e`, `Shipped 1.2.3` normalised, exit
  codes in the header); census banner lock `/i` and the dead README allowlist dropped;
  docs-status-census header lists ABANDONED.
- `.claude/commands/release.md` / `.harness/flow.md` still say "flat `<slug>.md`" without the
  date - harness-owned, not edited, disclosed.
- Verbatim (subagent, before the main merge): check-markers clean before and after; census test
  3/3; the five existing exec-plans readers 34/34; lint 0 errors (7 pre-existing warnings);
  pre-commit unit suite 6941/6941.

## Acceptance (the gate binds these)

- AC1: the census test is red on each of: an undated file, an undated directory, an impossible
  date, a non-terminal v2 plan in completed/, a terminal v2 plan in active/, a buried banner, an
  upper-case slug (mutate with a temp file in a sandbox); green on the tree.
- AC2: every moved plan's release evidence holds (ROADMAP "Shipped" entry + ledger + tag), and no
  plan still open was moved; every date matches `git log --diff-filter=A --follow` (or the
  in-doc earlier date, noted).
- AC3: `grep -rn` for every old basename finds only the disclosed frozen-history mentions;
  `docs-link-census` green; `check-markers` clean.
- AC4: `scripts/plan-complete.js` dry-run changes nothing; `--apply` on a throwaway plan (v2 flat,
  v1 flat, directory) moves + renames + marks and exits 1 if the marker is missing afterwards;
  it refuses a malformed status and a path outside `docs/exec-plans/active/`.
- AC5: the three lib/public comment edits are comment-only (no token of code changed).
- AC6: `docs-status-census` did not lose a lock it had before (the TERMINAL widening and the
  banner spelling are additive).

## Out of scope
`docs/exec-plans/archive/`; editing harness-owned command/flow files; a release of its own.

## Gate r1 - security-brief (@645d132c)

Trigger: the `**/*client*` glob (lib/ytdlp/client/subscriptions.js, a one-line comment edit).
Seat had no Bash: `git diff` could not be run. Verification was by reading the reviewed lines
in this worktree against the same lines in the base checkout (main @6ea45237) plus repo-wide
greps. What was checked:

1. Comment-only edits (VERIFIED, base vs branch, token by token): lib/user/routes.js:24,
   lib/ytdlp/client/subscriptions.js:3591, lib/music/libraryAudio.js:10-11,
   public/js/skin-surface.js:1042 + :1097, public/js/prefs-sync.js:11, public/js/common.js:5207
   + :7804. Every line is a `//` comment on both sides and only the path token changed. Every
   `exec-plans/` mention in lib/, public/ and test/ is a comment line.
2. scripts/plan-complete.js (VERIFIED by reading the whole file):
   - git is invoked through `execFileSync('git', argv[])` only (line 47); no shell, no string
     command, no `eval`. A crafted path/status cannot reach a shell.
   - Traversal: `path.resolve` then strict equality `dirname(abs) === <repo>/docs/exec-plans/active`
     (flat) or `dirname(dirname(abs)) === active` + basename `plan.md` (dir plan), so `..` and
     absolute paths outside active/ are refused (line 105). The destination is always built from
     `<repo>/docs/exec-plans/completed/<stem>` (line 127).
   - Collision: `fs.existsSync(newUnitAbs)` refuses an existing target (line 129), and `git mv`
     without `-f` refuses to overwrite anyway (second guard). No delete path exists; the only
     write is `writeFileSync` on the file it just moved.
   - Status string: `STATUS_OK` is anchored `^...$` and `.` excludes `\n`/`\r`, so a newline
     cannot be injected into frontmatter. The value is written verbatim; the downstream readers
     (exec-plans-census regex, docs-status-census, check-markers.sh via awk into a quoted `case`
     / `printf '%s'`) never eval or unquote it. Dry-run only runs `git log` (read-only).
3. test/unit/exec-plans-census.test.js: reads `__dirname/../../docs/exec-plans/{active,completed}`
   only; no argv/env input, no child_process, no writes.
4. AGENTS.md:140-145 and docs/RELEASING.md:53-75: the added instructions stage by explicit path
   (`git add docs/exec-plans/completed/<file>`), use `git mv`, and add no `--no-verify`, no
   force, no self-merge language.
5. package.json dependencies/devDependencies unchanged; no auth, secret, cookie, or network code
   touched (the only lib/ edits are the three comment lines above).

Findings: none at CRITICAL/HIGH/MEDIUM/LOW.

INFO-1 (advisory, not exploitable in this deployment): plan-complete.js follows symlinks. A
TRACKED symlink placed in active/ would pass the directory check, `git mv` would move the link,
and `fs.writeFileSync` would write through it to the link target. Requires a committed symlink
in a solo-dev repo, i.e. the attacker is the repo owner. No action required.

INFO-2 (robustness, not security): `Abandoned(<why>)` is written into YAML frontmatter
unescaped; a `why` containing ` #` or `: ` would be truncated/rejected by a strict YAML parser.
No parser in this repo reads plan frontmatter with js-yaml (the only js-yaml consumer is
test/unit/ci-pipeline-locks.test.js on workflow files), so there is no current consumer to break.

No exploitable weakness found.

Gate: APPROVED r1 @645d132c — security-brief

## Gate r1 - qa (@645d132c)

Instruments (verbatim, Node v22.23.1, run in this worktree):
- `node --test test/unit/exec-plans-census.test.js test/unit/docs-status-census.test.js test/unit/docs-link-census.test.js test/unit/tech-debt-census.test.js`: `# tests 7 / # pass 7 / # fail 0` (link census 2, status census 1, exec-plans census 3, tech-debt 1).
- `npm run lint`: `7 problems (0 errors, 7 warnings)` - the 7 pre-existing no-unused-vars in public/js/common.js; `npx eslint scripts/plan-complete.js test/unit/exec-plans-census.test.js`: exit 0, no output.
- `npm run lint:css`: `TOTAL 0`.
- `bash .harness/lib/check-markers.sh`: `check-markers: clean (docs/exec-plans)`, exit 0.
- `node scripts/plan-complete.js docs/exec-plans/active/2026-09-03-wheel-haptics.md "Shipped v1.256.0"` (dry-run): printed `DRY-RUN ... kind: v1 (prose status) / name already date-led (2026-09-03), kept / move: git mv ... / record: prepend line 1: > Completed: shipped in v1.256.0 (moved 2026-09-23; see ROADMAP.md). / (dry-run: nothing changed; re-run with --apply)`, exit 0; `git status --short` afterwards: empty.

Verified against the acceptance (sandboxes under the session scratchpad, tree untouched):
- AC1: sandbox copy of docs/exec-plans + the test; 12 mutants, each red on exactly one assertion: undated file, undated dir, 2026-02-30, 2026-13-01, upper-case slug, a stray notes.txt (all -> test 1); non-terminal v2 in completed/, terminal v2 in active/, non-terminal `<dir>/plan.md` in completed/, a v2 with `status:` only in the body (all -> test 2); buried banner (-> test 3). `README.md` in a bucket and a `.DS_Store` stay green (allowlist + dotfile filter). No README exists in either bucket today, so the allowlist is pre-emptive, one entry, justified in the comment.
- AC2: all 72 renamed entries' leading dates equal `git log --diff-filter=A --follow --format=%ad --date=short | tail -1` of their spine, except the disclosed watch-habits (name 2026-09-05, git 2026-09-06). The 8 banners each sit on line 1, exactly one per file, and their versions match a ROADMAP `### vX.Y.Z` heading (lines 2096/2319/2520/2548/2648/2717/3522/3680), one docs/releases.json entry each, and an existing tag each. Arithmetic: 8 moves + 54 completed flat + stopB + 7 wave7b-briefs files + 2 active renames = 72.
- AC3: `git grep` for every old path of the 72: only the disclosed frozen mentions remain (see F2/F4 for the count drift). docs-link-census green, check-markers clean.
- AC4: sandbox repo from `git archive HEAD`: `--apply` on a v2 flat, a v1 flat (date from "Prepared 2026-09-11"), and a `<dir>/plan.md` with a research/ sibling (date from git) each moved + renamed + marked, `git status` shows `RM` (rename staged, edit unstaged) exactly as the header says; malformed status `shipped v1.2` exit 2; completed/ path, `/etc/hostname`, `active/../../../package.json` all exit 2 with nothing touched; census + status census 4/4 after the applies.
- AC5: the 8 lib/public lines are `//` comments on both sides, only the path token differs.
- AC6: main's docs-status-census run on HEAD's tree rejects exactly 7 files (the moved v1 plans whose first prose status is ACTIVE); HEAD's test on main's tree passes; both pass on their own trees. STATUS_LINE and TERMINAL are `old | new` alternations, nothing previously accepted or rejected changed.
- Docs: RELEASING.md steps renumbered 1-5 consistently, the Notes bullet moved from step 2 to step 3, the only external "step N" references (AGENTS.md:145, this plan) say step 1 and are right; no em dash in any added line of the diff; the AGENTS.md bullet sits inside `harness:region ... id=project keep` (lines 64-161).

Security surface (standing section): no network, auth, cookie, secret or dependency change. The script calls git only through `execFileSync('git', argv[])` (no shell), confines the source to `docs/exec-plans/active/` by strict dirname equality after `path.resolve`, builds the destination from `<repo>/docs/exec-plans/completed/`, refuses an existing target, never unlinks; its one write is to the file it just moved. Only argv from the operator reaches it. One hardening note (F6).

Findings:

1. WARNING - docs/RELEASING.md:74-76 and test/unit/exec-plans-census.test.js:20-22 state the wrong mechanism: both call `.harness/lib/check-markers.sh` the "pre-push" checker ("flags the same placement errors" / "before the pre-push checker does"). Evidence: `hooks/pre-push` runs only `npm run lint` + `npm test` (lines 27-31); the only invocation is `.claude/hooks/session-start.sh:30-31` (SessionStart, `|| true`), plus a manual "run before push" line in `.harness/flow.md:115`. Scenario: a release follows step 1 as written and skips the manual `bash .harness/lib/check-markers.sh` line because "pre-push flags it"; a sha-less or stale approval marker (items 2-4, which the unit census does NOT check) reaches main and is first seen at the next session start. Fix: say "the SessionStart hook / run it by hand before push" in both places.

2. WARNING - plan doc Outcome 3 / AC3 ("No reference anywhere in the repo points at an old path ... except frozen-history mentions the docs-link census excludes") is false on the tree. Evidence (`git grep`, identical at main and HEAD, so pre-existing and untouched by the sweep): 10 living comment lines point at docs/exec-plans/active/2026-09-23-subscription-push-bell.md (stale path, backticks stripped by the Architect so the docs-link census lets the verdict commit; the finding is exactly that this path is stale) (test/integration/backup-restore.test.js:884, scan-push-bridge.test.js:214, ytdlp-patch-pause.test.js:383, test/unit/push-delivery.test.js:605, ytdlp-store.test.js:2378, ytdlp-subscriptions-client.test.js:936), `.../active/2026-09-23-sub-bell-polish.md` (test/unit/sub-bell-in-place.test.js:13, sub-row-chip-btn-family.test.js:15) and `.../active/2026-09-23-ambient-glow-polish.md` (test/unit/ambient-glow-engine.test.js:21); all three plans live in completed/ now. Scenario: a reader opens the path named in push-delivery.test.js:605 and gets ENOENT, which is the rot Dean asked to end. Fix: either update the 9 comment lines (comment-only, same class as the 8 already in this diff) or narrow Outcome 3 to "the 72 paths this diff moved" and list these as owed. Safe to ship with the narrowed claim; not safe to ship claiming "anywhere".

3. SUGGESTION - test/unit/exec-plans-census.test.js:28: "34 already-dated plans carry a `vX.Y` token". Measured at main: 62 dated slugs contain `vX.Y` (`git ls-tree main docs/exec-plans/{active,completed}/ | grep '^20..-..-..-' | grep -c 'v[0-9]\+\.[0-9]'` = 62). The rationale for the dot is right; the number is not.

4. SUGGESTION - build record line numbers drifted after the main merge: ROADMAP.md:6169/:9344 are now :6196/:9371; lib/ytdlp/client/subscriptions.js:3542 is :3591; "four completed plans" pointing at fouc-shimmer-audit is five (2026-08-11-tranche-4-shimmer.md:6, v1.98:4, v1.99:4, v1.101:4, and 2026-08-15-wave-c-docs-truth-and-release-mechanicals.md:20, line-wrapped); "the 8 moved v1 plans keep their stale Status: ACTIVE prose line" is 7 (2026-09-02-audio-routing-and-desktop-podcasts.md:4 already read `Status: SHIPPED as v1.251.0`, which is why main's census rejects 7, not 8).

5. SUGGESTION - scripts/plan-complete.js:71-75 deriveDate: the frontmatter scan's stop condition `line !== head[0]` compares string values, and the closing `---` equals the opening `---`, so the loop never stops at the block's end and reads up to 15 lines of body. Verified in the sandbox: a v2 plan with no date field and a body line `created: 1999-01-01 as a stub` prints `date 1999-01-01 from frontmatter`. Fix: break on index (`i > 0 && /^---\s*$/`), the same shape the status-rewrite loop at :137 already uses.

6. SUGGESTION (hardening) - scripts/plan-complete.js:174: `git grep -nF <stem>` passes the stem positionally; a stem beginning with `-` is read as a git option, the throw is swallowed by `catch {}`, and the reference list is silently empty. Verified: `active/-e.md` referenced from another doc -> `--apply` succeeds and prints no "references" block (the census then rejects `2026-09-23--e.md`, so it cannot ship, but the operator never learns why). Fix: `['grep', '-nF', '-e', stem, '--', ...]`. Requires a tracked plan under active/, so operator-only, not a boundary.

7. SUGGESTION - scripts/plan-complete.js:158 + header: `--apply` on an untracked plan lets `git mv` throw a raw Node stack (`fatal: not under version control`, exit 1) although deriveDate already anticipates "the file has no commit yet"; nothing is mutated (verified). Catch it with the usage() voice. Same header: no exit-code line (observed 0 ok / 1 verify failed or git error / 2 usage); `.harness/lib/check-markers.sh:8` is the in-repo precedent, CONTRIBUTING does not codify it.

8. SUGGESTION - scripts/plan-complete.js:40 + :146: STATUS_OK accepts `Shipped 1.2.3` (no `v`); the v1 banner normalizes to `v1.2.3` but the v2 path writes `status: Shipped 1.2.3` verbatim (verified). Require the `v` in STATUS_OK or normalize both.

9. SUGGESTION - test/unit/docs-status-census.test.js:15-18: the top comment's terminal list (SHIPPED / CLOSED / ... / RETIRED) omits ABANDONED after the widening; the constant's own comment at :43-44 has it.

Not findings, noted: `.claude/commands/release.md:27-33` still describes the manual `<slug>.md` move + grep guard (harness-owned, disclosed in the build record); the census names all directories date-led while `.harness/flow.md:33` / `harness-markers.md:34` say `<slug>/` (Dean's ask wins, disclosed); `today()` is UTC (this box is UTC).

Gate: CHANGES r1 @645d132c — qa (see findings)

## Gate r1 - adversary (@645d132c)

Reviewed 645d132c on chore/exec-plans-dated-completed (main 6ea45237 is an ancestor; merge 3d719e77).
Instruments, verbatim: `node --test test/unit/exec-plans-census.test.js` 3/3 pass;
`docs-link-census` 2/2; `docs-status-census` 1/1; `bash .harness/lib/check-markers.sh` ->
"check-markers: clean (docs/exec-plans)" exit 0; `npx eslint` on the two tests + the script exit 0;
the two comment-edited tests 30/30. Mutants ran in a `git archive HEAD` sandbox and a throwaway
git repo under the session scratchpad; the worktree was never mutated.

Verified by measurement (surfaces 1-8):
- S1 moves: all 9 claimed versions (v1.217.0, v1.212.0, v1.244.0, v1.242.0, v1.251.0, v1.246.0,
  v1.252.0, v1.257.0, v1.265.0) have a tag + a `### vX ` ROADMAP heading + a releases.json entry.
  media-nav-back-stack's deferred slices are tracker #186. Keeping wheel-haptics in active/ is
  right: its second chapter ("# v1.274 investigation", "## OPEN - pending Dean's device vetting")
  is the live Sweep-tuning handoff. watch-habits is PARKED (in-doc). Content diff of each moved
  plan = the banner line (+ 4 in-plan path rewrites, see F5).
- S2 dates: all 72 renames re-derived with `git log --diff-filter=A --follow` match the name
  (watch-habits 09-05 vs git 09-06 is the one disclosed divergence). 12 old paths whose no-follow
  first-add is a day later are all prior active->completed moves (rename chains confirmed).
- S3 references: whole-worktree path-shaped sweep + per-basename `git grep` for all 73 old names;
  the only rot the DIFF created is none. See F1 for pre-existing rot the outcome claims is gone.
- S4 census: 24 sandbox mutants, 0 survivors (undated file/dir/empty dir, 2026-13-45, 2026-02-30,
  v2 Building in completed, Shipped/Abandoned in active incl. dir plans, buried banner, upper-case
  slug, tech-debt-tracker sibling, non-md flat file, empty status, lower-case `shipped`: each turns
  exactly ONE assertion red; README.md, dotted slugs, no-banner v1, banner-on-line-1 stay green).
  Dots in slugs: right call (34 frozen `vX.Y` names).
- S5 script: dry-run leaves `git status` unchanged; --apply on v2 flat, v1 flat (Abandoned), dir
  plan (research.md moves with it), already-dated name (kept), uncommitted mods (carried); refuses
  `Shipped`/`Done`/empty/`Shipped v1.2`/`Abandoned()`/lower-case/newline/`--apply`-in-status
  (exit 2), paths outside active/, traversal `active/../completed/x`, outside the repo, nonexistent,
  a v2 plan with no frontmatter status (exit 2, nothing moved), a flat and a dir target that already
  exist (exit 2, existing content untouched). No delete path; `execFileSync` argv only - a name with
  spaces, `$` and `"` moves cleanly. The exit-1 verify is REAL: mutating the write to the original
  text -> "VERIFY FAILED", exit 1, rename staged, content unchanged (the disclosed inspect state).
- S6 docs-status-census: MAIN's test on the NEW tree is red on exactly the 7 moved v1 plans whose
  prose says ACTIVE (audio-routing already said SHIPPED); removing the banner spelling reproduces
  those 7 reds, so it is load-bearing; `> Completed: pending` is still red (the value is judged);
  `abandoned` is additive and currently vacuous (no tree plan uses it); statusless ratchet 37/37.
- S7: `git diff main...HEAD -- lib public | grep '^[+-]' | grep -v comment` is empty.
- S8: `git diff 6ea45237 --stat -- lib/ytdlp/client/subscriptions.js` = 1 line (the comment path);
  completed/2026-09-23-sub-bell-polish.md present (50550 bytes).

Findings:

1. WARNING - Outcome 3 / AC3 is false on the tree: 9 living test files still point at old
   `active/` paths of plans that now live in completed/ - test/unit/{ytdlp-subscriptions-client:936,
   ytdlp-store:2378, push-delivery:605}.test.js + test/integration/{ytdlp-patch-pause:383,
   scan-push-bridge:214, backup-restore:884}.test.js -> docs/exec-plans/active/2026-09-23-subscription-push-bell.md (stale path, backticks stripped by the Architect so the docs-link census lets the verdict commit; the finding is exactly that this path is stale);
   test/unit/{sub-row-chip-btn-family:15, sub-bell-in-place:13}.test.js -> `active/2026-09-23-sub-bell-polish.md`;
   test/unit/ambient-glow-engine.test.js:21 -> `active/2026-09-23-ambient-glow-polish.md`. Repro:
   `grep -rn 'exec-plans/active/2026-09-23' test | while IFS=: read f l r; do :; done` then
   `ls docs/exec-plans/active/` (3 files; none of those). Pre-existing on main, but the diff took on
   the same class in libraryAudio.js:10 and common.js:7804, and the plan states the outcome
   repo-wide ("tests" named). No net covers it either: docs-link-census scans docs only, the
   script lists refs only when run. Fix: 9 one-token comment edits (`active/` -> `completed/`).
2. WARNING - lying banner. docs/exec-plans/completed/2026-09-02-podcasts-on-skin.md:1 says
   "F2 deferred to tech-debt-tracker.md", but (a) `grep -n 'F2\|MENU.*origin' docs/exec-plans/tech-debt-tracker.md`
   has no such row, and (b) ROADMAP.md:2636 `### v1.247.0 - MENU returns you to where you launched
   the player from` says "Completes the podcast mega-wave's last piece (F2)" - the plan's own F2
   (line 15: "MENU returns to ORIGIN"). The banner is the first and authoritative status line of a
   frozen doc and misstates the record. Fix: "> Completed: shipped in v1.246.0 (F1/F3/F5) and
   v1.247.0 (F2). Moved 2026-09-23; see ROADMAP.md)."
3. SUGGESTION - scripts/plan-complete.js deriveDate, each repro'd in the throwaway repo:
   (a) :69 `line !== head[0]` compares by VALUE, and the closing `---` equals the opening one, so
   the frontmatter scan never stops: a body line `date: 2026-01-01 was the day` at line 7 became
   the name date ("from frontmatter"). No tree plan has such a line today. Fix: break on index > 0.
   (b) an in-doc "Prepared 2026-12-31" beats a 2026-05-09 git add - the plan's rule (Outcome 1)
   says only an EARLIER in-doc date wins; a frontmatter `date: 2026-13-45` is accepted as-is (the
   census catches it only after the move). (c) `captured <date>` - the plan's ONE deliberate
   divergence (watch-habits) - is not a spelling the script knows (it derived the git date); the
   plan doc says "Prepared/captured", the script says "Prepared". No practical effect now.
   (d) `--follow` turns on copy detection: a new plan >50% similar to any tracked file inherits
   THAT file's first-add date (5 of 8 three-line fixtures came out wrong). Real-shaped plans (an
   80-line v2 plan; a template + 25 lines of prose) derived correctly and all 72 branch dates are
   right, so theoretical - prefer no-follow first, `--follow` as the fallback for a previously
   moved path. (e) an already-dated UPPER-case stem is double-dated (`2026-05-06-2026-07-31-Upper.md`)
   and then fails the census; an untracked plan dies with a raw child_process stack (nothing moved);
   passing the plan DIRECTORY reports "no such file".
4. SUGGESTION - test/unit/exec-plans-census.test.js:43 `ALLOWLIST = ['README.md']` is a dead-code
   guard (no README in either bucket; one added there would also count as status-less in
   docs-status-census and as a spine in check-markers). Add the README or drop the entry. Also :133
   `/^> Completed:/` is case-sensitive while docs-status-census's banner match is `/i`: a
   `> completed:` banner buried on line 3 passes the line-1 lock (sandbox: green).
5. SUGGESTION - plan-doc truth: Outcome 2 "Every other byte of each plan is unchanged" contradicts
   the build record's "five in-plan links" (audio-routing x2, podcasts-on-skin, listen-mode,
   ambient-glow-rebuild were edited); "ROADMAP.md:6169 and :9344" are :6196 and :9371 after the
   main merge; the music-redesign banner "Slice 1; the arc ran through v1.244.0" would be more
   honest as "Slice 1; slices 2-4 superseded by the v1.213 pivot, arc through v1.244.0"
   (ROADMAP v1.213: "He pivoted the direction").

Observations, not findings against this diff: 13 names already dated on main disagree with
`--follow` by one day (e.g. 2026-07-08-v1.19-ui-polish.md, git 2026-07-07) - out of scope, the
census locks format only; completed/2026-09-23-sub-bell-polish.md:8 names
`active/2026-09-23-music-channel-chapters-wave.md`, which is in neither main nor this branch.

Gate: CHANGES r1 @645d132c — adversary (see findings)

## Gate r2 - security-brief (@172350dc)

Delta re-confirmation of my r1 APPROVED @645d132c. Same tool gap: no Bash, no `git diff`;
scripts/plan-complete.js and test/unit/exec-plans-census.test.js were re-read in full at this
sha, plus a repo-wide grep of test/ for the nine comment-only path edits.

Re-verified (traced in the fix commit):
- git is still invoked only through `execFileSync('git', argv[])` (line 58; stderr now piped,
  not inherited). No shell, no string command, no `eval` anywhere in the file.
- Source confinement unchanged: the new directory-argument branch (line 149) only rewrites `abs`
  to `<dir>/plan.md` when `dirname(abs) === <repo>/docs/exec-plans/active`, then the same strict
  `isDirPlan`/`isFlat` equality checks apply (lines 155-157). Destination is still
  `path.join(<repo>/docs/exec-plans/completed, <stem>)` (line 183); existing-target refusal
  (line 185) and no-delete posture unchanged. The new `ls-files --error-unmatch` precheck (line
  220) runs only under `--apply`, is read-only, and narrows the symlink note (r1 INFO-1) further:
  an untracked link is now refused with exit 2 before anything moves.
- `git grep -nF -e <stem> -- . :(exclude)<new>` (line 238): the stem is consumed as the argument
  of `-e`, so a `-`-leading stem is a pattern, never an option; `--` still terminates options
  before the pathspecs. Every other git call passes the operator path after `--` (`log`,
  `ls-files`) or as a `docs/...`-prefixed relative path (`mv`), so no argv can start with `-`.
- Normalisation cannot write a newline: `STATUS_OK` is tested on the RAW string first (line
  138), it is `^...$`-anchored with no `m` flag, `Shipped` must be followed by one literal space,
  and `.` in `Abandoned\(.+\)` excludes `\n`/`\r`. The replace (line 139) can therefore only
  touch the single space and optional `v` that `STATUS_OK` already admitted; the v1 banner path
  (line 203) strips `Shipped ` from the same normalised value.
- The census test still reads only `__dirname/../../docs/exec-plans/{active,completed}`, no
  child_process, no writes; the empty allowlist and `/i` banner regex are read-side only.
- Every `exec-plans/(active|completed)/` mention in test/ at this sha is a `//` comment line
  (the docs-link-census hit is a trailing comment on a pre-existing `continue`).
- package.json dependencies/devDependencies unchanged; no auth, secret, cookie or network code
  in the delta.

Nothing new introduced by the fix. r1 INFO-1 (symlink following) and INFO-2 (unescaped
`Abandoned(<why>)` in YAML, no consumer) stand as advisory; neither blocks.

No exploitable weakness found.

Gate: APPROVED r2 @172350dc — security-brief

## Gate r2 - qa (@172350dc)

Delta reviewed: `git diff 645d132c..172350dc` (16 files). Instruments (verbatim, Node v22.23.1):
- `node --test test/unit/exec-plans-census.test.js test/unit/docs-status-census.test.js test/unit/docs-link-census.test.js test/unit/tech-debt-census.test.js`: `# tests 7 / # pass 7 / # fail 0`.
- The nine edited test files (`node --test test/integration/{backup-restore,scan-push-bridge,ytdlp-patch-pause}.test.js test/unit/{ambient-glow-engine,push-delivery,sub-bell-in-place,sub-row-chip-btn-family,ytdlp-store,ytdlp-subscriptions-client}.test.js`): `# tests 691 / # pass 691 / # fail 0 / # skipped 0`.
- `npm run lint`: `7 problems (0 errors, 7 warnings)` (the pre-existing common.js set).
- `bash .harness/lib/check-markers.sh`: 3 issues, all on this plan doc's own markers (`stale approval @3d719e77` once, `stale approval @645d132c` twice - the design approval and the r1 verdict lines, whose reviewed code moved with the fix commit), exit 1: the expected pre-r2 shape, nothing else flagged.
- `node scripts/plan-complete.js docs/exec-plans/active/2026-09-03-wheel-haptics.md "Shipped v1.256.0"`: same DRY-RUN plan as r1, exit 0, `git status --short` afterwards shows only this plan doc (the security-brief seat's r2 section, appended concurrently; 39 insertions, zero deletions).

My r1 findings against the fix:
- #1 (pre-push claim) fixed as prescribed: docs/RELEASING.md:74-79 and the census header :20-23 now say session start (`.claude/hooks/session-start.sh`, non-blocking) + by hand before merge/release, deliberately not pre-push; the rationale (a building plan's bound design approval goes stale) matches check-markers item 3, and "as above" points at the `bash .harness/lib/check-markers.sh` line in the step 1 block.
- #2 fixed as prescribed: the nine test comments now name `completed/` paths that exist; Outcome 3 narrowed to what the sweep covers and names the nine.
- #3 fixed: 74 measured on the tree (`ls active completed | grep '^20..-..-..-' | grep -c 'v[0-9]\+\.[0-9]'` = 74), 62 on main, the twelve are v1.96/97/98/99/101/103/104/105/112/158/159/160 (twelve, checked against the rename list).
- #4 fixed: :6196/:9371, :3591, five plans, 7 of 8 - all match my r1 measurements; Outcome 2's five in-plan link edits match the paired diff (audio-routing x2, listen-mode, podcasts-on-skin, ambient-glow-rebuild).
- #5 fixed as prescribed (scan by index to the closing `---`); #6 (`-e`) verified: the `-e.md` sandbox case now prints its references block; #7 verified: untracked `--apply` refuses with exit 2, nothing moved (it prints the would-be plan first, then refuses - cosmetic); exit codes 0/1/2 in the header; #8 verified: `Shipped 1.2.3` writes `status: Shipped v1.2.3` and banner `shipped in v1.2.3`; #9 fixed.
- Adversary items I could measure: podcasts-on-skin banner (ROADMAP:2644 "mega-wave's last piece (F2)" under v1.247.0) and music-redesign banner (ROADMAP:3655-3656, the v1.213 pivot) are true; declared date wins only when earlier and real (sandbox: later -> ignored with a note, `captured 2026-08-30` -> wins, `2026-02-30` -> ignored); upper-case dated stem is lower-cased, not double-dated; `active/<slug>` accepted; README in a bucket now red; `>  completed:` lower-case buried banner now red. No em dash in any added line of the delta outside the verdict lines.

Finding introduced by the fix:

1. WARNING - scripts/plan-complete.js:101-113 gitAddDate (the "no-follow first" change) dates a plan that was itself renamed earlier by the RENAME commit, not the commit that first added it, and the header (:19-21) + the function comment (:101-103) describe a fallback that cannot run. Mechanism: without `--follow`, a path-limited `git log` sees a `git mv` as an Add at the new path, so the plain call always returns a date and the `--follow` branch is unreachable. Evidence: sandbox repo, plan committed 2026-09-05 as `active/old-name.md`, `git mv`'d 2026-09-10 to `active/new-name.md`, closed out -> `date 2026-09-10 from git (the commit that first added the file)`. On this tree: `docs/exec-plans/completed/2026-09-03-listen-mode.md` plain = 2026-09-23, `--follow` = 2026-09-03; watch-habits plain = 2026-09-23, `--follow` = 2026-09-06. Scenario: a plan made in October under one slug, renamed once before it ships (a normal event), closed by the script -> the wrong date in the name, and Outcome 1 ("the git commit that first added the file") is violated by the tool that exists to enforce it. Today's blast radius is latent (every plan on the tree is already date-led, so deriveDate only runs for a future undated stem), but the r1 order was right for this case and the comment now states a mechanism that does not happen. Fix: `--follow` first with rename-only detection pinned (`git -c diff.renames=true log --follow --diff-filter=A ...`, so a user `diff.renames=copies` cannot make it inherit a copied file's date, which was the Adversary's concern), plain `git log` only as the fallback when `--follow` returns nothing; reword the header and the function comment to match. The Adversary prescribed the current order, so the two seats should reconcile on this one.

Nothing else new: the `stdio` change, the directory-argument branch, the `ls-files --error-unmatch` guard and the normalisation are as described; no security surface change (git still via `execFileSync` argv, source still confined to active/).

Gate: CHANGES r2 @172350dc — qa (see findings)

## Gate r2 - adversary (@172350dc)

Delta re-review of 645d132c..172350dc (16 files; 1a585fcf only committed the r1 sections).
Instruments at 172350dc, verbatim: exec-plans-census 3/3, docs-link-census 2/2, docs-status-census
1/1; the nine comment-edited tests 691/691 pass, 0 fail; eslint on the script + two tests exit 0;
`bash .harness/lib/check-markers.sh` -> exit 1 with 3 stale-approval lines on THIS plan
(`design: Approved @3d719e77` line 8, security-brief's `Gate: APPROVED r1 @645d132c` line 159 and
its r2 prose "r1 APPROVED @645d132c" line 304): code changed since both shas (13 files), which is
the checker's rule for an active plan; they clear when the plan moves to completed/ (frozen plans
are not staleness-checked). Expected, disclosed by the builder, not a finding.

r1 findings against the fix:
- F1 fixed as prescribed: the nine test comments now say completed/; `grep -rn 'exec-plans/active/'
  lib public test` leaves only skin-surface.js:1097 (wheel-haptics, correctly in active/) and the
  docs-link-census template placeholder; the whole-worktree path-shaped sweep leaves only the
  disclosed frozen mentions (ROADMAP:6196/:9371, the five completed shimmer plans) plus quotes of
  the old path inside the seats' r1 findings text in this doc (frozen quotes).
- F2 fixed as prescribed: podcasts-on-skin.md:1 credits v1.246.0 (F1/F3/F5) and v1.247.0 (F2);
  music-redesign.md:1 names the v1.213 pivot. Both still open with the banner (census 3/3).
- F3 fixed, each sub-item re-driven in a fresh throwaway repo against 172350dc's script:
  (a) a body `date: 2026-01-01 ...` line no longer leaks (git 05-17 used); (b) "Prepared 2026-12-31"
  later than the 05-09 commit -> ignored with a printed note, "Prepared 2026-02-30" and frontmatter
  `date: 2026-13-45` -> "not a calendar date - ignored", an earlier real date still wins;
  (c) "captured 2026-09-05" -> 2026-09-05 (the watch-habits shape now reproduces); (d) a
  three-line plan similar to an existing one derives its OWN add date (05-20, was another file's);
  (e) `2026-07-31-Upper.md` -> "kept (lower-cased)", not double-dated; `active/dirplan` (the
  directory) accepted, dry and apply (research.md moves with it); an untracked plan -> one line,
  exit 2, nothing touched; `Shipped 1.2.3` -> `Shipped v1.2.3` in both the v1 banner and the v2
  frontmatter; a `-dash.md` stem lists references without git reading it as an option. The exit-1
  verify is still real (write mutant -> "VERIFY FAILED", exit 1, rename staged, content unchanged);
  a flat collision is still refused (exit 2, existing content intact).
- F4 fixed: README allowlist gone (sandbox: README.md in either bucket -> red, "not date-led");
  banner lock `/i` + `\s*` (a buried `> completed:` and `>  Completed:` -> red). Full mutant set
  re-run on a `git archive 172350dc` sandbox: 23 mutants, 0 survivors, each red on exactly one
  assertion, greens unchanged.
- F5 fixed: Outcome 2/3 and the build record now match the tree; counts measured: 74 `vX.Y`
  slugs on HEAD vs 62 on main (ls + regex), 7 stale ACTIVE lines under a banner, 5 frozen
  fouc-shimmer refs in completed/, ROADMAP :6196/:9371, subscriptions.js:3591.
- QA's pre-push item: `.claude/hooks/session-start.sh:30-31` does run check-markers (non-blocking,
  `|| true`); no pre-push hook references it (`core.hooksPath` = hooks/, no check-markers there).
  RELEASING.md:74-79 and the census header now describe that mechanism - present-tense claims
  verified against the tree.

New in the fix - one item, my own r1 prescription refuted by measurement:
1. SUGGESTION - scripts/plan-complete.js:103-114 gitAddDate: "no-follow first, --follow as the
   fallback for a path that was itself moved before" is not what git does. A path that was
   renamed shows its rename commit as `A` under a pathspec-limited `git log --diff-filter=A`, so
   no-follow is NEVER empty for a moved path and the --follow fallback is unreachable (measured:
   no-follow empty for 0 of 177 tracked plans; all 72 renamed paths return 2026-09-23 no-follow).
   Repro (throwaway): `orig-name.md` added 05-10, `git mv` to `renamed-in-active.md` 05-25, undated
   -> the script derives 2026-05-25 ("the commit that first added the file"); r1's --follow gave
   05-10. So r1 (d) traded a theoretical wrong date (copy detection, >50% similarity) for a real
   one (an undated plan renamed within active/ before closing). No name on the tree is affected:
   every active plan is already date-led and the script keeps a dated name, so deriveDate only
   runs for a hand-made undated plan - hence SUGGESTION, safe to ship. The exact fix, measured:
   `git log --follow --name-status --diff-filter=ACR --format=%ad --date=short -- <path>` walks
   newest->oldest and copy detection shows up as `C` rows (`C076 v1-flat.md -> tiny2.md`) while a
   true move is an `R` row; take the date of the first `C` row (the file's own add) or, absent one,
   the terminal `A`. Fix the header comment either way (it currently promises a fallback that never
   fires).

Tree after this review: `git status` shows only this plan doc modified (the seats' r2 sections);
no untracked files; sandboxes under the session scratchpad removed.

Gate: APPROVED r2 @172350dc — adversary

## Gate r3 - security-brief (@34e83736)

Delta re-confirmation of my r2 APPROVED @172350dc. Same tool gap: no Bash, no `git diff`;
scripts/plan-complete.js re-read in full at this sha and compared against my r2 read.

Re-verified (traced in the fix commit):
- The only change is the header paragraph (lines 19-29) and `gitAddDate` (lines 102-132);
  `git()`, `realDate`, `declaredDate`, `deriveDate` and the whole of `main()` are unchanged from
  r2 (source confinement, completed/ destination, collision refusal, `ls-files` precheck,
  `-e` grep, status normalisation all as approved).
- git is still invoked only through `execFileSync('git', argv[])` (line 60). The new call
  (lines 116-117) is `['-c', 'diff.renames=true', 'log', '--follow', '--name-status',
  '--diff-filter=ACR', '--format=%ad', '--date=short', '--', planRel]`: the `-c` key/value is a
  fixed literal (not operator input), precedes the `log` subcommand as a git global option, and
  `diff.renames` is a pure rename-detection knob with no exec/pager/external-command semantics.
  The operator path still follows `--`. The fallback call (line 129) is the r2 plain log,
  also `--`-terminated.
- Parsed row text is never executed or written: each output line is either exact-matched
  against `^\d{4}-\d{2}-\d{2}$` (and only then kept as the date) or inspected by `charAt(0)`
  for `C`/`A`; the path portions of `--name-status` rows are discarded. The one value that
  leaves the function is a strictly date-shaped string, which `main()` uses as the leading
  token of the new stem, so it cannot carry `/`, `..` or a newline into the completed/ path.
- Both git calls are read-only and run in dry-run and apply alike, as before.
- No auth, secret, cookie, network or dependency change (package.json untouched in this delta;
  nothing outside scripts/plan-complete.js changed).

Nothing new introduced. r1 INFO-1 / INFO-2 remain advisory only.

No exploitable weakness found.

Gate: APPROVED r3 @34e83736 — security-brief

## Gate r3 - adversary (@34e83736)

Delta re-confirmation of 172350dc..34e83736: scripts/plan-complete.js only (+34/-15; 3b63048f
committed the r2 sections; `git diff --stat` outside the script and the plans dir is empty).
Instruments at 34e83736, verbatim: exec-plans-census 3/3, docs-link-census 2/2, docs-status-census
1/1, eslint on the script exit 0; `check-markers` exit 1 with 8 stale-approval lines, all on THIS
plan's own bound shas (@3d719e77, @645d132c, @172350dc) quoted in the seats' r1/r2/r3 sections -
the active-plan staleness rule, clears on the move to completed/, disclosed, not a finding.

My r2 suggestion, verified against the committed walk (a fresh throwaway repo with
`diff.renames=copies` configured on purpose, drives against 34e83736's script):
- rename within active/ TWICE (added 05-10, mv 05-25, mv 05-26) -> 2026-05-10 (r2 gave 05-25);
  applied, lands as `completed/2026-05-10-renamed-twice.md`.
- revived from archive/ (added 04-01, mv into active/ 05-30) -> 2026-04-01.
- three-line plan >50% similar to an existing file, copies detection ON in config -> its OWN add
  date (05-20; raw walk shows `C080` as the first row, the `-c diff.renames=true` pin holds).
- a copy whose SOURCE was itself renamed (walk: `C076 ... 2026-05-28`, then the source's `C076`)
  -> 2026-05-28, the first C row, never the source's date.
- the r2 F3 set unchanged: body `date:` line ignored; later / non-calendar "Prepared" and
  frontmatter dates ignored with a note; earlier real date wins; `captured 2026-09-05` -> 09-05;
  UPPER dated stem "kept (lower-cased)"; the directory path accepted (dry + apply); untracked ->
  one line, exit 2, nothing touched; `Shipped 1.2.3` normalised in banner and frontmatter;
  `-dash.md` refs listing intact; dry-run leaves `git status` unchanged (0 -> 0 lines).
- exit-1 verify still real: the write mutant -> "VERIFY FAILED", exit 1, rename staged, content
  unchanged. Collision still refused: exit 2, existing target content intact.
- Real tree, read-only: the committed walk (first `C` else terminal `A`) re-applied to all 72
  renamed paths matches every name; the one divergence is the disclosed watch-habits (walk
  2026-09-06, name from the in-doc "captured 2026-09-05", which the script now derives itself).
  0 of 177 tracked plans have a `C` row, so copy detection never touches the real tree today.

Findings: none. Verified, not reasoned: every drive above was run, not read.

Gate: APPROVED r3 @34e83736 — adversary

## Gate r3 - qa (@34e83736)

Delta reviewed: `git diff 172350dc..34e83736` (scripts/plan-complete.js gitAddDate + its header and comment; the plan doc's r2 sections). Instruments (verbatim, Node v22.23.1):
- Four censuses: `# tests 7 / # pass 7 / # fail 0`.
- `npm run lint`: `7 problems (0 errors, 7 warnings)` (pre-existing); `npx eslint scripts/plan-complete.js`: exit 0.
- `bash .harness/lib/check-markers.sh`: 8 issues, every one a stale-approval line on this plan doc (`@3d719e77`, `@645d132c`, `@172350dc` - the design approval and the earlier rounds' verdict/quoted lines, whose reviewed code moved with the r3 commit), exit 1: the expected pre-r3 shape; nothing else flagged.
- `node scripts/plan-complete.js docs/exec-plans/active/2026-09-03-wheel-haptics.md "Shipped v1.256.0"`: same DRY-RUN plan (banner now reads `moved 2026-09-24`, today), exit 0; `git status --short` afterwards shows only this plan doc (the security-brief seat's r3 section, 32 insertions, 0 deletions).
- No em dash in any added line of the delta.

My r2 finding re-derived against the new walk (`git -c diff.renames=true log --follow --name-status --diff-filter=ACR --format=%ad --date=short`, newest to oldest, first `C` wins else the terminal `A`):
- The r2 sandbox repro, extended to two renames (added 09-05 as old-name, `git mv` 09-08, `git mv` 09-10): `date 2026-09-05 from git` (r2 gave 09-10). `--apply` on it moves to `completed/2026-09-05-new-name.md`, verified, `RM`.
- The Adversary's copy concern: a file added 09-12 as a 92%-similar copy of new-name (source still present) -> `date 2026-09-12`; the raw walk shows `C092 new-name.md -> copycat.md` first, so the walk stops at the file's own add and never reaches old-name's 09-05. Same result with `diff.renames=copies` set in the sandbox's repo config. An ordinary never-renamed add -> its own commit date.
- Real history (a clone of this worktree, listen-mode and watch-habits `git mv`'d back to undated names and committed): listen-mode -> `2026-09-03 from git` (walk: R 09-24, R 09-23, A 09-03); watch-habits -> `2026-09-05 from the document ("captured <date>")` with git's terminal A at 09-06, i.e. the declared-earlier rule, not the walk, supplies the 05.
- Header :19-24 and the function comment :102-112 now describe the mechanism the code runs, and every branch they name is reachable (the `C` stop, the terminal `A`, the plain last resort when the walk yields neither). Fixed as prescribed in substance (follow-first), better than my prescription in form (the `C`-row stop is the right copy guard; my `--diff-filter=A` + oldest-line version would have walked into a copy source).

One nit, not blocking:

1. SUGGESTION - scripts/plan-complete.js:108-110: "`-c diff.renames=true` pins rename-only detection, so a user's `diff.renames=copies` cannot turn an ordinary add into a copy of some similar file". Measured: the `--follow` rows are byte-identical with and without the `-c` pin, under both default config and `diff.renames=copies` (the `C092` row appears in all four runs), because `--follow`'s own single-path matching detects copies regardless of `diff.renames`. The pin is harmless, but the protection the sentence credits it with is actually delivered by the `C`-row stop the comment describes two sentences earlier. Reword to "harmless belt-and-braces; the `C` stop is what keeps a copy from inheriting its source's date", or drop the pin.

Nothing else new in the delta; no security surface change (same `execFileSync` argv shape, one extra read-only `git log`).

Gate: APPROVED r3 @34e83736 — qa
