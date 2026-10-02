'use strict';

// [UNIT] v1.356 speaker resume (plan docs/exec-plans/active/2026-10-02-speaker-resume.md): a phone that closes
// the app comes back still connected. Executes the REAL controller in public/js/remote.js with injected deps
// (storage, clock, fetch, the signed-in user, the device class). Binds every resumeDecision arm, the PENDING
// window (no command, no label, isRemote() false until the targets check passes: AC3), another account never
// attaching (AC4), the quiet drop (AC2), the per-tab and desktop paths left alone (AC5), `at` stamped on hide,
// and every way the record is forgotten (R7).

const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../../public/js/remote.js');

const HOUR = 60 * 60 * 1000;
const T0 = 10 * 24 * HOUR; // the injected clock's start (a plausible epoch, far from 0)

function mapStore(spy) {
  const m = new Map();
  return {
    m,
    getItem: (k) => { if (spy) spy.push(['get', k]); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (spy) spy.push(['set', k]); m.set(k, String(v)); },
    removeItem: (k) => { if (spy) spy.push(['remove', k]); m.delete(k); },
  };
}

function deferred() { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; }

// o.targets: an array, a function (returning an array / a deferred / a {status}), or 'reject'
function harness(o) {
  o = o || {};
  const timers = new Map();
  let tid = 0; let clock = T0;
  const fetches = []; const toasts = []; const sources = []; const localSpy = [];
  const session = mapStore();
  const local = mapStore(localSpy);
  const pauses = [];
  let phone = o.phone !== false;
  let hidden = false;
  class ES {
    constructor(url) { this.url = url; this.h = {}; this.closed = false; this.readyState = 1; sources.push(this); }
    addEventListener(n, f) { this.h[n] = f; }
    close() { this.closed = true; }
    emit(n, d) { this.h[n]({ data: JSON.stringify(d) }); }
  }
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  function respond(u) {
    if (u.startsWith('/api/remote/targets')) {
      const t = typeof o.targets === 'function' ? o.targets() : o.targets;
      if (t === 'reject') return Promise.reject(new Error('offline'));
      if (t && t.p) return t.p.then(ok);
      if (t && t.status) return Promise.resolve({ ok: false, status: t.status, json: async () => ({ error: 'x' }) });
      return Promise.resolve(ok(t || []));
    }
    return Promise.resolve(ok({}));
  }
  const env = {
    fetch: (u, i) => { fetches.push({ u: String(u), init: i }); return respond(String(u)); },
    EventSource: ES,
    storage: session,
    localStore: local,
    isPhone: () => phone,
    currentUser: () => (typeof o.user === 'function' ? o.user() : Promise.resolve(o.user === undefined ? 7 : o.user)),
    player: () => ({ pause: () => pauses.push(clock) }),
    document: { get visibilityState() { return hidden ? 'hidden' : 'visible'; } },
    now: () => clock,
    setTimeout: (f, ms) => { tid += 1; timers.set(tid, { f, at: clock + ms }); return tid; },
    clearTimeout: (t) => timers.delete(t),
    deviceId: () => 'phone', label: () => 'Pocket', toast: (m) => toasts.push(m),
  };
  const c = R.createController(env);
  const h = {
    c, env, fetches, toasts, sources, session, local, localSpy, pauses,
    setPhone: (v) => { phone = v; }, setHidden: (v) => { hidden = v; },
    advance: (ms) => { clock += ms; },
    now: () => clock,
    settle: async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); },
    cmds: () => fetches.filter((f) => f.u === '/api/remote/command'),
    targetFetches: () => fetches.filter((f) => f.u.startsWith('/api/remote/targets')).length,
    record: () => { const raw = local.m.get(R.RESUME_KEY); return raw ? JSON.parse(raw) : null; },
    remember: (rec) => local.m.set(R.RESUME_KEY, typeof rec === 'string' ? rec : JSON.stringify(rec)),
  };
  return h;
}

