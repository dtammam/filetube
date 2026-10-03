---
plan: mobile-player-edge-to-edge
harness: v2 · lean
branch: feat/v1.359-mobile-edge-to-edge
anchor: spec
status: Shipped v1.359.0
next: W0-W3 done; the gate (adversary + qa, same HEAD) next
design: Dean 2026-10-03 - "The video player on mobile when not full screen should expand to the size of the full iPhone viewport side to side (right now there is a gap). It should mirror YouTube in that sense." Read "iPhone" as the mobile layout (max-width 768px), every era. Dean 2026-10-03 (AskUserQuestion, F1): side to side only; the 16px gap above the player stays.
gate: APPROVED r1 @6dbfe406 (adversary + qa) (layout on the shared player host, the ambient stage geometry, every era; security-brief applied as a section by both)
---

# v1.359: the mobile player goes edge to edge, side to side

Planned 2026-10-03 by the Architect (Opus) at main 9e17aa87. ROADMAP.md ~line 449 ("Bug: the mobile video player, when not
fullscreen, should span the iPhone viewport side to side like YouTube") is the WHAT. This plan is the HOW: one CSS change in
`public/css/style.css` (three rules edited in place), one updated lock, one new real-browser geometry check, docs. No JS, no
server, no storage, no new dependency.

## 1. The outcome (what Dean sees on his phone)

1. On a phone in the watch page, the player (picture plus its control strip) touches both screen edges, with square corners and
   no outline, like YouTube's mobile watch page. The title, meta line, action row and everything below keep their 16px gutter.
   The 16px gap above the player stays (Dean, F1).
2. Same in every era (2005, 2009, 2014, 2021), light and dark, native or custom controls, video or audio, and on any viewport that
   gets the mobile layout (max-width 768px: phones in portrait, small phones in landscape, an iPad mini in portrait).
3. A notched phone in landscape (inside the mobile layout) keeps the picture out of the notch: the player spans from the left safe
   area to the right safe area.
4. Nothing else changes: the mini player (dock), full screen, faux full screen, the expanded audio view, the Music, Podcasts and
   Reader players, and every desktop or tablet layout above 768px.

### Architect challenge (intake, 2026-10-03)

- *Could this be not worth solving?* The gutter costs the picture 32px of width on a 390px phone (358 vs 390, 8%), which is 19px
  of height (200.3 vs 219.4). Dean named it twice in one sentence and YouTube's own watch page does it. Cost here is small (CSS
  only, no JS seam). Worth it.
- *Could it already be done somewhere?* The stage already reaches the viewport edge on mobile (v1.314: negative margin plus
  matching padding, so the ambient glow could light the gutter). The fix is to stop padding the stage back in. So the change is
  "remove the padding", not "add a bleed".
- *Prior art: ROADMAP ~1537 (v1.321) did NOT adopt YouTube's black full-width band.* That was the DESKTOP theatre (>= 1025px):
  the band would hide the ambient glow at the sides. It still holds there, and desktop is untouched. On a phone the same trade
  now goes the other way by Dean's explicit ask: with the player at the screen edge there is no gutter left to light, so the
  ambient glow keeps its above/below bloom and loses its side spread (the v1.314 "make it spread" side glow). That is a necessary
  consequence of the ask, not a choice, and it is disclosed (section 2, D4).

### Measured before (W0 pre-measurement by the Architect, real Chromium, main 9e17aa87, numbers copied from the probe output)

Probe: `/tmp/claude-1000/-home-coder-projects-filetube/e167a205-e3bd-453c-8a76-84ce622aa7be/scratchpad/e2e-probe.js` (real server
via `tools/hold-lock-proof/serve.js`, Playwright from `tools/capture`, iPhone 13 emulation with the viewport overridden, DPR 1).
Output: `w0-before.json` and `w0-cand.json` in the same folder. W0 copies the probe into the repo (section 5).

| Case | main padding | stage margin / padding | wrapper x, w, right gap | border, radius | picture x, w, h | title x |
|---|---|---|---|---|---|---|
| 320x568 phone, all 4 eras | 16 | -16 / 16 | 16, 288, 16 | 1px; 0 (2005), 2px (2009, 2014), 12px (2021) | 17, 286, 160.9 | 16 |
| 360x740 | 16 | -16 / 16 | 16, 328, 16 | same | 17, 326, 183.4 | 16 |
| 390x844 (native, custom, audio, dark) | 16 | -16 / 16 | 16, 358, 16 | same | 17, 356, 200.3 | 16 |
| 430x932 | 16 | -16 / 16 | 16, 398, 16 | same | 17, 396, 222.8 | 16 |
| 600x960 | 16 | -16 / 16 | 16, 568, 16 | same | 17, 566, 318.4 | 16 |
| 768x1024 (breakpoint edge) | 16 | -16 / 16 | 16, 736, 16 | same | 17, 734, 412.9 | 16 |
| 667x375 landscape | 16 | -16 / 16 | 16, 635, 16 | 1px, 12px | 17, 633, 223 | 16 |
| 667x375 landscape, safe area L/R 47 | 16 | -16 / 16 | 16, 635, 16 | 1px, 12px | 17, 633, 223 (UNDER the 47px notch) | 16 |
| 740x360 landscape (+ L/R 47) | 16 | -16 / 16 | 16, 708, 16 | 1px, 12px | 17, 706, 208 | 16 |
| 769x1024 desktop, all eras | 24 | 0 / 0 | 254, 491 | 1px, era radius | 255, 489, 275.1 | 254 |
| 1024x768 / 1280x720 / 1920x1080 | 24 | 0 / 0 | 254; 746 / 598 / 1238 | 1px, era radius | 255; 744 / 596 / 1236 | 254 |
| Dock after an SPA hop to Home, 390x844 | - | - | dock 222, 648, 160x116 | - | - | - |

