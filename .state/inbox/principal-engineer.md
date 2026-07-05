# Principal Engineer — Design for v1.10.0 (feat/audio-art-and-related)

You are the Principal Engineer. Produce the technical design for TWO independent,
additive media-experience features that ship as SEPARATE commits. Write your design
into the exec plan's `## Design` section and set `artifacts.design` in state.

## First, read (self-contained — you share no context with the EM)

- `docs/exec-plans/active/2026-07-05-audio-art-and-related.md` — the requirements + tagged AC you are designing to. Read it fully (Goal, Scope, Out-of-scope, Constraints, both Feature sections, Decision log, Open questions).
- `.state/feature-state.json` — the `grounding` block (exact file:line anchors) and constraints.
- `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md`, `docs/RELIABILITY.md`.
- `public/watch.html` (`#media-player` :119 w/ `playsinline`; `#audio-visualizer` :139-145; `#player-wrapper` :98).
- `public/js/watch.js` — `setupPlayer()` (:285-344; audio branch :288-295), `loadRelatedFiles()` (:710-753), `setupMediaSession()` (:249-265), the v1.2.2 background-audio rationale (:242-248).
- `public/js/common.js` — the UMD dual-export tail (`:483`) and `resolveChannelName` (`:251-255`, resolves `mapped name -> item.artist -> item.folderName -> 'Library'`). A few `test/unit/*.test.js` (e.g. `clamp-position-state.test.js`, `star-rating.test.js`) to model the test style.
- `public/css/style.css` — the `#audio-visualizer` / `.audio-player-visual` styling and the `.player-container` rules, so your CSS-background approach layers correctly.
- `server.js` `GET /thumbnail/:id` (:1605) and `GET /api/videos` (:1432) for the data shape.

## The coordinator has resolved the two open questions to DEFAULTS — design to these

