# Native Mobile Playback & Polish

## Goal

Make the watch page feel like a native iOS media app — lock-screen media
controls, richer description content, varied comment counts, and a
press-and-hold 2x speed gesture — **without re-implementing anything the
native `<video>` player already provides.**

### The native-vs-custom seam (non-negotiable boundary)

FileTube's watch page uses the real `<video controls playsinline
webkit-playsinline>` element (see `public/watch.html` line ~81), not a custom
player chrome. That element has two surfaces, and this feature must respect
the line between them:

- **Inline surface (ours to touch).** While the video plays embedded in the
  page, FileTube already layers custom behavior on top: the `#skip-controls`
  double-tap/click ±15s overlay and its `touchend` gesture arbitration in
  `public/js/watch.js` (`setupSkipControls()`, ~L253-292). This feature adds
  more custom behavior to this same surface: Media Session action handlers
  and the press-and-hold-to-2x gesture. All of it must coexist with the
  single-tap (native play/pause) and double-tap (custom seek) gestures that
  already exist there.
- **Native fullscreen (Apple's/Android's — off-limits).** Once the user taps
  into fullscreen (`webkitEnterFullscreen` / iOS's native fullscreen video
  view, or the Fullscreen API on Android), the OS/browser owns the chrome:
  scrubber, play/pause, the built-in playback-speed menu, and Picture-in-
  Picture. None of this feature's gestures or overlays may be re-implemented
  or injected there. Where a requirement below only makes sense inline (e.g.
  hold-to-2x), it must explicitly no-op in native fullscreen rather than try
  to reach into it.

Any implementation or review that blurs this seam — e.g. adding a custom
speed-picker, a custom fullscreen scrubber, or forcing overlay controls to
persist into native fullscreen — is out of bounds regardless of how it's
justified.

## Scope

1. **Media Session API integration** — lock screen / Control Center / Android
   notification metadata (title, artist, artwork) and hardware/lock-screen
   transport controls (play, pause, seek back/forward), feature-detected and
   silently absent where unsupported.
2. **Embedded file metadata surfaced as description** — extend the existing
   scan-time `ffprobe` call to also pull common format/stream tags (title,
   artist, comment, description, date, etc.), store them normalized on
   `db.metadata`, and render them additively on the watch page, under
   (never replacing) the existing blurred file-path block.
3. **Deterministic, varying comment counts** — replace the current fixed
   4-comment `getMockInitialComments()` selection with a per-item count in the
   ~4–14 range, derived deterministically from the media id (same pattern as
   `getStarRating`).
4. **Press-and-hold-to-2x on the inline mobile player** — touch-and-hold on
   the inline video bumps `playbackRate` to 2x with a small on-screen "2x"
   badge; releasing restores the prior rate. Must be correctly arbitrated
   against the existing single-tap (native play/pause) and double-tap
   (custom seek) gestures via a hold-time threshold. Mobile/touch only; no-op
   in native fullscreen.
5. **Rotate-to-fullscreen (best-effort, attempted with documented caveat)** —
   on orientation change to landscape while the inline player is active,
   attempt to request fullscreen; portrait must never force-exit fullscreen
   unless the user explicitly entered it via a tap (e.g. the native
   fullscreen button or the existing `f` keyboard shortcut on desktop).

## Out of scope

- **Custom Picture-in-Picture button/control.** The native `<video>` element
  already exposes PiP (iOS's native PiP button appears automatically inside
  its fullscreen/inline chrome; Android Chrome exposes it too). Building a
  custom PiP trigger would duplicate what the browser already gives us for
  free and risks conflicting with it. **Do not re-add this** — if it resurfaces
  in a future spec, point back to this line.
- Any custom control that operates *inside* native fullscreen (speed menu,
  scrubber, custom play/pause overlay) — native fullscreen is Apple's/the
  browser's surface, not ours (see seam above).
- Background audio continuing when the app is switched away/backgrounded —
  this is OS-media-session-gated behavior with platform-specific nuance
  beyond simple Media Session metadata; tracked on the roadmap below, not
  built here.
- Mini-player (persistent small player while browsing elsewhere in the app).
- `.srt` / subtitle sidecar support.
- Any change to the desktop live-transcode path, the lazy mobile transcode
  overlay/poll flow, or the transcode-cache eviction logic (all shipped in
  `avi-ux-refinement` / v1.1.0) — this feature only touches playback polish
  on top of the existing pipeline.

### Roadmap (explicitly deferred, not designed here)

- Background-audio-on-app-switch (OS-media-session gated).
- Mini-player.
- `.srt` subtitle sidecar support.

## Constraints

