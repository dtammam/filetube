'use strict';

// [UNIT] v1.348 Listen Control: public/js/remote.js, the PC (target) side. The pure decisions, and
// the runtime driven through injected deps (a fake clock, fetch, EventSource and player) so every
// command, the report throttle, the poll fallback and the opt-out paths are bound.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const R = require('../../public/js/remote.js');

function harness(opts) {
  const o = opts || {};
  const timers = new Map();
  let tid = 0;
  let clock = 1000;
  const fetches = [];
  const navs = [];
  const toasts = [];
  const store = new Map();
  const calls = [];
  const sources = [];
  const listeners = {};
  const doc = { addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); }, removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x !== f); } };
  let snap = { id: 't1', position: 12, duration: 200, playing: true, hasPrev: true, hasNext: true };
  let refused = false;
  const player = {
    getRemoteSnapshot: () => snap,
    autoStartRefused: () => refused,
    play: () => calls.push('play'), pause: () => calls.push('pause'), togglePlay: () => calls.push('toggle'),
    next: () => calls.push('next'), prev: () => calls.push('prev'), seek: (s) => calls.push('seek:' + s),
  };
  class ES {
    constructor(url) { this.url = url; this.handlers = {}; this.closed = false; sources.push(this); }
    addEventListener(n, f) { this.handlers[n] = f; }
    close() { this.closed = true; }
    emit(n, d) { this.handlers[n]({ data: JSON.stringify(d) }); }
  }
  const env = {
    fetch: (u, i) => { fetches.push({ u: String(u), init: i }); return Promise.resolve({ ok: true, json: async () => (o.pollBody || {}) }); },
    EventSource: ES,
    document: doc, storage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    now: () => clock,
    setTimeout: (f, ms) => { tid += 1; timers.set(tid, { f, at: clock + ms, rep: 0 }); return tid; },
    clearTimeout: (t) => timers.delete(t),
    setInterval: (f, ms) => { tid += 1; timers.set(tid, { f, at: clock + ms, rep: ms }); return tid; },
    clearInterval: (t) => timers.delete(t),
    deviceId: () => 'dev-pc', label: () => 'Desk', player: () => player,
    navigate: (u) => navs.push(u), toast: (m) => toasts.push(m),
  };
  function advance(ms) {
    const end = clock + ms;
    for (;;) {
      let next = null; let nid = null;
      for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next.at)) { next = t; nid = id; }
      if (!next) break;
      clock = next.at;
      if (next.rep) next.at += next.rep; else timers.delete(nid);
      next.f();
    }
    clock = end;
  }
  const t = R.createTarget(env);
  return {
    t, env, fetches, navs, toasts, store, calls, sources, listeners, advance, timers,
    setSnap: (s) => { snap = s; }, refuse: (v) => { refused = v; },
    states: () => fetches.filter((f) => f.u === '/api/remote/state').map((f) => JSON.parse(f.init.body)),
    offs: () => fetches.filter((f) => f.u === '/api/remote/off'),
    attach: (label) => { sources[0].emit('hello', { seq: 0 }); sources[0].emit('controller', { attached: true, label: label || 'Phone' }); },
    media: (type) => (listeners[type] || []).forEach((f) => f({ type })),
  };
}

test('pure: the state payload maps snapshot to idle / paused / playing / blocked and clamps junk', () => {
  const base = { id: 't1', position: 5, duration: 90, hasPrev: true, hasNext: false };
  assert.strictEqual(R.buildStatePayload('d', null, false).state, 'idle');
  assert.strictEqual(R.buildStatePayload('d', { ...base, playing: true }, false).state, 'playing');
  assert.strictEqual(R.buildStatePayload('d', { ...base, playing: false }, false).state, 'paused');
  assert.strictEqual(R.buildStatePayload('d', { ...base, playing: false }, true).state, 'blocked');
  const p = R.buildStatePayload('d', { id: 't1', position: NaN, duration: -3, playing: true }, false);
  assert.strictEqual(p.position, 0);
  assert.strictEqual(p.duration, 0);
  assert.strictEqual(p.hasPrev, false);
  assert.strictEqual(R.playRoute(true), 'now');
  assert.strictEqual(R.playRoute(false), 'navigate');
  assert.strictEqual(R.throttleDelay(1000, 900), 400);
  assert.strictEqual(R.throttleDelay(1000, 400), 0);
});

