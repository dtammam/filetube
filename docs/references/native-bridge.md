# The native bridge (contract v1)

The contract between FileTube's web UI and a native host (today: the iOS app, `filetube-ios`). Why it exists and the rules
around it: [ios-host.md](ios-host.md). The machine-readable authority is
[native-bridge.v1.schema.json](native-bridge.v1.schema.json); this page explains it. If the two disagree, the schema wins and
this page is fixed.

## Rules

- **Add-only within v1.** A new message type or a new optional field is fine; renaming or removing anything needs v2.
- **Both sides ignore what they do not know.** Unknown message types and unknown fields are ignored, never errors.
- **Fire and forget, web to native.** No web-to-native message waits for a reply; native-to-web news arrives as events.
- **The host releases every capability request** (orientation lock, hidden status bar, battery and network subscriptions) on
  every main-frame navigation commit and when the web view goes away. A page restored from the back-forward cache (`pageshow`
  with `event.persisted`) must re-post every capability request it still holds.
- **Only the configured server.** Native accepts a message only from the main frame whose security origin equals the server
  origin the user configured.

## 1. Discovery (native injects, web reads)

Before any page script runs (a `WKUserScript` at document start, main frame only), the host defines:

```js
window.FileTubeHost = {
  bridge: 1,                       // the contract major version
  app: { name: 'filetube-ios', version: '0.1.0', build: '1' },
  platform: 'ios',                 // informational only; the web never branches on it
  capabilities: ['orientation', 'haptics', 'battery', 'serverSettings', 'statusBar', 'network', 'downloads', 'mediaFetch', 'nativeAudio'],
  post: function (msg) { window.webkit.messageHandlers.filetube.postMessage(msg); }
};
```

The web reads it once, through `public/js/host-adapter.js`. No `window.FileTubeHost` (every browser, the PWA) = no host: the
adapter's calls are silent no-ops and nothing changes.

**`mediaFetch` (v1.391.0, add-only).** A pure declaration: it has no messages and no events. It means "this host build may show
the web's server-side downloader UI" (the Subscriptions page, the header and bottom-nav Download entries, the watch page's
Subscribe, Pin and Re-pull controls, and the Settings Downloads section). The web shows that UI when there is no host, or when
the host announced `mediaFetch` (`host.allowsMediaFetch()`); with a host that did not announce it, none of it renders and the
web never asks the server's downloader health route. The App Store build leaves it out. It is separate from `downloads`
(native offline copies), which is untouched.

## 2. Web to native messages

Every message is a plain object `{ v: 1, type: '<type>', ... }`.

