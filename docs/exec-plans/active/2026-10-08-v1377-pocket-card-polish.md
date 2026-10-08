---
plan: v1377-pocket-card-polish
harness: v2 · lean
branch: feat/v1.377.0-pocket-card-polish
anchor: outcome
status: Approved @f14d3a61
next: build W1-W3 (W1 and W2 can be parallel worktrees; W3 is a small sweep), then the gate (adversary + qa)
design: Dean's device pass of v1.376.0 (2026-10-08, two screenshots) + rulings R1-R5 below + a read-only recon. Base main f14d3a61 (v1.376.0).
gate: pending
---

# v1.377.0: the Listen Control card beside the mini player, Pocket always shows art, and "Pocket" instead of "iPod"

Read first: AGENTS.md; docs/LESSONS.md sections 0, 1, 2, 3, 4, 6, 12 (the classes; the Rules file for the sections you
touch); this plan. Every change is MEASURED on the real page first (LESSONS 1: name the falsifying observation), phone 390
and 320 at DPR 3 with an iPhone UA, plus desktop 1440 where a rule could reach it. Instruments: the v1.376.0 W4 probe
pattern (a second device's POST /api/progress with deviceLabel drives the real /api/handoff card; a mini player from
playing a video then SPA-navigating to /) and test/geometry/handoff-dock.js (HDK).

## 0. Step 0 (the builder reads this first)

- Read: AGENTS.md; docs/LESSONS.md sections 0, 1, 2, 3, 4, 6, 12; this plan top to bottom; docs/RELEASING.md "Cutting a
  release"; the memory index's box quirks.
- Environment: export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH" before EVERY node /
  npm / git command. `gh` is ~/.local/bin/gh. Chromium for probes: tools/capture's Playwright
  (tools/capture/node_modules/playwright) or raw CDP from ~/.cache/ms-playwright. A worktree has no node_modules: symlink
  the main checkout's for runs and NEVER stage it (`.gitignore`'s `node_modules/` does not match a symlink). No jq.
- Git: work on `feat/v1.377.0-pocket-card-polish` (this plan is committed there). Parallel waves in worktrees
  (.claude/worktrees/) on sub-branches, merged back here. Stage EXPLICIT paths (never add -A / .), commit with
  `git commit -F <file>`, never --no-verify, never force-push, never pipe a commit or push; verify with git log /
  git ls-remote. NEVER `git stash` with uncommitted release edits in the tree. main is PROTECTED (section 7).
- Stop rules (AskUserQuestion): a gate reaches round 3; a measurement contradicts this plan's diagnosis (W2 especially);
  a product fork the rulings do not cover (e.g. the card cannot fit beside the dock at 320 even in its smallest form).
- Reporting: no step-by-step ceremony; report at decision points and at the end with two 10-cell progress bars
  (`**This release (v1.377.0):** \`████░░░░░░\` 40%. ...` and `**Overall plan:** ...`) plus the measured numbers.

## 1. Outcomes (Dean's words, then the observable)

