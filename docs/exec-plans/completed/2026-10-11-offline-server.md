---
plan: offline-server
harness: v2 · full
branch: feat/v1.387.0-offline-server
anchor: spec
status: Shipped v1.387.0
next: none - shipped; the app half (filetube-ios v0.9.0) builds against docs/references/offline-api.md
design: docs/references/ios-offline.md (Dean's rulings 2026-10-11) + the iOS Root's contract asks and custom-scheme spike (2026-10-11, simulator iOS 27 + iPhone XS iOS 18). Base = d405012e (the speed pass's docs commit; merge main once v1.386.0 lands).
builder: extreme (a new credential at the auth gate, a schema migration, and writes to every kind's saved positions)
gate: CLOSED - r3 @00ede12f (after the v1.386.0 merge + one test-only fix): adversary, qa and security-brief all APPROVED; r2 @226dc4f2 all APPROVED; r1 @30db1f3e one CRITICAL + five WARNING, all fixed in 226dc4f2
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
PWA see no change, except the Settings Devices list (D1) and one renamed podcast setting (correction 4).

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
  only with the account's password, verified like login (scrypt, the login rate bucket, the dummy-hash timing guard) but NEVER the login re-hash step
  (auth/routes.js:115-116 bumps `token_version`, which would sign out the web view mid-pairing) (gate r1
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
  anywhere in it. `users.device_epoch` is NOT in the bundle either (no bundle schema change): the device rows go with the users on a restore.
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
  terminal, never a 503 loop. The `hvc1` tag is not stored anywhere (ffprobe is asked only for `codec_name`, server.js:2643;
  TV and music store only `codec`): for an HEVC item, D2 runs a lazy ffprobe of `codec_tag_string` at manifest time, cached in
  memory by id + fingerprint (NOT a per-item `db.metadata` field and NOT a scan change: LESSONS 9); `hev1` or unknown -> the
  transcode side. Podcast episodes have no stored codec: decided by file extension only (mp3 / m4a / aac / mp4 served, others
  not offerable). The builder confirms `queueTranscode` (server.js:1958) works for an item the BROWSER rule plays directly (an
  MKV with h264 / aac) without changing how the web plays it (`transcodeStatus` read at player.js:5970, 10117). The iOS Root confirms the table on a device before W2 closes (one file per row); anything it
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
  never sends a stored `sentAt`; it stamps each retry anew. **Progress sync is a normal foreground request whose body is built
  immediately before it is sent, never an iOS background upload task** (gate r2 NEW-2: a background upload fixes the body,
  `sentAt` included, when the task is created and iOS may send it hours later, and the server would read that delay as skew and
  push old events past newer laptop writes). The server refuses a batch whose `sentAt` is more than 5 minutes ahead of server
  time with `400 {error:'restamp'}`, and the app re-stamps and retries.
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
- Adapter: the `lenient` mapping (unknown `state` -> `none`, unknown `error` -> `other`) applies to each `downloadsSnapshot`
  element as well as to a `download` event; today it applies only to top-level fields (host-adapter.js:120-127), so W4 extends
  it. `downloadsSnapshot.items` has `maxItems: 10000` in the schema; a longer array is dropped whole (the app never sends one).
  Conformance test (test/unit/native-bridge-contract.test.js) binds every new entry both ways.

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
with `at` + `sentAt` and its residual error (sync is a foreground request built just before sending, never a background upload; `400 restamp`), and what is not synced (music play counts).

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

Built 2026-10-11 / 2026-10-12 by the Extreme builder (Fable) on feat/v1.387.0-offline-server. Commits: W1 d149db74, W2 47ef5bef,
W3 a124f3ad, W4 3ce11a91 (pushed; the iOS Root re-pins Contract/ to it), W5 + W6 below. Base: main at 80c2bb91 (v1.385.0);
v1.386.0 (the speed pass) had not merged when W5 started - see the merge note at the end.

**Device runs (the iOS Root, the playability table of D3).** Run 1, iPhone XS iOS 18.7.10 (2026-10-11); run 2, iPhone 15 Pro iOS
27.0.1 (2026-10-12); AVPlayer from a local file AND the web view through the app's scheme, with the exact ffmpeg sample
commands I sent. Rows 1-12 (mp4 h264/aac, mp4 hevc hvc1, mov h264/pcm, m4v h264/ac3, mp4 h264/eac3, m4a alac, m4a aac, mp3,
flac, wav, ADTS aac, caf) PLAY; rows 13-15 (hev1, mkv, webm) are refused (hev1 = an unplayable video track, mkv / webm cannot
open); rows 16-18 (mp4 h264 + opus, ogg vorbis, .opus) PLAY on both, which moved opus into the audio codec list (W2) and the
ogg / oga / opus containers to the original (W3 commit); Dean set the app's floor to iOS 18 (via the iOS Root), so no supported
iOS is unmeasured; the app checks AVURLAsset.isPlayable after each download as the guard for later versions. Answers: ADTS .aac
and .caf play; WebKit sniffs (file.mime stays in the manifest, nothing depends on it). Caveat recorded in offline-api.md: a MUTED
<audio> on iOS 27 loads mp3 / flac / ADTS aac / ogg / opus but never advances (FileTube plays unmuted).

**FileTube Root rulings (2026-10-11, for W4), landed exactly:** per-child items for album and tvSeason with optional
`parentKind` + `parentId` (the web rolls the badge up; `downloads.remove` of a collection removes every member native holds);
`downloads.show` takes no fields and opens the native Downloads screen; `state: 'none'` = not on the phone (after a remove, a
gone that deleted the copy, a cancel).

**The builder-confirm item (D3):** the video transcode queue writes `transcodeStatus` onto the media item; the only client
readers of that field are player.js:5970 / :5978 (inside the awaiting-transcode poll) and :10117 (inside `if
(data.needsTranscode)`), so queueing an iOS transcode for an MKV the browser plays directly changes nothing the web does -
bound in offline-manifest.test.js (after the offline transcode landed, `/api/videos/:id` has no needsTranscode and
`/video/:id` serves the source bytes). The queues write `<out>.tmp.mp4` and rename, so an existing `<out>` is complete.

**Mutant rounds (committed trees, /tmp git-archive sandboxes, each guard by name).** W1: 14 mutants, 13 killed; the 14th (the
device routes' own cookie-only floor) was masked by the gate's scope and got an isolating test (auth-devices-routes.test.js)
that kills it. W2: 18 mutants, 14 killed; the four survivors were fixture gaps, not defects - a native track under a blocked
path asked for directly, a pending podcast record WITH a path, a downloaded record whose path escapes the podcasts root (all
three given witnesses and re-killed in the W3 round), and the album's visible list (masked by resolveTrack's own re-check:
documented as masked, defence in depth). W3: 21 mutants, 17 killed; the four survivors were binding gaps, each closed in the
W4 commit and re-killed against it: `>` vs `>=` (now the pure, unit-tested `newerWins`), the clamp to server time (the
fixture now stamps the event after the phone sent), the mutator's no-doc-save contract (the cached doc keeps its identity),
and the chain order (the test-only `__holdWriteChainForTests` makes the gap tests event-loop-ordered; the sync run outside
`updateDatabase` lands the older value and dies).

**The media-URL reader census for the player swap (D6, re-grepped before W5 over public/js: 45 readers outside player.js):**
- swap (plays the phone's copy): player.js setupForMedia (`streamUrl`, after the streamSrc block; a descriptor copy with
  needsTranscode cleared; the bg-audio settings read answered locally); the music readiness probe (music.js: the fetch is
  answered locally, the one loadTrack path runs); the Feed's next-card warm (feed.js warmNext: skipped for a held card).
- skip local (server only, by design): the 360 sphere (vr-view.js texImage2D: a cross-origin texture taints the canvas -
  resolveOfflineLocalSrc refuses any non-flat projection); a book chapter (not an offline item); the background-audio
  sidecar (bgAudioEl.src, player.js armBackgroundAudioSrc: never armed for a local play, the local element keeps playing); the
  desktop live transcode (startLiveStream: never reached, needsTranscode is cleared); the Chapter Snap audition (common.js
  audio.src = /video/<id>: an editor, server only); hover preview clips (main.js CLIP_SRC) and every art / thumbnail src.
- server only (the URL goes to ANOTHER device or is a save): every `?download=1` Save to device href (main.js, watch.js,
  music.js, podcasts.js, skin-surface.js, read.js); Listen Control / remote.js (sends track ids, never URLs); handoff
  (presence carries ids and thumbnails); the Roku channel (its own routes); the pop-out window (skin-surface.js: it proxies
  controls to the main document's element, never loads media); AirPlay (the element's own src: a local-scheme src stays on
  the phone, which is the app's concern - noted for the app half).

**Rows at 320 / 390 (tools/offline-proof/row-probe.js, the real engine + CSS + the shipped builders, a fake host answering the
subscription), run 2026-10-12, PASS at both widths:** the TV show page draws 6 pills (a season pill per season, a pill per
episode row) and the album page 1; every pill is 32 px high, the same as the page's own small pills (measured reference 32),
and every pill's width equals its scrollWidth (166 px "Make available offline", 157 "Remove offline copy", 176 / 177 "Saving
for offline... N%", 181 the album pill): nothing shrinks or clips. Episode rows with a pill are 56 to 66 px high (a single
line is 32): the title wraps above the pill rather than running under it; no row's title is clipped. Badges: "Offline" 39 px
and "Saving 70%" fit inside a two-column card's text block at 320 (the first probe run measured the full "Saving for
offline... 70%" badge at 138 px, outside the block at BOTH widths - that is why the card badge is the compact form; the
menus keep the phrase). No horizontal page overflow on any of the six pages.

**Suites (Node 22.23.1, this worktree's own install):** `npm test` on the W5 tree + the W6 docs and the app-version line (the
pre-gate run, 2026-10-12): 12348 tests, 12338 pass, 0 fail, 0 cancelled, 10 skipped (the suite's standing skips). Per wave:
W1 `npm run test:unit` 9613 / 9610 pass (the two reds were the source-lock test my migration test tripped, fixed in that
commit, and a timing flake that is 21/21 alone); every later wave's touched suites green before its commit (W2 11/11 +
4/4, W3 11/11, W4 16 + 4 + 11, W5 15/15 + 1831 builder / player / bridge / feed tests, W6 70/70 across the menu, contract
and offline suites). `npm run lint` 0 errors (6 standing warnings), `npm run lint:ui` the live debt equals the ratchet
file, the overlay lint 0 violations.

**Merge note (Step 0):** origin/main did not move during the build (80c2bb91, the v1.385.0 merge, is still its head at
the W6 commit; the speed pass perf/v1.386.0-speed-pass sits at d405012e, unreleased), so there was nothing to merge before
W5. The release commit waits for v1.386.0 on main, then merges main in and re-runs the suites (the FileTube Root's
sequencing, confirmed 2026-10-12).

**Gate round 1 (2026-10-12, at 30db1f3e) and its fixes (the r2 commit):** security-brief APPROVED with two LOW, qa CHANGES
with three WARNING, adversary CHANGES with one CRITICAL and two WARNING (47 mutants, 43 killed; the four survivors became
the findings and the suggestion). Every finding is fixed and bound in the r2 commit: the sync handler flushes both coalescer
buffers in its own tick ahead of its mutator (order E, both kinds, plus the older-offline arm); `at` bounded and a negative
sentAt refused (a five-event poison batch answers 200 with four invalid in place); the device store remembers the hashes it
deletes for 24 hours and the gate answers 401 uncounted (40 + 40 presentations count for nothing; the five deletion paths and
the 24 h bound); offline.js watches the document for added elements (a real innerHTML render and an appended card get their
badges with no host event, the pass settles, no host = no observer); the tv queue remembers a failed id and the offline route
answers 409 (a stub ffmpeg that fails: 503 once, then 409, no rendition); cardOfflineKind = track for library audio (menu kind
equals badge kind for a plain and a chaptered file); localSrc only from a done item. The one pre-existing test that asserted a
buffered ping "survives" the sync was corrected: the handler now commits it first, which is the fix. Suites after the fixes
(Node 22.23.1): offline-ui + auth-gate-devices + auth-devices-store + card-action-menu 70 / 70; offline-progress 13 / 13;
offline-manifest, device-tokens, device-scope-census, route-read / write-classification, rbac-census 31 / 31; lint 0 errors;
lint:ui equal to the ratchet. The r2 re-confirmation by the same three seats follows this commit.

**Gate round 2 (2026-10-12, at 226dc4f2): CLOSED.** All three seats APPROVED the delta. Adversary: 13 mutants, 12 killed, 1
equivalent (localSrcFor's own guard is masked by state() stripping localSrc first); its order-E repro answers applied:true
with the newer position standing (media 50, music 60; both were the older ping at r1); 15 integration suites 172 / 173
(the one red is the known coalescer AC4.1 timing ratio, tracker #238, unreachable by the delta). QA: 19 touched files
re-run, every one green; lint 0 errors; lint:ui equal to the ratchet. Security-brief: both r1 findings fixed, nothing
CRITICAL or HIGH introduced; one LOW note accepted with a written rationale - `remove` remembers the hash before the owner
check, auth-inert (the memory is consulted only on a lookup miss), a pollution vector of ~5000 authenticated calls; the fix
moves the reviewed sha after a closed gate, so it is tracker item 299 with its one-line fix shape.

**The v1.386.0 merge (plan Step 0; 2026-10-12).** v1.386.0 (the speed pass, merge commit 58470560, PR #137) reached main after
the gate closed, so origin/main was merged into this branch BEFORE the close-out, as a merge commit of its own, never as
bookkeeping. The stop rule fired: of v1.386.0's 54 files, six overlap this wave - server.js and lib/music/routes.js (code) and
ROADMAP.md, docs/DEVICE-CHECKS.md, docs/DIAGRAMS.md, docs/references/ios-offline.md (docs). Dean's word (relayed by the FileTube
Root from its AskUserQuestion, 2026-10-12): "Proceed on green tests". Facts: the two code files auto-merged with no conflicts
and no adjacent hunks (main: the jsonCompression middleware at server.js 575, staticAssets + the shell rewrite at 3404-3523, a
handoff line at 5481, and readPartShared('tracks') inside lib/music/routes.js registerTrackRoutes; this wave: the device store
wiring at 293 / 980, the gate at 3153-3296, the offline routes at 4610-4720, the exports, and the hoisted music content-type
map at 593 / 844). Semantics checked: main's serve-time shell rewrite versions every <script src>, so the ten shells' new
/js/offline.js tag is cache-busted like every other script; jsonCompression compresses only a 200 JSON GET body of 8 KB or
more (the manifest is such a GET; transparent to URLSession and fetch); the offline resolvers read the music store through
its own readers. The two docs conflicts (both releases appending an entry) were resolved by keeping both blocks, v1.386.0's
first. The full Node 22 suite on the merged tree (a throwaway worktree, the merge commit's tree hash identical to the tested
tree): 12415 tests, 12404 pass, 1 fail, 10 skipped. The one red was a defect in THIS wave's test, not in the product: the
diverging-restriction-kinds test replayed the kid's visible event through the cookie and then the token at the SAME moment,
which the strict newer-wins rule reads as older unless the second request's latency exceeds the first's; the test now gives
each pass its own moment (3 / 3 green in isolation; the fix is a test-only commit, re-confirmed by the three seats as a delta).

**Gate round 3 (2026-10-12, at 00ede12f): CLOSED at the final code sha.** The delta = the v1.386.0 merge + the test-only fix.
Adversary: the fix weakens no binding (M26, M23b, the order-E and poison-`at` tests, the changed test's own gone arm and
newerWins `>=` all still go red under mutation); the merged main code measured not to interact (every served shell carries
/js/offline.js?v=<hash> right after host-adapter.js, /login none; the manifest byte-identical under gzip and identity; the
offline resolvers' music reads independent of readPartShared; Range / If-Range / HEAD green with jsonCompression installed);
11 integration suites 87 / 87. QA: offline-progress 3 x 13 / 13, the censuses and main's static-assets test green, lint 0
errors, ROADMAP and DEVICE-CHECKS carry both releases once each. Security-brief: jsonCompression never touches a 401 / 403 /
429 or a POST, the static middleware runs after the gate and /js/offline.js stays session-gated, readPartShared is a frozen
copy of the same rows. Deferred cosmetic (QA r3 A): lib/music/routes.js's header comment still says MUSIC_CONTENT_TYPES sits
at the top of registerTrackRoutes (W2 hoisted and exported it at the module bottom); a lib file is not bookkeeping, so it
waits for the next music wave.

**Close-out binding (Dean's ruling 2026-10-12, relayed by the FileTube Root: a bookkeeping-only close-out needs no reviewer
re-check).** Approved code sha 00ede12f (adversary, qa, security-brief r3). The close-out commit's
diff against it, `git diff --name-only 00ede12f..HEAD`:
```
ROADMAP.md
docs/exec-plans/completed/2026-10-11-offline-server.md
docs/exec-plans/tech-debt-tracker.md
docs/references/ios-host.md
docs/references/ios-offline.md
docs/releases.json
package-lock.json
package.json
```
Every path is docs/**, *.md, docs/releases.json or a package file; `git diff 00ede12f..HEAD -- package.json package-lock.json`
changes only version lines:
```
-  "version": "1.386.0",
+  "version": "1.387.0",
-      "version": "1.386.0",
+      "version": "1.387.0",
-  "version": "1.386.0",
+  "version": "1.387.0",
```
So no seat was re-engaged for the close-out. The v1.386.0 merge (354eedd1) and the test-only fix (00ede12f) were NOT treated as
bookkeeping: both sit under the r3 approvals above.

## 8. Out of scope
The app half (filetube-ios); books; music play counts offline; smaller "data saver" renditions (ROADMAP streaming Tier 2); TV
subtitles; a server-side list of what each phone holds (the phone is the source of truth for its own files); widgets (the token
unlocks them later); the separately found restore gap (user restrictions do not ride the backup bundle, so a users-replacing
restore drops every restriction: its own fix, ROADMAP Planned > Bugs, security).

Gate: CHANGES r1 @6d23b845 — adversary (plan review)

Gate: CHANGES r2 @67b2b49e — adversary (plan review)

### Security-brief r1 @30db1f3e (2026-10-12, read-only review of the committed worktree)

Could NOT run (no Bash in this seat): `git diff 80c2bb91`, the suites, a live timing measurement. Every statement below is
from reading the committed files; "verified" = the exact path was traced in the code, never "the test says".

No CRITICAL, no HIGH. Two LOW (fix or accept with a written rationale), the rest advisory.

- **WARNING (LOW) W1 - the "a revoked token is not counted" claim is true only for a password change.** lib/auth/gate.js:239-244
  and the plan (D1 "a known-but-revoked or expired token is not counted") say the unknown-hash limiter ignores revoked and
  expired tokens. In the code only an EPOCH-mismatch row (changePassword) survives as a known row; Remove (devices.js:210
  `remove`), Remove all (`removeAllForUser` -> `DELETE ... WHERE user_id`), a user delete (cascade) and expiry (gate.js:359
  `prune`) DELETE the row, so from the second presentation on that phone's token is an UNKNOWN hash and counts
  (gate.js:347-348). test/unit/auth-gate-devices.test.js:209 models "revoked" only as the epoch-stale row, so it cannot see
  this. Consequence: a removed phone's queued background range requests trip the limiter for the shared proxy ip; a SECOND
  revoked or expired phone behind that ip then gets 429 (offline-api.md:45 "stays queued, retry") instead of the 401
  deviceRevoked that prompts a re-pair, for 10 minutes at a time. Security loss: none (a valid token is looked up before the
  limiter, gate.js:346-348; fail-closed). This is a stale security comment + a plan claim the code does not meet. Fix: either
  keep recently revoked hashes in a bounded in-memory set the limiter consults (no schema change), or correct gate.js, the
  plan and offline-api.md to "an epoch-revoked token is not counted; a removed or expired one is".
- **WARNING (LOW) W2 - an extreme `at` throws inside the progress mutator after earlier events were written.**
  lib/offline/routes.js:496 checks `at` only for finiteness; routes.js:503 `new Date(atServerMs).toISOString()` throws a
  RangeError when |at + skew| > 8.64e15. The throw is inside the `updateDatabase` mutator (routes.js:563-570): per-user rows
  written for the batch's EARLIER events stay (they are immediate SQL writes), the route answers 500, the chain survives
  (server.js:818). A merely very negative `at` (within range) is stored as a negative-year ISO `updatedAt` for an item with
  no stored row (routes.js:60-62, -Infinity is the floor), which sorts before every digit stamp in the string-comparing
  history lists. Attacker = the token holder against their OWN account only; a retry of the batch is idempotent. Fix: in
  `validEvent` bound `at` to a sane window (e.g. `at >= 0 && at <= sentAt + PROGRESS_SENT_AT_SLACK_MS`), and treat an
  `atServer < 0` as `invalid` before `toISOString`.
- **NOTE (INFO) N1 - the scope census's blind spots.** test/integration/device-scope-census.test.js:46-56 enumerates only
  layers with `.route` and a STRING path and skips `_all`: a route mounted through `express.Router()`, registered with
  `app.all`, or given an array / regex path would be invisible to it. Verified none exist today (no `express.Router(`,
  `app.all(` or array-path registrations in server.js or lib/). The enforcement itself is the default-deny regex allowlist in
  the gate (gate.js:362, device-scope.js:55-62), so a missed route is denied, not exposed; the gap is only that a FUTURE
  allowlist entry naming such a route could not be cross-checked. Advisory: have the census assert every stack layer is a
  string-path `.route` or a known middleware name.
- **NOTE (INFO) N2 - the "claimed" boundary is the regex, not the prefix.** gate.js:419 `^\s*Bearer\s+(\S+)\s*$`: a header
  like `Bearer ftd_x extra` is NOT claimed and falls to cookie auth, which still requires a valid cookie. Not a bypass;
  recorded so the plan's "a claimed ftd_ value never falls through" is read with that definition.
- **NOTE (INFO) N3 - `res.sendFile(..., { dotfiles: 'allow' })` on a db-authored path adds no new read surface.**
  routes.js:411: media / music / tv `filePath` is trusted exactly as the existing byte routes trust it (streams.js:231-243,
  music/routes.js:677-682, tv/routes.js:514-519 serve `filePath` through sendRangeable with no confinement); the podcast
  kind applies the SAME `isConfinedUnderRoot` the /episode route does (routes.js:226, server.js:4706, podcasts/index.js:1144-
  1147). `send` 403s a `..` segment without a root; Express throws on a relative path (caught -> 500). The "a bundle can
  author filePath" posture is pre-existing and admin-only.
- **NOTE (INFO) N4 - `probeHevcTag` (server.js:4681) passes `filePath` positionally to ffprobe**, the same shape as every
  existing `buildFfprobeArgs` call (server.js:2652): a path beginning with `-` would read as an option. Pre-existing, admin-
  authored data only, reached only after the visibility check; not new.
- **NOTE (INFO) N5 - no rate limit on POST /api/offline/progress** (200 events x several synchronous SQL writes per request,
  inside the write chain). The holder can only burn their own server; the same posture as every authenticated write route.
- **NOTE (INFO) N6 - accepted disclosures:** re-enabling a disabled user restores its devices (rows kept; an admin action,
  disclosed D1 / D7); `listForUser` prunes expired rows on a GET (a write on read, harmless).

Verified safe (the brief's ten hunts, each traced):
1. Credential: `ftd_` + 32 random bytes base64url (crypto.js:180); sha256 stored (devices.js:37-39); lookup by the UNIQUE
   index then `tokensEqual` (crypto.js:201-206 hashes both sides to equal-length digests, then timingSafeEqual): constant
   time in practice; the index hit / miss timing is no oracle over a 256-bit space. Unknown, revoked, disabled and expired
   all answer the identical body (gate.js:341-343); 429 differs only for unknowns. A short or malformed Bearer (`ftd_` alone)
   is claimed, hashed, unknown -> 401, never a route.
2. Gate order: the Bearer branch (gate.js:416-422) precedes the allowlist and the zero-users funnel; every branch of
   `deviceAuth` returns, so a claimed value never reaches cookie auth. Scope is checked after liveness and before `req.user`
   (gate.js:362-365); `req.path` is matched case-sensitively against `^...$` regexes (device-scope.js:41-50), so a case,
   trailing-slash or double-slash variant is DENIED (fail-closed) while Express's case-insensitive routing could only match
   the same route; HEAD maps to GET; the 16 reachable routes equal the allowlist and the expected list.
3. Revocation: the login re-hash calls `updatePassword` (token_version only, store.js:52, routes.js:117); `changePassword`
   bumps both (store.js:58, routes.js:376); Remove all bumps the epoch then deletes (routes.js:516-517); disabled is read
   live (gate.js:356); delete cascades (FK) after `removeAllForUser` cuts the open responses (routes.js:537). `track` binds
   `res.once('close')` (devices.js:248), which a ServerResponse emits on completion or abort; `destroyAll` on remove,
   `cutUser` on epoch bump / disable / delete. The 10-minute `touch` runs AFTER the scope check (gate.js:362-371), so an
   out-of-scope request does not slide the 180 days.
4. Pairing: `requireCookieSession` (routes.js:235-241) AND the gate's scope refuse a token; `req.is('application/json')`
   -> 415; the password is verified against the stored hash (DUMMY_HASH on a missing one) under the (ip, username) login
   bucket; NEVER `updatePassword`; the epoch is re-read synchronously after the only await (routes.js:265-267); the 20-cap
   and prune run in one transaction (devices.js:155-169). CSRF: HttpOnly + SameSite=Lax cookie (gate.js:88), the global
   parser accepts only application/json, and the password is required: a stolen cookie alone cannot mint.
5. Visibility: `projection(req)` is per request from `trackVisibleTo` + `projectedLibraryTracks(req)` (routes.js:113-127);
   `resolveTrack` re-checks `mediaVisibleTo` on the parent (:207); album members re-resolve through `resolveTrack` (:283);
   the season filters by `tvEpisodeVisibleTo` BEFORE grouping (:298); a bad `<showId>:<key>` is null -> 404; podcast =
   visibility, then downloaded, then confinement (:224-226). The file route accepts SINGLE_KINDS only and the same
   resolvers (:392-395).
6. Admin routes: `requireAdmin` first, then `resolveTargetUser` (routes.js:497-519); the self routes delete with
   `WHERE user_id = ? AND id = ?` (devices.js:88). Settings: `renderDeviceRows` builds every node with textContent
   (setup.js:4128), ids go through encodeURIComponent in URLs (:4204, :4224-4225).
7. Exposure: manifest URLs are relative route URLs (routes.js:37-39, :171, :189, :238, :258), never a filePath;
   `publicDevice` omits the hash (devices.js:73-75); `exportUsersForBackup` carries no device field (store.js:1908-1944) and
   the restore's `DELETE FROM users` (store.js:2040) cascades device_tokens; the audit line adds `via=device:<id>`
   (server.js:3236); no `ftd_` token of real length anywhere in the tree.
8. Progress: `uid = req.user.id` always (routes.js:502); every id through `resolveForProgress` -> its wrapper; `sentAt`
   more than 5 min ahead -> 400 (:560); clamp to serverNow (:566); NaN / Infinity / negative / `pos > dur + 1` / `dur <= 0`
   -> invalid (:489-499); the mutator returns false (no doc save, :569).
9. Web: `localSrc` reaches only `mediaPlayer.src` (player.js:10105, :10150, :10159); the `fetch(streamUrl)` at :10155 is
   under `data.needsTranscode`, which a local play clears (:9816); music.js:5082 answers the probe locally; feed.js:1212
   blanks the warm fetch. host-adapter validates `localSrc` as a non-empty string (:35) and `app` as {name string, version
   `^\d+\.\d+\.\d+`, build `^[A-Za-z0-9._-]{1,32}$`} (:229-232); `hostAppVersionLine` re-validates (common.js:6803-6809)
   and renders as a row title + setAttribute aria-label (:7470-7472). tv.js pill attributes pass `escapeTvHtml` (:84-85);
   offline.js labels and badges are textContent (:180-183). CSP: tech-debt-tracker item 154 carries the media-src note.
10. Migration: `if (current < 37)` appended after v36 (sqlite.js:1483-1511), CREATE TABLE IF NOT EXISTS, a PRAGMA
    table_info presence check before the ALTER, user_version 37, SCHEMA_VERSION = 37 (:351); the test reset wipes
    device_tokens and zeros device_epoch (store.js:2303-2304).

Gate: APPROVED r1 @30db1f3e — security-brief

### QA r1 @30db1f3e (2026-10-12)

Instruments (Node 22.23.1, this worktree, load average ~20): `npm run lint` 0 errors / 6 warnings; `npm run lint:ui` "the live debt
equals docs/ui-exceptions.json"; overlay lint "clean (0 violations)"; `npm run test:unit` 9646 tests, 9644 pass, 1 fail, 1 skipped -
the fail is books-first-chapter.test.js:169 (a 1500 ms wall-clock budget, lib/books untouched; 2 of 3 isolated runs green: load
flake); device-tokens 8/8, device-scope-census 3/3, offline-manifest 11/11, offline-progress 11/11, route-read 2/2, route-write 4/4,
rbac-census 3/3, settings-census 5/5, docs-link 2/2, docs-diagrams 5/5, exec-plans 3/3, release-ledger 7/7. Not run: the full
`npm test` (the evidence's 12348 is not re-derived here) and the mutant counts.

- WARNING 1 (D6 badge unreachable on 3 of 4 surfaces; LESSONS 11). public/js/offline.js:453-477 `decorate()` is called only by
  tv.js:248 (show detail) and by the module's own onChange (offline.js:485), which fires only on a `download` / `downloadsSnapshot`
  event. main.js, music.js and podcasts.js never call it after rendering. Scenario: in the app, open Music (or Home, or a podcast
  show) with N finished tracks and nothing in flight: the snapshot arrives at script load, before the rows render, so decorate runs
  over an empty view; the rows render; no "Offline" badge until an unrelated download delta arrives. The row probe measured badges
  by calling `off.decorate(content)` itself (tools/offline-proof/row-probe.js:102,114,122) and offline-ui.test.js:194 does the
  same, so neither proves reachability. Fix: decorate the rendered container at each surface's render path (as tv.js does) and
  bind it through the real render, not a manual decorate.
- WARNING 2 (doc lies + plan deviation: a 503 / ffmpeg loop for tv). lib/offline/routes.js:256 `transcodeFailed: false` for every
  tv episode ("the tv queue tracks no status"), while docs/references/offline-api.md:116 promises for `video`, `tvEpisode` "409
  not playable when ... the transcode already failed" and plan D3 says "terminal, never a 503 loop". Scenario: an mkv episode whose
  ffmpeg exits non-zero: every file-route hit answers 503 + Retry-After 60 and re-queues (lib/tv/routes.js:188-230 keeps no
  failure memory; the running job is already shifted off, so the retry re-pushes); the phone retries every 60 s forever, each
  spawning a full-length ffmpeg of a file that cannot be transcoded; the item never becomes `failed`. Fix: a failed-id set in the
  tv queue the offline route reads (409 `transcodeFailed`), or correct the doc and plan AND cap the re-queue.
- WARNING 3 (one library audio file, two offline identities). main.js:733-740 `cardOfflineKind` maps a library audio item (kind
  'media', type 'audio') to `video`, but that card's href is `/music?play=` (common.js:4826 audioOpenHref) so offline.js:445-451
  `cardTarget` reads it as `track`, and Music's row menu (music.js:4411) uses `track`. Scenario: from a home card's menu, "Make
  available offline" downloads `video:<id>`; the card shows no badge (looks up track:<id>), the Music row shows no badge and still
  offers "Make available offline" -> a second full download as `track:<id>`; "Remove offline copy" on one surface leaves the other.
  Fix: `cardOfflineKind` returns `track` for `item.type === 'audio'` (audioOpenHref's rule) and a test binds menu key == badge key.
- SUGGESTION 1. offline-api.md:156-162 orders the per-event rule visibility (gone) then numbers (invalid); routes.js:565 validates
  numbers first. An invalid event on a hidden item reads `invalid`, not `gone`. Align the doc (or the code).
- SUGGESTION 2 (LESSONS 12). test/integration/route-read-classification.test.js:152: the `/api/offline/file/:kind/:id` line carries
  a second, unrelated comment ("offline D1: the caller's own paired phones (cookie only ...") that belongs on `/api/devices` above.
- SUGGESTION 3 (LESSONS 12). This plan's frontmatter still reads `status: Draft` / `next: hand to an Extreme builder` while the
  Evidence section describes the finished build in gate.
- SUGGESTION 4. gate.js:114 the unknown-token limiter's `check()` is never called (only `recordUnknown`); and a DELETED row reads as
  "unknown", so a revoked phone with >30 queued requests gets 429 (stays queued) instead of 401 (re-pair) for 10 min. Low; a doc
  line or a tombstone check.
- SUGGESTION 5. offline.js:445 CARD_KINDS lists '/watch?v=' which no card builder produces (only /watch.html?v=); harmless.
- Security (standing section): SQL is bound params throughout (devices.js, store.js); ids are own-property lookups on null-safe
  maps; ffprobe runs through execFile with the path as an argument; sendFile paths are the indexed library paths (podcasts
  additionally confined), no user-supplied path reaches the filesystem; no SSRF surface; the Bearer branch runs before the
  allowlist and the noUsers funnel and a claimed ftd_ never falls through; scope is default deny with a census; tokens are
  sha256 rows, never in list responses or the bundle (device-tokens.test.js:282 binds it); the new DOM is textContent or escaped
  attributes (escapeTvHtml / escapeMusicHtml cover quotes). No new exposure found.
- Verified claims: albumKeyFor is lib/music/store.js:103 (the doc is right, the plan's query.js:143 is a caller); tvSeason key =
  groupSeasons' key ('x' for null); the media and music buffers carry `updatedAt` so the in-mutator compare is real; the online
  latches are mirrored (media: watched + Watch later; podcast: played + Watch later; tv: played only, as online); the media and
  tv queues write `.tmp.mp4` and rename; generateSecret = 32 bytes base64url (43 chars).

Gate: CHANGES r1 @30db1f3e — qa

### Adversary r1 @30db1f3e (2026-10-12, measured in a /tmp git-archive sandbox of HEAD; the worktree untouched)

Instruments (Node 22.23.1): `npm run test:unit` 9646 tests, 9635 pass, 9 fail, 2 skipped - the 9 are sandbox artifacts (8 source
locks / censuses shell out to `git ls-files`, which has no .git in a `git archive`; 1 EISDIR on the node_modules symlink; plus
books-first-chapter's 2.5 s linear-time check on a loaded box); those 8 files re-run READ-ONLY in the worktree: 81/81 pass. The
seven integration suites the diff adds or edits (device-tokens, device-scope-census, offline-manifest, offline-progress,
route-read / route-write-classification, rbac-census): 42/42. `npm run lint` 0 errors / 6 standing warnings; `lint:ui` equals the
ratchet; overlay lint 0. Mutants: 47 run against the committed tree, 43 killed, 4 survived (two are findings below, M20b is an
equivalent mutant masked by fieldsOk's own cap, and the two offline.js `localSrc only when done` guards are the SUGGESTION).

- CRITICAL 1 (D4 data loss, plan section 5 surface 1: "the gap between a flush's snapshot and its commit, both orders"). A THIRD order
  loses a newer offline position and tells the phone it landed. The offline mutator is queued on `updateDatabase` while the chain is
  busy (any doc save, scan phase or earlier flush); the 5 s coalescer timer then fires, SNAPSHOTS the buffered online ping P (older)
  and clears the buffer, queuing its commit BEHIND the mutator; the mutator runs, sees an empty buffer and the stale row, writes the
  newer event E and answers `applied:true` (the app drops E from its queue); the flush's unconditional `setProgressBatch` then lands
  P over E. Verified for BOTH buffered kinds with the committed seam: ping v2@10 -> `__holdWriteChainForTests()` -> POST
  /api/offline/progress E (v2@50, at=now) -> wait 150 ms (P still in the buffer) -> `flushPendingProgress()` -> release(): response
  `{applied:true}`, row `{timestamp:10, updatedAt:<P's stamp>}` (expected 50). Music: ping 10, E 60 -> row position 10. The
  committed gap tests (orders A-D) cover only "snapshot taken BEFORE the request is queued". Prescription: in the handler, in the
  SAME synchronous tick as `nowMs()` and the `updateDatabase()` call, snapshot both buffers first (`flushPendingProgress()` +
  `flushPendingMusicProgress()` - they snapshot, clear and enqueue synchronously, so every ping stamped before serverNow commits
  ahead of the mutator) and KEEP the in-mutator live-buffer read (a ping buffered after serverNow is newer than every clamped
  atServer, so it correctly refuses E, or lands after E if a later timer flush snapshotted it). Bind it with an order-E test per kind
  (the repro above as a test), both outcomes: the row holds E and the flush has nothing older to land.
- WARNING 2 (D4 "HTTP 200 even when some refuse; a refusal is not an error"). `validEvent` accepts any finite `at`; a far-off value
  makes `new Date(atServerMs).toISOString()` throw INSIDE the mutator: `sync([ev('video','v3',11,now), ev('video','v4',12,-9e15)])`
  -> 500 `{"error":"Could not sync the positions: Invalid time value"}`, v3 ALREADY WRITTEN (11), v4 not, no `results`. The phone
  cannot drop the poison event (no per-event result), so its whole queue retries forever behind it. Fix: `validEvent` refuses an
  `at` outside the Date range (or, simpler, `at <= 0 || at > 8.64e15` -> `reason:'invalid'`), and the per-event body wraps the
  stamp conversion so one bad event is one `invalid` result, never a batch 500 after partial writes. One test: the batch above is
  200 with `[applied, invalid]`.
- WARNING 3 (D1, the unknown-hash limiter; presence-not-binding, LESSONS 2). (a) The plan rule "a known-but-revoked or expired token
  is NOT counted" has no binding test: mutant M26 (count epoch-mismatch / disabled tokens as unknown) passes all 10
  auth-gate-devices tests. (b) The rule cannot hold for the main revoke path: Settings Remove and the admin Remove DELETE the row, so
  that phone's token IS unknown by construction and its queued range reads count; after 30 in 10 min the phone gets 429 (no
  `deviceRevoked`) for 10 min instead of the 401 the app keys on (QA's SUGGESTION 4 saw the same). Fix (a) with one assertion
  (a revoked-by-epoch token 31+ times is still 401, never 429); for (b) either keep the deleted id's hash as a short tombstone that
  answers 401 uncounted, or state in offline-api.md that a Settings-removed phone may see 429 before 401. Safe to ship once (a)
  binds and (b) is written down.
- SUGGESTION 4 (D5/D6). offline.js's two "localSrc only with `done`" guards (`state()` and `localSrcFor`) are unbound: M23 and M23b
  (return a localSrc for any state) pass 16/16 offline-ui + player tests, so a host that sends `localSrc` with `downloading` would
  play a partial file. One assertion each in offline-ui.test.js (a `downloading` item carrying localSrc yields none).
- NOTE 5 (surface 5, measured, no finding). The kid's token against every scoped route for hidden items (video bytes + thumbnail +
  subtitles under a folder restriction, a library-audio track under a folder restriction, a native track's bytes + art under a path
  restriction, a hidden show's episode + art, a blocked show's episode + thumb + season manifest, the three file routes): 404 each
  while the admin gets 200. `/tvposter/<blocked show>` answers 200 with the NEUTRAL placeholder SVG (no show name) - the same body a
  cookie session and a nonexistent id get; not a leak. The `%` / `#` filename suspicion against `res.sendFile` is refuted at source
  (Express encodeURI then send's decode): `50% off.mp4` and `track #1.mp4` serve 200 like `/video/:id`.

Gate: CHANGES r1 @30db1f3e — adversary

### Security-brief r2 @226dc4f2 (2026-10-12, delta re-confirmation; read-only, no Bash: files read at HEAD, no diff or suite run)

My r1 findings against the fix commit:
- **W1 - FIXED as prescribed (option 1).** lib/auth/devices.js:114-124 keeps `revokedHashes` (token_hash -> ms), bounded at
  REVOKED_MEMORY_MAX 5000 (oldest evicted first, :117-120) and REVOKED_MEMORY_MS 24 h (:267). Every row-deleting path remembers the
  hash BEFORE the delete: `remove` (:234-235), `prune` (:244-245), `removeAllForUser` (:253), the issue-time prune (:182) and the
  list-time expiry prune (:225). lib/auth/gate.js:348-354: a null lookup asks `wasRevokedRecently(token)` and answers 401
  deviceRevoked BEFORE `recordUnknown`, so it is not counted; an epoch-stale row never reaches that branch (it is a found row,
  :362-363). The comment (gate.js:240-244), offline-api.md:45 and the plan now say what the code does. The unit test binds 40
  presentations each of an epoch-stale and a row-deleted token as 401, never 429 (auth-gate-devices.test.js:213-222).
- **W2 - FIXED (differently, stricter).** lib/offline/routes.js:505 refuses `at < 0 || at > sentAt + 5 min`; :567 refuses a negative
  `sentAt`; :569 the 5-min-ahead rule; :583 `atServer = max(0, min(at + skew, serverNow))`. With sentAt in [0, serverNow + 5 min] and
  at in [0, sentAt + 5 min], `at + skew` is finite and atServer lands in [0, serverNow], so `toISOString` (:512) cannot throw. Bound
  by offline-progress.test.js:440-452 (-9e15, 9e15, +6 min, -1 each `invalid` in place, the good event lands, a negative sentAt 400).

What the delta introduces (reviewed for exposure):
- **NOTE (LOW) R2-1 - `remove` remembers a hash the caller does not own.** devices.js:234 `hashById.get(deviceId)` runs BEFORE the
  owner-scoped `DELETE ... WHERE user_id = ? AND id = ?` (:236), so any signed-in user calling `DELETE /api/devices/<n>` for another
  user's device id gets the 404 but still inserts that LIVE token's hash into `revokedHashes`. The entry is inert while the row lives
  (the gate finds the row first, gate.js:347, and only consults the memory on a null lookup), so no auth effect. The only use is
  pollution: ~5000 such calls evict every genuinely revoked hash and re-arm the r1 posture (a removed phone's retries count again).
  Authenticated, cheap, no data or secret at stake. Fix: look the hash up with the same owner scope (`WHERE user_id = ? AND id = ?`)
  or remember only when `res.changes > 0`. Fix-or-accept.
- **Memory exposure - none.** The map holds sha256 hex hashes that already sit in `device_tokens`; nothing logs or returns them:
  `wasRevokedRecently` returns a boolean (:263-269), `revokedMemorySize` a count (:270), `publicDevice` is unchanged. Growth: entries
  come only from rows the store itself deletes (above) - an attacker cannot add arbitrary hashes; a pair-and-remove loop adds one
  per cycle, capped at 5000 entries (well under 1 MB). Oracle: `wasRevokedRecently` is sha256 + `Map.get`; its answer is only visible
  as "counted or not" by the limiter, both branches return the identical 401 body (gate.js:342-343, :354, :360); distinguishing a
  recently revoked token from an unknown one requires presenting that 256-bit token. Verified.
- **Flush-first (routes.js:578-579) - earlier timing of a write the timer makes anyway, not a new write.** `flushPendingProgress`
  (server.js:1090-1116) and `flushPendingMusicProgress` (:4140-4158) snapshot and clear EVERY user's buffered pings and commit them
  through one `updateDatabase` mutator with the same own-property guards the 5 s timer path uses; the content is exactly what the
  timer would commit, only sooner. A token holder cannot author those rows (the buffers are filled only by the online ping routes
  under their own sessions). Cost: an empty buffer returns before touching the chain (:1095, :4145), so a flood of progress POSTs
  causes at most one real flush per buffered window. Verified.
- **tv failed-id Set (lib/tv/routes.js:192-232) - bounded by ids the db knows.** Added only inside `processTvTranscodeQueue` for an
  id that reached `queueTvTranscode`, which the offline route calls only for a RESOLVED (visible, existing) episode (routes.js:257,
  :403) and the tv route for an existing one; deleted on a later success (:226). Read only through `tvTranscodeHasFailed` after the
  visibility check (routes.js:261 -> decideFile), so the 409 `transcodeFailed` cannot name a hidden item. Terminal until restart,
  disclosed in the comment. Verified.
- **MutationObserver (public/js/offline.js:230-257, :266) - no new sink.** Installed only when a host announces `downloads`; the
  callback reads `nodeType` / `classList` and queues ELEMENTS for `decorate`, one rAF batch; `decorate` reads existing `data-id`,
  `href`, `data-episode-id` attributes for prefix matching and inserts chips through `ui.chip` or `createElement` + `textContent`
  (:177-183); no innerHTML. Its own `.offline-badge` chips are skipped and a chip's text update is a text node (nodeType 3), so no
  re-trigger loop. Verified.
- **main.js `cardOfflineKind` (:760-769) - a pure enum mapping** of `item.kind` / `item.type` to the manifest kinds; the result and
  `item.id` go to `offline.runMenuAction` / `menuEntry`, whose `host.post` payload is validated by host-adapter's field table (enum
  kind, id string 1..512). Verified.

No CRITICAL or HIGH introduced or remaining. R2-1 is LOW, fix-or-accept with a one-line scope fix; it does not block.

Gate: APPROVED r2 @226dc4f2 — security-brief

### QA r2 @226dc4f2 (2026-10-12, delta re-confirmation of the r1 findings)

Instruments (Node 22.23.1, this worktree): `npm run lint` "✖ 6 problems (0 errors, 6 warnings)"; `npm run lint:ui` "the live
debt equals docs/ui-exceptions.json"; offline-ui 16/16, auth-devices-store 12/12, auth-gate-devices 10/10, offline-playable 4/4,
player-offline-local-src 3/3, native-bridge-contract 20/20, audio-routing-net 2/2, settings-census 5/5, docs-link 2/2,
docs-diagrams 5/5, exec-plans 3/3, release-ledger 7/7, offline-manifest 11/11, offline-progress 13/13, device-tokens 8/8,
device-scope-census 3/3, route-read 2/2, route-write 4/4, rbac-census 3/3; 0 fail. Not re-run: the full unit suite (r1's one
red was the books wall-clock flake, untouched here).

- W1 (badge reachability): fixed differently from my prescription and better - offline.js:395-426 installs one MutationObserver
  (childList + subtree) when enabled, queues added ELEMENTS, decorates them one pass per frame, skips its own `.offline-badge`
  chips (the chip gets its class before insertion, offline.js:440-441, so a pass cannot re-trigger itself; a text change is a
  text node); `collect()` lets decorate take the added card itself. Bound through a real innerHTML render and an appended card
  with no host event and no explicit call, the pass settling, and no observer without a host (offline-ui.test.js "reachability").
- W2 (tv 503 loop): fixed as prescribed - lib/tv/routes.js:191-194 failed-id Set (added on non-zero exit and process error,
  cleared on success), `tvTranscodeCurrent` stops a re-queue of the running id, `tvTranscodeHasFailed` exported and passed
  (server.js:4703); routes.js:261 reads it, so 409 `transcodeFailed` and `playable:false`; offline-api.md:118-120 discloses the
  process-local memory (one more 503 after a restart). Bound with a stub ffmpeg failing on "Broken": 503 once, then 409, no
  rendition, no temp file, the manifest's reason (offline-manifest.test.js e3).
- W3 (two identities per audio file): fixed as prescribed - main.js:761 `track` for `item.type === 'audio'`, exported; bound
  against common.js audioOpenHref's real href for a plain and a chaptered file (offline-ui.test.js "one offline identity").
- S1 doc order now matches the code (numbers, then visibility; `at` bounds stated). S2 the stray comment sits on `/api/devices`.
  S3 frontmatter updated. S4 devices.js `wasRevokedRecently` (remembered on remove / prune / Remove all / expiry pruning, 24 h,
  bounded 5000) and gate.js:349-353 answers 401 uncounted; bound 40 + 40 presentations. S5 '/watch?v=' dropped.
- New in the delta, checked: the order-E flush (routes.js:572-573) runs in the handler's synchronous tick and both flushes
  snapshot, clear and chain their commit synchronously (server.js:1090-1098, 4140-4148), so every ping stamped before serverNow
  commits ahead of the mutator while the in-mutator read still covers later pings; `at` bounds + `Math.max(0, ...)` clamp and
  `sentAt < 0` -> 400. `remove()` remembers the hash before the ownership check (devices.js:234-235): harmless, a live row is
  found by lookup before the memory is consulted. Nothing new found.
- Security: unchanged posture; the new memory holds hashes only, never tokens.

Gate: APPROVED r2 @226dc4f2 — qa

### Adversary r2 @226dc4f2 (2026-10-12, delta re-review in a fresh /tmp git-archive sandbox of HEAD; the worktree untouched)

Instruments (Node 22.23.1): `npm run test:unit` 9650 tests, 9640 pass, 8 fail, 2 skipped - the 8 are the same sandbox artifacts
(`git ls-files` source locks / the symlink EISDIR; those files re-run READ-ONLY in the worktree: 69/69). 15 integration suites
(the four offline / device suites, the census, the three route classifications, progress-coalescer, music-api, api, feed-progress,
feed-stale-continue, user-management, backup-restore, history-api): 173 tests, 172 pass, 1 fail = progress-coalescer AC4.1, the
known #238 timing ratio; re-run alone 3x with the unit suite loading the box: 2 pass, 1 the same ratio miss; that file has zero
references to the offline route, and the flush-first call runs only inside a sync request, so the delta cannot reach it. Lint 0
errors / 6 standing warnings; lint:ui equals the ratchet; overlay 0.

- CRITICAL 1: fixed as prescribed and VERIFIED. My order-E repro against 226dc4f2: media ping 10 -> hold -> sync E@50 -> flush
  snapshot -> release = `applied:true`, row 50 (was 10); music 10 / 60 = row 60 (was 10); the older-offline arm refuses with the
  online value standing; a ping that arrives WHILE the mutator waits (after the handler's flush) is newer and refuses the event.
  Binding: removing both flush-first lines reddens the committed order-E test (and two neighbours); removing only the music flush
  reddens it too. The flush's own `.catch` keeps a rejected flush from reaching the handler and the chain's `run.catch` keeps it alive;
  `__holdWriteChainForTests` ordering unchanged. Nothing new found in the coalescer path.
- WARNING 2: fixed differently (bounds on `at` instead of a per-event try): `[valid, at:-9e15, at:9e15, at:now+6min]` -> 200 with
  `[applied, invalid, invalid, invalid]`, the good event written, nothing for the poison; `sentAt:-5` -> 400. Removing the bounds (or
  only the lower bound) and removing the `Math.max(0, ...)` clamp each redden a committed test. Evaluated the deviation: correct, and
  `atServer` is now provably inside [0, serverNow] so `toISOString` cannot throw.
- WARNING 3: (a) M26 (count an epoch-stale / disabled token as unknown) now goes RED (auth-gate-devices 9/10); (b) the deleted-row
  path is covered by the revoked-hash memory: removing the gate's tombstone check, the remove() memory, the Remove-all memory or the
  24 h expiry each redden a committed test. Read the new code: the memory is only consulted when the hash lookup MISSES, so a live
  token is never affected by it (remove() remembering a hash it did not own is harmless); FIFO-bounded at 5000 x 24 h.
- SUGGESTION 4: `state()` now binds (M23b red); the `localSrcFor` guard (M23) still survives, but only because `state()` already
  strips localSrc from a non-done item - an equivalent mutant now, defence in depth, not a gap.
- NEW (QA's items in the delta): tv failed-transcode memory binds (dropping the `add` on a failed exit reddens the tv manifest
  test); the MutationObserver is created only under `if (enabled)` and skips its own chips, so a no-host DOM stays byte-identical
  (offline-ui no-host tests green). No new finding.

Gate: APPROVED r2 @226dc4f2 — adversary

### Security-brief r3 @00ede12f (2026-10-12, delta re-confirmation after the v1.386.0 merge; read-only, no Bash: files read at HEAD, no diff or suite run)

Could NOT run: `git diff 226dc4f2..00ede12f` and the suites. I read the merged code where it now sits beside this wave's
(server.js, lib/jsonCompression.js, lib/staticAssets.js, lib/music/routes.js, lib/db/featureStore.js, lib/media/jsonRowStore.js) and
the offline test file's structure. The r1 / r2 product files I re-checked (gate.js, devices.js, offline/routes.js) read as at r2.

- **jsonCompression (server.js:586, lib/jsonCompression.js) - cannot touch a device-token refusal or a byte stream.** The hook
  replaces a body only when `req.method === 'GET'` (:28), `res.statusCode === 200` (:37), Content-Type is `application/json`, no
  `Content-Encoding` is set, the head is not yet sent and the body is >= 8 KB (:39). Every gate refusal is a 401 / 403 / 429 (never
  200) and well under 8 KB, so the bodies the app keys on are byte-identical to r2. `POST /api/offline/status` and `/progress` are
  POSTs; the file route's `res.sendFile` is `video/...` or `audio/...`, 206 or 200 with the head already written (`headersSent`),
  so it passes through. The ONE device-reachable answer it compresses is `GET /api/offline/manifest` (JSON, 200, can exceed 8 KB for an
  album or season), plus `/api/auth/me` only if it ever grows past 8 KB. Exposure: compression of an authenticated response is a
  BREACH-shaped concern only when the response mixes a SECRET with attacker-chosen reflected text; the manifest echoes the caller's
  `kind` / `id` but carries no secret (titles, relative URLs, stamps), `/api/auth/me` reflects nothing, and no GET response anywhere
  carries a token (the token is a 201 POST body, never compressed). Verified; no finding.
- **Static assets (lib/staticAssets.js) run AFTER the gate: order unchanged.** `app.use(authGate)` is at server.js:3177;
  `staticAssets.middleware` is installed at :3551, behind the shell catch-all (:3530) and ahead of `express.static` (:3555). So
  `/js/offline.js` (not in ALLOW_EXACT, gate.js:109-145) still needs a session, and a device token gets the scope 403 for it, as for
  every `/js/*`. The ten shells' new `<script src="/js/offline.js">` (index, watch, music, tv, podcasts, history, setup, stats, books,
  read) is rewritten generically by `rewriteHtml` (:140-150, every `<script src>` under a static folder gets `?v=<sha256 prefix>`); the
  gate's `isAllowlisted` strips the query before matching (gate.js:166), so the stamp cannot change any auth decision. `absFor`
  (:75-82) refuses dot-segments, NUL and anything outside `public/` and only ever serves STATIC_DIRS; a Range request falls through
  to express.static (:168); a bogus `v` only yields `no-cache` (:176). The middleware is a plain file server with no view of
  `req.user`, so nothing in it can widen what a token reaches. Verified.
- **`readPartShared('tracks')` (lib/music/routes.js:675 and siblings) - same rows, same gate, frozen.** `getAllShared`
  (lib/media/jsonRowStore.js:161-168) returns a deep-frozen snapshot of the same `getAll()` rows, rebuilt when the table's write
  counter moves, uncached inside a transaction; `/track/:id` still runs `ownTrack` then `trackVisibleTo` on each row (:676-678). The
  offline resolvers are untouched: lib/offline/routes.js:120 still reads `musicDb.read()` and filters through `trackVisibleTo` +
  `projectedLibraryTracks(req)`, so a restricted member resolves exactly as at r2, and the bytes route it names applies the same
  predicate to the same record. A frozen record cannot be mutated by a reader, which only removes a class of accidental write.
  Verified; no finding.
- **00ede12f (test-only).** The coordinator reports a change to test/integration/offline-progress.test.js only (the diverging-kinds
  visibility test at :307 gives each pass its own moment). I could not diff it; the test list and every product file I read match
  r2 plus the merge. Recorded as reported, not as verified.

No new finding. Nothing from r1 / r2 regressed (R2-1, LOW, stands as fix-or-accept). No CRITICAL or HIGH.

Gate: APPROVED r3 @00ede12f — security-brief

### QA r3 @00ede12f (2026-10-12, delta: the v1.386.0 merge 354eedd1 and the test-only fix 00ede12f)

Instruments (Node 22.23.1, this worktree, at 00ede12f): `npm run lint` "✖ 6 problems (0 errors, 6 warnings)"; `npm run lint:ui`
"the live debt equals docs/ui-exceptions.json"; offline-progress 13/13 three times; docs-link-census 2/2, docs-diagrams-census 5/5,
exec-plans-census 3/3, release-ledger 7/7, static-assets 6/6 (main's new test over the shells, which carry /js/offline.js);
offline-manifest 11/11, device-tokens 8/8, offline-ui 16/16; 0 fail. Not re-run: the full suite (the coordinator's run on the
merged tree, 12415 / 12404 / 1 fail, is quoted, not re-derived; the one red is the test this commit fixes).

- 00ede12f (test-only): correct and binds the same semantics. The second pass replayed the kid's visible event at the SAME `at`,
  which strict newer-wins (routes.js newerWins, `>`) rightly reads as `older`; each pass now has its own moment (cookie pass at
  now - 1 s, token pass at now) and the assertion is unchanged. The product is untouched (`git show --stat`: one test file).
- 354eedd1 (the merge): the branch's hunks survive - server.js deviceStore (301), the gate's `devices:` (3175), the audit `via=`
  (3239), offlineRoutes.registerRoutes with tvTranscodeHasFailed and both flushes (4704-4729); lib/music/routes.js keeps the
  hoisted, exported MUSIC_CONTENT_TYPES (839). Main's music refactor (readPartShared, visibleMusicList) left
  `projectedLibraryTracks(req, nativeTracks)` (server.js:4341) as the offline routes receive it. ROADMAP.md: one v1.386.0 and one
  v1.387.0 Shipped entry, v1.386.0 first, nothing lost or doubled. docs/DEVICE-CHECKS.md: "Speed pass (v1.386.0)" then "Offline
  playback (v1.387.0)" with its 10 lines intact. DIAGRAMS.md: 67 tables / schema 37 kept, main's ROUTES count line merged.
- SUGGESTION A (LESSONS 12; pre-existing since W2, my miss at r1, not from the merge): lib/music/routes.js:33-36 says
  MUSIC_CONTENT_TYPES "sit[s] at the top of registerTrackRoutes", but W2 hoisted it to the module's bottom (line 839) and exported
  it. Update the header comment in the close-out commit.
- SUGGESTION B (merge resolution, cosmetic): ROADMAP.md:841-842 has no blank line between v1.386.0's last bullet and the
  `### v1.387.0` heading (CommonMark still renders the heading; the file's convention is a blank line).
- Tree: `git status` shows the plan doc and docs/exec-plans/tech-debt-tracker.md STAGED (the coordinator's gate bookkeeping for
  the close-out commit, left alone) plus this block; no untracked files.

Gate: APPROVED r3 @00ede12f — qa

### Adversary r3 @00ede12f (2026-10-12, delta re-review: the main merge 354eedd1 + the test-only 00ede12f; fresh /tmp git-archive sandbox of HEAD)

Instruments (Node 22.23.1): `npm run test:unit` 9705 tests, 9695 pass, 8 fail, 2 skipped - the 8 are the standing sandbox artifacts
(`git ls-files` source locks / the symlink EISDIR), re-run READ-ONLY in the worktree: 69/69. Eleven integration suites (the four
offline / device suites, the census, the three route classifications, progress-coalescer, music-api, and main's two overlap suites
static-assets-shells + music-shared-snapshot-routes): 87/87 (AC4.1 green this run).

- The test-only change (00ede12f) weakens no binding: against this sha, M26 (count a known-revoked token) is red 9/10, M23b (localSrc
  from a non-done item) red 15/16, dropping the flush-first lines reddens the order-E test (+2), dropping the `at` bounds reddens the
  poison test, dropping the podcast or the video visibility check in the sync reddens the very test that changed (its 'gone' arm still
  binds, only the visible event's moment moved), and newerWins `>=` is red (17 tests, 1 fail). The change is correct: a second event
  at the SAME moment is 'older' by the product's strict rule, so the old test passed on request latency.
- The merged main code does not touch this wave's guards (measured, not read): every served shell (/, /music, /tv, /podcasts,
  /watch.html, /setup.html, /history, /stats.html) carries `/js/offline.js?v=<hash>` IMMEDIATELY after `/js/host-adapter.js?v=<hash>`
  (the staticAssets rewrite versions the new tag like the rest); /login carries host-adapter and no offline.js; the bare
  `/js/offline.js` answers 200 `no-cache`. The manifest is byte-identical with `Accept-Encoding: gzip` and `identity` (jsonCompression
  compresses only a 200 JSON body of >= 8 KB; a big album manifest would gzip, which iOS URLSession decodes transparently). The
  offline resolvers keep reading `musicDb.read()` (the live namespace) while /track and the music lists moved to readPartShared's
  frozen snapshot - two reads of the same rows, no shared mutable state, and the kid's token still gets 200 on a visible track
  manifest and 404 on the hidden ones (the visibility test). The offline file route's Range / If-Range / HEAD tests are green with
  jsonCompression installed (it ignores non-JSON bodies).

Gate: APPROVED r3 @00ede12f — adversary
