# Audio Art & Related-Items Similarity

> **STATUS: COMPLETED — ready for PR (v1.10.0), `feat/audio-art-and-related`.**
> Both features code-complete, build-verified, `lint 0`, `npm test 241/241`.
> F2 (rankRelated) QA-approved (with the folded `W_CHANNEL` fix); F1 (audio art)
> build-verified with all non-regression invariants intact. Two `[MANUAL]`
> on-device items DEFERRED to Dean's pass against the PR (NON-BLOCKING): F2
> "feels related on real content" and F1 iOS in-page art-shows (win) vs. one-line
> `AUDIO_PLAYER_MODE='visualizer'` fallback (Dean is the arbiter). Commits:
> `59cfb13` (park yt-dlp docs), `d583ded` (T1 rankRelated), `e8754f8` (T2 audio
> art). To be `git mv`'d to `docs/exec-plans/completed/` by the coordinator at
> commit time. Nice-to-have follow-up: optional iOS-only UA-gate of the fallback
> (desktop art + iOS fallback simultaneously) — see Decision log / Risks.

## Goal

One branch, two independent, additive media-experience improvements, shipped as
separate commits so either can revert without touching the other: (1) make
audio-only playback visually read as "a video is playing" on iOS Safari by
showing the item's thumbnail as background art, if and only if a feasibility
spike shows it survives real playback; (2) make the "Related Files" list on
the watch page rank by lightweight content similarity instead of effectively
being a most-recent list.

## Scope

- **Feature 1:** a Discovery/Design-owned FEASIBILITY SPIKE into whether iOS
  Safari can render the current item's thumbnail as background/art behind or
  around an audio-only `<video>` element *during* playback (not just before
  playback starts). Depending on the spike's finding: either (a) implement
  thumbnail-as-audio-background with `object-fit: cover`-style framing so
  audio reads like video, or (b) explicitly accept and document the existing
  `#audio-visualizer` (vinyl/cover-art) view as the shipped PWA-only fallback.
  The feasibility finding itself is a required deliverable of Design, stated
  explicitly — not left implicit in code.
- **Feature 2:** a pure, exported, unit-testable `rankRelated(currentItem,
  allItems)` ranking function that scores other items by lightweight
  similarity (title/filename token overlap, shared folder, shared
  artist/channel, tags — final signal set is the Principal Engineer's design
  call), wired into the existing related-items population in place of the
  current newest-first/same-folder-first sort. Falls back to most-recent
  when there are too few similar items so the list is never empty or worse
  than today.

## Out of scope

- The "optional yt-dlp integration module"
  (`docs/exec-plans/future/yt-dlp-integration-module.md`, referenced by
  ROADMAP) — explicitly parked for a later branch. Do not touch it here.
- Feature 1: any change to how already-working VIDEO files display their
  frame; any change to `setupMediaSession` / lock-screen artwork (already
  wired, out of scope, must not be conflated with the in-page player); adding
  custom Media Session action handlers (explicitly rejected per the v1.2.2
  iOS background-audio rationale in `watch.js:242-248` — reintroducing them is
  out of scope for this feature).
- Feature 2: a server-side search endpoint or new `/api/*` route (the ranking
  is fed by the existing `/api/videos`); a real search engine / fuzzy-matching
  library / ML ranking; new database fields; changing the `.related-card`
  rendering markup itself (only the ordering feeding it changes).
- Neither feature ships without tests, and neither is exempted from lint-0 —
  per `docs/CONTRIBUTING.md`'s Definition of Done, every change ships with
  tests and zero lint errors regardless of how "mostly manual" or "UI-heavy"
  it is. Feature 1's non-regression and fallback-path claims must still be
  captured by at least one automated (unit) check on the pure parts even
  though the on-device visual verification is manual.

## Constraints

- Node.js 22 (`engines` >=20), CommonJS only, no new runtime dependencies for
  the ranking function (`node:test` + `node:assert` only, per CONTRIBUTING).
- No FFmpeg-dependent tests in the automated suite.
- Zero regressions: video files' existing frame display, `playsinline` inline
  playback (no forced iOS fullscreen), and the v1.2.2 iOS background-audio
  behavior (audio keeps playing when the PWA is backgrounded/home-screened,
  no custom transport handlers) must all be verified unchanged.
