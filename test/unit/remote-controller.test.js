'use strict';

// [UNIT] v1.348 Listen Control: the CONTROLLER side of public/js/remote.js (the phone), driven through
// injected deps. Binds: the D6 play slice, the position interpolation, the command body, a lost PC never
// turning into a play, the seek throttle (the last position always goes out), restore re-validating a
// stored target, the poll fallback, and the lifecycle.

const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../../public/js/remote.js');

function harness(o) {
  o = o || {};
  const timers = new Map();
  let tid = 0; let clock = 1000;
  const fetches = []; const toasts = []; const sources = []; const store = new Map();
  class ES {
    constructor(url) { this.url = url; this.h = {}; this.closed = false; this.readyState = 1; sources.push(this); }
    addEventListener(n, f) { this.h[n] = f; }
    close() { this.closed = true; }
    emit(n, d) { this.h[n]({ data: JSON.stringify(d) }); }
  }
  const respond = o.respond || (() => ({ ok: true, status: 200, json: async () => ({}) }));
  const env = {
    fetch: (u, i) => { fetches.push({ u: String(u), init: i }); return Promise.resolve(respond(String(u), i)); },
    EventSource: ES,
    storage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    now: () => clock,
    setTimeout: (f, ms) => { tid += 1; timers.set(tid, { f, at: clock + ms }); return tid; },
    clearTimeout: (t) => timers.delete(t),
    deviceId: () => 'phone', label: () => 'Pocket', toast: (m) => toasts.push(m),
  };
  function advance(ms) {
    const end = clock + ms;
    for (;;) {
      let next = null; let nid = null;
      for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next.at)) { next = t; nid = id; }
      if (!next) break;
      clock = next.at; timers.delete(nid); next.f();
    }
    clock = end;
  }
  const c = R.createController(env);
  return { c, fetches, toasts, sources, store, advance, tick: () => new Promise((r) => setImmediate(r)),
    cmds: () => fetches.filter((f) => f.u === '/api/remote/command').map((f) => JSON.parse(f.init.body)) };
}
const PC = { deviceId: 'pc', label: 'Desk', state: { state: 'playing', position: 10, duration: 200, ageMs: 0, track: { id: 'a', title: 'T' } } };

test('slicePlay: a short list is sent whole, a long one from the picked index (D6)', () => {
  assert.deepStrictEqual(R.slicePlay(['a', 'b', 'c'], 2), { ids: ['a', 'b', 'c'], index: 2 });
  const big = Array.from({ length: R.PLAY_MAX_IDS + 500 }, (_, i) => 'id' + i);
  const s = R.slicePlay(big, 100);
  assert.strictEqual(s.ids.length, R.PLAY_MAX_IDS);
  assert.strictEqual(s.ids[0], 'id100');
  assert.strictEqual(s.index, 0);
  assert.deepStrictEqual(R.slicePlay(['a'], -4), { ids: ['a'], index: 0 });
});

test('interpolatePosition: advances only while playing, clamped to the duration', () => {
  const st = { state: 'playing', position: 10, duration: 12, ageMs: 500 };
  assert.strictEqual(R.interpolatePosition(st, 0, 1000), 11.5);
  assert.strictEqual(R.interpolatePosition(st, 0, 10000), 12);
  assert.strictEqual(R.interpolatePosition({ state: 'paused', position: 10, duration: 200 }, 0, 99999), 10);
  assert.strictEqual(R.interpolatePosition(null, 0, 5), 0);
});

test('select opens the controller stream, stores the target, and play sends the resolved command body', async () => {
  const h = harness();
  h.c.select(PC);
  assert.ok(h.c.isRemote());
  assert.match(h.sources[0].url, /^\/api\/remote\/stream\?role=controller&deviceId=phone&target=pc&label=Pocket$/);
  assert.deepStrictEqual(JSON.parse(h.store.get(R.CONTROL_KEY)), { deviceId: 'pc', label: 'Desk' });
  await h.c.play(['a', 'b'], 1);
  assert.deepStrictEqual(h.cmds(), [{ fromDeviceId: 'phone', targetDeviceId: 'pc', cmd: 'play', args: { ids: ['a', 'b'], index: 1 } }]);
  h.c.toggle(); h.c.next(); h.c.prev();
  assert.deepStrictEqual(h.cmds().slice(1).map((x) => x.cmd), ['toggle', 'next', 'prev']);
});

