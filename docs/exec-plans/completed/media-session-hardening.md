# Media Session Hardening (v1.2.1)

> **Shipped v1.2.1** (2026-07-04). This exec plan is complete and archived here
> under `docs/exec-plans/completed/`. The copy that remains at
> `docs/exec-plans/active/media-session-hardening.md` is a stale tombstone and
> should be removed with `git rm` by the main loop (this toolset cannot perform
> a true `mv`, so the content was copied here and the active copy is left for
> cleanup).

## Goal

Harden the Media Session control surface added in v1.2.0 so the lock-screen /
Control Center "Now Playing" widget stays accurate — instead of going blank
within 1-2s of backgrounding — and fix iOS rotate-to-fullscreen so rotating
back to portrait actually exits native fullscreen.

## Context (real-device feedback on v1.2.0)

`setupMediaSession(channelName)` in `public/js/watch.js` (~L188-210) currently
sets `navigator.mediaSession.metadata` (title/artist/artwork) and four action
handlers (`play`/`pause`/`seekbackward`/`seekforward`), feature-detected. It
never sets `navigator.mediaSession.playbackState` or calls
`navigator.mediaSession.setPositionState(...)`. Two device-observed bugs trace
to this and to the fullscreen-exit path:

1. **Now Playing goes blank after backgrounding.** With no `playbackState` /
   `positionState` ever set, iOS has nothing durable to keep rendering once the
   page backgrounds — the widget shows the initial metadata briefly, then
   blanks, and the on-screen play control stops actually controlling playback.
2. **Rotate-back-to-portrait doesn't exit iOS native fullscreen.**
   `setupRotateFullscreen()` (~L426-460) exits via `document.exitFullscreen()`
   only. On iOS, video entered native fullscreen via
   `mediaPlayer.webkitEnterFullscreen()` is controlled by
   `mediaPlayer.webkitExitFullscreen()`, not the standard Fullscreen API — so
   the portrait-rotation exit call is a no-op there while landscape-entry
   (`webkitEnterFullscreen`) already correctly uses the WebKit-prefixed API.

## HARD CONSTRAINT — explicit non-goal

**True background *playback* / resume-after-suspension is an iOS OS
limitation for web `<video>` that this branch CANNOT fix.** Once iOS Safari
freezes a backgrounded tab/PWA, no web API (Media Session, Page Visibility,
Background Sync, etc.) resumes execution or continues audio/video decode for
a plain `<video>` element. The only OS-sanctioned path for real background
playback is native Picture-in-Picture (a distinct, out-of-scope surface).

This branch improves **Now Playing widget accuracy** (it reflects real state
when the page *is* running, and re-syncs the instant the page comes back to
the foreground) — it does **not**, and cannot, make audio/video keep playing
while the app is fully backgrounded/suspended. No task in this plan should be
read as promising that outcome, and QA must not fail this branch for not
delivering it.

## Scope

1. **`playbackState`**: set `navigator.mediaSession.playbackState` to
   `'playing'` / `'paused'` on the existing `play`/`pause` video events, and to
   `'none'` on `ended`. Feature-detected (no-op where `mediaSession` absent).
2. **`positionState`**: call
   `navigator.mediaSession.setPositionState({ duration, position, playbackRate })`:
   - on `loadedmetadata` (initial sync),
   - on `seeked` and `ratechange` (immediate resync after user/API-driven
     changes),
   - periodically during playback via `timeupdate`, **throttled** (e.g. at
     most once per ~5s) — never on every `timeupdate` tick.
   - Guarded: only call when `duration` is a finite, positive number, and
     `position` is a finite number with `0 <= position <= duration`.
     `setPositionState` **throws** on `NaN`/`Infinity` duration, on a position
     greater than duration, or on a negative position — every call site must
     validate first and additionally be wrapped in `try/catch`.
3. **`visibilitychange` re-assert**: on `document.visibilitychange` firing
   with `document.visibilityState === 'visible'`, re-assert metadata,
   `playbackState`, and (if a valid duration is known) `positionState` — so a
   stale or blanked widget repopulates as soon as the page is foregrounded,
   rather than waiting for the next natural play/pause/seek event.
