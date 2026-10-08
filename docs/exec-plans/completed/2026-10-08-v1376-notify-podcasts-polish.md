---
plan: v1376-notify-podcasts-polish
harness: v2 · lean
branch: feat/v1.376.0-notify-podcasts-polish
anchor: outcome
status: Shipped v1.376.0
next: none - shipped v1.376.0
design: Dean's intake 2026-10-08 (rulings R1-R9 below) + a read-only recon of every surface. Base main e6845b03 (v1.375.0).
gate: APPROVED r2 @e03b98bc (adversary, qa, security-brief)
---

# v1.376.0: Watch later from a notification, podcasts get the video options, and four device-pass fixes

Read first: AGENTS.md; docs/LESSONS.md sections 0, 1, 2, 4, 6, 9, 10, 11 (the classes, not the whole file); this plan.
Every bug is MEASURED on the real page first (LESSONS 1: name the falsifying observation), desktop 1440 and phone 390
(iPhone UA, DPR 3), with a headless Chromium probe of the real app (scratch instruments; see scripts/music-fouc-probe.js
and the v1.374.0 sort-probe pattern: boot server.js on a seeded DATA_DIR, raw CDP or tools/capture Playwright).

## 0. Step 0 (the builder reads this first)

- Read: AGENTS.md; docs/LESSONS.md sections 0, 1, 2, 4, 6, 9, 10, 11 (Classes; the Rules file for the sections you
  touch); this plan top to bottom; docs/RELEASING.md "Cutting a release"; the memory index's box quirks if present.
- Environment: export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH" before EVERY
  node / npm / git command. `gh` is ~/.local/bin/gh. ffmpeg / ffprobe: ~/.local/bin/ffmpeg-static. Chromium for probes:
  ~/.cache/ms-playwright (raw CDP) or tools/capture's Playwright. A worktree has no node_modules: symlink the main
  checkout's for runs, never commit it.
- Git: work on `feat/v1.376.0-notify-podcasts-polish` (this plan is committed there). Parallel waves in worktrees
  (.claude/worktrees/) on sub-branches, merged back here in order. Stage EXPLICIT paths (never add -A / .), commit with
  `git commit -F <file>`, never --no-verify, never force-push, never pipe a commit or push; verify with git log /
  git ls-remote. main is PROTECTED: the release goes through a PR (section 7).
- Stop rules (ask Dean with AskUserQuestion): a gate reaches round 3; a measurement contradicts a ruling or this plan's
  diagnosis (W5, W6 especially: a shipped fix that fails on the device means the diagnosis was wrong); a product fork
  the rulings do not cover; anything that would rewrite an existing library file (R5 forbids it).
- Reporting: no step-by-step ceremony; report at decision points and at the end with two 10-cell progress bars
  (`**This release (v1.376.0):** \`████░░░░░░\` 40%. ...` and `**Overall plan:** ...`) plus the measured numbers.

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
  dismiss from the worker (same-origin credentials; no window opened) - MEASURE what iOS shows (UNVERIFIED belief: an iOS home-screen web app does not show
  notification action buttons; if so, the in-app row is the iPhone path and the push action serves desktop / Android;
  read the platform docs and disclose what was found). Never let a notificationclick without an action change behaviour (bind it).
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

FULL gate (adversary + qa + security-brief): a new Watch later row kind (W2: built as the `podcast:<episodeId>` key in the existing column, NO schema migration - a v35 column would be a rollback floor), a Delete surface (W2), Web Push payload + worker
actions (W1), a scan / file-writing race (W6), RBAC on a new list kind. Brief the adversary to DESTROY data on W2 (a
migration that drops or re-keys Watch later rows; a podcast Delete that removes the wrong file or a file another user
sees) and to make W6's scan index a pending file. The census tests a route or setting trips (LESSONS 3) - expect
rbac-census / route classification / docs-diagrams to need updates if any route is added.

(pending)

