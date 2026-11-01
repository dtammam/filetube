'use strict';

// [UNIT] v1.400.0 multi-select (plan docs/exec-plans/active/2026-11-01-multi-select.md) - the pure
// pieces of the action bar:
//   - buildBulkActions / bulkActionApplies: the bar's verbs for a selection are the card menu's OWN
//     applicability (M5): a card applies to queue / Watch later / Like / Reheat / Move to Trash iff
//     buildCardMenuItems offers that id for it; Mark watched = a media card; Move to folder = a
//     media card with the library capability. "N of M" when only some apply, absent when none.
//   - the Select row (M2): first in the card menu when the view says `selectable`, absent otherwise
//     (the kebab's "can the menu hold anything" check and every older caller see the old menu).
//   - bulkSummary (M9): one honest sentence per run, the failures and the refusal appended.
//   - requestQueueAdd (common.js): the silent half of addToQueue - resolves the body on a 2xx and
//     rejects with an Error carrying `status` otherwise (a bulk run tells a refusal from a failure).
// The rendered chain (the real index.html, the grid, the bar, the requests) is
// test/integration/multi-select-fullchain.test.js.

const { test } = require('node:test');
const assert = require('node:assert');

const common = require('../../public/js/common.js');
for (const k of ['resolveViewCountLabel', 'isFabricatedViewCount', 'formatRelativeTime', 'getStarRating',
  'isYtdlpManagedItem', 'eraShowsFabricated', 'applyEraFlourish', 'podcastShareUrl', 'podcastTrashConfirmCopy']) global[k] = common[k];

// common.js keeps formatFileSize un-exported; the copy only interpolates it, so a visible stub binds the seam.
global.formatFileSize = (bytes) => bytes + ' B';
const { buildBulkActions, bulkActionApplies, bulkSummary, buildCardMenuItems, bulkTrashConfirmCopy } = require('../../public/js/main.js');

const media = (id, extra) => Object.assign({ id, title: 'V ' + id, ext: '.mp4', type: 'video', liked: false }, extra || {});
const podcast = (id) => ({ id, kind: 'podcast', title: 'Ep ' + id, subId: 's1', showName: 'Show' });
const track = (id) => ({ id, kind: 'track', title: 'T ' + id, artist: 'A' });
const book = (id) => ({ id, kind: 'book', title: 'B ' + id, author: 'W' });
const tv = (id) => ({ id, kind: 'tv-episode', title: 'E ' + id, showName: 'S' });
const ids = (list) => list.map((a) => a.id);
const byId = (list, id) => list.find((a) => a.id === id);

test('M5: the verbs the bar offers for media cards follow the capabilities exactly like the card menu', () => {
  const items = [media('a'), media('b'), media('c')];
  // no capability: the four client verbs only (queue, Watch later, Like, Mark watched)
  assert.deepStrictEqual(ids(buildBulkActions(items, {})), ['queue', 'watchlater', 'like', 'watched']);
  // library-modify: Move to folder and Move to Trash join, in M4's order
  assert.deepStrictEqual(ids(buildBulkActions(items, { canModifyLibrary: true })), ['queue', 'watchlater', 'like', 'watched', 'move', 'delete']);
  // reheat capability alone: Reheat joins, no Move / Trash
  assert.deepStrictEqual(ids(buildBulkActions(items, { reheatEnabled: true })), ['queue', 'watchlater', 'like', 'watched', 'reheat']);
  // both
  assert.deepStrictEqual(ids(buildBulkActions(items, { canModifyLibrary: true, reheatEnabled: true })),
    ['queue', 'watchlater', 'like', 'watched', 'move', 'reheat', 'delete']);
  // a truthy-but-not-true capability is no capability (the menu's own strictness)
  assert.deepStrictEqual(ids(buildBulkActions(items, { canModifyLibrary: 'yes', reheatEnabled: 1 })), ['queue', 'watchlater', 'like', 'watched']);
  const all = buildBulkActions(items, { canModifyLibrary: true, reheatEnabled: true });
  for (const a of all) {
    assert.deepStrictEqual(a.ids, ['a', 'b', 'c'], a.id + ' applies to every card, in grid order');
    assert.strictEqual(a.total, 3);
    assert.ok(!/ of /.test(a.label), a.id + ': the bare verb when every card applies: ' + a.label);
  }
  assert.strictEqual(byId(all, 'delete').danger, true, 'Move to Trash is the destructive verb');
  assert.strictEqual(byId(all, 'delete').label, 'Move to Trash');
  assert.strictEqual(byId(all, 'queue').label, 'Add to queue');
  assert.strictEqual(byId(all, 'watched').label, 'Mark watched');
  assert.strictEqual(byId(all, 'move').label, 'Move to folder');
  assert.strictEqual(byId(all, 'reheat').label, 'Reheat metadata');
});

