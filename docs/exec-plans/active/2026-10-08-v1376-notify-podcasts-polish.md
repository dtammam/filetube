---
plan: v1376-notify-podcasts-polish
harness: v2 · lean
branch: feat/v1.376.0-notify-podcasts-polish
anchor: outcome
status: Approved @e6845b03
next: build W1-W5 in parallel worktrees (W1 first lands the shared notification / Watch later seams), then the FULL gate (a schema migration, a Delete surface, Web Push actions, a file-writing race)
design: Dean's intake 2026-10-08 (rulings R1-R9 below) + a read-only recon of every surface. Base main e6845b03 (v1.375.0).
gate: pending
---

# v1.376.0: Watch later from a notification, podcasts get the video options, and four device-pass fixes

Read first: AGENTS.md; docs/LESSONS.md sections 0, 1, 2, 4, 6, 9, 10, 11 (the classes, not the whole file); this plan.
Every bug is MEASURED on the real page first (LESSONS 1: name the falsifying observation), desktop 1440 and phone 390
(iPhone UA, DPR 3), with a headless Chromium probe of the real app (scratch instruments; see scripts/music-fouc-probe.js
and the v1.374.0 sort-probe pattern: boot server.js on a seeded DATA_DIR, raw CDP or tools/capture Playwright).

## 1. Outcomes (Dean's words, then the observable)

- **W1. "Add to Watch later" on a notification (Dean: "Notification setting ... Add to watch later option"; "Make it
  so that it removes the video from the notification list").** Every new-media notification (the in-app bell list AND,
  where the platform shows them, the phone/desktop push) has an "Add to Watch later" action: one tap adds the item to
  Watch later and removes that notification from YOUR list (the per-user dismiss), without opening the video.
