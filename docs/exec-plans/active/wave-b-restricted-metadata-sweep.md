# Wave B (v1.128): restricted-account metadata isolation sweep

Status: PLANNED 2026-08-15 (Dean chose "fix it, own wave" over tech-debt).
Runs AFTER Wave A ships. Authored by the Fable session that verified the
spot-checked claims below; step S1 machine-derives the full surface list.

Problem: restricted accounts (path/folder/show restrictions, kid allowlist
mode) never receive protected BYTES, but several read surfaces still leak
hidden TITLES, folder names, and absolute server PATHS. This violates the
privacy boundary the restriction features promise.

## Spot-verified leak surfaces (2026-08-15)

- `GET /api/config` (server.js:6404) returns ALL roots, folderSettings, and
  the COMPLETE v1.126 folderDisplayNames map to any authenticated member.
- `shapedQueue(db, userId)` (server.js:9346) takes no requester/visibility
  context; queue rendering can emit hidden podcast/music titles and raw video
  records including paths. Queue insertion (~9422) existence-checks without
  visibility.
- Claimed by the external review, NOT yet verified (S1 verifies): `GET
  /api/books/folders` (absolute dirs + counts, no bookVisibleTo, ~7112);
  `/api/duplicates` + CSV (global metadata, IDs + absolute paths, ~15050 +
  lib/stats.js:~320); `/api/attribution-targets` (~15288); assorted personal
  writes (likes/progress/played) that existence-check without visibility -
  the forcing net currently blesses these as "existence oracle at worst".

## Task commits

### S1. Machine-derived surface census (the plan's numbers come from HERE)

Enumerate every GET/read route + every reader of db.metadata / books / music /
podcast stores that lacks a visibility predicate on its output path. Derive
mechanically (route-table walk + grep of handler sources), commit the census
as the wave's worklist in this file (append a "## Census" section), and
classify each row: LEAK (fix), SAFE (already filtered or admin-only - cite the
gate), ORACLE (personal-write existence oracle - see S4). The v1.80 lesson
governs: byte-route gating is not enough; enumerate EVERY read surface
(bell/stats/trash/duplicates/handoff/liked/feed included, even if the review
did not name them).

### S2. Filter the list/aggregate surfaces

For each LEAK row: filter through the canonical predicate (mediaVisibleTo /
bookVisibleTo / episodeVisibleTo / music equivalent) for members; admins keep
the full view. Known tripwires:

