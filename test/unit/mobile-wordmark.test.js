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
// The ytdlp subscriptions shell lives outside public/ but is the FOURTH shell
// and must obey the same four-shell parity. It was previously NOT covered here,
// which let a stale `.mobile-logo` favicon <img> survive on it (an unstyled,
// uncapped SVG that blew the mobile header past the viewport -> iOS fit-to-width
// zoom, the "subs page is always more zoomed out" bug). v1.24.6 removed it and
// added this shell to every check below so it can never regress.
const SUBS_SHELL = path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html');
const ALL_SHELLS = [...PAGES.map((p) => path.join(PUB, p)), SUBS_SHELL];

test('mobile wordmark: all four shells (index/setup/watch + ytdlp subscriptions) render the desktop FileTube wordmark markup', () => {
  for (const shell of ALL_SHELLS) {
    const html = fs.readFileSync(shell, 'utf8');
    assert.ok(html.includes(WORDMARK), `${path.basename(shell)} is missing the FileTube wordmark markup`);
  }
});

test('mobile wordmark: no shell carries a separate .mobile-logo brand element (favicon-icon swap removed -- all four shells, incl. ytdlp subscriptions)', () => {
  for (const shell of ALL_SHELLS) {
    const html = fs.readFileSync(shell, 'utf8');
    assert.ok(!html.includes('mobile-logo'), `${path.basename(shell)} still references a separate mobile-logo element`);
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
