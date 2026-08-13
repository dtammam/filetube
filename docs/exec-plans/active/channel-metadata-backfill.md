# Exec plan: channel display-name "@handle" + missing avatar (backfill + search-avatar gap)

- Owner: main session (lean mode)
- Opened: 2026-08-13
- Status: ACTIVE (intake locked with Dean; root cause verified in-code; implementation pending)
- Target: v1.113.0
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
3. SEARCH-SPECIFIC GAP (independent): `GET /api/videos` (server.js:9474, projection
   9599-9626) spreads the RAW item and does NOT resolve the avatar, while
   `/api/notifications` (server.js:9024) and `/api/home` (server.js:9711) DO call
   `ytdlp.resolveItemChannelAvatarUrl(db, item)`. So a channel whose avatar is
   registry/subscription-resolvable shows on home but NOT in search.

## Framing (agreed with Dean): B-led wave, A is a cheap rider
- Dean's ACTUAL complaint (the "@handle" name + missing art) is fixed by **Fix B**
  (backfill). The "@handle" items have NO channel identity, so Fix A (avatar
  resolver) cannot touch them and does nothing for names.
- **Fix A** only fixes a DIFFERENT set: channels we CAN identify but whose avatar
  wasn't baked - monogram in search, avatar on home. A safe consistency win (~2 lines).

## Fix A - close the search-avatar gap (cheap, safe, ~2 lines)
In the `/api/videos` item projection (server.js:9608-9625) override the spread's
avatar the way `/api/home`/`/api/notifications` already do:
`channelAvatarUrl: (item.channelAvatarUrl && item.channelAvatarUrl !== '') ? item.channelAvatarUrl : (ytdlp.resolveItemChannelAvatarUrl(db, item) || '')`.
- `resolveItemChannelAvatarUrl` is READ-ONLY (store.js:75/895; safe on the shared
  cached db, no clone). Bound to the page `limit` (already the projection's scope).
- Attack surface: must NOT clone/mutate the cached db; no per-row full-registry blowup.

## Fix B - backfill real channel metadata (the headline; reuses existing infra)
The reheat/repull machinery ALREADY re-pulls + gap-fills channel identity:
`parseChannelMetaLine` (lib/ytdlp/run.js:309-335) extracts `channel`->channelName,
`channel_id`, `channel_url`, + avatar; the scan/reheat gap-fills them onto items
(server.js:5007/5030 channelName, :5081 `&& !item.channelAttributedManually`,
:5126/5178 avatar). Existing endpoint: `POST /api/ytdlp/repull-metadata` (the
"reheat", client `#sub-reheat-btn`, subscriptions.js:1587).

So Fix B is TARGETING + a button, not a new backend:
- A **manual "Refresh channel metadata" button** (Dean's pick over auto-on-scan)
  that runs the reheat scoped to the AFFECTED set: items with no `channelName`
  (or no `channelId`) that HAVE a re-pullable source (a valid `youtubeId`/purl),
  batched PER CHANNEL (folderName), skipping `channelAttributedManually` items and
  items with no source. Reuse the existing repull single-flight latch + cancel +
  the run-log/history surface.
- Throttle: reuse the existing repull pacing (`--sleep-*`/retries); batch per
  channel not per video.
- Leave `folderName` as-is (on-disk grouping key + `/?folder=` link target,
  main.js:2016). Once `channelName` is backfilled it is no longer shown.

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
