---
plan: native-audio
harness: v2 · full
branch: feat/v1.397.0-native-audio
anchor: spec
status: Approved - ready to build
next: gate r2 - the same three seats re-confirm the r1 fixes, then release
design: Approved 2026-10-28 (Dean's rulings via the Root; the contract drafted with the SANDYJAR iOS Dev Root)
gate: pending
builder: extreme
---

# v1.397.0 - the iOS app plays music and podcasts through a native engine

Kickoff 2026-10-28 (FileTube Root, Opus). **Builder: Extreme (Fable).** The pick: native takes over playback ownership
across the player core (load, progress, end-of-track, MediaSession, skins), and device-token auth gets wider; that's a
cross-cutting architecture change with an auth surface. One release, version **1.397.0** (the next free minor; if another
release merges first, take the next one and tell the iOS Root).

This plan is the FileTube half. The app half (the AVPlayer engine, the audio session, the lock screen) is the iOS Root's
filetube-ios plan, which pins this release's TAG commit. The iOS Root sits on SANDYJAR ("SANDYJAR iOS Dev Root"). The
FileTube Root relays to it; the builder never edits filetube-ios.

## Why

Dean, 2026-10-28 (via the iOS Root): "Native av player please. IOS only." Today online audio plays in the WKWebView. The
app sets `.playback` at launch and WebKit activates it, so the app never holds the session and never releases it. Dean
sees collisions with other apps' mic and audio, and a locked phone can pause but not resume
(docs/references/ios-background-audio-behavior-map.md: "The real fix is native"). ios-host.md "Decisions already made"
already fixes the shape: native owns playback while hosted, the web sends intents and renders native's snapshots, native
fetches the next radio pick itself, the web's element is silenced, and native requests use a media token.

## Rulings (settled - do not reopen)

| # | Ruling | Source |
|---|---|---|
| D1 | Straight to the native engine; no web-posted audioSession stopgap. Native owns the audio session entirely. | Dean 2026-10-28 |
| D2 | Scope: **music** (native tracks, library audio, chapter rows `<id>::c<n>`) **and podcasts**. Video stays on the web player and the existing native video presenter. | Dean 2026-10-28 |
| D3 | The first version includes **Loop chapter, playback speed and a sleep timer**. | Dean 2026-10-28 |
| D4 | Capability `nativeAudio`, add-only within bridge v1. The shapes are in the contract section below. | Root + iOS Root |
| D5 | **The web sends the whole queue up front** (native holds it as data and windows its AVPlayerItems). | iOS Root |
| D6 | **Clip-relative time**: for an Item with `clip`, positionSec, durationSec and seek are relative to the clip; native ends the item at `clip.endSec`; Loop chapter loops the clip. | Root |
| D7 | **Auth: a short-lived media token in the query** (`?mt=`), minted with the device token. It's GET-only and limited to the audio byte and art routes. Not a header (AVURLAsset header fields aren't a documented key, which matters for an App Store build) and not a resource loader. | Root |
| D8 | **Progress, plays and resume through the SAME online routes the web uses**, with the same bodies, added to the device-token allowlist. Not /api/offline/progress (batch sync with restamp rules). Native retries a failed POST once, then drops it. | Root |
| D9 | **Downloaded items:** native looks up its own catalogue by kind and id and plays the local copy; Item carries no localSrc. | Root |
| D10 | **Not announced = byte-identical.** With no host, or a host without `nativeAudio` (older app builds, browsers, the PWA), nothing changes. | ios-host.md rule |
| D11 | Snapshots: a full `audioState` on subscribe and on every real change, plus a small `audioTick` about every 1 s while playing. | iOS Root |
| D12 | **The server Up-next queue** (`/api/queue`, which the web's autoplay consults): when it holds entries, the web flattens them into the Item list it sends. A queue edit while hosted re-sends `audio.load` (rev+1) at the current index and position. Native stays queue-dumb. | Root |
| D13 | **Sleep timer UI** shows only when `nativeAudio` is announced: the browser has no sleep timer today, and this plan doesn't add one. | Root |
| D14 | **The `mt` refusal bodies tell native which recovery to take** (added 2026-10-28 during W2): `401 { error: 'media token expired', mediaTokenExpired: true }` for an expired token AND for a token that never existed (the same answer, no oracle beyond what deviceAuth allows); `401 { error: 'device token revoked', deviceRevoked: true }` when the token's device is revoked, epoch-stale or disabled (mid-stream the open response simply ends). | iOS Root via the Root |
| D15 | **Native re-mints on ANY byte / art 401 and the mint's answer decides** (AVPlayer sees only the status of a failed request): `POST /api/devices/media-token` sits behind deviceAuth, so a revoked, epoch-stale, disabled-user or expired device answers `401 deviceRevoked` and mints nothing (tested per case). The byte-route bodies of D14 stay distinct for the web and the logs. | iOS Root via the Root |
| D16 | **The mint is rate-bound per device**: 6 a minute (a token bucket per device row refilling one every 10 s), `429 { error: 'too many attempts', retryAfterSec }` past it; a sibling device is untouched. Media tokens are stateless (an HMAC over `{ uid, did, de, iat, exp }` with the session secret, prefix `ftm_`), so nothing is stored and nothing needs pruning. | Root (the number is the builder's call) |
| D18 | **The media token's HMAC key is domain-separated** (the Root's W2 review): `HMAC(sessionSecret, 'filetube media token v1')`, never the raw session secret, so a media token (a credential that sits in URLs) can never verify as a session cookie with its prefix stripped and a `tv` forged in, and a session never parses as a media token. Tested both ways with the raw-key control; named in the security seat's brief. No contract change (tokens are opaque to native). | Root |
| D17 | **The web owns queue ORDER, shuffle included; native never reorders.** A shuffle toggle or a queue edit re-sends `audio.load` with rev + 1, the CURRENT index and `positionSec` read from the latest `audioState` / `audioTick`, never a stale value (native treats a load whose `queue[index]` has the playing item's kind and id as seamless, with no restart unless the position differs by more than 2 s). | iOS Root via the Root |

## The contract (nativeAudio, bridge v1, add-only)

The schema (docs/references/native-bridge.v1.schema.json) is the authority once W1 lands; native-bridge.md explains it.
Field names below are the agreed draft. W1 may refine them only with a note here and a relay to the iOS Root.

**Item** `{ kind: 'track'|'podcastEpisode', id, src, title, artist?, album?, artworkSrc?, durationSec?, clip?: { startSec, endSec } (file seconds), progress: { route: '/api/music/progress'|'/api/progress'|'/api/podcasts/progress', key }, radioSeed? }`
- `src` and `artworkSrc` are server-relative paths. Native resolves them against the configured origin and appends `mt`.
- `src` is the iOS-playable file route `/api/offline/file/<kind>/<id>` (lib/offline/playable.js), never the web's
  `/track`, which 503s while an ALAC rendition transcodes. A chapter row's src is its parent file plus `clip`.
- `progress.key` is the id the web would save under (a chapter saves under `baseMediaId`, with file-absolute seconds).

**web -> native**: `audio.load { queue: [Item], index, positionSec, autoplay, modes: { autoplay, shuffle, loop: 'off'|'one' }, rate, rev }`,
`audio.play`, `audio.pause`, `audio.seek { positionSec }`, `audio.skip { to: 'next'|'previous' }`, `audio.jump { index }`,
`audio.setModes { modes }`, `audio.setRate { rate }` (0.5-3.0), `audio.sleep { mode: 'off'|'minutes'|'endOfItem', minutes? }`,
`audio.stop`, `audio.subscribe`, `audio.unsubscribe`.

**native -> web**: `audioState { rev, queue: [Item], index, state: 'idle'|'loading'|'playing'|'paused'|'ended'|'failed', positionSec, durationSec, bufferedSec?, rate, modes, sleep: { mode, endsAt? }, error? }`,
`audioTick { rev, positionSec, bufferedSec? }`, and `audioError { id, error: 'network'|'notPlayable'|'revoked'|'notOnServer'|'other' }`.

Rules:
- The web REPLACES its view with every audioState, and ticks are deltas.
- A snapshot whose rev is older than the web's last load is dropped.
- The subscription is released on navigation like the others, and a persisted pageshow re-subscribes.
- Unknown fields and values follow native-bridge.md's rules.
- Radio: native fetches `GET /api/music/radio` itself, mirroring music.js fetchAutoplayPicks (music.js ~4900):
  - seed = the current Item's radioSeed;
  - ask when 2 or fewer items are left;
  - if a batch kept nothing, ask once more with `widen=1`;
  - send `exclude` and `queued`;
  - drop ids already queued.
  Podcasts never use radio.

## Seams (verified 2026-10-28 by the Root; line numbers drift, so search by name)

- **The one choke point:** `window.FileTube.player.load(id, data, opts)` (player.js ~10815) -> `setupForMedia` (~10044). For
  `data.type === 'audio'`, `mediaPlayer.src = streamUrl` (~10344). Callers: music.js `loadTrack` (~4503 / load ~4611),
  podcasts.js `playAt` (~1088 / load ~1139), feed.js (~1327, ~2380). The autostart is `handleResumePlayback` (~6308). One
  direct `mp.play()` is in music.js `seekAdoptedChapter` (~4657).
- **The proxy to reuse:** music.js `hostCtl` (~1789) already swaps in `remoteCtl` (~1758-1786), a fake media element
  (paused / duration / currentTime getter+setter, button clicks) driven by Listen Control. Native snapshots drive the same
  kind of proxy. podcasts.js passes a raw getElementById as hostCtl (~277), so it needs that hook. skin-surface.js reads only
  through `cfg.hostCtl(...)` (19 reads). Direct element readers that must route through the proxy: player.js (~45 reads;
  the dock scrubber `updateSeekVisual` / `startFillLoop`, `updatePlayPauseUI`), music.js (~15), podcasts.js (245, 362, 929),
  remote.js:134.
- **Stands down under native** (each must be measured silent with nativeAudio on):
  - MediaSession `setupMediaSession` (~3346) and its handlers (~3477-3555, setTrackNav ~3674);
  - the progress saver `saveProgressToServer` (~6535), with its 4 s cadence, pause, seek, outgoing and lifecycle saves;
  - the `ended` cascade `runEndedCompletionCascade` (~7021) and the player's `chapterLoop` (~8816 / ~7005);
  - music.js `enforceChapterLoop` (~2261), `enforceChapterExit` / `enforceFlatSegmentEnd` (~2328 / ~5567);
  - the plays tally (~1296-1420).
  Native does all of these instead. `/api/music/resume` on load (~4629) stays a WEB post (it's the web's own record of
  what was opened).
- **Speed:** `applyPlaybackRate` (~7480; global, `ft-rate`). Under native it posts `audio.setRate` and keeps `ft-rate`.
- **Host adapter:** public/js/host-adapter.js `CAPABILITIES` / `MESSAGES` / `EVENTS` must mirror the schema
  (test/unit/native-bridge-contract.test.js). public/js/offline.js is the subscribe / pagehide / pageshow model to copy.
- **Server auth:**
  - lib/auth/device-scope.js `DEVICE_SCOPE` (default-deny allowlist; test/integration/device-scope-census.test.js);
  - lib/auth/gate.js `deviceAuth`, including live revocation via `devices.track`;
  - lib/auth/devices.js; the pairing route `POST /api/devices` (lib/auth/routes.js).
- **URL logging:** server.js ~3261 `[audit] ... ${req.originalUrl}` logs the full query. `mt` must be redacted there and in
  every other place a URL is logged or echoed (census them).
- **Online progress routes:** `/api/music/progress` (lib/music/routes.js ~614), `/api/progress` (lib/media/user-routes.js ~73),
  `/api/podcasts/progress` (lib/podcasts/index.js ~1198), `/api/music/plays` (lib/music/routes.js ~348), and
  `GET /api/music/radio` (lib/music/routes.js ~299; its station-seed rate limiter applies to devices too).

## Step 0 (builder, before W1)

- Read:
  - AGENTS.md;
  - docs/LESSONS.md sections 0, 1, 2, 4, 5, 9, 10 and 12;
  - docs/references/native-bridge.md, ios-host.md, offline-api.md and ios-background-audio-behavior-map.md;
  - the completed plans 2026-10-11-offline-server.md and native-bridge-web.md;
  - this plan.
- Environment:
  - export the fnm Node PATH (AGENTS.md Environment);
  - worktree under .claude/worktrees/, with node_modules hard-link-copied, never symlinked;
  - stage by name, no force-push, no --no-verify.
- Census, written into Evidence before any code:
  - every `player.load` caller, with whether it can carry `type: 'audio'`;
  - every direct element read on the audio path;
  - every URL logger (for `mt`).
  A seam the census finds that this plan doesn't name: add it to the plan, don't skip it.
- Measure: stream a large FLAC and a podcast mp3 through `/api/offline/file/<kind>/<id>` with Range (TTFB, a mid-file
  seek), to show it serves ONLINE playback as well as `/track` does. If it's materially slower or refuses a Range: STOP and ask.
- Red first: a contract test that a host announcing `nativeAudio` gets `audio.load` and the element gets NO src. Watch it
  fail on main.

## Waves

1. **W1 - the contract.** Schema, host-adapter mirrors, native-bridge.md (sections 2, 3, 5 and 6) and ios-host.md (the
   "Decisions" line becomes "built in v1.397.0"). Contract tests. Relay the frozen shapes to the iOS Root through the
   FileTube Root before W3.
2. **W2 - server.**
   - `POST /api/devices/media-token`:
     - device-token auth only (a cookie session or a media token can't mint one);
     - returns `{ token, expiresAt }`, about 6 h, bound to the user, the device row and the device epoch;
     - revoked with the device, and live-revoked mid-stream like `devices.track`.
   - `mt` is accepted ONLY on GET (HEAD) of: `/api/offline/file/:kind/:id` (track, podcastEpisode), `/albumart/:id` and
     `/podcastart/:subId`. It's never accepted anywhere else, never sets a cookie, never survives a cross-origin redirect,
     and is redacted from every log line.
   - DEVICE_SCOPE gains `GET /api/music/radio`, `POST /api/music/progress`, `POST /api/progress`,
     `POST /api/podcasts/progress` and `POST /api/music/plays`. Update the census test. Restrictions apply as for a browser
     (req.user is set).
3. **W3 - the web adapter.** A new public/js/native-audio.js (no deps). It owns the ONE `audio.subscribe`, builds Items from
   load descriptors, and keeps the latest snapshot.
   - At the player.load choke point, when `host.has('nativeAudio')` and `data.type === 'audio'`, nothing is set on the
     element: it posts `audio.load` with the whole queue (music queue / podcasts playable / the D12 flattening).
   - A native-backed proxy, the remoteCtl pattern, feeds the dock, now-playing, skins and podcasts (add podcasts' hostCtl hook).
   - Transport, rate, the modes (Loop, Shuffle, Autoplay, Loop chapter) and the sleep timer (D13) post intents.
   - Everything in "Stands down under native" goes silent.
   - Without the capability, all of this is inert (D10).
4. **W4 - guards.**
   - The contract tests.
   - A binding test per stand-down item (mutate the guard, watch it red).
   - A no-host byte-identity test for the audio path.
   - The token tests:
     - `mt` refused off its routes, and refused for a POST;
     - expiry and revocation (including mid-stream);
     - redaction (grep every logger with a planted token);
     - a media token can't mint a token;
     - a cookie can't mint one.
   - A fake host in jsdom that plays snapshots back, to show the dock, scrubber and skins render from it.
5. **W5 - look and relay.** A screenshot of the dock and now-playing driven by a fake host (state playing, paused, sleep
   armed). Send the iOS Root (through the FileTube Root) the final schema sha.

## Stop rules

- The proxy can't carry a skin or the dock without forking the player core: STOP and ask.
- The offline file route can't serve online playback acceptably (Step 0): STOP and ask.
- Any field in the contract needs to change after the W1 relay: STOP. The Root relays it, and nothing changes silently.
- A security seat finding on `mt` that the plan's shape can't close: STOP and ask Dean.

## Gate

Full gate, forced (auth and token surface): **adversary + qa + security-brief**.
- Adversary: the stand-down list (two audio stacks never both play), D10 byte-identity, the `mt` scope, and stale-rev
  snapshots.
- Security-brief: D7, the redaction census, and the allowlist widening (a restricted user's phone).
- Brief the seats with the LESSONS sections Step 0 lists.

## Release

Follow docs/RELEASING.md and AGENTS.md:
- the protected-main PR flow, dual-Node 22.23.1 + 24.20.0, the image smoke;
- a docs/releases.json entry and a ROADMAP entry;
- a LESSONS line if a wave taught one;
- close the plan out in the release PR with `node scripts/plan-complete.js <this plan> "Shipped v1.397.0" --apply`.

Dean authorizes the merge. After the tag's Publish run is green, the FileTube Root sends the iOS Root the tag and its commit.

## Not in scope

- Video, the native Downloads player, CarPlay, gapless playback.
- A browser sleep timer.
- Changing any progress rule.
- Anything else goes to ROADMAP Planned.

## Device checks (after the iOS app build that pins this tag; add to docs/DEVICE-CHECKS.md)

- (a) Play an album, lock the phone, pause and resume from the lock screen and AirPods.
- (b) Start a voice memo or call mid-song: FileTube yields, then resumes or stays paused as iOS decides.
- (c) Pause FileTube: another app's audio is no longer ducked.
- (d) Loop chapter on a chaptered file.
- (e) Podcast at 1.5x.
- (f) A 15 min sleep timer fires while locked.
- (g) Radio keeps going for 10+ songs while locked.
- (h) A downloaded track plays from the phone (airplane mode).
- (i) An older app build (no `nativeAudio`) plays exactly as before.

## Evidence (builder fills)

### Step 0 (2026-10-28, Fable builder; line numbers at 09d0cda6)

- **Census: every `player.load` caller, and whether it carries `type: 'audio'`.**
  - music.js:4611 `loadTrack` - always audio (`resumeMode: 'music'`; native tracks, library audio, chapter rows `<id>::c<n>`). NATIVE.
  - podcasts.js:1139 `playAt` - always audio (`resumeMode: 'podcast'`). NATIVE.
  - feed.js:1327 (song cards) and feed.js:2380 (every card kind; podcast cards are audio) - the Feed plays a SLICE of a song and binds its
    own end-at listeners on the element (feed.js:1328, 2381-2400) and its podcast route `/api/feed/progress/podcast` is not in the contract's
    `progress.route` enum. A seam the plan did not name: the Feed stays on the web element (a screen-on, swipe-driven surface), and a Feed
    load while native holds a queue posts `audio.stop`. Recorded in ROADMAP Planned as an unasked follow-up.
  - read.js:282 `loadReaderAudio` - a book's synthesized audio (`/book/:id/tts/...`, a synthetic id, `suppressProgress`). Not music or a
    podcast (D2): stays on the web element; stops native.
  - watch.js:1622 / 1664 / 1801 (a library item; `mediaData.type` can be `'audio'` when a library audio file is opened on the watch page,
    watch.js:2574) and watch.js:4345 / 4765 (TV episodes). Not the Music surface: stay on the web element; stop native.
  - The rule the adapter applies (W3): native claims a load only when `host.has('nativeAudio')`, `data.type === 'audio'` AND the caller
    supplies the whole queue (`data.nativeQueue()`, the `playedSec` function-on-data precedent), which only music.js and podcasts.js do.
    Every other load (audio or video) while native holds a queue posts `audio.stop` first. No host or no capability: byte-identical (D10).
- **Census: direct media-element reads on the audio path** (`.currentTime|.paused|.duration|.playbackRate|.ended|.buffered|.readyState`):
  player.js 87 (incl. video-only paths; the audio-relevant ones: `updateSeekVisual` 7379 / `fillTick` 7393 / `startFillLoop` 7412,
  `updatePlayPauseUI` 7082, `togglePlayPause` 7090, `playActiveMedia` / `pauseActiveMedia` / `seekActiveMedia` 3513-3556,
  `currentAbsTime` 3106, `getRemoteSnapshot` 10937, `getCurrentTime` 10962, `saveProgressToServer` 6535, the chapter loop 7006-7034,
  `applyPlaybackRate` 7479, `setupMediaSession` 3346 + `updatePositionState`); music.js 16 (all through `hostCtl('media-player')`:
  1046, 1328 playCountTick, 1899-1942 buildSkinCtx, 2160-2186 chapter watcher, 2271-2294 enforceChapterLoop, 2345-2347 enforceChapterExit,
  2420 ended rewind hold, 4643-4645 seekAdoptedChapter, 5581-5583 enforceFlatSegmentEnd); podcasts.js 3 (260-265 podcastSkinCtx, a raw
  getElementById - and the raw `hostCtl` at podcasts.js:277); remote.js 1 (the Listen Control target, `MEDIA_EVENTS` 134 + reads in
  createTarget); skin-surface.js 19 `hostCtl(...)` reads (2319-4093; `applyStickerSpeed` 2377 WRITES `playbackRate` + `defaultPlaybackRate`
  there, `liveRate` 2404 reads it); feed.js 7 (the Feed stays web). Element LISTENERS that the proxy's synthetic events must reach:
  player.js 7983-8175 + 8108-8160, music.js `ensureSkinReflect` 2119 + 1328, podcasts.js 362, remote.js 134.
  Design consequence (W3): the proxy IS the shared element - native-audio.js installs own-property accessors on the `#media-player`
  INSTANCE (currentTime, duration, paused, ended, playbackRate, play, pause, ...) while native owns the load and removes them on hand-back,
  so every reader above and every listener works unchanged (one seam, no 100-site sweep); the stand-down items get an explicit guard each.
- **Census: every URL logger / echo (for `mt`).** server.js:3261 `[audit] ... ${req.originalUrl}` (mutating methods only, so a GET never
  reaches it; still redacted: a POST carrying `?mt=` is refused AND logged); lib/auth/gate.js:394 `loginTarget(req.originalUrl)` echoes the
  full query into a `Location: /login?next=...` for an HTML-accepting denial (so a denied `mt` request must never redirect: JSON 401);
  Express's finalhandler prints only the pathname; there is no morgan / request logger; the `console.error('Error in GET ...', err)` sites
  (lib/offline/routes.js:425, 429 and siblings) print the error, never the URL. Client side: none.
- **Other seams the census found (added to the plan, not skipped):** (1) a library audio track's art is `/thumbnail/<id>` on the web
  (music.js:1927, server.js:4301 "served via /albumart/:id -> thumbnail fallback"): the adapter builds `artworkSrc` as `/albumart/<id>`
  so the two `mt` art routes cover every Item; (2) a chapter Item's file duration is not on the row - the proxy derives it as the largest
  `clip.endSec` among the queue's Items sharing the same `src` (the last chapter ends at the file end, libraryAudio.js:206-215);
  (3) the server Up-next queue entry shape for D12: `{ uid, mediaId, kind: 'media'|'podcast'|'track', item? }` (player.js:1597
  computeQueueNext, common.js:4856 queueEntryHref) - only audio-kind entries after the pointer are flattened, and the web posts
  `/api/queue/pointer` when native reaches one; (4) `resolveOfflineLocalSrc` (player.js:1129) is skipped under native (D9: native plays
  its own copy); (5) music.js's own radio extension `maybeExtendQueueForAutoplay` (4947) stands down too (native fetches radio), and
  the web mirrors native's appended picks from each `audioState.queue`.
- **Step 0 offline-file-route measurements** (scratchpad `measure-offline-route.js`, Node 22.23.1, this box, 7 runs per cell, median
  time to the first body byte in ms; a 209715200 B `.flac` native track and a 62914560 B podcast `.mp3`, random bytes; cookie session):

  | route | cold GET | Range mid-file (`bytes=<half>-`) | suffix `bytes=-1048576` | statuses | Accept-Ranges / ETag / Cache-Control |
  |---|---|---|---|---|---|
  | `/track/:id` (web) | 1.8 | 3.0 | 2.6 (416) | 200/206/416 | - / no / - |
  | `/api/offline/file/track/:id` | 2.2 | 2.6 | 2.6 (206) | 200/206/206 | bytes / yes / private, no-store |
  | `/episode/:id` (web) | 1.3 | 2.2 | 1.9 (416) | 200/206/416 | - / no / - |
  | `/api/offline/file/podcastEpisode/:id` | 1.8 | 2.0 | 2.1 (206) | 200/206/206 | bytes / yes / private, no-store |

  The offline route is within 0.5 ms of the web routes on a cold GET, faster on the mid-file Range, and answers a suffix Range (206)
  where `sendRangeable` refuses it (416). Not materially slower, no Range refused: the stop rule does not fire.
- **W3 / W4 as built (6d21a601):**
  - public/js/native-audio.js (new): `claim(el, id, data)` at player.js setupForMedia (the audio branch sets no src when it returns
    true; the video branch calls it too so a video load stops native); `itemFromDescriptor` maps the views' own load descriptors to
    Items (music.js `trackLoadData`, podcasts.js `episodeLoadData`, each supplying `data.nativeQueue()` = the whole queue as the
    same descriptors); the proxy is the `#media-player` INSTANCE (own-property accessors installed on claim, removed on release);
    `audio.load` goes out with `autoplay: false` and the web's own resume logic (handleResumePlayback: the progress read, then
    seek + play) drives `audio.seek` / `audio.play` through the proxy, so the browser's resume rules apply unchanged; a load of
    an item native already plays is a FOLLOW (no post), a different row of the same queue an `audio.jump`, anything else a new
    `audio.load` (rev + 1); `syncQueue` (D17) re-sends on a queue-order change at the latest tick; `modesChanged` posts
    `audio.setModes` only when a load did not already carry them; the server Up-next queue is flattened after each load (D12)
    and `/api/queue/pointer` posted when native reaches one of its entries; an idle native (its engine lost the queue) is re-sent
    on the next play; the position between ticks is extrapolated at the rate while playing (the dock's rAF fill loop and the
    skins read 60 times a second).
  - Stand-downs, each guarded on `nativeActive()` / `nativeOn()`: player.js saveProgressToServer, setupMediaSession (+
    clearMediaSessionForNative: metadata null, playbackState none, every action handler null), setMediaSessionAction,
    setPlaybackState, updatePositionState, runEndedCompletionCascade, enforceChapterLoop; music.js enforceChapterLoop,
    enforceChapterExit, enforceFlatSegmentEnd, maybeExtendQueueForAutoplay, primeSoloExitStation, playCountBegin /
    playCountTick, the ALAC prewarm (`needsTranscode && !nativeApi()`). `/api/music/resume` stays a web post.
  - The plan's "add podcasts' hostCtl hook": satisfied by design rather than a hook - podcasts.js reads the element by id and
    the element IS the proxy, so its reads (260-265) and its skin reflect listeners (362) route through native with no change.
  - D13: skin-surface.js Sleep tile + strip (Off / 15 / 30 / 45 / 60 min / End of track) only while native owns playback.
  - Tests (W4): test/unit/native-audio-contract.test.js (the red test, now green, 3), native-audio-web.test.js (the fake-host
    harness through the real player + music view + skin engine: the load, snapshots -> proxy / dock / scrubber / remote snapshot,
    every stand-down silent + close(), follow / jump / radio mirror, D17 shuffle re-send + stale rev, intents + idle re-send +
    a video load, chapter clips + the chapter loop silent, D10 no host, an older app build: 9), native-audio-items.test.js (5),
    native-audio-sticker-sleep.test.js (2), native-bridge-audio.test.js (6), media-token unit (5) + integration (8), the scope
    census (4), device-tokens (8), auth-gate-devices, offline-progress.
- **Red-first test:** test/unit/native-audio-contract.test.js at 09d0cda6 + this plan: `not ok 1 - RED FIRST: a host announcing
  nativeAudio gets audio.load with the whole queue and the element gets NO src` (`the adapter knows the capability: false !== true`);
  `ok 2 - CONTROL: no host ...` and `ok 3 - CONTROL: a host WITHOUT nativeAudio ...` (1 fail, 2 pass; the file is committed with W1).
- Contract relay (sha): W1 71188ea7 sent to the FileTube Root 2026-10-28 (relayed to the SANDYJAR iOS Dev Root, the media-token shape marked provisional); W2 (the token's final shape, D14-D16) sent with the W2 sha below.
- **Mutant round (W4, a /tmp git-archive sandbox of 6d21a601 + the two test files of the next commit; scratchpad mutants.js, 26
  mutants, each run against the tests that claim to bind it):** 25 killed by name, 1 SURVIVED and documented as MASKED - M13
  (lib/auth/gate.js mediaAuth `row.epoch !== parsed.de` removed) is covered by the user-epoch check on the next line
  (`user.deviceEpoch !== parsed.de`; a row is stamped with the user's epoch at issue, so the two agree on every real token);
  M13d (BOTH epoch checks removed) is killed 5 tests red (the password-change case, rows present, epoch behind). Killed: M1
  saveProgressToServer guard, M2 setupMediaSession guard, M3 setMediaSessionAction null (round 1 survived: the clear at the
  next setup masked it; a mid-load assertion on the prev / next handlers now kills it), M6 music enforceChapterLoop, M7
  maybeExtendQueueForAutoplay, M8 both play-tally guards (each alone is masked by the other: begin ends the tally, tick
  releases it), M9 the audio branch always sets src (the red-first test), M10 stale rev accepted, M11 syncQueue always
  re-sends, M12 media scope check, M13b expiry, M13c devices.track (the mid-stream test), M14 the mint's cookie refusal,
  M15 the mint limiter (round 1: an ambiguous anchor - the pairing route has the same line; re-anchored, killed), M16 media
  key = raw secret (D18), M17 audit redaction, M18 the Sleep tile without the api, M19 registerTrackNav syncQueue, M20 the
  video branch no longer stops native, M21 the adapter capability dropped, M22 close() no longer releases, M23 a clip seek
  posted file-absolute, M24 radio dropped from DEVICE_SCOPE, M25 D14 expired answers deviceRevoked. Equivalent (not run,
  documented): the player's runEndedCompletionCascade and enforceChapterLoop guards - the proxy never dispatches 'ended' and
  no music row arms the dock's chapterLoop, so neither path runs under native (the guards are defence in depth).
- **Node 22 full suite at 6d21a601 (before the census fix):** 13007 tests, 12990 pass, 4 fail, 13 skipped - 3 = the route
  censuses for the new POST /api/devices/media-token (rbac-census EXPECTED_ROUTE_COUNT 320 -> 321, route-write-classification
  CLASSIFICATION + VISIBILITY 'personal'; fixed in the next commit), 1 = test/unit/pocket-skins-menu.test.js "Cider and Nordic
  rows never preview" (`'Nordic' !== 'Search'`; 19 / 19 alone, twice in the sticker batch: a load flake under the full suite,
  not in the known-flakes list yet).
- **Node 24.20.0 full suite at 6d21a601 + the census fix:** 13007 tests, 12997 pass, 0 fail, 10 skipped (548.8 s).
- **Suites before the gate (the tree of the next commit):** Node 22.23.1 `npm test`: 13007 tests, 12997 pass, 0 fail, 10 skipped (532.2 s); Node 24.20.0 `npm test`: 13007 tests, 12997 pass, 0 fail, 10 skipped (548.8 s).
- Suites at release (22.23.1 / 24.20.0):
- Gate verdicts:
  - Gate: APPROVED r1 @d87a8c98 - security-brief
    - Could NOT run (no Bash on this seat): the suites, the mutant sandbox, `git diff`. "Verified" below = the exact path traced in the working tree at d87a8c98 (git status clean), plus the committed tests read as written.
    - Verified (D7 scope): gate.js:468-469 reads `req.query.mt` (any presence, string or not, incl. `mt=`, `mt[]=`) and returns from mediaAuth in EVERY branch (405-427), ahead of the Bearer branch, the allowlist, the zero-users funnel, the cookie, the renewal (Set-Cookie) and deny()/loginTarget (no redirect ever carries the token). mediaScopeAllows (device-scope.js:104-112) is GET/HEAD only, case-sensitive, no trailing slash, `[^/]+` per segment, so it is a strict SUBSET of Express's case-insensitive, trailing-slash-tolerant route match: `//albumart/x`, `/ALBUMART/x`, `/albumart/x/`, `/api/offline/file/TRACK/x`, `/api/offline/file/tr%61ck/x`, `/api/offline/file/video/x` are all 401 at the gate; an encoded `%2F` inside the id stays one segment for the gate and is refused by the route's own validId. The query is never part of req.path. Nothing is mounted ahead of the three routes (no app.use/app.all on those prefixes). The track resolver (offline/routes.js:201-219) only reaches the music projection (native tracks, library AUDIO, chapter bases), so a video id cannot ride `/track/`.
    - Verified (token): media-token.js parse = canonical charset + 43-char mac gate before timingSafeEqual (equal byte lengths by construction), JSON claims integer-checked, never throws; D18 key = HMAC(secret, 'filetube media token v1') on both sign and parse while verifySession uses the raw secret (crypto.js:137,160), so neither credential verifies as the other (unit test binds it with the raw-key control). uid/did/de all re-checked against the row AND the user (gate.js:418-420); a token naming another user's device fails `row.userId !== parsed.uid`; a restore cascades device_tokens (sqlite.js:1511, PRAGMA foreign_keys ON at 1707) and AUTOINCREMENT never reuses a did (store.js:2269-2272), so every pre-restore token is deviceRevoked for its remaining life. Live revocation registers the response under the device (gate.js:426; devices.js remove -> destroyAll).
    - Verified (D14/D15/D16): every unparseable mt answers the one `mediaTokenExpired` body and is counted per ip; a correctly signed token is never counted and is the only way to reach `deviceRevoked`, which needs our secret, so an outsider has no oracle. The mint is behind deviceAuth (platform ios, shortcut 401 by its own scope, cookie 403 at routes.js:291, mt 401 at the gate); the bucket key `device:<id>` exists only for a row deviceAuth accepted, so the limiter map is bounded by device rows.
    - Verified (redaction): the only URL loggers are server.js:3265 (redacted; mutating methods only, a GET with mt never reaches it) and gate.js:435/486 (deny/allowlist, both unreachable with mt present). No Referer logging anywhere; no `mt=` in any public/js file (only pdf.js vendor noise), so the web never puts the token in a URL.
    - INFO (D8, the exact posture): the widening is NOT a new exposure. /api/music/progress (music/routes.js:614, no existence check), /api/progress (media/user-routes.js:73, existence only), /api/podcasts/progress (podcasts/index.js:1198, existence only) are reachable by the kid's browser session today with the same bodies; the device token sets req.user to the same row and every write is keyed by req.user.id, read back through visibility-filtered lists. /api/music/plays and /api/music/radio go through visibleMusicList. The pre-existing gap (own-progress / watched-latch / presence under a hidden id, visible only to that user) is out of this plan's scope ("Changing any progress rule"). SUGGESTION: a ROADMAP Planned line to route the two existence-only progress routes through visibility the way /api/offline/progress does (offline/routes.js:486-491).
    - SUGGESTION (latent, no exploit path today): `requireCookieSession` (lib/auth/routes.js:237-243) is a NEGATIVE check (`authVia === 'device'` -> 403, anything else treated as a cookie session), so an `authVia 'media'` request would pass it. Unreachable now because MEDIA_SCOPE holds three GET routes none of which call it and the gate's scope check runs first; it becomes a real hole the day MEDIA_SCOPE is widened onto a cookie-only route (a URL-borne token acting as a session). Make it positive (`req.authVia` set at all -> 403) or list 'media' explicitly.
    - INFO (lying-comment nit): gate.js:390-392 says the mt branch is "judged BEFORE every other credential"; the X-FileTube-Token branch (gate.js:450-465) runs first for POST /api/ytdlp/download, so a POST there carrying a valid header AND `?mt=` is authorised by the header with mt unconsulted (the audit line still redacts it). Not exploitable (the header is a strictly compared operator secret); reword the comment or move the mt check above that branch.
    - INFO: mediaAuth does not re-check `devices.isExpired(row)` (180 days unused). Harmless: a media token exists only if the mint ran under deviceAuth (expiry checked, last_used_at touched) within the last 6 h.
    - INFO (web half): host-adapter.js:281-291 accepts any window `filetube-host` CustomEvent with `v === 1` (no isTrusted check). Forging one needs same-origin script execution, which is already full account control through fetch; Pages' iframe is `sandbox` without allow-scripts / allow-same-origin (pages.js:507) and cannot dispatch on the parent. The /api/queue/pointer uid (native-audio.js:287) comes from the server's OWN /api/queue answer indexed by native's index (:395), never from the event, and the server 404s a uid outside the user's own queue (queue/routes.js:244-250). A forged snapshot can at most toast a fixed string, mirror junk Items into the view, or move the user's own pointer among their own entries.
    - INFO: any path with `mt` present (allowlisted ones included: `/login?mt=x`, `/api/host-info?mt=x`) answers JSON 401 before the allowlist. A nuisance link for that one request only; no state, no cookie, no redirect.
  - Gate: CHANGES r1 @d87a8c98 - qa
    - Instruments run on this tree (verbatim counts): `npm run lint` 0 errors, 6 pre-existing warnings (common.js no-unused-vars); `npm run lint:ui` OK (TOTAL 3142 = docs/ui-exceptions.json); `node scripts/overlay-containment-lint.js --enforce` clean (0 violations); targeted `node --test` per file: native-audio-contract 3/3, native-audio-items 5/5, native-audio-sticker-sleep 2/2, native-audio-web 9/9, native-bridge-audio 6/6, native-bridge-contract 21/21, media-token unit 5/5, auth-gate-devices 10/10, media-token integration 8/8, device-scope-census 4/4, device-tokens 8/8, offline-progress 13/13, route-write-classification 4/4, rbac-census 3/3, glyph-pool-script-order 4/4 = 105 tests, 105 pass, 0 fail. Full suites not rerun (the builder's 13007 / 12997 / 0 stands; no number here was inherited).
    - CRITICAL C1 (a Listen row goes silent under native): a VIDEO played as audio in Music (watch.js:4004 `/music?play=<id>&listen=1` -> music.js:5847 playListenItem -> `queue = chapterTracks || [t]` -> playAt -> loadTrack) gets a `nativeQueue` provider like any row (music.js:4595 drops only `radioSeed` for `item.listen`), so claim() takes it and itemFromDescriptor (native-audio.js:67-93) builds `src: /api/offline/file/track/<videoId>`. resolveTrack (lib/offline/routes.js:201-219) reaches only the music projection, which holds `type === 'audio'` items (lib/music/libraryAudio.js:30), never a video. MEASURED on this tree (scratchpad qa-listen-proof.js, the app booted as media-token.test.js does, a seeded `vid` type video with two chapters, cookie session): `/video/vid -> 200`, `/api/offline/file/track/vid -> 404 {"error":"not found"}`, `/api/offline/file/video/vid -> 200`. Outcome in the app: the element has no src (claim returned true), native answers `audioError notOnServer` per item, the web toasts "Not on the server yet" and nothing plays; a chaptered listen video fails every chapter and ends `failed`. Today's web path plays it. D2 says video stays on the web player; the plan's census never named the listen row and no test loads one (`grep listen test/unit/native-audio-web.test.js` = 0). Fix: carry `listen: !!item.listen` on the descriptor and make itemFromDescriptor return null for it (readProvider then refuses the WHOLE load, claim() returns false and posts audio.stop, the web element plays as before), or leave `nativeQueue` undefined when `item.listen`; add the web test (a listen load with the fake host: src = `/video/<id>`, audio.stop if native owned, nothing else posted) and a note in native-bridge.md section 3 that a Listen row stays on the web.
    - WARNING W1 (D12 flattening reads a hand-typed /api/queue shape): itemFromQueueEntry (native-audio.js:95-109) reads `it.artist`, `it.album`, `it.artId` for a track entry and `it.showName || it.subtitle`, `it.subId` for a podcast entry. The server's shapedQueue (lib/queue/routes.js:81-120) emits `item: { title, name, channelName, folderName, artUrl, durationSec, hasThumbnail }` for BOTH kinds: none of the read fields exist. Scenario: Up-next = [song S (pointer), episode E]; S plays natively; flattenServerQueue sends E with `artist: ''` and `artworkSrc: undefined` (the lock screen shows an episode with no show and no art); a flattened track gets artist '' and album ''. The unit fixture (native-audio-items.test.js:35-37) hand-types artist/album/artId/showName/subId and the web harness's fake `/api/queue` answers `{ entries: [], pointerUid: null }` (native-audio-web.test.js:53), so the whole D12 path (pointer match, mapping, the rev+1 re-send, the pointer POST) never runs against the real shape (LESSONS 2: drive the server-emitted shape). Fix: read `channelName` (artist / show), `folderName` (album), pass `artUrl` through when it matches `^/(albumart|podcastart)/`, `durationSec`; fixtures copied from shapedQueue's literal; one web test with a real-shaped /api/queue answer that asserts the re-sent Items and the pointer POST.
    - WARNING W2 (a cross-kind Up-next entry has no owner in the web): flattenServerQueue appends every audio-kind entry after the pointer, but music.js rowFromNativeItem returns null for `podcastEpisode` (music.js:1832) and podcasts.js onAppend ignores everything (podcasts.js:161), so native holds Items no view lists. Scenario: Up-next = [song S (pointer), episode E]; the flatten re-sends [S, E] (rev+1); native reaches E -> onState -> onIndex(1, E) -> music's onIndex finds no row and returns (music.js:1499); the dock, now-playing and every skin keep S's title and art while E's audio plays (the lock screen is right, the in-app player is wrong), and the pointer POST has already moved to E. Today the web's ended cascade navigates to `/podcasts?play=E` (player.js:6791 advanceIntoQueueEntry, common.js:4860), and that cascade is guarded off under native, so nothing corrects it until a tap. ROADMAP follow-up (2) names the web-view-reload case, not this one. Fix: flatten only the entries the bound view can mirror (track / audio media for music, podcast for podcasts) and leave cross-kind entries to a later adopt, or make native-audio.js adopt an unowned index by a player.load of a descriptor built from the Item; a test with a mixed-kind /api/queue either way.
    - SUGGESTION S1 (a comment names a file that does not exist): native-audio.js:2 and player.js:1129 cite docs/exec-plans/completed/2026-10-28-native-audio.md (the backticks around this path were removed by the builder so the docs-link census, which reads backtick paths in living docs, does not fail on a seat quoting the stale one; the words are the seat's) while the plan sits in active/ (host-adapter.js:41, ios-host.md:108 and the four test headers say active/). Whichever path is chosen, the two sets disagree and one is wrong at any moment; plan-complete.js moves the file but rewrites no references.
    - SUGGESTION S2 (comment accuracy; the security-brief's INFO, concurred): gate.js:390 "judged BEFORE every other credential" and offline-api.md:240 "whatever else it carries" are not literally true for POST /api/ytdlp/download with a valid X-FileTube-Token header (gate.js:450-465 runs first; mt unconsulted, still redacted in the audit line). No exposure; reword or move the mt check above that branch.
    - SUGGESTION S3 (a number not copied from the instrument): the Evidence line "device-tokens (9)" (plan line 308); `node --test test/integration/device-tokens.test.js` prints `# tests 8`.
    - SUGGESTION S4 (wording): ROADMAP.md:449 "(3) Radio picks native appends are mirrored" reads as a sentence fragment; "The radio picks native appends are mirrored" or "Radio picks that native appends are mirrored".
    - Suspicions (no wrong outcome built, not findings): (a) sendLoad (native-audio.js:349) and the jump path (:436) pre-set `seenItemKey`, so the first audioState of a new load fires no `loadedmetadata` / `durationchange`; readers poll the proxy's `duration` live so the number is right, but player.js:8252-8253's event-driven buildSeekChapters runs only from claim()'s synchronous `durationchange` (duration from the Item, not the snapshot); (b) the idle re-send (native-audio.js:208) is reachable only when native reports idle at the CURRENT rev; a restarted engine's rev-0 snapshot is dropped by the stale-rev rule and the proxy keeps extrapolating "playing" with no ticks - a question for the iOS half (does a restarted engine echo the last rev?).
    - Verified against the tree: trackLoadData carries every field of the old loadTrack literal (diffed 8474caa2:music.js:4503-4560 against the builder; adds id, radioSeed, nativeQueue; chapterResumeSec / startPaused gated on !forQueue only, forQueue is false on the load path); episodeLoadData is the old literal plus id and nativeQueue; player.js never serialises `data` (no JSON.stringify / postMessage / structuredClone of data or currentData), so the function-valued nativeQueue is inert in browsers. enforceFlatSegmentEnd's `return true` under native is reached only from enforceChapterExit (music.js:2377), which returns on nativeOn() first; nativeOn() is false in every browser (D10). The plan's "add podcasts' hostCtl hook" is honestly superseded: podcasts.js reads the `#media-player` INSTANCE, which carries the proxy's own-property accessors. native-audio.js sits on exactly the ten signed-in shells right after offline.js and on neither login.html nor welcome.html, so its absence from ALLOW_EXACT is right. The two re-targeted scope tests (device-tokens:72, auth-gate-devices:178 -> POST /api/music/resume) and offline-progress:96-99 (200 on /api/progress, 403 on /api/music/resume) are honest. native-bridge.md sections 2, 3, 5, 6 match host-adapter MESSAGES / EVENTS (the conformance test, 21/21); offline-api.md section 8's bodies and codes match gate.js mediaAuth and routes.js's mint; ios-host.md's "eight to nine" matches CAPABILITIES. No em dash in any added line (scanned the whole diff).
    - Security surface (standing section): a new URL-borne credential plus an allowlist widening, so there IS a surface. Checked: mediaAuth runs before the Bearer branch, the allowlist, the zero-users funnel, the cookie and the renewal, and returns in every branch (no redirect, no Set-Cookie); mediaScopeAllows is GET / HEAD on the three routes with the file kind limited to track / podcastEpisode; expired and never-existed share one body (D14); the HMAC key is derived (D18, bound both ways by the unit test); redaction is wired at the one URL logger (server.js:3265) and bound by the integration test; the mint is behind deviceAuth, ios only, 403 to a cookie, 429 past 6 a minute per device; req.user is set from the row so restrictions apply (8/8 integration tests). No injection: `mt` is only prefix-checked, charset-checked and HMAC-compared; the pointer uid the web posts comes from the server's own /api/queue answer. No finding beyond S2; the security-brief's requireCookieSession suggestion is sound.
    - Tree after this write: `git status --porcelain` shows only ` M docs/exec-plans/active/2026-10-28-native-audio.md` (the security-brief's block, uncommitted before I started, plus this one) and the untracked tools/capture/node_modules copy; nothing else touched. The proof script lives in the session scratchpad, not the project.
  - Gate: CHANGES r1 @d87a8c98 - adversary
    - Instruments (verbatim, this tree / a git-archive sandbox of d87a8c98 with the worktree's node_modules symlinked): targeted `node --test test/unit/native-audio-*.test.js test/unit/native-bridge-audio.test.js test/unit/media-token.test.js test/integration/media-token.test.js test/integration/device-scope-census.test.js` = 42 tests, 42 pass, 0 fail. `npm run lint` = 0 errors, 6 warnings (all common.js no-unused-vars; common.js is not in the diff). `npm run test:unit` (Node 22.23.1, sandbox) = 10191 tests, 10180 pass, 9 fail, 2 skipped: 8 are tree scanners (app-settings-store, comment-debt-census, dbjson-never-read, media-items-store, media-record-stores, media-trash-store, media-view-counts-store) that need `.git`; re-run in the worktree = 69 tests, 69 pass, 0 fail; the 9th is pocket-skins-menu "Cider and Nordic rows never preview", the load flake the Evidence already names. The builder's 26 mutants re-run in my sandbox: 25 killed, M13 survived (as documented, masked by the user-epoch check). My own 33 mutants (scratchpad adv-mutants.js, adv-mutants.log): 9 killed (A11 any method, A12 kind check, A18 adapter-side stop, A20 handler clear, A22 follow, A23 D17 position, A27 music onIndex, A31 redaction, A33 /api/music/resume widening), 24 survived - classified below. Probes: scratchpad adv-probe-cases.js (P1-P6, the fake-host realm of native-audio-web.test.js) and the media-token harness + one test (P7); the sandbox was byte-compared to the worktree after every run (identical).
    - CRITICAL C1 (concur with QA's C1; measured independently): a Listen queue (a chaptered VIDEO in Music's clothes, music.js:540 `listen: true`, source 'library-chapter', streamSrc /video/<id>) is claimed by native. P3: the realm with the CHAPTERS fixture + `listen: true` posts ONE audio.load with `src: /api/offline/file/track/f` for both rows and the element has no src. P7 (the media-token harness, the kid's cookie AND a minted mt): `GET /api/offline/file/track/vid` -> 404 {"error":"not found"}, `/api/offline/file/track/vid::c0` -> 404, control `/api/offline/file/track/aud` -> 200 LIBRARY-AUDIO-BYTES. resolveTrack (lib/offline/routes.js:201) reaches only the audio projection (lib/music/libraryAudio.js:30 `it.type !== 'audio'` -> skipped). Nothing plays where the browser plays /video/<id>. itemFromDescriptor (native-audio.js:67-93) has no way to see `listen` (trackLoadData music.js:4594 drops only radioSeed for it). Fix as QA prescribes: carry `listen` on the descriptor, return null from itemFromDescriptor (the whole load stays on the web, claim() posts audio.stop), one web test with a listen load.
    - WARNING W-A (a terminal pagehide PAUSES native; nothing adopts on the next page; the contract says the opposite): native-bridge.md:159 promises "audio keeps playing across a navigation and the next page re-subscribes and adopts the snapshot". P1 measured on the realm, native playing (snap positionSec 30): `window.dispatchEvent(pagehide, persisted=false)` -> posts `["audio.unsubscribe","audio.pause"]`, the proxy reads paused. Path: player.js:5229 handleBackgroundLifecycle('pagehide') -> shouldReleaseForLifecycleEvent (:353, persisted === false) -> releaseAudioSession (:3801) -> pauseSuppressingHandoff(mediaPlayer) (:3794) -> the proxied pause (native-audio.js:219) which is NOT inside the beginLoad window, so it posts. P1b (persisted=true) posts only audio.unsubscribe; P1c (visibilitychange hidden, the lock) posts nothing - correct. The second half: no code outside native-audio.js reads `snapshot()` / `currentItem()` (grep public/js = 0), and onState with `!ownedId` (native-audio.js:274) only notify()s, so a fresh page never adopts: after a deep link / widget / reload the dock is empty while native plays, or (today) native is paused on the way out. Either make lifecycle-driven pauses (releaseAudioSession, pauseSuppressingHandoff) not an intent under native and define the adoption, or change native-bridge.md:159 before the iOS half builds against it - the iOS Root reads that line as the contract.
    - WARNING W-B (the web view's MediaSession transport handlers never come back after a native session): player.js:3585-3600 registers play / pause / seekto / seekbackward / seekforward ONCE at init; clearMediaSessionForNative (:10073) nulls them on the first native load; nothing re-registers them (setupMediaSession :3358 sets only metadata; setTrackNav :3688 only prev / next). P2 measured: native plays, then `player.load('v1', { type: 'video' }, { dock: true })` -> native.active() false, src /video/v1, msActions after the video load = only previoustrack/nexttrack null; FINAL handler state {"play":null,"pause":null,"seekto":null,"seekbackward":null,"seekforward":null,...}. P2b CONTROL (no host, same loads): {"play":"function","pause":"function","seekto":"function","seekbackward":"function","seekforward":"function"}. In the app, after one native music session every web-element load (a video, the Feed, the reader, a watch-page item) has a lock screen / Control Center with dead transport until a page reload. Fix: re-register the five in setupMediaSession when !nativeActive() (or on release()), and assert them in the video-load test (mutant A20's test only checks the clear, not the restore).
    - WARNING W-C (W4's "a binding test per stand-down item" is not met - each survivor below is a guard whose removal keeps every test green; the mechanism each guard stops is real): A4 player.js:3340 setPlaybackState (the proxy's play/pause events reach it: without the guard the web view's Now Playing writes playbackState 'playing' beside native's card); A5 :3346 updatePositionState (timeupdate -> setPositionState); A1 music.js:2376 enforceChapterExit and A2 :5668 enforceFlatSegmentEnd (they mask each other like M8; neither is bound alone); A3 :5034 primeSoloExitStation (a solo chapter tap under native would fetch /api/music/radio - the stand-down test has no chapter solo tap); A9 player.js:10928 nativeAudioBeginLoad() and A19 native-audio.js:219 the `transitioning` check in proxyPause - with either gone, EVERY follow / jump's teardownMediaState pause posts `audio.pause` to native (the FOLLOW test asserts no audio.load / audio.jump but not no audio.pause); A17 native-audio.js:26 PROXY_PROPS minus 'play' - detach leaves the proxy's play on the element, so after a hand-back `mediaPlayer.play()` returns a resolved promise and the web element never plays again (the video-load test does not check the accessors are gone; P2 shows the committed code removes all 11); A25 podcasts.js:1136 `nativeQueue` renamed and A26 podcasts.js:160 the follow removed survive 17/17 and 12/12 - the podcasts half (episodeLoadData's provider, bindView onIndex) has NO test with the fake host (grep test/unit for podcasts.js + nativeAudio = 0), so D2's "and podcasts" is unproven on this tree. Each mutant is the repro; add the assertions (no playbackState / setPositionState writes, no audio.pause on a follow, the accessors gone after a video load, a podcasts realm with one follow).
    - WARNING W-D (concur with QA W1 / W2, one measurement to add): P4 with a REAL-shaped /api/queue answer (entries [track t2 = pointer, media audio m9, media video v1, podcast p1]) sends THREE audio.loads: rev 1 [t1,t2,t3], rev 2 [t1,t2,t3,m9] (syncQueue, fired by flattenServerQueue's own view.onAppend -> appendNativeItems -> registerTrackNav -> nativeSyncQueue, music.js:4759 / 4754), then rev 3 [t1,t2,t3,m9,p1] from native-audio.js:393 (`list = ... : all` - the Items the view REJECTED ride along). rev 2 is redundant; rev 3 hands native a podcastEpisode the Music view does not hold (rowFromNativeItem music.js:1830 returns null for it), the desync QA's W2 describes. The flatten should post once, only the Items the bound view accepted (q2.items), after the view has them.
    - SUGGESTION S-A (a pre-jump snapshot is followed back): P5 - Next posts audio.jump {index 2} (+ the resume's audio.play); a same-rev audioState for the OLD index (index 1, positionSec 41) arriving after the jump is accepted, onIndex follows it, the web re-loads t2 (player.currentId t2, proxy 41 s, another audio.play, a POST /api/music/resume for the wrong row) until native's next audioState. rev changes only on a load, so a jump has no sequence to drop in-flight snapshots against. Native is the authority by contract and heals it within a snapshot, so a suggestion: give audio.jump a sequence (or bump rev) and drop snapshots that predate it.
    - SUGGESTION S-B (other survivors, each a test gap on a working guard): A8 native-audio.js:299 a stale-rev audioTick moves the position (one tick, transient); A16 :161 the clip clamp (the chapter test's ticks arrive too fast to extrapolate; P6 shows the clamp holds: 99/100 + 1.3 s reads 100); A21 :419 an idle snapshot counted fresh; A24 music.js:5249 the ALAC prewarm under native (no needsTranscode fixture); A30 native-audio.js:483 setSleep('minutes', 15) posting mode 'off' passes the sticker test ("a pick posts the intent" does not check the minutes); A10 gate.js:468 the array form (`?mt=a&mt=b` -> '' -> refused on the committed code; no test, only `?mt=` is). A13 / A14 / A15 / A28 / A32 survived and are defence in depth (unreachable without the secret or behind deviceAuth) - not findings. A6 / A7 survived as the Evidence predicts (equivalent).
    - SUGGESTION S-C (concur with QA S1): native-audio.js:2 and player.js:1129 name docs/exec-plans/completed/2026-10-28-native-audio.md, which does not exist until plan-complete.js runs (the only MISSING path in a sweep of every repo path the diff names).
    - Verified and clean (no finding): the audio branch sets no src when claimed (player.js:10385-10386) and every other `mediaPlayer.src =` writer is video-only or live-mode (6244 pollTranscodeUntilReady: awaitingTranscode is set only in the video branch; 6655 startLiveStream: liveMode set only at 10430 and reset by teardown 9872 / close 10783; 10432 / 10441 the video branch); the bgAudioEl sidecar refuses audio loads (armBackgroundAudioSrc 3856 `currentData.type === 'audio'` -> false) and the keep-alive starts only from a successful video handoff (3997); shouldPauseForLifecycleEvent exempts audio (P1c: the lock posts nothing). mediaScopeAllows is a strict subset of Express's match (compile: `^...$`, case-sensitive, `[^/]+` per segment), so `/api/offline/file/video/x`, a trailing slash, `/API/...`, `%74rack` are all 401; `?mt=a&mt=b` and `?mt=` reach mediaAuth as '' (never the cookie); HEAD passes; mediaAuth sets req.user from the row (the kid's 404s in the integration test). D10: the inert api is returned when `host.has('nativeAudio')` is false (native-audio.js:113-124); the no-host and older-build realms set /track/t2 and post nothing; the descriptor's new fields (id, radioSeed, nativeQueue) are never serialised (QA verified the same). The proxy installs and removes exactly the 11 PROXY_PROPS (P2: 0 own props after the video load); no reader in public/js uses a prototype descriptor on the element. D17 holds (A23 killed). Position extrapolation clamps at the clip / file end (P6).
    - Tree after this write: `git status --porcelain` = ` M docs/exec-plans/active/2026-10-28-native-audio.md` (the security-brief's, QA's and this block) plus the untracked tools/capture/node_modules copy; the sandbox, probes, mutant scripts and logs live in the session scratchpad.

### Gate r1 fixes (the commit after d87a8c98; every finding above answered here)

- **qa C1 = adversary C1 (a Listen row claimed by native, nothing plays):** music.js `trackLoadData` carries `listen` and supplies
  no `nativeQueue` for a listen row; native-audio.js `itemFromDescriptor` returns null for `listen: true`, so the whole load stays on
  the web element (a video's audio through /video/:id as today) and stops native. Tests: native-audio-web "a Listen row", native-audio-items.
  native-bridge.md names what stays on the web.
- **adversary W-A (a terminal pagehide paused native; no adoption):** player.js `releaseAudioSession` returns under native (audio keeps
  playing across a navigation, as section 6 says); native-audio.js asks the bound view to ADOPT native's queue on the first live
  snapshot of a page with nothing loaded (once per rev; the web's rev counts up from native's), music.js `adopt` turns the Items
  into rows and loads the playing one as a FOLLOW; player.js `handleResumePlayback` skips the progress read / seek / autostart
  on a follow (`lastClaimFollowed`). Podcasts do not adopt (ROADMAP Planned (2), narrowed). Tests: "a TERMINAL pagehide",
  "adoption".
- **adversary W-B (web lock-screen transport dead after a native session):** the five transport handlers live in
  `registerMediaSessionTransport()`, registered at creation and again by `setupMediaSession` on the first web load after a native
  clear. Test: "W-B + W-C" (functions again after the video load).
- **adversary W-C (unbound stand-downs):** bound by tests - setPlaybackState / updatePositionState (no playbackState write, no
  setPositionState under native), the follow's teardown (no audio.pause), PROXY_PROPS (all eleven own while owned, none after
  the hand-back, the real play() back), enforceChapterExit + primeSoloExitStation (a solo chapter row tap: no jump at the clip
  end, no radio), the podcasts half (test/unit/native-audio-podcasts.test.js: the load, follow, jump, no host).
  enforceFlatSegmentEnd stays masked by enforceChapterExit's guard ahead of it (documented).
- **adversary W-D = qa W1 + W2 (three loads on the Up-next flattening; a hand-typed shape; a cross-kind entry):**
  `itemFromQueueEntry` reads the real shapedQueue fields (channelName, folderName, artUrl, durationSec); only entries of the
  playing Item's KIND are flattened; they are handed to the view, whose re-registration re-sends the queue ONCE
  (`syncQueue`); the uids are mapped on the queue native holds. Test: "the server Up-next queue in its REAL shape".
- **adversary S-A (a late same-rev snapshot after a jump followed back):** a jump fence - until a snapshot shows the jumped-to
  item (or 3 s pass), snapshots of another item are dropped. Test: in "FOLLOW".
- **adversary S-B:** tests for a stale tick, the idle-counted-fresh pick (a LOAD after a lost queue), setSleep's three shapes,
  the ALAC prewarm (no /track under native), the clip clamp, `?mt=a&mt=b`.
- **qa suspicion 1:** a load's / jump's FIRST snapshot fires loadedmetadata + durationchange (seenItemKey reset) and never asks
  the view to follow the item the web itself loaded. Test: "the FIRST snapshot of a load".
- **qa suspicion 2:** native's "I lost my queue" (rev 0, idle, empty) is the one older-rev snapshot the web accepts; the next
  play re-sends. Documented in native-bridge.md. Test: "rev 0 idle".
- **qa S1 / adversary S-C:** the two plan paths point at active/ (updated at close-out). **qa S2 / security INFO:** the mt branch
  now runs before the Shortcut's X-FileTube-Token branch too (test: mt + the header on POST /api/ytdlp/download is 401).
  **qa S3:** device-tokens (8). **qa S4:** the ROADMAP fragment reworded.
- **security-brief SUGGESTIONS:** `requireCookieSession` is a positive check (any `req.authVia` is 403); ROADMAP Planned (5)
  names the two existence-only progress routes.
