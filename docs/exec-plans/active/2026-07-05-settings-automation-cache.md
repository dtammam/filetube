# Settings: Automation & Cache Housekeeping

## Goal

Give the FileTube operator visibility and control over two things the server
already does silently and dangerously: how often the library re-scans, and how
the transcode cache grows. Today the scan interval is hardcoded and its prune
step can silently wipe the whole library if a mount disappears; the transcode
cache has a size cap but no age-based housekeeping and no UI. This feature adds
a new "Automation & Storage" area in Settings so the user can see and adjust
scan cadence, cache size/age, and trigger scan/clear actions on demand — safely.

## Scope

Six items, in `public/setup.html` (new "Automation & Storage" `setup-box`,
alongside the existing "Appearance" box at lines 115-124) plus the
server-side machinery in `server.js`. D1-D4 (locked, see Decision log) are
baked into the items below verbatim.

1. **Auto-scan interval (D1).** UI select: Off / 30m / 1h / 6h / 12h / 24h,
   default **30m**. Replaces the hardcoded `setInterval(() => scanDirectories(),
   10 * 60 * 1000)` at `server.js:989` — the interval is driven by a persisted
   preference read at startup (and re-armed if changed live). "Off" means no
   periodic scan (manual "Scan now" only) — startup scan-on-boot
   (`server.js:988`) is unaffected either way. Add an overlap guard: never
   start a new automatic OR manual scan while `scanState.scanning` (declared
   `server.js:421-422`) is already true.

2. **Transcode cache age-retention (D3).** UI select: Off / 7 / 14 / 30 / 90
   days, default **30**. A transcoded MP4 in `data/transcoded/` not "last
   watched" within the window is eligible for deletion. Keyed primarily off a
   **last-served timestamp we control**, recorded in `db.json` whenever a
   transcode is served or produced (extending the existing `markServed`
   in-memory tracking at `server.js:133-140` with a persisted counterpart, and
   reusing the `RECENT_STREAM_MS` protection concept). Falls back to
   filesystem atime only when no recorded timestamp exists (e.g. pre-upgrade
   files). This age sweep is an additional filter layered ON TOP of — never a
   replacement for — the existing size-cap LRU backstop
   (`selectEvictions`/`parseCacheCap`/`evictTranscodeCache`, `server.js:86-172`,
   default 5 GB `FILETUBE_CACHE_CAP`/`TRANSCODE_CACHE_MAX_BYTES`), which keeps
   running regardless of the age setting.

3. **Cache size display + "Clear cache now" (D4).** Settings shows the current
   total size of `data/transcoded/` (human-readable, e.g. "1.2 GB"). A "Clear
   cache now" button deletes all cached transcoded MP4s on demand (subject to
   the same in-flight/recently-served protections eviction already respects —
   see Open Questions for exact `.tmp.mp4` handling).

4. **Expose the transcode size cap in the UI (D4).** The existing env-only
   `FILETUBE_CACHE_CAP` / `TRANSCODE_CACHE_MAX_BYTES` becomes a settable
   control in Settings, persisted in `db.json`. The env var remains a valid
   override/default source (i.e. if no UI value is persisted, the env var —
   or its own 5 GB default — still applies; back-compat for deployments that
   only set the env var).

5. **Last-scanned timestamp + "Scan now" (D4).** Settings shows "Last scanned:
   N ago" sourced from the existing `/api/scan-status` (`server.js:652-665`,
   already returns `lastScan`). A "Scan now" button POSTs to the existing
   `/api/scan` (`server.js:642-649`), reusing the existing scan-status
   polling JS in `setup.html` (~lines 292-311).

6. **"Remove entries for deleted files during scan" (D2).** Toggle, default
   **ON**, persisted in `db.json`. When ON: `runScanDirectories`
   (`server.js:436-540`) continues to prune a `db.metadata` entry whose file
   is gone, exactly as today — but ONLY for entries whose configured root
   folder is confirmed present/mounted. When OFF: no pruning; entries for
   missing files are retained (stale but not silently lost) until the user
   re-enables pruning or removes the folder from config.
   **Mandatory mount-loss guard, ships unconditionally regardless of the
   toggle's value:** if a configured root folder is entirely
   missing/unmounted at scan time (the `!fs.existsSync(folder)` check at
   `server.js:442`, which today just `continue`s), the scan must treat this as
   a **mount failure**, not a deletion — no entry rooted under that folder may
   be pruned in that scan pass, even if pruning is otherwise ON. An entry is
   only ever pruned when its root folder IS present but that specific file
   is individually gone.

Persistence: per D1's framing (server automation, not a per-browser
preference), all six settings live server-side in a new top-level
`settings` object in `db.json` — not client `localStorage` (unlike the
existing theme/icon prefs). Exact key shape is an open question for design
(see below), with a proposed default.

## Out of scope

- The full MeTube/yt-dlp delete-sync work described in
  `docs/exec-plans/future/metube-yt-dlp-sync.md` (Options A/B) — stays
  deferred. Item #6 (safe, controllable prune) is the FileTube-side half of
  the staleness problem that plan describes; it does not touch MeTube,
  `completed.json`, or any external service. No conflict.
- Companion-file cleanup on delete/prune (`.info.json`, `.description`,
  subtitle sidecars — "Option C" in the deferred plan). Not requested in the
  approved six items; not pulled in. If wanted later, it's a small additive
  follow-up to the prune path, not blocked by anything here.
- Any `db.json` schema migration beyond the additive new `settings` object.
  No existing field is renamed, removed, or restructured. Older `db.json`
  files without `settings` must load with in-code defaults (mirrors the
  existing `folderSettings` backfill pattern at `server.js:45`).
- Per-folder scan-interval or per-folder retention overrides — these are
  global settings only.
- Any new authentication/multi-user concept — FileTube remains single-user/
  single-node per `docs/ARCHITECTURE.md`.
- Cross-check: none of the above conflicts with `docs/CONTRIBUTING.md` or
  `docs/RELIABILITY.md`. Notably, CONTRIBUTING.md requires "every new feature
  ships with tests" — nothing here is deferred out of scope on that basis;
  see Acceptance criteria for the required unit/integration coverage.

## Constraints

- Node.js 22 LTS (`engines` ≥20); CommonJS, no new runtime deps beyond what's
  already in `package.json`.
- Tests via `node:test` (`npm test` / `npm run test:unit`); new pure logic
  (interval parser, age-sweep selector, mount-loss guard logic) must be
  exported from `server.js`'s `module.exports` seam (`server.js:1002-1020`)
  and unit-tested the way `selectEvictions`/`parseCacheCap` are today, per
  `docs/CONTRIBUTING.md`'s testing layout (`test/unit/` for pure logic,
  `test/integration/` for HTTP routes).
