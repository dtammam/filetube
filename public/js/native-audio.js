'use strict';
// v1.397.0 native audio (plan docs/exec-plans/completed/2026-10-28-native-audio.md): the web half of the `nativeAudio`
// capability (docs/references/native-bridge.md). Loaded on every signed-in shell right after offline.js.
//
// With a host that announces `nativeAudio` (the iOS app), MUSIC (native tracks, library audio, chapter rows) and PODCASTS
// play through the app's own engine: at the player.load choke point (player.js setupForMedia) a load whose caller supplies
// the whole queue (`data.nativeQueue()`: music.js and podcasts.js) is CLAIMED here - nothing is set on the shared media
// element, `audio.load` goes out with every Item, and the element becomes a PROXY of native's state: this module installs
// own-property accessors on the `#media-player` INSTANCE (currentTime, duration, paused, ended, playbackRate, play, pause,
// ...) and dispatches the element's own events (play, pause, timeupdate, durationchange, ...) from native's snapshots, so
// every reader and listener in player.js, music.js, podcasts.js, skin-surface.js and remote.js works unchanged while two
// audio stacks never both play. A load this module does NOT claim (a video, the Feed, the reader, a watch-page item) stops
// native first (`audio.stop`) and takes the web element back (the accessors are removed).
//
// Native owns playback (the engine, the audio session, the lock screen, the queue it was sent, its radio appends, the
// progress and play posts); the web sends intents and renders snapshots. The web owns queue ORDER, shuffle included (D17):
// a queue edit or a mode change re-sends `audio.load` with rev + 1 at the CURRENT index and the position of the latest
// tick. A snapshot whose rev is older than the last load is dropped. One `audio.subscribe` per page, released on pagehide
// and re-sent on a persisted pageshow (the offline.js model).
//
// With no host, or a host without `nativeAudio` (older app builds, browsers, the PWA), `enabled` is false and every call is
// an inert no-op: the browser's audio path is byte-identical (D10).
(function (root) {
  var FILE_ROUTE = '/api/offline/file/';
  var RATE_MIN = 0.5, RATE_MAX = 3;
  var PROXY_PROPS = ['currentTime', 'duration', 'paused', 'ended', 'playbackRate', 'defaultPlaybackRate', 'readyState', 'buffered', 'seeking', 'play', 'pause', 'videoWidth', 'videoHeight'];
  var DEFAULT_MODES = { autoplay: true, shuffle: false, loop: 'off' };
  var ERROR_COPY = {
    network: 'No connection right now',
    notPlayable: 'This file cannot play on this phone',
    revoked: 'This device was removed in Settings',
    notOnServer: 'Not on the server yet',
    other: 'Could not play this',
  };

  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function sameItem(a, b) {
    if (!a || !b) return false;
    if (a.kind !== b.kind || a.id !== b.id) return false;
    var ca = a.clip, cb = b.clip;
    if (!ca && !cb) return true;
    return !!(ca && cb && num(ca.startSec, -1) === num(cb.startSec, -2) && num(ca.endSec, -1) === num(cb.endSec, -2));
  }
  function sameQueue(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) { if (!sameItem(a[i], b[i])) return false; }
    return true;
  }
  // The FILE duration a clip Item belongs to: the largest clip end among the queue's Items sharing its src (the last chapter
  // ends at the file end); a plain Item's own duration.
  function fileDurationOf(item, queue, snapDur) {
    if (!item) return NaN;
    if (!item.clip) { var d = snapDur > 0 ? snapDur : num(item.durationSec, 0); return d > 0 ? d : NaN; }
    var max = num(item.clip.endSec, 0);
    for (var i = 0; i < queue.length; i++) {
      var it = queue[i];
      if (it && it.clip && it.src === item.src) max = Math.max(max, num(it.clip.endSec, 0));
    }
    return max > 0 ? max : NaN;
  }
  var PROGRESS_ROUTES = ['/api/music/progress', '/api/progress', '/api/podcasts/progress', '/api/tv/progress'];
  // A player.load DESCRIPTOR (the `data` music.js / podcasts.js build per row: type, title, channelName, album, duration,
  // artUrl, streamSrc, progressEndpoint, resumeMode, chapterStartSec, baseMediaId, subId, radioSeed, listen, hasThumbnail) -> a
  // contract Item, or null when it is not a music / podcast load. The views hand the SAME builder's output to the queue provider,
  // so the load and its queue cannot drift. src is always the iOS-playable file route of the FILE (a chapter row's parent);
  // artworkSrc is one of the media-token art routes (a library track's /thumbnail art is served by /albumart too).
  // v1.398.0 (plan docs/exec-plans/completed/2026-10-28-native-video-audio.md, V2b + V4 + S2 + S6): with `opts.video` (the host
  // announces `nativeVideoAudio`) a Listen row - a VIDEO played as audio from the watch page (`listen: true`), one row per chapter
  // for a chaptered video - is a `video` Item: the whole file's iOS-playable rendition at /api/offline/file/video/<file>, its
  // /thumbnail art (omitted when the video has none), progress at /api/progress under the file id, a chapter row as the file plus
  // `clip` (the D6 semantics), never a radioSeed. Without `opts.video` a Listen row is null, as in v1.397.0 (the audio file
  // route cannot serve a video's id, gate r1 qa C1), and the whole load stays on the web element.
  function itemFromDescriptor(d, opts) {
    if (!d || typeof d !== 'object' || d.type !== 'audio') return null;
    var id = d.id != null ? String(d.id) : '';
    if (!id) return null;
    var listen = d.listen === true;
    if (listen && !(opts && opts.video === true)) return null;
    var podcast = d.resumeMode === 'podcast';
    if (!podcast && d.resumeMode !== 'music') return null;
    var kind = listen ? 'video' : (podcast ? 'podcastEpisode' : 'track');
    var base = (typeof d.baseMediaId === 'string' && d.baseMediaId) ? d.baseMediaId : id.replace(/::c\d+$/, '');
    var item = { kind: kind, id: id, src: FILE_ROUTE + kind + '/' + encodeURIComponent(base), title: typeof d.title === 'string' ? d.title : '' };
    var artist = typeof d.channelName === 'string' ? d.channelName : '';
    var album = typeof d.album === 'string' ? d.album : '';
    if (artist) item.artist = artist;
    if (album) item.album = album;
    var art = typeof d.artUrl === 'string' ? d.artUrl : '';
    if (listen) { if (d.hasThumbnail !== false) item.artworkSrc = '/thumbnail/' + encodeURIComponent(base); }
    else if (/^\/(albumart|podcastart)\//.test(art)) item.artworkSrc = art;
    else if (podcast && typeof d.subId === 'string' && d.subId) item.artworkSrc = '/podcastart/' + encodeURIComponent(d.subId);
    else if (!podcast) item.artworkSrc = '/albumart/' + encodeURIComponent(base);
    var dur = num(d.duration, 0);
    // gate r1 (adversary A-S1 = qa W5): a chapter row with no known span (a video whose duration the server does not know yet, its
    // last chapter) would be "the whole file from 0" under a chapter id - the load stays on the web, as in v1.397.0
    if (listen && typeof d.chapterStartSec === 'number' && !(dur > 0)) return null;
    if (dur > 0) item.durationSec = dur;
    if (typeof d.chapterStartSec === 'number' && isFinite(d.chapterStartSec) && d.chapterStartSec >= 0 && dur > 0) {
      item.clip = { startSec: d.chapterStartSec, endSec: d.chapterStartSec + dur };
    }
    var route = listen ? '/api/progress' : (PROGRESS_ROUTES.indexOf(d.progressEndpoint) >= 0 ? d.progressEndpoint : (podcast ? '/api/podcasts/progress' : '/api/music/progress'));
    item.progress = { route: route, key: (item.clip || listen) ? base : id };
    if (kind === 'track' && typeof d.radioSeed === 'string' && d.radioSeed) item.radioSeed = d.radioSeed;
    return item;
  }
  // v1.398.0 (V10): the Item kinds ONE bound view holds together. Music lists `track` rows and Listen `video` rows in one queue;
  // Podcasts lists episodes. The Up-next flattening (D12) hands a view only the entries of its own family.
  function sameFamily(a, b) {
    var fam = function (k) { return (k === 'track' || k === 'video') ? 'music' : k; };
    return !!a && !!b && fam(a) === fam(b);
  }
  // v1.399.0 native video surface (plan docs/exec-plans/active/2026-10-28-native-video-surface.md, S1 + S2 + S6 + S10): the
  // watch page's VIDEO load -> the ONE whole-file Item native plays with sound AND picture, or null when the load stays on the
  // web element. A library video (watch.js's descriptor: the /api/videos/:id payload, `progressEndpoint` null) is a `video` Item at
  // /api/offline/file/video/<id> with its /thumbnail art (omitted when the video has none) and progress at /api/progress; a TV
  // episode (`progressEndpoint` '/api/tv/progress', the /api/tv/episode/:id payload) is a `tvEpisode` Item at
  // /api/offline/file/tvEpisode/<id> with /tvthumb art and progress at /api/tv/progress. Never a clip, never a radioSeed. The S6
  // stand-downs return null: a 360 / VR video (`projection` not flat: vr-view.js reads the element into WebGL), the Feed's cards
  // (their own progress routes), a preview or any other explicit stream that is not a TV episode, and anything that is not a
  // `type: 'video'` load. A video whose rendition is still transcoding (`needsTranscode` and not ready) stays on the web for now:
  // the web's "Preparing this video" overlay and its poll keep the user informed, and the poll claims it when it is ready
  // (player.js pollTranscodeUntilReady); the file route would answer 503 until then.
  function videoItemFromDescriptor(id, d) {
    if (!d || typeof d !== 'object' || d.type !== 'video') return null;
    var sid = id != null ? String(id) : '';
    if (!sid) return null;
    if (typeof d.projection === 'string' && d.projection !== '' && d.projection !== 'flat') return null;
    if (d.needsTranscode && d.transcodeStatus !== 'ready') return null;
    var tv = d.progressEndpoint === '/api/tv/progress' || (typeof d.statusUrl === 'string' && d.statusUrl.indexOf('/api/tv/') === 0);
    if (!tv && d.progressEndpoint != null && d.progressEndpoint !== '/api/progress') return null;
    if (!tv && typeof d.streamSrc === 'string' && d.streamSrc) return null;
    if (!tv && d.readerHref === '/feed') return null;
    var kind = tv ? 'tvEpisode' : 'video';
    var item = { kind: kind, id: sid, src: FILE_ROUTE + kind + '/' + encodeURIComponent(sid), title: typeof d.title === 'string' ? d.title.slice(0, 1024) : '' };
    var artist = typeof d.channelName === 'string' ? d.channelName : '';
    if (artist) item.artist = artist;
    if (tv) item.artworkSrc = '/tvthumb/' + encodeURIComponent(sid);
    else if (d.hasThumbnail === true) item.artworkSrc = '/thumbnail/' + encodeURIComponent(sid);
    var dur = num(d.duration, 0);
    if (dur > 0) item.durationSec = dur;
    item.progress = { route: tv ? '/api/tv/progress' : '/api/progress', key: sid };
    return item;
  }
  // An Up-next queue entry (GET /api/queue as lib/queue/routes.js shapedQueue emits it: `item` = { title, name, channelName,
  // folderName, artUrl, durationSec, hasThumbnail } for a track (channelName = artist, folderName = album) and a podcast
  // (channelName = the show), the media item itself for a library item) -> an Item, or null for a kind native cannot play.
  function itemFromQueueEntry(e) {
    if (!e || typeof e.mediaId !== 'string' || !e.mediaId) return null;
    var it = e.item && typeof e.item === 'object' ? e.item : {};
    var id = e.mediaId;
    var art = typeof it.artUrl === 'string' && /^\/(albumart|podcastart)\//.test(it.artUrl) ? it.artUrl : null;
    if (e.kind === 'podcast') {
      return { kind: 'podcastEpisode', id: id, src: FILE_ROUTE + 'podcastEpisode/' + encodeURIComponent(id), title: String(it.title || it.name || ''), artist: String(it.channelName || it.folderName || ''), artworkSrc: art || undefined, durationSec: num(it.durationSec, 0) || undefined, progress: { route: '/api/podcasts/progress', key: id } };
    }
    if (e.kind === 'track') {
      return { kind: 'track', id: id, src: FILE_ROUTE + 'track/' + encodeURIComponent(id), title: String(it.title || it.name || ''), artist: String(it.channelName || ''), album: String(it.folderName || ''), artworkSrc: art || '/albumart/' + encodeURIComponent(id), durationSec: num(it.durationSec, 0) || undefined, progress: { route: '/api/music/progress', key: id }, radioSeed: 'track:' + id };
    }
    if ((e.kind === 'media' || !e.kind) && it.type === 'audio') {
      return { kind: 'track', id: id, src: FILE_ROUTE + 'track/' + encodeURIComponent(id), title: String(it.title || ''), artist: String(it.channelName || (it.tags && it.tags.artist) || ''), album: String((it.tags && it.tags.album) || ''), artworkSrc: '/albumart/' + encodeURIComponent(id), durationSec: num(it.duration, 0) || undefined, progress: { route: '/api/progress', key: id } };
    }
    return null;
  }

  function create(win) {
    var host = win && win.FileTube && win.FileTube.host;
    var enabled = !!(host && typeof host.has === 'function' && host.has('nativeAudio'));
    var videoOn = enabled && host.has('nativeVideoAudio'); // v1.398.0: the engine also takes a video's sound (a Listen row)
    var surfaceOn = videoOn && host.has('nativeVideo'); // v1.399.0: and a watch-page video's PICTURE (one native player, the web's controls on top)
    var noop = function () {};
    if (!enabled) {
      return {
        enabled: false, videoAudio: false,
        claim: function () { return false; }, release: noop, beginLoad: noop, owns: function () { return false; }, ownedKind: function () { return null; }, active: function () { return false; }, lastClaimFollowed: function () { return false; },
        snapshot: function () { return null; }, position: function () { return 0; }, currentItem: function () { return null; },
        bindView: function () { return noop; }, syncQueue: function () { return false; }, modesChanged: function () { return false; },
        setSleep: function () { return false; }, sleep: function () { return { mode: 'off' }; }, onChange: function () { return noop; },
        subscribed: function () { return false; },
      };
    }

    var rev = 0;               // the last audio.load's rev
    var snap = null;           // the latest audioState (rev >= rev)
    var tick = null;           // { pos, at } the latest position (clip-relative) and when it was read
    var posted = null;         // { items, index } the last audio.load / the queue native holds as far as the web knows
    var ownedId = null;        // the web load id native plays for (null: the web element is the player)
    var ownedItem = null;      // the Item claim() handed native for ownedId (gate r2 adversary A-r2-W1: never read from the live snapshot, which is empty after a lost queue)
    var el = null;             // the proxied element
    var provider = null;       // the last load's data.nativeQueue
    var view = null;           // the bound view's hooks { onIndex, onAppend, modes }
    var playIntent = false, pauseIntent = false, transitioning = false;
    var lastRate = 1, defaultRate = 1, lastModes = null;
    var listeners = [];
    var subscribed = false, offState = null, offTick = null, offError = null;
    var erroredIds = Object.create(null);
    var queueUids = Object.create(null); // index -> the Up-next entry uid the Item came from (D12: the pointer follows native)
    var seenItemKey = null;
    var ownedSurface = false; // v1.399.0: the owned Item is a watch-page video native plays with its picture (not a Listen row)
    var sizeKey = '';        // v1.399.0 (S4): the videoSize the proxy last reported (resize fires on a change)
    var surfaceLast = null;  // v1.399.0 (S3): the last video.surface posted (a repeat is never sent)
    var surfaceRaf = 0;      // the one measure scheduled for the next animation frame
    var surfaceWired = false, surfaceObs = null, surfaceDocObs = null, surfaceMo = null, surfaceTimer = 0;
    var surfaceWatched = []; // the wrapper and the container the observer currently listens to (re-pointed when the box moves)
    var holeEl = null;       // #ft-video-hole: the page colour with the player box cut out (S5), appended to body on first use
    var holeClip = '';       // the clip path last written (a same-value style write would wake the body observer)
    var dockPoster = false;  // the thumbnail we put on the element while docked (S3a), removed on expand
    var followed = false;    // the last claim was a FOLLOW: 'adopt' (a fresh page took what native plays) | 'advance' (native moved on itself) | false
    var adopting = false;    // true while the bound view's adopt() runs (its load's claim is the 'adopt' follow)
    var pendingJump = null;  // { key, left, at } after an audio.jump: snapshots still showing the item LEFT are dropped for a moment (S-A)
    var adoptedRev = -1;     // the snapshot rev the bound view was asked to adopt (once per rev)
    var JUMP_FENCE_MS = 3000;

    function post(type, fields) { try { return host.post(type, fields); } catch (_) { return false; } }
    function fire(type) { if (!el) return; try { el.dispatchEvent(new win.Event(type)); } catch (_) { /* a listener bug never breaks the page */ } }
    function later(fn) { try { win.setTimeout(fn, 0); } catch (_) { fn(); } }
    function notify() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (_) { /* never breaks the page */ } } }
    function now() { return Date.now(); }

    function queue() { return snap && Array.isArray(snap.queue) ? snap.queue : (posted ? posted.items : []); }
    function index() { return snap ? snap.index : (posted ? posted.index : 0); }
    function currentItem() { var q = queue(); var i = index(); return (i >= 0 && i < q.length) ? q[i] : null; }
    function playing() { return !!(snap && snap.state === 'playing'); }
    function rate() { return snap ? num(snap.rate, lastRate) : lastRate; }
    function clipDuration() { var it = currentItem(); if (it && it.clip) return Math.max(0, num(it.clip.endSec, 0) - num(it.clip.startSec, 0)); return snap ? num(snap.durationSec, 0) : 0; }
    // The clip-relative position now: the latest tick, moved forward while playing (a tick arrives about once a second; the
    // dock's fill loop and the skins read 60 times a second).
    function position() {
      if (!tick) return 0;
      var p = tick.pos;
      if (playing() && !pauseIntent) p += Math.max(0, (now() - tick.at) / 1000) * rate();
      var d = clipDuration();
      if (d > 0) p = Math.min(p, d);
      return Math.max(0, p);
    }
    function abs(pos) { var it = currentItem(); return it && it.clip ? num(it.clip.startSec, 0) + pos : pos; }
    function modes() {
      var m = null;
      if (view && typeof view.modes === 'function') { try { m = view.modes(); } catch (_) { m = null; } }
      m = m || {};
      return { autoplay: m.autoplay !== false, shuffle: m.shuffle === true, loop: m.loop === 'one' ? 'one' : 'off' };
    }
    function paused() { if (playIntent) return false; if (pauseIntent) return true; return !playing(); }

    // ---- the element proxy -------------------------------------------------------------------------------------------
    function seekTo(fileAbs) {
      if (transitioning || !ownedId) return;
      var q = queue(); var it = currentItem();
      var target = Math.max(0, num(fileAbs, 0));
      if (it && it.clip) {
        var s = num(it.clip.startSec, 0), e = num(it.clip.endSec, 0);
        if (target < s || target >= e) {
          // outside this chapter: the Item whose clip holds the target (the dock scrubber spans the whole file)
          for (var j = 0; j < q.length; j++) {
            var c = q[j] && q[j].clip;
            if (q[j] && q[j].src === it.src && c && target >= num(c.startSec, 0) && target < num(c.endSec, Infinity)) {
              post('audio.jump', { index: j });
              post('audio.seek', { positionSec: target - num(c.startSec, 0) });
              tick = { pos: target - num(c.startSec, 0), at: now() };
              fire('timeupdate');
              return;
            }
          }
          target = Math.min(Math.max(target, s), Math.max(s, e - 0.05));
        }
        var rel = target - s;
        post('audio.seek', { positionSec: rel });
        tick = { pos: rel, at: now() };
      } else {
        var d = clipDuration();
        if (d > 0) target = Math.min(target, d);
        post('audio.seek', { positionSec: target });
        tick = { pos: target, at: now() };
      }
      fire('timeupdate');
      later(function () { fire('seeked'); });
    }
    function proxyPlay() {
      if (!transitioning && ownedId) {
        if (snap && snap.state === 'idle' && provider) {
          // native lost its queue (the app restarted its engine): send it again, playing, where the web is
          reload(position(), true);
        } else {
          playIntent = true; pauseIntent = false;
          post('audio.play');
        }
        later(function () { fire('play'); });
      }
      return Promise.resolve();
    }
    function proxyPause() {
      if (transitioning || !ownedId) return;
      pauseIntent = true; playIntent = false;
      tick = { pos: position(), at: now() };
      post('audio.pause');
      later(function () { fire('pause'); });
    }
    function attach(target) {
      if (el === target) return;
      if (el) detach();
      el = target;
      var def = function (name, get, set) {
        try { Object.defineProperty(el, name, { configurable: true, enumerable: true, get: get, set: set || undefined }); } catch (_) { /* a frozen element: the web plays */ }
      };
      def('currentTime', function () { return abs(position()); }, seekTo);
      def('duration', function () { return fileDurationOf(currentItem(), queue(), snap ? num(snap.durationSec, 0) : 0); });
      def('paused', paused);
      def('ended', function () { return !!(snap && snap.state === 'ended'); });
      def('playbackRate', function () { return rate(); }, function (v) {
        var r = Math.min(RATE_MAX, Math.max(RATE_MIN, num(v, 1)));
        if (!transitioning && ownedId && r !== lastRate) post('audio.setRate', { rate: r });
        lastRate = r;
        if (snap) snap.rate = r;
        later(function () { fire('ratechange'); });
      });
      def('defaultPlaybackRate', function () { return defaultRate; }, function (v) { defaultRate = num(v, 1); });
      def('readyState', function () { return snap && snap.state !== 'idle' && snap.state !== 'loading' ? 4 : (snap ? 1 : 0); });
      def('buffered', function () {
        var b = snap && typeof snap.bufferedSec === 'number' ? snap.bufferedSec : null;
        var end = b === null ? null : abs(b);
        return { length: end === null ? 0 : 1, start: function () { return abs(0); }, end: function () { return end === null ? 0 : end; } };
      });
      def('seeking', function () { return false; });
      def('play', function () { return proxyPlay; });
      def('pause', function () { return proxyPause; });
      if (surfaceOn) {
        // v1.399.0 (S4): the presentation size native reports on audioState (0 x 0 until the first frame is known, as an element
        // answers before loadedmetadata)
        def('videoWidth', function () { return videoSize().w; });
        def('videoHeight', function () { return videoSize().h; });
        surfaceWire(); surfaceSchedule();
      }
    }
    function videoSize() {
      var v = snap && snap.videoSize;
      return (v && typeof v === 'object') ? { w: Math.max(0, Math.floor(num(v.w, 0))), h: Math.max(0, Math.floor(num(v.h, 0))) } : { w: 0, h: 0 };
    }
    function detach() {
      if (!el) return;
      for (var i = 0; i < PROXY_PROPS.length; i++) { try { delete el[PROXY_PROPS[i]]; } catch (_) { /* best-effort */ } }
      if (surfaceOn) surfaceOff(el);
      el = null;
    }

    // ---- the picture surface (v1.399.0, S3 + S3a + S5 + S8) -----------------------------------------------------------
    // Native's layer sits BELOW the non-opaque web view and shows only where the page paints nothing. While native owns a
    // surface video, the web (1) tells native where the player box is with video.surface - the #media-player box in CSS px,
    // `document` space for the in-page player (native follows the scroll itself) or `viewport` space in the web's CSS fullscreen;
    // measured once per animation frame when something may have moved (the box resized, the document resized or mutated, the
    // window resized or rotated, the player docked / expanded / went fullscreen), posted only when it differs from the last one -
    // nothing while nothing moves; (2) paints the HOLE: body and html go transparent (style.css body.ft-native-video) and
    // #ft-video-hole, a document-sized layer in the page colour behind all content, clips the box out (an even-odd path: its top
    // corners rounded like the player box, the bottom ones square: the control bar sits below the picture); (3) while DOCKED the picture is hidden
    // (visible: false; the page keeps scrolling under the fixed mini player, S3a), the dock shows the video's thumbnail as the
    // element's poster, and the sound plays on. Without `nativeVideo` none of this exists (S11).
    function surfaceSchedule() {
      if (!surfaceOn || surfaceRaf || !ownedSurface || !ownedId) return; // only while native plays a video WITH its picture (a track never samples)
      var raf = typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame.bind(win) : function (fn) { return win.setTimeout(fn, 16); };
      surfaceRaf = raf(function () { surfaceRaf = 0; surfaceSync(); });
    }
    function surfaceWire() {
      if (surfaceWired || !surfaceOn) return;
      surfaceWired = true;
      var doc = win.document;
      try {
        if (typeof win.ResizeObserver === 'function') {
          surfaceObs = new win.ResizeObserver(surfaceSchedule);
          if (el) surfaceObs.observe(el);
          surfaceDocObs = new win.ResizeObserver(surfaceSchedule);
          if (doc.documentElement) surfaceDocObs.observe(doc.documentElement);
        }
        if (typeof win.MutationObserver === 'function' && doc.body) {
          // the fullscreen / expanded classes on the wrapper, body and html, a view swap under #view-root, the dock's hidden flag.
          // Deliberately NOT the whole body subtree: the player's own per-frame writes (the time label, the fill) live there and
          // would wake the sampler every frame (gate r1 WARNING). A reparent is heard on the container (surfaceWatchContainer),
          // content growing above the box on the document's ResizeObserver, anything else by the 1 s backstop.
          surfaceMo = new win.MutationObserver(surfaceSchedule);
          surfaceMo.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
          if (doc.documentElement) surfaceMo.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] });
          var viewRoot = doc.getElementById('view-root'); if (viewRoot) surfaceMo.observe(viewRoot, { childList: true });
          var dockEl = doc.getElementById('player-dock'); if (dockEl) surfaceMo.observe(dockEl, { attributes: true, attributeFilter: ['hidden'], childList: true });
          var slotEl = doc.getElementById('player-slot'); if (slotEl) surfaceMo.observe(slotEl, { childList: true });
          var stageEl = doc.getElementById('fs-stage'); if (stageEl) surfaceMo.observe(stageEl, { childList: true });
        }
        win.addEventListener('resize', surfaceSchedule);
        win.addEventListener('orientationchange', surfaceSchedule);
        if (win.visualViewport && typeof win.visualViewport.addEventListener === 'function') win.visualViewport.addEventListener('resize', surfaceSchedule);
        win.addEventListener('pageshow', function (ev) { if (ev && ev.persisted) { surfaceLast = null; surfaceSchedule(); } }); // the host hid the layer at the navigation commit: a restored page re-sends
        if (typeof doc.addEventListener === 'function') doc.addEventListener('fullscreenchange', surfaceSchedule);
      } catch (_) { /* observers are a convenience: the backstop below still measures */ }
      surfaceTimer = win.setInterval(function () { if (ownedSurface && ownedId) surfaceSchedule(); }, 1000); // a backstop measure (posts only on a change)
      var stopTimer = function () { if (surfaceTimer) { win.clearInterval(surfaceTimer); surfaceTimer = 0; } };
      try { win.addEventListener('pagehide', function (ev) { if (!(ev && ev.persisted)) stopTimer(); }); win.addEventListener('unload', stopTimer); } catch (_) { /* no window events */ }
    }
    function surfaceOff(target) {
      // ownership ends (a stop, a stand-down load, the player closed): the layer is hidden once if it was showing, the hole closes
      if (surfaceLast && surfaceLast.visible) { var last = Object.assign({}, surfaceLast, { visible: false }); post('video.surface', last); surfaceLast = last; }
      if (surfaceObs && target) { try { surfaceObs.unobserve(target); } catch (_) { /* best-effort */ } }
      if (surfaceRaf) { try { win.cancelAnimationFrame(surfaceRaf); } catch (_) { /* best-effort */ } surfaceRaf = 0; }
      holeApply(null, target);
    }
    function surfaceMeasure() {
      var doc = win.document;
      if (!el || !ownedSurface || !ownedId) return null;
      var wrapper = (typeof el.closest === 'function' && el.closest('#player-wrapper')) || el.parentNode;
      var docked = typeof el.closest === 'function' && !!el.closest('#player-dock');
      var cssFs = !!(wrapper && wrapper.classList && wrapper.classList.contains('css-fullscreen'));
      var nativeFs = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
      var r = el.getBoundingClientRect();
      var w = Math.max(0, num(r.width, 0)), h = Math.max(0, num(r.height, 0));
      var cs = null;
      try { cs = win.getComputedStyle(el); } catch (_) { cs = null; }
      var fit = cs && cs.objectFit === 'cover' ? 'cover' : 'contain';
      var radius = 0;
      if (!cssFs && !nativeFs && wrapper) { try { radius = Math.max(0, num(parseFloat(win.getComputedStyle(wrapper).borderTopLeftRadius), 0)); } catch (_) { radius = 0; } }
      var viewportSpace = cssFs || nativeFs;
      var x = num(r.left, 0), y = num(r.top, 0);
      if (!viewportSpace) { x += num(win.scrollX, 0); y += num(win.scrollY, 0); }
      var round = function (v) { return Math.round(v * 100) / 100; };
      var visible = !docked && w > 0 && h > 0 && !(cs && cs.display === 'none');
      return { rect: { x: round(x), y: round(y), w: round(w), h: round(h) }, space: viewportSpace ? 'viewport' : 'document', visible: visible, fit: fit, radius: round(radius), docked: docked };
    }
    // the wrapper's class (css-fullscreen, audio-expanded) and its container's children (a reparent) are the placement signals
    // nearest the box; (re)observed at every measure since the slot node is rebuilt per view
    function surfaceWatchContainer() {
      if (!surfaceMo || !el) return;
      var wrapper = (typeof el.closest === 'function' && el.closest('#player-wrapper')) || el.parentNode;
      var container = wrapper && wrapper.parentNode;
      var want = [wrapper, container].filter(Boolean);
      var same = want.length === surfaceWatched.length && want.every(function (n, i) { return n === surfaceWatched[i]; });
      if (same) return;
      surfaceWatched = want;
      try {
        if (wrapper) surfaceMo.observe(wrapper, { attributes: true, attributeFilter: ['class'] });
        // a second observe() on a node REPLACES its options: the dock keeps its hidden flag watched (gate r2, adversary INFO)
        if (container) surfaceMo.observe(container, container.id === 'player-dock' ? { childList: true, attributes: true, attributeFilter: ['hidden'] } : { childList: true });
      } catch (_) { /* observing twice is a no-op; a detached node is harmless */ }
    }
    function surfaceSync() {
      if (!surfaceOn) return;
      var m = null;
      try { surfaceWatchContainer(); m = surfaceMeasure(); } catch (_) { return; } // a window being torn down: nothing to place
      if (!m) { if (el) surfaceOff(el); return; }
      var msg = { rect: m.rect, space: m.space, visible: m.visible, fit: m.fit, radius: m.radius };
      var same = surfaceLast && JSON.stringify(surfaceLast) === JSON.stringify(msg);
      if (!same && post('video.surface', msg)) surfaceLast = msg;
      try { holeApply(m.visible ? m : null, el); dockArt(m.docked); } catch (_) { /* a paint detail never breaks playback */ }
    }
    // S3a: the docked mini player shows the video's thumbnail (the element's poster, removed again on expand)
    function dockArt(docked) {
      if (!el) return;
      var art = ownedItem && typeof ownedItem.artworkSrc === 'string' ? ownedItem.artworkSrc : '';
      if (docked && art) { if (el.getAttribute('poster') !== art) el.setAttribute('poster', art); dockPoster = true; }
      else if (dockPoster) { el.removeAttribute('poster'); dockPoster = false; }
    }
    // S5: the hole. `m` is the visible measure, or null to close it.
    // Every write here is IDEMPOTENT (gate r1 WARNING): a same-value classList or style write still queues a mutation record,
    // the body observer hears it and schedules the next frame - the sampler would feed itself at 60 Hz while nothing moves.
    function holeApply(m, target) {
      var doc = win.document;
      var body = doc.body;
      if (!body) return;
      if (!m) {
        if (body.classList.contains('ft-native-video')) body.classList.remove('ft-native-video');
        if (holeEl && holeEl.hasAttribute('style')) { holeEl.removeAttribute('style'); holeClip = ''; }
        if (dockPoster && target && !target.closest('#player-dock')) { target.removeAttribute('poster'); dockPoster = false; }
        return;
      }
      if (!holeEl) {
        holeEl = doc.getElementById('ft-video-hole');
        if (!holeEl) { holeEl = doc.createElement('div'); holeEl.id = 'ft-video-hole'; holeEl.setAttribute('aria-hidden', 'true'); body.insertBefore(holeEl, body.firstChild); }
      }
      if (!body.classList.contains('ft-native-video')) body.classList.add('ft-native-video');
      if (m.space === 'viewport') { if (holeEl.hasAttribute('style')) { holeEl.removeAttribute('style'); holeClip = ''; } return; } // CSS fullscreen: the whole viewport is the picture box (the wrapper and body paint nothing)
      var de = doc.documentElement;
      var docH = Math.max(num(de && de.scrollHeight, 0), num(body.scrollHeight, 0), num(win.innerHeight, 0));
      var docW = Math.max(num(de && de.clientWidth, 0), num(win.innerWidth, 0));
      var rct = m.rect, rad = Math.max(0, Math.min(m.radius, rct.w / 2, rct.h / 2));
      // the page (an outer rectangle) minus the player box (an inner path, its top corners rounded, its bottom ones square),
      // as one even-odd clip path in the layer's own px; the layer scrolls with the document, so the hole needs no scroll work
      var x0 = rct.x, y0 = rct.y, x1 = rct.x + rct.w, y1 = rct.y + rct.h;
      var inner = 'M' + (x0 + rad) + ',' + y0 + 'H' + (x1 - rad) + 'A' + rad + ',' + rad + ' 0 0 1 ' + x1 + ',' + (y0 + rad) + 'V' + y1 + 'H' + x0 + 'V' + (y0 + rad) + 'A' + rad + ',' + rad + ' 0 0 1 ' + (x0 + rad) + ',' + y0 + 'Z';
      var outer = 'M0,0H' + docW + 'V' + docH + 'H0Z';
      var st = holeEl.style;
      var hpx = docH + 'px';
      if (st.height !== hpx) st.height = hpx;
      var clip = 'path(evenodd, "' + outer + inner + '")';
      if (holeClip !== clip) { holeClip = clip; st.setProperty('-webkit-clip-path', clip); st.setProperty('clip-path', clip); }
    }

    // ---- snapshots ----------------------------------------------------------------------------------------------------
    function itemKey(it) { return it ? it.kind + ':' + it.id + (it.clip ? '@' + num(it.clip.startSec, 0) : '') : ''; }
    function onState(s) {
      // older than the web's last load: dropped - except native's "I lost my queue" (rev 0, idle, nothing queued), which no
      // web load ever stamped (rev starts at 1): the web must learn it, so the next play re-sends the queue
      var lostQueue = num(s.rev, -1) === 0 && s.state === 'idle' && (!Array.isArray(s.queue) || s.queue.length === 0);
      if (num(s.rev, -1) < rev && !lostQueue) return;
      if (pendingJump) {
        // a jump has no sequence of its own: a same-rev snapshot of the item we just left (sent before native took the jump)
        // must not be read as "native went back" and followed (gate r1 adversary S-A); fenced for a moment, then trusted
        // (the 3 s bound covers a native that refused or skipped the jumped-to item: its later snapshot of another item is
        // then followed as usual)
        var q0 = Array.isArray(s.queue) ? s.queue : []; var c0 = q0[num(s.index, -1)];
        var shown = c0 ? itemKey(c0) : '';
        if (shown === pendingJump.key || shown !== pendingJump.left) pendingJump = null; // the target, or ANY other item (native refused or skipped it, gate r2 adversary W-r2-A): trusted at once
        else if (now() - pendingJump.at < JUMP_FENCE_MS) return; // the item we left, still shown: the pre-jump snapshot
        else pendingJump = null;
      }
      var prev = snap;
      var known = queue();
      var prevItem = currentItem();
      var wasPlaying = playing();
      snap = s;
      if (!lostQueue) tick = { pos: num(s.positionSec, 0), at: now() }; // a lost queue keeps the last known position: the re-send resumes there (r2-S3)
      playIntent = false; pauseIntent = false;
      lastRate = num(s.rate, lastRate);
      if (posted && Array.isArray(s.queue) && s.queue.length) posted = { items: s.queue, index: num(s.index, posted.index) }; // the queue native holds (its appends included) is the one later loads compare against
      if (!ownedId) {
        // nothing of ours is loaded (a fresh page while native plays on): the bound view adopts native's queue - it loads the
        // playing item, the choke point sees a FOLLOW, and the dock shows it (native-bridge.md section 6); once per rev
        var live = s.state === 'playing' || s.state === 'paused' || s.state === 'loading';
        var pl = win.FileTube && win.FileTube.player;
        var webIdle = !pl || pl.currentId === null || pl.currentId === undefined;
        if (live && Array.isArray(s.queue) && s.queue.length && webIdle && view && typeof view.adopt === 'function' && adoptedRev !== num(s.rev, -1)) {
          adoptedRev = num(s.rev, -1);
          rev = Math.max(rev, adoptedRev); // the web's next load counts up from native's
          posted = { items: s.queue, index: num(s.index, 0) };
          adopting = true;
          try { view.adopt(s.queue, num(s.index, 0), s.state); } catch (_) { /* the view's bug never breaks the proxy */ }
          adopting = false;
        }
        notify(); return;
      }
      var cur = currentItem();
      // an append (native's radio picks, D11): the known queue is a prefix of the new one
      if (Array.isArray(s.queue) && known.length && s.queue.length > known.length && sameQueue(known, s.queue.slice(0, known.length))) {
        var extra = s.queue.slice(known.length);
        if (view && typeof view.onAppend === 'function') { try { view.onAppend(extra, 'radio'); } catch (_) { /* the view's bug never breaks the proxy */ } }
      }
      var key = itemKey(cur);
      var vs = videoSize(); var sk = (vs.w > 0 && vs.h > 0) ? vs.w + 'x' + vs.h : '';
      var sizeChanged = key === seenItemKey && sk !== sizeKey;
      if (key !== seenItemKey) {
        seenItemKey = key; sizeKey = sk;
        fire('durationchange'); fire('loadedmetadata');
        var rolled = !!(prevItem && cur && prevItem.src === cur.src && prevItem.clip && cur.clip); // the next chapter of the same file: the chapter watcher moves on its own
        // a FOLLOW is asked only when native moved to an item the web did not load itself (the web's own load is `ownedId`)
        if (!rolled && cur && cur.id !== ownedId && !(prevItem && sameItem(prevItem, cur))) {
          if (queueUids[s.index]) { try { win.fetch('/api/queue/pointer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: queueUids[s.index] }), keepalive: true }).catch(function () {}); } catch (_) { /* best-effort */ } }
          if (view && typeof view.onIndex === 'function') { try { view.onIndex(s.index, cur); } catch (_) { /* never breaks the proxy */ } }
        }
      }
      if (sizeChanged) {
        // v1.399.0 (S4): the size became known after the item's first snapshot (loadedmetadata again: the aspect box reads
        // videoWidth / videoHeight there and skipped the 0 x 0), or changed (resize), as an element fires them
        var firstSize = !sizeKey; sizeKey = sk;
        if (firstSize) fire('loadedmetadata');
        fire('resize');
      }
      if (playing() && !wasPlaying) { fire('play'); fire('playing'); }
      else if (!playing() && wasPlaying) fire('pause');
      if (prev && num(prev.rate, 1) !== num(s.rate, 1)) fire('ratechange');
      if (s.state === 'failed' && s.error && cur && !erroredIds[cur.id]) toastError(cur.id, s.error);
      fire('timeupdate');
      notify();
    }
    function onTick(t) {
      if (num(t.rev, -1) < rev || !snap) return;
      if (pendingJump && now() - pendingJump.at < JUMP_FENCE_MS) return; // an old-item tick before native took the jump (r2-S2)
      tick = { pos: num(t.positionSec, 0), at: now() };
      if (typeof t.bufferedSec === 'number') snap.bufferedSec = t.bufferedSec;
      if (ownedId) fire('timeupdate');
    }
    function toastError(id, error) {
      erroredIds[id] = true;
      try { if (win.ui && typeof win.ui.toast === 'function') win.ui.toast(ERROR_COPY[error] || ERROR_COPY.other, { kind: 'error' }); } catch (_) { /* a toast bug never breaks the page */ }
    }
    function subscribe() {
      if (subscribed) return;
      subscribed = true;
      offState = host.on('audioState', onState);
      offTick = host.on('audioTick', onTick);
      offError = host.on('audioError', function (d) { if (!erroredIds[d.id]) toastError(d.id, d.error); notify(); });
      post('audio.subscribe');
    }
    function unsubscribe() {
      if (!subscribed) return;
      subscribed = false;
      post('audio.unsubscribe');
      if (offState) { offState(); offState = null; }
      if (offTick) { offTick(); offTick = null; }
      if (offError) { offError(); offError = null; }
    }

    // ---- loads --------------------------------------------------------------------------------------------------------
    function readProvider() {
      if (typeof provider !== 'function') return null;
      var q = null;
      try { q = provider(); } catch (_) { q = null; }
      if (!q || !Array.isArray(q.items) || !q.items.length) return null;
      var items = [];
      for (var k = 0; k < q.items.length; k++) {
        var it = q.items[k] && q.items[k].kind && q.items[k].src && q.items[k].progress ? q.items[k] : itemFromDescriptor(q.items[k], { video: videoOn });
        if (!it) return null; // one row native cannot play: the whole load stays on the web (an index must never shift)
        items.push(it);
      }
      var i = Math.floor(num(q.index, 0));
      if (i < 0 || i >= items.length) i = 0;
      return { items: items, index: i };
    }
    function sendLoad(items, idx, positionSec, autoplay) {
      rev += 1;
      var ok = post('audio.load', { queue: items, index: idx, positionSec: Math.max(0, num(positionSec, 0)), autoplay: !!autoplay, modes: modes(), rate: Math.min(RATE_MAX, Math.max(RATE_MIN, lastRate)), rev: rev });
      if (!ok) { rev -= 1; return false; }
      posted = { items: items, index: idx };
      lastModes = modes();
      if (!snap || num(snap.rev, -1) < rev) { snap = { rev: rev, queue: items, index: idx, state: 'loading', positionSec: positionSec, durationSec: 0, rate: lastRate, modes: lastModes, sleep: snap ? snap.sleep : { mode: 'off' } }; }
      tick = { pos: Math.max(0, num(positionSec, 0)), at: now() };
      seenItemKey = null; // the first snapshot of this load fires loadedmetadata / durationchange (the real duration arrives there)
      return true;
    }
    function reload(positionSec, autoplay) {
      var q = readProvider();
      if (!q) return false;
      var cur = currentItem();
      var idx = q.index;
      if (cur) { for (var i = 0; i < q.items.length; i++) { if (sameItem(q.items[i], cur)) { idx = i; break; } } }
      queueUids = Object.create(null);
      var sent = sendLoad(q.items, idx, positionSec, autoplay);
      if (sent) flattenServerQueue(q.items, idx);
      return sent;
    }
    // D12: the server Up-next queue. When its pointer sits on the item that just loaded, the entries after it OF THE SAME KIND
    // are handed to the bound view (music or podcasts), which appends them as rows; its re-registration re-sends the queue
    // ONCE (rev + 1, same index and position) through syncQueue, and the web follows the pointer as native reaches them.
    // Native stays queue-dumb. (Gate r1 adversary W-D: one load, only what the view holds.)
    function flattenServerQueue(items, idx) {
      var loadRev = rev;
      var cur = items[idx];
      if (!cur || typeof win.fetch !== 'function') return;
      var p;
      try { p = win.fetch('/api/queue'); } catch (_) { return; }
      Promise.resolve(p).then(function (res) { return res && res.ok ? res.json() : null; }).catch(function () { return null; }).then(function (q) {
        if (!q || rev !== loadRev || !ownedId) return;
        var entries = (Array.isArray(q.entries) ? q.entries : []).filter(function (e) { return e && typeof e.uid === 'string' && e.uid && typeof e.mediaId === 'string' && e.mediaId; });
        var pointerUid = typeof q.pointerUid === 'string' ? q.pointerUid : null;
        var at = -1;
        for (var i = 0; i < entries.length; i++) { if (entries[i].uid === pointerUid) { at = i; break; } }
        var baseId = cur.progress && cur.progress.key ? cur.progress.key : cur.id;
        if (at < 0 || entries[at].mediaId !== baseId) return;
        var extra = [], uids = [];
        var have = {};
        for (var k = 0; k < items.length; k++) have[items[k].kind + ':' + items[k].id] = true;
        for (var j = at + 1; j < entries.length; j++) {
          var it = itemFromQueueEntry(entries[j]);
          // only the playing Item's FAMILY (v1.398.0 V10: Music holds track and Listen video Items together): the bound view
          // (music or podcasts) can mirror and follow those; a cross-family entry would play with no owner in the web (gate r1
          // qa W2) - it stays with the web's own ended cascade semantics (none under native), i.e. it is not played from here
          if (!it || !sameFamily(it.kind, cur.kind) || have[it.kind + ':' + it.id]) continue;
          have[it.kind + ':' + it.id] = true;
          extra.push(it); uids.push(entries[j].uid);
        }
        if (!extra.length) return;
        if (!view || typeof view.onAppend !== 'function') return; // no view to hold them: they are not played from here
        try { view.onAppend(extra, 'queue'); } catch (_) { /* never breaks the proxy */ }
        syncQueue(); // a no-op when the view's own re-registration already re-sent the longer queue
        var held = posted ? posted.items : [];
        for (var u = 0; u < extra.length; u++) {
          for (var h = 0; h < held.length; h++) { if (sameItem(held[h], extra[u])) { queueUids[h] = uids[u]; break; } }
        }
      });
    }

    // The player.load choke point. Returns true when native takes this load (nothing is set on the element).
    function claim(target, id, data) {
      transitioning = false;
      if (surfaceOn && target && data && data.type === 'video') {
        var vi = videoItemFromDescriptor(id, data);
        if (vi) return claimVideo(target, id, vi);
      }
      if (!target || !data || data.type !== 'audio' || typeof data.nativeQueue !== 'function') {
        if (ownedId) stop();
        return false;
      }
      if (ownedSurface) { ownedSurface = false; if (surfaceOn && el) surfaceOff(el); } // a track after a surface video: the picture layer is closed here (the same element is re-claimed, nothing else fires)
      provider = data.nativeQueue;
      var q = readProvider();
      if (!q) { if (ownedId) stop(); provider = null; return false; }
      var want = q.items[q.index];
      if (!want || want.id !== String(id)) {
        // the caller's index does not name this load: find it by id, else refuse (the web plays)
        var found = -1;
        for (var i = 0; i < q.items.length; i++) { if (q.items[i] && q.items[i].id === String(id)) { found = i; break; } }
        if (found < 0) { if (ownedId) stop(); provider = null; return false; }
        q.index = found; want = q.items[found];
      }
      var cur = currentItem();
      var fresh = !!(snap && num(snap.rev, -1) >= rev && snap.state !== 'idle');
      var same = fresh && sameQueue(queue(), q.items); // the queue native holds now (radio appends included)
      if (same && cur && sameItem(cur, want)) {
        // a follow: native already plays this item (it advanced, or the view re-loaded the current one, or the page adopted it)
        followed = adopting ? 'adopt' : 'advance';
        ownedId = String(id); ownedItem = want; attach(target); subscribe();
        fire('durationchange');
        return true;
      }
      followed = false;
      pendingJump = null;
      ownedId = String(id); ownedItem = want;
      attach(target);
      subscribe();
      playIntent = false; pauseIntent = false;
      if (same && fresh) {
        post('audio.jump', { index: q.index });
        pendingJump = { key: itemKey(want), left: itemKey(cur), at: now() };
        posted = { items: q.items, index: q.index };
        snap.index = q.index; snap.state = 'loading'; snap.positionSec = 0; snap.durationSec = 0;
        tick = { pos: 0, at: now() };
        seenItemKey = null; // the first snapshot of the jumped-to item fires loadedmetadata / durationchange
        fire('emptied'); fire('durationchange');
        return true;
      }
      queueUids = Object.create(null);
      pendingJump = null;
      if (!sendLoad(q.items, q.index, 0, false)) {
        // the adapter refused the message (a malformed Item): the web plays this one; make sure native is silent
        post('audio.stop');
        ownedId = null; ownedItem = null; detach(); provider = null;
        return false;
      }
      fire('emptied'); fire('durationchange');
      flattenServerQueue(q.items, q.index);
      return true;
    }
    // v1.399.0 (S1, S2): the watch page's video under `nativeVideo` - ONE whole-file Item is the queue (no Up-next flattening, no
    // view: autoplay to the next video is not native's here), the element is the proxy with videoWidth / videoHeight, native
    // owns sound, picture, the lock screen and the progress posts. A same-item claim while native plays it (the watch page
    // re-opened, the full load after the bare early one, a transcode the poll found ready) FOLLOWS: nothing is re-sent.
    function claimVideo(target, id, item) {
      var items = [item];
      provider = function () { return { items: items, index: 0 }; }; // reload() re-sends it when native lost its queue
      var cur = currentItem();
      var fresh = !!(snap && num(snap.rev, -1) >= rev && snap.state !== 'idle');
      if (fresh && cur && sameItem(cur, item) && queue().length === 1) {
        followed = 'adopt'; // the page takes what native plays, where it is: no progress read, no seek, no autostart (handleResumePlayback)
        ownedId = String(id); ownedItem = item; ownedSurface = true; attach(target); subscribe();
        fire('durationchange');
        return true;
      }
      followed = false; pendingJump = null; queueUids = Object.create(null);
      ownedId = String(id); ownedItem = item; ownedSurface = true;
      attach(target);
      subscribe();
      playIntent = false; pauseIntent = false;
      if (!sendLoad(items, 0, 0, false)) {
        post('audio.stop');
        ownedId = null; ownedItem = null; ownedSurface = false; detach(); provider = null;
        return false;
      }
      fire('emptied'); fire('durationchange');
      surfaceSchedule();
      return true;
    }
    function stop() {
      post('audio.stop');
      ownedId = null; ownedItem = null; ownedSurface = false; posted = null; provider = null; seenItemKey = null; followed = false; pendingJump = null;
      queueUids = Object.create(null);
      if (snap) { snap = { rev: snap.rev, queue: [], index: 0, state: 'idle', positionSec: 0, durationSec: 0, rate: lastRate, modes: snap.modes, sleep: { mode: 'off' } }; }
      tick = null;
      detach();
      notify();
    }
    function release() { if (ownedId || posted) stop(); else detach(); }
    function beginLoad() { transitioning = true; }
    function owns(id) { return !!ownedId && (id === undefined || String(id) === ownedId); }
    function ownedKind() { return (ownedId && ownedItem) ? ownedItem.kind : null; } // the kind of the Item native plays for the web's load (a video: a Listen row, or a v1.399.0 surface video)
    function surfaceOwned() { return !!ownedId && ownedSurface; } // v1.399.0: native plays the web's video WITH its picture (the watch page's same-id re-open is an adopt, never a hand-back)
    // v1.399.0: would claim() take this video load for native (the same rule the claim applies)? player.js asks BEFORE the claim so
    // the sidecar's settings read and prepare-audio are never fired for a load native is about to own (S9); a bare typeless load
    // under nativeVideo is deferred to its full load and holds too.
    function wouldClaimVideo(id, data) {
      if (!surfaceOn || !data || typeof data !== 'object') return false;
      if (typeof data.type !== 'string') return true;
      return data.type === 'video' && !!videoItemFromDescriptor(id, data);
    }
    function active() { return !!ownedId; }

    // D17: the view's queue ORDER changed (a shuffle toggle, an append of its own, a reorder): re-send at the current index and
    // the position of the latest tick. A no-op when the queue native holds is already this one.
    function syncQueue() {
      if (!ownedId) return false;
      var q = readProvider();
      if (!q) return false;
      if (sameQueue(queue(), q.items)) return false;
      return reload(position(), playing() || playIntent);
    }
    function modesChanged() {
      if (!ownedId) return false;
      var m = modes();
      if (lastModes && lastModes.autoplay === m.autoplay && lastModes.shuffle === m.shuffle && lastModes.loop === m.loop) return false;
      lastModes = m;
      return post('audio.setModes', { modes: m });
    }
    function setSleep(mode, minutes) {
      if (!ownedId) return false;
      if (mode === 'minutes') return post('audio.sleep', { mode: 'minutes', minutes: Math.max(1, Math.min(720, Math.round(num(minutes, 0)))) });
      return post('audio.sleep', { mode: mode === 'endOfItem' ? 'endOfItem' : 'off' });
    }
    function sleep() { return (snap && snap.sleep && typeof snap.sleep.mode === 'string') ? snap.sleep : { mode: 'off' }; }
    function bindView(hooks) {
      view = hooks && typeof hooks === 'object' ? hooks : null;
      return function () { if (view === hooks) view = null; };
    }
    function onChange(fn) {
      if (typeof fn !== 'function') return noop;
      listeners.push(fn);
      return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    }

    subscribe();
    try {
      win.addEventListener('pagehide', function () { unsubscribe(); });
      win.addEventListener('pageshow', function (ev) { if (ev && ev.persisted) subscribe(); });
    } catch (_) { /* no window events */ }

    return {
      enabled: true, videoAudio: videoOn, videoSurface: surfaceOn,
      claim: claim, release: release, beginLoad: beginLoad, owns: owns, ownedKind: ownedKind, surfaceOwned: surfaceOwned, wouldClaimVideo: wouldClaimVideo, active: active,
      lastClaimFollowed: function () { return followed; },
      snapshot: function () { return snap; }, position: position, currentItem: currentItem,
      bindView: bindView, syncQueue: syncQueue, modesChanged: modesChanged,
      setSleep: setSleep, sleep: sleep, onChange: onChange,
      subscribed: function () { return subscribed; },
      syncSurface: function () { if (surfaceRaf) { try { win.cancelAnimationFrame(surfaceRaf); } catch (_) { /* best-effort */ } surfaceRaf = 0; } surfaceSync(); }, // v1.399.0: measure now (the player calls it on a placement change; tests too)
      lastSurface: function () { return surfaceLast; },
    };
  }

  var api = { create: create, itemFromDescriptor: itemFromDescriptor, videoItemFromDescriptor: videoItemFromDescriptor, itemFromQueueEntry: itemFromQueueEntry, fileDurationOf: fileDurationOf, sameItem: sameItem, sameQueue: sameQueue, sameFamily: sameFamily, FILE_ROUTE: FILE_ROUTE, DEFAULT_MODES: DEFAULT_MODES, ERROR_COPY: ERROR_COPY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) {
    root.FileTube = root.FileTube || {};
    if (!root.FileTube.nativeAudio) root.FileTube.nativeAudio = create(root);
  }
})(typeof window !== 'undefined' ? window : null);
