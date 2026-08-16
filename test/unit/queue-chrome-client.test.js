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
  // v1.72: the guard names media POSITIVELY - podcast AND track entries
  // must both suppress the watch seed (they never visit the watch page).
  assert.ok(seam.includes("(queueNext.kind || 'media') === 'media'"), 'the watch seed fires for media entries only');
  assert.ok(seam.includes('window.FileTube.navigate(advanceHref)'), 'and the derived href is what actually navigates');
  const watchSrc = fs.readFileSync(path.join(__dirname, '../../public/js/watch.js'), 'utf8');
  assert.ok(watchSrc.includes('window.FileTube.queueEntryHref(next)'), 'the up-next box derives via the shared helper too');
  // Gate S10 (tightened per QA S4: containment, not adjacency - the seed
  // call is the gate's FIRST statement, so moving it below the closed gate
  // cannot pass).
  const commonSrc = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
  // v1.72: the gate is media-POSITIVE now (tracks joined the kinds).
  assert.ok(commonSrc.includes("if ((m.kind || 'media') === 'media') {\n              stashWatchSeed({"), 'the panel row tap\'s watch seed sits INSIDE the media-positive kind gate');
});

test('SOURCE-LOCK (gate W1): the trackNav ended path consults the queue before falling back to the show list', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const playerSrc = fs.readFileSync(path.join(__dirname, '../../public/js/player.js'), 'utf8');
  const branchStart = playerSrc.indexOf('currentData.autoAdvanceViaTrackNav) {');
  assert.ok(branchStart >= 0, 'the trackNav branch exists');
  // v1.72 (#91): the branch now carries its OWN settings fetch (the
  // cross-kind consult), so the slice ends at the VIDEO path's marker
  // comment instead of the first settings fetch.
  const branch = playerSrc.slice(branchStart, playerSrc.indexOf("OFF (default)", branchStart));
  assert.ok(branch.includes("fetch('/api/queue')"), 'the branch consults the queue');
  assert.ok(branch.includes('pointerEntry.mediaId === endedId'), 'queue precedence keys on THIS item being the now-playing entry');
  assert.ok(branch.includes('fallbackToTrackNav'), 'and the show-list flow survives as the fallback');
  assert.ok(branch.indexOf("fetch('/api/queue')") < branch.indexOf('fallbackToTrackNav();'), 'consult-first ordering, not mere presence');
  // v1.72 (#91): same-kind advances stay unconditional; a cross-kind
  // advance consults autoplayNext and falls back IN-CONTEXT when OFF.
  assert.ok(branch.includes("var sameKind = (queueNext.kind || 'media') === (pointerEntry.kind || 'media');"), 'kind comparison is entry-kind vs entry-kind, never inferred');
  const sameKindIdx = branch.indexOf('if (sameKind)');
  const crossConsultIdx = branch.indexOf("fetch('/api/settings')");
  assert.ok(sameKindIdx >= 0 && crossConsultIdx > sameKindIdx, 'the unconditional same-kind advance precedes the cross-kind consult');
  assert.ok(branch.includes('if (settings && settings.autoplayNext) { advanceIntoQueueEntry(queueNext); return; }'), 'ON advances cross-kind');
  const crossTail = branch.slice(crossConsultIdx);
  assert.ok(crossTail.includes('fallbackToTrackNav();'), 'OFF (or unreachable settings) falls back to the in-context flow');
});

test('v1.71 queueEntryHref: podcast -> /podcasts?play=, media/absent-kind -> /watch.html?v=, encoded; null on garbage', () => {
  assert.equal(queueEntryHref({ mediaId: 'ep"1', kind: 'podcast' }), '/podcasts?play=ep%221');
  assert.equal(queueEntryHref({ mediaId: 'vid1', kind: 'media' }), '/watch.html?v=vid1');
  assert.equal(queueEntryHref({ mediaId: 'vid1' }), '/watch.html?v=vid1', 'a legacy kind-less entry stays a media link');
  assert.equal(queueEntryHref({ kind: 'podcast' }), null);
  assert.equal(queueEntryHref(null), null);
});

