---
plan: feed-tiktok
harness: v2 · full
branch: feat/v1.381.0-feed-tiktok
anchor: outcome
status: Gate r1 @bba614be: adversary CHANGES, qa CHANGES, security-brief APPROVED
next: the r1 fix round (adversary W1-W4, qa W1-W5, security N1-N2), then r2 with the same seats
design: Dean's device feedback on v1.380.0 Feed (2026-10-09, eight points + swipe left/right); kickoff defaults D1-D11. Base main 42ec865c (v1.380.0).
builder: smart (the shared player's gestures in a new full-bleed host, a layout rework of every card, and a deliberate progress RESET: a data-loss surface)
gate: r1 CHANGES (FULL: adversary, qa, security-brief)
---

# v1.381.0: Feed, TikTok style - full-screen cards, no scroll traps, tap / hold on video, Start over

Norms: no em dashes in docs or user prose; stage files by name; `git commit -F <file>`; never pipe a commit or push; export the
fnm Node 22.23.1 PATH before any node/npm/git command; no toggle workarounds; never self-merge.

Read first: AGENTS.md; docs/LESSONS.md sections 0, 1, 2, 5 (playback and gestures), 6 (blast radius: player rules and gestures are
shared with the watch page), 10, 12; the shipped plans docs/exec-plans/completed/2026-10-09-feed-mode.md and
2026-10-09-feed-polish.md (their ledgers and gate rounds: the forward-only / stale-refusing rule D5, the fresh-card one-minute
guard D7 and its single writer `saveProgressToServer`, stay intact); docs/references/pwa-ios-notes.md.

## Step 0. Before anything (builder)

- Work ONLY in the worktree the launcher made: `.claude/worktrees/feat-v1.381.0-feed-tiktok` on branch
  `feat/v1.381.0-feed-tiktok` (this plan is committed there; `node_modules` is a symlink, never stage it). Never touch the main
  checkout (the Root works there).
- Before every node / npm / git command: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
  Dual-Node: 22.23.1 then 24.20.0, sequential. Targeted tests while building; the full dual suite once before the gate and once
  at release.
- Git: stage by name, `git commit -F <file>`, verify with `git log -1` / `git ls-remote`; never `--no-verify`, never force-push;
  the protected-main PR flow (docs/RELEASING.md). If another release merges first, merge origin/main in, take the next free minor,
  re-run the suites.
- UI work is MEASURED (memory norm "Measure UI changes"): headless before/after at 390 x 844 and 320 x 568 (DPR 3), WebKit and
  Chromium, rects for every overlay element; send Dean side-by-side screenshots of each card kind (SendUserFile) after W2, before
  the gate, and fold his answer in.
- Stop and ask Dean (AskUserQuestion) when: a ruling contradicts the code or a measurement; the iOS back-swipe conflict (D7)
  cannot be avoided by the edge rule; the gate reaches round 3; `gh pr merge` is refused.

## 1. Outcome (Dean, 2026-10-09, after using v1.380.0)

"This feels very promising. It's close... I think we need to optimize more to TikTok style feed." His points, verbatim-ish:

1. In Feed, don't show the "watching / listening on another device" banner.
2. "It is hard to scroll between entries when reading a book as its own scrollable area itself scrolls. It's also hard for other
   things. It's generally hard to get between."
3. Video content is not large enough: "I like the initial implementation (screenshot of vid with frame under). But a Feed might need
   to be zoomed in like a TikTok... even if not optimized for it."
4. The download pill is obstructive in Feed: omit it.
5. Podcast art is huge relative to the little player: "we need to optimize content display size" (tied to 3).
6. A "Start over" for a piece of content (book, video, podcast...), because items he never really started show up as Continue
   (cached from an old view), "and it'd be nice to just do it here."
7. The time ring overlaps the title.
8. Videos have no controls: "tap to pause / play, with tap to hold" (hold = 2x, as on the watch page).
9. "Maybe we also support swipe right / left. There's a conflict in that swiping left brings one back."

## 2. What exists (kickoff read 2026-10-09; re-verify line numbers)

- public/js/feed.js (1179 lines): `fillCard` :631 (book text in `.feed-card__text` inside `.feed-card__body`, song / podcast art
  `.feed-card__art`, video poster `.feed-card__poster` + `.feed-card__slot`), `fillNewBookCard` :705, `playCard` :907 (the shared
  player `p.load(card.id, data, {slot})`, the fresh guard via `data.progressGate`), `ensureRing` :492, `setActive` :802,
  `onIntersect` :792, `showHint` :821.
- public/css/style.css ~12774-12831 (`#view-root[data-view="feed"]`): `.feed-stack` scroll-snap column; `.feed-card__body
  { overflow-y: auto }` (the nested scroller of point 2); `.feed-card__slot` 16:9; `.feed-card__art` `min(100%, 40vh)` square;
  `.feed-hud` absolute top-right (point 7).
- The other-device card: `#handoff-card` (public/js/common.js ~17692-17760, "Continue here"). The download chip:
  `#dl-status-chip` (common.js ~6460).
- Existing resets to REUSE, not duplicate: video "Mark as unwatched" (watch.js ~703; POST /api/watched/:id family,
  lib/media/user-routes.js ~581), `DELETE /api/history/:id` (lib/user/routes.js:250: drops the pending progress and the user's
  history row), podcasts "Mark unplayed" (podcasts.js ~798). Books: find the reset path if any (lib/books/routes.js); if none,
  add one (D9).
- The watch page's phone gestures (tap = play / pause, hold = 2x, double-tap skip) live in player.js; LESSONS 5 / 6 history
  (v1.358-v1.362: hold-to-2x, loupe, touch cancel) - reuse that machinery, never a second copy.

## 3. Kickoff defaults (D1-D11; state each in the ledger as built; Dean overrules at the device pass)

- **D1 Hide the other-device banner in Feed (point 1).** While the view is `feed`, `#handoff-card` is not shown (and not
  re-shown by a presence update); leaving Feed restores today's behaviour. Feed's own playback never triggers it either.
- **D2 Hide the download chip in Feed (point 4).** `#dl-status-chip` hidden while the view is `feed`; downloads continue; the chip
  returns on leaving. No other page changes.
- **D3 One layout for every card: full screen, overlay text (points 3, 5, 7).** Each card fills the stack (as now) with its MEDIA as
  the full-card layer and the text as an overlay at the bottom (kind line, title 2 lines max, channel / show / author, the "left"
  readout) over a bottom gradient (tokens; legible in light and dark). The HUD (ring + time) sits top-right in a reserved strip the
  overlay never enters; measure zero overlap at 320 and 390 with the longest real title.
- **D4 Video fill (point 3).** The active video fills the card: `object-fit: cover` (landscape is cropped, "zoomed in" like
  TikTok); portrait fills naturally. A small Fit / Fill button in the overlay switches to the letterboxed view (`contain`) for this
  card; the choice is remembered per device (localStorage, try/caught). Before playback starts, the poster fills the same way (no
  separate "frame under" layout).
- **D5 Podcast and song cards (point 5).** The art becomes the card background (a blurred, darkened cover fill, like the music
  player's art backdrop if one exists - reuse it), with the art itself at a moderate size (about 45% of the card width, centred
  above the overlay); the controls / readout sit in the overlay. No art larger than the space left above the overlay.
- **D6 No scroll traps (point 2).** No element inside a card scrolls. `.feed-card__body` loses `overflow-y: auto`. Book cards:
  the excerpt is FITTED to one screen - the client lays out blocks until the next would overflow and stops there; the remainder
  is the next "page" (D7). The bookmark rule counts only what was on screen (the shipped dwell rule, per page). The new-book
  card's description and taste follow the same rule (the taste is pages, not a scroller).
- **D7 Horizontal swipes (point 9).** On a BOOK card, swipe left = next page of that book, right = previous page (within the
  session's fetched text; fetch more as needed through the existing excerpt route). On every other card horizontal swipes do
  nothing. The conflict: a swipe that STARTS within 24 px of the left or right screen edge is never taken (left to iOS / the
  browser's back gesture); measure on WebKit with touch emulation and list the device check. Vertical swipe stays next / back card.
- **D8 Tap and hold on video (point 8).** On the active video card: a tap anywhere on the media = play / pause (a brief centred
  glyph); press and hold = 2x while held (the watch page's hold machinery, same thresholds, same "no loupe" rules); a thin
  progress line along the bottom edge of the media (non-interactive in v1). Taps on overlay buttons are not play / pause. Podcast
  and song cards: tap = play / pause too; no hold.
- **D9 Start over (point 6) - a DATA-LOSS surface.** A "..." button in each card's overlay opens a small menu with "Start over"
  (books, videos, podcasts, Watch later items; not songs). It resets that item's place for THIS user only: video = the existing
  unwatched + history removal path (position 0, not watched); podcast = the existing "Mark unplayed" path plus position 0; book =
  position cleared to the beginning and not finished (add a user-scoped route if none exists, same visibility check as the
  progress route). Safety: (a) a confirm sheet that names what is lost ("Your place, 1:23:10 of 2:04:00, will be forgotten");
  (b) the previous state is kept and an Undo toast (10 s) restores it exactly (position, watched / finished latch, Watch later
  membership untouched); (c) the previous state is also recorded in the feed session's summary like the D5 previous positions,
  so it is recoverable after the toast; (d) only the item on that card, never a batch. The card then re-labels as New and plays
  from the start. Start over is an explicit action and is NOT subject to forward-only; every OTHER feed write still is.
- **D10 Stale "Continue" items (point 6's cause).** Measure first why items Dean "didn't actually start" show as Continue: old
  positions below the watching floor, positions written by pre-v1.380 feed sessions before the one-minute guard, or a preview /
  hover path writing progress. Report the counts on the fixture and on Dean's data if a read-only query helps (give him the
  command); fix the cause if it is a code path writing progress it should not; otherwise Start over is the answer. No bulk
  cleanup without asking Dean.
- **D11 Unchanged.** The time limit, recap, extension, kinds and weights, fresh / continue labels and guard, the swipe hint (it now
  also says "Swipe left for the next page" on the first book card of the first 3 sessions).

## 4. Waves

- **W1 Chrome quiet:** D1, D2 (small; ship-ready on its own).
- **W2 The full-screen layout:** D3, D4, D5, D6 (fitting book pages), measured before / after; side-by-side screenshots to Dean.
- **W3 Gestures:** D7 (book page swipes + edge rule), D8 (tap / hold / progress line).
- **W4 Start over:** D10 measurement first, then D9 with confirm, Undo, session record.
- **W5 Close-out:** ledger, device checks in docs/DEVICE-CHECKS.md (each card kind full screen at 320 and 390; no inner scroll;
  book page swipes and the back-swipe edge; tap / hold on video; Fit / Fill; no banner, no chip in Feed; Start over + Undo on each
  kind; ring clear of the title), ROADMAP, a LESSONS line if a new class appears.

## 5. Gate
FULL: adversary, qa, security-brief. Brief the Adversary to DESTROY data through Start over: Undo after a navigation, Undo after
the toast expired, Start over on one device while another plays the item, a double tap on Start over, the wrong item (the card
changed under the menu), a restricted user resetting an item it cannot see, the book route's input. Also: no scroll trap remains
(every card kind at 320 px), the hold-to-2x / tap machinery shared with the watch page still passes its own tests (LESSONS 6),
the edge rule, the HUD never over the title, the banner and chip back after leaving Feed.

## 6. Release
docs/RELEASING.md and AGENTS.md exactly: version bump, CHANGELOG / releases.json in Dean's plain words, the plan closed out in the
same PR (`node scripts/plan-complete.js docs/exec-plans/active/2026-10-09-feed-tiktok.md "Shipped vX.Y.Z" --apply`), the
protected-main PR flow, shipped = the tag's "Publish Docker Image" run green, branch deleted remote and local.

## 7. Evidence (builder fills: numbers copied from the runs named, verbatim verdict lines)

- Layout before / after (rects, 390 / 320, each card kind): `node tools/feed-proof/layout.js <tree> <out> both` (Chromium + WebKit,
  390x844 and 320x568, DPR 3, touch; every card kind of the shared fixture, the longest titles 121 / 103 characters). Base 42ec865c:
  `SUMMARY layout: 4 runs, cards per run [6,6,6,6], scrollers 16, hudOverTitle>0 24`; the other-device card in the Feed
  `{"handoff":"flex"}` on all 4 runs (Dean's point 1 reproduced). This branch (W2 bb933766, re-run at W3): `scrollers 0, hudOverTitle>0 0`,
  the Feed `{"handoff":"none"}` and back on Home `{"handoff":"grid"}`. Chromium 390: card {x 0, y 56, w 390, h 716}, the playing video
  {w 390, h 716, fit cover} (before: 340 x 191 under a poster), title {y 660, h 44, 2 lines} vs HUD {x 272, y 68, w 106, h 44}: 0 overlap
  (before: 2392 px squared on every card); podcast / song art 161 px square at Chromium 390 (45% of the stage's inner width, 16 px
  padding each side; gate r1 qa W5 measured it - the 147 first written here was wrong) over its blurred backdrop (before: the art
  338 px plus the player's own art below it). 320: card {w 320, h 440}, video 320 x 440, art 130 px (Chromium) / 119 px (WebKit), 0
  overlap. Not measured: the download chip coming back after the Feed (the fixture runs no download: "chip":"absent"; the rule and
  its specificity are unit-bound, the device check covers it). WebKit cards measure
  24 px narrower: Linux WebKit draws classic scrollbars (`stackScrollbar` 12 px, plus the page's), iOS overlays them. Dean saw the
  side-by-side sheets (Chromium 390 and 320) and answered "Looks right, go on".
- D6 fitted pages: jsdom over a modelled page box (test/unit/feed-tiktok.test.js, `pageWords`): ['1:10 2:15', '2:25c', '3:3'] style
  layouts per fixture, a heading never split, a page left with fewer than 8 words of room starts the next paragraph on the next page;
  in the browser the fixture book's card (3 x 48-block chapters) lays out as "Page 1 of 3" at 390x844 and fills the page box (screenshot
  in the W2 sheet). The place moves only to the first unread page's start: reading page 1 of 3 then swiping on writes (0,3), never the
  card's next (0,6); a page shown under its dwell writes nothing; a page read after an unread one moves nothing past it.
- D7 edge rule on WebKit: `node tools/feed-proof/gestures.js . out both` -> `SUMMARY gestures: 2/2 pass (chromium+webkit)`. Chromium with
  REAL CDP touches: a swipe on the book card from x=10 stayed "Page 1 of 3", from x=300 went to "Page 2 of 3"; a swipe that starts on the
  playing video went video -> the next card; tap paused at 6.4 s with the glyph (`art-play-glyph-flash`), tap played; a 900 ms hold read
  rate 2 with the badge, the lift rate 1 still playing. WebKit: taps through page.touchscreen (pause / play), the swipes as synthetic
  pointer events (Playwright's WebKit has no touch-move) with the same page results - so WebKit's own back gesture vs the 24 px rule is
  a device check. Not reproduced: on the base tree in headless Chromium a swipe from the video ALSO moved the stack (and tap / hold did
  nothing there), so "the player's touch cancel blocked the swipe" stays a reading of player.js, not a measurement.
- D10 stale-Continue cause and counts: no path writes a place for a look (every writer is the player's one saveProgressToServer or the
  reader's ping); the cause is the Feed's own test - a video was Continue above the 0.5% watching floor (6 s of a 20-minute video), an
  episode at ANY position above 0 s. Fixture (test/integration/feed-stale-continue.test.js, the real routes): a 10 s watch-page look ->
  `video Continue 2 moved by a feed session 1 {"under 1 min":1,"1-5 min":1}`, a 3 s episode -> `podcast Continue 1 ... {"under 1 min":1}`,
  a reader-opened book moved by a feed card -> `book Continue 1 moved by a feed session 1`. Dean's data: not on this box (the dev
  database has no places); the read-only command is in docs/DEVICE-CHECKS.md. Dean's ruling (AskUserQuestion, 2026-10-09): "Under 1 min
  = New" - built in lib/feed/api.js (startedUnderAMinute), labels and the mix only, no stored place touched.
- Start over + Undo falsifiers (each kind): test/integration/feed-start-over.test.js (13): exact restore per kind (video progress +
  watched with their timestamps, Watch later kept; episode position + played; book place + finished); a parallel double tap = one 200 +
  one 409 'nothing', one record; Undo after another device played = 409 'moved', the newer place stands, the record kept; Undo twice =
  409 'undone'; a late Undo after more cards = exact; a staged ping is recorded and never resurrected; a pre-reset ping (with and
  without playedSec 75) = 409 'too-early'; a book card cannot write after its reset ('not-served'); Undo re-checks visibility (hidden =
  404, nothing restored); input (bad kind, empty, NUL, 300 chars, `__proto__`, another user's session / token); the record survives the
  finish; never merged into by the next write; a failing record write resets nothing (fault-injected, 500). Mutants on 1664921f (a /tmp
  git-archive sandbox): 17 / 17 killed (S1 record-after-reset, S2-S10, S12-S18), after S5, S10 and S17 first SURVIVED and got their own
  tests (S10's first test was vacuous: the session check masked it). Browser: `node tools/feed-proof/start-over.js . out both` ->
  `SUMMARY start-over: 2/2 pass (chromium+webkit)` - the real "...", confirm ("Your place, 0:50 of 1:00, will be forgotten."), the row
  gone, the video at 0 and "New", the real toast's Undo -> the row back exactly {timestamp 50, duration 60, updatedAt
  2026-10-01T10:00:00.000Z}, "Continue"; the book's place reset and restored exactly.
- Other mutants: W2 12 / 12 killed (M9 and M12 first survived, then bound), W3 11 / 11 killed.
- Suites (Node 22.23.1 / 24.20.0) at the reviewed sha: `npm test` at bfb7393c (the worktree, sequential) - Node 22.23.1: `# tests 12009
  # pass 11996 # fail 0 # cancelled 0 # skipped 13` (exit 0); Node 24.20.0: `tests 12009 pass 11996 fail 0 cancelled 0 skipped 13` (exit 0).
- Disclosed for the gate: the Start over record rides `moves`, which keeps the newest FEED_SESSION_MOVES_CAP (300) entries a session;
  a book page write or a coalesced ping chain is about one move a minute, so eviction inside one session is unlikely but not
  impossible (an evicted record = an Undo that 404s, the reset itself already done).
- Gate rounds:
- Device checks owed:

## 8. Out of scope
Start over outside the Feed (watch page, reader, podcasts page: ROADMAP Planned if Dean wants it everywhere); a scrubbable
progress line; horizontal swipes on media cards; comments / likes overlays; new card kinds; the phase 2-3 Reading work.

## 9. Ledger (as built; Dean overrules at the device pass)

- **D1 / D2 (W1).** One CSS rule keyed on body[data-view="feed"] (stamped by the router on every view change) hides #handoff-card and
  #dl-status-chip in the Feed; leaving restores both as they were; downloads go on. No !important (ui-lint): `html:root` lifts it
  strictly above every display rule on either id.
- **D3 (W2).** Every card: media layer (absolute, the full card), a HUD strip (the ring's height plus its inset), the stage, the overlay
  (kind line, title clamped to 2 lines, meta, readout and buttons) over a dark fade. Edge to edge on the phone (the main column's side
  padding dropped in the Feed only).
- **D4 (W2).** Video object-fit cover; a Fit / Fill pill (stacked labels, no width change) switches every video card; `ft-feed-fit` per
  device. The slot rules are keyed on #player-wrapper / #media-player to out-rank the full player's two-id 16:9 rules.
- **D5 (W2).** Podcast / song: the art blurred and darkened as the backdrop (the music skin's recipe), the art once at 45% of the width;
  the player's own surface draws nothing but its tap glyph.
- **D6 (W2).** No scroller in a card. Book pages FITTED to the page box; the place moves to the first unread page's start (pages read in
  order, each its own dwell); the recap counts the words on the pages read. The new-book card's cover + description are a page, the
  taste is pages.
- **D7 (W3).** Swipe left / right on a book card turns the page, never from within 24 px of a screen edge; arrow keys too. Past the last
  page, the excerpt route in `continuation=1` mode (never re-stamps the served registry). The page cue on the first 3 sessions.
- **D8 (W3).** A gesture layer over the media (never cancels a touch): tap = the player's picture tap (glyph), hold = engageHold /
  releaseHold through a small player API with its own thresholds; audio never holds. A thin progress line shows the slice.
  NOT as planned: no "hold-lock by drag" in the Feed (a drag is a swipe there); the loupe guard of the watch page (cancel every touch)
  is NOT used, because it would block the swipe - the layer is an empty element, so the device check covers the magnifier.
- **D9 (W4).** Start over as built in section 7; the record rides the existing `moves` carrier (backup, restore, the client-never-writes
  rule); a book card is frozen after its reset; a 10 s Undo toast. Also fixed on the way: every Feed toast passed ui.toast one object
  ("[object Object]" on the device since v1.379.0).
- **D10 (W4).** Measured and ruled (section 7): under a minute in = New, in the Feed only - the label, the mix's New / Continue balance
  and the card's one-minute write guard (a card under a minute in writes nothing until it has played its minute); the stored place is
  never changed. scripts/feed-stale-continue.js (read-only).
- **D11.** Unchanged except the page cue.
- **Dean, mid-build (2026-10-09): "It should not rotate when going sideways."** A player hosted in a Feed card ignores rotation (no faux
  fullscreen, no expanded audio; iOS's rotate-into-native is bounced back without arming faux), keyed on where the host is
  (`rotateIgnoredForHost`). A web app cannot lock the page upright on iOS: in landscape the Feed lays out wide.
- **Dean, D10 (2026-10-09):** "Under 1 min = New (Recommended)".
- **Dean, W2 look (2026-10-09):** "Looks right, go on (Recommended)".

## 10. Gate

The three r1 seats ran in parallel on one tree, so each returned its verdict in its final message and the builder pasted it
here verbatim (a parallel append to one file could clobber a line).

Gate: CHANGES r1 @bba614be - adversary

### adversary r1 @bba614be

(no CRITICAL; worktree unchanged; repros and mutant lists in /tmp/adversary-repros/)

Instruments, failures first: full suite Node 22.23.1 in a `git archive bba614be` sandbox `# tests 12009 # pass 11987 # fail 8
# cancelled 0 # skipped 14` (exit 1) - all 8 are sandbox artifacts (6 "fatal: not a git repository", 2 EISDIR in
comment-debt-census on the node_modules symlink); the 7 files pass 69 / 69 in a git clone at bba614be; the 14th skip not traced.
Node 24.20.0 targeted (feed-start-over, feed-stale-continue, feed-progress, feed-api, feed-tiktok): 72 / 72. layout.js both
engines at 390 and 320 `SUMMARY layout: 4 runs, cards per run [6,6,6,6], scrollers 0, hudOverTitle>0 0`, the handoff card hidden
in the Feed and back on Home in all 4. gestures.js `2/2 pass (chromium+webkit)`.

WARNING
- W1 (blocking). Undo is unreachable once the user leaves the Feed, the session resets or a new one starts, while the toast still
  offers it: ui.toast lives on <body>, undoStartOver uses the view's abort signal and the CURRENT session (resetToPicker sets it to
  null: a silent return; a new session sends the old token with the new id: 404). Browser repro (adversary-nav-undo.js, Chromium):
  `{"afterReset":null,"view":"home","undoButtonsAfterNav":1,"requests":["POST /api/feed/start-over"],"toasts":["Could not undo"],
  "afterUndo":null}`. Unit repro ADV-4 (a fetch that rejects on an aborted signal): `undo posts 0 toasts ["Started over: V","Could not
  undo"]`, not ok. And "kept in this session's record" points at nothing a user can open (no GET exposes summary.moves). Fix:
  capture the session id at the reset, send Undo without the view signal, and either give the record a way back or stop promising it.
- W2 (blocking). Undo can return 200 and lose the place at the next coalescer flush: the CAS treats a staged media ping at
  timestamp 0 as "as the reset left it"; the restore writes the row, the pending 0 s entry flushes over it, and undoneAt refuses a
  second Undo. Real 0 s savers: the watch page's startOverFromZero, a skip-back to 0. ADV-1: `undo 200` / `row right after undo
  {"timestamp":300,...}` / `row after the flush {"timestamp":0,...}` / `record undoneAt 2026-10-09T20:48:35.098Z`, expected 300
  actual 0. Checked fix: also 'moved' when pendingProgress has the key (ADV-1 then 409 'moved', 16 / 16); cleaner: compare against the
  exact state the reset left (no row, no staged write, no latch) for every kind. The LESSONS rule is false until fixed.
- W3 (blocking: test gaps on the data-loss surface; the rule claims one mutant per guard). Survived: A1 (drop
  pendingBookProgress.delete in start-over; ADV-3 binds it), A6 / A7 / A8 (drop the played / finished / watched latch arm of
  nothingToForget), C6 (drop the "The end." sentinel arm of feedBookTarget: 179 / 179), C11 (drop the continuation stale-response
  guard: 179 / 179), A14 / A15 / A16 (drop the D10 under-a-minute arms feeding the mix's fresh / continue balance: 46 / 46; the
  labels are bound). Killed: A2, A4, A5, A9-A11, C1, C2, C7-C10, C12-C14.
- W4 (non-blocking if disclosed). The confirm names the CARD's place (feedStartOverText reads card.progress / position /
  chapterLabel), the reset reads storage: after another device moved on, the sheet names the served place while a later one is
  reset (the record and Undo hold the real one). Reasoned, not run. Fix: show the server's `previous` in the toast, or read the
  stored place before the sheet.

SUGGESTION
- card.startedOver is written, never read: after a prune and rebuild the book card loses "Started over" and offers "..." again; a
  second tap says "Nothing to start over: it was not started". Nothing lost (bp.refused survives).
- Only the browser proof binds the video layer's touch handling (G5: an always-preventDefault touchmove passes every feed unit test;
  gestures.js chromium catches it `0/1 pass`); the rotate guard and the webkitbeginfullscreen intercept are source-regex only.
- The download chip coming back after the Feed is not measured (the fixture has no download: "chip":"absent").
- Not reproduced: feedPaginate stops at FEED_MAX_PAGES (400) while bp.end stays the card's next - with a page box of ~1 word, reading
  every page would move the place past the cut blocks.
- restoreMediaPlace / restoreBookPlace pass record values through unchecked (podcast uses num()): only a crafted admin backup reaches
  it. The session id length cap (A3) is untested, no behaviour impact.

Verified holding: every restricted-user case incl. a podcast library restriction on both routes (ADV-2: 404 / 404, nothing reset or
restored); a double tap = one 200 + one 409 'nothing', one record; a pre-reset ping refused too-early (the browser saw the pause
checkpoint land as `POST /api/feed/progress/media 409` right after the reset); the continuation never re-stamps; the 24 px rule (C8,
C9 killed); hold-to-2x released on dock / close; the watch page's own tests green; MAX_PLAY_RATE 2 = the player's top speed.

Gate: CHANGES r1 @bba614be - qa

### qa r1 @bba614be

(review of `git diff 42ec865c..bba614be`, 30 files; runs and mutants in a /tmp `git archive bba614be` sandbox, the shared
worktree untouched)

Instruments (verbatim): targeted tests Node 22.23.1 `# tests 141 # pass 141 # fail 0 # cancelled 0 # skipped 0`; every feed /
hold / loupe / rotate / faux / toast test file `# tests 410 # pass 410 # fail 0`; Node 24.20.0 `tests 386 pass 386 fail 0
cancelled 0 skipped 0`; ui-lint `OK - the live debt equals docs/ui-exceptions.json`; overlay-containment `clean (0 violations)`;
eslint clean. layout.js chromium 390x844 `SUMMARY layout: 1 runs, cards per run [6], scrollers 0, hudOverTitle>0 0` (W1 feed
handoff none, Home grid); webkit 320x568 and chromium 320x568 the same 0 / 0. gestures.js both `2/2 pass` (WebKit: the stack did
not move from the video and the hold was not run, yet PASS). start-over.js both `2/2 pass`, exact true for video and book. The
"[object Object]" claim verified: ui.js:779 `toast(message, o)` renders `spanText(..., message)`.

WARNING
- W1. Undo after leaving the Feed fails and the place stays forgotten (VERIFIED in Chromium). feed.js undoStartOver / startOver
  pass the VIEW's signal and read the live `session`; the toast lives on <body> and survives the SPA navigation, the view's abort
  rejects the Undo fetch, "Could not undo", though the server would accept it. Repro (a copy of start-over.js navigating to '/'
  after the reset): `QA-NAV {"spa":"function","viewNow":"home","toastStill":true,"toastsAfter":["Could not undo"],"afterUndo":
  {"progress":null,"watched":null},"exact":false}`. Leaving mid-request resets with no Undo toast (reasoned). Fix: the two
  fetches get their own lifetime, the session id captured at the tap; a test with a signal-honouring fetch.
- W2. A book card rebuilt after pruning loses its continuation pages, and the bookmark then jumps past unread text (harness repro
  test/qa/qa-prune.test.js): fillBookCard re-runs on un-prune and resets bp.blocks to card.blocks while bp.read / bp.end keep the
  continuation's. Read 3 pages, fetch the continuation (blocks 6-7, next (0,8)), glance 0.5 s, move 4 cards on, come back, leave:
  `readout after continuation: Page 4 of 4` / `card 0 pruned: true` / `readout after rebuild: Page 1 of 3` / `book writes:
  [{"spineIndex":0,"blockIndex":6},{"spineIndex":0,"blockIndex":8}]` - the second is forward and accepted; 6-7 never read. Fix: seed
  bp.blocks only when the state is created; a rebuild re-lays the existing blocks.
- W3. An Undo that returns 200 is overwritten by a 0 s ping staged after the reset (real routes, test/qa/qa-zero-ping.test.js): v2
  at 300 s, Start over, POST /api/progress {timestamp:0}, Undo: `undo status 200` / `after undo, before flush {"progress":
  {"timestamp":300,...}}` / `after flush {"progress":{"timestamp":0,...}}`. nothingToForget's media arm treats a staged 0 s as
  nothing and the pending entry flushes over the restore. Real sources: player.js startOverFromZero (the watch page's resume
  prompt) and the on-ended save. Fix: in Undo any pending entry or stored row (even at 0) is 'moved'.
- W4. Two data paths unbound: M8 (drop pendingBookProgress.delete in the book Start over) SURVIVED; M13 (drop `bp.read = {};
  bp.pageMs = {};` in the resize re-layout) SURVIVED - no test of the resize / carry path. Killed: tap-after-move, no
  continuation=1, the route always marking, holdEnd's holdGestureLive, hold on audio, Undo without CAS.
- W5. Section 7's art sizes are wrong: layout.js at this sha measures 161 x 161 at Chromium 390, 130 at Chromium 320, 119 at
  WebKit 320 (45% of the stage's inner width), not 147 / 115. Everything else re-measured matches.

SUGGESTION
- S1. lib/feed/api.js "Labels and the mix only" is half true: `fresh` also feeds feedServed.mark, so a card under a minute in is
  now held by the server's one-minute write guard (feed-stale-continue.test.js asserts it). Reword there and in the ledger.
- S2. M1 (drop the touchmove preventDefault while 2x is held) SURVIVED: a drifting finger during a hold is unbound.
- S3. gestures.js's WebKit row passes without a stack move or a hold: say so in its criteria / summary.
- S4. scripts/feed-stale-continue.js counts Start over records as "moved by a feed session": filter m.startOver.

Regressions checked, no finding: the D1/D2 rule (1,2,2) beats every display rule, no inline style.display on either id; the slot
and .main-content rules are scoped; rotateIgnoredForHost early-returns only in a Feed slot; pictureTap honours the glyph switch;
holdStart / holdEnd go through engageHold / releaseHold; the intro note and hint paint above the touch layer (reasoned); edited
tests keep their meaning; DEVICE-CHECKS matches behaviour except the missing "Undo after leaving the Feed" case.
Security: input, ownership, visibility, client-forged records refused, continuation=1, the read-only script: no finding.

Gate: APPROVED r1 @bba614be - security-brief

### security-brief r1 @bba614be

(read-only seat, no Bash: read the worktree on disk as bba614be; findings traced in code or reasoned, marked as such)

CRITICAL: none. WARNING: none.

NOTE
- N1 (LOW, fix or accept). A start-over record that arrives in a BACKUP BUNDLE is restored by Undo without type checks:
  normalizeFeedSessionForRestore (lib/auth/store.js:540-563) keeps moves that are plain objects with string kind / id and
  checks nothing in `from`; restoreMediaPlace binds prev.progress.timestamp / duration / updatedAt as they are (no num(), no
  string check - unlike the bundle's own progress loop, store.js:2029, and restorePodcastPlace), and restoreBookPlace stores
  JSON.stringify(prev.progress) whole (no shape or size cap). Traced path: an admin restores a crafted or corrupted bundle with
  {startOver:true, token:<24 hex>, kind:'media', id:<visible>, from:{progress:{timestamp:"abc", updatedAt:"9999-..."}}}; the user's
  Undo plants a non-numeric timestamp and a far-future stamp. LOW: backup restore is admin-only, writes only the owner's own
  rows for a visible, empty item, and the bundle's progress loop can already plant an unclamped updatedAt string. Fix: normalize
  `from` per kind in the restore validator, or num() / string guards in restoreMediaPlace / restoreBookPlace (+ a byte cap).
  Proof: a store test through replaceAllUsersRaw + the Undo route asserting a numeric row or a refusal.
- N2 (test gap). No test drives a HIDDEN podcast episode through start-over or undo (test/integration/feed-start-over.test.js
  covers a hidden video, a blocked book, a missing id). The podcast arm of visibleItem (lib/feed/routes.js:198) is correct by
  trace but unbound: mutate it to `return ep ? ep : null` - expected to stay green today. Fix: a member restricted from a show,
  an episode with stored progress, 404 and untouched.
- N3 (INFO, accepted). The record is bounded by count (400 sessions x 300 moves a user), not by bytes; every `from` is built
  server-side from stored rows; a member can only fill their own rows; the bound predates this release.
- INFO: store.js:1021 "puts back EXACTLY what the route snapshotted" holds for server-written records, not for bundle-restored
  ones (N1) - reword with the N1 fix.

Checked clean (traced): session + token ownership (getFeedSession is WHERE user_id = ? AND id = ?; token looked up only in that
session's moves; 404 before any write); visibility before the "nothing" check (missing = hidden = one 404 body), re-checked on
Undo, no timing oracle (synchronous handlers); input (kind enum, plainId <= 256 and no char < 32 - keeps the NUL out of served.js
keyOf, token ^[0-9a-f]{24}$, own-property lookups, prepared statements); Undo writes only the server's own record (the finish
route refuses `moves`, updateFeedSession keeps them; a __proto__ summary stores nothing); compare-and-set before restore; both
routes classified; the excerpt `continuation=1` only skips feedServed.mark (removes a registry-tamper path, adds no read);
openReadOnlyQuery is readOnly at the driver with constant SQL and no HTTP surface; the client renders server text through
textContent only (no innerHTML / insertAdjacentHTML / eval; ui.toast spanText, ui.confirm textContent); URLs built server-side
with encodeURIComponent; error bodies carry err.code only. Not confirmed without a diff: package.json / lockfile unchanged.
