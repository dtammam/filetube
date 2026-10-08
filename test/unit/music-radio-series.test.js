'use strict';

// [UNIT] v1.375.0 "radio that feels like radio" (plan docs/exec-plans/active/2026-10-08-v1375-radio-like-radio.md,
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
      assert.ok(channels.length >= 4, `${where}: Kirby from several channels: ${JSON.stringify(byChannel)}`);
      assert.ok(top / kirbyPicks < 0.5, `${where}: no one channel is half the Kirby (not only NESTALGIA): ${JSON.stringify(byChannel)}`);
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

test('Q4: when the series runs out the station moves to OTHER GAME MUSIC before any real genre, and the whole library comes last (20 long sessions)', () => {
  const [, seed, ctx0] = entryPoints(K.KIRBY_SETS.vapid)[0];
  const profile = radio.buildStationProfile(seed, LIB);
  const plan = radio.stationPlan(profile, LIB);
  const closeIds = LIB.filter((t) => [radio.TIER_SERIES, radio.TIER_GAME, 1].includes(plan.tierOf(t)) && !ctx0.queued.includes(t.id)).map((t) => t.id);
  assert.ok(closeIds.length > 150, 'precondition: a big game-music pool (' + closeIds.length + ')');
  for (let r = 1; r <= 20; r += 1) {
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
  assert.ok(songPlan.seriesScore(vapidGreens) > songPlan.seriesScore(LIB.find((t) => t.title === 'Halberd')), 'sharing more series words weighs more');
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
