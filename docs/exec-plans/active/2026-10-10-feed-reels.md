---
plan: feed-reels
harness: v2 · full
branch: feat/v1.383.0-feed-reels
anchor: outcome
status: Planned (kickoff 2026-10-10, Opus Root); QUEUED - builder not launched until Dean signs off
next: Dean's go; then builder Step 0, then W1
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
- **K2 Instant cards (point 2, D12 made stronger).** MEASURE FIRST where the wait is, on WebKit and Chromium headless AND on the
  device: add a `feed:start` line to the existing lifecycle log (the record + one-button export pattern) with swipe-settle ->
  card active -> player moved -> load -> first frame / first audio timings, so Dean's export shows the real phone. Then fix the
  measured cause: (a) network: preload the next card (poster / art, a range request at its start point, the next book page text;
  1 card ahead, as D12 said); (b) the player move / load: start the next load as early as the snap allows; (c) a missing autoplay
  after a swipe: the active card must start on its own, with sound, after the session's first gesture (the shared media element
  keeps the gesture's permission; prove it on WebKit). Still never two PLAYING media elements on iOS. Target: under 500 ms from
  swipe settle to first frame / first audio on the LAN; report before / after.
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
- The lifecycle log and its Settings export (the "record + one-button export" pattern; find the existing log module the
  `player:strip` line of v1.376.0 used).

## 4. Waves

- **W1 Measure + bugs:** the `feed:start` log line and the headless timings (K2 measure), K3 (a) and (b) root-caused and fixed,
  K7.
- **W2 Flow:** K1 auto-advance + its setting, K4 the always-visible way out, K2 fixes for the measured cause (preload / early load /
  autoplay), before / after timings.
- **W3 Song reels:** K5 (+ the Song clip setting).
- **W4 Music while reading:** K6 (+ its setting and station picker, the chip and its sheet).
- **W5 Close-out:** ledger, device checks in docs/DEVICE-CHECKS.md (auto-advance and its cancel; a swipe starts playing at once -
  export the log once with `feed:start` lines; Start over on a book card shows chapter 1 at once and Undo puts the page back; an
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

- K2 swipe-settle to first frame / audio, before / after (WebKit, Chromium; device log if Dean exports it):
- K3 (a) falsifier; K3 (b) the rule on Dean's book and the fixtures:
- K1 / K4 falsifiers:
- Suites (Node 22.23.1 / 24.20.0) at the reviewed sha:
- Gate rounds:
- Device checks owed:

## 8. Out of scope
Real YouTube comments and the Cleanup tidy (their own ROADMAP items); the Start over "way back after the toast"; Feed phases 2-3;
new card kinds; per-kind weights.
