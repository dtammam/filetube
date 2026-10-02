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
    setVolume: (v) => calls.push('volume:' + v),
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
    userActivation: o.userActivation ? () => o.userActivation : undefined,
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
    // the player raising/lowering its refused flag (player.js setAutoStartRefused dispatches this)
    autostart: (on) => { refused = on; (listeners['filetube:autostart'] || []).forEach((f) => f({ type: 'filetube:autostart', detail: { refused: on } })); },
  };
}

test('pure: the state payload maps snapshot to idle / paused / playing / blocked and clamps junk', () => {
  const base = { id: 't1', position: 5, duration: 90, hasPrev: true, hasNext: false };
  assert.strictEqual(R.buildStatePayload('d', null, false).state, 'idle');
  assert.strictEqual(R.buildStatePayload('d', { ...base, playing: true }, false).state, 'playing');
  assert.strictEqual(R.buildStatePayload('d', { ...base, playing: false }, false).state, 'paused');
  assert.strictEqual(R.buildStatePayload('d', { ...base, playing: false }, true).state, 'blocked');
  assert.strictEqual(R.buildStatePayload('d', null, false, true).needsClick, true, 'idle still carries needsClick');
  assert.strictEqual(R.buildStatePayload('d', base, false).needsClick, false);
  assert.strictEqual(R.needsClickNow({ hasBeenActive: false }), true);
  assert.strictEqual(R.needsClickNow({ hasBeenActive: true }), false);
  assert.strictEqual(R.needsClickNow(null), false);
  assert.strictEqual(R.needsClickNow({}), false, 'an object without the field is not a refusal');
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

test('v1.352 W0: a refusal that lands 3s after the play (a slow saved-position fetch) is still reported as blocked', () => {
  const h = harness();
  h.t.setMusicPlayHandler(() => {});
  h.t.setOn(true); h.attach();
  h.setSnap({ id: 't1', position: 0, duration: 200, playing: false, hasPrev: false, hasNext: false });
  h.sources[0].emit('command', { seq: 1, cmd: 'play', args: { tracks: [{ id: 't1' }], index: 0 } });
  h.advance(3000);
  assert.ok(h.states().every((x) => x.state !== 'blocked'), 'nothing refused yet');
  const n = h.states().length;
  h.autostart(true);
  assert.strictEqual(h.states().length, n + 1, 'the refusal is posted at once, not on a timer');
  assert.strictEqual(h.states()[n].state, 'blocked');
  h.setSnap({ id: 't1', position: 1, duration: 200, playing: true, hasPrev: false, hasNext: false });
  h.autostart(false);
  const s2 = h.states();
  assert.strictEqual(s2[s2.length - 1].state, 'playing', 'the element playing lowers the flag and is posted at once');
});

test('v1.352 W0: blocked is the player flag read at each report (a refused play/pause from the phone, a controller attaching late)', () => {
  const h = harness();
  h.setSnap({ id: 't1', position: 0, duration: 200, playing: false, hasPrev: false, hasNext: false });
  h.refuse(true);
  h.t.setOn(true); h.attach();
  assert.strictEqual(h.states()[0].state, 'blocked', 'a refusal from before the phone attached is reported on attach');
  h.refuse(false);
  h.sources[0].emit('command', { seq: 1, cmd: 'toggle', args: {} });
  h.advance(600);
  const n = h.states().length;
  h.autostart(true); // player.js togglePlayPause: the element refused the play
  assert.strictEqual(h.states().length, n + 1);
  assert.strictEqual(h.states()[n].state, 'blocked');
  h.t.setOn(false);
  assert.ok(!h.listeners['filetube:autostart'] || h.listeners['filetube:autostart'].length === 0, 'switching off unbinds the listener');
});

test('v1.352 W0: needsClick is true while the tab has had no click, posted on attach, and cleared by the first input', () => {
  const ua = { hasBeenActive: false };
  const h = harness({ userActivation: ua });
  const seen = [];
  h.t.onChange((on, attached, label, nc) => seen.push(nc));
  h.t.setOn(true);
  assert.strictEqual(h.t.needsClick(), true);
  assert.strictEqual(seen[seen.length - 1], true, 'the pill hears it before any phone attaches');
  h.attach();
  assert.strictEqual(h.states()[0].needsClick, true, 'reported on attach, before any song');
  const n = h.states().length;
  (h.listeners.keydown || []).forEach((f) => f({ type: 'keydown' }));
  h.advance(1);
  assert.strictEqual(h.states().length, n, 'an input the browser did not count changes nothing');
  ua.hasBeenActive = true;
  (h.listeners.pointerdown || []).forEach((f) => f({ type: 'pointerdown' }));
  h.advance(1);
  assert.strictEqual(h.states().length, n + 1, 'the first counted input posts at once');
  assert.strictEqual(h.states()[n].needsClick, false);
  assert.strictEqual(h.t.needsClick(), false);
  assert.strictEqual(seen[seen.length - 1], false, 'and the pill hears it');
});

test('v1.352 W0: needsClick is false without navigator.userActivation, and a stale true is lowered at the next report', () => {
  const h = harness();
  h.t.setOn(true); h.attach();
  assert.strictEqual(h.states()[0].needsClick, false, 'no userActivation: never a false alarm');
  const ua = { hasBeenActive: false };
  const h2 = harness({ userActivation: ua });
  h2.t.setOn(true); h2.attach();
  assert.strictEqual(h2.states()[0].needsClick, true);
  ua.hasBeenActive = true; // activated by an input the listeners do not see (a touchend)
  h2.media('seeked'); h2.advance(600);
  const s = h2.states();
  assert.strictEqual(s[s.length - 1].needsClick, false);
});

test('v1.352 W0: the pill asks for a click on the PC while On and unclicked, and the click hides it', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const doc = dom.window.document;
  const ua = { hasBeenActive: false };
  const h = harness({ userActivation: ua });
  const ui = { button: (o) => { const b = doc.createElement('button'); b.textContent = o.label; return b; } };
  const pill = R.mountPill(doc, h.t, ui);
  h.t.setOn(true);
  assert.strictEqual(pill.hidden, false, 'shown with no phone attached');
  assert.strictEqual(pill.querySelector('.remote-pill-text').textContent, 'Click anywhere so your phone can play music here');
  ua.hasBeenActive = true;
  (h.listeners.click || []).forEach((f) => f({ type: 'click' }));
  h.advance(1);
  assert.strictEqual(pill.hidden, true, 'hidden on the first click (no phone attached)');
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

test('v1.349 relabel across tabs: a storage event for ft-device-name reopens the stream, other keys do not', () => {
  const h = harness();
  const winListeners = {};
  const w = {
    document: { readyState: 'complete', body: null, addEventListener() {} },
    sessionStorage: { getItem: () => null },
    addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); },
  };
  R.bootWhenReady(w, h.t, null);
  h.t.setOn(true);
  assert.strictEqual(h.sources.length, 1);
  (winListeners.storage || []).forEach((f) => f({ key: 'ft-something-else' }));
  assert.strictEqual(h.sources.length, 1, 'an unrelated key changes nothing');
  assert.ok(winListeners.storage && winListeners.storage.length, 'a storage listener is registered');
  winListeners.storage.forEach((f) => f({ key: 'ft-device-name' }));
  assert.strictEqual(h.sources.length, 2, 'the device name key reopens the stream');
  assert.strictEqual(h.sources[0].closed, true);
});

// ---- v1.352 W1: ?remote=on ------------------------------------------------

test('v1.352 W1: wantsRemoteOn acts only on remote=on exactly', () => {
  assert.strictEqual(R.wantsRemoteOn('?remote=on'), true);
  assert.strictEqual(R.wantsRemoteOn('?a=1&remote=on&b=2'), true);
  for (const s of ['?remote=On', '?remote=1', '?remote=', '?remote=off', '', '?x=remote=on', '?remote', '?remote=on%20', null, undefined]) {
    assert.strictEqual(R.wantsRemoteOn(s), false, String(s));
  }
});

function realRemote(url, opts) {
  const o = opts || {};
  const dom = new JSDOM('<!doctype html><body></body>', { url, runScripts: 'outside-only' });
  const w = dom.window;
  const replaces = [];
  if (o.state) w.history.replaceState(o.state, '', url);
  const realReplace = w.history.replaceState.bind(w.history);
  w.history.replaceState = (st, t, u) => { replaces.push({ st, u }); return realReplace(st, t, u); };
  const toasts = [];
  const sources = [];
  w.showToast = (m) => toasts.push(m);
  w.fetch = () => Promise.resolve({ ok: true, json: async () => [] });
  w.EventSource = class { constructor(u) { this.url = u; sources.push(u); } addEventListener() {} close() {} };
  w.FileTube = { getDeviceId: () => 'dev-1', getDeviceLabel: () => 'Desk', player: null, navigate() {} };
  if (o.blockStorage) Object.defineProperty(w, 'sessionStorage', { get() { throw new Error('blocked'); } });
  w.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'remote.js'), 'utf8'));
  const atEval = { url: w.location.pathname + w.location.search, on: w.FileTube.remote.isOn() };
  const booted = new Promise((res) => { if (w.document.readyState === 'loading') w.document.addEventListener('DOMContentLoaded', () => res()); else res(); });
  return { w, replaces, toasts, sources, atEval, booted, close: () => w.close() };
}

