'use strict';
// Geometry checks G1-G4 (UI professionalism pass, plan D10.2). Two halves:
//
// - COLLECTORS run in the page (passed to page.evaluate, so each is self-contained): they
//   read getBoundingClientRect() boxes off the live DOM and return plain data. Each takes an
//   optional SCOPE selector (a surface's `scope`): only that subtree is measured (a missing
//   scope element measures nothing, which the surface's anti-vacuity floor then fails);
// - EVALUATORS are pure (node side, unit-tested in test/unit/geometry-checks.test.js with
//   synthetic boxes): they turn that data into failures.
//
// G1 row columns: in each ui-list, each ui-row slot (lead, media, body, aside, actions) starts
//    at the same x in every row (tolerance 0.5px) - an optional child can never move a column.
// G2 icon centring: an icon's box centre-y is within 0.5px of its label's centre-y, in a
//    ui-btn (icon + label; an icon-only button centres on the button box; a stacked button
//    - icon over label - is checked on centre-x instead) and in a ui-row (an icon outside any
//    button centres on the row's text body).
// G3 equal heights: ui-btn siblings (same parent) share one height (tolerance 0.5px).
// G4 rotation stillness: after a step (rotate, leave Pocket, rotate back), once the layout
//    first changes, no box differs from its settled box by more than 1px in any later frame.
// POP menu reach (gate r1): an open menu and every row of it can be reached inside the
//    viewport, and a popover that fits beside its anchor opens below it or flips above it.

const TOL = 0.5;
const G4_TOL = 1;

// ---------------------------------------------------------------- collectors (in the page)

// Each collector takes an optional `scope` selector (a surface's `scope`): only that subtree
// is measured, so a page-wide surface (the header on Home) is not failed by another sweep's
// controls elsewhere on the page.
// G1 takes the scope selector, or (a surface's `g1` options, run.js) {scope, group, actions}:
//   group:   a selector; every ui-row of every ui-list inside ONE matching element is measured
//            as one list (Subscriptions' A-Z sections: one ui-list per letter, often a single
//            row each, and AC5 says the columns line up ACROSS sections);
//   actions: also measure each child of .ui-row__actions as its own slot (`actions#1`, ...):
//            a row whose trailing button is missing or moved (a kebab sliding into the
//            empty bell slot) fails even though the actions box itself holds its column.
function collectG1(arg) {
  const o = arg && typeof arg === 'object' ? arg : { scope: arg };
  const root = o.scope ? document.querySelector(o.scope) : document;
  if (!root) return [];
  const SLOTS = ['lead', 'media', 'body', 'aside', 'actions'];
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 || r.height > 0; };
  const measureRow = (row) => {
    const slots = {};
    for (const s of SLOTS) {
      const el = Array.from(row.children).find((c) => c.classList.contains('ui-row__' + s));
      slots[s] = el ? el.getBoundingClientRect().left : null;
      if (s === 'actions' && el && o.actions) Array.from(el.children).forEach((c, i) => { slots[`actions#${i + 1}`] = c.getBoundingClientRect().left; });
    }
    return { title: (row.querySelector('.ui-row__title') || row).textContent.trim().slice(0, 40), slots };
  };
  const lists = [];
  if (o.group) {
    root.querySelectorAll(o.group).forEach((g, gi) => {
      if (!shown(g)) return;
      const rows = Array.from(g.querySelectorAll('.ui-list .ui-row')).filter((r) => shown(r) && shown(r.closest('.ui-list')));
      lists.push({ list: `${o.group} #${gi + 1} (${g.querySelectorAll('.ui-list').length} ui-lists)`, rows: rows.map(measureRow) });
    });
    return lists;
  }
  root.querySelectorAll('.ui-list').forEach((list, li) => {
    if (!shown(list)) return;
    const rows = Array.from(list.querySelectorAll('.ui-row')).filter((r) => r.closest('.ui-list') === list && shown(r));
    lists.push({ list: list.getAttribute('aria-label') || `ui-list #${li + 1}`, rows: rows.map(measureRow) });
  });
  return lists;
}

