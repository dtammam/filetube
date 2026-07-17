'use strict';

// [INTEGRATION] v1.38.0 T3/T9 — the STRICTLY-OPT-IN posture: with no engine
// configured (no piper/espeak on PATH, no model), "Listen from Here" is a total
// no-op — books work, the config route reports unavailable, and every synthesis
// route returns 503. CI has no piper binary, so this is the default environment.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tts-off-'));
// Explicitly ensure no model is configured (a prior test in the same runner
// process cannot leak env — each integration file is a fresh process).
delete process.env.FILETUBE_TTS_PIPER_MODEL;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // v1.43: auth through the real gate
  await new Promise((r) => setTimeout(r, 100)); // let the (failing) engine probe settle
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

test('config reports unavailable and ensure returns 503 when no engine is configured', async () => {
  const cfg = await (await fetch(`${base}/api/books/tts/config`)).json();
  assert.strictEqual(cfg.available, false, 'no engine/model => Listen from Here stays dark');

  const ensure = await fetch(`${base}/book/anybook/tts/0/ensure`, { method: 'POST' });
  assert.strictEqual(ensure.status, 503, 'synthesis routes 503 when TTS is not configured');

  // The books platform itself is unaffected — the books list still answers.
  const books = await fetch(`${base}/api/books`);
  assert.strictEqual(books.status, 200);
});
