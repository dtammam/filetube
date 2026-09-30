'use strict';

// [INTEGRATION] v1.348 Listen Control - the /api/remote/* command channel over
// real HTTP and real SSE sockets. The grace and poll-liveness windows are
// driven by the injected clock (__remoteForTests.setNow + sweepNow), never by
// sleeping. Fixtures mirror music-library-projection: tonzak1 is visible to
// everyone, blk1 lives under a subtree the member is restricted from.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-remote-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, userStore, __mintTestSession, __remoteForTests, musicDb } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const musicStore = require('../../lib/music/store');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, member, rateUser, other, valUser;
const ROOT = path.join(DATA_DIR, 'ytdlp');
const blockedRoot = path.join(ROOT, 'blockedchan');
const PC = 'pc-device-1';
const PHONE = 'phone-device-1';

function audioItem(id, folderName, filePath) {
  return {
    id, type: 'audio', title: `${id} title`, name: `${id}.mp3`, filePath: filePath || path.join(ROOT, folderName, `${id}.mp3`),
    rootFolder: ROOT, folderName, channelName: folderName, duration: 100, hasThumbnail: true, ext: '.mp3',
    addedAt: 1788000000000, tags: { title: `${id} title`, artist: folderName, date: '2026', genre: 'Music' },
  };
}

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  seedState({ folders: [ROOT], folderSettings: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await updateDatabase((db) => {
    db.metadata = {
      tonzak1: audioItem('tonzak1', 'Tonzak'),
      tonzak2: audioItem('tonzak2', 'Tonzak'),
      blk1: audioItem('blk1', 'blockedchan', path.join(blockedRoot, 'blk1.mp3')),
    };
    musicDb.mutate((h) => { musicStore.ensureMusic(h).folders = [ROOT]; return true; });
    return true;
  });
  member = __mintTestSession({ username: 'remotemember', role: 'member' });
  userStore.setRestrictions(member.user.id, [{ kind: 'path', value: blockedRoot }]);
  rateUser = __mintTestSession({ username: 'remoterate', role: 'member' });
  other = __mintTestSession({ username: 'remoteother', role: 'member' });
  valUser = __mintTestSession({ username: 'remoteval', role: 'member' });
});

after(async () => {
  __remoteForTests.closeAll();
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const aborts = [];
beforeEach(() => { __remoteForTests.setNow(null); });
afterEach(() => {
  for (const a of aborts.splice(0)) a.abort();
  __remoteForTests.closeAll();
  __remoteForTests.setNow(null);
});

const post = (p, body, cookie, extra) => fetch(`${base}${p}`, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
  body: JSON.stringify(body),
  ...(extra || {}),
});
const cmd = (targetDeviceId, c, args, cookie, from = PHONE) => post('/api/remote/command', { fromDeviceId: from, targetDeviceId, cmd: c, args }, cookie);

// A tiny SSE client: reads frames off a real socket and lets a test await an event.
async function openStream(query, cookie) {
  const ac = new AbortController();
  aborts.push(ac);
  const res = await fetch(`${base}/api/remote/stream?${new URLSearchParams(query)}`, {
    signal: ac.signal, headers: cookie ? { Cookie: cookie } : {},
  });
  const frames = [];
  const waiters = [];
  let buf = '';
  let ended = false;
  const deliver = () => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      const idx = frames.findIndex((f) => f.event === waiters[i].event);
      if (idx >= 0) { const w = waiters.splice(i, 1)[0]; w.resolve(frames.splice(idx, 1)[0]); }
    }
  };
  if (res.status === 200) {
    (async () => {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const raw = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const f = { event: 'message', data: null, id: null, raw };
            for (const line of raw.split('\n')) {
              if (line.startsWith('event: ')) f.event = line.slice(7);
              else if (line.startsWith('data: ')) f.data = JSON.parse(line.slice(6));
              else if (line.startsWith('id: ')) f.id = line.slice(4);
            }
            if (raw.startsWith(':') || raw.startsWith('retry')) f.event = 'comment';
            frames.push(f);
          }
          deliver();
        }
      } catch { /* aborted */ }
      ended = true;
    })();
  }
  return {
    res, frames, abort: () => ac.abort(),
    get ended() { return ended; },
    next(event, ms = 1500) {
      const idx = frames.findIndex((f) => f.event === event);
      if (idx >= 0) return Promise.resolve(frames.splice(idx, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { event, resolve };
        waiters.push(w);
        setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); reject(new Error(`no "${event}" frame within ${ms}ms; saw ${JSON.stringify(frames.map((f) => f.event))}`)); } }, ms);
      });
    },
  };
}
const asTarget = (cookie, deviceId = PC, label = 'Desk PC') => openStream({ deviceId, role: 'target', label }, cookie);
const asController = (cookie, deviceId = PHONE, target = PC) => openStream({ deviceId, role: 'controller', target, label: 'iPhone' }, cookie);

