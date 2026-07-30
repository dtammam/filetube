# Tokens Tier 3 Step 3 - expected-delta ledger

GENERATED against main-era tree (branch tokens/tier3-ledgers, 2026-07-30)
from the three-way classification sweep; declaration cells are pulled LIVE
from the linter, judgment columns are the authored contract. Bound to the
tree by `npm run ledger:check` - run it before ANY 3a-3g commit; a red
checker means this file must be re-verified row by row against the diff
that moved it. Column 3 must stay byte-exact to the linter's report.

Conventions: HOLD-RATIFY / HOLD-EXEMPT-REC rows make NO change until
Dean's ruling (see the exec plan's open questions); scenes named in notes
are the Stop B witnesses; "on-device judgment" = transient state no scene
captures - listed in the Stop B packet instead. On adoption, strike the
first cell (`~~file:line~~`) so ledger-check ignores the completed row.

## 3a - B2 spacing drift consolidation (visible deltas, enumerated)

| file:line | selector / JS context | declaration (linter-exact) | bucket | proposed after | delta | notes |
|---|---|---|---|---|---|---|
| public/css/style.css:1035 | .sort-menu li | `padding: 7px 12px` | B2-DRIFT | padding: var(--space-3) var(--space-6) | 7px->6px | scene 07; 12px exact tokenized too |
| public/css/style.css:1067 | .video-grid | `margin-bottom: 30px` | B2-DRIFT | margin-bottom: var(--space-16) | 30px->32px | scene 06; 32 strictly nearest |
| public/css/style.css:1477 | .skeleton-row | `padding: 10px 14px` | B2-DRIFT | padding: var(--space-5) var(--space-6) | 14px->12px | transient loading state - no scene; on-device judgment |
| public/css/style.css:1781 | .art-play-glyph.art-play-glyph-playing::before | `margin-right: 9px` | B2-DRIFT | margin-right: var(--space-4) | 9px->8px | playing-state glyph offset - no scene; on-device judgment |
| public/css/style.css:2046 | .watch-prevnext-btn | `padding: 6px 14px` | B2-DRIFT | padding: var(--space-3) var(--space-6) | 14px->12px | scene 05; 6px exact tokenized too |
| public/css/style.css:2308 | .uploader-subs | `padding: 1px 7px` | B2-DRIFT | padding: 1px var(--space-3) | 7px->6px | scene 05; 1px hairline non-scale stays |
| public/css/style.css:2666 | .btn-busy::after | `margin-left: 7px` | B2-DRIFT | margin-left: var(--space-3) | 7px->6px | transient busy state - no scene; on-device judgment |
| public/css/style.css:2893 | .sub-row | `padding: 10px 14px` | B2-DRIFT | padding: var(--space-5) var(--space-6) | 14px->12px | scene 11; 10px exact tokenized too |
| public/css/style.css:3274 | .toast | `padding: 10px 18px` | B2-DRIFT | padding: var(--space-5) var(--space-8) | 18px->16px | scene 13-toast GATE-BLOCKER (3a only - the toast has NO scrim; scenes.js note corrected); 10px exact tokenized too |
| public/css/style.css:3342 | .oneoff-modal-header | `margin-bottom: 14px` | B2-DRIFT | margin-bottom: var(--space-6) | 14px->12px | scene 01 |
| public/css/style.css:3846 | .search-input | `padding: 7px 10px` | B2-DRIFT | padding: var(--space-3) var(--space-5) | 7px->6px | scene 06 (header); 10px exact tokenized too |
| public/css/style.css:4626 | .pp-icon-pause | `margin-right: 7px` | HOLD-EXEMPT-REC | - | (7px->6px if taken) | RECOMMEND EXEMPT: comment documents optical-centering against the shadow bar - glyph-art class, same family as Stop A Batch C exempts |
| public/css/style.css:5417 | .chapters-menu-item | `padding: 12px 14px` | B2-DRIFT | padding: var(--space-6) var(--space-6) | 14px->12px | chapters MENU has no scene (26-chapters-menu proposed); 12px exact tokenized too |
| public/css/style.css:5436 | .chapters-menu-loop | `padding: 12px 14px` | B2-DRIFT | padding: var(--space-6) var(--space-6) | 14px->12px | pairs with 5417 |
| public/css/style.css:6170 | .hard-delete-modal-path | `margin-bottom: 14px` | B2-DRIFT | margin-bottom: var(--space-6) | 14px->12px | scene 21 |
| public/css/style.css:6671 | .books-home-row | `margin-bottom: 18px` | B2-DRIFT | margin-bottom: var(--space-8) | 18px->16px | scene 15 |
| public/css/style.css:6818 | .books-shelf-chips | `margin-bottom: 14px` | B2-DRIFT | margin-bottom: var(--space-6) | 14px->12px | scene 15 |
| public/css/style.css:6848 | .books-section-title | `margin: 18px 0 10px` | B2-DRIFT | margin: var(--space-8) 0 var(--space-5) | 18px->16px | scene 15; 10px exact tokenized too; 0 stays |
| public/css/style.css:6953 | .reader-toc-item | `padding: 7px 4px` | B2-DRIFT | padding: var(--space-3) var(--space-2) | 7px->6px | scene 14 (TOC drawer needs open - partial); 4px exact tokenized too |
| public/css/style.css:7227 | .reloc-preview-group-title | `margin: 14px 0 6px` | B2-DRIFT | margin: var(--space-6) 0 var(--space-3) | 14px->12px | scene 18; 6px exact tokenized too; 0 stays |
| public/css/style.css:7311 | .login-wordmark .tube | `padding: 3px 9px` | B2-DRIFT | padding: var(--space-1) var(--space-4) | 3px->2px, 9px->8px | scene 25-login (NEW, added this tranche); 3->2 tie rounds down |
| public/css/style.css:7422 | .login-era-switch button | `padding: 4px 9px` | B2-DRIFT | padding: var(--space-2) var(--space-4) | 9px->8px | scene 25-login; 4px exact tokenized too |
| public/css/style.css:7464 | .users-row | `padding: 10px 14px` | B2-DRIFT | padding: var(--space-5) var(--space-6) | 14px->12px | scene 17; 10px exact tokenized too |
| public/css/style.css:7512 | .music-tab | `padding: 10px 14px` | B2-DRIFT | padding: var(--space-5) var(--space-6) | 14px->12px | scene 08; 10px exact tokenized too |
| public/css/style.css:7782 | .shortcuts-group | `margin-top: 14px` | B2-DRIFT | margin-top: var(--space-6) | 14px->12px | shortcuts modal has no scene; on-device judgment (? key, desktop) |
| public/css/style.css:8237 | .notif-empty | `padding: 28px 16px` | B2-DRIFT | padding: var(--space-12) var(--space-8) | 28px->24px | scene 12b only if the feed is empty - likely on-device judgment; 16px exact tokenized too |

## 3a annex - Batch A offset exemptions (token-exempt annotations only, zero value changes)

