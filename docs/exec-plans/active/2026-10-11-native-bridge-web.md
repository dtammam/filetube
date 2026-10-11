---
plan: native-bridge-web
harness: v2 · full
branch: feat/v1.384.0-native-bridge-web
anchor: spec
status: Planned (kickoff 2026-10-11, Opus Root); builder not started
next: builder Step 0, then W1
design: docs/references/ios-host.md (Dean's decision, 2026-10-11), docs/references/native-bridge.md + native-bridge.v1.schema.json (contract v1). Base: main after the ios-host docs PR merges.
builder: standard (the contract and every seam are fixed here; nothing to invent; a browser must see NO change)
gate: not yet run (FULL: adversary, qa, security-brief - a new public route and a bridge to native code)
---

# v1.384.0: the web half of the iOS bridge (invisible in every browser)

Version note: take the next free minor at release time (CI slim ships with no version of its own).

Norms: no em dashes; stage files by name; `git commit -F <file>`; never pipe a commit or push; fnm Node 22.23.1 PATH before any
node/npm/git command (local verification is Node 22 only once CI slim has merged; until then follow AGENTS.md as it stands);
never `--no-verify`; never self-merge.

Read first: AGENTS.md; docs/references/ios-host.md, native-bridge.md and native-bridge.v1.schema.json (the contract: follow it
exactly; if it is wrong, STOP and ask, never improvise a message); docs/LESSONS.md sections 0, 1, 2, 6, 10, 12; the wheel
haptics plan docs/exec-plans/active/2026-09-03-wheel-haptics.md (why the switch-tracking trick exists).

## Step 0 (builder)
- Work ONLY in the launcher's worktree `.claude/worktrees/feat-v1.384.0-native-bridge-web` (node_modules symlinked, never staged).
- Stop and ask Dean (AskUserQuestion) when: the contract cannot express what a seam needs; a change would alter ANY browser
  behaviour (the hard rule of this plan); the gate reaches round 3; `gh pr merge` is refused.

## 1. Outcome
When the iOS app hosts FileTube, the web UI uses the app's capabilities: Pocket stays upright by locking the phone's
rotation, the click wheel and Feed swipes play real haptics, Pocket's status bar shows the real battery, Settings offers
"Server address" (the app's own screen), and the app can check a server with `/api/host-info`. In every browser and the PWA
nothing changes at all.

## 2. Design (fixed; build exactly this)

- **D1 `public/js/host-adapter.js`** (new): reads `window.FileTubeHost` ONCE at load. Exposes `window.FileTube.host`:
  `present` (bool), `bridge` (number or 0), `has(cap)` (bool), `post(type, fields)` (builds `{ v: 1, type, ...fields }`,
  checks it against an internal message table that mirrors the schema, drops anything invalid or unannounced with a
  `console.warn` in dev only, wraps the native call in try/catch, never throws, returns true when sent), `on(type, fn)` (listens
  to `window` `filetube-host` events, filters by `detail.type`, returns an unsubscribe; ignores unknown types). With no host,
  every call is a no-op returning false. It must load before any script that uses it: prefer loading it from an existing script
  every shell already loads (common.js's early section or a `<script>` that all shells share) and say which; if a new script tag
  in every shell is unavoidable, update the shell censuses deliberately (app-look-l2 byte-identical inline script, shell-list
  tests). On load with a host: `post('host.hello', { web: { version } })` with the FileTube version the page already knows (find
  where; if none, the server injects it).
- **D2 Conformance**: test/unit/native-bridge-contract.test.js parses docs/references/native-bridge.v1.schema.json and asserts
  the adapter's message table has exactly the schema's web-to-native types, each with the schema's required fields and allowed
  values, and the event table matches native-to-web types (no JSON-schema dependency; read the JSON and compare). A schema edit
  without an adapter edit fails CI, and vice versa.
- **D3 Fake host**: test/helpers/fake-host.js installs a `window.FileTubeHost` (configurable capabilities) that records every
  `post` and can `emit(detail)` events; the feature tests below use it. No-host tests assert the browser path is byte-for-byte the
  old behaviour (same DOM classes, same listeners, same calls).
- **D4 `GET /api/host-info`** (lib/ or server.js where the public routes live, BEFORE the login gate): `{ app: 'filetube',
  version: <package.json version>, bridge: { min: 1, max: 1 } }`, `Cache-Control: no-store`, nothing else (no user data, no
  paths, no config). Integration test: reachable logged out, exact shape (validated against the schema's `hostInfo`), and no
  extra keys.
- **D5 Pocket upright = rotation lock**: in music-skins.js / skin-surface.js, find the one seam where the FULL Pocket player
  becomes visible and the one where it stops being visible (open, close, navigation away, view destroy, the phone leaving the
  page; list every exit you find). With `host.has('orientation')` AND the Sideways setting off (`pocketSideways`, music-skins.js
  ~612): `orientation.lock { orientation: 'portrait' }` on show, `orientation.unlock` on every exit (idempotent: a double unlock is
  harmless; never leave it locked after Pocket closes). Sideways on: never lock. The CSS upright drawing (`html.pk-upright`,
  `markUprightClass`, `turnOf`) stays untouched: it is the browser path and harmless in the app (the screen never turns).
- **D6 Haptic wheel**: skin-surface.js WHEEL HAPTICS (~2836-3150). With `host.has('haptics')`: `hapticCapable()` returns false so
  the switch "ghost" never mounts (no arming cover, no body-scroll carve-out from it); the DETENT maths stays exactly as it is
  (the same `st.detentDeg` / step, the same `HAPTIC_MIN_MS` throttle, drop-never-queue) and where it sets `flip = true` today,
  post `haptics.tick { style: 'detent' }` instead; `hapticLetterTick` posts `{ style: 'letter' }`; the gesture start
  (`hapticGestureStart`) posts `haptics.prepare`. Split the code so "a detent was crossed" is one function both outputs share
  (LESSONS 12: one helper); the wheel's input, scrolling, selection and volume / seek behaviour must be identical with and without
  the host (tests with the fake host prove the ticks fire per detent at the throttle and that no ghost element exists).
- **D7 Feed snap**: feed.js `setActive` (a new card becomes active after a swipe) posts `haptics.tick { style: 'snap' }` when
  `host.has('haptics')`; not on the first card of a session, not on a programmatic re-activation (a rebuild), once per change.
- **D8 Battery**: find Pocket's status-bar battery (skin-surface.js status bar ~2015, the skins' status-bar markup and CSS). With
  `host.has('battery')`: `battery.subscribe` when a status bar becomes visible, `battery.unsubscribe` when none is, and draw the
  `battery` event's `level` (rounded, the skin's existing glyph / fill) and `state` (a charging mark if the skin has one; if none,
  level only). `level: null` keeps today's drawing. No host: today's drawing exactly.
- **D9 Server address row**: with `host.has('serverSettings')`, Settings shows one row "Server address" (find the most fitting
  existing page, e.g. SYSTEM or ACCOUNT; follow the settings censuses) whose tap posts `host.openServerSettings`. Absent
  otherwise (the census must accept a host-only row; say how).
- **D10 Standalone checks**: grep `navigator.standalone` and `display-mode: standalone` (common.js, player.js, setup.js,
  pocket-lighting.js at least). In the app neither is true. For each use, decide whether the hosted app should behave like the
  home-screen app (most likely yes: it is an installed full-screen app); route that decision through one adapter helper
  (`FileTube.host.appLike()` = standalone OR host present) only where the answer is yes, and list every use with its decision
  in the ledger. Browser results unchanged.

## 3. Waves
- **W1** D1-D4 (adapter, conformance, fake host, host-info) with their tests.
- **W2** D5-D7 (rotation lock, haptic wheel, Feed snap) with fake-host tests and no-host equality tests.
- **W3** D8-D10 (battery, Server address row, standalone audit).
- **W4** close-out: ledger (each D as built, every seam named with file:line), device checks in docs/DEVICE-CHECKS.md (browser:
  Pocket, wheel, Feed, Settings exactly as before; in the app once filetube-ios exists: lock, ticks, battery, Server address),
  ROADMAP (an "iOS host" section: this shipped, the spin-one native side pending in filetube-ios), a LESSONS line if earned.

## 4. Gate
FULL: adversary, qa, security-brief. Brief: prove a browser sees no change (diff behaviour with no host across Pocket, the wheel,
Feed, Settings, the status bar); try to leave the phone locked in portrait after Pocket closes (every exit path, a crash mid-open,
navigation); a wheel whose ticks drift from detents or queue; a message the schema does not allow getting posted; the host-info
route leaking anything beyond its three keys or sitting behind / leaking past auth; a malicious page or iframe faking
`window.FileTubeHost` events (the web treats events as data: a bad `battery` event can only change a drawn number, clamp it).

## 5. Release
docs/RELEASING.md and AGENTS.md exactly; the plan closed in the same PR (`node scripts/plan-complete.js
docs/exec-plans/active/2026-10-11-native-bridge-web.md "Shipped vX.Y.Z" --apply`); ask Dean before `gh pr merge`; shipped = the
tag's "Publish Docker Image" green; branches deleted remote and local.

## 6. Evidence (builder fills)
- Seams (file:line) for D1, D5 exits, D6, D7, D8, D9:
- Conformance test output:
- No-host equality tests:
- D10 standalone decisions:
- Suites, gate rounds, device checks owed:

## 7. Out of scope
Any native code (that is filetube-ios); a native audio engine; downloads; push; media tokens; changing what the PWA does.
