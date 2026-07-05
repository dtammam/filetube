# Harden db.json write concurrency + mobile logo top-left

## Goal

Two independent changes on one branch, kept as separate commits/tasks so each
reverts independently: (1) structurally eliminate the `db.json`
read-modify-write clobber race CLASS (not finding-by-finding, as v1.8.0 did)
and make on-disk saves crash-safe; (2) move the mobile logo to top-left on
both the home and watch pages, matching desktop.

## Scope

Both items below. See each section for its own scope/out-of-scope/AC.

## Out of scope

- Anything not listed under the two items' own "Out of scope" subsections.
- Any change to `docs/exec-plans/completed/2026-07-05-settings-automation-cache.md`
  itself (it is a closed record; this plan documents what changes structurally).

## Constraints (both items)

- Node 22 LTS (`engines` >=20), CommonJS, no new runtime deps unless the PE
  justifies one for Item 1's serialization mechanism.
- `npm test` (node:test) stays green at 194+ tests, including the frozen
  suites (e.g. `test/unit/transcode-cache.test.js` byte-identical); `npm run
  lint` stays at 0 errors (the 11 pre-existing "defined but never used"
  exported-globals warnings are the allowed baseline — no new warnings).
- Every feature/bugfix ships tests (CONTRIBUTING.md). Keep FFmpeg out of the
  automated suite (not installed on CI runners) — the scan-clobber-style test
  must simulate concurrency without FFmpeg, as `test/integration/
  scan-clobber.test.js` already does.
- Additive / zero-regression. Ships to prod Docker `deantammam/filetube` on a
  `v*.*.*` tag (v1.9.0).
- Item 1 and Item 2 must land as separate commits/tasks so either can be
  reverted without touching the other.
- Item 1 is high-risk and drives full pipeline rigor: discovery -> design ->
  implementation -> build -> the two-reviewer QA gate (quality-assurance agent
  + a separate code-review pass), matching v1.8.0's review rigor. Item 2 is
  low-risk/cosmetic and does not require that gate, though it still needs
  build-specialist verification (lint/tests) before acceptance.

---

## ITEM 1 — Harden db.json write concurrency

### Goal

Eliminate the `db.json` read-modify-write clobber race as a CLASS: serialize
ALL writers behind a single mechanism so no two concurrent read-modify-write
sequences can overlap and clobber each other, and make each on-disk save
atomic (write-temp-then-rename) so a process crash mid-write can never leave
`db.json` corrupt or truncated.

### Scope

- All seven current `saveDatabase()` call sites in `server.js` must go through
  the new serialized path:
  - `setTranscodeStatus` (server.js:415-419)
  - `recordServed` (server.js:448-460)
  - `runScanDirectories`'s final save (server.js:872-899, the current
    re-read-merge-on-save)
  - `POST /api/config`'s folder/folderSettings save (server.js:1038-1041)
  - `POST /api/settings` (server.js:1116-1144)
  - `POST /api/progress` (server.js:1274-1291)
  - `DELETE /api/videos/:id` (server.js:1296-1329)
- `saveDatabase` itself (server.js:73, currently a plain
  `fs.writeFileSync(DB_FILE, ...)`) becomes atomic on disk: write to a temp
  file in the same directory, then rename over `DB_FILE`, so a crash between
  the write and the rename either leaves the old file intact or the new file
  complete — never a half-written `db.json`.
- The chosen serialization mechanism must make the whole read-modify-write
  sequence (not just the final write) atomic with respect to other writers —
  see "Headline open question" below; this is the Principal Engineer's design
  call, not resolved here.
- Fold-in (a): tech-debt tracker Active #3 — the FR3.4 dropped-rescan tail.
- Fold-in (b), OPTIONAL: tech-debt tracker Active #2 — shared TRANSCODE_DIR
  enumeration.
- Simplifying/removing the v1.8.0 `runScanDirectories` re-read-merge-on-save
  IF the new serialization mechanism makes it redundant — but this must not
  regress any v1.8.0 invariant (see Constraints below). The PE decides whether
  to remove it, keep it as belt-and-suspenders inside the new mechanism, or
  leave it untouched.

### Out of scope

- Migrating `db.json` to a real database engine (SQLite, etc.) — that's a
  bigger architectural change, not this feature.
- Multi-process/multi-instance coordination (e.g. a file lock usable across
  separate OS processes). FileTube is single-process per the architecture
  doc; the serialization only needs to hold within one Node process.
- Any change to the shape/schema of `db.json` itself.
- Any change to FFmpeg/transcode logic beyond what fold-in (b) touches.
- UI changes (Item 2 is separate and unrelated).

### Constraints

- Must preserve every v1.8.0 concurrency invariant, none of which may regress:
  - The mount-loss guard: a missing/unmounted root folder never prunes its
    library entries (`selectPrunableIds`).
  - `db.metadata[id].lastServedAt` authority: the on-disk value is the source
    of truth; in-memory serve maps (`persistedServedAt`) are write-throttles
    only, never fed back as truth.
  - `transcodeStatus` seeding from the fresh on-disk value during a scan (FR3.3)
    so an in-flight `processing`/`failed` transcode status is never clobbered
    by a stale scan-start snapshot.
  - The bounded rescan drain (`MAX_RESCAN_FOLLOWUPS = 1`) and its overlap
    guard (`scanState.scanning` / `scanState.rescanRequested`) — must remain
    provably bounded (no livelock) after fold-in (a) is added.
  - `db.folders` / `db.folderSettings` / `db.settings` / `db.progress`
    concurrently-written by other routes during a scan must never be lost.