test('stream: 200 with the four SSE headers, then a hello frame carrying seq', async () => {
  const t = await asTarget();
  assert.strictEqual(t.res.status, 200);
  assert.strictEqual(t.res.headers.get('content-type'), 'text/event-stream');
  assert.strictEqual(t.res.headers.get('cache-control'), 'no-cache, no-transform');
  assert.match(t.res.headers.get('connection') || '', /keep-alive/i);
  assert.strictEqual(t.res.headers.get('x-accel-buffering'), 'no');
  const hello = await t.next('hello');
  assert.strictEqual(typeof hello.data.seq, 'number');
  assert.strictEqual(t.frames.length === 0 || t.frames[0].event !== 'hello', true, 'hello came first');
});

test('stream: bad deviceId / role / a controller with no target are 400', async () => {
  assert.strictEqual((await fetch(`${base}/api/remote/stream?deviceId=bad%20id&role=target`)).status, 400);
  assert.strictEqual((await fetch(`${base}/api/remote/stream?deviceId=${PC}&role=admin`)).status, 400);
  assert.strictEqual((await fetch(`${base}/api/remote/stream?deviceId=${PHONE}&role=controller`)).status, 400);
  assert.strictEqual((await fetch(`${base}/api/remote/stream?deviceId=__proto__%2F&role=target`)).status, 400);
});

test('unauthenticated requests to every remote route are refused by the gate', async () => {
  const noCookie = { headers: { Cookie: 'x=1' } };
  for (const p of ['/api/remote/targets?deviceId=a', '/api/remote/poll?deviceId=a&role=target', '/api/remote/stream?deviceId=a&role=target']) {
    const r = await fetch(`${base}${p}`, noCookie);
    assert.ok([401, 403].includes(r.status), `${p} -> ${r.status}`);
  }
  const r = await fetch(`${base}/api/remote/command`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: 'x=1' }, body: '{}' });
  assert.ok([401, 403].includes(r.status), `command -> ${r.status}`);
});

test('a command arrives on the target stream as a command event within 500ms', async () => {
  const t = await asTarget();
  await t.next('hello');
  const started = Date.now();
  const r = await cmd(PC, 'pause', {});
  assert.strictEqual(r.status, 202);
  const { seq } = await r.json();
  const f = await t.next('command', 500);
  assert.ok(Date.now() - started < 500);
  assert.deepStrictEqual(f.data, { seq, cmd: 'pause', args: {} });
  assert.strictEqual(String(f.id), String(seq), 'the frame id is the seq (Last-Event-ID replay)');
});

test('play delivers resolved /api/music-shape tracks and the picked index', async () => {
  const t = await asTarget();
  await t.next('hello');
  const r = await cmd(PC, 'play', { ids: ['tonzak1', 'tonzak2'], index: 1 });
  assert.strictEqual(r.status, 202);
  const f = await t.next('command');
  assert.strictEqual(f.data.cmd, 'play');
  assert.strictEqual(f.data.args.index, 1);
  const direct = await (await fetch(`${base}/api/music`)).json();
  const want = direct.items.find((i) => i.id === 'tonzak2');
  assert.ok(want, 'fixture track is in /api/music');
  assert.deepStrictEqual(f.data.args.tracks[1], want, 'the delivered track is the /api/music row, not a sketch');
  assert.deepStrictEqual(f.data.args.tracks.map((x) => x.id), ['tonzak1', 'tonzak2']);
});

