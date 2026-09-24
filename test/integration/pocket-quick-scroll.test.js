'use strict';

// [INTEGRATION] POCKET QUICK SCROLL, Recent Artists, Extras > Games > Brick and Settings > About
// (Dean 2026-09-24) through the REAL data shape: a real server (isolated DATA_DIR) seeded with
// projected library audio, the REAL music.js view + skin engine in jsdom (every fetch goes to that
// server), real progress saves on the route the player itself writes (Recently Played's source),
// a real per-user restriction, the real Brick wiring (ipod-brick.js) and the real version source
// (the server-stamped <meta name="ft-version"> read by common.js appVersionString). No hand-typed
// ids: every id a test plays is one the server returned.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-quickscroll-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, userStore, __mintTestSession } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { createPocketHarness } = require('../helpers/pocket-menu-harness');
const skins = require('../../public/js/music-skins.js');

// the account menu's own version source, loaded BEFORE any jsdom window exists (it reads the
// global document at CALL time - the harness points that at the view's jsdom document)
const { appVersionString } = require('../../public/js/common.js');
const BRICK = require.resolve('../../public/js/ipod-brick.js');

let server, base, auth, patchedFetch, member, memberFetch;
const ROOT = path.join(DATA_DIR, 'ytdlp');

function audioItem(id, folderName, artistName, tags, extra) {
  return Object.assign({
    id, type: 'audio', title: (tags && tags.title) || id, name: `${id}.mp3`,
    filePath: path.join(ROOT, folderName, `${id}.mp3`), rootFolder: ROOT, folderName, channelName: artistName,
    duration: 200, hasThumbnail: true, ext: '.mp3', addedAt: 1788000000000,
    tags: Object.assign({ artist: artistName }, tags || {}),
  }, extra || {});
}
// 60 titles over most of the alphabet (no Q, no X), some digits, an accent - a list long enough
// (>= 20) for letter mode; three artists in three folders.
const WORDS = ['Amber', 'Arcade', 'Bloom', 'Breeze', 'Cascade', 'Circuit', 'Drift', 'Dune', 'Echo', 'Élan', 'Ember', 'Flux', 'Frost',
  'Glow', 'Grid', 'Halo', 'Haze', 'Ion', 'Iris', 'Jade', 'Jolt', 'Kite', 'Koi', 'Lumen', 'Lynx', 'Mirage', 'Moss', 'Neon', 'Nova',
  'Orbit', 'Onyx', 'Pulse', 'Prism', 'Rain', 'Ripple', 'Solar', 'Static', 'Tide', 'Tonic', 'Umbra', 'Unity', 'Vapor', 'Velvet',
  'Wave', 'Wisp', 'Yonder', 'Yield', 'Zenith', 'Zest', '1999', '2 Moons', '8-Bit Love', 'Aurora', 'Beacon', 'Comet', 'Delta', 'Eclipse', 'Fable', 'Glint', 'Harbor'];
const ARTISTS = [['Tonzak', 'tonzak'], ['NESTALGIA', 'nestalgiamusic'], ['Zarchivo', 'zarchivo']];

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  patchedFetch = global.fetch;
  seedState({ folders: [ROOT], folderSettings: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await updateDatabase((db) => {
    db.metadata = {};
    WORDS.forEach((w, i) => {
      const [artist, folder] = ARTISTS[i % 3];
      const id = 'q' + String(i).padStart(2, '0');
      db.metadata[id] = audioItem(id, folder, artist, { title: w, album: artist + ' Album', track: String(i + 1), genre: 'Music' }, { addedAt: 1788000000000 + i });
    });
    return true;
  });
  member = __mintTestSession({ username: 'qsmember', role: 'member' });
  memberFetch = (u, o) => patchedFetch(u, Object.assign({}, o, { headers: Object.assign({}, o && o.headers, { Cookie: member.cookie }) }));
});

