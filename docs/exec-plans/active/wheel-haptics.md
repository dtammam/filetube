# Wheel haptics - real per-detent Taptic ticks on the iPod wheel (v1.256)

Status: ACTIVE. Dean 2026-09-03: "I need to make haptic vibration work with the scroll
wheel... dig deep and be creative. It will be hugely impactful." Device-confirmed the
same day via the Taptic Probe artifact: "WHOA NEW THINF WORKED... a0 a and c all work."
Feel ruling: "as aggressive as the iPod Classic" (the real Classic ~96/rev) -
implemented at 4.5 = 80/rev, re-tuned to 3 = 120/rev ("even higher frequency"),
settled at 3.75 = 96/rev - the Classic's OWN number (v1.256.2: 3 was "a little too hot");
the tick floor (30ms at v1.256; **8ms since v1.271**) bounds how fast ticks can fire.

## The mechanism (device-confirmed on Dean's iPhone, iOS 26.6.1)

WebKit's `<input type="checkbox" switch>` plays an OS haptic (UIImpactFeedbackGenerator
Light) through TWO trigger paths. Apple's iOS 26.5 patch gated only SwitchTrigger::Click
behind a user gesture; **SwitchTrigger::PointerTracking is exempt** (the patch commit
says so). During a thumb DRAG that STARTED on the switch, WebKit re-evaluates the
finger's position against the track midline on EVERY touchmove - THROUGH CSS TRANSFORMS
(absoluteToLocal UseTransforms) - and each crossing flips the switch and ticks. So: an
invisible switch rides under the finger, and JS counter-translates it once per detent so
every detent reads as a crossing. Probes A0/A/C all confirmed by Dean's thumb.

CONSTANTS (WebKit source): tracking arms ~200ms after touchstart (switchHeldDelay); the
first flip needs ~40% of track width of travel, then trackWidth/2 per flip; the Taptic
engine saturates ~30ms between impacts **- UNEVIDENCED, see below**.

HARD RULES (probe-derived, each one broke a probe iteration):
1. **`touch-action:none` ANYWHERE on the switch's ancestor chain KILLS tracking** (probe
   v1's failure: 1 tick per 50-75 tries - only accidental taps registered).
2. Never `preventDefault()` a touchstart/touchmove that should reach the switch.
3. Never write `.checked` from JS mid-drag (willUpdateCheckedness aborts tracking).
4. Single finger only; scroll suppression must come from a body `position:fixed` lock,
   not touch-action (probe v2 validated this swap - it flipped everything to working).

## The conflict with the existing wheel

- `.mms-full` (style.css:11007) carries `touch-action:none` over the whole skin - rule 1
  says this kills the ghost switch. It exists to stop the page behind the fixed layer
  from scrolling under wheel drags. `body.mms-on` does NOT freeze the body itself.
- The wheel gesture (skin-surface.js onDown/onMove/onUp, WHEEL_STEP_DEG=22) is pointer-
  event driven with setPointerCapture; zones (MENU/prev/next/play) are real buttons and
  the center-select tap passes through onDown's dead-center early return; v1.242's
  fast-scan keys off `e.target.closest('[data-skin-next]')` at onDown.

## Design

**Feature gate `hapticCapable`**: `('switch' in document.createElement('input'))` AND a
touch pointer. Everything below engages ONLY behind it; non-capable devices keep
byte-identical behavior (no ghost mounted, no CSS class, no body lock).