4. **iOS fullscreen exit fix**: in `setupRotateFullscreen()`'s portrait
   (exit) branch, prefer `mediaPlayer.webkitExitFullscreen()` when present,
   falling back to `document.exitFullscreen()` otherwise. Feature-detected;
   the existing "only exit fullscreen WE auto-entered" guard (`autoFullscreen`
   flag) is unchanged and still applies.
5. **Documentation**: a code comment at `setupMediaSession` (or immediately
   above it) stating plainly that background *playback* is an OS-level
   limitation and cannot be fixed here; PiP is the real background-playback
   path. This exec plan itself serves as the durable record of that decision.

## Out of scope

- Any attempt at background/suspended playback continuation (see HARD
  CONSTRAINT above) — including Background Sync, Wake Lock tricks, or hidden
  audio-context keep-alive hacks.
- Picture-in-Picture support (a legitimate follow-up, not this branch).
- Adding new Media Session action handlers beyond the existing four
  (play/pause/seekbackward/seekforward) — e.g. no `previoustrack`/`nexttrack`,
  no `seekto`, no `stop` handler in this pass.
- Any change to the transcode pipeline, ratings, or non-media-session/
  non-fullscreen watch-page behavior.
- Any UI/visual changes to the watch page.

## Constraints

- Every new call must be feature-detected: no throw when
  `navigator.mediaSession`, `setPositionState`, or `webkitExitFullscreen` is
  absent (older browsers, desktop Chrome/Firefox without full Media Session
  support, etc.).
- Must not regress existing v1.2.0 behavior: metadata still renders, the four
  action handlers still work, rotate-to-landscape entry is untouched, and the
  "only auto-exit fullscreen WE entered" guard is preserved.
- No new listeners may be double-registered if `setupMediaSession` /
  `setupRotateFullscreen` could ever run more than once per page life (verify
  current call sites — today each is called once from `setupPlayer()` /
  page init).
- `setPositionState` calls must be defensively validated (see Scope item 2) —
  this is the top correctness/regression risk in this branch (see Risks).
- Follows `docs/CONTRIBUTING.md`: vanilla JS, no new deps, comment the *why*
  (especially the iOS quirks and the OS background-playback limitation),
  `node:test` coverage for every extractable pure piece.

## Acceptance criteria

- [x] `navigator.mediaSession.playbackState` is set to `'playing'` on the
      video `play` event and `'paused'` on the video `pause` event; set to
      `'none'` on `ended`. No-op (no throw) when `mediaSession` is unsupported.
- [x] `navigator.mediaSession.setPositionState(...)` is called on
      `loadedmetadata`, on `seeked`, and on `ratechange`, each time with the
      current `duration`/`currentTime`/`playbackRate`.
- [x] During playback, `setPositionState` is also called periodically via a
      throttled `timeupdate` handler (at most once per ~5s), not on every
      `timeupdate` tick.
- [x] `setPositionState` is never called with a non-finite or non-positive
      `duration`, nor with a `position` outside `[0, duration]` — invalid
      inputs are skipped rather than passed through, and every call is
      wrapped so an unexpected throw cannot propagate/break other listeners.
- [x] On `document.visibilitychange` transitioning to visible, metadata,
      `playbackState`, and (when duration is known-valid) `positionState` are
      all re-asserted, so a previously-blanked Now Playing widget repopulates
      without requiring a play/pause/seek action first.
- [x] `setupRotateFullscreen()`'s portrait-exit path calls
      `mediaPlayer.webkitExitFullscreen()` when that method exists on the
      element, and falls back to `document.exitFullscreen()` otherwise; the
      existing "only auto-exit fullscreen WE entered" (`autoFullscreen`) logic
      is unchanged.
- [x] No regression: v1.2.0 metadata (title/artist/artwork) and the four
      action handlers (play/pause/seekbackward/seekforward) still function
      exactly as before; rotate-to-landscape entry behavior unchanged.
- [x] All new mediaSession/positionState/webkitExitFullscreen usage is
      feature-detected and demonstrably a silent no-op (no console errors,
      no thrown exceptions) in a browser/environment lacking that API.
- [x] A code comment near `setupMediaSession` documents that background
      playback is an iOS OS limitation outside this branch's reach, and that
      PiP is the real background-playback path.
- [x] The pure position-state validation logic (see Testability) has
      `node:test` unit coverage exercising valid input, NaN/Infinity duration,
      position > duration, and negative position.

## Testability

