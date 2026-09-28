'use strict';

// [UNIT] v1.20.0 FR-1/FR-3 (T3) -- the watch-page Subscribe toggle's pure
// decision helpers + the compact subscribe-confirm modal builder, all added
// to public/js/common.js. See
// docs/exec-plans/completed/2026-07-08-v1.20-subscribe.md ("FR-1 -- subscribe
// toggle + compact options modal" / "FR-3 -- hide when no channel / module
// disabled") for the full design/rationale.
//
// `buildSubscribeModal`'s tests drive the real dialog (common.js + ui.js in jsdom) since
// step 7 put it on ui.sheet; see its section below.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  shouldShowSubscribeButton,
  decideSubscribeButtonState,
  buildSubscribeRequestBody,
  buildSubscribeModal,
  cutoffDateToDateInput,
  dateInputToCutoffDate,
} = require('../../public/js/common.js');

// ---- shouldShowSubscribeButton ---------------------------------------------

test('shouldShowSubscribeButton: true iff moduleEnabled===true AND channelIdentity is non-null', () => {
  assert.strictEqual(shouldShowSubscribeButton({ moduleEnabled: true, channelIdentity: { channelUrl: 'x' } }), true);
});

test('shouldShowSubscribeButton: module disabled -> false regardless of identity', () => {
  assert.strictEqual(shouldShowSubscribeButton({ moduleEnabled: false, channelIdentity: { channelUrl: 'x' } }), false);
});

test('shouldShowSubscribeButton: no channel identity -> false even when the module is enabled', () => {
  assert.strictEqual(shouldShowSubscribeButton({ moduleEnabled: true, channelIdentity: null }), false);
});

test('shouldShowSubscribeButton: a truthy-but-not-strictly-true moduleEnabled never shows (fail closed)', () => {
  assert.strictEqual(shouldShowSubscribeButton({ moduleEnabled: 1, channelIdentity: { channelUrl: 'x' } }), false);
  assert.strictEqual(shouldShowSubscribeButton({ moduleEnabled: 'true', channelIdentity: { channelUrl: 'x' } }), false);
});

// ---- decideSubscribeButtonState --------------------------------------------

const YT_DLP_ITEM = { channelUrl: 'https://www.youtube.com/channel/UC12345', channelId: 'UC12345' };
const NON_YTDLP_ITEM = { artist: 'Some Artist', folderName: 'Movies' };

test('decideSubscribeButtonState: module disabled -> hidden regardless of matching subscriptions', () => {
  const subs = [{ id: 'sub-1', channelUrl: 'https://www.youtube.com/channel/UC12345' }];
  const state = decideSubscribeButtonState(YT_DLP_ITEM, subs, false);
  assert.deepStrictEqual(state, { visible: false, subscribed: false, subId: null, identity: null });
});

test('decideSubscribeButtonState: no resolvable channel identity -> hidden even when the module is enabled', () => {
  const state = decideSubscribeButtonState(NON_YTDLP_ITEM, [], true);
  assert.deepStrictEqual(state, { visible: false, subscribed: false, subId: null, identity: null });
});

test('decideSubscribeButtonState: resolvable identity, NO matching subscription -> visible + "Subscribe" (not subscribed)', () => {
  const state = decideSubscribeButtonState(YT_DLP_ITEM, [], true);
  assert.strictEqual(state.visible, true);
  assert.strictEqual(state.subscribed, false);
  assert.strictEqual(state.subId, null);
  assert.deepStrictEqual(state.identity, { channelUrl: 'https://www.youtube.com/channel/UC12345', channelId: 'UC12345' });
});

test('decideSubscribeButtonState: resolvable identity WITH a matching subscription -> visible + "Subscribed", carries the matched id', () => {
  const subs = [
    { id: 'other', channelUrl: 'https://www.youtube.com/channel/UCOTHER' },
    { id: 'sub-42', channelUrl: 'https://www.youtube.com/channel/UC12345' },
  ];
  const state = decideSubscribeButtonState(YT_DLP_ITEM, subs, true);
  assert.strictEqual(state.visible, true);
  assert.strictEqual(state.subscribed, true);
  assert.strictEqual(state.subId, 'sub-42');
});

