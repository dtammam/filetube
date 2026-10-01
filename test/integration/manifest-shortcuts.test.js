'use strict';

// [INTEGRATION] v1.352 L2: the installed app's icon shortcuts (manifest `shortcuts`). Every shortcut
// is same-origin and root-relative, every url is a route the REAL server serves as an in-app page
// (not a 404, not a redirect), and every icon is a real 96x96 PNG. A typo'd url goes red here.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-shortcuts-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');
const { decodeRgbaPng } = require('../../scripts/generate-shortcut-icons');

const REPO = path.join(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'public', 'manifest.webmanifest'), 'utf8'));
let server, base, auth;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  auth = authenticateFetch(server, base);
});
after(async () => { auth.restore(); await new Promise((r) => server.close(r)); });

test('the four shortcuts, in order, each named, same-origin and root-relative', () => {
  assert.deepStrictEqual(manifest.shortcuts.map((s) => [s.name, s.url]), [
    ['Music', '/music'], ['Now Playing', '/music?nowplaying=1'], ['Shuffle Songs', '/music?mode=shuffle'], ['Podcasts', '/podcasts'],
  ]);
  for (const s of manifest.shortcuts) {
    assert.ok(s.short_name && s.short_name.length <= 12, s.name + ' short_name');
    assert.match(s.url, /^\/[^/\\]/, s.name + ' is root-relative');
    assert.strictEqual(new URL(s.url, 'https://filetube.example').origin, 'https://filetube.example');
  }
});

test('every shortcut url is served as an in-app page by the real server (200 html, the view shell)', async () => {
  for (const s of manifest.shortcuts) {
    const r = await fetch(base + s.url, { headers: { Accept: 'text/html' }, redirect: 'manual' });
    assert.strictEqual(r.status, 200, s.url);
    const html = await r.text();
    assert.match(html, /id="view-root"/, s.url + ' is an in-app shell');
  }
});

test('every shortcut icon is a real PNG of the size it states', () => {
  for (const s of manifest.shortcuts) {
    assert.ok(s.icons && s.icons.length, s.name + ' has an icon');
    for (const i of s.icons) {
      assert.strictEqual(i.type, 'image/png');
      const img = decodeRgbaPng(fs.readFileSync(path.join(REPO, 'public', i.src)));
      assert.strictEqual(`${img.width}x${img.height}`, i.sizes, i.src);
      const mid = ((img.height >> 1) * img.width + (img.width >> 1)) * 4 + 3;
      assert.strictEqual(img.rgba[mid], 255, 'not an empty image');
    }
  }
});