test('v1.352 W1: the real script at /music?remote=on&nowplaying=1 turns On once, strips only remote (URL and history.state.url), and toasts once', async () => {
  const r = realRemote('http://localhost/music?remote=on&nowplaying=1#x', { state: { view: 'music', url: '/music?remote=on&nowplaying=1', depth: 3, scrollY: 40 } });
  try {
    assert.deepStrictEqual(r.atEval, { url: '/music?nowplaying=1', on: false }, 'stripped while the script runs, before DOMContentLoaded (the router boots then)');
    await r.booted;
    assert.strictEqual(r.w.FileTube.remote.isOn(), true);
    assert.strictEqual(r.sources.length, 1, 'one stream: setOn ran once');
    assert.strictEqual(r.w.sessionStorage.getItem('ft-remote-target-on'), '1', 'the per-tab flag: a reload stays On');
    assert.strictEqual(r.w.location.pathname + r.w.location.search + r.w.location.hash, '/music?nowplaying=1#x');
    assert.strictEqual(r.replaces.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.w.history.state)), { view: 'music', url: '/music?nowplaying=1', depth: 3, scrollY: 40 }, 'state.url rewritten, every other key kept');
    assert.deepStrictEqual(r.toasts, [R.LINK_TOAST]);
  } finally { r.close(); }
});

