---
plan: snap-offset-status-bar
harness: v2 · lean
branch: fix/snap-offset-and-status-bar
anchor: spec
status: Built - awaiting the gate
next: gate r1 (adversary + qa; FULL gate - item 1 edits chapter times, a data class). Owed after merge: Dean's device pass (Shift all on a real offset download; a long album name in Click and Seattle on the phone).
design: "Approved 2026-09-24 (Dean's intake, recorded in memory wave-2026-09-24-intake)"
gate: pending
---

# Chapter Snap "Shift all" + the pocket skins' one-line status bar

A slim follow-up to the 2026-09-24 wave. Base: main 7402621c (= tag v1.323.0). Tech-debt ids
#259-#262 reserved. Two items; item 1 edits stored chapter times, so the branch takes the FULL
gate.

## The ask

**Item 1 - Chapter Snap "Shift all" (Dean, 2026-09-24, his words):** "We should add a top level
option at the top called a global offset. ... some files I download, I don't know if it's the
nature of the video I downloaded, or something about the fact that it becomes an MP3 ... the
whole track is offset by a somewhat equivalent amount. It's not the same for everything ...
there are some cases where the chapters are straight up misaligned ... but in some cases [it is
a whole-track offset]. So it would be nice to have like a global button."

The Architect's spec: a "Shift all" row at the top of the editor, above the per-chapter rows:
-1 s / -0.1 s / +0.1 s / +1 s and a live net-shift readout. It adds the delta to every row's
CURRENT start for chapters 2..N (chapter 1 keeps its start); a Reset returns the net shift to 0,
subtracting exactly what the shift added and never touching nudges made after. A direction is
disabled, with a short reason, when it would put chapter 2 at or before chapter 1 + the minimum
gap, or the last chapter at or past the duration - the minimum gap (the server-shared
constants, never a hand copy). A suggested shift comes from the silence already cached: per
boundary with a snap suggestion, delta = suggestion - current start; with at least 2 boundaries
and at least 60 % of them within +-0.3 s of the median, "Suggested: shift all by +X s (n of m
agree)" is a one-tap button; otherwise "No consistent offset". No new ffmpeg pass. Saving uses
the existing save path unchanged; Snap all after a shift still works (absolute); the "Edited"
badge is unchanged. Phone-first: every control >= 44 px at 390x844 and 844x390.

**Item 2 - the Click skin status bar (Dean):** "At the top bar where you have the battery, there
is an edge case where the song or album name might get too long and make that whole thing just
a little bit too big. It'll expand it by a row." The bar must be one line at a fixed height, the
title truncated with an ellipsis (a real iPod Classic truncates its status title the same way),
the play mark and battery never moving or shrinking. Every place the bar renders: Click, Click
Black, Click Matte, Seattle (its drilled-level dim title and its "music" header line), the Nano
tray, the desktop pop-out.

