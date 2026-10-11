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
node/npm/git command (local verification is Node 22.23.1, AGENTS.md:160); never `--no-verify`; never self-merge.

Read first: AGENTS.md; docs/references/ios-host.md, native-bridge.md and native-bridge.v1.schema.json (the contract: follow it
exactly; if it is wrong, STOP and ask, never improvise a message); docs/LESSONS.md sections 0, 1, 2, 3 (censuses), 4 (lifecycle: D5's exits), 6, 8 (iOS / WebKit), 10, 12; the wheel
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
  tests) AND allowlist the new script for the logged-out shells in `lib/auth/gate.js` `ALLOW_EXACT` (~:108-141; login.html and
  welcome.html load the shared scripts, and a script the gate blocks broke login once: gate.js ~:124-128). On load with a host:
  `post('host.hello', { web: { version } })` with the version from `appVersionString()` (common.js ~:6750; the server's
  `APP_VERSION`, server.js ~:188).
- **D2 Conformance**: test/unit/native-bridge-contract.test.js parses docs/references/native-bridge.v1.schema.json and asserts
  the adapter's message table has exactly the schema's web-to-native types, each with the schema's required fields and allowed
  values, and the event table matches native-to-web types (no JSON-schema dependency; read the JSON and compare). A schema edit
  without an adapter edit fails CI, and vice versa.
- **D3 Fake host**: test/helpers/fake-host.js installs a `window.FileTubeHost` (configurable capabilities) that records every
  `post` and can `emit(detail)` events; the feature tests below use it. No-host tests assert the browser path is byte-for-byte the
  old behaviour (same DOM classes, same listeners, same calls).
