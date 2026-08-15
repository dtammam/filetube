'use strict';

// [INTEGRATION] v1.128 Wave B (S2a) - the CONFIG/FOLDER read surfaces
// (census L1-L4). A restricted member's /api/config, /api/books/config,
// /api/music/config, and /api/books/folders must not leak root abs paths,
// folder/channel display names, or per-folder aggregates for content hidden
// from them - while an ADMIN and an UNRESTRICTED member get the byte-identical
// pre-Wave-B payload (an empty configured folder must never vanish from a
// user who has no restriction to enforce). Deleting any filter reds a test.
// Isolated DATA_DIR; own process.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-config-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, updateDatabase, getMediaId, userStore, __mintTestSession } = require('../../server');
const booksStore = require('../../lib/books/store');
const musicStore = require('../../lib/music/store');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, kidFolder, kidPath, unrestricted;
let pubRoot, hidRoot, bookPubRoot, bookHidRoot, musicPubRoot, musicHidRoot;

function vid(root, folderName, name) {
  const dir = path.join(root, folderName);
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, 'BYTES');
  return { id: getMediaId(fp), title: name.replace(/\.\w+$/, ''), name, filePath: fp, folderName, rootFolder: root, type: 'video', ext: '.mp4', duration: 5, size: 5, addedAt: 1 };
}

