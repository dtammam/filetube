'use strict';

// [INTEGRATION] v1.38.0 T3/T7/T8/T9 — the TTS "Listen from Here" synthesis
// pipeline end to end, against STUB engines on PATH (CI has no piper/ffmpeg),
// exactly like the fake-ffmpeg harness in transcode-execution.test.js.
//
// Fake `piper`: --version -> exit 0; reads the block text on stdin; writes a
// deterministic 1.000s 16 kHz mono 16-bit PCM WAV to its --output_file arg, so
// each spoken block advances startSec by exactly 1.0 (asserted below).
// Fake `ffmpeg`: -version -> exit 0; the concat encode writes bytes to its
// output arg so the worker's atomic .tmp->rename finalize succeeds (the worker
// computes durationSec from the summed WAV durations, not from ffprobe).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-tts-'));
fs.writeFileSync(path.join(binDir, 'piper'), `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
if (a.includes('--version')) { console.log('piper test stub'); process.exit(0); }
const oi = a.indexOf('--output_file');
const out = oi >= 0 ? a[oi + 1] : null;
let text = '';
process.stdin.on('data', (d) => { text += d; });
process.stdin.on('end', () => {
  if (!out || text.trim() === '') { process.exit(1); }
  const sampleRate = 16000, dataSize = 32000; // exactly 1.000s mono 16-bit
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(out, buf); process.exit(0);
});
`, { mode: 0o755 });
fs.writeFileSync(path.join(binDir, 'ffmpeg'), `#!/bin/bash
if [[ "$1" == "-version" ]]; then echo "ffmpeg test stub"; exit 0; fi
last="\${@: -1}"
head -c 256 /dev/zero > "$last"
exit 0
`, { mode: 0o755 });
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tts-data-'));
const modelPath = path.join(binDir, 'voice.onnx');
fs.writeFileSync(modelPath, 'fake-onnx');
process.env.FILETUBE_TTS_PIPER_MODEL = modelPath;
process.env.FILETUBE_TTS_DEFER_POLL_MS = '100'; // fast defer re-check for the T8 test

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, loadDatabase, scanBooks } = require('../../server');
const booksStore = require('../../lib/books/store');
const ytdlp = require('../../lib/ytdlp');
const { buildEpub } = require('../helpers/build-zip');

let server;
let base;
let bookId;
const originalIsHeavy = ytdlp.isHeavyJobActive;

before(async () => {
  const booksDir = path.join(process.env.DATA_DIR, 'books');
  fs.mkdirSync(booksDir, { recursive: true });
  // 3 chapters so "one chapter ahead" is observable. Chapter 0 has a nested
  // block (blockquote>p) to exercise the ancestor-only-slot offset rule.
  fs.writeFileSync(path.join(booksDir, 'novel.epub'), buildEpub({
    title: 'Novel',
    chapters: [
      '<h1>Chapter One</h1><p>First para.</p><blockquote><p>Quoted.</p></blockquote>',
      '<p>Chapter two, first.</p><p>Chapter two, second.</p>',
      '<p>Chapter three.</p>',
    ],
  }));
  await updateDatabase((db) => { booksStore.ensureBooks(db).folders = [booksDir]; return true; });
  await scanBooks();
  const items = booksStore.readBooks(loadDatabase()).items;
  bookId = Object.keys(items).find((id) => items[id].title === 'Novel');

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  // Let the async engine-availability probe settle.
  await new Promise((r) => setTimeout(r, 150));
});