test('with no target nothing is sent', async () => {
  const h = harness();
  assert.strictEqual(await h.c.play(['a'], 0), false);
  assert.strictEqual(h.fetches.length, 0);
});

test('a 410 on a command means the PC is gone: leave, toast, never a local play', async () => {
  const h = harness({ respond: () => ({ ok: false, status: 410, json: async () => ({}) }) });
  h.c.select(PC);
  await h.c.play(['a'], 0);
  assert.strictEqual(h.c.isRemote(), false);
  assert.deepStrictEqual(h.toasts, ['Lost Desk']);
  assert.strictEqual(h.store.get(R.CONTROL_KEY), undefined);
});

test('state events update the mirror; target-gone drops control', () => {
  const h = harness();
  h.c.select(PC);
  h.sources[0].emit('state', { state: 'paused', position: 50, duration: 200, ageMs: 0 });
  assert.strictEqual(h.c.state().state, 'paused');
  assert.strictEqual(h.c.position(), 50);
  h.sources[0].emit('target-gone', {});
  assert.strictEqual(h.c.isRemote(), false);
  assert.deepStrictEqual(h.toasts, ['Lost Desk']);
});

test('seek: throttled to one per 250 ms, the last position always goes out, the bar holds the drag', async () => {
  const h = harness();
  h.c.select(PC);
  h.c.seek(20); h.c.seek(30); h.c.seek(40);
  assert.strictEqual(h.c.position(), 40);
  await h.tick();
  assert.deepStrictEqual(h.cmds().map((x) => x.args.position), [20]);
  h.advance(300);
  await h.tick();
  assert.deepStrictEqual(h.cmds().map((x) => x.args.position), [20, 40]);
});

test('no hello within 5 s falls back to polling every 2 s; a 404 from the poll drops the PC', async () => {
  let status = 200;
  const h = harness({ respond: (u) => (u.startsWith('/api/remote/poll') ? { ok: status === 200, status, json: async () => ({ state: { state: 'paused', position: 3, duration: 9 } }) } : { ok: true, status: 200, json: async () => ({}) }) });
  h.c.select(PC);
  h.advance(5001);
  await h.tick();
  assert.strictEqual(h.sources[0].closed, true);
  assert.strictEqual(h.fetches.filter((f) => f.u.startsWith('/api/remote/poll?role=controller&deviceId=phone&target=pc')).length, 1);
  assert.strictEqual(h.c.state().position, 3);
  h.advance(2000); await h.tick();
  assert.strictEqual(h.fetches.filter((f) => f.u.startsWith('/api/remote/poll')).length, 2);
  status = 404;
  h.advance(2000); await h.tick(); await h.tick();
  assert.strictEqual(h.c.isRemote(), false);
});

test('restore re-validates the stored target before reopening; a vanished PC is dropped', async () => {
  let targets = [];
  const h = harness({ respond: (u) => ({ ok: true, status: 200, json: async () => (u.startsWith('/api/remote/targets') ? targets : {}) }) });
  h.store.set(R.CONTROL_KEY, JSON.stringify({ deviceId: 'pc', label: 'Desk' }));
  h.c.restore();
  assert.strictEqual(h.sources.length, 0);
  await h.tick(); await h.tick();
  assert.strictEqual(h.c.isRemote(), false);
  assert.deepStrictEqual(h.toasts, ['Lost Desk']);

  targets = [PC];
  h.store.set(R.CONTROL_KEY, JSON.stringify({ deviceId: 'pc', label: 'Desk' }));
  h.c.restore();
  await h.tick(); await h.tick();
  assert.ok(h.c.isRemote());
  assert.strictEqual(h.sources.length, 1);
});

