---
plan: snap-offset-status-bar
harness: v2 · lean
branch: fix/snap-offset-and-status-bar
anchor: spec
status: Gate closed pending adversary re-confirm
next: release
design: "Approved 2026-09-24 (Dean's intake, recorded in memory wave-2026-09-24-intake)"
gate: APPROVED r3 @0cc5d68f — qa, security-brief; adversary: r3 WARNING disclosed by Architect ruling, re-confirm pending
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
- **The agreement rule, stated exactly** (corrected at gate r1, adversary 5): at least two
  boundaries with a snap point, and at least 60 % of them EACH within +-0.3 s of the median. For an
  even count the median is a midpoint, so two boundaries up to 0.6 s apart both agree (+1.0 / +1.6
  suggests +1.3 s, each 0.3 s off its silence), and -0.3 / -0.3 / +0.3 / +0.3 reads "aligned,
  4 of 4". Nothing is applied without a tap, and a per-row Snap fixes any 0.3 s leftover.
- **Aligned** (median under 0.05 s, exclusive): nothing to shift. When EVERY boundary agrees the
  note says "The chapters line up with the silence (n of m agree)." - what Dean sees right after
  applying the suggestion. When only a majority does (gate r1, qa W1), it says "No whole-track
  offset: n of m already line up. Fix the others one by one."
- **One gap rule for every edit** (gate r1, adversary 4 / qa S3): the steps, the nudges, Reset
  shift, the per-row Snap and Snap all all keep the server's `MIN_CHAPTER_GAP_SEC` (from the
  editor state) from the neighbours an edit touches and from the end of the file
  (`snapGapBreak`). The shift steps follow the spec's wording (a landing AT chapter 1 + the gap is
  refused); the others allow exactly the gap, as the nudge clamp always did. **Refined at gate r2
  (qa 1 = adversary 2):** an edit is refused only when it NARROWS a pair (or the last start's
  distance to the end) into the gap AND closer than the SAVED list has it. A close pair that came
  from the source is never an edit's to refuse, and a shift can always go back to what was saved
  (`snapShiftBlock` takes the saved list too).
- **The "No consistent offset" note carries no n-of-m.** With two clusters the median falls
  between them and "0 of 4 agree" would mislead; it says "the chapters are off by different
  amounts. Fix them one by one."
