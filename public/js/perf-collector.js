/* perf-collector.js - the passive half of the perf-diagnostics suite
 * (branch exp/perf-diagnostics). This file is injected into EVERY app shell by
 * server.js's sendShellHtml when diagnostics are enabled (the
 * perfDiagnosticsEnabled setting, or FT_DIAG), so a soft-nav'd view can never
 * land on a shell that lacks it - the shell-parity trap. It is INERT unless a
 * run is active: the /diag control page arms a run by writing localStorage, and
 * this collector, on each shell load, notices that and records Resource /
 * Navigation timing + media events into a localStorage buffer keyed to the run.
 * localStorage (not memory) because navigating between sections (Home -> Music
 * -> TV) is a full DOCUMENT load that would wipe an in-memory buffer.
 *
 * The collector is deliberately DUMB: it records raw, timestamped events and
 * never computes the isolation matrix. The /diag page derives all metrics at
 * stop, so we can refine what "good" means without re-capturing.
 *
 * Shared localStorage bus (all keys namespaced ft_diag_*):
 *   ft_diag_active   {runId,label,startedAt,client}  - set by /diag; presence = record
 *   ft_diag_scenario "<name>"                         - current guided step; tags events
 *   ft_diag_events   [ ...event ]                      - appended here, read by /diag at stop
 */
