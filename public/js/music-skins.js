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
// Skin PICKING is NOT an in-player hook: it lives on the Settings page (v1.230,
// setup.js renderMusicSkinPicker), which calls setActiveSkin(). The music view
// re-reads activeSkinId() on its next render, so the choice applies when you return.

(function () {
  var SKIN_KEY = 'ft-music-skin';
  var IDS = ['apple', 'spotify', 'ipod', 'ipod-black'];
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
  function shuffleGlyph() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 4l4 4-4 4V9h-2.2l-2.3 2.9-1.3-1.6L14.4 7H18V4zM2 7h4.2l8.6 10H18v-3l4 4-4 4v-3h-4.4L5 9H2V7zm0 10h4.2l1.9-2.3 1.3 1.6L7.1 19H2v-2z"/></svg>'; }
  // iPod click-wheel glyphs (clean gray line-icons, NOT unicode - which iOS renders as
  // blue emoji): |<< rewind, >>| fast-forward, and the classic >|| play/pause.
  function ipRwdGlyph() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h1.8v12H4zM13 6v12l-6-6zM21 6v12l-6-6z"/></svg>'; }
  function ipFfwdGlyph() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6v12l6-6zM11 6v12l6-6zM18.2 6H20v12h-1.8z"/></svg>'; }
  function ipPlayPauseGlyph() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5v14l10-7zM15 5h2.2v14H15zM19.8 5H22v14h-2.2z"/></svg>'; }
  // speaker glyph for the desktop pop-out's wheel-VOLUME bar (v1.235; SVG not emoji).
  function ipVolGlyph() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4 4 0 0 0-2.2-3.6v7.2A4 4 0 0 0 16.5 12zM14.3 4.3v1.9a6 6 0 0 1 0 11.6v1.9a8 8 0 0 0 0-15.4z"/></svg>'; }

  // ---- shared building blocks (hooks + REFLECT classes are identical everywhere
  // so music.js's one proxy handler + reflectSkin work for every skin) ----------
  function artUrl(ctx) { return (ctx.track && ctx.track.artUrl) || ''; }
  function artImg(ctx) { var u = artUrl(ctx); return u ? '<img class="mms-art-img art-shimmer" src="' + esc(u) + '" alt="" loading="lazy" />' : ''; }
  function fillW(ctx) { return 'style="width:' + pct(ctx.posSec, ctx.durSec) + '%"'; }
  function times(ctx) { return '<span class="mms-pos">' + esc(ctx.posLabel || '0:00') + '</span><span class="mms-rem">' + esc(ctx.remLabel || '') + '</span>'; }
  function playBtn(ctx) { return '<button type="button" class="mms-play" data-skin-play aria-label="' + (ctx.playing ? 'Pause' : 'Play') + '">' + playGlyph(ctx.playing) + '</button>'; }
  function prevBtn() { return '<button type="button" class="mms-skip mms-prev" data-skin-prev aria-label="Previous">' + prevGlyph() + '</button>'; }
  function nextBtn() { return '<button type="button" class="mms-skip mms-next" data-skin-next aria-label="Next">' + nextGlyph() + '</button>'; }
  function collapseBtn() { return '<button type="button" class="mms-chev" data-skin-collapse aria-label="Collapse">▾</button>'; }
  // NOTE (v1.230): skin PICKING lives on the Settings page now (setup.js
  // renderMusicSkinPicker), not an in-player switcher (the in-player chips were
  // unreliable on-device, and a v1.229 account-menu picker often never appeared
  // because the menu builds once and not every shell loaded this module - now it's
  // loaded on every app shell). This module owns the registry + the per-device setting.
  // withThumb=Spotify (album-art thumb + stacked title/artist); else=iPod (track
  // number + title + duration + a chevron, the classic list row).
  function goRows(ctx, withThumb, list) {
    var u = artUrl(ctx);
    return (list || ctx.upNext || []).map(function (it) {
      var c = 'mms-row' + (it.state === 'current' ? ' is-current' : (it.state === 'played' ? ' is-played' : ''));
      if (withThumb) {
        return '<button type="button" class="' + c + '" data-skin-go="' + it.index + '">' +
          '<span class="mms-th">' + (u ? '<img class="art-shimmer" src="' + esc(u) + '" alt="" loading="lazy" />' : '') + '</span>' +
          '<span class="mms-rtext"><span class="mms-rt">' + esc(it.title || 'Track') + '</span>' +
          '<span class="mms-ra">' + esc(it.artist || '') + '</span></span></button>';
      }
      return '<button type="button" class="' + c + '" data-skin-go="' + it.index + '">' +
        '<span class="mms-rn">' + (it.state === 'current' ? '▶' : (it.index + 1)) + '</span>' +
        '<span class="mms-rt">' + esc(it.title || 'Track') + '</span>' +
        '<span class="mms-rd">' + esc(it.durLabel || '') + '</span>' +
        '<span class="mms-chev-r" aria-hidden="true">›</span></button>';
    }).join('');
  }

  // ---- the three skins: genuinely distinct structure, one engine ----------------
  // Every visible control is REAL (Dean's device rule): a grab-handle / MENU collapses
  // (data-skin-collapse / -menu), prev/play/next proxy to the hidden controls, and
  // Spotify's shuffle proxies to the music view's own #music-shuffle-btn. No decorative
  // stubs. All three cover the app header (CSS z-index) for a true full-screen player.

  // APPLE MUSIC - art-dominant, a blurred color-bleed of the cover fills the screen,
  // oversized title, a grab handle to dismiss, one big white play.
  function renderApple(ctx) {
    var a = ctx.track || {}; var u = artUrl(ctx);
    return (u ? '<div class="mms-bleed" style="background-image:url(&quot;' + esc(u) + '&quot;)"></div>' : '') +
      '<div class="mms-z">' +
      '<div class="mms-top"><button type="button" class="mms-grab" data-skin-collapse aria-label="Close player"></button></div>' +
      '<div class="mms-art">' + artImg(ctx) + '</div>' +
      '<div class="mms-head"><div class="mms-ttl" title="' + esc(a.title) + '">' + esc(a.title || 'Unknown track') + '</div><div class="mms-sub">' + esc(a.artist || '') + '</div></div>' +
      '<div class="mms-scrub"><div class="mms-bar" data-skin-seek role="slider" aria-label="Seek" tabindex="0"><div class="mms-fill" ' + fillW(ctx) + '></div></div><div class="mms-times">' + times(ctx) + '</div></div>' +
      '<div class="mms-transport">' + prevBtn() + playBtn(ctx) + nextBtn() + '</div>' +
      '</div>';
  }
  // SPOTIFY - dark canvas, fat title, a control row of REAL shuffle + prev/play/next,
  // and the QUEUE right there. (No fake repeat/heart.)
  function renderSpotify(ctx) {
    var a = ctx.track || {};
    return '<div class="mms-top">' + collapseBtn() + '<span class="mms-ctx">' + esc('Playing from ' + (a.album || 'album')) + '</span><span class="mms-top-spacer" aria-hidden="true"></span></div>' +
      '<div class="mms-art">' + artImg(ctx) + '</div>' +
      '<div class="mms-meta"><div class="mms-ttl">' + esc(a.title || 'Unknown track') + '</div><div class="mms-sub">' + esc(a.artist || '') + '</div></div>' +
      '<div class="mms-scrub"><div class="mms-bar" data-skin-seek role="slider" aria-label="Seek" tabindex="0"><div class="mms-fill" ' + fillW(ctx) + '></div></div><div class="mms-times">' + times(ctx) + '</div></div>' +
      '<div class="mms-transport"><button type="button" class="mms-ic mms-shuffle" data-skin-shuffle aria-label="Shuffle">' + shuffleGlyph() + '</button>' + prevBtn() + playBtn(ctx) + nextBtn() + '<span class="mms-tr-spacer" aria-hidden="true"></span></div>' +
      '<div class="mms-queue"><h4 class="mms-qh">Next in queue</h4><div class="mms-qlist">' + goRows(ctx, true) + '</div></div>';
  }
  // IPOD - the real Classic. A black-bezelled LCD with the authentic Now Playing
  // screen (cover left, title/artist/album/stars/N-of-M right, Aqua scrubber) OR the
  // song list (Select flips to it, tap a row to play); below, the gray click wheel.
  // The wheel has TAP zones AND a real rotary SCROLL (v1.233, music.js): MENU=back/exit,
  // prev/next skip tracks, bottom=play/pause; center opens the list from Now Playing and,
  // in the list, PLAYS the highlighted song. Spinning the wheel with the list open moves
  // the selection cursor song-by-song (fast flicks accelerate). In Now Playing the spin
  // sets VOLUME in the desktop pop-out (v1.235, where media.volume is settable - a volume
  // bar swaps in for the scrubber); on iPhone (the in-tab skin) it does nothing, since iOS
  // makes media.volume read-only. Play STATE shows in the status bar.
  function renderIpod(ctx) {
    var a = ctx.track || {}; var u = artUrl(ctx);
    var nof = (Number(ctx.curNum) || 0) > 0 ? (ctx.curNum + ' of ' + (ctx.total || ctx.curNum)) : '';
    return '<div class="ip-lcd"><div class="ip-lcd-in">' +
      '<div class="ip-status"><span class="ip-np">Now Playing</span>' +
      '<span class="ip-status-rt"><span class="mms-playind" aria-hidden="true">▶</span><span class="ip-batt" aria-hidden="true"><i></i></span></span></div>' +
      // --- Now Playing view ---
      '<div class="ip-npview">' +
      '<div class="ip-npmain"><div class="ip-cover">' +
      (u ? '<img class="art-shimmer" src="' + esc(u) + '" alt="" loading="lazy" />' : '') + '</div>' +
      '<div class="ip-meta">' +
      '<div class="ip-ttl">' + esc(a.title || 'Unknown track') + '</div>' +
      '<div class="ip-artist">' + esc(a.artist || '') + '</div>' +
      '<div class="ip-album">' + esc(a.album || '') + '</div>' +
      '<div class="ip-stars" aria-hidden="true">★★★★★</div>' +
      '<div class="ip-nof">' + esc(nof) + '</div></div></div>' +
      '<div class="ip-scrub"><span class="mms-pos">' + esc(ctx.posLabel || '0:00') + '</span>' +
      '<div class="ip-track"><div class="mms-fill" ' + fillW(ctx) + '></div></div>' +
      '<span class="mms-rem">' + esc(ctx.remLabel || '') + '</span></div>' +
      // v1.235: the wheel-VOLUME bar (desktop pop-out only). Hidden until you spin the wheel
      // in Now Playing; CSS swaps it in for the scrubber while adjusting (.mms-voladj), the
      // authentic iPod behavior. music.js drives .ip-vol-fill + the show/fade.
      '<div class="ip-vol" aria-hidden="true"><span class="ip-vol-ico">' + ipVolGlyph() + '</span>' +
      '<div class="ip-vol-track"><div class="ip-vol-fill"></div></div></div></div>' +
      // --- List view (Select flips to it) ---
      '<div class="ip-listview">' + goRows(ctx, false, ctx.fullList) + '</div>' +
      '</div></div>' +
      // --- the click wheel (tap zones) ---
      '<div class="ip-wheelwrap"><div class="ip-wheel">' +
      '<button type="button" class="ip-zone ip-z-menu" data-skin-menu aria-label="Menu / back">MENU</button>' +
      '<button type="button" class="ip-zone ip-z-left" data-skin-prev aria-label="Previous">' + ipRwdGlyph() + '</button>' +
      '<button type="button" class="ip-zone ip-z-right" data-skin-next aria-label="Next">' + ipFfwdGlyph() + '</button>' +
      '<button type="button" class="ip-zone ip-z-down" data-skin-play aria-label="Play or pause">' + ipPlayPauseGlyph() + '</button>' +
      '<button type="button" class="ip-center" data-skin-select aria-label="Select"></button>' +
      '</div></div>';
  }

  // Labels are CHEEKY riffs, deliberately NOT the real product/company names (Dean):
  // Cider (Apple Music - apple->cider), Nordic (Spotify - its Swedish roots),
  // Pocket Classic (iPod - "1,000 songs in your pocket"). The ids stay literal for CSS.
  var SKINS = [
    { id: 'apple', label: 'Cider', renderFull: renderApple },
    { id: 'spotify', label: 'Nordic', renderFull: renderSpotify },
    { id: 'ipod', label: 'Pocket Classic', renderFull: renderIpod },
    // v1.232 (Dean): the black iPod - identical structure (renderIpod), a `base` so the
    // panel also carries `.mms-ipod` (all the shared iPod CSS) while `.mms-ipod-black`
    // overrides only the body/wheel palette. One render, two looks.
    { id: 'ipod-black', label: 'Pocket Classic (Black)', base: 'ipod', renderFull: renderIpod },
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
    skinById: skinById,
    renderFull: function (id, ctx) { ctx = ctx || {}; return skinById(id).renderFull(ctx); },
    skinActiveFor: skinActiveFor, isMobileViewport: isMobileViewport,
    _esc: esc, _pct: pct,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FileTubeMusicSkins = api;
})();
