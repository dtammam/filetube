'use strict';

// [UNIT] v1.63 - the playback queue chrome's pure client decisions
// (public/js/common.js): button-existence predicate, badge formatter, and
// the entry -> row-model mappers incl. the played/playing ordered pass
// (ruling 6: rows before the pointer dim as played, the pointer row
// highlights, rows after are neither). The DOM injector is the usual
// untested-by-necessity thin shell; integration + Dean's device probes
// cover it. Fixture spellings divergent per v1.41.9.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  shouldShowQueueButton,
  formatQueueBadge,
  buildQueueRowModel,
  buildQueueRowModels,
  queueEntryHref,
} = require('../../public/js/common.js');

const entry = (uid, over = {}) => ({
  uid, mediaId: `mëdia-${uid}`,
  item: { title: `Tïtle ${uid}`, channelName: `Chän ${uid}`, folderName: 'Föld', hasThumbnail: true, ...over },
});

test('shouldShowQueueButton: exists ONLY while entries do (ruling 4)', () => {
  assert.equal(shouldShowQueueButton({ entries: [entry('a')] }), true);
  assert.equal(shouldShowQueueButton({ entries: [] }), false);
  assert.equal(shouldShowQueueButton({}), false);
  assert.equal(shouldShowQueueButton(null), false);
  assert.equal(shouldShowQueueButton({ entries: 'nope' }), false);
});

test('formatQueueBadge: empty at zero/garbage, 20+ cap (the bell convention)', () => {
  assert.equal(formatQueueBadge(0), '');
  assert.equal(formatQueueBadge(3), '3');
  assert.equal(formatQueueBadge(20), '20');
  assert.equal(formatQueueBadge(21), '20+');
  assert.equal(formatQueueBadge('4'), '');
  assert.equal(formatQueueBadge(-1), '');
});

test('buildQueueRowModel: field ladder (channelName > folderName > Library), thumb only when hasThumbnail, null on malformed', () => {
  const m = buildQueueRowModel(entry('ä1'), null);
  // Gate S6: percent-encode at ONE URL layer - the href carries the
  // encoded id (the divergent non-ASCII fixture is exactly what proves it).
  assert.equal(m.href, `/watch.html?v=${encodeURIComponent('mëdia-ä1')}`);
  assert.equal(m.channelLabel, 'Chän ä1');
  assert.equal(m.thumbnailUrl, '/thumbnail/mëdia-ä1');
  const folded = buildQueueRowModel(entry('b2', { channelName: '  ' }), null);
  assert.equal(folded.channelLabel, 'Föld', 'whitespace channelName falls to folderName');
  const bare = buildQueueRowModel(entry('c3', { channelName: '', folderName: '', hasThumbnail: false }), null);
  assert.equal(bare.channelLabel, 'Library');
  assert.equal(bare.thumbnailUrl, null);
  assert.equal(buildQueueRowModel({ uid: 'x' }, null), null, 'item-less entries drop');
  assert.equal(buildQueueRowModel({ uid: '', item: {} }, null), null);
  assert.equal(buildQueueRowModel(null, null), null);
});

test('buildQueueRowModels: the ordered played/playing pass (ruling 6)', () => {
  const q = { entries: [entry('p1'), entry('p2'), entry('p3')], pointerUid: 'p2' };
  const [a, b, c] = buildQueueRowModels(q);
  assert.deepEqual([a.played, a.playing], [true, false], 'before the pointer: played');
  assert.deepEqual([b.played, b.playing], [false, true], 'the pointer row: playing');
  assert.deepEqual([c.played, c.playing], [false, false], 'after: neither');
});

test('buildQueueRowModels: no pointer = not-started (nothing played, nothing playing)', () => {
  const models = buildQueueRowModels({ entries: [entry('n1'), entry('n2')], pointerUid: null });
  assert.ok(models.every((m) => !m.played && !m.playing));
});

test('buildQueueRowModels: a DROPPED pointer row (item-less) still ends the played span', () => {
  const q = { entries: [entry('d1'), { uid: 'd2', mediaId: 'gone' }, entry('d3')], pointerUid: 'd2' };
  const models = buildQueueRowModels(q);
  assert.equal(models.length, 2, 'the item-less row itself drops');
  assert.deepEqual(models.map((m) => m.played), [true, false], 'd1 played, d3 after the (dropped) pointer');
});

test('formatQueuePosition: ordinals incl. the 11th/12th/13th trap (gate S1)', () => {
  const { formatQueuePosition } = require('../../public/js/common.js');
  assert.equal(formatQueuePosition(1), '1st');
  assert.equal(formatQueuePosition(2), '2nd');
  assert.equal(formatQueuePosition(3), '3rd');
  assert.equal(formatQueuePosition(4), '4th');
  assert.equal(formatQueuePosition(11), '11th');
  assert.equal(formatQueuePosition(12), '12th');
  assert.equal(formatQueuePosition(13), '13th');
  assert.equal(formatQueuePosition(21), '21st');
  assert.equal(formatQueuePosition(22), '22nd');
  assert.equal(formatQueuePosition(23), '23rd');
  assert.equal(formatQueuePosition(111), '111th');
  assert.equal(formatQueuePosition(0), '');
  assert.equal(formatQueuePosition('3'), '');
});

// ---- v1.71 T6: kind-aware entries -------------------------------------------

