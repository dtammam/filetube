# AVI + UX Refinement

## Goal

Stop the transcode cache from growing without bound, make the star rating
honest (deterministic, not a fake interactive control backed by
`localStorage`), and add one small, low-risk UX polish item — without
letting the branch sprawl.

## Scope

Three parts:

1. **AVI transcode-cache hygiene** — size-capped LRU eviction of
   `data/transcoded/`, plus startup cleanup of orphaned `*.tmp.mp4`
   intermediates. This closes a real, previously-observed problem (a 5.6 GB
   pileup from watched AVIs) that is documented as "known tech debt" in
   `docs/ARCHITECTURE.md` (Constraints) but was **never actually logged** in
   `docs/exec-plans/tech-debt-tracker.md` (that file's Active table is
   currently empty). Whoever runs QA/acceptance on this feature should add a
   row to the tracker's **Closed** table once this ships, so the historical
   record reflects that the debt existed and was paid down here — see
   Decision log below.
2. **Deterministic per-item star rating** — replace the fake interactive
   5-star widget (`watch.js` `initRatings`, backed by `localStorage`) and the
   static hardcoded ★★★★★ on home cards with a single shared, deterministic
   3–5 star value per media id, rendered identically in both places.
3. **One small UX refinement** — see evaluation below. Scope intentionally
   kept to a single low-risk addition; everything else is deferred.

## Out of scope

- Any change to the transcode pipeline itself (codec, queue concurrency,
  live-transcode path) beyond adding cache eviction around it.
- Any server-side rating persistence, user accounts, or "real" ratings —
  the rating is a deterministic cosmetic value, not user input.
- "Continue watching" shelf, autoplay-next, `.srt` subtitle support — all
  deferred (see Item 3 below).
- Light/dark theme toggle — **already implemented** in the codebase
  (`initTheme`/`toggleTheme` in `public/js/common.js`, wired to
  `#theme-toggle-btn`, present on `index.html`/`watch.html`/`setup.html`,
  persisted via `localStorage('theme')`, driven by `data-theme` + existing
  CSS light/dark vars). There is no work item here; flagging this so no one
  re-implements it. If the user wants improvements to the *existing* toggle
  (e.g. a visual bug), that's a separate, smaller feature — not in this
  branch.
- Tests requiring a real FFmpeg binary or a headless browser — per
  `docs/RELIABILITY.md`, FFmpeg-dependent paths stay manually verified; this
  repo has no browser test harness, so DOM/interaction changes are verified
  by running the app, per `docs/CONTRIBUTING.md`.

## Constraints

- Node.js 22 LTS (`engines` ≥20), Express 4, vanilla JS frontend — no new
  runtime dependencies for either fixed item.
- `node:test` only; no FFmpeg in the automated suite (per
  `docs/RELIABILITY.md`). Eviction logic must be testable against a plain
  temp directory of dummy files — it must not require invoking FFmpeg.
- Single-process, single-node deployment (`docs/ARCHITECTURE.md`) — no
  external services, no new persistent state beyond what already exists in
  `data/`.
- The existing invariant "never serve a half-written file" (atomic
  `.tmp.mp4` → rename) must not be weakened by eviction — eviction must
  never touch a `.tmp.mp4` in progress.
- The existing invariant "single-worker transcode queue" (`transcodeBusy`)
  is unchanged; eviction is not a competing worker, it runs synchronously
  around transcode completion / startup.
- This branch requires a significant QA / code-review pass before
  acceptance (see QA note below) — do not treat lint+unit-tests-pass as
  sufficient on its own.

## Acceptance criteria

### Item A — AVI transcode-cache hygiene

- [ ] A cap, `TRANSCODE_CACHE_MAX_BYTES`, is read from the environment at
      startup; when unset, the default is 5 GB (5 \* 1024^3 bytes).
- [ ] After eviction runs against a `data/transcoded/` directory whose
      total `.mp4` size exceeds the cap, the resulting total size is `<=`
      the cap.
- [ ] Eviction selects victims in least-recently-used order, keyed by file
      `atime`, falling back to `mtime` when `atime` is unavailable/unreliable
      (e.g. a `noatime`-mounted volume) — oldest-accessed files are deleted
      first, newest-accessed are kept longest.