Gate: APPROVED r1 @4fe1f639 - security-brief
- No CRITICAL / WARNING. Static trace only (no Bash: no tests or mutants run by this seat).
- SUGGESTION (pre-existing, not introduced here): Web Push delivery is not RBAC-filtered per subscriber - lib/push/deliver.js:251-298 reads the global feed per subscription and server.js:353 resolvePushMeta(db, row) has no user, while the bell filters (lib/notifications/routes.js:99,150). Repro: restrict a show/folder from a member with push on; a new item there pushes its title to that member's device. The v1.376 action cannot act on it (POST /api/watch-later 404s, worker shows "Could not add"). Track separately.
- INFO: SameSite=Lax (lib/auth/gate.js:87) with no Origin check: a same-SITE sibling subdomain can POST /api/watch-later/:id?kind=podcast with the cookie. Pre-existing for every POST; impact here is a list add only.
- INFO: GET /api/watch-later/ids echoes the caller's own stored keys, including a since-restricted episode's `podcast:<id>` (same posture as media ids, own data only).

Gate: CHANGES r1 @4fe1f639 - qa
- WARNING public/js/music-skins.js:909-937 (+ music.js:4870, :4873): the iPod menus are unversioned. The builders call `artFor(id, explicit)` = musicArtUrl with no `v`, so Albums / Artists rows (and every native-track song, recent and cover-pool item) build `/albumart/<artId>` though the payload carries artV / artVs. Verified with node: menuAlbumItems([{artId:'abc',artV:'k1-2s'}], musicArtUrl) -> "/albumart/abc". Repro: the iPod shows an album, its picture changes, iPod > Albums: the row paints the cached old cover (max-age 86400). Plan W6 (c) names "the iPod menus"; acceptance 6 says "every Music view". Fix: pass the version through artVia (a.artV, a.artVs[0], t.artV), plus a test.
- WARNING public/js/common.js podcastTrashConfirmCopy (used by main.js cardDeleteConfirmCopy and notifDeleteConfirmCopy): the dialog says "You can restore it from this episode list." on Home, Search and the bell, where there is no episode list. The test (card-action-menu.test.js) locks that wording. Repro: Home > podcast card > Move to Trash: the dialog sends you to a list you are not on. It is a delete surface: say "from the show's episode list" (keep the episode list's own wording in sync).
- WARNING lib/media/user-routes.js:664 (test binding): the podcast arm of the Watch later watch filter is not bound by any test. Mutant `it.watchState === watch` -> `true` SURVIVED: watch-later-api, liked, liked-mixed-kind, browse-context, notif-watch-later, push-sw-handler = 73 pass, 0 fail (run in a /tmp git archive sandbox). Repro if it regresses: an episode you played to the end shows under Watch later > New. Add an episode case to the watch=new|watching|watched test.
- SUGGESTION lib/media/user-routes.js:640: the episode's `liked` in the Watch later list is unbound too (mutant `liked: false` survived the same 73). One assert closes it.
- SUGGESTION lib/music/artVersion.js versionOfFiles: one sync statSync per art file on the event loop, per request. A projected library track has its own thumbnail, so /api/music does about 1 stat per row (the builder measured 23 -> 45 ms at 1300 rows). Not blocking. Cache by path if a large library or a cold disk shows it.
- SUGGESTION plan sections 6 and 9: section 6 still names "a schema migration (W2)", but the build chose the `podcast:` key and no migration. Section 9 (Evidence) is empty at this sha. Fill both before the release commit.
- Security (standing): no new route. `kind` is an allowlist (podcast, else media). The `podcast:` key cannot collide with an md5-hex media id; rekey and removeMediaState never touch it; removePodcastEpisodeState only touches its own key. The add, list and Play all go through the PODCAST visibility gate with one neutral 404. artV is the mtime and size of a file the viewer is already sent. The worker's fetches are same-origin, only on a user tap of the action. HTML is escaped at every new art URL site. No shell, eval or path input added. No new exposure found.

Gate: CHANGES r1 @4fe1f639 - adversary
- Instruments: full Node 22.23.1 `npm test` in a /tmp git-archive sandbox: tests 11734, pass 11712, fail 8, skipped 14. All 8 are instrument failures of the sandbox (no .git: `git ls-files` fatal / EISDIR on the node_modules symlink); their 7 files re-run in a `git clone --shared` checkout of 4fe1f639: 69 pass, 0 fail. 29 mutants run by this seat: 24 killed, 5 survived (below).
- WARNING public/js/main.js:2732 deletePodcastCard, :3169 toggleCardWatchLater, :3186 moveCardToTop (inert-feature / presence-not-binding, a Delete surface): the podcast card's real requests are unbound. Mutants S-g (deletePodcastCard fetches /api/videos/<id> instead of /api/podcasts/episodes/<id>), S-h (`const kind = undefined`: the episode Watch later POSTs as media and 404s every time) and S-i (Move to top sends the bare id, not `podcast:<id>`) each SURVIVED all 90 test files that name main.js / Watch later (1103 pass, 0 fail). Only a source count and the confirm regex bind the delete. The code at this sha is correct by reading (not verified at runtime). Fix: drive a podcast item through the card menu in the card-action-menu-fullchain harness and assert the request URL + method for Watch later (?kind=podcast), Move to top (the `podcast:` key in the PUT body) and Move to Trash (DELETE /api/podcasts/episodes/<id>, only after the confirm resolves true).
- WARNING (concur with qa, verified independently): public/js/music-skins.js:909 artVia never passes a version, so the iPod Albums / Artists / native-song rows build an unversioned URL. node: menuAlbumItems([{album:'A',artId:'abc',artV:'k1-2s'}], musicArtUrl)[0].art -> "/albumart/abc". Acceptance 6 ("every Music view") is not met there.
- SUGGESTION lib/media/user-routes.js:664: the podcast arm of the watch filter is unbound (mutant `-> true` survived 1103; qa found the same).
- SUGGESTION server.js:5282 resolveHandoffTarget: the handoff card's art version is unbound (mutant back to `/albumart/${enc}` survived 31 handoff test files + music-art-version: 613 pass, 0 fail).
- SUGGESTION lib/ytdlp/coverPending.js:40 (lying comment, plus a suspicion): "a library root configured through a symlink or a bind mount" - realpath resolves symlinks, not bind mounts. If the download dir and the library root are two bind mounts of one host folder, the walker's spelling never matches the claim and the deferral does nothing. Not reproduced (unshare is not permitted on this box). Say "symlink" only, or match on the folder's dev+ino.
- SUGGESTION (concur with qa): podcastTrashConfirmCopy says "restore it from this episode list" on Home, Search and the bell.
- INFO /api/music art cost, measured: 1300 memo.ofTrack stats = 15-30 ms (5 runs). The routes are paginated. Not blocking.
- Attacks that HELD (verified by mutant or code path, W2 + W6; also W4 3/3, W3 3/3, W6 (c) 3/4 killed): 10 W1/W2 server + client mutants killed (add-before-dismiss, dismiss failure keeps the row, kind dropped on the request / worker body / push payload, worker opens on any click, worker fakes success, bell podcast delete to /api/videos, list shows a trashed episode, 95% latch, episode kebab kind). No path drops, re-keys or cross-deletes a `podcast:` row: removeMediaState and rekeyMediaState key on md5-hex media ids; removePodcastEpisodeState deletes only `podcast:<id>`; reorder only UPDATEs existing rows; the backup carries the key verbatim and validate accepts it; the bell's phantom purge fires only for a MISSING episode record (a trashed one is hidden, not purged). The podcast DELETE route is unchanged and re-checks modify-library, visibility (404), downloaded status (400) and confinement. W6: 5 race mutants killed (music retain, the deferred.add, the finally release, the claimed-folder check, FTCHDST addFile). The claim is taken before the spawn and released in the outer finally; the job's scan trigger coalesces through rescanRequested; the re-embed temp (.ftcover-*.tmp) is not a media extension; guard 1b plus the retain loop keep a deferred entry, and detectVanishedRoots can only widen the keep.

Gate: APPROVED r2 @e03b98bc - security-brief
- No CRITICAL / WARNING. Static read of the delta files at HEAD (no Bash: no git diff, tests or mutants run by this seat).
- coverPending.js identity keys: an `id:<dev>:<ino>` key is learned only from a FTCHDST dirname that already passed inClaimedDir (line 67-70), so it names the claimed folder itself; `id:` cannot collide with a path.resolve key (always absolute). A false match (inode reuse after the folder is deleted, while the claim is live) only DEFERS a `[<videoId>]` file for one pass and keeps its entry: availability, never exposure or loss. In-process, released in finally.
- music-skins.js / music.js iPod art: `v` comes from payload artV / artVs[0] (server-built only from viewer-visible ids, verified r1) and is encodeURIComponent'd in albumArtSrc (music.js:339). No new read surface, no hidden-item reach.
- r1 SUGGESTION/INFOs stand unchanged (pre-existing push RBAC gap, Lax-only CSRF posture, own-keys echo).

Gate: APPROVED r2 @e03b98bc - qa
- r1 WARNING iPod art: fixed as prescribed. artVia passes `v` through to musicArtUrl at all 7 sites, and every caller passes musicArtUrl (music.js:4839-4941). Verified with node: Albums -> /albumart/abc?v=k1, Artists -> ?v=v9, the cover pool -> ?v=k1, and the cover pool's sameOriginPath still accepts the query. Mutants in a /tmp sandbox: the Albums version removed -> killed (music-art-version 10 pass / 1 fail); the cover-pool version removed -> killed (1 fail).
- r1 WARNING delete copy: fixed. The card and the bell now say "the show's episode list"; the episode list keeps "this episode list", which is true there. Mutant reverting the copy -> killed (card-action-menu + notif-delete-confirm: 3 fail).
- r1 WARNING watch filter not bound: fixed. Mutant `it.watchState === watch` -> `true` is now killed (watch-later-api 17 pass / 1 fail). The r1 SUGGESTION on `liked` is closed too (mutant `liked: false` killed, 1 fail).
- Fix-round extra (coverPending identity): the dev:inode key is only learned from a folder that already matched, and only checked after a name match, so the extra stat runs only on candidate files. Mutant: the identity match in inClaimedDir removed -> killed ("a folder reached through a second BIND MOUNT...": 1 fail). Nothing new found.
- Instruments on e03b98bc: eslint 0 errors (the same 6 older warnings), lint:ui OK, and the changed tests plus skin-surface, podcasts-ui-sweep and notif-watch-later: tests 223, pass 223, fail 0. The r1 SUGGESTIONs on stat cost and plan section 9 stand and do not block.

Gate: APPROVED r2 @e03b98bc - adversary
- Instruments: full unit suite at e03b98bc in a `git clone --shared` checkout (Node 22.23.1): tests 9171, pass 9170, fail 0, skipped 1. The delta's 10 touched test files plus the skin tests in a /tmp git-archive sandbox: 492 pass, 0 fail. Mutants run by this seat this round: 16, 15 killed, 1 survived (a SUGGESTION, below).
- r1 WARNING (podcast card actions): fixed as prescribed. Re-ran my r1 survivors S-g (delete to /api/videos), S-h (kind dropped), S-i (Move to top bare id): all KILLED now. Two new mutants: S-g2 (every card delete goes through the podcast route) KILLED.
- r1 WARNING (iPod art, from qa): fixed. Every caller passes musicArtUrl itself (4 arguments), so the version gets through. Mutants that strip the version from albums, the cover pool, recent artists and artist albums: 4/4 KILLED.
- r1 SUGGESTIONS: the watch-filter podcast branch (S-f) is KILLED now, and so is the handoff art version (C-d). The confirm copy now says "the show's episode list" off the show page. The coverPending comment is corrected.
- The new dev+ino matching, measured: (a) 10000 walked files whose name does not carry the bracket: 0 fs calls. The name test runs first, so a live claim costs nothing for the rest of the library. 1000 bracket files in another folder: 2000 calls. (b) A different folder with the same bracket: not pending. (c) The claimed folder deleted and recreated: still pending (its path still matches). (d) INFO, a harmless false positive: the folder's inode was REUSED by a new, unrelated folder (measured on this box: the first mkdir after the rmdir got it). A file there with the SAME `[videoId]` bracket is deferred until the claim is released. It is deferred, not dropped (guard 1b keeps any existing entry), it needs the same video id in a stranger folder during one job, and it ends at release. Not worth fixing. Mutants: the identity match, the identity learned at FTCHDST, and the identity taken at the claim: 3/3 KILLED.
- SUGGESTION (residual, new): with a second bind mount AND a channel folder that does not exist yet at the claim, the identity is only learned when FTCHDST arrives. A scan of the bind-mount spelling during the yt-dlp window before that line can still index the file. This is narrow (bind-mount layout + a brand-new folder + a scan in a seconds-long window). Disclose it, do not block.
- SUGGESTION public/js/main.js deletePodcastCard: the "not ok -> keep the card" guard is unbound. Mutant S-g3 deletes `if (!res.ok) { ...; return; }` and SURVIVED (73 pass): a 409 or 500 would remove the card and toast "Moved to Trash" while the file stays. The UI would be wrong, but no data is lost (the server moved nothing). One assert closes it.

## 7. Release (v1.376.0, one release for the wave)

- After the gate APPROVES (all required seats at the same sha): full `npm test` on Node 22.23.1 then 24.20.0
  (sequential; Node 24's reporter prints `ℹ`); report both summaries verbatim (a known flake: progress-coalescer AC4.1
  #238 - re-run its file alone, never --no-verify).
- Release commit on this branch: `npm version 1.376.0 --no-git-tag-version`; ROADMAP.md "Shipped" entry (and remove /
  update the five Planned items this wave closes: "NEXT BRANCH: Add to Watch later on a notification...", the channel
  link bug, the Listen Control card bug, the player-line bug); docs/releases.json ledger entry in PURE USER LANGUAGE (a
  checker test enforces it); DEVICE-CHECKS lines (section 5); a LESSONS entry if the wave taught one; tracker rows for
  disclosed residuals; `node scripts/plan-complete.js <this plan> "Shipped v1.376.0" --apply`, fix the path references
  it lists, `git add` the moved plan.
- Then: on main `git merge --no-ff` this branch locally, `git tag v1.376.0` on that merge, push THIS BRANCH + the tag in
  ONE push (`GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"`; the pre-push hook runs the
  suite), `gh pr create`, wait for ci (22), ci (24), audit, secret-scan green (the visual job is a report, never a
  gate), `gh pr merge --merge` (Dean authorizes merging on green; if the tool refuses, ask him), then on main
  `git fetch && git reset --hard origin/main` after checking the tag's tree differs only by visual baselines, confirm
  the tag's "Publish Docker Image" run is green, delete the branches (`git branch -d`; remote via
  `gh api -X DELETE repos/dtammam/filetube/git/refs/heads/<b>`, then `git ls-remote`).

## 8. Out of scope

- Re-covering albums already saved, or a "Set album cover" action in Music (R5).
- An auto-add-to-Watch-later setting (R1 chose the button).
- The Opus library fix; the Shortcut reply (A); a pinned picker footer (B); the subtitles + 360 + cleanup wave; radio
  residuals (tracker #295). Anything new goes to ROADMAP.md Planned.

## 9. Evidence (the builder fills this)

- Per wave: the measurement before the fix (instrument + numbers), the change, the tests that bind it (names), the
  mutants run and their results, the measurement after.
- W6: Dean's private-window check result (asked at the start of the wave).
- Gate rounds and verdicts; both suite summaries; residuals disclosed.

### Filled at ship (v1.376.0)

- **W1** (6e0e45fa). Before: the bell row menu (real app, scratch w1-swipe-probe.js): row 320@3 with Dismiss + Delete =
  163 px; a cloned "Watch later" action 108 px -> 271 px = 85 % of the row (390@3: 69 %; 1440: row 400, 68 %); the
  full-swipe threshold is 60 % -> no third swipe action, a menu item. Push actions (MDN browser-compat-data
  showNotification `options_actions_parameter`): chrome 48, edge 18, firefox 152, safari false, safari_ios false. After
  (w12-reach-probe.js, 390@3 iPhone UA + 1440): media and podcast rows' menus [Watch later, Open channel / Open show,
  Dismiss, Delete file]; rows 5 -> 4 -> 3; URL stays `/`; pageErrors []. Tests: test/unit/notif-watch-later.test.js (8),
  push-delivery (2 new), push-sw-handler (4 new), notif-delete-confirm (updated + 2 new). Label "Watch later", not "Add to
  Watch later": the v1.341.4 1-3 word label rule (button-label-rule.test.js) refused the 4-word label.
- **W2** (6e0e45fa). Design: the `podcast:<episodeId>` key, no schema change (a v35 column = a rollback floor, measured in
  lib/db/sqlite.js migrateSchema's refusal). After (same probe): stored keys [<mediaId>, podcast:<epId>]; /api/watch-later
  lists [media, podcast]; the Watch later page's episode card -> /podcasts?play=<epId>; podcast card menu [Add to queue,
  Remove from Watch later, Move to top, Like, Share, Save to device, Move to Trash]; episode kebab [Like, Mark played, Watch
  later, Share, Save to device, Move to Trash]. Tests: watch-later-api (+8 W2), card-action-menu, card-action-menu-fullchain
  (+2, r1), podcasts-ui-sweep (+1), notif-*. Mutants M01-M18 on 6e0e45fa: 18/18 KILLED.
- **W3** (363ffde6, merged c4abae83). Before (raw CDP, 1440 and 390@3, filetube_format=audio): a video's watch uploader
  link and search card link requested format=audio -> 0 cards, "No videos or audio yet" / "This folder is empty". After:
  format=video, 4 cards, Videos chip, remembered still audio; "No audio here. The Audio filter is on. Show all" (90x44 at
  390). Tests: test/integration/channel-link-format.test.js (8), uploader-channel-link (+3), library-toolbar (+4).
  Mutants 14/14 KILLED.
- **W4** (ceee7da5, merged 7275931e). Before (real /api/handoff driver, iPhone UA DPR 3): 390 card 8,632 374x132 over
  the dock 222,630 160x134 = 21120 px2, every dock control hit the card; 320 same 21120 px2; desktop no overlap. After:
  390 card 8,578 374x44 (8 px above the dock), 320 304x44, every control its own hit target in every era; desktop
  16,752 320x132 unchanged. Tests: test/unit/player-dock-presence.test.js (8), test/geometry/handoff-dock.js (HDK 3 ok).
  Mutants: unit 9/9, geometry 5/5 KILLED.
- **W5** (367ef36b): NOT FIXED. Headless Chromium + WebKit, DPR 3, 390 x 844 / 664, every era, light/dark,
  playing/paused: bar / player / stage bottoms coincide (371.375 / 370.797), gap 0, hiding the video changes no row; the
  only paint under the bar is the dark-mode ambient bloom (21,4,21 at the edge, ~50 px fade). Instrument: the lifecycle
  log's `player:strip` line (test/unit/player-strip-log.test.js, 6). Mutants 6/7 (S4 masked). Dean (AskUserQuestion,
  2026-10-08): "Can't check now" -> instrument only; device check owed.
