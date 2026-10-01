// v1.348 Listen Control - the TARGET side (the PC that another device plays music on).
//
// Loaded right after common.js in every in-app shell (never login/setup/welcome), so the stream
// survives in-app navigation: nothing here lives in #view-root. The pure decisions are exported
// separately from the runtime (createTarget) so jsdom tests can drive both with injected deps.
//
// Wire contract: lib/remote/routes.js. Opt-in is per tab: sessionStorage['ft-remote-target-on'].
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && root === window) {
    root.FileTube = root.FileTube || {};
    root.FileTube.remoteLib = api;
    root.FileTube.remote = api.createTarget(api.browserEnv(root));
    root.FileTube.remoteControl = api.createController(api.browserEnv(root));
    api.bootWhenReady(root, root.FileTube.remote, root.FileTube.remoteControl);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var STORAGE_KEY = 'ft-remote-target-on';
  var HELLO_TIMEOUT_MS = 5000;
  var POLL_MS = 1500;
  var REPORT_THROTTLE_MS = 500;
  var REPORT_EVERY_MS = 5000;
  var GRACE_MS = 10000;
  var NAVIGATE_TIMEOUT_MS = 8000;
  var BLOCKED_CHECK_MS = 900;

  // ---- pure decisions -----------------------------------------------------

  // What the PC reports: idle when nothing is loaded, else playing/paused (or blocked).
  function buildStatePayload(deviceId, snap, blocked) {
    var s = snap || {};
    var id = typeof s.id === 'string' && s.id ? s.id : null;
    var state = !id ? 'idle' : (blocked ? 'blocked' : (s.playing ? 'playing' : 'paused'));
    return {
      deviceId: deviceId,
      trackId: id,
      position: Number.isFinite(s.position) && s.position >= 0 ? s.position : 0,
      duration: Number.isFinite(s.duration) && s.duration >= 0 ? s.duration : 0,
      state: state,
      hasPrev: !!s.hasPrev,
      hasNext: !!s.hasNext
    };
  }

  // A play command needs the Music view's handler; where to get it.
  function playRoute(handlerReady) { return handlerReady ? 'now' : 'navigate'; }

  // The report timer's next delay: 0 = send now, else wait out the remainder of the throttle.
  function throttleDelay(now, lastAt) {
    var wait = lastAt + REPORT_THROTTLE_MS - now;
    return wait > 0 ? wait : 0;
  }

  // ---- runtime ------------------------------------------------------------

  function createTarget(env) {
    var on = false;
    var es = null;
    var helloTimer = null;
    var pollTimer = null;
    var graceTimer = null;
    var reportTimer = null;
    var heartbeat = null;
    var navTimer = null;
    var polling = false;
    var lastSeq = 0;
    var attached = false;
    var controllerLabel = '';
    var lastReportAt = -Infinity;
    var blocked = false;
    var musicHandler = null;
    var pendingPlay = null;
    var changeFns = [];
    var mediaBound = false;

    function notify() {
      for (var i = 0; i < changeFns.length; i++) { try { changeFns[i](on, attached, controllerLabel); } catch (_) { /* a listener must not break the channel */ } }
    }

    function player() { return env.player && env.player(); }

    function post(path, body, extra) {
      try {
        var init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' };
        if (extra) for (var k in extra) init[k] = extra[k];
        var p = env.fetch(path, init);
        if (p && p.catch) p.catch(function () { /* the next beat retries */ });
      } catch (_) { /* offline */ }
    }

    // ---- state reporting ----
    function sendState() {
      if (!on || !attached) return;
      var pl = player();
      if (!pl || !pl.getRemoteSnapshot) return;
      lastReportAt = env.now();
      post('/api/remote/state', buildStatePayload(env.deviceId(), pl.getRemoteSnapshot(), blocked));
    }
    function scheduleReport() {
      if (!on || !attached || reportTimer) return;
      var d = throttleDelay(env.now(), lastReportAt);
      reportTimer = env.setTimeout(function () { reportTimer = null; sendState(); }, d);
    }
    function syncHeartbeat() {
      var pl = player();
      var playing = !!(on && attached && pl && pl.getRemoteSnapshot && pl.getRemoteSnapshot().playing);
      if (playing && !heartbeat) heartbeat = env.setInterval(function () { sendState(); }, REPORT_EVERY_MS);
      else if (!playing && heartbeat) { env.clearInterval(heartbeat); heartbeat = null; }
    }
    function onMedia(e) {
      if (e && e.type === 'play') blocked = false;
      scheduleReport();
      syncHeartbeat();
    }
    function bindMedia() {
      if (mediaBound || !env.document) return;
      mediaBound = true;
      ['play', 'pause', 'seeked', 'ended', 'loadedmetadata', 'emptied'].forEach(function (t) {
        env.document.addEventListener(t, onMedia, true);
      });
    }
    function unbindMedia() {
      if (!mediaBound || !env.document) return;
      mediaBound = false;
      ['play', 'pause', 'seeked', 'ended', 'loadedmetadata', 'emptied'].forEach(function (t) {
        env.document.removeEventListener(t, onMedia, true);
      });
    }

    // ---- commands ----
    function runPlay(args) {
      var pl = player();
      if (!musicHandler) return;
      blocked = false;
      musicHandler({ tracks: args.tracks, index: args.index, label: controllerLabel });
      env.setTimeout(function () {
        if (!on) return;
        blocked = !!(pl && pl.autoStartRefused && pl.autoStartRefused());
        sendState();
        syncHeartbeat();
      }, BLOCKED_CHECK_MS);
    }
    function handleCommand(c) {
      if (!c || typeof c.seq !== 'number' || c.seq <= lastSeq) return;
      lastSeq = c.seq;
      var pl = player();
      var a = c.args || {};
      if (c.cmd === 'play') {
        if (!a || !Array.isArray(a.tracks) || !a.tracks.length || !(a.index >= 0 && a.index < a.tracks.length)) return;
        if (playRoute(!!musicHandler) === 'now') { runPlay(a); return; }
        pendingPlay = a;
        if (navTimer) env.clearTimeout(navTimer);
        navTimer = env.setTimeout(function () {
          navTimer = null;
          if (pendingPlay) { pendingPlay = null; attached && post('/api/remote/state', buildStatePayload(env.deviceId(), null, false)); }
        }, NAVIGATE_TIMEOUT_MS);
        try { env.navigate('/music'); } catch (_) { /* the timeout reports idle */ }
        return;
      }
      if (!pl) return;
      if (c.cmd === 'pause') pl.pause();
      else if (c.cmd === 'toggle') pl.togglePlay();
      else if (c.cmd === 'next') pl.next();
      else if (c.cmd === 'prev') pl.prev();
      else if (c.cmd === 'seek') pl.seek(a.position);
      else return;
      scheduleReport();
    }
    function handleController(d) {
      var was = attached;
      attached = !!(d && d.attached);
      controllerLabel = attached && d && typeof d.label === 'string' ? d.label : '';
      if (attached && !was) sendState();
      syncHeartbeat();
      notify();
    }

    // ---- transport (stream, then poll) ----
    function clearTimers() {
      [helloTimer, pollTimer, graceTimer, reportTimer, navTimer].forEach(function (t) { if (t) env.clearTimeout(t); });
      helloTimer = pollTimer = graceTimer = reportTimer = navTimer = null;
      if (heartbeat) { env.clearInterval(heartbeat); heartbeat = null; }
    }
    function closeStream() {
      if (es) { try { es.close(); } catch (_) { /* already closed */ } es = null; }
    }
    function pollOnce() {
      if (!on || !polling) return;
      var url = '/api/remote/poll?role=target&deviceId=' + encodeURIComponent(env.deviceId())
        + '&label=' + encodeURIComponent(env.label()) + '&since=' + lastSeq;
      var p;
      try { p = env.fetch(url, { credentials: 'same-origin' }); } catch (_) { p = null; }
      var next = function () { if (on && polling) pollTimer = env.setTimeout(pollOnce, POLL_MS); };
      if (!p || !p.then) { next(); return; }
      p.then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!on) return;
        if (graceTimer) { env.clearTimeout(graceTimer); graceTimer = null; }
        if (d) {
          if (typeof d.seq === 'number' && d.seq < lastSeq) lastSeq = d.seq;
          if (d.controller) handleController(d.controller);
          (d.commands || []).forEach(handleCommand);
        } else armGrace();
        next();
      }).catch(function () { armGrace(); next(); });
    }
    function armGrace() {
      if (graceTimer || !on) return;
      graceTimer = env.setTimeout(function () {
        graceTimer = null;
        if (on) { setOn(false, true); env.toast('Remote control turned off - lost the connection to the server'); }
      }, GRACE_MS);
    }
    function startPolling() {
      if (polling) return;
      polling = true;
      closeStream();
      pollOnce();
    }
    function openStream() {
      var url = '/api/remote/stream?role=target&deviceId=' + encodeURIComponent(env.deviceId())
        + '&label=' + encodeURIComponent(env.label());
      try { es = new env.EventSource(url); } catch (_) { startPolling(); return; }
      helloTimer = env.setTimeout(function () { helloTimer = null; startPolling(); }, HELLO_TIMEOUT_MS);
      es.addEventListener('hello', function (ev) {
        if (helloTimer) { env.clearTimeout(helloTimer); helloTimer = null; }
        try { var h = JSON.parse(ev.data); if (h && typeof h.seq === 'number' && h.seq < lastSeq) lastSeq = h.seq; } catch (_) { /* no seq */ }
        if (graceTimer) { env.clearTimeout(graceTimer); graceTimer = null; }
      });
      es.addEventListener('command', function (ev) {
        var d; try { d = JSON.parse(ev.data); } catch (_) { return; }
        handleCommand(d);
      });
      es.addEventListener('controller', function (ev) {
        var d; try { d = JSON.parse(ev.data); } catch (_) { return; }
        handleController(d);
      });
      es.addEventListener('replaced', function () {
        setOn(false, true);
        env.toast('Remote control moved to another tab');
      });
      es.onerror = function () { armGrace(); };
    }

    // ---- public ----
    function setOn(next, silent) {
      next = !!next;
      if (next === on) return;
      on = next;
      try { if (on) env.storage.setItem(STORAGE_KEY, '1'); else env.storage.removeItem(STORAGE_KEY); } catch (_) { /* private mode */ }
      if (on) {
        lastSeq = 0; polling = false; attached = false;
        bindMedia();
        openStream();
      } else {
        if (!silent) post('/api/remote/off', { deviceId: env.deviceId() });
        closeStream(); clearTimers(); unbindMedia();
        polling = false; attached = false; controllerLabel = ''; pendingPlay = null; blocked = false;
      }
      notify();
    }
    function setMusicPlayHandler(fn) {
      musicHandler = typeof fn === 'function' ? fn : null;
      if (musicHandler && pendingPlay) {
        var a = pendingPlay;
        pendingPlay = null;
        if (navTimer) { env.clearTimeout(navTimer); navTimer = null; }
        runPlay(a);
      }
    }
    // The server learns this device's label when the stream opens (and on each poll), so a renamed
    // device reopens its stream to tell it; polling already sends the current label every beat.
    function relabel() {
      if (!on || polling || !es) return;
      if (helloTimer) { env.clearTimeout(helloTimer); helloTimer = null; }
      closeStream();
      openStream();
    }
    function pagehide() {
      if (on) post('/api/remote/off', { deviceId: env.deviceId() }, { keepalive: true });
    }

    return {
      isOn: function () { return on; },
      isControlled: function () { return on && attached; },
      controllerLabel: function () { return controllerLabel; },
      setOn: function (v) { setOn(v, false); },
      toggle: function () { setOn(!on, false); },
      setMusicPlayHandler: setMusicPlayHandler,
      onChange: function (fn) {
        if (typeof fn !== 'function') return function () {};
        changeFns.push(fn);
        return function () { var i = changeFns.indexOf(fn); if (i >= 0) changeFns.splice(i, 1); };
      },
      pagehide: pagehide,
      relabel: relabel,
      _handleCommand: handleCommand
    };
  }

  // ---- the CONTROLLER side (the phone): Play on... ------------------------

  var CONTROL_KEY = 'ft-remote-controlling';
  var CONTROL_POLL_MS = 2000;
  var SEEK_THROTTLE_MS = 250;
  var PLAY_MAX_IDS = 2000;

  // D6: a play command carries at most PLAY_MAX_IDS ids; a longer list sends the slice that starts at the
  // picked index (index 0 of the slice).
  function slicePlay(ids, index) {
    var list = Array.isArray(ids) ? ids : [];
    var i = Number.isInteger(index) && index >= 0 ? index : 0;
    if (list.length <= PLAY_MAX_IDS) return { ids: list, index: i };
    return { ids: list.slice(i, i + PLAY_MAX_IDS), index: 0 };
  }

  // The PC's position now: the report's position, plus the time since it was taken while it plays.
  function interpolatePosition(state, receivedAt, now) {
    var s = state || {};
    var pos = Number.isFinite(s.position) ? s.position : 0;
    if (s.state === 'playing') {
      pos += ((Number.isFinite(s.ageMs) ? s.ageMs : 0) + Math.max(0, now - receivedAt)) / 1000;
    }
    if (Number.isFinite(s.duration) && s.duration > 0 && pos > s.duration) pos = s.duration;
    return pos < 0 ? 0 : pos;
  }

  function createController(env) {
    var targetId = '';
    var label = '';
    var last = null;
    var receivedAt = 0;
    var es = null;
    var helloTimer = null;
    var pollTimer = null;
    var polling = false;
    var changeFns = [];
    var seekTimer = null;
    var seekLastAt = -Infinity;
    var seekPending = null;
    var streamWanted = false;

    function notify() {
      for (var i = 0; i < changeFns.length; i++) { try { changeFns[i](!!targetId, label, last); } catch (_) { /* a listener must not break the channel */ } }
    }
    function store(id, lbl) {
      try {
        if (id) env.storage.setItem(CONTROL_KEY, JSON.stringify({ deviceId: id, label: lbl }));
        else env.storage.removeItem(CONTROL_KEY);
      } catch (_) { /* private mode */ }
    }
    function closeStream() {
      if (es) { try { es.close(); } catch (_) { /* already closed */ } es = null; }
      if (helloTimer) { env.clearTimeout(helloTimer); helloTimer = null; }
      if (pollTimer) { env.clearTimeout(pollTimer); pollTimer = null; }
      polling = false;
    }
    function setState(s) {
      if (!s || typeof s !== 'object') return;
      last = s;
      receivedAt = env.now();
      notify();
    }
    function lost() {
      var was = label;
      leave(true);
      env.toast('Lost ' + (was || 'the PC'));
    }
    function pollOnce() {
      pollTimer = null;
      if (!targetId || !polling) return;
      var url = '/api/remote/poll?role=controller&deviceId=' + encodeURIComponent(env.deviceId())
        + '&target=' + encodeURIComponent(targetId) + '&label=' + encodeURIComponent(env.label());
      var p;
      try { p = env.fetch(url, { credentials: 'same-origin' }); } catch (_) { p = null; }
      var again = function () { if (targetId && polling) pollTimer = env.setTimeout(pollOnce, CONTROL_POLL_MS); };
      if (!p || !p.then) { again(); return; }
      p.then(function (r) {
        if (r.status === 404 || r.status === 410) { lost(); return null; }
        return r.ok ? r.json() : null;
      }).then(function (d) {
        if (d && d.state && targetId) setState(d.state);
        again();
      }).catch(function () { again(); });
    }
    function startPolling() {
      if (polling || !targetId) return;
      closeStream();
      polling = true;
      pollOnce();
    }
    function openStream() {
      closeStream();
      if (!targetId || !streamWanted) return;
      var url = '/api/remote/stream?role=controller&deviceId=' + encodeURIComponent(env.deviceId())
        + '&target=' + encodeURIComponent(targetId) + '&label=' + encodeURIComponent(env.label());
      try { es = new env.EventSource(url); } catch (_) { startPolling(); return; }
      helloTimer = env.setTimeout(function () { helloTimer = null; startPolling(); }, HELLO_TIMEOUT_MS);
      es.addEventListener('hello', function () { if (helloTimer) { env.clearTimeout(helloTimer); helloTimer = null; } });
      es.addEventListener('state', function (ev) {
        var d; try { d = JSON.parse(ev.data); } catch (_) { return; }
        setState(d);
      });
      es.addEventListener('target-gone', function () { lost(); });
      es.onerror = function () { if (es && es.readyState === 2) startPolling(); };
    }

    function select(target) {
      if (!target || !target.deviceId) return;
      closeStream();
      targetId = target.deviceId;
      label = target.label || 'PC';
      last = target.state || null;
      receivedAt = env.now();
      streamWanted = true;
      store(targetId, label);
      openStream();
      notify();
    }
    function leave(silent) {
      closeStream();
      if (seekTimer) { env.clearTimeout(seekTimer); seekTimer = null; }
      seekPending = null;
      streamWanted = false;
      var was = !!targetId;
      targetId = ''; label = ''; last = null;
      store('', '');
      if (was || !silent) notify();
    }
    function restore() {
      var raw = null;
      try { raw = env.storage.getItem(CONTROL_KEY); } catch (_) { raw = null; }
      if (!raw) return;
      var t = null;
      try { t = JSON.parse(raw); } catch (_) { t = null; }
      if (!t || !t.deviceId) { store('', ''); return; }
      targetId = t.deviceId; label = t.label || 'PC'; last = null; receivedAt = env.now();
      streamWanted = true;
      // The target may have gone while this page was away: ask before trusting the stored key.
      fetchTargets().then(function (list) {
        if (!targetId) return;
        var hit = list.filter(function (x) { return x.deviceId === targetId; })[0];
        if (!hit) { lost(); return; }
        label = hit.label || label; last = hit.state || null; receivedAt = env.now();
        openStream();
        notify();
      }).catch(function () { openStream(); });
      notify();
    }
    function fetchTargets() {
      var url = '/api/remote/targets?deviceId=' + encodeURIComponent(env.deviceId());
      return env.fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : []; }).then(function (l) { return Array.isArray(l) ? l : []; });
    }

    // One command; a 410 means the PC is gone.
    function send(cmd, args) {
      if (!targetId) return Promise.resolve(false);
      var body = { fromDeviceId: env.deviceId(), targetDeviceId: targetId, cmd: cmd, args: args || {} };
      var p;
      try { p = env.fetch('/api/remote/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' }); } catch (_) { return Promise.resolve(false); }
      return p.then(function (r) {
        if (r.status === 410) { lost(); return false; }
        return r.ok;
      }).catch(function () { return false; });
    }
    function play(ids, index) {
      var s = slicePlay(ids, index);
      return send('play', { ids: s.ids, index: s.index });
    }
    // Scrubbing sends at most one seek per SEEK_THROTTLE_MS; the last position always goes out.
    function seek(sec) {
      if (!targetId) return;
      seekPending = sec;
      if (last) { last = Object.assign({}, last, { position: sec, ageMs: 0 }); receivedAt = env.now(); } // the bar holds where it was dragged until the PC reports
      var wait = seekLastAt + SEEK_THROTTLE_MS - env.now();
      if (wait <= 0 && !seekTimer) { flushSeek(); return; }
      if (!seekTimer) seekTimer = env.setTimeout(function () { seekTimer = null; flushSeek(); }, wait > 0 ? wait : 0);
    }
    function flushSeek() {
      if (seekPending === null || !targetId) return;
      var pos = seekPending;
      seekPending = null;
      seekLastAt = env.now();
      send('seek', { position: pos });
    }
    function visibility(hidden) {
      if (!targetId) return;
      if (hidden) { closeStream(); return; }
      fetchTargets().then(function (list) {
        if (!targetId) return;
        var hit = list.filter(function (x) { return x.deviceId === targetId; })[0];
        if (!hit) { lost(); return; }
        last = hit.state || last; receivedAt = env.now();
        openStream();
        notify();
      }).catch(function () { openStream(); });
    }

    return {
      isRemote: function () { return !!targetId; },
      targetId: function () { return targetId; },
      label: function () { return label; },
      state: function () { return last; },
      position: function () { return interpolatePosition(last, receivedAt, env.now()); },
      fetchTargets: fetchTargets,
      select: select,
      leave: function () { leave(false); },
      restore: restore,
      send: send,
      play: play,
      toggle: function () { return send('toggle'); },
      next: function () { return send('next'); },
      prev: function () { return send('prev'); },
      seek: seek,
      visibility: visibility,
      onChange: function (fn) {
        if (typeof fn !== 'function') return function () {};
        changeFns.push(fn);
        return function () { var i = changeFns.indexOf(fn); if (i >= 0) changeFns.splice(i, 1); };
      }
    };
  }

  // ---- the pill: "Controlled by <label>" + Stop --------------------------

  function mountPill(doc, remote, ui) {
    var pill = doc.createElement('div');
    pill.id = 'remote-pill';
    pill.setAttribute('role', 'status');
    pill.hidden = true;
    var text = doc.createElement('span');
    text.className = 'remote-pill-text';
    var stop = ui.button({ variant: 'tonal', size: 'sm', label: 'Stop' });
    stop.addEventListener('click', function () { remote.setOn(false); });
    pill.append(text, stop);
    doc.body.appendChild(pill);
    remote.onChange(function (on, attached, label) {
      var show = !!(on && attached);
      pill.hidden = !show;
      text.textContent = show ? 'Controlled by ' + (label || 'another device') : '';
    });
    return pill;
  }

  function browserEnv(w) {
    return {
      fetch: function (u, i) { return w.fetch(u, i); },
      EventSource: w.EventSource,
      document: w.document,
      storage: w.sessionStorage,
      now: function () { return Date.now(); },
      setTimeout: function (f, ms) { return w.setTimeout(f, ms); },
      clearTimeout: function (t) { return w.clearTimeout(t); },
      setInterval: function (f, ms) { return w.setInterval(f, ms); },
      clearInterval: function (t) { return w.clearInterval(t); },
      deviceId: function () { return w.FileTube.getDeviceId(); },
      label: function () { return w.FileTube.getDeviceLabel(); },
      player: function () { return w.FileTube.player; },
      navigate: function (u) { return w.FileTube.navigate(u); },
      toast: function (m) { if (typeof w.showToast === 'function') w.showToast(m); }
    };
  }

  function bootWhenReady(w, remote, control) {
    function boot() {
      try {
        if (w.ui && w.document.body) mountPill(w.document, remote, w.ui);
        if (w.sessionStorage.getItem(STORAGE_KEY) === '1') remote.setOn(true);
      } catch (_) { /* sessionStorage blocked: the switch still works for this page */ }
      w.addEventListener('pagehide', function () { remote.pagehide(); });
      // Another tab of this browser renamed the device (Settings > Account): tell the server.
      w.addEventListener('storage', function (e) { if (e && e.key === 'ft-device-name') remote.relabel(); });
      if (control) {
        try { control.restore(); } catch (_) { /* storage blocked */ }
        w.document.addEventListener('visibilitychange', function () { control.visibility(w.document.visibilityState === 'hidden'); });
      }
    }
    if (w.document.readyState === 'loading') w.document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    buildStatePayload: buildStatePayload,
    playRoute: playRoute,
    throttleDelay: throttleDelay,
    createTarget: createTarget,
    createController: createController,
    slicePlay: slicePlay,
    interpolatePosition: interpolatePosition,
    CONTROL_KEY: CONTROL_KEY,
    PLAY_MAX_IDS: PLAY_MAX_IDS,
    mountPill: mountPill,
    browserEnv: browserEnv,
    bootWhenReady: bootWhenReady
  };
});
