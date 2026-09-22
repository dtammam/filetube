'use strict';

// Guard: the standalone /diag page (public/diag.html) keeps a way OUT and
// its icons.
//
// WHY THIS EXISTS: Settings > Experimental opens /diag in a NEW TAB
// (target="_blank"), and diag.html is not an app shell - no header, no nav.
// In the installed iOS PWA there is no browser chrome either, so before this
// guard the page was a dead end: nothing on it led back into the app (Dean,
// 2026-09-22). The back link deep-links /setup.html#experimental, which the
// setup page's #<collapse-key> hash handler (common.js selectFromHash, v1.305)
// opens directly. The page also carried no icon links, so its tab had no
// favicon (the one page the 2026-09-22 roadmap reconcile found without one).
//
// Comments are stripped ONCE at read so a commented-out link cannot satisfy
// the locks.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'diag.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '');

test('diag.html: a visible back link leads to the Experimental settings section', () => {
  const m = html.match(/<a\b[^>]*\bid="diag-back"[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(m, 'diag.html has no #diag-back link - the page is a dead end in the PWA');
  const tag = m[0];
  assert.match(tag, /\bhref="\/setup\.html#experimental"/,
    'the back link must deep-link the Experimental section');
  assert.doesNotMatch(tag, /\btarget=/, 'the back link must navigate this tab, not open another');
  assert.doesNotMatch(tag, /\bhidden\b/, 'the back link must be visible');
  assert.match(m[1], /Back/, 'the back link must say where it goes');
});

test('diag.html: the back link sits above the page heading (reachable without scrolling)', () => {
  const back = html.indexOf('id="diag-back"');
  const h1 = html.indexOf('<h1>');
  assert.ok(back !== -1 && h1 !== -1 && back < h1, 'the back link must come before the <h1>');
});

test('the #experimental deep-link target exists on the setup page', () => {
  const setup = fs.readFileSync(path.join(PUBLIC, 'setup.html'), 'utf8');
  assert.match(setup, /data-collapse-key="experimental"/,
    'setup.html lost its experimental section - the diag back link would land at the top of Settings');
});

test('diag.html: links the favicon set (svg, png, and the multi-res .ico)', () => {
  const icons = html.match(/<link\b[^>]*\brel="(?:icon|apple-touch-icon)"[^>]*>/g) || [];
  const hrefs = icons.map((t) => (t.match(/\bhref="([^"]+)"/) || [])[1]);
  for (const want of ['/favicon.svg', '/favicon.ico', '/icons/icon-192.png', '/icons/apple-touch-icon.png']) {
    assert.ok(hrefs.includes(want), 'diag.html is missing the icon link for ' + want);
    assert.ok(fs.existsSync(path.join(PUBLIC, want)), want + ' does not exist in public/');
  }
});