- No new frontend build tooling — vanilla JS/DOM only, consistent with
  `public/js/*.js` today (per `docs/CONTRIBUTING.md`).
- No new backend dependencies; the metadata-tag extraction extends the
  existing `ffprobe` invocation in `extractMetadataAndThumbnail()`
  (`server.js` ~L339-378) rather than adding a new probing step or library.
- `ffprobe`/`ffmpeg` presence must continue to degrade gracefully
  (`ffmpegAvailable` check already in `extractMetadataAndThumbnail`) — a
  missing binary must never crash a scan (per `docs/RELIABILITY.md`).
- Feature-detect all new browser APIs (`'mediaSession' in navigator`,
  Fullscreen API, orientation events); every new code path must no-op rather
  than throw where the API is unavailable.
- Must not interfere with existing behavior: the desktop live-transcode
  path, the mobile lazy-transcode "preparing…" overlay/poll loop, the
  existing `±15s` skip buttons/keyboard shortcuts, and the deterministic
  star rating — none of these may regress.
- `ffprobe` is not installed in the dev/CI environment (per
  `docs/RELIABILITY.md` — "keep FFmpeg out of the core suite"); the tag
  *extraction* (calling ffprobe) is therefore only opportunistically
  verifiable, but the tag *parsing* logic must be written as a pure function
  so it is fully unit-testable without ffprobe installed.
- Every new feature ships with tests per `docs/CONTRIBUTING.md` — see
  Testability plan below for what's automatable vs. manual-only.

## Acceptance criteria

### 1. Media Session API

- [ ] On a browser/OS where `'mediaSession' in navigator` is true, playing a
      video sets `navigator.mediaSession.metadata` with: `title` =
      `mediaData.title`, `artist` = the resolved channel name (via the
      existing shared `resolveChannelName()` in `public/js/common.js`), and
      `artwork` = at least two sizes pointing at `/thumbnail/:id` (e.g. a
      96x96 and a 512x512 entry, both the same URL is acceptable since
      `/thumbnail/:id` doesn't currently support size variants — document
      this as a known simplification, not a blocker).
- [ ] `navigator.mediaSession.setActionHandler` is wired for `play`, `pause`,
      `seekbackward`, and `seekforward`; the seek handlers reuse the existing
      `SKIP_SECONDS` amount and the existing `skip()` function so lock-screen
      seeking behaves identically to the in-page skip buttons (including
      live-mode restart-of-stream semantics where applicable).
- [ ] On a device/browser that supports the Media Session API (manual
      verification: iOS Safari or Android Chrome lock screen / Control
      Center), the lock screen shows the thumbnail, title, and channel name,
      and lock-screen play/pause/skip controls work.
- [ ] On a browser where `'mediaSession' in navigator` is false (or in any
      automated/headless test environment), the feature no-ops silently — no
      thrown errors, no broken playback.
- [ ] Metadata updates when navigating to a different watch page (no stale
      title/artwork left over from a previous item).

### 2. Embedded metadata → description

- [ ] The scan's `ffprobe` invocation in `extractMetadataAndThumbnail()` is
      extended to also request format/stream tags (e.g. via
      `-show_format -show_entries format_tags -print_format json`, or an
      equivalent extension of the existing `-show_entries` argument) and
      capture common tags where present: `title`, `artist` (already
      captured), `comment`, `description`, `date`/`year`. Fields not present
      in the source file are simply omitted, never fabricated.
- [ ] The tag-parsing step — turning raw `ffprobe` JSON output into a small
      normalized object — is implemented as a **pure function** (no I/O, no
      `child_process`) taking the parsed/raw ffprobe JSON and returning a
      plain object (e.g. `{ title, comment, description, date }`), so it is
      unit-testable without ffprobe installed.
- [ ] The normalized object is stored on `db.metadata[id]` (e.g. as a `tags`
      field) and round-trips through `loadDatabase`/`saveDatabase` like the
      rest of the metadata shape.
- [ ] On the watch page, when embedded tags are present, they render
      **additively**, positioned **under** the existing blurred file-path
      block in `#description-paragraph` (`public/watch.html` ~L148-158) —
      the file-path line and the existing "self-hosted on your network…"
      copy are never removed or replaced.
- [ ] For a file with no embedded tags (or when `ffprobe` is unavailable),
      the description area renders **exactly** what it renders today — no
      empty headers, no "No description available" filler text, no layout
      shift.
- [ ] A scan of a file whose `ffprobe` call fails or times out does not throw
      or abort the scan (existing degrade-gracefully behavior preserved).

### 3. Varying comment counts

- [ ] A new deterministic helper (mirroring `getStarRating(id)` in
      `public/js/common.js`) computes a comment count in the range 4–14
      (inclusive) from the media id alone.
