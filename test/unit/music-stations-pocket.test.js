'use strict';

// [UNIT] v1.378.0 music stations W4 (plan docs/exec-plans/active/2026-10-09-music-stations.md, D11, D12): the
// Pocket Radio row (the main menu, right after Music), the "Radio: <name>" line on EVERY skin (one writer,
// the inert-sibling class: the test renders every registered skin), the remote channel carrying a station
// (the phone's play command, the speaker's report, the phone's mirror) and the desktop panel's context line.

const { test } = require('node:test');
const assert = require('node:assert');
const SK = require('../../public/js/music-skins.js');
const R = require('../../public/js/remote.js');
const fs = require('node:fs');
const path = require('node:path');

const CTX = {
  track: { title: 'Song', artist: 'Band', album: 'Rec', artUrl: '' }, artistTap: false, artistTitle: '',
  upNext: [], fullList: [], playing: true, posSec: 5, durSec: 100, posLabel: '0:05', remLabel: '-1:35', curNum: 1, total: 1,
};
const HOSTILE = '<b>Reggae</b> & "Dub"';

test('D11: the main menu has Radio right after Music, with and without the optional rows; its title is Radio; its rows come from the view', () => {
  const labels = (o) => SK.menuStaticItems({ type: 'main' }, o).map((r) => r.label);
  assert.deepStrictEqual(labels({}), ['Music', 'Radio', 'Settings', 'Shuffle Songs']);
  const full = labels({ hasGames: true, hasSkins: true, hasPlayOn: true, hasCurrent: true });
  assert.deepStrictEqual(full, ['Music', 'Radio', 'Extras', 'Settings', 'Shuffle Songs', 'Speakers', 'Now Playing']);
  assert.deepStrictEqual(SK.menuStaticItems({ type: 'main' }, {}).find((r) => r.label === 'Radio').node, { type: 'radio' });
  assert.strictEqual(SK.menuStaticItems({ type: 'radio' }, {}), null, 'a level the view loads (GET /api/music/stations)');
  assert.strictEqual(SK.menuTitle({ type: 'radio' }), 'Radio');
  // the smallest skins' LCD list scrolls: a 7-row main menu is windowed, never squeezed (menuWindow holds the cursor)
  const w = SK.menuWindow(7, 6, 0, 0, 0, 0);
  assert.ok(w.start <= 6 && w.end >= 7, 'the last row (Now Playing) stays reachable: ' + JSON.stringify(w));
});

