---
plan: listen-control
harness: v2 · lean
branch: feat/v1.348-listen-control
anchor: spec
status: Designed
next: Step 0 (read this whole plan once, top to bottom, before touching anything)
design: Approved 2026-09-30 (Dean, two rounds of Q&A; every ruling in section 2 is his answer or an architect default he did not overrule)
gate: FULL (adversary + qa + security-brief) - a new network boundary and a new per-user command channel
---

# Listen Control: drive the PC's music from the phone

Written 2026-09-30 by an Opus session for a **Sonnet** builder in a fresh session. Every scope decision
is made. Your job is to build exactly this. If the code you find does not match what this plan says,
follow the stop rules in 0.8, do not improvise a redesign.

## 1. The outcome (what Dean will do on device)

Dean is at his desk. FileTube's Music page is open in a desktop browser tab (https://filetube.tamm.am,
behind his nginx). He clicks **Remote control: On** on that page once. He picks up his iPhone (the
installed PWA, Music view, iPod skin), opens the iPod main menu, picks **Play on... > PC**. From then on,
everything he plays on the phone plays **on the PC**, the phone makes no sound, and the phone's Now
Playing screen mirrors what the PC is playing; its wheel and buttons play/pause, skip, go back and scrub
the PC. The PC shows a small "Controlled by iPhone" pill. When he closes the PC tab, the phone says so
and goes back to being a normal iPod, silently.

Architect challenge (done at intake, recorded so nobody re-litigates it): the existing pieces do NOT
already cover this. v1.78's presence/handoff is discovery only and polls every 30s; the per-user Up Next
queue is persisted state with no push, and play/pause/seek are not queue concepts. A command channel
with sub-second push is the missing piece, and nothing smaller delivers "a remote".

## 2. Rulings (Dean, 2026-09-30) and architect defaults

Dean's answers:

| # | Question | Ruling |
|---|---|---|
| R1 | Scope | **Full remote**: pick-and-send + play/pause/next/prev/seek; phone Now Playing mirrors the PC; phone is silent. No volume, no Up Next editing (v2). |
| R2 | Media | **Music library tracks only** (kind `track`). Podcasts, videos and Listen items (a video played as audio) are refused in remote mode with a toast. |
| R3 | Opt-in | **The target opts in.** A click on the PC turns it on (this click is ALSO what satisfies the browser's autoplay rule). The phone's picker lists only opted-in tabs. |
| R4 | Network | Dean's browsers reach FileTube through **nginx** (reverse proxy, HTTPS). No nginx config change may be required: the stream sets `X-Accel-Buffering: no`, heartbeats every 20s (nginx's default `proxy_read_timeout` is 60s), and a polling fallback covers a proxy that buffers anyway. |
| R5 | Phone entry | **"Play on..." in the iPod main menu + a badge** on the iPod screen while remote; tapping the badge opens the same picker. |
| R6 | Drop-out | **Say so, stay silent**: toast "Lost <PC>", drop back to local mode, never start local playback on its own. |
| R7 | PC switch | **On the desktop Music page; keeps working on any in-app page after.** A "Controlled by <iPhone>" pill in the persistent shell while a controller is attached. |
| R8 | Conflicts | **Last action wins.** The PC's own controls stay live; the phone's mirror follows whatever the PC plays. |

Architect defaults (not asked; each is the simplest answer consistent with the rulings - change one only
by asking Dean):

- D1. **Same user only.** Everything is bucketed by `req.user.id` from the session; a body/query user id
  is never read. A member sees only their own devices.
- D2. **One target per device id.** `ft-device-id` is shared by every tab of a browser. A second tab of
  the same browser opting in REPLACES the first (the old tab gets a `replaced` event, turns its switch
  off, toasts "Remote control moved to another tab").
- D3. **The PC's opt-in lives in `sessionStorage`** (`ft-remote-target-on`): it survives a reload of
  that tab and dies with the tab. After a reload there is no fresh click, so autoplay may be refused:
  the target then reports state `blocked` and the phone shows "Click the PC's tab once to let it play".
- D4. **The phone's remote mode lives in `sessionStorage`** (`ft-remote-controlling` = target device
  id). A killed-and-relaunched PWA starts local. Neither key is on the synced-prefs allowlist.
- D5. **The server resolves every title.** The phone sends track IDS; the server filters them by
  visibility and delivers full track objects to the PC; the phone's mirror gets title/artist/art
  resolved server-side from the PC's reported track id. No client ever supplies display text to another
  device (the v1.78 posture).
- D6. **A play command carries at most 2000 ids.** Longer lists (Shuffle Songs fetches up to 10000) send
  the slice starting at the picked index, with index 0. Disclosed: Prev past the slice start does not
  exist on the PC.
