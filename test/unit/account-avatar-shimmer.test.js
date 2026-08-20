'use strict';

// [UNIT] v1.157.1 (Dean device report): the "You" button avatar photo used to
// paint an EMPTY disc until it loaded+decoded ("empty then fills"). Now the disc
// carries `.skeleton-shimmer` while the <img> loads, and the photo reveals only
// once its `load` fires (CSS keeps `.account-avatar img` opacity:0 until
// `.is-loaded`). On a load error the photo is dropped and the initials monogram
// is painted so the disc is NEVER left blank.
//
// jsdom cannot decode a real image, but it dispatches the synthetic load/error
// Events our once-listeners key on - which is exactly the reveal/fallback wiring
// under test. Four axes: (1) the placeholder shimmer + hidden photo, (2) the
// happy reveal, (3) the error fallback to a monogram, (4) the no-photo monogram.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const COMMON = require.resolve('../../public/js/common.js');

function loadCommon() {
  delete global.document; delete global.window;
  delete require.cache[COMMON];
  const c = require(COMMON); // boot is skipped (no document at require time)
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  return { c, dom };
}

const PHOTO_USER = { id: 'u1', displayName: 'Ada Lovelace', avatar: { present: true, version: 7 } };
const NO_PHOTO_USER = { id: 'u2', displayName: 'Grace Hopper', avatar: { present: false } };

test('a present photo: the disc shimmers as a placeholder and the hidden <img> points at the versioned avatar URL', () => {
  const { c, dom } = loadCommon();
  const el = c.buildAccountAvatarEl(PHOTO_USER, false);
  assert.ok(el.classList.contains('account-avatar'), 'the disc is an .account-avatar');
  assert.ok(el.classList.contains('skeleton-shimmer'),
    'the disc shimmers while the photo loads (no empty box on first paint)');
  const img = el.querySelector('img');
  assert.ok(img, 'the photo <img> is present');
  assert.ok(!img.classList.contains('is-loaded'),
    'the photo is NOT yet revealed (CSS holds it at opacity:0 until .is-loaded)');
  assert.match(img.getAttribute('src'), /\/api\/users\/u1\/avatar\?v=7$/,
    'the src is the cache-busted per-user avatar endpoint');
  dom.window.close();
});

test('on load: the shimmer clears and the photo is revealed (.is-loaded)', () => {
  const { c, dom } = loadCommon();
  const el = c.buildAccountAvatarEl(PHOTO_USER, false);
  const img = el.querySelector('img');
  img.dispatchEvent(new dom.window.Event('load'));
  assert.ok(!el.classList.contains('skeleton-shimmer'), 'the placeholder shimmer is removed once loaded');
  assert.ok(img.classList.contains('is-loaded'), 'the photo is revealed (opacity:1) once loaded');
  dom.window.close();
});

test('on error: the photo is dropped and the monogram is painted so the disc is never blank', () => {
  const { c, dom } = loadCommon();
  const el = c.buildAccountAvatarEl(PHOTO_USER, false);
  const img = el.querySelector('img');
  img.dispatchEvent(new dom.window.Event('error'));
  assert.ok(!el.classList.contains('skeleton-shimmer'), 'the shimmer is cleared on error (no stranded shimmer)');
  assert.strictEqual(el.querySelector('img'), null, 'the failed photo <img> is removed');
  assert.ok(el.textContent && el.textContent.length > 0, 'a monogram glyph is painted as the fallback');
  assert.ok(el.style.backgroundColor, 'the monogram disc gets its deterministic palette colour');
  dom.window.close();
});

test('no photo: the monogram is painted with no shimmer (unchanged behaviour)', () => {
  const { c, dom } = loadCommon();
  const el = c.buildAccountAvatarEl(NO_PHOTO_USER, false);
  assert.ok(!el.classList.contains('skeleton-shimmer'), 'no shimmer when there is no photo to wait on');
  assert.strictEqual(el.querySelector('img'), null, 'no <img> for a monogram avatar');
  assert.ok(el.textContent && el.textContent.length > 0, 'the monogram glyph is painted');
  dom.window.close();
});
