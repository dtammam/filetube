# Exec plan: per-channel subscription duration window (min + max, in minutes)

Status: ACTIVE (started 2026-09-11)
Owner: main session (lean mode)
Wave: feat/subscription-duration-window

## Goal (Dean's intake, locked)

A subscription can restrict downloads to a duration WINDOW: only pull items whose length is
between a per-channel **minimum** and **maximum**. A channel that posts 45-min episodes plus
2-3 min teaser clips can say "10-75 min" and get the episodes while the teasers (and a stray
6-hour stream) are never fetched.

Locked decisions (AskUserQuestion, 2026-09-11):
1. **Unknown-length items are EXCLUDED** when a min or max is set (strict operators, no `?`
   "match-if-absent" suffix) - consistent with the existing max cap, which already excludes
   unknowns so a capped channel never records an unbounded live stream.
2. **Future pulls only.** This is a download gate exactly like the existing cap; files already
   on disk are untouched.
3. **Per-channel only.** No global minimum in Settings this wave (the global MAX already exists).
   The per-channel max continues to override the global max; the per-channel min has no global.
4. **Minutes in the UI**, stored as SECONDS. Both the min and the (existing) max fields present
   minutes; the existing max field is CONVERTED from its current raw-seconds presentation.

## Current state (measured, not assumed)

The MAX already exists end-to-end, in raw SECONDS:
- `lib/ytdlp/store.js` (24 `maxDurationSeconds` refs): `MAX_SUB_MAX_DURATION_SECONDS = 86400`,
  `validateMaxDurationSeconds` (~235), wired into `validateSubscriptionInput` (add, ~368-405)
  and `validateSubscriptionPatch` (update, ~454-458). `0`/unset = fall back to global; the
  server routes (`lib/ytdlp/index.js` ~5514/5588) delegate field extraction to these validators
  (an explicit whitelist - so the store is the SINGLE integration point, no route change needed).
- `lib/ytdlp/args.js` (15 refs): `buildDurationClause(max)` -> `duration < N` (~572);
  `buildMatchFilterArg({skipShorts, maxDurationSeconds})` AND-joins the clauses into ONE
  `--match-filter` with ` & ` (~588); effective resolution `subMax ?? config.max` (~959),
  passed at ~1007. yt-dlp OR's multiple `--match-filter` flags, so combining is MANDATORY (the
  comment at ~545 documents this - do not emit a second `--match-filter`).
- `lib/ytdlp/client/subscriptions.js` (5 refs, eslint-covered vanilla-browser): the add/edit
  sheet's `maxDurationInput` (number, seconds, ~2886-2891); the PATCH builder (~2974); the ADD
  body builder (~4254).

`minDurationSeconds`: 0 occurrences today (confirmed absent).

## Design

MIN mirrors MAX, minus the global tier (per-channel only):
- New `MIN_...`/reuse the same 0..86400 bound; `validateMinDurationSeconds` mirrors
  `validateMaxDurationSeconds` (non-negative integer <= cap; `0`/unset = no min).
- **Cross-field guard**: when BOTH a per-sub min and a per-sub max are set, require
  `min <= max` (else the window is empty and the channel silently downloads nothing). Enforce in
  the store validators (add + patch), returning a clear error. The global max is NOT consulted
  here (it can change independently); the guard binds only the two per-sub values.
- Args: `buildDurationClause` gains a min form (or a sibling) emitting `duration >= N` (strict,
  no `?`); `buildMatchFilterArg` accepts `minDurationSeconds` and pushes the clause into the SAME
  combined `--match-filter`. Effective min = `sub.minDurationSeconds` only (no global fallback).
- UI: add a `minDurationInput` to the sheet; convert BOTH fields to MINUTES (input minutes ->
  x60 seconds for the body/patch; display existing `seconds/60`, rounded, on open). A pure
  `minutesInputToSeconds` / `secondsToMinutesInput` helper pair (exported for node:test).

Residual (disclosed): a legacy `maxDurationSeconds` not divisible by 60 shows a rounded minute
value on edit; saving re-stores `roundedMinutes*60`. Dean sets whole minutes, so this only
touches odd pre-existing values. Recorded here, not a blocker.

## Task commits (each green before the next)

- **T1 - store**: `validateMinDurationSeconds` + add/patch wiring + the `min <= max` cross-guard.
  Tests: valid/invalid min; min>max rejected in BOTH add and patch; min omitted = no min; the
  max path unchanged (regression). PREDICT: `minDurationSeconds` in store.js reaches ~20-24 refs
  (mirrors max minus any global-only lines).
- **T2 - args**: the `duration >= N` clause + `buildMatchFilterArg` min param + effective
  resolution + the passthrough at the build site. Tests: min-only, max-only, BOTH (one combined
  `--match-filter`, ` & `-joined, order stable), unknown-duration excluded (strict `>=`, no `?`),
  min=0/unset omits the clause. REACHABILITY: assert the combined arg string is what a real spawn
  would receive (bind the SINGLE `--match-filter`, not a second flag).
- **T3 - client UI**: `minDurationInput` + minutes conversion for both fields + PATCH/ADD
  wiring + the exported converter helpers. Tests (node:test against the fake DOM + the pure
  converters): min field present + labelled minutes; existing sub's min/max pre-filled in
  minutes; blank = unchanged; 0 = off; the body/patch carry SECONDS.
- **T4 - integration + docs**: full `npm test`; ROADMAP + ledger + move this plan to completed/.

## Gate brief (FULL gate - silent-starvation risk)

This is a download FILTER: a wrong min clause, an inverted operator, or a min>max slip makes a
subscription **download NOTHING silently** (the starvation class this repo has paid for). Brief
the adversarial seat to MAKE a subscription fetch nothing and to prove the min clause is
EFFECTIVE (not silently inert - drive the real yt-dlp arg shape, verify `>=` against yt-dlp's
match-filter grammar, confirm the three clauses stay ONE `--match-filter`). Named surfaces:
the AND-join (never a second `--match-filter`), unknown-duration exclusion, the min<=max guard on
BOTH add and patch, the minutes<->seconds conversion round-trip (no drift that shifts the window).

## Machine-derived predictions (the tools re-verify at each commit)

Baseline `maxDurationSeconds` refs (the mirror map): store.js 24, args.js 15,
client/subscriptions.js 5. `minDurationSeconds` starts at 0. Each task states its expected delta
and the commit re-counts; a divergence is a missed site (the persist-gate / enumerate-every-writer
discipline).
