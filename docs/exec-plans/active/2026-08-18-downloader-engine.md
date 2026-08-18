# Downloader engine channel selector (bundled / stable / nightly at runtime)

Status: ACTIVE (implementing). Owner: main session. Target: v1.146.0, FULL two-seat gate (this wave executes downloaded code - never slim).

Dean's ruling (2026-08-18, overturns locked decision D5 in the Dockerfile), verbatim terms:

1. Default channel = bundled (the image's pinned binary). Fresh installs keep
   today's trust posture; stable/nightly are conscious opt-ins.
2. The bundled binary is NEVER removed - permanent fallback.
3. Health gate + auto-revert: every installed engine is probed after install
   (and on later failure); a bad engine auto-reverts to bundled with a bell
   notification. A bad nightly must never leave downloads worse than the
   pulled image.
4. Auto-update daily = opt-in checkbox, DEFAULT OFF. Manual "Update now"
   always available. Bell the result either way ("updated to X" /
   "X failed health check, reverted to bundled").
5. The section shows three versions side by side: bundled, latest stable,
   latest nightly (live read-only PyPI metadata; offline = show bundled and
   skip the check, never block boot).

Intake is DONE (prior session + the ruling above). One framing note, not a
renegotiation: no "Setup -> Downloads" section exists today (the Setup page
has 10 boxes, none named Downloads). The ruling is honored literally by
CREATING a "Downloads" setup box that houses the "Downloader engine" section,
admin-only like the Users box.

## Framing

v1.145 proved D5's cost: stable yt-dlp lags YouTube enforcement by weeks and
the only lever was a full pin-bump release. This wave trades a DISCLOSED slice
of supply-chain posture (runtime pip installs execute whatever yt-dlp
publishes on PyPI) for outage resilience, on Dean's exact terms above. The
bundled default preserves the old posture for anyone who never opts in.

Intent vs active: `channel` is the user's INTENT (bundled/stable/nightly);
`active` is the RESOLVED engine actually spawned. A failed health probe or a
runtime engine-execution failure flips active to bundled (bell + reason)
WITHOUT silently rewriting the user's channel choice; the next successful
update restores active = channel. No thrash loop: reverts never trigger
reinstalls; installs happen only at explicit user action, boot recovery, or
the daily opt-in tick.

## Machine-derived facts (re-verified at every commit)

- `grep -c "cp.spawn('yt-dlp'" lib/ytdlp/run.js` = 2 (run.js:567 list/probe,
  run.js:845 download) - the ONLY yt-dlp spawn sites in the repo.
- `EXPECTED_ROUTE_COUNT = 200` (test/integration/rbac-census.test.js:68).
  This wave adds 3 routes -> prediction: 203.
- `grep -c 'class="reveal-toggle" data-loading' public/setup.html` = 8
  (hard-locked in test/unit/setup-automation-reveal.test.js:60). Prediction
  after T7: UNCHANGED at 8 - the reveal-toggle barrier is exclusively for
  /api/settings-fed controls, and the engine checkbox is fed by the FOREIGN
  /api/ytdlp/engine fetch (the v1.96 partial-render lesson: the box reveals
  whole instead). Bound by joining the reveal test's FOREIGN list.
  [AMENDED in the gate fix round - QA W4: the original plan predicted 8 ->
  9 before the barrier-scoping rule was re-read during T7; the T7 commit
  disclosed the deviation but this doc had not been updated.]
- `grep -c 'data-collapse-key=' public/setup.html` = 11 (lock is >= 8).
  Prediction after T7: 12.
- package.json version = 1.145.0. Suite baseline on main being re-measured
  this session (v1.145 released at 7072/7072 dual-Node); the measured number
  is recorded in the T1 commit body.
- Notification kinds today: 'media' | 'podcast' (lib/auth/store.js:377-388);
  no payload column (insert is (mediaId, createdAt, kind)).
- ytdlp registerRoutes deps bundle does NOT carry requireAdmin today
  (server.js ~16480-16592); startBackground bundle carries neither userStore
  nor pushDelivery (server.js:16863). Both gain additive fields.

## Design (the load-bearing decisions)

**New module `lib/ytdlp/engine.js`** - owns everything below; side-effect-free
require, injectable spawn (the run.js `require('child_process')` deref
pattern) and injectable PyPI fetch (`deps.fetchPypiImpl ||` default, the
podcasts `fetchFeedImpl` precedent).

- **Disk layout** (runlog/pending/faillog pattern - module joins its own
  paths, never resolves DATA_DIR): `<DATA_DIR>/ytdlp-engine/state.json`
  (atomic temp+rename writes, defensive reads that never throw) and
  `<DATA_DIR>/ytdlp-engine/venv/` (ONE venv, reused across channels and
  versions - bounded disk; `pip install --no-cache-dir` so no wheel cache
  growth; switching channel reinstalls in place).
- **State shape**: `{ channel, autoUpdate, installed: { version, channel,
  installedAt } | null, active: 'bundled' | 'venv', lastCheck, lastResult,
  revert: { fromVersion, reason, at } | null }`.
- **Binary resolution seam**: `engine.activeBinaryPath()` returns the venv
  binary when active === 'venv' and it exists, else the literal 'yt-dlp'.
  run.js calls it at BOTH spawn sites. Uninitialized module = 'yt-dlp', so
  every existing test asserting `cmd === 'yt-dlp'` stays meaningful and
  green by default.
- **Version normalization**: PyPI spells 2026.8.17.73947.dev0; the binary
  self-reports 2026.08.17.073947. Comparator parses numeric segments,
  drops the devN suffix, compares numeric tuples - NEVER string-compares.
  "Update available" = tuple(latest) > tuple(installed-or-bundled). The
  sticky-true bug class from the brief dies here, property-tested both ways.
- **PyPI metadata**: GET https://pypi.org/pypi/yt-dlp/json (host pinned,
  https only, short timeout, response size cap, TTL cache ~30 min). Latest
  stable = max non-dev release key; latest nightly = max dev release key,
  ranked by the SAME numeric-tuple comparator. Offline/malformed = nulls,
  bundled row still renders, boot never blocks (term 5).
