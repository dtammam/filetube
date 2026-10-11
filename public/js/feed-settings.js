// FileTube Feed settings (v1.382.0, plan docs/exec-plans/completed/2026-10-10-feed-settings.md D1-D5, D11; v1.383.0, plan
// docs/exec-plans/completed/2026-10-10-feed-reels.md K1 Auto-advance, K5 Song clip, K6 Music while reading).
//
// The ONE reading of the Feed's synced settings, shared by the server (lib/feed/api.js requires this file), the Feed
// view (public/js/feed.js) and the Settings > Feed page (public/js/setup.js). Two synced keys (lib/prefs-allowlist.js
// and its client twin public/js/prefs-sync.js carry both):
//   ft-feed-settings  a small JSON object: only the choices that differ from the defaults are written
//   ft-feed-fewer     a JSON array of "<type>:<name>" keys the Feed weighs at FEWER_WEIGHT (Fewer from, D11)
// Every value is checked against its allowed list; anything else reads as the default (never an error), so a junk or
// older value can never switch a kind off or serve something the viewer did not choose. Plain ES5: it ships on every
// shell (the SPA lazy-loads feed.js into whichever shell was cold-loaded) and runs in node unchanged.
(function (root) {
  'use strict';

  var SETTINGS_KEY = 'ft-feed-settings';
  var FEWER_KEY = 'ft-feed-fewer';
  // The Feed's kinds, in the Settings page's order. Watch later is its own switch: its videos and episodes follow it,
  // never the Videos / Podcasts switches (D2).
  var KINDS = ['video', 'podcast', 'book', 'watchlater', 'song'];
  var KIND_LABELS = { video: 'Videos', podcast: 'Podcasts', book: 'Books', watchlater: 'Watch later', song: 'Songs' };
  // D3 / D4: the kinds where "which items" and "where they start" mean something.
  var CHOICE_KINDS = ['video', 'podcast', 'book'];
  var WHICH = ['both', 'new', 'continue'];
  var WHERE = ['saved', 'start'];
  // D5: the lengths, in seconds; 0 = the whole chapter (a video; library audio follows the video reel).
  var VIDEO_REELS = [30, 60, 90, 120, 0];
  var PODCAST_SLICES = [60, 120, 240];
  // v1.383.0 (K5 = v1.382.0 D13): a song card plays a clip of this many seconds from a third in; 0 = the whole song
  var SONG_CLIPS = [30, 45, 60, 0];
  var DEFAULTS = { reel: 60, slice: 120, clip: 45 };
  // v1.383.0 (K6 = v1.382.0 D14): music under book cards plays from this station (a v1.378.0 station key: 's:lofi', 'favorites',
  // 'c:<id>' ...); '' = chosen for you (the first that exists of MUSIC_STATION_ORDER). Bounded in BYTES so the whole value stays
  // under SETTINGS_MAX_BYTES with every other field at its longest (the v1.382.0 gate's 593-byte CJK case): a longer key (a
  // genre name of 40+ CJK characters) reads as chosen for you
  var STATION_MAX = 120;
  var MUSIC_STATION_ORDER = ['s:chill', 's:lofi', 's:jazz', 'g:ambient', 'favorites'];
  var VIDEO_NO_CHAPTER_SEC = 120; // D5: "Whole chapter" on a video without chapters = 2 min
  var SETTINGS_MAX_BYTES = 512; // the synced pref's value cap (lib/prefs-allowlist.js PREF_VALUE_MAX_BYTES)
  // D11: Fewer from
  var FEWER_TYPES = ['channel', 'show', 'artist', 'author'];
  var FEWER_MAX = 200;
  var FEWER_NAME_MAX = 100;
  var FEWER_WEIGHT = 0.25;
  var FEWER_MAX_BYTES = 8192; // Dean's ruling 2026-10-10: this one key gets 8 KB (200 names), every other key stays 512

  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function pick(list, v, fallback) { return list.indexOf(v) !== -1 ? v : fallback; }
  function hasControl(s) { for (var i = 0; i < s.length; i++) { if (s.charCodeAt(i) < 32 || s.charCodeAt(i) === 127) return true; } return false; }

  // The full settings, every field present and valid, from any input (an object, a JSON string, junk).
  function normalize(raw) {
    var r = raw;
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch (_) { r = null; } }
    if (!r || typeof r !== 'object' || Array.isArray(r)) r = {};
    var off = [];
    if (Array.isArray(r.off)) {
      for (var i = 0; i < KINDS.length; i++) if (r.off.indexOf(KINDS[i]) !== -1) off.push(KINDS[i]);
    }
    if (off.length >= KINDS.length) off = []; // D2: at least one kind stays on; a value with every kind off reads as the default
    var which = {};
    var where = {};
    for (var j = 0; j < CHOICE_KINDS.length; j++) {
      var k = CHOICE_KINDS[j];
      which[k] = pick(WHICH, own(r.which, k) ? r.which[k] : null, 'both');
      // D4: kept as chosen even while the kind is New only (a new item always starts at the beginning, so it does nothing then;
      // the Settings page greys it) - switching back to Both finds the choice the viewer made (gate r1, qa suggestion 1)
      where[k] = pick(WHERE, own(r.where, k) ? r.where[k] : null, 'saved');
    }
    return {
      off: off,
      which: which,
      where: where,
      reel: pick(VIDEO_REELS, r.reel, DEFAULTS.reel),
      slice: pick(PODCAST_SLICES, r.slice, DEFAULTS.slice),
      clip: pick(SONG_CLIPS, r.clip, DEFAULTS.clip),
      // v1.383.0 (K1): a finished media card moves on to the next one by itself - on unless switched off (only false is off)
      advance: r.advance !== false,
      // v1.383.0 (K6): music while reading - on unless switched off; its station a plain short key, else chosen for you
      music: r.music !== false,
      station: typeof r.station === 'string' && utf8Bytes(r.station) <= STATION_MAX && !hasControl(r.station) ? r.station.trim() : '',
    };
  }

  // The stored form: only what differs from the defaults (so a new default reaches everyone who never chose).
  function serialize(settings) {
    var s = normalize(settings);
    var out = {};
    if (s.off.length) out.off = s.off.slice();
    CHOICE_KINDS.forEach(function (k) {
      if (s.which[k] !== 'both') { out.which = out.which || {}; out.which[k] = s.which[k]; }
      if (s.where[k] !== 'saved') { out.where = out.where || {}; out.where[k] = s.where[k]; }
    });
    ['reel', 'slice', 'clip'].forEach(function (f) { if (s[f] !== DEFAULTS[f]) out[f] = s[f]; });
    if (!s.advance) out.advance = false;
    if (!s.music) out.music = false;
    if (s.station) out.station = s.station;
    return JSON.stringify(out);
  }

  function isOn(settings, kind) { return normalize(settings).off.indexOf(kind) === -1; }

  // ---- Fewer from (D11) ----------------------------------------------------------------------------------------------
  // A key is "<type>:<name>" with the name as shown (trimmed); two keys are the same when their type and lower-cased
  // name agree. Returns '' for anything that is not a usable key.
  function fewerKey(type, name) {
    if (FEWER_TYPES.indexOf(type) === -1 || typeof name !== 'string') return '';
    var n = name.replace(/\s+/g, ' ').trim();
    if (!n || n.length > FEWER_NAME_MAX || hasControl(n)) return '';
    return type + ':' + n;
  }
  function fewerMatchKey(key) {
    var at = typeof key === 'string' ? key.indexOf(':') : -1;
    if (at < 1) return '';
    var k = fewerKey(key.slice(0, at), key.slice(at + 1));
    return k ? k.slice(0, at + 1) + k.slice(at + 1).toLowerCase() : '';
  }
  // The list, deduplicated (the newest of two spellings wins its place), at most FEWER_MAX (the oldest drop first).
  function parseFewer(raw) {
    var list = raw;
    if (typeof list === 'string') { try { list = JSON.parse(list); } catch (_) { list = null; } }
    if (!Array.isArray(list)) return [];
    var out = [];
    var seen = {};
    for (var i = list.length - 1; i >= 0; i--) {
      var m = fewerMatchKey(list[i]);
      if (!m || own(seen, m)) continue;
      seen[m] = true;
      var at = list[i].indexOf(':');
      out.unshift(fewerKey(list[i].slice(0, at), list[i].slice(at + 1)));
    }
    return out.length > FEWER_MAX ? out.slice(out.length - FEWER_MAX) : out;
  }
  function serializeFewer(list) {
    var l = parseFewer(list);
    var s = JSON.stringify(l);
    while (l.length && utf8Bytes(s) > FEWER_MAX_BYTES) { l.shift(); s = JSON.stringify(l); }
    return s;
  }
  function fewerAdd(list, key) {
    var l = parseFewer(list);
    var m = fewerMatchKey(key);
    if (!m) return l;
    l = l.filter(function (k) { return fewerMatchKey(k) !== m; });
    l.push(key.slice(0, key.indexOf(':') + 1) + key.slice(key.indexOf(':') + 1).replace(/\s+/g, ' ').trim());
    return parseFewer(l);
  }
  function fewerRemove(list, key) {
    var m = fewerMatchKey(key);
    return parseFewer(list).filter(function (k) { return fewerMatchKey(k) !== m; });
  }
  // A Set-like lookup of the match keys, for the server's weighing.
  function fewerSet(list) {
    var set = {};
    parseFewer(list).forEach(function (k) { set[fewerMatchKey(k)] = true; });
    return { has: function (type, name) { var m = fewerMatchKey(type + ':' + (typeof name === 'string' ? name : '')); return !!m && own(set, m); }, size: Object.keys(set).length };
  }
  function fewerLabel(key) {
    var at = typeof key === 'string' ? key.indexOf(':') : -1;
    return at > 0 ? key.slice(at + 1) : '';
  }

  function utf8Bytes(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  var api = {
    SETTINGS_KEY: SETTINGS_KEY, FEWER_KEY: FEWER_KEY, KINDS: KINDS, KIND_LABELS: KIND_LABELS, CHOICE_KINDS: CHOICE_KINDS,
    WHICH: WHICH, WHERE: WHERE, VIDEO_REELS: VIDEO_REELS, PODCAST_SLICES: PODCAST_SLICES, SONG_CLIPS: SONG_CLIPS,
    STATION_MAX: STATION_MAX, MUSIC_STATION_ORDER: MUSIC_STATION_ORDER,
    DEFAULTS: DEFAULTS, VIDEO_NO_CHAPTER_SEC: VIDEO_NO_CHAPTER_SEC, SETTINGS_MAX_BYTES: SETTINGS_MAX_BYTES,
    FEWER_TYPES: FEWER_TYPES, FEWER_MAX: FEWER_MAX, FEWER_NAME_MAX: FEWER_NAME_MAX, FEWER_WEIGHT: FEWER_WEIGHT, FEWER_MAX_BYTES: FEWER_MAX_BYTES,
    normalize: normalize, serialize: serialize, isOn: isOn,
    fewerKey: fewerKey, fewerMatchKey: fewerMatchKey, parseFewer: parseFewer, serializeFewer: serializeFewer, fewerAdd: fewerAdd,
    fewerRemove: fewerRemove, fewerSet: fewerSet, fewerLabel: fewerLabel, utf8Bytes: utf8Bytes,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.FileTubeFeedSettings = api;
})(typeof window !== 'undefined' ? window : null);