test('M5: a mixed selection says "Verb N of M" for the cards each verb applies to, and hides a verb that applies to none', () => {
  const caps = { canModifyLibrary: true, reheatEnabled: true };
  const sel = [media('m1'), podcast('p1'), track('t1'), book('b1'), tv('e1'), media('m2')];
  const out = buildBulkActions(sel, caps);
  // queue: media + podcast + track (books and tv do not queue)
  assert.deepStrictEqual(byId(out, 'queue').ids, ['m1', 'p1', 't1', 'm2']);
  assert.strictEqual(byId(out, 'queue').label, 'Add to queue 4 of 6');
  // Watch later: media + podcast
  assert.deepStrictEqual(byId(out, 'watchlater').ids, ['m1', 'p1', 'm2']);
  assert.strictEqual(byId(out, 'watchlater').label, 'Watch later 3 of 6');
  // Like: everything but tv (likeable:false)
  assert.deepStrictEqual(byId(out, 'like').ids, ['m1', 'p1', 't1', 'b1', 'm2']);
  assert.strictEqual(byId(out, 'like').label, 'Like 5 of 6');
  // Mark watched / Move to folder / Reheat: media only
  for (const v of ['watched', 'move', 'reheat']) {
    assert.deepStrictEqual(byId(out, v).ids, ['m1', 'm2'], v);
    assert.ok(byId(out, v).label.endsWith(' 2 of 6'), v + ': ' + byId(out, v).label);
  }
  // Move to Trash: media + podcast (canDelete), never a track / book / tv
  assert.deepStrictEqual(byId(out, 'delete').ids, ['m1', 'p1', 'm2']);
  assert.strictEqual(byId(out, 'delete').label, 'Move to Trash 3 of 6');
  // a selection of only tv episodes offers Like / Mark watched / Move / Reheat / Trash to nobody: hidden, not disabled
  assert.deepStrictEqual(ids(buildBulkActions([tv('e1'), tv('e2')], caps)), []);
  // books alone: Like only (no queue, no Watch later, no media verbs)
  assert.deepStrictEqual(ids(buildBulkActions([book('b1')], caps)), ['like']);
  // empty / junk selections
  assert.deepStrictEqual(buildBulkActions([], caps), []);
  assert.deepStrictEqual(buildBulkActions(null, caps), []);
  assert.deepStrictEqual(buildBulkActions([null, undefined, {}], caps), []);
});

test('M5: bulkActionApplies IS the card menu for the five menu verbs (mutating the menu moves the bar)', () => {
  const caps = { canModifyLibrary: true, reheatEnabled: true };
  for (const it of [media('m'), media('aud', { type: 'audio' }), podcast('p'), track('t'), book('b'), tv('e')]) {
    const menu = new Set(buildCardMenuItems(it, caps, {}).map((en) => en.id));
    for (const v of ['queue', 'watchlater', 'like', 'reheat', 'delete']) {
      assert.strictEqual(bulkActionApplies(v, it, caps), menu.has(v), `${it.kind || 'media'} ${v}`);
    }
  }
  // Like applies to a card already liked too (SET semantics: the run skips it as a no-op success)
  assert.strictEqual(bulkActionApplies('like', media('x', { liked: true }), {}), true);
  // the two bar-only verbs
  assert.strictEqual(bulkActionApplies('watched', media('m'), {}), true);
  assert.strictEqual(bulkActionApplies('watched', podcast('p'), {}), false);
  assert.strictEqual(bulkActionApplies('move', media('m'), { canModifyLibrary: true }), true);
  assert.strictEqual(bulkActionApplies('move', media('m'), { canModifyLibrary: false }), false);
  assert.strictEqual(bulkActionApplies('move', media('m'), {}), false);
  assert.strictEqual(bulkActionApplies('move', podcast('p'), { canModifyLibrary: true }), false);
  assert.strictEqual(bulkActionApplies('nope', media('m'), caps), false);
});

