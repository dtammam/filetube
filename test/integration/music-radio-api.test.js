'use strict';

// [INTEGRATION] v1.368.0 music radio (plan docs/exec-plans/completed/2026-10-06-v1368-music-radio.md, W1):
// the station picker (lib/music/radio.js) and GET /api/music/radio, driven through the REAL data
// shape (LESSONS 2): a real server on an isolated DATA_DIR seeded with projected library audio, every
// fixture the picker sees is what GET /api/music actually returns. The library is built so a
// tier-ignoring picker DIVERGES: a big unrelated genre (40 Jazz tracks) that today's
// whole-library draw would mostly pick from, which a station must not touch while closer tiers
// have candidates.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-radio-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, updateDatabase, userStore, __mintTestSession } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const radio = require('../../lib/music/radio');
const { createSeededRng } = require('../../lib/videoQuery');

let server, base, auth, member;
const ROOT = path.join(DATA_DIR, 'ytdlp');
const SECRET_ROOT = path.join(ROOT, 'secret');

function audioItem(id, folderName, artist, genre, date, extra) {
  const tags = { title: id + ' title', artist };
  if (genre) tags.genre = genre;
  if (date) tags.date = date;
  return Object.assign({
    id, type: 'audio', title: id + ' title', name: id + '.mp3',
    filePath: path.join(ROOT, folderName, id + '.mp3'), rootFolder: ROOT, folderName, channelName: artist,
    duration: 200, hasThumbnail: true, ext: '.mp3', addedAt: 1788000000000, tags,
  }, extra || {});
}

// The library (artist, folder, genre, date, count, id prefix):
const GROUPS = [
  ['Seedy', 'seedy', 'Rock', '1990', 6, 'sd'], // T1 for a Seedy seed
  ['Neighbour Band', 'nb', 'Rock', '1993', 6, 'nb'], // T2: same genre, year within 5
  ['Late Rocker', 'late', 'Rock', '2015', 4, 'lr'], // T3: same genre, far year
  ['Crossover', 'cross', 'Blues', '1990', 3, 'cx'], // T4: Blues neighbours Rock through Crossover (below)
  ['Bluesman', 'blues', 'Blues', '1988', 4, 'bm'], // T4
  ['Folder Friend', 'seedy', null, null, 2, 'ff'], // T5: untagged, in the seed's folder
  ['Big Jazz', 'jazz', 'Jazz', '1990', 40, 'jz'], // T7: the big unrelated genre
  // T0 tuning: yt-dlp writes YouTube's CATEGORY as the genre. "Music" on two unrelated channels is
  // not a shared genre: for a Tube A seed, Tube B is T6 (same category); for a Seedy seed both are T7
  ['Tube A', 'tubea', 'Music', '2020', 3, 'ta'],
  ['Tube B', 'tubeb', 'Music', '2020', 8, 'tb'],
];
const FAR_GROUPS = ['jz', 'ta', 'tb'];

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
  seedState({ folders: [ROOT], folderSettings: {}, metadata: {}, liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 } });
  await updateDatabase((db) => {
    db.metadata = {};
    for (const [artist, folder, genre, date, n, prefix] of GROUPS) {
      for (let i = 0; i < n; i += 1) db.metadata[prefix + i] = audioItem(prefix + i, folder, artist, genre, date, prefix === 'bm' ? { tags: { title: prefix + i + ' title', artist, genre, date, album: 'Blue Notes' } } : undefined);
    }
    db.metadata.xr0 = audioItem('xr0', 'cross', 'Crossover', 'Rock', '2016'); // Crossover in Rock too -> Rock~Blues neighbours
    // A member-hidden folder: Rock 1990 by the seed artist, so a leaky picker would rank it T1.
    for (let i = 0; i < 3; i += 1) {
      db.metadata['sec' + i] = Object.assign(audioItem('sec' + i, 'secret', 'Seedy', 'Rock', '1990'), { filePath: path.join(SECRET_ROOT, 'sec' + i + '.mp3') });
    }
    return true;
  });
  member = __mintTestSession({ username: 'radiomember', role: 'member' });
  userStore.setRestrictions(member.user.id, [{ kind: 'path', value: SECRET_ROOT }]);
});

