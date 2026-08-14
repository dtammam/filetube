# Exec plan: background-audio position pre-sync + manifest identity (v1.121)

- Owner: main session (lean mode)
- Opened: 2026-08-14
- Target: v1.121.0
- Device pass: PENDING (Dean) - the blip size is only measurable on his iPhone.
- NOT data-mutating (player lifecycle + a settings key + manifest). Slim gate
  (adversarial), briefed HARD on the v1.27/v1.35 battle-won invariants.

## Context (Dean, on-device, 2026-08-14)
Background audio post-v1.120: AUDIO items are gapless-perfect; VIDEO background
audio works via the v1.27 Lever-3 hidden-<audio> handoff but has a ~1/4s blip at
lock/app-switch. Dean has preExtractAudio ON already, so the sidecar is eagerly
BUFFERED - but it buffers FROM ZERO, and the handoff's `bgAudioEl.currentTime =
resumeTime` seek (player.js ~2669) lands in an unbuffered range at minute-20 of a
long video -> the fetch at lock-time IS the blip. Separately: Control Center
now-playing tap opens a WRONG tamm.am-sibling PWA - iOS registrable-domain
attribution, confirmed unfixable website-side (survived delete+re-add; subdomains
can't overlap scopes); we ship manifest `id`/`scope` as free hygiene + one last
re-add roll.

## Design
**T1 - pure decision.** `shouldPresyncBgAudio(ctx)` -> true only when ALL:
`presyncOn` (the NEW setting) + `bgAudioOn` + `mobile` + `isVideo` +
`statusReady` + `bgAudioState === INLINE_VIDEO`. Exported, unit-tested,
fail-safe false.

**T2 - wiring.** `presyncBackgroundAudioPosition()`: guards via T1, requires the
armed sidecar (armBackgroundAudioSrc(), idempotent, the F3b single-assignment
site), then nudges `bgAudioEl.currentTime` to `currentAbsTime()` when drift >
PRESYNC_DRIFT_SECONDS (8s). Called from (a) a THROTTLED `timeupdate` listener
(>=10s between syncs) and (b) `seeked` (a user jump must move the buffer window
immediately). The paused sidecar fetches around its currentTime (preload=auto
under preExtractAudio) -> the handoff seek lands buffered -> play() is
near-instant.

**T3 - the experimental toggle.** `bgAudioSyncPosition` (default false):
DEFAULT_SETTINGS + KNOWN_KEYS + boolean 400-validation + GET projection
(server.js), setup.html toggle "Instant background-audio handoff (experimental)"
with honest copy (extra periodic range-requests while watching; pairs with the
two settings above), setup.js populate+change wiring (saveAutomationSetting),
player.js cached flag alongside preExtractAudioCached.

**T4 - manifest identity.** Explicit `"id": "/"` + `"scope": "/"` in
public/manifest.webmanifest. Free dice-roll for the CC misroute (odds LOW,
disclosed as such).

## Battle-won invariants the gate must verify (attack surfaces)
- **F3b:** armBackgroundAudioSrc stays the ONLY real-URL assignment site; presync
  NEVER runs with the setting(s) off (a disabled install never touches /audio/:id).
- **Never touch a LIVE sidecar:** presync must be impossible during HANDING_OFF /
  BACKGROUND_AUDIO (would scrub the actually-playing element). T1's
  INLINE_VIDEO-only gate; mutation-test it.
- **Audio items untouched** (no sidecar concept); desktop no-op (mobile gate).
- **The handoff itself byte-unchanged** (attemptBackgroundAudioHandoff untouched;
  presync only warms the buffer it seeks into).
- **No timer/listener leak:** piggybacks existing element listeners (timeupdate/
  seeked), no new intervals; throttle state resets per load.
- Settings: 400 on non-boolean; the toggle round-trips.

## Stop condition
Adversarial APPROVE (slim); dual-Node green; released with device pass PENDING.
Dean's iPhone: with the toggle ON, the lock-blip on a long video (seek to
~minute 20 first) should shrink vs. today; toggle OFF must byte-revert to
current behavior. Move to completed/ at release.