test('v1.72 queueEntryHref + row model: a track entry links /music?play= and shows the ALBUM art, never /thumbnail', () => {
  assert.equal(queueEntryHref({ mediaId: 'trk"7', kind: 'track' }), '/music?play=trk%227');
  const m = buildQueueRowModel({
    uid: 'ü2', mediaId: 'trk-7', kind: 'track',
    item: { title: 'Söng', channelName: 'Thë Artist', artUrl: '/albumart/trk-7', hasThumbnail: false },
  }, null);
  assert.equal(m.kind, 'track', 'kind survives the model (never collapsed to media)');
  assert.equal(m.href, '/music?play=' + encodeURIComponent('trk-7'));
  assert.equal(m.thumbnailUrl, '/albumart/trk-7', 'album art rides the artUrl arm');
  assert.equal(m.channelLabel, 'Thë Artist');
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

test('v1.72 QA W1 bind: every context-list consumer filters to MEDIA before building orderedIds (the mixed /api/liked never 404s a watch hop)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const filter = "(it.kind === undefined || it.kind === 'media')";
  const watchSrc = fs.readFileSync(path.join(__dirname, '../../public/js/watch.js'), 'utf8');
  const watchHits = watchSrc.split(filter).length - 1;
  assert.strictEqual(watchHits, 2, 'watch.js: BOTH the ctx path and the legacy liked path filter (two consumers, two filters)');
  const playerSrc = fs.readFileSync(path.join(__dirname, '../../public/js/player.js'), 'utf8');
  assert.ok(playerSrc.includes("return it && (it.kind === undefined || it.kind === 'media');"), 'player.js: the autoplay context advance filters too');
  // Ordering, not mere presence: the filter runs BEFORE orderedIds derive.
  const ctxIdx = watchSrc.indexOf(filter);
  assert.ok(ctxIdx >= 0 && ctxIdx < watchSrc.indexOf('orderedIds = allFiles.map'), 'filter precedes the id-order build');
});

test('v1.72 QA W3 bind: the cross-kind consult re-checks staleness AFTER the settings hop (the C6 lesson)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const playerSrc = fs.readFileSync(path.join(__dirname, '../../public/js/player.js'), 'utf8');
  const branchStart = playerSrc.indexOf('currentData.autoAdvanceViaTrackNav) {');
  const branch = playerSrc.slice(branchStart, playerSrc.indexOf('OFF (default)', branchStart));
  const consultIdx = branch.indexOf("fetch('/api/settings')");
  const tail = branch.slice(consultIdx);
  const recheckIdx = tail.indexOf('if (currentId !== endedId) return;');
  const actIdx = tail.indexOf('advanceIntoQueueEntry(queueNext)');
  assert.ok(recheckIdx >= 0, 'the staleness re-check exists inside the consult');
  assert.ok(actIdx > recheckIdx, 'and it runs BEFORE any action (pointer moves are server state)');
});

test('v1.73 (Dean device bug): the watch Prev/Next QUEUE arm dispatches by kind - non-media entries ride queueEntryHref, never navigateToWatch', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const watchSrc = fs.readFileSync(path.join(__dirname, '../../public/js/watch.js'), 'utf8');
  const seamStart = watchSrc.indexOf('const goQueueEntry = (entry) => {');
  assert.ok(seamStart >= 0, 'the queue-entry navigation seam exists');
  const seam = watchSrc.slice(seamStart, watchSrc.indexOf('let effNext', seamStart));
  assert.ok(seam.includes("(entry.kind || 'media') !== 'media'"), 'the kind gate exists (absent kind = legacy media)');
  const gateIdx = seam.indexOf("(entry.kind || 'media') !== 'media'");
  const hrefIdx = seam.indexOf('window.FileTube.queueEntryHref(entry)');
  const stashIdx = seam.indexOf('stashWatchSeed(entry.item)');
  const navIdx = seam.indexOf('navigateToWatch(entry.mediaId)');
  assert.ok(hrefIdx > gateIdx, 'non-media destination derives from the ONE kind-aware helper');
  assert.ok(seam.slice(gateIdx, stashIdx).includes('return;'), 'the non-media arm RETURNS before the watch seed and the watch nav');
  assert.ok(navIdx > stashIdx, 'the media arm keeps its seed-then-navigate order');
});