after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const H = createPocketHarness(() => ({ base, authedFetch: patchedFetch }));
const HM = createPocketHarness(() => ({ base, authedFetch: memberFetch }));
const { menu, select, labels, cursorLabel, title, tapRow, settleNet, spin } = H;
async function realApi(pathname, f) { const r = await (f || patchedFetch)(base + pathname); return r.json(); }
// the player's own progress save for a projected library track (its progressEndpoint)
async function played(id, f, at) {
  const r = await (f || patchedFetch)(base + '/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, timestamp: at || 30, duration: 200 }) });
  assert.strictEqual(r.status, 200, 'progress saved for ' + id);
  await new Promise((r2) => setTimeout(r2, 15)); // distinct updatedAt stamps: the route orders by them
}

test('Recent Artists: from REAL plays (the player\'s progress route), most recent first, duplicates collapsed, and a row drills in EXACTLY like Artists > artist', async () => {
  const songs = (await realApi('/api/music?sort=title-asc&limit=10000')).items;
  const byTitle = (t) => songs.find((s) => s.title === t);
  assert.strictEqual(byTitle('Amber').progressEndpoint, '/api/progress', 'precondition: the player saves this track\'s progress on /api/progress');
  // four plays, oldest first, over three artists (one artist twice - the duplicate to collapse)
  for (const t of ['Amber', 'Arcade', 'Circuit', 'Bloom']) await played(byTitle(t).id);
  const recent = (await realApi('/api/music?filter=recent-listening&limit=200')).items;
  assert.deepStrictEqual(recent.map((r) => r.title), ['Bloom', 'Circuit', 'Arcade', 'Amber'], 'precondition: the route orders by recency');
  await H.boot({ skin: 'ipod', play: byTitle('Amber').id, run: async (h) => {
    menu(h); select(h);
    assert.strictEqual(labels(h)[0], 'Recent Artists', 'the first Music entry');
    tapRow(h, 'Recent Artists'); await settleNet();
    assert.strictEqual(title(h), 'Recent Artists');
    // the expected rows derive from the route's own payload (the grouping key albumArtist || artist)
    const expected = [];
    recent.forEach((r) => { const a = r.albumArtist || r.artist || ''; if (!expected.includes(a)) expected.push(a); });
    assert.deepStrictEqual(labels(h), expected, 'unique artists in recency order (the duplicate collapsed)');
    assert.ok(expected.length < recent.length, 'precondition: a duplicate existed to collapse');
    tapRow(h, expected[0]); await settleNet();
    const viaRecent = { title: title(h), rows: labels(h) };
    // the same artist through Artists
    menu(h); menu(h); tapRow(h, 'Artists'); await settleNet();
    tapRow(h, expected[0]); await settleNet();
    assert.deepStrictEqual({ title: title(h), rows: labels(h) }, viaRecent, 'the drill is identical to Artists > ' + expected[0]);
  } });
});

test('Recent Artists is the SAME visibility-gated route: a restricted member never sees an artist they played before the restriction; no history = the device\'s empty state', async () => {
  // fresh member: no plays yet -> the empty state
  await HM.boot({ skin: 'ipod', play: 'q00', run: async (h) => {
    menu(h); select(h); tapRow(h, 'Recent Artists'); await settleNet();
    assert.strictEqual(h.panel.querySelector('.ipm-note').textContent, 'No recent artists');
  } });
  const songs = (await realApi('/api/music?sort=title-asc&limit=10000', memberFetch)).items;
  const nest = songs.find((s) => s.artist === 'NESTALGIA');
  const tz = songs.find((s) => s.artist === 'Tonzak');
  await played(tz.id, memberFetch);
  await played(nest.id, memberFetch);
  userStore.setRestrictions(member.user.id, [{ kind: 'folder', value: 'nestalgiamusic' }]);
  try {
    const recent = (await realApi('/api/music?filter=recent-listening&limit=200', memberFetch)).items;
    assert.ok(!recent.some((r) => r.artist === 'NESTALGIA'), 'precondition: the route itself gates the restricted plays out');
    await HM.boot({ skin: 'ipod', play: tz.id, run: async (h) => {
      menu(h); select(h); tapRow(h, 'Recent Artists'); await settleNet();
      assert.deepStrictEqual(labels(h), ['Tonzak'], 'the restricted artist is not listed (it played more recently)');
    } });
  } finally { userStore.setRestrictions(member.user.id, []); }
});

test('QUICK SCROLL on the REAL Songs level: a fast spin of the real wheel lands on the first row of a letter (the server\'s own order) and Select plays THAT id', async () => {
  const songs = (await realApi('/api/music?sort=title-asc&limit=10000')).items;
  assert.ok(songs.length >= skins.MENU_LETTER_MIN, 'precondition: long enough for letter mode');
  const runs = skins.menuLetterRuns(songs.map((s) => ({ label: s.title })));
  await H.boot({ skin: 'ipod', play: songs[0].id, run: async (h) => {
    menu(h); select(h); tapRow(h, 'Songs'); await settleNet();
    assert.strictEqual(title(h), 'Songs');
    const degs = []; for (let d = 11.5; d <= 11.5 * 10; d += 11.5) degs.push(d); // 5 detents at 1.44 deg/ms
    spin(h, degs, 8);
    const ov = h.panel.querySelector('.ip-menuview > .ipm-letter');
    assert.ok(ov && ov.classList.contains('is-on'), 'letter mode engaged on the real view\'s list');
    // detent 1 = the x2 step (rows 0 -> 2), detents 2-5 = four letters forward from '#'
    const want = runs[skins.MENU_LETTERS.indexOf('#') >= 0 && runs[0].letter === '#' ? 4 : 3];
    assert.strictEqual(ov.textContent, want.letter);
    assert.strictEqual(cursorLabel(h), songs[want.index].title, 'the first row of that letter, in the server\'s order');
    select(h); await settleNet();
    const last = h.spy.loads[h.spy.loads.length - 1];
    assert.strictEqual(last.id, songs[want.index].id, 'Select played the landed row\'s REAL id');
  } });
});

test('D About: the REAL per-user totals from the library routes and the REAL running version (server meta -> appVersionString); read-only', async () => {
  const shell = await (await patchedFetch(base + '/music')).text();
  const ver = (/<meta\s+name="ft-version"\s+content="([^"]*)"/i.exec(shell) || [])[1];
  assert.ok(ver && /^\d+\.\d+\.\d+/.test(ver), 'precondition: the server stamps its version into the shell');
  const totals = await Promise.all(['/api/music?limit=1', '/api/music/albums?limit=1', '/api/music/artists?limit=1'].map((u) => realApi(u).then((d) => d.total)));
  await H.boot({ skin: 'zune-classic', play: 'q00', setup: (dom) => {
    const m = dom.window.document.createElement('meta'); m.setAttribute('name', 'ft-version'); m.setAttribute('content', ver);
    dom.window.document.head.appendChild(m);
    dom.window.appVersionString = appVersionString; // the account menu's own source
  }, run: async (h) => {
    menu(h);
    assert.deepStrictEqual(labels(h), ['Music', 'Settings', 'Shuffle Songs', 'Now Playing'], 'Seattle: no Games (Brick\'s rule), Settings present');
    tapRow(h, 'Settings'); tapRow(h, 'About'); await settleNet();
    assert.strictEqual(h.panel.querySelector('.ipm-about-name').textContent, 'Seattle');
    const rows = [...h.panel.querySelectorAll('.ipm-info')].map((r) => [r.querySelector('.ipm-lbl').textContent, r.querySelector('.ipm-val').textContent]);
    assert.deepStrictEqual(rows, [['Songs', String(totals[0])], ['Albums', String(totals[1])], ['Artists', String(totals[2])], ['Version', ver], ['Software', 'FileTube']]);
    const loads = h.spy.loads.length; select(h);
    assert.strictEqual(h.spy.loads.length, loads, 'Select on About plays nothing');
  } });
});

