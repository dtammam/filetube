# TV wrap wave: episode description/show-channel + seamless bg audio + ambient + dock-return (v1.197 candidate)

Status: SHIPPED as **v1.197.0** (2026-08-27). Full two-reviewer gate closed (both APPROVE after one fix round: ext-in-payload + the cog-sequence source-lock + comment/title accuracy); dual-Node 7648/0. Residuals in tech-debt #180 (d)-(f). This doc is the reviewers' spec and survives context
compaction. Dean's four closers for the TV arc, all diagnosed from code (not
theory) before this plan was written.

## Intent (Dean, 2026-08-27, paraphrased from device)

1. "Add a description - very similar to the videos: file name, any other
   potential metadata. The channel would be the SHOW with a little icon derived
   from the poster; tap it, you go back - still feel like channel flow."
2. "I would like the background audio. It currently works but needs you to press
   play - let's make it seamless." (iOS suspends the episode on lock; videos have
   the sidecar-handoff machinery; episodes don't yet.)
3. "Ambient mode doesn't seem to work" (for episodes).
4. "When I go to [mini] player and go back I see an error about Failed to Load
   Media even though the video plays normally."

## Root causes (all confirmed by reading the code)

- (3) `setupAmbientMode()` is called ONLY from `initWatch()` (watch.js:1272); the
  `?tv=` path (initTvWatch) never calls it. Same class as the v1.196.1 controls
  bug: video-path setup the TV branch skips. The function itself is
  source-agnostic (reads the persistent `#media-player` + the watch-view
  `#ambient-glow` canvas).
- (4) The mini-player dock-return (player.js:8042-8044) navigates
  `currentData.readerHref || '/watch.html?v=' + currentId`. Books/music already
  set `readerHref` PRECISELY because their ids "would 404 on the video route"
  (the comment documents this exact class). The TV descriptor never set it, so a
  docked episode's tap-return hit `/watch.html?v=<episodeId>` -> the video path
  fetched `/api/videos/<episodeId>` -> 404 -> "Failed to Load Media", while the
  player itself adopted and kept playing.
- (1) The TV watch path hides `.uploader-info-panel` + `.description-container`
  wholesale (they were video-only). The building blocks are all source-agnostic
  init-level siblings: `applyAvatarToElement(el, name, url)` renders a URL avatar
  (the poster) in the disc; `formatRelativeTime`/`formatFileSize` are shared
  formatters; the show-detail fetch the track-nav already makes carries the
  season/episode counts.
- (2) The full background-audio machinery was mapped end-to-end (subagent report,
  2026-08-27). Key facts: `buildAudioExtractArgs(srcPath, tmpPath)`
  (server.js:2602) is FULLY GENERIC and already reused verbatim by the music
  queue (:7827). `sendRangeable` is shared. The client's handoff state machine,
  prime, keep-alive, presync, MediaSession guards, and all four teardown sites
  key off `currentId`/`currentData.type`/`activeMediaElement()` - NONE off
  db.metadata - so a TV episode inherits them with only URL-coupling edits.

## Phasing

### W1 - the two small device bugs (ambient + dock-return)
- watch.js `initTvWatch`: call `setupAmbientMode()` after `player.load` (the same
  ordering initWatch uses); add `readerHref: '/watch.html?tv=' + episodeId` to
  the tv descriptor.
- Tests: extend the `?tv=` behavioural test - descriptor carries readerHref;
  a source-lock that initTvWatch calls setupAmbientMode.

### W2 - episode description + show-as-channel panel
- Server, `GET /api/tv/episode/:id` gains three display fields (no schema
  change): `sizeBytes: ep.size`, `addedAtMs: Date.parse(ep.addedAt) || 0`,
  `fileName: path.basename(ep.filePath)` - the BASENAME only, never the full
  path (tighter than the video payload; satisfies "file name").
- Client, initTvWatch un-hides `.uploader-info-panel` + `.description-container`
  (keeps action bar/comments/related hidden) and paints:
  - `#uploader-avatar-letter`: `applyAvatarToElement(el, showName,
    '/tvposter/' + showId)` - the poster-derived channel icon.
  - `#uploader-channel-name`: the show name; href `/tv?show=<showId>`; SPA
    navigate on click (channel flow -> back to the show).
  - `#uploader-subs-count`: "N seasons · M episodes" - counted from the
    `/api/tv/:showId` response setupTvTrackNav ALREADY fetches (zero extra
    round-trip; wire the count through that fetch).
  - `#added-date-text` / `#file-size-text` / `#file-type-text`:
    `formatRelativeTime(addedAtMs)` / `formatFileSize(sizeBytes)` / EXT.
  - `#video-description`: the fileName via textContent (attacker-influenced
    text posture, same as video descriptions).
  - `#views-count`: hidden (episodes have no view counts; never fake them).
  - The Subscribe button stays hidden (no subscription concept for a show yet).
- Tests: extend the `?tv=` behavioural test (panel painted from the live
  descriptor: show name, seasons·episodes, size/date/type, fileName; channel
  link href; no /api/videos calls STILL).

### W3 - seamless background audio for episodes
Design per the machinery map: mirror the ROUTE PAIR, but track readiness by FILE
EXISTENCE (the tv/music queue posture) - never `setAudioStatus`/
`clearAudioStatus`/`healStaleAudioReady` (all db.metadata-bound; skipping them
eliminates the stale-'ready' class by construction).