| type | fields | capability | what native does |
|---|---|---|---|
| `host.hello` | `web: { version }` (the server's FileTube version) | (always) | logs it; may show "server too old" |
| `orientation.lock` | `orientation: 'portrait'` | `orientation` | locks the app to portrait now, whatever the phone's own rotation lock says |
| `orientation.unlock` | (none) | `orientation` | returns to the app's normal rotation |
| `haptics.prepare` | (none) | `haptics` | warms the haptic engine (sent at the start of a wheel gesture) |
| `haptics.tick` | `style: 'detent' \| 'letter' \| 'snap'`, optional `intensity` 0..1 | `haptics` | plays one Core Haptics transient |
| `battery.subscribe` | (none) | `battery` | starts sending `battery` events (one immediately) |
| `battery.unsubscribe` | (none) | `battery` | stops them |
| `host.openServerSettings` | (none) | `serverSettings` | shows the native server address screen |
| `statusBar.hide` | (none) | `statusBar` | hides the system status bar now (v1.385.0) |
| `statusBar.show` | (none) | `statusBar` | restores it |
| `network.subscribe` | (none) | `network` | sends one `network` event now, then one per change |
| `network.unsubscribe` | (none) | `network` | stops them |
| `downloads.add` | `kind: 'track' \| 'album' \| 'podcastEpisode' \| 'video' \| 'tvEpisode' \| 'tvSeason'`, `id` (string, 1..512) | `downloads` | makes the item available offline: native fetches `GET /api/offline/manifest` itself with its device token (docs/references/offline-api.md) and downloads every item the manifest lists; nothing else crosses the bridge (v1.387.0) |
| `downloads.remove` | `kind`, `id` (as above) | `downloads` | removes the offline copy; for an `album` or `tvSeason` native removes every member it holds |
| `downloads.subscribe` | (none) | `downloads` | sends one `downloadsSnapshot` now (every item the phone holds or is working on), then one `download` event per change |
| `downloads.unsubscribe` | (none) | `downloads` | stops them |
| `downloads.show` | (none) | `downloads` | opens the native Downloads screen |
| `audio.load` | `queue: [Item]` (at most 2000), `index`, `positionSec`, `autoplay: boolean`, `modes: { autoplay, shuffle, loop: 'off' \| 'one' }`, `rate` 0.5..3, `rev` | `nativeAudio` | replaces its queue with the WHOLE list, loads item `index` at `positionSec` (clip-relative for a clip Item) and plays when `autoplay`; `rev` stamps every snapshot it sends back (v1.397.0) |
| `audio.play`, `audio.pause`, `audio.stop` | (none) | `nativeAudio` | play / pause the current item; stop ends the session (the queue is dropped, the lock screen clears) |
| `audio.seek` | `positionSec` (clip-relative for a clip Item) | `nativeAudio` | seeks the current item |
| `audio.skip` | `to: 'next' \| 'previous'` | `nativeAudio` | the lock-screen step: the next or previous queue item (`previous` inside the first seconds restarts the item, as iOS does) |
| `audio.jump` | `index` | `nativeAudio` | plays queue item `index` from its start (a tap on an up-next row) |
| `audio.setModes` | `modes` (as in `audio.load`) | `nativeAudio` | applies the modes now: `loop: 'one'` repeats the current item (a clip Item: the chapter, D6); `autoplay` off = stop at the end of the queue and ask for no radio |
| `audio.setRate` | `rate` 0.5..3 | `nativeAudio` | the playback speed, kept across items |
| `audio.sleep` | `mode: 'off' \| 'minutes' \| 'endOfItem'`, `minutes` 1..720 (required with `'minutes'`) | `nativeAudio` | arms, re-arms or clears the sleep timer; when it fires native pauses and reports `sleep.mode: 'off'` |
| `audio.subscribe` | (none) | `nativeAudio` | sends one full `audioState` now, then one per real change, plus `audioTick` about once a second while playing |
| `audio.unsubscribe` | (none) | `nativeAudio` | stops them (playback goes on) |

## 3. Native to web events

Native calls `window.dispatchEvent(new CustomEvent('filetube-host', { detail }))` with `detail = { v: 1, type, ... }`:

| type | fields | when |
|---|---|---|
| `battery` | `level` 0..1 (or null when unknown), `state: 'unplugged' \| 'charging' \| 'full' \| 'unknown'` | on subscribe, then on every change |
| `network` | `connection: 'wifi' \| 'cellular' \| 'wired' \| 'other' \| 'none'` (required), optional `constrained: boolean` (Low Data Mode), `expensive: boolean` | on subscribe, then on every change |

| `download` | one ITEM: `kind: 'track' \| 'podcastEpisode' \| 'video' \| 'tvEpisode'`, `id`, `state: 'none' \| 'queued' \| 'downloading' \| 'paused' \| 'waitingForWifi' \| 'done' \| 'failed'` (required); optional `progress` 0..1, `bytes`, `totalBytes`, `error: 'network' \| 'storageFull' \| 'revoked' \| 'notOnServer' \| 'notReady' \| 'notPlayable' \| 'other'` (only with `failed`; `notPlayable` = the server's 409 or the app's own AVURLAsset.isPlayable check, terminal), `localSrc` (only with `done`), `parentKind: 'album' \| 'tvSeason'` + `parentId` (only for a member of an album or season add) | after a subscribe, on every change of an item (v1.387.0) |
| `downloadsAddFailed` | `kind` (any `downloads.add` kind), `id` (string, 1..512, the id the web sent), `error` (the `download` error enum), all required | once per `downloads.add` that cannot produce any member (an `album` / `tvSeason`) or cannot start (a single item that never reached a `download` event) (v1.387.1) |
| `downloadsSnapshot` | `items`: an array (at most 10000) of the `download` fields above, one element per item the phone holds or is working on | once, in answer to every `downloads.subscribe` |
| `audioState` | `rev`, `queue: [Item]` (native's whole queue, radio appends included), `index`, `state: 'idle' \| 'loading' \| 'playing' \| 'paused' \| 'ended' \| 'failed'`, `positionSec`, `durationSec` (both clip-relative for a clip Item; 0 while unknown), optional `bufferedSec`, `rate`, `modes`, `sleep: { mode, endsAt? }`, optional `error` (the `audioError` enum, only with `failed`) | on subscribe, then on every real change: a new item, play / pause, a seek, the end of the queue, a mode / rate / sleep change, a failure (v1.397.0) |
| `audioTick` | `rev`, `positionSec`, optional `bufferedSec` | about once a second while playing; never while paused |
| `audioError` | `id` (the Item's id), `error: 'network' \| 'notPlayable' \| 'revoked' \| 'notOnServer' \| 'other'` | once per item native could not play (it then skips to the next item, or ends with `state: 'failed'` on the last) |

The connection kind is `connection`, not `type`: the envelope's own `type` is `'network'`. The web reads a connection value it
does not know as `'other'`.

**Downloads (v1.387.0).** `kind` on a `download` event is always a single-item kind: an `album` or `tvSeason` add reports its
MEMBERS, each carrying `parentKind` + `parentId`, and the web rolls the album or season badge up from them.
`state: 'none'` means the item is not on the phone: after a `downloads.remove`, after a server `gone` (404) made native delete
the copy, or after a cancel. A chapter row (`<mediaId>::c<n>`, a chaptered audio file shown as an album in Music) is the WEB's
concern: public/js/offline.js reads and sends the PARENT id (`<mediaId>`) for any chapter row, so native only ever sees and
reports the parent (the manifest's item id). The web treats an unknown `state` as `'none'` and an unknown `error` as `'other'`; a bad optional
field drops that field, not the event; in a snapshot a bad element drops that element, not the snapshot (more than 10000
elements drops the whole event; the app never sends one). The web REPLACES its map with every snapshot; `download` events after
it are deltas. `localSrc` is an opaque string: the web uses it ONLY as an audio or video element `src`, never `fetch` / XHR, never
for artwork or a canvas (a 360 video never uses it: a cross-origin texture would taint the canvas); native serves it with 206 +
Content-Range through its own URL scheme (`filetube-local:` today). If FileTube ever adds a CSP, `media-src` must allow the app's
scheme (tech-debt tracker item 154).

**An add that fails as a whole (v1.387.1).** `downloadsAddFailed { kind, id, error }` tells the web that a `downloads.add` produced
nothing: the server was unreachable, the album or season is gone, the manifest could not be read, or the device was removed.
Native sends it ONCE per failed add, with the `kind` and `id` exactly as the web sent them; a retry is a new add and may fail
again with a new event. It is add-only: older pages ignore the unknown type, an unknown `error` reads as `other`, an unknown
`kind` drops the event. It is not part of `downloadsSnapshot` (a failed add holds nothing on the phone), and native keeps owning
the state. The web shows the reason (a toast once, and on the item's menu or pill) until the next add of it, any `download` event for it (or for a member of
it), a snapshot, or pagehide. A container whose members exist keeps rolling up from them; the failure never hides real progress.

**Native audio (v1.397.0).** With `nativeAudio` announced, the app plays MUSIC (native tracks, library audio shown in Music, and
one chapter of a chaptered file as a `clip` Item) and PODCASTS through its own engine; video stays on the web player. The web sends
intents and renders native's snapshots; its own media element is silenced (no `src`), so two audio stacks never both play. **Item**
`{ kind: 'track' | 'podcastEpisode', id, src, title, artist?, album?, artworkSrc?, durationSec?, clip?: { startSec, endSec }, progress: { route, key }, radioSeed? }`:
`src` and `artworkSrc` are server-relative paths native resolves against the configured origin and appends its media token to
(`?mt=`, minted from the device token at `POST /api/devices/media-token`, docs/references/offline-api.md section 8); `src` is
always the iOS-playable file route `/api/offline/file/<kind>/<id>` (never `/track`, which 503s while an ALAC rendition transcodes), and
`artworkSrc` one of `/albumart/<id>` or `/podcastart/<subId>`. A chapter row (`<id>::c<n>`) is its parent file plus `clip` in FILE
seconds; for it `positionSec`, `durationSec` and `audio.seek` are CLIP-relative, native ends the item at `clip.endSec`, and
`loop: 'one'` loops the clip. `progress` names the ONLINE route native POSTs positions and plays to with the same body the web sends
(`/api/music/progress`, `/api/progress` for library audio, `/api/podcasts/progress`; `key` is the id the web would save under: a chapter
saves under its parent file id with FILE-absolute seconds); native retries a failed POST once, then drops it. `radioSeed` is the seed
native asks `GET /api/music/radio` with (mirroring music.js fetchAutoplayPicks: ask when 2 or fewer items are left, send `exclude` and
`queued`, ask once more with `widen=1` when a batch kept nothing, drop ids already queued, and append the picks to its queue); podcasts
never carry one. **Snapshots:** the web REPLACES its view with every `audioState` and reads `audioTick` as a position delta; a snapshot
whose `rev` is older than the web's last `audio.load` is dropped. **The server Up-next queue** (`/api/queue`): when it holds entries,
the web flattens them into the Item list it sends; a queue edit while hosted re-sends `audio.load` (rev + 1) at the current index and
position; native stays queue-dumb. **Downloaded items:** native looks its own catalogue up by `kind` + `id` and plays the local copy;
an Item carries no `localSrc`. With no host, or a host without `nativeAudio` (older app builds, browsers, the PWA), nothing changes at all.

## 4. Server side: `/api/host-info`

A public `GET /api/host-info` (no login) answers
`{ "app": "filetube", "version": "<FileTube version>", "bridge": { "min": 1, "max": 1 } }`. The app calls it to check a typed
address is a FileTube server and whether the bridge versions overlap, before loading the web UI.

## 5. Who owns what (spin one)

| Capability | State owner | Notes |
|---|---|---|
| orientation | web decides when, native enforces | the web's own upright drawing stays as the browser fallback |
| haptics | web decides when (each detent / letter / snap), native plays | in the app the web's switch-tracking haptic trick is turned off |
| battery | native | the web only displays it |
| serverSettings | native | the web shows the entry point only when announced |
| statusBar | web decides when (Pocket shown or not), native enforces | Sideways does not block it (a sideways Pocket is still immersive) |
| network | native | the web only displays it |
| downloads | native owns the files and the state; the web asks and displays | public/js/offline.js holds the ONE subscription per page and the `{kind:id -> state}` map (v1.387.0) |
| nativeAudio | native owns playback (the engine, the audio session, the lock screen, the queue it was sent, radio appends, progress posts); the web sends intents and renders snapshots | public/js/native-audio.js holds the ONE subscription per page, builds the Items and drives the shared media element as a proxy of native's state (v1.397.0) |

## 6. Release of held capabilities

Like `orientation` and `battery`, `statusBar` (hidden), `network` (subscribed), `downloads` (subscribed) and the `nativeAudio`
SUBSCRIPTION (never the playback: audio keeps playing across a navigation and the next page re-subscribes and adopts the snapshot) are
released by the host on every main-frame navigation commit and when the web view goes away. A page restored from the back-forward cache runs no
scripts, so on a persisted `pageshow` the web re-sends whatever it currently wants (orientation lock, battery and network
subscriptions, status bar hidden, the downloads subscription - whose answer, a fresh `downloadsSnapshot`, replaces the web's map - and the
audio subscription, whose answer, a fresh `audioState`, replaces the web's view);
on `pagehide` it releases them all (idempotent for the host). The downloads subscription is owned by public/js/offline.js, which
binds its OWN `pagehide` / `pageshow` pair (skin-surface.js's re-assert covers only the registries a Pocket owner claims).
