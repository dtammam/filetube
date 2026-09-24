'use strict';

// [INTEGRATION] v1.319 Chapter Snap: the ONE time editor (common.js
// showChapterSnapEditor) driven in jsdom against the REAL server - every request
// the editor makes goes through the real routes to the real stored record, so the
// seed, the save, the version refusal and the revert are the production shapes,
// never a hand-typed stub. Bound here:
//   - the editor seeds from STORAGE (GET .../chapter-snap), renders one row per
//     stored chapter, and opens on `focusIndex`;
//   - Snap all -> Save writes the snapped starts, titles untouched; onSaved gets
//     the server's body; the modal closes;
//   - a nudge clamps between neighbours; chapter 1 has no nudge controls;
//   - a STALE seed (the text editor saved meanwhile) is refused, nothing written;
//   - Revert goes through the IN-PAGE confirm (never window.confirm), both axes
//     (Keep = nothing sent; Revert = the real revert);
//   - a dirty Cancel asks first (Keep editing keeps the edits);
//   - the text editor's "Fix times..." (entry point 4) opens the SAME editor and
//     refuses while the textarea holds unsaved typing.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chapter-snap-ui-'));

const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { app, getMediaId, loadDatabase, chapterSilenceService } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { SILENCE_PARAMS_KEY } = require('../../lib/media/chapterSilence');

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

function seedMix() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chapter-snap-ui-lib-'));
  fs.mkdirSync(path.join(root, 'Chan'));
  const filePath = path.join(root, 'Chan', 'mix.mp3');
  fs.writeFileSync(filePath, 'mix-bytes');
  const id = getMediaId(filePath);
  const mix = { id, name: 'mix.mp3', title: 'The Mix', filePath, folderName: 'Chan', rootFolder: root, type: 'audio', ext: '.mp3', duration: 300, size: 9, addedAt: 1, chapters: FIVE.map((c) => ({ ...c })) };
  seedState({ folders: [root], folderSettings: {}, settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 0 }, liked: [], metadata: { [id]: mix } });
  const st = fs.statSync(filePath);
  chapterSilenceService.cache.write(id, { params: SILENCE_PARAMS_KEY, size: st.size, mtimeMs: st.mtimeMs, silences: [{ start: 58, end: 62 }, { start: 183, end: 185 }] });
  return mix;
}

// Boot common.js into a fresh jsdom (the share-prompt.test.js pattern) and route
// the editor's relative URLs to the REAL server (the auth-patched global fetch).
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
  const confirmCalls = [];
  dom.window.confirm = () => { confirmCalls.push(1); return true; };
  return { common, fetchImpl, requests, confirmCalls };
}

const tick = () => new Promise((r) => setTimeout(r, 15));
async function until(pred, label) {
  for (let i = 0; i < 200; i++) { if (pred()) return; await tick(); }
  assert.fail('timed out waiting for: ' + label);
}
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const rowsOf = (h) => Array.from(h.list.querySelectorAll('.chapter-snap-row'));