after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

async function api(p, cookie) {
  const r = await fetch(base + p, cookie ? { headers: { Cookie: cookie } } : undefined);
  return { status: r.status, body: await r.json() };
}
const radioUrl = (seed, exclude, extra) => '/api/music/radio?seed=' + encodeURIComponent(seed)
  + (exclude && exclude.length ? '&exclude=' + exclude.map(encodeURIComponent).join(',') : '') + (extra || '');
const group = (id) => id.replace(/\d+$/, '');
// The REAL /api/music shape (admin) - the fixture every pure-picker test runs on.
let realLib = null;
async function lib() {
  if (!realLib) {
    realLib = (await api('/api/music?limit=10000')).body.items;
    assert.strictEqual(realLib.length, 80, 'precondition: the real projection returned the seeded library (' + realLib.length + ')');
    assert.ok(realLib.every((t) => 'genre' in t && 'year' in t && 'folderName' in t && 'artist' in t), 'precondition: the real items carry the fields the picker reads');
  }
  return realLib;
}
const byId = (list, id) => list.find((t) => t.id === id);

// Drive a whole station session through the REAL route, the way the client does: the exclude list
// is every id played so far (oldest first), one batch per request.
async function session(seed, batches, cookie, firstPlayed) {
  const played = firstPlayed ? [firstPlayed] : [];
  for (let b = 0; b < batches; b += 1) {
    const { status, body } = await api(radioUrl(seed, played.slice(-200), '&rng=' + (b + 1)), cookie);
    assert.strictEqual(status, 200);
    if (!body.items.length) break;
    for (const t of body.items) played.push(t.id);
  }
  return played;
}

test('W1 tiers: a song seed draws the seed artist and the close genre first, and never the big unrelated genre while any closer tier has candidates', async () => {
  const played = await session('track:sd0', 30, null, 'sd0');
  const list = await lib();
  const jazzAt = played.findIndex((id) => FAR_GROUPS.includes(group(id)));
  const close = list.filter((t) => !FAR_GROUPS.includes(group(t.id))).map((t) => t.id); // admin: the secret folder is visible
  const lastCloseAt = Math.max(...close.map((id) => played.indexOf(id)));
  assert.ok(close.every((id) => played.includes(id)), 'the session reached every non-Jazz track');
  assert.ok(jazzAt > lastCloseAt, `no T7 pick (Jazz, the YouTube-"Music" channels) before the closer tiers ran out (first at ${jazzAt}, last close pick at ${lastCloseAt})`);
  // the first batch: exactly 2 from the seed artist (T1), 3 from T2 (same genre, year within 5)
  const first = played.slice(1, 6);
  const seedy = first.filter((id) => byId(list, id).artist === 'Seedy');
  assert.strictEqual(seedy.length, 2, 'first batch: 2 seed-artist picks: ' + first.join(' '));
  assert.ok(first.filter((id) => !seedy.includes(id)).every((id) => group(id) === 'nb'), 'first batch: the rest are T2 (Neighbour Band, Rock 1993): ' + first.join(' '));
  // tier order by FIRST appearance: T2 before T3 before T4 before T5 before T7
  const firstAt = (g) => played.findIndex((id) => group(id) === g);
  assert.ok(firstAt('nb') < firstAt('lr'), 'T2 before T3');
  assert.ok(firstAt('lr') < firstAt('bm'), 'T3 before T4');
  assert.ok(firstAt('bm') < firstAt('ff'), 'T4 before T5');
  assert.ok(firstAt('ff') < firstAt('jz'), 'T5 before T7');
});

