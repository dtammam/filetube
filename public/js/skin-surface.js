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
//   onArtist()     OPTIONAL (v1.317 M1): the artist line's action (music: the artist drill, or
//                  the channel grid for a listen video). Its PRESENCE is what makes the line a
//                  [data-skin-artist] control (ctx.artistTap): without it (podcasts) the line
//                  renders as the plain div - never an inert button. The view may also
//                  VETO it per track with getCtx().artistTap === false (music: a listen
//                  video with no channel folder has nowhere to go, and a listen video in
//                  the pop-out window, which must not navigate the window behind it), and
//                  name the target with getCtx().artistTitle (default "Go to artist").
//   sticker        the v1.238-249 sticker quick-menu (speed/loop/skin) + optional Extras:
//     onSkinChange()  re-render after a skin pick (the view repaints its surfaces)
//     getPlayer()     -> the FileTube player facade for loop get/set
//                        (default: window.FileTube && window.FileTube.player)
//     watchBack       OPTIONAL (v1.252 Listen-mode) - { visible(), onTap() }: page 1 gains a
//                     "Watch" row when visible() (music: the playing item is a listen track);
//                     onTap navigates back to the item's watch page.
//     channel         OPTIONAL (v1.317 M1) - { visible(), onTap() }: page 1 gains a "Go to
//                     channel" row beside Watch when visible() (music: the playing item is a
//                     library-backed track with a channel folder); onTap navigates to the
//                     home grid filtered by that folder. Main-document only, as Watch.
//     tray            OPTIONAL (v1.257, INJECTED BY THE POP-OUT SHELL only) - { enabled(),
//                     onToggle() }: page 1 gains a "Tray" row on the pop-out surface;
//                     toggling reopens the pip window as the taskbar strip. Views never
//                     declare this hook themselves.
//     autoplay        OPTIONAL (v1.254 endless autoplay) - { enabled(), onToggle() }: page 1
//                     gains an "Autoplay" On/Off row (Loop chassis). Both surfaces - the
//                     setting is device-global, so a pop-out flip is coherent. Omitted
//                     (podcasts) = no row.
//     extras          OPTIONAL - the v1.249 Extras second page. Omitting it = quick menu only.
//                     v1.287: the factory is ENDPOINT-DRIVEN, so a media type supplies an ADAPTER
//                     here (podcasts do - the video/music surfaces pass only the base 4 hooks and
//                     get the factory DEFAULTS, byte-identical to pre-v1.287). Base hooks:
//       getBaseId()   -> the playing item's base media id (::c chapter suffix stripped), or null
//       isEligible()  -> the view says the playing item is menu-eligible (the engine adds its
//                        own in-MAIN-document check - the pop-out never offers Extras)
//       onMutated()   a successful Delete/Move removed/re-keyed the playing item - the view
//                     clears its playing state and refreshes
//       signal        the view's AbortSignal (share-choice dismiss, transcript, reheat poll)
//                     Adapter fields (v1.287, all OPTIONAL - defaults = the video/library model):
//       fetchItem(id) -> Promise<item|null> (default: GET /api/videos/:id). Item shape:
//                        {id,title,liked,watchState:'watched'|'unwatched',hasSubtitles,watchUrl}.
//       downloadUrl(item) -> the file's ?download=1 URL (default: /video/:id?download=1)
//       shareLinkUrl(item) -> the external SOURCE link, '' if none (default: item.watchUrl).
//                        Its presence decides the "both when a source exists" Share fork.
//       capabilities  -> array of action rows to render (default: the full video set). Podcasts
//                        pass the applicable subset; move/reheat/transcript are omitted for them.
//       watchedLabels -> { on, off } for the watched row (default Watched/Mark watched; podcasts
//                        pass Played/Mark played).
//       deleteNeedsModify -> false lets Delete render without canModifyLibrary (podcasts; the
//                        SERVER still enforces requireModifyLibrary). Default (undefined) = gated.
//       likeRequest(item,nextOn)/watchedRequest(item,nextOn) -> return the toggle fetch (default
//                        /api/liked//api/watched); onQueue(item,pos) (default addToQueue);
//       onDelete(item,onSuccess,player) -> OWN the delete flow entirely (podcasts: the recoverable
//                        trash). When present, the video/music two-flow delete is bypassed.
// NOTE (Dean, 2026-09-02): music.js's v1.235 wheel-VOLUME mode is deliberately NOT ported -
// Dean ruled the Now-Playing wheel SCRUBS everywhere ("like it does on mobile - consistent
// UI and useful"), so the engine has exactly one Now-Playing wheel behavior. The iPod skin's
// volume-bar markup (.ip-vol-fill) stays dormant in music-skins.js (untouched, zero-risk).
//
// api: paint() render+bind the skin; reflect() sync from the live element; setListMode(on);
//   destroy() unbind + clear body.mms-on. Returns null if music-skins.js isn't present.

