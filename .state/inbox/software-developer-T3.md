# Software Developer inbox — T3 (FR-2: player stale-poster / FOUC reset on Next)

Feature: **v1.18.0 "iOS playability + player polish"** (feature_id
`v1.18-ios-playability`), branch `feature/v1.18-ios-playability` off `main`
(v1.17.1). This is **Task T3**. It runs **in PARALLEL with T1 and T2** — your
file set (`public/js/player.js` + any test) is DISJOINT from theirs. Do **not**
touch `lib/ytdlp/args.js` (T1), `server.js` (T2), or `public/js/setup.js` (T4).

**Review tier: LIGHTER single-QA no-regression.** Dean's **on-device iOS Safari
pass — specifically the prev/next Next-button transition — is the ARBITER** for
"feels smooth, no flash." There is NO headless-browser/E2E infra in this repo
(`docs/RELIABILITY.md`), so you cannot claim the visual fix as
`[UNIT]`/`[INTEGRATION]`.

## Read first (grounding)

- `.state/feature-state.json` — the `tasks` entry `"id": "T3"` is the
  authoritative scope; also read `hard_constraints`.
- `docs/exec-plans/active/2026-07-07-v1.18-ios-playability.md` — read **`## Design`
  → the `public/js/player.js` — `teardownMediaState()` (FR-2) component bullet**,
  the FR-2 acceptance criteria, the `### Alternatives considered` → FR-2 bullet
  (why the `#000` container background, not a new asset/CSS), and the
  `### Risks and mitigations` → the `mediaPlayer.load()` risk bullet.
- `docs/CONTRIBUTING.md` and `docs/RELIABILITY.md` (no E2E harness).
- `public/js/player.js` — `load()` (the `adopt` same-media dock↔full early-return
  vs. genuine-new-load branching), `teardownMediaState()` (~970-987, incl. the
  existing `mediaPlayer.pause()` and the audio-bg-art clear ~line 983),
  `setupForMedia()` (~989-1040, incl. the audio-branch
  `mediaPlayer.poster = '/thumbnail/' + id` at ~line 995 and where the new `src`
  is assigned).

## Task — implement THIS ONE task only (FR-2)

In `teardownMediaState()`, **after the existing `mediaPlayer.pause()`**, add a
visual reset that runs on every genuine (non-`adopt`) load, **before**
`setupForMedia` assigns the new source:

1. `mediaPlayer.removeAttribute('poster');` — clears the audio branch's
   `/thumbnail/<prevId>` poster.
2. `mediaPlayer.removeAttribute('src'); mediaPlayer.load();` — drops the
   last-decoded video frame; the element resets to the media-empty state and
   paints **nothing**, revealing the existing `#000` `.player-container`
   background (the CSS-only neutral placeholder — **no new image asset, no new
   CSS**).
3. Keep the existing audio-bg-art clear (~line 983).

`setupForMedia` then assigns the fresh `src` a few lines later, as today.

Critical correctness points:
- Use `removeAttribute('src')`, **NOT** `src = ''` (an empty string resolves to
  the page URL and triggers a spurious reload).
- This is a **media-element `load()`**, NOT a page reload.
- Do **not** touch `load()`'s `adopt`/non-adopt branching. The `adopt` (dock↔full)
  path returns early in `load()` **before** `teardownMediaState()` is ever
  called, so playback continuity is preserved untouched — verify this is still
  true after your change.

## Hard constraints (non-negotiable)

- Preserve **every** other persistent-player behavior: playback continuity across
  in-app navigation, dock↔full transitions, iOS inline playback (`playsinline`),
  Media Session lock-screen metadata/position, the resume overlay, and the
  transcode "preparing…" overlay + polling.
- No new page reload; no change to the adopt/non-adopt branch.
- No new CSS, no new image asset (the `#000` container background is the neutral
  placeholder). If you find CSS genuinely needed, STOP and flag it as a fork
  rather than editing `public/css/style.css` (that would collide with nobody this
  round, but the design explicitly says none is needed — deviating needs a note).
- No new runtime dependencies. 2-space/semicolons/single-quotes;
  `textContent` (not `innerHTML`) for any new dynamic strings. Lint 0 warnings.

## Tests

Per the design, no pure visual-reset helper is cleanly extractable from the
player IIFE, so this AC leans on the MANUAL on-device pass (documented, not a
gap). **If** your implementation happens to yield a cleanly extractable pure
helper (e.g. a state-description function), add `node:test` coverage asserting
the previous poster/frame + audio-bg-art are cleared to neutral BEFORE the new
source is assigned, for every genuine non-`adopt` load. Otherwise `npm run lint`
must be 0 warnings and `npm test` must stay green on Node 22.

## Toolchain / commands

Node 22 standard. Export the fnm node PATH first, then use the Node 22 test bin:

- `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`

Run `npm run lint` (0 warnings) and `npm test` (green on Node 22). Fix any
failure before reporting done.

## Git — DO NOT commit

The **coordinator (EM) owns ALL git**. Do NOT stage, commit, or push. Report
files changed + full lint/test output; the coordinator commits per task.

## Report back

- Files changed (paths + one-line summary each) and the exact lines added to
  `teardownMediaState()`.
- Confirmation the `adopt` path still returns before `teardownMediaState()` (no
  continuity regression) and that `removeAttribute('src')` + `load()` (not
  `src=''`) is used.
- Whether any pure helper was extractable (and tested) or the AC leans on Dean's
  on-device pass.
- Lint + Node 22 test result.
- Any deviation from the design or new fork (with a recommendation) — do NOT
  expand scope into other FRs' files or into `public/css/style.css`.
