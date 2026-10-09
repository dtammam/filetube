---
plan: feed-polish
harness: v2 · full
branch: feat/v1.380.0-feed-polish
anchor: outcome
status: In progress (gate r1 fixed, r2 re-confirm)
next: r2 re-confirm with the same seats, then the release flow
design: Dean's first use of v1.379.0 Feed (2026-10-09) and his rulings R1-R6 below; kickoff defaults D1-D9. Base main 23136250 (v1.379.0).
builder: standard (Sonnet; Dean ruled 2026-10-09, supersedes smart. Changes when a feed card writes progress, and a Settings page split; no schema change)
gate: not yet run (FULL: adversary, qa; lib/ change = core-logic; the progress rule is a data-carrier surface - brief it as one)
---

# v1.380.0: Feed polish - a new book looks new, a new video says so, Settings keeps its back arrow, Bottom bar is findable

Norms: no em dashes in docs or user prose; stage files by name; `git commit -F <file>`; never pipe a commit or push; export the
fnm Node 22.23.1 PATH before any node/npm/git command; no toggle workarounds; never self-merge.

Read first: AGENTS.md; docs/LESSONS.md sections 0, 1, 2, 5, 6 (blast radius: the Settings master-detail is shared by every
page), 12 (inert sibling list: a new Settings page and its censuses); the shipped plan
docs/exec-plans/completed/2026-10-09-feed-mode.md (D1-D14, its ledger and gate rounds: the forward-only / stale-refusing
progress rule D5 is NOT to be weakened).

## Step 0. Before anything (builder)

- Work ONLY in the worktree the launcher made: `.claude/worktrees/feat-v1.380.0-feed-polish` on branch
  `feat/v1.380.0-feed-polish` (this plan is committed there; `node_modules` is a symlink, never stage it). Never touch the main
  checkout (the Root works there).
- Before every node / npm / git command: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
  Dual-Node: 22.23.1 then 24.20.0, sequential. Targeted tests while building; the full dual suite once before the gate and once
  at release.
- Git: stage by name, `git commit -F <file>`, verify with `git log -1` / `git ls-remote`; never `--no-verify`, never force-push;
  the protected-main PR flow (docs/RELEASING.md). If another release merges first, merge origin/main in, take the next free minor,
  re-run the suites.
- Stop and ask Dean (AskUserQuestion) when: a ruling contradicts the code or a measurement; the gate reaches round 3; `gh pr merge`
  is refused.

## 1. Outcome (Dean, 2026-10-09, after his first Feed session)

- "I can't find anywhere in settings to change the order of the bottom bar." (It is under Personalize > Mobile player.)
- "If I scroll down [in a Settings page], I lose the ability to easily go back... freeze the top header and arrow."
- Swiping the feed "worked, just wasn't intuitive at first."
- "It's a little awkward if it's a book that I haven't even started reading... the middle of things that you haven't started."
  (Measured: an unstarted book's card starts at spine 0, block 0 = the cover / copyright / contents; reading it long enough then
  writes a bookmark, so the book silently becomes "currently reading".)
- "What about podcasts and videos? Music is different."

## 2. Rulings (Dean, 2026-10-09)

| # | Ruling |
|---|---|
| R1 | Settings: the detail header (back arrow + title) stays pinned at the top while the page scrolls, on the phone. |
| R2 | Bottom bar gets its own findable page in Settings (under Personalize, named "Bottom bar"). |
| R3 | Feed swiping stays as it is; add a hint on the first card. |
| R4 | An unstarted book is a **"Start something new"** card: cover, title, author, the book's own description, an optional taste of the opening from the FIRST REAL CHAPTER; reading it never starts the book - only a "Start reading" tap does; at most one per session. |
| R5 | Podcasts and videos: "Continue" vs "New from <channel>" / "New episode of <show>" labels; a NEW item only counts as started after about a minute; skip a video's opening intro chapter when the chapters say so; roughly one new item per two continuations. |
| R6 | Music stays as is (songs are the breather card; no "place" to keep). |

## 3. Kickoff defaults (D1-D9; state each in the ledger as built; Dean overrules at the device pass)

- **D1 Pinned Settings header (R1).** `.md-detail-head` (public/css/style.css ~6295, the phone nav-bar header) becomes
  `position: sticky; top: <the mobile header height>` with the page's own background and the hairline, inside the detail pane's
  scroll container (measure which element scrolls on the phone; sticky fails silently under an `overflow` ancestor - prove it with
  a headless scroll at 390 x 844 and 320 x 568: the back button's rect stays in view after scrolling to the bottom of the longest
  page). Desktop's left-aligned pane heading unchanged unless it already scrolls away there too (measure, say).
