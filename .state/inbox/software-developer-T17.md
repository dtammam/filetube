# T17 — A1 FR-1 multi-site dual-validator (v1.24, Wave 6) — HEAVIEST GATE

**Cluster A · FR A1 · Gate: HEAVIEST two-reviewer ADVERSARIAL · Depends on: none**

Read at wave start, IN FULL: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
`## Design` A1 (the dual-validator shape, the 9-step `validateOneOffUrl` order,
AND "The explicit security argument for the adversarial gate") + the Constraints
section; `## Task breakdown` T17. This wave is DELIBERATELY ISOLATED to
`url.js`/`args.js` so it gets undivided adversarial review. **Re-read
`lib/ytdlp/index.js` fresh at wave start.**

## Files you own (edit ONLY these)
- `lib/ytdlp/url.js` — Wave 6-isolated.
- `lib/ytdlp/args.js`
- `lib/ytdlp/index.js` — the one-off download ROUTE only.

## Scope
- Keep `validateChannelUrl` / `ALLOWED_HOSTS` / `classifySingleVideo`
  **BYTE-FOR-BYTE UNCHANGED** (subscriptions + YouTube one-offs). A unit test
  must prove a non-YouTube host is STILL rejected for `POST /api/subscriptions`.
- Add `validateOneOffUrl(raw)` and `classifyOneOffTarget(raw)`.
  `classifyOneOffTarget` runs `validateChannelUrl` FIRST — YouTube URL → delegate
  to the EXISTING `classifySingleVideo` verbatim; only on failure fall through to
  `validateOneOffUrl` → pass the user's own normalized URL through VERBATIM (no
  id extraction, no reconstruction — so SF5 does not apply).
- `validateOneOffUrl` reuses every injection-relevant check and drops ONLY the
  two YouTube-SCOPE checks. In order: non-string/empty/`>MAX_URL_LENGTH` reject;
  embedded-URL extraction pre-step (verbatim); leading `-` reject; raw-string
  metacharacter check against `FORBIDDEN_CHARS_ONEOFF` (rejects
  `` \s \x00-\x1f \x7f ; | ` $ < > ' " ( ) { } \ `` but PERMITS URI-structural
  `& = ? #`); `new URL` parse; `http:`/`https:` only; userinfo reject (SF6);
  positive hostname-shape allowlist (`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]
  ([a-z0-9-]*[a-z0-9])?)+$` — ≥1 dot, ASCII labels, no userinfo/port tricks);
  tracking-param strip (`si`,`is`,`pp`,`feature`,`utm_*`) via `searchParams.delete`
  AFTER `new URL`, re-serialized.
- Shorts one-off: recognize `pathname` matching `^/shorts/<id>$` INSIDE
  `classifySingleVideo` for the one-off classify path only, extracting `<id>`
  through the SAME `isSafeVideoId` gate + `buildWatchUrl`. Do NOT touch
  `SHORTS_MATCH_FILTER` or the poll-loop `isShort` binding filter.
- `buildYtdlpDownloadArgs` gains `opts.targetUrl` (a single pre-validated
  absolute URL): re-validated via `validateOneOffUrl` (defense-in-depth), becomes
  the positional after `--`, add `--no-playlist` on this branch. Subscriptions
  NEVER set `opts.targetUrl` → their arg array stays byte-identical.

## Frozen cross-file contracts
- The subscription path (`validateChannelUrl`/`ALLOWED_HOSTS`/`classifySingleVideo`
  poll behavior) is provably unchanged.
- Arg-array spawn, `--` before the positional, never `shell:true`, SF4 path
  confinement, decoded-id charset (SF5) — all preserved.
- **Disabled-module no-op** for the one-off multi-site path.

## Acceptance criteria (exec-plan A1 — all 7, including the MANUAL adversarial)
- [UNIT] accepts a representative non-YouTube sample; rejects shell
  metacharacters/whitespace/control/userinfo/non-http(s)/leading-`-`/oversized.
- [UNIT] subscriptions path UNCHANGED byte-for-byte; non-YouTube host still
  rejected for subscriptions.
- [UNIT] every one-off spawn uses an arg array, URL after `--`, no `shell:true`.
- [UNIT] tracking params stripped before validation; no query-string bypass.
- [UNIT] `/shorts/<id>` accepted one-off; subscription Shorts-skip unchanged.
- [PROCESS] disabled-module no-op holds.
- [MANUAL] two-reviewer adversarial: at least one reviewer attempts to construct
  a bypass (option injection, embedded newline, encoded metacharacters per the
  SF5 decoded-charset lesson) BEFORE this wave is done.

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + 8
  pre-existing `common.js` warnings baseline — add none). Add exhaustive
  `node:test` coverage for BOTH validators + the arg-array assertions.
- **Standards:** CommonJS, 2-space/semicolons/single-quotes; NO `shell:true`
  ever; arg-array + `--` separator preserved; no new runtime deps.
- **Ownership:** edit ONLY the three files above. Need another file? STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