test('switching on opens the target stream and stores the opt-in; off posts /off and closes it', () => {
  const h = harness();
  h.t.setOn(true);
  assert.match(h.sources[0].url, /^\/api\/remote\/stream\?role=target&deviceId=dev-pc&label=Desk$/);
  assert.strictEqual(h.store.get(R.STORAGE_KEY), '1');
  assert.strictEqual(h.t.isOn(), true);
  h.t.setOn(false);
  assert.strictEqual(h.sources[0].closed, true);
  assert.strictEqual(h.store.has(R.STORAGE_KEY), false);
  assert.strictEqual(h.offs().length, 1);
  assert.deepStrictEqual(JSON.parse(h.offs()[0].init.body), { deviceId: 'dev-pc' });
  assert.strictEqual(h.timers.size, 0, 'no timer outlives the switch');
});

test('transport commands reach the player wrappers; replays of an old seq are ignored', () => {
  const h = harness();
  h.t.setOn(true); h.attach();
  const c = (seq, cmd, args) => h.sources[0].emit('command', { seq, cmd, args: args || {} });
  c(1, 'pause'); c(2, 'toggle'); c(3, 'next'); c(4, 'prev'); c(5, 'seek', { position: 42 });
  assert.deepStrictEqual(h.calls, ['pause', 'toggle', 'next', 'prev', 'seek:42']);
  c(3, 'next'); c(5, 'seek', { position: 1 });
  assert.strictEqual(h.calls.length, 5, 'a replayed seq is dropped');
  c(6, 'rm-rf');
  assert.strictEqual(h.calls.length, 5, 'an unknown cmd does nothing');
});

test('play with the Music handler registered runs it with the resolved queue and the controller label', () => {
  const h = harness();
  const seen = [];
  h.t.setMusicPlayHandler((req) => seen.push(req));
  h.t.setOn(true); h.attach('Dean iPhone');
  h.sources[0].emit('command', { seq: 1, cmd: 'play', args: { tracks: [{ id: 'a' }, { id: 'b' }], index: 1 } });
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].index, 1);
  assert.strictEqual(seen[0].tracks.length, 2);
  assert.strictEqual(seen[0].label, 'Dean iPhone');
  assert.deepStrictEqual(h.navs, [], 'no navigation when Music is mounted');
  h.sources[0].emit('command', { seq: 2, cmd: 'play', args: { tracks: [], index: 0 } });
  h.sources[0].emit('command', { seq: 3, cmd: 'play', args: { tracks: [{ id: 'a' }], index: 5 } });
  assert.strictEqual(seen.length, 1, 'a malformed play is refused');
});

test('play off the Music page navigates to /music and runs once the handler registers', () => {
  const h = harness();
  const seen = [];
  h.t.setOn(true); h.attach();
  h.sources[0].emit('command', { seq: 1, cmd: 'play', args: { tracks: [{ id: 'a' }], index: 0 } });
  assert.deepStrictEqual(h.navs, ['/music']);
  assert.strictEqual(seen.length, 0);
  h.t.setMusicPlayHandler((req) => seen.push(req));
  assert.strictEqual(seen.length, 1, 'the pending play ran on registration');
  h.advance(9000);
  assert.strictEqual(seen.length, 1, 'and only once');
});

test('play whose Music view never mounts reports idle after 8s', () => {
  const h = harness();
  h.setSnap({ id: null, position: 0, duration: 0, playing: false, hasPrev: false, hasNext: false });
  h.t.setOn(true); h.attach();
  const before = h.states().length;
  h.sources[0].emit('command', { seq: 1, cmd: 'play', args: { tracks: [{ id: 'a' }], index: 0 } });
  h.advance(7900);
  assert.strictEqual(h.states().length, before, 'nothing before the timeout');
  h.advance(200);
  const s = h.states();
  assert.strictEqual(s[s.length - 1].state, 'idle');
});