- [ ] If the cache is already at or under the cap, eviction is a no-op: no
      files are deleted, and no errors are raised.
- [ ] Eviction never deletes a `*.tmp.mp4` file (an in-progress write).
- [ ] Eviction never deletes the file that was just produced by the
      transcode run that triggered this eviction pass.
- [ ] Eviction runs automatically after every successful transcode
      completion (i.e., after the atomic rename to the final `.mp4`), and
      once during server startup — both are real, exercised code paths, not
      just a function that exists unused.
- [ ] On startup, before (or as part of) the first eviction pass, every file
      matching `*.tmp.mp4` in `data/transcoded/` is deleted — these are
      orphans from a killed process and are never valid to keep or count
      against the cap.
- [ ] `TRANSCODE_CACHE_MAX_BYTES` accepts a plain integer byte count and, when
      set, overrides the 5 GB default; an invalid/non-numeric value falls
      back to the default rather than crashing the server on boot.
- [ ] Eviction degrades gracefully per `docs/RELIABILITY.md` error-handling
      conventions: a filesystem error deleting one candidate file is logged
      and does not abort the whole eviction pass or crash the server.

### Item B — Deterministic per-item star rating

- [ ] A shared helper (e.g. `getStarRating(id)`) lives in
      `public/js/common.js` and returns an integer in `{3, 4, 5}`.
- [ ] The same media id always yields the same star value on repeated calls
      (pure function, no randomness, no time-of-day dependence).
- [ ] Home cards (`public/js/main.js`) render this value instead of the
      current hardcoded `★★★★★` / "5 stars" markup.
- [ ] The watch page renders this value for the same media id — and it is
      **the same value** as the home card shows for that id. This is the
      headline acceptance test: pick any item, its star count on the home
      grid and on its own watch page must match.
- [ ] The watch page's star display is read-only: the interactive behavior
      in `watch.js` `initRatings` — `mousemove`/`click` listeners,
      hover-highlight, and the `localStorage` key `rating_${mediaId}` — is
      fully removed, not just disabled. No code path writes or reads a
      `rating_*` `localStorage` key anymore.
- [ ] No dead code left behind: `highlightStars`/`drawStars` (or equivalents)
      are removed if nothing else uses them; if any "Rating: X/5" text label
      is kept, it reflects the deterministic value and is not editable.

## Item 3 — UX refinement: evaluation and recommendation

| Candidate | Recommendation | Rationale |
|---|---|---|
| (a) Keyboard shortcuts on watch page (space / ← / → / f / m) | **Include** | Client-only, confined to `watch.js`; no server change, no new data model, no interaction with the other two fixed items beyond sharing the file. Directly extends the watch page we're already touching. Low risk, clear scope boundary (exactly these 5 keys). |
| (b) "Continue watching" shelf on home | Defer | Real value (progress data already exists in `db.progress`), but it's a new home-page section with its own layout, empty-state, and ordering decisions — bigger than a "refinement." Keep this branch focused; propose as its own feature. |
| (c) Autoplay-next within a folder | Defer | Meaningfully more complex and riskier: needs "next item in folder" resolution, interacts with the lazy-transcode "preparing…" overlay and progress-save timing, and raises UX questions (opt-out, last-item behavior) that need their own discovery. |
| (d) Light/dark theme toggle | N/A — already shipped | Found during discovery: `initTheme`/`toggleTheme` already exist in `public/js/common.js`, wired to `#theme-toggle-btn` on every page, using `data-theme` + the existing CSS vars. Nothing to build here. |
| (e) `.srt` subtitle sidecar support | Defer | Requires new server-side sidecar detection/serving (new route + tests) plus frontend `<track>` wiring and a captions toggle — a full feature, not a small tweak. Keep this branch scoped to cache hygiene + ratings + one small polish item. |

**Included in this branch:**
- (a) Keyboard shortcuts on the watch page.

