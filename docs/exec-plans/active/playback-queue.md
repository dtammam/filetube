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
  /api/queue/items/:uid; PATCH /api/queue {order:[uids]} (reorder);
  PATCH /api/queue/pointer {uid|null}; DELETE /api/queue (clear).

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