**Scope changes during the build (coordinator):** a real-battery addendum (navigator.getBattery)
was added and then CANCELLED by Dean ("skip the real battery thing for that branch ... add it to
a roadmap item for later"). None of it was built; the battery markup and look are byte-identical
to v1.323.0. The Architect records it in ROADMAP.md; no tracker row here.

## Re-verified survey (re-read at 7402621c before any edit; line numbers at the head of this branch)

Item 1 - the editor and the server it talks to:
- The ONE editor: `showChapterSnapEditor` public/js/common.js:13088 (base :13013). State rows
  `{index, title, sourceStart, savedStart, time}`; `times()` is what Save posts; the save
  handler posts `{version, starts: times()}` to POST /api/videos/:id/chapter-snap, unchanged by
  this branch.
- The shared constants: lib/media/chapterSnap.js:47 `MIN_CHAPTER_GAP_SEC = 0.1`; the editor
  state carries it as `minGapSec` (lib/media/chapterSnapRoutes.js:84) and the item's `duration`
  (:80). `clampSnapNudge` (common.js) already takes the gap from `state.minGapSec`; the shift
  clamps take the same two fields.
- The server's own rule (`validateSnapStarts` chapterSnap.js:190): count unchanged, chapter 1
  unchanged, strictly increasing, the last before the duration (a week when unknown). A shift
  can only produce lists this rule accepts (the clamps are stricter: the min gap at both ends).
- Suggestions: `suggestSnaps` (chapterSnap.js) gives per boundary `first` / `suggest` / `fine` /
  `no-gap` with an absolute `time`; the editor gets them in `state.suggestions` once the silence
  cache is `ready` for this file. The shift suggestion reads ONLY these (no new scan route, no
  new ffmpeg pass).
- Snap all's plan (`snapAllPlan`, common.js:13230) touched only rows "still at their saved
  time" - a shift moves every row off its saved time, so the plan had to learn that a row moved
  only by the shift is not hand-edited (else Snap all after a shift would snap nothing).
- Provenance / Revert: `buildSnappedManual` keeps `snapFrom` = the source start of every
  chapter (the FIRST base on a re-edit); a shifted save is an ordinary snap save, so Revert
  restores the source times (bound below through the real revert route).
- Likes: `<mediaId>::c<n>` keys by chapter INDEX (lib/music/libraryAudio.js); a shift changes
  times only, so the count and order invariant keeps every like on its song (bound below).

Item 2 - the status bar:
- Markup (one writer): public/js/music-skins.js:174-175 `ipScreen`: `.ip-status` > `.ip-np`
  (title) + `.ip-status-rt` (`.mms-playind` + `.ip-batt`). Used by `renderIpod` (Click, Black,
  Matte) and `renderZuneClassic` (Seattle): all four skins, the desktop pop-out (the same panel
  in its own window, skin-surface.js `createPopoutShell`) and the Nano tray (the pop-out with
  `body.mms-tray`).
- The title's writers: skin-surface.js:684 ("Now Playing" when no menu), :701 (the menu title:
  a static level's name, or on a drilled level the artist / album / genre / playlist / chaptered
  file's own name), :1294 ("Songs" / "Now Playing" for the legacy list flip). Only :701 can be
  long.
- CSS before this branch: style.css `.mms-ipod .ip-status{display:flex; justify-content:
  space-between}`, `.mms-ipod .ip-np{font-size; font-weight}` (no nowrap, no min-width, no
  overflow), `.mms-ipod .ip-status-rt{display:flex; gap}` (no flex:none). A long title wrapped
  to 3-4 lines and pushed the right cluster down (measured below).
- Seattle: `.mms-zune-classic .ip-np` (:12081) sets only weight and color; `.ip-batt` is hidden
  in Seattle (no battery drawn). Its drilled-level dim title `.ipm-title` (:12123) already had
  nowrap + ellipsis; its "music" header line on the pivot level is the status bar's `.ip-np`
  ("Music"), and the pivot strip `.ipm-pivots` is nowrap + overflow hidden.
- The Nano tray never draws a menu (skin-surface.js:680-684), so its title is always "Now
  Playing"; the CSS fix covers it anyway (same rule).

## Acceptance criteria

- **AC1 shift math** - a step moves chapters 2..N by exactly the step, chapter 1 never; the
  readout says "All chapters shifted +X s" / "No shift"; a nudge made after the shift survives
  Reset shift; Reset is exact to the millisecond after many steps both ways; Undo changes clears
  the shift. (integration chapter-snap-shift "the shift math", "Reset shift is EXACT")
- **AC2 clamps** - earlier: disabled (with "Shifting earlier would put chapter 2 at or before
  chapter 1.") when chapter 2 would land at or before chapter 1 + `minGapSec`; later: disabled
  (with "Shifting later would put the last chapter at or past the end of the file.") when the
  last chapter would land at or past `duration - minGapSec`; the reason clears when the step is
  legal again; the other direction is untouched. The gap is the server's. (integration "clamp
  EARLIER", "clamp LATER"; unit snapShiftBlock EARLIER / LATER incl. the exact boundary)
- **AC3 suggested shift** - from the cached silence only: agree -> a one-tap button "Suggested:
  shift all by +1.75 s (4 of 4 agree)" that applies it, after which the note reads "The chapters
  line up with the silence"; disagree -> "No consistent offset: ..."; too few -> "No consistent
  offset (too few gaps to compare)."; no scan request. `fine` boundaries count as evidence.
  (integration "the suggested shift from the CACHED silence"; unit AGREE / DISAGREE / FINE / TOO
  FEW / CURRENT times)
- **AC4 REAL ffmpeg** - a generated tone/silence album (music at 0, 8, 16, 24, 32 s) whose stored
  chapters are all 2 s early: the editor's own real scan suggests +1.75 s (4 of 4; +2 s minus
  the 0.25 s lead-in); a mixed list says no consistent offset; one boundary is too few; the
  applied shift saves through the existing route (count unchanged, titles unchanged, the SAME
  `::c` ids in /api/music), a like on `::c3` still names "Four", and Revert (the in-page
  confirm) restores the source times with the like still on "Four". (integration "REAL ffmpeg")
- **AC5 Snap all after a shift** - still snaps the suggestion rows to the silence (absolute);
  a snapped row keeps its snap through Reset shift; the readout says how many rows still carry
  the shift. Reset shift is refused, with the reason, when a row snapped after the shift would
  end up out of order. (integration "Snap all after a shift", "Reset shift is REFUSED")
- **AC6 stale seed** - the shift controls lock with Save; nothing shifted is written.
  (integration "a stale seed locks the shift controls")
- **AC7 phone** - every Shift all control >= 44x44 at 390x844 and 844x390, no sideways scroll,
  desktop at the editor's 36 px. (scripts/chapter-snap-probe.js; unit CSS lock)
- **AC8 status bar one line** - the status bar height is identical with a short name and a
  120-character album / chaptered-file name, on all four skins at 390x844 and 380x700, in the
  desktop pop-out (Click, Seattle) and the Nano tray; the title truncates with an ellipsis; the
  play mark and battery keep their x, y, w, h. (scripts/skin-status-bar-probe.js; unit
  skin-status-bar, a comment-stripped CSS lock + an override census + the rendered structure)

## Build record

Files:
- `public/js/common.js`: the pure helpers `formatSnapShift`, `snapShiftBlock`,
  `snapShiftSuggestion` (+ exports); in `showChapterSnapEditor`: the Shift all section (top of
  the scrolling list), per-row `shift` (whole ms the shift added), `renderShift` (called from
  `renderHead`, so every re-render re-evaluates the clamps and the suggestion), `applyShift`,
  `resetShift`, `shiftResetTimes` / `shiftResetProblem`, `shiftReadout`; `snapAllPlan` allows
  for a row's shift; a snap (one row or Snap all) clears that row's shift, a nudge keeps it; Undo
  clears every shift; the handle exposes `shiftBox`.
- `public/css/style.css`: `.chapter-snap-shift*` rules; `.chapter-snap-shift .btn` joins the
  desktop control-height list and the phone 44 px list; the status bar: `.mms-ipod .ip-np` gets
  `flex:1 1 auto; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis`,
  `.mms-ipod .ip-status-rt` gets `flex:none; margin-left:var(--space-4)`.
- `scripts/chapter-snap-probe.js`: measures the Shift all row (rect, every button, readout,
  reason, note); the Music item's cached silence is now a whole-track offset so the suggestion
  button is measured, then applied, then +1 s.
- NEW `scripts/skin-status-bar-probe.js`: the status bar instrument (below).
- NEW tests: test/unit/chapter-snap-shift.test.js (9), test/unit/skin-status-bar.test.js (4),
  test/integration/chapter-snap-shift.test.js (9, one needs ffmpeg).

Design notes (decisions the spec left open):
- **"Boundaries with a snap suggestion" includes `fine` ones.** A boundary the scan found
  already sitting on its silence is evidence AGAINST a whole-track offset; counting only
  `suggest` boundaries would call two off-by-2-s boundaries out of five a consistent offset. A
  unit test binds it both ways.
- **The median of an even count** is the midpoint of the middle two (rounded to the ms).
- **Aligned**: when the boundaries agree and the median is under 0.05 s (half a tenth), there is
  nothing to shift and the note says "The chapters line up with the silence (n of m agree)." -
  what Dean sees right after applying the suggestion.
- **The "No consistent offset" note carries no n-of-m.** With two clusters the median falls
  between them and "0 of 4 agree" would mislead; it says "the chapters are off by different
  amounts. Fix them one by one."
- **Snap vs shift**: a snap places a row on the silence (absolute), so it clears that row's
  shift; Reset shift then leaves it on its snap. A nudge is relative and keeps the row's shift,
  so Reset takes the shift off and keeps the nudge. The readout names a mixed state ("Shifted
  +1.0 s on 2 of 4 chapters (the others were snapped since)").
- **Reset refuses a disorder**: when a row snapped after the shift would end up at or before its
  neighbour, Reset is disabled with the reason and points at Undo changes.
- **Placement**: the section is the first child of the scrolling list, above chapter 1 - not in
  the fixed head - so the phone head stays short and the list keeps its room (the head already
  carries title, source line, status, Snap all / Undo / Revert).
- **Status bar height**: one line by `nowrap` + a shrinkable title; no declared `height` (a
  fixed px height would clip at a larger text size). Measured equal below.

Commits (every one through the pre-commit hook, never --no-verify):
- **49f45468** the build. Hook `tests 7261 pass 7261 fail 0`.
- **e9951751** tests: the single-row snap and Snap all each clear the shift, the Reset disorder
  refusal, the 60 % share case. Hook `tests 7261 pass 7261 fail 0`.
- **commit 3** (this plan's mutant table and measurements; the status-bar probe's
  `spillsOverPlayMark` check; the REAL-ffmpeg test asserts the applied sign).

Instruments (Node 22.23.1, at 49f45468 unless noted):
- `npx eslint` on every touched file: `✖ 6 problems (0 errors, 6 warnings)` - the 6
  pre-existing no-unused-vars warnings in common.js.
- `npm run lint:css`: `TOTAL 0`. `overlay-containment-lint --enforce`: `clean (0 violations)`.
- `bash .harness/lib/check-markers.sh`: `check-markers: clean (docs/exec-plans)`.
- Targeted set with `FILETUBE_TEST_FFMPEG=<static ffmpeg 7.0.2>` (unit chapter*, music*, skin*,
  player-chapters*, exec-plans*, tech-debt*, comment-debt*, release-ledger*, css*, token*,
  overlay*, shell*, mobile-input*; integration chapter-snap*, chapters-editor): `tests 944 pass
  944 fail 0 skipped 0`.
- The new integration file at e9951751 + the sign assert: `pass 9 fail 0 skipped 0`, diagnostic
  `real scan: Suggested: shift all by +1.75 s (4 of 4 agree) (applied 1750 ms)`.

## Measurements

### Item 2 - status bar (`node scripts/skin-status-bar-probe.js <out>`, headless Chromium, mobile emulation DPR 2)

Reached through the real menus each time (MENU / Select / row taps), a library with a short album
("Night Drive"), a 120-character album and a chaptered file with a 120-character title.
Status-bar heights in the order: Now Playing, short album drilled, LONG album drilled, LONG
chaptered-file title drilled.

| Skin @ viewport | BEFORE (7402621c) | AFTER | battery x,y,w,h (after, all four levels) |
|---|---|---|---|
| Click 390x844 | 31.2, 31.2, **67.6, 67.6** | 31.2, 31.2, 31.2, 31.2 | 338,27.6,22,11 (still) |
| Click Black 390x844 | 31.2, 31.2, **67.6, 67.6** | 31.2 x4 | 338,27.6,22,11 (still) |
| Click Matte 390x844 | 31.2, 31.2, **67.6, 67.6** | 31.2 x4 | 338,27.6,22,11 (still) |
| Seattle 390x844 | 30.2, 30.2, **66.6, 66.6** | 30.2 x4 | hidden (Seattle draws none); play mark 345,27.7 still |
| Click 380x700 | 31.2, 31.2, **85.8, 85.8** | 31.2 x4 | 328,27.6,22,11 (still) |
| Click Black 380x700 | 31.2, 31.2, **85.8, 85.8** | 31.2 x4 | 328,27.6,22,11 (still) |
| Click Matte 380x700 | 31.2, 31.2, **85.8, 85.8** | 31.2 x4 | 328,27.6,22,11 (still) |
| Seattle 380x700 | 30.2, 30.2, **66.6, 66.6** | 30.2 x4 | hidden; play mark 335,27.7 still |
| Desktop pop-out, Click (380x509 inner) | 31.2 ... album LONG **85.8** (battery pushed to y 54.9) | 31.2 at every level | 328,27.6,22,11 |
| Desktop pop-out, Seattle | 30.2 ... album LONG **66.6** | 30.2 at every level | hidden |
| Nano tray (310x133 inner) | 31.2 (title is always "Now Playing") | 31.2 | 250,33.6,22,11 |

- AFTER, every long row reads `truncated: true`, `white-space: nowrap`, `text-overflow:
  ellipsis`, `spillsOverPlayMark: false` (re-run with the spill check at commit 3: every SUMMARY
  `equal, battStill, playStill, longTruncated, noSpill` all true, the pop-out and tray 0 spills);
  `docScrollWidth` = the viewport width everywhere; no page errors.
- Seattle's drilled dim title `.ipm-title` is 47.2 px for the short and the long album, before
  and after (it was already one line with an ellipsis).
- **The same instrument against mutants in the real browser** (a `git archive 49f45468` sandbox,
  each edit on the ONE `.mms-ipod .ip-np` rule, Click + Seattle at 390x844; the probe gained a
  `spillsOverPlayMark` check for this - the title's text rect vs the play mark, when the title is
  not clipped). Log `snap-offset-status-bar-probe-mutants.out`:

  | Mutant | Click heights | Seattle heights | right cluster | title |
  |---|---|---|---|---|
  | control (unmutated) | 31.2 x4 | 30.2 x4 | still | truncated, no spill |
  | B1 drop `white-space:nowrap` | 31.2, 31.2, **85.8, 85.8** | 30.2, 30.2, **66.6, 66.6** | battery pushed to y 54.9 | wraps |
  | B2 drop `min-width:0` only | 31.2 x4 | 30.2 x4 | still | truncated, no spill - **equivalent in layout** |
  | B3 drop `overflow:hidden` only | 31.2 x4 | 30.2 x4 | still | **the text paints over the play mark and battery** (`noSpill: false`; PNG `snap-offset-status-bar-shots-B3/ipod-390x844-5-album-long.png`) |
  | B2 + B3 | 31.2 x4 | 30.2 x4 | **pushed off the LCD** (battery x 843.7, play mark x 825.7) | not truncated |

  B2 is equivalent because a flex item whose `overflow` is not `visible` already has an automatic
  minimum size of 0: `overflow:hidden` and `min-width:0` each keep the bar one line alone, and
  `overflow:hidden` is also what the ellipsis needs. Both are kept (belt and braces, the usual
  flex-truncation idiom) and the CSS lock binds both.
- Logs: session scratchpad `snap-offset-status-bar-probe-before.out` / `-after.out`; PNGs in
  `snap-offset-status-bar-shots-before/` and `-after/` (e.g. `ipod-390x844-5-album-long.png`,
  `zune-classic-380x700-8-file-long.png`, `ipod-popout-5-album-long.png`,
  `ipod-tray-popout-0-now-playing.png`).

### Item 1 - Shift all (`FT_PROBE_AUDIO=<a real 2000 s mp3> node scripts/chapter-snap-probe.js <out>`)

The editor reached through the real UI at every viewport (watch: chapters menu -> "Fix chapter
times..."; Music: album card -> drill "Fix times"). Shift row numbers:

| Surface @ viewport | editor buttons | min | < 44 | past viewport | doc scrollWidth | Shift row (w x h, scrollWidth = clientWidth) | Shift buttons |
|---|---|---|---|---|---|---|---|
| music editor 390x844 | 52 | 88x44 | 0 | 0 | 390 | 370x139, 370 = 370 | 4 x 88x44 + "Suggested: shift all by +1.75 s (7 of 7 agree)" 356x44 |
| after the suggestion | 45 | 88x44 | 0 | 0 | 390 | 370x136 | Reset shift 110x44 + 4 x 88x44; readout "All chapters shifted +1.75 s"; note "The chapters line up with the silence (7 of 7 agree)." |
| after +1 s | 53 | 88x44 | 0 | 0 | 390 | 370x165 | Reset 110x44, 4 x 88x44, suggestion "-1.0 s" 356x44; readout "+2.75 s" |
| watch 390x844 after Snap all | 44 | 88x44 | 0 | 0 | 390 | 370x111 | 4 x 88x44 |
| music editor 844x390 | 52 | 201x44 | 0 | 0 | 844 | 824x139, 824 = 824 | 4 x 201x44 + suggestion 810x44 |
| after the suggestion / +1 s | 45 / 53 | 201x44 | 0 | 0 | 844 | 824 wide | Reset 337x44 + 4 x 201x44 |
| music editor 1440x900 | 52 | 52x36 | 52 (desktop: 36 px mouse targets, by design) | 0 | 1440 | 726x123 | 4 x 177x36 + suggestion 285x36 |

- The pre-existing numbers hold: watch notches after Save 12.1125 % vs stored 12.113 % at every
  viewport; the drill buttons byte-identical to v1.322 (390: play 16,617 70x44 ... snap 16,669
  80x44); the audition plays at 243.9 s for the 241.5 s boundary.
- Log: session scratchpad `snap-offset-status-bar-snap-probe.out`; PNGs in
  `snap-offset-status-bar-snap-shots/` (`chapter-snap-music-390x844.png` (the suggestion),
  `...-390x844-shifted.png`, `...-390x844-shifted-more.png`, and the same at 844x390 and
  1440x900).

## Mutant table

Runner: session scratchpad `snap-offset-status-bar-mutants.js` - edits ONE file in a sandbox
built from `git archive e9951751` (+ a node_modules symlink), asserts the anchor matched exactly
once and the bytes changed, runs the named binding tests (with `FILETUBE_TEST_FFMPEG` set, so
the REAL-ffmpeg test runs), restores. RED = any `not ok` or a non-zero exit. Log
`snap-offset-status-bar-mutants.out` (+ `-b3.out`: B3's first anchor matched 4 rules and was NOT
run; re-anchored on the one rule, then RED).

**42 of 42 RED. No survivors.**

| # | Mutant | File | Binding test that reds |
|---|---|---|---|
| S1 | chapter 1 moves with the shift | common.js | integration shift math (+6 more) |
| S2 | Reset returns to the saved times (drops nudges) | common.js | shift math, Reset EXACT, Snap all after a shift |
| S3 | a nudge clears the row's shift | common.js | shift math, Reset EXACT, disorder refusal |
| S4 | a single-row snap keeps the shift | common.js | Snap all after a shift, disorder refusal |
| S5 | Snap all keeps the shift | common.js | Snap all after a shift |
| S6 | Snap all plan counts a shifted row as hand-edited | common.js | Snap all after a shift |
| S7 | Undo leaves the shift | common.js | shift math |
| S8 | earlier clamp removed | common.js | unit EARLIER, integration clamp EARLIER |
| S9 | later clamp removed | common.js | unit LATER, integration clamp LATER |
| S10 | earlier "at or before" -> "before" | common.js | unit EARLIER, integration clamp EARLIER |
| S11 | later "at or past" -> "past" | common.js | unit LATER, integration clamp LATER |
| S12 | the server gap ignored (0) | common.js | both clamp suites (4 fail) |
| S12b | a hand-copied gap (always 0.1) | common.js | unit EARLIER (the 0.3 s gap case) |
| S13 | `fine` boundaries not counted | common.js | unit FINE |
| S14 | the 60 % share ignored | common.js | unit DISAGREE (2 of 4 ON the median) |
| S15 | the two-boundary minimum ignored | common.js | unit TOO FEW, integration cached + REAL ffmpeg |
| S16 | +-0.3 s inclusive -> exclusive | common.js | unit DISAGREE (exactly 0.3 s) |
| S16b | tolerance 0 | common.js | unit AGREE / DISAGREE, integration |
| S17 | no "aligned" state | common.js | unit FINE / CURRENT, integration cached |
| S17b | the median is the mean | common.js | unit AGREE / DISAGREE / FINE |
| S18 | a blocked step is not disabled | common.js | integration clamp EARLIER / LATER |
| S19 | the reason never shows | common.js | integration clamp EARLIER |
| S20 | the reason never clears | common.js | integration clamp EARLIER, disorder refusal |
| S21 | a stale seed does not lock the shift | common.js | integration stale seed |
| S22 | the suggestion applies the wrong sign | common.js | integration cached suggestion (the REAL test now asserts the sign too, commit 3) |
| S23 | Reset enabled over a disorder | common.js | integration disorder refusal |
| S24 | Reset never hides | common.js | integration shift math |
| S25 | renderShift not called on re-render | common.js | 9 integration tests |
| S26 | the shift row below the chapter rows | common.js | integration shift math |
| S27 | the suggestion measured from the STORED starts | common.js | integration cached suggestion |
| S28 | the phone 44 px list drops the shift row | style.css | unit CSS lock |
| B1 | status title: `white-space:nowrap` dropped | style.css | unit skin-status-bar (+ headless: 85.8 px) |
| B2 | status title: `min-width:0` dropped | style.css | unit skin-status-bar (headless: equivalent, see Measurements) |
| B3 | status title: `overflow:hidden` dropped | style.css | unit skin-status-bar (+ headless: the text paints over the play mark) |
| B4 | no ellipsis | style.css | unit skin-status-bar |
| B5 | title `flex:1 0 auto` (cannot shrink) | style.css | unit skin-status-bar |
| B6 | the right cluster loses `flex:none` | style.css | unit skin-status-bar |
| B7 | Seattle's rule sets `white-space:normal` | style.css | unit override census |
| B7b | a later rule sets `TEXT-WRAP:wrap` (upper case) | style.css | unit override census |
| B8 | the rule survives only inside a comment | style.css | unit (comment-stripped read) |
| B9 | the status bar gets `flex-wrap:wrap` | style.css | unit skin-status-bar |
| B10 | the tray sets `min-width:auto` on the title | style.css | unit override census |

Equivalent (argued, not run): `applyShift`'s own `snapShiftBlock` re-check and `resetShift`'s
own disorder re-check are defense in depth behind the disabled buttons (the click listener
returns on a disabled button), so removing either alone cannot change behavior.

## Disclosed gaps

- **iPhone and the real battery**: out of scope here (the addendum was cancelled). For the
  record: WebKit (every iPhone browser) does not implement the Battery Status API, so on Dean's
  main device a real battery could never show; the status bar keeps its static battery.
- **A `fine` row moved by a shift gets no per-row "Snap to"** (the existing rule offers the button
  only for `suggest` boundaries, and Snap all only covers them). The shift suggestion line then
  offers the inverse shift, and Reset / Undo undo it; tracked as #259.
- **The shift row scrolls with the list.** When the editor opens on a chapter (now playing's
  "This chapter starts wrong"), the list scrolls to that chapter and the row is above it.
- **No new server surface.** The shift is client-side editing of the start times; the save, the
  version token, the validation and Revert are the existing routes, unchanged.

## Gate verdicts

(reserved for the Architect's gate rounds)
