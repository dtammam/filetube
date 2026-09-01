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

Sizing (4): `--size-touch:44px --size-control:36px --size-control-sm:32px
--size-touch-watch-action:39px` (v1.96: the watch action-row buttons sit 5px
under the 44px touch floor on mobile - see `.watch-actions .btn`)

Color/overlay (6) - the mode-invariant dark chrome:
`--overlay-surface:#222 --overlay-border:#444 --on-overlay:#fff
--on-overlay-muted:#ccc --scrim:rgba(0,0,0,0.55)
--scrim-heavy:rgba(0,0,0,0.8)` (cc-overlay exempt from scrim adoption, see
amendment c)

Type (5): `--fw-semibold:600 --fw-bold:700 --fw-black:900
--lh-tight:1.25 --lh-relaxed:1.5`

Radius (1): `--radius-full:999px` (pills; 50% circles stay geometry)

Shadow (1): `--shadow-modal:0 8px 24px rgba(0,0,0,0.45)`

Motion (4): `--dur-fast:0.15s --dur-slow:0.25s --dur-critter-arrive:1.2s --ease-ui:ease`

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

## Addendum (Phase 1 execution findings - see
design-token-phase1-verification.md for full detail)

- Tier 1 shipped THREE of its six items smaller than approved: the
  #cc0000, monospace and gold substitutions were excluded as
  not-zero-delta (era-varying token values; one vacuous harvest hit).
- Two GHOST token names exist: `--accent` and `--accent-color` are
  consumed as var() fallback carriers at 9 sites but never defined.
  A Tier 2+ decision item.
- The lint baseline is 628 (not the 641 first published - linter parser
  fix), 554 after Tier 1.

## Addendum (Tranche F.5 - census toward zero, 2026-07-31)

Eight names join the contract (all pinned byte-exact in
token-scale-lock.test.js, per the three-place rule):

- The reading themes, the reader's OWN AXIS (never era- or mode-wired;
  read.js derives the same tokens via getComputedStyle for the epub
  iframe, killing its duplicate literal copies):
  `--reader-paper-bg:#f7f4ec --reader-paper-fg:#1c1c1c
  --reader-sepia-bg:#f0e3c9 --reader-sepia-fg:#3a2f20
  --reader-night-bg:#101014 --reader-night-fg:#c8c8d0`
- The two structurally-coupled layout constants - a NARROW, Dean-ruled
  amendment to "layout geometry stays literal" (each had 4+ in-tree
  copies that had to stay in sync): `--header-h:56px --sidebar-w:230px`.
  Player-bar reserves and all other geometry remain literal.

