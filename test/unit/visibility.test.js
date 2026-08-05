'use strict';

// [UNIT] v1.80 RBAC - the pure visibility decision (lib/auth/visibility.js). No
// DB, no request. Every assertion kills a specific mutant (flip a boundary, a
// kind, a library map, the folder-video-only rule). This is the security core -
// if a mutant survives here, a restricted item can leak.

const { test } = require('node:test');
const assert = require('node:assert');

const { buildRestrictionIndex, isBlocked, filterVisible, underPath } = require('../../lib/auth/visibility');

const idxOf = (rows) => buildRestrictionIndex(rows);

// ---- underPath boundary correctness (the classic prefix bypass) ------------

test('underPath: exact + nested match, boundary-correct', () => {
  assert.ok(underPath('/media/Kids', '/media/Kids'));           // exact
  assert.ok(underPath('/media/Kids/a.mp4', '/media/Kids'));     // nested (posix)
  assert.ok(underPath('C:\\media\\Kids\\a.mp4'.replace(/\\/g, '\\'), 'C:\\media\\Kids')); // windows sep
  assert.ok(!underPath('/media/KidsStuff/a.mp4', '/media/Kids'), 'must NOT match a sibling with a shared prefix');
  assert.ok(!underPath('/media/Kid', '/media/Kids'));
  assert.ok(!underPath('/media/Kids', ''), 'empty prefix never matches');
});

// ---- path restrictions ------------------------------------------------------

test('path restriction blocks the root and everything nested (video/music/book)', () => {
  const idx = idxOf([{ kind: 'path', value: '/media/Adult' }]);
  assert.ok(isBlocked(idx, { kind: 'media', filePath: '/media/Adult/x.mp4' }));
  assert.ok(isBlocked(idx, { kind: 'track', filePath: '/media/Adult/Album/y.mp3' }));
  assert.ok(isBlocked(idx, { kind: 'book', filePath: '/media/Adult/z.epub' }));
  assert.ok(!isBlocked(idx, { kind: 'media', filePath: '/media/Kids/x.mp4' }), 'a sibling root is visible');
  // rootFolder is also checked (exact-root restriction bites even on odd filePath shapes)
  assert.ok(isBlocked(idx, { kind: 'media', filePath: '', rootFolder: '/media/Adult' }));
});

// ---- folder (video channel) restrictions ------------------------------------

test('folder restriction blocks a video channel ONLY (not music with same folderName)', () => {
  const idx = idxOf([{ kind: 'folder', value: 'ScaryChannel' }]);
  assert.ok(isBlocked(idx, { kind: 'media', folderName: 'ScaryChannel', filePath: '/m/ScaryChannel/a.mp4' }));
  assert.ok(!isBlocked(idx, { kind: 'media', folderName: 'NiceChannel', filePath: '/m/NiceChannel/a.mp4' }));
  // a track that happens to share the folderName is NOT blocked by a video-folder rule
  assert.ok(!isBlocked(idx, { kind: 'track', folderName: 'ScaryChannel', filePath: '/music/x.mp3' }));
});

// ---- show (podcast) restrictions --------------------------------------------

test('show restriction blocks a podcast show by subId', () => {
  const idx = idxOf([{ kind: 'show', value: 'sub-abc' }]);
  assert.ok(isBlocked(idx, { kind: 'podcast', subId: 'sub-abc' }));
  assert.ok(!isBlocked(idx, { kind: 'podcast', subId: 'sub-xyz' }));
});

// ---- library toggles --------------------------------------------------------

test('library restriction blocks an entire kind', () => {
  assert.ok(isBlocked(idxOf([{ kind: 'library', value: 'podcasts' }]), { kind: 'podcast', subId: 'anything' }));
  assert.ok(isBlocked(idxOf([{ kind: 'library', value: 'music' }]), { kind: 'track', filePath: '/music/a.mp3' }));
  assert.ok(isBlocked(idxOf([{ kind: 'library', value: 'books' }]), { kind: 'book', filePath: '/b/a.epub' }));
  assert.ok(isBlocked(idxOf([{ kind: 'library', value: 'video' }]), { kind: 'media', filePath: '/m/a.mp4' }));
  // a music-library block does NOT block video
  assert.ok(!isBlocked(idxOf([{ kind: 'library', value: 'music' }]), { kind: 'media', filePath: '/m/a.mp4' }));
});

// ---- admin (empty index) ----------------------------------------------------

test('an empty index (admin) blocks nothing', () => {
  const idx = idxOf([]);
  for (const d of [
    { kind: 'media', filePath: '/media/Adult/x.mp4', folderName: 'ScaryChannel' },
    { kind: 'podcast', subId: 'sub-abc' },
    { kind: 'track', filePath: '/music/x.mp3' },
    { kind: 'book', filePath: '/b/a.epub' },
  ]) assert.ok(!isBlocked(idx, d));
});

// ---- filterVisible ----------------------------------------------------------

test('filterVisible keeps only visible items', () => {
  const idx = idxOf([{ kind: 'folder', value: 'Bad' }]);
  const items = [{ id: 'a', folderName: 'Bad' }, { id: 'b', folderName: 'Good' }];
  const kept = filterVisible(idx, items, (it) => ({ kind: 'media', folderName: it.folderName, filePath: `/m/${it.folderName}/x` }));
  assert.deepStrictEqual(kept.map((i) => i.id), ['b']);
});

// ---- garbage tolerance + prototype safety -----------------------------------

test('garbage rows are ignored; a __proto__ value is inert data', () => {
  const idx = idxOf([
    null, { kind: 'path' }, { kind: 'path', value: '' }, { kind: 'nope', value: 'x' },
    { kind: 'folder', value: '__proto__' },
  ]);
  // __proto__ is a plain Set member, not a prototype write
  assert.ok(isBlocked(idx, { kind: 'media', folderName: '__proto__', filePath: '/m/x' }));
  assert.ok(!isBlocked(idx, { kind: 'media', folderName: 'constructor', filePath: '/m/x' }));
  assert.strictEqual(({}).polluted, undefined);
  // a null/garbage descriptor never throws and never blocks
  assert.ok(!isBlocked(idx, null));
  assert.ok(!isBlocked(idx, undefined));
  assert.ok(!isBlocked(idx, {}));
});

test('missing descriptor fields never throw', () => {
  const idx = idxOf([{ kind: 'path', value: '/x' }, { kind: 'show', value: 's' }]);
  assert.ok(!isBlocked(idx, { kind: 'media' }));       // no filePath
  assert.ok(!isBlocked(idx, { kind: 'podcast' }));     // no subId
  assert.ok(!isBlocked(idx, { kind: 'track', filePath: undefined }));
});