test('W1 tiers (pure, on the real shape): tierOf classifies every seeded group as the ruling says', async () => {
  const list = await lib();
  const profile = radio.buildStationProfile({ kind: 'track', value: 'sd0' }, list);
  const nb = radio.genreNeighbours(list);
  const tierOfGroup = {};
  for (const t of list) tierOfGroup[t.id.startsWith('sec') ? 'sec' : group(t.id)] = radio.tierOf(t, profile, nb);
  assert.deepStrictEqual(tierOfGroup, { sd: 1, nb: 2, lr: 3, xr: 3, cx: 4, bm: 4, ff: 5, jz: 7, ta: 7, tb: 7, sec: 1 });
  // a divergent control: the unrelated tracks are most of the library, so a tier-ignoring uniform draw takes them most
  assert.ok(list.filter((t) => FAR_GROUPS.includes(group(t.id))).length * 2 > list.length, 'precondition: the unrelated tracks are over half the library');
  // T0 tuning: a YouTube category is not a genre on yt-dlp audio - Tube B is T6 (same category,
  // below the folder tier) for a Tube A seed, where a raw genre match would make it T2 (same
  // "genre" Music, same year)
  const tube = radio.buildStationProfile({ kind: 'track', value: 'ta0' }, list);
  assert.strictEqual(tube.genre, null, 'a yt-dlp "Music" tag is untagged');
  assert.strictEqual(tube.category, 'music', 'the station keeps the category as its last close tier');
  assert.strictEqual(radio.tierOf(byId(list, 'tb0'), tube, nb), 6, 'another channel\'s "Music" upload is T6, after its own folder');
  assert.strictEqual(radio.tierOf(byId(list, 'jz0'), tube, nb), 7, 'a tagged unrelated genre is T7');
  assert.strictEqual(byId(list, 'tb0').genre, 'Music', 'precondition: the real item carries the category as its genre');
  // a station seeded FROM the category plays its members
  const cat = radio.buildStationProfile({ kind: 'genre', value: 'Music' }, list);
  assert.strictEqual(radio.tierOf(byId(list, 'tb0'), cat, nb), 3, 'genre:Music station: a Music upload is in its genre');
  assert.strictEqual(radio.tierOf(byId(list, 'jz0'), cat, nb), 7);
  // folding: hip-hop = hip hop
  assert.strictEqual(radio.genreKey({ genre: 'Hip-Hop', source: 'native' }), radio.genreKey({ genre: 'hip  hop', source: 'native' }));
});

test('W1 spacing: never 3 in a row from one artist, across batch boundaries too, while another artist has a CLOSE candidate', async () => {
  // R12 within R4: a run of 3 is allowed only when every unplayed track in T1-T5 is that artist (the
  // only alternative is an unrelated genre, T7, which spacing never jumps to); the Jazz tail is T7.
  const played = await session('track:sd0', 30, null, 'sd0');
  const list = await lib();
  const artist = (id) => byId(list, id).artist;
  const closeIds = list.filter((t) => !FAR_GROUPS.includes(group(t.id))).map((t) => t.id);
  let run = 1; let checked = 0;
  for (let i = 1; i < played.length; i += 1) {
    run = artist(played[i]) === artist(played[i - 1]) ? run + 1 : 1;
    if (FAR_GROUPS.includes(group(played[i]))) continue;
    checked += 1;
    if (run > radio.MAX_ARTIST_RUN) {
      const left = closeIds.filter((id) => !played.slice(0, i).includes(id));
      assert.ok(left.every((id) => artist(id) === artist(played[i])), `run of ${run} at ${i} (${played[i]}) while another close artist had a candidate: ${left.join(' ')}`);
    }
  }
  assert.ok(checked > 25, 'precondition: the close part of the session was checked');
  // the hourly cap (T0 tuning): no artist over 3 in any 15 consecutive close plays while another close artist remained
  for (let i = 0; i + 15 <= played.length; i += 1) {
    const win = played.slice(i, i + 15).filter((id) => !FAR_GROUPS.includes(group(id)));
    const counts = {};
    for (const id of win) counts[artist(id)] = (counts[artist(id)] || 0) + 1;
    const left = closeIds.filter((id) => !played.slice(0, i + 15).includes(id));
    for (const [a, n] of Object.entries(counts)) {
      if (n > radio.ARTIST_WINDOW_MAX) assert.ok(left.length === 0 || left.every((id) => artist(id) === a), `${a} played ${n} times in plays ${i}-${i + 14}`);
    }
  }
});