function collectG2(scope) {
  const root = scope ? document.querySelector(scope) : document;
  if (!root) return [];
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const name = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  const items = [];
  root.querySelectorAll('.ui-btn').forEach((btn) => {
    const icon = btn.querySelector('.ui-btn__icon .ui-icon');
    if (!icon || !visible(btn) || !visible(icon)) return;
    const stack = btn.classList.contains('ui-btn--stack');
    const label = btn.querySelector('.ui-btn__label');
    let ref = null;
    let refKind = null;
    if (label && visible(label)) { ref = label; refKind = 'label'; } else if (btn.classList.contains('ui-btn--icon')) { ref = btn; refKind = 'button'; }
    if (!ref) return;
    items.push({ where: 'ui-btn', name: name(btn), axis: stack ? 'x' : 'y', refKind, icon: box(icon), ref: box(ref) });
  });
  root.querySelectorAll('.ui-row .ui-icon').forEach((icon) => {
    if (icon.closest('.ui-btn') || !visible(icon)) return;
    const row = icon.closest('.ui-row');
    const body = row && Array.from(row.children).find((c) => c.classList.contains('ui-row__body'));
    if (!body || !visible(body)) return;
    items.push({ where: 'ui-row', name: name(row), axis: 'y', refKind: 'row body', icon: box(icon), ref: box(body) });
  });
  return items;
}

function collectG3(scope) {
  const root = scope ? document.querySelector(scope) : document;
  if (!root) return [];
  const groups = new Map();
  root.querySelectorAll('.ui-btn').forEach((btn) => {
    const r = btn.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0) || !btn.parentElement) return;
    if (!groups.has(btn.parentElement)) groups.set(btn.parentElement, []);
    groups.get(btn.parentElement).push({ name: (btn.getAttribute('aria-label') || btn.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24), cls: btn.className, h: r.height });
  });
  const out = [];
  let i = 0;
  for (const [parent, btns] of groups) {
    i++;
    if (btns.length < 2) continue;
    const section = parent.closest('section');
    const heading = section && section.querySelector('h2');
    out.push({ group: `${heading ? heading.textContent.trim() + ' / ' : ''}${parent.className || parent.tagName.toLowerCase()} #${i}`, buttons: btns });
  }
  return out;
}

// G4 recorder: every animation frame, the box of every rendered element, keyed by a DOM
// path (tag, id, nth-of-type). Frame 0 is taken synchronously at start (the state before
// the step). Elements running a CSS animation when first seen (spinners) are skipped: an
// endless animation is motion by design, and AC9 is about layout.
// `opts` is the element cap, or { max, ignore }: `ignore` is a selector a sequence names for
// elements that move BY DESIGN on their own clock, the transition twin of the animation skip -
// kept to one named selector per sequence (scenes.js G4_SEQUENCES), never a blanket exemption.
function startG4Recorder(opts) {
  const o = typeof opts === 'number' ? { max: opts } : (opts || {});
  const cap = o.max || 2500;
  const ignore = o.ignore || null;
  const keys = new WeakMap();
  const keyOf = (el) => {
    if (keys.has(el)) return keys.get(el);
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + n.id); break; }
      let k = 1;
      for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) k++;
      parts.unshift(n.tagName.toLowerCase() + ':' + k);
    }
    const key = parts.join('>');
    keys.set(el, key);
    return key;
  };
  const skip = new WeakSet();
  const animated = new WeakMap();
  const snap = () => {
    const boxes = {};
    let n = 0;
    const all = document.body ? document.body.getElementsByTagName('*') : [];
    for (let i = 0; i < all.length && n < cap; i++) {
      const el = all[i];
      if (skip.has(el)) continue;
      if (el.namespaceURI === 'http://www.w3.org/2000/svg' && el.tagName.toLowerCase() !== 'svg') { skip.add(el); continue; }
      if (el.id === 'ft-icon-sprite' || el.closest('#ft-icon-sprite')) { skip.add(el); continue; }
      if (ignore && el.matches(ignore)) { skip.add(el); continue; }
      if (!animated.has(el)) animated.set(el, getComputedStyle(el).animationName !== 'none');
      if (animated.get(el)) continue;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;
      boxes[keyOf(el)] = [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 100) / 100);
      n++;
    }
    return { t: performance.now(), vw: innerWidth, vh: innerHeight, boxes };
  };
  const rec = { frames: [snap()], on: true };
  const tick = () => { if (!rec.on) return; rec.frames.push(snap()); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__g4 = rec;
  return rec.frames.length;
}

// ---------------------------------------------------------------- evaluators (pure)

const round2 = (v) => Math.round(v * 100) / 100;