| file:line | selector / JS context | declaration (linter-exact) | bucket | proposed after | delta | notes |
|---|---|---|---|---|---|---|
| public/css/style.css:768 | .sidebar | `top: 56px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1019 | .sort-menu | `top: calc(100% + 4px)` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1121 | .duration-badge | `bottom: 4px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1122 | .duration-badge | `right: 4px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1157 | .card-delete-btn | `top: 6px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1158 | .card-delete-btn | `right: 6px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1211 | .card-download-btn | `top: 6px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1212 | .card-download-btn | `left: 6px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1247 | .card-like-btn | `bottom: 6px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1248 | .card-like-btn | `left: 6px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1321 | .ptr-indicator | `top: calc(var(--mobile-header-h, 56px) + 8px)` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1606 | #player-dock | `right: 16px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1607 | #player-dock | `bottom: 16px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1655 | .player-dock-close | `top: 4px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1656 | .player-dock-close | `right: 4px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1677 | #player-dock (mobile) | `right: 8px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1683 | #player-dock (mobile) | `bottom: calc(var(--mobile-bottom-nav-h) + 8px)` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1690 | .toast (mobile) | `bottom: calc(var(--mobile-bottom-nav-h) + 12px)` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:1928 | .speed-badge | `top: 12px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:2115 | .watch-autoplay-thumb | `top: 2px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:2116 | .watch-autoplay-thumb | `left: 2px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:3268 | .toast | `bottom: calc(24px + env(safe-area-inset-bottom, 0px))` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:5135 | #audio-bg-art (strip reserve) | `bottom: 40px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:5155 | #audio-bg-art (dock strip) | `bottom: 80px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:5158 | #audio-bg-art (mobile strip) | `bottom: 44px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:5175 | #audio-bg-art (dock) | `bottom: 26px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:5274 | .chapters-menu | `right: 8px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:5275 | .chapters-menu | `bottom: calc(100% + 6px)` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:5410 | .chapters-menu (mobile) | `left: 8px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:5411 | .chapters-menu (mobile) | `right: 8px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:5475 | .cc-overlay | `bottom: 40px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:5500 | .cc-overlay (mobile) | `bottom: 44px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:5505 | #player-dock .cc-overlay | `bottom: 26px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:5651 | #audio-bg-art (expanded) | `bottom: calc(52px + env(safe-area-inset-bottom, 0px))` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:5681 | .cc-overlay (expanded) | `bottom: calc(56px + env(safe-area-inset-bottom, 0px))` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:5687 | .cc-overlay (expanded mobile) | `bottom: calc(94px + env(safe-area-inset-bottom, 0px))` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:5691 | #audio-bg-art (expanded mobile) | `bottom: calc(94px + env(safe-area-inset-bottom, 0px))` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:6255 | #dl-status-chip | `left: 16px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:6256 | #dl-status-chip | `bottom: 16px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:6573 | #dl-status-chip (mobile) | `left: 8px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:6574 | #dl-status-chip (mobile) | `bottom: calc(var(--mobile-bottom-nav-h) + 8px)` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:7047 | #reader-np-next .reader-np-ico::after | `left: 12px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:7056 | #reader-np-prev .reader-np-ico::after | `right: 12px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:7094 | .reader-nowplaying (mobile) | `bottom: calc(54px + env(safe-area-inset-bottom))` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:7553 | .music-drill-sticky | `top: var(--music-sticky-top, 56px)` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:8107 | .notif-panel | `top: 64px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:8108 | .notif-panel | `right: 16px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:8251 | header .header-right | `top: calc(10px + env(safe-area-inset-top))` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |
| public/css/style.css:8252 | header .header-right | `right: 10px` | A-OFFSET-EXEMPT | token-exempt annotation | - | positional geometry (Stop A Batch A; 49 found vs the 26 flagged - see plan OQ4) |

## 3b - B1 mixed-shorthand member adoption + exact adoptions (zero-delta; differ must report EQUIVALENT)

| file:line | selector / JS context | declaration (linter-exact) | bucket | proposed after | delta | notes |
|---|---|---|---|---|---|---|
| public/css/style.css:799 | .sidebar-item | `padding: var(--density) 24px` | B1-MIXED | padding: var(--density) var(--space-12) | none |  |
| public/css/style.css:1279 | .video-info | `padding: var(--density) 4px` | B1-MIXED | padding: var(--density) var(--space-2) | none |  |
| public/css/style.css:1516 | .empty-state, .error-state | `padding: 40px 20px` | B1-MIXED | padding: 40px var(--space-10) | none | 40px non-scale stays |
| public/css/style.css:1964 | .embedded-tag | `margin: 2px 0` | B1-MIXED | margin: var(--space-1) 0 | none |  |
| public/css/style.css:2554 | .setup-box | `margin: 32px auto` | B1-MIXED | margin: var(--space-16) auto | none |  |
| public/css/style.css:3927 | header (mobile) | `padding: calc(8px + env(safe-area-inset-top)) 8px 8px` | B1-MIXED | padding: calc(var(--space-4) + env(safe-area-inset-top)) var(--space-4) var(--space-4) | none |  |
| public/css/style.css:4167 | .setup-box (mobile) | `margin: 20px auto` | B1-MIXED | margin: var(--space-10) auto | none |  |
| public/css/style.css:5231 | #player-wrapper.css-fullscreen .player-controls | `padding-bottom: calc(4px + env(safe-area-inset-bottom, 0px))` | B1-MIXED | padding-bottom: calc(var(--space-2) + env(safe-area-inset-bottom, 0px)) | none | single-value calc, member inside calc |
| public/css/style.css:5673 | .audio-expanded .player-controls | `padding-bottom: calc(4px + env(safe-area-inset-bottom, 0px))` | B1-MIXED | padding-bottom: calc(var(--space-2) + env(safe-area-inset-bottom, 0px)) | none | single-value calc |
| public/css/style.css:6907 | #reader-pane.pdf-scroll canvas | `margin: 8px auto` | B1-MIXED | margin: var(--space-4) auto | none |  |
| public/css/style.css:6917 | .reader-bottombar | `padding: 6px 10px calc(6px + env(safe-area-inset-bottom, 0px))` | B1-MIXED | padding: var(--space-3) var(--space-5) calc(var(--space-3) + env(safe-area-inset-bottom, 0px)) | none |  |
| public/css/style.css:6950 | .reader-drawer h3 | `margin: 4px 0 10px` | B1-MIXED | margin: var(--space-2) 0 var(--space-5) | none |  |
| public/css/style.css:7015 | .reader-nowplaying | `padding: 6px 10px calc(6px + env(safe-area-inset-bottom))` | B1-MIXED | padding: var(--space-3) var(--space-5) calc(var(--space-3) + env(safe-area-inset-bottom)) | none |  |
| public/css/style.css:7021 | .reader-np-info | `gap: 8px` | EXACT-ADOPT | gap: var(--space-4) | none | gap declarations were skipped wholesale by Tier 2 |
| public/css/style.css:7031 | .reader-np-transport | `gap: 8px` | EXACT-ADOPT | gap: var(--space-4) | none |  |
| public/css/style.css:7246 | .reloc-preview-badge | `padding: 1px 6px` | B1-MIXED | padding: 1px var(--space-3) | none | 1px hairline stays |
| public/css/style.css:7496 | .music-toolbar-actions | `gap: 8px` | EXACT-ADOPT | gap: var(--space-4) | none |  |
| public/css/style.css:7522 | .music-crumb | `gap: 10px` | EXACT-ADOPT | gap: var(--space-5) | none | single-line rule, two governed decls |
| public/css/style.css:7522 | .music-crumb | `margin-bottom: 12px` | EXACT-ADOPT | margin-bottom: var(--space-6) | none |  |
| public/css/style.css:7533 | .music-drill-header | `gap: 12px` | EXACT-ADOPT | gap: var(--space-6) | none |  |
| public/css/style.css:7533 | .music-drill-header | `margin-bottom: 12px` | EXACT-ADOPT | margin-bottom: var(--space-6) | none |  |
| public/css/style.css:7535 | .music-drill-heading | `gap: 16px` | EXACT-ADOPT | gap: var(--space-8) | none |  |
| public/css/style.css:7545 | .music-drill-info | `gap: 6px` | EXACT-ADOPT | gap: var(--space-3) | none |  |
| public/css/style.css:7549 | .music-drill-actions | `gap: 8px` | EXACT-ADOPT | gap: var(--space-4) | none |  |
| public/css/style.css:7549 | .music-drill-actions | `margin-top: 8px` | EXACT-ADOPT | margin-top: var(--space-4) | none |  |
| public/css/style.css:7722 | .music-empty | `padding: 24px 0` | B1-MIXED | padding: var(--space-12) 0 | none |  |

