---
plan: feed-reels
harness: v2 · full
branch: import/v1.383.0-feed-reels (the off-box build's patch on feat/v1.383.0-feed-reels 70777f8a; released from feat/v1.383.0-feed-reels)
anchor: outcome
status: Built off-box (W1-W5), imported by patch and finished on this box; in review (gate r2)
next: gate r2 (adversary, qa, security-brief re-confirm) on the r1 fixes; then the release
design: v1.382.0's moved W5 (its plan section 3, D12-D14) plus Dean's device feedback on v1.382.0 (2026-10-10, four points) and the v1.381.0 Start over hardening (ROADMAP). Base main 207256de (v1.382.0).
builder: smart (preloading and auto-advance on the shared player, music through the shared player under book cards, two Feed bugs to root-cause)
gate: FULL (adversary, qa, security-brief - added by the finisher: Start over's reset / Undo is a data-loss surface and there is a new read route)
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

Provenance: W1-W5 were built OFF this box by another agent and imported by patch (`git am`, 2026-10-10) onto
feat/v1.383.0-feed-reels 70777f8a as 487e5b3c..64bc6f23. The evidence that build wrote here (suites "at ccc16171", its mutant counts,
its proof numbers) was bound to commits that do not exist on this box and is replaced below by the finisher's own runs.

- Suites at the imported tip 64bc6f23 (finisher, a throwaway worktree): Node 22.23.1 tests 12150 / pass 12137 / fail 0 / skipped 13;
  Node 24.20.0 tests 12150 / pass 12137 / fail 0 / skipped 13. The 13 skips are environment (no ffmpeg / ffprobe binary, tools/capture
  Playwright in the suite's own sandbox), not this diff. The off-box claim "16 fail, 14 pre-existing" does not reproduce here: nothing
  to triage against main.
- Mutants at 64bc6f23 (finisher, /tmp `git archive` sandbox, pristine copy diffed identical after): 36 run, 31 killed, 5 survived -
  warm "each card once", the fresh card's tracker kept across a return, the no-table-of-contents count from the first real chapter, the
  stale station answer (the off-box ledger called this one "C1c, masked": it is reachable with a late radio batch), and the title's
  stopPropagation (equivalent: nothing above the title acts on a click; the r1 adversary agreed). The four real ones were bound in
  f19b6c9f and each then KILLED (re-run at f19b6c9f).
- Browser proofs at f19b6c9f (finisher, Chromium + WebKit, the real server): `node tools/feed-proof/reels-flow.js` -> "SUMMARY
  reels-flow: 2/2 pass (chromium+webkit)": every media card reached by the wheel after ONE click played on its own, unmuted, no refused
  play() (4/4 per engine); plays before the first tap 0; most playing at once 1; warm requests (bytes=0-262143) 4 per engine, each the
  card right after the active one; "Next in 2" then the next card active with no input; the title tapped mid-slice opened
  /watch.html?v=land1 playing, one player. `song-reels.js` -> "2/2 pass": a 30 s clip from 20 s stopped at 50.2 s (Chromium) / 50.0 s
  (WebKit), one play posted, no saved place; Keep listening -> /music?play=trk1 playing at 43.7 s / 43.8 s, one player, 0 plays from
  the Feed. `book-music.js` -> "2/2 pass": the station song from the hidden slot at 21.4 s / 21.5 s, unmuted, its chip; a page turn did
  not reload it; a video card replaced it (no chip, slot empty); plays 0; saved place none; most playing at once 1.
- K2 a, measured by the r1 adversary: the player never reuses the warm's bytes (both engines fetch the file from byte 0 again; the media
  routes send no cache validators). Dean's ruling (2026-10-10): keep it as a server-side disk warm, described as exactly that.
- Gate rounds:
  Gate: CHANGES r1 @f19b6c9f - adversary
  - W1 (K2 b, recap) a 25% glimpse that springs back runs leaveCard + countCard on the card you are ON; countCard is once per card,
    so nothing read or played after the glimpse reaches the recap. Measured (jsdom, the real view): book card, page 1 read, glimpse
    to 26% and back, page 2 read, Done -> recap words 20 (control without the glimpse: 50), cards 2 (control 1: the glimpsed
    podcast counts as a card), the podcast loaded once. Not a place loss (writes stay forward-only, measured 2 writes, both forward).
  - W2 (K5) the same glimpse during a WHOLE song posts a skip for a song that is still playing: 45 s of one continuous listen ->
    /api/music/plays ["skip","play"] (jsdom, the real view). feedSongLeave fires on every setActive away, and K2 b now leaves on 25%.
  - W3 (K4/K5) one continuous listen that starts on a Feed song card and goes on in Music counts TWO plays: Chromium, the real
    server, Whole song, title tapped at 33 s, Music on /music?play=trk1 playing at 69 s -> posts ["play","play"]. The Feed counted
    at 30 s; Music's adopt starts a fresh tally (the Feed released it) and counts again at 30 s more. A clip heard to its end then
    Keep listening on a song longer than ~1.5x its clip does the same.
  - W4 (K2 a) the media warm is never consumed: real server, request log, both engines, the reels-flow wheel run: every warmed URL
    the Feed later reached was fetched AGAIN from byte 0 by the media element (Chromium /episode, /video/port1, /track/trk1: a
    later "bytes=0-"; WebKit /video/land1, /video/port1, /track/trk1: a later full GET). /video, /track, /episode send no
    Cache-Control, ETag or Last-Modified, so the browser cache cannot serve the element from the warm. Section 7's evidence counts
    warm requests ISSUED (presence, not binding). Any benefit left is server-side (disk cache), unmeasured.
  - W5 (Start over x K2 b) refillMediaCard's two new resets are unbound: mutant M14 (drop the activity lastTime/done reset,
    feed.js:2034) and M13 (drop trackers[index] = null, :2035) both survive feed-reels, feed-tiktok, feed-settings and
    music-play-counts. M14's effect, measured: a video card played to 450 s, Start over -> the card loads at 450 (the place it
    just forgot), real code loads at 0. M13 hands a started-over fresh card the old card's played seconds (the server's
    since-reset rule then refuses, so the client and server disagree).
  - W6 (K2 a) an ALAC song is warmed: feedStreamUrl({kind:'song', track:{needsTranscode:true}}) = '/track/t9' (measured);
    GET /track/:id queues queueMusicTranscode for an ALAC codec (lib/music/routes.js:701-708, read). Section 9's "a file that needs
    a transcode is never warmed" is false for songs. Small cost (one cached audio rendition); one-line fix with the track's flag.
  - S1 (K6) Keep reading on a book card PAUSES the station song and clears music.current, so the view's abort no longer closes the
    player: harness loads ["load:m1","pause","navigate:/read.html?b=bk1"] (Open in reader: [... ,"close"]). The comment at
    feed.js:2372 ("the reader has no music") and :2591 ("never follows the user out") overclaim; mutant M42 (drop that
    stopBookMusic) survives and is the BETTER behaviour.
  - S2 (K3 b) BARE_CHAPTER_NUMBER_RX (excerpt.js:376) takes any word of roman-numeral letters: "Civil" -> "Chapter Civil", "Mix"
    -> "Chapter Mix" (measured); "<span>XII</span>." reads "XII ."; Part One and Chapter 1 in one file -> "Part One" (first entry
    wins; mutant S9 last-wins survives, S11 no percent-decode survives, S17 NCX-over-nav survives: those rules are unbound).
  - S3 (K1 x K2 b) a Done card glimpsed and returned to replays its slice from the start and runs past its end with no pause and no
    countdown (jsdom: loads v1@400, ep1@600, v1@400; at 905 s no pause, no "Next in"). Pre-existing on a 60% return; 25% makes it
    common during the countdown.
  - S4 survivors with no test: M5 hidden-card skip in nextShownIndex (and, reasoned not measured, a smooth scroll past a hidden card
    crosses 25% and K2 b activates it anyway), M27 notice-card pause, M49 warmBookPages active guard, M59 continuation retry after
    a failure, M60 a reset landing on a pruned card, S2 the array-locator shape check.
  - S5 stale comment feed.js:224 "always starts from the top" (clips start a third in; K2 b resumes).
  - Suspicions (not measured): a glimpse's pause checkpoint writes the NEXT card's place +0.x s and bumps its updatedAt; a 25%
    glimpse in the wind-down now ends the session (finishNow) where 60% did; a reload-resumed session starts book music with no
    gesture into a hidden slot (a refused play has no visible glyph).
  - Verified holding: K7 a/c (S1 cfi bound, S3 rest bound, S3b, S4 place visibility 404, S5 input 400, S7 nothing, all killed);
    the toc parsers on hostile input 3-25 ms for 0.3-1 MB; worst-case Feed settings value 488 bytes (<= 512); music.js tally guard
    and base-id rule bound (S24, S25 killed); K4 stopPropagation survivor equivalent (no ancestor or document click listener acts
    on a non-anchor title: common.js 10495/12327, interaction.js 97, player.js menus; read, not run). Mutants: client 44 (26 killed,
    18 survived, 10 judged equivalent / dead / masked: M2 M4 M10 M11 M12 M17b M26 M28 M40 M41; the other 8 are W5, S1, S4), server 28 (24 killed, 4 survived).
  - Suites at f19b6c9f (git-archive sandbox): Node 24.20.0 (git-initialised) 12154 tests, 12140 pass, 0 fail, 14 skipped. Node 22.23.1 12154 tests, 12132 pass, 8 fail, 14 skipped - all 8 are the sandbox
    (not a git repo, a tracked node_modules symlink): the 7 files re-run 69/69 pass once git-initialised. eslint 0 errors (6
    pre-existing warnings in common.js), lint:overlay 0, lint:ui OK.
  - Gate: APPROVED r1 @f19b6c9f - security-brief. No CRITICAL, no WARNING. SUGGESTION S1: GET /api/feed/start-over/place
    (lib/feed/routes.js:330-350) reads the whole EPUB synchronously (up to 64 MB) per call with no rate bound - parity with its
    siblings /api/books/:id/excerpt and /api/feed/progress/book/:id, which do the same, so no new capability; a shared
    openEpubBook memo is a ROADMAP candidate. INFO: TOC labels can hold a literal '<' after entity decoding (opf.js:167), every
    consumer renders them as text (verified); the lower-cased index reuse in parseNavToc / parseNcxToc (opf.js:188-238) can
    misalign on length-changing Unicode (labels only, still bounded); K7 a smuggling path closed (summary.moves is server-only,
    api.js:237; Undo's write is parameterized, its item visibility-checked).
  - Gate: CHANGES r1 @f19b6c9f - qa. Suites at f19b6c9f (measured by qa): Node 22.23.1 tests 12154 / pass 12141 / fail 0 /
    skipped 13; Node 24.20.0 the same 12154 / 12141 / 0 / 13; lint 0 errors (6 pre-existing warnings, common.js), lint:ui OK,
    overlay-containment clean. W1: music while reading plays a station's library-CHAPTER track (radio items with source
    library-chapter + chapterStartSec, e.g. a chaptered lofi mix) from durationSec/3 file-absolute, without chapterStartSec /
    baseMediaId (feed.js playSong 1283-1294 via feedPlayerDescriptor 225-245): the audio is in the wrong chapter, the chip names
    another, and the next song only follows when the WHOLE file ends. W2: a song card is warmed even when its track
    needsTranscode (ALAC): GET /track/<id> answers 503 and queues the music transcode for a card that may never be reached
    (feed.js feedStreamUrl 347-353; its comment and the section 9 K2 ledger say a transcode is never warmed). SUGGESTIONS: S1 g:ambient
    can never exist (stations.js drops every genre a style word names; Chill names "ambient"), so the order entry is inert and
    "rarely" in section 9 is "never"; S2 BARE_CHAPTER_NUMBER_RX (excerpt.js:376) reads "Mild", "Vivid", "Civil", "Did", "C" as
    numerals ("Chapter Vivid"); S3 a one-file book labels every card with the first TOC entry into that file; S4 the 512-byte
    "worst case" test is not the worst (measured worst 490 bytes, still under the cap); S5 the countdown's aria-label stays "in 2
    seconds" at "Next in 1"; S6 this plan's branch / Step 0 / next fields name the off-box feat/ branch and "no GitHub auth".
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
  would queue the transcode; a video, an episode and, since gate r1, an ALAC song). The 256 KB range is a SERVER disk warm only: the
  player does not reuse its bytes (gate r1, measured; kept by Dean's ruling). A card left at a quarter swipe is paused at once but
  counted (the recap, a whole song's skip) only when the swipe settles; a card only glimpsed is never counted; the wind-down keeps the
  60% rule (gate r1). (b) the next card becomes active from 25% on screen; the active card holds while 25% of it shows; a
  card returned to plays on from where it was (needed by the early load: a swipe that springs back). (c) autoplay: measured, no
  priming needed - the one persistent element keeps the first tap's permission in WebKit 26.5 and Chromium (user-gesture-required).
- **K5 (W3).** As D13, plus: a clip never moves the song's saved place in Music (its gate is shut; Music's adopt drops it on Keep
  listening); a WHOLE song's skip needs 3 s heard (the early load plays a song for a moment on a swipe that springs back).
- **K6 (W4).** As D14. Chosen for you = the first that exists of Chill, Lofi, Jazz, Ambient, Favorites (Favorites is the liked
  songs until play counts exist). Ambient is never its own station (gate r1 qa, measured): the Chill style's words include
  "ambient", so ambient music plays through Chill; the 'g:ambient' entry is a harmless no-op. A station song that is a chapter of a
  library file plays a third into that chapter and ends at its end (gate r1). Change station writes the synced Station setting. Mute lasts the session. No ducking: iOS ignores a scripted volume,
  and the Feed never lowers it anywhere. The station key is bounded at 120 BYTES (a longer one reads as chosen for you) so the
  synced value stays under 512 bytes.
- **Found and fixed on the way:** Music's play tally counted another surface's playback (a Feed card, the watch page) to the last
  Music song (now let go silently; LESSONS 5); a card reached by a jump of more than three cards played before it was rebuilt
  (silent); the table-of-contents parsers W1 added rescanned per tag (2575 ms on 256 KB of hostile input, now 24 ms).
- **Disclosed:** the reader's own listen bar still says "Chapter <spine + 1>" (public/js/read.js; out of this plan: ROADMAP
  Planned); swipe-to-first-frame was not measured (Dean: build it directly); masked mutants A11 (Keep's `leaving` guard behind
  `!session`) and C1 (`bookActive`); C1c was NOT masked (gate r1: bound). Gate r1 open suggestions kept for later: the place
  route's per-call EPUB read with no rate limit (as its two siblings; ROADMAP), a glimpse's pause checkpoint may move a continuing
  card's place by under a second (forward-only), a reload-resumed session starts book music without a new gesture (as media cards
  always have), unbound guards (warmBookPages' active check, a continuation retry, the nav-over-NCX order).