test('W1 spacing (pure, cross-batch): the last two plays from one artist bar that artist from the next batch\'s first slot', async () => {
  const list = await lib();
  const profile = radio.buildStationProfile({ kind: 'track', value: 'sd0' }, list);
  // the session just played two Seedy tracks: slot 0 (a T1 slot) must not be a third
  for (let s = 1; s <= 50; s += 1) {
    const picks = radio.pickRadioBatch(profile, list, { exclude: ['sd0', 'sd1'], count: 5 }, createSeededRng(s));
    assert.notStrictEqual(byId(list, picks[0].id).artist, 'Seedy', 'seed ' + s + ': slot 0 broke the run of 2: ' + picks.map((t) => t.id).join(' '));
  }
});

test('W1 exclude: an excluded id is never picked while unexcluded candidates remain; an all-excluded library recycles the least recently played', async () => {
  const list = await lib();
  const ex = ['sd0', 'sd1', 'sd2', 'nb0', 'nb1', 'nb2'];
  const { body } = await api(radioUrl('track:sd0', ex, '&count=10&rng=7'));
  assert.strictEqual(body.items.length, 10);
  assert.ok(!body.items.some((t) => ex.includes(t.id)), 'no excluded id: ' + body.items.map((t) => t.id).join(' '));
  // everything visible excluded, oldest first: the recycle order is the exclude order (seed skipped)
  const all = list.map((t) => t.id);
  const ordered = ['lr0'].concat(all.filter((id) => id !== 'lr0'));
  const picks = radio.pickRadioBatch(radio.buildStationProfile({ kind: 'track', value: 'sd0' }, list), list, { exclude: ordered, count: 3 }, createSeededRng(1));
  const expected = ordered.filter((id) => id !== 'sd0').slice(0, 3);
  assert.deepStrictEqual(picks.map((t) => t.id), expected, 'least recently played first, never silence');
});

test('gate r2 S7: the route honours `queued` - a still-queued song is never picked (and is not counted as a play)', async () => {
  const queued = ['nb0', 'nb1', 'nb2', 'nb3', 'nb4', 'nb5'];
  for (let k = 1; k <= 10; k += 1) {
    const { body } = await api(radioUrl('track:sd0', ['sd0'], '&count=5&rng=' + k + '&queued=' + queued.join(',')));
    assert.ok(!body.items.some((t) => queued.includes(t.id)), 'rng ' + k + ': a queued song was picked: ' + body.items.map((t) => t.id).join(' '));
  }
});

test('gate r3 W10: the route honours `widen=1` - the rest of the library first, as if the close tiers were spent', async () => {
  const lib0 = await lib();
  for (let k = 1; k <= 10; k += 1) {
    const plain = (await api(radioUrl('track:sd0', ['sd0'], '&count=5&rng=' + k))).body.items;
    assert.ok(plain.every((t) => byId(lib0, t.id).genre === 'Rock'), 'precondition: a plain batch stays in Rock');
    const wide = (await api(radioUrl('track:sd0', ['sd0'], '&count=5&rng=' + k + '&widen=1'))).body.items;
    assert.ok(wide.length === 5 && wide.every((t) => byId(lib0, t.id).genre !== 'Rock' && byId(lib0, t.id).genre !== 'Blues'), 'rng ' + k + ': a widened batch comes from T7: ' + wide.map((t) => t.id).join(' '));
  }
});

