'use strict';

// [INTEGRATION] v1.65 gate fix (adversarial W6) -- trashItem's EXDEV
// verified-copy branch, which had ZERO coverage: on the one layout it
// exists for (a bind-mounted subtree inside a root), a broken checksum
// comparison would silently accept a corrupt copy and unlink the original.
// Port of move-checksum.test.js's two cases to the trash path.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trashexdev-'));

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  trashItem, getMediaId, loadDatabase, saveDatabase, updateDatabase, __resetDatabaseForTests,
} = require('../../server');
const { TRASH_DIR_NAME } = require('../../lib/trashPaths');

let ROOT;

beforeEach(async () => {
  await __resetDatabaseForTests();
});

function seedLibrary() {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-trashexdevlib-'));
  fs.mkdirSync(path.join(ROOT, 'Chan'), { recursive: true });
  const filePath = path.join(ROOT, 'Chan', 'xdev.mp4');
  fs.writeFileSync(filePath, 'GENUINE-BYTES-OF-THE-ORIGINAL');
  const id = getMediaId(filePath);
  saveDatabase({
    folders: [ROOT], folderSettings: {}, progress: {},
    metadata: { [id]: { id, name: 'xdev.mp4', title: 'X', filePath, folderName: 'Chan', rootFolder: ROOT, size: 29, ext: '.mp4', type: 'video', addedAt: Date.now(), duration: 5 } },
    settings: { scanIntervalMinutes: 0, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 0, trashRetentionDays: 30 },
  });
  return { id, filePath };
}

// An fs whose linkSync always EXDEVs (the bind-mount layout) and whose
// copyFileSync optionally corrupts the copy (same size, flipped bytes --
// the silent-NAS-corruption shape the sha256 exists for).
function exdevFs({ corruptCopy }) {
  return new Proxy(fs, {
    get(target, prop) {
      if (prop === 'linkSync') {
        return () => { const e = new Error('EXDEV: cross-device link'); e.code = 'EXDEV'; throw e; };
      }
      if (prop === 'copyFileSync' && corruptCopy) {
        return (src, dst, mode) => {
          target.copyFileSync(src, dst, mode);
          const buf = Buffer.from(target.readFileSync(dst));
          buf[0] ^= 0xff; // same size, corrupt content
          target.writeFileSync(dst, buf);
        };
      }
      return target[prop];
    },
  });
}

test('EXDEV happy path: the verified copy lands, the source unlinks, the record commits', async () => {
  const { id, filePath } = seedLibrary();
  const res = await trashItem({ loadDatabase, updateDatabase, getMediaId, fs: exdevFs({ corruptCopy: false }) }, id);
  assert.equal(res.ok, true);
  assert.ok(!fs.existsSync(filePath), 'source removed only after verification');
  assert.equal(fs.readFileSync(res.trashPath, 'utf8'), 'GENUINE-BYTES-OF-THE-ORIGINAL');
  assert.ok(loadDatabase().trash[res.trashId]);
});

test('EXDEV corrupt copy: sha256 REFUSES it -- the bad copy is removed, the SOURCE IS NEVER UNLINKED, no record exists', async () => {
  const { id, filePath } = seedLibrary();
  const res = await trashItem({ loadDatabase, updateDatabase, getMediaId, fs: exdevFs({ corruptCopy: true }) }, id);
  assert.equal(res.ok, false);
  assert.equal(res.status, 500);
  assert.match(res.error, /sha256|verification/i);
  assert.ok(fs.existsSync(filePath), 'THE binding: the original survives a corrupt copy');
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'GENUINE-BYTES-OF-THE-ORIGINAL', 'byte-identical');
  const trashDir = path.join(ROOT, TRASH_DIR_NAME);
  const leftovers = fs.existsSync(trashDir) ? fs.readdirSync(trashDir) : [];
  assert.deepEqual(leftovers, [], 'the corrupt copy was taken back out');
  assert.deepEqual(loadDatabase().trash, {}, 'no record was minted');
  assert.ok(loadDatabase().metadata[id], 'the library entry is untouched');
});
