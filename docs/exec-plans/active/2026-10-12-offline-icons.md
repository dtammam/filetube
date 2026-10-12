---
plan: offline-icons
harness: v2 · full
branch: fix/v1.387.2-offline-icons
anchor: spec
status: Building
next: gate (adversary), then release
design: Dean's device report 2026-10-12 (iOS app v0.9.0 build 12; worked yesterday on v0.8.1), reproduced in WebKit with an injected host the same day. Dean: "an extremely minor and tiny scoped hotfix". Base = main eedaedd8 (v1.387.1 + the baselines PR).
builder: the FileTube Root (a 6-file swap; Dean asked for the smallest possible fix)
gate: pending
---

# v1.387.2: the "You" menu and every "More" menu open again inside the iOS app

## 1. Outcome (Dean, 2026-10-12)
Inside the iOS app, the bottom-nav "You" tab and every "More" menu (cards, the watch page, song rows, podcast episodes)
open again, each with its offline entry. Browsers and the PWA: no change.

## 2. Root cause (reproduced)
v1.387.0 (c3781bad) gave the offline rows two icon names the registry does not have, `download_for_offline` and
`offline_pin` (common.js:7410, main.js:747, watch.js:706, music.js:585 + :4431, podcasts.js:811). `ui.icon` throws on an
unknown name by design (ui.js checkIcon, F39), so building the menu aborts before it opens. The rows exist only when the host
announces `downloads`, which the app first did in v0.9.0: hence app-only, from this morning. Reproduced in WebKit at 390x844
with an injected host (all seven capabilities): "You" on Home / Music / Podcasts / TV and a song row's More all dead with
`Error: ui.icon: unknown icon "download_for_offline"` (stack: checkIcon ui.js:87 < accountMenuRow common.js:6812 < buildPanel
common.js:7410 < openMenu common.js:7539); with no host, every one opens. The v1.387.0 unit test compared the name as a string
(offline-ui.test.js:244) and never met the registry: an inert guard (LESSONS 2).

## 3. The fix (the smallest that works)
- Use glyphs the registry already has: `download_for_offline` -> `download`, `offline_pin` -> `delete` (the "Remove offline
  copy" action), in the six call sites above. No new glyphs, no icon pipeline run, no behaviour change.
- test/unit/icon-names-registered.test.js: every icon name spelled in public/js (an `icon:` property including both ternary
  arms, `U.icon` / `ui.icon`, `songIconHtml`) must be in the registry; a floor on the names found keeps the scan honest.
  Bound: restoring `download_for_offline` in common.js turns it red (`common.js: download_for_offline`).
- offline-ui.test.js: the two expected names updated.

## 4. Gate
adversary (the floor). Brief: a call site the census cannot see; a remaining unregistered name; any change with no host.

## 5. Release
docs/RELEASING.md; the Root merges on green (Dean's go for this hotfix, 2026-10-12); shipped = the tag's "Publish Docker
Image" green; tell the iOS Root.

## 6. Evidence
- Full `npm test`, Node 22.23.1, on the fix: tests 12429, pass 12416, fail 0, skipped 13.
- Census bound: `download_for_offline` restored in common.js -> icon-names-registered red (pass 0, fail 2); reverted -> 26/26 with offline-ui.

## 7. Out of scope
New offline glyphs (a later look pass may add `download_for_offline` / `offline_pin` through tools/icons); softening
`ui.icon`'s throw (deliberate, F39); anything native.
