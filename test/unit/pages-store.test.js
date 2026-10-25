'use strict';

// [UNIT] v1.395.0 Pages, Step 1 (plan D-STORE / D-DB / P10): the files are the
// source of truth. A saved item comes back after the index tables are dropped and
// rebuilt; delete -> trash -> restore round-trips byte-identical; only trashed
// items older than 30 days (by their OWN item.json stamp) are ever unlinked; a
// crash mid-write leaves nothing the rebuild indexes; a folder is indexed only for
// the account its owner.json names; per-user state survives a rebuild.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SqliteAdapter, SQLITE_FILENAME } = require('../../lib/db/sqlite');
const { createPagesService } = require('../../lib/pages/service');
const disk = require('../../lib/pages/disk');
const paths = require('../../lib/pages/paths');
const metaLib = require('../../lib/pages/meta');

const DAY = 86400e3;

function setup({ users = [[1, 'dean'], [2, 'sam']] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-pages-store-'));
  const dbPath = path.join(dir, SQLITE_FILENAME);
  const adapter = new SqliteAdapter(dbPath, { log: () => {} });
  for (const [id, name] of users) {
    adapter.sql.prepare("INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, 'x', 'member', '2026-01-01T00:00:00.000Z')").run(id, name, name);
  }
  const byId = (id) => {
    const r = adapter.sql.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
    return r ? { id: r.id, username: r.username } : null;
  };
  const root = path.join(dir, 'pages');
  let clock = Date.UTC(2026, 9, 25, 12, 0, 0);
  const logs = [];
  const svc = createPagesService({ adapter, root, now: () => clock, log: (l) => logs.push(l), userStore: { getById: byId } });
  return { dir, dbPath, adapter, root, svc, logs, tick: (ms) => { clock += ms; }, now: () => clock };
}

function dropAndRecreateTables(t) {
  t.adapter.sql.exec('DROP TRIGGER pages_items_fts_delete; DROP TABLE pages_items; DROP TABLE pages_fts; PRAGMA user_version = 38');
  t.adapter.close();
  t.adapter = new SqliteAdapter(t.dbPath, { log: () => {} });
  const byId = (id) => {
    const r = t.adapter.sql.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
    return r ? { id: r.id, username: r.username } : null;
  };
  t.svc = createPagesService({ adapter: t.adapter, root: t.root, now: t.now, log: (l) => t.logs.push(l), userStore: { getById: byId } });
}

test('demo: save a text item, drop the tables, rebuild, and it comes back with its note and its text searchable', async () => {
  const t = setup();
  const text = 'An email from Sam.\n\nThe meeting moved to Thursday at the old boathouse.\nBring the maps.';
  const { item, duplicate } = await t.svc.saveText(1, { text, note: 'from Sam', source: 'web' });
  assert.strictEqual(duplicate, false);
  assert.strictEqual(item.kind, 'text');
  assert.strictEqual(item.title, 'An email from Sam.');
  assert.ok(paths.isItemId(item.id));
  const recordBefore = t.svc.readRecord(item);
  assert.strictEqual(recordBefore.note, 'from Sam');
  const dirBefore = disk.locate(t.root, 1, item.folder).dir;
  const filesBefore = Object.fromEntries(fs.readdirSync(dirBefore).map((f) => [f, fs.readFileSync(path.join(dirBefore, f), 'utf8')]));

  dropAndRecreateTables(t);
  assert.strictEqual(t.adapter.sql.prepare('PRAGMA user_version').get().user_version >= 39, true);
  assert.strictEqual(t.svc.index.countAll(), 0, 'the index is born empty again');
  const r = await t.svc.rebuildIfEmpty();
  assert.deepStrictEqual({ ran: r.ran, indexed: r.indexed, refused: r.refused }, { ran: true, indexed: 1, refused: false });

  const back = t.svc.getItem(1, item.id);
  assert.ok(back, 'the item is back');
  for (const k of ['id', 'folder', 'kind', 'title', 'savedAt', 'wordCount', 'hasReader', 'hasOriginal']) assert.deepStrictEqual(back[k], item[k], k);
  assert.strictEqual(t.svc.readRecord(back).note, 'from Sam', 'the note is restored from item.json');
  const found = t.svc.index.listItems(1, { q: 'boathouse' });
  assert.deepStrictEqual(found.items.map((i) => i.id), [item.id], 'the body is searchable again');
  assert.deepStrictEqual(t.svc.index.listItems(1, { q: '"from sam"' }).items.map((i) => i.id), [item.id], 'the note is searchable');
  const filesAfter = Object.fromEntries(fs.readdirSync(dirBefore).map((f) => [f, fs.readFileSync(path.join(dirBefore, f), 'utf8')]));
  assert.deepStrictEqual(filesAfter, filesBefore, 'the rebuild never writes a file');
});

test('a rebuild never forgets per-user state: read time and position live outside the index', async () => {
  const t = setup();
  const { item } = await t.svc.saveText(1, { text: 'One two three.' });
  t.svc.setReadState(1, item.id, { read: true, position: 0.5 });
  const before = t.svc.getItem(1, item.id);
  assert.ok(before.readAt);
  assert.strictEqual(before.position, 0.5);
  await t.svc.rebuild();
  const after = t.svc.getItem(1, item.id);
  assert.strictEqual(after.readAt, before.readAt);
  assert.strictEqual(after.position, 0.5);
});

test('delete -> trash -> restore round-trips every file byte-identical; the trash stamp is the only change while trashed', async () => {
  const t = setup();
  const { item } = await t.svc.saveText(1, { text: 'Keep me.\n\nSecond paragraph.', note: 'n' });
  const loc = (where) => paths.itemDir(t.root, 1, item.folder, where);
  const snap = (dir) => {
    const out = {};
    const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, rel + e.name + '/'); else out[rel + e.name] = fs.readFileSync(p).toString('hex'); } };
    walk(dir, '');
    return out;
  };
  const before = snap(loc('items'));
  const trashed = await t.svc.trash(1, item.id);
  assert.ok(trashed.trashedAt);
  assert.strictEqual(fs.existsSync(loc('items')), false, 'moved, not copied');
  const inTrash = snap(loc('trash'));
  assert.deepStrictEqual(Object.keys(inTrash), Object.keys(before));
  for (const k of Object.keys(before)) if (k !== 'item.json') assert.strictEqual(inTrash[k], before[k], k);
  assert.match(Buffer.from(inTrash['item.json'], 'hex').toString(), /"trashedAt": "2026-10-25T12:00:00.000Z"/);
  assert.deepStrictEqual(t.svc.index.listItems(1, { view: 'all' }).items.map((i) => i.id), []);
  assert.deepStrictEqual(t.svc.index.listItems(1, { view: 'trash' }).items.map((i) => i.id), [item.id]);
  await t.svc.restore(1, item.id);
  assert.deepStrictEqual(snap(loc('items')), before, 'byte-identical after the round trip');
  assert.strictEqual(fs.existsSync(loc('trash')), false);
  assert.strictEqual(t.svc.getItem(1, item.id).trashedAt, null);
});

