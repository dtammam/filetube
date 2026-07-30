# Design-token audit v1.1 - reconciled contract (Phase 1)

Supersedes the count sections of token-audit-v1.md (delivered 2026-07-30,
not repo-tracked). The v1 frequency tables (Step 2) and risk notes (Step 4,
R1-R12) remain valid and are not restated here; this document is the
authoritative TOKEN CONTRACT after Dean's four amendments.

## Amendments applied (Dean, Phase 1 approval)

- (a) R12 REJECTED - all three small breakpoints stay (480px v1.54 chip
  wrap, 520px v1.55 footer row-flow, 600px music grid). Each media query
  carries a one-line origin comment (done in the token-file commit).
- (b) R7 DEFERRED - zero radius changes in any phase until per-era
  screenshots exist and each surface is individually approved.
- (c) R4 AMENDED - when scrims consolidate (Tier 2), the cc-overlay text
  background KEEPS its own 0.85 value: it is a legibility surface, not a
  style surface. Recorded in the token file now so it cannot be lost.
- (d) Trimmed set adopted - dropped from the v1 proposal: --space-0,
  --lh-body, --size-icon, --z-sidebar, --fw-regular.

## Count reconciliation - what v1 got wrong, twice

1. v1's Step 3 header claimed "57 total / 25 new". The 25 was an
   arithmetic slip: the proposal it headed actually contained 43 new
   names (11+4+6+7+1+1+3+10).
2. v1's Budget check claimed 75 total from "20 era slots + 12 --fs-*"
   existing. The existing census was an UNDERCOUNT: style.css defines
   **42 distinct custom-property names**, not 32. v1 missed the four
   font slots it elsewhere described (--font-family, --heading-font,
   --mono-font, --logo-font) plus six infrastructure tokens
   (--density, --heading-tracking, --heading-weight, --sticky-bar-top,
   --mobile-header-h, --mobile-bottom-nav-h).

Corrected arithmetic:

| | count |
|---|---|
| Existing names (census, style.css, verified by script) | 42 |
| ...of which style tokens (era palette 20 + type slots 4 + fs scale 12) | 36 |
| ...of which layout/infrastructure (density, tracking, weight, sticky, 2x mobile-h) | 6 |
| New names, v1 proposal | 43 |
| New names after amendment (d) | **38** |
| **Governed total (all custom properties)** | **80** |
| Governed total, style-tokens-only view | 74 |

The "~68" target in amendment (d) was built on v1's undercount of the
existing layer; it is not reachable without retiring existing names, which
nothing has approved. The unambiguous contract is: **38 new names** (the
list below), on top of the 42 that exist. Flagged rather than fudged.

## The 38 new names (the contract)

Spacing (10) - base-4 grid with 2px half-steps; names are multiples of the
2px base so half-steps can retire later without renaming:
`--space-1:2px --space-2:4px --space-3:6px --space-4:8px --space-5:10px
--space-6:12px --space-8:16px --space-10:20px --space-12:24px
--space-16:32px`

Sizing (3): `--size-touch:44px --size-control:36px --size-control-sm:32px`

Color/overlay (6) - the mode-invariant dark chrome:
`--overlay-surface:#222 --overlay-border:#444 --on-overlay:#fff
--on-overlay-muted:#ccc --scrim:rgba(0,0,0,0.55)
--scrim-heavy:rgba(0,0,0,0.8)` (cc-overlay exempt from scrim adoption, see
amendment c)

Type (5): `--fw-semibold:600 --fw-bold:700 --fw-black:900
--lh-tight:1.25 --lh-relaxed:1.5`

Radius (1): `--radius-full:999px` (pills; 50% circles stay geometry)

Shadow (1): `--shadow-modal:0 8px 24px rgba(0,0,0,0.45)`

Motion (3): `--dur-fast:0.15s --dur-slow:0.25s --ease-ui:ease`

Z-index (9) - named ladder; backdrop/content pairs are
`calc(var(--z-X) +/- 1)`, never new raw numbers:
`--z-nav:900 --z-chip:940 --z-dock:950 --z-header:1000
--z-player-max:1100 --z-sheet:1500 --z-panel:1600 --z-modal:2000
--z-top:2200`

Breakpoints are NOT tokens (CSS custom properties cannot drive @media and
the repo has no build step) - they are documented constants in style.css's
header: 768px phone (mirrored in JS by SHORTCUTS_DESKTOP_QUERY
'(min-width: 769px)', which is test-locked - change both or neither),
1024px tablet, and the three deliberate small thresholds per amendment (a).

## Phase/tier map (unchanged from approval)

- Phase 1 (this): reconcile, token file (additive, no consumers), the
  token-exempt convention applied to every audit KEEP, css-lint
  report-only baseline, Tier 1 zero-delta refactor, verification.
- Tier 2 (separate approval): consolidations R1/R2/R10 + amended R4.
- Tier 3 (separate approval): z re-ladder (R11) after co-open enumeration;
  R3 control heights; R5/R6/R8/R9.
- R7 radius work: deferred behind per-era screenshots, per amendment (b).
