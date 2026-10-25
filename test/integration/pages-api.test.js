'use strict';

// [INTEGRATION] v1.395.0 Pages, Step 4 (plan D-API, D-AUTH, P8, P9, acceptance 4-9):
// the API against the REAL gate. Isolation: a second user cannot read, search,
// share, list-add, edit, delete or restore the first user's item, or touch their
// list - every Pages route, each a neutral 404 / 400. A `shortcut` token saves and
// is 401 everywhere else; revoking it ends it. An iOS device token may also save.
// The FILETUBE_API_TOKEN (no user) cannot reach Pages. The backup bundle carries
// read state + lists, and a users-replacing restore brings the items back from
// the files.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-pages-api-'));
process.env.FILETUBE_API_TOKEN = 'shared-api-token-0123456789abcdef';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, pages, userStore, deviceStore, __mintTestSession } = require('../../server');
const authCrypto = require('../../lib/auth/crypto');
const { DEVICE_SCOPE } = require('../../lib/auth/device-scope');

let server;
let base;
let owner;
let other;
const OWNER_PASSWORD = 'owner-password-1';
const ARTICLE = `<html><head><title>The boathouse moves</title><meta name="author" content="Sam Rivers"></head><body><article><h1>The boathouse moves</h1><p>${'The old boathouse is moving upstream this winter, the council said. '.repeat(12)}</p><p>Unique phrase: periwinkle lanterns.</p></article></body></html>`;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const o0 = __mintTestSession({ username: 'testadmin' });
  userStore.updatePassword(o0.user.id, await authCrypto.hashPassword(OWNER_PASSWORD));
  owner = __mintTestSession({ username: 'testadmin' });
  other = __mintTestSession({ username: 'sam', role: 'member' });
});
after(() => server.close());

function call(method, p, { session, body, headers = {} } = {}) {
  const h = Object.assign({}, headers);
  if (session) h.Cookie = session.cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  return fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
}
const json = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

let textItem;
let urlItem;
let list;

test('save: text, a device-captured page, a duplicate; the library, unread, search; Settings prompts drive Share with AI', async () => {
  const t = await json(await call('POST', '/api/pages', { session: owner, body: { text: 'Note to self.\n\nThe ferry leaves at noon from pier nine.', note: 'from Sam', source: 'web' } }));
  assert.strictEqual(t.status, 200, JSON.stringify(t.body));
  assert.strictEqual(t.body.message, 'Saved to Pages');
  textItem = t.body.item;
  assert.strictEqual(textItem.kind, 'text');
  const u = await json(await call('POST', '/api/pages', { session: owner, body: { url: 'https://news.example.com/boathouse', html: ARTICLE, source: 'extension' } }));
  assert.strictEqual(u.status, 200, JSON.stringify(u.body));
  urlItem = u.body.item;
  assert.strictEqual(urlItem.title, 'The boathouse moves');
  assert.strictEqual(urlItem.author, 'Sam Rivers');
  assert.strictEqual(urlItem.hasReader, true);
  const d = await json(await call('POST', '/api/pages', { session: owner, body: { url: 'https://news.example.com/boathouse', html: ARTICLE } }));
  assert.deepStrictEqual([d.body.duplicate, d.body.item.id, d.body.message], [true, urlItem.id, 'Already in Pages']);
  const all = await json(await call('GET', '/api/pages', { session: owner }));
  assert.deepStrictEqual(all.body.items.map((i) => i.id).sort(), [textItem.id, urlItem.id].sort());
  const found = await json(await call('GET', '/api/pages?q=' + encodeURIComponent('"periwinkle lanterns"'), { session: owner }));
  assert.deepStrictEqual(found.body.items.map((i) => i.id), [urlItem.id], 'full text search finds a phrase from the body (acceptance 4)');
  const byNote = await json(await call('GET', '/api/pages?q=sam', { session: owner }));
  assert.ok(byNote.body.items.some((i) => i.id === textItem.id), 'the note is searched');
});

test('read state, position and the note persist per user; unread view honours them', async () => {
  const p = await json(await call('PATCH', `/api/pages/${urlItem.id}`, { session: owner, body: { read: true, position: 0.42, note: 'reread the end' } }));
  assert.strictEqual(p.status, 200);
  assert.strictEqual(p.body.item.read, true);
  assert.strictEqual(p.body.item.position, 0.42);
  const g = await json(await call('GET', `/api/pages/${urlItem.id}`, { session: owner }));
  assert.strictEqual(g.body.item.note, 'reread the end');
  assert.match(g.body.reader, /periwinkle lanterns/);
  const unread = await json(await call('GET', '/api/pages?view=unread', { session: owner }));
  assert.deepStrictEqual(unread.body.items.map((i) => i.id), [textItem.id]);
  for (const bad of [{ position: 2 }, { position: 'x' }, { read: 'yes' }, { note: 5 }, { note: 'x'.repeat(4001) }]) {
    assert.strictEqual((await call('PATCH', `/api/pages/${urlItem.id}`, { session: owner, body: bad })).status, 400, JSON.stringify(bad).slice(0, 40));
  }
});