test('M2: the Select row leads the card menu ONLY when the view passes selectable:true', () => {
  const it = media('m');
  assert.strictEqual(buildCardMenuItems(it, {}, {})[0].id, 'queue', 'no opts: the menu as before');
  assert.strictEqual(buildCardMenuItems(it, {}, { selectable: false })[0].id, 'queue');
  assert.strictEqual(buildCardMenuItems(it, {}, { selectable: 'yes' })[0].id, 'queue', 'strict true only');
  const withSelect = buildCardMenuItems(it, { canModifyLibrary: true }, { selectable: true });
  assert.deepStrictEqual(withSelect[0], { id: 'select', icon: 'checklist', label: 'Select' });
  assert.deepStrictEqual(withSelect.slice(1), buildCardMenuItems(it, { canModifyLibrary: true }, {}), 'the rest of the menu is unchanged');
  // every kind that has a menu gets the row; a tv card's menu stays empty without it (no inert kebab)
  for (const k of [podcast('p'), track('t'), book('b')]) assert.strictEqual(buildCardMenuItems(k, {}, { selectable: true })[0].id, 'select', k.kind);
  assert.deepStrictEqual(buildCardMenuItems(tv('e'), {}, {}), [], 'the kebab check (no opts) still sees an empty tv menu');
});

test('M9: bulkSummary says what happened, once, with the failures and the refusal', () => {
  assert.strictEqual(bulkSummary('delete', { ok: 11, failed: 1, refusal: null }), 'Moved 11 items to Trash. 1 failed.');
  assert.strictEqual(bulkSummary('delete', { ok: 1, failed: 0, refusal: null }), 'Moved 1 item to Trash.');
  assert.strictEqual(bulkSummary('delete', { ok: 0, failed: 2, refusal: null }), 'Nothing was moved to Trash. 2 failed.');
  assert.strictEqual(bulkSummary('queue', { ok: 12, failed: 0, refusal: null }), 'Added 12 items to the queue.');
  assert.strictEqual(bulkSummary('watchlater', { ok: 3, failed: 0, refusal: null }), 'Added 3 items to Watch later.');
  assert.strictEqual(bulkSummary('like', { ok: 2, failed: 0, refusal: null }), 'Liked 2 items.');
  assert.strictEqual(bulkSummary('watched', { ok: 4, failed: 1, refusal: null }), 'Marked 4 items watched. 1 failed.');
  assert.strictEqual(bulkSummary('move', { ok: 11, failed: 1, refusal: null }), 'Moved 11 items. 1 failed.');
  assert.strictEqual(bulkSummary('move', { ok: 1, failed: 0, refusal: "You don't have permission for that." }),
    "Moved 1 item. You don't have permission for that.");
  assert.strictEqual(bulkSummary('like', { ok: 0, failed: 0, refusal: 'Sign in again to continue.' }), 'Nothing was liked. Sign in again to continue.');
  // Reheat (M6): one request; ok = the server's eligible count, requested = what the bar sent
  assert.strictEqual(bulkSummary('reheat', { ok: 3, failed: 0, refusal: null, requested: 3 }), 'Reheating 3 items.');
  assert.strictEqual(bulkSummary('reheat', { ok: 1, failed: 0, refusal: null, requested: 1 }), 'Reheating 1 item.');
  assert.strictEqual(bulkSummary('reheat', { ok: 10, failed: 0, refusal: null, requested: 12 }), 'Reheating 10 of 12.');
  assert.strictEqual(bulkSummary('reheat', { ok: 0, failed: 0, refusal: null, requested: 2 }), 'Nothing to reheat.');
  assert.strictEqual(bulkSummary('reheat', { ok: 0, failed: 0, refusal: 'A reheat is already running.', requested: 2 }), 'Nothing to reheat. A reheat is already running.');
});

