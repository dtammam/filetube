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

## Gate r1 - security-brief (@c05c6906)

**What I could not do (read this first):** this seat has no Bash, so I could NOT run
`git diff 7402621c..c05c6906`. I established the changed-file set another way. The worktree
reflog (`.git/worktrees/agent-a4ecaf0edc36aa1e3/logs/HEAD`) shows one checkout at 7402621c,
then only the three branch commits, ending at c05c6906 = HEAD. So a file's mtime tells whether it
was written after that checkout. Sorting by mtime, the files written after checkout are
`public/css/style.css`, `public/js/common.js`, the two probes, the three new tests and this plan.
Every `lib/**/*.js`, `server.js`, `package.json`, `package-lock.json`, `Dockerfile`,
`docker-compose.yml`, every `public/*.html`, `public/filetube-worker.js` and every other
`public/js/*.js` (including `music-skins.js` and `skin-surface.js`) sorts among the checkout-time
files. That is strong evidence, but it is NOT a byte diff. The Architect should confirm it with
`git diff --stat 7402621c c05c6906`.

**Trigger surfaces:** none of the four (auth, secrets, network boundary, dependency) is
touched. There is no server, route, auth or package change (as far as mtime shows, see above).
No new outbound request or endpoint. Security sweep below.

Verified (I traced the code):
- **Save path unchanged.** The worktree's save handler (common.js:13738) posts
  `{ version: state.version, starts: times() }` to the same `base`. That is the same line as
  the main checkout's common.js:13512. Revert (13688) is also unchanged. The shift only changes
  `rows[i].time` for i >= 1, in whole ms. It sends nothing new.
- **The server would refuse anything bad the shift could produce.** `validateSnapStarts`
  (lib/media/chapterSnap.js:190) checks, on its own: the count, finite non-negative numbers,
  chapter 1 unchanged, strictly increasing after round3, and the last start before the duration
  (or a week when the duration is unknown). `buildSnappedManual` takes titles from the server
  record, never the client. The route's `freshForWrite` (chapterSnapRoutes.js:115) re-gates
  `mediaVisibleTo` and checks the `version` token inside the write tick (409 when stale), and
  requireModifyLibrary runs first (header comment :7). The client clamps (`snapShiftBlock`:
  min gap at both ends) are stricter than the server rule. Tampering with a button's
  `data-shift` in devtools can only produce a list the server validates the same way. The one
  gap the server does not check is the min gap between chapters: it only checks strict
  ordering. That is pre-existing and a data-quality issue, not a security one.
- **Stale seed:** `renderShift` locks every shift control when `busy || staleSeed`, and
  `applyShift` / `resetShift` return early on the same flags. The version token is never
  refreshed by a poll (a changed version sets `staleSeed`).
- **Every new string is set as text.** Both the new row and the helpers use only
  `el()`/`btn()` (createElement + textContent) and `.textContent =`. The readout, reason, note
  and suggestion text are built only from integers and fixed strings (`formatSnapShift`, n of
  m counts). No chapter title or file text goes into the new row. The only attributes set are
  static (`data-shift-act`, `aria-label`) or numeric (`data-shift` = `String(deltaMs)`). No
  `innerHTML` in any new code. The status-bar title writers the CSS now truncates
  (skin-surface.js:684/701/1294) use `textContent`. Those writers were not changed.
- **The probes are dev tools only.** `server.js` serves only `public/` (`express.static`
  :3487 plus fixed `sendFile`s of `public/*.html`), so `scripts/` is never reachable over HTTP.
  Both probes set `DATA_DIR` to a fresh `mkdtemp` before requiring the server (so they never
  touch the real DB) and bind the app to `127.0.0.1:0`. They use the existing test-only
  `__mintTestSession` export against that scratch store, and launch Chromium with
  `--remote-debugging-port` (Chromium binds this to loopback by default). Their inputs are
  operator-supplied argv/env: skin names, `FT_ROOT`, `FT_PROBE_AUDIO`, `CHROME`.
- **CSS:** layout properties only. No `url()` and no external resource.

Findings:
- **INFO-1 (suspicion, not a finding): probe CDP port on a shared host.** While a probe runs,
  headless Chromium exposes an unauthenticated DevTools endpoint on a random loopback port
  (9333-9732), using `--no-sandbox`. Any local user on the same host could drive that browser,
  which holds a real session cookie for the scratch server, during the run. On this
  single-user dev container no such user exists, so there is no attack path. The existing
  `action-row-probe.js` uses the same pattern. No action needed.
