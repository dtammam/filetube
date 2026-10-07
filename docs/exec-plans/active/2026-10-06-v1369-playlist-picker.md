---
plan: v1369-playlist-picker
harness: v2 · lean
branch: feat/v1.369.0-playlist-picker
anchor: outcome
status: Building (T0 measured on the dev box 2026-10-07)
next: a Sonnet builder runs T0 and W1-W5, then the gate (section 6), then the release (section 7)
design: Dean's intake 2026-10-06 (Opus kickoff session, rulings R1-R14 below). Base main 5f1dcc1b. Ships after v1.368.0 (radio), before v1.370.0 (subtitles, 360, cleanup).
gate: pending
---

# v1.369.0: YouTube playlist links: ask, pick the videos, download them as one job

Raised mid-kickoff (Dean, 2026-10-06, example `https://www.youtube.com/watch?v=U3P8pUboZ5g&list=PLUtyNbQXMTLg`): "I'd want it to
recognize it's a playlist and maybe have a menu showing what the things are and let one select what to download." Version order
(Dean): radio v1.368.0, this v1.369.0, subtitles + 360 + cleanup v1.370.0. If v1.368.0 has not shipped when this is ready, wait,
merge main, release. Norms: no em dashes in docs or user prose; stage files by name; `git commit -F <file>`; never pipe a
commit or push; export the fnm Node 22.23.1 PATH before any node/npm/git command.

Read first: AGENTS.md, docs/LESSONS.md sections 0, 2 (inert feature: drive yt-dlp's REAL flat-playlist JSON, never a hand-typed
shape), 4 (sheets bound to `viewSignal`, activation guard), 9 (a new persisted record), 10 (access control: every new route,
the token surface), 11 (yt-dlp flags verified at SOURCE), 12 (sibling lists, censuses).

## Step 0. Before anything (builder)

