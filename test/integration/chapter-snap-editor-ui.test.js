'use strict';

// [INTEGRATION] Chapter Snap (2026-09-24): the ONE time editor (common.js
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
//   - a dirty Cancel asks first, in the standard confirm dialog (Keep editing keeps the edits);
//   - the text editor's "Fix times..." (entry point 4) opens the SAME editor and
//     refuses while the textarea holds unsaved typing.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chapter-snap-ui-'));

const { test, before, after, afterEach } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { app, getMediaId, loadDatabase, updateDatabase, chapterSilenceService, recordRepulledItemMeta } = require('../../server');
const { seedState } = require('../helpers/seed-state');
const { authenticateFetch } = require('../helpers/auth');
const { SILENCE_PARAMS_KEY } = require('../../lib/media/chapterSilence');
const { drainSheets } = require('../helpers/ui-dialogs');

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
afterEach(async () => {
  // Sweep S9: the editor is a ui.sheet; a closing sheet finishes on a timer (~320ms in jsdom,
  // no transitionend) - let it finish while the window it needs still exists.
  if (dom) await drainSheets(dom.window);
  if (dom) dom.window.close();
  dom = null;
  delete global.window; delete global.document;
  delete require.cache[COMMON];
});

const FIVE = [
  { startTime: 0, title: 'Opening' }, { startTime: 60, title: 'Second Song' }, { startTime: 120, title: 'Third Song' },
  { startTime: 180, title: 'Fourth Song' }, { startTime: 240, title: 'Closer' },
];

function seedMix(opts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-chapter-snap-ui-lib-'));
  fs.mkdirSync(path.join(root, 'Chan'));
  const filePath = path.join(root, 'Chan', 'mix.mp3');
  fs.writeFileSync(filePath, 'mix-bytes');
  const id = getMediaId(filePath);
  const mix = { id, name: 'mix.mp3', title: 'The Mix', filePath, folderName: 'Chan', rootFolder: root, type: 'audio', ext: '.mp3', duration: 300, size: 9, addedAt: 1, chapters: FIVE.map((c) => ({ ...c })) };
  seedState({ folders: [root], folderSettings: {}, settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 0 }, liked: [], metadata: { [id]: mix } });
  const st = fs.statSync(filePath);
  if (!(opts && opts.noSilence)) chapterSilenceService.cache.write(id, { params: SILENCE_PARAMS_KEY, size: st.size, mtimeMs: st.mtimeMs, silences: [{ start: 58, end: 62 }, { start: 183, end: 185 }] });
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
// v1.341.1: the discard question is the standard confirm dialog, opened ON TOP of the editor
// (the in-page band was missed: "can't close that chapter window").
const discardDialog = () => [...dom.window.document.querySelectorAll('.ui-sheet--dialog:not(.is-closing)')].find((x) => /Discard your changes/.test(x.textContent) && !x.contains(dom.window.document.querySelector('.chapter-snap-editor')));
const answerDiscard = (yes) => { const dlg = discardDialog(); assert.ok(dlg, 'the discard dialog is up'); click(dlg.querySelector('.ui-confirm__actions .ui-btn--' + (yes ? 'primary' : 'secondary'))); };
const settleUi = () => new Promise((r) => setImmediate(r));
const rowsOf = (h) => Array.from(h.list.querySelectorAll('.chapter-snap-item'));

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
  assert.match(rows[1].querySelector('.chapter-snap-note').textContent, /silence/);
  assert.match(rows[3].querySelector('.chapter-snap-note').textContent, /end of the previous song/);
  assert.match(rows[2].querySelector('.chapter-snap-note').textContent, /No gap found/);
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