before(async () => {
  pubRoot = path.join(DATA_DIR, 'PublicRoot');
  hidRoot = path.join(DATA_DIR, 'HiddenRoot');
  bookPubRoot = path.join(DATA_DIR, 'BooksPublic');
  bookHidRoot = path.join(DATA_DIR, 'BooksHidden');
  musicPubRoot = path.join(DATA_DIR, 'MusicPublic');
  musicHidRoot = path.join(DATA_DIR, 'MusicHidden');
  for (const d of [pubRoot, hidRoot, bookPubRoot, bookHidRoot, musicPubRoot, musicHidRoot]) fs.mkdirSync(d, { recursive: true });

  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin

  const openVid = vid(pubRoot, 'FamilyChannel', 'open.mp4');
  const hidVid = vid(hidRoot, 'SecretChannel', 'secret.mp4');
  const bookPub = { id: 'bpub', title: 'Open Book', author: 'A', filePath: path.join(bookPubRoot, 'Shelf', 'open.epub'), folderName: 'OpenShelf', format: 'epub', addedAt: 1 };
  const bookHid = { id: 'bhid', title: 'Secret Book', author: 'A', filePath: path.join(bookHidRoot, 'Vault', 'secret.epub'), folderName: 'VaultShelf', format: 'epub', addedAt: 2 };
  const trkPub = { id: 'tpub', title: 'Open Song', artist: 'X', album: 'A', filePath: path.join(musicPubRoot, 'X', 'A', 'open.flac'), rootFolder: musicPubRoot, addedAt: 1 };
  const trkHid = { id: 'thid', title: 'Secret Song', artist: 'Y', album: 'B', filePath: path.join(musicHidRoot, 'Y', 'B', 'secret.flac'), rootFolder: musicHidRoot, addedAt: 2 };

  saveDatabase({
    folders: [pubRoot, hidRoot], folderSettings: { [pubRoot]: { name: 'Family' }, [hidRoot]: { name: 'Secret' } },
    folderDisplayNames: { FamilyChannel: 'Family Channel', SecretChannel: 'Secret Channel' },
    progress: {}, metadata: { [openVid.id]: openVid, [hidVid.id]: hidVid },
    viewCounts: {}, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
  await updateDatabase((db) => {
    const b = booksStore.ensureBooks(db);
    b.folders = [bookPubRoot, bookHidRoot];
    b.items = { bpub: bookPub, bhid: bookHid };
    const m = musicStore.ensureMusic(db);
    m.folders = [musicPubRoot, musicHidRoot];
    m.tracks = { tpub: trkPub, thid: trkHid };
    return true;
  });

  // Two restricted members (different shapes), both blocked from the hidden roots.
  kidFolder = __mintTestSession({ username: 'kidfolder', role: 'member' });
  userStore.setRestrictions(kidFolder.user.id, [{ kind: 'folder', value: 'SecretChannel' }, { kind: 'path', value: bookHidRoot }, { kind: 'path', value: musicHidRoot }]);
  kidPath = __mintTestSession({ username: 'kidpath', role: 'member' });
  userStore.setRestrictions(kidPath.user.id, [{ kind: 'path', value: hidRoot }, { kind: 'path', value: bookHidRoot }, { kind: 'path', value: musicHidRoot }]);
  // An unrestricted member - MUST see the full config, byte-identical to admin.
  unrestricted = __mintTestSession({ username: 'freemember', role: 'member' });
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const getJson = (p, cookie) => fetch(`${base}${p}`, { headers: cookie ? { Cookie: cookie } : {} }).then((r) => r.json());

test('L1 /api/config: a path-restricted member sees only visible roots + display names; admin & unrestricted see all', async () => {
  const adminCfg = await getJson('/api/config', undefined);
  assert.ok(adminCfg.folders.includes(hidRoot), 'admin sees the hidden root');
  assert.ok(Object.keys(adminCfg.folderDisplayNames).includes('SecretChannel'), 'admin sees the hidden display name');

  const freeCfg = await getJson('/api/config', unrestricted.cookie);
  assert.deepStrictEqual(freeCfg, adminCfg, 'an UNRESTRICTED member gets the byte-identical config (no empty-folder vanish)');

  for (const [label, who] of [['folder-kind', kidFolder], ['path-kind', kidPath]]) {
    const cfg = await getJson('/api/config', who.cookie);
    assert.ok(cfg.folders.includes(pubRoot), `${label}: keeps the visible root`);
    assert.ok(!cfg.folders.includes(hidRoot), `${label}: drops the hidden root`);
    assert.ok(!Object.keys(cfg.folderSettings).includes(hidRoot), `${label}: drops hidden folderSettings`);
    assert.deepStrictEqual(Object.keys(cfg.folderDisplayNames), ['FamilyChannel'], `${label}: drops the hidden display name`);
    assert.ok(!JSON.stringify(cfg).includes('Secret Channel'), `${label}: no hidden display label anywhere`);
  }
});

test('L2/L3 /api/books/config + /api/music/config: restricted member sees only roots with a visible item', async () => {
  const adminBooks = await getJson('/api/books/config', undefined);
  assert.deepStrictEqual(adminBooks.folders.sort(), [bookHidRoot, bookPubRoot].sort(), 'admin sees both book roots');
  const freeBooks = await getJson('/api/books/config', unrestricted.cookie);
  assert.deepStrictEqual(freeBooks.folders.sort(), adminBooks.folders.sort(), 'unrestricted member sees both');
  const kidBooks = await getJson('/api/books/config', kidPath.cookie);
  assert.deepStrictEqual(kidBooks.folders, [bookPubRoot], 'restricted: only the visible book root');

  const adminMusic = await getJson('/api/music/config', undefined);
  assert.deepStrictEqual(adminMusic.folders.sort(), [musicHidRoot, musicPubRoot].sort(), 'admin sees both music roots');
  const kidMusic = await getJson('/api/music/config', kidPath.cookie);
  assert.deepStrictEqual(kidMusic.folders, [musicPubRoot], 'restricted: only the visible music root');
});

test('L4 /api/books/folders: restricted member sees no hidden shelf dir/name/count', async () => {
  const adminFolders = await getJson('/api/books/folders', undefined);
  assert.strictEqual(adminFolders.folders.length, 2, 'admin sees both shelves');

  const kidFolders = await getJson('/api/books/folders', kidPath.cookie);
  assert.strictEqual(kidFolders.folders.length, 1, 'restricted sees one shelf');
  assert.strictEqual(kidFolders.folders[0].name, 'OpenShelf', 'the visible shelf');
  assert.ok(!JSON.stringify(kidFolders).includes(bookHidRoot), 'no hidden shelf abs dir leaks');
  assert.ok(!JSON.stringify(kidFolders).includes('Vault'), 'no hidden shelf name leaks');
});