test('hidden closes the stream; visible re-checks the PC and reopens', async () => {
  const h = harness({ respond: (u) => ({ ok: true, status: 200, json: async () => (u.startsWith('/api/remote/targets') ? [PC] : {}) }) });
  h.c.select(PC);
  h.c.visibility(true);
  assert.strictEqual(h.sources[0].closed, true);
  h.c.visibility(false);
  await h.tick(); await h.tick();
  assert.strictEqual(h.sources.length, 2);
  assert.strictEqual(h.sources[1].closed, false);
});

test('leave clears the stored target and stops the stream', () => {
  const h = harness();
  h.c.select(PC);
  h.c.leave();
  assert.strictEqual(h.c.isRemote(), false);
  assert.strictEqual(h.sources[0].closed, true);
  assert.strictEqual(h.store.get(R.CONTROL_KEY), undefined);
});

// ---- v1.353: the speaker's player volume ---------------------------------------------------------

test('v1.353 volume: throttled to one per 250 ms, the LAST level always goes out (clamped, rounded)', async () => {
  const h = harness();
  h.c.select(PC);
  h.c.volume(0.5);
  h.c.volume(0.55); h.c.volume(0.6); h.c.volume(0.65);
  assert.deepStrictEqual(h.cmds().map((x) => [x.cmd, x.args.level]), [['volume', 0.5]], 'the first goes at once, the rest wait');
  h.advance(249);
  assert.strictEqual(h.cmds().length, 1, 'nothing inside the window');
  h.advance(1);
  assert.deepStrictEqual(h.cmds().map((x) => x.args.level), [0.5, 0.65], 'one more at 250 ms, and it is the last level');
  h.advance(1000);
  assert.strictEqual(h.cmds().length, 2, 'nothing else queued');
  h.c.volume(1.7);
  h.c.volume(0.3333); h.advance(250);
  assert.deepStrictEqual(h.cmds().slice(2).map((x) => x.args.level), [1, 0.33]);
  for (const bad of [NaN, Infinity, '0.5', null]) h.c.volume(bad);
  h.advance(1000);
  assert.strictEqual(h.cmds().length, 4, 'a non-number never goes out');
});

test('v1.353 volume: the shown level holds where the wheel put it until the PC reports it (a stale report cannot snap it back)', () => {
  const h = harness();
  h.c.select(PC);
  h.sources[0].emit('state', Object.assign({}, PC.state, { volume: 0.5 }));
  h.c.volume(0.8);
  assert.strictEqual(h.c.state().volume, 0.8, 'shown at once');
  h.advance(300);
  h.sources[0].emit('state', Object.assign({}, PC.state, { volume: 0.5 })); // sent by the PC before the command landed
  assert.strictEqual(h.c.state().volume, 0.8, 'held');
  h.sources[0].emit('state', Object.assign({}, PC.state, { volume: 0.8 })); // the PC caught up
  assert.strictEqual(h.c.state().volume, 0.8);
  h.sources[0].emit('state', Object.assign({}, PC.state, { volume: 0.2 })); // then someone at the PC moved it
  assert.strictEqual(h.c.state().volume, 0.2, 'the hold ended once the PC reported it: the PC wins again');
});

test('v1.353 volume: a hold the PC never confirms ends after 1.5 s from the send, and the PC\'s level shows', () => {
  const h = harness();
  h.c.select(PC);
  h.c.volume(0.9);
  h.advance(1400);
  h.sources[0].emit('state', Object.assign({}, PC.state, { volume: 0.4 }));
  assert.strictEqual(h.c.state().volume, 0.9, 'inside the hold');
  h.advance(200);
  h.sources[0].emit('state', Object.assign({}, PC.state, { volume: 0.4 }));
  assert.strictEqual(h.c.state().volume, 0.4, 'after it, the PC is the truth');
});

