# Principal Engineer — Design: harden db.json write concurrency + mobile logo top-left

You are the Principal Engineer. Produce the **technical design** for a v1.9.0 feature
branch. You have no shared context with the EM — everything you need is below or in the
referenced files. Do NOT write application code; write the design.

## Read first

- `docs/exec-plans/active/2026-07-05-harden-db-writes-and-logo.md` — the PM's requirements
  and acceptance criteria (both items; Item 1's "Headline open question" section frames the
  three serialization approaches). Write your design into its `## Design` section.
- `.state/feature-state.json` (`description`, `grounding`, `prior_release`).
- `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md`, `docs/RELIABILITY.md`.
- `docs/exec-plans/completed/2026-07-05-settings-automation-cache.md` — the v1.8.0 exec plan
  (Design + Remediation-design sections). This feature makes its FR1/FR3 race remediation
  STRUCTURAL. Understand the invariants it established before you touch them.
- `docs/exec-plans/tech-debt-tracker.md` — Active #2 (double readdir) and #3 (dropped-rescan tail).
- `server.js` — `saveDatabase` (line 73, plain non-atomic `fs.writeFileSync`); the 7 writer
  call sites: `setTranscodeStatus` (~415-419), `recordServed` (~448-460), `runScanDirectories`
  final save (~872-899, the current re-read-merge-on-save), `POST /api/config` (~1038-1041),
  `POST /api/settings` (~1116-1144), `POST /api/progress` (~1274-1291), `DELETE /api/videos/:id`
  (~1296-1329). Also grep every `loadDatabase()` READER (GET routes etc.) — approach (b) changes
  their contract. Read `recordServed`'s in-memory `persistedServedAt` throttle, the `scanState`
  `scanning`/`rescanRequested` drain (`MAX_RESCAN_FOLLOWUPS`), and `mergeScannedMetadata`.
- `test/integration/scan-clobber.test.js` — the headline interleave test template, and its
  timing model (FFmpeg-unavailable promises resolve synchronously in-executor; concurrency is
  simulated via interleaved synchronous calls in the same tick, NOT real async I/O races).

## Deliverable

Fill the `## Design` section of the exec plan, then set `artifacts.design` in
`.state/feature-state.json` to that plan's path. Update `docs/ARCHITECTURE.md` if the
persistence layer's contract changes (it will). Also propose the `## Task breakdown`'s
shape for the EM (keep Item 1 hardening and Item 2 logo as SEPARATE tasks/commits) —
but the EM writes the final task list next stage; you just recommend the split.

## HEADLINE deliverable (design gate — relayed to Dean before we build)

Your **recommended serialization approach with justification** is the single most important
output. The EM will bring it to Dean for a design-gate sign-off BEFORE implementation,
because it reshapes how the whole app reads and writes `db.json`. Choose ONE of the three
and justify it against the others. Sharpened tradeoffs (do not gloss these):

- **(a) Async write-queue / mutex around persistence.** Only one read-modify-write runs at a
  time; others queue. BUT the READ must ALSO move inside the lock at every site — otherwise a
  caller reads a stale snapshot outside the lock, mutates it, and clobbers on save, so the
  stale-read window remains. "Lower blast radius" is therefore partly illusory: you still
  restructure all 7 call sites' internal load-mutate-save shape.
- **(b) Single authoritative in-memory `db` object with serialized/atomic persistence.** Writers
  mutate the one canonical in-memory object; persistence is serialized/atomic separately. Most
  fully eliminates the race (there is only one `db`, no competing stale reads) but is the most
  invasive: it changes EVERY reader's contract (all the `loadDatabase()` callers) and requires
  care that in-memory and on-disk state don't diverge across a crash (flush atomically and
  promptly enough that a crash loses no meaningful window of accepted writes).
