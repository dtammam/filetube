# Design — v1.30 Scale Performance + Polish Wave

You are the **principal-engineer**. This is the **Design** stage. Produce a
`## Design` section in the exec plan that resolves the open architectural
decisions below and gives the software-developer an unambiguous blueprint per
lane. You do NOT implement code or tests.

## Read first (authoritative context)

1. `.state/feature-state.json` — feature `v1.30-scale-perf-and-polish`; carries
   binding parameters, lanes, hot-file serialization notes, regression surfaces,
   verified bottleneck file:line evidence (B1-B7), the `acceptance_criteria`
   summary (48 ACs + tunable bounds + PM flags), and the v1.29 process learnings.
2. `docs/exec-plans/active/2026-07-11-v1.30-scale-perf-and-polish.md` — the
   APPROVED plan. Read the whole thing, especially:
   - "Dean's pre-answered parameters" + "Verified bottlenecks" (ground truth — do
     NOT re-derive or relitigate),
   - the PM's `## Requirements` (FR1-FR8 + **Conditional requirement — SQLite (A6)**
     + the **tunable-bounds table** at ~line 266),
   - the PM's `## Acceptance Criteria` (AC1.1-AC8.5 at ~line 283 — your design must
     make every non-on-device AC implementable and testable).
3. `docs/ARCHITECTURE.md` — system architecture; the re-read-merge-on-save
   `updateDatabase` mutex and atomic-rename+fsync discipline are documented there.
   **Update it** if your design introduces new components (in-memory cache layer,
   SQLite store, pagination contract, scan-status/background-scan machinery).
4. `docs/CONTRIBUTING.md` — coding standards (no new runtime deps without
   design-stage justification; SQLite driver is the ONLY sanctioned exception, and
   only if A6 lands). `docs/RELIABILITY.md` — crash-safety + testing invariants
   (node:test; no FFmpeg in the automated suite; integration boots `app` on an
   ephemeral port against an isolated temp `DATA_DIR`).

## The evidence is ground truth — do not re-derive

The bottleneck file:line evidence (B1-B7) came from a read-only perf sweep at
Dean's real ~1300-item scale and is pre-verified. Design decides HOW to fix, not
WHETHER the bottlenecks are real. The PM deliberately left the mechanism SHAPE to
you for several items while locking the observable — honor that split: you pick
the mechanism, but it must satisfy the AC's named observable (call-count
instrumentation, heartbeat proxy, write-count instrumentation, request-during-scan
latency).

## Decisions you MUST resolve in the Design section

For each: state the chosen approach, the components/files it touches, the risk, and
how it satisfies the specific AC(s) — cite AC numbers.

