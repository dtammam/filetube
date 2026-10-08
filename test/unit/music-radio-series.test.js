'use strict';

// [UNIT] v1.375.0 "radio that feels like radio" (plan docs/exec-plans/completed/2026-10-08-v1375-radio-like-radio.md,
// Dean's rulings Q1-Q4): the series-first ladder of lib/music/radio.js on the Kirby-shaped library
// (test/helpers/radio-kirby-library.js - right and wrong picks DIVERGE there). Every claim is COUNTED over
// many rng seeds and every entry point (LESSONS 2): the album page Radio and the iPod's album row (seed
// album:<key>, the album still queued), a song's Start radio (track:<first song>, the album queued), and
// Autoplay after the album (track:<last song>, the album played). End to end through the real client:
// music-radio-kirby-e2e.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const radio = require('../../lib/music/radio');
const store = require('../../lib/music/store');
const { createSeededRng } = require('../../lib/videoQuery');
const K = require('../helpers/radio-kirby-library');

const LIB = K.buildLibrary();
const albumOf = (title) => LIB.filter((t) => t.album === title);
// Dean's session before the Kirby album (radio-findings.md: "Prince x3, Tears for Fears, David Bowie..."):
// 24 Pop plays, the window v1.368.0's anchor read
const POP_SESSION = LIB.filter((t) => t.artist === 'Prince').slice(0, 18)
  .concat(LIB.filter((t) => t.artist === 'Tears for Fears').slice(0, 3), LIB.filter((t) => t.artist === 'David Bowie').slice(0, 3))
  .map((t) => t.id);

function entryPoints(title) {
  const members = albumOf(title);
  const ids = members.map((t) => t.id);
  const key = store.albumKeyFor(members[0]);
  return [
    ['album page Radio', { kind: 'album', value: key }, { queued: ids, played: [] }],
    ['song Start radio', { kind: 'track', value: ids[0] }, { queued: ids, played: [] }],
    ['Autoplay after the album', { kind: 'track', value: ids[ids.length - 1] }, { queued: [], played: ids }],
  ];
}

// one station session: `batches` batches of 5, every pick a play (exclude = session + plays, oldest first)
function session(seed, ctx0, before, batches, rngSeed) {
  const profile = radio.buildStationProfile(seed, LIB);
  const plays = before.concat(ctx0.played);
  const rng = createSeededRng(rngSeed);
  const out = [];
  for (let b = 0; b < batches; b += 1) {
    const trace = [];
    const picks = radio.pickRadioBatch(profile, LIB, { exclude: plays.slice(-radio.EXCLUDE_CAP), queued: ctx0.queued, count: 5, trace }, rng);
    picks.forEach((t, i) => { out.push({ t, tier: trace[i].tier }); plays.push(t.id); });
  }
  return out;
}

const KIRBY_SEEDS = [K.KIRBY_SETS.vapid, K.KIRBY_SETS.nestalgiaLofi, K.KIRBY_SETS.psk, K.KIRBY_SETS.nativeOst];

