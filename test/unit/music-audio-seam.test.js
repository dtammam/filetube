'use strict';

// [UNIT] Wave 7b slice S3 (the monolith split): GET /audio/:id carries the ONE
// expression the music slice did NOT move byte-identically. server.js's
// `ffmpegAvailable` is a mutable `let` that its boot-time
// `exec('ffmpeg -version')` callback flips to true LONG AFTER the route
// registers (registration is synchronous at require time), so lib/music/routes.js
// reads it through the live `ffmpegIsAvailable()` instead of destructuring the
// value. Destructuring would freeze the gate at its boot-time false: every
// /audio request on a machine that HAS ffmpeg would answer 503 "ffmpeg
// unavailable" and never enqueue an extraction - inert, and invisible to the
// rest of the suite, because CI has no ffmpeg at all (the frozen and the live
// form agree there; see test/integration/audio-endpoint.test.js's header).
//
// So this test does what that suite cannot: it registers the route with the
// flag FALSE, flips it TRUE afterwards - exactly the boot ordering - and binds
// the fact that the handler sees the NEW value. Destructure the value in
// registerAudioRoute and the second test reds.

const { test } = require('node:test');
const assert = require('node:assert');
const musicRoutes = require('../../lib/music/routes');

let ffmpegAvailable = false; // the mutable seam, as server.js declares it
const enqueued = [];
const handlers = {};

// Registration happens ONCE, here, while the flag is still false - the boot order.
musicRoutes.registerAudioRoute({ get: (p, h) => { handlers[p] = h; } }, {
  audioPath: (id) => `/no/such/sidecar/${id}.m4a`,
  ffmpegIsAvailable: () => ffmpegAvailable,
  fs: { existsSync: () => false }, // no sidecar on disk -> the ffmpeg branch
  getCachedDatabase: () => ({ metadata: { v1: { id: 'v1', type: 'video', filePath: '/src/v1.mp4' } } }),
  healStaleAudioReady: () => 'pending',
  markServed: () => {},
  mediaVisibleTo: () => true,
  queueAudioExtract: (id) => enqueued.push(id),
  recordServed: () => {},
  sendRangeable: () => { throw new Error('unreachable: no sidecar exists in this fixture'); },
});

function call() {
  const out = { code: 200, body: null };
  const res = { status(c) { out.code = c; return res; }, json(b) { out.body = b; return res; } };
  handlers['/audio/:id']({ params: { id: 'v1' } }, res);
  return out;
}

test('GET /audio/:id with ffmpeg unavailable: 503 "ffmpeg unavailable", nothing enqueued', () => {
  assert.ok(typeof handlers['/audio/:id'] === 'function', 'registerAudioRoute registered GET /audio/:id');
  const out = call();
  assert.equal(out.code, 503);
  assert.deepStrictEqual(out.body, { error: 'ffmpeg unavailable' });
  assert.deepStrictEqual(enqueued, [], 'never enqueues a doomed job');
});

test('the ffmpeg gate is LIVE: flipping the flag AFTER registration changes the answer', () => {
  ffmpegAvailable = true; // what the boot probe's callback does, long after registration
  const out = call();
  assert.equal(out.code, 503);
  assert.deepStrictEqual(out.body, { error: 'extracting', status: 'pending' }, 'a frozen (destructured) gate would still answer "ffmpeg unavailable" here');
  assert.deepStrictEqual(enqueued, ['v1'], 'and would never enqueue the extraction');
});
