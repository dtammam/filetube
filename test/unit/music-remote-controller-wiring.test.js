'use strict';

// [UNIT] v1.348 Listen Control, the phone's wiring in the music view and the skin engine. Binds:
// every skin renderer wears the "on <device>" badge (the inert-sibling class: one test renders EVERY
// skin), the Play on... row exists only on request, the one play seam short-circuits before anything
// loads here, and the local-mode host controls are still the real elements (mutate and watch red).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const SK = require('../../public/js/music-skins.js');

const REPO = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const MUSIC = read('public/js/music.js');
const SURFACE = read('public/js/skin-surface.js');

const CTX = {
  track: { title: 'Song', artist: 'Band', album: 'Rec', artUrl: '' }, artistTap: false, artistTitle: '',
  upNext: [], fullList: [], playing: true, posSec: 5, durSec: 100, posLabel: '0:05', remLabel: '-1:35', curNum: 1, total: 1,
};

test('every skin renders the on-device badge with the label escaped, and none without a remote ctx', () => {
  assert.ok(SK.IDS.length > 10, 'the real skin list is enumerated');
  for (const id of SK.IDS) {
    const on = SK.renderFull(id, Object.assign({}, CTX, { remote: { label: 'Desk <b>' } }));
    assert.match(on, /<span class="mms-remote" role="button" tabindex="0" data-skin-playon[^>]*>on Desk &lt;b&gt;<\/span>/, id + ' wears the badge');
    assert.ok(!on.includes('Desk <b>'), id + ' escapes the label');
    assert.ok(!/mms-remote/.test(SK.renderFull(id, CTX)), id + ' has no badge in local mode');
  }
});

test('the main menu offers Play on... only when asked, between Shuffle Songs and Now Playing', () => {
  const labels = (o) => SK.menuStaticItems({ type: 'main' }, o).map((r) => r.label);
  assert.ok(!labels({ hasCurrent: true }).includes('Play on...'));
  const l = labels({ hasCurrent: true, hasPlayOn: true });
  assert.ok(l.indexOf('Play on...') === l.indexOf('Shuffle Songs') + 1);
  assert.ok(l.indexOf('Now Playing') > l.indexOf('Play on...'));
  assert.deepStrictEqual(SK.menuStaticItems({ type: 'playon' }, {}), null, 'its rows come from the view (cfg.load)');
  assert.strictEqual(SK.menuTitle({ type: 'playon' }), 'Play on...');
});

test('the one play seam: playAt sends to the PC before it asks, verifies or loads anything here', () => {
  const at = MUSIC.indexOf('function playAt(i, opts) {');
  const body = MUSIC.slice(at, MUSIC.indexOf('\n    }\n', at));
  const remote = body.indexOf('if (remoteOn()) { remotePlayAt(i); return; }');
  assert.ok(remote > 0, 'the guard is there');
  for (const later of ['askLightingForOpen()', 'playGen += 1', 'verifyChapterFileThenPlay', 'prewarmThenLoad', 'loadTrack(']) {
    assert.ok(body.indexOf(later) > remote, later + ' comes after the remote guard');
  }
});

test('nothing else in the view can start local playback: one player.load, reached only through loadTrack', () => {
  assert.strictEqual((MUSIC.match(/\bpl\.load\(/g) || []).length, 1, 'a single load call');
  const callers = MUSIC.split('\n').filter((l) => /\bloadTrack\(/.test(l) && !/function loadTrack/.test(l));
  assert.strictEqual(callers.length, 2, 'only playAt and its transcode prewarm');
  const fn = MUSIC.slice(MUSIC.indexOf('function remotePlayAt('), MUSIC.indexOf('function playOnItems('));
  assert.ok(!/\.load\(|loadTrack|playGen/.test(fn), 'the remote path never loads');
  assert.match(fn, /item\.listen/, 'a listen item is refused with a toast, never sent');
});

test('local mode keeps the REAL host controls byte-for-byte; remote swaps only the five transport ids', () => {
  assert.match(MUSIC, /function hostCtl\(id\) \{\s*if \(remoteOn\(\)\) \{ var v = remoteCtl\(id\); if \(v\) return v; \}\s*return document\.getElementById\(id\);\s*\}/);
  const ids = MUSIC.slice(MUSIC.indexOf('remoteCtls = {'), MUSIC.indexOf('return remoteCtls[id]'));
  for (const id of ['media-player', 'pp-btn', 'track-prev-btn', 'track-next-btn', 'seek-bar']) assert.ok(ids.includes("'" + id + "'"), id);
  assert.match(SURFACE, /hostCtl\('pp-btn'\)[\s\S]{0,40}pb\.click\(\)/, 'the engine still presses the control it is handed');
});

test('the badge tap and Play on... pick reach the view: pocket menu where there is one, else end remote control', () => {
  assert.match(SURFACE, /closest\('\[data-skin-playon\]'\)\) \{\s*if \(pocket && pocket\.active\(\) && pocket\.openPlayOn\) pocket\.openPlayOn\(\);\s*else if \(typeof config\.onPlayOnBadge === 'function'\)/);
  assert.match(SURFACE, /it\.action === 'playon'[\s\S]{0,200}cfg\.onPlayOn\(it\.target \|\| null\)/);
  assert.match(MUSIC, /onPlayOn: remoteChoose,/);
  assert.match(MUSIC, /function remoteChoose\(t\) \{[\s\S]{0,200}pl\.pause\(\)[\s\S]{0,120}RC\.select\(t\)/, 'choosing a PC silences this device first');
});

test('a device controlling a PC is never offered the handoff card (D8)', () => {
  const C = require('../../public/js/common.js');
  const presence = { mediaId: 'x', updatedAt: 1 };
  const base = { pathname: '/music' };
  const fn = C.shouldShowHandoffCard;
  assert.strictEqual(typeof fn, 'function');
  assert.strictEqual(fn(presence, Object.assign({}, base, { controllingRemote: true })), false);
  assert.strictEqual(fn(presence, Object.assign({}, base, { controllingRemote: false })), true);
});
