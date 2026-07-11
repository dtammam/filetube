# Principal Engineer — Design: v1.29 Downloads Reliability Wave

You are the Principal Engineer for the **v1.29 Downloads Reliability Wave**. This
is a Design-stage task. You have NO shared context with the orchestrator —
everything you need is referenced below. Do NOT write application code or tests.
Your deliverable is a **`## Design` section appended to the exec plan** that a
task-breakdown and then implementation can be built from directly.

## Authorization status

Dean APPROVED the plan (2026-07-11) and authorized a full autonomous run to
release v1.29.0. Discovery is complete: the product-manager appended
`## Requirements` (33 items, tagged `[UNIT]`/`[INTEGRATION]`/`[MANUAL]`, anchors
re-verified against the tree) and `## Acceptance criteria` (27 AC + 4 AC-FM
failure-masking items) to the exec plan. Scope is settled — your job is the
technical HOW, not re-scoping.

## Read first (in this order)

1. **The exec plan (source of truth):**
   `docs/exec-plans/active/2026-07-11-v1.29-downloads-reliability.md`
   — read the whole thing: Goal, verified root causes, In/Out scope, Constraints,
   the 7 "done" deliverables, `## Requirements` (line ~147), and
   `## Acceptance criteria` (line ~337) incl. the AC-FM failure-masking items.
2. `.state/feature-state.json` — owned vs off-limits paths, constraints,
   `key_anchors` (verified file:line seams), `tech_debt_in_reach`,
   `pm_flags_for_design`.
3. `docs/ARCHITECTURE.md` — the `lib/ytdlp/` module section (spawn posture,
   disabled-module inertness, `db.ytdlp` persistence, `--download-archive`
   dedup, activity map). **Update this file** if your design introduces a new
   durable component (the JSONL run log) or changes the module's contract.
4. `docs/CONTRIBUTING.md` (Node 22, CommonJS, node:test, textContent, no new
   runtime deps, 0-warning lint) and `docs/RELIABILITY.md` (error-handling /
   logging invariants — relevant to the run log and status surfacing).
5. `docs/ui-research-2026-07.md` §5 — the corner-chip / active-download status
   brief that T2 (non-blocking one-shot) and T4 (history view) extend.

Ground every design decision against the real code seams in `key_anchors`
(`lib/ytdlp/index.js:1380`/`:1428`/`:2923`, `lib/ytdlp/run.js:901`/`:142`,
`lib/ytdlp/args.js:614-737`/`:252-265`, `lib/ytdlp/failures.js`, `progress.js`,
`public/js/common.js:4560`/`:4611`/`:4632`/`:1942`). Read the actual functions
before designing on top of them.

## What I need back — a `## Design` section covering each task

Append `## Design` to the exec plan (after `## Acceptance criteria`; do not
disturb existing sections). For EACH task, give the concrete approach, the exact
components/functions/files to change, data-model/API impact, and the risks.

### T0 — Diagnostics foundation (prerequisite; do first)
- How `run.js`'s already-captured bounded/redacted `safeStderr` (discarded at
  `run.js:901`) gets promoted into persisted `lastStatus` (R0.1) AND the live
  activity entry (R0.3), staying bounded/sanitized (R0.2, reuse
  `STDERR_TAIL_LIMIT` / `failures.js` `sanitizeReason`/`MAX_REASON_LENGTH`),
  surviving restart in `db.json` (R0.4), without regressing the `cancelled`
  persisted state at `index.js:1406-1408` (R0.8).
- The **JSONL run log**: exact `data/`-relative filename, line schema (timestamp,
  sub/one-shot id, outcome success/partial/failure/cancelled, succeeded/failed
  counts, per-item reasons), the writer's module home, the **cap/rotation
  strategy with a concrete testable number** (R0.5/R0.6), and the disabled-module
  no-op guarantee (no file, no route when `FILETUBE_YTDLP_ENABLED` off — R0.7).

### T3(a) — Partial-success reporting (shared prerequisite; ordered before T1)
- Per-video outcome threading using the existing `failures.js` /
  `mapItemFailuresForActivity` (`index.js:1428`) plumbing so the orchestrator no
  longer treats any non-zero exit as total failure (`index.js:1380`). Define the
  explicit outcome states (success / partial / error) and the status-string
  contract "downloaded N, M failed: [reasons]".