## 3c - scrim consolidation + on-overlay chrome adoption

| file:line | selector / JS context | declaration (linter-exact) | bucket | proposed after | delta | notes |
|---|---|---|---|---|---|---|
| public/css/style.css:1123 | .duration-badge | `background-color: rgba(0,0,0,0.85)` | HOLD-RATIFY | background-color: var(--scrim-heavy) | 0.85->0.8 | over arbitrary thumbnail art - same legibility argument as the protected cc floor; Dean ratifies before consolidation (plan OQ5) |
| public/css/style.css:1124 | .duration-badge | `color: white` | ON-OVERLAY-ADOPT | color: var(--on-overlay) | none | survived Tier 2 via `white` spelling |
| public/css/style.css:1166 | .card-delete-btn | `background-color: rgba(0, 0, 0, 0.6)` | SCRIM-DRIFT | background-color: var(--scrim) | 0.6->0.55 | scene 06 hover |
| public/css/style.css:1167 | .card-delete-btn | `color: #fff` | ON-OVERLAY-ADOPT | color: var(--on-overlay) | none |  |
| public/css/style.css:1220 | .card-download-btn | `background-color: rgba(0, 0, 0, 0.6)` | SCRIM-DRIFT | background-color: var(--scrim) | 0.6->0.55 | scene 06 hover |
| public/css/style.css:1221 | .card-download-btn | `color: #fff` | ON-OVERLAY-ADOPT | color: var(--on-overlay) | none |  |
| public/css/style.css:1256 | .card-like-btn | `background-color: rgba(0, 0, 0, 0.6)` | SCRIM-DRIFT | background-color: var(--scrim) | 0.6->0.55 | scene 06 hover |
| public/css/style.css:1257 | .card-like-btn | `color: #fff` | ON-OVERLAY-ADOPT | color: var(--on-overlay) | none |  |
| public/css/style.css:1664 | .player-dock-close | `background: rgba(0, 0, 0, 0.6)` | SCRIM-DRIFT | background: var(--scrim) | 0.6->0.55 | dock state - on-device judgment; :hover sibling already var(--scrim-heavy) |
| public/css/style.css:1665 | .player-dock-close | `color: #fff` | ON-OVERLAY-ADOPT | color: var(--on-overlay) | none |  |
| public/css/style.css:1875 | .resume-overlay | `background-color: rgba(0,0,0,0.85)` | SCRIM-DRIFT | background-color: var(--scrim-heavy) | 0.85->0.8 | scene 04-resume GATE-BLOCKER (value corrected: .85 not the .75 scenes.js claimed) |
| public/css/style.css:1881 | .resume-overlay | `color: white` | ON-OVERLAY-ADOPT | color: var(--on-overlay) | none | `white` spelling |
| public/css/style.css:1893 | .resume-overlay p | `color: #ccc` | ON-OVERLAY-ADOPT | color: var(--on-overlay-muted) | none | #ccc exact |
| public/css/style.css:1931 | .speed-badge | `background: rgba(0, 0, 0, 0.75)` | SCRIM-DRIFT | background: var(--scrim-heavy) | 0.75->0.8 | press-hold 2x state - on-device judgment |
| public/css/style.css:1932 | .speed-badge | `color: #fff` | ON-OVERLAY-ADOPT | color: var(--on-overlay) | none |  |
| public/css/style.css:1979 | .skip-btn | `color: #fff` | ON-OVERLAY-ADOPT | color: var(--on-overlay) | none | bg already var(--scrim) |
| public/css/style.css:1998 | .skip-btn:hover | `background: rgba(0, 0, 0, 0.8)` | SCRIM-EXACT | background: var(--scrim-heavy) | none | the known mid-line adoption-tooling gap |
| public/css/style.css:2010 | .skip-ripple | `color: #fff` | ON-OVERLAY-ADOPT | color: var(--on-overlay) | none |  |
| public/css/style.css:3181 | .modal-backdrop | `background-color: rgba(0,0,0,0.5)` | SCRIM-DRIFT | background-color: var(--scrim) | 0.5->0.55 | scene 21 (confirm step) + any modal |
| public/css/style.css:3301 | .oneoff-modal-backdrop | `background-color: rgba(0, 0, 0, 0.5)` | SCRIM-DRIFT | background-color: var(--scrim) | 0.5->0.55 | scene 01 |
| public/css/style.css:3974 | .playlists-sheet-backdrop:not([hidden]) | `background: rgba(0, 0, 0, 0.5)` | SCRIM-DRIFT | background: var(--scrim) | 0.5->0.55 | playlists sheet has no scene - on-device judgment (phone) |
| public/css/style.css:5235 | .css-fullscreen .player-controls | `background: rgba(0, 0, 0, 0.75)` | SCRIM-DRIFT | background: var(--scrim-heavy) | 0.75->0.8 | fullscreen state - on-device judgment |
| public/css/style.css:5488 | .cc-overlay-text | `color: #fff` | ON-OVERLAY-ADOPT | color: var(--on-overlay) | none | amendment protects the BACKGROUND only; adjacency noted |
| public/css/style.css:5791 | .sub-sheet-backdrop | `background: rgba(0, 0, 0, 0.5)` | SCRIM-DRIFT | background: var(--scrim) | 0.5->0.55 | scene 12 |
| public/css/style.css:6120 | .hard-delete-modal-backdrop | `background-color: rgba(0, 0, 0, 0.65)` | HOLD-RATIFY | background-color: var(--scrim) | 0.65->0.55 (or 0.8) | NON-enumerated alpha between both tokens; heavier dim on a destructive modal may be intentional focus - Dean rules (plan OQ5); scene 21 |
| public/css/style.css:6707 | .book-row-progress | `background: rgba(0, 0, 0, 0.5)` | HOLD-RATIFY | background: var(--scrim) | 0.5->0.55 | progress TRACK not a scrim - semantic coupling question; video counterpart uses white 0.3 (plan OQ5); scene 15 |
| public/css/style.css:6792 | .book-progress-track | `background: rgba(0, 0, 0, 0.5)` | HOLD-RATIFY | background: var(--scrim) | 0.5->0.55 | same question as 6707; scene 15 |
| public/css/style.css:7685 | .music-eq | `background: rgba(0, 0, 0, 0.45)` | HOLD-RATIFY | background: var(--scrim) | 0.45->0.55 | NON-enumerated alpha; visible darkening on 44px playing-thumb art (plan OQ5); playing state - on-device judgment |
| public/css/style.css:8264 | .notif-panel-backdrop:not([hidden]) | `background: rgba(0, 0, 0, 0.5)` | SCRIM-DRIFT | background: var(--scrim) | 0.5->0.55 | scene 12b phone |

