---
plan: notify-bell-art-subs-nav
harness: v2 · lean
branch: feat/v1.340-small-fixes
anchor: outcome
status: Shipped v1.340.0
next: shipped v1.340.0; Dean's device pass (tech-debt #288 lists the checks)
design: n/a (outcome anchor)
gate: APPROVED r2 @a4cb6e98 (adversary + qa + security-brief); r1 CHANGES (adversary W1-W4, qa Q1-Q5) fixed in a4cb6e98
---

# v1.340: a steady Notify button with the real bell, smaller Continue-listening art, and the Subscriptions page's full bottom bar

## The ask (Dean, 2026-09-27)

"Can we do notify button and use the same notification glyph versus emoji? Also go ahead
continue row track and the sub pages bottom bar missing things." Intake answers (AskUserQuestion,
same night): the OFF state is a slashed bell + text, the button always as wide as "Notifying";
also swap the Subscriptions page's emoji bells, and hold Subscribe / Pin widths steady too; take it
to a release while he sleeps.

## Acceptance (outcome anchor)

1. **Notify never moves its row.** On the watch page's channel row, Subscribe, Pin channel and
   Notify each keep ONE x and ONE width across every state (subscribed or not, pinned or not,
   notifying or not), in all four eras, at 390px; the buttons stay level (same y, same height).
   The Notify glyph is the header bell (`CHROME_ICON_SVG.bell`) when on and Material's slashed bell
   (`bellOff`) when off, never an emoji. The Subscriptions page's per-row bell draws the same two
   glyphs. Bound by watch-init-behavioral.test.js (labels + slot shape), sub-row-chip-btn-family
   AC3 (the drawn path, executed in JSDOM), chrome-icons.test.js (paths == the asset files), and
   the row probe (below).
