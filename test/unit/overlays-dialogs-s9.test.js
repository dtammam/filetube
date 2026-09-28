'use strict';

// [UNIT] Sweep S9 (D4.6, D4.8, F30, F44, F47): the common.js dialogs on ui.sheet, driven for
// real - common.js + ui.js in jsdom, every way in and out a user has (the buttons, Close, Esc,
// the scrim, a double tap, a tap on a dialog that is already closing), timers on the mock
// clock. These replace the fake-DOM locks of the bespoke modal families they retired (AC12):
// hard-delete-local-files (the modal half), move-modal (the modal half), share-prompt (the
// choice half), v1262-sheet-modal-transitions (the F2 confirm half) and reheat-button-wiring's
// CRITICAL 2 / 4 runtime locks - each old test's intent is named where it is kept.
//
// DESTRUCTIVE (full gate): the local-file delete (showHardDeleteModal) and every
// showConfirmModal caller that deletes reach their request ONLY through the one enabled
// confirm button of a live dialog - never through Cancel, Close, Esc, the scrim, a disabled
// button, a second tap, or a dialog the caller already dismissed.

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const COMMON = require.resolve('../../public/js/common.js');
const UI = require.resolve('../../public/js/ui.js');

let dom;
function boot(opts) {
  const o = opts || {};
  clock();
  delete global.document; delete global.window;
  delete require.cache[COMMON];
  const common = require(COMMON); // no document at require time: the boot block is skipped
  dom = new JSDOM('<!DOCTYPE html><body><button id="opener">open</button></body>', { url: 'http://localhost/' });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: q === '(max-width: 768px)' ? !!o.phone : false, media: q });
  w.scrollTo = () => {};
  global.window = w;
  global.document = w.document;
  delete require.cache[UI];
  w.ui = require(UI);
  return common;
}
// Every test runs on the mock clock (boot() enables it): a sheet's exit timer must never
// fire after the test's window is gone.
let clockOn = false;
afterEach(() => {
  mock.timers.reset();
  clockOn = false;
  if (dom) dom.window.close();
  dom = null;
  delete global.window; delete global.document;
  delete require.cache[COMMON];
});
function clock() {
  if (!clockOn) { mock.timers.enable({ apis: ['setTimeout'] }); clockOn = true; }
  return mock.timers;
}
const doc = () => dom.window.document;
const flush = () => new Promise((r) => setImmediate(r));
const sheets = () => Array.from(doc().querySelectorAll('.ui-sheet'));
const liveSheets = () => sheets().filter((s) => !s.classList.contains('is-closing'));
function top() { const l = liveSheets(); assert.ok(l.length > 0, 'a dialog is open'); return l[l.length - 1]; }
function esc() { doc().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }
function scrim() { const s = doc().querySelectorAll('.ui-scrim'); s[s.length - 1].click(); }
function closeX(sheet) { (sheet || top()).querySelector('.ui-sheet__close').click(); }
function buttons(sheet) { return Array.from((sheet || top()).querySelectorAll('.ui-confirm__actions .ui-btn')); }
function byLabel(label, sheet) {
  const b = buttons(sheet).find((x) => x.textContent.trim() === label);
  assert.ok(b, `a "${label}" button`);
  return b;
}
const noLegacyModal = () => assert.strictEqual(doc().querySelector('.modal-backdrop, .modal-content, .hard-delete-modal-backdrop, .choice-modal-list'), null, 'no bespoke modal family is built');

// ============================================================ showConfirmModal
test('showConfirmModal: a ui.confirm dialog - its title and body as TEXT (the callers\' HTML parsed inert, <br> kept as a line break), default Confirm / Cancel', () => {
  const { showConfirmModal } = boot();
  showConfirmModal('Attribute this folder?', 'Attribute <strong>3</strong> video(s) to <strong>Harbor &amp; Co</strong><br><small>/media/x</small>', () => {});
  const s = top();
  assert.ok(s.classList.contains('ui-sheet--dialog'));
  assert.strictEqual(s.querySelector('.ui-sheet__title').textContent, 'Attribute this folder?');
  const body = s.querySelector('.ui-confirm__body');
  assert.strictEqual(body.textContent, 'Attribute 3 video(s) to Harbor & Co\n/media/x');
  assert.strictEqual(body.querySelector('strong, small, br'), null, 'no caller markup becomes DOM');
  assert.deepStrictEqual(buttons().map((b) => b.textContent), ['Cancel', 'Confirm']);
  noLegacyModal();
});