// Step 7 (UI pass): every editor control is a ui-btn with ONE .ui-btn__label (a relabel -
// "Snap all (2)" -> "Snap all", the confirm's Revert/Keep words, the suggested shift - goes
// through the label, never a bare textContent that would strip the primitive's parts); the
// Edited badge is a meta chip; Play carries the registry play_arrow, never the .icon-play mask.
test('step 7: every editor button is a ui-btn md with one label (relabels keep it), the Edited badge a meta chip, Play the registry glyph', async () => {
  const mix = seedMix();
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  const buttons = Array.from(h.modal.querySelectorAll('button'));
  assert.ok(buttons.length > 20, 'the scan reached the editor\'s controls: ' + buttons.length);
  const check = (label) => {
    for (const b of h.modal.querySelectorAll('button')) {
      assert.ok(b.classList.contains('ui-btn') && b.classList.contains('ui-btn--md'), label + ': ' + b.className + ' is a ui-btn md');
      assert.ok(!b.classList.contains('btn'), label + ': no legacy .btn');
      assert.strictEqual(b.querySelectorAll(':scope > .ui-btn__label').length, 1, label + ': one label in ' + b.className);
    }
  };
  check('first paint');
  assert.ok(h.snapAllBtn.classList.contains('ui-btn--primary') && h.saveBtn.classList.contains('ui-btn--primary'), 'Snap all and Save are the primary fills');
  assert.ok(h.cancelBtn.classList.contains('ui-btn--secondary'), 'Cancel is secondary');
  assert.strictEqual(h.snapAllBtn.querySelector('.ui-btn__label').textContent, 'Snap all (2)');
  click(h.snapAllBtn); // relabels Snap all, re-renders every row
  assert.strictEqual(h.snapAllBtn.querySelector('.ui-btn__label').textContent, 'Snap all', 'the relabel landed in the label');
  check('after a relabel and a re-render');
  const badge = h.modal.querySelector('.chapter-snap-badge');
  assert.ok(badge.classList.contains('ui-chip') && badge.classList.contains('ui-chip--meta'), 'the Edited badge is a meta chip');
  const play = rowsOf(h)[1].querySelector('[data-act="play"]');
  assert.strictEqual(play.querySelector('.ui-btn__label').textContent, 'Play from here');
  assert.strictEqual(play.querySelector('.ui-btn__icon use').getAttribute('href'), '#i-play_arrow', 'the registry glyph in the icon slot');
  assert.strictEqual(h.modal.querySelector('.icon-play'), null, 'no .icon-play mask');
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
  assert.strictEqual(h.confirmBox.hidden, true, 'no easy-to-miss band in the editor head');
  assert.ok(discardDialog(), 'a confirm dialog asks, on top of the editor');
  click(h.cancelBtn);
  assert.strictEqual(dom.window.document.querySelectorAll('.ui-sheet--dialog:not(.is-closing)').length, 2, 'a second Cancel does not stack a second question');
  answerDiscard(false);
  await settleUi();
  assert.strictEqual(h.isClosed(), false);
  assert.strictEqual(h.saveBtn.disabled, false, 'Keep editing keeps the edits');
  click(h.cancelBtn);
  answerDiscard(true);
  await settleUi();
  assert.strictEqual(h.isClosed(), true, 'Discard closes the editor');
  assert.ok(!requests.some((r) => r.startsWith('POST ') && !r.endsWith('/scan')), 'no save was sent');
  assert.strictEqual(loadDatabase().metadata[mix.id].chaptersManual, undefined);
});

// Sweep S9: the SHELL is a ui.sheet dialog. Its own ways out - Esc, the scrim, its Close -
// ASK exactly like Cancel (the sheet's canDismiss): with unsaved corrections they open the discard
// confirm dialog and the editor stays; with none they close it.
for (const how of ['esc', 'scrim', 'close']) {
  test(`S9 shell: ${how} with unsaved corrections asks first (the editor stays); ${how} on a clean editor closes it`, async () => {
    const mix = seedMix();
    const { common, fetchImpl, requests } = bootEditor();
    const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
    await h.ready;
    const d = dom.window.document;
    assert.ok(h.sheet.el.classList.contains('ui-sheet--dialog'), 'a ui.sheet dialog');
    assert.strictEqual(h.sheet.el.querySelector('.ui-sheet__title').textContent, 'Fix chapter times');
    assert.strictEqual(h.modal.parentElement, h.sheet.body, 'the editor is the sheet content');
    assert.strictEqual(d.querySelector('.modal-backdrop'), null, 'no bespoke backdrop');
    const out = () => {
      if (how === 'esc') d.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      else if (how === 'scrim') click(h.sheet.scrim);
      else click(h.sheet.el.querySelector('.ui-sheet__close'));
    };
    click(h.snapAllBtn); // unsaved corrections
    out();
    assert.strictEqual(h.isClosed(), false, how + ' never discards unsaved corrections silently');
    assert.strictEqual(h.sheet.isOpen(), true);
    assert.ok(discardDialog(), 'the discard confirm dialog asks, on top');
    answerDiscard(false);
    await settleUi();
    await drainSheets(dom.window);
    click(h.undoBtn); // back to clean
    out();
    assert.strictEqual(h.isClosed(), true, how + ' closes a clean editor');
    assert.strictEqual(h.sheet.isOpen(), false);
    assert.ok(!requests.some((r) => r.startsWith('POST ') && !r.endsWith('/scan')), 'nothing was written');
  });
}

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
    assert.strictEqual(dom.window.document.querySelectorAll('.chapter-snap-editor').length, 0, 'no time editor over unsaved typing');
    ed.textarea.value = text;
    click(ed.snapBtn);
    await until(() => dom.window.document.querySelectorAll('.chapter-snap-item').length === 5, 'the time editor rendered the stored chapters');
    assert.strictEqual(dom.window.document.querySelectorAll('.chapter-snap-editor').length, 1, 'exactly ONE time editor');
    // A single-chapter text list never offers it.
    const lone = common.showChaptersEditor(mix.id, '0:00 Only', () => {}, dom.window.document);
    assert.strictEqual(lone.snapBtn, null);
  } finally {
    global.fetch = realFetch;
  }
});

