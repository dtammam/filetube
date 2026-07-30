# Tokens Tier 3 Step 3 - consolidation batches 3a-3g (exec plan)

STATUS: **GATE HOLDS.** Zero declaration edits of any kind (including
certified-zero-delta B1 adoptions) until Dean's baseline confirmation
message arrives (paths/date/device/pre-existing anomalies). This plan,
the ledger, and the tooling exist so that message turns Step 3 into pure
execution. Execution happens on a FRESH branch off merged main.

## Provenance of the batch letters (honest reconstruction note)

The original 3a-3g assignment lived in a session that has since been
compacted; three anchors survive in repo artifacts (tools/capture/
scenes.js manual-scene notes): **3a carries the toast padding 18->16,
3c carries the scrim consolidation (.85->.8 toast, .75->.8 resume),
3d carries the elevation shadows (.5/.6->.45)**. The letter map below
honors those anchors and re-pins the rest; THIS document is now the
authoritative assignment. One census discrepancy surfaced during
reconstruction is flagged as Open Question 1 (radius) rather than
silently resolved.

## Standing rulings this plan executes (do not relitigate)

- Stop Point A (recorded in design-token-phase1-verification.md):
  Batch A = all 26 flagged offsets EXEMPT as positional geometry.
  Batch B1 = member+keyword/env mixed shorthands adopt their scale
  members in place, differ-certified zero-delta. Batch B2 = drift
  members consolidate with ledger entries, 28->24 default, per-site
  rejection flips (e.g. 28->32) at Stop B without reopening batches.
  Batch C = exempt .art-play-glyph::before, .related-title max-height,
  .transcode-spinner; ADOPT --size-control for .ptr-indicator.
- cc-overlay text background rgba(0,0,0,0.85) is PROTECTED forever
  (amendment c). It appears in no batch.
- Amendment (b): zero radius consumer changes until per-era screenshots
  exist and each surface is individually approved.
- Z re-ladder is TIER 4, gated on z-ladder-coopen-enumeration.md plus
  baselines - its 17 sites are census-only here.
- JS-metric scope (post-Tier-2 ruling 1): cssText / el.style /
  setProperty surfaces are in scope; player.js positional excluded.

## The consolidation rule (one rule, every batch)

Default mapping = NEAREST scale member; ties round DOWN. This single
rule reproduces every ruling already anchored: 18->16, 28->24 (tie),
7->6 (tie), 9->8 (tie), 14->12 (tie), 30->32 (strictly nearest);
scrims .5->.55, .6->.55, .75->.8, .85->.8; shadows alpha .5/.6->.45;
motion 0.2s->0.15s (tie, see Open Question 2), 0.3s->0.25s,
0.08/0.1/0.12s->0.15s; line-height 1.3/1.35->1.25, 1.4->1.5. Every
individual mapping is enumerated per-site in the ledger regardless -
the rule predicts, the ledger DECIDES, Stop B approves.

## Batch letter map

Row counts are the LEDGER's (census complete, ledger-check CLEAN):

| commit | batch | scope | rows | visual delta |
|---|---|---|---|---|
| 3a | B2 spacing drift | drift values -> nearest member (25 changes + 1 hold); plus the offset `token-exempt` annotations (49 rows, OQ4) | 26+49 | YES - enumerated |
| 3b | B1 mixed shorthands + exact adoptions | members adopt in place incl. the gap declarations Tier 2 skipped wholesale; plus .ptr-indicator --size-control (extra-census) | 26 | none (differ must report EQUIVALENT) |
| 3c | scrims + overlay chrome | drift alphas -> --scrim/--scrim-heavy (12 + 5 holds, OQ5), the .skip-btn:hover exact adoption, 11 zero-delta --on-overlay adoptions | 29 | YES - enumerated |
| 3d | shadow elevation | 5 sites -> --shadow-modal (notif-panel alpha 0.25->0.45 is the visible risk); 1 no-action | 6 | YES - enumerated |
| 3e | motion | 15 sites -> --dur-fast/--dur-slow + 1 hold (OQ2 covers the eleven-site 0.2s cluster); ease-out/linear easings STAY literal - no token covers them | 17 | timing feel only - invisible to frozen captures |
| 3f | JS-surface adoptions | 24 sites in stats/watch/setup cssText + inline styles; one visible delta (stats 14->12) | 24 | one enumerated |
| 3g | line-height band | 3 drift + 6 exact + 2 holds (OQ6) | 11 | YES - enumerated |

Radius occupies NO letter (Open Question 1). If Dean rules radius into
Step 3, it becomes 3h rather than displacing a pinned letter. The
remaining 149 ledger rows are the no-action census (Tier 4 residue,
protected, geometry, layout constants) - every linter site appears
exactly once, which is what lets ledger-check demand a bijection.

## The ledger (the Step 3 contract data)

`docs/exec-plans/active/tokens-tier3-step3-ledger.md` - a COMPLETE
census: every site `npm run lint:css` reports appears in exactly one
row (action batches AND no-action buckets), with the declaration text
byte-exact as the linter sees it. Bound to reality by
`npm run ledger:check` (scripts/ledger-check.js, fixture-tested +
mutation-verified): any tree change that moves, edits, or adds a
governed declaration turns the checker red. Deliberately NOT in
`npm test` - drift blocks STEP 3, not unrelated releases.

