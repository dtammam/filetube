'use strict';

// [UNIT] v1.41.17 (Dean): the pre-paint FOUC guards. The header shells are
// STATIC HTML served verbatim by express.static -- there is no server-side
// templating -- so whatever the shell paints first is what the user sees before
// any JS runs. Two things are resolved from localStorage and MUST be stamped
// onto <html> BEFORE first paint, or they flash:
//   1. theme/era/mode/icons  -- else a dark-mode/retro-era user flashes the
//      default light/2021 theme on refresh.
//   2. the custom-logo flag  -- else the "FileTube" text wordmark flashes
//      before applyCustomLogoIfSet swaps the uploaded image in.
//
// The bug that motivated this: read.html and books.html were shipped WITHOUT
// the theme guard the other four shells carried, so they flashed on every
// refresh. These are structural locks (gate S-C correction: the repo DOES
// have a jsdom harness now - star-pref-seed.test.js runs the real common.js
// in jsdom+vm - but pre-paint behavior is exactly what jsdom cannot see, so
// structural locks remain the right instrument here -- see
// CONTRIBUTING.md): every header-bearing shell must carry BOTH guards, and the
// guard must run before <body>. A new shell that forgets one fails here.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
// Every shell that renders the <a class="logo"> header.
const SHELLS = ['index.html', 'watch.html', 'stats.html', 'setup.html', 'read.html', 'books.html'];

function readShell(name) {
  return fs.readFileSync(path.join(PUBLIC, name), 'utf8');
}

for (const shell of SHELLS) {
  test(`${shell}: carries the pre-paint guard BEFORE <body> (no theme/logo FOUC on refresh)`, () => {
    const html = readShell(shell);
    const bodyAt = html.indexOf('<body');
    assert.ok(bodyAt > 0, `${shell} has a <body>`);
    const head = html.slice(0, bodyAt);

    // The header carries the text wordmark that must not flash.
    assert.match(html, /class="logo">File<span class="tube">Tube<\/span>/,
      `${shell} renders the text logo wordmark`);

    // 1. Theme guard: era + mode set on <html> before paint.
    assert.match(head, /setAttribute\('data-theme'/,
      `${shell} must set data-theme before <body> or it flashes the default era`);
    assert.match(head, /setAttribute\('data-mode'/,
      `${shell} must set data-mode before <body> or it flashes light mode`);

    // 2. Logo guard: the ft-custom-logo flag is read and stamped before paint.
    assert.match(head, /localStorage\.getItem\('ft-custom-logo'\)/,
      `${shell} must read the custom-logo flag before <body>`);
    assert.match(head, /classList\.add\('ft-custom-logo'\)/,
      `${shell} must stamp html.ft-custom-logo before <body> so CSS hides the text wordmark pre-paint`);
    // 3. v1.63.1 stars guard (slim gate W-A: the stamp shipped in nine
    // shells with NO lock - removing it from watch.html, the one shell
    // with static star markup, left all 5368 tests green): the
    // hidden-stars flag is read and stamped before paint.
    assert.match(head, /localStorage\.getItem\('ft-star-ratings'\)/,
      `${shell} must read the stars pref before <body>`);
    assert.match(head, /classList\.add\('ft-hide-stars'\)/,
      `${shell} must stamp html.ft-hide-stars before <body> so hidden-pref users never see the stars flash`);
  });
}

test('style.css hides the text wordmark under html.ft-custom-logo, re-showing the image (the pre-paint hide)', () => {
  const css = fs.readFileSync(path.join(PUBLIC, 'css', 'style.css'), 'utf8');
  // visibility (not font-size:0) so the type-scale-token lock stays intact.
  assert.match(css, /\.ft-custom-logo \.logo\s*\{[^}]*visibility:\s*hidden/,
    'the .ft-custom-logo .logo rule must hide the wordmark (text + red pill) so it never paints');
  assert.match(css, /\.ft-custom-logo \.logo \.logo-img\s*\{[^}]*visibility:\s*visible/,
    'the swapped-in image must be re-shown (its parent .logo is visibility:hidden)');
});

// The yt-dlp module's /subscriptions page is a 7th header shell, but its route
// is GATED (a native 404 when the module is off), so server.js's static-shell
// middleware deliberately does NOT hijack it. Instead the route renders through
// the shared sendShellHtml helper (dep-injected) so the custom-logo class is
// baked in server-side -- same zero-flash treatment, no client-flag dependency.
test('subscriptions.html is an injectable shell (carries the theme guard, <html lang>, and style.css)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html'), 'utf8');
  const bodyAt = html.indexOf('<body');
  const head = html.slice(0, bodyAt);
  assert.match(html, /class="logo">File<span class="tube">Tube<\/span>/, 'renders the text wordmark');
  assert.match(head, /setAttribute\('data-theme'/, 'carries the theme guard before <body>');
  assert.match(html, /<html\b[^>]*lang="en"[^>]*>/i, 'has an injectable <html lang="en"> tag');
  assert.match(html, /href="\/css\/style\.css"/, 'links style.css so the .ft-custom-logo rule applies');
});

