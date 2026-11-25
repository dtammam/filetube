'use strict';

// [UNIT] v1.410.0 "Remove from start" (plan docs/exec-plans/completed/2026-11-25-remove-from-start.md): the shared
// start the playlist picker suggests (sharedTitlePrefix) and its removal (removeTitleStart), as pure functions.

const { test } = require('node:test');
const assert = require('node:assert');
const { sharedTitlePrefix: shared, removeTitleStart: remove } = require('../../public/js/common.js');

const OST = 'Some Game Original Soundtrack - ';

test('Dean\'s shape: the soundtrack name and its separator, trailing space kept', () => {
  assert.strictEqual(shared([OST + 'Opening', OST + 'Battle', OST + 'Ending']), OST);
  assert.strictEqual(shared([OST + 'The Battle', OST + 'The End']), OST, 'cut back to the separator, not into the song names');
});

test('en dash, em dash, colon, pipe, tilde, middle dot and slash separate', () => {
  for (const sep of [' – ', ' — ', ': ', ' | ', ' ~ ', ' · ', ' / ', '—', ' -- ']) {
    assert.strictEqual(shared(['Game OST' + sep + 'Alpha', 'Game OST' + sep + 'Beta']), 'Game OST' + sep, JSON.stringify(sep));
  }
});

test('the LAST separator wins', () => {
  assert.strictEqual(shared(['Game - Disc 1 - Alpha', 'Game - Disc 1 - Beta']), 'Game - Disc 1 - ');
});

test('mixed case compares equal and keeps the first name\'s spelling', () => {
  assert.strictEqual(shared(['GAME OST - Alpha', 'game ost - Beta']), 'GAME OST - ');
});

test('fewer than two names suggests nothing', () => {
  assert.strictEqual(shared([OST + 'Opening']), '');
  assert.strictEqual(shared([]), '');
  assert.strictEqual(shared([OST + 'Opening', '', null]), '', 'empty names do not count');
});

test('"The ..." titles, and any shared start under 3 words with no separator, suggest nothing', () => {
  assert.strictEqual(shared(['The Battle', 'The End']), '');
  assert.strictEqual(shared(['Super Mario Bros', 'Super Mario Kart']), '');
  assert.strictEqual(shared(['Alpha', 'Beta']), '');
});

test('3 or more shared words with no separator: cut at the word boundary', () => {
  assert.strictEqual(shared(['My Great Game Opening', 'My Great Game Overworld']), 'My Great Game ');
});

test('a hyphen or slash inside a word is not a separator', () => {
  assert.strictEqual(shared(['Spider-Man Theme', 'Spider-Man Attack']), '');
  assert.strictEqual(shared(['Spider-Man', 'Spider-Woman']), '');
  assert.strictEqual(shared(['AC/DC Live', 'AC/DC Back']), '');
  assert.strictEqual(shared(['Re:Zero Opening', 'Re:Zero Ending']), '');
  assert.strictEqual(shared(['Spider-Man - Theme', 'Spider-Man - Attack']), 'Spider-Man - ', 'a spaced one after it still counts');
});

test('a prefix that would empty a name is not suggested', () => {
  assert.strictEqual(shared(['One Two Three', 'One Two Three Four']), '', 'one whole name');
  assert.strictEqual(shared(['Game - ', 'Game - Battle']), '', 'a name that is only the start');
});

test('removal: any case, leftover separators trimmed, a typed start without them', () => {
  assert.strictEqual(remove(OST + 'Opening', OST), 'Opening');
  assert.strictEqual(remove(OST + 'Opening', 'some game original soundtrack'), 'Opening');
  assert.strictEqual(remove('Game OST: Opening', 'Game OST'), 'Opening');
  assert.strictEqual(remove('Game OST — Opening', 'Game OST'), 'Opening');
});

test('removal: empty start, no match, or nothing left keeps the name', () => {
  assert.strictEqual(remove('- Intro', ''), '- Intro', 'an empty field never trims a leading dash');
  assert.strictEqual(remove('Bonus Track', OST), 'Bonus Track');
  assert.strictEqual(remove('Game OST - ', 'Game OST'), 'Game OST - ');
  assert.strictEqual(remove('Game OST', 'Game OST'), 'Game OST');
});
