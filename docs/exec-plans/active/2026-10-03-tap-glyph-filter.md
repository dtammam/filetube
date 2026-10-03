---
plan: tap-glyph-filter
harness: v2 · lean
branch: fix/v1.361-tap-glyph
anchor: outcome
status: Building (v1.361.0)
next: build done; the gate (adversary + qa, same HEAD), then the release
gate: pending
---

# v1.361: the tap glyph loses its shadow, and v1.360 is undone

Planned 2026-10-03 by the Architect at main d9cbe71d (v1.360.0 shipped). The bug's history and its first two diagnoses are in
`docs/exec-plans/completed/2026-10-03-black-screen-after-pauses.md` (H1 to H8, the v1.360 fix and its gate rounds). This plan is
the third diagnosis, made from Dean's device A/B, and its fix.

## 1. What the device said (Dean, 2026-10-03, iPhone on iOS 27)

1. v1.360.0 FAILED. Capture 2: the background-audio prime ran under the PAUSED video as designed and the picture kept working for
   ~10 s, then froze anyway. Capture 3: the watchdog fired twice (`video:heal n=1`, `n=2`), the layer frame count stayed at 304,
   no `video:heal-ok`: an in-place seek does not revive it. Capture 4: Background audio for video OFF (`bgAudio:arm setting-off`),
   Ambient OFF: still froze, on the FIRST pause/resume after an app restart. H8 (the prime) is dead.
2. Recovery: a far seek into unbuffered time does NOT bring the picture back (the sound carries on from the new spot, so the
   network and the decoder's audio side are fine); docking and returning does not; switching to another video and back DOES (a
   new src); an app restart does.
3. **The A/B that names the trigger: 20 pause/play cycles with ONLY the bar's button never went black. Picture taps did.**
4. "This is a somewhat new thing", and the phone is on iOS 27. The server and connection audit (an Explore pass, 2026-10-03)
   found nothing that can hold a video range request (`lib/media/streams.js` `sendRangeable`: a fresh stat and stream per
   request, `pipeline` destroys it on an abort, no locks or limiters; no long-lived connection on the watch page unless Remote
   is on).

## 2. The diagnosis

