'use strict';

// [UNIT] v1.379.0 Feed mode W3: lib/feed/shell.js renders /feed from the History shell (plan D1:
// the cheaper shell route). Bound: the view root is swapped (not appended), the title and the
// view script are the feed's, everything else of the shell is byte-identical (the header, the
// sidebar, the bottom bar, the player dock and host template, the pre-paint scripts), and the
// SPA tables know the route (deriveRouteView, activeNavItem, SIDEBAR_HREF_BY_NAV_KEY,
// VIEW_SCRIPT_SRC, the bottom-bar roster, both dock mirrors) - the inert-sibling-list net.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { renderFeedShell } = require('../../lib/feed/shell');
const common = require('../../public/js/common.js');
const player = require('../../public/js/player.js');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HISTORY = read('public/history.html');

test('renderFeedShell swaps the view root, the title and the view script; the rest of the shell is byte-identical', () => {
  const out = renderFeedShell(HISTORY);
  assert.ok(out.includes('<div id="view-root" data-view="feed">'));
  assert.ok(!out.includes('data-view="history"'));
  assert.strictEqual((out.match(/id="view-root"/g) || []).length, 1, 'one view root');
  assert.ok(out.includes('<title>Feed - FileTube</title>'));
  assert.ok(out.includes('<script src="/js/feed.js"></script>') && !out.includes('/js/history.js'));
  for (const id of ['feed-picker', 'feed-picker-choices', 'feed-week', 'feed-empty', 'feed-session', 'feed-stack', 'feed-done-btn']) {
    assert.ok(out.includes(`id="${id}"`), id);
  }
  // everything outside the view root is the History shell's own bytes
  const before = (s) => s.slice(0, s.indexOf('<div id="view-root"'));
  const after = (s) => s.slice(s.indexOf('</main>'));
  assert.strictEqual(before(out).replace('<title>Feed - FileTube</title>', '<title>History - FileTube</title>'), before(HISTORY));
  assert.strictEqual(after(out).replace('<script src="/js/feed.js"></script>', '<script src="/js/history.js"></script>'), after(HISTORY));
  assert.ok(out.includes('id="player-dock"') && out.includes('id="player-host-template"') && out.includes('id="bottom-nav"'));
  assert.throws(() => renderFeedShell('<html><body></body></html>'), /no #view-root/);
});

test('the SPA tables carry the route (inert sibling list): deriveRouteView, activeNavItem, the sidebar href, the view script, the roster, both dock mirrors', () => {
  assert.strictEqual(common.deriveRouteView('/feed'), 'feed');
  assert.strictEqual(common.activeNavItem('/feed', ''), 'feed');
  assert.strictEqual(common.SIDEBAR_HREF_BY_NAV_KEY.feed, '/feed');
  assert.ok(common.BOTTOM_NAV_OPTIONAL.includes('feed'), 'in the bottom-bar roster');
  assert.strictEqual(common.BOTTOM_NAV_OPTIONAL.indexOf('feed'), 2, 'right after Liked (which keeps its slot beside Home)');
  assert.ok(!common.BOTTOM_NAV_DEFAULT_HIDDEN.includes('feed'), 'ON by default (plan D1)');
  const src = read('public/js/common.js');
  assert.match(src, /feed: '\/js\/feed\.js'/, 'VIEW_SCRIPT_SRC lazy-loads the view');
  assert.strictEqual(common.shouldDockOnTransition('feed', 'home'), true, 'leaving the feed docks the player');
  assert.strictEqual(common.shouldDockOnTransition('feed', 'feed'), false);
  assert.strictEqual(player.shouldDockOnTransition('feed', 'home'), true, 'the player.js mirror agrees');
  assert.match(read('public/js/setup.js'), /feed: 'Feed'/, 'the customizer labels it');
  // gate r1 (qa W4): the sidebar entry's mask glyph exists - the asset, its rule, and both mask lists
  assert.ok(fs.existsSync(path.join(ROOT, 'public/assets/icons/feed.svg')), 'the mask asset');
  const css = read('public/css/style.css');
  assert.match(css, /\.icon-feed \{ -webkit-mask-image: url\(\/assets\/icons\/feed\.svg\); mask-image: url\(\/assets\/icons\/feed\.svg\); \}/, 'the mask rule');
  assert.strictEqual((css.match(/\.icon-feed\b/g) || []).length, 3, 'the rule plus the two mask lists (size/colour, and the @supports background-color)');
  assert.match(src, /injectLibraryNavEntry\('feed', '\/feed', 'Feed', 'icon-feed'\)/, 'the entry asks for that glyph');
  // gate r1 (qa S6): the phone's Playlists sheet lists Feed (a user who hides the bar item still has a path)
  assert.match(src, /data-nav-sidebar="feed"[^\n]*\n[^\n]*href="\/feed" class="sidebar-item"><i class="' \+ mirroredGlyph\('feed', 'icon-feed'\)/, 'the Playlists sheet mirrors the Feed entry');
});

test('every shell carries the Feed bottom-bar item right after Liked, with the registry glyph', () => {
  const shells = fs.readdirSync(path.join(ROOT, 'public')).filter((f) => f.endsWith('.html')).map((f) => 'public/' + f).filter((f) => read(f).includes('id="bottom-nav"'));
  shells.push('lib/ytdlp/views/subscriptions.html');
  assert.ok(shells.length >= 11, `found ${shells.length} bottom-nav shells`);
  for (const shell of shells) {
    const html = read(shell);
    const liked = html.indexOf('data-nav="liked"');
    const feedIdx = html.indexOf('data-nav="feed"');
    assert.ok(feedIdx > liked && liked > 0, `${shell}: the Feed item follows Liked`);
    const between = html.slice(liked, feedIdx);
    assert.ok(!/data-nav="/.test(between.slice(1)), `${shell}: nothing between Liked and Feed`);
    assert.ok(html.includes('href="/feed"') && html.includes('#i-dynamic_feed'), `${shell}: the link and the glyph`);
    assert.ok(!/data-nav="feed" hidden/.test(html), `${shell}: not hidden in markup (ON by default)`);
  }
});
