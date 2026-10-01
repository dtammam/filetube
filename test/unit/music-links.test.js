'use strict';

// [UNIT] v1.352 L3: music links. The pure intent table (each link shape, junk, precedence of the older
// `play=` contract), the link builder's round trip, the album key rebuilt exactly like the server's,
// the drill's Copy link pill, and the init wiring (read once, mode stripped, after the play branches).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../../public/js/music.js');
const store = require('../../lib/music/store.js');

const REPO = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(REPO, 'public', 'js', 'music.js'), 'utf8');
const I = (q) => M.musicLinkIntent(q);

test('musicLinkIntent: every link shape', () => {
  assert.deepStrictEqual(I('?artist=Queen'), { open: { type: 'artist', artist: 'Queen' }, mode: null });
  assert.deepStrictEqual(I('?artist=Queen&album=Jazz'), { open: { type: 'album', artist: 'Queen', album: 'Jazz' }, mode: null });
  assert.deepStrictEqual(I('?playlist=liked'), { open: { type: 'playlist', key: 'liked' }, mode: null });
  assert.deepStrictEqual(I('?playlist=recent-played&mode=play'), { open: { type: 'playlist', key: 'recent-played' }, mode: 'play' });
  assert.deepStrictEqual(I('?playlist=recent-added&mode=shuffle'), { open: { type: 'playlist', key: 'recent-added' }, mode: 'shuffle' });
  assert.deepStrictEqual(I('?artist=AC%2FDC&album=Back%20in%20Black&mode=shuffle'), { open: { type: 'album', artist: 'AC/DC', album: 'Back in Black' }, mode: 'shuffle' });
  assert.deepStrictEqual(I('?mode=shuffle'), { open: null, mode: 'shuffle' }, 'Shuffle Songs: the whole library');
  assert.deepStrictEqual(I('?remote=on&playlist=liked&mode=shuffle').open, { type: 'playlist', key: 'liked' }, 'beside the speaker bookmark');
});

test('musicLinkIntent: junk does nothing, and a link that names something it cannot use never shuffles everything', () => {
  for (const q of ['', '?', '?mode=play', '?mode=Shuffle', '?mode=1', '?nowplaying=1', '?artist=', '?artist=%20', '?album=Jazz',
    '?album=Jazz&mode=shuffle', '?playlist=nope', '?playlist=nope&mode=shuffle', '?playlist=LIKED', '?artist=Queen&album=',
    '?artist=Queen&album=&mode=shuffle', '?artist=a%E2%90%9Fb', '?artist=a%00b&mode=shuffle', '?artist=Queen&playlist=liked&album=']) {
    assert.strictEqual(I(q), null, q);
  }
  assert.deepStrictEqual(I('?artist=Queen&mode=loud'), { open: { type: 'artist', artist: 'Queen' }, mode: null }, 'an unknown mode is ignored');
});

test('musicLinkIntent: play=<trackId> (the older contract) wins over everything', () => {
  assert.strictEqual(I('?play=t1&artist=Queen&album=Jazz&mode=shuffle'), null);
  assert.strictEqual(I('?play=t1&mode=shuffle'), null);
  assert.strictEqual(I('?play=t1&listen=1&playlist=liked&mode=play'), null);
  assert.ok(I('?play=&mode=shuffle'), 'an empty play is not a play');
});

test('musicLinkFor round-trips through musicLinkIntent for every shape', () => {
  const intents = [
    { open: { type: 'artist', artist: 'Sigur Rós' }, mode: null },
    { open: { type: 'album', artist: 'AC/DC', album: 'High & Dry? #1' }, mode: 'play' },
    { open: { type: 'playlist', key: 'liked' }, mode: 'shuffle' },
    { open: { type: 'playlist', key: 'recent-added' }, mode: null },
    { open: null, mode: 'shuffle' },
  ];
  for (const it of intents) {
    const url = M.musicLinkFor(it);
    assert.match(url, /^\/music\?/);
    assert.deepStrictEqual(M.musicLinkIntent(url.slice('/music'.length)), it, url);
  }
  assert.strictEqual(M.musicLinkFor({ open: { type: 'playlist', key: 'nope' }, mode: 'shuffle' }), '');
  assert.strictEqual(M.musicLinkFor(null), '');
});

