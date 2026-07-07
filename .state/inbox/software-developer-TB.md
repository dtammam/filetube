# SDE Task TB — FR-6: Max-duration download gate (default 2h, mirrors maxVideos)

Feature: **v1.22.0 "Player Parity + Roadmap"** — branch `feature/v1.22-player-parity`.
Exec plan (READ `## Design (FR-2..FR-10)` → the `### FR-6` subsection in full): `docs/exec-plans/active/2026-07-08-v1.22-player-parity.md`.
Standards: `docs/CONTRIBUTING.md`.

This is a **SERVER-track** task, fully disjoint from every other Wave-1 task — you
are the ONLY editor of `lib/ytdlp/{config,store,args}.js`,
`lib/ytdlp/client/subscriptions.js`, and `lib/ytdlp/views/subscriptions.html`.

## Coordinator decisions (do not reopen)
- Field unit = **SECONDS** (mirror `maxVideos` exactly). Env default
  `FILETUBE_YTDLP_MAX_DURATION_SECONDS = 7200` (2h). `0`/blank = **unbounded**
  (mirror `DEFAULT_MAX_VIDEOS`'s 0-means-unlimited — no new sentinel invented).

## Scope — mirror the `maxVideos` plumbing end-to-end

**`lib/ytdlp/config.js`:** `DEFAULT_MAX_DURATION_SECONDS = 7200`;
`parseMaxDurationSeconds(raw)` mirroring `parseMaxVideos` (`0` is a distinct valid
"unbounded" value; invalid/unset → 7200, never coerce 0 to the default); parse
`FILETUBE_YTDLP_MAX_DURATION_SECONDS` into `config.maxDurationSeconds` in
`parseYtdlpConfig`; add to `module.exports`.

**`lib/ytdlp/store.js`:** `MAX_SUB_MAX_DURATION_SECONDS` (a generous bound, e.g.
`86400` = 24h); `validateMaxDurationSeconds(value)` mirroring `validateMaxVideos`
(`undefined` = unset/fallback, `0` valid, non-integer/negative/out-of-range →
hard 400); wire it into `validateSubscriptionInput`, `validateSubscriptionPatch`,
`addSubscription`, and `updateSubscription`, storing a per-sub `maxDurationSeconds`
exactly as `maxVideos` is stored/patched.

**`lib/ytdlp/args.js`:** `effectiveMaxDurationSeconds = subMaxDurationSeconds ?? config.maxDurationSeconds`
(mirroring the `effectiveMaxVideos` line). **Filter combination (verified, not
assumed):** yt-dlp treats MULTIPLE `--match-filter` flags as **OR**; to require a
video to pass BOTH skip-Shorts AND the duration bound, they must be **AND-joined
into ONE filter string with ` & `** (`webpage_url!*=/shorts/ & duration < 7200`).
Replace the current single-clause emission with a pure `buildMatchFilterArg(clauses)`
helper: collect active clauses — `SHORTS_MATCH_FILTER` when `sub.skipShorts === true`,
and a fixed-shape `duration < <n>` when `effectiveMaxDurationSeconds > 0` — and
emit a single `['--match-filter', clauses.join(' & ')]`, or `[]` when none active.
Apply on the LIST pass (`buildYtdlpListArgs`) so an over-length item is skipped at
list time and never becomes a download target (AC45).

**Security (AC46):** `<n>` is a re-validated bounded integer interpolated into a
FIXED-shape literal (same posture as `SHORTS_MATCH_FILTER`); the whole filter is
ONE argv element passed to `spawn` (never a shell), so `&` is data, not a shell
operator.

**UI:** surface `maxDurationSeconds` (SECONDS, clear label) alongside `maxVideos`
in BOTH the v1.21 settings sheet and the add-subscription form
(`lib/ytdlp/client/subscriptions.js` + `lib/ytdlp/views/subscriptions.html`),
same input treatment as `maxVideos` (AC44).

## Tests (unit)
`parseMaxDurationSeconds` (default/0/invalid), `validateMaxDurationSeconds`
(0 valid, negative/non-integer/out-of-range rejected, undefined = fallback),
`effectiveMaxDurationSeconds`, `buildMatchFilterArg` (both-active AND-join,
each-alone, neither → `[]`), `buildYtdlpListArgs` omit-when-0.

## Acceptance criteria owned: AC39, AC40, AC41, AC42, AC43, AC44, AC45, AC46, AC47.

## Gate & reporting
- **Gate:** two-reviewer (yt-dlp args/spawn surface).
- Do NOT modify existing validators' behavior for `maxVideos`; no new deps.
- Run Node 22 tests + lint; fix failures. **Report:** files changed, the
  `buildMatchFilterArg` output for the both-active case, test output.

---
**Toolchain:** Node 22 at `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin` — prepend to PATH. Test: `npm test`. Lint: `npm run lint`. Absolute paths.
**Git:** COORDINATOR owns ALL git. Do NOT commit. Report files-changed + test/lint output only.
