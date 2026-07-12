'use strict';

// [UNIT] v1.33 T4 (tech-debt #10, Dean's Option C) -- detectVanishedRoots,
// the EMPTY-BUT-PRESENT mountpoint detector. Pure-function tests against the
// exact signature: a configured root that previously held indexed items and
// contributed ZERO files to this scan (no survivors, no new files) is a
// vanished root; a single survivor OR a single new file defuses it entirely.
const { test } = require('node:test');
const assert = require('node:assert');

const { detectVanishedRoots } = require('../../server');

const ROOT_A = '/media/library-a';
const ROOT_B = '/media/library-b';

function entry(id, root, name) {
  return { id, filePath: `${root}/${name || id}.mp4`, rootFolder: root };
}

test('a root whose entire prior content vanished (zero current items) is detected', () => {
  const oldMeta = { a1: entry('a1', ROOT_A), a2: entry('a2', ROOT_A) };
  const newMeta = {}; // nothing found this pass
  assert.deepEqual(detectVanishedRoots(oldMeta, newMeta, [ROOT_A], new Set()), [ROOT_A]);
});

test('one SURVIVING item under the root defuses the signature (an individual deletion, not an unmount)', () => {
  const oldMeta = { a1: entry('a1', ROOT_A), a2: entry('a2', ROOT_A) };
  const newMeta = { a1: entry('a1', ROOT_A) }; // a1 survived, a2 individually gone
  assert.deepEqual(detectVanishedRoots(oldMeta, newMeta, [ROOT_A], new Set()), []);
});

test('one NEW item under the root defuses the signature too (a live mount with fresh content is not an empty mountpoint)', () => {
  const oldMeta = { a1: entry('a1', ROOT_A) };
  const newMeta = { fresh: entry('fresh', ROOT_A) }; // prior item gone, but a new file proves the mount is alive
  assert.deepEqual(detectVanishedRoots(oldMeta, newMeta, [ROOT_A], new Set()), []);
});

test('a root already in missingRoots (existsSync failed) is skipped -- it is already protected', () => {
  const oldMeta = { a1: entry('a1', ROOT_A) };
  assert.deepEqual(detectVanishedRoots(oldMeta, {}, [ROOT_A], new Set([ROOT_A])), []);
});

test('a root with NO prior items never fires (a brand-new empty folder is not a vanish)', () => {
  assert.deepEqual(detectVanishedRoots({}, {}, [ROOT_A], new Set()), []);
});

test('per-root independence: one vanished root is detected while a healthy sibling root is untouched', () => {
  const oldMeta = {
    a1: entry('a1', ROOT_A),
    b1: entry('b1', ROOT_B),
    b2: entry('b2', ROOT_B),
  };
  const newMeta = { b1: entry('b1', ROOT_B), b2: entry('b2', ROOT_B) };
  assert.deepEqual(detectVanishedRoots(oldMeta, newMeta, [ROOT_A, ROOT_B], new Set()), [ROOT_A]);
});

test('legacy entries without rootFolder are attributed via matchRootFolder (same attribution as selectPrunableIds)', () => {
  const oldMeta = {
    a1: { id: 'a1', filePath: `${ROOT_A}/old-school.mp4` }, // no rootFolder field at all
  };
  assert.deepEqual(detectVanishedRoots(oldMeta, {}, [ROOT_A], new Set()), [ROOT_A]);
});

test('an entry unattributable to any configured folder contributes to no root (never a crash, never a phantom vanish)', () => {
  const oldMeta = { x: { id: 'x', filePath: '/somewhere/else/file.mp4' } };
  assert.deepEqual(detectVanishedRoots(oldMeta, {}, [ROOT_A], new Set()), []);
});

test('degenerate inputs (null maps, array-less folders) degrade to empty, never throw', () => {
  assert.deepEqual(detectVanishedRoots(null, null, null, null), []);
  assert.deepEqual(detectVanishedRoots(undefined, undefined, [ROOT_A], undefined), []);
});
