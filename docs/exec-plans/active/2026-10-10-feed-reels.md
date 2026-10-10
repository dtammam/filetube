---
plan: feed-reels
harness: v2 · full
branch: feat/v1.383.0-feed-reels
anchor: outcome
status: Built (W1-W5 on feat/v1.383.0-feed-reels); in review
next: the FULL gate (adversary, qa) at the reviewed sha; then the release up to the push (no GitHub auth on this box)
design: v1.382.0's moved W5 (its plan section 3, D12-D14) plus Dean's device feedback on v1.382.0 (2026-10-10, four points) and the v1.381.0 Start over hardening (ROADMAP). Base main 207256de (v1.382.0).
builder: smart (preloading and auto-advance on the shared player, music through the shared player under book cards, two Feed bugs to root-cause)
gate: not yet run (FULL: adversary, qa)
---

# v1.383.0: Feed reels and speed - instant cards, auto-advance, song reels, music while reading, and the Feed's book bugs

Norms: no em dashes in docs or user prose; stage files by name; `git commit -F <file>`; never pipe a commit or push; export the
fnm Node 22.23.1 PATH before any node/npm/git command; no toggle workarounds; never self-merge.

Read first: AGENTS.md; docs/LESSONS.md sections 0, 1, 2, 5, 6, 12; the four shipped Feed plans in docs/exec-plans/completed/
(2026-10-09-feed-mode.md, -feed-polish.md, -feed-tiktok.md, 2026-10-10-feed-settings.md - its section 3 D12-D14 are this plan's
W3-W4 and are NOT repeated in full here: build them as written there, with the changes below); docs/references/pwa-ios-notes.md.
The forward-only / stale-refusing write rule, the one-minute guard with the whole-reel rule, Start over + Undo, and the Feed
settings stay as shipped.

## Step 0. Before anything (builder)

- Work ONLY in the worktree the launcher made: `.claude/worktrees/feat-v1.383.0-feed-reels` on branch `feat/v1.383.0-feed-reels`
  (this plan is committed there; `node_modules` is a symlink, never stage it). Never touch the main checkout (the Root works there).
- Before every node / npm / git command: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
  Dual-Node: 22.23.1 then 24.20.0, sequential. Targeted tests while building; the full dual suite once before the gate and once
  at release.
- Git: stage by name, `git commit -F <file>`, verify with `git log -1` / `git ls-remote`; never `--no-verify`, never force-push;
  the protected-main PR flow (docs/RELEASING.md). If another release merges first, merge origin/main in, take the next free minor,
  re-run the suites.
- Stop and ask Dean (AskUserQuestion) when: a ruling contradicts the code or a measurement; W2's book bug needs the name of the book
  he saw it on (ask once, early, so it does not block: "Which book showed chapter 6 after Start over?"); the gate reaches round 3;
  `gh pr merge` is refused.

## 1. Outcome (Dean, 2026-10-10, after v1.382.0: "It shipped. I like it.")