`scrollWidth` equals the viewport width in every phone row. Safe-area insets read back through `env()` on a probe element
(`ins 47px` in the notch rows, `0px` elsewhere), so the override was live.

YouTube reference (m.youtube.com, same emulation, logged out, 2026-10-03): the player box is x 0, w 390 x h 219.4 at 390 and
x 0, w 360 x h 202.5 at 360, radius 0; the title is at x 16. Side-by-side screenshot sent to Dean (`side-by-side-390.png` in the
scratchpad folder above).

### Measured candidate (the rule in section 4 injected as a stylesheet, same probe, 2021 era unless noted)

| Case | stage padding | wrapper x, w, right gap | border, radius | picture x, w, h | glow x, w | title x |
|---|---|---|---|---|---|---|
| 320 / 360 / 390 / 430 / 600 / 768 | 0 | 0, vw, 0 | 0, 0 | 0, vw; h 180 / 202.5 / 219.4 / 241.9 / 337.5 / 432 | -0.12 x vw, 1.24 x vw (e.g. -46.8, 483.6 at 390) | 16 |
| 390 custom / audio, eras 2005, 2009, 2014, 2021 | 0 | 0, 390, 0 | 0, 0 | 0, 390, 219.4 | -46.8, 483.6 | 16 |
| 667x375 landscape | 0 | 0, 667, 0 | 0, 0 | 0, 667, 223 | -80, 827.1 | 16 |
| 667x375, safe area L/R 47 | 47 | 47, 573, 47 | 0, 0 | 47, 573, 223 | -21.8, 710.5 | 16 |
| 740x360, safe area L/R 47 | 47 | 47, 646, 47 | 0, 0 | 47, 646, 208 | -30.5, 801 | 16 |
| Dock after an SPA hop, 390x844 | - | dock 222, 648, 160x116 (identical) | - | - | - | - |
| 769 / 1024 / 1280 / 1920 desktop | 0 | identical to before | identical | identical | - | 254 |

The candidate matches YouTube to the tenth of a pixel at 390 and 360. The glow's inner rectangle still lands on the player:
glow x = player x - 0.12 x player w (47 - 0.12 x 573 = -21.76, measured -21.8). `ui-lint --enforce` passed with the candidate
appended (sandbox run: "ui-lint: OK - the live debt equals docs/ui-exceptions.json").

Probe note (for W0 and W2): the candidate run un-hides `#ambient-glow` to read its box; the before run in the table above did not,
so desktop `scrollWidth` differs between the two files (804 at 769, 1090 at 1024 with the glow box shown). The before and after
runs the builder compares MUST use the same glow state. Whether the desktop glow box widens `scrollWidth` in real use (ambient on,
769-1024px) is pre-existing, out of scope, and goes to ROADMAP Planned only if the builder confirms it scrolls.

## 0. Step 0 - read, set up, stop rules

0.1 Read `AGENTS.md`, then `docs/LESSONS.md` sections **0, 1, 2, 3, 6, 7, 8** and the matching sections of
`docs/LESSONS-rules.md` (6 especially: layout traps, specificity, "a zero-padding bleed makes every sibling re-pad"). Read the
comment blocks above `.watch-player-stage` (~6540-6600 in `public/css/style.css`), the v1.314 mobile glow rule (~6625), the
`#player-slot:empty` reserved frame (~11371-11405), and the `#player-wrapper` strip rules (~4270-4345). Read this plan fully.

0.2 Environment, every shell: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
Dual-Node final suite: 22.23.1 and 24.20.0 (Node 24 prints `ℹ`, not `#`; an empty grep is not green).

0.3 Worktree: `.claude/worktrees/v1359` on `feat/v1.359-mobile-edge-to-edge` (it exists and carries this plan, based on
9e17aa87). `git rebase main` first. `ln -s /home/coder/projects/filetube/node_modules node_modules`; never staged; `rm
node_modules` before removing the worktree.

0.4 Git: stage BY NAME; `git commit -F <file>` (quoted heredoc); never `--no-verify`, never force-push, never pipe a commit or
push; verify with `git log`. The pre-commit hook runs the unit suite: run commits in the background and wait. Push only at
release. Commit trailers: the ones your session's system reminder gives.

0.5 Tests while building: the targeted files each wave names. Full dual-Node `npm test` once after W2; again only if a gate
round changes code; never while a seat runs. `npm run test:geometry` (full, not only fast) once after W2.

0.6 Report every failure verbatim with counts. Mutants only on COMMITTED work, in a /tmp `git archive <sha>` sandbox, restored in
a `finally`, the sandbox diffed against a pristine copy after; kill what you start BY PID. Record each mutant in section 6.

