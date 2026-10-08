'use strict';

// [UNIT] v1.375.0 gate r1 (plan docs/exec-plans/active/2026-10-08-v1375-radio-like-radio.md): the adversary's
// repros and the mechanisms its mutants left unbound, on the Kirby-shaped library plus the tracks each repro
// needs. Every test is the input only its guard refuses (LESSONS 2), counted over rng seeds.

const { test } = require('node:test');
const assert = require('node:assert');
const radio = require('../../lib/music/radio');
const store = require('../../lib/music/store');
const { createSeededRng } = require('../../lib/videoQuery');
const K = require('../helpers/radio-kirby-library');

const LIB = K.buildLibrary();
const keyOf = (lib, title) => store.albumKeyFor(lib.find((t) => t.album === title));
// 20 sessions x 25 plays (5 batches), every pick a play; returns the picks with their tiers
function sessions(lib, seed, ctx0, runs, batches) {
  const out = [];
  const profile = radio.buildStationProfile(seed, lib);
  for (let r = 1; r <= (runs || 20); r += 1) {
    const plays = (ctx0.played || []).slice();
    const rng = createSeededRng(r);
    const s = [];
    for (let b = 0; b < (batches || 5); b += 1) {
      const trace = [];
      const picks = radio.pickRadioBatch(profile, lib, { exclude: plays.slice(-200), queued: ctx0.queued || [], count: 5, trace, liked: ctx0.liked, progress: ctx0.progress, now: ctx0.now }, rng);
      picks.forEach((t, i) => { s.push({ t, tier: trace[i].tier }); plays.push(t.id); });
    }
    out.push(s);
  }
  return out;
}
const albumSeed = (lib, title) => { const m = lib.filter((t) => t.album === title); return [{ kind: 'album', value: store.albumKeyFor(m[0]) }, { queued: m.map((t) => t.id) }]; };
const songSeed = (lib, title, songTitle) => { const m = lib.filter((t) => t.album === title); const t = m.find((x) => x.title === songTitle); return [{ kind: 'track', value: t.id }, { queued: m.map((x) => x.id) }]; };

// ---- C1: ordinary words never pull a real-genre song (the series holds game music only) ----------------

const C1 = [
  ['"Forgotten" (Linkin Park, Rock) vs "Kirby and the Forgotten Land"', K.album('Linkin Park', 'Hybrid Theory', 'Rock', 2000, ['Papercut', 'Forgotten', 'Crawling']), 'Linkin Park',
    (lib) => albumSeed(lib, 'Kirby and the Forgotten Land - Full OST Medley')],
  ['"Ice Cream" (Raekwon, Hip-Hop) vs the song "Ice Cream Island"', K.album('Raekwon', 'Only Built 4 Cuban Linx', 'Hip-Hop', 1995, ['Ice Cream', 'Criminology', 'Incarcerated Scarfaces']), 'Raekwon',
    (lib) => songSeed(lib, K.KIRBY_SETS.nestalgiaLofi, 'Ice Cream Island')],
  ['Holst / Bach "Suite" (Classical) vs "Kirby Orchestral Suite"', K.album('Gustav Holst', 'The Planets Suite', 'Classical', 1918, ['Mars', 'Venus', 'Jupiter']).concat(K.album('J.S. Bach', 'Cello Suite No. 1', 'Classical', 1720, ['Prelude', 'Allemande'])), 'classical',
    (lib) => albumSeed(lib, 'Kirby Orchestral Suite')],
  ['Shakira / "Late Jazz Sessions" vs "Musica para estudiar con Kirby - jazz sessions"', K.album('Shakira', 'Un Poco para Ti', 'Latin', 2005, ['Para Ti', 'Estudiar Contigo']).concat(K.album('Night Trio', 'Late Jazz Sessions', 'Jazz', 1999, ['Session One', 'Session Two'])), 'latin-jazz',
    (lib) => albumSeed(lib, 'Musica para estudiar con Kirby - jazz sessions')],
];
const EXTRA_GAME = [].concat(
  K.set('EstudioVGM', 'estudiovgm', 'Musica para estudiar con Kirby - jazz sessions', 'Gaming', ['Estudio Uno', 'Estudio Dos', 'Estudio Tres']),
  K.set('EstudioVGM', 'estudiovgm', 'Musica para estudiar con Zelda', 'Gaming', ['Zelda Estudio Uno', 'Zelda Estudio Dos', 'Zelda Estudio Tres']));
