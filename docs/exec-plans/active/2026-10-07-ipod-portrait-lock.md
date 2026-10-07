---
plan: ipod-portrait-lock
harness: v2 · lean
branch: feat/ipod-portrait-lock
anchor: outcome
status: Built (W1-W2), gate next
next: W0 measurement (headless, then Dean's phone); W1-W3 (Upright default, Sideways kept as a setting, R7); the gate (section 6); the release (version set at release: after v1.369.0)
design: Dean's intake 2026-10-07 (rulings R1-R6 below). Base main a8626406.
gate: APPROVED r2 @f522f600 (adversary, qa; security-brief applied as a section)
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
| R5 | The turn itself | No animation added: the page turn is iOS's; the counter-turn applies in the same frame the angle stamp changes. A frame whose angle still reads portrait (the media query already landscape: Dean's rotate log measured the stamp 257 ms behind the query on the turn back) draws TODAY's sideways (D7) layout, never a wrongly turned or cropped iPod (gate r1 W1: the first build drew the portrait layout unturned there, the wheel below the screen). A flip from 90 straight to 270 keeps the old turn (upside down) until the stamp lands: no web signal says which landscape before it; a device check. |
| R7 | Keep sideways (Dean, 2026-10-07: "You can make it a setting to enable sideways." / "Don't lose the flexibility and existing solidly working code.") | A setting chooses: **Upright** (the new default - the player stays upright when the phone turns) or **Sideways** (today's D7 layout, unchanged). The D7 landscape rules are NOT deleted or rewritten: the upright turn applies only when the setting is Upright, by a marker class (e.g. `html.pk-upright`) the new rules key on, so Sideways is byte-for-byte today's path. The setting lives in Settings > Mobile player ("Keep the iPod upright", on by default) and on the Pocket's own Settings menu ("Stay Upright", a check row, phone only). Builder ruling at W1: it is PER DEVICE (`ft-pocket-sideways` in localStorage, '1' = sideways, absent = upright), like keyboard search beside it in Mobile player (the skin, `ft-music-skin`, IS synced: gate r1 corrected this reason): how a phone is held is that phone's. |
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
- The setting (R7): `ft-pocket-sideways` (per device), the Settings > Mobile player switch "Keep the iPod upright" and the
  Pocket Settings row "Stay Upright"; the marker class is set by music-skins.js at load (every shell that loads it: index,
  history, books, read), re-read at every turn and on a storage event, and set at once by the setter.
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

Gate: CHANGES r1 @6e9a28c0d75a8ed3e7026919ac8e27f2e2a18ea3 — adversary

Gate: CHANGES r1 @6e9a28c0 — qa

Gate: APPROVED r2 @f522f6007d4741f40ad266fb0bb28c3b3e4c3fc2 — adversary

Gate: APPROVED r2 @f522f600 — qa

## 7. Release and evidence

Version set at release (after v1.369.0 ships). Release per docs/RELEASING.md and AGENTS.md (dual Node 22.23.1 + 24.20.0,
protected main: tag the local no-ff merge, push branch + tag in ONE push, `gh pr create`, required checks green, `gh pr merge
--merge`, the tag's Publish Docker Image green, delete the branch).

Evidence (the builder fills, copied from instruments): W0 measurements; W1 / W2 falsifier outputs and mutants by name; suites on
both Nodes; device checks owed.

### Evidence (builder, 2026-10-07)

**W0.1 base (a8626406), tools/pocket-proof/upright-probe.js, the iPod (Classic 5G) on Now Playing, 390x844 / 844x390 (CDP
screenOrientation):** portrait panel [0,0,390,844] flex, LCD [20,16,350,263], wheel [59,421,273,273]; landscape 90 and 270
panel [0,0,844,390] grid (the D7 side-by-side), LCD [22,12,488,366], wheel [536,51,288,288]; back to portrait = the first.

**W0.2 the input census (grep of clientX/clientY and getBoundingClientRect in the Pocket path), classified:**
- turn-invariant: the wheel scrub (atan2 DIFFERENCES about the rect centre, skin-surface.js), the dead centre and the 8 px
  move thresholds (distances), the zone / button taps (DOM hit tests through the transform), elementsFromPoint (screen
  points), the haptic switch's rest scale (the wheel is square), the keyboard-search input (a body-level fixed overlay on the
  bar's screen footprint), pocket-lighting's pointer light (mouse only).
- needs the turn mapped (W2): the volume groove and the seek bar (a fraction of the screen x), the haptic switch placement
  (a translate in the wheel's own frame), the tilt lighting (screen axes), the app's swipe-back (common.js, screen
  "rightward"), Brick's canvas backing store (the rect is the screen footprint), and the lists' touch-action (pan-y is read
  in screen space by Chromium, measured below).

**W1 the skin matrix (7 skins: Cider, Nordic, Classic 5G, Mini 1G, Nano 4G, Shuffle 2G, Custom 5G Transparent; base vs
Sideways vs Upright, 4 states each, the same probe):**
- Sideways == base in every state, every box and the panel's display / grid / transform: YES for all 7.
- Upright portrait == base portrait: YES for all 7.
- Upright at 90 and 270: every part (LCD, wheel, centre, MENU, play; Cider / Nordic: art, title, transport, scrub) mapped
  back through the turn equals portrait within 1 px: YES for all 7. The board photo turns with the player (screenshots read).
- test/geometry G4 (pocket-rotation dark + light, kit-rotation): 3 ok, 0 FAIL ("0 moved" after the change frame).

**W2 tools/pocket-proof/upright-input-probe.js (real CDP touches given in the iPod's own frame, the player opened in each
orientation):**

| state | wheel 3/4 turn | MENU zone | seek tap at 25% | up-next drag | swipe down / right |
|---|---|---|---|---|---|
| Upright portrait | Music -> Speakers (4) | back to Main | 0.25 | 0 -> 99 | 0 / 1 |
| Upright 90 | Music -> Speakers (4) | back to Main | 0.25 | 0 -> 99 | 0 / 1 |
| Upright 270 | Music -> Speakers (4) | back to Main | 0.25 | 0 -> 99 | 0 / 1 |
| Sideways (all 3) | identical to base, field for field | | | | |

Measured on the way: with the lists' pan-y alone the turned up-next drag scrolled 0 px (Chromium reads touch-action in
screen space while scrolling the turned list in its own frame); the turned lists pan on both axes now (99 px, = portrait).

**A leak found by the suite:** test/integration/pocket-library-paging-paths.test.js died of heap exhaustion (SIGABRT) on the
branch, 16/16 on base. Bisected to music-skins.js: a module-scope `var upWin = window` captured by the re-read closure sat in
the module's shared V8 context, so EVERY exported function held each loaded window (12,500-row jsdom pages) alive. Moved into
its own function (installUpright): 16/16.

**Mutants (committed d582bcd8, a /tmp `git archive` sandbox with a pristine copy, restored byte-identical):** 17/17
killed - M1 drop the turn, M2 the wrong sign at 90, M3 the turn ignoring the setting, M4 D7 not Sideways-only, M5 the seek by
screen x, M6 the haptic switch unmapped, M7 the tilt by the screen angle alone, M8 the swipe-back unmapped, M9 the mark ignoring
Sideways, M10 the setter leaving "0", M11 the Stay Upright row never re-listing, M12 Brick by the rect, M13 the lists pan-y
only, M14 the insets not mapped at 90, M15 the Settings switch inverted, M16 the board turned in Upright too, M17 the window
captured at module scope (the paging suite's heap). M7 was killed only by a source lock at first; a driven test now kills it
on its own (a REAL deviceorientation through the real engine on a turned panel at angle 90).

**Suites:** Node 22.23.1 `npm test`: tests 11334, pass 11321, fail 0 (before the Brick test). Node 24: at release.

### Gate round 1 (adversary + qa @6e9a28c0: CHANGES) and the fixes

| Finding | Fix | Proof |
|---|---|---|
| W1 (both seats): the frame before the angle stamp (landscape, `data-ft-rot` still 0) drew the portrait layout unturned, wheel at [278,631] below a 390 px screen | the D7 scope is now `:where(html.is-phone:not(.pk-upright[data-ft-rot="90"]):not(.pk-upright[data-ft-rot="270"]))` (zero specificity; the board rules the same), so D7 draws every landscape frame the upright box does not | upright-probe `landscape-prestamp` row: base grid LCD [22,12,488,366] wheel [536,51,288,288]; Sideways the same; Upright the same; 90 / 270 unchanged (turned) |
| W2 (adversary): the swipe-back CLAIM path (touchmove claim and onClaimedMove) mapped but unbound (N7, N9 survived) | a driven test: a turned rightward-across-the-iPod drag has its later moves preventDefault-ed, rightward across the glass never | N7 and N9 applied to the working copy: the new test red (fail 1) each; restored |
| W2 (qa) / W3 (adversary): the comment called ft-pocket-sideways synced | comment says per device; R7's reason corrected (ft-music-skin is synced) | read |
| W3 (qa): Sideways lost its real-browser rotation check (G4 measured Upright only) | G4 `pocket-rotation-sideways` (seeds ft-pocket-sideways) + mutant `g4-pocket-sideways-wheel-transition` | G4: 4 checks 4 ok; the mutant: `FAIL G4/pocket-rotation-sideways/light (9 boxes moved, worst 14.39px)` |
| S2 (adversary): the storage key-null branch unbound (N6) | test: a clear (key null) re-reads | in pocket-upright.test.js |
| S4 (both): a computed-style read per motion sample | pocket-lighting caches the drawn turn per (stamp, html classes, viewport shape) | the driven tilt test still green |
| S6 / S4 (qa): a test helper matched a class that does not exist; the probe's ghost selector | `is-checked`; `.mms-haptic-ghost` | read |

Disclosed, not changed (to the device checks and ROADMAP): overlays the app draws over the player (a confirm, a toast, the
keyboard for keyboard search) stay in the landscape frame, 90 degrees to the upright iPod (adversary S1); the safe-area
sizes on a real phone (the box's bottom may take a side inset larger than portrait's home indicator, adversary S3); the
direction of `data-ft-rot` 90 on a real phone (adversary S5: if wrong, the iPod is upside down - name both directions);
the "Keep the iPod upright" switch also governs Cider and Nordic (qa S2: wording left for Dean); the Stay Upright row
announces nothing when off (qa S3, like every Pocket check row).


## 8. Out of scope

Locking the whole app (R2); an iPad; the pop-out window (portrait by design); Android (the platform can lock there: a later
`screen.orientation.lock` path if Dean wants it). Anything found goes to ROADMAP Planned.
