# Software Developer — T2 (Feature 1): audio thumbnail-as-background art

You are the Software Developer. Implement **T2 ONLY** — Feature 1 (show an
audio-only item's thumbnail as cover-framed background art behind the player).
This is commit 2 of 2 on `feat/audio-art-and-related`, a SEPARATE commit from T1.
Do NOT touch T1's `rankRelated` / related-list code.

## Context / feasibility finding (put a short version in code comments)

On iOS Safari an audio-only `<video>` paints black once playback starts. The
`poster` attribute is ALREADY set for audio (`watch.js:294`) and is exactly what
disappears on play — poster alone is insufficient BY CONSTRUCTION. The design is
approach (b): a CSS `background-image` art layer BEHIND the player. This is fully
correct on desktop/PWA regardless of iOS; on iOS it is win-or-fallback and **Dean's
on-device `[MANUAL]` pass is the arbiter**. If iOS still paints black, the retained
`#audio-visualizer` vinyl view is the graceful degrade, selectable by a one-line
`AUDIO_PLAYER_MODE` flip. Your job: implement the `'background'` default cleanly and
keep the fallback one line away — do not depend on any specific iOS result.

## First, read (self-contained — you share no context with the EM)

- `.state/feature-state.json` — the **T2** task object (`tasks[1]`): `description`, `files`, `done_when`. That is the contract.
- `docs/exec-plans/active/2026-07-05-audio-art-and-related.md` — the `## Design` section, **"Feature 1 — Audio thumbnail-as-background art"** (feasibility finding, approach, component changes, the `resolveAudioArtUrl` contract + its unit tests, and the non-regression argument). Implement exactly to it.
- `public/watch.html` — `#player-wrapper` (`:98`) and its children (resume/transcode overlays, `#media-player` at `:119` with `playsinline`/`webkit-playsinline`, `#audio-visualizer` at `:139-145`).
- `public/js/watch.js` — `setupPlayer()` audio branch (`:288-295`), and the audio-visualizer element refs at the top (`audioVisualizer`, `:6`; `audioVisualTitle`/`audioVisualFolder`). `setupMediaSession` (`:249-265`) and the v1.2.2 no-action-handlers rationale (`:242-248`) — leave BOTH untouched.
- `public/js/common.js` — the UMD dual-export tail (`~483`) where `resolveAudioArtUrl` gets added/exported.
- `public/css/style.css` — the `.player-container` / `#player-wrapper` rules (the `#000` background + `video { object-fit: contain }`) and the `.audio-player-visual` / `#audio-visualizer` styling, so your new rules layer correctly.
- `test/unit/resolve-theme.test.js` or similar for the `common.js` unit-test style.

## Implement

### 1. `public/watch.html` — add the art layer
Add `<div id="audio-bg-art" class="audio-bg-art"></div>` as the **FIRST child** of
`#player-wrapper` (before the resume/transcode overlays and the `<video>`). Do NOT
change `#media-player`, its `playsinline`/`webkit-playsinline` attributes, or the
`#audio-visualizer` markup (it stays as the retained fallback).

### 2. `public/css/style.css` — add two rules
- `.audio-bg-art { position: absolute; inset: 0; z-index: 0; background-size: cover; background-position: center; background-repeat: no-repeat; display: none; }`
- `#player-wrapper.audio-mode #media-player { background: transparent; z-index: 1; }`

Leave the existing `.player-container` `#000` background and
`.player-container video { object-fit: contain }` rules UNCHANGED, so the art only
shows for audio items that opt in via `.audio-mode`. Ensure `#player-wrapper` /
`.player-container` establishes a positioning context — it already does as the
overlay container; verify the resume/transcode overlays still stack ABOVE the art
(art `z-index: 0` sits below `#media-player` `z-index: 1` and the overlays).

### 3. `public/js/common.js` — add + export `resolveAudioArtUrl`
```
// Resolve the background-art image URL for an audio item, or null when the item
// would only resolve to the SVG placeholder (no real extracted thumbnail).
// /thumbnail/:id never 404s, but a stretched 160x90 placeholder makes a poor
// full-bleed background, so callers use null to SKIP the art layer (show nothing
// rather than the placeholder). Pure + deterministic.
resolveAudioArtUrl(item)
  -> '/thumbnail/' + item.id   when item && item.id && item.hasThumbnail truthy
  -> null                      otherwise (no item, no id, or hasThumbnail falsy)
```
Add it to the `module.exports` object in the UMD block (like `resolveTheme` etc.).

### 4. `public/js/watch.js` — the mode switch + audio-branch toggle
- Add a module-level constant near the top:
  `const AUDIO_PLAYER_MODE = 'background';` with a comment: `'background'` (shipped) | `'visualizer'` (retained `#audio-visualizer` fallback — one-line flip if iOS paints black).
  Optional, NOT required: note in a comment that a future iOS-only UA-gate could
  select the fallback on iOS while desktop keeps the art — leave it as a hook, don't build it.
- Grab the art element (e.g. `const audioBgArt = document.getElementById('audio-bg-art');`) alongside the other element refs.
- In the audio branch of `setupPlayer()` (`~288-295`):
  - When `AUDIO_PLAYER_MODE === 'background'`: call `resolveAudioArtUrl(mediaData)`.
    If it returns a URL, set `audioBgArt.style.backgroundImage = 'url("' + url + '")'`,
    `audioBgArt.style.display = 'block'`, add class `audio-mode` to `#player-wrapper`
    (`playerWrapper.classList.add('audio-mode')`), and keep `#audio-visualizer`
    hidden. If it returns `null`, leave the art layer hidden and fall through to
    today's plain poster behavior (do NOT set the placeholder as a full-bleed bg).
  - When `AUDIO_PLAYER_MODE === 'visualizer'`: show `#audio-visualizer` (as before
    the poster-only change — set its display and populate `audioVisualTitle` /
    `audioVisualFolder` if that's what the retained view expects) and leave the art
    layer hidden.
  - Keep the existing `mediaPlayer.poster` and `mediaPlayer.src` assignments as they are.
- The VIDEO branch takes NEITHER path — no `audio-mode` class, no art layer — so
  video frame display / `object-fit` / letterbox are untouched.

### 5. `test/unit/resolve-audio-art-url.test.js`
- `{ id: 'abc', hasThumbnail: true }` -> `'/thumbnail/abc'`.
- `{ id: 'abc', hasThumbnail: false }` -> `null` (placeholder case).
- `hasThumbnail` missing/undefined -> `null`.
- `item` `null`/`undefined` -> `null` (no throw).
- item without `id` -> `null`.
- deterministic: same input -> same output across repeated calls.

## MUST NOT regress (design non-regression argument — verify)
- **Video-frame display**: video items never get `.audio-mode`/art; `object-fit: contain` + `#000` unchanged.
- **`playsinline`/`webkit-playsinline`**: `#media-player` attributes untouched; no fullscreen API introduced.
- **v1.2.2 iOS background-audio**: do NOT add any Media Session action handlers; transport stays native.
- **Lock-screen Media Session**: `setupMediaSession` is a SEPARATE OS surface — do not modify it.
- Keep the existing `#audio-visualizer` markup as the retained fallback.

## Do NOT
- Do NOT touch T1's `rankRelated`/`tokenize`/`loadRelatedFiles` code.
- Do NOT add a server route, DB field, or dependency; no Node built-ins in `common.js` (browser file).

## Definition of done (report these back)
- `#audio-bg-art` added; the two CSS rules added; `resolveAudioArtUrl` added+exported; `AUDIO_PLAYER_MODE` + audio-branch toggle wired; video branch untouched.
- `test/unit/resolve-audio-art-url.test.js` passes.
- Full suite green (234 + new); **lint 0** (no new warnings beyond the 11 baseline).
- **Before any npm/node command:** `export PATH="/home/coder/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"` then `npm run lint` and `npm test`.
- Report files changed + tests added. This is mostly `[MANUAL]` (Dean on-device iOS is the arbiter) + build-verify — NO two-reviewer gate. Keep the diff scoped to `watch.html` + `style.css` + `common.js` + the `setupPlayer` audio branch + the new test.
