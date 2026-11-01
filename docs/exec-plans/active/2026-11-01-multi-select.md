---
plan: multi-select
harness: v2 · full
branch: feat/v1.400.0-multi-select
anchor: spec
status: Approved (kickoff rulings below; the builder writes Design + Steps, then builds)
next: builder - W1 (select mode + bar + client verbs), then W2 (ids reheat), W3 (Trash + Move + layout), full gate
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

## Research (builder, 2026-11-01; file:line on this branch at 16038abc)

- R1 Grid render. Cards are DOM built by `buildVideoCardEl` (main.js:791) through the view's `buildCardEl` (2464) and
  the ONE DOM writer `putCards(items, append)` (2483: replace = `replaceChildren`, append = `appendChild`). Page 0 /
  sort / format / search / shuffle go through `fetchLibraryPage0` -> `renderMediaGridPage` (2008, 2807); further pages
  through the IntersectionObserver sentinel -> `maybeLoadNextPage` (2320, appends only, never re-renders); the modern
  home through `fetchModernGrid` (1705) into the same `#video-grid`. In-place removals: `removeCardFromGrid` (2513),
  `toggleCardWatchLater` (3195), `hideCardFromFeed` (3260). The id is `card.dataset.id` (798) and the view's truth is
  `currentItems` (1330). Click paths: the stash-watch-seed bubble listener on the grid (1286), the router's document
  anchor handler (navigates), the kebab delegate (3408). Hover preview: `PreviewCards.start(el)` (1085) from the grid's
  mouseover (desktop) / the in-view observer (mobile). Modern mode hides `.section-title` (style.css:7316) and injects
  its controls into `.header-right` (`injectModernHeaderSort`, 1751); feed mode hides the grid (7290, no cards).
- R2 Menu path. `buildCardMenuItems(item, caps, opts)` (725) is pure and is the applicability authority; `openCardMenu`
  (3377) builds it with `cardCaps` and the view's opts; `runCardAction` (3328) dispatches ONE verb for ONE card to the
  per-item implementations: `addToQueue` (common.js:4949, toasts + Undo), `toggleCardLike` (3172, POST/DELETE by state),
  `requestWatchLater`/`setWatchLater` (common.js:15327/15345: silent request + the toasting verb), `triggerCardReheat`
  (3227, the single-flight per-item route), `confirmAndDeleteCard` -> `deleteCardById` (3311, 2768, toasts per item).
  Long-press / right-click: `FTInteraction.onActionMenu(videoGrid, ...)` (3419; interaction.js:271 - the fired press
  swallows the click that follows it, interaction.js:90). Mark watched has no card row today: watch.js:3869 and
  skin-surface.js:333 POST `/api/watched/:id` directly (media only, lib/user/routes.js:96). Move to folder has no card
  row either: watch.js:753 offers it under `canModifyLibrary`.
- R3 Reuse. `showMoveModal(item, folders, onMove, doc)` (common.js:13960) is the ONE Move picker (a ui.sheet dialog
  with a ui.select of `GET /api/config` folders; watch.js:4417 is its caller) and `requestMoveItem(id, folder)`
  (common.js:15182) the silent per-item POST. `cardDeleteConfirmCopy` (778) is the single-card Trash copy;
  `cleanupConfirmBody(count, bytes)` (cleanup.js:57) the count-and-size shape. `formatFileSize` (common.js:1194).
  `DELETE /api/videos/:id` (lib/media/routes.js:968): 403 no capability, 409 read-only `{readOnly:true}`, 404, 200
  `{success}` (`deleteResultToast` reads it). `POST /api/videos/:id/move` (1382): 403 / 409 read-only / per-move status.
- R4 Reheat. `enumerateRepullableItems(db, config, itemVisible)` (lib/ytdlp/relocation.js:1017) is the one
  enumerator: the batch route (lib/ytdlp/index.js:7368), the per-item route (7539) and the relocation preview all call
  it; `runRepullMetadataBatch` (1219) runs the worklist and ALSO relocates a hydrated import that is NOT in the download
  root (`maybeRelocate`, 1283; `relocateHydratedImports` setting, server.js default ON). The single-flight latch is
  `repullMetadataInProgress` (773). Tests: test/integration/ytdlp-repull-metadata-endpoint.test.js (fake express app +
  fake deps, the enumerator stubbed), test/integration/rbac-reheat-visibility.test.js (the real server, a restricted
  member, the enumerator real).

