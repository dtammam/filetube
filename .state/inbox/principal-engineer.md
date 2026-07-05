# Principal Engineer — Design: Settings: Automation & Cache Housekeeping (v1.8.0)

You are the principal-engineer agent for FileTube. Produce the **technical design**
for a feature whose requirements + acceptance criteria are already written and
approved. You have no shared context with the EM — read the files below.

## Read first
- `docs/exec-plans/active/2026-07-05-settings-automation-cache.md` — the exec plan.
  Requirements, the six items with D1-D4 baked in, the two documented behavior
  changes, and the full acceptance-criteria list ([UNIT]/[MANUAL]/[PROCESS]) are
  already there. **Write your work into its `## Design` section** (currently a
  placeholder near the end). Do NOT change Scope/AC/Decision-log content above it.
- `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md`, `docs/RELIABILITY.md` — architecture,
  coding standards, reliability/testing standards. Consult RELIABILITY.md for the
  performance/invariant expectations before finalizing.
- `server.js` — the whole backend (single monolith). Key seams are cited in the exec
  plan and again below.
- `public/setup.html` — the settings page you'll extend (Appearance box at 115-124 is
  the structural template for the new "Automation & Storage" box).

## Settled — do NOT re-litigate (D1-D4)
D1 auto-scan default 30m (Off/30m/1h/6h/12h/24h; replaces the hardcoded 10-min
`setInterval` at `server.js:989`; overlap-guarded; persisted in db.json). D2
prune-missing default ON with a MANDATORY mount-loss guard that ships regardless of
the toggle. D3 age-retention default 30d keyed off a last-served timestamp we control
(db.json), atime fallback, layered on the size-cap LRU backstop. D4 companions as
scoped. Additive/zero-regression except the two documented behavior changes. Ship
v1.8.0. See the exec plan's Decision log. If — and only if — a genuinely NEW product
decision surfaces (not one of these), stop and flag it for the EM; otherwise design it.

## Resolve these 6 open questions IN THE DESIGN (proposed defaults provided — adopt
them unless you have a concrete, code-grounded reason to deviate; if you deviate, say
why explicitly). These come from the PM's "Open questions / decisions for design":

1. **db.json `settings` shape + back-compat.** Proposed:
   `settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 }`,
   backfilled by `loadDatabase()` exactly like `db.folderSettings` is today
   (`server.js:35, 45-49`) so old db.json files load with zero migration. `cacheMaxBytes: null`
   means "no UI override — defer to `TRANSCODE_CACHE_MAX_BYTES` env var / 5 GB default."
   Specify how the effective cap is resolved (UI value → env var → 5 GB default) and where.
