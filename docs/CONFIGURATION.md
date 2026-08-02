# Configuration reference

The deep-dive companion to the README's Quick Start: accounts, automation,
transcode caches, the database, YouTube subscriptions (yt-dlp), and
text-to-speech. Everything here is optional - FileTube works out of the box
with none of it.

## Accounts & signing in (v1.43+)

FileTube is account-walled: the first boot takes you to a one-time **/welcome**
page to create the admin account (your existing watch progress, likes, book
positions, and pins are adopted into it). Add household members from
**Settings → Users**; each account keeps its own watch progress, likes,
reading positions, and pins. Sessions are signed cookies that survive
restarts; changing a user's password (or disabling them) signs out all of
their sessions instantly.

Useful environment variables (all optional):

- `FILETUBE_SESSION_SECRET` - pin the cookie-signing secret (otherwise one is
  minted and stored in the data dir).
- `FILETUBE_TRUST_PROXY=1` - set when running behind a reverse proxy that
  terminates HTTPS (e.g. Nginx Proxy Manager) so cookies are marked Secure.
  Your proxy must overwrite the `X-Forwarded-For` header (NPM does).
- `FILETUBE_API_TOKEN` - a bearer token that lets an iOS Shortcut post
  one-off downloads without a browser session.

**Forgot the admin password?** There is deliberately no in-app reset. Run the
recovery script as whoever operates the box (it works with the server
running or stopped):

```bash
# inside the container (or on the host with DATA_DIR set):
docker exec -it -e FILETUBE_NEW_PASSWORD='new-password-here' filetube \
  node scripts/reset-admin.js yourusername
```

It resets the password (signing out every session for that user), can
bootstrap a first admin if the users table is somehow empty, never promotes
a non-admin, and requires an explicit `--enable` flag to also re-enable a
disabled account.

## Automation & Storage

The **Settings → Automation & Storage** box controls the two things the
server does in the background:

- **Scan interval** - Off (manual only) / 30m / 1h / 6h / 12h / 24h, **default
  30 minutes**. A "Scan now" button and a "Last scanned: N ago" line are also
  here. Only one scan (automatic or manual) ever runs at a time.
- **Remove entries for deleted files during scan** - on by default. When a
  file that was previously scanned is no longer on disk, its library entry
  (and thumbnail/transcode) is removed on the next scan. This is guarded: if
  an entire configured folder is missing (e.g. an unmounted network share),
  FileTube treats that as a mount problem, not a deletion, and never prunes
  entries under it - regardless of this toggle.
- **Transcode cache** - a live size display, a "Clear cache now" button, an
  age-retention setting (Off / 7 / 14 / 30 / 90 days, **default 30**) that
  removes cached transcoded MP4s not watched within the window, and a
  size-cap field. The age-retention sweep and the size cap both run
  independently; the size cap is the hard backstop regardless of the age
  setting.

The transcode cache's size cap can also be set via the `TRANSCODE_CACHE_MAX_BYTES`
environment variable. Precedence: the UI cap, when set, wins; leaving the UI
field blank defers to `TRANSCODE_CACHE_MAX_BYTES` if set, or a 5 GB built-in
default otherwise. Existing deployments that only set the env var keep working
unchanged.

