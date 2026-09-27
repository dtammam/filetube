# Visual and geometry fixtures (UI professionalism pass)

The seeded instance the visual job (plan D10.5) and the geometry checks (D10.2)
run against. Everything is synthetic: fictional channels, drawn thumbnails and
art, silent audio. No real library, no creators' images, no ffmpeg.

    node test/visual/seed.js [--data DIR]          # build the DATA_DIR (wipes a dir it made; refuses any other)
    test/visual/start-server.sh [DIR] [PORT] &     # serve it read-only (FILETUBE_READONLY=1), default :3917
    BASE_URL=http://127.0.0.1:3917 node test/visual/capture.js [--data DIR] [--out DIR] [--only 04,18] [--no-rotation]

`DIR` defaults to `$VISUAL_DATA_DIR`, else `<tmpdir>/filetube-visual-data`; shots
go to `<tmpdir>/filetube-visual-shots`. `capture.js` needs Playwright from
`tools/capture` (`cd tools/capture && npm install && npx playwright install chromium`)
and reuses its request policy (every context is a `newGuardedContext`: mutations
never leave the browser) and image settling.

The fixture (`<DIR>/fixtures.json` lists the ids):

- Library: Harbor Workshop (10 videos; subscribed, notify on), Northbound Field
  Notes (6; channel identity, not subscribed), Home Videos (6; no channel).
- yt-dlp subscriptions: Harbor Workshop, an audio-only one, a paused one with a
  long name.
- Music: 3 artists x 2 albums x 4 tracks. Podcasts: 2 shows x 5 downloaded episodes.
- Books (`bookslib/`, indexed by the real scanner): two shelves, Harbor Library (4
  EPUBs) and Night Reading (2 EPUBs + a cover-less PDF). The EPUBs are tiny valid
  stored zips with drawn PNG covers and 2-3 chapters each; two are in progress (the
  Continue shelf), one is liked and Harbor Library is pinned.
- 6 unread notifications, a 3-item queue, watch progress on 3 Home Videos.

Not yet deterministic across machines (step 4 of the plan closes these before the
CI diff runs at 0 changed pixels): media ids hash the file path, so they change with
`DIR` (fixed in CI by a fixed `DIR`); the watch page prints the file path; relative
dates move with the clock (`SEED_NOW` pins the seed's clock; the browser clock is
frozen by the capture, step 4).

Scene ids follow the 2026-09-27 audit's baseline index (01-30 surfaces, 40-42
Pocket skins, plus the Pocket rotation screencast); 50-54 are Books and the reader.