A picture tap differs from the bar's button in what it PAINTS: `toggleArtPlayPause` -> `flashArtGlyph` flashes `.art-play-glyph`
over the playing video for 650 ms (an opacity + scale animation), and its `::before` carried `filter: drop-shadow(0 2px 6px
rgba(0,0,0,.6))`. That is the v1.312 class exactly (LESSONS 7 / LESSONS-rules: a filter, mask or backdrop on or over a playing
iPhone video blacks out its picture while the sound and the glow run on), and it fits every fact: the video's own layer stops
(the frame count is the layer's metric), a seek cannot rebuild it, a new src can, the bar's button never paints the glyph, and the
glyph is old (v1.134 put it on video taps) so "new" is the OS (iOS 27). The double-tap skip ripple has no filter (an opacity
animation of a translucent wash) and stays.

Not proven: whether it is the FILTER or the flash itself (a composited opacity / transform animation over the video). The fix
removes the filter only (Dean's ruling: "Keep it, drop the shadow"); if picture taps still black it out, the next step is no glyph
over the video. Dean ruled against a recovery mechanism ("I don't know if we want to build in a weird recovery mechanism for a glyph
graphic problem") and for removing what v1.360 added ("I don't want to keep something we added that didn't work").

## 3. Acceptance

1. `.art-play-glyph::before` has no `filter`; the glyph's legibility backing is a painted disc (`.art-play-glyph` background:
   a radial gradient of `var(--scrim)` with radius `var(--size-control)`). It flashes exactly as before (same element, class,
   animation and timing).
2. No stylesheet rule whose selector names the player host, the video or an overlay in it carries `filter`, `backdrop-filter`,
   `mask`, `mask-image` or `mix-blend-mode` (locked by `test/unit/player-overlay-no-filter.test.js`, red on v1.360's stylesheet).
3. `public/js/player.js` and `test/unit/player-background-audio.test.js` are byte-identical to v1.359.0 (4c366600);
   `test/unit/black-picture-watchdog.test.js` is deleted.
4. `npm run lint:ui` OK (the ratchet shrank by one paid annotation).
5. Docs: ROADMAP (the bug entry, the v1.361.0 Shipped entry), DEVICE-CHECKS (the v1.360 lines replaced), LESSONS 7 (the v1.360
   section-5 bullet removed as wrong; a section-7 bullet for the class, x2).

Falsifier on device: black again after picture taps = the filter was not (all of) it; next = no glyph over the video.

## 4. Build log

- `git checkout 4c366600 -- public/js/player.js test/unit/player-background-audio.test.js`; `git rm test/unit/black-picture-watchdog.test.js`.
- `public/css/style.css`: the filter line removed from `.art-play-glyph::before`; a new `.art-play-glyph` rule with the disc.
  A first draft used an `::after` disc with four `token-exempt` sizes (ui-lint: NEW debt 203 > 200); redone with tokens, then
  `node scripts/ui-lint.js --shrink` (199).
- `test/unit/player-overlay-no-filter.test.js`: 2 tests; green here, both red against main's (v1.360) stylesheet.
- Look: headless Chromium crop, before vs after, frozen mid-flash over a real thumbnail, sent to Dean.

## 5. Gate record

Seats: adversary + qa (the shared player overlay CSS and a revert of the player core; security-brief applied as a section by both).

### qa r1 @45bf97a2

Instruments (Node 22.23.1): `npm run lint:ui` "ui-lint: OK - the live debt equals docs/ui-exceptions.json" (token-exempt 202, 2 keys);
`overlay-containment-lint --enforce` "clean (0 violations)"; eslint on the new test exit 0; the three named test files 131 tests,
131 pass, 0 fail. `git diff 4c366600 45bf97a2 -- public/js/player.js test/unit/player-background-audio.test.js` empty (0 bytes);
the watchdog test is gone. Sandbox (git archive of 45bf97a2): the lock is 0/2 on main's stylesheet; red on a `-webkit-filter`
inside an `@media` block on `#media-player`, a `#player-wrapper .ui-icon` filter and a glyph `::after` filter; GREEN on
`.speed-badge { backdrop-filter }` and `.player-resumed { backdrop-filter }`. No em dashes added. Security: none (CSS paint,
a source-reading test, docs, and a byte-exact revert to the gated v1.359 player.js; no input, network, auth or shell).

- W1 (lock net, inert sibling list) `test/unit/player-overlay-no-filter.test.js:17`: PLAYER_SELECTOR omits overlays that sit
  over a PLAYING video: `.speed-badge` (the 2x hold pill), `.player-resumed` / `#resume-toast` (the 4 s auto-resume chip),
  `.skip-controls`, `#player-controls` (id spelling), `.resume-overlay`, `#audio-bg-art`, `.player-container`. Scenario: a
  restyle gives the resume chip a frosted `backdrop-filter: blur(6px)` (the chip look `.mms-sticker` already uses): the lock stays
  green (measured) and the v1.312 / v1.361 class ships on every resumed video. Fix: derive the net from the markup (the ids and
  classes of `#player-wrapper` and its descendants in `public/watch.html`), or at least add the names above, and add one
  mutation-style case per new name.
- W2 (overclaim) `docs/LESSONS.md:153`: "began blacking out the video picture on iOS 27" states as fact what the plan (section 2,
  "Not proven"), ROADMAP and the CSS comment call a suspect; and "locked ... over every selector that names the player or an overlay
  in it" (also ROADMAP.md:551-552 "an overlay in it") is not true of the lock (W1). Scenario: the device check fails (the flash
  itself is the trigger), and the canonical lesson file already records the wrong cause. Fix: "is the suspect for (unconfirmed at
  release)", and make the lock claim true (W1) or narrow it.
- S1 `docs/DEVICE-CHECKS.md:6`: "now the v1.360.0 checks" is stale; the section is v1.361.0.
- S2 `public/css/style.css:1472`: `--scrim` is 0.3 in light mode and 0.5 in dark mode (tokens.css), so the disc over a video varies
  with the PAGE's mode, and the DEVICE-CHECKS "faint dark disc" is 0.5 black in dark themes. Consider a mode-independent value;
  also the second `.art-play-glyph` rule could fold into the base rule at 1444.
- S3 `docs/LESSONS.md` (removed section-5 bullet): its last sentence (read the `?debugLifecycle=1` panel newest first; `t=` is the
  media clock) was a valid tool note unrelated to the wrong theory; keep it somewhere.
- Checked and fine: item 1 (filter gone, same element / class / animation / timing; at rest the host is opacity 0 so the disc is
  invisible; the reader bar hides it; the disc also shows on the audio cover flash, disclosed); item 4 (the shrink is the removed
  filter line's paid token-exempt annotation, 200 -> 199); no dangling code references to v1.360 (only history in ROADMAP Shipped
  and the plans).

Gate: CHANGES r1 @45bf97a2 - qa

### adversary r1 @45bf97a2

Measured (Node 22.23.1, mutants in a scratchpad clone of 45bf97a2): `git diff 4c366600 45bf97a2 -- public/js/player.js
test/unit/player-background-audio.test.js` empty; the watchdog test is gone; no reference to `frozenPictureDecision`,
`framesClimbed`, `video:heal` or the watchdog test outside history (ROADMAP v1.360.0 Shipped, the two plans). `npm run lint:ui`
OK. The lock: 2/2 green at HEAD, 0/2 on d9cbe71d's style.css; red on `.skip-ripple { backdrop-filter }`, `#media-player { mask }`,
`-webkit-filter`, a filter inside `@media`, inside `@supports { @media { } }` (the naive rule regex does see nested blocks), in
ui.css, and the disc removed. The 104 unit files that read style.css and mention filter/mask/backdrop: 1913 tests, 1913 pass at
HEAD. Full `npm test` NOT re-run by this seat. `--scrim` and `--size-control` (36px, so 72px across) resolve in every
theme/mode block of tokens.css; only style.css:1444/1471 paint `.art-play-glyph` (the reader bar hides it at 7317); at rest the
element is opacity 0. Every other filter/mask/backdrop in the CSS (icon masks, `.mms-*` music sheet, `.critter-*`, mute
clip-path, `.ui-swipe__action`) is not on or over the video; critters exclude `#player-wrapper`/`.player-container`/dock/fs-stage
(common.js:8421). No JS writes an inline filter/mask/backdrop (swept). The "A/B written down since v1.336" claim is true
(the v1.336 DEVICE-CHECKS line asked for "only the bar's play button").

- W1 (inert sibling list; concur qa W1, measured independently) `test/unit/player-overlay-no-filter.test.js:17`: each of these
  stays green on the lock AND on all 1913 CSS-reading tests: `.player-container { }` / `.player-container::after { backdrop-filter }`
  (the HOST's own class, the same element as `#player-wrapper`: a filter there is on the video itself), `.speed-badge {
  backdrop-filter: blur(8px) }` (the 2x pill over a playing video; the net names only `#speed-badge`, 4 rules, while the real
  rules use the class), `.player-resumed { -webkit-backdrop-filter }`, `.skip-controls { filter }`, `#skip-ripple-left {
  mix-blend-mode }`, `video { filter }`. LESSONS.md:153 and ROADMAP.md (v1.361.0 Lock line) claim the lock covers "every selector
  that names the player ... or an overlay in it": false as measured. Fix: derive the net from the host template's ids and classes
  (`#player-wrapper` and its descendants in public/watch.html) plus `video`, and bind the derivation (assert `.player-container`,
  `.speed-badge` are in it).