test('lists: create, set items with compare-and-set (a stale version is a 409), share a whole list with a prompt', async () => {
  const s = await json(await call('POST', '/api/settings', { session: owner, body: { transcriptAiPrompts: [{ name: 'Summarize', text: 'Summarize this in three bullets.' }] } }));
  assert.strictEqual(s.status, 200, JSON.stringify(s.body));
  const promptId = s.body.transcriptAiPrompts[0].id;
  const c = await json(await call('POST', '/api/pages/lists', { session: owner, body: { name: 'Weekend reading' } }));
  assert.strictEqual(c.status, 201);
  list = c.body.list;
  const cur = await json(await call('GET', `/api/pages/lists/${list.id}/items`, { session: owner }));
  const put = await json(await call('PUT', `/api/pages/lists/${list.id}/items`, { session: owner, body: { items: [urlItem.id, textItem.id], version: cur.body.version } }));
  assert.strictEqual(put.status, 200);
  const stale = await call('PUT', `/api/pages/lists/${list.id}/items`, { session: owner, body: { items: [textItem.id], version: cur.body.version } });
  assert.strictEqual(stale.status, 409, 'a stale client cannot drop an item another device added');
  const lists = await json(await call('GET', '/api/pages/lists', { session: owner }));
  assert.deepStrictEqual(lists.body.lists.map((l) => [l.name, l.count]), [['Weekend reading', 2]]);
  const inList = await json(await call('GET', `/api/pages?list=${list.id}`, { session: owner }));
  assert.deepStrictEqual(inList.body.items.map((i) => i.id), [urlItem.id, textItem.id], 'list order');
  const sh = await json(await call('GET', `/api/pages/lists/${list.id}/share?promptId=${promptId}`, { session: owner }));
  assert.strictEqual(sh.status, 200);
  assert.ok(sh.body.text.startsWith('Summarize this in three bullets.\n\nTitle: The boathouse moves\nAuthor: Sam Rivers\nSite: news.example.com\nURL: https://news.example.com/boathouse\n'), sh.body.text.slice(0, 200));
  assert.ok(sh.body.text.includes('\n\n---\n\nTitle: Note to self.\n'), 'each item has its own header, separated');
  assert.ok(sh.body.text.includes('Note: from Sam'));
  const one = await json(await call('GET', `/api/pages/${textItem.id}/share`, { session: owner }));
  assert.ok(one.body.text.startsWith('Title: Note to self.\n'), 'no promptId = the document alone (the client composes the prompt in the tap)');
  assert.strictEqual((await call('GET', `/api/pages/${textItem.id}/share?promptId=nope`, { session: owner })).status, 400);
});

test('isolation (P9): another user reaches NONE of it - every route, by id', async () => {
  const id = urlItem.id;
  const lid = list.id;
  const neutral = [
    ['GET', `/api/pages/${id}`], ['GET', `/api/pages/${id}/original`], ['GET', `/api/pages/${id}/share`],
    ['PATCH', `/api/pages/${id}`, { note: 'hijack', read: false }], ['DELETE', `/api/pages/${id}`], ['POST', `/api/pages/${id}/restore`],
    ['GET', `/api/pages/lists/${lid}/items`], ['PUT', `/api/pages/lists/${lid}/items`, { items: [], version: 'x' }],
    ['PATCH', `/api/pages/lists/${lid}`, { name: 'mine now' }], ['DELETE', `/api/pages/lists/${lid}`], ['GET', `/api/pages/lists/${lid}/share`],
    ['GET', `/api/pages?list=${lid}`],
  ];
  for (const [m, p, body] of neutral) {
    const r = await call(m, p, { session: other, body });
    assert.strictEqual(r.status, 404, `${m} ${p} -> ${r.status}`);
  }
  assert.strictEqual((await call('GET', `/api/pages/${id}/assets/0123456789abcdef01234567.png`, { session: other })).status, 404);
  const search = await json(await call('GET', '/api/pages?q=periwinkle', { session: other }));
  assert.deepStrictEqual([search.body.items, search.body.total], [[], 0]);
  assert.deepStrictEqual((await json(await call('GET', '/api/pages', { session: other }))).body.items, []);
  assert.deepStrictEqual((await json(await call('GET', '/api/pages?view=trash', { session: other }))).body.items, []);
  assert.deepStrictEqual((await json(await call('GET', '/api/pages/lists', { session: other }))).body.lists, []);
  const mine = await json(await call('POST', '/api/pages/lists', { session: other, body: { name: 'Sam list' } }));
  const v = await json(await call('GET', `/api/pages/lists/${mine.body.list.id}/items`, { session: other }));
  assert.strictEqual((await call('PUT', `/api/pages/lists/${mine.body.list.id}/items`, { session: other, body: { items: [id], version: v.body.version } })).status, 400, 'cannot list-add another user\'s item');
  // ... and everything is untouched for the owner.
  const g = await json(await call('GET', `/api/pages/${id}`, { session: owner }));
  assert.deepStrictEqual([g.body.item.note, g.body.item.trashedAt, g.body.item.read], ['reread the end', null, true]);
  assert.strictEqual((await json(await call('GET', '/api/pages/lists', { session: owner }))).body.lists[0].name, 'Weekend reading');
  // The same text saved by the other user is THEIR item (a duplicate is per user).
  const dup = await json(await call('POST', '/api/pages', { session: other, body: { url: 'https://news.example.com/boathouse', html: ARTICLE } }));
  assert.strictEqual(dup.body.duplicate, false);
  assert.notStrictEqual(dup.body.item.id, id);
});

