# Shows in the Roku channel (v1.199 candidate)

Status: SHIPPED as v1.199.0 (2026-08-27; slim gate APPROVE round 2, dual-Node
7653/0; Dean's Roku device pass pending). This doc was the reviewers' spec.
Dean: "Can we get
shows to show up in the Roku app". Designed from a full subsystem map (subagent,
2026-08-27) - the channel is in-repo BrightScript (`roku/`) consuming the
ORDINARY web API with the `ft_session_*` cookie; there are no `/api/roku/*`
routes and this wave adds NONE.

## Ground truth (from the map)

- The channel = 3 screens (Login, GridScreen, the Video node in AppScene). No
  detail screen; a tile plays directly. Sections = `m.viewMode` on ONE MarkupGrid
  ("videos" | "channels") + a Libraries picker (LabelList) with a hard-coded
  trailing "Channels" row. The v1.47 Channels section is the exact precedent.
- Auth: session cookie in the Roku registry (keys all-lowercase - the on-device
  scar), replayed per-task + `m.top.SetHeaders`/`m.video.SetHeaders` (REPLACE
  semantics, load-bearing). First-party posters may use HDPosterUrl (inherit the
  scene agent); ONLY third-party avatar URLs need the separate roHttpAgent (the
  gate-W6 cookie-leak scar) - /tvposter and /tvthumb are first-party.
- Playback: `/video/:id?compat=roku`; `PlaybackGateTask` polls 2-byte Ranges on
  503 `{error:'transcoding'}`. `/tvepisode/:id` has the SAME 503 shape, and the
  tv rendition (tv-<id>.mp4, H.264/AAC/faststart) is byte-for-byte the Roku-safe
  profile - codec-incompatible episodes are ALREADY handled. `?compat=roku`'s
  demuxer fixes (embedded-art strip / rotation bake) are NOT wired for
  /tvepisode - DEFERRED as a disclosed residual (TV rips essentially never carry
  those shapes; ~8 lines later if a device repro appears).
- roku/ is NOT in the Docker image - deployment is `roku/scripts/deploy.sh` from
  the checkout to the device (README). No BrightScript tests exist; channel
  correctness is proven ON-DEVICE (telnet 8085). Dean's Roku = the arbiter.

## THE known trap (the wave's most-likely bug, pre-identified)

The channel signals video COMPLETION with a progress-0 write (`sendProgressComplete`,
the v1.47.1 gate-C1 contract). `/api/tv/progress` has NO progress-0 convention -
position 0 just means "at the start" - and it auto-latches watched at >=90%. TV
completion must POST `/api/tv/played {episodeId}`.

REFINED during implementation (measured against player.js's 'ended' cascade,
line ~4925): the WEB writes progress-0 through `progressEndpoint`
(= /api/tv/progress for tv) on ended too, and relies on its FREQUENT ticking
pings to cross the 90% auto-watch latch. So tv completion on Roku = BOTH:
- the progress-0 write (web parity - without it, the web's silent tv resume
  would reopen a Roku-finished episode at ~97%), AND
- the explicit POST /api/tv/played (the Roku pings every 30s, so a short
  episode can finish without a ping ever landing past 90% - the explicit latch
  closes that gap; /api/tv/progress at 0 never touches the latch).
Two fire-and-forget tasks, two SEPARATE refs (m.progressTask + m.playedTask -
one ref would drop the other task mid-run).

## W1 - server (tiny; NO new routes, census unchanged at 228)

`GET /api/tv/:showId`'s per-episode payload gains two fields (per-field change,
no classification impact):
- `needsTranscode`: the codec-aware `needsTranscode(ep.ext, ep.codec,
  ep.audioCodec)` - lets the channel set streamFormat/gate expectations exactly
  as the video grid does.
- `progress`: the REQUESTER's `getOneTvProgress(req.user.id, ep.id).position`
  (0 absent) - powers the resume prompt from the Roku grid. Requester-scoped
  (the same read the episode-detail route already does) - no cross-user leak.
- also `ext` (the channel's streamFormatForExt needs it; mkv episodes stream as
  "mkv" like the video path).
Tests: rbac-tv asserts the fields on the REAL route + that `progress` is the
REQUESTER's own (member vs admin rows differ) + no full-path leak remains true.

## W2 - the channel (the real work; mirrors the Channels-section recipe verbatim)

New files:
- `roku/components/ShowsTask.{xml,brs}` - GET /api/tv (copy ChannelsTask's 63-line
  shape: message port, 15s timeout, unobserve-before-replace, defensive fields).
