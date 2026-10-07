'use strict';

// [INTEGRATION] v1.372.0 "Show music in the home feed" (plan docs/exec-plans/active/2026-10-07-v1372-song-names-feed.md,
// R3, R5, R6). Dean: "if I download 20 songs and they are Audio from YouTube I have the option to not see them in the main
// feed. Even the Audio feed." The switch is the user's SYNCED pref `ft-home-music`, written through the real
// POST /api/prefs, read by the server on every home surface:
//   FORWARD: off ('0') - an audio item leaves the classic home (/api/videos, no filter), the row feed (/api/home) and the
//     modern grid (/api/home?view=grid), its Audio chip included; a video stays.
//   INVERSE: absent / on / '' - today's feed, music included; and with it off, opening the folder and search still find it.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-home-music-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, userStore, __resetDatabaseForTests } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});
beforeEach(async () => { await __resetDatabaseForTests(); });

const NOW = Date.now();
function item(id, over = {}) {
  return {
    id, title: `Title ${id}`, filePath: `/media/Chan/${id}.mp4`, folderName: 'Chan',
    channelName: 'Chan', type: 'video', ext: '.mp4', duration: 100, size: 1000, addedAt: NOW, ...over,
  };
}
const SONG = (id) => item(id, { type: 'audio', ext: '.mp3', filePath: `/media/Chan/${id}.mp3` });
// a Music-library track (not a media item), in progress so the row feed's mixed rows can use it (lib/media/routes.js)
const TRACK = 'trk0000001';
function seed() {
  seedState({
    folders: [], folderSettings: {}, metadata: { vid: item('vid'), song: SONG('song') }, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
    music: { tracks: { [TRACK]: { id: TRACK, title: 'Library Song', artist: 'A', album: 'B', filePath: '/music/A/B/s.mp3', rootFolder: '/music', ext: '.mp3', addedAt: new Date(NOW).toISOString() } } },
  });
  userStore.setMusicProgress(auth.user.id, TRACK, { position: 30, duration: 100, updatedAt: new Date(NOW).toISOString() });
  userStore.setProgress && userStore.setProgress(auth.user.id, 'song', { timestamp: 30, duration: 100, updatedAt: new Date(NOW).toISOString() });
}
let stamp = NOW;
async function setPref(value) {
  stamp += 1000;
  const res = await fetch(`${base}/api/prefs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: [{ key: 'ft-home-music', value, updatedAt: stamp }] }),
  });
  assert.ok(res.status < 300, `prefs write ${res.status}`);
}
const ids = (body) => (body.items || []).map((i) => i.id).sort();
const grid = async (filter) => (await fetch(`${base}/api/home?view=grid&filter=${filter}&limit=100`)).json();
// the HOME page's own request carries home=1 (main.js buildVideosApiUrl isBareHome); the watch page's Related rail
// (watch.js) and Roku ask /api/videos without it
const classic = async (q = '') => (await fetch(`${base}/api/videos?limit=100&home=1${q}`)).json();
const related = async () => (await fetch(`${base}/api/videos?limit=100000`)).json();
const rowsText = async () => JSON.stringify(await (await fetch(`${base}/api/home`)).json());

test('absent (today): music is in every home surface', async () => {
  seed();
  assert.deepStrictEqual(ids(await grid('all')), ['song', 'vid']);
  assert.deepStrictEqual(ids(await grid('audio')), ['song']);
  assert.deepStrictEqual(ids(await classic()), ['song', 'vid']);
  const rows = await rowsText();
  assert.ok(rows.includes('"song"'), 'the row feed has it (anti-vacuity for the OFF test)');
  assert.ok(rows.includes(TRACK), 'and the Music-library track (anti-vacuity)');
});

test('off: music leaves the classic home, the row feed, the modern grid and its Audio chip; the video stays', async () => {
  seed();
  await setPref('0');
  assert.deepStrictEqual(ids(await grid('all')), ['vid']);
  assert.strictEqual((await grid('all')).total, 1, 'the total follows (pagination)');
  assert.deepStrictEqual(ids(await grid('audio')), [], 'even the Audio feed (Dean)');
  assert.deepStrictEqual(ids(await classic()), ['vid']);
  const rows = await rowsText();
  assert.ok(!rows.includes('"song"'), 'the row feed leaves it out');
  assert.ok(!rows.includes(TRACK), 'a Music-library song too (gate r1 adversary W2)');
  assert.ok(rows.includes('"vid"'));
});

test('off: NOT the watch page\'s Related rail, Roku or prev/next (they ask /api/videos without home=1) - Dean\'s ruling', async () => {
  seed();
  await setPref('0');
  assert.deepStrictEqual(ids(await related()), ['song', 'vid']);
  assert.deepStrictEqual(ids(await (await fetch(`${base}/api/videos?sort=newest&limit=100`)).json()), ['song', 'vid'], 'the Roku shape');
});

test('off: opening the folder and search still find the music (only the home feed is pruned)', async () => {
  seed();
  await setPref('0');
  assert.deepStrictEqual(ids(await classic('&folder=Chan')), ['song', 'vid']);
  assert.ok(ids(await classic('&search=song')).includes('song'));
});

test('back on (the switch\'s on writes an empty value, any other value is on too): music returns', async () => {
  seed();
  await setPref('0');
  assert.deepStrictEqual(ids(await grid('all')), ['vid']);
  await setPref('');
  assert.deepStrictEqual(ids(await grid('all')), ['song', 'vid']);
  await setPref('1');
  assert.deepStrictEqual(ids(await classic()), ['song', 'vid']);
});

test('Settings: the switch is wired BOTH ways (persist + reflect-on-load, the v1.193 lesson) on the synced key, default on', () => {
  const strip = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const setupJs = strip(fs.readFileSync(path.join(__dirname, '../../public/js/setup.js'), 'utf8'));
  assert.match(setupJs, /wireHomeRowToggle\('home-music-check', 'ft-home-music', signal\);/, 'the PERSIST half (off writes "0", on removes it -> the server sees "")');
  assert.match(setupJs, /loadHomeRowControl\('home-music-check', 'ft-home-music'\);/, 'the REFLECT-ON-LOAD half');
  const html = fs.readFileSync(path.join(__dirname, '../../public/setup.html'), 'utf8');
  assert.match(html, /<label class="ui-row__title" for="home-music-check">Show music in the home feed \(off: songs stay in Music\)<\/label>/);
  assert.match(html, /<input type="checkbox" role="switch" class="ui-switch" id="home-music-check" checked \/>/, 'the kit switch, on by default (today\'s feed)');
});

test('Settings: a change pushes the pref at once and forgets the cached home page (gate r1: adversary W1, qa W2)', () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><body><input type="checkbox" id="home-music-check" checked></body>');
  const calls = [];
  const priorWin = global.window; const priorDoc = global.document;
  global.window = dom.window; global.document = dom.window.document;
  try {
    dom.window.__ftPrefsSync = { flush: () => calls.push('flush') };
    dom.window.FileTube = { forgetHomeView: () => calls.push('forget') };
    delete require.cache[require.resolve('../../public/js/setup.js')];
    const setup = require('../../public/js/setup.js');
    setup.wireHomeMusicApply(new dom.window.AbortController().signal);
    const box = dom.window.document.getElementById('home-music-check');
    box.checked = false;
    box.dispatchEvent(new dom.window.Event('change'));
    assert.deepStrictEqual(calls, ['flush', 'forget']);
  } finally {
    global.window = priorWin; global.document = priorDoc;
  }
  const common = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
  assert.match(common, /window\.FileTube\.forgetHomeView = forgetHomeView;/, 'the router exposes the drop');
  assert.match(common, /function forgetHomeView\(\) \{\s+if \(!homeViewCache\) return;\s+const staleHome = viewRegistry\.home;\s+if \(staleHome && typeof staleHome\.destroy === 'function'\) \{\s+try \{ staleHome\.destroy\(\); \} catch \(err\) \{[^\n]*\}\s+\}\s+homeViewCache = null;\s+\}/, 'it destroys the cached instance (its listeners), then forgets it');
  const sync = fs.readFileSync(path.join(__dirname, '../../public/js/prefs-sync.js'), 'utf8');
  assert.match(sync, /keepalive: true,/, 'a reload right after a change keeps the POST');
});

test('the HOME page sends home=1 (its grid and its Continue watching row), nothing else does (the Related rail, Roku)', () => {
  const strip = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const main = strip(fs.readFileSync(path.join(__dirname, '../../public/js/main.js'), 'utf8'));
  assert.match(main, /const isBareHome = !searchQuery && !folderFilter && !rootFilter && !likedFilter && !watchLaterFilter && !subsFilter;/);
  assert.match(main, /if \(isBareHome\) queryParams\.push\('home=1'\);/, 'the home grid, only on the bare home view');
  assert.match(main, /fetch\(`\/api\/videos\?filter=recent-watching&limit=\$\{HOME_ROW_CAP\}&home=1`\)/, 'the Continue watching row');
  const watch = fs.readFileSync(path.join(__dirname, '../../public/js/watch.js'), 'utf8');
  assert.ok(!/home=1/.test(watch), 'the watch page (Related rail, prev/next) never asks as the home page');
});

test('a pref that cannot be read hides nothing (fails OPEN to today\'s feed)', async () => {
  seed();
  await setPref('0');
  const real = userStore.getPrefs;
  userStore.getPrefs = () => { throw new Error('store busy'); };
  try {
    assert.deepStrictEqual(ids(await grid('all')), ['song', 'vid']);
  } finally { userStore.getPrefs = real; }
});