2. **The Continue-listening tile asks for the 512px cover**, keyed on the album's `artId`, never the
   full-size file (tech-debt #287 e, the home row half). The tile is 92x138 (`.book-row-cover`'s
   height beats `.music-row-cover`'s aspect-ratio), so the square cover fits to 138x138 = 276px at
   2x -> 512 (r1 as drafted said 256 on a wrong "92px square" premise; gate r1 W4 / Q1).
   music-home-row.test.js.
3. **The Subscriptions page's bottom bar is the other shells' bar**: Liked, Podcasts, Music, Books,
   Downloads present; inline SVG glyphs, no `.icon-*` masks (tech-debt #114).
   subscriptions-shell-bottom-nav-parity.test.js (red on the old shell, measured).

4. **The Original skin's scroll wheel is a plain disc** (Dean, 2026-09-27: "the original iPod classic
   wheel has marks in our skin but it's a plain disc in the real one... cross reference the web and if
   there are no marks remove from our skin"). Cross-referenced: Wikimedia Commons "IPod 1Gen.jpg" (the
   photo v1.335 sampled its LCD from) shows smooth white plastic with no marks; the marks were v1.335's
   own disclosed addition (faint rim ticks, there to make the turn visible). The tick layer and its
   token are gone; the turn plumbing (--ip-turn) stays and now draws nothing. pocket-original-look.test.js
   (red on the old CSS, measured); render: pocket-render-probe `ipod-original` at 390x844, lights off.

## Approach notes

- `stableToggleLabelHtml(current, labels, glyphs)` (common.js): every label in one grid cell,
  the idle ones `visibility:hidden` (out of the accessible name too). The glyph sits INSIDE its
  label's slot: a leading svg flex item set the button's baseline to its bottom edge and dropped the
  neighbours 3-4px (measured). A hidden "Pinned ★" still grew the line box (the star is a taller
  fallback-font glyph) and dropped Pin 2px (measured); `.btn:has(> .btn-label-stack) {
  vertical-align: middle }` levels the row.
- The Subscriptions client keeps its standing rule (never innerHTML): the bell is built with
  `chromeIconEl(name, '', button.ownerDocument)` (the new optional `doc` argument).
- Not done, on purpose: the home TRACK CARDS (search results) keep the full cover. The card is
  ~full phone width (358px at 2x = 716px > the largest 512 rendition), so the sized file would be
  soft on the phone; the gain is desktop-only and small.

## Measurements

Row probe (`scripts/channel-row-probe.js`, static page on this tree's style.css, headless Chromium 1234,
390px, eras 2005/2009/2014/2021, five states each). BEFORE (old labels): distinct x/w per button
across the states = sub 2, pin 3, bell 5. AFTER: sub 1, pin 1, bell 1 in every era; all at y 73,
h 44.

## Deviations

- Scope grew on Dean's answers: Subscribe and Pin widths, and the Subscriptions page bells.

## Fix round r1 -> r2

- W1: tests/unit/stable-toggle-label.test.js locks the four CSS rules by value (each deletion measured red
  in a /tmp sandbox) and the helper's output; it also locks the header bell to CHROME_ICON_SVG.bell.d.
- W2: "Pinned ★" -> "Pinned" + a drawn filled star (`starFilled`, filled/star.svg) after the words; glyphs
  get negative block margins. Real watch page (the adversary's probe, pin labels updated), every era,
  light + dark: 390 all 44 tall at one y; 1280 all 28 tall at y 594.4 (was Pin 31 at 592.9; Notify 28.4).
  Accessible names: "Pinned" / "Pin channel" / "Notifying" / "Notify" / "Subscribed" / "Subscribe".
- W3: scripts/home-fouc-probe.js reads `.btn-label-stack[data-label]`.
- W4 / Q1: 512 (see AC2).
- Q3: the one-writer census also counts 'bell' and the data-glyph setter. Q4: the require() arm is gone;
  the tests install `global.chromeIconEl` like resolveAvatarSource. Q5: skin-surface.js comments say the
  plain disc draws the turn as nothing (the write is kept for a future look on the disc).
- Suggestions: podcasts.js "Pin to Playlists" / "Pinned" uses the same stable label + drawn star;
  tech-debt #283 (c) closed.

## Gate

Gate: APPROVED r1 - security-brief, reviewed at 7d8c1f0f (superseded: re-approved r2 @a4cb6e98)
- No CRITICAL/HIGH/MEDIUM/LOW. Could not run `git diff` (no Bash): reviewed the tree's files at the worktree HEAD, located by v1.340 markers.
- Verified: the 3 watch.js stableToggleLabelHtml innerHTML writers pass only fixed literals; esc covers & < > "; glyphs come from the fixed CHROME_ICON_SVG table.
- Verified: subscriptions.js has no live innerHTML; the bell is built with createElementNS. The require arm is dead in the browser (common.js loads first on every shell, which makes chromeIconEl a global) and in Node it resolves a fixed repo-relative path.
- Verified: the /albumart/<artId>?s=256 tile encodes artId (encodeURIComponent, in a double-quoted attr). artId comes from artRepresentatives over the VISIBLE list, and /albumart re-gates the requested id (trackVisibleTo / mediaVisibleTo, re-run after the rendition await). No cross-user art is reachable.
- The Subscriptions nav copy adds only static same-origin hrefs (/?liked=1, /podcasts, /music, /books, /), the same as index.html. Nothing is widened.
- INFO: channel-row-probe.js is dev-only (not served). It uses execFileSync with an argv array and no shell, and the page it builds holds only repo literals, so --no-sandbox and --allow-file-access-from-files are acceptable there.

Gate: CHANGES r1 @7d8c1f0f — adversary
- WARNING W1 (presence-not-binding): the CSS that makes the width stable is unbound. Three mutants each survive all 443 tests in the 8 touched files: drop `.btn-label-slot { grid-area: 1 / 1 }`, drop `[data-idle] { visibility: hidden }`, drop `.btn:has(> .btn-label-stack) { vertical-align: middle }`. The row probe is a manual script. A source lock on the three rules (the way pocket-original-look parses the CSS) would bind them.
- WARNING W2 (desktop, real app at 1280x900, every era, light and dark): the hidden "Pinned ★" slot makes Pin 31px tall in EVERY state (y 592.9) next to Subscribe 28 (y 594.4) and Notify 28.4. Before, only the pinned state was 31px; the default unpinned row was level. 390px is level (the 44px min-height absorbs it).
- WARNING W3 (instrument blinded): scripts/home-fouc-probe.js keys the Subscribe state on `subBtn.textContent`, which is now "SubscribedSubscribe" in both states. The probe can no longer see the Subscribe -> Subscribed flash it exists to catch (v1.339 L2). Read `.btn-label-stack[data-label]` instead.
- WARNING W4 (the plan's premise is wrong): the Continue-listening tile is 92x138, not a 92px square. `.book-row-cover` sets an explicit height, so `.music-row-cover`'s aspect-ratio is ignored. Measured in the real home page in 4 eras x modern on/off, at 390 and 1280. Square art cover-fits to 138x138 CSS px, which needs 276 at 2x, so 256 is about 7% short. Pick 512, fix the tile's aspect, or disclose.
- SUGGESTION: the header bell's `CHROME_ICON_SVG.bell.d` use is unbound (mutating it to 'M0 0' survives). podcasts.js's "Pin to Playlists" / "Pinned ★" is a sibling two-state button that still shifts width. Tracker #283 (c) (the rim ticks) is now stale. Notify is 28.4px tall vs 28 at desktop.
- Verified: the real app at 390 (4 eras, light and dark) keeps 1 x/w/y/h per button across 5 states. The old labels gave 2/3/5 distinct geometries. The accessible names are the visible label only. The Subscriptions bell is an SVG-namespace 16x16 glyph with `require` undefined in the page. The Subscriptions bar shows the customized Music/Books/Liked like /music. The Commons "IPod 1Gen.jpg" disc is plain. The parity, wheel, tile, watch-label and subs-bell tests all go red under their mutants. 87 related test files: 1794/1794 pass. eslint: 0 errors. css-token-lint: 0. overlay-containment: 0.

Gate: CHANGES r1 @7d8c1f0f — qa
- Ran: eslint 0 errors / 6 warnings (all older unused-var ones in common.js). Unit suite 7702/7702 pass on Node 22.23.1 and 7702/7702 on 24.20.0.
- WARNING Q1 (lying comment, the plan's premise wrong; confirms adversary W4): main.js:199 says the tile is "92px square". Measured in headless Chromium 1234 with this tree's style.css, `.book-row-card.music-row-card > .music-row-cover` is 92x138 in 2005/2009/2014/2021. The `.music-row-cover { aspect-ratio: 1/1 !important }` rule is ignored because `.book-row-cover` sets both width and height. Square art cover-fits to 138x138, which needs 276px at 2x, so ?s=256 comes out soft on a phone. music.js's own `musicArtSize(138, 2)` picks 512. Fix: use 512 (or `albumArtSrc(musicArtId(item), 138)`-equivalent sizing) and correct the comment and AC2, or square the tile on purpose and say so.
- WARNING Q2 (confirms adversary W3): scripts/home-fouc-probe.js:221 reads `subBtn.textContent`, which is now "SubscribedSubscribe" in both states, so the probe cannot see the Subscribe-to-Subscribed flash it exists to catch. Read `.btn-label-stack[data-label]` instead.
- SUGGESTION Q3: sub-row-chip-btn-family AC3's one-writer census now counts only `'bellOff'`. A second writer that picks `'bell'` (or writes a glyph by path) passes. Also count `data-glyph` writers (exactly one `setAttribute('data-glyph'`).
- SUGGESTION Q4: subscriptions.js:3146 adds a `require()` arm, but the file's own contract (its comment near line 1374) is "tests install the common.js global, the file never requires". It is dead in the browser and harmless, but it is a second pattern. Install `global.chromeIconEl` in the two test files instead, or note the exception at line 1374.
- SUGGESTION Q5: skin-surface.js:2531 ("the Original's wheel turns under the thumb") and :1402 describe a turn that now draws nothing, and every wheel move still writes a style. The plan keeps this on purpose. Update the comments to match, or retire the write.
- Security: no injection path. The three watch.js innerHTML writers pass only fixed literals through `esc` (& < > "). The glyph markup comes from the fixed CHROME_ICON_SVG table. subscriptions.js stays DOM-only (createElementNS). The art URL is encodeURIComponent'd inside a double-quoted attribute, and /albumart re-gates visibility. The probe script is dev-only and uses execFileSync with an argv array.

Gate: APPROVED r2 @a4cb6e98 — security-brief
- Could not run `git diff` or confirm HEAD (no Bash): reviewed the worktree files named in "Fix round r1 -> r2".
- Verified: podcasts.js writePinLabel passes only the literals 'Pinned' / 'Pin to Playlists' and { name: 'starFilled', after: true }. No show or server string reaches the innerHTML, and the fallback path uses textContent.
- Verified: stableToggleLabelHtml's { name, after } spec only picks a key and a class. The name is looked up in the fixed CHROME_ICON_SVG table (an unknown name gives ''), the class strings are literals, and esc is unchanged. starFilled is a static path literal.
- Verified: subscriptions.js has no require() arm left (bellGlyphEl calls only the chromeIconEl global) and still has no innerHTML assignment.
- Verified: s=512 is in ART_RENDITION_SIZES [128, 256, 512]. The artId encoding and the /albumart visibility re-gate are unchanged from r1.
- No new findings.

Gate: APPROVED r2 @a4cb6e98 — adversary
- W1 fixed as prescribed: all six CSS mutants now go red in stable-toggle-label.test.js: the idle slot visible, no shared grid cell, the stack not a grid, no vertical-align, positive glyph margins, no `.btn-glyph-after` rule.
- W2 fixed differently (the star is now a drawn glyph; the glyphs get negative block margins); the deviation holds. Measured on the real watch page, every era, light and dark: at 1280 Sub, Pin and Notify are all 28px tall at y 594.4 across 5 states; at 390 all are 44px tall at y 582.8, with one x and one width each. Pin's accessible name is "Pinned" (the star is aria-hidden; aria-pressed carries the state). Mutants on the text star or a dropped glyph go red.
- W3 fixed (home-fouc-probe reads data-label). W4 fixed (512; its mutant back to 256 goes red).
- Suggestions closed: the header-bell lock is red under a path swap; starFilled is bound to filled/star.svg byte for byte; tracker #283 (c) is closed. On the real /podcasts page, the Pin sibling keeps one width in both states: 114.6px, 44px tall at 390 and 28px tall at 1280.
- SUGGESTION (non-blocking): three things have no test. The podcasts.js stable label: forcing its textContent fallback passes. home-fouc-probe's data-label read: reverting it passes. stable-toggle-label's `decls()` says "top-level", but moving the vertical-align rule into `@media (min-width: 9999px)` stays green. The podcast Pin sits about 0.6px lower than a plain `.btn-sm` beside it (vertical-align middle).
- Suites and lint on a clean a4cb6e98 sandbox: 128 related test files, 2448/2448 pass. eslint: 0 errors (6 warnings in code this diff does not touch). css-token-lint: 0. overlay-containment: 0.

Gate: APPROVED r2 @a4cb6e98 — qa
- Ran: eslint 0 errors / 6 warnings (the same older unused-var ones). Unit suite 7710/7710 pass on Node 22.23.1 and 7710/7710 on 24.20.0.
- Q1 fixed as prescribed: the tile asks for ?s=512 (in ART_RENDITION_SIZES), and the main.js comment and AC2 now say 92x138 -> 138 cover-fit -> 276 at 2x -> 512. The test binds 512 for both the artId and the fallback path.
- Q2 fixed as prescribed: home-fouc-probe reads `.btn-label-stack[data-label]` on #subscribe-btn-mock, the button watch.js writes. It falls back to textContent for the static first-paint "Subscribe".
- Q3 fixed: the census now counts `'bell'` once, `'bellOff'` once and one `setAttribute('data-glyph'`.
- Q4 fixed differently, and better: the require arm is gone. chromeIconEl is a bare global like resolveAvatarSource, the comment says so, and all four test files that load subscriptions.js install the global.
- Q5 fixed: both skin-surface.js comments now say the plain disc shows no turn, and why the write stays.
- New code checked: the Pin label is "Pinned" plus a drawn starFilled, placed after the words. chrome-icons binds it to filled/star.svg with the Material box paths stripped. The glyph's negative block margins are locked in stable-toggle-label.test.js. Measured with scripts/channel-row-probe.js on this tree (headless Chromium 1234, static page): 1 x/w per button across 5 states in all 4 eras. At 390px every button is y 73 / h 44. A desktop-width copy of the probe (1280) gives y 73 / h 28 for all three, so the row is level.
- SUGGESTION: podcasts.js's new stable Pin label is unbound. No test renders `.podcast-pin-btn`, so reverting it to textContent passes the suite. It is low risk: the fallback branch is correct and the label uses the same helper.
- SUGGESTION: style.css's `.music-row-cover { aspect-ratio: 1/1 !important }` and its "the album-art cover is SQUARE" comment are still dead and untrue (older code). main.js now documents the real shape. Delete the rule or square the tile later.
- Security: unchanged from r1. The new glyph option only picks a name from the fixed CHROME_ICON_SVG table, and the labels are still escaped literals.