(function () {
  // v1.278: pure helpers hoisted to module scope so BOTH the skin engine
  // `create()` and the shared `createExtrasMenu()` factory (desktop actions menu)
  // share one copy. Byte-identical to the former in-closure definitions.
  function fmtTime(s) {
    s = Math.max(0, Math.floor(Number(s) || 0));
    var m = Math.floor(s / 60), sec = s % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }
  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // v1.278: the shared Extras ACTION CORE, extracted from the skin engine so the desktop
  // /music actions menu (music.js) reuses the SAME build + dispatch + gates (TOCTOU token,
  // reheat poll with stale-entry guard, delete two-flow, like/watched flip-only-on-2xx)
  // instead of a divergent copy. Each surface constructs one via cfg: getMenuEl/getBaseId/
  // getPlayer/getSignal/close/backHtml/stillOnPage/onMutated. Returns { open, handleAction,
  // cancelPending, destroy }. The skin path's markup + dispatch are byte-identical.
  function createExtrasMenu(cfg) {
    cfg = cfg || {};
    function extrasPlayer() { try { return (typeof cfg.getPlayer === 'function' ? cfg.getPlayer() : null) || null; } catch (_) { return null; } }
    function extrasMenuEl() { try { return (typeof cfg.getMenuEl === 'function' ? cfg.getMenuEl() : null) || null; } catch (_) { return null; } }
    function extrasClose() { if (typeof cfg.close === 'function') { try { cfg.close(); } catch (_) { /* best-effort */ } } }
    function extrasStillOnPage() { try { return typeof cfg.stillOnPage !== 'function' || !!cfg.stillOnPage(); } catch (_) { return false; } }
    // ---- the v1.249 Extras page (present only when the view supplies extras hooks) --------
    var extrasItem = null;     // the /api/videos/:id payload the OPEN page renders
    var extrasReqToken = 0;    // TOCTOU guard: only the newest open's fetch may render (v1.104 scar)
    var extrasReheatTimer = null;
    var extrasReheatAbortHooked = false;
    function extrasSignal() { try { return (typeof cfg.getSignal === 'function' ? cfg.getSignal() : null) || null; } catch (_) { return null; } }
    function extrasBaseId() {
      try { return (typeof cfg.getBaseId === 'function' ? cfg.getBaseId() : null) || null; } catch (_) { return null; }
    }
    function extrasBackHtml() {
      try { return (typeof cfg.backHtml === 'function' ? cfg.backHtml() : '') || ''; } catch (_) { return ''; }
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
    // v1.287: the download URL is media-type-configurable (default = the video arm, unchanged
    // for the video/music surfaces that pass no cfg.downloadUrl). Podcasts pass /episode/:id.
    function extrasDownloadUrl(item) {
      try { if (typeof cfg.downloadUrl === 'function') return cfg.downloadUrl(item); } catch (_) { /* fall through */ }
      return '/video/' + encodeURIComponent(item.id) + '?download=1';
    }
    // v1.287: the shareable SOURCE link (default = item.watchUrl). Its presence decides the
    // "both when a source exists" Share fork below; a file-only type (podcasts) returns ''.
    function extrasShareLink(item) {
      try { if (typeof cfg.shareLinkUrl === 'function') return cfg.shareLinkUrl(item) || ''; } catch (_) { /* fall through */ }
      return (typeof item.watchUrl === 'string' && item.watchUrl !== '') ? item.watchUrl : '';
    }
    // v1.287: the item-detail source. Default = the /api/videos/:id payload (video/music);
    // podcasts inject a fetch of the episode payload (normalized to {id,title,liked,watchState,...}).
    function extrasFetchItem(id) {
      try {
        if (typeof cfg.fetchItem === 'function') return Promise.resolve(cfg.fetchItem(id)).catch(function () { return null; });
      } catch (_) { /* fall through to the default */ }
      return fetch('/api/videos/' + encodeURIComponent(id))
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    // v1.287: which action rows this surface renders. Default = the full video/music set
    // (byte-identical to before); podcasts pass a subset. Share is ALWAYS present now
    // (everything shareable) - it file-shares, and offers the link too when a source exists.
    function extrasCap(name) {
      var caps = cfg.capabilities;
      if (!caps) return true; // default: the historic full set
      return caps.indexOf(name) !== -1;
    }
    function buildExtrasHtml(item, canModify) {
      var hasWatchUrl = extrasShareLink(item) !== '';
      var liked = item.liked === true;
      var watched = item.watchState === 'watched';
      var acts = [];
      // v1.287: Share is universal now - always rendered (file-share, +link when a source exists).
      if (extrasCap('share')) acts.push('<button type="button" class="mms-sm-act" data-skin-x="share"><i class="icon-share"></i>Share</button>');
      // v1.278: the "Watch" way back (open the item on the video page) - cfg-gated so it
      // appears ONLY where the surface offers it (the desktop /music actions menu). The
      // mobile skin keeps Watch on the sticker's page 1 (its cfg omits hasWatchBack), so
      // the skin path stays byte-identical.
      if (typeof cfg.hasWatchBack === 'function' && cfg.hasWatchBack()) acts.push('<button type="button" class="mms-sm-act" data-skin-x="watch"><i class="icon-tv"></i>Watch</button>');
      // v1.317 (M1): "Go to channel" beside Watch - cfg-gated the same way (the desktop /music
      // actions menu passes hasChannel/onChannel; the mobile skin keeps it on the sticker's
      // page 1, so the skin Extras page stays byte-identical).
      if (typeof cfg.hasChannel === 'function' && cfg.hasChannel()) acts.push('<button type="button" class="mms-sm-act" data-skin-x="channel"><i class="icon-folder"></i>Go to channel</button>');
      if (extrasCap('download')) acts.push('<a class="mms-sm-act" data-skin-x="download" href="' + extrasDownloadUrl(item) + '" download><i class="icon-download"></i>Download</a>');
      if (extrasCap('like')) acts.push('<button type="button" class="mms-sm-act' + (liked ? ' is-on' : '') + '" data-skin-x="like" aria-pressed="' + (liked ? 'true' : 'false') + '"><i class="icon-heart"></i><span class="mms-sm-actlbl">' + (liked ? 'Liked' : 'Like') + '</span>' + '</button>');
      // v1.287: the "watched" row's LABEL is configurable (podcasts say "Played"); the action
      // id + toggle machinery stay `watched` (the handler routes by cfg).
      var wOn = (cfg.watchedLabels && cfg.watchedLabels.on) || 'Watched';
      var wOff = (cfg.watchedLabels && cfg.watchedLabels.off) || 'Mark watched';
      if (extrasCap('watched')) acts.push('<button type="button" class="mms-sm-act' + (watched ? ' is-on' : '') + '" data-skin-x="watched" aria-pressed="' + (watched ? 'true' : 'false') + '"><i class="icon-history"></i><span class="mms-sm-actlbl">' + (watched ? wOn : wOff) + '</span>' + '</button>');
      if (extrasCap('queue')) acts.push('<button type="button" class="mms-sm-act" data-skin-x="queue"><i class="icon-queue"></i>Add to queue</button>');
      if (extrasCap('queue-next')) acts.push('<button type="button" class="mms-sm-act" data-skin-x="queue-next"><i class="icon-play"></i>Play next</button>');
      if (extrasCap('transcript') && item.hasSubtitles === true) acts.push('<button type="button" class="mms-sm-act" data-skin-x="transcript"><i class="icon-transcript"></i>Transcript</button>');
      if (extrasCap('reheat') && hasWatchUrl) acts.push('<button type="button" class="mms-sm-act" data-skin-x="reheat"><i class="icon-flame"></i>Reheat</button>');
      // move stays library-modify-gated (video only). delete is capability-gated; whether it
      // ALSO needs canModify to RENDER is cfg-driven (video/music: yes; podcasts:
      // deleteNeedsModify:false shows it to all like the list-row delete - the SERVER still
      // enforces requireModifyLibrary on the actual DELETE).
      // Chapter Snap (2026-09-24) (Dean): "This chapter starts wrong" - opens the chapter TIME
      // editor on the chapter that is playing. Rendered only when the view supplies the
      // hook, the open-time fetch stamped the playing chapter's index (chapterSnapIndex,
      // captured at OPEN so a chapter roll cannot retarget the tap), and the viewer may
      // modify the library (the server enforces regardless).
      if (canModify && typeof cfg.onChapterSnap === 'function' && typeof item.chapterSnapIndex === 'number') {
        acts.push('<button type="button" class="mms-sm-act" data-skin-x="chapter-snap"><i class="icon-list"></i>This chapter starts wrong</button>');
      }
      if (extrasCap('move') && canModify) {
        acts.push('<button type="button" class="mms-sm-act" data-skin-x="move"><i class="icon-folder"></i>Move to...</button>');
      }
      if (extrasCap('delete') && (canModify || cfg.deleteNeedsModify === false)) {
        acts.push('<button type="button" class="mms-sm-act mms-sm-danger" data-skin-x="delete"><i class="icon-delete"></i>Delete</button>');
      }
      return extrasBackHtml() +
        '<div class="mms-sm-sec"><div class="mms-sm-title">' + escapeHtml(item.title || '') + '</div>' +
        '<div class="mms-sm-acts">' + acts.join('') + '</div></div>';
    }
    function open() {
      var menu = extrasMenuEl();
      var baseId = extrasBaseId();
      if (!menu || !baseId) return;
      var token = ++extrasReqToken;
      menu.innerHTML = buildExtrasNoteHtml('Loading…');
      Promise.all([
        extrasFetchItem(baseId),
        extrasCanModifyLibrary(),
      ]).then(function (rs) {
        // Post-await re-checks (the TOCTOU scar): the newest open only, the menu still
        // mounted+open+on this page, and the SAME track still live (an auto-advance
        // repaints the panel, detaching this menu node).
        if (token !== extrasReqToken) return;
        if (!menu.isConnected || menu.hidden || !extrasStillOnPage()) return;
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
    // v1.287: queue via a cfg override (podcasts pass kind 'podcast'), default = the shared verb.
    function extrasQueue(item, pos) {
      if (typeof cfg.onQueue === 'function') { try { cfg.onQueue(item, pos); return; } catch (_) { /* fall through */ } }
      if (typeof window.addToQueue === 'function') window.addToQueue(item.id, pos);
    }
    // v1.287 (Dean, "everything shareable"): Share the actual FILE, and - when the item has a
    // source LINK - offer the link too (the "both when a source exists" ruling). File-only for
    // podcasts / local items with no source. A sanitized title is the filename fallback;
    // shareMediaFile prefers the server's Content-Disposition name (right extension).
    function extrasShareFilename(item) {
      return String((item && item.title) || 'media').replace(/[/\\:*?"<>|-]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'media';
    }
    function extrasShare(item) {
      var link = extrasShareLink(item); // '' when there is no external source
      var fileUrl = extrasDownloadUrl(item);
      var title = item.title || '';
      var shareFile = function () {
        if (typeof window.shareMediaFile !== 'function') return;
        window.shareMediaFile({ url: fileUrl, title: title, filename: extrasShareFilename(item) })
          .then(function (outcome) { if (outcome === 'downloaded') extrasToast('Downloading - share it from your files.'); });
      };
      var shareLink = function (u) {
        if (typeof window.shareExternalUrl !== 'function') return;
        window.shareExternalUrl(u, title).then(function (outcome) { if (outcome === 'copied') extrasToast('Link copied'); });
      };
      var sig = extrasSignal();
      if (link && typeof window.showChoiceModal === 'function') {
        var pl = extrasPlayer();
        var t = (pl && typeof pl.getCurrentTime === 'function') ? pl.getCurrentTime() : null;
        var opts = [{ label: 'Share file', onPick: shareFile }, { label: 'Share link', onPick: function () { shareLink(link); } }];
        if (typeof t === 'number' && isFinite(t) && t >= 1 && typeof window.withShareStartTime === 'function') {
          opts.push({ label: 'Share link at ' + fmtTime(t), onPick: function () { shareLink(window.withShareStartTime(link, t)); } });
        }
        var dismiss = window.showChoiceModal('Share', opts);
        if (typeof dismiss === 'function' && sig) sig.addEventListener('abort', dismiss, { once: true });
        return;
      }
      shareFile();
    }
    // v1.287: the default (video/music) like/watched requests - POST adds, DELETE removes.
    function defaultLikeRequest(item, nextOn) { return fetch('/api/liked/' + encodeURIComponent(item.id), { method: nextOn ? 'POST' : 'DELETE' }); }
    function defaultWatchedRequest(item, nextOn) { return fetch('/api/watched/' + encodeURIComponent(item.id), { method: nextOn ? 'POST' : 'DELETE' }); }
    // Like/Watched: the rendered button flips ONLY on a 2xx (the server is the truth; a failure
    // leaves the shown state alone). The request is cfg-injectable (podcasts hit their own
    // /api/podcasts/episodes/:id/liked + /played endpoints); the state/label machinery is shared.
    function extrasToggleFlag(el, item, kind) {
      var on = kind === 'like' ? item.liked === true : item.watchState === 'watched';
      var nextOn = !on;
      var reqFn = kind === 'like'
        ? (typeof cfg.likeRequest === 'function' ? cfg.likeRequest : defaultLikeRequest)
        : (typeof cfg.watchedRequest === 'function' ? cfg.watchedRequest : defaultWatchedRequest);
      var wOn = (cfg.watchedLabels && cfg.watchedLabels.on) || 'Watched';
      var wOff = (cfg.watchedLabels && cfg.watchedLabels.off) || 'Mark watched';
      Promise.resolve().then(function () { return reqFn(item, nextOn); })
        .then(function (res) {
          if (!res || !res.ok) { extrasToast(kind === 'like' ? 'Could not update Like.' : 'Could not update ' + wOn + '.'); return; }
          if (kind === 'like') {
            item.liked = nextOn;
            // QA gate (the v1.33.1 class): the count-gated Liked sidebar entry caches its
            // total per session - re-prime it so home reflects this like without a reload.
            if (typeof window.fetchLikedTotal === 'function') window.fetchLikedTotal(true);
          } else {
            item.watchState = nextOn ? 'watched' : 'unwatched';
          }
          if (!el || !el.isConnected) return;
          el.classList.toggle('is-on', nextOn);
          el.setAttribute('aria-pressed', nextOn ? 'true' : 'false');
          // v1.255 slim-gate CRITICAL: write ONLY the label span - a bare el.textContent
          // assignment destroys the row's glyph <i> (this wave's own feature) on the
          // menu's most-tapped rows. The || el fallback keeps a span-less row honest.
          var lbl = el.querySelector('.mms-sm-actlbl');
          (lbl || el).textContent = kind === 'like' ? (nextOn ? 'Liked' : 'Like') : (nextOn ? wOn : wOff);
        })
        .catch(function () { extrasToast(kind === 'like' ? 'Could not update Like.' : 'Could not update ' + wOn + '.'); });
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
      if (typeof cfg.onMutated === 'function') { try { cfg.onMutated(); } catch (_) { /* view refresh best-effort */ } }
    }
    function extrasMove(item) {
      if (typeof window.showMoveModal !== 'function' || typeof window.requestMoveItem !== 'function') return;
      var sig = extrasSignal();
      fetch('/api/config')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (cfgResp) {
          if (sig && sig.aborted) return;
          var folders = (cfgResp && cfgResp.folders) || [];
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
                var pl = extrasPlayer();
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
      // v1.287: a media type with its OWN delete flow (podcasts: the recoverable two-tap trash
      // to /api/podcasts/episodes/:id) supplies cfg.onDelete and owns the confirm + request +
      // refresh entirely. The video/music path below is left BYTE-IDENTICAL (zero regression
      // risk on the destructive library delete). onDelete gets (item, onSuccess, player).
      if (typeof cfg.onDelete === 'function') {
        try { cfg.onDelete(item, afterExtrasMutation, extrasPlayer()); } catch (_) { extrasToast('Could not delete.'); }
        return;
      }
      var doDelete = function () {
        // Release the about-to-be-deleted resource before the DELETE (watch.js parity).
        var pl = extrasPlayer();
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
    function handleAction(act, el) {
      var item = extrasItem;
      if (!item || !item.id) return;
      if (act === 'download') { extrasClose(); return; } // the anchor's own navigation does the work
      if (act === 'share') { extrasClose(); extrasShare(item); return; }
      if (act === 'watch') { extrasClose(); if (typeof cfg.onWatch === 'function') { try { cfg.onWatch(); } catch (_) { /* nav best-effort */ } } return; }
      if (act === 'channel') { extrasClose(); if (typeof cfg.onChannel === 'function') { try { cfg.onChannel(); } catch (_) { /* nav best-effort */ } } return; }
      if (act === 'like') { extrasToggleFlag(el, item, 'like'); return; }
      if (act === 'watched') { extrasToggleFlag(el, item, 'watched'); return; }
      if (act === 'queue') { extrasClose(); extrasQueue(item, 'end'); return; }
      if (act === 'queue-next') { extrasClose(); extrasQueue(item, 'next'); return; }
      if (act === 'transcript') { extrasClose(); extrasTranscript(item, el); return; }
      if (act === 'reheat') { extrasClose(); extrasReheat(item); return; }
      if (act === 'chapter-snap') { extrasClose(); if (typeof cfg.onChapterSnap === 'function') { try { cfg.onChapterSnap(item); } catch (_) { /* editor open best-effort */ } } return; }
      if (act === 'move') { extrasClose(); extrasMove(item); return; }
      if (act === 'delete') { extrasClose(); extrasDelete(item); }
    }
    function cancelPending() { extrasReqToken++; }
    function destroy() { stopExtrasReheatPoll(); extrasReqToken++; extrasItem = null; }
    return { open: open, handleAction: handleAction, cancelPending: cancelPending, destroy: destroy };
  }

  // v1.311.2: the shared iOS body lock. Always the MAIN window's module - a
  // Document-PiP pop-out is a scriptless window, so it passes its own doc/win to
  // the main window's lock (which is keyed per document).
  var skinLockSeq = 0;
  function sharedBodyLock() {
    if (typeof window !== 'undefined' && window.FileTubeBodyLock) return window.FileTubeBodyLock;
    try { return (typeof module !== 'undefined' && module.require) ? module.require('./body-scroll-lock.js') : null; } catch (_) { return null; }
  }

  // ==== POCKET MENUS: the controller (Dean 2026-09-24) =======================================
  // The Click family drives a real menu tree with the wheel: rotation moves the
  // highlight (the SAME onMove cursor branch and haptic path the song list uses - no second
  // rotary engine), the center selects/drills in, MENU/Back climbs one level, and a row TAP
  // selects too (phone users). The tree + rows + screens are music-skins.js's pure half; the
  // data (cfg.load) and the play seam (cfg.onPlay / cfg.onShuffleAll) are the VIEW's.
  //
  // State lives HERE, not in the DOM: paint() rebuilds the panel on every track change, chapter
  // roll and autoplay append, so afterPaint() re-draws the menu from this state each time -
  // a repaint never throws you out of a list. The screen is 'np' (Now Playing) or 'menu' (the
  // top of the stack); the v1.231 queue list (Select from Now Playing) stays the engine's own.
  //
  // cfg (music.js): load(node) -> Promise<{items, tracks?, play?}>; onPlay({tracks, index, play});
  // onShuffleAll(); hasCurrent(); currentId(); dataVersion() (bumped when the library changed under
  // the menus - every library level re-loads) and likedVersion() (bumped by a like/unlike - only an
  // open Liked Songs level re-loads). Everything is inert on a skin with no `menus`.
  function createPocketMenu(o) {
    var cfg = o.cfg;
    var panel = o.panel;
    var doc = o.doc;
    var win = o.win;
    var SK = o.SKINS;
    var getSkinId = o.getSkinId;
    var games = o.games || null; // the view's Brick hook {visible, onTap} - main document only (the engine decides)
    var lighting = o.lighting || null; // the engine's pocket-lighting driver (Settings > Lighting; null = no row)
    var destroyed = false;
    var stack = [];
    var builtFor = null;       // the menu style the stack was built for (a skin pick can change it)
    var lastCurrent = null;    // the current id the last paint saw (the per-advance follow seam)
    var npArt = '';            // the playing track's art (the split screen's fallback image)
    var artTimer = null;
    var artShown = '';         // the image the split screen currently shows (no re-fade on a repaint)
    var rowH = 0;              // the measured row height (0 until layout exists)
    var viewH = 0;             // the measured list viewport height
    var listRaf = null;
    var dataVer = null;        // the view's library version the loaded levels reflect (cfg.dataVersion)
    var likedVer = null;       // ...and its liked-set version (cfg.likedVersion)

    function style() { try { return (SK && typeof SK.menuStyle === 'function' && SK.menuStyle(getSkinId())) || ''; } catch (_) { return ''; } }
    function hasCurrent() { try { return !!(typeof cfg.hasCurrent === 'function' && cfg.hasCurrent()); } catch (_) { return false; } }
    function currentId() { try { return (typeof cfg.currentId === 'function' && cfg.currentId()) || null; } catch (_) { return null; } }
    // Addendum C: the Extras / Games entry exists only where the game can run - the Brick hook's
    // OWN availability rule (ipod-brick.js visible(): the Click wheel skins with a wheel on this
    // surface), and only when the engine handed the hook over (main document only, the sticker
    // row's v1.270 posture). Never an entry that leads to nothing.
    function gamesVisible() {
      if (!games || typeof games.visible !== 'function' || typeof games.onTap !== 'function') return false;
      try { return !!games.visible(); } catch (_) { return false; }
    }
    // Opens on Now Playing when something is loaded; nothing loaded opens on the Main Menu.
    var screen = hasCurrent() ? 'np' : 'menu';

    function makePane(node) {
      return { node: node, title: SK.menuTitle(node, style()), state: 'idle', items: [], tracks: null, play: null,
        cursor: 0, scrollTop: 0, token: 0, playing: false, center: false, letters: false, runs: null };
    }
    function makeLevel(node) {
      return { node: node, pane: 0, panes: [makePane(node)] };
    }
    function resetStack() { builtFor = style(); stack = [makeLevel({ type: 'main' })]; }
    resetStack();
    function top() { return stack[stack.length - 1]; }
    function curPane() { var l = top(); return l ? l.panes[l.pane] : null; }
    function isVisible(p) { return screen === 'menu' && curPane() === p; }
    function lcd() { return panel.querySelector('.ip-lcd-in'); }
    function menuEl() { return panel.querySelector('.ip-menuview'); }
    function listEl() { return panel.querySelector('.ip-menuview .ipm-list'); }
    function trayUp() { return !!(doc.body && doc.body.classList && doc.body.classList.contains('mms-tray')); }
    function later(fn, ms) { return win.setTimeout(fn, ms); }
    function cancel(t) { if (t != null) { try { win.clearTimeout(t); } catch (_) { /* ignore */ } } return null; }

    // Gate r1 K2 (qa W1 + adversary W2): the library changed under the menus (a delete/move, a
    // rescan, a chapter edit) - every library-backed level on the stack re-loads when next shown
    // (cursor kept, clamped), and a like/unlike re-loads an open Liked Songs level. Read at EVERY
    // render and before every user action, not only at a skin repaint: a chapter save repaints
    // nothing, and the desktop pop-out's menu can sit open while the main window edits. Returns
    // true when the level ON SCREEN just went stale (the caller re-draws instead of acting on it).
    function readVer(fn) { try { return (typeof fn === 'function') ? fn() : null; } catch (_) { return null; } }
    // gate r2 (qa NEW-1 = adversary W): a re-loaded level puts its highlight back on the SAME item
    // (a track id / a drill node's key), never on the same INDEX - a recency list re-orders itself.
    function identityOf(it) {
      if (!it) return null;
      if (it.id != null) return 'id:' + it.id;
      if (it.node) return 'node:' + it.node.type + ':' + (it.node.key == null ? '' : it.node.key) + ':' + (it.node.artist == null ? '' : it.node.artist);
      return 'label:' + it.label;
    }
    function markStale(pred) {
      stack.forEach(function (l) {
        l.panes.forEach(function (p) {
          if (p.node.type === 'main' || SK.menuStaticItems(p.node, {})) return;
          if (!pred(p)) return;
          if (p.items.length) p.anchor = identityOf(p.items[p.cursor]);
          p.state = 'idle'; p.token += 1; p.items = []; p.tracks = null; p.runs = null;
        });
      });
    }
    function checkData() {
      var ver = readVer(cfg.dataVersion);
      var lver = readVer(cfg.likedVersion);
      var shown = curPane();
      var before = shown ? shown.state : null;
      if (dataVer !== null && ver !== dataVer) markStale(function () { return true; }); // (the drift's pool re-fetches itself: poolFresh)
      else if (likedVer !== null && lver !== likedVer) markStale(function (p) { return p.node.type === 'playlist' && p.node.key === 'liked'; });
      dataVer = ver;
      likedVer = lver;
      var stale = !!(shown && screen === 'menu' && before !== 'idle' && shown.state === 'idle');
      if (stale) clearJump(); // the rows the letters pointed into are gone
      return stale;
    }
    function ensureLoaded(pane) {
      // The Main Menu re-derives every draw: its Now Playing row exists only while a track does,
      // and its Extras/Games row only while the game can run here.
      if (pane.node.type === 'main') {
        pane.items = SK.menuStaticItems(pane.node, { hasCurrent: hasCurrent(), hasGames: gamesVisible(), style: style() }) || [];
        pane.state = 'ready';
        pane.cursor = Math.max(0, Math.min(pane.items.length - 1, pane.cursor));
        return;
      }
      // Settings > Lighting re-derives every draw too: the check follows the pick, the note the
      // permission answer (the driver's live state, never a copy).
      if (pane.node.type === 'lighting') {
        pane.items = SK.menuLightingItems(lighting ? lighting.state() : null) || [];
        pane.state = 'ready';
        pane.cursor = Math.max(0, Math.min(pane.items.length - 1, pane.cursor));
        return;
      }
      if (pane.state !== 'idle') return;
      // gate r1 (adversary W2): the row only where the driver can light THIS skin - Click.
      var st = SK.menuStaticItems(pane.node, { hasLighting: !!lighting && style() === 'click', style: style() });
      if (st) { pane.items = st; pane.state = 'ready'; return; }
      pane.state = 'loading';
      var tok = ++pane.token;
      var p;
      try { p = Promise.resolve(cfg.load(pane.node)); } catch (e) { p = Promise.reject(e); }
      p.then(function (res) {
        // post-await: this controller is alive and this is still the pane's newest load.
        if (destroyed || tok !== pane.token) return;
        pane.items = (res && Array.isArray(res.items)) ? res.items : [];
        pane.tracks = (res && Array.isArray(res.tracks)) ? res.tracks : null;
        pane.play = (res && res.play) || null;
        pane.letters = !!(res && res.letters); // the VIEW says these rows are in label order
        pane.runs = null;
        pane.state = pane.items.length ? 'ready' : 'empty';
        // the highlight goes back on the item it was on (the list being played from: on what plays)
        var want = pane.playing && currentId() ? 'id:' + currentId() : pane.anchor;
        pane.anchor = null;
        var at = -1;
        if (want) for (var ai = 0; ai < pane.items.length; ai++) { if (identityOf(pane.items[ai]) === want) { at = ai; break; } }
        if (at >= 0) { pane.cursor = at; pane.center = true; }
        pane.cursor = Math.max(0, Math.min(pane.items.length - 1, pane.cursor));
        if (isVisible(pane)) render();
      }, function () {
        if (destroyed || tok !== pane.token) return;
        pane.state = 'error';
        if (isVisible(pane)) render();
      });
    }
    function emptyTextFor(node) {
      var t = node && node.type;
      if (t === 'artists') return 'No artists yet.';
      if (t === 'recentArtists') return 'No recent artists';
      if (t === 'albums') return 'No albums yet.';
      if (t === 'genres') return 'No genres yet.';
      if (node && node.key === 'liked') return 'Songs you like show up here.';
      return 'No songs yet.';
    }

    // ---- QUICK SCROLL (Dean 2026-09-24): letters on a long alphabetical list ----------------
    // The WHEEL: the engine's own speed signal (its v1.233 step multiplier) is reported once per
    // POINTERMOVE (noteMove); letter mode arms after LETTER_ENGAGE_MOVES fast moves in a row inside
    // ONE gesture (gate r1 Q1: counting detents let one big move arm it, and the count latched
    // across gestures - both seats measured it). From then on a detent jumps to the first row of
    // the next/previous letter present - at most ONE letter per pointermove - until the wheel has
    // been still for LETTER_HOLD_MS (the overlay fades; the highlight stays where it landed). TOUCH: scrolling
    // the list by finger shows a small letter badge at its edge; tapping it (or the big overlay)
    // opens the A-Z picker. Every arm that leaves the list (MENU, Select, a tap, a level change,
    // the screen flipping to Now Playing, a stale reload, destroy) clears all three.
    var LETTER_HOLD_MS = 1000;
    var LETTER_ENGAGE_MOVES = 3;
    var lm = { on: false, fastRun: 0, timer: null, moveJumped: false };
    var badge = { on: false, timer: null };
    var shownLetter = '';
    var gridOpen = false;
    var expectTop = null; // the scrollTop this controller last wrote (its own scroll is not a finger's)
    function runsOf(p) { if (!p.runs) p.runs = SK.menuLetterRuns(p.items); return p.runs; }
    function letterable(p) { return !!(p && screen === 'menu' && style() && SK.menuLetterable(p)); }
    function jumpModel(p) {
      if (!letterable(p)) return null;
      return { letter: shownLetter, overlay: lm.on, badge: badge.on && !lm.on && !gridOpen,
        grid: gridOpen ? SK.menuLetterTargets(runsOf(p)) : null };
    }
    function endLetterMode() {
      lm.timer = cancel(lm.timer);
      lm.on = false; lm.fastRun = 0;
    }
    function clearJump() {
      endLetterMode();
      badge.timer = cancel(badge.timer);
      badge.on = false;
      gridOpen = false;
    }
    // Update ONLY the three layers (a letter step must not rebuild the list or the art pane).
    // gate r1 Q2 (qa W3): the overlay and the badge are PERSISTENT nodes - their `is-on` class and
    // text are toggled in place, so the CSS fade actually runs (a class flip on a freshly parsed
    // node has no before-style: it vanished in one frame). A new pair is born OFF and its style is
    // read once before it can turn on. Only the picker is created / dropped.
    function dropNode(el) { if (el && el.parentNode) el.parentNode.removeChild(el); }
    function setLayer(el, on, letter) {
      if (el.textContent !== letter && (on || !el.classList.contains('is-on'))) el.textContent = letter;
      el.classList.toggle('is-on', !!on);
      if (on) el.removeAttribute('tabindex'); else el.setAttribute('tabindex', '-1');
    }
    function applyJump() {
      var mv = menuEl();
      var p = curPane();
      if (!mv || !p) return;
      var model = jumpModel(p);
      var ov = mv.querySelector(':scope > .ipm-letter');
      var bd = mv.querySelector(':scope > .ipm-badge');
      var gr = mv.querySelector(':scope > .ipm-grid');
      if (!model) { dropNode(ov); dropNode(bd); dropNode(gr); return; }
      if (!ov || !bd) {
        dropNode(ov); dropNode(bd);
        var w0 = doc.createElement('div');
        w0.innerHTML = SK.renderMenuJump({ letter: model.letter, overlay: false, badge: false, grid: null });
        ov = w0.querySelector('.ipm-letter'); bd = w0.querySelector('.ipm-badge');
        mv.appendChild(ov); mv.appendChild(bd);
        void ov.offsetWidth; // commit the OFF style, so the first turn-on fades in
      }
      setLayer(ov, model.overlay, model.letter);
      setLayer(bd, model.badge, model.letter);
      if (model.grid && !gr) {
        var w1 = doc.createElement('div');
        w1.innerHTML = SK.renderMenuJump({ letter: '', overlay: false, badge: false, grid: model.grid });
        mv.appendChild(w1.querySelector('.ipm-grid'));
      } else if (!model.grid && gr) {
        dropNode(gr);
      }
    }
    function armLetterHold() {
      lm.timer = cancel(lm.timer);
      lm.timer = later(function () { lm.timer = null; if (destroyed) return; endLetterMode(); applyJump(); }, LETTER_HOLD_MS);
    }
    function letterStep(p, dir) {
      var runs = runsOf(p);
      var to = SK.menuLetterJump(runs, p.cursor, dir);
      var moved = to !== p.cursor;
      p.cursor = to;
      scrollCursorIntoView(p, true);
      renderList();
      scheduleArt();
      shownLetter = SK.menuLetterAt(runs, p.cursor);
      armLetterHold();
      applyJump();
      return moved ? 1 : 0;
    }
    function openGrid() {
      var p = curPane();
      if (!letterable(p)) return;
      endLetterMode();
      badge.timer = cancel(badge.timer); badge.on = false;
      gridOpen = true;
      applyJump();
    }
    function closeGrid() { if (!gridOpen) return; gridOpen = false; applyJump(); }
    function pickLetter(i) {
      var p = curPane();
      gridOpen = false;
      if (!p || !(i >= 0 && i < p.items.length)) { applyJump(); return; }
      p.cursor = i;
      scrollCursorIntoView(p, true);
      renderList();
      scheduleArt();
      shownLetter = SK.menuLetterAt(runsOf(p), i);
      applyJump();
    }
    function showBadge(p, list) {
      if (!letterable(p) || lm.on || gridOpen) return;
      var topRow = (rowH > 0) ? Math.floor(list.scrollTop / rowH) : p.cursor;
      shownLetter = SK.menuLetterAt(runsOf(p), Math.max(0, Math.min(p.items.length - 1, topRow)));
      badge.on = true;
      badge.timer = cancel(badge.timer);
      badge.timer = later(function () { badge.timer = null; if (destroyed) return; badge.on = false; applyJump(); }, LETTER_HOLD_MS);
      applyJump();
    }

    function listModel(pane, list) {
      var st = style();
      var sTop = list ? list.scrollTop : pane.scrollTop;
      var w = SK.menuWindow(pane.items.length, pane.cursor, rowH, sTop, viewH);
      return { style: st, items: pane.items, cursor: pane.cursor, currentId: currentId(), start: w.start, end: w.end,
        rowH: rowH, state: pane.state, emptyText: emptyTextFor(pane.node) };
    }
    // Re-draw ONLY the rows (a scroll or a cursor step), keeping the list's own scroll offset.
    function renderList() {
      var pane = curPane();
      var list = listEl();
      if (!pane || !list) return;
      list.innerHTML = SK.renderMenuList(listModel(pane, list));
    }
    function measure() {
      var list = listEl();
      if (!list) return;
      var r = list.querySelector('.ipm-row:not(.ipm-skel)');
      var h = r ? r.offsetHeight : 0;
      var vh = list.clientHeight;
      var changed = (h > 0 && h !== rowH) || (vh > 0 && vh !== viewH);
      if (h > 0) rowH = h;
      if (vh > 0) viewH = vh;
      return changed;
    }
    function scrollCursorIntoView(pane, center) {
      var list = listEl();
      if (!list || !(rowH > 0) || !(viewH > 0)) return;
      var t = pane.cursor * rowH;
      if (center) list.scrollTop = Math.max(0, t - (viewH / 2) + (rowH / 2));
      else if (t < list.scrollTop) list.scrollTop = t;
      else if (t + rowH > list.scrollTop + viewH) list.scrollTop = t + rowH - viewH;
      pane.scrollTop = list.scrollTop;
      expectTop = list.scrollTop;
    }
    function render() {
      if (destroyed) return;
      checkData();
      var host = lcd();
      var st = style();
      var old = menuEl();
      var np = panel.querySelector('.ip-np');
      // gate r1 (qa S6): the pop-out's Nano tray has no wheel and shows Now Playing only - never
      // draw a menu (or its title) there, whatever screen the controller holds.
      if (!st || !host || screen !== 'menu' || trayUp()) {
        clearJump();
        stopSlides();
        artTimer = cancel(artTimer); // no art to settle on a screen that shows none
        if (old && old.parentNode) old.parentNode.removeChild(old);
        panel.classList.remove('mms-menumode');
        if (np && !panel.classList.contains('mms-listmode')) np.textContent = 'Now Playing';
        return;
      }
      var pane = curPane();
      ensureLoaded(pane);
      var art = st === 'click' ? artFor(pane) : '';
      var v = Object.assign(listModel(pane, null), {
        title: pane.title, root: stack.length === 1,
        art: art && art === artShown ? art : '', artIn: !!art && art === artShown,
        jump: null, // the layers are applyJump()'s (persistent nodes, below)
        aboutName: pane.node.type === 'about' ? SK.menuTitle({ type: 'main' }, st) : '',
      });
      var wrap = doc.createElement('div');
      wrap.innerHTML = SK.renderMenuView(st, v);
      var el = wrap.firstChild;
      if (old && old.parentNode && st === 'click' && old.classList.contains('ipm-click')) {
        // Addendum E: patch the Click screen IN PLACE around its art pane - the cover drift's
        // layers live there, and re-creating the pane would restart (or kill) a running drift.
        old.className = el.className;
        var ol = old.querySelector('.ipm-lpane');
        var nl = el.querySelector('.ipm-lpane');
        if (ol && nl) ol.parentNode.replaceChild(nl, ol);
        var kids = Array.prototype.slice.call(old.children);
        // the split (its art pane) and the two fade layers stay; everything else is redrawn
        kids.forEach(function (c) { if (!c.classList.contains('ipm-split') && !c.classList.contains('ipm-letter') && !c.classList.contains('ipm-badge')) old.removeChild(c); });
        Array.prototype.slice.call(el.children).forEach(function (c) { if (!c.classList.contains('ipm-split')) old.appendChild(c); });
      } else if (old && old.parentNode) {
        old.parentNode.replaceChild(el, old);
      } else {
        host.appendChild(el);
      }
      panel.classList.add('mms-menumode');
      if (np) np.textContent = pane.title;
      var list = listEl();
      if (list) { list.scrollTop = pane.scrollTop; expectTop = list.scrollTop; }
      // The first frame knows no geometry: measure, then re-window against the real rows.
      if (measure() || pane.center) {
        scrollCursorIntoView(pane, pane.center);
        pane.center = false;
        renderList();
      }
      applyJump();
      syncSlides();
    }

    // ---- the split screen's art (Click): the highlighted item's own image, eased in ----
    function artFor(pane) {
      var it = pane && pane.items[pane.cursor];
      return (it && it.art) || npArt || '';
    }
    function scheduleArt(delay) {
      artTimer = cancel(artTimer);
      if (style() !== 'click' || screen !== 'menu' || slide.on) return;
      // a spin moves the cursor several rows a second - only the row it SETTLES on loads art.
      artTimer = later(function () { artTimer = null; applyArt(); }, delay == null ? 140 : delay);
    }
    function applyArt() {
      if (destroyed || slide.on) return;
      var box = panel.querySelector('.ip-menuview .ipm-art');
      if (!box) return;
      var u = artFor(curPane());
      if (u === artShown && box.querySelector('.ipm-art-img')) return;
      artShown = u;
      if (!u) { box.innerHTML = ''; return; }
      var img = doc.createElement('img');
      img.className = 'ipm-art-img';
      img.alt = '';
      // reveal-once, both axes: a decoded image eases in; a failed one is dropped (the pane's
      // own backdrop shows) - never a broken-image glyph, never a stuck invisible frame.
      img.addEventListener('load', function () { img.classList.add('is-in'); }, { once: true });
      img.addEventListener('error', function () { if (img.parentNode) img.parentNode.removeChild(img); if (artShown === u) artShown = ''; }, { once: true });
      img.src = u;
      box.innerHTML = '';
      box.appendChild(img);
    }

    // ---- Addendum E: the cover DRIFT on the menu levels (Click) -----------------------------
    // Dean: "on real iPods the art gently moves from right to left ... in some of the views, like
    // the main views that are not the album that you picked". The 6G/7G main menus ran a slow
    // slideshow of random covers in the right pane: each cover pans gently (a CSS transform
    // transition on the image layer), then crossfades (opacity) to the next. Cheap by rule (the
    // ambient-mode lesson - a big animated layer blacked out video on iPhone): ONLY the pane's
    // own img layers animate, only transform + opacity, at most two stacked (the one showing +
    // the next, preloaded INVISIBLE in the pane before its fade so a slow network never shows a
    // blank pane). Runs only while it can be seen: a non-item level, the menu screen, not the tray,
    // the panel up, the document visible; every other state STOPS it (timers cleared, layers
    // dropped) and the next render/visibility change restarts it. Reduced motion: one still cover.
    // No covers in the library = today's pane (the playing track's art).
    var SLIDE_MS = 9000;   // one cover's time on screen (its drift runs a little longer in CSS)
    var FADE_MS = 1300;    // the crossfade, a little over the CSS opacity transition
    var slide = { on: false, box: null, cur: null, next: null, nextReady: false, due: false, timer: null, fadeTimer: null,
      pool: null, poolVer: null, poolReq: 0, gen: 0 };
    // gate r1 (qa S6): the covers were fetched for the library version the view reports; a newer
    // version re-fetches them (the drift keeps its current cover meanwhile - never freezes).
    function poolFresh() { return slide.pool !== null && slide.poolVer === readVer(cfg.dataVersion); }
    function fetchPool(then) {
      if (typeof cfg.coverPool !== 'function') return;
      var req = ++slide.poolReq;
      var ver = readVer(cfg.dataVersion);
      var pr;
      try { pr = Promise.resolve(cfg.coverPool()); } catch (e) { pr = Promise.reject(e); }
      pr.then(function (urls) {
        if (destroyed || req !== slide.poolReq) return;
        slide.pool = Array.isArray(urls) ? urls.slice() : [];
        slide.poolVer = ver;
        if (then) then();
      }, function () { if (req === slide.poolReq && !slide.pool) slide.poolVer = null; });
    }
    function reducedMotion() {
      try { return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; }
    }
    function slidesWanted() {
      var p = curPane();
      // gate r1 Q4 (adversary W3): a game holding the wheel (Brick from Extras) covers the LCD -
      // the drift pauses under it and restarts when the takeover is released.
      var held = false;
      try { held = !!(typeof o.takeoverLive === 'function' && o.takeoverLive()); } catch (_) { held = false; }
      return !!(!destroyed && style() === 'click' && screen === 'menu' && !trayUp() && p && !SK.menuIsItemLevel(p.node) &&
        panel.classList.contains('mms-full') && !panel.hidden && !doc.hidden && !held);
    }
    function stopSlides() {
      slide.timer = cancel(slide.timer);
      slide.fadeTimer = cancel(slide.fadeTimer);
      slide.gen += 1;
      [slide.cur, slide.next].forEach(function (img) { if (img && img.parentNode) img.parentNode.removeChild(img); });
      if (slide.box) {
        var left = slide.box.querySelectorAll('.ipm-slide');
        for (var i = 0; i < left.length; i++) left[i].parentNode.removeChild(left[i]);
      }
      var wasOn = slide.on;
      slide.on = false; slide.box = null; slide.cur = null; slide.next = null; slide.nextReady = false; slide.due = false;
      if (wasOn) { artShown = ''; }
    }
    function pickCover() {
      var pool = slide.pool || [];
      var curU = slide.cur ? slide.cur.getAttribute('src') : '';
      var choices = pool.filter(function (u) { return u !== curU; });
      if (!choices.length) return pool.length && !slide.cur ? pool[0] : '';
      return choices[Math.floor(Math.random() * choices.length)];
    }
    function preloadNext() {
      if (!slide.on || slide.next) return;
      var u = pickCover();
      if (!u) return;
      var gen = slide.gen;
      var img = doc.createElement('img');
      img.className = 'ipm-slide';
      img.alt = '';
      img.addEventListener('load', function () {
        if (gen !== slide.gen || slide.next !== img) return;
        slide.nextReady = true;
        if (slide.due) swapSlide();
      }, { once: true });
      img.addEventListener('error', function () {
        if (gen !== slide.gen || slide.next !== img) return;
        if (img.parentNode) img.parentNode.removeChild(img);
        slide.next = null; slide.nextReady = false;
        slide.pool = (slide.pool || []).filter(function (x) { return x !== u; }); // never retry a dead cover
        // gate r1 (adversary S4): EVERY cover failed and none is showing -> today's pane, not a blank
        if (!slide.cur && !slide.pool.length) { stopSlides(); scheduleArt(0); return; }
        preloadNext();
      }, { once: true });
      slide.next = img;
      slide.nextReady = false;
      img.src = u;
      slide.box.appendChild(img); // invisible (no .is-on) until its fade
    }
    function swapSlide() {
      if (!slidesWanted() || !slide.box || !slide.box.isConnected) { stopSlides(); if (!destroyed) scheduleArt(0); return; }
      if (!poolFresh()) fetchPool(null); // a library change: new covers for the NEXT swaps
      if (!slide.next || !slide.nextReady) { slide.due = true; if (!slide.next) preloadNext(); return; }
      slide.due = false;
      var gen = slide.gen;
      var incoming = slide.next;
      var outgoing = slide.cur || slide.box.querySelector('.ipm-art-img');
      slide.next = null; slide.nextReady = false;
      slide.cur = incoming;
      var still = reducedMotion();
      var raf = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : function (cb) { return later(cb, 16); };
      // the incoming layer paints once at its start state, THEN turns on (so it fades + drifts).
      // gate r1 Q2 (adversary W4): a cached cover can land before the node's first style
      // resolution - read its style FIRST, or the class flip snaps to the end state.
      raf(function () {
        if (gen !== slide.gen) return;
        void incoming.offsetWidth;
        incoming.classList.add('is-on');
        if (!still) incoming.classList.add('is-drift');
        if (outgoing) { outgoing.classList.remove('is-on'); outgoing.classList.remove('is-in'); }
      });
      slide.fadeTimer = cancel(slide.fadeTimer);
      slide.fadeTimer = later(function () {
        slide.fadeTimer = null;
        if (gen !== slide.gen) return;
        if (outgoing && outgoing.parentNode && outgoing !== slide.cur) outgoing.parentNode.removeChild(outgoing);
        if (!still) preloadNext(); // the next cover loads while this one drifts
      }, FADE_MS);
      slide.timer = cancel(slide.timer);
      if (!still) slide.timer = later(function () { slide.timer = null; if (gen === slide.gen) swapSlide(); }, SLIDE_MS);
    }
    function startSlides(box) {
      slide.on = true;
      slide.box = box;
      artTimer = cancel(artTimer);
      slide.due = true;
      preloadNext();
    }
    function syncSlides() {
      if (!slidesWanted()) {
        var was = slide.on;
        stopSlides();
        if (was || style() === 'click') scheduleArt(0);
        return;
      }
      var box = panel.querySelector('.ip-menuview .ipm-art');
      if (!box) { stopSlides(); return; }
      if (slide.on && slide.box === box) return; // already drifting in this pane
      if (slide.on) stopSlides();
      if (poolFresh() && slide.pool.length) { startSlides(box); return; }
      scheduleArt(0); // today's pane while the covers load (or when there are none)
      if (poolFresh()) return;
      fetchPool(function () { if (slide.pool.length) syncSlides(); });
    }

    // ---- navigation ----
    function setCursor(i) {
      var pane = curPane();
      if (!pane || !pane.items.length) return;
      // gate r1 (qa S2): a trailing read-only row (Lighting's note) is never a wheel stop - the
      // highlight would vanish there and Select would do nothing. Clamp to the last option.
      var last = pane.items.length - 1;
      while (last > 0 && pane.items[last] && pane.items[last].info) last -= 1;
      pane.cursor = Math.max(0, Math.min(last, i));
      scrollCursorIntoView(pane, false);
      renderList();
      scheduleArt();
    }
    function showNowPlaying() {
      screen = 'np';
      clearJump();
      render();
      // the Now Playing lines were display:none while the menu was up, so the marquee measured
      // nothing at the last paint - let the engine re-measure them now that they show.
      if (typeof o.onShowNowPlaying === 'function') { try { o.onShowNowPlaying(); } catch (_) { /* best-effort */ } }
    }
    function activate(i) {
      var lvl = top();
      var pane = curPane();
      if (!lvl || !pane) return;
      if (pane.state === 'error') { pane.state = 'idle'; render(); return; } // the center retries a failed load
      var it = pane.items[i];
      if (!it) return;
      if (it.info) return; // About's rows are read-only
      pane.cursor = i;
      clearJump();
      if (it.node) { stack.push(makeLevel(it.node)); render(); return; }
      if (it.action === 'nowplaying') { showNowPlaying(); return; }
      if (it.action === 'shuffle') {
        try { if (typeof cfg.onShuffleAll === 'function') cfg.onShuffleAll(); } catch (_) { /* view best-effort */ }
        showNowPlaying();
        return;
      }
      if (it.action === 'lighting') {
        // Settings > Lighting: the pick is stored and (on iOS) motion access is asked for INSIDE this
        // tap (the delegated click reaches here synchronously, so the user activation is live). The
        // level stays up; the check moves now, a note row appears once the answer is in.
        if (!lighting) { render(); return; }
        var pr = null;
        try { pr = lighting.choose(it.value); } catch (_) { pr = null; }
        render();
        Promise.resolve(pr).then(function () {
          if (destroyed) return;
          var p2 = curPane();
          if (p2 && p2.node.type === 'lighting' && screen === 'menu') render();
        }, function () { /* the driver's promise never rejects; belt-and-braces */ });
        return;
      }
      if (it.action === 'brick') {
        // Addendum C: the SAME launch v1.270's sticker Brick row made (that row went in v1.333; the view's hook: it mounts
        // the game on this engine's LCD and hands it the wheel). MENU, a repaint, a dock, a skin
        // switch and the view dying all end it through the existing v1.270 release; the menu
        // underneath stays on this level, so MENU out of the game lands back on Games.
        if (!gamesVisible()) { render(); return; }
        try { games.onTap(); } catch (_) { /* view best-effort */ }
        return;
      }
      if (it.song) {
        // the pane a song was chosen from is the PLAYING context: its cursor follows the queue
        // as it advances (afterPaint), so MENU from Now Playing lands on the song that plays.
        stack.forEach(function (l) { l.panes.forEach(function (p) { p.playing = false; }); });
        pane.playing = true;
        lastCurrent = null;
        try { if (typeof cfg.onPlay === 'function') cfg.onPlay({ tracks: pane.tracks || [], index: it.trackIndex, play: pane.play }); } catch (_) { /* view best-effort */ }
        showNowPlaying();
      }
    }
    // The v1.311 "re-register at EVERY advance" rule for a display that advances without a
    // reload: a chaptered album rolls its chapter (and a queue advances its track) through
    // paint(), so this runs at each advance and moves the playing list's cursor onto what now
    // plays. Keyed on the id, never a position (a later append or a sort never fools it).
    // Gate r1 K1 (adversary W1): never move the highlight of the list ON SCREEN - the device never
    // does, and a highlight that jumps as the track ends turns the next center press into a replay
    // of the wrong song (the v1.104 wrong-track class, timed by track length). The visible list
    // moves only its speaker mark (render reads currentId) and keeps the row you parked on. A list
    // off screen - the playing list is a leaf level, so off screen means Now Playing is up - follows
    // at once and is re-centred on the playing row when MENU brings it back.
    function followCurrent() {
      var cur = currentId();
      if (cur === lastCurrent) return;
      lastCurrent = cur;
      // gate r1 (qa S8): a new track is a new listen - the "recent" lists NOT on screen re-load
      // when next shown (the one on screen keeps its rows under your finger), their highlight put
      // back by identity (gate r2). The list being PLAYED FROM is never re-loaded here: it mirrors
      // the queue, and the follow below moves its highlight onto what plays (the K1 rule).
      markStale(function (p) { return !isVisible(p) && !p.playing && (p.node.type === 'recentArtists' || (p.node.type === 'playlist' && p.node.key === 'recent-played')); });
      if (!cur) return;
      stack.forEach(function (l) {
        l.panes.forEach(function (p) {
          if (!p.playing || isVisible(p)) return;
          for (var i = 0; i < p.items.length; i++) {
            if (p.items[i] && p.items[i].id === cur) { p.cursor = i; p.center = true; break; }
          }
        });
      });
    }
    function onScroll(e) {
      var list = listEl();
      if (!list || e.target !== list) return;
      var pane = curPane();
      if (pane) pane.scrollTop = list.scrollTop;
      // a FINGER's scroll (not one this controller wrote) shows the letter badge at the edge
      if (pane && !(expectTop !== null && Math.abs(list.scrollTop - expectTop) <= 1)) { expectTop = null; showBadge(pane, list); }
      if (listRaf != null) return;
      var raf = (win && win.requestAnimationFrame) ? win.requestAnimationFrame.bind(win) : function (cb) { return win.setTimeout(cb, 16); };
      listRaf = raf(function () { listRaf = null; if (!destroyed) { measure(); renderList(); } });
    }

    return {
      // the style the CURRENT skin carries ('' = no menus: every hook below declines)
      active: function () { return !!style(); },
      isMenuMode: function () { return !!style() && screen === 'menu'; },
      // quick scroll: is the wheel in letter mode right now? (the engine's haptic path reads it)
      inLetterMode: function () { return !!(lm.on && letterable(curPane())); },
      // after every paint(): rebuild on a style change, follow the advance, re-draw.
      afterPaint: function (ctx) {
        if (style() !== builtFor) { clearJump(); stopSlides(); resetStack(); }
        npArt = (ctx && ctx.track && ctx.track.artUrl) || '';
        followCurrent();
        render();
      },
      // MENU: the A-Z picker closes first; then Now Playing climbs to the menu you came from; a
      // list climbs one level; the Main Menu declines (false) so the engine docks - the way out.
      onMenu: function () {
        if (!style()) return false;
        if (gridOpen && screen === 'menu') { closeGrid(); return true; }
        clearJump();
        if (screen !== 'menu') { screen = 'menu'; render(); return true; }
        if (stack.length > 1) { stack.pop(); render(); return true; }
        return false;
      },
      onSelect: function () {
        if (!style() || screen !== 'menu') return false;
        if (gridOpen) { closeGrid(); return true; }
        if (checkData()) { render(); return true; } // a stale level re-loads; never act on its old rows
        var p = curPane();
        activate(p ? p.cursor : 0);
        return true;
      },
      // A new wheel gesture: the fast-move count starts again (never latched across a lift).
      onGestureStart: function () { lm.fastRun = 0; },
      // ONE call per pointermove in cursor mode: was this move fast (the engine's own band)?
      noteMove: function (fast) {
        lm.moveJumped = false;
        var p = curPane();
        if (!letterable(p)) { lm.fastRun = 0; return; }
        if (fast) lm.fastRun += 1; else if (!lm.on) lm.fastRun = 0;
        if (!lm.on && lm.fastRun >= LETTER_ENGAGE_MOVES) { lm.on = true; badge.timer = cancel(badge.timer); badge.on = false; }
      },
      // One wheel detent. Returns how many LETTERS it crossed (the engine ticks the haptic).
      moveCursor: function (delta) {
        if (checkData()) { render(); return 0; }
        var p = curPane();
        if (!p) return 0;
        if (gridOpen) closeGrid();
        if (lm.on && letterable(p)) {
          if (lm.moveJumped) return 0; // one letter per pointermove, however far the finger went
          lm.moveJumped = true;
          return letterStep(p, delta > 0 ? 1 : -1);
        }
        setCursor(p.cursor + delta);
        return 0;
      },
      onItemTap: function (i) { if (screen !== 'menu') return; if (checkData()) { render(); return; } activate(i); },
      // quick scroll's taps (the overlay/badge open the picker, a letter jumps, a tap outside
      // closes it). True = consumed. ANY other tap while the picker is open only closes it.
      onPanelClick: function (e) {
        if (!style() || screen !== 'menu') return false;
        var t = e.target;
        var lt = t.closest('[data-skin-letter]');
        if (lt) { pickLetter(parseInt(lt.getAttribute('data-skin-letter'), 10)); return true; }
        if (t.closest('[data-skin-letters]')) { openGrid(); return true; }
        if (!gridOpen) return false;
        if (t.closest('[data-skin-lettergrid]')) return true; // the picker's own dead space
        // gate r1 (adversary S2): the tap that closes the picker does nothing else - never a
        // play/pause, a skip or a row under it.
        closeGrid();
        return true;
      },
      onScroll: onScroll,
      // the document's visibility changed: the drift stops while hidden, restarts on return.
      onVisibility: function () { if (destroyed) return; if (doc.hidden) stopSlides(); else syncSlides(); },
      // a wheel takeover (Brick) started or ended: the drift pauses under it / resumes after.
      onTakeover: function () { if (destroyed || !style()) return; syncSlides(); },
      // test/diagnostic seam: the live state, read-only copies.
      state: function () {
        var p = curPane();
        return { screen: screen, depth: stack.length, title: p ? p.title : '', node: p ? p.node : null,
          cursor: p ? p.cursor : -1, count: p ? p.items.length : 0, loadState: p ? p.state : '', pane: top() ? top().pane : 0,
          letterMode: lm.on, letter: shownLetter, badge: badge.on, grid: gridOpen,
          slides: slide.on, slideTimers: (slide.timer != null ? 1 : 0) + (slide.fadeTimer != null ? 1 : 0),
          timers: (lm.timer != null ? 1 : 0) + (badge.timer != null ? 1 : 0) + (artTimer != null ? 1 : 0) +
            (slide.timer != null ? 1 : 0) + (slide.fadeTimer != null ? 1 : 0) };
      },
      destroy: function () {
        destroyed = true;
        artTimer = cancel(artTimer);
        clearJump();
        stopSlides();
        slide.poolReq += 1;
        if (listRaf != null) { try { (win.cancelAnimationFrame || win.clearTimeout).call(win, listRaf); } catch (_) { /* ignore */ } listRaf = null; }
      },
    };
  }

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
    // D7 (v1.332, Dean: "Right now I must press menu many times then the FileTube icon"): HOME from
    // the player - the sticker's first row, and press-and-hold MENU on the Click wheel. The VIEW owns
    // what home means (music.js / podcasts.js: dock quietly - the song keeps playing in the mini -
    // then the SPA router to /); the engine only offers the two gestures, and only in the main
    // document (the watch-back posture: the pop-out's router is the main window's).
    var onHome = (typeof config.onHome === 'function') ? config.onHome : null;
    var HOME_HOLD_MS = 600; // longer than the rewind/ffwd hold-to-scan (400 ms): a hold, never a slow tap
    function homeAvailable() { return !!onHome && (typeof document !== 'undefined') && doc === document; }
    function goHome() {
      closeStickerMenu();
      try { onHome(); } catch (_) { /* view nav best-effort */ }
    }
    var onShuffle = typeof config.onShuffle === 'function' ? config.onShuffle : null;
    var onArtist = typeof config.onArtist === 'function' ? config.onArtist : null; // v1.317 M1: the artist line's action
    var fastScan = !!config.fastScan;
    var marqueeOn = config.marquee !== false; // default ON (CSS-driven; inert without overflow)
    var stickerCfg = config.sticker || null;
    var extrasCfg = (stickerCfg && stickerCfg.extras) || null;
    // The pocket menus (2026-09-24) - only where the VIEW supplies a menu data source (music does;
    // podcasts pass none, so their Click screens keep today's behaviour byte-for-byte),
    // and even then only on a skin whose registry entry carries `menus`.
    // Extras only on a MAIN-document surface: the shared modals/toasts render in the main
    // window, so a pop-out offering Extras would open UI behind itself (v1.249 scope rule).
    // Dean wants pop-out Extras (2026-09-02) - that lifts WITH doc-aware shared dialogs, a
    // queued wave (see the plan doc's queue); until then this gate stays.
    var inMainDoc = (typeof document !== 'undefined') && doc === document;
    // Addendum C: the menus' Extras > Games > Brick rides the view's Brick hook (the sticker's own
    // Brick row was removed in v1.333, so this is now its only entry), under the SAME gate (main document only - v1.270 slim W4: the game mounts on the
    // IN-TAB engine's LCD, and wire() is per-view, not per-surface). The pop-out gets no hook, so
    // its menus draw no Extras/Games entry at all.
    var menuGames = (inMainDoc && stickerCfg && stickerCfg.brick) || null;
    // Pocket lighting (2026-09-24, plan pocket-gyro-lighting): one driver per surface, optional
    // like SKINS (a shell without pocket-lighting.js just has no lighting and no Settings row).
    // The scope question the driver must not answer itself: WHICH skins are lit - the registry's
    // menus === 'click' (every Click colorway).
    var LIT = (typeof window !== 'undefined' && window.FileTubePocketLighting) || null;
    var lighting = (LIT && typeof LIT.create === 'function')
      ? LIT.create({ panel: panel, win: win, doc: doc, store: config.lightingStore || null, now: config.lightingNow || null,
        isPocket: function () { try { return SKINS.menuStyle(getSkinId()) === 'click'; } catch (_) { return false; } } })
      : null;
    var pocket = (config.menu && typeof config.menu.load === 'function')
      ? createPocketMenu({ cfg: config.menu, panel: panel, doc: doc, win: win, SKINS: SKINS, getSkinId: getSkinId, games: menuGames, lighting: lighting,
        takeoverLive: function () { return !!wheelTakeover; },
        onShowNowPlaying: function () { if (!marqueeOn) return; var raf = (win && win.requestAnimationFrame) || function (cb) { return setTimeout(cb, 0); }; raf(function () { applyMarquee(); }); } })
      : null;
    function stickerPlayer() {
      if (stickerCfg && typeof stickerCfg.getPlayer === 'function') { try { return stickerCfg.getPlayer(); } catch (_) { return null; } }
      return (typeof window !== 'undefined' && window.FileTube && window.FileTube.player) || null;
    }

    var WHEEL_STEP_DEG = 22;           // wheel degrees per one-item cursor step (music parity)
    // v1.233's fast-flick acceleration: rows per cursor step by angular speed (deg/ms). The ONE
    // speed signal the wheel has - the pocket menus' letter mode reads the same band (below).
    function cursorStepMult(speed) { return speed > 2.4 ? 4 : (speed > 1.5 ? 3 : (speed > 0.8 ? 2 : 1)); }
    // Quick scroll (2026-09-24): a pointermove counts as FAST for letter mode from the first band
    // where the wheel already stops moving one row per detent (> 0.8 deg/ms, about 2.2 turns a
    // second) - the engine's own "this is a flick" line, not a second velocity estimator. The
    // pocket menu arms letter mode after three such MOVES in a row inside one gesture.
    var LETTER_FAST_MULT = 2;
    // gate r1 Q1 (adversary W1): the ONE speed signal's time base. A handler runs late under load,
    // so the gap between two HANDLER runs can be far shorter than the gap between the two EVENTS
    // (measured at CPU x4: 14.8 ms vs 22 ms, a 0.63 deg/ms turn read as 0.93). The engine takes
    // the LONGER of the two gaps: never faster than either clock says (a batch of coalesced events
    // shares one handler instant; an event clock can lag a handler that ran on time).
    // An event clock in ANOTHER time base (an old WebKit's epoch-ms timeStamp; jsdom's) is ignored -
    // only a timeStamp on the performance.now() origin (within a minute of it) is a second clock.
    function evTime(ev) {
      var t = ev && Number(ev.timeStamp);
      if (!(isFinite(t) && t > 0)) return 0;
      return Math.abs(nowMs() - t) < 60000 ? t : 0;
    }
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
      // v1.279 (Dean): when a chaptered `::c` track is playing, Loop already loops the CURRENT
      // CHAPTER (music.js enforceChapterLoop), not the whole file - so say so, else there is
      // "no clear way to loop a chapter". The view supplies the chapter test (isChapterTrack);
      // plain "Loop" for a normal song.
      var loopIsChapter = false;
      try { loopIsChapter = !!(stickerCfg && typeof stickerCfg.isChapterTrack === 'function' && stickerCfg.isChapterTrack()); } catch (_) { loopIsChapter = false; }
      var loopLabel = loopIsChapter ? 'Loop chapter' : 'Loop';
      var skins = SKINS.SKINS || [];
      var active = (typeof SKINS.activeSkinId === 'function') ? SKINS.activeSkinId() : '';
      // v1.257 (QA S3) -> v1.258 (Dean's colorway round): inside the TRAY the chips are
      // FILTERED to the Click colorways - those picks genuinely restyle the tray (each
      // colorway's body roles); non-family picks would visibly
      // no-op there and stay hidden. NOTE the pick still writes the GLOBAL skin pref
      // (the tray colorway IS the skin choice - disclosed).
      var trayActive = false;
      if (!inMainDoc && stickerCfg.tray && typeof stickerCfg.tray.enabled === 'function') {
        try { trayActive = !!stickerCfg.tray.enabled(); } catch (_) { trayActive = false; }
      }
      var chips = skinChipsHtml(trayActive);
      var activeLabel = '';
      skins.forEach(function (s) { if (s.id === active) activeLabel = s.label; });
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
      // v1.317 (M1, Dean: "a smooth way to access the channel"): the "Go to channel" row beside
      // Watch - rendered ONLY when the view supplies the channel hook AND says the playing item
      // has one (music: a library-backed track with a channel folder). Main-document only, the
      // watchBack posture: the tap NAVIGATES the window (to the home grid filtered by folder).
      var channelRow = '';
      if (inMainDoc && stickerCfg.channel && typeof stickerCfg.channel.visible === 'function') {
        var chOn = false;
        try { chOn = !!stickerCfg.channel.visible(); } catch (_) { chOn = false; }
        if (chOn) channelRow = '<div class="mms-sm-sec"><button type="button" class="mms-sm-extras" data-skin-channel><span class="mms-sm-lbl"><i class="icon-folder"></i>Go to channel</span><span class="mms-sm-state">&rsaquo;</span></button></div>';
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
      // v1.333 (Dean: "We have brick there. I don't think we need it to be there"): the sticker no
      // longer offers Brick. The game lives on at the pocket menus' Extras > Games > Brick, which rides
      // the SAME view hook (stickerCfg.brick -> menuGames, main document only - the v1.270 slim W4 gate).
      // v1.333 (Dean: "we could add lighting there as well"): the four strengths as chips, only where
      // the driver can light THIS skin (a Click colorway, pocket-lighting.js loaded), never in the tray
      // (the tray is never lit). The tap is the Settings > Lighting call (see handleStickerClick).
      var lightRow = '';
      if (!trayActive && lightingHere()) {
        var lst = null;
        try { lst = lighting.state(); } catch (_) { lst = null; }
        var cur = (lst && lst.strength) || 'off';
        var lchips = (SKINS.LIGHTING_STRENGTHS || []).map(function (r) {
          var on = r.value === cur;
          return '<button type="button" role="menuitemradio" class="mms-sm-chip' + (on ? ' is-on' : '') +
            '" data-skin-lighting="' + escapeHtml(r.value) + '" aria-checked="' + (on ? 'true' : 'false') + '">' + escapeHtml(r.label) + '</button>';
        }).join('');
        var lnote = (lst && lst.note) ? '<div class="mms-sm-note">' + escapeHtml(lst.note) + '</div>' : '';
        lightRow = '<div class="mms-sm-sec"><div class="mms-sm-h">Lighting</div><div class="mms-sm-skins">' + lchips + '</div>' + lnote + '</div>';
      }
      // v1.333 (Dean: Skin on its own page, so page 1 fits a phone): the row names the active skin and
      // opens the chips (the Extras pattern). The TRAY keeps its short inline Color chips.
      var skinSec = trayActive
        ? '<div class="mms-sm-sec"><div class="mms-sm-h">Color</div><div class="mms-sm-skins">' + chips + '</div></div>'
        : '<div class="mms-sm-sec"><button type="button" class="mms-sm-extras" data-skin-skins><span class="mms-sm-lbl"><i class="icon-photos"></i>Skin</span><span class="mms-sm-state">' + escapeHtml(activeLabel) + ' &rsaquo;</span></button></div>';
      // v1.249: the second-page entry - library-backed tracks on the in-tab surface only.
      var extras = extrasEligible()
        ? '<div class="mms-sm-sec"><button type="button" class="mms-sm-extras" data-skin-extras><span class="mms-sm-lbl"><i class="icon-more"></i>Extras</span><span class="mms-sm-state">&rsaquo;</span></button></div>'
        : '';
      // D7: Home leads the menu - two taps from any screen or menu depth
      var homeRow = homeAvailable()
        ? '<div class="mms-sm-sec"><button type="button" class="mms-sm-extras" data-skin-home><span class="mms-sm-lbl"><i class="icon-home"></i>Home</span><span class="mms-sm-state">&rsaquo;</span></button></div>'
        : '';
      return homeRow + '<div class="mms-sm-sec"><div class="mms-sm-h">Speed</div><div class="mms-sm-speed">' + speed + '</div></div>' +
        '<div class="mms-sm-sec"><button type="button" role="menuitemcheckbox" class="mms-sm-loop' + (loopOn ? ' is-on' : '') +
        '" data-skin-loop aria-checked="' + (loopOn ? 'true' : 'false') + '"><span class="mms-sm-lbl"><i class="icon-refresh"></i>' + loopLabel + '</span><span class="mms-sm-state">' + (loopOn ? 'On' : 'Off') + '</span></button></div>' +
        autoplay + trayRow + skinSec + lightRow +
        watchBack + channelRow + extras;
    }
    // The skin chips (v1.332: the registry's list; inside the TRAY only the Click colorways - those picks
    // genuinely restyle the tray, the rest would no-op there). Page 1 of the tray, the Skin page elsewhere.
    function skinChipsHtml(trayActive) {
      var skins = SKINS.SKINS || [];
      var active = (typeof SKINS.activeSkinId === 'function') ? SKINS.activeSkinId() : '';
      var chipSkins = trayActive ? skins.filter(function (s) { return s.menus === 'click'; }) : skins; // the registry's Click colorways (v1.332)
      return chipSkins.map(function (s) {
        var on = s.id === active;
        return '<button type="button" role="menuitemradio" class="mms-sm-chip' + (on ? ' is-on' : '') +
          '" data-skin-pick="' + escapeHtml(s.id) + '" aria-checked="' + (on ? 'true' : 'false') + '">' +
          escapeHtml(s.label) + '</button>';
      }).join('');
    }
    // v1.333: can the lighting driver light the skin this surface shows? (the driver's own isPocket)
    function lightingHere() {
      if (!lighting) return false;
      // the driver's own answer: a Click colorway, and never the Nano tray (body.mms-tray - the tray is never
      // lit, whatever the sticker's tray hook says: the plain-window pop-out fallback has none)
      try { return SKINS.menuStyle(getSkinId()) === 'click' && !(doc.body && doc.body.classList.contains('mms-tray')); } catch (_) { return false; }
    }
    function openStickerSkins() {
      var menu = panel.querySelector('[data-skin-sticker-menu]');
      if (!menu) return;
      extrasMenu.cancelPending(); // (a stale Extras fetch never lands on this page)
      menu.setAttribute('data-sm-page', 'skins');
      menu.innerHTML = extrasBackHtml() + '<div class="mms-sm-sec"><div class="mms-sm-h">Skin</div><div class="mms-sm-skins">' + skinChipsHtml(false) + '</div></div>';
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
      // v1.333: the WRAP carries the size too, so the menu (the button's sibling) reads --mms-sticker-px -
      // its max-height is the space ABOVE the sticker (Dean's 2x sticker pushed the menu's top off-screen)
      wrap.className += szCls;
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
      extrasMenu.cancelPending();
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

    // v1.278: the Extras action core now lives in the shared createExtrasMenu factory
    // (reused by the desktop /music actions menu). The two-page "Back" chrome + the
    // data-sm-page TOCTOU marker stay here (skin-only); the skin path is byte-identical.
    function extrasBackHtml() {
      return '<div class="mms-sm-sec"><button type="button" class="mms-sm-back" data-skin-extras-back>&lsaquo; Back</button></div>';
    }
    var extrasMenu = createExtrasMenu({
      getMenuEl: function () { return panel.querySelector('[data-skin-sticker-menu]'); },
      getBaseId: function () { return extrasCfg ? extrasCfg.getBaseId() : null; },
      getPlayer: stickerPlayer,
      getSignal: function () { return (extrasCfg && extrasCfg.signal) || null; },
      close: closeStickerMenu,
      backHtml: extrasBackHtml,
      stillOnPage: function () { var m = panel.querySelector('[data-skin-sticker-menu]'); return !!m && m.getAttribute('data-sm-page') === 'extras'; },
      onMutated: function () { if (extrasCfg && typeof extrasCfg.onMutated === 'function') { try { extrasCfg.onMutated(); } catch (_) { /* view refresh best-effort */ } } },
      // v1.287: forward the media-type ADAPTER fields (undefined for music/video -> the factory
      // defaults preserve their behaviour; podcasts supply the podcast endpoints/capabilities).
      fetchItem: extrasCfg ? extrasCfg.fetchItem : undefined,
      downloadUrl: extrasCfg ? extrasCfg.downloadUrl : undefined,
      shareLinkUrl: extrasCfg ? extrasCfg.shareLinkUrl : undefined,
      capabilities: extrasCfg ? extrasCfg.capabilities : undefined,
      watchedLabels: extrasCfg ? extrasCfg.watchedLabels : undefined,
      deleteNeedsModify: extrasCfg ? extrasCfg.deleteNeedsModify : undefined,
      onDelete: extrasCfg ? extrasCfg.onDelete : undefined,
      onQueue: extrasCfg ? extrasCfg.onQueue : undefined,
      likeRequest: extrasCfg ? extrasCfg.likeRequest : undefined,
      watchedRequest: extrasCfg ? extrasCfg.watchedRequest : undefined,
      onChapterSnap: extrasCfg ? extrasCfg.onChapterSnap : undefined, // Chapter Snap (2026-09-24): "This chapter starts wrong"
    });
    function openStickerExtras() {
      var menu = panel.querySelector('[data-skin-sticker-menu]');
      if (!menu) return;
      menu.setAttribute('data-sm-page', 'extras');
      extrasMenu.open();
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
      if (e.target.closest('[data-skin-home]')) { if (homeAvailable()) goHome(); return true; } // D7
      if (e.target.closest('[data-skin-watchback]')) {
        closeStickerMenu();
        if (stickerCfg.watchBack && typeof stickerCfg.watchBack.onTap === 'function') { try { stickerCfg.watchBack.onTap(); } catch (_) { /* view nav best-effort */ } }
        return true;
      }
      if (e.target.closest('[data-skin-channel]')) { // v1.317 M1: the same navigate-away shape as Watch
        closeStickerMenu();
        if (stickerCfg.channel && typeof stickerCfg.channel.onTap === 'function') { try { stickerCfg.channel.onTap(); } catch (_) { /* view nav best-effort */ } }
        return true;
      }
      if (e.target.closest('[data-skin-extras]')) { openStickerExtras(); return true; }
      if (e.target.closest('[data-skin-extras-back]')) { refreshStickerMenu(); return true; }
      var xact = e.target.closest('[data-skin-x]');
      if (xact) { extrasMenu.handleAction(xact.getAttribute('data-skin-x'), xact); return true; }
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
      // v1.333: the Skin row opens the chips on their own page (Back = the extras Back, page 1)
      if (e.target.closest('[data-skin-skins]')) { openStickerSkins(); return true; }
      // v1.333: a Lighting chip is the Settings > Lighting pick - lighting.choose() runs SYNCHRONOUSLY
      // inside this click, so on iOS the motion ask has its user activation (the first-tap ask's
      // capture listener, if armed, asked from the same gesture; choose() owns the answer from here).
      var lopt = e.target.closest('[data-skin-lighting]');
      if (lopt) {
        var lpr = null;
        if (lightingHere()) { try { lpr = lighting.choose(lopt.getAttribute('data-skin-lighting')); } catch (_) { lpr = null; } }
        refreshStickerMenu();
        // the answer (a denied / no-sensor note) re-draws page 1 if the menu is still open on it
        Promise.resolve(lpr).then(function () {
          var lm = panel.querySelector('[data-skin-sticker-menu]');
          if (lm && !lm.hidden && !lm.getAttribute('data-sm-page')) refreshStickerMenu();
        }, function () { /* the driver's promise never rejects */ });
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
    // v1.270 (slim CRITICAL-2): anything that BLOWS AWAY the panel must first release
    // whatever was mounted inside it. paint() replaces innerHTML wholesale - and it runs
    // on every track change, every chapter roll, the skin picker and the dock - so a
    // takeover mounted in the LCD was silently orphaned while its rAF loop kept running
    // and this pointer stayed set, leaving the wheel dead until reload. Structural, not
    // event-driven (the v1.256 paused-dock lesson): the seam that destroys owns the
    // release, so one line covers every path including ones added later.
    function releaseWheelTakeover() {
      if (!wheelTakeover) return;
      var t = wheelTakeover;
      wheelTakeover = null;
      if (typeof t.onExit === 'function') { try { t.onExit(); } catch (_) { /* a dying takeover must not block the repaint */ } }
      if (pocket) pocket.onTakeover(); // the cover drift resumes (gate r1 Q4)
    }

    // v1.271: a repaint that replaces the wheel MID-GESTURE used to leave the drag for
    // dead - the node was swapped with its listeners still attached, pointer capture was
    // never released, endWheel never ran (so the lift-off click was NOT suppressed and
    // could fire onDock), and the haptic ghost the OS was tracking vanished. Measured:
    // 15 ticks before the repaint, 0 after; scrub delta 20.6s before, 0.0s after. It got
    // worse recently because paint() gained triggers - v1.254's network-timed autoplay
    // append repaints at an arbitrary moment after every track change, which is exactly
    // when a thumb reaches for the wheel.
    //
    // ENDING the gesture cleanly would fix the corruption but still lose the drag, so we
    // DEFER instead: while a spin is live the repaint is queued and flushed by endWheel,
    // the one seam that owns endings. The drag survives intact and the panel catches up
    // the instant the finger lifts.
    var paintPending = false;
    function paint() {
      // Defer ONLY for a gesture that can still REACH endWheel. The early return jumped
      // over `wheelSpin = null` below - which WAS the engine's stale-spin self-heal - so a
      // view-side panel clear (music.js and podcasts.js both empty innerHTML without
      // calling destroy(), and the v1.256 QA CRITICAL documents that path taking no
      // events) left wheelSpin set forever and FROZE every future repaint: a blank
      // full-screen skin with a dead wheel, no in-app recovery. Pre-v1.271 that same
      // event cost one gesture and healed on the next repaint; the deferral made it
      // permanent. So: if the wheel this spin is bound to is gone, end the stale gesture
      // here and paint anyway.
      if (wheelSpin) {
        if (wheelSpin.wheel && wheelSpin.wheel.isConnected) { paintPending = true; return; }
        var stale = wheelSpin;
        paintPending = false; // THIS paint is the flush - endWheel must not re-enter
        try { endWheel(stale, false); } catch (_) { /* the node is already gone */ }
      }
      paintPending = false;
      releaseWheelTakeover();
      var id = getSkinId();
      var base = (typeof SKINS.skinById === 'function' && (SKINS.skinById(id) || {}).base) || '';
      panel.className = 'music-nowplaying-panel mms mms-full mms-' + id + (base ? ' mms-' + base : '');
      // v1.271: no longer the normal heal (the guard at the top of paint() ends a stale spin
      // properly, with its timers). This is the BACKSTOP for an endWheel that throws inside
      // that try/catch - a repaint must never leave a live spin behind.
      wheelSpin = null;
      // v1.317 gate r1 W1 (both seats): the artist line is a CONTROL only where a handler exists
      // - this engine's onArtist (podcasts pass none, so their show line stays a plain div; the
      // pop-out shell instantiates this same engine, so it follows) - and the view may veto it
      // per track with ctx.artistTap === false (music: a listen video with no channel).
      var ctx = getCtx() || {};
      panel.innerHTML = SKINS.renderFull(id, Object.assign({}, ctx, { artistTap: !!onArtist && ctx.artistTap !== false }));
      panel.hidden = false;
      // Adversarial gate W1 (v1.250): shimmerArt lives on the MAIN window - a pop-out is a
      // blank scriptless window, so win.FileTube is undefined there and the art-shimmer would
      // never clear (a permanent sweep on a slow/404 cover). shimmerArt works cross-document
      // (panel.querySelectorAll), exactly how the old music.js paintSkin called it.
      if (typeof window !== 'undefined' && window.FileTube && typeof window.FileTube.shimmerArt === 'function') window.FileTube.shimmerArt(panel);
      if (stickerCfg) injectSticker(); // v1.238: the quick-menu sticker on every skin paint
      mountWheelGhost(); // v1.256: the haptic ghost (capable devices + a wheel skin only)
      if (pocket) pocket.afterPaint(ctx); // pocket menus: re-draw the menu level this repaint just replaced
      if (lighting) lighting.sync();     // pocket lighting: re-apply the lit class (className was rebuilt) or stop on a non-Click skin
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
      if (pocket) {
        // pocket menus: the menu list's scroll re-windows its rows (scroll does not bubble - capture).
        panel.addEventListener('scroll', onMenuScroll, true);
        // Addendum E: the cover drift stops while the document is hidden and restarts on return.
        try { doc.addEventListener('visibilitychange', onDocVisibility); } catch (_) { /* a detached fixture */ }
      }
      try {
        win.addEventListener('resize', onViewportChange);
        win.addEventListener('orientationchange', onViewportChange);
      } catch (_) { /* a detached fixture window */ }
    }
    function onMenuScroll(e) { if (pocket) pocket.onScroll(e); }
    function onDocVisibility() { if (pocket) pocket.onVisibility(); }
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
      if (pocket && !wheelTakeover) {
        // quick scroll: the letter overlay/badge open the A-Z picker, a letter jumps, a tap
        // outside closes it (MENU/Select there only close it).
        if (pocket.onPanelClick(e)) return;
        // pocket menus: a menu ROW tap selects it (phone users); the |<< >>| keep skipping
        // tracks, as the device's did.
        var mi = e.target.closest('[data-skin-mi]');
        if (mi) { pocket.onItemTap(parseInt(mi.getAttribute('data-skin-mi'), 10)); return; }
      }
      if (e.target.closest('[data-skin-play]')) { var pb = hostCtl('pp-btn'); if (pb) pb.click(); return; }
      if (e.target.closest('[data-skin-prev]')) { var pv = hostCtl('track-prev-btn'); if (pv) pv.click(); return; }
      if (e.target.closest('[data-skin-next]')) { var nx = hostCtl('track-next-btn'); if (nx) nx.click(); return; }
      if (e.target.closest('[data-skin-collapse]')) { onDock(); return; }
      if (onShuffle && e.target.closest('[data-skin-shuffle]')) { onShuffle(); return; }
      // v1.317 (M1): the artist line -> the view's artist drill. Both surfaces (the pop-out's
      // engine runs this too; the drill opens in the MAIN document, nothing window-bound).
      if (e.target.closest('[data-skin-artist]')) { if (onArtist) onArtist(); return; }
      // v1.270: while a takeover holds the wheel, MENU is its way OUT (the iPod rule
      // that MENU always backs out of wherever you are) and Select is its action
      // button. Both are folded INSIDE the existing single handler for their control
      // rather than added as earlier branches - a second handler silently stole the
      // v1.233 lock's first-occurrence anchor. (menu-returns-to-origin.test.js used to
      // match data-skin-menu -> onDock inside a character window; since the pocket
      // menus it reads this handler's own block and requires its LAST arm to dock.)
      if (e.target.closest('[data-skin-menu]')) {
        // Through the SAME release as paint()/destroy(), so the pointer is nulled by
        // the engine rather than depending on the view remembering to clear it (the
        // seat's m9: deleting music's setWheelTakeover(null) left a stale pointer and
        // a dead wheel). One owner for one invariant.
        if (wheelTakeover) { releaseWheelTakeover(); return; }
        if (panel.classList.contains('mms-listmode')) { setListMode(false); }
        else if (pocket && pocket.onMenu()) { /* pocket menus: climbed one menu level */ }
        else { onDock(); }
        return;
      }
      if (e.target.closest('[data-skin-select]')) {
        if (wheelTakeover) { // v1.270: the takeover's action button
          if (typeof wheelTakeover.onSelect === 'function') { try { wheelTakeover.onSelect(); } catch (_) { /* best effort */ } }
          return;
        }
        if (panel.classList.contains('mms-listmode')) {
          var cur = panel.querySelector('.ip-listview .mms-row.is-cursor');
          var cgi = cur && parseInt(cur.getAttribute('data-skin-go'), 10);
          setListMode(false);
          if (cur && !isNaN(cgi)) onSelectIndex(cgi);
        } else if (pocket && pocket.onSelect()) { /* pocket menus: the menu selected / drilled in */ }
        else { setListMode(true); }
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
    // NEVER write .checked from JS (kills tracking). Exec plan: 2026-09-03-wheel-haptics.md.
    var WHEEL_CFG = (typeof window !== 'undefined' && window.FileTubeWheelConfig) || null; // v1.303: the wheel's source of truth (the Click wheel test writes it; read fresh per gesture below)
    var HAPTIC_STEP_DEG = (WHEEL_CFG && WHEEL_CFG.CONST.STEP_DEFAULT) || 3.75; // v1.256.2 (Dean: 3deg "a little too hot... parity with the iPod Classic"): 96 detents/rev, the Classic's own number
    // v1.271 (Dean: "I want there to be more haptic feedback than not... it really
    // should feel like the real thing"). Was 30, which pegged delivery at a FLAT ~30
    // ticks/second no matter how fast the wheel turned - 69% of the ticks a 1 rev/s
    // spin demands were discarded, so ours was a constant buzz where a real Classic's
    // rate rises with your hand. 8ms sits below the 8.33ms ProMotion frame interval,
    // so it can never bind before the mechanism's own hard ceiling (one tick per
    // pointermove, because WebKit re-evaluates the switch's midline crossing per
    // touchmove) - i.e. it is functionally 0 while keeping a named, non-zero bound.
    // Yield vs 30ms: ~2x at 60Hz, up to 4x on ProMotion, at the SAME 3.75 spacing.
    //
    // The old comment called 30 "the Taptic engine's saturation floor" and the exec
    // plan filed it under "CONSTANTS (WebKit source)" - the investigation could find
    // NO evidence of any such rate limit in WebKit's pointer-tracking path or in
    // UIImpactFeedbackGenerator. It was our own guess, recorded as if it were sourced.
    // What IS evidenced: Dean device-confirmed the engine DROPS rather than queues
    // (ticks stop dead when his finger does), which is what makes lowering it safe -
    // a queueing engine would buzz on after the stop.
    var HAPTIC_MIN_MS = (WHEEL_CFG && WHEEL_CFG.CONST.MIN_MS) || 8;
    var HAPTIC_BIAS = (WHEEL_CFG && WHEEL_CFG.CONST.BIAS_DEFAULT) || 18; // v1.303: default ghost/sweep amplitude (px); the live dither per gesture comes from the config
    var DEAD_FRAC = (WHEEL_CFG && WHEEL_CFG.CONST.DEAD_FRAC) || 0.20; // v1.303: centre (Select) dead-zone, sourced from the shared module (was a magic 0.2)
    // v1.303: the live wheel config, read FRESH per gesture (device-local; the Click wheel
    // test is the source of truth) - a fresh read so a config saved AFTER this engine mounted
    // is honoured on the next spin, no re-create needed. Absent module or config -> today's
    // EXACT feel (Ghost / Fine-96 3.75deg / capture-after-8px / buzz on): an unset wheel is a no-op.
    function readWheelCfg() {
      var WC = (typeof window !== 'undefined' && window.FileTubeWheelConfig) || null;
      if (!WC) return { engine: 'ghost', detentDeg: HAPTIC_STEP_DEG, dither: HAPTIC_BIAS, capture: '8px', buzz: true };
      var c = WC.read();
      return { engine: WC.effectiveEngine(c), detentDeg: c.detent, dither: c.dither, capture: c.capture, buzz: c.buzz };
    }
    var wheelGhost = null;
    // v1.311.2: the body lock is the SHARED owner-keyed one (body-scroll-lock.js) -
    // this surface is one owner among the player's immersive views, so a skin
    // inside the expanded audio view never clobbers its saved scroll. Truthy while
    // this surface holds it.
    var bodyScrollLock = null;
    var bodyLockOwner = 'skin-ghost:' + (++skinLockSeq);
    var wheelTakeover = null; // v1.270: see the dispatches in MENU, Select and the move handler
    function hapticCapable() {
      try {
        var probe = doc.createElement('input');
        return ('switch' in probe) && ('ontouchstart' in win);
      } catch (_) { return false; }
    }
    // The arming cover scales to the WHEEL IT COVERS (slim W1, v1.261): a fixed 7.5
    // spilled over the (since removed) Zune pad's scrub bar - a routed seek click carries clientX=0,
    // so covered taps sought 0:00.
    //
    // v1.267 (Dean, device-confirmed): the 7.5 CAP is gone. The 52x32 ghost scaled
    // by 7.5 is 240px tall, but the iPod wheel is ~273px on a 390px phone - so a
    // ~16px strip along the TOP and BOTTOM of the wheel never armed the haptics.
    // The v1.256 adversarial seat RECORDED this exact residual (see
    // docs/exec-plans/active/2026-09-03-wheel-haptics.md) and left it for Dean; he
    // arbitrated it: "it's when it's near the top edge it feels bad."
    // Scaling to h/32 makes the cover exactly the wheel's height, so the WHOLE
    // wheel arms and the cover cannot extend above it into the LCD - which is the
    // job the cap was accidentally doing (v1.261 W1: a routed seek click carries
    // clientX=0 and sought 0:00).
    //
    // The h===0 fallback is the ONE case where cover height != wheel height, so
    // the "cover cannot reach the LCD" property is derived-not-absolute (slim W2).
    // It is the right trade - a collapsed cover would arm nothing at all - and it
    // is not reachable in production (the panel is position:fixed inset:0 and
    // un-hidden before mountWheelGhost runs; the only display:none wheel is the
    // desktop tray, which fails hapticCapable anyway). Bound as an explicit
    // exception in the invariant test rather than left as an unstated hole.
    function ghostRestTransform(wheel) {
      var h = 0;
      try { h = wheel ? wheel.getBoundingClientRect().height : 0; } catch (_) { /* fall back */ }
      return 'scale(' + (h > 0 ? h / 32 : 7.5) + ')';
    }
    function lockBodyScroll() {
      if (bodyScrollLock) return;
      var BL = sharedBodyLock();
      if (BL && BL.lock(doc, win, bodyLockOwner)) bodyScrollLock = BL;
    }
    function unlockBodyScroll() {
      if (!bodyScrollLock) return;
      var BL = bodyScrollLock; bodyScrollLock = null;
      BL.release(doc, win, bodyLockOwner);
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
      g.style.transform = ghostRestTransform(wheel);
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
    // v1.311.3 (Dean: rotating in music mode locked ALL scrolling). The full-screen skin is
    // `position:fixed` only inside the `max-width:768px` block, so a rotate to landscape
    // (~844px) turns the cover back into an in-page panel WITHOUT removing the ghost - the
    // observer above never fires, and the body stayed pinned under a page that could no
    // longer be covered. A viewport change re-asks the real question: does the panel still
    // cover the page? If not, the lock (and the ghost that needs it) go. The view's own
    // watchSkinViewport hook then re-renders; a rotate back re-paints and re-locks.
    // Viewport-only on purpose: nothing else un-fixes the panel while its ghost stays
    // attached (every view reset clears innerHTML, which the observer catches), and a
    // computed-style read per timeupdate would cost a style recalc 4x a second.
    function panelCovers() {
      try { return win.getComputedStyle(panel).position === 'fixed'; } catch (_) { return true; }
    }
    function onViewportChange() {
      if (panelCovers()) { healGhostLock(); return; }
      // v1.311.3 gate r1 W1 (adversary, measured): a rotate DURING a wheel scrub left a
      // deferred repaint queued (paint() defers while a spin can reach endWheel); the
      // finger's pointerup flushed it, re-drew the full skin over the desktop panel and
      // re-locked the body. Drop the deferred paint FIRST (endWheel flushes paintPending),
      // then end the spin, then release. Before the ghost heal, not after: the view's
      // re-render has usually detached the ghost already, and the heal would release and
      // leave the deferred paint armed.
      paintPending = false;
      if (wheelSpin) { try { endWheel(wheelSpin, false); } catch (_) { /* the node is already gone */ } }
      // A real resize runs a microtask checkpoint between listeners, so the ghost
      // observer may already have released the lock after the view's re-render.
      if (!bodyScrollLock) return;
      unlockBodyScroll();
      unwatchGhost();
      if (wheelGhost) { try { wheelGhost.remove(); } catch (_) { /* already gone */ } }
      wheelGhost = null;
      panel.classList.remove('mms-haptic');
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
      if (st.buzz === false) return; // v1.303: buzz OFF -> no haptic ghost tracking (rotation still scrubs/cursors)
      if (st.engine === 'sweep') { hapticPlaceSweep(st, e.clientX, e.clientY); return; } // v1.303: the tracked-switch sweep engine
      hapticPlaceGhost(st, e.clientX, e.clientY, false);
    }
    function hapticPlaceGhost(st, x, y, flip) {
      if (!wheelGhost || !wheelGhost.isConnected) return;
      var r = st.wheel.getBoundingClientRect();
      if (flip) st.hapBias = -st.hapBias;
      // unscaled under the finger, biased past the track midline (the probe-C math); the
      // bias amplitude is the config's Dither (default HAPTIC_BIAS = 18) - v1.303.
      var tx = (x - (r.left + r.width / 2)) + st.hapBias * (st.dither || HAPTIC_BIAS);
      var ty = y - (r.top + r.height / 2);
      wheelGhost.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
    }
    // v1.303: the SWEEP engine on the real wheel - the single tracked switch moved
    // smoothly under the finger, its midline carried past once per detent by a sine
    // (WHEEL_CFG.sweepOffset - the SAME feel math the Click wheel test's placeSweep uses,
    // so the tuned combo feels identical here). No bias flip; the switch genuinely sweeps.
    function hapticPlaceSweep(st, x, y) {
      if (!wheelGhost || !wheelGhost.isConnected) return;
      var r = st.wheel.getBoundingClientRect();
      var WC = (typeof window !== 'undefined' && window.FileTubeWheelConfig) || null;
      var off = WC
        ? WC.sweepOffset(st.sweepAngle, st.dither, st.detentDeg)
        : (st.dither * Math.sin((st.sweepAngle / (st.detentDeg || HAPTIC_STEP_DEG)) * Math.PI));
      var tx = (x - (r.left + r.width / 2)) + off;
      var ty = y - (r.top + r.height / 2);
      wheelGhost.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
    }
    function hapticOnMove(st, e, absD, signedD, lettered) {
      if (!wheelGhost || !wheelGhost.isConnected) return;
      if (st.buzz === false) return; // v1.303: buzz off -> no haptic
      // quick scroll: in LETTER mode the ghost/switch only rides under the finger - the tick is
      // one per letter crossed (hapticLetterTick, after the step), never one per 3.75 degrees.
      if (lettered) {
        if (st.engine === 'sweep') hapticPlaceSweep(st, e.clientX, e.clientY);
        else hapticPlaceGhost(st, e.clientX, e.clientY, false);
        return;
      }
      if (st.engine === 'sweep') {
        // signed accumulation: the switch sweeps WITH the finger (reverses when it reverses).
        st.sweepAngle += (typeof signedD === 'number' ? signedD : absD);
        hapticPlaceSweep(st, e.clientX, e.clientY);
        return;
      }
      st.hapAccum += absD;
      var flip = false;
      var step = st.detentDeg || HAPTIC_STEP_DEG; // v1.303: the config's Detent (default 3.75)
      while (st.hapAccum >= step) {
        st.hapAccum -= step;
        var now = nowMs();
        if (now - st.hapLast >= HAPTIC_MIN_MS) { flip = true; st.hapLast = now; } // throttle: drop, never queue
      }
      hapticPlaceGhost(st, e.clientX, e.clientY, flip);
    }
    // Quick scroll: ONE tick per letter the detent crossed. Ghost: one bias flip (the same 8 ms
    // floor drops, never queues). Sweep: the switch's phase moves to the middle of the next
    // half-period of the SHARED sweepOffset sine, so its midline is crossed exactly once.
    function hapticLetterTick(st, e) {
      if (!wheelGhost || !wheelGhost.isConnected || st.buzz === false) return;
      if (st.engine === 'sweep') {
        var det = st.detentDeg || HAPTIC_STEP_DEG;
        st.sweepAngle = (Math.floor(st.sweepAngle / det) + 1.5) * det;
        hapticPlaceSweep(st, e.clientX, e.clientY);
        return;
      }
      var now = nowMs();
      var flip = now - st.hapLast >= HAPTIC_MIN_MS;
      if (flip) st.hapLast = now;
      hapticPlaceGhost(st, e.clientX, e.clientY, flip);
    }
    function hapticGestureEnd() {
      if (wheelGhost && wheelGhost.isConnected) wheelGhost.style.transform = ghostRestTransform(wheelGhost.parentElement);
      healGhostLock();
    }

    // ---- the click-wheel gesture: rotate = cursor (list) OR scrub (now playing) ----
    function endWheel(st, suppress) {
      if (st.ended) return; // v1.271: two end arms, one teardown (see st.onDocUp)
      st.ended = true;
      var w = st.wheel;
      // v1.242: tear down any fast-scan hold-timer / interval on EVERY end arm (the v1.163
      // dual-arm teardown discipline) so a pointerup OR pointercancel stops the scan clean.
      if (st.scanTimer) { try { st.win.clearTimeout(st.scanTimer); } catch (_) { /* ignore */ } st.scanTimer = null; }
      if (st.scanInterval) { try { st.win.clearInterval(st.scanInterval); } catch (_) { /* ignore */ } st.scanInterval = null; }
      if (st.homeTimer) { try { st.win.clearTimeout(st.homeTimer); } catch (_) { /* ignore */ } st.homeTimer = null; } // D7: every end arm drops the hold
      try { if (st.captured) w.releasePointerCapture(st.id); } catch (_) { /* not captured */ }
      w.removeEventListener('pointermove', st.onMove);
      w.removeEventListener('pointerup', st.onUp);
      w.removeEventListener('pointercancel', st.onUp);
      if (st.onDocUp) {
        try {
          doc.removeEventListener('pointerup', st.onDocUp);
          doc.removeEventListener('pointercancel', st.onDocUp);
        } catch (_) { /* ignore */ }
      }
      if (suppress) wheelSuppressClick = true;
      if (wheelSpin === st) wheelSpin = null;
      hapticGestureEnd(); // v1.256: ghost back to its arming cover, lock self-heal check
      // v1.271: FLUSH a repaint deferred during this gesture. Last, so wheelSpin is
      // already null (paint() would otherwise re-defer forever) and the haptic teardown
      // has settled before the panel is replaced.
      // v1.311.3 gate r1 W1: only into a panel that is still the SKIN. Every view
      // un-render (a dock, a rotate to the desktop panel) resets the panel's classes; a
      // flush after that re-drew the full skin over what the view put there (un-hiding a
      // docked panel, re-locking the body in landscape).
      if (paintPending) {
        if (panel.classList.contains('mms-full')) paint();
        else paintPending = false;
      }
    }
    function onDown(e) {
      wheelSuppressClick = false;
      // v1.256.1 slim-gate CRITICAL: the stash must refresh on EVERY ghost press, BEFORE
      // any early return - written below the dead-center guard, a CENTER tap kept the
      // LAST ZONE'S stash and the lying click replayed that zone instead of Select.
      if (wheelGhost && e.target === wheelGhost) ghostDownPoint = { x: e.clientX, y: e.clientY };
      if (wheelSpin) return; // one gesture at a time
      var listMode = panel.classList.contains('mms-listmode');
      var menuMode = !!(pocket && pocket.isMenuMode()); // pocket menus: a menu level is a cursor list too
      var wheel = e.target.closest('.ip-wheel'); if (!wheel) return;
      var r = wheel.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // ignore a press on the dead center (the Select button): let its tap pass through.
      if (Math.hypot(e.clientX - cx, e.clientY - cy) < r.width * DEAD_FRAC) return;
      var st = {
        wheel: wheel, id: e.pointerId, captured: false, moved: false,
        // Now Playing is never idle: the wheel SCRUBS the timeline on EVERY surface
        // (Dean 2026-09-02 - the pop-out's old wheel-volume gave way to a consistent scrub).
        mode: (listMode || menuMode) ? 'cursor' : 'scrub', scrubRatio: null, menu: menuMode,
        lastAngle: Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI,
        lastT: nowMs(), lastEvT: evTime(e), accum: 0, x0: e.clientX, y0: e.clientY, onMove: null, onUp: null,
        win: win, scanTimer: null, scanInterval: null, scanning: false, scanDir: 0, homeTimer: null,
        onDocUp: null, ended: false,
      };
      // v1.303: read the wheel config ONCE for THIS gesture (engine/detent/dither/capture/buzz),
      // set on st so onMove + the haptic path honour it. Works even without a ghost (non-haptic
      // devices still need st.capture for the pointer-capture branch below).
      var wcfg = readWheelCfg();
      st.engine = wcfg.engine; st.detentDeg = wcfg.detentDeg; st.dither = wcfg.dither;
      st.capture = wcfg.capture; st.buzz = wcfg.buzz; st.sweepAngle = 0;
      // capture:'press' grabs the pointer immediately (the test's "On press"); '8px' waits for a
      // real rotation (below); 'off' never grabs. Default '8px' == today's behaviour.
      if (st.capture === 'press') { try { st.wheel.setPointerCapture(st.id); st.captured = true; } catch (_) { /* best effort */ } }
      // v1.242 fastScan: HOLD the rewind/ffwd zone to FAST-SCAN the timeline (~2x, audio keeps
      // playing); release resumes where it landed. Independent of st.mode - keyed off the
      // pressed ZONE. A quick TAP still skips a track (the hold never fires); a ROTATE becomes
      // a scrub/cursor (cancels the hold-timer). Steps currentTime on the PANEL's own window
      // timer so a Document-PiP pop-out (which throttles the opener) still scans.
      hapticGestureStart(st, e); // v1.256: ghost rides under the finger from the first move
      if (menuMode && pocket) pocket.onGestureStart(); // quick scroll: the fast-move count is per gesture (gate r1 Q1)
      if (fastScan) {
        // v1.256: the scaled ghost covers the zones - route the press to the REAL control.
        var downTgt = realTargetUnder(e);
        st.scanDir = (downTgt.closest && downTgt.closest('[data-skin-next]')) ? 1 : ((downTgt.closest && downTgt.closest('[data-skin-prev]')) ? -1 : 0);
        var startScan = function () {
          var mp0 = hostCtl('media-player');
          var d0 = (mp0 && isFinite(mp0.duration) && mp0.duration > 0) ? mp0.duration : 0;
          if (!d0) return; // nothing to scan (still loading) - leave it a plain tap/skip
          st.scanning = true; st.moved = true; // moved => the release's skip click is suppressed
          // v1.303: fast-scan (a HOLD on rewind/ffwd) ALWAYS captures, independent of st.capture -
          // the capture config governs the ROTATION grab; a hold-scan structurally needs the
          // pointer to keep stepping if the finger drifts off the zone. endWheel still releases it.
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
      // D7: press-and-HOLD MENU goes home - the hold-to-scan's own machinery (this ONE pointerdown,
      // a timer on the panel's window, cancelled by the 8px rotation below and by every end arm in
      // endWheel). On fire the gesture ENDS first with the click-suppress flag, so the release's
      // MENU click never also climbs or docks, and every listener the press added is released. A
      // takeover (Brick) owns MENU, so no hold arms under it; an un-rendered panel (a dock from
      // elsewhere mid-hold) never goes home.
      if (homeAvailable() && !wheelTakeover) {
        var homeTgt = realTargetUnder(e);
        if (homeTgt && homeTgt.closest && homeTgt.closest('[data-skin-menu]')) {
          st.homeTimer = st.win.setTimeout(function () {
            st.homeTimer = null;
            if (st.ended || st.moved || wheelSpin !== st || wheelTakeover) return;
            if (!st.wheel.isConnected || !panel.classList.contains('mms-full')) { endWheel(st, false); return; }
            hapticLetterTick(st, { clientX: st.x0, clientY: st.y0 }); // the wheel's own tick, where it ticks
            endWheel(st, true);
            goHome();
          }, HOME_HOLD_MS);
        }
      }
      st.onMove = function (ev) {
        if (ev.pointerId !== st.id) return; // ignore a SECOND finger (jump guard)
        // v1.242 (gate WARNING): once a HOLD has engaged the fast-scan, the scan OWNS the
        // gesture until release - a subsequent rotation must NOT also scrub (else the scan
        // interval and the scrub branch fight over currentTime AND both commit on release).
        if (st.scanning) return;
        var ang = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
        var d = wheelShortAngle(ang - st.lastAngle); st.lastAngle = ang;
        var now = nowMs(); var evNow = evTime(ev);
        var dt = Math.max(1, now - st.lastT, (evNow && st.lastEvT) ? evNow - st.lastEvT : 0);
        st.lastT = now; st.lastEvT = evNow;
        st.accum += d;
        var lettered = !!(st.menu && pocket && !wheelTakeover && pocket.inLetterMode());
        hapticOnMove(st, ev, Math.abs(d), d, lettered); // v1.256: ticks in BOTH modes (cursor + scrub); v1.303 signed d for the sweep engine; quick scroll: per letter in letter mode
        // v1.270: ONE generic WHEEL TAKEOVER, deliberately not game-aware. While set it
        // consumes rotation (the haptic above already fired, which is the point - a
        // takeover gets the wheel AND its ticks for free), and MENU/Select route to it
        // below. The Brick easter egg is the only caller today; the engine never
        // learns what it is talking to.
        if (wheelTakeover && typeof wheelTakeover.onRotate === 'function') {
          st.moved = true;
          try { wheelTakeover.onRotate(d); } catch (_) { /* a takeover must never break the wheel */ }
          return;
        }
        if (!st.moved && Math.hypot(ev.clientX - st.x0, ev.clientY - st.y0) > 8) {
          st.moved = true;
          // a ROTATE is a scrub/cursor, not a scan: cancel the pending hold so it never scans.
          if (st.scanTimer) { try { st.win.clearTimeout(st.scanTimer); } catch (_) { /* ignore */ } st.scanTimer = null; }
          if (st.homeTimer) { try { st.win.clearTimeout(st.homeTimer); } catch (_) { /* ignore */ } st.homeTimer = null; } // D7: moved off - a spin, not a hold
          // v1.303: capture mode. '8px' (default == today) grabs the pointer HERE, once a real
          // rotation is confirmed; 'press' already grabbed on down; 'off' never grabs.
          if (st.capture !== 'press' && st.capture !== 'off') { try { st.wheel.setPointerCapture(st.id); st.captured = true; } catch (_) { /* best effort */ } }
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
        var mult = cursorStepMult(speed);
        if (st.menu && pocket) pocket.noteMove(mult >= LETTER_FAST_MULT); // the letter mode's per-move speed memory
        var letters = 0;
        while (Math.abs(st.accum) >= WHEEL_STEP_DEG) {
          var sign = st.accum > 0 ? 1 : -1;
          st.moved = true;
          // pocket menus: the SAME rotary step, onto the menu (letter mode was armed per MOVE by
          // noteMove above; the return = letters crossed, one at most per move)
          if (st.menu && pocket) letters += (pocket.moveCursor(sign * mult) || 0);
          else setWheelCursor(wheelCursorRow + sign * mult, false);
          st.accum -= sign * WHEEL_STEP_DEG;
        }
        // one tick per letter: the OS reads one midline crossing per pointermove at most, so two
        // letters crossed inside ONE move tick once (a second flip would cancel the first).
        if (letters > 0) hapticLetterTick(st, ev);
      };
      st.onUp = function (ev) {
        // v1.271 (gate round 2): the gesture now has TWO end arms (wheel + document), and
        // everything below COMMITS a seek - so a second pass would dispatch `change` twice.
        // MEASURED: it does not happen today. A release on the wheel runs this arm first,
        // and the endWheel below removes the document listeners before the event finishes
        // bubbling, which per the DOM rule on removal-during-dispatch means the doc arm is
        // never invoked (deleting this line leaves the whole file green, including the
        // "release commits via #seek-bar ... exactly once" test). It stays as a cheap
        // backstop for that ordering being disturbed - reordering endWheel's teardown below
        // the commit would otherwise silently double-seek. Read-only here on purpose:
        // endWheel is the SETTER, or the call at the end of this function would no-op.
        if (st.ended) return;
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
      // v1.271 (gate round 2): a DOCUMENT-level second end arm - the v1.163 dual-arm
      // teardown discipline. Pointer capture is only taken after 8px of travel (or on a
      // fast-scan start), and a MOUSE gets no implicit capture at pointerdown the way a
      // touch does. So a mouse press near the wheel's edge whose first move already leaves
      // the wheel releases on some OTHER element, and the wheel-only listeners never fire:
      // the spin stayed live on a still-CONNECTED wheel, which the isConnected defer above
      // reads as "a gesture that can still reach endWheel" - freezing every future paint().
      // Measured by the adversarial seat on the desktop pop-out, which renders a real wheel.
      // Filtered by pointerId so this arm ends only ITS OWN gesture; the wheel arm above
      // stays unfiltered, preserving today's "a second finger's up on the wheel ends it".
      st.onDocUp = function (ev) {
        if (ev && ev.pointerId !== undefined && ev.pointerId !== st.id) return;
        st.onUp(ev);
      };
      wheel.addEventListener('pointermove', st.onMove);
      wheel.addEventListener('pointerup', st.onUp);
      wheel.addEventListener('pointercancel', st.onUp);
      try {
        doc.addEventListener('pointerup', st.onDocUp);
        doc.addEventListener('pointercancel', st.onDocUp);
      } catch (_) { /* no document events (a detached fixture) */ }
      wheelSpin = st;
    }
    function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

    function destroy() {
      releaseWheelTakeover(); // v1.270: the surface dying takes its takeover with it
      paintPending = false;   // v1.271: a deferred repaint must not outlive the surface
      if (bound) {
        panel.removeEventListener('click', onClick);
        panel.removeEventListener('pointerdown', onDown);
        if (pocket) {
          panel.removeEventListener('scroll', onMenuScroll, true);
          try { doc.removeEventListener('visibilitychange', onDocVisibility); } catch (_) { /* ignore */ }
        }
        try {
          win.removeEventListener('resize', onViewportChange);
          win.removeEventListener('orientationchange', onViewportChange);
        } catch (_) { /* a detached fixture window */ }
      }
      if (wheelSpin) { try { endWheel(wheelSpin, false); } catch (_) { /* ignore */ } }
      extrasMenu.destroy();   // stop the reheat poll + invalidate a late extras fetch (shared factory)
      if (pocket) pocket.destroy(); // pocket menus: drop the art timer + invalidate a late menu load
      if (lighting) lighting.destroy(); // pocket lighting: unbind the sensor / pointer / visibility listeners, cancel the frame loop
      unlockBodyScroll();     // v1.256: the haptic body lock dies with the surface
      unwatchGhost();
      wheelGhost = null;
      bound = false;
      // clear the full-screen body class this view may have set (the v1.227 leak lesson - a
      // podcasts<->music swap must never strand the frozen-scroll cover).
      try { doc.body.classList.remove('mms-on'); } catch (_) { /* ignore */ }
    }

    return {
      paint: paint, reflect: reflect, setListMode: setListMode, destroy: destroy,
      isListMode: function () { return panel.classList.contains('mms-listmode'); },
      // pocket menus: the pocket menu's live state (null when the view supplies no menus).
      menuState: function () { return pocket ? pocket.state() : null; },
      // pocket lighting: the driver's live state (null when pocket-lighting.js is not loaded).
      lightingState: function () { return lighting ? lighting.state() : null; },
      // v1.270: set (or clear, with null) the single wheel takeover -
      // {onRotate, onSelect, onExit}, all optional. Generic on purpose: the engine
      // never learns what is listening. The caller owns its own teardown.
      setWheelTakeover: function (t) { wheelTakeover = (t && typeof t === 'object') ? t : null; if (pocket) pocket.onTakeover(); },
      // v1.270: the fallback MUST stay `|| null`, never `|| panel` - the geometry lock
      // derives its mount target from this selector, so a panel fallback would restore
      // the full-screen overlay at runtime while the test still measured the LCD (slim I).
      lcdHost: function () { return panel.querySelector('.ip-lcd-in') || null; },
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
  // subline, subArtist? }; each row = { id, artUrl, title, artist, index, state, durLabel? } - the view precomputes
  // its own subline/artUrl (music: artist·album + /albumart; podcasts: show·meta +
  // /podcastart). Escaped here - podcast titles/notes are FEED PROSE. Row taps are the
  // VIEW's delegated .mnp-queue-row listener (data-index), exactly music's contract.
  function panelEscape(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  // v1.317 (M1+M2), both OPTIONAL so podcasts' panel stays BYTE-IDENTICAL: `np.subArtist` (a
  // non-empty string) renders the sub-line as a `data-artist` button the view's delegated
  // click acts on (music: the artist drill, or the channel grid for a listen video; podcasts
  // pass nothing = the plain div), titled `np.subArtistTitle` when given (music's "Go to
  // channel"), else "Go to artist"; a row's `durLabel` (a non-empty string) renders
  // `.mnp-queue-dur` after the title block - a chaptered album's row shows that chapter's own
  // length; '' = no span.
  function buildPanelHtml(np, rows) {
    np = np || {};
    var subArtist = (typeof np.subArtist === 'string') ? np.subArtist : '';
    var sub = '';
    if (np.subline) {
      sub = subArtist
        ? '<button type="button" class="mnp-sub" data-artist="' + panelEscape(subArtist) + '" title="' + panelEscape((typeof np.subArtistTitle === 'string' && np.subArtistTitle) ? np.subArtistTitle : 'Go to artist') + '">' + panelEscape(np.subline) + '</button>'
        : '<div class="mnp-sub">' + panelEscape(np.subline) + '</div>';
    }
    var meta = '<div class="mnp-meta">' +
      '<div class="mnp-title" title="' + panelEscape(np.title) + '">' + panelEscape(np.title || 'Unknown track') + '</div>' +
      sub +
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
            '</span>' +
            (typeof it.durLabel === 'string' && it.durLabel ? '<span class="mnp-queue-dur">' + panelEscape(it.durLabel) + '</span>' : '') +
            '</button>';
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
          // v1.260: the tray is the Click Nano - its colorways are the registry's Click
          // colorways (v1.332: derived, never a hand-kept trio).
          var reg = (typeof window !== 'undefined' && window.FileTubeMusicSkins) || null;
          if (reg && typeof reg.isClickColorway === 'function' && reg.isClickColorway(id)) return id;
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

  // v1.311.3 (Dean: a rotate in music mode locked all scrolling): call `onCross(narrow)`
  // whenever the viewport crosses the mobile skin gate (music-skins.js isMobileViewport,
  // max-width 768px), so the VIEW re-runs its panel update - the skin un-renders on a
  // rotate to landscape and paints (and re-locks) again on the way back. Before this,
  // nothing re-checked the gate after the first paint. ONE helper both views (music,
  // podcasts) route through - never a hand copy. Listens to resize AND orientationchange
  // (iOS can report the orientation before the new width), deduped by the tracked state.
  function watchSkinViewport(win, onCross, signal) {
    if (!win || typeof win.addEventListener !== 'function' || typeof onCross !== 'function') return false;
    var SKINS = (typeof window !== 'undefined' && window.FileTubeMusicSkins) || null;
    function narrowNow() {
      try { return !!(SKINS && typeof SKINS.isMobileViewport === 'function' && SKINS.isMobileViewport()); } catch (_) { return false; }
    }
    var last = narrowNow();
    function check() {
      var now = narrowNow();
      if (now === last) return;
      last = now;
      onCross(now);
    }
    var opts = signal ? { signal: signal } : undefined;
    win.addEventListener('resize', check, opts);
    win.addEventListener('orientationchange', check, opts);
    return true;
  }

  var api = { create: create, buildPanelHtml: buildPanelHtml, createPopoutShell: createPopoutShell, createExtrasMenu: createExtrasMenu, watchSkinViewport: watchSkinViewport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FileTubeSkinSurface = api;
})();
