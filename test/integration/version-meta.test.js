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

// v1.91.1 (Dean): the footer reads "Version X.Y.Z" and is LEFT-aligned at the
// row inset so it belongs to the left-aligned menu list instead of floating
// centered (which "felt off"). jsdom can't see the visual, so lock it structurally.
test('v1.91.1: the account-menu version footer is labeled and left-aligned to the row inset', () => {
  // Sweep S1 (DELIBERATE lock update, AC12 - the triage's "ui-menu footer row"): the footer
  // is a ui-row in the menu's footer ui-list, so its left alignment and its inset are the SAME
  // ones every menu row has (ui.css .ui-row; the panel's lists share one --row-pad-start).
  const common = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'common.js'), 'utf8');
  assert.match(common, /const ver = U\.row\(\{ size: 'compact', href: notesUrl, title: 'Version ' \+ version,/, 'footer reads "Version X.Y.Z" (not a bare "vX.Y.Z") on a ui-row');
  assert.match(common, /ver\.classList\.add\('account-menu-version'\);/);
  const strip = (x) => x.replace(/\/\*[\s\S]*?\*\//g, '');
  const ui = strip(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'ui.css'), 'utf8'));
  const row = /\n\.ui-row \{[^}]*\}/.exec(ui);
  assert.ok(row && /text-align:\s*left;/.test(row[0]), 'left-aligned like every row (NOT centered)');
  const css = strip(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8'));
  assert.match(css, /\.account-menu-panel > \.ui-list \{\s*--row-pad-start: var\(--inset\);/, 'one inset for the item rows and the footer rows');
  assert.doesNotMatch(css, /\.account-menu-version[^{]*\{[^}]*text-align:\s*center/, 'the old centered treatment is gone');
});