const rec = (over) => Object.assign({ v: 1, deviceId: 'pc', label: 'Desk', user: '7', at: T0 }, over || {});
const speaker = (state, track) => ({ deviceId: 'pc', label: 'Desk', controlled: false,
  state: { state, position: 30, duration: 200, ageMs: 0, track: track === null ? null : (track || { id: 'a', title: 'Song A' }) } });

// ---------------------------------------------------------------- the pure decision
test('resumeDecision: every arm (R1 = listed AND (playing OR left under an hour ago); R6 = same user)', () => {
  const now = T0;
  const d = (r, user, targets) => R.resumeDecision(r, now, user, targets);
  assert.strictEqual(d(rec({ at: now - 3 * HOUR }), '7', [speaker('playing')]), 'attach', 'playing + 3 h');
  assert.strictEqual(d(rec({ at: now - 20 * 60000 }), '7', [speaker('paused')]), 'attach', 'paused + 20 min');
  assert.strictEqual(d(rec({ at: now - 61 * 60000 }), '7', [speaker('paused')]), 'drop', 'paused + 61 min');
  assert.strictEqual(d(rec({ at: now - HOUR }), '7', [speaker('paused')]), 'drop', 'exactly an hour is past it');
  assert.strictEqual(d(rec({ at: now - HOUR + 1 }), '7', [speaker('paused')]), 'attach', 'a millisecond inside the hour');
  assert.strictEqual(d(rec({ at: now - 2 * HOUR }), '7', [speaker('idle', null)]), 'drop', 'idle + 2 h');
  assert.strictEqual(d(rec({ at: now - 2 * HOUR }), '7', [speaker('blocked')]), 'drop', 'blocked is not playing');
  assert.strictEqual(d(rec(), '7', []), 'drop', 'not listed');
  assert.strictEqual(d(rec(), '7', [Object.assign(speaker('playing'), { deviceId: 'other' })]), 'drop', 'another speaker listed');
  assert.strictEqual(d(rec(), '8', [speaker('playing')]), 'drop', 'another user, even with the speaker listed and playing');
  assert.strictEqual(d(rec(), null, [speaker('playing')]), 'keep', 'the user cannot be told yet');
  assert.strictEqual(d(rec(), '7', null), 'keep', 'the targets check failed');
  assert.strictEqual(d(rec(), '8', null), 'drop', 'another user drops before the targets check');
  assert.strictEqual(d(rec({ at: now + 5000 }), '7', [speaker('paused')]), 'drop', 'a future stamp is not trusted');
  assert.strictEqual(d(rec({ at: now + 5000 }), '7', [speaker('playing')]), 'attach', 'a playing speaker needs no stamp');
});

test('resumeDecision: a malformed record is dropped whatever the check says (shape, version, id rule, lengths)', () => {
  const bad = [null, 'x', [], {}, rec({ v: 2 }), rec({ v: '1' }), rec({ deviceId: 'a b' }), rec({ deviceId: 'x'.repeat(65) }),
    rec({ deviceId: 5 }), rec({ label: 7 }), rec({ label: 'x'.repeat(65) }), rec({ user: 7 }), rec({ user: '' }), rec({ user: 'u'.repeat(65) }),
    rec({ at: '1' }), rec({ at: NaN }), rec({ at: Infinity }), rec({ at: 0 }), rec({ deviceId: '__proto__x!' })];
  for (const r of bad) assert.strictEqual(R.resumeDecision(r, T0, '7', [speaker('playing')]), 'drop', JSON.stringify(r));
  assert.strictEqual(R.validResume(rec()), true, 'the control is valid');
});

