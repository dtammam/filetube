# The offline playback API (the iOS app's reference)

What the FileTube app (`filetube-ios`) is written against for offline playback: pairing a phone, the download manifest,
the file route, the catalogue re-check and the offline position sync. Shipped in v1.387.0 (the server half of
[ios-offline.md](ios-offline.md)); the bridge messages the web uses to ask the app for downloads are in
[native-bridge.md](native-bridge.md). Words: the feature is "offline playback" ("Make available offline", "Remove offline
copy", the "Offline" badge); "Downloaded" means the server has a podcast file, "Save to device" is the browser save.

The app requires iOS 18. Every row of the playability table below was measured on an iPhone XS (iOS 18.7.10) and an iPhone
15 Pro (iOS 27.0.1), in AVPlayer from a local file and in the web view through the app's URL scheme. The app still checks
`AVURLAsset.isPlayable` after each download and reports `failed` (error `other`) for a file a future iOS cannot play.

## 1. Pairing: the per-device token

Pairing happens ONCE, from the signed-in web view: native code asks for the account password in its own prompt and posts it
with the web view's cookies (no secret crosses the JS bridge). The token comes back once and goes into the Keychain.

`POST /api/devices` (cookie session only; `Content-Type: application/json`)

```json
{ "name": "Dean's iPhone", "platform": "ios", "password": "..." }
```

- `201 { id, token, name, platform, createdAt }`. `token` is `ftd_` + 43 url-safe characters; it is shown exactly once.
- `401 { error: "That password is not right." }` (the login rate bucket applies: 8 tries, then 429 with `retryAfterSec`).
- `400` a bad `name` (1..64 characters) or `platform` (only `ios`); `415` a body that is not JSON; `409 { error: "too many
  devices" }` past 20 live tokens for the account; `403 { error: "not available to devices" }` when the request itself came in
  on a device token (a token never mints a token).

The header from then on: `Authorization: Bearer ftd_...`. Only a Bearer value starting `ftd_` is read as a device token; the
token is stored on the server as its sha256 only.

Answers the app keys on, for every route below:

| Status | Body | Meaning | What the app does |
|---|---|---|---|
| `401` | `{ "error": "device token revoked", "deviceRevoked": true }` | unknown token, revoked in Settings, "Remove all devices", the account's password changed, the account disabled or deleted, or 180 days unused | stop every download and offer to pair again |
| `403` | `{ "error": "not available to devices" }` | a valid token on a route outside its scope (anything but the routes here, the byte and art routes the manifest names, `GET /api/auth/me` and `GET /api/host-info`) | an app bug; never retry |
| `404` | the route's own neutral body | the item does not exist OR this account cannot see it (indistinguishable by design) | treat as gone |
| `409` | `{ "error": "not on server yet" }` | a podcast episode the server has not downloaded | keep it listed, retry later |
| `409` | `{ "error": "not playable on this device", "reason": "..." }` | the file cannot be served in a form iOS plays (see section 3) | terminal: never retry, say so |
| `429` | `{ "error": "too many attempts", "retryAfterSec": n }` | 30 UNKNOWN tokens from one address in 10 minutes (a valid token is never blocked) | wait `Retry-After` |
| `503` | `{ "error": "transcoding" }` + `Retry-After: 60` | a needed transcode is not cached yet; it has been queued | retry after the header's seconds |

Revocation is live: a revoke, a password change, a disable or a delete also ENDS any download the device has open at that
moment (the stream closes short). A token unused for 180 days is dead; every use slides it. Re-enabling a disabled account
restores its devices. A users-replacing restore of a backup drops every device row, so every phone pairs again (tokens never
ride backup bundles). Logout in the web view does NOT revoke devices.

Settings > Account > Devices lists the account's devices (name, added, last used) with Remove; an admin sees and removes any
user's devices from the Users panel, including "Remove all devices".

## 2. The download manifest

`GET /api/offline/manifest?kind=<kind>&id=<id>` (device token or cookie)

`kind`: `track` | `album` | `podcastEpisode` | `video` | `tvEpisode` | `tvSeason` (add-only). Ids:

- `track`: a native music track's id, a library audio item's media id (an audio file shown in Music), or a chapter row
  `<mediaId>::c<n>`. A chapter row answers with its PARENT file, once, with the file's chapters; the app maps every chapter
  row of a file to the parent's state.
- `album`: the album key the album page uses (`<album artist or artist>` + U+001F + `<album>`, `albumKeyFor` in
  lib/music/store.js); the manifest lists the album's visible tracks in album order (a chaptered file is one item).
- `podcastEpisode`: the episode id. `video`: the media id. `tvEpisode`: the episode id.
- `tvSeason`: `<showId>:<season key>`, the key being the season number, or `x` for Extras (episodes with no season).

Response `200 { kind, id, title, items: [ item... ] }`; a single-item kind has one item, an album or season its visible
members in order. A hidden or missing single item is a neutral `404`; a collection silently OMITS members this account cannot
see and is `404` only when none remain. `400` for a bad kind or id.

Each item:

```json
{
  "kind": "video", "id": "3f2a...", "title": "Cartoon", "subtitle": "Kids Channel",
  "album": null, "trackNumber": null, "season": null, "episode": null, "durationSec": 1234,
  "file": { "url": "/api/offline/file/video/3f2a...", "bytes": 734003200, "mime": "video/mp4",
            "fingerprint": "734003200-1760000000000", "ready": true, "playable": true },
  "artwork": { "url": "/thumbnail/3f2a..." },
  "chapters": [ { "startSec": 0, "title": "Intro" } ],
  "subtitles": [ { "lang": "und", "label": "Subtitles", "url": "/api/subtitles/3f2a..." } ],
  "progress": { "positionSec": 42.5, "durationSec": 1234, "updatedAt": "2026-10-11T20:00:00.000Z" },
  "finished": false
}
```

- `subtitle` is the artist (tracks), the show (podcasts, TV) or the channel (videos). `season` / `episode` only for TV;
  `album` / `trackNumber` only for tracks. `artwork` is `null` when there is none. `chapters` come from the file (videos
  and library audio; manual edits win); `subtitles` only for videos with a sidecar (TV has none today).
- `progress` is this account's saved position (`null` when never played); `finished` is the watched / played latch
  (always `false` for music, which has no latch).
- `file.fingerprint` is `<bytes>-<mtime ms>` of the SOURCE file, even when the file route serves a transcode: a transcode
  cache eviction never reads as "changed". `file.bytes` is the size the file route will serve when known (`null` while a
  transcode is pending), `file.mime` its type (the app sends it as Content-Type through its scheme; WebKit sniffs anyway).
- `file.ready` is `false` while a needed transcode is not cached yet (the file route queues it; retry later);
  `file.playable` is `false`, with a `reason`, when iOS can play neither the original nor any transcode.
- Ids are md5(path): a moved or renamed file gets a NEW id, and its offline copy reads as gone (404) at the next check.

## 3. The file route and the iOS playability rule

`GET /api/offline/file/<kind>/<id>` (`kind` a single-item kind) serves the file the rule picks, through `res.sendFile`: full
Range support including suffix ranges, `ETag`, `Last-Modified`, `If-Range`, `HEAD`; `Cache-Control: private, no-store`;
the manifest's mime as `Content-Type`. iOS background downloads resume from resume data, which needs the validator: a
transcode cache eviction between two resumes changes the ETag, and the app restarts that one file (the source fingerprint is
unchanged, so nothing else re-downloads). A served transcode is marked live, so the cache's LRU sweep leaves it alone while
the download runs.

The rule (lib/offline/playable.js, one pure function):

| Kind | Served as the ORIGINAL when | Otherwise |
|---|---|---|
| `video`, `tvEpisode` | container `.mp4` / `.m4v` / `.mov`, video `h264` (or `hevc` tagged `hvc1`), audio `aac` / `mp3` / `alac` / `flac` / `ac3` / `eac3` / `pcm*` / `opus` (or an unprobed codec) | the existing H.264 + AAC MP4 transcode (`503 transcoding` until cached); `409 not playable` when ffmpeg is absent or the transcode already failed |
| `track` (native), library audio | container `.m4a` / `.mp3` / `.aac` / `.flac` / `.wav` / `.caf` / `.ogg` / `.oga` / `.opus` (or an mp4-family container), audio codec as above or `vorbis` | `409 not playable` (`reason: container` or `audioCodec`); audio is never transcoded (ALAC and FLAC stay lossless) |
| `podcastEpisode` | extension `.mp3` / `.m4a` / `.aac` / `.mp4` / `.ogg` / `.oga` / `.opus` (no stored codec) | `409 not playable` |

Device results behind the table (2026-10-11/12): mp4 h264 + aac / eac3, mp4 hevc `hvc1`, mov h264 + pcm, m4v h264 + ac3,
m4a alac, m4a aac, mp3, flac, wav, ADTS aac, caf, mp4 h264 + opus, ogg vorbis and .opus all PLAY; mp4 hevc `hev1` (a
black, silent-picture video), mkv and webm are refused and take the transcode side. One test artifact worth knowing: on iOS
27 a MUTED `<audio>` element loads mp3, flac, ADTS aac, ogg and opus but its time never advances; FileTube's player plays
unmuted, so it is unaffected. The HEVC codec TAG is not in the server's index: the manifest runs one lazy, cached ffprobe for
an HEVC item; an unknown tag takes the transcode side.

## 4. The catalogue re-check

`POST /api/offline/status { "items": [ { "kind", "id", "fingerprint" } ] }` (at most 500 items, single-item kinds)

`200 { "items": [ { "kind", "id", "state": "ok" | "changed" | "gone" } ] }` in request order. `gone` = deleted, moved
(a new id) or now hidden from this account: the app REMOVES the copy (the restriction must win on the phone too). `changed`
= a new source fingerprint: the app offers to refresh. One call on launch re-checks the whole catalogue. `400` for a bad
shape.

## 5. The offline position sync

`POST /api/offline/progress` (device token or cookie)

```json
{ "sentAt": 1760230000000,
  "events": [ { "kind": "video", "id": "3f2a...", "positionSec": 612.4, "durationSec": 1234, "at": 1760229000000, "finished": false } ] }
```

At most 200 events. `kind` is `track` | `podcastEpisode` | `video` | `tvEpisode` (a chapter row id writes its parent
file's position); `at` is the epoch ms when the position was reached ON THE PHONE; `sentAt` the phone's clock when this
request is sent; `finished: true` sets the item's watched / played latch (sticky) whatever the comparison says.

**The request is a normal foreground request whose body is built immediately before it is sent, never an iOS background
upload task**: a background upload fixes the body, `sentAt` included, when the task is created, and iOS may send it hours
later; the server would read that delay as clock skew and push old events past newer laptop writes. The app re-stamps every
retry. A batch whose `sentAt` is more than 5 minutes AHEAD of server time is refused with `400 { "error": "restamp" }`;
the app re-stamps and retries (a phone whose clock is far ahead cannot sync until its clock is fixed).

The rule, per event, in order:

1. Clock correction: `skew = serverNow - sentAt`, `atServer = min(at + skew, serverNow)`. A phone minutes or years BEHIND
   compares correctly; residual error = network latency plus any clock change on the phone between `at` and `sentAt`.
2. The item is resolved through this account's visibility: hidden or missing = `{ "applied": false, "reason": "gone" }`.
3. The numbers are checked (finite, `positionSec >= 0`, `durationSec > 0`, position at most one second past the duration):
   `{ "applied": false, "reason": "invalid" }` otherwise.
4. NEWER WINS: the event lands only when `atServer` is strictly later than the stored position's `updatedAt` (a missing or
   unparsable stored stamp is the oldest possible); else `{ "applied": false, "reason": "older", "stored": { positionSec,
   durationSec, updatedAt } }`. Not forward-only: a rewind on the phone that is newer than the server's position is real
   intent and wins. The comparison includes the server's own write buffer (an online ping not yet flushed), so a laptop
   position seconds old is never overwritten by an older phone position.
5. The stored stamp becomes `atServer` as an ISO string (never the phone's string), and the same consequences an online
   play reaching that position has: the watched latch at 90% (videos, TV) or the played latch at 95% (podcasts), and a
   finished video or episode leaves Watch later. No presence is announced (an offline replay never shows as "playing now").

`200 { "results": [ ... ] }` in event order, one `{ kind, id, applied: true, updatedAt }` or a refusal per event; a refusal is
not an error (the app drops refused events from its queue). Replaying a batch changes no position (the strict rule; a
replayed stamp can move by the request latency). Not synced in this release: music play counts.

## 6. The byte and art routes a device token may reach

`GET /track/:id`, `/episode/:id`, `/video/:id`, `/tvepisode/:id` (the web player's byte routes, for playing online from the
server), `/albumart/:id`, `/thumbnail/:id`, `/tvthumb/:id`, `/tvposter/:showId`, `/podcastart/:subId`,
`/api/subtitles/:id`, plus `GET /api/auth/me` and `GET /api/host-info`. Everything else is `403`. Every one applies this
account's restrictions exactly as a browser session does (a kid's phone cannot fetch a hidden file's bytes or art).

## 7. Disclosed limits

- Ids are md5(path): moves and renames read as gone. A transcode cache eviction (5 GB LRU by default) changes a served
  transcode's ETag; the app restarts that file. Re-enabling a disabled account restores its devices.
- Cleanup suggestions date watched items by `updatedAt`, so an item finished offline long ago is suggested sooner
  (suggestions only). A restored backup keeps any far-future stamp it carried and blocks offline sync for that item until the
  next online write.
- TV has no subtitle sidecar route; music play counts are not synced; books are not offline items.