test('C Extras > Games > Brick in the REAL music view: the view\'s own Brick hook (ipod-brick.js) mounts the game on the LCD; MENU returns to Games; the view dying stops it', async () => {
  await H.boot({ skin: 'ipod', play: 'q00', setup: (dom) => {
    dom.window.HTMLCanvasElement.prototype.getContext = function () {
      return new Proxy({}, { get(_t, k) { if (k === 'measureText') return () => ({ width: 10 }); return () => {}; }, set() { return true; } });
    };
    // the game's loop runs on its host window's rAF (a real browser has one; this jsdom does not)
    dom.window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
    dom.window.cancelAnimationFrame = (id) => clearTimeout(id);
    delete require.cache[BRICK];
    require(BRICK); // attaches window.FileTubeBrick (the harness has global.window = this jsdom window)
  }, run: async (h) => {
    menu(h);
    assert.deepStrictEqual(labels(h), ['Music', 'Extras', 'Settings', 'Shuffle Songs', 'Now Playing'], 'the view supplies the hook: Extras shows');
    tapRow(h, 'Extras'); tapRow(h, 'Games');
    assert.deepStrictEqual(labels(h), ['Brick']);
    select(h);
    assert.ok(h.panel.querySelector('.ip-lcd-in .ipod-brick canvas'), 'the game is on the LCD');
    menu(h);
    assert.ok(!h.panel.querySelector('.ipod-brick'), 'MENU ended it');
    assert.strictEqual(title(h), 'Games', 'and landed back on Games');
    select(h);
    assert.ok(h.panel.querySelector('.ipod-brick'), 'launched again');
    h.mod.destroy(); // the view dying (nav away): its activeBrickStop bridge
    assert.ok(!h.panel.querySelector('.ipod-brick'), 'the view\'s destroy stopped the game');
    h.mod.init(h.D.getElementById('view-root')); await settleNet(); // the harness destroys once more at the end
  } });
  delete require.cache[BRICK];
});

test('E in the REAL view: the Click Main Menu drifts through covers from the real library (the view\'s pool: art-bearing, same-origin, one per album)', async () => {
  const songs = (await realApi('/api/music?sort=title-asc&limit=10000')).items;
  const pool = skins.menuCoverPool(songs, (id, explicit) => explicit || ('/albumart/' + encodeURIComponent(id)));
  assert.ok(pool.length > 1, 'precondition: the real library has covers');
  await H.boot({ skin: 'ipod', play: 'q00', setup: (dom) => {
    // jsdom reports a hidden document unless told otherwise (the drift runs only while visible)
    Object.defineProperty(dom.window.document, 'hidden', { configurable: true, get: () => false });
  }, run: async (h) => {
    menu(h); await settleNet();
    const sl = h.panel.querySelector('.ip-menuview .ipm-art .ipm-slide');
    assert.ok(sl, 'a cover layer is in the Main Menu pane');
    assert.ok(pool.includes(sl.getAttribute('src')), 'from the real pool: ' + sl.getAttribute('src'));
  } });
});
