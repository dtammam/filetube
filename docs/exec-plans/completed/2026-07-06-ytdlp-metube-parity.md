# yt-dlp module MeTube parity (v1.12.0)

Target release: **v1.12.0**. Feature id: `ytdlp-metube-parity`. Branch:
`feature/ytdlp-metube-parity` (off `main`, currently v1.11.1).

Absorbs the parked `feature/ytdlp-oneshot-download` discovery as workstream A.
**Extends** the shipped v1.11.0/v1.11.1 optional yt-dlp module
(`docs/exec-plans/completed/2026-07-05-yt-dlp-integration-module.md`,
34/34 ACs met). This plan does **not** re-litigate that module's architecture
or its locked decisions D1-D5 (exactly-five-ENV-vars-plus-the-v1.11.1-hotfix
sixth `FILETUBE_YTDLP_MAX_VIDEOS`, cookies-file-only auth, dedicated
`/subscriptions` page, pinned yt-dlp, no runtime auto-update) — those still
hold and constrain this feature.

## Goal

Bring the optional yt-dlp module to MeTube-shaped parity — a one-shot paste-a-
URL downloader, dropdown format/quality selection, per-channel video-count
limits, pause/edit, live poll-based progress, and three confirmed bug fixes —
without turning it into a job-queue system and without degrading FileTube in
any way when the module is disabled.

## Scope

One cohesive feature spanning nine workstreams:

- **A.** One-shot single-video URL download (`POST /api/ytdlp/download`),
  no persistent subscription created.
- **B.** Format + quality as dropdowns on both the subscription form and the
  new one-shot form.
- **C.** Per-subscription override of the global `FILETUBE_YTDLP_MAX_VIDEOS`.
- **D.** Edit a subscription (format/quality/N) without delete-readd, plus a
  pause/resume flag skipped by the poll loop.
- **E.** Real per-subscription download progress (state/title/N-of-M/percent),
  polled by the UI every ~2-3s (no WebSocket).
- **F.** BUG FIX: clean, display-only human titles for yt-dlp downloads
  (strip the trailing `[<id>]` and underscore-to-space), without touching
  `--restrict-filenames` or media identity.
- **G.** BUG FIX + FEATURE: collapse duplicate library entries caused by
  divergent root-path spellings, and surface the download directory as a
  renamable, self-healing, **display-only** synthetic folder in
  `GET /api/config`/the sidebar (no `db.folders` write).
- **H.** `--embed-metadata` (+ `--embed-thumbnail` where supported) for both
  audio and video downloads.
- **I.** Assertion + docs-only: confirm "deleted stays gone" already holds
  (`.ytdlp-archive.txt` survives UI delete + prune-missing) — no code change.

## Out of scope

- Not a general-purpose download manager: no arbitrary playlist/channel
  one-shot download (single-video URL only), no download-queue visualization,
  no per-video format picker beyond the two dropdowns, no scheduling UI beyond
  the existing single poll interval.
- WebSocket/SSE transport for status — polling only (Dean-locked).
- A "force re-pull" that bypasses `--download-archive` — still out of scope
  (unchanged from v1.11.0/D3).
- Per-subscription custom poll interval — still one global poll interval.
- The deep prune/mount-loss redesign tracked as tech-debt #10
  (`docs/exec-plans/tech-debt-tracker.md`) — **not** in scope for v1.12.0
  unless the principal engineer finds that G's realpath hardening naturally
  subsumes part of it; if so, PE must **flag it**, not silently expand scope.
- Multiple cookies files / per-subscription cookies — still one global file.
- **Not deferrable:** tests, `npm run lint` zero-warnings, and the
  disabled-path no-op guarantee are explicitly **in scope** for every
  workstream in this feature (CONTRIBUTING.md's "every feature ships with
  tests" applies uniformly) — nothing below softens that.

## Constraints

**#1, non-negotiable, threads through every workstream below:
OPTIONAL / ADDITIVE / MUST-NOT-DEGRADE.**

When the module is **disabled** (default, `FILETUBE_YTDLP_ENABLED` off),
FileTube stays **byte-identical**:
- No new routes registered — not present, not 403 — absent from the router.
  This includes the new one-shot download endpoint, the new/changed status
  surface, and the new edit/pause endpoint, in addition to the existing
  subscriptions routes.
- No new background poll behavior armed.
- No new UI surfaced (one-shot form, dropdown replacements, pause toggle,
  live-status polling, synthetic folder entry) served or rendered.
- The existing test suite stays green with **zero** behavior change with the
  module present-but-disabled.

**EXCEPTION-BY-DESIGN, called out explicitly:** bug fix **F** (clean display
titles) and the **G-hardening** half (realpath/resolve scan-root
normalization) touch **core** scan/title code that runs for **all** users,
including installs that have never touched the yt-dlp module. Those two must
be scoped so that:
- a non-yt-dlp library file's title/filename is **not** rewritten (F's regex
  is tightly scoped to the yt-dlp `--restrict-filenames` output shape:
  `...[<11-char id>].<ext>`), and
- realpath/resolve normalization only collapses **divergent spellings of the
  same real directory tree** — it must never merge two genuinely distinct
  trees, and it must not change scan behavior for existing non-yt-dlp folder
  configurations beyond that collapse.

Both are proven by explicit regression acceptance criteria below (not merely
asserted in prose).

**G softens a prior locked decision, intentionally:** v1.11.0's C7(ii)
("`GET /api/config` never lists a folder the operator didn't add") is
**intentionally softened** by G's display-only synthetic folder merge. This is
**Dean-approved**, not a re-opened fork. The softening is narrowly scoped: the
synthetic entry is never written to `db.folders`, never evictable/addable via
`POST /api/config`, and carries no scan/prune authority of its own —
`extraScanRoots()` remains the sole authoritative scan root and the E1
OR-gate mount-loss protection stays intact regardless of the synthetic
entry's presence.

Additional constraints (carried from v1.11.0, unchanged):
- Node 22 LTS / Express 4, CommonJS; no new heavyweight runtime deps.
- yt-dlp is invoked via `execFile`/`spawn` with an argument array, never a
  shell; a `--` positional separator precedes any user-supplied URL.
- Every download destination (subscription channel dir, and now the one-shot
  folder) is path-confined to the configured download root.
- Cookies file: read-only, never logged, never persisted beyond its path.
- FFmpeg/yt-dlp-dependent paths stay OUT of the automated `node:test` suite;
  the download itself and the embedded-metadata/thumbnail postprocessing are
  verified manually/on-device, not in CI.
- Failures degrade gracefully (log + skip/continue), mirroring
  RELIABILITY.md's spawn try/catch policy — a bad download never crashes the
  server or wedges the poll loop.
- Serialization: the one-shot download and the subscription poll loop must
  never spawn yt-dlp in parallel — one child process at a time, mirroring the
  existing single-worker transcode/poll posture.

## Functional requirements

### FR-A — One-shot URL download
`POST /api/ytdlp/download`, registered only inside the `isEnabled` gate.
Accepts a single-video URL; rejects channel/playlist/handle-shaped URLs with
`400` (reusing the existing channel/playlist detection the URL validator
already performs, inverted for the single-video case). On a valid single-video
URL: responds `202` immediately and runs the actual download in the
background (fire-and-forget), serialized with the subscription poll loop (no
parallel yt-dlp spawns). No persistent subscription record is created.
Defaults to a `"One-Off"` subfolder under the download root when no folder is
specified. A small UI (paste-URL field + the format/quality dropdowns from
FR-B) drives it.

