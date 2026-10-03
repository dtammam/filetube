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

### qa r2 @1e2d6bee (delta 45bf97a2..1e2d6bee)

Instruments (Node 22.23.1): `npm run lint:ui` "ui-lint: OK - the live debt equals docs/ui-exceptions.json" (token-exempt 202,
2 keys); `overlay-containment-lint --enforce` "overlay-containment: clean (0 violations)"; eslint on the lock exit 0; lock +
player-background-audio + era-player-skins: 132 tests, 132 pass, 0 fail, 0 skipped. `git diff 4c366600 HEAD -- public/js/player.js
test/unit/player-background-audio.test.js` still 0 bytes. No em dashes added in the delta. Lock mutants (sandbox, git archive of
1e2d6bee): baseline 3/3; RED on the W1 frosted resume chip (`.player-resumed { -webkit-backdrop-filter; backdrop-filter }`),
`.speed-badge { backdrop-filter }`, `.player-container::after { FILTER }` (upper case), `video { -webkit-mask-size }` inside
`@supports { @media { } }`, a later `.art-play-glyph { background: none }`, and a `-webkit-filter` on the pause-glyph rule (2 red).

- W1 FIXED as prescribed (net derived from the template; the derivation bound by test 1).
- W2 FIXED: LESSONS 7 says "is the suspect ... (unconfirmed at release)"; ROADMAP adds "the suspect" and the disclosure stands.
- S1 FIXED (v1.361.0). S2 FIXED-differently and fine: the rule is folded into the base rule with an accurate comment, and the
  0.3 / 0.5 mode dependence is disclosed (ROADMAP, DEVICE-CHECKS "a little darker in dark mode") rather than changed. S3 FIXED
  (the tip is kept in the LESSONS 7 bullet).
- Pause-bar margin: verified by arithmetic. The flex box is 10px + margin wide and the painted pair spans 28px, so its centre is
  offset 9 - margin/2: the old 8px (--space-4) put it 5px right, and 8 + 10 (--space-5) = 18px centres it. The comment is accurate.
  This is a disclosed look change (ROADMAP, DEVICE-CHECKS).
- W3 NEW (introduced by the fix: the derivation's mechanism is not what its comment and the docs say)
  `test/unit/player-overlay-no-filter.test.js:27-44`. The depth walk counts tag-like text inside HTML comments: watch.html:388 has
  `<video controls>` and :420 has `<video id="media-player">` inside `<!-- -->`. Depth is off by 2, so the walk never stops at the
  wrapper's `</div>` and runs on to line 593 (`</body>`). Measured: the net is 42 ids and 56 classes, including `bottom-nav`,
  `bottom-nav-item`, `nav-playlists-btn` and `nav-theme-toggle`, which are outside `#player-wrapper`. With comments stripped it is 39
  ids and 49 classes, the bottom nav drops out, and the lock stays 3/3. Failure scenarios:
  (a) Measured: `.bottom-nav { backdrop-filter: blur(12px) }` fails the lock as a "player" rule, while the test comment, LESSONS:153
  and ROADMAP's Lock line say the net is "every id and class in `#player-wrapper`".
  (b) Reasoned: the converse. A future comment in the wrapper with closing-tag text (say `</div>`) ends the walk early and silently
  drops every name after it. Test 1 binds only 5 ids and 5 classes, so most of those drops would pass.
  Fix: strip `<!--[\s\S]*?-->` before the walk, and assert the walk ended at the wrapper's own close (for example, `bottom-nav`
  is NOT in the net). If the fixed bottom nav (which can sit over a scrolled video) belongs in the net, add it to HOSTS deliberately
  with that reason, and say so in the docs.
  This is fail-safe today (over-inclusive: no player filter can slip through), but it is a lying mechanism comment and doc claim,
  and the fix is two lines.

Gate: CHANGES r2 @1e2d6bee - qa

### adversary r2 @1e2d6bee (delta 45bf97a2..1e2d6bee)