- No new runtime dependency unless justified in the design (a plain Node
  `fs` + in-process queue/mutex should suffice; if the PE proposes a
  dependency, justify why hand-rolling isn't sufficient).
- Whatever mechanism is chosen must work correctly under `node:test`'s
  single-process, no-FFmpeg-available test conditions (mirrors the existing
  scan-clobber test's timing model: FFmpeg-unavailable promises resolve
  synchronously inside their executor, so concurrency must be simulated via
  synchronous `loadDatabase`/`saveDatabase`-equivalent calls interleaved in
  the same tick, not via real async I/O races).

### Acceptance criteria

- [ ] **[INTEGRATION] Headline non-clobbering interleave test.** A new (or
      extended) regression test interleaves, in a single test: a settings
      write (`POST /api/settings`-equivalent), a progress write (`POST
      /api/progress`-equivalent), a `recordServed` call, and an in-flight
      scan (`scanDirectories()`), using `test/integration/scan-clobber.test.js`
      as the template/pattern. Asserts that NOTHING is lost: the settings
      change, the progress change, and the `lastServedAt` timestamp all
      survive the scan's completion, and the scan's own metadata changes are
      also present. This test must FAIL against the pre-change code (plain
      `saveDatabase` calls, no serialization) and PASS after the fix, proving
      it actually exercises the race.
- [ ] **[UNIT] Atomic-write behavior.** A unit test (in `test/unit/`, likely
      extending the existing `loadDatabase`/`saveDatabase` unit coverage)
      verifies `saveDatabase` writes via write-temp-then-rename: e.g. (a) the
      final `db.json` is never truncated/partial even if a write is
      interrupted (simulate via a temp-file-write failure and assert the
      original `db.json` is untouched), and (b) a successful save produces
      valid, complete JSON in `db.json` and leaves no orphan temp file behind.
- [ ] **[UNIT/INTEGRATION] Serialization mechanism correctness.** Tests
      appropriate to the PE's chosen mechanism (e.g. a queue-ordering test if
      write-queue/mutex; a single-source-of-truth consistency test if
      in-memory SoT; a lock-contention test if locked-whole-file) demonstrating
      two overlapping writers never interleave their read-modify-write steps.
- [ ] **[INTEGRATION/PROCESS] Full existing suite stays green.** All existing
      194 tests continue to pass unmodified in behavior (call-site signatures
      may change internally, but observable behavior must not), including the
      frozen suites (`test/unit/transcode-cache.test.js` byte-identical to its
      current form) and the v1.8.0 regression suites (`scan-clobber.test.js`,
      `scan-api.test.js`, `scan-prune.test.js`, `age-sweep.test.js`).
- [ ] **[INTEGRATION] v1.8.0 invariants preserved, explicitly re-verified.**
      Existing or new tests confirm: the mount-loss guard still holds
      (missing root never prunes), `lastServedAt` on-disk authority still
      holds, `transcodeStatus` FR3.3 seeding still holds, and the bounded
      rescan drain (`MAX_RESCAN_FOLLOWUPS`) still holds — none regress under
      the new serialization mechanism.
- [ ] **[PROCESS] `npm run lint` reports 0 errors** (no new warnings beyond
      the 11-warning allowed baseline).
- [ ] **[UNIT/INTEGRATION] Fold-in (a) — deferred rescan tail (tech-debt #3).**
      When the coalesced rescan drain (`MAX_RESCAN_FOLLOWUPS`) exhausts its
      budget while `scanState.rescanRequested` is still `true`, a test
      confirms exactly ONE deferred/rate-limited rescan is scheduled via a
      short `unref()`'d timer (never keeping the process alive, never chaining
      indefinitely) instead of the request being silently dropped. Confirms
      the previously-documented scenario (auto-scan Off + a folder-add landing
      during the single follow-up pass) now results in the new folder being
      indexed without requiring a manual "Scan now".