- D7. **A new play on the PC while it is not on /music** SPA-navigates that tab to `/music` (in-app,
  the player survives) and plays through the Music view's own `playFromMenu`. ONE play path, no
  duplicate of `loadTrack`. Transport commands (pause/next/seek) never navigate. Disclosed: the PC tab
  moves to Music when the phone starts something new (consistent with R8).
- D8. **The handoff card is suppressed for the controlled target** on the phone (otherwise it would
  offer "Listening on PC - Continue here" about the thing the phone itself is driving).
- D9. **No phone lock-screen controls in remote mode.** The phone plays nothing, so iOS gives it no
  MediaSession. Disclosed.
- D10. Version **v1.348.0** (a feature).

## 0. Step 0 - read, set up, and the stop rules

0.1 Read `AGENTS.md`, then `docs/LESSONS.md` sections **0, 1, 2, 4, 5, 8, 10, 12**. Read this plan once
fully before editing.

0.2 Environment, every shell: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
Dual-Node for the final suite: 22.23.1 and 24.20.0 (Node 24 prints `ℹ`, not `#`).

0.3 Worktree: `git -C /home/coder/projects/filetube worktree add .claude/worktrees/listen-control feat/v1.348-listen-control`
(the branch already exists locally and carries this plan). Rebase it onto `origin/main` first if main
moved. In the worktree: `ln -s /home/coder/projects/filetube/node_modules node_modules` before any
commit/push, `rm node_modules` after, never stage it.

0.4 Git rules: stage files BY NAME; `git commit -F <file>`; never `--no-verify`, never force-push,
never pipe a commit or push; verify with `git log` / `git ls-remote`.

0.5 Tests while building: run the targeted files (`node --test test/unit/remote-*.test.js
test/integration/remote-*.test.js`), the full dual-Node suite once at the end of W4 (and once more only
if a gate round changes code).

0.6 Report every failure verbatim with counts. "Verified" means you ran it and saw it.

0.7 No em dashes in docs, comments or user-facing text. UI text uses the app's tokens and `ui.js`
primitives; `npm run lint:ui` must not grow; `node scripts/overlay-containment-lint.js --enforce` stays 0.

0.8 **Stop rules.** Stop and ask Dean (AskUserQuestion) if: (a) a seam named in section 3 does not exist
or behaves differently than described and the fix is not a like-for-like rename; (b) the autoplay proof
in W4 fails in Chromium even after the opt-in click (the design depends on it); (c) any step would need a
new npm dependency (none is planned: SSE is plain `res.write`); (d) a gate seat asks for a scope change.
Never widen scope to "while I'm here" fixes: log them in ROADMAP.md Planned.

## 3. The seams (mapped 2026-09-30 at v1.347.3; line numbers drift, names do not)

Client music playback (`public/js/music.js`):
- The list is client-side: closure `queue` inside `init(root)`. Everything funnels through
  `playAt(i, opts)` -> `loadTrack(item, i, opts)` -> `window.FileTube.player.load(id, data, ...)`.
- Entry points: `playRowAt` -> `playTrackInAlbum`; `.music-drill-play` -> `playAt(0)`; drill/toolbar
  Shuffle -> `loadSongs({sort:'random',seed,...})` -> `playAt(0)`; iPod menus -> `playFromMenu({tracks,
  index, play:{ctx,drill,label,flat}})`; `shuffleAllFromMenu`; deep links `playTrackFromContinue`,
  `playListenItem` (Listen items: NOT tracks, refused in remote mode).
- `registerTrackNav(i)` gives the player `onPrev/onNext`. Endless autoplay: `maybeExtendQueueForAutoplay`.
- Skin engine config: `skinEngineConfig(panel, winRef)` with `menu:{load, onPlay:playFromMenu, ...}`;
  Now Playing ctx `buildSkinCtx` reads `#media-player` directly; `renderNowPlayingSkin`,
  `updateNowPlayingPanel` (desktop branch renders `buildNowPlayingPanelHtml`).

Persistent player (`public/js/player.js`):
- `#player-dock` / `#player-host` live outside `#view-root`; `navigate()` in common.js swaps only
  `#view-root`. Public API `window.FileTube.player` (load, dock, setTrackNav, getState,
  autoStartRefused, getCurrentTime, getCurrentMeta, currentId, ...). **No play/pause/next/prev/seek
  methods exist**; internals are `togglePlayPause`, `manualTrackStep(dir)`, `activeMediaElement()`.
  MediaSession handlers: `setMediaSessionAction` (play, pause, seekto, seekbackward/forward;
  previoustrack/nexttrack registered in `setTrackNav`).