// -> { measured: {lists, rows}, failures: [{list, slot, row, left, expected, delta}] }
function evalG1(lists, tol = TOL) {
  const failures = [];
  let rows = 0;
  for (const l of lists) {
    rows += l.rows.length;
    if (l.rows.length < 2) continue;
    const ref = l.rows[0];
    // Every slot any row has (an `actions#N` slot only some rows carry is itself a failure).
    const keys = [...new Set(l.rows.flatMap((r) => Object.keys(r.slots)))];
    for (const slot of keys) {
      for (const row of l.rows.slice(1)) {
        const a = ref.slots[slot];
        const b = row.slots[slot];
        if (a == null && b == null) continue;
        if (a == null || b == null) { failures.push({ list: l.list, slot, row: row.title, left: b, expected: a, delta: null, note: 'slot missing in one row' }); continue; }
        if (Math.abs(a - b) > tol) failures.push({ list: l.list, slot, row: row.title, left: round2(b), expected: round2(a), delta: round2(b - a) });
      }
    }
  }
  return { measured: { lists: lists.filter((l) => l.rows.length >= 2).length, rows }, failures };
}

// -> { measured: {items}, failures: [{where, name, axis, delta}] }
function evalG2(items, tol = TOL) {
  const failures = [];
  for (const it of items) {
    const c = (b) => (it.axis === 'x' ? b.x + b.w / 2 : b.y + b.h / 2);
    const delta = c(it.icon) - c(it.ref);
    if (Math.abs(delta) > tol) failures.push({ where: it.where, name: it.name, axis: it.axis, refKind: it.refKind, delta: round2(delta) });
  }
  return { measured: { items: items.length }, failures };
}

// -> { measured: {groups}, failures: [{group, heights}] }
function evalG3(groups, tol = TOL) {
  const failures = [];
  for (const g of groups) {
    const hs = g.buttons.map((b) => b.h);
    if (Math.max(...hs) - Math.min(...hs) > tol) {
      failures.push({ group: g.group, heights: g.buttons.map((b) => `${b.name || '(icon)'}=${round2(b.h)}`) });
    }
  }
  return { measured: { groups: groups.length }, failures };
}

// frames: [{vw, vh, boxes:{key:[x,y,w,h]}}], frames[0] = before the step.
// -> { frames, firstChange, settled, moved: [{key, frame, delta}], changed }
// A box "moves" when, in a frame AFTER the first changed frame, it differs from its box in
// the settled (last) frame by more than tol on any of x, y, width, height. Keys absent from
// either frame are not compared (an element that appears or vanishes is not a move).
// Self-contained (no outer references): the runner evaluates it IN the page, over the
// recorder's frames, so megabytes of boxes never cross the protocol.
function evalG4(frames, tol = 1) {
  const round2 = (v) => Math.round(v * 100) / 100;
  const diff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  const differs = (fa, fb) => {
    if (fa.vw !== fb.vw || fa.vh !== fb.vh) return true;
    const ka = Object.keys(fa.boxes);
    if (ka.length !== Object.keys(fb.boxes).length) return true;
    return ka.some((k) => !fb.boxes[k] || diff(fa.boxes[k], fb.boxes[k]) > tol);
  };
  const out = { frames: frames.length, firstChange: -1, settled: false, changed: false, moved: [] };
  if (frames.length < 3) return out;
  const pre = frames[0];
  const last = frames[frames.length - 1];
  out.settled = !differs(frames[frames.length - 2], last);
  for (let i = 1; i < frames.length; i++) if (differs(pre, frames[i])) { out.firstChange = i; break; }
  out.changed = out.firstChange !== -1;
  if (!out.changed) return out;
  const worst = new Map();
  for (let i = out.firstChange + 1; i < frames.length - 1; i++) {
    const f = frames[i];
    for (const k of Object.keys(f.boxes)) {
      const s = last.boxes[k];
      if (!s) continue;
      const d = diff(f.boxes[k], s);
      if (d > tol && (!worst.has(k) || worst.get(k).delta < d)) worst.set(k, { key: k, frame: i, delta: round2(d), box: f.boxes[k], settledBox: s });
    }
  }
  out.moved = [...worst.values()].sort((a, b) => b.delta - a.delta);
  return out;
}


// ---------------------------------------------------------------- the chrome (sweep S1)
// HDR and NAV are the app chrome's rendered contracts: what the old selector locks
// (mobile-header-css-source-lock, header-right-reserve, pinned-avatar-css) guarded, measured
// on the live page instead (the v1.85 device-pass failure was a CASCADE bug - a later
// same-specificity base rule silently beat a mobile override - which only a render sees).