test('v1.353 volume: leave drops a pending level (nothing is sent to a PC this phone left) and with no target nothing is sent', () => {
  const h = harness();
  h.c.volume(0.5);
  assert.strictEqual(h.cmds().length, 0, 'no target');
  h.c.select(PC);
  h.c.volume(0.5); h.c.volume(0.6);
  h.c.leave();
  h.advance(1000);
  assert.deepStrictEqual(h.cmds().map((x) => x.args.level), [0.5], 'the pending 0.6 died with the session');
});

test('v1.353 volume: a level still waiting when this phone leaves never reaches the NEXT speaker it picks', () => {
  const h = harness();
  h.c.select(PC);
  h.c.volume(0.5); h.c.volume(0.6); // 0.6 waits out the throttle
  h.c.leave();
  h.c.select({ deviceId: 'pc2', label: 'Den', state: PC.state });
  h.advance(1000);
  const sent = h.cmds().map((x) => [x.targetDeviceId, x.args.level]);
  assert.deepStrictEqual(sent, [['pc', 0.5]], 'nothing went to pc2');
});

test('v1.353 gate r1 (qa W1 = adversary W1): a DIRECT switch to another speaker drops the waiting level and the hold', () => {
  const h = harness();
  h.c.select(PC);
  h.c.volume(0.25); h.c.volume(0.3); // 0.3 waits out the throttle; 0.3 is held on screen
  h.c.select({ deviceId: 'pc2', label: 'Den', state: Object.assign({}, PC.state, { volume: 0.9 }) }); // no leave() between
  h.advance(1000);
  assert.deepStrictEqual(h.cmds().map((x) => [x.targetDeviceId, x.args.level]), [['pc', 0.25]], 'nothing went to pc2');
  h.sources[1].emit('state', Object.assign({}, PC.state, { volume: 0.9 })); // pc2's first frame
  assert.strictEqual(h.c.state().volume, 0.9, 'pc2 shows its own level, not the held 0.3');
});

test('v1.353 gate r1 (Dean: a muted PC shows empty, up un-mutes): a level above 0 shows un-muted at once and holds; 0 keeps the mute', () => {
  const h = harness();
  h.c.select(PC);
  h.sources[0].emit('state', Object.assign({}, PC.state, { volume: 0.5, muted: true }));
  h.c.volume(0.05);
  assert.deepStrictEqual([h.c.state().volume, h.c.state().muted], [0.05, false], 'shown un-muted at once');
  h.advance(300);
  h.sources[0].emit('state', Object.assign({}, PC.state, { volume: 0.5, muted: true })); // sent before the command landed
  assert.deepStrictEqual([h.c.state().volume, h.c.state().muted], [0.05, false], 'held un-muted');
  const g = harness();
  g.c.select(PC);
  g.sources[0].emit('state', Object.assign({}, PC.state, { volume: 0.5, muted: true }));
  g.c.volume(0);
  assert.deepStrictEqual([g.c.state().volume, g.c.state().muted], [0, true], '0 never un-mutes');
});

// ---- v1.378.0 music stations W4 (D11, D12) ----------------------------------------------------------
test('v1.378.0 D11: play with a station sends its seed and name; without one the command is as before; the mirror keeps the state\'s radio', async () => {
  const h = harness();
  h.c.select(PC);
  await h.c.play(['a', 'b'], 1, { seed: 'station:s:reggae', name: 'Reggae' });
  assert.deepStrictEqual(h.cmds()[0].args, { ids: ['a', 'b'], index: 1, radio: { seed: 'station:s:reggae', name: 'Reggae' } });
  await h.c.play(['a'], 0, null);
  assert.deepStrictEqual(h.cmds()[1].args, { ids: ['a'], index: 0 });
  await h.c.play(['a'], 0, { seed: '', name: 'x' });
  assert.deepStrictEqual(h.cmds()[2].args, { ids: ['a'], index: 0 }, 'no seed, no station');
  h.sources[0].emit('state', { deviceId: 'pc', state: 'playing', position: 1, duration: 10, track: { id: 'a', title: 'A' }, radio: { name: 'Reggae' } });
  assert.deepStrictEqual(h.c.state().radio, { name: 'Reggae' });
});