test('the album key is rebuilt exactly like the server builds it (lib/music/store.js albumKeyFor)', () => {
  assert.strictEqual(M.musicAlbumKeyFor('Queen', 'Jazz'), store.albumKeyFor({ artist: 'Queen', album: 'Jazz' }));
  assert.strictEqual(M.musicAlbumKeyFor('Queen', 'Jazz'), store.albumKeyFor({ albumArtist: 'Queen', artist: 'Freddie', album: 'Jazz' }));
});

test('musicDrillLink: artist and album drills get a link; a key that is not artist + album gets none', () => {
  const key = store.albumKeyFor({ artist: 'Queen', album: 'Jazz' });
  assert.strictEqual(M.musicDrillLink({ type: 'album', key }), '/music?artist=Queen&album=Jazz');
  assert.strictEqual(M.musicDrillLink({ type: 'artist', key: 'Queen' }), '/music?artist=Queen');
  assert.strictEqual(M.musicDrillLink({ type: 'album', key: 'video-id-only' }), '', 'a listen album keyed by a video id');
  assert.strictEqual(M.musicDrillLink({ type: 'album', key: M.MUSIC_ALBUM_KEY_SEP + 'Untitled' }), '', 'no artist');
  assert.strictEqual(M.musicDrillLink(null), '');
});

test('the drill header carries a Copy link pill with the escaped link, and none when there is no link', () => {
  const key = store.albumKeyFor({ artist: 'A "B" <c>', album: 'X & Y' });
  const html = M.buildDrillHeaderHtml({ type: 'album', key, label: 'X & Y' }, [{ id: 't1', artist: 'A "B" <c>' }]);
  const m = /<button type="button" class="ui-btn ui-btn--tonal ui-btn--sm ui-btn--pill music-drill-copylink" data-link="([^"]*)">[\s\S]*?Copy link<\/span><\/button>/.exec(html);
  assert.ok(m, 'the pill');
  assert.strictEqual(m[1].replace(/&amp;/g, '&'), M.musicDrillLink({ type: 'album', key }), 'the attribute holds the link, escaped');
  assert.ok(!/<c>/.test(m[1]));
  assert.match(m[1], /&amp;album=/, 'the attribute is HTML-escaped (the & between params included)');
  assert.match(M.buildDrillHeaderHtml({ type: 'artist', key: 'Queen', label: 'Queen' }, []), /music-drill-copylink" data-link="\/music\?artist=Queen"/);
  assert.doesNotMatch(M.buildDrillHeaderHtml({ type: 'album', key: 'vid1', label: 'Talk' }, []), /music-drill-copylink/);
});

test('init reads the link once, strips mode, and acts only after the play branches (play wins)', () => {
  assert.match(SRC, /var linkIntent = musicLinkIntent\(window\.location\.search\);\s*stripMusicParam\('mode'\);/);
  const play = SRC.indexOf('} else if (playParam) {');
  const link = SRC.indexOf('} else if (linkIntent) {');
  const np = SRC.indexOf('} else if (wantNowPlaying && isListenChapterActive()) {');
  assert.ok(play > 0 && link > play && np > link, 'the link branch sits after both play branches');
  assert.match(SRC.slice(link, np), /return applyMusicLink\(linkIntent\);/);
  assert.strictEqual((SRC.match(/applyMusicLink\(/g) || []).length, 2, 'one definition, one call: the link acts from that branch only');
  const click = SRC.slice(SRC.indexOf("var copyLink = e.target.closest('.music-drill-copylink');"));
  assert.match(click.slice(0, 500), /copyTextToClipboard\(window\.location\.origin \+ linkPath\)/);
});
