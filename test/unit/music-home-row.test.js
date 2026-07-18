'use strict';

// [UNIT] v1.44 T11 — the "Continue listening" home-row builders + the toggle
// decision (main.js). Pure/DOM-free (the buildBooksHomeSectionHtml posture).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));

const { test } = require('node:test');
const assert = require('node:assert');
const main = require('../../public/js/main.js');

test('T11: buildMusicHomeSectionHtml renders a titled row of album-art cards; empty -> empty string', () => {
  assert.equal(main.buildMusicHomeSectionHtml([], 'Continue listening', '/music'), '', 'music-less home stays byte-identical');
  const html = main.buildMusicHomeSectionHtml(
    [{ id: 't1', title: 'Mother', artist: 'Pink <Floyd>' }],
    'Continue listening',
    '/music',
  );
  assert.match(html, /Continue listening/);
  assert.match(html, /music-home-row/);
  assert.match(html, /\/albumart\/t1/);
  assert.match(html, /href="\/music"/, 'See all + cards link to /music');
  assert.match(html, /Pink &lt;Floyd&gt;/, 'artist escaped');
});

test('T11: buildMusicRowCardHtml escapes title + carries the album art', () => {
  const html = main.buildMusicRowCardHtml({ id: 'a"b', title: 'S "1"', artist: 'A' });
  assert.match(html, /S &quot;1&quot;/);
  assert.match(html, /albumart\/a%22b/);
});

test('T11 (gate note): the Continue-listening CARD deep-links /music?play=<id> so the resume pointer is consumed', () => {
  const html = main.buildMusicRowCardHtml({ id: 'trk9', title: 'Song', artist: 'A' });
  assert.match(html, /href="\/music\?play=trk9"/, 'the card resumes the specific track, not the generic /music');
});

test('T11: homeRowEnabled defaults ON; only an explicit "0" disables', () => {
  const store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  try {
    assert.equal(main.homeRowEnabled('ft-home-continue-listening'), true, 'unset -> ON');
    store['ft-home-continue-listening'] = '0';
    assert.equal(main.homeRowEnabled('ft-home-continue-listening'), false, '"0" -> OFF');
    store['ft-home-continue-listening'] = '1';
    assert.equal(main.homeRowEnabled('ft-home-continue-listening'), true, 'anything else -> ON');
  } finally {
    delete global.localStorage;
  }
});
