'use strict';

// [INTEGRATION] v1.41.11 (Dean): GET /api/duplicates + GET /api/duplicates.csv
// against the REAL routes -- report shape, the injected production extractor
// actually wired in, CSV headers/disposition, and the read-only contract
// (these routes must never mutate db.json).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-dupes-'));
const DB_FILE = path.join(process.env.DATA_DIR, 'db.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase } = require('../../server');

let server;
let base;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;

  const items = [
    { id: 'n1', filePath: '/lib/a/copy me 😳.mp4', size: 300 },
    { id: 'n2', filePath: '/lib/b/copy me 😳.mp4', size: 200 },
    { id: 'i1', filePath: '/dl/chan1/Old Title [AAAAAAAAAAA].mp4', size: 900 },
    { id: 'i2', filePath: '/dl/chan2/New Title [AAAAAAAAAAA].mp4', size: 100 },
    { id: 'u1', filePath: '/lib/a/unique.mp4', size: 50 },
  ];
  const metadata = {};
  for (const it of items) {
    metadata[it.id] = {
      ...it, name: path.basename(it.filePath), title: it.id, ext: '.mp4', type: 'video',
      folderName: 'x', rootFolder: '/lib', addedAt: new Date().toISOString(),
      videoCodec: 'h264', audioCodec: 'aac', needsTranscode: false, youtubeId: null,
    };
  }
  saveDatabase({
    folders: ['/lib'], folderSettings: {}, progress: {}, metadata, liked: [],
    deleteTombstones: {},
    settings: { scanIntervalMinutes: 30, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
  });
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

test('GET /api/duplicates: both sections populated via the production extractor, sorted by reclaim', async () => {
  const dbBefore = fs.readFileSync(DB_FILE, 'utf8');
  const res = await fetch(`${base}/api/duplicates`);
  assert.equal(res.status, 200);
  const report = await res.json();

  assert.equal(report.nameGroups.length, 1);
  assert.equal(report.nameGroups[0].key, 'copy me 😳.mp4');
  assert.equal(report.nameGroups[0].wastedBytes, 200);

  assert.equal(report.idGroups.length, 1, 'the [AAAAAAAAAAA] bracket pair matched via the real extractor');
  assert.equal(report.idGroups[0].key, 'AAAAAAAAAAA');
  assert.equal(report.idGroups[0].wastedBytes, 100);

  assert.deepEqual(report.totals, {
    nameGroupCount: 1, nameFileCount: 2, nameWastedBytes: 200,
    idGroupCount: 1, idFileCount: 2, idWastedBytes: 100,
  });
  assert.equal(fs.readFileSync(DB_FILE, 'utf8'), dbBefore, 'read-only: the report never mutates db.json');
});

test('GET /api/duplicates.csv: text/csv attachment with quoted, section-tagged rows', async () => {
  const res = await fetch(`${base}/api/duplicates.csv`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv/);
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="filetube-duplicates.csv"');
  const csv = await res.text();
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '"section","group_key","file_path","size_bytes","group_file_count","group_wasted_bytes"');
  assert.equal(lines.filter((l) => l.startsWith('"same-filename"')).length, 2);
  assert.equal(lines.filter((l) => l.startsWith('"same-videoid"')).length, 2);
  assert.ok(csv.includes('"/dl/chan2/New Title [AAAAAAAAAAA].mp4","100","2","100"'), 'per-file row carries its group context');
});