test('showConfirmModal: hostile markup in a title/body never becomes an element, anywhere in the document (the old innerHTML template\'s risk)', () => {
  const { showConfirmModal, confirmHtmlToText } = boot();
  showConfirmModal('<img src=x onerror="window.__xss=1">Move?', 'a<script>window.__xss=2</script><iframe src="about:blank"></iframe>b', () => {});
  assert.strictEqual(doc().querySelectorAll('img, script, iframe').length, 0);
  assert.strictEqual(dom.window.__xss, undefined);
  assert.strictEqual(top().querySelector('.ui-sheet__title').textContent, 'Move?');
  assert.strictEqual(confirmHtmlToText('a<br/>b<BR>c &lt;d&gt;'), 'a\nb\nc <d>');
  assert.strictEqual(confirmHtmlToText(null), '');
});

test('showConfirmModal labels: {confirm, cancel} land by textContent (a caller string never becomes markup); danger:true gives OK the destructive fill', () => {
  const { showConfirmModal } = boot();
  showConfirmModal('File under the channel?', 'x', () => {}, { confirm: 'Move <b>it</b>', cancel: 'Leave it where it is' });
  assert.deepStrictEqual(buttons().map((b) => b.textContent), ['Leave it where it is', 'Move <b>it</b>']);
  assert.strictEqual(top().querySelector('b'), null);
  assert.strictEqual(byLabel('Move <b>it</b>').classList.contains('ui-btn--destructive'), false, 'not destructive unless asked');
  showConfirmModal('Move to Trash?', 'y', () => {}, { confirm: 'Move to Trash', danger: true });
  assert.ok(byLabel('Move to Trash').classList.contains('ui-btn--destructive'));
});

// v1.26.2 F2 (was v1262-sheet-modal-transitions: double-click Confirm / Confirm then Cancel /
// double-click Cancel): one answer per dialog.
test('F2 showConfirmModal: a double tap on Confirm runs onConfirm exactly ONCE; Confirm then Cancel does not re-run it', async () => {
  const t = clock();
  const { showConfirmModal } = boot();
  let calls = 0;
  showConfirmModal('Move to Trash?', 'x', () => { calls++; });
  const s = top();
  const ok = byLabel('Confirm', s);
  const cancel = byLabel('Cancel', s);
  ok.click();
  ok.click();
  cancel.click();
  await flush();
  assert.strictEqual(calls, 1);
  t.tick(400);
  assert.strictEqual(s.isConnected, false, 'the dialog is gone after its exit');
});

test('showConfirmModal: EVERY way out but Confirm - Cancel, Close, Esc, the scrim - never runs onConfirm, and a late Confirm on the closing dialog does not either', async () => {
  const t = clock();
  const { showConfirmModal } = boot();
  for (const how of ['cancel', 'close', 'esc', 'scrim']) {
    let calls = 0;
    showConfirmModal('Move to Trash?', 'x', () => { calls++; }, { danger: true });
    const s = top();
    const ok = byLabel('Confirm', s);
    if (how === 'cancel') byLabel('Cancel', s).click();
    else if (how === 'close') closeX(s);
    else if (how === 'esc') esc();
    else scrim();
    assert.ok(s.classList.contains('is-closing'), how + ' closes it');
    ok.click(); // the finger that was already on its way
    await flush();
    assert.strictEqual(calls, 0, how + ' must never confirm');
    t.tick(400);
  }
});

test('showConfirmModal dismiss(): closes the dialog as a cancel (the view-teardown handle, v1.49 W2); after an answer it is a no-op', async () => {
  const t = clock();
  const { showConfirmModal } = boot();
  let calls = 0;
  const dismiss = showConfirmModal('Move it?', 'x', () => { calls++; });
  const s = top();
  const ok = byLabel('Confirm', s);
  dismiss();
  assert.ok(s.classList.contains('is-closing'));
  ok.click();
  await flush();
  assert.strictEqual(calls, 0, 'a dismissed dialog never confirms');
  t.tick(400);
  let calls2 = 0;
  const dismiss2 = showConfirmModal('Again?', 'x', () => { calls2++; });
  byLabel('Confirm').click();
  await flush();
  dismiss2();
  assert.strictEqual(calls2, 1);
});