test('v1.352 W1: a fresh load (no history.state yet) strips too and leaves the state for the router to seed', async () => {
  const r = realRemote('http://localhost/?remote=on');
  try {
    await r.booted;
    assert.strictEqual(r.w.location.search, '');
    assert.strictEqual(r.w.history.state, null);
    assert.strictEqual(r.w.FileTube.remote.isOn(), true);
  } finally { r.close(); }
});

test('v1.352 W1: any other remote value is stripped but acts on nothing; no param touches nothing', async () => {
  const off = realRemote('http://localhost/music?remote=off&a=1');
  try {
    await off.booted;
    assert.strictEqual(off.w.FileTube.remote.isOn(), false, '?remote=off cannot switch anything');
    assert.strictEqual(off.w.location.search, '?a=1');
    assert.deepStrictEqual(off.toasts, []);
  } finally { off.close(); }
  const none = realRemote('http://localhost/music?a=1');
  try {
    await none.booted;
    assert.strictEqual(none.replaces.length, 0, 'no history write without the param');
    assert.strictEqual(none.w.FileTube.remote.isOn(), false);
  } finally { none.close(); }
});

test('v1.352 W1: a blocked sessionStorage still turns the page On', async () => {
  const r = realRemote('http://localhost/music?remote=on', { blockStorage: true });
  try {
    await r.booted;
    assert.strictEqual(r.w.FileTube.remote.isOn(), true);
    assert.strictEqual(r.sources.length, 1);
  } finally { r.close(); }
});