- Progress pings: `startProgressSaver` (4s) -> `saveProgressToServer`, carrying deviceId/deviceLabel/
  presence fields.

iPod skins (`public/js/music-skins.js`, `public/js/skin-surface.js`):
- `menuStaticItems(node, opts)`: main menu rows `{label, node?, action?}` (Music / Extras / Settings /
  Shuffle Songs / Now Playing). `createPocketMenu` passes `{hasCurrent, hasGames, hasSkins,
  hasLighting}`; `activate(i)` dispatches `it.action`.
- The skin engine drives playback by PROXYING clicks to hidden `#pp-btn`, `#track-prev-btn`,
  `#track-next-btn` and `#seek-bar` (change event) - see the header of skin-surface.js.
- `isPhone` / `html.is-phone`; skins are active only on phones.

Presence and devices:
- `lib/presence/store.js` `createPresenceStore({now, deviceCap})`: `record, readOther, forget, ...`;
  `DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/`, `LABEL_MAX` 32, exports `normalizeLabel`. Reuse the regex
  and `normalizeLabel`; do NOT extend this store (remote state is a separate concern with separate TTLs).
- `common.js`: `getDeviceId`, `getDeviceLabel` (exported on `window.FileTube`); the handoff card IIFE
  with the pure `shouldShowHandoffCard(presence, ctx)`.

Server:
- Routes live in `lib/<area>/routes.js` exporting `registerRoutes(app, deps)`, wired in server.js with
  explicit deps; registration order matters. `app.use(authGate)` is installed before all routes.
- No CSRF token exists: protection is SameSite=Lax + JSON bodies. No compression middleware (nothing
  buffers a stream server-side). `lib/diag/timing.js` patches `writeHead` (Server-Timing) and does not
  buffer. The Service Worker has NO fetch listener (locked by `test/unit/v1264-service-worker.test.js`),
  so it never touches the stream.
- `createRateLimiter({capacity, refillPerSec})` in `lib/auth/gate.js` (token bucket, `take(key)`).
- `createMutationAuditMiddleware` logs mutating requests; `FILETUBE_READONLY` refuses mutating verbs
  except `READONLY_ALLOWED_POSTS`. Mirror EXACTLY how `/api/music/progress` is treated by both (a
  playback-only POST): if progress is exempt from the audit log or allowed in read-only, so are the
  remote POSTs; if not, not.
- Track visibility: `lib/auth/visibility.js` (`trackVisibleTo`). The track object shape the Music view
  consumes is what `GET /api/music?...` returns - reuse that server-side serializer; do not invent one.
- Census tests FAIL on an unclassified route: add every new route to
  `test/unit/route-write-classification.test.js` and `route-read-classification.test.js`, and satisfy
  `route-census.test.js` / `rbac-census.test.js`.
- Integration tests: `process.env.DATA_DIR = mkdtemp` before `require('../../server')`,
  `app.listen(0)`, `authenticateFetch(server, base)` from `test/helpers/auth.js`. Model:
  `test/integration/handoff-api.test.js`.

## 4. Protocol (the contract every wave builds against)

Identity: `deviceId` must match `DEVICE_ID_RE` everywhere, else 400. Labels go through
`normalizeLabel`.

### 4.1 Routes (all behind the auth gate; all per `req.user.id`)

| Route | Who | Purpose |
|---|---|---|
| `GET /api/remote/stream?deviceId=&role=target\|controller[&target=<id>]&label=` | both | SSE. `role=target`: registers this device as an available target while open. `role=controller`: subscribes to `state` events of `target`. |
| `GET /api/remote/targets?deviceId=` | controller | Live targets of this user, excluding `deviceId`: `[{deviceId, label, controlled, state}]` with `state` resolved (below). |
| `POST /api/remote/command` | controller | `{fromDeviceId, targetDeviceId, cmd, args}` -> delivered to the target. |
| `POST /api/remote/state` | target | `{deviceId, trackId\|null, position, duration, state, hasPrev, hasNext}` -> stored, fanned out to controllers. |
| `GET /api/remote/poll?deviceId=&role=&target=&since=<seq>` | both | Fallback when the stream never says hello. Target: returns queued commands with `seq > since` and counts as a liveness beat. Controller: returns the latest target state. |
| `POST /api/remote/off` | target | `{deviceId}`: explicit opt-out (also sent with `keepalive:true` on `pagehide`). |

Rules:
- POST routes reject a non-`application/json` Content-Type with 415 (closes the form-post CSRF shape
  that SameSite=Lax leaves open for top-level POST navigations).
