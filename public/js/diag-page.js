/* diag-page.js - the control logic for /diag (branch exp/perf-diagnostics).
 * Owns the localStorage bus shared with perf-collector.js, the active probes,
 * the run lifecycle (arm -> record via the collector -> stop/POST), and the
 * derivation of the isolation matrix from a saved run's raw events.
 *
 * The division of labour: the COLLECTOR (on app shells) only records raw
 * timestamped events; THIS page computes every metric, so "what good looks
 * like" can be re-derived from old captures without re-measuring.
 */
(function () {
  'use strict';

  var KEY_ACTIVE = 'ft_diag_active';
  var KEY_SCENARIO = 'ft_diag_scenario';
  var KEY_EVENTS = 'ft_diag_events';
  var KEY_PROBES = 'ft_diag_probes';

  var SCENARIOS = [
    { key: 'cold-load-home', title: 'Cold app load -> Home', desc: 'Open FileTube fresh in the app tab (or hard-reload). Wait until Home fully populates.' },
    { key: 'nav-home-to-music', title: 'Soft-nav: Home -> Music', desc: 'Inside the app, navigate Home to Music (same-section view swap).' },
    { key: 'nav-cross-section', title: 'Cross-section: Music -> TV', desc: 'Navigate Music to TV (a full-document section load).' },
    { key: 'open-video-ttff', title: 'Open a video (time-to-first-frame)', desc: 'Tap a video. Stop interacting the moment it starts playing.' },
    { key: 'seek-midpoint', title: 'Seek to the middle', desc: 'While a video plays, seek to roughly its midpoint.' },
    { key: 'thumb-scrub', title: 'Scrub a feed row (thumbnails)', desc: 'Scroll a feed row so a batch of thumbnails loads.' },
    { key: 'play-60s-stability', title: 'Play ~60s untouched (stalls)', desc: 'Let a video or track play for about a minute without touching it.' },
    { key: 'warm-reload-home', title: 'Warm reload -> Home', desc: 'Reload Home once more, to compare against the cold load.' },
  ];

  // ---- localStorage bus ----------------------------------------------------
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }
  function jget(k, d) { var r = lsGet(k); if (!r) return d; try { return JSON.parse(r); } catch (_) { return d; } }

  function activeRun() { return jget(KEY_ACTIVE, null); }

  function clientSnapshot() {
    var c = navigator.connection || {};
    return {
      ua: navigator.userAgent,
      host: location.host,
      dpr: window.devicePixelRatio || 1,
      screen: (screen.width + 'x' + screen.height),
      connection: { effectiveType: c.effectiveType || '', downlink: c.downlink || null, rtt: c.rtt || null, saveData: !!c.saveData },
      startedAt: Date.now(),
    };
  }

  // ---- run lifecycle -------------------------------------------------------
  function startRun() {
    var label = (document.getElementById('label').value || '').trim();
    var note = (document.getElementById('note').value || '').trim();
    lsDel(KEY_EVENTS); lsDel(KEY_PROBES); lsDel(KEY_SCENARIO);
    lsSet(KEY_ACTIVE, JSON.stringify({ runId: 'local-' + Date.now(), label: label, note: note, client: clientSnapshot() }));
    render();
  }

  function stopRun() {
    var run = activeRun();
    if (!run) return;
    var events = jget(KEY_EVENTS, []);
    var probes = jget(KEY_PROBES, {});
    var scenarios = [];
    events.forEach(function (e) { if (e.scenario && scenarios.indexOf(e.scenario) === -1) scenarios.push(e.scenario); });
    var body = { label: run.label, note: run.note, client: run.client, scenarios: scenarios, events: events, probes: probes };
    setProbeStatus('Saving run (' + events.length + ' events)...');
    fetch('/api/diag/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        lsDel(KEY_ACTIVE); lsDel(KEY_EVENTS); lsDel(KEY_PROBES); lsDel(KEY_SCENARIO);
        setProbeStatus(res && res.ok ? 'Saved run ' + res.id : 'Save failed: ' + (res && res.error));
        render(); loadRuns(res && res.id);
      })
      .catch(function (e) { setProbeStatus('Save failed: ' + e); });
  }

  function setScenario(key) { lsSet(KEY_SCENARIO, key); render(); }
  function clearScenario() { lsDel(KEY_SCENARIO); render(); }

  // ---- active probes -------------------------------------------------------
  function parseServerTiming(h) {
    if (!h) return null;
    var m = /app;dur=([\d.]+)/.exec(h);
    return m ? parseFloat(m[1]) : null;
  }
  function pct(arr, p) {
    if (!arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var i = Math.min(s.length - 1, Math.floor(p / 100 * s.length));
    return s[i];
  }
  function median(arr) { return pct(arr, 50); }
  function saveProbe(name, data) { var p = jget(KEY_PROBES, {}); p[name] = data; lsSet(KEY_PROBES, JSON.stringify(p)); }

  function probeRtt() {
    setProbeStatus('Pinging (20x)...');
    var wall = [], pipe = [], server = [], i = 0, N = 20;
    function step() {
      if (i >= N) {
        var data = { samples: N, wallMedian: median(wall), wallMin: Math.min.apply(null, wall), wallP95: pct(wall, 95),
          pipeMedian: pipe.length ? median(pipe) : null, serverAvg: server.length ? avg(server) : null };
        saveProbe('rtt', data); setProbeStatus('RTT done.'); renderProbes(); return;
      }
      var t0 = performance.now();
      fetch('/api/diag/ping?cb=' + Date.now() + '_' + i, { cache: 'no-store' })
        .then(function (r) { var app = parseServerTiming(r.headers.get('Server-Timing')); return r.text().then(function () { return app; }); })
        .then(function (app) {
          var dt = performance.now() - t0; wall.push(dt);
          if (app != null) { server.push(app); pipe.push(Math.max(0, dt - app)); }
          i++; step();
        })
        .catch(function () { i++; step(); });
    }
    step();
  }

  function probeThroughput() {
    setProbeStatus('Throughput (1/5/20 MB)...');
    var sizes = [1, 5, 20], out = [], idx = 0;
    function step() {
      if (idx >= sizes.length) { saveProbe('throughput', out); setProbeStatus('Throughput done.'); renderProbes(); return; }
      var bytes = sizes[idx] * 1024 * 1024, t0 = performance.now();
      fetch('/api/diag/blob?bytes=' + bytes + '&cb=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.arrayBuffer(); })
        .then(function (ab) {
          var secs = (performance.now() - t0) / 1000;
          out.push({ mb: sizes[idx], secs: Math.round(secs * 100) / 100, mbps: Math.round((ab.byteLength * 8 / 1e6) / secs * 10) / 10 });
          idx++; step();
        })
        .catch(function () { idx++; step(); });
    }
    step();
  }

  function probeCompression() {
    setProbeStatus('Compression delta...');
    var encs = ['none', 'gz', 'br'], out = [], idx = 0;
    function step() {
      if (idx >= encs.length) { saveProbe('compression', out); setProbeStatus('Compression done.'); renderProbes(); return; }
      var enc = encs[idx], cb = Date.now() + '_' + idx, url = '/api/diag/payload?enc=' + enc + '&cb=' + cb, t0 = performance.now();
      fetch(url, { cache: 'no-store' })
        .then(function (r) { var unc = r.headers.get('X-Uncompressed-Bytes'); var wireHdr = r.headers.get('X-Wire-Bytes'); return r.arrayBuffer().then(function () { return { unc: unc, wireHdr: wireHdr }; }); })
        .then(function (info) {
          var ms = performance.now() - t0;
          var entry = performance.getEntriesByType('resource').filter(function (e) { return e.name.indexOf('cb=' + cb) !== -1; })[0];
          // Prefer Resource Timing's on-wire size; fall back to the server's
          // X-Wire-Bytes header where the browser zeroes it (iOS Safari).
          var wire = (entry && (entry.transferSize || entry.encodedBodySize)) || (info.wireHdr ? parseInt(info.wireHdr, 10) : 0);
          var decoded = entry ? (entry.decodedBodySize || 0) : 0;
          out.push({ enc: enc, ms: Math.round(ms), wire: wire, decoded: decoded, uncompressed: info.unc ? parseInt(info.unc, 10) : decoded });
          idx++; step();
        })
        .catch(function () { idx++; step(); });
    }
    step();
  }

  function avg(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }

  // ---- metric derivation (raw events -> isolation matrix) ------------------
  function deriveMetrics(run) {
    var m = { rtt: null, throughput20: null, serverAppAvg: null, compression: null,
      navWorst: null, ttff: null, stalls: null, coldWarm: null, scenarioTable: [] };
    var p = run.probes || {};
    if (p.rtt) m.rtt = p.rtt;
    if (p.throughput) { var big = p.throughput.filter(function (t) { return t.mb === 20; })[0] || p.throughput[p.throughput.length - 1]; m.throughput20 = big; }
    if (p.compression) m.compression = { none: p.compression.filter(function (c) { return c.enc === 'none'; })[0],
      br: p.compression.filter(function (c) { return c.enc === 'br'; })[0], gz: p.compression.filter(function (c) { return c.enc === 'gz'; })[0] };

    // group events by scenario
    var by = {};
    (run.events || []).forEach(function (e) { var s = e.scenario || '(unlabelled)'; (by[s] = by[s] || []).push(e); });

    var serverApps = [];
    Object.keys(by).forEach(function (s) {
      var evs = by[s].slice().sort(function (a, b) { return a.t - b.t; });
      var res = evs.filter(function (e) { return e.type === 'resource' || e.type === 'navigation'; });
      var apis = res.filter(function (e) { return (e.data.name || '').indexOf('/api/') === 0; });
      var ttfbs = res.map(function (e) { return e.data.ttfb || 0; });
      var bytes = res.reduce(function (a, e) { return a + (e.data.transferSize || 0); }, 0);
      res.forEach(function (e) { (e.data.serverTiming || []).forEach(function (st) { if (st.name === 'app') serverApps.push(st.dur); }); });
      var media = evs.filter(function (e) { return e.type === 'media'; });
      var ttff = firstFrame(media);
      var stalls = stallStats(media);
      m.scenarioTable.push({ scenario: s, wallMs: evs.length ? (evs[evs.length - 1].t - evs[0].t) : 0,
        reqCount: res.length, apiCount: apis.length, sumTtfb: Math.round(ttfbs.reduce(function (a, b) { return a + b; }, 0)),
        bytes: bytes, ttff: ttff, stallCount: stalls.count, stallMs: stalls.ms });
    });
    if (serverApps.length) m.serverAppAvg = Math.round(avg(serverApps) * 10) / 10;

    // pick representatives for the lever rows
    var st = m.scenarioTable;
    var navCandidates = st.filter(function (r) { return /^(cold-load-home|nav-|warm-reload)/.test(r.scenario); });
    m.navWorst = navCandidates.sort(function (a, b) { return b.apiCount - a.apiCount; })[0] || null;
    var vid = st.filter(function (r) { return r.scenario === 'open-video-ttff'; })[0]; if (vid && vid.ttff != null) m.ttff = vid.ttff;
    var play = st.filter(function (r) { return r.scenario === 'play-60s-stability'; })[0]; if (play) m.stalls = { count: play.stallCount, ms: play.stallMs };
    var cold = st.filter(function (r) { return r.scenario === 'cold-load-home'; })[0];
    var warm = st.filter(function (r) { return r.scenario === 'warm-reload-home'; })[0];
    if (cold || warm) m.coldWarm = { cold: cold ? cold.wallMs : null, warm: warm ? warm.wallMs : null };
    return m;
  }

  function firstFrame(media) {
    var ls = null;
    for (var i = 0; i < media.length; i++) {
      if (media[i].data.event === 'loadstart' && ls == null) ls = media[i].t;
      if (media[i].data.event === 'playing' && ls != null) return media[i].t - ls;
    }
    return null;
  }
  function stallStats(media) {
    var count = 0, ms = 0, waitAt = null;
    media.forEach(function (e) {
      if (e.data.event === 'waiting') { if (waitAt == null) { waitAt = e.t; count++; } }
      else if (e.data.event === 'playing' && waitAt != null) { ms += e.t - waitAt; waitAt = null; }
    });
    return { count: count, ms: Math.round(ms) };
  }

  // ---- formatting ----------------------------------------------------------
  // Escape any admin-authored free text (run label/note, scenario name) before
  // it goes into innerHTML. The blast radius is admin-self, but escaping keeps a
  // stray '<' in a label from breaking the render and closes the residual.
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtMs(n) { return (n == null) ? '<span class="muted">-</span>' : Math.round(n) + ' ms'; }
  function fmtBytes(n) { if (n == null) return '-'; if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB'; if (n > 1e3) return (n / 1e3).toFixed(1) + ' KB'; return n + ' B'; }

  var MATRIX_ROWS = [
    { k: 'RTT wall (median)', lever: 'WireGuard / MTU / VPN endpoint', get: function (m) { return m.rtt ? fmtMs(m.rtt.wallMedian) + ' <span class="muted">(min ' + Math.round(m.rtt.wallMin) + ', p95 ' + Math.round(m.rtt.wallP95) + ')</span>' : '-'; } },
    { k: 'RTT pipe-only (median)', lever: 'network minus server compute', get: function (m) { return m.rtt && m.rtt.pipeMedian != null ? fmtMs(m.rtt.pipeMedian) : '-'; } },
    { k: 'Server compute (avg)', lever: 'rules the BOX in or out', get: function (m) { return m.serverAppAvg != null ? fmtMs(m.serverAppAvg) : '-'; } },
    { k: 'Throughput @20MB', lever: 'mobile rendition / home-upload cap', get: function (m) { return m.throughput20 ? m.throughput20.mbps + ' Mbps' : '-'; } },
    { k: 'Compression wire size', lever: 'brotli / gzip', get: function (m) {
        if (!m.compression || !m.compression.none) return '-';
        var n = m.compression.none.wire, b = m.compression.br ? m.compression.br.wire : null;
        var save = (n && b) ? Math.round((1 - b / n) * 100) : null;
        return fmtBytes(n) + ' &rarr; ' + (b ? fmtBytes(b) : '?') + (save != null ? ' <span class="good">(-' + save + '%)</span>' : ''); } },
    { k: 'Nav fan-out (worst view)', lever: 'aggregated bootstrap endpoint', get: function (m) {
        if (!m.navWorst) return '-';
        return m.navWorst.apiCount + ' API reqs, ' + m.navWorst.reqCount + ' total, ' + Math.round(m.navWorst.wallMs) + ' ms <span class="muted">(' + esc(m.navWorst.scenario) + ')</span>'; } },
    { k: 'Time-to-first-frame', lever: 'confirms faststart is fine', get: function (m) { return m.ttff != null ? fmtMs(m.ttff) : '-'; } },
    { k: 'Stalls (60s play)', lever: 'adaptive bitrate', get: function (m) { return m.stalls ? (m.stalls.count + ' stalls, ' + m.stalls.ms + ' ms') : '-'; } },
    { k: 'Cold vs warm Home', lever: 'service-worker shell/thumb caching', get: function (m) { return m.coldWarm ? (Math.round(m.coldWarm.cold || 0) + ' ms cold / ' + Math.round(m.coldWarm.warm || 0) + ' ms warm') : '-'; } },
  ];

  // ---- rendering -----------------------------------------------------------
  function el(id) { return document.getElementById(id); }
  function setProbeStatus(t) { el('probeStatus').textContent = t || ''; }

  function render() {
    var run = activeRun();
    var s = el('status');
    if (run) {
      var n = jget(KEY_EVENTS, []).length;
      var sc = lsGet(KEY_SCENARIO) || '(none)';
      s.className = 'status live';
      s.innerHTML = '● RECORDING - <strong>' + esc(run.label || 'unlabelled') + '</strong> &middot; scenario: <strong>' + esc(sc) + '</strong> &middot; ' + n + ' events captured';
      el('startBtn').disabled = true; el('stopBtn').disabled = false;
    } else {
      s.className = 'status';
      s.textContent = 'Idle - no run armed.';
      el('startBtn').disabled = false; el('stopBtn').disabled = true;
    }
    renderScenarios();
    renderProbes();
  }

  function renderScenarios() {
    var ul = el('scenarios'); var cur = lsGet(KEY_SCENARIO); var armed = !!activeRun();
    ul.innerHTML = '';
    SCENARIOS.forEach(function (sc) {
      var li = document.createElement('li');
      if (cur === sc.key) li.className = 'on';
      li.innerHTML = '<div class="desc"><strong>' + sc.title + '</strong><small>' + sc.desc + '</small></div>';
      var b = document.createElement('button');
      b.textContent = cur === sc.key ? 'Active' : 'Set active';
      b.disabled = !armed;
      b.onclick = function () { setScenario(sc.key); };
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  function renderProbes() {
    var p = jget(KEY_PROBES, {});
    var run = activeRun();
    // when idle, show nothing here (probes belong to the live run)
    var box = el('probeResults');
    if (!run && !Object.keys(p).length) { box.innerHTML = '<span class="muted">Arm a run, then fire probes so their results attach to it.</span>'; return; }
    var html = '';
    if (p.rtt) html += '<div class="card" style="margin:0 0 8px"><strong>RTT</strong>: wall median ' + Math.round(p.rtt.wallMedian) + ' ms (min ' + Math.round(p.rtt.wallMin) + ', p95 ' + Math.round(p.rtt.wallP95) + ')' + (p.rtt.pipeMedian != null ? ', pipe-only ' + Math.round(p.rtt.pipeMedian) + ' ms, server ' + Math.round(p.rtt.serverAvg) + ' ms' : '') + '</div>';
    if (p.throughput) html += '<div class="card" style="margin:0 0 8px"><strong>Throughput</strong>: ' + p.throughput.map(function (t) { return t.mb + 'MB=' + t.mbps + ' Mbps'; }).join(' &middot; ') + '</div>';
    if (p.compression) html += '<div class="card" style="margin:0 0 8px"><strong>Compression</strong>: ' + p.compression.map(function (c) { return c.enc + '=' + fmtBytes(c.wire) + '/' + c.ms + 'ms'; }).join(' &middot; ') + '</div>';
    box.innerHTML = html || '<span class="muted">No probe results yet.</span>';
  }

  // ---- runs list + matrix --------------------------------------------------
  var selected = [];
  function loadRuns(focusId) {
    fetch('/api/diag/runs', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (res) {
      var ul = el('runs'); ul.innerHTML = ''; selected = [];
      (res.runs || []).forEach(function (r) {
        var li = document.createElement('li');
        var cb = document.createElement('input'); cb.type = 'checkbox';
        cb.onchange = function () { toggleSelect(r.id, cb.checked); };
        var meta = document.createElement('div'); meta.className = 'meta';
        meta.innerHTML = '<strong>' + esc(r.label || '(unlabelled)') + '</strong>' +
          '<span class="pill">' + r.eventCount + ' ev</span>' +
          '<span class="pill">' + r.scenarioCount + ' scen</span>' +
          '<br><small>' + new Date(r.createdAt).toLocaleString() + (r.note ? ' - ' + esc(r.note) : '') + '</small>';
        var view = document.createElement('button'); view.textContent = 'View'; view.onclick = function () { viewRun(r.id); };
        var del = document.createElement('button'); del.textContent = 'Delete'; del.className = 'danger';
        del.onclick = function () { fetch('/api/diag/runs/' + r.id, { method: 'DELETE' }).then(function () { loadRuns(); }); };
        li.appendChild(cb); li.appendChild(meta); li.appendChild(view); li.appendChild(del);
        ul.appendChild(li);
      });
      if (focusId) viewRun(focusId);
    });
  }
  function toggleSelect(id, on) {
    if (on) { selected.push(id); if (selected.length > 2) selected.shift(); }
    else { selected = selected.filter(function (x) { return x !== id; }); }
    el('compareBtn').disabled = selected.length !== 2;
  }

  function viewRun(id) {
    fetch('/api/diag/runs/' + id, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (run) {
      renderMatrix([{ run: run, m: deriveMetrics(run) }]);
    });
  }
  function compareSelected() {
    if (selected.length !== 2) return;
    Promise.all(selected.map(function (id) { return fetch('/api/diag/runs/' + id, { cache: 'no-store' }).then(function (r) { return r.json(); }); }))
      .then(function (runs) { renderMatrix(runs.map(function (run) { return { run: run, m: deriveMetrics(run) }; })); });
  }

  function renderMatrix(cols) {
    var box = el('matrix');
    var head = '<tr><th>Dimension</th>' + cols.map(function (c) { return '<th>' + esc(c.run.label || '(unlabelled)') + '</th>'; }).join('') + '<th>Lever it points to</th></tr>';
    var rows = MATRIX_ROWS.map(function (row) {
      return '<tr><td>' + row.k + '</td>' + cols.map(function (c) { return '<td class="num">' + row.get(c.m) + '</td>'; }).join('') + '<td class="lever">' + row.lever + '</td></tr>';
    }).join('');
    var matrix = '<h2 style="margin-top:0">Isolation matrix</h2><table>' + head + rows + '</table>';

    // per-scenario detail for the first column
    var st = cols[0].m.scenarioTable || [];
    var detail = '';
    if (st.length) {
      detail = '<h2>Per-scenario detail <span class="muted" style="text-transform:none;letter-spacing:0">(' + esc(cols[0].run.label || '') + ')</span></h2>' +
        '<table><tr><th>Scenario</th><th>Wall</th><th>API reqs</th><th>Total reqs</th><th>&Sigma; TTFB</th><th>Bytes</th><th>TTFF</th><th>Stalls</th></tr>' +
        st.map(function (r) { return '<tr><td>' + esc(r.scenario) + '</td><td class="num">' + Math.round(r.wallMs) + ' ms</td><td class="num">' + r.apiCount + '</td><td class="num">' + r.reqCount + '</td><td class="num">' + r.sumTtfb + ' ms</td><td class="num">' + fmtBytes(r.bytes) + '</td><td class="num">' + (r.ttff != null ? Math.round(r.ttff) + ' ms' : '-') + '</td><td class="num">' + r.stallCount + '/' + r.stallMs + 'ms</td></tr>'; }).join('') +
        '</table>';
    }
    box.innerHTML = matrix + detail;
  }

  // ---- wire up -------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    el('startBtn').onclick = startRun;
    el('stopBtn').onclick = stopRun;
    el('clearScenario').onclick = clearScenario;
    el('openAppBtn').onclick = function () { window.open('/', '_blank'); };
    el('probeRtt').onclick = probeRtt;
    el('probeThroughput').onclick = probeThroughput;
    el('probeCompression').onclick = probeCompression;
    el('refreshRuns').onclick = function () { loadRuns(); };
    el('compareBtn').onclick = compareSelected;
    Array.prototype.forEach.call(document.querySelectorAll('.chips button[data-label]'), function (b) {
      b.onclick = function () { document.getElementById('label').value = b.getAttribute('data-label'); };
    });
    render();
    loadRuns();
    // keep the live status/event-count fresh while recording in another tab
    setInterval(function () { if (activeRun()) render(); }, 1500);
  });
})();
