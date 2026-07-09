# T16 — A6 subtitles grab + serve + CC toggle (v1.24, Wave 5)

**Cluster A · FR A6 · Gate: light-to-medium · Depends on: none**

Read at wave start: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
(`## Design` A6; `## Task breakdown` T16). This is the ONE deliberate exception
to the "don't touch player controls" exclusion — the CC button only; do NOT
otherwise redesign the control bar.

## Files you own (edit ONLY these)
- `lib/subtitles.js` (NEW)
- `lib/ytdlp/args.js`
- `server.js` — W5 owner (subtitle scan flag + serve route).
- `public/js/player.js` — W5 owner.
- `public/index.html` + `public/watch.html` — the player-hosting shells
  (`<track>` + `#cc-btn` markup, byte-identical where the control markup is
  duplicated).

## Scope
- **Grab (fixed-literal argv, `args.js`):** add
  `--write-subs --write-auto-subs --sub-langs en.* --sub-format vtt
  --convert-subs vtt` to `buildYtdlpDownloadArgs` — all fixed literals, NEVER
  interpolated (same posture as `SHORTS_MATCH_FILTER`/`VIDEO_FORMAT_SORT`).
  Requesting VTT directly + `--convert-subs vtt` (bundled ffmpeg) means NO
  converter and NO new dependency for downloads. Sidecar lands per
  `OUTPUT_TEMPLATE`: `%(title)s [%(id)s].en.vtt`.
- **Local `.srt`:** a tiny pure `srtToVtt(text)` in `lib/subtitles.js`
  (hand-rolled: prepend `WEBVTT`, `,`→`.` in timestamps, strip cue numbers) —
  no dependency. Scan sets additive `db.metadata[id].hasSubtitles = true` when a
  sibling sidecar (`<base>.<lang>.vtt`/`<base>.vtt`/`<base>.srt`) exists —
  schema-only, no thumbnail/transcode re-processing.
- **Serve route (`server.js`, NOT the ytdlp module — must work for local files
  with yt-dlp DISABLED):** `GET /api/subtitles/:id` resolves `filePath`, finds
  the sibling sidecar under the SAME path confinement the media serve path uses,
  converts `.srt`→`.vtt` on the fly via `srtToVtt`, sets `text/vtt`, 404s when
  absent.
- **Render (the one approved player exception):** add a `<track kind="captions"
  srclang="en">` to the persistent `<video>` host and a `#cc-btn` on the control
  bar, wired ONCE like `#pip-btn`/`#speed-btn`. The `<track>` rides the
  reparented host across FULL/DOCKED/close; `load()` sets `track.src =
  '/api/subtitles/' + id` and shows `#cc-btn` ONLY when `hasSubtitles`
  (availability is the ONLY gate — NEVER a second mobile-detection signal). If the
  control markup is duplicated across the player-hosting shells, the `#cc-btn`
  addition is byte-identical (four-shell parity where applicable).

## Frozen cross-file contracts
- `db.metadata[id].hasSubtitles` additive boolean; backfill triggers no
  re-processing.
- `GET /api/subtitles/:id` works with `FILETUBE_YTDLP_ENABLED=false` (local
  files). The GRAB additions are gated in the yt-dlp module (disabled no-op).

## Acceptance criteria (exec-plan A6)
- [UNIT][A] subtitle flags are fixed-literal argv additions (never interpolated).
- [UNIT][A] `srtToVtt` (or the documented VTT-direct decision) has coverage; no
  new runtime dependency.
- [UNIT][A] scan picks up a local sidecar without affecting thumbnail/transcode
  reconciliation for files with no sidecar.
- [MANUAL][A] a CC button appears only when a caption track is available;
  toggling shows/hides captions; no other control-bar element changes.
- [PROCESS][A] four-shell parity confirmed where control markup is duplicated.

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + 8
  pre-existing `common.js` warnings baseline — add none). `srtToVtt` gets
  `node:test` coverage.
- **Standards:** CommonJS, 2-space/semicolons/single-quotes; arg-array spawn +
  `--` separator + no `shell:true`; `textContent` over `innerHTML`; NO new
  runtime dependencies (the subtitle conversion approach is bound by this).
- **Ownership:** edit ONLY the six files above. Need another file? STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