- `cmd` is an allowlist: `play`, `pause`, `toggle`, `next`, `prev`, `seek`. Anything else 400.
  `play.args = {ids: string[1..2000], index: int}`; every id is filtered through `trackVisibleTo`
  (a not-visible or unknown id is DROPPED, and `index` re-pointed to the same picked id; if the picked
  id itself is dropped, 404). `seek.args = {position: finite >= 0}`. Others take no args.
- Command to a target that is not live -> **410** `{error:'target-gone'}`. Delivered -> 202 `{seq}`.
- Rate limit: one token bucket per user for `/command` (capacity 30, refill 10/s) and per user for
  `/state` (capacity 20, refill 5/s); over -> 429. (A scrub on the wheel is throttled client-side to
  one seek per 250ms, so real use never hits it.)
- Caps: 8 live streams per user (the 9th evicts that user's least-recently-beating one with a `replaced`
  event), 200 live streams process-wide (the 201st gets 503). A controller stream must name a `target`.
- `state` values: `playing | paused | idle | blocked`. `blocked` = the PC was told to play and the
  browser refused (`player.autoStartRefused()`).
- Resolved state (what `/targets` and controller `state` events carry): `{deviceId, label, state,
  position, duration, hasPrev, hasNext, at, track: {id, title, artist, album, artUrl} | null}`, where
  `track` is resolved server-side from `trackId` via the same record the Music API reads, and is `null`
  if not visible to the user.

### 4.2 The SSE stream

- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`,
  `Connection: keep-alive`, `X-Accel-Buffering: no`; `res.flushHeaders()`; `req.socket.setTimeout(0)`
  / `setNoDelay(true)`.
- First frame: `event: hello` with `{seq}` (the target's current command seq). The client treats "no
  hello within 5s" as "the proxy buffers" and switches to polling (target 1.5s, controller 2s) for the
  rest of that page's life.
- Heartbeat: a `: ping` comment line every **20s**.
- Target receives `event: command` (`{seq, cmd, args}`, with `play` args replaced by resolved track
  objects `{tracks, index}`), `event: controller` (`{attached: bool, label}` - drives the PC pill),
  `event: replaced`.
- Controller receives `event: state` (resolved) and `event: target-gone`.
- Liveness: a target is live while its stream is open OR it polled in the last 10s. When a target
  stream closes, wait a **10s grace** (reconnects are normal: a network blip, a laptop waking) before
  emitting `target-gone` to its controllers and dropping it. `POST /api/remote/off` and `replaced`
  skip the grace.
- A controller counts as attached while its stream is open or it polled in the last 10s; the target's
  `controller` event fires on the first attach and the last detach.
- Every `res.write` on a closed socket is guarded; `req.on('close')` cleans up timers and map entries.
  No timer outlives its connection (the v1.78.1 jsdom/test boot-leak lesson: tests must be able to exit).

### 4.3 Server module shape

- `lib/remote/store.js`: PURE, no Express, injectable clock (`createRemoteStore({now})`), real `Map`s
  at every level (the `__proto__` key lesson). Owns: targets per user, controllers per target, the
  per-target command outbox (last 50, monotonic `seq`), the latest reported state, liveness/grace/caps
  decisions. Returns decisions ("emit target-gone to X"); it never writes to a socket.
- `lib/remote/routes.js`: `registerRoutes(app, deps)` with deps `{remote, resolveTracks,
  resolveTrackCard, rateLimiter factory, isTrackVisible, normalizeLabel, DEVICE_ID_RE}`. Owns sockets,
  heartbeats and timers. Exposes a `closeAll()` used by tests and by server shutdown.
- server.js wires it next to the handoff routes and exports `__remoteForTests` like
  `__presenceForTests`.

## 5. Waves (one branch, commits per wave, one gate, one release)

### W1 - Server: store + routes + tests

1. `lib/remote/store.js` per 4.3, with `test/unit/remote-store.test.js`: register/replace/evict at cap
   8, global cap, command seq monotonic and outbox trimmed at 50, `since` filtering, grace (a close
   followed by a reopen within 10s emits nothing; past 10s emits target-gone once), poll-liveness
   expiry, controller attach/detach edges, user isolation (user A never sees user B's target even with
   the same deviceId), `__proto__`/`constructor` device ids.
2. `lib/remote/routes.js` per 4.1/4.2, wired in server.js.
3. `test/integration/remote-api.test.js` (real server, real cookies, real SSE read via `fetch` +
   `response.body` reader): hello frame and the four headers present; a command posted by a controller
   arrives as a `command` event on the target within 500ms; the `play` payload arrives as resolved
   track objects in the `/api/music` shape; a hidden track id is dropped (member user with a restricted
   visibility, following the existing visibility test fixtures); 410 when the target is gone; 415 on
   `text/plain`; 400 on a bad deviceId and an unknown cmd; 429 past the bucket; a second user cannot
   list, command or subscribe to the first user's target; `state` fan-out to a controller; target-gone
   after grace (inject the clock or a short grace through deps - never a real 10s sleep); the poll
   fallback returns the same commands by `since`.
4. Census/classification tests updated; read-only/audit treatment mirrors `/api/music/progress` (3).
5. Commit: `feat(remote): server command channel for Listen Control`.

### W2 - The PC (target)

1. `window.FileTube.player` gains `play()`, `pause()`, `togglePlay()`, `next()`, `prev()`,
   `seek(sec)`, each a thin wrapper over the EXISTING internals (`togglePlayPause`,
   `manualTrackStep`, the MediaSession `seekto` path) - one behavior, two callers. A jsdom test binds
   each wrapper to the internal it must call (mutate the wrapper, watch the test go red).
2. New `public/js/remote.js` (dual-export like common.js for jsdom tests; pure decisions exported
   separately from the runtime), loaded right after common.js in EVERY shell that loads common.js
   (today: music, books, index, podcasts, stats, tv, watch, history, read; NOT login, setup, welcome).
   Add `test/unit/remote-shell-inclusion.test.js`: every `public/*.html` that loads common.js and is
   not in the exempt list loads remote.js after it (the inert-sibling-list guard).
3. Target runtime in remote.js, mounted in the persistent shell (never in `#view-root`):
   - On `sessionStorage['ft-remote-target-on']` at boot, or on the switch, open the target stream.
   - `command` handling: `play` -> if the Music view is mounted, call the handler it registered
     (music.js registers `FileTube.remote.setMusicPlayHandler(fn)` on init and clears it on teardown;
     `fn` wraps `playFromMenu({tracks, index, play:{flat:true, label:'From ' + <controller label>}})`);
     else `navigate('/music')` and run it once the handler registers (timeout 8s -> report `idle`).
     Transport cmds -> the new player methods. After a `play`, if `player.autoStartRefused()` reports
     refusal, post state `blocked`.
   - State reporting: POST `/api/remote/state` on play, pause, track change, seeked, ended, and every
     5s while playing, throttled to one per 500ms; only while a controller is attached (plus one post
     on attach).
   - `replaced` / stream failure past grace: switch off, toast.
   - `pagehide`: `fetch('/api/remote/off', {keepalive:true, ...})`.
4. The switch: on the DESKTOP Music page only (not `html.is-phone`), a toolbar button "Remote
   control" with On/Off state (`aria-pressed`), built from the `ui.js` button primitive, placed in
   the toolbar's existing slot scheme (`setToolbarSlot`; LESSONS 6 - the row wraps, buttons never
   shrink). Tooltip: "Let your other devices play music in this tab".
5. The pill: while a controller is attached, "Controlled by <label>" + a Stop button (turns the switch
   off), mounted in the shell like the handoff card, bottom-left on desktop, tokens only, all four
   eras. It shows on every in-app page (R7).
6. MEASURE (0.7, memory "Measure UI changes"): the desktop Music toolbar before/after at 1280 and 1024
   wide in all four eras; numbers in the commit message.
7. Commit: `feat(remote): the PC can be controlled from another device`.

### W3 - The phone (controller)

1. Main menu: `menuStaticItems` gains **Play on...** (`action: 'playon'`) between Shuffle Songs and
   Now Playing, on every skin. `activate` opens a submenu built at open time from
   `GET /api/remote/targets`: first row "This <getDeviceLabel()>" (checked when local), then each
   target "<label>" with its now-playing title as the row's detail, checked when controlled. Empty ->
   one disabled row "No PC is listening. Turn on Remote control on the PC's Music page." Picking a
   target: pause local playback (R1: the phone is silent), set `ft-remote-controlling`, open the
   controller stream. Picking "This iPhone": close it, clear the key, do not auto-play (R6).
2. Remote mode in music.js, decided at ONE seam: `playAt(i, opts)`. When remote is on and the item is
   a track, send `play {ids, index}` (D6 slicing) and return without loading locally; when it is not a
   track (Listen item, podcast), toast "Only music can play on <label>" and do nothing. Every entry
   point in section 3 reaches `playAt`; a test enumerates them (row tap, album Play, drill Shuffle,
   toolbar Shuffle, menu `playFromMenu`, `shuffleAllFromMenu`) and proves each sends a command and
   calls `player.load` zero times in remote mode.
3. Transport seam in skin-surface.js: the engine today proxies clicks to hidden player buttons. Add a
   `transport` object to the engine config (`{toggle, prev, next, seek(sec)}`); the DEFAULT is the
   existing proxy behavior, byte-for-byte (a test proves local mode still clicks the same buttons).
   music.js passes a remote transport while in remote mode. Seek is throttled to one command per
   250ms while scrubbing, with the final position always sent.
4. Mirror: `buildSkinCtx` gets a remote branch that builds the ctx from the last resolved `state`
   (title, artist, album, art, duration, playing, position interpolated locally from `at` while
   `playing`), so every skin renderer renders the PC's track unchanged. `blocked` renders the text
   "Click the PC's tab once to let it play". `idle` renders the normal empty Now Playing.
5. Badge: every Now Playing / menu screen renderer shows a small "on <label>" badge in the iPod
   status bar while remote; tapping it opens the Play on... submenu. A test renders EVERY renderer in
   `music-skins.js` with a remote ctx and asserts the badge (the inert-sibling-list guard: no renderer
   may be missed).
6. Drop-out (R6): `target-gone` event, a 410 from `/command`, or a poll that returns no target ->
   toast "Lost <label>", leave remote mode, render local state, never call play.
7. Lifecycle: on `visibilitychange` to hidden, close the controller stream; on visible, re-fetch
   `/api/remote/targets` and reopen (or drop out if the target is gone). This is the iPhone PWA norm
   (a backgrounded stream dies anyway; LESSONS 8).
8. Handoff card (D8): `shouldShowHandoffCard` ctx gains `remoteTargetId`; a presence from that device
   is not shown. Pure-function test.
9. Commit: `feat(remote): Play on... - the phone controls the PC`.

### W4 - End-to-end proof, then release

1. `test/visual`-style Playwright script under `tools/` (not a CI gate - "Visual reports, never
   blocks"), one seeded server (`test/visual/server.js` seed()+boot()), TWO browser contexts logged in
   as the same user: a desktop context (1280x800) launched with
   `--autoplay-policy=user-gesture-required`, and a phone context (390x844, iPhone UA, `is-phone`).
   Measure and record in the plan's Evidence section:
   a. Desktop clicks Remote control On; phone Play on... lists it within 2s.
   b. Phone picks an album track: desktop `player.getState()` reports playing that track id within
      **1s** (report the measured ms); phone `#media-player` never loads a src.
   c. Phone toggle/next/prev/seek(60): desktop reflects each within 1s; phone mirror title and
      position follow within 1.5s.
   d. Desktop navigates to Home in-app: playback continues, pill still shown, phone next still works.
   e. Phone sends a new play while desktop is on Home: desktop moves to /music and plays it (D7).
   f. Desktop reloads (no click): phone sends play -> desktop reports `blocked`, phone shows the
      click-once text. (If Chromium plays anyway, record that honestly; it is not a failure of b.)
   g. Desktop closes its tab: phone toasts Lost PC within 12s and is back in local mode, silent.
   h. Buffering proxy simulation: run the stream through a tiny local proxy that buffers the response
      (a 30-line `http` pass-through that holds bytes until 16KB) and prove the poll fallback carries
      b and c within 2.5s.
2. Full dual-Node suite (22.23.1 + 24.20.0), `npm run lint`, `npm run lint:ui`, the overlay census.
   Counts verbatim in the plan.
3. Gate (section 6), then release (section 7).

## 6. The gate: FULL, never slimmed

Seats: `adversary` + `qa` + `security-brief`, fresh, on the committed branch, briefed with
{branch, base sha, this plan, LESSONS 2, 4, 5, 8, 10}. Named attack surfaces:
1. **Cross-user control.** Can user B list, command, subscribe to, or evict user A's target by any
   deviceId/query/body combination? Can a member reach a track id they cannot see via `play`, or learn
   its title via a `state` report of that id?
2. **CSRF / cross-origin.** A cross-site page: form POST to `/command` (415?), `EventSource` to the
   stream (cookies not sent cross-origin without CORS?), `navigator.sendBeacon` to `/off` (what
   Content-Type does it send, and is it refused?).
3. **Resource exhaustion.** Open 1000 streams as one user and as many users; hold streams open with
   no reads; make sure caps, `req.on('close')` cleanup and timers hold, and the process heap does not
   grow unbounded (measure).
4. **Inert channel.** Prove REACHABILITY: every client path that is supposed to send a command
   actually does in a real browser (W4 evidence), and the default transport in local mode is
   unchanged (mutate it, watch a test go red).
5. **Lifecycle.** Grace window races (close + reopen + command in between), replace-by-second-tab,
   the PC reloading mid-command, phone backgrounding mid-scrub.
6. **nginx.** Headers present on the very first byte; heartbeat interval < 60s; nothing in the stack
   (timing middleware, auth gate, any `res.json` wrapper) buffers or ends the stream.
Verdicts go into section 9 bound to the sha. CHANGES -> fix, re-engage the SAME seat. After 2 CHANGES
rounds, ask Dean before round 3.

## 7. Release (docs/RELEASING.md is the authority)

`npm version 1.348.0 --no-git-tag-version`; ROADMAP.md Shipped entry above v1.347.3 and tick the
Planned entry; `docs/releases.json` entry in pure user language, e.g. "Play on another device: turn on
Remote control on your computer's Music page, then pick Play on... on your phone's iPod menu. The phone
becomes a remote: what you pick plays on the computer."; `docs/DEVICE-CHECKS.md` v1.348 block (below);
a LESSONS.md entry only if the wave taught a reusable lesson (the SSE-behind-a-proxy facts are a likely
one). Protected-main PR flow per the memory rules; merge on green unit CI; tag by API; delete the branch.

Device checks for Dean (DEVICE-CHECKS.md):
1. Through https://filetube.tamm.am: PC Music page, Remote control On. iPhone PWA: Play on... lists PC.
2. Pick an album: it plays on the PC within about a second; the iPhone is silent; its screen shows
   the PC's track and the "on PC" badge.
3. Wheel: play/pause, next, previous, scrub. The PC follows.
4. Browse to Home on the PC: it keeps playing and still obeys the phone.
5. Lock the phone for a minute, unlock: it reconnects and still shows the PC's track.
6. Close the PC tab: the phone says "Lost PC" within ~12s and stays quiet.
7. If a step lags by more than ~3s, note it: that means nginx buffered and the fallback kicked in.

## 8. Out of scope (log, do not build)

Volume and Up Next editing from the phone; podcasts, videos and Listen items; a phone as a TARGET;
controlling from the desktop to the phone; lock-screen controls on the phone in remote mode; pairing
codes or cross-user control; a persistent "always accept" setting; Web Push wake-up of a closed tab;
Roku/TV as a target.

## 9. Evidence and gate verdicts

### W4 two-browser proof (measured)

`node tools/listen-control-proof/proof.js` (real server, two Chromium contexts, same user; PC 1280x800 with
`--autoplay-policy=user-gesture-required`; phone iPhone 13 at 390x844 on the ipod-2004 skin). Raw numbers:
`tools/listen-control-proof/proof-out.json`. Times in ms, measured from the phone's action.

| Step | Direct (SSE) | Buffering proxy (poll fallback) |
|---|---|---|
| a. PC opts in, phone's Play on... lists it | 318 | 302 |
| b. phone picks a song, PC playing it | 1060 | 4765 (includes the 5 s no-hello wait that establishes the fallback) |
| b. phone's own player loaded the song | no (no /video/song2 request, paused) | no |
| c. pause on PC / phone mirror | 59 / 61 | 1472 / 1474 |
| c. resume on PC | 55 | 1517 |
| c. next on PC / phone mirror title | 65 / 369 | 1515 / 3255 |
| c. prev on PC | 71 | 1246 |
| c. seek (tap mid-bar) PC at 60 s / phone label | 9 / 37 | 1465 / 2749 |
| d. PC navigates Home: keeps playing, pill visible, phone next works | yes, yes, 67 | not run |
| e. phone plays while PC on Home: PC moves to /music and plays | 1319 | not run |
| f. PC reloaded, no click, phone plays | PC state blocked; phone shows "Click the PC's tab once to let it play" | not run |
| g. PC tab closes: phone drops to local mode, toast "Lost Linux PC", silent | 11 (pagehide /off) | not run |

Poll-fallback honesty: commands cost up to the 1.5 s target poll; the mirror adds the 2 s controller poll, so
the worst measured mirror lag is 3.3 s (plan target for the mirror was 2.5 s; the PC side is inside it).

Findings recorded: (1) a PC reload sends `/off` on pagehide (plan section 4), so the phone drops to local mode
with "Lost Linux PC" and must pick the PC again; after that the no-click play reports `blocked` as planned.
(2) Chromium with autoplay blocked did refuse the play, so `blocked` is observed, not assumed.

### Suites and lints (at commit of W4)

- Node 22.23.1: `npm test` tests 10476, pass 10464, fail 0, skipped 12.
- Node 24.20.0: `npm test` tests 10476, pass 10464, fail 0, skipped 12.
- `npm run lint`: 0 errors, 6 warnings (all pre-existing `no-unused-vars`).
- `npm run lint:ui`: OK (live debt equals docs/ui-exceptions.json, total 3183). Overlay census: 0 violations.

### Gate verdicts

(Filled by each seat, bound to the sha it reviewed.)

QA r1 @45686e34: 270/270 targeted tests pass (Node 22), lint:ui OK (3183), overlay census 0, eslint clean on new files, 0 em dashes added.
1. WARNING public/js/remote.js handleCommand + lib/remote/store.js: seqCounter is process-wide and resets to 0 on a server restart, but the target's client lastSeq (and poll `since`) survives the EventSource reconnect and the hello `{seq}` is ignored; after a restart every command with seq <= the old lastSeq is silently dropped until the counter passes it. Fix: on hello (and poll reply) if seq < lastSeq set lastSeq = seq, plus a test.
2. SUGGESTION: GET /stream?role=target and /poll?role=target register a target on a cross-site top-level GET (SameSite=Lax); low impact (bogus picker row for 10s).
3. SUGGESTION: getRemoteSnapshot reports whole-file duration/absolute position for ::c chapter tracks; fine for seek symmetry, verify on device.
Gate: CHANGES r1 @45686e34 - qa

Gate: APPROVED r1 @45686e34 — security-brief

Adversary r1 @45686e34 (measured on a /tmp git-archive sandbox; 34 mutants, caps/exhaustion script, poll replay repro). Full suite in sandbox: 10476 tests, 10455 pass, 8 fail, all 8 are `git ls-files` tests that cannot run without .git; those 5 files re-run in the worktree: 69/69 pass.
Held (mutant went red): cross-user scoping (targetOf, listTargets), 415, cmd allowlist, ids cap, index re-point, last-play-wins, grace, per-user cap, rate limit, close cleanup, X-Accel header, Cache-Control, Last-Event-ID replay, local-mode hostCtl, remotePlayAt seam, badge on all 3 renderers, D8 handoff, Listen refusal. Exhaustion: 1000 streams from one user hold at 8 conns/8 timers; 40 users hit the 200 cap, 120 get 503, no growth.
1. WARNING lib/remote/routes.js poll + public/js/remote.js pollOnce: the client's first poll sends `since=0` (lastSeq reset), and the server treats a finite 0 as a real cursor. Repro: target polls, phone sends pause,next,next, target polls again with since=0 inside the 10s liveness window (reload/sleep/crash with no /off, buffering proxy) -> all 3 stale commands replayed (measured: commands seq 1,2,3 returned; up to 50). Fix: client omits `since` until it has a hello/poll seq, or server ignores since=0 on a target's first poll.
2. WARNING presence-not-binding: the NATIVE-track visibility guards in server.js resolveRemoteTracks (`filter(trackVisibleTo)`) and resolveRemoteTrackCard (`trackVisibleTo(req, native)`) can be deleted with all tests green (mutants M2, M2c survive: the tests seed only projected library audio, blk1). A member restricted from a native track would read its title via state / get it pushed via play. Fix: seed a path-restricted native track in remote-api.test.js and assert both the play drop and the state card null.
3. WARNING: the nginx claim "heartbeat < 60s" is unbound: default heartbeat 20000 -> 70000 is green (M8). Add a test asserting the default stays under 60000.
4. SUGGESTION: the mirror's skinIsActive remote branch (music.js) is covered only by the W4 browser proof (mutant Y7 green in npm test); global 200-conn 503 path untested (X7 green); a query `user` is not shown ignored (X3).
5. Agree with QA W1 (server-restart seq reset drops commands) - not re-measured. Suspicions, not findings: bfcache restore after pagehide /off re-heals only via EventSource error; R2 podcasts/videos on phone pages are not refused while remote (only Listen queue items are).
Gate: CHANGES r1 @45686e34 — adversary
QA r2 @ac65092f: WARNING 1 fixed as prescribed (hello and poll seq below lastSeq reset it; 89/89 remote tests pass). No new findings.
Gate: APPROVED r2 @ac65092f - qa

Adversary r2 @ac65092f: warnings 2 (native guards bound) and 3 (HEARTBEAT_MS test) accepted from the diff; warning 1's fix introduced a NEW defect.
1. CRITICAL public/js/remote.js pollOnce: `since` is omitted while lastSeq is 0, and lastSeq is only ever LOWERED from a poll reply (`d.seq < lastSeq`), never adopted. So a poll-fallback target that has handled no command omits `since` on EVERY poll; the server then uses t.lastSeq as the cursor and returns nothing. Repro (measured, real server): target polls once, phone sends pause,next,next, target polls with no `since` -> `{"seq":3,"commands":[]}`. The polling fallback (buffering proxy, R4) delivers no command at all, ever. Fix: adopt `if (typeof d.seq === 'number' && lastSeq === 0) lastSeq = d.seq` from the FIRST poll reply (and the hello), then send since always; add a two-poll test (poll, command, poll -> command delivered).
Gate: CHANGES r2 @ac65092f — adversary
