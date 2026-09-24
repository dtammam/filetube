// FileTube AMBIENT MODE - the one shared module (v1.317 M4, Dean: "Ambient mode in the
// music player in desktop" / "I have ambient mode selected in this player but I don't
// see any ambience for the music").
//
// WHY THIS FILE EXISTS. Until v1.317 the engine (createAmbientEngine and its pure
// helpers) and its wiring (setupAmbientMode) lived inside watch.js, the wiring INSIDE
// the watch view's init closure. The Ambient toggle row sits in the PERSISTENT player
// host's cog menu, so after a watch visit it rode along into the music view - visible,
// checked, and inert (nothing on the music side read it). Now:
//   - the helpers + engine below are MOVED VERBATIM from watch.js (v1.186-v1.314, every
//     v1.312 constraint and lock unchanged);
//   - createAmbientHost(opts) is the watch wiring factored out, so the watch view and
//     the music view run the SAME engine through the SAME start/stop funnel, the SAME
//     pref key (localStorage 'ft-ambient') and the SAME dark-only gate;
//   - ensureAmbientToggleRow is the ONE writer of the cog's Ambient row (id-guarded:
//     whichever view injects first wins, the other reuses it).
// Loaded on EVERY app shell BEFORE watch.js / player.js / music.js (the SHELL PARITY
// class: a view is lazy-loaded into whatever shell was cold-loaded, so a global it
// depends on must ship on every shell - a dynamic census enumerates the shells). The
// declarations stay classic-script globals (exactly as they were in watch.js) and the
// API is ALSO published explicitly as window.FileTubeAmbient (the body-scroll-lock /
// wheel-config convention) - the consumers read that, never an implicit global.

// v1.186 Ambient mode pure helpers (mirroring the theatre trio; unit-tested).
// Default OFF: any value other than the exact '1' sentinel is off.
function isAmbientEnabled(rawValue) {
  return rawValue === '1';
}

function ambientStorageValue(on) {
  return on ? '1' : '0';
}
// The SINGLE fire-time predicate for the sampling loop. Ambient paints ONLY when
// ALL are true: the user turned it on, the theme is DARK (it makes no sense in
// light - Dean's ruling), the media is playing, and the tab is visible. Any
// false tears the loop down (no idle battery cost - the v1.160 lesson).
function ambientShouldRun(s) {
  return !!(s && s.prefOn && s.dark && s.playing && s.docVisible);
}
// Dark-theme detection: the era lives in data-theme, light/dark in data-mode.
function isDarkMode(doc) {
  try { return (doc || document).documentElement.getAttribute('data-mode') === 'dark'; }
  catch (_) { return false; }
}

// v1.312 (Dean, device: ambient ON blacked out EVERY video on his iPhone - the
// picture for ~1s, then black, audio + glow colours continuing; on every build
// back to 1.311.1; OFF = picture). The old effect copied the live <video> into a
// canvas every 500ms and composited a blurred + masked + scaled layer beside the
// video - both known iOS video/canvas/GPU-process breakage shapes. Dean's ruling:
// REBUILD as YouTube's subtle edge glow, and NEVER read the video element.
//
// The rebuilt pipeline is COLOUR-ONLY: sample a same-origin IMAGE (the storyboard
// sprite tile at the current time, else the item's poster) on an OFF-DOM canvas
// and paint the result on two plain divs that cross-fade. No drawImage from a
// media element, no filter / transform / mask on anything beside the video.
// Everything below is pure or injected so the unit suite drives the real
// pipeline with fakes.
//
// v1.313 POLISH (Dean, device + desktop screenshots of v1.312: "looks worse on
// hard borders/edges, and look at the player corners"): the eight CSS gradients
// (one averaged swatch per edge band / corner ellipse) had hard band ENDS, a
// visible seam + notch at the player's rounded corners and a flat grey colour.
// Now the tile is drawn STRETCHED over a tiny off-DOM bitmap that stands for the
// whole glow box (player + reach), a rounded-rect VIGNETTE is written into its
// alpha channel (opaque at the player's edge, transparent at the box edge), and
// the PNG data URL becomes the layer's background-image at 100% 100%. The
// browser's bilinear UPSCALE is the blur - YouTube's own mechanism (it upscales
// two 110x75 canvases by scale(1.5, 2) with no CSS filter), minus the DOM canvas
// and minus any transform. One continuous 2D alpha field: no band ends, no corner
// seams, and the frame's own spatial variation survives.
var AMBIENT_SAMPLE_W = 64;
var AMBIENT_SAMPLE_H = 36;
var AMBIENT_REACH_X = 0.12; // the glow reaches 12% of the player's WIDTH each side (style.css --ambient-reach-x, test-bound)
var AMBIENT_REACH_Y = 0.22; // ...and 22% of its HEIGHT above/below (--ambient-reach-y) - YouTube's measured extent
var AMBIENT_VIGNETTE_GAMMA = 1.5; // alpha = (1 - f)^gamma across the reach: YouTube's measured falloff (~half at 37%, ~15% at 73%)
var AMBIENT_CLOCK_MS = 1000; // the tile-change clock; NOT a paint rate (a paint happens only on a source change)
// v1.314 PACE (Dean, iPhone: "ambient changes too much and is slow"). A storyboard
// tile lands every 2-36s (lib/storyboard: d/40 clamped to [2,10]s, then the 100-frame
// cap stretches long clips), and each tile was a WHOLE new picture cross-faded in
// over 1.2s - six visible morphs a minute on a typical clip. Now the glow is a
// running field SMOOTHED IN MEDIA TIME: a new tile that lands dt seconds after the
// last one is blended in with weight 1 - exp(-dt / tau), so a 2s cadence moves
// ~12% per tile and a 10s cadence ~49% - the same drift per second either way, and
// a seek far away (dt large) still snaps. A step whose mean change is under
// AMBIENT_MIN_DELTA is absorbed into the field without a repaint (a static scene
// never churns), and a layer is never repainted before its fade has ended.
var AMBIENT_FADE_MS = 2400;    // the layer cross-fade (style.css --ambient-fade, test-bound) AND the minimum gap between paints
var AMBIENT_SMOOTH_TAU_S = 15; // media-time constant of the smoothing (the pace knob: larger = lazier)
var AMBIENT_MIN_DELTA = 4;     // mean |change| per channel (0-255, pre-lift) below which a step is absorbed, not painted