test('the /subscriptions route renders via the shared sendShellHtml helper (server-side logo injection)', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'index.js'), 'utf8');
  assert.match(idx, /app\.get\('\/subscriptions'[\s\S]{0,800}deps\.sendShellHtml/,
    'the /subscriptions route must call deps.sendShellHtml so the custom-logo class is injected pre-paint');
  const srv = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(srv, /sendShellHtml,/, 'server.js must dep-inject sendShellHtml into the yt-dlp module');
});

test('v1.89: server.js injects ft-custom-logo onto <html> UNCONDITIONALLY (banner is the built-in default, no text flash)', () => {
  const srv = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  assert.match(srv, /function injectCustomLogoClass/, 'the injector exists');
  // v1.89: the header always resolves to an image (bundled default banner, or an
  // upload), so sendShellHtml stamps the class every time -- no longer gated on a
  // customLogoConfigured() check (that function was removed as dead).
  assert.doesNotMatch(srv, /function customLogoConfigured/,
    'the old upload-gate helper is gone -- the class is no longer conditional on an upload');
  assert.match(srv, /\n\s*html = injectCustomLogoClass\(html\);/,
    'sendShellHtml injects the class unconditionally so the text wordmark never paints first');
});

test('v1.89: GET /logo falls back to the bundled default banner when no logo is uploaded', () => {
  const srv = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  // The default-banner helper + its use on the no-upload path.
  assert.match(srv, /function serveDefaultLogo/, 'the default-banner server helper exists');
  assert.match(srv, /function defaultLogoPath/, 'the default-banner path resolver exists');
  // dark -> the white-text banner (legible on a dark header); light -> black-text.
  assert.match(srv, /variant === 'dark' \? 'filetube-banner-white\.png' : 'filetube-banner-black\.png'/,
    'dark mode maps to the white-text banner, light mode to the black-text banner');
  // The no-upload branch serves the default instead of the old bare 404.
  assert.match(srv, /if \(serveDefaultLogo\(res, requested\)\) return;/,
    'the no-upload path serves the bundled default banner before any 404');
});

test('v1.89: both default banner assets are bundled under public/ (so the Docker image ships them)', () => {
  for (const f of ['filetube-banner-black.png', 'filetube-banner-white.png']) {
    const p = path.join(PUBLIC, 'assets', 'brand', f);
    assert.ok(fs.existsSync(p), `${f} must exist under public/assets/brand (public/ is what the Dockerfile copies)`);
    const head = fs.readFileSync(p).subarray(0, 8);
    assert.ok(head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47,
      `${f} must be a real PNG (magic bytes)`);
  }
});

test('common.js is the sole writer of the ft-custom-logo flag and self-heals on 404 / load error', () => {
  const js = fs.readFileSync(path.join(PUBLIC, 'js', 'common.js'), 'utf8');
  // Set when a logo is confirmed present...
  assert.match(js, /localStorage\.setItem\('ft-custom-logo', '1'\)/,
    'common.js sets the flag when /logo HEAD is ok');
  // ...cleared when absent, so a removed logo brings the text back next refresh.
  assert.match(js, /localStorage\.removeItem\('ft-custom-logo'\)/,
    'common.js clears the flag on a 404 (removed logo) and on an image load error');
  assert.match(js, /addEventListener\('error', clearLogoFlag\)/,
    'a confirmed-present but undecodable image restores the text wordmark');
});
