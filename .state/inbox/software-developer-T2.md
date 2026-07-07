# Software Developer inbox — T2 (FR-1b: codec probe + codec-aware needsTranscode + lazy wiring)

Feature: **v1.18.0 "iOS playability + player polish"** (feature_id
`v1.18-ios-playability`), branch `feature/v1.18-ios-playability` off `main`
(v1.17.1). This is **Task T2**. It runs **in PARALLEL with T1 and T3** — your
file set (`server.js` + new pure helpers + tests) is DISJOINT from theirs. Do
**not** touch `lib/ytdlp/args.js` (T1) or `public/js/player.js` (T3).

**IMPORTANT — you edit `server.js`, and T4 also edits `server.js` but is BLOCKED
until you finish.** Nobody else will touch `server.js` while you work.

**Review tier: TWO-REVIEWER GATE** (quality-assurance agent + a separate
adversarial `/code-review`). This touches the **ffprobe-on-user-files** call and
grows the **transcode-spawn trigger surface**. The gate proves no guard moved and
no injection surface is widened (the `execFile` conversion below strictly narrows
it).

## Read first (grounding)

- `.state/feature-state.json` — the `tasks` entry `"id": "T2"` is the
  authoritative scope; also read `hard_constraints`.
- `docs/exec-plans/active/2026-07-07-v1.18-ios-playability.md` — read **`## Design`
  → the five `server.js` component-changes bullets (FR-1b parts 1–5)**, the
  FR-1b acceptance criteria, `### Data model changes`, `### API changes`,
  `### Risks and mitigations`, and `### Security preservation notes` → FR-1b.
- `docs/CONTRIBUTING.md` and `docs/RELIABILITY.md` ("never let one bad/corrupt
  file take down a scan"; keep ffmpeg/ffprobe OUT of the automated suite — mock
  their output).
- `server.js` — `extractMetadataAndThumbnail` (the existing scan-time `ffprobe`
  call, `-show_entries format=duration:format_tags`, ~line 899; and the two
  other ffmpeg art/frame `exec()` calls ~920/~927), `parseFfprobeTags` (the pure
  helper to mirror), `needsTranscode`/`TRANSCODE_EXTENSIONS` (~227-231),
  `reconcileTranscode` (~825-844), the scan-time seed (~1193), the
  reuse-unchanged-metadata guard (~1156), `queueTranscode` and the `/video/:id`
  handler (~2159), `processTranscodeQueue` (~724-819, the `-c:v libx264 ... -c:a
  aac` spawn ~744-750).
- `test/unit/pure-helpers.test.js` (the existing `needsTranscode`/
  `TRANSCODE_EXTENSIONS` regression bar) and `test/unit/database.test.js`.

## Task — implement THIS ONE task only (FR-1b), five parts

**Part 1 — ffprobe extension + hardening.** Extend the scan's existing single
`ffprobe` `-show_entries` from `format=duration:format_tags` to
`format=duration:format_tags:stream=codec_name,codec_type` (adds a `streams[]`
array to the SAME single JSON probe — no second spawn). **Convert that one call**
from the shell-string `exec()` to `execFile('ffprobe', [args...], ...)` with
`filePath` as a distinct arg-array element, removing the path interpolation on
the exact line you edit. **Leave the two other ffmpeg art/frame `exec()` calls
as-is** and add a one-line note to `docs/exec-plans/tech-debt-tracker.md` that
they remain shell-string `exec()` (deferred hardening — do not widen the diff).

**Part 2 — pure helpers** (next to `parseFfprobeTags`, so ffmpeg is not needed in
CI):
- `parseFfprobeStreams(input)` — accepts the parsed object OR raw stdout string
  (same robustness contract as `parseFfprobeTags`: `JSON.parse` inside a
  try/catch, returns `{}` on anything malformed, **never throws**). Returns
  `{ videoCodec, audioCodec }` = the lowercased `codec_name` of the first
  `codec_type === 'video'` stream and first `codec_type === 'audio'` stream, or
  `undefined` for a stream type that is absent.
- `PLAYABLE_VIDEO_CODECS = new Set(['h264', 'avc1'])` and
  `PLAYABLE_AUDIO_CODECS = new Set(['aac'])` — named, **exported**, documented
  allowlist constants mirroring `TRANSCODE_EXTENSIONS`.
- `codecNeedsTranscode(videoCodec, audioCodec)` — returns `true` only on a
  **positive** identification of a non-allowlisted codec:
  `if (videoCodec && !PLAYABLE_VIDEO_CODECS.has(videoCodec)) return true;`
  `if (audioCodec && !PLAYABLE_AUDIO_CODECS.has(audioCodec)) return true;`
  `return false;`. `undefined`/missing codecs → `false` (a failed/ambiguous probe
  must never *falsely* flag a file — this is the "degrade safely" AC).

