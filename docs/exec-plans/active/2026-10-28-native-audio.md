---
plan: native-audio
harness: v2 · full
branch: feat/v1.397.0-native-audio
anchor: spec
status: Approved - ready to build
next: builder - cut the branch from main, Step 0 (the seam census + measure the offline file route online), then W1
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

- Step 0 census:
- Step 0 offline-file-route measurements:
- Red-first test:
- Contract relay (sha):
- Suites (22.23.1 / 24.20.0):
- Gate verdicts:
