# Tokens Tier 4 - expected-delta ledger (the execution census)

MACHINE-GENERATED census (2026-07-31, tokens/tier4 branch point = main
f0ab29e): rows produced by a generator that calls scripts/ledger-check.js
collectSites() (the linter's own collector - byte-identical scope by
construction) and harvests selector/bucket/notes from the completed Step 3
ledger by (file:line, decl). Hand-enumerated sets are banned (Step 3
lesson: my hand-derived "3-row" partial set was really 6).

BINDING: `npm run ledger:check` binds THIS file (default LEDGER path
repointed in the Tier 4 opener). Contract per ledger-check.js: cell 1 =
file:line, cell 3 = the declaration exactly as the linter reports it;
struck rows (~~...~~) are invisible to the parser. Protocol: a batch
commit STRIKES exactly its own rows (strikethrough the whole row); when
the batch's edits shift source lines, the surviving rows' file:line
cells are RE-LINED mechanically (match by (file, decl) group, order
preserved, count imbalance aborts - never by hand). Struck rows keep
their strike-time numbers as historical record. ledger-check must print
CLEAN at every commit.

Burn-down PREDICTIONS (the linter's measured number at each commit is
authoritative - predictions are hypotheses, per the Step 3 wrong-by-3
lesson): 110 -> 4a 91 -> 4b 82 -> 4c 82 (font-family is ungoverned;
linter-invisible) -> 4d-pre 82 (linter v6, capability only) -> 4d 65
-> 4e 54. Residual 54 = color 32 + border-radius 9 + spacing 12 +
shadow 1.

Batch 4c (monospace -> var(--mono-font), .chapters-editor-textarea
~style.css:5387) has NO census row: font-family is not a governed
property. Its verification is differ-only: 1 pair x 4 contexts
(2005 L+D, 2009 L+D: monospace -> "Courier New", monospace),
EQUIVALENT x5 elsewhere. Witness: scene 22.

Differ notes binding the delta columns below:
- The differ resolves var() chains per context but does NOT evaluate
  calc() arithmetic: every 4d site that becomes a calc() expression
  appears as a textual pair in all 9 contexts (enumerated in the 4d
  section - 6 pairs, of which 3 are value-preserving and 3 are the
  deliberate resolved-value moves).
- public/js/stats.js:347 (batch 4b) is OUTSIDE the differ (CSS files
  only); it is bound by its census-row strike + scene 23c.