// ---- v1.352 gate r1 -------------------------------------------------------

test('v1.352 gate r1: sound that starts clears needsClick (a kiosk or allow-autoplay tab never clicked), posted at once', () => {
  const ua = { hasBeenActive: false }; // stays false: the browser allowed sound without a click
  const h = harness({ userActivation: ua });
  const seen = [];
  h.t.onChange((on, attached, label, nc) => seen.push(nc));
  h.t.setOn(true); h.attach();
  assert.strictEqual(h.states()[0].needsClick, true);
  const n = h.states().length;
  (h.listeners.playing || []).forEach((f) => f({ type: 'playing' }));
  assert.strictEqual(h.states().length, n + 1, 'posted at once');
  assert.strictEqual(h.states()[n].needsClick, false);
  assert.strictEqual(h.t.needsClick(), false);
  assert.strictEqual(seen[seen.length - 1], false, 'the pill hears it');
  h.media('seeked'); h.advance(600);
  const s = h.states();
  assert.strictEqual(s[s.length - 1].needsClick, false, 'and it stays down although hasBeenActive is still false');
});

test('v1.352 gate r1 (Dean): on a phone ?remote=on is stripped but turns nothing on', async () => {
  const dom = new JSDOM('<!doctype html><html class="is-phone"><body></body></html>', { url: 'http://localhost/music?remote=on&mode=shuffle', runScripts: 'outside-only' });
  const w = dom.window;
  const toasts = [];
  w.showToast = (m) => toasts.push(m);
  w.fetch = () => Promise.resolve({ ok: true, json: async () => [] });
  w.EventSource = class { addEventListener() {} close() {} };
  w.FileTube = { getDeviceId: () => 'dev-1', getDeviceLabel: () => 'Phone', player: null, navigate() {} };
  w.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'remote.js'), 'utf8'));
  await new Promise((res) => { if (w.document.readyState === 'loading') w.document.addEventListener('DOMContentLoaded', () => res()); else res(); });
  try {
    assert.strictEqual(w.location.search, '?mode=shuffle', 'the param leaves the address bar, the rest stays');
    assert.strictEqual(w.FileTube.remote.isOn(), false, 'a phone is never a target');
    assert.strictEqual(w.sessionStorage.getItem('ft-remote-target-on'), null);
    assert.deepStrictEqual(toasts, []);
  } finally { w.close(); }
});

// ---- v1.352 (Dean): the chapter playing on the PC is the one the phone hears ----

test('v1.352 reportedTrackId: the view\'s chapter wins only when it is a chapter of the LOADED file', () => {
  assert.strictEqual(R.reportedTrackId('f1::c0', 'f1::c2'), 'f1::c2');
  assert.strictEqual(R.reportedTrackId('f1', 'f1::c1'), 'f1::c1', 'a file loaded by its base id');
  assert.strictEqual(R.reportedTrackId('f1::c0', 'f2::c1'), 'f1::c0', 'another file: the player wins');
  assert.strictEqual(R.reportedTrackId('f1::c0', 'f1'), 'f1::c0', 'not a chapter id');
  assert.strictEqual(R.reportedTrackId('f1::c0', null), 'f1::c0');
  assert.strictEqual(R.reportedTrackId(null, 'f1::c1'), null, 'nothing loaded: idle stays idle');
  assert.strictEqual(R.reportedTrackId('f1::c0', 'f1::c1x'), 'f1::c0');
});

