# TV episodes through the real player + resume + poster upload + RBAC (v1.196 candidate)

> HISTORICAL NOTE (2026-08-27): this plan's "NO background-audio for tv /
> no /audio route" statements were true OF v1.196 and are SUPERSEDED by
> v1.197.0, which shipped the tv sidecar pair (/tvaudio/:id +
> /api/tv/episode/:id/prepare-audio) - see docs/exec-plans/*/tv-wrap-wave.md.

Status: SHIPPED as **v1.196.0** (2026-08-27). All phases (A1-A4, B, C, D) landed;
full two-reviewer gate closed (both APPROVE after one fix round: poster-control
gate alignment + a binding test for the /api/tv/continue visibility filter);
dual-Node 7642/0. Disclosed limits: background-audio-for-episodes not wired; the
"up next" watch-page panel + the mobile bottom-nav customizer entry deferred; custom
posters not in the backup bundle. Big wave -> this doc was the reviewers' spec and
survives context compaction. Dean approved the 4 design decisions (his recs); this
follows v1.195.0 (browse+playback+setup) and v1.195.1 (mobile Playlists + icon).

## Intent (Dean's device feedback on v1.195.0, verbatim core)

> 1. When you open a specific episode the top part is hidden under the top bar.
> 2. There is no mini-player? Why. 3. Can we use the same media player as normal
> videos versus html5. 4. When you launch an episode it doesn't show the episode
> name. 5. With the other player we should have previous/next episode and let
> autoplay and loop also stay ... make it like the youTube player for videos but
> keep the selection and everything else like what we now have. 6. We can add the
> set poster upload.

Items 1-5 are ONE root cause: `public/js/tv.js` `playEpisode()` builds a bespoke
`<video controls>` instead of the app's real player. Route episode playback through
the real player/watch surface and all five resolve; the browse/selection UI stays.

## Decisions locked (Dean approved my recs, 2026-08-26)

1. An episode opens the FULL watch page (`/watch.html?tv=<episodeId>`); Back returns
   to the show detail. The "up next" episode panel ON the watch page is deferred.
2. Next/autoplay advances in WHOLE-SHOW binge order (season, then episode; S2E22 ->
   S3E1), crossing season boundaries.
3. FOLD IN resume + a Continue-Watching row (the previously-deferred Phase 5) so the
   real player feels complete.
4. Set-poster upload stores in the app DATA_DIR keyed by showId (NOT the media
   folder - works on read-only shares); `/tvposter` checks it BEFORE findShowPoster.

## Architecture: 7a - the player is ALREADY source-agnostic

`window.FileTube.player.load(id, data, {slot})` takes a generic descriptor;
`setTrackNav({onPrev,onNext})` takes arbitrary closures; `handleAutoplayNext` and the
loop toggle use that same seam. So episodes reuse the player CONTROLLER (dock,
mini-player, MediaSession/lock-screen, controls, autoplay, loop) with almost no
player change. The work is: a TV entry path in the watch VIEW that builds the
descriptor and bypasses the video-only `/api/videos/*` surfaces.

### HARD INVARIANT (the central correctness guard, machine-tested)
**A `?tv=` load must NEVER issue an `/api/videos/*` request** (that id is not in
`db.metadata`). The watch view has ~15 `/api/videos` couplings (detail :1150, view
ping :1130, related :1549, prev/next folder walk :1704, attribute-channel :2819,
move :2857, dimensions POST via player, subtitles, chapters). The TV path takes a
dedicated branch that reuses ONLY the player-hosting seam and skips/hides every
video-management surface. A test drives a `?tv=` init with a fetch spy and asserts
zero `/api/videos` calls.

## Phasing (small, independently-green task commits)

**A1 - server: the episode detail/status endpoint.**
`GET /api/tv/episode/:id` next to `/tvepisode/:id`, GATED via `tvEpisodeVisibleTo`
(404 on restricted/absent - no info leak), `ownEpisode` own-property guard. Returns
the video-detail-SHAPED object the player already understands:
`{ id, title, showId, showName, seasonNum, episodeNum, durationSec, needsTranscode,
   transcodeStatus, width, height, type:'video', artUrl:'/tvposter/'+showId,
   streamSrc:'/tvepisode/'+id }`. `needsTranscode` = `needsTranscode(ep.ext, ep.codec,
   ep.audioCodec)` (the v1.195.0 codec-aware form); `transcodeStatus` = 'ready' if the
rendition exists else 'pending' (mirror the video field the poll reads). Classify in
route-read-classification (GATED); bump rbac-census EXPECTED_ROUTE_COUNT; add
rbac-tv assertions (restricted member -> 404). Route order: static before `/:showId`
(this is `/api/tv/episode/:id` - distinct segment, fine, but place with the other
static `/api/tv/*` routes BEFORE `/api/tv/:showId`).

**A2 - player.js: widen the streamSrc gate (one line + test).**
`setupForMedia` :7609 `if (data.type === 'audio' && data.streamSrc)` -> allow a video
item to carry an explicit `streamSrc` too. Minimal safe form: `if (typeof
data.streamSrc === 'string' && data.streamSrc) streamUrl = data.streamSrc;`
(ordinary video data carries NO streamSrc, so byte-identical for it; source-lock +
a test that a video descriptor with streamSrc uses it). Verify the transcode poll
(`pollTranscodeUntilReady`, sets `mediaPlayer.src='/video/'+id`) is fed the tv
status: EITHER teach the poll a `data.statusUrl` (so it polls `/api/tv/episode/:id`)
OR have the TV path handle its own readiness. Prefer `data.statusUrl` (small,
general) - the poll at ~:4204 reads the detail endpoint; make the URL come from
`currentData.statusUrl || '/api/videos/'+id`. Same for the live-stream/rendition
src on ready: it must use the tv stream, not `/video/:id` - so on 'ready' set
`mediaPlayer.src = currentData.streamSrc || '/video/'+id`. Enumerate every
`'/video/'+id` / `/api/videos/:id` in player.js (Explore: :7604, :4211, :4502, poll
:4204; art :2558/:7850/:7879; subtitles :7761; audio :3034) and make each tv-aware
via the descriptor or a guard. NO background-audio for tv (no `/audio/:id`) - gate
that path off when `currentData.streamSrc` is a tv source.

**A3 - watch.js TV branch + tv.js rewire.**
- watch.js `init`: if `new URLSearchParams(search).get('tv')`, take the TV path:
  fetch `/api/tv/episode/:id`, build the descriptor, `player.load(epId, descriptor,
  {slot})` + `expand(slot)`, paint `#media-title` = episode title and the uploader
  row = show name, and SKIP all video-only hydration (related rail, view ping,
  dimensions, chapters, subtitles, attribute/move actions hidden). The resume
  overlay reads `descriptor.progress` (wired in Phase B).
- tv.js: DELETE `playEpisode()`; rewire the `.tv-episode-row` click to
  `window.FileTube.navigate('/watch.html?tv='+encodeURIComponent(id))`. Keep the
  pure builders + grid/detail.
- Test: the HARD INVARIANT (no `/api/videos/*` on a `?tv=` load) + title painted +
  the header-offset (episode player sits under the watch surface's header handling,
  fixing item 1).

**A4 - prev/next queue (whole-show order).**
`setupTrackNavContext`: a TV branch that fetches `/api/tv/:showId` (the show of the
current episode - the detail endpoint returns showId), flattens seasons->episodes in
(season, episode) order, computes neighbors around the current episode id, and
`setTrackNav({ onPrev: ()=>navigate('/watch.html?tv='+prev), onNext: ...})`. Autoplay
-next + loop inherit with no player change (they call `trackNavHandlers.onNext`).
Test: neighbor computation crosses seasons; ends are null (no wrap unless loop).

**B - resume + Continue-Watching (the folded-in Phase 5).**
- `lib/auth/store.js`: get/set/add/remove for user_tv_progress/played/liked + a
  `getTvProgressForUser` (Continue). MIRROR the music accessors
  (getMusicProgress/getOneMusicProgress/setMusicProgress/setMusicProgressBatch,
  getMusicLiked/add/remove). The delTv*ByEpisode statements + removeTvEpisodeState
  carrier already exist (Phase 1).
- server.js routes (static before `:id`/`:showId`): `POST /api/tv/progress` (+batch),
  `GET /api/tv/progress/:id`, `POST /api/tv/played`, `POST/DELETE /api/tv/liked`,
  `GET /api/tv/continue` (GATED, visibility-filtered like `/api/tv`). Classify each
  (route-write 'personal' / route-read GATED); bump rbac-census; rbac-tv assertions.
- Watch TV path: the resume overlay reads `descriptor.progress` (populate it in the
  `/api/tv/episode/:id` response per-user); the progress SAVE (timeupdate/ended)
  POSTs to `/api/tv/progress`, NEVER `/api/videos/:id/...`. Mark-watched at 90% (O2).
- tv.js: a Continue-Watching row pinned above the grid (from `/api/tv/continue`),
  reveal/clear BOTH axes.
- Tests: tv-user-store (accessors round-trip + rekey via removeTvEpisodeState);
  rbac-tv for the new routes; the progress-save-goes-to-tv-route invariant.

**C - set-poster upload (item 6).**
- `POST /api/tv/:showId/poster` (admin-only; multipart or raw body like custom-logo),
  magic-byte-sniffed PNG/JPEG/WebP (reuse `CUSTOM_LOGO_TYPES` shape), 1MB-ish cap,
  atomic tmp+rename into a DATA_DIR store keyed by showId (e.g.
  `.tvposters/<showId>.<ext>`), plus a `DELETE` to clear it. showId is md5-hex by
  construction - validate it (own-property against the visible show set / hex shape)
  so no path traversal in the stored filename.
- `/tvposter/:showId`: check the DATA_DIR override FIRST, then findShowPoster
  (folder image), then the generated thumb, then the SVG placeholder. Keep the
  private cache header.
- setup.js: a "Set poster" affordance on each show (or in the Shows-folders builder).
  Design-token CSS only.
- Tests: admin-only; magic-byte rejects a mislabeled non-image; the override wins
  over a folder image; a crafted showId can't escape the store dir; RBAC (a member
  can't upload).

**D - whole-library-tv RBAC completeness fix (found by the v1.195.1 slim gate).**
`VALID_LIBRARY_VALUES` (server.js:6237) omits `'tv'`; the setup RBAC "Whole
libraries" roster (setup.js:2606 `['video','music','podcasts','books']`) has no Shows
checkbox -> a `{kind:'library',value:'tv'}` restriction 400s (server.js:6279), so a
whole-library Shows restriction is UNCREATABLE and the comment at server.js:965-966
over-claims. FIX: add `'tv'` to VALID_LIBRARY_VALUES + the setup checkbox roster (the
comment becomes true). Test: a `{kind:'library',value:'tv'}` restriction is CREATABLE
(200) and ENFORCED (a restricted member is 404'd on every Shows surface - extend
rbac-tv-enforcement with a whole-library restriction case).

## Known limits to DISCLOSE (not built this wave)
- Background-audio-for-video does NOT work for episodes (no `/audio/<episodeId>`
  extraction sidecar); lock-screen play/pause/next/prev DO work.
- The "up next" episode panel on the watch page (decision 1) and the mobile
  bottom-nav customizer "Shows" entry remain deferred.

## Gate brief (FULL - touches the battle-won player + per-user state + access-control)
- Adversarial: the HARD INVARIANT (a `?tv=` load never hits `/api/videos/*`; drive it
  and spy fetch); prev/next queue correctness (season-crossing, ends, a deleted
  episode mid-queue); the new progress/played/liked/continue routes RBAC (a member
  can't read/write another's state; continue is visibility-filtered); poster upload
  (magic-byte bypass, showId path traversal, member forbidden, read-only-share
  failure handled); the whole-library-tv restriction actually ENFORCES (create it,
  prove 404 everywhere); the persist-gate for any new field; player.js streamSrc
  widening doesn't change ordinary video/audio (mutation: a normal video still
  streams `/video/:id`).
- QA: route order/census, comment accuracy (the 965-966 claim must become true),
  reachability of the TV watch branch, token census, migration (no new schema - the
  user_tv_* tables already exist), the music-accessor mirror is faithful.

## Numbers (machine-derived, re-verified each commit - predictions)
- New server routes: 1 (A1 detail) + 5 (B: progress+batch counts as the progress
  route, progress/:id, played, liked POST, liked DELETE, continue) + 2 (C: poster
  POST+DELETE) = ~8-9; bump rbac-census EXPECTED_ROUTE_COUNT accordingly and
  re-derive at each commit (do NOT hand-trust this count).
- player.js: 1 streamSrc line widened + the poll/stream/src sites made descriptor-
  driven (statusUrl/streamSrc); no new player state machine.
- New test files: tv-user-store, tv-episode-detail/api, tv-poster-upload, +
  extensions to rbac-tv-enforcement, watch (the no-/api/videos invariant), tv-view.
- tv.js: playEpisode DELETED; a Continue row added.

## Ceremony
Standard: npm version (likely v1.196.0) -> ROADMAP Shipped (honest, gaps disclosed)
-> docs/releases.json ledger (user language: episodes now play in the real player
with prev/next, autoplay, resume; set a show's poster) -> move this plan to
completed/ -> release branch -> merge --no-ff -> tag -> push -> branch hygiene ->
Dean's device probe list (THE big one: does the watch page feel right for episodes;
prev/next/autoplay/loop; resume; mini-player; the header no longer clips; set a
poster).
