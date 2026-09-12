'use strict';

// Media capability parity - the SINGLE SOURCE OF TRUTH for which user actions each
// media type exposes, and where. Modeled on lib/search/registry.js: a declarative
// registry bound to reality by a census test (test/unit/media-capability-census.test.js),
// so parity is ENFORCED, not opt-in. A SUPPORTED cell whose wiring vanished, a new
// media type/capability left undeclared, or a TODO gap that silently appears or silently
// closes, all go RED at the gate - the honest version of "everything is first-class"
// (Dean's standardization-audit wave, 2026-09-12).
//
// The media authority is KIND_TO_LIBRARY (lib/auth/visibility.js) - the same list the
// RBAC layer and the search census use. Add a media type there and every cell for it
// goes RED here until declared.

const { KIND_TO_LIBRARY } = require('./auth/visibility');

// The library ids (values of KIND_TO_LIBRARY): video, music, podcasts, books, tv.
const MEDIA_TYPES = Object.freeze([...new Set(Object.values(KIND_TO_LIBRARY))].sort());

// The capability columns. Adding one here forces a declaration in every media type's
// row (the census enforces completeness).
const CAPABILITIES = Object.freeze([
  'download', 'share', 'queue', 'delete', 'move',
  'transcript', 'reheat', 'like', 'watched', 'listen', 'playerMenu',
]);

// The view files the census greps a SUPPORTED cell's marker against, per media type.
// A marker matching in ANY of the type's files counts as wired.
const MEDIA_VIEW_FILES = Object.freeze({
  video: ['public/watch.html', 'public/js/watch.js'],
  tv: ['public/js/tv.js'],
  music: ['public/music.html', 'public/js/music.js', 'public/js/skin-surface.js'],
  podcasts: ['public/podcasts.html', 'public/js/podcasts.js', 'public/js/skin-surface.js'],
  books: ['public/read.html', 'public/js/read.js', 'public/js/books.js'],
});

// ---- cell constructors (states) --------------------------------------------
// supported: at least one `markers` string must be found in the type's view files.
const sup = (surfaces, markers) => ({ state: 'supported', surfaces, markers });
// na: intentional-and-permanent; `reason` is required and human-readable.
const na = (reason) => ({ state: 'na', reason });
// todo: a declared, committed gap. `when` is 'this-wave' | 'next-wave' | 'future'.
const todo = (when, note) => ({ state: 'todo', when, note });
// delegated: this type has no controls of its own; it routes to another type's surface.
const del = (to) => ({ state: 'delegated', to });

// ---- THE MATRIX (5 media types x 11 capabilities = 55 cells) ----------------
// Every cell declared. Markers are STABLE strings (action ids / data-skin-x values /
// hook names), never line numbers.
const MATRIX = Object.freeze({
  video: {
    download: sup(['player'], ['download-media-btn']),
    share: sup(['player'], ['share-media-btn']),
    queue: sup(['player'], ['queue-add-btn']),
    delete: sup(['player'], ['delete-media-btn']),
    move: sup(['player'], ['move-media-btn']),
    transcript: sup(['player'], ['transcript-media-btn']),
    reheat: sup(['player'], ['reheat-media-btn']),
    like: sup(['player'], ['like-media-btn']),
    watched: sup(['player'], ['watched-media-btn']),
    listen: sup(['player'], ['listen-media-btn']),
    playerMenu: sup(['player'], ['more-actions-btn']),
  },
  tv: {
    // TV is a browse/scan/pin layer; every per-episode action routes to the video
    // watch page (tv.js navigates to /watch.html?tv=...). No controls of its own.
    download: del('video watch page'),
    share: del('video watch page'),
    queue: del('video watch page'),
    delete: del('video watch page'),
    move: del('video watch page'),
    transcript: del('video watch page'),
    reheat: del('video watch page'),
    like: del('video watch page'),
    watched: del('video watch page'),
    listen: del('video watch page'),
    playerMenu: na('TV is a browse layer with no player of its own; episodes open the video watch page'),
  },
  music: {
    download: sup(['list', 'player'], ['music-download-btn', 'data-skin-x="download"']),
    share: sup(['player'], ['data-skin-x="share"']),
    queue: sup(['list', 'player'], ['data-skin-x="queue"', 'music-queue']),
    delete: sup(['player'], ['data-skin-x="delete"']),
    move: sup(['player'], ['data-skin-x="move"']),
    transcript: sup(['player'], ['data-skin-x="transcript"']),
    reheat: sup(['player'], ['data-skin-x="reheat"']),
    like: sup(['list', 'player'], ['music-like-btn', 'data-skin-x="like"']),
    watched: sup(['player'], ['data-skin-x="watched"']),
    listen: sup(['player'], ['watchBack:', 'data-skin-watchback']),
    playerMenu: sup(['player'], ['music-actions-menu']),
  },
  podcasts: {
    // Today: list-row controls only. T2 adds the in-player menu (the applicable subset)
    // and universal Share. Cells the player gains this wave carry todo('this-wave').
    download: sup(['list', 'player'], ['?download=1']),
    // v1.287: universal Share (file-only for RSS) via the podcast extras adapter. Marker = the
    // capabilities array's 'share' entry - removing 'share' (dropping the row) reds this.
    share: sup(['player'], ["'download', 'share', 'queue', 'delete', 'like', 'watched'"]),
    queue: sup(['list', 'player'], ['addToQueue']),
    delete: sup(['list', 'player'], ['Move to trash']),
    move: na('RSS episodes live in the podcast store, not the folder library'),
    transcript: todo('future', 'needs RSS podcast:transcript ingestion first'),
    reheat: na('reheat needs a yt-dlp source; RSS episodes have none'),
    like: sup(['list', 'player'], ['podcast-like-toggle']),
    watched: sup(['list', 'player'], ['podcast-played-toggle', 'togglePlayed']),
    listen: na('a podcast episode is already audio'),
    // v1.287: the shared Extras menu, via the endpoint-driven factory + the podcast adapter.
    playerMenu: sup(['player'], ["watchedLabels: { on: 'Played', off: 'Mark played' }"]),
  },
  books: {
    download: sup(['reader'], ['reader-download-btn']),
    share: sup(['reader'], ['Share this book']),
    queue: na('books are read, not queued for playback'),
    delete: na('book deletion is a library-management action, not a reader control'),
    move: na('book placement is a library-management action'),
    transcript: na('a book is already text'),
    reheat: na('reheat is a yt-dlp-source concept; books have none'),
    like: sup(['reader'], ['reader-like-btn']),
    watched: sup(['reader'], ['reader-finished-btn', 'Mark finished']),
    listen: sup(['reader'], ['reader-listen-btn']),
    playerMenu: na('the reader is a flat toolbar, not a player with an actions menu'),
  },
});

module.exports = { MEDIA_TYPES, CAPABILITIES, MEDIA_VIEW_FILES, MATRIX };