test('a refused auto-start after play is reported as blocked', () => {
  const h = harness();
  h.t.setMusicPlayHandler(() => {});
  h.t.setOn(true); h.attach();
  h.refuse(true);
  h.setSnap({ id: 't1', position: 0, duration: 200, playing: false, hasPrev: false, hasNext: false });
  h.sources[0].emit('command', { seq: 1, cmd: 'play', args: { tracks: [{ id: 't1' }], index: 0 } });
  h.advance(1000);
  const s = h.states();
  assert.strictEqual(s[s.length - 1].state, 'blocked');
  h.refuse(false);
  h.setSnap({ id: 't1', position: 1, duration: 200, playing: true, hasPrev: false, hasNext: false });
  h.media('play');
  h.advance(600);
  const s2 = h.states();
  assert.strictEqual(s2[s2.length - 1].state, 'playing', 'the next play clears blocked');
});

test('state is reported only while a controller is attached: one on attach, throttled on media events, every 5s while playing', () => {
  const h = harness();
  h.t.setOn(true);
  h.sources[0].emit('hello', { seq: 0 });
  h.media('play'); h.advance(1000);
  assert.strictEqual(h.states().length, 0, 'no controller, no reports');
  h.sources[0].emit('controller', { attached: true, label: 'Phone' });
  assert.strictEqual(h.states().length, 1, 'one post on attach');
  h.advance(600);
  const n = h.states().length;
  h.media('pause'); h.media('seeked'); h.media('seeked'); h.media('ended');
  h.advance(2000);
  assert.strictEqual(h.states().length, n + 1, 'a burst of media events collapses to one throttled post');
  const beforeBeat = h.states().length;
  h.advance(10000);
  assert.ok(h.states().length >= beforeBeat + 2, 'the 5s beat runs while playing');
  h.sources[0].emit('controller', { attached: false, label: '' });
  const afterDetach = h.states().length;
  h.advance(15000);
  assert.strictEqual(h.states().length, afterDetach, 'detaching stops the beat');
});

test('replaced switches off WITHOUT posting /off (the new tab owns the registration) and toasts', () => {
  const h = harness();
  h.t.setOn(true);
  h.sources[0].emit('replaced', {});
  assert.strictEqual(h.t.isOn(), false);
  assert.strictEqual(h.offs().length, 0);
  assert.strictEqual(h.toasts.length, 1);
  assert.strictEqual(h.sources[0].closed, true);
});

test('no hello in 5s falls back to polling (with since), and polled commands dedupe by seq', async () => {
  const h = harness({ pollBody: { seq: 2, controller: { attached: true, label: 'Phone' }, commands: [{ seq: 1, cmd: 'pause', args: {} }, { seq: 2, cmd: 'next', args: {} }] } });
  h.t.setOn(true);
  h.advance(5100);
  assert.strictEqual(h.sources[0].closed, true, 'the buffered stream is abandoned');
  await new Promise((r) => setImmediate(r));
  assert.match(h.fetches.find((f) => f.u.startsWith('/api/remote/poll')).u, /role=target&deviceId=dev-pc&label=Desk&since=0/, 'a first poll sends since=0: commands queued before the fallback began are delivered');
  assert.deepStrictEqual(h.calls, ['pause', 'next']);
  h.advance(1600);
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(h.calls, ['pause', 'next'], 'the same commands polled again do not re-run');
  assert.ok(h.fetches.filter((f) => f.u.startsWith('/api/remote/poll')).some((f) => /since=2/.test(f.u)));
});