test('v1.73 (ruling 6): the audio Prev/Next pair - queue-aware steps, audio-mode-only visibility, every shell carries the buttons', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const playerSrc = fs.readFileSync(path.join(__dirname, '../../public/js/player.js'), 'utf8');
  // The manual step: queue-first with the staleness re-check, context fallback.
  const stepStart = playerSrc.indexOf('function manualTrackStep(dir)');
  assert.ok(stepStart >= 0, 'manualTrackStep exists');
  const step = playerSrc.slice(stepStart, playerSrc.indexOf('function setTrackNav', stepStart));
  assert.ok(step.includes('if (currentId !== steppedId) return;'), 'staleness re-checked after the queue fetch (the C6 law)');
  assert.ok(step.includes('pointerEntry.mediaId === steppedId && neighbor'), 'queue precedence keys on the CURRENT item being now-playing');
  assert.ok(step.includes('advanceIntoQueueEntry(neighbor)'), 'a queue step rides the ONE kind-aware advance seam');
  assert.ok(step.indexOf('advanceIntoQueueEntry') < step.indexOf('trackNavHandlers && (dir'), 'queue consult precedes the context fallback');
  // Visibility (v1.73 round 1, adversarial W2 + QA W1): the WHOLE show
  // expression is bound - audio mode AND a registered context AND the
  // v1.133 (Dean, supersedes the v1.73 three-conjunct audio-only gate): the
  // pair shows for EVERY kind whenever a trackNav context is registered -
  // the exact one-term expression is the lock. Re-adding an audio-mode or
  // kind-marker conjunct (re-hiding the pair for video) goes red here.
  assert.ok(playerSrc.includes('var show = !!trackNavHandlers;'),
    'the exact show expression - trackNav registration alone');
  assert.ok(!playerSrc.includes('audioMode && !!trackNavHandlers'),
    'the v1.73 audio-only conjunct chain must be gone, not merely bypassed');
  assert.ok((playerSrc.match(/updateTrackNavButtons\(\);/g) || []).length >= 3, 'setTrackNav + BOTH audio-mode toggle sites update visibility');
  // Adversarial W3: dead-button class - the CLICK wiring is bound.
  assert.ok(playerSrc.includes("if (trackPrevBtn) trackPrevBtn.addEventListener('click', function () { manualTrackStep('prev'); });"), 'prev wired');
  assert.ok(playerSrc.includes("if (trackNextBtn) trackNextBtn.addEventListener('click', function () { manualTrackStep('next'); });"), 'next wired');
  // Adversarial W4: shown buttons stay ENABLED - a context-edge tap must
  // reach the queue consult (the queue owns up-next).
  assert.ok(playerSrc.includes('trackPrevBtn.disabled = false;') && playerSrc.includes('trackNextBtn.disabled = false;'),
    'no handler-presence disable - the queue stays reachable at list edges');
  // Every shell carries the pair (the every-writer rule).
  const pub = path.join(__dirname, '../../public');
  const shells = fs.readdirSync(pub).filter((f) => f.endsWith('.html'))
    .filter((f) => fs.readFileSync(path.join(pub, f), 'utf8').includes('player-host-template'));
  assert.ok(shells.length >= 8, `expected the full template roster, found ${shells.length}`);
  for (const f of shells) {
    const html = fs.readFileSync(path.join(pub, f), 'utf8');
    assert.ok(html.includes('id="track-prev-btn"') && html.includes('id="track-next-btn"'), `${f}: missing the track-nav pair`);
  }
  // The [hidden]-vs-display enforcement (the v1.44 class).
  const css = fs.readFileSync(path.join(pub, 'css/style.css'), 'utf8');
  assert.ok(css.includes('.track-nav-btn[hidden] { display: none !important; }'), 'pc-btn inline-flex would beat [hidden] without the enforcement rule');
  assert.ok(css.includes('#player-dock #track-prev-btn'), 'the dock never shows the pair (full view only - the ruling)');
});
