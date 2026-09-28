'use strict';

// [UNIT] UI pass sweep S3 (D4.8, D4.9, F33, F44; destructive - the full gate). The watch
// page's two destructive paths, driven through the REAL view (watch.html + ui.js + common.js
// + main.js + watch.js in jsdom, test/helpers/watch-view-harness.js):
//   - "Move to Trash" (the More menu) -> ui.confirm (danger) -> DELETE /api/videos/:id, the
//     route's v1.65 TRASH move (lib/media/routes.js) - never a permanent unlink, so the copy
//     says "Move to Trash" in the title AND on the button (F44: the old local-file dialog said
//     "Move ... to Trash?" over a "Delete permanently" button);
//   - "Unsubscribe" (the Subscribed pill) -> ui.confirm (danger) -> DELETE /api/subscriptions/:id.
// No path reaches either request unless the confirm resolves exactly true: Cancel, Esc, the
// scrim, Close, a double tap, a teardown mid-confirm and a stale OK after it all send nothing.

const { test } = require('node:test');
const assert = require('node:assert');
const { watchViewRealm, VIDEO } = require('../helpers/watch-view-harness');

const SUB = { id: 's1', channelUrl: VIDEO.channelUrl, name: 'Harbor Workshop', pushBell: false, channelDir: '/lib/Harbor Workshop' };
const frames = async (r) => { await r.settle(4); };

async function openMore(r) {
  r.$('#more-actions-btn').click();
  await frames(r);
  const sheet = r.doc.querySelector('.ui-sheet.is-open, .ui-sheet');
  assert.ok(sheet, 'the More menu opened');
  return sheet;
}
function menuRow(r, label) {
  const rows = Array.from(r.doc.querySelectorAll('.ui-sheet .ui-row'));
  return rows.find((x) => x.textContent.trim() === label) || null;
}
function confirmDialog(r) {
  const sheets = Array.from(r.doc.querySelectorAll('.ui-sheet')).filter((s) => s.querySelector('.ui-confirm__actions'));
  return sheets[sheets.length - 1] || null;
}
function confirmButtons(r) {
  const d = confirmDialog(r);
  if (!d) return null;
  const [cancel, ok] = d.querySelectorAll('.ui-confirm__actions .ui-btn');
  return { d, cancel, ok, title: (d.querySelector('.ui-sheet__title') || {}).textContent, body: (d.querySelector('.ui-confirm__body') || {}).textContent };
}
async function mounted(opts) {
  const r = watchViewRealm(opts);
  r.init();
  await r.settle(20);
  return r;
}
const deletes = (r, prefix) => r.calls('DELETE', prefix);

// ---- Move to Trash --------------------------------------------------------------------

test('Move to Trash: the More menu offers it (danger) only with the write capability, and asks ONE confirm whose copy says what runs', async () => {
  const r = await mounted();
  try {
    await openMore(r);
    const row = menuRow(r, 'Move to Trash');
    assert.ok(row, 'offered to an admin');
    assert.ok(row.classList.contains('ui-row--danger'), 'the danger row');
    row.click();
    await frames(r);
    const c = confirmButtons(r);
    assert.ok(c, 'a confirm opened');
    assert.strictEqual(c.title, 'Move to Trash?');
    assert.strictEqual(c.ok.textContent.trim(), 'Move to Trash', 'F44: the button says the SAME verb as the title');
    assert.ok(c.ok.classList.contains('ui-btn--destructive'), 'the danger fill');
    assert.match(c.body, /stays in Trash/, 'the body says it is recoverable (a trash move, not a permanent delete)');
    assert.strictEqual(deletes(r, '/api/videos/').length, 0, 'nothing sent before the answer');
    c.cancel.click();
  } finally { r.close(); }
  const member = await mounted({ me: { username: 'm', role: 'member', canModifyLibrary: false } });
  try {
    await openMore(member);
    assert.strictEqual(menuRow(member, 'Move to Trash'), null, 'a capability-less member never sees it');
    assert.strictEqual(menuRow(member, 'Move to another folder'), null, 'nor Move');
  } finally { member.close(); }
});