## 3d - shadow elevation consolidation

| file:line | selector / JS context | declaration (linter-exact) | bucket | proposed after | delta | notes |
|---|---|---|---|---|---|---|
| public/css/style.css:1813 | .audio-artwork | `box-shadow: 0 8px 24px rgba(0,0,0,0.5)` | SHADOW-ELEVATION | box-shadow: var(--shadow-modal) | alpha 0.5->0.45 | scene 10-audio-expanded GATE-BLOCKER; geometry exact match; decorative-depth semantics flagged |
| public/css/style.css:1825 | .audio-vinyl | `box-shadow: 0 8px 24px rgba(0,0,0,0.6)` | SHADOW-ELEVATION | box-shadow: var(--shadow-modal) | alpha 0.6->0.45 | scene 10-audio-expanded GATE-BLOCKER; sibling staging (0.6 vs 0.5) collapses - flagged |
| public/css/style.css:5283 | .chapters-menu | `box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35)` | SHADOW-ELEVATION | box-shadow: var(--shadow-modal) | y 4->8px, blur 14->24px, alpha 0.35->0.45 | every component drifts - visibly heavier; chapters menu has no scene (26 proposed) |
| public/css/style.css:6910 | #reader-pane.pdf-scroll canvas | `box-shadow: 0 1px 6px rgba(0,0,0,0.35)` | SHADOW-OTHER | - | - | paper-page ambient shadow on PDF content, not UI elevation - no action |
| public/css/style.css:7184 | .reloc-preview-panel | `box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4)` | SHADOW-ELEVATION | box-shadow: var(--shadow-modal) | y 4->8px, alpha 0.4->0.45 | scene 18 |
| public/css/style.css:8115 | .notif-panel | `box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25)` | SHADOW-ELEVATION | box-shadow: var(--shadow-modal) | y 4->8px, alpha 0.25->0.45 (near-double) | scene 12b desktop - the visible risk in this batch |

## 3e - motion consolidation (deltas are timing FEEL - invisible to frozen-state captures; Stop B judges on-device)

| file:line | selector / JS context | declaration (linter-exact) | bucket | proposed after | delta | notes |
|---|---|---|---|---|---|---|
| public/css/style.css:490 | body | `transition: background-color 0.2s, color 0.2s` | MOTION-DRIFT | background-color var(--dur-fast), color var(--dur-fast) | 0.2->0.15 x2 | 0.2 TIE cluster; theme-swap fade |
| public/css/style.css:700 | .btn | `transition: background-color var(--dur-fast) var(--ease-ui), border-colo` | MOTION-DRIFT | transform member -> var(--dur-fast) | 0.1->0.15 | 3 of 4 members already tokenized; press feedback |
| public/css/style.css:773 | .sidebar | `transition: transform 0.2s` | MOTION-DRIFT | transform var(--dur-fast) | 0.2->0.15 | 0.2 TIE; MUST flip with .main-content:907 or drawer/content desync |
| public/css/style.css:907 | .main-content | `transition: margin-left 0.2s` | MOTION-DRIFT | margin-left var(--dur-fast) | 0.2->0.15 | 0.2 TIE; pair of 773 |
| public/css/style.css:1343 | .ptr-indicator .icon-refresh | `transition: transform 0.08s linear` | HOLD-EXEMPT-REC | - | (0.08->0.15 = near-double lag if taken) | RECOMMEND EXEMPT: continuous pull-gesture tracking, not a UI transition; +0.07s lags the finger |
| public/css/style.css:1983 | .skip-btn | `transition: opacity 0.2s var(--ease-ui), transform var(--dur-fast) var(-` | MOTION-DRIFT | opacity var(--dur-fast) var(--ease-ui), background var(--dur-fast) var(--ease-ui) | 0.2->0.15 x2 | 0.2 TIE; transform member already tokenized |
| public/css/style.css:2055 | .watch-prevnext-btn | `transition: background-color var(--dur-fast) var(--ease-ui), border-colo` | MOTION-DRIFT | transform member -> var(--dur-fast) | 0.1->0.15 | same shape as .btn:700 |
| public/css/style.css:2202 | .star | `transition: color 0.1s` | MOTION-DRIFT | color var(--dur-fast) | 0.1->0.15 | rating-star hover |
| public/css/style.css:3193 | .modal-backdrop | `transition: opacity 0.2s ease-out` | MOTION-DRIFT | opacity var(--dur-fast) ease-out | 0.2->0.15 | 0.2 TIE; ease-out stays literal (no token covers it); pair of 3226 |
| public/css/style.css:3226 | .modal-content | `transition: transform 0.2s ease-out` | MOTION-DRIFT | transform var(--dur-fast) ease-out | 0.2->0.15 | 0.2 TIE; entrance pair of 3193 |
| public/css/style.css:3976 | .playlists-sheet-backdrop (mobile) | `transition: opacity 0.2s ease-out` | MOTION-DRIFT | opacity var(--dur-fast) ease-out | 0.2->0.15 | 0.2 TIE; pair of 4003 |
| public/css/style.css:4003 | .playlists-sheet (mobile) | `transition: transform 0.2s ease-out` | MOTION-DRIFT | transform var(--dur-fast) ease-out | 0.2->0.15 | 0.2 TIE; slide-up pair of 3976 |
| public/css/style.css:5802 | .sub-sheet-backdrop | `transition: opacity 0.2s ease-out` | MOTION-DRIFT | opacity var(--dur-fast) ease-out | 0.2->0.15 | 0.2 TIE; pair of 5825 |
| public/css/style.css:5825 | .sub-sheet | `transition: transform 0.2s ease-out` | MOTION-DRIFT | transform var(--dur-fast) ease-out | 0.2->0.15 | 0.2 TIE; pair of 5802 |
| public/css/style.css:6434 | .dl-status-chip-progress-fill | `transition: width 300ms linear` | MOTION-DRIFT | width var(--dur-slow) linear | 300ms->0.25s | linear deliberate for progress interpolation - stays literal |
| public/css/style.css:7385 | .login-submit | `transition: filter 0.12s var(--ease-ui)` | MOTION-DRIFT | filter var(--dur-fast) var(--ease-ui) | 0.12->0.15 | easing already tokenized |
| public/css/style.css:8267 | .notif-panel-backdrop (mobile) | `transition: opacity 0.2s var(--ease-ui)` | MOTION-DRIFT | opacity var(--dur-fast) var(--ease-ui) | 0.2->0.15 | 0.2 TIE |

