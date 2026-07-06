# Software Developer inbox — T1 (parallel track B, FR-1 foundation)

Feature: **v1.16.0 "Watch experience"** (feature_id `v1.16-watch`).
This is **Task T1**, the FR-1 architectural foundation that T2/T3/T4 mount into.
It runs in parallel with T5 (a separate, isolated server-side task — you do NOT
touch `lib/ytdlp/url.js`).

**This is a HEAVIER two-reviewer / adversarial-gated task.** Deliberate,
mechanical, reversible-per-view refactor — NOT a big-bang rewrite. Preserve every
existing behavior; the risk surface is broken deep links, back-button
regressions, scroll jumps, and listener/timer leaks.

## Read first

- `.state/feature-state.json` — the `tasks` entry `"id": "T1"` is the
  authoritative scope/done_when; also read `hard_constraints`, `cross_cutting`,
  and `node_toolchain_note`.
- `docs/exec-plans/active/2026-07-06-v1.16-watch-experience.md` — read **all of**
  the `## Design` section, especially: `### Approach`, `### Component changes`,
  `### SPA-lite navigation mechanics (FR-1)`, `### Disabled-module no-op`, and the
  **T1** entry in `## Task breakdown`. Also skim FR-1's acceptance criteria.
- `docs/CONTRIBUTING.md` (standards) and `docs/RELIABILITY.md` (testing strategy,
  no-regression posture).
- The files you refactor: `public/index.html`, `public/watch.html`,
  `public/setup.html`, `lib/ytdlp/views/subscriptions.html`,
  `public/js/common.js`, `public/js/main.js`, `public/js/watch.js`, and the
  `setup.html` inline script. Study the duplicated shell
  (`<header>`/`<aside class="sidebar">`/`<nav class="bottom-nav">`/Playlists
  sheet) and how each per-page script runs inside a `DOMContentLoaded` IIFE.

## Task — implement THIS ONE task only (FR-1 shell + router + view lifecycle)

Do NOT implement the player controller / dock state machine — that is **T2**.
T1 lands the *structure and hooks* T2 will use.

