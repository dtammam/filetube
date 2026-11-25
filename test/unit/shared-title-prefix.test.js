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
    // a ONE-word start: with a longer one the 3-word fallback returns the same string and binds nothing
    assert.strictEqual(shared(['OST' + sep + 'Alpha', 'OST' + sep + 'Beta']), 'OST' + sep, JSON.stringify(sep));
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

test('what counts as inside a word: letters or digits on BOTH sides of a tight - : middle dot or slash', () => {
  assert.strictEqual(shared(['OST)-Alpha', 'OST)-Beta']), 'OST)-', 'no letter before: a separator');
  assert.strictEqual(shared(['OST-(Alpha)', 'OST-(Beta)']), 'OST-', 'no letter after: a separator');
  assert.strictEqual(shared(['Col\u00b7legi A', 'Col\u00b7legi B']), '', 'middle dot inside a word');
  assert.strictEqual(shared(['24/7 Alpha', '24/7 Beta']), '', 'digits count');
  assert.strictEqual(shared(['Game\u2013Alpha', 'Game\u2013Beta']), 'Game\u2013', 'a tight en dash still separates');
});

test('a mark that opens the song\'s own name is neither suggested nor removed', () => {
  assert.strictEqual(shared(['Game OST ~Dawn~', 'Game OST ~Dusk~']), '');
  assert.strictEqual(shared(['Opening ~Dawn~', 'Opening ~Dusk~']), '');
  assert.strictEqual(shared(['Anime OST -Dawn-', 'Anime OST -Dusk-']), '');
  const names = ['Game OST - Alpha', 'Game OST - ~Reprise~', 'Game OST - -Epilogue-', 'Game OST - //Overture'];
  const start = shared(names);
  assert.strictEqual(start, 'Game OST - ');
  assert.deepStrictEqual(names.map((n) => remove(n, start)), ['Alpha', '~Reprise~', '-Epilogue-', '//Overture']);
  const wrapped = ['Some Game OST ~Dawn~', 'Some Game OST ~Night~'];
  assert.deepStrictEqual(wrapped.map((n) => remove(n, shared(wrapped))), ['~Dawn~', '~Night~']);
  assert.strictEqual(remove('Game OST ~Dawn~', 'Game OST'), '~Dawn~', 'a typed start without the space');
  assert.strictEqual(remove('OST:~Dawn~', 'OST:'), '~Dawn~', 'a start ending in its separator takes nothing more');
});

test('names that share words INSIDE their wrapping marks are not cut there', () => {
  const cases = [
    [['My Great Game ~Dawn of War~', 'My Great Game ~Dawn of Man~'], 'My Great Game '],
    [['Game OST - ~Song of the Sea~', 'Game OST - ~Song of the Wind~'], 'Game OST - '],
    [['Anime Opening Theme -Wings of Fire-', 'Anime Opening Theme -Wings of Ice-'], 'Anime Opening Theme '],
    [['Series - Game ~Act: One~', 'Series - Game ~Act: Two~'], 'Series - '],
    [['OST ~Dawn: War~', 'OST ~Dawn: Man~'], ''],
  ];
  for (const [names, want] of cases) assert.strictEqual(shared(names), want, names[0]);
  assert.strictEqual(remove('My Great Game ~Dawn of War~', 'My Great Game '), '~Dawn of War~');
});

test('removal takes each leftover separator and trims', () => {
  for (const sep of [' - ', ' \u2013 ', ' \u2014 ', ': ', ' | ', ' ~ ', ' \u00b7 ', ' / ', '-', ':']) {
    assert.strictEqual(remove('Game OST' + sep + 'Alpha', 'Game OST'), 'Alpha', JSON.stringify(sep));
  }
  assert.strictEqual(remove('Game OST - Alpha ', 'Game OST - '), 'Alpha');
});

test('a prefix that would empty a name is not suggested', () => {
  assert.strictEqual(shared(['One Two Three', 'One Two Three Four']), '', 'one whole name: only 2 words stand before its last');
  assert.strictEqual(shared(['Game - ', 'Game - Battle']), '', 'a name that is only the start');
  assert.strictEqual(shared(['My Great Game -', 'My Great Game Over']), '', 'a name with only a separator after the start');
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