**Deferred (future):**
- (b) "Continue watching" shelf — propose as a standalone feature; progress data already exists, this is UI/layout work.
- (c) Autoplay-next within a folder — needs its own discovery pass (opt-in/out, edge cases).
- (e) `.srt` subtitle sidecar support — needs its own discovery pass (server route, frontend track element, matching convention).
- (d) is not deferred, it's done — no action needed.

### Acceptance criteria — Item 3 (keyboard shortcuts)

- [ ] On the watch page, `Space` toggles play/pause of the active media
      player.
- [ ] `ArrowRight` / `ArrowLeft` skip forward/backward by the same interval
      the existing skip-forward/skip-back buttons already use (reuse, don't
      reinvent, the existing skip amount).
- [ ] `f` toggles fullscreen on the player.
- [ ] `m` toggles mute.
- [ ] None of these shortcuts fire when focus is inside a text input,
      textarea, or contenteditable element (e.g. the comment box or the
      search input) — typing "space" in a comment must type a space, not
      pause the video.
- [ ] This behavior is scoped to the watch page only; no changes to
      `main.js`/home page behavior.

## Testability plan

Per `docs/CONTRIBUTING.md` ("every feature ships with tests") and
`docs/RELIABILITY.md` (unit tests for pure logic, integration tests for
routes, no FFmpeg in the automated suite):

**Must have `node:test` unit coverage (pure logic):**
- Eviction victim-selection and cap-enforcement logic. This must be
  expressed as a function that takes a directory (or a list of
  file descriptors: path/size/atime) and a byte cap, so it's testable
  against a plain temp dir of dummy files — no FFmpeg, no real transcode
  run needed. Cover: under-cap no-op; over-cap evicts oldest-first down to
  the cap; `.tmp.mp4` files are never selected; ties/edge cases (empty dir,
  single file larger than the cap) don't error or infinite-loop.
- Orphaned `*.tmp.mp4` cleanup, as a function taking a directory: removes
  only `*.tmp.mp4`, leaves valid `.mp4` files and unrelated files alone.
- `TRANSCODE_CACHE_MAX_BYTES` parsing: default when unset, override when
  set to a valid integer, fallback-to-default when set to garbage.
- `getStarRating(id)`: deterministic (same id → same value across repeated
  calls), and output is always one of `{3, 4, 5}` across a representative
  sample of ids (including edge cases like an empty string / very short
  hash-derived id, consistent with how `getMockViews`/`getMockSubCount`
  already handle id-derived determinism in `common.js`).

**Should have integration coverage (`test/integration/`, no FFmpeg needed):**
- Boot the app against an isolated temp `DATA_DIR` pre-seeded with dummy
  files in `data/transcoded/` (some plain `.mp4`, some `*.tmp.mp4`, sized to
  exceed a small test cap) and assert that on boot: orphaned `.tmp.mp4`
  files are gone and total cache size is at or under the cap.

**Verified via the running app (no automated DOM harness in this repo):**
- Home card and watch-page star counts match for the same item (manual
  spot-check across a few ids, since rendering equivalence is a DOM
  concern and this repo has no browser test harness).
- Keyboard shortcuts: space/←/→/f/m behave as specified, and are inert
  while typing in the comment box or search input.
- The interactive rating control is visibly gone from the watch page (no
  hover highlight, no click-to-rate).

## Out of scope / risks

- **Concurrency — eviction vs. the file a user is watching.** Eviction only
  runs right after a transcode completes and once at startup, not on every
  request, so the window is narrow — but it is not zero. A user could be
  mid-stream on a cached MP4 that is also the LRU victim at the moment a
  *different* item finishes transcoding and triggers eviction. This must be
  designed around (e.g., an actively-streamed file naturally has a very
  recent `atime` if read requests touch the file, which would deprioritize
  it for eviction — but this is not a guarantee on all filesystems/mount
  options). Flagging explicitly per the requirement that eviction "must
  never delete the file a user is about to watch" — the principal engineer
  should address this directly in the design, not treat the narrow window
  as acceptable by default.
- **Concurrency — eviction vs. the transcode queue.** The queue is already
  single-worker (`transcodeBusy`); eviction is not a second worker, it runs
  synchronously around a completed job or at boot, before the queue is
  otherwise active. No new concurrency primitive should be needed, but this
  assumption should be validated in design/review.