- Work ONLY in the existing worktree `.claude/worktrees/v1369pl` on branch `feat/v1.369.0-playlist-picker` (the plan is committed there; `node_modules`
  is a symlink to the main checkout's, never stage it). Do not touch the main checkout or the other release worktrees.
- Before every node / npm / git command: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
  Dual-Node runs use 22.23.1 then 24.20.0, sequential (Node 24 prints `ℹ`, not `#`).
- Git: stage files by name (never `git add .` / `-A`), `git commit -F <file>`, never pipe a commit or push, verify with
  `git log -1` and `git ls-remote`; never `--no-verify`, never force-push, never self-merge (the gate runs first).
- Read AGENTS.md, then the LESSONS sections this plan names, then this plan top to bottom.
- Stop and ask Dean (AskUserQuestion) when: a ruling contradicts what the code or a measurement shows; a change turns out to
  delete or migrate data (that forces the full gate); the gate reaches round 3; `gh pr merge` is refused by the classifier.
- T0 runs yt-dlp on Dean's production container; if you cannot reach it, ask Dean to run the command and send the output.
- If T0 shows a yt-dlp behaviour that contradicts a ruling (for example flat entries lack titles, or Load more cannot page),
  stop and ask.
- If the waiting-playlist store needs a schema migration, the data-loss rule forces the full gate: say so before building it.

## 1. Outcomes

1. A link that carries a playlist is recognised. A `watch?v=X&list=Y` link asks "Just this video" (today's download, one tap) or
   "Choose from the playlist...". A `/playlist?list=Y` link goes straight to the picker.
2. The picker lists the playlist's videos (thumbnail, title, length, "Already in library" greyed and not tickable), nothing
   ticked except the linked video, Select all / none; Download sends the ticked ones as ONE playlist job; a "Subscribe to this
   playlist" button subscribes to the right `/playlist?list=` URL.
3. It works from the in-app download box (and the /subscriptions page's one-off form), from the desktop browser extension, and
   from the iPhone Shortcut WITHOUT leaving the home-screen app (Dean: "I don't want to exit PWA on phone").

## 2. What exists (kickoff recon 2026-10-06 against main 5f1dcc1b; re-verify line numbers)

- **Today:** `rebuildQueryAllowlist` (lib/ytdlp/url.js:187-213) keeps only `v` on a non-`/playlist` path, so `list=` is dropped
  silently and one video downloads; `/playlist?list=` is a 400 "URL is a channel/playlist/handle, not a single video"
  (`classifySingleVideo` url.js:785-837, :823-824; `classifyOneOffUrl` :530-541). `isSafeIdParam` (:247-256): `[A-Za-z0-9_-]`,
  1-64. `/embed/videoseries` is excluded (:80-91). The `watch?list=` (no v) error leaks the internal name `channelUrl` (:755).
  No test passes `watch?v=X&list=Y` anywhere (gap).
- **Download box:** `injectOneOffDownloadButtonIfEnabled` (public/js/common.js:7431-7638), `buildOneOffModal` (:6277) in a
  `U.sheet` (ui.js:450: `setContent`, `body`, `guard`), `submitOneOffDownload` (:7504) -> `POST /api/ytdlp/download`
  (lib/ytdlp/index.js:6345-6546; 202 `{accepted, jobId}` / joined / 400 / 403 / 503). Progress = the download status chip
  (`injectDownloadStatusChip`, polls `GET /api/subscriptions/status`, `oneShots[jobId]`, Retry/Cancel :16091). A second one-off
  form: lib/ytdlp/client/subscriptions.js:4143-4170. Primitives: `ui.list`, `ui.row`, `ui.thumb({src,duration})` (:312),
  `showChoiceModal` (common.js:12802), `showConfirmModal` (:12756, viewSignal-bound), activation guard (ui.js:359-376,
  `ACTIVATION_GUARD_MS = 450`; call `ctrl.guard(node)`). No checkbox primitive (use `ui.switch` or a native checkbox row:
  builder states the choice; lint:ui ratchet applies).
- **Extension:** extension/ MV3, popup 320px, `POST /api/ytdlp/download` with `X-FileTube-Token`; the token is accepted ONLY on
  that route (lib/auth/gate.js:286-301, `req.auditActor = 'api-token'`, RBAC-exempt at index.js:6351). `chrome.tabs.create`
  needs no extra permission.
- **Shortcut:** no PWA share_target, no /share route; an iOS Shortcut POSTs the link (`text/plain` accepted, index.js:6310-6348)
  with the token and shows the JSON reply.
- **Listing:** `buildYtdlpListArgs` (args.js:1036) + `runList` (run.js:1474) are subscription-bound, use `--download-archive`
  (hides archived entries) and full `--dump-json` (slow: ~3 requests per entry plus pacing). `--flat-playlist` is used nowhere.
  `probeChannel` (run.js:1545) is the posture to copy: short timeout (`PROBE_TIMEOUT_MS` 30 s, run.js:157), never rejects,
  OUTSIDE the heavy gate (as the one-off folder probe, index.js:4174, :4440). Cap `FILETUBE_YTDLP_LIST_SCAN_CAP` default 200
  (config.js:156-158, :295-298, :470).
- **In library:** no youtubeId index; items carry `item.youtubeId` in `db.metadata` (orchestrator.js:910, :1128). The ytdlp
  module reaches the library only via deps (server.js:6839-6873, `mediaVisibleTo`). The download archive means "ever
  downloaded" (incl. deleted): NOT the same as in library.
- **Batch:** the download route takes one URL; `MAX_ONESHOT_QUEUE_LENGTH = 50` (index.js:513, equal to
  `pending.MAX_PENDING_ONESHOTS`, asserted :520); subscriptions already download a target id list in one run
  (`runDownload(sub, config, targetIds)`, run.js:2180). Each accepted one-shot persists via `pending.addPending`.
- **Permissions:** download = admin or a member with `canManageSubscriptions` (`requireManageSubscriptions`, server.js:3347).
  Subscribe: `POST /api/subscriptions` (index.js:5854) already accepts `/playlist?list=`; `buildSubscribeModal` (common.js:1588).
- **Censuses a new route trips:** rbac-census `EXPECTED_ROUTE_COUNT` (265 today, test/integration/rbac-census.test.js:77),
  route-read-classification, route-write-classification (both maps), route-census (401 unauthenticated).

## 3. Measurements

**T0 (builder, on Dean's production container, read-only, before W2's timeout and cap are fixed):** time and output shape of
`yt-dlp --flat-playlist -J --playlist-end 200 -- <url>` (and `--dump-json` per line) for: a normal 30-video playlist, a
300+ video playlist, Dean's example link's list (`PLUtyNbQXMTLg`, which is 13 chars against the usual 34: expect an error,
record its exact stderr), a Mix (`list=RD...`). Record per run: wall time, entry count, which of `id`, `title`, `duration`,
`thumbnails`, `url`, `channel`, `channel_id`, `availability` are present, and how private/deleted entries appear. Copy outputs
verbatim into section 7 (LESSONS 1, 11). If the container's yt-dlp cannot be run by the builder, ask Dean to run the one
command and send the file.

## 4. Rulings (Dean, 2026-10-06 unless marked)

| # | Question | Ruling |
|---|----------|--------|
| R1 | Recognise | `watch?v=X&list=Y` asks first: "Just this video" (today's behaviour) or "Choose from the playlist...". `/playlist?list=Y` opens the picker directly. |
| R2 | Default ticks | Nothing ticked except the linked video; Select all / none at the top; "Already in library" rows greyed and not tickable. |
| R3 | Surfaces | In-app download box (and the /subscriptions one-off form), browser extension, iPhone Shortcut. |
| R4 | Subscribe | A "Subscribe to this playlist" button in the picker, using the canonical `/playlist?list=Y` URL (fixes the trap where the Subscriptions form subscribes to one video given a watch&list link). |
| R5 | Mix and personal lists | Mix (`list=RD...`): no picker, just this video, with a note ("This is a YouTube Mix; downloading just this video"). Watch Later / Liked (`WL`, `LL`): the picker only if a cookies file is configured, else the same just-this-video note. |
| R6 | Long lists | The first 200 (the list cap), then "Load more" (the next 200); Select all applies to what is loaded and says how many. |
| R7 | Download shape | ONE playlist job: one progress row "<Playlist>: 12 of 40", one Cancel, failed videos retried together. Not N one-shots (avoids the 50 queue limit). |
| R8 | Folder | Each video lands in its channel's folder, exactly as a single download does. |
| R9 | iPhone Shortcut | Never leaves the home-screen app: the Shortcut posts as today; a playlist link (R1 shapes) is NOT downloaded but kept as "Playlist waiting: choose videos"; the Shortcut's reply says "Open FileTube to choose". In the app the download chip shows the waiting playlist, and a push notification (if push is on; tapping it opens the home-screen app) points to it. Opening it shows R1's choice then the picker. No Shortcut changes. |
| R10 | Extension | On a tab whose URL carries `list=` (not a Mix), the popup adds "Choose from playlist..." which opens FileTube's picker in a new tab (`chrome.tabs.create`, the user's normal login). Audio / Video keep one-video downloads. The API token gains NO new route. |
| R11 | "Already in library" (kickoff default) | A video whose `youtubeId` is in the VIEWER's visible library (`mediaVisibleTo`), not the download archive. |
| R12 | Format / quality (kickoff default) | The picker uses the download box's Format / Quality / File type selections; from the extension tab and a waiting playlist, the same controls show above the list with the box's defaults. |
| R13 | Waiting playlists (kickoff default) | Persisted (survive a restart), visible to every user allowed to download (admin or `canManageSubscriptions`), dismissible, auto-expire after 7 days; at most 20 waiting (oldest dropped). |
| R14 | Bad list (kickoff default) | A list yt-dlp cannot read (Dean's 13-char example may be one: T0) shows "Couldn't read this playlist" with "Just this video" still offered when the link has a `v`. |

## 5. Waves (each has a falsifier; run it and paste the output)

### W0. Housekeeping (first commit, docs only)
- This plan; ROADMAP Planned item "YouTube playlist links" (the four gaps the recon found: silent drop, subscription trap, error
  wording with `channelUrl`, no `watch?v&list` test) marked "in v1.369.0".

### W1. Recognise (server, pure)
- New pure `classifyPlaylistLink(url)` in url.js that runs on the RAW input before `rebuildQueryAllowlist`: returns
  `{kind:'none'}`, `{kind:'watch-in-list', videoId, listId}`, `{kind:'playlist', listId}`, `{kind:'mix', videoId, listId}`,
  `{kind:'personal', videoId?, listId}` (WL/LL). Hosts: youtube.com, m., music., youtu.be (`?list=`). Same id safety as
  `isSafeIdParam`. `classifyOneOffUrl` stays unchanged for every caller that does not opt in (the extension's Audio/Video and
  older Shortcut replies).
- Fix the user-facing `channelUrl` wording (url.js:755). Add the missing `watch?v=X&list=Y` tests (today's single-video
  behaviour for a non-opting caller).
- **Falsifier:** a table test over every shape (including share-sheet wrapped text, `&index=`, `&si=`, `&pp=`, `music.` album
  `OLAK...`, `youtu.be/X?list=Y`, `RD...`, `WL`, `LL`, `watch?list=Y` with no v, Dean's exact example) with exact outputs;
  mutants: drop the mix arm (RD treated as playlist: red), run after the allowlist (list lost: red).

### W2. List a playlist (server)
- New `buildYtdlpPlaylistPreviewArgs` (`--flat-playlist`, `-J` or `--dump-json` per T0, `--playlist-start/--playlist-end` for
  pages of 200, cookies when configured, NO `--download-archive`, `--` then the canonical `/playlist?list=` URL; every flag
  verified against yt-dlp SOURCE, LESSONS 11) and a runner with `probeChannel`'s posture (timeout from T0, never rejects, outside
  the heavy gate, a per-list single-flight so a double tap does not run twice).
- New read route (e.g. `GET /api/ytdlp/playlist?url=&page=`): `requireManageSubscriptions`; returns `{title, listId, total?,
  entries:[{id, title, durationSec, thumb, inLibrary, unavailable}], nextPage}`; `thumb` falls back to
  `https://i.ytimg.com/vi/<id>/mqdefault.jpg` (check the CSP allows it, or proxy as existing thumbs do: builder verifies);
  `inLibrary` from a new dep `libraryYoutubeIds(req)` that goes through `mediaVisibleTo` (R11; LESSONS 10: a hidden folder's
  ids must not leak).
- Censuses: rbac-census +1, route-read-classification (GATED), route-census.
- **Falsifier:** fixtures are VERBATIM yt-dlp flat-playlist output captured in T0 (LESSONS 2), through the real spawn boundary
  with a fake binary emitting it; a negative control (malformed JSON, timeout, private entries); a member with a hidden folder
  sees `inLibrary:false` for that folder's video; mutants: add `--download-archive` (an archived entry vanishes: red), drop
  `mediaVisibleTo` (leak test red), drop single-flight (double request spawns twice: red).

### W3. One playlist job (server)
- New write route (e.g. `POST /api/ytdlp/download-playlist` `{listId, title, ids[], format, quality, filetype}`):
  `requireManageSubscriptions`; ids validated by `isSafeIdParam`, deduped, capped (the list cap); ONE job that downloads the
  ids with the one-shot download path's args (each video to its channel folder, R8), persisted like a one-shot (pending store)
  so a restart resumes it; the activity/status payload carries `{title, done, total, failedIds}` so the chip shows
  "<Playlist>: 12 of 40" (R7); Cancel stops the job; Retry re-sends only `failedIds`.
- route-write-classification (both maps, 'manage-subs'), rbac-census +1.
- **Falsifier:** a fake yt-dlp that succeeds on some ids and fails on others: the status shows exact counts and `failedIds`;
  Retry sends only those; a restart mid-job resumes the remainder (persisted); 60 ids are accepted as one job (no 503);
  mutants: N one-shots instead of one job (count red), retry all (red), a member without `canManageSubscriptions` (403 test red
  when the guard is removed).

### W4. The picker (client) + the waiting playlist (server + client)
- Download box and the /subscriptions one-off form: on submit, the client asks the server to classify (or classifies with the
  same rules imported, never a second copy: LESSONS 12); `watch-in-list` -> `showChoiceModal` "Just this video" / "Choose from
  the playlist..."; `playlist` -> the picker; `mix` / `personal` without cookies -> the one-video download with the note (R5).
- The picker inside the same sheet (`setContent`): header (playlist title, count, Select all / none, "Subscribe to this
  playlist"), the R12 format controls, rows with thumb + title + length, "Already in library" greyed, "Load more", Download (N).
  Every new control `ctrl.guard`ed; the sheet passes `FileTube.viewSignal()` at open (LESSONS 4). Subscribe reuses
  `buildSubscribeModal` with the canonical URL.
- Extension (R10): popup detects `list=` (not `RD`), shows "Choose from playlist..." -> `chrome.tabs.create(instance +
  '/subscriptions?pick=' + encodeURIComponent(url))` (or a dedicated page: builder picks the shell that already hosts the
  download chip; the page opens the picker on load and the `?pick=` survives the login redirect, gate.js:238-243).
- Shortcut (R9): when the TOKEN caller posts an R1 shape (not mix/personal), the server stores a waiting playlist (R13) and
  replies 202 `{accepted:false, playlist:true, waiting:true, message:'Playlist found: open FileTube to choose'}`; the status
  payload lists waiting playlists; the chip shows "Playlist waiting: choose videos" and opens R1's choice then the picker;
  a push notification goes out via the existing push path if push is configured. Dismiss removes it. A non-token caller never
  creates a waiting entry (it gets the interactive flow).
- **Falsifier (real browser, LESSONS 2):** a Playwright run against a server with the fake yt-dlp: paste Dean's example shape in
  the download box -> choice -> picker -> tick 3 -> Download -> one chip row "…: 0 of 3" counting to 3; Select all; Load more;
  an in-library row is not tickable; the extension path: open `?pick=` signed out -> login -> picker opens; the Shortcut path:
  POST with the token -> 202 waiting -> the chip shows it -> picker. Mutants: the token caller downloads instead of waiting
  (red), the waiting entry survives Dismiss (red), the guard missing on Download (a double tap at 60 ms sends twice: red).

### W5. Close-out
- ROADMAP Shipped, releases.json ledger in user language, docs/CONFIGURATION.md (the Shortcut reply for playlists),
  extension version bump if the popup changed (check the extension's own release steps), LESSONS entry if the gate finds a class.
- Device checks owed by Dean: iPhone Shortcut from the YouTube app with a playlist link -> "Open FileTube to choose" -> the
  home-screen app shows the waiting playlist (and the push, if on) -> pick 3 -> they download to their channel folders; the
  in-app box on the phone and desktop; the desktop extension on a playlist tab.

## 6. Gate

Seats: adversary (floor) + qa + security-brief: new routes (one read over the library's youtube ids, one write that spawns
yt-dlp), the token route's new reply, user-supplied list ids into argv, and a persisted waiting list. Not data-loss (no
deletes, no schema migration unless the waiting list needs one: if it does, the data-loss rule forces the full gate). Name to
the seats: argv injection (ids and list ids into yt-dlp, `--` placement), the token surface (it must gain NO new route), RBAC
on both routes and the waiting list, `inLibrary` leakage, the 50-queue interplay, restart resume, the activation guard on
Download, reachability with the REAL flat-playlist JSON from T0. Pacing: ship on CRITICAL/WARNING closure; after 2 rounds,
ask Dean at round 3.

## 7. Release and evidence

Release per docs/RELEASING.md and AGENTS.md (`npm version 1.369.0 --no-git-tag-version`, ROADMAP Shipped, releases.json, dual
Node 22.23.1 + 24.20.0 sequential, protected main: tag the local no-ff merge, push branch + tag in ONE push, `gh pr create`,
required checks green, `gh pr merge --merge` on Dean's word if the classifier refuses, the tag's Publish Docker Image green in
every job, delete the branch remote + local).

**T0 (2026-10-07, run on the DEV BOX, not the production container).** Dean could not run it on production that day; T0 measures
yt-dlp's OUTPUT SHAPE and timing, which does not depend on the library, so the builder ran yt-dlp 2026.08.19 (the latest release,
downloaded to a scratch dir) with `--flat-playlist -J --playlist-end 200 -- <url>`. Production's yt-dlp version may differ (the
engine updater sets it); the shape below is what W2's fixtures are built from. Wall times include the network from this box.

| Case | Command URL | rc | wall | result |
|---|---|---|---|---|
| Dean's example list (13 chars) | `/playlist?list=PLUtyNbQXMTLg` | 0 | 3351 ms | `_type` playlist, title "Kyle Gordon Is Everywhere", 24 entries, `playlist_count` 24 |
| Dean's example as watch link | `watch?v=U3P8pUboZ5g&list=PLUtyNbQXMTLg` | 0 | 4530 ms | the same playlist (24 entries): yt-dlp expands a watch-in-list link by default |
| Mix | `watch?v=U3P8pUboZ5g&list=RDU3P8pUboZ5g` | 0 | 5338 ms | `_type` video, 0 entries; stderr `WARNING: [youtube:tab] Unable to recognize playlist. Downloading just video U3P8pUboZ5g` |
| 300+ list, page 1 | `/playlist?list=UUokXg7-kW6cA_WDe6JPuM9g` (the channel's uploads) | 0 | 4983 ms | 200 entries, `playlist_count` 476 |
| 300+ list, page 2 | same, `--playlist-start 201 --playlist-end 400` | 0 | 5935 ms | 200 entries (first `U7O4lCZHq_g`), 1 with no duration |
| A list that does not exist | `/playlist?list=PLzzzz...` (34 chars) | 1 | 2695 ms | stderr `ERROR: [youtube:tab] PLzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz: YouTube said: The playlist does not exist.` |

Flat entry keys (every case): `__x_forwarded_for_ip, _type, availability, channel, channel_id, channel_url, creators, duration,
id, ie_key, live_status, thumbnails (4 per entry), timestamp, title, uploader, uploader_url, url, view_count`; `availability` and
`live_status` are null on public videos. Consequences for the rulings: Dean's example list is READABLE (the plan expected an
error; R14 stays for lists like the last row); a Mix answers as a single video (R5's no-picker rule matches yt-dlp); Load more can
page with `--playlist-start/--playlist-end` and `playlist_count` gives the total; a 30 s timeout (the probe posture) leaves room.
The stderr also carried `No supported JavaScript runtime could be found` warnings on this box (production has its own runtime
setup); none affected the flat listing.

Evidence (the builder fills, copied from instruments): T0 outputs verbatim; falsifier outputs per wave; mutants by name; census
diffs; suite summary lines on both Nodes; device checks owed.

## 8. Out of scope

A PWA `share_target` (Android / desktop share), downloading a whole channel from a link, playlist folders on disk, keeping the
playlist's order as a FileTube playlist, Mix downloads. Anything found goes to ROADMAP Planned.
