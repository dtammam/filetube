# Wave 4: folder display names (v1.126.0) + the faststart probe record

Status: SHIPPED v1.126.0 (2026-08-15; see ROADMAP.md). FULL gate, both seats APPROVED after one fix round (a CRITICAL path-restriction RBAC bypass - closed). Dual-Node 6897/6897.
Intake: Dean approved the mapping fix shape and confirmed both mechanisms
("tapping a NESTALGIA folder lands on nestalgiamusic"; rail's bad names are
other, unhealable folders). Two-part ask; part 2 resolved with zero code (below).

## Part 1 - verified mechanisms (code-anchored, Dean-confirmed)

- **M1 - the `?folder=` header was never swept.** `public/js/main.js:1182`
  renders `Playlist: ${folderFilter}` RAW; the v1.122 heal (`:1655`) is gated
  `if (rootFilter && ...)` so it never runs for `?folder=` views - and the
  surfaces Dean taps (a card's channel link `:2039`, the channels list `:417`)
  link to `/?folder=`. Tapping "NESTALGIA" lands on "Playlist: nestalgiamusic".
  The v1.122 fix was correct for `?root=` and blind to this entry path (the
  enumerate-every-entry-point class).
- **M2 - ~70 folders / ~1,217 items are PERMANENTLY unhealable** (Dean's sizing:
  no channelId, no URL). The related rail honestly renders their folderName
  fallbacks. No item-level heal can ever fix them; only a folder-level display
  name can.
- **M3 - the folder-label surfaces have no name source but the basename**:
  the `?root=` initial label (`main.js:1326`), the `?folder=` header, the
  related rail, the channels bar, and a pin's default label
  (`derivePinnedPlaylistEntries` base fallback). Dean's unpin/repin couldn't
  help because the SOURCES are unhealed.
  NOTE (gate SUGGESTION-2 correction): `renderPlaylistsSheet` and the home
  folder list (`renderSidebarFolders`) are DELIBERATELY NOT swept - they key on
  configured scan ROOTS by full path (`db.folders`), a different namespace from
  `folderDisplayNames`'s channel-`folderName` basenames, so the map would never
  match there (except the coincidental case where a channel dir is itself a
  configured root - accepted as not worth the surface). The history-page byline
  and the setup Feed-Hidden row DO consult the map (fixed in the gate round).

## Part 1 - the fix: `db.folderDisplayNames`

One server-side map `{ [folderName]: displayName }`, consulted by every
folder-label surface.

- **Keying decision**: by `folderName` (the channel subdir basename), NOT the
  full path - deliberately consistent with the existing `?folder=` filter
  semantics, which already merges same-named folders across roots. (The v1.115
  "pin by full path" scar is about PIN IDENTITY; this is display grouping that
  mirrors the filter's own grouping. Documented trade-off.)
- **T1 store join** (the v1.42/v1.97 every-carrier lesson, ONE commit):
  `'folderDisplayNames'` added to `SINGLETON_NAMES` (lib/db/sqlite.js:79 - the
  two `[...DOC_KV_NAMESPACES, ...SINGLETON_NAMES]` spreads cover
  assertNoUnknownKeys + import automatically), `BACKUP_NAMESPACE_KEYS`
  (server.js:8507), loadDatabase backfill (`db.folderDisplayNames ||= {}`),
  restore path (rides the namespace loop). NUL SAFETY (gate SUGGESTION-3
  correction): `assertRowKeySafe` guards only the OUTER singleton row key
  (`'folderDisplayNames'`); the inner folderName keys and the display-name
  values are NUL-safe because the whole namespace is stored as ONE JSON blob
  (JSON escapes control bytes), not by that guard.
- **T2 auto-write on heal**: the "Refresh channel names" local-reconcile
  already computes per-folder canonical names (the folder-unanimity pass,
  lib/ytdlp/index.js ~:1769 heal lane); when a folder heals to EXACTLY ONE
  canonical name, also write `folderDisplayNames[folderName] = name`
  (overwrite posture per the v1.116 lesson: an overwriting writer overwrites).
- **T3 rename route + affordance**: `POST /api/folders/display-name`
  `{folderName, name}` (empty/absent name = clear). Gating: `requireModifyLibrary`
  (shared display metadata) + VISIBILITY on the `{kind:'media', folderName}`
  descriptor (a member restricted from the folder must not rename it - 404,
  neutral). BOTH forcing nets get entries (capability `library-write`;
  visibility `enforced`) + behavioral binding in the rbac suites. UI: a rename
  affordance on the folder-view header (pencil, shown to capable users),
  prompt-based (no new sheet machinery).
- **T4 client sweep - EVERY folder-label surface** (enumerated, the recurring
  class): `resolveChannelName` gains fallback #2
  `folderDisplayNames[item.folderName]` (before folderName) - this alone heals
  the RAIL for renamed folders; `main.js:1182` the `?folder=` header (mapped
  name, then the item-unanimity retitle extended to folderFilter views);
  `main.js:1326`+`:1655` the `?root=` labels consult the map first (mapping
  beats page-0 sampling; unanimity stays as the no-mapping fallback);
  the pin default
  label. Delivery: the map rides the same payload as `folderSettings`
  (server.js:6396 `{folders, folderSettings, ...}`) into the existing client
  cache path.
- **T5 tests**: unit (resolveChannelName fallback order incl. mapping;
  header-label helper for both entry paths), integration (route + capability
  403 + visibility 404 + net classifications + backup/restore round-trip +
  heal-write on the reconcile), mutation-bind the guards.

## Part 2 - faststart probe (RESOLVED, zero code)

The requested probe already ships: `scripts/probe-faststart.js` (read-only,
box-header walk, in the Docker image). Dean ran it 2026-08-15:
**1117 mp4s, 995 faststart, 122 trailing-moov (11%)**, clustered: 90 = one
CBT Nuggets course, 12 = Rye High School, ~20 scattered (screen recordings,
one-offs). NO-OP by Dean's explicit choice. The eventual fix is a NAMED
FOLLOW-UP wave, not this one: wire `lib/faststart.js`'s existing LOSSLESS
in-place remux (`-c copy +faststart`, temp -> verify -> atomic rename, mtime
preserved, same path = same id so NO re-key and NO rescan) to a per-video
reheat action + an optional batch - strictly better than Dean's sketched
convert/delete/rescan, which the design correction replaced at intake.

## Gate

FULL gate (a new persisted namespace joining every carrier + a new mutating
route = access-control + persist-gate surface, both scarred classes).
Adversarial briefed to: attack the new route's capability x visibility gating
(rename a folder you cannot see), prove the namespace survives backup/restore
and the diff-save, prove the heal-write fires (and OVERWRITES) on the
reconcile, and enumerate any folder-label surface the sweep missed.

## Stop condition

Both seats APPROVE; dual-Node verbatim; nets classify the new route on both
axes; Dean's probes: tapping NESTALGIA lands on a NESTALGIA-titled view; the
sheet + folder list show display names; renaming an unhealable folder fixes
its rail entries. Then ceremony v1.126.0, plan to completed/.
