'use strict';
// v1.384.0: the ONE door to a native host (the iOS app, docs/references/ios-host.md).
//
// Loaded on EVERY shell that loads common.js (a plain <script> before glyph-pool.js, allowlisted in
// lib/auth/gate.js ALLOW_EXACT because login.html and welcome.html load it too). It reads
// window.FileTubeHost ONCE at load and exposes window.FileTube.host. With no host (every browser, the PWA)
// every call is a silent no-op, so nothing else in the web UI changes.
//
// The tables below MIRROR docs/references/native-bridge.v1.schema.json (contract v1, add-only);
// test/unit/native-bridge-contract.test.js fails when either side drifts. The web treats everything that
// comes back as DATA: an event is validated against EVENTS and ignored when it does not fit.
(function (root) {
  var VERSION_RE = /^\d+\.\d+\.\d+/;
  var CAPABILITIES = ['orientation', 'haptics', 'battery', 'serverSettings', 'statusBar', 'network', 'downloads', 'mediaFetch', 'nativeAudio'];
  // v1.387.0 offline playback (plan D5). The download kinds the web may ask for (the manifest's enum) and the
  // fields of one downloaded ITEM as native reports it: a `download` event, and each element of a
  // `downloadsSnapshot`. kind is always a single-item kind; an album or season add reports its MEMBERS, each
  // carrying parentKind + parentId (the album or season badge rolls up from them). state 'none' = not on the phone
  // (removed, gone, cancelled). error only with 'failed'; localSrc (an opaque URL) only with 'done', and the web
  // uses it ONLY as a media element src, never fetch / XHR / artwork / canvas.
  var DOWNLOAD_KINDS = ['track', 'album', 'podcastEpisode', 'video', 'tvEpisode', 'tvSeason'];
  var DOWNLOAD_ITEM_KINDS = ['track', 'podcastEpisode', 'video', 'tvEpisode'];
  var DOWNLOAD_STATES = ['none', 'queued', 'downloading', 'paused', 'waitingForWifi', 'done', 'failed'];
  // notPlayable (iOS Root review, 2026-10-12): the server's 409 or the app's own AVURLAsset.isPlayable failure - terminal.
  var DOWNLOAD_ERRORS = ['network', 'storageFull', 'revoked', 'notOnServer', 'notReady', 'notPlayable', 'other'];
  function downloadItemFields() {
    return {
      kind: { enum: DOWNLOAD_ITEM_KINDS.slice(), req: true },
      id: { is: 'string', min: 1, max: 512, req: true },
      state: { enum: DOWNLOAD_STATES.slice(), req: true },
      progress: { is: 'number', min: 0, max: 1 },
      bytes: { is: 'number', min: 0 },
      totalBytes: { is: 'number', min: 0 },
      error: { enum: DOWNLOAD_ERRORS.slice() },
      localSrc: { is: 'string', min: 1 },
      parentKind: { enum: ['album', 'tvSeason'] },
      parentId: { is: 'string', min: 1, max: 512 },
    };
  }
  var DOWNLOAD_LENIENT = { state: 'none', error: 'other' };
  // v1.397.0 nativeAudio (plan docs/exec-plans/active/2026-10-28-native-audio.md, D4-D7): the iOS app plays music and podcasts
  // through a native engine. The web sends the WHOLE queue of Items in audio.load (D5) and intents after it; native echoes the
  // queue in every audioState (it may have appended radio picks itself) and the web REPLACES its view with each snapshot
  // (audioTick is a position delta). src and artworkSrc are server-relative paths native resolves and appends the media
  // token to (D7). clip = one chapter of a file (clip-relative time, D6). progress.route is the ONLINE route native posts
  // to with the web's own body (D8). public/js/native-audio.js owns the ONE subscription and every post.
  var AUDIO_KINDS = ['track', 'podcastEpisode'];
  var AUDIO_PROGRESS_ROUTES = ['/api/music/progress', '/api/progress', '/api/podcasts/progress'];
  var AUDIO_STATES = ['idle', 'loading', 'playing', 'paused', 'ended', 'failed'];
  var AUDIO_ERRORS = ['network', 'notPlayable', 'revoked', 'notOnServer', 'other'];
  var AUDIO_LOOP = ['off', 'one'];
  var AUDIO_SLEEP_MODES = ['off', 'minutes', 'endOfItem'];
  var AUDIO_QUEUE_MAX = 2000;
  function audioItemFields() {
    return {
      kind: { enum: AUDIO_KINDS.slice(), req: true },
      id: { is: 'string', min: 1, max: 512, req: true },
      src: { is: 'string', min: 1, max: 2048, req: true },
      title: { is: 'string', max: 1024, req: true },
      artist: { is: 'string', max: 1024 },
      album: { is: 'string', max: 1024 },
      artworkSrc: { is: 'string', min: 1, max: 2048 },
      durationSec: { is: 'number', min: 0 },
      clip: { is: 'object', props: { startSec: { is: 'number', min: 0, req: true }, endSec: { is: 'number', min: 0, req: true } } },
      progress: { is: 'object', req: true, props: { route: { enum: AUDIO_PROGRESS_ROUTES.slice(), req: true }, key: { is: 'string', min: 1, max: 512, req: true } } },
      radioSeed: { is: 'string', min: 1, max: 512 },
    };
  }
  function audioModesSpec(req) {
    var o = { is: 'object', props: { autoplay: { is: 'boolean', req: true }, shuffle: { is: 'boolean', req: true }, loop: { enum: AUDIO_LOOP.slice(), req: true } } };
    if (req) o.req = true;
    return o;
  }
  function audioQueueSpec() { return { is: 'array', req: true, max: AUDIO_QUEUE_MAX, items: { is: 'object', props: audioItemFields() } }; }
  var AUDIO_RATE = { is: 'number', min: 0.5, max: 3, req: true };

  // Web to native. cap = the capability that must be announced (null = always). fields: the allowed
  // fields; req = required; a field spec is one of { is: 'string'|'number'|'object', min, max } /
  // { enum: [...] } / { eq: value }. A nested object spec carries its own `props`.
  var MESSAGES = {
    'host.hello': { cap: null, fields: { web: { is: 'object', req: true, props: { version: { is: 'string', req: true } } } } },
    'orientation.lock': { cap: 'orientation', fields: { orientation: { eq: 'portrait', req: true } } },
    'orientation.unlock': { cap: 'orientation', fields: {} },
    'haptics.prepare': { cap: 'haptics', fields: {} },
    'haptics.tick': { cap: 'haptics', fields: { style: { enum: ['detent', 'letter', 'snap'], req: true }, intensity: { is: 'number', min: 0, max: 1 } } },
    'battery.subscribe': { cap: 'battery', fields: {} },
    'battery.unsubscribe': { cap: 'battery', fields: {} },
    'host.openServerSettings': { cap: 'serverSettings', fields: {} },
    'statusBar.hide': { cap: 'statusBar', fields: {} },
    'statusBar.show': { cap: 'statusBar', fields: {} },
    'network.subscribe': { cap: 'network', fields: {} },
    'network.unsubscribe': { cap: 'network', fields: {} },
    // v1.387.0 offline playback: add / remove an item (native fetches the manifest itself with its token; nothing
    // else crosses), subscribe (one downloadsSnapshot now, then download deltas), unsubscribe, show (native opens
    // its Downloads screen). downloads.remove of an album or tvSeason removes every member native holds.
    'downloads.add': { cap: 'downloads', fields: { kind: { enum: DOWNLOAD_KINDS.slice(), req: true }, id: { is: 'string', min: 1, max: 512, req: true } } },
    'downloads.remove': { cap: 'downloads', fields: { kind: { enum: DOWNLOAD_KINDS.slice(), req: true }, id: { is: 'string', min: 1, max: 512, req: true } } },
    'downloads.subscribe': { cap: 'downloads', fields: {} },
    'downloads.unsubscribe': { cap: 'downloads', fields: {} },
    'downloads.show': { cap: 'downloads', fields: {} },
    // v1.397.0 nativeAudio: the whole queue up front, then intents. positionSec and audio.seek are clip-relative for a clip Item.
    'audio.load': { cap: 'nativeAudio', fields: { queue: audioQueueSpec(), index: { is: 'number', min: 0, req: true }, positionSec: { is: 'number', min: 0, req: true }, autoplay: { is: 'boolean', req: true }, modes: audioModesSpec(true), rate: AUDIO_RATE, rev: { is: 'number', min: 0, req: true } } },
    'audio.play': { cap: 'nativeAudio', fields: {} },
    'audio.pause': { cap: 'nativeAudio', fields: {} },
    'audio.seek': { cap: 'nativeAudio', fields: { positionSec: { is: 'number', min: 0, req: true } } },
    'audio.skip': { cap: 'nativeAudio', fields: { to: { enum: ['next', 'previous'], req: true } } },
    'audio.jump': { cap: 'nativeAudio', fields: { index: { is: 'number', min: 0, req: true } } },
    'audio.setModes': { cap: 'nativeAudio', fields: { modes: audioModesSpec(true) } },
    'audio.setRate': { cap: 'nativeAudio', fields: { rate: AUDIO_RATE } },
    // minutes is required when mode is 'minutes' (native-audio.js never posts one without it; the flat table cannot say so).
    'audio.sleep': { cap: 'nativeAudio', fields: { mode: { enum: AUDIO_SLEEP_MODES.slice(), req: true }, minutes: { is: 'number', min: 1, max: 720 } } },
    'audio.stop': { cap: 'nativeAudio', fields: {} },
    'audio.subscribe': { cap: 'nativeAudio', fields: {} },
    'audio.unsubscribe': { cap: 'nativeAudio', fields: {} },
  };

  // Native to web (event.detail of a 'filetube-host' CustomEvent on window).
  var EVENTS = {
    battery: {
      fields: {
        level: { is: 'number', nullable: true, min: 0, max: 1, req: true },
        state: { enum: ['unplugged', 'charging', 'full', 'unknown'], req: true },
      },
    },
    // v1.385.0. `connection` (not `type`: the envelope's own `type` is 'network'). A future connection kind this
    // web does not know is read as 'other' (`lenient`), never dropped, so the glyph cannot go stale on it.
    network: {
      lenient: { connection: 'other' },
      fields: {
        connection: { enum: ['wifi', 'cellular', 'wired', 'other', 'none'], req: true },
        constrained: { is: 'boolean' },
        expensive: { is: 'boolean' },
      },
    },
    // v1.387.0 offline playback: one event per ITEM. An unknown state reads as 'none', an unknown error as 'other'
    // (`lenient`); a bad optional field is dropped, never the event.
    download: { lenient: DOWNLOAD_LENIENT, fields: downloadItemFields() },
    // Sent once in answer to every downloads.subscribe: every item the phone holds or is working on. The web
    // REPLACES its map with it; download events after it are deltas. The same lenient mapping applies to each
    // element, and a bad element drops THAT element, not the snapshot; more than 10000 elements drops the whole
    // event (the app never sends one).
    // v1.387.1: an add that failed as a whole (a container that produced no member, a single item that never reached a
    // `download` event). id is the id the web sent; an unknown error reads as 'other', an unknown kind drops the event.
    downloadsAddFailed: { lenient: { error: 'other' }, fields: { kind: { enum: DOWNLOAD_KINDS.slice(), req: true }, id: { is: 'string', min: 1, max: 512, req: true }, error: { enum: DOWNLOAD_ERRORS.slice(), req: true } } },
    downloadsSnapshot: { fields: { items: { is: 'array', req: true, max: 10000, items: { is: 'object', props: downloadItemFields(), lenient: DOWNLOAD_LENIENT } } } },
    // v1.397.0 nativeAudio: a full snapshot on subscribe and on every real change (the web REPLACES its view; a rev older than
    // the web's last audio.load is dropped by native-audio.js), a small tick about once a second while playing, and an item
    // that failed. An unknown error reads as 'other'; an unknown state drops the snapshot (a required enum, like battery.state).
    audioState: {
      lenient: { error: 'other' },
      fields: {
        rev: { is: 'number', min: 0, req: true },
        queue: audioQueueSpec(),
        index: { is: 'number', min: 0, req: true },
        state: { enum: AUDIO_STATES.slice(), req: true },
        positionSec: { is: 'number', min: 0, req: true },
        durationSec: { is: 'number', min: 0, req: true },
        bufferedSec: { is: 'number', min: 0 },
        rate: AUDIO_RATE,
        modes: audioModesSpec(true),
        sleep: { is: 'object', req: true, props: { mode: { enum: AUDIO_SLEEP_MODES.slice(), req: true }, endsAt: { is: 'number', min: 0 } } },
        error: { enum: AUDIO_ERRORS.slice() },
      },
    },
    audioTick: { fields: { rev: { is: 'number', min: 0, req: true }, positionSec: { is: 'number', min: 0, req: true }, bufferedSec: { is: 'number', min: 0 } } },
    audioError: { lenient: { error: 'other' }, fields: { id: { is: 'string', min: 1, max: 512, req: true }, error: { enum: AUDIO_ERRORS.slice(), req: true } } },
  };

  function fieldOk(spec, v) {
    if (v === null) return !!spec.nullable;
    if (spec.eq !== undefined) return v === spec.eq;
    if (spec.enum) return spec.enum.indexOf(v) >= 0;
    if (spec.is === 'number') return typeof v === 'number' && isFinite(v) && (spec.min === undefined || v >= spec.min) && (spec.max === undefined || v <= spec.max);
    if (spec.is === 'string') return typeof v === 'string' && (spec.min === undefined || v.length >= spec.min) && (spec.max === undefined || v.length <= spec.max);
    if (spec.is === 'boolean') return typeof v === 'boolean';
    if (spec.is === 'object') return !!v && typeof v === 'object' && (!spec.props || fieldsOk(spec.props, v));
    // An array field: the length cap decides the field. On the way IN its ELEMENTS are sanitized one by one in `sanitize`
    // first (a bad element is dropped, never the whole event), so by the time this runs every element fits; on the way
    // OUT (a web-to-native message) nothing pre-cleans them, so each object element is judged against its props here and
    // one bad element drops the whole message (v1.397.0: a queue Item the web built wrong is never posted, and never
    // silently removed either - that would shift every index).
    if (spec.is === 'array') {
      if (!Array.isArray(v) || (spec.max !== undefined && v.length > spec.max)) return false;
      if (spec.items && spec.items.props) {
        for (var ai = 0; ai < v.length; ai++) { if (!fieldOk(spec.items, v[ai])) return false; }
      }
      return true;
    }
    return false;
  }
  function fieldsOk(fields, obj) {
    for (var k in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
      if (obj[k] === undefined) { if (fields[k].req) return false; continue; }
      if (!fieldOk(fields[k], obj[k])) return false;
    }
    return true;
  }
  // Only the fields the table names are copied (an unknown field never leaves the page).
  function pick(fields, obj) {
    var out = {};
    for (var k in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, k) || obj[k] === undefined) continue;
      var spec = fields[k];
      if (spec.is === 'object' && spec.props) out[k] = pick(spec.props, obj[k]);
      else if (spec.is === 'array' && spec.items && spec.items.props) {
        var arr = [];
        for (var i = 0; i < obj[k].length; i++) arr.push(pick(spec.items.props, obj[k][i]));
        out[k] = arr;
      } else out[k] = obj[k];
    }
    return out;
  }
  // One object against a field table: the lenient mapping (an unknown enum value reads as the named fallback), then
  // every OPTIONAL field that does not fit is dropped (never the whole object), then an array field's elements are
  // sanitized the same way (a bad element is dropped, never the array). Returns the cleaned copy, or null when a
  // REQUIRED field is missing or wrong. Shared by the top-level event and each snapshot element (v1.387.0).
  function sanitize(fields, lenient, d) {
    if (!d || typeof d !== 'object') return null;
    var c = {}; for (var ck in d) c[ck] = d[ck];
    if (lenient) {
      for (var lk in lenient) {
        if (Object.prototype.hasOwnProperty.call(lenient, lk) && typeof c[lk] === 'string' && fields[lk] && fields[lk].enum && fields[lk].enum.indexOf(c[lk]) < 0) c[lk] = lenient[lk];
      }
    }
    for (var ok in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, ok) || c[ok] === undefined) continue;
      var spec = fields[ok];
      if (spec.is === 'array' && spec.items && spec.items.props && Array.isArray(c[ok]) && (spec.max === undefined || c[ok].length <= spec.max)) {
        var kept = [];
        for (var i = 0; i < c[ok].length; i++) {
          var el = sanitize(spec.items.props, spec.items.lenient, c[ok][i]);
          if (el) kept.push(el);
        }
        c[ok] = kept;
      } else if (!spec.req && !fieldOk(spec, c[ok])) {
        delete c[ok];
      }
    }
    return fieldsOk(fields, c) ? c : null;
  }

  function create(win) {
    var raw = null;
    var caps = [];
    try {
      var h = win && win.FileTubeHost;
      if (h && typeof h === 'object' && h.bridge === 1 && typeof h.post === 'function' && Array.isArray(h.capabilities)) {
        raw = h;
        for (var i = 0; i < h.capabilities.length; i++) {
          if (CAPABILITIES.indexOf(h.capabilities[i]) >= 0 && caps.indexOf(h.capabilities[i]) < 0) caps.push(h.capabilities[i]);
        }
      }
    } catch (_) { raw = null; caps = []; }
    var present = !!raw;

    function warn(why, type) {
      try { if (win.__ftHostDebug === true && win.console) win.console.warn('[host-adapter] dropped ' + type + ': ' + why); } catch (_) { /* dev aid only */ }
    }
    function has(cap) { return present && caps.indexOf(cap) >= 0; }

    function post(type, fields) {
      if (!present) return false;
      try {
        var def = Object.prototype.hasOwnProperty.call(MESSAGES, type) ? MESSAGES[type] : null;
        if (!def) { warn('unknown type', type); return false; }
        if (def.cap && !has(def.cap)) { warn('capability not announced (' + def.cap + ')', type); return false; }
        var f = fields && typeof fields === 'object' ? fields : {};
        if (!fieldsOk(def.fields, f)) { warn('fields do not match the contract', type); return false; }
        var msg = pick(def.fields, f);
        msg.v = 1;
        msg.type = type;
        raw.post(msg);
        return true;
      } catch (_) { return false; }
    }

    function on(type, fn) {
      var noop = function () {};
      if (!present || typeof fn !== 'function' || !Object.prototype.hasOwnProperty.call(EVENTS, type)) return noop;
      var handler = function (ev) {
        try {
          var d = ev && ev.detail;
          if (!d || typeof d !== 'object' || d.v !== 1 || d.type !== type) return;
          // The lenient mapping, then an OPTIONAL field that does not fit is dropped, never the whole event (a bad
          // `constrained` must not swallow a real `connection` change and leave the page showing a stale value);
          // an array field's bad ELEMENT is dropped, never the array (v1.387.0).
          var clean = sanitize(EVENTS[type].fields, EVENTS[type].lenient, d);
          if (!clean) return;
          fn(pick(EVENTS[type].fields, clean));
        } catch (_) { /* a bad event or a throwing listener never breaks the page */ }
      };
      try { win.addEventListener('filetube-host', handler); } catch (_) { return noop; }
      return function () { try { win.removeEventListener('filetube-host', handler); } catch (_) { /* gone */ } };
    }

    // A home-screen PWA OR the native host: "an installed full-screen app" (D10). Computed per call.
    function standalone() {
      try {
        if (win.navigator && win.navigator.standalone === true) return true;
        if (typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches) return true;
      } catch (_) { /* no media queries */ }
      return false;
    }
    function appLike() { return present || standalone(); }
    // v1.391.0 (R1/R2): `mediaFetch` is a pure declaration (no messages, no events): "this host build may show the web's
    // server-side downloader UI". No host (every browser, the PWA) shows it as ever; a host shows it only when it announced
    // the capability. The App Store build leaves it out. Deliberately NOT the `downloads` capability (native offline copies).
    function allowsMediaFetch() { return !present || has('mediaFetch'); }

    // The app's identity from the injected host (schema `host.app`): name + version strings, build optional; null when no
    // host or malformed. v1.387.0 (Dean): the avatar menu shows "iOS app <version> (<build>)" inside the app.
    var appInfo = null;
    try {
      var a = raw && raw.app;
      if (a && typeof a === 'object' && typeof a.name === 'string' && a.name && typeof a.version === 'string' && VERSION_RE.test(a.version)) {
        appInfo = { name: a.name, version: a.version, build: typeof a.build === 'string' && /^[A-Za-z0-9._-]{1,32}$/.test(a.build) ? a.build : null };
      }
    } catch (_) { appInfo = null; }
    var host = {
      present: present,
      bridge: present ? 1 : 0,
      app: appInfo,
      has: has,
      post: post,
      on: on,
      appLike: appLike,
      allowsMediaFetch: allowsMediaFetch,
    };

    if (present) {
      var version = '';
      try {
        var m = win.document && win.document.querySelector('meta[name="ft-version"]');
        var v = m && m.getAttribute('content');
        if (typeof v === 'string' && VERSION_RE.test(v)) version = v;
      } catch (_) { /* no document */ }
      post('host.hello', { web: { version: version } });
    }
    return host;
  }

  var api = { create: create, MESSAGES: MESSAGES, EVENTS: EVENTS, CAPABILITIES: CAPABILITIES, DOWNLOAD_KINDS: DOWNLOAD_KINDS, DOWNLOAD_ITEM_KINDS: DOWNLOAD_ITEM_KINDS, DOWNLOAD_STATES: DOWNLOAD_STATES, DOWNLOAD_ERRORS: DOWNLOAD_ERRORS, AUDIO_KINDS: AUDIO_KINDS, AUDIO_PROGRESS_ROUTES: AUDIO_PROGRESS_ROUTES, AUDIO_STATES: AUDIO_STATES, AUDIO_ERRORS: AUDIO_ERRORS, AUDIO_SLEEP_MODES: AUDIO_SLEEP_MODES, AUDIO_QUEUE_MAX: AUDIO_QUEUE_MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) {
    root.FileTube = root.FileTube || {};
    if (!root.FileTube.host) root.FileTube.host = create(root);
  }
})(typeof window !== 'undefined' ? window : null);
