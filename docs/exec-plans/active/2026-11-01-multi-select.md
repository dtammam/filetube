---
plan: multi-select
harness: v2 · full
branch: feat/v1.400.0-multi-select
anchor: spec
status: Approved (kickoff rulings below; the builder writes Design + Steps, then builds)
next: builder - research the grid/menu seams (R1-R4), write ## Design and ## Steps inline, build W1-W3, commit, full gate
design: Rulings approved by Dean 2026-11-01 (AskUserQuestion); the builder's Design must stay inside them
gate: pending
builder: extreme
---

# v1.400.0 - select several videos at once and act on them together

Kickoff 2026-11-01 (FileTube Root, Opus). **Builder: Extreme (Fable).** Why the tier: two of the verbs move files (Move to
folder) or remove them (Move to Trash), a data-loss surface with the full gate forced, and the selection has to stay
correct as the grid re-renders and loads more. The only new server code is one route (the reheat). One release, **1.400.0**.

## Step 0 (before any code)

- Read AGENTS.md, docs/LESSONS.md (sections 3, 4, 6, 9, 10, 11, 13 at least), docs/CONTRIBUTING.md, docs/RELEASING.md,
  then this plan once.
- Environment: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"` before every
  npm/node/git command. Local suites on Node 22 only; Node 24 runs in PR CI.