- **W2. Podcasts get the same options (Dean: "we need podcasts to get the same options - be able to add to watch later -
  be able to delete - etc.").** A podcast episode gets Watch later, Delete (Move to Trash) and Share wherever it appears:
  the notification rows, the home / search cards, and the show's episode list (R2).
- **W3. A channel link never lands on a blank list because of a remembered filter (Dean: filtered to audio, opened a
  video from a notification, tapped the channel name: "Blank... has happened to me more than once").**
- **W4. The Listen Control card never covers the phone mini player (Dean's screenshot: "Listening on Work MacBook Air /
  Continue here" over the mini player; "maybe we shrink it on mobile or just have it not do that").**
- **W5. No line of light / colour under the phone player's controls (Dean's screenshot, watch page, iPhone).**
- **W6. A saved album's chosen cover is what every view shows (Dean: Mr. Jambo's row kept its own art in Music while the
  file had the chosen cover), and album tracks are numbered 1..N with no gaps (Dean's ruling R8).**

## 2. Rulings (Dean, 2026-10-08, AskUserQuestion)

- R1 W1 is a BUTTON on each notification (not an auto-add setting), and the tap also removes the notification from the
  list (= the existing per-user dismiss, `POST /api/notifications/dismiss`).
- R2 W2: podcasts get the options in ALL THREE places: notification rows, home / search cards, the show's episode list.
- R3 W3: the channel link opens the channel filtered to the TYPE OF THE ITEM YOU CAME FROM (a video -> videos) for that
  visit, leaving the remembered filter as it is elsewhere; AND an empty list caused by a filter says so, with a "Show
  all" button.
- R4 W4: on the phone, while the mini player shows, the card becomes a COMPACT one-line bar (art, "Listening on <device>",
  Continue here) STACKED ABOVE the mini player and the bottom nav; never overlapping. Desktop unchanged.
- R5 W6: the cover applies to NEW downloads only; albums already saved are not rewritten (no "Set album cover" in Music).
- R6 W6: Save as an album numbers the songs actually downloaded 1..N in playlist order, no gaps (today: the playlist
  position, so skipped / unavailable / already-owned videos leave holes: Kyle Gordon Is Wonderful has 1, 3-10, 13, 14).
- R7 Existing design kit only (ui.menu / ui.row / ui.btn / the card menu / FI.swipeRow); no new design mechanisms.
- R8 (standing) Dean's device pass is the arbiter; a shipped fix that fails on the device means the diagnosis was wrong.
- R9 (standing) One release for the wave (v1.376.0), parallel worktree builds, the full gate.

## 3. What exists (recon 2026-10-08, read-only; file:line at base e6845b03)

### Notifications
- Table `notifications(id, media_id UNIQUE, created_at, kind)` lib/db/sqlite.js:557 (`kind` default 'media', :711; also
  'podcast' and admin-only 'engine'). Per-user: user_notification_state / _reads / _dismissals. Store lib/auth/store.js
  :296, :355-357, recordNotifications :869. Rows are written by the scan (lib/scan/orchestrator.js:2112) and finished
  podcast downloads (lib/podcasts/index.js:527-529); a row always points at something ON DISK (a db.metadata id or a
  podcast episode id), never a YouTube id.
- Routes lib/notifications/routes.js: GET badge :34, GET list :48 (resolves rows; drops dead ones), POST seen :207, read
  :216, dismiss :229 (per user), clear :242. No server-side delete.
- Client public/js/common.js: row model buildNotificationRowModel :4049 (hrefs /watch.html?v=, /music, /podcasts?play=,
  /setup.html); row menu buildNotificationMenuItems :4141 ("Open channel"/"Open show", "Dismiss", "Delete file" for media
  only), opened by kebab / long-press / right-click (openRowMenu ~:4436); dismiss :4365 (non-optimistic); requestDelete
  :4394 (confirm -> DELETE /api/videos/:id -> best-effort dismiss); swipe FI.swipeRow :4525-4531; tap -> POST read ~:4506.
- Web Push: payloadForRow lib/push/deliver.js:184 sends {title, body: channel, url} only (pushWatchUrl :31, pushPodcastUrl
  :39, pushMusicUrl). Worker public/filetube-worker.js: push :82 showNotification(body, icon, data.url) - no `actions`,
  `tag`, `image`; notificationclick :102 focuses / opens, never reads `event.action`.
- Tests: unit notification-store, notification-dismiss-{store,client}, notification-bell-client, notif-delete-confirm,
  notif-panel-sheet, push-delivery, push-crypto, push-subscriptions-store, push-banner-close; integration
  notifications-api, notification-dismiss-api, scan-notification-bridge, scan-push-bridge, push-api, push-sw-handler,
  push-client-gate; harness test/helpers/notif-panel-harness.js.

### Watch later (v1.343.0)
- Table `user_watch_later(user_id, media_id, added_at, position, PK(user_id, media_id))` schema v34 lib/db/sqlite.js:1380
  (note :320); store lib/auth/store.js ~:740-763. Routes lib/media/user-routes.js: POST /api/watch-later/:id :553 (404
  unless an OWN key of db.metadata - library media only), DELETE :564, PUT /order :571, GET /ids :582, GET
  /api/watch-later :589; auto-removed when watched. Play all: POST /api/queue/watch-later lib/queue/routes.js:182
  (kind 'media' queue entries).
- Client common.js: fetchWatchLaterIds :14982, watchLaterSnapshot :14998, setWatchLater :15003 (non-optimistic, toast),
  playAllWatchLater :15019, sidebar :15037, account menu /?watchlater=1 :7285, list source :2544. Card menu
  buildCardMenuItems public/js/main.js:708 ("Watch later" / "Move to top" only for plain media, :716-719). Watch page
  watch.js:695 / :1431 / :1682.
- Tests: unit watch-later-store, card-action-menu, account-menu; integration watch-later-api, card-action-menu-fullchain,
  queue-api.

### Podcasts
- Episodes are a SEPARATE store (podcastsDb, ns.episodes; statuses downloaded / trashed / failed / tombstone;
  lib/podcasts/store.js, reduceEpisodeDownloaded :290); downloaded episodes are files under <dataDir>/podcasts
  (lib/podcasts/index.js:88). yt-dlp "external" shows' episodes are ordinary media items (ep.watchHref).
- Routes lib/podcasts/index.js: DELETE /api/podcasts/episodes/:id :1210 (to .filetube-trash; modify-library permission +
  visibility), restore :1268, played :1323, liked :998/:1006, GET /episode/:id :1102 (?download=1).
- UI public/js/podcasts.js buildEpisodeRow :742; kebab episodeMenuItems :788 (Like, Mark played, Save to device, Move to
  Trash with confirm :832, Restore); external episodes have no actions (opts.actions = []). Player Extras :279-330. Home
  / search podcast cards main.js:577 cardKindPresentation: queue, like, download only (delete / share excluded :585).
- Tests: unit podcasts-store, podcasts-trash, podcasts-ui-sweep, podcasts-feature-store, podcast-user-store,
  podcasts-nav-client, podcast-nowplaying-view; integration podcasts-api, rbac-podcast-*, podcasts-restore-race.

### Channel link + type filter
- Two filters: the Modern home chips (filetube_modern_chip, synced via lib/prefs-allowlist.js:12 / prefs-sync.js:25;
  /api/home?view=grid) and the library / folder FORMAT filter (localStorage filetube_format = both/video/audio,
  common.js:2115-2128, per device, sent as format= to /api/videos for folder and root views, main.js:1938; set at
  :2608/:2618).
- Card channel link `/?folder=<folderName>` (main.js:2425, :505); watch page uploader link `/?root=<parent dir>`
  (resolveUploaderLinkHref watch.js:175, :1888). The cause of the blank: a remembered filetube_format=audio applied to a
  video-only channel -> "This folder is empty." (main.js:2744), no mention of the filter.
- Tests: unit uploader-channel-link, library-toolbar; integration channels-api.

### Listen Control card vs mini player
- handoffCard common.js:17505 (#handoff-card on body), headline formatHandoffHeadline :11369, "Continue here" :17580; no
  knowledge of the dock. CSS style.css:2779 (desktop: fixed, left/bottom var(--inset), z var(--z-dock) 950); phone
  :2867 (left/right var(--space-4), bottom calc(var(--mobile-bottom-nav-h) + var(--space-4))). The comment :2768-2771
  ("card bottom-left, dock bottom-right, no overlap") is true on desktop only. #remote-pill :2882 same pattern.
- Dock #player-dock :1294 (fixed right/bottom 16px, w 280, z --z-dock); phone :1372 (w 160, right 8px, bottom
  calc(var(--mobile-bottom-nav-h) + 8px)). Bottom nav .bottom-nav :3461 (z --z-nav; --mobile-bottom-nav-h = 72px +
  safe area, :3367). On the phone the full-width card and the dock share a z and nearly a bottom: the card covers it.
- Tests: unit handoff-card-styling, remote-resume, listen-handoff-position, listen-chapter-dock-return, player-dock-load.

### Phone player bottom line
- .player-container style.css:1265 (1px var(--separator) border, era radius, overflow hidden); v1.359 drops border and
  radius on the phone stage (:4457-4465; placeholder :11671); phone stage geometry :6779-6798 (negative gutter, safe
  area, overflow-x clip). .player-controls :3797 (absolute bottom 0, header-bg, border-top 2px var(--border-dark), inset
  0 1px 0 rgba(255,255,255,.15)); era overrides 2009 :4052, 2014 :4086, 2021 :4138; phone two-row bar 80px :4279,
  wrapper padding-bottom 80px :4440 (44px single row :4442). No bottom border anywhere. Suspects to MEASURE: the
  ambient glow's below-player bloom (.ambient-glow :6802, the only bloom shown on phones), a sub-pixel gap at DPR 3
  between the bar and the wrapper's edge, whatever follows the stage.
- Tests: unit mobile-player-height, geometry-checks, ambient-glow-engine, fullscreen-edge-and-video-state,
  watch-chrome-ambient; test/geometry/{checks,scenes,mutations}.js (v1.359).

### Saved-album cover (v1.374.0) - Dean's production probe 2026-10-08
- Read-only probe (scratch cover-probe.js) on Kyle Gordon Is Everywhere (14) and Is Wonderful (11): EVERY file has the
  chosen cover embedded (1 distinct cover per album, 720x720 JPEG, one picture each) and every library thumbnail
  (DATA_DIR/.thumbnails/<id>.jpg) equals its file's cover. The re-embed WORKED; the files Dean downloads (raw file,
  lib/media/streams.js) carry the chosen art.
