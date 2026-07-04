<div align="center">

<img src="assets/images/filetube_icon.svg" alt="FileTube app icon" width="120">

# FileTube

**Broadcast yourself — your files.** A lightweight, self-hosted media server with a nostalgic, classic-YouTube interface (circa 2005–2010).

[![CI](https://github.com/dtammam/filetube/actions/workflows/ci.yml/badge.svg)](https://github.com/dtammam/filetube/actions/workflows/ci.yml)
[![Publish Docker Image](https://github.com/dtammam/filetube/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/dtammam/filetube/actions/workflows/docker-publish.yml)
[![Docker Image Size](https://img.shields.io/docker/image-size/deantammam/filetube/latest)](https://hub.docker.com/r/deantammam/filetube)
[![Docker Pulls](https://img.shields.io/docker/pulls/deantammam/filetube)](https://hub.docker.com/r/deantammam/filetube)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

FileTube is a personal media application that lets you consume your local video and audio files in a web browser using a nostalgic, classic YouTube interface. It runs on your own server or local network, so your data stays with you.

## Features

- **Nostalgic YouTube layout** — Classic grid, uploader channels, star ratings, and mock comments.
- **YouTube-style player** — Plays inline on iOS (no forced fullscreen), with ±15s skip via on-player buttons, double-tap, or the ← / → keys.
- **Smart resume playback** — Automatically saves your progress and prompts you to resume where you left off.
- **Auto-generated thumbnails** — Uses FFmpeg to extract video frames or audio cover art automatically.
- **Audio file support** — Plays audio formats (MP3, FLAC, M4A, etc.) showing embedded cover art with native controls.
- **Permanent file deletion** — Delete unwanted media directly from the browser to free up server space.
- **Dark mode** — Easy toggle between classic light and sleek dark mode.
- **Self-hosted with Docker** — Start instantly with a single `docker compose up -d`.

## Screenshots

<p align="center">
  <img src="assets/images/desktop1.png" alt="FileTube on a desktop browser" width="820">
</p>

<p align="center">
  <img src="assets/images/mobile1.jpg" alt="FileTube on iPhone — home" width="240">
  &nbsp;
  <img src="assets/images/mobile2.jpg" alt="FileTube on iPhone — watch" width="240">
  &nbsp;
  <img src="assets/images/mobilecomments.png" alt="FileTube on iPhone — comments" width="240">
</p>

## Quick Start (Docker)

You'll need **Docker** and **Docker Compose** installed.

### 1. Download the project

```bash
git clone https://github.com/dtammam/filetube.git
cd filetube
```

### 2. Set up your environment file

```bash
cp .env.example .env
```

Open `.env` and configure your variables:

| Variable | What to put | Why |
|----------|------------|-----|
| `FILETUBE_IMAGE_TAG` | `latest` or a specific version | Pulls the corresponding container image |
| `SERVER_HOST_PORT` | Port number (e.g. `3000`) | Port on your network to access the web app |
| `DATA_DIR` | Host folder path (e.g. `./data`) | Where the database (`db.json`) and thumbnails are saved |

### 3. Mount your media folders

Open `docker-compose.yml` and add your video or audio folders under `volumes`:

```yaml
    volumes:
      - ./data:/app/data
      - /path/to/your/movies:/media/movies
      - /path/to/your/music:/media/music
```

### 4. Start it up

```bash
docker compose pull
docker compose up -d
```

### 5. Open the app

Navigate to [http://localhost:3000](http://localhost:3000) (or the port you configured in `.env`).

Open the **Settings** gear icon in the top right, add your container paths (e.g. `/media/movies`), and click **Save & Scan Library**.

### Staying up to date (or pinning a version)

Set `FILETUBE_IMAGE_TAG` in your `.env` to choose how you track updates:

| Tag | Behavior |
|-----|----------|
| `latest` | Newest **release** (recommended for most people) |
| `1.4.2` | Pinned to an exact version — never moves |
| `1.4` / `1` | Latest patch / minor within that line |
| `edge` | Newest `main` commit (bleeding edge) |

After changing the tag (or when a new release ships), pull and restart:

```bash
docker compose pull
docker compose up -d
```

Prefer automatic updates? Point a tool like [Watchtower](https://containrrr.dev/watchtower/)
at the `latest` tag. See [docs/RELEASING.md](docs/RELEASING.md) for the full tag scheme.

---

## Local Development (Without Docker)

### Prerequisites
- Node.js (v20+; the Docker image ships Node 22 LTS)
- FFmpeg installed and in your system PATH (optional, but required for video thumbnails).

### Run steps
```bash
npm install
npm start
```

By default the server starts on port 3000. Override it with `PORT=3001 npm start`.

## Roadmap

Planned improvements are tracked in [ROADMAP.md](ROADMAP.md).

## License

[MIT](LICENSE) © Dean Tammam