test('delete goes to the trash and restores (acceptance 7)', async () => {
  const del = await json(await call('DELETE', `/api/pages/${textItem.id}`, { session: owner }));
  assert.ok(del.body.item.trashedAt);
  assert.deepStrictEqual((await json(await call('GET', '/api/pages?view=trash', { session: owner }))).body.items.map((i) => i.id), [textItem.id]);
  assert.ok(!(await json(await call('GET', '/api/pages', { session: owner }))).body.items.some((i) => i.id === textItem.id));
  const back = await json(await call('POST', `/api/pages/${textItem.id}/restore`, { session: owner }));
  assert.strictEqual(back.body.item.trashedAt, null);
});

test('no session: 401 on every Pages route; the shared API token (no user) cannot save', async () => {
  for (const [m, p] of [['GET', '/api/pages'], ['POST', '/api/pages'], ['GET', `/api/pages/${urlItem.id}`], ['GET', '/api/pages/lists']]) {
    assert.strictEqual((await call(m, p, { body: m === 'POST' ? { text: 'x' } : undefined })).status, 401, `${m} ${p}`);
  }
  const tok = await call('POST', '/api/pages', { body: { text: 'via api token' }, headers: { 'X-FileTube-Token': process.env.FILETUBE_API_TOKEN } });
  assert.strictEqual(tok.status, 401);
});

test('D-AUTH: a shortcut token (password re-entry, shown once) saves to Pages and is 401 on every other route; revoking it ends it', async () => {
  const bad = await call('POST', '/api/devices', { session: owner, body: { name: 'iOS Shortcut', platform: 'shortcut', password: 'wrong' } });
  assert.strictEqual(bad.status, 401);
  const paired = await json(await call('POST', '/api/devices', { session: owner, body: { name: 'iOS Shortcut', platform: 'shortcut', password: OWNER_PASSWORD } }));
  assert.strictEqual(paired.status, 201, JSON.stringify(paired.body));
  assert.match(paired.body.token, /^ftd_/);
  const bearer = { Authorization: 'Bearer ' + paired.body.token };
  const saved = await json(await call('POST', '/api/pages', { headers: bearer, body: { text: 'Shared from the Shortcut: a quote worth keeping.' } }));
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
  assert.strictEqual(pages.service.readRecord(pages.service.getItem(owner.user.id, saved.body.item.id)).source, 'shortcut', 'the source defaults to shortcut');
  // Every other route a device token could ever reach, plus Pages' own reads: 401.
  const others = [['GET', '/api/pages'], ['GET', `/api/pages/${urlItem.id}`], ['GET', '/api/pages/lists'], ['DELETE', `/api/pages/${urlItem.id}`], ['GET', '/api/auth/me'], ['POST', '/api/devices'], ['GET', '/api/devices']];
  for (const entry of DEVICE_SCOPE) {
    const [m, p] = entry.split(' ');
    if (m === 'POST' && p === '/api/pages') continue;
    others.push([m, p.replace(/:[A-Za-z]+/g, 'x')]);
  }
  for (const [m, p] of others) {
    const r = await call(m, p, { headers: bearer, body: m === 'GET' ? undefined : {} });
    assert.strictEqual(r.status, 401, `${m} ${p} -> ${r.status}`);
  }
  assert.ok((await json(await call('GET', `/api/pages/${urlItem.id}`, { session: owner }))).body.item.trashedAt === null, 'the refused DELETE changed nothing');
  // The token is listed with the user's devices and revocable.
  const devs = await json(await call('GET', '/api/devices', { session: owner }));
  const row = devs.body.devices.find((x) => x.platform === 'shortcut');
  assert.ok(row);
  assert.strictEqual((await call('DELETE', `/api/devices/${row.id}`, { session: owner })).status, 200);
  assert.strictEqual((await call('POST', '/api/pages', { headers: bearer, body: { text: 'after revoke' } })).status, 401);
});

