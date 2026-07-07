# Discovery — v1.22.1 "mobile-player follow-up" (targeted bug-fix round)

You are the **product-manager**. Run **Discovery** for a SMALL, surgical
bug-fix round and author the exec plan (Goal / Scope / Out-of-scope /
Constraints / product forks / Flag-for-PE / grouped-and-tagged acceptance
criteria / Decision log). Do **not** write application/test code and do
**not** touch git. When done, report back for Design routing
(`/prep-pe-design`).

## Read first (in order)

1. `.state/feature-state.json` — the round's grounded diagnosis, hard
   constraints, iOS scope flags, proposed FR shape, and Dean's speed
   directive are all already recorded there. Treat `grounded_diagnosis`
   as your starting ground truth (I read the live code to produce it).
2. `docs/CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/RELIABILITY.md`
   (no headless/E2E — Dean's on-device pass is the documented arbiter).
3. `docs/exec-plans/completed/2026-07-08-v1.22-player-parity.md` — the
   **§ Design (FR-1)** section defines the responsive-controls split
   (`resolveMobileFormFactor`/`isMobileFormFactor`, `resolveControlsMode`,
   `applyControlsMode`, the `.ff-mobile` class) that these bugs
   regress/expose. This round fixes bugs IN that design; do not re-litigate it.
4. The live code you must confirm against: `public/js/player.js` and
   `public/css/style.css` (key line refs in `grounded_diagnosis`).

## Context

Dean tested v1.22.0 on-device (iPhone / iOS Safari, and desktop) and found
**five** real bugs. This is a LEAN follow-up: **v1.22.1**, off `main` (now at
v1.22.0), suggested branch `feature/v1.22.1-mobile-player-fixes`. Dean's
directive: **keep this round super quick** — smallest correct fix per bug,
no broad rework, minimize tasks/waves. Almost every change is expected to be
confined to `public/js/player.js` + `public/css/style.css` (+ the four
byte-identical shells only if FR-4 adds a speed button to `#player-controls`).

## The five bugs (Dean's verbatim, then interpretation)

1. **Mobile AUDIO** — "the full screen button doesn't work, holding doesn't
   allow for 2x, and no playback speed options." → `#fs-btn` on the mobile
   audio custom bar is a no-op (audio has no native fullscreen; on iOS
   `webkitEnterFullscreen()` no-ops for an audio item). hold-2x on
   `#audio-bg-art` isn't engaging. No persistent speed affordance exists.
2. **Mobile VIDEO — CRITICAL live regression** — "there are no visible
   controls — if i tap forward and back i can get the 15s skip but that's
   it." → In FULL, the custom bar is hidden (`style.css:3201`) AND the native
   `controls` attribute is present (`player.js:520-530`), yet the user sees
   NEITHER. See `grounded_diagnosis.bug2_mobile_video_CRITICAL` for the full
   ruled-out list and the leading root cause (gesture layer swallowing the
   taps iOS needs to re-reveal auto-hidden inline native controls). **PE must
   confirm the exact root cause on real iOS behavior before designing the
   fix** — flag it as the Design stage's #1 job.
3. **Rotate-to-fullscreen (audio + video)** — "turning sideways doesn't
   fullscreen." → An orientationchange→fullscreen listener ALREADY exists
   (`player.js:1685-1711`); leading root cause is that iOS Safari refuses
   programmatic fullscreen without a direct user gesture. **iOS platform-limit
   scope call for Dean** — may be an honest no-code/scoped outcome.
4. **Desktop playback-speed missing (audio + video)** — "desktop with audio
   loses the ability to change playback for audio, desktop with video doesn't
   have it however the pip button is quite nice." → The v1.21 custom bar never
   re-exposed a speed affordance. **Unifies with bug 1**: playback speed is
   not a first-class control on the custom bar anywhere. Desktop PiP is GOOD —
   leave it.
5. **Desktop click-video-to-pause missing** — "for desktop i can't click the
   video to pause." → `#media-player` (video) is wired with NO `onSingleTap`
   (`player.js:1670`); only `#audio-bg-art` has click-to-toggle
   (`player.js:1646`). Add YouTube-style click-on-video→play/pause for desktop
   video, isolated from the controls bar + skip gestures (reuse the audio
   path's `scheduleArtSingleTap`/`cancelPendingArtTap` debounce), without
   breaking mobile single-tap semantics.

## What to produce

Author `docs/exec-plans/active/2026-07-07-v1.22.1-mobile-player-fixes.md` with:

- **Goal / Scope** — recommend structuring as **5 lean FRs, one bug each**
  (see `proposed_fr_shape_for_pm` in state): FR-1 = bug 2 (CRITICAL,
  root-cause first), FR-2 = bug 1, FR-3 = bug 3, FR-4 = bug 4 unified with
  bug-1 speed (ONE persistent speed control, reconciled with the existing
  `.speed-badge`), FR-5 = bug 5. Confirm each FR against the live code and
  correct my grounded_diagnosis if anything is off.
- **Out-of-scope** — anything beyond these five bugs; NO refactor of the FR-1
  responsive-controls architecture beyond what each root cause requires;
  desktop PiP untouched; no new npm deps; no new server routes.
- **Constraints** — copy/adapt from `hard_constraints` in state (additive/no
  regressions across dock/prev-next/autoplay/overlays/Media Session/progress/
  loop/PiP; four-shell byte-identical `#player-host-template` if a control id
  is added; era-theme tokens + ≥44px mobile touch targets; single shared
  mobile-detection helper; CONTRIBUTING.md discipline; Node 22; on-device
  arbiter).
- **Product forks** — resolve with a recommendation, don't block. Likely
  forks: (a) mobile-audio `#fs-btn` → remove vs. make-meaningful; (b) speed
  control → extend `.speed-badge` vs. new `#speed-btn`, and cycle-button vs.
  menu; (c) whether mobile VIDEO needs OUR speed control at all if bug-2 routes
  to native (don't double up); (d) bug-3 honest scope if iOS forbids it.
- **iOS platform scope flags for Dean** — surface the three in
  `ios_scope_flags_for_dean` (state) explicitly so Dean makes the call.
- **Acceptance criteria** — grouped by FR, each tagged `[UNIT]`/`[INTEGRATION]`/
  `[MANUAL]`/`[PROCESS]`, with the review tier noted. Heavy two-reviewer +
  Dean iOS arbiter ONLY for FR-1 (bug 2) and anything touching the
  persistent-player mount/dock/`applyControlsMode` path; LIGHT single-QA +
  on-device for FR-2/FR-3/FR-4/FR-5 per Dean's lean-gate directive. Every FR
  ships a `node:test` for any new pure helper + a regression lock, per
  CONTRIBUTING.
- **Flag for the principal-engineer** — lead with bug-2 root-cause
  confirmation (the single most important Design task); then the speed-control
  mechanism (`.speed-badge` reconciliation + four-shell parity if a button is
  added); the bug-3 iOS scope call; the bug-5 desktop-video click isolation
  (must not double-fire vs. controls-clicks or dblclick-skip, must not touch
  mobile).

## Guardrails

- **Keep it SMALL.** Dean explicitly wants this fast. Resist scope creep
  beyond these five bugs. Prefer the smallest correct fix; flag any place a
  root cause genuinely forces more.
- Coordinator owns ALL git. You write the exec plan + update state to
  `stage=discovery` artifacts; you do NOT commit and do NOT write code.
- Node 22 toolchain (path in state `scope_summary`) if you run anything.
