# Focused adversarial re-gate — v1.29 GF2 (failures.js F1 re-fix ONLY)

You are the **adversarial reviewer**, running a **FOCUSED re-gate on the GF2
delta only** — the F1 re-fix in `lib/ytdlp/failures.js` (plus its two test
files). This is NOT a full wave re-review, and NOT a re-review of F2/F3/main.js
(those are APPROVED-FINAL from the prior delta re-gate — do not revisit them).

Last round you found the CRITICAL: GF1's dedup-by-reason collapsed byte-identical
templated stderr (429/age-gate) across distinct videos into phantom successes.
GF2 removes the dedup and reworks the classifier. Your job: confirm the CRITICAL
is truly closed and try to find any NEW misclassification the rework introduces.
Hostile posture, concrete scenarios, not style.

Do NOT modify code, tests, or state. Do NOT commit. Report per-attack: hypothesis
→ concrete input to `computeDownloadOutcome` → expected vs actual → REPRODUCES?
(file:line) → severity. Verdict: **APPROVE / REQUEST CHANGES / NEEDS DISCUSSION**.
Your independent APPROVE clears F1 for acceptance (QA already APPROVED the wave;
F2/F3/main.js already APPROVED).

## Scope — the GF2 delta ONLY
`lib/ytdlp/failures.js` (`computeDownloadOutcome`), `test/unit/ytdlp-download-
outcome.test.js`, `test/integration/ytdlp-outcome-threading.test.js`. Diff vs the
GF1 state.

## The new logic (verify it, then attack it)
- reason-dedup REMOVED; **raw unattributed count** used.
- **zero-attributed override checked FIRST:** `attributed.size === 0` with any
  unattributed failures → `error` (`succeeded:0`, `failed:target`). No reserve.
- **reserve-at-least-one only when `attributed.size >= 1`:**
  `contribution = rawUnattributed > 0 ? max(1, min(rawUnattributed,
  remainingAfterAttributed - 1)) : 0`, `remainingAfterAttributed = target -
  attributed.size`.
- **SDE-FLAGGED addition (probe this specifically):** a new
  `remainingAfterAttributed > 0` guard added beyond Dean's literal formula to
  prevent `failed > target`. Judge whether it is correct and whether it can itself
  cause a misclassification in either direction.

## Attacks to construct (concrete `computeDownloadOutcome` inputs)

1. **CRITICAL closed?** 5 targets, 5 unattributed failures with the SAME reason
   (429 text), 0 attributed → MUST be `error`/`succeeded:0` (not `failed:1/
   succeeded:4`). Try variants: N identical-reason unattributed across N targets;
   mixed identical + distinct reasons; a single attributed + many identical-reason
   unattributed.
2. **Direction-A leaks (phantom success):** find ANY input where the classifier
   credits a `succeeded` for a target that has no evidence of success — e.g.
   attributed boundary present but the reserve bound leaves a phantom success when
   all targets actually failed; `remainingAfterAttributed - 1` arithmetic
   crediting a success that shouldn't exist; raw count under-counting via any
   remaining path.
3. **Direction-B regressions (false whole-channel error):** confirm the fix
   didn't over-correct — a genuine partial (attributed boundary + some real
   successes) must still be `partial` with honest counts; the 9/10 case and
   1-attributed+unattributed cases must not flip to `error`.
4. **The `remainingAfterAttributed > 0` guard:** attack boundary values —
   `attributed.size === target` (remaining 0), `attributed.size === target - 1`
   (remaining 1, so `remaining - 1 === 0`), `attributed.size > target` (can that
   happen? attributed ids not in targetIds?), `target === 0`, empty/duplicate
   attributed ids, unattributed present with remaining 0/1. Does the guard ever
   under- or over-count `failed`? Does `failed` ever exceed `target` or go
   negative? Does `succeeded` ever go negative or exceed `target`?
5. **Exhaustiveness/disjointness:** re-derive that every input lands in exactly
   one arm (success/partial/error) with no undefined/ambiguous case; probe
   `ok:true` with failures present, non-array inputs, malformed failure entries,
   `videoId` empty-string vs null vs whitespace, huge counts.
6. **Cutoff-freeze consequence:** confirm that because all-unattributed and
   all-failed now classify as `error` (not `partial`), the `index.js` cutoff gate
   does NOT advance for them (cutoff frozen → Retry re-lists the same window).
   (You may reason from the classification + the known cutoff gate;
   `computeDownloadOutcome`'s outcome is the input to that gate.)

## Honest-scoring (thumbnail-backfill lesson)
Score on merit. A reintroduced phantom-success (Direction-A) is CRITICAL. A false
whole-channel-error (Direction-B) is a real WARNING+. Only report what you can
construct an input for; label unproven suspicions as such. If the
`remainingAfterAttributed>0` guard needs Dean's judgment, NEEDS DISCUSSION with a
crisp framing.

## Deliverable
Per-attack findings (file:line, severity); explicit statements that (a) the
5-same-429 CRITICAL is closed, (b) no NEW Direction-A phantom success exists, (c)
the `remainingAfterAttributed>0` guard is sound, (d) genuine partials still count
correctly, (e) cutoff-freeze holds; verdict APPROVE / REQUEST CHANGES / NEEDS
DISCUSSION. Do NOT modify code or commit.