(function () {
  'use strict';

  var KEY_ACTIVE = 'ft_diag_active';
  var KEY_SCENARIO = 'ft_diag_scenario';
  var KEY_EVENTS = 'ft_diag_events';
  var MAX_EVENTS = 6000; // a few minutes of scenarios is far under this; hard cap so we never blow the localStorage quota

  function readLS(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function active() {
    var raw = readLS(KEY_ACTIVE);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  var run = active();
  if (!run) return; // not armed - stay completely dark

  // ---- event buffer --------------------------------------------------------
  var buf = [];
  try { buf = JSON.parse(readLS(KEY_EVENTS) || '[]'); } catch (_) { buf = []; }
  var flushTimer = null;
  var badgeCount = buf.length;

  function currentScenario() {
    return readLS(KEY_SCENARIO) || '';
  }

  function push(ev) {
    if (buf.length >= MAX_EVENTS) return;
    ev.t = Date.now();
    ev.rel = Math.round(performance.now() * 10) / 10; // ms since THIS document's nav start
    ev.page = location.pathname;
    ev.scenario = currentScenario();
    buf.push(ev);
    badgeCount++;
    scheduleFlush();
    updateBadge();
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 400);
  }
  function flush() {
    flushTimer = null;
    try { localStorage.setItem(KEY_EVENTS, JSON.stringify(buf)); } catch (_) {}
  }
  // flush synchronously when the page is being torn down by a section nav
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);

  // ---- resource + navigation timing ---------------------------------------
  function timingFrom(e) {
    // Distil a PerformanceResourceTiming/NavigationTiming into the sub-phases
    // that let us attribute latency: DNS, connect, TLS, TTFB (server+queue),
    // download. serverTiming (our Server-Timing header) splits box vs pipe.
    var secure = e.secureConnectionStart && e.secureConnectionStart > 0;
    var st = [];
    if (e.serverTiming && e.serverTiming.length) {
      for (var i = 0; i < e.serverTiming.length; i++) {
        st.push({ name: e.serverTiming[i].name, dur: e.serverTiming[i].duration });
      }
    }
    return {
      name: (function () { try { return new URL(e.name).pathname + (new URL(e.name).search || ''); } catch (_) { return e.name; } })(),
      initiator: e.initiatorType,
      start: Math.round(e.startTime * 10) / 10,
      duration: Math.round(e.duration * 10) / 10,
      dns: round(e.domainLookupEnd - e.domainLookupStart),
      connect: round(e.connectEnd - e.connectStart),
      tls: secure ? round(e.connectEnd - e.secureConnectionStart) : 0,
      ttfb: round(e.responseStart - e.requestStart),
      download: round(e.responseEnd - e.responseStart),
      transferSize: e.transferSize || 0,
      encodedSize: e.encodedBodySize || 0,
      decodedSize: e.decodedBodySize || 0,
      protocol: e.nextHopProtocol || '',
      serverTiming: st,
    };
  }
  function round(n) { return (typeof n === 'number' && isFinite(n)) ? Math.round(n * 10) / 10 : 0; }

  function recordResource(e) {
    // ignore our own diag traffic so probes don't pollute the scenario capture
    if (e.name.indexOf('/api/diag/') !== -1 || e.name.indexOf('/diag') !== -1) return;
    push({ type: 'resource', data: timingFrom(e) });
  }

  try {
    var po = new PerformanceObserver(function (list) {
      list.getEntries().forEach(recordResource);
    });
    po.observe({ type: 'resource', buffered: true });
  } catch (_) {}

  // navigation timing for this shell load (captured once things settle)
  function recordNavigation() {
    try {
      var nav = performance.getEntriesByType('navigation')[0];
      if (!nav) return;
      var d = timingFrom(nav);
      d.domContentLoaded = round(nav.domContentLoadedEventEnd - nav.startTime);
      d.loadEvent = round(nav.loadEventEnd - nav.startTime);
      d.domInteractive = round(nav.domInteractive - nav.startTime);
      d.type = nav.type;
      push({ type: 'navigation', data: d });
    } catch (_) {}
  }
  if (document.readyState === 'complete') setTimeout(recordNavigation, 0);
  else window.addEventListener('load', function () { setTimeout(recordNavigation, 0); });

  // ---- media events (capture phase catches non-bubbling media events from
  //      ANY <video>/<audio>, including elements created/swapped later) -------
  var MEDIA_EVENTS = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay',
    'canplaythrough', 'play', 'playing', 'waiting', 'stalled', 'seeking',
    'seeked', 'pause', 'ended', 'error', 'ratechange'];
  MEDIA_EVENTS.forEach(function (name) {
    document.addEventListener(name, function (ev) {
      var el = ev.target;
      if (!el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO')) return;
      var src = '';
      try { src = (el.currentSrc || el.src || '').split('/').slice(-1)[0]; } catch (_) {}
      push({
        type: 'media',
        data: {
          event: name,
          tag: el.tagName,
          id: el.id || '',
          src: src,
          currentTime: round(el.currentTime),
          readyState: el.readyState,
          networkState: el.networkState,
          paused: el.paused,
          rate: el.playbackRate,
          err: (name === 'error' && el.error) ? el.error.code : undefined,
        },
      });
    }, true);
  });

  // ---- manual marks (from app code or the console) -------------------------
  window.__ftDiag = {
    active: function () { return active(); },
    mark: function (label, extra) { push({ type: 'mark', data: { label: String(label), extra: extra || null } }); },
    count: function () { return buf.length; },
    flush: flush,
  };

  // ---- tiny on-screen REC badge so it's obvious a capture is live ----------
  var badge;
  function updateBadge() {
    if (!badge) return;
    var sc = currentScenario();
    badge.textContent = 'REC ● diag' + (sc ? ' · ' + sc : '') + ' · ' + badgeCount;
  }
  function mountBadge() {
    if (badge) return;
    badge = document.createElement('div');
    badge.setAttribute('data-ft-diag-badge', '1');
    badge.style.cssText = 'position:fixed;' +
      'background:#b91c1c;color:#fff;font:600 11px/1.4 system-ui,sans-serif;' +
      'padding:3px 8px;border-radius:6px;pointer-events:none;opacity:.9;' +
      'box-shadow:0 1px 4px rgba(0,0,0,.4);letter-spacing:.02em;';
    // Governed props set individually so each carries the ratchet's escape
    // hatch: this is an injected, device-local diagnostic overlay that must be
    // self-contained (no shell tokens) and sit above ALL app chrome.
    badge.style.zIndex = '2147483647'; // token-exempt: diagnostic overlay must outrank all app z-layers
    badge.style.left = '8px'; // token-exempt: fixed-position dev badge offset (device-local diagnostic)
    badge.style.bottom = '8px'; // token-exempt: fixed-position dev badge offset (device-local diagnostic)
    (document.body || document.documentElement).appendChild(badge);
    updateBadge();
  }
  if (document.body) mountBadge();
  else window.addEventListener('DOMContentLoaded', mountBadge);
})();
