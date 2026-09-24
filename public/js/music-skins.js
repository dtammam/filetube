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
//     playing: bool, posSec: number, durSec: number, posLabel, remLabel,
//     artistTap: bool (set by the ENGINE from its onArtist hook; the artist line is a control only when true),
//     artistTitle: string (optional; the control's tooltip, default "Go to artist") }
//
// Action hooks (one delegated handler in music.js proxies each to a host control):
//   data-skin-play      -> click #pp-btn (gesture-safe; primes bg-audio)
//   data-skin-prev/next -> click #track-prev-btn / #track-next-btn (setTrackNav path)
//   data-skin-seek      -> a bar; click maps x -> #seek-bar value (existing seek)
//   data-skin-go="<i>"  -> jump to queue index i (the view's playAt)
//   data-skin-collapse  -> dock the player (browse-away; the mini returns you)
//   data-skin-artist    -> the artist line (v1.317): the view's onArtist (music: the in-Music artist
//                          drill, or the channel grid for a listen video in the tab)
// Skin PICKING is NOT an in-player hook: it lives on the Settings page (v1.230,
// setup.js renderMusicSkinPicker), which calls setActiveSkin(). The music view
// re-reads activeSkinId() on its next render, so the choice applies when you return.

(function () {
  var SKIN_KEY = 'ft-music-skin';
  var IDS = ['apple', 'spotify', 'ipod', 'ipod-black', 'ipod-matte', 'zune-classic'];
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
  // v1.244 (Dean): the art SLOT carries `--art` = the same image, so its CSS ::before can paint
  // a blurred self-bleed behind the whole (object-fit:contain) art - filling a non-square
  // cover's letterbox with an accent from its own colors. '' when there's no art.
  function artVar(ctx) { var u = artUrl(ctx); return u ? ' style="--art:url(&quot;' + esc(u) + '&quot;)"' : ''; }
  function fillW(ctx) { return 'style="width:' + pct(ctx.posSec, ctx.durSec) + '%"'; }
  function times(ctx) { return '<span class="mms-pos">' + esc(ctx.posLabel || '0:00') + '</span><span class="mms-rem">' + esc(ctx.remLabel || '') + '</span>'; }
  function playBtn(ctx) { return '<button type="button" class="mms-play" data-skin-play aria-label="' + (ctx.playing ? 'Pause' : 'Play') + '">' + playGlyph(ctx.playing) + '</button>'; }
  function prevBtn() { return '<button type="button" class="mms-skip mms-prev" data-skin-prev aria-label="Previous">' + prevGlyph() + '</button>'; }
  function nextBtn() { return '<button type="button" class="mms-skip mms-next" data-skin-next aria-label="Next">' + nextGlyph() + '</button>'; }
  function collapseBtn() { return '<button type="button" class="mms-chev" data-skin-collapse aria-label="Collapse">▾</button>'; }
  // v1.317 (M1, Dean: "no easy way to get to a channel's stuff in the music player"): the
  // now-playing ARTIST LINE is a real control on EVERY skin - a `data-skin-artist` button the
  // engine's delegated click proxies to the view's onArtist hook (the in-Music artist drill,
  // the "Playing from <Album>" line's model; for a listen video, the channel grid). ONE writer for all skins (Apple/Spotify .mms-sub,
  // the iPod/Zune LCD .ip-artist) so a skin can never ship the line inert (the INERT SIBLING
  // class). An EMPTY artist keeps the plain line - no focusable nothing. Gate r1 W1 (both
  // seats): the control exists ONLY where a handler does - `on` is ctx.artistTap, which the
  // ENGINE sets from the presence of its onArtist hook (podcasts pass none: their show line
  // stays the plain div, never an inert "Go to artist" button) and the view may veto per
  // track (music: a listen video with no channel, or one in the pop-out). No hook = no control.
  // Gate r2 S4: `title` (ctx.artistTitle) names the target - "Go to channel" for a listen video.
  function artistLine(cls, artist, on, title) {
    var a = (typeof artist === 'string') ? artist : '';
    if (!a || !on) return '<div class="' + cls + '">' + esc(a) + '</div>';
    return '<button type="button" class="' + cls + '" data-skin-artist title="' + esc((typeof title === 'string' && title) ? title : 'Go to artist') + '">' + esc(a) + '</button>';
  }
  // Gate r2 (qa W3, Dean's ruling): a 0/unknown length is BLANK on the Nordic thumb rows - no
  // `0:00` - M2's desktop rule. Both producers format 0 s as a zero clock (podcasts skinDur,
  // music mmssMusic), so an all-zero label IS the unknown marker; '' = no span.
  function knownDurLabel(label) {
    var s = (typeof label === 'string') ? label.trim() : '';
    return /^[0:]*$/.test(s) ? '' : s;
  }
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
          '<span class="mms-ra">' + esc(it.artist || '') + '</span></span>' +
          // v1.317 (M2): the thumb variant shows each row's own length too (a chaptered
          // album's row = that chapter's span); a 0/unknown length renders NO span.
          (knownDurLabel(it.durLabel) ? '<span class="mms-rd">' + esc(knownDurLabel(it.durLabel)) + '</span>' : '') + '</button>';
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
      '<div class="mms-art"' + artVar(ctx) + '>' + artImg(ctx) + '</div>' +
      '<div class="mms-head"><div class="mms-ttl" title="' + esc(a.title) + '">' + esc(a.title || 'Unknown track') + '</div>' + artistLine('mms-sub', a.artist, ctx.artistTap, ctx.artistTitle) + '</div>' +
      '<div class="mms-scrub"><div class="mms-bar" data-skin-seek role="slider" aria-label="Seek" tabindex="0"><div class="mms-fill" ' + fillW(ctx) + '></div></div><div class="mms-times">' + times(ctx) + '</div></div>' +
      '<div class="mms-transport">' + prevBtn() + playBtn(ctx) + nextBtn() + '</div>' +
      '</div>';
  }
  // SPOTIFY - dark canvas, fat title, a control row of REAL shuffle + prev/play/next,
  // and the QUEUE right there. (No fake repeat/heart.)
  function renderSpotify(ctx) {
    var a = ctx.track || {};
    return '<div class="mms-top">' + collapseBtn() + '<span class="mms-ctx">' + esc('Playing from ' + (a.album || 'album')) + '</span><span class="mms-top-spacer" aria-hidden="true"></span></div>' +
      '<div class="mms-art"' + artVar(ctx) + '>' + artImg(ctx) + '</div>' +
      '<div class="mms-meta"><div class="mms-ttl">' + esc(a.title || 'Unknown track') + '</div>' + artistLine('mms-sub', a.artist, ctx.artistTap, ctx.artistTitle) + '</div>' +
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
  // The shared iPod SCREEN (LCD + list) - both the Click skins and Seattle render it,
  // so the list-view flip, scrub, reflect and marquee machinery is identical; only the
  // CONTROL below it differs (click wheel vs the Zune pad + flanks).
  function ipScreen(ctx) {
    var a = ctx.track || {}; var u = artUrl(ctx);
    var nof = (Number(ctx.curNum) || 0) > 0 ? (ctx.curNum + ' of ' + (ctx.total || ctx.curNum)) : '';
    return '<div class="ip-lcd"><div class="ip-lcd-in">' +
      '<div class="ip-status"><span class="ip-np">Now Playing</span>' +
      '<span class="ip-status-rt"><span class="mms-playind" aria-hidden="true">▶</span><span class="ip-batt" aria-hidden="true"><i></i></span></span></div>' +
      // --- Now Playing view ---
      '<div class="ip-npview">' +
      '<div class="ip-npmain"><div class="ip-cover"' + artVar(ctx) + '>' +
      (u ? '<img class="art-shimmer" src="' + esc(u) + '" alt="" loading="lazy" />' : '') + '</div>' +
      '<div class="ip-meta">' +
      '<div class="ip-ttl">' + esc(a.title || 'Unknown track') + '</div>' +
      artistLine('ip-artist', a.artist, ctx.artistTap, ctx.artistTitle) +
      '<div class="ip-album">' + esc(a.album || '') + '</div>' +
      '<div class="ip-stars" aria-hidden="true">★★★★★</div>' +
      '<div class="ip-nof">' + esc(nof) + '</div></div></div>' +
      '<div class="ip-scrub"><span class="mms-pos">' + esc(ctx.posLabel || '0:00') + '</span>' +
      '<div class="ip-track" data-skin-seek role="slider" aria-label="Seek" tabindex="0"><div class="mms-fill" ' + fillW(ctx) + '></div></div>' +
      '<span class="mms-rem">' + esc(ctx.remLabel || '') + '</span></div>' +
      // v1.235's wheel-VOLUME bar, DORMANT since v1.250 (Dean retired wheel-volume - the
      // Now-Playing wheel scrubs everywhere). Nothing writes .ip-vol-fill or .mms-voladj
      // any more; the markup stays only to avoid churning every skin render this wave.
      '<div class="ip-vol" aria-hidden="true"><span class="ip-vol-ico">' + ipVolGlyph() + '</span>' +
      '<div class="ip-vol-track"><div class="ip-vol-fill"></div></div></div></div>' +
      // --- List view (Select flips to it) ---
      '<div class="ip-listview">' + goRows(ctx, false, ctx.fullList) + '</div>' +
      '</div></div>';
  }

  function renderIpod(ctx) {
    return ipScreen(ctx) +
      // --- the click wheel (tap zones) ---
      '<div class="ip-wheelwrap"><div class="ip-wheel">' +
      '<button type="button" class="ip-zone ip-z-menu" data-skin-menu aria-label="Menu / back">MENU</button>' +
      '<button type="button" class="ip-zone ip-z-left" data-skin-prev aria-label="Previous">' + ipRwdGlyph() + '</button>' +
      '<button type="button" class="ip-zone ip-z-right" data-skin-next aria-label="Next">' + ipFfwdGlyph() + '</button>' +
      '<button type="button" class="ip-zone ip-z-down" data-skin-play aria-label="Play or pause">' + ipPlayPauseGlyph() + '</button>' +
      '<button type="button" class="ip-center" data-skin-select aria-label="Select"></button>' +
      '</div></div>';
  }

  // ZUNE 30 control (Dean's reference photo): a clean chrome circle PAD - center Select
  // + invisible prev/next tap zones + the rotation gesture (the whole .ip-wheel engine
  // and its haptics bind by the class) - FLANKED by two round buttons: Back (left,
  // data-skin-menu = the exit, as the iPod's MENU) and Play/Pause (right, the shared
  // reflecting .mms-play). No printed wheel labels - that's what read as "brown iPod".
  function zncBackGlyph() { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7z"/></svg>'; }
  function renderZuneClassic(ctx) {
    return ipScreen(ctx) +
      '<div class="znc-controls">' +
      '<button type="button" class="znc-flank znc-back" data-skin-menu aria-label="Back">' + zncBackGlyph() + '</button>' +
      '<div class="ip-wheel znc-pad">' +
      '<button type="button" class="ip-zone ip-z-left" data-skin-prev aria-label="Previous"></button>' +
      '<button type="button" class="ip-zone ip-z-right" data-skin-next aria-label="Next"></button>' +
      '<button type="button" class="ip-center znc-center" data-skin-select aria-label="Select"></button>' +
      '</div>' +
      '<button type="button" class="znc-flank znc-pp mms-play" data-skin-play aria-label="' + (ctx.playing ? 'Pause' : 'Play') + '">' + playGlyph(ctx.playing) + '</button>' +
      '</div>';
  }

  // Labels are CHEEKY riffs, deliberately NOT the real product/company names (Dean):
  // Cider (Apple Music - apple->cider), Nordic (Spotify - its Swedish roots),
  // Click (iPod - the click wheel; Black + Matte are the body colorways) and Seattle
  // (the Zune's home). The ids stay literal for CSS/storage.
  // Pocket menus (2026-09-24): `menus` names the POCKET MENU style a skin carries ('click' =
  // the 6G split screen, 'seattle' = the Zune pivots). It lives ON the registry entry - the
  // one list a new skin is added to - so a new Click colorway that copies an entry carries its
  // menus with it (never a second hand-kept id list; the INERT SIBLING class). Absent = no
  // menus (Cider, Nordic): those skins have no LCD to draw a menu on.
  var SKINS = [
    { id: 'apple', label: 'Cider', renderFull: renderApple },
    { id: 'spotify', label: 'Nordic', renderFull: renderSpotify },
    { id: 'ipod', label: 'Click', menus: 'click', renderFull: renderIpod },
    // v1.232 (Dean): the black iPod - identical structure (renderIpod), a `base` so the
    // panel also carries `.mms-ipod` (all the shared iPod CSS) while `.mms-ipod-black`
    // overrides only the body/wheel palette. One render, two looks.
    { id: 'ipod-black', label: 'Click (Black)', base: 'ipod', menus: 'click', renderFull: renderIpod },
    // the matte graphite variant, sampled from Dean's reference photo - the ipod-black
    // pattern exactly: one render (renderIpod), a `base` for the shared .mms-ipod CSS,
    // and the .mms-ipod-matte palette-only override.
    { id: 'ipod-matte', label: 'Click (Matte)', base: 'ipod', menus: 'click', renderFull: renderIpod },
    // v1.260 (Dean: "the original zune with the circle wheel"): the brown Zune 30 -
    // the ipod-black pattern exactly: one render (the wheel engine, haptics and all),
    // a base for the shared .mms-ipod CSS, and a palette-only override block.
    { id: 'zune-classic', label: 'Seattle', base: 'ipod', menus: 'seattle', renderFull: renderZuneClassic },
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

  // The GATE: the mobile-music skin is active on a mobile viewport AND an audio item
  // the skin can drive - a MUSIC item (meta.isMusic) or, since v1.246, a PODCAST episode
  // (meta.resumeMode==='podcast'; player.js exposes resumeMode via getCurrentMeta, so no
  // player.js change is needed here). `meta` is player.getCurrentMeta() (or an {isMusic}/
  // {resumeMode} stand-in); `mql` lets a test inject the matchMedia result. Desktop +
  // video/book stay default.
  function isMobileViewport(mql) {
    if (typeof mql === 'boolean') return mql;
    try { return !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 768px)').matches); } catch (_) { return false; }
  }
  function skinActiveFor(meta, mql) {
    return !!(meta && (meta.isMusic || meta.resumeMode === 'podcast')) && isMobileViewport(mql);
  }

  // ==== POCKET MENUS (Dean 2026-09-24: "I'd love classic pocket skin to truly emulate.
  // Show artists, albums, songs, etc. fully interactive") ======================================
  // The Click family and Seattle carry the device's real menu tree over the WHOLE music library.
  // This module owns the PURE half: the static levels, the builders that turn the Music view's
  // own API payloads into menu rows, the list window math and the two screen renderers (Click's
  // 6G split screen, Seattle's Zune pivots). The controller (stack, cursor, MENU/Select, loads)
  // lives in skin-surface.js; the data fetches + the play seam live in music.js.
  //
  // A menu ROW (every builder returns these):
  //   { label, sub?, art?, node?: {type, key?, label?, artist?} (drills in, shows a chevron),
  //     action?: 'shuffle' | 'nowplaying', song?: true, id?, trackIndex? (into the level's tracks) }
  function menuStyle(id) { var s = BY_ID[normalizeSkinId(id)]; return (s && s.menus) || ''; }
  // Click's Music menu (the iPod order, Dean's tree) and Seattle's pivots (the Zune's own
  // lead-with-artists order). One list per style; the controller reads them, never a copy.
  var MUSIC_MENU = [
    { type: 'playlists', label: 'Playlists' }, { type: 'artists', label: 'Artists' },
    { type: 'albums', label: 'Albums' }, { type: 'songs', label: 'Songs' }, { type: 'genres', label: 'Genres' },
  ];
  var SEATTLE_PIVOTS = [
    { type: 'artists', label: 'Artists' }, { type: 'albums', label: 'Albums' }, { type: 'songs', label: 'Songs' },
    { type: 'playlists', label: 'Playlists' }, { type: 'genres', label: 'Genres' },
  ];
  // Playlists = Liked (the one real playlist, Dean: "including Liked") + the device's smart
  // playlists this library can honestly fill (no play counts exist, so no "Top 25").
  var PLAYLISTS = [
    { key: 'liked', label: 'Liked Songs' },
    { key: 'recent-added', label: 'Recently Added' },
    { key: 'recent-played', label: 'Recently Played' },
  ];
  function menuPivots(style) { return style === 'seattle' ? SEATTLE_PIVOTS.slice() : []; }
  var ROOT_TITLE = { click: 'Click', seattle: 'Seattle' }; // the cheeky name, never the product's (Dean)
  var TYPE_TITLE = { music: 'Music', playlists: 'Playlists', artists: 'Artists', albums: 'Albums', songs: 'Songs', genres: 'Genres' };
  function menuTitle(node, style) {
    var n = node || {};
    if (n.type === 'main') return ROOT_TITLE[style] || 'Menu';
    if (TYPE_TITLE[n.type]) return TYPE_TITLE[n.type];
    return (typeof n.label === 'string' && n.label) ? n.label : 'Songs';
  }
  // The STATIC levels (null for a level whose rows come from the library).
  function menuStaticItems(node, opts) {
    var t = node && node.type;
    if (t === 'main') {
      var rows = [{ label: 'Music', node: { type: 'music' } }, { label: 'Shuffle Songs', action: 'shuffle' }];
      if (opts && opts.hasCurrent) rows.push({ label: 'Now Playing', action: 'nowplaying' });
      return rows;
    }
    if (t === 'music') return MUSIC_MENU.map(function (m) { return { label: m.label, node: { type: m.type } }; });
    if (t === 'playlists') return PLAYLISTS.map(function (p) { return { label: p.label, node: { type: 'playlist', key: p.key, label: p.label } }; });
    return null;
  }
  // The builders take the VIEW's art rule (`artFor(id, explicitArtUrl)` - music.js passes its one
  // musicArtUrl) so the menus can never drift from the art the rest of Music shows.
  function artVia(artFor, id, explicit) {
    try { return (typeof artFor === 'function' && id) ? (artFor(id, explicit) || '') : ''; } catch (_) { return ''; }
  }
  function menuArtistItems(artists, artFor) {
    return (Array.isArray(artists) ? artists : []).map(function (a) {
      var name = (a && typeof a.artist === 'string') ? a.artist : '';
      var ids = (a && Array.isArray(a.artIds)) ? a.artIds : [];
      return {
        label: name || 'Unknown Artist',
        node: { type: 'artist', key: name, label: name || 'Unknown Artist' },
        art: (a && typeof a.avatarUrl === 'string' && a.avatarUrl) ? a.avatarUrl : artVia(artFor, ids[0]),
      };
    });
  }
  function menuAlbumItems(albums, artFor) {
    return (Array.isArray(albums) ? albums : []).map(function (a) {
      var name = (a && typeof a.album === 'string' && a.album) ? a.album : 'Unknown Album';
      return {
        label: name, sub: (a && typeof a.artist === 'string') ? a.artist : '',
        node: { type: 'album', key: (a && a.albumKey) || '', label: name },
        art: artVia(artFor, a && a.artId),
      };
    });
  }
  function menuSongItems(tracks, artFor) {
    return (Array.isArray(tracks) ? tracks : []).map(function (t, i) {
      return {
        label: (t && t.title) || 'Unknown Song', sub: (t && t.artist) || '',
        id: t && t.id, song: true, trackIndex: i, art: artVia(artFor, t && t.id, t && t.artUrl),
      };
    });
  }
  // An artist's level: their albums (first-seen order of the album-ordered track list), led by
  // "All Songs" when there is more than one album (the device's own row).
  function menuArtistAlbumItems(tracks, artistNode, artFor) {
    var node = artistNode || {};
    var seen = Object.create(null);
    var albums = [];
    (Array.isArray(tracks) ? tracks : []).forEach(function (t) {
      if (!t) return;
      var k = t.albumKey || '';
      if (seen[k]) return;
      seen[k] = true;
      var name = (typeof t.album === 'string' && t.album) ? t.album : 'Unknown Album';
      albums.push({ label: name, node: { type: 'artistAlbum', key: k, artist: node.key || '', label: name }, art: artVia(artFor, t.id, t.artUrl) });
    });
    if (albums.length > 1) albums.unshift({ label: 'All Songs', node: { type: 'artistAll', artist: node.key || '', label: node.label || 'All Songs' }, art: albums[0].art });
    return albums;
  }
  // Genres: every distinct (trimmed) genre tag, name order, with the untagged tracks gathered
  // under "Unknown Genre" last. Genre > Songs (Dean: "or Genre > Songs if the data is thin") -
  // the projected library's genre is the uploader's category, one or two values for most shelves.
  function genreOf(t) { return (t && typeof t.genre === 'string') ? t.genre.trim() : ''; }
  function menuGenreItems(tracks) {
    var names = Object.create(null);
    var unknown = false;
    (Array.isArray(tracks) ? tracks : []).forEach(function (t) {
      var g = genreOf(t);
      if (g) names[g] = true; else unknown = true;
    });
    var rows = Object.keys(names).sort(function (a, b) { return a.localeCompare(b, undefined, { sensitivity: 'base' }); })
      .map(function (g) { return { label: g, node: { type: 'genre', key: g, label: g } }; });
    if (unknown) rows.push({ label: 'Unknown Genre', node: { type: 'genre', key: '', label: 'Unknown Genre' } });
    return rows;
  }
  function tracksOfGenre(tracks, key) {
    var k = typeof key === 'string' ? key : '';
    return (Array.isArray(tracks) ? tracks : []).filter(function (t) { return genreOf(t) === k; });
  }
  function tracksOfAlbum(tracks, key) {
    return (Array.isArray(tracks) ? tracks : []).filter(function (t) { return t && (t.albumKey || '') === key; });
  }
  // The rendered WINDOW of a long list: only the rows near the viewport exist in the DOM (a
  // library can have thousands of songs). With no layout yet (rowH/viewH unknown - the first
  // frame, or jsdom) it falls back to a fixed span around the cursor, so the cursor row is
  // always addressable.
  var MENU_SPAN = 40;
  function menuWindow(total, cursor, rowH, scrollTop, viewH, overscan) {
    var n = Math.max(0, Math.floor(Number(total) || 0));
    var ov = Math.max(0, Math.floor(Number(overscan) || 8));
    if (!(rowH > 0) || !(viewH > 0)) {
      var c = Math.max(0, Math.min(n - 1, Math.floor(Number(cursor) || 0)));
      var s0 = Math.max(0, Math.min(Math.max(0, n - MENU_SPAN), c - MENU_SPAN / 2));
      return { start: s0, end: Math.min(n, s0 + MENU_SPAN) };
    }
    var st = Math.max(0, Number(scrollTop) || 0);
    var s = Math.max(0, Math.floor(st / rowH) - ov);
    var e = Math.min(n, Math.ceil((st + viewH) / rowH) + ov);
    return { start: Math.min(s, e), end: e };
  }
  var MENU_SKELETON_ROWS = 6;
  // The list body: two spacer pads + the windowed rows (each carrying its absolute index).
  // v = { style, items, cursor, currentId, start, end, rowH, state, emptyText }
  function renderMenuList(v) {
    var items = v.items || [];
    if (v.state === 'loading') {
      var sk = '';
      for (var k = 0; k < MENU_SKELETON_ROWS; k++) sk += '<div class="ipm-row ipm-skel" aria-hidden="true"><span class="ipm-skel-bar skeleton-shimmer"></span></div>';
      return sk;
    }
    if (v.state === 'error') return '<div class="ipm-note" role="status">Couldn’t load this list. Press the center to try again.</div>';
    if (!items.length) return '<div class="ipm-note" role="status">' + esc(v.emptyText || 'Nothing here yet.') + '</div>';
    var rowH = Number(v.rowH) || 0;
    var html = '<div class="ipm-pad" style="height:' + (v.start * rowH) + 'px"></div>';
    for (var i = v.start; i < v.end; i++) {
      var it = items[i];
      var cls = 'ipm-row' + (i === v.cursor ? ' is-cursor' : '') + (it.node ? ' has-chev' : '') +
        (v.currentId && it.id === v.currentId ? ' is-current' : '');
      html += '<button type="button" class="' + cls + '" data-skin-mi="' + i + '" role="option" aria-selected="' + (i === v.cursor ? 'true' : 'false') + '">' +
        '<span class="ipm-lbl">' + esc(it.label) + '</span>' +
        (v.style === 'seattle' && it.sub ? '<span class="ipm-sub">' + esc(it.sub) + '</span>' : '') +
        (v.currentId && it.id === v.currentId ? '<span class="ipm-now" aria-label="Now playing">' + ipVolGlyph() + '</span>' : '') +
        (it.node && v.style !== 'seattle' ? '<span class="ipm-chev" aria-hidden="true">›</span>' : '') +
        '</button>';
    }
    html += '<div class="ipm-pad" style="height:' + (Math.max(0, items.length - v.end) * rowH) + 'px"></div>';
    return html;
  }
  // The whole menu screen for the LCD. Click: the 6th/7th-gen SPLIT SCREEN - the list on the
  // left half, the highlighted item's art easing in on the right (`art`, applied by the
  // controller so a fast wheel does not thrash the image). Seattle: big lowercase type, a
  // pivot strip on the Music level (the active pivot leads, the rest trail off - the Zune
  // wraps), a dim title over a drilled list, and nothing at all over the Main Menu.
  // v = renderMenuList's v + { title, root, pivots?: [labels], pivotIdx, art, artIn }
  function renderMenuView(style, v) {
    // gate r1 K5: a Seattle list whose rows carry a sub-line (albums, songs) is a TWO-LINE list -
    // taller rows with title + sub packed at the top, so each sub-line reads with ITS title.
    var twoLine = style === 'seattle' && (v.items || []).some(function (it) { return it && it.sub; });
    var list = '<div class="ipm-list' + (twoLine ? ' ipm-2l' : '') + '" data-skin-menulist role="listbox" aria-label="' + esc(v.title || 'Menu') + '"' +
      (style === 'seattle' && v.pivots ? ' data-skin-swipe' : '') + '>' + renderMenuList(Object.assign({}, v, { style: style })) + '</div>';
    if (style === 'seattle') {
      var head = '';
      if (v.pivots && v.pivots.length) {
        var n = v.pivots.length;
        var strip = '';
        for (var j = 0; j < n; j++) {
          var k = (v.pivotIdx + j) % n;
          strip += '<button type="button" class="ipm-pv' + (j === 0 ? ' is-on' : '') + '" data-skin-pivot="' + k + '"' + (j === 0 ? ' aria-current="true"' : '') + '>' + esc(v.pivots[k]) + '</button>';
        }
        head = '<div class="ipm-pivots">' + strip + '</div>';
      } else if (!v.root) {
        head = '<div class="ipm-title">' + esc(v.title || '') + '</div>';
      }
      return '<div class="ip-menuview ipm-seattle' + (v.root ? ' ipm-root' : '') + '">' + head + list + '</div>';
    }
    var art = v.art ? '<img class="ipm-art-img' + (v.artIn ? ' is-in' : '') + '" src="' + esc(v.art) + '" alt="" />' : '';
    return '<div class="ip-menuview ipm-click"><div class="ipm-split">' + list +
      '<div class="ipm-art" aria-hidden="true">' + art + '</div></div></div>';
  }

  var api = {
    SKIN_KEY: SKIN_KEY, IDS: IDS, DEFAULT_ID: DEFAULT_ID, SKINS: SKINS,
    normalizeSkinId: normalizeSkinId, activeSkinId: activeSkinId, setActiveSkin: setActiveSkin,
    skinById: skinById,
    renderFull: function (id, ctx) { ctx = ctx || {}; return skinById(id).renderFull(ctx); },
    skinActiveFor: skinActiveFor, isMobileViewport: isMobileViewport,
    // the pocket menus (the pure half - see the block above).
    menuStyle: menuStyle, menuPivots: menuPivots, menuTitle: menuTitle, menuStaticItems: menuStaticItems,
    menuArtistItems: menuArtistItems, menuAlbumItems: menuAlbumItems, menuSongItems: menuSongItems,
    menuArtistAlbumItems: menuArtistAlbumItems, menuGenreItems: menuGenreItems,
    tracksOfGenre: tracksOfGenre, tracksOfAlbum: tracksOfAlbum,
    menuWindow: menuWindow, renderMenuList: renderMenuList, renderMenuView: renderMenuView,
    _esc: esc, _pct: pct,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FileTubeMusicSkins = api;
})();