- Yet Music's artist page row for "Mr. Jambo" (track 2) shows the song's ORIGINAL art, while playing it shows the chosen
  art. Leading diagnosis (to CONFIRM first): the row's /albumart/<id>?s=<size> response was cached by the BROWSER
  (`Cache-Control: private, max-age=86400`, lib/music/routes.js /albumart) when the thumbnail still held the original
  art, and the URL never changes when the art does. How the thumbnail held the original: the playlist job's previous
  track triggers a fire-and-forget scan, which can index the NEXT track's freshly-landed file before that track's
  re-embed finishes (the v1.374.0 builder named this window: "if a periodic or manual scan indexes the file in the
  seconds before the rename, the job's own scan sees a new size and re-extracts"); the server later re-extracts (size
  changed) and the server-side renditions regenerate by mtime (lib/music/artRendition.js), but the browser keeps its copy.
  Falsifier for Dean: open the album in a private window / hard refresh: Mr. Jambo shows the chosen cover -> confirmed.
- Numbering: album.tracks = the playlist POSITION (lib/ytdlp/album.js, picker rec.pos), so skipped / unavailable /
  already-owned / unticked videos leave gaps.

## 4. Work items (parallel worktrees; serialize only shared files)

- **W1 Notifications -> Watch later + dismiss.** Bell row: an "Add to Watch later" item in buildNotificationMenuItems
  (and a swipe action if FI.swipeRow takes a third; measure the row width at 320 first) that calls the existing
  POST /api/watch-later/:id, then the existing per-user dismiss, then removes the row (optimistic only after both
  answer; failure toasts and keeps the row). Hidden when the item is already in Watch later or cannot be added
  (engine rows). Push: add `data.mediaId` + `data.kind` to payloadForRow and `actions: [{action:'watchlater', title:'Watch
  later'}]` in the worker's showNotification; notificationclick with event.action === 'watchlater' POSTs watch-later +
  dismiss from the worker (same-origin credentials; no window opened) - MEASURE what iOS shows (Safari Web Push on iOS
  does not display notification actions as of iOS 18: the in-app row is the iPhone path; the push action serves
  desktop/Android; disclose). Never let a notificationclick without an action change behaviour (bind it).