// HDR, in the page: the header's glyph buttons, the search toggle / account trigger
// visibility, the search field, the bell's pre-paint reserve against the real bell, and the
// desktop sidebar's rows.
function collectHeader() {
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
  };
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const hr = document.querySelector('header .header-right');
  const buttons = hr ? Array.from(hr.querySelectorAll(':scope > .ui-btn, :scope > .account-menu > .ui-btn')).filter(vis)
    .map((b) => ({ name: b.getAttribute('aria-label') || b.className, box: box(b) })) : [];
  const search = document.getElementById('search-toggle-btn');
  const acct = document.querySelector('#account-menu-root .account-menu-trigger');
  const field = document.querySelector('header .search-form');
  // The bell's pre-paint reserve (the shells' inline block and injectNotificationBellIfEnabled
  // build exactly this DOM - app-look-l2 binds the classes) against the real bell: the same
  // button box, the shimmer disc = the glyph's box. Measured beside the bell, then removed.
  let reserve = null;
  const bell = document.getElementById('notif-bell-btn');
  if (bell && vis(bell)) {
    const ph = document.createElement('span');
    ph.className = 'ui-btn ui-btn--plain ui-btn--md ui-btn--icon notif-bell-btn';
    const slot = document.createElement('span');
    slot.className = 'ui-btn__icon';
    const skel = document.createElement('span');
    skel.className = 'notif-bell-skel skeleton-shimmer';
    slot.appendChild(skel);
    ph.appendChild(slot);
    bell.after(ph);
    const pb = box(ph); const sb = box(skel); const bb = box(bell); const ib = box(bell.querySelector('.ui-icon'));
    reserve = { w: pb.w, h: pb.h, bellW: bb.w, bellH: bb.h, skel: { dx: sb.x - pb.x, dy: sb.y - pb.y, w: sb.w, h: sb.h },
      glyph: { dx: ib.x - bb.x, dy: ib.y - bb.y, w: ib.w, h: ib.h } };
    ph.remove();
  }
  const sidebar = Array.from(document.querySelectorAll('#sidebar .sidebar-item')).filter(vis).map((a) => {
    const cs = getComputedStyle(a);
    return { name: a.textContent.trim().slice(0, 24), active: a.classList.contains('active'), deco: cs.textDecorationLine, weight: cs.fontWeight };
  });
  return { vw: innerWidth, buttons, searchVisible: vis(search), searchBox: vis(search) ? box(search) : null,
    accountVisible: vis(acct), field: vis(field) ? box(field) : null, reserve, sidebar };
}

// NAV, in the page: every shown bottom-bar tab's icon slot and label, and the colours the
// active and idle tabs resolve to against the role tokens.
function collectBottomBar() {
  const nav = document.getElementById('bottom-nav');
  if (!nav || getComputedStyle(nav).display === 'none') return { shown: false, tabs: [] };
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const probe = document.createElement('span');
  document.body.appendChild(probe);
  const role = (v) => { probe.style.color = 'var(' + v + ')'; return getComputedStyle(probe).color; };
  const inks = { ink1: role('--ink-1'), ink2: role('--ink-2'), accent: role('--accent'), accentFill: role('--accent-fill') };
  probe.remove();
  const tabs = Array.from(nav.children).filter((t) => t.classList.contains('bottom-nav-item') && getComputedStyle(t).display !== 'none')
    .map((t) => {
      const slot = t.querySelector(':scope > .ui-btn__icon');
      const label = t.querySelector(':scope > .ui-btn__label');
      const cs = label ? getComputedStyle(label) : null;
      return { name: t.getAttribute('data-nav') || t.getAttribute('data-ft-reserve') || '?', active: t.classList.contains('active'),
        slot: slot ? box(slot) : null, label: label ? box(label) : null, color: cs && cs.color, weight: cs && cs.fontWeight,
        // text-decoration does not inherit (it paints through): read the tab link's own line
        // AND the label's.
        deco: [getComputedStyle(t).textDecorationLine, cs && cs.textDecorationLine].filter((v) => v && v !== 'none').join(' ') || 'none', href: (t.querySelector('.ui-btn__icon use') || { getAttribute: () => '' }).getAttribute('href') };
    });
  return { shown: true, inks, tabs };
}

