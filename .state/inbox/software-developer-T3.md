# Software Developer inbox — T3 (v1.20 FR-1 toggle + compact options modal + FR-3 hide)

Feature: **v1.20.0 "Subscribe button — real subscriptions from downloads"**
(feature_id `v1.20-subscribe`), branch `feature/v1.20-subscribe` (off `main` at
v1.19.1). This file **supersedes any prior-feature content**. This is **Task T3**.
Wave **3** — runs ALONE, LAST. **Depends on T1 AND T2 AND T4.** Do not start until
the coordinator confirms T2 and T4 are both done/verified (you edit
`public/js/common.js` after T2, and `lib/ytdlp/index.js` + `public/css/style.css`
after T4 — shared working tree, no concurrent edits).

**Review tier: TWO-REVIEWER GATE** (quality-assurance + a separate adversarial
`/code-review`). The watch page becomes a new caller into the spawn-guarded
subscription create/delete system; you must prove no new path bypasses
`store.validateSubscriptionInput` → `url.validateChannelUrl`.

## Environment

- **Node 22 toolchain bin** (prepend to PATH before any npm/node command):
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- Use absolute paths (cwd resets between bash calls).

## Git — DO NOT commit

The **coordinator (EM) owns ALL git.** Do NOT `git add`/`commit`/`branch`/
`stash`/`push`. Report files changed + full `npm run lint` (0 warnings) and
`npm test` output under Node 22; fix any failure before reporting done.

## Read first (you share NO memory with the EM)

- `docs/exec-plans/active/2026-07-08-v1.20-subscribe.md` — read the **## Design**
  sections **"FR-1 — subscribe toggle + compact options modal"** and **"FR-3 —
  hide when no channel / module disabled"**, plus the T3 bullet in **## Task
  breakdown**. Implement to that design.
- `.state/feature-state.json` — the `tasks[]` entry `"id":"T3"` and
  `hard_constraints` (validator routing, era-theme, select-sizing/full-teardown
  reuse, `textContent`).
- `docs/CONTRIBUTING.md` (vanilla DOM, `textContent` not `innerHTML` for dynamic
  strings, 2-space, semicolons, single-quotes, `node:test`, lint 0, no new deps)
  and `docs/RELIABILITY.md` (no headless-browser/E2E — modal UX leans on Dean's
  on-device pass as the documented arbiter; everything else is unit/integration).
- T2's helpers already in `public/js/common.js`: `resolveFileChannelIdentity`,
  `channelIdentityMatches`, `canonicalizeChannelUrl`, extended `resolveChannelName`.
- Live code: `public/js/common.js` — the one-off modal primitives you REUSE:
  `.oneoff-modal-backdrop`/`.oneoff-modal` CSS (carries the v1.17.0 FR-6
  full-teardown + v1.19.0 `flex:0 0 auto` select-sizing fixes), `buildOneOffModal`,
  `buildOneOffSelect`, `ONEOFF_FORMAT_OPTIONS`, `ONEOFF_QUALITY_OPTIONS`,
  `ONEOFF_FILETYPE_OPTIONS`, `reduceOneOffFiletypeOptions`/
  `repopulateOneOffFiletypeSelect`. `public/js/watch.js` — `populateMetadata`,
  the `resolveChannelName` call site. `public/watch.html` — `#subscribe-btn-mock`
  (currently cosmetic, no handler). `lib/ytdlp/index.js` — the gated
  `GET /api/subscriptions/health` handler and `config` in scope.

## Task — implement THIS ONE task only (FR-1 + FR-3)

1. **`shouldShowSubscribeButton({ moduleEnabled, channelIdentity })`
   (`common.js`, pure, `node:test`).** `true` iff `moduleEnabled === true` AND
   `channelIdentity` non-null; else the button is REMOVED from the DOM
   (`.remove()`, absent — not greyed).
2. **`buildSubscribeModal(doc, opts, handlers)` (`common.js`).** Mirror
   `buildOneOffModal`'s structure and REUSE its primitives (`.oneoff-modal-*`
   CSS + the ONEOFF option builders/reducer above — NO dependency on the gated
   `/js/subscriptions.js`). Contents:
   - READ-ONLY channel identity: `channelName` + `channelUrl`, both via
     `textContent` (never an editable field).
   - type (`format`) select pre-filled from `mediaData.type`; quality select
     pre-filled `'best'`; filetype select (format-coupled via the shared
     reducer); a "download last N" number input pre-filled from
     `defaultMaxVideos` (read from `GET /api/subscriptions/health`, fallback `2`);
     a skip-Shorts checkbox default off; Subscribe + Cancel buttons.
