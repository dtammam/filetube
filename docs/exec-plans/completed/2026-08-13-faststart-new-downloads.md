# Exec plan: app-side faststart for new mp4 downloads (streaming Tier 1)

Status: SHIPPED v1.111.0 (docs reset 2026-08-15; see ROADMAP.md). Was: ACTIVE. Owner: main session. Target ~v1.111.0. Gate: FULL two-reviewer
(DATA-ADJACENT -- it overwrites a media file in place).

## Goal (Dean)

A trailing MP4 `moov` atom (the index) forces the browser to fetch deep into the
file before it can decode/seek -- "slow to start on click." Front-load it
(+faststart) so playback starts + seeks after buffering only the start. This is
Tier 1 of the streaming-robustness thread, "new downloads only" slice (Dean
deferred the existing-library backfill).

## Why NOT the yt-dlp flag (the first attempt, reverted)

`--postprocessor-args "ffmpeg:-movflags +faststart"` sprays an mp4-ONLY muxer
option onto EVERY ffmpeg postprocessor, including ones writing webm/mkv (high-res
VP9/AV1 merges, or an explicit webm/mkv filetype) and the subtitle convertor
(webvtt), where ffmpeg rejects it and exits non-zero -> the download ABORTS with
no file. The slim gate caught it; reverted (b7c0e2e -> 534316d). Dean chose the
app-side remux instead.

## Design: remux the finished .mp4 in our own code

`lib/faststart.js` (pure + tested):
- `probeMp4Faststart(filePath)` -- box-walk (a few KB of headers, no ffmpeg) ->
  `{ faststart: true|false|null }`. `null` for non-mp4-structured / no-moov ("leave
  alone"). Shared with scripts/probe-faststart.js (one box-walker).
- `remuxFaststartInPlace(filePath, deps)` -- the SAFETY core. NEVER loses data:
  probe original; only if `.mp4` + genuinely trailing, `ffmpeg -map 0 -c copy
  -movflags +faststart` to a SIBLING temp; verify exit 0 AND the temp itself
  probes faststart; THEN atomic `rename(temp, orig)` (POSIX rename-over-open keeps
  a concurrent reader's inode alive) and restore the original mtime. On ANY failure
  -> delete temp, keep the original byte-for-byte. Non-throwing. `-map 0` keeps
  every stream (embedded thumbnail / multi-audio), so it's truly lossless.

Scan wiring (server.js, the new-file `else` branch): a 6-part guard --
`!existing` (NEW-to-db only) && `!isAudio` && `!READ_ONLY_MEDIA` && `ffmpegAvailable`
&& under `ytdlpDownloadRoots` (guaranteed writable) && `isFaststartEligible`
(.mp4). Best-effort. On a real remux, `info.size` is refreshed from a fresh stat
BEFORE the entry is built (the remux changes byte length; without the refresh the
next scan sees a size change and re-inits). Scan walk excludes the
`.faststart.tmp.mp4` temp (`isInFlightTranscode`).

## Gate outcome (full two-reviewer gate)

Both seats: the data-safety core is proven in-code (original never replaced by a
bad file on any path; injected-spawn tests non-vacuous). REQUEST CHANGES on cheap
findings, all fixed:
- Missing `-map 0` -> silent stream drop (thumbnail/multi-audio). FIXED (+ comment).
- Crash-left `.faststart.tmp.mp4` in a scan root -> phantom card. FIXED (walk skip
  via isInFlightTranscode).
- The `code === 0` exit-code guard was mutation-SURVIVING (its test masked it via a
  false temp probe). FIXED (temp probes true -> only the exit-code guard stands;
  mutant now dies).

## Verification ceiling (HONEST)

ffmpeg is not in the dev/test env, so the ACTUAL moov-move can't be executed here.
The DATA SAFETY (never lose a file) IS proven in-code + by injected-spawn tests.
The "moov actually moves + streams retained" proof is Dean's DEVICE PASS:
`node scripts/probe-faststart.js --list` must NOT list a freshly-downloaded file,
and the remuxed file must retain its thumbnail/tracks/chapters.

## Disclosed residuals (tech-debt tracker)

- **Full-rebuild re-remux:** `!existing` is "new-or-rebuilt." A fresh db pointed at
  an existing yt-dlp library makes every .mp4 eligible -> a one-time in-place
  faststart of the whole library (lossless, no storage cost, probe-gated so
  already-faststart files cost only a header read). No data loss; a bounded CPU/IO
  cost on that one scan. Acceptable; revisit only if it's a real startup-storm.
- **Crash-orphan clutter:** a hard kill mid-remux leaves a full-size
  `.faststart.tmp.mp4` that the walk now ignores (no phantom card) but nothing
  sweeps (cleanupOrphanTmp is TRANSCODE_DIR-only). A slow disk leak across crashes.
  Revisit trigger: if it's observed accumulating, extend the orphan sweep to the
  download roots.

## Later waves
Tier 1b: existing-library faststart (on-demand cached remux). Tier 2: data-saver
downscale rendition. Tier 3: adaptive HLS.

## Dean's device probes
Download a NEW video -> `probe-faststart.js --list` does NOT list it (moov moved);
it plays + starts fast; its embedded thumbnail/chapters/tracks survive. A local
non-mp4 / read-only-mount file is untouched. An interrupted download leaves no
phantom card after a scan.