test('requestQueueAdd (common.js): the silent queue add resolves the body and rejects with the status', async () => {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    if (JSON.parse(init.body).mediaId === 'bad') return { ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) };
    if (JSON.parse(init.body).mediaId === 'full') return { ok: false, status: 409, json: async () => { throw new Error('no body'); } };
    return { ok: true, status: 200, json: async () => ({ added: { uid: 'u1' }, queue: { entries: [] } }) };
  };
  try {
    const body = await common.requestQueueAdd('v1', 'end', 'media');
    assert.deepStrictEqual(body.added, { uid: 'u1' });
    assert.strictEqual(calls[0].url, '/api/queue/items');
    assert.deepStrictEqual(JSON.parse(calls[0].init.body), { mediaId: 'v1', position: 'end', kind: 'media' });
    await common.requestQueueAdd('p1', 'next', 'podcast');
    assert.deepStrictEqual(JSON.parse(calls[1].init.body), { mediaId: 'p1', position: 'next', kind: 'podcast' });
    await common.requestQueueAdd('b1', undefined, 'book'); // an unknown kind is sent as media (the addToQueue rule)
    assert.deepStrictEqual(JSON.parse(calls[2].init.body), { mediaId: 'b1', position: 'end', kind: 'media' });
    await assert.rejects(common.requestQueueAdd('bad', 'end'), (err) => err.status === 403 && err.message === 'Forbidden' && err.body.error === 'Forbidden');
    await assert.rejects(common.requestQueueAdd('full', 'end'), (err) => err.status === 409 && err.message === 'Could not add to queue');
  } finally {
    global.fetch = realFetch;
  }
});

test('M7: bulkTrashConfirmCopy names the count and the total size, the single card\'s own second sentence, and the local-file warning', () => {
  const yt = (id, size) => media(id, { size, channelName: 'A Channel', channelUrl: 'https://www.youtube.com/@a' });
  const one = bulkTrashConfirmCopy([yt('a', 1024 * 1024)]);
  assert.strictEqual(one.title, 'Move to Trash?');
  assert.strictEqual(one.confirmLabel, 'Move to Trash');
  assert.strictEqual(one.cancelLabel, 'Cancel');
  assert.strictEqual(one.danger, true);
  assert.strictEqual(one.count, 1);
  assert.strictEqual(one.bytes, 1024 * 1024);
  assert.strictEqual(one.body, 'Move 1 item (' + (1024 * 1024) + ' B) to Trash? It leaves your library now and stays in Trash, where you can restore it from Settings, until the Trash retention window empties it.');
  const many = bulkTrashConfirmCopy([yt('a', 1000), yt('b', 2000), podcast('p')]);
  assert.strictEqual(many.count, 3);
  assert.strictEqual(many.bytes, 3000);
  assert.strictEqual(many.body, 'Move 3 items (3000 B plus 1 of unknown size) to Trash? They leave your library now and stay in Trash, where you can restore them from Settings, a podcast episode from its show, until the Trash retention window empties it.');
  // only episodes: they restore from their shows (gate r1 A7)
  assert.ok(bulkTrashConfirmCopy([podcast('p'), podcast('q')]).body.includes('restore them from their shows, until'));
  assert.ok(bulkTrashConfirmCopy([podcast('p')]).body.includes('restore it from its show, until'));
  // a plain local file in the set: the warning rides along, once
  const local = bulkTrashConfirmCopy([yt('a', 10), media('l', { size: 20 })]);
  assert.ok(local.body.endsWith(' until the Trash retention window empties it. Local files cannot be re-downloaded.'), local.body);
  assert.strictEqual((local.body.match(/Local files/g) || []).length, 1);
  // no sizes at all
  assert.ok(bulkTrashConfirmCopy([podcast('p'), podcast('q')]).body.startsWith('Move 2 items (size unknown) to Trash?'));
  assert.ok(bulkTrashConfirmCopy([media('m', { size: 5 })]).body.includes('restore it from Settings, until'));
  assert.strictEqual(bulkTrashConfirmCopy([]).count, 0);
});

test('M8: showMoveModal reads an unquoted `label` for a set and keeps the quoted title for one file', () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><body></body>');
  const doc = dom.window.document;
  const set = common.showMoveModal({ label: '12 items' }, ['/a', '/b'], () => {}, doc);
  assert.strictEqual(set.label.textContent, 'Move 12 items to:');
  set.teardown();
  const one = common.showMoveModal({ title: 'A file' }, ['/a'], () => {}, doc);
  assert.strictEqual(one.label.textContent, 'Move "A file" to:');
  one.teardown();
  const empty = common.showMoveModal({ label: '' , title: 'B' }, ['/a'], () => {}, doc);
  assert.strictEqual(empty.label.textContent, 'Move "B" to:', 'an empty label falls back to the title form');
  empty.teardown();
});