- `roku/components/ShowDetailTask.{xml,brs}` - GET /api/tv/{showId}; the seasons
  array is kept in GridScreen state so seasons->episodes needs no second fetch.
- `roku/components/ShowItem.{xml,brs}` - a poster tile copied from GridItem (NOT
  ChannelItem): /tvposter is first-party -> HDPosterUrl + the scene agent.

GridScreen.brs/.xml:
- `m.viewMode` grows "shows" | "seasons" | "episodes"; the Libraries picker's
  trailing rows become a KIND-TAGGED list ("Channels", "Shows") instead of
  positional index math; resetAndLoad gains the three branches (seasons +
  episodes render from cached ShowDetail state - itemComponentName swaps);
  onItemSelected: shows -> fetch detail -> seasons; seasons -> episodes (no
  fetch); episodes -> the SEASON'S episode list becomes the playback queue
  (next/prev/autoplay ride the existing queue machinery for free); Back unwinds
  episodes -> seasons -> shows -> videos; buildEpisodeContentNode sets
  ftSource="tv", ftId, ftDurationText, ftExt, ftMediaType="video",
  ftNeedsTranscode (from W1), ftProgress (from W1), ftHasSubtitles=false,
  HDPosterUrl=/tvthumb/<id>; the videos-only affordances (filter cycle,
  pagination/ensure-loaded, search) guard on the new modes (the gate-S7 posture);
  header/count/empty labels per mode. DEVIATION from the first draft: the Shows
  menu row is UNCONDITIONAL (the Channels-row posture) - the draft said hide it
  when /api/tv/config has no folders, but that route is admin-gated (a member's
  device could never ask) and ConfigTask models the VIDEO roots, not tv. An
  empty/fully-restricted library answers with an honest empty grid instead.
  Single-season shows auto-skip the seasons view (the web's single-season
  posture), and Back skips it symmetrically (m.seasonAutoSkip).
- 404s = "gone" (empty grid), never an error dialog; 401 keeps the authExpired
  mapping.

AppScene.brs:
- startPlaybackFlow branches on ftSource: "tv" -> serverUrl + "/tvepisode/" +
  ftId (NO ?compat=roku - the tv rendition already lands the safe profile);
  streamFormat from ftNeedsTranscode/ftExt exactly like video; skip the
  SubtitleTracks block (no per-episode subtitles endpoint).
- postProgress: ProgressTask gains an `endpoint` field - "/api/tv/progress" for
  tv, "/api/progress" for video (identical {id,timestamp,duration} body).
- COMPLETION (the trap): for ftSource="tv", `sendProgressComplete` must POST
  /api/tv/played {episodeId} (a new tiny PlayedTask or a mode on ProgressTask),
  NEVER the progress-0 write.
- Chapters row suppressed for tv (no chapters field on the tv detail endpoint);
  prewarmNext skips tv (the tv transcode lane is single-flight; a prewarm would
  just enqueue - honest and simple to skip in v1).
- Resume prompt reads ftProgress (W1) with the same threshold behaviour as video.

Housekeeping: `roku/manifest` build_version bump; `roku/README.md`'s
"Videos library only" limitation line updated; deploy.sh untouched.

## Gate (SLIM adversarial; no new routes/auth surface, no data-loss; the channel
is CI-untestable - review-by-read against the map's scars)
Brief: the completion trap (played vs progress-0) verified in the .brs diff; the
W1 payload fields requester-scoped (no cross-user progress leak - behavioural
test); the cookie scars (SetHeaders replace; first-party vs third-party poster
agents; registry lowercase keys); unobserve-before-replace on every new task;
the back-stack unwind order; 404-as-empty; the queue wiring (an episode list as
the queue must not leak into the videos queue state); manifest bumped. Dual-Node
on the server tests. DEAN'S ROKU = the final arbiter (sideload via deploy.sh).

## Disclosed limits (v1)
- No ?compat=roku demuxer fixes on /tvepisode (rare-for-TV shapes; ~8 lines
  later if a device repro appears).
- No episode subtitles/chapters on Roku (no server surface for them).
- No prewarm for episodes; no Continue-Watching row on Roku (the grid is flat;
  can follow if Dean wants it).
- BrightScript remains test-less (the repo's standing posture) - on-device
  verification per README.

## Ceremony
v1.199.0: ROADMAP (honest; the trap + limits disclosed) -> ledger (user
language: "your TV shows now show up in the Roku app - browse shows, pick a
season, play episodes; resume works") -> plan to completed/ -> release branch ->
merge --no-ff -> tag -> push -> hygiene -> Dean's device steps (deploy.sh + the
on-device probe list).
