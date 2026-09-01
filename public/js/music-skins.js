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
//   data-skin-set="<id>" -> pick a skin (the switcher); the view persists + re-renders

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
  // The skin SWITCHER (the "themes" picker) - one active id per render.
  function switcher(active) {
    return '<div class="mms-skinsw" role="tablist" aria-label="Player skin">' + SKINS.map(function (s) {
      return '<button type="button" class="mms-sw' + (s.id === active ? ' is-on' : '') + '" data-skin-set="' + s.id + '"' +
        ' aria-pressed="' + (s.id === active ? 'true' : 'false') + '">' + esc(s.label) + '</button>';
    }).join('') + '</div>';
  }
  // withThumb=Spotify (album-art thumb + stacked title/artist); else=iPod (track
  // number + title + duration + a chevron, the classic list row).
  function goRows(ctx, withThumb) {
    var u = artUrl(ctx);
    return (ctx.upNext || []).map(function (it) {
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
  // APPLE MUSIC - art-dominant, a blurred color-bleed of the cover fills the screen,
  // oversized title, airy minimal chrome (no visible queue - swipe-for-queue idiom).
  function renderApple(ctx) {
    var a = ctx.track || {}; var u = artUrl(ctx);
    return (u ? '<div class="mms-bleed" style="background-image:url(&quot;' + esc(u) + '&quot;)"></div>' : '') +
      '<div class="mms-z">' +
      '<div class="mms-top">' + collapseBtn() + switcher(ctx.skinId) + '<span class="mms-chev mms-chev-ghost" aria-hidden="true">⋯</span></div>' +
      '<div class="mms-art">' + artImg(ctx) + '</div>' +
      '<div class="mms-head"><div class="mms-htext"><div class="mms-ttl" title="' + esc(a.title) + '">' + esc(a.title || 'Unknown track') + '</div><div class="mms-sub">' + esc(a.artist || '') + '</div></div><span class="mms-dots" aria-hidden="true">⋯</span></div>' +
      '<div class="mms-scrub"><div class="mms-bar" data-skin-seek role="slider" aria-label="Seek" tabindex="0"><div class="mms-fill" ' + fillW(ctx) + '></div></div><div class="mms-times">' + times(ctx) + '</div></div>' +
      '<div class="mms-transport">' + prevBtn() + playBtn(ctx) + nextBtn() + '</div>' +
      '<div class="mms-foot" aria-hidden="true"><span>🔀</span><span>◎</span><span>≡</span></div>' +
      '</div>';
  }
  // SPOTIFY - dark, a tall color canvas, a fat black title, a full control row
  // (green circular play flanked by shuffle/repeat), and the QUEUE right there.
  function renderSpotify(ctx) {
    var a = ctx.track || {};
    return '<div class="mms-top">' + collapseBtn() + '<span class="mms-ctx">' + esc('Playing from ' + (a.album || 'album')) + '</span><span class="mms-chev mms-chev-ghost" aria-hidden="true">⋯</span></div>' +
      switcher(ctx.skinId) +
      '<div class="mms-art">' + artImg(ctx) + '</div>' +
      '<div class="mms-meta"><div class="mms-htext"><div class="mms-ttl">' + esc(a.title || 'Unknown track') + '</div><div class="mms-sub">' + esc(a.artist || '') + '</div></div><span class="mms-heart" aria-hidden="true">✚</span></div>' +
      '<div class="mms-scrub"><div class="mms-bar" data-skin-seek role="slider" aria-label="Seek" tabindex="0"><div class="mms-fill" ' + fillW(ctx) + '></div></div><div class="mms-times">' + times(ctx) + '</div></div>' +
      '<div class="mms-transport"><button type="button" class="mms-ic is-on" aria-label="Shuffle">🔀</button>' + prevBtn() + playBtn(ctx) + nextBtn() + '<button type="button" class="mms-ic" aria-label="Repeat">🔁</button></div>' +
      '<div class="mms-queue"><h4 class="mms-qh">Next in queue</h4><div class="mms-qlist">' + goRows(ctx, true) + '</div></div>';
  }
  // IPOD - a real departure: brushed-aluminum bar, a framed cover, centered classic
  // type, a retro transport CLUSTER, a scrubber with a chrome KNOB, the classic
  // blue-highlight tracklist + an "N of M" footer.
  function renderIpod(ctx) {
    var a = ctx.track || {};
    return '<div class="mms-albar"><button type="button" class="mms-albar-b" data-skin-collapse aria-label="Collapse">‹</button><span class="mms-albar-t">Now Playing</span><span class="mms-albar-b" aria-hidden="true">▭</span></div>' +
      '<div class="mms-body">' + switcher(ctx.skinId) +
      '<div class="mms-art">' + artImg(ctx) + '</div>' +
      '<div class="mms-ttl">' + esc(a.title || 'Unknown track') + '</div>' +
      '<div class="mms-sub">' + esc([a.artist, a.album].filter(Boolean).join(' — ')) + '</div>' +
      '<div class="mms-scrub"><span class="mms-pos">' + esc(ctx.posLabel || '0:00') + '</span>' +
      '<div class="mms-bar" data-skin-seek role="slider" aria-label="Seek" tabindex="0"><div class="mms-fill" ' + fillW(ctx) + '></div><div class="mms-knob" style="left:' + pct(ctx.posSec, ctx.durSec) + '%"></div></div>' +
      '<span class="mms-rem">' + esc(ctx.remLabel || '') + '</span></div>' +
      '<div class="mms-cluster">' + prevBtn() + playBtn(ctx) + nextBtn() + '</div>' +
      '<div class="mms-list">' + goRows(ctx, false) + '</div>' +
      '<div class="mms-foot">' + ((Number(ctx.curNum) || 0) > 0 ? (ctx.curNum + ' of ' + (ctx.total || ctx.curNum)) : '') + '</div>' +
      '</div>';
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
    skinById: skinById,
    renderFull: function (id, ctx) { ctx = ctx || {}; ctx.skinId = normalizeSkinId(id); return skinById(id).renderFull(ctx); },
    skinActiveFor: skinActiveFor, isMobileViewport: isMobileViewport,
    _esc: esc, _pct: pct,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FileTubeMusicSkins = api;
})();
