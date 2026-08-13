# Exec plan: channel display-name "@handle" + missing avatar (backfill + search-avatar gap)

- Owner: main session (lean mode)
- Opened: 2026-08-13
- Status: ACTIVE. SPLIT SHIP (Dean, 2026-08-13):
  - **v1.113.0** ships the SAFE, non-data-mutating half NOW: Fix A (search
    avatar resolve) + the read-only sizing diagnostic + a Dockerfile fix
    (`COPY scripts/` - the diagnostics were never in the image; Dean's catch,
    which also retroactively makes v1.111's probe-faststart.js runnable on his
    server). Gets the general avatar improvement out + a runnable sizer on prod.
  - **v1.114.0** ships Fix B (the channelName BACKFILL) + the pin-label refresh
    (below) - the data-mutating headline, its own FULL gate.
  This plan stays ACTIVE through v1.113 (Fix B pending) and moves to completed/
  only when v1.114 ships.
- Target: v1.113.0 (Fix A + diagnostic + Dockerfile) then v1.114.0 (Fix B)
- Device pass: PENDING (Dean) - the live bug data is on Dean's server.
- DATA-MUTATING wave (Fix B writes channel identity onto existing db rows) ->
  FULL gate, adversarial briefed to DESTROY the attribution. Never slim.

## The bug (Dean)
In search/library results some channels render as an "@handle" (e.g. "@nestalgia")
with no avatar, others as the proper name ("Nestalgia") with art.

## Root cause (VERIFIED in-code, not just from the investigation)
Affected items were ingested WITHOUT a captured yt-dlp channel-metadata block
(`channelName`/`channelId`/`channelUrl`/`channelAvatarUrl` absent). Then:
1. Name falls back to the download FOLDER name, which for a channel subscribed by
   its `/@handle` URL is literally `@nestalgia`. VERIFIED: `resolveChannelName`
   (public/js/common.js:774-780) returns `item.channelName` if present, else
   `folderName`. The "@handle" is the folder name surfacing - never stored as name.
2. No channel key -> no avatar (`modernCardAvatar`/`resolveAvatarSource`,
   common.js:499/612 - monogram unless `item.channelAvatarUrl`).
3. CARD-SURFACE GAP (independent): the CARD read surfaces `GET /api/videos`,
   `/api/liked` and `/api/history` all spread the RAW item and do NOT resolve the
   avatar, while `/api/home` (9711), `/api/notifications` (9024) and the watch
   route (10006) DO. So a channel whose avatar is registry/subscription-resolvable
   shows on home but a MONOGRAM in search/liked/history. (Slim-gate WARNING
   correction: an earlier draft called search "the ONE" surface - false; the
   shared buildCardHtml->modernCardAvatar path reads item.channelAvatarUrl on all
   three, so Fix A sweeps all three, not just /api/videos.)

## Framing (agreed with Dean): B-led wave, A is a cheap rider
- Dean's ACTUAL complaint (the "@handle" name + missing art) is fixed by **Fix B**
  (backfill). The "@handle" items have NO channel identity, so Fix A (avatar
  resolver) cannot touch them and does nothing for names.
- **Fix A** only fixes a DIFFERENT set: channels we CAN identify but whose avatar
  wasn't baked - monogram in search, avatar on home. A safe consistency win (~2 lines).

