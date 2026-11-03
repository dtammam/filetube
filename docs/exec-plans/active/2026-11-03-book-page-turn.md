---
plan: book-page-turn
harness: v2 · full
branch: feat/v1.402.0-book-page-turn
anchor: spec
status: Planned
next: the builder's Step 0, then Step 1 (the epub.js viewer-pool spike) before any reader code
design: Rulings approved by Dean 2026-11-03 (AskUserQuestion, after three prototype rounds): P1-P8 below; the builder's Design must stay inside them
gate: per .harness/scrutiny.toml (the version bump in package.json matches the deps rule: expect adversary + qa + security-brief)
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