0.7 No em dashes. `npm run lint:ui` must not grow; `node scripts/overlay-containment-lint.js --enforce` stays 0. A comment, test
title or doc your change inverts is a finding: the v1.314 block above `.watch-player-stage` ("the stage grows by the page
gutter... padding keeps the player where it was", "The glow's containing block is now that padding box, one gutter wider than the
player"), the mobile `.ambient-glow` comment, the `#player-slot:empty` comment ("the same outer geometry as .player-container"),
the v1.314 test title in `test/unit/ambient-glow-engine.test.js` ("geometry identical to desktop", "padding keeps the player
where it was"), and the `--ambient-gutter` comment in `public/js/ambient.js` if any.

0.8 **Stop rules.** Stop and report to Dean (never guess) if:
(a) W0's before numbers differ from section 1's table by more than 0.5px in any row (the base moved; re-plan);
(b) any desktop row (>= 769px) changes by any amount, in any era, after W1;
(c) the change needs JavaScript (a player.js or watch.js edit) to work;
(d) the hold-to-2x, its lock (v1.358), the double-tap skip, or the tap-to-show-bar change in any measured way (tools/hold-lock-proof
results diverge from their committed JSON in a field the width does not explain: rect x/w are expected to change, rate, lock,
scroll and touchmove counts are not);
(e) a fixed overlay (faux full screen, expanded audio, a sheet or menu opened from the player) is clipped, trapped or offset;
(f) a look decision appears that this plan did not settle (for example: the control strip should NOT span, or an era should keep
its frame): that is a product fork for Dean (AskUserQuestion with a side-by-side), never decided silently;
(g) scope grows: log extras in ROADMAP.md Planned. A stop rule is never satisfied by narrowing a test.

## 2. Rulings and decisions

| # | Question | Ruling |
|---|---|---|
| F1 | Close the 16px gap ABOVE the player too (YouTube sits flush under its header)? | **No.** Dean 2026-10-03 (AskUserQuestion, recommended option): side to side only. `padding-top` of `.main-content` is untouched. |
| D1 | What is "mobile"? | The app's mobile layout breakpoint, `@media (max-width: 768px)`, the same query `.main-content`'s 16px padding and player.js `narrowViewport` use. No orientation clause: a <= 768px landscape phone gets it too. Not keyed to the device (an iPad mini in portrait at 744/768 gets it; that is "wherever the mobile layout applies"). Architect. |
| D2 | What spans? | The whole player box: picture AND its control strip (the strip is part of the player; an inset strip under a full-width picture would read as a defect). The title and below keep the gutter. Architect, matches YouTube (its controls overlay the picture, so its player box is the picture). |
| D3 | Eras | All four. Measured: no era overrides the player's border, radius or the stage; each era's frame is the shared `.player-container` 1px `--separator` border plus `--r-md` (0 / 2 / 2 / 12px). At the screen edge a frame or a rounded corner reads as the very gap Dean reported, so all eras drop them on mobile inline. Desktop keeps every era's frame. Architect. |
| D4 | Ambient on mobile | The glow keeps its YouTube-matched geometry around the player (12% / 22% reach, measured exact). With the player at the screen edge the side reach falls outside the viewport and the stage's `overflow-x: clip` (kept) cuts it, so on a phone only the above/below bloom shows. Disclosed in ROADMAP and the ledger note; not a fork (it is the ask's own geometry). Architect. |
| D5 | Safe area | The stage pads by `env(safe-area-inset-left/right, 0px)` instead of 16px: 0 in portrait (measured 0px with a 47px top inset), the notch width in a notched landscape (measured 47). The title's pre-existing x 16 under a 47px landscape notch is NOT changed (pre-existing, every page has it; ROADMAP Planned line). |
| D6 | Where the change lives | On the STAGE (`.watch-player-stage`), not on `#player-wrapper`'s width or margins: the wrapper's role, events, reparenting and the v1.358 touchmove claim on the host stay byte-identical; the reserved frame (`#player-slot:empty`) and the mounted player both inherit the width; the dock, faux full screen and expanded audio leave the stage (reparented or `position:fixed`) and are unaffected by construction. |
| D7 | Native-controls, portrait-media, audio | Native controls: inherits (measured 0 / 390 at 390). Audio: inherits (measured). Portrait media (`.portrait-media`, Shorts): the box stays 16:9 (v1.34 T1) and is now full width with wider pillarbox bars; W2 measures it with a seeded portrait item. |

## 3. Surfaces (in or out)

| Surface | In / out | Why / proof |
|---|---|---|
| Watch page inline player, `public/watch.html` `.watch-player-stage > #player-slot` | IN | the target |
| Reserved player frame `.watch-container #player-slot:empty` (cold load) | IN | must match the mounted frame (v1.52 T2 contract), else the frame jumps on mount; W2 measures it |
| Dock `#player-dock` | OUT, must not regress | the host reparents out of the stage; measured identical (222, 648, 160x116) |
| Faux full screen `.css-fullscreen`, native `:fullscreen` / `#fs-stage` | OUT | already full bleed; `position:fixed` or reparented; the new wrapper rule excludes `.css-fullscreen` and `.audio-expanded` explicitly |
| Expanded audio `.audio-expanded` | OUT | fixed overlay; excluded |
| Audio mode inline `.audio-mode` + `#audio-bg-art` | IN (inherits) | measured |
| Native-controls video | IN (inherits) | measured |
| Portrait media | IN (inherits) | W2 measures |
| Landscape <= 768 + notch | IN | D5, measured |
| Host shells | Only `watch.html` renders `.watch-player-stage` / `.watch-container` (grep of `public/*.html`, `lib/ytdlp/views/*.html`, `public/js`). `music.html`, `podcasts.html`, `read.html` (and `index`, `tv`, `history` as SPA shells) carry a `#player-slot` but never these classes; every selector in section 4 names `.watch-player-stage` or `.watch-container`, so they are untouched. The watch VIEW reached by SPA nav from any of the ten shells uses the same global `style.css`, so it gets the change everywhere. W2 measures the Music and Podcasts phone player before/after (identical). |
| Pocket / iPod (`.mms-*`, Music) and the mobile custom player bar (`.ff-mobile` controls) | Pocket OUT (separate surface, no shared selector). The custom bar is inside the wrapper and simply gets wider (its rows wrap; buttons never shrink); W2 checks it. |
| Desktop / tablet > 768px | OUT, byte-identical in behaviour | every rule is inside `@media (max-width: 768px)`; W2 diffs the desktop rows of the probe JSON to zero |
| Critter mode | OUT | `#player-wrapper`, `.player-container`, `#player-dock`, `#fs-stage` are excluded anchors (critter-mode.test.js ~1145) |

## 4. The seams and the change (read at 9e17aa87; line numbers drift, selectors do not)

All three edits are IN PLACE (no new appended rule: an appended twin would leave the old rule and its v1.314 lock green while no
longer describing what wins - the comment-porous / outer-twin class, LESSONS 3).

4.1 `public/css/style.css` ~6591, the mobile `.watch-player-stage` rule. Today:
`--ambient-gutter: var(--space-8); overflow-x: clip; margin-left/right: calc(-1 * var(--ambient-gutter)); padding-left/right:
var(--ambient-gutter);`. Becomes: keep `--ambient-gutter: var(--space-8)`, `overflow-x: clip` and both margins (the stage still
reaches the viewport edge); replace the two paddings with `padding-left: var(--stage-inset-l); padding-right:
var(--stage-inset-r);` and declare `--stage-inset-l: env(safe-area-inset-left, 0px); --stage-inset-r:
env(safe-area-inset-right, 0px);` on the same rule. Rewrite the v1.314 comment above it so it states the new truth (the stage
still grows to the viewport edge; the player now fills it, minus the safe area; the glow's side reach is clipped at the screen
edge, by design since v1.359).

4.2 `public/css/style.css` ~6630, the mobile `.ambient-glow` rule. `left`/`right` become
`calc(var(--stage-inset-l) - (100% - var(--stage-inset-l) - var(--stage-inset-r)) * 0.12)` and the mirror for `right` (keep the
`token-exempt` annotations and the "0.12 = AMBIENT_REACH_X (test-bound)" note). It must stay AFTER the base `.ambient-glow` rule.

4.3 The frame, mobile only. In the existing `@media (max-width: 768px)` block that holds the `#player-slot #player-wrapper`
strip reserves (~4313), add ONE rule:
`.watch-player-stage #player-wrapper:not(.css-fullscreen):not(.audio-expanded) { border: none; border-radius: 0; }`
(specificity 1,3,0 beats `.player-container`'s 0,1,0 regardless of order; no rule on the wrapper's border is more specific
today: the builder re-greps `border` and `radius` on `#player-wrapper`, `.player-container`, every `[data-theme]` scope, to
confirm). And in the existing mobile block right after `.watch-container #player-slot:empty` (~11392), add `border: none;
border-radius: 0;` to that mobile rule (same selector, later in the file, so it wins).

Candidate used for the measurement (the builder's edit must produce the same computed values; the custom-property names are a
suggestion, keep them local to the stage rule, never on `:root`):
```css
@media (max-width: 768px) {
  .watch-player-stage { --stage-inset-l: env(safe-area-inset-left, 0px); --stage-inset-r: env(safe-area-inset-right, 0px);
    padding-left: var(--stage-inset-l); padding-right: var(--stage-inset-r); }
  .watch-player-stage #player-wrapper:not(.css-fullscreen):not(.audio-expanded),
  .watch-container #player-slot:empty { border: none; border-radius: 0; }
  .ambient-glow { left: calc(var(--stage-inset-l) - (100% - var(--stage-inset-l) - var(--stage-inset-r)) * 0.12);
    right: calc(var(--stage-inset-r) - (100% - var(--stage-inset-l) - var(--stage-inset-r)) * 0.12); }
}
```

4.4 JS: none. Read-only confirmations (no edit): `public/js/player.js` sizes nothing on the wrapper's width (the double-tap zones
and seek bars read live rects; `seekChaptersEl.style.width = seekBar.offsetWidth` re-reads); `watch.js` ~2350 measures the stage
only for the desktop theatre reserve (>= 1025px).

