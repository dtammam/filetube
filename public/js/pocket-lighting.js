'use strict';

// POCKET LIGHTING (Dean 2026-09-24: "Does PWA have any access to gyroscopic info ... I'd like the
// color/shadow on the theme to reflect. The sheen from the click wheel etc. I'd like that to be
// somewhat 'realistic' based on gyro data.") - a fixed light in the room, read through the phone's
// orientation sensor (or the mouse on a desktop). Since the third swing (2026-09-25, the research
// doc) it is a REFLECTION: one environment map (window panes, a lamp, a room ramp) positioned in
// degrees of reflected angle against a gravity-referenced key pose, written as CSS custom properties
// on the skin panel (`--fx/--fy` px for the flat surfaces, `--dx/--dy` for the dome, `--dom`, `--la`,
// `--wt`, `--lx/--ly`, plus the measured geometry `--k`, `--dr`, `--lcx/--lcy`, and `--lk` the alpha
// factor). The Click skins' CSS shows that map per material; with the classes off none of it exists,
// so Off is byte-for-byte today's look.
//
// Scope (Dean's ruling, plan 2026-09-24-pocket-gyro-lighting): the Click family only (Click, Click
// Black, Click Matte); the engine's `isPocket` is the registry's menus === 'click'. Seattle keeps
// its look. Strength Off / Subtle / Pronounced is device-local (localStorage), default Off, chosen
// from the pocket menu's Settings > Lighting; the strength tap is what asks iOS for motion access.
//
// The HARD constraint (the old ambient mode blacked out video on iPhone): this module only ever
// writes numbers; the CSS it feeds moves gradient positions (a per-frame repaint of the body, the
// glass and the dome) - no filter, blur, mask, backdrop or blend mode, ever. The frame loop runs only while a Click
// skin is painted, visible and lit, writes only when a value moved, and parks itself when the light
// has settled; every teardown arm (skin switch, dock, hidden tab, pop-out close, reduced motion)
// unbinds the listener and cancels the loop. The pure half (mapping, filter, strength) is
// dual-exported so it unit-tests via require without jsdom (the wheel-config.js pattern).
(function () {
  var KEY = 'ft-pocket-lighting';
  var STRENGTHS = ['off', 'subtle', 'pronounced'];
  // Third swing (2026-09-25, the research doc "making the lighting look physically real", Dean's rulings):
  // a REFLECTION, not a sheen. The light is GRAVITY-REFERENCED: a fixed KEY POSE in screen-axis degrees;
  // the reflected angle is twice the tilt away from it (a mirror rotates a reflection by 2 x delta); the
  // face spans ~24 deg of view at 350 mm, so `k = panelHeight / 24` px per degree. GAIN is now the ALPHA
  // factor of every reflection layer (Subtle = 0.6 x Pronounced), not a travel scale. No opening-pose
  // neutral and no slow re-centre (a real lamp never fades); only a pose held > OFF_DEG from the key for
  // > OFF_MS (lying in bed) glides the key to it.
  var GAIN = { off: 0, subtle: 0.6, pronounced: 1 };
  var KEY_X = -3;             // the key light's pose, screen x (deg): a touch off-axis (gate r1 qa W2: the research's
                              // -10 put the window 700 px off a 390 px face at a straight hold - nothing showed)
  var KEY_Y = 58;             // screen y (deg): a typical 50 deg hold puts the window's lower edge across the upper third
  var FACE_DEG = 24;          // the face's angular span at a phone's viewing distance
  var DOME_BETA = 15;         // the dome's edge slope (deg): its image moves R / (2 beta) px per degree against the
                              // flat face's k - about 17x slower on an 844 px panel with a 54 px dome
  var DOME_CLAMP = 1.3;       // the dome image may sit this far past the rim (it clips)
  var DOME_FADE_DEG = [28, 34]; // the dome image fades between these reflected angles (off the rim)
  var MOUSE_DEG = 12;         // the pointer at the panel's edge = this reflected angle
  var TAU_MS = 60;            // sensor smoothing (above ~120 ms the reflection lags the hand: floaty)
  var TAU_MOUSE_MS = 100;     // pointer smoothing
  var OFF_DEG = 35, OFF_MS = 2000, GLIDE_TAU_MS = 1500; // the only re-centre: a far-off pose held for 2 s
  var WRITE_EPS_DEG = 0.02;   // a smaller move than this is not written (0.7 px at k = 35: no style work while still)
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
  // Gate r1 (qa S3): the left/right axis is the GRAVITY-PROJECTED roll, asin(cos(beta) * sin(gamma)),
  // not raw gamma - held upright (beta near 90) raw gamma is unstable and flips sign past vertical
  // (the gimbal), which would throw the light edge to edge; the projection shrinks smoothly to 0 at
  // vertical and keeps its sign through it. Flat (beta 0) it IS gamma.
  // Gate r2 (adversary W5): the pitch is atan2(sin(beta), cos(beta) * cos(gamma)), not raw beta -
  // at vertical the W3C Euler angles swap (beta, gamma) -> (180 - beta, -gamma), and raw beta jumped
  // by twice the roll there; the atan2 pitch is continuous through vertical and equals beta flat.
  // (It still wraps at +-180, which wrapDiff below takes care of.)
  var RAD = Math.PI / 180;
  function roll(b, g) {
    var v = Math.cos(b * RAD) * Math.sin(g * RAD);
    return Math.asin(v > 1 ? 1 : (v < -1 ? -1 : v)) / RAD;
  }
  function pitch(b, g) { return Math.atan2(Math.sin(b * RAD), Math.cos(b * RAD) * Math.cos(g * RAD)) / RAD; }
  function mapTilt(beta, gamma, angle) {
    var b = num(beta); var g = num(gamma);
    if (b === null || g === null) return null;
    var r = roll(b, g); var p = pitch(b, g);
    var a = ((Math.round(Number(angle) || 0) % 360) + 360) % 360;
    if (a === 90) return { x: p, y: -r };
    if (a === 180) return { x: -r, y: -p };
    if (a === 270) return { x: -p, y: r };
    return { x: r, y: p };
  }
  // The screen's rotation: screen.orientation (iOS 16.4+, Android, desktop), else the legacy
  // window.orientation (older iOS; -90 = 270), else portrait.
  function orientationAngle(win) {
    try { if (win.screen && win.screen.orientation && typeof win.screen.orientation.angle === 'number') return win.screen.orientation.angle; } catch (_) { /* fall through */ }
    try { if (typeof win.orientation === 'number') return win.orientation; } catch (_) { /* fall through */ }
    return 0;
  }
  function k(dt, tau) { return dt > 0 ? 1 - Math.exp(-dt / tau) : 0; }
  // Gate r2 (qa W5): the pitch (beta) wraps at +-180 - lying on your back with the phone overhead
  // (Dean's G5 pose) the sensor jitters between +179 and -179, and a plain difference read that as a
  // 358-degree tilt and averaged the neutral pose to 0. Every angle difference takes the SHORT way
  // round, and the baseline stays folded into [-180, 180).
  function wrapDiff(a, b) { return ((a - b + 540) % 360 + 360) % 360 - 180; }
  function fold(a) { return ((a + 180) % 360 + 360) % 360 - 180; }
  // The reflected angle from a tilt sample (screen-axis degrees) against the key pose: a mirror turns a
  // reflection by TWICE the tilt. The pitch difference takes the short way round (beta wraps at +-180).
  function reflected(st, tx, ty) {
    return { ex: 2 * wrapDiff(tx, st.kx), ey: 2 * wrapDiff(ty, st.ky) };
  }
  // The key glide - the only re-centre: a pose held more than OFF_DEG from the key's pitch for OFF_MS
  // (lying in bed) glides the key to it with GLIDE_TAU_MS; anything closer leaves the key alone.
  function glideKey(st, ty, dt, now) {
    var d = wrapDiff(ty, st.ky);
    if (st.gliding) {
      // once started, a glide runs until the key sits on the pose (never parks 35 deg short)
      st.ky = fold(st.ky + d * k(dt, GLIDE_TAU_MS));
      if (Math.abs(d) < 0.5) { st.ky = fold(ty); st.gliding = false; st.offSince = -1; } // snap the last half degree (a 0.9 deg reflected offset otherwise)
      return true;
    }
    if (Math.abs(d) <= OFF_DEG) { st.offSince = -1; return false; }
    if (st.offSince < 0) { st.offSince = now; return false; }
    if (now - st.offSince < OFF_MS) return false;
    st.gliding = true;
    return true;
  }
  // Ease the reflected angle toward its target; true when the eased value differs from the last
  // WRITTEN one by more than the write epsilon (the caller writes then).
  function ease(st, tex, tey, dt, tau) {
    var ks = k(dt, tau);
    st.ex += (tex - st.ex) * ks;
    st.ey += (tey - st.ey) * ks;
    return Math.abs(st.ex - st.wex) > WRITE_EPS_DEG || Math.abs(st.ey - st.wey) > WRITE_EPS_DEG;
  }
  // G7 (desktop): the pointer over the panel IS the light - its offset from the panel's centre, as a
  // reflected angle of +-MOUSE_DEG at the edges.
  function pointerLight(x, y, rect) {
    var w = rect && Number(rect.width); var h = rect && Number(rect.height);
    if (!(w > 0) || !(h > 0)) return null;
    return { ex: clamp1((x - (rect.left + w / 2)) / (w / 2)) * MOUSE_DEG, ey: clamp1((y - (rect.top + h / 2)) / (h / 2)) * MOUSE_DEG };
  }
  function smoothstep(a, b, v) { var t = (v - a) / (b - a); t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); }
  // The per-surface properties from one reflected angle (ex, ey in degrees; k px/deg; R the dome radius):
  // the flat face moves `k` px per degree, the dome `R / (2 beta)` px per degree (about 15x slower), the
  // dome image fades once the reflected angle passes the rim, the lip ring follows the light's azimuth.
  function surfaces(ex, ey, kpx, R) {
    var m = Math.max(Math.abs(ex), Math.abs(ey));
    var dr = 1 / (2 * DOME_BETA);
    var cl = function (v) { return v > DOME_CLAMP ? DOME_CLAMP : (v < -DOME_CLAMP ? -DOME_CLAMP : v); };
    return {
      fx: ex * kpx, fy: ey * kpx,
      dx: R * cl(ex * dr), dy: R * cl(ey * dr),
      dom: 1 - smoothstep(DOME_FADE_DEG[0], DOME_FADE_DEG[1], m),
      la: (ex === 0 && ey === 0) ? 0 : Math.atan2(ey, ex) / RAD,
      wt: 1 - Math.min(1, m / DOME_FADE_DEG[1]),
      lx: clamp1(ex / MOUSE_DEG), ly: clamp1(ey / MOUSE_DEG),
    };
  }
  function newFilter() { return { kx: KEY_X, ky: KEY_Y, offSince: -1, gliding: false, ex: 0, ey: 0, wex: 0, wey: 0 }; }

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
    var goal = { ex: 0, ey: 0 };   // the pointer's goal (mouse mode; a reflected angle)
    var geom = { k: 844 / FACE_DEG, R: 54, lcx: 0, lcy: 0 }; // px per degree, the dome radius, the LCD's centre offset
    var mode = 'none';             // 'tilt' | 'pointer' | 'none'
    var lastSampleAt = -Infinity, lastTiltAt = -Infinity;
    var samples = 0, writes = 0;
    var sessionSamples = 0;        // samples since the last start() (the lit gate below; the first sample snaps)
    var note = '', permission = '';
    var observer = null;           // the dock watcher (see start): the panel emptied or hidden with no destroy()
    var destroyed = false;         // destroy() ran: nothing may re-bind (a late permission answer, gate r1 S2)

    function strength() { return readStrength(store); }
    function gain() { return GAIN[strength()] || 0; }
    function reduced() { try { return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; } }
    function finePointer() { try { return !!(win.matchMedia && win.matchMedia('(pointer: fine)').matches); } catch (_) { return false; } }
    function painted() { return !!(panel && !panel.hidden && panel.firstChild && panel.isConnected); }
    function permissionApi() { try { var D = win.DeviceOrientationEvent; return !!(D && typeof D.requestPermission === 'function'); } catch (_) { return false; } }
    // Gate r2 (qa W4, + the adversary's r1 S4): where the sensor sits behind a permission API AND no
    // mouse can drive the light (an iPhone), the lit class waits for the FIRST sample of this start -
    // a relaunch after a remembered deny, or after a grant iOS did not keep, must never show a
    // lit-but-still band. A desktop or Android streams or has a mouse: lit at once.
    function litGated() { return permissionApi() && !finePointer(); }
    function applyLit() {
      var lit = !litGated() || sessionSamples > 0;
      try {
        panel.classList.toggle('mms-lit', lit);
        panel.classList.toggle('mms-lit-strong', lit && strength() === 'pronounced'); // the realism profile
      } catch (_) { /* detached */ }
    }
    function trayUp() { try { return !!(doc.body && doc.body.classList.contains('mms-tray')); } catch (_) { return false; } }
    // The one question every arm asks: should the light be live on this surface right now?
    function wanted() {
      var ok = false;
      // gate r1 (adversary W3): after an iOS DENY nothing can drive the light on a device with no mouse
      // - the look must stay today's (no lit band), not a lit panel waiting for samples that never come.
      try { ok = !destroyed && gain() > 0 && !!isPocket() && painted() && !doc.hidden && !trayUp() && !reduced() && (permission !== 'denied' || finePointer()); } catch (_) { ok = false; }
      return ok;
    }
    var PROPS = ['--fx', '--fy', '--dx', '--dy', '--dom', '--la', '--wt', '--lx', '--ly', '--k', '--dr', '--lcx', '--lcy', '--lk'];
    function setP(name, v) { try { panel.style.setProperty(name, v); } catch (_) { /* detached */ } }
    function write() {
      st.wex = st.ex; st.wey = st.ey; writes += 1;
      var sf = surfaces(st.ex, st.ey, geom.k, geom.R);
      setP('--fx', sf.fx.toFixed(1) + 'px'); setP('--fy', sf.fy.toFixed(1) + 'px');
      setP('--dx', sf.dx.toFixed(2) + 'px'); setP('--dy', sf.dy.toFixed(2) + 'px');
      setP('--dom', sf.dom.toFixed(3)); setP('--la', sf.la.toFixed(1)); setP('--wt', sf.wt.toFixed(3));
      setP('--lx', sf.lx.toFixed(3)); setP('--ly', sf.ly.toFixed(3));
    }
    // The geometry the CSS needs, measured at every sync (a paint) and on every resize of the window
    // (gate r1 qa W1: the pop-out can be resized and a rotate changes the panel; nothing repaints then):
    // px per degree, the dome's radius, and where the LCD's centre sits against the panel's (so the glass
    // shows the SAME map at the same panel position - the research's "keep surfaces aligned").
    function measure() {
      try {
        var pr = panel.getBoundingClientRect();
        if (pr.height > 0) geom.k = pr.height / FACE_DEG;
        var dome = panel.querySelector('.ip-center');
        if (dome) { var dr = dome.getBoundingClientRect(); if (dr.width > 0) geom.R = dr.width / 2; }
        var lcd = panel.querySelector('.ip-lcd-in');
        if (lcd && pr.width > 0) { var lr = lcd.getBoundingClientRect(); geom.lcx = (pr.left + pr.width / 2) - (lr.left + lr.width / 2); geom.lcy = (pr.top + pr.height / 2) - (lr.top + lr.height / 2); }
      } catch (_) { /* jsdom: keep the defaults */ }
      setP('--k', geom.k.toFixed(2) + 'px'); setP('--dr', geom.R.toFixed(1) + 'px');
      setP('--lcx', geom.lcx.toFixed(1) + 'px'); setP('--lcy', geom.lcy.toFixed(1) + 'px');
      setP('--lk', String(gain()));
    }
    function clearProps() {
      try { for (var i = 0; i < PROPS.length; i++) panel.style.removeProperty(PROPS[i]); } catch (_) { /* detached */ }
      try { panel.classList.remove('mms-lit'); panel.classList.remove('mms-lit-strong'); } catch (_) { /* detached */ }
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
      var target, gliding = false;
      if (mode === 'tilt' && tilt) { gliding = glideKey(st, tilt.y, dt, now); target = reflected(st, tilt.x, tilt.y); }
      else target = goal;
      var moved = ease(st, target.ex, target.ey, dt, mode === 'pointer' ? TAU_MOUSE_MS : TAU_MS);
      if (moved) write();
      var settled = !gliding && Math.abs(st.ex - target.ex) < WRITE_EPS_DEG && Math.abs(st.ey - target.ey) < WRITE_EPS_DEG;
      // park when the light has settled and no sample has arrived for a while (nothing to animate);
      // the next sample re-arms the loop. (A live sensor streams samples, so it never parks mid-use.)
      if (settled && now - lastSampleAt > PARK_MS) { lastTick = -1; return; }
      arm();
    }
    function onOrient(e) {
      var m = mapTilt(e && e.beta, e && e.gamma, orientationAngle(win));
      if (!m) return;
      samples += 1; sessionSamples += 1;
      tilt = m; mode = 'tilt';
      if (sessionSamples === 1) {
        // the FIRST sample of a start snaps the reflection to where it is (gate r1 qa W3: easing from the
        // key-centred map swept the window across the face at every unlock, return or pick), then lights
        var r0 = reflected(st, m.x, m.y); st.ex = r0.ex; st.ey = r0.ey; write();
        applyLit();
      }
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
      goal = p; mode = 'pointer';
      lastSampleAt = nowFn();
      arm();
    }
    function onLeave(e) {
      if (!mouseOnly(e) || mode !== 'pointer') return;
      goal = { ex: 0, ey: 0 };
      lastSampleAt = nowFn();
      arm();
    }
    function onVisibility() { sync(); }
    function onResize() { if (!on) return; measure(); write(); }
    function start() {
      if (on) return;
      on = true;
      st = newFilter(); tilt = null; goal = { ex: 0, ey: 0 }; mode = 'none'; lastTick = -1; sessionSamples = 0;
      lastSampleAt = lastTiltAt = -Infinity;
      try { win.addEventListener('deviceorientation', onOrient); win.addEventListener('resize', onResize); } catch (_) { /* no window */ }
      try { panel.addEventListener('pointermove', onMove); panel.addEventListener('pointerleave', onLeave); } catch (_) { /* detached */ }
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
      try { win.removeEventListener('deviceorientation', onOrient); win.removeEventListener('resize', onResize); } catch (_) { /* ignore */ }
      try { panel.removeEventListener('pointermove', onMove); panel.removeEventListener('pointerleave', onLeave); } catch (_) { /* ignore */ }
    }
    // Gate r1 (adversary W1): the visibility listener is NOT one of start()'s - it lives from
    // create() to destroy(), because the RETURN from a hidden tab (an iPhone unlock, an app switch)
    // is what re-lights the panel, and nothing else in the app repaints on return.
    try { doc.addEventListener('visibilitychange', onVisibility); } catch (_) { /* detached fixture */ }
    function destroy() {
      destroyed = true;
      stop();
      try { doc.removeEventListener('visibilitychange', onVisibility); } catch (_) { /* ignore */ }
    }
    // Called by the engine after every paint (paint rebuilds the panel's className, so the lit
    // class is re-applied here), on visibility changes, and after a strength choice.
    function sync() {
      if (!wanted()) { stop(); return; }
      start();
      measure();
      write(); // the map exists at its centred pose from the first paint (a pose AT the key moves nothing)
      applyLit();
    }
    // Settings > Lighting (G4): store the pick, and - from the TAP that chose it, so the user
    // activation is live - ask iOS for motion access. Resolves with state() once the answer is in.
    function choose(v) {
      var n = setStrength(v, store);
      note = ''; permission = ''; // a re-pick starts clean: a stale note or answer never survives it (gate r1 J15)
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
            if (destroyed) return state(); // gate r1 S2: a late answer after destroy() re-binds nothing
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
        try { t = win.setTimeout(function () { if (!destroyed && on && samples === 0) note = NOTE_NO_SENSOR; resolve(state()); }, SENSOR_WAIT_MS); } catch (_) { t = null; }
        if (t == null) resolve(state());
      });
    }
    function state() {
      var isLit = false; try { isLit = panel.classList.contains('mms-lit'); } catch (_) { isLit = false; }
      return { on: on, listening: on, lit: isLit, raf: raf != null, samples: samples, writes: writes, ex: st.ex, ey: st.ey, key: { x: st.kx, y: st.ky },
        geom: { k: geom.k, R: geom.R, lcx: geom.lcx, lcy: geom.lcy }, mode: mode, strength: strength(), gain: gain(), note: note, permission: permission };
    }
    return { sync: sync, choose: choose, state: state, destroy: destroy };
  }

  var api = {
    KEY: KEY, STRENGTHS: STRENGTHS, GAIN: GAIN, KEY_X: KEY_X, KEY_Y: KEY_Y, FACE_DEG: FACE_DEG, DOME_BETA: DOME_BETA, MOUSE_DEG: MOUSE_DEG,
    TAU_MS: TAU_MS, TAU_MOUSE_MS: TAU_MOUSE_MS, OFF_DEG: OFF_DEG, OFF_MS: OFF_MS, GLIDE_TAU_MS: GLIDE_TAU_MS, PARK_MS: PARK_MS, SENSOR_WAIT_MS: SENSOR_WAIT_MS,
    NOTE_DENIED: NOTE_DENIED, NOTE_NO_SENSOR: NOTE_NO_SENSOR, NOTE_REDUCED: NOTE_REDUCED,
    normalizeStrength: normalizeStrength, readStrength: readStrength, setStrength: setStrength,
    mapTilt: mapTilt, orientationAngle: orientationAngle, reflected: reflected, glideKey: glideKey, ease: ease, surfaces: surfaces, pointerLight: pointerLight, newFilter: newFilter, wrapDiff: wrapDiff,
    create: create,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FileTubePocketLighting = api;
})();