// ---------------------------------------------------------------- the launch: attach (AC1)
test('AC1: a fresh launch with a remembered speaker that plays attaches: stream, mirror, per-tab pick, toast, zero commands', async () => {
  const h = harness({ targets: [speaker('playing')] });
  h.remember(rec({ at: T0 - 3 * HOUR }));
  h.c.restore();
  assert.strictEqual(h.c.isRemote(), false, 'PENDING: not remote before the check');
  await h.settle();
  assert.strictEqual(h.c.isRemote(), true);
  assert.strictEqual(h.c.targetId(), 'pc');
  assert.strictEqual(h.c.label(), 'Desk');
  assert.strictEqual(h.c.state().track.title, 'Song A', 'the mirror starts from the listed state');
  assert.strictEqual(h.c.position(), 30);
  assert.deepStrictEqual(h.toasts, ['Playing on Desk']);
  assert.strictEqual(h.sources.length, 1);
  assert.match(h.sources[0].url, /role=controller&deviceId=phone&target=pc/);
  assert.deepStrictEqual(JSON.parse(h.session.m.get(R.CONTROL_KEY)), { deviceId: 'pc', label: 'Desk' }, 'the per-tab pick, as a select writes it');
  assert.deepStrictEqual(h.record(), { v: 1, deviceId: 'pc', label: 'Desk', user: '7', at: T0 }, 'the record is re-stamped on attach');
  assert.strictEqual(h.pauses.length, 1, 'the local player is told to pause (the remoteChoose rule)');
  assert.strictEqual(h.cmds().length, 0, 'nothing is sent');
  assert.deepStrictEqual(h.c.consumeResume(), { hasTrack: true }, 'the Music view lands on Now Playing');
  assert.strictEqual(h.c.consumeResume(), null, 'handed out once');
});

test('AC1: a paused speaker inside the hour attaches; an idle one lands the menu (hasTrack false)', async () => {
  const h = harness({ targets: [speaker('paused')] });
  h.remember(rec({ at: T0 - 20 * 60000 }));
  h.c.restore(); await h.settle();
  assert.strictEqual(h.c.isRemote(), true);
  assert.deepStrictEqual(h.c.consumeResume(), { hasTrack: true });
  const g = harness({ targets: [speaker('idle', null)] });
  g.remember(rec({ at: T0 - 5 * 60000 }));
  g.c.restore(); await g.settle();
  assert.strictEqual(g.c.isRemote(), true, 'idle inside the hour still attaches (R3)');
  assert.deepStrictEqual(g.c.consumeResume(), { hasTrack: false });
  assert.strictEqual(g.cmds().length, 0);
});

// ---------------------------------------------------------------- the PENDING window (AC3)
test('AC3: during the check nothing can reach the remembered speaker: every send path refuses, no label, not remote', async () => {
  const gate = deferred();
  const h = harness({ targets: () => gate });
  h.remember(rec({ at: T0 - 3 * HOUR }));
  h.c.restore();
  await h.settle();
  assert.strictEqual(h.c.resumePending(), true, 'the check is in flight');
  assert.strictEqual(h.targetFetches(), 1);
  // a tap on play (the wheel's center, a row, Shuffle) and every transport during the window
  assert.strictEqual(await h.c.play(['a', 'b'], 0), false);
  assert.strictEqual(await h.c.toggle(), false);
  assert.strictEqual(await h.c.next(), false);
  assert.strictEqual(await h.c.prev(), false);
  assert.strictEqual(await h.c.send('pause'), false);
  h.c.seek(40); h.c.volume(0.5);
  await h.settle();
  assert.strictEqual(h.c.isRemote(), false);
  assert.strictEqual(h.c.label(), '', 'no speaker name before the check');
  assert.strictEqual(h.c.targetId(), '');
  assert.strictEqual(h.c.state(), null);
  assert.strictEqual(h.sources.length, 0, 'no stream to the speaker either');
  assert.strictEqual(h.toasts.length, 0);
  assert.strictEqual(h.cmds().length, 0, 'zero command POSTs in the window');
  gate.resolve([speaker('playing')]);
  await h.settle();
  assert.strictEqual(h.c.isRemote(), true);
  assert.strictEqual(h.cmds().length, 0, 'and none on attach (the seek/volume above were refused, not queued)');
});

