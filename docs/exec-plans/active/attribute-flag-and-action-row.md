# Attribute behind a flag + draggable AI prompts + the action row re-evaluation

Status: ACTIVE (started 2026-08-29). Ships as v1.202.0 on
`feat/attribute-flag-and-action-row`. Full gate (access-control change).

## Rulings (Dean, 2026-08-29 intake - all agreed)

A1. **Flag:** instance setting `attributeControlEnabled`, default OFF, in
    Settings -> Experimental ("Manual channel attribution"). Off hides the
    watch-page Attribute button AND the folder-view bulk tool.
A2. **Server when off:** the four attribution routes
    (`GET /api/attribution-targets`, `POST /api/videos/:id/attribute-channel`,
    `POST /api/videos/attribute-channel-bulk`, `.../cancel`) answer 404 -
    AFTER the existing admin check, so a member still gets the RBAC 403 the
    nets expect and an admin with the flag off gets 404.
A3. **Bulk tool** (main.js `#attribute-folder-btn`) behind the same flag.
A4. **Glyph:** `.icon-attribute` = Material `drive_file_move` (one base
    mask, three CSS lists, comment-proof lock), replacing the non-existent
    `icon-user` (blank box on phones since v1.53).
A5. **Draggable prompts:** the Transcript-sharing editor rows reorder with
    `wireReorderable` (handle per row; arrow keys free), saved through the
    existing debounced whole-list POST.
B.  **Action row:** PRIMARY = Like, Share, Transcript, Queue (Dean's real
    taps), then a **More** button; SECONDARY (Next, Download, Delete, Move,
    Mark watched, Reheat, Attribute) live under More in COMPACT mode.
    Compact = the column is under 960px (the v1.201 container query, now
    "compact" instead of "glyph-only"); under 640px the words also drop
    (glyphs) - phones therefore get four glyphs + More on one row. Wide
    columns (theatre, 1920 non-theatre) show everything as words, in the
    new fixed order (primary first). More opens the app's choice modal
    listing the secondary buttons by their labels and clicks the real
    button (its own handler/state/confirm flows). Order fixed in v1.
    Buttons never deform (v1.200 norm) - measured before/after in both
    modes with `scripts/action-row-probe.js`.

## Tasks (each its own green commit)

- T1 server + settings: `attributeControlEnabled` (DEFAULT_SETTINGS,
  KNOWN_KEYS, boolean validation, settingsResponse), route gating, the
  Experimental toggle (setup.html/js; reveal-toggle count 8 -> 9), watch.js
  + main.js hide when off. Tests: settings API, routes 404-when-off /
  200-when-on for admin / member 403 unchanged, jsdom watch hidden/shown.
- T2 glyph: drive_file_move.svg + lists + README + lock; watch.js class.
- T3 draggable prompts: wireReorderable in the editor + `.dragging` unscoped
  style + test (reorder -> POST order).
- T4 action row: `data-action-tier` / classes + CSS `order`, More button +
  picker, container thresholds, phone block; tests (More lists exactly the
  mounted secondary buttons in order and triggers them; source locks);
  probe geometry before (v1.201.0) / after, both modes, all widths.

## Attack surfaces for the gate

- Flag gating: every one of the four routes (PLURAL/-bulk/-cancel siblings)
  answers 404 when off for an ADMIN; the flag check is after requireAdmin;
  the bulk job cannot be started while off, and a job started while ON is
  not orphaned by turning it off (cancel still reachable? decide + bind).
- Client: the flag is read once per view load - stale after a settings flip
  in another tab (acceptable, disclose); the Attribute button with the flag
  ON still requires canModifyLibrary + unattributed.
- Reorder: the row's id must survive a drag (data-promptId), the POST
  carries the new order, a drag during a pending debounce, keyboard reorder.
- More: lists ONLY mounted, non-hidden secondary buttons; the label source
  (.btn-label text) for buttons whose label mutates (Like/Liked, Mark
  watched/Watched, Copied!); clicking Delete via More still confirms;
  Download via More (an <a download>) still downloads; the picker is torn
  down on SPA abort; More itself never appears in wide mode.
- Geometry: no deformation in either mode; compact row fits 598px columns;
  phones one row; the reorder does not change any button's size.
