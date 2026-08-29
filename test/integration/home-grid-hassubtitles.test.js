'use strict';

// [INTEGRATION] v1.203 (gate, QA): the Modern home grid (`GET /api/home?view=grid`)
// projects items through resolveModernGridItem - an explicit field list that
// did NOT carry `hasSubtitles`, so the Transcript corner rendered EMPTY on
// every home card while the same video showed it on ?root=/search/liked
// (the v1.85 #4 field-completeness class). Binds: a captioned item carries
// `hasSubtitles: true` in the grid payload; an uncaptioned one carries no key.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-home-grid-subs-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

test('GET /api/home?view=grid carries hasSubtitles: true for a captioned item and no key otherwise', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-home-grid-lib-'));
  const mk = (n) => { const p = path.join(root, `${n}.mp4`); fs.writeFileSync(p, 'x'); return p; };
  saveDatabase({
    folders: [root], folderSettings: {}, progress: {}, liked: [],
    settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30 },
    metadata: {
      cap: { id: 'cap', title: 'Captioned', type: 'video', ext: '.mp4', filePath: mk('a'), folderName: path.basename(root), rootFolder: root, size: 1, addedAt: 2, duration: 10, hasSubtitles: true },
      plain: { id: 'plain', title: 'Plain', type: 'video', ext: '.mp4', filePath: mk('b'), folderName: path.basename(root), rootFolder: root, size: 1, addedAt: 1, duration: 10 },
    },
  });
  const res = await fetch(`${base}/api/home?view=grid`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const byId = Object.fromEntries((body.items || []).map((it) => [it.id, it]));
  assert.ok(byId.cap && byId.plain, `both items in the grid (got ${Object.keys(byId)})`);
  assert.strictEqual(byId.cap.hasSubtitles, true, 'the captioned item carries the flag the Transcript corner needs');
  assert.ok(!('hasSubtitles' in byId.plain), 'an uncaptioned item carries no key (the corner stays absent)');
});