- **CRITICAL — design both failure-masking directions explicitly (AC-FM):**
  - Direction A: an all-items-failed run OR a channel-level failure before any
    item starts (bot-check/429/age-gate/members-only) must resolve to
    `error`/`failed` with the real reason — the partial-success accounting must
    NOT swallow a total failure into a false success/empty result.
  - Direction B: some-succeed-some-fail must resolve to `partial` with failures
    attributed — never whole-channel `failed` (today's bug) and never a silent
    "all good".
  - State how the design makes these two mutually exclusive and testable from
    stderr fixtures (no live network).
- Tech-debt **#17** in reach: skip recording `downloadMeta` for failed ids —
  confirm the natural seam.

### T1 — Retry that retries
- Port the working corner-chip retry logic (`retryOneShot` common.js:4611,
  `retrySubscription` common.js:4632) to: errored `/subscriptions` rows, one-shot
  rows, and the one-off modal error state. Currently the only Re-pull affordance
  is buried at `client/subscriptions.js:1314`.
- Make busy-coalescing VISIBLE ("queued behind current run") instead of the
  silent `{started:false, reason:'busy'}` no-op.
- **PM FLAG 2 — resolve this:** `POST /api/subscriptions/:id/repull`
  (`lib/ytdlp/index.js:2923-2935`) responds **202 BEFORE `runPoll` resolves** and
  never inspects the `{started:false, reason:'busy'}` return. R1.5/AC3.5 assume
  T1 changes this route's response timing/shape. Decide and document the approach
  (e.g. inspect the return and vary the response body/status, or keep 202 but
  return a `queued`/`busy` discriminator the client renders) — and note whether
  any existing caller assumes always-202.
- Tech-debt **#8** in reach: busy-coalescing does a `loadDatabase` per trigger;
  say whether caching the sub-id set for an in-flight poll is cheap here.

### T2 — Non-blocking one-shot + auto-refresh
- On submit, minimize the one-off modal into the existing corner chip
  (`injectDownloadStatusChip` common.js:4560); progress continues there.
- On `done`, refresh the library grid **IN PLACE via `loadLibrary()` — NEVER
  `window.location.reload()`** (the deliberately-disconnected client auto-rescan
  "BUG 2" fix at common.js:1942; reload-under-load hung). Server already
  rescans after `runOneShot`; the client only re-fetches.
- Preserve the v1.28.0 one-shot `text/plain` / URL-normalization behavior (iOS
  Shortcut) — call out the non-regression seam.

### T3(b) — Resilience argv flags — **PM FLAG 4: finalize the exact list**
- Commit the flag set: `--sleep-requests`/`--sleep-interval`, `--retries` with
  backoff, and DECIDE on `--extractor-args youtube:player_client` (plan says
  "consider" — make the call and justify). Give each a safe default and a
  `FILETUBE_YTDLP_*` override name consistent with `lib/ytdlp/config.js`.
- **Preserve byte-identically:** shell:false arg-array spawning and the v1.28.0
  injection-guard posture (host allowlist, `--` separator, FORBIDDEN_CHARS, SF4
  path confinement, decoded-id charset). Show where in the `args.js:614-737`
  builder the flags slot in without disturbing the guard.
- List the new env vars for the README ENV table (T3b delivers deliverable 6).

### T3(c) — Cookie-missing warning
- Loud warning in status + run log when `FILETUBE_YTDLP_COOKIES_FILE` is
  configured but the file is missing (today silently skipped at
  `args.js:252-265`).

### T4 — Download history view
- Render the T0 JSONL run log (capped) on `/subscriptions`: states, timestamps,
  per-item failures. Define the read path (a gated route reading the run log),
  the render seam in the subscriptions view, and textContent-safe rendering.

### Cross-cutting decisions I need from you
- **PM FLAG 1:** confirm `index.js` shorthand = `lib/ytdlp/index.js`.
- **PM FLAG 3 — release-notes artifact:** no `CHANGELOG.md` exists. AC7.4 needs a
  concrete artifact. Recommend where v1.29.0 release notes land (create a
  `CHANGELOG.md`? a section in ROADMAP? the exec plan? the git tag/release body?)
  so the Tasks/close-out stages have a target.
- **Risks & alternatives considered** subsection: at minimum the failure-masking
  hazard (both directions), the repull-route timing change, run-log unbounded
  growth, and any argv change interacting with the injection guard.
- A short **components-to-change table** (file → what changes → which
  requirements/AC it satisfies) to seed the EM's task breakdown.

## Constraints (must hold in the design)
- Node 22 / Express 4 / CommonJS / node:test; ESLint 0 warnings (8 pre-existing
  common.js warnings baseline); **no new runtime deps** expected.
- Disabled-module no-op: `FILETUBE_YTDLP_ENABLED` off → no new routes/UI/DOM/log
  files reachable.
- Serial one-worker `runExclusive` model is OUT of scope to change; progress.js
  is NOT to be rebuilt; no one-spawn-per-video redesign.
- yt-dlp argv changes keep shell:false arg-array spawning + byte-identical
  v1.28.0 injection-guard posture. v1.28.0 one-shot text/plain + URL
  normalization must not regress (iOS Shortcut).
- **OFF-LIMITS:** CSS / typography / design tokens / like-button work — a
  parallel agent session owns typography and is staying off `lib/ytdlp` +
  subscriptions UI; this wave stays off CSS/type tokens. Keep the design inside
  this wave's owned paths (new T4 history rendering should reuse existing
  subscriptions-view/chip structure, not introduce a type/token redesign).

## Wrap-up
- Append `## Design` to the exec plan; update `docs/ARCHITECTURE.md` if the run
  log or any module contract changes.
- Report back to the orchestrator (EM): a summary of the design decisions, your
  answers to the 4 PM flags, the components-to-change table, and any residual
  questions. Do NOT commit (main session owns git). Do NOT break work into tasks
  (that is the EM's next stage) and do NOT start implementation.

The orchestrator will set `artifacts.design`, then run the Tasks stage
(`/prep-em-tasks`).
