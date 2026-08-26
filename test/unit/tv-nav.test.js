'use strict';

// [UNIT] v1.195 TV Shows nav: the content-gated Library-section injection + the SPA
// router wiring (source-locked, mirroring music-nav).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { shouldInjectTvNav } = require('../../public/js/common.js');

const COMMON = fs.readFileSync(path.join(__dirname, '../../public/js/common.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const TV_HTML = fs.readFileSync(path.join(__dirname, '../../public/tv.html'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');

test('shouldInjectTvNav: gated on folders>0 (Shows-less installs inject nothing)', () => {
  assert.strictEqual(shouldInjectTvNav({ folders: ['/tv'] }), true);
  assert.strictEqual(shouldInjectTvNav({ folders: [] }), false);
  assert.strictEqual(shouldInjectTvNav({}), false);
  assert.strictEqual(shouldInjectTvNav(null), false);
});

test('the injector probes /api/tv/config and injects a "Shows" Library entry', () => {
  const fn = COMMON.slice(COMMON.indexOf('function injectTvNavLinkIfEnabled()'), COMMON.indexOf('function injectTvNavLinkIfEnabled()') + 700);
  assert.match(fn, /fetch\('\/api\/tv\/config'\)/, 'content-gated on the tv config probe');
  assert.match(fn, /if \(!shouldInjectTvNav\(payload\)\) return;/, 'fails closed - Shows-less injects nothing');
  assert.match(fn, /injectLibraryNavEntry\('tv', '\/tv', 'Shows', 'icon-tv'\)/, 'a "Shows" entry with the tv glyph');
  assert.match(COMMON, /\n {2}injectTvNavLinkIfEnabled\(\);/, 'called at boot alongside the other library probes');
});

test('SPA router knows the tv view + script (both path resolvers, VIEW_SCRIPT_SRC)', () => {
  assert.match(COMMON, /tv: '\/js\/tv\.js'/, 'the lazy view script is registered');
  const resolvers = COMMON.match(/if \(pathname === '\/tv' \|\| pathname === '\/tv\.html'\) return 'tv';/g) || [];
  assert.ok(resolvers.length >= 2, 'both viewNameForPath copies resolve /tv -> tv (found ' + resolvers.length + ')');
  assert.match(COMMON, /tv: '\/tv'/, 'the view->path map has tv');
});

test('the server serves the tv shell (route + FOUC map + shell set)', () => {
  assert.match(SERVER, /app\.get\('\/tv'/, 'GET /tv serves the shell');
  assert.match(SERVER, /res\.sendFile\(path\.join\(__dirname, 'public', 'tv\.html'\)\)/);
  assert.match(SERVER, /'tv\.html'/, 'tv.html is in FOUC_SHELL_FILES');
  assert.match(SERVER, /if \(p === '\/tv' \|\| p === '\/tv\.html'\) return 'tv\.html';/, 'the shell-name map resolves /tv');
});

test('Settings has the Shows-folders builder wired to /api/tv/config (mirrors the music box)', () => {
  const SETUP_HTML = fs.readFileSync(path.join(__dirname, '../../public/setup.html'), 'utf8');
  const SETUP_JS = fs.readFileSync(path.join(__dirname, '../../public/js/setup.js'), 'utf8');
  assert.match(SETUP_HTML, /data-collapse-key="tv-folders"[^>]*data-md-group="Library"/, 'a Library-group Shows box');
  for (const id of ['tv-folders-builder-list', 'new-tv-folder-path', 'add-tv-folder-btn', 'save-tv-config-btn', 'scan-tv-btn']) {
    assert.ok(SETUP_HTML.includes('id="' + id + '"'), id + ' present');
  }
  assert.match(SETUP_JS, /fetch\('\/api\/tv\/config', \{\s*method: 'POST'/, 'save posts the Shows folders');
  assert.match(SETUP_JS, /async function loadTvConfig\(\)/);
  assert.match(SETUP_JS, /wireTvFolderControls\(controller\.signal\);/, 'wired at init');
  assert.match(SETUP_JS, /loadTvConfig\(\);/, 'loaded at init');
});

test('the tv shell loads tv.js under a data-view="tv" root, and the tv icon has a mask', () => {
  assert.match(TV_HTML, /data-view="tv"/);
  assert.match(TV_HTML, /<script src="\/js\/tv\.js"><\/script>/);
  assert.match(TV_HTML, /id="tv-content"/, 'the view host tv.js renders into');
  assert.match(CSS, /\.icon-tv \{[^}]*mask-image: url\(\/assets\/icons\/tv\.svg\)/, 'the Shows nav glyph resolves to the tv asset');
});