test('play: a hidden id is dropped and the index re-pointed; a hidden PICKED id is 404', async () => {
  const t = await asTarget(member.cookie);
  await t.next('hello');
  const ok = await cmd(PC, 'play', { ids: ['blk1', 'tonzak1', 'tonzak2'], index: 2 }, member.cookie);
  assert.strictEqual(ok.status, 202);
  const f = await t.next('command');
  assert.deepStrictEqual(f.data.args.tracks.map((x) => x.id), ['tonzak1', 'tonzak2'], 'blk1 never reaches the device');
  assert.strictEqual(f.data.args.index, 1, 'index re-pointed at tonzak2');
  const hidden = await cmd(PC, 'play', { ids: ['tonzak1', 'blk1'], index: 1 }, member.cookie);
  assert.strictEqual(hidden.status, 404);
  assert.ok(!t.frames.some((x) => x.event === 'command'), 'nothing was delivered for the 404');
  const missing = await cmd(PC, 'play', { ids: ['no-such-id'], index: 0 });
  assert.strictEqual(missing.status, 404);
});

test('command validation: 415 on non-JSON, 400 on bad ids, unknown cmd, bad play/seek args', async () => {
  await asTarget(valUser.cookie);
  const form = await fetch(`${base}/api/remote/command`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ fromDeviceId: PHONE, targetDeviceId: PC, cmd: 'pause' }) });
  assert.strictEqual(form.status, 415);
  for (const p of ['/api/remote/state', '/api/remote/off']) {
    const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.strictEqual(r.status, 415, p);
  }
  assert.strictEqual((await post('/api/remote/command', { fromDeviceId: 'x y', targetDeviceId: PC, cmd: 'pause' }, valUser.cookie)).status, 400);
  assert.strictEqual((await post('/api/remote/command', { fromDeviceId: PHONE, targetDeviceId: '../etc', cmd: 'pause' }, valUser.cookie)).status, 400);
  assert.strictEqual((await cmd(PC, 'reboot', {}, valUser.cookie)).status, 400);
  assert.strictEqual((await cmd(PC, 'eval', {}, valUser.cookie)).status, 400);
  assert.strictEqual((await cmd(PC, 'play', { ids: [], index: 0 }, valUser.cookie)).status, 400);
  assert.strictEqual((await cmd(PC, 'play', { ids: ['tonzak1'], index: 5 }, valUser.cookie)).status, 400);
  assert.strictEqual((await cmd(PC, 'play', { ids: ['tonzak1'], index: -1 }, valUser.cookie)).status, 400);
  assert.strictEqual((await cmd(PC, 'play', { ids: [1, 2], index: 0 }, valUser.cookie)).status, 400);
  assert.strictEqual((await cmd(PC, 'play', { ids: new Array(2001).fill('tonzak1'), index: 0 }, valUser.cookie)).status, 400);
  assert.strictEqual((await cmd(PC, 'seek', { position: -1 }, valUser.cookie)).status, 400);
  assert.strictEqual((await cmd(PC, 'seek', { position: 'NaN' }, valUser.cookie)).status, 400);
  assert.strictEqual((await cmd(PC, 'seek', {}, valUser.cookie)).status, 400);
  assert.strictEqual((await cmd(PC, 'seek', { position: 12.5 }, valUser.cookie)).status, 202);
});

test('410 target-gone when the target is not live', async () => {
  const r = await cmd('never-registered', 'pause', {});
  assert.strictEqual(r.status, 410);
  assert.deepStrictEqual(await r.json(), { error: 'target-gone' });
});