- `/api/config`: the settings/admin UI needs the full root list for ADMINS;
  members need only what their visible content references. Filter
  folderDisplayNames to folder names the member can see at least one item in
  (same predicate as the v1.126 rename route's check, server.js:6432). Check
  every client consumer of `/api/config` tolerates a filtered set (grep
  public/js for `/api/config` fetches) - the SPA settings page is
  admin-gated, but common.js may cache config for nav.
- Duplicates/CSV: simplest correct posture may be admin-only (it is an
  operator report); decide at implementation, state the choice in the commit.
- Paths: where a member-visible row currently carries an absolute server
  path, prefer dropping/opaquing the path for non-admins over filtering the
  row, when the row itself is legitimately visible.

### S3. Thread visibility through the queue

`shapedQueue` gains a requester context; hidden entries use the existing
silent-drop posture (dead-id precedent already in the function - hidden and
dead look identical to the client, which is the correct oracle-free shape).
Queue INSERT checks visibility, not just existence/status. Tests: restricted
member's queue containing a hidden item renders without it; inserting a
hidden id is refused with the same status shape as a nonexistent id (no
oracle); unrestricted member unaffected. Reveal-once lesson applies to the
client panel if any rendering changes: bind both axes behaviourally.

### S4. Personal-write oracle posture

Dean accepted fixing the leak class; personal writes (like/progress/played on
a hidden id) are the low-severity tail. Upgrade them to visibility checks
WHERE the canonical predicate is already loaded in the handler (cheap), and
update the forcing net's `personal` class contract text to require it; if any
handler makes this expensive, tech-debt that one explicitly instead of
silently skipping. The net's "existence oracle at worst" comment must end the
wave TRUE or DELETED.

### S5. Forcing-net + docs closure

Extend route-write-classification (and its read-side sibling if S1 created
one) so every census row's classification is bound by a test - the census
must not be a one-time grep that rots (v1.125 lesson: the sweep itself falls
to divergent spelling; derive, don't hand-enumerate). Tracker entries for
anything deliberately deferred.

## Gate

FULL gate (this is access-control, the repo's most-repeated CRITICAL class).
Adversarial brief: as a restricted member, extract any hidden title/path/count
from ANY read surface, not just the fixed list - the seat's job is to find the
row S1's census missed. Mutation-test at least one filter per surface family.

## Device probes for Dean (at release)

- Kid-mode account: home/feed/search/queue/stats/books/music show nothing
  from hidden folders, INCLUDING names in dropdowns and folder chips.
- Admin account: settings page, duplicates report, attribution dialog all
  still fully populated.

## Census (S1 - machine-derived 2026-08-15, 4 parallel read-only agents over
## every GET route in server.js + lib/podcasts + lib/ytdlp, ~85 surfaces)

Method: each agent read the handler source and reported, per route, whether a
restricted member's RESPONSE leaks hidden titles / folder names / absolute
paths / counts. Verdicts corroborated where families overlapped (shapedQueue
seen by 2 agents, same LEAK verdict).

### LEAK - fixed in this wave (title / path / folder-name / meaningful count)

| # | Surface | What leaks | Fix |
| - | ------- | ---------- | --- |
| L1 | GET /api/config (server.js:6378) | all root abs paths + folderSettings + folderDisplayNames (folder/channel names), incl. hidden | filter to visible roots/folders for a RESTRICTED member; admin + unrestricted member byte-identical |
| L2 | GET /api/books/config (6889) | every book ROOT abs path | filter to roots with >=1 visible book |
| L3 | GET /api/music/config (7873) | every music ROOT abs path | filter to roots with >=1 visible track |
| L4 | GET /api/books/folders (7126) | abs dir + folderName + count per book folder, no bookVisibleTo | filter by bookVisibleTo BEFORE aggregating (the music/albums pattern) |
| L5 | GET /api/scan-status (7503) | fileCount (full db.metadata), folderCount, transcodeNames (pending item TITLES) | scope counts + titles to the visible set for a restricted member |
| L6 | GET /api/duplicates (15089) | abs filePaths + counts over raw db.metadata | pass visibleMetadata (the /api/stats pattern) not raw db.metadata |
| L7 | GET /api/duplicates.csv (15102) | abs filePaths (CSV) | same visibleMetadata filter |
| L8 | GET /api/attribution-targets (15327) | channelName / folderName of every item (library-sourced arm) | filter library-sourced targets by mediaVisibleTo |
| L9 | GET /api/queue + shapedQueue (9360/9432) | RAW db.metadata record (title, folderName, filePath) for media; ep/track titles; INSERT is existence-only | thread requester visibility, silent-drop hidden entries; INSERT visibility-checks (S3) |
| L10 | GET /api/podcasts/shows (lib/podcasts:910) | external (yt-dlp) show names + counts + thumb ids appended UNFILTERED | filter externalShows by the underlying items' mediaVisibleTo |
| L11 | GET /api/podcasts/shows/:id/episodes (1048) | external `yt:` branch lists ALL items (title + watchHref), no visibility | filter external episodes by mediaVisibleTo |

### TRACK - deliberately deferred (minor: aggregate count only, or shared
### registry by design, or a general root path not tied to a hidden item)

| Surface | Why deferred | Where |
| ------- | ------------ | ----- |
| GET /api/podcasts/health (754) | TOTAL show+episode counts only, no titles/paths - a coarse count-oracle | new tracker row |
| GET /api/podcasts/settings (1313) | the general podcasts ROOT abs path (not per-hidden-item), same class as the config-trio root paths but with no member consumer needing it | new tracker row |
| GET /api/subscriptions/status,history,failures (lib/ytdlp) | channel REGISTRY job-logs; can surface a currently/failed-downloading item TITLE. Registry is shared by design (same class as tech-debt #150 fan-outs); gating per-visibility is a different model | fold into #150 |

### SAFE - verified filtered / own-state / no content in body (spot list)

/api/videos, /api/home, /api/channels, /api/videos/:id, /api/feed-hidden,
/api/liked, /api/history, /api/trash, /api/stats (visibleMetadata),
/api/notifications(+badge), /api/handoff, all byte-serve routes
(/video,/track,/thumbnail,/bookcover,/albumart,/episode,/podcastart - each
404s a restricted id), /api/books, /api/books/:id, /api/music,
/api/music/albums, /api/music/artists (all filter BEFORE aggregating),
podcasts subscriptions/episodes/episodes/:id/liked/pins, and every
own-per-user-state route (progress/resume/search-history/*-liked ids). Admin
surfaces (backup, users, restrictions) are requireAdmin-gated.

### S4 personal-write oracle tail
The POST like/progress/played/queue-insert routes the write net calls
`personal` are existence-oracles-at-worst (no title/path in the response).
Upgrade the queue INSERT (L9/S3) to a real visibility check; the rest get the
predicate where it is already loaded, else a tracker row - the net's
"existence oracle at worst" comment must end this wave TRUE or deleted.
