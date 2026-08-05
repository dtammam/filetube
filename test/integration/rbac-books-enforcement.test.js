'use strict';

// [INTEGRATION] v1.80 RBAC T7 - BOOKS enforcement (the "private book libraries"
// use-case). A member restricted on a book root is 404'd on /book/:id/file,
// /bookcover, and the TTS text/audio routes (the private-text leak the original
// plan nearly missed), and the book is omitted from /api/books; an unrestricted
// book and the admin are unaffected. Isolated DATA_DIR; own process.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-books-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, updateDatabase, userStore, __mintTestSession } = require('../../server');
const booksStore = require('../../lib/books/store');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, member;
const privDir = path.join(DATA_DIR, 'Private');
const kidsDir = path.join(DATA_DIR, 'Kids');
const blockedFile = path.join(privDir, 'secret.epub');
const allowedFile = path.join(kidsDir, 'nursery.epub');

before(async () => {
  fs.mkdirSync(privDir, { recursive: true });
  fs.mkdirSync(kidsDir, { recursive: true });
  fs.writeFileSync(blockedFile, 'BOOKBYTES');
  fs.writeFileSync(allowedFile, 'BOOKBYTES');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  saveDatabase({ folders: [], folderSettings: {}, progress: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await updateDatabase((db) => {
    const ns = booksStore.ensureBooks(db);
    ns.items = {
      blk: { id: 'blk', title: 'Secret', author: 'A', filePath: blockedFile, folderName: 'Private', format: 'epub', addedAt: 20 },
      ok: { id: 'ok', title: 'Nursery Rhymes', author: 'B', filePath: allowedFile, folderName: 'Kids', format: 'epub', addedAt: 10 },
    };
    return true;
  });
  member = __mintTestSession({ username: 'kidbooks', role: 'member' });
  // Restrict on the Private book root (prefix) - everything under it is private.
  userStore.setRestrictions(member.user.id, [{ kind: 'path', value: privDir }]);
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});
const asMember = (p) => fetch(`${base}${p}`, { headers: { Cookie: member.cookie } });
const asAdmin = (p) => fetch(`${base}${p}`);

test('BOOKS: restricted member 404 on file/cover/tts + omitted from list; admin ok', async () => {
  assert.strictEqual((await asMember('/book/blk/file')).status, 404, 'private book file');
  assert.strictEqual((await asMember('/book/ok/file')).status, 200, 'allowed book file');
  assert.strictEqual((await asMember('/book/blk/file?download=1')).status, 404, 'download not an escape');
  assert.strictEqual((await asMember('/bookcover/blk')).status, 404);
  assert.strictEqual((await asMember('/api/books/blk')).status, 404);
  // the private-text leak routes
  assert.strictEqual((await asMember('/book/blk/tts/0/blocks')).status, 404, 'private book TEXT blocks');
  assert.strictEqual((await asMember('/book/blk/tts/0')).status, 404, 'private book TTS audio');

  const ids = ((await (await asMember('/api/books?limit=50')).json()).items || []).map((i) => i.id);
  assert.deepStrictEqual(ids, ['ok'], '/api/books omits the private book');

  // admin unaffected
  assert.strictEqual((await asAdmin('/book/blk/file')).status, 200);
  const adminIds = ((await (await asAdmin('/api/books?limit=50')).json()).items || []).map((i) => i.id).sort();
  assert.deepStrictEqual(adminIds, ['blk', 'ok']);
});