- --thumbnail-bg define-then-consume resolves identically before/after
  (#222 fallback vs #222 definition): EQUIVALENT x9 by construction.

## Batch 4a - --thumbnail-bg define + dead var() fallback cleanup (19 sites, zero-delta) (19 rows)

| site | selector | decl (linter-exact) | bucket | after | expected delta | notes |
| ---- | -------- | ------------------- | ------ | ----- | -------------- | ----- |
| ~~public/css/style.css:6700~~ | ~~.book-row-cover~~ | ~~`background: var(--thumbnail-bg, #222)`~~ | ~~PHANTOM-THUMBNAIL-BG~~ | ~~`background: var(--thumbnail-bg)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~ghost --thumbnail-bg (defined nowhere, #222 fallback paints) - NEW phantom family x6 - RULED (OQ7): DEFINE the token, Tier 4 work~~ |
| ~~public/css/style.css:6779~~ | ~~.book-cover-link~~ | ~~`background: var(--thumbnail-bg, #222)`~~ | ~~PHANTOM-THUMBNAIL-BG~~ | ~~`background: var(--thumbnail-bg)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~~~ |
| ~~public/css/style.css:6825~~ | ~~.books-shelf-chip~~ | ~~`border: 1px solid var(--border-color, #444)`~~ | ~~DEAD-FALLBACK~~ | ~~`border: 1px solid var(--border-color)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~--border-color defined at :root + every era; the literal never paints - Tier 4 fallback cleanup~~ |
| ~~public/css/style.css:6874~~ | ~~.reader-topbar~~ | ~~`border-bottom: 1px solid var(--border-color, #444)`~~ | ~~DEAD-FALLBACK~~ | ~~`border-bottom: 1px solid var(--border-color)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~~~ |
| ~~public/css/style.css:6918~~ | ~~.reader-bottombar~~ | ~~`border-top: 1px solid var(--border-color, #444)`~~ | ~~DEAD-FALLBACK~~ | ~~`border-top: 1px solid var(--border-color)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~~~ |
| ~~public/css/style.css:6925~~ | ~~.reader-progress-track~~ | ~~`background: var(--border-color, #444)`~~ | ~~DEAD-FALLBACK~~ | ~~`background: var(--border-color)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~~~ |
| ~~public/css/style.css:6941~~ | ~~.reader-drawer~~ | ~~`background: var(--card-bg, #1c1c22)`~~ | ~~DEAD-FALLBACK~~ | ~~`background: var(--card-bg)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~#1c1c22 fallback matches no era value - proof it never renders~~ |
| ~~public/css/style.css:6942~~ | ~~.reader-drawer~~ | ~~`border-left: 1px solid var(--border-color, #444)`~~ | ~~DEAD-FALLBACK~~ | ~~`border-left: 1px solid var(--border-color)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~~~ |
| ~~public/css/style.css:6955~~ | ~~.reader-toc-item~~ | ~~`border-bottom: 1px solid var(--border-color, #333)`~~ | ~~DEAD-FALLBACK~~ | ~~`border-bottom: 1px solid var(--border-color)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~#333 spelling variant~~ |
| ~~public/css/style.css:7175~~ | ~~.reloc-preview-panel~~ | ~~`background: var(--card-bg, var(--bg-color, #fff))`~~ | ~~DEAD-FALLBACK~~ | ~~`background: var(--card-bg)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~nested dead fallbacks~~ |
| ~~public/css/style.css:7177~~ | ~~.reloc-preview-panel~~ | ~~`border: 1px solid var(--border-color, #ccc)`~~ | ~~DEAD-FALLBACK~~ | ~~`border: 1px solid var(--border-color)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~~~ |
| ~~public/css/style.css:7192~~ | ~~.reloc-preview-header~~ | ~~`border-bottom: 1px solid var(--border-color, #ccc)`~~ | ~~DEAD-FALLBACK~~ | ~~`border-bottom: 1px solid var(--border-color)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~~~ |
| ~~public/css/style.css:7206~~ | ~~.reloc-preview-summary~~ | ~~`border-bottom: 1px solid var(--border-color, #ccc)`~~ | ~~DEAD-FALLBACK~~ | ~~`border-bottom: 1px solid var(--border-color)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~~~ |
| ~~public/css/style.css:7231~~ | ~~.reloc-preview-row~~ | ~~`border-bottom: 1px solid var(--border-color, #eee)`~~ | ~~DEAD-FALLBACK~~ | ~~`border-bottom: 1px solid var(--border-color)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~#eee variant~~ |
| ~~public/css/style.css:7249~~ | ~~.reloc-preview-badge~~ | ~~`border: 1px solid var(--border-color, #ccc)`~~ | ~~DEAD-FALLBACK~~ | ~~`border: 1px solid var(--border-color)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~~~ |
| ~~public/css/style.css:7541~~ | ~~.music-drill-art~~ | ~~`background: var(--thumbnail-bg, #222)`~~ | ~~PHANTOM-THUMBNAIL-BG~~ | ~~`background: var(--thumbnail-bg)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~~~ |
| ~~public/css/style.css:7566~~ | ~~.music-sticky-thumb~~ | ~~`background: var(--thumbnail-bg, #222)`~~ | ~~PHANTOM-THUMBNAIL-BG~~ | ~~`background: var(--thumbnail-bg)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~mid-line decl~~ |
| ~~public/css/style.css:7600~~ | ~~.music-album-art~~ | ~~`background: var(--thumbnail-bg, #222)`~~ | ~~PHANTOM-THUMBNAIL-BG~~ | ~~`background: var(--thumbnail-bg)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~~~ |
| ~~public/css/style.css:7648~~ | ~~.music-song-thumb~~ | ~~`background: var(--thumbnail-bg, #222)`~~ | ~~PHANTOM-THUMBNAIL-BG~~ | ~~`background: var(--thumbnail-bg)`~~ | ~~ZERO (fallback never paints / define-with-fallback-value)~~ | ~~mid-line decl~~ |

## Batch 4b - ghost-red retirement (9 sites -> var(--yt-red)) (9 rows)

| site | selector | decl (linter-exact) | bucket | after | expected delta | notes |
| ---- | -------- | ------------------- | ------ | ----- | -------------- | ----- |
| public/css/style.css:6715 | .book-row-progress-fill | `background: var(--accent, #cc0000)` | TIER4-GHOST-RED | `background: var(--yt-red)` | 2014 L+D: #cc0000 -> #e62117; zero x7 elsewhere | scene 23 |
| public/css/style.css:6748 | .pinned-unpin-btn.armed | `background: var(--accent, #cc0000)` | TIER4-GHOST-RED | `background: var(--yt-red)` | 2014 L+D: #cc0000 -> #e62117; zero x7 elsewhere | armed state - on-device |
| public/css/style.css:6802 | .book-progress-fill | `background: var(--accent, #cc0000)` | TIER4-GHOST-RED | `background: var(--yt-red)` | 2014 L+D: #cc0000 -> #e62117; zero x7 elsewhere | scene 23 |
| public/css/style.css:6838 | .books-shelf-chip.active | `background: var(--accent, #cc0000)` | TIER4-GHOST-RED | `background: var(--yt-red)` | 2014 L+D: #cc0000 -> #e62117; zero x7 elsewhere | scene 23; mid-line decl |
| public/css/style.css:6937 | .reader-progress-fill | `background: var(--accent, #cc0000)` | TIER4-GHOST-RED | `background: var(--yt-red)` | 2014 L+D: #cc0000 -> #e62117; zero x7 elsewhere | scene 23d-ghost-red-reader (coverage-audit addition) |
| public/css/style.css:7216 | .reloc-copy-warning | `color: var(--accent-color, #cc0000)` | TIER4-GHOST-RED | `color: var(--yt-red)` | 2014 L+D: #cc0000 -> #e62117; zero x7 elsewhere | scene 23b |
| public/css/style.css:7258 | .reloc-preview-badge.reloc-badge-copy | `color: var(--accent-color, #cc0000)` | TIER4-GHOST-RED | `color: var(--yt-red)` | 2014 L+D: #cc0000 -> #e62117; zero x7 elsewhere | scene 23b |
| public/css/style.css:7259 | .reloc-preview-badge.reloc-badge-copy | `border-color: var(--accent-color, #cc0000)` | TIER4-GHOST-RED | `border-color: var(--yt-red)` | 2014 L+D: #cc0000 -> #e62117; zero x7 elsewhere | scene 23b |
| public/js/stats.js:347 | buildRepoLink cssText | `color: var(--accent, #cc0000)` | TIER4-GHOST-RED | `color: var(--yt-red)` | 2014 L+D: #cc0000 -> #e62117; zero x7 elsewhere | scene 23c |

## Batch 4d - z re-ladder (17 sites) (17 rows)

| site | selector | decl (linter-exact) | bucket | after | expected delta | notes |
| ---- | -------- | ------------------- | ------ | ----- | -------------- | ----- |
| public/css/style.css:542 | header | `z-index: 1000` | Z-LADDER-TIER4 | `z-index: var(--z-header)` | resolved 1000 unchanged | deployed value 1000 |
| public/css/style.css:1615 | #player-dock | `z-index: 950` | Z-LADDER-TIER4 | `z-index: var(--z-dock)` | resolved 950 unchanged | deployed value 950 |
| public/css/style.css:3191 | .modal-backdrop | `z-index: 2000` | Z-LADDER-TIER4 | `z-index: var(--z-modal)` | resolved 2000 unchanged | deployed value 2000 |
| public/css/style.css:3276 | .toast | `z-index: 2200` | Z-LADDER-TIER4 | `z-index: var(--z-top)` | resolved 2200 unchanged | deployed value 2200 |
| public/css/style.css:3311 | .oneoff-modal-backdrop | `z-index: 2100` | Z-LADDER-TIER4 | `z-index: calc(var(--z-modal) + 100)` | resolved 2100 unchanged | deployed value 2100 |
| public/css/style.css:3875 | .bottom-nav (mobile) | `z-index: 900` | Z-LADDER-TIER4 | `z-index: var(--z-nav)` | resolved 900 unchanged | deployed value 900 |
| public/css/style.css:3979 | .playlists-sheet-backdrop (mobile) | `z-index: 1500` | Z-LADDER-TIER4 | `z-index: var(--z-sheet)` | resolved 1500 unchanged | deployed value 1500 |
| public/css/style.css:3998 | .playlists-sheet (mobile) | `z-index: 1501` | Z-LADDER-TIER4 | `z-index: calc(var(--z-sheet) + 1)` | resolved 1501 unchanged | deployed value 1501 |
| public/css/style.css:5207 | #player-wrapper.css-fullscreen | `z-index: 1500` | Z-LADDER-TIER4 | `z-index: var(--z-sheet)` | resolved 1500 unchanged | deployed value 1500 |
| public/css/style.css:5631 | .audio-expanded | `z-index: 1100` | Z-LADDER-TIER4 | `z-index: var(--z-player-max)` | resolved 1100 unchanged | deployed value 1100 |
| public/css/style.css:5796 | .sub-sheet-backdrop | `z-index: 1600` | Z-LADDER-TIER4 | `z-index: calc(var(--z-panel) + 1)` | MOVE 1600->1601 (notif tie-break) | deployed value 1600 |
| public/css/style.css:6130 | .hard-delete-modal-backdrop | `z-index: 2250` | Z-LADDER-TIER4 | `z-index: calc(var(--z-top) + 1)` | MOVE 2250->2201 (preserved inversion, enum. prescription) | deployed value 2250 |
| public/css/style.css:6263 | #dl-status-chip | `z-index: 940` | Z-LADDER-TIER4 | `z-index: var(--z-chip)` | resolved 940 unchanged | deployed value 940 |
| public/css/style.css:7017 | .reader-nowplaying | `z-index: 940` | Z-LADDER-TIER4 | `z-index: var(--z-chip)` | resolved 940 unchanged | deployed value 940 |
| public/css/style.css:7174 | .reloc-preview-backdrop | `z-index: 1000` | Z-LADDER-TIER4 | `z-index: calc(var(--z-modal) - 100)` | MOVE 1000->1900 (joins modal band; header tie removed) | deployed value 1000 (ties header - DOM-order dependent) |
| public/css/style.css:8122 | .notif-panel | `z-index: 1600` | Z-LADDER-TIER4 | `z-index: var(--z-panel)` | resolved 1600 unchanged | deployed value 1600 |
| public/css/style.css:8271 | .notif-panel-backdrop (mobile) | `z-index: 1599` | Z-LADDER-TIER4 | `z-index: calc(var(--z-panel) - 1)` | resolved 1599 unchanged | deployed value 1599 |

## Batch 4e - R7 raw 4px radii -> var(--radius) (11 sites) (11 rows)

| site | selector | decl (linter-exact) | bucket | after | expected delta | notes |
| ---- | -------- | ------------------- | ------ | ----- | -------------- | ----- |
| public/css/style.css:5499 | .cc-overlay-text | `border-radius: 4px` | RADIUS-R7-RAW | `border-radius: var(--radius)` | 2005 L+D: 4px->0; 2009/2014 L+D: 4px->2px; zero x3 (root/2021) | 4px |
| public/css/style.css:6704 | .book-row-cover | `border-radius: 4px` | RADIUS-R7-RAW | `border-radius: var(--radius)` | 2005 L+D: 4px->0; 2009/2014 L+D: 4px->2px; zero x3 (root/2021) | 4px |
| public/css/style.css:6783 | .book-cover-link | `border-radius: 4px` | RADIUS-R7-RAW | `border-radius: var(--radius)` | 2005 L+D: 4px->0; 2009/2014 L+D: 4px->2px; zero x3 (root/2021) | 4px |
| public/css/style.css:7029 | .music-sticky-thumb | `border-radius: 4px` | RADIUS-R7-RAW | `border-radius: var(--radius)` | 2005 L+D: 4px->0; 2009/2014 L+D: 4px->2px; zero x3 (root/2021) | 4px; mid-line |
| public/css/style.css:7572 | .music-song-thumb | `border-radius: 4px` | RADIUS-R7-RAW | `border-radius: var(--radius)` | 2005 L+D: 4px->0; 2009/2014 L+D: 4px->2px; zero x3 (root/2021) | 4px; mid-line |
| public/css/style.css:7654 | .music-eq | `border-radius: 4px` | RADIUS-R7-RAW | `border-radius: var(--radius)` | 2005 L+D: 4px->0; 2009/2014 L+D: 4px->2px; zero x3 (root/2021) | 4px |
| public/css/style.css:7690 | .skeleton-shimmer.skel-title | `border-radius: 4px` | RADIUS-R7-RAW | `border-radius: var(--radius)` | 2005 L+D: 4px->0; 2009/2014 L+D: 4px->2px; zero x3 (root/2021) | 4px |
| public/css/style.css:7868 | .skeleton-shimmer.skel-w* | `border-radius: 4px` | RADIUS-R7-RAW | `border-radius: var(--radius)` | 2005 L+D: 4px->0; 2009/2014 L+D: 4px->2px; zero x3 (root/2021) | 4px |
| public/css/style.css:7878 | .watch-desc-skel .skel-line | `border-radius: 4px` | RADIUS-R7-RAW | `border-radius: var(--radius)` | 2005 L+D: 4px->0; 2009/2014 L+D: 4px->2px; zero x3 (root/2021) | 4px |
| public/css/style.css:7926 | .notif-clear-btn | `border-radius: 4px` | RADIUS-R7-RAW | `border-radius: var(--radius)` | 2005 L+D: 4px->0; 2009/2014 L+D: 4px->2px; zero x3 (root/2021) | 4px |
| public/css/style.css:8153 | .notif-row-thumb | `border-radius: 4px` | RADIUS-R7-RAW | `border-radius: var(--radius)` | 2005 L+D: 4px->0; 2009/2014 L+D: 4px->2px; zero x3 (root/2021) | 4px |

## Residual census (NOT this tier - stays in the burn-down, unstruck) (54 rows)

| site | selector | decl (linter-exact) | bucket | after | expected delta | notes |
| ---- | -------- | ------------------- | ------ | ----- | -------------- | ----- |
| public/css/style.css:593 | .logo span.tube | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand wordmark |
| public/css/style.css:735 | .btn-primary | `color: white` | SEMANTIC-RESIDUE | - | - | white-on-brand |
| public/css/style.css:763 | .app-container | `padding-top: 56px` | LAYOUT-CONSTANT | - | - | 56px header offset |
| public/css/style.css:910 | .main-content | `margin-left: 230px` | LAYOUT-CONSTANT | - | - | 230px sidebar width |
| public/css/style.css:1143 | .progress-bar-container | `background-color: rgba(255, 255, 255, 0.3)` | NO-TOKEN | - | - | translucent WHITE watch-progress track |
| public/css/style.css:1522 | .empty-state, .error-state | `padding: 40px var(--space-10)` | B1-PARTIAL-DONE | - | - | OPENER DONE 2026-07-31 - adopted members in place; this residual is deliberate and stays in the burn-down |
| public/css/style.css:1775 | .art-play-glyph::before | `filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6))` | NO-TOKEN | - | - | drop-shadow() glyph art |
| public/css/style.css:1809 | .audio-player-visual | `background: radial-gradient(circle, #2c3e50 0%, #0f171e 100%)` | NO-TOKEN | - | - | decorative gradient art |
| public/css/style.css:1810 | .audio-player-visual | `color: white` | SEMANTIC-RESIDUE | - | - | text on gradient art |
| public/css/style.css:1822 | .audio-artwork | `border: 2px solid rgba(255,255,255,0.2)` | NO-TOKEN | - | - | artwork border |
| public/css/style.css:1848 | .audio-vinyl::after | `border: 3px solid white` | NO-TOKEN | - | - | vinyl spindle art |
| public/css/style.css:1871 | .audio-subtitle | `color: #aaa` | NO-TOKEN | - | - | #aaa on art surface; --on-overlay-muted is #ccc = visible delta, no zero-delta adoption exists |
| public/css/style.css:1912 | .transcode-spinner | `border: 4px solid rgba(255, 255, 255, 0.25)` | NO-TOKEN | - | - | spinner ring art |
| public/css/style.css:2019 | .skip-ripple | `background: rgba(255, 255, 255, 0.14)` | NO-TOKEN | - | - | white ripple wash |
| public/css/style.css:2053 | .watch-prevnext-btn | `border-radius: calc(var(--radius) + 1px)` | RADIUS-DERIVED | - | - | calc(var(--radius) + 1px) nested-corner - already token-derived |
| public/css/style.css:2125 | .watch-autoplay-thumb | `background-color: #fff` | SEMANTIC-RESIDUE | - | - | toggle knob, form control |
| public/css/style.css:2271 | .uploader-avatar | `color: white` | SEMANTIC-RESIDUE | - | - | glyph over generated avatar color |
| public/css/style.css:2314 | .uploader-subs | `padding: 1px var(--space-3)` | B2-PARTIAL-DONE | - | - | 3a DONE 2026-07-31 - 7px->6px applied; the 1px residual is deliberate and stays in the burn-down |
| public/css/style.css:5110 | #player-wrapper:not(.audio-expanded) | `padding-bottom: 40px` | LAYOUT-CONSTANT | - | - | 40px control-strip reserve |
| public/css/style.css:5149 | #player-slot #player-wrapper | `padding-bottom: 80px` | LAYOUT-CONSTANT | - | - | 80px two-row strip reserve |
| public/css/style.css:5152 | #player-wrapper (mobile) | `padding-bottom: 44px` | LAYOUT-CONSTANT | - | - | 44px strip mirror (not a control height context) |
| public/css/style.css:5178 | #player-dock #player-wrapper | `padding-bottom: 26px` | LAYOUT-CONSTANT | - | - | 26px mini-bar reserve |
| public/css/style.css:5237 | #player-wrapper.css-fullscreen .player-controls | `padding-bottom: calc(var(--space-2) + env(safe-area-inset-bottom, 0px))` | B1-PARTIAL-DONE | - | - | OPENER DONE 2026-07-31 - adopted members in place; this residual is deliberate and stays in the burn-down |
| public/css/style.css:5493 | .cc-overlay-text | `background: rgba(0, 0, 0, 0.72)` | CC-PROTECTED | - | - | live value is rgba(0,0,0,0.72), NOT the 0.85 the amendment comment documents - comment-accuracy finding; protection unaffected |
| public/css/style.css:5679 | .audio-expanded .player-controls | `padding-bottom: calc(var(--space-2) + env(safe-area-inset-bottom, 0px))` | B1-PARTIAL-DONE | - | - | OPENER DONE 2026-07-31 - adopted members in place; this residual is deliberate and stays in the burn-down |
| public/css/style.css:6050 | .sub-row-pin-active | `color: #e0a800` | NO-TOKEN | - | - | deliberate era-invariant gold pin accent (documented) |
| public/css/style.css:6097 | .pinned-avatar-generated | `color: #fff` | SEMANTIC-RESIDUE | - | - |  |
| public/css/style.css:6213 | .hard-delete-modal-confirm-btn | `border-radius: calc(var(--radius) + 1px)` | RADIUS-DERIVED | - | - |  |
| public/css/style.css:6215 | .hard-delete-modal-confirm-btn | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand |
| public/css/style.css:6550 | .dl-status-chip-retry-btn, .dl-status-chip-dismiss-btn | `border-radius: calc(var(--radius) + 1px)` | RADIUS-DERIVED | - | - |  |
| public/css/style.css:6558 | .dl-status-chip-retry-btn | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand |
| public/css/style.css:6741 | .pinned-unpin-btn | `border-radius: 2px` | G-RADIUS-DONE-RAW | - | - | was 3px; 3g DONE 2026-07-31 - consolidated per-site per ruling B; the result is DELIBERATELY a raw 2/4px literal (no small-radius token exists - that design is Tier 4 R7), so the site stays in the burn-down as R7 population |
| public/css/style.css:6749 | .pinned-unpin-btn.armed | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand armed state |
| public/css/style.css:6838 | .books-shelf-chip.active | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand; mid-line |
| public/css/style.css:6901 | .reader-content.theme-paper | `background: #f7f4ec` | NO-TOKEN | - | - | user-selected reading theme |
| public/css/style.css:6902 | .reader-content.theme-sepia | `background: #f0e3c9` | NO-TOKEN | - | - | reading theme |
| public/css/style.css:6903 | .reader-content.theme-night | `background: #101014` | NO-TOKEN | - | - | reading theme |
| public/css/style.css:6916 | #reader-pane.pdf-scroll canvas | `box-shadow: 0 1px 6px rgba(0,0,0,0.35)` | SHADOW-OTHER | - | - | paper-page ambient shadow on PDF content, not UI elevation - no action |
| public/css/style.css:6923 | .reader-bottombar | `padding: var(--space-3) var(--space-5) calc(var(--space-3) + env(safe` | B1-PARTIAL-DONE | - | - | OPENER DONE 2026-07-31 - adopted members in place; this residual is deliberate and stays in the burn-down |
| public/css/style.css:6930 | .reader-progress-track | `border-radius: 3px` | RADIUS-GEOMETRY | - | - | half of 6px track height - never a token |
| public/css/style.css:8226 | .reader-np-cover | `border-radius: 4px` | G-RADIUS-DONE-RAW | - | - | was 3px; 3g DONE 2026-07-31 - consolidated per-site per ruling B; the result is DELIBERATELY a raw 2/4px literal (no small-radius token exists - that design is Tier 4 R7), so the site stays in the burn-down as R7 population |
| public/css/style.css:7252 | .reloc-preview-badge | `padding: 1px var(--space-3)` | B1-PARTIAL-DONE | - | - | OPENER DONE 2026-07-31 - adopted the member in place; the 1px hairline residual is deliberate and stays in the burn-down |
| public/css/style.css:7253 | .reloc-preview-badge | `border-radius: 2px` | G-RADIUS-DONE-RAW | - | - | was 3px; 3g DONE 2026-07-31 - consolidated per-site per ruling B; the result is DELIBERATELY a raw 2/4px literal (no small-radius token exists - that design is Tier 4 R7), so the site stays in the burn-down as R7 population |
| public/css/style.css:7316 | .login-wordmark .tube | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand |
| public/css/style.css:7384 | .login-submit | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand |
| public/css/style.css:7432 | .login-era-switch button[aria-pressed="true"] | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand |
| public/css/style.css:7697 | .music-eq i | `background: #fff` | SEMANTIC-RESIDUE | - | - | white EQ glyph-art bar; --on-overlay is a text token - semantic stretch, lean residue |
| public/css/style.css:7698 | .music-eq i | `border-radius: 1px` | RADIUS-GEOMETRY | - | - | 1px cap on 3px EQ bar |
| public/css/style.css:8006 | .attr-picker-avatar | `color: #fff` | SEMANTIC-RESIDUE | - | - | glyph over generated avatar color |
| public/css/style.css:8086 | .notif-bell-badge | `border-radius: 8px` | RADIUS-GEOMETRY | - | - | half of 16px badge height |
| public/css/style.css:8088 | .notif-bell-badge | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand |
| public/css/style.css:8191 | .notif-row-avatar-generated | `color: #fff` | SEMANTIC-RESIDUE | - | - |  |
| public/js/watch.js:1170 | applyAvatarToElement generated-avatar | `color: #ffffff` | SEMANTIC-RESIDUE | - | - | mirrors subscriptions.js:1378 |
| lib/ytdlp/client/subscriptions.js:1378 | renderChannelAvatar generated-avatar | `color: #ffffff` | SEMANTIC-RESIDUE | - | - | white glyph on AVATAR_PALETTE color, deliberately era-invariant |