test('an iOS device token keeps its scope and may also save to Pages', async () => {
  const issued = deviceStore.issue({ userId: owner.user.id, name: 'Phone', platform: 'ios', epoch: userStore.getById(owner.user.id).deviceEpoch }, new Date().toISOString());
  const bearer = { Authorization: 'Bearer ' + issued.token };
  const saved = await call('POST', '/api/pages', { headers: bearer, body: { text: 'From the app share sheet.', source: 'ios-share' } });
  assert.strictEqual(saved.status, 200);
  assert.strictEqual((await call('GET', '/api/auth/me', { headers: bearer })).status, 200, 'its old scope still works');
  assert.strictEqual((await call('GET', '/api/pages', { headers: bearer })).status, 403, 'but not the Pages reads');
});

test('the backup bundle carries read state + lists (never the index); a users-replacing restore brings items back from the files', async () => {
  const bundle = await json(await call('GET', '/api/admin/backup', { session: owner }));
  assert.strictEqual(bundle.status, 200);
  const me = bundle.body.users.find((u) => u.username === 'testadmin');
  assert.ok(me.pages, 'the per-user bundle has pages');
  assert.deepStrictEqual(me.pages.lists.map((l) => [l.name, l.items.map((i) => i.itemId)]), [['Weekend reading', [urlItem.id, textItem.id]]]);
  const st = me.pages.state.find((s) => s.itemId === urlItem.id);
  assert.strictEqual(st.position, 0.42);
  assert.ok(st.readAt);
  assert.ok(!JSON.stringify(bundle.body).includes('periwinkle'), 'no page content rides the bundle (the files are the source of truth)');
  const r = await json(await call('POST', '/api/admin/restore', { session: owner, body: bundle.body }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  owner = __mintTestSession({ username: 'testadmin' });
  // The index is rebuilt from the files in the background after a users restore.
  let g;
  for (let k = 0; k < 50; k += 1) {
    g = await json(await call('GET', `/api/pages/${urlItem.id}`, { session: owner }));
    if (g.status === 200) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.strictEqual(g.status, 200, 'the item is back');
  assert.deepStrictEqual([g.body.item.note, g.body.item.read, g.body.item.position], ['reread the end', true, 0.42]);
  assert.deepStrictEqual((await json(await call('GET', '/api/pages/lists', { session: owner }))).body.lists.map((l) => [l.name, l.count]), [['Weekend reading', 2]]);
  const bad = JSON.parse(JSON.stringify(bundle.body));
  bad.users.find((u) => u.username === 'testadmin').pages.state[0].position = 7;
  assert.strictEqual((await call('POST', '/api/admin/restore', { session: owner, body: bad })).status, 400, 'a bad pages row refuses the bundle');
});

test('admin rebuild from Settings: an admin-only route; a member is refused', async () => {
  other = __mintTestSession({ username: 'sam', role: 'member' }); // the restore above ended every older cookie (by design)
  assert.strictEqual((await call('POST', '/api/pages/rebuild', { session: other })).status, 403);
  const r = await json(await call('POST', '/api/pages/rebuild', { session: owner }));
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.indexed >= 3);
});

test('deleting an account sets its Pages folder aside (renamed, never unlinked); its id reused later starts empty', async () => {
  const sam = userStore.getByUsername('sam');
  const before = await json(await call('POST', '/api/pages', { session: other, body: { text: 'Sam keeps this.' } }));
  assert.strictEqual(before.status, 200);
  const folder = path.join(process.env.DATA_DIR, 'pages', String(sam.id));
  assert.ok(fs.existsSync(folder));
  assert.strictEqual((await call('DELETE', `/api/users/${sam.id}`, { session: owner })).status, 200);
  for (let k = 0; k < 50 && fs.existsSync(folder); k += 1) await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(fs.existsSync(folder), false, 'moved away');
  const aside = fs.readdirSync(path.join(process.env.DATA_DIR, 'pages', '.deleted-users'));
  assert.ok(aside.some((n) => n.startsWith(`${sam.id}-`)), aside.join(','));
  const kept = path.join(process.env.DATA_DIR, 'pages', '.deleted-users', aside.find((n) => n.startsWith(`${sam.id}-`)), 'items');
  assert.ok(fs.existsSync(kept), 'the files are kept');
});