test('decideSubscribeButtonState: matches via the canonical matcher (differing URL shapes), never naive string equality', () => {
  // File's own channelUrl is a /@handle; the persisted subscription is a
  // /channel/UC... -- these are provably the same channel via the shared
  // channelId key (see channelIdentityMatches, T2).
  const item = { channelUrl: 'https://www.youtube.com/@somecreator', channelId: 'UC99999' };
  const subs = [{ id: 'sub-x', channelUrl: 'https://www.youtube.com/channel/UC99999' }];
  const state = decideSubscribeButtonState(item, subs, true);
  assert.strictEqual(state.subscribed, true);
  assert.strictEqual(state.subId, 'sub-x');
});

test('decideSubscribeButtonState: malformed/missing input never throws', () => {
  assert.doesNotThrow(() => decideSubscribeButtonState(null, null, true));
  assert.doesNotThrow(() => decideSubscribeButtonState(undefined, undefined, undefined));
  const state = decideSubscribeButtonState(null, null, true);
  assert.strictEqual(state.visible, false);
});

// ---- cutoffDateToDateInput / dateInputToCutoffDate: pure conversions ------

test('cutoffDateToDateInput: converts a well-formed YYYYMMDD to YYYY-MM-DD', () => {
  assert.strictEqual(cutoffDateToDateInput('20260709'), '2026-07-09');
});

test('cutoffDateToDateInput: empty/malformed/non-string input converts to \'\' (never throws)', () => {
  assert.strictEqual(cutoffDateToDateInput(''), '');
  assert.strictEqual(cutoffDateToDateInput(undefined), '');
  assert.strictEqual(cutoffDateToDateInput(null), '');
  assert.strictEqual(cutoffDateToDateInput('2026-07-09'), ''); // already the OTHER shape
  assert.strictEqual(cutoffDateToDateInput('not-a-date'), '');
  assert.strictEqual(cutoffDateToDateInput('2026070'), ''); // 7 digits
});

test('cutoffDateToDateInput: an implausible month/day (e.g. month 13) converts to \'\' rather than a garbage date', () => {
  assert.strictEqual(cutoffDateToDateInput('20261301'), '');
  assert.strictEqual(cutoffDateToDateInput('20260732'), '');
});

test('dateInputToCutoffDate: converts a well-formed YYYY-MM-DD to YYYYMMDD', () => {
  assert.strictEqual(dateInputToCutoffDate('2026-07-09'), '20260709');
});

test('dateInputToCutoffDate: empty/malformed/non-string input converts to undefined (never a garbage string)', () => {
  assert.strictEqual(dateInputToCutoffDate(''), undefined);
  assert.strictEqual(dateInputToCutoffDate('   '), undefined);
  assert.strictEqual(dateInputToCutoffDate(undefined), undefined);
  assert.strictEqual(dateInputToCutoffDate(null), undefined);
  assert.strictEqual(dateInputToCutoffDate('20260709'), undefined); // already the OTHER shape
  assert.strictEqual(dateInputToCutoffDate('not-a-date'), undefined);
});

test('dateInputToCutoffDate: an implausible month/day converts to undefined', () => {
  assert.strictEqual(dateInputToCutoffDate('2026-13-01'), undefined);
  assert.strictEqual(dateInputToCutoffDate('2026-07-32'), undefined);
});

test('cutoffDateToDateInput/dateInputToCutoffDate: round-trip every valid date unchanged', () => {
  assert.strictEqual(dateInputToCutoffDate(cutoffDateToDateInput('20250101')), '20250101');
  assert.strictEqual(cutoffDateToDateInput(dateInputToCutoffDate('2025-12-31')), '2025-12-31');
});

// ---- buildSubscribeRequestBody: the exact POST body shape ------------------

test('buildSubscribeRequestBody: builds the field names store.validateSubscriptionInput expects', () => {
  const body = buildSubscribeRequestBody(
    'https://www.youtube.com/channel/UC12345',
    'Real Creator',
    'video',
    'best',
    '2026-07-01',
    false,
    'mp4'
  );
  assert.deepStrictEqual(body, {
    channelUrl: 'https://www.youtube.com/channel/UC12345',
    format: 'video',
    quality: 'best',
    skipShorts: false,
    name: 'Real Creator',
    filetype: 'mp4',
    cutoffDate: '20260701',
  });
});

