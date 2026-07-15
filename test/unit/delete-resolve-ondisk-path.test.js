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

// ---- SEAM 1 (v1.41.9): the recurring "delete a yt-dlp video -> rescan -> it
// REAPPEARS" bug. The library id is md5(item.filePath) = the STORED spelling,
// but yt-dlp can land the file at a spelling that DIVERGES from what we stored
// in a way NFC/NFD cannot bridge (full-width U+FF1F for '?', emoji ZWJ, raw
// invalid-UTF-8 bytes). The resolver used to report `gone` for those even
// though the real bytes are on disk, so the delete faked success and never
// unlinked. resolveOnDiskPath now recovers the real entry by the STABLE
// invariant -- the 11-char yt-dlp `[id]` bracket -- when both prior attempts
// miss. All fixtures are built from \u escapes / explicit bytes (v1.37.5
// lesson: no ambiguous multibyte or control bytes in source).
const YID = 'dQw4w9WgXcQ'; // an 11-char [A-Za-z0-9_-] YouTube id shape

test('SEAM 1: a full-width U+FF1F title divergence resolves by the [id] bracket', () => {
  const dir = tmpDir();
  const onDisk = path.join(dir, `What is Love\uFF1F [${YID}].mp4`); // yt-dlp full-width '?'
  fs.writeFileSync(onDisk, 'x');
  const stored = path.join(dir, `What is Love- [${YID}].mp4`); // the ASCII spelling we persisted
  assert.ok(!fs.existsSync(stored), 'precondition: existsSync misses the stored spelling');
  const resolved = resolveOnDiskPath(stored);
  assert.strictEqual(resolved.realPath, onDisk, 'resolved the real file by its id bracket');
  assert.strictEqual(resolved.realPathRaw, undefined, 'a round-tripping name needs no raw-buffer path');
  assert.strictEqual(resolved.gone, undefined);
});

test('SEAM 1: an emoji-ZWJ title divergence resolves by the [id] bracket', () => {
  const dir = tmpDir();
  // U+1F468 ZWJ U+1F469 ZWJ U+1F467 (family), as surrogate-pair \u escapes.
  const fam = '\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67';
  const onDisk = path.join(dir, `Family ${fam} [${YID}].mp4`);
  fs.writeFileSync(onDisk, 'x');
  const stored = path.join(dir, `Family [${YID}].mp4`);
  assert.ok(!fs.existsSync(stored));
  assert.strictEqual(resolveOnDiskPath(stored).realPath, onDisk);
});

test('SEAM 1 (#35a): a NON-round-tripping invalid-UTF-8 name resolves via raw bytes and yields an unlinkable Buffer path', () => {
  const dir = tmpDir();
  // Raw 0xFF is invalid UTF-8: readdir(string) decodes it to U+FFFD, whose
  // reconstructed path does NOT round-trip -- the raw-buffer pass must catch it.
  const onDiskBuf = Buffer.concat([
    Buffer.from(`${dir}${path.sep}Clip `, 'utf8'),
    Buffer.from([0xFF]),
    Buffer.from(` [${YID}].mp4`, 'utf8'),
  ]);
  fs.writeFileSync(onDiskBuf, 'x');
  const stored = path.join(dir, `Clip - [${YID}].mp4`);
  assert.ok(!fs.existsSync(stored));
  const resolved = resolveOnDiskPath(stored);
  assert.ok(Buffer.isBuffer(resolved.realPathRaw), 'a non-round-tripping name hands back a raw Buffer path');
  assert.ok(fs.existsSync(resolved.realPathRaw), 'the raw Buffer path points at the real dirent');
  // Prove it is actually unlinkable (what the DELETE handler does with it).
  fs.unlinkSync(resolved.realPathRaw);
  assert.ok(!fs.existsSync(resolved.realPathRaw), 'the real file was removed via the raw path');
});

test('SEAM 1 SAFETY: a coincidental [id] bracket on a NEIGHBOUR is NOT matched when the STORED name carries no bracket', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, `something [${YID}].mp4`), 'x'); // a yt-dlp file
  const stored = path.join(dir, 'plain-home-movie.mp4'); // stored name: no bracket
  const resolved = resolveOnDiskPath(stored);
  assert.strictEqual(resolved.realPath, null, 'a non-yt-dlp stored name is never matched by a neighbour bracket');
  assert.strictEqual(resolved.gone, true);
});

test('SEAM 1 SAFETY: two entries sharing the same id+ext are AMBIGUOUS -> gone, never a guess', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, `A\uFF1F [${YID}].mp4`), 'x');
  fs.writeFileSync(path.join(dir, `B\uFF1F [${YID}].mp4`), 'x');
  const stored = path.join(dir, `Title- [${YID}].mp4`);
  const resolved = resolveOnDiskPath(stored);
  assert.strictEqual(resolved.realPath, null, 'ambiguity must not be resolved to a guessed file');
  assert.strictEqual(resolved.gone, true);
});

test('SEAM 1 SAFETY: a different extension is not matched by the id alone', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, `Clip\uFF1F [${YID}].mkv`), 'x'); // same id, DIFFERENT ext
  const stored = path.join(dir, `Clip- [${YID}].mp4`);
  const resolved = resolveOnDiskPath(stored);
  assert.strictEqual(resolved.realPath, null, 'the extension must also match');
  assert.strictEqual(resolved.gone, true);
});