test('Q1: a Kirby album station opens on the SAME SERIES from several channels - every Kirby album, every entry point, 100 rng seeds, after a Pop session; never Prince', () => {
  for (const title of KIRBY_SEEDS) {
    for (const [label, seed, ctx0] of entryPoints(title)) {
      let kirbyFirst = 0; let thinBatches = 0; let prince = 0; let kirbyPicks = 0;
      const byChannel = {};
      for (let r = 1; r <= 100; r += 1) {
        const picks = session(seed, ctx0, POP_SESSION, 1, r).map((x) => x.t);
        if (K.isKirby(picks[0])) kirbyFirst += 1;
        const kirby = picks.filter(K.isKirby);
        if (kirby.length < 3) thinBatches += 1;
        prince += picks.filter((t) => t.artist === 'Prince').length;
        kirbyPicks += kirby.length;
        for (const t of kirby) byChannel[t.albumArtist] = (byChannel[t.albumArtist] || 0) + 1;
      }
      const where = `${title} / ${label}`;
      assert.strictEqual(kirbyFirst, 100, `${where}: the first pick is the series (${kirbyFirst}/100)`);
      assert.strictEqual(thinBatches, 0, `${where}: batches with fewer than 3 Kirby songs: ${thinBatches}/100`);
      assert.strictEqual(prince, 0, `${where}: Prince picks: ${prince}`);
      const channels = Object.keys(byChannel);
      const top = Math.max(...Object.values(byChannel));
      assert.ok(channels.length >= 3, `${where}: Kirby from several channels: ${JSON.stringify(byChannel)}`);
      assert.ok(top / kirbyPicks < 0.6, `${where}: no one channel is most of the Kirby (not only NESTALGIA): ${JSON.stringify(byChannel)}`);
      // the series is GAME MUSIC only (Dean, gate r2): Soundzantium's and PSK's YouTube-"Music" Kirby sets
      // reach a Kirby station only if their channel is game music - here it is not (disclosed in the plan)
      assert.ok(!byChannel.Soundzantium, `${where}: Soundzantium's Kirby suite (not game music) in the first batches: ${JSON.stringify(byChannel)}`);
      if (title !== K.KIRBY_SETS.psk) assert.ok(!byChannel['PSK Beats n\' Vibes'], `${where}: PSK's Kirby set (not game music) in the first batches: ${JSON.stringify(byChannel)}`);
    }
  }
});

test('Q1: the seed artist is a MINORITY, and its other franchises never open the station (Vapid\'s Zelda / Mega Man / Mario, NESTALGIA\'s Zelda)', () => {
  for (const title of [K.KIRBY_SETS.vapid, K.KIRBY_SETS.nestalgiaLofi]) {
    const channel = albumOf(title)[0].albumArtist;
    for (const [label, seed, ctx0] of entryPoints(title)) {
      let own = 0; let total = 0; let otherFranchiseFirst = 0;
      for (let r = 1; r <= 50; r += 1) {
        const picks = session(seed, ctx0, POP_SESSION, 2, r).map((x) => x.t);
        own += picks.filter((t) => t.albumArtist === channel && !K.isKirby(t)).length;
        total += picks.length;
        if (!K.isKirby(picks[0]) && picks[0].albumArtist === channel) otherFranchiseFirst += 1;
      }
      assert.strictEqual(otherFranchiseFirst, 0, `${title} / ${label}: the seed channel's other franchise opened the station ${otherFranchiseFirst}/50`);
      assert.ok(own / total <= 0.25, `${title} / ${label}: the seed channel's non-series songs are a minority: ${own}/${total}`);
      assert.ok(own > 0, `${title} / ${label}: and still mixed in ("a little of the album's artist"): ${own}/${total}`);
    }
  }
});

