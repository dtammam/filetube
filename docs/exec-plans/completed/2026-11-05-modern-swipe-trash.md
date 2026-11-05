---
plan: modern-swipe-trash
harness: v2 · full (a destructive surface: LESSONS 9)
branch: feat/v1.403.0-modern-swipe-trash
anchor: spec
status: Shipped v1.403.0
next: Dean's device checks (docs/DEVICE-CHECKS.md)
design: Rulings approved by Dean 2026-11-05 (AskUserQuestion): S1-S6 below
gate: APPROVED r4 @48859364 (adversary + qa + security-brief; full; the Adversary briefed to trash the WRONG thing)
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

Measured at de157761, the code the seats approved at r2 (`public/`, `scripts/` and `lib/` have no diff from it to the final sha):
- The UNIT suite through the pre-commit hook (Node 22): `tests 10428, pass 10427, fail 0, skipped 1`. That is not the full suite: the full suite at de157761 was RED, the pre-push hook's `tests 13287, pass 13273, fail 1, skipped 13` (the delete-caller lock below).
- The full `npm test` at 4331276a, after the lock update (Node 22): `tests 13287, pass 13274, fail 0, skipped 13`. Node 24 is PR CI's.
- `node scripts/modern-swipe-probe.js both`, load ~2.8: `ALL PASS: 195 passed, 0 failed`. An earlier run under seats' load: `FAILURES: 194 passed, 1 failed`, the frame-time line at p95 49.9 ms (qa r2; a re-run under load 33.4 ms; quiet 16.8 ms: load, inferred from that spread).
- Widths (Chromium; WebKit desktop has a 12 px classic scrollbar, iOS overlays it):

| Viewport | Input | Card | Actions | Full swipe |
|---|---|---|---|---|
| 390x844 | real touch | 358 | 176 (49.2%) | 215 (60.0%) |
| 820x1180 | real touch | 167 | 88 (52.6%, two by two) | 112 (66.9%) |
| 1440x900 | real mouse | 374 | 176 (47.1%) | 224 (60.0%) |
| WebKit 390x844 | synthetic touch | 346 | 176 (50.9%) | 208 (60.0%) |
| WebKit 820x1180 | synthetic touch | 163 | 88 (53.9%) | 112 (68.6%) |
| WebKit 1440x900 | real mouse | 370 | 176 (47.6%) | 222 (60.0%) |

  Sweep highs: 481 px 82.2% (a 136 px card, 112 px of drag), 320 px 69.4% (72.5% WebKit), 1500 px 68.8%, 1200 px 68.0%. The stop rule is for 390.
- A full swipe trashes exactly that card (server record: one id lost of 91); Undo restores it to the same index; a real scroll with ~20 px of drift loses nothing (scrollY moved, no card mid-drag; on WebKit's synthetic rows the sample runs after the release, so only real touch and mouse bind it, and the unit tests bind the guard); select mode disables it and leaving restores it; an open card dragged right closes with no Back (the control beside it does go Back, at a stamped depth 1, since bare Home is depth 0).
- At rest: byte-identical screenshots with and without the wrapper, every card rect equal, at 390, 820 and 1440 in Chromium and WebKit. Drag frames: p95 16.8 ms, median 16.7 ms (4x CPU throttle, 40 moves, Chromium).
- Mutants: builder's: interaction.js 19 + 2 + 5, main.js wiring 42 + 9, all killed but one (`stale item at select`: equivalent, the same object); adversary's own 85 (78 killed; 7 survivors each ruled: masked by a sibling guard or equivalent, `phone buttons wide again` bound by the probe, `no live item read` has no reachable false branch).
- lint 0 errors (6 older warnings); lint:ui OK, debt unchanged; overlay-containment clean.
- Not measured: an iPhone. WebKit touch is synthetic. The device checks are the arbiter.
- Disclosed, in ROADMAP Planned: the grid one card off after a race (file safe), the ~100 ms overlap on close, the kebab and bulk offset skip, no commit cue, the instruments' limits, podcast routes and read-only media (security-brief L1). An OK podcast DELETE whose body fails to read would say "already gone" and offer no Undo (reasoned, not built; restorable from the show).

Gate r1 @1ee00d37: security-brief approved; qa and adversary CHANGES.
Gate r2 @de157761: adversary, qa and security-brief all approved. Then the push's pre-push hook went red: `card-action-menu-fullchain.test.js` "source guard: every caller of the delete request" (`4 !== 3`), a lock the swipe's new caller rightly trips. The builder had gated without running the integration suite (LESSONS 2, the hook hides it); this round's lock update binds the swipe's caller.
Gate r3 @4331276a: the lock is sound (adversary: 12 of 15 lock mutants killed; the survivors are the limits of counting call text, one of them killed by modern-swipe-view.test.js). Security-brief approved; qa and adversary CHANGES for two false Evidence statements, corrected above ("full suite" was the unit hook; "bookkeeping only" listed 7 files of 8).
After approval at de157761 the diff is bookkeeping plus ONE non-bookkeeping file, `test/integration/card-action-menu-fullchain.test.js` (the delete-caller lock, reviewed in r3). `git diff --name-only de157761..4331276a`:

    ROADMAP.md
    docs/DEVICE-CHECKS.md
    docs/LESSONS.md
    docs/exec-plans/completed/2026-11-05-modern-swipe-trash.md
    docs/releases.json
    package-lock.json
    package.json
    test/integration/card-action-menu-fullchain.test.js

`git diff de157761..HEAD -- package.json package-lock.json` changes only version lines:

    -  "version": "1.402.1",
    +  "version": "1.403.0",
    -      "version": "1.402.1",
    +      "version": "1.403.0",
    -  "version": "1.402.1",
    +  "version": "1.403.0",


Gate r4 (docs only, the corrected Evidence) closes it. After approval at 48859364 the only change is this plan's verdict lines and `gate:` field; `git diff --name-only 48859364..HEAD` prints this one file.

Gate: APPROVED r4 @48859364 — security-brief
Gate: APPROVED r4 @48859364 — qa
Gate: APPROVED r4 @48859364 — adversary