test('v1.352: the Music view\'s chapter is reported, and a rollover posts at once (trackChanged)', () => {
  const h = harness();
  h.setSnap({ id: 'f1::c0', position: 24, duration: 60, playing: true, hasPrev: true, hasNext: true });
  let view = 'f1::c0';
  h.t.setNowPlayingResolver(() => view);
  h.t.setOn(true); h.attach();
  assert.strictEqual(h.states()[0].trackId, 'f1::c0');
  h.advance(600);
  const n = h.states().length;
  view = 'f1::c1'; // reflectChapter rolled the chapter on screen
  h.t.trackChanged();
  h.advance(600);
  assert.ok(h.states().length > n, 'the rollover is reported without waiting for the 5 s beat');
  assert.strictEqual(h.states()[h.states().length - 1].trackId, 'f1::c1');
  view = 'f9::c3'; // a stale view of another file
  h.t.trackChanged(); h.advance(600);
  assert.strictEqual(h.states()[h.states().length - 1].trackId, 'f1::c0', 'never another file\'s chapter');
  h.t.setNowPlayingResolver(null);
  h.t.trackChanged(); h.advance(600);
  assert.strictEqual(h.states()[h.states().length - 1].trackId, 'f1::c0', 'no view: the player\'s own id');
});

test('v1.352 gate r2: a MUTED element playing does not clear needsClick (only audible sound proves the browser allows it)', () => {
  const ua = { hasBeenActive: false };
  const h = harness({ userActivation: ua });
  h.t.setOn(true); h.attach();
  (h.listeners.playing || []).forEach((f) => f({ type: 'playing', target: { muted: true, volume: 1 } }));
  assert.strictEqual(h.t.needsClick(), true, 'a muted hover preview');
  (h.listeners.playing || []).forEach((f) => f({ type: 'playing', target: { muted: false, volume: 0 } }));
  assert.strictEqual(h.t.needsClick(), true, 'volume 0');
  (h.listeners.playing || []).forEach((f) => f({ type: 'playing', target: { muted: false, volume: 1 } }));
  assert.strictEqual(h.t.needsClick(), false);
});

test('v1.352 gate r2: the playing listener is a CAPTURE listener (media events do not bubble to document)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'remote.js'), 'utf8');
  assert.match(src, /env\.document\.addEventListener\('playing', onPlaying, true\);/);
  assert.match(src, /env\.document\.removeEventListener\('playing', onPlaying, true\);/);
});

// ---- v1.353: the phone sets this PC's player volume ----------------------------------------------

test('v1.353 the volume command reaches player.setVolume with its level, then reports', () => {
  const h = harness();
  h.t.setOn(true); h.attach();
  const n = h.states().length;
  h.sources[0].emit('command', { seq: 1, cmd: 'volume', args: { level: 0.37 } });
  assert.deepStrictEqual(h.calls, ['volume:0.37']);
  h.advance(600);
  assert.strictEqual(h.states().length, n + 1, 'a report follows the command');
  h.sources[0].emit('command', { seq: 1, cmd: 'volume', args: { level: 0.9 } });
  assert.deepStrictEqual(h.calls, ['volume:0.37'], 'a replayed seq is dropped');
});

test('v1.353 pure: the payload carries volume (rounded, clamped, null when unknown) and muted (only a literal true)', () => {
  const base = { id: 't1', position: 5, duration: 90, playing: true };
  assert.strictEqual(R.buildStatePayload('d', { ...base, volume: 0.333333 }, false).volume, 0.33);
  assert.strictEqual(R.buildStatePayload('d', { ...base, volume: 0 }, false).volume, 0);
  assert.strictEqual(R.buildStatePayload('d', { ...base, volume: 1 }, false).volume, 1);
  assert.strictEqual(R.buildStatePayload('d', { ...base, volume: 1.4 }, false).volume, 1);
  assert.strictEqual(R.buildStatePayload('d', { ...base, volume: -0.2 }, false).volume, 0);
  assert.strictEqual(R.buildStatePayload('d', { ...base, volume: NaN }, false).volume, null);
  assert.strictEqual(R.buildStatePayload('d', { ...base, volume: '0.5' }, false).volume, null);
  assert.strictEqual(R.buildStatePayload('d', base, false).volume, null, 'a player that cannot say reports null');
  assert.strictEqual(R.buildStatePayload('d', null, false).volume, null, 'idle with no snapshot');
  assert.strictEqual(R.buildStatePayload('d', { volume: 0.4, muted: true }, false).volume, 0.4, 'idle still carries a volume');
  assert.strictEqual(R.buildStatePayload('d', { ...base, muted: true }, false).muted, true);
  assert.strictEqual(R.buildStatePayload('d', { ...base, muted: 'yes' }, false).muted, false);
  assert.strictEqual(R.buildStatePayload('d', base, false).muted, false);
});