## Fix A - close the card-surface avatar gap (cheap, safe)
In EACH card-read projection -- `/api/videos` (server.js:9609), `/api/liked`
(11237) and `/api/history` (11304) -- resolve the avatar the way `/api/home`
already does: `channelAvatarUrl: ytdlp.resolveItemChannelAvatarUrl(db, item) || ''`
(the resolver checks the baked value FIRST, re-sanitizing it, then the registry/
subscription join -- byte-identical to /api/home, and it re-sanitizes a corrupted
baked value the raw spread would have passed through).
- `resolveItemChannelAvatarUrl` is READ-ONLY (store.js:75/895; safe on the shared
  cached db, no clone). Bound to the page `limit` (already the projection's scope).
- Attack surface: must NOT clone/mutate the cached db; no per-row full-registry
  blowup; ALL card surfaces swept (enumerated the `...item` projections - videos,
  liked, history; the watch route + home + notifications already resolve).

## Fix B - backfill real channel metadata (the headline; reuses existing infra)
The reheat/repull machinery ALREADY re-pulls + gap-fills channel identity:
`parseChannelMetaLine` (lib/ytdlp/run.js:309-335) extracts `channel`->channelName,
`channel_id`, `channel_url`, + avatar; the scan/reheat gap-fills them onto items
(server.js:5007/5030 channelName, :5081 `&& !item.channelAttributedManually`,
:5126/5178 avatar). Existing endpoint: `POST /api/ytdlp/repull-metadata` (the
"reheat", client `#sub-reheat-btn`, subscriptions.js:1587).

### AFFECTED-SET model CORRECTED by Dean's prod diagnostic run (2026-08-13)
The v1.113 diagnostic run on Dean's server FALSIFIED the "@handle folder" model:
of 2032 videos, **0** had a `folderName` starting with `@`. The real affected set
is **"bad name"** = a card NOT showing the real channel name, which is TWO cases:
- **missing `channelName`** (1294 of 2032) -> the card falls back to the FOLDER
  name (the handle/name with spaces stripped: "AfterSkool", "anthropic-ai",
  "eli_handle_bwav"); AND
- **`channelName` that captured the HANDLE** ("@nestalgiamusic") - these were
  hiding in the "has a name" bucket, undetected by the folder-only check.
The old diagnostic ALSO measured re-pullability only inside the (empty) @handle-
folder branch, so it printed "Fix B target = 0" when the true target is the
re-pullable subset of ~1294+. The diagnostic is fixed (T1 here): `badName =
!channelName || channelName.startsWith('@')`, re-pullability measured for ALL
bad-name items. Dean re-runs the corrected script to get the real target size.
Avatar side (already live via v1.113 Fix A): 491 items had a channelId but no
baked avatar -> now resolved; 1371 have neither (need Fix B's re-pull for the avatar).

So Fix B is TARGETING + a button, not a new backend:
- `itemNeedsChannelBackfill(item)` = **`badName` (no `channelName` OR a
  `channelName` starting with `@`) AND NOT `channelAttributedManually`** - NOT the
  old "@handle folder" check.
- A **manual "Refresh channel metadata" button** (Dean's pick over auto-on-scan)
  that runs the reheat scoped to that AFFECTED set that HAS a re-pullable source
  (a valid `youtubeId` OR a filename `[id]` bracket in the download root OR an
  embedded purl - the reheat derives all three), batched PER CHANNEL (folderName),
  skipping manual-attribution + no-source items. Reuse the existing repull
  single-flight latch + cancel + the run-log/history surface.
- Throttle: reuse the existing repull pacing (`--sleep-*`/retries); batch per
  channel not per video.
- Leave `folderName` as-is (on-disk grouping key + `/?folder=` link target,
  main.js:2016). Once `channelName` is backfilled it is no longer shown.

### Fix B companion: PIN-LABEL refresh (Dean's catch, VERIFIED in-code)
Most surfaces resolve the channel name LIVE (real `channelName` else the
`@handle` folder): item cards (`resolveChannelName`, common.js:774), and the
channel/avatar-bar list (`/api/channels` upgrades `name` from the folder to the
first item's `channelName`). So the backfill normalizes all of those at once.
EXCEPTION: a channel PIN is a SNAPSHOT `{ id, channelDir, label, pinnedAt }`
where `label` is frozen at PIN time, NOT a live join (store.js:2016-2024, a
gated hard invariant - deliberately isolated in `db.ytdlp`). So a channel pinned
while it showed "@handle" keeps the stale label even after the backfill. Fix B
must therefore ALSO refresh pin `label`s for backfilled channels: pins key by
`channelDir` (the folder), so re-derive each affected pin's `label` from its
channel's NEW `channelName`. RESPECT the snapshot design (update the label as a
deliberate write, don't convert pins to a live join). Attack surface: the pin
namespace round-trips through every config save (the FR-5 data-safety invariant)
- a pin-label write must not corrupt/drop the pins array.

## Machine-derived sizing (Fix B) - DEAN RUNS ON HIS SERVER
Dev DB has 0 yt-dlp channels, so I cannot exhibit live rows. New read-only script
`scripts/probe-channel-metadata.js` (models `probe-faststart.js`, reads via the
db adapter, NEVER writes) reports: total video items; items with empty
`channelName`; of those, how many have `folderName` starting with `@`; how many
have a re-pullable `youtubeId` (the Fix-B-addressable count); and the avatar
split (no avatar + no channelId = needs B; no avatar + HAS channelId = Fix A
recovers it). Plus a few real examples of each. This SIZES the backfill before we
finalize the button UX.

## Task commits (each green before the next)
1. **T1 - read-only diagnostic** `scripts/probe-channel-metadata.js` + unit test on
   its pure classifier. (Hand to Dean to size the backfill.)
2. **T2 - Fix A**: the `/api/videos` avatar-resolve override + a route test that a
   registry-resolvable avatar now appears in the search projection (and the cached
   db is not mutated).
3. **T3 - Fix B backend**: the targeted-reheat endpoint (affected-set filter,
   per-channel batch, manual-attribution guard, source-required) reusing the repull
   latch; tests for the targeting filter (pure) + the manual-attribution skip.
4. **T4 - Fix B client**: the "Refresh channel metadata" button + progress/history,
   mirroring Refresh-avatars; tests.

## Named attack surfaces for the adversarial seat (FULL gate - can lose data)
- **Manual attribution CLOBBER**: a backfill must NEVER overwrite a
  `channelAttributedManually` name/avatar. Mutation-test the guard on every write
  path (server.js:5081 and siblings) - delete it and prove a test reddens.
- **Idempotency**: running the backfill twice must not thrash or duplicate; a
  no-source item must be skipped, not errored into a bad write.
- **Persist-gate / stale-snapshot (CLAUDE.md lesson #1)**: a backfilled
  `channelName`/`channelAvatarUrl` must survive a SUBSEQUENT scan (terminal-write +
  re-init carry-forward + Phase-2 merge guard + persist-gate + final-merge). Reusing
  the EXISTING channelName/channelAvatarUrl fields (already plumbed, server.js:4655-
  4659/4900-4901/5030-5040) is the safe path - prove a post-backfill scan keeps it.
- **Fix A**: no clone/mutation of the shared cached db; bounded to page size.
- **Wrong-item write**: the reheat keys by video id; prove a backfill writes the
  fetched channel onto the RIGHT item (no cross-item bleed in the per-channel batch).
- **`folderName` untouched** (the folder-filter link target must keep working).

## Open confirmations (at build time)
- Confirm the reheat's fresh-pull path writes `channelName` (not only avatar) for a
  metadata-less item - trace 4950-5040 fully before T3.
- Confirm the affected-set filter's "re-pullable source" (youtubeId/purl presence).

## Stop condition
Both seats APPROVE (full gate); dual-Node green; Dean's server sizing run informs
the final button UX; released with device pass PENDING. Move to completed/ at release.