## Design

Inside M1-M12. Everything client-side lives in the home view's `init()` closure (main.js) beside the card menu it
extends; the pure pieces are module-scope and exported for tests; the server change is one optional parameter.

**Selection state (M10).** Per view instance: `selectMode` (bool), `selected` (a Set of id strings, insertion order),
`lastTickedId` (shift ranges). The DOM carries it: `#video-grid.is-select-mode`, `.video-card.is-selected`, and a
`.card-tick` glyph (`ui.icon('check')`, no button) placed in `.card-media` of every card while in select mode.
`syncSelection()` is the one reconciler: it drops every id not in `currentItems`, repaints the ticks, and rewrites the
bar. It runs after `putCards` (both arms: a replace keeps the ids still present, an append ticks nothing new - M3), after
`removeCardFromGrid`, and after the two in-place `card.remove()` sites. Leaving the view aborts
`FileTube.viewSignal()` (read at enter, LESSONS 4: the cached home never aborts its own signal), which exits select mode
and clears the set; `destroy()` does the same. A scope/folder change is a new view instance (fresh `init`), so the set
is gone by construction.

**Entry (M2).** (a) A static `Select` ui-btn (tonal, sm, pill, `#select-mode-btn`) in `.library-tools` of index.html,
first in the tools group, hidden while the grid has no cards; on the modern home (its header hides `.section-title`) the
same control is a header glyph injected like the modern sort (`injectModernSelectButton`, removed on abort). (b) A
`Select` row first in `buildCardMenuItems` when `opts.selectable === true` (the view passes it for every grid card; the
pure builder stays testable); `runCardAction('select')` enters select mode with that card ticked. Long-press keeps opening
the menu in normal mode (no gesture change). In select mode: a CAPTURE-phase click listener on `#video-grid` claims every
click inside a non-skeleton `.video-card` - `preventDefault` + `stopPropagation` so neither the card's `<a>`, the
stash-seed listener nor the router's document anchor handler run - and toggles the card (shift-click: ticks the range
from `lastTickedId` to it in grid order); `onActionMenu`'s handler returns early (no menu over a pending selection; the
gesture's click swallow still fires, so a long-press in select mode toggles nothing); `PreviewCards.start` refuses a card
inside a select-mode grid and `PreviewCards.stopAll()` stops the running previews at entry; a document `keydown` Escape
(bound while in select mode) and the bar's Cancel leave select mode and clear the set.

**Select all (M3).** The bar's `Select N shown` ticks exactly `currentItems` (the loaded cards) at the moment of the tap.
A page appended later is not ticked (append calls `syncSelection`, which only prunes).

**The bar (M4, M12).** `.select-bar`, built with ui primitives, appended to the view root (view-owned DOM inside
`#view-root`, discarded with it) and shown only in select mode. Two rows: the head (`N selected`, `Select N shown`,
Cancel) and the verbs row (ui-btn sm tonal pills with registry icons, in M4's order: Add to queue, Watch later, Like,
Mark watched, Move to folder, Reheat metadata, Move to Trash (destructive)). The verbs row scrolls horizontally on a
phone and wraps on desktop; a button never shrinks (CONTRIBUTING's action-row rule). `position: fixed`, `z-index:
var(--z-chip)` (above the bottom nav, below the dock), bottom = `var(--space-6)` on desktop and
`calc(var(--mobile-bottom-nav-h) + var(--space-4))` on a phone (the toast host's rule), lifted by
`var(--player-dock-h) + var(--space-4)` under `html.has-player-dock` (the rung player.js writes on every dock show, the
`#remote-pill` precedent). No raw literals; the tick and the bar take their colours from the roles (`--accent-fill`
for a ticked glyph, `--surface-1` / `--shadow-overlay` for the bar). `[hidden]` already wins globally (ui.css:87).

