'use strict';

// [UNIT] v1.348 Listen Control - the remote-control store (lib/remote/store.js).
// The clock is injected throughout: the 10s grace and the poll-liveness window
// are proven by advancing a fake `now`, never by waiting.

const { test } = require('node:test');
const assert = require('node:assert');
const { createRemoteStore } = require('../../lib/remote/store.js');

function mk(opts = {}) {
  let t = 1_000_000;
  const store = createRemoteStore({ now: () => t, ...opts });
  return { store, tick: (ms) => { t += ms; return t; } };
}
const sent = (fx, event) => fx.filter((e) => e.type === 'send' && e.event === event);
const closed = (fx) => fx.filter((e) => e.type === 'close').map((e) => e.connId);

function target(store, user = 'u1', deviceId = 'pc', label = 'PC') {
  const r = store.openConn(user, { deviceId, role: 'target', label });
  assert.ok(r.ok, 'target opens');
  return r;
}
function controller(store, user = 'u1', deviceId = 'phone', targetId = 'pc', label = 'iPhone') {
  return store.openConn(user, { deviceId, role: 'controller', targetId, label });
}

test('a target registers, is listed to its own user, and never to the asker itself', () => {
  const { store } = mk();
  target(store);
  assert.deepStrictEqual(store.listTargets('u1', 'phone').targets.map((x) => x.deviceId), ['pc']);
  assert.deepStrictEqual(store.listTargets('u1', 'pc').targets, []);
});

test('user isolation: user B never sees, commands or subscribes to user A target, even with the same deviceId', () => {
  const { store } = mk();
  target(store, 'userA', 'pc');
  assert.deepStrictEqual(store.listTargets('userB', 'phone').targets, []);
  assert.strictEqual(store.enqueue('userB', 'pc', 'pause', {}).ok, false);
  assert.strictEqual(store.enqueue('userB', 'pc', 'pause', {}).status, 410);
  const c = controller(store, 'userB', 'phone', 'pc');
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.status, 410);
  // B registering its own "pc" must not disturb A's
  target(store, 'userB', 'pc');
  assert.strictEqual(store.enqueue('userA', 'pc', 'pause', {}).ok, true);
  assert.strictEqual(store.targetCount(), 2);
});

test('__proto__ and constructor device ids are plain keys', () => {
  const { store } = mk();
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const r = target(store, 'u1', id, id);
    assert.ok(r.connId);
    assert.strictEqual(store.enqueue('u1', id, 'pause', {}).ok, true);
    assert.ok(store.listTargets('u1', 'x').targets.some((x) => x.deviceId === id));
  }
  assert.strictEqual(({}).polluted, undefined);
  assert.strictEqual(Object.getPrototypeOf(Object.prototype), null);
  // an unknown id that merely exists on Object.prototype is not a target
  assert.strictEqual(store.enqueue('u1', 'valueOf', 'pause', {}).ok, false);
  assert.strictEqual(store.enqueue('nobody', '__proto__', 'pause', {}).ok, false);
});

test('a second stream for the same device id replaces the first, which hears replaced', () => {
  const { store } = mk();
  const a = target(store);
  const b = store.openConn('u1', { deviceId: 'pc', role: 'target', label: 'PC' });
  assert.ok(b.ok);
  assert.deepStrictEqual(sent(b.effects, 'replaced').map((e) => e.connId), [a.connId]);
  assert.deepStrictEqual(closed(b.effects), [a.connId]);
  assert.strictEqual(store.targetCount(), 1);
  // the old connection closing afterwards must not start a grace for the NEW stream
  store.closeConn(a.connId);
  assert.strictEqual(store.enqueue('u1', 'pc', 'pause', {}).targetConnId, b.connId);
});