test('seeds from STORAGE: one row per stored chapter, the focus row marked, chapter 1 without nudges, the suggestions shown; Snap all -> Save writes the snapped starts and closes', async () => {
  const mix = seedMix();
  const { common, fetchImpl, requests } = bootEditor();
  let saved = null;
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, focusIndex: 3, pollMs: 20, doc: dom.window.document, onSaved: (b) => { saved = b; } });
  await h.ready;
  const rows = rowsOf(h);
  assert.strictEqual(rows.length, 5, 'one row per STORED chapter');
  assert.deepStrictEqual(rows.map((r) => r.querySelector('.chapter-snap-name').textContent), FIVE.map((c) => c.title));
  assert.ok(rows[3].classList.contains('is-focus'), 'opens on the requested chapter');
  assert.strictEqual(rows[0].querySelectorAll('[data-act="nudge"]').length, 0, 'chapter 1 has no nudges');
  assert.strictEqual(rows[1].querySelectorAll('[data-act="nudge"]').length, 4, 'every other chapter has four');
  assert.ok(rows[1].querySelector('[data-act="snap"]'), 'chapter 2 offers its snap');
  assert.match(rows[1].querySelector('.chapter-snap-chip').textContent, /silence/);
  assert.match(rows[3].querySelector('.chapter-snap-chip').textContent, /end of the previous song/);
  assert.match(rows[2].querySelector('.chapter-snap-chip').textContent, /No gap found/);
  assert.strictEqual(h.saveBtn.disabled, true, 'nothing to save yet');
  assert.match(h.snapAllBtn.textContent, /Snap all \(2\)/);
  click(h.snapAllBtn);
  assert.strictEqual(h.saveBtn.disabled, false);
  assert.match(rowsOf(h)[1].querySelector('.chapter-snap-now').textContent, /^1:01\.8$/);
  click(h.saveBtn);
  await until(() => h.isClosed(), 'the editor closes after the save');
  assert.ok(saved && saved.chaptersEdited === true, 'onSaved got the server body');
  const stored = loadDatabase().metadata[mix.id].chaptersManual;
  assert.deepStrictEqual(stored.map((c) => c.startTime), [0, 61.75, 120, 184.75, 240]);
  assert.deepStrictEqual(stored.map((c) => c.title), FIVE.map((c) => c.title));
  assert.ok(requests.includes('GET /api/videos/' + encodeURIComponent(mix.id) + '/chapter-snap'), 'the seed came from the server');
});

test('a nudge moves one tenth / one second and clamps between neighbours', async () => {
  const mix = seedMix();
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 20, doc: dom.window.document });
  await h.ready;
  const nudge = (i, delta) => click(rowsOf(h)[i].querySelector('[data-act="nudge"][data-delta="' + delta + '"]'));
  nudge(1, '0.1');
  assert.strictEqual(rowsOf(h)[1].querySelector('.chapter-snap-now').textContent, '1:00.1');
  nudge(1, '-1');
  assert.strictEqual(rowsOf(h)[1].querySelector('.chapter-snap-now').textContent, '0:59.1');
  for (let k = 0; k < 70; k++) nudge(1, '-1');
  assert.strictEqual(rowsOf(h)[1].querySelector('.chapter-snap-now').textContent, '0:00.1', 'never at or before chapter 1');
  assert.match(h.statusEl.textContent, /cannot move further/);
  h.close();
});

