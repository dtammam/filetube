---
plan: ipod-portrait-lock
harness: v2 · lean
branch: feat/ipod-portrait-lock
anchor: outcome
status: Ruled (intake 2026-10-07)
next: W0 measurement (headless, then Dean's phone); W1-W3 (Upright default, Sideways kept as a setting, R7); the gate (section 6); the release (version set at release: after v1.369.0)
design: Dean's intake 2026-10-07 (rulings R1-R6 below). Base main a8626406.
gate: pending
---

# Lock the iPod in portrait: turning the phone sideways changes nothing

Dean, 2026-10-07: "lock the iPod mode in iPod mode. So, like, if you even turn the phone sideways, it won't change it."
Norms: no em dashes in docs or user prose; stage files by name; `git commit -F <file>`; never pipe a commit or push; export
the fnm Node 22.23.1 PATH before any node/npm/git command; no toggle workarounds.

Read first: AGENTS.md, docs/LESSONS.md sections 0, 2 (drive the REAL rotate, not a hand-set class), 3 (the UI ratchet, the
overlay containment census), 4 (shell parity, the body lock), 6 (CSS blast radius, stacking), 8 (platform facts: iOS, WebKit,
PWA).

## 1. Outcome

With the iPod (any Pocket skin) up on the phone, turning the phone sideways changes nothing you see: the iPod stays upright
in your hand, the same size, the same layout, and the wheel and buttons work as they did. The rest of the app (a video full
screen, the browse pages) still turns with the phone.

## 2. What exists (read 2026-10-07 at a8626406)

- **Pocket is a device class, not a width** (UI pass D7): `html.is-phone`, set once from the screen's short side
  (public/js/music-skins.js `markPhoneClass`), so a turn never tears the skin down.
- **The sideways layout D7 built** (Dean's earlier ruling "Pocket on rotation: STAY in Pocket"): style.css
  `@media (orientation: landscape)` "POCKET IN LANDSCAPE" (~10890): the LCD left, height-fitted; the wheel right; Cider and the
  other skins side by side; the safe-area insets pad the sides. It works and STAYS (R7): it becomes the "sideways" choice.
- **The screen's angle is already stamped**: public/js/pocket-lighting.js `stampRotation` writes `html[data-ft-rot="0|90|180|270"]`
  (screen.orientation.angle, else window.orientation) for the Transparent skins' board photo (style.css ~10680, v1.350, which
  turns the photo back by the angle so it stays on the glass; v1.354 draws none while the angle still reads portrait).
- **The wheel**: skin-surface.js reads the finger's ANGLE around the wheel's centre (atan2, ~3182 / ~3252) and turns on the
  DIFFERENCE between moves, which a rotation of the whole player does not change; MENU, play and skip are DOM buttons, which the
  browser hit-tests through a CSS transform. To MEASURE (W0): anything that reads raw finger DIRECTION (a list drag, a swipe,
  the scrub's x0/y0 thresholds, the pull-down, quick scroll) and anything that measures sizes with getBoundingClientRect.
- **Platform facts** (MDN browser-compat-data 8.1.4, read 2026-10-07, not from memory): iOS Safari supports NEITHER
  `screen.orientation.lock()` (`version_added: false`) NOR the web app manifest's `orientation` member (`false`), so a home-screen
  app cannot ask iOS to stay portrait. `screen.orientation.type` / `.angle` exist since iOS 16.4; `window.orientation` always.

## 3. Measurements (W0, before any edit)

1. Headless Chromium at an iPhone 14 size (390x844) and its landscape (844x390) with `Emulation.setDeviceMetricsOverride`
   screenOrientation angle 90 and 270, the iPod and each Pocket skin: screenshots and the bounding boxes of the LCD, the wheel,
   the buttons, today (base) for the evidence block.
2. A list of every pointer/touch handler in the Pocket path that reads clientX / clientY direction or a size (grep + read), each
   classified: rotation-invariant (angle deltas, DOM hit tests) or needs the turn mapped.
3. Dean's phone (home-screen app), after W1 is up as a branch build or on the next release: does iOS animate the page turn, what
   are the safe-area insets in each landscape direction, does the status bar show (device check).

## 4. Rulings

| # | Question | Ruling |
|---|----------|--------|
| R1 | What must stop (Dean) | Both: the layout changing AND the whole page turning sideways. |
| R2 | Scope (Dean) | Only while the iPod / a Pocket skin's full player is up. The browse pages, a video and full screen still turn. |
| R3 | Where (Dean) | The home-screen app (Safari's tab gets the same code; the platform cannot lock either). |
| R4 | How (builder, from the platform facts; when Upright is chosen, R7) | iOS cannot be asked to stay portrait, so the page DOES turn; the full player is then drawn as a PORTRAIT box (the phone's portrait width x height) turned back by the screen's angle (`html[data-ft-rot]` 90 -> -90deg, 270 -> 90deg) about the viewport centre, so it sits upright in the hand. The D7 side-by-side landscape rules stop applying to the full player. The Transparent board photo needs no turn inside the turned box (it is already upright with the glass): its `--mms-ipod-board-turn` rules follow. |
| R5 | The turn itself | No animation added: the page turn is iOS's; the counter-turn applies in the same frame the angle stamp changes (v1.354's rule: a frame whose angle still reads portrait draws the player unturned rather than wrongly turned). |
| R7 | Keep sideways (Dean, 2026-10-07: "You can make it a setting to enable sideways." / "Don't lose the flexibility and existing solidly working code.") | A setting chooses: **Upright** (the new default - the player stays upright when the phone turns) or **Sideways** (today's D7 layout, unchanged). The D7 landscape rules are NOT deleted or rewritten: the upright turn applies only when the setting is Upright, by a marker class (e.g. `html.pk-upright`) the new rules key on, so Sideways is byte-for-byte today's path. The setting lives in Settings > Mobile player and on the Pocket's own Settings menu; it is a synced pref (`ft-pocket-sideways`, '1' = sideways), so its sibling lists apply (prefs-sync.js, lib/prefs-allowlist.js and the plan-key lock, LESSONS 12). |
| R6 | Safe areas | The turned box uses the PORTRAIT safe-area meaning: the notch / Dynamic Island edge and the home indicator edge follow the glass (in landscape the env() insets arrive on the left/right; the box maps them back to its own top/bottom). Measured on the device (W0.3). |

## 5. Waves

### W0. Measure (no edits)
- Section 3, items 1 and 2; outputs into section 7.

### W1. The turned full player (CSS + the one stamp)
- Under `@media (orientation: landscape)` and `html.is-phone.pk-upright[data-ft-rot="90"|"270"]`: the full player (`.mms-full`)
  becomes a fixed box of the portrait size (100vh x 100vw of the landscape viewport, i.e. the phone's portrait width and height)
  centred and rotated by -90deg / 90deg. The D7 landscape rules are untouched; under `pk-upright` the new rules win for the
  full player (higher specificity, or the D7 selectors gain `:not(.pk-upright)` - builder picks the smaller, untouched-D7 way and
  proves the Sideways path's computed styles are byte-identical to base).
- The setting (R7): `ft-pocket-sideways` (synced), the Settings > Mobile player switch "Turn the iPod sideways" and the Pocket
  Settings row; the marker class is set from it at boot and on change (storage event, prefs-sync), before first paint where the
  shell's pre-paint block already sets classes (LESSONS 4: every shell that can host the player).
- The board photo: inside the turned box the photo's own turn is none for 90 / 270.
- Falsifier: headless Chromium (CDP) at landscape 844x390 with angle 90 and 270: the LCD and wheel bounding boxes, mapped back
  through the turn, equal portrait's within 1px for every Pocket skin; the screenshot of the turned player rotated back matches
  portrait's (pixel diff over the player box); at angle 0 in a landscape viewport (the pre-stamp frame) the player is drawn
  unturned (v1.354); a browse page in landscape is untouched; with Sideways chosen, every Pocket element's computed style in
  landscape equals base's (the D7 path is unchanged). Mutants: drop the turn (boxes differ), the wrong sign (the player upside
  down: the wheel's MENU at the bottom of the glass), the turn ignoring the setting (Sideways turns too: red), the setting's
  sync sibling lists (an allowlist entry dropped: red).

### W2. Input under the turn
- Every handler W0.2 lists as direction- or size-dependent gets the turn mapped (one helper: screen point -> player point, by
  the stamped angle), never a per-handler copy (LESSONS 12).
- Falsifier: CDP `Input.dispatchTouchEvent` at landscape angle 90 and 270: a clockwise circle on the GLASS scrolls the menu down
  exactly as in portrait (same detents count); MENU / Select / play / skip by their physical positions; a list drag and the
  quick scroll move the right way; the pull-down (if any) still means down on the glass. Mutants: drop the mapping (the drag goes
  sideways or reversed).

### W3. Close-out
- ROADMAP Shipped, releases.json in user language, LESSONS (the platform fact: iOS cannot lock orientation from the web; the
  counter-turn pattern), device checks: the iPod in the home-screen app turned both ways (upright, same size, the wheel and
  buttons work, the notch side clear of the controls), a browse page and a full-screen video still turn, the Transparent skins'
  board photo stays on the glass, the turn back to portrait.

## 6. Gate

Seats: adversary (floor) + qa (UI/layout on the device's hardest path - LESSONS 1 "seats split" - never collapse to one seat);
security-brief applied as a section (client-only, no server, auth or data change). Name to the seats: the real rotate path
(the angle stamp's timing, the pre-stamp frame), the blast radius of the landscape media query (every Pocket skin, the pop-out
excluded, browse pages untouched), input mapping by physical position, the safe areas, the board photo, the ratchet and the
containment census. Pacing: ship on CRITICAL/WARNING closure; after 2 rounds, ask Dean at round 3.

## 7. Release and evidence

Version set at release (after v1.369.0 ships). Release per docs/RELEASING.md and AGENTS.md (dual Node 22.23.1 + 24.20.0,
protected main: tag the local no-ff merge, push branch + tag in ONE push, `gh pr create`, required checks green, `gh pr merge
--merge`, the tag's Publish Docker Image green, delete the branch).

Evidence (the builder fills, copied from instruments): W0 measurements; W1 / W2 falsifier outputs and mutants by name; suites on
both Nodes; device checks owed.

## 8. Out of scope

Locking the whole app (R2); an iPad; the pop-out window (portrait by design); Android (the platform can lock there: a later
`screen.orientation.lock` path if Dean wants it). Anything found goes to ROADMAP Planned.
