'use strict';

// v1.340 (tech-debt #114): the Subscriptions page (lib/ytdlp/views/subscriptions.html, the one
// shell the optional yt-dlp module serves) carried a bottom bar from before Liked, Podcasts,
// Music, Books and Downloads existed, still on the old decode-lagging `.icon-*` masks - so a
// phone on that page lost one-tap access to them. Its bar is now the other shells' bar byte for
// byte (plus its own note about the injected Subscriptions entry); this binds it so a later
// roster change to the nine public shells cannot leave it behind again.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const NAV = / {2}<nav class="bottom-nav" id="bottom-nav".*?<\/nav>/s;
const COMMENT = /\n {4}<!-- Same as the sidebar above: the "Subscriptions" bottom-nav item is\n {9}injected by common\.js's capability probe, not hardcoded here\. -->/;

function navOf(rel) {
  const m = NAV.exec(fs.readFileSync(path.join(REPO, rel), 'utf8'));
  assert.ok(m, `${rel} has a bottom nav`);
  return m[0];
}

test('the Subscriptions page bottom bar is the home shell\'s bar (same items, same inline glyphs)', () => {
  const home = navOf('public/index.html');
  const subs = navOf('lib/ytdlp/views/subscriptions.html');
  assert.match(subs, COMMENT, 'keeps its note that the Subscriptions entry is injected');
  assert.strictEqual(subs.replace(COMMENT, ''), home);
});

test('...and it carries every roster entry, none on a CSS mask', () => {
  const subs = navOf('lib/ytdlp/views/subscriptions.html');
  const ids = [...subs.matchAll(/data-nav="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(ids, ['home', 'liked', 'playlists', 'history', 'podcasts', 'music', 'books', 'downloads', 'theme', 'settings']);
  assert.doesNotMatch(subs, /<i class="icon-/, 'no mask glyphs (they pop in late on iOS)');
});