test('a pick made during the check wins: This device (leave) or another speaker, and the late answer never attaches', async () => {
  const gate = deferred();
  const h = harness({ targets: () => gate });
  h.remember(rec());
  h.c.restore(); await h.settle();
  h.c.leave(); // "This iPhone"
  gate.resolve([speaker('playing')]);
  await h.settle();
  assert.strictEqual(h.c.isRemote(), false);
  assert.strictEqual(h.toasts.length, 0);
  assert.strictEqual(h.record(), null, 'This device forgets the record');
  const gate2 = deferred();
  const g = harness({ targets: () => gate2 });
  g.remember(rec());
  g.c.restore(); await g.settle();
  g.c.select({ deviceId: 'pc2', label: 'Den', state: null });
  gate2.resolve([speaker('playing')]);
  await g.settle();
  assert.strictEqual(g.c.targetId(), 'pc2', 'the pick stands');
  assert.deepStrictEqual(g.toasts, []);
  assert.strictEqual(g.record().deviceId, 'pc2', 'the record follows the pick');
  assert.strictEqual(g.c.consumeResume(), null);
});

test('a record forgotten while the check was in flight (sign-out in another tab) never attaches', async () => {
  const gate = deferred();
  const h = harness({ targets: () => gate });
  h.remember(rec());
  h.c.restore(); await h.settle();
  h.local.m.delete(R.RESUME_KEY);
  gate.resolve([speaker('playing')]);
  await h.settle();
  assert.strictEqual(h.c.isRemote(), false);
  assert.strictEqual(h.toasts.length, 0);
});

// ---------------------------------------------------------------- the quiet drop (AC2)
for (const [name, at, targets] of [
  ['paused + 61 min', T0 - 61 * 60000, [speaker('paused')]],
  ['idle + 2 h', T0 - 2 * HOUR, [speaker('idle', null)]],
  ['not listed (Remote control off, tab closed, asleep)', T0 - 60000, []],
]) {
  test('AC2: ' + name + ' -> local, quietly: no toast, no command, no stream, record deleted', async () => {
    const h = harness({ targets });
    h.remember(rec({ at }));
    h.c.restore(); await h.settle();
    assert.strictEqual(h.c.isRemote(), false);
    assert.deepStrictEqual(h.toasts, []);
    assert.strictEqual(h.cmds().length, 0);
    assert.strictEqual(h.sources.length, 0);
    assert.strictEqual(h.record(), null);
    assert.strictEqual(h.session.m.has(R.CONTROL_KEY), false);
    assert.strictEqual(h.pauses.length, 0, 'the local player is left alone');
    assert.strictEqual(h.c.consumeResume(), null);
  });
}

// ---------------------------------------------------------------- another account (AC4)
test('AC4: another account on this phone: the record is deleted unread, the targets check is never asked, nothing sent', async () => {
  const h = harness({ user: 8, targets: [speaker('playing')] });
  h.remember(rec({ user: '7' }));
  h.c.restore(); await h.settle();
  assert.strictEqual(h.c.isRemote(), false);
  assert.strictEqual(h.targetFetches(), 0);
  assert.strictEqual(h.record(), null);
  assert.deepStrictEqual(h.toasts, []);
  assert.strictEqual(h.cmds().length, 0);
  assert.strictEqual(h.sources.length, 0);
});

test('AC4: the user that cannot be told (auth/me failed) is never trusted: local, kept, retried on the next foreground', async () => {
  let user = null;
  const h = harness({ user: () => Promise.resolve(user), targets: [speaker('playing')] });
  h.remember(rec());
  h.c.restore(); await h.settle();
  assert.strictEqual(h.c.isRemote(), false);
  assert.strictEqual(h.targetFetches(), 0, 'no user, no targets check');
  assert.ok(h.record(), 'kept');
  user = 7;
  h.c.visibility(false); await h.settle();
  assert.strictEqual(h.c.isRemote(), true, 'the retry on return attaches once the user is known');
});

