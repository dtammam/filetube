'use strict';

// [INTEGRATION] v1.123 T4 (security) - cache-header posture behind the auth wall.
//
// Book covers, album art and podcast art all 404 PER-USER via RBAC, yet were
// served `Cache-Control: public` - a shared cache (reverse proxy) keyed on the
// URL alone could hand one user's (or a restricted item's) art to another. They
// now serve `private` (the user's own browser may still cache; a shared cache
// must not). The admin backup bundle - password hashes + every per-user state -
// carried NO Cache-Control at all; it now serves `no-store` (must not persist
// anywhere, not even the browser's disk). This binds each header at the ROUTE:
// flip one back to `public`/drop it and the matching assertion reddens.
//
// FILETUBE_PODCASTS_DIR is pointed at an isolated dir so the podcast show art
// resolves to a real cover file. Own process, isolated DATA_DIR.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cachehdr-'));
process.env.FILETUBE_PODCASTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cachehdr-pod-'));
const DATA_DIR = process.env.DATA_DIR;
const PODROOT = process.env.FILETUBE_PODCASTS_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, updateDatabase } = require('../../server');
const podcastStore = require('../../lib/podcasts/store');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth;
const SUB = 'c'.repeat(32);

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // patches global fetch with the admin cookie

  // Real art files in the server's per-instance dirs (under DATA_DIR).
  const bookCoverDir = path.join(DATA_DIR, '.bookcovers');
  const albumArtDir = path.join(DATA_DIR, '.albumart');
  fs.mkdirSync(bookCoverDir, { recursive: true });
  fs.mkdirSync(albumArtDir, { recursive: true });
  fs.writeFileSync(path.join(bookCoverDir, 'b1.jpg'), 'JPEGBYTES');
  fs.writeFileSync(path.join(albumArtDir, 'k1.jpg'), 'JPEGBYTES');

  saveDatabase({
    folders: [], folderSettings: {}, progress: {}, metadata: {}, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
    books: { folders: [], items: { b1: { id: 'b1', title: 'Bk', author: 'A', hasCover: true, coverExt: '.jpg', filePath: path.join(DATA_DIR, 'b.epub'), folderName: 'B', rootFolder: DATA_DIR } }, progress: {}, pins: [], settings: {}, audio: {} },
    music: { folders: [], tracks: { t1: { id: 't1', title: 'T', albumArtKey: 'k1', filePath: path.join(DATA_DIR, 't.mp3'), folderName: 'M', rootFolder: DATA_DIR } }, settings: {} },
  });

  // A podcast show whose art resolves to a real cover.jpg on disk.
  const showDir = path.join(PODROOT, 'My Show');
  fs.mkdirSync(showDir, { recursive: true });
  fs.writeFileSync(path.join(showDir, 'cover.jpg'), 'JPEGBYTES');
  await updateDatabase((db) => {
    const ns = podcastStore.ensurePodcasts(db);
    ns.subscriptions = []; ns.episodes = {};
    podcastStore.reduceAddSubscription(ns, { id: SUB, name: 'My Show', feedUrl: 'https://e.com/s.xml' });
    const sub = ns.subscriptions.find((s) => s.id === SUB);
    sub.showDirName = 'My Show'; // adopted-on-poll in prod; set directly here
    return true;
  });
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.rmSync(PODROOT, { recursive: true, force: true });
  delete process.env.FILETUBE_PODCASTS_DIR;
});

const cc = async (p) => (await fetch(`${base}${p}`)).headers.get('cache-control');

test('ART: RBAC-gated art is `private` (never shared-cacheable) - real files', async () => {
  assert.match(await cc('/bookcover/b1'), /^private/, 'book cover must be private');
  assert.match(await cc('/albumart/t1'), /^private/, 'album art must be private');
  assert.match(await cc(`/podcastart/${SUB}`), /^private/, 'podcast art must be private');
});

test('ART: the SVG placeholders are `private` too (uniform axis behind the auth wall)', async () => {
  assert.match(await cc('/albumart/nonexistent'), /^private/, 'album art placeholder must be private');
  assert.match(await cc(`/podcastart/${'d'.repeat(32)}`), /^private/, 'podcast art placeholder must be private');
});

test('BACKUP: the admin bundle is `no-store` (password hashes must not cache anywhere)', async () => {
  const res = await fetch(`${base}/api/admin/backup`);
  assert.strictEqual(res.status, 200, 'admin backup returns the bundle');
  assert.strictEqual(res.headers.get('cache-control'), 'no-store', 'backup must be no-store');
});