test('trash expiry removes ONLY trashed items whose own stamp is 30+ days old; live items and young trash stay', async () => {
  const t = setup();
  const live = (await t.svc.saveText(1, { text: 'Live item.' })).item;
  const old = (await t.svc.saveText(1, { text: 'Old trash.' })).item;
  await t.svc.trash(1, old.id);
  t.tick(20 * DAY);
  const young = (await t.svc.saveText(1, { text: 'Young trash.' })).item;
  await t.svc.trash(1, young.id);
  t.tick(10 * DAY - 1000);
  assert.strictEqual(await t.svc.purgeExpired(), 0, 'one second short of 30 days: nothing goes');
  t.tick(2000);
  assert.strictEqual(await t.svc.purgeExpired(), 1);
  assert.strictEqual(fs.existsSync(paths.itemDir(t.root, 1, old.folder, 'trash')), false, 'the expired one is gone');
  assert.strictEqual(t.svc.getItem(1, old.id), null);
  assert.ok(fs.existsSync(paths.itemDir(t.root, 1, young.folder, 'trash')), 'young trash stays');
  assert.ok(fs.existsSync(paths.itemDir(t.root, 1, live.folder, 'items')), 'a live item stays');
  // A live item is never expired, even if its record claims an ancient trash stamp
  // but it sits in items/ (only trash/ is ever walked by the sweep).
  const liveDir = paths.itemDir(t.root, 1, live.folder, 'items');
  const rec = disk.readItem(liveDir);
  disk.updateItem(liveDir, { ...rec, trashedAt: '2020-01-01T00:00:00.000Z' });
  t.tick(400 * DAY);
  await t.svc.purgeExpired();
  assert.ok(fs.existsSync(liveDir), 'items/ is never purged');
});