test('W1 likes (R10): a liked track weighs ~2x within its tier (statistical over fixed rng seeds, through the real route and the real like store)', async () => {
  // T2 for a Seedy seed is Neighbour Band (6 tracks). With 2 liked, the first non-T1 pick (slot 1)
  // is liked with p = 4/8 = 50% at 2x, 2/6 = 33% unweighted.
  userStore.addLiked(auth.user.id, 'nb0', '2026-10-06T00:00:00Z');
  userStore.addLiked(auth.user.id, 'nb1', '2026-10-06T00:00:00Z');
  try {
    const listed = (await api('/api/music?filter=liked&limit=100')).body.items.map((t) => t.id).sort();
    assert.deepStrictEqual(listed, ['nb0', 'nb1'], 'precondition: the real like store reads both as liked');
    let liked = 0; const N = 300;
    for (let s = 1; s <= N; s += 1) {
      const { body } = await api(radioUrl('track:sd0', ['sd0'], '&rng=' + s));
      assert.strictEqual(group(body.items[1].id), 'nb', 'precondition: slot 1 is a T2 pick');
      if (body.items[1].id === 'nb0' || body.items[1].id === 'nb1') liked += 1;
    }
    const share = liked / N;
    assert.ok(share > 0.42 && share < 0.58, 'liked share of slot 1 with 2x weight (expect ~0.50, 0.33 without): ' + share.toFixed(3));
  } finally {
    userStore.removeLiked(auth.user.id, 'nb0');
    userStore.removeLiked(auth.user.id, 'nb1');
  }
});

test('W1 recency (R10, pure on the real shape): a track whose progress moved in the last 24 h weighs less', async () => {
  const list = await lib();
  const profile = radio.buildStationProfile({ kind: 'track', value: 'sd0' }, list);
  const now = Date.parse('2026-10-06T12:00:00Z');
  const progress = { nb0: { updatedAt: '2026-10-06T11:00:00Z' }, nb1: { updatedAt: '2026-10-06T11:30:00Z' }, nb2: { updatedAt: '2026-10-04T11:00:00Z' } };
  let recent = 0; const N = 600;
  for (let s = 1; s <= N; s += 1) {
    const p = radio.pickRadioBatch(profile, list, { exclude: ['sd0'], count: 2, progress, now }, createSeededRng(s));
    if (p[1].id === 'nb0' || p[1].id === 'nb1') recent += 1;
  }
  // weights 0.25,0.25,1,1,1,1 -> 0.5/4.5 = 11%; unweighted 2/6 = 33%
  assert.ok(recent / N < 0.18, 'recently played share of slot 1: ' + (recent / N).toFixed(3));
});

test('W1 seeds: artist, album and genre stations resolve on the real shape; a bad seed is a 400; an unknown seed an empty batch', async () => {
  let r = await api(radioUrl('artist:Seedy', [], '&rng=3'));
  assert.deepStrictEqual(r.body.items.map((t) => group(t.id)).filter((g) => g === 'sd').length, 2, 'artist seed: 2 seed-artist picks');
  assert.ok(r.body.items.every((t) => ['sd', 'nb'].includes(group(t.id))), 'artist seed: T1 + T2 only: ' + r.body.items.map((t) => t.id).join(' '));
  const albumKey = byId(await lib(), 'bm0').albumKey;
  r = await api(radioUrl('album:' + albumKey, [], '&rng=3'));
  assert.ok(r.body.items.length === 5 && r.body.items.every((t) => ['bm', 'cx'].includes(group(t.id))), 'album seed (Bluesman): Bluesman + Blues: ' + r.body.items.map((t) => t.id).join(' '));
  r = await api(radioUrl('genre:jazz', [], '&rng=3'));
  assert.ok(r.body.items.length === 5 && r.body.items.every((t) => group(t.id) === 'jz'), 'genre seed: Jazz only');
  assert.strictEqual((await api(radioUrl('genre:Polka', []))).body.items.length, 0, 'unknown genre: empty');
  assert.strictEqual((await api('/api/music/radio?seed=nonsense')).status, 400);
  assert.strictEqual((await api('/api/music/radio')).status, 400);
  // the items are the /api/music item shape exactly (the client appends them unchanged)
  const listItem = byId(await lib(), r.body.items[0].id);
  assert.deepStrictEqual(Object.keys(r.body.items[0]).sort(), Object.keys(listItem).sort(), 'same keys as GET /api/music');
});