1. **Shell boundary (all four HTML pages).** Wrap each page's per-view content in
   `<div id="view-root" data-view="home|watch|setup|subscriptions">`. Keep the
   header/sidebar/bottom-nav/Playlists-sheet markup **outside** `#view-root`
   (unchanged, still duplicated per file). Outside `#view-root` also add: a
   persistent `<div id="player-dock">` (fixed corner, initially empty/hidden) and
   a single `<template id="player-host-template">` holding the **static** player
   markup — the current `#player-wrapper` subtree from `watch.html`
   (`#audio-bg-art`, `#resume-overlay`, `#transcode-overlay`,
   `<video id="media-player" ... playsinline webkit-playsinline x5-playsinline>`,
   `#speed-badge`, `#skip-controls`, `#audio-visualizer`). Add an inline
   `#player-slot` in the watch view where the full-size player mounts. All four
   shells load the core view scripts: `common.js` (router + registry), `main.js`,
   `watch.js`, `player.js` (created in T2 — load-tag it now; a stub is fine so the
   page doesn't 404), and `setup.js`; `subscriptions.js` stays **lazy-loaded**.
2. **Router + registry in `public/js/common.js`.** Add
   `FileTube.registerView(name, { init, destroy })` and the SPA-lite router: one
   delegated `document` click listener that intercepts ONLY a plain left-click
   (no modifier keys, no `target=_blank`), same-origin, whose path is one of the
   four known routes (`/`, `/index.html`, `/watch.html`, `/setup.html`,
   `/subscriptions`) including query strings (`/?root=`, `/?search=`, `/?folder=`,
   `/watch.html?v=`) — everything else (external, `/thumbnail/*`, downloads) falls
   through to a normal browser navigation. Implement `navigate(url, {replace})`:
   derive target view → `fetch(url)` → `DOMParser` → extract the new `#view-root`
   (+ `<title>`) → `currentView.destroy()` → replace the `#view-root` node →
   `newView.init(root)` → `history.pushState({ view, url, scrollY:0 }, '', url)` →
   set `document.title` → scroll handling. **Never append the fetched document's
   `<script>` tags** (view modules are already registered from the initial page's
   script tags). On `fetch`/parse failure, fall back to
   `window.location.assign(url)` so navigation never dead-ends. Add a `popstate`
   handler (re-derive the view from `location`, run the same swap without
   `pushState`, restore `history.state.scrollY`). Add the
   **progressive-enhancement boot**: on `DOMContentLoaded`, derive the current
   view from `location` and call its `init` once — the **identical** path a swap
   uses (one code path per view, no divergence). Keep the existing yt-dlp
   nav-link / one-off-button injection where it is (runs once at boot against the
   persistent shell). The T1 stub for the player transition hook (dock/keep-full/
   stay based on from→to) can be a no-op placeholder T2 fills in — but leave the
   seam.
3. **View modules.** Convert `public/js/main.js` (home), `public/js/watch.js`
   (watch), and the `setup.html` inline script (extract to new
   `public/js/setup.js`) from `DOMContentLoaded` IIFEs into registered
   `init(root)`/`destroy()` view modules. Each registers ALL its listeners through
   one per-view `AbortController` so `destroy()` removes them in a single call —
   no leaks across swaps. For `watch.js`, reduce it to the view-owned per-visit
   DOM under `#view-root` (metadata population, description toggle, related
   sidebar, comments, star rating, delete button, sidebar-folder render, search
   wiring). Replace the current `playerWrapper.innerHTML = <error>` fallback with a
   view-area error that never nukes a persistent host. **Do NOT move the player
   feature code into a controller yet** — for T1 the watch view may keep calling
   its existing player setup against the mounted host; T2 will extract `player.js`
   and take ownership. Keep `main.js` verifiably free of `document`-level
   listeners and timers (all listeners on its own `#view-root` elements) — this is
   what makes the home node safe to retain in T4.
4. **Lazy-load `public/js/subscriptions.js`** only on the first `/subscriptions`
   navigation (which can only happen when the module is enabled). Do NOT fetch it
   on a disabled install.

## Hard constraints (non-negotiable)

- **Additive / no regressions.** The resume overlay, skip controls, audio
  visualizer, related sidebar, transcode overlay, mobile-autoplay-disabled
  posture, and home sort/sidebar/search must keep working unchanged — they now
  live inside the shell you are restructuring.
- **Progressive enhancement is mandatory.** Every view URL (`/`,
  `/watch.html?v=<id>`, `/setup.html`, and `/subscriptions` when the module is
  enabled) must still render as a complete, correct **full page load** with zero
  router involvement. The SPA is strictly the enhancement layer.
- **Disabled yt-dlp no-op preserved.** The router may name `/subscriptions` in its
  known-route set, but the shell must NOT surface a subscriptions nav link /
  swappable entry when the module is disabled (the existing enabled-gate injection
  is unchanged). A hard load of `/subscriptions` when disabled still 404s
  server-side.
- **Exactly one live `<video>`.** Clone `#player-host-template` once into a single
  live host; never create a duplicate live `<video>` / duplicate id.
- **No new runtime dependencies. No framework, no bundler, no router library** —
  vanilla DOM + `history` APIs only. 2-space indent, semicolons, single quotes,
  `textContent` (not `innerHTML`) for any NEW dynamic strings. Lint 0 warnings.
- Any NEW CSS uses existing era-theme tokens (CSS custom properties) — no
  hardcoded colors that break the 2005/2009/2014/2021 eras or light/dark modes.

## Tests

Add `node:test` unit coverage for the extracted pure helpers you introduce:
route/view derivation from a URL, `history.state` (de)serialization, and
`#view-root` swap targeting. Keep the DOM-heavy behavior for Dean's on-device
pass (the arbiter for the smooth-no-reload feel + iOS Safari). All tests green on
Node 22; lint 0.

## Toolchain / commands

Node 22 is the standard. Before any npm/node command, export the node PATH:

- fnm default: `export PATH="/home/coder/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"`
- Node 22 test toolchain: `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`

Run `npm run lint` (0 warnings) and `npm test` and fix failures before reporting
done.

## Git — DO NOT commit

The coordinator owns ALL git. Do NOT stage, commit, or push. Report files changed
+ full test/lint output; the coordinator commits per task.

## Report back

- Files changed (paths + one-line summary each), noting the new `#view-root` /
  `#player-dock` / `#player-host-template` / `#player-slot` structure and the
  `player.js` load stub you left for T2.
- The unit tests added + pass/fail output on Node 22, and lint result.
- The exact seam left for T2 (the player-transition hook + host template) so the
  next SDE track picks it up cleanly.
- Any deviation from the design or new fork (with a recommendation) — do NOT
  silently expand scope into T2's player controller.
