'use strict';

// [INTEGRATION] v1.90 (Dean): the running app version is stamped into every
// shell's <head> as <meta name="ft-version"> (server.js injectVersionMeta), so
// the client can render "vX.Y.Z" in the account menu footer (which the desktop
// header dropdown AND the mobile "You" tab both open) with zero extra fetch.
// Same isolated DATA_DIR boot harness as custom-logo.test.js.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ver-'));
fs.mkdirSync(path.join(process.env.DATA_DIR, '.thumbnails'), { recursive: true });

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

const EXPECTED = require('../../package.json').version;

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

// Every header-bearing shell served through sendShellHtml must carry the meta.
const SHELL_PATHS = ['/', '/index.html', '/watch.html', '/setup.html', '/history.html', '/login'];

test('v1.90: every shell carries <meta name="ft-version"> with the real package version, inside <head>', async () => {
  for (const p of SHELL_PATHS) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 200, `${p} serves`);
    const html = await res.text();
    const m = /<meta\s+name="ft-version"\s+content="([^"]*)">/i.exec(html);
    assert.ok(m, `${p} must carry the ft-version meta`);
    assert.equal(m[1], EXPECTED, `${p} version meta must equal package.json (${EXPECTED})`);
    // It must sit in the <head> (before <body>), or the client can't read it pre-render.
    const bodyAt = html.indexOf('<body');
    assert.ok(html.indexOf(m[0]) < bodyAt, `${p} version meta must be inside <head>`);
  }
});

test('v1.90: the meta is injected exactly once (idempotent) even if re-served', async () => {
  const html = await (await fetch(`${base}/`)).text();
  const count = (html.match(/name="ft-version"/g) || []).length;
  assert.equal(count, 1, 'exactly one ft-version meta');
});

test('v1.90: the version string is a valid semver-ish X.Y.Z (what appVersionString accepts)', () => {
  assert.match(EXPECTED, /^\d+\.\d+\.\d+/, 'package version is X.Y.Z');
});
