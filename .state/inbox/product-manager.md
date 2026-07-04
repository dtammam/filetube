# Discovery: AVI + UX Refinement

You are the **product-manager** agent. Produce an execution plan for the feature
`avi-ux-refinement`. This prompt is self-contained; read the files below to ground
your work, then write the exec plan.

## Read first (context)

- `.state/feature-state.json` — feature metadata, slug `avi-ux-refinement`, stage `discovery`.
- `docs/CONTRIBUTING.md` — project standards, including the "every feature ships with tests" convention. Nothing in your out-of-scope list may conflict with mandatory standards here.
- `docs/ARCHITECTURE.md` and `docs/RELIABILITY.md` — system context and performance budgets/invariants.
- Relevant code you'll be describing changes to:
  - `server.js` — transcode pipeline; writes to `data/transcoded/` and produces `*.tmp.mp4` intermediates.
  - `public/js/common.js` — shared client helpers (target home for a new `getStarRating(id)`).
  - `public/js/main.js` — home page / card rendering.
  - `public/js/watch.js` — watch page; contains the interactive `initRatings` control to be replaced.

## Deliverable

Write a single exec plan to: `docs/exec-plans/active/avi-ux-refinement.md`

When done, update `.state/feature-state.json`: set `artifacts.requirements` and
`artifacts.exec_plan` to `docs/exec-plans/active/avi-ux-refinement.md`.

Do NOT write application code or tests — this is discovery/requirements only.

## The exec plan must cover

### 1. Goal & context
State the three-part scope. Note that part 1 closes a previously-flagged concern:
unbounded disk growth of the transcode cache from watched AVIs. (This concern is not
currently in the tech-debt tracker — call it out so it can be recorded as closed.)

### 2. Requirements + acceptance criteria for the two FIXED items

**Item A — AVI transcode-cache hygiene**
- Size-capped LRU eviction of `data/transcoded/`:
  - Configurable cap, default ~5 GB, env-overridable via `TRANSCODE_CACHE_MAX_BYTES`.
  - Evict least-recently-used files first, keyed by file `atime`/`mtime`.
  - Runs after each successful transcode AND on startup.
- Startup cleanup of orphaned `*.tmp.mp4` intermediates.
- Acceptance criteria must be explicit and verifiable (e.g. cache never exceeds cap after eviction runs; orphaned `.tmp.mp4` removed on boot; env override respected).

**Item B — Deterministic per-item star rating**
- A stable 3–5 star value derived from media id, exposed via a shared helper in
  `public/js/common.js` (e.g. `getStarRating(id)`) — same id always yields the same rating.
- Rendered identically on home cards (`public/js/main.js`) and the watch page.
- Replaces the interactive control in `watch.js` `initRatings` — remove the
  mousemove/click/localStorage rating behavior entirely.
- Acceptance criteria must be explicit (e.g. deterministic output for a given id;
  identical rendering on both surfaces; interactive rating code fully removed).

### 3. Item 3 — UX refinements (evaluate and recommend)
Evaluate these candidate ideas and RECOMMEND include-in-this-branch vs defer, with
brief rationale for each:
- Keyboard shortcuts on the watch page
- "Continue watching" shelf
- Autoplay-next within a folder
- Light/dark theme toggle
- `.srt` subtitle sidecar support

Keep this branch focused. Err toward including only low-risk, high-value tweaks and
deferring the rest. Clearly separate the "included" set (with requirements + acceptance
criteria) from the "deferred" set (with a one-line reason each).

### 4. Testability notes
Per the repo's "every feature ships with tests" convention, specify which items get
`node:test` coverage:
- Eviction logic and `getStarRating` are pure / server-testable — must have unit tests.
- DOM/rendering changes verified via the running app.
Note any test seams needed (e.g. an eviction function that takes a directory + cap so it
can be tested without a full transcode run).

### 5. QA gate note
Add an explicit note that this branch requires a significant QA / code-review pass
(quality-assurance stage + `/code-review`) before acceptance.

## When finished
Report the exec plan path and a short summary of your recommendations for Item 3. The
Engineering Manager will review, then route to the principal-engineer for design.
