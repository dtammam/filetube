---
plan: v1377-pocket-card-polish
harness: v2 · lean
branch: feat/v1.377.0-pocket-card-polish
anchor: outcome
status: Shipped v1.377.0
next: shipped v1.377.0 - Dean's device checks (docs/DEVICE-CHECKS.md, v1.377.0)
design: Dean's device pass of v1.376.0 (2026-10-08, two screenshots) + rulings R1-R5 below + a read-only recon. Base main f14d3a61 (v1.376.0).
gate: APPROVED r2 @8fce9999 (adversary, qa, security-brief)
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

Gate: CHANGES r1 @0791fe92 - qa
- Instruments (Node 22.23.1): touched + neighbour tests (pocket-idle-art, pocket-word-census, handoff-card, handoff-card-styling,
  player-dock-presence, token-scale-lock, pocket-idle-seam, pocket-upright, settings-forms-sweep, pocket-quick-scroll) tests 104,
  pass 104, fail 0; `npm run lint:ui` "ui-lint: OK - the live debt equals docs/ui-exceptions.json"; overlay-containment "clean
  (0 violations)"; eslint on the 14 changed JS files 0 errors, 6 warnings (all in common.js, the same 6 at base 4cc39c6e);
  `geometry/run.js --only HDK` 4 checks - 4 ok; `--mutants --only HDK` 7 of 7 killed (sandbox).
- Mutants (my /tmp sandbox): 12 of 12 killed - idle-art guard off, whole-library pool, no invalidation, no fallback, always
  fallback, no promise cache (pocket-idle-art); device label via innerHTML (handoff-card-styling); age folded into device
  (handoff-card); "iPod" back on the button, in a music.js literal, in the setup note, in a lib/ response (census).
- Extra probe (sandbox HDK, paused presence): "Paused listening on" fits unclipped at 370 (132px), 375 (137), 390, 414; wraps
  to 2 lines at 320 (82x38); every check ok at 9 cases.
- WARNING (lying comment): public/css/style.css:53-55 (--player-dock-h: "the phone's handoff card ... stack above the dock by
  it") and public/js/player.js:10208-10209 ("the phone's handoff card stacks above it") still describe v1.376.0's bar; the card
  now sits beside the dock. Reword both.
- WARNING ("cannot drift" with two copies, LESSONS 12): style.css:2888-2889 says the card uses "the dock's own width token and
  right inset, so the two cannot drift" - only the width is shared; the dock's right inset and bottom are literal 8px
  (style.css:1378, 1384) while the card uses --space-4 (2897-2898). Reword (HDK binds bottom/gap) or share one value.
- SUGGESTION: test/geometry/handoff-dock.js:46 hdk-height-off comment "the bar stacks above a zero-height dock" is stale.
- SUGGESTION: pocket-quick-scroll test E title still claims "one per album"; the new expected set (every art track) no longer
  binds it.
- SUGGESTION: plan section 9 (Evidence, incl. the W3 census list) is still empty; fill before the release commit.
- INFO security: device label written by textContent in all three spans (no innerHTML in the controller, mutant-proven); the
  cover sample reads the same visibility-gated /api/music list (seed/limit normalised server-side, an integer seed client-side)
  - no new surface. The tokens.css force row is a design-token false positive.
- INFO: with no covers the idle pane is now EMPTY (not a placeholder) - better than the plan's "placeholder stays" wording.

Gate: APPROVED r1 @0791fe92 - security-brief
- Gap: no Bash, so `git diff 4cc39c6e 0791fe92` was NOT run; reviewed the named surfaces at HEAD (clean tree) plus a grep census of v1.377.0 markers (no lib/ or package file carries one; package.json still 1.376.0). The "package.json untouched" and "no new route" claims are inferred, not diffed.
- (1) verified: handoff lead/device/age are set via textContent only (common.js render); no innerHTML in the card IIFE.
- (2) verified: /api/music?sort=random reads visibleMusicList (trackVisibleTo + projectedLibraryTracks), the same gate as title-asc; seed via normalizeSeed (parseInt or undefined), limit via normalizeLimit (clamped to MAX_LIMIT); pool URLs pass sameOriginPath; the fallback is the same gated route.
- (3) verified: buildSkinCtx's idle change only empties artUrl (fewer requests); tokens.css adds one px var, no url()/import.
- Findings: none CRITICAL/HIGH/MEDIUM/LOW. INFO: the trigger was a false positive on design-token filenames.

Gate: CHANGES r1 @0791fe92 - adversary
- Instruments (Node 22.23.1, /tmp git-archive sandbox): `geometry/run.js --only HDK` 4 of 4 ok; `--mutants --only HDK` the builder's
  7 of 7 killed. Full `npm test` in the sandbox: tests 11748, pass 11729, fail 8, skipped 11 - the 8 fail on the sandbox having
  no .git (`git ls-files` fatal / EISDIR); those 7 files re-run in the clean checkout at 0791fe92: tests 69, pass 69, fail 0.
  eslint on the changed files 0 errors, 6 warnings (same 6 at base); ui-lint OK; overlay-containment clean.
- W1 measured (own probe, 44 cases, tree vs base 4cc39c6e): phone 430/414/390/375/370/369/360/320 x 4 eras (light) and 390/320
  x 4 eras (dark), paused + listen ("Paused listening on", the longest lead) with a long and a short label: no overlap, every
  part inside the card, lead unclipped (1 line from 370, 2 lines at 369 and below), no hit-test miss; the full card and the
  dock's box identical to base in all 44; landscape 844, narrow non-phone 390/700 and desktop 1440 identical to base (the
  narrow non-phone overlap is base behaviour, ROADMAP Planned).