// the yt-dlp Kirby set, and the NATIVE Kirby OST (whose folder is the whole native library, Prince included)
for (const q4Title of [K.KIRBY_SETS.vapid, K.KIRBY_SETS.nativeOst]) test('Q4: when the series runs out the station moves to OTHER GAME MUSIC before any real genre, and the whole library comes last (10 long sessions) - ' + q4Title, () => {
  const [, seed, ctx0] = entryPoints(q4Title)[0];
  const profile = radio.buildStationProfile(seed, LIB);
  const plan = radio.stationPlan(profile, LIB);
  const closeIds = LIB.filter((t) => [radio.TIER_SERIES, radio.TIER_GAME, 1].includes(plan.tierOf(t)) && !ctx0.queued.includes(t.id)).map((t) => t.id);
  assert.ok(closeIds.length > 150, 'precondition: a big game-music pool (' + closeIds.length + ')');
  for (let r = 1; r <= 10; r += 1) {
    const s = session(seed, ctx0, [], 39, r); // 195 plays, inside the 200-play exclude window
    const firstSeriesGone = s.findIndex((x, i) => x.tier !== radio.TIER_SERIES && s.slice(i).every((y) => y.tier !== radio.TIER_SERIES));
    const firstReal = s.findIndex((x) => K.isRealGenre(x.t));
    const firstRest = s.findIndex((x) => x.tier === 7);
    const firstNear = s.findIndex((x) => x.tier === radio.TIER_NEAR);
    // every pick before the first real genre is the series, the seed artist or game music
    const before = s.slice(0, firstReal < 0 ? s.length : firstReal);
    assert.ok(before.every((x) => K.isGameMusic(x.t) || K.isKirby(x.t)), `seed ${r}: a non-game pick before the first real genre`);
    // the real genres wait until the game music is (nearly) spent: at most 10 close songs left unplayed
    if (firstReal >= 0) {
      const playedBefore = new Set(s.slice(0, firstReal).map((x) => x.t.id));
      const left = closeIds.filter((id) => !playedBefore.has(id)).length;
      assert.ok(left <= 10, `seed ${r}: a real genre at play ${firstReal} with ${left} game / series songs unplayed`);
    }
    // the nearest genres before the rest of the library
    if (firstRest >= 0) assert.ok(firstNear >= 0 && firstNear < firstRest, `seed ${r}: the rest (T7) at ${firstRest} before the nearest genres (T10) at ${firstNear}`);
    assert.ok(firstSeriesGone > 0, `seed ${r}: the series ran out inside the session`);
    assert.ok(!s.slice(0, firstSeriesGone).some((x) => x.tier === 7 || x.tier === radio.TIER_NEAR), `seed ${r}: a far pick while the series still had songs`);
    const firstPrince = s.findIndex((x) => x.t.artist === 'Prince');
    assert.ok(firstPrince < 0 || (firstNear >= 0 && firstPrince > firstNear), `seed ${r}: Prince at ${firstPrince}, before the nearest genres (${firstNear})`);
  }
});

test('Q3: the session NEVER steers a station - the same picks with and without 24 Pop plays before it, for every entry point (series and genre seeds), 20 rng seeds', () => {
  for (const title of [K.KIRBY_SETS.vapid, K.KIRBY_SETS.psk, 'The Colour and the Shape']) {
    for (const [label, seed, ctx0] of entryPoints(title)) {
      let differ = 0;
      for (let r = 1; r <= 20; r += 1) {
        const a = session(seed, ctx0, POP_SESSION, 3, r).map((x) => x.t.id).join(',');
        const b = session(seed, ctx0, [], 3, r).map((x) => x.t.id).join(',');
        if (a !== b) differ += 1;
      }
      assert.strictEqual(differ, 0, `${title} / ${label}: the Pop session changed the station in ${differ}/20 runs`);
    }
  }
});

test('Q3: a native ROCK album keeps v1.368.0\'s artist + genre tiers (no series plan), Pop session or not', () => {
  for (const [label, seed, ctx0] of entryPoints('The Colour and the Shape')) {
    const profile = radio.buildStationProfile(seed, LIB);
    assert.strictEqual(profile.genre, 'rock');
    assert.strictEqual(radio.stationPlan(profile, LIB), null, label + ': a real genre draws the genre ladder');
    for (let r = 1; r <= 50; r += 1) {
      const s = session(seed, ctx0, POP_SESSION, 3, r);
      assert.ok(s.every((x) => [1, 2, 3].includes(x.tier)), `${label} seed ${r}: tiers ${s.map((x) => x.tier).join('')}`);
      assert.ok(s.every((x) => x.t.genre === 'Rock'), `${label} seed ${r}: all rock`);
    }
  }
});