test('per-user stream cap 8: the 9th evicts the least recently beating stream with replaced', () => {
  const { store, tick } = mk();
  const ids = [];
  for (let i = 0; i < 8; i++) { tick(10); ids.push(target(store, 'u1', 'pc' + i, 'PC' + i).connId); }
  // pc0 beats, so pc1 is now the least recently beating
  tick(10); store.beat(ids[0]);
  const ninth = store.openConn('u1', { deviceId: 'pc8', role: 'target', label: 'PC8' });
  assert.ok(ninth.ok);
  assert.deepStrictEqual(sent(ninth.effects, 'replaced').map((e) => e.connId), [ids[1]]);
  assert.strictEqual(store.connCount(), 8);
  assert.strictEqual(store.enqueue('u1', 'pc1', 'pause', {}).ok, false, 'the evicted target is gone at once (no grace)');
  assert.strictEqual(store.enqueue('u1', 'pc0', 'pause', {}).ok, true);
});

test('evicting a target tells its controllers target-gone', () => {
  const { store, tick } = mk();
  target(store, 'u1', 'pc0');
  const c = controller(store, 'u1', 'phone', 'pc0');
  for (let i = 1; i < 7; i++) { tick(10); target(store, 'u1', 'pc' + i); }
  tick(10); store.beat(c.connId);
  for (let i = 1; i < 7; i++) store.beat(store.openConn('u1', { deviceId: 'pc' + i, role: 'target', label: 'x' }).connId);
  // 8 conns now; the oldest beat is pc0's target conn
  const fx = store.openConn('u1', { deviceId: 'extra', role: 'target', label: 'E' }).effects;
  assert.ok(sent(fx, 'target-gone').some((e) => e.connId === c.connId));
});

test('global stream cap 200: the 201st is refused with 503; a user at its own cap still rotates', () => {
  const { store } = mk({ globalConns: 10, perUserConns: 4 });
  for (let u = 0; u < 2; u++) for (let i = 0; i < 4; i++) target(store, 'u' + u, 'pc' + i);
  for (let i = 0; i < 2; i++) target(store, 'u2', 'pc' + i);
  assert.strictEqual(store.connCount(), 10);
  const over = store.openConn('u3', { deviceId: 'pc', role: 'target', label: 'x' });
  assert.strictEqual(over.ok, false);
  assert.strictEqual(over.status, 503);
  const rotate = store.openConn('u0', { deviceId: 'pcNew', role: 'target', label: 'x' });
  assert.ok(rotate.ok, 'a user at its own cap evicts instead of growing the total');
  assert.strictEqual(store.connCount(), 10);
});

test('command seq is monotonic, the outbox is trimmed at 50, and since filters', () => {
  const { store } = mk();
  target(store);
  const seqs = [];
  for (let i = 0; i < 60; i++) seqs.push(store.enqueue('u1', 'pc', 'next', {}).seq);
  assert.deepStrictEqual(seqs, seqs.slice().sort((a, b) => a - b));
  assert.strictEqual(new Set(seqs).size, 60);
  const all = store.pollTarget('u1', { deviceId: 'pc', label: 'PC', since: 0 }).commands;
  assert.strictEqual(all.length, 50);
  assert.strictEqual(all[0].seq, seqs[10]);
  const after = store.pollTarget('u1', { deviceId: 'pc', label: 'PC', since: seqs[57] }).commands;
  assert.deepStrictEqual(after.map((e) => e.seq), [seqs[58], seqs[59]]);
  assert.deepStrictEqual(store.commandsSince('u1', 'pc', seqs[58]).map((e) => e.seq), [seqs[59]]);
});

test('a newer play supersedes an older waiting play (last action wins, bounded memory)', () => {
  const { store } = mk();
  target(store);
  store.enqueue('u1', 'pc', 'play', { ids: ['a'], index: 0 });
  store.enqueue('u1', 'pc', 'pause', {});
  const p2 = store.enqueue('u1', 'pc', 'play', { ids: ['b'], index: 0 });
  const cmds = store.pollTarget('u1', { deviceId: 'pc', label: 'PC', since: 0 }).commands;
  assert.deepStrictEqual(cmds.map((e) => e.cmd), ['pause', 'play']);
  assert.strictEqual(cmds[1].seq, p2.seq);
  assert.deepStrictEqual(cmds[1].args.ids, ['b']);
});

