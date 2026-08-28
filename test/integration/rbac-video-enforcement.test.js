'use strict';

// [INTEGRATION] v1.80 RBAC T4 - VIDEO enforcement end-to-end. A restricted
// member must be blocked on every video LIST and SERVE route for a restricted
// item (404 on serve, omitted from lists), while an UNrestricted item and the
// admin are unaffected - proving the gate DISCRIMINATES, not blanket-denies.
// This is the security proof for the video library; the same pattern extends to
// music/podcasts/books (remaining tasks). Isolated DATA_DIR; own process.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-rbac-video-'));
const DATA_DIR = process.env.DATA_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, userStore, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, auth, member;

// Real files on disk so an UNrestricted serve returns 200 (the RBAC check runs
// before file access, so a restricted serve 404s regardless).
const blockedFile = path.join(DATA_DIR, 'adult.mp4');
const allowedFile = path.join(DATA_DIR, 'kids.mp4');

before(async () => {
  fs.writeFileSync(blockedFile, 'BLOCKEDBYTES');
  fs.writeFileSync(allowedFile, 'ALLOWEDBYTES');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base); // admin

  saveDatabase({
    folders: [], folderSettings: {}, progress: {},
    metadata: {
      blocked: { id: 'blocked', title: 'Adult Video', filePath: blockedFile, folderName: 'Adult', channelName: 'Adult', rootFolder: DATA_DIR, type: 'video', ext: '.mp4', duration: 10, size: 12, addedAt: 20 },
      allowed: { id: 'allowed', title: 'Kids Video', filePath: allowedFile, folderName: 'Kids', channelName: 'Kids', rootFolder: DATA_DIR, type: 'video', ext: '.mp4', duration: 10, size: 12, addedAt: 10 },
    },
    // viewCounts so the restricted item is the MOST-watched (stats mostWatched),
    // and a trashed restricted item (trash list) - the two surfaces the security
    // gate found leaking restricted titles/counts.
    viewCounts: { blocked: 100, allowed: 5 },
    trash: {
      t1: { originalId: 'blocked', originalPath: blockedFile, rootFolder: DATA_DIR, trashedAt: 5,
        item: { id: 'blocked', title: 'Adult Video', name: 'Adult Video', filePath: blockedFile, folderName: 'Adult', rootFolder: DATA_DIR, type: 'video', ext: '.mp4' } },
      // v1.123 T3: a VISIBLE trashed item (Kids), so the capable-but-restricted
      // member can be shown to reach the trash-mutation handlers for what they
      // CAN see - proving the t1 block is visibility, not the write capability.
      t2: { originalId: 'allowed', originalPath: allowedFile, rootFolder: DATA_DIR, trashedAt: 4,
        item: { id: 'allowed', title: 'Kids Video', name: 'Kids Video', filePath: allowedFile, folderName: 'Kids', rootFolder: DATA_DIR, type: 'video', ext: '.mp4' } },
    },
    liked: [], settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });

  member = __mintTestSession({ username: 'kiddo', role: 'member' });
  // v1.81: this file proves the VISIBILITY gate (a restricted item 404s on
  // delete/move - no existence oracle). Grant this member the write capability
  // so those probes reach the visibility check instead of stopping at the new
  // write-RBAC 403 (which is proven separately in rbac-write-enforcement).
  userStore.setCanModifyLibrary(member.user.id, true);
  userStore.addLiked(member.user.id, 'blocked', '2026-08-05T00:00:00Z');
  userStore.addLiked(member.user.id, 'allowed', '2026-08-05T00:00:00Z');
  userStore.setProgress(member.user.id, 'blocked', { timestamp: 3, duration: 10, updatedAt: '2026-08-05T00:00:00Z' });
  userStore.setProgress(member.user.id, 'allowed', { timestamp: 3, duration: 10, updatedAt: '2026-08-05T00:00:00Z' });
  // Restrict the member on the "Adult" channel (folder).
  userStore.setRestrictions(member.user.id, [{ kind: 'folder', value: 'Adult' }]);
});
after(async () => {
  auth.restore();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const asMember = (p) => fetch(`${base}${p}`, { headers: { Cookie: member.cookie } });
const asAdmin = (p) => fetch(`${base}${p}`); // authenticateFetch patched global fetch with the admin cookie

test('SERVE: restricted member gets 404 on every video byte route; unrestricted 200', async () => {
  assert.strictEqual((await asMember('/video/blocked')).status, 404, '/video restricted -> 404');
  assert.strictEqual((await asMember('/video/allowed')).status, 200, '/video unrestricted -> 200');
  assert.strictEqual((await asMember('/audio/blocked')).status, 404, '/audio restricted -> 404');
  assert.strictEqual((await asMember('/thumbnail/blocked')).status, 404, '/thumbnail restricted -> 404');
  assert.strictEqual((await asMember('/api/subtitles/blocked')).status, 404, '/api/subtitles restricted -> 404');
  assert.strictEqual((await asMember('/api/transcript/blocked')).status, 404, '/api/transcript restricted -> 404');
  assert.strictEqual((await asMember('/api/videos/blocked')).status, 404, '/api/videos/:id restricted -> 404');
  assert.strictEqual((await asMember('/api/videos/allowed')).status, 200, '/api/videos/:id unrestricted -> 200');
  // ...and download-intent is not an escape hatch
  assert.strictEqual((await asMember('/video/blocked?download=1')).status, 404, 'download=1 is not an escape');
});

test('SERVE: the ADMIN is never blocked', async () => {
  assert.strictEqual((await asAdmin('/video/blocked')).status, 200, 'admin streams the restricted item');
  assert.strictEqual((await asAdmin('/api/videos/blocked')).status, 200);
});

test('ALLOWLIST mode: the member sees ONLY the granted channel (default-deny)', async () => {
  // Flip the member to allowlist, granting ONLY the "Kids" channel: now
  // "allowed" (Kids) is visible and EVERYTHING else - including any future
  // content - is denied. This is the kid-account belt-and-suspenders.
  userStore.setRestrictions(member.user.id, [{ kind: 'mode', value: 'allowlist' }, { kind: 'folder', value: 'Kids' }]);

  assert.strictEqual((await asMember('/video/allowed')).status, 200, 'granted Kids item plays');
  assert.strictEqual((await asMember('/video/blocked')).status, 404, 'un-granted Adult item denied');
  const ids = ((await (await asMember('/api/videos?limit=50')).json()).items || []).map((i) => i.id);
  assert.deepStrictEqual(ids, ['allowed'], 'allowlist shows only the granted channel');

  // restore blocklist for the remaining tests
  userStore.setRestrictions(member.user.id, [{ kind: 'folder', value: 'Adult' }]);
});

test('LIST: restricted item omitted from every list for the member; present for admin', async () => {
  const ids = async (p, key = 'items') => ((await (await asMember(p)).json())[key] || []).map((i) => i.id);

  assert.deepStrictEqual(await ids('/api/videos?limit=50'), ['allowed'], '/api/videos omits blocked');
  assert.deepStrictEqual(await ids('/api/liked?limit=50'), ['allowed'], '/api/liked omits blocked');
  assert.deepStrictEqual(await ids('/api/history?limit=50'), ['allowed'], '/api/history omits blocked');

  const channels = (await (await asMember('/api/channels')).json()).channels.map((c) => c.folder);
  assert.ok(channels.includes('Kids') && !channels.includes('Adult'), '/api/channels omits the Adult channel');

  // the feed never surfaces the restricted item in ANY row
  const feed = (await (await asMember('/api/home')).json()).rows || [];
  for (const row of feed) {
    assert.ok(!row.items.some((i) => i.id === 'blocked'), `feed row ${row.id} must not contain the restricted item`);
  }

  // admin sees both
  const adminVids = ((await (await asAdmin('/api/videos?limit=50')).json()).items || []).map((i) => i.id);
  assert.ok(adminVids.includes('blocked') && adminVids.includes('allowed'), 'admin sees the whole library');
});

test('MUTATION: restricted member 404s on destructive/mutating routes (binds W1 guard)', async () => {
  // Adversarial delta: restrictedVideoMutation worked but was unbound. Bind it,
  // so a future edit that reopens the destructive hole fails RED. (We do NOT
  // delete as admin - that would trash the fixture mid-file.)
  const post = (p) => fetch(`${base}${p}`, { method: 'POST', headers: { Cookie: member.cookie, 'Content-Type': 'application/json' }, body: '{}' });
  const del = (p) => fetch(`${base}${p}`, { method: 'DELETE', headers: { Cookie: member.cookie } });
  assert.strictEqual((await del('/api/videos/blocked')).status, 404, 'restricted DELETE');
  assert.strictEqual((await post('/api/videos/blocked/move')).status, 404, 'restricted move');
  assert.strictEqual((await post('/api/videos/blocked/view')).status, 404, 'restricted view');
  assert.strictEqual((await post('/api/watched/blocked')).status, 404, 'restricted watched-write');
  assert.strictEqual((await post('/api/liked/blocked')).status, 404, 'restricted liked-write');
  // an UNrestricted item is NOT blocked by this guard (proves discrimination) -
  // POST /api/watched/allowed reaches the handler (200), not a 404 from the guard.
  assert.strictEqual((await post('/api/watched/allowed')).status, 200, 'unrestricted watched-write allowed');
});

test('STATS + TRASH: restricted titles/counts do not leak to the member (security-gate finding)', async () => {
  // /api/stats mostWatched must not carry the restricted title, and its media
  // count must reflect only the visible item.
  const stats = await (await asMember('/api/stats')).json();
  const mostWatchedTitles = (stats.mostWatched || []).map((m) => m.title);
  assert.ok(!mostWatchedTitles.includes('Adult Video'), 'restricted title must not appear in mostWatched');
  assert.ok(!(stats.mostWatched || []).some((m) => m.id === 'blocked'), 'restricted id must not appear in mostWatched');

  // /api/trash must omit the restricted trashed item.
  const trash = (await (await asMember('/api/trash')).json()).items || [];
  assert.ok(!trash.some((t) => t.originalId === 'blocked'), 'restricted item must not appear in trash for the member');

  // admin still sees both surfaces fully.
  const adminStats = await (await asAdmin('/api/stats')).json();
  assert.ok((adminStats.mostWatched || []).some((m) => m.id === 'blocked'), 'admin mostWatched includes the item');
  const adminTrash = (await (await asAdmin('/api/trash')).json()).items || [];
  assert.ok(adminTrash.some((t) => t.originalId === 'blocked'), 'admin sees the trashed item');
});

// v1.123 T3 (security): the trash MUTATION routes shared the podcast bypass class
// - requireModifyLibrary gates the capability, but restore/purge never checked
// VISIBILITY, so a capable-but-restricted member could restore or PERMANENTLY
// purge a trashed item hidden from them. `member` holds canModifyLibrary and is
// restricted on the "Adult" folder, so the 404s below can only be the visibility
// guard; the t2 (Kids) purge proves the capability is genuinely present. Runs
// last: it retires t1/t2, which earlier tests need intact.
test('TRASH MUTATION: capable-but-restricted member 404s on restore/purge of a hidden trashed item', async () => {
  const del = (p, admin) => fetch(`${base}${p}`, { method: 'DELETE', headers: admin ? {} : { Cookie: member.cookie } });
  const post = (p) => fetch(`${base}${p}`, { method: 'POST', headers: { Cookie: member.cookie, 'Content-Type': 'application/json' }, body: '{}' });

  // Restricted trashed item (t1 = Adult): both mutation routes 404 for the member.
  assert.strictEqual((await post('/api/trash/t1/restore')).status, 404, 'restricted trash RESTORE -> 404 (visibility)');
  assert.strictEqual((await del('/api/trash/t1')).status, 404, 'restricted trash PURGE -> 404 (visibility)');

  // Discrimination: the SAME capable member reaches the handler for a VISIBLE
  // trashed item (t2 = Kids) -> 200 (unconfined trashPath -> record retired,
  // nothing touched on disk). Proves the t1 block was visibility, not capability.
  assert.strictEqual((await del('/api/trash/t2')).status, 200, 'visible trash PURGE reaches the handler for the capable member');

  // The admin is never visibility-blocked: purge of the restricted t1 -> 200.
  assert.strictEqual((await del('/api/trash/t1', true)).status, 200, 'admin not visibility-blocked on the restricted purge');
});
