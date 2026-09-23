# Wave 7b, slice S9 - the scan orchestrator leaves server.js (R3, parallel with S8)

Read brief-r3-common.md, brief-parallel.md, brief-s1a.md. Base: `feat/wave7b-r3` at BASE_COMMIT
(S5, S6, S7 merged). Worktree `.claude/worktrees/w7b-s9`, branch `w7b/s9`. THE RISKIEST SLICE OF
THE ARC: `runScanDirectories` holds the persist-gate seams (re-init carry-forward, the Phase-2
merge guard, the persist-gate OR-chain, the final-merge gap-fill - the 5-strike class), the
epoch guard, HR1b. Bodies move BYTE-IDENTICAL; nothing is "improved". S8 (the transcode queues)
runs in parallel and moves the queue API your code calls - pass LAZY wrappers for every
function on S8's list (`queueAudioExtract`, `reconcileTranscode`, `isInFlightTranscode`,
`isCompletedTranscode`, `queueTranscode`, `queueRokuCompatBuild`); `trashOrphanFile` (S5) is
merged already - pass it directly.

## The move (census: 7 functions, 2,008 lines, 73 external deps)
`runScanDirectories` (1,566), `extractMetadataAndThumbnail` (125), `scanDirRecursive` (94),
`extractStoryboard` (58), `parseFfprobeStreams` (52), `resolveLeafByBracketId` (61),
`resolveOnDiskPath` (52) -> lib/scan/orchestrator.js, `createScanOrchestrator(deps)` returning
them. `scanDirectories` (the exported entry with the scan lock / `scanState` / the interval)
STAYS in server.js and calls the factory result; `scanState` is mutable state read by
`/api/scan-status` (lib/config/routes.js) and the scan - rule 3: it stays in server.js and
crosses as the same OBJECT only if it is never reassigned (prove it; else a live accessor).
`persistedStateEpoch` (a `let`?) - same rule. `maybeYieldScan`, `stats`, `pushDelivery` - deps.
The lib/scan/ helpers (roots, merge, identity, captured, probe - Wave 6) are already modules:
require them from the orchestrator directly (re-rooted paths) rather than through deps, and
say so.
External deps (73, census - VERIFY each; scope-shadowed names are false positives): the lists
in `node scripts/monolith-split-census.js --json` for these functions. `needsTranscode` and
`TRANSCODE_EXTENSIONS` stay in server.js (tv-scan.test.js parses server.js's text) and cross
as deps.
Locks/tests: test/unit/scan-helpers-extraction.test.js (re-exports the same function objects -
keep every re-export), tv-scan.test.js, scan-*.test.js, the persist-gate suites (grep test/ for
`persist`, `carry`, `epoch`, `HR1b`, `scanDirectories`), media-items-atomicity (a real scan
indexes; an unchanged rescan writes ZERO rows - measured on the adapter's accounting),
move-scan-survives, repull-*, delete-tombstones - run them ALL and report counts verbatim; any
failure verbatim then diagnosed, never re-run into green.