- [ ] The same media id always yields the same count (idempotent, pure,
      no `Math.random`/`Date.now`).
- [ ] Across a spread of different ids, the resulting counts visibly vary
      (not all clustering on one value) — verified by a unit test computing
      counts for a sample set of ids and asserting more than one distinct
      value appears.
- [ ] `loadComments()` / `getMockInitialComments()` in `public/js/watch.js`
      uses this count instead of the current hardcoded `4`, selecting that
      many *distinct* comments from the existing comment bank using the
      existing deterministic-index-with-collision-avoidance approach
      (`used` set), and the selected count never exceeds the comment bank's
      size (currently well over 80 entries, so 4–14 is always satisfiable).
- [ ] The comment-count badge (`#comment-count-badge`) reflects the actual
      number of rendered comments, as it does today.

### 4. Press-and-hold-to-2x (mobile inline)

- [ ] On the inline video (not native fullscreen), a `touchstart` on the
      player that is held past a threshold (~300-400ms, to be fixed exactly
      during design) sets `mediaPlayer.playbackRate = 2` and shows a small
      "2×" badge overlay.
- [ ] Releasing the hold (`touchend`/`touchcancel`) before or after the 2x
      engages restores the prior `playbackRate` (whatever it was before the
      hold — normally `1`) and hides the badge.
- [ ] A quick tap (released before the hold threshold) still results in the
      native single-tap play/pause behavior — unchanged from today.
- [ ] A double-tap (both taps released before the hold threshold, within the
      existing double-tap gap window) still triggers the existing ±15s seek
      via `setupSkipControls()` — unchanged from today. The hold-detection
      logic must not swallow or delay the double-tap gesture's recognition.
- [ ] A hold that crosses the threshold never also triggers a seek or a
      play/pause toggle — holding and releasing results in *only* the 2x
      speed change, nothing else firing alongside it.
- [ ] The gesture is touch-only (mobile inline); it does not attach to
      mouse/pointer events and has no effect on desktop.
- [ ] Entering native fullscreen suspends/detaches the hold gesture — no 2x
      badge or rate change is triggered by touches while in native
      fullscreen (that surface is the OS's/browser's own scrubber-and-menu
      chrome; see the native-vs-custom seam in Goal & context).

### 5. Rotate-to-fullscreen (best-effort)

- [ ] An orientation-change to landscape while the inline player is active
      and playing attempts to request fullscreen (`webkitEnterFullscreen`
      where present for iOS video-specific fullscreen, else the standard
      Fullscreen API `requestFullscreen()`).
- [ ] The attempt is wrapped so a refusal/rejection (expected on iOS Safari,
      which gates programmatic fullscreen behind a direct user gesture) is
      caught and silently ignored — no thrown error, no broken playback, no
      visible error state.
- [ ] Rotating back to portrait does **not** force-exit fullscreen unless the
      user is still in the state they'd have reached by rotating (i.e. no
      *new* forced exit is introduced); specifically, if the user manually
      entered fullscreen via a tap/native control, rotating to portrait must
      not auto-exit it.
- [ ] Acceptance for this criterion explicitly tolerates iOS refusing the
      programmatic request — document in the manual verification checklist
      that this behavior may end up Android-only in practice, and that is an
      acceptable outcome, not a failure, provided the refusal is silent.

## Technical Design

### Approach

All five items layer onto the existing inline-player surface without touching
the transcode pipeline or the native-fullscreen chrome. The two pieces of
regression-prone pure logic — the comment-count helper and the ffprobe tag
parser — are written as side-effect-free functions exported for `node:test`
(mirroring `getStarRating`), so CI covers them with no ffprobe binary. The
browser-only pieces (Media Session, the hold-to-2x gesture, rotate-to-
fullscreen) are all feature-detected and wrapped so they silently no-op where
the API is missing, and all of them consult a single `inNativeFullscreen()`
guard so nothing from this feature leaks into the OS/browser fullscreen
surface.

Files touched:

- `public/js/common.js` — add `getCommentCount(id, poolSize)` next to
  `getStarRating`; add it to the `module.exports` shim.
- `public/js/watch.js` — wire `getCommentCount` into `getMockInitialComments()`;
  add `setupMediaSession()` (called from `populateMetadata()`); add
  `renderEmbeddedTags()` (called from `populateMetadata()`); extend
  `setupSkipControls()` with the hold-to-2x state machine; add the
  orientation handler.
- `public/watch.html` — add the `#speed-badge` "2×" element inside
  `#player-wrapper`; no other markup change (embedded tags render into the
  existing `#description-paragraph` via JS).
