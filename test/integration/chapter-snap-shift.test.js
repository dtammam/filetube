'use strict';

// [INTEGRATION] Chapter Snap "Shift all" (Dean 2026-09-24: "a global offset ... the whole
// track is offset by a somewhat equivalent amount. It's not the same for everything").
// Plan: docs/exec-plans/completed/2026-09-24-snap-offset-status-bar.md. The ONE time editor
// (common.js showChapterSnapEditor) driven in jsdom against the REAL server - every seed,
// scan, save and revert goes through the real routes to the real stored record. Bound here:
//   - the shift math: every chapter after the first moves by the same amount, chapter 1
//     never; a nudge made after the shift survives Reset shift; Reset is exact (subtracts
//     what the shift added, nothing else); Undo changes clears the shift;
//   - both clamp directions: a step that would put chapter 2 at or before chapter 1 (+ the
//     server's minimum gap) or the last chapter at or past the end (- the gap) is DISABLED
//     and the reason is shown, and the reason CLEARS once the step is legal again;
//   - Snap all after a shift still snaps to the silence (absolute), and a snapped row keeps
//     its snap through Reset shift;
//   - the suggested shift (agree / disagree / too few) on a REAL ffmpeg silencedetect scan of
//     a generated tone/silence album whose stored chapters are all 2 s early, then a real
//     save round trip: the count is unchanged, a like on ::c3 still names the same song,
//     and Revert restores the source times (skips, loudly, when no ffmpeg).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chapter-snap-shift-'));

const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { app, getMediaId, loadDatabase, chapterSilenceService, userStore } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { SILENCE_PARAMS_KEY } = require('../../lib/media/chapterSilence');
const libraryAudio = require('../../lib/music/libraryAudio');

const COMMON = require.resolve('../../public/js/common.js');
let server, base, auth, dom;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});
afterEach(() => {
  if (dom) dom.window.close();
  dom = null;
  delete global.window; delete global.document;
  delete require.cache[COMMON];
});

const FIVE = [
  { startTime: 0, title: 'Opening' }, { startTime: 60, title: 'Second Song' }, { startTime: 120, title: 'Third Song' },
  { startTime: 180, title: 'Fourth Song' }, { startTime: 240, title: 'Closer' },
];
const enc = encodeURIComponent;
const json = async (p) => (await fetch(base + p)).json();

// One library, any number of chaptered audio items (each its own real file on disk).
function seedItems(specs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chapter-snap-shift-lib-'));
  fs.mkdirSync(path.join(root, 'Chan'));
  const items = {};
  const out = specs.map((sp, k) => {
    const filePath = path.join(root, 'Chan', (sp.name || ('mix' + k)) + '.mp3');
    if (sp.bytes) fs.copyFileSync(sp.bytes, filePath); else fs.writeFileSync(filePath, 'mix-bytes-' + k);
    const id = getMediaId(filePath);
    const it = { id, name: path.basename(filePath), title: sp.title || ('The Mix ' + k), filePath, folderName: 'Chan', channelName: 'NESTALGIA', rootFolder: root, type: 'audio', ext: '.mp3',
      duration: sp.duration, size: fs.statSync(filePath).size, addedAt: 1 + k, audioCodec: 'mp3', chapters: sp.chapters.map((c) => ({ ...c })) };
    items[id] = it;
    return it;
  });
  seedState({ folders: [root], folderSettings: {}, settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 0 }, liked: [], metadata: items });
  return out;
}
// The silence cache exactly as a finished scan writes it (the REAL store API).
function seedSilence(item, silences) {
  const st = fs.statSync(item.filePath);
  chapterSilenceService.cache.write(item.id, { params: SILENCE_PARAMS_KEY, size: st.size, mtimeMs: st.mtimeMs, silences });
}

function bootEditor() {
  delete global.document; delete global.window;
  delete require.cache[COMMON];
  const common = require(COMMON);
  dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  const requests = [];
  const fetchImpl = (url, init) => {
    requests.push(((init && init.method) || 'GET') + ' ' + url);
    return fetch(base + url, init);
  };
  dom.window.confirm = () => { throw new Error('window.confirm must never be used'); };
  return { common, fetchImpl, requests };
}

const tick = () => new Promise((r) => setTimeout(r, 15));
async function until(pred, label, n) {
  for (let i = 0; i < (n || 200); i++) { if (pred()) return; await tick(); }
  assert.fail('timed out waiting for: ' + label);
}
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const rowsOf = (h) => Array.from(h.list.querySelectorAll('.chapter-snap-row'));
const nowOf = (h) => rowsOf(h).map((r) => r.querySelector('.chapter-snap-now').textContent);
const step = (h, ms) => h.shiftBox.querySelector('.chapter-snap-shift-btn[data-shift="' + ms + '"]');
const q = (h, sel) => h.shiftBox.querySelector(sel);
const shown = (el) => !!el && !el.hidden && !(el.closest && el.closest('[hidden]'));

