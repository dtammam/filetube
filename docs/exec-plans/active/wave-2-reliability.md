# Wave 2: reliability hazards (planned - not started)

Status: PLANNED. Date: 2026-08-14. Grounded at `aa06fa2` (v1.122.0).
Do NOT start until Wave 1 (v1.123.0) has shipped and device-passed.

Origin: the external review's item 4 ("enclosure backpressure and
unreadable-book-subtree pruning"). Both claims were RE-VERIFIED against the
tree before this plan was written, and BOTH turned out narrower and more
precise than the review stated - the corrections are recorded below so the
implementing session does not chase the vaguer framing.

## Verified findings (and corrections to the review)

- **R1 - podcast enclosure download has no backpressure.**
  `lib/podcasts/fetchGuard.js` `downloadEnclosure` handles `res.on('data')` by
  calling `out.write(c)` unconditionally (around `:246`) and NEVER checks the
  write stream's return value or waits for `'drain'`. A fast feed origin over a
  slow disk (NAS/SMB - Dean's actual storage) lets Node buffer unbounded in
  memory up to the `ENCLOSURE_MAX_BYTES` cap (`2 * 1024^3` = 2 GB, `:45`). This
  is a memory-pressure hazard, not a correctness bug - the file still lands
  correctly - but on a Pi/small box a few concurrent large enclosures can OOM.
  CORRECTION to the review: the fix is a standard write/drain pause-resume on
  ONE data handler, not a re-architecture. The existing idle/deadline ticker,
  size cap, fsync-then-rename, and .ptpart cleanup all stay exactly as they are.

- **R2 - book prune lacks the errored-subtree guard that music already has.**
  `lib/books/store.js selectPrunableBookIds` (`:88`) guards against WHOLE-ROOT
  mount loss (`missingRoots`) but has NO per-subtree errored-dir guard. The
  music scan solved this exact class: `walkMusicRoot` collects `erroredDirs`
  (`lib/music/scan.js:45,55`) and `selectPrunableTrackIds` refuses to prune any
  track whose `filePath` sits under an errored dir (`lib/music/store.js:72,88`).
  `walkBookRoot` (`lib/books/scan.js:44`) already `console.warn`s on an
  unreadable dir and `continue`s - but DISCARDS which dir failed, so a transient
  EACCES on a book subtree (root still has survivors elsewhere) prunes those
  books AND their per-user reading positions (`server.js:6752
  userStore.removeBookState`). This is a DATA-LOSS class (per-user progress is
  destroyed on a transient permission blip), so this wave takes the FULL gate.
  CORRECTION to the review: this is not "add pruning safety" in the abstract -
  it is "port the music `erroredDirs` guard to books", a mechanical parallel
  with a proven reference implementation and an existing test shape to copy.

## Tasks (each its own commit, each green before the next)

- **T1 - enclosure backpressure.** In `downloadEnclosure`, honor `out.write`'s
  backpressure: on a `false` return, `res.pause()`; resume on the write stream's
  `'drain'`. Preserve every existing guard (size cap checked BEFORE the write,
  idle/deadline ticker, error/end paths). Test with a fake `res`/`out` whose
  `write` returns `false` and asserts `res.pause()` was called and that
  `'drain'` resumes it - deterministic, no real timers.
- **T2 - port the errored-subtree guard to books.** Thread an `erroredDirs`
  out-param through `walkBookRoot` (mirror `walkMusicRoot` byte-for-byte in
  shape), and teach `selectPrunableBookIds` to skip any item under an errored
  dir (copy `selectPrunableTrackIds`'s `fp.startsWith(\`${d}/\`)` predicate, both
  path separators). Wire `erroredDirs` through the book scan caller
  (`server.js` ~`:6700`) exactly as the music caller does (~`:7701`).
  Test: an item under an errored subtree survives a prune even when its file is
  absent from the walk; mutation-verify by deleting the guard and watching a
  per-user reading position get destroyed.

## Machine-derived predictions (re-verified at every commit)

- The music reference the books fix mirrors is three sites:
  `grep -n "erroredDirs" lib/music/scan.js lib/music/store.js server.js`
  (expect walk push, store predicate, scan caller wiring). Books must end with
  the SAME three-site shape. If music's shape has changed by implementation
  time, re-read it first - this plan assumes the `aa06fa2` version.
- No other media walk is affected: `grep -rn "readdirSync" lib/*/scan.js`
  confirms only books + music use the shared walk shape; the main media scan
  (`server.js`) already has `unreadablePaths` in `selectPrunableIds` (`:1552`).

## Gate

FULL gate (R2 destroys per-user data on a transient FS blip - the never-slim
trigger). Adversarial seat briefed to: simulate a mid-scan EACCES on a book
subtree and prove reading positions survive; drive a slow-consumer enclosure
and prove memory stays bounded and the file still finalizes byte-correct.

## Stop condition

Both seats APPROVE; dual-Node suites green and reported verbatim; the book
prune guard fails its own mutant; backpressure test asserts pause+drain. Then
release ceremony, device-probe list, plan to `completed/`.