- **Self-healing already exists, don't duplicate it.** `/video/:id` already
  checks `fs.existsSync` on the cached path at request time (not trusting
  stale `transcodeStatus`), and `reconcileTranscode` already clears a stale
  `'ready'` status when the cached file is missing. Eviction does not need
  new bookkeeping to "un-ready" an item in the db — confirm this remains
  true rather than adding redundant state.
- **Cap edge cases.** A cap smaller than a single transcoded file must not
  cause an infinite loop or repeated crash-and-retry; the cache can end up
  emptied but should never error the server.
- **Removing the interactive rating is an intentional trade-off**, not an
  oversight — users lose the ability to "rate" a video (which never
  persisted anywhere meaningful besides their own browser's
  `localStorage`), in exchange for consistent, non-fake ratings across
  surfaces. This is explicitly what was requested.

## QA note

This branch touches a core reliability path (transcode cache lifecycle) and
removes user-facing interactive behavior (ratings). It requires a
significant QA / code-review pass — the quality-assurance stage plus
`/code-review` — before this feature is accepted as Done. Do not treat
"lint + unit tests pass" as sufficient; the eviction logic in particular
needs deliberate review of the concurrency/race concerns above.

## Technical Design

### Approach

Three independent changes, none of which cross a layer boundary.

1. **AVI cache hygiene (server-side, `server.js`).** Add four small, pure-ish
   helpers next to the existing transcode code and export them for tests:
   `parseCacheCap(raw)`, `selectEvictions(files, maxBytes, keepPath)`,
   `cleanupOrphanTmp(dir)`, and `evictTranscodeCache(maxBytes, justProducedPath)`.
   A new module-level constant `TRANSCODE_CACHE_MAX_BYTES` is parsed once from
   the environment. Eviction is wired into exactly two existing code paths: the
   `processTranscodeQueue()` `close`-handler (code `0` branch, right after the
   atomic `fs.renameSync`) and the startup block under `require.main === module`.
   No change to the queue, the codec args, the `transcodeBusy` gate, the
   `.tmp.mp4` → rename invariant, or `/video/:id`.
2. **Deterministic rating (frontend, `common.js` + `main.js` + `watch.js`).**
   Add a single pure helper `getStarRating(id)` to `public/js/common.js`,
   returning an integer in `{3, 4, 5}`. Both the home card template
   (`renderMediaGrid`) and the watch page render it; the watch page renders it
   read-only. The interactive rating machinery in `watch.js` (`initRatings`,
   `drawStars`, `highlightStars`, the `rating_${mediaId}` localStorage key, and
   the mousemove/click/mouseleave listeners) is deleted.
3. **Watch-page keyboard shortcuts (frontend, `watch.js`).** Extend the single
   pre-existing `document`-level `keydown` handler (watch.js ~L295) — which
   already handles `ArrowLeft`/`ArrowRight` — with `Space`, `f`, and `m`
   branches, reusing the existing `SKIP_SECONDS` and player references.

### Component changes

- **`server.js` — constants (near `TRANSCODE_DIR`, ~L17).** Add
  `const TRANSCODE_CACHE_MAX_BYTES = parseCacheCap(process.env.TRANSCODE_CACHE_MAX_BYTES);`
  (defined after `parseCacheCap` is declared, or hoisted as a function
  declaration so ordering is irrelevant).
- **`server.js` — `parseCacheCap(raw)` (new, pure).** Returns a positive integer
  byte cap. Default `5 * 1024 ** 3` (5 GiB). Logic: if `raw` is nullish/empty →
  default; else `const n = Number(raw)`; if `Number.isInteger(n) && n > 0` →
  `n`, else default. Never throws. Non-numeric or `<= 0` or fractional values
  fall back to the default (the boot-safety requirement).
