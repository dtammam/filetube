# Software Developer inbox — T5 (v1.20 FR-5 default download count 3 -> 2)

Feature: **v1.20.0 "Subscribe button — real subscriptions from downloads"**
(feature_id `v1.20-subscribe`), branch `feature/v1.20-subscribe` (off `main` at
v1.19.1). This file **supersedes any prior-feature content**. This is **Task T5**.
Wave **1** — runs in PARALLEL with T1 (disjoint file sets). Independent, no
dependencies; can land first.

**Review tier: LIGHTER single-QA no-regression** — trivial constant change +
regression lock; exact precedent is the v1.18.0 25→3 change and its tests.

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
  section **"FR-5 — default download count 3 → 2"** and the T5 bullet in **##
  Task breakdown**.
- `.state/feature-state.json` — the `tasks[]` entry `"id":"T5"` and the FR-5
  `hard_constraints` (new subs only; `0`=unlimited, ENV override, and persisted
  subs all unaffected).
- `docs/CONTRIBUTING.md` and `docs/RELIABILITY.md`.
- Live code: `lib/ytdlp/config.js` — `DEFAULT_MAX_VIDEOS` (currently `3`) and its
  adjacent comment (which mis-cites the prior change as v1.17.0 — the real
  precedent is the v1.18.0 25→3 change); `parseMaxVideos`, the `0`=unlimited
  semantics, and the `FILETUBE_YTDLP_MAX_VIDEOS` ENV fallback (all UNCHANGED).
  The existing `parseMaxVideos` fallback-to-default unit tests.

## Task — implement THIS ONE task only (FR-5)

1. In `lib/ytdlp/config.js` change `DEFAULT_MAX_VIDEOS` from `3` to `2`.
2. Fix the adjacent comment: correct the stale `v1.17.0` precedent cite to the
   v1.18.0 25→3 change, and reflect the new `2` default.
3. **Nothing else moves:** `parseMaxVideos`, `0`=unlimited, the
   non-negative-integer validation, and the `FILETUBE_YTDLP_MAX_VIDEOS` ENV
   fallback contract stay exactly as they are. New-subscription default ONLY — no
   migration/backfill; do NOT touch any `db.ytdlp` records.

## Tests to add / update

- Update the existing `parseMaxVideos` fallback-to-default `node:test` unit tests
  to assert the new value `2`.
- Regression-lock (keep green, mirroring the v1.18.0 25→3 tests): `0`=unlimited
  still takes precedence; the `FILETUBE_YTDLP_MAX_VIDEOS` ENV override still wins;
  an already-persisted subscription's stored `maxVideos` is unaffected; new subs
  only.

## Hard constraints

- ONLY the default constant's VALUE (and its comment) changes; the parsing /
  validation / bounds contract and the ENV-override behavior are unchanged
  (nothing loosened).
- No new npm deps. 2-space/semicolons/single-quotes. Lint 0 warnings.
- Your file: `lib/ytdlp/config.js` (+ tests). Do NOT touch any other file —
  notably NOT the FR-1 modal's pre-fill (T3 reads this same constant via
  `GET /api/subscriptions/health`'s `defaultMaxVideos`, so there is no second
  literal for you to change).

## Report back

Files changed (path + one-line each): the `DEFAULT_MAX_VIDEOS` value + corrected
comment, and the updated/regression tests. Explicit confirmation that
`0`=unlimited / ENV override / persisted-subs are unchanged and no record was
migrated. Lint + Node 22 test result. Any deviation/new fork with a
recommendation.
