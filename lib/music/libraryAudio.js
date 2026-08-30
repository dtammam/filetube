'use strict';

// Wave G - the VIRTUAL projection of library audio (db.metadata, type 'audio' -
// the yt-dlp MP3s) into the Music library, with NO data duplication. This is the
// pure decision layer: given a media item + the per-folder marks, decide if it
// belongs in Music (isEligibleAudio), and shape it into a music-track record the
// existing music query pipeline (matchesSearch/sortTracks/groupAlbums/
// groupArtists/publicTrackListItem) consumes natively (projectAudioItem).
//
// Framing (from the LIVE data - see docs/exec-plans/active/music-library-
// projection.md): yt-dlp embeds only { title, artist, date, genre, ... } - NO
// album/track/disc tags, and `artist` IS the channel. So the only clean
// music/not-music signal is the CHANNEL (folder): a per-folder mark, defaulting
// to the genre tag (genre === 'Music'). Reuses musicTags.buildTrackMetadata (the
// SAME resolver the real music scan uses) - zero re-probe.

const musicTags = require('./tags');

// Is a library audio item shown in the Music library?
//   override 'on'  -> yes (Dean flipped a Gaming-tagged music channel on)
//   override 'off' -> no  (a music-genre channel he does NOT want in Music)
//   unset          -> genre-seeded default: item.tags.genre === 'Music'
// The mark is keyed by folderName (the app's channel-grouping unit - the
// `?folder=` view). Non-audio items are never eligible.
function isEligibleAudio(item, channelMarks) {
  if (!item || item.type !== 'audio') return false;
  const marks = channelMarks && typeof channelMarks === 'object' ? channelMarks : {};
  const key = item.folderName;
  const override = (typeof key === 'string' && Object.prototype.hasOwnProperty.call(marks, key))
    ? marks[key]
    : undefined;
  if (override === 'on') return true;
  if (override === 'off') return false;
  return !!(item.tags && typeof item.tags === 'object' && item.tags.genre === 'Music');
}

// Project a db.metadata audio item into a music-track-shaped record.
//
// buildTrackMetadata gives us title/trackNo/discNo/year (embedded tag wins, path
// convention fills gaps) - all safe. But artist and album are resolved EXPLICITLY
// here, NOT from buildTrackMetadata's path convention:
//   - artist = embedded artist tag (which the live data proves IS the channel),
//     else channelName, else folderName. We do NOT let the path convention coin
//     an artist from a folder SLUG (e.g. 'nestalgiamusic' instead of 'NESTALGIA').
//   - album = a REAL embedded album tag only, else '' (untitled). The path
//     convention would otherwise stamp the folder slug as the album, inventing an
//     album shelf - the opposite of Dean's "no album sub-shelves" (no album tags
//     exist in this content anyway). album '' -> albumKeyFor groups ONE untitled
//     album per artist.
// Carries a `source:'library'` discriminator + its OWN routes so the shared
// player streams the mp3 from /video, arts from /thumbnail, and saves progress to
// the MEDIA store (/api/progress) - unifying resume with the feed side.
function projectAudioItem(item) {
  const meta = musicTags.buildTrackMetadata({
    tags: item.tags,
    filePath: item.filePath,
    rootFolder: item.rootFolder,
  });
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const tags = item.tags && typeof item.tags === 'object' ? item.tags : {};
  const artist = str(tags.artist) || item.channelName || item.folderName || 'Unknown';
  const album = str(tags.album); // real album tag only; never the path slug
  const albumArtist = str(tags.albumartist) || artist;
  return {
    id: item.id,
    filePath: item.filePath,
    rootFolder: item.rootFolder,
    folderName: item.folderName,
    ext: item.ext,
    addedAt: item.addedAt,
    title: meta.title || item.title || item.name || 'Unknown',
    artist,
    album,
    albumArtist,
    trackNo: meta.trackNo,
    discNo: meta.discNo,
    year: meta.year,
    genre: meta.genre,
    durationSec: Number(item.duration) || 0,
    // The item's YouTube thumbnail stands in for embedded album art; the grid's
    // representative-art logic uses this + the id (art served via /albumart/:id
    // falling back to the media thumbnail - see the /albumart route).
    hasEmbeddedArt: !!item.hasThumbnail,
    albumArtKey: null,
    // Wave G projection markers + per-item route overrides (the plumbing reuse):
    source: 'library',
    streamSrc: '/video/' + item.id,
    artUrl: '/thumbnail/' + item.id,
    progressEndpoint: '/api/progress',
  };
}

module.exports = {
  isEligibleAudio,
  projectAudioItem,
};