test('the record carries the signed-in user; with no known user no record is written', async () => {
  const h = harness({ user: 42 });
  h.c.select({ deviceId: 'pc', label: 'Desk' });
  await h.settle();
  assert.strictEqual(h.record().user, '42');
  const g = harness({ user: null });
  g.c.select({ deviceId: 'pc', label: 'Desk' });
  await g.settle();
  assert.strictEqual(g.record(), null, 'fail closed: nothing remembered without an owner');
});

// ---------------------------------------------------------------- a failed check (R5: keep)
test('a failed targets check stays local and quiet, keeps the record, and the next foreground retries once', async () => {
  let mode = 'reject';
  const h = harness({ targets: () => (mode === 'reject' ? 'reject' : (mode === '500' ? { status: 500 } : [speaker('playing')])) });
  h.remember(rec());
  h.c.restore(); await h.settle();
  assert.strictEqual(h.c.isRemote(), false);
  assert.deepStrictEqual(h.toasts, []);
  assert.ok(h.record(), 'kept');
  assert.strictEqual(h.targetFetches(), 1);
  h.c.visibility(true); await h.settle();
  assert.strictEqual(h.targetFetches(), 1, 'going to the background does not retry');
  mode = '500';
  h.c.visibility(false); await h.settle();
  assert.strictEqual(h.targetFetches(), 2, 'one retry on return');
  assert.strictEqual(h.c.isRemote(), false, 'a server error is not "gone": still kept');
  assert.ok(h.record());
  mode = 'ok';
  h.c.visibility(false); await h.settle();
  assert.strictEqual(h.c.isRemote(), true);
  assert.strictEqual(h.cmds().length, 0);
  h.c.visibility(true); h.c.visibility(false); await h.settle();
  assert.strictEqual(h.targetFetches(), 4, 'attached: the normal re-check on return, not a resume');
});

test('a check that answers while the app is back in the background attaches nothing and retries on return', async () => {
  const gate = deferred();
  const h = harness({ targets: () => gate });
  h.remember(rec());
  h.c.restore(); await h.settle();
  h.setHidden(true);
  gate.resolve([speaker('playing')]);
  await h.settle();
  assert.strictEqual(h.c.isRemote(), false);
  h.setHidden(false);
  h.c.visibility(false); await h.settle();
  assert.strictEqual(h.c.isRemote(), true);
});

test('a malformed record is deleted without a single request (bad JSON, wrong shape, v 2)', async () => {
  for (const raw of ['{not json', JSON.stringify({ deviceId: 'pc' }), JSON.stringify(rec({ v: 2 })), JSON.stringify([rec()])]) {
    const h = harness({ targets: [speaker('playing')] });
    h.remember(raw);
    h.c.restore(); await h.settle();
    assert.strictEqual(h.c.isRemote(), false, raw);
    assert.strictEqual(h.record(), null, raw);
    assert.strictEqual(h.fetches.length, 0, raw);
  }
});

// ---------------------------------------------------------------- AC5: the per-tab and desktop paths
test('AC5: a per-tab pick (minimize, reload) takes the v1.355 path and never reads the record', async () => {
  const h = harness({ targets: [] });
  h.remember(rec());
  h.session.m.set(R.CONTROL_KEY, JSON.stringify({ deviceId: 'pc', label: 'Desk' }));
  h.c.restore();
  assert.strictEqual(h.c.isRemote(), true, 'the per-tab restore still trusts its key before asking (unchanged)');
  await h.settle();
  assert.deepStrictEqual(h.localSpy.filter((x) => x[0] === 'get'), [], 'the record is not read');
  assert.deepStrictEqual(h.toasts, ['Lost Desk'], 'a vanished PC on reload still says so (unchanged)');
});

