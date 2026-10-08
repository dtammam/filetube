'use strict';

// v1.375.0 "radio that feels like radio": a KIRBY-SHAPED library (plan
// docs/exec-plans/active/2026-10-08-v1375-radio-like-radio.md), shaped on Dean's production measurement
// (2026-10-08): DJ-set chapters from yt-dlp channels whose genre is '' or a YouTube category, the
// same franchise across several channels, one big channel that covers every franchise, and a native
// pop artist who is half of all pop. The yt-dlp sets go through the REAL projection
// (lib/music/libraryAudio.js expandAudioToTracks), so every chapter has the shape GET /api/music
// serves (`<md5>::c<n>`, artist = album artist = the channel, album = the video title, source
// library-chapter). The fixture is built so right and wrong picks DIVERGE:
//   - NESTALGIA has 3 Kirby sets and 9 sets of other franchises: a seed-artist-first picker plays Zelda,
//     Mario and Sonic from it; a size-weighted series draw is mostly NESTALGIA.
//   - Vapid's sets share a title TEMPLATE ("2 Hours of Happy and Underrated <X> Music"), and NESTALGIA
//     has an "Underrated Zelda" set too: a picker keyed on any rare shared word plays Vapid's Zelda,
//     Mega Man and Mario for a Vapid Kirby seed.
//   - Sonic's "Green Hill Zone" shares ONE word with the Kirby song "Green Greens".
//   - Prince (native Pop, 60 songs) is most of the Pop: a session of Pop plays before the Kirby album is
//     what v1.368.0's session anchor turned into a Pop station.
// No ids are reused; every chapter id is md5-length like production's.

const crypto = require('node:crypto');
const path = require('node:path');
const libraryAudio = require('../../lib/music/libraryAudio');

const ROOT = '/library/ytdlp';
const md5 = (x) => crypto.createHash('md5').update(x).digest('hex');

// a yt-dlp DJ set: one audio file with chapters, through the real projection
function set(channel, folder, title, genre, chapterTitles) {
  const id = md5(folder + '/' + title);
  const tags = { title, artist: channel };
  if (genre) tags.genre = genre;
  const item = {
    id, type: 'audio', title, name: title + '.mp3', filePath: path.join(ROOT, folder, title + '.mp3'), rootFolder: ROOT,
    folderName: folder, channelName: channel, duration: 240 * chapterTitles.length, hasThumbnail: true, ext: '.mp3',
    addedAt: 1788000000000, tags,
  };
  return libraryAudio.expandAudioToTracks(item, () => chapterTitles.map((t, i) => ({ startTime: i * 240, title: t })));
}
// a plain yt-dlp upload (no chapters)
function upload(channel, folder, title, genre) {
  const id = md5(folder + '/' + title);
  const tags = { title, artist: channel };
  if (genre) tags.genre = genre;
  return libraryAudio.expandAudioToTracks({ id, type: 'audio', title, name: title + '.mp3', filePath: path.join(ROOT, folder, title + '.mp3'), rootFolder: ROOT, folderName: folder, channelName: channel, duration: 1800, hasThumbnail: true, ext: '.mp3', addedAt: 1788000000000, tags }, () => []);
}
// a native album (the music store's shape; folderName = the file's parent directory, an album folder on
// an Artist/Album layout - lib/music/scan.js; gate r1 qa S1 / adversary S1)
let nativeN = 0;
function album(artist, albumTitle, genre, year, titles) {
  return titles.map((title, i) => {
    nativeN += 1;
    return { id: md5('native/' + artist + '/' + albumTitle + '/' + title), title, artist, albumArtist: artist, album: albumTitle, trackNo: i + 1, genre, year: String(year), folderName: albumTitle, durationSec: 200 + (nativeN % 60), source: 'native' };
  });
}
const n = (prefix, k) => Array.from({ length: k }, (_, i) => prefix + ' ' + (i + 1));

const KIRBY_SETS = {
  vapid: '2 Hours of Happy and Underrated Kirby Music',
  nestalgiaLofi: 'Kirby Lofi Mix ~ chill beats to relax to',
  psk: 'kirby lofi beats',
  nativeOst: 'Kirby Super Star Original Soundtrack',
};

