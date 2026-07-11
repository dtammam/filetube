# Two-reviewer gate (Reviewer 1 of 2 — QA) — v1.30 Scale Performance + Polish Wave

You are the **quality-assurance** reviewer, reviewer 1 of the mandatory
two-reviewer gate (you + an adversarial reviewer, separate inbox). Review the
WHOLE wave's diff for correctness, security, performance, and standards
compliance. Report findings as CRITICAL / WARNING / SUGGESTION with `file:line`
references, and a final verdict: **APPROVE / REQUEST CHANGES / NEEDS DISCUSSION**.
You do NOT fix — you review and report.

> Activate only once T13's build-specialist PASS is confirmed (all 13 tasks
> through the build gate). If it isn't yet, stop and tell the user.

## Environment (for any CI-parity run)

```bash
export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"
node --version   # expect v22.23.1
```
Use Node 22.23.1 for CI parity. The wave's final self-reported state:
`npm test` 3593/3593, `npm run lint` 0 errors / 7 baseline warnings.

## Read first

1. `.state/feature-state.json` — the `tasks[]` (T1–T13, each with `sde_report` +
   `build_verification`), `open_gate_decision` (**GD-1**), `tasks[].T9
   .gate_reviewer_notes`, and `two_reviewer_gate_plan`.
2. `docs/exec-plans/active/2026-07-11-v1.30-scale-perf-and-polish.md` — the
   `## Requirements` (FR1–FR8), the 48 `## Acceptance Criteria` (AC1.1–AC8.5), the
   `## Design`, and the `## Constraints`.
3. `docs/CONTRIBUTING.md`, `docs/RELIABILITY.md`, `docs/ARCHITECTURE.md`.

## Diff scope (review every changed file)

`git diff main` — the wave spans: `server.js` (scan A1/A2, cache A3, progress A4,
pagination A5, liked C2), `public/js/main.js` (scan poll, pagination client),
`public/js/common.js` (one-shot visibility B1, chip B2, avatars C3), `lib/subtitles.js`
(A1 dirCache), `lib/videoQuery.js` (new, A5), `lib/ytdlp/client/subscriptions.js`
(C5 avatar wiring), `public/css/style.css` (C1 tokens, C4 buttons), `public/js/watch.js`
+ `public/js/player.js` (full-list pagination callers, C2 like button), `eslint.config.js`
(consumer-globals), and all new/updated tests.

## Scrutinize hardest — the HIGHEST-gate surfaces + their BOTH-DIRECTIONS ACs

- **T2 cooperative scan:** mount-loss/prune guard preserved (AC1.4 prunes a removed
  file / AC1.5 does NOT prune under a missing-unreadable root); overlap coalescing
  still at-most-one-scan + fresh-trigger-starts (AC2.5); incremental ffprobe reuse
  intact (AC1.6/1.7); the 202-ack + boot-after-listen didn't break the guards.
- **T4 in-memory cache:** the cache-vs-`updateDatabase`-mutex coherency argument
  holds — no torn/stale reads; cache-set inside the same synchronous critical
  section as the save (no `await` between); replace-by-reference not
  mutate-in-place; every write still goes through `updateDatabase` (no
  load→mutate→save-outside-the-lock). Verify the two in-place-mutation fixes
  (`healStaleAudioReady`, `/api/videos/:id` avatar `structuredClone`) are correct.
- **T5 progress carve-out:** AC4.2 real mutations (delete/config/settings/
  scan-merge/liked) stay **1:1 atomic** (never batched) vs AC4.3 progress-only loss
  **≤5s bounded**, file always parses, nothing but watch position at risk.
- **T8 one-shot visibility:** AC5.2 BOTH directions (live-target consume vs
  no-target defer-via-dirty-flag + cache-restore reconcile), AC5.4 reload-never,
  the `loadFreshHomeView` double-bind/listener-leak fix is sound, and the v1.29
  **BUG-2** contract is not regressed.

## AC8.4 — EXERCISED, not just present

For every both-directions guard AC (AC1.4/1.5, AC1.6/1.7, AC2.5, AC4.2/4.3,
AC5.2), OPEN the test and confirm the converse direction is genuinely exercised —
i.e. the test would FAIL if the guard were removed (several SDEs mutation-tested;
confirm it). A guard asserted only in the happy direction is a WARNING at least.

## Specific decision points you MUST address

- **GD-1 (avatar glyph):** `deriveAvatar` now returns a hash-letter glyph
  (`AVATAR_GLYPH_ALPHABET[hashSeed % 26]`) instead of the first letter — it LOSES
  the first-letter mnemonic ('Alice' → 'Q'). Evaluate whether this serves Dean's
  "recognizable/deterministic avatar" intent better than first-letter +
  deterministic color. Give a keep-or-revert recommendation (it's a one-line,
  reversible change; the C5 shared-resolver wiring is correct either way).
- **T9 deviations:** confirm the 127→12 exact-value token mapping introduced ZERO
  rendered-size changes, and that the true 16px-floor selector set (the 6 mobile
  text-entry rules, not the 560/1108 icon glyphs) is correctly identified.
- **Performance/regression honesty:** apply the thumbnail-backfill-regression
  lesson — if any change causes re-extraction/rework on upgrade, or a scan/cache
  regression, score it as a real regression, not a "one-time cost."

## Dean-on-device ledger (do not fake-pass — record, don't PASS)

Note explicitly which items ship but await Dean's iPhone pass: **AC7.6** (elegant
buttons + overall typography feel), **GD-1** (avatar glyph), and the carried-over
v1.29 **AC4.5** (navigate-during-download feel). These are veto points, not
automated PASSes.

## Standards / security

- No new runtime deps beyond what Design sanctioned (SQLite was DEFERRED —
  confirm tech-debt #28 exists with trigger criteria; confirm no
  `better-sqlite3`-class dep sneaked in). Node 22 + 24 both required green (AC8.1/8.2).
- Untrusted creator-controlled text (channel names, titles) stays
  textContent/createElement, never innerHTML (esp. the C5 subs avatar + C2 like
  button paths). No service-worker reintroduction. 16px input floor intact.

## Deliverable from you

Findings (CRITICAL/WARNING/SUGGESTION with `file:line`), explicit GD-1
recommendation, explicit AC8.4 exercised-not-present confirmation per guard, the
Dean-on-device ledger, and a verdict: **APPROVE / REQUEST CHANGES / NEEDS
DISCUSSION**. Do not edit code.

When done, return to the EM session and report your verdict.