// v1.49 CRITICAL 2 (was reheat-button-wiring: buttons resolved from ITS OWN backdrop): two
// dialogs up at once each answer only for themselves.
test('CRITICAL 2: two confirms open at once - each Confirm runs only its OWN onConfirm (no shared ids to re-bind)', async () => {
  const { showConfirmModal } = boot();
  const ran = [];
  showConfirmModal('Delete?', 'first', () => ran.push('delete'));
  const first = top();
  showConfirmModal('Move it?', 'second', () => ran.push('move'));
  const second = top();
  assert.notStrictEqual(first, second);
  byLabel('Confirm', second).click();
  await flush();
  assert.deepStrictEqual(ran, ['move']);
  byLabel('Confirm', first).click();
  await flush();
  assert.deepStrictEqual(ran, ['move', 'delete']);
});

// v1.49 CRITICAL 4 (was reheat-button-wiring's fake-DOM runtime lock): when onConfirm runs -
// the instant the watch page's relocation re-ask fires - the confirm that triggered it is
// still attached but marked closing, so isLiveDialogOpen() sees no LIVE dialog (the re-ask
// can open) while a bare `.ui-sheet` query would still match it.
test('CRITICAL 4 (runtime): at onConfirm time the triggering dialog is still attached, is-closing, and isLiveDialogOpen() is false', async () => {
  const { showConfirmModal, isLiveDialogOpen } = boot();
  let sawBare = null;
  let sawLive = null;
  showConfirmModal('File this video under its channel?', 'x', () => {
    sawBare = doc().querySelector('.ui-sheet');
    sawLive = isLiveDialogOpen();
  });
  assert.strictEqual(isLiveDialogOpen(), true, 'an open dialog is live');
  byLabel('Confirm').click();
  await flush();
  assert.ok(sawBare && sawBare.isConnected && sawBare.classList.contains('is-closing'), 'still attached, on its way out');
  assert.strictEqual(sawLive, false, 'not a live dialog - the re-ask may open');
});

// ============================================================ showChoiceModal
// (was share-prompt: textContent labels, one button per choice, settle-once, Cancel settles)
test('showChoiceModal: a ui.menu of one row per choice; title and labels are TEXT; malformed choices are skipped', () => {
  const { showChoiceModal } = boot();
  showChoiceModal('<img src=x onerror=alert(1)>Share', [
    { label: '<b>Share video</b>', onPick() {} },
    null,
    { label: 42 },
    { label: 'Share at current time (1:05)', onPick() {} },
  ]);
  const s = top();
  assert.strictEqual(s.querySelector('.ui-sheet__title').textContent, '<img src=x onerror=alert(1)>Share');
  const rows = Array.from(s.querySelectorAll('.ui-list .ui-row'));
  assert.deepStrictEqual(rows.map((r) => r.querySelector('.ui-row__title').textContent), ['<b>Share video</b>', 'Share at current time (1:05)']);
  assert.ok(rows.every((r) => r.tagName === 'BUTTON'), 'each choice is a button row');
  assert.strictEqual(doc().querySelectorAll('img, b').length, 0);
  noLegacyModal();
});

test('showChoiceModal: a pick runs its onPick exactly ONCE and SYNCHRONOUSLY inside the tap (navigator.share keeps the gesture); a second tap picks nothing', () => {
  clock();
  const { showChoiceModal } = boot();
  const picks = [];
  showChoiceModal('Share', [{ label: 'A', onPick: () => picks.push('a') }, { label: 'B', onPick: () => picks.push('b') }]);
  const rows = Array.from(top().querySelectorAll('.ui-row'));
  rows[0].click();
  assert.deepStrictEqual(picks, ['a'], 'ran inside the click, before any await');
  rows[0].click();
  rows[1].click();
  assert.deepStrictEqual(picks, ['a'], 'one pick per dialog');
});

test('showChoiceModal: Close, Esc and the scrim settle with NO pick; dismiss() closes it', () => {
  const t = clock();
  const { showChoiceModal } = boot();
  for (const how of ['close', 'esc', 'scrim', 'dismiss']) {
    const picks = [];
    const dismiss = showChoiceModal('More', [{ label: 'Delete', onPick: () => picks.push('x') }]);
    const s = top();
    const row = s.querySelector('.ui-row');
    if (how === 'close') closeX(s);
    else if (how === 'esc') esc();
    else if (how === 'scrim') scrim();
    else dismiss();
    assert.ok(s.classList.contains('is-closing'), how);
    row.click();
    assert.deepStrictEqual(picks, [], how + ' picks nothing, and a tap on the closing menu picks nothing');
    t.tick(400);
  }
});