// -> { measured: {buttons, sidebar}, failures: [string] }
function evalHeader(d, tol = TOL) {
  const failures = [];
  const phone = d.vw <= 768;
  const near = (a, b) => Math.abs(a - b) <= tol;
  const want = phone ? 44 : 36;
  if (d.buttons.length < 2) failures.push(`VACUOUS-ish: only ${d.buttons.length} header glyph button(s) shown`);
  for (const b of d.buttons) {
    if (!near(b.box.h, want) || !near(b.box.w, want)) failures.push(`${b.name}: ${b.box.w}x${b.box.h}, want ${want}x${want}`);
  }
  const cy = (b) => b.box.y + b.box.h / 2;
  for (const b of d.buttons.slice(1)) if (!near(cy(b), cy(d.buttons[0]))) failures.push(`${b.name}: centre-y ${cy(b)} vs ${cy(d.buttons[0])} (the row is not level)`);
  const sorted = d.buttons.slice().sort((a, b) => a.box.x - b.box.x);
  const gaps = sorted.slice(1).map((b, i) => b.box.x - (sorted[i].box.x + sorted[i].box.w));
  if (gaps.length && Math.max(...gaps) - Math.min(...gaps) > tol) failures.push(`uneven glyph spacing: gaps ${gaps.map((g) => Math.round(g * 100) / 100).join(', ')}`);
  if (phone) {
    if (!d.searchVisible) failures.push('phone: the search magnifier is hidden (a later base rule beat the mobile show - the v1.85 cascade bug)');
    else {
      const right = Math.max(...d.buttons.map((b) => b.box.x + b.box.w));
      if (!near(d.searchBox.x + d.searchBox.w, right)) failures.push('phone: the magnifier is not the rightmost glyph (v1.86.0 corner)');
    }
    if (d.accountVisible) failures.push('phone: the header avatar shows (the You tab owns the account on the phone)');
  } else {
    if (d.searchVisible) failures.push('desktop: the search magnifier shows beside the always-on field');
    if (!d.accountVisible) failures.push('desktop: the account avatar is hidden');
    if (!d.field) failures.push('desktop: the search field is hidden');
    else if (!near(d.field.h, 36)) failures.push(`desktop: the search field is ${d.field.h}px tall, want 36 (--ctl-md)`);
  }
  if (d.reserve) {
    const r = d.reserve;
    if (!near(r.w, r.bellW) || !near(r.h, r.bellH)) failures.push(`bell reserve ${r.w}x${r.h} != bell ${r.bellW}x${r.bellH} (the reveal would shift)`);
    for (const k of ['dx', 'dy', 'w', 'h']) if (!near(r.skel[k], r.glyph[k])) failures.push(`bell reserve disc ${k} ${r.skel[k]} != glyph ${r.glyph[k]}`);
  }
  for (const s of d.sidebar) if (s.deco !== 'none') failures.push(`sidebar "${s.name}": underlined (${s.deco}) - F20`);
  const weights = new Set(d.sidebar.map((s) => s.weight));
  if (weights.size > 1) failures.push(`sidebar rows differ in weight (${[...weights].join('/')}) - F50: selected is a fill, never bold`);
  return { measured: { buttons: d.buttons.length, sidebar: d.sidebar.length }, failures };
}

// -> { measured: {tabs}, failures: [string] }
function evalBottomBar(d, tol = TOL) {
  const failures = [];
  if (!d.shown) return { measured: { tabs: 0 }, failures };
  const near = (a, b) => Math.abs(a - b) <= tol;
  const tabs = d.tabs;
  for (const t of tabs) {
    if (!t.slot || !t.label) { failures.push(`${t.name}: not a ui-btn stack (no icon slot / label)`); continue; }
    if (!near(t.slot.w, 24) || !near(t.slot.h, 24)) failures.push(`${t.name}: icon slot ${t.slot.w}x${t.slot.h}, want 24x24 (F49)`);
    if (t.deco !== 'none') failures.push(`${t.name}: label underlined (${t.deco}) - F20`);
  }
  const withLabel = tabs.filter((t) => t.label);
  for (const t of withLabel.slice(1)) {
    if (!near(t.label.y, withLabel[0].label.y)) failures.push(`${t.name}: label top ${t.label.y} vs ${withLabel[0].label.y} (F49: a label sits lower)`);
  }
  const active = tabs.filter((t) => t.active);
  if (active.length !== 1) failures.push(`${active.length} active tabs, want 1`);
  for (const t of tabs) {
    if (t.active) {
      if (t.color !== d.inks.ink1) failures.push(`${t.name} (active): label ${t.color}, want --ink-1 ${d.inks.ink1} (D8.8)`);
      if (t.color === d.inks.accent || t.color === d.inks.accentFill) failures.push(`${t.name} (active): red - selected is ink, never red (D8.8)`);
      if (t.href && !/-fill$/.test(t.href)) failures.push(`${t.name} (active): glyph ${t.href} is not the filled twin (F49)`);
    } else if (t.color !== d.inks.ink2) {
      failures.push(`${t.name}: label ${t.color}, want --ink-2 ${d.inks.ink2}`);
    }
  }
  const weights = new Set(tabs.map((t) => t.weight));
  if (weights.size > 1) failures.push(`tab labels differ in weight (${[...weights].join('/')})`);
  return { measured: { tabs: tabs.length }, failures };
}

