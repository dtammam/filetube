# Optional yt-dlp Subscription Integration Module

Target release: **v1.11.0**. Feature id: `yt-dlp-integration-module`.
Supersedes/derives from the parked vision doc:
`docs/exec-plans/future/yt-dlp-integration-module.md` (left in place, not moved).

## Goal

Let FileTube optionally subscribe to YouTube channels and auto-download new
videos (via a bundled, dormant-by-default yt-dlp) directly into its own media
library, so there is one source of truth and no orphaned records — without
degrading FileTube in any way when the feature is off.

## Scope

- Subscribe to a channel by URL; unsubscribe/delete a subscription.
- Per-subscription: audio-only vs video; quality (default `"best"`).
- Manual "re-pull all" and "re-pull one" triggers, plus a scheduled background
  poll (armed only when the module is enabled).
- Dedup via yt-dlp's built-in `--download-archive` (module-owned archive file).
- Members-only content skip, as a toggle (default: skip), implemented as an
  isolated, easily-updatable `shouldSkip(videoMeta)` rules layer; download
  members-only content only when a cookies file is configured AND the toggle
  allows it.
- Premiere handling via poll-and-defer (skip a still-in-window premiere this
  cycle; a later poll picks it up), restart-safe, no live per-video timers.
- A simple subscriptions UI: list/add/delete/re-pull, last-checked/status —
  present only when the module is enabled.
- ENV-driven configuration, documented in README / `.env.example`.
- Downloads land in a media folder already covered by the existing scanner, so
  they appear in the normal browse/watch UI and deleting them in FileTube
  removes them the same way any other media file is removed.

## Out of scope

- **Not a MeTube rebuild.** No general-purpose download manager: no arbitrary
  URL/playlist download UI beyond channel subscriptions, no per-video format
  picker in the UI, no download queue visualization/progress bars beyond
  last-checked/status, no scheduling UI beyond the single poll interval.
- No support for platforms other than what yt-dlp's channel-subscription model
  covers (this spec is written YouTube-first; other extractors are not
  precluded technically but are not a requirement).
- No username/password auth for members-only content — cookies-file only.
- No per-subscription custom poll interval (one global poll interval).
- No retry/backoff UI or notification system for failed downloads beyond
  status/log visibility.
- Tests, lint compliance, and the disabled-path no-op guarantee are explicitly
  **IN scope** for this feature (see Constraints) — CONTRIBUTING.md's
  "every feature ships with tests" and "lint passes with zero warnings" apply
  to this module like any other change; nothing here defers them.

## Constraints

**#1, non-negotiable, threads through every requirement below:
OPTIONAL / ADDITIVE / MUST-NOT-DEGRADE.**

When the module is **disabled (the default)**, FileTube must behave
**byte-identically to today**:
- No new routes registered (not present, not 403 — absent from the router).
- No background poll job armed/started.
- No subscriptions UI shown or served to the client.
- No assumption that a yt-dlp binary is installed or reachable.
- The existing **241-test suite stays green with zero behavior change**.
- Every new file/module this feature adds must be side-effect-free to
  `require()` when disabled (mirrors `server.js`'s existing
  `require.main === module` guard for scanning/listening).

Enabling the module is **purely additive** — no existing route, response
shape, settings field, or scan behavior changes.

Additional constraints:
- Node 22 LTS / Express 4, CommonJS, no new heavyweight runtime deps beyond
  what's needed to shell out to yt-dlp (spawn/execFile are built-in).
- Subscription config persists in `db.json` via the existing serialized
  `updateDatabase(mutatorFn)` primitive (one writer, atomic save) — no second
  JSON file, no second source of truth.
- The scheduled poll must follow the existing `armScanTimer()` shape:
  settings-driven, `.unref()`'d, re-armable live without a restart, arms
  nothing when the interval is off/the module is disabled.
- yt-dlp is spawned as a child process, never via a shell — see Security below.
- Downloads must land inside the configured media/download directory tree —
  no path escape.
- Cookies file, if configured, is treated as a mounted read-only path — never
  logged, never copied into `db.json`.
- FFmpeg/yt-dlp-dependent paths stay OUT of the automated `node:test` suite
  (mirrors existing FFmpeg policy); pure logic must be extracted so it's
  unit-testable without a real binary or network access.
- Failures degrade gracefully (log + skip/continue) — never crash the server
  process (mirrors RELIABILITY.md's spawn try/catch policy).

## Functional requirements

### FR1 — Enable/config
The module is inert by default. A master enable flag (default off) gates
whether its routes are registered, its background poll is armed, and its UI is
served. Additional optional ENV params configure cookies path, poll interval,
download root, and pinned yt-dlp version (see Open Questions #1 for exact
names/defaults).

### FR2 — Subscriptions
Users can add a subscription by channel URL, with per-subscription audio-only
vs video and quality (default `"best"`), and delete a subscription. Persisted
in `db.json` via `updateDatabase`.

### FR3 — Download loop
A background poll (armed only when enabled) checks subscriptions on a
schedule. Manual "re-pull all" and "re-pull one" triggers are also available.
Downloads land in a media folder the existing scanner indexes.

### FR4 — Dedup
yt-dlp's `--download-archive` (a module-owned file) is the single dedup
mechanism — no separate "already got it" bookkeeping. Deleting a video in
FileTube uses FileTube's normal delete semantics (see Open Questions #4 for
the archive-entry interaction).

### FR5 — Members-only skip
A toggle (default: skip) gates whether members-only content is ever attempted.
Skip logic lives in an isolated `shouldSkip(videoMeta)` rules layer, fail-safe
(skip + log on uncertainty), so it can be updated in one place without digging
through the download pipeline. Members-only download is attempted only when a
cookies file is configured AND the toggle allows it.