test('showChoiceModal: a bottom sheet on a phone, a dialog on desktop', () => {
  let { showChoiceModal } = boot({ phone: true });
  showChoiceModal('Share', [{ label: 'A', onPick() {} }]);
  assert.ok(top().classList.contains('ui-sheet--bottom'));
  dom.window.close();
  ({ showChoiceModal } = boot({ phone: false }));
  showChoiceModal('Share', [{ label: 'A', onPick() {} }]);
  assert.ok(top().classList.contains('ui-sheet--dialog'));
});

// ============================================================ showHardDeleteModal (F44)
const LOCAL_ITEM = { id: 'abc123', title: 'My Home Movie', filePath: '/media/downloads/home_movie.mp4' };

// F44: the title and the button say what the route does. The delete a local file's dialog
// gates is the callers' `onConfirm`: watch.js performMediaDelete / skin-surface.js doDelete,
// both `DELETE /api/videos/:id`, whose handler moves the file to TRASH (trashItem - an atomic
// rename into the root's trash dir, restorable from Settings; the route never unlinks a
// resolvable file). The copy is bound to that path: if the route ever deletes permanently,
// this test names the copy that must change with it.
test('F44: the dialog says "Move this local file to Trash?" and its button "Move to Trash" - agreeing with the route its callers run (a trash move)', () => {
  const { showHardDeleteModal } = boot();
  const m = showHardDeleteModal(LOCAL_ITEM, () => {}, doc());
  assert.strictEqual(m.title.textContent, 'Move this local file to Trash?');
  assert.strictEqual(m.deleteBtn.textContent, 'Move to Trash');
  assert.doesNotMatch(m.sheet.textContent, /permanent/i, 'no word of a permanent delete: the file goes to Trash');
  assert.ok(m.deleteBtn.classList.contains('ui-btn--destructive') && m.deleteBtn.classList.contains('ui-btn--primary'), 'the ONE danger fill');
  assert.strictEqual(m.sheet.querySelectorAll('.ui-btn--destructive').length, 1, 'one danger treatment, not four');
  // the code path the copy describes
  const watchJs = fs.readFileSync(path.join(ROOT, 'public/js/watch.js'), 'utf8');
  const skinJs = fs.readFileSync(path.join(ROOT, 'public/js/skin-surface.js'), 'utf8');
  const routes = fs.readFileSync(path.join(ROOT, 'lib/media/routes.js'), 'utf8');
  // Merge note (S9 onto S3 + S7): the watch page and the Pocket extras no longer open this
  // dialog - both ask ONE danger ui.confirm with main.js cardDeleteConfirmCopy (whose local-file
  // copy is the same Trash truth), then run the same DELETE. showHardDeleteModal has no caller
  // left; step 7 retires it. Bound here so a caller cannot quietly come back to a dead dialog.
  assert.match(watchJs, /ui\.confirm\(Object\.assign\(\{\}, cardDeleteConfirmCopy\(mediaData\)/);
  assert.match(watchJs, /async function performMediaDelete\(\) \{[\s\S]{0,600}?fetch\(`\/api\/videos\/\$\{mediaId\}`, \{ method: 'DELETE' \}\)/);
  assert.match(skinJs, /window\.cardDeleteConfirmCopy\(item\)/);
  assert.doesNotMatch(watchJs + skinJs, /showHardDeleteModal\(/);
  const del = routes.slice(routes.indexOf("app.delete('/api/videos/:id'"), routes.indexOf("app.delete('/api/videos/:id'") + 12000);
  assert.match(del, /const tr = await trashItem\(/, 'DELETE /api/videos/:id moves a resolvable file to Trash');
  assert.doesNotMatch(del.slice(0, del.indexOf('const tr = await trashItem(')), /unlinkSync|fs\.promises\.unlink|await unlink\(/, 'no unlink before the trash move');
});

test('showHardDeleteModal: a ui.sheet dialog appended to the body at once (self-contained), Move to Trash starts DISABLED', () => {
  const { showHardDeleteModal } = boot();
  const m = showHardDeleteModal(LOCAL_ITEM, () => {}, doc());
  assert.ok(m.sheet.classList.contains('ui-sheet') && m.sheet.classList.contains('ui-sheet--dialog'));
  assert.strictEqual(m.sheet.parentNode, doc().body);
  assert.ok(m.sheet.classList.contains('hard-delete-dialog'), 'its content-layout hook survives open() (set after it)');
  assert.strictEqual(m.deleteBtn.disabled, true);
  noLegacyModal();
});

test('showHardDeleteModal: ticking the checkbox enables the button; unticking disables it again', () => {
  const { showHardDeleteModal } = boot();
  const m = showHardDeleteModal(LOCAL_ITEM, () => {}, doc());
  m.checkbox.checked = true;
  m.checkbox.dispatchEvent(new dom.window.Event('change'));
  assert.strictEqual(m.deleteBtn.disabled, false);
  m.checkbox.checked = false;
  m.checkbox.dispatchEvent(new dom.window.Event('change'));
  assert.strictEqual(m.deleteBtn.disabled, true);
});

test('showHardDeleteModal: the button while still disabled never calls onConfirm and leaves the dialog open (even a scripted .click())', () => {
  const { showHardDeleteModal } = boot();
  let confirmed = 0;
  const m = showHardDeleteModal(LOCAL_ITEM, () => { confirmed++; }, doc());
  m.deleteBtn.click();
  m.deleteBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(confirmed, 0);
  assert.strictEqual(m.sheet.classList.contains('is-closing'), false, 'still open');
});

test('showHardDeleteModal: tick then Move to Trash calls onConfirm exactly ONCE (a double tap too) and closes the dialog', () => {
  const t = clock();
  const { showHardDeleteModal } = boot();
  let confirmed = 0;
  const m = showHardDeleteModal(LOCAL_ITEM, () => { confirmed++; }, doc());
  m.checkbox.checked = true;
  m.checkbox.dispatchEvent(new dom.window.Event('change'));
  m.deleteBtn.click();
  m.deleteBtn.click();
  assert.strictEqual(confirmed, 1);
  assert.ok(m.sheet.classList.contains('is-closing'));
  t.tick(400);
  assert.strictEqual(m.sheet.isConnected, false, 'fully detached, never a stuck overlay');
});

test('showHardDeleteModal: Cancel, Close, Esc and the scrim each close it WITHOUT onConfirm - even with the box ticked, and a late tap after', () => {
  const t = clock();
  const { showHardDeleteModal } = boot();
  for (const how of ['cancel', 'close', 'esc', 'scrim', 'teardown']) {
    let confirmed = 0;
    const m = showHardDeleteModal(LOCAL_ITEM, () => { confirmed++; }, doc());
    m.checkbox.checked = true;
    m.checkbox.dispatchEvent(new dom.window.Event('change'));
    if (how === 'cancel') m.cancelBtn.click();
    else if (how === 'close') closeX(m.sheet);
    else if (how === 'esc') esc();
    else if (how === 'scrim') scrim();
    else m.teardown();
    assert.ok(m.sheet.classList.contains('is-closing'), how + ' closes it');
    m.deleteBtn.click();
    assert.strictEqual(confirmed, 0, how + ': never onConfirm');
    t.tick(400);
    assert.strictEqual(m.sheet.isConnected, false, how + ': fully detached');
  }
});

test('showHardDeleteModal: a click inside the dialog (its text, the file card) does not close it', () => {
  const { showHardDeleteModal } = boot();
  const m = showHardDeleteModal(LOCAL_ITEM, () => {}, doc());
  m.nameEl.click();
  m.warning.click();
  assert.strictEqual(m.sheet.classList.contains('is-closing'), false);
});

test('showHardDeleteModal: a hostile title/filePath is inert text (textContent), never markup', () => {
  const { showHardDeleteModal } = boot();
  const hostileTitle = '<img src=x onerror=alert(1)>';
  const hostilePath = '/media/"><script>window.__xss = true;</script>.mp4';
  const m = showHardDeleteModal({ title: hostileTitle, filePath: hostilePath }, () => {}, doc());
  assert.strictEqual(m.nameEl.textContent, hostileTitle);
  assert.strictEqual(m.pathEl.textContent, hostilePath);
  assert.strictEqual(m.sheet.querySelectorAll('img, script').length, 0);
});

test('showHardDeleteModal: a missing title reads "this file"; a malformed item never throws', () => {
  const { showHardDeleteModal } = boot();
  assert.strictEqual(showHardDeleteModal({ filePath: '/media/x.mp4' }, () => {}, doc()).nameEl.textContent, 'this file');
  assert.doesNotThrow(() => showHardDeleteModal(null, () => {}, doc()));
  assert.doesNotThrow(() => showHardDeleteModal(undefined, () => {}, doc()));
});

test('showHardDeleteModal source assigns no innerHTML (static regression guard, kept)', () => {
  const { showHardDeleteModal } = boot();
  assert.doesNotMatch(showHardDeleteModal.toString().replace(/\/\/.*$/gm, ''), /\.innerHTML\s*=/);
});

// ============================================================ showMoveModal
// (was move-modal.test.js's fake-DOM half: every intent kept, in a real DOM)
const ITEM = { id: 'x1', title: 'Clip' };
const FOLDERS = ['/media/lib', '/media/other'];
function pickFolder(m, v) { m.select.value = v; }

test('showMoveModal: a ui.sheet dialog appended to the body at once, titled "Move to…", its folders a ui-select with exactly the given folders as option values', () => {
  const { showMoveModal } = boot();
  const m = showMoveModal(ITEM, FOLDERS, () => {}, doc());
  assert.ok(m.sheet.classList.contains('ui-sheet--dialog') && m.sheet.parentNode === doc().body);
  assert.ok(m.sheet.classList.contains('move-dialog'));
  assert.strictEqual(m.title.textContent, 'Move to…');
  assert.ok(m.select.classList.contains('ui-select__native'));
  assert.deepStrictEqual(Array.from(m.select.options).map((o) => o.value), FOLDERS);
  assert.ok(m.moveBtn.classList.contains('ui-btn--primary') && m.cancelBtn.classList.contains('ui-btn--secondary'));
  noLegacyModal();
});

test('showMoveModal: the item title is inert text; a missing title falls back to "this file"', () => {
  const { showMoveModal } = boot();
  const m = showMoveModal({ id: 'x', title: '<img src=x onerror=alert(1)>' }, FOLDERS, () => {}, doc());
  assert.strictEqual(m.label.textContent, 'Move "<img src=x onerror=alert(1)>" to:');
  assert.strictEqual(m.sheet.querySelector('img'), null);
  assert.strictEqual(showMoveModal({ id: 'n' }, FOLDERS, () => {}, doc()).label.textContent, 'Move "this file" to:');
});

test('showMoveModal: Move is DISABLED with no folders (and a click never calls onMove); enabled with at least one', () => {
  const { showMoveModal } = boot();
  let calls = 0;
  const none = showMoveModal(ITEM, [], () => { calls++; }, doc());
  assert.strictEqual(none.moveBtn.disabled, true);
  none.moveBtn.click();
  assert.strictEqual(calls, 0);
  assert.strictEqual(showMoveModal(ITEM, FOLDERS, () => {}, doc()).moveBtn.disabled, false);
});

test('showMoveModal: Move calls onMove(target, {teardown, statusEl, reenable}) exactly once, and never tears down by itself', () => {
  const { showMoveModal } = boot();
  const calls = [];
  const m = showMoveModal(ITEM, FOLDERS, (target, ctx) => calls.push([target, typeof ctx.teardown, ctx.statusEl === m.statusEl, typeof ctx.reenable]), doc());
  pickFolder(m, '/media/other');
  m.moveBtn.click();
  assert.deepStrictEqual(calls, [['/media/other', 'function', true, 'function']]);
  assert.strictEqual(m.sheet.classList.contains('is-closing'), false, 'the caller controls teardown');
});

test('showMoveModal: Cancel closes without onMove; the caller\'s teardown() closes and detaches it', () => {
  const t = clock();
  const { showMoveModal } = boot();
  let calls = 0;
  const a = showMoveModal(ITEM, FOLDERS, () => { calls++; }, doc());
  a.cancelBtn.click();
  assert.ok(a.sheet.classList.contains('is-closing'));
  assert.strictEqual(calls, 0);
  const b = showMoveModal(ITEM, FOLDERS, (target, ctx) => ctx.teardown(), doc());
  pickFolder(b, '/media/lib');
  b.moveBtn.click();
  t.tick(400);
  assert.strictEqual(b.sheet.isConnected, false);
});

test('showMoveModal F2: a double tap on Move calls onMove once; Move AND Cancel are disabled while busy', () => {
  const { showMoveModal } = boot();
  let calls = 0;
  const m = showMoveModal(ITEM, FOLDERS, () => { calls++; }, doc());
  pickFolder(m, '/media/other');
  m.moveBtn.click();
  m.moveBtn.click();
  m.moveBtn.click();
  assert.strictEqual(calls, 1);
  assert.strictEqual(m.moveBtn.disabled, true);
  assert.strictEqual(m.cancelBtn.disabled, true);
});

test('showMoveModal F2: while a move is in flight NOTHING dismisses it - Cancel, Close, Esc, the scrim (ui.sheet canDismiss)', () => {
  const { showMoveModal } = boot();
  const m = showMoveModal(ITEM, FOLDERS, () => {}, doc());
  pickFolder(m, '/media/other');
  m.moveBtn.click();
  m.cancelBtn.click();
  closeX(m.sheet);
  esc();
  scrim();
  assert.strictEqual(m.sheet.classList.contains('is-closing'), false, 'still open mid-request');
});

test('showMoveModal F2: reenable() (a failed request) re-enables both buttons and a retry calls onMove again; then Esc dismisses again', () => {
  const { showMoveModal } = boot();
  let calls = 0;
  let reenable = null;
  const m = showMoveModal(ITEM, FOLDERS, (target, ctx) => { calls++; reenable = ctx.reenable; }, doc());
  pickFolder(m, '/media/other');
  m.moveBtn.click();
  reenable();
  assert.strictEqual(m.moveBtn.disabled, false);
  assert.strictEqual(m.cancelBtn.disabled, false);
  m.moveBtn.click();
  assert.strictEqual(calls, 2);
  reenable();
  esc();
  assert.ok(m.sheet.classList.contains('is-closing'), 'dismissable again once idle');
});

// ============================================================ showAttributionPicker
// (attribution-client's gate C1 lock: the picker must actually be REVEALED - an invisible
// dialog is a click-eater whose invisible rows could fire a blind bulk move)
test('showAttributionPicker: a ui.sheet dialog of ui-rows that IS revealed (is-open on the next frame, reduced motion included); a row picks once', () => {
  const t = clock();
  const { showAttributionPicker } = boot();
  dom.window.matchMedia = (q) => ({ matches: /prefers-reduced-motion/.test(q), media: q });
  const picks = [];
  const h = showAttributionPicker([
    { channelUrl: 'https://youtube.com/@a', channelName: 'Harbor Workshop', source: 'subscription' },
    { channelUrl: 'https://youtube.com/@b', channelName: 'Northbound', source: 'library' },
    { channelName: 'no url' },
  ], { title: 'Attribute this folder to', showRelocate: true }, (target, o) => picks.push([target.channelName, o.relocate]));
  const s = top();
  t.tick(20);
  assert.ok(s.classList.contains('is-open'), 'revealed');
  assert.strictEqual(s.querySelector('.ui-sheet__title').textContent, 'Attribute this folder to');
  const rows = Array.from(s.querySelectorAll('.attr-picker-row'));
  assert.deepStrictEqual(rows.map((r) => r.querySelector('.ui-row__title').textContent), ['Harbor Workshop', 'Northbound']);
  assert.deepStrictEqual(rows.map((r) => r.querySelector('.ui-row__meta').textContent), ['Subscribed', 'In library']);
  assert.ok(rows[0].querySelector('.ui-avatar'), 'the channel avatar (a monogram without a photo)');
  const relocate = s.querySelector('.attr-picker-relocate input');
  assert.strictEqual(relocate.checked, true, 'move is on by default');
  relocate.checked = false;
  rows[1].click();
  rows[1].click();
  rows[0].click();
  assert.deepStrictEqual(picks, [['Northbound', false]], 'one pick, carrying the switch');
  assert.strictEqual(typeof h.dismiss, 'function');
});

test('showAttributionPicker: no target -> the ui-state empty state; Esc and dismiss() close with no pick', () => {
  const t = clock();
  const { showAttributionPicker } = boot();
  const picks = [];
  const h = showAttributionPicker([], {}, () => picks.push(1));
  const s = top();
  assert.strictEqual(s.querySelector('.ui-state__title').textContent, 'No channels to attribute to yet');
  esc();
  assert.ok(s.classList.contains('is-closing'));
  t.tick(400);
  const h2 = showAttributionPicker([{ channelUrl: 'u', channelName: 'A' }], {}, () => picks.push(2));
  h2.dismiss();
  assert.ok(top === top && doc().querySelector('.ui-sheet').classList.contains('is-closing'));
  assert.deepStrictEqual(picks, []);
  assert.strictEqual(typeof h.dismiss, 'function');
});

// ============================================================ showTranscriptModal
test('showTranscriptModal: a wide ui.sheet dialog - the read-only field, the timestamps switch, Copy; returns dismiss()', () => {
  const t = clock();
  const { showTranscriptModal } = boot();
  const dismiss = showTranscriptModal({ text: 'Title\n\nline one' });
  const s = top();
  assert.ok(s.classList.contains('transcript-dialog') && s.classList.contains('ui-sheet--dialog'));
  const ta = s.querySelector('#transcript-text');
  assert.strictEqual(ta.value, 'Title\n\nline one');
  assert.strictEqual(ta.readOnly, true);
  assert.strictEqual(s.querySelector('#transcript-timestamps').getAttribute('role'), 'switch');
  assert.ok(s.querySelector('#transcript-copy-btn').classList.contains('ui-btn--primary'));
  assert.strictEqual(s.querySelector('#transcript-ai-btn'), null, 'no prompts, no AI button');
  noLegacyModal();
  dismiss();
  assert.ok(s.classList.contains('is-closing'));
  t.tick(400);
});

// v1.289 drag-safe dismiss (was modal-backdrop-dismiss's source lock for this builder): a
// selection drag from the field that ends outside clicks the common ancestor of the two
// elements - the body, since the scrim is the sheet's SIBLING - never the scrim. Only a
// clean tap on the scrim closes it.
test('showTranscriptModal: a drag from the field released outside never closes it; a tap on the scrim does', () => {
  const { showTranscriptModal } = boot();
  showTranscriptModal({ text: 'x' });
  const s = top();
  const sc = doc().querySelectorAll('.ui-scrim');
  const scrimEl = sc[sc.length - 1];
  assert.strictEqual(scrimEl.contains(s), false, 'the scrim does not contain the sheet');
  doc().body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); // the drag's click
  assert.strictEqual(s.classList.contains('is-closing'), false);
  scrimEl.click();
  assert.ok(s.classList.contains('is-closing'));
});

test('showTranscriptModal: flipping the timestamps switch reloads the field; a failure flips it back and says so', async () => {
  const { showTranscriptModal } = boot();
  let ok = true;
  showTranscriptModal({ text: 'plain', loadText: (ts) => (ok ? Promise.resolve(ts ? '[0:00] plain' : 'plain') : Promise.reject(new Error('x'))) });
  const s = top();
  const sw = s.querySelector('#transcript-timestamps');
  sw.checked = true;
  sw.dispatchEvent(new dom.window.Event('change'));
  await flush();
  assert.strictEqual(s.querySelector('#transcript-text').value, '[0:00] plain');
  ok = false;
  sw.checked = false;
  sw.dispatchEvent(new dom.window.Event('change'));
  await flush();
  assert.strictEqual(sw.checked, true, 'reflects what is actually shown');
  assert.strictEqual(doc().querySelector('.ui-toast--error .ui-toast__text').textContent, 'Could not load the transcript.');
});

// D4.8 / F33: a confirm that deletes asks for the destructive fill. After the merge with S3
// and S7, no trash confirm goes through the showConfirmModal shim any more: the watch page,
// the Pocket extras and the podcast player each ask ui.confirm directly with danger: true.
// Bound both ways: no shim trash confirm is left, and each file's ui.confirm carries danger.
test('D4.8: no trash confirm rides the showConfirmModal shim; each file\'s trash ui.confirm is danger', () => {
  for (const f of ['public/js/watch.js', 'public/js/skin-surface.js', 'public/js/podcasts.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\/.*$/gm, '');
    assert.strictEqual((src.match(/showConfirmModal\(\s*'Move to Trash\?'/g) || []).length, 0, f + ': no shim trash confirm');
    assert.match(src, /(ui|U)\.confirm\(/, f + ': the trash confirm is a ui.confirm');
  }
  const pod = fs.readFileSync(path.join(ROOT, 'public/js/podcasts.js'), 'utf8');
  assert.match(pod, /confirmLabel: 'Move to Trash', cancelLabel: 'Cancel', danger: true/);
  const skin = fs.readFileSync(path.join(ROOT, 'public/js/skin-surface.js'), 'utf8');
  assert.match(skin, /U\.confirm\(Object\.assign\(\{\}, copy, \{ danger: true/);
});
