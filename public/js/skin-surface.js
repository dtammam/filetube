'use strict';

// Shared mobile-skin ENGINE (v1.246, Dean's podcasts-on-skin wave). The music view (music.js)
// grew a battle-won iPod/Apple/Spotify skin surface over v1.227-246 - render + reflect + the
// click-wheel gesture (list cursor + timeline scrub) + transport proxying to the player's
// hidden controls. Podcasts want the SAME surface, but music.js and podcasts.js are separate
// page-scoped scripts, so the reusable engine lives HERE (loaded globally like music-skins.js)
// and each view drives it with its own CONTEXT (art URL, episode/track list, metadata) + HOOKS
// (play index i, dock). This module NEVER touches player.js - it only draws the skin registry's
// chrome and PROXIES clicks/gestures to the EXISTING hidden controls (#pp-btn / #track-prev-btn
// / #track-next-btn / #seek-bar), reflecting the live #media-player. player.js stays BYTE-
// UNCHANGED. v1.250 (F-UNIFY): music.js runs on this engine too now - its in-view copy is
// gone; this file is the ONE skin implementation for music (both surfaces) and podcasts.
//
// The gesture code is a FAITHFUL PORT of music.js's (the v1.233/v1.239 gesture-scar playbook:
// Pointer events not touch, capture taken LAZILY once a spin is confirmed, per-move sign, a
// pointerId filter, a click-suppression flag, dual-arm teardown on up AND cancel).
//
// config (all supplied by the driving view):
//   panel          the DOM element to render the skin into
//   getSkinId()    -> the active skin id (music-skins.js activeSkinId())
//   getCtx()       -> the skin ctx for renderFull (track/art/upNext/playing/pos...)
//   hostCtl(id)    -> a hidden control element by id (document.getElementById; GLOBAL controls)
//   onSelectIndex(i) play list position i (the view's playAt)
//   onDock()       dock the player (the view's dock + re-render)
//   win            the window the panel lives in (a Document-PiP pop-out has its own)
// F-UNIFY capabilities (v1.250, each INERT unless configured - podcasts' existing usage
// is byte-unchanged by default; all are FAITHFUL PORTS of music.js's battle-won blocks):
//   marquee        default ON: overflowing title/artist/album lines scroll (v1.232) -
//                  CSS-driven, inert without overflow; pass marquee:false to disable
//   fastScan       HOLD the rewind/ffwd wheel zone to fast-scan the timeline ~2x
//                  (v1.242; release commits through the seek pipeline)
//   onShuffle()    the [data-skin-shuffle] zone's action (the view's shuffle control)
//   sticker        the v1.238-249 sticker quick-menu (speed/loop/skin) + optional Extras:
//     onSkinChange()  re-render after a skin pick (the view repaints its surfaces)
//     getPlayer()     -> the FileTube player facade for loop get/set
//                        (default: window.FileTube && window.FileTube.player)
//     watchBack       OPTIONAL (v1.252 Listen-mode) - { visible(), onTap() }: page 1 gains a
//                     "Watch" row when visible() (music: the playing item is a listen track);
//                     onTap navigates back to the item's watch page.
//     tray            OPTIONAL (v1.257, INJECTED BY THE POP-OUT SHELL only) - { enabled(),
//                     onToggle() }: page 1 gains a "Tray" row on the pop-out surface;
//                     toggling reopens the pip window as the taskbar strip. Views never
//                     declare this hook themselves.
//     autoplay        OPTIONAL (v1.254 endless autoplay) - { enabled(), onToggle() }: page 1
//                     gains an "Autoplay" On/Off row (Loop chassis). Both surfaces - the
//                     setting is device-global, so a pop-out flip is coherent. Omitted
//                     (podcasts) = no row.
//     extras          OPTIONAL - the v1.249 watch-page Extras second page. Omitted (e.g.
//                     podcasts - they keep their own actions) = quick menu only. Hooks:
//       getBaseId()   -> the playing item's base media id (::c chapter suffix stripped), or null
//       isEligible()  -> the view says the playing item is library-backed (the engine adds its
//                        own in-MAIN-document check - the pop-out never offers Extras)
//       onMutated()   a successful Move/Delete removed/re-keyed the playing item - the view
//                     clears its playing state and refreshes
//       signal        the view's AbortSignal (share-choice dismiss, transcript, reheat poll)
// NOTE (Dean, 2026-09-02): music.js's v1.235 wheel-VOLUME mode is deliberately NOT ported -
// Dean ruled the Now-Playing wheel SCRUBS everywhere ("like it does on mobile - consistent
// UI and useful"), so the engine has exactly one Now-Playing wheel behavior. The iPod skin's
// volume-bar markup (.ip-vol-fill) stays dormant in music-skins.js (untouched, zero-risk).
//
// api: paint() render+bind the skin; reflect() sync from the live element; setListMode(on);
//   destroy() unbind + clear body.mms-on. Returns null if music-skins.js isn't present.

