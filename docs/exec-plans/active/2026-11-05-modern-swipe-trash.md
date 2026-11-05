---
plan: modern-swipe-trash
harness: v2 · full (a destructive surface: LESSONS 9)
branch: feat/v1.403.0-modern-swipe-trash
anchor: spec
status: Building
next: gate round 2, then the release
design: Rulings approved by Dean 2026-11-05 (AskUserQuestion): S1-S6 below
gate: adversary + qa + security-brief (full; the Adversary briefed to trash the WRONG thing)
builder: smart
---

# v1.403.0 - swipe a card left on Modern home to move it to Trash, with Undo

Kickoff 2026-11-05 (FileTube Root, Opus). **Builder: Smart (Opus).** Why the tier: it lifts a deliberate safety rule
in the shared swipe helper (a full swipe may never be the danger action, D8.3) for one surface, inside a scrolling
multi-column grid with delegated card handlers, selection mode and the document-wide swipe-back; a wrong-card or
scroll-triggered Trash is the failure class. Not Extreme: Trash is restorable (Undo + Settings > Trash), no
migration, no route change.

## Why

Dean, 2026-11-05: "when I want to delete things from that feed, it's a tap on a small button to then press delete,
to then press yes, and that's just friction every day ... if I swipe all the way to the left, delete without asking.
Again, it's not actually truly deleting, it's moving it to deleted, and then that bit purged". He pointed at the
notifications panel's swipe as the model ("where you can do multiple things").

Today on Modern home (`resolveHomeLayout` = 'modern', main.js ~1566-1600, the flat `#video-grid`, 1 column at
<= 480 px, 3-4 wider): kebab -> menu "Move to Trash" -> `confirmAndDeleteCard(item)` (main.js ~3490) ->
`deleteCardById` (`DELETE /api/videos/:id`, returns `{ success, trashed, trashId }`, lib/media/routes.js ~1344-1355)
or `deletePodcastCard` (`DELETE /api/podcasts/episodes/:id`), main.js ~2896-2955. Three taps.

## Rulings (Dean, 2026-11-05)

- **S1 - full swipe = Move to Trash, no question, with an Undo toast.** The card slides away and leaves at once; a
  toast "Moved to Trash" with **Undo** appears (`showToast(msg, { label: 'Undo', onAction }, ...)`, common.js
  ~15764). Undo restores the file and puts the card back where it was.
- **S2 - a shorter swipe reveals buttons: Like, Watch later, Hide from feed, and Trash.** Each only when the card's
  own menu offers it (`buildCardMenuItems(item, cardCaps, ...)` is the one roster, main.js ~740-790; Hide = the
  Modern `feedhide` entry). Trash sits at the trailing edge (nearest the full-swipe end). No Trash in the roster (no
  `canModifyLibrary`, a read-only kind) = no Trash button AND no full-swipe action.
- **S3 - tapping the revealed Trash button skips the confirm too** (same path as S1: Trash + Undo toast). The kebab
  menu's "Move to Trash" keeps its confirm, unchanged.
- **S4 - touch AND mouse, the same code as notifications.** Dean: "We can click and swipe in Notifications. I'd
  rather not have deviating code". Use `FTInteraction.swipeRow` (public/js/interaction.js ~311), extended, never a
  second swipe implementation.
- **S5 - Modern home only.** Classic grid, folders, Liked, Watch later, search results, the Feed: unchanged.
- **S6 - "Trash" here = today's Move to Trash** (the same two endpoints, same toasts on failure, same 409 / 403
  handling); never `?removeAnyway`, never a purge.

## Step 0 (before any code)

- Read AGENTS.md; docs/LESSONS.md sections 1, 2, 4 (SPA lifecycle: the cached Home view never runs destroy()), 6,
  8 (iOS/WebKit pointer + touch-action facts) and 9 (the data-loss core) in full; then this plan once.
- Read: interaction.js whole (the swipeRow safety block at the top is the contract you are changing); its tests
  test/unit/interaction-policy.test.js and interaction-policy-css.test.js; ui.css `.ui-swipe` (~1089+); common.js's
  notifications `buildRow` (~4670, the one existing caller) and `SWIPE_BACK_OWNER_SELECTORS` / `touchActionOwnsHorizontal`
  (~11325) with test/unit/swipe-back-owners.test.js; main.js: the Modern block (~1566), `buildCardMenuItems`,
  `openCardMenu` + the action dispatcher (~3500-3560), `confirmAndDeleteCard`, `deleteCardById`,
  `deletePodcastCard`, `removeCardFromGrid` (~2658), `toggleCardLike` (~3353), `toggleCardWatchLater` (~3365),
  `hideCardFromFeed` (~3424), the select mode (`selectMode`, `syncSelection` ~3629), the delegated grid handlers and
  `FTI.onActionMenu(videoGrid, ...)` (~4012), the pull-to-refresh touch handlers (~3195); the restore routes
  `POST /api/trash/:id/restore` (lib/media/trash.js ~1181) and `POST /api/podcasts/episodes/:id/restore`
  (lib/podcasts/index.js ~1281).
