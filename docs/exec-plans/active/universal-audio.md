# Exec plan: universal audio - one player for all non-video sound (v1.242)

Status: ACTIVE (targeting v1.242.0)
Branch: `feat/universal-audio`

> **SCOPE UPDATE (Dean, this session):** #3 (podcasts on the skin surface) is SPLIT
> to its own wave **v1.243** - it's a skin-engine extraction that deserves a focused
> wave + gate, and splitting gets #2/#4 to Dean's device sooner. So **v1.242 ships
> T1 (#4) + T3 (#2) + T5 (settings)**; T2 folded into the device pass; **T4 (#3) is
> deferred to v1.243** (its recon anchors are preserved below for that wave).
Owner: main session (lean mode)
Gate: FULL two-reviewer gate. The #4 projection change alters a **library-wide,
RBAC-gated read surface** (what appears in Music, for whom) - the
access-control-completeness + persist-gate families - so it gets full rigor; the
adversarial seat is briefed to leak a restricted user's audio into Music and to
break the podcast-skin reuse.

## Intent (Dean, this session)

Three asks bundled into one branch (Dean: "can we do 2. 3. and 4. in one branch"),
sharing one spine: **the music/iPod player is the home for ALL non-video audio.**
- "Anything that's audio only can be listened to in the audio player."
- "I kind of just like everything being flipped instantly."
- Podcasts: "the original POD-cast" - play them through the iPod/skin surface.
- The friction to kill: today tapping a downloaded song does tap -> a brief
  `/watch`/song view -> jump into the pocket player. Native-in-Music removes the
  round-trip.

## Locked intake (Dean, this session)

1. **#2 hold prev/next = FAST-SCAN** the timeline: hold FF -> playhead sweeps
   forward ~2x WITH audio, hold REW -> backward; RELEASE resumes from where it
   landed. (Not 2x-playback, not step-jumps.)
2. **#3 podcasts = SKIN-SURFACE ONLY**: episodes play through the iPod/Apple/
   Spotify skin + wheel; podcasts KEEP their own section + data (show notes,
   per-episode resume, seasons). NO merge into the Music library.
3. **#4 audio downloads = auto-project into Music** (NOT native ingest): extend the
   EXISTING projection so eligibility is simply `type==='audio'`; instant (reads
   `db.metadata` live), no `db.music` writes, no backfill pass, no prune trap.
   (Recon killed native-ingest: the store invariant forbids outside writes, and
   the music-scan prune would DELETE native records pointing at yt-dlp files.)

## Recon anchors (Explore agent, verified)

- Projection: `projectedLibraryTracks` (server.js ~8386) unions into `/api/music`,
  `/albums`, `/artists`, `/api/music/:id`. Builds from `Object.values(db.metadata)
  .filter(type==='audio')` -> `libraryAudio.isEligibleAudio(item, marks, autoSet)`
  (lib/music/libraryAudio.js:27-52) -> `mediaVisibleTo` RBAC -> `projectAudioItem`
  (libraryAudio.js:101-143) -> `expandAudioToTracks` (chaptered -> `::c` tracks).
- Current gates (to change): (a) per-user `musicIncludesLibrary === 'on'`,
  default OFF (server.js:8388); (b) channel all-or-nothing: mark in
  `db.music.channels[folder]` else strict-majority-`genre==='Music'` auto.
- `type` = extension-only: `AUDIO_EXTENSIONS` (server.js:1162), set at
  server.js:4672. `resolveItemChapters` (server.js:3268).
- Podcasts play via `window.FileTube.player.load(ep.id, data, ...)` with
  `data.resumeMode:'podcast'`, `streamSrc:'/episode/<id>'`,
  `artUrl:'/podcastart/<subId>'` (podcasts.js:813-866). Own panel
  `#podcast-nowplaying-panel`.
- Skin gate: `getCurrentMeta().isMusic = currentData.resumeMode === 'music'`
  (player.js:8427); `skinActiveFor` needs `isMusic` + mobile (music-skins.js:204).
- Skin ENGINE (bindSkinSurface/paintSkin/buildSkinCtx/renderNowPlayingSkin) are
  music.js closures bound to `#music-nowplaying-panel`; `buildSkinCtx` reads
  music.js-private `queue`/`nowPlaying`/`playingId` and hardcodes
  `/albumart/<playingId>`. Pop-out `mountPopout` (music.js ~1460) is the precedent
  for mounting the engine on a dynamically-created panel.

## Design decisions (mine; flagged for Dean)

- **#4 eligibility becomes `type==='audio'`, unconditional**, dropping BOTH the
  per-user `musicIncludesLibrary` gate AND the channel-music-majority auto. KEEP the
  explicit channel **'off' mark** as an opt-OUT (so a user who deliberately hid a
  channel keeps it hidden). RBAC stays `mediaVisibleTo` (unchanged - projected
  tracks already use it; a restricted user still cannot see hidden audio). No new
  per-item field -> **no persist-gate/backup change** (the projection is derived,
  not stored). The `musicIncludesLibrary` setting is retired from the projection
  path (left as a no-op toggle or removed from the UI - TBD in T1).
- **#3 requires extracting the skin engine** into a shared surface the podcasts
  shell can drive, OR (lighter) routing a podcast "open in skin" to a shared
  mount like the pop-out. Chosen: a shared `mountSkinSurface(panel, ctxProvider)`
  extracted from the music.js closures, with a `ctxProvider` that supplies
  track/art/queue so a podcast supplies `/podcastart/<subId>` + its episode list.
  `getCurrentMeta().isMusic` stays player.js-owned and BYTE-UNCHANGED - instead the
  skin gate widens client-side to accept `resumeMode==='podcast'` via a new
  `skinActiveFor` input (music-skins.js is not player.js, so it may change).
  **This is the biggest/riskiest task; if the extraction proves too invasive for
  one wave, #3 splits to its own follow-up and #2+#4 ship as v1.242.**
- **player.js BYTE-UNCHANGED** across the whole wave (all three proxy/consume it).

## Task commits (each green before the next)

- **T1 (#4):** projection eligibility -> `type==='audio'` unconditional + channel
  'off' opt-out; retire `musicIncludesLibrary` from the projection. Server tests +
  RBAC census (a restricted user's audio still 404s / absent). MACHINE-DERIVED
  prediction re-verified in-test: count of `db.metadata` audio items newly visible.
- **T2 (#4 friction):** confirm the home-feed/grid/continue tap on an audio-only
  item opens cleanly in the music player now that it resolves natively (revisit the
  v1.236 `musicHrefForItem` reroute + `&ao=1` bounce - the bounce should now never
  fire for audio-only, since every such id resolves). Tests.
- **T3 (#2):** hold prev/next wheel-zones = fast-scan (reuse the seek pipeline: a
  held-timer steps currentTime ~2x with audio; release commits via #seek-bar
  'change'). Arbitration with the existing tap=skip / rotate=scrub / hold=scan.
  Gesture-scar playbook (Pointer events, dual-arm teardown, no latch). Tests.
- **T4 (#3):** extract `mountSkinSurface` + `ctxProvider` from music.js; widen the
  skin gate for `resumeMode==='podcast'`; drive the skin from the podcasts view
  with a podcast ctx (episode list on the wheel, `/podcastart` art, per-episode
  resume preserved). Tests + a shell-coverage check.
- **T5:** CSS/settings clean-up (retire the `musicIncludesLibrary` toggle if T1
  removes it; any podcast-skin styles). lint:css 0.

## Machine-derived predictions (re-verified at every commit)

- player.js diff vs `main`: **0 bytes**.
- lint:css TOTAL: **0**; full suite green on both Node versions.
- New/changed server routes: **0** (projection is inside existing routes) - the
  RBAC census EXPECTED_ROUTE_COUNT stays 236 (a lock: if it changes, something
  unплanned added a route).
- #4 visibility: a test asserts a specific `type:'audio'` fixture item is present
  in `/api/music` for an unrestricted user AND absent for a user restricted from
  its folder (the RBAC bind).

## Gate brief - named attack surfaces (adversarial seat)

- **RBAC leak (the destructive angle):** with eligibility now `type==='audio'`
  unconditional, prove a member RESTRICTED from an audio item's folder still cannot
  see its title/count via `/api/music`, `/albums`, `/artists`, `/api/music/:id`.
  The gate is still `mediaVisibleTo` - confirm it wasn't loosened. Try a
  path/folder/library restriction (the kinds that DIVERGE, per the RBAC gate-kind
  lesson).
- **Projection completeness:** every Music read surface (list/albums/artists/
  resolve/search) applies the same eligibility + RBAC - no surface leaks the newly-
  eligible audio to a restricted user.
- **#2 gesture:** teardown on pointerup AND pointercancel; no latch; a tap still
  skips the track; hold-scan releases the seek pipeline exactly once; interaction
  with the v1.239 scrub + the v1.240 chapter-loop (a fast-scan past a looped
  chapter boundary).
- **#3 skin reuse:** the extracted engine still drives the /music surface
  byte-for-behavior identically (no regression to v1.238-241); a podcast episode's
  art is `/podcastart` not `/albumart`; per-episode resume + show-notes preserved;
  no `body.mms-on` leak across the podcasts<->music view swap (the v1.227 destroy
  lesson).
- **player.js:** byte-identical to main.

## Residuals / non-goals

- No podcast->Music library merge (skin surface only).
- Album shelves for library audio stay absent (`album:''`) - most yt-dlp audio has
  no album tag; chaptered files already become `::c` album virtual tracks.
- If T4 (#3) proves too invasive, it splits to a follow-up wave (disclosed).
