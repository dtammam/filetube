# Use lightweight Node 22 (current LTS) Alpine as base image
FROM node:22-alpine

# Install FFmpeg and FFprobe for video metadata and thumbnail extraction
RUN apk add --no-cache ffmpeg

# Set working directory inside container
WORKDIR /app

# Copy dependency configs
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy server code and public assets
COPY server.js ./
COPY public/ ./public/

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
