'use strict';

// Mobile music player SKINS (Dean's wave). Pure PRESENTATION over the battle-won
// shared player: each skin's renderFull(ctx) returns HTML for the full-screen
// now-playing, carrying STABLE data-skin-* action hooks that the /music view
// proxies to the player's EXISTING hidden controls (#pp-btn / #track-prev-btn /
// #track-next-btn / #seek-bar). This module NEVER touches audio, MediaSession,
// background-audio, or the player element - it only draws chrome and exposes the
// hooks. Registry + per-device setting mirror glyph-pool.js (dual-exported so the
// pure funcs unit-test via require without jsdom).
//
// ctx shape (built by the view from its live queue + the player element):
//   { track: {title, artist, album, artUrl},
//     upNext: [{index, title, artist, durLabel, state:'played'|'current'|'next'}],
//     playing: bool, posSec: number, durSec: number, posLabel, remLabel }
//
// Action hooks (one delegated handler in music.js proxies each to a host control):
//   data-skin-play      -> click #pp-btn (gesture-safe; primes bg-audio)
//   data-skin-prev/next -> click #track-prev-btn / #track-next-btn (setTrackNav path)
//   data-skin-seek      -> a bar; click maps x -> #seek-bar value (existing seek)
//   data-skin-go="<i>"  -> jump to queue index i (the view's playAt)
//   data-skin-collapse  -> dock the player (browse-away; the mini returns you)

