# FileTube on iOS: offline downloads (design)

Decided 2026-10-11 by Dean with the FileTube Root, building on [ios-host.md](ios-host.md) ("offline is native-only") and the
bridge contract ([native-bridge.md](native-bridge.md)). This is the design every offline plan starts from; plans refine it,
they do not reopen it without a dated note below.

## Dean's rulings
1. **Audio and video together** in the first release (music tracks and albums, podcast episodes, videos and TV episodes).
   Storage management therefore matters from day one.
2. **A native Downloads screen** is the offline experience: a native list and a simple native player for downloaded items,
   usable with no network. Online, downloaded items still play in FileTube's own web player, from the phone's copy.
3. **Online speed is a separate plan** (cache headers, preloading, a lighter music library load), run in parallel; it helps
   the app, the PWA and the desktop alike.

## What Dean experiences
- Inside the app (never in a browser): a "Download to device" action on albums, tracks, podcast episodes, videos and TV
  episodes; a "Downloaded" badge on cards; progress while downloading.
- A native **Downloads** screen reachable with no network (the app opens to it when the server is unreachable, and from a
  quick action), grouped by kind, with a simple native player (audio with lock-screen controls; video full screen with
  picture-in-picture), resume positions, and delete.
- A storage page: space used per kind, per item, "delete all", and a cap Dean can set.
- Listening or watching offline still counts: positions sync back when the phone is online again.

## Architecture
**Server (FileTube)**
1. **A per-device token.** The app obtains a long-lived token bound to the signed-in USER (so a restricted account's downloads
   obey its restrictions, unlike the shared admin `FILETUBE_API_TOKEN`), scoped to reading media, metadata and progress and to
   writing progress. Issued once from the logged-in web view session (native code calls the issue route with the web view's
   cookies, so no secret crosses the JS bridge); listed and revocable in Settings ("Devices"); stored in the iOS Keychain. It
   also unlocks widgets later.
2. **A download manifest API**: for one item (or an album / season), everything needed to play it offline: the media file
   URL(s) and size, mime type, duration, title / artist / show, artwork, chapters, subtitles, and the resume position;
   permission-checked exactly like the online routes. Range requests and resumable downloads on the file URLs.
3. **Progress sync** that accepts queued offline positions with their timestamps through the existing progress paths,
   applying the shipped forward-only / stale-refusing rules (a newer position from another device wins).
4. Later, not in the first release: smaller renditions for storage (the ROADMAP's streaming Tier 2 "data saver").

**Contract (v1, add-only)**: a `downloads` capability; web-to-native messages to add / remove an item and to subscribe to
download state; a native-to-web event with each item's state (queued / downloading with progress / done / failed) so the web
draws buttons, badges and progress. The exact shape lands in the plan and the schema, never here.

**App (filetube-ios)**: background URLSession downloads into Application Support, every file excluded from backup; a local
catalogue (items, metadata, artwork, chapters, subtitles, positions); the native Downloads screen and player; the storage page;
an offline progress queue; serving local files to the web player online (a `WKURLSchemeHandler` with range support, so the web
player streams the phone's copy). Removing a downloaded item never touches the server's copy.

## Sequence (each its own plan and gate)
1. FileTube: the device token, the manifest API, progress sync, the `downloads` contract addition and the web buttons / badges.
2. filetube-ios: downloads, catalogue, Downloads screen and player, storage page, offline progress queue, local playback online.
3. Then TestFlight (the paid program), then the App Store (see the App Store notes: a store build without the Share extension,
   a demo server with licensed content, privacy policy, review notes).

## Risks to design for
- **Data the user cannot lose**: offline positions must never overwrite newer server positions (forward-only + timestamps).
- **Permissions**: a token for one user must never fetch another user's or a restricted item; revocation must stop downloads.
- **Storage**: video is large; respect the cap, warn before it fills, and never fill the phone.
- **Background limits**: iOS throttles background downloads; show honest progress and resume after the app is killed.

## Corrections found while building the server half (2026-10-11 / 2026-10-12, v1.387.0)

The plan ([2026-10-11-offline-server.md](../exec-plans/completed/2026-10-11-offline-server.md)) refined this design; each note
below changes a line above and says why. The app's reference is [offline-api.md](offline-api.md).

1. **There is no shipped forward-only progress rule outside the Feed.** Every online progress route is an unconditional upsert
   stamped with server time; the forward-only / stale-refusing rules live only in the Feed's served-card registry. Offline sync
   got its OWN rule: **the newer moment wins**, by the time the position was reached on the phone, corrected for the phone's
   clock once per batch and clamped to server time. Not forward-only: a deliberate rewind on the phone that is newer than the
   server's position is real intent and wins.
2. **A device token must set `req.user`.** The shared `FILETUBE_API_TOKEN` deliberately leaves `req.user` unset, and a request
   with no user gets an EMPTY restriction index (sees everything). The per-device token is bound to the user row and the gate
   sets `req.user` from it, so every restriction applies to a phone exactly as to a browser.
3. **Downloads must be a file iOS can PLAY, decided by an iOS rule, not the browser's.** `?download=1` returns the original even
   when it needs a transcode, and the browser's `needsTranscode` would transcode ALAC to AAC 160k (a permanent loss offline) and
   flag HEVC because only h264 counts. The offline file route has its own rule (lib/offline/playable.js), measured on an iPhone
   XS (iOS 18.7.10) and an iPhone 15 Pro (iOS 27.0.1): ALAC, FLAC, hvc1 HEVC, AC3, EAC3, PCM, opus, vorbis and the ogg / opus
   containers play natively; hev1, mkv and webm take the existing H.264 + AAC transcode. The app requires iOS 18 (Dean,
   2026-10-12, via the iOS Root) and checks `AVURLAsset.isPlayable` after each download as the guard for later versions.
4. **Words.** "Downloaded" already means "the server has the podcast file" and "Save to device" is the browser save, so the new
   feature's words are built on **"offline playback"** (Dean, 2026-10-11): "Make available offline", "Remove offline copy", the
   "Offline" badge, "Saving for offline... 40%", the account menu entry "Offline". Podcasts' "full offline cache" wording became
   "keep every episode on the server". The lines above that say "Download to device" / "Downloaded" describe the intent, not the
   shipped words.
5. **"track" is three things**: a native music track, a library audio item shown in Music (bytes from `/video/:id`, progress in
   the media store, the MEDIA gate) and a chapter row `<id>::c<n>` (the parent file, once, with its chapters). Every offline route
   resolves a track id to one of the three first.
6. **Progress sync is a foreground request built just before it is sent, never an iOS background upload task** (a background
   upload fixes `sentAt` when the task is created and iOS may send it hours later, which the server would read as clock skew).
   A batch more than 5 minutes ahead of server time is refused with `400 restamp`.
7. **Per-child items for an album or season** (FileTube Root with the iOS Root, 2026-10-11): a `download` event is always one
   single-item kind; an album or season add reports its members with `parentKind` + `parentId`, and the web rolls the badge up.