- [ ] **[PROCESS, conditional] Fold-in (b) — shared TRANSCODE_DIR enumeration
      (tech-debt #2), OPTIONAL.** If, and only if, the Principal Engineer's
      design judges this low-risk to combine with the Item 1 work, `
      sweepAgedTranscodes` and `evictTranscodeCache` share one `readdir`+
      `statSync` enumeration pass instead of two independent ones, with
      existing cache-hygiene tests (`age-sweep.test.js`,
      `test/unit/transcode-cache.test.js`) staying green. If the PE defers
      this, the tech-debt tracker entry stays open and this AC is marked N/A
      in the design doc — that is an acceptable outcome, not a failure.

### Headline open question for the design gate (PE decides — do not resolve here)

**Which serialization approach?** Three candidates, each with a different
risk/complexity profile; the PE should choose and justify one:

1. **(a) Async write-queue/mutex around persistence.** Every writer's
   read-modify-write sequence (load -> mutate -> save) is wrapped so only one
   runs at a time; others queue and each sees the result of the one before it.
   Localized change — writer call sites stay structurally similar (still call
   something like `loadDatabase`/`saveDatabase`), but wrapped. Lower blast
   radius, but doesn't by itself prevent a *caller* from reading a stale
   snapshot outside the lock and mutating it before entering the queue (each
   writer must be restructured to load-mutate-save entirely INSIDE the locked
   section, which touches every one of the 7 call sites' internal shape).
2. **(b) Single authoritative in-memory db object with serialized/atomic
   persistence.** The server holds one canonical in-memory `db` object;
   writers mutate it directly (no per-call `loadDatabase`/`saveDatabase` round
   trip) and persistence to disk is serialized/debounced/atomic separately.
   Removes the read-modify-write race entirely (there's only one `db`, no
   competing reads of stale snapshots) but is the most invasive: it changes
   how every reader (there are many `loadDatabase()` calls, e.g. GET routes)
   gets `db`, and requires care that in-memory state and on-disk state don't
   diverge across a crash (must still flush atomically and promptly enough
   that a crash doesn't lose a meaningful window of writes).
3. **(c) Whole-file with a lock + fresh-read-inside-the-lock.** Keep the
   current load-whole-file/mutate/save-whole-file shape at each call site, but
   wrap each in an acquire-lock -> re-read fresh from disk -> mutate -> save ->
   release-lock sequence (extending the existing v1.8.0 re-read-merge pattern
   into a general mechanism used by ALL writers, not just the scan). Closest
   to the current code/mental model and reuses the re-read-merge idea already
   proven in `runScanDirectories`, but every call site still pays a full
   file read+parse+stringify+write per operation (no elimination of the I/O
   cost the way (b) would), and the "lock" itself needs a correct in-process
   implementation (e.g. a promise chain) since there's no OS-level file lock
   in play here.

Tradeoff summary for the PE: (a) is the least invasive but requires touching
every call site's internals anyway to move the read inside the lock, so its
"lower blast radius" is partly illusory; (b) is the most invasive (changes the
reader contract everywhere) but removes the race class most completely and
naturally answers "is the re-read-merge still needed" (no — there's only one
db); (c) is the most conservative evolution of the existing v1.8.0 fix but
keeps paying per-write file I/O and doesn't reduce complexity much over
today's mitigation, just generalizes it. Whichever is chosen must still keep
saves atomic-on-disk (write-temp-then-rename) regardless of approach.

### Residual open questions (do not block; proposed defaults)

- Should the serialized path be strictly synchronous-per-write (one queued
  function, request-response ordering matches call ordering) or is a
  debounced/coalesced flush of an in-memory object acceptable given the
  crash-safety requirement? *Proposed default:* strict per-write ordering
  (no debouncing) unless the PE identifies a specific throughput reason to
  coalesce — `db.json` writes are low-frequency enough (settings changes,
  per-serve throttled at ~10 min, per-scan) that debouncing buys little and
  adds crash-window risk (a debounce window is a window where an accepted
  write isn't yet durable).
- Does simplifying/removing the v1.8.0 re-read-merge in `runScanDirectories`
  risk any FR1/FR3 invariant? *Proposed default:* keep the re-read-merge
  logic's INTENT (scan must merge into fresh state, not overwrite) but let the
  PE decide whether the new serialization mechanism subsumes the explicit
  `fresh = loadDatabase()` re-read or whether it stays as an explicit
  belt-and-suspenders step inside the new lock/queue. Do not remove test
  coverage for the invariant itself either way.

---

## ITEM 2 — Mobile logo top-left

### Goal

On mobile, move the logo to the top-left on both the home screen and the
watch/video page, matching the desktop layout, removing the centered
app-shell `.mobile-logo` treatment. Desktop is unchanged.

### Scope

- `public/css/style.css`'s mobile `@media (max-width: 768px)` block (the
  "Mobile app shell: header restructure" section, ~1583-1631): change
  `.header-left` from `justify-content: center` (full-width, centering its
  children) to a top-left arrangement so `.mobile-logo` sits at the left edge
  of the header instead of centered.
- Decide where the mobile search (`.header-search`) goes now that it's no
  longer below a centered logo. Two options considered:
  - **Logo top-left, search beside it** (same row, logo + search share the
    header row).
  - **Logo top-left, search full-width on the row below** (logo occupies a
    slim top row; search gets its own full-width row beneath).
  - **Proposed default: logo top-left with search full-width below it.** This
    keeps the search input at a usable full-width tap target on narrow
    screens (matching its current full-width treatment) rather than
    squeezing it into a shared row next to the logo, which risks the input
    becoming too narrow to comfortably type in or tap on small phones. It
    also requires a smaller structural change (header stays `flex-direction:
    column`; only the logo's row changes from centered to left-aligned)
    versus reflowing to a single row, which would need to also refit/hide
    the (already-hidden-on-mobile) `.header-right` controls. Dean confirms
    on-device; if beside-the-logo reads better in practice, that is a small
    follow-up CSS change.
- Applies to both the home page (`public/index.html`) and the watch page
  (`public/watch.html`) — both already share the same header markup
  (`.header-left` > `.logo` + `.mobile-logo`, `.header-search`,
  `.header-right`) and the same stylesheet, so this is a single shared CSS
  change, not a per-page one. `public/setup.html` shares the same header
  markup too (no `.header-search` there) and should be checked for visual
  consistency, though it is not explicitly named in the decision.
- The bottom-nav app-shell (Home/Playlists/Dark/Settings) stays exactly as
  is — not part of this change.
- Preserve: accessibility (`aria-label="FileTube home"` on the logo link,
  keyboard/tab order), `safe-area-inset-top` handling (the `header`'s
  `padding: calc(8px + env(safe-area-inset-top)) ...`), and no
  regression to the icon-set system (Outlined/Rounded/Filled/Emoji/Auto) or
  theme (light/dark) rendering.

### Out of scope

- Desktop header layout (already top-left; untouched).
- The bottom-nav app-shell itself (Home/Playlists/Dark/Settings) — unchanged.
- The Playlists sheet, theme toggle, or icon-set system internals.
- Any change to `public/setup.html`'s functional layout beyond keeping it
  visually consistent with the header change (setup has no header-search to
  reposition).
- Backend changes of any kind (this item touches CSS/HTML only).

### Constraints

- CSS/HTML only; no JS behavior changes expected (no pure-logic helper is
  anticipated to be extracted from this).
- Must not change the DOM structure in a way that breaks existing
  `public/js/*.js` selectors (menu toggle, search input id, theme toggle id,
  etc.) — verify current selectors are unaffected.
- Change must be scoped to the mobile breakpoint only (inside the existing
  `@media (max-width: 768px)` block or a phone-specific sub-range within it)
  so desktop and tablet (>768px) layouts are provably unchanged.

### Acceptance criteria

- [ ] **[MANUAL]** On a mobile viewport (or device), the logo renders
      top-left on the home page, matching desktop's top-left placement.
      Dean confirms on-device.
- [ ] **[MANUAL]** On a mobile viewport (or device), the logo renders
      top-left on the watch/video page, matching the home page and desktop.
      Dean confirms on-device.
- [ ] **[MANUAL]** The mobile search remains usable and clearly associated
      with its input (full-width below the logo per the proposed default, or
      beside it if Dean prefers that on review) — not cramped, not
      overlapping the logo, tappable target size preserved.
- [ ] **[MANUAL]** `aria-label="FileTube home"` and the logo's link-to-home
      behavior are unchanged; tab order through the header remains sensible.
- [ ] **[MANUAL]** `safe-area-inset-top` is still respected (no content
      clipped under a notch/status bar on a device with a safe area).
- [ ] **[MANUAL]** No regression in any icon-set mode (Outlined/Rounded/
      Filled/Emoji/Auto-per-era) or theme (light/dark) — spot-check at least
      one non-default icon-set and dark mode alongside the logo change.
- [ ] **[MANUAL]** Desktop layout (>768px) is visually unchanged — the logo
      stays where it currently is, centered search/right-side controls
      unaffected.
- [ ] **[PROCESS]** `npm run lint` reports 0 errors (0 new warnings) and
      `npm test` stays green — this is a CSS/HTML-only change but must not
      break any existing test that asserts on header markup (if any exist).

---

## Design

### Recommendation (design gate — relay to Dean)

**Adopt a serialized in-process `updateDatabase(mutatorFn)` primitive: an
async-mutex (promise-chain) that, per write, loads a FRESH `db` from disk
inside the lock, applies the mutator synchronously, and atomically saves —
with every one of the 7 writers routed through it. This is approach (c)
(locked whole-file + fresh-read-inside-the-lock) packaged as approach (a)'s
clean primitive. All saves become atomic (write-temp-then-rename).**

This is the lowest-risk approach that *provably* eliminates the
read-modify-write (RMW) clobber class, because both the read and the write of
every RMW live inside one serialized critical section — no writer can ever
observe a stale snapshot and save over another writer's committed change.

Why not the alternatives:

- **(b) single in-memory source-of-truth** most fully kills the race but is
  the most invasive and the *highest* risk here: it rewrites the contract of
  all ~15 `loadDatabase()` reader call sites (every GET route), and it opens a
  crash-divergence gap (accepted-but-not-yet-flushed in-memory writes lost on
  crash) that we would have to engineer around. Too much blast radius for a
  conservative hardening branch.
- **(a) bare write-queue/mutex** as framed is partly illusory: unless the READ
  also moves inside the lock, a caller still snapshots stale state outside the
  lock and clobbers on save. Once you move the read inside the lock at every
  site, you have exactly the chosen primitive — so we adopt that, explicitly,
  rather than a half-measure.
- **(c) as-is** is correct but under-packaged; formalizing it as one
  `updateDatabase()` primitive (instead of hand-repeating acquire/re-read/save
  at 7 sites) is what makes it auditable and testable. The per-write full-file
  I/O cost that (c) "keeps" is a non-issue: `db.json` writes are low-frequency
  (settings changes, per-scan, and a per-serve write throttled to ~10 min),
  so we deliberately trade a bit of I/O for maximal simplicity and safety.

Decisive advantage over (b): **readers do not change at all.** Every
`loadDatabase()` reader keeps reading fresh from disk; the atomic
write-temp-then-rename guarantees a reader always sees either the old complete
file or the new complete file, never a torn one. The change is confined to the
7 writers plus `saveDatabase`.

### Approach

Two building blocks are added to `server.js`, and the 7 writers are converted
to use them; readers are untouched.

1. **Atomic `saveDatabase` (write-temp-then-rename).** `saveDatabase` stays
   synchronous but writes to a unique same-directory temp file, `fsync`s it,
   then `rename`s it over `DB_FILE` (atomic on POSIX within one filesystem). On
   any failure the temp file is cleaned up and `DB_FILE` is left intact. This
   mirrors the existing "atomic MP4 finalize" pattern (`.tmp.mp4` + rename)
   already used for transcodes, so it is idiomatic to the codebase.

2. **Serialized `updateDatabase(mutatorFn)`.** A module-level promise chain
   serializes every write. Per call it loads a fresh `db` inside the lock,
   invokes the (synchronous) mutator, and — unless the mutator returns `false`
   — atomically saves. Because the read, mutate, and save all run in one
   serialized synchronous critical section, no two RMW sequences can interleave.

Signature and contract:

```js
// Serialize all read-modify-write persistence. The mutator MUST be
// synchronous (no awaits) and MUST NOT call updateDatabase re-entrantly.
// Return false to skip the save (no-op/guard paths); any other return value
// is passed back to the awaiting caller. Rejections are isolated so one
// failed mutation never wedges the chain.
let dbWriteChain = Promise.resolve();
function updateDatabase(mutatorFn) {
  const run = dbWriteChain.then(() => {
    const db = loadDatabase();          // fresh read INSIDE the lock
    const result = mutatorFn(db);       // synchronous mutate
    if (result !== false) saveDatabase(db); // atomic write-temp-then-rename
    return result;
  });
  dbWriteChain = run.catch(() => {});   // keep the chain alive past a failure
  return run;
}
```

`saveDatabase` stays synchronous on purpose: the mutate-then-save must complete
in one tick so the critical section is indivisible, and existing direct callers
(tests, `loadDatabase`'s initial-create path) keep their current contract.

### Component changes

- **`saveDatabase` (server.js:73)**: rewrite to temp-write, then `fsync`, then
  `rename`, with on-failure temp cleanup. Signature unchanged (`saveDatabase(db)`).
- **`updateDatabase` (new)**: the serialized mutex primitive above, exported for
  tests. Placed near `saveDatabase`.
- **`loadDatabase` and all ~15 readers**: unchanged. Readers keep calling
  `loadDatabase()`; atomic rename guarantees they never read a torn file.
- **The 7 writers**: converted from `const db = loadDatabase(); …mutate…;
  saveDatabase(db);` to `await updateDatabase(db => { …mutate…; return true; })`
  (details per site below).
- **`scanDirectories` (server.js:718)**: gains the fold-in #3 deferred-rescan
  tail; drain loop otherwise unchanged.
- **`runScanDirectories` (server.js:738)**: the explicit `fresh =
  loadDatabase()` (line 872) plus the reconcile loop + `mergeScannedMetadata` +
  progress prune + save (lines 862–901) collapse into ONE `updateDatabase`
  mutator (see "v1.8.0 re-read-merge" below).
- **New module-level `scheduleDeferredRescan` + `currentDeferredRescanTimer`
  accessor**: fold-in #3.

### The 7 writer conversions

1. **`setTranscodeStatus` (415)** — fire-and-forget from the transcode worker:
   `updateDatabase(db => { const m = db.metadata[id]; if (m && m.transcodeStatus
   !== status) { m.transcodeStatus = status; return true; } return false; });`
   The `return false` preserves today's "no write when unchanged" behavior.
2. **`recordServed` (448)** — the `persistedServedAt` throttle check stays
   BEFORE `updateDatabase`, fully synchronous, so a throttled Range request
   still does zero disk reads and never touches the lock. Only the "due" branch
   enqueues an `updateDatabase` mutator that repeats the on-disk `lastServedAt`
   check, sets it, and updates the map — returning `false` when already fresh.
   Optionally set `persistedServedAt.set(id, now)` optimistically just before
   enqueuing to coalesce a burst of due Range requests into one write (the map
   is throttle-only, never truth, so an optimistic set is contract-safe).
3. **`runScanDirectories` final save (862–901)** — see the dedicated section.
4. **`POST /api/config` (1038)** — `await updateDatabase(db => { db.folders =
   validFolders; db.folderSettings = cleanSettings; return true; });` then
   respond with the locally-computed `validFolders`/`cleanSettings` (not `db`,
   now scoped inside the mutator), then kick `scanDirectories()`.
5. **`POST /api/settings` (1116)** — validation stays outside. Capture
   `prevInterval` and the merged settings via closure:
   `let saved; await updateDatabase(db => { prevInterval = db.settings
   .scanIntervalMinutes; db.settings = { ...db.settings, ...body }; saved =
   db.settings; return true; });` then `if (saved.scanIntervalMinutes !==
   prevInterval) armScanTimer();` and `res.json(settingsResponse(saved))`.
6. **`POST /api/progress` (1274)** — the 400 body validation stays outside; the
   404 existence check moves INSIDE the mutator against the fresh db:
   `let notFound = false; await updateDatabase(db => { if (!db.metadata[id]) {
   notFound = true; return false; } db.progress[id] = { … }; return true; });
   if (notFound) return res.status(404)…; res.json({ success: true });`
7. **`DELETE /api/videos/:id` (1296)** — keep today's ordering to preserve the
   500-on-FS-failure contract: an initial `loadDatabase()` read for the 404 +
   `filePath` (readers may read freely), then the FS unlinks inside the existing
   `try/catch` (a throw still yields 500 with the db untouched), then `await
   updateDatabase(db => { delete db.metadata[id]; delete db.progress[id];
   return true; });`. Idempotent under a concurrent duplicate delete.

`recordServed` and `setTranscodeStatus` remain fire-and-forget (callers do not
await them); their `updateDatabase` promise simply resolves on the chain.

### Readers

No change. All GET routes and internal reads (`GET /api/videos`,
`/api/videos/:id`, `/api/progress/:id`, `/api/settings`, `/api/scan-status`,
`/api/cache/size`, `armScanTimer`, `sweepAgedTranscodes`, the
`effectiveCacheCap(loadDatabase().settings)` calls, etc.) keep calling
`loadDatabase()` directly. They perform no RMW, so they cannot clobber, and the
atomic rename means they never observe a partial write. This is the single
biggest reason to prefer this approach over (b).

### v1.8.0 re-read-merge: SIMPLIFIES (subsumed), intent + tests STAY

The scan must NOT hold the lock across its FFmpeg `await`s (that would block all
writes for the whole scan — potentially minutes). So the scan keeps its
two-phase shape, and only the final merge+save moves under the lock:

- **Phase 1 (no lock, unchanged):** initial `loadDatabase()` snapshot, the
  awaited extraction loop building `newMetadata`, `missingRoots` /
  `unreadablePaths` enumeration, `selectPrunableIds`, and the idempotent FS
  cleanup of thumbnails/transcodes for genuinely-pruned ids.
- **Phase 2 (ONE `updateDatabase` mutator):** the mutator receives the
  fresh-inside-the-lock `db`, so the explicit `const fresh = loadDatabase()`
  (line 872) is **removed** — `updateDatabase` supplies it. The reconcile loop
  (root backfill + FR3.3 `transcodeStatus` seed from `db.metadata[id]` +
  `reconcileTranscode`), `mergeScannedMetadata(db.metadata, newMetadata)`, the
  `db.progress[id]` prune, and `clearPersistedServedAt(id)` all run inside this
  one mutator, then it returns `dbChanged`.

What genuinely improves: today a hair-thin window exists between `fresh =
loadDatabase()` (872) and `saveDatabase(fresh)` (899). It is tiny only because
the tail happens to have no `await`; any future edit inserting one would
reopen it. Under `updateDatabase` the fresh-read + merge + save are one
serialized critical section, so the window is **provably closed**, not merely
thin. `reconcileTranscode` is safe to run inside the mutator: it does only
`fs.existsSync` reads and in-place mutation — no db writes, no queue kicks, so
no re-entrant `updateDatabase`.

Invariants explicitly preserved (and their tests kept):

- **Mount-loss guard:** `selectPrunableIds` still runs in phase 1 off the
  scan's own `missingRoots`; a missing root still never prunes. Unchanged.
- **`lastServedAt` on-disk authority:** `mergeScannedMetadata` still only ever
  advances `lastServedAt`, never regresses it; on-disk stays the single source
  of truth. Now strictly safer (the concurrent `recordServed` it merges is
  itself serialized).
- **FR3.3 `transcodeStatus` fresh-seed:** now reads from the locked fresh `db`
  handed to the mutator — an in-flight `processing`/`failed` is still never
  clobbered by the stale scan-start snapshot.
- **Bounded rescan drain:** `MAX_RESCAN_FOLLOWUPS` loop in `scanDirectories`
  is unchanged (see fold-in #3 for the tail only).

`docs/exec-plans/completed/2026-07-05-settings-automation-cache.md` is NOT
edited (closed record). `docs/ARCHITECTURE.md`'s "Re-read-merge-on-save" key
decision DOES describe a contract that changes, so it must be updated to
describe the serialized `updateDatabase` primitive + atomic writes; that edit
ships WITH Task 1 (docs match shipped code) — exact wording is left to the SDE
but must state: (i) all writers serialize through `updateDatabase`, (ii)
`saveDatabase` is atomic write-temp-then-rename, (iii) the scan still merges
into fresh state under the lock rather than overwriting a start-of-scan
snapshot.

### `recordServed` throttle coherence

`persistedServedAt` stays a write-throttle only: the ~10-minute hot-path check
runs before `updateDatabase`, so throttled Range requests still cost zero disk
reads and never acquire the lock — the serialized path introduces NO
per-Range-request disk read. The map is never read as truth and never fed into
`mergeScannedMetadata`; on-disk `lastServedAt` remains authoritative.

### Atomic write implementation

```js
function saveDatabase(db) {
  const tmp = `${DB_FILE}.${process.pid}.${dbTmpSeq++}.tmp`;
  try {
    const json = JSON.stringify(db, null, 2);
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, json, 'utf8');
      fs.fsyncSync(fd);          // flush bytes before the rename gate
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, DB_FILE); // atomic within DATA_DIR's filesystem
  } catch (err) {
    console.error('Error saving db.json:', err);
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {} // no orphan
  }
}
```

- Same-directory temp so `rename` is atomic (cross-filesystem rename is a
  copy, which is not).
- `fsync` before rename for crash durability (the bytes are on disk before the
  directory entry flips). A `pid`+counter temp name avoids any collision even
  though the mutex already serializes writes and each test process owns its
  `DATA_DIR`.
- A crash before the rename leaves the old `db.json` complete; a crash after it
  leaves the new one complete — never truncated. On any error the temp is
  removed, so no orphan `*.tmp` accumulates.

### Fold-in #3 (MANDATORY): deferred-rescan tail

When the bounded drain exits with `rescanRequested` still set (budget spent,
tech-debt #3), schedule exactly ONE deferred, rate-limited, `unref()`'d rescan
instead of dropping it:

```js
let deferredRescanTimer = null;
const DEFERRED_RESCAN_DELAY_MS = 5000;
function scheduleDeferredRescan() {
  if (deferredRescanTimer) return;        // never stack/chain more than one
  deferredRescanTimer = setTimeout(() => {
    deferredRescanTimer = null;
    scanDirectories().catch(console.error);
  }, DEFERRED_RESCAN_DELAY_MS);
  deferredRescanTimer.unref();            // never keep the process/test alive
}
```

`scanDirectories`'s `finally` reads `rescanRequested` before clearing
`scanning`, and calls `scheduleDeferredRescan()` when it is still set. Bounded
by construction: at most one timer pending (the `if` guard), `unref`'d, 5 s
rate-limited, and it re-enters the already-bounded `scanDirectories` — so under
sustained demand it self-heals in discrete 5 s-spaced passes (not a livelock),
and under bounded demand it fires once and stops. Resolves the documented
"auto-scan Off + folder-add during the single follow-up" drop.

### Fold-in #2 (double `readdir`): DEFER

Recommend **deferring** it; tracker #2 stays OPEN and the conditional AC is
**N/A**. `sweepAgedTranscodes` is deliberately kept structurally separate from
`evictTranscodeCache` (server.js:253–266) precisely so the FROZEN
`test/unit/transcode-cache.test.js` stays byte-identical. Sharing their
enumeration would touch that frozen cache-hygiene path for a Low-severity perf
win (one extra `readdir` per produce/startup), adding collateral risk to a
high-risk persistence-hardening branch. Keeping Item 1 scoped to the write path
is the conservative call; this is an explicitly acceptable outcome.

### Tests

1. **[INTEGRATION] Headline non-clobbering interleave** (extend
   `test/integration/scan-clobber.test.js` or a sibling): in one test,
   interleave a settings write, a progress write, a `recordServed`, and a
   `scanDirectories()`, fired in the same tick and all awaited; assert the
   settings change, the progress entry, the `lastServedAt`, AND the scan's
   new-file metadata all survive. The RMW clobber this proves is general (two
   serialized writers whose load-mutate-save would otherwise stomp each other's
   field), not just the scan's save. Fail-pre/pass-post is verified by running
   it against a pre-serialization checkout (raw `loadDatabase`/`saveDatabase`
   writers) — documented in the test header as the existing file already does.
2. **[UNIT] Atomic write** (extend the `loadDatabase`/`saveDatabase` unit
   coverage): (a) force a write failure (e.g. stub `fs.renameSync`/`writeFileSync`
   to throw) and assert `db.json`'s prior content is intact and no `*.tmp`
   remains; (b) a successful save yields valid complete JSON and leaves no
   `*.tmp` in `DATA_DIR`.
3. **[UNIT] Serialization correctness:** two `updateDatabase` calls that each
   read-then-mutate a DIFFERENT field, enqueued back-to-back; assert BOTH
   fields are present in the final db (neither clobbered) and that mutators run
   in enqueue order each seeing the prior's committed state.
4. **[INTEGRATION] v1.8.0 invariants re-verified:** `scan-clobber.test.js`,
   `scan-api.test.js`, `scan-prune.test.js`, `age-sweep.test.js` stay green
   unmodified in behavior; plus targeted assertions that the mount-loss guard
   (missing root never prunes), FR3.3 `transcodeStatus` seed (in-flight
   `processing` not clobbered by a scan), and `lastServedAt` authority still
   hold under the new mutator.
5. **[UNIT/INTEGRATION] Deferred-rescan tail (#3):** with `scanIntervalMinutes`
   Off, drive `scanDirectories` so the drain exits with `rescanRequested` still
   true; assert exactly one `unref()`'d timer is scheduled
   (`currentDeferredRescanTimer()` non-null; a second exhaustion does not stack
   a second timer), and that running the deferred pass indexes the pending
   folder. Clear the timer in teardown.

Concurrency/safety caveats for the suite (node:test may run files in parallel):
the mutex is a plain promise chain that always settles (no lock is held across
an `await`, so no deadlock); every timer (`scanTimer`, `deferredRescanTimer`) is
`unref()`'d so no test leaves the process alive; each test file keeps its own
`DATA_DIR` per CONTRIBUTING, so temp files never collide across processes. Keep
FFmpeg out — reuse the existing single-microtask-yield timing model.

### Item 2 — mobile logo top-left (CSS only)

Scope: the `@media (max-width: 768px)` "Mobile app shell: header restructure"
block only (`public/css/style.css` ~1583–1631). The header stays
`flex-direction: column` (logo row, then a full-width search row below); only
the logo row's alignment changes from centered to left. Two edits:

- `.header-left`: change `justify-content: center` to `justify-content:
  flex-start` (keep `width: 100%`, `gap: 0`).
- `.mobile-logo img`: drop the centering — change `margin: 0 auto` to
  `margin: 0` (keep `display: block`, `height/width: 28px`).

`.header-search` stays `width: 100%` on its own row below — full-width per the
PM default. `.logo` stays hidden, `.mobile-logo` stays shown, `.header-right`
stays hidden, bottom-nav untouched. Header `padding-left: 8px` places the logo
a sensible 8 px from the edge. Update the block's lead comment to say
"Top-left logo + full-width search below it" (currently says "Centered logo").

Preserved: `aria-label="FileTube home"` and tab order (DOM untouched — CSS
only); `safe-area-inset-top` (header `padding`/`min-height` untouched); no
theme/icon-set regression (only alignment changes). Desktop (>768px) is
provably unchanged (edit is inside the mobile media query). No `public/js/*.js`
selector breaks (no class/id removed, no DOM change). Both `index.html` and
`watch.html` share this header + stylesheet, so one CSS change covers both;
`setup.html` (same header, no `.header-search`) also gets the left-aligned logo
— visually consistent, verify no regression. Verification is [MANUAL]
(Dean on-device) plus [PROCESS] lint/tests green.

### Alternatives considered

- **In-memory source-of-truth (approach b):** rejected — rewrites all reader
  contracts and adds crash-divergence risk; disproportionate for this branch
  (see Recommendation).
- **Bare write-queue without moving the read inside the lock (approach a as
  literally framed):** rejected — leaves the stale-read window open; the honest
  version of it IS the chosen primitive.
- **Debounced/coalesced flush of an in-memory object:** rejected — a debounce
  window is a window of accepted-but-not-durable writes; `db.json` write volume
  is low enough that strict per-write ordering costs nothing and is simpler to
  reason about (matches the PM's proposed default).
- **A third-party lock/mutex dependency (e.g. `async-mutex`,
  `proper-lockfile`):** rejected — a ~10-line promise chain is sufficient for
  single-process in-memory serialization; `proper-lockfile` targets
  multi-process coordination, which is explicitly out of scope. No new runtime
  dependency is warranted.

### Risks and mitigations

- **Risk:** a mutator that `await`s or re-enters `updateDatabase` would break
  atomicity or self-enqueue. → **Mitigation:** contract is documented as
  synchronous + non-re-entrant; the only non-trivial mutator (the scan's) is
  audited to call only pure/`existsSync` helpers (`reconcileTranscode`,
  `mergeScannedMetadata`) — no db writes, no queue kicks.
- **Risk:** a throwing mutator wedges the chain for all subsequent writes. →
  **Mitigation:** the chain continues from `run.catch(() => {})`; the caller's
  returned promise still rejects, but the next write proceeds.
- **Risk:** holding the lock across the scan would stall all writes. →
  **Mitigation:** the scan keeps its two-phase shape; the lock wraps only the
  synchronous merge+save, never the FFmpeg awaits.
- **Risk:** the deferred-rescan timer livelocks or keeps the process alive. →
  **Mitigation:** single-timer guard + `unref()` + 5 s rate-limit + re-entry
  into the already-bounded `scanDirectories`.
- **Risk:** cross-filesystem `rename` (e.g. an exotic bind mount) is non-atomic.
  → **Mitigation:** the temp file is same-directory, so it shares `db.json`'s
  filesystem; `rename` is atomic. On failure the original is untouched.

### Performance impact

No meaningful impact on any RELIABILITY.md concern. `db.json` writes are
low-frequency; serialization adds no measurable latency at this volume. The
`/video/:id` Range hot path is unchanged — its `persistedServedAt` throttle
still short-circuits before any lock/disk access. Atomic writes add one
`fsync`+`rename` per (already infrequent) save. Fold-in #2's double-`readdir` is
intentionally left as-is (Low-severity, deferred).

### Recommended task breakdown (EM finalizes)

Keep Item 1 and Item 2 as SEPARATE commits so either reverts independently.

- **Task 1 — Item 1 core (headline, two-reviewer QA gate).** Add
  `updateDatabase` + atomic `saveDatabase`; convert all 7 writers; simplify the
  scan's re-read-merge into the mutator; update `docs/ARCHITECTURE.md`'s
  persistence key-decision. Tests: headline interleave, atomic-write,
  serialization-correctness, v1.8.0 invariant re-verification.
- **Task 2 — Item 1 fold-in #3 (deferred-rescan tail).** Add
  `scheduleDeferredRescan`, the `scanDirectories` finally hook, the accessor,
  and its test. Separable for clean
  revertability; the EM may fold it into the Task 1 commit since it is the same
  code area. Fold-in #2 is DEFERRED (tracker #2 stays open; conditional AC N/A).
- **Task 3 — Item 2 (mobile logo).** The two-line CSS change + comment update;
  build-specialist lint/test verification only (no QA gate); [MANUAL] Dean
  on-device.

## Task breakdown

Dean approved the PE's serialized `updateDatabase(mutatorFn)` design at the
design gate (GO, as-is). Item 1 (hardening) and Item 2 (logo) ship as SEPARATE
commits so either reverts independently.

- **T1 — Item 1 core (headline; two-reviewer QA gate).** Add `updateDatabase`
  (serialized async-mutex promise chain; non-reentrant; mutator returns `false`
  to skip the save; a failed mutation isolated so it can't wedge the chain) and
  make `saveDatabase` atomic (unique same-dir temp -> `fsync` -> `rename` over
  `DB_FILE`; temp cleaned on failure; original left intact). Convert all 7
  writers per the design recipes: `setTranscodeStatus`, `recordServed` (keep the
  `persistedServedAt` throttle check BEFORE `updateDatabase` so throttled Range
  requests cost zero disk reads), `runScanDirectories` final save, `POST
  /api/config`, `POST /api/settings` (capture `prevInterval`/merged settings via
  closure for `armScanTimer` + response), `POST /api/progress` (404 check moves
  inside the mutator), `DELETE /api/videos/:id` (keep FS-unlink-before-db
  ordering for the 500-on-failure contract). Collapse the scan Phase-2
  re-read-merge into ONE `updateDatabase` mutator (remove the explicit
  `fresh = loadDatabase()` at ~872) WITHOUT regressing the mount-loss guard /
  `lastServedAt` authority / FR3.3 `transcodeStatus` seed / bounded rescan drain,
  keeping the lock OFF the FFmpeg awaits. Update `docs/ARCHITECTURE.md`'s
  "Re-read-merge-on-save" key-decision to the new contract. Tests: headline
  4-way interleave (settings + progress + recordServed + scan; fails pre-fix,
  passes post-fix), atomic-write unit, serialization-correctness, explicit
  v1.8.0-invariant re-verification. `transcode-cache.test.js` frozen; all 194
  tests green; every timer `unref()`'d; no lock held across an `await`.

- **T2 — Item 1 fold-in #3 (deferred-rescan tail).** Add `scheduleDeferredRescan`
  (single-guarded, `unref()`'d, ~5 s rate-limited `setTimeout` re-entering the
  already-bounded `scanDirectories`) + the `scanDirectories` `finally` hook +
  `currentDeferredRescanTimer()` accessor + its test; move tech-debt #3 to
  Closed. Part of the HARDENING commit (may fold into T1's commit — coordinator's
  call at commit time), NOT the logo commit. Fold-in #2 (double `readdir`)
  DEFERRED — tracker #2 stays open, its conditional AC is N/A.

- **T3 — Item 2 (mobile logo, SEPARATE commit).** The two CSS edits in the mobile
  `@media` block (`.header-left` `justify-content: center` -> `flex-start`;
  `.mobile-logo img` `margin: 0 auto` -> `0`) + the lead-comment update; search
  stays full-width on the row below; desktop / a11y / safe-area / bottom-nav
  untouched. build-specialist lint/test verification + Dean [MANUAL] on-device;
  no two-reviewer QA gate.

## Progress log

- 2026-07-05 — Product Manager: wrote requirements/AC for both items,
  grounded in `server.js` (saveDatabase + 7 writer call sites),
  `test/integration/scan-clobber.test.js` (headline test template), and
  `public/css/style.css` mobile `@media` block / `public/index.html` +
  `public/watch.html` header markup. Flagged the serialization-approach
  choice as the headline open question for the Principal Engineer's design
  stage; proposed "search full-width below logo" as the default for Item 2's
  sub-question, pending Dean's on-device confirmation.

## Decision log

- 2026-07-05 — Locked (Dean, pre-Discovery): mobile logo moves top-left on
  both home and watch, matching desktop; centered `.mobile-logo` app-shell
  treatment is removed. Not reopened during Discovery.
- 2026-07-05 — Product Manager proposes default for Item 2's search-placement
  sub-question: logo top-left, search full-width on the row below (see Item 2
  Scope for rationale). Open for Dean's on-device confirmation; not a block.
- 2026-07-05 — Product Manager frames (does not resolve) the Item 1
  serialization-approach choice as the headline question for the Principal
  Engineer's design stage: write-queue/mutex vs. single in-memory
  source-of-truth vs. locked-whole-file-with-fresh-read-in-lock. See Item 1's
  "Headline open question" section for the full tradeoff framing.
