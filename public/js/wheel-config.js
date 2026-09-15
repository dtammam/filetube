// FileTube wheel config - the SINGLE source of truth for the click-wheel haptic
// behaviour, shared by the "Click wheel test" diagnostic (setup.js, which WRITES it)
// and the real mobile iPod wheel (skin-surface.js, which READS it on every skin
// mount). Before v1.303 the two carried DUPLICATE constants kept in sync by hand
// (setup.js WHEEL_CAL "== skin-surface.js ..."), the exact drift scar this module
// kills: both now source their constants + live config from here, so they cannot
// drift by construction.
//
// Device-local (localStorage): haptic capability and feel vary per phone, and the
// test tool is itself device-local. A saved config is honoured on the NEXT skin
// mount (the wheel reads it at gesture start); no cross-view live sync is needed,
// because the test lives on setup.html and the real wheel on music/podcasts.
(function () {
  'use strict';

  var KEY = 'ft-wheel-config';

  // Shared physical constants (were duplicated across setup.js WHEEL_CAL +
  // skin-surface.js local vars / magic numbers). ONE source now.
  var CONST = {
    STEP_DEFAULT: 3.75,     // Classic 96 detents/rev - the default tick step (degrees)
    MIN_MS: 8,              // haptic throttle floor (drop, never queue)
    BIAS_DEFAULT: 18,       // ghost bias / sweep dither amplitude (px), the probe-C bias
    DEAD_FRAC: 0.20,        // centre dead-zone (Select) as a fraction of wheel radius
    BAND_INNER_MAX: 0.47,   // metering ring-band edges (the test tool's meter only)
    BAND_MID_MAX: 0.73,
    DEFAULT_STEP_ARC_PX: 6, // the test tool's arc-length meter default
  };

  // The 5 tunable fields the test menu DRIVES and the real wheel HONOURS.
  var ENGINES = ['ghost', 'grid', 'sweep'];
  var DITHERS = [14, 18, 24];       // px swing per notch
  var DETENTS = [3.75, 5.5, 8];     // degrees per detent (Fine 96 / Med / Coarse)
  var CAPTURES = ['8px', 'press', 'off'];
  // DEFAULT == today's shipping feel exactly (Ghost, Fine-96, capture-after-8px, buzz on),
  // so an unset / never-opened config is a byte-for-byte no-op on the real wheel.
  var DEFAULT = { engine: 'ghost', dither: 18, detent: 3.75, capture: '8px', buzz: true };

  function inList(v, list) { return list.indexOf(v) >= 0; }
  function pick(v, list, dflt) { return inList(v, list) ? v : dflt; }

  // Clamp every field to a legal value; unknown / garbage -> the shipping default.
  // buzz is ON unless EXPLICITLY false (so an absent field keeps the haptic).
  function normalize(cfg) {
    cfg = cfg || {};
    return {
      engine: pick(cfg.engine, ENGINES, DEFAULT.engine),
      dither: pick(Number(cfg.dither), DITHERS, DEFAULT.dither),
      detent: pick(Number(cfg.detent), DETENTS, DEFAULT.detent),
      capture: pick(cfg.capture, CAPTURES, DEFAULT.capture),
      buzz: cfg.buzz !== false,
    };
  }

  function storeOf(store) {
    if (store) return store;
    try { return (typeof window !== 'undefined') ? window.localStorage : null; } catch (_) { return null; }
  }

  // Read + normalize the saved config; any failure (no storage, private mode,
  // corrupt JSON) yields the shipping default - the wheel never breaks on a bad read.
  function read(store) {
    var ls = storeOf(store);
    if (!ls) return normalize(null);
    try { return normalize(JSON.parse(ls.getItem(KEY))); } catch (_) { return normalize(null); }
  }

  // Validate + persist; returns the normalized value actually stored.
  function write(cfg, store) {
    var n = normalize(cfg);
    var ls = storeOf(store);
    if (ls) { try { ls.setItem(KEY, JSON.stringify(n)); } catch (_) { /* private mode - best effort */ } }
    return n;
  }

  // The engine the REAL wheel actually runs. Grid is a DIAGNOSTIC only: iOS
  // target-locks a touch to the one switch it lands on, so a grid can never tick
  // across a spin (proven in the test tool). On the real wheel Grid -> today's Ghost.
  function effectiveEngine(cfg) {
    var e = normalize(cfg).engine;
    return e === 'grid' ? 'ghost' : e;
  }

  // The shared Sweep FEEL math: the single tracked switch's px offset under the
  // finger - a sine that carries the switch's midline past the finger once per
  // detent. BOTH the test's placeSweep and the real wheel call THIS, so the two
  // feel identical by construction (no drift).
  function sweepOffset(sweepAngleDeg, dither, detentDeg) {
    var d = (detentDeg > 0) ? detentDeg : CONST.STEP_DEFAULT;
    return dither * Math.sin((sweepAngleDeg / d) * Math.PI);
  }

  var api = {
    KEY: KEY, CONST: CONST,
    ENGINES: ENGINES, DITHERS: DITHERS, DETENTS: DETENTS, CAPTURES: CAPTURES, DEFAULT: DEFAULT,
    normalize: normalize, read: read, write: write,
    effectiveEngine: effectiveEngine, sweepOffset: sweepOffset,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FileTubeWheelConfig = api;
})();