test('a server restart (seq counter back to 0) does not leave the target dropping every new command', () => {
  const h = harness();
  h.t.setOn(true);
  h.sources[0].emit('hello', { seq: 0 });
  h.sources[0].emit('command', { seq: 40, cmd: 'pause', args: {} });
  h.sources[0].emit('hello', { seq: 0 });
  h.sources[0].emit('command', { seq: 1, cmd: 'next', args: {} });
  assert.deepStrictEqual(h.calls, ['pause', 'next']);
});

test('a stream that never recovers past the 10s grace switches off with a toast; a hello cancels the grace', () => {
  const h = harness();
  h.t.setOn(true);
  h.sources[0].emit('hello', { seq: 0 });
  h.sources[0].onerror();
  h.advance(5000);
  h.sources[0].emit('hello', { seq: 0 });
  h.advance(20000);
  assert.strictEqual(h.t.isOn(), true, 'a reconnect inside the grace keeps it on');
  h.sources[0].onerror();
  h.advance(10100);
  assert.strictEqual(h.t.isOn(), false);
  assert.strictEqual(h.toasts.length, 1);
});

test('pagehide beacons /off with keepalive only while on', () => {
  const h = harness();
  h.t.pagehide();
  assert.strictEqual(h.offs().length, 0);
  h.t.setOn(true);
  h.t.pagehide();
  assert.strictEqual(h.offs().length, 1);
  assert.strictEqual(h.offs()[0].init.keepalive, true);
});

test('the pill shows "Controlled by <label>" as text only, Stop switches off, and it hides on detach', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const doc = dom.window.document;
  const h = harness();
  const ui = { button: (o) => { const b = doc.createElement('button'); b.textContent = o.label; return b; } };
  const pill = R.mountPill(doc, h.t, ui);
  assert.strictEqual(pill.hidden, true);
  h.t.setOn(true);
  h.sources[0].emit('controller', { attached: true, label: '<img src=x onerror=alert(1)>' });
  assert.strictEqual(pill.hidden, false);
  assert.strictEqual(pill.querySelector('.remote-pill-text').textContent, 'Controlled by <img src=x onerror=alert(1)>');
  assert.strictEqual(pill.querySelector('img'), null, 'a label is text, never markup');
  pill.querySelector('button').click();
  assert.strictEqual(h.t.isOn(), false);
  assert.strictEqual(pill.hidden, true);
});

test('onChange returns an unsubscribe (a torn-down view stops hearing changes)', () => {
  const h = harness();
  let n = 0;
  const off = h.t.onChange(() => { n += 1; });
  h.t.setOn(true);
  assert.strictEqual(n, 1);
  off();
  h.t.setOn(false);
  assert.strictEqual(n, 1);
});

test('the pill CSS uses tokens only and the [hidden] attribute wins over display:flex', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  const m = /#remote-pill\s*\{([^}]*)\}/.exec(css);
  assert.ok(m, 'pill rule');
  assert.doesNotMatch(m[1], /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'tokens only: no literal colors');
  assert.match(css, /#remote-pill\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
});

test('a report already scheduled when the controller detaches is NOT sent (the guard lives in the sender)', () => {
  const h = harness();
  h.t.setOn(true); h.attach();
  h.advance(100);
  const n = h.states().length;
  h.media('seeked');
  h.sources[0].emit('controller', { attached: false, label: '' });
  h.advance(2000);
  assert.strictEqual(h.states().length, n, 'nothing posted after the detach');
});

test('v1.349 relabel: a renamed device reopens its stream so the server learns the new label', () => {
  const h = harness();
  let label = 'Desk';
  h.env.label = () => label;
  h.t.setOn(true);
  h.attach('Phone');
  assert.match(h.sources[0].url, /label=Desk$/);
  label = 'Snowy Table';
  h.t.relabel();
  assert.strictEqual(h.sources[0].closed, true, 'the stale-label stream is closed');
  assert.strictEqual(h.sources.length, 2);
  assert.match(h.sources[1].url, /label=Snowy%20Table$/);
  h.t.setOn(false);
  const n = h.sources.length;
  h.t.relabel();
  assert.strictEqual(h.sources.length, n, 'relabel while off opens nothing');
});
