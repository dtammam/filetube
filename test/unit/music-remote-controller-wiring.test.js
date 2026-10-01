'use strict';

// [UNIT] v1.348 Listen Control, the phone's wiring in the music view and the skin engine. Binds:
// every skin renderer wears the "on <device>" badge (the inert-sibling class: one test renders EVERY
// skin), the Speakers row exists only on request, the one play seam short-circuits before anything
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

test('the main menu offers Speakers only when asked, between Shuffle Songs and Now Playing', () => {
  const labels = (o) => SK.menuStaticItems({ type: 'main' }, o).map((r) => r.label);
  assert.ok(!labels({ hasCurrent: true }).includes('Speakers'));
  const l = labels({ hasCurrent: true, hasPlayOn: true });
  assert.ok(l.indexOf('Speakers') === l.indexOf('Shuffle Songs') + 1);
  assert.ok(l.indexOf('Now Playing') > l.indexOf('Speakers'));
  assert.deepStrictEqual(SK.menuStaticItems({ type: 'playon' }, {}), null, 'its rows come from the view (cfg.load)');
  assert.strictEqual(SK.menuTitle({ type: 'playon' }), 'Speakers');
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

test('the badge tap and Speakers pick reach the view: pocket menu where there is one, else end remote control', () => {
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

test('v1.350: the user-visible name is Speakers everywhere, the Account note included (types and ids unchanged)', () => {
  const setupHtml = read('public/setup.html');
  const setupJs = read('public/js/setup.js');
  assert.match(setupHtml, /id="device-name-note">Only this browser\. Shown in Speakers and when this device controls another\./);
  assert.match(setupJs, /'Only this browser\. Shown in Speakers and when this device controls another\. Leave blank to use '/);
  for (const [name, src] of [['setup.html', setupHtml], ['setup.js', setupJs], ['music-skins.js', read('public/js/music-skins.js')], ['skin-surface.js', SURFACE], ['music.js', MUSIC]]) {
    assert.ok(!/Play on\.\.\./.test(src), name + ' never says "Play on..." again');
  }
  assert.strictEqual(SK.menuStaticItems({ type: 'main' }, { hasPlayOn: true }).find((r) => r.node && r.node.type === 'playon').label, 'Speakers');
});

test('v1.352 W0: the phone says to click the PC when it is blocked OR has had no click yet, on Now Playing and the Speakers row', () => {
  const M = require('../../public/js/music.js');
  assert.strictEqual(M.REMOTE_CLICK_HINT, "Click the PC's tab once to let it play");
  assert.strictEqual(M.remoteNeedsClick({ state: 'blocked' }), true);
  assert.strictEqual(M.remoteNeedsClick({ state: 'idle', needsClick: true }), true, 'before any song');
  assert.strictEqual(M.remoteNeedsClick({ state: 'playing', needsClick: false }), false);
  assert.strictEqual(M.remoteNeedsClick({ state: 'paused', needsClick: 'true' }), false, 'only a real true');
  assert.strictEqual(M.remoteNeedsClick(null), false);
  assert.strictEqual(M.remoteNeedsClick({ state: 'playing', needsClick: true }), false, 'gate r1: never while it plays (a kiosk that plays unclicked)');
  // the two surfaces use it (the wire, not just the decision)
  const ctx = MUSIC.slice(MUSIC.indexOf('function remoteSkinCtx() {'), MUSIC.indexOf('function remotePlayAt('));
  assert.match(ctx, /artist: remoteNeedsClick\(st\) \? REMOTE_CLICK_HINT :/);
  const rows = MUSIC.slice(MUSIC.indexOf('function playOnItems() {'), MUSIC.indexOf('function remoteChoose('));
  assert.match(rows, /detail: remoteNeedsClick\(t\.state\) \? REMOTE_CLICK_HINT :/);
});

test('v1.352 (Dean): the Music view registers its chapter reader with the target, clears it on teardown, and pings on every chapter rollover', () => {
  assert.match(MUSIC, /REMOTE\.setNowPlayingResolver\(function \(\) \{ return chapterViewId; \}\);/);
  assert.match(MUSIC, /signal\.addEventListener\('abort', function \(\) \{\s*REMOTE\.setMusicPlayHandler\(null\);\s*if \(typeof REMOTE\.setNowPlayingResolver === 'function'\) REMOTE\.setNowPlayingResolver\(null\);/);
  const rc = MUSIC.slice(MUSIC.indexOf('function reflectChapter() {'), MUSIC.indexOf('var lastLoopTime = -1;'));
  const roll = rc.indexOf('chapterViewId = id;');
  const ping = rc.indexOf('remoteTarget.trackChanged()');
  assert.ok(roll > 0 && ping > roll, 'the ping comes after the chapter on screen changed');
});

test('v1.353 the Speakers menu offers Volume only while this device controls a speaker that reported a level', () => {
  const rows = MUSIC.slice(MUSIC.indexOf('function playOnItems() {'), MUSIC.indexOf('function remoteChoose('));
  assert.match(rows, /if \(RC\.isRemote\(\) && remoteVolume\(\) !== null\) items\.push\(\{ label: 'Volume', action: 'volume' \}\);/);
  const vol = MUSIC.slice(MUSIC.indexOf('function remoteVolume() {'), MUSIC.indexOf('function remoteSkinCtx() {'));
  assert.match(vol, /typeof st\.volume === 'number' && isFinite\(st\.volume\)\) \? st\.volume : null/, 'an unreported volume is null');
});

test('v1.353 the view hands the engine the speaker volume: offered only while remote and not stepped aside; set sends RC.volume', () => {
  assert.match(MUSIC, /volume: \{\s*available: function \(\) \{ return remoteOn\(\) && !remoteDocked; \},\s*level: remoteVolume,\s*set: function \(v\) \{ if \(remoteOn\(\)\) RC\.volume\(v\); \},\s*\},/);
  const ctx = MUSIC.slice(MUSIC.indexOf('function remoteSkinCtx() {'), MUSIC.indexOf('function remotePlayAt('));
  assert.match(ctx, /volume: remoteVolume\(\),/, 'the remote ctx carries it (the renderers draw the bar from it)');
  const local = MUSIC.slice(MUSIC.indexOf('function buildSkinCtx(ci, popout) {'), MUSIC.indexOf('var SkinSurface ='));
  assert.ok(!/volume:/.test(local), 'the LOCAL ctx never carries a volume (no bar on local play)');
  assert.match(MUSIC, /remoteVolume\(\) === null \? 'nv' : 'v'\]\.join\('\|'\)/, 'a first volume report repaints');
});
