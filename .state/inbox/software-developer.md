# Software Developer — Task T1 (v1.10.1 HOTFIX, CSS-only)

You are implementing ONE scoped hotfix task. Read this whole file first. This is a
**CSS-only regression fix** — do not change JS, HTML, or tests.

## Context

FileTube is a self-hosted retro-YouTube media server (Node.js/Express monolith).
In **v1.10.0 Feature 1** (commit `e8754f8`) we added an audio thumbnail-as-background
art layer: an `#audio-bg-art` `<div>` painted behind a transparent audio `<video>`
when `#player-wrapper` is in `.audio-mode`.

**The regression (Dean confirmed on-device iOS):** the album art now shows (good),
but the in-page **native media controls are gone / untappable**. Audio plays, art
shows, but there are no tappable controls.

## Root cause (diagnosed + confirmed in the CSS — do NOT re-litigate, just fix)

Classic **z-index-without-position** bug in `public/css/style.css`:

- `.audio-bg-art { position: absolute; inset: 0; z-index: 0; ... }` — a POSITIONED element.
- `#player-wrapper.audio-mode #media-player { background: transparent; z-index: 1; }` —
  the video is given `z-index: 1` but is **NOT positioned**. The base
  `.player-container video` rule has no `position`, so the video is `position: static`.
  **`z-index` has no effect on a static element.**

So the statically-positioned video paints in normal flow (before positioned
descendants), and the absolutely-positioned art (`z-index: 0`) paints **on top** of it,
covering the video's native iOS control bar. Hence: art shows, audio plays, but
controls are buried and untappable. The existing code comment claiming the art
"Sits BELOW #media-player (z-index 0 vs 1)" is wrong for exactly this reason.

## The fix — make these THREE changes in `public/css/style.css` ONLY

Everything you need is between roughly lines 631–656.

1. In `#player-wrapper.audio-mode #media-player`, **ADD `position: relative;`** so its
   existing `z-index: 1` actually applies and the video (with its native controls)
   paints **above** the art layer. **Keep** the existing `background: transparent;`
   and `z-index: 1;`.

2. In `.audio-bg-art`, **ADD `pointer-events: none;`** so the background art can never
   intercept taps regardless of stacking (belt-and-suspenders — the art is purely
   decorative and should never be interactive).

3. **Fix the now-inaccurate block comment** directly above `.audio-bg-art`. It
   currently says the art "Sits BELOW #media-player (z-index 0 vs 1)". Reword it to
   state accurately: the audio `<video>` is positioned (`position: relative`) so its
   `z-index: 1` places it **above** the art layer, keeping the native controls on top
   and tappable; the art is `pointer-events: none` decorative and never intercepts input.

## Verify (confirm, do not change)

The overlays must still stack **above** the video: resume/transcode `z-index: 10`,
skip controls `z-index: 6`, speed `z-index: 20`. These are separately positioned with
higher `z-index` than the video's `z-index: 1`, so they remain above it. Confirm this
is still true after your change — do not modify them.

## DO NOT REGRESS

- **Video items never get `.audio-mode`** — the `.player-container` `#000` background
  and `video { object-fit: contain }` letterbox rules must stay untouched.
- `playsinline` / `webkit-playsinline` inline playback.
- **v1.2.2 iOS background-audio** (no Media Session action handlers added/removed).
- **Lock-screen Media Session** (`setupMediaSession`) — a separate surface, untouched.
- `resolveAudioArtUrl` and the JS `.audio-mode` toggle logic are correct as-is —
  **do not touch JS or HTML.** No test changes are needed (pure CSS layering fix).

## Definition of done

- The three `style.css` changes above are made; no other file is modified.
- Overlays (resume:10, skip:6, speed:20) confirmed still above the video.
- **Lint 0** (`npm run lint`) — no new warnings beyond the existing baseline (9–11
  allowed exported-global warnings).
- **Full suite green** (`npm test`) — 241 tests, including the no-CDN and no-emoji
  guards.
- Report a summary of the exact lines changed.

## Environment (IMPORTANT)

Before ANY `npm`/`node` command, run:

```
export PATH="/home/coder/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"
```

(fnm is not auto-sourced in this shell.)

Commands:
- Lint: `npm run lint`
- Test: `npm test` (full) / `npm run test:unit` (fast subset)

Branch/commit/push is coordinator-owned (target branch `fix/audio-mode-controls`,
release v1.10.1) — you do not run git. Just make the change and verify it's green.
