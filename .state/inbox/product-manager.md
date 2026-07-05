# Product Manager — Discovery: harden db.json write concurrency + mobile logo top-left

You are the Product Manager. Produce **requirements and acceptance criteria** for a
new FileTube feature branch targeting **v1.9.0**. You have no shared context with
the EM — everything you need is below or in the referenced files.

## Read first

- `.state/feature-state.json` (the `description`, `grounding`, and `prior_release` fields)
- `docs/CONTRIBUTING.md` (standards — every feature ships tests; node:test; ESLint 0 errors)
- `docs/RELIABILITY.md` (error-handling / testing strategy; degrade-don't-crash; FS in try/catch)
- `docs/exec-plans/completed/2026-07-05-settings-automation-cache.md` (the v1.8.0 exec plan — the race remediation FR1/FR3 that this feature makes STRUCTURAL; read its Design + Remediation-design sections)
- `docs/exec-plans/tech-debt-tracker.md` (Active #2 and #3 — both fold-in candidates here)
- Ground the concurrency item in the real code before writing: `server.js` — `saveDatabase` (line 73, currently a plain `fs.writeFileSync` — NOT atomic), and the writer call sites at lines 419, 460, 899, 1041, 1144, 1291, 1329. Skim `runScanDirectories`, `POST /api/settings`, `POST /api/progress`, `recordServed`, `setTranscodeStatus`, and `POST /api/config`'s background scan to confirm each does load-whole-file -> mutate -> save-whole-file.
- Ground the logo item: `public/css/style.css` mobile `@media` block ~1583-1631 (`.mobile-logo`, `.header-left{justify-content:center}`, `.logo{display:none}`, `.header-right{display:none}`). Confirm which HTML carries the mobile logo (`public/*.html` — home/index and watch) and the header markup / aria-labels / FileTube-home link.

## Deliverable

Write a NEW exec plan to `docs/exec-plans/active/2026-07-05-harden-db-writes-and-logo.md`
with: goal, scope, out-of-scope, constraints, and acceptance criteria. Then update
`.state/feature-state.json`: set `artifacts.requirements` and `artifacts.exec_plan` to
that path. Do NOT write the Design section — that's the Principal Engineer's next stage.
Do NOT write application code.

This is ONE branch doing TWO INDEPENDENT things, kept as **separate commits/tasks**
so the risky backend change and the cosmetic frontend change revert independently.
**Keep the two items in clearly separate sections of the plan** (Item 1 / Item 2),
each with its own scope + AC. Tag every acceptance criterion `[UNIT]`,
`[INTEGRATION]`, `[MANUAL]`, or `[PROCESS]`.

## Item 1 (the big one) — HARDEN db.json write concurrency

Root-cause fix for the race CLASS that v1.8.0 patched finding-by-finding. `db.json`
is a single JSON file that MANY paths do "load whole file -> mutate one thing ->
write whole file back" on, with NO locking. Any two overlapping -> one clobbers the
other. v1.8.0 mitigated the specific interleavings (settings, lastServedAt,
transcodeStatus, progress-on-prune) with a re-read-merge-before-save in
`runScanDirectories`, but (a) that still has a hair-thin lost-update window (read
fresh -> save; a write landing in the gap is lost) and (b) it's finding-by-finding,
not structural.

**GOAL:** eliminate the class structurally — serialize db.json read-modify-write
behind a single mechanism. The **Principal Engineer** will choose and justify the
approach next stage (write-queue/mutex vs. single in-memory source-of-truth with
debounced/atomic writes vs. whole-file + a lock with fresh-read-inside-the-lock).
Your job is the requirements + AC the design must satisfy. Whatever is chosen must:

- Make concurrent read-modify-write from ALL writer paths **provably non-clobbering**.
  Headline AC `[INTEGRATION]`: a regression test that interleaves a settings write +
  a progress write + a recordServed + a scan and asserts NOTHING is lost — the v1.8.0
  `test/integration/scan-clobber.test.js` is the template.
- Preserve **ALL** v1.8.0 behavior and keep the **194-test suite green** (including the
  frozen suites, e.g. `transcode-cache.test.js` byte-identical).
- Ideally let us SIMPLIFY the `runScanDirectories` re-read-merge once a real lock
  exists — but carefully; it's load-bearing (don't regress the mount-loss guard /
  lastServedAt authority / transcodeStatus seed / bounded rescan drain fixes).
- Keep saves **atomic on disk** (write-temp-then-rename) so a crash mid-write can't
  corrupt db.json. (`saveDatabase` at server.js:73 is currently a plain writeFileSync.)

**FOLD IN** (both in tech-debt-tracker.md, both in this code area):
- (a) **Active #3** — the FR3.4 dropped-rescan tail: when the coalesced rescan drain
  budget is exhausted with `rescanRequested` still set, schedule ONE deferred/
  rate-limited rescan via a short unref'd timer instead of dropping it (resolves the
  "folder-add during the follow-up pass with auto-scan Off gets lost" edge). Give it AC.
- (b) **Active #2** (OPTIONAL — only if the PE finds it low-risk) — `sweepAgedTranscodes`
  then `evictTranscodeCache` each walk `TRANSCODE_DIR` with their own readdir+statSync;
  share one enumeration. Mark this AC as conditional on the PE's risk call.

## Item 2 (small, cosmetic) — mobile logo top-left

**DECISION ALREADY MADE by Dean — do NOT re-ask:** on MOBILE, the logo must sit
TOP-LEFT on BOTH the home screen and the watch/video page, matching the desktop
layout — REMOVING the centered app-shell `.mobile-logo`. Desktop is already top-left
(unchanged — leave it).

Scope: rework the mobile header so the logo is top-left. **Decide** (you and the PE)
what happens to the mobile search once the logo is no longer centered above it — e.g.
logo top-left with search beside or below it — keep it clean and usable. The bottom-nav
app-shell (Home/Playlists/Dark/Settings) **STAYS**. Preserve a11y (aria-labels, the
FileTube-home link), the `safe-area-inset-top` handling, and NO regression to
theme/icon/appearance. This is `[MANUAL]`-visual (Dean confirms on-device); low risk,
small diff, SEPARATE commit from the hardening.

## Constraints (all items)

- Node 22, `node:test` (`npm test`), ESLint (`npm run lint`, **0 errors**; the 11
  "defined but never used" exported-globals warnings are the allowed baseline).
- Additive / zero-regression; ships to prod Docker `deantammam/filetube` on a `v*.*.*` tag.
- Every feature/bugfix ships tests (CONTRIBUTING). Keep FFmpeg out of the automated suite.
- The two items must be independently revertible (separate commits/tasks).

## Open questions to surface (do NOT block — propose a default for each)

1. **Headline for the design gate:** which hardening approach? (write-queue/mutex vs.
   in-memory source-of-truth + atomic writes vs. locked whole-file with fresh-read-in-lock.)
   Flag this as the PE's call — the EM will relay the PE's proposal to Dean.
2. Should the serialized path be sync (all writes through one queued function) or is a
   full in-memory db object with periodic/debounced atomic flush acceptable given the
   crash-safety requirement? Note the trade-off for the PE.
3. Does simplifying/removing the v1.8.0 re-read-merge risk any of the FR1/FR3 invariants,
   or should it stay as a belt-and-suspenders inside the lock? (PE decides.)
4. Item 2 mobile search placement — propose beside-or-below and let Dean confirm on-device.

Do NOT re-open the mobile-logo top-left decision. When done, tell the coordinator the
work is complete so the EM can route to the Principal Engineer (`/prep-pe-design`).