// SHD (sweep S9): the sheet header's rendered contract (D4.6: a title plus ONE plain icon
// close button), measured on every OPEN ui.sheet: the Close sits on the header's trailing
// edge (inside its end padding) with or without a title - a titleless sheet once put it on
// the LEADING edge -, its glyph is centred in it on both axes, and a title sits level with
// it (same centre-y) and ends before it. Runs in the page.
function collectSheetHeader() {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  return Array.from(document.querySelectorAll('.ui-sheet.is-open')).map((s) => {
    const header = s.querySelector(':scope > .ui-sheet__header');
    const close = header && header.querySelector('.ui-sheet__close');
    const icon = close && close.querySelector('.ui-icon');
    const title = header && header.querySelector('.ui-sheet__title');
    const cs = header ? getComputedStyle(header) : null;
    return {
      name: title ? title.textContent.trim().slice(0, 30) : '(no title)',
      header: header ? box(header) : null,
      padEnd: cs ? parseFloat(cs.paddingRight) || 0 : 0,
      close: close ? box(close) : null,
      icon: icon ? box(icon) : null,
      title: title ? box(title) : null,
    };
  });
}

// -> { measured: {headers, titleless}, failures: [string] }
function evalSheetHeader(items, tol = TOL) {
  const failures = [];
  const cx = (b) => b.x + b.w / 2;
  const cy = (b) => b.y + b.h / 2;
  const r2 = (v) => Math.round(v * 100) / 100;
  for (const it of items) {
    if (!it.header || !it.close) { failures.push(`${it.name}: no header or no Close`); continue; }
    const trailing = it.header.x + it.header.w - it.padEnd;
    if (Math.abs((it.close.x + it.close.w) - trailing) > tol) failures.push(`${it.name}: Close ends at ${r2(it.close.x + it.close.w)}, not the header's trailing edge ${r2(trailing)}`);
    if (Math.abs(cy(it.close) - cy(it.header)) > tol) failures.push(`${it.name}: Close centre-y ${r2(cy(it.close))} vs header ${r2(cy(it.header))}`);
    if (!it.icon) failures.push(`${it.name}: the Close has no icon glyph`);
    else {
      if (Math.abs(cx(it.icon) - cx(it.close)) > tol) failures.push(`${it.name}: close glyph centre-x off by ${r2(cx(it.icon) - cx(it.close))}`);
      if (Math.abs(cy(it.icon) - cy(it.close)) > tol) failures.push(`${it.name}: close glyph centre-y off by ${r2(cy(it.icon) - cy(it.close))}`);
    }
    if (it.title) {
      if (Math.abs(cy(it.title) - cy(it.close)) > tol) failures.push(`${it.name}: title centre-y ${r2(cy(it.title))} vs Close ${r2(cy(it.close))} (not level)`);
      if (it.title.x + it.title.w > it.close.x + tol) failures.push(`${it.name}: the title runs under the Close`);
    }
  }
  return { measured: { headers: items.length, titleless: items.filter((i) => !i.title).length }, failures };
}