2. **D3 last-served timestamp — where recorded, interaction with Clear-cache-now & startup.**
   Proposed: `db.metadata[id].lastServedAt`, written at the SAME call site as the existing
   in-memory `markServed()` (confirmed at `server.js:935-936`, inside `/video/:id`) and also
   when a transcode is first produced (near the `evictTranscodeCache(..., outPath)` post-produce
   call, `server.js:296`). "Clear cache now" need NOT touch these timestamps (a re-transcode
   re-records them). Note: writing `db.metadata` on every serve means a `loadDatabase`/mutate/
   `saveDatabase` per stream-start — design this to avoid clobbering concurrent db writes and to
   keep the streaming hot path cheap (e.g. only write when the value is stale/changed, mirroring
   `setTranscodeStatus`'s no-clobber pattern at `server.js:207-214`).
3. **Age-sweep scheduling.** Proposed: piggyback the existing `evictTranscodeCache` call sites
   (startup `server.js:983` + post-produce `server.js:296`) — run the age filter immediately
   before the size-cap filter, same cadence, no third timer. Decide whether the age sweep is a
   new exported pure selector (e.g. `selectAgedOut(files, maxAgeMs, now)`) composed with
   `selectEvictions`, or folded in — the AC requires a pure, exported, unit-tested selector
   that never returns `.tmp.mp4` and respects the `recentlyServed`/`RECENT_STREAM_MS` guard.
4. **Clear-cache-now vs in-flight `.tmp.mp4`.** Proposed: do NOT delete `.tmp.mp4` (mirror
   `selectEvictions`'s existing `.tmp.mp4` exclusion, `server.js:104,150`) so a user clear can't
   corrupt an in-progress transcode; also respect the `recentlyServed` protection.
5. **"Scan already running" surfacing.** Proposed: `/api/scan` returns `200 {success:true}` when
   it starts a scan, `409 {error:'scan already in progress'}` when `scanState.scanning` is already
   true; the setup.html handler joins the existing scan-status poll either way rather than erroring.
   Apply the same overlap guard to the automatic-timer path (a fired timer while scanning is a no-op).
6. **UI placement.** Proposed: one "Automation & Storage" `setup-box` with two labeled
   subsections — "Scan" (interval select, last-scanned line, "Scan now") and "Transcode cache"
   (age-retention select, size-cap input, size display, "Clear cache now") — mirroring the
   Appearance box's `h2`/`h3` pattern (`public/setup.html:115-124`).

## Emphasis (highest-risk elements — call these out explicitly in the design)
- **The mount-loss guard is the single highest-risk element and must ship
  UNCONDITIONALLY, independent of the prune toggle.** Today `runScanDirectories`
  (`server.js:436-540`) rebuilds `db.metadata` from scratch (line 450) and drops any id
  not re-scanned; `server.js:442` silently `continue`s past a missing/unmounted root, so
  its entries vanish permanently on the next scan. Design the guard so that if a configured
  root folder fails its existence check, NO entry rooted under it (`matchRootFolder` /
  `item.rootFolder`, `server.js:174-183, 530-531`) is pruned in that pass — even with pruning
  ON. Individual per-file pruning happens only when the root IS present but the specific file
  is gone. Make this a clean, unit-testable seam (the AC demands a hard regression test that
  simulates a missing root and asserts its entries survive regardless of the toggle).
- **D3 age sweep keys off our own `lastServedAt`, atime ONLY as fallback.** The existing
  `evictTranscodeCache` comment (`server.js:135-137`) already warns atime is unreliable under
  relatime/noatime and uses `recentlyServed` as the real guard — the age sweep must not
  reintroduce that trap. A file with a fresh recorded `lastServedAt` must never be aged out even
  if its atime is stale (the AC tests exactly this).
- **Additive / zero-regression except the two documented behavior changes** (10min→30m default;
  prune made safe/controllable). The size-cap eviction path and the `/video/:id` streaming path
  must not change behavior for existing installs. Do not alter `parseCacheCap`/`selectEvictions`
  signatures (existing `test/unit/transcode-cache.test.js` must pass unmodified) — compose, don't
  rewrite. New pure logic goes through `module.exports` (`server.js:1002-1020`) for node:test.

## Deliverable — write into the exec plan's `## Design` section
Cover, concretely (function names, file locations, data shapes — enough that the SDE can
implement task-by-task without re-deriving decisions):
- **Approach** — the overall shape; what's additive vs the two intentional changes.
- **Components to change** — `server.js` (settings load/backfill, the timer refactor + overlap
  guard, the mount-loss guard in the scan/prune path, `lastServedAt` recording, the age-sweep
  selector + composition with size-cap eviction, cache-size + clear-cache + settings API
  endpoints, `module.exports` additions) and `public/setup.html` (the new box + JS wiring); any
  new `test/unit/` and `test/integration/` files.
- **Data model impact** — the additive `db.settings` object and `db.metadata[id].lastServedAt`;
  confirm no existing field is renamed/removed and old db.json loads clean.
- **API changes** — new/changed endpoints (settings GET/POST, cache-size, clear-cache, the
  `/api/scan` 409 behavior) with request/response shapes and status codes (per RELIABILITY.md's
  explicit-status-code convention).
- **Risks & mitigations** — mount-loss guard correctness, db-write contention on the streaming
  hot path, atime-fallback edge cases, back-compat.
- **Alternatives considered** — at least for the age-sweep scheduling and the settings-shape
  choices you resolve above.
- Update `docs/ARCHITECTURE.md` ONLY if you introduce a genuinely new component/decision worth
  recording (e.g. the settings object or the persisted last-served timestamp as an architectural
  note; also worth updating the stale "transcode cache is currently unbounded" note at
  ARCHITECTURE.md:63-64, since Closed tech-debt #1 already capped it).

Then update `.state/feature-state.json`: set `artifacts.design` to the exec plan path and append
a design-complete history entry. Do NOT write application code or the task breakdown — the EM
breaks the design into tasks next (`/prep-em-tasks`).