- Environment: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"` before every
  npm/node/git command. Local suites on Node 22; Node 24 runs in PR CI.
- Git: work in the worktree on `feat/v1.403.0-modern-swipe-trash` (this plan is committed there). Stage by name,
  never `git add .`/`-A`, never force-push, never `--no-verify`, never pipe a commit or push; verify with
  `git log` / `git ls-remote`. Commit with `-F <file>`. Push with
  `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`.
- Release order: this is the only open plan. If origin/main moves before the release commit, merge it in and
  re-run the full suite.
- **Stop rules (ask Dean with AskUserQuestion):** the four buttons cannot fit a 390 px phone card while keeping the
  full-swipe point at or under ~65% of the card width (S1 must stay an easy swipe - measure it, then ask with the
  numbers and a choice, e.g. icons only or drop a button); Undo cannot put a restored item back (the restore answers
  with a different id, or the item cannot be re-rendered); a swipe conflicts with something on the iOS app that the
  web cannot settle (the app's own back gesture); gate round 3.

## W1 - swipeRow: an explicit, guarded opt-in for a danger full swipe

- The rule stays the default: `fullSwipe` naming a danger action still THROWS unless the caller passes a new opt-in
  (e.g. `dangerFullSwipe: true`). Notifications does not pass it and is byte-unchanged in behaviour.
- With the opt-in, the full-swipe path keeps every other D8.3 guard: it fires only on a horizontally LOCKED drag
  that passed `max(threshold * rowW, actionsW)`, once per gesture, never from a tap, a vertical scroll, a
  pointercancel, or a drag that started on an action button; a destroyed controller fires nothing.
- A revealed danger button tapped by the caller's choice runs its `onSelect` directly (S3 is the caller's
  onSelect, not a helper change) - the existing "only from a click that started on that button while open" guard
  stays.
- Buttons may carry an optional icon (the app's icon font, as the card menu's `icon` names) when W3's measurement
  needs it; text-only stays the default.
- Update the safety comment block at the top of interaction.js (the contract) in the same commit.
- Tests in interaction-policy.test.js: danger full swipe without the opt-in throws (as today); with it, a full
  swipe fires once; a vertical drag, a short drag, a pointercancel, and a tap fire nothing; a second full swipe on a
  row that already fired needs a new gesture. Mutate each guard off and watch the right test go red (LESSONS 2).

## W2 - Modern cards get the swipe

- On Modern home only (`modernMode`), every media and podcast card rendered into `#video-grid` (first page AND
  every appended page) gets one swipeRow controller; the `.ui-swipe` wrapper becomes the grid item (the grid CSS,
  the card's own layout and the 1/3/4-column reflow must look byte-identical at rest - prove with screenshots at
  390, 820 and 1440 wide). Controllers are destroyed when the card leaves, when the grid re-renders, and when the
  layout stops being Modern; the cached-Home rule (LESSONS 4) means a cached view's listeners must be inert while
  Home is not shown.
- Actions per S2 from the card's roster, wired to the SAME functions the menu uses (`toggleCardLike`,
  `toggleCardWatchLater`, `hideCardFromFeed`); a label reflects the state like the menu does (Like / Unlike, Watch
  later / its remove label).