- WARNING (presence-not-binding, HDK): 5 of my 8 extra HDK mutants SURVIVE, 3 of them visible defects: device ellipsis off
  (measured at 390 with a long label: the device text runs to x=228, past the card's right 214 and onto the dock at 222);
  lead nowrap at <=369 (measured at 320, paused: "Paused listening on" is 128px in an 82px column, under the X); lead wrap at
  >=370. Cause: every HDK case is state 'playing' ("Listening on"), short labels. Fix: a paused, long-label case at 320 and
  at 370-390, asserting the lead's and the device's text ranges (Range.getClientRects) stay inside their boxes / off the X.
- WARNING (W2 clear axis unbound): delete music.js `pocketIdle = false; // v1.364.0 (W2b): a song is up now` (the only clear
  on a song start; others are dockToOrigin only) -> the 106-file W2 subset stays green (fail 0). v1.377.0 made that line
  carry the art: a song started from the idle Pocket would keep artUrl '' (reasoned, not run). Bind: start a song from the
  idle iPod in pocket-idle-art and assert the Now Playing art is the song's.
- WARNING (W2 retry claim unbound): music.js says "a failure retries on the next ask"; mutant `pr.catch(function () {})`
  survives the W2 subset (fail 0). Measured with a scratch jsdom test (first sample 500, then ok): real code 2 sample
  requests and a cover on the pane; mutant 1 request and an EMPTY pane for the view's life. Add that test.
- WARNING (concur with qa): lying comments style.css:53-55 and player.js:10208-10209 ("the handoff card stacks above").
- SUGGESTION (census blind spots, none live today - grep 0 hits in each): public/filetube-worker.js (notification text),
  public/manifest.webmanifest and CSS `content:` are not scanned; 'i' + 'Pod' / 'iP' + 'od' / fromCharCode beat it (mutants
  measured: 0 fail each). Add the worker and the manifest to the scan; the concatenation forms can be disclosed.
- SUGGESTION: the age-shown and full-card-two-line mutants survive HDK (the full card is only compared to itself); my probe
  shows the full card unchanged vs base, so not a defect today. Concur with qa on test E's "one per album" title and the empty
  section 9.
- Verified by reading (not run): /api/music?sort=random filters through visibleMusicList before the sort for every viewer;
  seed omitted -> rng seed 0 (client always sends one); the late pool is dropped by the engine (destroyed / poolReq) and
  slidesWanted gates the panel, a held game and visibility; `/albumart/<id>?v=<ver>` passes menuCoverPool's sameOriginPath (run).

Gate: APPROVED r2 @8fce9999 - security-brief
- r1 gap closed by the builder's report (`git diff --stat 4cc39c6e 0791fe92 -- package.json package-lock.json lib/ server.js` empty); I still have no Bash and did NOT run the 0791fe92..8fce9999 diff myself - the delta file list is the coordinator's.
- Read at HEAD: player.js ~10207-10211 is a comment (no code on those lines); pocket-word-census.test.js requires only node:test/assert/fs/path, espree and jsdom (both already in package.json devDependencies), no child_process / network.
- No runtime surface in the stated delta (comments + tests). r1 findings (none blocking) unchanged; nothing new.

Gate: APPROVED r2 @8fce9999 - qa
- r1 WARNING 1 (style.css:53-55, player.js setDockShown): fixed as prescribed - both now say the card sits beside the dock at
  its height and only the remote pill stacks above.
- r1 WARNING 2 ("cannot drift"): fixed as prescribed - the comment names the shared width token, the two literal 8px insets
  mirrored by --space-4, and HDK as the binder (HDK checks bottom +-1px and gap >= 4px; true).
- r1 SUGGESTIONS: hdk-height-off comment true; test E's title now points to the unit menuCoverPool test (test/unit/
  pocket-quick-scroll.test.js:157 "one per album, art only, same-origin only" - exists); section 9 deferred to the release commit.