for (const [name, extra, who, seedOf] of C1) {
  test('gate r1 adversary C1: ' + name + ' - the real-genre songs never enter the series nor play in 20 sessions x 25 plays', () => {
    const lib = LIB.concat(extra, EXTRA_GAME);
    const [seed, ctx0] = seedOf(lib);
    const plan = radio.stationPlan(radio.buildStationProfile(seed, lib), lib);
    assert.ok(plan && plan.game, 'precondition: a game-music station');
    for (const t of extra) assert.ok(!plan.inSeries(t), who + ': ' + t.title + ' is in the series');
    let hits = 0;
    for (const s of sessions(lib, seed, ctx0)) hits += s.filter((x) => extra.includes(x.t)).length;
    assert.strictEqual(hits, 0, who + ' picks in 20 x 25 plays: ' + hits);
  });
}

test('gate r1 adversary C1: a two-word name and its own words are ONE shared match - "Ice Cream Parlor" (game music) is not the "Ice Cream Island" series', () => {
  const lib = LIB.concat(K.set('Bake VGM', 'bakevgm', 'Pastry Quest OST', 'Gaming', ['Ice Cream Parlor', 'Cake Walk', 'Muffin Mines']),
    K.set('Bake VGM', 'bakevgm', 'Pastry Quest 2 OST', 'Gaming', ['Cookie Caves', 'Pie Peaks', 'Tart Towers']));
  const [seed] = songSeed(lib, K.KIRBY_SETS.nestalgiaLofi, 'Ice Cream Island');
  const plan = radio.stationPlan(radio.buildStationProfile(seed, lib), lib);
  const ice = plan.allTerms.filter((x) => ['ice cream', 'ice', 'cream'].includes(x.term) && plan.terms.includes(x));
  assert.strictEqual(ice.length, 3, 'precondition: "ice cream", "ice" and "cream" all qualify: ' + JSON.stringify(plan.terms.map((x) => x.term)));
  assert.ok(!plan.inSeries(lib.find((t) => t.title === 'Ice Cream Parlor')), 'one shared name is chance, not the series');
});

test('gate r1 adversary C1: a word in under half (or under 3) of the seed set\'s songs is no album word - Pokemon\'s "Route" never makes Vapid\'s "Rainbow Route" the series', () => {
  const routes = ['Pallet Town', 'Route 1', 'Viridian City', 'Pewter City', 'Route 3', 'Cerulean City', 'Route 24', 'Vermilion City'];
  const lib = LIB.concat(K.set('PokeLofi', 'pokelofi', 'Pokemon Red Lofi', 'Gaming', routes), K.set('PokeLofi', 'pokelofi', 'Pokemon Blue Lofi', 'Gaming', ['Lavender Town', 'Celadon City', 'Saffron City']),
    K.set('Pocket Beats', 'pocketbeats', 'Pokemon Chill', 'Gaming', ['Route Chill', 'Town Chill', 'Cave Chill']),
    // two of three titles say "Route": half, but under the 3-title minimum - still no album word
    K.set('PokeLofi', 'pokelofi', 'Pokemon Yellow Lofi', 'Gaming', ['Route 2', 'Route 22', 'Pallet Lofi']));
  const rainbow = lib.find((t) => t.title === 'Kirby Amazing Mirror - Rainbow Route');
  for (const [seed] of [albumSeed(lib, 'Pokemon Red Lofi'), songSeed(lib, 'Pokemon Red Lofi', 'Route 1'), albumSeed(lib, 'Pokemon Yellow Lofi')]) {
    const plan = radio.stationPlan(radio.buildStationProfile(seed, lib), lib);
    assert.ok(plan.terms.some((x) => x.term === 'pokemon'), 'precondition: the franchise word qualifies');
    assert.ok(!plan.inSeries(rainbow), seed.kind + ': "route" alone made Kirby the Pokemon series');
    assert.ok(plan.inSeries(lib.find((t) => t.title === 'Route Chill')), seed.kind + ': another channel\'s Pokemon set is');
  }
});

// ---- W2: talk shows and vlogs never ride the game family -----------------------------------------------

