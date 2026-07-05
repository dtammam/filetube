# Future plan: optional yt-dlp integration module

**Status:** Parked — for the branch *after next* (2026-07-05). Documented so the
vision and the architectural take aren't lost. Do NOT start this now.

**Supersedes** [metube-yt-dlp-sync.md](metube-yt-dlp-sync.md): that plan kept
MeTube and only synced deletes. This plan instead **replaces MeTube** with a
native, optional yt-dlp module so there is one source of truth and the orphaned-
record problem disappears by construction.

## The problem (user's words, condensed)

Running MeTube alongside FileTube for automated subscription downloads works, but
the two systems don't talk: delete a video in FileTube and MeTube still lists it
as if it exists — two sources of truth, orphaned records, ongoing babysitting.
MeTube is just a web wrapper around yt-dlp; the only thing it uniquely provides is
automated subscription downloading. Everything about presenting/managing media,
FileTube already owns.

## What to build

An **optional** yt-dlp integration for FileTube: FileTube talks directly to its
own yt-dlp under the hood, downloads land in FileTube's media dir, show up in the
existing UI, and deleting removes them everywhere. One system, one truth. A
**simple, limited** subscription UI — explicitly NOT a MeTube rebuild / not a
full download manager.

### Behaviors actually needed
- Subscribe to a channel by URL; unsubscribe / delete a channel.
- Per channel: audio-only or video; quality.
- Dedupe: skip things already pulled.
- Skip member-only / members-only content — **kept easy to update** (YouTube
  changes this over time; must not be hardcoded deep in the guts).
- Premiere handling: delay premiered videos by ~2h (they fail if grabbed right at
  premiere; a buffer makes them reliable).

### The loop
A background job polls subscribed channels on a schedule, applies each channel's
prefs + skip rules, downloads into the media dir; the existing scanner + UI
surface them.

## My architectural take (what the user asked for)

### Module vs standalone → **toggleable in-process module. Not standalone.**
The entire motivation is "one source of truth, no orphans." A standalone service
that FileTube "points at" structurally reintroduces the exact two-systems /
two-truths problem we're trying to escape — you'd be rebuilding the MeTube
coordination seam under a new name. So: keep it **in-process**, gated behind a
config flag, dormant when off.

Concretely, to keep the core lean:
- **Dormant-by-default module.** Code lives in its own module file(s)
  (e.g. `lib/subscriptions/`), and when the flag is off it registers no routes,
  starts no job, and assumes no yt-dlp binary present. The core stays exactly as
  lean as today.
- **Keep the base Docker image slim.** yt-dlp + its ffmpeg needs are a real
  weight. Ship them in a **separate image variant** (e.g. a `filetube:…-downloader`
  tag, or a build-arg that adds yt-dlp), rather than bloating the base image
  everyone pulls. The module detects yt-dlp at startup and stays disabled with a
  clear log if the flag is on but the binary is absent.
- **Reuse the persistence we just hardened.** Subscription config in `db.json`
  (or a sibling `subscriptions.json`) written through the v1.9.0 `updateDatabase`
  serialized primitive — one writer, no clobber, atomic.

### Subscription config + polling shape
- `subscriptions: [{ id, channelUrl, name, format: 'audio'|'video', quality,
  addedAt, lastCheckedAt }]`.
- **Dedupe via yt-dlp's built-in `--download-archive`** (a file the module owns).
  The earlier MeTube recon found MeTube did NOT use one — a native module should,
  giving clean, restart-safe dedupe without maintaining our own "already got it"
  set. Deleting in FileTube = remove that id from the archive → re-downloadable
  (matches the user's stated delete semantics).
- Downloads land in a per-channel folder under the media dir → the **existing
  scan pipeline** indexes them → they appear in the UI. This reuses everything
  FileTube already does; the module only has to *fetch*.
- Poll on an interval, modeled on `armScanTimer` (settings-driven, `.unref()`'d).

### Skip / premiere logic — the parts I'd design deliberately
- **Member-only skip = a small, isolated rules layer, fail-safe.** A single
  well-named `shouldSkip(videoMeta)` (plus maybe a config file of skip-reason
  patterns the module reads at runtime) so that when YouTube changes wording you
  edit ONE place — ideally without a redeploy. Prefer yt-dlp's structured
  availability metadata over string-matching error text where possible, and
  **fail safe**: on uncertainty, skip + log clearly rather than download the wrong
  thing.
- **Premiere delay via poll-and-defer, NOT a live timer.** yt-dlp exposes
  `live_status` / `release_timestamp`. When a poll finds a premiere whose
  `release_timestamp + 2h` is still in the future, just **skip it this cycle**;
  a later poll picks it up once the window passes. This is idempotent
  (the download-archive prevents dupes) and **restart-safe** — no dangling
  per-video timers to lose across a restart. (Lesson carried from the v1.9.0
  deferred-rescan work: prefer poll-and-defer over standalone timers.)

### Open decisions to settle at kickoff
- Exactly where subscription config lives (db.json vs sibling file).
- Whether the download job runs in-process or as a spawned worker (long downloads
  shouldn't block the event loop — likely spawn yt-dlp as a child process and
  stream progress, which it already supports).
- The skip-rules config format (inline vs a mounted file) for the "easy to update"
  requirement.

## Not now
The user explicitly wants this parked for the branch after next. Align on the
shape (above) first; don't spec every detail yet.
