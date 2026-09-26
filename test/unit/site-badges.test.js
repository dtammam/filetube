'use strict';

// [UNIT] v1.338 D7 (Dean: "There was an icon from this source"; plan
// docs/exec-plans/active/2026-09-26-first-class-any-site.md, his pick: style A, the brand disc). A download
// from another site with no uploader photo shows its SOURCE site's badge as its avatar.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../../lib/ytdlp/store');

const DIR = path.join(__dirname, '..', '..', 'public', 'assets', 'sites');
const STORE_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'store.js'), 'utf8');

test('siteBadgeAvatarUrl: yt-dlp extractor keys map by prefix, case-insensitive; YouTube and unknown sites get none', () => {
  const cases = {
    Reddit: 'reddit', Facebook: 'facebook', FacebookReel: 'facebook', Instagram: 'instagram', InstagramStory: 'instagram',
    TikTok: 'tiktok', TikTokVM: 'tiktok', Twitter: 'x', TwitterBroadcast: 'x', Vimeo: 'vimeo', TwitchVod: 'twitch',
    TwitchClips: 'twitch', Dailymotion: 'dailymotion', Soundcloud: 'soundcloud', Bandcamp: 'bandcamp',
    BiliBili: 'bilibili', BilibiliAudio: 'bilibili', Rumble: 'rumble', reddit: 'reddit',
  };
  for (const [key, slug] of Object.entries(cases)) {
    assert.strictEqual(store.siteBadgeAvatarUrl({ sourceExtractor: key }), `/assets/sites/${slug}.svg`, key);
  }
  for (const none of ['Youtube', 'youtube', 'Generic', 'Peertube', '', undefined, 42]) {
    assert.strictEqual(store.siteBadgeAvatarUrl({ sourceExtractor: none }), null, String(none));
  }
  assert.strictEqual(store.siteBadgeAvatarUrl(null), null);
});

test('resolveItemChannelAvatarUrl: the badge is the fallback ONLY for an item with no channel identity', () => {
  assert.strictEqual(store.resolveItemChannelAvatarUrl({}, { sourceExtractor: 'Reddit' }), '/assets/sites/reddit.svg');
  assert.strictEqual(store.resolveItemChannelAvatarUrl({}, {}), null, 'a plain file keeps the letter avatar');
  assert.strictEqual(store.resolveItemChannelAvatarUrl({}, { sourceExtractor: 'Reddit', channelAvatarUrl: 'https://i.example/a.jpg' }),
    'https://i.example/a.jpg', 'a real captured photo wins');
});

test('census: every mapped slug has its file and every file is mapped (no inert entry, no orphan)', () => {
  const table = /const SITE_BADGES = \[([\s\S]*?)\];/.exec(STORE_SRC);
  assert.ok(table, 'the table exists');
  const slugs = [...table[1].matchAll(/\['[a-z]+', '([a-z]+)'\]/g)].map((m) => m[1]);
  assert.ok(slugs.length >= 12, `${slugs.length} slugs`);
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.svg')).map((f) => f.replace(/\.svg$/, ''));
  assert.deepStrictEqual([...new Set(slugs)].sort(), files.sort());
});

test('every badge is a 48x48 brand disc with a white mark; near-black discs carry the dark-mode ring', () => {
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.svg'))) {
    const svg = fs.readFileSync(path.join(DIR, f), 'utf8');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 48 48" role="img" aria-label="[^"]+">/, f);
    const fill = /<circle cx="24" cy="24" r="24" fill="#([0-9a-fA-F]{6})"\/>/.exec(svg);
    assert.ok(fill, `${f}: the disc`);
    assert.match(svg, /<path transform="translate\(12 12\)" fill="#ffffff" d="[^"]+"\/>/, `${f}: the white mark`);
    assert.doesNotMatch(svg, /<script|on[a-z]+=|href=/i, `${f}: no script, handler or link inside`);
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(fill[1].slice(i, i + 2), 16) / 255);
    const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.1;
    assert.strictEqual(/stroke-opacity="0\.22"/.test(svg), dark, `${f}: the ring exactly on near-black discs`);
  }
});
