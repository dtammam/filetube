'use strict';

// [UNIT] v1.69.0 (podcasts): the hand-rolled RSS extractor
// (lib/podcasts/feed.js), driven by (a) a token-REDACTED 5-item fixture cut
// from Dean's real Patreon feed (test/helpers/patreon-feed-fixture.xml -
// single-line XML, CDATA-free, itunes namespace) and (b) hostile inputs from
// the exec plan's attack surface 4. The parser must truncate/skip/degrade -
// never throw, never expand an entity.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const feed = require('../../lib/podcasts/feed');

const FIXTURE = fs.readFileSync(path.join(__dirname, '..', 'helpers', 'patreon-feed-fixture.xml'), 'utf8');

test('real Patreon fixture: channel header + all 5 items with every field', () => {
  const r = feed.parsePodcastFeed(FIXTURE);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.channel.title, 'The Tim Dillon Show Bonus Feed');
  assert.strictEqual(r.channel.author, 'Tim Dillon');
  assert.ok(r.channel.description.startsWith('Tim Dillon is a comedian'), r.channel.description);
  assert.ok(r.channel.imageUrl.startsWith('https://c10.patreonusercontent.com/'), 'channel itunes:image href extracted');

  assert.strictEqual(r.items.length, 5);
  assert.strictEqual(r.skippedNoAudio, 0);
  assert.strictEqual(r.truncatedItems, false);

  const first = r.items[0];
  assert.strictEqual(first.title, 'Bonus #342 - Human Shields In The Hamptons (ft. Ray Kump)');
  assert.strictEqual(first.guid, '165557309', 'guid is the numeric post id');
  assert.strictEqual(first.durationSec, 4357);
  assert.strictEqual(first.enclosureBytes, 104573337);
  assert.strictEqual(first.enclosureType, 'audio/mpeg');
  assert.ok(first.enclosureUrl.endsWith('165557309.mp3?sig=REDACTED'), `enclosure url extracted + entity-decoded: ${first.enclosureUrl}`);
  assert.ok(!first.enclosureUrl.includes('&amp;'), 'no double-encoded ampersands survive');
  assert.strictEqual(new Date(first.pubDateMs).toUTCString(), 'Sun, 02 Aug 2026 15:31:12 GMT');
  assert.ok(first.description.includes('Ray Kump'), 'description entity-decoded');
  assert.ok(!first.description.includes('<'), `html stripped from description: ${first.description}`);
  assert.ok(first.link.includes('/posts/bonus-342-human-165557309'));

  for (const it of r.items) {
    assert.ok(it.guid !== '', 'every item has an identity');
    assert.ok(Number.isFinite(it.pubDateMs), 'every item has a parsed date');
  }
});

test('DOCTYPE with entity definitions: skipped opaquely, entities NEVER expand', () => {
  const bomb = '<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY a "AAAA"><!ENTITY b "&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;">]>'
    + '<rss><channel><title>T &c; &a;</title><item><title>Ep &b;</title><guid>g1</guid>'
    + '<enclosure url="https://x.example/e.mp3" type="audio/mpeg"/></item></channel></rss>';
  const r = feed.parsePodcastFeed(bomb);
  assert.strictEqual(r.ok, true);
  assert.ok(!r.channel.title.includes('AAAA'), 'custom entity did not expand');
  assert.ok(r.channel.title.includes('&c;') || r.channel.title.includes('c;'), `custom entity survives as literal text: ${r.channel.title}`);
  assert.strictEqual(r.items.length, 1);
  assert.ok(!r.items[0].title.includes('AAAA'));
});

test('XXE-shaped input: external entity declarations are inert text', () => {
  const xxe = '<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
    + '<rss><channel><title>&xxe;</title></channel></rss>';
  const r = feed.parsePodcastFeed(xxe);
  assert.strictEqual(r.ok, true);
  assert.ok(!r.channel.title.includes('root:'), 'no file content, obviously');
  assert.ok(r.channel.title === '&xxe;' || r.channel.title === '', `undeclared entity stays literal: '${r.channel.title}'`);
});

test('CDATA titles/descriptions unwrap without entity-decoding their content', () => {
  const xml = '<rss><channel><title><![CDATA[Show & <b>Bold</b> &amp; literal]]></title>'
    + '<item><title><![CDATA[Ep <1>]]></title><guid>g</guid><description><![CDATA[Has &amp; raw]]></description>'
    + '<enclosure url="https://x.example/e.mp3" type="audio/mpeg"/></item></channel></rss>';
  const r = feed.parsePodcastFeed(xml);
  assert.strictEqual(r.ok, true);
  assert.ok(r.channel.title.includes('Show &'), `CDATA is literal: ${r.channel.title}`);
  assert.ok(r.channel.title.includes('&amp; literal'), 'CDATA content is NOT entity-decoded');
  assert.strictEqual(r.items[0].title, 'Ep <1>');
  assert.strictEqual(r.items[0].description, 'Has &amp; raw');
});