test('the shift math: every chapter after the first moves by the same amount, chapter 1 never; a later nudge survives Reset shift, which is exact; Undo clears it', async () => {
  const [mix] = seedItems([{ duration: 300, chapters: FIVE }]);
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  assert.ok(shown(h.shiftBox), 'the Shift all row shows for a chaptered item');
  assert.strictEqual(h.shiftBox.nextElementSibling, h.list, 'it sits ABOVE the per-chapter rows');
  assert.strictEqual(q(h, '.chapter-snap-shift-readout').textContent, 'No shift');
  assert.strictEqual(shown(q(h, '.chapter-snap-shift-reset')), false, 'no Reset while nothing is shifted');
  assert.strictEqual(h.shiftBox.querySelectorAll('.chapter-snap-shift-btn').length, 4);
  click(step(h, 1000));
  click(step(h, 1000));
  click(step(h, 100));
  click(step(h, 100));
  click(step(h, 100));
  assert.deepStrictEqual(nowOf(h), ['0:00.0', '1:02.3', '2:02.3', '3:02.3', '4:02.3'], 'rows 2..5 moved +2.3 s, chapter 1 kept its start');
  assert.strictEqual(q(h, '.chapter-snap-shift-readout').textContent, 'All chapters shifted +2.3 s');
  assert.ok(shown(q(h, '.chapter-snap-shift-reset')), 'Reset is offered (populated axis)');
  assert.strictEqual(h.saveBtn.disabled, false, 'a shift is a change to save');
  // A per-row nudge AFTER the shift: chapter 3 one tenth later.
  click(rowsOf(h)[2].querySelector('[data-act="nudge"][data-delta="0.1"]'));
  assert.strictEqual(nowOf(h)[2], '2:02.4');
  click(q(h, '.chapter-snap-shift-reset'));
  assert.deepStrictEqual(nowOf(h), ['0:00.0', '1:00.0', '2:00.1', '3:00.0', '4:00.0'], 'Reset subtracts exactly the shift; the nudge stays');
  assert.strictEqual(q(h, '.chapter-snap-shift-readout').textContent, 'No shift');
  assert.strictEqual(shown(q(h, '.chapter-snap-shift-reset')), false, 'Reset hides again (the clear axis, on a populated row)');
  // Undo changes also clears a shift.
  click(step(h, -1000));
  assert.strictEqual(q(h, '.chapter-snap-shift-readout').textContent, 'All chapters shifted −1.0 s');
  click(h.undoBtn);
  assert.deepStrictEqual(nowOf(h), ['0:00.0', '1:00.0', '2:00.0', '3:00.0', '4:00.0']);
  assert.strictEqual(q(h, '.chapter-snap-shift-readout').textContent, 'No shift');
  // A shift then Save goes through the EXISTING save path: times only, the stored titles.
  click(step(h, 1000));
  click(h.saveBtn);
  await until(() => h.isClosed(), 'saved');
  const stored = loadDatabase().metadata[mix.id].chaptersManual;
  assert.deepStrictEqual(stored.map((c) => c.startTime), [0, 61, 121, 181, 241]);
  assert.deepStrictEqual(stored.map((c) => c.title), FIVE.map((c) => c.title));
  assert.deepStrictEqual(stored.map((c) => c.snapFrom), [0, 60, 120, 180, 240], 'the provenance is the source (Revert restores it)');
});

test('Reset shift is EXACT after many steps both ways, and keeps a nudge made in between (the stored times, not the display)', async () => {
  const [mix] = seedItems([{ duration: 300, chapters: FIVE }]);
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  for (let k = 0; k < 7; k++) click(step(h, 100));
  click(rowsOf(h)[1].querySelector('[data-act="nudge"][data-delta="-1"]')); // chapter 2 one second earlier, by hand
  for (let k = 0; k < 3; k++) click(step(h, -100));
  click(step(h, 1000));
  assert.strictEqual(q(h, '.chapter-snap-shift-readout').textContent, 'All chapters shifted +1.4 s');
  click(q(h, '.chapter-snap-shift-reset'));
  click(h.saveBtn);
  await until(() => h.isClosed(), 'saved');
  assert.deepStrictEqual(loadDatabase().metadata[mix.id].chaptersManual.map((c) => c.startTime), [0, 59, 120, 180, 240], 'only the hand nudge is left, to the millisecond');
});

test('clamp EARLIER: a step that would put chapter 2 at or before chapter 1 + the minimum gap is disabled with the reason; the reason clears once it is legal again', async () => {
  const [mix] = seedItems([{ duration: 300, chapters: [{ startTime: 0, title: 'A' }, { startTime: 0.5, title: 'B' }, { startTime: 100, title: 'C' }] }]);
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  const why = q(h, '.chapter-snap-shift-why');
  assert.strictEqual(step(h, -1000).disabled, true, '-1 s would reach chapter 1');
  assert.strictEqual(step(h, -100).disabled, false, '-0.1 s is still legal (0.4 > 0.1)');
  assert.ok(shown(why), 'the reason shows');
  assert.match(why.textContent, /Shifting earlier would put chapter 2 at or before chapter 1\./);
  click(step(h, -100));
  click(step(h, -100));
  click(step(h, -100));
  assert.strictEqual(nowOf(h)[1], '0:00.2');
  assert.strictEqual(step(h, -100).disabled, true, '0.2 - 0.1 = 0.1 is AT chapter 1 + the gap: refused');
  click(step(h, -100)); // a click on a disabled step changes nothing
  assert.strictEqual(nowOf(h)[1], '0:00.2');
  assert.strictEqual(step(h, 1000).disabled, false, 'the other direction is untouched');
  click(step(h, 1000));
  assert.strictEqual(step(h, -100).disabled, false);
  assert.strictEqual(step(h, -1000).disabled, false, '1.2 - 1 = 0.2 > 0.1: legal again');
  assert.strictEqual(shown(why), false, 'the reason CLEARS (a populated element hidden again)');
  h.close();
});

test('clamp LATER: a step that would put the last chapter at or past the end of the file - the gap is disabled with the reason', async () => {
  const [mix] = seedItems([{ duration: 300, chapters: [{ startTime: 0, title: 'A' }, { startTime: 100, title: 'B' }, { startTime: 299.5, title: 'C' }] }]);
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  const why = q(h, '.chapter-snap-shift-why');
  assert.strictEqual(step(h, 1000).disabled, true, '+1 s would pass the end');
  assert.strictEqual(step(h, 100).disabled, false);
  assert.match(why.textContent, /Shifting later would put the last chapter at or past the end of the file\./);
  click(step(h, 100));
  click(step(h, 100));
  click(step(h, 100));
  assert.strictEqual(nowOf(h)[2], '4:59.8');
  assert.strictEqual(step(h, 100).disabled, true, '299.8 + 0.1 = 299.9 is AT the end - the gap: refused');
  assert.strictEqual(step(h, -1000).disabled, false, 'earlier is untouched');
  click(h.saveBtn);
  await until(() => h.isClosed(), 'the clamped list saves');
  assert.deepStrictEqual(loadDatabase().metadata[mix.id].chaptersManual.map((c) => c.startTime), [0, 100.3, 299.8]);
});