// What to sample for this item at time t: the sprite tile (video with a
// storyboard geometry), else the poster image, else nothing. `storyboard` is the
// player's pure geometry pair ({ frameForTime, tile } on window.FileTube.storyboard);
// absent -> the image rung. The poster follows player.js's own poster rule:
// an explicit artUrl (tv episodes, books) wins over /thumbnail/<id>.
// Gate r1 (adversary F1, CRITICAL): the `?tv=` watch path has NO mediaId
// (resolveWatchMediaId reads only ?v=/?id=), so an id-gated ladder left tv
// episodes INERT - the DOM lit up with nothing painted. A tv descriptor always
// carries `artUrl`, so the poster rung needs the ART, not an id; only the
// sprite/thumbnail rungs need the id.
function ambientSourceFor(mediaData, mediaId, t, storyboard) {
  var art = (mediaData && typeof mediaData.artUrl === 'string' && mediaData.artUrl) ? mediaData.artUrl : '';
  if (!mediaId && !art) return null;
  var geom = (mediaId && mediaData && mediaData.type === 'video') ? mediaData.storyboard : null;
  if (geom && geom.count > 0 && storyboard && typeof storyboard.frameForTime === 'function' && typeof storyboard.tile === 'function') {
    var index = storyboard.frameForTime(t, geom, mediaData.duration);
    var tile = storyboard.tile(index, geom);
    return {
      kind: 'sprite',
      url: '/storyboard/' + encodeURIComponent(mediaId),
      index: tile.index,
      col: tile.col,
      row: tile.row,
      cols: Math.max(1, geom.cols | 0),
      rows: Math.max(1, geom.rows | 0),
    };
  }
  return { kind: 'image', url: art || ('/thumbnail/' + encodeURIComponent(mediaId)), index: 0 };
}

// THE VIGNETTE (pure, in place). `data` is the WxH RGBA buffer of the tile drawn
// STRETCHED over the glow box, so the inner rectangle `1/(1+2*reach)` of each
// axis is where the player sits and the ring outside it is the reach. Every
// pixel is lifted (below), then its alpha becomes `(1 - f)^gamma` where `f` is
// how far OUTSIDE the inner rectangle it lies, as a fraction of the reach on
// each axis combined by hypot (so the falloff is rounded at the corners and a
// corner reads dimmer than an edge midpoint - YouTube measured [18,18,15] at the
// corner vs [31,40,28] at the edge). Alpha is 255 under the player (the rounded
// corner gap shows a tint continuous with the band, not a notch) and 0 on the
// outermost ring, so the box edge is never a hard line.
function ambientVignette(data, w, h, reach) {
  var rx = reach && reach.rx > 0 ? reach.rx : AMBIENT_REACH_X;
  var ry = reach && reach.ry > 0 ? reach.ry : AMBIENT_REACH_Y;
  var gamma = reach && reach.gamma > 0 ? reach.gamma : AMBIENT_VIGNETTE_GAMMA;
  var ux = 1 / (1 + 2 * rx), uy = 1 / (1 + 2 * ry); // the inner rect's half-extent, as a fraction of the half-box
  var hw = w / 2, hh = h / 2;
  // Pixel CENTRES, normalised so the outermost row/column sits at exactly 1
  // (alpha 0): the bitmap's own edge is then never a visible line.
  for (var y = 0; y < h; y++) {
    var v = Math.abs(y + 0.5 - hh) / (hh - 0.5);
    var fy = v > uy ? (v - uy) / (1 - uy) : 0;
    for (var x = 0; x < w; x++) {
      var u = Math.abs(x + 0.5 - hw) / (hw - 0.5);
      var fx = u > ux ? (u - ux) / (1 - ux) : 0;
      var f = Math.min(1, Math.sqrt(fx * fx + fy * fy));
      var i = (y * w + x) * 4;
      var c = ambientLift([data[i], data[i + 1], data[i + 2]]);
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
      data[i + 3] = Math.round(255 * Math.pow(1 - f, gamma));
    }
  }
  return data;
}

