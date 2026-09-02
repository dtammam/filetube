'use strict';

// Shared mobile-skin ENGINE (v1.246, Dean's podcasts-on-skin wave). The music view (music.js)
// grew a battle-won iPod/Apple/Spotify skin surface over v1.227-245 - render + reflect + the
// click-wheel gesture (list cursor + timeline scrub) + transport proxying to the player's
// hidden controls. Podcasts want the SAME surface, but music.js and podcasts.js are separate
// page-scoped scripts, so the reusable engine lives HERE (loaded globally like music-skins.js)
// and each view drives it with its own CONTEXT (art URL, episode/track list, metadata) + HOOKS
// (play index i, dock). This module NEVER touches player.js - it only draws the skin registry's
// chrome and PROXIES clicks/gestures to the EXISTING hidden controls (#pp-btn / #track-prev-btn
// / #track-next-btn / #seek-bar), reflecting the live #media-player. player.js stays BYTE-
// UNCHANGED. (music.js keeps its own in-view copy for now; unifying it onto this engine is
// tracked tech-debt - deferred until Dean device-validates the shared engine via podcasts.)
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

    var WHEEL_STEP_DEG = 22;           // wheel degrees per one-item cursor step (music parity)
    var wheelCursorRow = -1;           // current list position the cursor sits on (-1 = list closed)
    var wheelSuppressClick = false;    // swallow the synthetic click a spin-ending pointerup fires
    var wheelSpin = null;              // the live gesture handle (one at a time)
    var bound = false;

    function wheelShortAngle(a) { while (a > 180) a -= 360; while (a < -180) a += 360; return a; }

    // ---- reflect the live #media-player into the skin (play glyph + progress fill + times) ----
    // Byte-for-behaviour with music.js reflectSkin: reads the element, never assumes music.
    function reflect() {
      if (!panel || !panel.classList.contains('mms-full')) return;
      var mp = hostCtl('media-player'); if (!mp) return;
      var playing = !mp.paused && !mp.ended;
      var pb = panel.querySelector('[data-skin-play]');
      if (pb) {
        pb.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        pb.classList.toggle('is-playing', playing);
      }
      var dur = (isFinite(mp.duration) && mp.duration > 0) ? mp.duration : 0;
      var pos = Number(mp.currentTime) || 0;
      var frac = dur > 0 ? Math.min(100, Math.max(0, pos / dur * 100)) : 0;
      var fill = panel.querySelector('.mms-fill'); if (fill) fill.style.width = frac + '%';
      var posEl = panel.querySelector('.mms-pos'); if (posEl) posEl.textContent = fmtTime(pos);
      var remEl = panel.querySelector('.mms-rem'); if (remEl) remEl.textContent = dur > 0 ? ('-' + fmtTime(Math.max(0, dur - pos))) : '';
    }
    function fmtTime(s) {
      s = Math.max(0, Math.floor(Number(s) || 0));
      var m = Math.floor(s / 60), sec = s % 60;
      return m + ':' + (sec < 10 ? '0' : '') + sec;
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
      if (win.FileTube && typeof win.FileTube.shimmerArt === 'function') win.FileTube.shimmerArt(panel);
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
      if (e.target.closest('[data-skin-play]')) { var pb = hostCtl('pp-btn'); if (pb) pb.click(); return; }
      if (e.target.closest('[data-skin-prev]')) { var pv = hostCtl('track-prev-btn'); if (pv) pv.click(); return; }
      if (e.target.closest('[data-skin-next]')) { var nx = hostCtl('track-next-btn'); if (nx) nx.click(); return; }
      if (e.target.closest('[data-skin-collapse]')) { onDock(); return; }
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

    // ---- the click-wheel gesture: rotate = cursor (list) OR scrub (now playing) ----
    function endWheel(st, suppress) {
      var w = st.wheel;
      try { if (st.captured) w.releasePointerCapture(st.id); } catch (_) { /* not captured */ }
      w.removeEventListener('pointermove', st.onMove);
      w.removeEventListener('pointerup', st.onUp);
      w.removeEventListener('pointercancel', st.onUp);
      if (suppress) wheelSuppressClick = true;
      if (wheelSpin === st) wheelSpin = null;
    }
    function onDown(e) {
      wheelSuppressClick = false;
      if (wheelSpin) return; // one gesture at a time
      var listMode = panel.classList.contains('mms-listmode');
      var wheel = e.target.closest('.ip-wheel'); if (!wheel) return;
      var r = wheel.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // ignore a press on the dead center (the Select button): let its tap pass through.
      if (Math.hypot(e.clientX - cx, e.clientY - cy) < r.width * 0.2) return;
      var st = {
        wheel: wheel, id: e.pointerId, captured: false, moved: false,
        mode: listMode ? 'cursor' : 'scrub', scrubRatio: null,
        lastAngle: Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI,
        lastT: nowMs(), accum: 0, x0: e.clientX, y0: e.clientY, onMove: null, onUp: null,
      };
      st.onMove = function (ev) {
        if (ev.pointerId !== st.id) return; // ignore a SECOND finger (jump guard)
        var ang = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
        var d = wheelShortAngle(ang - st.lastAngle); st.lastAngle = ang;
        var now = nowMs(); var dt = Math.max(1, now - st.lastT); st.lastT = now;
        st.accum += d;
        if (!st.moved && Math.hypot(ev.clientX - st.x0, ev.clientY - st.y0) > 8) {
          st.moved = true;
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
      bound = false;
      // clear the full-screen body class this view may have set (the v1.227 leak lesson - a
      // podcasts<->music swap must never strand the frozen-scroll cover).
      try { doc.body.classList.remove('mms-on'); } catch (_) { /* ignore */ }
    }

    return { paint: paint, reflect: reflect, setListMode: setListMode, destroy: destroy, isListMode: function () { return panel.classList.contains('mms-listmode'); } };
  }

  var api = { create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FileTubeSkinSurface = api;
})();
