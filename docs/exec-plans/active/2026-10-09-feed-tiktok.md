---
plan: feed-tiktok
harness: v2 · full
branch: feat/v1.381.0-feed-tiktok
anchor: outcome
status: Planned (kickoff 2026-10-09, Opus Root); builder not started
next: builder Step 0, then W1
design: Dean's device feedback on v1.380.0 Feed (2026-10-09, eight points + swipe left/right); kickoff defaults D1-D11. Base main 42ec865c (v1.380.0).
builder: smart (the shared player's gestures in a new full-bleed host, a layout rework of every card, and a deliberate progress RESET: a data-loss surface)
gate: not yet run (FULL: adversary, qa, security-brief - "Start over" deletes a place; brief the Adversary to destroy data)
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

- Layout before / after (rects, 390 / 320, each card kind):
- D6 fitted pages (fixture books, 3 positions):
- D7 edge rule on WebKit:
- D10 stale-Continue cause and counts:
- Start over + Undo falsifiers (each kind):
- Suites (Node 22.23.1 / 24.20.0) at the reviewed sha:
- Gate rounds:
- Device checks owed:

## 8. Out of scope
Start over outside the Feed (watch page, reader, podcasts page: ROADMAP Planned if Dean wants it everywhere); a scrubbable
progress line; horizontal swipes on media cards; comments / likes overlays; new card kinds; the phase 2-3 Reading work.
