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

# Pin the bundled yt-dlp version. This ARG (and the mirrored ENV below) is
# the SOURCE OF TRUTH for the binary shipped in the image -- the app-level
# FILETUBE_YTDLP_VERSION env var (lib/ytdlp/config.js) only reflects it for
# display and never enforces or triggers an install. There is no runtime
# auto-update (locked decision D5): bumping this ARG and rebuilding the
# image is the only supported way to move to a newer yt-dlp.
ARG YTDLP_VERSION=2026.7.4

# node:22-alpine is musl libc, so yt-dlp's standalone PyInstaller binary
# (glibc-built) will not run here -- installing the pip package is the
# portable path on Alpine. --break-system-packages is required because
# Alpine's py3-pip is PEP-668 "externally managed" (this is a container
# build, not a shared host, so installing as root here is expected).
# --no-cache-dir keeps the layer lean.
RUN pip install --no-cache-dir --break-system-packages "yt-dlp==${YTDLP_VERSION}"

# Mirror the pin into the running app's env so its informational
# `config.version` (lib/ytdlp/config.js) matches the binary actually bundled.
ENV FILETUBE_YTDLP_VERSION=${YTDLP_VERSION}

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

# Expose server port
EXPOSE 3000

# Environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Create volume mounts for persistent database and media shares
# db.json should be mounted if progress/folders configs need to survive container rebuilds.
# Media folders should be mounted (e.g. -v /path/to/my/movies:/media) and then configured via UI.
VOLUME [ "/app/data" ]

# We can tell the server to store its database and thumbnails in a mounted data folder if desired.
# For simplicity, db.json is created in root, but users can mount a host directory to /app to persist it,
# or we can write it to the volume. Let's make sure it runs out-of-the-box.

CMD [ "npm", "start" ]
