'use strict';

// [INTEGRATION] v1.38.0 — the espeak-ng fallback engine end to end (the design
// wires it as a config-selectable fallback + smoke-tests it). Boots with
// FILETUBE_TTS_ENGINE=espeak-ng and a fake `espeak-ng` on PATH; proves the same
// ensure->ready->serve pipeline works through the espeak argv (--stdin/-v/-s/-w).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-espeak-'));
// Fake espeak-ng: --version -> exit 0; reads stdin; writes a 1s WAV to the -w arg.
fs.writeFileSync(path.join(binDir, 'espeak-ng'), `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
if (a.includes('--version')) { console.log('espeak-ng test stub'); process.exit(0); }
const wi = a.indexOf('-w'); const out = wi >= 0 ? a[wi + 1] : null;
let t = ''; process.stdin.on('data', (d) => { t += d; });
process.stdin.on('end', () => {
  if (!out || t.trim() === '') process.exit(1);
  const dataSize = 32000; const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(16000, 24); buf.writeUInt32LE(32000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(out, buf); process.exit(0);
});
`, { mode: 0o755 });
fs.writeFileSync(path.join(binDir, 'ffmpeg'), `#!/bin/bash
if [[ "$1" == "-version" ]]; then echo stub; exit 0; fi
head -c 128 /dev/zero > "\${@: -1}"; exit 0
`, { mode: 0o755 });
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tts-espeak-'));
process.env.FILETUBE_TTS_ENGINE = 'espeak-ng'; // select the fallback engine

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, loadDatabase, scanBooks } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const booksStore = require('../../lib/books/store');
const { buildEpub } = require('../helpers/build-zip');

let server;
let base;
let bookId;

before(async () => {
  const booksDir = path.join(process.env.DATA_DIR, 'books');
  fs.mkdirSync(booksDir, { recursive: true });
  fs.writeFileSync(path.join(booksDir, 'e.epub'), buildEpub({ title: 'Espeak', chapters: ['<p>Robotic voice test.</p>'] }));
  await updateDatabase((db) => { booksStore.ensureBooks(db).folders = [booksDir]; return true; });
  await scanBooks();
  bookId = Object.keys(booksStore.readBooks(loadDatabase()).items)[0];
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base); // v1.43: auth through the real gate
  await new Promise((r) => setTimeout(r, 150));
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

test('espeak-ng: config reports available with engine espeak-ng, and ensure->ready->serve works', async () => {
  const cfg = await (await fetch(`${base}/api/books/tts/config`)).json();
  assert.strictEqual(cfg.available, true);
  assert.strictEqual(cfg.engine, 'espeak-ng');

  await fetch(`${base}/book/${bookId}/tts/0/ensure`, { method: 'POST' });
  const deadline = Date.now() + 4000;
  let status = { status: 'pending' };
  while (Date.now() < deadline) {
    status = await (await fetch(`${base}/api/books/${bookId}/tts/0/status`)).json();
    if (status.status === 'ready' || status.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.strictEqual(status.status, 'ready', 'the espeak-ng pipeline reaches ready');
  const audio = await fetch(`${base}/book/${bookId}/tts/0`);
  assert.strictEqual(audio.status, 200);
  assert.strictEqual(audio.headers.get('content-type'), 'audio/mp4');
});
