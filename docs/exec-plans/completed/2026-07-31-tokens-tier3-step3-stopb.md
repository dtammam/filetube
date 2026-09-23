# Stop B review packet - Step 3 (assembled 2026-07-31 post-gate)

Both seats APPROVE; dual-Node 5320/5320 x2. Before-shots come from the
frozen v1.57.0 image on the pinned profile; after-shots from a build of
merged main. Compare with tools/capture/compare.js; reject any site
per-site (ledger row edit + single-site commit), never by batch.

Manual gate-blockers (Dean, phone): 13-toast (3a padding 18->16),
04-resume (3c .85->.8), 10-audio-expanded (3d shadows .5/.6->.45).

## Scene -> what changed

### 01
- [3a] .oneoff-modal-header: 14px->12px
- [3c] .oneoff-modal-backdrop: 0.5->0.55

### 04-resume
- [3c] .resume-overlay: 0.85->0.8

### 05
- [3a] .watch-prevnext-btn: 14px->12px
- [3f] .related-title: 1.3->1.25

### 06
- [3a] .video-grid: 30px->32px
- [3a] .search-input: 7px->6px
- [3c] .duration-badge: 0.85->0.8
- [3c] .card-delete-btn: 0.6->0.55
- [3c] .card-download-btn: 0.6->0.55
- [3c] .card-like-btn: 0.6->0.55
- [3f] .video-title: 1.3->1.25

### 07
- [3a] .sort-menu li: 7px->6px

### 08
- [3a] .music-tab: 14px->12px
- [3g] .music-album-art: 6px -> 12px (2021) / 0 (2005) / 2px (2009+2014)

### 09
- [3g] .music-drill-art: 8px -> 12px (2021) / 0 (2005) / 2px (2009+2014)
- [3g] .music-song-row: 6px -> 12px (2021) / 0 (2005) / 2px (2009+2014)

### 10-audio-expanded
- [3d] .audio-artwork: alpha 0.5->0.45
- [3d] .audio-vinyl: alpha 0.6->0.45

### 11
- [3a] .sub-row: 14px->12px

### 12
- [3c] .sub-sheet-backdrop: 0.5->0.55

### 12b
- [3a] .notif-empty: 28px->24px
- [3c] .notif-panel-backdrop:not([hidden]): 0.5->0.55
- [3d] .notif-panel: y 4->8px, alpha 0.25->0.45 (near-double)
- [3f] .notif-row-title: 1.3->1.25

### 13-toast
- [3a] .toast: 18px->16px

### 14
- [3a] .reader-toc-item: 7px->6px

### 15
- [3a] .books-home-row: 18px->16px
- [3a] .books-shelf-chips: 14px->12px
- [3a] .books-section-title: 18px->16px
- [3g] .books-shelf-chip: 14px -> 12px (2021) / 0 (2005) / 2px (2009+2014)

### 16
- [3h] About GitHub links row cssText: 14px->12px

### 17
- [3a] .users-row: 14px->12px

### 18
- [3a] .reloc-preview-group-title: 14px->12px
- [3d] .reloc-preview-panel: y 4->8px, alpha 0.4->0.45
- [3g] .reloc-preview-panel: 6px -> 12px (2021) / 0 (2005) / 2px (2009+2014)

### 21
- [3c] .modal-backdrop: 0.5->0.55

### 25-login
- [3a] .login-wordmark .tube: 3px->2px, 9px->8px
- [3a] .login-era-switch button: 9px->8px

### 26-playlists-sheet
- [3c] .playlists-sheet-backdrop:not([hidden]): 0.5->0.55

## On-device judgment (no scene captures these states)
- [3a] .skeleton-row: 14px->12px
- [3a] .art-play-glyph.art-play-glyph-playing::before: 9px->8px
- [3a] .btn-busy::after: 7px->6px
- [3a] .shortcuts-group: 14px->12px
- [3a] .notif-empty: 28px->24px
- [3c] .player-dock-close: 0.6->0.55
- [3c] .speed-badge: 0.75->0.8
- [3c] .css-fullscreen .player-controls: 0.75->0.8
- [3g] .speed-badge: 14px -> 12px (2021) / 0 (2005) / 2px (2009+2014)
- [3g] .music-artist-card: 8px -> 12px (2021) / 0 (2005) / 2px (2009+2014)

## Standing what-to-look-for flags
- The protected cc background (0.72) untouched - witness shot.
- Shrunk touch targets from 3a paddings; 3b: 34->32 autoplay switch
  (knob must sit flush when ON), 40->44 view-mode button.
- 8->12 album rounding (3g, 2021 era) and the 2005/2009 radius
  squaring on the same surfaces (ruling B - era-varying by design).
- notif-panel shadow near-doubling (3d); 0.2s->0.15s timing feel (3e).
