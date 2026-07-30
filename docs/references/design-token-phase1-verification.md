# Design tokens Phase 1 - verification record

Branch tokens/phase-1, 2026-07-30. Commits: reconciliation (869a28d),
token layer (fedb28d), exemptions (a15ddca), report-only lint (ef60bbf),
Tier 1 (38b6215), this record.

## Screenshot regression: NOT POSSIBLE in this environment - substituted

The Phase 1 spec requires before/after screenshots (4 eras x light/dark,
desktop + 768px) with pixel-diff. **No browser exists in the dev
environment** (no chromium/firefox binary; verified before starting), so
no screenshots were captured. Per the halt-and-report rule this is
reported, not rationalized around; Dean's device pass or any machine with
a browser can still capture them from the two trees (baseline = commit
ef60bbf, after = 38b6215).

Substitute evidence, STRONGER than pixel-diff for the CSS half (it proves
equivalence at every viewport/era/mode simultaneously, not at sampled
screenshots):

- **Computed-equivalence diff** (scratchpad script `equivalence.py`,
  regenerable): parse both trees' style.css into declaration streams,
  resolve every Tier-1 substitution back to its literal (var(--fw-bold)
  and `bold` -> 700, --fw-semibold -> 600, --fw-black -> 900, the four
  --fs-* substitutions, 3-digit hex -> 6-digit), strip comments and the
  known additive blocks. Result: **EQUIVALENT - 3,155 declarations
  byte-identical**; subscriptions.html (style block + inline attrs)
  EQUIVALENT; each of the three new classes byte-matches the JS inline
  styles it replaced.
- **Specificity audit** for the three JS class moves (inline styles used
  to win everything): no later or higher-specificity rule sets the moved
  properties for those elements; `.btn-sm` carries no declarations
  anywhere (vestigial).
- **Full test suite**: 5192/5192 on Node v22.23.1 and v24.14.0 at
  38b6215 (one deliberate lock update: pinned-avatar-css asserted the
  SPELLING `font-weight: bold`, now asserts `var(--fw-bold)`).

Two verifier defects were found and fixed DURING verification (the
substring `bold` matching inside `semibold`; a one-line-rule skip latch
eating the following rule) - both produced false DIFFERs, both fixed
before the EQUIVALENT verdict above; no real delta was ever observed.

KNOWN VERIFIER BLIND SPOTS (slim-gate W1, proven by the reviewer via
mutation): the script skips ALL custom-property DEFINITIONS (a mutated
token value passes silently - its var() table is hard-coded, decoupled
from :root) and never compares SELECTORS (a renamed selector passes).
For THIS branch both holes were closed by the reviewer's independent
audit: every --* definition line is byte-identical between the two
trees, and the full Tier 1 CSS diff was enumerated line-by-line (weight
substitutions, three hex shortenings, three additive class rules -
nothing else). DO NOT reuse this script for Tier 2+ without adding
definition-value and selector comparison.

## Tier 1 exclusions (halt-and-report; audit zero-delta claims that failed)

1. **#cc0000 -> var(--yt-red): EXCLUDED.** The 2014 era block overrides
   `--yt-red: #e62117` - the substitution would change every affected
   surface in that era. Worse, every rule-level `#cc0000` (8 CSS sites +
   stats.js:342) is actually a fallback in `var(--accent, #cc0000)` /
   `var(--accent-color, #cc0000)` - and `--accent`/`--accent-color` are
   defined NOWHERE: phantom token names whose fallbacks are the live
   values. Needs a Tier 2+ decision: define the phantoms, or migrate to
   --yt-red accepting the 2014-era delta (arguably era-consistency
   repair, same class as R7).
2. **monospace -> var(--mono-font): EXCLUDED.** 2005/2009 define
   `--mono-font: "Courier New", monospace`; the chapters-editor textarea
   would change font in those eras. Same Tier 2+ decision shape.
3. **gold -> var(--star-gold): VACUOUS.** The harvest's single `gold` hit
   was comment prose (its JS scanner does not strip comments - harvest
   tooling limitation, now documented). No code site exists. Note the
   claim was doubly wrong: keyword gold is #ffd700, --star-gold is
   #ffcc00 (#ffc107 in 2014) - never zero-delta.

