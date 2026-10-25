'use strict';

// [UNIT] v1.395.0 Pages (plan P1, D-UI): lib/pages/shell.js renders /pages from the History shell
// (the lib/feed/shell.js precedent), and the route joins every hand-maintained SPA list
// (deriveRouteView, activeNavItem, SIDEBAR_HREF_BY_NAV_KEY, VIEW_SCRIPT_SRC, the always-on sidebar
// entry + its Playlists-sheet mirror, the bottom-bar roster - opt-in - and its label), and every
// shell carries the default-hidden bar item - the inert-sibling-list net.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { renderPagesShell } = require('../../lib/pages/shell');
const common = require('../../public/js/common.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HISTORY = read('public/history.html');

test('renderPagesShell swaps the view root, the title and the view script; the rest of the shell is byte-identical', () => {
  const out = renderPagesShell(HISTORY);
  assert.ok(out.includes('<div id="view-root" data-view="pages">'));
  assert.ok(!out.includes('data-view="history"'));
  assert.strictEqual((out.match(/id="view-root"/g) || []).length, 1, 'one view root');
  assert.ok(out.includes('<title>Pages - FileTube</title>'));
  assert.ok(out.includes('<script src="/js/pages.js"></script>') && !out.includes('/js/history.js'));
  for (const id of ['pages-library', 'pages-add-btn', 'pages-search', 'pages-views', 'pages-trash-note', 'pages-list', 'pages-empty', 'pages-loadmore', 'pages-item']) {
    assert.ok(out.includes(`id="${id}"`), id);
  }
  const before = (s) => s.slice(0, s.indexOf('<div id="view-root"'));
  const after = (s) => s.slice(s.indexOf('</main>'));
  assert.strictEqual(before(out).replace('<title>Pages - FileTube</title>', '<title>History - FileTube</title>'), before(HISTORY));
  assert.strictEqual(after(out).replace('<script src="/js/pages.js"></script>', '<script src="/js/history.js"></script>'), after(HISTORY));
  assert.throws(() => renderPagesShell('<html><body></body></html>'), /no #view-root/);
});

test('the SPA tables carry the route; Pages is always on (P1), its bar item opt-in', () => {
  assert.strictEqual(common.deriveRouteView('/pages'), 'pages');
  assert.strictEqual(common.activeNavItem('/pages', ''), 'pages');
  assert.strictEqual(common.activeNavItem('/pages', '?id=0123456789ab'), 'pages', 'an item keeps the entry lit');
  assert.strictEqual(common.SIDEBAR_HREF_BY_NAV_KEY.pages, '/pages');
  assert.ok(common.BOTTOM_NAV_OPTIONAL.includes('pages'));
  assert.ok(common.BOTTOM_NAV_DEFAULT_HIDDEN.includes('pages'), 'hidden by default (P1)');
  const src = read('public/js/common.js');
  assert.match(src, /pages: '\/js\/pages\.js'/, 'VIEW_SCRIPT_SRC lazy-loads the view');
  assert.match(src, /injectLibraryNavEntry\('pages', '\/pages', 'Pages', 'icon-pages'\)/);
  assert.match(src, /\n {2}injectPagesNavLink\(\); \/\/ v1\.395\.0 Pages\n/, 'booted beside the other injectors');
  const fnStart = src.indexOf('function injectPagesNavLink()');
  const fnBody = src.slice(fnStart, src.indexOf('\n}\n', fnStart));
  assert.ok(!/fetch\(|ytdlp|mediaFetch/.test(fnBody), 'not gated by any probe or by yt-dlp');
  assert.match(src, /data-nav-sidebar="pages"[^\n]*\n[^\n]*href="\/pages" class="sidebar-item"><i class="' \+ mirroredGlyph\('pages', 'icon-pages'\)/, 'the Playlists sheet mirrors the entry');
  assert.match(read('public/js/setup.js'), /pages: 'Pages'/, 'the customizer labels it');
  assert.ok(fs.existsSync(path.join(ROOT, 'public/assets/icons/article.svg')));
  const css = read('public/css/style.css');
  assert.match(css, /\.icon-pages \{ -webkit-mask-image: url\(\/assets\/icons\/article\.svg\); mask-image: url\(\/assets\/icons\/article\.svg\); \}/);
  assert.strictEqual((css.match(/\.icon-pages\b/g) || []).length, 3, 'the rule plus the two mask lists');
});

test('every shell carries the Pages bottom-bar item right after Books, hidden in markup, with the registry glyph', () => {
  const shells = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html')).map((f) => 'public/' + f).filter((f) => read(f).includes('id="bottom-nav"'));
  shells.push('lib/ytdlp/views/subscriptions.html');
  assert.ok(shells.length >= 11, `found ${shells.length} bottom-nav shells`);
  for (const shell of shells) {
    const html = read(shell);
    const books = html.indexOf('data-nav="books"');
    const pages = html.indexOf('data-nav="pages"');
    assert.ok(pages > books && books > 0, `${shell}: the Pages item follows Books`);
    assert.ok(!/data-nav="/.test(html.slice(books + 1, pages)), `${shell}: nothing between Books and Pages`);
    assert.ok(/<a href="\/pages" class="ui-btn ui-btn--plain ui-btn--md ui-btn--stack bottom-nav-item" data-nav="pages" hidden>/.test(html), `${shell}: hidden in markup`);
    assert.ok(html.includes('#i-article'), `${shell}: the glyph`);
  }
  const { NAMES, FILL } = require('../../tools/icons/names.js');
  assert.ok(NAMES.includes('article') && FILL.includes('article'), 'the glyph and its filled twin are in the registry');
});

test('server.js serves /pages through the shell transform', () => {
  const s = read('server.js');
  assert.match(s, /if \(req\.path === '\/pages'\) \{\n {4}if \(!sendShellHtml\(res, path\.join\(__dirname, 'public', 'history\.html'\), pagesShell\.renderPagesShell\)\) return next\(\);/);
});