**Part 3 — generalize `needsTranscode`.** Change the signature to
`needsTranscode(ext, videoCodec, audioCodec)` with the codec args **optional**:
`if (TRANSCODE_EXTENSIONS.includes(ext)) return true;` (existing extension flow
preserved exactly), then `return codecNeedsTranscode(videoCodec, audioCodec);`.
Called with one arg it must be **byte-identical** to today (every existing
`pure-helpers.test.js` case passes unchanged). Update the `reconcileTranscode`
call site to `needsTranscode(item.ext, item.videoCodec, item.audioCodec)` (the
authoritative recompute, running after the probe attaches codecs to the item).
**Leave the scan-time seed (~1193) ext-only** — codecs aren't known yet there;
`reconcileTranscode` overwrites it.

**Part 4 — item model + one-time backfill.** Store the probed codecs on the item
alongside `duration`/`tags`: `item.videoCodec` / `item.audioCodec` = the probed
lowercased string, or `null` when the probe ran but that stream type was absent
(so a probed-but-no-video item is distinguishable from an un-probed one after a
JSON round-trip). Extend the reuse-unchanged-metadata guard (~server.js:1156) so
a **video** item is only reused when it already carries the codec fields — a
pre-v1.18 entry is re-extracted **once** on the next scan to backfill (probe-only,
never an eager transcode). Audio items skip this (`reconcile` short-circuits
`type === 'audio'`).

**Part 5 — lazy transcode wiring: NO new code.** Codec-flagged files must ride the
**existing** lazy pipeline: `reconcileTranscode` only seeds/clears status (no
queue kick); the real `queueTranscode` fires on first mobile watch in
`/video/:id` exactly as for AVI today; `player.js` already branches on
`needsTranscode`/`transcodeStatus`. Do **not** introduce any eager, scan-time
transcode-triggering path. Do **not** change `processTranscodeQueue`'s spawn.

## Hard constraints (non-negotiable — the gate will verify each)

- **No regressions.** Every existing extension case (`.avi`/`.flv`/`.wmv`/`.mpg`/
  `.mpeg` transcode; web-native containers don't; case-sensitivity) passes
  unchanged through the generalized `needsTranscode`. The desktop `?live=1`
  path, the mobile lazy-transcode + preparing-overlay + poll, the transcode
  cache's size-capped LRU eviction, and the single-worker queue are reused
  **unchanged** — only the trigger set grows.
- **Codec allowlist is H.264/AVC video + AAC audio ONLY** — HEVC/VP9/AV1/AC-3/
  DTS/E-AC-3 etc. are deliberately NOT allowlisted (per Dean's stated intent).
- **Probing is free, transcoding stays lazy.** Codec probe piggybacks the
  already-running per-file ffprobe call; NEVER eager-transcode a library on scan.
- A per-item probe failure (ffprobe unavailable, malformed output, unreadable
  file) degrades safely — the item is NOT flagged on bad data and the scan
  continues for every other file.
- No new runtime dependencies. 2-space/semicolons/single-quotes. Lint 0 warnings.

## Tests

Use `node:test` with **MOCKED ffprobe output** (ffmpeg stays out of CI per
`docs/RELIABILITY.md`):
- `parseFfprobeStreams`: parsed-object and raw-string inputs; malformed/empty →
  `{}`; video-only, audio-only, both, neither; lowercasing.
- Allowlist + `codecNeedsTranscode`: h264/avc1 + aac pass; HEVC/VP9/AV1/AC-3/DTS
  flag; `undefined`/missing → `false` (degrade-safe).
- Generalized `needsTranscode`: all existing extension cases unchanged (one-arg
  call byte-identical); codec-triggered `true` for a web-safe container with a
  non-allowlisted codec.
- Integration test (mocked ffprobe) for `reconcileTranscode` status transitions
  on an HEVC-`.mp4` fixture (seed `pending`, clear stale `ready`, leave in-flight
  alone, clear the flag when a file no longer needs transcoding).

## Toolchain / commands

Node 22 standard. Export the fnm node PATH first, then use the Node 22 test bin:

- `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`

Run `npm run lint` (0 warnings) and `npm test` (green on Node 22). Fix any
failure before reporting done.

## Git — DO NOT commit

The **coordinator (EM) owns ALL git**. Do NOT stage, commit, or push. Report
files changed + full lint/test output; the coordinator commits per task.

## Report back

- Files changed (paths + one-line summary each).
- The new helper signatures + the allowlist constant contents.
- Confirmation the `execFile` conversion is on the one probe line only (and the
  tech-debt note for the two remaining `exec()` calls).
- Confirmation NO eager scan-time transcode path was added (part 5 is
  wiring-only).
- Confirmation every existing `pure-helpers.test.js` extension case still passes.
- Lint + Node 22 test result.
- Any deviation or new fork (with a recommendation) — do NOT expand into T1/T3/T4
  files. **Signal clearly when T2 is done/verified so the coordinator can unblock
  T4.**
