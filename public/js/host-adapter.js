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
  var CAPABILITIES = ['orientation', 'haptics', 'battery', 'serverSettings', 'statusBar', 'network'];

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
  };

  function fieldOk(spec, v) {
    if (v === null) return !!spec.nullable;
    if (spec.eq !== undefined) return v === spec.eq;
    if (spec.enum) return spec.enum.indexOf(v) >= 0;
    if (spec.is === 'number') return typeof v === 'number' && isFinite(v) && (spec.min === undefined || v >= spec.min) && (spec.max === undefined || v <= spec.max);
    if (spec.is === 'string') return typeof v === 'string';
    if (spec.is === 'boolean') return typeof v === 'boolean';
    if (spec.is === 'object') return !!v && typeof v === 'object' && (!spec.props || fieldsOk(spec.props, v));
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
      out[k] = (spec.is === 'object' && spec.props) ? pick(spec.props, obj[k]) : obj[k];
    }
    return out;
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
          var len = EVENTS[type].lenient;
          if (len) {
            for (var lk in len) {
              if (Object.prototype.hasOwnProperty.call(len, lk) && typeof d[lk] === 'string' && EVENTS[type].fields[lk].enum.indexOf(d[lk]) < 0) {
                var c = {}; for (var ck in d) c[ck] = d[ck]; c[lk] = len[lk]; d = c;
              }
            }
          }
          if (!fieldsOk(EVENTS[type].fields, d)) return;
          fn(pick(EVENTS[type].fields, d));
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

    var host = {
      present: present,
      bridge: present ? 1 : 0,
      has: has,
      post: post,
      on: on,
      appLike: appLike,
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

  var api = { create: create, MESSAGES: MESSAGES, EVENTS: EVENTS, CAPABILITIES: CAPABILITIES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) {
    root.FileTube = root.FileTube || {};
    if (!root.FileTube.host) root.FileTube.host = create(root);
  }
})(typeof window !== 'undefined' ? window : null);
