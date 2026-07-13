'use strict';

// [UNIT] v1.37.5 -- the "I delete things and they don't actually get deleted"
// fix (Dean): DELETE /api/videos/:id used to skip the unlink and delete the
// db entry anyway with {success:true} whenever `fs.existsSync(item.filePath)`
// missed the real file -- so the card vanished (client trusts success) while
// the file survived on disk and the next scan resurrected it. The dominant
// trigger is a Unicode NORMALIZATION mismatch: the stored path is one form
// (NFC) while the on-disk name is another (NFD, as macOS/APFS and many SMB
// shares emit), and `existsSync` compares byte-exact.
//
// `resolveOnDiskPath` maps the stored path to the REAL on-disk entry by
// resolving it one path component at a time by NFC-normalized match (so a
// normalization difference in ANY segment -- a per-channel FOLDER as much as
// the leaf -- is handled), and reports the three states the handler must
// distinguish (found / genuinely-gone / un-enumerable) so a delete that CANNOT
// be confirmed is surfaced honestly instead of faked.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const { resolveOnDiskPath } = require('../../server');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-resolve-ondisk-'));
}

// Built from explicit code points so the SOURCE FILE carries no ambiguous
// bytes an editor could silently re-normalize. On a byte-exact filesystem
// (Linux ext4/tmpfs, incl. CI) these two are DISTINCT names.
const NFD_NAME = 'Cafe\u0301 video.mp4'; // NFD: 'e' + U+0301 combining acute
const NFC_NAME = 'Caf\u00e9 video.mp4'; // NFC: precomposed U+00E9

test('existsSync hit: returns the stored path verbatim (the common, unchanged path)', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'plain.mp4');
  fs.writeFileSync(p, 'x');
  assert.deepStrictEqual(resolveOnDiskPath(p), { realPath: p });
});

test('NFC stored path resolves to the NFD file actually on disk (the headline fix)', () => {
  const dir = tmpDir();
  const onDisk = path.join(dir, NFD_NAME); // what the scanner walked / the disk holds
  fs.writeFileSync(onDisk, 'x');
  const stored = path.join(dir, NFC_NAME); // what db.metadata persisted
  // Guard the repro itself: on a normalization-insensitive FS this assertion
  // would be meaningless, so assert the byte-exact miss we depend on.
  assert.ok(!fs.existsSync(stored), 'precondition: existsSync must MISS the NFC form on a byte-exact FS');
  const resolved = resolveOnDiskPath(stored);
  assert.strictEqual(resolved.realPath, onDisk, 'must resolve to the real NFD entry, not null');
  assert.strictEqual(resolved.gone, undefined);
  assert.strictEqual(resolved.unreadable, undefined);
});

test('NFC/NFD mismatch in an ANCESTOR (channel folder) resolves too, not just the leaf', () => {
  // FileTube stores downloads in per-channel folders; SMB/APFS emit NFD for
  // the WHOLE path. The diacritic here is in the FOLDER name, and the file
  // name is plain ASCII -- the pre-walk basename-only fix would have missed it.
  const root = tmpDir();
  const folderNfd = 'Beyonce\u0301'; // 'e' + U+0301 combining acute (NFD)
  const folderNfc = 'Beyonc\u00e9'; // precomposed U+00E9 (NFC)
  const onDiskDir = path.join(root, folderNfd);
  fs.mkdirSync(onDiskDir, { recursive: true });
  const onDisk = path.join(onDiskDir, 'clip.mp4');
  fs.writeFileSync(onDisk, 'x');

  const stored = path.join(root, folderNfc, 'clip.mp4');
  assert.ok(!fs.existsSync(stored), 'precondition: existsSync must MISS the NFC folder spelling');
  const resolved = resolveOnDiskPath(stored);
  assert.strictEqual(resolved.realPath, onDisk, 'must resolve through the NFD folder to the real file');
});

test('genuinely absent (dir exists, no matching entry) -> { gone: true }, no fake path', () => {
  const dir = tmpDir();
  const resolved = resolveOnDiskPath(path.join(dir, 'never-existed.mp4'));
  assert.strictEqual(resolved.realPath, null);
  assert.strictEqual(resolved.gone, true);
});

test('parent directory itself gone (ENOENT) -> { gone: true } (whole folder removed)', () => {
  const dir = tmpDir();
  const resolved = resolveOnDiskPath(path.join(dir, 'missing-sub', 'x.mp4'));
  assert.strictEqual(resolved.realPath, null);
  assert.strictEqual(resolved.gone, true);
});

test('parent path is a FILE, not a dir (ENOTDIR) -> unconfirmable, NOT gone', () => {
  const dir = tmpDir();
  const notADir = path.join(dir, 'iamafile');
  fs.writeFileSync(notADir, 'x');
  const resolved = resolveOnDiskPath(path.join(notADir, 'child.mp4'));
  assert.strictEqual(resolved.realPath, null);
  assert.strictEqual(resolved.gone, undefined, 'ENOTDIR must never be reported as genuinely-gone');
  assert.ok(resolved.unreadable, 'ENOTDIR must be reported as un-enumerable so the route 409s instead of faking success');
  assert.strictEqual(resolved.unreadable.code, 'ENOTDIR');
});