after(async () => {
  ytdlp.isHeavyJobActive = originalIsHeavy;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

async function pollStatus(spineIndex, want, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await fetch(`${base}/api/books/${bookId}/tts/${spineIndex}/status`);
    const body = await r.json();
    if (body.status === want || (want === 'ready' && body.status === 'failed')) return body;
    if (Date.now() > deadline) return body;
    await new Promise((res) => setTimeout(res, 40));
  }
}

test('T3: GET /api/books/tts/config reports available with a configured engine + model', async () => {
  const r = await fetch(`${base}/api/books/tts/config`);
  const body = await r.json();
  assert.strictEqual(body.available, true, 'fake piper + model + fake ffmpeg => available');
  assert.strictEqual(body.engine, 'piper');
});

test('T7/T9: ensure -> ready writes <key>.m4a + <key>.blocks.json; blocks map is aligned to the chunker', async () => {
  const ensure = await (await fetch(`${base}/book/${bookId}/tts/0/ensure`, { method: 'POST' })).json();
  assert.ok(['pending', 'ready'].includes(ensure.status));
  assert.ok(ensure.key, 'ensure returns the cache key');

  const status = await pollStatus(0, 'ready');
  assert.strictEqual(status.status, 'ready', `chapter 0 should reach ready, got ${status.status}`);
  assert.strictEqual(typeof status.durationSec, 'number');

  const cacheDir = path.join(process.env.DATA_DIR, 'tts-cache');
  assert.ok(fs.existsSync(path.join(cacheDir, `${ensure.key}.m4a`)), 'the m4a is finalized');
  const blocks = JSON.parse(fs.readFileSync(path.join(cacheDir, `${ensure.key}.blocks.json`), 'utf8'));
  // Chapter 0 blocks (chunker doc order): h1(0), p(1), blockquote(2, ancestor-only), p(3).
  // 3 SPOKEN blocks (h1,p,p) at 1.0s each -> startSecs 0,1, [2 empty->2], 2.
  assert.deepStrictEqual(blocks, [
    { blockIndex: 0, startSec: 0 },
    { blockIndex: 1, startSec: 1 },
    { blockIndex: 2, startSec: 2 }, // ancestor-only blockquote -> start of next real audio
    { blockIndex: 3, startSec: 2 },
  ]);
  assert.strictEqual(status.durationSec, 3, 'three spoken blocks x 1.0s');
});

test('T7: synthesizing chapter 0 auto-prepares chapter 1 (one chapter ahead)', async () => {
  const status1 = await pollStatus(1, 'ready');
  assert.strictEqual(status1.status, 'ready', 'chapter 1 should be prepared one-ahead without an explicit ensure');
});

test('T9: GET /book/:id/tts/:spineIndex serves audio/mp4 with byte ranges; /blocks serves JSON', async () => {
  const full = await fetch(`${base}/book/${bookId}/tts/0`);
  assert.strictEqual(full.status, 200);
  assert.strictEqual(full.headers.get('content-type'), 'audio/mp4');
  assert.strictEqual(full.headers.get('accept-ranges'), 'bytes', 'sendFile advertises ranges');

  const ranged = await fetch(`${base}/book/${bookId}/tts/0`, { headers: { Range: 'bytes=0-9' } });
  assert.strictEqual(ranged.status, 206, 'a Range request returns 206');

  const blocksRes = await fetch(`${base}/book/${bookId}/tts/0/blocks`);
  assert.strictEqual(blocksRes.status, 200);
  assert.ok(Array.isArray(await blocksRes.json()));
});

test('T9: unknown book / out-of-range chapter -> 404; not-yet-synthesized file -> 404', async () => {
  assert.strictEqual((await fetch(`${base}/book/nope/tts/0`)).status, 404);
  assert.strictEqual((await fetch(`${base}/book/${bookId}/tts/99`)).status, 404);
  assert.strictEqual((await fetch(`${base}/book/${bookId}/tts/99/ensure`, { method: 'POST' })).status, 404);
  // Chapter 2 exists but nothing requested it yet (and one-ahead only reached 1).
  const notReady = await fetch(`${base}/book/${bookId}/tts/2`);
  assert.strictEqual(notReady.status, 404, 'a chapter with no cache file 404s until synthesized');
});

test('T8: synthesis DEFERS while a yt-dlp download/poll is active, then proceeds', async () => {
  // Force the defer gate true; a fresh chapter must NOT reach ready.
  ytdlp.isHeavyJobActive = () => true;
  await fetch(`${base}/book/${bookId}/tts/2/ensure`, { method: 'POST' });
  const deferred = await pollStatus(2, 'ready', 800);
  assert.notStrictEqual(deferred.status, 'ready', 'must not synthesize while a download is active');
  assert.ok(['pending', 'processing', 'none'].includes(deferred.status));

  // Release the gate; it now proceeds.
  ytdlp.isHeavyJobActive = () => false;
  const proceeded = await pollStatus(2, 'ready');
  assert.strictEqual(proceeded.status, 'ready', 'synthesis resumes once downloads are idle');
});