## 3f - JS-surface adoptions (v5 scope)

| file:line | selector / JS context | declaration (linter-exact) | bucket | proposed after | delta | notes |
|---|---|---|---|---|---|---|
| public/js/setup.js:618 | bottombar-editor toggle label cssText | `gap: 6px` | JS-ADOPT | gap: var(--space-3) | none |  |
| public/js/stats.js:161 | buildBreakdownRow cssText | `gap: 10px` | JS-ADOPT | gap: var(--space-5) | none |  |
| public/js/stats.js:161 | buildBreakdownRow cssText | `padding: 8px 4px` | JS-ADOPT | padding: var(--space-4) var(--space-2) | none |  |
| public/js/stats.js:164 | buildBreakdownRow labelEl cssText | `font-weight: bold` | FW-JS-ADOPT | font-weight:var(--fw-bold) | none (bold==700) |  |
| public/js/stats.js:215 | mostWatched row cssText | `gap: 10px` | JS-ADOPT | gap: var(--space-5) | none |  |
| public/js/stats.js:215 | mostWatched row cssText | `padding: 8px 4px` | JS-ADOPT | padding: var(--space-4) var(--space-2) | none |  |
| public/js/stats.js:260 | duplicates renderSection header cssText | `font-weight: bold` | FW-JS-ADOPT | font-weight:var(--fw-bold) | none (bold==700) |  |
| public/js/stats.js:260 | duplicates renderSection header cssText | `padding: 10px 4px 4px` | JS-ADOPT | padding: var(--space-5) var(--space-2) var(--space-2) | none |  |
| public/js/stats.js:265 | duplicates group row cssText | `padding: 8px 4px` | JS-ADOPT | padding: var(--space-4) var(--space-2) | none |  |
| public/js/stats.js:278 | duplicate item pathLine cssText | `padding-left: 12px` | JS-ADOPT | padding-left: var(--space-6) | none |  |
| public/js/stats.js:313 | buildBookFolderRow cssText | `gap: 10px` | JS-ADOPT | gap: var(--space-5) | none |  |
| public/js/stats.js:313 | buildBookFolderRow cssText | `padding: 8px 4px` | JS-ADOPT | padding: var(--space-4) var(--space-2) | none |  |
| public/js/stats.js:316 | buildBookFolderRow labelEl cssText | `font-weight: bold` | FW-JS-ADOPT | font-weight:var(--fw-bold) | none (bold==700) |  |
| public/js/stats.js:347 | buildRepoLink cssText | `font-weight: bold` | FW-JS-ADOPT | font-weight:var(--fw-bold) | none (bold==700) | same cssText already consumes a var() today - proven pattern |
| public/js/stats.js:354 | buildAboutRow row cssText | `gap: 10px` | JS-ADOPT | gap: var(--space-5) | none |  |
| public/js/stats.js:354 | buildAboutRow row cssText | `padding: 8px 4px` | JS-ADOPT | padding: var(--space-4) var(--space-2) | none |  |
| public/js/stats.js:357 | buildAboutRow labelEl cssText | `font-weight: bold` | FW-JS-ADOPT | font-weight:var(--fw-bold) | none (bold==700) |  |
| public/js/stats.js:389 | About GitHub links row cssText | `gap: 16px` | JS-ADOPT | gap: var(--space-8) | none |  |
| public/js/stats.js:389 | About GitHub links row cssText | `padding: 14px 4px 4px` | JS-DRIFT | padding: var(--space-6) var(--space-2) var(--space-2) | 14px->12px | scene 16 - the one visible JS delta |
| public/js/watch.js:635 | .watch-view-error cssText | `padding: 24px 16px` | JS-ADOPT | padding: var(--space-12) var(--space-8) | none |  |
| public/js/watch.js:638 | error heading style.marginBottom | `margin-bottom: 12px` | JS-ADOPT | margin-bottom: var(--space-6) | none |  |
| public/js/watch.js:647 | error backLink style.marginTop | `margin-top: 16px` | JS-ADOPT | margin-top: var(--space-8) | none |  |
| public/js/watch.js:1921 | pinBtn.style.marginLeft | `margin-left: 8px` | JS-ADOPT | margin-left: var(--space-4) | none |  |
| public/js/watch.js:2129 | comments empty-state cssText | `padding: 12px 0` | JS-ADOPT | padding: var(--space-6) 0 | none |  |

## 3g - line-height band

| file:line | selector / JS context | declaration (linter-exact) | bucket | proposed after | delta | notes |
|---|---|---|---|---|---|---|
| lib/ytdlp/views/subscriptions.html:94 | .sub-list-header-status (page style) | `line-height: 1.25` | LH-EXACT | line-height: var(--lh-tight) | none | comment arithmetic 12*1.25=15 vs min-height:15px becomes token-coupled - comment must be updated in the same commit |
| public/css/style.css:489 | body | `line-height: 1.4` | HOLD-EXEMPT-REC | - | (1.4->1.5 if taken) | RECOMMEND EXEMPT: global body base - site-wide deliberate tuning, reflows everything; subscriptions.html:86 cites the 1.4 by value (plan OQ6) |
| public/css/style.css:1389 | .video-title | `line-height: 1.3` | LH-DRIFT | line-height: var(--lh-tight) | 1.3->1.25 | scene 06; 2-line clamp height shrinks slightly |
| public/css/style.css:2312 | .uploader-subs | `line-height: 1.5` | LH-EXACT | line-height: var(--lh-relaxed) | none |  |
| public/css/style.css:2522 | .related-title | `line-height: 1.3` | LH-DRIFT | line-height: var(--lh-tight) | 1.3->1.25 | scene 05 |
| public/css/style.css:2575 | .setup-box p | `line-height: 1.5` | LH-EXACT | line-height: var(--lh-relaxed) | none |  |
| public/css/style.css:2635 | .action-status | `line-height: 1.25` | LH-EXACT | line-height: var(--lh-tight) | none | subscriptions.html:94 pins the same value to match this class |
| public/css/style.css:5491 | .cc-overlay-text | `line-height: 1.35` | HOLD-EXEMPT-REC | - | (1.35->1.25 if taken) | RECOMMEND EXEMPT: caption legibility surface adjacent to the protected background - same floor rationale (plan OQ6) |
| public/css/style.css:6714 | .book-row-title | `line-height: 1.25` | LH-EXACT | line-height: var(--lh-tight) | none |  |
| public/css/style.css:7828 | .shortcuts-modal kbd | `line-height: 1.5` | LH-EXACT | line-height: var(--lh-relaxed) | none |  |
| public/css/style.css:8209 | .notif-row-title | `line-height: 1.3` | LH-DRIFT | line-height: var(--lh-tight) | 1.3->1.25 | scene 12b |