test('purgeTrashed refuses: no stamp, a future stamp, a stamp younger than the retention, an id that does not match the folder', async () => {
  const t = setup();
  const { item } = await t.svc.saveText(1, { text: 'x' });
  await t.svc.trash(1, item.id);
  const dir = paths.itemDir(t.root, 1, item.folder, 'trash');
  const rec = disk.readItem(dir);
  const nowMs = t.now() + 40 * DAY;
  const { trashedAt: _t, ...noStamp } = rec;
  disk.updateItem(dir, noStamp);
  assert.strictEqual(disk.purgeTrashed(t.root, 1, item.folder, nowMs), false, 'no stamp');
  disk.updateItem(dir, { ...rec, trashedAt: new Date(nowMs + DAY / 2).toISOString() });
  assert.strictEqual(disk.purgeTrashed(t.root, 1, item.folder, nowMs + DAY / 4), false, 'future stamp');
  disk.updateItem(dir, { ...rec, trashedAt: new Date(nowMs - 29 * DAY).toISOString() });
  assert.strictEqual(disk.purgeTrashed(t.root, 1, item.folder, nowMs), false, 'too young');
  disk.updateItem(dir, { ...rec, id: 'aaaaaaaaaaaa', trashedAt: new Date(nowMs - 31 * DAY).toISOString() });
  assert.strictEqual(disk.purgeTrashed(t.root, 1, item.folder, nowMs), false, 'id mismatch');
  assert.ok(fs.existsSync(dir));
  disk.updateItem(dir, { ...rec, trashedAt: new Date(nowMs - 31 * DAY).toISOString() });
  assert.strictEqual(disk.purgeTrashed(t.root, 1, item.folder, nowMs), true, 'the control: a valid old stamp is purged');
});

test('a crash mid-write leaves no indexed partial: a .part folder and a temp file are invisible to the rebuild', async () => {
  const t = setup();
  const { item } = await t.svc.saveText(1, { text: 'Complete item.' });
  const year = item.folder.slice(0, 4);
  const yearDir = path.join(t.root, '1', 'items', year);
  // The leftovers of a SIGKILL between the build and the rename (createItem's temp):
  const part = path.join(yearDir, '.2026-10-25-half-written-bbbbbbbbbbbb.part-1234abcd');
  fs.mkdirSync(part);
  fs.writeFileSync(path.join(part, 'text.txt'), 'half');
  fs.writeFileSync(path.join(part, 'item.json'), metaLib.serializeMeta(metaLib.normalizeMeta({ schema: 1, id: 'bbbbbbbbbbbb', kind: 'text', title: 'half', savedAt: '2026-10-25T00:00:00.000Z' })));
  // ... and a folder whose rename landed but whose item.json never did (not createItem's
  // order, but a hand copy can do it):
  fs.mkdirSync(path.join(yearDir, '2026-10-25-no-record-cccccccccccc'));
  // ... and an atomic-write temp next to a real item.json:
  const realDir = disk.locate(t.root, 1, item.folder).dir;
  fs.writeFileSync(path.join(realDir, '.item.json.tmp-deadbeef'), '{"broken":');
  const r = await t.svc.rebuild();
  assert.strictEqual(r.indexed, 1);
  assert.deepStrictEqual(t.svc.index.listItems(1).items.map((i) => i.id), [item.id]);
  assert.strictEqual(t.svc.getItem(1, 'bbbbbbbbbbbb'), null);
  assert.strictEqual(t.svc.getItem(1, 'cccccccccccc'), null);
});

test('createItem failing part-way (a write throws) leaves no folder and no index row', async () => {
  const t = setup();
  const orig = fs.writeFileSync;
  let n = 0;
  fs.writeFileSync = function (...a) { n += 1; if (n === 2) throw Object.assign(new Error('ENOSPC: no space left'), { code: 'ENOSPC' }); return orig.apply(this, a); };
  try {
    await assert.rejects(t.svc.saveText(1, { text: 'Will fail.' }), /ENOSPC/);
  } finally { fs.writeFileSync = orig; }
  assert.strictEqual(t.svc.index.countAll(), 0);
  const items = path.join(t.root, '1', 'items');
  const left = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { left.push(e.name); if (e.isDirectory()) walk(path.join(d, e.name)); } };
  walk(items);
  assert.deepStrictEqual(left.filter((x) => !/^\d{4}$/.test(x)), [], 'no folder, no temp');
});

