# Software Developer inbox — T5 (parallel track A)

Feature: **v1.16.0 "Watch experience"** (feature_id `v1.16-watch`).
This is **Task T5**, the isolated server-side security item. It is
**INDEPENDENT** of T1–T4 and runs in parallel — you share no files with the
client shell/player work.

## Read first

- `.state/feature-state.json` — find the `tasks` entry with `"id": "T5"` for the
  authoritative scope/done_when.
- `docs/exec-plans/active/2026-07-06-v1.16-watch-experience.md` — read the
  **FR-5** sections: Scope (FR-5), Constraints (FR-5 security is non-negotiable),
  the `### FR-5 — Share-URL validator robustness` design block, and the **T5**
  entry in `## Task breakdown`.
- `docs/CONTRIBUTING.md` — coding standards.
- `lib/ytdlp/url.js` — the file you change. Study `validateChannelUrl`, the
  strict guards, `buildWatchUrl`, and `classifySingleVideo` before touching
  anything.

## Task — implement THIS ONE task only

Make `validateChannelUrl` in `lib/ytdlp/url.js` robust to the real-world YouTube
share-sheet payload (e.g. `"Title\nhttps://youtu.be/<id>?si=<token>"`) **without
weakening any existing guard**. Insert an input-normalization pre-step, keeping
every strict guard byte-identical and still applied to the resulting candidate:

1. The existing non-empty-string guard stays **first**.
2. The `raw.length > MAX_URL_LENGTH` reject stays **on the original raw string**
   (before any regex work — an oversized blob must be rejected before extraction;
   extraction must not be able to shrink a huge input past this cap).
3. `const trimmed = raw.trim();`
4. If `/\s/.test(trimmed)` (internal whitespace remains — text with an embedded
   URL), extract the **first** `/https?:\/\/\S+/` match as `candidate`. If there
   is no match, keep `trimmed` (which then fails the unchanged `FORBIDDEN_CHARS`
   check exactly as today). Otherwise `candidate = trimmed`.
5. Run the **UNCHANGED** strict validation on `candidate`: leading-`-` reject,
   `FORBIDDEN_CHARS`, `new URL()` parse, http/https-only, userinfo reject,
   `ALLOWED_HOSTS` allowlist, `isPlausiblePath` shape, and the SF5 decoded
   `?v=`/`?list=` id charset/length check.

`classifySingleVideo` must inherit the normalization for free (it calls
`validateChannelUrl` first — keep it the single source of truth; do NOT duplicate
the normalization).

## Hard constraints (non-negotiable)

- **DO NOT change any strict guard.** `FORBIDDEN_CHARS`, `MAX_URL_LENGTH`,
  leading-`-`, `new URL()` parse, http/https-only, userinfo reject,
  `ALLOWED_HOSTS`, `isPlausiblePath`, SF5 id charset/length — all stay
  byte-identical and still run on the candidate. Only the INPUT is normalized
  before them. Extraction must never smuggle a hostile URL past a check.
- **Disabled-module no-op is sacred.** No new routes, no UI, no disabled-path
  behavior change. With `FILETUBE_YTDLP_ENABLED` off the module stays a
  byte-identical no-op.
- **No new runtime dependencies.** CommonJS server; 2-space indent, semicolons,
  single quotes. Lint must pass with 0 warnings.
- `buildWatchUrl` must still rebuild a clean canonical watch URL that drops
  `?si` — verify `?si=`/`&feature=`/`&pp=` inputs still pass and produce a clean
  canonical URL.

## Tests — MANDATED (add to `test/unit/`, `node:test`)

All must pass on Node 22:

1. Hostile embedded URL still rejected: `"click https://evil.com/x"` → extracted
   `evil.com` fails the host allowlist.
2. Extracted URL with a shell metachar / leading `-` / userinfo → still rejected
   (e.g. `https://youtu.be/x;rm` → `;` fails `FORBIDDEN_CHARS`).
3. Oversized input → still rejected (`MAX_URL_LENGTH`, on the raw string).
4. A channel/playlist/handle on the one-off single-video path → still `400`
   (`classifySingleVideo` kind `channel`/`playlist`).
5. ACCEPT: `" https://youtu.be/<id>?si=<x>\n"` trims → valid video.
6. ACCEPT: `"Title\nhttps://www.youtube.com/watch?v=<id>&si=<x>"` extracts →
   valid video.
7. `classifySingleVideo` returns kind `'video'` + the right `videoId` + a clean
   `buildWatchUrl` (no `?si`).

## Toolchain / commands

Node 22 is the standard. Before any npm/node command in this repo, export the
node PATH (see `node_toolchain_note` in `.state/feature-state.json`):

- fnm default: `export PATH="/home/coder/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"`
- Node 22 toolchain for running tests: `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`

Run `npm run lint` (0 warnings) and `npm test` (or `npm run test:unit` for the
fast subset) and fix any failures before reporting done.

## Git — DO NOT commit

The coordinator owns ALL git. Do NOT stage, commit, or push. Report the list of
files changed + full test/lint output; the coordinator commits per task.

## Report back

- Files changed (paths + one-line summary each).
- The tests you added and their pass/fail output on Node 22.
- Lint result.
- Any deviation from the design or new fork you hit (with a recommendation).