- **Snap vs shift**: a snap places a row on the silence (absolute), so it clears that row's
  shift; Reset shift then leaves it on its snap. A nudge is relative and keeps the row's shift,
  so Reset takes the shift off and keeps the nudge. The readout names a mixed state ("Shifted
  +1.0 s on 2 of 4 chapters (the others carry no shift)", reworded at gate r1, qa S2).
- **Reset refuses a disorder**: when a row it moves would end up at or before its neighbour, or
  inside the minimum gap, or the last one inside the gap before the end of the file, Reset is
  disabled with the reason and points at Undo changes.
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

**Gate r3 disclosures (Architect ruling, Dean's gate-pacing norm: no fourth round over tests of
tests; all tracked as #272, the code is byte-identical to 0cc5d68f):**
- **The status-bar census still fails OPEN on four spellings** (adversary r3 W1). Each one, appended
  to style.css, brings back Dean's exact bug in the headless probe (85.8 px, battery at y 54.9)
  while the census stays green:
  - `.mms-ipod .ip-np:not(#zz)` (the usual specificity-bump idiom);
  - `.mms-ipod :is(#zz, .ip-np)`;
  - `.mms-ipod :is(.x, .ip-np:not(.y))`;
  - `.mms-ipod .ip\-np` (an escaped class).

  The three causes: a `#` ANYWHERE in the final compound (even inside `:not()` / `:is()`) rules
  the rule out; `:is()` arguments are cut at the first `)`, so nested parentheses are misread; and
  CSS escapes are not read. **The shipped CSS itself is correct**, measured headless on every
  surface (Click, Black, Matte, Seattle, the pop-out and the tray; qa's r3 probe also covered the
  new v1.324.0 levels). The gap is only in the regression net.
- **Two semantics of the saved-list rule are unbound** (adversary r3 S2). M15 (the suggestion's
  clamp called without the saved list) and M16 (`savedTimes()` returning the SOURCE starts instead
  of the saved ones) survive, because every fixture is a fresh item where saved equals source.
  M8b and M9b (the per-row Snap and Snap all without `stored`) are argued equivalent by
  reachability: a server `suggest` lies strictly between the stored neighbours and at least 0.1 s
  from its own stored start, so a snap can never narrow a pair back down to its stored width.
- **The nudge-clamp squeeze, corrected wording** (adversary r3 S3; pre-existing `clampSnapNudge`,
  unchanged from the base). With a close PAIR of source starts (`[.., 60, 60.03, 60.15, ..]`), a
  +0.1 s nudge of the middle one lands on prev + gap and SAVES `[.., 60, 60.1, 60.15, ..]`, a
  50 ms pair narrower than both the gap and the source. With THREE source starts within 0.1 s
  (`[0, 60, 60.03, 60.06, 120]`), the same nudge puts the chapter PAST its next neighbour
  (1:00.0 / 1:00.1 / 1:00.1): the server refuses the save ("Chapter 4 must start after chapter 3.")
  and nothing is written. The r2 record's wording ("can leave it within the gap of the next one")
  understated the second case.
- **Three comments still describe the stricter r1/r2 gap rule** (qa r3 S1): public/js/common.js
  ~13270 (snapAllPlan's header, "each snapped time must stay at least the minimum gap inside the
  CURRENT neighbours"), ~13284 ("At least the server's minimum gap from the CURRENT neighbours")
  and ~13327-13329 (shiftResetProblem, "refused when a row it moves would land ... closer than the
  server's minimum gap"). The code and `snapGapBreak`'s own comment are right: an edit is refused
  only when it narrows a pair into the gap below its saved width.
- **The status-bar probe's SUMMARY ignores `reached`** (qa r3 S2): a level that silently fails to
  open would keep the last title and still read `equal: true`. `reached` was true on every row in
  every round (checked by hand and by qa).

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

## r1 fix record (builder, after gate r1 @c05c6906)

Commits (every one through the pre-commit hook, never --no-verify):
- **3f01b5f3** the three r1 verdicts committed as the seats left them (docs-only hook, `tests 1299
  pass 1299 fail 0`).
- **dd7cfec4** the fixes and their bindings. Hook `tests 7266 pass 7266 fail 0`.
- **this commit**: this section, the corrected design notes, and one census hardening in
  skin-status-bar.test.js (only the ONE base rule object is exempt, so a later rule that
  REPEATS the base selector is censused too).

No merge of main was needed (the hook did not trip the release-ledger check).

### Finding -> fix -> test -> mutant

| Finding | Fix | Binding test | Mutants (RED) |
|---|---|---|---|
| **qa W1** "The chapters line up" when only some agree | The `aligned` note is split: every boundary agrees -> "The chapters line up with the silence (n of m agree)."; a majority -> "No whole-track offset: n of m already line up. Fix the others one by one." | integration "qa W1": 2 chapters 2 s early + 3 on their silence -> the partial note and Snap all (2); after Snap all -> "line up (5 of 5 agree)" | W1 |
| **adversary W1** the status-bar lock missed parent, descendant and vendor spellings | skin-status-bar.test.js rebuilt: property names lower-cased and `-webkit-`/`-moz-`/`-ms-`/`-o-` stripped before every check; the bar's own `display:flex` (row, no wrap) locked; a census of EVERY rule that can REACH the title, the bar or the right cluster (last compound can match the element's tag + class, or `*`, a bare attribute, `:is()`/`:where()` alternatives; ancestors on the skin chain or none; pseudo-elements excluded) against a per-element table of forbidden / allowed values; a parser self-test | the 7 tests of skin-status-bar.test.js | C1, C2, C3, C4, C6, C7, C8, C9, C10, C11, C12, C13, C14 + C15 (a `> span:last-child` rule re-enabling the cluster's shrink, vendor spelling), C16 (`:is(.ip-status){display:block}`), C17 (the base `display:flex` dropped); B1-B10 re-run |
| **adversary W2** the refused suggestion was unbound | (test only) | integration "adversary W2": the adversary's fixture (0 / 1.0 / 60 / 120) - "Suggested: shift all by −0.95 s (2 of 2 agree)" shown, disabled, reason shown, a tap moves nothing, and the SAME button forced back on (`disabled = false`) still moves nothing and the status says why; a second fixture (0 / 1.5 / 60 / 120) where every step is legal and only the −1.45 s suggestion is refused, so the reason on screen can only be the suggestion's. The stale-seed test now carries a cached silence so the suggestion button is on screen and must lock | A3, A4, A5, A6, **D1 (A3 + A5)** |
| **adversary W3** Reset's past-the-end and equal-start refusals unbound | Reset now uses the shared gap rule (below), which covers both | integration "adversary W3": (1) 0 / 100 / 299.5, −1 s, last nudged to 4:59.9 -> Reset disabled "at or past the end of the file, or within 0.1 s of it", Save writes `[0, 99, 299.9]`; (2) 0 / 100 / 299.45 -> Reset would leave 50 ms before the end; (3) an EQUAL pair (chapter 3 back on chapter 2's snapped 60.5); (4) 0 / 0.35 / 100 -> Reset would leave 50 ms after chapter 1 | A1, A1r, A2, A2b, R3r |
| **adversary 4 = qa S3** Reset (and the per-row Snap / Snap all) could save a start inside the server's minimum gap | NEW pure `snapGapBreak(times, changed, duration, minGapSec)` (common.js, exported): checks only the pairs an edit touches, exactly the gap allowed (as the nudge clamp), the last start at least the gap before the end. Used by Reset shift, the per-row Snap (message "would cross its neighbour or come within 0.1 s of it") and Snap all's plan. The nudges and the shift steps already honoured the gap | unit "snapGapBreak" (12 asserts); integration "qa S3 / adversary 4" (0 / 60 / 80, chapter 3 nudged to 61.8: Snap all and the per-row Snap both leave chapter 2's 61.75 alone; at 61.9 both take it) | A2c, G1, G2, G3, S12c, S12d |
| **adversary 5** the agreement rule's edges | The dead `agree < 2` clause removed (with `of >= 2`, the 60 % share already forces two); the 50 ms cutoff bound; the rule re-stated exactly in the design notes (a midpoint median lets two boundaries 0.6 s apart agree; disclosed) | unit "the 50 ms aligned cutoff is exclusive" | A8 (A9 deleted with its clause) |
| **adversary 6** a half-millisecond start stayed dirty after Shift + Reset | Shift and Reset arithmetic kept to the MICROSECOND (`micro`), not re-rounded to the ms: 120.0005 comes back exactly | integration "adversary 6": +0.1 s then Reset -> Save and Undo disabled | R1, R1b |
| **adversary 7** a shift stopping the audition was unbound | (test only) | integration "adversary 7": a fake `<audio>`; auditioning chapter 2, +1 s -> the row is no longer playing and the audio was paused | A15 |
| qa S2 the mixed readout named the wrong cause | "(the others carry no shift)" | integration "Snap all after a shift" | - |
| qa S4 the polite readout rewritten on every render | written only when its words change | integration "qa S4": a MutationObserver sees no write for two nudges, a write for +1 s | R2 |
| qa S5 the shift row is scrolled away when opened on a chapter | not taken (qa judged it acceptable; disclosed) | - | - |
| security-brief INFO-1 / INFO-2 (probe CDP port, temp dirs) | not taken (dev tools on a single-user box) | - | - |

### Mutant round @dd7cfec4

Runners: `snap-offset-status-bar-mutants-r1.js` (the build's 42, anchors refreshed, plus the r1
set) and `snap-offset-status-bar-mutants-r1b.js` (multi-edit D1 and the gap constant re-anchored
per function) in the session scratchpad, on a sandbox from `git archive dd7cfec4` with
`FILETUBE_TEST_FFMPEG` set; every anchor matched once and the bytes changed; the sandbox's
common.js / style.css were byte-identical to the archive afterwards. Logs:
`snap-offset-status-bar-mutants-r1.out`, `-r1b.out`.

- **80 of 81 RED.** All 40 runnable build mutants still RED (S12 / S12b re-anchored in r1b: the
  gap line now appears in two functions). All r1 mutants RED: A1, A1r, A2, A2b, A2c, A3, A4, A5,
  A6, D1, A8, A15, W1, R1, R1b, R2, G1, G2, G3, R3r, S12, S12b, S12c, S12d, and C1-C4, C6-C17.
- **Equivalent (1): A16**, the shift click handler ignoring `b.disabled`. Every action it could
  reach re-checks on its own: `applyShift` re-runs the clamp (bound by A5 through the
  forced-enabled button) and returns on busy / stale, `resetShift` re-runs the gap rule and returns
  on busy / stale. So the handler's own check is defense in depth and cannot change behaviour.
- The adversary's other r1 survivors: A9 is gone with its clause; A13 / A14 (unrounded
  arithmetic) are now the implementation at microsecond precision, bound by R1 / R1b.

### Instruments at dd7cfec4 (Node 22.23.1)
- Targeted set with ffmpeg (unit chapter*, music*, skin*, player-chapters*, exec-plans*,
  tech-debt*, comment-debt*, release-ledger*, css*, token*, overlay*, shell*, mobile-input*;
  integration chapter-snap*, chapters-editor): `tests 957 pass 957 fail 0 skipped 0`.
- The shift integration file: `pass 16 fail 0 skipped 0` (the REAL-ffmpeg test ran).
- eslint on the touched js: `✖ 6 problems (0 errors, 6 warnings)` (the pre-existing six).
- `bash .harness/lib/check-markers.sh`: `✗ ... stale approval @c05c6906 - reviewed code changed
  since; re-gate` - expected until gate r2 re-binds (the security-brief's r1 APPROVED names the
  old sha).

### Probes @dd7cfec4
- `scripts/skin-status-bar-probe.js` (all four skins at 390x844 and 380x700, the pop-out, the
  tray): every SUMMARY `equal, battStill, playStill, longTruncated, noSpill` true; Click 31.2 x4,
  Seattle 30.2 x4; pop-out Click 31.2 and Seattle 30.2 at every level; tray 31.2; no spill
  anywhere. Log `snap-offset-status-bar-probe-r1.out`, PNGs `snap-offset-status-bar-shots-r1/`.
- `scripts/chapter-snap-probe.js` (390x844, 844x390, 1440x900, a real 2000 s mp3): the numbers are
  identical to the build's table (shift buttons 88x44 / 201x44 / 177x36, suggestion 356x44 /
  810x44 / 285x36, 0 under 44 px on both phone viewports, doc scrollWidth = the viewport, notches
  12.1125 % vs 12.113 %, the audition at 243.9 s). Log `snap-offset-status-bar-snap-probe-r1.out`,
  PNGs `snap-offset-status-bar-snap-shots-r1/`.
- The adversary's headless proof for C1-C12 stands (`adv-cssprobe.out`: each one grows or
  restacks the bar, or pushes the play mark off the LCD); the lock now reds every one of them.

### Disclosed (r1 round)
- **The agreement rule's midpoint tolerance** (adversary 5): two boundaries up to 0.6 s apart can
  both agree, and a symmetric +-0.3 s spread reads "line up". Nothing applies without a tap.
- **The shift steps refuse exactly the gap while the other edits allow it** (the spec's wording
  for the steps, the nudge clamp's for the rest): a 1 ms difference at the boundary.
- **The shift row is scrolled away when the editor opens on a chapter** (qa S5, unchanged).

**CSS mutants re-run @e036d390** (after the census hardening, a sandbox from `git archive
e036d390`, log `snap-offset-status-bar-mutants-r1c.out`): B1-B10, B7b, C1-C4, C6-C17 and S28 -
**28 of 28 RED**. C1, C6, C10, C11 and C12 (a later rule repeating `.mms-ipod .ip-status`) now
red in the census as well as in the base-rule test.

## Gate r2 - security-brief (@4b46555d)

**What I could not do (first):** still no Bash, so no `git diff c05c6906 4b46555d`. I used the
same method as r1:
- **Reflog:** `.git/worktrees/agent-a4ecaf0edc36aa1e3/logs/HEAD` now runs c05c6906 -> 3f01b5f3
  (docs) -> dd7cfec4 -> e036d390 -> 4b46555d = HEAD. There is no checkout, reset or merge in
  between, so file mtimes still mean what they meant at r1.
- **Files written since checkout:** sorted by mtime, only `public/css/style.css`,
  `scripts/chapter-snap-probe.js`, `scripts/skin-status-bar-probe.js`, `public/js/common.js`,
  the three new test files and this plan.
- **Files still at checkout time:** all of `lib/media/**` and `lib/music/**`, `server.js`,
  `package.json`, `package-lock.json`, `Dockerfile`, `docker-compose.yml`, `eslint.config.js`,
  every `public/*.html`, `public/filetube-worker.js` and every other `public/js/*.js`.

This is strong evidence but not a byte diff; the Architect should confirm with
`git diff --stat c05c6906 4b46555d`. I also cannot tell from mtimes which of the r1-changed files
(style.css, the probes) the r2 commits touched. I re-read the parts of them that matter, below.

Verified (traced in the code at HEAD):
- **Nothing new is sent to the server.** common.js has the same four `doFetch` calls in the
  editor as at r1: GET state (:13502), POST `/scan` with `'{}'` (:13538), POST `/revert`
  `{version, allowCountChange}` (:13733), and POST save `{ version: state.version, starts: times() }`
  (:13783). The save and revert payloads are unchanged.
- **The new `snapGapBreak`** (:13057) is pure: it takes integer-ms comparisons over its
  arguments, returns null or `{index, end}`, and does no I/O. Reset shift, the per-row Snap and
  Snap all use it only to REFUSE an edit. It can only make the client stricter than the server's
  `validateSnapStarts` (strict order + before the duration), never looser.
- **Microsecond arithmetic** (`micro`, :13302; `applyShift` :13385; `shiftResetTimes` :13307)
  only keeps finite numbers finite: server-seeded times plus integer ms steps. At worst a
  sub-ms start reaches the server's `round3`, which re-validates strict order after rounding. The
  0.1 s client gap makes a rounding collision unreachable, and if one happened the server
  refuses with 400. That is a failed save, not a bad write.
- **Every new or reworded string is set as text.** That covers the `aligned` split note (:13364),
  the "carry no shift" readout (:13324), the Reset and Snap refusals built with `gapText()`
  (:13315/:13316/:13673/:13674), and the readout written only on change (:13342, a
  `textContent !==` compare then `textContent =`). All of it goes through `.textContent` or
  `setStatus` (textContent). These strings contain only numbers, `formatSnapShift` output and
  fixed text; no chapter title or file text reaches them. There is no `innerHTML` anywhere in
  the editor (13005-13835).
- **test/unit/skin-status-bar.test.js** only reads files (`node:fs`, `node:path`,
  `require('../../public/js/music-skins.js')`) and matches regexes. No process spawn, network
  or file writes.
- **The probes are unchanged in every security-relevant line:** a scratch `mkdtemp` DATA_DIR set
  before the server is required, `app.listen(0, '127.0.0.1')`, and Chromium on a loopback
  debugging port. `scripts/` is still not served (`server.js` is unchanged at checkout time and
  serves only `public/`).

Findings: none new. My r1 INFO-1 (the probe's DevTools port on a shared host) and INFO-2 (probe
temp dirs left behind) were declined in the fix record. I agree: dev tools on a single-user box,
advisory only. No CRITICAL, HIGH, MEDIUM or LOW findings.

Gate: APPROVED r2 @4b46555d — security-brief

## Gate r2 - qa (@4b46555d)

A check of the changes since r1 (`git diff c05c6906 4b46555d`: common.js, the three test files, the plan).
Instruments (Node 22.23.1, run by this seat):
- The three touched test files with `FILETUBE_TEST_FFMPEG` set: `tests 34 pass 34 fail 0
  skipped 0`, `real scan: Suggested: shift all by +1.75 s (4 of 4 agree) (applied 1750 ms)`.
- Chapter-snap unit + integration, chapters-editor, chapter-likes, every census, the token /
  overlay locks, music-skin*: `tests 345 pass 345 fail 0 cancelled 0 skipped 0`.
- `npm run test:unit`: `tests 7266 pass 7266 fail 0 cancelled 0 skipped 0`.
- `lint:css` `TOTAL 0`; `lint:overlay` `clean (0 violations)`; eslint on the six JS files
  `6 problems (0 errors, 6 warnings)` (the pre-existing six); `check-markers`: `stale approval
  @c05c6906 ... re-gate` (1 issue, the expected r1 marker).
- Probes on a `git archive 4b46555d` sandbox: skin-status-bar - every SUMMARY true, Click 31.2 x4,
  Seattle 30.2 x4, pop-out 31.2 / 30.2 at every level, tray 31.2, all 72 rows reached, no page
  errors, no sideways scroll; chapter-snap - shift buttons 88x44 / 201x44 / 177x36, suggestion
  356x44 / 810x44 / 285x36, 0 under 44 px on both phone viewports, doc scrollWidth = viewport,
  notches 12.1125 vs 12.113, the watch editor's first note "No consistent offset", Snap all
  still 7 of 7 on the probe fixture. Identical to the r1 numbers.

My r1 findings:
- **W1: fixed as prescribed.** My jsdom case re-run on the r2 sandbox: the head says "2 starts
  look off" / "Snap all (2)" and the note now reads "No whole-track offset: 3 of 5 already line
  up. Fix the others one by one."; the all-agree wording is kept. Bound by the integration test
  "qa W1" (both arms: partial, then after Snap all "5 of 5 agree").
- **S2: fixed as prescribed.** My case (+1 s, snap chapter 2, -1 s) now reads "Shifted -1.0 s on 1
  of 4 chapters (the others carry no shift)"; the existing Snap-all test asserts the new text.
- **S3: fixed, and more widely than I asked** (Reset, the per-row Snap and Snap all all go through
  the new `snapGapBreak`). My r1 case is refused now. The widening has one side effect, finding 1
  below.
- **S4: fixed as prescribed.** Written only on change; the MutationObserver test binds it
  (no write for two same-text re-renders, a write for +1 s).
- **S5: not taken - accepted.** The r1 argument stands: Snap all in the fixed head covers the
  whole-track case, the Music drill opens at the top, and it is disclosed.

Disclosures checked: the midpoint rule (the "+1.0 / +1.6 -> +1.3 s", "-0.3/-0.3/+0.3/+0.3 ->
aligned 4 of 4" examples compute as stated from `snapShiftSuggestion`) and the 1 ms difference
(`snapShiftBlock` refuses `t1 + d <= t0 + gap`, `snapGapBreak` only `< gap`, so a step needs the gap
+ 1 ms where every other edit allows exactly the gap) are both accurate. The removed `agree < 2`
clause really is dead (with `of >= 2`, 60 % forces at least 2). `micro()` and its comment are
correct: a 120.0005 start comes back exactly (bound by "adversary 6").

Findings:

1. **WARNING (new in r2) - Reset shift is refused, with a false reason, on a list whose close
   pair (or near-the-end last chapter) was already in the SOURCE** (common.js:13312
   `shiftResetProblem` passes `changed = every row with a shift`). A shift moves BOTH rows of
   an interior pair by the same amount, so Reset gives that pair back its SOURCE gap. But
   `snapGapBreak` checks every pair with a moved row, so a source pair closer than 0.1 s blocks
   Reset. Verified in jsdom on the r2 sandbox:
   - Source `[0, 60, 60.05, 120]` (duration 300), press +1 s once. Reset is disabled, and
     the reason reads "Resetting would put chapter 3 at or before chapter 2, or within 0.1 s
     of it (a chapter was moved after the shift). Use Undo changes to start over." Nothing was
     moved after the shift. At r1 this Reset worked.
   - Source `[0, 60, 299.95]` (duration 300), press -1 s: Reset is disabled ("... or within
     0.1 s of it"). The +1 s step is disabled too, so only Undo, which also drops any nudges,
     gets back to the source.

   This contradicts the helper's own comment (common.js:13052: "a source list may already hold
   closer pairs; they are not this edit's to refuse") and the design note's intent. Nothing
   normalises source chapters to the gap (`MIN_CHAPTER_GAP_SEC` is used only by the snap
   routes), so an embedded chapter list can reach this state. No data is at risk. The state is
   rare, and for the interior case the inverse step is an exact workaround.

   Prescription: never refuse a Reset for a gap that is no worse than the stored one. Break a pair
   only when its new gap is below `minGapSec` AND below the same pair's `savedStart` gap. Break
   the end only when `duration - last` is below the gap AND below `duration - savedStart(last)`.
   Alternatively, skip a pair whose two rows carry the same shift, since Reset leaves its gap
   unchanged. Bind both scenarios above, and re-run the adversary's W3 cases (they must still
   refuse).
   - Acceptable alternative exit: disclose it in the plan's Disclosed gaps, add a tracker row,
     and correct the reason text so it does not claim "a chapter was moved after the shift"
     when none was. I would accept that as safe to ship.

No CRITICAL. No other new findings. The tree's only change is the plan doc: my section and the
security-brief's r2 section, which was already there uncommitted when I started.

Verdict: CHANGES for finding 1 - a regression this fix round introduced, with a user-facing
reason that is false. Either exit above is a small change, and I will check it as a delta.

Gate: CHANGES r2 @4b46555d — qa

## Gate r2 - adversary (@4b46555d)

A check of the changes since r1 (`git diff c05c6906..4b46555d`: common.js, the three test files,
the plan). Mutants ran only in `git archive 4b46555d` sandboxes in the session scratchpad; after
every mutant the files were byte-compared with their pristine copies (`restore-check identical`).

Instruments:
- Targeted set on the sandbox (unit chapter*, music*, skin*, css*, token*, exec-plans*,
  tech-debt*, player-chapters*, docs*; integration chapter-snap*, chapters-editor, ffmpeg set):
  `tests 884 pass 884 fail 0 cancelled 0 skipped 0`.
- eslint on the four touched js files: `6 problems (0 errors, 6 warnings)`. `lint:css` `TOTAL 0`.
  `lint:overlay` clean.
- `check-markers`: 1 issue, `stale approval @c05c6906` on security-brief's r1 line. That is expected
  in a delta round.
- **Instrument failure, verbatim:** one of my scratch drives (3000 random steps, Reset, then save,
  run in the same file after another drive) ended `not ok ... AssertionError`. Rerun alone, the
  identical sequence passed and saved; I did not find the cause. Its numbers below come from the
  isolated rerun.

### My r1 findings
- **W1 (the CSS lock): fixed for every breaker I named.** C1-C4 and C6-C14 are all RED against
  the rebuilt census. The builder's C15-C17 are RED too. BUT the census still has a hole, see
  new finding 1.
- **W2 (the refused suggestion): fixed as prescribed.** A3, A4, A5 and A6 are RED, and so is the
  double mutant D1 (A3 + A5), which at r1 saved `[0, 0.05, 59.05, 119.05]`.
- **W3 (Reset refusals): fixed.** R1 (the end arm of `snapGapBreak` removed), R14 (Reset's
  changed-row mask set to "nothing") and the equal-pair case are all RED ("adversary W3").
- **S4 (Reset into the gap): fixed in a wider form** (`snapGapBreak` on Reset, the per-row Snap and
  Snap all; R2, R3, R3b, R6, R7 and R10 RED). The wider form brings new finding 2.
- **S5 (the agreement rule):** the midpoint rule is disclosed and its comment is honest. The
  dead clause is removed. A8 is RED.
- **S6 (the half millisecond): fixed.** R9b (back to ms rounding) is RED. See drift below.
- **S7 (the audition): fixed.** A15 is RED.

### New findings

1. **WARNING - the census still misses an ancestor that is not on its CHAIN list, and CSS
   nesting.** `reaches()` needs every rule's ancestor to name a chain token, even when the last
   compound is the title's own class. Each rule below was appended inside
   `@media (max-width:768px)`. Each one keeps the whole skin set GREEN
   (`skin-status-bar` + `music-skins` + `skin-surface` + `skin-scrollbar-hidden`:
   `pass 120 fail 0`). `scripts/skin-status-bar-probe.js` then measures (control: 31.2 x4,
   battery 338,27.6):
   - N1 `#view-root .ip-np{white-space:normal}`: long album **85.8 px, battery y 54.9** (Dean's
     bug, fully back). The panel sits inside `#view-root` (music.html:98/192).
   - N2 `#view-root span{white-space:normal}`: 85.8 px, same.
   - N5 `.mms-ipod{ & .ip-np{white-space:normal} }` (native CSS nesting, effective selector
     `.mms-ipod .ip-np`): 85.8 px, same.
   - N4 `.mms-zune-classic .ip-np{all:revert}`: Seattle long rows **66.6 px**, play mark y 45.9.
   - N3 `.mms-ipod .ip-lcd-in{writing-mode:vertical-rl}` (an ancestor; the value is inherited):
     the bar is 258.5 px at every level.

   Caught (RED): N7 `.ip-lcd *`, N8 `[data-view] .mms-ipod .ip-np`, N9 nested `:is(:where())`, and
   N6 / N10 (any later rule repeating the bar's selector).

   Prescription:
   - A last compound that names the element's own class reaches it whatever its ancestors.
   - An ancestor compound the parser cannot place (an id, `&`, `:scope`) counts as reaching (fail
     closed).
   - Add `all` to the three tables.
   - Add `writing-mode` and `direction` to a check of rules on the chain's ancestors
     (`.ip-lcd*`, `.mms-*`, the panel).
   - Then N1-N5 must go RED.

   The shipped CSS is correct as measured. This is the anti-regression net, and N1 and N2 are the
   plainest way to spell the regression.

2. **WARNING (new in r2; qa found it independently) - Reset is refused, with a false reason, when
   a close pair or a near-the-end last chapter comes from the SOURCE.** A shift moves both rows of
   a pair together, so Reset returns that pair to its source gap. `shiftResetProblem` marks every
   shifted row as "changed", so `snapGapBreak` checks the pair and refuses. Verified in jsdom:
   - Source `[0, 60, 60.05, 120]`, +1 s, a nudge of the last row: Reset is disabled, "Resetting
     would put chapter 3 at or before chapter 2, or within 0.1 s of it (a chapter was moved after
     the shift)". No chapter was moved. A -1 s step still gets back ("No shift"), so the interior
     case has a workaround.
   - Source `[0, 0.05, 60]`, +1 s: Reset is disabled, AND the -1 s step is refused ("Shifting
     earlier would put chapter 2 at or before chapter 1"). The only way back is Undo changes,
     which also throws away the nudge made in between.

   At r1 both Resets worked. The call-site masks are also unbound:
   - R13 (Reset's mask = every row) survives, `pass 78 fail 0`.
   - R15 (Snap all's mask = every row, so an untouched close pair anywhere blocks the snap)
     survives, `pass 78 fail 0`.
   - The unit test binds the helper's "untouched pair" semantics, but not what either caller passes.

   No data is at risk: the server's rules are unchanged, and I found no server-ACCEPTED bad save.
   Prescription (as qa's): break a pair only when its new gap is below the gap AND below the same
   pair's `savedStart` gap. Do the same for the end. Correct the reason text. Bind both
   scenarios above, then R13 and R15 must go RED.

3. **SUGGESTION - `snapGapBreak`'s "end only when the last row moved" is unbound** (R5 survives,
   `pass 78 fail 0`). Under R5, a per-row Snap of a middle chapter is refused whenever the source's
   last chapter already sits within 0.1 s of the end. Add one unit case with
   `changed = [.., true, false]` and the last chapter inside the end gap.

### Destroy-the-data checks (verified holding)
- **Can `snapGapBreak` pass an illegal state?** No. Every edit starts from a strictly increasing
  list. An untouched pair keeps its current gap. A touched pair is checked in whole ms against
  the server gap (equal and out-of-order give a negative or zero diff, so they are refused).
  Chapter 1 never moves. The end is checked whenever the last row moves.
- **Can it refuse a legal state?** Yes: finding 2 (Reset). For the per-row Snap and Snap all I
  tried to build an improving snap that stays inside the gap, and it is not reachable. A server
  `suggest` is at least 0.1 s from its stored start, so moving away from a close neighbour always
  clears the gap.
- **Microsecond arithmetic:**
  - 3000 seeded-random steps (net -8.3 s) with stored starts 60.0004, 120.0005 and 180.123456789,
    then Reset: every row read back as its stored start, and Save and Undo were both DISABLED
    again.
  - Then +1.2 s and Save: the display read `1:01.2, 2:01.2, 3:01.3, 4:01.3` and the server stored
    `[0, 61.2, 121.201, 181.323, 241.3]`, with `snapFrom` holding the ns-precision source times.
  - R8 and R9 (micro rounding dropped) survive but are equivalent, argued: `applyShift` alone
    keeps rows on the microsecond grid, the dirty and Snap-all checks use 0.5 ms, and the server
    rounds to 3 places.
- **The 1 ms rule difference:** measured on chapter 2 at 0.2 s. The -0.1 s STEP is disabled
  (lands exactly on the gap), while the -0.1 s NUDGE lands on 0.1. Both keep at least the gap,
  and it is disclosed. No harm.
- **My r1 kills, re-run:** S3 is RED (4 tests) and S6 is RED.

Blocking: 1 and 2. Neither needs a data-path change for safety. Finding 2 is a regression this
fix round introduced, with a false user-facing reason. Finding 1 is the crown-jewel lock class,
with a concrete breaker that brings back Dean's exact 85.8 px bar. Per Dean's norm, this makes
r3, which is the Architect's to raise with Dean.

Gate: CHANGES r2 @4b46555d — adversary

## r2 fix record (builder, after gate r2 @4b46555d)

Commits (every one through the pre-commit hook, never --no-verify):
- **b6a4c4de** the three r2 verdicts committed as the seats left them (docs-only hook, `tests 1304
  pass 1304 fail 0`).
- **119b4e39** merge of main 57ed7393 (v1.324.0, the pocket quick-scroll release). This was the
  Architect's standing permission, used because a hook forced it: v1.324.0 was tagged after this
  branch was cut, and `release-ledger.test.js` failed with "tags with no ledger entry: 1.324.0".
  There was one conflict, in `docs/exec-plans/tech-debt-tracker.md`, resolved by keeping every
  row in id order: main's edited #258 (this branch never edited it), this branch's #259, then
  main's #263-#266 and #271. style.css, music-skins.js and skin-surface.js merged automatically.
  Hook `tests 7325 pass 7325 fail 0`.
- **8e4f81d2** the fixes and their bindings. Hook `tests 7325 pass 7325 fail 0`.
- **this commit**: this section, the corrected design note, and one unit case (adversary r2 S3).

### Finding -> fix -> test -> mutant

| Finding | Fix (8e4f81d2) | Binding test | Mutants (RED) |
|---|---|---|---|
| **qa 1 = adversary 2** Reset refused, with a false reason, over a close pair or a near-the-end last chapter that came from the SOURCE | `snapGapBreak(next, before, stored, duration, minGap)` refuses a pair only when the edit NARROWS it (closer than `before`) into the gap AND closer than the SAVED list has that pair. The end of the file is handled the same way. `snapShiftBlock` also takes the saved list, so a shift can always go back to what was saved. Every caller passes `before` (the current times) and `stored` (the saved starts). The Reset reason now reads "... or within 0.1 s of it and closer than your saved chapters have them" and no longer claims that a chapter was moved | integration "qa 1 / adversary 2 (r2)": (1) source `[0, 60, 60.05, 120]`, +1 s, a nudge of the last row: Reset works and saves `[0, 60, 60.05, 120.1]`. (2) source `[0, 0.05, 60]`: −0.1 s is still refused at the source; after +1 s, both −1 s and Reset go back. (3) source `[0, 60, 299.95]`: after −1 s, both +1 s and Reset go back. Integration "adversary 2 (r2)": a pair that the nudge clamp squeezed does not block Reset, Snap all or the per-row Snap of a different chapter. The r1 W3 refusals still refuse (past the end, inside the end gap, an equal pair, inside the gap). Unit: the rewritten snapGapBreak case (20 asserts) and "snapShiftBlock with the SAVED list" | T1a, T1a2, T1b, T1g, T1h, T1i, T1j, T1k; the call-site masks **R13** (Reset), **R15** (Snap all) and R16 (per-row Snap), each passing `before = null` (every pair checked), and R17 (Reset with no saved list); A1, A2, A2b, S8-S11, G1, G2 and R3r re-run on the new code |
| **adversary r2 S3** "the end is checked only when the last row moved" was unbound | (test only) | unit: the last chapter is already closer to the end than the saved list and the gap, and an edit to a middle chapter is not refused for it | T1f (RED at the second run; the first case also held under the saved-list rule) |
| **adversary 1** (Architect ruling) the census missed an off-chain ancestor and CSS nesting | skin-status-bar.test.js is now TARGET-based: a rule counts when its FINAL compound can match the title, the bar or the cluster, whatever its ancestors. It uses a real parser (strings skipped; @media / @supports / @container read through; @keyframes / @font-face skipped; native nesting flattened, with `&` replaced by the parent or taken as a descendant of it) that FAILS on an unbalanced block. `all` is forbidden in the three tables. No rule in style.css may set `writing-mode` or `direction`: both are inherited, so a rule on the bar or on ANY ancestor would break it. Attribute selectors other than `[class]` cannot match (the renderer gives the three elements one attribute; the structure test binds it). There are two reviewed exceptions, `.theme-swatch span` (the Setup swatch) and `.section-actions.search-scoped-toolbar > *` (the Home toolbar). A test proves that each is still in style.css and that its ancestor class never appears in any file that builds the panel (music.html, podcasts.html, music.js, podcasts.js, music-skins.js, skin-surface.js, ipod-brick.js) | the 10 tests of skin-status-bar.test.js, including a parser self-test | **N1** `#view-root .ip-np`, **N2** `#view-root span`, **N3** `writing-mode` on `.ip-lcd-in`, N3b `direction:rtl` on `#view-root`, N3c `-webkit-writing-mode` on body, **N4** `all:revert`, **N5** nested `& .ip-np`, N5b nesting without `&`, N6-N9, N11 (`all:unset` on the cluster through an id), N12 (an unbalanced nested block fails the parser), X1 (an exception's ancestor class used on the music page), and C1-C4, C6-C17, B1-B3, B6 re-run |
| **adversary instrument note** 3000 steps, then a Save, failed once in a shared scratch file | not reproduced | 3 runs × 3 drives in the SAME file as every other shift test (3000 seeded-random steps each, Reset, +1.2 s, Save, then compare the stored starts) came out `pass 22 fail 0` three times. A 400-step drive now runs in the file as a permanent guard (integration "adversary r2 (the unexplained failure)"). The one shared-state candidate I found is the adversary's own drive re-using an item another drive had already saved (its version token changes). The committed tests seed a fresh item per test, so they cannot hit that. Recorded, not fixed: no cause in the product code | (a guard, not a mutant) |

### Mutant round @8e4f81d2

Runner: `snap-offset-status-bar-mutants-r2.js` in the session scratchpad. The sandbox was built
from `git archive 8e4f81d2` with `FILETUBE_TEST_FFMPEG` set. Each mutant can apply several edits,
every anchor must match exactly once, and the bytes must change. The file is restored after
each run. Logs: `snap-offset-status-bar-mutants-r2.out` and `-r2b.out`.

- **58 of 58 RED. No survivors.**
- T1f survived the first run: every unit case had the last chapter within the saved distance, so
  the saved-list rule held it anyway. It is bound by this commit's unit case, and is RED at the
  second run with that file copied into the sandbox.

### Instruments (Node 22.23.1)
- Targeted set on the merged tree with ffmpeg: `tests 1019 pass 1019 fail 0 cancelled 0 skipped 0`.
  It covers unit chapter*, music*, skin*, pocket*, player-chapters*, exec-plans*, tech-debt*,
  comment-debt*, release-ledger*, css*, token*, overlay*, shell* and mobile-input*, plus
  integration chapter-snap* and chapters-editor.
- The shift integration file: `pass 19 fail 0` (the REAL-ffmpeg test ran).
- eslint on the touched js: `✖ 6 problems (0 errors, 6 warnings)`. These are the pre-existing six.

### Probes on the merged tree
- `scripts/skin-status-bar-probe.js` (every level reached, with main's new pocket features in):
  every SUMMARY is `equal, battStill, playStill, longTruncated, noSpill` true. Click is 31.2 x4 and
  Seattle 30.2 x4, at 390x844 and 380x700. The pop-out is Click 31.2 and Seattle 30.2 at every
  level; the tray is 31.2. No spill anywhere. Log `snap-offset-status-bar-probe-r2.out`.
- The headless proof for N1-N5 is the adversary's (`adv-r2-cssprobe.out`): N1, N2 and N5 give
  85.8 px, N4 gives 66.6 px and N3 gives 258.5 px. The census now fails on each of them.
- `scripts/chapter-snap-probe.js`: identical to r1. Shift buttons are 88x44 / 201x44 / 177x36 and
  the suggestion 356x44 / 810x44 / 285x36. Nothing is under 44 px on either phone viewport, and
  doc scrollWidth equals the viewport. Notches are 12.1125 % vs 12.113 %; the audition plays at
  243.9 s. Log `snap-offset-status-bar-snap-probe-r2.out`.

### Disclosed (r2 round)
- **Two reviewed census exceptions** (listed above). A new bare-type or universal rule anywhere
  else in style.css that sets a forbidden property on a span or div fails the census until it is
  reviewed.
- **The nudge clamp's squeeze** (pre-existing, `clampSnapNudge`): with less than two gaps of room
  between its neighbours, a nudge lands the row at prev + gap, which can leave it within the gap
  of the next one. It is the only reachable way an edit can leave a pair narrower than both the
  gap and the saved list, and the r2 tests use it to bind the callers' `before`. (Corrected at
  gate r3, adversary S3: with three source starts within 0.1 s the nudge lands PAST the next
  neighbour, and the server refuses that save; see "Gate r3 disclosures" under Disclosed gaps.)

## Gate r3 - security-brief (@0cc5d68f)

**What I could not do (first):** still no Bash, so no `git diff 4b46555d 0cc5d68f` and no
`git diff 119b4e39 8e4f81d2`. The merge also ends the mtime method: 119b4e39 rewrote the files
main changed (`package.json`, `package-lock.json`, `lib/music/routes.js`, `style.css` and others
now sort after the checkout-time files). So I cannot use mtimes to split this branch's changes
from the merge's. I used a different check, described below. It is evidence, not a byte diff.

- **Reflog.** `.git/worktrees/agent-a4ecaf0edc36aa1e3/logs/HEAD` runs 4b46555d -> b6a4c4de
  (r2 verdicts) -> 119b4e39 (merge of main) -> 8e4f81d2 (fix) -> 0cc5d68f = HEAD.
- **Server-side files match main.** The main checkout is now at `ec606e2f`, which contains
  v1.324.0 (main's reflog: release/v1.324.0 merged at 57ed7393, then a fast-forward). It does NOT
  contain this branch: its common.js has no `snapGapBreak` or `snapShiftBlock`. Per-file line
  counts are identical between the worktree and main for all 113 `lib/**/*.js` files (56,500
  lines each, file by file, e.g. `lib/music/routes.js` 595 / 595, `chapterSnap.js` 309,
  `chapterSnapRoutes.js` 186), for `server.js` (7,450 / 7,450) and for `package.json` (34 / 34).
  Any change this branch made to a server file would show up against a main that lacks the
  branch, unless it kept the line count exactly. So I find no server, lib or package change from
  this branch's own commits (line-count evidence, not bytes).
- **The Architect should confirm** with
  `git diff --stat 119b4e39 0cc5d68f -- lib server.js package.json package-lock.json` (the fix
  and docs commits only).

Verified (traced in the code at HEAD):
- **Nothing new is sent to the server.** The editor still makes exactly four requests: GET state
  (common.js:13520), POST `/scan` with `'{}'` (:13556), POST `/revert`
  `{version, allowCountChange}` (:13751), and POST save `{ version: state.version, starts: times() }`
  (:13801). There is no `innerHTML` in the editor range (13005-13880).
- **`snapGapBreak(next, before, stored, duration, minGap)`** (:13068) and
  **`snapShiftBlock(..., stored)`** (:13039) are still pure integer-ms comparisons with no I/O.
  The new `stored` argument comes from `savedTimes()` (:13321), which is `r.savedStart`, the
  server-seeded starts; `before` is the current on-screen times. Both only decide whether the
  client REFUSES an edit.
- **The r2 fix loosens the client check, and the server still covers it.** A pair (or the end)
  that the saved list already has inside the gap is now allowed back. If a source list ever held
  an EQUAL or out-of-order pair, the client would now let an edit keep it. That is not a bypass:
  `validateSnapStarts` (lib/media/chapterSnap.js:190, unchanged) re-checks count, chapter 1,
  strict order after round3 and the last start before the duration, inside the version-checked,
  visibility-re-gated write tick. Such a save fails with a 400; nothing is written. INFO for the
  QA/Adversary seats' correctness lens only, no security impact.
- **Every new or changed string is set as text.** The reworded Reset reasons (:13333, :13334) go
  to `shiftWhy.textContent` (via `reasons`) and to `setStatus` (textContent). The per-row Snap
  refusals (:13690-13692) go to `setStatus`. All are built from numbers, `gapText()` (formatted
  from `state.minGapSec`) and fixed text. No chapter title, suggestion text or file text reaches
  them.
- **The status-bar census test** is a file-reading parser. From the fix record and r2's read of
  its imports: fs/path reads and regexes only, now also reading music.html / podcasts.html /
  music.js / podcasts.js / ipod-brick.js to check that an exception's class is absent. I did not
  re-read every line of the rewritten parser; it is test code with no network, process or write
  surface.
- **Main's v1.324.0 code that came in with the merge** (pocket menus, the recent-listening
  opt-in) is out of scope per the brief and not re-reviewed here.

Findings: none (one INFO above, no security impact). My r1 INFO-1 and INFO-2 still stand, as
declined. No CRITICAL, HIGH, MEDIUM or LOW findings.

Gate: APPROVED r3 @0cc5d68f — security-brief

## Gate r3 - adversary (@0cc5d68f)

A check of the fixes since r2 (`git diff 119b4e39..0cc5d68f`; the v1.324.0 merge was not
re-reviewed beyond the suites below). Mutants ran only in `git archive 0cc5d68f` sandboxes in the
session scratchpad. After every mutant the files were byte-compared with their pristine copies
(`restore-check identical`).

Instruments:
- Targeted set on the sandbox with ffmpeg (unit chapter*, music*, skin*, pocket*, css*, token*,
  exec-plans*, tech-debt*, release-ledger*, player-chapters*, docs*; integration chapter-snap*,
  chapters-editor): `tests 953 pass 953 fail 0 cancelled 0 skipped 0`.
- eslint on the four touched js files: `6 problems (0 errors, 6 warnings)`. `lint:css` `TOTAL 0`.
  `lint:overlay` clean.
- `check-markers`: 2 issues, the stale security-brief approvals @c05c6906 and @4b46555d. That is
  expected in a delta round.
- One instrument note: my own scratch drive file printed both of its `ok` lines, then did not exit
  (an open handle in my harness) and was killed by `timeout` (exit 143). The results below come
  from its printed lines.

### My r2 findings
- **Finding 2 (Reset false refusal): fixed.** All three sources now return, verified in jsdom:
  - `[0, 60, 60.05, 120]`, +1 s, then a nudge: Reset gives "No shift", and so does the −1 s step.
  - `[0, 0.05, 60]`, +1 s: Reset works. The −1 s step is now enabled and goes back to 0:00.1
    with Save off.
  - `[0, 60, 299.95]` (duration 300), −1 s: Reset works, and the +1 s step also brings it back
    to 5:00.0.
- **Finding 1 (census holes): fixed for every breaker I named.** N1-N5 are all RED against the
  target-based census.
- **Finding 3 (end only when the last row moved): bound.** The end-arm mutants M5, M6 and M7 are
  RED.

### New findings

1. **WARNING - the census still fails OPEN on an id inside a functional pseudo, on nested
   parentheses in `:is()`, and on an escaped class.** Three causes:
   - `compoundMatches` returns false as soon as the compound contains `#` anywhere, including
     inside `:not()` / `:is()`.
   - The `:is()` alternatives are cut at the first `)`.
   - `\.[\w-]+` does not read CSS escapes.

   Each rule below was appended inside `@media (max-width:768px)`. Each keeps the skin set GREEN
   (`skin-status-bar` + `music-skins` + `skin-surface` + `skin-scrollbar-hidden`:
   `pass 122 fail 0`). `scripts/skin-status-bar-probe.js` (Click, 390x844; control 31.2 x4,
   battery 338,27.6) then measures every one of them at **85.8 px with the battery at y 54.9**,
   which is Dean's exact bug:
   - H19 `.mms-ipod .ip-np:not(#zz){white-space:normal}` (the ordinary specificity-bump idiom).
   - H19b `.mms-ipod :is(#zz, .ip-np){white-space:normal}`.
   - H10 `.mms-ipod :is(.x, .ip-np:not(.y)){white-space:normal}`.
   - H12 `.mms-ipod .ip\-np{white-space:normal}` (an escaped class, contrived).

   Caught (RED): `:not()` child, `:has()` parent, the `+` sibling onto the cluster, `[class^=]`,
   `@scope`, and `direction` on body.

   Prescription (fail closed, as the file's own header says):
   - Only a `#` OUTSIDE parentheses rules a compound out.
   - Read `:is` / `:where` / `:not` / `:matches` arguments with the paren-aware `splitTop` and
     recurse. A `:not()` never excludes.
   - A compound with a backslash counts as reaching.
   - Add H10, H12, H19 and H19b to the parser self-test, then all four must go RED.

   **This is safe to ship if disclosed:** the shipped CSS is correct as measured on every
   surface, and the gap is only in the regression net. So an acceptable exit is a docs-only
   disclosure in this plan plus a tracker row. Either exit, I re-check it as a delta.

2. **SUGGESTION - two semantics of the new rule are unbound.**
   - M15 (the suggestion's clamp called without the saved list) survives, `pass 82 fail 0`.
     Under M15, a suggestion that would return chapter 2 to a SOURCE-close position is shown
     disabled.
   - M16 (`savedTimes()` returns the SOURCE starts instead of the saved ones) survives,
     `pass 82 fail 0`. Every fixture is a fresh item where saved == source, so "closer than the
     SAVED list" is never told apart from "closer than the source".

   Bind one re-edit case (an item saved once, where saved != source) and one clamped-suggestion
   case on a source-close first pair.

   M8b and M9b (the per-row Snap and Snap all called without `stored`) also survive. I argue them
   equivalent by reachability: a server `suggest` lies strictly between the STORED neighbours
   and at least 0.1 s from its own stored start. So a snap can only move a row away from a
   stored-close neighbour, and it can never narrow a pair back down to its stored width.

3. **SUGGESTION - the disclosed "nudge-clamp squeeze" understates.** With three SOURCE starts
   within 0.1 s, the squeeze puts a chapter PAST its neighbour, not just inside the gap.
   - Verified: source `[0, 60, 60.03, 60.06, 120]`, nudge chapter 3 by +0.1: the list reads
     1:00.0 / 1:00.1 / 1:00.1, and Save is refused by the server ("Chapter 4 must start after
     chapter 3."), with nothing written.
   - With a close PAIR (`[.., 60, 60.03, 60.15, ..]`), the same nudge SAVES `[.., 60, 60.1,
     60.15, ..]`, a 50 ms pair narrower than both the gap and the source. That is the case the
     plan discloses.
   - `clampSnapNudge` is unchanged from the base (pre-existing). Correct the disclosure wording.

### Destroy-the-data checks (verified holding)
- **Widening into an illegal state:** refused whenever the result narrows. A pair can end up
  below both the gap and the saved gap only when it started there, and the only edit that puts
  it there is the pre-existing nudge squeeze (finding 3). Order violations are always narrowing,
  so they are refused (M3 RED). The server's strict-order and end rules are unchanged and backstop
  the squeeze.
- **Ratchet:**
  - Source `[0, 60, 60.3, 120]`: 5 x (chapter 3 −0.1, chapter 2 +0.1), +1 s, chapter 3 −1 s,
    5 x −0.1, then Reset. The pair never went below the 0.1 s gap (0:59.9/1:00.2 → 1:00.1/1:00.2).
    Saved `[0, 60.1, 60.2, 120]`.
  - Each step needs `g < before`, and the refusal floor is min(gap, saved), so a step-by-step
    walk below both is impossible.
- **The callers pass the right `before` / `stored`:** M8, M8c, M9, M9c, M10, M10b and M10c are
  RED (the wrong list, or none). M1-M4 (the rule's three conditions and `<=` on stored) are RED.
  M11, M11b, M12, M13 and M14 (`snapShiftBlock`'s saved list, both ends, the steps and apply)
  are RED.
- **My r1/r2 kills, re-run:** A3 and D1 are RED.

Blocking: finding 1 only (fix it, or disclose it plus a tracker row). The data path is clean at
this sha.

Gate: CHANGES r3 @0cc5d68f — adversary

## Gate r3 - qa (@0cc5d68f)

A check of the changes since r2 (`git diff 4b46555d 0cc5d68f`: common.js, the three test files, the plan; plus the
merge 119b4e39). Instruments (Node 22.23.1, run by this seat):
- The three touched test files with `FILETUBE_TEST_FFMPEG` set: `tests 40 pass 40 fail 0 skipped 0`,
  `real scan: Suggested: shift all by +1.75 s (4 of 4 agree) (applied 1750 ms)`.
- Chapter-snap unit + integration, chapters-editor, chapter-likes, every census, the token /
  overlay locks, music-skin*, music-pocket-menus, pocket-quick-scroll: `tests 434 pass 434 fail 0
  cancelled 0 skipped 0`.
- `npm run test:unit`: `tests 7325 pass 7325 fail 0 cancelled 0 skipped 0`.
- `lint:css` `TOTAL 0`; `lint:overlay` `clean (0 violations)`; eslint on the six JS files `6
  problems (0 errors, 6 warnings)` (the pre-existing six); `check-markers`: 2 issues, the stale
  security-brief approvals @c05c6906 and @4b46555d (expected until the r3 markers bind).
- Probes on a `git archive 0cc5d68f` sandbox (the merged tree, v1.324.0 pocket menus in):
  skin-status-bar-probe - every SUMMARY `equal/battStill/playStill/longTruncated/noSpill` true,
  Click trio 31.2 x4, Seattle 30.2 x4 at 390x844 and 380x700, pop-out 31.2 / 30.2 at every level,
  tray 31.2, all 72 on-page rows `reached`, no page errors, `docScrollWidth == vw`.
  chapter-snap-probe - identical to r1/r2 (88x44 / 201x44 / 177x36, suggestion 356x44 / 810x44 /
  285x36, 0 under 44 px on both phone viewports, notches 12.1125 vs 12.113).
- **The new v1.324.0 levels** (the committed probe does not visit them): a scratch copy of the
  probe in my sandbox (not in the tree) drove the real menus at 390x844. Click, Click Black and
  Click Matte: Settings, About, Extras, Games and Recent Artists all 31.2 px, battery 338,27.6,22,11
  and play mark still. Seattle: Settings, About and the Recent pivot (screenshot checked:
  "recent artists albums", header "music") all 30.2 px. Seattle shows no Games entry, which is
  tracker #265 and expected. Every SUMMARY `equal/battStill/playStill/noSpill` true.

My r2 finding:
- **W1 (Reset refused, with a false reason, on a pair or end that came from the source): fixed,
  in a different way from my prescription, and the change is sound.** The rule is now: refuse only an edit that
  NARROWS a pair into the gap AND below the saved gap. That covers my prescription (never worse
  than stored) and adds "the edit must narrow it", so an untouched pair is never the edit's
  business. My jsdom cases on the r3 sandbox:
  - `[0, 60, 60.05, 120]`, +1 s: Reset is enabled, no reason is shown, and it goes back to
    `0:00.0 1:00.0 1:00.1 2:00.0` with Save off and "No shift".
  - `[0, 60, 299.95]`/300, -1 s: both +1 s and Reset are enabled, and Reset returns to the saved list.
  - `[0, 0.05, 60]`: -0.1 s is refused at the source; after +1 s, -1 s goes back.
  - A snap that narrows the source 50 ms pair to 20 ms is still refused, and a snap that widens
    it (still inside the gap) is allowed and posts `[0, 59.99, 60.05, 120]`.
  - My r1 cases still hold: the partial note, "(the others carry no shift)", and the r1 S3 Reset
    over a snapped row stays refused.

  Every edit's result still passes the server's rule. Each allowed pair is at least the smallest
  of (the gap, its saved gap, its gap before the edit), and each of those is positive. The end
  works the same way.
- **The reason text is corrected** and true: "... or within 0.1 s of it and closer than your saved
  chapters have them". The false "a chapter was moved after the shift" is gone.
- **The target-based census and its two exceptions.** The census now asks only whether a rule's
  final selector part can match the element, so no ancestor excuses a rule. Nesting is flattened,
  vendor spellings are normalised, and an unreadable block fails the test. I read both exceptions:
  - `.theme-swatch span { flex: 1 }` (Setup's swatch) and
    `.section-actions.search-scoped-toolbar > * { flex: 0 0 auto; order: 0 }` (the Home toolbar)
    can only reach a span or child INSIDE those containers.
  - No builder of the panel (music.js, skin-surface.js, music-skins.js, ...) uses those classes,
    and the test binds that. The panel is never inside a swatch or a search toolbar, so both
    exceptions are sound.
  - One imprecision: the test's prose says the ancestor class "never appears where the panel
    lives". The real invariant is "never CONTAINS the panel". In the SPA the music view can load
    into the setup.html shell, but the swatch is still never its ancestor. This does not change
    the result.
- **The merge (119b4e39)** changes nothing on main's side except this branch's own nine files. The
  tracker at HEAD is main's 241 rows plus #259 (242 rows, none missing, none duplicated). #258 is
  main's edited text, and #263-#266 and #271 are kept.

Findings:

1. **SUGGESTION - three comments still state the r1/r2 gap rule, which r3 relaxed.**
   - common.js:13270 (snapAllPlan's header: "each snapped time must stay at least the minimum gap
     inside the CURRENT neighbours").
   - :13284 (the inline "At least the server's minimum gap from the CURRENT neighbours").
   - :13327-13329 (shiftResetProblem: "refused when a row it moves would land ... closer than the
     server's minimum gap").

   None mentions the new saved-list and narrowing conditions. Verified: a snap from 60 to 59.99
   beside a source chapter at 60.05 is allowed and saved 60 ms apart. The code is right, and
   `snapGapBreak`'s own comment states the rule correctly; these three lines describe a stricter
   invariant than the code keeps. A maintainer who trusts them would "fix" the code back to the
   r2 behavior. Fix: reword each as "never narrows a pair into the gap below its saved width (see
   snapGapBreak)". Comment-only; goes to the tracker with the other r3 suggestions.
2. **SUGGESTION - the status-bar probe's SUMMARY does not fold in `reached`**
   (scripts/skin-status-bar-probe.js: `measure` returns the state without `reached`, and SUMMARY
   never checks it). A level that silently fails to open (a renamed row) would keep the last
   title and still read `equal: true`. I checked `reached` on every row by hand this round (all
   true). Fix: return the merged object and add `reachedAll` to SUMMARY.

No CRITICAL or WARNING. Security: unchanged from r1/r2. The new strings are fixed text plus
`gapText()` (a number), all set by `textContent`, and nothing new is sent to the server.

Verdict: APPROVED. My r1 and r2 findings are all resolved, the new rule is sound and bound
(58 of 58 mutants RED per the record, and my own cases agree). Both suggestions are comment- or
tool-only, and I would ship them disclosed via the tracker.

Gate: APPROVED r3 @0cc5d68f — qa
