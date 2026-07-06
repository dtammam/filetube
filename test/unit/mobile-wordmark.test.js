'use strict';

// v1.14.0 item 2 -- the mobile top-left brand mark must match desktop: the
// same "FileTube" text wordmark (.logo), not a separate favicon-icon
// (.mobile-logo). Static markup/CSS checks (the visual result is Dean's
// on-device arbiter, per docs/exec-plans/active/2026-07-06-v1.14-quickwins.md).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', '..', 'public');
const PAGES = ['index.html', 'setup.html', 'watch.html'];
const WORDMARK = '<a href="/" class="logo">File<span class="tube">Tube</span></a>';

test('mobile wordmark: index.html, setup.html, and watch.html all render the desktop FileTube wordmark markup', () => {
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(PUB, page), 'utf8');
    assert.ok(html.includes(WORDMARK), `${page} is missing the FileTube wordmark markup`);
  }
});

test('mobile wordmark: no page carries a separate .mobile-logo brand element (favicon-icon swap removed)', () => {
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(PUB, page), 'utf8');
    assert.ok(!html.includes('mobile-logo'), `${page} still references a separate mobile-logo element`);
  }
});

test('mobile wordmark: the browser favicon <link> is unaffected (still present, out of scope)', () => {
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(PUB, page), 'utf8');
    assert.match(html, /<link rel="icon"[^>]*favicon\.svg"/, `${page} is missing its favicon <link>`);
  }
});

test('mobile wordmark: style.css no longer defines an actual .mobile-logo CSS rule (only explanatory prose in comments may still mention it)', () => {
  const css = fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8');
  // A real selector is followed by a `{` (a rule body) or is part of a
  // comma-separated selector list ending in one -- either way, distinct from
  // the word appearing only inside a `/* ... */` comment explaining the change.
  assert.ok(!/\.mobile-logo\s*[,{]/.test(css), '.mobile-logo selector should be fully removed from style.css');
});

test('mobile wordmark: style.css does not hide .logo inside the mobile media query (so it stays visible on mobile)', () => {
  const css = fs.readFileSync(path.join(PUB, 'css', 'style.css'), 'utf8');
  // The pre-v1.14 rule set an ACTUAL `.logo { display: none; }` rule inside
  // the mobile breakpoint. Match only a real rule body (selector + `{` +
  // `display: none` before the next `}`), not the same text appearing in an
  // explanatory `/* ... */` comment.
  assert.ok(!/\.logo\s*\{\s*display:\s*none/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')),
    '.logo must not be display:none anywhere -- it is now the shared mobile+desktop brand mark');
});
