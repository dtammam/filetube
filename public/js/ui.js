'use strict';

// The UI primitives' DOM builders (UI professionalism pass, plan D4 / D6 / D9).
// public/css/ui.css styles exactly the classes built here; the DOM contract is
// pinned by test/unit/ui-builders.test.js.
//
// Rules this file keeps (the source lock in the test enforces the first two):
// - JS never sets a visual style inline. It toggles classes, `hidden`, aria-*
//   and data-*. The ONLY inline writes are CSS custom properties that carry
//   DATA the stylesheet consumes, through el.style.setProperty('--name', v):
//     --p          ui.thumb: the progress bar's fraction, 0..1
//     --ui-anchor-x, --ui-anchor-y
//                  ui.sheet popover: the anchor's left / bottom edge, px
//                  (from anchor.getBoundingClientRect())
//     --ui-drag    ui.sheet bottom: the downward drag offset while dragging, px
// - DOM is built with createElement / createElementNS / textContent. Labels and
//   titles can be user data, so no markup string ever carries them.
// - Every builder takes `doc` in its options (default: the global document) so
//   jsdom tests pass their own; overlays also take `win` (default: doc's window).
//
// Loaded as a classic script (sets window.ui) and require()-able for tests,
// the same dual pattern as icons.js and body-scroll-lock.js.
(function () {
  var hasWindow = typeof window !== 'undefined';

  function docOf(o) {
    if (o && o.doc) return o.doc;
    if (typeof document !== 'undefined') return document;
    throw new Error('ui: no document (pass {doc})');
  }
  function winOf(o, doc) {
    if (o && o.win) return o.win;
    if (doc && doc.defaultView) return doc.defaultView;
    return hasWindow ? window : null;
  }

  // The icon registry: the page's FTIcons, else (Node) the sibling module.
  function registry() {
    if (hasWindow && window.FTIcons) return window.FTIcons;
    if (typeof module !== 'undefined' && module.require) {
      try { return module.require('./icons.js'); } catch (_) { return null; }
    }
    return null;
  }

  function nextFrame(win, fn) {
    if (win && typeof win.requestAnimationFrame === 'function') return win.requestAnimationFrame(fn);
    return setTimeout(fn, 16);
  }

  var uid = 0;
  function newId(prefix) { uid += 1; return prefix + '-' + uid; }

  function el(doc, tag, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }
  function spanText(doc, cls, text) {
    var n = el(doc, 'span', cls);
    n.textContent = text == null ? '' : String(text);
    return n;
  }
  // A string becomes text; a Node is appended as is.
  function fill(doc, host, v) {
    if (v == null) return host;
    if (typeof v === 'object' && v.nodeType) host.appendChild(v);
    else host.textContent = String(v);
    return host;
  }
  function oneOf(v, allowed, dflt) { return allowed.indexOf(v) !== -1 ? v : dflt; }

  // ---------------------------------------------------------------- icon
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function iconHref(name) { return '#i-' + String(name).replace(/\./g, '-'); }

  // F39: an unknown name must fail loudly, never paint a blank glyph.
  function checkIcon(name) {
    var reg = registry();
    if (reg && typeof reg.has === 'function' && !reg.has(name)) {
      throw new Error('ui.icon: unknown icon "' + name + '"');
    }
  }

  function icon(name, o) {
    o = o || {};
    var doc = docOf(o);
    checkIcon(name);
    var size = oneOf(o.size, ['sm', 'md', 'lg'], 'md');
    var svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'ui-icon ui-icon--' + size + (o.cls ? ' ' + o.cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var use = doc.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', iconHref(name));
    svg.appendChild(use);
    return svg;
  }

  // ---------------------------------------------------------------- button
  var BTN_VARIANTS = ['primary', 'secondary', 'tonal', 'plain', 'danger'];
  var SIZES = ['sm', 'md', 'lg'];

  function button(o) {
    o = o || {};
    var doc = docOf(o);
    var variant = oneOf(o.variant, BTN_VARIANTS, 'secondary');
    var size = oneOf(o.size, SIZES, 'md');
    var shape = oneOf(o.shape, ['icon', 'stack'], null);
    if (shape === 'icon' && !o.ariaLabel) throw new Error('ui.button: an icon-only button needs ariaLabel');
    var toggle = typeof o.pressed === 'boolean' || Array.isArray(o.labels);
    var pressed = o.pressed === true;

    var b = el(doc, 'button', 'ui-btn ui-btn--' + variant + ' ui-btn--' + size +
      (o.pill ? ' ui-btn--pill' : '') + (shape ? ' ui-btn--' + shape : ''));
    b.setAttribute('type', o.type || 'button');
    if (o.ariaLabel) b.setAttribute('aria-label', o.ariaLabel);
    if (toggle) b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    if (o.disabled) b.disabled = true;

    if (o.icon) {
      var iconSize = size === 'sm' ? 'sm' : (shape === 'stack' ? 'lg' : 'md');
      var name = o.icon;
      if (typeof o.icon === 'object') {
        b.setAttribute('data-icon-off', o.icon.off);
        b.setAttribute('data-icon-on', o.icon.on);
        name = pressed ? o.icon.on : o.icon.off;
        checkIcon(pressed ? o.icon.off : o.icon.on); // the swap target must exist too
      }
      var slot = el(doc, 'span', 'ui-btn__icon');
      slot.appendChild(icon(name, { size: iconSize, doc: doc }));
      b.appendChild(slot);
    }

    if (shape !== 'icon') {
      if (Array.isArray(o.labels)) {
        var cur = o.labels[pressed ? 1 : 0];
        var stack = el(doc, 'span', 'ui-btn__label ui-btn__stack');
        stack.setAttribute('data-label', cur);
        o.labels.slice(0, 2).forEach(function (text, i) {
          var s = spanText(doc, 'ui-btn__slot', text);
          if (i !== (pressed ? 1 : 0)) s.setAttribute('data-idle', '');
          stack.appendChild(s);
        });
        b.appendChild(stack);
      } else if (o.label != null && o.label !== '') {
        b.appendChild(spanText(doc, 'ui-btn__label', o.label));
      }
    }
    if (typeof o.onClick === 'function') b.addEventListener('click', o.onClick);
    return b;
  }

  function setPressed(btn, on) {
    on = !!on;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    var stack = btn.querySelector('.ui-btn__stack');
    if (stack) {
      var slots = stack.querySelectorAll('.ui-btn__slot');
      var idx = on ? 1 : 0;
      for (var i = 0; i < slots.length; i++) {
        if (i === idx) slots[i].removeAttribute('data-idle');
        else slots[i].setAttribute('data-idle', '');
      }
      if (slots[idx]) stack.setAttribute('data-label', slots[idx].textContent);
    }
    var name = btn.getAttribute(on ? 'data-icon-on' : 'data-icon-off');
    var use = btn.querySelector('.ui-btn__icon use');
    if (name && use) use.setAttribute('href', iconHref(name));
  }

  function setBusy(btn, busy) {
    if (busy) btn.setAttribute('aria-busy', 'true');
    else btn.removeAttribute('aria-busy');
  }

  // ---------------------------------------------------------------- list / row
  var ROW_SIZES = ['compact', 'default', 'media'];

  function list(o) {
    o = o || {};
    var doc = docOf(o);
    var size = oneOf(o.size, ROW_SIZES, 'default');
    var media = oneOf(o.media, ['none', 'avatar', 'art', 'thumb'], 'none');
    var aside = oneOf(o.aside, ['none', 'thumb', 'text'], 'none');
    var actions = oneOf(Number(o.actions) || 0, [0, 1, 2, 3], 0);
    var divider = oneOf(o.divider, ['inset', 'full', 'none'], 'inset');
    var l = el(doc, 'div', 'ui-list ui-list--' + size + ' ui-list--media-' + media +
      ' ui-list--aside-' + aside + ' ui-list--actions-' + actions + ' ui-list--divider-' + divider +
      (o.grouped ? ' ui-list--grouped' : ''));
    l.setAttribute('role', 'list');
    if (o.label) l.setAttribute('aria-label', o.label);
    return l;
  }

  function row(o) {
    o = o || {};
    var doc = docOf(o);
    if (o.title == null || o.title === '') throw new Error('ui.row: title is required');
    var size = oneOf(o.size, ROW_SIZES, 'default');
    var actions = Array.isArray(o.actions) ? o.actions : [];
    var nav = o.href ? 'a' : (typeof o.onClick === 'function' ? 'button' : null);
    // A button cannot contain buttons: a row with actions is a div and its title
    // carries the link (CSS stretches it over the row).
    var tag = actions.length ? 'div' : (nav || 'div');

    var r = el(doc, tag, 'ui-row ui-row--' + size + (o.danger ? ' ui-row--danger' : ''));
    r.setAttribute('role', 'listitem');
    if (tag === 'a') r.setAttribute('href', o.href);
    if (tag === 'button') r.setAttribute('type', 'button');
    if (tag !== 'div' && typeof o.onClick === 'function') r.addEventListener('click', o.onClick);
    if (o.disabled && tag === 'button') r.disabled = true;

    var lead = el(doc, 'span', 'ui-row__lead');
    if (o.lead === 'dot') lead.appendChild(el(doc, 'span', 'ui-row__dot'));
    r.appendChild(lead);

    var media = el(doc, 'span', 'ui-row__media');
    if (o.media) media.appendChild(o.media);
    r.appendChild(media);

    var body = el(doc, 'span', 'ui-row__body');
    if (o.overline != null && o.overline !== '') body.appendChild(spanText(doc, 'ui-row__overline', o.overline));
    var title = el(doc, 'span', 'ui-row__title');
    if (tag === 'div' && nav) {
      var link = el(doc, nav, 'ui-row__link');
      if (nav === 'a') link.setAttribute('href', o.href);
      else link.setAttribute('type', 'button');
      if (typeof o.onClick === 'function') link.addEventListener('click', o.onClick);
      fill(doc, link, o.title);
      title.appendChild(link);
    } else {
      fill(doc, title, o.title);
    }
    body.appendChild(title);
    if (o.meta != null && o.meta !== '') body.appendChild(fill(doc, el(doc, 'span', 'ui-row__meta'), o.meta));
    r.appendChild(body);

    r.appendChild(fill(doc, el(doc, 'span', 'ui-row__aside'), o.aside));

    var acts = el(doc, 'span', 'ui-row__actions');
    actions.forEach(function (a) {
      if (a) { acts.appendChild(a); return; }
      var s = el(doc, 'span', 'ui-row__slot');
      s.setAttribute('aria-hidden', 'true');
      acts.appendChild(s);
    });
    r.appendChild(acts);
    return r;
  }

  // ---------------------------------------------------------------- avatar / thumb
  function initials(name) {
    var words = String(name == null ? '' : name).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    return words.slice(0, 2).map(function (w) { return Array.from(w)[0]; }).join('').toUpperCase();
  }
  // A stable string hash (djb2) -> one of the 8 monogram tones.
  function toneOf(name) {
    var s = String(name == null ? '' : name);
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return (h % 8) + 1;
  }
  function monogram(doc, name) {
    var m = spanText(doc, 'ui-avatar__mono', initials(name));
    m.setAttribute('data-tone', String(toneOf(name)));
    return m;
  }

  function avatar(o) {
    o = o || {};
    var doc = docOf(o);
    var kind = oneOf(o.kind, ['channel', 'person', 'podcast', 'album', 'book'], 'channel');
    var size = oneOf(o.size, ['xs', 'sm', 'md', 'lg', 'xl', '2xl'], 'md');
    var art = kind === 'podcast' || kind === 'album' || kind === 'book';
    var a = el(doc, 'span', (art ? 'ui-art' : 'ui-avatar') + ' ui-avatar--' + size);
    if (o.url) {
      var img = el(doc, 'img', 'ui-avatar__img');
      img.setAttribute('alt', '');
      img.setAttribute('decoding', 'async');
      img.setAttribute('loading', 'lazy');
      // Never a broken image and never the logo: a failed load becomes the monogram.
      img.addEventListener('error', function () {
        if (img.parentNode) img.parentNode.removeChild(img);
        if (!a.querySelector('.ui-avatar__mono')) a.appendChild(monogram(doc, o.name));
      });
      img.setAttribute('src', o.url);
      a.appendChild(img);
    } else {
      a.appendChild(monogram(doc, o.name));
    }
    return a;
  }

  function formatDuration(sec) {
    var t = Math.floor(Number(sec) || 0);
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    var ss = (s < 10 ? '0' : '') + s;
    if (h > 0) return h + ':' + (m < 10 ? '0' : '') + m + ':' + ss;
    return m + ':' + ss;
  }

  function thumb(o) {
    o = o || {};
    var doc = docOf(o);
    var aspect = oneOf(o.aspect, ['16x9', '1x1', '2x3'], '16x9');
    var context = oneOf(o.context, ['card', 'row'], 'card');
    var t = el(doc, 'div', 'ui-thumb ui-thumb--' + aspect + ' ui-thumb--' + context);
    if (o.src) {
      var img = el(doc, 'img', 'ui-thumb__img');
      img.setAttribute('alt', o.alt || '');
      img.setAttribute('decoding', 'async');
      img.setAttribute('loading', 'lazy');
      // The placeholder ground stays at its final size; the broken image goes.
      img.addEventListener('error', function () { if (img.parentNode) img.parentNode.removeChild(img); });
      img.setAttribute('src', o.src);
      t.appendChild(img);
    }
    if (Number(o.duration) > 0) t.appendChild(spanText(doc, 'ui-thumb__duration', formatDuration(o.duration)));
    if (Number(o.progress) > 0) {
      var p = Math.min(1, Math.max(0, Number(o.progress)));
      var track = el(doc, 'span', 'ui-thumb__progress');
      var bar = el(doc, 'span', 'ui-thumb__bar');
      bar.style.setProperty('--p', String(p));
      track.appendChild(bar);
      t.appendChild(track);
    }
    return t;
  }

  // ---------------------------------------------------------------- chip
  function chip(o) {
    o = o || {};
    var doc = docOf(o);
    var kind = oneOf(o.kind, ['filter', 'meta', 'count'], 'meta');
    var c;
    if (kind === 'filter') {
      c = el(doc, 'button', 'ui-chip ui-chip--filter');
      c.setAttribute('type', 'button');
      c.setAttribute('aria-pressed', o.selected ? 'true' : 'false');
      if (typeof o.onClick === 'function') c.addEventListener('click', o.onClick);
    } else {
      c = el(doc, 'span', 'ui-chip ui-chip--' + kind);
    }
    c.textContent = o.label == null ? '' : String(o.label);
    if (kind === 'count' && !(Number(o.label) > 0)) c.hidden = true;
    return c;
  }

  // ---------------------------------------------------------------- sheet
  var openStack = []; // open controllers, topmost last (Esc closes only the top one)
  var lockSeq = 0;

  function sheetFallbackMs(win, node) {
    try {
      var v = win.getComputedStyle(node).getPropertyValue('--dur-sheet').trim();
      var n = parseFloat(v);
      if (!isNaN(n) && n >= 0) return (/ms$/.test(v) ? n : n * 1000) + 40;
    } catch (_) {}
    return 320;
  }

  function resolveVariant(v, anchor, win) {
    if (v !== 'auto') return oneOf(v, ['bottom', 'popover', 'dialog', 'panel'], 'dialog');
    var phone = false;
    try { phone = !!(win && win.matchMedia && win.matchMedia('(max-width: 768px)').matches); } catch (_) {}
    if (phone) return 'bottom';
    return anchor ? 'popover' : 'dialog';
  }

  function sheet(o) {
    o = o || {};
    var doc = docOf(o);
    var win = winOf(o, doc);
    var requested = o.variant || 'dialog';
    var variant = resolveVariant(requested, o.anchor, win);
    var lockOwner = 'ui-sheet:' + (++lockSeq);

    var scrim = el(doc, 'div', 'ui-scrim');
    var s = el(doc, 'div', 'ui-sheet');
    s.setAttribute('role', 'dialog');
    s.setAttribute('aria-modal', 'true');
    var grab = el(doc, 'div', 'ui-sheet__grab');
    var header = el(doc, 'div', 'ui-sheet__header');
    if (o.title) {
      var h = el(doc, 'h2', 'ui-sheet__title');
      h.id = newId('ui-sheet-title');
      h.textContent = String(o.title);
      header.appendChild(h);
      s.setAttribute('aria-labelledby', h.id);
    } else {
      s.setAttribute('aria-label', o.label || 'Dialog');
    }
    var closeBtn = button({ variant: 'plain', shape: 'icon', icon: 'close', ariaLabel: 'Close', doc: doc });
    closeBtn.classList.add('ui-sheet__close');
    header.appendChild(closeBtn);
    var body = el(doc, 'div', 'ui-sheet__body');
    if (o.content) body.appendChild(o.content);
    s.appendChild(header);
    s.appendChild(body);

    function applyVariant(v) {
      variant = v;
      s.className = 'ui-sheet ui-sheet--' + v + (state === 'open' ? ' is-open' : '');
      scrim.className = 'ui-scrim' + (v === 'popover' ? ' ui-scrim--clear' : '');
      if (v === 'bottom' && grab.parentNode !== s) s.insertBefore(grab, s.firstChild);
      if (v !== 'bottom' && grab.parentNode === s) s.removeChild(grab);
    }

    var state = 'closed'; // closed | open | closing
    var opener = null;
    var closeTimer = null;
    var onEnd = null;
    applyVariant(variant);

    function lockApi() { return (win && win.FileTubeBodyLock) || (hasWindow && window.FileTubeBodyLock) || null; }

    function onKey(e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (openStack[openStack.length - 1] !== ctrl) return;
      e.preventDefault();
      close();
    }

    function finish() {
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
      if (onEnd) { s.removeEventListener('transitionend', onEnd); onEnd = null; }
      if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
      if (s.parentNode) s.parentNode.removeChild(s);
      s.style.removeProperty('--ui-drag');
      var bl = lockApi();
      if (bl) bl.release(doc, win, lockOwner);
      state = 'closed';
      var back = opener; opener = null;
      if (back && typeof back.focus === 'function' && back.isConnected !== false) {
        try { back.focus(); } catch (_) {}
      }
      if (typeof o.onClose === 'function') o.onClose();
    }

    function open() {
      if (o.signal && o.signal.aborted) return ctrl; // its owner is gone: never open
      if (state === 'open') return ctrl;
      if (state === 'closing') {
        // Re-opened mid-exit: keep the nodes and the lock, cancel the removal.
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        if (onEnd) { s.removeEventListener('transitionend', onEnd); onEnd = null; }
        state = 'open';
        openStack.push(ctrl);
        doc.addEventListener('keydown', onKey);
        s.classList.add('is-open');
        scrim.classList.add('is-open');
        return ctrl;
      }
      applyVariant(resolveVariant(requested, o.anchor, win));
      opener = doc.activeElement || null;
      if (variant === 'popover' && o.anchor && o.anchor.getBoundingClientRect) {
        var rect = o.anchor.getBoundingClientRect();
        s.style.setProperty('--ui-anchor-x', rect.left + 'px');
        s.style.setProperty('--ui-anchor-y', rect.bottom + 'px');
      }
      doc.body.appendChild(scrim);
      doc.body.appendChild(s);
      var bl = lockApi();
      if (bl) bl.lock(doc, win, lockOwner);
      state = 'open';
      openStack.push(ctrl);
      doc.addEventListener('keydown', onKey);
      // ALWAYS, reduced motion included (F48): the CSS makes that an opacity-only change.
      nextFrame(win, function () {
        if (state !== 'open') return;
        s.classList.add('is-open');
        scrim.classList.add('is-open');
      });
      // Focus moves INTO the sheet: to `initialFocus` (a prompt's field), else the sheet
      // itself - not its first control, which would open every sheet with a focus ring on
      // Close (the kit render). Tab then reaches Close first.
      var target = (o.initialFocus && s.contains(o.initialFocus)) ? o.initialFocus : s;
      if (target === s) s.setAttribute('tabindex', '-1');
      try { target.focus(); } catch (_) {}
      return ctrl;
    }

    function close() {
      if (state !== 'open') return ctrl;
      state = 'closing';
      // The decision is made now; the exit animation is only the look.
      if (typeof o.onClosing === 'function') o.onClosing();
      var i = openStack.indexOf(ctrl);
      if (i !== -1) openStack.splice(i, 1);
      doc.removeEventListener('keydown', onKey);
      s.classList.remove('is-open', 'is-dragging');
      scrim.classList.remove('is-open');
      onEnd = function (e) { if (e.target === s) finish(); };
      s.addEventListener('transitionend', onEnd);
      closeTimer = setTimeout(finish, sheetFallbackMs(win, s));
      return ctrl;
    }

    function setContent(node) {
      while (body.firstChild) body.removeChild(body.firstChild);
      if (node) body.appendChild(node);
      return ctrl;
    }

    closeBtn.addEventListener('click', function () { close(); });
    scrim.addEventListener('click', function () { close(); });
    // `signal` (an AbortSignal, e.g. a view's): its abort closes the sheet, so an SPA nav away
    // never strands an overlay on <body> over the next view. A confirm/prompt resolves as a
    // dismissal (false / null) through onClosing.
    if (o.signal && typeof o.signal.addEventListener === 'function') {
      o.signal.addEventListener('abort', function () { close(); }, { once: true });
    }

    // Bottom sheets: drag down on the grab handle or header to dismiss.
    var drag = null;
    function dragStart(e) {
      if (variant !== 'bottom' || state !== 'open') return;
      if (e.target && e.target.closest && e.target.closest('.ui-sheet__close')) return;
      drag = { y: Number(e.clientY) || 0, dy: 0 };
      s.classList.add('is-dragging');
      doc.addEventListener('pointermove', dragMove);
      doc.addEventListener('pointerup', dragEnd);
      doc.addEventListener('pointercancel', dragEnd);
    }
    function dragMove(e) {
      if (!drag) return;
      drag.dy = Math.max(0, (Number(e.clientY) || 0) - drag.y);
      s.style.setProperty('--ui-drag', drag.dy + 'px');
    }
    function dragEnd() {
      if (!drag) return;
      var dy = drag.dy;
      drag = null;
      doc.removeEventListener('pointermove', dragMove);
      doc.removeEventListener('pointerup', dragEnd);
      doc.removeEventListener('pointercancel', dragEnd);
      s.classList.remove('is-dragging');
      var hgt = s.getBoundingClientRect ? s.getBoundingClientRect().height : 0;
      if (dy > 0 && dy > hgt * 0.3) { close(); return; }
      s.style.removeProperty('--ui-drag');
    }
    [grab, header].forEach(function (n) { n.addEventListener('pointerdown', dragStart); });

    var ctrl = {
      el: s, scrim: scrim, body: body,
      open: open, close: close, setContent: setContent,
      isOpen: function () { return state === 'open'; },
    };
    return ctrl;
  }

  // ---------------------------------------------------------------- menu
  function menu(o) {
    o = o || {};
    var doc = docOf(o);
    var items = Array.isArray(o.items) ? o.items : [];
    var withIcons = items.some(function (it) { return it && it.icon; });
    var l = list({ size: 'compact', media: withIcons ? 'avatar' : 'none', aside: 'text', label: o.title || o.label, doc: doc });
    var ctrl = sheet({ variant: o.variant || 'auto', title: o.title, label: o.label || 'Menu', anchor: o.anchor, content: l, onClose: o.onClose, signal: o.signal, doc: doc, win: o.win });
    items.forEach(function (it) {
      if (!it) return;
      var r = row({
        size: 'compact',
        media: it.icon ? icon(it.icon, { doc: doc }) : null,
        title: it.label,
        aside: it.checked ? icon('check', { doc: doc }) : null,
        danger: !!it.danger,
        disabled: !!it.disabled,
        doc: doc,
        onClick: function () {
          ctrl.close();
          if (typeof it.onSelect === 'function') it.onSelect(it.value);
          if (typeof o.onSelect === 'function') o.onSelect(it.value);
        },
      });
      if (it.checked) r.setAttribute('aria-current', 'true');
      l.appendChild(r);
    });
    return ctrl.open();
  }

  // ---------------------------------------------------------------- toast
  var TOAST_EXIT_MS = 220;
  var toastQueues = new WeakMap(); // per document: { queue, current }
  function toastState(doc) {
    var st = toastQueues.get(doc);
    if (!st) { st = { queue: [], current: null }; toastQueues.set(doc, st); }
    return st;
  }
  function toastHost(doc) {
    var host = doc.querySelector('.ui-toast-host');
    if (!host) {
      host = el(doc, 'div', 'ui-toast-host');
      host.setAttribute('aria-live', 'polite');
      doc.body.appendChild(host);
    }
    return host;
  }

  function toast(message, o) {
    o = o || {};
    var doc = docOf(o);
    var win = winOf(o, doc);
    var kind = oneOf(o.kind, ['neutral', 'success', 'error'], 'neutral');
    var st = toastState(doc);
    var t = el(doc, 'div', 'ui-toast ui-toast--' + kind);
    if (kind === 'success') t.appendChild(icon('check', { doc: doc }));
    if (kind === 'error') t.appendChild(icon('warning', { doc: doc }));
    t.appendChild(spanText(doc, 'ui-toast__text', message));
    var entry = { el: t, done: false, timer: null };
    if (o.action && o.action.label) {
      var a = button({ variant: 'plain', size: 'sm', label: o.action.label, doc: doc });
      a.classList.add('ui-toast__action');
      a.addEventListener('click', function () {
        if (typeof o.action.onAction === 'function') o.action.onAction();
        dismiss();
      });
      t.appendChild(a);
    }
    var duration = typeof o.duration === 'number' ? o.duration : (o.action ? 5000 : 2500);

    function showNext() {
      st.current = null;
      var next = st.queue.shift();
      if (next) next.show();
    }
    entry.show = function () {
      st.current = entry;
      toastHost(doc).appendChild(t);
      nextFrame(win, function () { if (!entry.done) t.classList.add('is-visible'); });
      entry.timer = setTimeout(dismiss, duration);
    };
    function dismiss() {
      if (entry.done) return;
      entry.done = true;
      if (entry.timer) clearTimeout(entry.timer);
      var qi = st.queue.indexOf(entry);
      if (qi !== -1) { st.queue.splice(qi, 1); return; } // never shown
      t.classList.remove('is-visible');
      var gone = false;
      function remove() {
        if (gone) return;
        gone = true;
        t.removeEventListener('transitionend', onEnd);
        if (t.parentNode) t.parentNode.removeChild(t);
        if (st.current === entry) showNext();
      }
      function onEnd(e) { if (e.target === t) remove(); }
      t.addEventListener('transitionend', onEnd);
      setTimeout(remove, TOAST_EXIT_MS);
    }

    if (st.current) st.queue.push(entry);
    else entry.show();
    return { dismiss: dismiss, el: t };
  }

  // ---------------------------------------------------------------- confirm / prompt
  function actionsRow(doc, cancelLabel, confirmLabel, danger) {
    var row = el(doc, 'div', 'ui-confirm__actions');
    var cancel = button({ variant: 'secondary', label: cancelLabel, doc: doc });
    var ok = button({ variant: 'primary', label: confirmLabel, doc: doc });
    if (danger) ok.classList.add('ui-btn--destructive');
    row.appendChild(cancel);
    row.appendChild(ok);
    return { row: row, cancel: cancel, ok: ok };
  }

  function confirm(o) {
    o = o || {};
    var doc = docOf(o);
    return new Promise(function (resolve) {
      var settled = false;
      function settle(v) { if (!settled) { settled = true; resolve(v); } }
      if (o.signal && o.signal.aborted) { settle(false); return; }
      var content = doc.createDocumentFragment();
      if (o.body) { var p = el(doc, 'p', 'ui-confirm__body'); p.textContent = String(o.body); content.appendChild(p); }
      var acts = actionsRow(doc, o.cancelLabel || 'Cancel', o.confirmLabel || 'OK', !!o.danger);
      content.appendChild(acts.row);
      var ctrl = sheet({ variant: 'dialog', title: o.title, label: o.title ? null : 'Confirm', content: content,
        onClosing: function () { settle(false); }, signal: o.signal, doc: doc, win: o.win });
      // Only a click on a LIVE dialog answers: a confirm tapped while the sheet
      // animates out (after Esc, the scrim, Close) must not flip a cancel to true.
      acts.cancel.addEventListener('click', function () { if (ctrl.isOpen()) { settle(false); ctrl.close(); } });
      acts.ok.addEventListener('click', function () { if (ctrl.isOpen()) { settle(true); ctrl.close(); } });
      ctrl.open();
    });
  }

  function prompt(o) {
    o = o || {};
    var doc = docOf(o);
    var type = o.type === 'password' ? 'password' : 'text';
    return new Promise(function (resolve) {
      var settled = false;
      function settle(v) { if (!settled) { settled = true; resolve(v); } }
      var content = doc.createDocumentFragment();
      if (o.body) { var p = el(doc, 'p', 'ui-confirm__body'); p.textContent = String(o.body); content.appendChild(p); }
      var f = field({ label: o.label || '', type: type, value: o.value, doc: doc });
      if (type === 'password') {
        var reveal = button({ variant: 'plain', shape: 'icon', icon: { off: 'visibility', on: 'visibility_off' },
          pressed: false, ariaLabel: 'Show password', doc: doc });
        reveal.classList.add('ui-field__reveal');
        reveal.addEventListener('click', function () {
          var show = reveal.getAttribute('aria-pressed') !== 'true';
          setPressed(reveal, show);
          f.input.setAttribute('type', show ? 'text' : 'password');
        });
        f.el.appendChild(reveal);
      }
      content.appendChild(f.el);
      var acts = actionsRow(doc, o.cancelLabel || 'Cancel', o.confirmLabel || 'OK', !!o.danger);
      content.appendChild(acts.row);
      var ctrl = sheet({ variant: 'dialog', title: o.title, label: o.title ? null : (o.label || 'Prompt'), content: content,
        initialFocus: f.input, onClosing: function () { settle(null); }, doc: doc, win: o.win });
      function submit() { if (ctrl.isOpen()) { settle(f.input.value); ctrl.close(); } }
      acts.cancel.addEventListener('click', function () { if (ctrl.isOpen()) { settle(null); ctrl.close(); } });
      acts.ok.addEventListener('click', submit);
      f.input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); }
      });
      ctrl.open();
    });
  }

  // ---------------------------------------------------------------- forms
  function uiSwitch(o) {
    o = o || {};
    var doc = docOf(o);
    var b = el(doc, 'button', 'ui-switch');
    b.setAttribute('type', 'button');
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', o.checked ? 'true' : 'false');
    if (o.label) b.setAttribute('aria-label', o.label);
    if (o.disabled) b.disabled = true;
    b.addEventListener('click', function () {
      var next = b.getAttribute('aria-checked') !== 'true';
      b.setAttribute('aria-checked', next ? 'true' : 'false');
      if (typeof o.onChange === 'function') o.onChange(next);
    });
    return b;
  }

  function segmented(o) {
    o = o || {};
    var doc = docOf(o);
    var opts = Array.isArray(o.options) ? o.options : [];
    var g = el(doc, 'div', 'ui-segmented');
    g.setAttribute('role', 'radiogroup');
    if (o.label) g.setAttribute('aria-label', o.label);
    var items = [];
    var cur = opts.some(function (x) { return x.value === o.value; }) ? o.value : (opts[0] && opts[0].value);
    function select(idx, focus) {
      var v = opts[idx].value;
      var changed = v !== cur;
      cur = v;
      items.forEach(function (b, i) {
        b.setAttribute('aria-checked', i === idx ? 'true' : 'false');
        b.setAttribute('tabindex', i === idx ? '0' : '-1');
      });
      if (focus) items[idx].focus();
      if (changed && typeof o.onChange === 'function') o.onChange(v);
    }
    opts.forEach(function (opt, i) {
      var b = el(doc, 'button', 'ui-segmented__item');
      b.setAttribute('type', 'button');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', opt.value === cur ? 'true' : 'false');
      b.setAttribute('tabindex', opt.value === cur ? '0' : '-1');
      b.setAttribute('data-value', String(opt.value));
      b.textContent = opt.label == null ? String(opt.value) : String(opt.label);
      b.addEventListener('click', function () { select(i, false); });
      b.addEventListener('keydown', function (e) {
        var n = items.length;
        var to = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % n;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + n) % n;
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = n - 1;
        if (to === null) return;
        e.preventDefault();
        select(to, true);
      });
      items.push(b);
      g.appendChild(b);
    });
    return g;
  }

  function fieldLabel(doc, text, id) {
    var l = el(doc, 'label', 'ui-field__label');
    l.setAttribute('for', id);
    l.textContent = text == null ? '' : String(text);
    return l;
  }

  function field(o) {
    o = o || {};
    var doc = docOf(o);
    var id = o.id || newId('ui-field');
    var wrap = el(doc, 'div', 'ui-field');
    wrap.appendChild(fieldLabel(doc, o.label, id));
    var input = el(doc, 'input', 'ui-field__input');
    input.id = id;
    input.setAttribute('type', o.type || 'text');
    if (o.name) input.setAttribute('name', o.name);
    if (o.placeholder) input.setAttribute('placeholder', o.placeholder);
    if (o.value != null) input.value = String(o.value);
    wrap.appendChild(input);
    var described = [];
    if (o.help) {
      var hp = el(doc, 'p', 'ui-field__help');
      hp.id = id + '-help';
      hp.textContent = String(o.help);
      wrap.appendChild(hp);
      described.push(hp.id);
    }
    if (o.error) {
      var ep = el(doc, 'p', 'ui-field__error');
      ep.id = id + '-error';
      ep.setAttribute('role', 'alert');
      ep.textContent = String(o.error);
      wrap.appendChild(ep);
      input.setAttribute('aria-invalid', 'true');
      described.push(ep.id);
    }
    if (described.length) input.setAttribute('aria-describedby', described.join(' '));
    return { el: wrap, input: input };
  }

  function select(o) {
    o = o || {};
    var doc = docOf(o);
    var id = o.id || newId('ui-select');
    var wrap = el(doc, 'div', 'ui-field');
    wrap.appendChild(fieldLabel(doc, o.label, id));
    var box = el(doc, 'span', 'ui-select');
    var sel = el(doc, 'select', 'ui-select__native');
    sel.id = id;
    if (o.name) sel.setAttribute('name', o.name);
    (Array.isArray(o.options) ? o.options : []).forEach(function (opt) {
      var op = el(doc, 'option');
      op.value = String(opt.value);
      op.textContent = opt.label == null ? String(opt.value) : String(opt.label);
      sel.appendChild(op);
    });
    if (o.value != null) sel.value = String(o.value);
    box.appendChild(sel);
    box.appendChild(icon('expand_more', { cls: 'ui-select__chevron', doc: doc }));
    wrap.appendChild(box);
    return { el: wrap, select: sel };
  }

  // ---------------------------------------------------------------- state
  function stateBlock(o) {
    o = o || {};
    var doc = docOf(o);
    var s = el(doc, 'div', 'ui-state');
    if (o.icon) {
      var ic = el(doc, 'span', 'ui-state__icon');
      ic.appendChild(icon(o.icon, { size: 'lg', doc: doc }));
      s.appendChild(ic);
    }
    var h = el(doc, 'h3', 'ui-state__title');
    h.textContent = o.title == null ? '' : String(o.title);
    s.appendChild(h);
    if (o.body) {
      var p = el(doc, 'p', 'ui-state__body');
      p.textContent = String(o.body);
      s.appendChild(p);
    }
    if (o.action && o.action.label) {
      s.appendChild(button({ variant: 'secondary', label: o.action.label, onClick: o.action.onClick, doc: doc }));
    }
    return s;
  }

  // ---------------------------------------------------------------- copy
  function execCopy(doc, text) {
    var prev = doc.activeElement;
    var ta = el(doc, 'textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.setAttribute('aria-hidden', 'true');
    ta.setAttribute('tabindex', '-1');
    // In and out in one synchronous turn, so it never paints; preventScroll keeps
    // the page still while it holds the selection.
    doc.body.appendChild(ta);
    var ok = false;
    try {
      try { ta.focus({ preventScroll: true }); } catch (_) {}
      ta.select();
      ok = typeof doc.execCommand === 'function' && doc.execCommand('copy') === true;
    } catch (_) { ok = false; }
    doc.body.removeChild(ta);
    if (prev && typeof prev.focus === 'function') { try { prev.focus({ preventScroll: true }); } catch (_) {} }
    return ok;
  }

  function copy(text, o) {
    o = o || {};
    var doc = docOf(o);
    var win = winOf(o, doc);
    var str = text == null ? '' : String(text);
    var label = o.label || 'Copied';
    function report(ok) {
      if (ok) toast(label, { kind: 'success', doc: doc, win: win });
      else toast('Could not copy', { kind: 'error', doc: doc, win: win });
      return ok;
    }
    var clip = win && win.navigator && win.navigator.clipboard;
    if (clip && typeof clip.writeText === 'function') {
      var p;
      try { p = clip.writeText(str); } catch (_) { p = Promise.reject(new Error('writeText threw')); }
      return Promise.resolve(p).then(function () { return report(true); },
        function () { return report(execCopy(doc, str)); });
    }
    return Promise.resolve(report(execCopy(doc, str)));
  }

  var api = {
    icon: icon, button: button, setPressed: setPressed, setBusy: setBusy,
    list: list, row: row, avatar: avatar, thumb: thumb, chip: chip,
    sheet: sheet, menu: menu, toast: toast, confirm: confirm, prompt: prompt,
    switch: uiSwitch, segmented: segmented, field: field, select: select,
    state: stateBlock, copy: copy,
    // Pure helpers, exported for tests and for callers that need the same text.
    initials: initials, toneOf: toneOf, formatDuration: formatDuration,
  };
  if (hasWindow) window.ui = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
