'use strict';

// v1.15.0 item 1 (folder drag-and-drop reordering, folder-order-model-flagged
// -- HEAVIER review). This does NOT test DOM drag events (untestable-by-
// necessity, like the rest of the per-page client scripts -- Dean's on-device
// pass is the arbiter for the actual drag feel, AC1.3/AC1.4). Instead it
// proves the REORDER MODEL end-to-end: the pure client helpers
// (moveArrayItem/computeDropIndex/rebuildFullFolderOrder, see
// test/unit/folder-dnd-reorder.test.js) compute the exact `folders` array a
// real drag-and-drop gesture would produce, and that array is POSTed through
// the SAME `/api/config` path the existing up/down buttons already use (no
// server change -- server.js already derives the synthetic Downloads
// folder's `order` from its POSITION in the submitted `folders` array; see
// test/integration/ytdlp-synthetic-folder.test.js, the v1.13.0 pattern this
// reuses).
//
// Invariants proven here:
//   - AC1.1: a DnD-computed reorder of the synthetic Downloads folder
//     persists via folderSettings[downloadDir].order, and db.folders NEVER
//     contains the synthetic entry afterward.
//   - AC1.2: a DnD-computed reorder of real folders persists via db.folders
//     positional order (existing mechanism), verified end-to-end.
//   - A DnD reorder and an equivalent up/down sequence converge on the
//     IDENTICAL final array (same persisted result either way).
//   - The sidebar's rebuild-preserving-hidden-positions step
//     (rebuildFullFolderOrder) round-trips correctly when POSTed, including
//     the synthetic folder's order.
//   - AC1.5 / disabled-module: with the module disabled, no synthetic folder
//     ever appears, and a DnD-computed reorder of real folders alone behaves
//     byte-identically to today (no `order` field appears on a real folder).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-test-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, loadDatabase, updateDatabase } = require('../../server');
const { moveArrayItem, computeDropIndex, rebuildFullFolderOrder, visibleSidebarFolders } = require('../../public/js/common.js');

let server;
let base;
let downloadDir;

before(async () => {
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dnd-'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(downloadDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await updateDatabase((db) => { db.folders = []; db.folderSettings = {}; return true; });
});

test('AC1.1 + convergence: a DnD-computed drag of the synthetic Downloads folder to the front matches the equivalent up/down sequence, and persists via folderSettings.order without ever entering db.folders', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  const realA = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dnd-a-'));
  const realB = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dnd-b-'));
  try {
    await updateDatabase((db) => { db.folders = [realA, realB]; db.folderSettings = {}; return true; });
    const resolvedDownloadDir = path.resolve(downloadDir);

    const initial = await (await fetch(`${base}/api/config`)).json();
    assert.deepEqual(initial.folders, [realA, realB, resolvedDownloadDir], 'sanity: append-last with no stored order');

    // Up/down equivalent: two "move up" clicks on the synthetic entry
    // (index 2 -> 1 -> 0), exactly like the existing Setup-page fallback.
    let upDownResult = initial.folders.slice();
    [upDownResult[1], upDownResult[2]] = [upDownResult[2], upDownResult[1]];
    [upDownResult[0], upDownResult[1]] = [upDownResult[1], upDownResult[0]];
    assert.deepEqual(upDownResult, [resolvedDownloadDir, realA, realB]);

    // DnD equivalent: drag the synthetic entry (index 2) and drop it before
    // the first row (index 0) -- the SAME pure helpers the Setup list's row
    // drag handlers call on drop.
    const dragSrcIndex = initial.folders.indexOf(resolvedDownloadDir);
    const toIndex = computeDropIndex(dragSrcIndex, 0, true);
    const dndResult = moveArrayItem(initial.folders, dragSrcIndex, toIndex);

    assert.deepEqual(dndResult, upDownResult, 'a DnD reorder must produce the SAME resulting array as the equivalent up/down sequence');

    const postRes = await fetch(`${base}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folders: dndResult, folderSettings: initial.folderSettings }),
    });
    const postBody = await postRes.json();
    assert.equal(postRes.status, 200);
    assert.deepEqual(postBody.folders, [realA, realB], 'AC1.1: the synthetic root is never pushed into the persisted validFolders/db.folders response');
    assert.ok(!postBody.folders.includes(resolvedDownloadDir));

    assert.ok(!(loadDatabase().folders || []).includes(resolvedDownloadDir), 'AC1.1: db.folders on disk must never contain the synthetic entry after a DnD reorder');
    assert.ok(Number.isInteger(loadDatabase().folderSettings[resolvedDownloadDir].order), 'AC1.1: the synthetic entry\'s new position persists via folderSettings.order');

    const getBody = await (await fetch(`${base}/api/config`)).json();
    assert.deepEqual(getBody.folders, [resolvedDownloadDir, realA, realB], 'AC1.1: the DnD-computed reorder persists across a fresh GET, identical to the up/down result');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    fs.rmSync(realA, { recursive: true, force: true });
    fs.rmSync(realB, { recursive: true, force: true });
  }
});

test('sidebar DnD model: dragging the synthetic folder within the VISIBLE subset rebuilds the full order preserving a hidden-from-sidebar folder\'s absolute position, and still persists the synthetic order without entering db.folders', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  const realA = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dnd-c-'));
  const realHidden = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dnd-hidden-'));
  const realC = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dnd-d-'));
  try {
    await updateDatabase((db) => {
      db.folders = [realA, realHidden, realC];
      db.folderSettings = { [realHidden]: { name: '', hidden: false, hiddenFromSidebar: true } };
      return true;
    });
    const resolvedDownloadDir = path.resolve(downloadDir);

    const initial = await (await fetch(`${base}/api/config`)).json();
    assert.deepEqual(initial.folders, [realA, realHidden, realC, resolvedDownloadDir], 'sanity: append-last, hidden folder still present in the full array (only omitted from the sidebar LIST)');

    // The sidebar only ever shows the visible subset -- this is exactly what
    // renderSidebarFolders(full, settings) filters to before wiring DnD.
    const visible = visibleSidebarFolders(initial.folders, initial.folderSettings);
    assert.deepEqual(visible, [realA, realC, resolvedDownloadDir]);

    // Drag the synthetic entry (visible index 2) to the front of the VISIBLE
    // list (index 0) -- exactly what the sidebar's drop handler computes.
    const fromIndex = visible.indexOf(resolvedDownloadDir);
    const toIndex = computeDropIndex(fromIndex, 0, true);
    const newVisibleOrder = moveArrayItem(visible, fromIndex, toIndex);
    assert.deepEqual(newVisibleOrder, [resolvedDownloadDir, realA, realC]);

    const rebuiltFull = rebuildFullFolderOrder(initial.folders, initial.folderSettings, newVisibleOrder);
    assert.deepEqual(rebuiltFull, [resolvedDownloadDir, realHidden, realA, realC], 'the hidden-from-sidebar folder must keep its absolute position (index 1) while the visible entries reorder around it');

    const postRes = await fetch(`${base}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folders: rebuiltFull, folderSettings: initial.folderSettings }),
    });
    const postBody = await postRes.json();
    assert.equal(postRes.status, 200);
    assert.deepEqual(postBody.folders, [realHidden, realA, realC], 'the synthetic root is excluded from the persisted response; the real folders keep the rebuilt relative order');
    assert.ok(!(loadDatabase().folders || []).includes(resolvedDownloadDir), 'the synthetic folder must never enter db.folders via the sidebar DnD path either');

    const getBody = await (await fetch(`${base}/api/config`)).json();
    assert.deepEqual(getBody.folders, [resolvedDownloadDir, realHidden, realA, realC], 'the reorder persists across a fresh GET, synthetic folder spliced back at its stored order');
    assert.equal(getBody.folderSettings[realHidden].hiddenFromSidebar, true, 'the hidden-from-sidebar flag itself is untouched by the reorder');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
    fs.rmSync(realA, { recursive: true, force: true });
    fs.rmSync(realHidden, { recursive: true, force: true });
    fs.rmSync(realC, { recursive: true, force: true });
  }
});