- **INFO-2: probe temp dirs are not removed.** The `mkdtemp` DATA_DIR, library and Chromium
  profile dirs stay in `os.tmpdir()`. They hold only synthetic fixtures (or a copy of the
  operator's own `FT_PROBE_AUDIO`) and a scratch-store session. This is hygiene, not exposure.

No CRITICAL, HIGH, MEDIUM or LOW findings.

Gate: APPROVED r1 @c05c6906 — security-brief

## Gate r1 - qa (@c05c6906)

Reviewed `git diff 7402621c..c05c6906` (9 files), the plan, AGENTS.md / CONTRIBUTING.md rules.
Instruments (Node 22.23.1, run by this seat):
- New files with `FILETUBE_TEST_FFMPEG` set (unit chapter-snap-shift, unit skin-status-bar,
  integration chapter-snap-shift): `tests 22 pass 22 fail 0 skipped 0`; diagnostic
  `real scan: Suggested: shift all by +1.75 s (4 of 4 agree) (applied 1750 ms)`.
- Existing chapter-snap unit + integration suites, chapters-editor, chapter-likes, every
  `*census*`, css-token-lint, overlay-containment, token-scale-lock, type-scale-tokens,
  music-skin*: `tests 336 pass 336 fail 0 skipped 0`.
- `npm run test:unit`: `tests 7261 pass 7261 fail 0 skipped 0` (matches the plan's hook count).
- `npm run lint:css`: `TOTAL 0`. `lint:overlay`: `clean (0 violations)`. eslint on the six
  touched JS files: `6 problems (0 errors, 6 warnings)` (the pre-existing no-unused-vars in
  common.js). `check-markers: clean (docs/exec-plans)`.
- Probes re-run on a `git archive c05c6906` sandbox. skin-status-bar-probe: every SUMMARY
  `equal/battStill/playStill/longTruncated/noSpill` true; Click trio 31.2 x4 (battery 338,27.6
  at 390, 328,27.6 at 380), Seattle 30.2 x4 (play mark 345 / 335), pop-out Click 31.2 and
  Seattle 30.2 at every level, tray 31.2 (battery 250,33.6); all 72 on-page rows `reached`,
  `docScrollWidth == vw`, no page errors - identical to the plan's table. PNGs checked: the
  ellipsis renders, descenders intact. chapter-snap-probe (390x844, 844x390, 1440x900): shift
  row 370x139 / 824x139 / 726x123, shift buttons 88x44 / 201x44 / 177x36, suggestion
  356x44 / 810x44 / 285x36, `below44` 0 on both phone viewports, doc scrollWidth = viewport,
  readouts and notes as the plan states; notches 12.1125 vs 12.113 unchanged. Matches.

Verified correct: the step math (whole ms, chapter 1 fixed), Reset = time - own shift, the two
clamps against the server's `minGapSec`/`duration` (at-or-before / at-or-past, both bound at
the ms boundary), the median/60 %/+-0.3 s/2-boundary rule, `fine` counted, Snap all's
hand-edit test allowing for the shift, snap clears / nudge keeps the row's shift, Undo clears,
stale-seed lock, the save path unchanged. The status bar CSS is token-clean and the census
lock covers the overrides. Tracker #259 is accurate and the census accepts it.

Security: no new surface. Every new string is set by `textContent` (el()/btn()) and built
from integers and fixed strings; `data-shift` is `String(number)` and read back through
`Number()`; no `innerHTML`; the status-bar title writers (skin-surface.js:684/701/1294, user
album names) use `textContent` and were not changed; the CSS adds no `url()`. The probes are
dev tools outside `public/`. Agreed with the security-brief seat.

Findings:

1. **WARNING - the "aligned" note says the chapters line up when some of them do not**
   (public/js/common.js:13076 + :13327). `snapShiftSuggestion` returns `aligned` whenever at
   least 60 % agree and the median is under 50 ms, and the note then reads "The chapters line
   up with the silence (n of m agree)." for n < m too. Verified in jsdom: 6 chapters, rows 2-3
   `suggest` 2 s late, rows 4-6 `fine` -> the head status reads "2 starts look off. Snap them,
   ..." and "Snap all (2)", while the Shift all note (the FIRST thing in the list) reads "The
   chapters line up with the silence (3 of 5 agree)." That is Dean's second named case ("some
   cases where the chapters are straight up misaligned") and the copy contradicts the head on
   the same screen. The design note says this note is "what Dean sees right after applying
   the suggestion" (the n = m case); it was not meant for the partial one. Prescription: keep
   the `aligned` kind (nothing to shift is correct), but when `agree < of` say so, e.g. "No
   whole-track offset: 3 of 5 chapters already line up. Fix the others one by one."; keep the
   current line for `agree === of`. Bind both arms in the integration cached-silence test (a
   fixture with two `suggest` and three `fine`, asserting the note text).

2. **SUGGESTION - the mixed readout names the wrong cause** (common.js:13292). "(the others
   were snapped since)" assumes the zero-shift rows were snapped. Verified: 5 chapters, +1 s,
   snap chapter 2, -1 s -> chapters 3-5 are back on their saved times with no net shift and
   were never snapped, chapter 2 (the snapped one) carries -1 s, and the readout says "Shifted
   -1.0 s on 1 of 4 chapters (the others were snapped since)". Neutral copy fixes it: "(the
   others carry no shift)".