- **Install runner** (always inside runExclusive, meta {kind:'engine'} - a
  swap can never race a gated spawn): validate the target version against a
  strict charset regex BEFORE it touches an argv (PyPI-supplied strings are
  untrusted input to pip); `python3 -m venv --clear` then
  `<venv>/bin/pip install --no-cache-dir --disable-pip-version-check
  yt-dlp==<version>`; if venv creation fails or lacks pip (Alpine ensurepip
  uncertainty - no docker on the dev box to verify, defense-in-depth
  instead), fall back to `python3 -m venv --without-pip` + system
  `pip --python <venv>/bin/python install ...`; every spawn timed out and
  killed on stall; NO shell:true anywhere. python3/pip absent (bare metal)
  = supported:false with an honest message, feature degrades, boot fine.
- **Health probe** (the gate for activation): spawn `<venv-bin> --version`,
  require ok AND normalized-equal to the requested version. Probe pass =
  activate (flip active, persist, force-refresh the ytdlp version cache).
  Probe fail = keep/revert active=bundled, bell, never activate.
- **Later-failure auto-revert**: run.js reports spawn-level failures of a
  venv-active binary (ENOENT/EACCES spawn error, or a Python-traceback
  stderr signature) to engine.reportEngineFailure() -> revert to bundled +
  bell. Ordinary download failures (403s, video unavailable, timeouts) NEVER
  revert - that is the thrash-loop surface, closed by design.
- **Boot recovery**: startBackground asks engine to reconcile - if channel
  wants venv but the venv binary is missing/corrupt, active=bundled
  immediately and an async runExclusive reinstall is scheduled (PyPI down =
  stays bundled, retried by the daily tick or manual update; boot never
  blocks).
- **Daily tick**: engine-owned hourly unref'd timer (armScanTimer pattern +
  test accessor), fires the update flow only when autoUpdate && channel !==
  'bundled' && 24h elapsed since lastCheck. Bell either way.
- **Bell events**: new notification kind 'engine', id-encoded payload
  `engine:<event>:<version>` (no schema bump; replace-on-same-id dedupes
  repeats), rendered by a dedicated branch in GET /api/notifications,
  VISIBLE TO ADMINS ONLY - both the list AND the badge count (a member
  badge must never tick for an engine event - phantom-badge class). Web
  push NOT sent for engine events (bell-only; disclosed).
- **Routes** (ytdlp module, requireAdmin newly injected into its deps):
  - GET /api/ytdlp/engine - status: channel, active, versions (bundled +
    PyPI stable/nightly + installed), autoUpdate, busy/queued, supported,
    lastResult/revert. Admin-only.
  - POST /api/ytdlp/engine - {channel?, autoUpdate?}; channel change to
    stable/nightly queues an install job; to bundled just flips active.
    Admin-only, forcing net.
  - POST /api/ytdlp/engine/update - "Update now". Admin-only, forcing net.
  Install jobs are async: POST returns the queued/installing status, the UI
  polls GET.
- **About/Stats**: /api/stats ytdlp block gains channel+source; the Stats
  About row renders "version (channel)" - the ACTIVE engine, term-of-ruling,
  not the image ENV.
- **Dockerfile**: the D5 pin block is REWRITTEN - bundled pin = default and
  permanent fallback, runtime channel selector exists, pin bump cadence
  unchanged.