### FR-B — Format + quality dropdowns
Both the subscription add/edit form and the one-shot form present format
(audio/video) and quality as **dropdowns**, replacing any free-text quality
input. Quality options are exactly the existing `normalizeQuality` allowlist
(`best`, `2160p`, `1440p`, `1080p`, `720p`, `480p`, `360p`), default `best`.
Server-side re-validation (the existing `normalizeQuality`/`assertFormat`
re-assertion) applies to values arriving from **both** forms/endpoints — a
value outside the allowlist is neutralized, never passed through to argv.

### FR-C — Per-channel "download last N"
A subscription may carry its own `maxVideos` override, settable via the
add/edit form. When set, it is applied as `--playlist-end <N>` for that
subscription's list pass, overriding the global `FILETUBE_YTDLP_MAX_VIDEOS`
default (25) for that channel only. When unset, the existing global default
applies unchanged. The value must be a positive integer within a sane upper
bound; an invalid value is rejected (not silently coerced) at the API
boundary.

### FR-D — Pause/resume + edit
An edit endpoint (e.g. `PATCH /api/subscriptions/:id`) changes
format/quality/maxVideos on an existing subscription without deleting and
re-adding it — `addedAt`, `lastCheckedAt`, `lastStatus`, and the download
archive are all preserved untouched. A persisted `paused` boolean (default
`false`) is added; the poll loop (scheduled and re-pull-all) skips any
subscription with `paused: true`. The UI exposes a pause/resume toggle and an
edit form reusing the add form's fields.

### FR-E — Live status via polling
Replace the current static/last-known status with real in-progress download
state, parsed from yt-dlp's own progress output (percent/ETA during a
download) into a per-subscription status object: `state`
(`queued`/`listing`/`downloading`/`done`/`error`), the current video's title,
an `N of M` position, and a `percent`. This is exposed via a status
field/endpoint (`GET /api/subscriptions` and/or a dedicated
`GET /api/subscriptions/status`) that the `/subscriptions` page polls every
**~2-3 seconds**. Kept simple: in-memory current-activity state for the
in-flight item, plus the already-persisted `lastStatus` for the terminal
record — no new persistence machinery, no job-queue history.

### FR-F — Clean display titles (bug fix, display-only)
**Confirmed mechanic (do not re-investigate):** the title shown today is
`path.basename(info.name, info.ext)` (`server.js:998`), which for a yt-dlp
download is the `--restrict-filenames` name
`Title_With_Underscores [<id>].ext`. Fix: a tightly-scoped helper applied at
title derivation that strips a trailing ` [<11-char id>]` and converts
`_` → space (pattern shape:
`/^(.*?)[ _]\[[A-Za-z0-9_-]{11}\]$/`). `--restrict-filenames` is **not**
removed (SF4 stays intact). **Confirmed non-load-bearing:** `getMediaId`
hashes the file **path**, not the bracketed id (`server.js:511`); dedup uses
the separate `.ytdlp-archive.txt` — so this cleanup changes only the `title`
field, never a media id, and needs no db migration.

### FR-G — Fix duplicate entries + display-only folder registration
**Confirmed root cause (do not re-investigate):** media id is
`md5(absolute path)` (`server.js:511`); the merged scan-root set is
`Array.from(new Set([...db.folders, ...ytdlp.extraScanRoots(config)]))`
(`server.js:955`), which dedups only **byte-identical strings**; `db.folders`
entries are persisted as-typed/unresolved (`server.js:~1258-1264`, `POST
/api/config` pushes `trimmed`, never `path.resolve`d), while
`extraScanRoots()` always returns `path.resolve(downloadDir)`. A
bind-mount/symlink/relative re-spelling of the same tree therefore produces
two different root strings → two path-based ids → duplicate library rows.

Two-part fix:
1. **Hardening:** normalize (realpath, per-**root**, not per-file) the merged
   scan-root set before the `Set` dedup, and `path.resolve` `db.folders`
   entries at write time (`POST /api/config`), so divergent spellings of the
   same real tree collapse to one root before scanning.
2. **Display-only folder merge (Dean-approved; softens C7(ii)):**
   `GET /api/config` and the sidebar/playlists UI include the module's
   `extraScanRoots()` download directory as a **synthetic** folder entry,
   without ever writing it into `db.folders`. `extraScanRoots()` remains the
   sole authoritative scan root and retains the E1 OR-gate mount-loss
   protection unchanged. The synthetic entry is renamable via a persisted
   `folderSettings[downloadDir].name` (only the settings entry persists, not
   the folder itself), and self-heals on next launch (it is derived fresh
   from `extraScanRoots()` every time, never a one-time materialization).

