'use strict';

// ---- v1.77 Stop C: the folder glyph survives a real POST /api/config -------
//
// `cleanSettings` in server.js is an EXHAUSTIVE whitelist: it rebuilds each
// folder's settings object field by field, so anything not named there is
// silently dropped on every save. That is not hypothetical - v1.14.0 shipped
// exactly that bug with `hiddenFromSidebar`, and the code comment recording it
// sits three lines above the code this wave changed.
//
// A unit test of the resolver cannot see this: the client would send the glyph,
// the UI would look correct until reload, and the value would quietly vanish.
// So the round trip is proven against the REAL server, through the real auth
// gate, reading the persisted database back.
//
// The second half is the injection surface. The glyph is interpolated into a
// `class` attribute in string-built innerHTML at four render sites, so the
// server must never persist a value outside the registry - the client-side
// resolver defends too, but a server that stores arbitrary strings is one
// render-site refactor away from being an XSS primitive.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-glyph-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, loadDatabase, updateDatabase } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server, base, realA, realB;

before(async () => {
  realA = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-glyph-a-'));
  realB = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-glyph-b-'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  // Residual #110: the suite has leaked mkdtemp dirs badly enough to exhaust
  // the box's inodes and halt a wave. Every directory this file makes is
  // removed here, DATA_DIR included.
  for (const d of [realA, realB, process.env.DATA_DIR]) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

beforeEach(async () => {
  await updateDatabase((db) => {
    db.folders = [realA, realB];
    db.folderSettings = {};
    return true;
  });
});

async function postConfig(folderSettings) {
  const res = await fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folders: [realA, realB], folderSettings }),
  });
  return { status: res.status, body: await res.json() };
}

test('a chosen glyph round-trips: POST -> database -> GET', async () => {
  const { status } = await postConfig({
    [realA]: { name: 'Shows', glyph: 'shows' },
    [realB]: { name: 'School', glyph: 'school' },
  });
  assert.equal(status, 200);

  const stored = loadDatabase().folderSettings;
  assert.equal(stored[realA].glyph, 'shows', 'the glyph must survive the whitelist rebuild');
  assert.equal(stored[realB].glyph, 'school');

  const got = await (await fetch(`${base}/api/config`)).json();
  assert.equal(got.folderSettings[realA].glyph, 'shows', 'and come back out of GET /api/config');
});

test('the glyph does not disturb the fields that were already whitelisted', async () => {
  await postConfig({ [realA]: { name: 'Shows', glyph: 'shows', hidden: true, hiddenFromSidebar: true } });
  const s = loadDatabase().folderSettings[realA];
  assert.equal(s.name, 'Shows');
  assert.equal(s.hidden, true);
  assert.equal(s.hiddenFromSidebar, true);
  assert.equal(s.glyph, 'shows');
});

test('a folder with no glyph stores none - absence is the default, no backfill', async () => {
  // Every folder on an existing install is in this state. It must stay clean
  // rather than acquiring a written-in default.
  await postConfig({ [realA]: { name: 'Plain' } });
  const s = loadDatabase().folderSettings[realA];
  assert.ok(!('glyph' in s), `expected no glyph key, got ${JSON.stringify(s)}`);
});

test('REJECTED: a glyph outside the registry is dropped, not stored', async () => {
  const { status } = await postConfig({ [realA]: { name: 'X', glyph: 'definitely-not-a-glyph' } });
  assert.equal(status, 200, 'the save still succeeds - only the bad field is dropped');
  assert.ok(!('glyph' in loadDatabase().folderSettings[realA]),
    'an unknown glyph id must never reach the database');
});

test('REJECTED: injection payloads and wrong types never persist', async () => {
  const payloads = [
    '"><img src=x onerror=alert(1)>',
    'icon-shows',                 // the CLASS, not the id - close enough to be tempting
    'shows onload=alert(1)',
    '../../../etc/passwd',
    'shows ',                     // trailing space: not an exact registry id
    'SHOWS',                      // case matters
    42, true, null, {}, ['shows'],
  ];
  for (const glyph of payloads) {
    await postConfig({ [realA]: { name: 'X', glyph } });
    const s = loadDatabase().folderSettings[realA];
    assert.ok(!('glyph' in s),
      `payload ${JSON.stringify(glyph)} was persisted as ${JSON.stringify(s.glyph)}`);
  }
});

test('a previously-set glyph can be cleared back to the default', async () => {
  await postConfig({ [realA]: { name: 'X', glyph: 'shows' } });
  assert.equal(loadDatabase().folderSettings[realA].glyph, 'shows');
  await postConfig({ [realA]: { name: 'X', glyph: 'folder' } });
  assert.equal(loadDatabase().folderSettings[realA].glyph, 'folder',
    'picking Folder explicitly is a real choice and must persist as one');
  await postConfig({ [realA]: { name: 'X' } });
  assert.ok(!('glyph' in loadDatabase().folderSettings[realA]),
    'omitting the field clears it (the picker never has to send a sentinel)');
});

test('EVERY registry id is actually accepted by the server', async () => {
  // Derived from the registry: a glyph offered in the picker but rejected on
  // save would be a dead option in the UI, and nothing else would catch it.
  const { GLYPH_POOL } = require('../../public/js/glyph-pool.js');
  for (const g of GLYPH_POOL) {
    await postConfig({ [realA]: { name: 'X', glyph: g.id } });
    assert.equal(loadDatabase().folderSettings[realA].glyph, g.id,
      `the server rejected registry id '${g.id}', which the picker offers`);
  }
});