- **W1. The Listen Control card on the phone sits BESIDE the mini player, not over the feed (Dean: "I cannot stand the
  style of this. it seems odd... we're taking more real estate and showing less info... make it the size of the
  miniplayer or directly to the left").** v1.376.0's compact bar (a full-width 44 px bar above the dock) covers feed
  content and truncates to "Paused watching on ...". Wanted: the card sits directly LEFT of the mini player, the same
  height, filling the space between the left gutter and the dock, showing MORE: the art, "Paused watching on" / "Work
  MacBook Air" on two lines, Continue here and the X.
- **W2. Pocket always shows art (Dean: "when one opens the iPod view, it always shows some art. right now if you double
  tap music to launch it without listening you see the placeholder").** Screenshot: the Click skin's main menu, right
  pane = the disc placeholder with "Music". Wanted: the library cover drift (the existing Addendum E slideshow) shows on
  the menu screens until something plays; never the placeholder while the library has covers.
- **W3. No "iPod" in the app's words (Dean: "replace the button text for iPOd with Pocket. I don't want to use the term
  iPod in the app").** The Music page button reads "Pocket"; every other user-visible "iPod" says Pocket too.

## 2. Rulings (Dean, 2026-10-08)

- R1 (AskUserQuestion) W1: the card goes LEFT of the mini player, the SAME HEIGHT as it, filling the space to its left
  (about 206 px wide at 390). No extra vertical room. Contents: art, two lines of text, Continue here, the X.
- R2 (AskUserQuestion) W2: the LIBRARY COVER DRIFT on the menu screens until something plays; then that song's art as today.
- R3 W3: the word "iPod" leaves every user-visible string (labels, title / aria text, Settings rows and notes, toasts,
  dialog text). Skin names (Classic 4G, Mini 1G, Nano 2G ...) already carry no "iPod" and stay. Code identifiers, CSS
  classes, ids, storage keys and comments are NOT renamed (no behaviour change, no migration). Past release notes in
  docs/releases.json are history and stay as written.
- R4 (standing) Desktop unchanged; existing design kit only (ui.btn / the handoff card's own parts); no new mechanisms.
- R6 (AskUserQuestion, 2026-10-08, the W1 stop rule at 320) "Side card, no art": a phone under 370 wide (a 320 iPhone
  SE has 136 px beside the dock; "Paused watching on" alone is 132 px, Continue here 116 px) keeps the card beside the
  dock at its height, drops the art, lets the lead wrap and spans Continue here across the card's second row.
- R5 (standing) Dean's device pass is the arbiter; one release for the wave (v1.377.0); the gate (adversary + qa, add
  security-brief only if the diff reaches auth / a route / the network).

## 3. What exists (recon 2026-10-08, read-only; file:line at base f14d3a61)

### Listen Control card vs the mini player (v1.376.0 W4)
- The card: `handoffCard` IIFE public/js/common.js:17634 (#handoff-card on body); headline `formatHandoffHeadline`
  common.js:11482 ("Listening on <device>" / "Paused watching on <device>"); "Continue here" button; the X dismiss.
- The dock signal: public/js/player.js `setDockShown(dockEl, shown)` :10213 is the ONLY writer of the dock's [hidden]; it
  toggles `html.has-player-dock` and writes `--player-dock-h` (ceil of the dock's height, a ResizeObserver keeps it
  current); `--player-dock-h: 0px` on :root (public/css/style.css:56).
- The v1.376.0 compact rule (style.css :2893-2915, inside the `max-width: 768px` block): `html.is-phone.has-player-dock
  #handoff-card` -> a one-line bar, `bottom: calc(var(--mobile-bottom-nav-h) + var(--space-4) + var(--player-dock-h) +
  var(--space-4))`; head / body / meta `display: contents`; title, time, state glyph and the button glyph hidden. The
  narrow `html.has-player-dock #remote-pill` lift is beside it.
- Phone dock (style.css :1376, inside `@media (max-width: 768px)`): width 160 px, right calc(8px + var(--scroll-lock-gap, 0px)), bottom calc(var(--mobile-bottom-nav-h) + 8px). v1.376.0
  measured at 390: dock 222,630 160x134; at 320: dock 152,354 160x134. So the space left of the dock is about
  222 - 8 (left gutter) - 8 (gap) = 206 px at 390 and 152 - 16 = 136 px at 320.
- Tests: test/unit/player-dock-presence.test.js (8), test/geometry/handoff-dock.js (HDK: phone 390, phone 320, desktop
  1440; mutants hdk-stack-off / hdk-compact-off / hdk-desktop-follows / hdk-clear-off / hdk-height-off),
  handoff-card-styling, listen-handoff-position, remote-resume.

### Pocket's menu art (Addendum E cover drift)
- public/js/skin-surface.js ~:1265-1410: the drift (SLIDE_MS 9000, FADE_MS 1300); `fetchPool` calls `cfg.coverPool()`;
  `slidesWanted()` / `syncSlides()`: a NON-item level (music-skins.js NON_ITEM_LEVELS incl. 'main', 'music', 'extras',
  'settings'), the menu screen, the panel up, the document visible; `if (poolFresh() && slide.pool.length)
  startSlides(box)`, else `scheduleArt(0)` = "today's pane while the covers load (or when there are none)" = THE
  PLACEHOLDER in Dean's screenshot. Reduced motion = one still cover.
- The pool: music.js `menuCoverPool` :4843 -> `menuAllSongs()` (:4803, `fetchAllRows('/api/music?sort=title-asc')` -
  the WHOLE library, paged) -> music-skins.js `menuCoverPool(tracks, artFor)` (one cover per album, only `t.hasArt`,
  same-origin paths, a random sample of COVER_POOL_MAX 60). Wired at music.js:1816 (`coverPool: menuCoverPool`).
- So the placeholder means ONE of: (a) the pool is still loading (a whole-library fetch on a large library on a cold
  launch), (b) the pool came back EMPTY (no `hasArt` rows, or every URL failed `sameOriginPath` - v1.376.0 added `?v=`
  to art URLs), (c) the launch path Dean uses (double-tap Music in the bottom nav, nothing playing) never reaches
  `syncSlides` (no render / visibility event after the pool resolves), (d) a skin / style other than 'click' that the
  drift does not serve. W2 MEASURES which before any change.
- BUILD FINDING (2026-10-08, extends the diagnosis): the picture in Dean's screenshot is not the drift's empty pane but
  the server's art PLACEHOLDER SVG (lib/music/routes.js musicArtPlaceholderSvg: navy, a disc, album text defaulting to
  "Music"). (e): the idle iPod's ctx art was `/albumart/<the id the player still held>` (a paused podcast / video, not a
  music track), and it filled the pane for the whole pool wait (a). (b), (c), (d) falsified. Fixed at (a) and (e).

### "iPod" in user-visible text (recon grep; the builder re-runs it as a census)
- public/music.html:195: the Music page button `#music-pocket-btn` label "iPod", `title` and `aria-label` "Open the iPod".
- public/setup.html:562 ("On an iPod skin, Music > Search uses your phone's keyboard..."), :567 ("Keep the iPod upright"),
  :569 (the note: "...leaves the iPod as it is... the iPod lays itself out sideways...").
- NOT user-visible (leave): common.js:11317 (`/iPod/i.test(ua)` - a device name detector), comments, ids / classes
  (`ipod-*` skin ids, `.ip-*`), storage keys, test titles that quote code.
- Census still to do: every JS-built string (textContent, label, title, aria-label, toast, ui.confirm copy) in
  public/js/*.js and lib/ (server-composed text, e.g. setup / settings / remote / about) - grep `iPod` outside comments.

## 4. Work items

- **W1 The card beside the mini player (R1).** Measure first: at 390 and 320 (DPR 3, iPhone UA), with the real card and a
  local mini player, the dock rect and the free span to its left; the card's content at those widths (the headline's
  natural width, art size, Continue here's width). Then REPLACE v1.376.0's compact bar (style.css :2893-2915) with the
  side placement: `html.is-phone.has-player-dock #handoff-card` -> left = the left gutter, right = the dock's left edge +
  a gap (the dock's width is 160 px + its 8 px right inset: define the dock width as a token if it is not one, so the two
  rules cannot drift), bottom = the dock's bottom, height = `var(--player-dock-h)`; a two-line headline ("Paused watching
  on" / the device name, ellipsis only on the device name), art at a fixed small square, Continue here and the X in the
  remaining row. Same element, same one driver (setDockShown); every dock exit clears it (already bound). At 320 the span
  is about 136 px: measure what fits; if the art + two lines + Continue here cannot fit legibly there, STOP and ask Dean
  (drop the art at 320? stack above the dock at 320 only?). Remote pill: keep its lift working. Desktop unchanged (HDK's
  desktop check). Update the HDK geometry check and its mutants to the side placement: no overlap with the dock, the
  feed, the bottom nav; the card's bottom == the dock's bottom +- 1 px; its height == the dock's +- 1 px; the gap >= 4 px;
  every control hit-testable at its centre; the clear axis from a populated state. Fix any comment the change makes
  untrue (the card section header comment at style.css ~:2766 and the compact-rule comment at :2893 were rewritten in v1.376.0).
- **W2 Pocket always shows art (R2).** Measure first, on the real page with a SEEDED library large enough to matter
  (several hundred albums with art) AND a small one: open Pocket the way Dean does (double-tap Music in the bottom nav,
  nothing playing, cold load and warm SPA), on the Click skin and one Transparent skin; record when the pool request
  starts and resolves, the pool length, whether `syncSlides` runs after it resolves, and what the pane shows at 0.5 / 2 /
  5 s. The falsifying observation decides between (a)-(d) in section 3. Then fix at the cause - for example a cheaper
  pool source (a covers-only listing instead of the whole song list, if the cost is the wait), a resync when the pool
  lands, or an earlier fetch on launch - with the existing drift as the ONLY art mechanism (no second slideshow). The
  placeholder may show only when the library has no covers at all. Bind: a jsdom / real-browser test where the pool
  resolves AFTER the first render and the pane switches from placeholder to a cover; one where the library has no
  covers (placeholder stays); reduced motion (one still cover). Mind LESSONS 4 (a late result must check the surface is
  still shown) and the v1.376.0 art version (`?v=`) passing `sameOriginPath`.
- **W3 "Pocket" instead of "iPod" (R3).** Census first: grep every user-visible "iPod" (HTML text and attributes, JS
  string literals that reach textContent / label / title / aria-label / toasts / confirms, server-composed text) and list
  each with its file:line in section 9 before editing. Replace with Pocket in sentence-natural wording ("Open Pocket",
  "Keep Pocket upright", "On a Pocket skin, Music > Search..."). Keep the button's width stable (LESSONS 6:
  `stableToggleLabelHtml` is for two-state labels; this is a single label, but measure the Music header row before and
  after at 390 and 1440 - rows wrap, buttons never shrink). Add a census test that fails on a user-visible "iPod" in
  public/*.html and the JS label / title / aria-label / textContent spellings (comments stripped; the UA detector and
  identifiers allowlisted with a reason), and mutate it (put "iPod" back on the button: red). Settings search / the
  setup page's search index, if any, must find the renamed rows (LESSONS 12 inert sibling list).

## 5. Acceptance (Dean's device checks; each also bound by tests)

1. iPhone, music playing on the Mac, a video in the mini player on Home: the "Paused watching on / Work MacBook Air"
   card sits directly LEFT of the mini player, the same height, nothing of the feed hidden above them; Continue here and
   the X work; closing the mini player brings back the normal card.
2. iPhone, nothing playing: double-tap Music to open Pocket: the main menu's right side shows album covers drifting
   (within a couple of seconds), never the disc placeholder.
3. The Music page button reads "Pocket"; Settings > Mobile player says "Keep Pocket upright"; no "iPod" anywhere you can
   read in the app.

## 6. Gate

adversary + qa (UI / layout on the phone's shared chrome, a client art lifecycle, a copy sweep). Brief the adversary on
W1's blast radius (the card's rules at every width and both eras that change radius; narrow non-phone windows must not
regress), W2's async reveal / clear axes (the pool landing after the view left, the panel down, a game holding the wheel)
and W3's census completeness (a missed spelling). security-brief only if the diff touches a route, auth or the network. (Build: `.harness/scrutiny.toml`'s forced
auth-and-secrets rule matches `**/*token*` - public/css/tokens.css and test/unit/token-scale-lock.test.js, design tokens -
so security-brief joins the gate; a force row cannot be dropped.)

(pending)

## 7. Release (v1.377.0)

Exactly as v1.376.0 did (docs/RELEASING.md + AGENTS.md): after the gate APPROVES (all seats at the same sha), full
`npm test` on Node 22.23.1 then 24.20.0 (sequential; report both summaries verbatim). Release commit on this branch:
`npm version 1.377.0 --no-git-tag-version`; ROADMAP.md "Shipped" entry; docs/releases.json ledger entry in PURE USER
LANGUAGE (it must not say "iPod"); DEVICE-CHECKS lines (section 5); a LESSONS entry if the wave taught one; a tracker row
for disclosed residuals; `node scripts/plan-complete.js <this plan> "Shipped v1.377.0" --apply`, fix the path
references it lists, `git add` the moved plan. Then on main `git merge --no-ff` this branch locally, `git tag v1.377.0`
on that merge, push THIS BRANCH + the tag in ONE push (`GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o
ServerAliveCountMax=60"`), `gh pr create`, wait for ci (22), ci (24), audit, secret-scan green (visual is a report, never
a gate), `gh pr merge --merge` (Dean authorizes merging on green; if the tool refuses, ask him), then on main
`git fetch && git reset --hard origin/main` after checking the tag's tree equals origin/main, confirm the tag's
"Publish Docker Image" run is green, delete the branches (`git branch -d`; remote via
`gh api -X DELETE repos/dtammam/filetube/git/refs/heads/<b>` if GitHub has not, then `git ls-remote`).

## 8. Out of scope

- Renaming code identifiers, CSS classes, skin ids or storage keys (R3); rewriting past release notes.
- The narrow NON-phone Listen Control overlap (ROADMAP Planned, v1.376.0) unless W1's rule naturally covers it - do not
  widen W1 to it without asking.
- The v1.376.0 W5 line under the phone player (waits on Dean's Ambient-off check), the per-user Web Push filter, album
  file naming - all ROADMAP Planned. Anything new goes to ROADMAP.md Planned.

## 9. Evidence (the builder fills this)

- Per wave: the measurement before (instrument + numbers), the falsifying observation (W2), the change, the tests that
  bind it (names), the mutants run and their results, the measurement after.
- W3: the census list (every user-visible "iPod" with file:line, and each allowlisted non-visible one with its reason).
- Gate rounds and verdicts; both suite summaries; residuals disclosed.