test('W1 RBAC (LESSONS 10): a member never gets a hidden-folder track as a pick, and a hidden track is not a seed; admin does (discrimination)', async () => {
  const cookie = member.cookie;
  // admin: the hidden tracks are Seedy Rock 1990 = T1 for a Seedy seed, so they DO come up
  const adminPlayed = await session('track:sd0', 30, null, 'sd0');
  assert.ok(adminPlayed.some((id) => id.startsWith('sec')), 'admin\'s station includes the secret folder (the gate discriminates)');
  for (const seed of ['track:sd0', 'artist:Seedy', 'genre:rock']) {
    const played = await session(seed, 30, cookie, seed === 'track:sd0' ? 'sd0' : null);
    assert.ok(played.length > 20, 'member session ran: ' + seed);
    assert.ok(!played.some((id) => id.startsWith('sec')), 'member never sees a secret track via ' + seed);
  }
  const hidden = await api(radioUrl('track:sec0', []), cookie);
  assert.deepStrictEqual(hidden, { status: 200, body: { items: [] } }, 'a hidden seed answers like a missing one');
  const missing = await api(radioUrl('track:nope', []), cookie);
  assert.deepStrictEqual(missing, hidden, 'identical to a non-existent seed (no oracle)');
});

// ---- W2: the CLIENT through the real server (LESSONS 2: the real /api/music/radio answer, the real
// music.js + skin engine in jsdom, every fetch to this server) -----------------------------------
const { createPocketHarness } = require('../helpers/pocket-menu-harness');
const H = createPocketHarness(() => ({ base, authedFetch: global.fetch }));
const radioCalls = (log) => log.filter((u) => u.indexOf('/api/music/radio?') !== -1).map((u) => new URL(u, 'http://x'));
const { encodeListContext } = require('../../public/js/common.js');
const realCodec = (dom) => { dom.window.encodeListContext = encodeListContext; }; // the browser's page global
const ctxOf = (load) => { try { return JSON.parse(load.data.browseCtx); } catch (_) { return null; } };

test('W2 Start radio from a GENRE (pocket Genres level): the level ends with the row; the queue is replaced by the station, the seed rides the context, Autoplay is turned on with a toast', async () => {
  const toasts = [];
  await H.boot({ skin: 'ipod', play: 'jz0', setup: (dom) => { realCodec(dom); dom.window.localStorage.setItem('ft-music-autoplay', '0'); dom.window.showToast = (m) => toasts.push(m); }, run: async (h) => {
    H.menu(h); H.select(h); await H.settleNet(); // Main Menu > Music
    H.tapRow(h, 'Genres'); await H.settleNet();
    H.tapRow(h, 'Rock'); await H.settleNet();
    assert.strictEqual(H.labels(h).slice(-1)[0], 'Start radio', 'the genre level ends with Start radio');
    assert.notStrictEqual(H.cursorLabel(h), 'Start radio', 'the level opens on its first song, not on the radio row');
    H.tapRow(h, 'Start radio'); await H.settleNet();
    const calls = radioCalls(h.log);
    assert.strictEqual(calls.length, 1, 'one station request');
    assert.strictEqual(calls[0].searchParams.get('seed'), 'genre:Rock');
    assert.ok(h.spy.loads.length >= 1, 'the station started');
    const first = h.spy.loads[h.spy.loads.length - 1];
    const L = await lib();
    assert.strictEqual(byId(L, first.id).genre, 'Rock', 'the first pick is IN the genre (a coherent pick, never Jazz)');
    assert.deepStrictEqual(ctxOf(first), { src: 'music', radio: 'genre:Rock' }, 'the station seed rides the queue context (a resume keeps the station)');
    assert.strictEqual(h.dom.window.localStorage.getItem('ft-music-autoplay'), '1', 'Autoplay was turned on so the station continues');
    assert.ok(toasts.some((m) => /Autoplay is on/.test(m)), 'and a toast said so: ' + toasts.join(' | '));
  } });
});