test('AC5: a desktop (no is-phone) never writes or reads the record', async () => {
  const h = harness({ phone: false, targets: [speaker('playing')] });
  h.remember(rec());
  h.localSpy.length = 0;
  h.c.restore(); await h.settle();
  assert.strictEqual(h.c.isRemote(), false, 'a desktop tab never inherits a speaker');
  assert.strictEqual(h.fetches.length, 0);
  h.c.select({ deviceId: 'pc', label: 'Desk' });
  await h.settle(); // the owner lookup resolves: a phone would write now
  h.c.visibility(true);
  h.c.pagehide();
  await h.settle();
  h.c.leave();
  await h.settle();
  assert.deepStrictEqual(h.localSpy, [], 'not one localStorage call on a desktop');
});

// ---------------------------------------------------------------- `at` and R7
test('`at` is stamped on every hide and on pagehide while attached (the hour counts from the close)', async () => {
  const h = harness();
  h.c.select({ deviceId: 'pc', label: 'Desk' });
  await h.settle();
  assert.strictEqual(h.record().at, T0);
  h.advance(5 * 60000);
  h.c.visibility(true);
  assert.strictEqual(h.record().at, T0 + 5 * 60000, 'hidden');
  h.advance(60000);
  h.c.pagehide();
  assert.strictEqual(h.record().at, T0 + 6 * 60000, 'pagehide');
  h.c.leave();
  h.advance(60000);
  h.c.pagehide(); h.c.visibility(true);
  assert.strictEqual(h.record(), null, 'not attached: nothing stamped');
});

test('R7: the record is forgotten on This device, on lost() (target-gone, a 410), and kept across a plain switch', async () => {
  const h = harness();
  h.c.select({ deviceId: 'pc', label: 'Desk' }); await h.settle();
  assert.ok(h.record());
  h.sources[0].emit('target-gone', {});
  assert.strictEqual(h.record(), null, 'target-gone');
  assert.deepStrictEqual(h.toasts, ['Lost Desk'], 'a speaker that goes away WHILE attached still says so (R8)');
  const g = harness();
  g.env.fetch = (u) => { g.fetches.push({ u }); return Promise.resolve(u === '/api/remote/command' ? { ok: false, status: 410, json: async () => ({}) } : { ok: true, status: 200, json: async () => [] }); };
  g.c.select({ deviceId: 'pc', label: 'Desk' }); await g.settle();
  assert.ok(g.record());
  await g.c.toggle();
  assert.strictEqual(g.record(), null, 'a 410');
  const k = harness();
  k.c.select({ deviceId: 'pc', label: 'Desk' }); await k.settle();
  k.c.leave();
  assert.strictEqual(k.record(), null, 'This device');
});

test('R7: sign-out forgets the remembered speaker (accountSignOut, executed)', async () => {
  const { JSDOM } = require('jsdom');
  const COMMON = require.resolve('../../public/js/common.js');
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/music' });
  const keep = {};
  for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'fetch']) keep[k] = global[k];
  try {
    delete global.window; delete global.document;
    delete require.cache[COMMON];
    const C = require(COMMON);
    global.window = dom.window; global.document = dom.window.document;
    global.localStorage = dom.window.localStorage; global.sessionStorage = dom.window.sessionStorage;
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    dom.window.localStorage.setItem(R.RESUME_KEY, JSON.stringify(rec()));
    dom.window.localStorage.setItem('ft-device-id', 'keep-me');
    C.accountSignOut();
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    assert.strictEqual(dom.window.localStorage.getItem(R.RESUME_KEY), null);
    assert.strictEqual(dom.window.localStorage.getItem('ft-device-id'), 'keep-me', 'the device id itself stays');
  } finally {
    delete require.cache[COMMON];
    for (const k of Object.keys(keep)) { if (keep[k] === undefined) delete global[k]; else global[k] = keep[k]; }
  }
});