test('STALE seed: the text editor saved after the time editor opened -> Save is refused by the server and NOTHING of the stale editor is written', async () => {
  const mix = seedMix();
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  click(h.snapAllBtn);
  const typed = '0:00 Opening\n1:05 Second Song\n2:00 Third Song\n3:00 Fourth Song\n4:00 Closer';
  assert.strictEqual((await fetch(base + '/api/videos/' + encodeURIComponent(mix.id) + '/chapters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: typed }) })).status, 200);
  click(h.saveBtn);
  await until(() => /changed since/.test(h.statusEl.textContent), 'the refusal is shown');
  assert.strictEqual(h.isClosed(), false, 'the editor stays open to say so');
  assert.strictEqual(h.saveBtn.disabled, true, 'and cannot retry the stale save');
  assert.deepStrictEqual(loadDatabase().metadata[mix.id].chaptersManual.map((c) => c.startTime), [0, 65, 120, 180, 240], 'the typed list is what is stored');
  h.close();
});

test('Revert goes through the IN-PAGE confirm (never window.confirm): Keep sends nothing, Revert restores the source from storage', async () => {
  const mix = seedMix();
  // Make it a snap edit first, through the real route.
  const s = await (await fetch(base + '/api/videos/' + encodeURIComponent(mix.id) + '/chapter-snap')).json();
  assert.strictEqual((await fetch(base + '/api/videos/' + encodeURIComponent(mix.id) + '/chapter-snap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: s.version, starts: s.snapAll }) })).status, 200);
  const { common, fetchImpl, requests, confirmCalls } = bootEditor();
  let saved = null;
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document, onSaved: (b) => { saved = b; } });
  await h.ready;
  assert.strictEqual(h.modal.querySelector('.chapter-snap-badge').hidden, false, 'the Edited badge shows');
  assert.strictEqual(h.revertBtn.hidden, false, 'Revert is offered for a snap edit');
  assert.strictEqual(h.confirmBox.hidden, true, 'the confirm is closed until asked (populated axis below)');
  click(h.revertBtn);
  assert.strictEqual(h.confirmBox.hidden, false, 'the in-page confirm opens');
  assert.match(h.confirmBox.textContent, /Likes and progress stay on the same chapters/);
  click(h.confirmBox.querySelector('.chapter-snap-confirm-no'));
  assert.strictEqual(h.confirmBox.hidden, true, 'Keep closes the POPULATED confirm');
  assert.ok(!requests.some((r) => r.indexOf('/revert') !== -1), 'and sent nothing');
  click(h.revertBtn);
  click(h.confirmBox.querySelector('.chapter-snap-confirm-yes'));
  await until(() => h.isClosed(), 'the editor closes after the revert');
  assert.strictEqual(confirmCalls.length, 0, 'window.confirm was never used');
  assert.strictEqual(saved.chaptersEdited, false);
  assert.strictEqual(loadDatabase().metadata[mix.id].chaptersManual, undefined, 'back to the embedded source');
});

test('a dirty Cancel asks first: Keep editing keeps the edits; Discard closes without writing', async () => {
  const mix = seedMix();
  const { common, fetchImpl, requests } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  click(h.snapAllBtn);
  click(h.cancelBtn);
  assert.strictEqual(h.isClosed(), false, 'not closed on the first tap');
  assert.strictEqual(h.confirmBox.hidden, false);
  assert.match(h.confirmBox.textContent, /Discard your changes/);
  click(h.confirmBox.querySelector('.chapter-snap-confirm-no'));
  assert.strictEqual(h.saveBtn.disabled, false, 'the edits are still there');
  click(h.cancelBtn);
  click(h.confirmBox.querySelector('.chapter-snap-confirm-yes'));
  assert.strictEqual(h.isClosed(), true);
  assert.ok(!requests.some((r) => r.startsWith('POST ') && !r.endsWith('/scan')), 'no save was sent');
  assert.strictEqual(loadDatabase().metadata[mix.id].chaptersManual, undefined);
});

test('entry point 4: the text editor\'s "Fix times..." opens the SAME time editor, and refuses while the textarea holds unsaved typing', async () => {
  const mix = seedMix();
  const { common, fetchImpl } = bootEditor();
  // The time editor opened from the text editor uses the global fetch path; route it.
  const realFetch = global.fetch;
  global.fetch = (url, init) => (String(url).startsWith('/') ? fetchImpl(url, init) : realFetch(url, init));
  try {
    const text = FIVE.map((c) => common.formatSnapTime(c.startTime) + ' ' + c.title).join('\n');
    const ed = common.showChaptersEditor(mix.id, text, () => {}, dom.window.document);
    assert.ok(ed.snapBtn, 'the text editor offers "Fix times..."');
    ed.textarea.value = text + '\n5:00 A typed extra';
    click(ed.snapBtn);
    assert.match(ed.statusEl.textContent, /Save or undo your typed changes first/);
    assert.strictEqual(dom.window.document.querySelectorAll('.chapter-snap-modal').length, 0, 'no time editor over unsaved typing');
    ed.textarea.value = text;
    click(ed.snapBtn);
    await until(() => dom.window.document.querySelectorAll('.chapter-snap-row').length === 5, 'the time editor rendered the stored chapters');
    assert.strictEqual(dom.window.document.querySelectorAll('.chapter-snap-modal').length, 1, 'exactly ONE time editor');
    // A single-chapter text list never offers it.
    const lone = common.showChaptersEditor(mix.id, '0:00 Only', () => {}, dom.window.document);
    assert.strictEqual(lone.snapBtn, null);
  } finally {
    global.fetch = realFetch;
  }
});