test('seq never goes backwards when a target is dropped and registers again', () => {
  const { store } = mk();
  target(store);
  const before = store.enqueue('u1', 'pc', 'next', {}).seq;
  store.off('u1', 'pc');
  const again = target(store);
  assert.ok(again.seq >= before, 'hello seq is at least the last seq any client saw');
  assert.ok(store.enqueue('u1', 'pc', 'next', {}).seq > before);
});

test('grace: close then reopen within 10s emits nothing; past 10s emits target-gone exactly once', () => {
  const { store, tick } = mk();
  const t1 = target(store);
  const c = controller(store);
  store.closeConn(t1.connId);
  tick(9_000);
  assert.deepStrictEqual(sent(store.sweep().effects, 'target-gone'), []);
  const t2 = target(store);
  tick(20_000);
  assert.deepStrictEqual(sent(store.sweep().effects, 'target-gone'), [], 'reopened: still live');
  store.closeConn(t2.connId);
  tick(10_001);
  const fx = store.sweep().effects;
  assert.deepStrictEqual(sent(fx, 'target-gone').map((e) => e.connId), [c.connId]);
  assert.deepStrictEqual(sent(store.sweep().effects, 'target-gone'), [], 'once');
  assert.strictEqual(store.enqueue('u1', 'pc', 'pause', {}).status, 410);
});

test('a command queued during the grace window is still there when the target reconnects', () => {
  const { store, tick } = mk();
  const t1 = target(store);
  const seq0 = t1.seq;
  store.closeConn(t1.connId);
  tick(3_000);
  const q = store.enqueue('u1', 'pc', 'next', {});
  assert.strictEqual(q.ok, true);
  assert.strictEqual(q.targetConnId, null, 'nobody to push to');
  target(store);
  assert.deepStrictEqual(store.commandsSince('u1', 'pc', seq0).map((e) => e.seq), [q.seq]);
});

test('poll liveness: a poll-only target lives 10s past its last poll, then is dropped', () => {
  const { store, tick } = mk();
  assert.ok(store.pollTarget('u1', { deviceId: 'pc', label: 'PC' }).ok);
  assert.strictEqual(store.listTargets('u1', 'phone').targets.length, 1);
  tick(9_000);
  store.pollTarget('u1', { deviceId: 'pc', label: 'PC' });
  tick(9_000);
  assert.strictEqual(store.listTargets('u1', 'phone').targets.length, 1, 'the second poll extended it');
  tick(1_500);
  assert.strictEqual(store.listTargets('u1', 'phone').targets.length, 0);
  assert.strictEqual(store.enqueue('u1', 'pc', 'pause', {}).status, 410);
});

test('a poll-only target that lost its poller tells its stream controllers target-gone', () => {
  const { store, tick } = mk();
  store.pollTarget('u1', { deviceId: 'pc', label: 'PC' });
  const c = controller(store);
  assert.ok(c.ok);
  tick(10_500);
  assert.deepStrictEqual(sent(store.sweep().effects, 'target-gone').map((e) => e.connId), [c.connId]);
});

test('controller attach/detach edges fire on the first attach and the last detach only', () => {
  const { store } = mk();
  const t = target(store);
  const c1 = controller(store, 'u1', 'phone1', 'pc', 'iPhone');
  const c2 = controller(store, 'u1', 'phone2', 'pc', 'iPad');
  const attach = [...sent(c1.effects, 'controller'), ...sent(c2.effects, 'controller')];
  assert.strictEqual(attach.length, 1);
  assert.deepStrictEqual(attach[0], { type: 'send', connId: t.connId, event: 'controller', data: { attached: true, label: 'iPhone' } });
  assert.deepStrictEqual(sent(store.closeConn(c1.connId).effects, 'controller'), [], 'one still attached');
  const last = sent(store.closeConn(c2.connId).effects, 'controller');
  assert.strictEqual(last.length, 1);
  assert.strictEqual(last[0].data.attached, false);
  assert.strictEqual(store.listTargets('u1', 'x').targets[0].controlled, false);
});