- Instruments @8fce9999: 8 test files (incl. unit + integration pocket-quick-scroll) tests 111, pass 111, fail 0; lint:ui OK;
  eslint on the 5 delta JS files clean; HDK "5 checks - 5 ok"; `--mutants --only HDK` "11 of 11 killed, 0 survived" (sandbox).
- My mutants on the new tests (sandbox): pocketIdle never cleared when a song starts -> the art-return test red; the failed
  sample promise kept cached -> the retry test red; the idle-art guard off -> test 1 red. 3 of 3 killed.
- Nothing new: no new lying comment in the delta; the census's disclosed blind spots (split literals, fromCharCode, CSS content)
  hold no "iPod" today. No security change in the delta (comments and tests only; no runtime code).

Gate: APPROVED r2 @8fce9999 - adversary
- Instruments (Node 22.23.1, /tmp git-archive sandbox of 8fce9999): HDK 5 checks - 5 ok; `--mutants --only HDK` the
  builder's 11 of 11 killed (control red []); touched tests (pocket-quick-scroll, pocket-idle-art, pocket-word-census,
  player-dock-presence, handoff-card*, token-scale-lock) tests 54, pass 54, fail 0; eslint on the delta files exit 0;
  ui-lint OK. Full suite not re-run (delta = tests + comments).
- r1 W1 HDK text safety: FIXED as prescribed. My r1 mutants re-run on 8fce9999: device ellipsis off, ellipsis-only off,
  lead nowrap at <=369, age shown -> KILLED; a new one (headline spanning under the X) -> KILLED (phone-320). Survivors:
  lead wrap at >=370 (EQUIVALENT: the lead fits one line there, nothing to observe - the builder's hdk-lead-wrap-wide narrows
  the headline and is killed), full-card two-line (disclosed, not done; my r1 probe showed the full card identical to base).
- r1 W2 clear axis: FIXED. Deleting `pocketIdle = false; // ... a song is up now` -> pocket-idle-art test 5 red; art
  always empty -> test 5 red; idle guard off -> test 1 red.
- r1 W2 retry: FIXED. `pr.catch(function () {})` -> test 6 red; sample always rejecting -> 6 of 6 red. INFO: dropping only
  the `menuCoverPromise === pr` guard survives - its cost is one duplicate request when a stale failure lands after an
  invalidate (reasoned), not a lost cover.