- **D4 `GET /api/host-info`**: register it with the other routes (NOT before `app.use(authGate)`, server.js ~:3157:
  test/integration/route-census.test.js fails a route registered ahead of the gate) and make it reachable logged out by adding
  `/api/host-info` (GET) to `ALLOW_EXACT` in lib/auth/gate.js (~:108-141; no `/api/*` GET is there today, so update
  route-census / any gate census deliberately). Body: `{ app: 'filetube', version: APP_VERSION, bridge: { min: 1, max: 1 } }`, `Cache-Control: no-store`, nothing else (no user data, no
  paths, no config). Integration test: reachable logged out, exact shape (validated against the schema's `hostInfo`), and no
  extra keys.
- **D5 Pocket upright = rotation lock**: in music-skins.js / skin-surface.js, find the one seam where the FULL Pocket player
  becomes visible and the one where it stops being visible (open, close, navigation away, view destroy, the phone leaving the
  page; list every exit you find). With `host.has('orientation')` AND the Sideways setting off (`pocketSideways`, music-skins.js
  ~612): `orientation.lock { orientation: 'portrait' }` on show, `orientation.unlock` on every exit (idempotent: a double unlock is
  harmless; never leave it locked after Pocket closes). Sideways on: never lock. The CSS upright drawing (`html.pk-upright`,
  `markUprightClass`, `turnOf`) stays untouched: it is the browser path and harmless in the app (the screen never turns).
- **D6 Haptic wheel**: skin-surface.js WHEEL HAPTICS (~:2836-3150) and the centre hold (~:1919, ~:1930). Today every haptic
  function opens with `if (!wheelGhost || !wheelGhost.isConnected) return;` (`hapticGestureStart` ~:3071, `hapticOnMove` ~:3106,
  `hapticLetterTick` ~:3135), and the ghost mounts only when `hapticCapable()` (~:2887) is true. With `host.has('haptics')`:
  `hapticCapable()` returns false (the ghost never mounts: no arming cover, no body-scroll carve-out from it) and a HOST BRANCH
  runs at the top of each of those functions, BEFORE the ghost guard:
  - gesture start: reset the same per-gesture state the ghost path resets (`st.hapAccum`, `st.hapLast`) and post
    `haptics.prepare`;
  - move: count detents from the accumulated rotation with the SAME step (`st.detentDeg`, default `HAPTIC_STEP_DEG` 3.75) and the
    SAME `HAPTIC_MIN_MS` throttle (drop, never queue) for EVERY engine (ghost and sweep alike: the sweep path has no detent
    counter today, so the host branch owns the one counter), and post `haptics.tick { style: 'detent' }` per counted detent; in
    LETTER mode post nothing per degree (the letter tick covers it, as today);
  - letter crossing: `{ style: 'letter' }`;
  - the two HOLD fires share `hapticLetterTick` with real letter crossings, so give the shared tick a style argument: the centre
    hold fire (~:1930) and the MENU hold-to-home (~:3269) each post ONE `{ style: 'detent' }`; ~:1919 is the centre hold's gesture
    start (`hapticGestureStart`: prepare only, no tick);
  - the user's Buzz setting off (`st.buzz === false`): post no ticks at all (prepare is harmless).
  Put "a detent was crossed" in ONE helper the ghost path and the host branch share (LESSONS 12). The wheel's input, scrolling,
  selection and volume / seek behaviour must be identical with and without the host; fake-host tests prove: ticks fire per detent
  at the throttle on both engines, none with Buzz off, the centre hold ticks once, and no ghost element exists.
- **D7 Feed snap**: feed.js `setActive(index, early)` (~:2165) has no source argument, and programmatic scrolls (the countdown
  auto-advance ~:1176-1177, "Hide this" ~:1927, ~:2614) reach it through the same observer as a swipe. Tick ONLY for a user
  swipe: record the time of the last SCROLL-GESTURE input on the stack (touchmove / wheel; NOT a tap on a control such as
  "Hide this", the menu or Keep watching), and post `haptics.tick { style: 'snap' }` when
  `host.has('haptics')`, the active index CHANGED from the last ticked one, and a user input happened within ~1 s. No tick on
  the first card, on auto-advance, on Hide, on a rebuild, or when a quarter-swipe springs back to the same card.
- **D8 Battery**: the battery is `.ip-batt` (music-skins.js ~:248, the classic skin's status bar) drawn from the CSS variable
  `--pk-batt-level` (style.css ~:8875, a static 82% today; drawn ~:8952-8953). With `host.has('battery')`: `battery.subscribe`
  when a status bar with a battery becomes visible, `battery.unsubscribe` when none is, and set `--pk-batt-level` from the
  `battery` event's `level` (clamped 0..1, rounded to a percent) ON THE `.mms-ipod` PANEL ELEMENT (style.css ~:8873-8875 declares
  `--pk-batt-level` on `.mms-ipod` itself, which beats a value inherited from html, so setting it on html changes nothing; not on
  `.ip-batt i` either, which `ipScreen` rebuilds on repaint), re-applied after a repaint / remount. The test asserts the panel's
  inline property, and the device check confirms the drawn width (jsdom does not compute this cascade). No skin has a charging mark: level only (state is ignored for
  drawing in v1). `level: null` keeps today's drawing. No host: today's drawing exactly.
- **D9 Server address row**: with `host.has('serverSettings')`, Settings shows one row "Server address" (find the most fitting
  existing page, e.g. SYSTEM or ACCOUNT; follow the settings censuses) whose tap posts `host.openServerSettings`. Absent
  otherwise (the census must accept a host-only row; say how).
- **D10 Standalone checks**: grep `navigator.standalone` and `display-mode: standalone` (common.js ~:8541, player.js ~:4670,
  setup.js ~:1809 and ~:1901, pocket-lighting.js ~:130; public/errors.html ~:54 does not load common.js, so the adapter cannot
  reach it: name it in the ledger as out of reach). In the app neither is true. For each use, decide whether the hosted app should behave like the
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

Docs kickoff gate (branch docs/ios-host-kickoff, slim, adversary): r1 CHANGES @02ec34d6 - W1 the public route belongs in
gate.js ALLOW_EXACT (not before authGate), W2 the haptic host branch must run before the ghost guard (and Buzz off, sweep, centre
hold); S1-S7 (battery seam, Feed snap source, errors.html, Node line, LESSONS list, capability count, two Mac traps). Fixed at
30df1d8f. r2 CHANGES @30df1d8f: W-r2-a the battery variable must be set on the .mms-ipod panel (html is overridden), W-r2-b the
hold fires (centre ~:1930, MENU ~:3269) tick once via a style argument, ~:1919 is prepare only; suggestion: Feed snap ignores taps
on controls. Fixed in the next commit; round 3 (Dean, 2026-10-11: "Quick round 3, then merge"). r3 APPROVED @cceac09e (adversary; 87 docs files, 2189 / 2189 pass). Leftover for the builder: D6's tests cover the MENU
hold-to-home tick too, not only the centre hold.

## 6. Evidence (builder fills)
- Seams (file:line, at a225bbb7 + W4):
  - D1 public/js/host-adapter.js (new; script tag before glyph-pool.js in the 12 public shells + lib/ytdlp/views/subscriptions.html; gate.js ALLOW_EXACT ~:134 holds '/js/host-adapter.js' and '/api/host-info'). D4 server.js:4738 (after authGate, before the shell catch-all).
  - D5 skin-surface.js owner registry :576-:640 (orientOwners, orientApply, pagehide/pageshow); engine seams :1842 fullPlayerShowing, :1873 hostSync (paint end, reflect, hidden/class MutationObserver :1878, destroy). Exits covered: hide, class reset, destroy, panel removed with no engine call (1 s poll, only while locked), pagehide; Sideways on = never lock; pop-out never.
  - D6 skin-surface.js :3000 hostHaptics, :3008 hapticDetentsCrossed (the ONE detent helper, ghost + host), :3019 hapticCapable (false under a host), :3203 hapticGestureStart, :3244 hapticOnMove, :3274 hapticLetterTick(style); hold fires :2036 (centre) and :3418 (MENU) pass 'detent'.
  - D7 feed.js :2135 snapHost, :2151 noteSettled (called from the settled branch of onIntersect :2181). D8 skin-surface.js :1855 applyBattery (on the .mms-ipod panel), :1865 batterySync. D9 setup.js :3766 wireServerAddressRow (JS-built, so setup.html and the settings census are untouched), wired :5427.
- Conformance test output: test/unit/native-bridge-contract.test.js 13/13 (schema message types, fields, enums, events, capabilities both ways).
- No-host equality tests: native-bridge-wheel (ghost mounts, nothing posted; host without haptics keeps the ghost), -pocket (no poll, no inline style), -feed (no listeners attached, probe-verified with a control), -settings (page byte-identical). Mutants killed: 15 of 15 (ghost under host, destroy unlock, poll, battery on html, letter style, letter throttle, Buzz, Sideways, gesture check, settled dedupe, capability gate, row gate, common routing, letter branch, MENU hold style).
- D10 standalone decisions: common.js isStandaloneDisplay YES (last-page restore/clear apply to the app); setup.js export headers x2 YES (via exportIsAppLike); pocket-lighting.js turn inset YES (edge-to-edge app; unmeasured in the app, harmless since Pocket is locked); player.js bgTimingDisplayMode NO (a measurement label; mislabelling the app 'pwa' would pollute the lock-audio timing comparisons); public/errors.html OUT OF REACH (loads no common.js or adapter; it says "browser tab" in the app).
- Suites, gate rounds, device checks owed: targeted 1133/1133 (W2+W3 set); full Node 22.23.1 suite and gate rounds below. Device checks: docs/DEVICE-CHECKS.md "The iOS bridge (v1.384.0)" (8 lines).

## 7. Out of scope
Any native code (that is filetube-ios); a native audio engine; downloads; push; media tokens; changing what the PWA does.