3. **`defaultMaxVideos` on `/health` (`lib/ytdlp/index.js`).** The gated
   `GET /api/subscriptions/health` body gains
   `defaultMaxVideos: config.DEFAULT_MAX_VIDEOS` (single server-side source; no
   second hardcoded literal). This lands AFTER T4's `index.js` edit — additive.
4. **Wiring (`public/js/watch.js`).** In `populateMetadata`, compute
   `identity = resolveFileChannelIdentity(mediaData)`; probe
   `GET /api/subscriptions/health` (200 → module enabled; 404 → disabled); apply
   `shouldShowSubscribeButton` — remove `#subscribe-btn-mock` when false. When
   shown, `GET /api/subscriptions`, find the matching sub via
   `channelIdentityMatches(identity, sub.channelUrl)`, render "Subscribe" vs.
   "Subscribed", and hold the matched `sub.id`.
   - **Subscribe (not subscribed):** open `buildSubscribeModal`. Confirm →
     `POST /api/subscriptions` with `{ channelUrl: identity.channelUrl, format,
     quality, maxVideos, skipShorts, filetype }` through the EXISTING, UNMODIFIED
     `store.validateSubscriptionInput` → `url.validateChannelUrl` (no bypass). On
     success: full-teardown the modal, flip to "Subscribed", record new sub id.
     Cancel / backdrop / `[x]` / Esc → the shared full-teardown
     (`backdrop.remove()` + null state), NO POST.
   - **Unsubscribe (subscribed):** direct one-tap `DELETE /api/subscriptions/:id`
     for the matched id; flip back to "Subscribe". NO modal.
5. **`public/watch.html`.** Keep `#subscribe-btn-mock`, default `hidden`.
6. **`public/css/style.css`.** Add ONLY a small read-only channel-identity block
   style (era-theme tokens only, no hardcoded colors). Reuse `.oneoff-modal-*`
   for the modal chrome — do not reimplement it.

## Tests to add

- **Unit** (`test/unit/`): `shouldShowSubscribeButton` truth table; the button
  state derivation (matching identity vs sub list → Subscribe/Subscribed via the
  T2 matcher); `buildSubscribeModal` build (pre-fills, read-only identity via
  `textContent`, format↔filetype coupling via the shared reducer) and its
  full-teardown (backdrop detached, state nulled, no leaked listeners).
- **Integration** (`test/integration/`): confirm → `POST /api/subscriptions`
  routes through `validateSubscriptionInput`/`validateChannelUrl`; cancel/backdrop
  → NO POST; subscribed → `DELETE /api/subscriptions/:id`; disabled-module
  (health 404) → button absent regardless of metadata.

## Hard constraints

- TWO-REVIEWER GATE. The modal creates subscriptions ONLY via
  `POST /api/subscriptions` → the UNMODIFIED validators; no new code constructs a
  subscription record or spawn argv from an unvalidated string. Do NOT modify any
  validator or host allowlist.
- `textContent` (never `innerHTML`) for creator name / channel URL / any error
  text. Era-theme CSS custom properties only. Reuse the v1.17.0 full-teardown +
  v1.19.0 select-sizing patterns (do not reintroduce the stuck-overlay or
  oversized-mobile-select bugs). No new npm deps. Lint 0 warnings.
- Disabled-module byte-identical: button/modal require the 200 health probe; no
  new always-present DOM or route.
- Your files: `public/js/common.js`, `public/js/watch.js`, `public/watch.html`,
  `public/css/style.css`, `lib/ytdlp/index.js` (+ tests). Do NOT touch
  `lib/ytdlp/client/subscriptions.js`, `lib/ytdlp/{args,run,store,config}.js`, or
  `server.js`. Merge your `common.js` / `index.js` / `style.css` edits ON TOP of
  T2's and T4's already-landed changes (do not revert them).

## Report back

Files changed (path + one-line each); the modal contents + the confirm→POST /
unsubscribe→DELETE wiring; a "no validator bypass" checklist (every channel URL
still passes `validateSubscriptionInput`/`validateChannelUrl`); which ACs lean on
Dean's on-device pass vs are unit/integration-covered; lint + Node 22 test
result; any deviation/new fork with a recommendation.