## Tasks (small, independently green, in order)

- **T1 - engine core (pure).** lib/ytdlp/engine.js: paths, state
  load/save, version normalize/compare, PyPI JSON parse + channel ranking,
  status assembly. Unit tests incl. normalization property tests both
  directions and malformed-state/JSON defense.
- **T2 - install/probe runner.** venv create + fallback chain, pip install,
  health probe, activation flip, revert transitions, version-charset
  validation, timeouts. Unit tests with injected spawn (success, probe
  mismatch, venv-without-pip fallback, pip failure, stall kill, python3
  absent).
- **T3 - spawn seam + failure hook.** run.js: both spawn sites resolve via
  engine.activeBinaryPath(); venv-active spawn failures report to
  engine.reportEngineFailure(); index.js force-refreshes the version cache
  on activation. Integration: swap changes the spawned cmd; spawn-failure
  reverts + bells; a 403-style download failure does NOT revert.
- **T4 - routes + RBAC.** The three routes, requireAdmin injected,
  runExclusive job wiring, forcing-net CLASSIFICATION + VISIBILITY entries,
  EXPECTED_ROUTE_COUNT 200 -> 203. Integration: flag-less member 403s
  first-line; install queues behind a gated job.
- **T5 - bell kind 'engine'.** store validation + kind, admin-only list
  branch + badge count, client row rendering. Tests: member badge/list
  never see engine rows; replace-on-same-id; malformed engine ids dropped.
- **T6 - boot + daily tick.** initEngine threading (both deps bundles,
  additive), boot reconcile/reinstall, hourly unref'd timer + accessor.
  Tests: boot with missing venv stays bundled + schedules; timer disarmed
  by default; tick respects the 24h ledger and the opt-in.
- **T7 - Setup UI.** New "Downloads" setup box (admin-only, collapse key),
  three versions side by side, channel radios, auto-update checkbox (a
  FOREIGN-fetch control - NO /api/settings reveal barrier, count lock stays
  8; amended per QA W4), Update now button, busy polling, token-clean CSS.
- **T8 - About/Stats surface.** /api/stats + stats.js render "version
  (channel)".
- **T9 - Dockerfile rewrite + docs.** Pin block, README supply-chain
  disclosure, docs/CONFIGURATION.md section, ROADMAP prep.

## Named attack surfaces (the adversarial seat's brief)

1. RCE-adjacency: the engine routes cause pip to execute; admin gating must
   be first-line on all three; forcing-net membership verified by mutation.
2. Binary swap racing an in-flight download - FIFO gate binding: prove a
   swap queued behind a 3h download cannot touch the binary mid-spawn. Also
   the UNGATED version-cache probe racing an in-place pip upgrade (bounded,
   benign - verify the bound holds).
3. Health-probe false positive: version fine, extraction broken - probe is
   version-only BY DESIGN (network probes flake); the later-failure hook is
   the second net. Attack the seam between them: what failure shapes hit
   neither net?
4. Auto-revert thrash: prove reverts never trigger installs; prove the
   daily tick cannot flap install/revert/install unattended.
5. PyPI as hostile input: malformed/huge JSON, version strings crafted to
   smuggle argv into pip, dev-suffix trickery breaking the comparator.
6. Version normalization: "update available" perpetually true/false across
   the two spellings; nightly-vs-stable tuple ranking at year boundaries.
7. Venv corrupt at boot; python3 half-present (venv works, pip missing);
   state.json truncated/garbage.
8. Disk growth: repeated channel flips and daily updates must not grow
   DATA_DIR unboundedly.
9. Notification leakage: member badge/list/push seeing engine events;
   engine ids injected via a crafted admin backup restore.
10. The kill scenario (data-loss framing): a bad nightly mid-download-queue
    must leave every queued item downloadable by bundled afterwards - never
    a wedged gate, never a lost pending one-shot.

## Risks / disclosed

- Alpine venv/ensurepip behavior is unverified on this dev box (no docker);
  the fallback chain covers it and Dean's device probe (switch to stable,
  watch it install) is the empirical check.
- Engine bells ride the existing bell feature gate (yt-dlp enabled + >=1
  subscription + bell not disabled); with the bell off, results are visible
  only in the Setup section status line.
- No web push for engine events (bell-only this wave).
- The supply-chain trade is disclosed in ROADMAP + README per the ruling.

## Stop

All terms 1-5 implemented and tested; forcing net + censuses green; FULL
two-seat gate (QA + adversarial, attack surfaces above in the brief) both
APPROVE; dual-Node suites sequential and verbatim; ceremony with ledger
entry in pure user language; branch hygiene after tag. Release as v1.146.0.
Gate: FULL (executes downloaded code).
