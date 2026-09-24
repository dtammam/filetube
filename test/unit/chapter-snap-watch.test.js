'use strict';

// [UNIT] v1.319 Chapter Snap gate r1 (adversary W4, qa W2): the WATCH page, driven
// through the REAL player.js in jsdom (the player-immersive-lock-grace harness shape):
// every chapter save on the page - the time editor's save AND the text editor's save -
// must re-derive EVERYTHING keyed to the chapter list, not just the menu: the seek-bar
// notches move to the new boundaries and the current-chapter label re-derives from the
// NEW starts while PAUSED (the audition pauses the player, so paused is the normal
// state). Behavioral - the notch `left` % and the label text - never a source regex.
// Also bound here: the text editor is seeded LOSSLESSLY (a 25.75 s start reads
// "0:25.75", adversary W1) and carries the chapters' version token (adversary S8).

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const PUB = path.join(__dirname, '..', '..', 'public');
const LOCK_SRC = fs.readFileSync(path.join(PUB, 'js', 'body-scroll-lock.js'), 'utf8');
const COMMON_SRC = fs.readFileSync(path.join(PUB, 'js', 'common.js'), 'utf8');
const PLAYER_SRC = fs.readFileSync(path.join(PUB, 'js', 'player.js'), 'utf8');
const WATCH = fs.readFileSync(path.join(PUB, 'watch.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');

function lift(name) {
  const start = COMMON_SRC.indexOf('function ' + name + '(');
  assert.notStrictEqual(start, -1, name + ' exists in common.js');
  return COMMON_SRC.slice(start, COMMON_SRC.indexOf('\n}\n', start) + 3);
}

let dom = null;
afterEach(() => { if (dom) { dom.window.close(); dom = null; } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(item, playhead) {
  dom = new JSDOM(WATCH, { url: 'http://localhost/watch.html?v=' + item.id, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
  w.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.load = function () {};
  Object.defineProperty(w.HTMLMediaElement.prototype, 'duration', { configurable: true, get: () => item.duration });
  Object.defineProperty(w.HTMLMediaElement.prototype, 'currentTime', { configurable: true, get: () => playhead, set: () => {} });
  Object.defineProperty(w.HTMLMediaElement.prototype, 'paused', { configurable: true, get: () => true });
  w.fetchCurrentUser = () => Promise.resolve({ user: { role: 'admin' } }); // the write-RBAC probe
  const seen = { snap: [], text: [] };
  w.showChapterSnapEditor = (id, opts) => { seen.snap.push({ id, opts }); };
  w.showChaptersEditor = (id, lines, onSaved, doc, opts) => { seen.text.push({ id, lines, onSaved, opts }); };
  w.eval(lift('resolveAudioArtUrl'));
  w.eval(lift('formatDuration'));
  w.eval(lift('formatChapterStamp'));
  w.eval(LOCK_SRC);
  w.eval(PLAYER_SRC);
  const slot = w.document.createElement('div'); slot.id = 'player-slot'; w.document.body.appendChild(slot);
  assert.strictEqual(w.FileTube.player.load(item.id, item, { slot }), true, 'the real player loaded the item');
  await wait(30);
  const doc = w.document;
  const notches = () => Array.from(doc.querySelectorAll('.seek-chapters-gap')).map((n) => Number(parseFloat(n.style.left).toFixed(2)));
  const label = () => doc.querySelector('.chapter-now').textContent;
  const openMenu = () => { doc.querySelector('.chapter-now').click(); };
  return { w, doc, seen, notches, label, openMenu };
}

const ITEM = () => ({
  id: 'v1', title: 'The Mix', type: 'video', ext: '.mp4', duration: 60,
  chapters: [{ startTime: 0, title: 'One' }, { startTime: 20, title: 'Two' }, { startTime: 40, title: 'Three' }],
  chaptersEdited: false, chaptersVersion: 'ver-1',
});

test('a TIME-editor save re-segments the seek bar and re-derives the playing chapter while PAUSED; the Edited badge follows', async () => {
  const P = await boot(ITEM(), 22);
  assert.deepStrictEqual(P.notches(), [33.33, 66.67], 'precondition: notches at the stored boundaries');
  assert.strictEqual(P.label(), 'Two', 'precondition: at 22 s (paused) the playhead is in chapter 2');
  P.openMenu();
  const entry = P.doc.querySelector('.chapters-menu-snap');
  assert.ok(entry, 'the "Fix chapter times" entry is offered to a modifier');
  assert.strictEqual(P.doc.querySelector('.chapters-menu-edited'), null, 'no Edited badge before a correction (populated below)');
  entry.click();
  assert.strictEqual(P.seen.snap.length, 1);
  assert.strictEqual(P.seen.snap[0].id, 'v1');
  assert.strictEqual(P.seen.snap[0].opts.focusIndex, 1, 'opened on the playing chapter');
  // The save moved chapter 2 to 25.75 s: at 22 s the playhead is now in chapter 1.
  P.seen.snap[0].opts.onSaved({ chapters: [{ startTime: 0, title: 'One' }, { startTime: 25.75, title: 'Two' }, { startTime: 40, title: 'Three' }], chaptersSource: 'manual', chaptersEdited: true, version: 'ver-2' });
  assert.deepStrictEqual(P.notches(), [42.92, 66.67], 'the notch moved to the NEW boundary');
  assert.strictEqual(P.label(), 'One', 'the label re-derived from the new starts while paused');
  P.openMenu();
  assert.ok(P.doc.querySelector('.chapters-menu-edited'), 'the Edited badge shows');
  // The text editor is now seeded LOSSLESSLY and carries the new version token.
  P.doc.querySelector('.chapters-menu-edit:not(.chapters-menu-snap)').click();
  assert.strictEqual(P.seen.text.length, 1);
  assert.strictEqual(P.seen.text[0].lines, '0:00 One\n0:25.75 Two\n0:40 Three', 'no flooring (0:25.75, never 0:25)');
  assert.strictEqual(P.seen.text[0].opts.version, 'ver-2', 'the text save carries the version from the last save');
  // A text save (plain typed list) re-derives everything too, and clears the badge.
  P.seen.text[0].onSaved({ chapters: [{ startTime: 0, title: 'One' }, { startTime: 10, title: 'Two' }, { startTime: 40, title: 'Three' }], chaptersSource: 'manual', chaptersEdited: false, version: 'ver-3' });
  assert.deepStrictEqual(P.notches(), [16.67, 66.67], 'the text save moved the notch as well');
  assert.strictEqual(P.label(), 'Two', 'and re-derived the chapter (22 s is in chapter 2 again)');
  P.openMenu();
  assert.strictEqual(P.doc.querySelector('.chapters-menu-edited'), null, 'the badge CLEARS on a plain typed save (the populated clear axis)');
});

test('a save for an item the player has LEFT is ignored (the post-await guard)', async () => {
  const P = await boot(ITEM(), 22);
  P.openMenu();
  P.doc.querySelector('.chapters-menu-snap').click();
  P.w.FileTube.player.load('v2', { id: 'v2', title: 'Other', type: 'video', ext: '.mp4', duration: 60, chapters: [{ startTime: 0, title: 'A' }, { startTime: 30, title: 'B' }] }, { slot: P.doc.getElementById('player-slot') });
  await wait(30);
  assert.deepStrictEqual(P.notches(), [50], 'precondition: the other item is loaded');
  P.seen.snap[0].opts.onSaved({ chapters: [{ startTime: 0, title: 'One' }, { startTime: 5, title: 'Two' }, { startTime: 40, title: 'Three' }], chaptersEdited: true });
  assert.deepStrictEqual(P.notches(), [50], 'the late save did not paint v1\'s chapters over v2');
});

test('the LATE-DETAIL path (watch.js seeded pre-load -> applyLateDetail) carries the Edited flag and the version into the loaded item', async () => {
  const seedItem = ITEM();
  delete seedItem.chaptersEdited; delete seedItem.chaptersVersion; delete seedItem.chapters; // the list-data seed
  const P = await boot(seedItem, 22);
  P.w.FileTube.player.applyLateDetail('v1', { id: 'v1', chapters: ITEM().chapters, chaptersEdited: true, chaptersVersion: 'ver-late' });
  assert.deepStrictEqual(P.notches(), [33.33, 66.67], 'precondition: the late chapters applied');
  P.openMenu();
  assert.ok(P.doc.querySelector('.chapters-menu-edited'), 'the Edited badge reads the late flag');
  P.doc.querySelector('.chapters-menu-edit:not(.chapters-menu-snap)').click();
  assert.strictEqual(P.seen.text[0].opts.version, 'ver-late', 'the text editor carries the late version');
});
