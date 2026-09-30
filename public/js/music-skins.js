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
  var DEFAULT_ID = 'apple';
  // v1.332 (Dean, D1): a RETIRED id maps to the skin that replaced it, never to the default. The
  // removed Zune skin's users land on Click (a device with it saved, or the synced pref), and the
  // active-skin read rewrites the stored value once so the synced pref converges.
  var LEGACY_IDS = { 'zune-classic': 'ipod' };

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
  // UI pass S7 (F60): the skins' small MARKS are drawn, never text symbols. A text play triangle (U+25B6)
  // turns into a colour emoji on iOS and ignores `color`, and the status bar's play / pause-bars swap
  // changed its width (a different advance per symbol). Each mark is an SVG path filled with
  // currentColor, sized by its container's --mms-g-size (the text role it replaces, style.css).
  // The play / pause pair is BOTH glyphs stacked in one cell (the reflect toggles is-paused), so
  // the status bar never re-measures when the state flips.
  var SK_GLYPH = {
    play: 'M8 5v14l11-7z',
    pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
    chevDown: 'M7 9.5l5 5 5-5z',
    chevRight: 'M9.5 7l5 5-5 5z',
    check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
    star: 'M12 17.3 18.2 21l-1.6-7L22 9.2l-7.2-.6L12 2 9.2 8.6 2 9.2 7.4 14l-1.6 7z',
  };
  function skGlyph(name) {
    return '<svg class="mms-g mms-g-' + name + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + SK_GLYPH[name] + '"/></svg>';
  }
  function playIndHtml(paused) {
    return '<span class="mms-playind' + (paused ? ' is-paused' : '') + '" aria-hidden="true">' + skGlyph('play') + skGlyph('pause') + '</span>';
  }
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
  function collapseBtn() { return '<button type="button" class="mms-chev" data-skin-collapse aria-label="Collapse">' + skGlyph('chevDown') + '</button>'; }
  // v1.317 (M1, Dean: "no easy way to get to a channel's stuff in the music player"): the
  // now-playing ARTIST LINE is a real control on EVERY skin - a `data-skin-artist` button the
  // engine's delegated click proxies to the view's onArtist hook (the in-Music artist drill,
  // the "Playing from <Album>" line's model; for a listen video, the channel grid). ONE writer for all skins (Apple/Spotify .mms-sub,
  // the Click LCD .ip-artist) so a skin can never ship the line inert (the INERT SIBLING
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
        '<span class="mms-rn">' + (it.state === 'current' ? skGlyph('play') : (it.index + 1)) + '</span>' +
        '<span class="mms-rt">' + esc(it.title || 'Track') + '</span>' +
        '<span class="mms-rd">' + esc(it.durLabel || '') + '</span>' +
        '<span class="mms-chev-r" aria-hidden="true">' + skGlyph('chevRight') + '</span></button>';
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
  // The shared iPod SCREEN (LCD + list) - every Click colorway renders it, so the list-view
  // flip, scrub, reflect and marquee machinery is identical.
  function ipScreen(ctx) {
    var a = ctx.track || {}; var u = artUrl(ctx);
    var nof = (Number(ctx.curNum) || 0) > 0 ? (ctx.curNum + ' of ' + (ctx.total || ctx.curNum)) : '';
    return '<div class="ip-lcd"><div class="ip-lcd-in">' +
      '<div class="ip-status"><span class="ip-np">Now Playing</span>' +
      '<span class="ip-status-rt">' + playIndHtml(ctx.playing === false) + '<span class="ip-batt" aria-hidden="true"><i></i></span></span></div>' +
      // --- Now Playing view ---
      '<div class="ip-npview">' +
      '<div class="ip-npmain"><div class="ip-cover"' + artVar(ctx) + '>' +
      (u ? '<img class="art-shimmer" src="' + esc(u) + '" alt="" loading="lazy" />' : '') + '</div>' +
      '<div class="ip-meta">' +
      '<div class="ip-ttl">' + esc(a.title || 'Unknown track') + '</div>' +
      artistLine('ip-artist', a.artist, ctx.artistTap, ctx.artistTitle) +
      '<div class="ip-album">' + esc(a.album || '') + '</div>' +
      '<div class="ip-stars" aria-hidden="true">' + skGlyph('star') + skGlyph('star') + skGlyph('star') + skGlyph('star') + skGlyph('star') + '</div>' +
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

  // Labels: the iPod colorways use real model names ("Nano 4G Orange (2008)", Dean 2026-09-29);
  // Cider (Apple Music - apple->cider) and Nordic (Spotify - its Swedish roots) stay CHEEKY riffs,
  // deliberately NOT the real product/company names. The ids stay literal for CSS/storage.
  // Pocket menus (2026-09-24): `menus` names the POCKET MENU style a skin carries ('click' =
  // the 6G split screen). It lives ON the registry entry - the
  // one list a new skin is added to - so a new Click colorway that copies an entry carries its
  // menus with it (never a second hand-kept id list; the INERT SIBLING class). Absent = no
  // menus (Cider, Nordic): those skins have no LCD to draw a menu on.
  var SKINS = [
    { id: 'apple', label: 'Cider', renderFull: renderApple },
    { id: 'spotify', label: 'Nordic', renderFull: renderSpotify },
    { id: 'ipod-2004', label: 'Classic 4G White (2004)', line: 'classic', gen: 4, year: '2004', color: 'White', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-encore', label: 'Classic 4G Special Edition (2004)', line: 'classic', gen: 4, year: '2004', color: 'Special Edition', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod', label: 'Classic 5G White (2005)', line: 'classic', gen: 5, year: '2005', color: 'White', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-black', label: 'Classic 5G Black (2005)', line: 'classic', gen: 5, year: '2005', color: 'Black', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-silver', label: 'Classic 6G Silver (2007)', line: 'classic', gen: 6, year: '2007', color: 'Silver', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-charcoal', label: 'Classic 6G Black (2007)', line: 'classic', gen: 6, year: '2007', color: 'Black', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-matte', label: 'Classic 6G Black (2008)', line: 'classic', gen: 6, year: '2008', color: 'Black', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-frost', label: 'Mini 1G Silver (2004)', line: 'mini', gen: 1, year: '2004', color: 'Silver', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-gold', label: 'Mini 1G Gold (2004)', line: 'mini', gen: 1, year: '2004', color: 'Gold', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-sky', label: 'Mini 1G Blue (2004)', line: 'mini', gen: 1, year: '2004', color: 'Blue', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-blush', label: 'Mini 1G Pink (2004)', line: 'mini', gen: 1, year: '2004', color: 'Pink', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-olive', label: 'Mini 1G Green (2004)', line: 'mini', gen: 1, year: '2004', color: 'Green', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-blue', label: 'Mini 2G Blue (2005)', line: 'mini', gen: 2, year: '2005', color: 'Blue', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-green', label: 'Mini 2G Green (2005)', line: 'mini', gen: 2, year: '2005', color: 'Green', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-pink', label: 'Mini 2G Pink (2005)', line: 'mini', gen: 2, year: '2005', color: 'Pink', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-mini2-silver', label: 'Mini 2G Silver (2005)', line: 'mini', gen: 2, year: '2005', color: 'Silver', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-lime', label: 'Nano 2G Green (2006)', line: 'nano', gen: 2, year: '2006', color: 'Green', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-cobalt', label: 'Nano 2G Blue (2006)', line: 'nano', gen: 2, year: '2006', color: 'Blue', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-magenta', label: 'Nano 2G Pink (2006)', line: 'nano', gen: 2, year: '2006', color: 'Pink', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-red', label: 'Nano 2G Red (2006)', line: 'nano', gen: 2, year: '2006', color: 'Red', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano2-silver', label: 'Nano 2G Silver (2006)', line: 'nano', gen: 2, year: '2006', color: 'Silver', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano2-black', label: 'Nano 2G Black (2006)', line: 'nano', gen: 2, year: '2006', color: 'Black', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano3-silver', label: 'Nano 3G Silver (2007)', line: 'nano', gen: 3, year: '2007', color: 'Silver', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano3-blue', label: 'Nano 3G Blue (2007)', line: 'nano', gen: 3, year: '2007', color: 'Blue', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano3-green', label: 'Nano 3G Green (2007)', line: 'nano', gen: 3, year: '2007', color: 'Green', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano3-red', label: 'Nano 3G Red (2007)', line: 'nano', gen: 3, year: '2007', color: 'Red', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-raspberry', label: 'Nano 3G Pink (2008)', line: 'nano', gen: 3, year: '2008', color: 'Pink', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano3-black', label: 'Nano 3G Black (2007)', line: 'nano', gen: 3, year: '2007', color: 'Black', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano4-blue', label: 'Nano 4G Blue (2008)', line: 'nano', gen: 4, year: '2008', color: 'Blue', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-violet', label: 'Nano 4G Purple (2008)', line: 'nano', gen: 4, year: '2008', color: 'Purple', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano4-orange', label: 'Nano 4G Orange (2008)', line: 'nano', gen: 4, year: '2008', color: 'Orange', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-yellow', label: 'Nano 4G Yellow (2008)', line: 'nano', gen: 4, year: '2008', color: 'Yellow', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano4-silver', label: 'Nano 4G Silver (2008)', line: 'nano', gen: 4, year: '2008', color: 'Silver', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano4-green', label: 'Nano 4G Green (2008)', line: 'nano', gen: 4, year: '2008', color: 'Green', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano4-pink', label: 'Nano 4G Pink (2008)', line: 'nano', gen: 4, year: '2008', color: 'Pink', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano4-black', label: 'Nano 4G Black (2008)', line: 'nano', gen: 4, year: '2008', color: 'Black', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano4-red', label: 'Nano 4G Red (2008)', line: 'nano', gen: 4, year: '2008', color: 'Red', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano5-green', label: 'Nano 5G Green (2009)', line: 'nano', gen: 5, year: '2009', color: 'Green', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano5-orange', label: 'Nano 5G Orange (2009)', line: 'nano', gen: 5, year: '2009', color: 'Orange', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano5-pink', label: 'Nano 5G Pink (2009)', line: 'nano', gen: 5, year: '2009', color: 'Pink', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano5-silver', label: 'Nano 5G Silver (2009)', line: 'nano', gen: 5, year: '2009', color: 'Silver', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano5-blue', label: 'Nano 5G Blue (2009)', line: 'nano', gen: 5, year: '2009', color: 'Blue', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano5-purple', label: 'Nano 5G Purple (2009)', line: 'nano', gen: 5, year: '2009', color: 'Purple', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano5-yellow', label: 'Nano 5G Yellow (2009)', line: 'nano', gen: 5, year: '2009', color: 'Yellow', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano5-black', label: 'Nano 5G Black (2009)', line: 'nano', gen: 5, year: '2009', color: 'Black', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano5-red', label: 'Nano 5G Red (2009)', line: 'nano', gen: 5, year: '2009', color: 'Red', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano6-green', label: 'Nano 6G Green (2010)', line: 'nano', gen: 6, year: '2010', color: 'Green', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano6-orange', label: 'Nano 6G Orange (2010)', line: 'nano', gen: 6, year: '2010', color: 'Orange', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano6-pink', label: 'Nano 6G Pink (2010)', line: 'nano', gen: 6, year: '2010', color: 'Pink', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano6-silver', label: 'Nano 6G Silver (2010)', line: 'nano', gen: 6, year: '2010', color: 'Silver', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano6-graphite', label: 'Nano 6G Graphite (2010)', line: 'nano', gen: 6, year: '2010', color: 'Graphite', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano6-blue', label: 'Nano 6G Blue (2010)', line: 'nano', gen: 6, year: '2010', color: 'Blue', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano6-red', label: 'Nano 6G Red (2010)', line: 'nano', gen: 6, year: '2010', color: 'Red', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano7-pink', label: 'Nano 7G Pink (2012)', line: 'nano', gen: 7, year: '2012', color: 'Pink', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano7-yellow', label: 'Nano 7G Yellow (2012)', line: 'nano', gen: 7, year: '2012', color: 'Yellow', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano7-blue', label: 'Nano 7G Blue (2015)', line: 'nano', gen: 7, year: '2015', color: 'Blue', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano7-green', label: 'Nano 7G Green (2012)', line: 'nano', gen: 7, year: '2012', color: 'Green', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano7-purple', label: 'Nano 7G Purple (2012)', line: 'nano', gen: 7, year: '2012', color: 'Purple', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano7-slate', label: 'Nano 7G Slate (2012)', line: 'nano', gen: 7, year: '2012', color: 'Slate', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano7-red', label: 'Nano 7G Red (2012)', line: 'nano', gen: 7, year: '2012', color: 'Red', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano7-spacegray', label: 'Nano 7G Space Gray (2013)', line: 'nano', gen: 7, year: '2013', color: 'Space Gray', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano7-gold', label: 'Nano 7G Gold (2015)', line: 'nano', gen: 7, year: '2015', color: 'Gold', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano7-blue-2012', label: 'Nano 7G Blue (2012)', line: 'nano', gen: 7, year: '2012', color: 'Blue', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano7-silver', label: 'Nano 7G Silver (2012)', line: 'nano', gen: 7, year: '2012', color: 'Silver', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano7-spacegray-2015', label: 'Nano 7G Space Gray (2015)', line: 'nano', gen: 7, year: '2015', color: 'Space Gray', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano7-pink-2015', label: 'Nano 7G Pink (2015)', line: 'nano', gen: 7, year: '2015', color: 'Pink', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano7-red-2015', label: 'Nano 7G Red (2015)', line: 'nano', gen: 7, year: '2015', color: 'Red', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle2-purple', label: 'Shuffle 2G Purple (2007)', line: 'shuffle', gen: 2, year: '2007', color: 'Purple', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle2-green', label: 'Shuffle 2G Green (2008)', line: 'shuffle', gen: 2, year: '2008', color: 'Green', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle2-gold', label: 'Shuffle 2G Gold (2009)', line: 'shuffle', gen: 2, year: '2009', color: 'Gold', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle2-silver', label: 'Shuffle 2G Silver (2005)', line: 'shuffle', gen: 2, year: '2005', color: 'Silver', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle2-pink', label: 'Shuffle 2G Pink (2007)', line: 'shuffle', gen: 2, year: '2007', color: 'Pink', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle2-green-2007', label: 'Shuffle 2G Green (2007)', line: 'shuffle', gen: 2, year: '2007', color: 'Green', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle2-blue', label: 'Shuffle 2G Blue (2007)', line: 'shuffle', gen: 2, year: '2007', color: 'Blue', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle2-orange', label: 'Shuffle 2G Orange (2007)', line: 'shuffle', gen: 2, year: '2007', color: 'Orange', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle2-teal', label: 'Shuffle 2G Teal (2007)', line: 'shuffle', gen: 2, year: '2007', color: 'Teal', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle2-red', label: 'Shuffle 2G Red (2007)', line: 'shuffle', gen: 2, year: '2007', color: 'Red', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle2-lightgreen', label: 'Shuffle 2G Light Green (2007)', line: 'shuffle', gen: 2, year: '2007', color: 'Light Green', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle2-blue-2008', label: 'Shuffle 2G Blue (2008)', line: 'shuffle', gen: 2, year: '2008', color: 'Blue', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle2-red-2008', label: 'Shuffle 2G Red (2008)', line: 'shuffle', gen: 2, year: '2008', color: 'Red', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle2-pink-2008', label: 'Shuffle 2G Pink (2008)', line: 'shuffle', gen: 2, year: '2008', color: 'Pink', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle3-pink', label: 'Shuffle 3G Pink (2009)', line: 'shuffle', gen: 3, year: '2009', color: 'Pink', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle3-blue', label: 'Shuffle 3G Blue (2009)', line: 'shuffle', gen: 3, year: '2009', color: 'Blue', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle3-silver', label: 'Shuffle 3G Silver (2009)', line: 'shuffle', gen: 3, year: '2009', color: 'Silver', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle3-black', label: 'Shuffle 3G Black (2009)', line: 'shuffle', gen: 3, year: '2009', color: 'Black', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle3-green', label: 'Shuffle 3G Green (2009)', line: 'shuffle', gen: 3, year: '2009', color: 'Green', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle3-stainlesssteel', label: 'Shuffle 3G Stainless Steel (2009)', line: 'shuffle', gen: 3, year: '2009', color: 'Stainless Steel', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-blue', label: 'Shuffle 4G Blue (2010)', line: 'shuffle', gen: 4, year: '2010', color: 'Blue', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-silver', label: 'Shuffle 4G Silver (2010)', line: 'shuffle', gen: 4, year: '2010', color: 'Silver', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-green', label: 'Shuffle 4G Green (2010)', line: 'shuffle', gen: 4, year: '2010', color: 'Green', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-orange', label: 'Shuffle 4G Orange (2010)', line: 'shuffle', gen: 4, year: '2010', color: 'Orange', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-pink', label: 'Shuffle 4G Pink (2010)', line: 'shuffle', gen: 4, year: '2010', color: 'Pink', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-pink-2012', label: 'Shuffle 4G Pink (2012)', line: 'shuffle', gen: 4, year: '2012', color: 'Pink', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-yellow', label: 'Shuffle 4G Yellow (2012)', line: 'shuffle', gen: 4, year: '2012', color: 'Yellow', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-blue-2012', label: 'Shuffle 4G Blue (2012)', line: 'shuffle', gen: 4, year: '2012', color: 'Blue', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-green-2012', label: 'Shuffle 4G Green (2012)', line: 'shuffle', gen: 4, year: '2012', color: 'Green', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-purple', label: 'Shuffle 4G Purple (2012)', line: 'shuffle', gen: 4, year: '2012', color: 'Purple', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-silver-2012', label: 'Shuffle 4G Silver (2012)', line: 'shuffle', gen: 4, year: '2012', color: 'Silver', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-slate', label: 'Shuffle 4G Slate (2012)', line: 'shuffle', gen: 4, year: '2012', color: 'Slate', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-red', label: 'Shuffle 4G Red (2012)', line: 'shuffle', gen: 4, year: '2012', color: 'Red', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-spacegray', label: 'Shuffle 4G Space Gray (2013)', line: 'shuffle', gen: 4, year: '2013', color: 'Space Gray', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-gold', label: 'Shuffle 4G Gold (2015)', line: 'shuffle', gen: 4, year: '2015', color: 'Gold', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-spacegray-2015', label: 'Shuffle 4G Space Gray (2015)', line: 'shuffle', gen: 4, year: '2015', color: 'Space Gray', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-blue-2015', label: 'Shuffle 4G Blue (2015)', line: 'shuffle', gen: 4, year: '2015', color: 'Blue', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-pink-2015', label: 'Shuffle 4G Pink (2015)', line: 'shuffle', gen: 4, year: '2015', color: 'Pink', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle4-red-2015', label: 'Shuffle 4G Red (2015)', line: 'shuffle', gen: 4, year: '2015', color: 'Red', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-shuffle1-white', label: 'Shuffle 1G White (2005)', line: 'shuffle', gen: 1, year: '2005', color: 'White', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano1-black', label: 'Nano 1G Black (2005)', line: 'nano', gen: 1, year: '2005', color: 'Black', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-nano1-white', label: 'Nano 1G White (2005)', line: 'nano', gen: 1, year: '2005', color: 'White', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-touch1-black', label: 'Touch 1G-3G Black (2007)', line: 'touch', gen: 1, year: '2007', color: 'Black', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-touch4-black', label: 'Touch 4G Black (2010)', line: 'touch', gen: 4, year: '2010', color: 'Black', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-touch4-white', label: 'Touch 4G White (2011)', line: 'touch', gen: 4, year: '2011', color: 'White', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-touch5-blackandslate', label: 'Touch 5G Black and Slate (2012)', line: 'touch', gen: 5, year: '2012', color: 'Black and Slate', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-touch5-whiteandsilver', label: 'Touch 5G White and Silver (2012)', line: 'touch', gen: 5, year: '2012', color: 'White and Silver', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-touch5-pink', label: 'Touch 5G Pink (2012)', line: 'touch', gen: 5, year: '2012', color: 'Pink', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-touch5-yellow', label: 'Touch 5G Yellow (2012)', line: 'touch', gen: 5, year: '2012', color: 'Yellow', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-touch5-blue', label: 'Touch 5G Blue (2012)', line: 'touch', gen: 5, year: '2012', color: 'Blue', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-touch5-red', label: 'Touch 5G Red (2012)', line: 'touch', gen: 5, year: '2012', color: 'Red', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-touch5-spacegray', label: 'Touch 5G Space Gray (2013)', line: 'touch', gen: 5, year: '2013', color: 'Space Gray', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-touch6-blue', label: 'Touch 6G-7G Blue (2015)', line: 'touch', gen: 6, year: '2015', color: 'Blue', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-touch6-silver', label: 'Touch 6G-7G Silver (2015)', line: 'touch', gen: 6, year: '2015', color: 'Silver', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-touch6-gold', label: 'Touch 6G-7G Gold (2015)', line: 'touch', gen: 6, year: '2015', color: 'Gold', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-touch6-spacegray', label: 'Touch 6G-7G Space Gray (2015)', line: 'touch', gen: 6, year: '2015', color: 'Space Gray', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-touch6-pink', label: 'Touch 6G-7G Pink (2015)', line: 'touch', gen: 6, year: '2015', color: 'Pink', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-touch6-red', label: 'Touch 6G-7G Red (2015)', line: 'touch', gen: 6, year: '2015', color: 'Red', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-custom5-transparent', label: 'Custom 5G Transparent (2005)', line: 'custom', gen: 5, year: '2005', color: 'Transparent', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-custom5-transparent-black', label: 'Custom 5G Transparent Black (2005)', line: 'custom', gen: 5, year: '2005', color: 'Transparent Black', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-custom5-transparent-coil', label: 'Custom 5G Transparent Coil (2005)', line: 'custom', gen: 5, year: '2005', color: 'Transparent Coil', base: 'ipod', menus: 'click', renderFull: renderIpod },
    { id: 'ipod-original', label: 'Click (Original)', base: 'ipod', look: 'original', menus: 'click', renderFull: renderIpod },
  ];
  var BY_ID = SKINS.reduce(function (m, s) { m[s.id] = s; return m; }, Object.create(null));
  // v1.332 (the INERT SIBLING class): every list of skins is DERIVED from the registry above - the
  // ids, and the Click colorways (the entries with the Click pocket menus: the wheel skins Brick
  // plays on, the Nano tray's colorways, the pop-out tray's chips, the probes' default lists). A new
  // colorway is its registry entry, its CSS role block and its Settings blurb - nothing else.
  var IDS = SKINS.map(function (s) { return s.id; });
  function clickColorways() { return SKINS.filter(function (s) { return s.menus === 'click'; }).map(function (s) { return s.id; }); }
  function isClickColorway(id) { return typeof id === 'string' && !!BY_ID[id] && BY_ID[id].menus === 'click'; }
  // v1.345 (Dean): the skin GROUPS, DERIVED from the registry (never a second list), in the Settings
  // grid's order: the Original, then one group per iPod line and generation ("Nano 4G (2008)"), then
  // Cider and Nordic. A skin with a `line` belongs to its line-generation group.
  var SKIN_LINES = [{ key: 'classic', label: 'Classic' }, { key: 'mini', label: 'Mini' }, { key: 'nano', label: 'Nano' }, { key: 'shuffle', label: 'Shuffle' }, { key: 'touch', label: 'Touch' }, { key: 'custom', label: 'Custom' }];
  var GEN_YEAR = { classic: { 4: '2004', 5: '2005', 6: '2007' }, mini: { 1: '2004', 2: '2005' },
    nano: { 1: '2005', 2: '2006', 3: '2007', 4: '2008', 5: '2009', 6: '2010', 7: '2012' },
    shuffle: { 1: '2005', 2: '2006', 3: '2009', 4: '2010' }, touch: { 1: '2007', 4: '2010', 5: '2012', 6: '2015' }, custom: { 5: '2005' } };
  // The Touch's first and last groups span two or three generations sharing one look.
  var GEN_SPAN = { touch: { 1: '1G-3G', 6: '6G-7G' } };
  function genName(line, g) { return (GEN_SPAN[line] && GEN_SPAN[line][g]) || g + 'G'; }
  function skinFamilies() {
    var out = [{ key: 'original', label: 'Original', ids: ['ipod-original'] }];
    SKIN_LINES.forEach(function (ln) {
      var gens = [];
      SKINS.forEach(function (s) { if (s.line === ln.key && gens.indexOf(s.gen) < 0) gens.push(s.gen); });
      gens.sort(function (x, y) { return x - y; });
      gens.forEach(function (g) {
        out.push({
          key: ln.key + '-' + g, label: ln.label + ' ' + genName(ln.key, g) + ' (' + GEN_YEAR[ln.key][g] + ')', line: ln.key, gen: g,
          ids: SKINS.filter(function (s) { return s.line === ln.key && s.gen === g; }).map(function (s) { return s.id; })
        });
      });
    });
    out.push({ key: 'apple', label: 'Cider', ids: ['apple'] });
    out.push({ key: 'spotify', label: 'Nordic', ids: ['spotify'] });
    return out;
  }
  // The Extras > Skins lines (Classic, Mini, Nano, Shuffle, Touch, Custom), each with its generations' group keys.
  function skinLines() {
    var fams = skinFamilies();
    return SKIN_LINES.map(function (ln) {
      return { key: ln.key, label: ln.label, gens: fams.filter(function (f) { return f.line === ln.key; }).map(function (f) { return f.key; }) };
    }).filter(function (ln) { return ln.gens.length; });
  }
  // A line colorway's row is its color ("Red"); the year joins it ("Black (2007)") only when another
  // colorway of the SAME line and generation shares the color. The Original reads its parenthesized name; Cider and Nordic their labels.
  function colorwayLabel(id) {
    var s = BY_ID[id];
    if (s && s.line) {
      var twin = SKINS.some(function (o) { return o !== s && o.line === s.line && o.gen === s.gen && o.color === s.color; });
      return twin ? s.color + ' (' + s.year + ')' : s.color;
    }
    var m = s && /\(([^)]*)\)\s*$/.exec(s.label);
    return m ? m[1] : (s ? s.label : id);
  }

  function isLegacyId(id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_IDS, id); }
  function normalizeSkinId(id) {
    if (IDS.indexOf(id) >= 0) return id;
    return isLegacyId(id) ? LEGACY_IDS[id] : DEFAULT_ID;
  }
  function activeSkinId(store) {
    // store = a localStorage-like {getItem}; defaults to window.localStorage.
    var ls = store || (typeof window !== 'undefined' && window.localStorage);
    try {
      var raw = ls && ls.getItem(SKIN_KEY);
      var id = normalizeSkinId(raw);
      // D1: a retired id is rewritten ONCE to its replacement - localStorage, which the prefs
      // sync mirrors to the server - so every device converges on the new value.
      if (isLegacyId(raw)) rewriteLegacy(ls, raw, id, !store);
      return id;
    } catch (_) { return DEFAULT_ID; }
  }
  // Gate r1 W1 (adversary + qa, measured): the rewrite is a synced WRITE with a fresh stamp, so run
  // before the sync's boot GET it out-stamped a NEWER pick another device had synced (a cold load
  // reads the skin before that GET returns) and reverted it on every device. On the page's own
  // storage it therefore waits for the boot GET, then rewrites only if the retired id is STILL what
  // is stored (the server's newer value, raw-applied by the sync, is left alone). Without the sync
  // agent (or on a caller's own store) there is no race: it rewrites at once. One wait at a time.
  var rewriteWaiting = false;
  function rewriteLegacy(ls, raw, id, pageStore) {
    var go = function () { try { if (ls.getItem(SKIN_KEY) === raw) ls.setItem(SKIN_KEY, id); } catch (_) { /* private mode: the read still maps */ } };
    var sync = pageStore && typeof window !== 'undefined' && window.__ftPrefsSync;
    if (sync && typeof sync.whenBooted === 'function') {
      if (rewriteWaiting) return;
      rewriteWaiting = true;
      sync.whenBooted(function () { rewriteWaiting = false; go(); });
      return;
    }
    go();
  }
  function setActiveSkin(id, store) {
    var ls = store || (typeof window !== 'undefined' && window.localStorage);
    try { ls.setItem(SKIN_KEY, normalizeSkinId(id)); } catch (_) { /* private mode */ }
    return normalizeSkinId(id);
  }
  function skinById(id) { return BY_ID[normalizeSkinId(id)]; }
  // v1.335 gate r1 W1 (qa + adversary): the ONE builder of the full-screen skin panel's classes - the
  // engine's paint AND music.js's launch cover (a ?play= open) call it, so a skin's base and LOOK (the
  // Original's structure class) can never be on one writer and missing from the other.
  function panelClass(id) {
    var s = skinById(id) || {};
    return 'music-nowplaying-panel mms mms-full mms-' + id + (s.base ? ' mms-' + s.base : '') + (s.look ? ' mms-look-' + s.look : '');
  }

  // The GATE: the mobile-music skin is active on a PHONE AND an audio item the skin can
  // drive - a MUSIC item (meta.isMusic) or, since v1.246, a PODCAST episode
  // (meta.resumeMode==='podcast'; player.js exposes resumeMode via getCurrentMeta, so no
  // player.js change is needed here). `meta` is player.getCurrentMeta() (or an {isMusic}/
  // {resumeMode} stand-in); `phone` lets a test inject the answer. Desktop + video/book
  // stay default.
  //
  // UI pass D7 (Dean's ruling: "Pocket is a phone mode, not a width mode"). The gate was
  // a WIDTH (max-width 768px), which every non-SE iPhone exceeds in landscape, so a rotate
  // tore the skin down and the rotate back rebuilt it and replayed every reveal (F23). It
  // is a DEVICE class now: `html.is-phone`, set ONCE when this module loads (every shell
  // that can host a skin loads it before any view script) from a coarse primary pointer
  // plus the screen's SHORT side (<= 500 CSS px). The short side is the same in both
  // orientations, and the class is never re-evaluated, so a rotation cannot change it.
  // style.css keys the whole takeover on the same class, so CSS and JS are ONE writer.
  // An iPad (short side 768-1024) and a desktop (fine pointer) are not phones.
  var PHONE_CLASS = 'is-phone';
  var PHONE_SHORT_SIDE_MAX = 500;
  // Pure: the device-class decision from its two inputs (exported for the tests).
  function phoneFrom(coarse, screenW, screenH) {
    var w = Number(screenW), h = Number(screenH);
    if (!coarse || !isFinite(w) || !isFinite(h)) return false;
    return Math.min(w, h) <= PHONE_SHORT_SIDE_MAX;
  }
  function detectPhone(win) {
    try {
      var coarse = !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches);
      var scr = win.screen || {};
      return phoneFrom(coarse, scr.width, scr.height);
    } catch (_) { return false; }
  }
  // Set once per document: adds the class when the device is a phone, never removes it.
  function markPhoneClass(win) {
    try {
      var html = win && win.document && win.document.documentElement;
      if (!html) return false;
      if (!html.classList.contains(PHONE_CLASS) && detectPhone(win)) html.classList.add(PHONE_CLASS);
      return html.classList.contains(PHONE_CLASS);
    } catch (_) { return false; }
  }
  // The JS half reads the SAME class the CSS keys on - never matchMedia, never a width.
  function isPhone(phone) {
    if (typeof phone === 'boolean') return phone;
    try {
      return !!(typeof document !== 'undefined' && document.documentElement && document.documentElement.classList.contains(PHONE_CLASS));
    } catch (_) { return false; }
  }
  function skinActiveFor(meta, phone) {
    return !!(meta && (meta.isMusic || meta.resumeMode === 'podcast')) && isPhone(phone);
  }
  if (typeof window !== 'undefined' && window.document) markPhoneClass(window);

  // Measure AFTER settle (UI pass D7, F59). A size the skin reads once (the haptic ghost's
  // scale, the Brick canvas's backing store) goes stale when a rotate or the iOS toolbar
  // resizes the page after it was taken. `observeSettled` calls `apply()` once `el`'s box has
  // held still for TWO animation frames after any change: a ResizeObserver report (including
  // the one it delivers when it starts observing) restarts a frame watch, which applies in
  // the frame after two equal reads, so a layout still moving is never measured. Returns a
  // disconnect(). No ResizeObserver or rAF (an old engine, a jsdom fixture) -> nothing to
  // watch, and the caller's one synchronous measure stands.
  function observeSettled(el, win, apply) {
    var RO = win && win.ResizeObserver;
    var raf = win && typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame.bind(win) : null;
    if (!el || !RO || !raf || typeof apply !== 'function') return function () {};
    var seq = 0, stopped = false;
    function sizeOf() {
      try { var r = el.getBoundingClientRect(); return r.width + 'x' + r.height; } catch (_) { return ''; }
    }
    function watch() {
      var mine = ++seq;
      var last = sizeOf(), stable = 0;
      function tick() {
        if (stopped || mine !== seq || !el.isConnected) return;
        var now = sizeOf();
        if (now === last) { stable++; if (stable >= 2) { apply(); return; } } else { stable = 0; last = now; }
        raf(tick);
      }
      raf(tick);
    }
    var ro;
    try { ro = new RO(function () { watch(); }); ro.observe(el); } catch (_) { return function () {}; }
    return function () { stopped = true; try { ro.disconnect(); } catch (_) { /* already gone */ } };
  }

  // ==== POCKET MENUS (Dean 2026-09-24: "I'd love classic pocket skin to truly emulate.
  // Show artists, albums, songs, etc. fully interactive") ======================================
  // The Click family carries the device's real menu tree over the WHOLE music library.
  // This module owns the PURE half: the static levels, the builders that turn the Music view's
  // own API payloads into menu rows, the list window math and the screen renderer (Click's
  // 6G split screen). The controller (stack, cursor, MENU/Select, loads)
  // lives in skin-surface.js; the data fetches + the play seam live in music.js.
  //
  // A menu ROW (every builder returns these):
  //   { label, sub?, art?, node?: {type, key?, label?, artist?} (drills in, shows a chevron),
  //     action?: 'shuffle' | 'nowplaying', song?: true, id?, trackIndex? (into the level's tracks) }
  function menuStyle(id) { var s = BY_ID[normalizeSkinId(id)]; return (s && s.menus) || ''; }
  // Click's Music menu (the iPod order, Dean's tree). The controller reads it, never a copy.
  // Quick scroll (Dean 2026-09-24): Recent Artists leads it.
  var MUSIC_MENU = [
    { type: 'recentArtists', label: 'Recent Artists' },
    { type: 'playlists', label: 'Playlists' }, { type: 'artists', label: 'Artists' },
    { type: 'albums', label: 'Albums' }, { type: 'songs', label: 'Songs' }, { type: 'genres', label: 'Genres' },
  ];
  // Playlists = Liked (the one real playlist, Dean: "including Liked") + the device's smart
  // playlists this library can honestly fill (no play counts exist, so no "Top 25").
  var PLAYLISTS = [
    { key: 'liked', label: 'Liked Songs' },
    { key: 'recent-added', label: 'Recently Added' },
    { key: 'recent-played', label: 'Recently Played' },
  ];
  var ROOT_TITLE = { click: 'Click' }; // the cheeky name, never the product's (Dean)
  var TYPE_TITLE = { music: 'Music', playlists: 'Playlists', artists: 'Artists', albums: 'Albums', songs: 'Songs', genres: 'Genres',
    recentArtists: 'Recent Artists', extras: 'Extras', skins: 'Skins', games: 'Games', settings: 'Settings', about: 'About', lighting: 'Lighting' };
  function menuTitle(node, style) {
    var n = node || {};
    if (n.type === 'main') return ROOT_TITLE[style] || 'Menu';
    if (TYPE_TITLE[n.type]) return TYPE_TITLE[n.type];
    return (typeof n.label === 'string' && n.label) ? n.label : 'Songs';
  }
  // The STATIC levels (null for a level whose rows come from the library).
  // The Main Menu is the device's own order (the iPod classic: Music, Extras, Settings, Shuffle
  // Songs, Now Playing). Extras exists only while the
  // game can run here (opts.hasGames = the Brick hook's own availability rule, read by the
  // controller) - never an entry that leads to nothing. Settings holds About only (Dean's scope:
  // Shuffle / Repeat / Autoplay stay where they already live).
  function menuStaticItems(node, opts) {
    var t = node && node.type;
    var o = opts || {};
    if (t === 'main') {
      var rows = [{ label: 'Music', node: { type: 'music' } }];
      if (o.hasGames || o.hasSkins) rows.push({ label: 'Extras', node: { type: 'extras' } });
      rows.push({ label: 'Settings', node: { type: 'settings' } });
      rows.push({ label: 'Shuffle Songs', action: 'shuffle' });
      if (o.hasCurrent) rows.push({ label: 'Now Playing', action: 'nowplaying' });
      return rows;
    }
    if (t === 'music') return MUSIC_MENU.map(function (m) { return { label: m.label, node: { type: m.type } }; });
    if (t === 'playlists') return PLAYLISTS.map(function (p) { return { label: p.label, node: { type: 'playlist', key: p.key, label: p.label } }; });
    if (t === 'extras') {
      var ex = [];
      if (o.hasGames !== false) ex.push({ label: 'Games', node: { type: 'games' } });
      if (o.hasSkins) ex.push({ label: 'Skins', node: { type: 'skins' } });
      return ex;
    }
    if (t === 'skins' || t === 'skinLine' || t === 'skinGen') return menuSkinItems(node, o.activeSkin);
    if (t === 'games') return [{ label: 'Brick', action: 'brick' }];
    // Lighting (2026-09-24, plan pocket-gyro-lighting): only where the controller says the driver
    // can light THIS skin (opts.hasLighting: a Click skin with pocket-lighting.js loaded) - never
    // a row that leads to nothing.
    if (t === 'settings') return (o.hasLighting ? [{ label: 'Lighting', node: { type: 'lighting' } }] : []).concat([{ label: 'About', node: { type: 'about' } }]);
    return null;
  }
  // Extras > Skins (v1.345): Original, then a row per iPod line (Classic, Mini, Nano, Shuffle, Touch, Custom), then Cider and
  // Nordic. A line opens its generations ("4G (2004)"); a generation opens its colors. A row carries `skinId`;
  // `preview` says the wheel may re-skin the LCD live as the highlight lands on it (only skins that keep these
  // menus: a Cider/Nordic preview would end the menu under the user's finger, so those apply on Select only).
  // The check follows the ACTIVE skin, and a line or generation row is checked when the active skin is inside it.
  function menuSkinItems(node, active) {
    var cur = normalizeSkinId(active);
    var fams = skinFamilies();
    function row(id, label) { return { label: label, action: 'skin', skinId: id, check: id === cur, preview: menuStyle(id) === 'click' }; }
    function holdsActive(f) { return f.ids.indexOf(cur) >= 0; }
    if (node && node.type === 'skinGen') {
      var g = fams.filter(function (x) { return x.key === node.key; })[0];
      return g ? g.ids.map(function (id) { return row(id, colorwayLabel(id)); }) : [];
    }
    if (node && node.type === 'skinLine') {
      return fams.filter(function (f) { return f.line === node.key; }).map(function (f) {
        return { label: genName(f.line, f.gen) + ' (' + GEN_YEAR[f.line][f.gen] + ')', node: { type: 'skinGen', key: f.key, label: SKIN_LINES.filter(function (l) { return l.key === f.line; })[0].label + ' ' + genName(f.line, f.gen) }, check: holdsActive(f) };
      });
    }
    var rows = [row('ipod-original', 'Original')];
    skinLines().forEach(function (ln) {
      var held = fams.some(function (f) { return f.line === ln.key && holdsActive(f); });
      rows.push({ label: ln.label, node: { type: 'skinLine', key: ln.key, label: ln.label }, check: held });
    });
    rows.push(row('apple', 'Cider'));
    rows.push(row('spotify', 'Nordic'));
    return rows;
  }
  // Settings > Lighting: the four strengths (v1.333: + Ambient) with a check on the active one, plus a read-only
  // note row (motion denied / no sensor / Reduce Motion) when the driver has one. Re-derived on
  // every draw from the driver's state (like the Main Menu) - the check moves as you pick.
  var LIGHTING_STRENGTHS = [{ value: 'off', label: 'Off' }, { value: 'subtle', label: 'Subtle' }, { value: 'pronounced', label: 'Pronounced' }, { value: 'ambient', label: 'Ambient' }]; // v1.333: Ambient
  function menuLightingItems(state) {
    var s = state || {};
    var cur = LIGHTING_STRENGTHS.some(function (r) { return r.value === s.strength; }) ? s.strength : 'off';
    var rows = LIGHTING_STRENGTHS.map(function (r) { return { label: r.label, action: 'lighting', value: r.value, check: cur === r.value }; });
    if (typeof s.note === 'string' && s.note) rows.push({ label: s.note, note: true, info: true });
    return rows;
  }
  // Addendum E (Dean: "the art gently moves from right to left ... in some of the views, like the
  // main views that are not the album that you picked"): the levels whose rows are MENU entries,
  // not library items. On Click their right pane plays the slow cover drift (the 6G/7G main-menu
  // slideshow); every other level shows the highlighted item's own art. One list, read by the
  // controller - never a second copy.
  var NON_ITEM_LEVELS = ['main', 'music', 'playlists', 'genres', 'extras', 'games', 'skins', 'skinLine', 'skinGen', 'settings', 'about', 'lighting'];
  function menuIsItemLevel(node) { return NON_ITEM_LEVELS.indexOf(node && node.type) < 0; }
  // The builders take the VIEW's art rule (`artFor(id, explicitArtUrl)` - music.js passes its one
  // musicArtUrl) so the menus can never drift from the art the rest of Music shows. v1.339 (L1):
  // a track's art keys on its server `artId` (the album's shared representative) when it has one,
  // so a menu of one album's songs requests its cover once.
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
        id: t && t.id, song: true, trackIndex: i, art: artVia(artFor, t && (t.artId || t.id), t && t.artUrl),
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
      albums.push({ label: name, node: { type: 'artistAlbum', key: k, artist: node.key || '', label: name }, art: artVia(artFor, t.artId || t.id, t.artUrl) });
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
  // Recent Artists (Dean 2026-09-24): the artists of the Recently Played source (the view's own
  // `filter=recent-listening` rows, most recent first, visibility-gated by the route), unique in
  // recency order, at most 25. The artist key is the Artists level's own grouping rule
  // (albumArtist || artist, server groupArtists), so a row drills in exactly like Artists > artist.
  var RECENT_ARTISTS_MAX = 25;
  function menuRecentArtistItems(tracks, artFor) {
    var seen = Object.create(null);
    var out = [];
    (Array.isArray(tracks) ? tracks : []).some(function (t) {
      if (!t) return false;
      var name = (typeof t.albumArtist === 'string' && t.albumArtist) || (typeof t.artist === 'string' && t.artist) || '';
      if (seen['k' + name]) return false;
      seen['k' + name] = true;
      out.push({
        label: name || 'Unknown Artist',
        node: { type: 'artist', key: name, label: name || 'Unknown Artist' },
        art: (typeof t.avatarUrl === 'string' && t.avatarUrl) ? t.avatarUrl : artVia(artFor, t.artId || t.id, t.artUrl),
      });
      return out.length >= RECENT_ARTISTS_MAX;
    });
    return out;
  }
  // About (Dean: "an about ... info for FileTube in context"): read-only rows, the device's About
  // screen. Counts are the library routes' own `total`s (visibility-gated per user); the version
  // is the running build's (the account menu's source). The screen's heading - the skin's cheeky
  // name - is drawn by the renderer from the style, never the product's name.
  function groupDigits(n) {
    var v = Math.max(0, Math.floor(Number(n) || 0));
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function menuAboutItems(facts) {
    var f = facts || {};
    var rows = [
      { label: 'Songs', value: groupDigits(f.songs), info: true },
      { label: 'Albums', value: groupDigits(f.albums), info: true },
      { label: 'Artists', value: groupDigits(f.artists), info: true },
    ];
    if (typeof f.version === 'string' && f.version) rows.push({ label: 'Version', value: f.version, info: true, volatile: true });
    rows.push({ label: 'Software', value: 'FileTube', info: true });
    return rows;
  }
  // Addendum E: the slideshow's covers - one per album, only tracks the server says HAVE art
  // (`hasArt`: a native cover on disk, or a library item's thumbnail), through the view's one art
  // rule, same-origin paths only (never a remote avatar). Empty = no art in the library.
  // gate r1: a RANDOM sample across the whole album list (Dean asked for random covers - the
  // first 60 by title were all one letter), and a same-origin PATH only: one '/' followed by
  // neither '/' nor '\'. Gate r2 (security-brief INFO 1, adversary S-a): the prefix rule alone
  // was bypassable - the URL parser drops tab / CR / LF, so '/\t/host' became '//host'. A path
  // now also has to RESOLVE on the origin it is resolved against (a fixed placeholder origin, so
  // the rule is the same in every window, pop-out included).
  var COVER_POOL_MAX = 60;
  var PATH_BASE = 'http://pocket-menu.invalid';
  function sameOriginPath(u) {
    if (typeof u !== 'string' || u.charAt(0) !== '/' || u.length < 2 || u.charAt(1) === '/' || u.charAt(1) === '\\') return false;
    try { return new URL(u, PATH_BASE).origin === PATH_BASE; } catch (_) { return false; }
  }
  function menuCoverPool(tracks, artFor, rand) {
    var seen = Object.create(null);
    var all = [];
    (Array.isArray(tracks) ? tracks : []).forEach(function (t) {
      if (!t || !t.hasArt) return;
      var k = 'k' + (t.albumKey || t.id);
      if (seen[k]) return;
      var u = artVia(artFor, t.artId || t.id, t.artUrl);
      if (!sameOriginPath(u)) return;
      seen[k] = true;
      all.push(u);
    });
    var r = typeof rand === 'function' ? rand : Math.random;
    // a partial Fisher-Yates: the first COVER_POOL_MAX slots are a uniform random sample
    var n = Math.min(COVER_POOL_MAX, all.length);
    for (var i = 0; i < n; i++) {
      var j = i + Math.floor(r() * (all.length - i));
      var tmp = all[i]; all[i] = all[j]; all[j] = tmp;
    }
    return all.slice(0, n);
  }

  // ---- QUICK SCROLL (Dean 2026-09-24: "there's a lot of scrolling ... I don't want to go crazy")
  // The iPod classic 5G+ jumped a long list by LETTER. A row's letter comes from its
  // label - the value the level is sorted by (the server's cmpStr: trimmed, localeCompare at base
  // sensitivity; no "The " rule, so none here either). Digits and symbols are '#', which that sort
  // places first; accents fold to their base letter (É under E) and the few Latin letters the
  // collation files under a base letter without decomposing them (Æ, Ø, Ł, ß - measured against
  // the server's own comparison in the unit test) fold with them. Anything else (Ω, あ) is '#'
  // wherever the sort put it. The jump table is the list's own RUNS of one letter, in list order -
  // so it follows the list's real order even where it is not A-Z (a trailing '#' run is a run).
  var MENU_LETTERS = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
  var MENU_LETTER_MIN = 20; // a shorter list is crossed in a turn or two - no letter mode there
  // gate r1 (adversary S1): compatibility forms first (NFKD: fullwidth Ａ, circled Ⓐ, Roman Ⅻ,
  // ligatures Ĳ / Ǆ decompose to plain letters, accents split off), THEN the Latin letters the
  // collation files under a base letter without decomposing them - measured against the
  // server's own cmpStr over U+00A1-U+024F, U+1E00-U+1EFF, fullwidth, circled and Roman forms.
  // (generated by sweeping those ranges through cmpStr; one entry per letter, the characters the
  // server files under it that NFKD + upper-casing does not already reduce to that letter)
  var LETTER_FOLD = Object.create(null);
  'A:ÆæȺ|B:ƀƁƂƃɃ|C:ƇƈȻȼ|D:ÐðĐđƉƊƋƌȡȸẟ|E:ƎƏƐǝɆɇ|F:Ƒƒ|G:ƓƔƢƣǤǥ|H:ĦħƕǶ|I:ƖƗ|J:ȷɈɉ|K:Ƙƙ|L:ŁłƚƛȴȽỺỻ|N:ŊŋƝƞȠȵ|O:ØøŒœƆƟȢȣ|P:Ƥƥ|Q:ĸȹɊɋ|R:ƦɌɍ|S:Ʃƪȿẜẝẞ|T:ŦŧƫƬƭƮƾȶȾ|U:ƜƱɄ|V:ƲɅỼỽ|Y:ƳƴȜȝɎɏỾỿ|Z:ƍ'.split('|').forEach(function (g) {
    var chars = Array.from(g.slice(2));
    chars.forEach(function (c) { LETTER_FOLD[c] = g.charAt(0); });
  });
  function menuLetterOf(label) {
    var s = String(label == null ? '' : label).trim();
    if (!s) return '#';
    var ch = String.fromCodePoint(s.codePointAt(0));
    var k = (typeof ch.normalize === 'function') ? ch.normalize('NFKD') : ch;
    var first = String.fromCodePoint(k.codePointAt(0) || 0);
    if (LETTER_FOLD[first]) return LETTER_FOLD[first];
    var base = first.toUpperCase().charAt(0);
    return (base >= 'A' && base <= 'Z') ? base : '#';
  }
  function menuLetterRuns(items) {
    var runs = [];
    var prev = null;
    (Array.isArray(items) ? items : []).forEach(function (it, i) {
      var l = menuLetterOf(it && it.label);
      if (l !== prev) { runs.push({ letter: l, index: i }); prev = l; }
    });
    return runs;
  }
  // the run holding row `i` (binary search over the run starts)
  function runAt(runs, i) {
    var lo = 0, hi = runs.length - 1, ans = 0;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (runs[mid].index <= i) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }
  function menuLetterAt(runs, i) { return (runs && runs.length) ? runs[runAt(runs, i)].letter : ''; }
  // One detent in letter mode: forward = the first row of the NEXT run; back = the first row of
  // the run BEFORE the cursor's (the device's "previous letter"), or row 0 from the first run.
  function menuLetterJump(runs, i, dir) {
    if (!runs || !runs.length) return i;
    var r = runAt(runs, i);
    if (dir > 0) return r + 1 < runs.length ? runs[r + 1].index : i;
    return r > 0 ? runs[r - 1].index : runs[0].index;
  }
  // The A-Z picker: every letter, each with the first row of its first run (-1 = absent).
  function menuLetterTargets(runs) {
    var first = Object.create(null);
    (runs || []).forEach(function (r) { if (first[r.letter] === undefined) first[r.letter] = r.index; });
    return MENU_LETTERS.map(function (l) { return { letter: l, index: first[l] === undefined ? -1 : first[l] }; });
  }
  // A level qualifies when the VIEW says its rows are in label order (`letters: true` on its
  // payload - the view knows the sort it asked the server for) and it is long.
  function menuLetterable(pane) {
    return !!(pane && pane.letters && Array.isArray(pane.items) && pane.items.length >= MENU_LETTER_MIN);
  }
  function menuSortIsAlpha(sort) { return sort === 'title-asc' || sort === 'title-desc'; }

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
  // v = { items, cursor, currentId, start, end, rowH, state, emptyText }
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
      // an INFO row (About) is read-only: no selection bar, a value on the right, not an option.
      if (it.info) {
        // a NOTE row (Lighting's "motion denied" line) wraps; a value row (About) keeps one line.
        if (it.note) { html += '<div class="ipm-row ipm-info ipm-noterow" role="status"><span class="ipm-lbl">' + esc(it.label) + '</span></div>'; continue; }
        html += '<div class="ipm-row ipm-info"><span class="ipm-lbl">' + esc(it.label) + '</span><span class="ipm-val' + (it.volatile ? ' ipm-volatile' : '') + '">' + esc(it.value) + '</span></div>';
        continue;
      }
      var cls = 'ipm-row' + (i === v.cursor ? ' is-cursor' : '') + (it.node ? ' has-chev' : '') +
        (v.currentId && it.id === v.currentId ? ' is-current' : '') + (it.check ? ' is-checked' : '');
      html += '<button type="button" class="' + cls + '" data-skin-mi="' + i + '" role="option" aria-selected="' + (i === v.cursor ? 'true' : 'false') + '">' +
        '<span class="ipm-lbl">' + esc(it.label) + '</span>' +
        (it.check ? '<span class="ipm-check" aria-label="Selected">' + skGlyph('check') + '</span>' : '') +
        (v.currentId && it.id === v.currentId ? '<span class="ipm-now" aria-label="Now playing">' + ipVolGlyph() + '</span>' : '') +
        (it.node ? '<span class="ipm-chev" aria-hidden="true">' + skGlyph('chevRight') + '</span>' : '') +
        '</button>';
    }
    html += '<div class="ipm-pad" style="height:' + (Math.max(0, items.length - v.end) * rowH) + 'px"></div>';
    return html;
  }
  // The whole menu screen for the LCD. Click: the 6th/7th-gen SPLIT SCREEN - the list on the
  // left half, the highlighted item's art easing in on the right (`art`, applied by the
  // controller so a fast wheel does not thrash the image).
  // Quick scroll's three layers over the menu screen (all inside .ip-menuview, drawn from the
  // controller's state so a repaint keeps them): the big LETTER overlay (the wheel's letter mode:
  // the iPod's translucent dark square), the small
  // edge BADGE (a touch scroll's letter), and the A-Z PICKER (opened by tapping either). Both the
  // overlay and the badge are 44 px+ buttons, faded by a class so a hidden one never takes a tap.
  // jump = { letter, overlay, badge, grid: [{letter, index}] | null }
  function renderJumpLayers(jump) {
    if (!jump) return '';
    var l = esc(jump.letter || '');
    var html = '<button type="button" class="ipm-letter' + (jump.overlay ? ' is-on' : '') + '" data-skin-letters aria-label="Jump to a letter"' + (jump.overlay ? '' : ' tabindex="-1"') + '>' + l + '</button>' +
      '<button type="button" class="ipm-badge' + (jump.badge ? ' is-on' : '') + '" data-skin-letters aria-label="Jump to a letter"' + (jump.badge ? '' : ' tabindex="-1"') + '>' + l + '</button>';
    if (jump.grid) {
      html += '<div class="ipm-grid" data-skin-lettergrid role="group" aria-label="Jump to a letter">' + jump.grid.map(function (t) {
        var on = t.index >= 0;
        return '<button type="button" class="ipm-gl' + (on ? '' : ' is-off') + '"' + (on ? ' data-skin-letter="' + Number(t.index) + '"' : ' disabled') + '>' + esc(t.letter) + '</button>';
      }).join('') + '</div>';
    }
    return html;
  }
  // v = renderMenuList's v + { title, root, art, artIn, jump?, aboutName? }
  function renderMenuView(style, v) {
    var list = '<div class="ipm-list" data-skin-menulist role="listbox" aria-label="' + esc(v.title || 'Menu') + '">' +
      renderMenuList(v) + '</div>';
    var art = v.art ? '<img class="ipm-art-img' + (v.artIn ? ' is-in' : '') + '" src="' + esc(v.art) + '" alt="" />' : '';
    var aboutC = v.aboutName ? '<div class="ipm-about-name">' + esc(v.aboutName) + '</div>' : '';
    return '<div class="ip-menuview ipm-click"><div class="ipm-split"><div class="ipm-lpane">' + aboutC + list + '</div>' +
      '<div class="ipm-art" aria-hidden="true">' + art + '</div></div>' + renderJumpLayers(v.jump) + '</div>';
  }

  var api = {
    SKIN_KEY: SKIN_KEY, IDS: IDS, DEFAULT_ID: DEFAULT_ID, SKINS: SKINS,
    normalizeSkinId: normalizeSkinId, activeSkinId: activeSkinId, setActiveSkin: setActiveSkin,
    skinById: skinById, panelClass: panelClass, clickColorways: clickColorways, skinFamilies: skinFamilies, skinLines: skinLines, colorwayLabel: colorwayLabel, menuSkinItems: menuSkinItems, isClickColorway: isClickColorway,
    renderFull: function (id, ctx) { ctx = ctx || {}; return skinById(id).renderFull(ctx); },
    skinActiveFor: skinActiveFor, isPhone: isPhone, phoneFrom: phoneFrom, markPhoneClass: markPhoneClass,
    PHONE_CLASS: PHONE_CLASS, PHONE_SHORT_SIDE_MAX: PHONE_SHORT_SIDE_MAX, observeSettled: observeSettled,
    // the pocket menus (the pure half - see the block above).
    menuStyle: menuStyle, menuTitle: menuTitle, menuStaticItems: menuStaticItems,
    menuArtistItems: menuArtistItems, menuAlbumItems: menuAlbumItems, menuSongItems: menuSongItems,
    menuArtistAlbumItems: menuArtistAlbumItems, menuGenreItems: menuGenreItems,
    tracksOfGenre: tracksOfGenre, tracksOfAlbum: tracksOfAlbum,
    menuWindow: menuWindow, renderMenuList: renderMenuList, renderMenuView: renderMenuView,
    // quick scroll + Recent Artists + Extras/Settings/About + the cover drift (2026-09-24)
    menuRecentArtistItems: menuRecentArtistItems, menuAboutItems: menuAboutItems, menuCoverPool: menuCoverPool,
    menuLightingItems: menuLightingItems, LIGHTING_STRENGTHS: LIGHTING_STRENGTHS, // Settings > Lighting (2026-09-24)
    menuIsItemLevel: menuIsItemLevel, menuLetterOf: menuLetterOf, menuLetterRuns: menuLetterRuns,
    menuLetterAt: menuLetterAt, menuLetterJump: menuLetterJump, menuLetterTargets: menuLetterTargets,
    menuLetterable: menuLetterable, menuSortIsAlpha: menuSortIsAlpha, renderMenuJump: renderJumpLayers,
    MENU_LETTERS: MENU_LETTERS, MENU_LETTER_MIN: MENU_LETTER_MIN, RECENT_ARTISTS_MAX: RECENT_ARTISTS_MAX,
    _esc: esc, _pct: pct,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FileTubeMusicSkins = api;
})();