test('v1.353 a volume change made AT the PC (its slider, its keys) is reported to the phone', () => {
  const h = harness();
  h.t.setOn(true); h.attach();
  h.advance(600);
  const n = h.states().length;
  h.setSnap({ id: 't1', position: 12, duration: 200, playing: false, volume: 0.8, muted: false });
  h.media('volumechange');
  h.advance(600);
  assert.strictEqual(h.states().length, n + 1);
  assert.strictEqual(h.states()[n].volume, 0.8);
});

test('v1.353 volumechange is a CAPTURE listener, bound and unbound with the other media events', () => {
  const h = harness();
  h.t.setOn(true);
  assert.strictEqual((h.listeners.volumechange || []).length, 1, 'bound while On');
  h.t.setOn(false);
  assert.strictEqual((h.listeners.volumechange || []).length, 0, 'unbound when Off');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'remote.js'), 'utf8');
  assert.match(src, /env\.document\.addEventListener\(t, t === 'volumechange' \? onVolume : onMedia, true\);/);
});

test('v1.353 a remote volume of 0 then 0.5 on an activated tab never raises needsClick', () => {
  const h = harness({ userActivation: { hasBeenActive: true } });
  h.t.setOn(true); h.attach();
  for (const [seq, level, vol] of [[1, 0, 0], [2, 0.5, 0.5]]) {
    h.sources[0].emit('command', { seq, cmd: 'volume', args: { level } });
    h.setSnap({ id: 't1', position: 12, duration: 200, playing: true, volume: vol, muted: false });
    (h.listeners.volumechange || []).forEach((f) => f({ type: 'volumechange', target: { paused: false, muted: false, volume: vol } }));
    h.advance(600);
  }
  assert.ok(h.states().length >= 3);
  assert.ok(h.states().every((x) => x.needsClick === false), JSON.stringify(h.states().map((x) => x.needsClick)));
  assert.strictEqual(h.t.needsClick(), false);
});

test('v1.353 an unclicked tab playing at volume 0 keeps the hint until the phone turns it up; then it clears at once', () => {
  const ua = { hasBeenActive: false }; // a kiosk: allowed to play, never clicked
  const h = harness({ userActivation: ua });
  const fire = (target) => (h.listeners.volumechange || []).forEach((f) => f({ type: 'volumechange', target }));
  h.t.setOn(true); h.attach();
  (h.listeners.playing || []).forEach((f) => f({ type: 'playing', target: { muted: false, volume: 0 } }));
  assert.strictEqual(h.t.needsClick(), true, 'silent sound proves nothing');
  fire({ paused: false, muted: false, volume: 0 });
  assert.strictEqual(h.t.needsClick(), true, 'still silent');
  fire({ paused: true, muted: false, volume: 0.5 });
  assert.strictEqual(h.t.needsClick(), true, 'a PAUSED element turned up proves nothing');
  fire({ paused: false, muted: true, volume: 0.5 });
  assert.strictEqual(h.t.needsClick(), true, 'muted proves nothing');
  const n = h.states().length;
  fire({ paused: false, muted: false, volume: 0.5 });
  assert.strictEqual(h.t.needsClick(), false, 'audible playing sound: the browser allows it');
  assert.strictEqual(h.states().length, n + 1, 'posted at once');
  assert.strictEqual(h.states()[n].needsClick, false);
});

