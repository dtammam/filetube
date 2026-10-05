'use strict';

// VR VIEW (Dean 2026-09-27: "Can we add support for vr enabled mp4s?"): a 360 or 180 video is one
// stretched panorama per frame (two, for 3D). This draws that frame AROUND the viewer instead - a
// WebGL canvas over the <video>, looking into the sphere - so a drag, a scroll/pinch or a tilt of the
// phone looks around the scene. The <video> element keeps playing underneath exactly as before
// (controls, seek, resume, fullscreen, audio untouched); the canvas only paints its pixels.
//
// One full-screen triangle and a fragment shader: each pixel's view ray -> longitude/latitude ->
// the panorama's u/v. No sphere mesh, so a 180 frame is just "black outside the front half" and a 3D
// frame is "sample the left eye's half". The projection values are lib/media/projection.js's.
//
// Look-around, all device-local and optional:
//   drag (mouse / one finger)  - yaw and pitch, the picture follows the finger
//   wheel / two-finger pinch   - zoom (field of view)
//   Motion (phone)             - the phone's orientation drives the view; a drag then only turns yaw.
//                                Uses the absolute orientation quaternion (never Euler pitch/roll
//                                differences - the gimbal class in docs/LESSONS.md section 7).
// The pure half (matrices, quaternions, uniforms per projection) is dual-exported so it unit-tests
// via require without jsdom (the wheel-config.js / pocket-lighting.js pattern).
(function () {
  var DEG = Math.PI / 180;
  var FOV_DEFAULT_DEG = 75;   // vertical field of view on open
  var FOV_MIN_DEG = 30;       // zoomed in
  var FOV_MAX_DEG = 100;      // zoomed out (past ~100 the edges stretch badly)
  var PITCH_LIMIT_DEG = 89;   // never flip over the pole
  var WHEEL_FOV_PER_PX = 0.05; // degrees of fov per wheel deltaY pixel
  var MAX_TEXTURE_FALLBACK = 4096; // assumed when the GL cannot say
  var TAP_SLOP_PX = 4; // a press that moves less than this is a tap, not a look

  var PROJECTIONS = ['360', '360-tb', '360-sbs', '180', '180-sbs', '180-tb'];
  function isProjection(v) { return PROJECTIONS.indexOf(v) >= 0; }

  // Pure: shader uniforms for a projection. span = the fraction of the full circle the frame's width
  // covers (1 = 360, 0.5 = 180); eye = [uOffset, vOffset, uScale, vScale] picking the LEFT eye
  // (left half of a side-by-side frame, top half of a stacked one).
  function uniformsFor(projection) {
    var span = projection.indexOf('180') === 0 ? 0.5 : 1;
    var eye = [0, 0, 1, 1];
    if (/-sbs$/.test(projection)) eye = [0, 0, 0.5, 1];
    else if (/-tb$/.test(projection)) eye = [0, 0, 1, 0.5];
    return { span: span, eye: eye };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // Pure: a frame larger than the GPU's texture limit on either side is refused (never shrunk).
  function frameTooLarge(w, h, maxTex) { return w > maxTex || h > maxTex; }

  // Pure: yaw (about +y, positive looks LEFT) then pitch (about +x, positive looks UP) -> a 3x3
  // rotation, column-major (WebGL's uniformMatrix3fv order). The camera looks down -z.
  function yawPitchMatrix(yaw, pitch) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // R = Ry(yaw) * Rx(pitch)
    return [
      cy, 0, -sy,               // column 0
      sy * sp, cp, cy * sp,     // column 1
      sy * cp, -sp, cy * cp,    // column 2
    ];
  }

  // Pure: a unit quaternion [x, y, z, w] -> a 3x3 rotation, column-major.
  function quatMatrix(q) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    return [
      1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
    ];
  }
  function quatMul(a, b) {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
  }
  function quatAxis(ax, ay, az, angle) {
    var s = Math.sin(angle / 2);
    return [ax * s, ay * s, az * s, Math.cos(angle / 2)];
  }

  // Pure: a DeviceOrientationEvent (alpha, beta, gamma in degrees) and the screen's rotation
  // (degrees) -> the quaternion of a camera looking OUT OF THE BACK of the phone. The standard
  // W3C-frame construction (the one three.js's DeviceOrientationControls used): Euler YXZ of
  // (beta, alpha, -gamma), then -90 deg about x (the screen faces you, the camera faces away), then
  // the screen rotation about z.
  function deviceQuaternion(alpha, beta, gamma, screenDeg) {
    var a = (alpha || 0) * DEG, b = (beta || 0) * DEG, g = -(gamma || 0) * DEG;
    var c1 = Math.cos(b / 2), c2 = Math.cos(a / 2), c3 = Math.cos(g / 2);
    var s1 = Math.sin(b / 2), s2 = Math.sin(a / 2), s3 = Math.sin(g / 2);
    // Euler (x = beta, y = alpha, z = -gamma), order YXZ
    var q = [
      s1 * c2 * c3 + c1 * s2 * s3,
      c1 * s2 * c3 - s1 * c2 * s3,
      c1 * c2 * s3 - s1 * s2 * c3,
      c1 * c2 * c3 + s1 * s2 * s3,
    ];
    q = quatMul(q, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    q = quatMul(q, quatAxis(0, 0, 1, -(screenDeg || 0) * DEG));
    return q;
  }

  // Pure: the compass heading (yaw, radians, our convention) a rotation matrix looks toward.
  function headingOf(m) {
    // forward = M * (0, 0, -1) = -(column 2)
    var fx = -m[6], fz = -m[8];
    return Math.atan2(-fx, -fz);
  }

  // Pure: the view state after a drag of (dx, dy) CSS px on a canvas `height` px tall.
  function dragView(view, dx, dy, height, aspect) {
    var fovY = view.fovDeg * DEG;
    var fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect);
    var h = height > 0 ? height : 1;
    var w = h * aspect;
    return {
      yaw: view.yaw + dx * (fovX / w),
      pitch: clamp(view.pitch + dy * (fovY / h), -PITCH_LIMIT_DEG * DEG, PITCH_LIMIT_DEG * DEG),
      fovDeg: view.fovDeg,
    };
  }
  function zoomView(view, fovDeg) {
    return { yaw: view.yaw, pitch: view.pitch, fovDeg: clamp(fovDeg, FOV_MIN_DEG, FOV_MAX_DEG) };
  }

  var VERT = [
    'attribute vec2 aPos;',
    'varying vec2 vNdc;',
    'void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }',
  ].join('\n');
  var FRAG = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'uniform sampler2D uTex;',
    'uniform mat3 uRot;',
    'uniform vec2 uTan;',   // tan(fov/2) across x and y
    'uniform float uSpan;', // 1 = the frame covers 360 degrees of longitude, 0.5 = 180
    'uniform vec4 uEye;',   // the eye's [uOff, vOff, uScale, vScale] inside the frame
    'varying vec2 vNdc;',
    'void main() {',
    '  vec3 d = normalize(uRot * vec3(vNdc.x * uTan.x, vNdc.y * uTan.y, -1.0));',
    '  float lon = atan(d.x, -d.z);',
    '  float lat = asin(clamp(d.y, -1.0, 1.0));',
    '  float u = 0.5 + lon / (6.28318530718 * uSpan);',
    '  float v = 0.5 - lat / 3.14159265359;',
    '  if (u < 0.0 || u > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }',
    '  gl_FragColor = texture2D(uTex, vec2(uEye.x + u * uEye.z, uEye.y + v * uEye.w));',
    '}',
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('vr-view shader: ' + gl.getShaderInfoLog(s));
    return s;
  }

  // Mount a view over `video` inside `host` (the video's positioned container; the canvas goes right
  // after the video, under the controls). Returns a handle, or null when WebGL is unavailable (the
  // caller keeps the flat picture). `opts.onFail()` runs if the GL context is lost mid-view;
  // `opts.onTooLarge()` when a frame is larger than this GPU's MAX_TEXTURE_SIZE (v1.366.0: the
  // sphere is REFUSED, never shrunk through a 2D canvas: `drawImage(video)` is the v1.312 shape that
  // blacked out every iPhone video, so nothing here ever reads the video into a 2D canvas);
  // `opts.onTap()` for a tap that did not drag (the caller's play/pause).
  function mount(video, host, projection, opts) {
    opts = opts || {};
    if (!video || !host || !isProjection(projection)) return null;
    var canvas = document.createElement('canvas');
    canvas.className = 'vr-view-canvas';
    canvas.setAttribute('aria-label', '360 video view. Drag to look around.');
    var gl = null;
    try { gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false }); } catch (_) { gl = null; }
    if (!gl) return null;
    var prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('vr-view link: ' + gl.getProgramInfoLog(prog));
    } catch (e) {
      try { console.warn(e && e.message); } catch (_) { /* no console */ }
      return null;
    }
    gl.useProgram(prog);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    var loc = {
      rot: gl.getUniformLocation(prog, 'uRot'),
      tan: gl.getUniformLocation(prog, 'uTan'),
      span: gl.getUniformLocation(prog, 'uSpan'),
      eye: gl.getUniformLocation(prog, 'uEye'),
      tex: gl.getUniformLocation(prog, 'uTex'),
    };
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // NPOT video frames: WebGL1 needs CLAMP + no mipmaps.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(loc.tex, 0);
    var maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || MAX_TEXTURE_FALLBACK;

    var state = {
      projection: projection,
      view: { yaw: 0, pitch: 0, fovDeg: FOV_DEFAULT_DEG },
      gyro: null,          // { q: latest device quaternion, yawOffset }
      raf: 0,
      dirty: true,
      hasFrame: false,
      lastTime: -1,
      destroyed: false,
      tooLarge: false,
    };

    function uploadFrame() {
      if (video.readyState < 2) return false;
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return false;
      if (frameTooLarge(vw, vh, maxTex)) {
        // Refused, not shrunk (see mount's comment). Once: the caller unmounts and says why.
        if (!state.tooLarge) {
          state.tooLarge = true;
          if (typeof opts.onTooLarge === 'function') opts.onTooLarge();
        }
        return false;
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      state.hasFrame = true;
      return true;
    }

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; state.dirty = true; }
    }

    function rotation() {
      if (state.gyro && state.gyro.q) {
        return quatMatrix(quatMul(quatAxis(0, 1, 0, state.gyro.yawOffset), state.gyro.q));
      }
      return yawPitchMatrix(state.view.yaw, state.view.pitch);
    }

    function draw() {
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      var u = uniformsFor(state.projection);
      var aspect = canvas.width / canvas.height;
      var ty = Math.tan(state.view.fovDeg * DEG / 2);
      gl.uniformMatrix3fv(loc.rot, false, new Float32Array(rotation()));
      gl.uniform2f(loc.tan, ty * aspect, ty);
      gl.uniform1f(loc.span, u.span);
      gl.uniform4f(loc.eye, u.eye[0], u.eye[1], u.eye[2], u.eye[3]);
      if (state.hasFrame) gl.drawArrays(gl.TRIANGLES, 0, 3);
      else { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    }

    // The loop runs while the video plays, the motion sensor drives the view, or a draw is owed;
    // otherwise it parks (no rAF at all) until an event wakes it.
    function frame() {
      state.raf = 0;
      if (state.destroyed || state.tooLarge) return;
      var t = video.currentTime;
      if (!video.paused || !state.hasFrame || t !== state.lastTime) {
        if (uploadFrame()) { state.lastTime = t; state.dirty = true; }
      }
      if (state.dirty) { state.dirty = false; draw(); }
      if (!video.paused || state.gyro || !state.hasFrame) wake();
    }
    function wake() {
      if (!state.raf && !state.destroyed) state.raf = requestAnimationFrame(frame);
    }
    function invalidate() { state.dirty = true; wake(); }

    // ---- input: drag, wheel, pinch ----
    var pointers = {};
    var pinchStart = null;
    var dragMoved = false;
    function pointerCount() { return Object.keys(pointers).length; }
    function onDown(e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      dragMoved = false;
      if (pointerCount() === 2) {
        var p = pointsOf();
        pinchStart = { dist: dist(p[0], p[1]), fovDeg: state.view.fovDeg };
      }
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* capture unsupported */ }
    }
    function pointsOf() { return Object.keys(pointers).map(function (k) { return pointers[k]; }); }
    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    function onMove(e) {
      var p = pointers[e.pointerId];
      if (!p) return;
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pointerCount() >= 2 && pinchStart) {
        var pts = pointsOf();
        var d = dist(pts[0], pts[1]);
        if (d > 0 && pinchStart.dist > 0) state.view = zoomView(state.view, pinchStart.fovDeg * pinchStart.dist / d);
        dragMoved = true;
        invalidate();
        return;
      }
      if (Math.abs(dx) + Math.abs(dy) > TAP_SLOP_PX) dragMoved = true;
      var h = canvas.clientHeight || 1;
      var aspect = (canvas.clientWidth || 1) / h;
      if (state.gyro) state.gyro.yawOffset += dragView({ yaw: 0, pitch: 0, fovDeg: state.view.fovDeg }, dx, 0, h, aspect).yaw;
      else state.view = dragView(state.view, dx, dy, h, aspect);
      invalidate();
    }
    function onUp(e) {
      var wasOne = pointerCount() === 1;
      delete pointers[e.pointerId];
      if (pointerCount() < 2) pinchStart = null;
      // A one-finger press that never moved is a tap: the caller's play/pause (the picture's own tap
      // gesture lives on the <video>, which this canvas covers).
      if (e.type === 'pointerup' && wasOne && !dragMoved && typeof opts.onTap === 'function') opts.onTap();
    }
    function onClick(e) {
      // A drag is a look, not a tap: keep it from reaching the player's tap-to-pause.
      if (dragMoved) { e.stopPropagation(); e.preventDefault(); dragMoved = false; }
    }
    function onWheel(e) {
      e.preventDefault();
      state.view = zoomView(state.view, state.view.fovDeg + e.deltaY * WHEEL_FOV_PER_PX);
      invalidate();
    }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('click', onClick, true);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    // iOS raises its text loupe on a hold (LESSONS 8): cancel a one-finger touch on the canvas. Pointer
    // events still fire (the drag reads them); only the touch's own defaults (loupe, scroll) go.
    function onTouchStart(e) { if (e.touches && e.touches.length === 1 && e.cancelable) e.preventDefault(); }
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });

    // ---- the motion sensor (opt-in; iOS asks permission on the tap that enables it) ----
    function screenDeg() {
      try { if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle; } catch (_) { /* old WebKit */ }
      return typeof window.orientation === 'number' ? window.orientation : 0;
    }
    function onOrient(e) {
      if (!state.gyro || e.alpha == null) return;
      var q = deviceQuaternion(e.alpha, e.beta, e.gamma, screenDeg());
      if (!state.gyro.q) {
        // First sample: keep looking where the drag left the view (turn the world, not the picture).
        state.gyro.yawOffset = state.view.yaw - headingOf(quatMatrix(q));
      }
      state.gyro.q = q;
      invalidate();
    }
    function enableMotion() {
      if (state.gyro) return Promise.resolve(true);
      var DOE = window.DeviceOrientationEvent;
      if (!DOE) return Promise.resolve(false);
      var ask = typeof DOE.requestPermission === 'function' ? DOE.requestPermission() : Promise.resolve('granted');
      return Promise.resolve(ask).then(function (r) {
        if (r !== 'granted' || state.destroyed) return false;
        state.gyro = { q: null, yawOffset: 0 };
        window.addEventListener('deviceorientation', onOrient);
        wake();
        return true;
      }, function () { return false; });
    }
    function disableMotion() {
      if (!state.gyro) return;
      if (state.gyro.q) {
        // Hand the current look back to the drag controls so nothing jumps.
        var m = quatMatrix(quatMul(quatAxis(0, 1, 0, state.gyro.yawOffset), state.gyro.q));
        state.view = { yaw: headingOf(m), pitch: clamp(Math.asin(clamp(-m[7], -1, 1)), -PITCH_LIMIT_DEG * DEG, PITCH_LIMIT_DEG * DEG), fovDeg: state.view.fovDeg };
      }
      state.gyro = null;
      window.removeEventListener('deviceorientation', onOrient);
      invalidate();
    }

    var videoEvents = ['play', 'playing', 'seeked', 'loadeddata', 'timeupdate'];
    videoEvents.forEach(function (ev) { video.addEventListener(ev, wake); });
    var ro = null;
    if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(invalidate); ro.observe(canvas); }
    function onLost(e) {
      e.preventDefault();
      if (typeof opts.onFail === 'function') opts.onFail();
    }
    canvas.addEventListener('webglcontextlost', onLost);

    if (video.parentNode === host) host.insertBefore(canvas, video.nextSibling);
    else host.appendChild(canvas);
    host.classList.add('vr-view-on');
    wake();

    return {
      canvas: canvas,
      setProjection: function (p) { if (isProjection(p)) { state.projection = p; invalidate(); } },
      recenter: function () { state.view = { yaw: 0, pitch: 0, fovDeg: FOV_DEFAULT_DEG }; if (state.gyro) state.gyro.q = null; invalidate(); },
      enableMotion: enableMotion,
      disableMotion: disableMotion,
      motionOn: function () { return !!state.gyro; },
      destroy: function () {
        if (state.destroyed) return;
        state.destroyed = true;
        if (state.raf) cancelAnimationFrame(state.raf);
        state.raf = 0;
        disableMotion();
        videoEvents.forEach(function (ev) { video.removeEventListener(ev, wake); });
        if (ro) ro.disconnect();
        canvas.removeEventListener('webglcontextlost', onLost);
        host.classList.remove('vr-view-on');
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        try { var ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (_) { /* best effort: free the GPU memory now */ }
      },
    };
  }

  var api = {
    PROJECTIONS: PROJECTIONS,
    isProjection: isProjection,
    uniformsFor: uniformsFor,
    frameTooLarge: frameTooLarge,
    yawPitchMatrix: yawPitchMatrix,
    quatMatrix: quatMatrix,
    quatMul: quatMul,
    deviceQuaternion: deviceQuaternion,
    headingOf: headingOf,
    dragView: dragView,
    zoomView: zoomView,
    FOV_DEFAULT_DEG: FOV_DEFAULT_DEG,
    FOV_MIN_DEG: FOV_MIN_DEG,
    FOV_MAX_DEG: FOV_MAX_DEG,
    mount: mount,
  };
  if (typeof window !== 'undefined') window.VrView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
