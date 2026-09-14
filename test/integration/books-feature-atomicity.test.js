'use strict';

// [INTEGRATION] Wave 5 of the relational-migration arc (books) - the books
// namespace is six tables behind a feature store whose writes ride the doc
// commit. Through the REAL routes and functions, populate first, then the
// failure axis, then the happy path:
//   - POST /api/books/config whose doc save FAILS leaves the root list
//     untouched (500, never a hang); the committed POST replaces it;
//   - the TTS status writer (setBookAudioStatus, through the module's deps)
//     whose doc save FAILS leaves the audio map untouched; the committed
//     write lands; the no-clobber skip writes nothing;
//   - the scan merge whose doc save FAILS leaves the item rows untouched; the
//     committed pass indexes the file; an unchanged pass writes nothing;
//   - the bundle carries `books` (the frozen progress + pins included), a
//     restore round-trips it, and a malformed `books` is a 400 BEFORE the wipe.

const { DATA_DIR } = require('../helpers/isolate-data-dir');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, __resetDatabaseForTests, __failNextSaveForTests, scanBooks, booksDb, updateDatabase } = require('../../server');
const booksStore = require('../../lib/books/store');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { readPersistedDatabase } = require('../../lib/db/sqlite');

let server;
let base;
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});
after(async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); });
beforeEach(() => __resetDatabaseForTests());

const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const withTimeout = (p, ms = 4000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`no response within ${ms}ms (the handler hung)`)), ms))]);
const settings = { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0 };
const EMPTY = { folders: [], items: {}, progress: {}, pins: [], settings: {}, audio: {} };

test('POST /api/books/config: a FAILED doc save leaves the root list untouched and answers 500; the committed POST replaces it', async () => {
  const A = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-bk-a-'));
  const B = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-bk-b-'));
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, books: { ...EMPTY, folders: [A] } });
  assert.deepStrictEqual(booksDb.read().folders, [A], 'populated');
  __failNextSaveForTests(new Error('simulated save failure'));
  const failed = await withTimeout(post('/api/books/config', { folders: [B] }));
  assert.strictEqual(failed.status, 500, await failed.text());
  assert.deepStrictEqual(booksDb.read().folders, [A], 'a failed save wrote nothing');
  assert.deepStrictEqual(readPersistedDatabase(DATA_DIR).books.folders, [A], 'on disk too');
  const ok = await withTimeout(post('/api/books/config', { folders: [B] }));
  assert.strictEqual(ok.status, 200, await ok.text());
  assert.deepStrictEqual(booksDb.read().folders, [B]);
});

test('the TTS status writer through the module\'s deps: a FAILED doc save leaves the audio map untouched; the committed write lands; the no-clobber skip writes nothing', async () => {
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, books: { ...EMPTY, audio: { b1: { 0: { status: 'ready', key: 'k0' } } } } });
  const deps = { updateDatabase, booksDb };
  __failNextSaveForTests(new Error('simulated save failure'));
  await assert.rejects(booksStore.setBookAudioStatus(deps, 'b1', 1, { status: 'processing' }), /simulated save failure/);
  assert.deepStrictEqual(booksDb.read().audio, { b1: { 0: { status: 'ready', key: 'k0' } } }, 'a failed save wrote nothing');
  assert.strictEqual(await booksStore.setBookAudioStatus(deps, 'b1', 1, { status: 'processing' }), true);
  assert.deepStrictEqual(booksDb.read().audio, { b1: { 0: { status: 'ready', key: 'k0' }, 1: { status: 'processing' } } }, 'the committed write landed one entry');
  assert.strictEqual(await booksStore.setBookAudioStatus(deps, 'b1', 1, { status: 'processing' }), false, 'no-clobber: unchanged = no write');
  assert.strictEqual(await booksStore.clearBookAudioStatus(deps, 'b1', 1), true);
  assert.deepStrictEqual(booksDb.read().audio, { b1: { 0: { status: 'ready', key: 'k0' } } });
  assert.deepStrictEqual(booksDb.syncFrom(booksDb.read()), { rowsWritten: 0, rowsDeleted: 0 }, 'the diff, not a rewrite');
});

test('the scan merge: a FAILED doc save leaves the item rows untouched; the committed pass indexes the file; an unchanged pass writes nothing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-bk-scan-'));
  fs.writeFileSync(path.join(root, 'A Book.pdf'), '%PDF-1.4 not really');
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, books: { ...EMPTY, folders: [root] } });
  __failNextSaveForTests(new Error('simulated save failure'));
  await scanBooks().catch(() => {});
  assert.deepStrictEqual(booksDb.read().items, {}, 'a failed merge indexed nothing');
  await scanBooks();
  assert.strictEqual(Object.keys(booksDb.read().items).length, 1, 'the committed pass indexed the book');
  assert.deepStrictEqual(booksDb.syncFrom(booksDb.read()), { rowsWritten: 0, rowsDeleted: 0 }, 'an unchanged pass writes nothing');
});

test('the bundle carries `books` (frozen progress + pins included) and a restore round-trips it; a malformed `books` is a 400 BEFORE the wipe', async () => {
  const ns = { folders: ['/books'], items: { b1: { id: 'b1', title: 'One', author: 'A', filePath: '/books/one.epub', rootFolder: '/books', format: 'epub' } }, progress: { b1: { locator: { kind: 'epub', cfi: 'x' }, percent: 40, updatedAt: 't' } }, pins: [{ id: 'p1', dir: '/books', label: 'Shelf', pinnedAt: 't', order: 0 }], settings: { engine: 'piper' }, audio: { b1: { 0: { status: 'ready', key: 'k' } } } };
  seedState({ folders: [], folderSettings: {}, metadata: {}, settings, books: ns });
  const bundle = await (await fetch(`${base}/api/admin/backup`)).json();
  delete bundle.users;
  assert.deepStrictEqual(bundle.books, ns);
  for (const bad of [['x'], { playlists: {} }, { items: { '': {} } }, { pins: [{ noId: 1 }] }, { folders: [7] }]) {
    const r = await withTimeout(post('/api/admin/restore', { ...bundle, books: bad }));
    assert.strictEqual(r.status, 400, `${JSON.stringify(bad)}: ${await r.clone().text()}`);
    assert.deepStrictEqual(booksDb.read().pins, ns.pins, 'the live rows survived the refusal');
  }
  booksDb.replaceAll({ folders: ['/scratch'] });
  const r = await post('/api/admin/restore', bundle);
  assert.strictEqual(r.status, 200, await r.text());
  assert.deepStrictEqual(booksDb.read(), ns, 'the own export restored verbatim');
  const without = { ...bundle };
  delete without.books;
  assert.strictEqual((await post('/api/admin/restore', without)).status, 200);
  assert.deepStrictEqual(booksDb.read(), EMPTY, 'a bundle without the key restores to an empty namespace');
});
