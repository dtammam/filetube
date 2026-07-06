# Software Developer — Task T6: Dockerfile pinned yt-dlp + docs (LAST task before v1.11.0)

Feature: **Optional yt-dlp subscription integration module**, branch `feat/ytdlp-integration`.
T1–T5 are DONE and committed (config/wiring, persistence+CRUD, invocation+security, download
loop, and the /subscriptions UI — 510 tests green). T6 is the final task: **bundle a pinned
yt-dlp in the container and document the feature.** No app logic — Dockerfile + docs only.

## Read first

- `.state/feature-state.json` → `tasks[T6]` (description + `done_when` + `routing_note`) and
  `locked_decisions.D1` (the exactly-five ENV vars) + `locked_decisions.D5` (pinned in the
  image + rebuild-to-update; NO runtime auto-update, NO in-app update action).
- `docs/CONTRIBUTING.md` (Docker/Alpine conventions) and the exec plan's Design section.
- Current files you'll change:
  - `Dockerfile` — `FROM node:22-alpine`; `RUN apk add --no-cache ffmpeg` (line 5);
    `npm ci --only=production`; `CMD [ "npm", "start" ]`. **There is NO `USER` directive today
    — the app runs as root. Do NOT change that posture (neither improve nor worsen it in this
    task; see Security below).**
  - `lib/ytdlp/config.js` — `parseYtdlpConfig` reads `FILETUBE_YTDLP_VERSION` into
    `config.version` as an **optional informational string** (it does not enforce it against the
    installed binary). This is why the **Dockerfile pin is the source of truth** for the bundled
    binary and the `ENV` line below should mirror it.
  - `.env.example` — currently only `FILETUBE_IMAGE_TAG`, `SERVER_HOST_PORT`, `DATA_DIR`.
  - `README.md` — has a `## Quick Start (Docker)` (~line 44) with an ENV table (~line 65); add a
    new optional-feature section.
  - `docker-compose.yml` — reference the new ENV/volume knobs as needed (cookies mount, download
    dir volume).

## Dockerfile

### CRITICAL #0 — add `COPY lib/ ./lib/` (the image won't boot without it)

`server.js:14` has an UNCONDITIONAL top-level `const ytdlp = require('./lib/ytdlp');` that runs
on EVERY startup, BEFORE any `isEnabled` gate. The current Dockerfile only does
`COPY server.js ./` and `COPY public/ ./public/` — it **never copies `lib/`**. `lib/` is
entirely new on this branch (main's server.js has no `./lib` require, so main's Dockerfile was
correct; THIS branch introduces the dependency). Built from this branch as-is, the image is
missing `lib/ytdlp` → `require('./lib/ytdlp')` throws `MODULE_NOT_FOUND` → **the container won't
boot FOR ANYONE, including users who never enable the feature** — a catastrophic violation of the
"must not degrade existing experience" rule.

- **Add `COPY lib/ ./lib/` to the Dockerfile** (next to the existing `COPY server.js ./` /
  `COPY public/ ./public/` lines, before `CMD`). This also brings in the `sendFile`-served UI
  assets `lib/ytdlp/views/subscriptions.html` + `lib/ytdlp/client/subscriptions.js` (T5), which
  live under `lib/`, not `public/`.
- `.dockerignore` has been checked and does NOT exclude `lib/` (it excludes `.git`,
  `node_modules`, `data/`, docs, `test_media`, etc.) — so no ignore edit is needed; just add the
  COPY.
- Add a one-line comment at that COPY noting server startup does `require('./lib/ytdlp')`, so the
  layer is load-bearing even when the feature is disabled.

### yt-dlp install

