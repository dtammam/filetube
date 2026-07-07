# Software Developer inbox — T1 (FR-1a: yt-dlp iOS-compatible H.264/AAC format sort)

Feature: **v1.18.0 "iOS playability + player polish"** (feature_id
`v1.18-ios-playability`), branch `feature/v1.18-ios-playability` off `main`
(v1.17.1). This is **Task T1**. It runs **in PARALLEL with T2 and T3** — your
file set (`lib/ytdlp/args.js` + its test) is DISJOINT from theirs, so there is
no working-tree conflict. Do **not** touch `server.js`, `public/js/player.js`,
or `public/js/setup.js`.

**Review tier: TWO-REVIEWER GATE** (quality-assurance agent + a separate
adversarial `/code-review`). This is the yt-dlp **arg-array spawn core** — the
gate is not because any guard is being loosened (none is) but to *prove* every
existing security guard stays byte-identical and no new injection surface is
introduced. Small diff, high sensitivity.

## Read first (grounding)

- `.state/feature-state.json` — the `tasks` entry `"id": "T1"` is the
  authoritative scope; also read `hard_constraints`.
- `docs/exec-plans/active/2026-07-07-v1.18-ios-playability.md` — read **`## Design`
  → the `lib/ytdlp/args.js` component-changes bullet (FR-1a)**, the FR-1a
  acceptance criteria, the **`### Security preservation notes` → FR-1a bullet**,
  and the **`### Alternatives considered`** (why a *soft* `-S` sort, not a hard
  `-f` codec filter).
- `docs/CONTRIBUTING.md` (coding standards) and `docs/RELIABILITY.md`.
- `lib/ytdlp/args.js` — `buildYtdlpDownloadArgs`, the `QUALITY_SELECTORS` map,
  the existing `args.push('-f', QUALITY_SELECTORS[quality]);` line, the
  `--merge-output-format` emission (only when `normalizeFiletype` resolves to a
  non-`'default'` container), the `SHORTS_MATCH_FILTER` constant (pattern to
  mirror), and the audio branch (`-x --audio-format`).

## Task — implement THIS ONE task only (FR-1a)

1. Add a module-level **exported fixed literal**:
   `const VIDEO_FORMAT_SORT = 'vcodec:h264,acodec:aac';`
   Mirror how `SHORTS_MATCH_FILTER` is declared/exported so it is easy to audit.
2. In the **VIDEO branch only** of `buildYtdlpDownloadArgs`, push
   `'-S', VIDEO_FORMAT_SORT` **immediately after** the existing
   `args.push('-f', QUALITY_SELECTORS[quality]);`, and **before**
   `--merge-output-format` and well before the `--` / positional targets.
3. This is a **soft sort** — it must apply to **every** video download and
   **every** quality tier (`best`/`2160p`/`1440p`/`1080p`/`720p`/`480p`/`360p`),
   including `'default'`/`'mkv'`/`'webm'` selections (fork #2 resolved scope). It
   must **not exclude** non-avc1 formats (the 2160p/1440p tiers, where YouTube
   serves only VP9/AV1, must still resolve to best-available — do NOT convert
   this into a hard `-f` filter).
4. Leave the `--merge-output-format mp4` trigger **byte-identical** (still only
   when `normalizeFiletype` resolves to `'mp4'`). The new `-S` must not force a
   container change for `'mkv'`/`'webm'`/`'default'`.
5. The **audio branch** (`-x --audio-format`) is untouched — no video-codec
   preference may leak into audio extraction.
6. **DEFER** the `--recode-video mp4` fallback (PE-recommended defer; non-blocking
   Dean confirmation pending) — do NOT implement it in this task.

`VIDEO_FORMAT_SORT` is a fixed literal, **never interpolated from any input**, so
it adds no injection surface.

## Hard constraints (non-negotiable — the gate will verify each)

- Every existing yt-dlp security guard stays **byte-identical**: arg-array /
  no-shell construction (no shell string anywhere in `args.js`), the `--`
  separator immediately before positional target URLs, the `targetIds` →
  `watch?v=<id>` host-hardcoded URL construction, the `ALLOWED_HOSTS` allowlist
  (`lib/ytdlp/url.js`, do not touch), `resolveChannelDir`/`isPathUnder`/SF4 path
  confinement, `--download-archive` (subscriptions) vs. `--no-download-archive
  --force-overwrites` (one-off), `--windows-filenames`, the Shorts
  `--match-filter` gate, and `normalizeQuality`/`assertFormat`/`normalizeFiletype`'s
  allowlist-or-safe-default posture.
- The one-off path (`opts.oneOff`/`runOneShot`) and the subscription path share
  the builder — both must get the SAME `-S` args (no divergent one-off logic).
- No new runtime dependencies. 2-space indent, semicolons, single quotes. Lint 0
  warnings.

## Tests

Extend `test/unit/ytdlp-args.test.js`:
- `-S VIDEO_FORMAT_SORT` is present in the video branch for **every**
  `QUALITY_SELECTORS` tier (not just one), positioned after `-f` and before the
  `--`/positional targets.
- The `format: 'audio'` branch does NOT include `-S VIDEO_FORMAT_SORT`.
- `--merge-output-format` still emits exactly when `normalizeFiletype` → `'mp4'`
  and NOT for `'mkv'`/`'webm'`/`'default'`.
- Every existing `ytdlp-args.test.js` assertion (arg-array shape, `--` position,
  archive-dedup, `--windows-filenames`, shorts filter, one-off vs subscription)
  still passes unchanged.

## Toolchain / commands

Node 22 is the standard. Before any npm/node command, export the fnm node PATH
(per repo convention), then use the Node 22 test toolchain bin:

- `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`

Run `npm run lint` (must be 0 warnings) and `npm test` (must stay green on
Node 22). Fix any failure before reporting done.

## Git — DO NOT commit

The **coordinator (EM) owns ALL git**. Do NOT stage, commit, or push. Report
files changed + full lint/test output; the coordinator commits per task.

## Report back

- Files changed (paths + one-line summary each) and the exact args added.
- Confirmation that `-S` lands in the video branch for every tier and the audio
  branch is untouched.
- A short "guards unchanged" checklist confirming each item above is
  byte-identical (evidence the two reviewers will re-verify).
- Lint + Node 22 test result.
- Any deviation from the design or new fork (with a recommendation) — do NOT
  expand scope into other FRs' files.