test('items without an audio enclosure are skipped and counted, never invented', () => {
  const xml = '<rss><channel><title>Mixed</title>'
    + '<item><title>Video</title><guid>v1</guid><enclosure url="https://x.example/v.mp4" type="video/mp4"/></item>'
    + '<item><title>NoEnc</title><guid>n1</guid></item>'
    + '<item><title>Audio</title><guid>a1</guid><enclosure url="https://x.example/a.mp3" type="audio/mpeg"/></item>'
    + '<item><title>OctetAudio</title><guid>o1</guid><enclosure url="https://x.example/o.m4a" type="application/octet-stream"/></item>'
    + '</channel></rss>';
  const r = feed.parsePodcastFeed(xml);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.items.map((i) => i.guid), ['a1', 'o1']);
  assert.strictEqual(r.skippedNoAudio, 2);
});

test('caps: oversized doc rejected; item flood truncated with the flag set; long fields truncated', () => {
  assert.strictEqual(feed.parsePodcastFeed('x'.repeat(feed.MAX_FEED_BYTES + 1)).ok, false);

  const many = [];
  for (let i = 0; i < feed.MAX_ITEMS + 50; i++) {
    many.push(`<item><title>E${i}</title><guid>g${i}</guid><enclosure url="https://x.example/${i}.mp3" type="audio/mpeg"/></item>`);
  }
  const flood = `<rss><channel><title>Flood</title>${many.join('')}</channel></rss>`;
  const r = feed.parsePodcastFeed(flood);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.items.length, feed.MAX_ITEMS);
  assert.strictEqual(r.truncatedItems, true, 'silent truncation is forbidden - the flag reports it');

  const longTitle = `<rss><channel><title>t</title><item><title>${'T'.repeat(5000)}</title><guid>g</guid><enclosure url="https://x.example/e.mp3" type="audio/mpeg"/></item></channel></rss>`;
  const r2 = feed.parsePodcastFeed(longTitle);
  assert.strictEqual(r2.items[0].title.length, 2048);
});

test('malformed input degrades to ok:false or partial data - never throws', () => {
  const cases = [
    null, undefined, 42, '', '   ',
    'not xml at all',
    '<rss><channel><title>Unterminated',
    '<rss><channel><item><title>No close',
    '<!DOCTYPE rss [unterminated subset',
    '<rss>\x00\x01\x02<channel><title>ctrl</title></channel></rss>',
  ];
  for (const input of cases) {
    let r;
    assert.doesNotThrow(() => { r = feed.parsePodcastFeed(input); }, `must not throw on: ${String(input).slice(0, 30)}`);
    assert.ok(r && typeof r.ok === 'boolean');
  }
});

test('guid-less items fall back to the enclosure URL as identity', () => {
  const xml = '<rss><channel><title>t</title><item><title>NoGuid</title><enclosure url="https://x.example/only.mp3" type="audio/mpeg"/></item></channel></rss>';
  const r = feed.parsePodcastFeed(xml);
  assert.strictEqual(r.items[0].guid, 'https://x.example/only.mp3');
});

test('duration + pubDate parsing shapes', () => {
  assert.strictEqual(feed.parseDuration('4357'), 4357);
  assert.strictEqual(feed.parseDuration('1:02:03'), 3723);
  assert.strictEqual(feed.parseDuration('62:03'), 3723, 'MM:SS with overflow minutes');
  assert.strictEqual(feed.parseDuration('nonsense'), null);
  assert.strictEqual(feed.parseDuration(''), null);
  assert.strictEqual(feed.parsePubDate('Sun, 02 Aug 2026 15:31:12 GMT'), Date.UTC(2026, 7, 2, 15, 31, 12));
  assert.strictEqual(feed.parsePubDate('never'), null);
});

test('comments are stripped; an item hidden in a comment does not exist', () => {
  const xml = '<rss><channel><title>t</title><!-- <item><title>Ghost</title><guid>g0</guid><enclosure url="https://x.example/g.mp3" type="audio/mpeg"/></item> -->'
    + '<item><title>Real</title><guid>g1</guid><enclosure url="https://x.example/r.mp3" type="audio/mpeg"/></item></channel></rss>';
  const r = feed.parsePodcastFeed(xml);
  assert.deepStrictEqual(r.items.map((i) => i.guid), ['g1']);
});
