# Software Developer — GATE FIX MICRO-ROUND 3 (GF3): doc-vs-code fix (W1) + subset filter (S1)

You are the Software Developer for the **v1.29 Downloads Reliability Wave**.
GF2's focused adversarial re-gate confirmed the CRITICAL is CLOSED and the
classifier sound, but returned **NEEDS DISCUSSION** with two small findings.
Dean resolved both. GF3 is a MICRO-round: a doc-comment correction, a subset-
filter hardening, and two lock tests. Touch **`lib/ytdlp/failures.js` +
`test/unit/ytdlp-download-outcome.test.js` ONLY**. Run lint + tests, fix any
failures, report back. Do NOT commit. Do NOT change the classifier's behavior
except the S1 defensive filter.

## Read first
`.state/feature-state.json` → `gate_results.gf2_regate` (W1/S1 verbatim) and
`gate_results.gf3_deans_resolution`; the exec plan's AC-FM-A/B/D.

## W1 — doc-vs-code contradiction at `remainingAfterAttributed === 1` (`failures.js`)

At `remainingAfterAttributed === 1` with `rawUnattributedCount >= 1`, the bound
`Math.max(1, Math.min(raw, remaining - 1))` = `Math.max(1, Math.min(raw, 0))` =
**1**, which consumes the sole remaining slot → `error` / `succeeded:0`. The doc
comment claims "reserve-at-least-one" behavior — a **code-vs-contract
contradiction**.

**Dean's resolution: KEEP the conservative behavior (do NOT change the code's
result here)** — the unattributed line consuming the last slot is Direction-A-safe
(the consequence is one extra retry cycle with `cutoffDate` frozen, never a lost
window). **FIX the doc comment** so it states this DELIBERATELY: at
`remainingAfterAttributed === 1`, **AC-FM-D (an unattributed failure always
counts) intentionally wins over reserve-at-least-one, by design** — the function
prefers to under-credit a possible success (→ error, safe retry) rather than
credit a phantom one. Make the comment match the code exactly; no more overclaim.

**ADD a boundary-lock test:** 9 attributed failures + 1 unattributed failure /
10 targets → `error` / `succeeded:0` / `failed:10`. This pins the deliberate
remaining===1 behavior so a future refactor can't silently flip it.

## S1 — subset-filter hardening (`failures.js`)

`attributed` is currently never validated as a subset of `targetIds` inside the
pure function, so a mismatched-id / `target:0` input could produce
`failed > target` (unreachable via real callers — `knownIds` is single-sourced
from the cycle's own targets — but cheap defense-in-depth).

**Fix:** inside `computeDownloadOutcome`, filter `attributed` to **targetId-set
membership** — build a Set of `targetIds` and count only attributed videoIds that
are members. This guarantees `attributed.size <= target` and keeps the whole
function's invariant `failed <= target` under any input. Keep it pure/defensive
(no throw on odd inputs).

**ADD a test locking `failed <= target`** for the mismatched-id shape (e.g.
attributed videoIds NOT in `targetIds`, and/or `targetIds: []` / `target:0` with
failures present) — assert the result never reports `failed > target` and lands in
a valid arm.

## Constraints / scope
- Touch ONLY `lib/ytdlp/failures.js` and `test/unit/ytdlp-download-outcome.test.js`.
  Do NOT touch `ytdlp-outcome-threading.test.js` (GF2's integration expectations
  stand), `args.js`/`subscriptions.js`/`main.js`/`index.js`, or anything else.
- Do NOT change any classifier result EXCEPT what the S1 subset filter defensively
  corrects for out-of-domain inputs; every existing outcome test + the disjointness
  sweep must stay green (the 5-same-429 CRITICAL repro, all-unattributed→error,
  9/10 partial, etc. are all unchanged).
- Re-confirm the exhaustive/disjoint three-arm proof still holds after the subset
  filter (it should only tighten `attributed.size`).
- Node 22 / node:test; lint 0 errors, no new warnings. Run `npm test` +
  `npm run lint` and fix failures.
- **Toolchain PATH:** export fnm first —
  `export PATH="/home/coder/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"`
  (fallback: current dir under `/home/coder/.local/share/fnm/node-versions/`).

## Wrap-up
Report back to the orchestrator (EM): the corrected doc comment (confirming it now
matches the remaining===1 behavior), the S1 subset-filter change, the two new lock
tests, confirmation that all prior GF2 outcome tests + disjointness stay green,
and `npm test` + `npm run lint` results. Do NOT commit.

The orchestrator will route the delta to the build-specialist, then the SAME
adversarial reviewer session (which has full context) confirms the delta — not a
fresh full re-gate — then Acceptance.