### FR-H — Embed metadata + thumbnails
`--embed-metadata` (and `--embed-thumbnail` where the yt-dlp/ffmpeg
combination supports the resulting container) is added to the download args
for **both** audio and video downloads (MeTube embeds metadata for audio
only; this feature makes it explicit for both, per Dean's decision).

### FR-I — Deleted-stays-gone (assertion + docs only)
**Confirmed already working, no code change:** `.ytdlp-archive.txt` persists
through UI delete and prune-missing; a subsequent poll does not re-download a
deleted video; subscription-delete deliberately never touches the archive
(D3). This feature adds an explicit regression assertion for the guarantee,
plus a docs note on the archive-persistence dependency for network-share
download directories (if the share/archive is transiently unavailable at
poll time, dedup is lost for that poll and the channel may re-download).

## Non-functional / security requirements

### NFR1 — One-shot reuses the T3/T4 security core verbatim
The one-shot endpoint is a **T3/T4-class** surface (it spawns yt-dlp against a
user-supplied URL) and must reuse, not reimplement: `validateChannelUrl`-class
allowlist/normalization (with the single-video/channel-playlist distinction
applied), arg-array `execFile`/`spawn` (never `shell: true`), the `--`
positional separator, path confinement on the resolved folder
(`resolveChannelDir`-equivalent), cookies redaction on every sink (log,
returned error, persisted field), timeout + `SIGKILL`, and
`--restrict-filenames`.

### NFR2 — No parallel yt-dlp spawns
The one-shot download and the subscription poll loop share one serialization
gate — a one-shot request arriving while a poll is in flight (or vice versa)
queues/coalesces rather than spawning a second concurrent yt-dlp process.

### NFR3 — Status/progress redaction
Any new status/progress sink introduced by FR-E or FR-A (in-flight state,
percent, error text surfaced live) is redacted the same way `lastStatus`
already is (SF1) — a cookies path never appears in a live/in-progress status
field, log line, or API response.

### NFR4 — Core-scan-path regressions are provably absent
FR-F and FR-G's hardening half touch code paths that run unconditionally
(not behind `isEnabled`). Both must ship with an explicit regression test
proving non-yt-dlp behavior is unchanged (see Acceptance criteria, Cross-
cutting section).

## Testability requirements

Per CONTRIBUTING.md/RELIABILITY.md conventions, kept pure/mockable wherever
possible, no real yt-dlp binary or network access in the automated suite:
- Title-cleanup regex/helper (FR-F): pure string → string, unit-testable.
- Scan-root realpath normalization + `db.folders` resolve-on-write (FR-G):
  pure/fs-mockable helpers, unit-testable; the merge into `GET /api/config`
  is integration-testable against a temp `DATA_DIR`.
- Status/progress parsing (FR-E): pure parser over representative captured
  yt-dlp stdout/stderr fixtures, unit-testable without a real binary.
- One-shot URL validation, folder-confinement, and arg-building (FR-A):
  pure, reusing/extending the existing FR-A-adjacent T3 helpers.
- `--playlist-end` per-subscription override (FR-C): pure arg-builder
  extension, unit-testable exactly like the existing global-default test.
- Edit/pause persistence (FR-D): integration-testable against a temp
  `DATA_DIR`, mirroring the existing subscriptions CRUD tests.
- Embed-metadata/thumbnail flags (FR-H): pure arg-array assertion,
  unit-testable; the actual postprocessing/ffmpeg dependency availability is
  a manual/build-verification check, not an automated test.
- The one-shot download itself, the live in-flight download progress against
  a real yt-dlp process, and embedded-metadata/thumbnail correctness in the
  produced file are `[MANUAL]`/on-device checks — kept out of the automated
  suite (mirrors the existing FFmpeg-out-of-CI policy).

## Acceptance criteria

### Disabled path is a no-op (the acceptance north star)

1. [INTEGRATION] With the module disabled, `POST /api/ytdlp/download` is not
   registered — the route returns Express's native `404`, indistinguishable
   from a route that was never defined.
2. [INTEGRATION] With the module disabled, the new/changed status surface
   (dedicated status endpoint and/or the status field on
   `GET /api/subscriptions`) is absent/`404` exactly as the rest of the
   subscriptions API already is.
3. [INTEGRATION] With the module disabled, the new edit/pause endpoint
   (`PATCH /api/subscriptions/:id` or equivalent) is not registered — `404`.
4. [INTEGRATION] With the module disabled, `GET /api/config` does not include
   the FR-G synthetic folder entry (unchanged from today: `folders` reflects
   only `db.folders`).
5. [MANUAL] With the module disabled, no new UI surface (one-shot form,
   pause toggle, live-status polling behavior, synthetic folder entry in the
   sidebar/playlists sheet) is present in the served HTML/nav.
6. [PROCESS] The full existing automated test suite passes unmodified with
   the module present-but-disabled, proving zero behavior change to current
   functionality.
7. [PROCESS] `npm run lint` passes with zero warnings on all new/changed code.

### A — One-shot URL download

8. [INTEGRATION] `POST /api/ytdlp/download` with a valid single-video URL, the
   module enabled, responds `202` and the actual download is not awaited by
   the request (the response returns before the download completes).
9. [INTEGRATION] `POST /api/ytdlp/download` with a channel/playlist/handle-
   shaped URL responds `400` and never spawns yt-dlp.
10. [INTEGRATION] `POST /api/ytdlp/download` with a malformed/non-YouTube/
    non-http(s) URL responds `400`.
11. [INTEGRATION] A successful one-shot download lands under the confined
    download root, in a `"One-Off"` subfolder by default, and is indexed by
    the existing scanner (appears via the standard metadata endpoints).
12. [INTEGRATION] A one-shot request arriving while the scheduled/manual
    subscription poll is in flight (and vice versa) never results in two
    concurrent yt-dlp child processes — verified via a spy/mock on the
    invocation boundary.
13. [MANUAL] The one-shot UI (paste-URL field + format/quality dropdowns)
    submits the request and surfaces an accepted/queued acknowledgment.

### B — Format + quality dropdowns

14. [MANUAL] The subscription add/edit form presents quality as a dropdown
    (the existing free-text quality input is removed/replaced).
15. [MANUAL] The one-shot form presents both format and quality as dropdowns.
16. [UNIT] A hostile/non-allowlisted quality value submitted through either
    the subscription endpoint or the one-shot endpoint is neutralized to the
    default (`best`) before it can influence any yt-dlp argument — reusing
    `normalizeQuality`, not a parallel implementation.
17. [UNIT] Quality defaults to `best` when omitted on both endpoints.

### C — Per-channel "download last N"

18. [UNIT] A subscription's `maxVideos` field persists when set via
    add/edit and is honored (`--playlist-end <N>`) for that subscription's
    list pass, taking precedence over the global `FILETUBE_YTDLP_MAX_VIDEOS`.
19. [UNIT] When a subscription's `maxVideos` is unset, the global default
    (`FILETUBE_YTDLP_MAX_VIDEOS`, currently 25) applies unchanged — existing
    global behavior is not regressed.
20. [UNIT] `maxVideos` bounds validation: a non-positive-integer or
    absurd/out-of-range value is rejected (`400`) at the add/edit boundary,
    not silently coerced.

### D — Pause/resume + edit

21. [INTEGRATION] `PATCH /api/subscriptions/:id` changes format/quality/
    maxVideos on an existing subscription without a delete+re-add — `addedAt`,
    `lastCheckedAt`, `lastStatus`, and the download-archive dedup state are
    all preserved.
22. [INTEGRATION] A subscription with `paused: true` is skipped by both the
    scheduled poll and a "re-pull all" trigger.
23. [INTEGRATION] Setting `paused: false` (unpause) resumes normal inclusion
    in the poll loop on the next cycle.
24. [INTEGRATION] `PATCH` on an unknown subscription id responds `404`.
25. [INTEGRATION] With the module disabled, the edit/pause endpoint is `404`
    (restates AC 3 in this group for grouping completeness).
26. [MANUAL] The subscriptions UI exposes a pause/resume toggle and an edit
    form (reusing the add form's fields) per subscription row.

### E — Live status via polling

27. [UNIT] A status/progress parser extracts `state`, current video title,
    `N of M`, and `percent` from representative captured yt-dlp stdout/
    stderr progress-line fixtures (no real binary invoked).
28. [INTEGRATION] The status endpoint/field reflects an in-flight download's
    `state`/title/`N of M`/`percent` (against a mocked spawn/progress
    stream), distinct from the terminal `lastStatus` string.
29. [MANUAL] The `/subscriptions` page polls the status endpoint every
    ~2-3 seconds and updates each subscription row live (pending →
    downloading % → finished/error), matching the MeTube UX shape.
30. [INTEGRATION] Terminal states (`done`/`error`) are correctly exposed via
    the status surface once a poll cycle completes.
31. [UNIT] An error status surfaced via the live/in-flight status field never
    contains a cookies path (reuses the existing SF1 redaction).
32. [INTEGRATION] With the module disabled, the status endpoint/field is
    absent (restates AC 2 for grouping completeness).

### F — Clean display titles (bug fix)

33. [UNIT] A yt-dlp-produced filename shaped
    `Title_With_Underscores [dQw4w9WgXcQ].mp4` (an 11-character id) renders
    the display title `Title With Underscores`.
34. [UNIT] Regression: a plain non-yt-dlp library file named
    `My_Home_Movie.mp4` renders its title **unchanged** (`My_Home_Movie` —
    the pattern requires a trailing bracketed 11-char id, which this file
    doesn't have).
35. [UNIT] Regression: a non-yt-dlp file legitimately named
    `Something [notanid].mp4` (bracket content is not exactly an 11-character
    id-shaped token) renders its title **unchanged**.
36. [UNIT] The cleanup is display-only: `getMediaId(filePath)` is identical
    before and after the title-derivation change for the same file — no id
    churn, no db migration.
37. [INTEGRATION] `--restrict-filenames` remains present in the download
    argument array (SF4 unchanged by this fix).

### G — Fix duplicate entries + display-only folder registration

38. [UNIT] Realpath/normalize hardening: two divergent spellings of the
    **same real directory tree** (e.g. a symlink/bind-mount alias vs. its
    target, or a relative vs. resolved-absolute spelling) collapse to **one**
    entry in the merged scan-root set before scanning (regression test for
    the confirmed `server.js:955` byte-identical-`Set`-dedup bug).
39. [UNIT] Regression: two **distinct** (non-overlapping) real directory
    trees are never collapsed by the realpath hardening — only divergent
    spellings of the *same* tree collapse.
40. [UNIT] `db.folders` entries are `path.resolve`d at write time
    (`POST /api/config`), so a later divergent-but-equivalent spelling of an
    already-configured folder does not create a second `db.folders` entry.
41. [INTEGRATION] End-to-end: a bind-mount/relative re-add of a tree already
    covered (by `db.folders` or by `extraScanRoots`) under a different
    spelling yields **one** scanned entry/one set of media ids, not
    duplicated library rows.
42. [INTEGRATION] `GET /api/config` includes the module's download directory
    as a synthetic folder entry **without** it being present in the
    persisted `db.folders` array.
43. [MANUAL] The download folder appears in the sidebar/playlists UI without
    requiring a manual "add folder" action.
44. [INTEGRATION] The synthetic folder entry is renamable via a persisted
    `folderSettings[downloadDir].name` entry — only the settings entry
    persists; the folder itself is never written to `db.folders`.
45. [INTEGRATION] The synthetic folder self-heals: after removing/resetting
    its name/entry, the next launch re-derives it fresh from
    `extraScanRoots()` rather than requiring re-creation by an operator.
46. [INTEGRATION] With the module disabled, the synthetic folder entry is
    absent from `GET /api/config` (restates AC 4 for grouping completeness).
47. [INTEGRATION] Regression: no scan/prune decision path depends on the
    synthetic `db.folders` presence — the E1 OR-gate mount-loss protection
    (a transiently-missing download-dir mount is never reaped) is provably
    unaffected by the presence or absence of the synthetic UI entry.

### H — Embed metadata + thumbnails

48. [UNIT] The download argument builder includes `--embed-metadata` for
    `format === 'audio'` downloads.
49. [UNIT] The download argument builder includes `--embed-metadata` for
    `format === 'video'` downloads.
50. [UNIT] The download argument builder includes `--embed-thumbnail` for
    both audio and video downloads.
51. [MANUAL/PROCESS] Build-verification: the pinned Docker image's yt-dlp +
    ffmpeg combination supports `--embed-metadata`/`--embed-thumbnail`
    postprocessing without a missing dependency (checked on-device or as
    part of the image build/verification pass, not in the `node:test` suite).

### I — Deleted-stays-gone (assertion + docs)

52. [INTEGRATION] Deleting a downloaded video via FileTube's normal delete
    path, then triggering the next poll/re-pull, does **not** re-download it
    — the archive entry survives delete + prune-missing (assertion test; no
    production code change expected for this workstream).
53. [MANUAL] A docs note (README and/or `docs/ARCHITECTURE.md`) documents the
    archive-persistence dependency: for network-share download directories,
    if the share/archive file is transiently unavailable at poll time, dedup
    is lost for that poll and the channel may re-download.

### Cross-cutting — security reuse

54. [INTEGRATION] The one-shot endpoint's URL validation reuses the same
    allowlist/normalization/channel-vs-single-video distinction as the
    subscriptions endpoint — not a parallel, divergent implementation.
55. [INTEGRATION] The one-shot download resolves its target folder through
    the same path-confinement mechanism used for subscription channel
    directories — a hostile folder/subfolder value can never write outside
    the confined download root.
56. [INTEGRATION] A spy/mock on the invocation boundary confirms the
    one-shot spawn uses an argument array (never `shell: true`) with a `--`
    separator immediately before the positional URL, even for a URL
    containing shell metacharacters (e.g. `; rm -rf /`).
57. [INTEGRATION] Cookies path redaction is verified on every new sink this
    feature introduces (one-shot error/status, live-status/progress fields,
    edit-endpoint error responses) — never appears in logs, API responses,
    or `db.json`.
58. [INTEGRATION] The one-shot spawn is subject to the same timeout +
    `SIGKILL` policy as the existing subscription download spawn (no
    unbounded child process).

### Cross-cutting — Node 22 / process

59. [PROCESS] All new/changed automated tests pass under Node 22 (not just a
    newer local Node), matching the CI gate and the `.nvmrc`/`.node-version`
    pin.
60. [PROCESS] The one-shot endpoint (FR-A), the status/progress parser
    (FR-E), and the folder display-only merge + realpath hardening (FR-G)
    ship under the full two-reviewer gate (mirrors the v1.11.0 T3-class
    security review posture).

## Open Questions

**None.** Every product decision for this feature is pre-locked by Dean (see
`.state/feature-state.json`): one cohesive feature; polling only (no
WebSocket); dropdowns for format+quality on both forms; a display-only
synthetic folder (the C7(ii) softening is intentional and approved); a
per-channel override of the global max-videos default; `--embed-metadata`
for both audio and video; a single-video-only one-shot download defaulting to
a `"One-Off"` subfolder, `202`+background, serialized with the poll loop. No
genuinely new product fork surfaced during this Discovery pass — proceeding
on the locks above.

## Design

### Approach

Every server-side addition lands **inside the existing `isEnabled` gate** in
`lib/ytdlp/index.js`'s `registerRoutes` (new routes) or on the existing
module-owned scan/serialization seams — so the disabled path stays
byte-identical (the acceptance north star). Two workstreams (**F** title
cleanup, **G** realpath hardening) are the only ones that touch core,
always-on `server.js` code; both are scoped to pure, unit-tested helpers whose
behavior is a strict no-op for non-yt-dlp inputs.

The design reuses the shipped v1.11.0/v1.11.1 primitives verbatim wherever
possible: `validateChannelUrl`/`isSafeVideoId`/`buildWatchUrl` (url.js),
`normalizeQuality`/`assertFormat`/`resolveChannelDir`/`buildYtdlpDownloadArgs`
(args.js), `run.runList`/`run.runDownload` + the SF1-SF7 spawn wrappers
(run.js), `updateDatabase`/`ensureYtdlp` (store.js), and `extraScanRoots`
(index.js). New machinery is deliberately minimal: one pure progress parser,
one ephemeral in-process activity map, and one shared spawn-serialization gate.

Two genuinely new module files, both pure/side-effect-free at require time:

- **`lib/ytdlp/progress.js`** — a pure `parseProgressLine(line)` parser.
- **`lib/ytdlp/activity.js`** — the ephemeral (non-persisted) in-process
  activity map for FR-E, rebuilt on restart.

### FR-E — Live status via polling (in-memory activity model)

**State model.** `lib/ytdlp/activity.js` holds a module-level, in-process,
**non-persisted** map — two namespaces so one-shot jobs (which have no
subscription row) have a home:

```text
{
  subscriptions: { <subId>: LiveEntry, ... },
  oneShots:      { <jobId>: LiveEntry, ... }
}
```

`LiveEntry` (the exact JSON the UI consumes):

```json
{
  "state": "downloading",
  "title": "Some Video Title",
  "index": 2,
  "total": 5,
  "percent": 47.2,
  "label": "Channel Name or One-Off",
  "url": "https://www.youtube.com/watch?v=...",
  "updatedAt": "2026-07-06T12:34:56.789Z"
}
```

`state ∈ {idle, queued, listing, downloading, done, error}`. `title`/`url`
may be `null`; `index`/`total`/`percent` are numbers (0 when unknown).
`url` is only set for one-shots (already a validated single-video YouTube URL
— safe to surface). For the `error` state the entry carries no free-form
field beyond the already-redacted `lastStatus`-shaped string produced by
`safeErrorStatus` (NFR3/AC31 — the activity map NEVER stores a raw
error/stderr; only the redacted composed status).

Exports (all synchronous, single-threaded — no locks needed):

- `setSubscription(id, patch)` / `setOneShot(id, patch)` — shallow-merge
  `patch` into the entry, stamp `updatedAt`.
- `clearSubscription(id)` — drop an entry (called on subscription delete).
- `getSnapshot()` — returns a plain-object copy `{ subscriptions, oneShots }`;
  prunes terminal (`done`/`error`) one-shots older than `ONESHOT_TTL_MS`
  (5 min) so the one-shot namespace never grows unbounded. Subscription
  entries are bounded by subscription count and kept as the "last live"
  record between polls.
- `resetForTests()` — mirrors `resetPollRerunStateForTests`.

**Where state lives / lifecycle.** The persisted `sub.lastStatus`/
`lastCheckedAt` remain the durable terminal summary (unchanged). The activity
map is the *ephemeral in-flight* layer, rebuilt from empty on restart. State
transitions are driven by the orchestrator (`index.js`), not the parser:

- `runPoll`: each targeted sub set to `queued` at loop entry.
- `runSubscriptionCycle`: `listing` before `run.runList`; then
  `downloading` with `total = survivorIds.length`, `index = 0` before
  `run.runDownload`; `done` (percent 100) on success; `error`
  (redacted status) on any failure.
- `runOneShot`: `queued` → `downloading` (`total = 1`) → `done`/`error`.

**Progress parser (`lib/ytdlp/progress.js`).** Pure
`parseProgressLine(line) → patch | null`, recognizing the real yt-dlp
newline-delimited shapes (fixtures for the unit test):

- `[download]  47.2% of  10.00MiB at ...` → `{ percent: 47.2 }`
- `[download] Downloading item 3 of 12` → `{ index: 3, total: 12 }`
- `[download] Destination: <dir>/Title [id].mp4` → `{ title: <cleanDisplayTitle(basename)> }`
- `[download] 100% of ...` / `has already been downloaded` → `{ percent: 100 }`

Returns `null` for any non-progress line. The parser never touches process
state and never sees cookies (the argv/stderr redaction is upstream).

**Capturing progress without breaking v1.11.1 invariants.** `run.runDownload`
gains a 4th arg `opts = { onProgress }`, forwarded to `spawnYtdlpDownload`.
On the **download** path only:

- add `--newline` to `buildYtdlpDownloadArgs` so progress is line-delimited
  (yt-dlp otherwise rewrites a single line with `\r`).
- change the download `stdio` from `['ignore','ignore','pipe']` to
  `['ignore','pipe','pipe']` and attach a **line-splitting** consumer to
  BOTH stdout and stderr that decodes chunk-boundary-safely (reuse the
  `StringDecoder` pattern), splits on `\n`, and for each complete line calls
  `parseProgressLine` → `onProgress(patch)` for non-null patches. stdout is
  **parsed-and-discarded** (never accumulated); the partial-last-line carry
  is capped at `STDERR_TAIL_LIMIT`. The stderr **bounded diagnostic tail
  (SF3)** is unchanged — the line consumer reads the same decoded stream the
  tail already builds from. Add the SF7 `stdout.on('error')` guard mirroring
  the list path (which already guards both streams). The list path is
  untouched.

This preserves streaming (no `maxBuffer`), redaction (SF1 — `onProgress`
never receives the argv; titles come from the confined download path), and
the bounded tail (SF3).

**Exposure.** A dedicated `GET /api/subscriptions/status` returns
`activity.getSnapshot()` (registered inside the `isEnabled` gate → absent/404
when disabled, AC 2/32). Chosen over augmenting `GET /api/subscriptions` so the
list endpoint stays stable and one-shots (no sub row) have a home. The
`/subscriptions` client polls it every **2500 ms** (a `setInterval`, cleared
on page hide) and merges each entry into its row (subscriptions) or renders a
transient one-shot row. Race-safety: the single-flight poll loop + the shared
spawn gate (below) mean only one writer is ever in a non-terminal state at a
time; the map is plain synchronous single-threaded mutation.

### FR-A — One-shot endpoint + shared serialization

**Serialization gate (NFR2).** Add a module-level FIFO in `index.js`:

```js
let ytdlpTail = Promise.resolve();
function runExclusive(fn) {
  const result = ytdlpTail.then(fn, fn);
  ytdlpTail = result.then(() => {}, () => {});
  return result;
}
```

The poll body (the `for (const sub of targets)` loop inside `runPoll`) and the
one-shot task both run inside `runExclusive`, so a poll and a one-shot can
never spawn yt-dlp concurrently — whichever arrives second queues behind the
first. `pollBusy` + the existing coalesce machinery are KEPT unchanged (their
job is distinct: prevent stacking redundant *polls*; `runExclusive` serializes
*spawns* across the poll and one-shot). A one-shot arriving mid-poll queues
(not coalesces); a poll trigger arriving mid-one-shot proceeds through
`pollBusy` and its body queues behind the one-shot via `runExclusive`.

**Endpoint** (inside the `isEnabled` gate):

```text
POST /api/ytdlp/download
body: { url: string, format?: 'audio'|'video', quality?: <allowlist>, folder?: string }
```

Synchronous validation, then `202` + fire-and-forget:

1. `url` → new `url.classifySingleVideo(raw)` (below). Not a single-video URL
   (channel/playlist/handle) or malformed/non-YouTube/non-http(s) → `400`,
   never spawns (AC 9/10).
2. `format` via `store.VALID_FORMATS` (default `video`); `quality` via
   `args.normalizeQuality` (default `best`, AC 16/17).
3. `folder` (default `"One-Off"`) is confined via
   `args.resolveChannelDir(config, { name: folder })` — reuses the exact
   traversal guard (AC 55).
4. Respond `202 { accepted: true, jobId }` where `jobId = crypto.randomUUID()`;
   the download runs in the background (its own `try/catch`, no db lock across
   the await — the Express-4 async-crash lesson), via
   `runExclusive(() => runOneShot(deps, config, { videoId, url, format, quality, folder, jobId }))`.

`runOneShot(deps, config, params)` (new, in `index.js`):

- `activity.setOneShot(jobId, { state:'downloading', total:1, index:1, label:folder, url })`.
- Build a synthetic sub `{ id: jobId, name: folder, format, quality }` and
  call `run.runDownload(syntheticSub, config, [videoId], { onProgress })` —
  reuses `--restrict-filenames`, `--download-archive` dedup, timeout+SIGKILL,
  cookies redaction verbatim (NFR1/AC 54-58).
- On success: `quarantineEscapedDownloads(resolveChannelDir(...))` (SF4,
  before scan) → `deps.scanDirectories().catch(...)` → `done`.
- On failure: `error` with `safeErrorStatus(...)`.

**New `url.classifySingleVideo(raw)`** in `url.js`: run `validateChannelUrl`
first (all security checks), then inspect the normalized URL — `youtu.be/<id>`
→ `{ ok:true, videoId:<path> }`; `youtube.com/watch?v=<id>` →
`{ ok:true, videoId:<v> }`; anything else (`/playlist`, `/channel`, `/@`,
`/c/`, `/user/`) → `{ ok:false, error }`. `videoId` re-checked with
`isSafeVideoId`. Single source of truth — no parallel validator (AC 54).

### FR-C — Per-channel N

Add optional `maxVideos` to the subscription record. `buildYtdlpListArgs(sub,
config)` already receives `sub`; compute the effective bound inline —
precedence `sub.maxVideos ?? config.maxVideos` (config already defaults to 25),
`0` = unlimited per-sub — and feed `playlistEndArgs({ maxVideos: effective })`.
`playlistEndArgs`'s signature is unchanged (it already reads `.maxVideos` off
its arg). Download pass is unaffected (already id-scoped). Validation lives in
`validateSubscriptionInput`/the PATCH handler (below): integer in
`[0, MAX_SUB_MAX_VIDEOS]` (bound e.g. 5000), else `400` (AC 18-20).

### FR-D — Edit + pause

**Record fields.** Add `paused: boolean` (default `false`) and optional
`maxVideos`. `ensureYtdlp` gains a per-sub backfill loop
(`if (typeof sub.paused !== 'boolean') sub.paused = false;`) so existing subs
migrate in-memory on read and persist on the next write — no standalone
migration. `maxVideos` stays `undefined` when unset (→ global at build time).

**Endpoint** `PATCH /api/subscriptions/:id` (inside the gate), body any subset
of `{ format, quality, maxVideos, paused }`:

- `format` → `VALID_FORMATS` else `400`; `quality` → neutralized via
  `normalizeQuality` (soft-default, AC 16 posture); `maxVideos` → integer
  bound else `400`; `paused` → boolean else `400`.
- New `store.updateSubscription(deps, id, patch)` (via `updateDatabase`):
  mutates ONLY the provided fields, preserving `id`/`channelUrl`/`name`/
  `addedAt`/`lastCheckedAt`/`lastStatus`/archive (AC 21). Returns the updated
  record, or `null` → `404` (AC 24).

**Pause semantics.** `runPoll` filters `targets = targets.filter(s =>
!s.paused)` **only for the all-subscriptions case** (scheduled poll +
re-pull-all — AC 22/23). A specific `subId` re-pull (a deliberate per-row user
action) runs even if paused — pause governs the *automatic* loop, not an
explicit override. **Decision, stated: manual re-pull of a paused sub is
allowed; no 409.** (Consistent with AC 22, which only requires the scheduled
poll and re-pull-all to skip.)

### FR-B — Format + quality dropdowns (UI)

`subscriptions.html`: replace the free-text `#sub-add-quality` input with a
`<select>`; add a `maxVideos` numeric input. `subscriptions.js`: send
`quality`/`maxVideos` from the selects. Exact option values the SDE hardcodes:

- format `<select>`: `video` (default), `audio`.
- quality `<select>`: `best` (default), `2160p`, `1440p`, `1080p`, `720p`,
  `480p`, `360p` (the `args.QUALITY_ALLOWLIST`).

Same two selects on the new one-shot form. Server validation already exists
(`VALID_FORMATS` / `normalizeQuality`) and re-asserts for both endpoints.

### FR-F — Clean display titles (core, always-on, display-only)

New pure helper in `server.js` (exported like `getMediaId`/`needsTranscode`
for unit test), applied at line 998:

```js
function cleanDisplayTitle(baseName) {
  const m = /^(.*?)[ _]\[[A-Za-z0-9_-]{11}\]$/.exec(baseName);
  if (!m) return baseName;                 // not a yt-dlp name -> untouched
  return m[1].replace(/_/g, ' ').trim();
}
// title: cleanDisplayTitle(path.basename(info.name, info.ext))
```

Only transforms when a trailing bracketed **exactly-11-char** `[A-Za-z0-9_-]`
id is present (yt-dlp's `--restrict-filenames` shape, matching a leading space
OR underscore before `[`). `My_Home_Movie` (no bracket) and
`Something [notanid]` (7-char token) are returned unchanged (AC 34/35).
`getMediaId` hashes the path → no id churn/migration (AC 36).
`--restrict-filenames` stays in the download args (AC 37).

### FR-G — Duplicate fix + display-only synthetic folder

**Part 1 — hardening.** New `server.js` helper
`normalizeScanRoot(p)` = `fs.realpathSync(p)` with a `path.resolve(p)`
**fallback on any error** (a missing/unmounted root must keep a string so it
still lands in `missingRoots` and the E1 mount-loss guard fires — never drop
it). Apply per-root before the `Set` dedup at line 955:

```js
const merged = [...(db.folders || []), ...ytdlp.extraScanRoots(ytdlpConfig)]
  .map(normalizeScanRoot);
const currentFolders = Array.from(new Set(merged));
```

Divergent spellings of the same real tree → one realpath → one root → one set
of path-based ids (AC 38/41). Distinct trees keep distinct realpaths
(AC 39). At `POST /api/config` write (line 1262), push `path.resolve(trimmed)`
instead of `trimmed` (AC 40); `folderSettings` keys follow the resolved paths.

**Part 2 — display-only synthetic folder.** `GET /api/config` derives (never
persists) the download root:

```js
const cfg = ytdlp.parseYtdlpConfig();
const synthRoots = ytdlp.extraScanRoots(cfg);   // [] when disabled & dir absent
const folders = [...(db.folders || [])];
const settings = { ...(db.folderSettings || {}) };
for (const root of synthRoots) {
  if (!folders.some(f => path.resolve(f) === root)) folders.push(root);
  if (!settings[root] || !settings[root].name) {
    settings[root] = { ...(settings[root] || {}), name: (settings[root] && settings[root].name) || 'Downloads' };
  }
}
res.json({ folders, folderSettings: settings });
```

The synthetic root is present in the *response* `folders` array (so the
sidebar/playlists render it, AC 42/43) but NEVER in `db.folders`. Disabled →
`synthRoots` is `[]` → absent (AC 4/46).

**Rename persistence.** `POST /api/config` allows a `folderSettings` entry
keyed by the synthetic download root even though it is not in `db.folders`:
compute `syntheticRoots = ytdlp.extraScanRoots(cfg)` and treat them as extra
allowed settings keys (name/hidden) while `db.folders = validFolders` stays
synthetic-free (AC 44). Self-heals (AC 45): `folders` are re-derived from
`extraScanRoots` on every GET, and `migrateStaleDownloadDirFromFolders`
(unchanged) still strips any real persisted `db.folders` copy — one synthetic
source of truth.

**Invariant preservation (AC 47).** The scan/prune path (line 955) reads
`extraScanRoots` directly, never the synthetic GET/config presence — no
scan/prune decision depends on it. The E1 OR-gate is untouched.

### FR-H — Embed metadata + thumbnails (args)

In `buildYtdlpDownloadArgs`, add `--embed-metadata` and `--embed-thumbnail`
(each its own argv element) for BOTH the audio and video branches (AC 48-50).
ffmpeg (present in the image) handles the postprocessing — mp3 audio via the
audio postprocessor, mp4/mkv/webm video via the container muxer. Caveat noted
for build-verification (AC 51): thumbnail embedding depends on the container;
`--embed-thumbnail` is best-effort in yt-dlp (a container that cannot carry a
thumbnail is a warning, not a failure) so it never wedges a download.
Arg-array/`--` discipline unchanged.

### FR-I — Deleted-stays-gone (no code)

Assertion test + a README/`ARCHITECTURE.md` note on the archive-persistence
dependency for network-share download dirs (AC 52/53). No production change.

### Alternatives considered

- **WebSocket/SSE for FR-E** — rejected (Dean-locked to polling; adds a
  transport with no offsetting benefit at this scale).
- **Augment `GET /api/subscriptions` with a `live` block instead of a
  dedicated status endpoint** — viable, but one-shots have no sub row and the
  list endpoint would then change shape on every poll; a dedicated
  `GET /api/subscriptions/status` keeps concerns separate and the list stable.
- **`--match-filter`/`--playlist-items` for FR-C** — unnecessary; the list
  pass already uses `--playlist-end`, and threading the per-sub override into
  it is a one-line precedence change with a single source of truth.
- **Per-id one-shot spawns vs. reusing `run.runDownload` with a single
  targetId** — reuse wins (identical security core, dedup, confinement); a
  one-shot is just a subscription cycle with a hardcoded one-element survivor
  set and no persisted record.
- **Materializing the synthetic folder into `db.folders` once** — rejected
  (that is exactly the C3/C7/D2 eviction/disable-reap surface v1.11.0 removed);
  display-only derivation keeps `extraScanRoots` the sole authority.

### Risks and mitigations

- **Risk**: progress lines arrive on a stream/format the parser doesn't match
  (yt-dlp version drift) → **Mitigation**: parser returns `null` (no-op);
  state still advances through `listing`/`downloading`/`done` via the
  orchestrator, so the UI degrades to coarse state without percent, never
  breaks. Parser is fixture-tested (AC 27).
- **Risk**: piping download stdout reintroduces an unbounded buffer →
  **Mitigation**: stdout is parsed-and-discarded with a capped partial-line
  carry; no `maxBuffer`, no accumulation (SF3 preserved).
- **Risk**: FR-G realpath collapses two genuinely distinct trees →
  **Mitigation**: realpath only collapses same-inode spellings; distinct trees
  yield distinct realpaths (regression AC 39).
- **Risk**: FR-F regex rewrites a legitimately-`[bracketed]` non-yt-dlp file →
  **Mitigation**: requires an exactly-11-char id-charset token; regression
  ACs 34/35. Documented rare collision (an 11-char bracket token).
- **Risk**: one-shot queue growth under rapid submissions →
  **Mitigation**: each is bounded single-video work serialized by
  `runExclusive`; acceptable, MeTube-simple (no queue viz in scope).

### Performance impact

No expected impact on RELIABILITY.md budgets. FR-G adds one `realpathSync`
per *root* (not per file) per scan — negligible. FR-F is one regex per new/
updated file at scan time. FR-E's parser runs per progress line during a
download that is already I/O-bound; the activity map is O(subs). No new
heavyweight deps; single-worker/serialized posture preserved.

### Files touched (summary)

- **New**: `lib/ytdlp/progress.js`, `lib/ytdlp/activity.js`.
- **`lib/ytdlp/index.js`**: `runExclusive`, `runOneShot`, activity wiring in
  `runPoll`/`runSubscriptionCycle`/`processSubscription`, new routes
  (`GET /api/subscriptions/status`, `PATCH /api/subscriptions/:id`,
  `POST /api/ytdlp/download`), `clearSubscription` on delete.
- **`lib/ytdlp/args.js`**: effective per-sub `maxVideos` in
  `buildYtdlpListArgs`; `--newline` + `--embed-metadata` + `--embed-thumbnail`
  in `buildYtdlpDownloadArgs`.
- **`lib/ytdlp/run.js`**: `onProgress` opt threaded into
  `spawnYtdlpDownload`; download stdout piped + line-split; SF7 stdout guard.
- **`lib/ytdlp/url.js`**: `classifySingleVideo`.
- **`lib/ytdlp/store.js`**: `updateSubscription`, `maxVideos`/`paused`
  validation + backfill in `validateSubscriptionInput`/`ensureYtdlp`.
- **`lib/ytdlp/views/subscriptions.html`** + **`client/subscriptions.js`**:
  dropdowns, maxVideos input, pause toggle, edit form, one-shot form, status
  polling, one-shot rows.
- **`server.js`**: `cleanDisplayTitle` (+ line 998), `normalizeScanRoot`
  (+ line 955), `path.resolve` on `POST /api/config` write, synthetic-folder
  merge in `GET /api/config` + synthetic settings key in `POST /api/config`.
- **Docs**: `README`/`ARCHITECTURE.md` archive-persistence note (FR-I).

### Regression tests to write (by workstream)

- **F**: `cleanDisplayTitle` — yt-dlp name cleaned (AC 33), `My_Home_Movie`
  untouched (34), `Something [notanid]` untouched (35), `getMediaId`
  identical before/after (36).
- **G**: realpath collapse of symlink/relative alias → one root (38); two
  distinct trees NOT collapsed (39); `db.folders` resolved on write (40);
  e2e one-entry (41); `GET /api/config` synthetic entry not in `db.folders`
  (42); rename persists via `folderSettings` only (44); self-heal (45);
  disabled → no synthetic (46); prune path independent of synthetic (47).
- **E**: `parseProgressLine` fixtures — percent/item/destination lines (27);
  status endpoint reflects in-flight state distinct from `lastStatus` (28);
  terminal states surfaced (30); error entry has no cookies path (31);
  disabled → 404 (32).
- **A**: single-video accepted → 202, not awaited (8); channel/playlist → 400
  no spawn (9); malformed → 400 (10); lands in `One-Off`, indexed (11);
  serialize-with-poll spy (12); URL validator reuse (54); folder confinement
  (55); arg-array + `--` with shell metachar URL (56); cookies redaction on
  new sinks (57); timeout+SIGKILL (58).
- **C**: per-sub `--playlist-end` override (18); global fallback unregressed
  (19); bounds `400` (20).
- **D**: PATCH preserves untouched fields (21); paused skipped by scheduled +
  re-pull-all (22); unpause resumes (23); PATCH unknown id 404 (24);
  disabled → 404 (25).
- **H**: `--embed-metadata` audio (48) + video (49); `--embed-thumbnail` both
  (50).
- **I**: delete + prune-missing does not re-download (52).
- **Disabled no-op**: new routes 404 (1/2/3), `GET /api/config` no synthetic
  (4), suite green disabled (6), lint clean (7).

### Proposed SDE task breakdown (EM to formalize below)

Sequenced so each builds on the prior; the T3/T4-class items (Task 3
one-shot endpoint, Task 2 parser, Task 4 folder-merge) carry the two-reviewer
gate.

1. **Lib args/metadata/url/store primitives** (pure, no routes): per-sub
   `maxVideos` in `buildYtdlpListArgs`; `--embed-metadata`/`--embed-thumbnail`
   in `buildYtdlpDownloadArgs`; `url.classifySingleVideo`;
   `store.updateSubscription` + `maxVideos`/`paused` validation + backfill.
   Unit tests for C/H/D-validation. Enables everything downstream.
2. **FR-E progress + activity** (pure): `lib/ytdlp/progress.js`,
   `lib/ytdlp/activity.js`, `onProgress` threaded through `run.runDownload`/
   `spawnYtdlpDownload` (stdout pipe + line-split). Unit tests (parser
   fixtures, activity map). **Two-reviewer.**
3. **Server endpoints + orchestration** (`index.js`): `runExclusive`,
   `runOneShot`, activity wiring in the poll loop, the three new routes
   (`POST /api/ytdlp/download`, `PATCH /api/subscriptions/:id`,
   `GET /api/subscriptions/status`), `clearSubscription` on delete.
   Integration tests for A/D/E-exposure + serialization spy + disabled-no-op.
   **Two-reviewer (one-shot endpoint).**
4. **FR-F + FR-G core `server.js` changes**: `cleanDisplayTitle`,
   `normalizeScanRoot` + line-955 merge, `path.resolve` on `POST /api/config`,
   synthetic-folder merge in `GET`/`POST /api/config`. Unit + integration
   tests (F regressions, G collapse/distinct/synthetic/self-heal/mount-loss).
   **Two-reviewer (folder-merge + realpath).**
5. **UI** (`subscriptions.html` + `client/subscriptions.js`): format/quality
   dropdowns, maxVideos input, pause toggle + edit form, one-shot form, status
   polling (2.5s) + one-shot rows. Pure DOM-helper unit tests; manual ACs.
6. **FR-I assertion + docs**: regression test + README/ARCHITECTURE note.

## Task breakdown

Formalized by the engineering-manager from the PE's proposed 6-task split
(adopted verbatim — it already builds up in dependency order). Each task is
independently committable and ships its own tests. The coordinator owns git;
SDEs do not commit. Node 22 is the test/verify standard. Sequence T1 → T6.

- **T1 — Lib primitives (pure, no routes).** `args.js` per-sub `maxVideos`
  precedence in `buildYtdlpListArgs` (FR-C) + `--embed-metadata`/
  `--embed-thumbnail` for both audio & video in `buildYtdlpDownloadArgs`
  (FR-H); `url.classifySingleVideo` reusing `validateChannelUrl` (FR-A);
  `store.updateSubscription` + `maxVideos`/`paused` validation & `ensureYtdlp`
  backfill (FR-D). Unit tests for C/H/D-validation/classify. The foundation
  everything downstream builds on. No gate.
- **T2 — FR-E progress + activity (TWO-REVIEWER GATE).** New
  `lib/ytdlp/progress.js` (pure `parseProgressLine`) + `lib/ytdlp/activity.js`
  (ephemeral in-process map); thread `onProgress` through `run.runDownload`/
  `spawnYtdlpDownload` (download-path `--newline` + stdout/stderr line-split,
  no accumulation) preserving SF1/SF3/SF7. Unit tests (parser fixtures,
  activity map, error-entry-has-no-cookies-path).
- **T3 — Server endpoints + orchestration (`index.js`) (TWO-REVIEWER GATE).**
  `runExclusive` FIFO spawn-serialization gate, `runOneShot`,
  `POST /api/ytdlp/download` (FR-A), `PATCH /api/subscriptions/:id` (FR-D),
  `GET /api/subscriptions/status` (FR-E exposure), activity wiring in the poll
  loop, `clearSubscription` on delete. Integration tests for A/D/E-exposure +
  serialization spy + disabled-no-op. Gated on the one-shot user-URL spawn
  (T3/T4-class security).
- **T4 — FR-F + FR-G core `server.js` (TWO-REVIEWER GATE).**
  `cleanDisplayTitle` at line 998; `normalizeScanRoot` + the line-955 merge;
  `path.resolve` on `POST /api/config` write; display-only synthetic folder in
  `GET`/`POST /api/config`. Unit + integration tests (F regressions incl.
  non-yt-dlp untouched; G collapse/distinct/synthetic/self-heal/mount-loss).
  Gated because it touches core always-on code (folder-merge + realpath).
- **T5 — UI.** `subscriptions.html` + `client/subscriptions.js`:
  format/quality dropdowns (FR-B), `maxVideos` input, pause toggle + edit form
  (FR-D), one-shot form (FR-A), status polling (2.5s) + one-shot rows (FR-E).
  Every server/user-derived string via `textContent`, never `innerHTML`
  (XSS). QA-agent review after build-verify (not the full two-reviewer gate).
- **T6 — FR-I assertion + docs.** Regression test that delete + prune-missing
  does not re-download an archived video (AC 52) + a README/`ARCHITECTURE.md`
  archive-persistence note for network-share download dirs (AC 53). No
  production code change; no gate.

## Progress log

- 2026-07-06 — Discovery stage complete (product-manager). Nine workstreams
  (A-I) turned into 60 tagged, testable acceptance criteria grouped by
  workstream plus cross-cutting security/Node-22/disabled-no-op sections.
  F/G/I bug mechanics written as concrete pass/fail criteria per the
  EM-confirmed file:line evidence (server.js:511, :955, :998) — no
  re-investigation performed. No new product forks surfaced; all locks from
  `.state/feature-state.json` carried through unchanged. Routing to
  principal-engineer for Design.

## Decision log

- 2026-07-06 — Confirmed (carried from Dean's locks, not re-opened here):
  ONE cohesive feature; polling-only status transport; format+quality
  dropdowns on both forms; per-channel max-videos override; display-only
  synthetic folder registration (intentional C7(ii) softening); embed
  metadata+thumbnail for both audio and video; single-video-only one-shot
  download, `"One-Off"` default subfolder, `202`+background+serialized with
  the poll loop.
- 2026-07-06 — Confirmed (EM-verified against current code, not
  re-investigated): F's title source is `path.basename(info.name, info.ext)`
  at `server.js:998`; G's duplicate-entry root cause is the byte-identical
  `Set` dedup at `server.js:955` combined with unresolved `db.folders`
  writes at `server.js:~1258-1264`, against `md5(absolute path)` media ids at
  `server.js:511`; I's delete-stays-gone guarantee (D3) is already shipped
  and requires no code change.
