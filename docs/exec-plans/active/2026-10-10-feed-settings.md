---
plan: feed-settings
harness: v2 · full
branch: feat/v1.382.0-feed-settings
anchor: outcome
status: Planned (kickoff 2026-10-10, Opus Root); builder not started
next: builder Step 0, then W1
design: Dean's next-wave ask after passing every Feed check (2026-10-10) and his rulings R1-R4; kickoff defaults D1-D9. Base main 056a482f (v1.381.0).
builder: smart (Dean offered Sonnet for the settings core; the add-ons he chose - preloading on the shared player, double-tap like on top of tap / hold, music under book cards - put it above standard; no reset, no schema change)
gate: not yet run (FULL: adversary, qa; lib/ change = core-logic)
---

# v1.382.0: Feed settings, reels everywhere, like / hide from a card, instant swipes, and music under book pages

Norms: no em dashes in docs or user prose; stage files by name; `git commit -F <file>`; never pipe a commit or push; export the
fnm Node 22.23.1 PATH before any node/npm/git command; no toggle workarounds; never self-merge.

Read first: AGENTS.md; docs/LESSONS.md sections 0, 1, 2, 5, 6, 12 (inert sibling list: a synced pref has a client list, a server
allowlist and censuses; a new Settings page has its censuses); the three shipped Feed plans in docs/exec-plans/completed/
(2026-10-09-feed-mode.md, -feed-polish.md, -feed-tiktok.md): the forward-only / stale-refusing write rule, the fresh-card
one-minute guard and Start over stay exactly as they are.

## Step 0. Before anything (builder)

- Work ONLY in the worktree the launcher made: `.claude/worktrees/feat-v1.382.0-feed-settings` on branch
  `feat/v1.382.0-feed-settings` (this plan is committed there, with the Feed device checks Dean passed; `node_modules` is a
  symlink, never stage it). Never touch the main checkout (the Root works there).
- Before every node / npm / git command: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
  Dual-Node: 22.23.1 then 24.20.0, sequential. Targeted tests while building; the full dual suite once before the gate and once
  at release.
- Git: stage by name, `git commit -F <file>`, verify with `git log -1` / `git ls-remote`; never `--no-verify`, never force-push;
  the protected-main PR flow (docs/RELEASING.md). If another release merges first, merge origin/main in, take the next free minor,
  re-run the suites.
- Stop and ask Dean (AskUserQuestion) when: a ruling contradicts the code or a measurement; the gate reaches round 3; `gh pr merge`
  is refused.

## 1. Outcome (Dean, 2026-10-10, after passing every Feed device check: "It was awesome")

"I think we make a feed settings page and we allow one to opt in the specific types of content... videos, audio, books,
podcasts... And then for each thing, always start on net new, like the beginning, or resume where you left off. And then for the
videos, maybe have a length, make it feel more like a reel, where I think four minutes is a little much. And then as it gets
closer, maybe we have it indicate, tap to continue on, basically a way to get out from the feed into the piece of content if they
really want to go for that specific thing."

## 2. Rulings (Dean, 2026-10-10)

| # | Ruling |
|---|---|
| R1 | A Feed settings page; each content kind can be switched on or off. |
| R2 | **Both settings per kind:** (a) WHICH items show: New only / Continue only / Both; (b) WHERE an item starts: from the beginning / from my saved place. |
| R3 | Reel length for videos: **60 seconds** by default, adjustable. |
| R4 | Near the end of a slice, a way to leave the Feed into the full item ("tap to keep going"). |
| R5 | **Like + save from a card:** double-tap the media to like (a heart pops); Like and Watch later in the card's "..." menu. |
| R6 | **Not interested:** "Hide this" and "Fewer from <channel / show>" in the "..." menu. |
| R7 | **Instant next card:** preload the next card so a swipe starts with no wait. |
| R8 | **Song reels:** songs play a reel-length clip from about a third in, with Keep listening for the whole song. |
| R9 | **Music under book cards** (Dean: "like Instagram reels... an attributable sound clip... an option for the book feed: enable music... it would play as long as someone has the content open"). |

## 3. Kickoff defaults (D1-D9; state each in the ledger as built; Dean overrules at the device pass)

- **D1 Where the settings live.** A new Settings page "Feed" under Personalize (the master-detail pattern; v1.380.0's "Bottom bar"
  page, public/setup.html ~583, is the model, with its census updates), plus a gear button on the Feed's length picker that opens
  it. Settings are SYNCED per user (prefs: add the keys to lib/prefs-allowlist.js AND public/js/prefs-sync.js; LESSONS 12), so
  they follow Dean across devices.
