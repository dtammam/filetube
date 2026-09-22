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
const { JSDOM } = require('jsdom');
const { wireMasterDetail } = require('../../public/js/common.js');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'diag.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '');
// The page's own stylesheet (one inline <style> block), comments stripped.
const css = ((html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('diag.html: a visible back link leads to the Experimental settings section', () => {
  const m = html.match(/<a\b[^>]*\bid="diag-back"[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(m, 'diag.html has no #diag-back link - the page is a dead end in the PWA');
  const tag = m[0];
  assert.match(tag, /\bhref="\/setup\.html#experimental"/,
    'the back link must deep-link the Experimental section');
  assert.doesNotMatch(tag, /\btarget=/, 'the back link must navigate this tab, not open another');
  assert.doesNotMatch(tag, /\bhidden\b/, 'the back link must be visible');
  assert.doesNotMatch(tag, /\bstyle=/, 'no inline style on the back link (it could hide it)');
  assert.match(m[1], /Back/, 'the back link must say where it goes');
});

test('diag.html: the back link sits above the page heading (reachable without scrolling)', () => {
  const back = html.indexOf('id="diag-back"');
  const h1 = html.indexOf('<h1>');
  assert.ok(back !== -1 && h1 !== -1 && back < h1, 'the back link must come before the <h1>');
});

test('diag.html: no stylesheet rule hides the back link', () => {
  // Every rule whose selector list names .back or #diag-back must not take it
  // out of view (display:none / visibility:hidden / opacity:0).
  const rules = css.match(/[^{}]+\{[^}]*\}/g) || [];
  const own = rules.filter((r) => /(?:\.back\b|#diag-back\b)/.test(r.split('{')[0]));
  assert.ok(own.length > 0, 'diag.html styles the back link (.back rule present)');
  for (const r of own) {
    assert.doesNotMatch(r, /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])/,
      'a rule hides the back link: ' + r.trim());
  }
});

test('the back link\'s target really opens the Experimental section (REAL setup.html, full load)', () => {
  // Reachability, not existence: drive the setup page's own master-detail wiring
  // (what its init() runs on a full page load, incl. the v1.305 hash deep-link)
  // on the real markup at the exact URL the diag link points to.
  const href = (html.match(/<a\b[^>]*\bid="diag-back"[^>]*\bhref="([^"]+)"/) ||
    html.match(/<a\b[^>]*\bhref="([^"]+)"[^>]*\bid="diag-back"/) || [])[1];
  assert.ok(href, 'the back link carries an href');
  const setup = fs.readFileSync(path.join(PUBLIC, 'setup.html'), 'utf8');
  const dom = new JSDOM(setup, { url: 'http://localhost' + href });
  global.window = dom.window; global.document = dom.window.document;
  global.MutationObserver = dom.window.MutationObserver; global.localStorage = dom.window.localStorage;
  try {
    const doc = dom.window.document;
    wireMasterDetail('setup', doc, new dom.window.AbortController().signal);
    const active = doc.querySelector('details.md-active');
    assert.ok(active, 'a section is selected after the deep-link');
    assert.strictEqual(active.getAttribute('data-collapse-key'), 'experimental',
      'the back link must land ON the Experimental section, not the default one');
    assert.strictEqual(doc.querySelector('.md-root').getAttribute('data-md-open'), 'true',
      'the detail pane must open (not the collapsed section list)');
  } finally {
    delete global.window; delete global.document; delete global.MutationObserver; delete global.localStorage;
    dom.window.close();
  }
});

test('diag.html: links the favicon set (svg, png, and the multi-res .ico)', () => {
  const icons = html.match(/<link\b[^>]*\brel="(?:icon|apple-touch-icon)"[^>]*>/g) || [];
  const hrefs = icons.map((t) => (t.match(/\bhref="([^"]+)"/) || [])[1]);
  for (const want of ['/favicon.svg', '/favicon.ico', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']) {
    assert.ok(hrefs.includes(want), 'diag.html is missing the icon link for ' + want);
    assert.ok(fs.existsSync(path.join(PUBLIC, want)), want + ' does not exist in public/');
  }
});
