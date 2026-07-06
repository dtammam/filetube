'use strict';

// v1.14.0 item 3 -- POST /api/config must round-trip the new per-folder
// `hiddenFromSidebar` flag (distinct from the existing `hidden`, "Hide from
// home") instead of silently dropping it, per the whitelist gotcha at
// server.js's folderSettings sanitizer. Isolated DATA_DIR before requiring the
// app, own process per file (node --test) -- mirrors
// test/integration/api.test.js / test/integration/settings-cache-api.test.js.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-hidden-sidebar-'));
const DB_FILE = path.join(process.env.DATA_DIR, 'db.json');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app } = require('../../server');

let server;
let base;
let folderA;
let folderB;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  if (fs.existsSync(DB_FILE)) fs.rmSync(DB_FILE);
  // POST /api/config only persists a folder that actually exists on disk.
  folderA = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-hidden-sidebar-folderA-'));
  folderB = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-hidden-sidebar-folderB-'));
});

function postConfig(folders, folderSettings) {
  return fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folders, folderSettings }),
  });
}

test('POST /api/config round-trips hiddenFromSidebar: true (not dropped by the sanitizer)', async () => {
  const res = await postConfig([folderA], { [folderA]: { name: 'Movies', hidden: false, hiddenFromSidebar: true } });
  assert.equal(res.status, 200);

  const getRes = await fetch(`${base}/api/config`);
  const json = await getRes.json();
  assert.equal(json.folderSettings[folderA].hiddenFromSidebar, true);
});

test('POST /api/config backfills a missing hiddenFromSidebar to false (no crash, existing folders unaffected)', async () => {
  const res = await postConfig([folderA], { [folderA]: { name: 'Movies', hidden: false } });
  assert.equal(res.status, 200);

  const getRes = await fetch(`${base}/api/config`);
  const json = await getRes.json();
  assert.equal(json.folderSettings[folderA].hiddenFromSidebar, false);
});

test('hidden ("Hide from home") and hiddenFromSidebar are independently settable in every combination', async () => {
  const res = await postConfig([folderA, folderB], {
    [folderA]: { name: 'A', hidden: true, hiddenFromSidebar: false },
    [folderB]: { name: 'B', hidden: false, hiddenFromSidebar: true },
  });
  assert.equal(res.status, 200);

  const json = await (await fetch(`${base}/api/config`)).json();
  assert.deepEqual(
    { hidden: json.folderSettings[folderA].hidden, hiddenFromSidebar: json.folderSettings[folderA].hiddenFromSidebar },
    { hidden: true, hiddenFromSidebar: false },
  );
  assert.deepEqual(
    { hidden: json.folderSettings[folderB].hidden, hiddenFromSidebar: json.folderSettings[folderB].hiddenFromSidebar },
    { hidden: false, hiddenFromSidebar: true },
  );
});

test('setting hiddenFromSidebar does not overwrite an existing hidden value, and vice versa', async () => {
  await postConfig([folderA], { [folderA]: { name: 'A', hidden: true, hiddenFromSidebar: false } });
  // A subsequent save only flips hiddenFromSidebar -- hidden must survive untouched.
  const res = await postConfig([folderA], { [folderA]: { name: 'A', hidden: true, hiddenFromSidebar: true } });
  assert.equal(res.status, 200);

  const json = await (await fetch(`${base}/api/config`)).json();
  assert.equal(json.folderSettings[folderA].hidden, true, 'hidden must be preserved across an unrelated change');
  assert.equal(json.folderSettings[folderA].hiddenFromSidebar, true);
});

test('a folder hidden from the sidebar remains fully reachable via GET /api/videos?root=<path>', async () => {
  await postConfig([folderA], { [folderA]: { name: 'A', hidden: false, hiddenFromSidebar: true } });

  const res = await fetch(`${base}/api/videos?root=${encodeURIComponent(folderA)}`);
  assert.equal(res.status, 200, 'hiddenFromSidebar must not affect the /api/videos?root= route');
  assert.ok(Array.isArray(await res.json()));
});
