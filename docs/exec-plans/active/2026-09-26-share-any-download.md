---
plan: share-any-download
harness: v2 · lean
branch: feat/v1.337-share-any-download
anchor: outcome
status: Building
next: the gate (adversary + qa, fresh, max two rounds).
gate: pending
---

# v1.337.0: Share for non-YouTube downloads

## The ask (Dean, 2026-09-25, verbatim, ROADMAP Planned)

"I want us to make it so that we can share content that is not YouTube downloads. So for example, I'm
downloading some things supported by YTDLP, like Facebook and Reddit ... it's watching them as like a
95% first class experience ... There's no share button ... a share button that basically just shares
the logged URL of whatever it is that we captured. I'm not really asking for anything else."

### Dean's ruling at intake (AskUserQuestion, 2026-09-26)

- **Watch page only**: the video page's Share button reads the URL from the file itself; works for
  every past and future download; nothing new stored in the library; card Share corners stay
  YouTube-only. (Declined: storing the URL in the library for cards and search.)

## Acceptance (outcome anchor)

1. A yt-dlp download from any non-YouTube site (an item carrying `sourceExtractor`) shows the Share
   button on its watch page, and it shares the page URL yt-dlp recorded for that download.
2. It works for downloads made BEFORE this release (the URL comes from the file's own tags).
3. Everything else is unchanged: YouTube items share exactly as before (incl. "Share at current time"
   and the chapter share icons); a plain local file (not a yt-dlp download) gets no Share; card
   corners, search and the music skins are untouched; the watch route's response is byte-identical
   for every item that is not a non-YouTube yt-dlp download.

## Research

- The client already shows Share whenever the watch route sends `mediaData.watchUrl`
  (public/js/watch.js setupShareButton). The server derives `watchUrl` ONLY from a safe `youtubeId`
  (`buildWatchUrl`, lib/ytdlp/url.js) at four serve sites (lib/media/routes.js x2, server.js, the
  search registry).
- `watchUrl` is NOT only the Share button's: watch.js spreads mediaData into `player.load`, and the
  player's chapter rows share `currentData.watchUrl` with a `?t=` start (player.js ~7571); the music
  skins' share reads `item.watchUrl` (skin-surface.js). A Reddit / Facebook link must reach neither,
  so the non-YouTube link is a NEW field, `sourceShareUrl`, read only by the watch page's Share.
- The library does not persist a non-YouTube download's URL: the scan writes `sourceExtractor` /
  `sourceId` (lib/scan/orchestrator.js, from the universal download meta, which carries no URL).
- Every download runs with `--embed-metadata` (lib/ytdlp/args.js:1219), and yt-dlp's metadata
  post-processor writes the page URL (`webpage_url`) into the file's `purl` and `comment` tags.
  server.js already reads it: `probeEmbeddedTags` -> `parseEmbeddedSourceUrl` (purl, then comment,
  any http(s) URL).
- The local dev library has 284 items, 0 with `sourceExtractor` (read-only query on a copy), so the
  real distribution cannot be measured here; the build is measured on a real tagged file instead.
- Verified at primary source (yt-dlp master, yt_dlp/postprocessor/ffmpeg.py:749):
  `add(('purl', 'comment'), 'webpage_url')`; with `--compat-options embed-metadata` the `comment`
  becomes the description instead (FileTube passes no compat options: lib/ytdlp/args.js). yt-dlp
  passes no `-movflags +use_metadata_tags`, and the MP4 muxer drops the non-standard `purl` without
  it - measured with the box's ffmpeg: an MP4 written with both keys reads back `comment` only; with
  `+use_metadata_tags` both. So an MP4 download's URL lives in `comment`, which the parser reads
  after `purl` (MKV / WebM keep both).

## Design

- `lib/media/source-share.js` (new): `sanitizeSourceShareUrl(raw)` (pure: http(s) only, parses as a
  URL, no credentials, no whitespace or control characters, at most 2048 characters) and
  `createSourceShareResolver({ probe, stat })`: resolves an item's share URL from its file's tags,
  cached per file path and keyed by size + mtime (a replaced file is re-read), a bounded cache, a
  time limit on the probe, and never rejects.
- `GET /api/videos/:id`: only when the item has no YouTube `watchUrl` AND carries a `sourceExtractor`
  does the route await the resolver and add `sourceShareUrl`; every other item keeps the synchronous
  path and a byte-identical response.
- watch.js: the Share button mounts for `watchUrl || sourceShareUrl`; the "Share at current time"
  choice stays YouTube-only (a `?t=` means nothing to another site); the label says "the original
  link" for a non-YouTube item.

## What was built

- `lib/media/source-share.js` (new): `sanitizeSourceShareUrl`, `wantsSourceShareUrl`,
  `createSourceShareResolver` (cache per file path keyed by size + mtime, at most 500 files, least
  recently used evicted; a 1.5s probe limit; a failed or timed-out probe is not cached; never rejects).
- server.js: the resolver on `probeEmbeddedTags` + `fs.promises.stat`, handed to the browse routes.
- lib/media/routes.js `GET /api/videos/:id`: the response object is built as before; only an item the
  resolver `wants` (a `sourceExtractor`, a file path, no YouTube `watchUrl`) awaits it and gains
  `sourceShareUrl`; the RBAC 404 still runs first.
- public/js/watch.js: `shareLinkOf` (watchUrl, else sourceShareUrl); the time choice only for the
  YouTube link; the button's title and aria-label follow the link kind and are set on every item.

### Measured (copied from the runs)

- `node --test test/unit/source-share.test.js`: `# tests 12`, `# pass 12`, `# fail 0`.
- `FILETUBE_TEST_FFMPEG=$HOME/.local/bin/ffmpeg-static/ffmpeg node --test
  test/integration/watch-source-share.test.js` (the real app, a real ffprobe, an MP4 in yt-dlp's
  real shape): `# tests 4`, `# pass 4`, `# fail 0`, `# skipped 0`; without ffmpeg: `# skipped 4`.
- `node --test test/integration/watch-share-button.test.js` (the real watch.js in jsdom, 6 new):
  `# tests 10`, `# pass 10`, `# fail 0`.
- `npx eslint` over the changed files: exit 0.