test('cross-user isolation: another user cannot list, command or subscribe to a target', async () => {
  await (await asTarget()).next('hello');
  const list = await (await fetch(`${base}/api/remote/targets?deviceId=${PHONE}`, { headers: { Cookie: other.cookie } })).json();
  assert.deepStrictEqual(list, []);
  const mine = await (await fetch(`${base}/api/remote/targets?deviceId=${PHONE}`)).json();
  assert.deepStrictEqual(mine.map((x) => x.deviceId), [PC]);
  assert.strictEqual((await cmd(PC, 'pause', {}, other.cookie)).status, 410);
  const sub = await asController(other.cookie);
  assert.strictEqual(sub.res.status, 410);
  const body = await (await post('/api/remote/command', { fromDeviceId: PHONE, targetDeviceId: PC, cmd: 'pause', userId: 'x', user: { id: 'x' } }, other.cookie)).json();
  assert.strictEqual(body.error, 'target-gone', 'a body-supplied user id is never read');
  const off = await post('/api/remote/off', { deviceId: PC }, other.cookie);
  assert.strictEqual(off.status, 200);
  const still = await (await fetch(`${base}/api/remote/targets?deviceId=${PHONE}`)).json();
  assert.strictEqual(still.length, 1, "another user's /off cannot unregister my target");
});

test('state posted by the target fans out to its controller stream, with the resolved track card', async () => {
  const t = await asTarget();
  await t.next('hello');
  const c = await asController();
  await c.next('hello');
  const att = await t.next('controller');
  assert.ok(att.data.attached === false || att.data.attached === true);
  const r = await post('/api/remote/state', { deviceId: PC, trackId: 'tonzak1', position: 12, duration: 100, state: 'playing', hasPrev: false, hasNext: true });
  assert.strictEqual(r.status, 202);
  const f = await c.next('state');
  assert.strictEqual(f.data.state, 'playing');
  assert.strictEqual(f.data.position, 12);
  assert.strictEqual(f.data.hasNext, true);
  assert.strictEqual(f.data.track.id, 'tonzak1');
  assert.strictEqual(f.data.track.title, 'tonzak1 title');
  assert.ok(f.data.track.artUrl, 'art url present');
  assert.strictEqual(typeof f.data.ageMs, 'number');
});

test('state: a hidden track id never resolves to a title for a restricted member', async () => {
  const t = await asTarget(member.cookie);
  await t.next('hello');
  const c = await asController(member.cookie);
  await c.next('hello');
  await post('/api/remote/state', { deviceId: PC, trackId: 'blk1', position: 1, duration: 100, state: 'playing' }, member.cookie);
  const f = await c.next('state');
  assert.strictEqual(f.data.track, null);
});

test('state validation: 400 on bad state, NaN/negative position, bad trackId; 410 for an unregistered device', async () => {
  await asTarget();
  const base0 = { deviceId: PC, trackId: 'tonzak1', position: 1, duration: 10, state: 'playing' };
  assert.strictEqual((await post('/api/remote/state', { ...base0, state: 'exploding' })).status, 400);
  assert.strictEqual((await post('/api/remote/state', { ...base0, position: -3 })).status, 400);
  assert.strictEqual((await post('/api/remote/state', { ...base0, duration: 'x' })).status, 400);
  assert.strictEqual((await post('/api/remote/state', { ...base0, trackId: { $ne: 1 } })).status, 400);
  assert.strictEqual((await post('/api/remote/state', { ...base0, deviceId: 'nobody' })).status, 410);
  assert.strictEqual((await post('/api/remote/state', { ...base0, trackId: null, state: 'idle' })).status, 202);
});

test('a controller that attaches late is sent the last known state in its first frames', async () => {
  const t = await asTarget();
  await t.next('hello');
  await post('/api/remote/state', { deviceId: PC, trackId: 'tonzak2', position: 40, duration: 100, state: 'paused' });
  const c = await asController();
  const f = await c.next('state');
  assert.strictEqual(f.data.state, 'paused');
  assert.strictEqual(f.data.track.id, 'tonzak2');
});

