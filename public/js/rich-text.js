'use strict';

// v1.394.0: the ONE renderer for untrusted text that may carry links and times - a video's
// description and a saved comment. Loaded as a browser script before watch.js in every shell
// that loads watch.js (the SPA swaps only #view-root), and required by the unit tests.
//
// The text is attacker-influenced (a downloaded file's tags, a stranger's comment), so the
// output is built from DOM nodes only - text nodes, <a> and <button> - and never reaches
// innerHTML. A link is made only from an `http://` or `https://` run that the URL parser
// accepts with that same protocol; every other scheme (javascript:, data:, vbscript:, ...)
// stays plain text because the scanner never starts a link anywhere but at "http".
//
// Rules decided here (plan W1):
// - A trailing `.,;:!?'"` (and `*`, `>`, `]`, `}`) is not part of a link; a trailing `)` is
//   dropped only while the link has more `)` than `(` (a Wikipedia link keeps its own).
// - A link longer than MAX_HREF stays text; the visible text of a long link is cut at
//   MAX_LINK_TEXT characters with an ellipsis (the href stays whole), never inside the host.
// - A time is `m:ss` (1-3 minute digits) or `h:mm:ss` (1-2 hour digits), not glued to a
//   letter, digit, `:`, `.` or `/` on either side. It becomes a seek chip only when it lies
//   within the media's duration; with no known duration there are no chips.
// - A clock time ("10:00 am", "7:30pm", "9:15 a.m.") is never a chip.
// Every scan is linear: the two regexes are a fixed prefix plus a single character class
// (no nested quantifiers), and the trims walk the match once.