### FR6 — Premiere delay
A video whose `release_timestamp` + ~2h window hasn't elapsed yet is skipped
that poll cycle and picked up by a later poll (poll-and-defer). No live
per-video timers; restart-safe by construction (state is just "not yet in the
archive").

### FR7 — UI
A simple subscriptions UI: list subscriptions, add (URL + audio/video +
quality), delete, re-pull-all/re-pull-one buttons, last-checked/status display.
Entirely absent when the module is disabled.

### FR8 — Docs
ENV params are documented in the README and `.env.example`.

## Non-functional / security requirements

### NFR1 — No shell interpolation
yt-dlp is invoked via `execFile`/`spawn` with an **argument array**; `shell:
true` is never used, and no user-controlled value (URL, quality, etc.) is ever
concatenated into a shell command string.

### NFR2 — URL validation
Subscription URLs are validated/normalized against an allowlist of expected
channel-URL shapes before being persisted or passed to yt-dlp; anything else
is rejected (fail-safe, not "best effort").

### NFR3 — Path confinement
The resolved download destination for any subscription is confined to the
configured media/download directory tree; no subscription or filename
component can cause a write outside it (path-traversal guard).

### NFR4 — Cookies/creds handling
A configured cookies file is read-only from the module's perspective, never
logged (including in error paths/stack traces), and never copied into
`db.json` or any other persisted config — only the file *path* may appear in
config, never its contents.

### NFR5 — Graceful degradation
Every yt-dlp spawn is wrapped in error handling that logs and continues (skips
that subscription/item) rather than crashing the process or wedging the poll
loop, mirroring the existing FFmpeg spawn policy.

## Testability requirements

The following must be extracted as **pure, synchronous helpers** covered by
`node:test` without invoking a real yt-dlp binary or network:
- Channel URL parse/validate/normalize.
- The yt-dlp argument-array builder (format audio/video + quality + archive
  flag + cookies flag).
- `shouldSkip(videoMeta)` rules.
- The premiere poll-and-defer decision (`release_timestamp` + window → skip or
  proceed).
- Dedup/archive-entry logic (what counts as "already pulled").

The process-invocation boundary itself (spawning yt-dlp) is covered by
mocked/integration tests, not real network calls, mirroring how FFmpeg is kept
out of the automated suite today.

## Acceptance criteria

### Disabled path is a no-op (the acceptance north star)

1. [INTEGRATION] With the master enable flag unset/off, booting the app
   registers no subscription-related routes: requests to every
   subscription/module endpoint return 404 (indistinguishable from a route
   that was never defined), not 403/disabled-page.
2. [INTEGRATION] With the module disabled, no background poll timer is armed
   (analogous to `currentScanTimer()`, a test-observability accessor for the
   module's own timer must report `null`/not-armed).
3. [MANUAL] With the module disabled, the subscriptions UI element/page is
   absent from the served HTML/nav — not hidden via CSS, not present-but-
   greyed-out.
4. [UNIT] Requiring the module's file(s) has no side effects (no directory
   creation, no timer, no route registration) when the enable flag is off —
   mirrors `server.js`'s `require.main === module` guard.
5. [PROCESS] The full existing 241-test suite (`npm test`) passes unmodified
   with the module present-but-disabled, proving zero behavior change to
   current functionality.
6. [PROCESS] `npm run lint` passes with zero warnings on all new module code.

### Enable/config (FR1)

7. [UNIT] The master enable flag defaults to off when unset, and any
   non-affirmative/invalid value is treated as off (fail-safe default).
8. [INTEGRATION] With the flag on, module routes are registered and reachable;
   with it off, they are not — verified in the same test file/process to
   directly demonstrate the on/off toggle (not just two independent runs).
9. [UNIT] Optional ENV params (cookies path, poll interval, download root,
   pinned yt-dlp version) each have a documented, sane default and are parsed
   defensively (an invalid value falls back to the default rather than
   crashing startup — mirrors `parseCacheCap`'s pattern).

### Subscriptions (FR2)

10. [UNIT] Adding a subscription with a valid channel URL, format
    (audio/video), and quality persists a well-formed subscription record.
11. [INTEGRATION] `POST` add-subscription and `DELETE` subscription endpoints
    round-trip through `db.json` via `updateDatabase` (no second config file
    introduced).
12. [UNIT] Quality defaults to `"best"` when not specified.
13. [INTEGRATION] Deleting a subscription removes it from `db.json` and stops
    it from being polled on the next cycle.

### Download loop (FR3)

14. [INTEGRATION] The background poll is armed only when the module is
    enabled, follows the `armScanTimer()` shape (settings-driven interval,
    `.unref()`'d, re-armable live on a settings change without a restart), and
    arms nothing when the effective interval is off.
15. [INTEGRATION] A manual "re-pull all" trigger polls every subscription
    on demand, independent of the scheduled timer.
16. [INTEGRATION] A manual "re-pull one" trigger polls a single named
    subscription on demand.
17. [INTEGRATION] Videos downloaded by the module land in a directory the
    existing scanner covers, and a subsequent scan indexes them into the
    normal media library (they appear via the standard metadata endpoints).

### Dedup (FR4)

18. [UNIT] The archive/dedup helper correctly identifies an already-downloaded
    video id as "skip" and a new video id as "proceed," given a representative
    archive-file/-state fixture (no real yt-dlp invocation).
19. [INTEGRATION] Re-polling a subscription with no new videos results in zero
    additional download attempts (archive respected).

### Members-only skip (FR5)

20. [UNIT] `shouldSkip(videoMeta)` returns "skip" for representative
    members-only-content metadata shapes, and "proceed" for ordinary public
    content, driven by a table of cases (not a single hardcoded string check)
    so the rule set can be extended in one place.
21. [UNIT] `shouldSkip` fails safe: an ambiguous/unrecognized metadata shape
    (simulating a YouTube wording/format change) resolves to "skip," never
    "proceed."
22. [UNIT] Members-only download is only attempted when the toggle allows it
    AND a cookies file is configured; either condition missing forces skip.
23. [UNIT] The toggle defaults to "skip" (members-only skipped) when unset.

### Premiere delay (FR6)

24. [UNIT] Given a `release_timestamp` inside the defer window (now to now+2h),
    the poll-and-defer decision returns "skip this cycle."
25. [UNIT] Given a `release_timestamp` at/after the window has elapsed, the
    decision returns "proceed."
26. [UNIT] The decision is a pure function of `(release_timestamp, now)` with
    no persisted per-video timer state — restart-safety is structural (a
    fresh poll after a restart makes the same decision from the same inputs).

### Security (NFR1-4)

27. [UNIT] The yt-dlp argument-array builder never returns a value containing
    shell metacharacter concatenation — it returns a plain array of discrete
    argv-style strings, one flag/value per element.
28. [INTEGRATION] The module invokes the child process via `execFile`/`spawn`
    with an argument array and never `shell: true`, verified by inspecting the
    actual call (e.g. a spy/mock on the spawn call site) for a representative
    subscription URL containing shell metacharacters (e.g. `; rm -rf /`) —
    the metacharacters must never reach a shell.
29. [UNIT] URL validation rejects a representative set of malformed/unexpected
    URLs (non-channel URLs, URLs with shell metacharacters, non-http(s)
    schemes) and accepts a representative set of valid channel URL shapes.
30. [UNIT] The download-path resolution helper rejects/neutralizes a
    representative set of path-traversal attempts (`../`, absolute paths,
    symlink-style tricks where testable) and confines the result to the
    configured directory tree.
31. [INTEGRATION] A cookies file path configured via ENV never appears in any
    log line emitted during a subscription poll/download cycle (assert
    against captured stdout/stderr in a test), and never appears in the
    persisted `db.json` (only the ENV-configured path may be referenced
    indirectly, never file contents).

### UI (FR7)

32. [MANUAL] With the module enabled, the subscriptions UI allows: listing
    subscriptions, adding one (URL + audio/video + quality), deleting one,
    triggering re-pull-all and re-pull-one, and viewing last-checked/status
    per subscription.
33. [INTEGRATION] The endpoints backing the UI (list/add/delete/re-pull)
    return correct status codes for success and for invalid input (400 for a
    malformed URL, 404 for an unknown subscription id).

### Docs (FR8)

34. [MANUAL] README and `.env.example` document every ENV param introduced by
    this feature, each with its default and a one-line description, and
    clearly state the feature is opt-in/disabled-by-default.

## Open Questions

The following forks are genuine product decisions Dean should confirm before
design proceeds. Each is framed with trade-offs and a recommended default; none
are resolved here.

### 1. Exact enable mechanism + full ENV param set

**Fork:** what exactly gates the module, and what's the complete set of
optional ENV params?

**Recommended default:**
- `FILETUBE_YTDLP_ENABLED` (default: unset/off) — master flag; any value other
  than a truthy string (`"true"`/`"1"`) is treated as off.
- `FILETUBE_YTDLP_COOKIES_FILE` (default: unset) — path to a mounted read-only
  cookies file; absent means members-only content is always skipped regardless
  of the toggle.
- `FILETUBE_YTDLP_POLL_MINUTES` (default: e.g. 60) — background poll interval;
  `0`/unset could mean "manual re-pull only, no scheduled poll," mirroring
  `scanIntervalMinutes`'s "0 = Off" convention.
- `FILETUBE_YTDLP_DOWNLOAD_DIR` (default: a subfolder under the existing media
  root, e.g. `<first configured media folder>/Subscriptions`, or a dedicated
  configured folder — see Open Question #4) — where downloads land.
- `FILETUBE_YTDLP_VERSION` (default: a version pinned in the Dockerfile at
  build time) — lets an operator override the bundled yt-dlp version without
  rebuilding, if the PE's design supports that; otherwise this becomes a
  build-time-only pin (see Open Question #5).

Trade-off: more ENV knobs = more flexibility but more surface to document/test
and more ways to misconfigure. Recommend keeping exactly these five and no
more for v1.11.0.

### 2. Creds/cookies handling + members-only default

**Fork:** how are cookies supplied, and what's the default posture toward
members-only content?

**Recommended default:** cookies supplied only via
`FILETUBE_YTDLP_COOKIES_FILE` pointing at a mounted, read-only file (never
pasted into `db.json`, never accepted via the UI as free text). Members-only
content is skipped by default (the toggle default is "skip"), and is only ever
attempted when BOTH the toggle is explicitly set to allow it AND a cookies
file is configured — absence of either forces skip. This is the fail-safe
posture already decided in the architecture; flagged here only so Dean
explicitly confirms the UI-level toggle default and that there's no
username/password fallback path.

### 3. UI placement

**Fork:** a section within the existing Settings page, or a dedicated
standalone page/route.

**Recommended default:** a **dedicated page** (e.g. `/subscriptions`), linked
from Settings but not embedded inline in it. Rationale: the existing Settings
page governs core, always-present behavior (scan cadence, cache limits); this
feature is optional and, when enabled, has enough of its own surface (list,
add form, per-item re-pull, status) to warrant its own page rather than
crowding Settings. It also keeps the "absent when disabled" requirement
structurally simple — one route/nav-link either exists or doesn't, rather than
a conditional section inside a page that always renders.

### 4. Download folder structure + re-pull vs `--download-archive`

**Fork:** how are downloads laid out on disk, and does "re-pull" force a
re-fetch of archived items or only fetch new ones?

**Recommended default:**
- One top-level configurable download root (`FILETUBE_YTDLP_DOWNLOAD_DIR`),
  with a per-subscription (per-channel) subfolder named from the channel
  (sanitized), so channels don't collide and the existing scanner's
  folder-based organization still makes sense.
- "Re-pull all" / "re-pull one" **respect** the download-archive by default —
  they mean "check this subscription now instead of waiting for the next
  scheduled poll," not "bypass dedup." A separate, explicit "force re-pull"
  (bypassing the archive) is **out of scope for v1.11.0** unless Dean asks for
  it — flag this as a residual open question (non-blocking; default: not
  included).
- Deleting a video in FileTube does **not** automatically remove its entry
  from the yt-dlp archive file in v1.11.0 (i.e., a deleted video stays
  "already pulled" and will not be re-downloaded by the normal poll/re-pull).
  This is the simpler, safer default (avoids silent re-downloads of something
  a user deliberately removed) but is a genuine fork against the vision doc's
  suggestion that "delete in FileTube" could mean "re-downloadable." Dean
  should confirm which behavior is wanted; the recommended default here is
  **stays skipped** unless a future explicit "force re-pull" is added.

### 5. yt-dlp bundling/update strategy in the Dockerfile

**Fork:** how is yt-dlp installed in the image, and how is it kept up to date?

**Recommended default:** install a **pinned yt-dlp version in the same base
image** that already ships FFmpeg (Alpine, via `pip`/`pipx` or the static
binary release — PE decides the mechanism at design), rather than a separate
image variant. Rationale for bundled-vs-separate-tag: Dean's stated
architecture already leans this way ("no orphan two-systems problem"), and a
second image tag reintroduces a variant-matrix to maintain. Version pinning:
a build ARG/ENV (e.g. `YTDLP_VERSION`) with a documented default, bumped via a
normal Dockerfile change + rebuild — no auto-update inside a running
container (YouTube-facing extractors change often enough that silent
auto-update is a reliability risk, not a convenience). Trade-off: `pip`-based
install is easy to version-pin and small; a static binary avoids a Python
runtime dependency in the image but is a larger, less incremental download per
bump. This mechanism choice is explicitly left to the PE's Design stage per
the brief; the recommendation here is only the pin-in-image-vs-separate-tag
question and the "no runtime auto-update" default.

### Residual open questions (non-blocking, proposed defaults)

- **Subscription naming in the UI:** derive a display name from yt-dlp's
  channel metadata at add-time (default) rather than requiring the user to
  type one.
- **Status/error visibility granularity:** last-checked timestamp + a simple
  ok/error status string per subscription is sufficient for v1.11.0; a full
  per-video download log/history view is out of scope.
- **Multiple cookies files (per-subscription):** out of scope — one global
  cookies file for v1.11.0, not per-subscription.

## Design

### Approach

The module is a new self-contained directory `lib/ytdlp/` (pure helpers +
wiring functions) plus conditional wiring calls in `server.js`. It reuses the
existing v1.9.0 primitives verbatim: `updateDatabase(mutatorFn)` for all
persistence (no second source of truth), the `armScanTimer()`/`currentScanTimer()`
timer shape for the poll, the `require.main === module` side-effect gate for
process-lifecycle work, `matchRootFolder`/`getMediaId` and `scanDirectories()`
for indexing downloaded files, `parseCacheCap`'s defensive-ENV pattern for
config, and the FFmpeg `spawn(cmd, argsArray)` pattern (never `shell: true`)
for invocation. No new runtime dependency is added (`child_process` is
built-in).

The single north-star mechanism is a hard split between **wiring that is
side-effect-free to `require()`** and **wiring that is gated behind
`isEnabled(config)`**. Every side effect (route registration, timer arming,
directory creation, presence check) lives inside a named function that
early-returns when the module is disabled. `require('./lib/ytdlp')` only
*defines* functions; it never registers a route, arms a timer, touches the
filesystem, or assumes a yt-dlp binary exists. `server.js` calls
`ytdlp.registerRoutes(app)` once at module-eval (internally a no-op when
disabled) and `ytdlp.startBackground(deps)` only inside the existing
`require.main === module` block (so importing `server.js` for tests neither
arms the poll nor creates directories). When `FILETUBE_YTDLP_ENABLED` is unset
(the default), the result is byte-identical to today: no routes, no timer, no
page, no filesystem writes, no binary assumption — the existing 241-test suite
runs unchanged. (AC 1-6, 8)

Downloads land under a single configured `FILETUBE_YTDLP_DOWNLOAD_DIR`, which
the module registers into `db.folders` (idempotently, only when enabled) so the
**existing scanner indexes them with zero scanner changes** — downloaded media
appears in the normal browse/watch UI and is deleted the normal way (AC 17). A
poll lists a channel's videos as metadata (no download), filters them through
pure JS (`isArchived` -> `shouldSkip` -> `shouldDeferPremiere`), then spawns
yt-dlp to download only the survivors, recording the archive via yt-dlp's own
`--download-archive`. Long child processes run entirely **outside** the
`updateDatabase` critical section; only the short status write re-enters the
lock (AC 27-31, RELIABILITY spawn policy).

### Component changes

- **`lib/ytdlp/config.js` (new)**: pure `parseYtdlpConfig(env)` +
  `isEnabled(config)`. Parses exactly the five locked ENV vars (D1)
  defensively, mirroring `parseCacheCap` (invalid -> default, never throws at
  startup). (AC 7, 9)
- **`lib/ytdlp/url.js` (new)**: pure `validateChannelUrl(raw)` allowlist +
  normalizer. (AC 29, NFR2)
- **`lib/ytdlp/args.js` (new)**: pure `buildYtdlpListArgs` and
  `buildYtdlpDownloadArgs` argument-array builders + `resolveChannelDir` /
  `sanitizeChannelName` path-confinement resolvers. (AC 27, 30, NFR1, NFR3)
- **`lib/ytdlp/rules.js` (new)**: pure `shouldSkip(videoMeta, opts)`
  (table-driven, fail-safe) + `shouldDeferPremiere(videoMeta, now)` +
  `isArchived(archiveText, extractor, id)` + `parseYtdlpVideoList(stdout)`. (AC
  18, 20-26)
- **`lib/ytdlp/process.js` (new)**: the *only* module that touches
  `child_process` — a thin `spawnYtdlp(args, opts)` wrapper (arg-array,
  never `shell: true`, cookies redaction in any log line) and the presence
  check `checkYtdlpAvailable()`. (AC 28, 31, NFR1, NFR4, NFR5)
- **`lib/ytdlp/store.js` (new)**: persistence accessors — `listSubscriptions`,
  `addSubscription`, `deleteSubscription`, `setSubscriptionStatus`,
  `getAllowMembersOnly` — each reading/writing `db.ytdlp` **exclusively through
  the `updateDatabase` primitive passed in as a dependency**, defensively
  defaulting a missing `db.ytdlp` (backfill pattern of `folderSettings`,
  applied module-locally so core `loadDatabase` is untouched and the disabled
  path stays byte-identical). (AC 10-13)
- **`lib/ytdlp/index.js` (new)**: the wiring surface — `registerRoutes(app,
  deps)` (early-returns when disabled), `armYtdlpTimer()` +
  `currentYtdlpPollTimer()` (mirrors `armScanTimer`/`currentScanTimer`),
  `runPoll(subId?)` (the download loop), `startBackground(deps)` (presence
  check + dir/folder registration + initial arm, called only under the
  `require.main === module` guard). Re-exports the pure helpers for `node:test`.
- **`server.js` (modified, minimal)**: `const ytdlp = require('./lib/ytdlp')`
  near the other requires; `ytdlp.registerRoutes(app, { updateDatabase,
  loadDatabase, scanDirectories, getMediaId })` once after the existing route
  block (internally inert when disabled); `ytdlp.startBackground({...})` inside
  the existing `require.main === module` block next to `armScanTimer()`; add
  `currentYtdlpPollTimer` (and the pure helpers, for tests) to `module.exports`.
  No existing route, response shape, setting, or scan behavior changes.
- **`public/js/common.js` (modified)**: a capability probe — `fetch`
  `GET /api/subscriptions/health`; on `200` inject the "Subscriptions" nav link
  into the Settings surface; on `404` do nothing (so when disabled the link is
  **absent from the DOM**, not CSS-hidden — D4, AC 3).
- **`lib/ytdlp/views/subscriptions.html` + `lib/ytdlp/client/subscriptions.js`
  (new)**: the page markup and its vanilla-JS controller, served **only** via
  conditional routes (kept OUT of `public/` so `express.static` cannot serve
  them when disabled — this is what makes the page provably 404 when off).
- **`Dockerfile`, `.env.example`, `README.md`, `docker-compose.yml`
  (modified)**: pinned yt-dlp install + ENV docs (D5, FR8, AC 34).

### Data model changes

One new top-level namespace in `db.json`, written exclusively via
`updateDatabase`, lazily initialized by the module's store (never by core
`loadDatabase`, so an old/disabled db is unaffected):

```json
{
  "ytdlp": {
    "allowMembersOnly": false,
    "subscriptions": [
      {
        "id": "md5(normalizedChannelUrl)",
        "channelUrl": "https://www.youtube.com/@channel",
        "name": "Channel display name (derived at add-time)",
        "format": "audio | video",
        "quality": "best",
        "addedAt": "2026-07-05T00:00:00.000Z",
        "lastCheckedAt": null,
        "lastStatus": "ok | error: <short reason> | null"
      }
    ]
  }
}
```

`id` is `md5(normalizedChannelUrl)` (reusing the `getMediaId` hashing idea) so
re-adding the same channel is idempotent. `quality` defaults to `"best"` (AC
12). The members-only toggle is a **persisted setting, not an ENV var** (D1 is
exactly five ENV vars, none of which is this toggle); it lives at
`db.ytdlp.allowMembersOnly`, default `false` (AC 23). No change to
`DEFAULT_SETTINGS` or core `loadDatabase`.

**Download-archive:** a module-owned file at
`<FILETUBE_YTDLP_DOWNLOAD_DIR>/.yt-dlp-archive.txt`, written by yt-dlp's
`--download-archive` (one global file, one dedup mechanism — FR4). It is a
dotfile at the download root (not indexed by the scanner, which only matches
media extensions). **D3 is honored structurally:** FileTube's normal
`DELETE /api/videos/:id` removes only the media file and its `db.metadata`
entry; it never touches `.yt-dlp-archive.txt`, so a deleted video stays
recorded as "already pulled" and is never re-downloaded by a later poll or
re-pull. A force-re-pull that rewrites the archive is out of scope (D3).

### API changes

All new; **all registered only when enabled** (absent -> `404` when disabled,
AC 1, 8):

- `GET  /api/subscriptions/health` -> `200 {enabled:true}` (capability probe for
  the nav link; the route's mere existence is the signal).
- `GET  /api/subscriptions` -> list with per-sub `lastCheckedAt`/`lastStatus`.
- `POST /api/subscriptions` `{channelUrl, format, quality?}` -> `400` on invalid
  URL/format (AC 33), else derive name + persist, `201`.
- `DELETE /api/subscriptions/:id` -> `404` unknown id (AC 33), else remove.
- `POST /api/subscriptions/repull` -> trigger a poll of all subs now, `202`
  (independent of the timer, AC 15).
- `POST /api/subscriptions/:id/repull` -> `404` unknown id, else poll one,
  `202` (AC 16).
- `GET  /subscriptions` -> serve the page HTML (conditional route,
  `sendFile` from `lib/ytdlp/views/`).
- `GET  /js/subscriptions.js` -> serve the page controller (conditional route).

No existing endpoint changes. (FR7, AC 32-33)

### Dormant-module wiring (the no-op guarantee)

- **Requiring is side-effect-free (AC 4):** `require('./lib/ytdlp')` only defines
  functions. Route registration, timer arming, directory creation, and the
  presence check are each inside a named function guarded by `isEnabled`.
- **Routes absent when off (AC 1, 8):** `registerRoutes(app, deps)` first line
  is `if (!isEnabled(cfg)) return;`. Disabled -> nothing is added to the router
  -> every subscription path returns Express's native `404`. The page/JS live
  outside `public/`, so `express.static` cannot leak them either.
- **No timer when off (AC 2, 14):** `armYtdlpTimer()` mirrors `armScanTimer`
  exactly — clears any existing timer, then arms a `.unref()`'d `setInterval`
  **only** when `enabled && pollMinutes > 0 && binaryPresent`; otherwise leaves
  it `null`. `currentYtdlpPollTimer()` returns the timer or `null`, mirroring
  `currentScanTimer()`, so `[INTEGRATION]` tests can assert not-armed.
- **Same-process on/off proof (AC 8):** because `registerRoutes` and
  `armYtdlpTimer` are exported and take config/app as inputs, one test file can
  set the env off, mount a fresh `express()` app + assert `404` and
  `currentYtdlpPollTimer() === null`, then set it on, mount again + assert the
  routes exist and the timer arms — in a single process, no separate runs.
- **Nav link absent when off (AC 3, D4):** injected by `common.js` only on a
  `200` from `/api/subscriptions/health`; when disabled the probe `404`s and the
  link is never added to the DOM.
- **Graceful degrade when enabled-but-binary-absent (NFR5):**
  `startBackground` runs `checkYtdlpAvailable()` at startup; if the binary is
  missing it logs a prominent one-line warning, does **not** arm the poll, and
  the API/poll short-circuit with a clear `error` status rather than crashing —
  the flag-off no-op path is unaffected.

### Download loop

- **Poll (`runPoll(subId?)`):** guarded by a module `pollBusy` flag (mirrors
  `scanState.scanning`) so overlapping polls/re-pulls never stack. For each
  target subscription, sequentially (one channel at a time, like the
  single-worker transcode queue, to avoid overloading a home server):
  1. `spawnYtdlp(buildYtdlpListArgs(sub, cfg))` -> `--dump-json` metadata only
     (no download), parsed by `parseYtdlpVideoList(stdout)`.
  2. Pure filter per video: `isArchived` (skip — dedup, AC 18-19) ->
     `shouldSkip` (skip + log reason, AC 20-23) -> `shouldDeferPremiere(meta,
     Date.now())` (skip this cycle, AC 24-26).
  3. `spawnYtdlp(buildYtdlpDownloadArgs(sub, cfg, ctx))` downloads only the
     survivors, with `--download-archive` recording them.
  4. Trigger `scanDirectories()` (the existing coalescing entry point) so the
     new files are indexed (AC 17), then one short `updateDatabase` mutator sets
     `lastCheckedAt`/`lastStatus`.
  Every spawn is wrapped in try/catch: a failure logs, sets `lastStatus:
  "error: ..."`, and continues to the next subscription — never crashes the
  process or wedges the loop (NFR5).
- **No lock across downloads:** child processes are awaited **outside** any
  `updateDatabase` call; the mutator only runs for the tiny status write. This
  respects the primitive's "mutator must be synchronous, no await inside the
  lock" contract.
- **Timer:** `armYtdlpTimer()` reads `pollMinutes` from config (not a persisted
  setting — the interval is ENV-driven per D1), armed only when enabled and
  `> 0`; `0` = manual-only (no timer). Re-arm on the same `armScanTimer` shape.
- **Manual triggers:** `runPoll()` (all) and `runPoll(id)` (one) are called by
  the re-pull endpoints, independent of the timer (AC 15-16).
- **Where files land:** `<FILETUBE_YTDLP_DOWNLOAD_DIR>/<sanitizedChannelName>/`
  via a confined `-o` template; the download root is registered into
  `db.folders` on enable so the existing scanner covers it (AC 17).

### Security (SECURITY-CRITICAL surface — full two-reviewer gate)

- **(a) Arg-array spawn, never a shell (NFR1, AC 27-28):** `spawnYtdlp` calls
  `child_process.execFile('yt-dlp', argsArray, opts)` with **no `shell`
  option** (defaults to `false`); no user value is ever concatenated into a
  command string. A `[INTEGRATION]` spy asserts the call site passes an array
  and no `shell: true` even when a subscription URL contains `; rm -rf /` — the
  metacharacters never reach a shell.
- **(b) Pure arg builders (AC 27):** `buildYtdlpListArgs` /
  `buildYtdlpDownloadArgs` return a flat `string[]`, one flag/value per
  element: `--download-archive <archivePath>`, `--no-progress`, format
  selection (`-x --audio-format ...` for audio vs `-f <qualitySelector>` for
  video, quality default `best`), `--cookies <file>` **only when a cookies
  file is configured and exists on disk**, an `-o` template confined to the
  download dir, and — critically — a `--` separator immediately before the
  positional URL so a URL can never be interpreted as an option even if
  validation is bypassed.
- **(c) URL validation/allowlist (NFR2, AC 29):** `validateChannelUrl` parses
  with the WHATWG `URL` class, requires `https:`/`http:` scheme, requires host
  in a YouTube allowlist (`youtube.com`, `www.youtube.com`, `m.youtube.com`,
  `youtu.be`), requires a plausible channel/playlist/@handle path shape, and
  rejects anything with a leading `-`, whitespace, or shell metacharacters.
  Rejection is fail-safe (`400`), not best-effort. Validation runs at add-time
  (before persist) and again before each spawn.
- **(d) Path confinement (NFR3, AC 30):** `sanitizeChannelName` strips path
  separators / `..` / control chars; `resolveChannelDir(root, sub)` computes
  `path.resolve(root, sanitized)` and asserts the result `=== root` or
  `startsWith(root + path.sep)` — otherwise it throws and the subscription is
  skipped. Absolute paths, `../` traversal, and separator tricks are neutralized
  before they reach the `-o` template.
- **(e) Cookies hygiene (NFR4, AC 31):** the cookies file is referenced by path
  only; its **contents are never read into `db.json`** and never logged. Any
  log line emitted by `spawnYtdlp` redacts the `--cookies <path>` pair (and the
  path) via a `redactArgs` helper before printing, so neither the path nor the
  contents appear in captured stdout/stderr. Treated as a mounted read-only
  file.

### `shouldSkip(videoMeta, opts)` — table-driven, fail-safe

Input shape (subset of yt-dlp `--dump-json` per-video metadata):
`{ id, availability, live_status, title }`. `opts = { allowMembersOnly,
cookiesConfigured }`. Implemented as an ordered rule table (extensible in one
place — FR5), preferring the **structured `availability` field** over
string-matching a human-readable label:

| Rule | Condition | Result |
|------|-----------|--------|
| public | `availability` in `{public, unlisted, undefined, null}` | proceed |
| members | `availability` in `{subscriber_only, premium_only, needs_subscription}` | skip **unless** `allowMembersOnly && cookiesConfigured` |
| restricted | `availability` in `{needs_auth, private}` | skip |
| unknown (fail-safe) | any other non-empty `availability` value | **skip** |

The `unknown` catch-all is the fail-safe: a YouTube wording/format change that
yields an unrecognized `availability` token resolves to **skip**, never proceed
(AC 21). Members-only is attempted only when both the toggle allows it AND a
cookies file is configured (AC 22); the toggle defaults to skip (AC 23). Absent
`availability` is treated as public (ordinary videos frequently omit it), so the
layer does not over-skip normal content while still failing safe on
*recognized-but-unhandled* restricted tokens. Pure and synchronous — table
covered by `node:test` (AC 20-23).

### Premiere delay — pure poll-and-defer

`shouldDeferPremiere(videoMeta, now)` is a pure `(release_timestamp/live_status,
now) -> boolean`, no persisted per-video timer (restart-safe by construction,
echoing the v1.9.0 poll-and-defer philosophy at `server.js:860-879`):

- `live_status` in `{is_upcoming, is_live}` -> defer.
- `release_timestamp` present and `release_timestamp * 1000 +
  PREMIERE_WINDOW_MS > now` (with `PREMIERE_WINDOW_MS = 2 * 60 * 60 * 1000`) ->
  defer.
- otherwise proceed.

A deferred video is simply not downloaded this cycle (its id never enters the
archive); a later poll re-evaluates the same inputs and picks it up once the
window has elapsed. After a restart the decision is identical from the same
inputs — no state to restore (AC 24-26). Covered by `node:test` with fixed
`now` fixtures.

### Dockerfile — pinned yt-dlp via pip (justified)

Install a **pinned** yt-dlp alongside the existing FFmpeg in the same
`node:22-alpine` image, via `pip`, gated by a build ARG:

```dockerfile
RUN apk add --no-cache ffmpeg python3 py3-pip
ARG YTDLP_VERSION=2025.06.09
RUN pip install --no-cache-dir --break-system-packages "yt-dlp==${YTDLP_VERSION}"
ENV FILETUBE_YTDLP_VERSION=${YTDLP_VERSION}
```

**Why pip over the static binary:** the official `yt-dlp_linux` static binary
is a glibc PyInstaller bundle and does **not** run on Alpine's musl libc
without a `gcompat` shim — an unnecessary compatibility risk. pip on Alpine is
the reliable route: it version-pins cleanly (`yt-dlp==<ver>`), an incremental
bump is a small wheel download (extractors change often — small bumps matter),
FFmpeg (which yt-dlp needs for muxing/audio extraction) is already present, and
it avoids introducing a second base image / variant matrix (aligns with the
"no two-systems" architecture). Cost accepted: `python3 + py3-pip` adds roughly
40-60 MB to the image — acceptable for an opt-in feature and cheaper than a
maintained glibc-compat layer. **No runtime auto-update** (D5): the version is
fixed at build time; bumping = a Dockerfile ARG change + rebuild/pull.
`FILETUBE_YTDLP_VERSION` is recorded in the image ENV for display/logging; the
running server never self-updates.

### `/subscriptions` page + client

Served only when enabled (page HTML + controller kept out of `public/`, served
via conditional routes). Lean vanilla-JS controller (`lib/ytdlp/client/
subscriptions.js`, per CONTRIBUTING's per-page-script convention): a list of
subscriptions showing name / format / quality / last-checked / status; an add
form (URL + audio-vs-video + optional quality); per-row delete and re-pull-one
buttons; a re-pull-all button; a members-only toggle bound to
`db.ytdlp.allowMembersOnly`. No queue visualization, no per-video format
picker, no progress bars (out of scope). Linked from the Settings surface via
the `common.js` capability-probe injection (D4). (FR7, AC 32-33)

### Pure helper inventory (unit-testable without a real binary or network)

| Helper (signature) | Purpose | `node:test` cases | AC |
|--------------------|---------|-------------------|----|
| `parseYtdlpConfig(env) -> config` | defensive parse of the 5 ENV vars | off-by-default; truthy-only enable; invalid `pollMinutes` -> default; paths passthrough | 7, 9 |
| `isEnabled(config) -> bool` | pure gate | true only for affirmative flag | 7 |
| `validateChannelUrl(raw) -> {ok,url}` | allowlist + normalize | accept valid channel/@handle/playlist shapes; reject non-YouTube, non-http, leading `-`, metachar URLs | 29 |
| `buildYtdlpListArgs(sub,cfg) -> string[]` | metadata-listing argv | array shape; `--` before URL; no shell chars | 27 |
| `buildYtdlpDownloadArgs(sub,cfg,ctx) -> string[]` | download argv | audio vs video; quality default `best`; `--download-archive`; `--cookies` only when present; `-o` confined; `--` before URL | 27 |
| `sanitizeChannelName(name) -> string` | subfolder-safe name | strips `/`, `..`, control chars | 30 |
| `resolveChannelDir(root,sub) -> path` | path confinement | rejects `../`, absolute, separator tricks; confines to root | 30 |
| `shouldSkip(meta,opts) -> {skip,reason}` | members/restricted rules | table of public/members/restricted; fail-safe unknown -> skip; toggle+cookies gating | 20-23 |
| `shouldDeferPremiere(meta,now) -> bool` | premiere poll-and-defer | in-window -> defer; elapsed -> proceed; pure of `(ts,now)` | 24-26 |
| `isArchived(archiveText,extractor,id) -> bool` | dedup pre-check | archived id -> skip; new id -> proceed | 18 |
| `parseYtdlpVideoList(stdout) -> meta[]` | parse `--dump-json` output | NDJSON parse; tolerates blank/garbage lines | 18-26 support |
| `deriveDisplayName(channelMeta) -> string` | name at add-time | fallback when metadata missing | residual |
| `redactArgs(args) -> string[]` | log hygiene | `--cookies <path>` redacted | 31 |

The process boundary (`spawnYtdlp`) is exercised by a **spy/mock**
`[INTEGRATION]` test that asserts `execFile`/`spawn` is called with an array and
never `shell: true` for a metacharacter-laden URL (AC 28), and that no cookies
path appears in captured stdout/stderr (AC 31). Real-binary/network paths stay
out of the automated suite, mirroring the FFmpeg policy.

### Alternatives considered

- **Standalone sidecar service (MeTube-style):** rejected — reintroduces the
  two-systems / orphaned-records problem the architecture explicitly avoids,
  and duplicates config/persistence. The in-process dormant module keeps one
  source of truth (`db.json`) and one delete semantics.
- **Static `yt-dlp_linux` binary instead of pip:** rejected — glibc/musl
  incompatibility on the Alpine base (would need a `gcompat` shim); pip pins and
  bumps more cleanly and reuses the already-present FFmpeg. (See Dockerfile.)
- **Serving the page from `public/` with a CSS/JS `hidden` class when
  disabled:** rejected — violates D4's "structurally absent, not CSS-hidden";
  keeping the assets out of `public/` behind conditional routes makes "disabled
  == 404" provable.
- **A new top-level `db.settings` key for the members-only toggle:** rejected in
  favor of `db.ytdlp.allowMembersOnly` — keeps every module-owned field in one
  removable namespace and leaves core `DEFAULT_SETTINGS`/`loadDatabase`
  untouched (stronger byte-identical-when-disabled guarantee).
- **Downloading everything and letting yt-dlp's own `--match-filter` handle
  members/premieres:** rejected — the spec requires isolated, unit-testable
  pure JS skip/defer decisions (FR5/FR6); the two-phase list-then-download keeps
  that logic in `node:test`-covered helpers.

### Risks and mitigations

- **Risk:** a future core `loadDatabase` backfill or a test asserting exact db
  shape breaks because of `db.ytdlp`. -> **Mitigation:** the module never
  touches core `loadDatabase`; `db.ytdlp` is created lazily inside the module's
  own `updateDatabase` mutators, so the disabled path writes nothing new.
- **Risk:** yt-dlp metadata field names drift (`availability`, `live_status`).
  -> **Mitigation:** `shouldSkip` fails safe on unrecognized tokens (skip), and
  the rule table is the single place to update (FR5).
- **Risk:** a long download blocks the event loop or holds the db lock. ->
  **Mitigation:** spawns are async child processes awaited outside the lock;
  only the tiny status write re-enters `updateDatabase`.
- **Risk:** command injection / path traversal via a crafted subscription URL or
  channel name. -> **Mitigation:** arg-array spawn (no shell), URL allowlist,
  `--` separator, `resolveChannelDir` confinement — all unit-tested; full
  two-reviewer gate.
- **Risk:** enabled but binary missing crashes or wedges. -> **Mitigation:**
  `checkYtdlpAvailable` degrades gracefully (log, don't arm, clear error
  status).

### Performance impact

No expected impact on any RELIABILITY.md budget when disabled (byte-identical,
zero new routes/timers/spawns). When enabled, the poll is a `.unref()`'d
interval that spawns child processes sequentially (one channel at a time,
mirroring the single-worker transcode gate) so it never floods a home server;
downloads run outside the db lock so they do not affect the serialized-writer
latency. The added indexing load is the existing scanner's, unchanged.

## Task breakdown

Proposed by the principal engineer (the engineering-manager finalizes into
state). Independently committable, each ships with its own tests; ordered so the
dormant/config foundation lands first and the security-critical invocation is
its own reviewable unit.

- **T1 — Config + dormant wiring + timer accessor.** `lib/ytdlp/config.js`
  (`parseYtdlpConfig`/`isEnabled`), the `registerRoutes`/`startBackground`
  skeleton (all guarded by `isEnabled`), `armYtdlpTimer`/`currentYtdlpPollTimer`,
  and the `server.js` wiring calls + exports. Tests: require-is-side-effect-free
  (AC 4), disabled = 404 / no timer, same-process on/off toggle (AC 1-2, 8),
  defensive ENV parse (AC 7, 9), and the full 241-suite still green + lint clean
  (AC 5-6). **The no-op guarantee lands here.**
- **T2 — Persistence + subscriptions CRUD API.** `lib/ytdlp/store.js` +
  `GET/POST/DELETE /api/subscriptions` (+ `/health`), all via `updateDatabase`.
  Tests: well-formed record, quality default `best`, round-trip through
  `db.json`, delete stops polling, 400/404 validation (AC 10-13, 33).
- **T3 — yt-dlp invocation + security surface (HEAVIEST REVIEW LOAD).**
  `lib/ytdlp/url.js`, `lib/ytdlp/args.js`, `lib/ytdlp/process.js`
  (`validateChannelUrl`, `buildYtdlp*Args`, `sanitizeChannelName`,
  `resolveChannelDir`, `spawnYtdlp`, `redactArgs`, `checkYtdlpAvailable`).
  Tests: arg-array shape + no `shell:true` under a metachar URL, URL
  allowlist, path-traversal confinement, cookies never logged/persisted (AC
  27-31). **Flag for the full two-reviewer gate.**
- **T4 — Download loop wiring.** `runPoll`, the poll/re-pull endpoints,
  `rules.js` (`shouldSkip`, `shouldDeferPremiere`, `isArchived`,
  `parseYtdlpVideoList`), download-root/`db.folders` registration + scan
  trigger. Tests (pure + mocked spawn): dedup respected, `shouldSkip` table +
  fail-safe, premiere defer, re-pull-all/one, downloaded files indexed (AC
  14-26). Second-heaviest review load (loop must not wedge / hold the lock).
- **T5 — `/subscriptions` UI page + client + nav injection.** `views/` +
  `client/subscriptions.js` + `common.js` capability probe. Tests/manual: page
  absent when disabled (AC 3), full UI flow (AC 32).
- **T6 — Dockerfile + docs.** Pinned pip install (D5), `.env.example` + README
  for all five ENV vars (AC 34).

## Progress log

- 2026-07-05 — Discovery stage complete (product-manager). Requirements and
  acceptance criteria drafted from `docs/exec-plans/future/yt-dlp-integration-module.md`
  and the decided architecture in `.state/feature-state.json`. 34 tagged
  acceptance criteria across 8 requirement groups plus security; 5 open
  questions framed with recommended defaults for Dean.

## Decision log

- 2026-07-05 — Confirmed (from prior architecture decisions, not relitigated
  here): in-process dormant module, not a standalone service; `db.json` via
  `updateDatabase`; `--download-archive` for dedup; poll-and-defer for
  premieres; isolated fail-safe `shouldSkip` for members-only; cookies-file-only
  auth.
- 2026-07-05 — Open, pending Dean's confirmation (see Open Questions above):
  exact ENV param set/names, UI placement (dedicated page recommended),
  download folder layout + delete-vs-archive semantics, and Dockerfile
  bundling strategy.

## T4 Fix-Round Design Note

Scope: a narrow, mid-implementation design decision for the T4 fix round after
the first two-reviewer gate returned CHANGES REQUESTED. This note decides the
**C1 download-scoping mechanism** and reconciles **C3 + C7** into one
folder-registration approach. C2/C4/C5/C6 and the low/tech-debt tail are
localized and get implementation directives only. This is NOT a module
re-design — the parts both reviewers confirmed solid are listed under
"Leave intact" and must not be churned.

### C1 — download-scoping mechanism: per-survivor watch URLs (option 1, NO divergence)

**Decision:** adopt **option 1 (per-survivor `watch?v=<id>` targets)**, exactly
as recommended. No divergence from the coordinator/EM recommendation. The JS
filters already compute the survivor set; the fix makes that set the *literal
argument list* handed to the download child, so skip/defer become structurally
binding on yt-dlp instead of advisory. Option 2 (`--match-filter`) is rejected
(two sources of truth — the filter expression would have to mirror `shouldSkip`/
`shouldDeferPremiere` exactly or silently drift, and it is still a channel-wide
crawl). Option 3 (`--playlist-items` by index) is rejected (indices shift
between the list and download passes — fragile).

**Why this closes both confirmed breaches structurally:**

- **(a) premiere/live hang:** a deferred `is_live`/`is_upcoming` id is never in
  the target list, so the download child is never asked to fetch it → no 60-min
  livestream capture → no SIGKILL → no per-cycle recurrence → the sequential
  poll loop no longer wedges. Poll-and-defer becomes real.
- **(b) members-only bypass (D2):** a `subscriber_only` id that `shouldSkip`
  marks skipped is never in the target list, so even though `cookiesArgs` still
  attaches `--cookies` when the file exists, the download only ever authenticates
  against ids the operator's toggle allowed. The cookies file being present can
  no longer smuggle disabled content in.

**Signature / shape change (the concrete contract for the SDE):**

- `buildYtdlpDownloadArgs(sub, config)` becomes
  `buildYtdlpDownloadArgs(sub, config, targetIds)` where `targetIds` is a
  `string[]` of video ids. It no longer places `sub.channelUrl` as the
  positional; instead it maps each id through a new safe watch-URL builder and
  places **all** resulting URLs (spread) after the `--` separator. Drop the
  `requireValidUrl(sub.channelUrl)` call from this builder (the download pass no
  longer uses the channel URL as a target; `resolveChannelDir` still derives the
  per-channel output dir from `sub.name`/`sub.channelUrl` exactly as today).
  `buildYtdlpListArgs` is UNCHANGED — the LIST pass must still enumerate the
  whole channel to get the metadata that feeds the filters.
- `run.runDownload(sub, config)` becomes `run.runDownload(sub, config, targetIds)`
  and forwards `targetIds` into `buildYtdlpDownloadArgs`. Everything else in
  `spawnYtdlpDownload` (SF1 redaction, SF2 timeout, SF3 non-buffering stderr,
  SF7 settled-guard) is unchanged.

**Safe watch-URL construction (preserve the `--` + host-allowlist + id-charset
discipline):**

- The list-pass ids come from yt-dlp `--dump-json` (`video.id`) and are NOT yet
  charset-validated by `url.js`. Re-assert every id against the SAME rule
  `url.js` already applies to `?v=`/`?list=` params — `/^[A-Za-z0-9_-]+$/`,
  length `1..64` (`MAX_ID_PARAM_LENGTH`). Single-source that constant/predicate:
  export a small `isSafeVideoId(id)` from `url.js` (reuse the existing
  `isSafeIdParam` predicate + `ID_PARAM_PATTERN` + `MAX_ID_PARAM_LENGTH`; do not
  duplicate the regex) and a `buildWatchUrl(id)` that returns
  `https://www.youtube.com/watch?v=<id>` only when `isSafeVideoId(id)` and
  `null` otherwise.
- `buildYtdlpDownloadArgs` maps `targetIds` → `buildWatchUrl`, dropping any id
  that fails validation (fail-safe: an unsafe id simply never becomes a target).
  If the surviving URL list is empty it throws (a per-subscription failure the
  loop already catches → safe `error:` status → continue), so a truncated/garbage
  arg array can never be produced.
- The constructed URLs are inherently allowlist-conformant by construction (host
  hard-coded to `www.youtube.com`, id charset-bounded, placed after `--`), which
  is *stronger* than routing an arbitrary user URL through the allowlist — the
  host and scheme are ours, only the id is data. The `--` separator + the
  option-injection guard stay exactly as in the current builders.

**Survivor id flow in `runSubscriptionCycle` (`index.js`):**

- Replace the integer `survivorCount` with `const survivorIds = []`.
- In the filter loop, a video only becomes a survivor if it has a usable id:
  `id` non-null AND `url.isSafeVideoId(id)`. A survivor lacking a safe id is
  skipped-and-logged (it cannot be individually targeted — fail-safe, consistent
  with "structurally binding"). Push each surviving `id` into `survivorIds`.
- Replace `if (survivorCount === 0) return 'ok: no new videos'` with the
  `survivorIds.length === 0` guard.
- Call `run.runDownload(sub, config, survivorIds)`.
- Status string becomes `ok: downloaded ${survivorIds.length} new video(s)`.

**Spawn shape: ONE invocation, N positional URLs** (not per-id). Rationale for a
home server: minimum spawn count; yt-dlp accepts multiple positional URLs
natively and, by default (no `--abort-on-error`, which we must not add),
continues to the next URL when one video fails — so failure isolation is
good enough without paying N process spawns. Do NOT add `--abort-on-error`.

**Composition with `--download-archive`:** unchanged and complementary. The
explicit id targets bound *what yt-dlp is asked to consider*; `--download-archive`
still dedups within that set (and remains the single authoritative dedup
mechanism per FR4/D3). The JS `isArchived` pre-check stays a cheap
short-circuit that keeps already-archived ids out of the target list.

**Cookies-toggle resolution (explicit confirmation + C4 fold-in):**

- Confirmed: the `allowMembersOnly` toggle + cookies-usable state gate WHICH ids
  survive (via `shouldSkip`), and option 1 makes that gate binding by never
  targeting a skipped id. A surviving **public** item MAY still receive
  `--cookies` (age-gate/region unlock is legitimate for public content and does
  not violate D2) — `cookiesArgs` is unchanged. Keep the SF1 cookies-redaction
  discipline everywhere.
- **C4 (needs a one-line shape directive, not deep design):** `index.js`'s
  `cookiesConfigured = Boolean(config && config.cookiesFile)` is path-set, while
  `args.cookiesArgs` gates on `fs.existsSync`. Reconcile to ONE shared
  "cookies actually usable" predicate: add `cookiesUsable(config)` to `args.js`
  (the single `fs.existsSync` check, next to `cookiesArgs`, which calls it too)
  and have `index.js` compute `cookiesConfigured = args.cookiesUsable(config)`.
  A set-but-unmounted cookies path then reads as "not usable" everywhere → a
  members-only id is cleanly skipped rather than surviving into a doomed
  download that reports `error`.

### C3 + C7 — reconciled folder-registration: module-owned scan root (option a)

> **Superseded in part by D1 (T4 fix round #2) and then by E1 (T4 fix round #3
> — see the "T4 Fix-Round #2 (T4b) Note" and "T4 Fix-Round #3 (T4c) Note"
> sections near the end of this document).** The mechanism below (a
> module-owned `extraScanRoots()`, independent of `db.folders`) is UNCHANGED
> and still the right design. What changed, twice, is the GATE
> `extraScanRoots` uses to decide whether to contribute `downloadDir`: D1
> made it check whether the directory **exists on disk** instead of whether
> the module is `enabled`; E1 (CONFIRMED regression D1 introduced) changed it
> again to an OR-gate — **`isEnabled(config)` OR `fs.existsSync(downloadDir)`**
> — because D1's `fs.existsSync`-only gate silently dropped `downloadDir` out
> of the scan set whenever an ENABLED module's volume went transiently
> absent (an unmount, a rename, an EACCES), defeating the mount-loss guard
> and reaping already-downloaded content while the module was still on. The
> "disabled ⇒ byte-identical to a never-enabled install" wording immediately
> below described disabling as removing `downloadDir` from the scan set
> unconditionally — that is no longer the current invariant at all. Read the
> invariant in this section as describing only the **fresh-install** case (a
> never-enabled install, where the directory was never created, so all three
> gates — enabled-only, exists-only, and the current OR-gate — are
> behaviorally identical); the "T4 Fix-Round #3 (T4c) Note" section has the
> full, current invariant covering every enabled/disabled × present/absent
> combination.

**Decision:** adopt **option (a)** — the scanner discovers the download tree via
a **module-owned scan root, independent of `db.folders`**. Stop injecting
`downloadDir` into the client-owned `db.folders` entirely. This resolves both
findings at the root cause and is strictly cleaner than defensive
re-registration.

**Invariant (the acceptance target, fresh-install case — see the D1 note above
for the current was-enabled-then-disabled case):** *enabled ⇒ `downloadDir` is
always part of the scan set; never-enabled ⇒ byte-identical to today
(`downloadDir` is absent from the scan set, absent from `GET /api/config`, and
no module write ever touches `db.folders`).*

**Mechanism.** The module exposes a pure `extraScanRoots(config?)` that returns
`[]` when disabled and `[path.resolve(config.downloadDir)]` when enabled (empty
array when `downloadDir` is unset/blank). The core scanner merges it into the
folder set it already iterates, at ONE definition point:

- **`server.js:930`** (inside `runScanDirectories`): change
  `const currentFolders = db.folders || [];` to merge the module roots and
  de-duplicate, e.g.
  `const currentFolders = Array.from(new Set([...(db.folders || []), ...ytdlp.extraScanRoots()]));`.
  This single `currentFolders` value already flows to every place the scanner
  needs it — the scan-root loop (`server.js:945`), the `selectPrunableIds`
  `folders` option (`server.js:1019`), and the `matchRootFolder` root backfill
  (`server.js:1079`) — so `rootFolder` attribution, the mount-loss guard, and
  pruning all stay consistent for downloaded files with no further server.js
  edits. `GET /api/config` (`server.js:1220`) and `POST /api/config`
  (`server.js:1226-1257`) are UNTOUCHED: they read/write only `db.folders`,
  which never contains `downloadDir`, so a config save can no longer evict it
  (closes C3) and the config UI never lists a folder the operator did not add
  (closes C7 (ii)).

**`index.js` changes:**

- Remove the `db.folders` push from `ensureDownloadDirRegistered`
  (`index.js:472-489`). Keep the directory-creation half only: rename to
  `ensureDownloadDir(config)`, which `fs.mkdirSync(downloadDir, {recursive:true})`
  (best-effort, logged on failure) and returns — no `deps`/`updateDatabase`
  dependency, no db write. `startBackground` (`index.js:503`) still calls it when
  enabled (so the tree exists before the first poll), still early-returns when
  disabled.
- Add `extraScanRoots(config = parseYtdlpConfig())` and export it. It is pure
  (an ENV parse + `path.resolve`), side-effect-free, and safe to call from the
  core scan path on every scan (config is ENV-driven and immutable per process).

**Invariants preserved:**

- (i) Never-enabled ⇒ `extraScanRoots()` returns `[]` (the directory was never
  created, so it fails the D1 `fs.existsSync` gate too) ⇒ `currentFolders` is
  exactly `db.folders` ⇒ scanner behavior byte-identical to today; and the
  module never writes `db.folders` on any path (the only former writer is
  removed).
- (ii) `GET /api/config` never surfaces `downloadDir` (it was never in
  `db.folders`).
- (iii) No change to per-folder scanner semantics: a `downloadDir` that is
  transiently unmounted is handled by the existing `fs.existsSync` check at
  `server.js:961` → treated as a `missingRoot` → the mount-loss guard RETAINS its
  metadata for that scan (never evicts, C3's exact failure mode fixed) and it is
  re-scanned next cycle. **(D1 then E1 update, see the "T4 Fix-Round #3 (T4c)
  Note" section below for the current, full invariant):** disabling the module
  no longer unconditionally removes `downloadDir` from the scan set — while the
  directory still holds content, a disabled module's downloads keep being
  scanned (and therefore keep surviving `pruneMissing`) exactly like any other
  configured folder that still exists. **AND** an enabled module always
  contributes `downloadDir`, even while the directory is transiently absent —
  so THAT case (unlike the disabled-and-absent case) DOES land in
  `missingRoots` and IS mount-loss-protected rather than falling through.
- (iv) All writes still go through the single serialized `updateDatabase` writer
  — in fact the module now performs *fewer* `db.folders` writes (zero).

De-dup note: if an operator ALSO manually added the same directory to
`db.folders`, the `new Set` collapses exact-string duplicates; any residual
resolved-vs-unresolved spelling difference is benign (the scan keys files by
path in a `Map`, so the same tree is not double-indexed).

### C2, C5, C6 — implementation directives (localized; no deep design)

- **C2 (archive case-mismatch, `rules.isArchived` + `index.js:145`):** yt-dlp
  writes archive lines as `<ie_key.toLowerCase()> <id>` (e.g. `youtube <id>`),
  but `--dump-json`'s `extractor_key` is TitleCase (`Youtube`). Make `isArchived`
  compare the extractor case-insensitively while keeping the **id exact**: split
  each archive line into `[ext, lineId]`, match on
  `ext.toLowerCase() === safeExtractor.toLowerCase() && lineId === id`. (Or,
  equivalently, prefer the lowercase `video.extractor` over `extractor_key` at
  the call site AND still lowercase in `isArchived` — do both for robustness.)
- **C5 (dropped coalesced re-pull, `index.js` `pollBusy`):** add a single
  `pollRerunRequested` flag mirroring `scanState.rescanRequested` +
  `scheduleDeferredRescan`: a trigger arriving while `pollBusy` sets the flag
  instead of no-op'ing; in `runPoll`'s `finally`, after clearing `pollBusy`, if
  the flag is set, clear it and run ONE more poll (a single unref'd follow-up,
  NOT an unbounded queue). This matters most for `pollMinutes=0` manual-only,
  where a dropped trigger is otherwise lost forever behind a 202.
- **C6 (quarantine skipped on the failure path, `index.js`
  `runSubscriptionCycle`):** the early `return safeErrorStatus(...)` on
  `!downloadResult.ok` skips `quarantineEscapedDownloads`, yet
  `processSubscription` still fires `scanDirectories` unconditionally — so a
  path-escaping symlink from a partial-success-then-nonzero-exit download is
  never unlinked and gets indexed. Run the confinement quarantine on ALL paths
  (success AND failure) BEFORE returning, preserving the "quarantine BEFORE
  `scanDirectories`" invariant. Simplest shape: compute `channelDir` and call
  `quarantineEscapedDownloads` after `runDownload` returns, regardless of
  `downloadResult.ok`, then branch on `ok` for the status string.

### Low / tech-debt tail (fix the cheap ones)

- `quarantineEscapedDownloads` only scans the channel dir's top level; yt-dlp's
  `-o` template is flat (`OUTPUT_TEMPLATE` has no nested dirs), so either recurse
  defensively or assert the flat-output assumption in a comment + the test.
- Scrub the `availability` value out of the `console.log` skip line
  (`index.js:154`) — low-sensitivity but keep the log-hygiene posture uniform.
- Reconcile the documented filter order (this plan's Design says
  `isArchived → shouldSkip → shouldDeferPremiere`) with the code order
  (`isArchived → shouldDeferPremiere → shouldSkip`). Order between skip and defer
  is behaviorally immaterial (both are pure, independent drop decisions); pick
  one and make doc + code agree.
- Add a `MAX_STATUS_LENGTH` bound test (a pathologically long redacted status is
  truncated to `MAX_STATUS_LENGTH` + `...`).
- The `ensureDownloadDirRegistered` raw-string comparison concern is moot under
  option (a) (the `db.folders` push is removed). Instead, `extraScanRoots`
  returns a `path.resolve`-normalized root so the `matchRootFolder` prefix
  comparisons stay consistent.

### Regression tests the fix MUST add (build these; assertions specified)

1. **C1 structural-binding test:** with a channel whose list yields one public
   survivor A + one deferred `is_live` B + one skipped `subscriber_only` C
   (toggle off), assert the DOWNLOAD child's actual target set contains ONLY A's
   `watch?v=` URL — i.e. inspect the positional URLs after `--` in the args
   handed to the spawn boundary (or the `targetIds` passed to `runDownload`), and
   assert B's and C's ids are ABSENT. Do NOT assert merely `downloadCalls === 1`;
   assert on the concrete target arg set.
2. **C2 fixture correction:** change the unrealistic lowercase `'youtube'`
   extractor in `test/integration/ytdlp-poll.test.js:95,140` to the realistic
   TitleCase `'Youtube'` (`extractor_key`), and assert an archived video with a
   TitleCase extractor is now correctly detected as archived (counts toward
   `ok: no new videos`, never a survivor / never re-targeted).
3. **Members-only, cookies-present-but-toggle-off:** a `subscriber_only` video
   with a cookies file that EXISTS on disk (so `cookiesArgs` would attach
   `--cookies`) but `allowMembersOnly === false` — assert that id never enters
   the target set and the download child is never asked to fetch it (proving
   breach (b) is closed structurally, independent of cookies presence).

### Leave intact (confirmed solid by both reviewers — do NOT churn)

- No `updateDatabase` lock held across any `runList`/`runDownload` await
  (`runSubscriptionCycle` touches no mutator; only `processSubscription`'s short
  `setSubscriptionStatus` write re-enters the lock, after the cycle settles).
- No unhandled rejection: `processSubscription`'s try/catch, `runPoll`'s
  `finally` clearing `pollBusy`, and the `.catch` guards on the timer callback +
  the re-pull routes all hold — a failing sub logs (redacted) and the loop
  continues.
- SF1 status redaction: `safeErrorStatus` + `run.redactString` double-pass +
  `MAX_STATUS_LENGTH` bound — the persisted `lastStatus` can never carry the
  cookies path.
- Disabled == provable no-op: `registerRoutes`/`armYtdlpTimer`/`startBackground`
  early-returns, `require()`-time side-effect-freedom, and (**D1 update, see
  below:** for a *never-enabled* install) `extraScanRoots` returning `[]`
  because the download directory was never created.
- The T3 security core: arg-array/no-shell spawn, the `--` option-injection
  separator, `resolveChannelDir`/`realpathUnderChannelDir` path confinement, the
  exact-match host allowlist Set, and userinfo rejection — all unchanged by this
  fix round.

## T4 Fix-Round #2 (T4b) Note

Scope: a second, narrower fix round after the first adversarial `/code-review`
confirmed C1–C7 (above) have no new correctness regressions but surfaced two
seam findings (D1 critical, D2 hygiene) plus a low tail (D3–D7) on the new
code. D1 is a well-specified semantic tweak Dean (product owner) already
ruled on — routed straight to the software-developer, no separate design
session, because it does not touch the fresh-install no-op acceptance
criteria (ACs 1–6 protect the never-enabled install, which stays byte-identical
since a never-created directory still yields `extraScanRoots() === []`).

### D1 — CRITICAL — prune-on-disable data loss (Dean's decision)

> **Superseded by E1 (T4 fix round #3 — see the "T4 Fix-Round #3 (T4c) Note"
> section near the end of this document).** D1's `fs.existsSync`-only gate
> below (dropping `isEnabled(config)` from the decision entirely) turned out
> to introduce its OWN critical regression: an ENABLED module whose download
> volume goes transiently absent lost mount-loss protection and had its
> content reaped. E1 changed the gate to an OR-gate — `isEnabled(config) OR
> fs.existsSync(downloadDir)` — keeping D1's disable-preserves-content
> decision intact while restoring enabled-is-always-protected. The finding
> and decision below are still accurate history; the "Fix" and "Reframed
> invariant" subsections are OUTDATED (superseded) — read the E1 section for
> the current, correct gate and invariant.

**Finding:** the C3+C7 fix made `extraScanRoots` return `[]` whenever the
module is *disabled*, regardless of whether `downloadDir` still held
downloaded content. Since `pruneMissing` defaults ON, a disabled module's
downloads dropped out of the scan set on the very next scan, and the prune
path (server.js: thumbnail cleanup, transcode-sidecar cleanup, `db.progress`
cleanup) reaped every previously-downloaded id — silently destroying already-
downloaded library content the moment an operator turned the feature off. The
existing mount-loss guard only protects *configured-but-unmounted* roots, not
*no-longer-configured* ones, so this fell straight through it.

**Dean's decision:** disabling the module must NOT destroy already-downloaded
library content.

**Fix:** `extraScanRoots(config)` now gates on `fs.existsSync(config.downloadDir)`
instead of `isEnabled(config)`. `parseYtdlpConfig` already computes
`config.downloadDir` regardless of the enabled flag, so the value is available
whether the module is on or off.

**Reframed invariant (replaces the disabled-based one everywhere it was
documented — this file's C3+C7 section above, `docs/ARCHITECTURE.md`, and the
`extraScanRoots` docstring in `lib/ytdlp/index.js`):**

- Never-enabled install ⇒ `ensureDownloadDir` has never run ⇒ the directory
  was never created ⇒ `fs.existsSync` is false ⇒ `[]` ⇒ fully inert. The
  fresh-install no-op guarantee (ACs 1–6) is preserved byte-for-byte: this is
  behaviorally identical to the old disabled-based gate for every install that
  has never been enabled.
- Enabled ⇒ `ensureDownloadDir` created the directory ⇒ `fs.existsSync` is
  true ⇒ `[path.resolve(downloadDir)]` ⇒ scanned, exactly as before.
- Was-enabled, now-disabled, directory still exists with content ⇒
  `fs.existsSync` is still true ⇒ still scanned ⇒ the ids never stop
  surviving the scan in the first place, so `pruneMissing` never reaps them.
  This is the NEW state this reframe protects — it never existed before this
  feature (there is nothing analogous for a manually-configured `db.folders`
  entry, since removing one of those IS an intentional "stop tracking this"
  action; disabling this module is not the same intent).
- Was-enabled, now-disabled, directory removed/never populated ⇒ `[]`, same
  as a never-enabled install.

### D2 — HYGIENE — upgrade-path stale `db.folders` entry

A pre-fix branch (`d0f53a0`) pushed `downloadDir` into `db.folders` via
`updateDatabase`; confirmed dev/test-only (`lib/ytdlp` is absent from every
tag and from `main`, so no shipped release ever wrote it). Fix: an idempotent
migration, `migrateStaleDownloadDirFromFolders(deps, config)`
(`lib/ytdlp/index.js`), wired into `startBackground` (enabled path only,
alongside `ensureDownloadDir`). It reads `db.folders` (a plain, lock-free
`loadDatabase` call) first and only reaches for `updateDatabase` at all if a
string entry actually resolves to `config.downloadDir` — a clean `db.json`
never takes the lock or writes anything, preserving the existing "startBackground
never calls updateDatabase when there's nothing stale" test.

### D3 — re-pull `subId` escalation

`schedulePollRerun` previously always called `runPoll` with no `subId`, so a
re-pull-**one** coalesced during a busy poll re-ran as a full re-pull-**all**.
Fixed by threading the coalesced target through `requestPollRerun`/
`pollRerunTarget`: a specific `subId` request re-runs only that subscription; a
general ("all") request, or a specific request coalescing with a *different*
specific (or general) request, escalates to a full re-pull-all so neither
requested target is ever silently dropped from the single follow-up.

### D4 — bogus-id re-pull during a busy poll

`runPoll`'s subId-existence check now runs BEFORE the busy-coalesce check
(previously the reverse), so an unknown `subId` always resolves to
`{ started: false, reason: 'not-found' }` — mapped to an HTTP 404 by the route
— even while another poll is in flight, instead of arming a spurious
follow-up for a subscription that doesn't exist.

### D5 — `survivorIds` de-duplication

yt-dlp can list the same video under multiple tabs/playlists within one
channel dump; both copies would pass every filter and be pushed into
`survivorIds` twice. `runSubscriptionCycle` now de-dupes via a `Set` before the
id ever reaches the download-arg builder or the persisted count, so
`--download-archive`'s own dedup is no longer the only thing masking a
doubled "downloaded N new video(s)" status and a duplicate `watch?v=<id>`
positional.

### D6 — stop scrubbing `availability` (reverses a round-#1 low-tail item)

`availability` is a non-secret yt-dlp enum (`subscriber_only`/`needs_auth`/
etc.) — scrubbing it added a helper + regex for zero security benefit and hid
the actual skip reason from an operator debugging a skip decision. The
`scrubAvailabilityForLog` helper is removed; the skip log line now includes
`decision.reason` plainly. SF1's cookies-path redaction (`safeErrorStatus` /
`run.redactString`) is untouched and remains the only redaction that matters
in this module.

### D7 — optional tail

- **(a)** a distinct status for "every listed video was rejected as an unsafe
  id" was judged non-trivial and near-impossible to hit with real YouTube ids
  — skipped, per the "only if cheap" instruction.
- **(b)** `runScanDirectories` (server.js) now parses the yt-dlp config once
  per scan and passes it into `extraScanRoots(config)`, rather than relying on
  the function's own default-parameter re-parse. The other half of this nit —
  eliminating the *second* `fs.existsSync` the generic per-folder scan loop
  still performs on the same resolved path — was judged not safely cheap
  (it would require `extraScanRoots` to hand back existence state alongside
  the path, changing its pure `config -> string[]` contract that several
  existing tests call directly) and is tracked in
  `docs/exec-plans/tech-debt-tracker.md` (#6) instead.

### Regression tests added this round

- `test/integration/ytdlp-scan-root.test.js`: the old "disabled ⇒ not
  scanned" case split into "disabled AND dir absent ⇒ not scanned (inert)"
  and a new "disabled AND dir exists with content ⇒ still scanned
  (preserved)"; plus the mandated D1 footgun-closed regression (enable →
  index a downloaded file with a thumbnail + transcode sidecar + `db.progress`
  entry → disable → scan with `pruneMissing` on → all four survive) and a D2
  upgraded-`db.json` migration test (pre-seeded stale `db.folders` entry is
  removed, not surfaced by `GET /api/config`, content still scanned).
- `test/integration/ytdlp-repull-endpoints.test.js`: a direct,
  deterministic test of `migrateStaleDownloadDirFromFolders` (removes a
  matching entry, leaves non-matching folders alone, never calls
  `updateDatabase` when there's nothing stale, idempotent on a second call).
- `test/integration/ytdlp-poll.test.js`: D3 (specific-target re-run;
  specific+general escalates to all), D4 (bogus id during a busy poll returns
  not-found, arms no follow-up), D5 (a duplicated survivor id collapses to one
  download target and a count of one).

### Do not churn (unchanged by this round, T4b)

C1–C7 stay closed exactly as documented above; the T3 security core; the
no-`updateDatabase`-lock-across-a-download invariant; SF1 cookies-path
redaction; the fresh-install disabled no-op (ACs 1–6).

## T4 Fix-Round #3 (T4c) Note

Scope: a third fix round after round #2's two-reviewer gate did NOT converge
clean. QA approved, but the adversarial `/code-review`'s regression finder —
with an independent line-by-line verifier — CONFIRMED a HIGH regression the
round-#2 D1 fix introduced (E1). This reverses the round-2 approval. E1 is
NOT tech-debt cleanup: it reopens the mount-loss data-destruction class the
v1.8.0 guard exists to prevent. E2–E4 are a small tail folded into the same
round because they touch the same file. Routed straight to the
software-developer (no separate PE design session): E1 is a small,
well-specified OR-gate + the missing regression test; E4 is a localized
concurrency simplification; E2/E3 are a log line and documentation.

### E1 — HIGH (CONFIRMED) — D1's exists-gate defeats the mount-loss guard while ENABLED

**Finding:** D1 (round #2) made `extraScanRoots(config)` gate on
`fs.existsSync(config.downloadDir)` **INSTEAD OF** `isEnabled(config)` — so it
returns `[]` whenever the directory is not currently on disk, **even when the
module is enabled**. Consequence (verified end-to-end): module ENABLED but
the download volume TRANSIENTLY absent (an NFS/external-drive unmount, a
rename, or an EACCES that `existsSync` reports as false) → `extraScanRoots`
returns `[]` → `downloadDir` absent from `currentFolders` (`server.js:945`) →
never enters `missingRoots` (built only by iterating `currentFolders`,
`server.js:960-967`) → `selectPrunableIds`'s mount-loss guard
`if (root && missing.has(root)) continue;` (`server.js:444`) never fires for
ids whose `rootFolder === path.resolve(downloadDir)` → with `pruneMissing`
ON (the default, `server.js:42`) every downloaded id is pruned and its
thumbnail (`:1051`), transcode sidecar (`:1061`), and `db.progress` (`:1123`)
are permanently deleted — **while still enabled**. Pre-D1, an enabled module
always contributed `downloadDir` unconditionally, so a transient unmount
landed it in `missingRoots` and the mount-loss guard protected the content;
D1 fixed the disable-reap but reopened the SAME data-loss class via a WORSE
trigger — an infra hiccup, not a deliberate user action. The D1
footgun-closed test never exercised the dir-absent-but-ids-present case, so
it passed green without catching this.

**Fix:** `extraScanRoots(config)` now returns `[path.resolve(downloadDir)]`
when **`isEnabled(config)` OR `fs.existsSync(downloadDir)`**, and `[]`
otherwise (the unset/blank `downloadDir` guard still runs first, unchanged).
This is the FULL, current invariant (replacing every prior version documented
in the C3+C7 and D1 sections above, `docs/ARCHITECTURE.md`, and the
`extraScanRoots` docstring in `lib/ytdlp/index.js`):

- **never-enabled** (disabled, and the directory was never created) ⇒
  `isEnabled` false AND `fs.existsSync` false ⇒ `[]` ⇒ fully inert — the
  optional/additive, byte-identical-when-disabled guarantee holds exactly as
  before.
- **enabled, directory present** ⇒ `isEnabled` true ⇒
  `[path.resolve(downloadDir)]` ⇒ scanned.
- **enabled, directory TRANSIENTLY ABSENT (the fix)** ⇒ `isEnabled` true ⇒
  `[path.resolve(downloadDir)]` **UNCONDITIONALLY**, regardless of
  `fs.existsSync` ⇒ lands in `missingRoots` ⇒ the mount-loss guard PROTECTS
  the content instead of `pruneMissing` reaping it.
- **disabled-was-enabled, directory present** ⇒ `fs.existsSync` true ⇒
  `[path.resolve(downloadDir)]` ⇒ content preserved (Dean's D1 decision,
  unchanged).
- **disabled, directory transiently absent** ⇒ `isEnabled` false AND
  `fs.existsSync` false ⇒ `[]` ⇒ a NARROW, documented edge (see E3) —
  deliberately NOT closed by persisting a "managed root" marker.

**Mandated regression test** (the coverage the D1 test missed):
`test/integration/ytdlp-scan-root.test.js` now has a test that enables the
module, indexes a downloaded file (with a thumbnail, a transcode sidecar, and
a `db.progress` entry) while the download dir genuinely exists, then deletes
the directory itself from disk WHILE REMAINING ENABLED (simulating a
transient unmount) and re-runs the real `server.js` scan with `pruneMissing`
ON — asserting the id, thumbnail, transcode sidecar, and `db.progress` entry
ALL SURVIVE. The pre-existing D1 tests (disabled+present ⇒ scanned;
never-enabled ⇒ inert; the D1 footgun-closed enable→disable→survive
regression) are kept and still pass under the OR-gate.

### E2 — LOW — D2 migration can silently delete an operator-intended `db.folders` entry

**Finding:** `migrateStaleDownloadDirFromFolders` removes ANY `db.folders`
entry whose `path.resolve` equals `downloadDir`, unable to distinguish the
pre-fix stale entry from a path an operator deliberately added. With E1's
fix the content stays protected via `extraScanRoots` regardless of whether
it's also present in `db.folders`, so the compounding prune risk is gone —
but the silent config mutation itself remains possible.

**Fix (minimal, migration logic otherwise unchanged):** the migration already
logged an informational line (`console.log`) exactly when it actually removes
an entry (guarded by the same "nothing to migrate" early return that skips
`updateDatabase` entirely when there's no stale match) — this round adds a
doc-comment note to `migrateStaleDownloadDirFromFolders` making the
can't-distinguish-stale-from-operator-intended caveat explicit, so the
silent-mutation risk is documented, not just logged.

### E3 — DOCUMENT — disabled + transient-unmount narrow edge (known limitation)

When the module is DISABLED and the download volume is SIMULTANEOUSLY
unmounted, `extraScanRoots` returns `[]` and the content is unprotected (the
same reap E1 fixes for the enabled case). This is inherent to deliberately
NOT persisting a "managed root" marker independent of `config.enabled`/
`fs.existsSync` — the module-owned scan-root design (C3+C7) intentionally
derives the scan root purely from ENV config + a disk check, with no third
piece of state. It's a narrow combination (feature off AND volume gone at the
same time). Documented as a known limitation in `docs/ARCHITECTURE.md` and
here; **not** closed with persistence — not worth the added complexity for
this narrow a combination; revisit only if it proves to bite in practice.

### E4 — LOW (folded in — the file was already being touched) — coalesced-rerun lost-target race

**Finding:** `schedulePollRerun` did `if (pollRerunTimer) return;` and its
timer callback captured its target in a CLOSURE argument, while `runPoll`'s
`finally` read-then-cleared `pollRerunTarget` and passed the captured value
into `schedulePollRerun`. If a follow-up timer was ALREADY armed (carrying an
earlier target, say subscription B) when a LATER poll's `finally` tried to
schedule its own follow-up (say for subscription D), the `if (pollRerunTimer)
return;` guard silently declined to schedule anything for D — and because
`pollRerunTarget` had already been cleared to `undefined` by B's `finally`
before its timer even fired, there was no remaining record of D anywhere:
D's request was lost the moment the already-armed timer eventually ran with
only B's closure-captured target. In production, polls do real I/O, so the
`setTimeout(0)` follow-up typically drains during an `await` inside the very
poll that would otherwise race it (self-healing); the loss needs a
near-synchronous poll body to actually manifest.

**Fix (provably-correct-by-construction, mirrors the v1.9.0
`scheduleDeferredRescan` posture):** `pollRerunTarget` is now the SINGLE
SOURCE OF TRUTH the follow-up timer DRAINS at fire time. `schedulePollRerun`
no longer takes a `subId` parameter; its timer callback reads AND clears
`pollRerunTarget` itself (honoring `requestPollRerun`'s
specific/`RERUN_ALL`-escalation coalescing semantics, unchanged) at the
moment it actually fires, rather than using a value captured in a closure
when the timer was armed. `runPoll`'s `finally` no longer reads or clears
`pollRerunTarget` at all — it just calls `schedulePollRerun(deps, config)`
(no target argument) to ensure exactly one follow-up timer is armed whenever
`pollRerunTarget` is not `undefined`. Because `requestPollRerun` (called only
from the busy branch) is now the ONLY writer of `pollRerunTarget`, and the
timer callback is the ONLY reader/clearer, a target recorded AFTER a timer is
already armed lands in the exact same variable that timer will read when it
fires — no interleaving can lose it. The timer stays `.unref()`'d and remains
a single follow-up (still no unbounded queue; a trigger arriving during the
follow-up's own run just re-records a target and gets its own single
follow-up in turn, unchanged).

**Tests added:** `test/integration/ytdlp-poll.test.js` — (a) the same
specific target (subscription B) coalescing TWICE while a poll is busy stays
scoped to B (no escalation to a full re-pull-all merely because it was
requested more than once); (b) a NEW target (subscription D) recorded while a
follow-up timer is ALREADY armed for a different target (subscription B)
still runs — proven by escalating to `RERUN_ALL` (since B ≠ D) and asserting
the eventual single follow-up polls every subscription, not just the timer's
originally-armed target.

### Tech-debt tracked this round (not implemented — see `docs/exec-plans/tech-debt-tracker.md`)

- Set-dedup at `server.js:945` only collapses byte-identical strings — a
  non-canonical manual `db.folders` duplicate of `downloadDir` double-walks
  (perf only; id-level dedup prevents double-indexing).
- D4 (round #2): moving the subId-existence check before the busy-check makes
  each coalesced-while-busy trigger do a synchronous `store.listSubscriptions`
  (`loadDatabase` read) — a main-thread cost under a trigger burst.
- D1 custom-dir-never-enabled edge: a never-enabled install with
  `FILETUBE_YTDLP_DOWNLOAD_DIR` pointed at a pre-existing populated directory
  would get that directory scanned (unusual misconfiguration; low severity).
- (already tracked as #6) the double `fs.existsSync` per scan cycle.

### Do not churn (unchanged by this round, T4c)

C1–C7 and D2–D6 stay as implemented (E2 only ADDS a log-observability note to
D2's migration); the T3 security core (arg-array/no-shell spawn, the `--`
separator, path confinement, the host allowlist, userinfo rejection, the
oversized-URL cap); no `updateDatabase` lock held across any
`runList`/`runDownload` await; SF1 cookies-path redaction; the fresh-install
(never-enabled) no-op.
