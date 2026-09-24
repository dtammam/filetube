'use strict';

// POCKET LIGHTING (Dean 2026-09-24: "Does PWA have any access to gyroscopic info ... I'd like the
// color/shadow on the theme to reflect. The sheen from the click wheel etc. I'd like that to be
// somewhat 'realistic' based on gyro data.") - a fixed light in the room, read through the phone's
// orientation sensor (or the mouse on a desktop), written as TWO CSS custom properties on the
// skin panel (`--lx`, `--ly`, each in [-1, 1]: where the light sits relative to the device). The
// Click skins' CSS moves every highlight toward the light and every shadow away from it; with the
// properties unset the calcs resolve to today's constants, so Off is byte-for-byte today's look.
//
// Scope (Dean's ruling, plan 2026-09-24-pocket-gyro-lighting): the Click family only (Click, Click
// Black, Click Matte); the engine's `isPocket` is the registry's menus === 'click'. Seattle keeps
// its look. Strength Off / Subtle / Pronounced is device-local (localStorage), default Off, chosen
// from the pocket menu's Settings > Lighting; the strength tap is what asks iOS for motion access.
//
// The HARD constraint (the old ambient mode blacked out video on iPhone): this module only ever
// writes two numbers; the CSS it feeds animates gradient positions, a transform and an opacity on
// small layers - no filter, blur, mask or backdrop, ever. The frame loop runs only while a Click
// skin is painted, visible and lit, writes only when a value moved, and parks itself when the light
// has settled; every teardown arm (skin switch, dock, hidden tab, pop-out close, reduced motion)
// unbinds the listener and cancels the loop. The pure half (mapping, filter, strength) is
// dual-exported so it unit-tests via require without jsdom (the wheel-config.js pattern).
(function () {
  var KEY = 'ft-pocket-lighting';
  var STRENGTHS = ['off', 'subtle', 'pronounced'];
  var GAIN = { off: 0, subtle: 0.5, pronounced: 1 };
  var TILT_RANGE_DEG = 28;    // this much tilt from the neutral pose = the light at the edge (|l| = 1)
  var TILT_SIGN = -1;         // G3: tilt right -> the highlights slide LEFT (the light is fixed in the room)
  var SMOOTH_TAU_MS = 90;     // the light's easing toward its goal (sensor noise never jitters a highlight)
  var LEAVE_TAU_MS = 360;     // G7: the mouse leaving the player eases the light back to neutral
  var RECENTER_TAU_MS = 8000; // G5: the neutral pose drifts to wherever you settle (a table, lying down)
  var WRITE_EPS = 0.003;      // a smaller move than this is not written (no style work while still)
  var PARK_MS = 300;          // settled + no sample for this long = the frame loop parks (no rAF at all)
  var SENSOR_FRESH_MS = 1500; // a sensor sample this recent outranks the mouse
  var SENSOR_WAIT_MS = 2000;  // no fine pointer and no sample this long after a pick = "no motion sensor here"
  var NOTE_DENIED = 'Motion access was denied. The look stays as today.';
  var NOTE_NO_SENSOR = 'No motion sensor here.';
  var NOTE_REDUCED = 'Reduce Motion is on. Lighting stays still.';

  function normalizeStrength(v) { return STRENGTHS.indexOf(v) >= 0 ? v : 'off'; }
  function storeOf(store) {
    if (store) return store;
    try { return (typeof window !== 'undefined') ? window.localStorage : null; } catch (_) { return null; }
  }
  function readStrength(store) {
    var ls = storeOf(store);
    try { return normalizeStrength(ls && ls.getItem(KEY)); } catch (_) { return 'off'; }
  }
  function setStrength(v, store) {
    var ls = storeOf(store);
    var n = normalizeStrength(v);
    try { if (ls) ls.setItem(KEY, n); } catch (_) { /* private mode: the pick lasts this open only */ }
    return n;
  }
  function clamp1(v) { return v > 1 ? 1 : (v < -1 ? -1 : v); }
  function num(v) { var n = Number(v); return (v === null || v === undefined || v === '' || isNaN(n)) ? null : n; }
  // Device axes (beta = front/back, gamma = left/right, W3C DeviceOrientation) to SCREEN axes by
  // the screen's rotation: +x = the device's top-right side is up, +y = its bottom is down. A null
  // component = no sensor sample (desktop Chrome fires the event with nulls).
  function mapTilt(beta, gamma, angle) {
    var b = num(beta); var g = num(gamma);
    if (b === null || g === null) return null;
    var a = ((Math.round(Number(angle) || 0) % 360) + 360) % 360;
    if (a === 90) return { x: b, y: -g };
    if (a === 180) return { x: -g, y: -b };
    if (a === 270) return { x: -b, y: g };
    return { x: g, y: b };
  }
  // The screen's rotation: screen.orientation (iOS 16.4+, Android, desktop), else the legacy
  // window.orientation (older iOS; -90 = 270), else portrait.
  function orientationAngle(win) {
    try { if (win.screen && win.screen.orientation && typeof win.screen.orientation.angle === 'number') return win.screen.orientation.angle; } catch (_) { /* fall through */ }
    try { if (typeof win.orientation === 'number') return win.orientation; } catch (_) { /* fall through */ }
    return 0;
  }
  function k(dt, tau) { return dt > 0 ? 1 - Math.exp(-dt / tau) : 0; }
  // The neutral pose (G5): the FIRST sample after a start is neutral; from then on the baseline
  // drifts toward the live sample with RECENTER_TAU_MS, so a held tilt slowly reads as level again.
  // Returns the light's GOAL for this sample (opposite the tilt, TILT_RANGE_DEG = the edge).
  function recentre(st, tx, ty, dt) {
    if (!st.seeded) { st.bx = tx; st.by = ty; st.seeded = true; }
    else { var kb = k(dt, RECENTER_TAU_MS); st.bx += (tx - st.bx) * kb; st.by += (ty - st.by) * kb; }
    // (`|| 0` folds a -0 to 0: a neutral pose is exactly 0)
    return { x: clamp1(TILT_SIGN * (tx - st.bx) / TILT_RANGE_DEG) || 0, y: clamp1(TILT_SIGN * (ty - st.by) / TILT_RANGE_DEG) || 0 };
  }
  // Ease the light toward its goal; true when the eased value differs from the last WRITTEN one
  // by more than WRITE_EPS (the caller writes then).
  function ease(st, gx, gy, dt, tau) {
    var ks = k(dt, tau || SMOOTH_TAU_MS);
    st.x += (gx - st.x) * ks;
    st.y += (gy - st.y) * ks;
    return Math.abs(st.x - st.wx) > WRITE_EPS || Math.abs(st.y - st.wy) > WRITE_EPS;
  }
  // G7 (desktop): the pointer over the panel IS the light - its offset from the panel's centre.
  function pointerLight(x, y, rect) {
    var w = rect && Number(rect.width); var h = rect && Number(rect.height);
    if (!(w > 0) || !(h > 0)) return null;
    return { x: clamp1((x - (rect.left + w / 2)) / (w / 2)), y: clamp1((y - (rect.top + h / 2)) / (h / 2)) };
  }
  function newFilter() { return { seeded: false, bx: 0, by: 0, x: 0, y: 0, wx: 0, wy: 0 }; }

  // ---- the driver: one per engine surface -------------------------------------------------
  // o = { panel, win, doc?, isPocket() -> bool, store?, now?() }
  function create(o) {
    var panel = o.panel;
    var win = o.win || (panel.ownerDocument && panel.ownerDocument.defaultView) || window;
    var doc = o.doc || panel.ownerDocument || document;
    var isPocket = typeof o.isPocket === 'function' ? o.isPocket : function () { return false; };
    var store = o.store || null;
    var nowFn = typeof o.now === 'function' ? o.now : function () { try { return win.performance.now(); } catch (_) { return Date.now(); } };
    var on = false, raf = null, lastTick = -1;
    var st = newFilter();
    var tilt = null;               // the latest sensor sample (screen axes, degrees)
    var goal = { x: 0, y: 0 };     // the pointer's goal (mouse mode)
    var mode = 'none';             // 'tilt' | 'pointer' | 'none'
    var leaving = false;           // the mouse left: ease home slowly
    var lastSampleAt = -Infinity, lastTiltAt = -Infinity;
    var samples = 0, writes = 0;
    var note = '', permission = '';
    var observer = null;           // the dock watcher (see start): the panel emptied or hidden with no destroy()

    function strength() { return readStrength(store); }
    function gain() { return GAIN[strength()] || 0; }
    function reduced() { try { return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; } }
    function finePointer() { try { return !!(win.matchMedia && win.matchMedia('(pointer: fine)').matches); } catch (_) { return false; } }
    function painted() { return !!(panel && !panel.hidden && panel.firstChild && panel.isConnected); }
    function trayUp() { try { return !!(doc.body && doc.body.classList.contains('mms-tray')); } catch (_) { return false; } }
    // The one question every arm asks: should the light be live on this surface right now?
    function wanted() {
      var ok = false;
      try { ok = gain() > 0 && !!isPocket() && painted() && !doc.hidden && !trayUp() && !reduced(); } catch (_) { ok = false; }
      return ok;
    }
    function write() {
      st.wx = st.x; st.wy = st.y; writes += 1;
      try { panel.style.setProperty('--lx', st.x.toFixed(3)); panel.style.setProperty('--ly', st.y.toFixed(3)); } catch (_) { /* detached */ }
    }
    function clearProps() {
      try { panel.style.removeProperty('--lx'); panel.style.removeProperty('--ly'); } catch (_) { /* detached */ }
      try { panel.classList.remove('mms-lit'); } catch (_) { /* detached */ }
    }
    function arm() {
      if (!on || raf != null) return;
      try { raf = win.requestAnimationFrame(tick); } catch (_) { raf = null; }
    }
    function disarm() {
      if (raf == null) return;
      try { win.cancelAnimationFrame(raf); } catch (_) { /* ignore */ }
      raf = null;
    }
    function tick(t) {
      raf = null;
      if (!on) return;
      if (!wanted()) { stop(); return; } // the dock / a hidden tab / a strength change since the last frame
      var now = nowFn();
      var dt = lastTick < 0 ? 16 : Math.max(0, Math.min(100, now - lastTick));
      lastTick = now;
      var g = gain();
      var target;
      if (mode === 'tilt' && tilt) target = recentre(st, tilt.x, tilt.y, dt);
      else target = goal;
      var moved = ease(st, target.x * g, target.y * g, dt, (mode === 'pointer' && leaving) ? LEAVE_TAU_MS : SMOOTH_TAU_MS);
      if (moved) write();
      var tx = target.x * g, ty = target.y * g;
      var settled = Math.abs(st.x - tx) < WRITE_EPS && Math.abs(st.y - ty) < WRITE_EPS &&
        // in tilt mode the goal itself is still moving until the neutral pose has drifted onto the
        // held tilt (G5) - parking early would freeze the light off-centre
        (mode !== 'tilt' || (Math.abs(tx) < WRITE_EPS && Math.abs(ty) < WRITE_EPS));
      // park when the light has settled and no sample has arrived for a while (nothing to animate);
      // the next sample re-arms the loop. (A live sensor streams samples, so it never parks mid-use.)
      if (settled && now - lastSampleAt > PARK_MS) { lastTick = -1; return; }
      arm();
    }
    function onOrient(e) {
      var m = mapTilt(e && e.beta, e && e.gamma, orientationAngle(win));
      if (!m) return;
      samples += 1;
      tilt = m; mode = 'tilt'; leaving = false;
      lastSampleAt = lastTiltAt = nowFn();
      arm();
    }
    function mouseOnly(e) { return !e || !e.pointerType || e.pointerType === 'mouse'; }
    function onMove(e) {
      if (!mouseOnly(e)) return;                              // a finger never moves the light
      if (nowFn() - lastTiltAt < SENSOR_FRESH_MS) return;     // a live sensor outranks the mouse
      var r = null;
      try { r = panel.getBoundingClientRect(); } catch (_) { r = null; }
      var p = pointerLight(e.clientX, e.clientY, r);
      if (!p) return;
      goal = p; mode = 'pointer'; leaving = false;
      lastSampleAt = nowFn();
      arm();
    }
    function onLeave(e) {
      if (!mouseOnly(e) || mode !== 'pointer') return;
      goal = { x: 0, y: 0 }; leaving = true;
      lastSampleAt = nowFn();
      arm();
    }
    function onVisibility() { sync(); }
    function start() {
      if (on) return;
      on = true;
      st = newFilter(); tilt = null; goal = { x: 0, y: 0 }; mode = 'none'; leaving = false; lastTick = -1;
      lastSampleAt = lastTiltAt = -Infinity;
      try { win.addEventListener('deviceorientation', onOrient); } catch (_) { /* no window */ }
      try { panel.addEventListener('pointermove', onMove); panel.addEventListener('pointerleave', onLeave); } catch (_) { /* detached */ }
      try { doc.addEventListener('visibilitychange', onVisibility); } catch (_) { /* detached */ }
      // The DOCK: the view clears the panel (hidden + innerHTML = '') WITHOUT destroy() (the v1.256
      // class). The frame loop notices on its next tick - but a PARKED loop (a still device, a
      // desktop with no sensor) has no next tick, and the sensor listener would sit bound until the
      // next sample (the headless probe measured exactly that). So the release is STRUCTURAL, like
      // the ghost lock's: an observer on the panel re-asks the question the moment it empties or
      // hides, whatever did it.
      try {
        var MO = win.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
        if (MO) { observer = new MO(function () { if (on && !wanted()) stop(); }); observer.observe(panel, { childList: true, attributes: true, attributeFilter: ['hidden'] }); }
      } catch (_) { observer = null; }
    }
    function stop() {
      disarm();
      clearProps();
      if (!on) return;
      on = false;
      if (observer) { try { observer.disconnect(); } catch (_) { /* gone */ } observer = null; }
      try { win.removeEventListener('deviceorientation', onOrient); } catch (_) { /* ignore */ }
      try { panel.removeEventListener('pointermove', onMove); panel.removeEventListener('pointerleave', onLeave); } catch (_) { /* ignore */ }
      try { doc.removeEventListener('visibilitychange', onVisibility); } catch (_) { /* ignore */ }
    }
    // Called by the engine after every paint (paint rebuilds the panel's className, so the lit
    // class is re-applied here), on visibility changes, and after a strength choice.
    function sync() {
      if (!wanted()) { stop(); return; }
      start();
      try { panel.classList.add('mms-lit'); } catch (_) { /* detached */ }
    }
    // Settings > Lighting (G4): store the pick, and - from the TAP that chose it, so the user
    // activation is live - ask iOS for motion access. Resolves with state() once the answer is in.
    function choose(v) {
      var n = setStrength(v, store);
      note = '';
      if (n === 'off') { sync(); return Promise.resolve(state()); }
      if (reduced()) { note = NOTE_REDUCED; sync(); return Promise.resolve(state()); }
      var DOE = null;
      try { DOE = win.DeviceOrientationEvent || null; } catch (_) { DOE = null; }
      if (DOE && typeof DOE.requestPermission === 'function') {
        var p;
        try { p = DOE.requestPermission(); } catch (e) { p = Promise.reject(e); }
        sync(); // bind now: a remembered grant streams at once; a pending prompt streams after it
        return Promise.resolve(p).then(function (r) { permission = r === 'granted' ? 'granted' : 'denied'; }, function () { permission = 'denied'; })
          .then(function () {
            if (permission !== 'granted') note = NOTE_DENIED;
            sync();
            return state();
          });
      }
      sync();
      // No permission API (Android, desktop): a sensor just streams. A device with no fine pointer
      // that streams nothing within SENSOR_WAIT_MS has no sensor to speak of - say so (a desktop's
      // mouse needs no note: it IS the light).
      if (finePointer()) return Promise.resolve(state());
      return new Promise(function (resolve) {
        var t = null;
        try { t = win.setTimeout(function () { if (on && samples === 0) note = NOTE_NO_SENSOR; resolve(state()); }, SENSOR_WAIT_MS); } catch (_) { t = null; }
        if (t == null) resolve(state());
      });
    }
    function state() {
      return { on: on, listening: on, raf: raf != null, samples: samples, writes: writes, lx: st.x, ly: st.y, mode: mode,
        strength: strength(), gain: gain(), note: note, permission: permission };
    }
    return { sync: sync, choose: choose, state: state, destroy: stop };
  }

  var api = {
    KEY: KEY, STRENGTHS: STRENGTHS, GAIN: GAIN, TILT_RANGE_DEG: TILT_RANGE_DEG, TILT_SIGN: TILT_SIGN,
    SMOOTH_TAU_MS: SMOOTH_TAU_MS, RECENTER_TAU_MS: RECENTER_TAU_MS, WRITE_EPS: WRITE_EPS, PARK_MS: PARK_MS, SENSOR_WAIT_MS: SENSOR_WAIT_MS,
    NOTE_DENIED: NOTE_DENIED, NOTE_NO_SENSOR: NOTE_NO_SENSOR, NOTE_REDUCED: NOTE_REDUCED,
    normalizeStrength: normalizeStrength, readStrength: readStrength, setStrength: setStrength,
    mapTilt: mapTilt, orientationAngle: orientationAngle, recentre: recentre, ease: ease, pointerLight: pointerLight, newFilter: newFilter,
    create: create,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FileTubePocketLighting = api;
})();
