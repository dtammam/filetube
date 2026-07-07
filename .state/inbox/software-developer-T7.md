# Software Developer inbox — T7 (FR-8 subscription default 25 -> 3)

Feature: **v1.17.0 "Polish"** (feature_id `v1.17-polish`), branch
`feature/v1.17-polish` off `main` (v1.16.0). This is **Task T7**. It runs in
**parallel** with T1/T2/T3/T5/T6 and is fully isolated to `lib/ytdlp/` — it
shares no files with the client-side tasks.

Review tier: **TWO-REVIEWER GATE** — the yt-dlp `maxVideos` bounds/validation
must not loosen; confirm nothing beyond the default constant changes.

## Read first

- `.state/feature-state.json` — the `tasks` entry `"id": "T7"` is authoritative;
  read `hard_constraints` (FR-8 item — new-subscription default ONLY; no
  retroactive change to persisted subscriptions; `0`=unlimited and the ENV
  contract unchanged).
- `docs/exec-plans/active/2026-07-06-v1.17-polish.md` — read **`## Design` →
  `### FR-8 — Subscription default 25 -> 3`** in full, plus FR-8 ACs.
- `docs/CONTRIBUTING.md`.
- Code: `lib/ytdlp/config.js` — `DEFAULT_MAX_VIDEOS = 25` (~39) and the adjacent
  "25 was chosen" comment (~36-38); `parseMaxVideos` (~91-96), the `0`=unlimited
  semantics, the non-negative-integer validation, and the
  `FILETUBE_YTDLP_MAX_VIDEOS` ENV fallback. `lib/ytdlp/views/subscriptions.html` —
  the `sub-add-maxvideos` field placeholder ("Max videos (blank=default,
  0=unlimited)"). The existing `parseMaxVideos` fallback-to-default unit tests.

## Task — implement THIS ONE task only (FR-8)

1. In `lib/ytdlp/config.js` change `DEFAULT_MAX_VIDEOS = 25` to `3` and update the
   adjacent "25 was chosen" comment to reflect the new default.
2. **Nothing else moves:** `parseMaxVideos`, the `0`=unlimited semantics, the
   non-negative-integer validation, and the `FILETUBE_YTDLP_MAX_VIDEOS` ENV
   fallback contract stay exactly as they are. The constant is the single knob
   backing both the blank-field UI default and the ENV fallback, so this one edit
   satisfies "a fresh subscribe grabs the last 3."
3. **No migration/backfill** — existing persisted subscriptions keep their stored
   `maxVideos`. Do NOT touch any `db.ytdlp` records.
4. Update the `parseMaxVideos` fallback-to-default unit tests to assert `3`.
5. Optional (cosmetic, not blocking): refresh the `sub-add-maxvideos` placeholder
   hint in `lib/ytdlp/views/subscriptions.html` to read sensibly against the new
   default (e.g. "blank = default (3)").

## Hard constraints (non-negotiable)

- ONLY the default constant's VALUE changes; the parsing/validation/bounds
  contract and the ENV-override behavior are unchanged (nothing loosened).
- New-subscription default ONLY — no retroactive change to any persisted
  subscription's `maxVideos`; no migration/backfill.
- No new runtime dependencies. 2-space/semicolons/single-quotes; lint 0.

## Tests

- Update the existing `parseMaxVideos` fallback-to-default `node:test` unit tests
  to assert the new value `3`.
- Keep the `0`=unlimited and non-negative-integer validation tests green,
  unmodified (they must still pass to prove nothing loosened).

## Toolchain / commands

Node 22 is the standard. Before any npm/node command export the fnm node PATH,
then use the Node 22 test toolchain bin:
`/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`.
Run `npm run lint` (0 warnings) and `npm test`; fix any failure before reporting.

## Git — DO NOT commit

The **coordinator owns ALL git**. Do NOT stage, commit, or push. Report files
changed + full test/lint output; the coordinator commits per task.

## Report back

- Files changed (paths + one-line summary each): the `DEFAULT_MAX_VIDEOS`
  constant + comment, the updated fallback tests, and the optional placeholder.
- The updated + still-green unit tests + Node 22 pass/fail output; lint result.
- Explicit confirmation that bounds/validation/`0`=unlimited/ENV contract are
  unchanged and no persisted subscription was migrated.
- Any deviation from the design or new fork (with a recommendation).