- **D2 Bottom bar page (R2).** Move the "Bottom bar (mobile)" group (public/setup.html ~581-585, `#bottombar-editor`,
  setup.js `renderBottomBarEditor` ~2064) out of the Mobile player `<details>` into its own `<details class="setup-box setup-sec
  sub-collapsible" data-md-group="Personalize" ...>` titled "Bottom bar", placed right after Mobile player, with a fitting
  existing icon. NO alias from the old place (Dean ruled the Settings alias layer tech debt, ROADMAP Planned): a bookmark to
  Mobile player still opens Mobile player. Update the Settings censuses (setup-master-detail tests' page table, any page list) and
  every doc / live text that says the bottom bar lives under Mobile player.
- **D3 Swipe hint (R3).** The first card of a session shows a small "Swipe up" cue (a chevron + text at the card's bottom) that
  fades after the first swipe or 4 s; shown on the first 3 sessions only (a per-device count in localStorage, try/caught), never
  again after that. Respects reduced motion (no bounce, just the text).
- **D4 Book classification (R4).** In lib/feed/api.js (books pool ~186-211): a book with no stored progress is a NEW book; the
  existing "currently reading" pool is unchanged. New-book sources: liked unstarted books (as today), then (only if none) the
  newest added unstarted EPUBs. At most ONE new-book card per session (served.js / the session's served set), and never two book
  cards in a row as today.
- **D5 "Start something new" card (R4).** Shows the cover (`/bookcover/:id`), title, author and the description: parse
  `dc:description` from the OPF on demand (lib/books/opf.js today reads title / creator / spine / cover only) as PLAIN TEXT
  (strip markup, decode entities, cap ~600 chars, render as text). Below it, "Read the opening" expands a taste: the excerpt
  route starting at the first real chapter - skip spine items that are front matter (EPUB 3 `nav` / landmarks `bodymatter` when
  present; else skip items whose text is short (< ~150 words) and matches cover / title / copyright / dedication / contents /
  acknowledg* patterns; measure on the fixture EPUBs and 3 real-shaped ones and say which rule fired). Buttons: "Start reading"
  (writes the start position = the first real chapter, block 0, through the EXISTING forward-only progress path, and opens the
  reader there) and swipe on (nothing written). Reading the taste NEVER writes progress.
- **D6 New vs continue for media (R5).** Server marks each video / podcast / Watch later card `fresh: true` when the viewer has no
  stored position (or below the existing "watching" floor). Labels: "Continue" for not-fresh; "New from <channel>" (video,
  channel / folder name) or "New episode of <show>" (podcast) for fresh. Watch later keeps its label plus the fresh/continue word.
- **D7 The one-minute rule (R5).** For a FRESH card, no progress write of any kind (position, watched latch, Watch later removal)
  until 60 s of actual playback in that card (playing time, not wall time; a seek does not add). After 60 s it behaves exactly as
  today (D5 forward-only, stale-refusing). Not-fresh cards unchanged. Measure the current write path first (the shared player's
  pings / the feed's own writes) and put the guard where EVERY write passes; falsifier: a fresh video swiped after 10 s leaves
  user_progress, user_watched and user_watch_later byte-identical; after 70 s it has a position.
- **D8 Intro skip (R5).** A fresh VIDEO whose first chapter title matches intro / introduction / opening / sponsor / ad / "0:00"
  style intros (case-insensitive, whole word) and is under 3 minutes starts at chapter 2. Never for not-fresh (they resume at their
  place). Podcasts start at 0 (no chapters). The card says "Skipped the intro" for 3 s with a tap to go back to 0.
- **D9 Mix (R5).** In the mix (lib/feed/mix.js), fresh media cards are capped at about one per two not-fresh media cards
  (video + podcast + Watch later together), when not-fresh ones exist; with none, fresh fill in as today. The kind weights (book 30
  / video 30 / podcast 20 / Watch later 10 / song 10) are unchanged.

## 4. Waves

- **W1 Settings:** D1 pinned header (measured), D2 Bottom bar page + censuses + docs.
- **W2 Feed server:** D4 classification, D5 description parse + first-real-chapter start + the Start-reading write, D6 fresh flag,
  D9 mix cap.
- **W3 Feed client:** the Start something new card (D5), labels (D6), the one-minute guard (D7), intro skip (D8), swipe hint (D3).
- **W4 Close-out:** ledger, device checks in docs/DEVICE-CHECKS.md (pinned header on the longest Settings page; Bottom bar page;
  hint on first sessions; a new book card: description, taste, nothing written until Start reading; a new video swiped at 10 s is
  not in Continue watching; intro skipped; labels), ROADMAP, a LESSONS line if a new class appears.

## 5. Gate
FULL: adversary + qa (security as a section: the description parse renders hostile OPF markup as text; the Start-reading write
goes through the same visibility + forward-only path). Brief the Adversary to DESTROY his place: a fresh item that still gets a
write before 60 s (via the shared player's pings, a dock, a navigation away mid-card, the watched latch, the Watch later
removal), a "Start reading" that moves an existing bookmark backwards or over another device's newer place, a front-matter rule
that skips a real first chapter, and the sticky header under every Settings page at 320 px.

Gate: CHANGES r1 @fdccf1ece598b23707255ae1d5b3dbe916f4d7b5 — qa
Gate: CHANGES r1 @fdccf1ece598b23707255ae1d5b3dbe916f4d7b5 — adversary

## 6. Release
docs/RELEASING.md and AGENTS.md exactly: version bump, CHANGELOG / releases.json in Dean's plain words, the plan closed out in the
same PR (`node scripts/plan-complete.js docs/exec-plans/active/2026-10-09-feed-polish.md "Shipped vX.Y.Z" --apply`), the
protected-main PR flow, shipped = the tag's "Publish Docker Image" run green, branch deleted remote and local.

## 7. Evidence (builder fills: numbers copied from the runs named, verbatim verdict lines)

- D1 sticky measurement (390 / 320): headless Chromium, mobile emulation, all 22 Settings pages, scrolled to the bottom, back button rect. The document scrolls (no overflow ancestor), the header is position:sticky and pins at top 56 (flush under the 56px app header); back button top 62 / bottom 94 on EVERY scrolled page, 390x844 (longest: Mobile player, docH 8597, scrollY 7753) and 320x568 (longest: Mobile player, docH 10127, scrollY 9559); all `vis:true`. Pages that do not scroll sit at 78/110 (unscrolled position). Desktop unchanged (position:relative, measured by test only). Probe: scratchpad sticky-probe.js.
- D5 front-matter rule per fixture (test/unit/books-first-chapter.test.js): Standard-Ebooks shape (nav landmarks bodymatter) -> spine 4, rule landmarks; landmarks naming a non-spine file -> heuristic; Gutenberg shape (no nav; copyright heading page + contents) -> spine 2, heuristic; Calibre shape (cover, title page, copyright, dedication, toc) -> spine 5, heuristic; real chapter 1 / short prologue / opening that merely mentions cover or contents (and, after gate r1, four short openings with acknowledged / cover / first edition / dedicated) -> spine 0, spine-0; all front matter -> spine 0, none; >12 leading picture pages -> none. The six seeded app EPUBs (Harbor Library, Night Reading): spine 0, spine-0, no description. Mutants of the 150-word bound, the landmarks branch, the text rule and the skip cap all fail the tests.
- D7 falsifier (10 s vs 70 s): integration (test/integration/feed-api.test.js): a fresh video, seven early shapes of write (10 s, a 95% ping that would latch watched and leave Watch later, 59.9 s, no playedSec, junk) -> 409 too-early, user_progress / user_watched / user_watch_later byte-identical; playedSec 70 -> 200 with a position, then the old rule (backward 409, watched latch and Watch later leave ride the write). Real player in headless Chromium (a WAV episode): 0 progress POSTs before 60 s of playing, first write at 73.2 s played (200); a seek to 150 s then 31 s of playing: 0 POSTs, no row; gate r1 C1 repro (leave the Feed at ~20 s, keep listening in the dock): before the fix 0 POSTs over 137 s, after it writes at played 60.8 (200) every ping.
- Suites (Node 22.23.1 / 24.20.0) at the reviewed sha: r1 fdccf1ec: 11958 tests, 11945 pass, 0 fail, 13 skipped on both. r2 sha: see below.
- Gate rounds: r1 CHANGES by adversary (C1 tracker died with the view; C2 quadratic OPF / nav regexes; W1 several new-book cards a batch; W2 front-matter text rule skipped short real chapters; W3 sub-minute clips) and qa (W1 the same multi-card, W2 = C1); all fixed, r2 follows.
- Device checks owed: docs/DEVICE-CHECKS.md "Feed polish (v1.380.0)" (8 lines: pinned header, Bottom bar page, swipe cue, new-book card, Start reading, labels, early swipe of a new video, intro skip).

## 8. Out of scope
SponsorBlock or any outside data; PDF books in the feed; a Settings search; reordering Settings pages; the Settings alias cleanup
(its own ROADMAP item); music cards.