test('a poll-only controller attaches, and detaches when its polls stop', () => {
  const { store, tick } = mk();
  const t = target(store);
  const p = store.pollController('u1', { deviceId: 'phone', targetId: 'pc', label: 'iPhone' });
  assert.ok(p.ok);
  assert.strictEqual(sent(p.effects, 'controller')[0].data.attached, true);
  assert.strictEqual(store.listTargets('u1', 'x').targets[0].controlled, true);
  tick(10_500);
  const fx = sent(store.sweep().effects, 'controller');
  assert.deepStrictEqual(fx.map((e) => [e.connId, e.data.attached]), [[t.connId, false]]);
});

test('a target that reconnects is told whether a controller is attached', () => {
  const { store } = mk();
  const t1 = target(store);
  controller(store);
  store.closeConn(t1.connId);
  const t2 = target(store);
  assert.deepStrictEqual(t2.controller, { attached: true, label: 'iPhone' });
});

test('state is stored with the receive time and fanned out to stream controllers only', () => {
  const { store, tick } = mk();
  target(store);
  const c = controller(store);
  store.pollController('u1', { deviceId: 'tablet', targetId: 'pc', label: 'iPad' });
  tick(1234);
  const r = store.recordState('u1', 'pc', { trackId: 't1', position: 5, duration: 100, state: 'playing', hasPrev: false, hasNext: true });
  assert.deepStrictEqual(r.controllerConnIds, [c.connId]);
  assert.strictEqual(r.state.at, store.nowMs());
  assert.strictEqual(store.recordState('u1', 'ghost', { state: 'idle' }).status, 410);
  assert.strictEqual(store.recordState('other', 'pc', { state: 'idle' }).status, 410);
  assert.strictEqual(controller(store, 'u1', 'p3', 'pc').state.trackId, 't1');
});

test('off drops the target at once (no grace) and tells its controllers', () => {
  const { store } = mk();
  const t = target(store);
  const c = controller(store);
  const fx = store.off('u1', 'pc').effects;
  assert.deepStrictEqual(sent(fx, 'target-gone').map((e) => e.connId), [c.connId]);
  assert.ok(closed(fx).includes(t.connId));
  assert.strictEqual(store.connCount(), 0);
  assert.deepStrictEqual(store.off('u1', 'pc').effects, [], 'idempotent');
});

test('per-user and global target caps bound poll-only registrations', () => {
  const { store } = mk({ perUserTargets: 2, globalTargets: 3 });
  assert.ok(store.pollTarget('u1', { deviceId: 'a', label: 'a' }).ok);
  assert.ok(store.pollTarget('u1', { deviceId: 'b', label: 'b' }).ok);
  assert.strictEqual(store.pollTarget('u1', { deviceId: 'c', label: 'c' }).status, 429);
  assert.ok(store.pollTarget('u2', { deviceId: 'a', label: 'a' }).ok);
  assert.strictEqual(store.pollTarget('u3', { deviceId: 'a', label: 'a' }).status, 503);
});

test('a controller cannot attach to a target that is gone', () => {
  const { store } = mk();
  assert.strictEqual(controller(store).status, 410);
});

test('the store is empty after every connection closes and every grace lapses (nothing to leak a timer for)', () => {
  const { store, tick } = mk();
  const t = target(store);
  const c = controller(store);
  store.closeConn(c.connId);
  store.closeConn(t.connId);
  tick(10_001);
  store.sweep();
  assert.strictEqual(store.isEmpty(), true);
});
