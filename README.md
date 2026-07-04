# FileTube

A lightweight, self-hosted media server resembling old-school YouTube.

<p align="center">
    <img src="assets/images/filetube_icon.png" alt="FileTube app icon" width="120">
</p>

<table>
    <tr>
        <td align="center">
            <img src="assets/images/desktop_example.png" alt="FileTube on a desktop browser" width="620">
        </td>
        <td align="center">
            <img src="assets/images/iphone_example.png" alt="FileTube on an iPhone" width="280">
        </td>
    </tr>
</table>

FileTube is a personal media application designed to let you consume your local video and audio files in a web browser using a nostalgic, classic YouTube interface (circa 2005-2010). It runs on your own server or local network so your data stays with you.

## Features

- **Nostalgic YouTube layout** — Classic grid, uploader channels, star ratings, and mock comments.
- **Smart resume playback** — Automatically saves your progress on videos/audios and prompts you to resume where you left off.
- **Auto-generated thumbnails** — Uses FFmpeg to extract video frames or audio cover art automatically.
- **Audio file support** — Plays audio formats (MP3, FLAC, M4A, etc.) with a custom spinning vinyl disc visual.
- **Permanent file deletion** — Delete unwanted media directly from the web browser to free up server space.
- **Dark mode** — Easy toggle between classic light and sleek dark mode.
- **Self-hosted with Docker** — Start instantly with a single `docker compose up -d`.

## Quick Start (Docker)

You'll need **Docker** and **Docker Compose** installed on your machine.

### 1. Download the project

```bash
git clone https://github.com/dtammam/filetube.git
cd filetube
```

### 2. Set up your environment file

Copy the example configuration:

```bash
cp .env.example .env
```

Open `.env` and configure your variables:

| Variable | What to put | Why |
|----------|------------|-----|
| `FILETUBE_IMAGE_TAG` | `latest` or specific version | Pulls the corresponding container image |
| `SERVER_HOST_PORT` | Port number (e.g. `3000`) | Port on your network to access the web app |
| `DATA_DIR` | Host folder path (e.g. `./data`) | Where database (db.json) and thumbnails are saved |

### 3. Mount your media folders

Open `docker-compose.yml` and add your video or audio folders under `volumes`. For example:

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

Go to the **Settings** gear icon in the top right, add your container paths (e.g. `/media/movies`), and click **Save & Scan Library**.

---

## Local Development (Without Docker)

### Prerequisites
- Node.js (v16+)
- FFmpeg installed and in your system PATH (optional, but required for video thumbnails).

### Run steps
```bash
npm install
npm start
```
By default, the server will start on port 3000. You can change this by running `PORT=3001 npm start`.