test('a folder is indexed only for the account its owner.json names (an id reused by another person starts empty)', async () => {
  const t = setup();
  const { item } = await t.svc.saveText(2, { text: 'Sam owns this.' });
  assert.deepStrictEqual(disk.readOwner(t.root, 2), { userId: 2, username: 'sam' });
  // Sam's account is removed and a different person later gets id 2.
  t.adapter.sql.exec("DELETE FROM users WHERE id = 2; INSERT INTO users (id, username, password_hash, role, created_at) VALUES (2, 'kid', 'x', 'member', '2026-02-02T00:00:00.000Z')");
  await t.svc.rebuild();
  assert.strictEqual(t.svc.getItem(2, item.id), null, 'kid never sees Sam\'s item');
  assert.ok(t.logs.some((l) => /belongs to "sam", not "kid"/.test(l)), t.logs.join('\n'));
  // The control: the same rebuild indexes it when the name matches.
  t.adapter.sql.exec("UPDATE users SET username = 'Sam' WHERE id = 2");
  await t.svc.rebuild();
  assert.ok(t.svc.getItem(2, item.id), 'case-insensitive like login');
});

test('userDeleted sets the folder aside (renamed, never unlinked); the next account with that id starts empty', async () => {
  const t = setup();
  const { item } = await t.svc.saveText(2, { text: 'Sam again.' });
  const aside = await t.svc.userDeleted(2);
  assert.ok(aside && fs.existsSync(path.join(aside, 'items')), 'the content is kept, aside');
  assert.strictEqual(fs.existsSync(path.join(t.root, '2')), false);
  assert.ok(path.basename(path.dirname(aside)) === '.deleted-users');
  await t.svc.rebuild({ force: true });
  assert.strictEqual(t.svc.getItem(2, item.id), null);
});

test('a rebuild over a missing or empty Pages folder is REFUSED while the index has rows (an unmount is not a delete)', async () => {
  const t = setup();
  const { item } = await t.svc.saveText(1, { text: 'Mounted.' });
  fs.renameSync(t.root, t.root + '-unmounted');
  const r = await t.svc.rebuild();
  assert.strictEqual(r.refused, true);
  assert.ok(t.svc.getItem(1, item.id), 'the index is untouched');
  assert.ok(t.logs.some((l) => /rebuild REFUSED/.test(l)));
  fs.mkdirSync(t.root);
  assert.strictEqual((await t.svc.rebuild()).refused, true, 'an empty folder too');
  assert.strictEqual((await t.svc.rebuild({ force: true })).refused, false, 'force is the operator override');
  assert.strictEqual(t.svc.getItem(1, item.id), null);
});

test('isolation in the index: every read is scoped by the user id', async () => {
  const t = setup();
  const a = (await t.svc.saveText(1, { text: 'Alpha secret words.' })).item;
  assert.strictEqual(t.svc.getItem(2, a.id), null);
  assert.deepStrictEqual(t.svc.index.listItems(2, { q: 'secret' }).items, []);
  assert.deepStrictEqual(t.svc.index.listItems(2).items, []);
  assert.strictEqual(await t.svc.trash(2, a.id), null);
  assert.strictEqual(await t.svc.setNote(2, a.id, 'x'), null);
  assert.strictEqual(t.svc.setReadState(2, a.id, { read: true }), null);
  assert.strictEqual(t.svc.getItem(1, a.id).trashedAt, null, 'untouched');
});

test('the FTS query builder turns any input into quoted terms: no operator, column filter or syntax error reaches FTS5', async () => {
  const t = setup();
  await t.svc.saveText(1, { text: 'The quick brown fox jumps over the lazy dog. NEAR the barn.' });
  for (const q of ['title:fox', 'fox OR cat', 'NEAR(fox dog)', '"unterminated', '*', '-fox', 'fox AND', '()', '\'"\'', 'a"b', '^fox']) {
    assert.doesNotThrow(() => t.svc.index.listItems(1, { q }), q);
  }
  assert.strictEqual(t.svc.index.listItems(1, { q: 'title:fox' }).total, 0, 'the colon is no column filter: "title" is just a word, and it is not there');
  assert.strictEqual(t.svc.index.listItems(1, { q: 'near barn' }).total, 1, 'NEAR is a word, not an operator');
  assert.strictEqual(t.svc.index.listItems(1, { q: 'fox OR cat' }).total, 0, 'OR is a word too (all words must match)');
  assert.strictEqual(t.svc.index.listItems(1, { q: '"brown fox"' }).total, 1, 'a phrase');
  assert.strictEqual(t.svc.index.listItems(1, { q: '"fox brown"' }).total, 0, 'a phrase is ordered');
  assert.strictEqual(t.svc.index.listItems(1, { q: 'jum' }).total, 1, 'the last word is a prefix');
});