Most of this feature is Media Session / iOS-fullscreen device behavior that
**cannot be exercised in CI** — there is no headless `navigator.mediaSession`
or `webkitExitFullscreen` to assert against, so this is necessarily a manual,
on-device verification pass (see checklist below). One piece is cleanly
extractable as pure logic and should get `node:test` coverage:

- **Recommended extraction:** a small pure helper, e.g.
  `clampPositionState(duration, position, playbackRate)`, that returns a
  valid `{ duration, position, playbackRate }` object when inputs are sane,
  or `null` when they're not (NaN/Infinity duration, non-finite position,
  position outside `[0, duration]`, non-positive duration). All call sites
  (`loadedmetadata`/`seeked`/`ratechange`/throttled `timeupdate`) route
  through this helper before calling `setPositionState`, and only call it
  when the helper returns non-null. This gives the top-risk validation logic
  full unit coverage without touching the DOM or `mediaSession`.

**Manual on-device checklist (iOS Safari / iOS PWA, CI cannot cover this):**
- [ ] Lock-screen Now Playing shows correct title/artwork on playback start.
- [ ] Background the app for 5-10s, return: widget still shows correct
      metadata (not blank), and lock-screen play/pause control still works.
- [ ] Scrub the lock-screen progress bar (if the OS exposes one) and confirm
      it reflects actual position, not stuck at 0 or wrong value.
- [ ] Rotate to landscape: enters native fullscreen (unchanged from v1.2.0).
- [ ] Rotate back to portrait: native fullscreen exits (the fix under test).
- [ ] Manually enter fullscreen (tap fullscreen button) then rotate to
      portrait: fullscreen is NOT force-exited (existing `autoFullscreen`
      guard preserved).
- [ ] Desktop Chrome/Firefox (no full Media Session/positionState support, or
      no `webkitExitFullscreen`): no console errors, playback/rotate behavior
      unaffected.

## Risks

- **`setPositionState` throw conditions** — the single biggest correctness
  risk. It throws synchronously on: non-finite (`NaN`/`Infinity`) duration,
  duration `<= 0`, non-finite position, or `position > duration`. This is a
  real, hittable case in this codebase: live-transcoded/streaming playback
  (`liveMode`, desktop AVI live pipe) and any file whose `duration` metadata
  is `0` or unknown can produce exactly these invalid values. Every call site
  must validate (ideally via the `clampPositionState` helper) and additionally
  be wrapped in `try/catch` as defense in depth.
- **`timeupdate` throttling** — `timeupdate` fires very frequently; calling
  `setPositionState` on every tick is wasted work and risks fighting other
  main-thread work on lower-end devices. Must throttle (time-based, ~5s) not
  fire on every event.
- **Double-registration** — confirm `setupMediaSession()` and
  `setupRotateFullscreen()` are each still called exactly once per page life
  before adding more listeners inside them; new listeners must not stack if
  either function were ever invoked twice.
- **`visibilitychange` ordering** — if `visibilitychange` can fire before
  `setupMediaSession` has run (e.g. very early in page life) or before any
  metadata has ever been set, the re-assert handler must tolerate that
  (no-op / feature-detect) rather than throwing on missing state.

## QA note

This branch requires a **significant, two-reviewer** QA / code-review pass
before acceptance (quality-assurance stage + `/code-review`), given how much
of it is iOS-device-only and how easy it is to silently regress v1.2.0. Top
review targets, in priority order:

1. **Feature-detection safety** — every new `mediaSession`/`setPositionState`/
   `webkitExitFullscreen` call site is provably a no-op (no throw, no console
   error) where the API is absent.
2. **`setPositionState` throw-guards** — duration/position validation
   (`clampPositionState` or equivalent) is applied at every call site,
   including the live-transcode/streaming path where duration may be `0`,
   unknown, or otherwise degenerate.
3. **No regression to v1.2.0** — existing metadata, the four action handlers,
   and rotate-to-landscape entry all still behave exactly as before.

## Technical Design

### Approach

All work lands in two existing files, no new files, no new deps (per
`docs/CONTRIBUTING.md`: vanilla JS, CommonJS test shim). The one piece of
extractable pure logic — the `setPositionState` input validator — goes into
`public/js/common.js` as `clampPositionState(duration, position, playbackRate)`
and is added to the `module.exports` shim so `node:test` can exercise it
without a DOM or `navigator.mediaSession`. Everything else is DOM/Media Session
plumbing in `public/js/watch.js` and is manual-verification-only (no headless
`mediaSession` in CI, per the Testability section).