## Lint burn-down - corrected baselines

TIER 2 STEP 1 UPDATE (the fixture suite found two more linter holes; the
numbers below this note are SUPERSEDED - kept for the audit trail):

| linter version | baseline (ef60bbf) | after Tier 1 | what changed |
|---|---|---|---|
| v1 (shipped w/ commit 4) | 641 | - | published, then found buggy |
| v2 (Phase 1 commit 6) | 628 | 554 | parser fix: same-line selectors re-enabled at-rule/era exclusions |
| v3 (Tier 2 Step 1) | 661 | 580 | ONE-LINE RULES were never linted - 26 hidden literals (found by the new fixture suite) |
| v4 (Tier 2 Step 1, authoritative) | **692** | **611** | var() FALLBACK literals now survive the strip - Dean's ruling requires the 9 ghost-token sites visible as Tier 4 residue; also surfaces 3 vacuous `var(--heading-weight, bold)` fallback spellings (Tier 2 cleanup candidates - the Tier 1 "zero weight literals" claim was true for DIRECT declarations and stands as written) |

| v5 (Tier 3 Step 0, authoritative) | n/a (JS surfaces did not exist pre-Tier-1 in the metric) | **298** at Tier 3 start | JS-applied style surfaces join the scope per the post-Tier-2 ruling: cssText strings, el.style assignments, setProperty (player.js positional geometry excluded per the audit classification). +27 over the CSS-only 271: 19 spacing, 3 color (incl. the stats.js ghost-red fallback), 5 font-weight (the two stats.js bold cssText literals + three more the JS scan surfaced). Fixture-covered before publication. |

The v4 semantics are locked by test/unit/css-token-lint.test.js (in CI via
npm run test:unit), including one regression fixture per hole above.

## Lint burn-down - corrected baselines (SUPERSEDED - see table above)

Commit ef60bbf published baseline **641**. The linter's selector tracking
had a bug (single-line selectors - nearly all of them - pushed empty
strings, silently disabling the @font-face/@keyframes and era-scope
exclusions; caught via the `font-weight: 100 900` @font-face false
positive). Fixed in this commit. Corrected numbers, fixed parser on both
trees:

| | baseline (ef60bbf tree) | after Tier 1 (38b6215) |
|---|---|---|
| spacing | 407 | 408 (+1: the repull padding moved from JS into CSS - now visible to the burn-down, deliberate) |
| font-weight | 74 | **0** |
| color | 57 | 57 |
| border-radius | 25 | 25 (R7-deferred bucket) |
| motion | 30 | 30 |
| z-index | 17 | 17 |
| line-height | 11 | 11 |
| shadow | 6 | 6 |
| font-size | 1 | **0** |
| **TOTAL** | **628** | **554** |

## Adjacent findings (flagged, not touched, per spec)

- stats.js cssText carries four more `font-size:12px` (lines ~166-274)
  that the harvest undercounted - its JS scanner matched `.style.X=` and
  `setProperty` but not `cssText`. Tier 2 candidates.
- `.btn-sm` is a styling-free class across the entire codebase.
- The audit's existing-token census gains two GHOST names: `--accent`
  and `--accent-color` are consumed (as fallback carriers) but never
  defined.

## Tier 2 commit 6 - .btn-sm disposition: LEAVE AND FLAG

Reference check (documented per the Tier 2 spec): `.btn-sm` carries ZERO
style declarations anywhere, but is referenced 41 times as a class name in
markup/JS (subscriptions.html buttons, common.js injected controls,
setup.html logo buttons) and 12 times in tests. Per the spec's rule
("referenced anywhere -> leave and flag"), it stays. Removing it would be
behavior-neutral but a 53-site churn for zero rendering value - a Tier 3+
housekeeping decision if ever. Flagged; not removed.

## Tier 2 verification + remaining-work census (commit 7)