Neither open question is a product fork. Proceed with:
- **F1:** design **approach (b)** — CSS background-image. (Dean's `#audio-visualizer` fallback is pre-approved; his on-device pass is the arbiter.)
- **F2:** signals = **title/filename token overlap (primary) + shared-folder boost (secondary)**, fallback to most-recent when **fewer than N=6** items score as similar. Dean may redirect F2 weighting later but we are NOT blocking on it.

## Feature 1 — Audio thumbnail-as-background art (feasibility-gated)

**Key fact:** `poster` is ALREADY shipped (`watch.js:288-295`) and IS exactly what
produces the iOS black-on-playback (poster vanishes once playback starts). So the
poster approach ALONE is **insufficient** — design approach **(b)**:

- A **CSS `background-image`** (the item's thumbnail) on `#player-wrapper` (or a
  dedicated art layer inside it) sitting BEHIND the audio-playing `<video>`,
  framed `background-size: cover` (+ center) so it reads like a video frame, not
  letterboxed art. Ensure the `<video>` area is transparent/lets the background
  show for audio (the `<video>` has no video track, so it should not paint opaque
  black over the art — verify how to achieve that: e.g. the background lives on
  the wrapper and the audio `<video>` is sized/positioned so its black fill
  doesn't cover the art, OR the art layer sits above a `background:transparent`
  region — you decide the exact layering, but it must be robust).
- Because real iOS can't be tested here, design so that:
  1. the CSS-background approach is **SAFE and correct on desktop/PWA** and
     degrades cleanly (no broken layout, no black-on-black, no video regression);
  2. the iOS uncertainty and the accepted fallback are **documented explicitly** —
     if iOS still paints black over the background, the existing `#audio-visualizer`
     (vinyl/cover-art) view is shown as the graceful degrade;
  3. **BOTH outcomes are acceptable** and Dean's on-device `[MANUAL]` pass decides
     which ships — your design must not depend on a specific iOS result.
- **MUST NOT regress:** video-frame display (only the audio path changes; no
  overlay/dimming bleeding onto video), `playsinline`/`webkit-playsinline`, the
  v1.2.2 iOS background-audio behavior (no custom Media Session action handlers),
  or the lock-screen Media Session artwork (`setupMediaSession` — a SEPARATE surface).
- Include a **pure `[UNIT]`-testable helper** that resolves the audio background-art
  image URL for an item (real thumbnail vs SVG-placeholder decision via
  `hasThumbnail`), UMD dual-exported so it's `node:test`-able. Specify its unit tests.
- Decide whether you keep BOTH the CSS-background art AND the `#audio-visualizer`
  as a runtime fallback, or pick one — and state exactly how the fallback is
  selected. State the feasibility finding/approach explicitly in the Design section
  (a required deliverable per the AC).

## Feature 2 — related items = fuzzy-similar (rankRelated)

Design a **pure, exported, unit-testable** `rankRelated(currentItem, allItems)
-> ordered list`:

- **UMD dual-exported** like `common.js`'s existing helpers; **fed by the existing
  `/api/videos`** — NO new server endpoint, no new DB fields.
- **Default signals:** title/filename token overlap (primary) + shared-`folderName`
  boost (secondary). You finalize the exact scoring: tokenization rules, stopword
  handling, how filename vs. title tokens combine, the shared-folder weight, and a
  **deterministic, stable tie-break** (e.g. equal score -> newer `addedAt` first) so
  ordering never flaps.
- **Self-exclusion:** the current item is never in its own list.
- **Fallback threshold N=6:** when fewer than 6 items score as genuinely similar,
  fall back to / pad with most-recent so the list is **never empty and never worse
  than today**. Keep the slice length consistent with today (10).
- **Home:** a pure helper usable from `loadRelatedFiles` (`~710-753`) — pick
  `common.js` vs. a new `public/js/*.js` module and justify briefly; make sure it's
  loaded as a `<script>` on `watch.html` if it's a new file.
- **Keep it simple** — basic tokenize + score, no fuzzy-match library, no inverted
  index, no ML.
- Specify the **`[UNIT]` tests:** similar-ranks-above-unrelated; self-excluded;
  deterministic + stable tie-break (repeated calls identical); fallback-below-
  threshold (never empty, degrades to recent); edge cases (empty `allItems`, single
  item = only the current item, items missing optional fields like tags/artist —
  no throw, self-exclusion + never-empty preserved).

## Cross-cutting constraints (both features)

- Additive / zero-regression; every change ships with tests; **lint 0 errors** (11
  allowed "defined but never used" exported-global warnings are the baseline);
  keep the **217+ test suite green**. `node:test`/`node:assert` only, no new deps.
- Any npm/node command needs `export PATH="/home/coder/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"` first (fnm not auto-sourced).
- The yt-dlp future module is OUT OF SCOPE — do not touch it.

## Deliverables

1. Write the `## Design` section of `docs/exec-plans/active/2026-07-05-audio-art-and-related.md`:
   - F1: the stated feasibility approach/finding, the exact CSS layering + fallback
     selection, the video/playsinline/background-audio/lock-screen non-regression
     argument, and the background-art-URL helper + its unit tests.
   - F2: the final signal set + scoring formula + tie-break + N, the pure fn's home,
     the `loadRelatedFiles` wiring, and the unit test list.
   - Update `docs/ARCHITECTURE.md` only if you introduce a genuinely new component
     (a new shared client module counts as a small note; a CSS-only art layer likely
     does not).
2. Set `artifacts.design` in `.state/feature-state.json` to the exec plan path.
3. **Propose the task breakdown** (the EM finalizes it) — likely: (T1) F2 rankRelated
   helper + `loadRelatedFiles` wiring with strong unit tests (gets the QA gate / a
   code-review pass if you find the scoring subtle); (T2) F1 CSS-background art +
   `#audio-visualizer` fallback + the URL helper, mostly `[MANUAL]` + build-verify.
   Keep F1 and F2 as SEPARATE commits/tasks.

Do NOT write application code — this is the design stage. Specify what changes,
where, and how it's tested; the software-developer implements per task afterward.