- **(c) Whole-file + a lock with fresh-read-inside-the-lock.** Keep the load-whole-file / mutate
  / save-whole-file shape at each site, but wrap each in acquire-lock -> re-read fresh -> mutate
  -> save -> release (generalizing the v1.8.0 re-read-merge to ALL writers). Closest to the
  current mental model, but every write still pays a full file read+parse+stringify+write, and
  little complexity is reduced over today's mitigation — it just generalizes it. The "lock"
  needs a correct in-process implementation (e.g. a promise chain), no OS file lock is in play.

**ALL three MUST additionally deliver atomic on-disk writes** (write-temp-then-rename) for
`saveDatabase`, regardless of which serialization approach you pick.

## Specify in the design

1. The chosen approach and WHY (vs. the other two), honestly weighing invasiveness vs. how
   completely it kills the race class.
2. How each of the 7 writer call sites changes, and how ALL readers change (esp. under (b)).
3. How the v1.8.0 `runScanDirectories` re-read-merge-on-save SIMPLIFIES (or must STAY as
   belt-and-suspenders) under the new mechanism — WITHOUT regressing: the mount-loss guard
   (missing root never prunes), `lastServedAt` on-disk authority, the FR3.3 `transcodeStatus`
   fresh-seed, or the bounded rescan drain. Do not remove the tests for these invariants.
4. The **atomic write-temp-then-rename** implementation for `saveDatabase` (same-dir temp file,
   rename over `DB_FILE`, no orphan temp on success, original intact on interrupted write).
5. Fold-in (a) — tech-debt #3 deferred-rescan tail: when the drain budget exhausts with
   `rescanRequested` still set, schedule exactly ONE deferred/rate-limited rescan via a short
   `unref()`'d timer (never keeps the process alive, never chains indefinitely). MANDATORY.
6. Fold-in (b) — tech-debt #2 shared `TRANSCODE_DIR` enumeration: fold in ONLY if you judge it
   low-risk alongside the Item 1 work; otherwise explicitly DEFER it and say the tracker entry
   stays open (an acceptable outcome, not a failure).
7. Coherence with `recordServed`'s in-memory `persistedServedAt` throttle: keep the contract that
   on-disk `lastServedAt` is the single source of truth and `persistedServedAt` is a write-throttle
   only — never fed back as truth or into any merge.
8. The regression tests: the headline non-clobbering interleave (a settings write, a progress write,
   a recordServed, and a scan all interleaved in one test, all surviving; must FAIL pre-change and
   PASS after — proving it exercises the race), the atomic-write unit test, a mechanism-appropriate
   serialization-correctness test, the explicit v1.8.0-invariant re-verification, and the
   deferred-rescan-tail test. Keep FFmpeg out of the suite.

## Item 2 — mobile logo top-left (small)

Design the CSS/HTML change: on mobile, logo top-left on both home (`public/index.html`) and watch
(`public/watch.html`) pages, matching desktop; remove the centered `.mobile-logo` treatment; search
FULL-WIDTH below the logo (the PM's proposed default — Dean confirms on-device). Change scoped to the
mobile `@media` block (`public/css/style.css` ~1583-1631). Preserve a11y (`aria-label="FileTube home"`,
tab order), `safe-area-inset-top`, and no theme/icon-set regression. Bottom-nav app-shell stays. Verify
no `public/js/*.js` selector breaks. Keep it a SEPARATE task/commit from Item 1.

## Constraints

- High-risk persistence-layer code touching what the whole app depends on: the design must be
  CONSERVATIVE. Keep all **194 tests green** and the frozen suites (esp. `test/unit/transcode-cache.test.js`)
  UNTOUCHED/byte-identical.
- No new runtime dependency unless you justify why hand-rolled Node `fs` + in-process queue/mutex
  is insufficient.
- Node 22, CommonJS, `node:test`, ESLint 0 errors (11 exported-globals warnings = allowed baseline).
- Single-process only (no multi-process/file-lock scope). Additive/zero-regression. Ships v1.9.0.
- npm/node commands need `export PATH="/home/coder/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"` first.

When done, tell the coordinator the design is ready. The EM will relay your recommended approach to
Dean for the design-gate sign-off before implementation, then run `/prep-em-tasks`.