- **D2 Kinds (R1).** Five switches, all ON by default (today's behaviour): Videos, Podcasts, Books, Watch later, Songs. At least
  one must stay on (the last one cannot be switched off, with a note). A switched-off kind is never served and its weight spreads
  as today when a kind is empty (lib/feed/mix.js). Watch later: its videos / episodes follow Watch later's switch, not the Videos /
  Podcasts switches.
- **D3 Which items (R2a).** Per kind where it means something: Videos, Podcasts, Books: New only / Continue only / Both (default
  Both). Watch later: Both only (it is a list you chose). Songs: none (no "place"). "New" and "Continue" use the shipped definitions
  (`fresh`, including v1.381.0's "under a minute is New"; books: unstarted = the Start something new card). With New only the
  mix's one-new-per-two-continuations cap does not apply to that kind; with Continue only that kind serves no fresh cards. A kind
  whose choice leaves nothing to show drops out for the session like an empty kind.
- **D4 Where items start (R2b).** Per kind: Videos, Podcasts, Books: "From my saved place" (default, today) / "From the beginning".
  Disabled (greyed, with a one-line reason) when Which items is New only (new items always start at the beginning). "From the
  beginning" on a Continue item: the card plays / shows from 0 (a book: the first real chapter, the v1.380.0 rule) and the saved
  place is NOT moved backwards (the forward-only rule already refuses it); it is only moved again once playback passes the saved
  place. The card says "From the beginning" in its kind line so the choice is visible. Video intro-skip (v1.380.0 D8) still applies
  to fresh videos only.
- **D5 Reel length (R3).** Videos: 30 s / 60 s / 90 s / 2 min / Whole chapter; default 60 s. Podcasts: 1 / 2 / 4 min; default 2 min
  (Dean said four minutes is a lot). Today's constants (lib/feed/api.js:46-47 `PODCAST_SLICE_SEC = 240`, `VIDEO_SEGMENT_SEC = 180`,
  and the chapter rule) become the server's reading of the client's choice, passed on GET /api/feed (validated against the allowed
  values; anything else = the default). "Whole chapter" = today's chapter behaviour (a video with no chapters falls back to 2 min).
  A 60 s reel starts at the card's start point (saved place or beginning, D4).
- **D6 The one-minute guard vs a 60-second reel.** A fresh card writes nothing until a minute of playback (v1.380.0 D7), so a fully
  watched 60 s reel would never count. Keep the guard's MINIMUM at the shipped value, but a fresh card that plays its WHOLE reel
  (to its end) counts as started too. State it in the ledger; the gate checks a 10 s look still writes nothing.
- **D7 The way out (R4).** In the last 10 seconds of a video or podcast slice, and on its Done state, a pill appears above the
  overlay text: "Keep watching" (video) / "Keep listening" (podcast). Book cards keep "Open in reader" (already there) and gain the
  same treatment on their last page of the session excerpt. Tapping it: the current Feed session ends as if Done (its record and
  recap are saved, the recap is NOT shown), the item opens in its full place (the watch page / the podcast player / the reader)
  continuing from where the card got to, still playing for media (the shared player carries over, as v1.379.0's "leave the feed"
  path already measured). The pill is a button: its tap is never a play / pause tap.
- **D8 Settings take effect** on the next batch: a change while a session runs applies from the next fetched cards, never
  re-shuffles cards already on screen.
- **D9 Unchanged.** Time limit, recap, extension, Start over, Fit / Fill, kinds' weights.
- **D10 Double-tap like (R5).** On media cards (video, podcast, song): double-tap = like (toggle on only; a second double-tap does
  not unlike, like TikTok) with a heart animation at the tap point (reduced motion: a static heart). A single tap still plays /
  pauses, after the double-tap window (reuse the watch page's tap / double-tap discrimination in player.js, same window; measure
  the added pause latency and state it). Book cards: double-tap likes the book. The "..." menu (v1.381.0's) gains Like / Unlike
  and Add to / Remove from Watch later (videos and podcasts). All through the existing like and Watch later routes (music likes,
  media likes, book likes, user_watch_later), visibility-checked as today.
- **D11 Not interested (R6).** "..." menu: "Hide this" = add the item to the existing home-feed hide list (`user_feed_hidden`; reuse
  its route) and the Feed never serves it again; "Fewer from <channel / show / artist / author>" = a SYNCED pref list (cap 200
  keys, LESSONS 12 lists) the Feed weighs at 0.25x. Both show a toast with Undo (10 s). A "Hidden and fewer" list on the Feed
  settings page undoes either later.
- **D12 Instant next card (R7).** Measure first: time from swipe settle to first frame / first audio on the active card, on WebKit
  and Chromium headless (and the device check). Then preload WITHOUT a second player: for the next card, fetch its poster / art,
  warm its media with a small HTTP range request at the card's start point (the server already serves ranges), and fetch the next
  book page text. The shared player is moved and loaded only on activation, as today (iOS: never two playing media elements). Report
  before / after times; the target is under 500 ms to first frame on the LAN. Never preload more than the next 1 card (data use).
- **D13 Song reels (R8).** Song cards play a clip of the video reel length setting's audio twin: a "Song clip" setting 30 / 45 /
  60 s / Whole song, default 45 s, starting at one third of the song (clamped so the clip ends before the song does). "Keep
  listening" (D7's pill) plays the whole song from where it is in the Music player. Play counts (v1.378.0): a clip that plays to its
  end counts a play, a swipe before the play threshold is NOT a skip (a reel is not a rejection); only Keep listening and the full
  song use the normal rules.
- **D14 Music under book cards (R9).** A Feed setting "Music while reading": On (default) / Off, and its source: a station picker
  (v1.378.0 stations; default the first that exists of Chill, Lofi, Jazz, Ambient, then Favorites, then liked songs). While a book
  card (or a Start something new card) is active, a song from that source plays through the shared player (the book card has no
  media of its own), starting at about a third in like D13, and the next song from the station follows when one ends; it keeps
  playing across that book's page swipes (D7 of v1.381.0) and consecutive book cards, and stops when a non-book card becomes active
  or the Feed ends. The card shows an attribution chip "♫ <song> · <artist>" over the bottom overlay; tapping it opens a small
  sheet: Like the song, Mute music for this session, Change station. Background listening never counts plays or skips (it would
  teach radio that every book page was a skip). Volume: iOS ignores scripted volume, so no ducking; say so in the ledger.
  Text-to-speech is never active in the Feed, so there is no clash.

## 4. What exists (kickoff read 2026-10-10; re-verify line numbers)

- Server: lib/feed/api.js (sources, fresh keys :270-342, slices :46-71, cards :400-470), lib/feed/mix.js (`pickCards`, weights,
  the fresh cap), lib/feed/routes.js, lib/feed/safe-progress.js (`freshNeedSec`).
- Client: public/js/feed.js (picker `init` / `startSession`, `fillCard`, `playCard` with `data.progressGate`, `finishNow`,
  `openRecap`, `endSession`), CSS `#view-root[data-view="feed"]` in public/css/style.css.
- Synced prefs: lib/prefs-allowlist.js (keys list) and its client twin public/js/prefs-sync.js; censuses that pin both.
- Settings page model: public/setup.html `data-collapse-key="bottom-bar"` (~583) and the setup master-detail census tests.

## 5. Waves

- **W1 Settings page + prefs:** D1, D2-D5 controls (with the disabled-when-New-only rule), synced keys, censuses, the picker gear.
- **W2 Server:** GET /api/feed reads kinds / which / where / lengths (validated), D2-D5 serving, D6 guard rule (server side of the
  played-seconds check).
- **W3 Client:** cards honour the choices (kind line "From the beginning"), D6 client side, D7 Keep watching / listening / reading
  pill and the exit path, D8.
- **W4 Card actions:** D10 double-tap like + menu Like / Watch later, D11 Hide / Fewer from with Undo and the settings list.
- **W5 Reels and speed:** D13 song reels, D14 music under book cards (setting, station source, attribution chip), D12 measured
  preloading.
- **W6 Close-out:** ledger, device checks in docs/DEVICE-CHECKS.md (each switch; New only / Continue only per kind; From the
  beginning without losing the saved place; 60 s reels; Keep watching lands on the watch page still playing at the same spot;
  settings follow to the desktop; double-tap like on each kind; Hide / Fewer from + Undo; swipe-to-first-frame feels instant; song
  clips from the chorus; music under book pages with its chip, across page swipes, stopping on a video card), ROADMAP, a LESSONS line if a new class appears.

## 6. Gate
FULL: adversary, qa (security as a section: the new query params are validated server-side; settings are the user's own). Brief
the Adversary on: "From the beginning" moving a saved place backwards (it must not), D6 letting a short look write progress, a
switched-off kind still served, New only serving a Continue item and vice versa, the exit path losing the position or leaving two
players, the synced keys missing from either list, the last kind being switchable off; a double-tap that also pauses or seeks,
a like / hide on the wrong card (the card changed under the gesture), Hide reaching an item the viewer cannot see, preloading
that starts a second media element or plays audio on iOS, background book music counting plays or skips, book music that keeps
playing on a video card.

## 7. Release
docs/RELEASING.md and AGENTS.md exactly: version bump, CHANGELOG / releases.json in Dean's plain words, the plan closed out in the
same PR (`node scripts/plan-complete.js docs/exec-plans/active/2026-10-10-feed-settings.md "Shipped vX.Y.Z" --apply`), the
protected-main PR flow, shipped = the tag's "Publish Docker Image" run green, branch deleted remote and local.

## 8. Evidence (builder fills: numbers copied from the runs named, verbatim verdict lines)

- Serving falsifiers (kinds off, New only, Continue only, From the beginning, lengths):
- D6 (10 s look vs a whole 60 s reel):
- D7 exit path (position and single player):
- D12 swipe-to-first-frame before / after (WebKit, Chromium):
- D10 added pause latency from the double-tap window:
- D14 book music: counts untouched, stops on a non-book card:
- Suites (Node 22.23.1 / 24.20.0) at the reviewed sha:
- Gate rounds:
- Device checks owed:

## 9. Out of scope
Comments or captions overlays; per-kind weights or ratios; per-device (unsynced) feed settings; new kinds; phases 2-3 (Reading); Start over outside the Feed.