// ---- gate r1 fixes ---------------------------------------------------------------

test('Snap all touches ONLY untouched rows with a suggestion (qa W1): a nudged no-gap row and a hand-tuned row keep their times, and the button counts the same set', async () => {
  const mix = seedMix();
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  const nudge = (i, delta) => click(rowsOf(h)[i].querySelector('[data-act="nudge"][data-delta="' + delta + '"]'));
  const now = (i) => rowsOf(h)[i].querySelector('.chapter-snap-now').textContent;
  assert.match(h.snapAllBtn.textContent, /Snap all \(2\)/, 'precondition: two suggestions');
  nudge(2, '1'); // chapter 3 has NO gap - the user moved it by ear
  assert.strictEqual(now(2), '2:01.0');
  assert.match(h.snapAllBtn.textContent, /Snap all \(2\)/, 'a nudged no-gap row is not "pending"');
  nudge(1, '0.1'); // chapter 2 HAS a suggestion, but the user tuned it by hand
  assert.match(h.snapAllBtn.textContent, /Snap all \(1\)/, 'a hand-tuned row leaves the plan');
  click(h.snapAllBtn);
  assert.strictEqual(now(1), '1:00.1', 'the hand-tuned chapter 2 kept its time');
  assert.strictEqual(now(2), '2:01.0', 'the nudged chapter 3 kept its time');
  assert.strictEqual(now(3), '3:04.8', 'the untouched suggested chapter 4 snapped');
  assert.match(h.statusEl.textContent, /Snapped 1 start/, 'the status counts what was applied');
  click(h.saveBtn);
  await until(() => h.isClosed(), 'saved');
  assert.deepStrictEqual(loadDatabase().metadata[mix.id].chaptersManual.map((c) => c.startTime), [0, 60.1, 121, 184.75, 240]);
});

test('the nudge clamps at the NEXT chapter and at the end of the file (adversary ME)', async () => {
  const mix = seedMix();
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  const nudge = (i, delta) => click(rowsOf(h)[i].querySelector('[data-act="nudge"][data-delta="' + delta + '"]'));
  const now = (i) => rowsOf(h)[i].querySelector('.chapter-snap-now').textContent;
  for (let k = 0; k < 70; k++) nudge(1, '1');
  assert.strictEqual(now(1), '1:59.9', 'never at or past chapter 3 (the server min gap)');
  for (let k = 0; k < 70; k++) nudge(4, '1');
  assert.strictEqual(now(4), '4:59.9', 'the last chapter stops before the end of the file');
  h.close();
});