- **W2 Podcasts get the options (needs W1's Watch later seam).** Watch later must accept a podcast episode: today
  user_watch_later keys on media_id and the POST 404s anything not in db.metadata. Design the smallest correct extension
  (a `kind` column 'media' | 'podcast' with an APPEND-ONLY migration + schema version bump + backup bundle coverage, or
  a namespaced id) - LESSONS 9: every carrier, the backup bundle, the export, the Watch later list renderer (a podcast row
  plays via /podcasts?play=), Play all (queue kind 'podcast' exists: addToQueue(id,'end','podcast')), auto-removal when
  played (POST .../played), RBAC (an episode the viewer cannot see never lists or adds). Then the three surfaces (R2):
  notification rows (Watch later + Delete -> the existing DELETE /api/podcasts/episodes/:id with its confirm), home /
  search podcast cards (cardKindPresentation: add Watch later, Delete, Share), the episode kebab (add Watch later, Share).
  Share: whatever the video Share does (copy a link) with the podcast href. Delete is a data-loss surface: FULL gate,
  confirm stays, reuse the existing route only.
- **W3 Channel link by type.** The card channel link and the watch page uploader link carry the item's type
  (`&format=video|audio`) for THAT navigation only: the folder / root view honours a URL format over the remembered
  filetube_format without writing it back (R3). An empty folder result while a format filter is active says "No <audio>
  here" with a "Show all" button (existing empty-state kit) that clears the filter for the view. Test both links, both
  types, and the cross-page AND same-page navigation (LESSONS 4: a same-route SPA nav ignores the hash - here it is a
  query, verify it re-renders).
- **W4 Listen Control card on the phone.** Measure first (card and dock rects at 390 / 320, with and without a local
  mini player, both eras that change radius/z). Then (R4): html.is-phone + a local mini player showing -> the card's
  compact one-line form stacked above the dock (bottom = the dock's top + a gap), the same element (no second card), a
  class driven by the ONE place that knows the dock is shown (player-dock state), cleared on every dock exit (LESSONS 4
  reveal/clear axes). Fix the lying comment at style.css:2768-2771. #remote-pill: check the same overlap.
- **W5 The line under the phone player.** Measure first, at DPR 3 (Emulation.setDeviceMetricsOverride deviceScaleFactor 3,
  iPhone UA): screenshot-crop the strip under the controls, read the painted rows' colours, toggle candidates one at a
  time (ambient glow off; the controls' bar background; the wrapper's black) and see which removes it - the falsifying
  observation decides. Fix at the cause; LESSONS 6 blast radius (the player rules are shared by every era and the dock).
  If the headless probe cannot reproduce it, say so and ship an instrument, not a theory (LESSONS 1).
- **W6 Saved-album cover everywhere + numbering.** (a) Confirm with Dean (private window). (b) Root cause: a scan must
  not index a file whose album cover is still pending: register each job file as "cover pending" from the moment yt-dlp
  reports its final path until the re-embed resolves (ok / refused / failed), and have the scan's walker skip (defer)
  those paths; the job's own scan trigger (after the re-embed) indexes them. Bind with a test where the scan runs between
  the file landing and the re-embed (the race the v1.374.0 builder named; a deterministic seam, LESSONS 2). (c) Belt for
  every art change (not just covers): art URLs carry a version (e.g. the thumbnail's mtime or a short content hash) so
  the browser cache can never hold a stale cover for a changed file - /albumart and /thumbnail URLs built by Music's art
  rule (musicArtUrl / artIdFor, the iPod menus, the album card, Now Playing, the pop-out) - one writer; mind the
  per-viewer RBAC (the version must not leak anything). (d) Numbering (R6): the picker sends album.tracks as 1..N over the
  rows that will be downloaded (ticked, available, not already in the library) in playlist order; the server keeps
  validating; the "Track N" overline in the picker shows the new numbers. A v1.371.0-.374.0 pending entry still validates.

## 5. Acceptance (Dean's device checks; each also bound by tests)

1. Bell list (iPhone + desktop): a new video's row -> "Add to Watch later": the video is in Watch later, the row is gone
   from the list, the video did not open. Desktop push (Chrome): the push shows a "Watch later" button doing the same.
2. A podcast episode: in the bell list, a home / search card and the show's episode list there is Watch later, Delete
   (with the confirm) and Share; Watch later lists it and plays it; playing it to the end removes it from Watch later.
3. Filter Audio, open a video, tap its channel name: the channel shows its videos; back on Home the filter is still Audio.
   A filtered folder with nothing of that type says so with "Show all".
4. iPhone, music playing on the Mac, a video in the mini player: the Listen Control card is a slim bar above the mini
   player; both are fully visible and tappable.
5. iPhone watch page: no line of light / colour under the player's controls (playing and paused).
6. Save a playlist as an album with a Cover: every song shows that cover in every Music view (artist page rows included)
   on desktop and phone, with no hard refresh; the songs are numbered 1..N with no gaps.

## 6. Gate

FULL gate (adversary + qa + security-brief): a schema migration (W2), a Delete surface (W2), Web Push payload + worker
actions (W1), a scan / file-writing race (W6), RBAC on a new list kind. Brief the adversary to DESTROY data on W2 (a
migration that drops or re-keys Watch later rows; a podcast Delete that removes the wrong file or a file another user
sees) and to make W6's scan index a pending file. The census tests a route or setting trips (LESSONS 3) - expect
rbac-census / route classification / docs-diagrams to need updates if any route is added.

(pending)