Two more transcode-related environment variables (both optional, both default
to today's behavior with no config changes needed):

| Variable | Default | What it does |
|----------|---------|---------------|
| `TRANSCODE_DIR` | `<DATA_DIR>/transcoded` | Where the on-demand transcoded MP4 cache is written. Point it at a different disk/mount if you want the cache off your main data volume (e.g. faster local storage, or a large external/NFS share). The directory is created on boot if missing; the existing size-cap eviction and age-retention sweep both key off this same directory. |
| `ROKU_COMPAT_DIR` | `<DATA_DIR>/roku-compat` | Where Roku compatibility renditions are cached (v1.46: `?compat=roku` remuxes/rotation bakes for the Roku channel). Must NOT live inside a configured media folder - the feature disables itself if it does. Safe to delete at any time; renditions rebuild on demand. |
| `ROKU_COMPAT_CACHE_MAX_BYTES` | `5368709120` (5 GB) | Size cap for the roku-compat rendition cache (LRU eviction, enforced at boot and after each build). Counted by the Settings cache-size display and swept by "Clear cache now". |
| `TRANSCODE_CRF` | `23` | The x264 CRF (quality) used for both on-demand transcode paths (cached and live). Lower = higher quality/larger files, higher = smaller files/lower quality. Valid range is `1`-`51`; anything unset/invalid/out of range falls back to `23` (a warning is logged, the server never crashes). Opt-in only - the default is unchanged. |

## The database (v1.42+: SQLite) and upgrading from v1.41 or earlier

From v1.42, FileTube's library state lives in `DATA_DIR/filetube.db`
(SQLite via Node's built-in driver - no new dependencies). **The migration
is automatic and non-destructive:** the first v1.42+ boot imports your
existing `db.json` and then never touches it again - the file stays
byte-for-byte intact forever, so an older FileTube version can keep
running against it (e.g. prod on the old tag while you trial the new one
against the same media from a different `DATA_DIR`). If `db.json` is
unreadable, boot stops with a clear message and creates nothing - it can
never silently start you over with an empty library.

Before upgrading you can dry-run the migration against your real database
(nothing is written anywhere permanent; your db.json is hash-verified
untouched):

```bash
node scripts/migrate-check.js /path/to/DATA_DIR/db.json
```

Two related tools/levers:

| Variable / tool | What it does |
|-----------------|---------------|
| `FILETUBE_READ_ONLY_MEDIA=1` | Beta safe mode for a second instance sharing your media folders: deletes, moves, downloads, re-pulls, reheat, and skip-list writes all refuse with a clear error, the scheduled poll is a no-op, and the scan will never remove a media file. Playback, likes, progress, and settings work normally. NOT the same lever as `FILETUBE_READONLY` below - pick by whether user-state writes should keep working. |
| `FILETUBE_READONLY=1` | TOTAL read-only mode (2026-07-30 capture-safety hardening): every mutating request - including likes, progress, and settings, which `FILETUBE_READ_ONLY_MEDIA` deliberately keeps writable - is refused with 403, except login/logout, first-run setup, and the relocation dry-run preview. For instances that exist to be photographed (screenshot baselines) or otherwise must not change. Caveat: media-serving GETs can still write to the transcode/rendition cache (self-healing, disclosure-grade). |
| `GET /api/admin/backup` | Downloads a full JSON backup of the instance (library state, settings, custom logo). `POST /api/admin/restore` restores it. In v1.42 these are as open as the rest of the API; v1.43 puts them behind admin auth. |

v1.42 also raises the minimum Node version to **22.13** (the Docker image
already ships Node 22; only bare-metal installs on Node 20 need to upgrade).

## Staying up to date (or pinning a version)

Set `FILETUBE_IMAGE_TAG` in your `.env` to choose how you track updates:

| Tag | Behavior |
|-----|----------|
| `latest` | Newest **release** (recommended for most people) |
| `1.4.2` | Pinned to an exact version - never moves |
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

## Optional: YouTube subscriptions (yt-dlp)

FileTube can optionally subscribe to YouTube channels and periodically
download their new videos into a media folder that the normal library scanner
already indexes - the downloaded videos then show up in the regular FileTube
UI like any other file, with no separate player or catalog. Deleting one in
FileTube removes it from disk (and it stays deleted; the next poll will not
re-download it).

This feature is **off by default and fully additive**. When disabled (the
default), it is a clean no-op: no extra routes, no nav link, no background
polling, and no assumption that `yt-dlp` is even installed. Existing
installs are completely unaffected unless you opt in.

## Enabling it

Set `FILETUBE_YTDLP_ENABLED=true` in your `.env` (or the container's
environment) and restart. The Docker image already bundles a pinned
`yt-dlp`, so no extra setup is required - a **Subscriptions** link appears
in the UI once enabled.

| Variable | Default | What it does |
|----------|---------|---------------|
| `FILETUBE_YTDLP_ENABLED` | off | Master switch. Only `true`, `1`, or `yes` enable the feature; anything else (including unset) stays disabled. |
| `FILETUBE_YTDLP_COOKIES_FILE` | unset | Path (inside the container) to a mounted `cookies.txt`, used for members-only or age-gated videos. Unset = no cookies. |
| `FILETUBE_YTDLP_POLL_MINUTES` | `60` | How often, in minutes, FileTube checks subscriptions for new videos. `0` = manual re-pull only (no background poll). |
| `FILETUBE_YTDLP_DOWNLOAD_DIR` | `<DATA_DIR>/ytdlp-downloads` | Where downloaded videos are saved. |
| `FILETUBE_YTDLP_VERSION` | (build-time) | Informational only - reflects the `yt-dlp` version pinned into the image. Does not trigger or change an install. The subscriptions page footer shows the probed binary version with a staleness note past 90 days. To update yt-dlp: bump the `YTDLP_VERSION` ARG in the Dockerfile and rebuild the image (locked decision D5 - there is no runtime auto-update). |
| `FILETUBE_YTDLP_MAX_VIDEOS` | `25` | Caps each channel's listing to its newest N videos, so a fresh subscribe (or any re-pull) never attempts a channel's entire back-catalog. `0` = unlimited (consider the whole channel). |
| `FILETUBE_YTDLP_MAX_DURATION_SECONDS` | `7200` | Skips videos longer than this many seconds (default 2h), so very long items and live streams aren't auto-downloaded. Each subscription can override it on the Subscriptions page. `0` = no length limit. (Videos with an unknown length are skipped, so a capped subscription never accidentally records an unbounded live stream.) |
| `FILETUBE_YTDLP_DOWNLOAD_TIMEOUT_MINUTES` | `180` | Ceiling (minutes) for a single download before it's killed and treated as a failure. Raise this if you download very large/multi-gigabyte videos on a slow connection. Must be an integer from `1` to `1440`; anything else falls back to the default. |
| `FILETUBE_YTDLP_SLEEP_REQUESTS` | `1` | Seconds to sleep between metadata requests (`--sleep-requests`), applied to both the channel listing pass and downloads. Helps avoid bot-checks/429s. Must be an integer from `0` to `60`; anything else falls back to the default. |
| `FILETUBE_YTDLP_SLEEP_INTERVAL` | `2` | Minimum seconds to sleep before each download (`--sleep-interval`). Must be an integer from `0` to `60`; anything else falls back to the default. |
| `FILETUBE_YTDLP_MAX_SLEEP_INTERVAL` | `5` | Maximum seconds to sleep before each download (`--max-sleep-interval`), randomized between `FILETUBE_YTDLP_SLEEP_INTERVAL` and this value. Must be an integer from `0` to `60`; anything else falls back to the default. Always clamped to be at least `FILETUBE_YTDLP_SLEEP_INTERVAL`. |
| `FILETUBE_YTDLP_RETRIES` | `5` | Number of times yt-dlp retries a failed download/fragment (`--retries`) before giving up. Must be an integer from `0` to `20`; anything else falls back to the default. |
| `FILETUBE_YTDLP_PLAYER_CLIENT` | unset | Advanced: forces a specific YouTube player client (`--extractor-args youtube:player_client=<value>`), e.g. `web` or `android,web`. Unset by default - yt-dlp picks its own client(s). Only lowercase letters, digits, `_`, `,`, and `-` are accepted; anything else (or unset) means no flag is emitted. |
| `FILETUBE_YTDLP_SOCKET_TIMEOUT_SECONDS` | `15` | Per-request socket timeout passed to yt-dlp (`--socket-timeout`). Under bot-detection YouTube hangs connections rather than erroring; this converts dead sockets into fast, retryable failures. Integer from `5` to `120`; anything else falls back to the default. |
| `FILETUBE_YTDLP_LIST_TIMEOUT_MINUTES` | `5` | Base budget for a channel's metadata LIST pass. The effective budget additionally scales with `LIST_SCAN_CAP` × `SLEEP_REQUESTS` (the pacing a cap-bounded listing can legitimately need), capped at 60 minutes. Integer from `1` to `60`. |
| `FILETUBE_YTDLP_LIST_SCAN_CAP` | `200` | Hard cap on how many playlist entries a LIST pass may enumerate (`--playlist-end`) - the wall-clock backstop behind the break-early filter that stops listing at the first pre-cutoff video. `0` disables the cap. Integer from `0` to `10000`. |
| `FILETUBE_YTDLP_STALL_MINUTES` | `10` | Stall watchdog: a download producing NO output for this many minutes is killed with a specific "stalled" reason (instead of waiting out the full download timeout while blocking the queue). `0` disables the watchdog. Integer from `0` to `120`. |
| `FILETUBE_YTDLP_BREAKER_FAILURES` | `4` | Circuit breaker: after this many CONSECUTIVE channel failures in one poll run, the rest of the run is aborted and retried later with backoff (stops a throttled session from cascading across every remaining channel). `0` disables the breaker. Integer from `0` to `50`. |
| `FILETUBE_YTDLP_BREAKER_BACKOFF_MINUTES` | `30` | How long a tripped circuit breaker waits before automatically retrying the poll. Integer from `1` to `1440`. |

**Recommendation:** point `FILETUBE_YTDLP_DOWNLOAD_DIR` at a dedicated
directory - not an existing mapped library folder, and not an ancestor
directory of one.

## Text-to-speech (TTS): "Listen from Here" (v1.38, works out of the box)

Read your EPUB books aloud from the paragraph you're on - playback continues on
the lock screen with the book cover as artwork. Synthesis runs one chapter at a
time and automatically **defers while a subscription download is in progress** so
the two never spike your CPU/disk together.

**Works out of the box:** the Docker image bakes in **espeak-ng**, so the
reader's **Listen** button lights up with no configuration. espeak-ng is tiny and
robotic - a clear, functional narrator, not a natural voice.

**Upgrade to a natural voice (opt-in):** point FileTube at
[Piper](https://github.com/OHF-Voice/piper1-gpl) - a much more human-sounding
engine - by providing its binary + a `.onnx` voice model and switching the
engine. Piper isn't bundled (its `onnxruntime` dependency has no musl/Alpine
wheels and would add ~300 MB to the image), so it's opt-in for those who want
the better voice. FFmpeg (already in the image) encodes the audio for both
engines.

| Variable | Default | Purpose |
|---|---|---|
| `FILETUBE_TTS_ENGINE` | `espeak-ng` *(image)* / `piper` *(code)* | Which engine to use: `piper` or `espeak-ng`. The Docker image defaults to the bundled `espeak-ng`; set `piper` (with a model below) to upgrade. |
| `FILETUBE_TTS_PIPER_BIN` | `piper` | Path to the `piper` binary (PATH-resolved by default). |
| `FILETUBE_TTS_PIPER_MODEL` | unset | Path (inside the container) to a Piper `.onnx` voice model. **Required** for Piper to activate. |
| `FILETUBE_TTS_PIPER_CONFIG` | `<model>.json` | Path to the model's config JSON. Defaults to piper's own `<model>.onnx.json` convention. |
| `FILETUBE_TTS_ESPEAK_BIN` | `espeak-ng` | Path to the `espeak-ng` binary (PATH-resolved; bundled in the image). |
| `FILETUBE_TTS_ESPEAK_VOICE` | `en` | espeak-ng voice id. |

> **Upgrading from v1.38.0?** If you already had Piper working by mounting a
> model and setting **only** `FILETUBE_TTS_PIPER_MODEL` (relying on the old
> `piper` default), add `-e FILETUBE_TTS_ENGINE=piper` - the image now defaults
> to the bundled `espeak-ng`, so without that flag your Piper model is ignored
> and you'd hear the robotic voice instead.

Synthesized chapter audio is cached under `<DATA_DIR>/tts-cache/`. There is no
automatic size/age eviction yet (it's cleared by "Clear cache now" in Settings
and when a book is removed) - a known limitation for very large libraries.

## Members-only / age-gated content

Members-only and age-gated videos require cookies from a logged-in YouTube
session. To support these:

1. Export a `cookies.txt` from a signed-in browser session (e.g. with a
   cookies-export extension) and mount it into the container, read-only:

   ```yaml
   volumes:
     - /path/to/your/cookies.txt:/app/data/cookies.txt:ro
   ```

2. Set `FILETUBE_YTDLP_COOKIES_FILE=/app/data/cookies.txt` to point at it.
3. Turn on the **"Allow members-only content"** toggle on the Subscriptions
   page.

Members-only videos are only ever downloaded when **both** the toggle is on
**and** a cookies file is configured - either one missing means they're
skipped. This is fail-safe by design: an unconfigured or misconfigured
cookies file simply results in members-only videos being skipped, never a
crash or a silent bypass.

## Deduplication depends on a persistent download directory

The "deleted stays gone" guarantee above (and dedup in general - a channel
re-poll never re-downloading a video it already has) relies on a single
module-owned file, `.ytdlp-archive.txt`, stored directly inside
`FILETUBE_YTDLP_DOWNLOAD_DIR`. Every completed download records its id there,
and every poll checks it before downloading anything.

That file has to actually persist for the guarantee to hold. If
`FILETUBE_YTDLP_DOWNLOAD_DIR` points at a network share (SMB/NFS/etc.) and
the share is unmounted or unreachable at poll time, or if the download
directory is wiped for any other reason, dedup state is lost - the next poll
has no record of what was already fetched and will re-download each
subscribed channel's videos, up to its `FILETUBE_YTDLP_MAX_VIDEOS` window.
**Recommendation:** keep the download directory (and the archive file inside
it) on storage that is always mounted and reliably persistent, the same way
you'd treat `DATA_DIR`.

## Keeping yt-dlp up to date

The bundled `yt-dlp` binary is **pinned inside the Docker image** at build
time - there is no runtime or in-app auto-update. To pick up a newer
`yt-dlp` release, pull or rebuild a newer FileTube image (see
[Staying up to date](#staying-up-to-date-or-pinning-a-version), above).

---

## Podcasts (v1.69.0)

Podcasts is a first-class library place (like Music and Books): no enable
flag. Subscribe to any podcast RSS feed from the **Podcasts** page - public
feeds, or private tokened ones (e.g. Patreon's "listen in other podcast
apps" URL). The nav entry appears once you have at least one subscription.

Private feed URLs carry a personal access token. FileTube stores the full
URL only in `<DATA_DIR>/podcast-feeds.json` (file mode 0600) - it never
appears in the UI, logs, API responses, or backup bundles. A backup
restored onto a fresh machine therefore restores the subscriptions but asks
you to re-enter each tokened feed's URL once.

| Variable | Default | What it does |
|----------|---------|---------------|
| `FILETUBE_PODCASTS_DIR` | `<DATA_DIR>/podcasts` | Where episode files are saved (one folder per show). Point it at your media volume if you want episodes on the big disk. |

Per-subscription download policy is chosen at add time: every episode (the
default - a true offline cache; note a large back-catalog can be tens of
GB), the latest N, or new episodes only. The feed check interval is set on
the Podcasts page (default 60 minutes, `0` = manual checks only).