3. **SUGGESTION - Reset can put two chapters closer than the server's minimum gap**
   (common.js:13278 `shiftResetProblem` checks strict order only). Verified: chapters
   [0, 60, 61.5, 120], +1 s, nudge chapter 3 -1 s, snap chapter 2 to 60.45, Reset is enabled
   and Save posts `[0, 60.45, 60.5, 120]` - a 50 ms chapter, both rows showing `1:00.5`. The
   server accepts it (strict order) and the pre-existing single-row snap has the same
   strict-only check, so this matches AC5 as written; but the steps and nudges honour
   `minGapSec`, so Reset could use `t[i] - t[i-1] >= minGapSec` (and `dur - minGapSec` for
   the last) for one consistent invariant.

4. **SUGGESTION - the readout's `aria-live` is re-written on every render** (common.js:13179,
   written in `renderShift` on every `renderHead`). Reasoned, not verified on a screen reader:
   some readers re-announce a live region when its text node is replaced even with identical
   text, so each nudge / audition / poll could announce "No shift" alongside the status line.
   Write it only when the text changes.

5. **SUGGESTION (disclosed gap, judged acceptable) - the Shift all row is scrolled away when
   the editor opens on a chapter** (common.js:13542). From now playing's "This chapter starts
   wrong" on chapter 5+, the row sits several phone screens above. Acceptable to ship: the
   whole-track case is also fixed by Snap all in the fixed head (absolute, bound after a shift),
   the Music drill's "Fix times" opens at the top, and the gap is disclosed. A cheap follow-up:
   when the suggestion is of kind `suggest`, mention it in the status line ("Looks like a
   whole-track offset: see Shift all at the top").

Not findings: the plan's line references (common.js:13088 / :13230, skin-surface.js:684 /
701 / 1294, style.css :12081) are accurate; the probe comment that the watch editor shows "No
consistent offset" holds (its first, pre-Snap-all measurement reads exactly that); the pocket
skins' left-aligned title predates this branch (the change only adds truncation).

Verdict: CHANGES for finding 1 (a user-facing claim that is false in one of the two cases the
feature exists for; a one-branch copy fix plus its binding). Findings 2-5 do not block.

Gate: CHANGES r1 @c05c6906 — qa

## Gate r1 - adversary (@c05c6906)

Instruments (Node 22.23.1, static ffmpeg via FILETUBE_TEST_FFMPEG, Chromium 1234 headless). Mutants
ran ONLY in a `git archive c05c6906` sandbox in the session scratchpad (pristine copies byte-compared
after every mutant: `restore-check identical`).
- The three new test files in this worktree: `tests 22 pass 22 fail 0 skipped 0` (the REAL-ffmpeg test ran).
- Targeted set on the sandbox (unit chapter*, music*, skin*, css*, token*, exec-plans*, tech-debt*,
  player-chapters*; integration chapter-snap*, chapters-editor): `tests 864 pass 864 fail 0 skipped 0`.
- `npx eslint` on the 6 touched js files: `6 problems (0 errors, 6 warnings)`. `lint:css` `TOTAL 0`.
  `lint:overlay` clean. `check-markers: clean`.