test('gate r1 adversary W2: a podcast / vlog / talk-show upload is never game music - a 2-upload "Game Talk Pod", a 50% "Daily Vlogger", NESTALGIA\'s People & Blogs podcast; 0 picks in 20 x 25 plays', () => {
  const talk = [].concat(K.upload('Game Talk Pod', 'gametalkpod', 'Game Talk Episode 1', 'Gaming'), K.upload('Game Talk Pod', 'gametalkpod', 'Game Talk Episode 2', 'Gaming'),
    K.upload('Daily Vlogger', 'dailyvlogger', 'I played Kirby all day', 'Gaming'), K.upload('Daily Vlogger', 'dailyvlogger', 'My week', 'People & Blogs'));
  // controls: 3 game-tagged of 4 tagged is a game channel; 3 of 6 (exactly half) is not
  const yes = [0, 1, 2].map((i) => K.upload('Speedrun VGM', 'speedrunvgm', 'Speedrun Mix ' + i, 'Gaming')).flat().concat(K.upload('Speedrun VGM', 'speedrunvgm', 'Speedrun Notes', 'Music'));
  const half = [0, 1, 2].map((i) => K.upload('Half Channel', 'halfchannel', 'Half Mix ' + i, 'Gaming')).flat().concat([0, 1, 2].map((i) => K.upload('Half Channel', 'halfchannel', 'Half Song ' + i, 'Music')).flat());
  const lib = LIB.concat(talk, yes, half);
  const [seed, ctx0] = albumSeed(lib, K.KIRBY_SETS.vapid);
  const plan = radio.stationPlan(radio.buildStationProfile(seed, lib), lib);
  const pod = lib.find((t) => t.title === 'NESTALGIA Podcast Episode 12');
  for (const t of talk.concat([pod])) assert.ok(!plan.isGame(t), t.title + ' counted as game music');
  for (const t of yes) assert.ok(plan.isGame(t), 'control: ' + t.title + ' (a strict majority, 3 game uploads) is game music');
  for (const t of half) assert.ok(!plan.isGame(t), t.title + ': exactly half is no majority');
  let hits = 0;
  for (const s of sessions(lib, seed, ctx0)) hits += s.filter((x) => talk.includes(x.t) || x.t === pod).length;
  assert.strictEqual(hits, 0, 'talk / vlog / podcast picks in 20 x 25 plays: ' + hits);
});

// ---- W3: every kept mechanism, bound ---------------------------------------------------------------------

// the FAMILY slot's draw (slot 4 of the first batch) is the first draw from G: its share by channel
function familySlotPicks(lib, ctxExtra, runs) {
  const [seed, ctx0] = albumSeed(lib, K.KIRBY_SETS.vapid);
  const profile = radio.buildStationProfile(seed, lib);
  const out = [];
  for (let r = 1; r <= runs; r += 1) {
    const trace = [];
    const picks = radio.pickRadioBatch(profile, lib, Object.assign({ exclude: [], queued: ctx0.queued, count: 5, trace }, ctxExtra || {}), createSeededRng(r));
    assert.strictEqual(trace[4].tier, radio.TIER_GAME, 'precondition: slot 4 draws game music');
    out.push(picks[4]);
  }
  return out;
}

test('W3 (U11): game music is weighed per track by 1/sqrt(its channel\'s songs) - NESTALGIA plays most of G but well under its song share', () => {
  const [seed, ctx0] = albumSeed(LIB, K.KIRBY_SETS.vapid);
  const plan = radio.stationPlan(radio.buildStationProfile(seed, LIB), LIB);
  const pool = LIB.filter((t) => !ctx0.queued.includes(t.id) && plan.tierOf(t) === radio.TIER_GAME);
  const n = {};
  for (const t of pool) { const ch = t.albumArtist; n[ch] = (n[ch] || 0) + 1; }
  const flat = n.NESTALGIA / pool.length;
  const sq = Object.values(n).reduce((a, k) => a + Math.sqrt(k), 0);
  const sqrtShare = Math.sqrt(n.NESTALGIA) / sq;
  assert.ok(flat - sqrtShare > 0.15, 'precondition: the two weighings diverge: flat ' + flat.toFixed(2) + ', sqrt ' + sqrtShare.toFixed(2));
  const picks = familySlotPicks(LIB, {}, 600);
  const share = picks.filter((t) => t.albumArtist === 'NESTALGIA').length / picks.length;
  assert.ok(Math.abs(share - sqrtShare) < 0.08, `NESTALGIA share of the G draws ${share.toFixed(3)} (1/sqrt expects ${sqrtShare.toFixed(3)}, flat ${flat.toFixed(3)})`);
});