test('series words: a title template, a style word and one shared song word never make a series; a two-word name does', () => {
  const vapid = albumOf(K.KIRBY_SETS.vapid);
  const plan = radio.stationPlan(radio.buildStationProfile({ kind: 'album', value: store.albumKeyFor(vapid[0]) }, LIB), LIB);
  assert.deepStrictEqual(plan.terms.map((x) => x.term), ['kirby'], 'Vapid\'s template ("2 Hours of Happy and Underrated") names nothing: ' + JSON.stringify(plan.allTerms.map((x) => x.term)));
  for (const t of albumOf('2 Hours of Happy and Underrated Zelda Music').concat(albumOf('Underrated Zelda Music (lofi)'))) {
    assert.notStrictEqual(plan.tierOf(t), radio.TIER_SERIES, 'a Zelda set sharing the template is not the series: ' + t.album);
  }
  // a song seed "Green Greens": the Sonic "Green Hill Zone" shares ONE song word - chance, not the series
  const greens = albumOf(K.KIRBY_SETS.nestalgiaLofi)[0];
  assert.strictEqual(greens.title, 'Green Greens');
  const songPlan = radio.stationPlan(radio.buildStationProfile({ kind: 'track', value: greens.id }, LIB), LIB);
  const hill = LIB.find((t) => t.title === 'Green Hill Zone');
  assert.ok(songPlan.terms.some((x) => x.term === 'green'), 'precondition: "green" is a qualified song word');
  assert.notStrictEqual(songPlan.tierOf(hill), radio.TIER_SERIES, 'one shared song word is not the series');
  const vapidGreens = LIB.find((t) => t.title === 'Green Greens (Kirby Dream Land)');
  assert.strictEqual(songPlan.tierOf(vapidGreens), radio.TIER_SERIES);
  // a two-word name: "mega man" qualifies though "man" alone is a stop word
  const mm = radio.stationPlan(radio.buildStationProfile({ kind: 'album', value: store.albumKeyFor(albumOf('2 Hours of Happy and Underrated Mega Man Music')[0]) }, LIB.concat([
    { id: 'mm-other', title: 'Mega Man 2 - Dr. Wily Stage', artist: 'Other VGM', albumArtist: 'Other VGM', album: 'Mega Man Medley', genre: 'Gaming', folderName: 'othervgm', source: 'library' },
    { id: 'mm-third', title: 'Mega Man X Intro', artist: 'Third VGM', albumArtist: 'Third VGM', album: '', genre: 'Gaming', folderName: 'thirdvgm', source: 'library' },
  ])), LIB);
  assert.ok(mm.allTerms.some((x) => x.term === 'mega man'), 'the pair is a candidate: ' + JSON.stringify(mm.allTerms.map((x) => x.term)));
  assert.ok(!mm.allTerms.some((x) => x.term === 'man'), '"man" alone never is');
});

test('game music: a channel is game music by its TAGGED uploads (untagged chapters ride along); a Music-category Kirby set is game music by its series', () => {
  const nest = albumOf(K.KIRBY_SETS.nestalgiaLofi);
  const plan = radio.stationPlan(radio.buildStationProfile({ kind: 'album', value: store.albumKeyFor(nest[0]) }, LIB), LIB);
  assert.strictEqual(nest[0].genre, '', 'precondition: the seed set is untagged');
  assert.ok(plan.isGame(nest[0]), 'an untagged NESTALGIA chapter is game music (the channel\'s tagged sets are Gaming)');
  assert.ok(!plan.isGame(albumOf('Rainy Day Beats')[0]), 'a lofi channel\'s Music upload is not');
  assert.ok(!plan.isGame(LIB.find((t) => t.artist === 'Prince')), 'Prince is not');
  assert.strictEqual(plan.game, true);
  const psk = albumOf(K.KIRBY_SETS.psk);
  const pskPlan = radio.stationPlan(radio.buildStationProfile({ kind: 'album', value: store.albumKeyFor(psk[0]) }, LIB), LIB);
  assert.ok(!pskPlan.isGame(psk[0]), 'precondition: PSK\'s own channel is YouTube "Music", not game music');
  assert.strictEqual(pskPlan.game, true, 'its station is game music: most of its series is');
  assert.ok(pskPlan.familySize > 150, 'the family on this fixture: ' + pskPlan.familySize);
});