test('AC1.2: a DnD-computed reorder of real folders (no synthetic folder involved) persists via db.folders positional order', async () => {
  const realA = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dnd-e-'));
  const realB = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dnd-f-'));
  const realC = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dnd-g-'));
  try {
    await updateDatabase((db) => { db.folders = [realA, realB, realC]; db.folderSettings = {}; return true; });

    // Drag the last folder (index 2) to the front (index 0).
    const dndResult = moveArrayItem([realA, realB, realC], 2, computeDropIndex(2, 0, true));
    assert.deepEqual(dndResult, [realC, realA, realB]);

    const postRes = await fetch(`${base}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folders: dndResult, folderSettings: {} }),
    });
    const postBody = await postRes.json();
    assert.equal(postRes.status, 200);
    assert.deepEqual(postBody.folders, [realC, realA, realB], 'AC1.2: real-folder order is purely positional in db.folders');
    assert.deepEqual(loadDatabase().folders, [realC, realA, realB]);

    const getBody = await (await fetch(`${base}/api/config`)).json();
    assert.deepEqual(getBody.folders, [realC, realA, realB], 'AC1.2: persists across a fresh GET');
  } finally {
    fs.rmSync(realA, { recursive: true, force: true });
    fs.rmSync(realB, { recursive: true, force: true });
    fs.rmSync(realC, { recursive: true, force: true });
  }
});

test('AC1.5 / disabled-module: no synthetic folder ever appears, and a DnD-computed reorder of real folders is byte-identical to the existing up/down behavior (no order field on a real folder)', async () => {
  assert.equal(process.env.FILETUBE_YTDLP_ENABLED, undefined, 'sanity: module must be disabled');
  const realA = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dnd-h-'));
  const realB = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dnd-i-'));
  try {
    await updateDatabase((db) => { db.folders = [realA, realB]; db.folderSettings = {}; return true; });

    const initial = await (await fetch(`${base}/api/config`)).json();
    assert.deepEqual(initial.folders, [realA, realB], 'disabled: no synthetic entry appears in the list to begin with');

    const dndResult = moveArrayItem(initial.folders, 1, computeDropIndex(1, 0, true));
    assert.deepEqual(dndResult, [realB, realA]);

    const postRes = await fetch(`${base}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folders: dndResult,
        folderSettings: { [realA]: { name: 'A', hidden: false }, [realB]: { name: 'B', hidden: false } },
      }),
    });
    const postBody = await postRes.json();
    assert.deepEqual(postBody.folders, [realB, realA]);
    assert.deepEqual(Object.keys(postBody.folderSettings[realA]).sort(), ['hidden', 'hiddenFromSidebar', 'name'], 'a real folder never gets an order field, disabled or not');

    const getBody = await (await fetch(`${base}/api/config`)).json();
    assert.deepEqual(getBody.folders, [realB, realA], 'disabled: still no synthetic entry after the reorder');
  } finally {
    fs.rmSync(realA, { recursive: true, force: true });
    fs.rmSync(realB, { recursive: true, force: true });
  }
});