In `watch.js` the change is additive around three existing seams: (a)
`setupMediaSession(channelName)` gains sibling helpers for playback/position
state but keeps its current metadata + 4-handler body untouched; (b) the
existing `mediaPlayer` `play`/`pause`/`ended` listeners in `setupPlayer()` are
*extended in place* (not re-registered) to also push `playbackState`, and a
small set of new position-triggering listeners (`loadedmetadata`, `seeked`,
`ratechange`, throttled `timeupdate`) are added once inside `setupPlayer()`;
(c) `setupRotateFullscreen()`'s portrait-exit branch prefers
`mediaPlayer.webkitExitFullscreen()`. A module-scoped `currentChannelName`
holds the resolved channel name so the `visibilitychange` re-assert can rebuild
metadata. Every Media Session / `setPositionState` / `webkit*` access is
feature-detected and try/catch-wrapped so it is a provable silent no-op where
the API is absent (desktop Chrome/Firefox, older browsers).

Contract between the two files: `watch.js` never calls `setPositionState`
directly with raw element values — it always routes `mediaPlayer.duration`,
`mediaPlayer.currentTime`, `mediaPlayer.playbackRate` through
`clampPositionState(...)` and only calls `setPositionState` when the helper
returns non-null. This is what neutralizes the top risk (the `setPositionState`
throw on the live-transcode / AVI `duration = 0` or `Infinity` case).

### Component changes

- **`public/js/common.js` — new `clampPositionState(duration, position,
  playbackRate)`**: pure, side-effect-free, added next to `getStarRating` /
  `getCommentCount` and exported in the `module.exports` block. Returns a
  sanitized `{ duration, position, playbackRate }` or `null`. Sole owner of the
  validation rules; the only node:test target in this branch.

- **`public/js/watch.js` — `setupMediaSession(channelName)`**: body unchanged
  (metadata + 4 handlers still set exactly as in v1.2.0). Add a code comment
  block immediately above it stating that true background *playback* is an iOS
  OS limitation for web `<video>` that this branch cannot defeat, and that
  native PiP is the real background-playback path (Scope item 5).

- **`public/js/watch.js` — new `setPlaybackState(state)` helper**: guarded
  setter; `if ('mediaSession' in navigator) { try { navigator.mediaSession.
  playbackState = state; } catch (_) {} }`. Called with `'playing'` / `'paused'`
  / `'none'`.

- **`public/js/watch.js` — new `updatePositionState()` helper**: reads the live
  element values, calls `clampPositionState`, and on non-null calls
  `navigator.mediaSession.setPositionState(...)`, feature-detected on
  `'setPositionState' in navigator.mediaSession` and wrapped in try/catch
  (defense in depth). No-op on null (the invalid-duration skip).

- **`public/js/watch.js` — `setupPlayer()` listener wiring**: the existing
  `play` → `startProgressSaver`, `pause` → `stopProgressSaver`, and `ended`
  listeners are extended to also set playbackState; new position-trigger
  listeners (`loadedmetadata`, `seeked`, `ratechange`, throttled `timeupdate`)
  are added here. All additive; no existing listener is removed or duplicated.

- **`public/js/watch.js` — module-scoped `currentChannelName`**: set inside
  `setupMediaSession` (and/or `populateMetadata`) so the `visibilitychange`
  handler can re-run `setupMediaSession(currentChannelName)`.

- **`public/js/watch.js` — new `visibilitychange` listener** (registered once,
  at page-init level alongside the other top-level `document` listeners): on
  `document.visibilityState === 'visible'`, re-assert metadata + playbackState +
  positionState.

- **`public/js/watch.js` — `setupRotateFullscreen()` portrait-exit branch**:
  prefer `mediaPlayer.webkitExitFullscreen()`, fall back to
  `document.exitFullscreen()`. `autoFullscreen` guard unchanged.

### Data model changes

None. No server, schema, DB, or `/api` changes — this is a client-only
watch-page hardening patch.

### API changes

None (no HTTP/route changes). One new *internal* JS export:
`clampPositionState` added to `public/js/common.js`'s `module.exports`
(alongside `getStarRating`, `getCommentCount`, `resolveChannelName`). No
public/browser-global API changes; the browser ignores the `module.exports`
block as today.