test('buildSubscribeRequestBody: blank/whitespace name is omitted (never sent as an empty string)', () => {
  const body = buildSubscribeRequestBody('https://www.youtube.com/@x', '   ', 'audio', 'best', '2026-07-01', true, undefined);
  assert.strictEqual('name' in body, false);
  assert.strictEqual('filetype' in body, false);
});

test('buildSubscribeRequestBody: an invalid/blank cutoff date is omitted, not coerced to a garbage string', () => {
  const body = buildSubscribeRequestBody('https://www.youtube.com/@x', 'X', 'video', 'best', '', false, 'mp4');
  assert.strictEqual('cutoffDate' in body, false);

  const body2 = buildSubscribeRequestBody('https://www.youtube.com/@x', 'X', 'video', 'best', 'not-a-date', false, 'mp4');
  assert.strictEqual('cutoffDate' in body2, false);
});

test('buildSubscribeRequestBody: skipShorts is always an explicit boolean, coerced from any truthy/falsy input', () => {
  assert.strictEqual(buildSubscribeRequestBody('u', 'n', 'video', 'best', '2026-07-01', 1, undefined).skipShorts, true);
  assert.strictEqual(buildSubscribeRequestBody('u', 'n', 'video', 'best', '2026-07-01', 0, undefined).skipShorts, false);
});

// ---- buildSubscribeModal: the Subscribe dialog, in jsdom with the real ui.js --------
// Step 7 (UI pass, DELIBERATE conversion): the dialog is a ui.sheet now (it was the last
// bespoke .oneoff-modal shell, a backdrop the caller appended itself), so its tests drive
// common.js + ui.js in jsdom - every way in and out a user has - instead of the fake-DOM
// harness that pinned the old backdrop/modal pair. Each old test's intent is kept: the
// read-only identity as TEXT, the pre-filled selects, the blank cutoff date, the exact body
// Subscribe sends, Cancel / Close / backdrop never subscribing, a drag from inside never
// closing it, hostile strings inert, no innerHTML.

const { mock, afterEach } = require('node:test');
const { JSDOM } = require('jsdom');
const UI = require.resolve('../../public/js/ui.js');

let dom = null;
function page(o) {
  const opts = o || {};
  mock.timers.enable({ apis: ['setTimeout'] });
  dom = new JSDOM('<!DOCTYPE html><body><button id="opener">Subscribe</button></body>', { url: 'http://localhost/watch?id=x' });
  const w = dom.window;
  w.matchMedia = (q) => ({ matches: q === '(max-width: 768px)' ? !!opts.phone : false, media: q });
  delete require.cache[UI];
  w.ui = require(UI);
  return w.document;
}
function shut() {
  mock.timers.reset();
  if (dom) dom.window.close();
  dom = null;
}
afterEach(shut);
const open = (doc, o, h) => { const m = buildSubscribeModal(doc, o, h); m.sheet.open(); return m; };
const esc = (doc) => doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
const change = (el) => el.dispatchEvent(new dom.window.Event('change'));

test('buildSubscribeModal: a ui.sheet titled "Subscribe" (a dialog on desktop, a bottom sheet on a phone) - nothing in the document until the caller opens it', () => {
  let doc = page();
  const m = buildSubscribeModal(doc, { channelUrl: 'https://www.youtube.com/@x' }, {});
  assert.strictEqual(doc.querySelector('.ui-sheet'), null, 'built, not shown');
  m.sheet.open();
  assert.strictEqual(m.sheet.el.parentNode, doc.body);
  assert.ok(m.sheet.el.classList.contains('ui-sheet--dialog'), 'a dialog on desktop');
  assert.strictEqual(m.sheet.el.querySelector('.ui-sheet__title').textContent, 'Subscribe');
  assert.strictEqual(m.sheet.el.querySelectorAll('.ui-sheet__close').length, 1, 'the sheet\'s ONE Close');
  assert.strictEqual(m.closeBtn, m.sheet.el.querySelector('.ui-sheet__close'));
  assert.strictEqual(doc.querySelector('.oneoff-modal, .oneoff-modal-backdrop, .subscribe-modal-actions'), null, 'no bespoke shell is built');
  shut();
  doc = page({ phone: true });
  const p = open(doc, { channelUrl: 'https://www.youtube.com/@x' }, {});
  assert.ok(p.sheet.el.classList.contains('ui-sheet--bottom'), 'a bottom sheet on a phone');
});