test('W2 Start radio from an ARTIST and an ALBUM (pocket levels): each seeds its own station', async () => {
  await H.boot({ skin: 'ipod', play: 'jz0', setup: (dom) => { realCodec(dom); dom.window.localStorage.setItem('ft-music-autoplay', '0'); }, run: async (h) => {
    H.menu(h); H.select(h); await H.settleNet(); // Main Menu > Music
    H.tapRow(h, 'Artists'); await H.settleNet();
    H.tapRow(h, 'Bluesman'); await H.settleNet();
    assert.strictEqual(H.labels(h).slice(-1)[0], 'Start radio');
    H.tapRow(h, 'Start radio'); await H.settleNet();
    let calls = radioCalls(h.log);
    assert.strictEqual(calls[calls.length - 1].searchParams.get('seed'), 'artist:Bluesman');
    const L = await lib();
    assert.strictEqual(byId(L, h.spy.loads[h.spy.loads.length - 1].id).genre, 'Blues', 'an artist station starts in the artist\'s genre');
    // an album level
    H.menu(h); H.menu(h); H.menu(h); await H.settleNet();
    H.tapRow(h, 'Albums'); await H.settleNet();
    H.tapRow(h, 'Blue Notes'); await H.settleNet(); // Bluesman's titled album
    assert.strictEqual(H.labels(h).slice(-1)[0], 'Start radio', 'an album level ends with Start radio');
    H.tapRow(h, 'Start radio'); await H.settleNet();
    calls = radioCalls(h.log);
    assert.strictEqual(calls[calls.length - 1].searchParams.get('seed'), 'album:Bluesman\u241fBlue Notes', 'the album\'s own key seeds it');
  } });
});