- Git: work on `feat/v1.400.0-multi-select` (this plan is committed there). Stage by name, never `git add .`/`-A`,
  never force-push, never `--no-verify`, never pipe a commit or push; verify with `git log` / `git ls-remote`. Commit
  with `-F <file>`. Push with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`.
- Tests: targeted tests per wave; the full Node 22 suite once before the gate and once on the release commit.
- **Stop rules (ask Dean with AskUserQuestion):** a ruling M1-M12 turns out unbuildable as written; the reheat `ids`
  change needs anything beyond narrowing the existing enumeration; a verb has no reusable per-item implementation and
  would need a new server route; gate round 3 (gate-pacing norm: after 2 rounds, ask).

## Why

Dean, 2026-11-01: "an option to the system for multi-selecting things. Would be extremely useful to select a set of
videos from the Downloads folder to then be able to reheat, or delete, etc. Will save lots of time."

Today every action is per card: open the card's menu (kebab, long-press or right-click), pick the verb, and repeat N
times. The two bulk paths that exist do not cover a hand-picked set:
- Clean up (v1.342.0) trashes many, but only from its own criteria-built shortlist.
- Library Reheat (`POST /api/ytdlp/repull-metadata`) reheats EVERY eligible visible item, which is slow.

The outcome: **act on N cards I picked by hand with one action, not N menu trips.**

## Rulings (settled - do not reopen; a needed change halts and returns to Dean)

| # | Ruling | Source |
|---|---|---|
| M1 | **Every media-card grid** in the library view (`public/js/main.js`): the Downloads folder, every library folder, Home, search, Liked, Watch later. One mechanism on the shared grid, not a Downloads special case. | Dean |
| M2 | **Entry:** a **Select** button in the grid header on every device, AND a **Select** row in the card's action menu (the long-press / right-click / kebab menu) that enters select mode with that card already ticked. Long-press itself keeps opening the menu (it already does, main.js ~3415, interaction.js owns the gesture); the Select row is how Dean's "long-press to start" works without stealing the gesture. Desktop: shift-click ticks the range from the last-ticked card. **In select mode** a tap/click on a card toggles it and NEVER navigates or plays, the hover preview does not start, and Escape / a Cancel button leaves select mode and clears the selection. | Dean (Select button + long-press); Root on the menu conflict |
| M3 | **Select all = the loaded cards only**, labelled with the count ("Select 48 shown"). Cards loaded later by scrolling are NOT auto-ticked. What you see is what gets acted on. | Dean |
| M4 | A **sticky action bar** while in select mode: the count ("12 selected"), the verbs, Cancel. Its verbs: **Add to queue** (grid order), **Watch later** (add), **Like**, **Mark watched**, **Move to folder**, **Reheat metadata**, **Move to Trash**. Like and Mark watched SET the state (POST), never toggle; a card already liked/watched is a no-op, not an unlike. Unlike / Mark unwatched / Remove from Watch later are out of v1. | Dean (all four groups) |
| M5 | **Applicability is the card menu's own rules** (`buildCardMenuItems`, main.js ~725): a verb applies to a selected card only where that card's own menu would offer it (kind rules via `cardKindPresentation`, `canModifyLibrary` for Trash/Move, `reheatEnabled` for Reheat). A verb that applies to some of the selection says so ("Reheat 10 of 12"); one that applies to none is hidden. The server stays the real gate. | Root |
| M6 | **Reheat:** the per-item reheat route is single-flight (409 while any reheat runs, lib/ytdlp/index.js ~7539), so a client loop cannot work. Add an **ids-scoped library batch**: `POST /api/ytdlp/repull-metadata` accepts an optional `ids: string[]` that NARROWS the existing enumeration (eligible AND visible AND in `ids`), with every guard of the existing route unchanged (requireManageSubscriptions, refuseIfReadOnlyMedia, the single-flight latch, the visibility predicate, cancel, activity progress, the 202 counts). Validate `ids`: array of non-empty strings, no NUL, a sane cap (builder picks and states it, e.g. 500). An id that is unknown/hidden/ineligible is just not in the worklist and is counted, never an error that leaks its existence. Absent `ids` = byte-identical to today. The `/preview` sibling takes the same `ids` if the client shows a preview count. | Root |
| M7 | **Move to Trash:** one danger confirm naming the count and total size (the Clean up shape, `confirmCardDelete`'s wording), then ONE ordinary `DELETE /api/videos/:id` per selected id, sequentially. **No bulk-delete route** (Clean up's posture, ROADMAP v1.342.0). The confirm is seeded from the selected ids at confirm time, not from a stale render. | Root |
| M8 | **Move to folder:** one folder picker for the set (reuse the card/watch Move picker), then the existing per-item `POST /api/videos/:id/move`, sequentially. No new route. | Root |
| M9 | **Results are reported honestly, once:** one toast/summary per action with counts ("Moved 11 to Trash. 1 failed."). Succeeded cards leave the grid (Trash/Move off this folder) or update in place; **failed cards stay selected** so a retry acts on exactly them. A mid-run failure does not abort the rest unless the server says the whole action is refused (401/403/read-only), which stops the run and says why. | Root |
| M10 | Selection is by **id**, survives a re-render of the grid (live updates, sort change) for ids still present, drops ids that left, and clears on leaving the page or changing scope/folder. | Root |
| M11 | Out of v1: music, books, podcasts, TV, Pages grids (their own pages); a whole-folder server-side select; bulk Unlike/Unwatch; undo beyond Trash's own restore. Record them in ROADMAP Planned only if Dean asks. | Root |
| M12 | No dependencies, vanilla JS (standing). UI uses existing tokens/components (`U.button` etc.); `npm run lint:ui` and the overlay-containment census stay at their ceilings; the sticky bar declares a `z-index` (LESSONS 3/6). | standing |

## Acceptance (the gate measures these)

1. On the Downloads folder, a library folder, search, Liked and Watch later: Select enters select mode; ticking 3 cards
   shows "3 selected"; a tap on a card in select mode toggles it and does not navigate (assert `location` unchanged and
   no player load).
2. The card menu's Select row enters select mode with that card ticked; long-press still opens the menu (unchanged).
3. Shift-click on desktop ticks the contiguous range between the last-ticked card and the clicked one.
4. "Select N shown" ticks exactly the loaded cards; scrolling to load more does not tick the new cards.
5. Reheat on a 3-card selection sends ONE `POST /api/ytdlp/repull-metadata` with those 3 ids; the server's worklist is
   exactly the eligible, visible ones among them (a hidden id from another user's restricted folder is not reheated and
   its existence is not revealed in the response). Without `ids` the route is byte-identical (existing tests green,
   plus one new parity test). A malformed `ids` (not an array, non-string, NUL, over the cap) is a 400 with nothing started.
6. Move to Trash on a selection: one confirm with count and size; Cancel deletes nothing; Confirm sends one DELETE per
   selected id and nothing else; a server failure on one id leaves that card selected and the summary says "1 failed".
7. Move to folder moves each selected file via the existing route; a failure is reported per M9; nothing outside the
   selection moves.
8. A user without library-edit rights sees no Trash / Move in the bar; without the reheat capability, no Reheat.
9. Leaving select mode (Cancel, Escape, navigating away, changing folder) clears the selection; a grid re-render keeps
   ticked ids that are still present.
10. Phone width (390) and desktop (1280): the bar does not overlap the bottom nav or the mini player, no page overflow,
    measured in real Chromium (the probe pattern), before/after numbers in Evidence.

## Research the builder does first (record in ## Research, cite file:line)

- R1 How cards render and re-render (main.js grid, the virtual window / infinite scroll, live-update re-renders), and
  where a per-card checkbox + a `select-mode` class hook in without breaking the card's click/hover-preview handlers.
- R2 The action-menu path (`buildCardMenuItems`, the `FTInteraction.onActionMenu` binding ~3145/3415) for adding the
  Select row and for reusing each verb's existing per-item implementation, so the bulk path calls the SAME functions,
  not copies (LESSONS: inert sibling list - one roster, not two).
- R3 The existing Move picker and `confirmCardDelete` (~784) for reuse.
- R4 `enumerateRepullableItems` + `runRepullMetadataBatch` for where `ids` narrows the list, and the existing reheat
  tests to extend.

## Data-loss brief for the Adversary (full gate, forced)

Brief the Adversary to DESTROY data through this feature: make Trash or Move act on a card that was not selected
(stale selection after a re-render, a sort change, a scope change, a grid that loaded more, two tabs, a double-click on
Confirm, an id that changed between render and confirm); make select-mode taps leak through to a delete; make the
reheat `ids` path reach a hidden item or start with a malformed body. Access control (LESSONS 10): the new `ids`
parameter on the reheat route is a mutating surface, so prove the visibility predicate still applies to every id.

## Waves

- **W1** select mode on the grid (M1-M3, M10) + the action bar shell + client-only verbs (queue, Watch later, Like,
  Mark watched).
- **W2** the ids-scoped reheat route (M6) + its client verb, with tests.
- **W3** Move to folder + Move to Trash (M7-M9) + the measured layout pass (acceptance 10).

Release ceremony per docs/RELEASING.md (ROADMAP Shipped entry, `docs/releases.json` user-language ledger, LESSONS
entry if the gate teaches one), protected-main PR flow; the PR merge waits on Dean's word if the classifier refuses.

## Design

_(builder writes this, inside the rulings)_

## Steps

_(builder)_

## Deviations

## Evidence
