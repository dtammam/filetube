# Kickoff prompt: the TTS wave ("Listen from Here" + book-folders Settings UI)

Dean: paste everything below the line to Opus 4.8 to start the wave, or just
say "read docs/TTS-WAVE-KICKOFF.md and begin." Written by Fable 5 at handoff,
2026-07-13.

---

You are picking up FileTube from your predecessor. Before anything else:

1. Read **docs/CLAUDE-WORKING-STYLE.md** — it is the process contract for
   working with Dean (lean mode, the two-reviewer adversarial gate, honesty
   norms, his communication style, the repo's expensive lessons). Your
   persistent memory directory is already loaded and carries project state.
2. **Check Dean's pending on-device verdicts first.** v1.37.3 (explicit-pixel
   epub pagination) and v1.37.4 (home-row page-width fix) shipped without his
   re-test. Ask how the reader feels now; fix any residue as hotfixes before
   starting the wave. The next pagination levers, if needed, are documented in
   memory (flow:'scrolled-doc' fallback, manager:'continuous').

## The wave

Two deliverables, one release train (Dean has called it v1.37.5; ROADMAP
reserved v1.38 — confirm the number with him at kickoff):

**Part A — book-folders Settings UI** (small, ship-ready spec): a "Book
folders" section on setup.html mirroring the media-folders UI, wired to the
EXISTING `GET/POST /api/books/config` (which already validates existence,
dedup, and media-folder overlap both directions) plus a "Scan books now"
button on `POST /api/books/scan`. Config has been API-only since v1.37.0 —
this closes a disclosed gap.

**Part B — TTS "Listen from Here"** — the fully-designed wave-2 of the books
platform. The authoritative design is
**docs/exec-plans/completed/v1.37.0-books.md §6 ("Wave-2 seams")**. The seams
are already IN the shipped code; honor them exactly:

- State: `db.books.settings` (`ttsEnabled, engine, voice, rate`) +
  `db.books.audio[bookId][spineIndex] = {status, key, durationSec}`
  (no-clobber write style; both keys already reserved by `ensureBooks`).
- Cache: `DATA_DIR/tts-cache/<key>.m4a` + `<key>.blocks.json`
  (`[{blockIndex, startSec}]`). Key =
  `sha1(bookId:spineIndex:engine:voice:rate:ttsRev)`.
- **Listen-from-Here mechanism**: the reader already persists
  `locator.{spineIndex, blockIndex}` per book. Ensure the chapter's audio,
  look up `blocks[blockIndex].startSec`, seek there. No per-offset cache
  entries, no re-synthesis on position change.
- **The block contract**: the server-side text chunker MUST split chapter
  XHTML (extract it with the existing `lib/books/zip.js`) by EXACTLY the
  rule in `READER_BLOCK_SELECTOR` (public/js/read.js): block-level elements
  `p, h1..h6, li, blockquote, pre, figure, td` in document order. Any change
  to the rule bumps `ttsRev` in BOTH places, in lockstep.
- Synthesis: single-worker serialized FIFO (the `runExclusive` pattern —
  lib/ytdlp/index.js — long cancelable jobs); the engine is SPAWNED per job
  with an arg array (never a shell; ytdlp-spawn-security posture) and exits
  after — RAM discipline comes from that architecture, not the engine
  (Dean's box: ~12GB shared, ~7.5GB available). Engines emit WAV; the
  EXISTING ffmpeg encodes to m4a (arg-array execFile, like
  buildAudioExtractArgs). Synthesize on demand + one chapter ahead of
  playback, never whole-book pregeneration.
- Engine: **Piper** as the default, STRICTLY OPT-IN exactly like yt-dlp
  (env-configured binary/model path, absent = books still fully work, the
  Listen button simply doesn't light). **espeak-ng** as the guaranteed
  fallback engine choice. Verify Piper's actual CLI flags against its
  documentation/source before building argv — the source-verification norm
  exists because plausible flag assumptions have shipped inert twice.
- Serving: `GET /book/:id/tts/:spineIndex` (sendFile; ranges free). Playback
  goes through the EXISTING background-audio machinery in public/js/player.js
  (hidden audio element + MediaSession; battle-won over v1.27→v1.35 — reuse,
  never rebuild), with the book cover as artwork (`resolveAudioArtUrl`
  precedent). TTS audio lives inside the book experience only; architect the
  cache/naming so a later "export as audiobook" stays cheap (Dean wants that
  eventually).
- Reader UX: a "Listen from here" control in the reader; per-chapter audio
  status surfaced honestly (pending/processing/ready/failed); the now-playing
  bar shows the book.

## Process expectations for this wave

- **Ask Dean your questions FIRST** — numbered, with your recommendation
  inline. Known open questions: Piper voice choice (one default vs
  selectable), how the binary+model get into HIS Docker image (he owns the
  image), whether synthesis is allowed on his box during subscription polls
  (disk contention), the wave's version number.
- Write the exec plan to `docs/exec-plans/active/` before building; small
  task commits, each tested (stub the TTS binary on PATH like the
  stub-ffmpeg harness in test/integration/transcode-execution.test.js).
- **Full two-reviewer gate** (QA + adversarial; the adversarial seat verifies
  Piper/ffmpeg flag interplay against source), fix rounds, delta re-confirms,
  dual-Node suites (fnm PATH export first — always), release ceremony.
  Docker publish is Dean's.
- Close with his on-device probe list. The proof of this wave is: open a
  book on his iPhone, tap "Listen from here," lock the screen — it keeps
  reading to him from the right paragraph.

That last sentence is the whole point. Build toward it.