- Add the yt-dlp runtime deps to the existing ffmpeg layer (don't disturb the node/npm layers):
  `RUN apk add --no-cache ffmpeg python3 py3-pip` (ffmpeg stays; yt-dlp reuses it).
- Pin the version with a build ARG and install it, keeping the image lean:
  - `ARG YTDLP_VERSION=<pick a specific recent stable release, e.g. 2025.xx.xx>` (pin an exact
    version, not a range/latest).
  - `RUN pip install --no-cache-dir --break-system-packages "yt-dlp==${YTDLP_VERSION}"`
    (`--no-cache-dir` keeps the image small; `--break-system-packages` is required because
    Alpine's py3-pip is PEP-668 externally-managed — add a one-line comment saying so).
  - `ENV FILETUBE_YTDLP_VERSION=${YTDLP_VERSION}` — so the running app's parsed config
    (`config.version`) reflects the actual bundled binary. Document (in a comment + the README)
    that the **Dockerfile ARG pin is the source of truth**; the env var is informational /
    operator-overridable but does NOT change which binary is installed.
- Rationale to capture in a comment: **pip over a static binary** — the base image is
  `node:22-alpine` (musl libc), and yt-dlp's standalone `yt-dlp_linux` PyInstaller binary is
  glibc-built and will NOT run on Alpine; the pip install is the portable path. Pinned +
  build-ARG-gated; **no runtime self-update** (D5).
- **Verify in your reasoning (Docker isn't locally testable — see Verification):** after the pip
  install, `yt-dlp` resolves on `PATH` (pip installs the console script to a bin dir on `PATH`),
  because `lib/ytdlp/run.js` spawns it by bare name `yt-dlp` via execFile. ffmpeg is already on
  `PATH` from the existing layer (yt-dlp needs it — good).
- Keep it minimal — do not add unrelated tools, do not add a package manager cache, do not
  reorder/rebuild the existing ffmpeg/node/npm layers beyond adding python3+py3-pip+the pip
  install.

## .env.example

**APPEND** (do NOT remove the existing `FILETUBE_IMAGE_TAG` / `SERVER_HOST_PORT` / `DATA_DIR`
entries) the **five** yt-dlp ENV vars with fail-safe-off defaults and a one-line description
each, plus a note that the whole feature is optional/additive and OFF by default:

- `FILETUBE_YTDLP_ENABLED` (default off — only `true`/`1`/`yes` enable it; anything else stays
  disabled)
- `FILETUBE_YTDLP_COOKIES_FILE` (path to a mounted cookies file for members-only/age-gated
  content; unset = no cookies)
- `FILETUBE_YTDLP_POLL_MINUTES` (background poll interval; `0` = manual re-pull only; default
  60)
- `FILETUBE_YTDLP_DOWNLOAD_DIR` (where downloads land; defaults to a `ytdlp-downloads` subdir
  alongside `DATA_DIR`)
- `FILETUBE_YTDLP_VERSION` (informational — reflects the pinned bundled binary; set by the image
  build)

## README.md

Add an **"Optional: YouTube subscriptions (yt-dlp)"** section covering:
- what it does (subscribe to channels; FileTube periodically downloads new videos into a media
  folder the normal scanner indexes; they appear in the normal UI; deleting in FileTube removes
  them everywhere).
- how to enable (`FILETUBE_YTDLP_ENABLED=true`) and that it's **off by default / a clean no-op
  when disabled** (no new routes, no nav link, no background job, no assumption yt-dlp is used).
- the five ENV vars (mirror `.env.example`).
- mounting a **cookies file** for members-only/age-gated content, and the members-only toggle
  (skipped unless the toggle is on AND a cookies file is present — fail-safe).
- the **pinned-version / rebuild-to-update** model (D5): the bundled yt-dlp is pinned in the
  image; to update, pull/rebuild a newer FileTube image — there is no in-app or runtime update.

## docker-compose.yml

Reference the new knobs as needed — e.g. the download-dir volume and a read-only cookies-file
mount, and surface the ENV vars (commented examples are fine). Keep existing services/volumes
intact.

## SECURITY — flag, don't block

Adding `python3` + `py3-pip` and a **pip install as root** expands the image's attack surface
(a Python runtime + pip in the image). This is inherent to Dean's bundled-yt-dlp decision and
the app already runs as root, so T6 does **not worsen** the existing privilege posture — but:
do NOT introduce anything that increases privilege, do NOT add a pip cache, and call out in
your report that the image now ships a Python runtime (so the coordinator can note it). The
child-process spawn safety (arg-array/no-shell, URL allowlist, path confinement, cookies
redaction) was already reviewed in T3 and is unchanged by T6.

## Verification — Docker is NOT available in this dev env (confirmed)

The unit/integration suite cannot test a Dockerfile, and Docker is **confirmed unavailable**
locally, so the Dockerfile change cannot be locally build-tested. Its first real verification is
the CI **"Publish Docker Image"** build on the eventual tag push. Therefore the T6 build-
specialist will:

- run `npm run lint` + `npm test` — must stay green (510); the code suite is unchanged by a
  Dockerfile/docs task, so any change here is a red flag.
- do a **careful line review of the Dockerfile**, explicitly confirming: **`COPY lib/ ./lib/`
  is present** (the boot-critical item), yt-dlp is pinned to an explicit version, `python3` +
  `py3-pip` added, `--break-system-packages --no-cache-dir` used, the image stays lean, `CMD`
  unchanged, and `.dockerignore` does not exclude `lib/` (it doesn't).
- reason through (not execute) that `yt-dlp` resolves on `PATH` for `lib/ytdlp/run.js`'s spawn.

The coordinator will WATCH the CI Docker build after the tag and only call v1.11.0 shipped once
that build is green AND Dean confirms on-device.

## Done when

- Dockerfile installs a PINNED yt-dlp via pip alongside ffmpeg, build-ARG gated, no runtime
  auto-update; the `ENV FILETUBE_YTDLP_VERSION` mirrors the ARG.
- README + `.env.example` document all 5 ENV vars with defaults + the opt-in/disabled-by-default
  statement (AC34); docker-compose references the new knobs.
- The existing app is undisturbed: `npm run lint` 0 and `npm test` 510 green (the code suite is
  unchanged by a Dockerfile/docs task, but run it to confirm nothing regressed):
  - `export PATH="/home/coder/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"`
    (fnm not auto-sourced — FIRST, before every npm/node command)
  - `npm run lint`
  - `npm test`
- Report files changed, the pinned yt-dlp version you chose, the Python-runtime attack-surface
  note, and whether you were able to build the image locally.

Then `/prep-build-verify` (the build-specialist does the Docker build if available). No
two-reviewer gate for T6. After T6 verifies: this is the LAST task — next is `/prep-pm-accept`
(full 34-AC acceptance pass) then `/prep-em-done` (commit + push + PR + tag v1.11.0). Do NOT
commit unless the coordinator asks — the coordinator owns git for this feature.
