'use strict';

// [INTEGRATION] v1.38.0 T11 — persist-gate carry in the book scanner. A rescan
// must LEAVE a surviving book's TTS audio status intact (the scan merge only
// rewrites items/progress), and a PRUNED book must lose both its db.books.audio
// rows AND its cache files (m4a + blocks.json) -- never leak either.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-tts-prune-'));
fs.writeFileSync(path.join(binDir, 'piper'), `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
if (a.includes('--version')) { console.log('stub'); process.exit(0); }
const oi = a.indexOf('--output_file'); const out = oi >= 0 ? a[oi + 1] : null;
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
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-tts-prune-'));
const modelPath = path.join(binDir, 'voice.onnx');
fs.writeFileSync(modelPath, 'fake');
process.env.FILETUBE_TTS_PIPER_MODEL = modelPath;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, loadDatabase, scanBooks } = require('../../server');
const booksStore = require('../../lib/books/store');
const { buildEpub } = require('../helpers/build-zip');

let server;
let base;
let booksDir;
let epubPath;
let bookId;
let cacheKey;

before(async () => {
  booksDir = path.join(process.env.DATA_DIR, 'books');
  fs.mkdirSync(booksDir, { recursive: true });
  epubPath = path.join(booksDir, 'story.epub');
  fs.writeFileSync(epubPath, buildEpub({ title: 'Story', chapters: ['<p>Only chapter.</p>'] }));
  // A second book so deleting `story` doesn't scan the whole root EMPTY (which
  // the Option-C mount-loss guard would treat as an unmount, pruning nothing).
  fs.writeFileSync(path.join(booksDir, 'keeper.epub'), buildEpub({ title: 'Keeper', chapters: ['<p>Kept.</p>'] }));
  await updateDatabase((db) => { booksStore.ensureBooks(db).folders = [booksDir]; return true; });
  await scanBooks();
  const items = booksStore.readBooks(loadDatabase()).items;
  bookId = Object.keys(items).find((id) => items[id].title === 'Story');

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  await new Promise((r) => setTimeout(r, 150));

  // Synthesize chapter 0 so there is real audio + a cache file to protect/prune.
  const ensure = await (await fetch(`${base}/book/${bookId}/tts/0/ensure`, { method: 'POST' })).json();
  cacheKey = ensure.key;
  const deadline = Date.now() + 4000;
  for (;;) {
    const s = await (await fetch(`${base}/api/books/${bookId}/tts/0/status`)).json();
    if (s.status === 'ready' || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 40));
  }
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

function cacheFiles() {
  const dir = path.join(process.env.DATA_DIR, 'tts-cache');
  return { m4a: path.join(dir, `${cacheKey}.m4a`), blocks: path.join(dir, `${cacheKey}.blocks.json`) };
}

test('a rescan LEAVES a surviving book\'s audio status + cache files intact', async () => {
  const { m4a, blocks } = cacheFiles();
  assert.ok(fs.existsSync(m4a) && fs.existsSync(blocks), 'precondition: chapter synthesized');
  const audioBefore = booksStore.readBooks(loadDatabase()).audio[bookId];
  assert.ok(audioBefore && audioBefore['0'] && audioBefore['0'].status === 'ready');

  await scanBooks(); // file still present -> nothing pruned

  const audioAfter = booksStore.readBooks(loadDatabase()).audio[bookId];
  assert.deepStrictEqual(audioAfter, audioBefore, 'surviving book audio must be untouched by a scan');
  assert.ok(fs.existsSync(m4a) && fs.existsSync(blocks), 'cache files survive');
});

test('PRUNING a book (file gone + pruneMissing) deletes its audio rows AND cache files', async () => {
  const { m4a, blocks } = cacheFiles();
  // Turn on pruneMissing and remove the epub so the scan reaps it.
  await updateDatabase((db) => { db.settings = { ...(db.settings || {}), pruneMissing: true }; return true; });
  fs.unlinkSync(epubPath);

  await scanBooks();

  const ns = booksStore.readBooks(loadDatabase());
  assert.strictEqual(ns.items[bookId], undefined, 'the pruned book is gone from items');
  assert.strictEqual(ns.audio[bookId], undefined, 'the pruned book\'s audio rows are gone (no leak)');
  assert.ok(!fs.existsSync(m4a) && !fs.existsSync(blocks), 'the pruned book\'s cache files are swept');
});
