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