Also this tranche: linter v7 (radius-calc idiom pinned to the three
real radius names; ZERO-only env() fallbacks excluded; one shared
classifier for the CSS and JS surfaces - tech-debt #69 closed), and
every ruled singleton now carries a token-exempt reason in place.

RULING 1 CLOSED (Dean, 2026-08-01: "I approve Both"): `--on-accent:#fff`
joins the contract (48th name) - white text/glyphs on saturated accent
surfaces (17 sites: on-red buttons/badges, the Tube spans,
generated-avatar initials incl. the two JS writers, the autoplay knob).
The eq bars adopted the EXISTING --on-overlay per the recommendation,
and .audio-player-visual was reclassified to --on-overlay at execution
(canvas text is overlay chrome, not accent - same value, honest
semantic; disclosed). **THE CENSUS IS ZERO** within the linter's
declared scope: every raw literal there is a token consumption, a
recognized idiom, or a reasoned token-exempt annotation. SCOPE
QUALIFIER (census-zero gate, 2026-08-01): the linter does NOT scan
setAttribute('style', ...) calls, innerHTML/template style attributes,
or the HTML shells' inline style="" attrs - governed raws exist on
those channels today (tech-debt #71) - and its line-based parser
cannot see multi-line declarations (six known, all token-exempt'd;
tech-debt #68 gates the ratchet, now also requiring a known-violation
canary because ledger-check's CLEAN is vacuous at zero rows). Baseline
history: 692 (audit) -> 298 (v5) -> 110 (Step 3) -> 54 (Tier 4) -> 19
(F.5) -> 0. (Record correction: the census-zero commit message says
"15 CSS color sites + the knob + two JS writers" - the true split is
14 color sites + the knob's background-color + two JS writers = 17
on-accent consumers; the docs and ledger were always correct.)

## Addendum (Tier 4 execution, 2026-07-31)

- `--thumbnail-bg:#222` DEFINED per Dean's OQ7 ruling (2026-07-30): the
  media-placeholder surface behind thumbnails/covers, previously a
  6-site phantom (`var(--thumbnail-bg, #222)` with no definition).
  Joins the contract as a new name alongside the 38 + `--radius-lg`.
  Equals `--overlay-surface` coincidentally; distinct semantic, may
  diverge.
- The 13 dead var() fallbacks on `--border-color`/`--card-bg` (defined
  at :root + every era; the literals never painted) are removed - the
  ghost-token hiding place the Lessons section warned about, closed.

## Phase/tier map (CORRECTED by Dean's post-merge rulings, 2026-07-30)

- Phase 1 (MERGED, 94cd9f2): reconcile, token file, token-exempt
  convention, css-lint report-only baseline, Tier 1 zero-delta refactor.
- Tier 2 = the ZERO-DELTA 1:1 ADOPTION pass (spec arrives in its own
  prompt). Step 0 (before anything else): fix the equivalence differ's
  two documented holes - it must compare full selector text,
  declaration order-normalized property/value pairs, AND custom-property
  definitions, per era x mode resolution, with mutation tests for both
  holes in its fixture set. Step 1: the css-token-lint script gets its
  own fixture suite in CI (it is the primary drift metric and does not
  get to be the least-tested code in the repo). The Tier 2 ban on the
  unfixed differ stands until those tests pass.
- Tier 3 = the consolidations (R1/R2/R10 + amended R4), gated on Dean's
  device-pass screenshots.
- Tier 4 = the era-consistency tier, behind per-era screenshots:
  R7 radius work (amendment b), PLUS Dean's rulings on the Phase 1
  exclusions:
  - Ghost --accent/--accent-color: NOT defined, ever. End state is the
    9 sites consuming var(--yt-red) directly - the current 2014-era
    split (#cc0000 on those 9 surfaces vs #e62117 everywhere tokenized)
    is the BUG, not the baseline; defining --accent would
    institutionalize a second non-era-varying red to preserve an
    accident. Era-visible, so Tier 4; until then the sites stay
    untouched, unexempted, in the burn-down as Tier 4 residue.
  - monospace -> var(--mono-font) (.chapters-editor-textarea): TAKEN -
    browser-default mono in the Courier-defined eras is the same
    era-inconsistency class. Tier 4, same screenshot gate, same residue
    handling.
- Linter ruling: the zero-dependency script STAYS (stylelint's
  dependency surface is not worth one rule).

## Addendum v1.152 (2026-08-19): master-detail menu tokens

The master-detail menu (wireMasterDetail) added ten mode-invariant tokens,
all pinned byte-exact in `test/unit/token-scale-lock.test.js` (the value
authority) and defined exactly once in the base `:root`:
- Tile tones (colour encodes the menu group): `--md-graphite` #3a3f47,
  `--md-steel` #4a6178 (red reuses the existing `--yt-red`).
- Era-reactive Appearance tile tints (track `<html data-theme>`; 2021 reuses
  `--yt-red`): `--md-era-2014` #e62117, `--md-era-2009` #c11a20,
  `--md-era-2005` #b31217.
- `--md-tile-glyph` #ffffff (white glyph on the tinted tile), `--md-tile-radius`
  8px.
- Layout constants (the narrow "layout geometry" amendment, like
  `--header-h`/`--sidebar-w`): `--md-nav-width` 250px, `--md-divider-inset` 56px.
- `--tracking-caps` 0.05em (uppercase group titles / badges).

## Addendum v1.227 (2026-08-31): mobile music skin tokens

A new user-choosable presentation AXIS - the mobile-only music player SKINS
(Apple Music / Spotify / iPod), like the `--reader-*` reading themes. 43 bespoke
tokens (the value authority is `test/unit/token-scale-lock.test.js`); all scoped to
the `.mms-*` mobile-music rules and used only via `var()` (census-exempt DEFS).

- Shared: `--mms-white` #ffffff, `--mms-black` #000000, `--mms-track-lt`
  rgba(255,255,255,.27).
- Apple Music: `--mms-apple-fg` #ffffff, `--mms-apple-accent` #fa2b56,
  `--mms-apple-bg` #0c0c10.
- Spotify: `--mms-sp-fg` #ffffff, `--mms-sp-accent` #1db954, wash gradient
  `--mms-sp-g1` #3a2a5a / `--mms-sp-g2` #1b1727 / `--mms-sp-g3` #0c0c0f.
- iPod: `--mms-ipod-fg` #2c2822, `--mms-ipod-accent` #3f79c9 / `--mms-ipod-accent2`
  #2f6fce (tracklist gradient), `--mms-ipod-warm` #8a6d3b, `--mms-ipod-line`
  rgba(120,95,50,.16), cream `--mms-ipod-g1` #f4efe4 / `--mms-ipod-g2` #e9e1d2,
  `--mms-ipod-frame` #cbb48f, `--mms-ipod-track` #cdbfa4, chrome button
  `--mms-ipod-btn1` #fdfdfd / `--mms-ipod-btn2` #d7d2c7.
- Shadows: `--mms-art-shadow`, `--mms-ipod-art-shadow`, `--mms-ipod-play-shadow`.
- Geometry: `--mms-r-art` 14px, `--mms-r-art-ipod` 8px, `--mms-r-row-ipod` 6px,
  `--mms-chev` 36px, `--mms-play` 66px, `--mms-play-svg` 28px, `--mms-skip-svg`
  34px, `--mms-rn-w` 18px, `--mms-transport-gap` 30px, `--mms-scrub-mt` 18px,
  `--mms-transport-mt` 14px, `--mms-row-py` 9px.
- Type: `--mms-ls-caps` .14em, `--mms-ls-caps2` .1em, `--mms-ls-tight` -.02em,
  `--mms-lh-ttl` 1.15.
- Switcher chip tints: `--mms-sw-on` rgba(255,255,255,.16), `--mms-sw-on-ipod`
  rgba(60,45,20,.16).

## Addendum v1.228 (2026-09-01): bold skin rebuild - SUPERSEDES the v1.227 set

Dean's device read on v1.227 was "the same theme with three colors" - the skins
shared one structure. The v1.228 rebuild made them structurally distinct (Apple:
blurred cover bleed + oversized art + hot-pink accent; Spotify: purple->black
canvas + green circle play + a live queue panel; iPod: aluminum bar + framed cover
+ chrome transport cluster + blue tracklist), so the palette changed and grew:
**43 tokens -> 51 tokens** (then -> 48 in v1.229, see below). The whole `--mms-*`
set below REPLACES the v1.227 list above; the byte-exact value authority is
`test/unit/token-scale-lock.test.js`
(contract count 103 -> 111 -> 108 = 60 base + 48 `--mms-*`). All are census-exempt DEFS
used only via `var()`, scoped to the `.mms-*` mobile-music rules. Geometry the
census does NOT govern (widths/heights/aspect/filter/transform - play sizes, art
sizes, aluminum-bar height, knob) is intentionally literal and NOT tokenized. The
oversized titles reuse the global `--fs-*` type scale (Apple `--fs-5xl` 32px, Spotify
`--fs-4xl` 22px, iPod `--fs-3xl` 20px) - the type-scale lock (AC7.1) requires every
`font-size:` to read `var(--fs-*)`, so bespoke `--mms-fs-*` sizes are NOT allowed.

- Shared: `--mms-white` #ffffff, `--mms-black` #000000.
- Apple: `--mms-apple-bg` #0b0b10, `--mms-apple-fg` #ffffff, `--mms-apple-accent`
  #ff4f7b, `--mms-apple-veil` rgba(8,8,12,.5) (bleed darkener), `--mms-apple-dim`
  rgba(255,255,255,.66), `--mms-apple-track` rgba(255,255,255,.24);
  `--mms-art-shadow` 0 26px 60px -18px rgba(0,0,0,.72).
- Spotify: `--mms-sp-fg` #ffffff, `--mms-sp-accent` #1ed760, `--mms-sp-on-accent`
  #062b14 (glyph on the green play), `--mms-sp-dim` rgba(255,255,255,.6),
  `--mms-sp-ic` rgba(255,255,255,.82), wash `--mms-sp-g1` #5a3a86 / `--mms-sp-g2`
  #241a33 / `--mms-sp-g3` #0b0b0d, `--mms-sp-track` rgba(255,255,255,.24),
  queue panel `--mms-sp-queue-bg`
  rgba(0,0,0,.26) / `--mms-sp-qline` rgba(255,255,255,.08); `--mms-sp-play-shadow`
  0 10px 26px -6px rgba(30,215,96,.55).
- iPod: `--mms-ipod-fg` #2b2620, `--mms-ipod-warm` #7c6636, `--mms-ipod-accent`
  #3f79c9 / `--mms-ipod-accent2` #2f6fce (list gradient), `--mms-ipod-line`
  rgba(120,95,50,.18), body cream `--mms-ipod-g1` #f6f1e6 / `--mms-ipod-g2`
  #e6ddca, aluminum bar `--mms-ipod-bar1` #fbfbfc / `--mms-ipod-bar2` #d8d3c8,
  `--mms-ipod-frame` #c9b389, `--mms-ipod-track` #cabb9f, chrome cluster
  `--mms-ipod-btn1` #ffffff / `--mms-ipod-btn2` #d6d1c6, `--mms-ipod-cluster-line`
  rgba(120,95,50,.3); shadows
  `--mms-ipod-art-shadow`, `--mms-ipod-cluster-shadow`, `--mms-ipod-bar-shadow`,
  `--mms-ipod-knob-shadow`.
- Shared metrics: radii `--mms-r-art` 16px, `--mms-r-art-ipod` 6px, `--mms-r-queue`
  16px, `--mms-r-th` 6px, `--mms-r-row-ipod` 6px; type `--mms-ls-caps` .14em,
  `--mms-ls-caps2` .1em, `--mms-ls-tight` -.02em, `--mms-lh-ttl` 1.1.

## Addendum v1.229 (2026-09-01): in-player switcher removed (-> 48 --mms tokens)

The in-player skin switcher (the chips inside the now-playing) was unreliable
on-device - it visually vanished against some skins - so skin PICKING moved to the
account menu (a `.account-menu-skinpicker` segmented control, mobile-only, built by
`buildAccountMusicSkinRow` in common.js; it persists via the same `ft-music-skin`
key and fires `ft-music-skin-changed` for a live re-render). Removing the in-player
chips dropped their three switcher-tint tokens - **`--mms-apple-sw`, `--mms-sp-sw`,
`--mms-ipod-sw`** - so the `--mms-*` set is now **48** (contract count 111 -> 108).
The menu picker reuses the app's existing design tokens (`--yt-red` accent,
`--on-accent`, `--text-primary/-secondary`, `--border-color`, `--space-*`, `--fs-*`,
`--radius-lg`) - no new bespoke tokens.