### `clampPositionState` contract (the node:test target)

```js
// Pure. Validates inputs for navigator.mediaSession.setPositionState, which
// throws on non-finite/non-positive duration, non-finite position, or
// position > duration. Returns a safe object or null (caller skips the call).
function clampPositionState(duration, position, playbackRate) { ... }
```

Rules:

- **duration**: must be a finite number `> 0`. If not (`NaN`, `Infinity`,
  `<= 0`, non-number) → return `null` (caller skips `setPositionState`
  entirely — this is the live-transcode / AVI `duration = 0` guard).
- **position**: coerced to a finite number in `[0, duration]`. Non-finite
  (`NaN`/`Infinity`) → default `0`; negative → clamp to `0`; greater than
  `duration` → clamp to `duration`.
- **playbackRate**: must be finite and `> 0`; otherwise default `1`
  (covers `0`, negative, `NaN`, `Infinity`, non-number).
- **Return**: `{ duration, position, playbackRate }` with the sanitized
  values, or `null` when `duration` is invalid.

Rationale for null-on-bad-duration (vs. clamping): the spec throws on a bad
duration and there is no safe substitute value to invent, so the only correct
action is to skip the call — which is exactly what a `null` sentinel forces at
every call site.

### positionState update triggers & throttle

`updatePositionState()` is invoked from:

- `loadedmetadata` — initial sync once duration is known.
- `seeked` — resync after user/API scrub.
- `ratechange` — resync playbackRate (also fires for the press-and-hold 2×
  gesture; harmless and correct).
- `timeupdate` — **throttled**, not every tick.

Throttle mechanism: a module-scoped `let lastPositionSync = 0;` timestamp. The
`timeupdate` handler does `const now = Date.now(); if (now - lastPositionSync <
POSITION_SYNC_MS) return; lastPositionSync = now; updatePositionState();` with
`const POSITION_SYNC_MS = 5000;` (a `SCREAMING_SNAKE_CASE` module constant per
style). Time-based (not counter-based) so it is stable regardless of the
device's `timeupdate` cadence. The `loadedmetadata`/`seeked`/`ratechange` calls
also set `lastPositionSync = Date.now()` (route them through a tiny wrapper, or
have `updatePositionState()` stamp it) so an immediate event resync resets the
throttle window and avoids a redundant tick call right after.

### playbackState wiring (no double side-effects)

Extend the *existing* listeners rather than adding parallel ones:

- `play` listener: currently `startProgressSaver`. Change registration to an
  arrow that calls `startProgressSaver()` **and** `setPlaybackState('playing')`.
- `pause` listener: currently `stopProgressSaver`. Wrap to also
  `setPlaybackState('paused')`.
- `ended` listener: already an arrow (`saveProgressToServer(0)` +
  `stopProgressSaver()`); add `setPlaybackState('none')`.

This keeps `startProgressSaver` / `stopProgressSaver` as the single source of
the progress-interval side effect (no double start/stop) while layering the
mediaSession state on the same events.

### visibilitychange re-assert

Register one `document.addEventListener('visibilitychange', ...)` at page-init
scope (next to the existing top-level `keydown` / search listeners), guarded:

```text
if (document.visibilityState !== 'visible') return;
if (!mediaData) return;                       // metadata not populated yet
setupMediaSession(currentChannelName);        // rebuild metadata + handlers
setPlaybackState(mediaPlayer.paused ? 'paused' : 'playing');
updatePositionState();                          // no-op if duration invalid
```

Ordering safety (Risk: visibilitychange before setup): the `!mediaData` guard
covers the "fires before `init()` populated metadata" case; `setupMediaSession`
and `updatePositionState` are each independently feature-detected and
try/catch-wrapped, so a too-early or unsupported call is a silent no-op.
`currentChannelName` defaults to `''` until `setupMediaSession` first runs;
re-running with `''` still yields valid metadata (artist becomes empty), so
there is no throw path. Registering at init scope (once) avoids any
double-registration concern.

### iOS fullscreen exit

In `setupRotateFullscreen()`'s portrait branch, replace the
`document.exitFullscreen()`-only exit with:

```text
if (mediaPlayer.webkitExitFullscreen) {
  mediaPlayer.webkitExitFullscreen();
} else if (document.exitFullscreen) {
  const p = document.exitFullscreen();
  if (p && p.catch) p.catch(() => {});
}
```

