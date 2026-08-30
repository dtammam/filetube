'use strict';

// [UNIT] Wave G - the pure projection layer (lib/music/libraryAudio.js): decide
// which library audio (db.metadata type 'audio') belongs in Music, and shape it
// into a music-track record. Fixtures mirror the LIVE instance data (yt-dlp
// embeds title/artist(=channel)/date/genre, NO album/track/disc). Binds BOTH
// override arms behaviourally (the presence-not-binding scar) and proves the
// projected records group by channel through the REAL query pipeline.

const { test } = require('node:test');
const assert = require('node:assert');

const { autoMusicChannels, channelEffectiveOn, isEligibleAudio, projectAudioItem } = require('../../lib/music/libraryAudio');
const store = require('../../lib/music/store');
const query = require('../../lib/music/query');

// Real-shaped rows (trimmed) from GET /api/videos?format=audio.
const TONZAK = {
  id: 'tonzak1', type: 'audio', title: 'Soul Coughing - $300',
  name: 'Soul Coughing - $300 [x].mp3',
  filePath: '/media/ytdlp/Tonzak/Soul Coughing - $300 [x].mp3', rootFolder: '/media/ytdlp',
  folderName: 'Tonzak', channelName: 'Tonzak', duration: 188.046813, hasThumbnail: true,
  tags: { title: 'Soul Coughing - $300', artist: 'Tonzak', date: '2009', genre: 'Music' },
};
const NESTALGIA_1 = {
  id: 'nest1', type: 'audio', title: 'A Link to the Past Epic Mariachi',
  filePath: '/media/ytdlp/nestalgiamusic/mariachi [x].mp3', rootFolder: '/media/ytdlp',
  folderName: 'nestalgiamusic', channelName: 'NESTALGIA', duration: 1837.226667, hasThumbnail: true,
  tags: { title: 'A Link to the Past Epic Mariachi', artist: 'NESTALGIA', date: '2026', genre: 'Gaming' },
};
const NESTALGIA_2 = {
  id: 'nest2', type: 'audio', title: 'Sonic 2 Ambient Remix',
  filePath: '/media/ytdlp/nestalgiamusic/sonic2 [y].mp3', rootFolder: '/media/ytdlp',
  folderName: 'nestalgiamusic', channelName: 'NESTALGIA', duration: 1461.9, hasThumbnail: true,
  tags: { title: 'Sonic 2 Ambient Remix', artist: 'NESTALGIA', date: '2026', genre: 'Gaming' },
};
const ZARCHIVO = {
  id: 'zarch1', type: 'audio', title: 'Cooking | Opie & Anthony',
  filePath: '/media/ytdlp/zarchivoopieanthonyepisode1889/cooking [x].mp3', rootFolder: '/media/ytdlp',
  folderName: 'zarchivoopieanthonyepisode1889', channelName: 'Zarchivo [Opie & Anthony Episodes]',
  duration: 859.01, hasThumbnail: true,
  tags: { title: 'Cooking | Opie & Anthony', artist: 'Zarchivo [Opie & Anthony Episodes]', date: '2026', genre: 'Comedy' },
};
const A_VIDEO = {
  id: 'vid1', type: 'video', title: 'Some Video', filePath: '/media/ytdlp/Chan/v.mp4',
  rootFolder: '/media/ytdlp', folderName: 'Chan', duration: 100, hasThumbnail: true,
  tags: { genre: 'Music' }, // even a Music-genre VIDEO is never a "song"
};

// The corpus + its channel-level auto-music set (majority-music channels).
// nestalgiamusic = 2 Gaming (NOT auto); Tonzak = 1 Music (auto); zarchivo =
// 1 Comedy (NOT auto).
const CORPUS = [TONZAK, NESTALGIA_1, NESTALGIA_2, ZARCHIVO];
const AUTO = autoMusicChannels(CORPUS);

// ---- eligibility: CHANNEL-LEVEL auto default (majority-music) ----------------

test('auto default is CHANNEL-level: an all-music channel is IN, Comedy/Gaming channels are OUT (no marks)', () => {
  assert.strictEqual(isEligibleAudio(TONZAK, {}, AUTO), true, 'Tonzak (all Music) -> auto in');
  assert.strictEqual(isEligibleAudio(ZARCHIVO, {}, AUTO), false, 'Zarchivo (Comedy) -> out');
  assert.strictEqual(isEligibleAudio(NESTALGIA_1, {}, AUTO), false, 'NESTALGIA (all Gaming) -> out; needs a mark');
});

test('a MIXED channel does NOT auto-qualify on a single Music track (the Nestalgia 1-of-352 bug is gone)', () => {
  // 3 Gaming + 1 Music in ONE folder -> minority music -> NOT auto (all-or-
  // nothing). The OLD per-item default would have leaked just the 1 Music track
  // (the "blue but 1 song" mismatch). A mark then brings ALL of it.
  const mk = (id, genre) => ({ id, type: 'audio', folderName: 'mixed', tags: { genre } });
  const mixed = [mk('m1', 'Music'), mk('g1', 'Gaming'), mk('g2', 'Gaming'), mk('g3', 'Gaming')];
  const auto = autoMusicChannels(mixed);
  assert.strictEqual(auto.has('mixed'), false, 'minority-music channel is NOT auto');
  assert.strictEqual(isEligibleAudio(mixed[0], {}, auto), false, 'not even the lone Music track shows by default (no partial)');
  const on = new Set(); // marks the channel on
  assert.strictEqual(isEligibleAudio(mixed[1], { mixed: 'on' }, on), true, 'a mark brings the WHOLE channel (a Gaming track too)');
});

