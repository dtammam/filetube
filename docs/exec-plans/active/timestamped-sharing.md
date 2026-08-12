# Exec plan: timestamped sharing (chapter share + share-at-current-time)

Status: ACTIVE. Owner: main session. Target ~v1.110.0. Gate: FULL two-reviewer.

## Goal (Dean)

Two share additions, both producing the ORIGINAL YouTube link with a start-time
`?t=<seconds>`:
1. **Per-chapter share** - a share icon on each chapters-menu row that shares that
   chapter's YouTube link at the chapter's start time. (Dean chose the per-row
   icon over a Share-button submenu.)
2. **Share-at-current-time** - the watch-page Share button PROMPTS "Share video"
   vs "Share at current time" (the current playback position as `?t=`).

Both apply ONLY to YouTube-derived items - the ones that already have a
`mediaData.watchUrl` (server-resolved via `buildWatchUrl`) and therefore already
show a Share button / card share. Local files have no watchUrl and get neither.

## The URL discipline (v1.52 lesson)

The YouTube URL IDENTITY is server-resolved (`watchUrl`) and must NEVER be
assembled client-side. Adding a `t=` QUERY PARAM to that already-resolved URL is a
mechanical modification, not identity assembly - done with the platform `URL`
parser (`new URL(watchUrl)` -> `searchParams.set('t', ...)`), never string
concatenation. This is a pure, unit-tested helper. If `watchUrl` is absent or
unparseable, the share falls back to the plain link (never a broken URL).

## T1 - the pure helper `withShareStartTime(url, seconds)` (common.js, exported)

- Returns `url` with `t=<Math.floor(seconds)>` set via `new URL().searchParams`.
- Returns `url` UNCHANGED when: url is not a non-empty string; seconds is not a
  finite number > 0 (0/negative/NaN -> the plain link); `new URL(url)` throws.
- Handles both shapes: `https://youtu.be/ID?t=90` and
  `https://www.youtube.com/watch?v=ID&t=90`, preserves existing params (`&list=`),
  overwrites any pre-existing `t`.
- Exported via common.js module.exports for unit tests (youtu.be, watch?v=,
  existing-params, t-overwrite, 0/neg/NaN seconds, non-string, unparseable).

## T2 - share-at-current-time (watch.js + player API + a reusable choice modal)

- `player.getCurrentTime()` added to `window.FileTube.player`: returns
  `mediaPlayer.currentTime` for a loaded NON-live item, else `null` (a live
  offset is not a shareable VOD timestamp; null hides the option).
- `showChoiceModal(title, choices)` added to common.js: a `.modal-backdrop >
  .modal-content` (reuses the modal infra + openOverlay) rendering a stacked
  button per `choices[]={label, onPick}` plus Cancel. Built with createElement +
  textContent (NO innerHTML for labels - media/chapter titles are untrusted).
- watch.js `handleShareClick`: if `getCurrentTime()` returns a time >= 1s, open
  the choice modal - "Share video" (plain watchUrl) / "Share at current time
  (M:SS)" (withShareStartTime). Under 1s or null (live / not ready) -> the current
  direct plain-link share (no prompt for a pointless 0:00). Each choice routes
  through the SAME shareExternalUrl + the existing "Copied!" feedback.

## T3 - per-chapter share (player.js chapters menu)

- In buildChaptersMenu, each row gets a `.chapters-menu-share` icon button
  (icon-share) AFTER the Loop button, rendered ONLY when `currentData.watchUrl`
  is a non-empty string (YouTube-derived). Tapping it (stopPropagation, never
  seeks) calls `shareExternalUrl(withShareStartTime(currentData.watchUrl,
  ch.startTime), currentData.title)`.
- CSS `.chapters-menu-share` mirrors `.chapters-menu-loop` (fixed tap target on
  mobile, left border, icon-only). Verify the 3-control row (title/seek + loop +
  share) doesn't overflow the mobile 44px row - the title flex-shrinks/ellipsizes
  (measure, don't guess).
- currentData.watchUrl is present because watch.js spreads the full mediaData into
  `player.load(id, {...mediaData}, ...)`; absent on the seed/early load, so the
  icon simply doesn't render until the full load - acceptable (no share on a
  half-loaded item).

## Cross-cutting / invariants

- Census TOTAL 0 (icon/colors/spacing via tokens); ledger CLEAN; eslint 0 errors.
- XSS: the choice modal + any title use textContent, never innerHTML.
- Testing (repo convention): the PURE helper unit-tested (withShareStartTime);
  the DOM wiring source-locked (getCurrentTime shape, the prompt gate >= 1s + live
  null, the per-chapter icon gated on watchUrl + its share call, showChoiceModal
  textContent). No player-boot jsdom.
- Reveal/teardown: the choice modal tears down on pick/cancel/backdrop (reuse the
  modal close path); no leaked modal across navigation.

## Task order

T1 helper+tests -> T2 prompt -> T3 per-chapter share -> FULL two-reviewer gate
(adversarial briefed on: the URL-discipline/param-append correctness + XSS in the
modal + the live/0s gating + the mobile 3-control row) -> dual-Node -> release,
device pass pending.

## Dean's device probes
A downloaded YouTube video WITH chapters: (1) each chapter row has a share icon ->
tap -> share sheet with `youtu.be/ID?t=<chapter start>`; (2) tap the main Share
button mid-video -> prompt -> "Share at current time (M:SS)" shares `?t=<now>`,
"Share video" shares the plain link; (3) a local (non-YouTube) file -> no share
icons, Share button unchanged/absent; (4) verify the shared link opens YouTube at
the right second.
