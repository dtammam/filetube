# Playback queue - "think YouTube" (exec plan)

STATUS: DESIGNED at intake with Dean (2026-08-01), executes as v1.63.0
after the ratchet (v1.62.0). Dean's rulings, verbatim scope:

1. Queueable = anything the watch page plays (videos + audio/music);
   books excluded.
2. The queue OWNS up-next: autoplay-on advances into the queue head
   instead of related/context next; LOOP-ON SUSPENDS advancement (the
   current item loops until loop off or manual skip - skip goes to the
   queue head); queue empty -> exactly today's behavior. Next/Prev
   buttons AND MediaSession (lock screen) follow the queue, including
   docked and background-audio states.
3. Affordances: "Add to queue" + "Play next" on every card action bar
   and on the watch page; add shows a toast with position ("Queued -
   4th") and Undo.
4. The panel: a top-bar icon that EXISTS ONLY while a queue does (next
   to the bell, count badge), opening a notif-panel-style surface
   (desktop popover / mobile bottom sheet): now-playing highlighted,
   drag-handle reorder + up/down button fallback, per-item remove,
   "Clear queue" with a confirm toast (ephemeral - no modal ceremony).
5. Watch page: when playing FROM the queue, an "Up next in queue - 3/8"
   box renders where the uploader/subscribe block sits (YouTube
   playlist-box style), pushing that block down.
6. Server-side per-user persistence (follows the user across devices);
   POINTER model - played items stay, dimmed, jump-back allowed; Clear
   wipes all. NOT a playlist/folder - one queue per user, ephemeral by
   spirit, durable by storage.

## Data + API

- db namespace `user_queue` (SQLite; id-keyed carrier - per the v1.42
  lesson it joins backup/restore AND the delete paths IN THE SAME
  COMMIT): per user `{ items: [{uid, mediaId}], pointerUid|null,
  updatedAt }`. `uid` = per-entry id so the same video can be queued
  twice and reorder/remove are unambiguous.
- Deleted media: purge entries on hard-delete (every delete path) AND
  filter dead ids on read/advance (belt + suspenders; the tombstone
  class).
- Routes (session-auth'd, per-user): GET /api/queue; POST
  /api/queue/items {mediaId, position: 'end'|'next'}; DELETE
  /api/queue/items/:uid; POST /api/queue/reorder {orderedUids} (strict
  uid bijection, 409 on stale); POST /api/queue/pointer {uid|null};
  DELETE /api/queue (clear). (Gate W3 correction: the plan first said
  PATCH for reorder/pointer; POST shipped - the house verb for
  pin-reorder - and this paragraph is the contract, so it follows the
  code, recorded rather than silently drifted.)

## Client architecture (the lesson-loaded part)

- Queue store in common.js (single fetch + optimistic ops, confirmed
  answers REMOVE / optimistic only HIDES - the v1.54 rule).
- Header icon: injected by common.js OUTSIDE #view-root (the SPA-swap
  class, tech-debt #34 - markup inside view-root dies on nav); appears/
  disappears with queue existence; count badge like the bell's.
- The panel is a NEW POPUP: it must join dock()'s INLINE dismissal pair
  and the popup clamp classes (v1.50.3: a new popup sharing a CSS class
  does NOT inherit its sibling's JS clamp; dock() inlines dismissal -
  new popups must join the pair). Only one header popover open at a
  time (opening queue closes notif and vice versa). z: the --z-panel
  band, backdrop calc(var(--z-panel) - 1) per the ladder idiom; if both
  panels can genuinely co-open, that is a NEW pair for the co-open
  matrix - design says they cannot (shared open-state manager).
- Card affordance: enumerate EVERY card builder (home grid, channel,
  search, music library rows/albums, related list, subscriptions rows -
  the every-writer class); one shared helper, called by all, not
  copied.
- Watch integration: the 'ended' path consults the queue BEFORE the
  autoplay/related logic; loop check FIRST (loop-on = no advancement).
  MediaSession nexttrack/previoustrack handlers re-bound after host
  reparent (the v1.24.4 lesson) and queue-aware. Dead-view guards:
  abort-signal staleness checks on async handlers (v1.41.11 lesson);
  the up-next box lives inside #view-root and re-renders per nav.
- All styling on tokens (the ratchet ENFORCES this now - first feature
  wave under enforcement); new z rungs only from the ladder; new popup
  scrims use --scrim.

## Tests (per-commit, the usual discipline)

- Server: route CRUD + pointer ops + reorder bijection + clear;
  backup/restore round-trip INCLUDING user_queue (partial-restore
  preserves what it does not repopulate - the v1.51 lesson); delete
  purges queue entries (real-app bridge test per deps-injected writer).
- Client: store logic via the repo's vm-based behavioral pattern
  (watch-init-behavioral style - execute the REAL init); binding tests
  for the ended->queue-head decision function (ONE shared decision
  function for preview + executor, v1.41.7 lesson).
- Gate: FULL two-reviewer (data-adjacent: per-user state + delete
  paths -> adversarial briefed on the restore/delete surfaces).

## Batches

q1 server (namespace + routes + delete/backup carriers + tests);
q2 store + header icon + panel (add/remove/reorder/clear);
q3 card + watch affordances (every-writer sweep);
q4 playback integration (ended/Next/Prev/MediaSession/loop precedence
+ up-next box);
q5 polish pass (eras, mobile sheet, toasts) + Stop packet for Dean's
device pass (headline probes: queue panel on phone, drag reorder
touch, background-audio advancement, loop precedence).

## EXECUTION RECORD (2026-08-01, branch feature/playback-queue)

q1a schema v6 + store + reducers (11 tests) -> q1b routes + backup
carrier + integration suite (10 tests) -> q2 header icon + panel chrome
(6 pure tests; write-only state + a last-block CSS lock caught by the
hook) -> q3 one add verb, every writer (cards 4th corner, watch's two
verbs, music rows; era-row button census lock DELIBERATELY 2->4 static,
7 total) -> q4 playback integration (resolveEndedAction extends the
AC49 table; queue-first Next/Prev feeds setTrackNav; the up-next box;
trackNav lock converted). All under the live ratchet - token-clean
first contact every batch.

DISCLOSED boundaries (expanded at the gate): the music page's internal
track-nav advance keeps precedence over the global queue; MUSIC-LIBRARY
TRACKS ARE NOT QUEUEABLE THIS WAVE (gate CRITICAL-2: they live in the
disjoint db.music namespace the watch page cannot play - the music-row
affordance shipped dead and was PULLED; a future music-queue sub-wave
is Dean's call); CARDS CARRY "ADD TO QUEUE" ONLY - "Play next" lives on
the watch page (ruling 3 said both on cards; the fourth corner is the
last free one, so this is a deviation for Dean's explicit sign-off at
the Stop); the add-toast Undo IS implemented (ruling 3, closed at the
gate); related-list cards carry no add button (kebab-less; the watch
verbs cover it); desktop drag-reorder is a later nicety (up/down
buttons everywhere); no standing queue poller (refresh on own actions +
tab return); DELETING/PRUNING the now-playing entry's file leaves a
dangling pointer -> not-started semantics -> the next advance replays
from the queue HEAD (the API remove path steps back instead - the
asymmetry is tech-debt #72, ship-disclosed per both seats).

GATE ROUND 1 RECORD CORRECTION (the honest-record norm): q4/q5 were
committed with test/integration/watch-fulllist-fetch.test.js RED (the
pre-commit hook runs the unit tier only) - the adversarial seat found
the full suite 5358/1 at the branch tip, root-caused to the queue fetch
GATING button enablement (a hung /api/queue = dead Prev/Next forever).
Fixed by arming context handlers immediately and upgrading to the
queue-aware closures on resolve. The execution record's original
"green at every batch" claim was true only of the unit tier.

## Dean's on-device probe list (the Stop)

0. SIGN-OFF: cards carry "Add to queue" only ("Play next" = watch
   page) - ruling 3 deviation, approve or flip.
1. HEADLINE: the watch action row now holds SEVEN buttons - phone
   widths, every era (the containment wrap + .btn-label collapse are
   the guards; the census lock update is deliberate).
2. Queue panel on the phone: bottom-sheet open/close, up/down reorder
   taps, per-row remove, the two-tap Clear.
3. The flow: queue 3 items from cards -> autoplay ON -> let one end ->
   it should advance INTO the queue (up-next box showing "Playing from
   queue - n/N"); turn LOOP on mid-queue -> the item must repeat, queue
   untouched; loop off -> advancement resumes.
4. Lock screen / media keys: Next while docked + backgrounded must
   follow the queue.
5. Autoplay OFF: ending an item must NOT consume the queue.
6. Music page: album/list playback advances as before (the global
   queue must NOT hijack it). NOTE: the music-row queue button was
   PULLED at the gate (music-library tracks are not watch-playable -
   see disclosed boundaries); AUDIO FILES IN THE MEDIA LIBRARY queue
   normally via their cards. Sign-off wanted: is a music-queue
   sub-wave worth scheduling?
7. Multi-device: queue on the desktop, open the phone - the icon and
   contents should be there (server-persisted per user).