test('D11 / D12: every skin shows "Radio: <name>" while a station plays, escaped, and nothing of it otherwise', () => {
  assert.ok(SK.IDS.length > 10, 'the real skin list');
  for (const id of SK.IDS) {
    const on = SK.renderFull(id, Object.assign({}, CTX, { radio: { name: HOSTILE } }));
    assert.ok(on.indexOf('Radio: &lt;b&gt;Reggae&lt;/b&gt; &amp; &quot;Dub&quot;') !== -1, id + ' shows the station line, escaped');
    assert.ok(on.indexOf('<b>Reggae</b>') === -1, id + ' never renders the name as markup');
    const off = SK.renderFull(id, CTX);
    assert.ok(off.indexOf('Radio:') === -1, id + ' has no station line without a station');
    const blank = SK.renderFull(id, Object.assign({}, CTX, { radio: { name: '   ' } }));
    assert.ok(blank.indexOf('Radio:') === -1, id + ': a blank name is no station');
  }
  // Nordic: the context line is the station instead of the album; the Click LCD: the album slot
  assert.ok(/mms-ctx mms-radio">Radio: Chill</.test(SK.renderFull('spotify', Object.assign({}, CTX, { radio: { name: 'Chill' } }))));
  assert.ok(/Playing from Rec/.test(SK.renderFull('spotify', CTX)));
  assert.ok(/ip-album ip-radio">Radio: Chill</.test(SK.renderFull('ipod', Object.assign({}, CTX, { radio: { name: 'Chill' } }))));
  assert.ok(/ip-album">Rec</.test(SK.renderFull('ipod', CTX)));
  assert.ok(/mms-ctx mms-radio">Radio: Chill</.test(SK.renderFull('apple', Object.assign({}, CTX, { radio: { name: 'Chill' } }))));
});

test('D12: the speaker\'s report carries the station only while a song plays; a name is trimmed and bounded', () => {
  const snap = { id: 't1', position: 1, duration: 100, playing: true };
  assert.deepStrictEqual(R.buildStatePayload('pc', snap, false, false, null, { name: '  Chill ' }).radio, { name: 'Chill' });
  assert.strictEqual(R.buildStatePayload('pc', snap, false, false, null, null).radio, null);
  assert.strictEqual(R.buildStatePayload('pc', snap, false, false, null, { name: '' }).radio, null);
  assert.strictEqual(R.buildStatePayload('pc', { id: null }, false, false, null, { name: 'Chill' }).radio, null, 'idle: no station');
  assert.strictEqual(R.buildStatePayload('pc', snap, false, false, null, { name: 'x'.repeat(80) }).radio.name.length, 60);
});

test('D11 / D12 wiring (source): the speaker reader reports the station, the handler plays a sent station as a station with Autoplay on, the phone sends the station with its play command, the mirror reads it', () => {
  const MUSIC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'music.js'), 'utf8');
  assert.match(MUSIC, /REMOTE\.setQueueReader\(function \(\) \{ var ci = currentSkinIndex\(\); return ci >= 0 && ci < queue\.length \? \{ list: queue, index: ci, radio: stationRadioName\(\) \? \{ name: stationRadioName\(\) \} : null \} : null; \}\);/);
  const handler = MUSIC.slice(MUSIC.indexOf('var remotePlay = function (req) {'), MUSIC.indexOf('REMOTE.setMusicPlayHandler(remotePlay);'));
  assert.match(handler, /req\.radio\.seed\.indexOf\('station:'\) === 0/, 'a station seed only');
  assert.match(handler, /play\.ctx = \{ src: 'music', radio: radio\.seed \};/);
  assert.match(handler, /play\.ctx\.radioName = radio\.name\.trim\(\)\.slice\(0, 60\);/);
  assert.match(handler, /if \(!autoplayEnabled\(\)\) \{ setAutoplayEnabled\(true\); reflectPlaybackModes\(\); \}/);
  assert.match(handler, /markAutoplayPicks\(Array\.isArray\(req\.tracks\) \? req\.tracks\.slice\(1\) : \[\]\);/);
  const remotePlayAt = MUSIC.slice(MUSIC.indexOf('function remotePlayAt(i) {'), MUSIC.indexOf('function playOnItems() {'));
  assert.match(remotePlayAt, /RC\.play\(ids, idx, rseed \? \{ seed: rseed, name: stationRadioName\(\) \} : null\);/);
  const mirror = MUSIC.slice(MUSIC.indexOf('function remoteSkinCtx() {'), MUSIC.indexOf('function remotePlayAt('));
  assert.match(mirror, /radio: \(st\.radio && typeof st\.radio\.name === 'string' && st\.radio\.name\) \? \{ name: st\.radio\.name \} : null/);
  const level = MUSIC.slice(MUSIC.indexOf('function menuRadioLevel() {'), MUSIC.indexOf('function withRadioRow('));
  assert.match(level, /fetchJson\('\/api\/music\/stations'\)/);
  assert.match(level, /if \(!st \|\| !st\.key \|\| st\.hidden\) continue;/, 'hidden stations are left out (D8)');
  assert.match(level, /action: 'radio', seed: 'station:' \+ st\.key, stationName: st\.name/);
  assert.match(MUSIC, /onStartRadio: function \(seed, name\) \{ startRadio\(seed, null, name\); \}/);
  const SURFACE = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'skin-surface.js'), 'utf8');
  assert.match(SURFACE, /cfg\.onStartRadio\(it\.seed, it\.stationName\)/);
});

test('D10: the desktop panel\'s context line (skin-surface buildPanelHtml) shows the station, escaped, only when given', () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<body></body>');
  const saved = { window: global.window, document: global.document };
  global.window = dom.window; global.document = dom.window.document;
  try {
    delete require.cache[require.resolve('../../public/js/skin-surface.js')];
    require('../../public/js/skin-surface.js');
    const S = dom.window.FileTubeSkinSurface;
    const html = S.buildPanelHtml({ title: 'Song', subline: 'Band', context: 'Radio: ' + HOSTILE }, []);
    assert.ok(html.indexOf('<div class="mnp-ctx">Radio: &lt;b&gt;Reggae&lt;/b&gt; &amp; &quot;Dub&quot;</div>') !== -1, html.slice(0, 200));
    assert.ok(S.buildPanelHtml({ title: 'Song', subline: 'Band' }, []).indexOf('mnp-ctx') === -1);
  } finally { delete require.cache[require.resolve('../../public/js/skin-surface.js')]; Object.assign(global, saved); }
});
