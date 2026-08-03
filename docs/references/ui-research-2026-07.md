# UI/UX research — media-server subscriptions / library / audio / downloads (2026-07)

Reference synthesis for the post-v1.20 UI rounds. Adapted to FileTube's retro-2000s-YouTube,
mobile-first, self-hosted constraint. Feed this to the Design stage of the relevant rounds.

## 1. Subscriptions / channel management
- **List, not grid.** A management surface (edit settings, unsubscribe, counts) wants a dense,
  scannable vertical LIST. (YouTube's forced subscriptions grid is widely disliked / worked-around.)
  Reserve grid for the video library.
- **One row = avatar + name + one muted metadata line + a single trailing kebab/gear.** Avoid a
  cluster of 4-5 inline buttons — that's the "cramped" trap.
- **Per-subscription settings → a detail page (or bottom-sheet), not a cramped modal/inline.**
  Multiple related fields (quality + count + type + name) belong on a dedicated page reached by
  tapping the row. This ALSO fixes the count-edit UX.
- **Row tap = open that channel's videos; the gear/kebab is a separate explicit target.**
- **Optional collection chips** with count badges ("Music · 8") for many subs; deliberate empty state.
- **Retro translation:** zebra-striped rows, 1px separators, beveled avatars, chunky right-aligned
  button, era pill/tab chips. Avoid swipe-to-reveal (off-era, undiscoverable) — use a visible kebab.

## 2. Library / video grid
- **The "too zoomed / one card" bug = the `minmax()` floor is too high on phones.** Use
  `grid-template-columns: repeat(auto-fill, minmax(<min>, 1fr))`; drop `<min>` to ~150-170px so
  phones show 2 columns (or explicit breakpoints 1→2 ~480px, 2→3 ~700px, 3→4 ~1000px).
- **Lock thumbnails to `aspect-ratio:16/9; object-fit:cover`** so cards stay uniform even without a
  thumbnail (placeholder fills the box) — Jellyfin's key lesson (inconsistent ratios = jitter).
- Title clamped to ~2 lines + one muted metadata line; duration as a solid-black corner badge.
- Lazy-load thumbnails (IntersectionObserver); tap = play, no hover-only affordances.
- **Retro:** hard 1px borders / inset bevel instead of soft shadows; square corners; tight gaps.

## 3. Playlists / channel-as-playlist / pinning
- **Channel view = header block (art + name + subscribe state + kebab) + ordered video list.** Treat
  "a channel's videos" and "a playlist" as the same component, different data source.
- **Persistent "Pinned/Favorites" nav section** — pin a channel/playlist so it's a one-tap return
  entry in the sidebar/Playlists. Star toggle (discoverable), not drag-only. "Play all" + count badge.
- Subscribe (follow for new items) and Pin (quick-access shortcut) are DIFFERENT intents — keep separate.
- **Retro:** left-nav "My Playlists / Pinned" bulleted/beveled link list with a star icon; collapses
  to a drawer/tab on mobile.

## 4. Audio player  ← HIGHEST-LEVERAGE AREA
- **THE key insight: replace native `<audio>`/`<video>` controls with custom markup.** Native
  `<audio controls>` renders an unstyleable browser control bar (the pure-white-in-dark-mode cause and
  the rounded/derpy look) — you CANNOT theme it. Replacing it simultaneously solves: dark-mode,
  blocky controls, click-art-to-play, MediaSession lock-screen controls. And it's MORE retro-authentic
  (Winamp/early-Flash players were blocky/beveled).
- **Blocky control bar:** drop `controls`; own play/pause `<button>`, seek `<input type=range>`, time,
  volume. Style the range via `::-webkit-slider-runnable-track`/`::-moz-range-progress`/
  `::-webkit-slider-thumb` with `border-radius:0` (square thumb). Fixed-height flex/grid bar, solid bg,
  driven by the era CSS variables so dark mode "just works." Add `color-scheme: dark light`.
- **Seek:** update fill via a CSS var + `requestAnimationFrame` (not the ~4Hz `timeupdate`); split the
  range `input` (visual scrub) from `change` (set `currentTime`).
- **Click-the-art to play/pause:** make the cover-art a button surface; overlay a fading play/pause
  glyph. Keep an explicit button too. (Isolate the handler so it doesn't also navigate.)
- **Persist volume:** on `volumechange` write `audio.volume` to localStorage; on init read it back and
  set BEFORE playback (guard 0-1) to avoid a jump. Extends to mute/last-position.
- **MediaSession** action handlers + metadata — near-free once controls are custom; big mobile win.
- **Retro:** beveled inset/outset bar, square buttons, segmented/LCD-style progress fill (Winamp
  nostalgia), cover art in a beveled frame. Avoid translucent/glassy overlays (the pure-white clash).

## 5. Active-download status
- **Unobtrusive persistent chip → expandable panel** (browsers/download managers), never a blocking
  modal. Collapsed = "2 downloading · 40%" + mini progress; expanded = per-item rows (name, %, speed,
  cancel).
- Completion auto-dismisses (toast); errors stay sticky until acknowledged.
- **Retro:** bottom status-bar-style beveled box, segmented/striped progress bar, 1px borders, solid
  fill. On mobile dock as a slim bottom strip that expands upward — coordinate with the audio
  mini-player so they don't overlap.

## Cross-cutting
- Highest-leverage single change: **custom `<audio>`/`<video>` controls** (solves 4 asks at once).
- The grid "zoom" is a one-line `minmax()` floor fix + enforced 16:9 thumbnails.
- Subscriptions = dense LIST + detail-page settings (not grid + inline).
- Every good modern pattern here has a blocky/beveled/bordered 2000s translation. Anti-pattern to avoid
  across all areas: glassy/translucent/rounded minimalism and hover-only affordances.