## No-action census (Tier 4 residue, protected, geometry, layout constants - completeness rows for ledger-check)

| file:line | selector / JS context | declaration (linter-exact) | bucket | proposed after | delta | notes |
|---|---|---|---|---|---|---|
| lib/ytdlp/client/subscriptions.js:1378 | renderChannelAvatar generated-avatar | `color: #ffffff` | SEMANTIC-RESIDUE | - | - | white glyph on AVATAR_PALETTE color, deliberately era-invariant |
| public/css/style.css:536 | header | `z-index: 1000` | Z-LADDER-TIER4 | per z-ladder-coopen-enumeration.md | - | deployed value 1000 |
| public/css/style.css:587 | .logo span.tube | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand wordmark |
| public/css/style.css:729 | .btn-primary | `color: white` | SEMANTIC-RESIDUE | - | - | white-on-brand |
| public/css/style.css:757 | .app-container | `padding-top: 56px` | LAYOUT-CONSTANT | - | - | 56px header offset |
| public/css/style.css:904 | .main-content | `margin-left: 230px` | LAYOUT-CONSTANT | - | - | 230px sidebar width |
| public/css/style.css:1137 | .progress-bar-container | `background-color: rgba(255, 255, 255, 0.3)` | NO-TOKEN | - | - | translucent WHITE watch-progress track |
| public/css/style.css:1609 | #player-dock | `z-index: 950` | Z-LADDER-TIER4 | per z-ladder-coopen-enumeration.md | - | deployed value 950 |
| public/css/style.css:1769 | .art-play-glyph::before | `filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6))` | NO-TOKEN | - | - | drop-shadow() glyph art |
| public/css/style.css:1803 | .audio-player-visual | `background: radial-gradient(circle, #2c3e50 0%, #0f171e 100%)` | NO-TOKEN | - | - | decorative gradient art |
| public/css/style.css:1804 | .audio-player-visual | `color: white` | SEMANTIC-RESIDUE | - | - | text on gradient art |
| public/css/style.css:1816 | .audio-artwork | `border: 2px solid rgba(255,255,255,0.2)` | NO-TOKEN | - | - | artwork border |
| public/css/style.css:1842 | .audio-vinyl::after | `border: 3px solid white` | NO-TOKEN | - | - | vinyl spindle art |
| public/css/style.css:1865 | .audio-subtitle | `color: #aaa` | NO-TOKEN | - | - | #aaa on art surface; --on-overlay-muted is #ccc = visible delta, no zero-delta adoption exists |
| public/css/style.css:1906 | .transcode-spinner | `border: 4px solid rgba(255, 255, 255, 0.25)` | NO-TOKEN | - | - | spinner ring art |
| public/css/style.css:1934 | .speed-badge | `border-radius: 14px` | RADIUS-DRIFT | - | - | 14px band |
| public/css/style.css:2013 | .skip-ripple | `background: rgba(255, 255, 255, 0.14)` | NO-TOKEN | - | - | white ripple wash |
| public/css/style.css:2047 | .watch-prevnext-btn | `border-radius: calc(var(--radius) + 1px)` | RADIUS-DERIVED | - | - | calc(var(--radius) + 1px) nested-corner - already token-derived |
| public/css/style.css:2119 | .watch-autoplay-thumb | `background-color: #fff` | SEMANTIC-RESIDUE | - | - | toggle knob, form control |
| public/css/style.css:2265 | .uploader-avatar | `color: white` | SEMANTIC-RESIDUE | - | - | glyph over generated avatar color |
| public/css/style.css:3185 | .modal-backdrop | `z-index: 2000` | Z-LADDER-TIER4 | per z-ladder-coopen-enumeration.md | - | deployed value 2000 |
| public/css/style.css:3270 | .toast | `z-index: 2200` | Z-LADDER-TIER4 | per z-ladder-coopen-enumeration.md | - | deployed value 2200 |
| public/css/style.css:3305 | .oneoff-modal-backdrop | `z-index: 2100` | Z-LADDER-TIER4 | per z-ladder-coopen-enumeration.md | - | deployed value 2100 |
| public/css/style.css:3869 | .bottom-nav (mobile) | `z-index: 900` | Z-LADDER-TIER4 | per z-ladder-coopen-enumeration.md | - | deployed value 900 |
| public/css/style.css:3973 | .playlists-sheet-backdrop (mobile) | `z-index: 1500` | Z-LADDER-TIER4 | per z-ladder-coopen-enumeration.md | - | deployed value 1500 |
| public/css/style.css:3992 | .playlists-sheet (mobile) | `z-index: 1501` | Z-LADDER-TIER4 | per z-ladder-coopen-enumeration.md | - | deployed value 1501 |
| public/css/style.css:5104 | #player-wrapper:not(.audio-expanded) | `padding-bottom: 40px` | LAYOUT-CONSTANT | - | - | 40px control-strip reserve |
| public/css/style.css:5143 | #player-slot #player-wrapper | `padding-bottom: 80px` | LAYOUT-CONSTANT | - | - | 80px two-row strip reserve |
| public/css/style.css:5146 | #player-wrapper (mobile) | `padding-bottom: 44px` | LAYOUT-CONSTANT | - | - | 44px strip mirror (not a control height context) |
| public/css/style.css:5172 | #player-dock #player-wrapper | `padding-bottom: 26px` | LAYOUT-CONSTANT | - | - | 26px mini-bar reserve |
| public/css/style.css:5201 | #player-wrapper.css-fullscreen | `z-index: 1500` | Z-LADDER-TIER4 | per z-ladder-coopen-enumeration.md | - | deployed value 1500 |
| public/css/style.css:5487 | .cc-overlay-text | `background: rgba(0, 0, 0, 0.72)` | CC-PROTECTED | NEVER | - | live value is rgba(0,0,0,0.72), NOT the 0.85 the amendment comment documents - comment-accuracy finding; protection unaffected |
| public/css/style.css:5493 | .cc-overlay-text | `border-radius: 4px` | RADIUS-R7-RAW | - | - | 4px |
| public/css/style.css:5625 | .audio-expanded | `z-index: 1100` | Z-LADDER-TIER4 | per z-ladder-coopen-enumeration.md | - | deployed value 1100 |
| public/css/style.css:5790 | .sub-sheet-backdrop | `z-index: 1600` | Z-LADDER-TIER4 | per z-ladder-coopen-enumeration.md | - | deployed value 1600 |
| public/css/style.css:6044 | .sub-row-pin-active | `color: #e0a800` | NO-TOKEN | - | - | deliberate era-invariant gold pin accent (documented) |
| public/css/style.css:6091 | .pinned-avatar-generated | `color: #fff` | SEMANTIC-RESIDUE | - | - |  |
| public/css/style.css:6124 | .hard-delete-modal-backdrop | `z-index: 2250` | Z-LADDER-TIER4 | per z-ladder-coopen-enumeration.md | - | deployed value 2250 |
| public/css/style.css:6207 | .hard-delete-modal-confirm-btn | `border-radius: calc(var(--radius) + 1px)` | RADIUS-DERIVED | - | - |  |
| public/css/style.css:6209 | .hard-delete-modal-confirm-btn | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand |
| public/css/style.css:6257 | #dl-status-chip | `z-index: 940` | Z-LADDER-TIER4 | per z-ladder-coopen-enumeration.md | - | deployed value 940 |
| public/css/style.css:6544 | .dl-status-chip-retry-btn, .dl-status-chip-dismiss-btn | `border-radius: calc(var(--radius) + 1px)` | RADIUS-DERIVED | - | - |  |
| public/css/style.css:6552 | .dl-status-chip-retry-btn | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand |
| public/css/style.css:6698 | .book-row-cover | `border-radius: 4px` | RADIUS-R7-RAW | - | - | 4px |
| public/css/style.css:6700 | .book-row-cover | `background: var(--thumbnail-bg, #222)` | PHANTOM-THUMBNAIL-BG | - | - | ghost --thumbnail-bg (defined nowhere, #222 fallback paints) - NEW phantom family x6, Tier 4 disposition needed (plan OQ7) |
| public/css/style.css:6709 | .book-row-progress-fill | `background: var(--accent, #cc0000)` | TIER4-GHOST-RED | var(--yt-red) at Tier 4 | 2014 era: #cc0000->#e62117 | scene 23 |
| public/css/style.css:6735 | .pinned-unpin-btn | `border-radius: 3px` | RADIUS-DRIFT | - | - | 3px |
| public/css/style.css:6742 | .pinned-unpin-btn.armed | `background: var(--accent, #cc0000)` | TIER4-GHOST-RED | var(--yt-red) at Tier 4 | 2014 era only | armed state - on-device |
| public/css/style.css:6743 | .pinned-unpin-btn.armed | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand armed state |
| public/css/style.css:6777 | .book-cover-link | `border-radius: 4px` | RADIUS-R7-RAW | - | - | 4px |
| public/css/style.css:6779 | .book-cover-link | `background: var(--thumbnail-bg, #222)` | PHANTOM-THUMBNAIL-BG | - | - |  |
| public/css/style.css:6796 | .book-progress-fill | `background: var(--accent, #cc0000)` | TIER4-GHOST-RED | var(--yt-red) at Tier 4 | 2014 era only | scene 23 |
| public/css/style.css:6825 | .books-shelf-chip | `border: 1px solid var(--border-color, #444)` | DEAD-FALLBACK | - | - | --border-color defined at :root + every era; the literal never paints - Tier 4 fallback cleanup |
| public/css/style.css:6826 | .books-shelf-chip | `border-radius: 14px` | RADIUS-DRIFT | - | - | 14px |
| public/css/style.css:6832 | .books-shelf-chip.active | `background: var(--accent, #cc0000)` | TIER4-GHOST-RED | var(--yt-red) at Tier 4 | 2014 era only | scene 23; mid-line decl |
| public/css/style.css:6832 | .books-shelf-chip.active | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand; mid-line |
| public/css/style.css:6874 | .reader-topbar | `border-bottom: 1px solid var(--border-color, #444)` | DEAD-FALLBACK | - | - |  |
| public/css/style.css:6895 | .reader-content.theme-paper | `background: #f7f4ec` | NO-TOKEN | - | - | user-selected reading theme |
| public/css/style.css:6896 | .reader-content.theme-sepia | `background: #f0e3c9` | NO-TOKEN | - | - | reading theme |
| public/css/style.css:6897 | .reader-content.theme-night | `background: #101014` | NO-TOKEN | - | - | reading theme |
| public/css/style.css:6918 | .reader-bottombar | `border-top: 1px solid var(--border-color, #444)` | DEAD-FALLBACK | - | - |  |
| public/css/style.css:6924 | .reader-progress-track | `border-radius: 3px` | RADIUS-GEOMETRY | - | - | half of 6px track height - never a token |
| public/css/style.css:6925 | .reader-progress-track | `background: var(--border-color, #444)` | DEAD-FALLBACK | - | - |  |
| public/css/style.css:6931 | .reader-progress-fill | `background: var(--accent, #cc0000)` | TIER4-GHOST-RED | var(--yt-red) at Tier 4 | 2014 era only | scene 14 is 2021-only - reader 2014 shot on-device or extend p3 |
| public/css/style.css:6941 | .reader-drawer | `background: var(--card-bg, #1c1c22)` | DEAD-FALLBACK | - | - | #1c1c22 fallback matches no era value - proof it never renders |
| public/css/style.css:6942 | .reader-drawer | `border-left: 1px solid var(--border-color, #444)` | DEAD-FALLBACK | - | - |  |
| public/css/style.css:6955 | .reader-toc-item | `border-bottom: 1px solid var(--border-color, #333)` | DEAD-FALLBACK | - | - | #333 spelling variant |
| public/css/style.css:7011 | .reader-nowplaying | `z-index: 940` | Z-LADDER-TIER4 | per z-ladder-coopen-enumeration.md | - | deployed value 940 |
| public/css/style.css:7023 | .reader-np-cover | `border-radius: 3px` | RADIUS-DRIFT | - | - | 3px |
| public/css/style.css:7168 | .reloc-preview-backdrop | `z-index: 1000` | Z-LADDER-TIER4 | per z-ladder-coopen-enumeration.md | - | deployed value 1000 (ties header - DOM-order dependent) |
| public/css/style.css:7175 | .reloc-preview-panel | `background: var(--card-bg, var(--bg-color, #fff))` | DEAD-FALLBACK | - | - | nested dead fallbacks |
| public/css/style.css:7177 | .reloc-preview-panel | `border: 1px solid var(--border-color, #ccc)` | DEAD-FALLBACK | - | - |  |
| public/css/style.css:7178 | .reloc-preview-panel | `border-radius: 6px` | RADIUS-DRIFT | - | - | 6px |
| public/css/style.css:7192 | .reloc-preview-header | `border-bottom: 1px solid var(--border-color, #ccc)` | DEAD-FALLBACK | - | - |  |
| public/css/style.css:7206 | .reloc-preview-summary | `border-bottom: 1px solid var(--border-color, #ccc)` | DEAD-FALLBACK | - | - |  |
| public/css/style.css:7210 | .reloc-copy-warning | `color: var(--accent-color, #cc0000)` | TIER4-GHOST-RED | var(--yt-red) at Tier 4 | 2014 era only | scene 23b |
| public/css/style.css:7231 | .reloc-preview-row | `border-bottom: 1px solid var(--border-color, #eee)` | DEAD-FALLBACK | - | - | #eee variant |
| public/css/style.css:7247 | .reloc-preview-badge | `border-radius: 3px` | RADIUS-DRIFT | - | - | 3px |
| public/css/style.css:7249 | .reloc-preview-badge | `border: 1px solid var(--border-color, #ccc)` | DEAD-FALLBACK | - | - |  |
| public/css/style.css:7252 | .reloc-preview-badge.reloc-badge-copy | `color: var(--accent-color, #cc0000)` | TIER4-GHOST-RED | var(--yt-red) at Tier 4 | 2014 era only | scene 23b |
| public/css/style.css:7253 | .reloc-preview-badge.reloc-badge-copy | `border-color: var(--accent-color, #cc0000)` | TIER4-GHOST-RED | var(--yt-red) at Tier 4 | 2014 era only | scene 23b |
| public/css/style.css:7310 | .login-wordmark .tube | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand |
| public/css/style.css:7378 | .login-submit | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand |
| public/css/style.css:7426 | .login-era-switch button[aria-pressed="true"] | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand |
| public/css/style.css:7539 | .music-drill-art | `border-radius: 8px` | RADIUS-DRIFT | - | - | 8px |
| public/css/style.css:7541 | .music-drill-art | `background: var(--thumbnail-bg, #222)` | PHANTOM-THUMBNAIL-BG | - | - |  |
| public/css/style.css:7566 | .music-sticky-thumb | `background: var(--thumbnail-bg, #222)` | PHANTOM-THUMBNAIL-BG | - | - | mid-line decl |
| public/css/style.css:7566 | .music-sticky-thumb | `border-radius: 4px` | RADIUS-R7-RAW | - | - | 4px; mid-line |
| public/css/style.css:7599 | .music-album-art | `border-radius: 6px` | RADIUS-DRIFT | - | - | 6px |
| public/css/style.css:7600 | .music-album-art | `background: var(--thumbnail-bg, #222)` | PHANTOM-THUMBNAIL-BG | - | - |  |
| public/css/style.css:7627 | .music-artist-card | `border-radius: 8px` | RADIUS-DRIFT | - | - | 8px |
| public/css/style.css:7643 | .music-song-row | `border-radius: 6px` | RADIUS-DRIFT | - | - | 6px |
| public/css/style.css:7648 | .music-song-thumb | `background: var(--thumbnail-bg, #222)` | PHANTOM-THUMBNAIL-BG | - | - | mid-line decl |
| public/css/style.css:7648 | .music-song-thumb | `border-radius: 4px` | RADIUS-R7-RAW | - | - | 4px; mid-line |
| public/css/style.css:7684 | .music-eq | `border-radius: 4px` | RADIUS-R7-RAW | - | - | 4px |
| public/css/style.css:7691 | .music-eq i | `background: #fff` | SEMANTIC-RESIDUE | - | - | white EQ glyph-art bar; --on-overlay is a text token - semantic stretch, lean residue |
| public/css/style.css:7692 | .music-eq i | `border-radius: 1px` | RADIUS-GEOMETRY | - | - | 1px cap on 3px EQ bar |
| public/css/style.css:7862 | .skeleton-shimmer.skel-title | `border-radius: 4px` | RADIUS-R7-RAW | - | - | 4px |
| public/css/style.css:7872 | .skeleton-shimmer.skel-w* | `border-radius: 4px` | RADIUS-R7-RAW | - | - | 4px |
| public/css/style.css:7920 | .watch-desc-skel .skel-line | `border-radius: 4px` | RADIUS-R7-RAW | - | - | 4px |
| public/css/style.css:8000 | .attr-picker-avatar | `color: #fff` | SEMANTIC-RESIDUE | - | - | glyph over generated avatar color |
| public/css/style.css:8080 | .notif-bell-badge | `border-radius: 8px` | RADIUS-GEOMETRY | - | - | half of 16px badge height |
| public/css/style.css:8082 | .notif-bell-badge | `color: #fff` | SEMANTIC-RESIDUE | - | - | white-on-brand |
| public/css/style.css:8116 | .notif-panel | `z-index: 1600` | Z-LADDER-TIER4 | per z-ladder-coopen-enumeration.md | - | deployed value 1600 |
| public/css/style.css:8147 | .notif-clear-btn | `border-radius: 4px` | RADIUS-R7-RAW | - | - | 4px |
| public/css/style.css:8185 | .notif-row-avatar-generated | `color: #fff` | SEMANTIC-RESIDUE | - | - |  |
| public/css/style.css:8220 | .notif-row-thumb | `border-radius: 4px` | RADIUS-R7-RAW | - | - | 4px |
| public/css/style.css:8265 | .notif-panel-backdrop (mobile) | `z-index: 1599` | Z-LADDER-TIER4 | per z-ladder-coopen-enumeration.md | - | deployed value 1599 |
| public/js/stats.js:347 | buildRepoLink cssText | `color: var(--accent, #cc0000)` | TIER4-GHOST-RED | var(--yt-red) at Tier 4 | 2014 era only | scene 23c |
| public/js/watch.js:1170 | applyAvatarToElement generated-avatar | `color: #ffffff` | SEMANTIC-RESIDUE | - | - | mirrors subscriptions.js:1378 |

## Totals (must sum to the linter TOTAL)

| bucket | rows |
|---|---|
| A-OFFSET-EXEMPT | 49 |
| B1-MIXED | 15 |
| B2-DRIFT | 25 |
| CC-PROTECTED | 1 |
| DEAD-FALLBACK | 13 |
| EXACT-ADOPT | 11 |
| FW-JS-ADOPT | 5 |
| HOLD-EXEMPT-REC | 4 |
| HOLD-RATIFY | 5 |
| JS-ADOPT | 18 |
| JS-DRIFT | 1 |
| LAYOUT-CONSTANT | 6 |
| LH-DRIFT | 3 |
| LH-EXACT | 6 |
| MOTION-DRIFT | 16 |
| NO-TOKEN | 12 |
| ON-OVERLAY-ADOPT | 11 |
| PHANTOM-THUMBNAIL-BG | 6 |
| RADIUS-DERIVED | 3 |
| RADIUS-DRIFT | 10 |
| RADIUS-GEOMETRY | 3 |
| RADIUS-R7-RAW | 11 |
| SCRIM-DRIFT | 12 |
| SCRIM-EXACT | 1 |
| SEMANTIC-RESIDUE | 19 |
| SHADOW-ELEVATION | 5 |
| SHADOW-OTHER | 1 |
| TIER4-GHOST-RED | 9 |
| Z-LADDER-TIER4 | 17 |
| **TOTAL** | **298** |

Extra-census work items (no linter row, tracked in prose so ledger-check
stays a bijection): .ptr-indicator adopts --size-control (Stop A Batch C
ruling; width/height are ungoverned properties, hence no linter site) -
executes in 3b. The subscriptions.html:94 comment update rides its 3g row.