- `server.js` — extend the ffprobe command in `extractMetadataAndThumbnail()`;
  add the pure `parseFfprobeTags(input)` and export it; store `tags` on
  `db.metadata`.
- `test/unit/comment-count.test.js`, `test/unit/ffprobe-tags.test.js` — new.

`/api/videos/:id` spreads `...item` (server.js L688-692), so once `tags` is
stored on `db.metadata[id]` it reaches the client on `mediaData.tags`
automatically — **no API change required**.

### Component changes

#### 1. Hold-to-2x gesture (highest risk) — extend `setupSkipControls()`

The existing gesture handling lives entirely in `setupSkipControls()`
(watch.js L253-292) and already owns a `touchend` listener that does
double-tap arbitration via `lastTapTime` / `lastTapLeft` with a 350ms gap. We
**extend that same handler set** — adding `touchstart` / `touchmove` /
`touchcancel` listeners and one early branch inside the *existing* `touchend`
handler — rather than attaching a second competing `touchend`.

New state (declared alongside `lastTapTime` in `setupSkipControls()`):

```text
HOLD_MS       = 350   // continuous contact before 2x engages
MOVE_TOL      = 10    // px of drift that reclassifies the touch as a scroll
holdTimer     = null  // setTimeout handle
holdActive    = false // 2x currently engaged
prevRate      = 1     // playbackRate captured before engaging 2x
startX, startY        // touchstart coordinates, for movement cancel
```

Guards (both consulted before any state change):

```text
isTouchDevice()     = 'ontouchstart' in window || navigator.maxTouchPoints > 0
inNativeFullscreen() = mediaPlayer.webkitDisplayingFullscreen === true
                       || !!document.fullscreenElement
```

State machine on the `<video>` element:

- **touchstart** (`{ passive: true }`): if `inNativeFullscreen()` or
  `e.touches.length > 1` (pinch), return without arming. Record `startX/startY`,
  clear any stale `holdTimer`, then
  `holdTimer = setTimeout(engageHold, HOLD_MS)`. Do **not** `preventDefault` —
  native play/pause must remain possible for a short tap.
- **engageHold** (timer fires): re-check `inNativeFullscreen()`; capture
  `prevRate = mediaPlayer.playbackRate`; set `mediaPlayer.playbackRate = 2`;
  `holdActive = true`; show `#speed-badge`.
- **touchmove** (`{ passive: true }`): if the touch has drifted more than
  `MOVE_TOL` from `startX/startY` **and 2x has not yet engaged**, it is a
  scroll — `clearTimeout(holdTimer)` so the hold never fires. Drift *after*
  engagement is ignored (a press-and-hold naturally wobbles); 2x persists
  until release.
- **touchend** (existing handler, `{ passive: false }`): first
  `clearTimeout(holdTimer)`. If `holdActive`: restore
  `mediaPlayer.playbackRate = prevRate`, `holdActive = false`, hide the badge,
  `e.preventDefault()` (swallow the native single-tap play/pause so a hold
  never toggles playback), reset `lastTapTime = 0` (so it can't chain into a
  double-tap), and **return before** the existing double-tap block. Otherwise
  fall through to the **unchanged** existing double-tap logic (a genuine tap or
  double-tap).
- **touchcancel** (`{ passive: true }`): `clearTimeout(holdTimer)`; if
  `holdActive`, restore rate + hide badge + `holdActive = false`; reset
  `lastTapTime = 0`.

Why this arbitration is correct:

- **Single tap** — down-up well under 350ms; `holdTimer` is cleared on
  touchend before it fires, `holdActive` stays false, no `preventDefault`, so
  the browser's native single-tap play/pause runs unchanged.
- **Double tap** — two quick taps; each touchend clears the timer before
  350ms, so 2x never engages and the existing gap-based seek logic runs
  untouched. HOLD_MS and the double-tap gap are both 350ms but measure
  different things (continuous contact of one touch vs. time *between* two
  separate taps), so they don't interfere.
- **Hold** — one continuous contact past 350ms engages 2x; the touchend
  `preventDefault` + early return guarantees *only* the rate change happens,
  never an accompanying seek or toggle.
- **Not a touch device / native fullscreen** — listeners are only registered
  when `isTouchDevice()`; every engagement path also re-checks
  `inNativeFullscreen()` and no-ops there.

#### 2. Media Session — `setupMediaSession(channelName)`

Called at the end of `populateMetadata()` (watch.js L141-158), right after
`channelName` is resolved, so title/artist/artwork are set on every page load
(each watch item is a full navigation, so there is no stale-metadata case).