test('Move to Trash: OK sends exactly ONE DELETE /api/videos/:id (the same route as before), closes the player first, then leaves the page', async () => {
  const r = await mounted({ route: (m, u) => (m === 'DELETE' && u === '/api/videos/vid1' ? { status: 200, body: { success: true, outcome: 'clean' } } : null) });
  try {
    await openMore(r);
    menuRow(r, 'Move to Trash').click();
    await frames(r);
    const c = confirmButtons(r);
    c.ok.click();
    c.ok.click(); // a double tap on OK
    await r.settle(10);
    assert.strictEqual(deletes(r, '/api/videos/').length, 1, 'exactly one DELETE');
    assert.strictEqual(deletes(r, '/api/videos/')[0].url, '/api/videos/vid1', 'of this item, on the unchanged route');
    assert.ok(r.loads.some((l) => l.close), 'the player was closed (no Range-requests on a moved file)');
    assert.ok(r.loads.some((l) => l.navigate === '/'), 'then home');
  } finally { r.close(); }
});

test('Move to Trash: Cancel, Esc, the scrim and Close each send NOTHING, and a late OK on the closing dialog stays a cancel', async () => {
  for (const how of ['cancel', 'esc', 'scrim', 'close', 'late-ok']) {
    const r = await mounted();
    try {
      await openMore(r);
      menuRow(r, 'Move to Trash').click();
      await frames(r);
      const c = confirmButtons(r);
      if (how === 'cancel') c.cancel.click();
      else if (how === 'esc') r.doc.dispatchEvent(new r.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else if (how === 'scrim') { const s = r.doc.querySelector('.ui-scrim'); assert.ok(s, 'a scrim'); s.click(); }
      else if (how === 'close') { const x = c.d.querySelector('.ui-sheet__close, [aria-label="Close"]'); assert.ok(x, 'a close button'); x.click(); }
      else { c.cancel.click(); c.ok.click(); }
      await r.settle(10);
      assert.strictEqual(deletes(r, '/api/videos/').length, 0, how + ': no DELETE');
    } finally { r.close(); }
  }
});

test('Move to Trash: a view teardown with the confirm up closes it, and nothing is deleted after (a stale OK sends nothing)', async () => {
  const r = await mounted();
  try {
    await openMore(r);
    menuRow(r, 'Move to Trash').click();
    await frames(r);
    const c = confirmButtons(r);
    r.destroy();
    await r.settle(6);
    c.ok.click();
    await r.settle(6);
    assert.strictEqual(deletes(r, '/api/videos/').length, 0);
  } finally { r.close(); }
});

test('Move to Trash: a second Move to Trash while a confirm is up opens nothing new (one at a time)', async () => {
  const r = await mounted();
  try {
    await openMore(r);
    menuRow(r, 'Move to Trash').click();
    await frames(r);
    const first = confirmDialog(r);
    // the menu closed on the pick; open it again and pick again under the live confirm
    await openMore(r);
    const again = menuRow(r, 'Move to Trash');
    if (again) again.click();
    await frames(r);
    const dialogs = Array.from(r.doc.querySelectorAll('.ui-sheet')).filter((s) => s.querySelector('.ui-confirm__actions') && s.classList.contains('is-open'));
    assert.ok(dialogs.length <= 1, 'never two confirms (' + dialogs.length + ')');
    assert.ok(first, 'precondition');
  } finally { r.close(); }
});

test('the copy says what runs, per item kind (v1.338 D8d): a local file adds that it cannot be re-downloaded; a download (another site, no uploader) does not', async () => {
  for (const [item, local] of [
    [{ ...VIDEO, id: 'vid2', filePath: '/media/home/movie.mp4', channelUrl: undefined, watchUrl: undefined, channelName: undefined }, true],
    [{ ...VIDEO, id: 'vid3', channelUrl: undefined, channelName: undefined, watchUrl: undefined, sourceExtractor: 'reddit', sourceId: 'x1', filePath: '/downloads/Reddit/x1.mp4' }, false],
  ]) {
    const r = await mounted({ item });
    try {
      await openMore(r);
      menuRow(r, 'Move to Trash').click();
      await frames(r);
      const c = confirmButtons(r);
      assert.strictEqual(/cannot be re-downloaded/.test(c.body), local, item.id + ': ' + c.body);
      assert.strictEqual(c.ok.textContent.trim(), 'Move to Trash');
    } finally { r.close(); }
  }
});

test('census: tapping every OTHER action on the page (the bar, every More entry but Move to Trash, the channel row but Subscribed) sends no DELETE', async () => {
  const r = await mounted({ subs: [SUB], pins: [] });
  try {
    for (const b of r.doc.querySelectorAll('#watch-actions .ui-btn:not(#more-actions-btn)')) { b.click(); await frames(r); }
    await openMore(r);
    const labels = Array.from(r.doc.querySelectorAll('.ui-sheet .ui-row')).map((x) => x.textContent.trim()).filter((t) => t !== 'Move to Trash');
    assert.ok(labels.length >= 5, 'the menu has its entries: ' + labels.join(', '));
    for (const label of labels) {
      await openMore(r);
      const row = menuRow(r, label);
      if (row && !row.disabled) row.click();
      await frames(r);
      // close anything a pick opened (a dialog or a picker) without answering yes
      for (const cl of r.doc.querySelectorAll('.ui-sheet.is-open [aria-label="Close"]')) cl.click();
      await frames(r);
    }
    for (const id of ['#notify-channel-btn', '#pin-channel-btn', '#about-file-toggle']) { const b = r.$(id); if (b) b.click(); await frames(r); }
    await r.settle(8);
    assert.deepStrictEqual(deletes(r, '/api/videos/').map((f) => f.url), [], 'no video DELETE');
    assert.deepStrictEqual(deletes(r, '/api/subscriptions/s1'), [], 'no unsubscribe');
  } finally { r.close(); }
});

// ---- Unsubscribe -------------------------------------------------------------------------

test('Unsubscribe: the Subscribed pill asks ONE danger confirm; only OK sends the SAME DELETE /api/subscriptions/:id, once', async () => {
  const r = await mounted({ subs: [SUB], route: (m, u) => (m === 'DELETE' && u === '/api/subscriptions/s1' ? { status: 200, body: {} } : null) });
  try {
    const pill = r.$('#subscribe-btn-mock');
    assert.strictEqual(pill.getAttribute('aria-pressed'), 'true', 'precondition: subscribed');
    pill.click();
    pill.click(); // a double tap opens ONE dialog
    await frames(r);
    const open = Array.from(r.doc.querySelectorAll('.ui-sheet.is-open')).filter((s) => s.querySelector('.ui-confirm__actions'));
    assert.strictEqual(open.length, 1, 'one confirm');
    const c = confirmButtons(r);
    assert.match(c.title, /^Unsubscribe from Harbor Workshop\?$/);
    assert.strictEqual(c.ok.textContent.trim(), 'Unsubscribe');
    assert.ok(c.ok.classList.contains('ui-btn--destructive'));
    assert.match(c.body, /stay in your library/, 'says it deletes no file');
    assert.strictEqual(deletes(r, '/api/subscriptions/').length, 0, 'nothing before the answer');
    c.ok.click();
    c.ok.click();
    await r.settle(10);
    assert.deepStrictEqual(deletes(r, '/api/subscriptions/').map((f) => f.url), ['/api/subscriptions/s1']);
    assert.strictEqual(pill.getAttribute('aria-pressed'), 'false', 'now Subscribe');
    assert.ok(pill.classList.contains('ui-btn--primary'), 'the primary pill again');
  } finally { r.close(); }
});

test('Unsubscribe: Cancel / Esc / scrim / a teardown send nothing', async () => {
  for (const how of ['cancel', 'esc', 'scrim', 'teardown']) {
    const r = await mounted({ subs: [SUB] });
    try {
      r.$('#subscribe-btn-mock').click();
      await frames(r);
      const c = confirmButtons(r);
      assert.ok(c, how + ': a confirm');
      if (how === 'cancel') c.cancel.click();
      else if (how === 'esc') r.doc.dispatchEvent(new r.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else if (how === 'scrim') r.doc.querySelector('.ui-scrim').click();
      else { r.destroy(); await r.settle(4); c.ok.click(); }
      await r.settle(10);
      assert.strictEqual(deletes(r, '/api/subscriptions/').length, 0, how);
      if (how !== 'teardown') assert.strictEqual(r.$('#subscribe-btn-mock').getAttribute('aria-pressed'), 'true', how + ': still subscribed');
    } finally { r.close(); }
  }
});