function buildLibrary() {
  nativeN = 0;
  const L = [];
  // NESTALGIA: every franchise, chapters untagged or 'Gaming' (the channel is game music by its tags)
  L.push(...set('NESTALGIA', 'NESTALGIA', KIRBY_SETS.nestalgiaLofi, '', ['Green Greens', 'Gourmet Race', 'Butter Building', 'Float Islands', 'Bubbly Clouds', 'Ice Cream Island', 'Vegetable Valley', 'Rainbow Resort']));
  L.push(...set('NESTALGIA', 'NESTALGIA', 'Kirby Super Star - Lofi & Chill', 'Gaming', ['Gourmet Race', 'Halberd', 'Dyna Blade', 'Peanut Plains', 'Revenge of Meta Knight', 'Milky Way Wishes']));
  L.push(...set('NESTALGIA', 'NESTALGIA', 'Kirby Air Ride Lofi', '', ['Checker Knights', 'Fantasy Meadows', 'Celestial Valley', 'Sky Sands', 'Frozen Hillside', 'Magma Flows']));
  L.push(...set('NESTALGIA', 'NESTALGIA', 'Zelda Lofi Mix', 'Gaming', ['Hyrule Field', 'Lost Woods', 'Kakariko Village', 'Gerudo Valley', 'Song of Storms', 'Zoras Domain', 'Lon Lon Ranch', 'Windmill Hut']));
  L.push(...set('NESTALGIA', 'NESTALGIA', 'Underrated Zelda Music (lofi)', '', n('Zelda Deep Cut', 8)));
  L.push(...set('NESTALGIA', 'NESTALGIA', 'Zelda Ocarina of Time Chill', '', n('Ocarina Chill', 8)));
  L.push(...set('NESTALGIA', 'NESTALGIA', 'Zelda Breath of the Wild Lofi', 'Gaming', n('Wild Lofi', 8)));
  L.push(...set('NESTALGIA', 'NESTALGIA', 'Super Mario Lofi Mix', '', ['Overworld Theme', 'Underground', 'Castle Theme', 'Star Road', 'Athletic', 'Ghost House', 'Delfino Plaza', 'Bob-omb Battlefield']));
  L.push(...set('NESTALGIA', 'NESTALGIA', 'Mario Kart Chill', 'Gaming', n('Kart Chill', 8)));
  L.push(...set('NESTALGIA', 'NESTALGIA', 'Super Mario Galaxy Lofi', '', n('Galaxy Lofi', 8)));
  L.push(...set('NESTALGIA', 'NESTALGIA', 'Sonic Lofi', '', ['Green Hill Zone', 'Chemical Plant', 'Casino Night', 'Ice Cap', 'Hydrocity', 'Mushroom Hill', 'Flying Battery', 'Lava Reef']));
  L.push(...set('NESTALGIA', 'NESTALGIA', 'Sonic Adventure Chill', '', n('Adventure Chill', 8)));
  L.push(...upload('NESTALGIA', 'NESTALGIA', 'NESTALGIA Podcast Episode 12', 'People & Blogs'));
  // Vapid: one title template for every set (the "underrated" trap), all 'Gaming'
  L.push(...set('Vapid', 'vapidVGM', KIRBY_SETS.vapid, 'Gaming', ['Kirby Return to Dream Land - Cookie Country', 'Kirby Planet Robobot - Patched Plains', 'Kirby Triple Deluxe - Fine Fields', 'Green Greens (Kirby Dream Land)', 'Kirby Squeak Squad - Prism Plains', 'Kirby Mass Attack - Green Valley', 'Kirby Canvas Curse - Drawcia', 'Kirby 64 - Pop Star', 'Kirby Star Allies - Honey Hill', 'Kirby Epic Yarn - Quilty Square', 'Kirby Amazing Mirror - Rainbow Route', 'Kirby Nightmare in Dream Land - Vegetable Valley']));
  L.push(...set('Vapid', 'vapidVGM', '2 Hours of Happy and Underrated Zelda Music', 'Gaming', n('Vapid Zelda', 10)));
  L.push(...set('Vapid', 'vapidVGM', '2 Hours of Happy and Underrated Mega Man Music', 'Gaming', n('Vapid Mega Man', 10)));
  L.push(...set('Vapid', 'vapidVGM', '2 Hours of Happy and Underrated Mario Music', 'Gaming', n('Vapid Mario', 10)));
  // heavymachinegun: game channel (its tagged set is Gaming), one Kirby set untagged
  L.push(...set('heavymachinegun', 'heavymachinegun', 'Kirby and the Forgotten Land - Full OST Medley', '', ['Forgotten Land Opening', 'Natural Plains', 'Everbay Coast', 'Wondaria Remains', 'Winter Horns', 'Originull Wasteland']));
  L.push(...set('heavymachinegun', 'heavymachinegun', 'Castlevania Symphony Remix', 'Gaming', n('Castle Remix', 8)));
  L.push(...set('heavymachinegun', 'heavymachinegun', 'Metroid Prime Ambience', '', n('Metroid Ambience', 8)));
  // Soundzantium: YouTube 'Music' category (not a game channel by its tags); a Kirby suite
  L.push(...set('Soundzantium', 'Soundzantium', 'Kirby Orchestral Suite', 'Music', ['Kirby Suite I', 'Kirby Suite II', 'Kirby Suite III', 'Kirby Suite IV', 'Kirby Suite V', 'Kirby Suite VI']));
  L.push(...set('Soundzantium', 'Soundzantium', 'Final Fantasy Orchestral Suite', 'Music', n('Fantasy Suite', 8)));
  // a THIN artist: one Kirby set and lofi, 'Music' category
  L.push(...set("PSK Beats n' Vibes", 'pskbeats', KIRBY_SETS.psk, 'Music', ['Dreamy Greens', 'Gourmet Lofi', 'Kirby Nap', 'Warp Star Beat', 'Kirby Rain']));
  L.push(...set("PSK Beats n' Vibes", 'pskbeats', 'Rainy Day Beats', 'Music', n('Rainy Beat', 8)));
  // a lofi hip hop channel: 'Music' category, no series
  L.push(...set('Chillhop Music', 'chillhopmusic', 'lofi hip hop radio - beats to relax/study to', 'Music', n('Chillhop Cut', 12)));
  // native: Prince is most of the Pop
  L.push(...album('Prince', 'Purple Rain', 'Pop', 1984, n('Purple Rain Song', 10)));
  L.push(...album('Prince', '1999', 'Pop', 1982, n('1999 Song', 10)));
  L.push(...album('Prince', 'Sign o\' the Times', 'Pop', 1987, n('Times Song', 10)));
  L.push(...album('Prince', 'Parade', 'Pop', 1986, n('Parade Song', 10)));
  L.push(...album('Prince', 'Lovesexy', 'Pop', 1988, n('Lovesexy Song', 10)));
  L.push(...album('Prince', 'Diamonds and Pearls', 'Pop', 1991, n('Pearls Song', 10)));
  L.push(...album('Tears for Fears', 'Songs from the Big Chair', 'Pop', 1985, n('Big Chair Song', 8)));
  L.push(...album('David Bowie', 'Let\'s Dance', 'Pop', 1983, n('Dance Song', 8)));
  // native rock
  L.push(...album('Foo Fighters', 'The Colour and the Shape', 'Rock', 1997, n('Colour Song', 10)));
  L.push(...album('Pearl Jam', 'Ten', 'Rock', 1991, n('Ten Song', 10)));
  L.push(...album('Nirvana', 'Nevermind', 'Rock', 1991, n('Nevermind Song', 10)));
  for (const [artist, rec, year] of [['Soundgarden', 'Superunknown', 1994], ['Alice in Chains', 'Dirt', 1992], ['Smashing Pumpkins', 'Siamese Dream', 1993], ['Stone Temple Pilots', 'Core', 1992]]) L.push(...album(artist, rec, 'Rock', year, n(rec + ' Song', 6)));
  // native game music, a chiptune artist who also plays Electronic, a film soundtrack, Electronic
  L.push(...album('Jun Ishikawa', KIRBY_SETS.nativeOst, 'Video Game', 1996, ['Gourmet Race', 'Green Greens', 'Dyna Blade', 'Halberd Theme', 'Milky Way Wishes', 'Marx Battle', 'Peanut Plains', 'Float Islands']));
  L.push(...album('Yasunori Mitsuda', 'Chrono Trigger Original Soundtrack', 'Video Game', 1995, n('Chrono Trigger Track', 8)));
  L.push(...album('Anamanaguchi', 'Endless Fantasy', 'Chiptune', 2013, n('Endless Track', 6)));
  L.push(...album('Anamanaguchi', 'USA', 'Electronic', 2019, n('USA Track', 2)));
  L.push(...album('Hans Zimmer', 'Interstellar', 'Soundtrack', 2014, n('Interstellar Cue', 6)));
  L.push(...album('Daft Punk', 'Discovery', 'Electronic', 2001, n('Discovery Track', 8)));
  // the rest of a real library: most of it is not game music (Dean's: ~2000 albums, 17 of them Kirby)
  const FILLER_GENRES = ['Jazz', 'Hip-Hop', 'Folk', 'Heavy Metal', 'Country', 'Classical', 'R&B', 'Indie'];
  for (let a = 0; a < 64; a += 1) L.push(...album('Filler Artist ' + a, 'Filler Record ' + a, FILLER_GENRES[a % FILLER_GENRES.length], 1970 + a, n('Filler ' + a + ' Song', 4)));
  for (let u = 0; u < 40; u += 1) L.push(...upload('Vlog Channel ' + (u % 8), 'vlog' + (u % 8), 'Weekly Vlog Upload ' + u, u % 2 ? 'Music' : 'People & Blogs'));
  return L;
}

const fold = (s) => String(s || '').toLowerCase();
const isKirby = (t) => /kirby/.test(fold(t.album)) || /kirby/.test(fold(t.title));
// game music as the RULING means it (Q2): the channels whose genre-tagged uploads are mostly game music
// (Anamanaguchi's 'Electronic' album rides on its 'Chiptune' majority) and the native game genres
const GAME_CHANNELS = new Set(['NESTALGIA', 'Vapid', 'heavymachinegun', 'Jun Ishikawa', 'Yasunori Mitsuda', 'Anamanaguchi']);
const isGameMusic = (t) => GAME_CHANNELS.has(t.albumArtist) || t.genre === 'Video Game' || t.genre === 'Chiptune';
// a REAL genre outside game music (what Q4 widens to only after the game family)
const isRealGenre = (t) => t.source === 'native' && !isGameMusic(t);

module.exports = { buildLibrary, KIRBY_SETS, isKirby, isGameMusic, isRealGenre, md5, set, album, upload };