The `if (!landscape && autoFullscreen && inNativeFullscreen())` guard and the
`autoFullscreen = false` reset are unchanged — we still only auto-exit a
fullscreen WE entered. This mirrors the entry branch, which already prefers
`webkitEnterFullscreen`. Feature-detected: no `webkitExitFullscreen` →
standard-API fallback → nothing if neither exists.

### Feature detection / no-throw guarantees

- `setPlaybackState`: guarded by `'mediaSession' in navigator` + try/catch.
- `updatePositionState`: guarded by `'mediaSession' in navigator` AND
  `'setPositionState' in navigator.mediaSession` + try/catch; skips entirely
  when `clampPositionState` returns null.
- `setupMediaSession`: existing `'mediaSession' in navigator` +
  `typeof MediaMetadata` guards unchanged.
- `webkitExitFullscreen`: presence-checked before call.
- No v1.2.0 regression: metadata, the 4 action handlers, and rotate-to-
  landscape entry are byte-for-byte unchanged; only additive lines and the
  portrait-exit branch change.

### Alternatives considered

- **Inline validation at each call site (no shared helper).** Pro: no
  cross-file coupling. Con: duplicates the throw-guard at 4+ call sites (the
  exact logic the Risks section flags as top correctness risk) and leaves it
  untestable in CI. Rejected — the exec plan explicitly recommends extracting
  `clampPositionState` for `node:test` coverage, and centralizing the rule is
  safer.
- **`requestAnimationFrame` / `setInterval` position pump instead of throttled
  `timeupdate`.** Con: adds a timer to tear down, keeps firing while paused/
  backgrounded, and duplicates a cadence the `timeupdate` event already
  provides. Rejected — event-driven + a timestamp throttle is simpler and
  self-quiescing when playback stops.
- **Counter-based throttle (every Nth `timeupdate`).** Con: `timeupdate`
  cadence varies by device/browser, so "every 20th tick" is not a stable time
  window. Rejected in favor of the `Date.now()` delta.

### Risks and mitigations

- **Risk**: `setPositionState` throws on live-transcode / AVI `duration = 0`
  or `Infinity`. → **Mitigation**: `clampPositionState` returns `null` for any
  non-finite/non-positive duration; call site skips; plus try/catch around the
  actual call as defense in depth.
- **Risk**: `timeupdate` flooding `setPositionState` on low-end devices. →
  **Mitigation**: 5s `Date.now()`-delta throttle; only `loadedmetadata` /
  `seeked` / `ratechange` bypass it (rare, user-driven).
- **Risk**: double-registered listeners if `setupPlayer` / `setupMediaSession`
  ran twice. → **Mitigation**: verified each is called exactly once
  (`setupPlayer` from `init()`; `setupMediaSession` from `populateMetadata`,
  also once from `init()`). New position/state listeners are added inside
  `setupPlayer` (once); `visibilitychange` is registered once at init scope.
  `setupMediaSession` only *sets* properties/handlers (idempotent), so the
  visibilitychange re-call cannot stack listeners.
- **Risk**: `visibilitychange` fires before metadata exists. → **Mitigation**:
  `!mediaData` guard + per-call feature detection + try/catch.

### Performance impact

No expected impact on any budget in `docs/RELIABILITY.md`. Client-only; the
sole periodic work is one throttled `setPositionState` call per ~5s during
active playback (strictly less frequent than the existing 4s progress-save
interval). No server, transcode, scan, or memory-cache path is touched.

### Test list (node:test — `test/unit/clamp-position-state.test.js`)

Mirrors the existing `star-rating.test.js` / `comment-count.test.js` style,
importing `clampPositionState` from `../../public/js/common.js`:

1. **valid input** — `clampPositionState(100, 42, 1)` →
   `{ duration: 100, position: 42, playbackRate: 1 }`.
2. **duration = 0** → `null`.
3. **duration = NaN** → `null`.
4. **duration = Infinity** → `null`.
5. **duration negative** (`-5`) → `null`.
6. **position > duration** (`100, 150, 1`) → position clamped to `100`.
7. **position NaN** (`100, NaN, 1`) → position defaults to `0`.
8. **position negative** (`100, -3, 1`) → position clamped to `0`.
9. **playbackRate negative** (`100, 10, -2`) → rate defaults to `1`.
10. **playbackRate = 0** (`100, 10, 0`) → rate defaults to `1`.
11. **require-safe export** — `clampPositionState` is a function on the
    `module.exports` of `common.js` (requiring the browser file in Node does
    not throw / touch `document`).

