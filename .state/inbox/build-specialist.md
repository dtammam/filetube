# Build verification — v1.24 UX Round, Wave 2 (Subscriptions, T6+T7+T8)

You are the build-specialist. Wave 2 (Subscriptions) implementation is complete
on the shared working tree: T6 (subscriptions client UI), T7 (`lib/ytdlp/store.js`
order field + reorder reducer/mutator), T8 (`lib/ytdlp/index.js` poll-timing
helper + reorder/pin gated routes). Verify the build is green before the
review gate.

## Toolchain (REQUIRED — prod + CI are Node 22)
Prepend this to PATH before ANY npm/node command:
`/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
Confirm `node --version` prints v22.x before proceeding.

## Commands to run (report pass/fail + full output for any failure)
1. `npm ci` (or confirm deps already installed — no compile step, interpreted app)
2. `npm test` — full unit + integration suite via `node:test`
3. `npm run lint` — ESLint

## Baselines to check against
- **Tests:** baseline was 1735 green at the start of the round. Wave 2 adds new
  tests (T7 `reduceReorder` + order-backfill; T8 `computeNextPollDue` incl. the
  `intervalMs===0 -> null` case; pin-route/reorder-route coverage). Expect the
  count to be >= 1735 plus the new Wave 2 tests, ALL green. Report the exact
  number and any regression from the Wave 1 (v1.24.0) baseline.
- **Lint:** baseline is 0 errors + exactly 8 pre-existing `common.js`
  no-unused-vars warnings. Wave 2 must add NO new errors and NO new warnings.
  If the count changed, name the new finding and the file:line.

## Report back (to the coordinator via your final message)
- node version confirmed
- pass/fail for each command, with full output for any failure
- exact test count vs baseline; exact lint error/warning count vs baseline
- do NOT commit, tag, or push — the coordinator owns ALL git