- **`server.js` — `selectEvictions(files, maxBytes, keepPath)` (new, pure, the
  unit-testable core).** `files` is an array of `{ path, size, atimeMs }`.
  Steps: (a) drop any entry whose `path` ends in `.tmp.mp4` (defensive — the
  wrapper already excludes them); (b) `total = sum(size)` over the remaining
  entries (this includes `keepPath`, which counts toward the cap but is never a
  victim); (c) if `total <= maxBytes` return `[]` (no-op); (d) build the
  candidate list = remaining entries minus the one equal to `keepPath`, sorted
  by `atimeMs` ascending (oldest first), tie-broken by `path` ascending for
  deterministic tests; (e) walk candidates, accumulating freed bytes and
  collecting paths, stopping as soon as `total - freed <= maxBytes` or the
  candidate list is exhausted; (f) return the collected paths. This terminates
  in one pass — no loop can hang, and a single non-evictable file (only
  `keepPath` remaining, or one file larger than the cap) simply leaves the total
  above the cap without error.
- **`server.js` — `evictTranscodeCache(maxBytes, justProducedPath)` (new,
  wrapper, I/O).** Reads `TRANSCODE_DIR`: `fs.readdirSync`, keep names ending
  `.mp4` (this includes `.tmp.mp4`, filtered out by `selectEvictions`; the
  wrapper does not stat/delete them). For each, `fs.statSync` inside try/catch;
  build `{ path, size: st.size, atimeMs: (st.atimeMs > 0 ? st.atimeMs : st.mtimeMs) }`
  — the `atime`→`mtime` fallback for `noatime`/zero-atime volumes. Call
  `selectEvictions(descriptors, maxBytes, justProducedPath)`, then `fs.unlinkSync`
  each returned path inside its own try/catch: a failure to delete one file is
  `console.error`-logged and does not abort the pass or crash (RELIABILITY.md
  graceful-degrade). The whole body is additionally wrapped so a `readdirSync`
  failure (dir missing) logs and returns. Returns the list of deleted paths
  (for logging/tests).
- **`server.js` — `cleanupOrphanTmp(dir)` (new, I/O, testable against a temp
  dir).** `fs.readdirSync(dir)`, for each name ending `.tmp.mp4` call
  `fs.unlinkSync` in a per-file try/catch (log on failure). Leaves `.mp4` and
  unrelated files untouched. Returns the list/count removed. Guarded so a
  missing dir does not throw.
- **`server.js` — `processTranscodeQueue()` close-handler (~L190-198).** In the
  `code === 0` success branch, immediately after
  `fs.renameSync(tmpPath, outPath)` and `setTranscodeStatus(id, 'ready')`, call
  `evictTranscodeCache(TRANSCODE_CACHE_MAX_BYTES, outPath)`. It runs
  synchronously before `transcodeBusy = false; processTranscodeQueue();`, so no
  second transcode is writing during eviction. `outPath` is passed as
  `justProducedPath` so the just-finished file is never evicted.
- **`server.js` — startup block (`require.main === module`, ~L827).** Before
  `scanDirectories()`, call `cleanupOrphanTmp(TRANSCODE_DIR)` then
  `evictTranscodeCache(TRANSCODE_CACHE_MAX_BYTES, null)`. Both are real,
  exercised paths.
- **`server.js` — `module.exports` (~L845).** Add `parseCacheCap`,
  `selectEvictions`, `evictTranscodeCache`, `cleanupOrphanTmp`,
  `TRANSCODE_CACHE_MAX_BYTES`.
- **`public/js/common.js` — `getStarRating(id)` (new, pure).** Char-code sum
  hash mod 3, offset to `{3,4,5}`:
  `const code = String(id).split('').reduce((a, c) => a + c.charCodeAt(0), 0); return (code % 3) + 3;`
  (empty string → `code = 0` → `3`; matches the deterministic style of
  `getMockViews`/`getMockSubCount`). To make it unit-testable under `node:test`,
  common.js needs to be require-safe: (a) guard the top-level
  `document.addEventListener('DOMContentLoaded', ...)` (L131) with
  `if (typeof document !== 'undefined')`; (b) append a CommonJS export shim at
  end of file: `if (typeof module !== 'undefined' && module.exports) { module.exports = { getStarRating }; }`.
  Both are inert in the browser (where `module` is undefined and `document`
  exists) and let the test `require` the file.