- r1 lying comments: FIXED (style.css --player-dock-h, player.js setDockShown, the side-card "cannot drift" claim now names
  the literal 8px insets and HDK's binding; hdk-height-off; test E title) - read against the rules, true.
- r1 census SUGGESTION: FIXED. Worker 'Open the iPod' -> red; manifest description and short_name with iPod -> red (my two
  first manifest mutants were equivalent: a duplicate JSON key the later one overrides). Split-string / fromCharCode / CSS
  content disclosed in the header.
- Nothing new introduced by the fix. Sandbox deleted; tree untouched apart from this block.

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

Instruments: headless Chromium (tools/capture Playwright) against a seeded fixture server, phones at DPR 3 with the iPhone
UA; numbers below are copied from the probe / runner output.

### W1 - the card beside the mini player (b698e07b..ba7520d8, fix 8fce9999)
- Before (HDK at f14d3a61 + probe): 390 full card 8,632 374x132; with the dock the v1.376.0 bar 8,578 374x44 above the dock
  222,630 160x134; 320 dock 152,354 160x134 (bar 8,302 304x44). Natural widths at the card's 14/19 px font: "Paused watching
  on" 132 px, "Listening on" 79.8, "Work MacBook Air" 122.2; Continue here (label only) 115.6x32; the X 32x32.
- Stop rule hit at 320 (136 px beside the dock: the lead alone 132 px, art + Continue here ~180 px): asked Dean with renders
  -> R6 "Side card, no art" (section 2). The full form needs a 186 px card, i.e. a 370 px viewport.
- After: 390 card 8,630 206x134 | dock 222,630 160x134; 375 8,630 191x134 | 207; 370 8,586 186x134 | 202; 369 185 wide (narrow
  form, Continue here 171 wide); 320 8,354 136x134 | 152,354; desktop 1440 the same box with and without the dock
  (16,752 320x132). Every part inside the card; at 375 the X's right edge 193 and Continue here's 179.6, card right 199.
- Tests: test/geometry/handoff-dock.js (HDK: 390 / 370 / 320 paused with a long name, 375 playing with a short one, desktop
  1440); test/unit/handoff-card.test.js (handoffHeadlineParts); handoff-card-styling (three textContent writes; AC4 runtime
  --scroll-lock-gap with its fallback); player-dock-presence (comment); token-scale-lock (+--player-dock-w, 199).
- Mutants: HDK 11 of 11 killed (hdk-side-off, hdk-stack-back, hdk-oneline, hdk-ellipsis-off, hdk-lead-nowrap-narrow,
  hdk-lead-wrap-wide, hdk-age-shown, hdk-narrow-off, hdk-desktop-follows, hdk-clear-off, hdk-height-off); unit 3 of 3 (AC4
  fallback, device via innerText, parts age dropped).

### W2 - Pocket always shows art (34645d95, fix 8fce9999)
- Measured (probe: /music, then /music?pocket=1 as the Music tab's handler does; the fixture's bottom bar hides the tab):
  fixture library (24 rows): the pool request starts 57 ms after the launch, resolves in 68 ms, a cover by +0.5 s on Click
  5G, Transparent and Classic; warm SPA the same; reduced motion one still cover -> (b) (c) (d) FALSIFIED. A 23,754-song
  model at 1.5 s per 5,000-row page: the placeholder through +5 s, the first cover between +8.9 and +10.7 s -> (a).
- Falsifying observation (e), not in the plan: Dean's screenshot is the server's art PLACEHOLDER SVG (navy, a disc,
  "Music"), not the drift's empty pane (my base render with nothing held: an empty grey pane). With a paused video held
  by the player, the base code shows `/albumart/<that id>` = the same picture, for the whole pool wait.
- Change: buildSkinCtx carries no art while pocketIdle; menuCoverPool = one `/api/music?sort=random&seed=<n>&limit=400`
  per view instance, the whole library only when the sample has no covers and the library is bigger; reset with the menu
  caches. After (same model, video held): one request, the cover at +0.4 s, the pane empty (never the disc) before it.
- Tests: test/unit/pocket-idle-art.test.js (6: the held item's art never shows and a late pool turns the pane to a cover;
  one sample, no whole-library read, a new sample after a library change; the fallback both ways; a song started from the
  idle iPod gets its own art; a failed sample is asked again). pocket-quick-scroll integration E: expected pool updated.
- Mutants: 6 of 6 (idle art back, whole library, no dedupe, no invalidate, no fallback, always fallback) + 2 of 2 at r1
  (no retry, idle never cleared).

### W3 - "Pocket" instead of "iPod" (b698e07b)
- Census (comment-stripped literals via a tokenizer + every HTML shell, at f14d3a61). User-visible, changed:
  - public/music.html:195 - the button label "iPod", title and aria-label "Open the iPod" -> "Pocket" / "Open Pocket".
  - public/setup.html:562 - "On an iPod skin, Music > Search..." -> "On a Pocket skin...".
  - public/setup.html:567 - "Keep the iPod upright" -> "Keep Pocket upright".
  - public/setup.html:569 - "leaves the iPod as it is... the iPod lays itself out sideways" -> "leaves Pocket... Pocket lays...".
  - public/js/setup.js:4775 - the wheel-tuning help "Fine is iPod-dense (96/rev)" -> "click-wheel-dense".
- Allowlisted (with reason): public/js/common.js:11317 `'iPod'` - the device-name detector (a real iPod touch names itself).
- Not user-visible (R3, left): skin ids `'ipod'`, `'ipod-*'` (music-skins.js registry ~130, setup.js colour lists),
  classes `mms-ipod`, `.ipod-brick`, `ip-*`, lib/ytdlp/cover.js `'ipod'` (the ffmpeg muxer name), podcasts.js /
  skin-surface.js `'ipod'` (a default skin id), every comment and test title; docs/releases.json history.
- Measured the Music toolbar (Click skin): the button 77 -> 94 px; at 390 the toolbar keeps 112 px, at 320 152 px, every
  button 32 px tall; desktop hides the button as before.
- Tests: test/unit/pocket-word-census.test.js (+ the worker and the manifest at r1). Mutants: 5 of 5 + 2 of 2 at r1.

### Gate and suites
- r1 @0791fe92: security-brief APPROVED; qa CHANGES (2 WARNING comments); adversary CHANGES (3 WARNING bindings + qa's).
  r2 @8fce9999: adversary, qa, security-brief APPROVED.
- Pre-gate Node 22.23.1 npm test: tests 11748, pass 11738, fail 0, skipped 10.
- Release tree (68235108, the code of 8fce9999): Node 22.23.1 npm test tests 11750, pass 11740, fail 0, skipped 10;
  Node 24.20.0 tests 11750, pass 11740, fail 0, skipped 10.
- Residuals: tracker #297.
