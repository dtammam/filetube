# Build verification — v1.29 Downloads Reliability Wave, GF2 (F1 re-fix)

You are the build-specialist. The gate-fix round **GF2** (the F1 re-fix in
`failures.js` after the delta re-gate's CRITICAL) has been implemented and self-
reported green by the software-developer. Your job is INDEPENDENT verification:
run the project's test/lint commands yourself and report pass/fail, with full
output for any failure. You do NOT fix code and you do NOT commit — you verify and
report.

## CRITICAL — toolchain / PATH (read before running anything)

node/npm are installed via **fnm** and are **NOT on PATH** by default. Before ANY
`npm`/`node` command, export the fnm node bin dir:

```
export PATH="/home/coder/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"
```

- Symptom if you skip this: `npm: command not found` or a spurious lint/test
  failure. Confirm with `node -v && npm -v` first.
- If that path is missing (the version dir can change), find the current one:
  `ls /home/coder/.local/share/fnm/node-versions/` and use its
  `.../installation/bin`.
- **Node-version CI-parity caveat:** repo targets **Node 22 LTS**; box has only
  **Node 24.14.0**. Run on 24; reiterate the standing whole-wave Node 22 pre-
  release re-run flag. State which Node you ran on.

## What GF2 changed (context, not a to-do)

- `lib/ytdlp/failures.js` ONLY — `computeDownloadOutcome` reworked: reason-dedup
  REMOVED; raw unattributed count; a zero-attributed override (→ `error`,
  `succeeded:0`, `failed:target`) checked BEFORE the reserve bound; reserve-at-
  least-one only when `attributed.size >= 1`; a new `remainingAfterAttributed > 0`
  guard prevents `failed > target`; three-arm disjointness re-derived in the doc
  comment.
- Tests updated: `test/unit/ytdlp-download-outcome.test.js` (5-same-429 →
  error/0/5; all-unattributed → error unconditionally; 1-attributed+3-same-reason-
  unattributed → partial 6/4; original 2-unattributed repro now error; 9/10
  attributed partial unaffected) and `test/integration/ytdlp-outcome-threading.test.js`
  (zero-attributed → error, NO downloadMeta for either id, cutoffDate frozen).
- SDE self-report: `npm test` 3417/3417, `npm run lint` 0 errors / 7 baseline.
  Scope = `failures.js` + 2 test files only. Nothing committed.

## Commands (from repo root, after the PATH export)

1. **Install only if needed:** `npm ci` — skip if `node_modules` present/intact;
   note whether you ran it.
2. **Lint:** `npm run lint` — PASS = 0 errors + no NEW warnings beyond the ~7-8
   baseline. Report exact counts.
3. **Full test suite:** `npm test` — report the tally + exit code. Expect **3417**
   passing. **Explicitly confirm the GF2 CRITICAL-repro test (5 videos, same 429
   text → `error`/`succeeded:0`, NOT phantom successes) and the zero-attributed →
   error override test are present and green** — they are the crux of this fix.

## Report back to the orchestrator (EM)
- Command lines + resolved `node -v`/`npm -v`; whether you ran `npm ci`; Node
  version.
- Lint pass/fail + counts; test pass/fail + tally + exit code (full output for any
  failure). Confirm the 5-same-429 CRITICAL-repro + zero-attributed-override tests
  are present and green.
- One-line verdict: **PASS** or **FAIL** (with the failing command + output).

Do NOT edit code, commit, or start other work. (Separately, the adversarial
reviewer runs a focused re-gate on the failures.js delta — not your concern here.)