test('the poll refuses a STALE seed (adversary MG): a text save lands while the silence scan runs -> the editor says so and Save stays off', async () => {
  const mix = seedMix({ noSilence: true });
  const { common, fetchImpl } = bootEditor();
  // Hold the scan "running" in the poll's eyes so the poll path (not the load) meets the change.
  const held = (url, init) => fetchImpl(url, init).then((r) => {
    if ((init && init.method) || url.indexOf('/scan') !== -1) return r;
    return r.json().then((b) => { if (b && b.silence) b.silence = { state: 'running' }; return { ok: r.ok, status: r.status, json: async () => b }; });
  });
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl: held, pollMs: 120, doc: dom.window.document });
  await h.ready;
  const text = '0:00 Opening\n1:05 Second Song\n2:00 Third Song\n3:00 Fourth Song\n4:00 Closer';
  assert.strictEqual((await fetch(base + '/api/videos/' + encodeURIComponent(mix.id) + '/chapters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })).status, 200);
  click(rowsOf(h)[2].querySelector('[data-act="nudge"][data-delta="1"]')); // a pending local edit
  await until(() => /changed somewhere else/.test(h.statusEl.textContent), 'the poll noticed the change');
  assert.strictEqual(h.saveBtn.disabled, true, 'Save is off for the stale seed');
  h.close();
});

test('a poll that finds the scan GONE (a server restart: none/stale) says so and offers Try again (qa S5)', async () => {
  const mix = seedMix({ noSilence: true });
  const { common, fetchImpl } = bootEditor();
  let polls = 0;
  const shaped = (url, init) => fetchImpl(url, init).then((r) => {
    if ((init && init.method) || url.indexOf('/scan') !== -1) return r;
    return r.json().then((b) => {
      polls += 1;
      // load: "running" (a scan in flight); every later poll: "none" (the restart lost it)
      if (b && b.silence) b.silence = { state: polls === 1 ? 'running' : 'none' };
      return { ok: r.ok, status: r.status, json: async () => b };
    });
  });
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl: shaped, pollMs: 30, doc: dom.window.document });
  await h.ready;
  await until(() => polls >= 2 && /stopped before it finished/.test(h.statusEl.textContent), 'the stall is reported');
  const retry = h.modal.querySelector('.chapter-snap-retry');
  assert.strictEqual(retry.hidden, false, 'Try again is offered');
  h.close();
});

test('Stop before the audio metadata arrives cancels the pending audition (qa S6)', async () => {
  const mix = seedMix();
  const { common, fetchImpl } = bootEditor();
  let plays = 0;
  // A REAL jsdom <audio> whose metadata has not arrived yet (readyState 0).
  const fake = dom.window.document.createElement('audio');
  Object.defineProperty(fake, 'readyState', { configurable: true, get: () => 0 });
  fake.play = () => { plays += 1; return Promise.resolve(); };
  fake.pause = () => {};
  fake.load = () => {};
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document, audioFactory: () => fake });
  await h.ready;
  const playBtn = () => rowsOf(h)[1].querySelector('[data-act="play"]');
  click(playBtn());
  assert.match(playBtn().textContent, /Stop/, 'the row shows it is starting');
  click(playBtn()); // Stop, before any metadata
  fake.dispatchEvent(new dom.window.Event('loadedmetadata'));
  assert.strictEqual(plays, 0, 'the late metadata never starts playback');
  h.close();
});

test('Revert RE-PLANS when the source changed after the editor opened (adversary W2): the first Revert is refused and nothing moves; the confirm then names the NEW count', async () => {
  const mix = seedMix();
  const snapUrl = base + '/api/videos/' + encodeURIComponent(mix.id) + '/chapter-snap';
  const s = await (await fetch(snapUrl)).json();
  assert.strictEqual((await fetch(snapUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: s.version, starts: s.snapAll }) })).status, 200);
  const { common, fetchImpl } = bootEditor();
  const h = common.showChapterSnapEditor(mix.id, { fetchImpl, pollMs: 60000, doc: dom.window.document });
  await h.ready;
  click(h.revertBtn);
  assert.match(h.confirmBox.textContent, /count does not change/, 'the confirm names the plan it saw (5 chapters)');
  // A reheat re-pulls the source as SIX chapters while the confirm is open.
  const six = FIVE.map((c) => ({ ...c })).concat([{ startTime: 280, title: 'Bonus' }]);
  await recordRepulledItemMeta({ loadDatabase, updateDatabase, getMediaId }, mix.id, { filePath: mix.filePath, chapters: six, markComplete: false }, 1_900_000_000_000);
  click(h.confirmBox.querySelector('.chapter-snap-confirm-yes'));
  await until(() => /nothing was reverted/.test(h.statusEl.textContent), 'the stale revert is refused and re-planned');
  assert.strictEqual(loadDatabase().metadata[mix.id].chaptersManual.length, 5, 'nothing reverted onto the unconfirmed source');
  click(h.revertBtn);
  assert.match(h.confirmBox.textContent, /6 chapters instead of 5/, 'the new confirm names the NEW target');
  click(h.confirmBox.querySelector('.chapter-snap-confirm-yes'));
  await until(() => h.isClosed(), 'the confirmed revert lands');
  assert.strictEqual(loadDatabase().metadata[mix.id].chaptersManual, undefined);
});