// ---- the survivors of the first mutant run (each test is the input ONLY that guard refuses) ----------------

test('series words: a word only ONE channel uses (its own title template) is no series - a channel\'s other franchise stays out', () => {
  // GlitchCat names every set "Glitchwave <X> Mix": "glitchwave" is rare (2 titles) and not a stop word,
  // so only the 2+ channels rule keeps its Zelda set out of a Kirby station
  const lib = LIB.concat(K.set('GlitchCat', 'glitchcat', 'Glitchwave Kirby Mix', 'Gaming', ['Glitch Greens', 'Glitch Race', 'Glitch Clouds']),
    K.set('GlitchCat', 'glitchcat', 'Glitchwave Zelda Mix', 'Gaming', ['Glitch Field', 'Glitch Woods', 'Glitch Storms']));
  const seedT = lib.find((t) => t.album === 'Glitchwave Kirby Mix');
  const plan = radio.stationPlan(radio.buildStationProfile({ kind: 'album', value: store.albumKeyFor(seedT) }, lib), lib);
  const gw = plan.allTerms.find((x) => x.term === 'glitchwave');
  assert.ok(gw && gw.df === 2 && gw.artists === 1, 'precondition: a rare one-channel word: ' + JSON.stringify(gw));
  assert.ok(!plan.terms.some((x) => x.term === 'glitchwave'), 'the one-channel word does not qualify');
  for (const t of lib.filter((x) => x.album === 'Glitchwave Zelda Mix')) assert.notStrictEqual(plan.tierOf(t), radio.TIER_SERIES, 'the Zelda set is not the series');
});

test('series words: a COMMON word (over a quarter of the game-music titles, not a stop word) is no series - love songs never join a Kirby station', () => {
  // the df universe is GAME MUSIC's titles (the series holds game music only): two dating-sim channels whose
  // every song title says "love"
  const love = [];
  for (let a = 0; a < 24; a += 1) love.push(...K.set(a % 2 ? 'Dating Sim OST' : 'Otome Tunes', a % 2 ? 'datingsim' : 'otometunes', 'Heart Sim Vol ' + (a + 1), 'Gaming', Array.from({ length: 8 }, (_, i) => 'Love Theme ' + a + '-' + (i + 1))));
  const lib = LIB.concat(love, K.set('Heartbit', 'heartbit', 'Kirby Love Mix', 'Gaming', ['Alpha Cut', 'Beta Cut', 'Gamma Cut']));
  const seedT = lib.find((t) => t.album === 'Kirby Love Mix');
  const plan = radio.stationPlan(radio.buildStationProfile({ kind: 'album', value: store.albumKeyFor(seedT) }, lib), lib);
  const lv = plan.allTerms.find((x) => x.term === 'love');
  assert.ok(lv && lv.df > 0.25 * plan.docs && lv.artists >= 2, 'precondition: "love" is common and many-channel: ' + JSON.stringify(lv) + ' of ' + plan.docs);
  assert.ok(!plan.terms.some((x) => x.term === 'love'), 'the common word does not qualify');
  assert.ok(plan.terms.some((x) => x.term === 'kirby'), 'precondition: kirby still does');
  assert.strictEqual(love.filter((t) => plan.tierOf(t) === radio.TIER_SERIES).length, 0, 'no love theme is the series');
});