## Execution protocol (when the gate opens)

1. Fresh branch off main. Run `npm run ledger:check` - must be CLEAN
   before anything else; if red, re-verify the affected rows first.
2. One commit per batch, 3a-3g order. Per commit: apply ONLY that
   batch's ledger rows; run scripts/css-equivalence-diff.js between the
   commit's parent and HEAD - the delta enumeration must match the
   batch ledger EXACTLY (zero-delta batches must report EQUIVALENT
   across all 9 era x mode contexts); run `npm run ledger:check`
   against the updated ledger (adopted rows move to a "done" marker);
   full unit suite green.
3. After 3g: full-span differ run, both-Node full suites, assemble the
   Stop B packet (below), STOP for Dean's review.
4. Rejections at Stop B flip per-site (ledger row edit + single-site
   commit), never by reopening a batch.

## Stop B review packet (skeleton - assembled after 3g)

Per affected scene: the batch commits that touch it and what to look
for. LEDGER-TOUCHED manual scenes (Dean's before-shots are the
gate-blockers) - VALUES CORRECTED during ledger authoring against
style.css: **13-toast** (3a padding 18->16 ONLY - the toast has NO
scrim; its background is themed var(--bg-sidebar)), **04-resume**
(3c .85->.8, not the .75 previously claimed), **10-audio-expanded**
(3d elevation .5/.6->.45). Automated scenes get before/after capture
runs + compare.js report ranked by magnitude; the coverage audit added
scenes 25-login and 26-playlists-sheet for ledgered surfaces that had
none. Transient states no scene can hold (skeleton rows, busy
spinners, speed-badge press, fullscreen controls, dock close,
music-eq playing wash, shortcuts modal, chapters menu without a
chaptered fixture) are enumerated in their ledger rows as "on-device
judgment" - Dean approves those deltas live at Stop B rather than by
pixel compare. Standing what-to-look-for flags: cc-adjacent scrims
(the protected background must be untouched - witness shot), any
shrunk touch target (3a reduces paddings - every such surface is
called out in its ledger row), the notif-panel shadow near-doubling
(3d), the 0.2s->0.15s timing feel (3e).

## Open questions for Dean (answer any time before the gate opens)

1. **Radius drift band (3/6/8/14/27px, 27 sites total in category).**
   The Tier 2 census listed it under Tier 3, but no radius scale tokens
   exist (only --radius-full) and amendment (b) defers all radius
   consumer changes behind per-era screenshots with per-surface
   approval. RECOMMENDATION: move the whole radius category to Tier 4
   alongside R7 (where radius tokens can be designed properly);
   scene 24-r7-radii already baselines it. Alternative: rule it in as
   3h with values-only consolidation at Stop B.
2. **The 0.2s motion cluster (13 sites).** 0.2s is a tie between
   --dur-fast 0.15s and --dur-slow 0.25s. The tie-down rule says 0.15s
   (snappier). RECOMMENDATION: 0.15s default with per-site flips at
   Stop B; the ledger marks all 13 as the judgment cluster.
3. **Letter map confirmation.** Given the reconstruction note above,
   confirm the batch letter map (or reassign - only 3a/3c/3d are
   anchored by repo artifacts).
4. **Offset exemptions: 49 found vs 26 ruled.** Stop A exempted "all 26
   flagged offsets"; the full census finds 49 offset-property sites -
   the extra 23 are the same class, only MORE structural (calc chains,
   56px header mirrors) and were simply never flagged for a ruling.
   RECOMMENDATION: exempt all 49 under the Batch A rationale; the annex
   table enumerates them.
5. **Five scrim holds.** (a) .duration-badge 0.85 sits over arbitrary
   thumbnail art - the same legibility argument as the protected cc
   floor; ratify 0.85->0.8 or extend the cc carve-out. (b) hard-delete
   backdrop 0.65 - non-enumerated alpha between both tokens; heavier
   dim on the destructive modal may be intentional (recommend keep ->
   exempt, or 0.55 if uniformity wins). (c)+(d) the two book
   progress-track 0.5 washes - tracks, not scrims; the video
   counterpart uses white 0.3 (recommend exempt as component art).
   (e) .music-eq 0.45 wash - non-enumerated; darkening tiny playing-art
   is visible (recommend exempt).
6. **Two line-height holds, both recommend EXEMPT.** body 1.4 (global
   base - deliberate site-wide tuning; a change reflows everything) and
   .cc-overlay-text 1.35 (caption legibility surface adjacent to the
   protected background).
7. **NEW phantom-token family: --thumbnail-bg.** Defined nowhere,
   consumed at 6 sites via var(--thumbnail-bg, #222) - exactly the
   --accent class. Needs a Tier 4 disposition (define it, or collapse
   to a real token/literal); also 13 DEAD var() fallbacks on
   --border-color/--card-bg/--bg-color (all actually defined
   everywhere, so the literals never paint) are Tier 4 fallback
   cleanup. Recorded in the Tier 4 design plan.
8. **Comment-accuracy finding (fix rides 3c).** The cc-overlay
   amendment comment in style.css (and the v1.1 contract) says the
   protected background is rgba(0,0,0,0.85); the LIVE value is
   rgba(0,0,0,0.72). The protection is unaffected; the documented
   value is stale and gets corrected in the 3c commit, not before (the
   stand-down covers style.css entirely).