- `npm run lint` must pass with zero errors/warnings.
- Keep FFmpeg out of the automated test suite (per `docs/RELIABILITY.md`) —
  none of these six items require FFmpeg to test; scan/prune/eviction/age-sweep
  logic is all filesystem + JSON, independently testable.
- Additive / zero-regression for every behavior EXCEPT the two intentional,
  explicitly-documented changes below (D1, D2). Existing scan, size-cap
  eviction, and streaming paths must continue to work unchanged when the new
  settings are left at their defaults (for streaming/eviction) or are the
  *documented* new defaults (for scan interval and prune toggle).
  "Off" and "on-with-guard" must both be reachable states, but neither the
  size-cap eviction path nor the `/video/:id` streaming path may change
  behavior for existing installs at all.
- Ships to prod Docker (`deantammam/filetube`) on a `v*.*.*` tag as **v1.8.0**.
- Two-reviewer gate before merge: the `quality-assurance` agent AND a separate
  `/code-review` pass, both required (not either/or).

## Open questions / decisions for design

D1-D4 are settled and must not be re-litigated. The following are genuinely
open implementation-shape questions for the principal-engineer; each has a
proposed default so design can proceed without blocking:

1. **Exact `db.json` `settings` object shape and back-compat defaulting.**
   *Proposed default:* a top-level object mirroring the `folderSettings`
   backfill pattern, e.g.
   `settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 }`
   (`cacheMaxBytes: null` meaning "no UI override, defer to env var/5GB
   default" per item #4). `loadDatabase()` backfills `db.settings` with these
   defaults exactly like it backfills `db.folderSettings` today, so old
   `db.json` files load with zero migration step.

2. **D3 last-served-timestamp mechanism: where it's recorded and how it
   interacts with "Clear cache now" and startup.** *Proposed default:* persist
   `lastServedAt` per transcoded-file id in `db.metadata[id]` (already the
   home of per-item state), updated at the same call site as the existing
   in-memory `markServed()` (`server.js:936`) and also when a transcode is
   first produced. "Clear cache now" simply deletes the cache files; it does
   not need to touch these timestamps (a re-transcode on next watch re-records
   them). The age sweep runs as a read of `db.metadata[id].lastServedAt`
   (fallback to file atime if absent) at eviction time — same call site as
   `evictTranscodeCache`.

3. **Does the age sweep run on the scan timer, its own timer, or on cache
   write?** *Proposed default:* piggyback on the existing
   `evictTranscodeCache` call sites (startup + post-produce,
   `server.js:983,296`) — run the age filter immediately before the size-cap
   filter, on the same cadence, rather than introducing a third timer.

4. **Does "Clear cache now" also delete in-flight `*.tmp.mp4` files?**
   *Proposed default:* no — mirror `selectEvictions`'s existing rule of never
   touching `.tmp.mp4` (an in-progress transcode), so a user-triggered clear
   can't corrupt a transcode that's actively being written. Orphaned tmp files
   are already handled separately by `cleanupOrphanTmp` on startup.

5. **How does "Scan now" / the overlap guard surface a "scan already running"
   response in the UI?** *Proposed default:* `/api/scan` returns its existing
   `200 {success:true}` if it started a scan, and a `409 {error: 'scan already
   in progress'}` if `scanState.scanning` was already true when called; the
   setup.html handler shows the existing scan-status polling UI either way
   (join the in-progress scan's progress rather than erroring the user).

6. **UI placement/grouping within the new "Automation & Storage" box.**
   *Proposed default:* one `setup-box` with two labeled subsections — "Scan"
   (interval select, last-scanned line, "Scan now") and "Transcode cache"
   (age-retention select, size-cap input, size display, "Clear cache now") —
   mirroring the two-`h2`/`h3` pattern already used in the "Appearance" box
   (`public/setup.html:115-124`).

## Acceptance criteria

Legend: **[UNIT]** — mechanically testable via `node:test` on an exported pure
helper. **[INTEGRATION]** — mechanically testable via `node:test` against a
running HTTP route or a real filesystem fixture (`test/integration/`).
**[MANUAL]** — requires visual/manual verification of `setup.html` rendering
(no build tooling/DOM test runner in this repo).

**Final coverage accounting (added T8, 2026-07-05):** all 6 acceptance-criteria
groups plus the zero-regression group are covered by shipped `node:test` cases,
cited inline below. Every `[UNIT]`/`[INTEGRATION]` item has a passing test as
of the T8 full-suite run (168/168, see Progress log); every `[MANUAL]` item
remains deferred to Dean's on-device pass plus the two-reviewer QA gate
(`quality-assurance` agent + a separate `/code-review` pass), as scoped from
the start — no manual item was silently dropped.

### 1. Auto-scan interval (D1)

**Coverage:** `test/unit/settings-helpers.test.js` (`scanIntervalMs`, 3 cases)
and `test/integration/scan-api.test.js` (409/overlap-guard/armScanTimer/scan-status
shape, 6 cases). All `[UNIT]`/`[INTEGRATION]` items below verified passing.

- [x] **[UNIT]** A pure helper (e.g. `scanIntervalMs(pref)`) maps `Off → null`,
      `30m → 1800000`, `1h → 3600000`, `6h → 21600000`, `12h → 43200000`,
      `24h → 86400000`, and any unrecognized/missing value → the 30m default.
      Exported via `module.exports` and unit-tested with one case per value.
      *(`test/unit/settings-helpers.test.js:27` covers all six mapped values in
      one table-driven case; `:23` and `:35` cover Off and the fallback default.)*
- [x] **[INTEGRATION]** With `db.settings.scanIntervalMinutes` absent (fresh/old
      `db.json`), the effective interval is 30 minutes, NOT 10 minutes —
      asserting the intentional default change (see "Behavior changes" below).
      *(`test/integration/scan-api.test.js:77` — "armScanTimer arms a 30-minute
      interval by default (old/fresh db.json with no settings)".)*
- [x] **[INTEGRATION]** Overlap guard: given `scanState.scanning === true`, a call to
      the scan entry point (automatic-timer path and `/api/scan` POST path)
      does not start a second concurrent scan. Test by stubbing/mocking a
      long-running scan and asserting a second trigger is a no-op (or queued/
      rejected — per design) rather than re-entering `runScanDirectories`.
      *(`test/integration/scan-api.test.js:47` — 409-while-scanning; `:61` —
      timer-path no-op while scanning.)*
- [x] **[INTEGRATION]** `/api/scan-status` (`server.js:652-665`) response shape is
      unchanged (`scanning`, `lastScan`, `fileCount`, `folderCount`,
      `transcoding`) — existing integration tests for this endpoint still pass
      unmodified. *(`test/integration/scan-api.test.js:102`; reconfirmed
      unaffected again in `test/integration/settings-cache-api.test.js:291`.)*
- [ ] **[MANUAL]** Settings UI shows the six-option select (Off/30m/1h/6h/12h/
      24h), defaults to 30m on a fresh install, persists across page reload,
      and changing it takes effect without a server restart. *(Deferred to
      Dean's on-device pass + the two-reviewer QA gate.)*

### 2. Transcode cache age-retention (D3)

**Coverage:** `test/unit/settings-helpers.test.js` (`selectAgedOut`, 5 cases)
and `test/integration/age-sweep.test.js` (live sweep against a real fixture,
7 cases). All `[UNIT]`/`[INTEGRATION]` items below verified passing.

- [x] **[UNIT]** A pure age-sweep selector (e.g. `selectAgedOut(files, maxAgeMs,
      now)` or equivalent, mirroring `selectEvictions`'s signature style) is
      exported and unit-tested: given a set of `{path, lastServedAt|atimeMs}`
      entries and a cutoff, it returns exactly the paths whose most-recent
      known-served time is older than the cutoff; never returns `.tmp.mp4`
      paths (mirrors `selectEvictions`'s existing exclusion).
      *(`test/unit/settings-helpers.test.js:64` — never returns `.tmp.mp4`.)*
- [x] **[UNIT]/[INTEGRATION]** A file with a recorded `lastServedAt` newer than
      the cutoff is NEVER selected for age-based deletion, even if its
      filesystem atime is old/stale (proves the last-served-timestamp
      mechanism, not raw atime, is authoritative) — direct regression test for
      the D3 risk Dean flagged. *(`test/unit/settings-helpers.test.js:45` —
      pure selector; `test/integration/age-sweep.test.js:84` — same invariant
      through the LIVE sweep, the headline D3 test.)*
- [x] **[UNIT]/[INTEGRATION]** A file with NO recorded `lastServedAt` falls back to
      filesystem atime for the age comparison (fallback path exercised).
      *(`test/unit/settings-helpers.test.js:56`; `test/integration/age-sweep.test.js:104`.)*
- [x] **[INTEGRATION]** Setting the retention to "Off" disables the age sweep
      entirely — the size-cap LRU eviction (`selectEvictions`/
      `evictTranscodeCache`) still runs unchanged and unaffected.
      *(`test/integration/age-sweep.test.js:124`.)*
- [x] **[UNIT]/[INTEGRATION]** The age sweep and the size-cap sweep compose correctly: a file
      protected by `recentlyServed`/`RECENT_STREAM_MS` (`server.js:133-140`)
      is never deleted by either sweep. *(`test/unit/settings-helpers.test.js:71`
      — pure `protectedPaths` exclusion; `test/integration/age-sweep.test.js:148`
      — composes with `recentlyServed` through the live sweep.)*
- [ ] **[MANUAL]** Settings UI shows the five-option select (Off/7/14/30/90),
      defaults to 30 days, persists across reload. *(Deferred to Dean's
      on-device pass + the two-reviewer QA gate.)*

### 3. Cache size display + "Clear cache now" (D4)

**Coverage:** `test/unit/settings-helpers.test.js` (`transcodeCacheSize`,
2 cases) and `test/integration/settings-cache-api.test.js` (`/api/cache/size`,
`/api/cache/clear`, 4 cases).

- [x] **[UNIT]** A pure/exported helper computes total bytes across all
      non-`.tmp.mp4` files in `TRANSCODE_DIR` (reusable in both the API
      response and internally) — unit-tested against a temp dir fixture with
      known file sizes. *(`test/unit/settings-helpers.test.js:155`.)*
- [x] **[INTEGRATION]** A "clear cache" server action (new endpoint or extension of
      an existing one) deletes all eligible cached MP4s and returns success;
      integration test asserts `data/transcoded/` is empty of `.mp4` files
      (non-`.tmp.mp4`, per Open Question 4's proposed default) afterward, and
      that in-flight `.tmp.mp4` files are left untouched.
      *(`test/integration/settings-cache-api.test.js:230` and `:246`
      — the latter also confirms a `recentlyServed`-protected file and
      `lastServedAt` are left untouched.)*
- [ ] **[MANUAL]** Settings UI shows a human-readable current cache size
      (e.g. "1.2 GB") that updates after "Clear cache now" is clicked, and the
      button is disabled/shows feedback while the clear is in flight.
      *(Deferred to Dean's on-device pass + the two-reviewer QA gate.)*

### 4. Transcode size cap surfaced in UI (D4)

**Coverage:** `test/unit/transcode-cache.test.js` (frozen, unmodified),
`test/unit/settings-helpers.test.js` (`effectiveCacheCap`, 2 cases),
`test/integration/settings-cache-api.test.js` (env-vs-UI precedence via the
route), and `test/unit/gb-bytes.test.js` (the UI's GB↔bytes conversion, 7 cases).

- [x] **[UNIT]** `parseCacheCap` (`server.js:106-111`) behavior is unchanged:
      unset/empty/non-integer/`<=0` still falls back to the 5 GB default —
      existing unit tests in `test/unit/transcode-cache.test.js` continue to
      pass unmodified.
- [x] **[UNIT]/[INTEGRATION]** When a UI-set cap is persisted in `db.settings`, it is used as
      the effective cap in preference to the env var; when no UI value is
      persisted (`null`/absent), the env var (or its own 5 GB default) is
      still honored unchanged — proves item #4's "env var remains a valid
      override/default source" requirement. *(`test/unit/settings-helpers.test.js:170`
      and `:174`; `test/integration/settings-cache-api.test.js:90` — UI cap
      surfaced as `effectiveCacheMaxBytes`; `:200` — `cacheMaxBytes: null` defers
      to env/5GB.)* Confirmed the code reads exactly one env var,
      `TRANSCODE_CACHE_MAX_BYTES` (`server.js:112`) — see the README note below.
- [ ] **[MANUAL]** Settings UI shows an editable cap control (e.g. size input
      with unit picker or a byte/GB field), pre-populated from the effective
      cap (UI override if set, else env var, else 5 GB default), and saving it
      changes future eviction behavior without a restart. *(Deferred to Dean's
      on-device pass + the two-reviewer QA gate; the GB↔bytes conversion itself
      is unit-tested in `test/unit/gb-bytes.test.js`.)*

### 5. Last-scanned timestamp + "Scan now" (D4)

**Coverage:** `test/integration/scan-api.test.js` and
`test/integration/settings-cache-api.test.js` (existing-route zero-regression
recheck).

- [x] **[INTEGRATION]** `/api/scan-status`'s `lastScan` field is populated after a
      scan completes and remains the existing ISO timestamp format
      (`scanState.lastScan`, `server.js:431`) — no format change.
      *(`test/integration/scan-api.test.js:102`.)*
- [x] **[INTEGRATION]** `/api/scan` (`server.js:642-649`) POST still triggers a scan
      and returns `{success: true}` on the happy path — existing integration
      test coverage continues to pass unmodified. *(`test/integration/scan-api.test.js:40`.)*
- [ ] **[MANUAL]** Settings UI shows "Last scanned: N ago" computed from
      `lastScan`, and a "Scan now" button that triggers `/api/scan` and shows
      live progress via the existing scan-status polling. *(Deferred to Dean's
      on-device pass + the two-reviewer QA gate.)*

### 6. Remove entries for deleted files during scan (D2)

**Coverage:** `test/unit/settings-helpers.test.js` (`selectPrunableIds`,
5 cases, pure) and `test/integration/scan-prune.test.js` (the live
`runScanDirectories` fixture harness, 5 cases) plus
`test/unit/database.test.js` for the default-toggle-value check.

- [x] **[UNIT]/[INTEGRATION] Mount-loss guard (hard AC, the critical regression test):**
      simulate a configured root folder that is missing/unmounted at scan
      time (`fs.existsSync(folder) === false`, mirroring `server.js:442`).
      Assert that `db.metadata` entries whose `rootFolder` is that missing
      folder are NOT removed by the scan, regardless of whether the prune
      toggle is ON — i.e. this guard applies unconditionally. This directly
      tests the "mount failure != deletion" invariant from Finding B/D2.
      *(`test/unit/settings-helpers.test.js:94` — pure guard-before-toggle
      ordering; `test/integration/scan-prune.test.js:52` and `:79` — the
      CATASTROPHE GUARD proven live with `pruneMissing` both `true` and
      `false`.)*
- [x] **[INTEGRATION]** With the prune toggle ON and a root folder that IS present:
      an entry whose specific file no longer exists on disk under that
      present root IS pruned (including its thumbnail, transcode sidecar, and
      watch-progress cleanup) — same behavior as today's unconditional prune,
      now scoped correctly. *(`test/integration/scan-prune.test.js:105`.)*
- [x] **[INTEGRATION]** With the prune toggle OFF: an entry whose file no longer
      exists under a present root is NOT pruned (survives the scan,
      `db.metadata` keeps the stale entry) — proves the toggle actually gates
      pruning for the "file individually deleted" case (the mount-loss guard
      from the previous AC is orthogonal and applies either way).
      *(`test/integration/scan-prune.test.js:136`.)*
- [x] **[UNIT]** Default value of the prune toggle on a fresh/old `db.json`
      (no `settings.pruneMissing` key) is `true` (ON) — asserts the documented
      default. *(`test/unit/database.test.js:90`.)*
- [ ] **[MANUAL]** Settings UI shows the toggle, default checked/ON, persists
      across reload. *(Deferred to Dean's on-device pass + the two-reviewer
      QA gate.)*

### Zero-regression checks (existing behavior, unchanged)

- [x] **[UNIT]** Existing `test/unit/transcode-cache.test.js` suite
      (`parseCacheCap`, `selectEvictions`, `cleanupOrphanTmp`,
      `evictTranscodeCache`) passes unmodified — size-cap eviction logic and
      its exported signatures are untouched by the age-sweep addition.
      *(Confirmed byte-identical since T2 (build-specialist T2/T5 verifications);
      passes as part of the 168/168 T8 run.)*
- [x] **[UNIT]** Existing scan-path tests (`reconcileTranscode`,
      `matchRootFolder`, `loadDatabase`/`saveDatabase` round-trip/backfill/
      corrupt-JSON-recovery) pass unmodified. *(`test/unit/database.test.js:128`
      onward, unmodified since T1.)*
- [x] **[UNIT]/[INTEGRATION]** `/video/:id` streaming path (Range requests,
      live-transcode `?live=1`, lazy mobile transcode, `markServed` on serve)
      is functionally unchanged — existing integration coverage passes
      unmodified; the new persisted last-served timestamp is additive
      alongside, not a replacement for, the in-memory `recentlyServed` guard.
      *(`test/integration/api.test.js` unmodified; additive `recordServed`
      coverage in `test/integration/age-sweep.test.js:200` and `:233`.)*
- [x] **[UNIT]** A `db.json` from before this feature (no `settings` key)
      loads successfully with all six settings defaulted per the shape in
      Open Question 1, with no thrown error and no data loss to `folders`,
      `folderSettings`, `progress`, or `metadata`. *(`test/unit/database.test.js:74`
      and `:97`.)*
- [x] **[PROCESS]** `npm run lint` passes with zero errors on the full diff.
      `npm test` passes in full (all existing + new tests). Both the
      `quality-assurance` agent review AND a separate `/code-review` pass are
      completed and recorded before this feature is marked Done — a single
      "looks good" from either reviewer alone does not satisfy this gate.
      *(Lint/test confirmed clean at T8 — see Progress log; the two-reviewer
      gate itself runs AFTER T8, per plan — not yet performed as of this entry.)*

## Behavior changes vs current production (intentional, documented)

Only these two behavior changes are permitted; everything else in this
feature must be additive/zero-regression:

1. **Auto-scan default interval: 10 minutes → 30 minutes.** Today
   `server.js:989` unconditionally rescans every 10 minutes with no way to
   change it. After this feature, the default is 30 minutes (configurable
   Off/30m/1h/6h/12h/24h). Any deployment that never opens Settings gets the
   new 30m default, not the old 10m cadence — a deliberate, user-approved (D1)
   frequency reduction.
2. **Prune-missing: unconditional/unsafe → toggleable/safe by default.**
   Today `runScanDirectories` prunes any `db.metadata` entry not seen in the
   current scan, with NO check for whether its root folder was actually
   mounted — an unmounted volume silently wipes all its library entries
   (Finding B). After this feature, pruning stays ON by default (so a normal
   "I deleted a file" scan behaves the same as today) but gains the mandatory
   mount-loss guard (never prune under a missing root) and an off switch.
   Net effect for the common case (all mounts present, files individually
   deleted) is unchanged; the change is that the catastrophic missing-mount
   case can no longer happen, and the user can disable pruning entirely.

**Confirmed accurate (T8, 2026-07-05):** both changes above match the shipped
code exactly — `DEFAULT_SETTINGS.scanIntervalMinutes` is `30` (`server.js:34`,
was a hardcoded 10-minute `setInterval`) and `DEFAULT_SETTINGS.pruneMissing`
is `true` with the mount-loss guard (`selectPrunableIds`, `server.js`) firing
unconditionally before the toggle check. README.md and ROADMAP.md (updated
this task) document the resulting current-state defaults (30m scan interval,
guarded prune-on-by-default) for operators.

## Design

### Approach

Everything is additive to the existing `server.js` monolith and `public/setup.html`,
except the two intentional behavior changes (D1: 10min→30m default scan cadence;
D2: unconditional prune → mount-guarded, toggleable prune). The strategy is
**compose, don't rewrite**: the frozen size-cap eviction primitives
(`parseCacheCap`, `selectEvictions`, `evictTranscodeCache`) keep their exact
current signatures and behavior, and every new capability is a **new pure helper
exported through `module.exports`** plus a thin filesystem/HTTP wrapper. New pure
helpers: `scanIntervalMs` (interval mapping), `selectAgedOut` (age sweep selector),
`selectPrunableIds` (mount-loss + prune decision), `transcodeCacheSize` (cache
total), `effectiveCacheCap` (UI→env→5 GB cap resolution). All six settings live in
a new additive top-level `db.settings` object backfilled by `loadDatabase()`
exactly like `db.folderSettings`, so old `db.json` files load with zero migration.

The age sweep is scheduled by **piggybacking the two existing `evictTranscodeCache`
call sites** (startup `server.js:983`, post-produce `server.js:296`) — a new
`sweepAgedTranscodes()` runs immediately before `evictTranscodeCache()` at those
sites, so there is no third timer and `evictTranscodeCache` itself is never
touched (keeping `test/unit/transcode-cache.test.js` green unmodified). The
persisted last-served timestamp (`db.metadata[id].lastServedAt`) is written with a
no-clobber, write-only-when-stale guard mirroring `setTranscodeStatus`
(`server.js:207-214`) so the `/video/:id` streaming hot path stays cheap.

### Resolution of the six open questions

1. **`db.settings` shape + back-compat — ADOPTED.** New top-level object
   `settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 }`.
   `loadDatabase()` backfills it **per-key** via object spread (see Data model)
   so a partial `settings` object from a future/older write still gets missing
   keys defaulted. `cacheMaxBytes: null` = "no UI override, defer to env var / 5 GB
   default"; the effective cap is resolved by `effectiveCacheCap(db.settings)`.
2. **`lastServedAt` — ADOPTED.** Stored as epoch-ms number in `db.metadata[id]`,
   written by a new `recordServed(id)` at the `markServed` site (`server.js:935-936`)
   and at post-produce (`server.js:296`). "Clear cache now" does NOT touch it (a
   re-transcode re-records it). No-clobber pattern below.
3. **Age-sweep scheduling — ADOPTED.** No third timer; a new exported pure
   selector `selectAgedOut(files, maxAgeMs, now, protectedPaths)` is composed with
   the frozen `selectEvictions` at the two existing eviction call sites via the
   `sweepAgedTranscodes()` wrapper. See "Alternatives considered".
4. **Clear-cache vs `.tmp.mp4` — ADOPTED.** Clear deletes only non-`.tmp.mp4`
   files and skips anything currently in the `recentlyServed` window; in-flight
   `.tmp.mp4` writes are never touched (mirrors `selectEvictions` exclusion at
   `server.js:104,150`).
5. **"Scan already running" — ADOPTED.** `/api/scan` returns `200 {success:true}`
   when it starts, `409 {error:'scan already in progress'}` when `scanState.scanning`
   is already true; the setup.html handler joins the existing scan-status poll on
   both. The automatic-timer and `/api/config` background-scan paths get the same
   overlap guard via an internal early-return in `scanDirectories()`.
6. **UI placement — ADOPTED.** One "Automation & Storage" `setup-box` with two
   `h3` subsections ("Scan", "Transcode cache") mirroring the Appearance box
   (`public/setup.html:115-124`).

### Component changes

- **`server.js` — `loadDatabase()` / initial DB (`31-51`)**: add `settings` to the
  initial DB object and backfill it after the `folderSettings` backfill (Data model
  section has the exact snippet). No existing field renamed or removed.
- **`server.js` — new pure helpers (all exported for `node:test`)**:
  - `scanIntervalMs(minutes)` → `0`→`null` (Off), one of `{30,60,360,720,1440}`→
    `minutes*60000`, anything else (missing/unrecognized)→`30*60000`. (AC 1.1/1.2)
  - `selectAgedOut(files, maxAgeMs, now, protectedPaths)` — pure. `files` are
    `{path, lastServedAt?, atimeMs}`. Returns paths whose effective time
    (`lastServedAt` when it is a number, else `atimeMs`) is `< now - maxAgeMs`.
    Excludes `*.tmp.mp4` and any `protectedPaths`. Returns `[]` when `maxAgeMs`
    is falsy/`<=0` (retention "Off"). This is the D3 guarantee: a fresh
    `lastServedAt` wins over a stale `atimeMs`. (AC 2.1/2.2/2.3/2.4)
  - `selectPrunableIds(oldMetadata, survivingIds, missingRoots, pruneMissing)` —
    pure mount-loss + prune decision (see "High-risk element 1"). (AC 6.1/6.2/6.3)
  - `transcodeCacheSize(dir)` — sum of `st.size` for non-`.tmp.mp4` `*.mp4` files;
    `try/catch` around `readdirSync`/`statSync`, returns bytes. (AC 3.1)
  - `effectiveCacheCap(settings)` — returns `settings.cacheMaxBytes` when it is a
    positive integer, else the existing module constant `TRANSCODE_CACHE_MAX_BYTES`
    (env var or 5 GB). (AC 4.2)
- **`server.js` — timer refactor (`989-991`)**: replace the hardcoded
  `setInterval(..., 10*60*1000)` with `armScanTimer()`:

  ```js
  let scanTimer = null;
  function armScanTimer() {
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
    const db = loadDatabase();
    const ms = scanIntervalMs(db.settings.scanIntervalMinutes);
    if (ms) scanTimer = setInterval(() => scanDirectories().catch(console.error), ms).unref();
  }
  ```

  Called once inside the `require.main === module` startup block and again from
  `POST /api/settings` when the interval changes (live re-arm, no restart). The
  `.unref()` keeps an imported module from holding the event loop open in tests.
- **`server.js` — overlap guard (`scanDirectories`, `424-433`)**: add an early
  `if (scanState.scanning) return;` at the top so the timer path, the
  `/api/config` background scan, and any manual trigger are all no-ops while a
  scan runs. `scanState.scanning` is set synchronously before the first `await`,
  so a rapid second call reliably sees it.
- **`server.js` — mount-loss guard + prune (`runScanDirectories`, `436-540`)**:
  build a `missingRoots` set at the folder loop (`442`); replace the
  drop-everything cleanup block (`494-525`) with a `selectPrunableIds`-driven pass
  that deletes sidecars only for genuinely-prunable ids and **retains** all others
  into `newMetadata` (see "High-risk element 1").
- **`server.js` — `recordServed(id)` + call sites (`296`, `935-936`)**: no-clobber
  persisted last-served write (see "High-risk element 2 / hot path"). Left
  alongside the in-memory `markServed(filePath)` — additive, not a replacement.
- **`server.js` — `sweepAgedTranscodes(now)`**: filesystem wrapper for
  `selectAgedOut`, structured like `evictTranscodeCache`. Reads
  `db.settings.cacheMaxAgeDays`; returns `0` when Off. Builds
  `{path, lastServedAt, atimeMs}` per non-`.tmp.mp4` file (`lastServedAt` looked up
  via `db.metadata[basename(path,'.mp4')]`), computes the same `recentlyServed`
  protected set `evictTranscodeCache` uses, calls `selectAgedOut`, unlinks victims.
  Invoked immediately before `evictTranscodeCache` at both existing call sites; the
  call sites also switch their cap argument to `effectiveCacheCap(db.settings)`
  (the `evictTranscodeCache` function signature itself is unchanged). (AC 2.5)
- **`server.js` — new API routes** (see API changes): `GET/POST /api/settings`,
  `GET /api/cache/size`, `POST /api/cache/clear`, and the `409` addition to the
  existing `POST /api/scan`.
- **`server.js` — `module.exports` (`1002-1020`)**: add `scanIntervalMs`,
  `selectAgedOut`, `selectPrunableIds`, `transcodeCacheSize`, `effectiveCacheCap`.
- **`public/setup.html`**: new "Automation & Storage" `setup-box` after the
  Appearance box (`124`), with a "Scan" subsection (interval `<select>`,
  "Last scanned: N ago" line, "Scan now" button) and a "Transcode cache"
  subsection (age-retention `<select>`, size-cap input, cache-size display,
  "Clear cache now" button), plus a "Remove entries for deleted files during scan"
  checkbox. New JS: `loadSettings()`/`saveSettings()` against `/api/settings`,
  cache-size fetch/refresh against `/api/cache/size`, clear via `/api/cache/clear`,
  and a "Scan now" handler that POSTs `/api/scan` and — on `200` OR `409` — joins
  the existing `pollScanStatus()` loop (`292-311`) instead of erroring.
- **New tests**: `test/unit/settings-automation.test.js` (`scanIntervalMs`,
  `selectAgedOut`, `selectPrunableIds`, `transcodeCacheSize`, `effectiveCacheCap`,
  `db.settings` backfill) and `test/integration/settings-cache-api.test.js`
  (`/api/settings` GET/POST round-trip + validation, `/api/cache/size`,
  `/api/cache/clear` leaving `.tmp.mp4` intact, `/api/scan` 409). Existing
  `test/unit/transcode-cache.test.js` and scan-path tests are untouched.

### Data model impact

Additive only. Two new shapes, no existing field renamed/removed:

- Top-level `db.settings` object. Initial DB (`server.js:33-38`) gains
  `settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 }`.
  Backfill in `loadDatabase()` after the `folderSettings` line:

  ```js
  if (!db.folderSettings) db.folderSettings = {}; // backfill for older databases
  db.settings = {
    scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30,
    ...(db.settings || {})
  };
  ```

  Per-key spread means a partial persisted `settings` still gets missing keys
  defaulted. (AC 1.2, 6.4, and the zero-regression "old db.json loads clean" check.)
  Encoding: `scanIntervalMinutes` uses `0` for "Off"; `cacheMaxAgeDays` uses `0`
  for "Off"; `cacheMaxBytes` uses `null` for "no override".
- `db.metadata[id].lastServedAt` — optional epoch-ms number, added lazily by
  `recordServed`. Absent on pre-upgrade entries (→ atime fallback in the age
  sweep). Distinct from `scanState.lastScan`, which stays an ISO string.

### API changes

All new/changed routes use explicit status codes per RELIABILITY.md.

- `GET /api/settings` → `200 { scanIntervalMinutes, pruneMissing, cacheMaxBytes, cacheMaxAgeDays, effectiveCacheMaxBytes }`
  (`effectiveCacheMaxBytes` = `effectiveCacheCap(db.settings)`, for UI prefill).
- `POST /api/settings` → body may be partial; validates
  `scanIntervalMinutes ∈ {0,30,60,360,720,1440}`, `cacheMaxAgeDays ∈ {0,7,14,30,90}`,
  `pruneMissing` boolean, `cacheMaxBytes` `null` or positive integer. On invalid →
  `400 { error }`. On success merges into `db.settings`, `saveDatabase`, calls
  `armScanTimer()` if the interval changed, returns `200` with the saved settings.
- `GET /api/cache/size` → `200 { bytes }` from `transcodeCacheSize(TRANSCODE_DIR)`.
- `POST /api/cache/clear` → deletes non-`.tmp.mp4` `*.mp4` not in the
  `recentlyServed` window; `200 { success:true, removed, freedBytes }`. (AC 3.2)
- `POST /api/scan` (existing, `642-649`) → unchanged happy path
  (`200 {success:true}` after `await scanDirectories()`), plus a pre-check:
  `if (scanState.scanning) return res.status(409).json({ error:'scan already in progress' })`.
  Existing `{success:true}` integration coverage still passes. (AC 5.2)
- `GET /api/scan-status` and `GET/POST /api/config` — unchanged. (AC 1.4, 5.1)

### High-risk elements

**1. Mount-loss guard (highest risk; ships unconditionally).** Today
`runScanDirectories` rebuilds `db.metadata` from only the files it re-scanned and
silently drops the rest; `server.js:442` just `continue`s past a missing root, so
its entries vanish. Two-part fix:

- *Seam for "is this root present/mounted?"*: at the folder loop, when
  `!fs.existsSync(folder)`, add `folder` to a `missingRoots` set (instead of a bare
  `continue`). This is the single existence check, reused by the prune decision.
- *Seam for "is this individual file gone?"*: `selectPrunableIds` (pure, exported)
  decides per old id:

  ```js
  function selectPrunableIds(oldMetadata, survivingIds, missingRoots, pruneMissing) {
    const surviving = survivingIds instanceof Set ? survivingIds : new Set(survivingIds);
    const missing = missingRoots instanceof Set ? missingRoots : new Set(missingRoots);
    const prune = [];
    for (const [id, entry] of Object.entries(oldMetadata)) {
      if (surviving.has(id)) continue;             // file still on disk -> keep
      const root = entry && entry.rootFolder;
      if (root && missing.has(root)) continue;     // MOUNT-LOSS GUARD: never prune under a missing root
      if (!pruneMissing) continue;                 // toggle OFF -> retain stale entry
      prune.push(id);                              // root present + file individually gone + prune ON
    }
    return prune;
  }
  ```

  The guard (`root && missing.has(root)`) fires **before** the `pruneMissing`
  check, so it holds regardless of the toggle — exactly the hard AC 6.1 regression.
  In `runScanDirectories`, entries not in `survivingIds` and not in the prune list
  are copied back into `newMetadata` (retained); only prune-list ids get the
  existing thumbnail/transcode/progress cleanup. `entry.rootFolder` is populated by
  the backfill at `server.js:531` on every successful scan, so a previously-scanned
  item always carries its root; `matchRootFolder` is pure string-prefix matching,
  so a root that is merely unmounted still resolves for retained items. This is FS-
  free and fully unit-testable (construct `oldMetadata` with `rootFolder` fields).

**2. D3 keys off `lastServedAt`, atime only as fallback.** `selectAgedOut` uses
`lastServedAt` whenever it is a number and only falls back to `atimeMs` when it is
absent — so a file with a fresh recorded serve is never aged out even under
`relatime`/`noatime` stale atime (AC 2.2). This avoids reintroducing the atime trap
the `server.js:135-137` comment warns about. The `recentlyServed`/`RECENT_STREAM_MS`
window is the additional live guard, passed as `protectedPaths` into both
`selectAgedOut` and `selectEvictions`, so a file being actively watched is never
deleted by either sweep (AC 2.5).

**2b. Hot-path db-write safety (`recordServed`).** `/video/:id` fires many Range
requests per playback; a naive persist-on-every-serve would thrash `db.json` and
risk clobbering concurrent writes. `recordServed` mirrors `setTranscodeStatus`'s
no-clobber pattern and adds a staleness throttle:

  ```js
  function recordServed(id) {
    const now = Date.now();
    const db = loadDatabase();
    const entry = db.metadata[id];
    if (!entry) return;
    // write-only-when-stale: at most one persist per RECENT_STREAM_MS per item,
    // so a burst of Range requests during one playback does a single db write.
    if (entry.lastServedAt && (now - entry.lastServedAt) < RECENT_STREAM_MS) return;
    entry.lastServedAt = now;
    saveDatabase(db);
  }
  ```

  Being single-threaded, `saveDatabase` (a synchronous `writeFileSync`) never
  interleaves mid-write; the throttle caps write frequency at one per 10 min per
  item — the same accepted contention profile as the existing `setTranscodeStatus`.

**3. Additive / zero-regression.** `parseCacheCap`, `selectEvictions`,
`evictTranscodeCache`, and `cleanupOrphanTmp` keep byte-identical signatures and
bodies — the age sweep is a *separate* `sweepAgedTranscodes` step sequenced before
`evictTranscodeCache` at the call sites, so `test/unit/transcode-cache.test.js`
(which calls `evictTranscodeCache` directly and never invokes the age sweep) passes
unmodified. The `/video/:id` streaming path is unchanged except the additive
`recordServed` call next to `markServed`. Only the two documented behavior changes
land (30m default, guarded/toggleable prune).

### Alternatives considered

- **Age sweep folded into `evictTranscodeCache` vs a separate composed step.**
  Folding it in would read `db.settings.cacheMaxAgeDays` inside `evictTranscodeCache`
  — but the backfilled default (30 d) would then activate during the existing
  `transcode-cache.test.js`, aging out fixture files with old atimes and **breaking
  the frozen suite**. Rejected. The chosen separate `sweepAgedTranscodes` +
  exported `selectAgedOut` keeps `evictTranscodeCache` inert-by-default and gives a
  cleanly unit-testable pure selector.
- **`lastServedAt` in a dedicated sidecar/map vs `db.metadata[id]`.** A separate
  store would need its own persistence, backfill, and cleanup on prune. Reusing
  `db.metadata[id]` (already the home of per-item state, already cleaned up on
  prune) is zero new machinery. Adopted.
- **Timer via `setInterval` re-created on every settings change vs a single
  self-rescheduling `setTimeout`.** `clearInterval`+`setInterval` in `armScanTimer`
  is simpler and easy to reason about; `.unref()` handles the test-safety concern.
  Adopted.
- **`scanIntervalMinutes` as a number (0=Off) vs a string label ("off"/"30m").**
  A number keeps arithmetic (`minutes*60000`) trivial and validation a simple
  set-membership check; the UI maps labels↔numbers. Adopted.

### Risks and mitigations

- **Risk**: a config-save's background scan is skipped because a periodic scan is
  mid-flight (new overlap guard). → **Mitigation**: the next timer tick re-scans;
  the newly-added folder appears within one interval. Minor, acceptable.
- **Risk**: an entry with an empty/missing `rootFolder` under a genuinely missing
  mount could be mis-attributed. → **Mitigation**: `rootFolder` is backfilled on
  every successful scan, so any item ever scanned carries it; the guard is
  fail-safe in intent (only prunes when it can positively attribute a *present*
  root and the file is individually gone).
- **Risk**: hot-path db writes on serve. → **Mitigation**: staleness throttle +
  no-clobber pattern above (High-risk 2b).
- **Risk**: back-compat for env-only cap deployments. → **Mitigation**:
  `effectiveCacheCap` returns the env-derived `TRANSCODE_CACHE_MAX_BYTES` whenever
  `cacheMaxBytes` is `null`/absent (AC 4.2).

### Performance impact

No expected impact on RELIABILITY.md budgets. The one new recurring cost is a
`db.json` read+write on serve, capped by the throttle at one write per 10 minutes
per item (same profile as the existing `setTranscodeStatus`). The age sweep adds
one `readdir`+`stat` pass at the two existing eviction call sites (no new timer),
negligible next to the transcode it follows. The default scan cadence *decreases*
from every 10 min to every 30 min, reducing background load.

### Architecture note

`docs/ARCHITECTURE.md:63-64`'s "transcode cache is currently unbounded" note is
already stale (Closed tech-debt #1 added the size cap) and is refreshed by this
feature to record the size-cap + age-retention + `db.settings`/`lastServedAt`
additions.

## Task breakdown

Eight tasks (EM, adopting the principal-engineer's suggested sequence). Each is
small, independently testable, and gated by lint + the relevant tests before the
next starts. Statuses are tracked in `.state/feature-state.json`.

- **T1 — db.settings backfill + lastServedAt groundwork.** Additive `settings`
  object in the initial DB + per-key spread backfill in `loadDatabase()` (incl.
  the corrupt-JSON recovery path); ensure `db.metadata[id].lastServedAt` round-trips.
  Files: `server.js`, `test/unit/database.test.js`.
- **T2 — Pure exported helpers + tests.** `scanIntervalMs`, `selectAgedOut`,
  `selectPrunableIds`, `transcodeCacheSize`, `effectiveCacheCap`; exported via
  `module.exports`; `parseCacheCap`/`selectEvictions` FROZEN. Files: `server.js`,
  `test/unit/transcode-cache.test.js`, `test/unit/settings-helpers.test.js`.
- **T3 — Scan overlap guard + `armScanTimer` + `/api/scan` 409.** Replace the
  hardcoded 10-min interval; no overlapping scans; 409 when already scanning.
  Files: `server.js`, `test/integration/scan-api.test.js`.
- **T4 — Mount-loss guard + toggleable prune in `runScanDirectories`.** The
  guard fires BEFORE the toggle and ships unconditionally; hard regression test for
  a missing root retaining its entries. Files: `server.js`, `test/unit/scan-prune.test.js`.
- **T5 — `recordServed` + `sweepAgedTranscodes` at the two eviction call sites.**
  No-clobber throttled last-served writes; age sweep as a separate composed step
  before `evictTranscodeCache` (frozen); call sites use `effectiveCacheCap`.
  Files: `server.js`, `test/unit/transcode-cache.test.js`, `test/integration/streaming.test.js`.
- **T6 — New API routes.** `/api/settings` GET+POST (validated), `/api/cache/size`,
  `/api/cache/clear`. Files: `server.js`, `test/integration/settings-cache-api.test.js`.
- **T7 — setup.html "Automation & Storage" box + JS wiring.** Scan + Transcode-cache
  subsections; "Scan now" joins the existing poll and handles 409. File: `public/setup.html`.
- **T8 — Docs + lint + full-suite pass; ready for the two-reviewer gate.**
  Files: the exec plan, `docs/ARCHITECTURE.md`.

Per-task loop: SDE implements one task (running lint + tests and fixing failures
before reporting done) → build-specialist verifies → next task. The two-reviewer QA
(quality-assurance agent + separate `/code-review`) runs after T8.

## Progress log

- 2026-07-05 — Discovery: exec plan authored by product-manager per locked
  decisions D1-D4 (see Decision log). Grounded in `server.js` seams: scan
  timer (989), scan/prune (421-540), config API (595-639), eviction helpers
  (86-172), streaming/`markServed` (900-937), startup hygiene (978-998),
  `module.exports` (1002-1020); and `public/setup.html` UI anchors
  (folders box 101-113, Appearance box 115-124, scan-status polling
  292-341).

- 2026-07-05 — **T8 (final task) — docs + acceptance accounting.** T1-T7
  shipped and build-verified in sequence (db.settings backfill; the five pure
  helpers `scanIntervalMs`/`selectAgedOut`/`selectPrunableIds`/
  `transcodeCacheSize`/`effectiveCacheCap`; the scan overlap guard +
  `armScanTimer` + `/api/scan` 409; the mount-loss-guarded, toggleable prune in
  `runScanDirectories`; `recordServed` + `sweepAgedTranscodes` composed before
  `evictTranscodeCache`; the four new `/api/settings`+`/api/cache/*` routes;
  and the `setup.html` "Automation & Storage" box). Final full suite:
  **168/168 passing**, `npm run lint` 0 errors (11 pre-existing baseline
  warnings). This task (T8) updated `README.md` (new "Automation & Storage"
  subsection documenting the six controls and the env-var↔UI-cap precedence —
  confirmed the code reads exactly `TRANSCODE_CACHE_MAX_BYTES`, not
  `FILETUBE_CACHE_CAP`; the latter never existed as a real env var, only as
  planning-doc shorthand carried through Discovery/Design — corrected in the
  README to name only the real one), `ROADMAP.md` (moved "Transcode cache
  safety" to Shipped — it had already shipped via `avi-ux-refinement`/tech-debt
  #1 before this feature — and added a new Shipped entry for "Automation &
  Storage settings (v1.8.0)"), and `docs/ARCHITECTURE.md` (one additional
  tight sentence on `armScanTimer` and the new `/api/settings`+`/api/cache/*`
  routes; the PE's earlier refresh of the stale "unbounded cache" note and the
  `db.settings`/mount-loss-guard decision entry were already accurate and
  left as-is). Filled in the `## Acceptance criteria` coverage annotations
  below (all 6 groups + zero-regression, each `[UNIT]`/`[INTEGRATION]` item
  cited to its covering test with file:line, `[MANUAL]` items left for Dean's
  on-device pass) and confirmed the two intentional behavior changes (D1
  10min→30m, D2 unconditional→guarded/toggleable prune) are documented
  accurately against the shipped code. **No functional code changes were made
  in T8** — docs and this exec plan only. Feature is ready for the
  two-reviewer QA gate (`quality-assurance` agent + a separate `/code-review`
  pass) plus Dean's on-device manual pass.

## Decision log

- 2026-07-05 — D1: Auto-scan default 30 minutes; options Off/30m/1h/6h/12h/
  24h; replaces the hardcoded 10-min `setInterval`; adds an overlap guard;
  persisted server-side in `db.json`. Intentional behavior change
  (10min→30m). Decided by Dean, relayed via EM.
- 2026-07-05 — D2: Prune-missing default ON, with a mandatory mount-loss
  guard shipping regardless of the toggle (missing/unmounted root folder ≠
  deleted files; never prune under it). Individual per-file prune only when
  the root is present. Intentional behavior change (unconditional+unsafe →
  safe+controllable). Decided by Dean, relayed via EM.
- 2026-07-05 — D3: Transcode age-retention default 30 days, keyed off a
  last-served timestamp FileTube controls (not raw atime, which is unreliable
  under `noatime`/`relatime`); atime is a fallback only. Layers on top of the
  existing size-cap LRU backstop, which remains the hard cap. Decided by
  Dean, relayed via EM.
- 2026-07-05 — D4: Companions scoped to cache-size display + "Clear cache
  now"; size cap surfaced in UI (env var remains default/override source);
  last-scanned timestamp + "Scan now". Decided by Dean, relayed via EM.
- 2026-07-05 — Process: additive/zero-regression except D1+D2's two
  intentional changes; ships as v1.8.0; two-reviewer QA (quality-assurance
  agent + separate `/code-review` pass) required before merge. Decided by
  Dean, relayed via EM.
