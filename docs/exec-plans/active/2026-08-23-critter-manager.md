# Critter Manager - web UI for the critter pool (v1.171 candidate)

Status: ACTIVE

## Intent (Dean, 2026-08-23, verbatim core)

"Can we do a follow up with a small page for it. Maybe in appearance we move
this to a sub-page or component. And then allow one to upload images to the
pool and upload sounds. And show little icons of the uploaded things. And give
the ability to download all or delete all or delete individuals. I think now
managing this via web UI would really just be excellent."

Intake rulings (all Dean, AskUserQuestion 2026-08-23):
1. **Permissions: ADMIN ONLY** for upload/delete/download-all (the logo-upload
   posture; the pool is server-wide). The mode toggle + density stay
   per-device for everyone.
2. **Delete is PERMANENT with two-tap confirm** - no asset trash. Download-all
   is the backup. Delete-all shows the count in its confirm label.
3. **Placement: its OWN Settings section** ("Sneaky critters", master-detail -
   a sub-page on mobile). Toggle + density MOVE there from Appearance; the
   admin manager renders below them.

## Constraints (contract)

- NO new server runtime deps (ffmpeg + optional yt-dlp only). Download-all is
  a dependency-free STORE-only ZIP (local headers + central directory + EOCD;
  CRC via `zlib.crc32`, available since Node 22.2, engines floor is 22.13).
- Upload mirrors the logo route's pattern exactly: route-scoped
  `express.raw`, Content-Type allowlist AND magic bytes, size cap,
  tmp+rename atomic write, route-scoped 413 mapping. No multipart dep.
- The folder stays the manifest (v1.166 contract): the web UI is a WRITER to
  `public/critters/`, never a registry. Folder drop-in keeps working; the
  Docker compose bind (v1.166.3) makes uploads land on the host.
- **DATA-LOSS SURFACE** (delete-item / delete-all): FULL two-reviewer gate,
  adversarial seat briefed to DESTROY the data. Never slim.

## Design

### Server (server.js) - 4 new routes, all admin, all static-segment paths

- `POST /api/critters/upload?name=<filename>` - raw body. Validation ladder:
  requireAdmin -> `sanitizeCritterUploadName(name, mime)` (basename equality,
  no separators/NUL/leading dot, <=80 chars, extension must match the mime's
  family) -> magic bytes (`CRITTER_UPLOAD_TYPES`) -> tmp+rename into
  `public/critters/`. Images: png/webp/gif/jpg/jpeg, 25 MB cap. Sounds:
  mp3/wav/m4a/ogg, 10 MB cap (enforced as one raw limit; per-family checked
  after). SVG is deliberately EXCLUDED from upload (stored-XSS vector when
  fetched directly from our origin; folder drop-in still accepts svg for
  Dean's own files - disclosed).
- `DELETE /api/critters/item?id=<basename>` - resolves the id against the
  ACTUAL directory listing (same basename rules as buildCritterListing);
  unlinks the matched image AND its paired sound. Never joins user input into
  a path without the listing round-trip. 404 when nothing matches.
- `DELETE /api/critters/all` - unlinks every listed image/sound (README.md,
  subdirectories, symlinks untouched). Returns `{deleted: n}`.
- `GET /api/critters/archive` - streams `critters.zip` (store-only ZIP of
  every listed image/sound), attachment disposition.
- Pure/exported for tests: `sanitizeCritterUploadName`, `buildStoreZip`.
- Census updates (v1.79 discipline, BEFORE the gate): rbac-census pin
  207 -> 211 with justification; route-read-classification
  `/api/critters/archive: NO_CONTENT`; route-write-classification: the POST
  and both DELETEs classified admin on BOTH axes.

### Client

- setup.html: new `<details data-collapse-key="critters" data-md-icon="paw">`
  section in the UNGROUPED top area, directly beside Appearance (QA W2:
  this spec originally said System group; the fun-mode section is
  appearance-adjacent and lives where the controls came from - the spec was
  amended, not the code), holding the MOVED toggle + density (same element
  ids - wireCritterModeControls untouched) plus an admin-only
  `<div id="critter-manager" hidden>`: pool grid, image/sound upload buttons
  (hidden multi-file inputs), Download all (plain link to the archive route),
  Delete all (two-tap, count in label).
- common.js: `MD_ICON_PATHS.paw` (stroke icon, house style).
- setup.js: reveal + `wireCritterManager(signal)` from the existing
  `me.user.role === 'admin'` branch. Grid renders from `GET /api/critters`
  (thumbnail, name, sound badge, per-item two-tap delete). Every successful
  mutation calls `applyCritterMode()` (invalidates the manifest cache and
  re-scatters) and re-renders the grid.
- style.css: token-only grid styles.

### Two-tap discipline (v1.159/v1.162 class)

Armed state lives closure-local; the grid re-render REBUILDS rows (never
reuses armed nodes); delete-all's armed label carries the live count.

## Test plan (machine-verified at every commit)

- Unit: sanitize matrix (traversal, separators, dots, NUL, README, extension
  vs mime family, length); magic validators per type; buildStoreZip
  structural (PK\x03\x04 + PK\x01\x02 + EOCD signatures, entry count, CRC32
  recomputed independently, name bytes, store method 0); manager jsdom
  (grid render from stubbed fetch, two-tap arm/fire per item, delete-all
  count label, upload POST body/headers/name, applyCritterMode called after
  every mutation, non-admin never wires).
- Integration: the three censuses updated + green; upload/delete routes 403
  for non-admin (write-classification enforces).
- Full `npm test` BEFORE the gate (the pre-commit unit hook hides red
  integration - v1.79).

## Numbers (machine-derived, re-verified each commit)

- Express route count: 207 -> 211 (+4; `grep -c` via the rbac census).
- Suite baseline at branch point: 7463/7463 (both Nodes, v1.170.0 release).

## Gate brief (FULL - destructive)

Adversarial seat: DESTROY THE DATA. Named surfaces: path traversal through
`name`/`id` (encoded separators, dot-dot, absolute paths, NUL, Windows
separators, case tricks); delete-all scope (must never reach outside
public/critters/ - symlinked folder entries, the compose bind, README.md);
upload overwrite semantics vs the manifest; magic-byte bypasses; the ZIP
(correctness against an independent unzip, memory posture on big pools);
non-admin reaching any management route; the moved Settings controls
(wireCritterModeControls still bound - presence vs binding); two-tap
re-render resets armed state (v1.159).

## Ceremony

Release v1.171.0 after both seats APPROVE + dual-Node; ledger row in pure
user language; branch hygiene after tag confirm; device pass PENDING
disclosed (Dean probes: upload from phone, thumbnails, per-item delete,
delete-all count, download-all zip opens, folder drop-in still works).