test('v1.353 the idle report after a play whose Music view never mounts still carries the volume', () => {
  const h = harness();
  h.setSnap({ id: null, position: 0, duration: 0, playing: false, volume: 0.6, muted: true });
  h.t.setOn(true); h.attach();
  h.sources[0].emit('command', { seq: 1, cmd: 'play', args: { tracks: [{ id: 'a' }], index: 0 } });
  const n = h.states().length;
  h.advance(8100);
  const after = h.states().slice(n);
  const idle = after[after.length - 1];
  assert.strictEqual(idle.state, 'idle');
  assert.strictEqual(idle.volume, 0.6);
  assert.strictEqual(idle.muted, true);
});

test('v1.354 queueWindow: 100 either side of the current song, listen items skipped, the index follows its song', () => {
  const ids = Array.from({ length: 1000 }, (_, i) => 's' + i);
  const w = R.queueWindow(ids, 500);
  assert.strictEqual(w.ids.length, 201);
  assert.strictEqual(w.ids[w.index], 's500');
  assert.strictEqual(w.ids[0], 's400');
  const edge = R.queueWindow(ids, 3);
  assert.deepStrictEqual([edge.ids.length, edge.index], [104, 3], 'near the start the window is short, not shifted');
  const items = [{ id: 'a' }, { id: 'v', listen: true }, { id: 'b' }, { id: 'c' }];
  assert.deepStrictEqual(R.queueWindow(items, 2), { ids: ['a', 'b', 'c'], index: 1 }, 'a listen item is left out, the index follows');
  assert.strictEqual(R.queueWindow(items, 1), null, 'a current item with no id is not carried');
  for (const bad of [[null, 0], [[], 0], [ids, -1], [ids, 1000], [ids, 1.5], ['x', 0]]) assert.strictEqual(R.queueWindow(bad[0], bad[1]), null);
});

test('v1.354 buildStatePayload carries a queue only when it has ids, and null otherwise', () => {
  const base = { id: 't1', position: 1, duration: 2, playing: true };
  assert.deepStrictEqual(R.buildStatePayload('d', base, false, false, { ids: ['a'], index: 0 }).queue, { ids: ['a'], index: 0 });
  assert.strictEqual(R.buildStatePayload('d', base, false, false).queue, null);
  assert.strictEqual(R.buildStatePayload('d', base, false, false, { ids: 'a' }).queue, null);
  assert.strictEqual(R.buildStatePayload('d', null, false, false, { ids: ['a'], index: 0 }).queue.ids[0], 'a', 'the idle payload still passes what it is given');
});

test('v1.354 the target reports the registered reader\'s queue (cut to the window) on every state post, and none once the reader is cleared or throws', () => {
  const h = harness();
  const list = Array.from({ length: 500 }, (_, i) => 'id' + i);
  h.t.setQueueReader(() => ({ list, index: 250 }));
  h.t.setOn(true); h.attach();
  h.advance(6000);
  const withQ = h.states().filter((x) => x.queue);
  assert.ok(withQ.length >= 1, 'a report carried the queue');
  const q = withQ[withQ.length - 1].queue;
  assert.strictEqual(q.ids.length, 201, '100 either side plus the current');
  assert.strictEqual(q.ids[q.index], 'id250', 'the index points at the current song');
  const before = h.states().length;
  h.t.setQueueReader(() => { throw new Error('view torn down'); });
  h.advance(6000);
  const after = h.states().slice(before);
  assert.ok(after.length >= 1, 'it still reports');
  assert.ok(after.every((x) => x.queue === null), 'a throwing reader means no queue, not a dead report');
  h.t.setQueueReader(null);
  const b2 = h.states().length;
  h.advance(6000);
  assert.ok(h.states().slice(b2).every((x) => x.queue === null), 'a cleared reader is not read');
});