Adoption span 6f4b971 -> HEAD. Full-span differ verdict: across all 9
era x mode contexts, the ONLY delta is the enumerated .stats-meta-text
class addition (2 declarations, correct per-mode resolution visible:
#666666 light / #aaaaaa dark) - every substitution is invisible to
resolution, which is the definition of the zero-delta pass. Per-commit
differ runs were EQUIVALENT x9 at every step.

Burn-down (v4 linter, authoritative): 611 at Tier 2 start -> **271**
after Tier 2. By category (start -> end): spacing 427 -> 107,
color 89 -> 86, font-weight 3 -> 0, motion 30 -> 17,
border-radius 28 -> 27, z-index 17 -> 17, line-height 11 -> 11,
shadow 6 -> 6. (The old v2-era category table above is superseded;
89 was the true v4 color start - the v2 table's 57/62 predates the
fallback-visibility fix.)

Corrections made during Tier 2, on the record: the stats.js hidden
cssText sites were FIVE, not four; the spec's premise that cssText is
in the linter's coverage was false (linter scope is CSS-only by its
Phase 1 contract) - visibility proven by direct scan instead, and
"extend the metric to JS style surfaces?" is a Tier 3 scope decision.
Commit 3's message was amended pre-push after inverting the two scrim
counts.

### Census of the remaining 271 (the Tier 3 prompt's input)

- TIER 3 (consolidation/near-values): spacing drift band
  (7/9/14/18/28px and friends) ~55; the 25 flagged MIXED shorthands
  (a scale member beside auto/calc/--density/a Tier 3 value); motion
  0.2s x13 + micro-band (0.08/0.1/0.12/0.3s) 4; scrim near-alphas
  (.5/.6/.75/.85 minus the protected cc floor); the 6-member shadow
  elevation band; radius drift band (3/6/8/14/27px); line-height band
  (1.3/1.35 vs tokens); one adoption-tooling gap (.skip-btn:hover
  mid-line scrim). Also flagged-not-made: two font-weight:bold cssText
  literals in stats.js; the JS-metric scope decision.
- TIER 4 (era/judgment, behind per-era screenshots): the 9 ghost
  --accent sites (ruling: migrate to --yt-red, never define the
  ghosts); monospace -> --mono-font; R7 raw radii (2/4px x15). These
  are the bulk of the color-category residue.
- AMBIGUOUS-FLAGGED (Tier 3 scoping input): 26 offset sites
  (top/right/bottom/left carrying scale values - geometry vs rhythm
  judgment per site); 4 glyph/text-geometry sizing sites reverted by
  judgment during commit 2 (.art-play-glyph::before, .related-title
  max-height, .transcode-spinner, .ptr-indicator).
- DELIBERATELY OUT OF SCOPE (not residue): era-scoped skin rules
  (incl. the three [data-theme="2021"] slider-track 999px pills -
  same posture as the bevel stack: era skin stays literal);
  z-index 900+ ladder values (Tier 3 R11 re-ladder behind the co-open
  enumeration); the 17 z + 11 line-height + letterbox/exempt classes
  carried as annotated.

### Lock-architecture note

Eleven pre-existing CSS spelling locks (touch targets, grids, sticky
bar, chapters, modal) now resolve --space-*/--size-* spellings back to
px before asserting (per-file rs/rt helpers), with the NEW
token-scale-lock.test.js as the single byte-exact value authority for
all 38 tokens (single-definition-enforced, so era overrides can never
silently detach the spelling locks from reality).

## Post-Tier-2 rulings (Dean, at merge approval)

1. JS-METRIC SCOPE: APPROVED - at Tier 3 start the linter extends to
   JS-applied style surfaces (cssText strings, el.style assignments,
   setProperty), EXCLUDING player.js positional geometry per the audit
   classification. One deliberate rebaseline with the usual
   correction-history entry (it will be v5). The two font-weight:bold
   cssText literals in stats.js land in scope with it.
2. Tier 3 is NOT authorized until Dean's device-pass baseline
   screenshots exist (captured from merged main; capture manifest
   delivered separately) and the Tier 3 prompt arrives. No refactoring
   in the interim.