- **W6** (9e4319a1, c89e7587, b8eeaa91, 2608700f, merged 4fe1f639). (a) Dean's private-window check (2026-10-08): "Yes,
  chosen cover" - the browser-cache diagnosis CONFIRMED. (b) cover-pending claim + walker deferral + prune guard 1b;
  tests cover-pending (7, +1 bind-mount r1), scan-cover-pending (6); mutants 21 (M4 survived then bound in 2608700f; M7
  equivalent). (c) Before (w6-artcache-probe.js, 1440 + 390@3): /albumart/<id>?s=128, private max-age=86400, the
  changed cover served from cache rgb [254,0,0]; after: ?s=128&v=<mtime-size>, network, [0,255,1]. Cost (1300 items,
  median of 15): /api/music ~23 -> 45 ms, albums ~36 -> 47, artists ~21 -> 25. Mutants 15 (C14 equivalent). (d)
  albumTrackNumbers 1..N; mutants D1-D6 KILLED.
- **Gate.** r1 @4fe1f639: security-brief APPROVED; qa CHANGES (W1 iPod art unversioned, W2 off-show delete copy, W3 the
  watch filter's podcast arm unbound); adversary CHANGES (W1 podcast card actions unbound, W2 iPod art). Fix e03b98bc;
  builder mutants R01-R12 12/12 KILLED. r2 @e03b98bc: adversary, qa, security-brief APPROVED.
- **Suites.** Node 22 `npm test` @4fe1f639 (pre-gate): tests 11734, pass 11724, fail 0, skipped 10. Release tree (the
  release commit's tree): Node 22.23.1 `npm test` tests 11740, pass 11730, fail 0, cancelled 0, skipped 10; Node 24.20.0
  tests 11740, pass 11730, fail 0, cancelled 0, skipped 10.
- **Residuals.** Tracker #296; ROADMAP Planned (push not filtered per user, watch-filter empties, narrow non-phone
  overlap, album file naming, Music "Go to channel" type, versioned art beyond Music).