- Trash (full swipe and button): skip the confirm, call `deleteCardById` / `deletePodcastCard` for THAT card's
  item (the id read from the card's own item at the moment of the swipe, never an index or a shared variable),
  then the Undo toast. Undo: `POST /api/trash/<trashId>/restore` (video) or the episode restore (podcast), then put
  the item back in `currentItems` and its card back at its old position (or the nearest still-present neighbour);
  a failed restore says so in a toast and points at Settings > Trash. A failed Trash leaves the card in place with
  today's message.
- `removeCardFromGrid` must remove the `.ui-swipe` wrapper too (no empty grid cell), and every other path that
  removes or re-renders cards (bulk Trash in select mode, feed hide, a re-sort, a chip change) must as well.
- Off while: select mode is on (a swipe neither opens nor fires; leaving select mode restores it), a card menu or
  confirm is open, the card is a skeleton or non-media tile.
- Gestures that must keep working: vertical scrolling of the grid (`touch-action: pan-y` on the swipe content -
  a sideways drift during a scroll must never lock into a swipe that trashes), pull-to-refresh at the top,
  long-press / right-click for the card menu (`onActionMenu`), tapping a card to play, inline thumbnail previews.
  A mouse drag must not start the browser's native image/link drag on the thumbnail.
- The document-wide swipe-back (rightward, common.js `wireSwipeBackGesture`): dragging an open card back to the
  right to close it must NOT go Back. Register the swipe wrapper as a horizontal owner (`SWIPE_BACK_OWNER_SELECTORS`
  or the `touch-action` net) and extend swipe-back-owners.test.js with the real Modern card markup, keeping its
  control case.
- Reduce Motion: the card leaves without the slide animation; the swipe itself still tracks the finger.

## W3 - prove it in the browser

- A headless probe (scripts/modern-swipe-probe.js; seed a library and a podcast episode the way existing probes
  seed media; mint a session with `__mintTestSession`; Modern on) in Chromium AND WebKit at 390x844 (touch), 820x1180
  (touch) and 1440x900 (mouse). Record: the actions width and the full-swipe point as a % of the card width at each
  size; a full swipe trashes exactly that card (server-side check: the item is in Trash, every other card is not);
  Undo restores it in place; a vertical scroll with up to ~20 px sideways drift trashes nothing; a short swipe
  reveals the buttons and each does what its menu twin does; select mode disables it; dragging an open card right
  does not navigate Back; the frame time of a drag (p95, the v1.402.0 probe method). Paste the numbers into Evidence.
- `npm run lint:ui` green; the visual baselines for Modern home unchanged at rest.

## Gate

Full gate per .harness/scrutiny.toml: adversary (floor), qa, security-brief. Brief the Adversary (Dean's norm for
destructive work) to TRASH THE WRONG THING: a scroll that becomes a swipe, the wrong card after an append or a
re-sort, a double Trash from one gesture, Undo restoring the wrong item or a card back into the wrong view, a cached
Home's controllers firing off-Home, notifications' guard silently weakened, a swipe during select mode. Security:
the restore call cannot be pointed at another user's or a restricted folder's Trash record (the routes already check
visibility - prove the client sends only the id the delete returned).

## Release

Per docs/RELEASING.md: version 1.403.0, ROADMAP "Shipped" entry, `docs/releases.json` in user language, a
DEVICE-CHECKS "Swipe to Trash on Modern home (v1.403.0)" section: (a) iPhone app, Modern home: swipe a video all the
way left - it leaves, "Moved to Trash - Undo"; (b) tap Undo - it comes back in place and plays; (c) a short swipe:
Like, Watch later, Hide, Trash - each works, Trash with no question; (d) scroll the feed fast with a sloppy thumb -
nothing gets trashed; (e) an open card dragged back right closes and does not go Back; (f) a podcast episode card:
the same; (g) on a computer, click-drag a card left: the same; (h) the ... menu's Move to Trash still asks; (i)
notifications' swipe unchanged (a full swipe still only dismisses). Close the plan with `node scripts/plan-complete.js`
in the same PR. Ask Dean before `gh pr merge`.

## Out of scope

Swipe on any view but Modern home; swipe right; a permanent delete; changing the Trash retention or the menu's
confirm; the Feed (reels) view.

## Evidence

Deviations from the plan's letter, each measured (the full numbers land at the final sha):
- W1 asked for a danger full swipe at `max(threshold * rowW, actionsW)`. Gate r1 (qa C1, adversary C1, W1, W2) measured that wrong: at every phone width the open row rests ON that line, so an 8 px wobble on an open row trashed the card, and a mostly vertical drag fired too. A danger full swipe now also needs a row closed at the press, `|dx| > |dy|` at release, and 24 px past the revealed buttons. Notifications' neutral full swipe is unchanged.
- Buttons: 44 px each, an icon over the menu's own label; four in a row at <= 480 px and >= 1200 px, two by two at 481-1199 px (four in a row were 176 px on a 167 px card at 820, where the full swipe was unreachable). No button dropped. 390x844: actions 176 px, full swipe at 215 px of 358 (60.0%), under the 65% stop rule.
- Applies to every swipeRow, notifications included: a new primary press drops a drag whose release was lost; a mouse with no button held cannot drag; a new press ends the post-drag click swallow (a tap on a just-revealed button inside the 400 ms window was eaten).
- A failed podcast restore points at its show, not Settings > Trash (podcast episodes restore from the show, v1.400.0 gate r1 A7).
- Bare Home is always history depth 0 (common.js, the top of the walk), so the swipe-back has nothing to pop there today: standing it down over the whole grid (adversary S3) costs nothing now; the probe stamps depth 1 to make "no Back" mean something, with a control that does go Back.

Gate: APPROVED r1 @1ee00d37 — security-brief
Gate: CHANGES r1 @1ee00d37 — qa
Gate: CHANGES r1 @1ee00d37 — adversary
