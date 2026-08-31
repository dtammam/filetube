# Exec plan: mobile music player — skins over one engine (mobile-only)

Status: SHIPPED v1.227.0 (2026-08-31; full gate, both seats APPROVE after one fix
round - the adversarial CRITICAL mms-on leak + QA's token-lock/seek findings;
player.js byte-unchanged. Dock mini + seek a11y deferred; DEVICE PENDING). Owner:
main session. Gate: FULL (touches the battle-won shared
player's presentation + gating; the reviewer's whole job is to try to break
background play / lock-screen / desktop). Dean (2026-08-31): make the MOBILE music
experience excellent (Spotify / YouTube Music / iTunes-iPod inspiration), as a set
of user-pickable SKINS. Mockup approved (all three "clean as hell"), interaction
confirmed: full-screen IS the persistent now-playing mode; the mini-player is the
browsed-away state and tapping it returns to full-screen. Mockup:
https://claude.ai/code/artifact/033b8ee3-bc04-4f27-9a87-3df589a6b204

## The one architectural rule (non-negotiable)
KEEP the audio ENGINE; build a new PRESENTATION on top. The skin is pure CHROME
that (a) PROXIES user actions to the player's existing hidden controls, and (b)
REFLECTS state by subscribing to the `#media-player` element's events + reading the
public API. It NEVER calls the background-audio / MediaSession / handoff / keep-
alive code — so it cannot break them. (Map: player.js single-host model, ONE cloned
`#player-wrapper` reparented between `#player-slot` (full, in-view) and
`#player-dock` (mini, shell). bg-audio: attemptBackgroundAudioHandoff/
primeBackgroundAudioElement/activeMediaElement/start-stopBgKeepAlive; MediaSession:
setupMediaSession/setMediaSessionAction — ALL OFF-LIMITS, reflect only.)

### Proxy + reflect contract (how the skin talks to the engine)
- Play/pause: the skin's play button CLICKS the host's hidden `#pp-btn` (NOT
  mediaPlayer.play()) — the ppBtn path runs `primeBackgroundAudioElement()` first
  (gesture-safe bg-audio prime, player.js:6091). Single-sourced.
- Prev/Next: CLICK `#track-prev-btn` / `#track-next-btn` — reuses setTrackNav's
  registered handlers + the lock-screen previous/nexttrack wiring, unchanged.
- Seek: set `#seek-bar`.value + dispatch its 'input'/'change' (the existing seek
  path), or `#media-player`.currentTime — prefer the seek-bar so the existing
  handler owns it.
- Reflect: subscribe to `#media-player` play/pause/timeupdate/loadedmetadata/ended
  (the wireHostListeners set) to update the skin's play glyph + scrubber; read
  `player.getState()` / `getCurrentMeta()` for track identity + full/dock state.
- Up-next: the music view already owns the live `queue` + renders the now-playing
  panel; the FULL skin reuses that data.

## Gating (strict — desktop + non-music untouched)
Skin is active ONLY when BOTH: (1) mobile — `matchMedia('(max-width: 768px)')` (the
app's existing breakpoint; player.js:1918 isMobileViewport / :1937
isMobileFormFactor), and (2) music — `getCurrentMeta().isMusic` (resumeMode ===
'music', player.js:8427). Everything else — desktop music, video, podcasts, books,
the docked bar on desktop — renders the DEFAULT player chrome byte-unchanged. A
narrow desktop window (<=768px) counts as mobile by design (responsive-consistent).

## The skin framework
`public/js/music-skins.js` (new, browser global `window.FileTubeMusicSkins`) — a
skin REGISTRY mirroring the glyph-pool / view-registry patterns:
- `SKINS = [{ id, label, renderFull(ctx), renderMini(ctx) }]` for
  `spotify` | `ipod` | `apple`. `ctx` = { track:{title,artist,album,artUrl},
  upNext:[{index,title,artist,state}], playing, posSec, durSec }.