```text
if (!('mediaSession' in navigator)) return;
try {
  navigator.mediaSession.metadata = new MediaMetadata({
    title: mediaData.title,
    artist: channelName,                 // resolveChannelName() result
    artwork: [
      { src: `/thumbnail/${mediaId}`, sizes: '96x96',  type: 'image/jpeg' },
      { src: `/thumbnail/${mediaId}`, sizes: '512x512', type: 'image/jpeg' }
    ]
  });
  navigator.mediaSession.setActionHandler('play',        () => mediaPlayer.play().catch(() => {}));
  navigator.mediaSession.setActionHandler('pause',       () => mediaPlayer.pause());
  navigator.mediaSession.setActionHandler('seekbackward',() => skip(-SKIP_SECONDS));
  navigator.mediaSession.setActionHandler('seekforward', () => skip(SKIP_SECONDS));
} catch (e) { /* silent no-op */ }
```

`skip()` and `SKIP_SECONDS` are in the same `DOMContentLoaded` closure and are
already initialized by the time `init()` → `populateMetadata()` runs (both are
declared above the `init()` call at L812). Reusing `skip()` means lock-screen
seek honors the live-mode restart-of-stream path for free. No double-drive: the
handlers call `play()`/`pause()`/`skip()`, and the existing `play`/`pause`
listeners only *react* to the resulting media events (progress saver) — they do
not re-issue commands. The two same-URL artwork sizes are the documented
simplification from the Decision log (`/thumbnail/:id` has no size variants).

#### 3. Embedded metadata — pure parser + additive render

**Pure parser (server.js, exported):**

```text
function parseFfprobeTags(input) {
  let j = input;
  if (typeof input === 'string') { try { j = JSON.parse(input); } catch { return {}; } }
  if (!j || typeof j !== 'object') return {};
  const tags = (j.format && j.format.tags) || {};
  // case-insensitive lookup over the tags object
  const get = (name) => { /* find key === name ignoring case, trim, '' -> undefined */ };
  const out = {};
  const title = get('title'), comment = get('comment');
  let description = get('description'), date = get('date') || get('year');
  if (title)   out.title = title;
  if (comment) out.comment = comment;
  // dedup: drop description if it equals comment (case-insensitive/trim)
  if (description && !(comment && description.toLowerCase() === comment.toLowerCase())) {
    out.description = description;
  }
  if (date) out.date = date;
  return out;
}
```

- Pure: no I/O, no `child_process`; accepts the parsed object **or** a raw
  JSON string; returns `{}` for null/undefined/non-object/malformed input.
- Only whitelisted tags (`title`, `comment`, `description`, `date`/`year`);
  empty/whitespace values are omitted (never fabricated). `artist` is
  intentionally **not** included here — it is already captured separately and
  shown as the channel, so surfacing it again in the description would
  duplicate it.

**Server spawn change:** extend the existing `exec` command in
`extractMetadataAndThumbnail()` (server.js L349) from
`-show_entries format=duration:format_tags=artist` to
`-show_entries format=duration:format_tags -of json` (request *all* format
tags; the parser whitelists). Keep the existing inline `artist` parse
unchanged, and additionally set `tags = parseFfprobeTags(j)`; return
`{ duration, artist, hasThumbnail, tags }`. In `runScanDirectories()` (around
L442-444) store `newMetadata[id].tags = meta.tags || {}`. The `!ffmpegAvailable`
early return (L345) also returns `tags: {}`. All existing try/catch and
degrade-gracefully behavior is preserved — a failed/timed-out probe yields
`tags: {}` and never throws.

**`db.metadata.tags` shape:** a plain object always present, e.g.
`{ title, comment, description, date }` with only found fields; `{}` when none.
Round-trips through `loadDatabase`/`saveDatabase` like every other field.

**Additive render (watch.js `renderEmbeddedTags`, called from
`populateMetadata()` after `filePathText.textContent = mediaData.filePath`):**
builds an `<div class="embedded-tags">` and appends it to
`#description-paragraph` (watch.html L152-156) so it sits **under** the file-
path line and the static "self-hosted…" copy — never replacing them. Each
value is `escapeHtml`-escaped. Render-time dedup skips any tag value equal to
`mediaData.title`. If `tags` is empty/absent or every value was skipped, the
function appends nothing — the description area renders exactly as today (no
empty header, no filler, no layout shift).

#### 4. Comment count — `getCommentCount(id, poolSize)`

New pure helper in `common.js`, mirroring `getStarRating`:

```text
function getCommentCount(id, poolSize) {
  const s = String(id || '');
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
  let n = (sum % 11) + 4;                 // 4..14 inclusive
  if (typeof poolSize === 'number' && poolSize > 0) n = Math.min(n, poolSize);
  return n;
}
```

