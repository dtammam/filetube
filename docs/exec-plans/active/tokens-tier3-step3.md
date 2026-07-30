# Tokens Tier 3 Step 3 - consolidation batches (exec plan, rulings applied)

STATUS: **GATE HOLDS.** Zero declaration edits of any kind until Dean's
baseline confirmation message arrives (paths/date/device/pre-existing
anomalies). All design questions are RESOLVED (rulings below) - that
message is now the ONLY thing between this plan and execution, which
happens on a FRESH branch off merged main.

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

1. Radius drift: **RESTORED into Step 3 as 3g** (Q1 "restore",
   superseding the same-morning Tier-4 answer given against the
   incomplete reconstruction). 6/8/14px -> a NEW token
   `--radius-lg: 12px` (the 39th contract name, era-invariant, defined
   in the 3g commit); 3px -> 2/4 per-site. R7's era-varying raw 2/4px
   sites remain Tier 4 untouched, per the original.
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
| 3a | Spacing drift (R1+R2) | drift -> nearest member; the mixed-shorthand members consolidate here too (they EXECUTE in the opener; they are LEDGERED under 3a per the original "consolidate here too") | 52 in the 3a section (26 delta + 25 zero-delta + 1 ruled exempt) + the 49-row annex = 101 ledgered |
| 3b | Control sizing (R3) | 40 -> --size-touch(44)/--size-control(36) per-site; 30/34 -> --size-control-sm(32). NO ledger rows - width/height are ungoverned; the sweep is DONE (table below). | 0 (extra-census, table below) |
| 3c | Scrims + on-overlay chrome | 13 drift + 1 exact + 11 zero-delta adoptions + 4 ruled exempts; cc comment fix (ruling 8) | 29 |
| 3d | Shadow elevation | 5 -> --shadow-modal (notif-panel 0.25->0.45 is the visible risk) + 1 no-action | 6 |
| 3e | Motion | 16 -> --dur-fast/--dur-slow per rulings; 1 ruled exempt; ease-out/linear stay literal | 17 |
| 3f | Line-height | 3 drift -> --lh-tight + 6 exact adoptions + 2 ruled exempts | 11 |
| 3g | Radius drift (R8, restored) | 7 sites -> --radius-lg (NEW token, defined here); 3 sites 3px -> 2/4 per-site | 10 |
| 3h | JS surfaces | 24 adoptions (one visible delta: stats 14->12) | 24 |

Census remainder: 100 no-action census rows (the prior 110 minus the
10 radius rows restored to 3g; the 9 ruled-exempt rows were already
inside batch sections and move nothing - gate finding, second
correction of this arithmetic). The ledger's totals table is the
authority; ledger-check enforces the 298-row bijection either way.

## 3b site table (R3 sweep DONE 2026-07-30; `R3` prefix keeps these out of ledger-check's bijection)

| site | selector | current | proposed | delta | notes |
|---|---|---|---|---|---|
| R3 style.css:893 | #view-mode-btn | min-width: 40px | min-width: var(--size-touch) | 40->44 | R3's touch-improve case; header width budget is the Stop B judgment |
| R3 style.css:4316 | #sort-select-btn, #shuffle-again-btn, #rescan-library-btn (mobile) | min-width: 40px | EXEMPT | - | RECOMMEND EXEMPT: the comment above the rule documents 44px CAUSING the v1.50.4 mobile overflow ("mangled" row) - 40px IS the fix; re-widening re-breaks it |
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
3. One commit per batch, 3a-3h order (3b's sweep produces its site
   table before its commit; --radius-lg defined in 3g). Per commit:
   apply only that batch's rows; differ delta-enumeration must match
   the batch ledger exactly; `npm run ledger:check` green against the
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

## Contract note

`--radius-lg: 12px` joins the token contract as name 39 (ruling 1),
defined in the 3g commit, era-invariant (every 3g site is outside
era-scoped rules by linter construction - the original plan's
era-invariance guard holds). Recorded here until the audit v1.1 doc
gains its Step 3 addendum at execution time.