test('buildSubscribeModal: renders the read-only identity via textContent, pre-fills format/quality/filetype, the cutoff date starts blank, Skip Shorts starts off', () => {
  const doc = page();
  const modal = open(doc, {
    channelName: 'Real Creator Name',
    channelUrl: 'https://www.youtube.com/channel/UC12345',
    format: 'audio',
  }, {});
  // READ-ONLY identity -- textContent only, never an editable input.
  assert.strictEqual(modal.identityName.textContent, 'Real Creator Name');
  assert.strictEqual(modal.identityUrl.textContent, 'https://www.youtube.com/channel/UC12345');
  assert.notStrictEqual(modal.identityName.tagName, 'INPUT', 'identity name must not be an editable field');
  assert.notStrictEqual(modal.identityUrl.tagName, 'INPUT', 'identity url must not be an editable field');
  assert.strictEqual(modal.formatSelect.value, 'audio', 'format pre-filled from the file\'s own media type');
  assert.strictEqual(modal.qualitySelect.value, 'best');
  assert.strictEqual(modal.filetypeSelect.value, 'mp3', 'filetype defaults to the audio allowlist\'s recommended value');
  for (const sel of [modal.formatSelect, modal.qualitySelect, modal.filetypeSelect]) {
    assert.ok(sel.classList.contains('ui-select__native') && sel.parentNode.classList.contains('ui-select'), 'each select is a ui-select');
  }
  // v1.25 QoL (T5): a cutoff-DATE input, BLANK by default, with an accessible name.
  assert.strictEqual(modal.cutoffDateInput.tagName, 'INPUT');
  assert.strictEqual(modal.cutoffDateInput.type, 'date');
  assert.ok(modal.cutoffDateInput.classList.contains('ui-field__input'), 'a ui-field input (16px: no iOS focus zoom)');
  assert.strictEqual(modal.cutoffDateInput.value, '', 'cutoff-date input must start blank, not a pre-computed date');
  assert.strictEqual(modal.cutoffDateInput.getAttribute('aria-label'), 'Download videos published on or after');
  assert.strictEqual(modal.skipShortsCheck.checked, false, 'skip-Shorts defaults to OFF');
  assert.ok(modal.skipShortsCheck.classList.contains('ui-switch') && modal.skipShortsCheck.getAttribute('role') === 'switch', 'the ui-switch on the native checkbox');
  assert.strictEqual(modal.skipShortsCheck.closest('label').textContent, 'Skip Shorts', 'labelled by its row');
  assert.ok(modal.cancelBtn.classList.contains('ui-btn--secondary') && modal.confirmBtn.classList.contains('ui-btn--primary'), 'Cancel secondary, Subscribe the one primary');
  assert.strictEqual(modal.confirmBtn.textContent, 'Subscribe');
  assert.strictEqual(modal.cancelBtn.textContent, 'Cancel');
});

test('buildSubscribeModal: missing channelName falls back to a neutral placeholder, never blank/undefined text', () => {
  const modal = open(page(), { channelUrl: 'https://www.youtube.com/@x' }, {});
  assert.strictEqual(modal.identityName.textContent, 'This channel');
});

test('buildSubscribeModal: switching format to audio repopulates the filetype select (shared reducer wiring, AC7)', () => {
  const modal = open(page(), { channelUrl: 'https://www.youtube.com/@x', format: 'video' }, {});
  modal.formatSelect.value = 'audio';
  change(modal.formatSelect);
  assert.deepStrictEqual(Array.from(modal.filetypeSelect.options).map((o) => o.value), ['mp3', 'm4a', 'opus', 'default']);
  assert.strictEqual(modal.filetypeSelect.value, 'mp3');
});

test('buildSubscribeModal: Subscribe calls onConfirm with the exact body built from the chosen control values (AC4)', () => {
  const calls = [];
  const modal = open(page(), {
    channelName: 'Real Creator',
    channelUrl: 'https://www.youtube.com/channel/UC12345',
    format: 'video',
  }, { onConfirm: (body) => calls.push(body) });
  modal.qualitySelect.value = '720p';
  modal.cutoffDateInput.value = '2026-05-05';
  modal.skipShortsCheck.click(); // the switch, as a user flips it
  assert.strictEqual(modal.skipShortsCheck.checked, true);
  modal.confirmBtn.click();
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], {
    channelUrl: 'https://www.youtube.com/channel/UC12345',
    name: 'Real Creator',
    format: 'video',
    quality: '720p',
    cutoffDate: '20260505',
    skipShorts: true,
    filetype: 'mp4',
  });
  assert.strictEqual(modal.sheet.isOpen(), true, 'Subscribe never closes it by itself: the caller does, on a good response');
});