// THE PACE (v1.314, pure). The weight of a new tile that arrived `dt` media
// seconds after the last integrated one: 1 - exp(-dt / tau). No history (dt not
// a finite number) -> 1 (a snap: the first paint, a rung change).
function ambientSmoothing(dt, tau) {
  var t = tau > 0 ? tau : AMBIENT_SMOOTH_TAU_S;
  if (typeof dt !== 'number' || !Number.isFinite(dt)) return 1;
  return 1 - Math.exp(-Math.abs(dt) / t);
}
// Blend the RGB of a freshly drawn RGBA `data` buffer into the running field
// `acc` (Float32Array, 3 per pixel; null = no field yet -> a copy) with weight k.
function ambientBlend(acc, data, k, n) {
  var out = acc && acc.length === n * 3 ? acc : null;
  var w = out ? Math.min(1, Math.max(0, k)) : 1;
  if (!out) out = new Float32Array(n * 3);
  for (var p = 0; p < n; p++) {
    var i = p * 4, j = p * 3;
    out[j] += (data[i] - out[j]) * w;
    out[j + 1] += (data[i + 1] - out[j + 1]) * w;
    out[j + 2] += (data[i + 2] - out[j + 2]) * w;
  }
  return out;
}
// Mean |a - b| per channel over two RGB fields (0-255). No `b` -> Infinity (paint).
function ambientMeanDelta(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return Infinity;
  var sum = 0;
  for (var i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

// A mild lift so the glow reads as tinted LIGHT: saturation x1.15 (capped),
// lightness clamped to [0.12, 0.62] - a black scene glows only faintly (v1.313:
// the old 0.30 floor turned every dark scene into the same grey slab), a white
// scene does not wash the page out. The glow's single opacity
// (`--ambient-opacity` in style.css) does the rest, tuned so the edge peak lands
// near YouTube's measured ~+25/255.
function ambientLift(rgb) {
  var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var l = (max + min) / 2, h = 0, s = 0;
  if (max !== min) {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  s = Math.min(1, s * 1.15);
  l = Math.min(0.62, Math.max(0.12, l));
  function hue(p, q, tt) {
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  }
  var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  var p = 2 * l - q;
  return [Math.round(hue(p, q, h + 1 / 3) * 255), Math.round(hue(p, q, h) * 255), Math.round(hue(p, q, h - 1 / 3) * 255)];
}

// The engine. Injected collaborators (all overridable for the unit suite):
//   glow        the #ambient-glow div holding two .ambient-glow-layer children
//   video       the media element (read for currentTime ONLY - never drawn)
//   getMediaData() -> the view's descriptor (read lazily: the v1.197.1 TDZ lesson)
//   mediaId, storyboard, loadImage(url) -> Promise<img|null>, makeCanvas() -> canvas,
//   setTimeout/clearTimeout, clockMs, now() (wall ms), fadeMs, smoothTauS, minDelta, onHardFail()
// Contract: start() paints the first source immediately, then re-checks the
// source on the clock and samples ONLY when the tile index / url changes; a new
// tile is blended into the running field (v1.314, media-time smoothing), painted
// only when the field moved by at least minDelta, and never while the previous
// cross-fade (fadeMs) is still running - a deferred tile is re-checked on the
// next clock; stop() cancels the clock. A throw in sampling hard-fails this engine (never re-armed)
// AND reports it through onHardFail - the sample runs after an ASYNC image load,
// so the caller's DOM state (is-on, the sidebar bleed) would otherwise stay lit
// with nothing painting (gate r1, adversary F2 / QA W1).
function createAmbientEngine(opts) {
  var onHardFail = typeof opts.onHardFail === 'function' ? opts.onHardFail : null;
  var glow = opts.glow;
  var video = opts.video;
  var getMediaData = opts.getMediaData || function () { return null; };
  var mediaId = opts.mediaId;
  var storyboard = opts.storyboard || null;
  var loadImage = opts.loadImage;
  var makeCanvas = opts.makeCanvas;
  var setT = opts.setTimeout || setTimeout;
  var clearT = opts.clearTimeout || clearTimeout;
  var clockMs = opts.clockMs || AMBIENT_CLOCK_MS;
  var now = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };
  var fadeMs = opts.fadeMs >= 0 ? opts.fadeMs : AMBIENT_FADE_MS;
  var smoothTauS = opts.smoothTauS > 0 ? opts.smoothTauS : AMBIENT_SMOOTH_TAU_S;
  var minDelta = opts.minDelta >= 0 ? opts.minDelta : AMBIENT_MIN_DELTA;

  var timerId = null;
  var hardFailed = false;
  var spriteFailed = false; // a 404'd/undecodable sprite drops to the poster rung for this view
  var painted = null;       // { kind, url, index } of the last INTEGRATED source (painted or absorbed)
  var images = {};          // url -> img | 'loading' | 'failed'
  var front = 1;            // index of the layer currently shown (the other is painted next)
  var canvas = null, ctx = null;
  var acc = null;           // the running RGB field (pre-lift), smoothed in media time
  var shown = null;         // the RGB field of the last PAINTED bitmap (the threshold's baseline)
  var lastT = null;         // media time of the last integrated sample (dt for the smoothing)
  var lastPaintAt = -Infinity; // wall time of the last paint (the fade gap)

  function layers() {
    var ls = glow && glow.querySelectorAll ? glow.querySelectorAll('.ambient-glow-layer') : [];
    return ls.length >= 2 ? [ls[0], ls[1]] : null;
  }
  function currentTime() {
    var t = video ? Number(video.currentTime) : 0;
    return Number.isFinite(t) ? t : 0;
  }
  function source() {
    var src = ambientSourceFor(getMediaData(), mediaId, currentTime(), storyboard);
    if (src && src.kind === 'sprite' && spriteFailed) {
      src = ambientSourceFor(getMediaData(), mediaId, currentTime(), null); // the image rung
    }
    return src;
  }
  // v1.317 M4: keep ONE decoded image - the current source's. The watch view only ever
  // has two URLs (the sprite, else the poster), but the music view's source is the
  // CURRENT track's art, so a long session walks a new URL per track and a cache that
  // kept every decoded image would grow with the queue. Once the current source's image
  // is ready, every OTHER loaded image is dropped ('failed' markers are kept - they are
  // tiny and stop a re-request of a URL already known bad; an in-flight 'loading' entry
  // is kept so its promise lands). A dropped URL that comes back is simply re-loaded.
  function forgetOtherImages(keepUrl) {
    for (var u in images) {
      if (u !== keepUrl && images[u] !== 'failed' && images[u] !== 'loading') delete images[u];
    }
  }
  function sameSource(a, b) {
    return !!(a && b && a.kind === b.kind && a.url === b.url && a.index === b.index);
  }
  function ensureCanvas() {
    if (ctx) return ctx;
    canvas = makeCanvas();
    canvas.width = AMBIENT_SAMPLE_W;
    canvas.height = AMBIENT_SAMPLE_H;
    ctx = canvas.getContext('2d');
    return ctx;
  }
  // Draw the tile (or the whole poster) STRETCHED over the tiny bitmap that
  // stands for the glow box, blend it into the running field (v1.314: weight
  // from the media time since the last tile; a rung change snaps), and if the
  // field moved enough, vignette it in place and hand back the PNG data URL the
  // layer paints (v1.313). Returns { url } to paint, { skip: true } when the
  // step was absorbed, null for a failed source. Same-origin images only, so
  // toDataURL never throws for taint; a throw here still hard-fails the engine
  // (the caller's try).
  function sample(img, src) {
    var c = ensureCanvas();
    var iw = img.naturalWidth || img.width || 0, ih = img.naturalHeight || img.height || 0;
    if (!(iw > 0 && ih > 0)) return null;
    var sx = 0, sy = 0, sw = iw, sh = ih;
    if (src.kind === 'sprite') {
      sw = iw / src.cols; sh = ih / src.rows;
      sx = src.col * sw; sy = src.row * sh;
    }
    c.drawImage(img, sx, sy, sw, sh, 0, 0, AMBIENT_SAMPLE_W, AMBIENT_SAMPLE_H);
    var id = c.getImageData(0, 0, AMBIENT_SAMPLE_W, AMBIENT_SAMPLE_H);
    var n = AMBIENT_SAMPLE_W * AMBIENT_SAMPLE_H;
    var t = currentTime();
    var sameRung = !!(painted && painted.kind === src.kind && painted.url === src.url);
    var k = sameRung && lastT !== null ? ambientSmoothing(t - lastT, smoothTauS) : 1;
    acc = ambientBlend(sameRung ? acc : null, id.data, k, n);
    lastT = t;
    if (ambientMeanDelta(acc, shown) < minDelta) return { skip: true };
    for (var p = 0; p < n; p++) {
      id.data[p * 4] = Math.round(acc[p * 3]);
      id.data[p * 4 + 1] = Math.round(acc[p * 3 + 1]);
      id.data[p * 4 + 2] = Math.round(acc[p * 3 + 2]);
    }
    ambientVignette(id.data, AMBIENT_SAMPLE_W, AMBIENT_SAMPLE_H, null);
    c.putImageData(id, 0, 0);
    var url = canvas.toDataURL('image/png');
    if (!(typeof url === 'string' && url.indexOf('data:image/png') === 0)) return null;
    shown = new Float32Array(acc);
    return { url: url };
  }
  function paint(dataUrl, src) {
    var ls = layers();
    if (!ls) return;
    var back = ls[front === 0 ? 1 : 0];
    back.style.setProperty('background-image', 'url("' + dataUrl + '")');
    back.classList.add('is-front');
    ls[front].classList.remove('is-front');
    front = front === 0 ? 1 : 0;
    lastPaintAt = now();
    painted = { kind: src.kind, url: src.url, index: src.index };
  }
  function fail() {
    hardFailed = true;
    stop();
    if (onHardFail) { try { onHardFail(); } catch (_) { /* the caller's teardown must not re-throw into the sampler */ } }
  }
  // One evaluation: paint iff the source changed and its image is ready.
  function check() {
    if (hardFailed) return;
    var src = source();
    if (!src) return;
    if (sameSource(src, painted)) return;
    var img = images[src.url];
    if (img === 'failed') {
      if (src.kind === 'sprite' && !spriteFailed) { spriteFailed = true; check(); } // fall to the poster
      return;
    }
    if (!img) {
      images[src.url] = 'loading';
      loadImage(src.url).then(function (loaded) {
        images[src.url] = loaded || 'failed';
        if (timerId != null) check(); // only while still running (a stopped engine paints nothing)
      }, function () { images[src.url] = 'failed'; if (timerId != null) check(); });
      return;
    }
    if (img === 'loading') return;
    forgetOtherImages(src.url);
    // Never repaint a layer mid-fade (the back layer is the one still fading
    // out): a tile that lands inside the fade waits for the next clock.
    var n = now();
    if (lastPaintAt > n) lastPaintAt = n; // gate r1 qa S1: Date.now is not monotonic (an NTP step backwards must not defer every paint)
    if (n - lastPaintAt < fadeMs) return;
    var bitmap;
    try { bitmap = sample(img, src); } catch (_) { fail(); return; }
    if (!bitmap) { images[src.url] = 'failed'; return; }
    if (bitmap.skip) { painted = { kind: src.kind, url: src.url, index: src.index }; return; } // absorbed: no swap, no re-sample of this tile
    paint(bitmap.url, src);
  }
  function tick() {
    timerId = null;
    check();
    if (!hardFailed) timerId = setT(tick, clockMs);
  }
  function start() {
    if (hardFailed || timerId != null) return false;
    check();
    if (hardFailed) return false;
    timerId = setT(tick, clockMs);
    return true;
  }
  function stop() {
    if (timerId != null) clearT(timerId);
    timerId = null;
  }
  return {
    start: start,
    stop: stop,
    running: function () { return timerId != null; },
    hardFailed: function () { return hardFailed; },
    painted: function () { return painted; },
    front: function () { return front; },
  };
}

// v1.317 M4: is `url` an image the sample canvas may draw without being TAINTED? Only a
// same-origin URL qualifies (a cross-origin image loads fine but makes getImageData /
// toDataURL throw, which hard-fails the engine). Resolved against the page origin, so a
// protocol-relative `//host/x`, a backslash `/\host/x`, an absolute foreign URL and a
// `data:` URL (origin "null") are all refused; a plain `/albumart/<id>` passes. Returns
// the url unchanged when it qualifies, else ''. The music view gates its art on this
// (the watch view's rungs are all same-origin routes by construction and keep their
// v1.312 behavior untouched).
function ambientSameOriginUrl(url, origin) {
  if (typeof url !== 'string' || !url) return '';
  try {
    var base = origin || ((typeof location !== 'undefined' && location && location.origin && location.origin !== 'null') ? location.origin : '');
    if (!base) return '';
    var baseOrigin = new URL(base).origin;
    return new URL(url, base).origin === baseOrigin ? url : '';
  } catch (_) { return ''; }
}

// v1.317 M4: the ONE writer of the cog menu's Ambient row. The row lives in the
// PERSISTENT player host (parity-locked across the shells, so it cannot be baked into
// the shared template - the v1.186 rule), so it is injected at runtime, id-guarded:
// whichever view mounts first writes it, every later mount reuses it. The ids are the
// v1.186 ones (the CSS light belt + [hidden] override key off #ambient-toggle-row).
// Returns { row, check } or null when there is no host (and so no cog menu) yet - the
// caller retries at its mount seam.
var AMBIENT_ROW_HTML = '<label class="watch-autoplay-label settings-menu-toggle" id="ambient-toggle-row" for="watch-ambient-check">'
  + '<span class="watch-autoplay-text">Ambient mode</span>'
  + '<span class="watch-autoplay-switch"><input type="checkbox" id="watch-ambient-check" aria-label="Ambient mode" />'
  + '<span class="watch-autoplay-track"><span class="watch-autoplay-thumb"></span></span></span></label>';
function ensureAmbientToggleRow(doc) {
  var d = doc || document;
  var check = d.getElementById('watch-ambient-check');
  if (!check) {
    var menu = d.getElementById('settings-menu');
    if (!menu) return null;
    menu.insertAdjacentHTML('beforeend', AMBIENT_ROW_HTML);
    check = d.getElementById('watch-ambient-check');
    if (!check) return null;
  }
  return { row: d.getElementById('ambient-toggle-row'), check: check };
}

// v1.317 M4 gate r1: the longest a LIT glow is held across the player's own load gap
// (createAmbientHost loadHoldMs, music only). A track change on a local library loads in
// well under a second; the bound only matters when the next src never plays (a stalled
// network), and then the glow clears this long after the gap began. A load that ERRORS
// is no gap (gate r2): it clears at the 'error' event, not at the bound.
var AMBIENT_LOAD_HOLD_MS = 8000;
// v1.317 M4 gate r2 (Dean: fix the natural-end blink): the longest a LIT glow is held after
// a track's natural END (createAmbientHost endHoldMs, music only) while the queue advance
// fetches the next track and starts its load. Once that load begins (the element is
// emptied) the load-gap hold above takes over; a FINISHED queue (nothing loads next)
// clears this long after the end.
var AMBIENT_END_HOLD_MS = 1500;

// v1.317 M4: THE HOST - the v1.312 watch wiring (setupAmbientMode) factored out so a
// second view drives the same engine through the same funnel. Paints ONLY when
// ambientShouldRun (the user turned it on, the theme is DARK, the media is playing, the
// tab is visible) AND the view's own canRun() holds; any false tears the loop down (no
// idle battery cost - v1.160). The media element is read for play state + currentTime
// ONLY - its pixels are never drawn (the engine samples a same-origin IMAGE off-DOM).
// opts:
//   doc          the document (default: the global one)
//   glow         the view's .ambient-glow div (two .ambient-glow-layer children)
//   check, row   the cog's Ambient checkbox + its row (ensureAmbientToggleRow)
//   getMedia()   -> the LIVE media element (re-read on every evaluate: a view whose
//                player host is cloned or mounted later binds it when it appears)
//   getMediaData() -> the view's descriptor for ambientSourceFor (read lazily)
//   mediaId      the sprite / thumbnail rungs' id (watch); null for an art-only view
//   storyboard   the player's sprite geometry pair, or null
//   canRun()     optional extra gate, ANDed in (music: desktop + mounted in THIS
//                view's slot + a current music track with same-origin art)
//   observe      optional element whose childList changes re-evaluate (music: the
//                #player-slot the host is appended into / moved out of on dock)
//   signal       the view's AbortController signal: every listener and observer dies
//                with it, and the abort stops the engine and clears the DOM state
//   loadHoldMs   optional (music): HOLD a lit glow across the player's own load gap
//                for up to this long (below); 0 / absent = no hold (watch: a new item
//                is a new view, so its behavior is the v1.312 one, byte for byte)
//   endHoldMs    optional (music): HOLD a lit glow after a natural END for up to this
//                long, so a queue advance does not blink (below); 0 / absent = none
//   loadImage, makeCanvas  optional overrides (unit tests); defaults below
//   setTimeout, clearTimeout  optional overrides for the hold timer (unit tests)
// Returns { evaluate, stop, engine } or null when the view has no glow / toggle (a
// view mounted without the cog menu or its glow pair: nothing to bind, nothing to light).
function createAmbientHost(opts) {
  var doc = opts.doc || document;
  var glow = opts.glow;
  var check = opts.check;
  var row = opts.row;
  var signal = opts.signal;
  if (!check || !glow) return null;
  // (gate r1 adversary S3: bound by ambient-host "no glow or no toggle: no host".)
  // A view that already tore down (a late async seam in a dead init closure - a slow
  // fetch that lands after the soft-nav) must never build a live host: its listeners
  // would bind to an aborted signal (a no-op) while the observers and the engine ran
  // unowned, lighting the NEXT view's page.
  if (signal && signal.aborted) return null;
  var getMedia = typeof opts.getMedia === 'function' ? opts.getMedia : function () { return null; };
  var canRun = typeof opts.canRun === 'function' ? opts.canRun : function () { return true; };
  var loadHoldMs = opts.loadHoldMs > 0 ? opts.loadHoldMs : 0;
  var endHoldMs = opts.endHoldMs > 0 ? opts.endHoldMs : 0;
  var setHoldT = typeof opts.setTimeout === 'function' ? opts.setTimeout : setTimeout;
  var clearHoldT = typeof opts.clearTimeout === 'function' ? opts.clearTimeout : clearTimeout;

  // Dark-only: reveal the toggle row only in a dark theme; a light theme
  // hides the control and guarantees the effect is off.
  function syncRowVisibility() {
    var dark = isDarkMode(doc);
    if (row) row.hidden = !dark;
    return dark;
  }

  var prefOn = false;
  try { prefOn = isAmbientEnabled(localStorage.getItem('ft-ambient')); } catch (_) { prefOn = false; }
  check.checked = prefOn;
  syncRowVisibility();

  function currentlyPlaying() {
    var media = getMedia();
    return !!(media && !media.paused && !media.ended && media.readyState >= 2);
  }
  function shouldRun() {
    return ambientShouldRun({ prefOn: prefOn, dark: isDarkMode(doc), playing: currentlyPlaying(), docVisible: !doc.hidden }) && !!canRun();
  }
  // v1.317 M4 gate r1 (qa W1 / adversary W3): a view that advances WITHOUT a reload (music:
  // the next track loads into the SAME media element) passes through the player's own
  // load gap on every track change - player.js teardownMediaState pauses the element and
  // empties it (removeAttribute('src') + load(): 'pause' + 'emptied' at readyState 0),
  // then the new src plays. Read literally, "not playing" would drop a LIT glow and the
  // root sidebar signal for the whole gap and re-light after it (a blink per track).
  // So while the glow is lit, the element is in that gap (readyState below
  // HAVE_CURRENT_DATA) and every OTHER axis still holds (pref, dark, visible, the view's
  // own gate), the host keeps its lit state - the engine keeps its clock, so the new
  // cover cross-fades in - for at most loadHoldMs, then re-decides. A real user pause
  // happens at readyState 2+: not a gap, it clears at once. A load that FAILED (gate r2,
  // adversary S1: media.error set, then 'error') is no gap either - nothing will play,
  // so it clears at the error instead of holding for the whole bound.
  function holdAxes() {
    return ambientShouldRun({ prefOn: prefOn, dark: isDarkMode(doc), playing: true, docVisible: !doc.hidden }) && !!canRun();
  }
  function inLoadGap() {
    if (!loadHoldMs || !glow.classList.contains('is-on')) return false;
    var media = getMedia();
    if (!media || !(media.readyState < 2) || media.error) return false;
    return holdAxes();
  }
  // v1.317 M4 gate r2 (Dean: fix the natural-end blink): at a track's natural end the
  // element fires 'pause' then 'ended' at readyState 4, and the queue advance (an
  // /api/queue fetch, then the load) starts the next track only after that. So a lit glow
  // whose media ENDED is held too, for at most endHoldMs; the next load's gap (emptied at
  // readyState 0) then hands over to the load hold, and a finished queue clears at the
  // bound. The hold is LATCHED once armed: the player's own ended cascade rewinds the
  // element to 0 right after 'ended' (player.js runEndedCompletionCascade), so `ended`
  // reads false again while it still sits paused waiting for the advance - and that
  // rewind's SEEK drops readyState to HAVE_METADATA (1) until it lands (MEASURED in headless
  // Chromium: 'ended' observed at readyState 1). So the end hold is decided BEFORE the load
  // gap (evaluate), and it lasts while the element still HAS its media (readyState 1+):
  // HAVE_NOTHING (0) means the next track's load began ('emptied'), and the load hold takes
  // over with its own bound. A real user pause never sets `ended`, so it never arms this and
  // still clears at once. (No paused / error check here: a playing element at readyState
  // 2+ already runs via shouldRun, and an errored load has emptied the element first.)
  function inEndHold() {
    if (!endHoldMs || !glow.classList.contains('is-on')) return false;
    var media = getMedia();
    if (!media || !(media.readyState >= 1)) return false;
    if (!media.ended && holdKind !== 'end') return false;
    return holdAxes();
  }
  var holdTimer = null;
  var holdKind = null;
  function clearHold() {
    if (holdTimer != null) clearHoldT(holdTimer);
    holdTimer = null;
    holdKind = null;
  }
  // ONE timer per hold KIND, armed at that hold's first event (a second event of the same
  // hold never extends it); an end hold handing over to the next track's load gap re-arms
  // with the load bound.
  function hold(kind, ms) {
    if (holdKind === kind) return;
    clearHold();
    holdKind = kind;
    holdTimer = setHoldT(holdExpired, ms);
  }
  // (a torn host never gets here: teardown's stop() cancels the timer)
  function holdExpired() {
    holdTimer = null;
    holdKind = null;
    if (shouldRun()) start(); else stop(); // the bound: nothing resumed -> the gap is over, clear
  }

  // Same-origin images only (the sprite / thumbnail / tv poster / album art routes), so
  // the off-DOM sample canvas is never tainted. A failed load resolves null and the
  // engine falls to its next rung.
  function loadImage(url) {
    return new Promise(function (resolve) {
      if (typeof Image === 'undefined') { resolve(null); return; }
      var im = new Image();
      im.decoding = 'async';
      im.onload = function () { resolve(im); };
      im.onerror = function () { resolve(null); };
      im.src = url;
    });
  }
  // The engine reads the media for currentTime ONLY, through this view of it - it never
  // holds the element itself (so it can never hand it to drawImage).
  var mediaClock = {};
  Object.defineProperty(mediaClock, 'currentTime', {
    get: function () { var media = getMedia(); return media ? media.currentTime : 0; },
  });
  var engine = createAmbientEngine({
    glow: glow,
    video: mediaClock,
    getMediaData: typeof opts.getMediaData === 'function' ? opts.getMediaData : function () { return null; }, // lazy: the v1.197.1 TDZ lesson
    mediaId: opts.mediaId,
    storyboard: opts.storyboard || null,
    loadImage: typeof opts.loadImage === 'function' ? opts.loadImage : loadImage,
    makeCanvas: typeof opts.makeCanvas === 'function' ? opts.makeCanvas : function () { return doc.createElement('canvas'); },
    onHardFail: function () { stop(); }, // an async sample failure tears the DOM down too (gate r1 F2/W1)
  });

  function start() {
    clearHold();
    if (engine.hardFailed()) return;
    if (engine.running()) return;
    glow.hidden = false;
    glow.classList.add('is-on');
    // v1.188 (Dean: "let the ambience go over the left bar"): a ROOT-level
    // signal so the persistent sidebar (a shell element far from this
    // view's node) can drop its opaque background + border while ambient
    // runs. Set/cleared at the SAME funnel as `is-on` (start/stop), so it
    // tracks ambient exactly and clears on teardown (stop() on abort) and on
    // a theme flip to light. JS gate guarantees it is only present in dark.
    doc.documentElement.setAttribute('data-ambient-on', '');
    engine.start();
  }
  function stop() {
    clearHold();
    engine.stop();
    glow.classList.remove('is-on');
    glow.hidden = true;
    doc.documentElement.removeAttribute('data-ambient-on'); // v1.188: restore the sidebar's opaque bar
  }

  // The media listeners ride their OWN controller (aborted by the teardown below): a
  // view whose player host is cloned lazily (a cold-load of /music has no media element
  // until the first play) binds the element on the first evaluate that finds it. The
  // host clones ONE media element per page and never replaces it, so one binding holds.
  var mediaCtl = null;
  function bindMedia() {
    if (mediaCtl) return;
    var media = getMedia();
    if (!media) return;
    mediaCtl = new AbortController();
    var mediaSignal = mediaCtl.signal;
    media.addEventListener('play', evaluate, { signal: mediaSignal });
    media.addEventListener('playing', evaluate, { signal: mediaSignal });
    media.addEventListener('pause', evaluate, { signal: mediaSignal });
    media.addEventListener('ended', evaluate, { signal: mediaSignal });
    media.addEventListener('emptied', evaluate, { signal: mediaSignal });
    // the hold's other exit: data for the new src arrived - playing re-decides at 'playing',
    // and a user who paused DURING the gap is cleared here (readyState 2+ and paused)
    if (loadHoldMs) media.addEventListener('loadeddata', evaluate, { signal: mediaSignal });
    // gate r2 (adversary S1): a load that fails ends any hold at once (media.error is set)
    if (loadHoldMs || endHoldMs) media.addEventListener('error', evaluate, { signal: mediaSignal });
  }
  // The one gate everything funnels through: run iff eligible, else tear down. After
  // the view's teardown nothing may re-light it: a late async seam of the dead view (a
  // fetch that resolves after the soft-nav) can still call evaluate().
  var torn = false;
  function evaluate() {
    if (torn) return;
    bindMedia();
    syncRowVisibility();
    // run; else HOLD a lit glow after a natural end while the queue advances, or across the
    // player's own load gap (each bounded, armed at its FIRST event); else tear down. The
    // end hold is asked FIRST: the ended rewind's seek (readyState 1) must not read as a
    // load gap, or a finished queue would wait out the LOAD bound.
    if (shouldRun()) start();
    else if (inEndHold()) hold('end', endHoldMs);
    else if (inLoadGap()) hold('load', loadHoldMs);
    else stop();
  }

  check.addEventListener('change', function () {
    prefOn = check.checked;
    try { localStorage.setItem('ft-ambient', ambientStorageValue(prefOn)); } catch (_) { /* not persisted */ }
    evaluate();
  }, { signal: signal });

  // Re-evaluate on every signal that can flip the gate. All bound to the view's
  // AbortController signal -> auto-removed on teardown (no leak).
  doc.addEventListener('visibilitychange', evaluate, { signal: signal });
  // A theme flip (era/mode toggle) mutates data-mode on <html>; watch it so
  // ambient turns off entering light and can resume entering dark.
  var themeObs = null;
  var slotObs = null;
  if (typeof MutationObserver !== 'undefined') {
    themeObs = new MutationObserver(evaluate);
    try { themeObs.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-mode', 'data-theme'] }); } catch (_) { themeObs = null; }
    if (opts.observe) {
      slotObs = new MutationObserver(evaluate);
      try { slotObs.observe(opts.observe, { childList: true }); } catch (_) { slotObs = null; }
    }
  }
  // Teardown: the view's signal aborts on destroy() -> stop the engine, drop the media
  // binding AND disconnect the observers (none of those three is signal-bound).
  function teardown() {
    torn = true;
    stop();
    if (mediaCtl) mediaCtl.abort();
    if (themeObs) { try { themeObs.disconnect(); } catch (_) { /* dead */ } }
    if (slotObs) { try { slotObs.disconnect(); } catch (_) { /* dead */ } }
  }
  if (signal) signal.addEventListener('abort', teardown, { once: true });

  evaluate();
  return { evaluate: evaluate, stop: stop, engine: engine };
}

var FileTubeAmbientApi = {
  AMBIENT_LOAD_HOLD_MS: AMBIENT_LOAD_HOLD_MS,
  AMBIENT_END_HOLD_MS: AMBIENT_END_HOLD_MS,
  isAmbientEnabled: isAmbientEnabled,
  ambientStorageValue: ambientStorageValue,
  ambientShouldRun: ambientShouldRun,
  isDarkMode: isDarkMode,
  ambientSourceFor: ambientSourceFor,
  ambientVignette: ambientVignette,
  ambientLift: ambientLift,
  ambientSmoothing: ambientSmoothing,
  ambientBlend: ambientBlend,
  ambientMeanDelta: ambientMeanDelta,
  ambientSameOriginUrl: ambientSameOriginUrl,
  createAmbientEngine: createAmbientEngine,
  createAmbientHost: createAmbientHost,
  ensureAmbientToggleRow: ensureAmbientToggleRow,
  AMBIENT_ROW_HTML: AMBIENT_ROW_HTML,
  AMBIENT_SAMPLE_W: AMBIENT_SAMPLE_W,
  AMBIENT_SAMPLE_H: AMBIENT_SAMPLE_H,
  AMBIENT_REACH_X: AMBIENT_REACH_X,
  AMBIENT_REACH_Y: AMBIENT_REACH_Y,
  AMBIENT_VIGNETTE_GAMMA: AMBIENT_VIGNETTE_GAMMA,
  AMBIENT_CLOCK_MS: AMBIENT_CLOCK_MS,
  AMBIENT_FADE_MS: AMBIENT_FADE_MS,
  AMBIENT_SMOOTH_TAU_S: AMBIENT_SMOOTH_TAU_S,
  AMBIENT_MIN_DELTA: AMBIENT_MIN_DELTA,
};
if (typeof window !== 'undefined') window.FileTubeAmbient = FileTubeAmbientApi;
if (typeof module !== 'undefined' && module.exports) module.exports = FileTubeAmbientApi;
