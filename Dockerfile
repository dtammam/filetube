# Use lightweight Node 22 (current LTS) Alpine as base image
FROM node:22-alpine

# Install FFmpeg/FFprobe (video metadata + thumbnails) plus python3/py3-pip,
# which are only needed to install yt-dlp below (yt-dlp itself also shells
# out to ffmpeg for post-processing, so it reuses this layer).
#
# v1.38.1: also bake in espeak-ng (Alpine `community` repo, enabled by default
# in node:*-alpine) so the TTS "Listen from Here" reader feature works OUT OF
# THE BOX -- same posture as the yt-dlp binary below: the engine is already
# there, the user chooses nothing. espeak-ng is tiny (~a few MB) + pure musl,
# so it's cheap to ship for everyone. The higher-quality Piper engine is NOT
# baked (its onnxruntime dependency has no musl/Alpine wheels, and it would add
# ~300MB nobody who sticks with the default needs) -- Piper stays STRICTLY
# opt-in: set FILETUBE_TTS_ENGINE=piper + FILETUBE_TTS_PIPER_MODEL to a mounted
# .onnx voice model (see README) to upgrade the voice.
RUN apk add --no-cache ffmpeg python3 py3-pip espeak-ng

# Pin the BUNDLED yt-dlp version. This ARG (and the mirrored ENV below) is
# the source of truth for the binary BAKED INTO the image - the permanent
# fallback engine. v1.146 (Dean's ruling, 2026-08-18) OVERTURNED the old
# locked decision D5 ("no runtime auto-update"): FileTube now carries a
# runtime engine selector (Setup -> Downloads -> "Downloader engine",
# lib/ytdlp/engine.js) that can pin the ACTIVE engine to the latest STABLE
# or NIGHTLY from PyPI, installed into a persistent venv under /app/data
# and health-gated (install-time --version probe + a runtime failure net
# that auto-reverts to THIS bundled binary with a bell). The bundled
# binary is NEVER removed; the DEFAULT channel is bundled, so a fresh
# install keeps the pre-v1.146 trust posture and runtime pip installs
# happen only after a conscious admin opt-in (the supply-chain trade is
# disclosed in README + docs/CONFIGURATION.md + ROADMAP).
#
# This pin therefore still matters on every channel: it is what "bundled"
# means, what every auto-revert lands on, and what an offline instance
# runs forever. Still an EXACT version pin - reproducible builds are
# preserved. The pin tracks yt-dlp's NIGHTLY channel since v1.145 (stable
# lags YouTube's enforcement rollout by WEEKS - Dean's live 403 outage,
# 2026-08-17/18). Note (v1.145 gate S1): the binary SELF-REPORTS the
# normalized spelling `2026.08.17.073947` (no `.dev0`) - same release,
# different spelling; not a mismatch to "diagnose". Bump cadence: refresh
# this pin whenever a release wave touches downloads, and immediately when
# download failures spike on-device (latest nightly: `pip index versions
# yt-dlp --pre`, or the yt-dlp-nightly-builds GitHub releases page).
ARG YTDLP_VERSION=2026.8.17.73947.dev0

# node:22-alpine is musl libc, so yt-dlp's standalone PyInstaller binary
# (glibc-built) will not run here -- installing the pip package is the
# portable path on Alpine. --break-system-packages is required because
# Alpine's py3-pip is PEP-668 "externally managed" (this is a container
# build, not a shared host, so installing as root here is expected).
# --no-cache-dir keeps the layer lean.
RUN pip install --no-cache-dir --break-system-packages "yt-dlp==${YTDLP_VERSION}"

# Mirror the pin into the running app's env so its informational
# `config.version` (lib/ytdlp/config.js) matches the binary actually bundled
# (spelling-loose: the binary normalizes the version string - see the pin
# block's gate-S1 note; config.version is display-only with no consumers).
ENV FILETUBE_YTDLP_VERSION=${YTDLP_VERSION}

# v1.145 (gate W2): yt-dlp deprecated running with NO JavaScript runtime
# ("some formats may be missing" on every extraction) and auto-enables only
# deno - but THIS image ships node, a supported runtime yt-dlp will not use
# unless told. Default the opt-in here so every image deployment extracts
# with a runtime; compose-level env overrides it, and bare-metal deployments
# (no image ENV) stay unset so an older operator-installed binary that
# rejects unknown flags never sees the flag. See lib/ytdlp/config.js's
# parseJsRuntimes for the validation posture.
ENV FILETUBE_YTDLP_JS_RUNTIMES=node

# v1.38.1: the image ships espeak-ng (above), so default the TTS engine to it --
# the "Listen from Here" control lights up with no configuration. A user who
# mounts a Piper voice model overrides this at runtime with
# `-e FILETUBE_TTS_ENGINE=piper -e FILETUBE_TTS_PIPER_MODEL=/path/to/voice.onnx`
# (a runtime `-e` always wins over this image ENV). The app's own code default
# stays `piper` (the preferred engine when a model is provided); this ENV is
# what makes the SHIPPED image work out of the box with the bundled engine.
ENV FILETUBE_TTS_ENGINE=espeak-ng

# Set working directory inside container
WORKDIR /app

# Copy dependency configs
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy server code and public assets
COPY server.js ./
COPY public/ ./public/
# lib/ (the optional yt-dlp module) is load-bearing even when the feature is
# disabled: server.js has an unconditional top-level `require('./lib/ytdlp')`
# that runs on every startup, before the isEnabled() gate. Without this copy
# the container fails to boot for everyone, not just users who enable
# subscriptions. This also ships the module's UI assets served via
# sendFile: lib/ytdlp/views/subscriptions.html and lib/ytdlp/client/subscriptions.js.
COPY lib/ ./lib/
# v1.113: ship the ops/diagnostic scripts so they are runnable on a deployed
# server, e.g. `docker exec <container> node scripts/probe-channel-metadata.js`
# (WORKDIR /app, so the scripts' `../lib/...` requires and the /app/data
# auto-find both resolve). Previously scripts/ was NOT copied, so the v1.111
# device-pass note pointing at `node scripts/probe-faststart.js` referenced a
# file absent from the image - this also retroactively makes THAT runnable.
# These are the same scripts the repo already trusts (reset-admin, migrate-check,
# the probe-* diagnostics); a few KB of JS, no runtime deps.
COPY scripts/ ./scripts/

# Expose server port
EXPOSE 3000

# Environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Create volume mounts for persistent database and media shares.
# The SQLite database (filetube.db, since v1.42), thumbnails, and per-instance
# secrets live under DATA_DIR (/app/data) - mount it or state is lost on
# rebuild. (A legacy db.json in the mount is read-only import material only.)
# Media folders should be mounted (e.g. -v /path/to/my/movies:/media) and then configured via UI.
VOLUME [ "/app/data" ]

CMD [ "npm", "start" ]