test('Q1: the series is weighed per channel by 1/sqrt(its songs) - a channel with 13 Kirby sets (Dean\'s NESTALGIA) plays most but never drowns the others', () => {
  const extra = [];
  for (let k = 0; k < 10; k += 1) extra.push(...K.set('NESTALGIA', 'NESTALGIA', 'Kirby Chill Set ' + (k + 1), '', ['Chill Cut A' + k, 'Chill Cut B' + k, 'Chill Cut C' + k, 'Chill Cut D' + k, 'Chill Cut E' + k, 'Chill Cut F' + k, 'Chill Cut G' + k, 'Chill Cut H' + k]));
  const lib = LIB.concat(extra);
  const members = lib.filter((t) => t.album === K.KIRBY_SETS.vapid);
  const profile = radio.buildStationProfile({ kind: 'album', value: store.albumKeyFor(members[0]) }, lib);
  const pool = lib.filter((t) => K.isKirby(t) && t.albumArtist !== 'Vapid');
  const nestShare = pool.filter((t) => t.albumArtist === 'NESTALGIA').length / pool.length;
  assert.ok(nestShare > 0.6, 'precondition: NESTALGIA is most of the Kirby: ' + nestShare.toFixed(2));
  let nest = 0; let series = 0;
  for (let r = 1; r <= 100; r += 1) {
    const trace = [];
    const picks = radio.pickRadioBatch(profile, lib, { exclude: [], queued: members.map((t) => t.id), count: 5, trace }, createSeededRng(r));
    picks.forEach((t, i) => { if (trace[i].tier === radio.TIER_SERIES) { series += 1; if (t.albumArtist === 'NESTALGIA') nest += 1; } });
  }
  // NESTALGIA ~100 series songs, the others 6-12: by songs ~0.85, by 1/sqrt(songs) per song ~0.65, equal per channel ~0.33
  assert.ok(nest / series < 0.75, 'NESTALGIA share of the series picks under 1/sqrt weighing: ' + nest + '/' + series);
  assert.ok(nest / series > 0.45, 'and still the biggest channel plays the most (no equal share per channel): ' + nest + '/' + series);
});

test('Q2: the first batch already mixes in other game music - one FAMILY slot of five, while the series still has songs (100 rng seeds)', () => {
  const [, seed, ctx0] = entryPoints(K.KIRBY_SETS.vapid)[0];
  const profile = radio.buildStationProfile(seed, LIB);
  let lastSlotGame = 0;
  for (let r = 1; r <= 100; r += 1) {
    const trace = [];
    radio.pickRadioBatch(profile, LIB, { exclude: [], queued: ctx0.queued, count: 5, trace }, createSeededRng(r));
    assert.deepStrictEqual(trace.slice(0, 4).map((x) => x.tier), [radio.TIER_SERIES, radio.TIER_SERIES, 1, radio.TIER_SERIES], 'seed ' + r + ': series, series, the seed artist, series');
    if (trace[4].tier === radio.TIER_GAME) lastSlotGame += 1;
  }
  assert.strictEqual(lastSlotGame, 100, 'the fifth slot is other game music: ' + lastSlotGame + '/100');
});

test('Q1: the series is OTHER sets - the seed album\'s own songs (not queued: the iPod album row) are the seed artist\'s one slot, never the series slots', () => {
  const members = albumOf(K.KIRBY_SETS.vapid);
  const ids = new Set(members.map((t) => t.id));
  const profile = radio.buildStationProfile({ kind: 'album', value: store.albumKeyFor(members[0]) }, LIB);
  let own = 0; let ownInSeries = 0;
  for (let r = 1; r <= 100; r += 1) {
    const trace = [];
    const picks = radio.pickRadioBatch(profile, LIB, { exclude: [], queued: [], count: 5, trace }, createSeededRng(r));
    picks.forEach((t, i) => { if (ids.has(t.id)) { own += 1; if (trace[i].tier === radio.TIER_SERIES) ownInSeries += 1; } });
  }
  assert.ok(own > 0, 'precondition: the album\'s own songs are drawn at all: ' + own);
  assert.strictEqual(ownInSeries, 0, 'the seed album in the series tier: ' + ownInSeries);
  assert.ok(own <= 100, 'at most the one artist slot per batch: ' + own + ' in 100 batches');
});

