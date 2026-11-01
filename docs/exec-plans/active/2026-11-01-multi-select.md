---
plan: multi-select
harness: v2 · full
branch: feat/v1.400.0-multi-select
anchor: spec
status: Approved (kickoff rulings below; the builder writes Design + Steps, then builds)
next: the fix commit for r1, re-confirmation by the same three seat instances (r2), then the release
design: Rulings approved by Dean 2026-11-01 (AskUserQuestion); the builder's Design must stay inside them
gate: running - full (adversary, qa, security-brief; data-loss forced); r1 @1f49d923 security APPROVED, qa + adversary CHANGES; r2 on the fix sha
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
  `DELETE /api/videos/:id` (lib/media/routes.js:968): 403 no capability (`requireModifyLibrary`) AND 403
  `{readOnlyMedia:true}` for the instance-wide read-only mode (server.js `refuseIfReadOnlyMedia`), 409 per FILE (an
  unconfirmable delete, `{readOnly:true}` with the file's own reason), 404, 200 `{success}` (`deleteResultToast` reads
  it). `POST /api/videos/:id/move` (1382): the same two 403s, then the move's own status. (Corrected in gate r1: the
  first draft called the read-only mode a 409.)
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
Per id: `ok` (untick), `failed` (stays ticked), or `refused` (401 / 403, the instance-wide read-only mode being a
403 with `readOnlyMedia: true` whose message names it; a 409 is per-file and a failure): refused stops the loop, says
why, and leaves every unsent id ticked. While a confirm, a picker or a run is up the selection is FROZEN (toggles and
Select all are ignored, the bar's controls disabled), and what runs must be the SAME ID SET the confirm or the picker
was opened on (identity, never a count): a selection that changed underneath runs nothing and says so (gate r1 A1). Leaving the view mid-run (the shown-view signal
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
- Gate r1 fixes (2026-11-01; qa W1-W3, S1-S4; adversary A1-A3, A5-A7, A9; security INFO 1 left as is): the confirm
  and the picker bind the id SET they were opened on and freeze the selection while up (A1); the empty render arms
  call the reconciler (A2 / W1); the read-only contract is the real one, a 403 with `readOnlyMedia` (W2 / A4), and the
  single-card paths keep their old 401 behaviour (S1); the picker latches the bar and is torn down with the selection
  (A5); the clearance under the grid follows the dock lift and the probe measures the last row at the end of the
  scroll (W3); the modern glyph's pressed state follows every exit (S2 / A9); a mixed selection's confirm names where
  an episode restores (A7); the cap is pinned by value (A3 i01); the Escape / navigate mid-run guard, the Move
  re-render under the picker, the preview refusal and a mixed run are bound by tests (A3, A6, S3). Not taken: S5
  (clearing the sidebar on desktop - the toast host's own full-width posture; a ROADMAP note), security INFO 1
  (`requested` counts the caller's duplicates - the bar never sends any).

## Evidence

### Commits (branch feat/v1.400.0-multi-select, base main 1f5e2c5c)

- b90e5e8c docs(plan): research R1-R4, Design, Steps
- b1a56d3f W1: select mode on every video grid, the action bar, the four client verbs
- c8d01a97 W2: Reheat on a selection through an ids-scoped library batch
- 4f34397f W3: Move to Trash and Move to folder on a selection, the layout probe, the visual scene

### Suites

- Full Node 22 suite (`npm test`, v22.23.1) at 4f34397f: 13117 tests, 13104 pass, 0 fail, 0 cancelled, 13 skipped.
- `npm run lint:ui`: OK, the live debt equals docs/ui-exceptions.json (TOTAL 3142, unchanged); overlay containment: 0.
- New suites: test/unit/multi-select-actions.test.js (8), test/integration/multi-select-fullchain.test.js (24: entry /
  toggling / Escape / Cancel / the menu row / shift range / Select N shown vs an append / re-render / leaving the view /
  the capability-gated bar / queue, Like, Watch later, Mark watched, Reheat, Trash, Move, each with its failure and
  refusal shapes), the ids tests in test/integration/ytdlp-repull-metadata-endpoint.test.js (5) and
  test/integration/rbac-reheat-visibility.test.js (4). Locks updated in lockstep: card-like, pocket-kb-search (the
  key-listener census), card-action-menu-fullchain (two confirm-gated delete callers), move-trigger-wiring (the
  picker reached only from the bar); home-mobile-scale was COMPLIED with (the icon-only tool), not edited.

### Acceptance 10: the layout probe (`node scripts/select-bar-probe.js <out>`, real Chromium, this tree vs main)

Rects are x / y / w / h in CSS px; overlap = the intersection area of the bar with the nav or the dock (0 required);
overflow = scrollWidth > innerWidth (false required). Two cards ticked; "dock" = a video playing in the mini player.

| cell | tree | bar | bottom nav | dock | overlap nav / dock | overflow | verbs (rows) |
|---|---|---|---|---|---|---|---|
| phone 390x844 | main (before) | none | 0/792/390/52 | none | 0 / 0 | no | - |
| phone 390x844 | branch (after) | 8/680/374/84 | 0/792/390/52 | none | 0 / 0 | no | 6 (1, scrolls) |
| phone 390x844 + dock | main (before) | none | 0/792/390/52 | 222/630/160/134 | 0 / 0 | no | - |
| phone 390x844 + dock | branch (after) | 8/538/374/84 | 0/792/390/52 | 222/630/160/134 | 0 / 0 | no | 6 (1, scrolls) |
| desktop 1280x800 | main (before) | none | hidden | none | 0 / 0 | no | - |
| desktop 1280x800 | branch (after) | 12/706/1256/82 | hidden | none | 0 / 0 | no | 6 (1) |
| desktop 1280x800 + dock | main (before) | none | hidden | 984/601/280/184 | 0 / 0 | no | - |
| desktop 1280x800 + dock | branch (after) | 12/514/1256/82 | hidden | 984/601/280/184 | 0 / 0 | no | 6 (1) |

The nav and dock rects are identical on both trees (the bar changes nothing else). The bar sits 28 px above the
nav on a phone and above the dock when it shows (8 px on the phone, 5 px on desktop; the dock lift reads
`--player-dock-h`: 134 px phone, 184 px desktop). Six verbs here because the probe's instance has no yt-dlp module
(no Reheat); with it, seven. Gate r1 opened on 1f49d923 (this evidence commit over the W3 code at 4f34397f).

Gate r1 (qa W3), the probe extended: scrolled to the very END of the grid, the last card's bottom edge against the
bar's top edge (the last row must stay reachable under the bar; the clearance under the grid now follows the dock
lift). Measured on the fix tree, CSS px from the viewport top:

| cell | last card bottom | bar top | clear |
|---|---|---|---|
| phone 390x844 | 643 | 680 | yes (37 px) |
| phone 390x844 + dock | 509 | 538 | yes (29 px) |
| desktop 1280x800 | 647 | 706 | yes (59 px) |
| desktop 1280x800 + dock | 463 | 514 | yes (51 px) |

The bar, nav and dock rects are unchanged from the r1 table.

Gate: APPROVED r1 @1f49d923 — security-brief
- Gap (stated, not smoothed): no Bash, so no `git diff 1f5e2c5c`; the server-side change set was located by a tree-wide grep for the v1.400 / multi-select / onlyIds / validateRepullIds markers plus the plan's commit list (lib/ytdlp/index.js and lib/ytdlp/relocation.js are the only lib files touched; lib/media, lib/user, server.js carry no marker). An unmarked server change would have escaped this review.
- No CRITICAL, no WARNING. Verified: guard order (RBAC 403 -> read-only 403 -> single-flight 409 -> wiring 503 -> body rule 400 -> loadDatabase) with no await between the 409 check and the latch set; the enumerator drops a hidden id at the visibility predicate BEFORE the ids filter, so a hidden id and an unknown id take the same `continue` path and yield the same 202 body (bound by rbac-reheat-visibility.test.js:231); no 400 message echoes a submitted id; the Set is string-only (no prototype write surface); the batch runner is untouched, so relocation is the existing manage-subscriptions capability narrowed, never widened; no new route; every bulk verb is the existing per-item request (requestQueueAdd / requestWatchLater / requestCardLike / POST /api/watched/:id / DELETE /api/videos/:id / POST /api/videos/:id/move) behind its existing server gate; the bar count, labels, confirm body (ui.confirm textContent), picker label (textContent) and toasts (ui.toast spanText) never touch innerHTML; the Move picker's targetFolder reaches moveItemToFolder unchanged; CSRF: every entry is a click handler (select button, modern glyph, menu row, bar pills, dialog buttons), nothing fires from a URL parameter, cookie is SameSite=Lax.
- INFO 1 lib/ytdlp/index.js:7460: `requested` is `body.ids.length`, so duplicates in the request inflate it ("Reheating 1 of 3" for one id sent three times). Reflects only the caller's own input; no leak. Accept or count the Set.
- INFO 2 (pre-existing, labeled suspicion, not in this diff): lib/ytdlp/relocation.js:1030-1033 counts a broken record (no filePath) in `ineligible` before the visibility predicate, so the 202's `ineligible` is library-wide for a restricted member. A bare count of broken rows, no id or path; v1.127 chose this deliberately. Not changed here.
- INFO 3 (pre-existing, labeled suspicion, not traced): the activity chip's `current` label (lib/ytdlp/index.js:1353, videoId or file basename) is the STARTER's visible item; whether a different restricted member polling GET /api/subscriptions/status sees it was not traced. Unchanged by this diff.
- INFO 4: the global express.json() keeps body-parser's 100 kb default, so a 500 x 512-character `ids` body is a 413 from the parser before the route (and before RBAC, as for every JSON route). The cap is therefore bounded by the parser first; harmless.
- INFO 5 (pre-existing): public/js/main.js:2921 `deleteCardById` builds `/api/videos/${id}` without encodeURIComponent; the quiet twin inherits it. Ids are server-minted hex, so unreachable as an injection in this deployment.
- INFO 6 (UX, not security): public/js/main.js:3953 maps every reheat 403 to the read-only wording; a no-capability 403 is impossible from the bar (the verb is hidden without reheatEnabled) but a stale session could show the wrong sentence.

Gate: CHANGES r1 @1f49d923 — qa
- W1 main.js renderMediaGridPage empty arm (returns before putCards) + fetchModernGrid empty/error arms: syncSelection never runs, so an in-place re-render to an empty grid (format chip with no matches, a modern chip) leaves the bar saying "N selected" with live verbs and the Select tool pressed over an empty grid; verbs then silently do nothing. Call syncSelection in those arms.
- W2 read-only contract is wrong in code, comment and plan: server.js refuseIfReadOnlyMedia answers 403 {readOnlyMedia:true} (delete and move); no 409 {readOnly:true} exists on the move route and the delete 409s are per-file. deleteCardById's quiet 409 /read-only media mode/ branch and its "instance-wide read-only mode" comment describe a response the server never sends; bulkRefusal's 409 arm is unreachable; in real read-only mode a bulk Trash/Move stops with "You don't have permission for that." (wrong reason). Map 403 readOnlyMedia to the read-only message, fix the comment, correct R3/Design, add a fixture.
- W3 (reasoned, not measured) style.css .video-grid.is-select-mode margin-bottom 128px vs the bar's top at 306px (phone) / 286px (desktop) above the viewport bottom when the dock shows; nothing lifts page content for the dock, so the last row sits under the bar at the end of the scroll and cannot be ticked. Add the --player-dock-h to the clearance under html.has-player-dock and have the probe scroll to the end.
- S1 deleteCardById/deletePodcastCard: 401 now toasts the permission message on the single-card path too (was "Error deleting file: ..." / "Could not delete the episode."); the "single-card path is unchanged" comment and Deviations do not say so.
- S2 modern header Select glyph: aria-pressed is written only by its own click; Cancel/Escape/nav-away leave it "true" (syncSelection updates only #select-mode-btn).
- S3 PreviewCards select-mode refusal and stopAll have no test (presence, not binding).
- S4 move-trigger-wiring: the bulkOne slice spans runBulkOne..runBulk (includes bulkTargets, confirmBulkTrash, openBulkMovePicker); bound it at bulkTargets.
- S5 desktop bar spans x 12..1268 at 1280, over the sidebar's bottom (--sidebar-w 230px); consider clearing the sidebar.
- I1 Evidence says home-mobile-scale was updated in lockstep; the file is unchanged in the diff (the tree complied with it, as Deviations says). I2 "8 px above the dock": 5 px on desktop (601-596). I3 header says r1 on the W3 sha; r1 is on 1f49d923 (docs-only over 4f34397f). I4 probe: dead `hasBar` placeholder. I5 Watch later page offers "Watch later" (add) for cards already listed - no-op POSTs, consistent with M4, noting only.
- Verified: lint:ui OK (TOTAL 3142, equals docs/ui-exceptions.json); overlay-containment 0; eslint 0 errors (6 pre-existing warnings); 9 targeted suites 167/167 pass; button-label-rule + 2 structural reheat suites 3/3; select-bar-probe on this tree: 4 cells ok, rects identical to the table above. Security: ids is validated after RBAC (403 before 400, test-bound), used only as Set membership after the visibility predicate, hidden vs unknown answer identically; no injection/traversal/SSRF/exposure surface found; no new dependency.

Gate: CHANGES r1 @1f49d923 — adversary
- WARNING A1 (data-loss): startBulkRun compares the confirmed selection by COUNT (`opt.confirmedCount !== items.length`, main.js ~3813), not by identity. Repro (jsdom, real index.html + main.js): tick v1-v5, Trash -> confirm "Move 5 items (15000 B)"; a live refresh (`__filetubeRefreshLibrary`) drops v2; "Select 5 shown" (never disabled while busy, paintSelectBar) or Enter on a focused card link (the capture toggle) adds v6; Confirm -> DELETE v1,v3,v4,v5,v6 - v6 was in neither the confirm's count nor its size. The scrim blocks the pointer (z 1500 > 940) but not the keyboard: ui.sheet moves focus in and traps nothing (ui.js:631-636), so Tab leaves the dialog. Fix: snapshot the confirmed ids (runBulk and the picker), run exactly that set intersected with currentItems, refuse when any confirmed id left or any target is not confirmed (set equality, never a count); promote the repro.
- WARNING A2 (M10 unbound and bypassed): mutant m06 (drop the prune in syncSelection) survives 63/63 - the M10 test reads DOM ticks and the grid-order count, both already filtered by currentItems. On the COMMITTED tree the empty arm of renderMediaGridPage (~2974) returns before putCards, so syncSelection never runs: tick v2, re-render to an empty page (a format chip / search with no match), re-render back -> v2 returns TICKED; in between the bar is a stale painting ("1 selected", six live verbs over 0 cards, a tap runs nothing silently - qa W1). Fix: syncSelection in the empty arms (renderMediaGridPage, fetchModernGrid), plus two kill tests: leave-and-return (kills m06) and the empty-then-return case.
- WARNING A3 (named guards with no binding - the mutant IS the repro): m19 (drop `if (shown.aborted || signal.aborted || !selectMode) break;`) survives: under it Escape or navigate during a Trash run keeps deleting (a held DELETE on v2 + Escape, then release: v3, v4 sent); two tests (Escape mid-run, navigate mid-run) kill it. i01 (REPULL_IDS_CAP 500 -> 5000) survives: the endpoint test's `/at most 500/` substring-matches "at most 5000" (LESSONS 3, pinned number) - pin `REPULL_IDS_CAP === 500` or anchor the regex. m23 (the picker's onMove without confirmedCount) survives: no test re-renders under the picker - the Move twin of the data-loss-brief test.
- SUGGESTION A4: deleteCardById's quiet 409 arm (`/read-only media mode/` + "instance-wide read-only mode" comment) and bulkRefusal's 409 arm are unreachable: the instance mode answers 403 {readOnlyMedia:true} (server.js:437), the delete 409s are per-file, the move route's 409 has no readOnly. Measured with the real bodies: per-file 409 -> 3 per-item failures (run continues); instance 403 -> stops with "You don't have permission for that." (wrong reason). Plan R3 states the contract wrongly. (= qa W2.)
- SUGGESTION A5: the Move picker does not latch bulkBusy: bar Cancel while the picker is up (keyboard-reachable), then Move -> 0 requests, no toast, the picker closes - a silent no-op. Latch while the picker is up (as the confirm does) or tear it down in exitSelectMode, and toast when nothing runs.
- SUGGESTION A6: survivors on correct code: m16 (PreviewCards select-mode refusal, start + begin) - M2's "no hover preview" has no test; m18 (startBulkRun ignoring applicability) - the fixture is all-media, a mixed media+podcast run would bind it (measured: a mixed grid labels "Mark watched 1 of 2" and routes Trash per kind correctly); m10 (the bulkBusy early-returns) - masked by the disabled paint on every tap path, document as masked.
- INFO A7: bulkTrashConfirmCopy says "restore them from Settings" for a podcast in a mixed selection; episodes restore from the show's episode list (podcastTrashConfirmCopy). INFO A8: Evidence says home-mobile-scale was updated in lockstep - the file is unchanged (the tree complied). INFO A9: the modern header glyph's aria-pressed goes stale after Escape / Cancel (syncSelection updates #select-mode-btn only). INFO A10 equivalent mutants, not gaps: r05 (ids filter before the visibility check - two conjunctive continues) and m24 (Select all via the DOM).
- Measured: lint:ui OK (TOTAL 3142); overlay-containment 0; eslint 0 errors, 6 warnings identical to base; the 9 touched suites 167/167; 18 census/lock suites 79/79; select-bar-probe 4 cells ok, every rect identical to the table above; RBAC folder-kind twin of rbac-reheat-visibility 9/9 (the gate kind that diverges binds; a library:video twin hides the public clip too, as it should); server mutants r01-r04, i02-i08 all killed (hidden id with ids scoped, Set check, threading, every 400 shape, parity, latch order). 38 mutants: 29 killed, 9 survived (listed). Full suite NOT re-run by this seat (the hook refuses it on the docs-only HEAD); the 13117/13104/0 line above is the builder's measurement at 4f34397f.