- `git diff --stat 7402621c..c05c6906`: 9 files, none under `lib/`, no `server.js`, `package*.json`,
  `music-skins.js` or `skin-surface.js` (confirms the security-brief's mtime inference with a byte diff).

Findings:

1. **WARNING - the status-bar CSS lock does not cover the parent, descendant selectors or vendor
   spellings (the named crown-jewel class).** Each rule below was appended in a later
   `@media (max-width: 768px)` block; `skin-status-bar` + `music-skins` + `skin-surface` +
   `skin-scrollbar-hidden` stay GREEN (`pass 117 fail 0`) for all seven, and
   `scripts/skin-status-bar-probe.js` (Click or Seattle, 390x844) shows each one breaking the bar
   (control: 31.2 x4, battery 338,27.6):
   - C1 `.mms-ipod .ip-status{display:block}`: bar 48 px at every level, play mark and battery drop
     to line 2 (battery 56,45.1).
   - C2 `.mms-ipod .ip-status > span{white-space:normal}`: long album **85.8 px, battery y 54.9** -
     the original bug, fully back.
   - C3 `.mms-ipod .ip-status *{white-space:normal}`: 85.8 px, same.
   - C4 `.mms-zune-classic .ip-np{-webkit-flex-shrink:0}`: Seattle play mark pushed to **x 716.7** on
     a 390 px screen.
   - C6 `.mms-ipod .ip-status{flex-direction:column}`: 48 px everywhere.
   - C11 `.mms-ipod .ip-status{-webkit-flex-wrap:wrap}` (the vendor spelling of B9): long rows 48 px,
     battery to line 2. The unprefixed `flex-wrap` and `flex-flow` ARE caught (C10 RED).
   - C12 `.mms-ipod .ip-status{display:grid}`: 48 px everywhere.
   Caught correctly (RED): C7 same selector upper-case prop, C8 `.ip-status .ip-np`, C9
   `-webkit-line-clamp` override, C10 `flex-flow:row wrap`, C13 `body.mms-tray .ip-np{white-space:pre-wrap}`,
   C14 `TEXT-WRAP-MODE:wrap`.
   Fix: strip `-webkit-`/`-moz-`/`-ms-` from property names before every check; lock the bar's own
   `display:flex` and forbid any `.ip-status` rule redeclaring `display`, `flex-direction`,
   `flex-wrap`, `flex-flow`; and census every rule whose selector names `.ip-status` in ANY compound
   (`.ip-status > span`, `.ip-status *`) for `white-space`/`text-wrap*`/`display`/`flex*`. Re-run
   C1-C12 red.

2. **WARNING - the "suggestion the clamps refuse" arm is unbound.** It is reachable and correct at
   HEAD (verified, fixture: chapters 0 / 1.0 / 60 / 120, silences 58.5-59.3 and 118.5-119.3,
   duration 180): the button reads "Suggested: shift all by −0.95 s (2 of 2 agree)", is disabled,
   the reason "Shifting earlier would put chapter 2 at or before chapter 1." shows, and a tap moves
   nothing. But no test drives it. Survivors: A3 (`shiftApplyBtn.disabled = lock`), A4 (its reason
   never pushed), A5 (applyShift's own re-check removed), A6 (its stale/busy lock dropped); and the
   double mutant **D1 = A3 + A5 survives `pass 53 fail 0`** (unit shift + integration shift,
   editor-ui, chapter-snap). Under D1 the same fixture taps through and **SAVES `[0, 0.05, 59.05,
   119.05]`** - chapter 2 inside the minimum gap, accepted by the server. The plan's "equivalent
   (argued, not run)" note leans on the disabled button, but S18 binds only the four STEP buttons,
   not the suggestion button. Fix: an integration test on that fixture asserting the button is
   shown AND disabled, the reason shown, a tap changes nothing; then A3 and D1 red.

3. **WARNING - Reset's "past the end" refusal is unbound.** It is reachable and correct at HEAD
   (verified: chapters 0 / 100 / 299.5, duration 300; −1 s, then nudge the last one +1 s and +0.1
   s x6 to 4:59.9; Reset is disabled with "Resetting would put the last chapter past the end of the
   file. Use Undo changes to start over."; Save writes `[0, 99, 299.9]`). Deleting that line (A1,
   which also removes resetShift's own re-check because both call shiftResetProblem) survives
   `pass 69 fail 0`. Under A1 Reset lands chapter 3 at **5:00.9 on a 300 s file**, Save is enabled,
   and the server refuses it (`Chapter 3 must start before the end of the file.`, nothing written).
   So the server backstops it, but the editor shows a list it cannot save, and the guard the plan
   names has no binding. Also surviving: A2 (the disorder check `!(t[i] > t[i-1])` weakened to
   `t[i] < t[i-1]`, so an EQUAL pair passes; also refused by the server). Fix: bind the fixture
   above and add an equal-pair case.

4. **SUGGESTION - Reset can save a start inside the minimum gap (verified at HEAD).** Chapters
   0 / 0.35 / 100: +0.1 s, then nudge chapter 2 −0.1 x3, Reset: **stored `[0, 0.05, 100]`**.
   Chapters 0 / 100 / 299.45 (duration 300): −0.1 s, then nudge the last +0.1 x5, Reset: **stored
   `[0, 100, 299.95]`**. The server accepts both (its rule is only "strictly after"), and the
   pre-existing per-row snap is gap-free too, so the gap is a step/nudge clamp, not an editor-wide
   invariant. Either give shiftResetProblem the same `minGapSec` ends as snapShiftBlock, or disclose it.

5. **SUGGESTION - the agreement rule is looser than "+-0.3 s" reads, and two of its edges are
   unbound.** Even counts use the midpoint, so the spread that still counts as agreement is 0.6 s:
   boundaries +1.0 / +1.6 give `suggest +1.3 s, 2 of 2` (each one then 0.3 s off its silence), and
   −0.3 / −0.3 / +0.3 / +0.3 give `aligned, 4 of 4` ("The chapters line up with the silence") even
   though every boundary is 0.3 s off. The 50 ms "aligned" edge is unbound (A8 `<` to `<=`
   survives). The `agree < SNAP_SHIFT_MIN_BOUNDARIES` clause is dead (A9 survives, and it is
   equivalent: with `of >= 2`, 60 % already forces `agree >= 2`). Nothing applies without a tap,
   so this is a design note: tighten it or disclose it.

6. **SUGGESTION - a stored start on an exact half-millisecond stays dirty after Shift + Reset.**
   With 120.0005 in the list, +0.1 s then Reset gives "No shift", but Save and Undo stay ENABLED
   (the row comes back as 120.001). The nudge rounding already does the same thing
   (clampSnapNudge), and only nanosecond-timebase sources can store it. Non-blocking.

7. **SUGGESTION - applyShift stopping the audition is unbound** (A15 survives): a shift during a
   row's audition leaves the old time playing. It is UX only.

Verified holding (the brief's destroy-the-data list):
- **Count, order, chapter 1, past the duration:** the save posts `times()` through the unchanged
  route, and `validateSnapStarts` (unchanged) refuses count, chapter-1, order and end violations.
  I found no path at HEAD to a SERVER-ACCEPTED save that breaks those four. Only the client-side
  minimum gap can be broken (finding 4 at HEAD; finding 2 under a mutant).
- **Drift:** 2000 seeded-random ±0.1 s/±1 s steps (net −20.4 s) and one Reset put every
  millisecond-grid row back on its stored time exactly (finding 6 is the only exception).
  A13/A14 (unrounded arithmetic) survive, but they have no observable effect: the dirty and
  Snap-all checks use a 0.5 ms tolerance and the server rounds to 3 places.
- **Your kills, re-run:** S3 (a nudge clears the shift) RED 3 tests, S6 (Snap all counts a shifted
  row as hand-edited) RED, S27 (suggestion from STORED starts) RED. My extras RED: A7 (Reset lock),
  A10 (50 % share), A11 (lower-middle median), A12 (sign), A17 (gap-less later clamp), A18 (ASCII
  minus).
- **REAL ffmpeg, my own drive (a LATE offset, the other sign):** the same tone/silence album with
  chapters at 0 / 9 / 17 / 25 / 33. The real scan offers "Suggested: shift all by −1.25 s (4 of 4
  agree)" (`data-shift` −1250). After the tap the note says the chapters line up and Snap all has
  nothing left to snap. Saved `[0, 7.75, 15.75, 23.75, 31.75]` with the titles unchanged,
  `snapFrom` = 0 / 9 / 17 / 25 / 33 and `snapBase` "embedded". The like on `::c2` still names
  "Three" (at 15.75). Revert clears `chaptersManual` and the like is still "Three" at 17. A
  misaligned list (0 / 5.2 / 17.6 / 24.9 / 30.5) shows no button, and the note says "No consistent
  offset: the chapters are off by different amounts."
- **Phone:** `scripts/chapter-snap-probe.js` reproduces the plan's Shift-row table. At 390x844:
  4 x 88x44 plus the suggestion 356x44, no button under 44 px, the row's scrollWidth equals its
  clientWidth (370), and the document is 390 wide. At 844x390: 4 x 201x44, the suggestion 810x44,
  and after the tap Reset 337x44.
- **Status bar, base vs head:** a copy of the probe dumps EVERY element box in the panel. With a
  short title, at every level (Click, Black, Matte at 390x844 and 380x700, Seattle, both pop-outs,
  the tray), only the `.ip-np` WIDTH changes (it fills the bar, e.g. 78.6 to 282) plus the
  playback clock. A second run confirmed that one art-image delta was transition noise. With a
  long title the bar goes from 67.6 to 31.2 px and the battery y from 45.8 to 27.6, as the plan
  says.

Blocking: 1, 2, 3 (the fixes are a lock extension and two bindings; no production change is
required for 2 or 3).

Gate: CHANGES r1 @c05c6906 — adversary