(function () {
  var MAX_LINK_TEXT = 60;
  var MAX_HREF = 2048;
  // A case-insensitive "http" spelled out per letter: the `i` flag would let a non-ASCII
  // character that case-folds onto an ASCII one join the scheme.
  var URL_RE = /[hH][tT][tT][pP][sS]?:\/\/[^\s<>"\u007f]+/g; // \s covers the line breaks; the URL parser refuses other controls
  var TIME_RE = /(\d{1,3}):([0-5]\d)(?::([0-5]\d))?/g;
  var TRAIL_PUNCT = '.,;:!?\'"*>]}';

  // The protocol check. Returns the URL parser's own serialization (what the <a> gets) or null.
  function safeHref(raw) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_HREF) return null;
    var u;
    try { u = new URL(raw); } catch (_) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return u.href;
  }

  function trimUrl(s) {
    var end = s.length;
    var open = 0;
    var close = 0;
    for (var i = 0; i < end; i++) {
      var c = s.charCodeAt(i);
      if (c === 40) open++;
      else if (c === 41) close++;
    }
    while (end > 0) {
      var ch = s.charAt(end - 1);
      if (TRAIL_PUNCT.indexOf(ch) !== -1) { end--; continue; }
      if (ch === ')' && close > open) { end--; close--; continue; }
      break;
    }
    return s.slice(0, end);
  }

  // A long link's visible text is cut at MAX_LINK_TEXT, but never inside its host (gate r1,
  // security NOTE-2): "https://accounts.example.com.<long>.evil.test/" must show the real host
  // whole, so the cut lands at the end of the origin when the origin itself is long.
  function displayUrl(s) {
    if (s.length <= MAX_LINK_TEXT) return s;
    var hostStart = s.indexOf('//') + 2;
    var rest = s.slice(hostStart).search(/[/?#]/);
    var originEnd = rest === -1 ? s.length : hostStart + rest;
    var cut = Math.max(MAX_LINK_TEXT - 1, originEnd);
    return cut >= s.length ? s : s.slice(0, cut) + '\u2026';
  }

  function isGlue(ch) {
    return !!ch && /[A-Za-z0-9_:./]/.test(ch);
  }

  // "10:00 am", "7:30pm", "9:15 a.m." - what follows the time.
  function isClockSuffix(rest) {
    return /^ ?[aApP]\.?[mM](?![A-Za-z])/.test(rest);
  }

  function timeSegments(text, duration) {
    var out = [];
    var dur = typeof duration === 'number' && isFinite(duration) && duration > 0 ? duration : 0;
    if (!dur) return [{ type: 'text', text: text }];
    var last = 0;
    var m;
    TIME_RE.lastIndex = 0;
    while ((m = TIME_RE.exec(text)) !== null) {
      var start = m.index;
      var end = start + m[0].length;
      var before = start > 0 ? text.charAt(start - 1) : '';
      var after = end < text.length ? text.charAt(end) : '';
      if (isGlue(before) || /[0-9:]/.test(after) || (after === '.' && /[0-9]/.test(text.charAt(end + 1)))) continue;
      if (/[A-Za-z_]/.test(after) || isClockSuffix(text.slice(end))) continue;
      var sec;
      if (m[3] !== undefined) {
        if (m[1].length > 2) continue;
        sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      } else {
        sec = Number(m[1]) * 60 + Number(m[2]);
      }
      if (sec > dur) continue;
      if (start > last) out.push({ type: 'text', text: text.slice(last, start) });
      out.push({ type: 'time', text: m[0], sec: sec });
      last = end;
    }
    if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
    return out;
  }

  // Pure: untrusted text -> [{type:'text',text} | {type:'link',href,text} | {type:'time',sec,text}].
  // opts.duration (seconds) enables time chips.
  function tokenize(text, opts) {
    var o = opts || {};
    var s = typeof text === 'string' ? text : '';
    var out = [];
    var push = function (segs) { for (var i = 0; i < segs.length; i++) { if (segs[i].text) out.push(segs[i]); } };
    var last = 0;
    var m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(s)) !== null) {
      var start = m.index;
      // "xhttp://" or "blob:https://" is not a link start (a scheme glued to a word or a scheme).
      if (start > 0 && /[A-Za-z0-9:]/.test(s.charAt(start - 1))) continue;
      var raw = trimUrl(m[0]);
      var href = safeHref(raw);
      if (!href) continue;
      if (start > last) push(timeSegments(s.slice(last, start), o.duration));
      out.push({ type: 'link', href: href, text: displayUrl(raw) });
      last = start + raw.length;
      URL_RE.lastIndex = last;
    }
    if (last < s.length) push(timeSegments(s.slice(last), o.duration));
    return out;
  }

  function formatTime(sec) {
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var ss = Math.floor(sec % 60);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return h > 0 ? h + ':' + pad(m) + ':' + pad(ss) : m + ':' + pad(ss);
  }

  // Untrusted text -> a DocumentFragment of text nodes, links and seek chips.
  // opts: { doc, duration, onSeek(sec) }. Without onSeek no chips are made.
  function render(text, opts) {
    var o = opts || {};
    var doc = o.doc || (typeof document !== 'undefined' ? document : null);
    var frag = doc.createDocumentFragment();
    var segs = tokenize(text, { duration: typeof o.onSeek === 'function' ? o.duration : 0 });
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      if (seg.type === 'link') {
        var a = doc.createElement('a');
        a.className = 'rich-text__link';
        a.setAttribute('href', seg.href);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        a.textContent = seg.text;
        frag.appendChild(a);
      } else if (seg.type === 'time') {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'ui-link rich-text__time';
        b.setAttribute('data-seek', String(seg.sec));
        b.setAttribute('aria-label', 'Jump to ' + formatTime(seg.sec));
        b.textContent = seg.text;
        b.addEventListener('click', (function (sec) { return function (e) { e.preventDefault(); o.onSeek(sec); }; })(seg.sec));
        frag.appendChild(b);
      } else {
        frag.appendChild(doc.createTextNode(seg.text));
      }
    }
    return frag;
  }

  var api = { tokenize: tokenize, render: render, safeHref: safeHref, MAX_LINK_TEXT: MAX_LINK_TEXT, MAX_HREF: MAX_HREF };
  if (typeof window !== 'undefined') window.FileTubeRichText = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