test('target-gone reaches the controller only after the 10s grace (injected clock), once', async () => {
  let t = 5_000_000;
  __remoteForTests.setNow(() => t);
  const tgt = await asTarget();
  await tgt.next('hello');
  const c = await asController();
  await c.next('hello');
  tgt.abort();
  await new Promise((r) => setTimeout(r, 100)); // let the server see the socket close
  t += 9_000;
  __remoteForTests.sweepNow();
  await assert.rejects(c.next('target-gone', 150), /no "target-gone"/);
  t += 1_500;
  __remoteForTests.sweepNow();
  await c.next('target-gone', 500);
  __remoteForTests.sweepNow();
  await assert.rejects(c.next('target-gone', 150), /no "target-gone"/, 'only once');
  assert.strictEqual((await cmd(PC, 'pause', {})).status, 410);
});

test('a target that drops and reconnects inside the grace stays live and replays missed commands by Last-Event-ID', async () => {
  let t = 7_000_000;
  __remoteForTests.setNow(() => t);
  const tgt = await asTarget();
  const hello = await tgt.next('hello');
  const c = await asController();
  await c.next('hello');
  tgt.abort();
  await new Promise((r) => setTimeout(r, 100));
  t += 3_000;
  const q = await cmd(PC, 'next', {});
  assert.strictEqual(q.status, 202, 'queued during the grace');
  const { seq } = await q.json();
  const ac = new AbortController();
  aborts.push(ac);
  const res = await fetch(`${base}/api/remote/stream?deviceId=${PC}&role=target&label=PC`, { signal: ac.signal, headers: { 'Last-Event-ID': String(hello.data.seq) } });
  assert.strictEqual(res.status, 200);
  const reader = res.body.getReader();
  let text = '';
  const dec = new TextDecoder();
  const deadline = Date.now() + 1500;
  while (!text.includes('event: command') && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
  }
  assert.match(text, new RegExp(`id: ${seq}\\nevent: command`));
  t += 30_000;
  __remoteForTests.sweepNow();
  await assert.rejects(c.next('target-gone', 150), /no "target-gone"/, 'reconnect within grace: the controller never heard target-gone');
});

test('a second stream for the same device id replaces the first, which hears replaced and is closed', async () => {
  const first = await asTarget();
  await first.next('hello');
  const second = await asTarget();
  await second.next('hello');
  await first.next('replaced');
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(first.ended, true);
  assert.strictEqual((await cmd(PC, 'pause', {})).status, 202);
  await second.next('command');
});

test('the 9th stream for one user evicts the least recently beating stream with replaced', async () => {
  const streams = [];
  for (let i = 0; i < 8; i++) {
    const s = await asTarget(undefined, `dev-${i}`, `D${i}`);
    await s.next('hello');
    streams.push(s);
  }
  const ninth = await asTarget(undefined, 'dev-8', 'D8');
  await ninth.next('hello');
  await streams[0].next('replaced');
  assert.strictEqual(__remoteForTests._socketCount(), 8);
});

test('/off drops the target at once and tells the controller', async () => {
  const tgt = await asTarget();
  await tgt.next('hello');
  const c = await asController();
  await c.next('hello');
  const r = await post('/api/remote/off', { deviceId: PC });
  assert.strictEqual(r.status, 200);
  await c.next('target-gone', 500);
  assert.strictEqual((await cmd(PC, 'pause', {})).status, 410);
});