- Feature 1 explicitly accepts a PWA-only outcome if the spike finds iOS
  forces black regardless of technique — this is a valid, shipped result, not
  a failure to route around.
- Feature 2's ranking must stay "nothing crazy" — a basic tokenize + score,
  not a search engine — and must degrade to at least today's behavior
  (never empty, never worse than most-recent) when signal is thin.
- The two features ship as separate commits/tasks and must be revertable
  independently.

---

## Feature 1 — Audio thumbnail-as-background art (FEASIBILITY-GATED)

### Problem

On iOS Safari, an audio-only file plays with a black player area once
playback starts. `watch.js:288-295` already sets
`mediaPlayer.poster = '/thumbnail/' + mediaId` for audio items and hides
`#audio-visualizer` — so the "poster" approach is effectively already
shipped. The reported black screen is very likely the well-known behavior of
`poster` disappearing once playback begins, not a missing feature. Video
files already display their frame correctly during playback; this is
audio-only.

### Feasibility spike (required first design step)

Before any implementation, Design must test, on real iOS Safari, whether the
thumbnail can be shown as art *during* playback (not just pre-play) via at
least these candidate approaches, and record the result:

- **(a) `poster` attribute** — already in place (`watch.js:288-295`). Expected
  to be insufficient once playback starts; the spike must confirm/deny this
  and state why.
