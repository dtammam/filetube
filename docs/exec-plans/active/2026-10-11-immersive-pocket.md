---
plan: immersive-pocket
harness: v2 · full
branch: feat/v1.385.0-immersive-pocket
anchor: spec
status: Planned (kickoff 2026-10-11, Opus Root); builder not started
next: builder Step 0, then W1
design: the iOS Root's contract proposal (2026-10-11), confirmed by Dean to the FileTube Root ("Yes, all in one release"). Base main = v1.384.0.
builder: standard (the contract shape and every seam are fixed here, on top of v1.384.0's mapped registry)
gate: not yet run (FULL: adversary, qa, security-brief - a contract change and native-facing calls)
---

# v1.385.0: immersive Pocket - iOS's status bar hidden in Pocket, Pocket's own bar shows time, battery and connection

Norms: no em dashes; stage by name; `git commit -F <file>`; never pipe a commit or push; fnm Node 22.23.1 PATH before any
node/npm/git command (local verification = Node 22); never `--no-verify`; never self-merge. A status report NEVER ends your turn.

Read first: AGENTS.md; docs/references/ios-host.md, native-bridge.md, native-bridge.v1.schema.json; the shipped plan
docs/exec-plans/completed/2026-10-11-native-bridge-web.md (its evidence section maps every seam this plan builds on:
skin-surface.js orientation owner registry ~:576-640 with pagehide / pageshow, fullPlayerShowing ~:1842, hostSync ~:1873,
applyBattery ~:1855, batterySync ~:1865; host-adapter.js); docs/LESSONS.md 0, 1, 2, 3, 4, 6, 8, 12.

## Step 0 (builder)
- Work ONLY in the launcher's worktree `.claude/worktrees/feat-v1.385.0-immersive-pocket` (node_modules symlinked, never staged).
- Stop and ask Dean (AskUserQuestion) when: the shape below cannot express a seam's need; a browser behaviour would change; the
  gate reaches round 3; `gh pr merge` is refused.

## 1. Outcome (Dean, through the iOS Root, confirmed to the FileTube Root 2026-10-11)
Inside the iOS app, opening Pocket hides iOS's own status bar (time, signal, battery), and Pocket's status bar shows the time,
the real battery (already shipped) and the connection type (Wi-Fi / cellular / none) - so there are never two batteries.
Leaving Pocket brings iOS's bar back. Signal BARS are not possible (iOS gives apps no public signal-strength API): type only.
Browsers and the PWA: no change at all.

## 2. Contract v1 additions (add-only; land EXACTLY this shape)
- Capabilities enum: add `statusBar`, `network`.
- Web to native: `statusBar.hide` (no fields; cap `statusBar`): native hides the system status bar now. `statusBar.show` (no
  fields; cap `statusBar`): native restores it. `network.subscribe` (no fields; cap `network`): native sends one `network` event
  now and one per change. `network.unsubscribe` (no fields; cap `network`).
- Native to web event: `network` with required `type: 'wifi' | 'cellular' | 'wired' | 'other' | 'none'` and optional
  `constrained: boolean` (Low Data Mode), `expensive: boolean`. The web ignores unknown future values (treats an unknown type as
  'other').
- Owners (native-bridge.md section 5): statusBar = web decides when (Pocket shown / not), native enforces; network = native owns,
  web displays.
- Native semantics (the app's, document them): like orientation and battery, both are released by the host on every main-frame
  navigation commit and when the web view goes away.

## 3. Design (web side)
- **D1 Contract**: update docs/references/native-bridge.v1.schema.json, native-bridge.md (sections 2, 3, 5 and the capability list
  in section 1), ios-host.md's capability count, and host-adapter.js's message / event tables + CAPABILITIES; the conformance test
  (test/unit/native-bridge-contract.test.js) must pass with the new entries and fail if either side drifts.
- **D2 Status bar**: extend the v1.384.0 owner registry in skin-surface.js (the orientation one, ~:576-640): the same "full Pocket
  player showing" owners drive `statusBar.hide` on show and `statusBar.show` on every exit the registry already covers (hide,
  class reset, destroy, panel removed, pagehide). Unlike orientation, the Sideways setting does NOT block it (a sideways Pocket is
  still immersive). The pop-out never hides it. Idempotent both ways.
- **D3 Pocket's own bar**: only when `host.has('statusBar')` (so the PWA, which keeps iOS's bar, never shows a second clock), the
  `.ip-status` bar (music-skins.js ~:247-248) gains, beside the existing battery: the time (local, the device's 12/24-hour
  preference via `toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })`, re-drawn on the minute boundary, never a
  per-second timer) and, when `host.has('network')`, a connection glyph from the latest `network` event (wifi / cellular / wired /
  other / none-or-unknown = a "no connection" mark; `constrained` may dim it). Use the icon set's existing glyphs if they exist
  (search the resolve-icon-set census), else add them through the icon pipeline with its census; fit the existing row (measure at
  320 / 390, the memory norm "rows wrap, buttons never shrink"; truncate the title, never the clock). Re-applied after every
  repaint (ipScreen rebuilds the markup), like D8's battery.
