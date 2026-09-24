'use strict';

// [INTEGRATION] Chapter Snap "Shift all" (Dean 2026-09-24: "a global offset ... the whole
// track is offset by a somewhat equivalent amount. It's not the same for everything").
// Plan: docs/exec-plans/active/2026-09-24-snap-offset-status-bar.md. The ONE time editor
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
  click(h.snapAllBtn);
  assert.deepStrictEqual(nowOf(h), ['0:00.0', '1:01.8', '2:01.0', '3:04.8', '4:01.0'], 'the two suggestions snapped to the silence, absolute');
  assert.strictEqual(q(h, '.chapter-snap-shift-readout').textContent, 'Shifted +1.0 s on 2 of 4 chapters (the others were snapped since)');
  click(q(h, '.chapter-snap-shift-reset'));
  assert.deepStrictEqual(nowOf(h), ['0:00.0', '1:01.8', '2:00.0', '3:04.8', '4:00.0'], 'Reset took the shift off the shifted rows only; the snaps stay');
  click(h.saveBtn);
  await until(() => h.isClosed(), 'saved');
  assert.deepStrictEqual(loadDatabase().metadata[mix.id].chaptersManual.map((c) => c.startTime), [0, 61.75, 120, 184.75, 240]);
});

test('a stale seed locks the shift controls along with Save', async () => {
  const [mix] = seedItems([{ duration: 300, chapters: FIVE }]);
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  click(step(h, 1000));
  const typed = '0:00 Opening\n1:05 Second Song\n2:00 Third Song\n3:00 Fourth Song\n4:00 Closer';
  assert.strictEqual((await fetch(base + '/api/videos/' + enc(mix.id) + '/chapters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: typed }) })).status, 200);
  click(h.saveBtn);
  await until(() => /changed since/.test(h.statusEl.textContent), 'the refusal');
  assert.ok(Array.from(h.shiftBox.querySelectorAll('button')).every((b) => b.disabled || b.hidden), 'no shift control can act on a stale seed');
  assert.deepStrictEqual(loadDatabase().metadata[mix.id].chaptersManual.map((c) => c.startTime), [0, 65, 120, 180, 240], 'the shifted times were not written');
  h.close();
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
