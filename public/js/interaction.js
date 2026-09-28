'use strict';

// The native-interaction policy, JS half (D6 of the UI professionalism pass).
// The CSS half (ui.css) turns off selection, callouts and tap flashes app-wide;
// this file owns the gestures that replace them:
//
//   onLongPress(el, handler, opts)    a press held still for `ms` fires once
//   onContextMenu(el, handler, opts)  desktop right-click opens OUR menu
//   onActionMenu(el, handler, opts)   the card/row menu trigger: both, one open per gesture
//   swipeRow(rowEl, opts)             swipe left to reveal row actions (D8.3)
//
// Every helper returns a teardown (`off()`, or `destroy()` on the swipe
// controller) that removes every listener it added and clears its timers.
//
// Inline style: this file never sets a visual style inline. The only property it
// writes is ONE CSS custom property, which ui.css consumes:
//   --swipe-x   on div.ui-swipe: the row content's horizontal offset in px (<= 0)
//
// Rules the long-press keeps (D6; each is test-bound in
// test/unit/interaction-policy.test.js):
//   - It never calls preventDefault on pointerdown and never listens to
//     touchstart, so taps and scrolls start exactly as they would without it.
//   - It listens for `touchmove` with {passive:false} ONLY while armed (from the
//     moment it fires until release), and prevents it then - so a held finger
//     that drifts does not scroll the page under an open menu or a 2x hold.
//   - It prevents `contextmenu` while a press is down or just fired (iOS and
//     Android raise it on a long touch).
//   - It clears any text selection when it fires.
//   - It swallows the ONE click that follows a fired press (capture phase on the
//     document, any target: a menu that opened under the finger must not take
//     the release as a tap on its first item).
//   - A press that starts inside a field (input/textarea/select/contenteditable)
//     is ignored, so the native caret loupe and paste menu keep working there.
//
// swipeRow safety (D8.3, a destructive surface - the full gate attacks this):
//   - The full-swipe action may never be kind 'danger': setup throws.
//   - Every action (danger included) runs ONLY from a click on its revealed
//     button while the row is open and not mid-drag. A pointer click must also
//     have STARTED on that same button (its pointerdown, while open, still within
//     the tap tolerance); a keyboard/programmatic click (detail 0) needs only the
//     open, idle row. The underlay is `inert` + aria-hidden while closed.
//   - The click that ends a drag activates nothing (one swallowed click).
//   - Tapping the row content while open only closes the row.
//   - Selecting an action closes the row first, so a second tap cannot reach the
//     same button again without a new swipe.
(function () {
  var LONG_PRESS_MS = 450;
  var LONG_PRESS_TOLERANCE_PX = 8;
  var DIRECTION_LOCK_PX = 8;
  var TAP_TOLERANCE_PX = 8;
  var FULL_SWIPE_THRESHOLD = 0.6;
  // How long a pending "swallow the next click" stays armed after release. The
  // click a release produces is dispatched in the same task as the pointerup
  // (touch-action: manipulation removes the iOS delay); the window only bounds a
  // click that never comes (a touch drag raises none), so a deliberate tap made
  // after it is not eaten.
  var CLICK_SWALLOW_MS = 400;
  // How long after a fired press's release a stray contextmenu is still refused.
  var CONTEXTMENU_GRACE_MS = 600;

  var FIELD_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

  function docOf(el, opts) {
    return (opts && opts.doc) || (el && el.ownerDocument) || (typeof document !== 'undefined' ? document : null);
  }
  function winOf(doc, opts) {
    return (opts && opts.win) || (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
  }
  function inField(target) {
    return !!(target && typeof target.closest === 'function' && target.closest(FIELD_SELECTOR));
  }
  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }
  function clearSelection(doc, win) {
    try {
      var sel = (doc && typeof doc.getSelection === 'function') ? doc.getSelection()
        : (win && typeof win.getSelection === 'function' ? win.getSelection() : null);
      if (sel && typeof sel.removeAllRanges === 'function') sel.removeAllRanges();
    } catch (_) { /* best-effort */ }
  }
  function swallow(e) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
  }

  // One pending "swallow the next click" on a document, capture phase, any
  // target, expiring after CLICK_SWALLOW_MS. Returns a canceller.
  function swallowNextClick(doc, win) {
    var timer = null;
    function onClick(e) { done(); swallow(e); }
    function done() {
      doc.removeEventListener('click', onClick, true);
      if (timer !== null) { win.clearTimeout(timer); timer = null; }
    }
    doc.addEventListener('click', onClick, true);
    timer = win.setTimeout(done, CLICK_SWALLOW_MS);
    return done;
  }

  // ---- long-press ---------------------------------------------------------

  // The long-press engine. Returns { off, busy } - `busy()` is true while a press
  // is down or within the grace window after a fired one; onActionMenu uses it
  // to keep the contextmenu path from opening a second menu.
  function createLongPress(el, handler, opts) {
    opts = opts || {};
    var doc = docOf(el, opts);
    var win = winOf(doc, opts);
    var ms = num(opts.ms, LONG_PRESS_MS);
    var tolerance = num(opts.tolerance, LONG_PRESS_TOLERANCE_PX);

    var press = null;          // { id, x, y, lastX, lastY, event, timer, fired, type }
    var graceTimer = null;     // a fired press's contextmenu grace window
    var cancelSwallow = null;  // the pending click swallow

    function onTouchMove(e) { if (e.cancelable) e.preventDefault(); }
    function arm() { el.addEventListener('touchmove', onTouchMove, { passive: false }); }
    function disarm() { el.removeEventListener('touchmove', onTouchMove, { passive: false }); }

    function stopTracking() {
      doc.removeEventListener('pointermove', onMove, true);
      doc.removeEventListener('pointerup', onUp, true);
      doc.removeEventListener('pointercancel', onCancel, true);
    }

    function fire() {
      if (!press || press.fired) return;
      if (press.timer !== null) { win.clearTimeout(press.timer); press.timer = null; }
      press.fired = true;
      clearSelection(doc, win);
      arm();
      handler(press.event, { x: press.lastX, y: press.lastY });
    }

    function end(completed) {
      if (!press) return;
      var p = press;
      press = null;
      stopTracking();
      if (p.timer !== null) win.clearTimeout(p.timer);
      if (!p.fired) return;
      disarm();
      if (completed) {
        if (cancelSwallow) cancelSwallow();
        cancelSwallow = swallowNextClick(doc, win);
      }
      if (graceTimer !== null) win.clearTimeout(graceTimer);
      graceTimer = win.setTimeout(function () { graceTimer = null; }, CONTEXTMENU_GRACE_MS);
    }

    function onDown(e) {
      // Never preventDefault here: taps and scrolls must start untouched.
      if (press) {
        // A second finger is a pinch, not a hold: cancel. The same pointer
        // pressing again means its release was lost (a mouse let go outside
        // the window): drop the stale press and start this one.
        var stale = e.pointerId === press.id;
        end(false);
        if (!stale) return;
      }
      if (e.isPrimary === false) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (inField(e.target)) return;
      var x = num(e.clientX, 0), y = num(e.clientY, 0);
      press = { id: e.pointerId, x: x, y: y, lastX: x, lastY: y, event: e, timer: null, fired: false, type: e.pointerType };
      press.timer = win.setTimeout(function () { if (press) { press.timer = null; fire(); } }, ms);
      doc.addEventListener('pointermove', onMove, true);
      doc.addEventListener('pointerup', onUp, true);
      doc.addEventListener('pointercancel', onCancel, true);
    }
    function onMove(e) {
      if (!press || e.pointerId !== press.id) return;
      var x = num(e.clientX, press.lastX), y = num(e.clientY, press.lastY);
      if (!press.fired) {
        var dx = x - press.x, dy = y - press.y;
        if (Math.sqrt(dx * dx + dy * dy) > tolerance) { end(false); return; }
      }
      press.lastX = x; press.lastY = y;
    }
    function onUp(e) { if (press && e.pointerId === press.id) end(true); }
    function onCancel(e) { if (press && e.pointerId === press.id) end(true); }

    function onContext(e) {
      if (press) {
        e.preventDefault();
        // The platform's own long-touch signal: a touch/pen press it reports
        // before our timer is a long press now (Android with a short hold delay).
        if (!press.fired && press.type !== 'mouse') fire();
        return;
      }
      if (graceTimer !== null) e.preventDefault();
    }

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('contextmenu', onContext);

    return {
      off: function () {
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('contextmenu', onContext);
        if (press) {
          stopTracking();
          if (press.timer !== null) win.clearTimeout(press.timer);
          press = null;
        }
        disarm();
        if (graceTimer !== null) { win.clearTimeout(graceTimer); graceTimer = null; }
        if (cancelSwallow) { cancelSwallow(); cancelSwallow = null; }
      },
      busy: function () { return !!press || graceTimer !== null; },
    };
  }

  function onLongPress(el, handler, opts) {
    return createLongPress(el, handler, opts).off;
  }

  // ---- context menu -------------------------------------------------------

  function createContextMenu(el, handler, opts) {
    opts = opts || {};
    var doc = docOf(el, opts);
    var lastType = null;   // the pointerType of the latest press on el
    var down = false;

    function onDown(e) { lastType = e.pointerType || null; down = true; }
    function onUpOrCancel() { down = false; }
    function fromTouch(e) {
      if (e.pointerType) return e.pointerType !== 'mouse';
      if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return true;
      // Safari raises a plain MouseEvent: judge by the press that is down now.
      return down && lastType !== null && lastType !== 'mouse';
    }
    function onContext(e) {
      if (inField(e.target)) return;            // fields keep the native menu
      if (fromTouch(e)) return;                 // a long touch belongs to onLongPress
      if (opts.skip && opts.skip()) { e.preventDefault(); return; }
      e.preventDefault();
      var x = num(e.clientX, 0), y = num(e.clientY, 0);
      if (!x && !y && typeof el.getBoundingClientRect === 'function') {
        // The keyboard's menu key: anchor at the element.
        var r = el.getBoundingClientRect();
        x = r.left + r.width / 2; y = r.top + r.height / 2;
      }
      handler(e, { x: x, y: y });
    }

    el.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('pointerup', onUpOrCancel, true);
    doc.addEventListener('pointercancel', onUpOrCancel, true);
    el.addEventListener('contextmenu', onContext);
    return function off() {
      el.removeEventListener('pointerdown', onDown, true);
      doc.removeEventListener('pointerup', onUpOrCancel, true);
      doc.removeEventListener('pointercancel', onUpOrCancel, true);
      el.removeEventListener('contextmenu', onContext);
    };
  }

  function onContextMenu(el, handler, opts) {
    return createContextMenu(el, handler, opts);
  }

  // ---- action menu --------------------------------------------------------

  // The card/row action-menu trigger: a long-press on touch, a right-click on
  // desktop. One gesture opens the menu once: the contextmenu path stands down
  // while a long-press is down or just fired.
  function onActionMenu(el, handler, opts) {
    opts = opts || {};
    var lp = createLongPress(el, handler, opts);
    var cmOpts = {};
    for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) cmOpts[k] = opts[k];
    cmOpts.skip = lp.busy;
    var offCm = createContextMenu(el, handler, cmOpts);
    return function off() { lp.off(); offCm(); };
  }

  // ---- swipe row ----------------------------------------------------------

  var openRows = typeof WeakMap === 'function' ? new WeakMap() : null;   // doc -> Set<controller>
  var managed = typeof WeakSet === 'function' ? new WeakSet() : null;

  function rowsOf(doc) {
    if (!openRows) return null;
    var s = openRows.get(doc);
    if (!s) { s = new Set(); openRows.set(doc, s); }
    return s;
  }

  function validateActions(actions, fullSwipe) {
    if (!Array.isArray(actions) || actions.length === 0) throw new Error('swipeRow: actions must be a non-empty array');
    var ids = {};
    actions.forEach(function (a) {
      if (!a || typeof a.id !== 'string' || !a.id) throw new Error('swipeRow: every action needs a string id');
      if (ids[a.id]) throw new Error('swipeRow: duplicate action id "' + a.id + '"');
      ids[a.id] = a;
      // Fail closed: a kind must be stated, so a delete cannot pass as neutral by omission.
      if (a.kind !== 'neutral' && a.kind !== 'danger') throw new Error('swipeRow: action "' + a.id + '" needs kind \'neutral\' or \'danger\'');
      if (typeof a.onSelect !== 'function') throw new Error('swipeRow: action "' + a.id + '" needs onSelect');
    });
    if (fullSwipe === null || fullSwipe === undefined) return null;
    var full = ids[fullSwipe];
    if (!full) throw new Error('swipeRow: fullSwipe "' + fullSwipe + '" is not an action id');
    if (full.kind === 'danger') throw new Error('swipeRow: a danger action can never be the full-swipe action ("' + fullSwipe + '")');
    return full;
  }

  function swipeRow(rowEl, opts) {
    opts = opts || {};
    if (!rowEl || !rowEl.nodeType) throw new Error('swipeRow: rowEl must be an element');
    if (managed && managed.has(rowEl)) throw new Error('swipeRow: this row already has a swipe controller');
    var actions = opts.actions;
    var fullAction = validateActions(actions, opts.fullSwipe);
    var threshold = opts.threshold === undefined ? FULL_SWIPE_THRESHOLD : opts.threshold;
    if (typeof threshold !== 'number' || !(threshold > 0 && threshold <= 1)) throw new Error('swipeRow: threshold must be in (0, 1]');
    var doc = docOf(rowEl, opts);
    var win = winOf(doc, opts);
    // Layout reads go through `measure` so tests (jsdom has no layout) can supply sizes.
    var measure = opts.measure || {
      rowWidth: function () { return rowEl.getBoundingClientRect().width || rowEl.offsetWidth || 0; },
      actionsWidth: function () { return actionsEl.scrollWidth || actionsEl.getBoundingClientRect().width || 0; },
    };

    // ---- DOM ----
    var parent = rowEl.parentNode;
    var hadClassAttr = rowEl.hasAttribute('class');
    var origClass = rowEl.getAttribute('class');

    var wrap = doc.createElement('div');
    wrap.className = 'ui-swipe';
    var actionsEl = doc.createElement('div');
    actionsEl.className = 'ui-swipe__actions';
    var buttons = actions.map(function (a) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'ui-swipe__action ui-swipe__action--' + a.kind;
      b.setAttribute('data-action', a.id);
      b.textContent = a.label == null ? '' : String(a.label);
      actionsEl.appendChild(b);
      return b;
    });
    if (parent) parent.insertBefore(wrap, rowEl);
    wrap.appendChild(actionsEl);
    wrap.appendChild(rowEl);
    rowEl.classList.add('ui-swipe__content');
    if (managed) managed.add(rowEl);

    // ---- state ----
    var open = false;
    var drag = null;          // { id, x0, y0, base, dx, locked: null|'h', captured }
    var dragging = false;     // horizontally locked and moving
    var armed = null;         // { button, id, x, y } - a press that began on an action button
    var cancelSwallow = null;
    var destroyed = false;
    var ctrl;

    function setOffset(px) { wrap.style.setProperty('--swipe-x', px + 'px'); }
    function setUnderlay(shown) {
      if (shown) { actionsEl.removeAttribute('aria-hidden'); actionsEl.removeAttribute('inert'); }
      else { actionsEl.setAttribute('aria-hidden', 'true'); actionsEl.setAttribute('inert', ''); }
    }
    function snapOpen() {
      var w = measure.actionsWidth();
      if (!(w > 0)) { snapClosed(); return; }
      var others = rowsOf(doc);
      if (others) others.forEach(function (c) { if (c !== ctrl) c.close(); });
      open = true;
      if (others) others.add(ctrl);
      wrap.classList.add('is-open');
      setOffset(-w);
      setUnderlay(true);
      doc.addEventListener('pointerdown', onOutsideDown, true);
    }
    function snapClosed() {
      open = false;
      armed = null;
      var s = openRows && openRows.get(doc);
      if (s) s.delete(ctrl);
      wrap.classList.remove('is-open');
      setOffset(0);
      setUnderlay(false);
      doc.removeEventListener('pointerdown', onOutsideDown, true);
    }

    function onTouchMove(e) { if (e.cancelable) e.preventDefault(); }
    function stopTracking() {
      rowEl.removeEventListener('pointermove', onMove);
      rowEl.removeEventListener('pointerup', onUp);
      rowEl.removeEventListener('pointercancel', onCancel);
      rowEl.removeEventListener('touchmove', onTouchMove, { passive: false });
    }
    function releaseCapture(d) {
      if (d && d.captured && typeof rowEl.releasePointerCapture === 'function') {
        try { rowEl.releasePointerCapture(d.id); } catch (_) { /* already released */ }
      }
    }
    function endDrag() {
      var d = drag;
      drag = null;
      dragging = false;
      wrap.classList.remove('is-dragging');
      stopTracking();
      releaseCapture(d);
      return d;
    }

    function onDown(e) {
      if (destroyed || drag) return;
      if (e.isPrimary === false) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (inField(e.target)) return;
      drag = { id: e.pointerId, x0: num(e.clientX, 0), y0: num(e.clientY, 0),
        base: open ? -measure.actionsWidth() : 0, dx: 0, locked: null, captured: false };
      rowEl.addEventListener('pointermove', onMove);
      rowEl.addEventListener('pointerup', onUp);
      rowEl.addEventListener('pointercancel', onCancel);
    }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = num(e.clientX, drag.x0) - drag.x0;
      var dy = num(e.clientY, drag.y0) - drag.y0;
      if (!drag.locked) {
        if (Math.sqrt(dx * dx + dy * dy) < DIRECTION_LOCK_PX) return;
        // Mostly vertical, or a rightward start on a closed row (nothing to
        // reveal): release the gesture entirely - the page scrolls as usual.
        if (Math.abs(dy) >= Math.abs(dx) || (!open && dx > 0)) { endDrag(); return; }
        drag.locked = 'h';
        dragging = true;
        wrap.classList.add('is-dragging');
        rowEl.addEventListener('touchmove', onTouchMove, { passive: false });
        if (typeof rowEl.setPointerCapture === 'function') {
          try { rowEl.setPointerCapture(drag.id); drag.captured = true; } catch (_) { /* not capturable */ }
        }
      }
      var rowW = measure.rowWidth();
      var x = drag.base + dx;
      if (x > 0) x = 0;
      if (rowW > 0 && x < -rowW) x = -rowW;
      drag.dx = x;
      setOffset(x);
    }
    function armClickSwallow() {
      if (cancelSwallow) cancelSwallow();
      cancelSwallow = swallowNextClick(doc, win);
    }
    function onUp(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var wasLocked = drag.locked === 'h';
      var d = endDrag();
      if (!wasLocked) return;              // a tap: the click handler decides
      armClickSwallow();                   // the click ending a drag activates nothing
      var dist = -d.dx;
      var actionsW = measure.actionsWidth();
      var rowW = measure.rowWidth();
      // A full swipe must pass the threshold AND the revealed actions, so dragging
      // to reveal wide actions never doubles as a full swipe.
      var fullAt = Math.max(threshold * rowW, actionsW);
      if (fullAction && rowW > 0 && dist >= fullAt && dist > 0) {
        snapClosed();
        fullAction.onSelect({ id: fullAction.id, row: rowEl, via: 'full-swipe' });
        return;
      }
      if (actionsW > 0 && dist > actionsW / 2) snapOpen();
      else snapClosed();
    }
    function onCancel(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var wasOpen = open;
      endDrag();
      if (wasOpen) snapOpen(); else snapClosed();   // back to where it was; nothing runs
    }

    // Tapping the content of an open row only closes it.
    function onContentClick(e) {
      if (!open) return;
      swallow(e);
      snapClosed();
    }

    function onActionDown(e) {
      var b = e.currentTarget;
      armed = null;
      if (!open || dragging || drag) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      armed = { button: b, id: e.pointerId, x: num(e.clientX, 0), y: num(e.clientY, 0) };
    }
    function onActionMove(e) {
      if (!armed || e.pointerId !== armed.id) return;
      var dx = num(e.clientX, armed.x) - armed.x, dy = num(e.clientY, armed.y) - armed.y;
      if (Math.sqrt(dx * dx + dy * dy) > TAP_TOLERANCE_PX) armed = null;
    }
    function onActionCancel(e) { if (armed && e.pointerId === armed.id) armed = null; }
    function onActionClick(e) {
      var b = e.currentTarget;
      var a = actions[buttons.indexOf(b)];
      var keyboard = !e.detail;   // keyboard / programmatic activation carries detail 0
      var ok = open && !dragging && !drag && !!a && (keyboard || (armed && armed.button === b));
      armed = null;
      e.preventDefault();
      e.stopPropagation();
      if (!ok) return;
      snapClosed();
      a.onSelect({ id: a.id, row: rowEl, via: 'button' });
    }

    function onOutsideDown(e) {
      if (!open) return;
      if (e.target && typeof wrap.contains === 'function' && wrap.contains(e.target)) return;
      snapClosed();
    }

    rowEl.addEventListener('pointerdown', onDown);
    rowEl.addEventListener('click', onContentClick, true);
    buttons.forEach(function (b) {
      b.addEventListener('pointerdown', onActionDown);
      b.addEventListener('pointermove', onActionMove);
      b.addEventListener('pointercancel', onActionCancel);
      b.addEventListener('click', onActionClick);
    });
    setUnderlay(false);

    ctrl = {
      close: function () { if (open) snapClosed(); },
      isOpen: function () { return open; },
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        if (drag) endDrag();
        snapClosed();
        if (cancelSwallow) { cancelSwallow(); cancelSwallow = null; }
        rowEl.removeEventListener('pointerdown', onDown);
        rowEl.removeEventListener('click', onContentClick, true);
        buttons.forEach(function (b) {
          b.removeEventListener('pointerdown', onActionDown);
          b.removeEventListener('pointermove', onActionMove);
          b.removeEventListener('pointercancel', onActionCancel);
          b.removeEventListener('click', onActionClick);
        });
        // Unwrap: the row goes back exactly where the wrapper stands.
        var p = wrap.parentNode;
        if (p) p.insertBefore(rowEl, wrap);
        else if (rowEl.parentNode === wrap) wrap.removeChild(rowEl);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        if (hadClassAttr) rowEl.setAttribute('class', origClass);
        else rowEl.removeAttribute('class');
        if (managed) managed.delete(rowEl);
      },
    };
    return ctrl;
  }

  // A gesture that is not a menu but rides the same long press (a reorder's touch drag) refuses
  // the context menu / selection callout that press would open, while `isArmed()` says so (read
  // at event time). D6: every contextmenu listener lives in this file - step 7 moved the
  // reorder's (common.js wireReorderable) here. `opts.signal` unbinds it with the press.
  function suppressContextMenuWhile(target, isArmed, opts) {
    if (!target || typeof target.addEventListener !== 'function' || typeof isArmed !== 'function') return function () {};
    function onContext(e) { if (isArmed()) e.preventDefault(); }
    var signal = opts && opts.signal;
    target.addEventListener('contextmenu', onContext, signal ? { signal: signal } : undefined);
    return function () { target.removeEventListener('contextmenu', onContext); };
  }

  var api = {
    onLongPress: onLongPress,
    suppressContextMenuWhile: suppressContextMenuWhile,
    onContextMenu: onContextMenu,
    onActionMenu: onActionMenu,
    swipeRow: swipeRow,
    LONG_PRESS_MS: LONG_PRESS_MS,
    LONG_PRESS_TOLERANCE_PX: LONG_PRESS_TOLERANCE_PX,
    DIRECTION_LOCK_PX: DIRECTION_LOCK_PX,
    FULL_SWIPE_THRESHOLD: FULL_SWIPE_THRESHOLD,
    CLICK_SWALLOW_MS: CLICK_SWALLOW_MS,
  };
  if (typeof window !== 'undefined') window.FTInteraction = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