Added to `module.exports` (`{ getStarRating, resolveChannelName,
getCommentCount }`). In `getMockInitialComments()` (watch.js L723-733), replace
the hardcoded `for (let i = 0; i < 4; i++)` with
`const count = getCommentCount(mediaId, commentBank.length);` and loop to
`count`, keeping the existing deterministic-index + `used`-set collision
avoidance. `renderComments()` already sets `#comment-count-badge` from
`comments.length`, so the badge reflects the real count with no change.

#### 5. Rotate-to-fullscreen — orientation handler

Registered in the video branch of `setupPlayer()` (guarded by `isTouchDevice()`
so it is mobile-only):

```text
function onOrientationChange() {
  try {
    if (!isMobileViewport()) return;
    if (!window.matchMedia('(orientation: landscape)').matches) return; // portrait: no-op
    if (mediaPlayer.paused || inNativeFullscreen()) return;
    if (typeof mediaPlayer.webkitEnterFullscreen === 'function') {
      mediaPlayer.webkitEnterFullscreen();          // iOS video-specific; may refuse/throw
    } else if (mediaPlayer.requestFullscreen) {
      const p = mediaPlayer.requestFullscreen();
      if (p && p.catch) p.catch(() => {});           // Android/standard
    }
  } catch (e) { /* silently ignore refusal — never break playback */ }
}
window.addEventListener('orientationchange', onOrientationChange);
```

Portrait is a deliberate **no-op**: the handler only ever *requests* fullscreen
on landscape and never calls `exitFullscreen`, so rotating back to portrait can
never force-exit a fullscreen the user entered by tapping the native control or
pressing `f`. The whole body is `try/catch` plus a `.catch()` on the promise,
so iOS's user-gesture refusal is swallowed silently (may be Android-only in
practice — an accepted, documented outcome).

### Data model changes

- `db.metadata[id].tags` — new object field, `{ title?, comment?, description?,
  date? }` (only present tags; `{}` when none). Round-trips through
  `loadDatabase`/`saveDatabase`. Additive; existing fields unchanged.

### API changes

None. `/api/videos/:id` already spreads `...item`, so `tags` reaches the client
on `mediaData.tags` with no route change.

### Alternatives considered

- **Custom pointer/Pointer-Events gesture layer instead of extending the
  existing touch handler.** Rejected: it would introduce a *second* arbiter on
  the same element, risking exactly the cross-triggering the plan flags as the
  top risk, and pointer events would also fire on desktop mouse (out of scope —
  gesture must be touch-only). Extending the one existing `touchend` handler
  keeps a single source of truth for tap/double-tap/hold arbitration.
- **A dedicated multi-resolution thumbnail endpoint for Media Session
  artwork.** Rejected/deferred: building real size variants is explicitly out
  of scope (Decision log); declaring `96x96` and `512x512` against the same
  `/thumbnail/:id` URL satisfies the API's recommended shape at zero cost.
- **Whitelisting exact tag names in the ffprobe `-show_entries` argument**
  (e.g. `format_tags=title,comment,description,date`). Rejected in favor of
  requesting all `format_tags` and whitelisting in the pure parser: it keeps
  the tag-selection logic in the unit-tested function rather than in the
  un-testable spawn string, and tolerates case/name variance across files.

### Risks and mitigations

- **Risk:** hold-to-2x cross-fires with tap/double-tap. → **Mitigation:** one
  extended handler, timer cleared on every touchend, `preventDefault` + early
  return on an engaged hold, plus on-device manual verification (per QA note).
- **Risk:** ffprobe tag casing/encoding variance. → **Mitigation:** case-
  insensitive lookup and a fixture-driven unit test covering mixed case,
  missing, empty, malformed, and duplicate values.
- **Risk:** Media Session handlers and existing controls double-drive the
  player. → **Mitigation:** handlers only call `play`/`pause`/`skip`; existing
  listeners only react to media events, never re-issue commands.
- **Risk:** iOS refuses programmatic rotate-to-fullscreen. → **Mitigation:**
  accepted per Decision log; `try/catch` + promise `.catch` guarantee a silent
  refusal, documented as possibly Android-only.

### Performance impact

No expected impact on the budgets in `docs/RELIABILITY.md`. The extended
ffprobe command adds no new process spawn (same single `exec`, marginally more
tag output parsed in-memory). The frontend additions are event handlers and a
one-time render; no new polling, timers-per-frame, or network calls beyond the
already-served `/thumbnail/:id`.

### Test list (`node:test`)

**`test/unit/comment-count.test.js`** (`require('../../public/js/common.js')`):

