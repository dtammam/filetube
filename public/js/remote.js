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
    // v1.352 W1: read and strip ?remote=on NOW, while this script runs and before the router's boot
    // (common.js, on DOMContentLoaded) records the URL in history.state and its current-view url.
    var fromLink = api.consumeRemoteParam(root);
    api.bootWhenReady(root, root.FileTube.remote, root.FileTube.remoteControl, fromLink);
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
  // v1.352 W0: the first input that can give a page user activation (a browser lifts its no-sound rule then)
  var ACTIVATION_EVENTS = ['pointerdown', 'pointerup', 'keydown', 'click'];

  // ---- pure decisions -----------------------------------------------------

  // What the PC reports: idle when nothing is loaded, else playing/paused (or blocked). needsClick
  // (v1.352 W0): this tab has had no click or key yet, so the browser will refuse to start sound.
  // volume/muted (v1.353): the player volume the phone's Volume bar shows, rounded to 2 places; a
  // player that cannot say reports no volume (null), never a made-up one.
  // v1.354 (R3): the PC's queue, cut to 100 before the current song and 100 after it. `list` holds ids or
  // library items ({id, listen}); a listen (video) item and anything without an id is left out and the index
  // follows its song. null when the current song is not music with an id (nothing to show).
  var QUEUE_AROUND = 100;
  function queueWindow(list, index) {
    if (!Array.isArray(list) || !Number.isInteger(index) || index < 0 || index >= list.length) return null;
    var lo = Math.max(0, index - QUEUE_AROUND);
    var hi = Math.min(list.length, index + QUEUE_AROUND + 1);
    var ids = [];
    var at = -1;
    for (var i = lo; i < hi; i++) {
      var x = list[i];
      var id = typeof x === 'string' ? x : (x && !x.listen && typeof x.id === 'string' ? x.id : null);
      if (!id) continue;
      if (i === index) at = ids.length;
      ids.push(id);
    }
    return at < 0 ? null : { ids: ids, index: at };
  }
  function buildStatePayload(deviceId, snap, blocked, needsClick, queue) {
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
      hasNext: !!s.hasNext,
      needsClick: !!needsClick,
      volume: Number.isFinite(s.volume) ? Math.round(Math.min(1, Math.max(0, s.volume)) * 100) / 100 : null,
      muted: s.muted === true,
      queue: queue && Array.isArray(queue.ids) ? queue : null
    };
  }

  // v1.352 W0: true only when the browser says the page has never been clicked or typed in. A browser
  // without navigator.userActivation reports false. A tab allowed to play without a click is cleared
  // when its sound starts (onPlaying); until then it may show the hint once.
  function needsClickNow(ua) {
    return !!(ua && ua.hasBeenActive === false);
  }

  // v1.352 W1: a bookmark (or kiosk launch) of any in-app page with ?remote=on turns this tab into a
  // speaker. Only the exact value 'on' acts; there is no ?remote=off (no link may stop a speaker).
  function wantsRemoteOn(search) {
    try { return new URLSearchParams(typeof search === 'string' ? search : '').get('remote') === 'on'; } catch (_) { return false; }
  }

  // The remote param leaves the address bar (and history.state.url, which the router replays), every
  // other param and state key kept. Returns whether the link asked for On.
  function consumeRemoteParam(w) {
    var on = false;
    try {
      var loc = w.location;
      on = wantsRemoteOn(loc.search);
      var params = new URLSearchParams(loc.search);
      if (!params.has('remote')) return on;
      params.delete('remote');
      var qs = params.toString();
      var url = loc.pathname + (qs ? '?' + qs : '') + (loc.hash || '');
      var prev = w.history.state;
      w.history.replaceState(prev ? Object.assign({}, prev, { url: loc.pathname + (qs ? '?' + qs : '') }) : prev, '', url);
    } catch (_) { /* history unavailable: the URL keeps the param, the link still acts */ }
    return on;
  }

  // v1.352 (Dean: "the named chapter doesn't change on device when controlling on mobile"): a chaptered
  // file plays as ONE load whose id is the PICKED chapter (`<file>::c<n>`), and the Music view rolls the
  // chapter on screen as the playhead crosses a boundary (music.js reflectChapter, no reload). The id
  // this PC reports is the chapter the view says is playing, but only a chapter OF THE LOADED FILE:
  // anything else (a stale view, another file) keeps the player's own id.
  function reportedTrackId(loadedId, viewId) {
    if (typeof loadedId !== 'string' || !loadedId) return loadedId || null;
    if (typeof viewId !== 'string' || !/::c\d+$/.test(viewId)) return loadedId;
    return viewId.replace(/::c\d+$/, '') === loadedId.replace(/::c\d+$/, '') ? viewId : loadedId;
  }

  // A play command needs the Music view's handler; where to get it.
  function playRoute(handlerReady) { return handlerReady ? 'now' : 'navigate'; }

  // The report timer's next delay: 0 = send now, else wait out the remainder of the throttle.
  function throttleDelay(now, lastAt) {
    var wait = lastAt + REPORT_THROTTLE_MS - now;
    return wait > 0 ? wait : 0;
  }

  // The element events that change what the PC reports (v1.353: volumechange, so a change made AT the PC,
  // its own slider or keys, reaches the phone's Volume bar).
  var MEDIA_EVENTS = ['play', 'pause', 'seeked', 'ended', 'loadedmetadata', 'emptied', 'volumechange'];

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
    var needsClick = false;
    var musicHandler = null;
    var nowPlayingId = null; // the Music view's chapter-on-screen reader (setNowPlayingResolver)
    var queueReader = null; // v1.354: the Music view's queue reader (setQueueReader)
    var pendingPlay = null;
    var changeFns = [];
    var mediaBound = false;

    function notify() {
      for (var i = 0; i < changeFns.length; i++) { try { changeFns[i](on, attached, controllerLabel, needsClick); } catch (_) { /* a listener must not break the channel */ } }
    }

    function player() { return env.player && env.player(); }
    function readNeedsClick() {
      var ua = null;
      try { ua = env.userActivation ? env.userActivation() : null; } catch (_) { ua = null; }
      return needsClickNow(ua);
    }
    // blocked is the player's own refused-autostart flag, read at every report: it is raised on a
    // NotAllowedError and lowered by the element's play and by the next load (player.js).
    function isBlocked(pl) {
      return !!(pl && pl.autoStartRefused && pl.autoStartRefused());
    }

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
      var cleared = needsClick && !readNeedsClick(); // an input type the listeners do not see still counts
      if (cleared) needsClick = false;
      var snap = pl.getRemoteSnapshot() || {};
      var viewId = null;
      try { viewId = nowPlayingId ? nowPlayingId() : null; } catch (_) { viewId = null; }
      var id = reportedTrackId(snap.id, viewId);
      if (id !== snap.id) snap = Object.assign({}, snap, { id: id });
      var q = null;
      try { var qr = queueReader ? queueReader() : null; q = qr ? queueWindow(qr.list, qr.index) : null; } catch (_) { q = null; }
      post('/api/remote/state', buildStatePayload(env.deviceId(), snap, isBlocked(pl), needsClick, q));
      if (cleared) notify();
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
    function onMedia() {
      scheduleReport();
      syncHeartbeat();
    }
    // v1.352 W0: the player raised or lowered its refused-autostart flag (player.js setAutoStartRefused).
    // Reported at once, however long the load took to reach its play().
    function onAutostart() {
      sendState();
      syncHeartbeat();
    }
    // v1.352 gate r1 (qa W1 = adversary W1, measured): sound that actually started proves the browser
    // lets this tab play (a kiosk flag, an allow-autoplay site setting, Chrome's engagement allowance),
    // so the click hint goes even though the page was never clicked.
    // gate r2 (qa S-A, measured): only AUDIBLE sound counts; a muted element (Home's hover previews) may
    // play with no click under Chrome's default policy and proves nothing about sound.
    function onPlaying(e) {
      if (!on || !needsClick) return;
      var el = e && e.target;
      if (el && (el.muted || el.volume === 0)) return;
      needsClick = false;
      sendState();
      notify();
    }
    // v1.353: a volume change that makes PLAYING sound audible is the same proof as onPlaying (a kiosk
    // that started at volume 0, or muted, and the phone turns it up): the click hint goes.
    function onVolume(e) {
      onMedia();
      var el = e && e.target;
      if (el && el.paused === false) onPlaying(e);
    }
    // The first click or key since load: the browser now lets this tab start sound.
    function onActivation() {
      if (!needsClick) return;
      // the activation is granted while this input dispatches; read it once the dispatch is over
      env.setTimeout(function () {
        if (!on || !needsClick || readNeedsClick()) return;
        needsClick = false;
        sendState();
        notify();
      }, 0);
    }
    function bindMedia() {
      if (mediaBound || !env.document) return;
      mediaBound = true;
      MEDIA_EVENTS.forEach(function (t) {
        env.document.addEventListener(t, t === 'volumechange' ? onVolume : onMedia, true);
      });
      env.document.addEventListener('filetube:autostart', onAutostart);
      env.document.addEventListener('playing', onPlaying, true);
      ACTIVATION_EVENTS.forEach(function (t) { env.document.addEventListener(t, onActivation, true); });
    }
    function unbindMedia() {
      if (!mediaBound || !env.document) return;
      mediaBound = false;
      MEDIA_EVENTS.forEach(function (t) {
        env.document.removeEventListener(t, t === 'volumechange' ? onVolume : onMedia, true);
      });
      env.document.removeEventListener('filetube:autostart', onAutostart);
      env.document.removeEventListener('playing', onPlaying, true);
      ACTIVATION_EVENTS.forEach(function (t) { env.document.removeEventListener(t, onActivation, true); });
    }

    // ---- commands ----
    // A refused start is reported by onAutostart when the player raises its flag, not by a timer here.
    function runPlay(args) {
      if (!musicHandler) return;
      musicHandler({ tracks: args.tracks, index: args.index, label: controllerLabel });
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
          if (!pendingPlay) return;
          pendingPlay = null;
          // idle (the Music view never came), but the volume is still this PC's (v1.353: every carrier)
          var ps = null;
          try { var p2 = player(); ps = p2 && p2.getRemoteSnapshot ? p2.getRemoteSnapshot() : null; } catch (_) { ps = null; }
          if (attached) post('/api/remote/state', buildStatePayload(env.deviceId(), ps ? { volume: ps.volume, muted: ps.muted } : null, false, needsClick));
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
      else if (c.cmd === 'volume') { if (typeof pl.setVolume === 'function') pl.setVolume(a.level); }
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
        needsClick = readNeedsClick();
        bindMedia();
        openStream();
      } else {
        if (!silent) post('/api/remote/off', { deviceId: env.deviceId() });
        closeStream(); clearTimers(); unbindMedia();
        polling = false; attached = false; controllerLabel = ''; pendingPlay = null; needsClick = false;
      }
      notify();
    }
    // The Music view registers its chapter-on-screen reader, and pings when the chapter rolls over.
    function setNowPlayingResolver(fn) { nowPlayingId = typeof fn === 'function' ? fn : null; }
    // v1.354: the Music view registers a reader of its queue: () => { list, index } | null
    function setQueueReader(fn) { queueReader = typeof fn === 'function' ? fn : null; }
    function trackChanged() { scheduleReport(); }
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
      needsClick: function () { return on && needsClick; },
      controllerLabel: function () { return controllerLabel; },
      setOn: function (v) { setOn(v, false); },
      toggle: function () { setOn(!on, false); },
      setMusicPlayHandler: setMusicPlayHandler,
      setNowPlayingResolver: setNowPlayingResolver,
      setQueueReader: setQueueReader,
      trackChanged: trackChanged,
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

  // ---- the CONTROLLER side (the phone): Speakers ------------------------

  var CONTROL_KEY = 'ft-remote-controlling';
  var CONTROL_POLL_MS = 2000;
  var SEEK_THROTTLE_MS = 250;
  var VOLUME_THROTTLE_MS = 250; // v1.353 (R4): at most one volume command per 250 ms, the last level always sent
  // A level this device just set holds on screen this long, so a PC report sent BEFORE the command
  // landed (the 500 ms report throttle) cannot snap the bar back mid-turn.
  var VOLUME_HOLD_MS = 1500;
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
    var volTimer = null;
    var volLastAt = -Infinity;
    var volPending = null;
    var volHeld = null;   // {level, at}: the level the wheel set, shown until the PC reports it or the hold ends
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
    // A level above 0 un-mutes the PC (player.setVolume, the slider's rule), so the shown state does too.
    function heldFields(lv, s) { return lv > 0 ? { volume: lv, muted: false } : { volume: lv, muted: !!(s && s.muted) }; }
    // The PC's report, with a level this device set in the last VOLUME_HOLD_MS kept on top of it.
    function withHeldVolume(s) {
      if (!volHeld) return s;
      if (env.now() - volHeld.at > VOLUME_HOLD_MS || s.volume === volHeld.level) { volHeld = null; return s; }
      return Object.assign({}, s, heldFields(volHeld.level, s));
    }
    function setState(s) {
      if (!s || typeof s !== 'object') return;
      s = withHeldVolume(s);
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

    // The throttled seek and volume and the held level belong to the speaker they were meant for (gate r1,
    // qa W1 = adversary W1, measured: a switch straight to another PC sent A's level to B and showed it there).
    function dropPending() {
      if (seekTimer) { env.clearTimeout(seekTimer); seekTimer = null; }
      seekPending = null;
      if (volTimer) { env.clearTimeout(volTimer); volTimer = null; }
      volPending = null; volHeld = null;
    }
    function select(target) {
      if (!target || !target.deviceId) return;
      closeStream();
      dropPending();
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
      dropPending();
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
    // v1.353 (R4, the seek throttle's twin): the wheel sends at most one volume per VOLUME_THROTTLE_MS and
    // the last level always goes out; the shown level is this one until the PC reports it.
    function volume(level) {
      if (!targetId || typeof level !== 'number' || !isFinite(level)) return;
      var lv = Math.round(Math.min(1, Math.max(0, level)) * 100) / 100;
      volPending = lv;
      volHeld = { level: lv, at: env.now() };
      if (last) last = Object.assign({}, last, heldFields(lv, last));
      notify();
      var wait = volLastAt + VOLUME_THROTTLE_MS - env.now();
      if (wait <= 0 && !volTimer) { flushVolume(); return; }
      if (!volTimer) volTimer = env.setTimeout(function () { volTimer = null; flushVolume(); }, wait > 0 ? wait : 0);
    }
    function flushVolume() {
      if (volPending === null || !targetId) return;
      var lv = volPending;
      volPending = null;
      volLastAt = env.now();
      if (volHeld) volHeld.at = env.now(); // the hold runs from the SEND, not the turn
      send('volume', { level: lv });
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
      volume: volume,
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
    remote.onChange(function (on, attached, label, needsClick) {
      // v1.352 W0: a tab that has never been clicked cannot start sound; say so on the PC itself.
      var click = !!(on && needsClick);
      var show = click || !!(on && attached);
      pill.hidden = !show;
      text.textContent = click ? 'Click anywhere so your phone can play music here'
        : (show ? 'Controlled by ' + (label || 'another device') : '');
    });
    return pill;
  }

  // A browser that blocks site storage throws on the sessionStorage getter itself: the switch then
  // lives for this page only (v1.352 W1: a ?remote=on link still turns it on).
  function safeSessionStorage(w) {
    try { if (w.sessionStorage) return w.sessionStorage; } catch (_) { /* blocked */ }
    return { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
  }

  function browserEnv(w) {
    return {
      fetch: function (u, i) { return w.fetch(u, i); },
      EventSource: w.EventSource,
      document: w.document,
      storage: safeSessionStorage(w),
      now: function () { return Date.now(); },
      setTimeout: function (f, ms) { return w.setTimeout(f, ms); },
      clearTimeout: function (t) { return w.clearTimeout(t); },
      setInterval: function (f, ms) { return w.setInterval(f, ms); },
      clearInterval: function (t) { return w.clearInterval(t); },
      deviceId: function () { return w.FileTube.getDeviceId(); },
      label: function () { return w.FileTube.getDeviceLabel(); },
      player: function () { return w.FileTube.player; },
      userActivation: function () { return (w.navigator && w.navigator.userActivation) || null; },
      navigate: function (u) { return w.FileTube.navigate(u); },
      toast: function (m) { if (typeof w.showToast === 'function') w.showToast(m); }
    };
  }

  var LINK_TOAST = 'Remote control is on: your other devices can play music here';
  // The device class music-skins.js sets once at load (it loads before this script on every shell).
  function isPhoneDoc(doc) {
    try { return !!(doc && doc.documentElement && doc.documentElement.classList.contains('is-phone')); } catch (_) { return false; }
  }

  function bootWhenReady(w, remote, control, fromLink) {
    function boot() {
      try {
        if (w.ui && w.document.body) mountPill(w.document, remote, w.ui);
      } catch (_) { /* no pill: the switch still works */ }
      // v1.352 gate r1 (qa W2, Dean's ruling): a phone is a controller, never a target (it has no Remote
      // control button to turn it off), so on a phone the link is stripped and does nothing.
      if (fromLink && !isPhoneDoc(w.document)) {
        // setOn writes the per-tab flag (a reload keeps it On) and swallows a blocked sessionStorage
        remote.setOn(true);
        if (remote.isOn() && typeof w.showToast === 'function') w.showToast(LINK_TOAST);
      }
      try {
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
    reportedTrackId: reportedTrackId,
    wantsRemoteOn: wantsRemoteOn,
    consumeRemoteParam: consumeRemoteParam,
    LINK_TOAST: LINK_TOAST,
    needsClickNow: needsClickNow,
    queueWindow: queueWindow,
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