test('Q4 one rule for every entry point: an untagged album of a tagged artist draws the same ladder from its page Radio as from a song\'s Start radio', () => {
  const lib = LIB.concat(K.album('Indie Band', 'Tagged Record', 'Indie', 2004, ['T1', 'T2', 'T3', 'T4']), K.album('Indie Band', 'Untagged Record', '', 2006, ['U1', 'U2', 'U3']));
  const u = lib.filter((t) => t.album === 'Untagged Record');
  const albumP = radio.buildStationProfile({ kind: 'album', value: store.albumKeyFor(u[0]) }, lib);
  const songP = radio.buildStationProfile({ kind: 'track', value: u[0].id }, lib);
  assert.strictEqual(songP.genre, 'indie', 'precondition: the song borrows its artist\'s genre (v1.368.0)');
  assert.strictEqual(albumP.genre, 'indie', 'the album borrows it too');
  assert.strictEqual(radio.stationPlan(albumP, lib), null, 'both take the genre ladder');
  assert.strictEqual(radio.stationPlan(songP, lib), null);
});

test('gate r1 qa W1: series words are a GAME-MUSIC notion - a lofi "radio" channel never pulls Queen\'s "Radio Ga Ga", the Buggles or "Hip Hop Classics" (100 rng seeds, every entry point)', () => {
  const extra = [].concat(
    K.set('Lofi Girl', 'lofigirl', 'lofi hip hop radio - beats to relax/study to', 'Music', ['Lofi Cut 1', 'Lofi Cut 2', 'Lofi Cut 3', 'Lofi Cut 4', 'Lofi Cut 5', 'Lofi Cut 6']),
    K.set('Lofi Girl', 'lofigirl', 'synthwave radio', 'Music', ['Synth Cut 1', 'Synth Cut 2', 'Synth Cut 3', 'Synth Cut 4']),
    K.set('Chillhop Radio', 'chillhopradio', 'Chillhop Radio - jazzy and lofi hip hop beats', 'Music', ['Jazzy Cut 1', 'Jazzy Cut 2', 'Jazzy Cut 3', 'Jazzy Cut 4', 'Jazzy Cut 5', 'Jazzy Cut 6']),
    K.album('Queen', 'The Works', 'Rock', 1984, ['Radio Ga Ga', 'Hammer to Fall', 'I Want to Break Free']),
    K.album('The Buggles', 'The Age of Plastic', 'New Wave', 1980, ['Video Killed the Radio Star', 'Living in the Plastic Age']),
    K.album('The Sugarhill Gang', 'Hip Hop Classics', 'Hip-Hop', 1980, ['Rapper\'s Delight', 'Apache', '8th Wonder']));
  const lib = LIB.concat(extra);
  const far = new Set(['Queen', 'The Buggles', 'The Sugarhill Gang']);
  const members = lib.filter((t) => t.album === 'Chillhop Radio - jazzy and lofi hip hop beats');
  const ids = members.map((t) => t.id);
  const seeds = [['album page Radio', { kind: 'album', value: store.albumKeyFor(members[0]) }, ids, []], ['song Start radio', { kind: 'track', value: ids[0] }, ids, []], ['Autoplay after the album', { kind: 'track', value: ids[ids.length - 1] }, [], ids]];
  for (const [label, seed, queued, played] of seeds) {
    const profile = radio.buildStationProfile(seed, lib);
    const verdict = radio.stationPlan(profile, lib, { verdict: true });
    assert.ok(verdict && verdict.game === false, label + ': precondition: a junk-genre station that is not game music');
    assert.ok(verdict.allTerms.length > 0, label + ': precondition: it HAS candidate series words (' + verdict.allTerms.map((x) => x.term).join(', ') + ')');
    assert.strictEqual(radio.stationPlan(profile, lib), null, label + ': no series plan: the v1.368.0 tiers');
    let farPicks = 0; let picks = 0;
    for (let r = 1; r <= 100; r += 1) {
      const p = radio.pickRadioBatch(profile, lib, { exclude: played, queued, count: 5 }, createSeededRng(r));
      picks += p.length;
      farPicks += p.filter((t) => far.has(t.artist)).length;
    }
    assert.strictEqual(farPicks, 0, `${label}: Queen / Buggles / Sugarhill picks ${farPicks} of ${picks}`);
  }
});
