# Future plan: MeTube / yt-dlp delete-sync

**Status:** Deferred (analyzed 2026-07-04, not yet scheduled). Documented so the
recon isn't lost.

## Goal

When a video is deleted in FileTube, keep MeTube (a self-hosted yt-dlp web
downloader) in sync so its record doesn't go stale and it re-downloads correctly.
Envisioned as a per-library **"yt-dlp / MeTube library"** flag (opt-in checkbox),
so normal libraries are untouched.

Confirmed intent: **delete = "forget it, allow re-download"** (remove it from
whatever "already downloaded" record MeTube consults).

## Recon findings (from the user's actual host, 2026-07-04)

MeTube compose:
- `DOWNLOAD_DIR=/downloads` → host `/srv/docker/metube/data`
- `STATE_DIR=/downloads/.metube`
- `DELETE_FILE_ON_TRASHCAN=true` (MeTube→file; the *reverse* of what we want)
- **`YTDL_OPTIONS` is NOT set** → no `download_archive`, no `writeinfojson`, default
  title-based output template. Only `METUBE_ARGS=--embed-thumbnail --add-metadata`.

Shared storage (**the enabler**):
- Host `/srv/docker/metube/data` is mounted into MeTube as `/downloads` **and** into
  FileTube as `/media/videos` (**read-write**). FileTube already sees MeTube's files
  and the `.metube/` state dir.

The three blockers with the setup **as-is**:
1. **No IDs recoverable from files.** Filenames are plain `Title.ext` — no
   `.info.json` sidecars, no `[videoID]` in the name. The only place tying
   filename ↔ video id ↔ URL together is `completed.json`.
2. **FileTube can't read `completed.json`.** It's `0600` owned by uid 1000; the NFS
   share root-squashes and FileTube runs as root → **read denied**. (It *can*
   delete/replace files in the group-writable dirs — that's why its delete works —
   but it cannot read-modify-write `completed.json`.)
3. **`completed.json` is held in memory by MeTube** and only written out, so an
   external on-disk edit wouldn't take effect until MeTube restarts. MeTube also
   exposes **no documented delete/history API** (only `/add`).

`completed.json` shape (schema_version 2): `{ items: [ { key: <full URL>,
info: { id: <11-char id>, filename: <on-disk name>, ... } } ] }`. Keyed by URL;
id and filename are inside `info`.

## Options (with honest trade-offs)

### A — Make MeTube legible, then FileTube syncs (forward-looking)
Add ~2 lines to MeTube `YTDL_OPTIONS`: `writeinfojson: true` (new downloads drop a
`Title.info.json` FileTube *can* read → gets the id) + a `download_archive` file in
the **shared, FileTube-writable** folder. Then a FileTube per-library flag → on
delete: read the sidecar id, remove that line from the archive, delete the sidecars.
- ✅ Clean, proper FileTube feature; matches "forget → re-download."
- ⚠️ **Forward-only** (existing ~19 completed items have no sidecar).
- ⚠️ **Unverified:** does MeTube re-download based on the yt-dlp `download_archive`,
  or purely on its own `completed.json` dedup? **Must test before committing to this.**
- ⚠️ Archive file needs group-write so both MeTube (uid 1000) and FileTube
  (squashed-root, group `users`) can write it (set `664` / MeTube `UMASK=002`).
- ⚠️ MeTube's Completed **UI list** stays stale (we don't touch `completed.json`).

### B — Host-side reconciliation (most robust for "keep the list clean")
A small script run **as the MeTube user (uid 1000)** — e.g. a cron, or the user's
host agent — that prunes `completed.json` (and archive if present) of any entry
whose `info.filename` no longer exists on disk, then restarts MeTube.
- ✅ Fixes the stale list at the source; covers **existing** files; source-agnostic
  (any deletion, not just FileTube's).
- ⚠️ Not a FileTube feature (a MeTube-host job); needs a **MeTube restart** to apply.

### C — Safe FileTube win now (do regardless)
On delete, FileTube also removes companion files (`.info.json`, `.description`,
`.srt/.vtt`, thumbnails) with the same basename.
- ✅ Useful independent of MeTube; zero coupling. Doesn't fix the sync itself.

## Recommendation

**B is the most robust** for the described pain (stale list + existing files), and
plays to the user's host agent. **A** is the "proper FileTube feature" but forward-
only and rides on the unverified archive-vs-`completed.json` assumption. **C** is
worth doing in FileTube regardless. A and B/C are not mutually exclusive.

## Open question to resolve first

**Does MeTube honor the yt-dlp `download_archive` for re-download, or dedup purely on
`completed.json`?** A 2-minute test (add an archive, download, delete + prune the
archive, re-trigger) settles whether Option A can work at all.

## Sources
- MeTube: https://github.com/alexta69/metube
- yt-dlp `--download-archive`: https://github.com/yt-dlp/yt-dlp/issues/2754