- W2 (constraint lock misses case; LESSONS.md:77 names `FILTER:` explicitly) `test/unit/player-overlay-no-filter.test.js:18`:
  `.art-play-glyph::before { FILTER: drop-shadow(0 0 1px #000) }` passes 2/2 (CSS property names are case-insensitive; WebKit
  applies it). Fix: the `i` flag on LAYER_PROPS (and on the `/filter/` check in test 2).
- W3 (overclaim; concur qa W2) `docs/LESSONS.md:153`: "began blacking out the video picture on iOS 27" states the suspect as the
  proven cause, against plan section 2 "Not proven", the ROADMAP "Disclosed: the shadow is the suspect" and the CSS comment.
  If the device check fails, the canonical lesson file holds a wrong cause (exactly what the removed v1.360 bullet had to be
  pulled for). Fix: "is the suspect for ... (unconfirmed at release)".
- S1 test 2 binds the disc with `.some(...)`: a later `.art-play-glyph { background: none; }` (M25) stays 2/2. Bind exactly one
  `.art-play-glyph` background in style.css, or the last one.
- S2 the net's property list omits WebKit mask aliases `-webkit-mask-box-image` / `mask-border` (LESSONS 77: read WebKit's alias
  list); `#media-player { -webkit-mask-box-image: url(x) }` stays green. `clip-path` is also unlocked (not in the plan's list;
  judge).
