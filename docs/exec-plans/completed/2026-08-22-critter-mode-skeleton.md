# Sneaky critter mode - the skeleton (v1.166)

Dean (2026-08-22): "a new optional, completely optional fun mode ... critter mode
... completely additive little figures that eventually will just be straight up
transparent PNGs that we will put, like, behind certain elements all over the
place ... sparse, normal and obscene option ... I don't want them to disrupt the
actual video being played or the audio ... come in at different angles ... make
small rectangles that would be filled by them ... won't have them duplicate on
the same page ... if you tap one, it'll make an adorable little noise ... this is
all about building the skeleton." Name (Dean, explicit): **"Sneaky critter mode"**.
Initial art direction: Calico Critters; assets arrive in a later wave.

## Intake rulings (Dean, 2026-08-22)
1. Placement: critters PEEK FROM BEHIND real elements (cards/boxes/menus) - not
   free margin scatter.
2. Setting: Settings -> Appearance, PER-DEVICE (localStorage), like the theme.
3. Re-scatter: EVERY page visit/navigation; never move mid-view.
4. Density (Dean's follow-up, gentler curve): Sparse 1 ("an odd one") / Normal 6
   ("a nice little smattering. Tasteful.") / Obscene 16 ("a little extreme") -
   tunable constants, Dean's tier names kept.
5. THE FOLDER IS THE MANIFEST (Dean's follow-up): `public/critters/` is
   enumerated by NAME-AGNOSTIC server listing (`GET /api/critters` readdirs it) -
   no array-to-filename matching ever. Any image file = a critter; a SOUND file
   with the SAME BASENAME = that critter's tap noise (else the synth beep).
   Dean drops in "super big, crisp" renders; CODE owns the display size (each
   placement gets a height band; the image scales to fit its box regardless of
   source dimensions).
6. Placeholder art: 3 cute ORIGINAL inline-SVG figurines as built-ins (used only
   while the folder is empty). Deliberate deviation from "grab Calico Critters
   PNGs online": committing trademarked character art into the repo is not
   something the assistant will do on Dean's behalf - disclosed in the wave
   report; Dean populates the folder with his own files later today.
7. Tap interactivity (Dean's follow-up): besides the sound, ONE random tiny
   visual reaction per tap from a small pool (wiggle / shiver / hop) - all
   transform-only, fully contained to the critter's own box, "no graphical
   garbage", all dead under prefers-reduced-motion.

## Non-negotiable constraints
- NEVER over/inside the playback surfaces: `#player-wrapper`, `.player-container`,
  `#player-dock`, `#fs-stage`, and any open modal - both as anchors AND as
  overlap targets.
- Purely additive: zero layout shift (absolute layer), `aria-hidden`, layer
  `pointer-events: none`, no scroll-perf listeners (the v1.160.1 class - the tap
  handler is a plain passive document click listener, no touchmove anything).
- No duplicates of one critter on a page.
- OFF by default; the entire subsystem is inert (no layer, no listeners doing
  work) until enabled.

## Architecture
One engine in common.js (all shells load it; zero per-view edits - the SPA
lesson). Layer: `#critter-layer`, absolute at document origin, `z-index: -1` so
in-flow content with backgrounds paints OVER critters = the "peeking from
behind" effect for free; body/root background stays behind them.

Pure core (node:test-able, rects in / placements out - jsdom has no layout):
- `resolveCritterConfig(read)` -> { enabled, density, count } from localStorage
  keys `ft-critters:on` / `ft-critters:density`; safe defaults (off, normal).
- Manifest: `GET /api/critters` (server readdirs `public/critters/`, image
  extensions only, pairs same-basename sound files; the folder ships with a
  README.md documenting the drop-in contract for Dean). Client fetches once per
  page load; empty folder / failed fetch -> the 3 built-in SVG figurines.
  NO-DUPLICATE rule is absolute, so placements cap at the manifest length
  (3 with builtins only - disclosed; populates itself as Dean adds files).
- `planCritterScatter({anchors, exclusions, manifest, count, rng, bounds})` ->
  pure placements: sample anchors + manifest WITHOUT replacement, skip anchors
  intersecting exclusions AND skip any placement whose OWN rect intersects an
  exclusion (gate W1 - the "never overlapped" half) or exceeds the document
  bounds (gate W4 - never grow the page), position each critter straddling a
  random anchor edge (~half hidden; negative coords clip off-page rather than
  clamping fully-inside - gate W2), angle in +-24deg. Exclusions cover the
  playback surfaces + the WHOLE `[class*="-backdrop"]` modal family (gate QA-W1:
  never a one-of-N enumeration), and the tap handler stands down over them too.
- `critterTapHit(placements, x, y)` -> the placement whose rect contains the
  point AND the point is OUTSIDE its anchor rect (only the exposed sliver is
  tappable; the engine never intercepts a click meant for real UI - the document
  listener only acts when the hit lands on exposed critter over background).

DOM half (measurement is jsdom-untestable; disclosed - device pass + source
locks): collect anchors from a curated selector pool (`.video-card`,
`.setup-box`, `.md-group-card`, `.md-hero`, `.action-bar`), measure via
getBoundingClientRect + scroll offsets, plan, render into the layer
(`renderCritterPlacements` IS jsdom-testable with injected placements). Rescatter
hooks: the three router completion sites (swapToView / restoreHomeFromCache /
bootRouter - co-located with probeAndReconcileRepullButton), a debounced resize,
and the Settings apply path. Tap -> `playCritterChirp()` (Web Audio two-note
chirp, ddr-synth posture: guarded, silent no-op without AudioContext) + a wiggle
class (reduced-motion: none).

Settings UI: Appearance section, the hide-stars posture (checkbox + a 3-option
density select, setup.js writes localStorage + calls `window.applyCritterMode()`).
Label: "Sneaky critter mode".

## Out of scope (the asset wave, later)
Real PNGs + real sounds (Dean provides), per-critter art sizing, any density
tuning after device feel, critters in modals/overlays.

## Known skeleton gaps (disclosed up front)
- Anchors are measured shortly after view init; fetch-then-render surfaces keep
  zero-shift skeleton geometry (the shimmer contract) so rects are stable, but a
  surface that grows late may end up critter-less until the next navigation.
- jsdom cannot verify real geometry/stacking; the peek visuals are Dean's device
  pass.

## Gate
FULL gate (new subsystem touching the shared router path), standard brief - no
data-loss surface.

Status: SHIPPED (v1.166.0, 2026-08-22).
Skeleton complete: engine + folder-manifest + settings + tap reactions, FULL gate
(both seats REQUEST CHANGES -> all findings applied -> both APPROVE on delta),
dual-Node 7444/7444. Dean's device pass PENDING. The asset wave is Dean dropping
files into public/critters/ - no code needed; revisit only if the device pass
demands art-driven tuning (per-critter sizing, density feel, img-tint opt-out).
