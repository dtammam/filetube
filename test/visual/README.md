# Visual and geometry fixtures (UI professionalism pass)

The seeded instance the visual job (plan D10.5) and the geometry checks (D10.2)
run against. Everything is synthetic: fictional channels, drawn thumbnails and
art, silent audio. No real library, no creators' images, no ffmpeg.

## The two runners (what CI runs)

    node test/visual/run.js [--update] [--era 2021,2005|all] [--only 04,18] [--jobs N]
    npm run test:geometry          # G1-G4 (test/geometry/run.js); --fast = the 4 pre-push scenes

Each run seeds its data dir, boots a FRESH read-only server on a free port
(`server.js`: it waits for the boot scans to finish), captures or measures, and
stops the server. `run.js` diffs every shot against `baselines/` with
`tools/capture/compare.js` (channel threshold 16, AA-suppressed) and fails on a
single changed pixel, a missing or extra shot, or a scene that did not capture;
the report and side-by-side crops land in `--out` (default
`<tmpdir>/filetube-visual-run`). `--out` is emptied at the start of every run, so
run.js refuses (exit 2, nothing touched) a dir that is not empty and lacks its
`.filetube-visual-run` marker, and always refuses `/`, the repo root and `$HOME`.
With no baselines it fails with "no baselines - run the rebaseline job".

Baselines come ONLY from the `rebaseline` job of `.github/workflows/visual.yml`
(Run workflow, in the pinned Playwright container); download its artifact into
`baselines/` and commit it as its own commit. `--update` on a dev box is for
experiments: fonts and raster differ outside the container. A full `--update`
replaces the whole set; with `--era` or `--only` it replaces only the baselines
inside that filter and keeps the rest.

## Pieces

    node test/visual/seed.js [--data DIR]          # build the DATA_DIR (wipes a dir it made; refuses any other)
    test/visual/start-server.sh [DIR] [PORT] &     # serve it read-only (FILETUBE_READONLY=1), default :3917
    BASE_URL=http://127.0.0.1:3917 node test/visual/capture.js [--data DIR] [--out DIR] [--only 04,18] [--era all] [--dpr 1] [--no-rotation]

`DIR` defaults to `$VISUAL_DATA_DIR`, else `<tmpdir>/filetube-visual-data`
(`run.js` defaults to the fixed `/tmp/filetube-visual-data`, the path CI shoots
the baselines from: media ids hash the file path). `capture.js` needs Playwright
from `tools/capture` (`cd tools/capture && npm ci && npx playwright install chromium`)
and reuses its request policy (every context is a `newGuardedContext`: mutations
never leave the browser) and image settling.

The fixture (`<DIR>/fixtures.json` lists the ids):

- Library: Harbor Workshop (10 videos; subscribed, notify on), Northbound Field
  Notes (6; channel identity, not subscribed), Home Videos (6; no channel).
- yt-dlp subscriptions: Harbor Workshop (3 new), an audio-only one, a paused one
  with a long name, and one whose last check failed.
- Music: 3 artists x 2 albums x 4 tracks. Podcasts: 2 shows x 5 downloaded episodes.
- Books (`bookslib/`, indexed by the real scanner): two shelves, Harbor Library (4
  EPUBs) and Night Reading (2 EPUBs + a cover-less PDF). The EPUBs are tiny valid
  stored zips with drawn PNG covers and 2-3 chapters each; two are in progress (the
  Continue shelf), one is liked and Harbor Library is pinned.
- 6 unread notifications, a 3-item queue, watch progress on 3 Home Videos.

## Determinism (0 changed pixels between two runs of one tree)

- **Clock.** `run.js` seeds with `SEED_NOW` = 2026-09-01T12:00Z (`server.js`), so
  every row, including the ones the real routes stamp (watch progress), is written
  on a fixed date (`clock-shim.js` in the seed process). The server and the browser
  start their wall clocks at `viewNow` = seed + 1 hour (`clock-shim.js` via
  start-server.sh; `capture.js installPinnedClock` as an init script) and flow from
  there, so relative dates read the same on every run and every calendar day. No
  timer is faked.
- **Pollers off.** Library re-scan timer (seeded `scanIntervalMinutes` 0), yt-dlp
  subscription poll (`FILETUBE_YTDLP_POLL_MINUTES=0`), podcast feed poll (seeded
  `pollMinutes` 0; a long-running server used to re-check the feeds and change a
  status line), yt-dlp boot one-shots and folder migration (`FILETUBE_READ_ONLY_MEDIA=1`);
  the downloader-engine daily tick skips the fixture's bundled engine.
- **Browser.** Timezone UTC, locale en-US; one CPU raster thread, no partial raster,
  SwiftShader, no font hinting (LESSONS 7); `Math.random` seeded per document (Pocket's
  menu preview picks a random album's art); a fresh browser per viewport; DPR 1 in
  the visual job; reduced motion; animations frozen at their end state.
- **Masks.** The subscriptions status line, notification times, the watch page's
  added date and file path (the DATA_DIR) keep their boxes but not their glyphs.

Scene ids follow the 2026-09-27 audit's baseline index (01-30 surfaces, 40-42
Pocket skins, plus the Pocket rotation screencast, which `run.js` does not diff;
geometry check G4 measures that sequence instead); 50-54 are Books and the reader.