test('buildSubscribeModal: Subscribe with a blank cutoff-date input omits cutoffDate entirely, letting the server apply its own default', () => {
  const calls = [];
  const modal = open(page(), { channelUrl: 'https://www.youtube.com/@x' }, { onConfirm: (body) => calls.push(body) });
  modal.confirmBtn.click();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual('cutoffDate' in calls[0], false);
});

test('buildSubscribeModal: Cancel, Close, Esc, the scrim and the view\'s signal each close it and call onClose ONCE - never onConfirm, not even a late tap on the closing dialog', () => {
  for (const how of ['cancel', 'close', 'esc', 'scrim', 'signal']) {
    const doc = page();
    let closed = 0;
    const confirms = [];
    const ac = new dom.window.AbortController();
    const m = open(doc, { channelUrl: 'https://www.youtube.com/@x', signal: ac.signal }, { onClose: () => { closed += 1; }, onConfirm: (b) => confirms.push(b) });
    if (how === 'cancel') m.cancelBtn.click();
    else if (how === 'close') m.closeBtn.click();
    else if (how === 'esc') esc(doc);
    else if (how === 'scrim') m.backdrop.click();
    else ac.abort();
    assert.strictEqual(closed, 1, how + ': onClose once');
    assert.ok(m.sheet.el.classList.contains('is-closing'), how + ': closing');
    m.confirmBtn.click();
    assert.strictEqual(confirms.length, 0, how + ': never onConfirm');
    mock.timers.tick(1000);
    assert.strictEqual(m.sheet.el.isConnected, false, how + ': the sheet leaves the document');
    assert.strictEqual(m.backdrop.isConnected, false, how + ': and its scrim - never a stranded touch-eater');
    shut();
  }
});

test('buildSubscribeModal: a text-selection drag from a field released outside the sheet does not close it (v1.289); a tap on the scrim does', () => {
  const doc = page();
  let closed = 0;
  const m = open(doc, { channelUrl: 'https://www.youtube.com/@x' }, { onClose: () => { closed += 1; } });
  // A drag's synthesized click lands on the COMMON ANCESTOR of press and release: the scrim is a
  // sibling of the sheet, so that ancestor is <body> - never the scrim.
  m.cutoffDateInput.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  doc.body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.strictEqual(closed, 0, 'a drag that starts inside the dialog never closes it');
  assert.strictEqual(m.backdrop.parentNode, m.sheet.el.parentNode, 'the scrim is the sheet\'s sibling (why the drag is safe)');
  m.backdrop.click();
  assert.strictEqual(closed, 1);
});

test('buildSubscribeModal: setError renders a hostile string as inert text via textContent, never innerHTML (XSS regression)', () => {
  const doc = page();
  const modal = open(doc, { channelUrl: 'https://www.youtube.com/@x' }, {});
  const hostile = '<img src=x onerror=alert(1)>';
  modal.setError(hostile);
  assert.strictEqual(modal.statusEl.textContent, hostile);
  assert.strictEqual(doc.querySelectorAll('img, script').length, 0);
  modal.setError('');
  assert.strictEqual(modal.statusEl.textContent, '');
});

test('buildSubscribeModal: a hostile channelName/channelUrl renders as inert text, never parsed as markup (XSS regression)', () => {
  const doc = page();
  const hostileName = '<script>window.__xss = true;</script>';
  const hostileUrl = 'https://www.youtube.com/@x"><img src=x onerror=alert(1)>';
  const modal = open(doc, { channelName: hostileName, channelUrl: hostileUrl }, {});
  assert.strictEqual(modal.identityName.textContent, hostileName);
  assert.strictEqual(modal.identityUrl.textContent, hostileUrl);
  assert.strictEqual(doc.querySelectorAll('img, script').length, 0);
});

// ---- Static-source regression guard: no innerHTML in the builder ------

test('buildSubscribeModal source contains no innerHTML assignment (static regression guard)', () => {
  const stripComments = (src) => src.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(stripComments(buildSubscribeModal.toString()), /\.innerHTML\s*=/, 'buildSubscribeModal must never assign innerHTML');
});