**Applicability (M5).** `buildBulkActions(items, caps)` (module scope, exported) returns the bar's verbs. For queue,
Watch later, Like, Reheat and Trash a card applies iff `buildCardMenuItems(item, caps, {})` offers that id (the menu
IS the rule; `like` applies to any card the menu offers Like on, and the run then skips cards already liked as no-op
successes - M4's SET semantics). Mark watched and Move to folder have no menu row, so their rules are stated here:
Mark watched = a media card (`cardKindPresentation(item) === null`; the only kind with the route); Move to folder = a
media card AND `caps.canModifyLibrary === true` (watch.js:753's rule). Label: the verb alone when every selected card
applies, `Verb N of M` when some do, absent when none do. Capability-gated verbs (Trash, Move, Reheat) are therefore
absent for a member without the capability (acceptance 8); the server stays the gate.

**Running a verb (M9).** `runBulk(verb)` snapshots the applicable selected ids IN GRID ORDER at the tap, latches a busy
flag (a second tap while running does nothing; the verbs disable), and runs them sequentially with one await per id.
Per id: `ok` (untick), `failed` (stays ticked), or `refused` (401/403, or a 409 `{readOnly:true}` for Trash/Move):
refused stops the loop, says why, and leaves every unsent id ticked. Leaving the view mid-run (the shown-view signal
aborts) stops the loop before the next request. One summary toast per run (`Moved 11 to Trash. 1 failed.`,
`Added 12 to the queue.`, `Liked 12.`, `Marked 12 watched.`, `Added 12 to Watch later.`, `Moved 11. 1 failed.`,
`Could not: you don't have permission ...`). When nothing stays ticked the view leaves select mode; otherwise it stays
in select mode on exactly the failed cards. The per-item requests are the SAME functions the card menu uses, made
silent where the menu one toasts: `addToQueue` is split into `requestQueueAdd` (silent, common.js) + the toasting
wrapper; `toggleCardLike` into `requestCardLike(item, on)` + the toggle; `deleteCardById` gains a `{ quiet: true }`
return-the-outcome mode the single path does not use; `requestWatchLater` and `requestMoveItem` already exist silent.
Mark watched POSTs `/api/watched/:id` (the watch page's own request) and sets `item.watched`; Like sets `item.liked`.

**Reheat (M6, W2).** The bar's verb sends ONE `POST /api/ytdlp/repull-metadata` with `{ ids }` (grid order). Server:
the body's `ids`, when present, must be an array of 1..500 strings, each non-empty, at most 512 characters, with no NUL
byte, else 400 `{ error }` before any database read and with nothing started (the RBAC, read-only and single-flight
checks run first, unchanged). The validated ids become a Set handed to `enumerateRepullableItems(db, config,
itemVisible, onlyIds)` as a NEW optional fourth argument: inside the loop, after the broken-record branch and the
visibility check, an id outside the set is skipped, so a hidden or unknown or ineligible id is simply not in the
worklist or the counts. The 202 body gains `requested: ids.length` ONLY when `ids` was sent; without `ids` the route and
its response are byte-identical (bound by a parity test on the fake-deps harness that asserts the enumerator is called
with `undefined` and the body is the existing shape). The batch runner is untouched, so an ids-scoped run behaves
exactly like the Settings page's Library Reheat for those items - including its relocation of a hydrated import that
sits outside the download root while `relocateHydratedImports` is on (the Downloads folder is the download root, so
Dean's stated case never relocates). Disclosed here and in the ROADMAP entry. The `/preview` sibling does not take
`ids`: the client shows no preview count (M5's `Reheat N of M` comes from the card menu's own rule). Client: 202 ->
`Reheating N` (N = `eligible`; `Reheating N of M` when it is under `requested`) and every sent id unticks (progress
shows in the existing download status chip); 409 -> `A reheat is already running.`; 403 -> the read-only message.

**Move to Trash (M7, W3).** One `ui.confirm` (danger) bound to the shown-view signal, seeded at confirm time from the
selected ids that are still in `currentItems`: `Move N items (<size>) to Trash?` + the single-card copy's second
sentence, plus `Local files cannot be re-downloaded.` when any selected media item is not yt-dlp-managed; the count and
size are summed from `item.size` at that moment. Confirm -> `runBulk('delete')`: one `DELETE /api/videos/:id` per id
(a podcast card in a mixed grid goes to its own route through `deletePodcastCard`'s quiet twin), sequential, succeeded
cards leave the grid through the existing in-place removal. Cancel / Esc / scrim / Close / a late tap send nothing.

**Move to folder (M8, W3).** `showMoveModal` with `item = { label: 'N videos' }` and the view's `allFolders` (the same
`GET /api/config` list); the picker gains an unquoted `label` reading (`Move N videos to:`) beside its existing quoted
title form. Its `onMove` runs `runBulk('move', folder)`: `requestMoveItem(id, folder)` per id, sequential; a moved item
is re-keyed by the server (a new id), so its card leaves this grid on every scope (a stale card would 404) and the
counts shrink - the plan's "update in place" reading is not possible without the new item, disclosed.

**Layout evidence (acceptance 10).** `scripts/select-bar-probe.js` (the CDP probe pattern): boots this tree on a
scratch DATA_DIR seeded with the visual fixture, at 390x844 (touch, phone) and 1280x800, enters select mode, ticks two
cards, and prints the bar's rect, the bottom nav's rect, the dock's rect (after `FileTube.player` docks a video) and
`scrollWidth` vs `innerWidth`; the acceptance numbers are zero overlap and no page overflow, before (main: no bar; the
nav and dock rects) and after. A `select-mode` scene joins test/visual/capture.js (a new surface gets a scene).

**Tests.** W1: unit (`buildBulkActions`, the Select row, `requestQueueAdd`/`requestCardLike` wiring) and a full-chain
jsdom suite on the real index.html (the card-action-menu-fullchain harness shape): enter / tick / count / a click in
select mode leaves `location` unchanged and stashes no watch seed / Escape and Cancel / the menu's Select row / shift
range / Select N shown vs an appended page / a re-render keeps ticked ids / the four client verbs send exactly the
expected requests in grid order with SET semantics and one toast. W2: the endpoint harness (400 shapes with nothing
started, the Set reaching the enumerator, the `requested` field, the no-ids parity) and the real-server RBAC suite
(a hidden id in `ids` is not reheated and the response does not reveal it). W3: the full-chain suite's destructive
half (confirm count and size, Cancel sends nothing, one DELETE per id and nothing else, a failed id stays ticked and
the summary says `1 failed`, a 403 stops the run; Move: the picker, one POST per id, failure per M9) and the probe.

## Steps

W1 (select mode + bar + client verbs)
1. main.js module scope: `buildBulkActions`, the `select` row in `buildCardMenuItems` (opts.selectable), the
   `PreviewCards` select-mode refusal + `stopAll`. Export the pure pieces.
2. main.js view: state, `enterSelectMode`/`exitSelectMode`/`toggleSelected`/`selectAllShown`/`syncSelection`, the
   capture click handler, the Escape handler, the shown-view abort, the `onActionMenu` early return, the bar builder,
   the `runBulk` runner with the queue / Watch later / Like / Mark watched verbs, the modern-home header glyph.
3. common.js: `requestQueueAdd` split out of `addToQueue`; main.js: `requestCardLike` split out of `toggleCardLike`.
4. index.html: the Select button. style.css: the tick, the selected card, the bar (phone + desktop + dock lift).
5. Tests (unit + full-chain); `npm run lint`, `npm run lint:ui`, the overlay census; commit.
W2 (reheat)
6. relocation.js: the `onlyIds` argument. index.js: validate `ids`, thread the Set, `requested` in the 202.
7. main.js: the Reheat verb. Tests: endpoint harness + RBAC suite + parity; commit.
W3 (Trash + Move + layout)
8. main.js: the Trash confirm + `deleteCardById` quiet mode + the Move verb; common.js: `showMoveModal` label form.
9. Full-chain destructive tests; `scripts/select-bar-probe.js` + the probe numbers; the visual scene; commit.
10. Full Node 22 suite; the gate (full, data-loss brief); release per docs/RELEASING.md.

## Deviations

- W1 (2026-11-01): the grid header's Select is an ICON-ONLY ui-btn (the `checklist` glyph, aria-label and title
  "Select"), not a labelled pill: `test/unit/home-mobile-scale.test.js` locks the tools group to icon-only controls
  (a measured phone-fit rule, sweep S2), so the Design's "tonal, sm, pill" became the group's own shape (comply, never
  widen - LESSONS 3). The word "Select" is the card menu's row. The modern home's header glyph is the same button.
  `checklist` joined the icon registry (tools/icons/names.js, fetched and rebuilt) for the tool and the menu row; the
  per-card tick keeps `check`.
- W1: the Like request moved into `requestCardLike(item, on)` and the Watch later / queue errors now carry `status`;
  the card-like source lock and the key-listener census were updated in lockstep (intent preserved: the toggle still
  DELETEs when liked and POSTs when not; the Escape listener is bubble-phase and classified).

## Evidence
