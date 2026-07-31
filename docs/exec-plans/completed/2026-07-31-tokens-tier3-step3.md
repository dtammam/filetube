# Tokens Tier 3 Step 3 - consolidation batches (exec plan, rulings applied)

CLOSED: **Dean's on-device pass, 2026-07-31, v1.58.0: "it's all
excellent. nothing wrong."** - the full probe list (era radius sweep,
timing feel, the autoplay knob coupling, scrims, shadows, spacing,
clamps, control sizes) passed with zero rejections. Stop B's purpose
was Dean's approval of the visible deltas; he gave it directly
on-device, superseding the formal pixel-compare path. The frozen
v1.57.0 image + pinned capture profile remain available as the
BEFORE-baseline for Tier 4's per-era work, where screenshots are still
the gate (amendment b, ghost-red, mono-font).

STATUS: **EXECUTING (Dean's ruling, 2026-07-31: "stop the capture
chase... proceed with enforcing the token changes in the meantime").**
The original gate - baseline before-shots preceding any declaration
edit - is SUPERSEDED by a stronger equivalent: the before-state is
FROZEN in the immutable v1.57.0 image (sha256:4d11c32f..., the pinned
beta target) plus harness >= the CSP-profile fix, so before-shots
remain capturable at ANY time, independent of Step 3 landing on main.
Determinism is field-proven (65/65 captured scenes 0-diff); the 24
formerly-blocked scenes are restored by the pinned capture profile
(ytdlp ON + FILETUBE_READONLY=1 - see tools/capture/README.md).
Stop B still requires the before/after comparison; the ledger's
per-commit differ discipline is unchanged. Dean's manual gate-blocker
shots (13-toast, 04-resume, 10-audio-expanded) are still owed before
Stop B closes - now against the frozen image, not before execution.

## Provenance: the ORIGINAL letters, recovered

The first version of this plan re-pinned the 3a-3g letters from three
surviving anchors after the originating session was compacted. Dean
ruled "review old context - don't guess": the original enumeration was
then RECOVERED VERBATIM from the prior session's transcript
(~/.claude/projects/.../a56a0487-*.jsonl). This plan now carries the
recovered letters; the interim re-pinned map is void. Recovery also
surfaced: A+B1 zero-delta work was an OPENER, not a lettered batch;
3b was control sizing (R3), which the interim map had dropped entirely
(width/height are ungoverned, so the linter census never saw it); the
original audit's toast-scrim/.75-resume beliefs were wrong at source
(scenes.js corrections stand); and the JS-surface scope postdates the
original plan, so it takes the new letter 3h.

## Rulings received (Dean, 2026-07-30 - all questions CLOSED)

1. Radius drift - **RULED B (Dean, 2026-07-30, after the gate CRITICAL
   corrected the premise)**: the seven 6/8/14px sites STAY in Step 3
   and adopt the EXISTING era-varying `--radius-lg` (:root/2021 12px,
   2005 0, 2009/2014 2px; live video-frame/dock consumers), with
   per-era deltas enumerated per ledger row. This is the one
   deliberately era-VARYING batch - a ruled exception to the recovered
   original's era-invariance guard, chosen with the era values on the
   table. Witnesses: the P1 scenes plus new era scenes 24b-24e
   (2005/2009); speed-badge and artist-card era states are on-device
   judgment. The 3px -> 2/4 per-site literal trio is era-invariant and
   unchanged. R7's raw 2/4px sites remain Tier 4. History for the
   audit trail: Q1 "restore" was given against a false "new
   era-invariant token" premise; the gate caught it; B is the informed
   re-ruling.
2. Motion: 0.2s cluster (13 declarations / 11 sites) -> --dur-fast
   0.15s ("faster"); micro-band 0.08-0.12 ALSO -> 0.15 (Q2, overriding
   the original 0.1s-literal prescription). Per-site flips stay open
   at Stop B.
3. Letter map: recovered original (above) - confirmed by recovery
   rather than memory.
4. Offsets: all 49 exempt (extends the Stop A ruling's 26 to the 23
   structural others of the same class).
5. Scrims: (a) duration-badge 0.85->0.8 APPROVED; (b) hard-delete 0.65,
   (c)(d) book progress tracks, (e) music-eq wash all EXEMPT (annotated
   in 3c).
6. Line-height: body 1.4 and cc-overlay 1.35 both EXEMPT (annotated in
   3f).
7. --thumbnail-bg phantom family: DEFINE the token (Tier 4 work; unlike
   --accent there is no era-value trap). Dead var() fallbacks: Tier 4
   cleanup.
8. cc amendment comment says 0.85, live value is 0.72: FIX THE COMMENT,
   rides the 3c commit.
9. .pp-icon-pause optical margin and .ptr-indicator 0.08s gesture
   tracking: both EXEMPT (annotated in 3a / 3e).

## Standing rulings this plan executes (unchanged)

- Stop A: Batch A offsets exempt; B1 members adopt in place zero-delta;
  B2 drift consolidates with ledgers, 28->24 default, per-site Stop B
  flips; Batch C three glyph exempts + .ptr-indicator adopts
  --size-control.
- cc-overlay text background is PROTECTED forever (amendment c; its
  true value is 0.72, see ruling 8). Z re-ladder is Tier 4 (co-open
  enumeration doc). JS-metric v5 scope per the post-Tier-2 ruling.
- Consolidation rule everywhere: nearest scale member, ties round down;
  the ledger enumerates every site regardless - the rule predicts, the
  ledger decides, Stop B approves.

## Batch map (recovered original + 3h; ledger row counts)

| commit | batch | scope | ledger rows |
|---|---|---|---|
| opener | A + B1 + exact adoptions | 49 offset token-exempt annotations + 26 zero-delta member/gap adoptions (differ must report EQUIVALENT) | 75 (49 annex + 26 of 3a's zero-delta rows) |
| 3a | Spacing drift (R1+R2) | drift -> nearest member; the mixed-shorthand members consolidate here too (they EXECUTE in the opener; they are LEDGERED under 3a per the original "consolidate here too") | 52 in the 3a section (25 delta + 26 zero-delta + 1 ruled exempt) + the 49-row annex = 101 ledgered |
| 3b | Control sizing (R3) | 40 -> --size-touch(44)/--size-control(36) per-site; 30/34 -> --size-control-sm(32). NO ledger rows - width/height are ungoverned; the sweep is DONE (table below). | 0 (extra-census, table below) |
| 3c | Scrims + on-overlay chrome | 13 drift + 1 exact + 11 zero-delta adoptions + 4 ruled exempts; cc comment fix (ruling 8) | 29 |
| 3d | Shadow elevation | 5 -> --shadow-modal (notif-panel 0.25->0.45 is the visible risk) + 1 no-action | 6 |
| 3e | Motion | 16 -> --dur-fast/--dur-slow per rulings; 1 ruled exempt; ease-out/linear stay literal | 17 |
| 3f | Line-height | 3 drift -> --lh-tight + 6 exact adoptions + 2 ruled exempts | 11 |
| 3g | Radius drift (R8, ruling B) | 7 sites adopt era-varying --radius-lg with per-era deltas (12px 2021 / 0 2005 / 2px 2009+2014); 3 sites 3px -> 2/4 per-site (era-invariant) | 10 |
| 3h | JS surfaces | 24 adoptions (one visible delta: stats 14->12) | 24 |

Census remainder: 100 no-action census rows (the prior 110 minus the
10 radius rows restored to 3g; the ruled-exempt rows were already
inside batch sections and move nothing - and there are 8 of them, not
9: the ninth ex-hold, duration-badge 1123, was APPROVED as drift.
Gate finding, second correction of this arithmetic). The ledger's
totals table is the authority; ledger-check enforces the 298-row
bijection either way.

## 3b site table (R3 sweep DONE 2026-07-30; batch EXECUTED 2026-07-31 - the differ enumerated exactly the 6 pairs below incl. the coupled knob travel; the two EXEMPT rows stand per their receipts, Stop B ratifies. `R3` prefix keeps these out of ledger-check's bijection)

| site | selector | current | proposed | delta | notes |
|---|---|---|---|---|---|
| R3 style.css:893 | #view-mode-btn | min-width: 40px | min-width: var(--size-touch) | 40->44 | R3's touch-improve case; header width budget is the Stop B judgment |
| R3 style.css:4316 | #sort-select-btn, #shuffle-again-btn, #rescan-library-btn (mobile) | min-width: 40px | EXEMPT | - | RECOMMEND EXEMPT: the comment above the rule documents 44px CAUSING the v1.45.3 mobile overflow ("mangled" row; the adjacent v1.50.4 comment is a different fix) - 40px IS the fix; re-widening re-breaks it |
| R3 style.css:2090 | .watch-autoplay-switch | width: 34px | width: var(--size-control-sm) | 34->32 | COUPLED: the checked knob is hardcoded translateX(16px) at line 2130 - must become 14px in the SAME edit or the ON knob sits 2px short of flush |
| R3 style.css:4573-4574 | .pc-btn | width/height: 30px | var(--size-control-sm) | 30->32 | player control buttons - R3's 30->32 case; fits inside the 40px strip untouched |
| R3 style.css:5724 | #speed-btn | min-width: 30px | min-width: var(--size-control-sm) | 30->32 | pairs with .pc-btn |
| R3 style.css:4548/5229/5671/7090 | .player-controls height/min-height | 40px | EXEMPT | - | RECOMMEND EXEMPT: the strip height is a layout SYSTEM paired with the reserve constants (5104=40, 5143=80=2x40, 5146=44 mobile, 5172=26 dock) - resizing it is a geometry wave, not a control resize; revisit as its own item if ever |

Out of scope (art/media geometry, not controls): 1838 .audio-vinyl::after
30px, 5842 .sub-sheet-avatar 40px, 8218 .notif-row-thumb 40px. Honesty
note: the original audit fragment said "34px (x2) -> 32"; today's tree
has exactly ONE 34px site (2090) across style.css, subscriptions.html
and non-player JS - the second predates Tier 2 or lived in excluded
player.js positional geometry.

## Execution protocol (when the gate opens)

1. Fresh branch off main; `npm run ledger:check` must be CLEAN first.
2. Opener commit (A annotations + B1/exact zero-delta adoptions) -
   differ must report EQUIVALENT across all 9 era x mode contexts.
3. One commit per batch, 3a-3h order (3b's table is above; 3g defines
   nothing - --radius-lg already exists). Per commit: apply only that
   batch's rows; differ delta-enumeration must match the batch ledger
   exactly - for 3g that means PER-CONTEXT: the 2005/2009/2014
   contexts must show exactly the per-era resolutions the 3g rows
   enumerate, not the 2021 values; `npm run ledger:check` green against the
   updated ledger; full unit suite green. Done-marking: strike
   fully-tokenized rows; REPLACE the six PARTIAL ADOPTION rows (1516,
   2308, 7246 keep a raw member; 5231, 5673, 6917 keep an env(...,0px)
   fallback the linter still flags) with their residual declarations.
4. After 3h: full-span differ, both-Node full suites, assemble the
   Stop B packet, STOP for Dean.
5. Stop B rejections flip per-site (ledger row edit + single-site
   commit), never by reopening a batch.

## Stop B review packet (skeleton - assembled after 3h)

Gate-blocking manual before-shots (values source-verified):
**13-toast** (3a padding 18->16 only - no scrim exists), **04-resume**
(3c .85->.8), **10-audio-expanded** (3d shadows .5/.6->.45).
Automated scenes: before/after capture runs + compare.js ranked
report; coverage-audit scenes 25-login, 26-playlists-sheet,
23d-ghost-red-reader are in the manifest. Transient states with no
scene (skeleton rows, busy spinner, speed-badge press, fullscreen
controls, dock close, shortcuts modal, chapters menu without a
chaptered fixture - proposed scene id 27) are enumerated in their
ledger rows as on-device judgment. What-to-look-for flags: the
protected cc background untouched (witness shot); any shrunk touch
target from 3a paddings AND every 3b control-size change (34->32
shrinks two book-shelf chips; 40->44 grows player-adjacent targets);
the **8->12 album rounding** (3g - the original packet's flag,
restored); reloc panel 6->12 rounding; notif-panel shadow
near-doubling (3d); the 0.2s->0.15s timing feel (3e).

## Execution correction record (Step 3 gate findings, 2026-07-31)

- BURN-DOWN CHAIN, corrected: 298 -> 228 (opener) -> 203 (3a) -> 174
  (3c) -> 169 (3d) -> 152 (3e) -> 141 (3f) -> **134 (3g)** -> 110 (3h).
  3g's COMMIT MESSAGE claims "141 -> 131" - that figure was written
  expecting -10 before ledger-check taught the -7 reality: the three
  per-site radius literals (2/4px) REMAIN counted as new R7 raw
  population. The message is wrong by three; this record is the truth
  (pushed history stays immutable; corrections ride the record, per the
  linter-count precedent).
- Census prose: the no-action census SECTION holds exactly 100 rows
  (mechanical count); a 101 figure counts 3d's SHADOW-OTHER row, which
  renders inside the 3d section.
- Opener commit subject lists ".ptr-indicator" among its work: the
  EDIT was executed in the opener; the RULING it implements is Stop A
  Batch C (as the in-CSS comment says). Same change, two documents
  naming different aspects - recorded so nobody hunts a phantom
  double-edit.

## Contract note (corrected by the gate)

NO new token joins the contract: `--radius-lg` already exists in the
era layer (:root 12px; 2005 -> 0; 2009/2014 -> 2px) with live
consumers. The earlier claim that it would be "name 39, era-invariant"
was false - and its supporting argument ("every 3g site is outside
era-scoped rules") checked the consuming rule's location when what
matters is the token VALUE's era-scoping. Recorded as a standing
lesson: a token adoption's era-invariance is a property of the token's
definitions, not of the consumer's position in the file.