test('gate r1 A1/W1: a save by a different account never takes over a folder whose owner.json names someone else - it is set aside first', async () => {
  const t = setup();
  const { item } = await t.svc.saveText(2, { text: 'Sam private: my therapist notes from Tuesday.' });
  // A users-replacing restore gives id 2 to a different person.
  t.adapter.sql.exec("DELETE FROM users WHERE id = 2; INSERT INTO users (id, username, password_hash, role, created_at) VALUES (2, 'kid', 'x', 'member', '2026-02-02T00:00:00.000Z')");
  await t.svc.rebuild({ force: true });
  const mine = await t.svc.saveText(2, { text: 'Kid homework.' });
  await t.svc.rebuild();
  assert.strictEqual(t.svc.getItem(2, item.id), null, 'Sam\'s item never reaches the kid');
  assert.deepStrictEqual(t.svc.index.listItems(2, { q: 'therapist' }).items, []);
  assert.ok(t.svc.getItem(2, mine.item.id), 'the kid keeps their own item');
  assert.deepStrictEqual(disk.readOwner(t.root, 2), { userId: 2, username: 'kid' });
  const aside = fs.readdirSync(path.join(t.root, '.deleted-users'));
  assert.strictEqual(aside.length, 1, 'Sam\'s folder is kept, aside');
  assert.ok(fs.existsSync(path.join(t.root, '.deleted-users', aside[0], 'items')));
  // Case-only differences are the same account (like login): no set-aside.
  t.adapter.sql.exec("UPDATE users SET username = 'KID' WHERE id = 2");
  await t.svc.saveText(2, { text: 'More homework.' });
  assert.strictEqual(fs.readdirSync(path.join(t.root, '.deleted-users')).length, 1);
});

test('gate r1 qa W2: the trash expiry forgets the item\'s read state and list memberships', async () => {
  const t = setup();
  const { item } = await t.svc.saveText(1, { text: 'Gone soon.' });
  t.svc.setReadState(1, item.id, { read: true, position: 0.3 });
  t.svc.index.createList(1, 'aaaaaaaaaaaa', 'L', '2026-10-25T00:00:00.000Z');
  t.svc.index.setListItems(1, 'aaaaaaaaaaaa', [item.id], '2026-10-25T00:00:00.000Z');
  await t.svc.trash(1, item.id);
  t.tick(31 * DAY);
  assert.strictEqual(await t.svc.purgeExpired(), 1);
  assert.deepStrictEqual(t.svc.index.listItemIds(1, 'aaaaaaaaaaaa'), []);
  assert.strictEqual(t.svc.index.getState(1, item.id), null);
});

test('gate r1 qa W3: only URL items are duplicate keys; a text save that carries the link is not', async () => {
  const t = setup();
  await t.svc.saveText(1, { text: 'Quote from the article.', url: 'https://example.com/a' });
  assert.strictEqual(t.svc.index.findByUrl(1, 'https://example.com/a'), null);
});

test('gate r2 A8: a damaged owner.json in a folder whose items ARE this account\'s is rewritten, never set aside', async () => {
  const t = setup();
  const first = (await t.svc.saveText(1, { text: 'Mine.' })).item;
  fs.writeFileSync(path.join(t.root, '1', 'owner.json'), '');
  const second = (await t.svc.saveText(1, { text: 'Mine too.' })).item;
  assert.strictEqual(fs.existsSync(path.join(t.root, '.deleted-users')), false, 'nothing set aside');
  assert.deepStrictEqual(disk.readOwner(t.root, 1), { userId: 1, username: 'dean' });
  assert.ok(t.svc.readRecord(t.svc.getItem(1, first.id)), 'the first item is still where its index row says');
  assert.ok(await t.svc.trash(1, first.id));
  assert.ok(t.svc.getItem(1, second.id));
  // The other side: a folder with no owner.json and items this account's index does NOT hold is set aside.
  fs.unlinkSync(path.join(t.root, '1', 'owner.json'));
  t.svc.index.replaceIndex([], { userIds: [1] });
  await t.svc.saveText(1, { text: 'After.' });
  assert.strictEqual(fs.readdirSync(path.join(t.root, '.deleted-users')).length, 1);
  assert.deepStrictEqual(t.svc.index.listItems(1).items.map((i) => i.kind), ['text']);
});
