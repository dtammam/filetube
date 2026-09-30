'use strict';

// v1.348 Listen Control - the remote-control STORE. Ephemeral, in-memory,
// per-user: which devices are listening targets, who is attached to them, the
// commands waiting for them and the last state they reported.
//
// PURE of transport: it never sees a socket or a request. Every entry point
// returns `effects` ([{type:'send', connId, event, data} | {type:'close',
// connId}]) for lib/remote/routes.js to apply, and takes an injectable clock,
// so the grace window and the liveness rules are testable without a real wait.
//
// REAL Maps at every level (the v1.42 row-key lesson): a deviceId of
// '__proto__' or 'constructor' is just a key. Everything is bucketed by the
// caller's user id; there is no lookup that crosses users.

const DEFAULTS = {
  graceMs: 10000, // a target whose stream closed is kept this long (a blip, a laptop waking)
  pollLiveMs: 10000, // a poll counts as a liveness beat for this long
  perUserConns: 8,
  globalConns: 200,
  perUserTargets: 8,
  globalTargets: 200,
  outboxMax: 50,
};

function createRemoteStore(opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  const now = typeof opts.now === 'function' ? opts.now : Date.now;

  const conns = new Map(); // connId -> conn
  const userConns = new Map(); // userId -> Set<connId>
  const targets = new Map(); // userId -> Map<deviceId, target>
  let connCounter = 0;
  let seqCounter = 0; // process-wide monotonic: a re-registered target never reuses a seq a client may have seen
  let order = 0;

  // conn = {connId, userId, role, deviceId, targetId, label, lastBeat, order}
  // target = {deviceId, label, lastSeq, outbox, state, streamConn, lastPoll,
  //           graceUntil, controllers: Map<key, {kind, connId?, lastPoll?, label}>}

  function userTargets(userId) { return targets.get(userId) || null; }
  function targetOf(userId, deviceId) {
    const m = targets.get(userId);
    return m ? (m.get(deviceId) || null) : null;
  }
  function targetCount() {
    let n = 0;
    for (const m of targets.values()) n += m.size;
    return n;
  }
  function isLive(t, at) {
    if (t.streamConn) return true;
    return at < Math.max(t.lastPoll + cfg.pollLiveMs, t.graceUntil);
  }

  function removeConn(connId) {
    const c = conns.get(connId);
    if (!c) return null;
    conns.delete(connId);
    const set = userConns.get(c.userId);
    if (set) { set.delete(connId); if (set.size === 0) userConns.delete(c.userId); }
    return c;
  }

  function controllerLabel(t) {
    let label = '';
    for (const c of t.controllers.values()) label = c.label;
    return label;
  }

  function sendTargetController(t, effects) {
    if (t.streamConn) {
      effects.push({ type: 'send', connId: t.streamConn, event: 'controller', data: { attached: t.controllers.size > 0, label: controllerLabel(t) } });
    }
  }

  // Forget a target now. Its controllers hear 'target-gone' and are closed; its
  // own stream (if any) optionally hears 'replaced' and is closed.
  function dropTarget(userId, t, effects, replacedEvent) {
    const m = targets.get(userId);
    if (m && m.get(t.deviceId) === t) { m.delete(t.deviceId); if (m.size === 0) targets.delete(userId); }
    for (const c of t.controllers.values()) {
      if (c.kind === 'stream') {
        effects.push({ type: 'send', connId: c.connId, event: 'target-gone', data: { deviceId: t.deviceId } });
        effects.push({ type: 'close', connId: c.connId });
        removeConn(c.connId);
      }
    }
    t.controllers.clear();
    if (t.streamConn) {
      if (replacedEvent) effects.push({ type: 'send', connId: t.streamConn, event: 'replaced', data: {} });
      effects.push({ type: 'close', connId: t.streamConn });
      removeConn(t.streamConn);
      t.streamConn = null;
    }
  }

  function detachController(t, key, effects) {
    if (!t.controllers.delete(key)) return;
    if (t.controllers.size === 0) sendTargetController(t, effects);
  }

  function sweepInto(effects) {
    const at = now();
    for (const [userId, m] of Array.from(targets)) {
      for (const t of Array.from(m.values())) {
        // Poll-only controllers that went quiet detach (the last one is an edge).
        for (const [key, c] of Array.from(t.controllers)) {
          if (c.kind === 'poll' && at - c.lastPoll >= cfg.pollLiveMs) detachController(t, key, effects);
        }
        if (!isLive(t, at)) dropTarget(userId, t, effects, false);
      }
    }
  }

  function evictLeastRecent(userId, effects) {
    const set = userConns.get(userId);
    if (!set || set.size === 0) return;
    let victim = null;
    for (const id of set) {
      const c = conns.get(id);
      if (!victim || c.lastBeat < victim.lastBeat || (c.lastBeat === victim.lastBeat && c.order < victim.order)) victim = c;
    }
    if (!victim) return;
    if (victim.role === 'target') {
      const t = targetOf(userId, victim.deviceId);
      if (t && t.streamConn === victim.connId) { dropTarget(userId, t, effects, true); return; }
    } else {
      const t = targetOf(userId, victim.targetId);
      if (t) detachController(t, 's:' + victim.connId, effects);
    }
    effects.push({ type: 'send', connId: victim.connId, event: 'replaced', data: {} });
    effects.push({ type: 'close', connId: victim.connId });
    removeConn(victim.connId);
  }

  function ensureTarget(userId, deviceId, label) {
    let m = targets.get(userId);
    let t = m ? m.get(deviceId) : null;
    if (t) { if (label) t.label = label; return { t }; }
    if ((m ? m.size : 0) >= cfg.perUserTargets) return { error: { status: 429, code: 'too-many-devices' } };
    if (targetCount() >= cfg.globalTargets) return { error: { status: 503, code: 'busy' } };
    if (!m) { m = new Map(); targets.set(userId, m); }
    t = {
      deviceId, label, lastSeq: seqCounter, outbox: [], state: null,
      streamConn: null, lastPoll: 0, graceUntil: 0, controllers: new Map(),
    };
    m.set(deviceId, t);
    return { t };
  }

  function newConn(userId, role, deviceId, targetId, label) {
    const conn = { connId: 'c' + (++connCounter), userId, role, deviceId, targetId, label, lastBeat: now(), order: ++order };
    conns.set(conn.connId, conn);
    let set = userConns.get(userId);
    if (!set) { set = new Set(); userConns.set(userId, set); }
    set.add(conn.connId);
    return conn;
  }

  // Make room for one more connection for `userId`: at the per-user cap the
  // least-recently-beating one is evicted (net zero, so it is allowed even at
  // the global cap); below it, the global cap refuses.
  function makeRoom(userId, effects) {
    const set = userConns.get(userId);
    if (set && set.size >= cfg.perUserConns) { evictLeastRecent(userId, effects); return null; }
    if (conns.size >= cfg.globalConns) return { status: 503, code: 'busy' };
    return null;
  }

  return {
    // -> {ok, connId, seq, controller, state, effects} | {ok:false, status, code, effects}
    openConn(userId, { deviceId, role, targetId, label }) {
      const effects = [];
      sweepInto(effects);
      if (role === 'target') {
        const existing = targetOf(userId, deviceId);
        if (existing && existing.streamConn) {
          // One target per device id: the newest opt-in wins (a second tab of the same browser).
          effects.push({ type: 'send', connId: existing.streamConn, event: 'replaced', data: {} });
          effects.push({ type: 'close', connId: existing.streamConn });
          removeConn(existing.streamConn);
          existing.streamConn = null;
        }
        const refusal = makeRoom(userId, effects);
        if (refusal) return Object.assign({ ok: false, effects }, refusal);
        const got = ensureTarget(userId, deviceId, label);
        if (got.error) return Object.assign({ ok: false, effects }, got.error);
        const t = got.t;
        const conn = newConn(userId, 'target', deviceId, null, label);
        t.streamConn = conn.connId;
        t.graceUntil = 0;
        return {
          ok: true, connId: conn.connId, seq: t.lastSeq,
          controller: { attached: t.controllers.size > 0, label: controllerLabel(t) }, effects,
        };
      }
      const t = targetOf(userId, targetId);
      if (!t || !isLive(t, now())) return { ok: false, status: 410, code: 'target-gone', effects };
      const refusal = makeRoom(userId, effects);
      if (refusal) return Object.assign({ ok: false, effects }, refusal);
      // makeRoom may have evicted the very target this controller names.
      const t2 = targetOf(userId, targetId);
      if (!t2) return { ok: false, status: 410, code: 'target-gone', effects };
      const conn = newConn(userId, 'controller', deviceId, targetId, label);
      const first = t2.controllers.size === 0;
      t2.controllers.set('s:' + conn.connId, { kind: 'stream', connId: conn.connId, label });
      if (first) sendTargetController(t2, effects);
      return { ok: true, connId: conn.connId, seq: t2.lastSeq, state: t2.state, targetLabel: t2.label, effects };
    },

    closeConn(connId) {
      const effects = [];
      const c = removeConn(connId);
      if (!c) return { effects };
      if (c.role === 'target') {
        const t = targetOf(c.userId, c.deviceId);
        if (t && t.streamConn === connId) { t.streamConn = null; t.graceUntil = now() + cfg.graceMs; }
      } else {
        const t = targetOf(c.userId, c.targetId);
        if (t) detachController(t, 's:' + connId, effects);
      }
      return { effects };
    },

    beat(connId) {
      const c = conns.get(connId);
      if (c) c.lastBeat = now();
    },

    // A target that could not hold a stream: a poll is its registration and its liveness beat.
    pollTarget(userId, { deviceId, label, since }) {
      const effects = [];
      sweepInto(effects);
      const got = ensureTarget(userId, deviceId, label);
      if (got.error) return Object.assign({ ok: false, effects }, got.error);
      const t = got.t;
      t.lastPoll = now();
      const after = Number.isFinite(since) ? since : t.lastSeq;
      return {
        ok: true, seq: t.lastSeq,
        commands: t.outbox.filter((e) => e.seq > after),
        controller: { attached: t.controllers.size > 0, label: controllerLabel(t) }, effects,
      };
    },

    // A controller that could not hold a stream. -> {ok:false, status:410} when the target is gone.
    pollController(userId, { deviceId, targetId, label }) {
      const effects = [];
      sweepInto(effects);
      const t = targetOf(userId, targetId);
      if (!t || !isLive(t, now())) return { ok: false, status: 410, code: 'target-gone', effects };
      const key = 'p:' + deviceId;
      const first = t.controllers.size === 0;
      t.controllers.set(key, { kind: 'poll', lastPoll: now(), label });
      if (first) sendTargetController(t, effects);
      return { ok: true, state: t.state, label: t.label, effects };
    },

    // -> {ok, seq, targetConnId} | {ok:false, status:410}
    enqueue(userId, targetId, cmd, args) {
      const effects = [];
      sweepInto(effects);
      const t = targetOf(userId, targetId);
      if (!t || !isLive(t, now())) return { ok: false, status: 410, code: 'target-gone', effects };
      const seq = ++seqCounter;
      t.lastSeq = seq;
      // Last action wins: a newer play supersedes any play still waiting.
      if (cmd === 'play') t.outbox = t.outbox.filter((e) => e.cmd !== 'play');
      t.outbox.push({ seq, cmd, args });
      if (t.outbox.length > cfg.outboxMax) t.outbox = t.outbox.slice(t.outbox.length - cfg.outboxMax);
      return { ok: true, seq, targetConnId: t.streamConn, effects };
    },

    // Commands after `since`, for a stream (re)connect replay.
    commandsSince(userId, deviceId, since) {
      const t = targetOf(userId, deviceId);
      if (!t || !Number.isFinite(since)) return [];
      return t.outbox.filter((e) => e.seq > since);
    },

    // -> {ok, controllerConnIds} | {ok:false, status:410}
    recordState(userId, deviceId, state) {
      const effects = [];
      sweepInto(effects);
      const t = targetOf(userId, deviceId);
      if (!t || !isLive(t, now())) return { ok: false, status: 410, code: 'target-gone', effects };
      t.state = Object.assign({}, state, { at: now() });
      const ids = [];
      for (const c of t.controllers.values()) if (c.kind === 'stream') ids.push(c.connId);
      return { ok: true, controllerConnIds: ids, state: t.state, label: t.label, effects };
    },

    // Explicit opt-out: no grace, controllers hear target-gone now.
    off(userId, deviceId) {
      const effects = [];
      const t = targetOf(userId, deviceId);
      if (t) dropTarget(userId, t, effects, false);
      return { effects };
    },

    // Live targets of one user except the caller: [{deviceId, label, controlled, state(raw)}]
    listTargets(userId, exceptDeviceId) {
      const effects = [];
      sweepInto(effects);
      const m = userTargets(userId);
      const out = [];
      if (m) {
        const at = now();
        for (const t of m.values()) {
          if (t.deviceId === exceptDeviceId || !isLive(t, at)) continue;
          out.push({ deviceId: t.deviceId, label: t.label, controlled: t.controllers.size > 0, state: t.state });
        }
      }
      return { targets: out, effects };
    },

    sweep() {
      const effects = [];
      sweepInto(effects);
      return { effects };
    },

    nowMs() { return now(); },
    isEmpty() { return conns.size === 0 && targets.size === 0; },
    connCount() { return conns.size; },
    targetCount,
    clear() { conns.clear(); userConns.clear(); targets.clear(); },
  };
}

module.exports = { createRemoteStore, DEFAULTS };
