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
   each plan is unchanged. Plans that are genuinely open stay in `active/` (renamed).
3. No reference anywhere in the repo points at an old path (ROADMAP, lib/, public/js, tests,
   inside the plans themselves), except frozen-history mentions the docs-link census excludes by
   design (listed in the build record).
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
  (v1.212.0 Slice 1; arc through v1.244.0), podcasts-on-skin (v1.246.0; F2 deferred), tray-player
  (v1.257.0), universal-audio (v1.242.0). Kept in active/: watch-habits-recommendations-and-purge
  (PARKED) and wheel-haptics (its current chapter is the live v1.274 tuning handoff - Dean's call;
  one script command flips it).
- 54 completed/ flat files dated from their first-add commit; `completed/wave7b-briefs/` ->
  `2026-09-14-wave7b-briefs/`; the one already-dated upper-case slug `...-stopB.md` -> `...-stopb.md`
  (its ROADMAP reference updated). `docs/exec-plans/archive/` untouched (out of scope).
- References updated: ROADMAP.md (5), lib/user/routes.js:24, lib/ytdlp/client/subscriptions.js:3542,
  lib/music/libraryAudio.js:10 (a pre-existing stale path), public/js/skin-surface.js (2),
  public/js/prefs-sync.js:11, public/js/common.js (2, one pre-existing stale), two tests, five
  in-plan links. Left as frozen history: ROADMAP.md:6169 and :9344 + four completed plans pointing
  at `active/critter-mode-skeleton.md` / `active/fouc-shimmer-audit.md` (the latter lives in archive/).
- `test/unit/docs-status-census.test.js` learned the `> Completed:` banner spelling and
  `abandoned` as a terminal word (the 8 moved v1 plans keep their stale "Status: ACTIVE" prose
  line below the banner).
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
