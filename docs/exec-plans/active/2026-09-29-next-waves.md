---
plan: next-waves
harness: v2 · lean
branch: one branch per wave (named in each wave below)
anchor: this plan
status: Building
next: W1 (visual report-only + fast doc commits + the ceremony principle in AGENTS.md)
design: Approved 2026-09-29 (Dean, Q&A: every ruling below is his answer, verbatim in intent)
gate: per wave (adversary floor; W3 full gate)
---

# The next waves after v1.341.3: ceremony without friction, small UI, two features, the Pocket picker

Written 2026-09-29 from Dean's Q&A answers at the end of the v1.341.x session. This plan is the source of
truth for the next session. Execute the waves IN ORDER. Do not reorder, merge or skip a wave, and do not
add scope. Anything not written here is out of scope: log it in ROADMAP.md and move on.

## 0. Non-negotiable rules (read before touching anything)

1. **Read `AGENTS.md` first**, then `docs/LESSONS.md` sections 4, 6 and 13, then the wave you are on.
2. **Environment, every shell:** `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`
   before any npm, node or git command (the git hooks run node).
3. **Ceremony, never friction (Dean's standing rule, 2026-09-28).** Every step between a commit and a
   release must earn its time. The **screenshot shuffle** is a named anti-pattern: a check that fails on
   an INTENDED change and is only satisfied by push, wait, fail, download artifacts, commit them, push,
   wait again. Never create one; never treat a non-required check as a merge gate. Merge on green unit CI
   (`ci (22)`, `ci (24)`, `audit`, `secret-scan`) plus the review below. Visual never blocks.
4. **Review (gate):** every wave gets ONE `adversary` seat on the committed branch (spawn the `adversary`
   agent with branch, base sha, this plan's wave section, and the attack surfaces listed in the wave).
   **W3 deletes data: full gate, never slimmed:** `adversary` + `qa` + `security-brief`, and brief the
   adversary to DESTROY data (can a suggestion widen into deleting something the user was not shown?).
   CHANGES means fix and re-engage the SAME seat for a delta re-confirm. After 2 CHANGES rounds on one
   wave, ask Dean (AskUserQuestion) before round 3.
5. **Git hygiene:** worktrees in `.claude/worktrees/<name>`; branch from `origin/main`; stage files BY
   NAME (a hook blocks `git add -A/.`); commit with `git commit -F <file>` (no backticks in `-m`); never
   `--no-verify`, never force-push, never pipe a commit or push. A worktree has no `node_modules`: run
   `ln -s /home/coder/projects/filetube/node_modules node_modules` before commit/push (a ui-lint test needs
   it), `rm node_modules` after; never stage it. Long pushes: prefix
   `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"` and run in the background.
6. **Main is protected (PR required, no required checks):** push the branch, `gh pr create`, wait for unit
   CI green, `gh pr merge <n> --merge`, `git -C /home/coder/projects/filetube pull --ff-only`. Tag a
   release by API: `gh api repos/dtammam/filetube/git/refs -f ref=refs/tags/vX.Y.Z -f sha=<merge sha>`
   (tags are lightweight). Delete remote branches with
   `gh api -X DELETE repos/dtammam/filetube/git/refs/heads/<branch>` (`git push --delete` silently no-ops
   here); local branches with `git branch -d` AFTER `git pull --ff-only` on main (the PR's merge commit
   makes the branch an ancestor of main, so `-d` works; never `-D` unless Dean says so).
7. **Release bookkeeping (user-facing waves W2-W5):** bump `package.json` + `package-lock.json`
   (`npm version X.Y.Z --no-git-tag-version`), add a `docs/releases.json` entry (plain user language, no
   jargon; the release-ledger test enforces it), a ROADMAP.md Shipped entry above the previous one, tick
   the Planned entry, and a docs/LESSONS.md entry only if the wave taught a reusable lesson. W1 is
   tooling only: no version bump, no tag.
8. **Measure, don't assert.** A UI fix is measured in a real browser (Playwright at
   `tools/capture/node_modules/playwright`; the seeded fixture via `test/visual/server.js` seed()+boot())
   before and after, and the numbers go in the commit message. Report test counts verbatim (Node 24
   prints `ℹ`, not `#`).
9. **Autonomy:** Dean approved merge + tag on green for every wave. Ask him (AskUserQuestion) ONLY for a
   real decision or a blocker; do not narrate ceremony; report each wave's result in two lines.
10. No em dashes in docs or user-facing text (plain hyphens).

## W1 - Visual becomes a report, never a gate; fast doc commits; the principle in AGENTS.md

Branch `ci/visual-report`. No version bump.

Dean's rulings: a PR shows looks changes as **a PR comment with crops**; the check **never blocks**
anything; after a merge to main, **a bot opens a PR** with the refreshed baselines; doc commits touching
**any .md file or anything under docs/** take the fast path.

Steps:
1. `test/visual/run.js`: add `--report`. In report mode the process exits 0 on changed/missing pixels
   (it still prints the same lines and writes the report); it exits non-zero only when the capture itself
   crashed (no run record for its era). Keep the unclean-capture shot removal.
2. `.github/workflows/visual.yml`, `visual` job: run `run.js --report ...`; upload each leg's report crops
   (`test-results/visual/report/`) and changed shots as artifacts (always, not only on failure).
   Add a `visual-comment` job (`needs: visual`, `if: always() && github.event_name == 'pull_request'`,
   `permissions: pull-requests: write, contents: write`): download the report artifacts; if any leg
   reported changes, push the `*.sbs.png` crops to an orphan branch `visual-reports` under
   `pr-<number>/<run id>/` (public repo, so raw URLs render) and post or UPDATE one PR comment (find it by
   a hidden marker `<!-- visual-report -->`) listing per leg the changed scenes and embedding up to 12
   crops via `https://raw.githubusercontent.com/dtammam/filetube/visual-reports/...`. No changes: the
   comment says "No visual changes" (update, never a second comment).
3. Auto-baselines: a `baseline-refresh` job on `push` to `main` only: run the 12 legs in `--update` mode
   (the existing rebaseline steps), merge to one artifact, and if `test/visual/baselines/` differs from the
   committed set, create branch `chore/baselines-<short sha>`, commit ONLY `test/visual/baselines/`, and
   `gh pr create` with the list of changed files. It never merges itself. If the repo setting blocks
   Actions from creating PRs ("Allow GitHub Actions to create and approve pull requests"), STOP and ask
   Dean to enable it (Settings > Actions > General); do not work around it with a personal token.
4. Mask the app version in screenshots: find every element that renders `appVersionString()` (the
   account menu row, `public/js/common.js` near line 7101; the About/Stats row, `public/js/music.js` near
   4076 and the stats page) and add their selectors to `VOLATILE_MASK_CSS` in `test/visual/capture.js`
   (masked glyphs keep their box). The first baseline-refresh PR after W1 carries the masked shots.
5. `scripts/precommit-docs-fast-path.js`: treat a staged path as docs when it matches `\.md$` anywhere OR
   `^docs/` (today only Markdown under docs/); update its test.
6. `AGENTS.md`: add a short section "Ceremony, not friction" with rule 3 above (the principle and the
   screenshot-shuffle anti-pattern) and "visual reports, never blocks". Update `docs/RELEASING.md`'s
   visual section to the report/comment/auto-PR flow (delete the manual rebaseline procedure except as a
   fallback for added/renamed/removed scenes).
7. Tests: extend `test/unit/visual-workflow.test.js` (report flag, the comment job's `if`, the refresh
   job only on push to main, it commits only baselines) and the fast-path test. Each new assertion must go
   red when its subject is removed (mutate in a /tmp `git archive` sandbox after committing).

Acceptance: a PR that changes a page's look shows a comment with the crops and the visual check is
green; a docs-only commit anywhere runs in seconds; after merge, a baselines PR appears.
Adversary attack surfaces: a capture crash still fails; the comment job cannot run on forks or write
outside `visual-reports`; the refresh job cannot commit non-baseline files or loop (a baselines PR must
not trigger another refresh: it only changes baselines and the refresh runs on push to main).

## W2 - Small UI wave: Original's grayscale emoji, button label rule, the rolling device checklist

Branch `feat/small-ui`. Release **v1.341.4**.

1. **Click Original emoji in black and white** (Dean: explicitly that ONE skin). In the Original skin's
   CSS scope only (`.mms-look-original` or the Original's root class; find it), add
   `filter: grayscale(1)` to its TEXT surfaces (menus, song/chapter titles, the status bar), never to album
   art, video, or the whole skin root (a filter over playing video blacks it out on iPhone, LESSONS 7).
   Measure: screenshot the Original with an emoji title before/after (colour pixels in the glyph box vs
   none).
2. **Button label rule: short verb phrases.** Every menu row is an action in 1-3 words, sentence case, no
   full sentences, no trailing punctuation (examples: "Like", "Fix chapter times", "Add to queue",
   "Share"). Sweep: Music's Extras menu first (Dean's example: "Like" vs the chapter row that reads as a
   sentence), then every card menu, the chapters menu, the Pocket menus, the account menu. Write the rule
   into the UI docs (`docs/` design system page that ui-lint cites; find it) and, if the labels come from
   a small number of builders, add a unit test that every label matches `^[A-Z][a-z]*( [a-z0-9]+){0,2}$`
   (proper nouns allowed via an explicit list).
3. **Rolling device checklist** (Dean: one checklist, old items roll up). Create the new file docs/DEVICE-CHECKS.md:
   one list of what Dean should tap on his phone/desktop, grouped by area, each line tagged with the
   version that introduced it; move every open device check from tracker rows #280-#289 (and v1.341.1-3:
   the chapter editor place/discard dialog, pinned rows, panels not shifting the page incl. a narrow
   window, the rotation bump, Modern folders fitting) into it; the tracker rows then point at the file.
   Future releases append to it instead of adding tracker rows.

Adversary attack surfaces: the grayscale filter never reaches media or another skin; no label change
alters behaviour (same actions, same order); the checklist lost no open item from the tracker.

## W3 - Suggestive delete: a Clean up page (FULL GATE)

Branch `feat/suggestive-delete`. Release **v1.342.0**.

Dean's rulings: suggest **all four kinds**: (a) videos watched to the end, (b) subscription downloads
never opened, (c) the biggest never-opened files, (d) duplicates. Thresholds: **30 days, adjustable** on
the page; (c) lists the top 20 by size. It lives on **its own "Clean up" page**, linked from the account
menu and from Stats' storage area. **Nothing is deleted without the user's tap; every delete goes to
Trash** (restorable) through the existing delete path.

Build:
1. Server: `GET /api/cleanup/suggestions?days=30` returns groups `{watched, stale_subscriptions, largest,
   duplicates}`, each item `{id, title, size, reason, lastPlayedAt|addedAt}`. Read-only. Per-user where
   progress is per-user (watched = that user's progress at the end; follow how History decides
   "finished"). Duplicates: same source id (yt-dlp id) first; else same size AND duration within 1 s; the
   suggestion keeps the OLDEST copy unselected and suggests the newer ones.
2. Deleting: `POST` the selected ids through the SAME trash route the app already uses for "Move to
   Trash" (find it; do not add a new delete path). The server re-validates every id at delete time
   (exists, not already trashed, the caller may delete it); an id that is not in a CURRENT suggestion set
   is still just a normal trash request with the normal permission check (never a bulk delete by
   criteria: the client sends explicit ids only).
3. Client: a Clean up page (new SPA view) with the four groups, sizes, a total, checkboxes (nothing
   pre-selected), "Move to Trash" behind the standard `ui.confirm` naming the count and size; the days
   setting persisted per user.
4. Tests: suggestion rules (unit), the route (integration, including a viewer role), the client never
   sends criteria, the confirm is required, restore from Trash works after a bulk move.

Full gate attack surfaces (brief the adversary to destroy data): a suggestion widening into items not
shown (stale ids, a race where the list changed), deleting another user's or a pinned/liked/partially
watched item, duplicates deleting the only copy, the double-tap guard on the confirm, a viewer role, a
huge selection, restore after trash.

Gate: APPROVED r1 @ae7586d5 — security-brief
Gate: CHANGES r1 @ae7586d5 — qa
Gate: CHANGES r2 @e100986c — adversary
Gate: APPROVED r2 @e100986c — qa

## W4 - Watch later: a separate per-user list

Branch `feat/watch-later`. Release **v1.343.0**.

Dean's rulings: **separate from Pin** (Pin keeps meaning "keep this channel/shelf handy"). Watch later is
a per-user list of videos: **add from every card's menu and the watch page action row**; the list shows
in **the You tab / account menu** (next to Liked and History) and **the desktop sidebar** (Library, under
Liked); an item **leaves the list when you finish it**; "Play all" feeds the play queue; stored server
side so it follows the user across devices. No home shelf.

Build: server store + routes (per user, ordered, add/remove/reorder/list; follow the Liked list's
storage and routes as the model), the card-menu and watch-page actions (label per the W2 rule:
"Watch later" / "Remove from Watch later"), the list view (reuse the Liked view's layout), auto-removal
on finish (the same "finished" rule as History), Play all. Tests for each. Adversary surfaces: another
user's list, removal on finish never removes an unfinished item, reorder races, a deleted/trashed video
in the list.

## W5 - Pocket skin menu and the preview-grid picker

Branch `feat/skin-picker`. Release **v1.344.0**.

Dean's rulings: in the Pocket, **a menu item** (Extras > "Skins") opens an in-skin, wheel-navigable menu:
families first (Click, Zune, Original, the modern players), then that family's colourways; the Pocket
re-skins live as the selection moves. The full picker (Settings) becomes a **preview grid**: small
rendered thumbnails of every skin/colourway, scrollable; tapping one applies it. Keep every option.
Measure the current list first (count, scroll length on a phone) and put it in the commit message.
Adversary surfaces: the live preview never leaves a half-applied skin on cancel/back; performance of the
grid (thumbnails are static images or CSS, never 40 live players); the saved choice survives reload and
rotation.

## Out of scope (logged, do not build)

- Tracker #289c review leftovers (Dean: "None for now").
- #289d: the Settings/Stats master-detail nav redesign and the lint-debt true-up (later, their own waves).
- ROADMAP Chores logged 2026-09-28 (rotation 650ms gate, bottom-nav lock gap, negative-gap test, visual
  scrollbar geometry check): stay logged (Dean: not folded in).
- Onboarding / SMB paths, the fullscreen black, chapter timing on mobile, the loop-with-Loop-off bug:
  roadmap entries, not these waves.
