'use strict';

// [UNIT] v1.69.0 (podcasts): the SSRF-guarded feed fetch + streaming
// enclosure downloader (lib/podcasts/fetchGuard.js). http/dns injected - no
// real network. Binds: per-hop guarding on START and REDIRECT URLs (the
// Patreon 302-to-CDN shape), fail-closed DNS, the .ptpart atomic rename,
// failure unlink (at-most-one-partial), size-cap mid-stream abort, and
// URL-free error strings.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');

const { fetchFeed, downloadEnclosure, ENCLOSURE_MAX_BYTES } = require('../../lib/podcasts/fetchGuard');

// Fake http(s).request replaying a url -> route map. Routes:
// { status, location, chunks: [Buffer|string], error: 'read'|'never-end' }
function fakeHttp(routes, requested = []) {
  return {
    request(url, _opts, cb) {
      requested.push(url);
      const route = routes[url] || { status: 404 };
      const res = new EventEmitter();
      res.statusCode = route.status;
      res.headers = {};
      if (route.location) res.headers.location = route.location;
      res.destroy = () => { res.destroyed = true; };
      setImmediate(() => {
        cb(res);
        if (route.location) return;
        setImmediate(() => {
          for (const c of route.chunks || []) {
            if (res.destroyed) return;
            res.emit('data', Buffer.from(c));
          }
          if (route.error === 'read') { res.emit('error', new Error('boom')); return; }
          if (route.error === 'never-end') return;
          res.emit('end');
        });
      });
      return { setTimeout() {}, on() {}, end() {}, destroy() {} };
    },
  };
}

function fakeLookup(privateHosts = new Set()) {
  return (host, _opts, cb) => {
    setImmediate(() => cb(null, [{ address: privateHosts.has(host) ? '192.168.0.9' : '203.0.113.7', family: 4 }]));
  };
}

const deps = (routes, requested, priv) => ({
  http: fakeHttp(routes, requested), https: fakeHttp(routes, requested), lookup: fakeLookup(priv),
});

function tmpShowDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ft-podcast-dl-'));
}

test('fetchFeed: happy path with one redirect hop (the Patreon shape)', async () => {
  const requested = [];
  const routes = {
    'https://www.patreon.com/rss/show?auth=tok': { status: 302, location: 'https://cdn.example.com/rss/show' },
    'https://cdn.example.com/rss/show': { status: 200, chunks: ['<rss><channel><title>T</title>', '</channel></rss>'] },
  };
  const r = await fetchFeed('https://www.patreon.com/rss/show?auth=tok', deps(routes, requested));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.body, '<rss><channel><title>T</title></channel></rss>');
  assert.strictEqual(r.finalUrl, 'https://cdn.example.com/rss/show');
  assert.strictEqual(requested.length, 2);
});

test('fetchFeed: SSRF refusals - private redirect target, private DNS, HTTP error; errors carry NO URL', async () => {
  const toPrivateLiteral = await fetchFeed('https://ok.example/feed', deps({
    'https://ok.example/feed': { status: 302, location: 'http://127.0.0.1/admin' },
  }));
  assert.strictEqual(toPrivateLiteral.ok, false);
  assert.match(toPrivateLiteral.error, /private\/local host/);

  const toPrivateDns = await fetchFeed('https://ok.example/feed', deps({
    'https://ok.example/feed': { status: 302, location: 'https://internal.example/x' },
  }, [], new Set(['internal.example'])));
  assert.strictEqual(toPrivateDns.ok, false);
  assert.match(toPrivateDns.error, /resolves to a private address/);

  const forbidden = await fetchFeed('https://ok.example/feed', deps({
    'https://ok.example/feed': { status: 403 },
  }));
  assert.strictEqual(forbidden.ok, false);
  assert.strictEqual(forbidden.error, 'HTTP 403');

  for (const r of [toPrivateLiteral, toPrivateDns, forbidden]) {
    assert.ok(!r.error.includes('ok.example'), `error must not embed the URL: ${r.error}`);
    assert.ok(!r.error.includes('auth'), 'nor anything token-shaped');
  }
});

test('fetchFeed: the START host itself gets the DNS resolve-then-check', async () => {
  const r = await fetchFeed('https://rebinder.example/feed', deps({}, [], new Set(['rebinder.example'])));
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /resolves to a private address/);
});

test('fetchFeed: body over the cap aborts mid-stream', async () => {
  const big = 'x'.repeat(64 * 1024);
  const r = await fetchFeed('https://ok.example/feed', {
    ...deps({ 'https://ok.example/feed': { status: 200, chunks: [big, big, big] } }),
    maxBodyBytes: 100 * 1024,
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /too large/);
});

test('downloadEnclosure: streams through .ptpart, renames atomically, reports bytes', async () => {
  const dir = tmpShowDir();
  const routes = {
    'https://www.patreon.com/api/rss/u/tok/e/1.mp3': { status: 302, location: 'https://c10.cdn.example/media/1.mp3' },
    'https://c10.cdn.example/media/1.mp3': { status: 200, chunks: ['ID3AAAA', 'BBBB'] },
  };
  const r = await downloadEnclosure('https://www.patreon.com/api/rss/u/tok/e/1.mp3', dir, 'Ep One [rss=1].mp3', deps(routes));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.bytes, 11);
  assert.strictEqual(fs.readFileSync(r.filePath, 'utf8'), 'ID3AAAABBBB');
  assert.strictEqual(path.basename(r.filePath), 'Ep One [rss=1].mp3');
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.ptpart'));
  assert.deepStrictEqual(leftovers, [], 'no .ptpart survives success');
});