test('W3 (U4, U12): on the series ladder a liked song weighs x2 and a song played in the last 24 h x0.25 (R10)', () => {
  const castle = new Set(LIB.filter((t) => t.album === 'Castlevania Symphony Remix').map((t) => t.id));
  const share = (ctx) => familySlotPicks(LIB, ctx, 600).filter((t) => castle.has(t.id)).length / 600;
  const base = share({});
  const liked = share({ liked: castle });
  const now = Date.parse('2026-10-08T12:00:00Z');
  const progress = {};
  for (const id of castle) progress[id] = { updatedAt: '2026-10-08T11:00:00Z' };
  const cooled = share({ progress, now });
  assert.ok(base > 0.03, 'precondition: the Castlevania set is drawn at all: ' + base);
  assert.ok(liked / base > 1.5, `liked x2: ${base.toFixed(3)} -> ${liked.toFixed(3)}`);
  assert.ok(cooled / base < 0.6, `the 24 h cool-down: ${base.toFixed(3)} -> ${cooled.toFixed(3)}`);
});

test('W3 (U5): a franchise named in 3+ (and half) of a set\'s song titles is the series even when the set\'s title does not name it', () => {
  const lib = LIB.concat(K.set('heavymachinegun', 'heavymachinegun', 'Chill Beats Vol 3', 'Gaming', ['Kirby Theme A', 'Kirby Theme B', 'Kirby Theme C', 'Ocean Waves']));
  const [seed, ctx0] = albumSeed(lib, 'Chill Beats Vol 3');
  let kirbyFirst = 0;
  for (const s of sessions(lib, seed, ctx0, 50, 1)) if (K.isKirby(s[0].t)) kirbyFirst += 1;
  assert.strictEqual(kirbyFirst, 50, 'the first pick is the Kirby series: ' + kirbyFirst + '/50');
});

test('W3 (U7, U13): a game set with no series words is still game music by its own songs - album and song seeds draw game music first, not the genre ladder', () => {
  const lib = LIB.concat(K.set('heavymachinegun', 'heavymachinegun', 'Zzyzx Mix', 'Gaming', ['Qwerty One', 'Qwerty Two', 'Qwerty Three']));
  for (const [seed, ctx0] of [albumSeed(lib, 'Zzyzx Mix'), songSeed(lib, 'Zzyzx Mix', 'Qwerty One')]) {
    const plan = radio.stationPlan(radio.buildStationProfile(seed, lib), lib);
    assert.ok(plan && plan.game, seed.kind + ': a game-music station by its own songs');
    assert.strictEqual(plan.seriesSize, 0, 'precondition: no series');
    let gameFirst = 0;
    for (const s of sessions(lib, seed, ctx0, 30, 1)) if (s[0].tier === radio.TIER_GAME) gameFirst += 1;
    assert.strictEqual(gameFirst, 30, seed.kind + ': the first pick is game music: ' + gameFirst + '/30');
  }
});

test('W3 (U6): accents fold - an accented "Pokemon" seed finds another channel\'s plain "Pokemon" set as its series', () => {
  const accented = 'Pok' + String.fromCharCode(233) + 'mon Jazz Mix';
  const lib = LIB.concat(K.set('Jazz VGM', 'jazzvgm', accented, 'Gaming', ['Jazz Cut 1', 'Jazz Cut 2', 'Jazz Cut 3']),
    K.set('Pocket Beats', 'pocketbeats', 'Pokemon Lofi', 'Gaming', ['Lofi Cut A', 'Lofi Cut B', 'Lofi Cut C']));
  const [seed] = albumSeed(lib, accented);
  const plan = radio.stationPlan(radio.buildStationProfile(seed, lib), lib);
  assert.ok(plan.terms.some((x) => x.term === 'pokemon'), 'the folded word qualifies: ' + JSON.stringify(plan.allTerms.map((x) => x.term)));
  assert.ok(plan.inSeries(lib.find((t) => t.title === 'Lofi Cut A')), 'the plain-spelled set is the series');
});