- **(b) CSS `background-image`** (the item's thumbnail) on `#player-wrapper` /
  the player container, sitting behind a transparent or still-postered
  `<video>`, framed with `object-fit: cover`-equivalent (`background-size:
  cover`) so it reads like a video frame rather than letterboxed art.
- **(c) Accept that iOS's native audio takeover forces black regardless of
  markup/CSS** — a real, allowed spike outcome.

The lock-screen / Control Center artwork (`setupMediaSession`,
`watch.js:249-265`) is a separate surface (native OS media widget) and is
already working; it is NOT the in-page player and must not be conflated with
or used as evidence for this feature.

**If the spike finds an approach that survives iOS playback:** implement
thumbnail-as-audio-background using that approach, cover-framed, without
changing how video files render.

**If the spike finds iOS forces black regardless:** ship the existing
`#audio-visualizer` (vinyl/cover-art view, `watch.html:139-145`, currently
`display:none`) as the documented PWA-only fallback for audio playback. Dean
has explicitly accepted this outcome as a valid result — it is not a
blocker to closing the feature.

Either way, the exec plan's Design section must state the feasibility
finding explicitly (which approach(es) were tested, what happened, and which
one shipped) as a first-class deliverable, not something left implicit in the
diff.

### Acceptance criteria

- [ ] **[MANUAL]** The feasibility finding is documented in this exec plan's
      Design section, naming which approach(es) were tested on real iOS
      Safari and the outcome (survives-during-playback vs. forced-black),
      before any Feature 1 implementation task is marked done.
- [ ] **[MANUAL]** (Works-case, only if the spike finds a surviving
      approach) On a real iOS Safari device, playing an audio-only file shows
      the item's thumbnail as full-bleed, cover-framed background/art for the
      duration of playback (not just before pressing play) — visually reading
      like a video is playing.
- [ ] **[UNIT]** A pure helper resolves the correct background-art image URL
      for a given audio item (using its id and `hasThumbnail` flag),
      distinguishing a real extracted thumbnail from the SVG placeholder
      case, with deterministic output for the same inputs.
- [ ] **[MANUAL]** (Fallback-case, only if the spike finds iOS forces black)
      On a real iOS Safari device, audio playback shows the existing
      `#audio-visualizer` (vinyl/cover-art) view instead of a black screen —
      confirmed as the documented, accepted PWA-only degrade.
- [ ] **[MANUAL]** Non-regression: video files continue to display their
      video frame during playback, unaffected by whatever change is made to
      the audio path (no background bleed-through, no dimming/overlay
      applied to video playback).
- [ ] **[MANUAL]** Non-regression: `playsinline`/`webkit-playsinline` inline
      playback is preserved on iOS for both audio and video — no forced
      native fullscreen takeover introduced by the chosen approach.
- [ ] **[MANUAL]** Non-regression: the v1.2.2 iOS background-audio behavior
      is preserved — audio keeps playing when the PWA is backgrounded or
      sent to the home screen, and no custom Media Session action handlers
      are introduced (per the documented rationale at `watch.js:242-248`).
- [ ] **[MANUAL]** Non-regression: lock-screen / Control Center Media Session
      artwork (`setupMediaSession`) continues to work exactly as before,
      regardless of which approach ships for the in-page background.
- [ ] **[MANUAL]** Desktop and non-iOS mobile audio playback is unaffected —
      still shows the existing poster/art behavior with no regression.
- [ ] **[PROCESS]** Lint remains at 0 errors (11 pre-existing "defined but
      never used" exported-global warnings are the allowed baseline); the
      full test suite (currently 217 tests) stays green; any new pure logic
      (e.g. the background-art URL helper) ships with unit tests per
      CONTRIBUTING's Definition of Done.

---

## Feature 2 — Related items = fuzzy-similar, not just most-recent

### Problem

`loadRelatedFiles` (`watch.js:710-753`) fetches `/api/videos` (newest-first),
filters out the current item, puts same-folder items first, then everything
else, and slices to 10. In practice this is a most-recent list with a
same-folder nudge, not a "related" list. Dean wants it to feel actually
related: "if there's some keyword or something related... a basic fuzzy
search where if there's a certain part that's fuzzy similar, show those" —
explicitly "keep it simple, nothing crazy," a basic tokenize + score, not a
search engine.

### Requirements

- A pure, exported, unit-testable ranking function — e.g. `rankRelated(currentItem,
  allItems)` returning an ordered list — replaces the current sort feeding
  `loadRelatedFiles`'s render step. No new server endpoint: it is fed by the
  existing `/api/videos` response. Follows the repo's existing browser+node
  dual-export (UMD) precedent (`common.js:483`) so it is `node:test`-able the
  same way `resolveTheme`, `clampPositionState`, `getStarRating`, etc. are.
  Exact home (`common.js` vs. a new `public/js/*.js` module) is the Principal
  Engineer's call.
- Scoring signals are a Design-stage choice among: title/filename token
  overlap, shared `folderName`, shared artist/channel (`item.artist` /
  `resolveChannelName`-style resolution), shared `tags`. Must stay simple —
  basic tokenization and scoring, not fuzzy-matching libraries or an inverted
  index.
- Deterministic output: same `(currentItem, allItems)` input always produces
  the same ordering, including a defined, deterministic tie-break for equal
  scores (e.g. stable secondary sort by recency) so ties don't flap between
  requests.
- Self-exclusion: the current item is never included in its own related list.
- Fallback threshold: when fewer than N items clear a "genuinely similar"
  score, the list falls back to (or is padded out with) most-recent items so
  the related list is never empty and never worse than today's behavior. N's
  exact value is a Design-stage choice (see Open questions).
- The existing `.related-card` rendering and its fields (thumbnail, title,
  folder, duration badge, mock views) keep working unchanged — only the
  ordering/selection feeding it changes.

### Acceptance criteria

- [ ] **[UNIT]** Given a set of items with clear title/filename or metadata
      overlap with the current item, `rankRelated` ranks those items above
      unrelated items in the current library.
- [ ] **[UNIT]** `rankRelated` never includes the current item (self) in its
      output.
- [ ] **[UNIT]** `rankRelated` is deterministic: the same inputs produce the
      same ordered output across repeated calls, including a defined,
      documented tie-break rule for equal-scoring items.
- [ ] **[UNIT]** When fewer than the fallback threshold N of items score as
      genuinely similar, `rankRelated` falls back to (or fills out with)
      most-recent items so the result is never empty and never a worse list
      than today's most-recent/same-folder sort.
- [ ] **[UNIT]** Edge cases: an empty `allItems` list, a library of one item
      (only the current item), and items missing optional fields (no tags,
      no artist) are all handled without throwing and without violating
      self-exclusion or the never-empty guarantee.
- [ ] **[MANUAL]** On real library content, the related list for a sample of
      items subjectively reads as related (shared topic/series/folder/artist)
      rather than simply the most-recently-added files.
- [ ] **[PROCESS]** Lint stays at 0 errors (allowed baseline unchanged); full
      test suite green; new tests added for `rankRelated` per CONTRIBUTING's
      "every feature ships with tests."

---

## Design

Two independent, additive changes, one per commit. Both new pure helpers live
in the existing `public/js/common.js` UMD block, so no new client module and no
`ARCHITECTURE.md` component is introduced. No server route, no DB field, and no
new dependency is added by either feature.

### Feature 1 — Audio thumbnail-as-background art (approach b, feasibility-gated)

#### Feasibility finding (stated deliverable)

This environment has no real iOS Safari device, so the finding is recorded as a
reasoned design conclusion, and Dean's on-device `[MANUAL]` pass is the arbiter:

- **(a) `poster` attribute — insufficient, confirmed by construction.** The
  audio branch already sets `mediaPlayer.poster = '/thumbnail/' + mediaId`
  (`watch.js:294`). The HTML `poster` is defined to display only *until the
  first frame / playback begins*; for an audio-only `<video>` there is no frame,
  so once playback starts the element paints its default background (black on
  iOS). This is exactly the reported black-on-playback. Poster alone therefore
  cannot satisfy the goal; it is retained only as harmless pre-play art.
- **(b) CSS `background-image` — the designed approach, verifiably correct on
  desktop/PWA.** A dedicated art layer inside `#player-wrapper` carries the
  thumbnail, `background-size: cover` + centered, painted *behind* the audio
  `<video>`. An audio-only `<video>` has no video track, so on desktop its
  content box composites transparent (we also force `background: transparent`
  on it in audio mode); the art shows through, cover-framed, reading like a
  video. This is fully verifiable on desktop and PWA and degrades cleanly (no
  broken layout, no black-on-black).
- **(c) iOS-during-playback — UNKNOWN here, delegated to the on-device pass.**
  If iOS composites an opaque black audio surface over the element regardless of
  markup/CSS, the CSS art is hidden on that platform only. The accepted graceful
  degrade is the existing `#audio-visualizer` (vinyl/cover view,
  `watch.html:139-145`). Both outcomes are acceptable and the design depends on
  neither: desktop/PWA wins either way, iOS is a win-or-fallback.

#### Approach

Add a **dedicated art layer** `<div id="audio-bg-art" class="audio-bg-art">` as
the first child of `#player-wrapper` in `watch.html`, absolutely positioned to
fill the container beneath the player. It is `display:none` by default and is
only revealed for audio items. Reveal is gated by a single, explicit
module-level switch in `watch.js`, `AUDIO_PLAYER_MODE`, with two values:

- `'background'` (**default, shipped**) — CSS background art path.
- `'visualizer'` — retained `#audio-visualizer` path (the pre-v1.10.0 fallback).

The switch exists so that if Dean's on-device pass finds iOS forces black, the
fallback is enabled by changing one line — with zero runtime iOS detection and
no dependency on a specific iOS result. (Optional refinement, Dean's call at
acceptance: gate the fallback to iOS-only via a UA check so desktop keeps the
background; the simple default flips globally.)

In the audio branch of `setupPlayer()` (`watch.js:288-295`), when
`AUDIO_PLAYER_MODE === 'background'`:

- Resolve the art URL via the pure helper `resolveAudioArtUrl(mediaData)`.
- If it returns a URL, set `audioBgArt.style.backgroundImage = 'url("..." )'`,
  `audioBgArt.style.display = 'block'`, and add class `audio-mode` to
  `#player-wrapper`; keep `#audio-visualizer` hidden.
- If it returns `null` (no real thumbnail — placeholder only), leave the art
  layer hidden and fall through to today's plain poster/black behavior (a
  stretched cover of the 160×90 SVG placeholder would look bad, so we do not
  use it as background).
- The existing `poster` and `src` assignments stay unchanged.

When `AUDIO_PLAYER_MODE === 'visualizer'`, the audio branch shows
`#audio-visualizer` (as it did before poster-only shipped) and leaves the art
layer hidden. Video items take neither path — no `audio-mode` class, no art
layer — so their `object-fit: contain` frame and `#000` letterbox are untouched.

#### Component changes

- **`public/watch.html`**: add `<div id="audio-bg-art" class="audio-bg-art">`
  as the first child of `#player-wrapper` (before the overlays and `<video>`).
  No change to `#media-player`, its `playsinline`/`webkit-playsinline`
  attributes, or `#audio-visualizer`.
- **`public/css/style.css`**: add `.audio-bg-art` (absolute, `inset: 0`,
  `z-index: 0`, `background-size: cover`, `background-position: center`,
  `display: none`) and `#player-wrapper.audio-mode #media-player { background:
  transparent; z-index: 1; }`. The `.player-container` `#000` background and
  `.player-container video { object-fit: contain }` rules are unchanged, so the
  art only shows for audio items that opted in.
- **`public/js/watch.js`**: add the `AUDIO_PLAYER_MODE` constant; in the audio
  branch, call `resolveAudioArtUrl`, toggle the art layer / `audio-mode` class
  (or the visualizer, per the switch). No change to `setupMediaSession`, the
  v1.2.2 no-custom-action-handlers rationale, progress/position listeners, or
  the video branch.
- **`public/js/common.js`**: add and export `resolveAudioArtUrl`.

#### Pure helper `resolveAudioArtUrl(item)`

Home: `public/js/common.js` (UMD dual-export, `node:test`-able like its
siblings). Signature and contract:

```js
// Resolve the background-art image URL for an audio item, or null when the item
// would only resolve to the SVG placeholder (no real extracted thumbnail).
// Pure and deterministic. /thumbnail/:id never 404s, but a placeholder makes a
// poor cover-framed background, so callers use null to skip the art layer.
resolveAudioArtUrl(item)
  -> '/thumbnail/' + item.id   when item && item.id && item.hasThumbnail truthy
  -> null                      otherwise (no item, no id, or hasThumbnail falsy)
```

`[UNIT]` tests (`test/unit/resolve-audio-art-url.test.js`):

- real thumbnail (`{ id: 'abc', hasThumbnail: true }`) → `'/thumbnail/abc'`.
- `hasThumbnail: false` → `null` (placeholder case, distinguished).
- `hasThumbnail` missing/undefined → `null`.
- `item` `null`/`undefined` → `null` (no throw).
- item without `id` → `null`.
- deterministic: same input yields the same output across repeated calls.

#### Non-regression argument

- **Video-frame display**: video items never get `audio-mode` or the art layer;
  `.player-container video { object-fit: contain }` and `#000` are unchanged.
- **`playsinline`/`webkit-playsinline`**: `#media-player` attributes untouched;
  no fullscreen API introduced.
- **v1.2.2 background-audio**: no Media Session action handlers added; transport
  stays native; only CSS/DOM layering and one URL assignment change.
- **Lock-screen Media Session**: `setupMediaSession` (`watch.js:249-265`) is a
  separate OS surface, unmodified; its `artwork` still points at `/thumbnail/:id`.
- **Desktop / non-iOS mobile**: default `'background'` path shows the art
  correctly; the placeholder-only case falls back to today's poster behavior.

### Feature 2 — `rankRelated` (lightweight similarity ranking)

#### Home and wiring

Home: `public/js/common.js` (UMD dual-export, `node:test`-able; reuses the
sibling `resolveChannelName`). Fed entirely by the existing `/api/videos`
response `loadRelatedFiles` already fetches — no new endpoint, no DB field.

`loadRelatedFiles` (`watch.js:710-753`) is rewired: the current block that
filters out the current id, splits `sameFolder`/`otherFolders`, and slices to 10
(lines ~715-722) is replaced by a single call:

```js
const related = rankRelated({ ...mediaData, id: mediaId }, allFiles);
```

The `related.length === 0` empty-state guard and the entire `.related-card`
render loop (thumbnail, title, folder, duration badge, mock views) stay exactly
as they are — only the ordering/selection feeding the render changes.

#### Signature and contract

```js
// Pure. Returns an ordered array of related items (never the current item),
// best-match first, padded with most-recent so it is never empty and never
// worse than today's most-recent/same-folder list. Length capped at
// RESULT_COUNT (10, matching today's slice). Deterministic for identical input.
rankRelated(currentItem, allItems)
```

Named constants: `RESULT_COUNT = 10` (matches today's `slice(0, 10)`),
`SIMILAR_FLOOR = 6` (the "genuinely similar" guarantee point; see fallback).

#### Tokenization

`tokenize(str)` (a private helper in `common.js`):

- lowercase the string;
- split on `/[^a-z0-9]+/` (non-alphanumeric runs);
- drop tokens shorter than 2 characters;
- drop a small stopword set (articles/conjunctions/prepositions and common
  media-noise tokens): `the a an and or of to in on for with feat ft official
  video audio hd mp3 mp4 avi mkv mov webm` (final list is small and fixed);
- dedupe (return a `Set`).

An item's token set is the union of `tokenize(title)`, `tokenize(basename of
filePath)`, and each entry of `tags` tokenized (tags optional; absent/non-array
contributes nothing). Missing `title`/`filePath` contribute nothing and never
throw.

#### Score formula and weights

For each candidate (all items except self), `score` =

- `W_TOKEN (3) × |sharedTokens|` — shared meaningful tokens between the current
  item's set and the candidate's set (**primary signal**);
- `+ W_FOLDER (2)` when `folderName` is non-empty and equal (**secondary**);
- `+ W_CHANNEL (1)` when `resolveChannelName(current) === resolveChannelName(
  candidate)` **and** the folders differ — a cheap cross-folder same-artist
  bonus that does not double-count the folder boost. `resolveChannelName` is
  called with no `folderSettings` (relative comparison only needs
  `artist || folderName`).

The weights make one shared title token (3) outrank a folder-only match (2), and
two shared tokens (6) dominate — so token overlap is primary and folder is
secondary, per Dean's "nothing crazy."

#### Deterministic tie-break, self-exclusion, fallback

Comparator (applied to a fully-computed score, never relying on sort stability
alone): **score DESC, then `addedAt` DESC (newer first), then `id` ASC.** Missing
`addedAt` sorts as oldest; `id` is the final total-order tie-break, so identical
input always yields byte-identical output.

- **Self-exclusion**: candidates are `allItems` filtered by `item.id !==
  currentItem.id` (and skipping the exact current reference), so the current
  item is never present.
- **Fallback / padding**: `similar` = candidates with `score > 0` sorted by the
  comparator; `recent` = **all** candidates sorted by `addedAt` DESC, `id` ASC
  (today's ordering). Result = de-duplicated `[...similar, ...recent]` sliced to
  `RESULT_COUNT`. This guarantees: similar items first, the remainder filled by
  most-recent, never empty, and never worse than today. `SIMILAR_FLOOR = 6` is
  the documented guarantee: whenever fewer than 6 candidates clear `score > 0`,
  the shortfall is filled from the most-recent tail (today's exact behavior).

#### `[UNIT]` tests (`test/unit/rank-related.test.js`)

- **similar-above-unrelated**: candidates sharing title/filename tokens (and/or
  folder) rank above token-disjoint candidates.
- **self excluded**: `currentItem` included in `allItems` never appears in the
  output.
- **deterministic + stable tie-break**: equal-score candidates order by
  `addedAt` DESC then `id` ASC; repeated calls return identical arrays.
- **fallback below floor**: a library with fewer than 6 similar items plus many
  unrelated ones returns a full (`min(10, others)`) list — similar first, then
  most-recent — never empty.
- **tokenization**: items sharing only stopwords/very-short tokens (e.g. `the`,
  `a`) are not treated as similar.
- **edge cases**: empty `allItems` → `[]`; a library of one (only self) → `[]`;
  items missing `tags`/`artist`/`folderName`/`filePath` do not throw and
  preserve self-exclusion + the never-empty guarantee.
- **never returns the current item** (covered by self-excluded + edge cases).

### Alternatives considered

- **F1 — persist a real per-item cover image / overlay `<img>` above the
  `<video>`**: an `<img>` layered over the player would cover the native
  controls or need pointer-events juggling, and still would not survive an iOS
  opaque-black surface any better than a CSS background. The CSS background layer
  is simpler, controls stay native, and the fallback switch is one line.
  Rejected as more complex with no iOS advantage.
- **F1 — runtime iOS detection to auto-pick background vs visualizer**: brittle
  UA sniffing and still cannot detect whether iOS *actually* painted black. A
  documented one-line switch with Dean's on-device pass as arbiter is more
  honest and simpler. (Kept available as an optional acceptance-time refinement.)
- **F2 — server-side ranking endpoint / TF-IDF / fuzzy-match library**: out of
  scope (no new route, no new dep) and explicitly heavier than "nothing crazy."
  A pure client helper fed by the existing `/api/videos` is sufficient and
  unit-testable. Rejected.
- **F2 — Jaccard similarity (intersection / union) instead of raw shared-token
  count**: normalizing by union penalizes items with long titles and complicates
  the weight story against the folder/channel boosts. Raw intersection count
  with fixed weights is simpler, predictable, and easy to test. Rejected.

### Risks and mitigations

- **Risk**: iOS composites opaque black over the audio `<video>`, hiding the CSS
  art. → **Mitigation**: retained `#audio-visualizer` fallback selectable via the
  one-line `AUDIO_PLAYER_MODE` switch; Dean's on-device `[MANUAL]` pass decides;
  desktop/PWA is unaffected regardless.
- **Risk**: the CSS art layer bleeds onto video items. → **Mitigation**: the
  layer and `audio-mode` class are only applied in the audio branch; video items
  never opt in; verified by the non-regression `[MANUAL]` AC.
- **Risk**: `rankRelated` weights over/under-tune "related." → **Mitigation**:
  weights are named constants, easy to retune; Dean may redirect F2 weighting at
  acceptance (non-blocking per the coordinator); strong unit tests pin behavior.
- **Risk**: non-deterministic ordering flapping between loads. → **Mitigation**:
  explicit total-order comparator (score, `addedAt`, `id`) never relies on sort
  stability; a determinism unit test asserts identical repeated output.
- **Risk**: items missing optional fields throw in `rankRelated`/tokenize. →
  **Mitigation**: defensive reads (missing title/filePath/tags/artist contribute
  nothing); an edge-case unit test covers it.

### Performance impact

No expected impact on any `RELIABILITY.md` budget. `rankRelated` is O(n) over the
already-fetched `/api/videos` list (a bounded home library) with small per-item
token sets, run once per watch-page load on the client; no new network calls, no
server work, no FFmpeg. F1 is CSS/DOM only.

### Proposed task breakdown (EM finalizes)

- **T1 — Feature 2 `rankRelated`** (commit 1): add `rankRelated` (+ private
  `tokenize`) to `common.js`, UMD-export it, rewire `loadRelatedFiles`
  (`watch.js:710-753`), add `test/unit/rank-related.test.js`. Scoring is subtle
  enough to warrant the `quality-assurance` gate / a code-review pass. Fully
  `[UNIT]`-verifiable.
- **T2 — Feature 1 audio background art** (commit 2): add `#audio-bg-art` +
  `.audio-bg-art` CSS + `#player-wrapper.audio-mode` rule, the
  `AUDIO_PLAYER_MODE` switch and audio-branch wiring in `watch.js`, the
  `resolveAudioArtUrl` helper (+ export) with
  `test/unit/resolve-audio-art-url.test.js`. Mostly `[MANUAL]` + build-verify +
  Dean's on-device iOS pass (the feasibility arbiter).

Order: **T1 first** (pure, fully testable, unblocks the QA gate), **then T2**
(feasibility/manual). Separate commits so either reverts independently.

## Task breakdown

Two tasks, ONE feature each, SEPARATE commits, revertable independently. F2 (T1)
lands FIRST so the pure-logic + QA-gated change is in before the mostly-manual UI
change; each is build-verified on its own.

- **T1 (commit 1, FIRST) — Feature 2: `rankRelated` similarity ranking.** Add
  `tokenize` (private) + `rankRelated(currentItem, allItems)` to
  `public/js/common.js` (UMD dual-export, reusing `resolveChannelName`); named
  constants `RESULT_COUNT=10`, `SIMILAR_FLOOR=6`, `W_TOKEN=3`, `W_FOLDER=2`,
  `W_CHANNEL=1`; explicit total-order comparator (score DESC → `addedAt` DESC →
  `id` ASC). Rewire `loadRelatedFiles` (`watch.js:715-722`) to
  `const related = rankRelated({ ...mediaData, id: mediaId }, allFiles);`,
  leaving the `related.length === 0` guard and the `.related-card` render loop
  UNCHANGED. Add `test/unit/rank-related.test.js` with the full `[UNIT]` set
  (similar-above-unrelated, self-excluded, deterministic + stable tie-break,
  fallback-pads-when-<6-similar, tokenization drops stopwords/short tokens, edge
  cases: empty list / single item / missing tags/artist/folder/filePath no-throw,
  never returns current). Additive/zero-regression; 217+ suite green; lint 0.
  Gets at least the quality-assurance agent (+ a code-review pass if scoring
  looks subtle).
- **T2 (commit 2, after T1) — Feature 1: audio thumbnail-as-background art.** Add
  `<div id="audio-bg-art" class="audio-bg-art">` as first child of
  `#player-wrapper` (`watch.html`); `.audio-bg-art` + `#player-wrapper.audio-mode
  #media-player` CSS (`style.css`); `AUDIO_PLAYER_MODE` constant + the audio-branch
  toggle (art layer / `audio-mode` class, or the retained `#audio-visualizer` per
  the switch) in `watch.js`; pure `resolveAudioArtUrl(item)` in `common.js` +
  `test/unit/resolve-audio-art-url.test.js`. Mostly `[MANUAL]` (Dean on-device
  iOS) + build-verify. MUST NOT regress video-frame display, `playsinline`,
  v1.2.2 background-audio, or the lock-screen Media Session. Feasibility finding
  above is the stated deliverable; the on-device pass is the arbiter.

## Progress log

- 2026-07-05 — Discovery: exec plan drafted by product-manager from the
  bootstrap grounding in `.state/feature-state.json` and direct reading of
  `watch.js` (`setupPlayer` audio branch, `setupMediaSession`,
  `loadRelatedFiles`), `watch.html` (`#player-wrapper`, `#audio-visualizer`),
  `server.js` (`/thumbnail/:id`, never-404 placeholder logic), and
  `common.js` (UMD dual-export tail + `resolveChannelName`). Confirmed
  `mediaPlayer.poster` for audio is already shipped, making the Feature 1
  spike load-bearing rather than speculative.

## Decision log

- 2026-07-05 — Confirmed via code reading that `poster` (approach a) is
  already implemented for audio playback (`watch.js:288-295`); the reported
  iOS black-during-playback is treated as evidence the spike is real, not
  as a bug in already-shipped code.
- 2026-07-05 — Confirmed no dedicated "artist" field is guaranteed on every
  item; `resolveChannelName` (`common.js:251-255`) falls back
  `mapped name -> item.artist -> item.folderName -> 'Library'`, so any
  artist/channel similarity signal in Feature 2 should route through the
  same resolution rather than assuming a raw `item.artist` always exists.

## Open questions

These are the two headline questions for the design gate. Proposed defaults
are offered below; the Principal Engineer makes the final call.

1. **F1 — which approach(es) to actually test on real iOS, and is the
   `#audio-visualizer` fallback accepted?** Test poster (a, already shipped —
   confirm it's insufficient and document why) and CSS background-image (b)
   at minimum; accept-native-black (c) is a valid spike conclusion, not a
   failure. **Confirmed:** the `#audio-visualizer` vinyl/cover view is the
   accepted PWA-only graceful degrade if (c) is the finding — Dean has
   explicitly signed off on this outcome.
2. **F2 — which similarity signals to rank on, and what's the fallback
   threshold N?** Candidates: title/filename token overlap, shared folder,
   shared artist/channel, shared tags. **Proposed default:** title/filename
   token overlap as the primary score, with a shared-folder boost as a
   secondary signal, falling back to most-recent when fewer than **6**
   items score as similar. Final signal set, weighting, and N are the
   Principal Engineer's design call.