Measured (Node 22.23.1, a scratchpad clone of 1e2d6bee, one mutant at a time, restored from HEAD). Baseline: the lock passes 3/3.
I did not re-run the full suite. The walker, run on all 9 shells and compared with a jsdom parse of each `#player-wrapper`:
8 shells match exactly (86 names each; the walk stops at the wrapper's close, `</template>` next). watch.html does NOT: the walk
runs on to `</body>`, adding `bottom-nav`, `nav-playlists-btn`, `nav-theme-toggle`, `ui-btn--md`, `ui-btn--stack`,
`bottom-nav-item`, `ui-btn__icon`, `ui-icon--lg`, `bottom-nav-label`. Every shell's template holds the same 86 names, so reading
only watch.html is fine. No icon mask lands in the net (the lock is green on the real CSS).

- W1 FIXED, verified: all six r1 mutants are now red (`.player-container::after` backdrop, `.speed-badge` backdrop,
  `.player-resumed` -webkit-backdrop, `.skip-controls` filter, `#skip-ripple-left` blend, `video` filter).
- W2 FIXED: `FILTER:` red, `-WEBKIT-FILTER:` red (2 tests each).
- W3 FIXED: LESSONS 7 now says "is the suspect ... (unconfirmed at release)".
- S1 FIXED for the exact selector (`.art-play-glyph { background: none }` red). Still green: `#art-play-glyph { background: none }`
  and `.player-container .art-play-glyph { background: none }`. This remains a SUGGESTION, not blocking.
- S2 FIXED: `-webkit-mask-box-image` and `mask-border` red. `clip-path` stays out by ruling; acceptable.
- S3 FIXED: --space-4 (8px) + --space-5 (10px) = 18px, so the laid-out 10 + 18 = 28px equals the painted 28px pair. Checked by
  arithmetic, not rendered. Unlocked: reverting the margin keeps the lock 3/3. Suggestion only.
- S4 FIXED.

New:
- W4 (concur qa r2 W3, measured independently) `test/unit/player-overlay-no-filter.test.js:27-44`: the depth walker counts tag
  text inside HTML comments (watch.html `<video controls>` in the 'Standard video player' comment). So it does not stop at the
  wrapper. `.bottom-nav { backdrop-filter: blur(10px) }` and `.ui-btn--md:hover { filter: brightness(1.1) }` (an app-wide class)
  are red as "player" rules. Converse: a `</div></div>` inside a wrapper comment ends the walk early. Test 1's required list
  caught my placement, but it binds only 10 names. Fix: strip comments before the walk (LESSONS 76: once, at read), and assert
  the walk ended at the wrapper (`bottom-nav` absent).
- W5 (enumeration gap: elements built by JS) the net is the TEMPLATE, but player.js builds overlays into the host at runtime that
  the template never names. Each of these stays 3/3 green:
  - `.cc-overlay { backdrop-filter: blur(6px) }`: the captions overlay, appended to the host at player.js:2774-2780 and drawn
    over the playing video whenever CC is on. A frosted caption box is a likely restyle.
  - `.cc-overlay-text { -webkit-backdrop-filter }`.
  - `.seek-preview { backdrop-filter }` (player.js:2786-2797, inside `.player-controls`).
  - `#player-slot { filter: blur(1px) }`: the watch view's host parent (watch.html:231). It is an ANCESTOR of the video, so a
    filter there is on the video, yet HOSTS lists the dock and fs-stage only.

  LESSONS:153 and ROADMAP's Lock line ("every id and class in `#player-wrapper`") read as "everything inside the player", and
  that is false for these. Fix: add the JS-built classes (`cc-overlay`, `cc-overlay-text`, `seek-preview*`, `seek-chapters`,
  `chapter-now`, `player-dock-close`) and `player-slot` / `reader-player-slot` to the net. Best is to derive them, e.g. from the
  `className = '...'` writes in player.js's host-building block. Then add a mutant per name.
- S5 over-breadth by design: template classes such as `ui-btn`, `ui-icon` and `ui-btn--plain` are app-wide, so the lock forbids
  a filter on ANY `.ui-btn` rule anywhere (e.g. a hover `filter: brightness`). It is fail-safe and green today. Document it, or
  match only compound selectors that also carry a player-specific name.
- Security: no change from r1 (none).

Gate: CHANGES r2 @1e2d6bee - adversary

### Fix round r2 -> r3 (both seats CHANGES @1e2d6bee, no CRITICAL, both findings in the lock only; Dean, AskUserQuestion: "Fix the test, short round 3")

| Finding | Fix |
|---|---|
| qa W3 / adv W4: the depth walk counted tags inside HTML comments (watch.html's commented `<video ...>`), ran past the wrapper to `</body>` and pulled in the bottom nav | `<!-- -->` stripped before the walk; the walk must reach the wrapper's own close; test 1 asserts `bottom-nav` / `bottom-nav-item` are NOT in the net. A `<!-- </div></div> -->` inside the wrapper no longer shortens it (measured: 3 pass). |
| adv W5: overlays player.js builds at runtime (`.cc-overlay*`, `.seek-preview*`, ...) and `#player-slot` were outside the net | Every `.className = '...'` and `.id = '...'` literal in player.js joins the net (the page-level debug panel excluded by name); `player-slot` and `reader-player-slot` join the hosts. Test 1 pins `cc-overlay`, `cc-overlay-text`, `seek-preview`, `seek-chapters`, `chapter-now`, `speed-sheet-backdrop`, `player-dock-close`, `#player-slot`. |
| (found by the widened net) `.icon-share`, the chapters menu's share icon, is drawn with a CSS mask | A named, commented exemption (`EXEMPT_CLASSES`): the app-wide `.icon-*` mask technique on a menu that opens only on request, not an effect over the playing picture. Disclosed in the ROADMAP lock line. |
| adv S5: the net is wide by design (ui-btn / ui-icon primitives) | Documented in the test header ("errs safe"). |
| adv S1 / S3 (not blocking) | Left: the disc check binds the exact selector; the pause-bar margin is arithmetic, unguarded (a device look). |

Mutants (a copy of public/css + watch.html + player.js + the test, one appended rule each): `.cc-overlay` backdrop,
`.cc-overlay-text` filter, `.seek-preview` backdrop, `.seek-preview-img` filter, `.seek-chapters` blend, `.chapter-now` filter,
`.player-dock-close` backdrop, `.speed-sheet-backdrop` backdrop, `#player-slot` filter, `#reader-player-slot` filter,
`.player-resumed` backdrop: 11 of 11 red. `.bottom-nav` backdrop: green (outside the player, as intended). Pristine: 3 pass.

Also in this commit (docs only, Dean mid-gate): a ROADMAP Planned > Features entry, swipe the video down into the mini player.

### qa r3 @417bd0bf (short delta, 1e2d6bee..417bd0bf; test + docs only)

Measured (Node 22.23.1): `npx eslint test/unit/player-overlay-no-filter.test.js` exit 0; `node --test` on the lock: 3 tests,
3 pass, 0 fail, 0 skipped. The net at HEAD (the test's own playerNames, comments stripped): 43 ids, 73 classes. `bottom-nav`,
`nav-theme-toggle` and `icon-share` are absent; the walk now asserts it reached the wrapper's own close. No em dashes added.

- W3 FIXED as prescribed: comments are stripped before the walk, `closed` is asserted, and `bottom-nav` / `bottom-nav-item` /
  `ui-selectable` / `#ft-lifecycle-overlay` are asserted absent. The converse risk (a `</div>` in a comment ending the walk early)
  is gone with the strip.
- The header, HOSTS, JS_BUILT_EXCLUDE and EXEMPT_CLASSES comments match the code. The `icon-share` exemption (the chapters menu's
  app-wide mask icon) is disclosed in the test and in the ROADMAP lock line, with a revisit trigger; I accept it as disclosed.
- ROADMAP lock line and LESSONS 7 coverage wording match the test. The new ROADMAP Features entry (swipe down to the mini player) is
  docs only, accurate to the tree, and marked "talk it through first".
- S (non-blocking): the runtime harvest reads only `.className = '...'` and `.id = '...'`. Classes player.js adds through
  `classList` (for example `audio-mode`, `ft-css-fullscreen`, `controls-autohidden`) are not in the net. Today these are state
  modifiers used compounded with netted names, so nothing escapes. A future rule on a modifier alone (for example
  `.ft-css-fullscreen { backdrop-filter }`) would pass.

Gate: APPROVED r3 @417bd0bf - qa

### adversary r3 @417bd0bf (short delta, 1e2d6bee..417bd0bf)

Measured (Node 22.23.1, a scratchpad clone of 417bd0bf, one mutant at a time, restored from HEAD). Baseline: the lock passes 3/3.
I did not re-run the full suite, and the CSS has not changed since 96474ced.

- W4 FIXED:
  - `.bottom-nav { backdrop-filter }` and `.ui-btn--md:hover { filter }` now pass, as they should: both are outside the player.
  - A `<!-- ... </div></div> -->` inside the wrapper, plus `.audio-vinyl { filter }`, is RED: the walk is no longer shortened.
  - An attribute containing `>` before `#audio-visualizer`, plus the same vinyl filter, is RED.
- W5 FIXED: `.cc-overlay` backdrop, `.cc-overlay-text` -webkit-backdrop, `.seek-preview` backdrop and `#player-slot` filter are
  each red. So is `.speed-sheet` backdrop. The sheet is appended to `document.body` (player.js:7211), a page-level sheet over the
  video, so including it is right.
- What the player.js harvest pulls in, beyond the excluded debug panel: 26 className literals, all player chrome (captions,
  seek preview and chapters, the chapter and speed sheets, the dock close), and the ids `bg-audio-sidecar` / `bg-keepalive`.
  Those two are undrawn `<audio>` elements with no CSS, so they are harmless. No false positive on the real CSS (green).
- S5 FIXED: documented as intended breadth.
- `icon-share` exemption: it is really only the chapters menu. player.js:7685 is the only builder in the player; the other user,
  skin-surface.js:191, is the music sheet, outside the player. The exemption is disclosed (test comment, ROADMAP lock line), so it
  is honest enough to ship. Two notes, both SUGGESTION:
  - (a) The comment says it is "not an effect painted over the playing picture". But `.chapters-menu` sits at
    `bottom: calc(100% + 6px)` of the control bar (style.css:4576), i.e. over the video while it plays. It is an on-request
    exception to the LESSONS 7 headline rule, not something outside it. Say that. The clean fix is the SVG sprite
    (`<svg class="ui-icon"><use href="#i-share">`), as the speed badge already does.
  - (b) It exempts the class from EVERY property: `.icon-share { filter: drop-shadow(...) }` alone passes 3/3. A selector naming
    the menu (`.chapters-menu .icon-share { filter }`) is still red. Narrow it to the mask properties only.
- S1 / S3 carried, not blocking (as ruled).
- Security: none.

Gate: APPROVED r3 @417bd0bf - adversary