- `activeSkinId()` — reads the per-user setting (default 'apple'); `setActiveSkin`.
- The render funcs return HTML strings with STABLE data-action hooks
  (`data-skin-play`, `data-skin-prev`, `data-skin-next`, `data-skin-seek`,
  `data-skin-go="<i>"`, `data-skin-expand`, `data-skin-collapse`) so ONE delegated
  handler (in the owning view) proxies them to the host controls. Skins are
  presentation only — zero engine calls.
Per-skin CSS lives in style.css under a `.mms-<skin>` scope (census-clean; tokens
or token-exempt viewport/positional literals as the existing player rules do).

## Ownership split (minimizes player.js risk)
- FULL now-playing skin: the /music view (music.js) owns it — it already mounts
  `#player-slot` + renders `#music-nowplaying-panel` there and holds the `queue`.
  The full skin renders INTO the music view's now-playing area on mobile+music,
  and a class hides the default host chrome (`#player-controls`, `#audio-bg-art`)
  while the skin is active. Reached only via the music view (?nowplaying=1), so the
  view is always the owner.
- MINI skin (dock): player.js owns `#player-dock` (shell-persistent, shows across
  views). Extend `ensureDockChrome` / the docked branch of `applyControlsMode`
  (player.js:1986, the single controls authority, re-runs on every transition) to
  render the skinned mini for music+mobile; tap-to-expand keeps the existing
  readerHref `/music?nowplaying=1` return. This is the ONLY player.js behavioral
  touch, and it is class/branch-gated on music+mobile.

## Slices (each independently testable; ship as ONE release, Dean's call)
1. **Framework + gating + picker setting.** music-skins.js registry (stub renders),
   the mobile+music gate helper, the Settings picker (per-user, like the icon set),
   the shared delegated proxy handler. Bind: gate true only on mobile+music; the
   setting round-trips; proxy clicks reach `#pp-btn` etc.
2. **FULL skin — Apple Music (flagship).** Render the full now-playing into the
   music view on mobile+music; hide default host chrome via a class; wire
   proxy+reflect. Device-validate. Bind: skin chrome present + default chrome
   hidden ONLY on mobile+music; play proxies to #pp-btn; scrubber reflects
   timeupdate; desktop music unchanged.
3. **FULL skins — Spotify + iPod.** Two more render modules + CSS. Bind each.
4. **MINI skin (dock) for the 3 skins** (player.js ensureDockChrome extension) +
   tap-to-expand return. Bind: docked music+mobile shows the skinned mini; desktop/
   video dock unchanged; expand returns to full. (DEFERRABLE/disclosed if the wave
   runs long — the existing dock already returns to full; the SKINNED mini is the
   last polish.)

## Named attack surfaces for the FULL gate (brief the adversarial to DESTROY these)
- **Background play** — the #1. Prove the skin never calls handoff/keep-alive/
  MediaSession; that its play button routes through `#pp-btn` (prime intact); that
  lock-screen + backgrounded playback still work (the skin only reflects
  `#media-player` events, and `activeMediaElement()` semantics are unchanged).
- **Lock-screen / MediaSession** unchanged (metadata, prev/next, seek).
- **Desktop untouched** — desktop music, and ALL video/podcast/book/desktop paths,
  render the default chrome byte-identical (gating).
- **Non-music on mobile** — a mobile VIDEO / podcast / book must NOT get the skin
  (gate on resumeMode==='music', not type==='audio').
- **Reparent integrity** — full↔dock↔close keeps the skin correct + never orphans/
  double-renders chrome; the single cloned host is never rebuilt.
- **No engine regression** — the existing player + music suites stay green; the
  proxy buttons exist and are wired (a missing #pp-btn/#seek-bar is a dead skin).

## Verification
Per-slice unit (jsdom, source-locks where the player has no jsdom harness — #180) +
the full player/music suites green before the gate. FULL two-reviewer gate. Dual-
Node. DEVICE PASS is the real arbiter for the skins' feel (disclosed PENDING).
