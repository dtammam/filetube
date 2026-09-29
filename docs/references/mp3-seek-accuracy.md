# Chapter taps on yt-dlp MP3s: seek accuracy (PARKED 2026-09-29)

Status: **parked, not fixed, iOS not measured.** Tracker #290. Scripts that re-run every
measurement below are in [`mp3-seek-lab/`](mp3-seek-lab/).

## The report (Dean, 2026-09-29)

- A song downloaded through yt-dlp as audio is an `.mp3`. Chapter 1 came in at 1:29, which
  on desktop played the end of the previous song, so Dean edited it to 1:35.
- On desktop, a tap on that chapter is aligned. On the iPhone (Safari and the PWA) the chapter
  reads 1:35 and the clock reads 1:35 after the tap, but the audio is early or late.

## What the code says (checked, not guessed)

- **No mobile-only path.** The phone and desktop get the same bytes from `/video/:id` through
  the same Range helper (`lib/media/streams.js` `sendRangeable`). A chapter tap sets
  `currentTime` on both: the player's Chapters menu via `seekToChapterTime`
  (`public/js/player.js`), a Music chapter row via `handleResumePlayback` -> `resumeDirectly`
  on a fresh load. `fastSeek` is only in the lock-screen `seekto` handler. The
  background-audio sidecar is only for video items.
- **The file is VBR.** `lib/ytdlp/args.js` passes `-x --audio-format mp3` with no
  `--audio-quality`, so yt-dlp's default (`-q:a 5`, VBR) applies (yt-dlp's default from
  memory, not read at source). `--embed-metadata --embed-thumbnail --embed-chapters` remux
  with stream copy; ffmpeg rewrites the Xing header (with its 100-point TOC) each time.
- **A Music chapter tap can legitimately start mid-chapter**: a saved place inside the chapter
  resumes (`chapterResumeSecFor`, `public/js/music.js`), and a tap on the chapter already
  playing keeps playing (`chapterAdoptSeekFor`). A place saved before an edit that moved the
  start later is already handled (it plays from the chapter head). Tell: the clock right after
  the tap is not the chapter start.

## Measured (headless Chromium, 2026-09-29)

A synthetic 7:23 album built the way yt-dlp builds one (`build-album.sh`: libmp3lame
`-q:a 5`, metadata + chapters remux, a 66 KB cover in the ID3 tag; the probe confirms a Xing
header with a TOC, encoder `Lavc61.3`). It was served by the real `sendRangeable`, directly and
through a 300 KB/s proxy. After each seek the page recorded the element's output and located
it in a full decode of the file (normalized cross-correlation), giving where the sound IS
against what `currentTime` SAYS. A no-seek control measured -0.03 s (output latency).

| clock | MP3 lands | m4a (AAC) lands |
|---|---|---|
| 0:25 | 1.64 s early | 0.02 s |
| 1:28 | 1.57 s early | 0.02 s |
| 2:46 | 1.49 s late | 0.02 s |
| 3:44 | 1.04 s early | 0.02 s |
| 5:07 | 0.02 s | 0.02 s |
| 6:15 | 1.68 s early | 0.02 s |

- The MP3 error is **deterministic**: identical (within ~0.01 s) for a fresh-load seek (the
  Music chapter tap) and an in-play seek (the Chapters menu), on a fast and a slow link.
- It changes sign with position, which matches "early or late".
- m4a lands exactly (the same 0.02 s as the no-seek control) on every path.
- The synthetic audio is noise, whose V5 bitrate varies less than real music (mostly
  64 kbps), so real files can plausibly miss by more.

## What this means

1. **Desktop is not ground truth.** Chrome mis-seeks VBR MP3 too, so "aligned on desktop"
   means aligned with Chrome's estimate. The 1:29 -> 1:35 edit was tuned by ear against a
   seek, so it likely bakes in Chrome's error. The iPhone estimates differently, lands
   elsewhere, and sounds off, without iOS being uniquely broken.
2. **The header probe does not predict a browser.** `mp3-seek-probe.js` models three
   estimators (the Xing TOC, the average bitrate, the first frame's bitrate); none matched
   Chrome's measured landings. It reports what the file carries (ID3 size, Xing/TOC, LAME
   delay, embedded CHAP times) but cannot stand in for a device.
3. **A better MP3 seek table is not a fix.** A Xing TOC is 100 byte-offset points of 8-bit
   precision (36 s bins on an hour-long file) and an engine may ignore it.

## Not measured

- **iOS / AVFoundation**: nothing on the dev box runs it. Linux WebKit uses GStreamer (not
  the iPhone's stack) and hung in the harness anyway. Desktop Safari on a Mac uses
  AVFoundation, so it is the nearest non-phone check.
- **Firefox**: headless Firefox produced no audio (the harness timed out even with
  `media.cubeb.force_null_context`).

## When this is picked up again

1. **The discriminating test, free, no re-download:** on the phone AND on desktop, play from
   0:00 without touching anything and note the clock when the song changes (no seek estimate
   is involved). Prediction: both show about the same time (probably near YouTube's 1:29),
   and only a seek disagrees. If desktop's play-through changes at exactly 1:35, this
   explanation is wrong for that file: re-root-cause.
2. **Then m4a on the device:** re-download the song as m4a and tap the same chapter.
3. **The fix, only once 1 and 2 confirm:** default audio downloads to m4a, preferring
   `bestaudio[ext=m4a]` so YouTube's AAC stream is remuxed, not re-encoded. That deliberately
   changes the subscription argv (a byte-parity lock covers it). Existing MP3s: a per-item
   convert is a lossy re-encode that replaces a file (a destructive change: the full gate);
   a re-download is gentler.
4. **Chapter times tuned by ear on MP3s were tuned against a mis-seek.** On an exact file 1:35
   is really 1:35, which may now be late. A converted or re-downloaded file should take the
   source chapter times, not the hand edits.

## Re-running the lab

Copy `mp3-seek-lab/` somewhere scratch, then:

    FF=/path/to/ffmpeg ./build-album.sh        # needs libmp3lame; pip install imageio-ffmpeg has one
    node server.js &                           # :8801 direct, :8802 paced (RATE=bytes/s)
    node run.js chromium [filter]              # filter matches name+link+mode, e.g. mp3fastfresh
    node mp3-seek-probe.js album.mp3 1:29 1:35 # header facts + estimator predictions (no deps)

`server.js` and `run.js` resolve the repo and `tools/capture`'s Playwright relative to
`docs/references/mp3-seek-lab/`; from a copy elsewhere, point those two paths at the repo.
The page loads through the same origin as the media on purpose: cross-origin media into
Web Audio is silenced.
