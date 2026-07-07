# Software Developer inbox — T4 (FR-3: rescan pending-transcode list, bounded) — BLOCKED ON T2

Feature: **v1.18.0 "iOS playability + player polish"** (feature_id
`v1.18-ios-playability`), branch `feature/v1.18-ios-playability` off `main`
(v1.17.1). This is **Task T4**.

**⛔ DO NOT START until T2 is done and verified.** Two reasons:
1. **Dependency:** T4 must consume T2's generalized, codec-aware
   `needsTranscode`/`transcodeStatus` — the pending-transcode list must be the
   SAME detection path, not a second, divergent one.
2. **File overlap:** T4 edits `server.js`, which T2 also edits. The working tree
   is SHARED — you cannot run concurrently with T2. Start only after the
   coordinator confirms T2 is merged/verified.

Your file set is `server.js` + `public/js/setup.js` (+ tests). Do **not** touch
`lib/ytdlp/args.js` (T1) or `public/js/player.js` (T3).

**Review tier: LIGHTER single-QA no-regression** — the payload-bounding gets
focused attention. Light Dean visual/legibility check on the Setup page (mobile
included).

## Read first (grounding)

- `.state/feature-state.json` — the `tasks` entry `"id": "T4"` is the
  authoritative scope; also read `hard_constraints`. Confirm T2's helpers
  (`needsTranscode` generalized signature, `videoCodec`/`audioCodec` on items)
  have landed in `server.js` before you start.
- `docs/exec-plans/active/2026-07-07-v1.18-ios-playability.md` — read **`## Design`
  → the `GET /api/scan-status` (FR-3) and `pollScanStatus` (FR-3) component
  bullets**, the FR-3 acceptance criteria, and `### Data model changes` /
  `### API changes` for the exact payload shape.
- `docs/CONTRIBUTING.md` (`textContent` not `innerHTML` for user-controlled
  strings) and `docs/RELIABILITY.md`.
- `server.js` — `GET /api/scan-status` (~1675-1688, the existing `transcoding`
  count filter), and the now-generalized `needsTranscode`/`transcodeStatus` T2
  produced.
- `public/js/setup.js` — `pollScanStatus` (~294-335, the existing
  `if (s.transcoding > 0)` block in both the in-progress and "Scan complete"
  branches, rendering via `statusText.textContent`).

## Task — implement THIS ONE task only (FR-3)

**server.js — `GET /api/scan-status`:** derive the pending set from the **SAME
filter** that already produces `transcoding`:
`pending = items.filter(i => i.needsTranscode && i.transcodeStatus &&
i.transcodeStatus !== 'ready' && i.transcodeStatus !== 'failed')`. Add to the
JSON response:
- `transcodeNames` — the first `TRANSCODE_LIST_CAP` items' `title || name`, a
  bounded `string[]`.
- `transcodeOverflow` — `Math.max(0, transcoding - transcodeNames.length)`.
- Keep the existing `transcoding` count for backward compatibility.
- `const TRANSCODE_LIST_CAP = 10;` (fork #6 — bounded, small payload).

**public/js/setup.js — `pollScanStatus`:** extend the existing
`if (s.transcoding > 0)` block (in **both** the in-progress and "Scan complete"
branches) to append the names: `` `: ${s.transcodeNames.join(', ')}` `` plus,
when `s.transcodeOverflow > 0`, `` ` +${s.transcodeOverflow} more` ``. The whole
message continues to be assigned via `statusText.textContent` (**never**
`innerHTML` — user-controlled filenames/titles must be safe by construction). The
empty-set case renders nothing new (the existing `> 0` guard already suppresses
"Converting 0 file(s)"). **No new HTML element, no new CSS** (the message stays on
the existing `#scan-status` line, era-theme tokens untouched).

## Hard constraints (non-negotiable)

- The list MUST be derived from T2's SAME generalized codec-aware
  `needsTranscode`/`transcodeStatus` logic — NOT a second, divergent detection
  path. A codec-flagged HEVC `.mp4` must appear in the list exactly like a legacy
  `.avi` would.
- Payload is **bounded** (cap 10 + overflow count) — never an unbounded names
  array.
- `textContent`, never `innerHTML`, for the rendered names.
- Empty set renders nothing new (no "Converting 0 file(s)").
- No new runtime dependencies. 2-space/semicolons/single-quotes. Lint 0 warnings.

## Tests

- **Integration** (`test/integration`): `GET /api/scan-status` returns
  `transcodeNames` (capped at 10) + `transcodeOverflow` for a fixture DB with a
  MIX of flagged/unflagged items **including a codec-flagged HEVC `.mp4`** (proves
  it rides T2's codec-aware detection, not a separate path). Verify the cap +
  overflow arithmetic when >10 items are pending.
- **Unit/guard**: the empty pending-transcode set renders no misleading
  "Converting 0 file(s)…" message (extends the existing `if (s.transcoding > 0)`
  guard to the new list).

## Toolchain / commands

Node 22 standard. Export the fnm node PATH first, then use the Node 22 test bin:

- `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`

Run `npm run lint` (0 warnings) and `npm test` (green on Node 22). Fix any
failure before reporting done.

## Git — DO NOT commit

The **coordinator (EM) owns ALL git**. Do NOT stage, commit, or push. Report
files changed + full lint/test output; the coordinator commits per task.

## Report back

- Files changed (paths + one-line summary each) and the exact response fields
  added.
- Confirmation the list reuses T2's generalized `needsTranscode`/`transcodeStatus`
  (same filter, no divergent path) and is bounded at `TRANSCODE_LIST_CAP = 10`.
- Confirmation rendering uses `textContent` (not `innerHTML`) and the empty-set
  guard holds.
- Lint + Node 22 test result.
- Any deviation from the design or new fork (with a recommendation) — do NOT
  expand scope into other FRs' files.
