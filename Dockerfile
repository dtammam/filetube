# Use lightweight Node 22 (current LTS) Alpine as base image
FROM node:22-alpine

# Install FFmpeg/FFprobe (video metadata + thumbnails) plus python3/py3-pip,
# which are only needed to install yt-dlp below (yt-dlp itself also shells
# out to ffmpeg for post-processing, so it reuses this layer).
RUN apk add --no-cache ffmpeg python3 py3-pip

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