test('the browser env reads the phone class, a blocked localStorage, and the user id from /api/auth/me', async () => {
  const blocked = { document: { documentElement: { classList: { contains: (c) => c === 'is-phone' } } },
    get localStorage() { throw new Error('SecurityError'); }, sessionStorage: null,
    fetchCurrentUser: () => Promise.resolve({ user: { id: 3, username: 'x' } }), FileTube: {} };
  const env = R.browserEnv(blocked);
  assert.strictEqual(env.isPhone(), true);
  assert.strictEqual(env.localStore.getItem(R.RESUME_KEY), null, 'blocked storage reads as empty, never throws');
  assert.strictEqual(await env.currentUser(), 3);
  const desk = R.browserEnv({ document: { documentElement: { classList: { contains: () => false } } }, localStorage: null, FileTube: {} });
  assert.strictEqual(desk.isPhone(), false);
  assert.strictEqual(desk.currentUser(), null, 'no shared fetch: cannot tell');
});

test('a pick of the SAME speaker during the check is the pick: the late answer attaches nothing more (no second toast, no landing)', async () => {
  const gate = deferred();
  const h = harness({ targets: () => gate });
  h.remember(rec());
  h.c.restore(); await h.settle();
  h.c.select({ deviceId: 'pc', label: 'Desk', state: null }); // Speakers > Desk, by hand
  await h.settle();
  const streams = h.sources.length;
  gate.resolve([speaker('playing')]);
  await h.settle();
  assert.strictEqual(h.c.targetId(), 'pc');
  assert.deepStrictEqual(h.toasts, [], 'no "Playing on" toast for a pick');
  assert.strictEqual(h.sources.length, streams, 'the stream is not reopened');
  assert.strictEqual(h.c.consumeResume(), null, 'and nothing to land');
  assert.strictEqual(h.pauses.length, 0);
});

test('a record REPLACED while the check was in flight (another tab picked another speaker) is not acted on here', async () => {
  const gate = deferred();
  const h = harness({ targets: () => gate });
  h.remember(rec());
  h.c.restore(); await h.settle();
  h.remember(rec({ deviceId: 'pc2', label: 'Den' }));
  gate.resolve([speaker('playing'), Object.assign(speaker('playing'), { deviceId: 'pc2', label: 'Den' })]);
  await h.settle();
  assert.strictEqual(h.c.isRemote(), false);
  assert.deepStrictEqual(h.toasts, []);
  assert.strictEqual(h.record().deviceId, 'pc2', 'the other tab\'s record is left alone');
});

test('bootWhenReady wires the controller: pagehide stamps (beside the target\'s /off), visibilitychange reaches visibility, boot restores', () => {
  const handlers = {}; const docHandlers = {}; const calls = [];
  const w = {
    document: { readyState: 'complete', visibilityState: 'visible', body: null, addEventListener: (n, f) => { docHandlers[n] = f; } },
    addEventListener: (n, f) => { handlers[n] = f; },
    sessionStorage: { getItem: () => null },
  };
  const remote = { pagehide: () => calls.push('remote.pagehide'), setOn: () => {}, isOn: () => false, relabel: () => {} };
  const control = { restore: () => calls.push('control.restore'), pagehide: () => calls.push('control.pagehide'), visibility: (h) => calls.push('control.visibility:' + h) };
  R.bootWhenReady(w, remote, control, false);
  assert.deepStrictEqual(calls, ['control.restore']);
  handlers.pagehide();
  assert.deepStrictEqual(calls.slice(1), ['remote.pagehide', 'control.pagehide']);
  w.document.visibilityState = 'hidden'; docHandlers.visibilitychange();
  w.document.visibilityState = 'visible'; docHandlers.visibilitychange();
  assert.deepStrictEqual(calls.slice(3), ['control.visibility:true', 'control.visibility:false']);
});