test('SOURCE-LOCK (gate W5): both ended flows advance through the ONE queue seam, whose href is kind-derived and whose watch seed is media-only', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const playerSrc = fs.readFileSync(path.join(__dirname, '../../public/js/player.js'), 'utf8');
  assert.ok(playerSrc.includes('function advanceIntoQueueEntry(queueNext)'), 'the shared advance seam exists');
  const calls = playerSrc.match(/advanceIntoQueueEntry\(queueNext\);/g) || [];
  assert.ok(calls.length >= 2, `BOTH ended flows (trackNav + video autoplay) call the seam, found ${calls.length}`);
  const seamStart = playerSrc.indexOf('function advanceIntoQueueEntry');
  const seam = playerSrc.slice(seamStart, playerSrc.indexOf('function handleAutoplayNext', seamStart));
  assert.ok(seam.includes('window.FileTube.queueEntryHref(queueNext)'), 'the destination derives from the shared kind-aware helper');
  assert.ok(seam.includes("queueNext.kind !== 'podcast'"), 'the watch seed is suppressed for podcast entries');
  assert.ok(seam.includes('window.FileTube.navigate(advanceHref)'), 'and the derived href is what actually navigates');
  const watchSrc = fs.readFileSync(path.join(__dirname, '../../public/js/watch.js'), 'utf8');
  assert.ok(watchSrc.includes('window.FileTube.queueEntryHref(next)'), 'the up-next box derives via the shared helper too');
  // Gate S10: the queue panel's row-tap seed gate (the 5th consumer).
  const commonSrc = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
  const tapIdx = commonSrc.indexOf("if (m.kind !== 'podcast') {");
  assert.ok(tapIdx >= 0, 'the panel row tap gates its watch seed on kind');
  assert.ok(commonSrc.indexOf('stashWatchSeed({', tapIdx) > tapIdx, 'and the seed sits INSIDE that gate');
});

test('SOURCE-LOCK (gate W1): the trackNav ended path consults the queue before falling back to the show list', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const playerSrc = fs.readFileSync(path.join(__dirname, '../../public/js/player.js'), 'utf8');
  const branchStart = playerSrc.indexOf('currentData.autoAdvanceViaTrackNav) {');
  assert.ok(branchStart >= 0, 'the trackNav branch exists');
  const branch = playerSrc.slice(branchStart, playerSrc.indexOf("fetch('/api/settings')", branchStart));
  assert.ok(branch.includes("fetch('/api/queue')"), 'the branch consults the queue');
  assert.ok(branch.includes('pointerEntry.mediaId === endedId'), 'queue precedence keys on THIS item being the now-playing entry');
  assert.ok(branch.includes('fallbackToTrackNav'), 'and the show-list flow survives as the fallback');
  assert.ok(branch.indexOf("fetch('/api/queue')") < branch.indexOf('fallbackToTrackNav();'), 'consult-first ordering, not mere presence');
});

test('v1.71 queueEntryHref: podcast -> /podcasts?play=, media/absent-kind -> /watch.html?v=, encoded; null on garbage', () => {
  assert.equal(queueEntryHref({ mediaId: 'ep"1', kind: 'podcast' }), '/podcasts?play=ep%221');
  assert.equal(queueEntryHref({ mediaId: 'vid1', kind: 'media' }), '/watch.html?v=vid1');
  assert.equal(queueEntryHref({ mediaId: 'vid1' }), '/watch.html?v=vid1', 'a legacy kind-less entry stays a media link');
  assert.equal(queueEntryHref({ kind: 'podcast' }), null);
  assert.equal(queueEntryHref(null), null);
});

test('v1.71 buildQueueRowModel: a podcast entry links the podcasts place and shows the SHOW cover, never /thumbnail', () => {
  const m = buildQueueRowModel({
    uid: 'ü1', mediaId: 'ëp-9', kind: 'podcast',
    item: { title: 'Ëp Title', channelName: 'Thë Show', artUrl: '/podcastart/süb-1', hasThumbnail: false },
  }, null);
  assert.equal(m.kind, 'podcast');
  assert.equal(m.href, '/podcasts?play=' + encodeURIComponent('ëp-9'));
  assert.equal(m.thumbnailUrl, '/podcastart/süb-1', 'the server-named art, not a thumbnail route');
  assert.equal(m.channelLabel, 'Thë Show');
  // The USE bind's mutant: a podcast entry must NEVER fall through to the
  // media thumb contract even when hasThumbnail lies true.
  const lying = buildQueueRowModel({ uid: 'ü2', mediaId: 'ëp-9', kind: 'podcast', item: { title: 'T', hasThumbnail: true } }, null);
  assert.equal(lying.thumbnailUrl, null, 'no artUrl -> no art; hasThumbnail is a media-only field');
});

test('v1.71 buildQueueRowModel: media entries are BYTE-COMPATIBLE with pre-v1.71 rows (plus the explicit kind)', () => {
  const m = buildQueueRowModel(entry('a'), null);
  assert.equal(m.kind, 'media');
  assert.equal(m.href, '/watch.html?v=' + encodeURIComponent('mëdia-a'));
  assert.equal(m.thumbnailUrl, '/thumbnail/mëdia-a');
});

test('buildQueueRowModels: a FULLY-dangling pointer dims nothing (gate S4 - not-started semantics)', () => {
  const { buildQueueRowModels } = require('../../public/js/common.js');
  const entry = (uid) => ({ uid, mediaId: 'm-' + uid, item: { title: uid } });
  const models = buildQueueRowModels({ entries: [entry('g1'), entry('g2')], pointerUid: 'vanished' });
  assert.ok(models.every((m) => !m.played && !m.playing), 'dangling -> nothing played, nothing playing');
});