test('poll fallback: a polling target gets commands by since, and a poll-only controller reads state', async () => {
  const p0 = await (await fetch(`${base}/api/remote/poll?deviceId=${PC}&role=target&label=PC`)).json();
  assert.deepStrictEqual(p0.commands, []);
  const q1 = await (await cmd(PC, 'next', {})).json();
  const q2 = await (await cmd(PC, 'play', { ids: ['tonzak1'], index: 0 })).json();
  const all = await (await fetch(`${base}/api/remote/poll?deviceId=${PC}&role=target&since=${p0.seq}`)).json();
  assert.deepStrictEqual(all.commands.map((c) => c.seq), [q1.seq, q2.seq]);
  assert.strictEqual(all.commands[1].args.tracks[0].id, 'tonzak1', 'play comes back resolved, like the stream');
  const later = await (await fetch(`${base}/api/remote/poll?deviceId=${PC}&role=target&since=${q1.seq}`)).json();
  assert.deepStrictEqual(later.commands.map((c) => c.seq), [q2.seq]);
  await post('/api/remote/state', { deviceId: PC, trackId: 'tonzak1', position: 3, duration: 100, state: 'playing' });
  const cp = await (await fetch(`${base}/api/remote/poll?deviceId=${PHONE}&role=controller&target=${PC}`)).json();
  assert.strictEqual(cp.state.state, 'playing');
  assert.strictEqual(cp.state.track.id, 'tonzak1');
  assert.strictEqual((await fetch(`${base}/api/remote/poll?deviceId=${PHONE}&role=controller&target=nobody`)).status, 410);
  assert.strictEqual((await fetch(`${base}/api/remote/poll?deviceId=${PHONE}&role=controller`)).status, 400);
});

test('a poll-only target expires 10s after its last poll (injected clock)', async () => {
  let t = 9_000_000;
  __remoteForTests.setNow(() => t);
  await fetch(`${base}/api/remote/poll?deviceId=${PC}&role=target&label=PC`);
  assert.strictEqual((await (await fetch(`${base}/api/remote/targets?deviceId=${PHONE}`)).json()).length, 1);
  t += 11_000;
  assert.strictEqual((await (await fetch(`${base}/api/remote/targets?deviceId=${PHONE}`)).json()).length, 0);
  assert.strictEqual((await cmd(PC, 'pause', {})).status, 410);
});

test('__proto__ and constructor device ids are refused or plain keys, never a prototype write', async () => {
  for (const id of ['__proto__', 'constructor']) {
    const s = await asTarget(undefined, id, 'odd');
    assert.strictEqual(s.res.status, 200, 'charset-legal ids are just keys');
    await s.next('hello');
    assert.strictEqual((await cmd(id, 'pause', {})).status, 202);
    await s.next('command');
  }
  assert.strictEqual(({}).polluted, undefined);
  assert.strictEqual((await cmd('valueOf', 'pause', {})).status, 410);
});

test('the command route is rate limited per user: a burst past the cap gets 429, other users are unaffected', async () => {
  const t = await asTarget(rateUser.cookie, PC, 'PC');
  await t.next('hello');
  const codes = [];
  for (let i = 0; i < 60; i++) codes.push((await cmd(PC, 'pause', {}, rateUser.cookie)).status);
  assert.ok(codes.includes(429), `a burst of 60 must hit the limiter, got ${[...new Set(codes)]}`);
  assert.strictEqual(codes[0], 202);
  assert.strictEqual((await cmd('nobody', 'pause', {}, other.cookie)).status, 410, 'a different user has its own bucket');
});

test('the state route is rate limited per user', async () => {
  const t = await asTarget(rateUser.cookie, 'rate-state-pc', 'PC');
  await t.next('hello');
  const codes = [];
  for (let i = 0; i < 50; i++) codes.push((await post('/api/remote/state', { deviceId: 'rate-state-pc', trackId: null, position: 0, duration: 0, state: 'idle' }, rateUser.cookie)).status);
  assert.ok(codes.includes(429));
});

test('closing every stream leaves no socket or timer behind', async () => {
  const a = await asTarget();
  await a.next('hello');
  const b = await asController();
  await b.next('hello');
  assert.ok(__remoteForTests._timerCount() > 0);
  a.abort();
  b.abort();
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(__remoteForTests._socketCount(), 0);
  __remoteForTests.closeAll();
  assert.strictEqual(__remoteForTests._timerCount(), 0);
});
