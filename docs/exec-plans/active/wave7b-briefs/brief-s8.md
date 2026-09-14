# Wave 7b, slice S8 - the transcode / audio-extract / roku queues and the byte streams leave server.js (R3, parallel with S9)

Read brief-r3-common.md, brief-parallel.md, brief-s1a.md. Base: `feat/wave7b-r3` at BASE_COMMIT
(S5, S6, S7 merged). Worktree `.claude/worktrees/w7b-s8`, branch `w7b/s8`. S9 (the scan
orchestrator) runs in parallel and CALLS your queue API (`queueAudioExtract`, `reconcileTranscode`,
`isInFlightTranscode`, `isCompletedTranscode`, `transcodedPath`, `queueRokuCompatBuild`...): every
one of those stays exported by server.js as the same object; S9 passes lazy wrappers for them.

## The move (census: 8 functions, 521 lines, 55 external deps; plus 4 route groups, ~221 lines)
- The queue machinery -> lib/media/transcode.js, `createTranscodeQueues(deps)`:
  `processTranscodeQueue` (98), `processAudioExtractQueue` (83), `runChapterSynthesis` (77),
  `evictTranscodeCache` (50), `sweepAgedTranscodes` (55), `processRokuCompatQueue` (50),
  `resolveRokuCompat` (43), and the queue ENTRY points + state they share (`queueTranscode`,
  `queueAudioExtract`, `queueRokuCompatBuild`, the `transcodeQueue` / `audioExtractQueue` /
  `rokuCompatQueue` arrays, the `transcodeBusy` / `audioExtractBusy` / `rokuCompatBusyId` /
  `rokuCompatProbing` / `rokuCompatBlocked` `let`s, the `transcodeProgress` /
  `audioExtractProgress` maps, `setTranscodeStatus` / `setAudioStatus` / `clearAudioStatus`,
  `isInFlightTranscode` / `isCompletedTranscode` / `activeProtectedPaths` / `effectiveCacheCap` /
  `transcodeCacheSize` / `selectEvictions` / `selectAgedOut`). RULE 3 decides each: a `let` or
  mutable object moves ONLY if every reader and writer moves with it (the S4 precedent: its whole
  lane moved); a reader that stays in server.js or in an already-extracted module (lib/config/
  routes.js reads `effectiveCacheCap`/`transcodeCacheSize`; lib/media/routes.js and lib/tv/... read
  status maps; the scan reads the queue API) means the value crosses as a LIVE accessor or the
  function stays. Map every one and report the decision with its referrers. When in doubt the
  state STAYS in server.js and the moved function reads it through an accessor - never a frozen
  copy.
- `sendRangeable` (65) + the byte-stream routes `/video/:id` (129 lines), `/thumbnail/:id` (56),
  `/storyboard/:id` (20), `/preview/:id` (16) -> lib/media/streams.js `registerRoutes(app, deps)`
  (`registerMediaStream` / `recordServed` / `markServed` are deps).
External deps (census, VERIFY): TRANSCODE_CRF, TRANSCODE_DIR, TTS_CACHE_DIR, audioPath, booksDb,
booksStore, booksTtsChunk, booksTtsEngine, booksZip, buildAudioExtractArgs, ffmpegAvailable
(**the mutable boot flag - live accessor, as R2 did**), fs, getCachedDatabase, loadDatabase,
path, pipeline, probeForRokuCompat, readRokuCompatSidecar, recordServed, registerMediaStream,
resolveTtsChapter, rokuCompatLib, rokuCompatRenditionPath, runFfmpeg, settingsStore, spawn,
synthesizeBlock, setTtsStatus, ttsBlocksPath, ttsM4aPath, ttsSettings, updateDatabase,
wavDurationSec, writeRokuCompatSidecar. `TRANSCODE_EXTENSIONS` stays in server.js (a test parses
it out of server.js's text); `needsTranscode` stays (same lock cluster, Wave 6).
Locks/tests: test/unit/tv-scan.test.js (parses server.js), transcode-*.test.js, roku-compat,
audio-extract, chapter-synthesis, stream-leak-*, the cache tests - grep test/ for every moved
name; run them ALL and report counts.
