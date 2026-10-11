---
plan: offline-server
harness: v2 · full
branch: feat/v1.387.0-offline-server
anchor: spec
status: Draft
next: plan review r2 (the same adversary re-confirms the r1 fixes), then hand to an Extreme builder
design: docs/references/ios-offline.md (Dean's rulings 2026-10-11) + the iOS Root's contract asks and custom-scheme spike (2026-10-11, simulator iOS 27 + iPhone XS iOS 18). Base = d405012e (the speed pass's docs commit; merge main once v1.386.0 lands).
builder: extreme (a new credential at the auth gate, a schema migration, and writes to every kind's saved positions)
gate: pending
---

# v1.387.0: offline playback, the server half - a per-device token, the download manifest, offline position sync, the `downloads` contract and the web's offline buttons

Norms: no em dashes; stage by name; `git commit -F <file>`; never pipe a commit or push; fnm Node 22.23.1 PATH before any
node/npm/git command (local verification = Node 22); never `--no-verify`; never self-merge. A status report NEVER ends your turn.

Read first: AGENTS.md; docs/LESSONS.md 0, 1, 2, 9, 10, 11 (and 4, 5 for W5); docs/references/ios-offline.md (the design this
plan refines), ios-host.md, native-bridge.md + native-bridge.v1.schema.json; the shipped plans
docs/exec-plans/completed/2026-10-11-native-bridge-web.md and 2026-10-11-immersive-pocket.md (their evidence sections map
host-adapter.js, the owner registry and the pagehide / pageshow re-assert path).

## Step 0 (builder)
- Work ONLY in `.claude/worktrees/feat-v1.387.0-offline-server` (symlink node_modules + tools/capture/node_modules from main;
  never staged). When v1.386.0 merges, `git merge main` into this branch before W5.
- Stop and ask Dean (AskUserQuestion) when: a seam below cannot hold the shape; a browser (no host) behaviour would change; a
  rule here turns out to lose a saved position; the gate reaches round 3; `gh pr merge` is refused.

## 1. Outcome (Dean, 2026-10-11)
In the iOS app, Dean (or a family member on their own account) can mark music tracks and albums, podcast episodes, videos and
TV episodes or seasons for **offline playback**; the app downloads them and plays them with no network. Online, an item that is
on the phone plays in FileTube's own player from the phone's copy. Listening or watching offline still counts: positions and
"finished" sync back when the phone is online, and a newer position from another device is never overwritten. A restricted
(kid) account can only ever download what it can already see. Revoking a device in Settings stops it at once. Browsers and the
PWA see no change at all.

This plan is the SERVER and WEB half (sequence step 1 of ios-offline.md). The app half is the iOS Root's plan, written against
the contract this plan commits.

## 2. Corrections to the design, found while planning (record each as a dated note in ios-offline.md in W6)
1. **There is no shipped forward-only progress rule outside the Feed.** Every progress route (`/api/progress`,
   `/api/tv/progress`, `/api/music/progress`, `/api/podcasts/progress`, `/api/books/:id/progress`) is an unconditional upsert
   stamped with server time (lib/auth/store.js:63,161,220,244,273,290). The forward-only / stale-refusing rules live only in
   lib/feed/safe-progress.js and depend on the Feed's served-card registry. So offline sync gets its OWN rule (D4): **the newer
   moment wins**, by the time the position was reached on the phone, the pattern `POST /api/prefs` already ships
   (lib/user/routes.js:65-87, `WHERE excluded.updated_at > user_prefs.updated_at`). Not "forward-only": a deliberate rewind
   on the phone that is newer than the server's position is real intent and must win.
2. **A device token must set `req.user`.** The shared `FILETUBE_API_TOKEN` deliberately leaves `req.user` unset
   (lib/auth/gate.js:296-300), and a request with no `req.user` gets an EMPTY restriction index (server.js:1132,
   visibility.js:86 `isBlocked(null) === false`), i.e. sees everything. A device token copying that pattern would let a kid's
   phone download the whole library. D1 binds the token to the user row and the gate sets `req.user` from it.
3. **Downloads must be a file iOS can PLAY, decided by an iOS rule, not the browser's.** `?download=1` returns the original even
   when it needs a transcode (lib/media/streams.js:247-256, lib/tv/routes.js:520), and the server's existing `needsTranscode`
   is a BROWSER predicate: it transcodes ALAC to AAC 160k (server.js:3929, a permanent loss for a lossless offline copy) and
   flags HEVC because only h264 counts (server.js:2514), while iOS plays ALAC, FLAC and hvc1-tagged HEVC natively. D3 adds its
   own iOS playability rule (gate r1 W1).
4. **Words.** "Downloaded" already means "the server has the podcast file" (`ep.status === 'downloaded'`, podcasts.js:747), and
   "Save to device" is the browser `?download=1` save in 6+ menus. The new feature's words are built on **"offline playback"**
   (Dean, 2026-10-11): action "Make available offline", removal "Remove offline copy", badge "Offline", progress "Saving for
   offline... 40%", the menu entry that opens the app's screen "Offline". Never "Download" or "Save to device" for this
   feature. Podcasts' existing "full offline cache" wording (podcasts.js:1188) is about the server's copy: rename it to "Keep
   every episode on the server" so "offline" means one thing.
5. **"track" is three things** (gate r1 C3). Native music tracks (`/track/:id`, `trackVisibleTo`, the music progress store);
   library audio shown in Music (`source:'library'`, libraryAudio.js:158-164: bytes from `/video/:id`, gated by
   `mediaVisibleTo` music/routes.js:197, progress through `/api/progress` into the media store server.js:4341-4346); and chapter
   rows `<id>::c<n>`. Every offline route resolves a `track` id to one of the three first, and the two library forms use the
   MEDIA gate, bytes and progress path (a `{kind:'folder'}` restriction binds only through `mediaVisibleTo`, visibility.js:66-68).

## 3. Design

### D1 Per-device tokens (server, auth)
- **Table** `device_tokens` (SCHEMA_VERSION 36 -> 37, an appended `if (current < 37)` block in lib/db/sqlite.js after the v36
  block, the literal CREATE TABLE the docs-diagrams census parses, a comment paragraph by :208):
  `id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT
  NULL UNIQUE, name TEXT NOT NULL, platform TEXT NOT NULL, epoch INTEGER NOT NULL, created_at TEXT NOT NULL, last_used_at
  TEXT`, plus a new column `users.device_epoch INTEGER NOT NULL DEFAULT 0` in the same block. Statements in a sibling store
  module (lib/auth/devices.js) taking `adapter.sql`.
- **Devices have their OWN epoch, not `token_version`** (gate r1 W8): `token_version` is also bumped by the login re-hash
  (`updatePassword` from auth/routes.js:115-116, store.js:52) and by re-enabling a user (store.js:53), so binding to it would
  unpair every phone on a hash-cost release. `device_epoch` is bumped ONLY by: a password change the user or an admin makes
  (not the login re-hash; split the code path so the re-hash cannot reach the bump, and test it), an admin's "Remove all
  devices", and nothing else. Disabled is checked live on every request; a restore drops the rows by cascade.
- **The token**: `ftd_` + `authCrypto.generateSecret()` (the prefix lets the secret-scan and a log reader recognise it).
  Stored as sha256 only; compared via the hash lookup (the UNIQUE index) then `tokensEqual` on the hash. Shown once, at issue.
- **Issue**: `POST /api/devices` `{ name, platform, password }` -> `201 { id, token, name, platform, createdAt }`. Accepted
  ONLY from a cookie session (refused 403 when the request itself came in on a device token: a token never mints a token), AND
  only with the account's password, verified like login (scrypt, the login rate bucket, the dummy-hash timing guard) (gate r1
  W7: a session cookie alone, e.g. stolen by any script injection, must not mint a credential that outlives logout). The app
  asks for the password in a NATIVE prompt and posts it with the web view's cookies; it never crosses the JS bridge. Requires
  `Content-Type: application/json`. `name` 1..64 chars, `platform` enum `ios` (add-only). At most 20 live tokens per user
  (409 `{error:'too many devices'}`; rows with an out-of-date `epoch` do not count and are pruned on issue). The user's current
  `device_epoch` is stored as `epoch`.
- **Expiry**: a token unused for 180 days is dead (401, row pruned), matching the 180-day cap on a cookie
  (gate.js:250-257); every use slides it. Disclosed in D7.
- **Gate branch** (lib/auth/gate.js createAuthGate, the ONE place `req.user` is set): `Authorization: Bearer ftd_...` ->
  look up the hash; then re-read the user row exactly like the cookie path (missing, `disabled`, `device_epoch !== epoch`, or
  expired = revoked). Valid -> `req.user = <that user's row>`, `req.authVia = 'device'`, `req.deviceId = id`. Only a Bearer
  value starting `ftd_` is claimed; any other `Authorization` header falls through untouched (gate r1 W4: an auth proxy that
  forwards its own Bearer token must keep working for browsers). A claimed `ftd_` value that is not a live token NEVER falls
  through to cookie auth. The audit line (server.js:3215 ignores `auditActor` when `req.user` is set) gains `via=device:<id>`.
- **Live revocation** (gate r1 W5): the gate checks only when a request starts (gate.js:328-338), and a background download is
  one long response. Keep a map of device id -> open responses; on revoke, a `device_epoch` bump, a disable or a user delete,
  destroy them. Test: a revoke mid-stream ends the stream.
  - **Responses the app keys on (documented in D7):** unknown / revoked / user disabled / password changed -> `401
    {error:'device token revoked', deviceRevoked:true}` (the app stops every download and asks to re-pair); valid token on a
    route outside its scope -> `403 {error:'not available to devices'}`; an item the user cannot see or that no longer exists ->
    the neutral `404` the routes already give (the app treats it as "gone").
  - **Scope = an explicit ALLOWLIST in the gate, default deny** (method + path pattern): the D2 / D3 / D4 routes, the byte routes
    those manifests name (`/track/:id`, `/episode/:id`, `/video/:id`, `/tvepisode/:id`, `/albumart/:id`, `/thumbnail/:id`,
    `/tvthumb/:id`, `/tvposter/:showId`, `/podcastart/:subId`, `/api/subtitles/:id`, D3's file route), `GET /api/auth/me`, and
    `GET /api/host-info`, each for GET and HEAD. Nothing that writes anything except D4. A census test (beside
    route-read-classification) enumerates every live route from `app._router.stack` and FAILS on any route a device token
    reaches that is not in the allowlist, and on any allowlisted pattern that matches no live route.
  - `last_used_at` is written at most once per 10 minutes per token (an in-memory stamp), never per request: a single offline
    video is ~800 range reads.
  - A per-IP counter of UNKNOWN `ftd_` hashes only (a known-but-revoked or expired token is not counted: a revoked phone's
    queued background tasks must not trip it): after 30 in 10 minutes, unknown hashes from that IP get 429 for 10 minutes, and a
    VALID token is always let through (gate r1 W6: without TRUST_PROXY every phone shares the proxy's IP, server.js:3256-3259).
    Fails open on error, like the login bucket at gate.js:192.
- **Revocation**: `GET /api/devices` (cookie only) lists the caller's devices `{id, name, platform, createdAt, lastUsedAt}`
  (never the hash); `DELETE /api/devices/:id` deletes the caller's own; an admin also gets `GET /api/users/:id/devices` and
  `DELETE /api/users/:id/devices/:deviceId` (requireAdmin) so a kid's phone can be cut off from the Users panel. A password
  change (by the user or an admin) and "Remove all devices" bump `device_epoch`; disabling the user blocks every device while
  disabled (re-enabling restores them: disclosed); deleting the user cascades. Logout does NOT revoke devices.
- **Backup**: `device_tokens` is NOT in the bundle (the `push_subscriptions` precedent, sqlite.js:208-219, "secrets don't ride
  bundles"); a restore drops the rows by cascade, so every device re-pairs. No backup-exclusion census exists, so add a test:
  export a bundle from a database with a paired device and assert no `token_hash`, no `ftd_`, and no `device_tokens` key
  anywhere in it. `users.device_epoch` rides the bundle like `token_version` does (the restore code then bumps it).
- **Settings**: Account (setup.html `#account-box`, `initAccountSection` setup.js:3830) gains a "Devices" row: each device's
  name, "added <date>", "last used <relative>", and a Remove button with a confirm. Shown to every signed-in user, browser
  included (it is where a lost phone is cut off from a laptop). The Users panel's per-user detail shows the same list with Remove
  for an admin, plus "Remove all devices" (bumps `device_epoch`). Empty state: "No devices. Devices appear here when the
  FileTube app is set up for offline playback."

### D2 The download manifest (server)
- `GET /api/offline/manifest?kind=<kind>&id=<id>` (device token OR cookie; the cookie path lets the web and tests use it).
  `kind` (add-only enum): `track`, `album`, `podcastEpisode`, `video`, `tvEpisode`, `tvSeason`. Books are out (Dean's ruling
  named music, podcasts, videos, TV).
- Response: `{ kind, id, title, items: [ ... ] }`; a single-item kind returns one item, `album` its visible tracks in album
  order, `tvSeason` its visible episodes in order. Pin both ids in W2 and document them in D7: album = the `albumKeyFor` value
  (music/query.js:143) the album page already uses; season = `<showId>:<season key>` where the key is `tvParse`'s (numbers, and
  `'x'` for Extras, tv/parse.js:136). `track` ids are resolved per correction 5: a chapter row `<id>::c<n>` adds the PARENT
  file once (kind `track`, id `<id>`, with its chapters), and the web maps every chapter row of that file to the parent's
  state. Each item:
  `{ kind, id, title, subtitle (artist / show / channel), album?, trackNumber?, season?, episode?, durationSec, file: { url,
  bytes, mime, fingerprint, ready }, artwork: { url } | null, chapters: [{ startSec, title }], subtitles: [{ lang, label, url }],
  progress: { positionSec, durationSec, updatedAt } | null, finished: boolean }`.
- Every item is permission-checked through the existing wrappers (`trackVisibleTo`, `podcastEpisodeVisibleTo`,
  `mediaVisibleTo`, `tvEpisodeVisibleTo`); a hidden or missing single item = neutral 404; an album / season silently omits hidden
  members and 404s only when none remain. Bind with restriction kinds that DIVERGE (LESSONS 10: `{kind:'folder'}` media-only,
  `{kind:'library', value:'music'}`), never only `{kind:'path'}`, including a `{kind:'folder'}` restriction on a LIBRARY-audio
  track shown in Music (correction 5) and an album with one hidden member.
- Podcast episodes are offered only when `status === 'downloaded'` (the server has the file); otherwise 409 `{error:'not on
  server yet'}`.
- `file.fingerprint` = `<bytes>-<mtimeMs>` of the SOURCE file, even when D3 serves a transcode (gate r1 W2: the shared 5 GB
  transcode cache evicts under other users' streaming, and an eviction must not read as "changed" and re-download gigabytes).
  `file.bytes` is the size D3 will serve when known (null while a transcode is pending). `file.playable` = false with a reason
  when iOS can play neither the original nor any transcode (D3's rule); `file.ready` = false while a needed transcode is not
  cached yet (D3 queues it); the app retries later.
- Chapters: video's resolved chapters (`resolveItemChapters`, server.js:2440-2452); library-audio chapter rows (`<id>::c<n>`)
  are not their own kind: `add` of a chapter downloads the parent file (the app maps it). Subtitles: videos only today (the
  `/api/subtitles/:id` sidecar); TV has none (disclosed).
- Ids are md5(path): a moved or renamed file gets a NEW id and its offline copy reads as "gone" (404). Disclosed in D7; the app
  keeps playing what it has until it next checks (D3 status).

### D3 The offline file route and status check (server)
- **The iOS playability rule** (one pure function, lib/offline/playable.js, its table in D7): the ORIGINAL is served when its
  container is mp4 / m4v / mov / m4a / mp3 / aac / flac / wav / caf and its codecs are video h264 or hevc tagged `hvc1`, audio
  aac / mp3 / alac / flac / ac3 / eac3 / pcm (ALAC and FLAC stay lossless). Otherwise a cached transcode the existing queue can
  make (`TRANSCODE_DIR/<id>.mp4`, `tv-<id>.mp4`); otherwise (ogg / opus / webm with no transcode path, ffmpeg absent, or the
  transcode `failed`, streams.js:264, server.js:3934) the item is not offerable: `409 {error:'not playable on this device'}`,
  terminal, never a 503 loop. The iOS Root confirms the table on a device before W2 closes (one file per row); anything it
  cannot play moves to the transcode or not-offerable side.
- `GET /api/offline/file/:kind/:id`: the file the rule picks; a transcode not cached yet -> `503 {error:'transcoding'}` with
  `Retry-After: 60`, and the transcode is queued through the existing queue (never a second ffmpeg path). Every serve of a
  transcode calls `markServed` (the TV byte route's precedent, tv/routes.js:536) so a download in progress protects it from LRU
  eviction (gate r1 W3). Served with `res.sendFile({ dotfiles: 'allow' })` (the books precedent: full Range including suffix
  ranges, ETag, Last-Modified, If-Range; `dotfiles` because send 404s a name starting with "."), because iOS background
  downloads resume from resume data that needs a validator; `sendRangeable` has none and is not changed. Only a complete
  transcode is ever served (the builder confirms the cache writes to a temp name and renames; if not, the route refuses a file
  whose job is still running). Visibility checked like the matching byte route; `Content-Type` from the existing per-kind maps;
  `Cache-Control: private, no-store`. If-Range resume is confirmed on a device in the app half (send uses a weak ETag).
  - The transcode cache is LRU (5 GB default, server.js:1342): an eviction between two resumes changes the ETag and the app
    restarts that one file (documented).
- `POST /api/offline/status` `{ items: [{ kind, id, fingerprint }] }` (max 500) -> `{ items: [{ kind, id, state: 'ok' |
  'changed' | 'gone' }] }`: one call for the app to re-check its whole catalogue on launch (gone = deleted, moved, or now
  hidden from this user; changed = new fingerprint). The app removes `gone` copies (the restriction must win on the phone too)
  and offers to refresh `changed` ones; documented in D7.

### D4 Offline position sync (server, DATA: full gate)
- `POST /api/offline/progress` `{ sentAt, events: [{ kind, id, positionSec, durationSec, at, finished? }] }`, max 200 events,
  `kind` in `track | podcastEpisode | video | tvEpisode` (`track` resolved per correction 5), `at` = epoch ms when the position
  was reached ON THE PHONE, `sentAt` = the phone's clock when this request is sent.
- **Clock correction** (gate r1 C2): the server computes `skew = serverNow - sentAt` once per request and shifts every event:
  `atServer = at + skew`, then clamps to `<= serverNow`. A phone a year ahead or behind therefore compares correctly; the prefs
  clamp alone would let a year-ahead phone beat every laptop write and make a behind phone's real positions "older" forever.
  Residual error = network latency plus any clock change on the phone between `at` and `sentAt` (disclosed in D7). The app
  never sends a stored `sentAt`; it stamps each retry anew.
- Per event, in order: resolve + visibility check (hidden / missing -> `{applied:false, reason:'gone'}`); validate numbers
  (finite, >= 0, position <= duration + 1; `durationSec` > 0; `at`, `sentAt` finite); then **newer wins**: apply only when
  `atServer` is strictly later than the stored position's `updatedAt` for that user + item (a null / missing / unparsable
  stored stamp = oldest), else `{applied:false, reason:'older', stored}`. Response `{ results: [...] }` in event order, HTTP
  200 even when some refuse (a refusal is not an error; the app drops refused events from its queue).
- **The stored stamp becomes `new Date(atServer).toISOString()`** (never the phone's string: history and recent lists compare
  stamps as strings, user/routes.js:200-215), so a later comparison is moment-to-moment. The existing online routes keep writing
  server time; nothing there changes.
- **One atomic step, ordered behind earlier flushes** (gate r1 C1): video and music progress sit in memory buffers whose flush
  SNAPSHOTS and clears the buffer, then commits later through `updateDatabase`'s promise chain (server.js:793-813, 1079-1082,
  music 4124-4126); "read the buffer and the row" sees neither copy in that gap, and "flush first" returns at once on an empty
  buffer. So D4 runs its whole read-compare-write for the batch as ONE synchronous mutator queued on `updateDatabase` (so every
  earlier snapshot commits first), reads the LIVE buffer entry inside that mutator, and when the offline event is newer either
  writes and DELETES the buffered older entry, or refuses when the buffered one is newer. Interleave tests: D4 fired between a
  flush's snapshot and its commit, both orders; D4 against a non-empty buffer, both orders.
- **Not the online ping functions**: `applyMediaProgressPing` / `applyPodcastProgress` stamp server time and announce presence
  (user-routes.js:118,142; podcasts/index.js:186), so an offline replay would show as "playing now". D4 writes through the
  stores directly. It DOES apply the same consequences an online play reaching that position has: the 90% / 95% watched /
  played latches and whatever those latches already trigger (Watch later removal, etc.: the builder lists them from the online
  path and mirrors each), and `finished: true` sets the latch regardless of the position comparison (a latch is sticky and only
  ever set). Music has no latch.
- Known effects, disclosed: cleanup suggestions date watched items by `updatedAt` (cleanup/suggest.js:141), so an item finished
  offline long ago is suggested sooner (suggestions only; nothing is deleted without the user); a restored bundle keeps any
  far-future stamp it carried (store.js:2042) and blocks offline sync for that item until the next online write.
- The Feed's stale rule compares the stored `updatedAt` with the stamp it recorded when it served a card (feed/served.js:53,
  108): a D4 write between serve and the Feed's write correctly makes that card stale. Bind it with one test.
- Idempotent: replaying the same batch changes nothing (newer-wins is strict). Music play COUNTS are not synced in this release
  (additive counters need event ids for safe retries); disclosed.
- `last_used_at` and the audit actor `device:<id>` apply. Device token or cookie (the web player never calls it; tests do).

### D5 Contract v1 additions (add-only; land EXACTLY this shape)
- Capabilities enum: add `downloads`.
- Web to native (cap `downloads`): `downloads.add { kind, id }` and `downloads.remove { kind, id }` (kind = the D2 enum, id
  string 1..512; nothing else crosses: native fetches the manifest itself with its token); `downloads.subscribe` /
  `downloads.unsubscribe` (no fields); `downloads.show` (no fields; native opens its Downloads screen).
- Native to web events:
  - `download { kind, id, state, progress?, bytes?, totalBytes?, error?, localSrc? }`: one per ITEM (track, podcastEpisode,
    video, tvEpisode; an album / season add reports its members), `state` enum `none | queued | downloading | paused |
    waitingForWifi | done | failed` (`none` = removed / never), `progress` 0..1, `error` enum `network | storageFull | revoked |
    notOnServer | notReady | other` (only with `failed`), `localSrc` string present only with `done`.
  - `downloadsSnapshot { items: [ <download fields>... ] }`: sent once in answer to every `downloads.subscribe`, carrying every
    item the phone holds or is working on (gate r1 NOTE: one event per item would mean thousands of events on every page load of
    this multi-page app). The web REPLACES its map with it; `download` events after it are deltas. This needs an array field
    spec: add `is: 'array'` with a per-element object spec to `fieldOk` (host-adapter.js:54-63) and `specOf` in the
    conformance test, plus the schema's `array` + `items`; a bad element drops that element, not the snapshot.
  - The web treats unknown `state` as `none`, unknown `error` as `other` (the adapter's `lenient`), and a bad optional field drops
    that field, not the event (the v1.385 rule).
- `localSrc` rules (native-bridge.md, from the spike): opaque string; the web uses it ONLY as an audio / video element `src`,
  never `fetch` / XHR, never for artwork or canvas; native serves it with 206 + Content-Range. If FileTube ever adds a CSP,
  `media-src` must allow the app's scheme (`filetube-local:` today) - also a line in tech-debt-tracker.md item 154.
- Owner (section 5): downloads = native owns the files and the state; the web asks and displays. Released on navigation like
  battery / network: offline.js binds its OWN `pagehide` (unsubscribe) and persisted-`pageshow` (re-subscribe, then replace the
  map from the new snapshot) handlers. skin-surface.js's `hostReassert` is private, covers three registries and is bound only
  when a Pocket owner claims (skin-surface.js:729-736), so it is not reused.
- Adapter: one event per item, so no array support is needed in `fieldOk` (host-adapter.js:54-63). Conformance test
  (test/unit/native-bridge-contract.test.js) binds every new entry both ways.

### D6 The web (only where `host.has('downloads')`; no host = identical DOM, no listeners beyond inert ones)
- One module (public/js/offline.js) owns the subscription (shared across the page, the v1.384 one-subscription lesson), the
  `{kind:id -> state}` map, and a small API the surfaces call (`offline.state(kind,id)`, `offline.add`, `offline.remove`,
  `offline.onChange`).
- Actions ("Make available offline" / "Remove offline copy" / progress), in the menus that already carry "Save to device"
  (beside it, never replacing it): track rows `openSongMenu` (music.js:4379), album drill header pills
  (`buildDrillHeaderHtml` music.js:583, album = all tracks), podcast `episodeMenuItems` (podcasts.js:790; only for episodes the
  server has), video `buildWatchMoreItems` (watch.js:694) + card `buildCardMenuItems` (main.js:725), TV episode rows
  (`buildEpisodeRowHtml` tv.js:79) and a season action on the show page.
- Badge "Offline" (a `ui.chip({kind:'meta'})`, the `.card-type` precedent main.js:804-808) on video / podcast / music / TV cards
  and rows when `done`; a thin progress indicator while `downloading`; nothing for `none`. Album header: "Offline" when every
  visible track is `done`. Measure rows at 320 / 390 (rows wrap, buttons never shrink).
- An "Offline" entry in the app's menu that sends `downloads.show`.
- The swap list below came from a grep the gate r1 Adversary started; before W5 the builder re-greps every reader of the media
  URL (`streamSrc`, `audioSrc`, `'/video/'`, `'/track/'`, `'/episode/'`, `'/tvepisode/'`, `currentSrc`, `.src =`) including
  AirPlay / remote / handoff / Pocket / pop-out / the Roku remote, and lists each as "swap", "skip local" or "server only" in
  the evidence section. Anything that sends the URL to ANOTHER device (remote, handoff, cast) always sends the server URL.
- **Playing the phone's copy online**: `setupForMedia` (player.js:9786) prefers `data.localSrc` from offline.js when the item
  is `done`. Then: no transcode fetch / poll (player.js:10123, the `?live=1` path :6384), no background-audio sidecar handoff for
  a local video (`bgAudioEl.src`, player.js:3758: keep the local element playing instead; verify on device), the Feed's
  `warmNext` and music's readiness poll (feed.js:1211, music.js:5053) skip local items, and a 360 video never uses `localSrc`
  (vr-view.js:242 `texImage2D` would be tainted by a cross-origin source). Progress writes keep going to the normal routes
  (the phone is online).
- Copy for errors in the item's menu: `storageFull` "Not enough space on this phone", `revoked` "This device was removed in
  Settings", `notOnServer` "Not on the server yet", `notReady` "Preparing a playable copy, try again shortly".

### D7 The app's reference (docs/references/offline-api.md, new)
The iOS Root plans against this file: pairing (`POST /api/devices` with the web view's cookies and the password from a native
prompt, the returned token into the Keychain), the header (`Authorization: Bearer ftd_...`), the 401 / 403 / 404 / 409 / 503
meanings (D1, D3), the 180-day unused expiry, live revocation ending an open download, every D2 / D3 / D4 route with request /
response examples, the album / season / chapter id rules, the iOS playability table, the fingerprint (source file) and ETag
(served file) rules, the 5 GB LRU caveat, id = md5(path) (moves read as gone), "gone means remove the copy", the newer-wins rule
with `at` + `sentAt` and its residual error, and what is not synced (music play counts).

## 4. Waves
- **W1** D1: migration 37, devices store, gate branch + scope allowlist + census, issue / list / revoke routes, admin routes,
  backup exclusion, Settings Devices rows. Tests: a member token with `{kind:'folder'}` and `{kind:'library'}` restrictions
  cannot read a hidden item's bytes, art or manifest; a password change / remove-all / disable / delete / revoke / expiry each
  yields 401 on the next request and ends an open stream; the login re-hash does NOT unpair; an `ftd_` garbage token never falls
  to the cookie while a non-`ftd_` Bearer does; a token cannot mint a token; issue without the right password fails; every
  non-allowlisted route 403s; the limiter never blocks a valid token.
- **W2** D2 + D3: the playability rule (table-driven tests; the iOS Root's device table confirmed), manifest per kind (all
  three `track` forms), the file route (original vs transcode vs 503-and-queued vs 409 not playable), status. Tests with a real
  file seeded (not a stub), Range + If-Range resume, suffix range, HEAD, a dot-named file, `markServed` on serve, a transcode
  eviction leaves the fingerprint unchanged.
- **W3** D4: position sync. Tests: an older offline event never overwrites a newer online one (stored row, live buffer, AND the
  snapshot-to-commit gap, both orders, per buffered kind); a newer offline rewind wins; a phone a year ahead, a year behind,
  5 minutes ahead; replay is a no-op; a hidden item (each restriction kind, incl. a library track under `{kind:'folder'}`)
  refuses; the latch is set and never cleared, and mirrors the online latch's consequences; no presence announced; stamps are
  ISO; the Feed stale test; mixed batch order preserved. Mutation-test each guard in its commit round (LESSONS 9).
- **W4** D5: contract (schema, native-bridge.md sections 1-6, ios-host.md count + a dated addendum, host-adapter.js tables,
  conformance).
- **W5** D6: offline.js, the surfaces, badges, the player swap, with fake-host tests (test/helpers/fake-host.js) and a no-host
  DOM-equality test.
- **W6** close-out: D7 reference, the dated design corrections in ios-offline.md (section 2 here), ledger, ROADMAP,
  docs/DEVICE-CHECKS.md "Offline playback (v1.387.0)" (owed until the app half ships: pair, make an album / episode / video / TV
  season available offline, airplane mode plays them, a position made offline shows on the laptop after reconnecting, a laptop
  position made later is not overwritten, remove the device in Settings -> the app stops, a kid account cannot see or fetch a
  hidden item), the LESSONS entry.

## 5. Gate
FULL (auth, a migration, saved positions): adversary, qa, security-brief. Brief the Adversary to DESTROY saved positions and to
LEAK: an offline event older than a buffered online one landing last; a phone clock set a year ahead or behind; a replayed batch;
a kid token reaching a hidden item through ANY route (bytes, art, subtitles, manifest of an album with one hidden track, status,
progress); a revoked / disabled / password-changed token still working, including a request in flight; `Bearer` garbage falling
through to a cookie; a token minting a token; a token reaching a write route outside D4; the census missing a route; a timing
side channel on the hash lookup; the backup bundle carrying a token; a 360 or transcoding item swapped to `localSrc`; any change
in a browser with no host.

## 6. Release
docs/RELEASING.md + AGENTS.md; close the plan in the same PR (`node scripts/plan-complete.js
docs/exec-plans/active/2026-10-11-offline-server.md "Shipped vX.Y.Z" --apply`); ask Dean before `gh pr merge`; shipped = the
tag's "Publish Docker Image" green; then tell the FileTube Root (SendMessage "FileTube Root") the merge commit so the iOS Root can
re-pin the contract and plan the app half against offline-api.md.

## 7. Evidence (builder fills)

## 8. Out of scope
The app half (filetube-ios); books; music play counts offline; smaller "data saver" renditions (ROADMAP streaming Tier 2); TV
subtitles; a server-side list of what each phone holds (the phone is the source of truth for its own files); widgets (the token
unlocks them later); the separately found restore gap (user restrictions do not ride the backup bundle, so a users-replacing
restore drops every restriction: its own fix, ROADMAP Planned > Bugs, security).

Gate: CHANGES r1 @6d23b845 — adversary (plan review)