- **`public/js/main.js` — `renderMediaGrid` card template (L168).** Replace the
  static
  `<div class="card-rating" title="5 stars" aria-label="Rated 5 out of 5 stars">★★★★★</div>`
  with a computed line: `const stars = getStarRating(item.id);` (computed near
  the other per-item values ~L131) and render
  `<div class="card-rating" title="${stars} stars" aria-label="Rated ${stars} out of 5 stars">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</div>`.
- **`public/js/watch.js` — remove interactive rating.** Delete `initRatings`
  (L477-504), `highlightStars` (L506-516), and `drawStars` (L518-521) entirely.
  Replace the call site at L124 (`initRatings();`) with `renderStarRating();`.
  Add a new read-only `renderStarRating()`:

  ```js
  function renderStarRating() {
    const stars = getStarRating(mediaId);
    starRatingControl.querySelectorAll('.star').forEach(star => {
      star.classList.toggle('active', parseInt(star.dataset.value) <= stars);
    });
    ratingText.textContent = `${stars} / 5`;
  }
  ```

  No `localStorage`, no listeners. `starRatingControl`/`ratingText` element refs
  (L47-48) stay.
- **`public/watch.html` — star markup (L117-124).** Keep the 5 `.star` spans and
  the `#rating-text` span. Change the container `title` from
  `"Rate this video!"` to something non-interactive (e.g. `"Star rating"`), and
  set `#rating-text` initial text to empty/`""` (JS fills it). Remove any CSS
  `cursor: pointer`/hover-highlight affordance if the read-only look warrants it
  (cosmetic, EM's call).
- **`public/js/watch.js` — keyboard handler (extend L295-300).** Extend the
  existing single `keydown` listener; do not add a second one. Broaden the guard
  and add cases:

  ```js
  document.addEventListener('keydown', (e) => {
    const el = document.activeElement;
    const tag = (el && el.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (el && el.isContentEditable)) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); skip(-SKIP_SECONDS); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); skip(SKIP_SECONDS); }
    else if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (mediaPlayer.paused) mediaPlayer.play().catch(() => {}); else mediaPlayer.pause();
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      if (document.fullscreenElement) document.exitFullscreen();
      else if (playerWrapper.requestFullscreen) playerWrapper.requestFullscreen().catch(() => {});
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      mediaPlayer.muted = !mediaPlayer.muted;
    }
  });
  ```

  Arrows keep reusing `SKIP_SECONDS` (15s) — the acceptance criterion is "the
  same interval the existing skip buttons use", so they are intentionally NOT
  changed to a new value. `Space` `preventDefault` stops page scroll; the
  `INPUT`/`TEXTAREA`/`contenteditable` guard keeps typing a space in the comment
  box or search box from toggling playback.

### Data model changes

None. No `db.json` schema change. Eviction relies on the existing self-healing:
`/video/:id` already re-checks `fs.existsSync` on the cached path at request
time, and `reconcileTranscode` already clears a stale `'ready'` status when the
cached file is gone, so an evicted item is transparently re-queued on next
watch. No new bookkeeping field is added.

### API changes

None. No new routes, no changed signatures on existing routes. One new
environment variable, `TRANSCODE_CACHE_MAX_BYTES` (optional; default 5 GiB).

### Alternatives considered

- **Eviction on every `/video/:id` request instead of post-transcode + startup.**
  Rejected: it would put `readdirSync`/`statSync` on the hot streaming path
  (violates the spirit of RELIABILITY.md performance discipline) and widen the
  race against actively-streamed files. Post-transcode + startup is where new
  bytes actually appear, so it is where the cap can be breached — the minimal
  correct trigger set.
- **Track access times in `db.json` instead of relying on filesystem `atime`.**
  Rejected: adds persistent state and write amplification on every stream for a
  problem the filesystem already answers. `atime` (with `mtime` fallback) keeps
  eviction stateless and testable from a plain temp dir of dummy files, matching
  the constraint that the logic must be exercised without FFmpeg.
- **A background timer sweeping the cache periodically.** Rejected: introduces a
  second concurrent actor and timer lifecycle to reason about, for no benefit
  over triggering exactly when the cache grows.

### Risks and mitigations

- **Risk: eviction deletes a file a user is mid-stream on.** → Mitigation
  (layered): (1) the just-produced file is excluded via `keepPath`; (2) an
  actively-streamed file has a very recent `atime` (read requests touch it), so
  LRU ordering deprioritizes it; (3) on POSIX/Linux (the Docker deployment
  target), `unlink` only removes the directory entry — an already-open read
  stream keeps the inode alive and finishes cleanly; a *subsequent* request
  simply 404s and is self-healed by the existing `existsSync` check +
  `reconcileTranscode`. Residual window is narrow and non-fatal. Flagged for the
  mandatory QA/code-review pass.
- **Risk: cap smaller than one transcoded file.** → `selectEvictions` makes a
  single pass and never re-enters; it can empty the cache but never loops or
  errors. Covered by a dedicated unit test.
- **Risk: `atime` unreliable on `noatime` mounts.** → Fallback to `mtime` when
  `atimeMs` is `0`/missing; documented as best-effort LRU.
- **Risk: filesystem error during a delete.** → Per-file try/catch logs and
  continues; the pass never aborts and the server never crashes.
- **Risk: making common.js require-able breaks the browser.** → The two shims
  are guarded on `typeof document`/`typeof module`; both globals behave
  oppositely in the browser vs. node, so each environment takes the correct
  branch. Verified by the fact that `getStarRating` has no DOM dependency.

### Performance impact

No impact on any streaming/scan budget. Eviction adds one `readdirSync` +
`statSync`-per-file pass at two rare moments (after a transcode completes, and
once at boot) — both already off the request hot path and dwarfed by the FFmpeg
run that precedes them. `getStarRating` is O(len(id)) arithmetic run once per
rendered card. No new dependencies, no new persistent I/O per request.

### Test plan (seeds the test stage)

**`node:test` unit — new `test/unit/transcode-cache.test.js`** (set
`process.env.DATA_DIR` to a temp dir before `require('../../server')`, per the
existing pattern; create dummy files under `<DATA_DIR>/transcoded`):

- `parseCacheCap`: unset/empty → `5 * 1024 ** 3`; valid integer string (e.g.
  `'1048576'`) → that number; `'0'` → default; negative → default; `'abc'` →
  default; fractional `'1.5'` → default. Asserts boot never throws on garbage.
- `selectEvictions`: (a) under-cap → `[]`; (b) at exactly cap → `[]`; (c)
  over-cap → deletes oldest-`atime` first, result total `<= cap`; (d) a
  `.tmp.mp4` entry is never selected even when it is the oldest; (e) `keepPath`
  is never selected even when it is the oldest; (f) tie on `atimeMs` →
  deterministic order (secondary sort by path); (g) empty list → `[]` (no
  error); (h) single non-keep file larger than cap → returns that one file (no
  loop); (i) only `keepPath` remaining and it exceeds cap → `[]` (no loop, no
  error).
- `cleanupOrphanTmp`: temp dir with `a.mp4`, `b.tmp.mp4`, `c.txt` → only
  `b.tmp.mp4` removed; `.mp4` and unrelated files survive; missing dir → no
  throw.
- `evictTranscodeCache` (wrapper): seed `<DATA_DIR>/transcoded` with several
  `.mp4` files (mutating `atime` via `fs.utimesSync` to control LRU order) plus
  a `.tmp.mp4`; total exceeds a small cap → after the call, total `<= cap`, the
  `.tmp.mp4` is untouched, and a passed `justProducedPath` survives.

**`node:test` unit — new `test/unit/star-rating.test.js`** (`require`s
`../../public/js/common.js` after the shim change):

- `getStarRating`: output ∈ `{3,4,5}` across a representative id sample
  (including `''`, a 1-char id, and long hex-like ids); determinism (same id →
  same value across repeated calls); a couple of pinned id→value expectations to
  lock the hash.

**Manual / running-app verification (no browser harness in this repo, per
CONTRIBUTING.md / RELIABILITY.md):**

- DOM parity: pick several items; the star count on the home card equals the
  star count on that item's watch page (the headline check).
- The watch-page rating control is visibly read-only: no hover-highlight, no
  click-to-rate, and `#rating-text` reads `N / 5`; no `rating_*` key appears in
  `localStorage`.
- Keyboard: `Space` toggles play/pause, `←`/`→` seek ±15s, `f` toggles
  fullscreen, `m` toggles mute; all inert while focus is in the comment box or
  search input.
- FFmpeg-dependent: after transcoding an AVI so the cache exceeds a temporarily
  low `TRANSCODE_CACHE_MAX_BYTES`, confirm eviction runs and the just-finished
  file is retained (manual; FFmpeg stays out of the automated suite).

### Task breakdown (ordered — for the EM's task stage)

1. Add `parseCacheCap(raw)` and the `TRANSCODE_CACHE_MAX_BYTES` constant to
   `server.js`.
2. Add pure `selectEvictions(files, maxBytes, keepPath)` to `server.js`.
3. Add `cleanupOrphanTmp(dir)` and `evictTranscodeCache(maxBytes, justProducedPath)`
   wrappers to `server.js`; export all four helpers + the constant.
4. Wire `evictTranscodeCache(..., outPath)` into the `processTranscodeQueue`
   close-handler success branch (after the atomic rename), and wire
   `cleanupOrphanTmp` + `evictTranscodeCache(..., null)` into the
   `require.main === module` startup block.
5. Write `test/unit/transcode-cache.test.js` (cap parsing, `selectEvictions`
   cases, `cleanupOrphanTmp`, `evictTranscodeCache` wrapper).
6. Add pure `getStarRating(id)` to `public/js/common.js`; guard the
   `DOMContentLoaded` listener with `typeof document` and add the CommonJS
   export shim.
7. Write `test/unit/star-rating.test.js` (range + determinism + pinned values).
8. Update `public/js/main.js` `renderMediaGrid` to render `getStarRating(item.id)`
   on the card instead of the hardcoded `★★★★★`.
9. Remove interactive rating from `public/js/watch.js` (`initRatings`,
   `drawStars`, `highlightStars`, listeners, `rating_*` localStorage); add
   read-only `renderStarRating()` and update the call site; adjust
   `public/watch.html` star markup (`title`, empty `#rating-text`).
10. Extend the existing `watch.js` `keydown` handler with `Space`/`f`/`m`
    branches and the contenteditable guard (arrows already reuse `SKIP_SECONDS`).
11. Run `npm run lint` + `npm test`; then the manual DOM-parity, keyboard, and
    (FFmpeg) eviction spot-checks before handing to QA.

## Task breakdown

(To be filled by engineering-manager)

## Progress log

- 2026-07-04 — Discovery complete. Exec plan drafted by product-manager
  from the self-contained kickoff brief in `.state/inbox/product-manager.md`.
  No overlapping active exec plans found (`docs/exec-plans/active/` was
  empty prior to this file); tech-debt tracker was empty (no conflicting
  or duplicate entries).

## Decision log

- 2026-07-04 — Confirmed the "unbounded transcode cache" issue is
  documented in `docs/ARCHITECTURE.md` (Constraints) but was never logged
  in `docs/exec-plans/tech-debt-tracker.md`. Decision: leave the tracker
  untouched during discovery (nothing to close yet — the fix hasn't
  shipped); whoever runs QA/acceptance on this feature should add a
  **Closed** row to the tracker once eviction ships, so the debt has an
  entry that shows it existed and was resolved, rather than never having
  been recorded at all.
- 2026-07-04 — Discovery found that light/dark theme toggle (candidate d)
  is already fully implemented in the codebase. Decision: exclude it from
  the "deferred" list (nothing to defer) and flag it as a non-issue so
  engineering doesn't duplicate existing work.
- 2026-07-04 — Item 3 narrowed to a single inclusion (keyboard shortcuts)
  per the explicit "keep this branch focused" instruction, given the branch
  already carries two substantive fixed items and a mandatory heavy QA
  pass.

## Shipped

- 2026-07-04 — Shipped as **v1.1.0**. Feature complete through QA/code-review
  (see state history). Moved from `docs/exec-plans/active/` to
  `docs/exec-plans/completed/` by the engineering-manager during the
  `mobile-playback-polish` kickoff.