(function () {
  function create(config) {
    var SKINS = (typeof window !== 'undefined' && window.FileTubeMusicSkins) || null;
    if (!SKINS || !config || !config.panel) return null;
    var panel = config.panel;
    var win = config.win || (panel.ownerDocument && panel.ownerDocument.defaultView) || window;
    var doc = panel.ownerDocument || document;
    var hostCtl = config.hostCtl || function (id) { return doc.getElementById(id); };
    var getCtx = config.getCtx || function () { return {}; };
    var getSkinId = config.getSkinId || function () { return SKINS.activeSkinId(); };
    var onSelectIndex = config.onSelectIndex || function () {};
    var onDock = config.onDock || function () {};
    var onShuffle = typeof config.onShuffle === 'function' ? config.onShuffle : null;
    var fastScan = !!config.fastScan;
    var marqueeOn = config.marquee !== false; // default ON (CSS-driven; inert without overflow)
    var stickerCfg = config.sticker || null;
    var extrasCfg = (stickerCfg && stickerCfg.extras) || null;
    // Extras only on a MAIN-document surface: the shared modals/toasts render in the main
    // window, so a pop-out offering Extras would open UI behind itself (v1.249 scope rule).
    // Dean wants pop-out Extras (2026-09-02) - that lifts WITH doc-aware shared dialogs, a
    // queued wave (see the plan doc's queue); until then this gate stays.
    var inMainDoc = (typeof document !== 'undefined') && doc === document;
    function stickerPlayer() {
      if (stickerCfg && typeof stickerCfg.getPlayer === 'function') { try { return stickerCfg.getPlayer(); } catch (_) { return null; } }
      return (typeof window !== 'undefined' && window.FileTube && window.FileTube.player) || null;
    }

    var WHEEL_STEP_DEG = 22;           // wheel degrees per one-item cursor step (music parity)
    var wheelCursorRow = -1;           // current list position the cursor sits on (-1 = list closed)
    var wheelSuppressClick = false;    // swallow the synthetic click a spin-ending pointerup fires
    var wheelSpin = null;              // the live gesture handle (one at a time)
    var bound = false;

    function wheelShortAngle(a) { while (a > 180) a -= 360; while (a < -180) a += 360; return a; }

    // ---- reflect the live #media-player into the skin (play glyph + progress fill + times) ----
    // Byte-for-behaviour with music.js reflectSkin: reads the element, never assumes music.
    function reflect() {
      healGhostLock(); // v1.256: the lock must never outlive its ghost (the v1.227 leak class)
      if (!panel || !panel.classList.contains('mms-full')) return;
      var mp = hostCtl('media-player'); if (!mp) return;
      // SWAP the play-button GLYPH (not just a class) - byte-for-behaviour with music.js
      // reflectSkin: the default Apple/Spotify skins render a real .mms-play SVG button, so a
      // class toggle alone would leave the wrong icon after an in-place pause (adversarial W1).
      var playBtn = panel.querySelector('.mms-play');
      if (playBtn) {
        playBtn.setAttribute('aria-label', mp.paused ? 'Play' : 'Pause');
        playBtn.innerHTML = mp.paused
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
      }
      var dur = (isFinite(mp.duration) && mp.duration > 0) ? mp.duration : 0;
      var pos = Number(mp.currentTime) || 0;
      var frac = dur > 0 ? Math.min(100, Math.max(0, pos / dur * 100)) : 0;
      // reset to 0 while a track is LOADING (dur==0) instead of leaving the old fill (music parity).
      var fill = panel.querySelector('.mms-fill'); if (fill) fill.style.width = (dur > 0 ? frac : 0) + '%';
      // the iPod status-bar play indicator (music parity).
      var pind = panel.querySelector('.mms-playind'); if (pind) pind.textContent = mp.paused ? '❚❚' : '▶';
      var posEl = panel.querySelector('.mms-pos'); if (posEl) posEl.textContent = fmtTime(pos);
      var remEl = panel.querySelector('.mms-rem'); if (remEl) remEl.textContent = dur > 0 ? ('-' + fmtTime(Math.max(0, dur - pos))) : '';
    }
    function fmtTime(s) {
      s = Math.max(0, Math.floor(Number(s) || 0));
      var m = Math.floor(s / 60), sec = s % 60;
      return m + ':' + (sec < 10 ? '0' : '') + sec;
    }

    // ==== the v1.238-249 STICKER quick-menu + Extras (F-UNIFY port from music.js) ==========
    // The menu items PROXY the existing controls so player.js stays BYTE-UNCHANGED:
    // speed -> #media-player.playbackRate AND defaultPlaybackRate (the latter survives the
    // next load(); player.js reads 'ft-rate' only once at init) + persist 'ft-rate';
    // loop -> player.setLoop/isLoopEnabled; skin -> SKINS.setActiveSkin + onSkinChange.
    var STICKER_KEY = 'ft-sticker';
    var RATE_KEY = 'ft-rate'; // MUST match player.js RATE_STORAGE_KEY (re-read on page init)
    // MUST mirror player.js PLAYBACK_RATES - source-locked behaviorally in music-sticker-menu.test.js.
    var MMS_SPEED_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    var STICKER_SIZES = ['default', '2x', '3x'];
    var STICKER_TILTS = ['straight', 'left', 'right'];
    function escapeHtml(text) {
      return String(text == null ? '' : text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }
    function readStickerPref() {
      try {
        var raw = (typeof window !== 'undefined' && window.localStorage) ? window.localStorage.getItem(STICKER_KEY) : null;
        if (!raw) return { kind: 'logo' };
        var o = JSON.parse(raw);
        if (o && (o.kind === 'logo' || o.kind === 'emoji' || o.kind === 'custom')) return o;
      } catch (_) { /* private mode / bad json -> default */ }
      return { kind: 'logo' };
    }
    function stickerSize() { var s = readStickerPref().size; return STICKER_SIZES.indexOf(s) >= 0 ? s : 'default'; }
    function stickerTilt() { var t = readStickerPref().tilt; return STICKER_TILTS.indexOf(t) >= 0 ? t : 'left'; }
    function stickerIconHtml() {
      var p = readStickerPref();
      if (p.kind === 'emoji' && p.value) return '<span class="mms-sticker-emoji" aria-hidden="true">' + escapeHtml(p.value) + '</span>';
      if (p.kind === 'custom') return '<img class="mms-sticker-ic" src="/api/me/sticker' + (p.v ? '?v=' + encodeURIComponent(p.v) : '') + '" alt="" />';
      return '<img class="mms-sticker-ic" src="/favicon.svg" alt="" />';
    }
    function liveRate() {
      var mp = hostCtl('media-player');
      var r = mp && Number(mp.playbackRate);
      return (r && MMS_SPEED_RATES.indexOf(r) !== -1) ? r : 1;
    }
    function liveLoop() {
      var pl = stickerPlayer();
      try { return !!(pl && typeof pl.isLoopEnabled === 'function' && pl.isLoopEnabled()); } catch (_) { return false; }
    }
    function extrasEligible() {
      if (!extrasCfg || !inMainDoc) return false;
      try { return !!extrasCfg.isEligible(); } catch (_) { return false; }
    }
    function buildStickerMenuHtml() {
      var rate = liveRate();
      var speed = MMS_SPEED_RATES.map(function (r) {
        var on = r === rate;
        return '<button type="button" role="menuitemradio" class="mms-sm-opt' + (on ? ' is-on' : '') +
          '" data-skin-speed="' + r + '" aria-checked="' + (on ? 'true' : 'false') + '">' +
          (r === 1 ? 'Normal' : r + '×') + '</button>';
      }).join('');
      var loopOn = liveLoop();
      var skins = SKINS.SKINS || [];
      var active = (typeof SKINS.activeSkinId === 'function') ? SKINS.activeSkinId() : '';
      // v1.257 (QA S3) -> v1.258 (Dean's colorway round): inside the TRAY the chips are
      // FILTERED to the ipod family - those picks genuinely restyle the tray (the
      // silver/black body palettes are the colorways); non-family picks would visibly
      // no-op there and stay hidden. NOTE the pick still writes the GLOBAL skin pref
      // (the tray colorway IS the skin choice - disclosed).
      var trayActive = false;
      if (!inMainDoc && stickerCfg.tray && typeof stickerCfg.tray.enabled === 'function') {
        try { trayActive = !!stickerCfg.tray.enabled(); } catch (_) { trayActive = false; }
      }
      var chipSkins = trayActive ? skins.filter(function (s) { return s.id === 'ipod' || s.id === 'ipod-black'; }) : skins;
      var chips = chipSkins.map(function (s) {
        var on = s.id === active;
        return '<button type="button" role="menuitemradio" class="mms-sm-chip' + (on ? ' is-on' : '') +
          '" data-skin-pick="' + escapeHtml(s.id) + '" aria-checked="' + (on ? 'true' : 'false') + '">' +
          escapeHtml(s.label) + '</button>';
      }).join('');
      // v1.252 (Listen-mode): the "Watch" way back - rendered ONLY when the view supplies
      // the watchBack hook AND says it applies to the playing item (music: a listen track).
      // Rides the Extras row chassis (44px full-width) with its own dispatch hook.
      var watchBack = '';
      // QA gate S4: main-document only, the extras posture - a pop-out row navigating the
      // window BEHIND the always-on-top pop-out would be the exact confusion extras avoids.
      if (inMainDoc && stickerCfg.watchBack && typeof stickerCfg.watchBack.visible === 'function') {
        var wbOn = false;
        try { wbOn = !!stickerCfg.watchBack.visible(); } catch (_) { wbOn = false; }
        if (wbOn) watchBack = '<div class="mms-sm-sec"><button type="button" class="mms-sm-extras" data-skin-watchback><span class="mms-sm-lbl"><i class="icon-tv"></i>Watch</span><span class="mms-sm-state">&rsaquo;</span></button></div>';
      }
      // v1.254 (ENDLESS AUTOPLAY): the toggle rides page 1 like Loop - rendered only when
      // the view supplies the autoplay hook (music does; podcasts deliberately not). On
      // BOTH surfaces (the setting is device-global localStorage, so the pop-out toggling
      // it is coherent - unlike watchBack's navigation, nothing window-bound happens).
      var autoplay = '';
      if (stickerCfg.autoplay && typeof stickerCfg.autoplay.enabled === 'function') {
        var apOn = false;
        try { apOn = !!stickerCfg.autoplay.enabled(); } catch (_) { apOn = false; }
        autoplay = '<div class="mms-sm-sec"><button type="button" role="menuitemcheckbox" class="mms-sm-loop' + (apOn ? ' is-on' : '') +
          '" data-skin-autoplay aria-checked="' + (apOn ? 'true' : 'false') + '"><span class="mms-sm-lbl"><i class="icon-play"></i>Autoplay</span><span class="mms-sm-state">' + (apOn ? 'On' : 'Off') + '</span></button></div>';
      }
      // v1.257 (TRAY PLAYER): the pop-out-ONLY row - the first !inMainDoc-gated one (the
      // inverse of watchBack/Extras): a tray toggle makes no sense in the tab, and the
      // hook only exists when the pop-out shell injected it.
      var trayRow = '';
      if (!inMainDoc && stickerCfg.tray && typeof stickerCfg.tray.enabled === 'function') {
        var trOn = false;
        try { trOn = !!stickerCfg.tray.enabled(); } catch (_) { trOn = false; }
        trayRow = '<div class="mms-sm-sec"><button type="button" role="menuitemcheckbox" class="mms-sm-loop' + (trOn ? ' is-on' : '') +
          '" data-skin-tray aria-checked="' + (trOn ? 'true' : 'false') + '"><span class="mms-sm-lbl"><i class="icon-download"></i>Tray</span><span class="mms-sm-state">' + (trOn ? 'On' : 'Off') + '</span></button></div>';
      }
      // v1.249: the second-page entry - library-backed tracks on the in-tab surface only.
      var extras = extrasEligible()
        ? '<div class="mms-sm-sec"><button type="button" class="mms-sm-extras" data-skin-extras><span class="mms-sm-lbl"><i class="icon-more"></i>Extras</span><span class="mms-sm-state">&rsaquo;</span></button></div>'
        : '';
      return '<div class="mms-sm-sec"><div class="mms-sm-h">Speed</div><div class="mms-sm-speed">' + speed + '</div></div>' +
        '<div class="mms-sm-sec"><button type="button" role="menuitemcheckbox" class="mms-sm-loop' + (loopOn ? ' is-on' : '') +
        '" data-skin-loop aria-checked="' + (loopOn ? 'true' : 'false') + '"><span class="mms-sm-lbl"><i class="icon-refresh"></i>Loop</span><span class="mms-sm-state">' + (loopOn ? 'On' : 'Off') + '</span></button></div>' +
        autoplay + trayRow +
        '<div class="mms-sm-sec"><div class="mms-sm-h">' + (trayActive ? 'Color' : 'Skin') + '</div><div class="mms-sm-skins">' + chips + '</div></div>' +
        watchBack + extras;
    }
    // Inject the sticker + its (initially hidden) menu into a freshly-painted panel. The
    // v1.240 marker keys off what stickerIconHtml ACTUALLY renders (a partial emoji pref
    // with no value falls through to the logo image and must be un-circled - both seats).
    function injectSticker() {
      var wrap = doc.createElement('div');
      wrap.className = 'mms-sticker-wrap';
      var pref = readStickerPref();
      var imgCls = (pref.kind === 'emoji' && pref.value) ? '' : ' mms-sticker--img';
      var szCls = ' mms-sticker-sz-' + stickerSize();     // default | 2x | 3x
      var tiltCls = ' mms-sticker-tilt-' + stickerTilt();  // straight | left | right
      wrap.innerHTML =
        '<button type="button" class="mms-sticker' + imgCls + szCls + tiltCls + '" data-skin-sticker aria-haspopup="true" aria-expanded="false" aria-label="Player options">' + stickerIconHtml() + '</button>' +
        '<div class="mms-sticker-menu" data-skin-sticker-menu role="menu" hidden>' + buildStickerMenuHtml() + '</div>';
      panel.appendChild(wrap);
    }
    function refreshStickerMenu() {
      var menu = panel.querySelector('[data-skin-sticker-menu]');
      if (!menu) return;
      // Always lands on page 1: a reopen/back never resumes a stale Extras page, and bumping
      // the token invalidates any in-flight Extras fetch (v1.249).
      extrasReqToken++;
      menu.removeAttribute('data-sm-page');
      menu.innerHTML = buildStickerMenuHtml();
    }
    function closeStickerMenu() {
      var menu = panel.querySelector('[data-skin-sticker-menu]');
      var btn = panel.querySelector('[data-skin-sticker]');
      if (menu) menu.hidden = true;
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
    function applyStickerSpeed(rate) {
      var r = Number(rate);
      if (MMS_SPEED_RATES.indexOf(r) === -1) return;
      var mp = hostCtl('media-player');
      if (mp) {
        mp.playbackRate = r;
        // v1.238 gate CRITICAL (both seats): set defaultPlaybackRate TOO. The HTML load()
        // algorithm resets playbackRate to defaultPlaybackRate on every new resource, and
        // player.js reads ft-rate only ONCE at page init - so WITHOUT this the chosen rate
        // silently reverts to 1x on the next track's load() (the v1.22.1 bug class).
        mp.defaultPlaybackRate = r;
      }
      try { window.localStorage.setItem(RATE_KEY, String(r)); } catch (_) { /* best-effort */ }
    }
    function toggleStickerLoop() {
      var pl = stickerPlayer();
      if (pl && typeof pl.setLoop === 'function') pl.setLoop(!liveLoop());
    }

    // ---- the v1.249 Extras page (present only when the view supplies extras hooks) --------
    var extrasItem = null;     // the /api/videos/:id payload the OPEN page renders
    var extrasReqToken = 0;    // TOCTOU guard: only the newest open's fetch may render (v1.104 scar)
    var extrasReheatTimer = null;
    var extrasReheatAbortHooked = false;
    function extrasSignal() { return (extrasCfg && extrasCfg.signal) || null; }
    function extrasBaseId() {
      if (!extrasCfg) return null;
      try { return extrasCfg.getBaseId() || null; } catch (_) { return null; }
    }
    function extrasBackHtml() {
      return '<div class="mms-sm-sec"><button type="button" class="mms-sm-back" data-skin-extras-back>&lsaquo; Back</button></div>';
    }
    function buildExtrasNoteHtml(msg) {
      return extrasBackHtml() + '<div class="mms-sm-sec"><div class="mms-sm-note">' + escapeHtml(msg) + '</div></div>';
    }
    function extrasCanModifyLibrary() {
      // The same capability derivation watch.js uses, via the cached shared fetchCurrentUser
      // (one /api/auth/me per page). Fail CLOSED: no probe / signed-out -> no Move/Delete
      // (the server enforces regardless).
      if (typeof window.fetchCurrentUser !== 'function') return Promise.resolve(false);
      return window.fetchCurrentUser()
        .then(function (me) { return !!(me && me.user && (me.user.role === 'admin' || me.user.canModifyLibrary === true)); })
        .catch(function () { return false; });
    }
    function buildExtrasHtml(item, canModify) {
      var hasWatchUrl = typeof item.watchUrl === 'string' && item.watchUrl !== '';
      var liked = item.liked === true;
      var watched = item.watchState === 'watched';
      var acts = [];
      if (hasWatchUrl) acts.push('<button type="button" class="mms-sm-act" data-skin-x="share"><i class="icon-share"></i>Share</button>');
      acts.push('<a class="mms-sm-act" data-skin-x="download" href="/video/' + encodeURIComponent(item.id) + '?download=1" download><i class="icon-download"></i>Download</a>');
      acts.push('<button type="button" class="mms-sm-act' + (liked ? ' is-on' : '') + '" data-skin-x="like" aria-pressed="' + (liked ? 'true' : 'false') + '"><i class="icon-heart"></i><span class="mms-sm-actlbl">' + (liked ? 'Liked' : 'Like') + '</span>' + '</button>');
      acts.push('<button type="button" class="mms-sm-act' + (watched ? ' is-on' : '') + '" data-skin-x="watched" aria-pressed="' + (watched ? 'true' : 'false') + '"><i class="icon-history"></i><span class="mms-sm-actlbl">' + (watched ? 'Watched' : 'Mark watched') + '</span>' + '</button>');
      acts.push('<button type="button" class="mms-sm-act" data-skin-x="queue"><i class="icon-queue"></i>Add to queue</button>');
      acts.push('<button type="button" class="mms-sm-act" data-skin-x="queue-next"><i class="icon-play"></i>Play next</button>');
      if (item.hasSubtitles === true) acts.push('<button type="button" class="mms-sm-act" data-skin-x="transcript"><i class="icon-transcript"></i>Transcript</button>');
      if (hasWatchUrl) acts.push('<button type="button" class="mms-sm-act" data-skin-x="reheat"><i class="icon-flame"></i>Reheat</button>');
      if (canModify) {
        acts.push('<button type="button" class="mms-sm-act" data-skin-x="move"><i class="icon-folder"></i>Move to...</button>');
        acts.push('<button type="button" class="mms-sm-act mms-sm-danger" data-skin-x="delete"><i class="icon-delete"></i>Delete</button>');
      }
      return extrasBackHtml() +
        '<div class="mms-sm-sec"><div class="mms-sm-title">' + escapeHtml(item.title || '') + '</div>' +
        '<div class="mms-sm-acts">' + acts.join('') + '</div></div>';
    }
    function openStickerExtras() {
      var menu = panel.querySelector('[data-skin-sticker-menu]');
      var baseId = extrasBaseId();
      if (!menu || !baseId) return;
      var token = ++extrasReqToken;
      menu.setAttribute('data-sm-page', 'extras');
      menu.innerHTML = buildExtrasNoteHtml('Loading…');
      Promise.all([
        fetch('/api/videos/' + encodeURIComponent(baseId))
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; }),
        extrasCanModifyLibrary(),
      ]).then(function (rs) {
        // Post-await re-checks (the TOCTOU scar): the newest open only, the menu still
        // mounted+open+on this page, and the SAME track still live (an auto-advance
        // repaints the panel, detaching this menu node).
        if (token !== extrasReqToken) return;
        if (!menu.isConnected || menu.hidden || menu.getAttribute('data-sm-page') !== 'extras') return;
        if (extrasBaseId() !== baseId) return;
        var item = rs[0];
        if (!item || item.id !== baseId) { menu.innerHTML = buildExtrasNoteHtml('Extras aren’t available for this track.'); return; }
        extrasItem = item;
        menu.innerHTML = buildExtrasHtml(item, rs[1]);
      });
    }
    function extrasToast(msg) {
      if (typeof window.showToast === 'function') window.showToast(msg);
    }
    function extrasShare(item) {
      var base = item.watchUrl;
      var run = function (u) {
        if (typeof window.shareExternalUrl !== 'function') return;
        window.shareExternalUrl(u, item.title).then(function (outcome) {
          // No persistent button to relabel here - the desktop-fallback clipboard write
          // gets its feedback as a toast (watch.js parity).
          if (outcome === 'copied') extrasToast('Link copied');
        });
      };
      var pl = stickerPlayer();
      var t = (pl && typeof pl.getCurrentTime === 'function') ? pl.getCurrentTime() : null;
      var sig = extrasSignal();
      if (typeof t === 'number' && isFinite(t) && t >= 1 &&
        typeof window.showChoiceModal === 'function' && typeof window.withShareStartTime === 'function') {
        var dismiss = window.showChoiceModal('Share', [
          { label: 'Share song', onPick: function () { run(base); } },
          { label: 'Share at current time (' + fmtTime(t) + ')', onPick: function () { run(window.withShareStartTime(base, t)); } },
        ]);
        if (typeof dismiss === 'function' && sig) sig.addEventListener('abort', dismiss, { once: true });
        return;
      }
      run(base);
    }
    // Like/Watched share one toggle shape: POST adds, DELETE removes, the rendered button
    // flips ONLY on a 2xx (the server is the truth; a failure leaves the shown state alone).
    function extrasToggleFlag(el, item, kind) {
      var on = kind === 'like' ? item.liked === true : item.watchState === 'watched';
      var url = (kind === 'like' ? '/api/liked/' : '/api/watched/') + encodeURIComponent(item.id);
      fetch(url, { method: on ? 'DELETE' : 'POST' })
        .then(function (res) {
          if (!res.ok) { extrasToast(kind === 'like' ? 'Could not update Like.' : 'Could not update Watched.'); return; }
          if (kind === 'like') {
            item.liked = !on;
            // QA gate (the v1.33.1 class): the count-gated Liked sidebar entry caches its
            // total per session - re-prime it so home reflects this like without a reload.
            if (typeof window.fetchLikedTotal === 'function') window.fetchLikedTotal(true);
          } else {
            item.watchState = on ? 'unwatched' : 'watched';
          }
          if (!el || !el.isConnected) return;
          var nowOn = !on;
          el.classList.toggle('is-on', nowOn);
          el.setAttribute('aria-pressed', nowOn ? 'true' : 'false');
          // v1.255 slim-gate CRITICAL: write ONLY the label span - a bare el.textContent
          // assignment destroys the row's glyph <i> (this wave's own feature) on the
          // menu's most-tapped rows. The || el fallback keeps a span-less row honest.
          var lbl = el.querySelector('.mms-sm-actlbl');
          (lbl || el).textContent = kind === 'like' ? (nowOn ? 'Liked' : 'Like') : (nowOn ? 'Watched' : 'Mark watched');
        })
        .catch(function () { extrasToast(kind === 'like' ? 'Could not update Like.' : 'Could not update Watched.'); });
    }
    function extrasTranscript(item, el) {
      if (typeof window.openTranscriptFor !== 'function') return;
      window.openTranscriptFor({
        id: item.id,
        title: item.title || 'Transcript',
        signal: extrasSignal(),
        onBusy: function (busy) { if (el && el.isConnected) el.disabled = busy; },
      });
    }
    function stopExtrasReheatPoll() {
      if (extrasReheatTimer) { clearInterval(extrasReheatTimer); extrasReheatTimer = null; }
    }
    // Compact, honest outcome line (watch.js describeReheat says WHAT changed; this surface
    // has no page to re-render, so it reports only the verdict - never claiming a refresh
    // that may not have happened).
    function extrasReheatToastFor(entry) {
      if (entry.outcome === 'failed') return 'Reheat did not complete. Some metadata may have been saved; try again.';
      if (entry.networkRan === false) return 'No YouTube source found for this track, so there was nothing to refresh.';
      return 'Reheat finished.';
    }
    function extrasReheat(item) {
      var id = item.id;
      fetch('/api/ytdlp/repull-metadata/item/' + encodeURIComponent(id), { method: 'POST' })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (body) { return { status: res.status, body: body }; }); })
        .then(function (r) {
          if (r.status === 202) { extrasToast('Reheating…'); pollExtrasReheat(id); return; }
          if (r.status === 409) { extrasToast('A reheat is already running.'); return; }
          // QA gate: the REAL route's 404 carries an error body; on an install with the
          // yt-dlp module OFF the route doesn't exist at all, so Express's HTML 404 parses
          // to {} - saying "no source" there would be a lie (the module is off).
          if (r.status === 404) { extrasToast((r.body && r.body.error) ? 'This track has no source to reheat from.' : 'Reheat isn’t available on this server.'); return; }
          if (r.status === 403) { extrasToast('Read-only mode: reheat is disabled on this instance.'); return; }
          extrasToast((r.body && r.body.error) || 'Reheat could not be started.');
        })
        .catch(function () { extrasToast('Reheat could not be started.'); });
    }
    function pollExtrasReheat(id) {
      stopExtrasReheatPoll();
      var elapsed = 0;
      var everyMs = 1000;
      // Same ceiling rationale as watch.js: under activity.js's one-shot TTL, and giving up
      // stops only the POLL - the job still lands server-side.
      var ceilingMs = 4 * 60 * 1000;
      var sig = extrasSignal();
      extrasReheatTimer = setInterval(function () {
        elapsed += everyMs;
        if (elapsed >= ceilingMs) {
          stopExtrasReheatPoll();
          extrasToast('Reheat is taking a while; check the activity chip.');
          return;
        }
        fetch('/api/subscriptions/status')
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (snapshot) {
            if (sig && sig.aborted) { stopExtrasReheatPoll(); return; }
            var entry = snapshot && snapshot.oneShots && snapshot.oneShots['repull-metadata-item'];
            if (!entry || entry.state === 'running' || entry.state === 'queued') return;
            // A stale terminal entry from a PREVIOUS item's reheat is reachable (fixed
            // one-shot key, minutes-long TTL) - never report someone else's result as ours.
            if (entry.mediaId && entry.mediaId !== id) return;
            stopExtrasReheatPoll();
            if (entry.state === 'error') { extrasToast('Reheat failed.'); return; }
            extrasToast(extrasReheatToastFor(entry));
          })
          .catch(function () { /* transient poll failure - try again next tick */ });
      }, everyMs);
      if (!extrasReheatAbortHooked && sig) {
        extrasReheatAbortHooked = true;
        sig.addEventListener('abort', stopExtrasReheatPoll, { once: true });
      }
    }
    // A successful Move/Delete removes (or re-keys) the item the player holds: playback was
    // already close()d; the VIEW clears its playing state and refreshes via onMutated.
    function afterExtrasMutation() {
      extrasItem = null;
      // QA gate (v1.33.1 class, watch.js delete parity): deleting a LIKED item changes the
      // count the sidebar's session cache gates on - re-prime it.
      if (typeof window.fetchLikedTotal === 'function') window.fetchLikedTotal(true);
      if (extrasCfg && typeof extrasCfg.onMutated === 'function') { try { extrasCfg.onMutated(); } catch (_) { /* view refresh best-effort */ } }
    }
    function extrasMove(item) {
      if (typeof window.showMoveModal !== 'function' || typeof window.requestMoveItem !== 'function') return;
      var sig = extrasSignal();
      fetch('/api/config')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (cfg) {
          if (sig && sig.aborted) return;
          var folders = (cfg && cfg.folders) || [];
          window.showMoveModal(item, folders, function (targetFolder, ctl) {
            ctl.statusEl.textContent = 'Moving...';
            window.requestMoveItem(item.id, targetFolder)
              .then(function () {
                ctl.teardown();
                extrasToast('File moved.');
                // The move RE-KEYS the item (server C1): the player still holds the OLD id
                // and would 404 mid-playback - stop it now that the move SUCCEEDED (a failed
                // move keeps the modal open and the track playing; closing before the
                // request would kill playback on every retry - watch.js ordering).
                var pl = stickerPlayer();
                if (pl && typeof pl.close === 'function') pl.close();
                afterExtrasMutation();
              })
              .catch(function (err) {
                ctl.statusEl.textContent = (err && err.message) || 'Move failed.';
                if (typeof ctl.reenable === 'function') ctl.reenable();
              });
          });
        })
        .catch(function () { extrasToast('Could not load the folder list.'); });
    }
    function extrasDelete(item) {
      var doDelete = function () {
        // Release the about-to-be-deleted resource before the DELETE (watch.js parity).
        var pl = stickerPlayer();
        if (pl && typeof pl.close === 'function') pl.close();
        fetch('/api/videos/' + encodeURIComponent(item.id), { method: 'DELETE' })
          .then(function (res) {
            if (res.status === 403) { extrasToast("You don't have permission to delete library files."); return null; }
            return res.json();
          })
          .then(function (data) {
            if (!data) return;
            if (data.success) {
              extrasToast(typeof window.deleteResultToast === 'function' ? window.deleteResultToast(data) : 'Deleted.');
              afterExtrasMutation();
            } else {
              extrasToast('Error deleting file: ' + (data.error || 'unknown error'));
            }
          })
          .catch(function () { extrasToast('Network error occurred while trying to delete file.'); });
      };
      // The same two-flow split as the watch page: a yt-dlp-managed item is re-downloadable
      // -> the trash confirm; a local file is irreplaceable -> the escalated checkbox-gated
      // hard-delete modal.
      if (typeof window.isYtdlpManagedItem === 'function' && window.isYtdlpManagedItem(item)) {
        if (typeof window.showConfirmModal !== 'function') return;
        window.showConfirmModal(
          'Move to Trash?',
          'Move <strong>' + escapeHtml(item.title || '') + '</strong> to Trash?<br><br><span style="color:var(--yt-red); font-weight:bold;">The file leaves your library now and is permanently removed when the Trash retention window empties it:</span><br><code style="word-break:break-all; font-size:11px;">' + escapeHtml(item.filePath || '') + '</code>',
          doDelete
        );
      } else if (typeof window.showHardDeleteModal === 'function') {
        window.showHardDeleteModal(item, doDelete);
      }
    }
    function handleExtrasAction(act, el) {
      var item = extrasItem;
      if (!item || !item.id) return;
      if (act === 'download') { closeStickerMenu(); return; } // the anchor's own navigation does the work
      if (act === 'share') { closeStickerMenu(); extrasShare(item); return; }
      if (act === 'like') { extrasToggleFlag(el, item, 'like'); return; }
      if (act === 'watched') { extrasToggleFlag(el, item, 'watched'); return; }
      if (act === 'queue') { closeStickerMenu(); if (typeof window.addToQueue === 'function') window.addToQueue(item.id, 'end'); return; }
      if (act === 'queue-next') { closeStickerMenu(); if (typeof window.addToQueue === 'function') window.addToQueue(item.id, 'next'); return; }
      if (act === 'transcript') { closeStickerMenu(); extrasTranscript(item, el); return; }
      if (act === 'reheat') { closeStickerMenu(); extrasReheat(item); return; }
      if (act === 'move') { closeStickerMenu(); extrasMove(item); return; }
      if (act === 'delete') { closeStickerMenu(); extrasDelete(item); }
    }
    // The sticker's slice of the delegated click dispatch. Returns true when it consumed
    // the click (the caller returns) - ORDER MATTERS: these run before the transport hooks
    // so a menu tap never falls through to a surface behind it.
    function handleStickerClick(e) {
      if (!stickerCfg) return false;
      if (e.target.closest('[data-skin-sticker]')) {
        var mn = panel.querySelector('[data-skin-sticker-menu]');
        var sbtn = panel.querySelector('[data-skin-sticker]');
        if (mn) {
          var willOpen = mn.hidden;
          if (willOpen) refreshStickerMenu(); // reflect the live rate/loop/skin on open
          mn.hidden = !willOpen;
          if (sbtn) sbtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        }
        e.stopPropagation();
        return true;
      }
      if (e.target.closest('[data-skin-watchback]')) {
        closeStickerMenu();
        if (stickerCfg.watchBack && typeof stickerCfg.watchBack.onTap === 'function') { try { stickerCfg.watchBack.onTap(); } catch (_) { /* view nav best-effort */ } }
        return true;
      }
      if (e.target.closest('[data-skin-extras]')) { openStickerExtras(); return true; }
      if (e.target.closest('[data-skin-extras-back]')) { refreshStickerMenu(); return true; }
      var xact = e.target.closest('[data-skin-x]');
      if (xact) { handleExtrasAction(xact.getAttribute('data-skin-x'), xact); return true; }
      var spOpt = e.target.closest('[data-skin-speed]');
      if (spOpt) { applyStickerSpeed(spOpt.getAttribute('data-skin-speed')); refreshStickerMenu(); return true; }
      if (e.target.closest('[data-skin-loop]')) { toggleStickerLoop(); refreshStickerMenu(); return true; }
      // v1.257: the tray toggle - the shell tears this window down and reopens at the
      // new dims, so no re-render here (this document is about to die).
      if (e.target.closest('[data-skin-tray]')) {
        if (stickerCfg.tray && typeof stickerCfg.tray.onToggle === 'function') { try { stickerCfg.tray.onToggle(); } catch (_) { /* shell best-effort */ } }
        return true;
      }
      // v1.254: the autoplay toggle - flip via the view's hook, re-render for the new state.
      if (e.target.closest('[data-skin-autoplay]')) {
        if (stickerCfg.autoplay && typeof stickerCfg.autoplay.onToggle === 'function') { try { stickerCfg.autoplay.onToggle(); } catch (_) { /* view toggle best-effort */ } }
        refreshStickerMenu();
        return true;
      }
      var pick = e.target.closest('[data-skin-pick]');
      if (pick) {
        var sid = pick.getAttribute('data-skin-pick');
        if (typeof SKINS.setActiveSkin === 'function') SKINS.setActiveSkin(sid);
        closeStickerMenu();
        if (typeof stickerCfg.onSkinChange === 'function') stickerCfg.onSkinChange(); // re-render with the new skin
        return true;
      }
      // v1.258.1 slim-gate W1: a tap on the menu's own DEAD SPACE (headings, section
      // padding - anything that is not a control) CLOSES it. The tray's full-window
      // overlay left a 6px rim as the only non-mutating exit; this gives every surface
      // the standard dismiss instead. Controls are all button/a, so the guard is exact.
      if (e.target.closest('[data-skin-sticker-menu]') && !e.target.closest('button, a')) {
        closeStickerMenu();
        return true;
      }
      // A click anywhere that is NOT inside the sticker wrap closes an open menu (then
      // falls through to normal handling so the tapped control still acts).
      var openSm = panel.querySelector('[data-skin-sticker-menu]:not([hidden])');
      if (openSm && !e.target.closest('.mms-sticker-wrap')) closeStickerMenu();
      return false;
    }

    // ---- v1.232 marquee: overflowing title/artist/album lines scroll like a real iPod ----
    // Only when motion is allowed (else the line keeps its ellipsis). Wraps the text in a
    // .mms-mq span + sets the shift distance + a constant-speed duration as CSS vars; the
    // .mms-marquee keyframe animates it. textContent both ways -> no injection.
    function applyMarquee() {
      if (!panel) return;
      try { if (win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (_) { /* keep going */ }
      var els = panel.querySelectorAll('.ip-ttl, .ip-artist, .ip-album, .mms-ttl, .mms-sub, .mms-ctx');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var over = el.scrollWidth - el.clientWidth;
        if (over > 2 && !el.querySelector('.mms-mq')) {
          var span = doc.createElement('span');
          span.className = 'mms-mq';
          span.textContent = el.textContent;
          el.textContent = '';
          el.appendChild(span);
          el.classList.add('mms-mq-on');
          el.style.setProperty('--mms-mq-shift', (-over) + 'px');
          el.style.setProperty('--mms-mq-dur', Math.max(4, over / 24).toFixed(1) + 's');
        }
      }
    }

    // ---- move the list cursor to position `pos` (clamped); edge-follow scroll like an iPod ----
    function setWheelCursor(pos, center) {
      var lv = panel && panel.querySelector('.ip-listview'); if (!lv) return;
      var rows = lv.querySelectorAll('.mms-row'); if (!rows.length) return;
      pos = Math.max(0, Math.min(rows.length - 1, pos));
      wheelCursorRow = pos;
      for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('is-cursor', i === pos);
      var el = rows[pos];
      var raf = (win && win.requestAnimationFrame) || function (cb) { return setTimeout(cb, 0); };
      raf(function () {
        var top = el.offsetTop - lv.offsetTop;
        if (center) lv.scrollTop = Math.max(0, top - (lv.clientHeight / 2) + (el.offsetHeight / 2));
        else if (top < lv.scrollTop) lv.scrollTop = top;
        else if (top + el.offsetHeight > lv.scrollTop + lv.clientHeight) lv.scrollTop = top + el.offsetHeight - lv.clientHeight;
      });
    }
    function setListMode(on) {
      if (!panel) return;
      panel.classList.toggle('mms-listmode', !!on);
      var npEl = panel.querySelector('.ip-np');
      if (npEl) npEl.textContent = on ? 'Songs' : 'Now Playing';
      if (on) {
        var lv = panel.querySelector('.ip-listview');
        var rows = lv ? lv.querySelectorAll('.mms-row') : [];
        var startPos = 0;
        for (var i = 0; i < rows.length; i++) { if (rows[i].classList.contains('is-current')) { startPos = i; break; } }
        setWheelCursor(startPos, true);
      } else {
        var cr = panel.querySelector('.ip-listview .mms-row.is-cursor');
        if (cr) cr.classList.remove('is-cursor');
        wheelCursorRow = -1;
      }
    }

    // ---- render the chosen skin into the panel from the view's ctx ----
    function paint() {
      var id = getSkinId();
      var base = (typeof SKINS.skinById === 'function' && (SKINS.skinById(id) || {}).base) || '';
      panel.className = 'music-nowplaying-panel mms mms-full mms-' + id + (base ? ' mms-' + base : '');
      wheelSpin = null; // a re-render detaches the wheel; drop any mid-gesture state (music parity)
      panel.innerHTML = SKINS.renderFull(id, getCtx());
      panel.hidden = false;
      // Adversarial gate W1 (v1.250): shimmerArt lives on the MAIN window - a pop-out is a
      // blank scriptless window, so win.FileTube is undefined there and the art-shimmer would
      // never clear (a permanent sweep on a slow/404 cover). shimmerArt works cross-document
      // (panel.querySelectorAll), exactly how the old music.js paintSkin called it.
      if (typeof window !== 'undefined' && window.FileTube && typeof window.FileTube.shimmerArt === 'function') window.FileTube.shimmerArt(panel);
      if (stickerCfg) injectSticker(); // v1.238: the quick-menu sticker on every skin paint
      mountWheelGhost(); // v1.256: the haptic ghost (capable devices + a wheel skin only)
      if (marqueeOn) {
        // measure + start the marquee AFTER layout (rAF), so scrollWidth is real (music parity).
        var raf = (win && win.requestAnimationFrame) || function (cb) { return setTimeout(cb, 0); };
        raf(function () { applyMarquee(); });
      }
      if (!bound) bind();
    }

    // ---- the delegated click proxy (transport/seek/list/menu) ----
    function bind() {
      if (bound) return; bound = true;
      panel.addEventListener('click', onClick);
      panel.addEventListener('pointerdown', onDown);
    }
    function onClick(e) {
      if (wheelSuppressClick) { wheelSuppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
      healGhostLock(); // v1.256: any tap self-heals a lock whose ghost the view tore down
      // v1.256: a click whose target is the invisible ghost belongs to the zone/center
      // under it. We route by re-dispatching a click on the REAL control - its own
      // handlers (incl. this delegated one, re-entered with a non-ghost target) run
      // untouched. The ghost's own toggle still happened (one stray tick on a zone tap -
      // accepted in the plan; arguably authentic, the Classic clicked on presses too).
      if (wheelGhost && e.target === wheelGhost) {
        var under = realTargetUnder(e);
        if (under && under !== wheelGhost && under.click) { e.stopPropagation(); under.click(); }
        return;
      }
      if (handleStickerClick(e)) return; // sticker/extras taps never fall through to transport
      if (e.target.closest('[data-skin-play]')) { var pb = hostCtl('pp-btn'); if (pb) pb.click(); return; }
      if (e.target.closest('[data-skin-prev]')) { var pv = hostCtl('track-prev-btn'); if (pv) pv.click(); return; }
      if (e.target.closest('[data-skin-next]')) { var nx = hostCtl('track-next-btn'); if (nx) nx.click(); return; }
      if (e.target.closest('[data-skin-collapse]')) { onDock(); return; }
      if (onShuffle && e.target.closest('[data-skin-shuffle]')) { onShuffle(); return; }
      if (e.target.closest('[data-skin-menu]')) {
        if (panel.classList.contains('mms-listmode')) { setListMode(false); }
        else { onDock(); }
        return;
      }
      if (e.target.closest('[data-skin-select]')) {
        if (panel.classList.contains('mms-listmode')) {
          var cur = panel.querySelector('.ip-listview .mms-row.is-cursor');
          var cgi = cur && parseInt(cur.getAttribute('data-skin-go'), 10);
          setListMode(false);
          if (cur && !isNaN(cgi)) onSelectIndex(cgi);
        } else { setListMode(true); }
        return;
      }
      var seek = e.target.closest('[data-skin-seek]');
      if (seek) {
        var sb = hostCtl('seek-bar');
        if (sb) {
          var rct = seek.getBoundingClientRect();
          var f = Math.min(1, Math.max(0, (e.clientX - rct.left) / (rct.width || 1)));
          sb.value = String(f);
          sb.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return;
      }
      var sgo = e.target.closest('[data-skin-go]');
      if (sgo) { var gi = parseInt(sgo.getAttribute('data-skin-go'), 10); if (!isNaN(gi)) { setListMode(false); onSelectIndex(gi); } return; }
    }

    // ---- v1.256 WHEEL HAPTICS: real per-detent Taptic ticks (device-confirmed) --------
    // WebKit's switch POINTER-TRACKING haptic path (exempt from the iOS 26.5 click gate)
    // fires an OS tick each time the dragging finger crosses the switch's track midline,
    // re-evaluated per touchmove THROUGH CSS transforms. An invisible switch covers the
    // wheel (scaled, so every rotation touchstart lands ON it and arms tracking ~200ms
    // in); at gesture start it shrinks to ride unscaled under the finger, and each
    // HAPTIC_STEP_DEG of rotation flips a +-18px bias so the next move reads as a
    // crossing = one tick. HARD RULES (each broke a probe iteration): no touch-action
    // anywhere on the ghost's ancestor chain (the mms-haptic carve-out + a body scroll
    // lock replace .mms-full's touch-action:none); never preventDefault its touches;
    // NEVER write .checked from JS (kills tracking). Exec plan: wheel-haptics.md.
    var HAPTIC_STEP_DEG = 3.75; // v1.256.2 (Dean: 3deg "a little too hot... parity with the iPod Classic"): 96 detents/rev, the Classic's own number
    var HAPTIC_MIN_MS = 30;     // the Taptic engine's saturation floor - excess ticks DROP
    var wheelGhost = null;
    var bodyScrollLock = null;  // {y} while the haptic skin owns the body
    function hapticCapable() {
      try {
        var probe = doc.createElement('input');
        return ('switch' in probe) && ('ontouchstart' in win);
      } catch (_) { return false; }
    }
    function ghostRestTransform() { return 'scale(7.5)'; } // covers the whole wheel for touchstart arming
    function lockBodyScroll() {
      if (bodyScrollLock) return;
      try {
        bodyScrollLock = { y: win.scrollY || 0 };
        doc.body.style.position = 'fixed';
        doc.body.style.top = (-bodyScrollLock.y) + 'px';
        doc.body.style.left = '0'; doc.body.style.right = '0';
      } catch (_) { bodyScrollLock = null; }
    }
    function unlockBodyScroll() {
      if (!bodyScrollLock) return;
      var y = bodyScrollLock.y; bodyScrollLock = null;
      try {
        doc.body.style.position = ''; doc.body.style.top = '';
        doc.body.style.left = ''; doc.body.style.right = '';
        win.scrollTo(0, y);
      } catch (_) { /* best-effort restore */ }
    }
    function mountWheelGhost() {
      wheelGhost = null;
      if (!hapticCapable()) return;
      var wheel = panel.querySelector('.ip-wheel');
      if (!wheel) { unlockBodyScroll(); unwatchGhost(); panel.classList.remove('mms-haptic'); return; }
      var g = doc.createElement('input');
      g.type = 'checkbox';
      g.setAttribute('switch', '');
      g.className = 'mms-haptic-ghost';
      g.setAttribute('aria-hidden', 'true');
      g.tabIndex = -1;
      g.style.transform = ghostRestTransform();
      wheel.appendChild(g);
      wheelGhost = g;
      panel.classList.add('mms-haptic'); // CSS lifts .mms-full's touch-action:none (rule 1)
      lockBodyScroll();                  // ...and the body lock takes over scroll suppression
      watchGhost();                      // QA gate CRITICAL (v1.256): the lock's structural release - see watchGhost's header
    }
    function healGhostLock() {
      // The engine gets no callback when the VIEW tears the skin down without destroy()
      // (the v1.227 leak class) - self-heal whenever we notice the ghost is gone.
      if (bodyScrollLock && (!wheelGhost || !wheelGhost.isConnected)) {
        unlockBodyScroll();
        wheelGhost = null;
        unwatchGhost();
      }
    }
    // QA gate CRITICAL (v1.256 round 1): a PAUSED dock strands the lock - the view's
    // updateNowPlayingPanel clears the panel synchronously without destroy(), and with
    // the media paused NO reflect/click/endWheel ever runs again: the browse view is
    // pinned unscrollable. The event-driven heals cannot cover that path, so the lock's
    // PRIMARY release is structural: a MutationObserver on the panel unlocks the moment
    // the ghost leaves the DOM, whatever removed it (click-dock, OS-back, a future
    // teardown nobody has written yet). The reflect/click heals stay as belt-and-braces
    // for engines without MutationObserver (no capable device lacks it).
    var ghostObserver = null;
    function watchGhost() {
      if (ghostObserver) return;
      var MO = win.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
      if (!MO) return;
      ghostObserver = new MO(function () { healGhostLock(); });
      try { ghostObserver.observe(panel, { childList: true, subtree: true }); } catch (_) { ghostObserver = null; }
    }
    // Belt-and-braces only: the once-armed observer on the SAME panel node serves every
    // later ghost too (adversarial S2) - disconnect/re-arm sequencing is NOT load-bearing.
    function unwatchGhost() {
      if (ghostObserver) { try { ghostObserver.disconnect(); } catch (_) { /* gone */ } ghostObserver = null; }
    }
    // Route a click/press whose target is the invisible ghost to the REAL control under
    // it (zones/center are covered by the scaled ghost; their semantics must survive).
    // v1.256.1 (Dean's device round, the "every zone acts like the middle button" bug):
    // iOS synthesizes a CHECKBOX's click event at the CONTROL'S CENTER, not the touch
    // point - and the ghost is centered on the wheel, so routing by e.clientX/Y sent
    // every zone tap to the select button. The POINTERDOWN's coordinates are the real
    // finger (they are what makes the wheel gesture itself work) - stash them and route
    // the click with the stash. And resolve the hit UPWARD to a real control: the
    // deepest element over a zone is its <svg> glyph, and WebKit's SVGElement has no
    // .click() (a tap would have been silently swallowed).
    var ghostDownPoint = null; // {x, y} of the last pointerdown that targeted the ghost
    function realTargetUnder(e) {
      if (!wheelGhost || e.target !== wheelGhost) return e.target;
      var px = (ghostDownPoint && e.type === 'click') ? ghostDownPoint.x : e.clientX;
      var py = (ghostDownPoint && e.type === 'click') ? ghostDownPoint.y : e.clientY;
      try {
        var els = doc.elementsFromPoint(px, py);
        for (var i = 0; i < els.length; i++) {
          if (els[i] === wheelGhost) continue;
          var ctl = els[i].closest ? els[i].closest('.ip-zone, [data-skin-select], button, a') : null;
          return ctl || els[i];
        }
      } catch (_) { /* jsdom / older engines: fall through */ }
      return e.target;
    }
    function hapticGestureStart(st, e) {
      if (!wheelGhost || !wheelGhost.isConnected) return;
      st.hapAccum = 0; st.hapLast = 0; st.hapBias = 1;
      hapticPlaceGhost(st, e.clientX, e.clientY, false);
    }
    function hapticPlaceGhost(st, x, y, flip) {
      if (!wheelGhost || !wheelGhost.isConnected) return;
      var r = st.wheel.getBoundingClientRect();
      if (flip) st.hapBias = -st.hapBias;
      // unscaled under the finger, biased +-18px past the track midline (the probe-C math)
      var tx = (x - (r.left + r.width / 2)) + st.hapBias * 18;
      var ty = y - (r.top + r.height / 2);
      wheelGhost.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
    }
    function hapticOnMove(st, e, absD) {
      if (!wheelGhost || !wheelGhost.isConnected) return;
      st.hapAccum += absD;
      var flip = false;
      while (st.hapAccum >= HAPTIC_STEP_DEG) {
        st.hapAccum -= HAPTIC_STEP_DEG;
        var now = nowMs();
        if (now - st.hapLast >= HAPTIC_MIN_MS) { flip = true; st.hapLast = now; } // throttle: drop, never queue
      }
      hapticPlaceGhost(st, e.clientX, e.clientY, flip);
    }
    function hapticGestureEnd() {
      if (wheelGhost && wheelGhost.isConnected) wheelGhost.style.transform = ghostRestTransform();
      healGhostLock();
    }

    // ---- the click-wheel gesture: rotate = cursor (list) OR scrub (now playing) ----
    function endWheel(st, suppress) {
      var w = st.wheel;
      // v1.242: tear down any fast-scan hold-timer / interval on EVERY end arm (the v1.163
      // dual-arm teardown discipline) so a pointerup OR pointercancel stops the scan clean.
      if (st.scanTimer) { try { st.win.clearTimeout(st.scanTimer); } catch (_) { /* ignore */ } st.scanTimer = null; }
      if (st.scanInterval) { try { st.win.clearInterval(st.scanInterval); } catch (_) { /* ignore */ } st.scanInterval = null; }
      try { if (st.captured) w.releasePointerCapture(st.id); } catch (_) { /* not captured */ }
      w.removeEventListener('pointermove', st.onMove);
      w.removeEventListener('pointerup', st.onUp);
      w.removeEventListener('pointercancel', st.onUp);
      if (suppress) wheelSuppressClick = true;
      if (wheelSpin === st) wheelSpin = null;
      hapticGestureEnd(); // v1.256: ghost back to its arming cover, lock self-heal check
    }
    function onDown(e) {
      wheelSuppressClick = false;
      // v1.256.1 slim-gate CRITICAL: the stash must refresh on EVERY ghost press, BEFORE
      // any early return - written below the dead-center guard, a CENTER tap kept the
      // LAST ZONE'S stash and the lying click replayed that zone instead of Select.
      if (wheelGhost && e.target === wheelGhost) ghostDownPoint = { x: e.clientX, y: e.clientY };
      if (wheelSpin) return; // one gesture at a time
      var listMode = panel.classList.contains('mms-listmode');
      var wheel = e.target.closest('.ip-wheel'); if (!wheel) return;
      var r = wheel.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // ignore a press on the dead center (the Select button): let its tap pass through.
      if (Math.hypot(e.clientX - cx, e.clientY - cy) < r.width * 0.2) return;
      var st = {
        wheel: wheel, id: e.pointerId, captured: false, moved: false,
        // Now Playing is never idle: the wheel SCRUBS the timeline on EVERY surface
        // (Dean 2026-09-02 - the pop-out's old wheel-volume gave way to a consistent scrub).
        mode: listMode ? 'cursor' : 'scrub', scrubRatio: null,
        lastAngle: Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI,
        lastT: nowMs(), accum: 0, x0: e.clientX, y0: e.clientY, onMove: null, onUp: null,
        win: win, scanTimer: null, scanInterval: null, scanning: false, scanDir: 0,
      };
      // v1.242 fastScan: HOLD the rewind/ffwd zone to FAST-SCAN the timeline (~2x, audio keeps
      // playing); release resumes where it landed. Independent of st.mode - keyed off the
      // pressed ZONE. A quick TAP still skips a track (the hold never fires); a ROTATE becomes
      // a scrub/cursor (cancels the hold-timer). Steps currentTime on the PANEL's own window
      // timer so a Document-PiP pop-out (which throttles the opener) still scans.
      hapticGestureStart(st, e); // v1.256: ghost rides under the finger from the first move
      if (fastScan) {
        // v1.256: the scaled ghost covers the zones - route the press to the REAL control.
        var downTgt = realTargetUnder(e);
        st.scanDir = (downTgt.closest && downTgt.closest('[data-skin-next]')) ? 1 : ((downTgt.closest && downTgt.closest('[data-skin-prev]')) ? -1 : 0);
        var startScan = function () {
          var mp0 = hostCtl('media-player');
          var d0 = (mp0 && isFinite(mp0.duration) && mp0.duration > 0) ? mp0.duration : 0;
          if (!d0) return; // nothing to scan (still loading) - leave it a plain tap/skip
          st.scanning = true; st.moved = true; // moved => the release's skip click is suppressed
          try { st.wheel.setPointerCapture(st.id); st.captured = true; } catch (_) { /* best effort */ }
          var step = function () {
            var m = hostCtl('media-player');
            var d = (m && isFinite(m.duration) && m.duration > 0) ? m.duration : 0;
            if (!d) return;
            m.currentTime = Math.min(d, Math.max(0, (Number(m.currentTime) || 0) + st.scanDir * 0.4)); // ~2x realtime
          };
          step();                                   // react immediately on the hold, then keep going
          st.scanInterval = st.win.setInterval(step, 200);
        };
        if (st.scanDir) st.scanTimer = st.win.setTimeout(function () { st.scanTimer = null; if (!st.moved) startScan(); }, 400);
      }
      st.onMove = function (ev) {
        if (ev.pointerId !== st.id) return; // ignore a SECOND finger (jump guard)
        // v1.242 (gate WARNING): once a HOLD has engaged the fast-scan, the scan OWNS the
        // gesture until release - a subsequent rotation must NOT also scrub (else the scan
        // interval and the scrub branch fight over currentTime AND both commit on release).
        if (st.scanning) return;
        var ang = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
        var d = wheelShortAngle(ang - st.lastAngle); st.lastAngle = ang;
        var now = nowMs(); var dt = Math.max(1, now - st.lastT); st.lastT = now;
        st.accum += d;
        hapticOnMove(st, ev, Math.abs(d)); // v1.256: ticks in BOTH modes (cursor + scrub)
        if (!st.moved && Math.hypot(ev.clientX - st.x0, ev.clientY - st.y0) > 8) {
          st.moved = true;
          // a ROTATE is a scrub/cursor, not a scan: cancel the pending hold so it never scans.
          if (st.scanTimer) { try { st.win.clearTimeout(st.scanTimer); } catch (_) { /* ignore */ } st.scanTimer = null; }
          try { st.wheel.setPointerCapture(st.id); st.captured = true; } catch (_) { /* best effort */ }
        }
        if (st.mode === 'scrub') {
          var mps = hostCtl('media-player');
          var durS = (mps && isFinite(mps.duration) && mps.duration > 0) ? mps.duration : 0;
          if (durS > 0) {
            var sp = Math.abs(d) / dt;
            var accel = sp > 2.4 ? 5 : (sp > 1.2 ? 2.5 : (sp > 0.5 ? 1.5 : 1));
            var t2 = Math.min(durS, Math.max(0, (Number(mps.currentTime) || 0) + d * 0.05 * accel));
            try { mps.currentTime = t2; } catch (_) { /* ignore a bad set */ }
            st.scrubRatio = t2 / durS;
            reflect();
          }
          return;
        }
        // cursor mode: songs-per-step scales with angular speed (a slow turn = 1, a flick = several)
        var speed = Math.abs(d) / dt;
        var mult = speed > 2.4 ? 4 : (speed > 1.5 ? 3 : (speed > 0.8 ? 2 : 1));
        while (Math.abs(st.accum) >= WHEEL_STEP_DEG) {
          var sign = st.accum > 0 ? 1 : -1;
          st.moved = true;
          setWheelCursor(wheelCursorRow + sign * mult, false);
          st.accum -= sign * WHEEL_STEP_DEG;
        }
      };
      st.onUp = function (ev) {
        if (st.mode === 'scrub' && st.moved && ev && ev.type === 'pointerup' && st.scrubRatio != null) {
          var sb = hostCtl('seek-bar');
          if (sb) { sb.value = String(st.scrubRatio); sb.dispatchEvent(new Event('change', { bubbles: true })); }
        }
        // v1.242 fast-scan: a real pointerUP after a scan COMMITS the landed position through
        // the same seek pipeline (a pointercancel aborts with no commit, like scrub).
        if (st.scanning && ev && ev.type === 'pointerup') {
          var mpu = hostCtl('media-player');
          var du = (mpu && isFinite(mpu.duration) && mpu.duration > 0) ? mpu.duration : 0;
          if (du) { var sbu = hostCtl('seek-bar'); if (sbu) { sbu.value = String(Math.min(1, Math.max(0, (Number(mpu.currentTime) || 0) / du))); sbu.dispatchEvent(new Event('change', { bubbles: true })); } }
        }
        endWheel(st, st.moved);
      };
      wheel.addEventListener('pointermove', st.onMove);
      wheel.addEventListener('pointerup', st.onUp);
      wheel.addEventListener('pointercancel', st.onUp);
      wheelSpin = st;
    }
    function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

    function destroy() {
      if (bound) {
        panel.removeEventListener('click', onClick);
        panel.removeEventListener('pointerdown', onDown);
      }
      if (wheelSpin) { try { endWheel(wheelSpin, false); } catch (_) { /* ignore */ } }
      stopExtrasReheatPoll(); // a live poll must never outlive the surface (the pipClock lesson)
      unlockBodyScroll();     // v1.256: the haptic body lock dies with the surface
      unwatchGhost();
      wheelGhost = null;
      extrasReqToken++;       // and a late extras fetch must never render into a dead panel
      bound = false;
      // clear the full-screen body class this view may have set (the v1.227 leak lesson - a
      // podcasts<->music swap must never strand the frozen-scroll cover).
      try { doc.body.classList.remove('mms-on'); } catch (_) { /* ignore */ }
    }

    return {
      paint: paint, reflect: reflect, setListMode: setListMode, destroy: destroy,
      isListMode: function () { return panel.classList.contains('mms-listmode'); },
      // v1.250 (F-UNIFY): is a wheel SCRUB gesture live on this surface right now? The view's
      // chapter-loop enforcement reads this so a deliberate scrub past a chapter boundary is
      // not yanked back mid-drag (music.js's v1.240 carried interaction).
      isScrubbing: function () { return !!(wheelSpin && wheelSpin.mode === 'scrub'); },
    };
  }

  // ---- v1.251 (R2): the SHARED desktop now-playing panel builder --------------------------
  // Music's v1.223 whole-queue panel (meta + windowed rows with played/current/next states,
  // played greyed but clickable for jump-back), extracted VERBATIM so podcasts renders the
  // SAME desktop treatment instead of its legacy forward-only fragment. `np` = { title,
  // subline }; each row = { id, artUrl, title, artist, index, state } - the view precomputes
  // its own subline/artUrl (music: artist·album + /albumart; podcasts: show·meta +
  // /podcastart). Escaped here - podcast titles/notes are FEED PROSE. Row taps are the
  // VIEW's delegated .mnp-queue-row listener (data-index), exactly music's contract.
  function panelEscape(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function buildPanelHtml(np, rows) {
    np = np || {};
    var meta = '<div class="mnp-meta">' +
      '<div class="mnp-title" title="' + panelEscape(np.title) + '">' + panelEscape(np.title || 'Unknown track') + '</div>' +
      (np.subline ? '<div class="mnp-sub">' + panelEscape(np.subline) + '</div>' : '') +
      '</div>';
    var queue = '';
    if (Array.isArray(rows) && rows.length) {
      queue = '<div class="mnp-queue"><div class="mnp-queue-head">Up next</div>' +
        rows.map(function (it) {
          var cls = 'mnp-queue-row'
            + (it.state === 'played' ? ' is-played' : '')
            + (it.state === 'current' ? ' is-current' : '');
          // Number() coercion (QA gate S4): a two-consumer API now - an attribute-position
          // interpolation must never trust a caller's index shape (both callers pass ints).
          return '<button type="button" class="' + cls + '"' + (it.state === 'current' ? ' aria-current="true"' : '') + ' data-index="' + Number(it.index) + '">' +
            '<img class="mnp-queue-thumb art-shimmer" src="' + panelEscape(it.artUrl) + '" alt="" loading="lazy" />' +
            '<span class="mnp-queue-main">' +
            '<span class="mnp-queue-title">' + panelEscape(it.title || 'Track') + '</span>' +
            (it.artist ? '<span class="mnp-queue-sub">' + panelEscape(it.artist) + '</span>' : '') +
            '</span></button>';
        }).join('') +
        '</div>';
    }
    return meta + queue;
  }

  // ---- v1.251 (R3): the SHARED desktop pop-out SHELL --------------------------------------
  // The window lifecycle extracted VERBATIM from music.js (v1.234-235 + every gate scar):
  // Document-PiP grant with the plain-window fallback, the pipPending double-click guard,
  // the post-await mount re-checks (view destroyed / viewport shrunk - the TOCTOU class),
  // same-origin style copy, the pop-out's OWN 250ms reflect clock (the true-PiP freeze fix),
  // pagehide/unload teardown, and the teardown ordering (engine.destroy BEFORE refs drop).
  // The VIEW supplies via cfg: engineConfigFor(panel, win) - its per-surface engine config;
  // supported() - its gate (viewport + capability), re-checked at open AND mount; aborted() -
  // the view-signal check for the mount TOCTOU; onStateChange() - button refresh, called on
  // every open/close edge; windowName; panelId (defaults to the shared panel identity).
  function createPopoutShell(cfg) {
    var W = 380, H = 700; // ~phone width so the < 768px skin media query engages as-is
    // v1.257 TRAY PLAYER (Dean, screenshot-validated): an optional Nano presentation
    // parked above the taskbar. Tray = the IPOD skin's LCD sans wheel, reshaped by CSS
    // (the engine is untouched); the marker class lives on the PIP BODY because engine.paint()
    // rebuilds the panel's className every render. Position/z-order are the OS's: the
    // pip window is always-on-top over apps, the taskbar outranks it, and Chrome
    // remembers where the user drags it (the plan's platform facts).
    var TRAY_KEY = 'ft-tray-mode';
    var TRAY_W = 310, TRAY_H = 190; // v1.258 (Dean's feel round): slightly smaller on net
    function trayOn() { try { return window.localStorage.getItem(TRAY_KEY) === '1'; } catch (_) { return false; } }
    function setTrayStored(on) { try { window.localStorage.setItem(TRAY_KEY, on ? '1' : '0'); } catch (_) { /* best-effort */ } }
    function dims() { return trayOn() ? { width: TRAY_W, height: TRAY_H } : { width: W, height: H }; }
    function toggleTray() {
      // Persist, tear the window down, reopen at the new dims - the sticker click's
      // user activation carries the requestWindow re-grant; pipPending guards doubles.
      setTrayStored(!trayOn());
      teardown();
      open();
    }
    var pipWin = null, pipPanel = null, pipClock = null, pipPending = false, pipEngine = null;
    var supported = cfg.supported || function () { return true; };
    var aborted = cfg.aborted || function () { return false; };
    var onStateChange = cfg.onStateChange || function () {};
    var windowName = cfg.windowName || 'ft-music-pip';
    var panelId = cfg.panelId || 'music-nowplaying-panel';
    function copyStyles(doc) {
      var links = document.querySelectorAll('link[rel="stylesheet"]');
      for (var i = 0; i < links.length; i++) {
        var l = doc.createElement('link'); l.rel = 'stylesheet'; l.href = links[i].href; doc.head.appendChild(l);
      }
      var styles = document.querySelectorAll('style');
      for (var j = 0; j < styles.length; j++) {
        var s = doc.createElement('style'); s.textContent = styles[j].textContent; doc.head.appendChild(s);
      }
      // v1.255 slim-gate W2: carry the opener's chosen icon set - the [data-icons=...]
      // overrides are documentElement-scoped, so without the copy the pop-out's glyphs
      // always render the base masks (a design-language split on this wave's own axis).
      try { var ic = document.documentElement.getAttribute('data-icons'); if (ic) doc.documentElement.setAttribute('data-icons', ic); } catch (_) { /* best-effort */ }
    }
    function mount(win) {
      pipPending = false; // the async grant resolved (or the sync fallback) - clear the open-in-flight guard
      if (!win) return;
      // the single async funnel: re-check BOTH view-liveness and the gate, and close the
      // just-granted window if either holds ("never both live" stays an actual invariant).
      if (aborted() || !supported()) { try { win.close(); } catch (_) { /* ignore */ } return; }
      pipWin = win;
      var doc = win.document;
      try { copyStyles(doc); doc.title = 'FileTube'; } catch (_) { /* best effort */ }
      var panel = doc.createElement('div');
      panel.id = panelId; // the identity the skin CSS expects
      panel.className = 'music-nowplaying-panel';
      try { doc.body.classList.add('mms-on'); doc.body.appendChild(panel); } catch (_) { teardown(); return; }
      pipPanel = panel;
      var tray = trayOn();
      if (tray) { try { doc.body.classList.add('mms-tray'); } catch (_) { /* best-effort */ } }
      var ec = cfg.engineConfigFor(panel, win);
      // v1.257: tray borrows the IPOD skin's DOM (Dean's Nano-5g reference: the tray IS
      // a Classic LCD without the wheel). v1.258 (his feel round, "a few colorways -
      // black/white"): an ipod-FAMILY pick keeps its VARIANT - the family's silver and
      // black body palettes ARE the colorways - and anything else falls to base silver.
      // The user's chosen skin still governs the full pop-out and the phone. The sticker
      // gains the pop-out-only Tray row - injected HERE so music.js/podcasts.js stay
      // untouched.
      if (tray) {
        var origGetSkin = ec.getSkinId;
        ec.getSkinId = function () {
          var id = null;
          try { id = origGetSkin ? origGetSkin() : null; } catch (_) { id = null; }
          // v1.260: the tray is the POCKET CLASSIC Nano - the colorway family is the
          // explicit iPod pair (Seattle Classic shares base 'ipod' for the wheel CSS
          // but is deliberately NOT a Nano colorway; one line here if Dean wants it).
          if (id === 'ipod' || id === 'ipod-black') return id;
          return 'ipod';
        };
      }
      var dipip = !!(window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function');
      if (ec.sticker && dipip) ec.sticker = Object.assign({}, ec.sticker, { tray: { enabled: trayOn, onToggle: toggleTray } }); // QA W1: no row on the plain-window fallback (its named-window reuse breaks the toggle)
      pipEngine = create(ec);
      if (!pipEngine) { teardown(); return; }
      pipEngine.paint();
      // the pop-out's OWN timer drives its reflect - the opener tab throttles under true PiP.
      try { pipClock = win.setInterval(function () { if (pipEngine) pipEngine.reflect(); }, 250); } catch (_) { pipClock = null; }
      // QA gate W1 (v1.257): SCOPE the teardown to its own window - close() QUEUES
      // pagehide, so after a tray toggle the OLD window's late pagehide would tear
      // down the NEW one (and mid-grant it disarmed the v1.235 pipPending guard).
      var onClose = function () { if (pipWin === win) teardown(); };
      try { win.addEventListener('pagehide', onClose); win.addEventListener('unload', onClose); } catch (_) { /* ignore */ }
      onStateChange();
    }
    function open() {
      if (!supported()) return; // re-check at CLICK time - a wide->narrow resize must not leave an openable button
      if (pipWin) { try { pipWin.focus(); } catch (_) { /* ignore */ } return; }
      if (pipPending) return; // the double-click-during-grant guard (v1.235 adversarial)
      if (window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function') {
        try {
          pipPending = true;
          window.documentPictureInPicture.requestWindow(dims())
            .then(function (w) { mount(w); })
            .catch(function () { pipPending = false; openPlain(); });
          return;
        } catch (_) { pipPending = false; /* fall through to the plain window */ }
      }
      openPlain();
    }
    function openPlain() {
      var w = null;
      try {
        var d = dims();
        w = window.open('', windowName, 'width=' + d.width + ',height=' + d.height + ',menubar=no,toolbar=no,location=no,status=no');
      } catch (_) { w = null; }
      if (!w) return; // popup blocked - nothing we can do without a gesture
      try { w.document.body.innerHTML = ''; } catch (_) { /* same-origin blank */ }
      mount(w);
    }
    function teardown() {
      pipPending = false;
      // clear the clock on the window that CREATED it, before closing that window.
      if (pipClock != null) { try { (pipWin && pipWin.clearInterval ? pipWin : window).clearInterval(pipClock); } catch (_) { /* ignore */ } pipClock = null; }
      // destroy the engine instance (unbinds listeners, stops any extras poll, clears the
      // PIP document's mms-on) BEFORE dropping the panel/window refs.
      if (pipEngine) { try { pipEngine.destroy(); } catch (_) { /* ignore */ } pipEngine = null; }
      pipPanel = null;
      if (pipWin) { try { if (pipWin.close && !pipWin.closed) pipWin.close(); } catch (_) { /* ignore */ } pipWin = null; }
      onStateChange();
    }
    return {
      open: open,
      toggle: function () { if (pipWin) { teardown(); return; } open(); }, // close -> its pagehide also calls teardown (idempotent)
      teardown: teardown,
      isOpen: function () { return !!pipWin; },
      isConnected: function () { return !!(pipPanel && pipPanel.isConnected); },
      repaint: function () { if (pipEngine && pipPanel && pipPanel.isConnected) pipEngine.paint(); },
      reflect: function () { if (pipEngine && pipPanel && pipPanel.isConnected) pipEngine.reflect(); },
      // the view's chapter-loop enforcement asks the pop-out surface too (music v1.250 seam).
      isScrubbing: function () { return !!(pipEngine && pipEngine.isScrubbing()); },
    };
  }

  var api = { create: create, buildPanelHtml: buildPanelHtml, createPopoutShell: createPopoutShell };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FileTubeSkinSurface = api;
})();