// POP (gate r1, adversary 4): an open menu is REACHABLE. Measured on the last open ui.sheet
// (the menu the scene opened from `anchor`), against the visual viewport:
// - the sheet's box lies inside the viewport;
// - every menu row lies inside the viewport, or the sheet body scrolls and its box does (the
//   row is reached by scrolling the menu, never the locked page); a row inside the viewport is
//   what elementFromPoint returns at its centre (nothing covers it);
// - a POPOVER that fits on one side of its anchor (the band less the --ui-pop-gap and the
//   safe areas ui.css hands to ui.js) never covers the anchor: it opens below it or flips
//   above it, and only shifts over it when it fits on neither side.
// Runs in the page; takes {anchor} (a selector for the control that opened the menu).
function collectPopover(arg) {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const sheets = document.querySelectorAll('.ui-sheet.is-open');
  const s = sheets[sheets.length - 1];
  const vv = window.visualViewport;
  const vp = vv ? { x: vv.offsetLeft, y: vv.offsetTop, w: vv.width, h: vv.height } : { x: 0, y: 0, w: innerWidth, h: innerHeight };
  if (!s) return { vp, sheet: null, rows: [] };
  const body = s.querySelector('.ui-sheet__body');
  const cs = getComputedStyle(s);
  const px = (n) => parseFloat(cs.getPropertyValue(n)) || 0;
  const anchorEl = arg && arg.anchor ? document.querySelector(arg.anchor) : null;
  const rows = Array.from(s.querySelectorAll('.ui-row')).map((r) => {
    const b = box(r);
    const hit = document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2);
    return { name: r.textContent.trim().slice(0, 30), box: b, hitSelf: !!hit && r.contains(hit) };
  });
  return {
    vp,
    popover: s.classList.contains('ui-sheet--popover'),
    sheet: box(s),
    body: body ? { box: box(body), scrolls: body.scrollHeight > body.clientHeight + 1 } : null,
    band: { gap: px('--ui-pop-gap'), safeTop: px('--ui-pop-safe-top'), safeBottom: px('--ui-pop-safe-bottom') },
    anchor: anchorEl ? box(anchorEl) : null,
    rows,
  };
}

// -> { measured: {rows}, failures: [string] }
function evalPopover(d, tol = TOL) {
  const failures = [];
  const r2 = (v) => Math.round(v * 100) / 100;
  if (!d || !d.sheet) return { measured: { rows: 0 }, failures: ['no open sheet'] };
  const top = d.vp.y;
  const bottom = d.vp.y + d.vp.h;
  const inside = (b) => b.y >= top - tol && b.y + b.h <= bottom + tol && b.x >= d.vp.x - tol && b.x + b.w <= d.vp.x + d.vp.w + tol;
  const span = (b) => `y${r2(b.y)}-${r2(b.y + b.h)}`;
  if (!inside(d.sheet)) failures.push(`the menu ${span(d.sheet)} x${r2(d.sheet.x)}-${r2(d.sheet.x + d.sheet.w)} leaves the ${r2(d.vp.w)}x${r2(d.vp.h)} viewport`);
  const scrollable = !!(d.body && d.body.scrolls && inside(d.body.box));
  for (const r of d.rows) {
    if (inside(r.box)) {
      if (!r.hitSelf) failures.push(`${r.name} (${span(r.box)}): something else is on top of it`);
    } else if (!scrollable) {
      failures.push(`${r.name} (${span(r.box)}) is off-screen and the menu does not scroll to it: unreachable`);
    }
  }
  if (d.popover) {
    if (!d.anchor) failures.push('the anchor was not found (a popover is placed against it)');
    else {
      const lo = top + d.band.safeTop + d.band.gap;
      const hi = bottom - d.band.safeBottom - d.band.gap;
      const fitsBelow = d.anchor.y + d.anchor.h + d.sheet.h <= hi + tol;
      const fitsAbove = d.anchor.y - d.sheet.h >= lo - tol;
      const covers = d.sheet.y < d.anchor.y + d.anchor.h - tol && d.sheet.y + d.sheet.h > d.anchor.y + tol;
      if ((fitsBelow || fitsAbove) && covers) failures.push(`the menu ${span(d.sheet)} covers its anchor ${span(d.anchor)} though it fits ${fitsBelow ? 'below' : 'above'} it`);
    }
  }
  return { measured: { rows: d.rows.length }, failures };
}

module.exports = { TOL, G4_TOL, collectG1, collectG2, collectG3, startG4Recorder, evalG1, evalG2, evalG3, evalG4,
  collectHeader, collectBottomBar, evalHeader, evalBottomBar, collectSheetHeader, evalSheetHeader, collectPopover, evalPopover };