Server (beside the TV transcode queue):
- `tvAudioPath(id)` = `TRANSCODE_DIR/tv-<id>.m4a`; `queueTvAudioExtract` +
  `processTvAudioExtractQueue` mirroring the music queue verbatim, REUSING
  `buildAudioExtractArgs` unchanged. Separate single-flight (`tvAudioBusy`) -
  the music-parity call; an episode's sidecar must not queue behind a long
  video transcode. `tv-<id>.m4a` is picked up by isCompletedTranscode/
  isInFlightTranscode for free (LRU eviction, age sweep, orphan cleanup,
  markServed protection); the eviction paths' clearAudioStatus no-ops on a
  tv key (not in db.metadata) - harmless; the preExtractAudio pin correctly
  skips it (metadata-membership test, the music posture).
- `GET /tvaudio/:id` (beside /tvepisode/:id): ownEpisode + tvEpisodeVisibleTo
  -> 404; sidecar exists -> sendRangeable audio/mp4 with markServed(sidecar) +
  markServed(source); else queueTvAudioExtract -> 503 {error:'extracting'}.
- `POST /api/tv/episode/:id/prepare-audio` (registered BEFORE /api/tv/:showId -
  the route-order scar): same gate; exists -> {audioStatus:'ready'}; else queue
  -> {audioStatus:'pending'}. Never serves bytes (the video pair's rationale).
- `GET /api/tv/episode/:id` gains: `audioStatus` (live file-existence),
  `audioSrc: '/tvaudio/<id>'`, `prepareAudioUrl:
  '/api/tv/episode/<id>/prepare-audio'`.
- Census: +2 routes; classify (prepare-audio 'personal'-shaped? NO - it
  triggers a global extraction, not per-user state; classify like the video
  prepare-audio is classified - CHECK how 'POST /api/videos/:id/prepare-audio'
  is classified and mirror EXACTLY; /tvaudio GATED read).

Client - exactly four edits (from the map):
1. player.js:3034 `armBackgroundAudioSrc`: `var audioUrl = (currentData &&
   typeof currentData.audioSrc === 'string' && currentData.audioSrc) ||
   ('/audio/' + currentId);`
2. player.js:7730 prepare-audio POST: `data.prepareAudioUrl || ('/api/videos/'
   + encodeURIComponent(id) + '/prepare-audio')`.
3. `scheduleAudioStatusRepoll`: carry the same prepare URL through instead of
   rebuilding from id (the gen guard already covers identity).
4. The two mutually-exclusive settings blocks: :7669's gate becomes
   `(!data.statusUrl || data.prepareAudioUrl)` (a tv source WITH prepareAudioUrl
   enters the full bg-audio block) and :7654's tv-only mobileCustomPlayer block
   narrows to `(data.statusUrl && !data.prepareAudioUrl)` so EXACTLY ONE block
   ever runs (both write mobileCustomPlayerCached; both fetch /api/settings -
   two would race). NOTE: with the full block now running for tv, it also
   resolves mobileCustomPlayer (the v1.196.1 fix's job) - the narrowed :7654
   block remains only for a hypothetical statusUrl-without-prepareAudioUrl
   source; verify the v1.196.1 source-lock still binds or update it.
- :7644 `bgAudioStatusKnown = data.audioStatus` needs NO change (the tv
  descriptor now carries it). Everything else (state machine, prime, keep-alive,
  presync, activeMediaElement guards, teardown, progressEndpoint saves,
  artUrl MediaSession art) is untouched and TV-correct as written.
- Docs to update: the v1.196 exec plan + ROADMAP + tech-debt #180 currently
  assert "no background audio for episodes" - reconcile; also note the pair in
  docs/references/ios-background-audio-behavior-map.md if it lists the video pair.

Disclosed nuances (from the map, not new work):
- The gesture-prime's single call site is the custom bar's play button - an
  install with mobileCustomPlayer OFF hands off unprimed, same as ordinary
  videos with native controls (the pre-pause candidate path still fires).
  Dean runs the custom bar, so he gets the prime.
- The feature stays behind the "Background audio for video (experimental)"
  setting - the SAME lever as videos (Dean has it on; parity is the point).
- Concurrency: a fourth single-flight ffmpeg lane (video transcode, video
  audio-extract, tv transcode, tv audio-extract) - the status-quo shape music
  already added; disclosed.

## Gate brief (FULL - the battle-won bg-audio machinery + new serve routes)
- Adversarial: the no-/api/videos invariant STILL holds for a ?tv= load (the
  bg-audio block now runs for tv - its prepare POST must hit /api/tv/*, its
  settings fetch /api/settings, NEVER /api/videos/:id/prepare-audio or
  /audio/:id); mutate each descriptor-override and watch a test red. Ordinary
  video bg-audio byte-identical (no audioSrc/prepareAudioUrl on video
  descriptors). RBAC on /tvaudio + prepare-audio (restricted -> 404, no
  oracle/CPU sink - the video pair's exact posture). The double-settings-fetch
  race (both blocks running). The handoff itself for tv: does
  armBackgroundAudioSrc point at /tvaudio; does the sidecar 503-extract path
  converge. Eviction: a tv-<id>.m4a mid-handoff is markServed-protected.
  Description panel: XSS via a hostile filename/show name (textContent only);
  the poster-avatar leak for a restricted show (avatar url is /tvposter -
  gated). Dock-return: readerHref binds (mutate -> red).
- QA: census/classification for the 2 new routes (mirror the video
  prepare-audio classification exactly); comment accuracy (the "no bg audio for
  tv" claims must be reconciled everywhere); the W2 panel matches the video
  look (formatters shared, no fake views); reachability; token census.

## Ceremony
Standard: likely v1.197.0 -> ROADMAP (honest; the prime nuance + fourth ffmpeg
lane disclosed) -> ledger (user language: "episode audio keeps playing with the
screen off, just like videos; episodes now show their file info; the show acts
like the channel - tap its poster to go back") -> plan to completed/ -> release
branch -> merge --no-ff -> tag -> push -> branch hygiene -> device probe list.