- range — 300 ids each yield an integer in `[4, 14]`.
- determinism — same id yields the same count on repeated calls.
- varies — 100 distinct ids produce more than one distinct count.
- empty/undefined id — does not throw, result in range.
- clamp — `getCommentCount(id, 5) <= 5` and `getCommentCount(id, 3) <= 3` for a
  spread of ids; large `poolSize` leaves the value unchanged.

**`test/unit/ffprobe-tags.test.js`** (`require('../../server')` for
`parseFfprobeTags`):

- present tags — full `format.tags` (title/comment/description/date) returns
  all four, trimmed.
- case-insensitive keys — `TITLE`/`Comment`/`DATE`/`YEAR` resolve correctly.
- missing tags — `format` present but no `tags` → `{}`.
- no format — object without `format` → `{}`.
- malformed input — `undefined`, `null`, `''`, `'not json'`, a number → `{}`
  (never throws).
- accepts raw JSON string as well as a parsed object.
- empty/whitespace tag values are omitted (never fabricated).
- dedup — `description` equal to `comment` (case-insensitive) is dropped;
  result keeps `comment`, omits `description`.

**Export wiring:** add `getCommentCount` to `common.js` `module.exports`; add
`parseFfprobeTags` to `server.js` `module.exports`.

**Manual-only (per Testability plan):** Media Session lock-screen behavior, the
full real-ffprobe scan path, hold-to-2x timing arbitration, rotate-to-
fullscreen on device, and native-fullscreen non-leakage.

### Ordered task breakdown

1. **Comment count (pure + wire).** Add `getCommentCount(id, poolSize)` to
   `common.js` and its export; add `test/unit/comment-count.test.js`; wire it
   into `getMockInitialComments()`.
2. **ffprobe tags (pure + server + wire).** Add `parseFfprobeTags(input)` to
   `server.js` and its export; add `test/unit/ffprobe-tags.test.js`; extend the
   ffprobe command and store `tags` on `db.metadata` (with `{}` fallbacks).
3. **Embedded-tags render.** Add `renderEmbeddedTags()` and call it from
   `populateMetadata()`; append under `#description-paragraph`; escape values;
   render nothing when empty (add minimal CSS).
4. **Media Session.** Add `setupMediaSession(channelName)` and call it from
   `populateMetadata()`; feature-detect, wire the four handlers reusing
   `skip()`/`SKIP_SECONDS`.
5. **Hold-to-2x gesture.** Add the `#speed-badge` element + CSS to
   `watch.html`; extend `setupSkipControls()` with the touchstart/move/cancel
   listeners and the touchend early branch per the state machine.
6. **Rotate-to-fullscreen.** Add `onOrientationChange()` + listener in the
   video branch of `setupPlayer()`, fully guarded/try-caught.
7. **Manual verification pass.** Run the on-device checklist (Media Session,
   gestures, rotate, native-fullscreen non-leakage) before advancing to QA /
   `/code-review`.

## Task breakdown

(To be filled by engineering-manager)

## Progress log

- 2026-07-04 — Discovery complete. Exec plan drafted from feature-state.json
  description plus direct reading of `public/watch.html`, `public/js/watch.js`,
  `public/js/common.js`, and `server.js` (`extractMetadataAndThumbnail`,
  `/thumbnail/:id`, `db.metadata` shape). No overlapping active exec plans
  found (`avi-ux-refinement` is a shipped tombstone in `active/`, real content
  in `completed/`). No conflicts with `docs/ARCHITECTURE.md`; this feature
  builds on top of the existing playback pipeline without touching the
  transcode/eviction logic from the prior feature. No open items in
  `docs/exec-plans/tech-debt-tracker.md` Active table to address or create.

## Decision log

- 2026-07-04 — **Custom PiP button explicitly dropped, not deferred.** The
  native `<video>` element already provides Picture-in-Picture on platforms
  that support it (iOS Safari inline/fullscreen chrome, Android Chrome). A
  custom PiP trigger would duplicate native behavior and risks conflicting
  with the native-vs-custom seam this feature is built around. Do not re-add
  without revisiting this decision explicitly.
- 2026-07-04 — **Rotate-to-fullscreen scoped as best-effort with a
  documented caveat**, not a hard requirement, because iOS Safari gates
  programmatic `requestFullscreen()`/`webkitEnterFullscreen()` behind a
  direct user gesture and may refuse it on orientation-change alone. The
  acceptance criteria are written to treat a silent refusal as a pass; only
  an *unhandled* throw or a broken player state is a fail. This may end up
  Android-only in production — that is an acceptable, documented outcome.
