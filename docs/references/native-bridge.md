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
  capabilities: ['orientation', 'haptics', 'battery', 'serverSettings', 'statusBar', 'network'],
  post: function (msg) { window.webkit.messageHandlers.filetube.postMessage(msg); }
};
```

The web reads it once, through `public/js/host-adapter.js`. No `window.FileTubeHost` (every browser, the PWA) = no host: the
adapter's calls are silent no-ops and nothing changes.

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

## 3. Native to web events

Native calls `window.dispatchEvent(new CustomEvent('filetube-host', { detail }))` with `detail = { v: 1, type, ... }`:

| type | fields | when |
|---|---|---|
| `battery` | `level` 0..1 (or null when unknown), `state: 'unplugged' \| 'charging' \| 'full' \| 'unknown'` | on subscribe, then on every change |
| `network` | `connection: 'wifi' \| 'cellular' \| 'wired' \| 'other' \| 'none'` (required), optional `constrained: boolean` (Low Data Mode), `expensive: boolean` | on subscribe, then on every change |

The connection kind is `connection`, not `type`: the envelope's own `type` is `'network'`. The web reads a connection value it
does not know as `'other'`.

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

## 6. Release of held capabilities

Like `orientation` and `battery`, `statusBar` (hidden) and `network` (subscribed) are released by the host on every main-frame
navigation commit and when the web view goes away. A page restored from the back-forward cache runs no scripts, so on a
persisted `pageshow` the web re-sends whatever it currently wants (orientation lock, battery and network subscriptions, status
bar hidden); on `pagehide` it releases them all (idempotent for the host).