test('downloadEnclosure: a mid-stream read error unlinks the partial (at-most-one-partial)', async () => {
  const dir = tmpShowDir();
  const r = await downloadEnclosure('https://cdn.example/e.mp3', dir, 'Ep [rss=2].mp3', deps({
    'https://cdn.example/e.mp3': { status: 200, chunks: ['partial-bytes'], error: 'read' },
  }));
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(fs.readdirSync(dir), [], 'nothing survives a failed download');
});

test('downloadEnclosure: empty 200 response is a failure, never a zero-byte episode', async () => {
  const dir = tmpShowDir();
  const r = await downloadEnclosure('https://cdn.example/e.mp3', dir, 'Ep [rss=3].mp3', deps({
    'https://cdn.example/e.mp3': { status: 200, chunks: [] },
  }));
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /empty/);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('downloadEnclosure: size cap aborts mid-stream and unlinks', async () => {
  const dir = tmpShowDir();
  const r = await downloadEnclosure('https://cdn.example/e.mp3', dir, 'Ep [rss=4].mp3', {
    ...deps({ 'https://cdn.example/e.mp3': { status: 200, chunks: ['aaaa', 'bbbb', 'cccc'] } }),
    maxBytes: 6,
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /size cap/);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
  assert.ok(ENCLOSURE_MAX_BYTES === 2 * 1024 * 1024 * 1024, 'the production cap is 2 GB');
});

test('downloadEnclosure: hostile enclosure redirecting to a private host is refused BEFORE any write', async () => {
  const dir = tmpShowDir();
  const r = await downloadEnclosure('https://feed-author.example/e.mp3', dir, 'Ep [rss=5].mp3', deps({
    'https://feed-author.example/e.mp3': { status: 302, location: 'http://10.0.0.1/secrets' },
  }));
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /private\/local host/);
  assert.deepStrictEqual(fs.readdirSync(dir), [], 'no file was ever opened');
});

test('downloadEnclosure: a destination name that escapes the show dir is structurally refused', async () => {
  const dir = tmpShowDir();
  const r = await downloadEnclosure('https://cdn.example/e.mp3', dir, '../escape.mp3', deps({
    'https://cdn.example/e.mp3': { status: 200, chunks: ['data'] },
  }));
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /outside the show directory/);
  assert.ok(!fs.existsSync(path.join(path.dirname(dir), 'escape.mp3')));
});

test('downloadEnclosure: HTTP 404 from the CDN is a clean failure', async () => {
  const dir = tmpShowDir();
  const r = await downloadEnclosure('https://cdn.example/gone.mp3', dir, 'Ep [rss=6].mp3', deps({
    'https://cdn.example/gone.mp3': { status: 404 },
  }));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'HTTP 404');
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

// v1.124 R1: honor write backpressure. A fast origin over a slow disk (Dean's
// NAS/SMB) would otherwise buffer the write stream unbounded in memory up to the
// size cap. When out.write() returns false the read must pause; 'drain' resumes
// it. Binds by RECORDING res.pause()/res.resume() calls: neutralize the guard
// and the recorded order goes empty -> this fails.
test('downloadEnclosure: honors write backpressure - pauses on a full sink, resumes on drain (R1)', async () => {
  const dir = tmpShowDir();
  const realFs = require('fs');

  // Fake sink: first write() returns false (buffer full) and emits 'drain' next
  // tick; later writes return true. Everything else delegates to real fs, so the
  // .ptpart finalize path runs normally (openSync/rename against the real file
  // this writable actually created via realFs? no - it never writes to disk, so
  // the finalize resolves ok:false; we assert the backpressure calls, not ok).
  const writable = new (require('node:events').EventEmitter)();
  let firstWrite = true;
  writable.write = (c) => {
    if (firstWrite) { firstWrite = false; setImmediate(() => writable.emit('drain')); return false; }
    return true;
  };
  writable.end = (cb) => { if (cb) cb(); };
  writable.close = (cb) => { if (cb) cb(); };
  const fsImpl = Object.assign(Object.create(realFs), { createWriteStream: () => writable });

  const order = [];
  const url = 'https://cdn.example/bp.mp3';
  const fakeReq = {
    request(_u, _opts, cb) {
      const res = new (require('node:events').EventEmitter)();
      res.statusCode = 200; res.headers = {};
      res.destroy = () => { res.destroyed = true; };
      res.pause = () => order.push('pause');
      res.resume = () => order.push('resume');
      setImmediate(() => {
        cb(res);
        setImmediate(() => {
          res.emit('data', Buffer.from('AAAA')); // first write -> false -> pause
          setImmediate(() => {
            res.emit('data', Buffer.from('BBBB')); // after drain/resume
            res.emit('end');
          });
        });
      });
      return { setTimeout() {}, on() {}, end() {}, destroy() {} };
    },
  };

  await downloadEnclosure(url, dir, 'Ep [rss=9].mp3', {
    http: fakeReq, https: fakeReq, lookup: fakeLookup(), fsImpl,
  });

  assert.ok(order.includes('pause'), 'a full sink must pause the read');
  assert.ok(order.includes('resume'), 'drain must resume the read');
  assert.ok(order.indexOf('pause') < order.indexOf('resume'), 'pause precedes resume');
});
