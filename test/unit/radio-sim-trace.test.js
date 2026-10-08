'use strict';

// [UNIT] v1.375.0: tools/radio-sim/simulate.js --trace, the read-only instrument Dean runs on production to
// calibrate the series-first radio before his device check (plan docs/exec-plans/active/2026-10-08-v1375-radio-like-radio.md).
// It must run the REAL picker and print the NEW tiers per entry point; a trace that silently fell back to
// the genre ladder (or lost the series words) would calibrate nothing. Driven on the Kirby-shaped library
// with a play history whose session before the album is Pop.

const { test } = require('node:test');
const assert = require('node:assert');
const radio = require('../../lib/music/radio');
const K = require('../helpers/radio-kirby-library');

process.env.RADIO_SIM_NO_MAIN = '1';
const sim = require('../../tools/radio-sim/simulate.js');
delete process.env.RADIO_SIM_NO_MAIN;

test('the --trace prints the series ladder, its words, the game family and every entry point\'s tiers - and the Pop session no longer steers it', () => {
  const list = K.buildLibrary();
  const prince = list.filter((t) => t.artist === 'Prince').slice(0, 24);
  const kirby = list.filter((t) => t.album === K.KIRBY_SETS.vapid);
  const at = (k) => new Date(Date.UTC(2026, 9, 7, 20, k)).toISOString();
  const history = prince.map((t, k) => ({ user: 'dean', id: t.id, at: at(k) })).concat([{ user: 'dean', id: kirby[0].id, at: at(40) }]);
  const out = sim.traceAlbum(list, { trace: 'happy and underrated kirby', why: 'prince' }, radio, { history });
  for (const line of [
    'ALBUMS whose title or album artist contains "happy and underrated kirby": 1',
    'album page Radio / iPod album row: genre=null category="gaming"',
    '-> SERIES ladder, game music: YES',
    'series words (of ',
    '"kirby" album',
    'rejected words: ',
    'game-music family ',
    'song Start radio (1st song)',
    'Autoplay after the album',
    'were mostly "pop" (v1.368.0 anchored a no-genre station on that; v1.375.0 never does)',
    'D album page Radio after that session: genre=null',
  ]) assert.ok(out.includes(line), 'the trace prints: ' + line + '\n---\n' + out);
  // the tiers are the picker's own: the series tier is drawn first, Prince never
  const firstPicks = out.split('\n').filter((l) => l.includes('first pick by tier'));
  assert.strictEqual(firstPicks.length, 4, 'one line per entry point');
  for (const l of firstPicks) {
    assert.ok(/first pick by tier \(50 draws\): S 50 \|/.test(l), 'the first pick is the series in all 50 draws: ' + l);
    assert.ok(l.includes('"prince" first 0/50, in the batch 0/50'), 'no Prince: ' + l);
  }
  assert.ok(/a 10-batch session, tiers per batch: S\S{4}/.test(out), 'the session path is printed');
});