**T1 - the carve-out**: when a capable engine paints the full skin, add `mms-haptic` to
the panel. CSS: `.mms-full.mms-haptic{ touch-action:auto; }`. Scroll suppression moves
to a body lock (`position:fixed` + stored scrollY, the probe's mechanism) applied while
`mms-on` + capable, released on skin teardown (destroy() + the mms-on removal path).
Inner scrollers (qlist/listview pan-y) are unaffected (their own touch-action stands).

**T2 - the ghost overlay**: one `<input type="checkbox" switch>` mounted inside
`.ip-wheel`, covering the ANNULUS hit area (a centered block scaled to the wheel,
opacity 0.001, aria-hidden, tabindex -1), so every rotation touchstart lands ON it and
arms tracking. Consequence: zone/center CLICKS now target the ghost - onClick and
onDown's fastScan/center checks gain a ROUTE-THROUGH: when the event target is the
ghost, hit-test the point (elementsFromPoint minus the ghost, rect fallback) and treat
the found zone/center as the target (a zone click routes to the real button's .click()).
A tap on the ghost also toggles it (one stray tick on a zone tap = acceptable, arguably
authentic - the Classic clicked on button presses too).

**T3 - the tick engine**: per-gesture state rides the existing `st`:
`HAPTIC_STEP_DEG = 3.75` (v1.256.2 Classic parity; 4.5 then 3 before it), `HAPTIC_MIN_MS = 8` (was 30 - see the v1.271 note).
In onMove (BOTH modes, after `d` is computed): `hapAccum += Math.abs(d)`; while
`hapAccum >= HAPTIC_STEP_DEG` consume one step and (throttle permitting) flip the bias
and re-translate the ghost so the finger sits ±18px past the midline; excess ticks under
throttle are DROPPED, not queued. The ghost follows the finger between ticks (translate
on every move) so the midline is always adjacent. Scan-hold produces no rotation and no
ticks. onUp/cancel restores the ghost transform.

**Predictions (machine-verified at each commit)**: `git diff main -- public/js/player.js
public/js/music.js server.js` stays empty; the only touched files are
public/js/skin-surface.js, public/css/style.css, and tests.

## v1.271: the 30ms "constant" was ours, not WebKit's

CORRECTION to this plan's own CONSTANTS section. It filed ~30ms under "(WebKit
source)"; an investigation searched WebKit's switch pointer-tracking path and
UIImpactFeedbackGenerator and found **no evidence of any such rate limit**. It was
our guess, recorded as if sourced, and then quoted back to Dean as fact.

What 30 actually did, measured: pegged delivery at a FLAT ~30 ticks/second no matter
how fast the wheel turned - 68.75% of a 1 rev/s spin's ticks discarded - where a real
Classic's rate rises with the hand. Dean: "I want there to be more haptic feedback
than not... it really should feel like the real thing."

Now 8ms, below the 8.33ms ProMotion frame, so it can never bind before the
mechanism's own ceiling of one tick per pointermove. Measured yield: 60Hz 30 -> 60
ticks/s (2x), 120Hz 30 -> 120 (4x). SAFE because Dean device-confirmed the engine
DROPS rather than queues (ticks stop dead when his finger does). Consequence to know:
at 120Hz the floor never binds at all, so tick rate there is purely display-bound.

## Device-probe risks (Dean's pass arbitrates; disclosed if shipped unresolved)

- **setPointerCapture**: unknown whether capturing the pointer on the wheel disturbs
  WebKit's internal touch tracking (the probe never captured). If ticks die on-device:
  the capable path skips capture (fallback ready; the capture guards edge-exit drops).
- **The 200ms arm delay**: the first ~200ms of a fast spin won't tick (WebKit constant,
  not ours). Expected feel: ticks "catch up" as the spin continues.
- Zone-tap stray tick (T2) and VoiceOver behavior of the aria-hidden ghost.
- Cover geometry (adversarial S1) - **CLOSED v1.267, Dean arbitrated.** The residual
this line recorded was real and he felt it: at the old fixed `scale(7.5)` the cover
was 390x240 against a ~273-288px wheel, so a rotation STARTED in the outer ~16px at
12/6 o'clock armed no tracking and the whole gesture was silent. Dean: "it's when
it's near the top edge it feels bad." The cap is gone; the cover is now `h/32`, i.e.
EXACTLY the wheel's height (scale up to 9; cover up to 468x288; per-side horizontal
overhang up to ~90px on the iPod, clipped by `.mms-full{overflow:hidden}` and beside
nothing coordinate-dependent). Seattle Classic is unchanged by that fix - its pad was
already under the old cap at every viewport - so if the wheel still feels unreliable
THERE, the cause is different (candidate in tech-debt #207).

- Theoretical lock strand (QA delta, on record; RESTORED v1.267 - the cover-geometry
  rewrite deleted this bullet along with the one it was closing, and the slim seat
  caught it): a FUTURE teardown that swaps the panel NODE itself, destroy-less, while
  PAUSED would orphan observer+ghost together, so healGhostLock never fires and the
  body scroll-lock survives - the browse view stays pinned until a reload. No live path
  does it (both views mutate the captured panel in place; the #view-root swap runs
  destroy()); playing heals via the media-event belt. STILL OPEN.

## Tests (jsdom = wiring; the FEEL is Dean's device)

Capable-path harness (stub the switch support probe): ghost mounted in the wheel with
the switch attribute + aria-hidden; rotation drives translate calls at the 4.5-degree
cadence (advancing performance.now stub for the throttle axis; 3.75deg since v1.256.2); NO .checked writes
(source-lock + a runtime spy); teardown removes the ghost/lock/class on destroy AND on
pointercancel; the OFF path (no switch support) mounts nothing and leaves the panel
class-free (byte-identical axis); zone route-through: a click targeting the ghost over
a zone rect reaches the zone button. Re-run the v1.233 gesture locks + the full sticker
suites. Full gate (gesture-scar territory), dual-Node, v1.256.0.
