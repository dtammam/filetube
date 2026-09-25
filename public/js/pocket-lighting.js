'use strict';

// POCKET LIGHTING (Dean 2026-09-24: "Does PWA have any access to gyroscopic info ... I'd like the
// color/shadow on the theme to reflect. The sheen from the click wheel etc. I'd like that to be
// somewhat 'realistic' based on gyro data.") - a fixed light in the room, read through the phone's
// orientation sensor (or the mouse on a desktop), written as TWO CSS custom properties on the
// skin panel (`--lx`, `--ly`, each in [-1, 1]: where the light sits relative to the device). The
// Click skins' CSS moves every highlight toward the light and every shadow away from it; with the
// properties unset the calcs resolve to today's constants, so Off is byte-for-byte today's look.
//
// Scope (Dean's ruling, plan 2026-09-24-pocket-gyro-lighting): the Click family only (every Click
// colorway in the registry); the engine's `isPocket` is the registry's menus === 'click'. Strength Off / Subtle / Pronounced / Ambient is device-local (localStorage), default Off, chosen
// from the pocket menu's Settings > Lighting or the sticker menu's Lighting chips (v1.333). What asks iOS for motion access, once per
// launch: the strength tap, the tap that OPENS the Click player (askForOpen, v1.334) or, failing both, the first tap on the painted player.
//
// The HARD constraint (the old ambient mode blacked out video on iPhone): the driver only ever
// writes two numbers (and --lm); the CSS it feeds moves gradient positions and translates gradient
// layers - no filter, blur, mask or backdrop, ever. (v1.334: the sticker's gloss and shade are
// canvases painted from the sticker's own pixels - paintSticker, below - never a filter or mask.) The frame loop runs only while a Click
// skin is painted, visible and lit, writes only when a value moved, and parks itself when the light
// has settled; every teardown arm (skin switch, dock, hidden tab, pop-out close, reduced motion)
// unbinds the listener and cancels the loop. The pure half (mapping, filter, strength) is
// dual-exported so it unit-tests via require without jsdom (the wheel-config.js pattern).
(function () {
  var KEY = 'ft-pocket-lighting';
  var STRENGTHS = ['off', 'subtle', 'pronounced', 'ambient'];
  // Second swing (Dean on the device, v1.327.0: "a little subtle ... zhuzh it up ... subtle can stay near
  // pronounced and pronounced will be the new one"): Subtle = v1.327's Pronounced travel (within 10%),
  // Pronounced = the same travel plus the STRONG CSS profile (`.mms-lit-strong`: the specular hot spot,
  // the rim arcs, the brighter band, the double glass streak); a wrist tilt of 20 deg reaches the edge.
  // Ambient (v1.333, Dean: "a copy of the pronounced, but ... the gradient, the texture ... more realistic"):
  // Pronounced's travel and classes plus `.mms-lit-ambient`, which swaps ONLY the body's reflection layers
  // (a satin sheen tinted by the colorway, and a fine grain) - the mechanics here are unchanged.
  var GAIN = { off: 0, subtle: 0.8, pronounced: 1, ambient: 1 };
  var TILT_RANGE_DEG = 20;    // this much tilt from the neutral pose = the light at the edge (|l| = 1)
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
  // The neutral pose (G5): the FIRST sample after a start is neutral; from then on the baseline
  // drifts toward the live sample with RECENTER_TAU_MS, so a held tilt slowly reads as level again.
  // Returns the light's GOAL for this sample (opposite the tilt, TILT_RANGE_DEG = the edge).
  function recentre(st, tx, ty, dt) {
    if (!st.seeded) { st.bx = tx; st.by = ty; st.seeded = true; }
    else { var kb = k(dt, RECENTER_TAU_MS); st.bx = fold(st.bx + wrapDiff(tx, st.bx) * kb); st.by = fold(st.by + wrapDiff(ty, st.by) * kb); }
    // (`|| 0` folds a -0 to 0: a neutral pose is exactly 0)
    return { x: clamp1(TILT_SIGN * wrapDiff(tx, st.bx) / TILT_RANGE_DEG) || 0, y: clamp1(TILT_SIGN * wrapDiff(ty, st.by) / TILT_RANGE_DEG) || 0 };
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

  // The window questions every ask needs (the driver asks them of its own window; askForOpen of the tab's).
  function reducedOf(win) { try { return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; } }
  function finePointerOf(win) { try { return !!(win.matchMedia && win.matchMedia('(pointer: fine)').matches); } catch (_) { return false; } }
  function permissionApiOf(win) { try { var D = win.DeviceOrientationEvent; return !!(D && typeof D.requestPermission === 'function'); } catch (_) { return false; } }

  // ---- the SESSION: one per window (v1.334) --------------------------------------------------
  // iOS forgets a home-screen app's motion grant at every launch, and a page load IS a launch - so the
  // ask is once per WINDOW, not once per driver: a view swap builds a new driver, and the ask that
  // opened the player (askForOpen, below) runs before any driver exists. Every driver in the window
  // reads this: `asked` (an ask ran, or is pending, this session), `permission` (its answer: '' |
  // 'granted' | 'denied'), `drivers` (the live ones an answer flows to).
  var SESSIONS = (typeof WeakMap === 'function') ? new WeakMap() : null;
  function sessionOf(win) {
    var s = null;
    try { s = SESSIONS ? SESSIONS.get(win) : null; } catch (_) { s = null; }
    if (!s) {
      s = { asked: false, permission: '', drivers: [] };
      try { if (SESSIONS) SESSIONS.set(win, s); } catch (_) { /* a window WeakMap refuses: this ask stands alone */ }
    }
    return s;
  }
  // Ask iOS from inside a gesture (the caller's job) and let the answer flow to every live driver, as a
  // Settings > Lighting pick's does: a grant waits for its first sample to light, a deny shows the note.
  // A REJECT is not an answer: WebKit rejects with NotAllowedError when no gesture is live and the
  // state is still "prompt" (DeviceOrientationEvent::requestPermission) - nobody was asked, so the
  // session is un-asked and the first-tap ask re-arms (the v1.330 adversary's S: a reject used to read
  // as a deny the user never made).
  function askSession(win, s) {
    s.asked = true;
    var DOE = null; try { DOE = win.DeviceOrientationEvent; } catch (_) { DOE = null; }
    var p; try { p = DOE.requestPermission(); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function (r) {
      s.permission = r === 'granted' ? 'granted' : 'denied';
      s.drivers.slice().forEach(function (d) { d.answer(s.permission); });
    }, function () {
      s.asked = false;
      s.drivers.slice().forEach(function (d) { d.rearm(); });
    });
  }
  // Dean (2026-09-25): "Is it possible to just have it pop for that prompt on opening up the media player
  // in that skin in general without requiring the sticker button?" The first-tap ask (below) arms only
  // once the Click panel is painted - after the async open (an album fetch, the router's view fetch) -
  // so the tap that OPENED the player never asked and the next tap (the sticker) did. WebKit prompts only
  // while a gesture token is live (DeviceOrientationAndMotionAccessController::shouldAllowAccess), which
  // never survives a fetch - so the seams every open passes through SYNCHRONOUSLY call this from inside
  // the opening tap: the router's navigate() into the player (common.js) and the views' play seams
  // (music.js, podcasts.js). It asks only when that open will show a Click skin that would light: a
  // strength stored, a Click colorway active for this viewport (never the tray), the permission API, no
  // fine pointer, no reduced motion, no ask or answer yet this session, and - where the browser says - a
  // live user activation (a notification's cold ?play= has none; a reject would re-arm anyway).
  function clickSkinAhead(win) {
    try { if (win.document && win.document.body && win.document.body.classList.contains('mms-tray')) return false; } catch (_) { return false; }
    var S = null; try { S = win.FileTubeMusicSkins || null; } catch (_) { S = null; }
    try { return !!(S && S.skinActiveFor({ isMusic: true }) && S.menuStyle(S.activeSkinId()) === 'click'); } catch (_) { return false; }
  }
  function askForOpen(win, store) {
    var w = win || (typeof window !== 'undefined' ? window : null);
    if (!w) return false;
    var s = sessionOf(w);
    if (s.asked || s.permission) return false;
    var ls = store || null; if (!ls) { try { ls = w.localStorage; } catch (_) { ls = null; } }
    if (!(GAIN[readStrength(ls)] > 0)) return false;
    if (!permissionApiOf(w) || finePointerOf(w) || reducedOf(w)) return false;
    if (!clickSkinAhead(w)) return false;
    var ua = null; try { ua = w.navigator ? w.navigator.userActivation : null; } catch (_) { ua = null; }
    if (ua && ua.isActive === false) return false;
    askSession(w, s);
    return true;
  }

  // ---- v1.334 THE STICKER CATCHES THE LIGHT (Dean 2026-09-25: "It should have like sheen on it ... as if
  // it's literally a sticker, like lightly raised. The shadow would hit it ... I don't want us to go crazy on
  // the lighting effects, but like it should hit it"; plan 2026-09-25-pocket-open-ask-sticker-light, item 2).
  // The engine (skin-surface.js) hands over the sticker it painted, the light this driver last wrote (null =
  // unlit) and the strength. On a LIT Click panel the sticker gets a soft GLOSS toward the light and a small
  // drop shadow away from it (style.css, the .mms-lit sticker rules). A real sticker is die-cut, so both follow
  // its own SHAPE - the logo is a rounded triangle, a custom upload any PNG/JPEG/WebP - and the shape-true CSS
  // tools (drop-shadow, mask) are banned on anything lit (the HARD constraint above). So the shape comes from the
  // pixels, drawn on a canvas: an image sticker's shadow is baked ONCE per image (a soft dark silhouette the CSS
  // moves by transform), and the gloss is the silhouette filled with a soft highlight, redrawn only when the
  // light moves a visible step. The emoji chip is a circle: its shadow is a CSS box-shadow, its gloss this same
  // canvas with a circle for a silhouette. Unlit, the sticker carries nothing (Off byte-identical).
  var STK_TILT_SIN = 0.2419;   // sin(14deg): the tilt classes rotate the button +-14deg (style.css --mms-stk-s)
  var STK_TILT_COS = 0.9703;   // cos(14deg)
  var STK_GLOSS_STEP = 0.02;   // redraw the gloss only when the light moved this much
  var STK_GLOSS_TRAVEL = 0.32; // the gloss centre's travel toward the light (a fraction of the sticker)
  var STK_GLOSS_LIFT = 0.2;    // its neutral seat: this far ABOVE the centre on the screen (a room light from above)
  var STK_GLOSS_RADIUS = 0.58; // the soft highlight's radius (a fraction of the sticker)
  var STK_GLOSS_ALPHA = { subtle: 0.3, strong: 0.5 }; // Subtle's gloss is fainter (plan B1)
  var STK_SHADE_PAD = 0.12;    // the baked shadow's blur margin per side (style.css --pk-stk-shade-inset: -12%)
  var STK_SHADE_BLUR = 0.1;    // the shadow's softness (a fraction of the sticker)
  var STK_SHADE_ALPHA = 0.3;   // = style.css --mms-lit-stk-drop (the chip's CSS shadow)
  var STK_DRAWN = (typeof WeakMap === 'function') ? new WeakMap() : null; // per sticker button: what is drawn on it
  function stkContain(nw, nh, w, h) {
    if (!(nw > 0) || !(nh > 0)) return { x: 0, y: 0, w: w, h: h };
    var k = Math.min(w / nw, h / nh);
    return { x: (w - nw * k) / 2, y: (h - nh * k) / 2, w: nw * k, h: nh * k }; // object-fit: contain
  }
  function stkCanvas(doc, cls) {
    var c = doc.createElement('canvas');
    var ctx = null;
    try { ctx = c.getContext ? c.getContext('2d') : null; } catch (_) { ctx = null; }
    if (!ctx) return null;
    c.className = cls;
    c.setAttribute('aria-hidden', 'true');
    return c;
  }
  // the silhouette: the image (drawn as object-fit: contain draws it) or, for the emoji chip, its circle
  function stkSilhouette(ctx, img, w, h, dpr, ox, oy) {
    if (img) { var r = stkContain(img.naturalWidth, img.naturalHeight, w, h); ctx.drawImage(img, ox + r.x * dpr, oy + r.y * dpr, r.w * dpr, r.h * dpr); return; }
    ctx.beginPath(); ctx.arc(ox + w * dpr / 2, oy + h * dpr / 2, Math.min(w, h) * dpr / 2, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
  }
  function stkBakeShade(cv, img, w, h, dpr) {
    var pad = STK_SHADE_PAD * w;
    cv.width = Math.round((w + 2 * pad) * dpr); cv.height = Math.round((h + 2 * pad) * dpr);
    var ctx = cv.getContext('2d');
    var off = cv.width + 16; // draw the image OFF the canvas; only its shadow lands on it
    ctx.shadowColor = 'rgba(0,0,0,' + STK_SHADE_ALPHA + ')';
    ctx.shadowBlur = STK_SHADE_BLUR * w * dpr;
    ctx.shadowOffsetX = off; ctx.shadowOffsetY = 0;
    stkSilhouette(ctx, img, w, h, dpr, pad * dpr - off, pad * dpr);
  }
  function stkDrawGloss(cv, img, w, h, dpr, sin, strong, light) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); // (a resize clears it)
    var ctx = cv.getContext('2d');
    stkSilhouette(ctx, img, w, h, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-in'; // the highlight lands only inside the sticker's own pixels
    var cos = sin ? STK_TILT_COS : 1;
    // the light (and the neutral seat above centre) counter-rotated into the tilted button's frame
    var l1 = light.x * cos + light.y * sin, l2 = light.y * cos - light.x * sin;
    var cx = (0.5 + l1 * STK_GLOSS_TRAVEL - STK_GLOSS_LIFT * sin) * cv.width;
    var cy = (0.5 + l2 * STK_GLOSS_TRAVEL - STK_GLOSS_LIFT * cos) * cv.height;
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, STK_GLOSS_RADIUS * Math.max(cv.width, cv.height));
    g.addColorStop(0, 'rgba(255,255,255,' + (strong ? STK_GLOSS_ALPHA.strong : STK_GLOSS_ALPHA.subtle) + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.globalCompositeOperation = 'source-over';
  }
  // btn = the sticker button; light = {x, y} or null (unlit); o = { strong, win, doc }
  function paintSticker(btn, light, o) {
    if (!btn) return;
    o = o || {};
    var doc = o.doc || btn.ownerDocument;
    var win = o.win || (doc && doc.defaultView) || null;
    var shade = btn.querySelector('.mms-sticker-shade');
    var gloss = btn.querySelector('.mms-sticker-gloss');
    var drawn = (STK_DRAWN && STK_DRAWN.get(btn)) || null;
    if (!light) {
      if (shade) shade.parentNode.removeChild(shade);
      if (gloss) gloss.parentNode.removeChild(gloss);
      if (STK_DRAWN) STK_DRAWN.delete(btn);
      return;
    }
    var isImg = btn.classList.contains('mms-sticker--img');
    var img = isImg ? btn.querySelector('img.mms-sticker-ic') : null;
    var w = btn.clientWidth, h = btn.clientHeight;
    if (!(w > 0) || !(h > 0) || (isImg && !img)) return; // no layout yet (a hidden panel, a test realm)
    if (img && !(img.complete && img.naturalWidth > 0)) {
      if (!img.getAttribute('data-stk-wait')) {
        img.setAttribute('data-stk-wait', '1');
        img.addEventListener('load', function () { var d = STK_DRAWN && STK_DRAWN.get(btn); paintSticker(btn, (d && d.want) || light, o); }, { once: true });
      }
      if (STK_DRAWN) STK_DRAWN.set(btn, { key: '', x: NaN, y: NaN, strong: null, want: light });
      return;
    }
    var dpr = Math.min(3, Math.max(1, Number(win && win.devicePixelRatio) || 1));
    if (isImg && !shade) { shade = stkCanvas(doc, 'mms-sticker-shade'); if (!shade) return; btn.insertBefore(shade, btn.firstChild); }
    if (!gloss) { gloss = stkCanvas(doc, 'mms-sticker-gloss'); if (!gloss) return; btn.appendChild(gloss); }
    var sin = btn.classList.contains('mms-sticker-tilt-left') ? -STK_TILT_SIN : (btn.classList.contains('mms-sticker-tilt-right') ? STK_TILT_SIN : 0);
    var key = (img ? (img.currentSrc || img.src) : 'emoji') + '|' + w + 'x' + h + '@' + dpr + '|' + sin;
    var strong = !!o.strong;
    if (!drawn || drawn.key !== key) { if (shade) stkBakeShade(shade, img, w, h, dpr); drawn = { key: key, x: NaN, y: NaN, strong: null }; }
    if (!(Math.abs(light.x - drawn.x) < STK_GLOSS_STEP && Math.abs(light.y - drawn.y) < STK_GLOSS_STEP) || strong !== drawn.strong) {
      stkDrawGloss(gloss, img, w, h, dpr, sin, strong, light);
      drawn.x = light.x; drawn.y = light.y; drawn.strong = strong;
    }
    drawn.want = light;
    if (STK_DRAWN) STK_DRAWN.set(btn, drawn);
  }

  // ---- the driver: one per engine surface -------------------------------------------------
  // o = { panel, win, doc?, isPocket() -> bool, store?, now?() }
  function create(o) {
    var panel = o.panel;
    var win = o.win || (panel.ownerDocument && panel.ownerDocument.defaultView) || window;
    var doc = o.doc || panel.ownerDocument || document;
    var isPocket = typeof o.isPocket === 'function' ? o.isPocket : function () { return false; };
    var store = o.store || null;
    // v1.334: the engine's sticker listens to every light it writes and every clear (it paints the sticker's
    // gloss from the sticker's own shape on a canvas; null = unlit). Optional: the light itself never waits on it.
    var onLight = typeof o.onLight === 'function' ? o.onLight : null;
    function tellLight(on) { if (!onLight) return; try { if (on) onLight(st.x, st.y); else onLight(null, null); } catch (_) { /* the sticker is best-effort */ } }
    var nowFn = typeof o.now === 'function' ? o.now : function () { try { return win.performance.now(); } catch (_) { return Date.now(); } };
    var on = false, raf = null, lastTick = -1;
    var st = newFilter();
    var tilt = null;               // the latest sensor sample (screen axes, degrees)
    var goal = { x: 0, y: 0 };     // the pointer's goal (mouse mode)
    var mode = 'none';             // 'tilt' | 'pointer' | 'none'
    var leaving = false;           // the mouse left: ease home slowly
    var lastSampleAt = -Infinity, lastTiltAt = -Infinity;
    var samples = 0, writes = 0;
    var sessionSamples = 0;        // samples since the last start() (the lit gate below)
    var note = '', permission = '';
    var observer = null;           // the dock watcher (see start): the panel emptied or hidden with no destroy()
    var askArmed = false;          // the first-tap ask is bound (see armFirstTapAsk)
    var sess = sessionOf(win);     // v1.334: the window's session - ask ONCE per launch, whichever seam asks
    var destroyed = false;         // destroy() ran: nothing may re-bind (a late permission answer, gate r1 S2)

    function strength() { return readStrength(store); }
    function gain() { return GAIN[strength()] || 0; }
    function reduced() { return reducedOf(win); }
    function finePointer() { return finePointerOf(win); }
    function painted() { return !!(panel && !panel.hidden && panel.firstChild && panel.isConnected); }
    function permissionApi() { return permissionApiOf(win); }
    // Gate r2 (qa W4, + the adversary's r1 S4): where the sensor sits behind a permission API AND no
    // mouse can drive the light (an iPhone), the lit class waits for the FIRST sample of this start -
    // a relaunch after a remembered deny, or after a grant iOS did not keep, must never show a
    // lit-but-still band. A desktop or Android streams or has a mouse: lit at once.
    function litGated() { return permissionApi() && !finePointer(); }
    function applyLit() {
      var lit = !litGated() || sessionSamples > 0;
      var s = strength();
      try {
        panel.classList.toggle('mms-lit', lit);
        panel.classList.toggle('mms-lit-strong', lit && (s === 'pronounced' || s === 'ambient')); // the realism profile
        panel.classList.toggle('mms-lit-ambient', lit && s === 'ambient'); // v1.333: the satin body reflection over it
      } catch (_) { /* detached */ }
      tellLight(lit); // v1.334: the sticker lights (or clears) with the panel, and follows a strength change
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
    function write() {
      st.wx = st.x; st.wy = st.y; writes += 1;
      // --lm = the light's distance from centre (0..1): the strong profile's hot spot dims as the
      // light moves off-centre (the card-glare rule: brightest straight on)
      try { panel.style.setProperty('--lx', st.x.toFixed(3)); panel.style.setProperty('--ly', st.y.toFixed(3)); panel.style.setProperty('--lm', Math.min(1, Math.hypot(st.x, st.y)).toFixed(3)); } catch (_) { /* detached */ }
      tellLight(true);
    }
    function clearProps() {
      try { panel.style.removeProperty('--lx'); panel.style.removeProperty('--ly'); panel.style.removeProperty('--lm'); } catch (_) { /* detached */ }
      try { panel.classList.remove('mms-lit'); panel.classList.remove('mms-lit-strong'); panel.classList.remove('mms-lit-ambient'); } catch (_) { /* detached */ }
      tellLight(false);
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
      samples += 1; sessionSamples += 1;
      if (permission !== 'granted') { permission = 'granted'; sess.permission = 'granted'; disarmFirstTapAsk(); } // a sample IS a grant (the session's too)
      if (sessionSamples === 1) applyLit(); // the sensor streams: light the panel (see litGated)
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
    // Dean (2026-09-25, on the installed app): "every time I close and reopen, I'm prompted ... How can it
    // just be on?" iOS does not persist a home-screen web app's motion grant across launches, and only a
    // user gesture may ask - so with a strength stored and no grant this session, the FIRST tap anywhere
    // in the app (a click or a touch lifting) asks from inside that gesture; the Lighting row is no longer
    // the only place that asks. Once per session; the answer flows exactly as a Lighting-row pick does.
    function askFromGesture() {
      disarmFirstTapAsk();
      if (destroyed || sess.asked || !permissionApi() || permission === 'granted' || sess.permission === 'granted') return;
      askSession(win, sess); // the answer flows back through answer() / rearm() below
    }
    function armFirstTapAsk() {
      if (askArmed || sess.asked || destroyed) return;
      if (gain() <= 0 || !litGated() || permission === 'granted' || sess.permission === 'granted') return;
      askArmed = true;
      try { doc.addEventListener('click', askFromGesture, true); doc.addEventListener('touchend', askFromGesture, true); } catch (_) { askArmed = false; }
    }
    function disarmFirstTapAsk() {
      if (!askArmed) return;
      askArmed = false;
      try { doc.removeEventListener('click', askFromGesture, true); doc.removeEventListener('touchend', askFromGesture, true); } catch (_) { /* ignore */ }
    }
    function start() {
      if (on) return;
      on = true;
      st = newFilter(); tilt = null; goal = { x: 0, y: 0 }; mode = 'none'; leaving = false; lastTick = -1; sessionSamples = 0;
      lastSampleAt = lastTiltAt = -Infinity;
      try { win.addEventListener('deviceorientation', onOrient); } catch (_) { /* no window */ }
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
      disarmFirstTapAsk();
      clearProps();
      if (!on) return;
      on = false;
      if (observer) { try { observer.disconnect(); } catch (_) { /* gone */ } observer = null; }
      try { win.removeEventListener('deviceorientation', onOrient); } catch (_) { /* ignore */ }
      try { panel.removeEventListener('pointermove', onMove); panel.removeEventListener('pointerleave', onLeave); } catch (_) { /* ignore */ }
    }
    // Gate r1 (adversary W1): the visibility listener is NOT one of start()'s - it lives from
    // create() to destroy(), because the RETURN from a hidden tab (an iPhone unlock, an app switch)
    // is what re-lights the panel, and nothing else in the app repaints on return.
    try { doc.addEventListener('visibilitychange', onVisibility); } catch (_) { /* detached fixture */ }
    function destroy() {
      destroyed = true;
      var at = sess.drivers.indexOf(self); if (at >= 0) sess.drivers.splice(at, 1); // a late answer finds nothing to re-bind
      stop();
      try { doc.removeEventListener('visibilitychange', onVisibility); } catch (_) { /* ignore */ }
    }
    // Called by the engine after every paint (paint rebuilds the panel's className, so the lit
    // class is re-applied here), on visibility changes, and after a strength choice.
    function sync() {
      if (!wanted()) { stop(); return; }
      start();
      applyLit();
      armFirstTapAsk();
    }
    // Settings > Lighting (G4): store the pick, and - from the TAP that chose it, so the user
    // activation is live - ask iOS for motion access. Resolves with state() once the answer is in.
    function choose(v) {
      var n = setStrength(v, store);
      note = ''; permission = ''; sess.permission = ''; // a re-pick starts clean: a stale note or answer never survives it (gate r1 J15), the session's either
      sess.asked = true; disarmFirstTapAsk(); // the row asks itself (below); no second ask from a tap or an open this session
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
            sess.permission = permission; // an open-the-player ask never re-asks after a row pick's answer
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
      return { on: on, listening: on, lit: isLit, raf: raf != null, samples: samples, writes: writes, lx: st.x, ly: st.y, mode: mode, askArmed: askArmed, asked: sess.asked,
        strength: strength(), gain: gain(), note: note, permission: permission };
    }
    // The session's answer (any seam's ask) arrives here exactly as a Settings > Lighting pick's does.
    function answer(perm) {
      if (destroyed) return;
      permission = perm;
      if (perm !== 'granted') note = NOTE_DENIED;
      sync();
    }
    // A rejected ask (no gesture): the session is un-asked, so the first-tap ask arms again.
    function rearm() { if (!destroyed) sync(); }
    // A driver born after the session's answer (a view swap, the open-the-player ask) starts from it.
    if (sess.permission) { permission = sess.permission; if (permission !== 'granted') note = NOTE_DENIED; }
    var self = { sync: sync, choose: choose, state: state, destroy: destroy, answer: answer, rearm: rearm };
    sess.drivers.push(self);
    return self;
  }

  var api = {
    KEY: KEY, STRENGTHS: STRENGTHS, GAIN: GAIN, TILT_RANGE_DEG: TILT_RANGE_DEG, TILT_SIGN: TILT_SIGN,
    SMOOTH_TAU_MS: SMOOTH_TAU_MS, RECENTER_TAU_MS: RECENTER_TAU_MS, WRITE_EPS: WRITE_EPS, PARK_MS: PARK_MS, SENSOR_WAIT_MS: SENSOR_WAIT_MS,
    NOTE_DENIED: NOTE_DENIED, NOTE_NO_SENSOR: NOTE_NO_SENSOR, NOTE_REDUCED: NOTE_REDUCED,
    normalizeStrength: normalizeStrength, readStrength: readStrength, setStrength: setStrength,
    mapTilt: mapTilt, orientationAngle: orientationAngle, recentre: recentre, ease: ease, pointerLight: pointerLight, newFilter: newFilter, wrapDiff: wrapDiff,
    create: create, askForOpen: askForOpen, paintSticker: paintSticker,
    STK_TILT_SIN: STK_TILT_SIN, STK_TILT_COS: STK_TILT_COS, STK_SHADE_PAD: STK_SHADE_PAD, STK_SHADE_ALPHA: STK_SHADE_ALPHA, STK_GLOSS_STEP: STK_GLOSS_STEP,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FileTubePocketLighting = api;
})();
