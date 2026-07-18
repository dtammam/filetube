'use strict';

// [UNIT] v1.44.3 cleanup C2 — the reader hides the shell header for a fuller
// reading page. No jsdom in this repo, so these are SOURCE-LOCKs pinning the
// contract (Dean's on-device pass validates the actual layout): the
// `reader-immersive` class is (a) set pre-paint on a direct /read load, (b)
// toggled by read.js init()/destroy() for in-app navigation, and (c) backed by
// CSS that hides the header AND reclaims its top clearance.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const READ_HTML = fs.readFileSync(path.join(__dirname, '../../public/read.html'), 'utf8');
const READ_JS = fs.readFileSync(path.join(__dirname, '../../public/js/read.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');

test('C2: read.html sets reader-immersive pre-paint (no header flash on a direct /read load)', () => {
  // Inside the FOUC <script>, before first paint.
  const head = READ_HTML.slice(0, READ_HTML.indexOf('</head>'));
  assert.match(head, /classList\.add\('reader-immersive'\)/, 'the pre-paint FOUC script adds reader-immersive');
});

test('C2: read.js toggles reader-immersive on init and removes it on destroy', () => {
  const initBody = READ_JS.slice(READ_JS.indexOf('function init('), READ_JS.indexOf('function destroy('));
  const destroyBody = READ_JS.slice(READ_JS.indexOf('function destroy('));
  assert.match(initBody, /classList\.add\('reader-immersive'\)/, 'init() adds the class (for SPA nav into the reader)');
  assert.match(destroyBody, /classList\.remove\('reader-immersive'\)/, 'destroy() removes it so the header returns on nav-away');
  // Must be added BEFORE the reader measures its height, so the reading area is
  // sized against the reclaimed (header-less) viewport. Anchor on the sizeReader
  // DEFINITION (`function sizeReader`), not a bare `sizeReader()` (which also
  // appears in the explanatory comment above the class-add).
  assert.ok(initBody.indexOf("classList.add('reader-immersive')") < initBody.indexOf('function sizeReader'),
    'the class is applied before sizeReader() measures the chassis offset');
});

test('C2: CSS hides the header AND zeroes its top clearance under reader-immersive', () => {
  assert.match(CSS, /html\.reader-immersive header \{ display: none; \}/, 'the shell header is hidden while reading');
  assert.match(CSS, /html\.reader-immersive \.app-container \{ padding-top: 0; \}/, 'the 56px/mobile header clearance is reclaimed');
});