(function () {
  var SKIN_KEY = 'ft-music-skin';
  var IDS = ['apple', 'spotify', 'ipod'];
  var DEFAULT_ID = 'apple';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function pct(posSec, durSec) {
    var d = Number(durSec) || 0;
    if (d <= 0) return 0;
    return Math.min(100, Math.max(0, (Number(posSec) || 0) / d * 100));
  }
  function playGlyph(playing) {
    return playing
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  }
  function prevGlyph() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>'; }
  function nextGlyph() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>'; }

  // Shared transport (play/pause proxies to #pp-btn; prev/next to the track btns).
  // A skin passes its own classes; the hooks + glyphs are identical everywhere so
  // the single proxy handler works for all skins.
  function transport(ctx) {
    return '' +
      '<button type="button" class="mms-skip" data-skin-prev aria-label="Previous">' + prevGlyph() + '</button>' +
      '<button type="button" class="mms-play" data-skin-play aria-label="' + (ctx.playing ? 'Pause' : 'Play') + '">' + playGlyph(ctx.playing) + '</button>' +
      '<button type="button" class="mms-skip" data-skin-next aria-label="Next">' + nextGlyph() + '</button>';
  }
  function scrubber(ctx) {
    return '' +
      '<div class="mms-bar" data-skin-seek role="slider" aria-label="Seek" tabindex="0">' +
      '<div class="mms-fill" style="width:' + pct(ctx.posSec, ctx.durSec) + '%"></div></div>' +
      '<div class="mms-times"><span class="mms-pos">' + esc(ctx.posLabel || '0:00') + '</span>' +
      '<span class="mms-rem">' + esc(ctx.remLabel || '') + '</span></div>';
  }
  function art(ctx, cls) {
    var url = ctx.track && ctx.track.artUrl;
    return '<div class="' + cls + '">' + (url
      ? '<img src="' + esc(url) + '" alt="" class="art-shimmer" loading="lazy" />'
      : '') + '</div>';
  }
  function upNextList(ctx) {
    var rows = (ctx.upNext || []).map(function (it) {
      var c = 'mms-row' + (it.state === 'current' ? ' is-current' : (it.state === 'played' ? ' is-played' : ''));
      return '<button type="button" class="' + c + '" data-skin-go="' + it.index + '">' +
        '<span class="mms-rn">' + (it.state === 'current' ? '▶' : (it.index + 1)) + '</span>' +
        '<span class="mms-rt">' + esc(it.title || 'Track') + '</span>' +
        '<span class="mms-rd">' + esc(it.durLabel || '') + '</span></button>';
    }).join('');
    return '<div class="mms-upnext"><div class="mms-upnext-h">' + esc('Up next · ' + ((ctx.track && ctx.track.album) || 'Queue')) + '</div>' +
      '<div class="mms-upnext-list">' + rows + '</div></div>';
  }
  function topBar(label) {
    return '<div class="mms-top"><button type="button" class="mms-chev" data-skin-collapse aria-label="Collapse">▾</button>' +
      '<span class="mms-ctx">' + esc(label) + '</span><span class="mms-chev mms-chev-ghost" aria-hidden="true">⋯</span></div>';
  }
  function metaLine(ctx) {
    var t = ctx.track || {};
    return '<div class="mms-meta"><div class="mms-ttl" title="' + esc(t.title) + '">' + esc(t.title || 'Unknown track') + '</div>' +
      '<div class="mms-sub">' + esc([t.artist, t.album].filter(Boolean).join(' — ')) + '</div></div>';
  }

  // ---- the three skins (full-screen now-playing) --------------------------------
  // Each returns the INNER html for a `.mms.<skin>` container the view creates.
  function renderApple(ctx) {
    return topBar('From ' + ((ctx.track && ctx.track.album) || 'Music')) +
      art(ctx, 'mms-art') + metaLine(ctx) +
      '<div class="mms-scrub">' + scrubber(ctx) + '</div>' +
      '<div class="mms-transport">' + transport(ctx) + '</div>' +
      upNextList(ctx);
  }
  function renderSpotify(ctx) {
    // same structure, skin-specific chrome via CSS (.mms.spotify)
    return topBar((ctx.track && ctx.track.album) || 'Music') +
      art(ctx, 'mms-art') + metaLine(ctx) +
      '<div class="mms-scrub">' + scrubber(ctx) + '</div>' +
      '<div class="mms-transport">' + transport(ctx) + '</div>' +
      upNextList(ctx);
  }
  function renderIpod(ctx) {
    return topBar('Now Playing') +
      art(ctx, 'mms-art') + metaLine(ctx) +
      '<div class="mms-scrub">' + scrubber(ctx) + '</div>' +
      '<div class="mms-transport">' + transport(ctx) + '</div>' +
      upNextList(ctx);
  }

  var SKINS = [
    { id: 'apple', label: 'Apple Music', renderFull: renderApple },
    { id: 'spotify', label: 'Spotify', renderFull: renderSpotify },
    { id: 'ipod', label: 'iPod', renderFull: renderIpod },
  ];
  var BY_ID = SKINS.reduce(function (m, s) { m[s.id] = s; return m; }, Object.create(null));

  function normalizeSkinId(id) { return IDS.indexOf(id) >= 0 ? id : DEFAULT_ID; }
  function activeSkinId(store) {
    // store = a localStorage-like {getItem}; defaults to window.localStorage.
    var ls = store || (typeof window !== 'undefined' && window.localStorage);
    try { return normalizeSkinId(ls && ls.getItem(SKIN_KEY)); } catch (_) { return DEFAULT_ID; }
  }
  function setActiveSkin(id, store) {
    var ls = store || (typeof window !== 'undefined' && window.localStorage);
    try { ls.setItem(SKIN_KEY, normalizeSkinId(id)); } catch (_) { /* private mode */ }
    return normalizeSkinId(id);
  }
  function skinById(id) { return BY_ID[normalizeSkinId(id)]; }

  // The GATE: the mobile-music skin is active only on a mobile viewport AND a music
  // item. `meta` is player.getCurrentMeta() (or a {isMusic} stand-in); `mql` lets a
  // test inject the matchMedia result. Desktop + video/podcast/book stay default.
  function isMobileViewport(mql) {
    if (typeof mql === 'boolean') return mql;
    try { return !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 768px)').matches); } catch (_) { return false; }
  }
  function skinActiveFor(meta, mql) {
    return !!(meta && meta.isMusic) && isMobileViewport(mql);
  }

  var api = {
    SKIN_KEY: SKIN_KEY, IDS: IDS, DEFAULT_ID: DEFAULT_ID, SKINS: SKINS,
    normalizeSkinId: normalizeSkinId, activeSkinId: activeSkinId, setActiveSkin: setActiveSkin,
    skinById: skinById, renderFull: function (id, ctx) { return skinById(id).renderFull(ctx || {}); },
    skinActiveFor: skinActiveFor, isMobileViewport: isMobileViewport,
    _esc: esc, _pct: pct,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FileTubeMusicSkins = api;
})();