1. "It doesn't seem to auto-scroll down to the next item in the feed. One must scroll."
2. "There is friction in it not having content auto-loaded. Meaningfully. We should pre-load."
3. "Books are not starting in chapter 1 even if not started (maybe). I selected start over for one and the card stayed at chapter 6
   (though in the book view it's properly started over)."
4. "At least for podcasts there's no way to tap it to go listen to the full episode if interested." (Measured: the Keep listening
   pill shows only in a slice's last 10 seconds and on Done, public/js/feed.js `FEED_KEEP_SEC = 10` ~285, ~1818.)
5. Plus the work moved out of v1.382.0 (D12 instant next card, D13 song reels, D14 music under book cards).

## 2. Rulings and kickoff defaults (Dean asked for these items; the shapes are kickoff defaults he signs off before the build)

- **K1 Auto-advance (point 1).** When a media card (video, podcast, Watch later, song clip) reaches its Done state, the Feed shows
  "Next in 2" over the overlay and scrolls to the next card after 2 s (smooth, the same snap). A touch anywhere on the card during
  the countdown cancels it (that card then stays until swiped). Never on book or Start something new cards (reading pace). During
  the wind-down the recap opens instead (unchanged). A Feed setting "Auto-advance" On (default) / Off (synced, LESSONS 12 lists).
- **K2 Instant cards (point 2, D12 made stronger; Dean 2026-10-10: NO instrumentation pass - build the fix directly).** Do all three
  together, no measuring rig, no new log line: (a) WARM the next card while the current one is active: its poster / art, a small
  range request at its start point (Dean: almost the whole library is faststart, so the start of the file is enough), and the next
  book page text; 1 card ahead only; (b) START the next card's load as early as the snap allows (when it crosses ~25% on screen or
  the scroll settles, not at the 60% active ratio), so the load overlaps the swipe; (c) AUTOPLAY: after the session's first gesture
  the active card starts on its own, with sound (the shared media element keeps the gesture's permission; prove it in a WebKit
  test). Still never two PLAYING media elements on iOS; a card that is warmed but never reached costs only its range request.
  Dean's device pass is the arbiter ("a swipe starts playing at once").
- **K3 Book bugs (point 3).** Two separate defects, root-cause each (never re-patch around them):
  (a) After Start over on a book card, the card still shows its old page (chapter 6) while the reader is correctly reset: the card
  must re-render from the reset place (the first real chapter, v1.380.0 D5's rule) right after the reset succeeds, and Undo must
  re-render it back. Falsifier: Start over on a fixture book at chapter 6 -> the card's first block is the first real chapter's.
  (b) "Not starting in chapter 1 even if not started": measure the first-real-chapter rule (lib/feed/api.js / lib/books/excerpt.js,
  the v1.380.0 front-matter skip) against Dean's book (ask its name) and 3 real-shaped EPUBs; if the rule skips real chapters, fix
  the rule; if Dean's "not started" book actually has a stored place (an old reader open), say so and show him where it came from.
  Also check v1.382.0's "From the beginning" setting lands on the same first real chapter.
- **K4 A way to the full item any time (point 4).** Every media card gets an always-visible way out: tapping the title or the
  show / channel line opens the full item (the same exit path as Keep watching / listening / reading, v1.382.0 D7, continuing from
  the card's place, still playing), plus a small "open" icon button at the end of the overlay's title row (a button: never a play /
  pause tap, and not a double-tap like target). The Keep pill in the last 10 s stays as the prominent nudge. Book cards keep "Open in
  reader".
- **K5 Song reels = v1.382.0 D13**, as written there (Song clip 30 / 45 / 60 s / Whole song, default 45 s, from a third in; a clip
  played to its end counts a play; a swipe is never a skip; Keep listening plays the whole song), now also auto-advancing (K1).
- **K6 Music while reading = v1.382.0 D14**, as written there (On by default; station source with the Chill / Lofi / Jazz / Ambient
  / Favorites / liked fallback; plays across a book's page swipes and book cards; stops on a non-book card; the "♫ song · artist"
  chip with Like / Mute for this session / Change station; never counts plays or skips; no volume ducking on iOS, disclosed).
- **K7 Start over hardening** (ROADMAP "Start over: the hardening the v1.381.0 gate left as suggestions", (a)-(c)): the recorded
  book place bound by the reader's own limit, the two survivors bound, the confirm reads the STORED place before it names it. The
  "way back after the toast" item stays on the ROADMAP (not this release).

## 3. What exists (kickoff read 2026-10-10; re-verify line numbers)

- public/js/feed.js (~1900 lines since v1.382.0): `FEED_KEEP_SEC` ~285, the Keep pill ~1818-1840 (`keepGoing`), `playCard`, the
  Start over / Undo flow ~1356-1450, `setActive` / `onIntersect`, book page swipes (v1.381.0).
- Server: lib/feed/api.js (cards, slices, fresh, the settings), lib/books/excerpt.js (first real chapter), lib/feed/safe-progress.js.

## 4. Waves

- **W1 Bugs:** K3 (a) and (b) root-caused and fixed, K7.
- **W2 Flow:** K1 auto-advance + its setting, K4 the always-visible way out, K2 (warm the next card, early load, autoplay).
- **W3 Song reels:** K5 (+ the Song clip setting).
- **W4 Music while reading:** K6 (+ its setting and station picker, the chip and its sheet).
- **W5 Close-out:** ledger, device checks in docs/DEVICE-CHECKS.md (auto-advance and its cancel; a swipe starts playing at once; Start over on a book card shows chapter 1 at once and Undo puts the page back; an
  unstarted book opens at its first real chapter; tap a podcast's title mid-slice -> the full episode playing; song clips from the
  chorus; music under book pages with its chip, across page swipes, stopping on a video), ROADMAP (close "Feed reels and speed" and
  the Start over hardening item), a LESSONS line if a new class appears.

## 5. Gate
FULL: adversary, qa (security as a section). Brief the Adversary on: auto-advance firing on a book card, during the wind-down, after
a cancel touch, or skipping a card; preloading that starts a second playing media element or plays audio on iOS, or downloads more
than 1 card ahead; autoplay with sound before the session's first gesture; K3 (a) re-render showing the wrong page after Undo; K3 (b)
skipping a real first chapter; the title tap also pausing / liking / double-firing the exit; song clips counting skips; book music
counting plays or skips, or playing on a video card; the forward-only rule, the one-minute guard and Start over untouched.

## 6. Release
docs/RELEASING.md and AGENTS.md exactly: version bump, CHANGELOG / releases.json in Dean's plain words, the plan closed out in the
same PR (`node scripts/plan-complete.js docs/exec-plans/active/2026-10-10-feed-reels.md "Shipped vX.Y.Z" --apply`), the protected-main
PR flow, shipped = the tag's "Publish Docker Image" run green, branch deleted remote and local.

## 7. Evidence (builder fills: numbers copied from the runs named, verbatim verdict lines)

- K2 tests (warm request issued 1 ahead, early load, autoplay after the first gesture on WebKit): `node tools/feed-proof/reels-flow.js
  <repo> out both` -> "SUMMARY reels-flow: 2/2 pass (chromium+webkit)". Per engine: every media card reached by the wheel after ONE
  click played on its own, unmuted, no refused play() (Chromium 4/4, WebKit 26.5 4/4); plays before the first tap 0; most media
  elements playing at once 1; warm requests (bytes=0-262143) Chromium 5, WebKit 4, each the card right after the active one, each
  card once. Unit: test/unit/feed-reels.test.js "K2 a" / "K2 b" (warm one ahead and once, never a transcode, a next book laid out;
  feedNextActive at 25%, hold, spring-back; resume where left).
- K3 (a) falsifier; K3 (b) the rule on Dean's book and the fixtures: Dean's book not named (his ruling: generic). The rule on the three
  real-shaped fixtures (measured before the fix): first real chapter right in 3 of 3 (spine 5 / 3 / 3); labels "Chapter 6 of 10",
  "Chapter 4 of 7", "Chapter 4 of 6" over the books' "I", "Chapter One", "Prologue" - after the fix "Chapter I", "Chapter One",
  "Prologue" (test/integration/feed-reels-books.test.js "K3 b"). K3 (a): Start over on the fixture book at chapter III -> the reset
  pages start at spine 5, first block "I", label "Chapter I"; Undo restores the stored place exactly ("K3 a"); the card redraws and
  Undo returns to the page it was on (test/unit/feed-reels.test.js "K3 a").
- K1 / K4 falsifiers: reels-flow.js - after the slice's end "Next in 2" showed and the next card became active with no input (Chromium
  index 1 -> 2, WebKit 0 -> 1); the title tapped mid-slice opened /watch.html?v=land1 playing, one player (both engines). Unit: the
  countdown, its cancel by touch and by its button, never on a book, never in the wind-down, off by the setting; title / show line /
  open button each exit once, never a play / pause or a like.
- K5: `node tools/feed-proof/song-reels.js <repo> out both` -> "SUMMARY song-reels: 2/2 pass (chromium+webkit)": a 30 s clip started at
  20 s, stopped at 50.2 s / 50.1 s, posted exactly one play, the song's saved place untouched; Keep listening at 41.1 s / 41.2 s ->
  Music on the same song, playing at 43.8 s / 44.0 s, one player.
- K6: `node tools/feed-proof/book-music.js <repo> out both` -> "SUMMARY book-music: 2/2 pass (chromium+webkit)": the station song from
  the hidden slot at 21.4 s (a third into 60 s), unmuted, the chip naming it; a page turn did not reload it; a video card replaced it
  (no chip, the slot empty); plays posted 0; saved place none; most playing at once 1.
- Mutants (each in a /tmp `git archive` sandbox of the committed tree): W1 9 of 9 killed; W2 + W3 21 of 22 (A11 masked: Keep's
  `leaving` guard sits behind `!session`, which keepGoing clears first); W4 17 run, 15 killed at first, the 2 survivors (C1, C8)
  then bound - C8 and C1b killed, C1 (`bookActive`) and C1c (the second token check) masked by the first token check.
- Suites (Node 22.23.1 / 24.20.0) at the reviewed sha:
- Gate rounds:
- Device checks owed:

## 8. Out of scope
Real YouTube comments and the Cleanup tidy (their own ROADMAP items); the Start over "way back after the toast"; Feed phases 2-3;
new card kinds; per-kind weights.

## 9. Ledger (as built; Dean overrules at the device pass)

- **Dean's rulings during the build (2026-10-10, relayed):** the book-specific question is disregarded - no title is hard-coded,
  the W1 book bugs are root-caused generically; the launch prompt's wave list was a typo - all five waves, in order.
- **K3 b (W1), measured cause.** The first-real-chapter rule picked the right spine item in all three real-shaped EPUBs
  (test/helpers/real-epubs.js: Standard Ebooks EPUB 3 -> spine 5 by landmarks, Calibre split EPUB 2 -> spine 3 by the heuristic,
  publisher EPUB 2 with a short prologue -> spine 3); every label was the SPINE position: "Chapter 6 of 10" over the Standard
  Ebooks book's chapter I, "Chapter 4 of 7" over "Chapter One", "Chapter 4 of 6" over "Prologue". The rule was right; the label
  was wrong. Chapter names now come from the book's own table of contents (nav toc, then the NCX; a split file inherits the
  entry before it; a bare numeral reads "Chapter I"; no table of contents counts from the first real chapter) on the new-book
  card, the reading card, From the beginning (which lands on the same first real chapter), the excerpt route and the
  chapter-start divider. The "not started (maybe)" second reading - an old reader open leaving a stored place - cannot be told
  from here without Dean's database; the label fix covers the reading the measurement supports.
- **K3 a (W1).** Start over on a book card answers with the reset pages (the first real chapter's opening, labelled); the card
  redraws on them at once (a pruned card re-lays them when rebuilt) and Undo puts back exactly the pages it showed, on the page it
  was on. The card still writes nothing after either (its serve is forgotten by the server, as shipped). Not changed: the reader
  itself opens an unplaced book at its first spine item (the cover), as before.
- **K7 (W1).** (a) a recorded book place is bounded by the reader's own 2000-character cfi limit (lib/books/routes.js
  READER_CFI_MAX_CHARS); the rest of the place keeps the 4096-byte bound. (b) the flag shape check and a NULL-time latch-only
  item are bound by tests. (c) the confirm reads the STORED place first: GET /api/feed/start-over/place (GATED, censused; the
  kind's visibility gate first, one neutral 404; read-only); a failed read still asks, naming only the item.
- **K1 (W2).** As ruled, plus: the countdown is a button ("Next in 2", tap to stay) so a keyboard can keep the card too.
- **K4 (W2).** The title, the channel / show / artist line and a small open button at the end of the title row, every media card
  (songs open in Music: /music?play=); book cards keep Open in reader.
- **K2 (W2).** No measuring rig (Dean). (a) warm ONE card ahead, once: its art, a 256 KB range at its start, a next book card laid
  out into pages, and the pages after an active reading card's last page; a file that needs a transcode is never warmed (the warm
  would queue the transcode). (b) the next card becomes active from 25% on screen; the active card holds while 25% of it shows; a
  card returned to plays on from where it was (needed by the early load: a swipe that springs back). (c) autoplay: measured, no
  priming needed - the one persistent element keeps the first tap's permission in WebKit 26.5 and Chromium (user-gesture-required).
- **K5 (W3).** As D13, plus: a clip never moves the song's saved place in Music (its gate is shut; Music's adopt drops it on Keep
  listening); a WHOLE song's skip needs 3 s heard (the early load plays a song for a moment on a swipe that springs back).
- **K6 (W4).** As D14. Chosen for you = the first that exists of Chill, Lofi, Jazz, Ambient, Favorites (Favorites is the liked
  songs until play counts exist). Ambient is rarely its own station: the Chill style's words include "ambient", so most libraries
  get Chill. Change station writes the synced Station setting. Mute lasts the session. No ducking: iOS ignores a scripted volume,
  and the Feed never lowers it anywhere. The station key is bounded at 120 BYTES (a longer one reads as chosen for you) so the
  synced value stays under 512 bytes.
- **Found and fixed on the way:** Music's play tally counted another surface's playback (a Feed card, the watch page) to the last
  Music song (now let go silently; LESSONS 5); a card reached by a jump of more than three cards played before it was rebuilt
  (silent); the table-of-contents parsers W1 added rescanned per tag (2575 ms on 256 KB of hostile input, now 24 ms).
- **Disclosed:** the reader's own listen bar still says "Chapter <spine + 1>" (public/js/read.js; out of this plan: ROADMAP
  Planned); swipe-to-first-frame was not measured (Dean: build it directly); masked mutants A11 (Keep's `leaving` guard behind
  `!session`), C1 (`bookActive`) and C1c (the second token check) behind the first token check.