- **D4 Network subscription**: the same pattern as batterySync (~:1865): `network.subscribe` while a Pocket status bar with the
  glyph is visible, `network.unsubscribe` when none is; one shared subscription across engines (the v1.384.0 gate r1 lesson).
- **D5 Swipe-back re-send** (the iOS app's v0.3.0 gate, QA S2): a page restored from the back-forward cache does not re-run its
  scripts, while the host released every capability on the commit. On `pageshow` with `event.persisted`, re-assert whatever is
  currently wanted: orientation lock, battery subscription, status bar hidden, network subscription. Check what v1.384.0's
  pageshow handler already does (it re-applies orientation) and make all four go through one re-assert path. Test with a fake host
  that "releases" on a simulated commit and a persisted pageshow.
- **D6 Browser equality**: no host = no clock, no glyph, no new listeners beyond inert ones, identical DOM; tests prove it.

## 4. Waves
- **W1** D1 (contract + adapter + conformance) and D5 (the re-send path, which also hardens v1.384.0).
- **W2** D2-D4 (status bar owner, Pocket's clock and connection glyph, network subscription) with fake-host and no-host tests.
- **W3** close-out: ledger with file:line seams, device checks in docs/DEVICE-CHECKS.md ("The immersive Pocket (v1.385.0)": in the
  app, open Pocket -> iOS's bar gone, Pocket shows time + battery + connection; leave -> iOS's bar back; Wi-Fi off -> cellular glyph;
  airplane mode -> no-connection mark; swipe back into a Pocket page -> still upright and immersive; browser: no change). In the SAME
  close-out commit, mark the eight "The iOS bridge (v1.384.0)" device checks `[x]` with "(Dean 2026-10-11: passed)" and reword the
  Server address line to say "Settings > Account (at the bottom)". ROADMAP entry.

## 5. Gate
FULL: adversary, qa, security-brief. Brief: leave iOS's status bar hidden after Pocket closes (every exit, a crash mid-open, a
swipe-back, the pop-out); a second clock appearing in the PWA; a timer firing every second; the glyph lying when the network event
is unknown or absent; a schema / adapter mismatch; the re-send path double-subscribing or re-locking after Pocket closed.

## 6. Release
docs/RELEASING.md + AGENTS.md; close the plan in the same PR (`node scripts/plan-complete.js
docs/exec-plans/active/2026-10-11-immersive-pocket.md "Shipped vX.Y.Z" --apply`); ask Dean before `gh pr merge`; shipped = the
tag's "Publish Docker Image" green; then tell the FileTube Root (SendMessage "FileTube Root") the merge commit so the iOS app can
re-pin the contract and announce the two capabilities.

## 7. Evidence (builder fills)
- Seams (file:line), conformance output, no-host equality, the re-send test, row measurements at 320 / 390, suites, gate rounds,
  device checks owed.

## 8. Out of scope
Signal bars (no iOS API); anything native; changing the PWA; a clock outside Pocket.