### Ordered task breakdown

1. **`common.js`**: add pure `clampPositionState(duration, position,
   playbackRate)` per contract; add it to the `module.exports` object.
2. **Tests**: add `test/unit/clamp-position-state.test.js` covering cases
   1–11 above; confirm `npm run test:unit` and `npm run lint` pass.
3. **`watch.js` — helpers**: add module-scoped `currentChannelName`,
   `lastPositionSync`, `POSITION_SYNC_MS`; add `setPlaybackState(state)` and
   `updatePositionState()` (both feature-detected + try/catch, routing through
   `clampPositionState`).
4. **`watch.js` — setupMediaSession**: store `currentChannelName = channelName`;
   add the "background playback is an OS limitation; PiP is the real path"
   comment above the function. Body otherwise unchanged.
5. **`watch.js` — playbackState wiring**: extend the existing
   `play`/`pause`/`ended` listeners in `setupPlayer()` to also call
   `setPlaybackState('playing'|'paused'|'none')` without disturbing
   start/stopProgressSaver.
6. **`watch.js` — positionState triggers**: add `loadedmetadata`, `seeked`,
   `ratechange` listeners (immediate `updatePositionState`) and a throttled
   `timeupdate` listener (5s `Date.now()` delta) in `setupPlayer()`.
7. **`watch.js` — visibilitychange**: register one init-scope
   `visibilitychange` handler that re-asserts metadata + playbackState +
   positionState, guarded by `visibilityState === 'visible'` and `mediaData`.
8. **`watch.js` — iOS fullscreen exit**: in `setupRotateFullscreen()`'s
   portrait branch, prefer `mediaPlayer.webkitExitFullscreen()`, fall back to
   `document.exitFullscreen()`; keep the `autoFullscreen` guard.
9. **Verify**: `npm run lint` + `npm test` green; manual on-device checklist
   (from the exec plan Testability section) handed to QA. Confirm markdownlint
   passes on this exec plan.

## Task breakdown

(Filled by engineering-manager during the tasks stage; see Ordered task
breakdown above.)

## Progress log

- 2026-07-04: Discovery complete. Exec plan drafted from real v1.2.0 device
  feedback (blank Now Playing after backgrounding; rotate-back-to-portrait
  not exiting iOS fullscreen). No overlapping active exec plans found
  (`docs/exec-plans/active/` is currently empty). No contradiction with
  `docs/ARCHITECTURE.md`. Not a tech-debt-tracker item. Explicit HARD
  CONSTRAINT / non-goal called out per user direction: background playback
  itself is an iOS OS limitation, out of reach for any web `<video>` — this
  branch only hardens Now Playing widget accuracy.
- 2026-07-04: **Shipped v1.2.1.** Two-reviewer QA pass complete —
  quality-assurance returned APPROVE-WITH-NITS (throw-safety + no v1.2.0
  regression confirmed) and the `/code-review` workflow surfaced 4 non-critical
  position-sync issues, all fixed: pause now force-syncs position, a
  `durationchange` trigger was added, `visibilitychange` re-asserts state
  directly (decoupled from the `MediaMetadata` guard), live-mode position is
  skipped, the throttle stamp is set after validation, and the
  `clampPositionState` export test was added. 71 tests green. Plan archived to
  `docs/exec-plans/completed/`; the active-tree copy at
  `docs/exec-plans/active/media-session-hardening.md` is now a stale tombstone
  to be `git rm`'d by the main loop.

## Decision log

- 2026-07-04: Scoped as widget-accuracy hardening only, explicitly excluding
  any attempt at background-playback continuation. Rationale: iOS suspends
  backgrounded web `<video>` pages at the OS level; no Media Session, Page
  Visibility, or other web API can defeat that. Native Picture-in-Picture is
  the only real background-playback path and is deliberately out of scope
  for this patch.
- 2026-07-04: Recommended extracting `clampPositionState` as a pure,
  node:test-able helper so the highest-risk logic (input validation before
  calling `setPositionState`) gets real unit coverage, given that the rest of
  this feature is iOS-device-only and untestable in CI.
</content>
</invoke>
