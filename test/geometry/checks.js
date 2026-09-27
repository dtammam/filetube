'use strict';
// Geometry checks G1-G4 (UI professionalism pass, plan D10.2). Two halves:
//
// - COLLECTORS run in the page (passed to page.evaluate, so each is self-contained): they
//   read getBoundingClientRect() boxes off the live DOM and return plain data;
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

const TOL = 0.5;
const G4_TOL = 1;

// ---------------------------------------------------------------- collectors (in the page)

function collectG1() {
  const SLOTS = ['lead', 'media', 'body', 'aside', 'actions'];
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 || r.height > 0; };
  const lists = [];
  document.querySelectorAll('.ui-list').forEach((list, li) => {
    if (!shown(list)) return;
    const rows = Array.from(list.querySelectorAll('.ui-row')).filter((r) => r.closest('.ui-list') === list && shown(r));
    lists.push({
      list: list.getAttribute('aria-label') || `ui-list #${li + 1}`,
      rows: rows.map((row) => {
        const slots = {};
        for (const s of SLOTS) {
          const el = Array.from(row.children).find((c) => c.classList.contains('ui-row__' + s));
          slots[s] = el ? el.getBoundingClientRect().left : null;
        }
        return { title: (row.querySelector('.ui-row__title') || row).textContent.trim().slice(0, 40), slots };
      }),
    });
  });
  return lists;
}

function collectG2() {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const name = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  const items = [];
  document.querySelectorAll('.ui-btn').forEach((btn) => {
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
  document.querySelectorAll('.ui-row .ui-icon').forEach((icon) => {
    if (icon.closest('.ui-btn') || !visible(icon)) return;
    const row = icon.closest('.ui-row');
    const body = row && Array.from(row.children).find((c) => c.classList.contains('ui-row__body'));
    if (!body || !visible(body)) return;
    items.push({ where: 'ui-row', name: name(row), axis: 'y', refKind: 'row body', icon: box(icon), ref: box(body) });
  });
  return items;
}

function collectG3() {
  const groups = new Map();
  document.querySelectorAll('.ui-btn').forEach((btn) => {
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
function startG4Recorder(maxElements) {
  const cap = maxElements || 2500;
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
    for (const slot of Object.keys(ref.slots)) {
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

module.exports = { TOL, G4_TOL, collectG1, collectG2, collectG3, startG4Recorder, evalG1, evalG2, evalG3, evalG4 };