1. **A6 — SQLite decision (the big one).** Dean AUTHORIZED SQLite but named the
   incremental path (A3 in-memory cache + A4 batched writes + A2 cooperative scan)
   as the FIRST candidate. Decide with the O(N²)/parse-storm evidence in hand:
   does A3+A4+A2 clear the FR1/FR3/FR4 bounds at ~1300 (and headroom to ~2000+), or
   is a better-sqlite3-class synchronous-API migration warranted?
   - If you LAND SQLite: specify the driver, the schema, the one-way migration from
     `db.json` WITH a retained backup + a rollback path (hard requirement per the
     PM's conditional SQLite requirement — the app must be re-pointable at the JSON
     store without data loss), and confirm every perf + guard AC applies to the new
     store. Justify the new runtime dep.
   - If you DEFER SQLite: that is acceptable, but **silent deferral is PROHIBITED** —
     file an explicit `docs/exec-plans/tech-debt-tracker.md` entry with named,
     measurable **trigger criteria** (e.g. "revisit if in-memory-cache + batched
     writes still show >50ms event-loop stalls at N>=2000"). Give evidence-based
     justification either way.

2. **A1 — sidecar-detection cache shape (B1 / AC1.3).** The O(N²) is per-file
   `readdirSync` of the file's own directory for subtitle-sidecar detection, run
   unconditionally even for unchanged files. The AC fixes the observable
   (sidecar-detection directory-listing calls must be O(1) per directory, NOT scale
   with file count) and leaves the mechanism to you: per-scan readdir cache keyed by
   directory, OR skip sidecar re-detection for unchanged files (consistent with the
   incremental posture), OR both. Critically (AC1.7): your mechanism must NOT change
   which files are considered changed (the `filePath`+`size` change-detection input
   must be untouched).

3. **A3 — in-memory DB cache + invalidation contract (B3 / AC3.3).** Design the
   cache that lets hot routes (esp. `/thumbnail/:id`, `/video/:id`, `/audio/:id`,
   `/api/videos`, progress, config) stop re-parsing the whole db.json per request.
   The load-bearing question: **how the cache interacts with the existing
   `updateDatabase` re-read-merge-on-save mutex** (documented in ARCHITECTURE.md).
   Specify: when the cache is populated, when it is invalidated/updated on write,
   how concurrency between the mutex's on-disk re-read-merge and the in-memory copy
   is kept coherent (no torn/stale reads), and confirm `loadDatabase`/parse is
   invoked O(1) not per-request (AC3.3's instrumentation hook).

4. **A4 — progress-durability relaxation bounds (B5 / AC4.1-AC4.3).** Design the
   debounce/batch for `POST /api/progress` writes hitting the >=5:1 amplification
   reduction within a <=5s window. Precisely delineate the crash-safety carve-out:
   progress writes MAY relax durability (bounded loss <=5s of watch position, never
   corruption, never loss of anything other than watch position), while EVERY real
   mutation (delete, config, settings, scan final-merge) keeps atomic-write+fsync
   1:1 (AC4.2). Specify what happens to a pending progress batch on
   shutdown/crash and how the on-disk file stays valid JSON (AC4.3).

5. **A5 — pagination contract (B4 / AC3.1-AC3.4).** Choose limit/offset vs cursor
   for `/api/videos`; return a bounded page + total count. Critically specify the
   **interaction with search/sort/filter so those semantics apply across the FULL
   library, not just the first window** (AC3.2: paged full-library sort/filter must
   equal unpaged-then-sliced). Specify the client contract: first-page render only,
   IntersectionObserver sentinel appends exactly one page per trigger (AC3.4),
   preserving the existing renderer's search/sort/filter behavior.

6. **A2 — cooperative/non-blocking scan (B2/B6 / AC2.1-AC2.5).** Design: `POST
   /api/scan` acks <=100ms and returns before scan completes; the walk runs
   cooperatively (async fs / yielding batches) so concurrent requests stay under the
   200ms ceiling; boot scan does not gate first responses (AC2.4); the client polls
   `/api/scan-status` and refreshes the grid **in place (never
   `window.location.reload`** — AC2.3 generalizes the BUG-2 contract to
   scan-completion). Preserve the load-bearing guards while making it cooperative:
   overlap coalescing (AC2.5), mount-loss/prune protection (AC1.4/1.5), incremental
   ffprobe reuse (AC1.6/1.7) must all still fire end-to-end.

7. **B1 — done-edge / dirty-flag design (B7 / AC5.1-AC5.4).** Design so a completed
   one-shot surfaces with NO manual action across all three surfaces: on-home
   (in-place refresh), off-home-return (done-edge NOT consumed unless a refresh
   target succeeded, OR grid marked dirty and reconciled by
   `restoreHomeFromCache`-equivalent), and backgrounded-resume
   (`visibilitychange`/`pageshow` triggers reconcile; a locally-retained
   pending/dirty marker survives the server snapshot dropping the done entry).
   Never `window.location.reload` (AC5.4). Must not regress the v1.29 BUG-2 /
   non-blocking-one-shot contract.

8. **B2 — active-downloads chip reframe (AC6.1-AC6.4).** Design the chip so it
   surfaces only currently-DOWNLOADING jobs (absent when idle/queued-only), tappable
   to a detail view with progress/attribution, and NO stop/dequeue affordance on
   queued rows (explicitly unwanted per Dean). Specify how "actively downloading" is
   distinguished from "queued" in the existing download/queue state.

9. **C1 — type-scale token system (AC7.1/AC7.2).** Design the small token-driven
   type scale (CSS custom properties) per era theme, the harmonization sweep
   approach, and the allowlist for any permitted hardcoded `font-size`. Preserve the
   16px input floor (v1.26.2) and era-theme character. Since C2-C5 build on C1,
   define the tokens first. Also cover, at least in approach: C2 like->Liked
   playlist membership model (membership IS like state — no separate flag; AC7.3),
   C3 deterministic identicon avatar as a pure function of channel name with real
   captured avatar winning (AC7.4), C4 button polish (conservative), C5
   `resolveAvatarSource` wiring for subs rows + settings header (AC7.5).

## Constraints to honor in the design

- Regression surfaces (see state file): v1.29 download semantics (outcome
  classification, run log, retry, AC6.3 argv locks / byte-identical injection
  guard, BUG-2 reload contract) must NOT regress; scan correctness guards must NOT
  weaken; crash-safety atomic-write+fsync stays for real mutations; 16px input
  floor preserved; no service-worker reintroduction; yt-dlp downloads stay serial.
- Hot-file collisions to flag for Tasks-stage serialization: `server.js` + `main.js`
  (Lane A), `common.js` (Lanes B+C), `style.css` (Lane C). Note in your design where
  lanes touch the same file so the EM can serialize tasks.
- No new runtime deps except the sanctioned SQLite driver (only if A6 lands).
- Every non-on-device AC must be implementable AND testable under node:test with no
  FFmpeg. Where an AC names an instrumentation hook (call-count spy, heartbeat
  probe, write-count spy), specify where that hook lives so the developer builds it
  testably.

## Process learnings to carry (from v1.29)

- The fnm node PATH must be exported before any npm AND git-hook command
  (Node v22.23.1 at `~/.local/share/fnm`); the developer/build stages will need it.
- Node 22 is CI-parity; this wave also requires Node 24 green (AC8.2) — flag any
  API you use that differs across 22/24.
- Templated yt-dlp reason text is never an identity key (relevant if B1/B2 touch
  download-state identity).

## Deliverable from you

- `## Design` section appended to the exec plan: per-decision approach + files
  touched + risks + alternatives-considered + AC mapping; an explicit A6
  SQLite verdict (with justification, and a tech-debt tracker entry if deferred);
  and a lane/hot-file collision note for the Tasks stage.
- `docs/ARCHITECTURE.md` updated if new components are introduced.
- If A6 is deferred: the `docs/exec-plans/tech-debt-tracker.md` entry with trigger
  criteria (silent deferral prohibited).
- A short report back: the A6 verdict + rationale, any bound you retuned (with the
  mechanism still locked), and any decision you want the EM to confirm before Tasks.
- Do NOT write application code or tests.

When done, return to the EM session and run `/prep-em-tasks`.