// ---- W1: cost ----------------------------------------------------------------------------------------------

test('gate r1 adversary W1: a game station costs at most 2.5x a real-genre (v1.368.0 ladder) station on a 24k accented, chapter-heavy library (same run, medians)', () => {
  const base = K.buildLibrary();
  const lib = [];
  for (let k = 0; lib.length < 24000; k += 1) {
    for (const t of base) lib.push(Object.assign({}, t, { id: t.id + 'x' + k, album: t.album ? t.album + ' ' + k : t.album, title: (t.title + ' v' + k).replace(/e/g, String.fromCharCode(233)) }));
  }
  const game = { kind: 'album', value: keyOf(lib, K.KIRBY_SETS.vapid + ' 0') };
  const rock = { kind: 'album', value: keyOf(lib, 'The Colour and the Shape 0') };
  const time = (seed) => {
    const ms = [];
    for (let r = 0; r < 7; r += 1) {
      const t0 = process.hrtime.bigint();
      radio.pickRadioBatch(radio.buildStationProfile(seed, lib), lib, { count: 5 }, createSeededRng(r + 1));
      ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    return ms.sort((a, b) => a - b)[3];
  };
  time(game); // warm both (the memo fill is the first request's cost)
  time(rock);
  const g = time(game); const r = time(rock);
  assert.ok(g < 2.5 * r, `game station ${g.toFixed(1)} ms vs real-genre ${r.toFixed(1)} ms`);
});

// ---- before r2 (the Architect): YouTube-"Music" uploads may JOIN the series; nothing else changes ----------

test('before r2: only a yt-dlp upload joins the series without being game music - an untagged NATIVE file sharing "Kirby" never does', () => {
  const native = K.album('Kirby Smith', 'Kirby Live Lectures', '', 2011, ['Kirby Lecture One', 'Kirby Lecture Two']);
  const lib = LIB.concat(native);
  const [seed, ctx0] = albumSeed(lib, K.KIRBY_SETS.vapid);
  const plan = radio.stationPlan(radio.buildStationProfile(seed, lib), lib);
  assert.ok(plan.inSeries(lib.find((t) => t.album === 'Kirby Orchestral Suite')), 'precondition: a YouTube-"Music" Kirby set joins');
  for (const t of native) assert.ok(!plan.inSeries(t), t.title + ' (a native untagged file) joined the series');
  let hits = 0;
  for (const s of sessions(lib, seed, ctx0)) hits += s.filter((x) => native.includes(x.t)).length;
  assert.strictEqual(hits, 0, 'native untagged picks in 20 x 25 plays: ' + hits);
});

test('before r2: the game verdict counts the series\' GAME songs only - a lofi channel\'s set whose franchise game music barely holds stays on the genre ladder', () => {
  const lib = LIB.concat(
    K.set('NESTALGIA', 'NESTALGIA', 'Pikmin Theme', 'Gaming', ['Pikmin Forest', 'Pikmin Cave']),
    K.set('Vapid', 'vapidVGM', 'Pikmin Garden', 'Gaming', ['Pikmin Garden One', 'Pikmin Garden Two']),
    ...['Lofi C', 'Lofi D', 'Lofi E'].map((ch, i) => K.set(ch, 'lofi' + i, 'Pikmin lofi beats ' + ch, 'Music', [1, 2, 3, 4, 5].map((n) => 'Pikmin Chill ' + ch + ' ' + n))));
  const [seed] = albumSeed(lib, 'Pikmin lofi beats Lofi C');
  const profile = radio.buildStationProfile(seed, lib);
  const verdict = radio.stationPlan(profile, lib, { verdict: true });
  assert.ok(verdict.terms.some((x) => x.term === 'pikmin'), 'precondition: "pikmin" is a series word (learned from 2 game channels)');
  assert.ok(verdict.seriesSize >= 10, 'precondition: with the joined lofi uploads the series is 10+: ' + verdict.seriesSize);
  assert.strictEqual(verdict.game, false, '4 game songs are no game station');
  assert.strictEqual(radio.stationPlan(profile, lib), null);
});