test('a MAJORITY-music channel DOES auto-qualify (all of it, not a partial)', () => {
  const mk = (id, genre) => ({ id, type: 'audio', folderName: 'mostly', tags: { genre } });
  const mostly = [mk('a', 'Music'), mk('b', 'Music'), mk('c', 'Gaming')]; // 2 of 3 Music
  const auto = autoMusicChannels(mostly);
  assert.strictEqual(auto.has('mostly'), true, 'strict majority music -> auto');
  assert.strictEqual(isEligibleAudio(mostly[2], {}, auto), true, 'the Gaming track rides in too (all-or-nothing)');
});

test('a VIDEO item is NEVER eligible, even genre Music', () => {
  assert.strictEqual(isEligibleAudio(A_VIDEO, {}, autoMusicChannels([A_VIDEO])), false, 'a video never counts, never projects');
  assert.strictEqual(isEligibleAudio(A_VIDEO, { Chan: 'on' }, AUTO), false, 'an explicit on cannot promote a non-audio item');
});

// ---- eligibility: BOTH override arms, bound behaviourally --------------------

test("override 'on' FORCES a non-auto (Gaming/Comedy) channel fully IN (the on-arm)", () => {
  assert.strictEqual(isEligibleAudio(NESTALGIA_1, { nestalgiamusic: 'on' }, AUTO), true,
    'Dean flips the Gaming channel on -> its tracks project');
  assert.strictEqual(isEligibleAudio(ZARCHIVO, { zarchivoopieanthonyepisode1889: 'on' }, AUTO), true,
    'the on-arm overrides the auto default even for Comedy (delete it -> this reds)');
});

test("override 'off' FORCES an auto-music channel OUT (the off-arm)", () => {
  assert.strictEqual(isEligibleAudio(TONZAK, { Tonzak: 'off' }, AUTO), false,
    'off suppresses a would-be-auto channel (delete the off-arm -> this reds)');
});

test('channelEffectiveOn mirrors the predicate (single source of truth for the toggle)', () => {
  assert.strictEqual(channelEffectiveOn('Tonzak', {}, AUTO), true, 'auto channel -> on');
  assert.strictEqual(channelEffectiveOn('nestalgiamusic', {}, AUTO), false, 'non-auto channel -> off');
  assert.strictEqual(channelEffectiveOn('nestalgiamusic', { nestalgiamusic: 'on' }, AUTO), true, 'override on wins');
  assert.strictEqual(channelEffectiveOn('Tonzak', { Tonzak: 'off' }, AUTO), false, 'override off wins');
});

test('an unrelated mark on another folder does not leak across channels', () => {
  assert.strictEqual(isEligibleAudio(NESTALGIA_1, { Tonzak: 'on' }, AUTO), false,
    "a mark keyed to a different folder must not make NESTALGIA eligible");
});

// ---- projection shape --------------------------------------------------------

test('projectAudioItem: real music-track shape + per-item media routes', () => {
  const t = projectAudioItem(NESTALGIA_1);
  assert.strictEqual(t.id, 'nest1');
  assert.strictEqual(t.title, 'A Link to the Past Epic Mariachi');
  assert.strictEqual(t.artist, 'NESTALGIA', 'the embedded artist tag IS the channel');
  assert.strictEqual(t.albumArtist, 'NESTALGIA');
  assert.strictEqual(t.album, '', 'no album tags exist -> empty album (one untitled album per artist)');
  assert.strictEqual(t.durationSec, 1837.226667, 'duration -> durationSec');
  assert.strictEqual(t.hasEmbeddedArt, true, 'the YouTube thumbnail stands in for album art');
  assert.strictEqual(t.source, 'library', 'the discriminator the player + endpoints branch on');
  assert.strictEqual(t.streamSrc, '/video/nest1', 'streams the mp3 from the media byte route (NOT /track)');
  assert.strictEqual(t.artUrl, '/thumbnail/nest1');
  assert.strictEqual(t.progressEndpoint, '/api/progress', 'progress unified with the feed side');
});

test('projectAudioItem: artist falls back to channelName when no tag/path artist', () => {
  const bare = {
    id: 'b1', type: 'audio', title: 'Bare', name: 'bare.mp3',
    filePath: '/media/ytdlp/bare.mp3', rootFolder: '/media/ytdlp', folderName: 'ytdlp',
    channelName: 'Fallback Channel', duration: 10, hasThumbnail: false,
    tags: { genre: 'Music' }, // no artist tag; file directly under root -> no path artist
  };
  const t = projectAudioItem(bare);
  assert.strictEqual(t.artist, 'Fallback Channel', 'channelName is the fallback when buildTrackMetadata yields no artist');
  assert.strictEqual(t.hasEmbeddedArt, false);
});

// ---- reachability: projected records group by channel through the REAL pipeline

test('projected library tracks group into ONE untitled album per channel (real query layer)', () => {
  const projected = [NESTALGIA_1, NESTALGIA_2, TONZAK].map(projectAudioItem);
  // Both NESTALGIA mixes share an album key; Tonzak is a different artist.
  const kNest1 = store.albumKeyFor(projected[0]);
  const kNest2 = store.albumKeyFor(projected[1]);
  const kTonzak = store.albumKeyFor(projected[2]);
  assert.strictEqual(kNest1, kNest2, 'both NESTALGIA mixes group under one (untitled) album');
  assert.notStrictEqual(kNest1, kTonzak, 'a different channel is a different album');

  const artists = query.groupArtists(projected, 'artist');
  const nest = artists.find((a) => a.artist === 'NESTALGIA');
  assert.ok(nest, 'NESTALGIA appears as an artist');
  assert.strictEqual(nest.trackCount, 2, 'both its mixes count under it');
  assert.strictEqual(nest.albumCount, 1, 'one untitled album');
  assert.ok(artists.some((a) => a.artist === 'Tonzak'), 'Tonzak is its own artist');
});