test('the suggested shift from the CACHED silence: agree -> a one-tap button that applies it; then it lines up; disagree -> "No consistent offset"; too few -> "No consistent offset"; no new scan', async () => {
  const [agree, disagree, few] = seedItems([
    { name: 'agree', duration: 300, chapters: FIVE },
    { name: 'disagree', duration: 300, chapters: FIVE },
    { name: 'few', duration: 300, chapters: [{ startTime: 0, title: 'A' }, { startTime: 60, title: 'B' }] },
  ]);
  // Every song really starts 2 s after its stored chapter (a whole-track offset): gaps end at +2.
  seedSilence(agree, [{ start: 60.5, end: 62 }, { start: 120.5, end: 122 }, { start: 180.5, end: 182 }, { start: 240.5, end: 242 }]);
  // Two boundaries late by 2 s, two early by 3 s: no consistent offset.
  seedSilence(disagree, [{ start: 60.5, end: 62 }, { start: 116, end: 117 }, { start: 180.5, end: 182 }, { start: 236, end: 237 }]);
  seedSilence(few, [{ start: 60.5, end: 62 }]);
  const { common, fetchImpl, requests } = bootEditor();
  let h = common.showChapterSnapEditor(agree.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  const apply = () => q(h, '.chapter-snap-shift-apply');
  const note = () => q(h, '.chapter-snap-shift-note');
  assert.ok(shown(apply()), 'the suggestion is a button');
  assert.strictEqual(apply().textContent, 'Suggested: shift all by +1.75 s (4 of 4 agree)', '+2 s minus the 0.25 s lead-in');
  click(apply());
  assert.deepStrictEqual(nowOf(h), ['0:00.0', '1:01.8', '2:01.8', '3:01.8', '4:01.8']);
  assert.strictEqual(q(h, '.chapter-snap-shift-readout').textContent, 'All chapters shifted +1.75 s');
  assert.strictEqual(shown(apply()), false, 'the applied suggestion is gone (clear axis)');
  assert.strictEqual(note().textContent, 'The chapters line up with the silence (4 of 4 agree).');
  assert.ok(!requests.some((r) => r.endsWith('/scan')), 'no new scan: the silence was already cached');
  click(h.saveBtn);
  await until(() => h.isClosed(), 'saved');
  assert.deepStrictEqual(loadDatabase().metadata[agree.id].chaptersManual.map((c) => c.startTime), [0, 61.75, 121.75, 181.75, 241.75]);

  h = common.showChapterSnapEditor(disagree.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  assert.strictEqual(shown(apply()), false, 'no button when the boundaries disagree');
  assert.strictEqual(note().textContent, 'No consistent offset: the chapters are off by different amounts. Fix them one by one.');
  h.close();

  h = common.showChapterSnapEditor(few.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  assert.strictEqual(shown(apply()), false);
  assert.strictEqual(note().textContent, 'No consistent offset (too few gaps to compare).');
  h.close();
});

test('Snap all after a shift still snaps to the silence (absolute), and a snapped row keeps its snap through Reset shift', async () => {
  const [mix] = seedItems([{ duration: 300, chapters: FIVE }]);
  // Chapter 2 sits inside a 58-62 gap, chapter 4 in the tail before a 183-185 gap (the
  // Chapter Snap fixture): Snap all targets 61.75 and 184.75.
  seedSilence(mix, [{ start: 58, end: 62 }, { start: 183, end: 185 }]);
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  click(step(h, 1000));
  assert.deepStrictEqual(nowOf(h), ['0:00.0', '1:01.0', '2:01.0', '3:01.0', '4:01.0']);
  assert.match(h.snapAllBtn.textContent, /Snap all \(2\)/, 'rows moved only by the shift are still snappable');
  // One row snapped by its own button, the other by Snap all: both are absolute.
  click(rowsOf(h)[1].querySelector('[data-act="snap"]'));
  assert.match(h.snapAllBtn.textContent, /Snap all \(1\)/);
  click(h.snapAllBtn);
  assert.deepStrictEqual(nowOf(h), ['0:00.0', '1:01.8', '2:01.0', '3:04.8', '4:01.0'], 'the two suggestions snapped to the silence, absolute');
  assert.strictEqual(q(h, '.chapter-snap-shift-readout').textContent, 'Shifted +1.0 s on 2 of 4 chapters (the others carry no shift)');
  click(q(h, '.chapter-snap-shift-reset'));
  assert.deepStrictEqual(nowOf(h), ['0:00.0', '1:01.8', '2:00.0', '3:04.8', '4:00.0'], 'Reset took the shift off the shifted rows only; both snaps stay');
  click(h.saveBtn);
  await until(() => h.isClosed(), 'saved');
  assert.deepStrictEqual(loadDatabase().metadata[mix.id].chaptersManual.map((c) => c.startTime), [0, 61.75, 120, 184.75, 240]);
});

test('Reset shift is REFUSED (with the reason) when a row snapped after the shift would end up out of order; Undo changes still works', async () => {
  const [mix] = seedItems([{ duration: 300, chapters: [{ startTime: 0, title: 'A' }, { startTime: 60, title: 'B' }, { startTime: 61.5, title: 'C' }, { startTime: 120, title: 'D' }] }]);
  // A gap that ends at 61.05: chapter 2's snap point is 60.8 (the 0.25 s lead-in).
  seedSilence(mix, [{ start: 60.3, end: 61.05 }]);
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  click(step(h, 1000)); // [0, 61, 62.5, 121]
  click(rowsOf(h)[2].querySelector('[data-act="nudge"][data-delta="-1"]')); // chapter 3 -> 61.5 (keeps its +1 s shift)
  click(rowsOf(h)[1].querySelector('[data-act="snap"]')); // chapter 2 -> 60.8, absolute
  assert.deepStrictEqual(nowOf(h), ['0:00.0', '1:00.8', '1:01.5', '2:01.0']);
  const reset = q(h, '.chapter-snap-shift-reset');
  assert.ok(shown(reset), 'rows still carry the shift');
  assert.strictEqual(reset.disabled, true, 'taking 1 s off chapter 3 (61.5 -> 60.5) would put it before the snapped chapter 2 (60.8)');
  assert.match(q(h, '.chapter-snap-shift-why').textContent, /Resetting would put chapter 3 at or before chapter 2/);
  click(reset);
  assert.deepStrictEqual(nowOf(h), ['0:00.0', '1:00.8', '1:01.5', '2:01.0'], 'nothing moved');
  click(h.undoBtn);
  assert.deepStrictEqual(nowOf(h), ['0:00.0', '1:00.0', '1:01.5', '2:00.0']);
  assert.strictEqual(shown(q(h, '.chapter-snap-shift-why')), false, 'the reason clears with the shift');
  h.close();
});

test('a stale seed locks the shift controls along with Save', async () => {
  const [mix] = seedItems([{ duration: 300, chapters: FIVE }]);
  // A whole-track offset in the cached silence, so the SUGGESTION button is on screen too.
  seedSilence(mix, [{ start: 60.5, end: 62 }, { start: 120.5, end: 122 }, { start: 180.5, end: 182 }, { start: 240.5, end: 242 }]);
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  click(step(h, 1000));
  const apply = q(h, '.chapter-snap-shift-apply');
  assert.ok(shown(apply) && apply.disabled === false, 'precondition: the suggestion (+0.75 s) is shown and enabled');
  assert.ok(shown(q(h, '.chapter-snap-shift-reset')) && q(h, '.chapter-snap-shift-reset').disabled === false, 'precondition: Reset is shown and enabled');
  const typed = '0:00 Opening\n1:05 Second Song\n2:00 Third Song\n3:00 Fourth Song\n4:00 Closer';
  assert.strictEqual((await fetch(base + '/api/videos/' + enc(mix.id) + '/chapters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: typed }) })).status, 200);
  click(h.saveBtn);
  await until(() => /changed since/.test(h.statusEl.textContent), 'the refusal');
  assert.ok(Array.from(h.shiftBox.querySelectorAll('button')).every((b) => b.disabled || b.hidden), 'no shift control can act on a stale seed');
  assert.strictEqual(apply.disabled, true, 'the suggestion button locks too');
  const before = nowOf(h);
  apply.disabled = false; // even a button forced back on (devtools, a stale render) cannot act
  click(apply);
  assert.deepStrictEqual(nowOf(h), before, 'nothing moved');
  assert.deepStrictEqual(loadDatabase().metadata[mix.id].chaptersManual.map((c) => c.startTime), [0, 65, 120, 180, 240], 'the shifted times were not written');
  h.close();
});

// ---- gate r1 fixes ------------------------------------------------------------------

test('qa W1: a majority already on the silence with the rest off is NOT "the chapters line up" - the note says only some do', async () => {
  const [mix] = seedItems([{ duration: 360, chapters: [0, 60, 120, 180, 240, 300].map((t, i) => ({ startTime: t, title: 'C' + (i + 1) })) }]);
  // Chapters 2-3 start 2 s early (their songs start at 62 / 122); chapters 4-6 sit on their silence.
  seedSilence(mix, [{ start: 60.5, end: 62 }, { start: 120.5, end: 122 }, { start: 179, end: 180.25 }, { start: 239, end: 240.25 }, { start: 299, end: 300.25 }]);
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  assert.match(h.snapAllBtn.textContent, /Snap all \(2\)/, 'precondition: the head says two starts look off');
  assert.strictEqual(shown(q(h, '.chapter-snap-shift-apply')), false, 'no whole-track shift is offered');
  assert.strictEqual(q(h, '.chapter-snap-shift-note').textContent, 'No whole-track offset: 3 of 5 already line up. Fix the others one by one.');
  // Snap the two: now every boundary agrees, and the note may say the chapters line up.
  click(h.snapAllBtn);
  assert.strictEqual(q(h, '.chapter-snap-shift-note').textContent, 'The chapters line up with the silence (5 of 5 agree).');
  h.close();
});

test('adversary W2: a suggestion the clamps REFUSE is shown disabled with its reason, and a tap (even on a button forced back on) moves nothing', async () => {
  const [a, b] = seedItems([
    // The adversary's fixture: -0.95 s would put chapter 2 (at 1.0) at 0.05, inside the gap.
    { name: 'a', duration: 180, chapters: [0, 1, 60, 120].map((t, i) => ({ startTime: t, title: 'A' + (i + 1) })) },
    // Chapter 2 at 1.5: the -1 s step is legal, only the -1.45 s suggestion is refused, so the
    // reason on screen can only have come from the suggestion.
    { name: 'b', duration: 180, chapters: [0, 1.5, 60, 120].map((t, i) => ({ startTime: t, title: 'B' + (i + 1) })) },
  ]);
  seedSilence(a, [{ start: 58.5, end: 59.3 }, { start: 118.5, end: 119.3 }]);
  seedSilence(b, [{ start: 58, end: 58.8 }, { start: 118, end: 118.8 }]);
  const { common, fetchImpl } = bootEditor();
  let h = common.showChapterSnapEditor(a.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  let apply = q(h, '.chapter-snap-shift-apply');
  assert.ok(shown(apply), 'the suggestion is shown');
  assert.strictEqual(apply.textContent, 'Suggested: shift all by −0.95 s (2 of 2 agree)');
  assert.strictEqual(apply.disabled, true, 'and disabled');
  assert.match(q(h, '.chapter-snap-shift-why').textContent, /Shifting earlier would put chapter 2 at or before chapter 1\./);
  const before = nowOf(h);
  click(apply);
  assert.deepStrictEqual(nowOf(h), before, 'a tap on the disabled suggestion moves nothing');
  apply.disabled = false; // a stale render / devtools: applyShift refuses on its own
  click(apply);
  assert.deepStrictEqual(nowOf(h), before, 'even an enabled button cannot apply a refused shift');
  assert.match(h.statusEl.textContent, /Shifting earlier would put chapter 2 at or before chapter 1\./, 'and it says why');
  assert.strictEqual(h.saveBtn.disabled, true, 'nothing to save');
  h.close();

  h = common.showChapterSnapEditor(b.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  apply = q(h, '.chapter-snap-shift-apply');
  assert.strictEqual(apply.textContent, 'Suggested: shift all by −1.45 s (2 of 2 agree)');
  assert.strictEqual(apply.disabled, true);
  assert.strictEqual(step(h, -1000).disabled, false, 'every STEP is legal here');
  assert.ok(shown(q(h, '.chapter-snap-shift-why')), 'so the reason shown is the suggestion\'s own');
  assert.match(q(h, '.chapter-snap-shift-why').textContent, /Shifting earlier would put chapter 2 at or before chapter 1\./);
  h.close();
});

test('adversary W3: Reset is refused when it would put the last chapter at or past the end (or inside the gap before it), or two chapters on the SAME start or inside the gap', async () => {
  const [end, endGap, equal, midGap] = seedItems([
    { name: 'end', duration: 300, chapters: [0, 100, 299.5].map((t, i) => ({ startTime: t, title: 'E' + (i + 1) })) },
    { name: 'endgap', duration: 300, chapters: [0, 100, 299.45].map((t, i) => ({ startTime: t, title: 'G' + (i + 1) })) },
    { name: 'equal', duration: 300, chapters: [0, 60, 61.5, 120].map((t, i) => ({ startTime: t, title: 'Q' + (i + 1) })) },
    { name: 'midgap', duration: 300, chapters: [0, 0.35, 100].map((t, i) => ({ startTime: t, title: 'M' + (i + 1) })) },
  ]);
  seedSilence(equal, [{ start: 60.2, end: 60.75 }]); // chapter 2's snap point: 60.5
  const { common, fetchImpl } = bootEditor();
  const reset = (h) => q(h, '.chapter-snap-shift-reset');
  const why = (h) => q(h, '.chapter-snap-shift-why').textContent;
  const nudge = (h, i, d) => click(rowsOf(h)[i].querySelector('[data-act="nudge"][data-delta="' + d + '"]'));

  // (1) past the end: -1 s, then the last chapter nudged up to 4:59.9; Reset would add 1 s back.
  let h = common.showChapterSnapEditor(end.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  click(step(h, -1000));
  nudge(h, 2, '1');
  for (let k = 0; k < 6; k++) nudge(h, 2, '0.1');
  assert.strictEqual(nowOf(h)[2], '4:59.9');
  assert.ok(shown(reset(h)));
  assert.strictEqual(reset(h).disabled, true, 'Reset would put chapter 3 at 5:00.9 on a 300 s file');
  assert.match(why(h), /Resetting would put the last chapter at or past the end of the file, or within 0\.1 s of it and closer than your saved chapters have it\./);
  click(reset(h));
  assert.strictEqual(nowOf(h)[2], '4:59.9', 'nothing moved');
  click(h.saveBtn);
  await until(() => h.isClosed(), 'the list on screen saves');
  assert.deepStrictEqual(loadDatabase().metadata[end.id].chaptersManual.map((c) => c.startTime), [0, 99, 299.9]);

  // (2) inside the gap before the end: -0.1 s, the last nudged +0.5 s; Reset -> 299.95 (50 ms from the end).
  h = common.showChapterSnapEditor(endGap.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  click(step(h, -100));
  for (let k = 0; k < 5; k++) nudge(h, 2, '0.1');
  assert.strictEqual(reset(h).disabled, true, 'Reset would leave the last chapter 50 ms before the end');
  assert.match(why(h), /Resetting would put the last chapter/);
  h.close();

  // (3) an EQUAL pair: +1 s, chapter 3 nudged -1 s (61.5, still carrying the shift), chapter 2
  // snapped to 60.5; Reset would put chapter 3 at 60.5 = chapter 2.
  h = common.showChapterSnapEditor(equal.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  click(step(h, 1000));
  nudge(h, 2, '-1');
  click(rowsOf(h)[1].querySelector('[data-act="snap"]'));
  assert.deepStrictEqual(nowOf(h), ['0:00.0', '1:00.5', '1:01.5', '2:01.0']);
  assert.strictEqual(reset(h).disabled, true, 'two chapters on one start');
  assert.match(why(h), /Resetting would put chapter 3 at or before chapter 2/);
  h.close();

  // (4) inside the gap in the middle: +0.1 s, chapter 2 nudged -0.3 s to 0.15; Reset -> 0.05.
  h = common.showChapterSnapEditor(midGap.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  click(step(h, 100));
  for (let k = 0; k < 3; k++) nudge(h, 1, '-0.1');
  assert.strictEqual(nowOf(h)[1], '0:00.2');
  assert.strictEqual(reset(h).disabled, true, 'Reset would put chapter 2 50 ms after chapter 1');
  assert.match(why(h), /Resetting would put chapter 2 at or before chapter 1, or within 0\.1 s of it and closer than your saved chapters have them\./);
  h.close();
});

test('qa S3 / adversary 4: the per-row Snap and Snap all keep the server\'s minimum gap from a nudged neighbour', async () => {
  const [mix] = seedItems([{ duration: 300, chapters: [0, 60, 80].map((t, i) => ({ startTime: t, title: 'N' + (i + 1) })) }]);
  seedSilence(mix, [{ start: 58, end: 62 }]); // chapter 2's snap point: 61.75 (chapter 3 has no gap near it)
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  const nudge = (i, d) => click(rowsOf(h)[i].querySelector('[data-act="nudge"][data-delta="' + d + '"]'));
  for (let k = 0; k < 18; k++) nudge(2, '-1');
  nudge(2, '-0.1');
  nudge(2, '-0.1');
  assert.strictEqual(nowOf(h)[2], '1:01.8', 'chapter 3 nudged to 61.8, 50 ms after chapter 2\'s snap point');
  assert.match(h.snapAllBtn.textContent, /^Snap all$/, 'Snap all leaves chapter 2 alone (it would land inside the gap)');
  assert.strictEqual(h.snapAllBtn.disabled, true);
  click(rowsOf(h)[1].querySelector('[data-act="snap"]'));
  assert.strictEqual(nowOf(h)[1], '1:00.0', 'the per-row Snap refuses too');
  assert.match(h.statusEl.textContent, /Snapping chapter 2 would cross its neighbour or come within 0\.1 s of it/);
  nudge(2, '0.1'); // 61.9: now 150 ms clear
  assert.match(h.snapAllBtn.textContent, /Snap all \(1\)/, 'once clear of the gap, Snap all takes it');
  click(rowsOf(h)[1].querySelector('[data-act="snap"]'));
  assert.strictEqual(nowOf(h)[1], '1:01.8');
  h.close();
});

test('adversary 6: a start stored on a half millisecond survives Shift + Reset exactly - Save and Undo are off again', async () => {
  const [mix] = seedItems([{ duration: 300, chapters: [{ startTime: 0, title: 'A' }, { startTime: 60, title: 'B' }, { startTime: 120.0005, title: 'C' }, { startTime: 180, title: 'D' }] }]);
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  assert.strictEqual(h.saveBtn.disabled, true);
  click(step(h, 100));
  assert.strictEqual(h.saveBtn.disabled, false);
  click(q(h, '.chapter-snap-shift-reset'));
  assert.strictEqual(q(h, '.chapter-snap-shift-readout').textContent, 'No shift');
  assert.strictEqual(h.saveBtn.disabled, true, 'nothing left to save');
  assert.strictEqual(h.undoBtn.disabled, true, 'nothing left to undo');
  h.close();
});

test('adversary 7: a shift stops the audition of a row it moves (the old time must not keep playing)', async () => {
  const [mix] = seedItems([{ duration: 300, chapters: FIVE }]);
  const { common, fetchImpl } = bootEditor();
  let pauses = 0;
  const fake = dom.window.document.createElement('audio');
  Object.defineProperty(fake, 'readyState', { configurable: true, get: () => 1 });
  fake.play = () => Promise.resolve();
  fake.pause = () => { pauses += 1; };
  fake.load = () => {};
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document, audioFactory: () => fake });
  await h.ready;
  click(rowsOf(h)[1].querySelector('[data-act="play"]'));
  assert.ok(rowsOf(h)[1].classList.contains('is-playing'), 'precondition: chapter 2 is auditioning');
  const p0 = pauses;
  click(step(h, 1000));
  assert.strictEqual(rowsOf(h)[1].classList.contains('is-playing'), false, 'the audition stopped');
  assert.ok(pauses > p0, 'and the audio was paused');
  h.close();
});

test('qa S4: the readout is a polite live region written only when its words change', async () => {
  const [mix] = seedItems([{ duration: 300, chapters: FIVE }]);
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  const el = q(h, '.chapter-snap-shift-readout');
  assert.strictEqual(el.getAttribute('aria-live'), 'polite');
  const seen = [];
  const mo = new dom.window.MutationObserver((ms) => { seen.push(...ms); });
  mo.observe(el, { childList: true, characterData: true, subtree: true });
  click(rowsOf(h)[2].querySelector('[data-act="nudge"][data-delta="0.1"]')); // a re-render, same words
  click(rowsOf(h)[3].querySelector('[data-act="nudge"][data-delta="1"]'));
  await tick();
  assert.strictEqual(seen.length, 0, 'no rewrite for an unchanged "No shift"');
  click(step(h, 1000));
  await tick();
  assert.ok(seen.length > 0, 'a new shift is written (and announced)');
  assert.strictEqual(el.textContent, 'All chapters shifted +1.0 s');
  mo.disconnect();
  h.close();
});

// ---- gate r2 fixes ------------------------------------------------------------------

test('qa 1 / adversary 2 (r2): a close pair or a near-the-end last chapter that came from the SOURCE never blocks Reset, the steps back, or a later edit', async () => {
  const [pair, first, end] = seedItems([
    { name: 'pair', duration: 300, chapters: [0, 60, 60.05, 120].map((t, i) => ({ startTime: t, title: 'P' + (i + 1) })) },
    { name: 'first', duration: 300, chapters: [0, 0.05, 60].map((t, i) => ({ startTime: t, title: 'F' + (i + 1) })) },
    { name: 'end', duration: 300, chapters: [0, 60, 299.95].map((t, i) => ({ startTime: t, title: 'E' + (i + 1) })) },
  ]);
  const { common, fetchImpl } = bootEditor();
  const reset = (h) => q(h, '.chapter-snap-shift-reset');
  const nudge = (h, i, d) => click(rowsOf(h)[i].querySelector('[data-act="nudge"][data-delta="' + d + '"]'));

  // (1) a 50 ms pair in the middle: +1 s, the last chapter nudged, Reset -> the pair is back at 50 ms.
  let h = common.showChapterSnapEditor(pair.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  click(step(h, 1000));
  nudge(h, 3, '0.1');
  assert.strictEqual(reset(h).disabled, false, 'Reset is offered: it gives the pair back its saved gap');
  assert.strictEqual(shown(q(h, '.chapter-snap-shift-why')), false, 'and no reason claims otherwise');
  click(reset(h));
  assert.strictEqual(q(h, '.chapter-snap-shift-readout').textContent, 'No shift');
  click(h.saveBtn);
  await until(() => h.isClosed(), 'saved');
  assert.deepStrictEqual(loadDatabase().metadata[pair.id].chaptersManual.map((c) => c.startTime), [0, 60, 60.05, 120.1], 'the source pair kept, the nudge kept');

  // (2) chapter 2 50 ms after chapter 1: -0.1 s is refused at the source (it would narrow below the
  // saved 50 ms), but after +1 s both -1 s and Reset go back to it.
  h = common.showChapterSnapEditor(first.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  assert.strictEqual(step(h, -100).disabled, true, 'narrowing the source pair further is still refused');
  click(step(h, 1000));
  assert.strictEqual(step(h, -1000).disabled, false, '-1 s back to the saved 50 ms is allowed');
  assert.strictEqual(reset(h).disabled, false, 'and so is Reset');
  click(step(h, -1000));
  assert.strictEqual(q(h, '.chapter-snap-shift-readout').textContent, 'No shift');
  assert.strictEqual(h.saveBtn.disabled, true, 'back at the saved list');
  click(step(h, 1000));
  click(reset(h));
  assert.strictEqual(q(h, '.chapter-snap-shift-readout').textContent, 'No shift');
  assert.strictEqual(h.saveBtn.disabled, true);
  h.close();

  // (3) the last chapter 50 ms before the end: -1 s, then +1 s or Reset go back to it.
  h = common.showChapterSnapEditor(end.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  assert.strictEqual(step(h, 100).disabled, true, 'later than the saved 50 ms is refused');
  click(step(h, -1000));
  assert.strictEqual(step(h, 1000).disabled, false, '+1 s back to the saved end is allowed');
  assert.strictEqual(reset(h).disabled, false, 'and so is Reset');
  click(reset(h));
  assert.strictEqual(h.saveBtn.disabled, true);
  h.close();
});

test('adversary 2 (r2): a pair the edit does not narrow is never its business - Reset and Snap all pass over a nudge-squeezed pair elsewhere', async () => {
  // Chapters 3 and 4 sit 100 ms apart with chapter 2 only 50 ms before chapter 3: a nudge of
  // chapter 3 has no legal room and is clamped to chapter 2 + the gap, which leaves chapter 3 and
  // 4 only 50 ms apart (the nudge clamp's squeeze; that pair is now narrower than saved).
  const [a, b] = seedItems([
    { name: 'a', duration: 300, chapters: [0, 10, 10.05, 10.15, 100].map((t, i) => ({ startTime: t, title: 'A' + (i + 1) })) },
    { name: 'b', duration: 300, chapters: [0, 10, 10.05, 10.15, 100, 200].map((t, i) => ({ startTime: t, title: 'B' + (i + 1) })) },
  ]);
  seedSilence(b, [{ start: 98, end: 102 }]); // chapter 5 of b: snap point 101.75
  const { common, fetchImpl } = bootEditor();
  const nudge = (h, i, d) => click(rowsOf(h)[i].querySelector('[data-act="nudge"][data-delta="' + d + '"]'));

  let h = common.showChapterSnapEditor(a.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  nudge(h, 2, '0.1');
  assert.strictEqual(nowOf(h)[2], '0:10.1', 'precondition: the squeeze (chapters 3 and 4 now 50 ms apart)');
  click(step(h, 1000));
  const reset = q(h, '.chapter-snap-shift-reset');
  assert.strictEqual(reset.disabled, false, 'Reset does not change that pair, so it does not answer for it');
  click(reset);
  assert.deepStrictEqual(nowOf(h), ['0:00.0', '0:10.0', '0:10.1', '0:10.2', '1:40.0']);
  h.close();

  h = common.showChapterSnapEditor(b.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  nudge(h, 2, '0.1');
  assert.match(h.snapAllBtn.textContent, /Snap all \(1\)/, 'Snap all still takes chapter 5');
  click(h.snapAllBtn);
  assert.strictEqual(nowOf(h)[4], '1:41.8');
  click(h.undoBtn);
  nudge(h, 2, '0.1');
  click(rowsOf(h)[4].querySelector('[data-act="snap"]'));
  assert.strictEqual(nowOf(h)[4], '1:41.8', 'and so does its own Snap');
  h.close();
});

test('adversary r2 (the unexplained failure): 400 mixed steps and nudges, Reset, then a shift and Save - in the same file as the other shift tests', async () => {
  const [mix] = seedItems([{ duration: 300, chapters: [0, 60.0004, 120.0005, 180.123456789, 240].map((t, i) => ({ startTime: t, title: 'R' + (i + 1) })) }]);
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const steps = [-1000, -100, 100, 1000];
  for (let k = 0; k < 400; k++) {
    const b = step(h, steps[Math.floor(rnd() * 4)]);
    if (!b.disabled) click(b);
  }
  assert.ok(q(h, '.chapter-snap-shift-reset').disabled === false || q(h, '.chapter-snap-shift-readout').textContent === 'No shift');
  if (!q(h, '.chapter-snap-shift-reset').hidden) click(q(h, '.chapter-snap-shift-reset'));
  assert.strictEqual(q(h, '.chapter-snap-shift-readout').textContent, 'No shift');
  assert.strictEqual(h.saveBtn.disabled, true, 'every row back on its stored start');
  click(step(h, 1000));
  click(step(h, 100));
  click(h.saveBtn);
  await until(() => h.isClosed(), 'saved');
  assert.deepStrictEqual(loadDatabase().metadata[mix.id].chaptersManual.map((c) => c.startTime), [0, 61.1, 121.101, 181.223, 241.1]);
});

// ---- REAL ffmpeg: a whole-track offset, found and fixed end to end --------------------
function findFfmpeg() {
  const explicit = process.env.FILETUBE_TEST_FFMPEG;
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, 'ffmpeg');
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (_) { /* next */ }
  }
  return null;
}
const FFMPEG = findFfmpeg();

test('REAL ffmpeg: every stored chapter 2 s early -> the scan suggests +1.75 s (4 of 4); a mixed list says no consistent offset; one boundary is too few; the applied shift saves times-only, a like on ::c3 keeps its song, Revert restores', { skip: FFMPEG ? false : 'no ffmpeg binary (set FILETUBE_TEST_FFMPEG)' }, async (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chapter-snap-shift-ff-'));
  const album = path.join(work, 'album.mp3');
  // tone 6.5 | silence 1.5 | tone 6.5 | ... five songs: the music starts at 0, 8, 16, 24, 32 (38.5 s).
  const inputs = [];
  const labels = [];
  for (let k = 0; k < 5; k++) {
    inputs.push('-f', 'lavfi', '-i', `sine=frequency=${440 + k * 110}:duration=6.5`);
    labels.push(`[${inputs.length / 4 - 1}]`);
    if (k < 4) { inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1.5'); labels.push(`[${inputs.length / 4 - 1}]`); }
  }
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', `${labels.join('')}concat=n=${labels.length}:v=0:a=1`, '-ac', '1', '-y', album]);
  const titles = ['One', 'Two', 'Three', 'Four', 'Five'];
  // The whole-track offset: every stored chapter 2 s BEFORE its song (in the previous song's tail).
  const EARLY = [0, 6, 14, 22, 30].map((t, i) => ({ startTime: t, title: titles[i] }));
  // Real misalignment: off by different amounts.
  const MIXED = [0, 6, 16.5, 25, 30].map((t, i) => ({ startTime: t, title: titles[i] }));
  const [off, mixed, lone] = seedItems([
    { name: 'offset', duration: 38.5, chapters: EARLY, bytes: album },
    { name: 'mixed', duration: 38.5, chapters: MIXED, bytes: album },
    { name: 'lone', duration: 38.5, chapters: EARLY.slice(0, 2), bytes: album },
  ]);
  const ids = libraryAudio.expandAudioToTracks(off, () => off.chapters).map((t) => t.id);
  assert.strictEqual((await fetch(`${base}/api/liked/${enc(ids[3])}`, { method: 'POST' })).status, 200, 'like chapter 4 ("Four")');
  const savedPath = process.env.PATH;
  process.env.PATH = path.dirname(FFMPEG) + path.delimiter + savedPath; // the server spawns `ffmpeg` by name
  try {
    const { common, fetchImpl, requests } = bootEditor();
    const open = async (item) => {
      const h = common.showChapterSnapEditor(item.id, { fetchImpl, pollMs: 25, doc: dom.window.document });
      await h.ready;
      // The editor starts the REAL scan itself and polls until the silence is in.
      await until(() => !!h.shiftBox.querySelector('.chapter-snap-shift-note').textContent || shown(h.shiftBox.querySelector('.chapter-snap-shift-apply')), 'the scan finished and the suggestion rendered', 1200);
      return h;
    };
    let h = await open(off);
    assert.ok(requests.some((r) => r === 'POST /api/videos/' + enc(off.id) + '/chapter-snap/scan'), 'a REAL scan ran');
    const apply = q(h, '.chapter-snap-shift-apply');
    assert.ok(shown(apply), 'a whole-track offset is suggested');
    const m = /^Suggested: shift all by \+(\d+(?:\.\d+)?) s \(4 of 4 agree\)$/.exec(apply.textContent);
    assert.ok(m, 'the suggestion reads: ' + apply.textContent);
    assert.ok(Math.abs(Number(m[1]) - 1.75) <= 0.05, `+2 s minus the 0.25 s lead-in (got +${m[1]} s)`);
    const delta = Number(apply.getAttribute('data-shift'));
    t.diagnostic('real scan: ' + apply.textContent + ' (applied ' + delta + ' ms)');
    assert.ok(Math.abs(delta - 1750) <= 50, 'the button applies what it says, sign included (got ' + delta + ' ms)');
    click(apply);
    click(h.saveBtn);
    await until(() => h.isClosed(), 'saved');
    const stored = loadDatabase().metadata[off.id].chaptersManual;
    assert.strictEqual(stored.length, 5, 'the chapter count never changes');
    assert.deepStrictEqual(stored.map((c) => c.startTime), [0, ...[6, 14, 22, 30].map((t) => Math.round(t * 1000 + delta) / 1000)], 'every chapter after the first moved by the suggestion');
    assert.deepStrictEqual(stored.map((c) => c.title), titles, 'titles untouched');
    const music = (await json('/api/music?limit=50')).items.filter((t) => String(t.id).startsWith(off.id + '::c'));
    assert.deepStrictEqual(music.map((t) => t.id).sort(), ids.slice().sort(), 'the SAME five chapter ids');
    const liked = (await json('/api/liked?limit=50')).items.find((i) => i.id === ids[3]);
    assert.ok(liked, 'the chapter like is still listed');
    assert.strictEqual(liked.title, 'Four', 'the like on ::c3 still names the same song');
    assert.strictEqual(liked.chapterStartSec, stored[3].startTime);
    // Revert (the in-page confirm): back to the source times; the like still on "Four".
    h = common.showChapterSnapEditor(off.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
    await h.ready;
    assert.strictEqual(h.revertBtn.hidden, false, 'Revert is offered for the shifted list');
    click(h.revertBtn);
    click(h.confirmBox.querySelector('.chapter-snap-confirm-yes'));
    await until(() => h.isClosed(), 'reverted');
    assert.strictEqual(loadDatabase().metadata[off.id].chaptersManual, undefined, 'back to the source chapters');
    const back = (await json('/api/liked?limit=50')).items.find((i) => i.id === ids[3]);
    assert.strictEqual(back.title, 'Four');
    assert.strictEqual(back.chapterStartSec, 22, 'the source time is back');
    assert.deepStrictEqual(userStore.getLiked(auth.user.id).filter((id) => id.startsWith(off.id)), [ids[3]], 'no like was re-keyed or dropped');

    h = await open(mixed);
    assert.strictEqual(shown(q(h, '.chapter-snap-shift-apply')), false, 'no one-tap shift for real misalignment');
    assert.strictEqual(q(h, '.chapter-snap-shift-note').textContent, 'No consistent offset: the chapters are off by different amounts. Fix them one by one.');
    h.close();

    h = await open(lone);
    assert.strictEqual(q(h, '.chapter-snap-shift-note').textContent, 'No consistent offset (too few gaps to compare).');
    h.close();
  } finally {
    process.env.PATH = savedPath;
    fs.rmSync(work, { recursive: true, force: true });
  }
});