## 5. Waves (one branch, one gate, one release: v1.359.0)

### W0 - Measure (before any product code; its own commit)

1. Copy the Architect's probe into the repo as `tools/edge-to-edge-proof/probe.js` (from the scratchpad path in section 1; if it
   is gone, rebuild it from section 1's description: same cases, same fields). Make it require `../hold-lock-proof/serve` by
   relative path. Add cases: a seeded portrait item (a second metadata row on the same webm with `width: 1080, height: 1920`;
   assert the wrapper wears `.portrait-media`, else the case is vacuous), the cold reserved frame (`#player-slot:empty`: block the
   item's API response or measure before mount; assert `:empty` matched), the Music and Podcasts phone players (their
   `#player-slot` / wrapper rects), and the custom bar's buttons (each button's box, no button narrower than before). Keep the
   glow-state the same in every run.
2. Run it on the worktree tree. Copy the before table into section 6 verbatim (command + output). Stop rule 0.8 (a) applies.
3. Commit `tools/edge-to-edge-proof/probe.js` and `tools/edge-to-edge-proof/before.json` (not a CI gate; a proof tool, like
   tools/hold-lock-proof).

### W1 - The change (section 4) and its locks

1. Edits 4.1, 4.2, 4.3, with the comments corrected (0.7).
2. `test/unit/ambient-glow-engine.test.js`, the v1.314 MOBILE SPREAD test: its padding and formula assertions WILL go red on the
   in-place edit. That is the intended change; update the lock with its intent preserved, never widened: the stage still has
   `overflow-x: clip` and the two negative margins of `--ambient-gutter` (= `--space-8`, = `.main-content`'s mobile padding);
   the padding is now exactly `var(--stage-inset-l|r)` and those are exactly `env(safe-area-inset-left|right, 0px)`; the glow's
   x insets are the new formula with fraction === `AMBIENT_REACH_X`; the mobile glow rule is still AFTER the base; ADD: exactly ONE
   mobile `.watch-player-stage` rule and exactly ONE mobile `.ambient-glow` rule in the sheet (an appended twin goes red); redo
   the arithmetic block for a 390 viewport with inset 0 and with inset 47 (glow edge = player edge - 0.12 x player width in
   both). Rename the title (no "identical to desktop", no "keeps the player where it was").
3. A small source lock (same test file or `test/unit/mobile-player-height.test.js`, whichever already parses the mobile block):
   the wrapper frame rule exists inside `@media (max-width: 768px)`, its selector excludes `.css-fullscreen` and `.audio-expanded`,
   and it sets `border: none` and `border-radius: 0`; the `#player-slot:empty` mobile rule sets the same and sits after the base
   rule. This is a backstop; the geometry check in W2 is the binding.
4. Targeted runs: `node --test test/unit/ambient-glow-engine.test.js test/unit/mobile-player-height.test.js
   test/unit/watch-chrome-ambient.test.js test/unit/player-media-aspect-css.test.js test/unit/watch-instant-paint.test.js
   test/unit/player-fullscreen-stage.test.js test/unit/player-audio-expand.test.js test/unit/theatre-mode.test.js`, plus
   `npm run lint:ui` and the overlay containment lint. Commit.

### W2 - The real-browser binding and the after measurement

1. **Geometry check BLD** (the binding, in the suite CI runs: `npm run test:geometry`, `.github/workflows/visual.yml`):
   - `test/geometry/checks.js`: `collectPlayerBleed()` (in-page: viewport width, `#player-wrapper` box and computed
     `border-left-width` / `border-top-left-radius`, the picture box (`#media-player`, or `#audio-bg-art` in audio mode),
     `#media-title` box, `.main-content` computed `padding-left`, `scrollWidth`) and pure `evalPlayerBleed(data, vp)`:
     phone: wrapper left === 0 and right === viewport width (0.5px), picture spans the same x, border 0, radius 0, title left ===
     main padding-left (16), scrollWidth === viewport; desktop: wrapper left === title left (the player stays in the text column)
     and the wrapper's right edge is inside `.watch-main`. Register `BLD` in `run.js` COLLECT / EVALUATE and its summary line.
   - `test/geometry/scenes.js`: surface `watch-player` (owner v1.359, path `/watch.html?v=${FX.video}`, ready `#player-wrapper
     #media-player`, scope `.watch-container`, checks `['BLD']`, phone + desktop, every era x mode, `min: { BLD: { player: 1 } }`;
     put it in the fast set only if the fast run stays under its budget).
   - `test/geometry/mutations.js`: `bld-gutter-back` (phone: `.watch-player-stage{padding-left:16px!important;padding-right:16px!important}`),
     `bld-rounded` (phone, 2021: `#player-wrapper{border-radius:12px!important}`), `bld-title-bleeds` (phone:
     `#media-title{margin-left:-16px!important}`), `bld-desktop-bleeds` (desktop: `.watch-player-stage{margin-left:-24px!important}`).
     `node test/geometry/run.js --mutants` must show each one red by name.
   - `test/unit/geometry-checks.test.js`: `evalPlayerBleed` on synthetic boxes, one fixture per failure arm (left off by 1, right
     off by 1, radius 12, border 1, title at 0, desktop bled, scrollWidth + 1) and a passing fixture per viewport.
2. Run the W0 probe on the branch; write `tools/edge-to-edge-proof/after.json`; a short script or `node -e` diff: desktop rows
   (>= 769) identical in EVERY field; dock identical; Music and Podcasts identical; phone rows match section 1's candidate table;
   notch rows x = 47; portrait-media full width with the 16:9 box; reserved frame x 0 / w vw / radius 0 and the mounted frame the
   same height (no jump); custom bar: no button narrower than before, rows wrap. Copy the numbers into section 6.
3. Re-run `node tools/hold-lock-proof/probe.js` and `probe-lock.js` on the branch; compare with the committed
   `probe-result.json` / `probe-lock-result.json`: only rect x/w may differ (stop rule 0.8 d).
4. A side-by-side image (before, after, YouTube at 390) for the PR description; regenerate with the probe, never hand-edit.
5. Full dual-Node `npm test` (22.23.1 then 24.20.0), `npm run test:geometry`, `npm run lint:ui`, overlay lint. Quote each
   runner's final summary line in section 6. Commit.

### W3 - Docs

- `docs/DEVICE-CHECKS.md`: a group "Mobile player edge to edge (v1.359.0)" with section 7's checks.
- ROADMAP.md: mark the ~449 entry `[x]` with "SHIPPED v1.359.0" (it sits under Resolved > Bugs already); the Shipped entry with
  numbers COPIED from `after.json`; disclosures: D4 (the side glow on phones), D5's pre-existing title-under-notch, anything W2
  found. Planned: the pre-existing title-under-landscape-notch line; the desktop glow `scrollWidth` question if confirmed.
- `docs/LESSONS.md` (release commit): section 6, bump the blast-radius / "a zero-padding bleed makes every sibling re-pad" class
  with the v1.359 form if W1/W2 taught something (for example "an in-place edit, not an appended twin, or the old lock stays green
  on a rule that no longer wins"); deduplicate first.

### Gate and release

- **Gate.** `.harness/scrutiny.toml` against the feature diff (`public/css/style.css`, `test/**`, `tools/edge-to-edge-proof/**`,
  `docs/**`): no force row matches (no migration/schema, no auth/secret/token path, no `package*.json`, no fetch/client file), no
  baseline row matches `public/**`, so the table's floor is adversary only. ESCALATE to adversary + qa (allowed; LESSONS 1: "never
  collapse to one seat for UI/layout"; seats split on layout). Not destructive: no data path, so the full data-loss gate is not
  forced. Note: the release commit's version bump touches `package.json` / `package-lock.json`, which the network-boundary row
  matches; it is version-only ceremony after the gate, as in every release (say so in the PR). Commit first, spawn `adversary` and
  `qa` (`.claude/agents/`) in parallel on HEAD, each in its own /tmp `git archive` sandbox, brief: branch, base sha, this plan,
  LESSONS sections 1, 2, 3, 6, 7, 8, and the attack surfaces:
  - **Blast radius:** every element the three selectors match, across media queries and reparent targets: the wrapper in the dock
    (must keep 26px strip, dock rect), in `.css-fullscreen`, in `:fullscreen` / `#fs-stage`, in `.audio-expanded`; Music, Podcasts,
    Reader `#player-slot`; the reserved frame vs the mounted frame (a height jump on mount).
  - **Desktop byte-identical:** every era x mode at 769, 1024, 1025, 1280, 1920; theatre on and off (the theatre reserve measures
    the stage).
  - **Cascade:** an equal-or-higher specificity rule that defeats the frame drop in some era, mode or state (`:hover`, focus,
    `.controls-autohidden`, `.native-controls`, `.ff-mobile`); the glow override still after its base; no appended twin.
  - **Ambient:** glow inner rectangle on the player at inset 0 and 47 (measure, do not read); no sideways scroll with ambient ON
    in dark mode at every phone width; the iOS video-layer constraint (no filter / transform / mask / will-change / contain /
    isolation added to the stage; ambient-glow-engine's lock).
  - **Stacking:** no new stacking context on the stage or any ancestor of the fixed overlays (z ladder); faux full screen still
    escapes and covers the header and bottom nav at 390 and 667x375.
  - **Gestures (v1.358 and before):** hold-to-2x, drag-to-lock, double-tap skip zones (left/right half of the wider box), tap to
    show the bar, swipe-back from the screen edge now that the picture starts at x 0 (Chromium cannot show the OS gesture: say
    what is unmeasured).
  - **Safe area:** portrait with top/bottom insets, landscape with L/R insets, asymmetric L-only (Android cutout); rotation
    re-resolving `env()` (the v1.68.1 stale-vh class: does anything here use vh/vw? it must not).
  - **The geometry check binds:** each `bld-*` mutant red by name; the check is not vacuous (`min`), and it runs in CI.
  Each seat writes `Gate: <verdict> r<n> @<sha> - <seat>` into section 8. Fix CRITICAL/WARNING in a new commit; re-engage the SAME
  seats for a delta round. After 2 rounds, ask Dean before a 3rd (AskUserQuestion).
- **Release** (`docs/RELEASING.md` + AGENTS.md "Release ceremony"): `npm version 1.359.0 --no-git-tag-version`; ROADMAP Shipped;
  `docs/releases.json` entry in plain user language (for example "On a phone the video now runs edge to edge across the screen,
  like YouTube; the title and buttons below keep their margin."); the LESSONS update; `node scripts/plan-complete.js <this plan>
  "Shipped v1.359.0" --apply`; one release commit. main is PROTECTED: from the primary checkout on an up-to-date main, `git merge
  --no-ff -F <file>`, tag `v1.359.0` on that local merge, push the release branch AND the tag in ONE push (with
  `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`, never piped), `~/.local/bin/gh pr create`, wait for
  `ci (22)`, `ci (24)`, `audit`, `secret-scan` green (the visual job reports the phone watch scenes as changed: expected, it never
  gates, baselines refresh after merge by bot; never hand-edit baselines), then **ASK DEAN before `gh pr merge --merge`** (never
  self-merge). After: `git pull --ff-only`, delete the branch locally with `-d` (verify remote with `git ls-remote --heads
  origin`; if it lingers, `gh api -X DELETE repos/dtammam/filetube/git/refs/heads/<b>`), `rm node_modules`, remove the worktree.

### Out of scope
Closing the gap above the player (F1: Dean said no); the title under a landscape notch (pre-existing); YouTube-style overlaid
controls instead of the strip; the desktop theatre band; the music-page pop-out bug (next ROADMAP item); anything else: ROADMAP
Planned only.

## 6. Build log (the builder fills this in: W0/W2 measurements with commands, deviations, mutants per wave, suite lines verbatim)

**A1 - Architect pre-measurement (2026-10-03, Opus, main 9e17aa87, Node 22.23.1).** Section 1's two tables. Commands:
`node <scratchpad>/e2e-probe.js /home/coder/projects/filetube <scratchpad>/w0-before.json` (full: 4 eras at every phone and desktop
width) and `CANDIDATE_CSS=<scratchpad>/cand.css node <scratchpad>/e2e-probe.js ... w0-cand.json quick` (2021 at every width, all
eras at 390). The first dock run failed (`page.click` intercepted by the bottom nav; fixed by a scripted click, re-run, rect
recorded). ui-lint on the candidate: sandbox `git archive HEAD` + candidate appended, `node scripts/ui-lint.js --enforce` -> "OK".
Note: with the candidate APPENDED (a twin), `test/unit/ambient-glow-engine.test.js` stayed green (28 pass, 0 fail) because the lock
reads the FIRST mobile stage rule: proof that W1 must edit in place and add the uniqueness assertion.

**W0 (builder, Sonnet, 2026-10-03, Node 22.23.1, main 9e17aa87 tree).** Probe copied to `tools/edge-to-edge-proof/probe.js`
(requires `../hold-lock-proof/serve`; Playwright resolved from the worktree's or the primary checkout's `tools/capture`). Added cases:
a REAL portrait WebM (a landscape file under a portrait row does not stay portrait: player.js re-applies the browser's own
orientation on `loadedmetadata`, so the probe renders a 180x320 clip; the case records a VACUOUS error if the wrapper lacks
`.portrait-media`), the cold reserved frame (the item's API never answers; VACUOUS error unless `#player-slot` matches `:empty`),
Music (`/music?play=song1`) and Podcasts (`/podcasts`) phone slots, and every visible wrapper button's box. Glow box un-hidden in
every run. Command: `node tools/edge-to-edge-proof/probe.js "$PWD" tools/edge-to-edge-proof/before.json` -> exit 0, 76 rows, 0
ERR/VACUOUS. Section 1's table reproduced exactly (phone rows: wrapper x 16, right gap 16, w = vw - 32, picture x 17, w = vw - 34;
390 h 200.3; landscape 635 / 633 / 223; desktop 769 w 491 x 254 h 275.1, 1024 w 746, 1280 w 598, 1920 w 1238; dock 222, 648,
160x116), so stop rule 0.8 (a) does not fire. New rows: portrait 390 (all eras): `.portrait-media` present, box still 16:9 (pic
h 200.3, x 17, w 356); cold frame 390: slot x 16, w 358, h 201.4 (mounted wrapper 358 x ~200.3 + strip), radius 0 / 2 / 2 / 12, border
1px; cold frame 768: slot 16 / 736 / h 414; Music 390: wrapper x 16 w 358 (radius per era); Podcasts: the fixture has no episodes,
so no player mounts and its row has no wrapper (disclosed: Podcasts is measured only as "no change in the page", not as a mounted
player; its slot has no `.watch-*` ancestor by construction, section 3).

**W1 (builder, 2026-10-03, Node 22.23.1; commit 111b6bb9).** Three in-place CSS edits plus the mobile glow override placed AFTER the base
`.ambient-glow` rule. Locks: the v1.314 MOBILE SPREAD test in `ambient-glow-engine.test.js` rewritten with intent kept (exactly ONE mobile
`.watch-player-stage` rule and ONE mobile `.ambient-glow` rule, padding is exactly the `--stage-inset-*` vars, those are exactly
`env(safe-area-inset-*, 0px)`, glow fraction == `AMBIENT_REACH_X`, glow after base, arithmetic at 390 with insets 0 and 47); two parsed
source locks in `mobile-player-height.test.js` (one frame-drop rule inside the 768px query excluding `.css-fullscreen` and `.audio-expanded`;
a fail-by-default set of every rule that paints a border or radius on the player frame; the reserved-frame rule after its base).
Targeted run: 135 pass, 0 fail; `lint:ui` OK; overlay-containment 0 violations.

**W2 (builder, 2026-10-03, Node 22.23.1; commits b7445508 + this one).**
- BLD (`collectPlayerBleed`/`evalPlayerBleed`, scene `watch-player`, floor `player: 1`): 16 scenes, 16 ok. Mutants (`node test/geometry/run.js
  --mutants`): bld-rounded, bld-outlined, bld-title-bleeds, bld-desktop-bleeds KILLED on first run. `bld-gutter-back` SURVIVED the first
  draft (the check took its expected inset from the stage's own padding, so a gutter padding justified itself: presence-not-binding);
  fixed by measuring the inset on a throwaway `env()` element; re-run: red on phone, clean control green. The gutter-back and
  desktop-bleeds mutants are media-scoped so each is red only on its own viewport class.
- after.json: `node tools/edge-to-edge-proof/probe.js "$PWD" tools/edge-to-edge-proof/after.json` -> exit 0, 77 runs (before.json also holds 77 runs), 0 ERR/VACUOUS. Diff vs before.json by field: the 18 rows at vw > 768 (desktop widths, dock included) identical in
  EVERY field; Music rows identical; Podcasts rows identical (no mounted player in the fixture, disclosed). Every phone row: wrapper x 0, w = vw,
  border 0, radius 0, stage padding 0, title x 16, scrollWidth == vw. 390: pic h 219.4 (was 200.3). Notch rows: stage p 47, wrapper x 47,
  glow x -21.8 at 667. portrait-notch (top inset) wrapper x 0. Portrait file rows: full width, `.portrait-media` present. Cold frame:
  slot x 0 w 390 h 219.4 = the mounted picture, radius 0, border 0 (no jump). Desktop `scrollWidth` 804 at 769 is unchanged from before.
- Hold-lock probes re-run: `probe-lock` differs from the committed result only in the locked pill's rect y (85 -> 84, 45 -> 44; the
  wrapper lost its 1px border; not confirmed separately). `probe.js` (the W0 candidate experiment) has run-to-run differences that are about
  the candidates, not the layout (unchanged files, not re-committed).
- Not produced: the side-by-side image (the probe numbers are the evidence).
- Suites: Node 22.23.1 `npm test` pass 10823, fail 0, exit 0; Node 24.20.0 `npm test` tests 10835, pass 10823, fail 0,
  exit 0; `npm run test:geometry` "geometry: 405 checks - 405 ok, 0 FAIL, 0 XFAIL (expected), 0 XPASS; 192 scenes in 280s"; `lint:ui`
  OK; overlay-containment clean (0 violations).

## 7. Device checks owed (to DEVICE-CHECKS.md at release, tagged v1.359.0)

WebKit / iOS is NOT measurable on this box: every number in this plan is headless Chromium with iPhone emulation. Unmeasured:
iOS Safari and the home-screen app's real `env(safe-area-inset-*)` values and their re-resolution on rotation, the iOS inline
video layer at x 0, the iOS edge swipe-back over a picture that now starts at the screen edge, and Android gesture-nav back.

- v1.359.0 - iPhone, portrait, a video in the watch page (not full screen): the picture touches both screen edges, square corners,
  no outline; the title and the buttons below keep their margin; the gap above the player is unchanged. Try a few eras (Settings >
  Appearance) and dark mode.
- v1.359.0 - Same with a song (cover art) and a tall Shorts-style video; then with Settings > Mobile player custom controls ON:
  every control-bar button is there and full size.
- v1.359.0 - Press and hold the picture for 2x, drag down to lock, tap the pill; double-tap left and right to skip; a swipe from
  the left screen edge still goes back (Safari tab) and does not seek or pause.
- v1.359.0 - Scroll down so the player docks, then back to the video: the mini player looks as before and the full player returns
  edge to edge with no jump. Rotate to landscape and back while playing: full screen as before, then edge to edge again.
- v1.359.0 - Ambient on (dark mode): the glow still shows above and below the player; nothing scrolls sideways.

## 8. Gate record

(seats write their verdict lines here, bound to the sha they reviewed)

### qa r1

Gate: APPROVED r1 @6dbfe406 - qa

Verified in a /tmp `git archive HEAD` sandbox (Node 22.23.1): ambient-glow-engine + mobile-player-height + geometry-checks tests 61 pass, 0 fail; `lint:ui` OK; `--mutate bld-gutter-back` -> "405 checks - 397 ok, 8 FAIL" (red on the 8 phone scenes; other 4 mutants and the clean 405/405 run taken from section 6, not re-run). Source reading: no stale comment or title left (grep gutter / keeps the player / 16px clean; the v1.314 lock and style comments were rewritten with intent kept). Security surface: none (CSS + test + proof tool only).

No CRITICAL, no WARNING. SUGGESTIONS:
1. checks.js `evalPlayerBleed`: weaker than plan W2 (no scrollWidth, no picture-span, title test is `x < 8`, not `== main padding-left`); a title shifted to x 10 would pass.
2. Notch insets (47px) are locked only by the unit arithmetic and the probe; Chromium geometry runs see env() = 0, so BLD never exercises a non-zero inset in a real browser.
3. `bld-desktop-bleeds` and `bld-gutter-back` are media-scoped; fine, but the unit `/starts at x 16.*|358px wide/` regex is alternation-loose.

### adversary r1

Gate: APPROVED r1 @6dbfe406 - adversary

Measured in /tmp `git archive HEAD` sandboxes (Node 22.23.1). No CRITICAL, no WARNING.
- All 5 bld-* mutants red by name via `node test/geometry/run.js --mutate <m>`: gutter-back 8 FAIL, rounded 8, outlined 8, title-bleeds 16, desktop-bleeds 8 (each "405 checks - N ok"). Unit mutants (drop the radius from the frame rule, glow right uses the left inset, drop the radius from the reserved frame) each 1 red; unit suites 61 pass 0 fail clean; lint:ui OK; critter-mode 107 pass.
- Cascade: grep of every rule naming `#player-wrapper` / `.player-container` with border or radius matches the unit test's painter set; no JS writes the wrapper border.
SUGGESTIONS (measured, none blocking):
1. A persisted `ft-theater=1` (watch.js init applies it at any width) on a landscape phone defeats the bleed: probe with localStorage ft-theater=1 gives 667x375 wrapper x 129.9 w 407.1, 740x360 x 179.8 w 380.4 (390 and 768 portrait stay x 0 full width). The old theatre width rule (`min(100%, ... * 16/9)`, margin-inline:auto, ~line 6441) still applies below 1025px. Pre-existing; the button is hidden on phones, so only a resized desktop browser reaches it. Disclose or add the mobile override later.
2. BLD's desktop leg checks only x offsets, though its comment says "keeps its frame": mutant `adv-desktop-frameless` (`@media (min-width:769px){.watch-player-stage #player-wrapper{border:none!important;border-radius:0!important}}`, injected via a sandbox-only mutations.js entry) survives: "405 checks - 405 ok, 0 FAIL". Only the unit source lock (rule must be inside the 768 query) binds it.
3. Stage mobile rule lock does not forbid padding-top/bottom (`padding-top:0` appended: 61 pass).
Unmeasured (no WebKit): iOS env() re-resolution, edge swipe-back, iOS video layer.