- 2026-07-04 — **Artwork sizes for Media Session**: `/thumbnail/:id`
  currently serves a single fixed-size JPEG/SVG placeholder with no
  size-variant query support. The acceptance criteria for Media Session
  artwork call for "a couple of sizes" per the Media Session API's
  recommended pattern, but allow the same URL to be reused at declared
  96x96/512x512 sizes as a known simplification rather than blocking on
  building real multi-resolution thumbnail generation (out of scope here —
  no new thumbnail-resizing work is authorized by this plan).

## Testability plan

**Automatable (`node:test`, per `docs/CONTRIBUTING.md` "every feature ships
with tests"):**

- **Deterministic comment-count helper.** Pure function of `id` — unit test
  it directly for: same id → same count every call; a sample set of ids
  produces more than one distinct count (varies); output always within
  4–14 inclusive. Lives alongside `getStarRating` conventions (either in
  `public/js/common.js`, exported for Node the same way `getStarRating` is,
  or co-located with the comment logic — final home decided during design).
- **ffprobe tag-parsing function.** Written as a pure function that accepts
  already-parsed (or raw string) ffprobe JSON and returns the normalized
  `{ title, comment, description, date, ... }` object. Because it takes data
  in rather than shelling out itself, it is fully testable with hand-built
  fixture JSON (including missing fields, empty tags object, and malformed
  input) with **no ffprobe binary required** — keeping it out of the
  FFmpeg-dependent exclusion zone `docs/RELIABILITY.md` calls out for the
  core suite.
- Existing unit-test conventions apply: new tests live in `test/unit/`,
  following the isolation pattern already used (e.g.
  `test/unit/star-rating.test.js`) for any server-side pieces.

**Not automatable — manual/browser/device verification checklist (CI cannot
cover these; call this out explicitly in the PR and QA notes):**

- Media Session lock-screen/Control Center appearance and hardware transport
  control behavior — requires an actual iOS/Android device or an OS-level
  media session simulator; cannot be exercised in a headless CI browser.
- The full ffprobe scan integration path (does the real `ffprobe` binary,
  invoked with the extended argument list, actually produce the JSON shape
  the parser expects) — ffprobe is not installed in the dev/CI environment
  per `docs/RELIABILITY.md`, so this is manual/opportunistic verification
  against a real media file with known embedded tags. The parse function
  itself, tested separately with fixtures, is what gives this confidence
  without the binary.
- Press-and-hold-to-2x gesture arbitration against tap/double-tap — requires
  real touch input timing on an actual mobile device or an emulator with
  accurate touch-event timing; jsdom/simulated events cannot reliably
  reproduce hold-duration nuances.
- Rotate-to-fullscreen — requires a real device orientation change; must be
  verified manually on at least one iOS device (expect/accept refusal) and
  ideally one Android device (expect success).
- Coexistence with the native player surface generally (i.e. confirming none
  of the above leaks into native fullscreen) — visual/manual check on-device.

## Risks

- **Gesture arbitration mis-fires.** Hold-to-2x, tap-to-play/pause, and
  double-tap-to-seek all listen on overlapping touch events on the same
  element; a poorly tuned threshold could cause a slow double-tap to trigger
  2x, or a hold to also fire a seek/toggle. This is the single highest-risk
  area of the feature and needs deliberate design + on-device testing, not
  just code review.
- **iOS fullscreen refusal.** Rotate-to-fullscreen may simply not work on
  iOS Safari (gated behind a user gesture) — acceptance criteria account for
  this, but it means the feature may deliver materially less on iOS than on
  Android, which should be communicated clearly rather than treated as a bug.
- **ffprobe output-shape variance.** Real-world files have wildly
  inconsistent tag presence/casing/encoding (e.g. `artist` vs `ARTIST` vs
  `Artist`, as already handled for the existing artist tag). The parser must
  be defensive and tested against varied/malformed fixtures, not just a
  single happy-path shape.
- **Double-controlling the native player.** Media Session action handlers
  and the existing keyboard/skip-button code both call things like `skip()`
  and `play()`/`pause()`; care is needed so these don't fight each other or
  double-fire when triggered from multiple entry points (e.g. lock-screen
  pause plus in-page pause event both attempting state changes).

## QA note

This branch touches gesture handling on the primary playback surface and
introduces the first Media Session integration in the app. **A significant
QA / code-review pass is required before acceptance** — beyond the usual
unit-test gate. The top review targets, per the requirements above, are:
(1) the native-vs-custom seam (nothing from this feature may leak into or
duplicate native fullscreen chrome — no custom PiP, no custom speed menu,
gestures no-op in fullscreen), and (2) gesture arbitration correctness
(tap/double-tap/hold must never cross-trigger each other). Route through the
quality-assurance stage and `/code-review` before advancing to Done.