- S3 (computed from the CSS, not rendered) the pause glyph is off-centre on the disc: the `::before` box is 10px + margin-right
  `--space-4` (8px) = 18px laid out, but paints 28px (the bar + the 18px box-shadow), so the bars' centre sits 5px right of the
  disc's. Pre-existing, now visible against a concentric disc; `margin-right: 18px` (or a token) centres it.
- S4 concur qa S1: `docs/DEVICE-CHECKS.md:6` still says "now the v1.360.0 checks".
- Security: none. CSS paint, a source-reading test, docs, and a byte-exact revert to the gated v1.359.0 player.js; no input,
  network, auth, storage or shell surface.

Gate: CHANGES r1 @45bf97a2 - adversary

### Fix round r1 -> r2 (both seats CHANGES @45bf97a2, no CRITICAL)

| Finding | Fix |
|---|---|
| qa W1 / adv W1: the lock's hand-written selector list missed `.player-container`, `.speed-badge`, `.player-resumed`, `.skip-controls`, `#skip-ripple-left`, `video`, `#player-controls`, ... | The net is DERIVED from the host template in watch.html (every id and class in `#player-wrapper`'s subtree) plus `video`, `#player-dock`, `#fs-stage`; a test pins that the net holds the wrapper, the video and the overlays. |
| adv W2: `FILTER:` (case) passed | LAYER_PROPS and the glyph check are case-insensitive. |
| adv S2: `-webkit-mask-box-image` / `mask-border` passed | `mask(-[a-z-]+)?` (every mask longhand). `clip-path` stays unlocked (not a compositing filter; the mute icon uses it). |
| adv S1: `.some()` let a later `background: none` win | The LAST `.art-play-glyph` background must be the disc. |
| qa W2 / adv W3: LESSONS overclaimed the cause and the lock's coverage | "the suspect ... (unconfirmed at release)"; the coverage claim now matches the derived net (also in the ROADMAP lock line). |
| adv S3: the pause bars sat 5 px right of the disc | `margin-right: calc(var(--space-4) + var(--space-5))` (18 px): the 28 px painted pair centres. |
| qa S1 / adv S4: DEVICE-CHECKS:6 said v1.360 | v1.361. |
| qa S2: the disc's darkness follows the mode; two `.art-play-glyph` rules | Folded into the base rule; the comment, the ROADMAP and the device check say 0.3 light / 0.5 dark. |
| qa S3: the newest-first panel tip was lost with the removed bullet | Kept at the end of the LESSONS 7 bullet. |

Mutants against the new lock (a copy of public/css + watch.html + the test, one appended rule each): `.player-container::after`
backdrop, `.speed-badge` backdrop, `.player-resumed` -webkit-backdrop, `.skip-controls` filter, `#skip-ripple-left` blend,
`video` filter, `FILTER:` on the glyph, `-webkit-mask-box-image` / `mask-border` on `#media-player`, a filter inside `@media`,
`.art-play-glyph { background: none }` after the disc, `#player-controls` backdrop: 11 of 11 red. Pristine: 3 pass.