test('W2 plain Autoplay: every batch is drawn against the SAME seed (R8) - the song that ran out, never the last pick - and a resume (re-init) keeps the station', async () => {
  await H.boot({ skin: 'ipod', play: 'lr0', setup: realCodec, run: async (h) => {
    await H.settleNet();
    // ?play= opens the song's album: walk it to its LAST song, where the queue runs out
    for (let k = 0; k < 8 && !radioCalls(h.log).length; k++) { h.spy.nav.onNext(); await H.settleNet(10); }
    let calls = radioCalls(h.log);
    assert.strictEqual(calls.length, 1, 'the album ran out: one station request');
    const seedId = h.spy.loads[h.spy.loads.length - 1].id;
    assert.strictEqual(byId(await lib(), seedId).artist, 'Late Rocker', 'precondition: the album\'s last song is playing');
    assert.strictEqual(calls[0].searchParams.get('seed'), 'track:' + seedId, 'the station is the song that ran out');
    // walk to the station's last pick: the next batch is drawn against the SAME seed
    for (let k = 0; k < 5; k++) { h.spy.nav.onNext(); await H.settleNet(10); }
    calls = radioCalls(h.log);
    assert.ok(calls.length >= 2, 'the last pick armed a second batch');
    assert.strictEqual(calls[calls.length - 1].searchParams.get('seed'), 'track:' + seedId, 'the station seed, not the last pick (R8)');
    const ex = calls[calls.length - 1].searchParams.get('exclude').split(',');
    assert.strictEqual(ex[ex.length - 1], h.spy.loads[h.spy.loads.length - 1].id, 'the exclude list ends with the song playing now (most recent last)');
    assert.strictEqual((ctxOf(h.spy.loads[h.spy.loads.length - 1]) || {}).radio, 'track:' + seedId, 'the seed rides the player\'s context');
    // a resume: the view re-inits on the grid tab with the player still on the station
    const mark = h.log.length;
    h.mod.destroy();
    h.dom.window.localStorage.setItem('filetube_music_tab', 'albums');
    h.dom.window.history.replaceState({}, '', '/music'); // a dock-return: no ?play= - the player carries the song
    const playing = h.pstate.meta.id;
    assert.ok(byId(await lib(), playing) && playing !== seedId, 'precondition: a station pick is playing, its context the radio');
    h.mod.init(h.D.getElementById('view-root'));
    await H.settleNet();
    const after = radioCalls(h.log.slice(mark));
    assert.ok(after.length >= 1, 'the rebuilt station queue armed the next batch');
    assert.strictEqual(after[after.length - 1].searchParams.get('seed'), 'track:' + seedId, 'the resume kept the station (never a re-fetched list)');
    assert.ok(!h.log.slice(mark).some((u) => /\/api\/music\?/.test(u) && /limit=1000/.test(u)), 'and did not re-fetch the library as a "list"');
    assert.ok(h.log.slice(mark).some((u) => u === '/api/music/' + encodeURIComponent(playing)), 'it fetched the playing song itself (the rebuilt one-song queue)');
  } });
});

// ---- v1.378.0 music stations W4 (D11): the Pocket Radio row ----------------------------------------
test('v1.378.0 D11 Pocket: Main Menu > Radio lists this viewer\'s stations (the shelf\'s list); a row starts the station with its NAME in the context, and the LCD reads "Radio: <name>"', async () => {
  await H.boot({ skin: 'ipod', play: 'jz0', setup: (dom) => { realCodec(dom); dom.window.localStorage.setItem('ft-music-autoplay', '0'); dom.window.showToast = () => {}; }, run: async (h) => {
    H.menu(h); await H.settleNet(); // Now Playing -> Main Menu
    const main = H.labels(h);
    assert.strictEqual(main[1], 'Radio', 'Radio right after Music: ' + main.join(' | '));
    H.tapRow(h, 'Radio'); await H.settleNet();
    const rows = H.labels(h);
    // this library: no generated station (Rock has 4 artists but 17 songs; Jazz 40 songs from ONE artist); the built-in
    // Recently added (every track carries addedAt) is the one station, the same list GET /api/music/stations serves
    const served = (await api('/api/music/stations')).body.stations.filter((s) => !s.hidden).map((s) => s.name);
    assert.deepStrictEqual(rows, served, 'the Radio level is the station list, in its order');
    assert.ok(rows.includes('Recently added'), rows.join(' | '));
    H.tapRow(h, 'Recently added'); await H.settleNet();
    const calls = radioCalls(h.log);
    assert.strictEqual(calls.length, 1, 'one station request');
    assert.strictEqual(calls[0].searchParams.get('seed'), 'station:recent');
    const first = h.spy.loads[h.spy.loads.length - 1];
    assert.deepStrictEqual(ctxOf(first), { src: 'music', radio: 'station:recent', radioName: 'Recently added' }, 'the seed AND the name ride the context');
    assert.strictEqual(h.dom.window.localStorage.getItem('ft-music-autoplay'), '1', 'Autoplay on so the station continues');
    const album = h.dom.window.document.querySelector('#music-nowplaying-panel .ip-album');
    assert.ok(album && album.textContent === 'Radio: Recently added', 'the LCD\'s album slot reads the station: ' + (album && album.textContent));
  } });
});
