'use strict';

// v1.348 Listen Control - the HTTP surface of the remote-control channel:
// one SSE stream per device (targets and controllers), a polling fallback for
// a proxy that buffers, and the command/state/off POSTs. lib/remote/store.js
// owns every decision; this file owns sockets, heartbeats and timers.
//
// Everything is bucketed by req.user.id (from the auth gate). A body or query
// user id is never read, and every track id is resolved through the caller's
// own visibility before it reaches another device.

const CMDS = new Set(['play', 'pause', 'toggle', 'next', 'prev', 'seek']);
const STATES = new Set(['playing', 'paused', 'idle', 'blocked']);
const PLAY_MAX_IDS = 2000;
const ID_MAX = 256;

function isJsonRequest(req) {
  return !!req.is('application/json');
}

function validId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= ID_MAX && !id.includes('\u0000');
}

function finiteNonNegative(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

// A reverse proxy drops a silent connection at 60 s (nginx proxy_read_timeout): ping well inside that.
const HEARTBEAT_MS = 20000;

function registerRoutes(app, deps) {
  const {
    remote,
    resolveTracks, // (req, ids) -> array, same length, track object | null (the /api/music shape, visibility-filtered)
    resolveTrackCard, // (req, id) -> {id,title,artist,album,artUrl} | null
    createRateLimiter,
    normalizeLabel,
    DEVICE_ID_RE,
  } = deps;
  const heartbeatMs = deps.heartbeatMs || HEARTBEAT_MS;
  const sweepMs = deps.sweepMs || 1000;
  const nowMs = deps.nowMs || (() => Date.now());

  const commandLimiter = createRateLimiter({ capacity: 30, refillPerSec: 10, nowMs });
  const stateLimiter = createRateLimiter({ capacity: 20, refillPerSec: 5, nowMs });

  const sockets = new Map(); // connId -> res
  const timers = new Map(); // connId -> heartbeat interval
  let sweepTimer = null;

  function writeRaw(res, chunk) {
    if (!res || res.destroyed || res.writableEnded) return false;
    try { res.write(chunk); return true; } catch { return false; }
  }
  function frame(event, data, id) {
    return (id != null ? `id: ${id}\n` : '') + `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  function dropSocket(connId) {
    const t = timers.get(connId);
    if (t) { clearInterval(t); timers.delete(connId); }
    const res = sockets.get(connId);
    sockets.delete(connId);
    return res;
  }

  function apply(effects) {
    if (!effects) return;
    for (const e of effects) {
      if (e.type === 'send') {
        writeRaw(sockets.get(e.connId), frame(e.event, e.data));
      } else if (e.type === 'close') {
        const res = dropSocket(e.connId);
        if (res && !res.writableEnded) { try { res.end(); } catch { /* socket already gone */ } }
      }
    }
    syncSweepTimer();
  }

  // The sweep timer only exists while the store holds something (and is unref'd),
  // so an idle server - and a test process - has no timer to outlive its streams.
  function syncSweepTimer() {
    if (remote.isEmpty()) {
      if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
      return;
    }
    if (sweepTimer) return;
    sweepTimer = setInterval(() => apply(remote.sweep().effects), sweepMs);
    if (sweepTimer.unref) sweepTimer.unref();
  }

  function parseDeviceId(raw) {
    return typeof raw === 'string' && DEVICE_ID_RE.test(raw) ? raw : null;
  }

  function commandFrameArgs(req, entry) {
    if (entry.cmd !== 'play') return entry.args || {};
    const ids = entry.args.ids;
    const items = resolveTracks(req, ids);
    const tracks = [];
    let index = 0;
    for (let i = 0; i < ids.length; i++) {
      if (!items[i]) continue;
      if (i === entry.args.index) index = tracks.length;
      tracks.push(items[i]);
    }
    return { tracks, index };
  }

  function resolvedState(req, deviceId, label, raw) {
    if (!raw) {
      return { deviceId, label, state: 'idle', position: 0, duration: 0, hasPrev: false, hasNext: false, at: 0, ageMs: 0, track: null };
    }
    let track = null;
    if (raw.trackId) {
      try { track = resolveTrackCard(req, raw.trackId) || null; } catch { track = null; }
    }
    return {
      deviceId, label, state: raw.state, position: raw.position, duration: raw.duration,
      hasPrev: !!raw.hasPrev, hasNext: !!raw.hasNext, at: raw.at, ageMs: Math.max(0, remote.nowMs() - raw.at), track,
    };
  }

  // ---- the stream ---------------------------------------------------------
  app.get('/api/remote/stream', (req, res) => {
    const deviceId = parseDeviceId(req.query.deviceId);
    const role = req.query.role;
    if (!deviceId) return res.status(400).json({ error: 'bad deviceId' });
    if (role !== 'target' && role !== 'controller') return res.status(400).json({ error: 'bad role' });
    let targetId = null;
    if (role === 'controller') {
      targetId = parseDeviceId(req.query.target);
      if (!targetId) return res.status(400).json({ error: 'a controller stream must name a target' });
    }
    const label = normalizeLabel(req.query.label);
    const userId = req.user.id;

    const opened = remote.openConn(userId, { deviceId, role, targetId, label });
    apply(opened.effects);
    if (!opened.ok) return res.status(opened.status).json({ error: opened.code });
    const connId = opened.connId;

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    if (req.socket) {
      req.socket.setTimeout(0);
      req.socket.setNoDelay(true);
    }
    sockets.set(connId, res);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      dropSocket(connId);
      apply(remote.closeConn(connId).effects);
    };
    res.on('close', cleanup); // not req: since Node 16 a request's own 'close' fires once its body is read

    writeRaw(res, 'retry: 3000\n\n' + frame('hello', { seq: opened.seq }));
    if (role === 'target') {
      writeRaw(res, frame('controller', opened.controller));
      const lastEventId = Number(req.headers['last-event-id']);
      if (Number.isFinite(lastEventId)) {
        for (const entry of remote.commandsSince(userId, deviceId, lastEventId)) {
          writeRaw(res, frame('command', { seq: entry.seq, cmd: entry.cmd, args: commandFrameArgs(req, entry) }, entry.seq));
        }
      }
    } else if (opened.state) {
      writeRaw(res, frame('state', resolvedState(req, targetId, opened.targetLabel, opened.state)));
    }

    const hb = setInterval(() => {
      remote.beat(connId);
      if (!writeRaw(res, ': ping\n\n')) cleanup();
    }, heartbeatMs);
    if (hb.unref) hb.unref();
    timers.set(connId, hb);
    syncSweepTimer();
  });

  // ---- targets ------------------------------------------------------------
  app.get('/api/remote/targets', (req, res) => {
    const deviceId = parseDeviceId(req.query.deviceId);
    if (!deviceId) return res.status(400).json({ error: 'bad deviceId' });
    const listed = remote.listTargets(req.user.id, deviceId);
    apply(listed.effects);
    res.json(listed.targets.map((t) => ({
      deviceId: t.deviceId,
      label: t.label,
      controlled: t.controlled,
      state: resolvedState(req, t.deviceId, t.label, t.state),
    })));
  });

  // ---- command ------------------------------------------------------------
  app.post('/api/remote/command', (req, res) => {
    if (!isJsonRequest(req)) return res.status(415).json({ error: 'application/json required' });
    const userId = req.user.id;
    if (!commandLimiter.take(userId).allowed) return res.status(429).json({ error: 'slow down' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const fromDeviceId = parseDeviceId(body.fromDeviceId);
    const targetDeviceId = parseDeviceId(body.targetDeviceId);
    if (!fromDeviceId || !targetDeviceId) return res.status(400).json({ error: 'bad deviceId' });
    const cmd = body.cmd;
    if (typeof cmd !== 'string' || !CMDS.has(cmd)) return res.status(400).json({ error: 'unknown cmd' });
    const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {};

    let stored = {};
    let resolved = null;
    if (cmd === 'play') {
      const ids = args.ids;
      const index = args.index;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > PLAY_MAX_IDS || !ids.every(validId)) {
        return res.status(400).json({ error: 'bad ids' });
      }
      if (!Number.isInteger(index) || index < 0 || index >= ids.length) return res.status(400).json({ error: 'bad index' });
      let items;
      try { items = resolveTracks(req, ids); } catch { return res.status(500).json({ error: 'resolve failed' }); }
      if (!items[index]) return res.status(404).json({ error: 'no such track' });
      const keptIds = [];
      const tracks = [];
      let newIndex = 0;
      for (let i = 0; i < ids.length; i++) {
        if (!items[i]) continue;
        if (i === index) newIndex = tracks.length;
        keptIds.push(ids[i]);
        tracks.push(items[i]);
      }
      stored = { ids: keptIds, index: newIndex };
      resolved = { tracks, index: newIndex };
    } else if (cmd === 'seek') {
      if (!finiteNonNegative(args.position)) return res.status(400).json({ error: 'bad position' });
      stored = { position: args.position };
      resolved = stored;
    }

    const queued = remote.enqueue(userId, targetDeviceId, cmd, stored);
    apply(queued.effects);
    if (!queued.ok) return res.status(queued.status).json({ error: queued.code });
    if (queued.targetConnId) {
      writeRaw(sockets.get(queued.targetConnId), frame('command', { seq: queued.seq, cmd, args: resolved || {} }, queued.seq));
    }
    res.status(202).json({ seq: queued.seq });
  });

  // ---- state --------------------------------------------------------------
  app.post('/api/remote/state', (req, res) => {
    if (!isJsonRequest(req)) return res.status(415).json({ error: 'application/json required' });
    const userId = req.user.id;
    if (!stateLimiter.take(userId).allowed) return res.status(429).json({ error: 'slow down' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const deviceId = parseDeviceId(body.deviceId);
    if (!deviceId) return res.status(400).json({ error: 'bad deviceId' });
    const trackId = body.trackId == null ? null : body.trackId;
    if (trackId !== null && !validId(trackId)) return res.status(400).json({ error: 'bad trackId' });
    if (!STATES.has(body.state)) return res.status(400).json({ error: 'bad state' });
    if (!finiteNonNegative(body.position) || !finiteNonNegative(body.duration)) return res.status(400).json({ error: 'bad position' });
    const recorded = remote.recordState(userId, deviceId, {
      trackId, position: body.position, duration: body.duration, state: body.state,
      hasPrev: body.hasPrev === true, hasNext: body.hasNext === true,
    });
    apply(recorded.effects);
    if (!recorded.ok) return res.status(recorded.status).json({ error: recorded.code });
    if (recorded.controllerConnIds.length) {
      const payload = frame('state', resolvedState(req, deviceId, recorded.label, recorded.state));
      for (const connId of recorded.controllerConnIds) writeRaw(sockets.get(connId), payload);
    }
    res.status(202).json({ ok: true });
  });

  // ---- off ----------------------------------------------------------------
  app.post('/api/remote/off', (req, res) => {
    if (!isJsonRequest(req)) return res.status(415).json({ error: 'application/json required' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const deviceId = parseDeviceId(body.deviceId);
    if (!deviceId) return res.status(400).json({ error: 'bad deviceId' });
    apply(remote.off(req.user.id, deviceId).effects);
    res.json({ ok: true });
  });

  // ---- poll fallback ------------------------------------------------------
  app.get('/api/remote/poll', (req, res) => {
    const deviceId = parseDeviceId(req.query.deviceId);
    const role = req.query.role;
    if (!deviceId) return res.status(400).json({ error: 'bad deviceId' });
    if (role !== 'target' && role !== 'controller') return res.status(400).json({ error: 'bad role' });
    const userId = req.user.id;
    const label = normalizeLabel(req.query.label);
    if (role === 'target') {
      const sinceRaw = req.query.since;
      const since = sinceRaw === undefined || sinceRaw === '' ? NaN : Number(sinceRaw);
      const polled = remote.pollTarget(userId, { deviceId, label, since });
      apply(polled.effects);
      if (!polled.ok) return res.status(polled.status).json({ error: polled.code });
      return res.json({
        seq: polled.seq,
        controller: polled.controller,
        commands: polled.commands.map((e) => ({ seq: e.seq, cmd: e.cmd, args: commandFrameArgs(req, e) })),
      });
    }
    const targetId = parseDeviceId(req.query.target);
    if (!targetId) return res.status(400).json({ error: 'a controller poll must name a target' });
    const polled = remote.pollController(userId, { deviceId, targetId, label });
    apply(polled.effects);
    if (!polled.ok) return res.status(polled.status).json({ error: polled.code });
    res.json({ state: resolvedState(req, targetId, polled.label, polled.state) });
  });

  // Ends every stream, stops every timer and forgets all state (tests, shutdown).
  function closeAll() {
    for (const connId of Array.from(sockets.keys())) {
      const res = dropSocket(connId);
      if (res && !res.writableEnded) { try { res.end(); } catch { /* socket already gone */ } }
    }
    for (const t of timers.values()) clearInterval(t);
    timers.clear();
    if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
    remote.clear();
  }

  return { closeAll, sweepNow: () => apply(remote.sweep().effects), _socketCount: () => sockets.size, _timerCount: () => timers.size + (sweepTimer ? 1 : 0) };
}

module.exports = { registerRoutes, CMDS, STATES, PLAY_MAX_IDS, HEARTBEAT_MS };
