'use strict';
// FileTube reader page turn (v1.402.0, plan 2026-11-03-book-page-turn). A page you drag curls over like paper,
// in one-page and two-page views, for EPUB and PDF alike. This is the port of the approved prototype
// (docs/references/page-turn-prototype.html; Dean's three rounds): its geometry, rigs, spring and trigger, with the
// approved values and no tuning UI.
//
// The non-negotiable rule (prototype round 2): everything a turn shows is built and painted BEFORE the turn. A
// frame of a turn changes only `transform`, `opacity` and `visibility`; the fold is a big rotated box with
// `overflow: hidden` whose edge lies on the fold line, and the crease, the shade on the uncovered page and the
// lifted sheet's shadow are pre-built layers that are only moved, scaled and faded. No canvas drawing, no blur,
// no clip-path change and no text relayout during a turn.
//
// The engine knows nothing about books. It takes PAGE VIEWERS from a source (read.js: an epub.js rendition per
// viewer, or a canvas per viewer for PDF) through a small interface:
//   source.fixedAspect          null, or a page's width / height (PDF: the first page's ratio)
//   source.createViewer()       -> viewer
//   viewer.el                   the page box (the engine sizes it to one page through CSS variables)
//   viewer.show(gen, idx, anchor)  point the viewer at page idx of generation gen, whose page 0 is `anchor`
//                               (what the reader jumped to: a CFI, a spine index, a PDF page); returns a promise
//                               that settles once the viewer holds that page (or knows there is none)
//   viewer.present()            true when the viewer holds a real page (false past either end of the book)
//   viewer.destroy()
// A generation starts at every jump (open, Contents, chapter follow, a font change, a relayout): page 0 of the
// generation is the place jumped to, and turning moves the base page by one (one-page) or two (two-page). The
// engine only counts; the source turns (gen, idx, anchor) into a page.
//
// The pure parts (layout, fold geometry, the release decision, the spring) are exported for node:test with the
// prototype's values as fixtures (test/unit/page-turn.test.js).

// ---- The approved values (Dean, 2026-11-03: paper Book, shadow 60%, show-through 12%, settle 100%, turn at 30%)
const PT_PAPER = { lift: 1, blur: 18, dur: 1 };
const PT_SHADOW = 60;          // percent; the crease, under-shade and lift shadow scale by PT_SHADOW / 60
const PT_THROUGH = 0.12;       // the one-page back shows the front's text mirrored at this opacity
const PT_SPEED = 100;          // settle speed, percent
const PT_COMMIT = 0.3;         // a released drag turns once it has travelled this fraction of the page width
const PT_FLICK = 1.2;          // ...or on a flick faster than this (page widths per second)
const PT_FLICK_MIN_TRAVEL = 0.04;
const PT_PULLBACK = -0.4;      // a release moving back faster than this never turns
const PT_VEL_WINDOW_MS = 70;   // the release speed is measured over the last 70 ms of samples
const PT_STILL_MS = 80;        // a finger still for 80 ms before lifting has no speed
const PT_DRAG_PX = 6;          // a drag is recognised after 6 px of mostly-horizontal movement
const PT_NO_TAP_PX = 14;       // a press that wandered this far is no longer a tap
const PT_TOP_FRACTION = 0.42;  // a drag that starts above 42% of the page height lifts the top corner
const PT_AUTO_V0 = 2.4;        // a tap or an arrow starts the spring from rest with this speed
const PT_STACK_LAYERS = 7;     // up to 7 stacked page edges per side
const PT_SPREAD_MIN_W = 640;   // two pages when the reader is at least 640 px wide...
const PT_SPREAD_RATIO = 1.15;  // ...and wider than tall (the prototype's Auto: width > 1.15 x height)
const PT_CLICK_GUARD_MS = 350; // a click right after a drag is the drag's own, never a tap
// How strongly each reading theme shows the shades (the prototype's THEMES[].mul; night needs more to read).
const PT_THEME_SHADE = { paper: 1, sepia: 1.05, night: 1.9 };

function ptClamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// ---- 2D affine helpers, in CSS matrix(a, b, c, d, e, f) order
function ptMul(m, n) {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
function ptInv(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det; const b = -m[1] / det; const c = -m[2] / det; const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
function ptTr(x, y) { return [1, 0, 0, 1, x, y]; }
function ptCss(m) {
  return `matrix(${m[0].toFixed(5)},${m[1].toFixed(5)},${m[2].toFixed(5)},${m[3].toFixed(5)},${m[4].toFixed(2)},${m[5].toFixed(2)})`;
}

// ---- Layout: the page size, one or two pages, and where the book sits on the desk (prototype layout()).
// `aspect` is a fixed page width / height (a PDF's page) or null (a reflowed EPUB page).
function ptLayout(sw, sh, aspect) {
  const phone = sw < 600 || sh < 460;
  const spread = sw > sh * PT_SPREAD_RATIO && sw >= PT_SPREAD_MIN_W;
  const m = phone ? (spread ? 10 : 0) : 30;
  const aw = sw - 2 * m; const ah = sh - 2 * m;
  let W; let H;
  if (aspect) { H = Math.min(ah, (spread ? aw / 2 : aw) / aspect); W = H * aspect; }
  else if (spread) { H = ah; W = Math.min(aw / 2, H * 0.78); }
  else if (phone) { W = aw; H = ah; }
  else { H = ah; W = Math.min(aw, H * 0.7); }
  W = Math.max(1, Math.floor(W)); H = Math.max(1, Math.floor(H));
  const bookW = spread ? 2 * W : W;
  return { W, H, spread, bookW, B: Math.ceil(3 * Math.max(bookW, H)), bookX: Math.round((sw - bookW) / 2), bookY: Math.round((sh - H) / 2) };
}

// The pages each rig holds, as offsets from the base page, and which of them the turn lands on.
//   one-page forward:  front = b, back = b (its own text, mirrored), under = b + 1
//   one-page back:     front = b - 1, back = b - 1, under = b (the leaf starts turned over)
//   two-page forward:  other = b (left), front = b + 1, back = b + 2, under = b + 3
//   two-page back:     front = b (left), back = b - 1, under = b - 2, other = b + 1
function ptRigOffsets(spread, dir) {
  if (spread && dir > 0) return { other: 0, front: 1, back: 2, under: 3, step: 2, need: 'back', baseRole: 'other', landRole: 'back' };
  if (spread) return { other: 1, front: 0, back: -1, under: -2, step: -2, need: 'back', baseRole: 'front', landRole: 'under' };
  if (dir > 0) return { other: null, front: 0, back: 0, under: 1, step: 1, need: 'under', baseRole: 'front', landRole: 'under' };
  return { other: null, front: -1, back: -1, under: 0, step: -1, need: 'front', baseRole: 'under', landRole: 'front' };
}

// ---- The fold (prototype renderRig), pure. Geometry in the leaf's own frame: spine at u = 0, free edge at u = W.
// The dragged corner C (y = cy: 0 top, H bottom) goes to P; the fold is the perpendicular bisector of C-P, and
// the part of the leaf past it is mirrored across that line to become the sheet's back.
// rig: { startTurned, cy, spineX, s, slotX }; g: { W, H, B }; shade: the theme's PT_THEME_SHADE.
// Returns { rest: true, mask, innerFront } at rest, else every layer's transform and opacity.
function ptFold(rig, g, p, dy, shade) {
  const W = g.W; const H = g.H; const B = g.B;
  const a = ptClamp(rig.startTurned ? 1 - p : p, 0, 1);
  const cy = rig.cy; const sign = cy === 0 ? 1 : -1;
  let px = W - 2 * W * a;
  let py = cy + dy + sign * H * 0.075 * PT_PAPER.lift * Math.sin(Math.PI * a);
  const diag = Math.hypot(W, H); const oy = H - cy;
  let d = Math.hypot(px, py - oy);
  if (d > diag) { px = px * diag / d; py = oy + (py - oy) * diag / d; }
  d = Math.hypot(px, py - cy);
  if (d > W) { px = px * W / d; py = cy + (py - cy) * W / d; }
  const vx = W - px; const vy = cy - py; const dist = Math.hypot(vx, vy);
  if (dist < 0.5) {
    const m = ptTr(-B / 3, -B / 3);
    return { rest: true, a, mask: ptCss(m), innerFront: ptCss(ptInv(m)) };
  }
  const n = [vx / dist, vy / dist]; const M = [(W + px) / 2, (cy + py) / 2];
  const Mw = [rig.spineX + rig.s * M[0], M[1]]; const nw = [rig.s * n[0], n[1]];
  const k = Mw[0] * nw[0] + Mw[1] * nw[1];
  const R = [1 - 2 * nw[0] * nw[0], -2 * nw[0] * nw[1], -2 * nw[0] * nw[1], 1 - 2 * nw[1] * nw[1], 2 * k * nw[0], 2 * k * nw[1]];
  // The mask's local y axis points away from the fold into the side the reader still sees.
  const mv = [-nw[0], -nw[1]]; const dv = [mv[1], -mv[0]];
  const Mk = [dv[0], dv[1], mv[0], mv[1], Mw[0] - B / 2 * dv[0], Mw[1] - B / 2 * dv[1]];
  const iM = ptInv(Mk); const RT = ptMul(R, ptTr(rig.slotX, 0));
  const h = Math.max(dist / 2, 1);
  const w = Math.min(dist * 0.3, W * 0.28) + 4;
  const kk = (PT_SHADOW / 60) * shade;
  const ends = Math.min(1, dist / (W * 0.08)) * Math.min(1, (1 - a) * 5); // nothing left over at rest or once flat
  return {
    rest: false,
    a,
    fold: { M: Mw, n: nw },
    mask: ptCss(Mk),
    innerFront: ptCss(iM),
    innerBack: ptCss(ptMul(iM, RT)),
    backShade: ptCss(ptMul(ptInv(RT), ptMul(Mk, [1, 0, 0, h / 100, 0, 0]))),
    underShade: ptCss(ptMul(ptTr(-rig.slotX, 0), ptMul(Mk, [1, 0, 0, w / 100, 0, -w]))),
    underOpacity: ptClamp(kk * 0.8 * ends, 0, 1),
    backOpacity: ptClamp(kk * 0.85 * Math.min(1, (1 - a) * 5), 0, 1),
    liftOpacity: ptClamp(kk * 0.6 * Math.sin(Math.PI * a), 0, 1),
  };
}

// ---- Release: the speed the finger had, and whether letting go turns the page (prototype endDrag).
// samples: [[timeStamp, progress], ...] oldest first; upTime: the release event's timeStamp.
function ptReleaseVelocity(samples, upTime) {
  const now = samples[samples.length - 1];
  const old = now ? samples.find((s) => now[0] - s[0] < PT_VEL_WINDOW_MS) : null;
  if (now && old && now[0] > old[0] && upTime - now[0] < PT_STILL_MS) {
    return ptClamp((now[1] - old[1]) / ((now[0] - old[0]) / 1000), -12, 12);
  }
  return 0; // a finger at rest has no speed
}
// progress p in [0, 1] (finger travel / (2 x page width)); v in progress per second.
function ptShouldTurn(p, v) {
  const travel = p * 2; const flick = v * 2; // page widths moved, page widths per second
  return (flick > PT_FLICK && travel > PT_FLICK_MIN_TRAVEL) || (flick > PT_PULLBACK && travel >= PT_COMMIT);
}

// ---- The settle: a critically damped spring on progress, four sub-steps a frame (prototype settle()).
function ptOmega() { return 17 * (PT_SPEED / 100) / PT_PAPER.dur; }
function ptSpringStep(x, v, to, dt, w) {
  const h = ptClamp(dt, 0, 0.05) / 4;
  for (let i = 0; i < 4; i++) { v += (-w * w * (x - to) - 2 * w * v) * h; x += v * h; }
  if (x > 1) { x = 1; v = Math.min(v, 0); }
  if (x < 0) { x = 0; v = Math.max(v, 0); }
  return [x, v];
}
function ptSettled(x, v, to) { return Math.abs(x - to) < 0.002 && Math.abs(v) < 0.08; }

// Which way a press is going: 'wait' (not yet a drag), 'turn' (a sideways drag), or 'scroll' (vertical-ish;
// noTap once it has wandered). Prototype pointermove's recogniser.
function ptRecognize(dx, dy) {
  if (Math.abs(dx) < PT_DRAG_PX || Math.abs(dx) < Math.abs(dy) * 0.8) return { kind: 'wait', noTap: Math.hypot(dx, dy) > PT_NO_TAP_PX };
  return { kind: 'turn', dir: dx < 0 ? 1 : -1 };
}

// Page-edge stacks: read pages on the left, the rest on the right, from the book's fraction read.
function ptStackCounts(fraction, spread) {
  const f = ptClamp(Number(fraction) || 0, 0, 1);
  return { left: spread ? Math.round(f * PT_STACK_LAYERS) : 0, right: Math.round((1 - f) * PT_STACK_LAYERS) };
}

// ---- The engine (DOM). opts:
//   host            the element the book fills (read.js: #reader-pane); input listens on opts.inputRoot
//   inputRoot       the element pointer input is read from (read.js: .reader-content, which holds the tap zones)
//   source          the page-viewer source (see the header)
//   shadeTheme()    the reading theme's name (paper / sepia / night)
//   reducedMotion() true when the reader asked for less motion (P5: instant turns)
//   onPlace(viewer) a turn landed or a jump settled: viewer shows the new base page (read.js saves its place)
//   fraction()      the book's fraction read, for the page-edge stacks
function createPageTurn(opts) {
  const host = opts.host;
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const source = opts.source;
  const ac = new win.AbortController(); // the host window's own (a listener's signal must come from its realm in jsdom)
  const signal = ac.signal;
  const raf = (fn) => win.requestAnimationFrame(fn);
  const caf = (id) => win.cancelAnimationFrame(id);
  const div = (cls) => { const d = doc.createElement('div'); d.className = cls; return d; };
  // translate3d: every page box is its own layer, so a page raster is the same whichever wrapper shows it -
  // the landed frame equals the resting frame pixel for pixel (a 2D translate measured a 1-level difference).
  const place = (el, x) => { el.style.transform = `translate3d(${x}px,0,0)`; return el; };

  const desk = div('pt-desk');
  const book = div('pt-book');
  desk.appendChild(book);
  host.appendChild(desk);

  let G = null;       // layout
  let rigs = null;    // { f, b }
  let stacks = null;
  let viewers = [];
  let gen = 0;
  let base = 0;
  let anchor = null;
  let settledOnce = false;
  let swapAfter = null;
  let T = null;       // the turn in progress
  let drag = null;
  let pending = 0;    // a tap or arrow that waits for its rig to be ready
  let destroyed = false;
  let lastDragEnd = -1e9;
  let current = null; // the viewer showing the base page on the top rig (its place is the reader's place)

  function shade() { return PT_THEME_SHADE[opts.shadeTheme ? opts.shadeTheme() : 'paper'] || 1; }

  function setVars() {
    const vars = { '--pt-pw': G.W, '--pt-ph': G.H, '--pt-bw': G.bookW, '--pt-mb': G.B, '--pt-bx': G.bookX, '--pt-by': G.bookY };
    for (const k of Object.keys(vars)) desk.style.setProperty(k, `${vars[k]}px`);
    desk.style.setProperty('--pt-through', String(PT_THROUGH));
    desk.classList.toggle('is-spread', G.spread);
  }

  function newViewer(side) {
    const v = source.createViewer();
    v.el.classList.add('pt-page');
    if (side) v.el.classList.add(`pt-page--${side}`);
    viewers.push(v);
    return v;
  }

  // A rig is everything one direction of turn needs, already built and painted: the page beside the spine
  // (two-page only), the page underneath, and the leaf with its back. The leaf and its back sit in one rotated
  // mask whose edge is the fold line.
  function createRig(dir) {
    const W = G.W; const spread = G.spread;
    const r = spread
      ? (dir > 0 ? { s: 1, spineX: W, slotX: W, otherX: 0, sides: ['left', 'right', 'right', 'left'] }
        : { s: -1, spineX: W, slotX: 0, otherX: W, sides: ['right', 'left', 'left', 'right'] })
      : { s: 1, spineX: 0, slotX: 0, sides: [null, 'single', 'single', 'single'] };
    r.dir = dir; r.startTurned = !spread && dir < 0; r.cy = G.H;
    r.offsets = ptRigOffsets(spread, dir);
    r.root = div(spread ? 'pt-rig' : 'pt-rig pt-rig--clip');
    const [os, us, fs, bs] = r.sides;
    r.views = {};
    if (spread) { r.views.other = newViewer(os); r.root.appendChild(place(r.views.other.el, r.otherX)); }
    r.views.under = newViewer(us); r.views.front = newViewer(fs); r.views.back = newViewer(bs);
    const slot = place(div('pt-slot'), r.slotX);
    r.underShade = div('pt-under-shade');
    slot.append(r.views.under.el, r.underShade);
    r.mask = div('pt-mask');
    r.innerFront = div('pt-inner');
    r.innerFront.appendChild(place(r.views.front.el, r.slotX));
    r.innerBack = div('pt-inner pt-inner--back');
    r.lift = div('pt-lift');
    const leaf = div(`pt-leafback ${spread ? 'pt-leafback--mirror' : 'pt-leafback--through'}`);
    if (source.fixedAspect) leaf.classList.add('pt-leafback--scan'); // a scan's back is its own paper
    r.backShade = div('pt-back-shade');
    leaf.append(r.views.back.el, r.backShade);
    r.innerBack.append(r.lift, leaf);
    r.mask.append(r.innerFront, r.innerBack);
    r.root.append(slot, r.mask);
    r.ready = false;
    r.pointed = null;
    r.ticket = 0;
    return r;
  }

  // Point every viewer of a rig at the base page's neighbours; the rig is ready two frames after the last
  // viewer settles (the paint rule: a re-pointed view is never shown before it has painted).
  function pointRig(r) {
    const key = `${gen}:${base}`;
    if (r.pointed === key) return;
    r.pointed = key;
    r.ready = false;
    const ticket = ++r.ticket;
    const jobs = [];
    for (const role of ['other', 'front', 'back', 'under']) {
      const v = r.views[role];
      if (v) jobs.push(Promise.resolve(v.show(gen, base + r.offsets[role], anchor)).catch(() => {}));
    }
    Promise.all(jobs).then(() => {
      if (destroyed || ticket !== r.ticket) return;
      raf(() => raf(() => {
        if (destroyed || ticket !== r.ticket) return;
        r.ready = true;
        renderRig(r, 0, 0);
        onRigReady(r);
      }));
    });
  }

  function canTurn(r) { return r.ready && r.views[r.offsets.need].present(); }

  function renderRig(r, p, dy) {
    const f = ptFold(r, G, p, dy, shade());
    r.mask.style.transform = f.mask;
    r.innerFront.style.transform = f.innerFront;
    // At rest the leaf's back is transparent, not hidden: it stays painted (its own layer), so the first
    // frame of a turn only fades it in - nothing is painted mid-turn (the Chrome trace: 0 Paint events).
    if (f.rest) {
      r.innerBack.style.opacity = '0';
      r.underShade.style.opacity = '0';
      return;
    }
    r.innerBack.style.opacity = '1';
    r.innerBack.style.transform = f.innerBack;
    r.backShade.style.transform = f.backShade;
    r.underShade.style.transform = f.underShade;
    r.underShade.style.opacity = f.underOpacity.toFixed(3);
    r.backShade.style.opacity = f.backOpacity.toFixed(3);
    r.lift.style.opacity = f.liftOpacity.toFixed(3);
  }

  function showRig(r) {
    rigs.f.root.classList.toggle('is-top', r === rigs.f);
    rigs.b.root.classList.toggle('is-top', r === rigs.b);
    current = r.views[r.offsets.baseRole];
  }
  function topRig() { return rigs.f.root.classList.contains('is-top') ? rigs.f : rigs.b; }

  function stackEl(side) {
    const el = div(`pt-stack pt-stack--${side}`);
    el.dataset.layers = '0';
    return el;
  }
  function updateStacks() {
    if (!stacks) return;
    const c = ptStackCounts(opts.fraction ? opts.fraction() : 0, G.spread);
    stacks.left.dataset.layers = String(c.left);
    stacks.right.dataset.layers = String(c.right);
    stacks.left.hidden = !G.spread;
  }

  function build() {
    const sw = host.clientWidth; const sh = host.clientHeight;
    G = ptLayout(sw, sh, source.fixedAspect || null);
    setVars();
    for (const v of viewers) { try { v.destroy(); } catch (_) { /* gone */ } }
    viewers = [];
    book.replaceChildren();
    const sEl = div('pt-stacks');
    stacks = { left: place(stackEl('left'), 0), right: place(stackEl('right'), G.spread ? G.W : 0) };
    sEl.append(stacks.left, stacks.right);
    rigs = { f: createRig(1), b: createRig(-1) };
    book.append(sEl, rigs.b.root, rigs.f.root);
    for (const r of [rigs.f, rigs.b]) renderRig(r, 0, 0);
    showRig(rigs.f);
    updateStacks();
  }

  // A jump starts a generation: every viewer re-parks from page 0 of the new place.
  function jump(to) {
    if (T && T.raf) caf(T.raf);
    T = null; drag = null; pending = 0; swapAfter = null;
    host.classList.remove('is-dragging');
    gen += 1; base = 0; anchor = to;
    settledOnce = false;
    renderRig(rigs.f, 0, 0); renderRig(rigs.b, 0, 0);
    showRig(rigs.f);
    pointRig(rigs.f); pointRig(rigs.b);
  }
  // The place as DATA on the host (gen:base, and whether a turn is in flight), for probes and the tests.
  function stamp() { host.dataset.ptPlace = `${gen}:${base}`; host.dataset.ptTurning = T ? '1' : '0'; }
  function onRigReady(r) {
    maybeSwap(r);
    if (r === topRig() && !settledOnce && !T) { settledOnce = true; stamp(); if (opts.onPlace) opts.onPlace(current); }
    if (pending && !T) {
      const dir = pending;
      const want = dir > 0 ? rigs.f : rigs.b;
      if (r === want) { pending = 0; turnAuto(dir); }
    }
  }

  function beginTurn(dir, cy) {
    if (T) return false;
    const r = dir > 0 ? rigs.f : rigs.b;
    if (!canTurn(r)) return false;
    r.cy = cy;
    showRig(r);
    T = { rig: r, dir, p: 0, dy: 0, raf: 0, animTo: 0 };
    renderRig(r, 0, 0);
    stamp();
    return true;
  }

  // The landed rig already shows the new place. Point the other rig there too (it paints the same picture
  // behind), and once it is ready swap it up so the next turn either way is ready; then re-point the landed rig.
  function land() {
    const r = T.rig;
    base += r.offsets.step;
    T = null;
    const landed = r.views[r.offsets.landRole];
    current = landed;
    r.ready = false; // it shows the landed picture until it is re-pointed: no turn may start on it
    updateStacks();
    stamp();
    if (opts.onPlace) opts.onPlace(landed);
    const o = r === rigs.f ? rigs.b : rigs.f;
    o.cy = G.H;
    swapAfter = { landed: r, other: o };
    pointRig(o);
  }
  function maybeSwap(r) {
    if (!swapAfter || swapAfter.other !== r || T) return;
    const s = swapAfter;
    swapAfter = null;
    showRig(s.other);
    s.landed.cy = G.H;
    renderRig(s.landed, 0, 0);
    pointRig(s.landed);
  }
  function done(to) { if (to === 1) land(); else { T = null; stamp(); } }

  function settle(to, v0) {
    const t = T;
    t.animTo = to;
    let x = t.p; let v = v0; let dy = t.dy; let last = win.performance.now();
    const w = ptOmega();
    const step = (now) => {
      if (T !== t || destroyed) return;
      const dt = ptClamp((now - last) / 1000, 0, 0.05);
      last = now;
      [x, v] = ptSpringStep(x, v, to, dt, w);
      dy *= Math.exp(-w * 1.3 * dt);
      if (ptSettled(x, v, to)) { t.raf = 0; t.p = to; t.dy = 0; renderRig(t.rig, to, 0); done(to); return; }
      t.p = x; t.dy = dy;
      renderRig(t.rig, x, dy);
      t.raf = raf(step);
    };
    t.raf = raf(step);
  }
  function finishNow() {
    if (!T || !T.raf) return;
    caf(T.raf);
    T.raf = 0;
    const to = T.animTo;
    T.p = to; T.dy = 0;
    renderRig(T.rig, to, 0);
    done(to);
  }
  function instant(dir) {
    // P5: Reduce Motion changes the page at once - no curl, no spring.
    if (!beginTurn(dir, G.H)) return false;
    T.p = 1; renderRig(T.rig, 1, 0); done(1);
    return true;
  }
  function turnAuto(dir) {
    if (destroyed || !rigs) return;
    finishNow();
    if (T) return;
    const r = dir > 0 ? rigs.f : rigs.b;
    if (!r.ready) { pending = dir; return; } // runs the moment its rig has painted
    if (opts.reducedMotion && opts.reducedMotion()) { instant(dir); return; }
    if (!beginTurn(dir, G.H)) return;
    settle(1, PT_AUTO_V0 * (PT_SPEED / 100));
  }

  // ---- Input. Every move renders straight away (transforms only). Pointer events arrive from the page
  // around the book (inputRoot) and from inside each viewer's document (read.js attaches through
  // attachDocument), each mapped to the book's own coordinates.
  function bookPoint(clientX, clientY) {
    const rect = book.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }
  function down(e, map) {
    if ((e.pointerType === 'mouse' && e.button !== 0) || drag || !rigs || !e.isPrimary) return;
    const pt = map(e);
    const d = { id: e.pointerId, type: e.pointerType, map, x0: pt.x, y0: pt.y, by: pt.y, started: false, samples: [], src: e.view || null };
    if (T && T.raf) {
      // Catch a page in flight: it stops under the finger and follows it from there.
      caf(T.raf); T.raf = 0;
      Object.assign(d, { started: true, caught: true, dir: T.dir, p0: T.p, dy0: T.dy, animTo: T.animTo });
    } else if (T) return;
    drag = d;
    // A mouse press OUTSIDE a page's text (a tap zone, the desk): the drag's moves must keep reaching this
    // document as the cursor crosses the pages, so the pages' frames stop being hit targets - set at the
    // press, never mid-turn (it re-records hit-test paint: the Chrome trace counted it as a turn-time Paint).
    // A press inside a page's text needs nothing: the browser sends a pressed mouse's moves to that frame.
    if (d.type === 'mouse' && map === rootMap) host.classList.add('is-dragging');
  }
  function move(e, map) {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    const pt = (map || d.map)(e);
    const dx = pt.x - d.x0; const dy = pt.y - d.y0;
    if (!d.started) {
      if (!d.dir) {
        const rec = ptRecognize(dx, dy);
        if (rec.kind === 'wait') { if (rec.noTap) d.noTap = true; return; }
        d.dir = rec.dir; d.p0 = 0; d.dy0 = 0;
      }
      if (!beginTurn(d.dir, d.by < G.H * PT_TOP_FRACTION ? 0 : G.H)) {
        // Its rig is still painting the last turn's neighbours: keep the finger's progress, so a release that
        // meets the trigger still turns (queued until the rig is ready), and try to start again next move.
        d.samples.push([e.timeStamp, ptClamp(-d.dir * dx / (2 * G.W), 0, 1)]);
        if (d.samples.length > 8) d.samples.shift();
        return;
      }
      d.samples.length = 0;
      d.started = true;
      if (d.type === 'mouse') clearSelection(d.src);
      return;
    }
    if (!T) return;
    if (d.caught && Math.hypot(dx, dy) > PT_DRAG_PX) d.moved = true;
    T.p = ptClamp(d.p0 - d.dir * dx / (2 * G.W), 0, 1);
    T.dy = d.dy0 + dy;
    d.samples.push([e.timeStamp, T.p]);
    if (d.samples.length > 8) d.samples.shift();
    if (opts.reducedMotion && opts.reducedMotion()) return; // P5: no curl while dragging
    renderRig(T.rig, T.p, T.dy);
  }
  function up(e) {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    host.classList.remove('is-dragging');
    if (!d.started && d.dir && e.type === 'pointerup' && d.samples.length) {
      // A sideways drag that ended before its rig was ready: turn if it met the trigger (a quick second flick).
      const last = d.samples[d.samples.length - 1];
      if (ptShouldTurn(last[1], ptReleaseVelocity(d.samples, e.timeStamp))) { lastDragEnd = e.timeStamp; turnAuto(d.dir); }
      return;
    }
    if (!d.started || !T) return;
    lastDragEnd = e.timeStamp;
    if (d.caught && !d.moved) {
      // A tap on a page in flight lands that turn; a tap on a tap zone then starts the next one (its click).
      lastDragEnd = -1e9;
      T.p = d.animTo; T.dy = 0; renderRig(T.rig, d.animTo, 0); done(d.animTo);
      return;
    }
    const v = ptReleaseVelocity(d.samples, e.timeStamp);
    const turn = e.type === 'pointerup' && ptShouldTurn(T.p, v);
    if (opts.reducedMotion && opts.reducedMotion()) {
      T.p = turn ? 1 : 0; T.dy = 0; renderRig(T.rig, T.p, 0); done(T.p);
      return;
    }
    settle(turn ? 1 : 0, v);
  }
  function clearSelection(view) {
    try { if (view && view.getSelection) view.getSelection().removeAllRanges(); } catch (_) { /* fine */ }
  }

  const rootMap = (e) => bookPoint(e.clientX, e.clientY);
  // Attach input to a viewer's own document (an epub.js chapter). The frame's position is read at the press:
  // a page under the finger at rest only ever translates, so the mapping holds for the whole drag.
  function attachDocument(viewDoc, frameEl) {
    const map = (e) => {
      const fr = frameEl.getBoundingClientRect();
      return bookPoint(fr.left + e.clientX, fr.top + e.clientY);
    };
    const o = { passive: true, signal };
    viewDoc.addEventListener('pointerdown', (e) => {
      const fr = frameEl.getBoundingClientRect();
      const fixed = (ev) => bookPoint(fr.left + ev.clientX, fr.top + ev.clientY);
      down(e, fixed);
    }, o);
    viewDoc.addEventListener('pointermove', (e) => move(e, drag && drag.map), o);
    viewDoc.addEventListener('pointerup', up, o);
    viewDoc.addEventListener('pointercancel', up, o);
    return map;
  }

  const input = opts.inputRoot || host;
  const po = { passive: true, signal };
  input.addEventListener('pointerdown', (e) => down(e, rootMap), po);
  // A drag that started in a page's text and left it (mouse) arrives here: map it in this document's terms.
  input.addEventListener('pointermove', (e) => move(e, rootMap), po);
  input.addEventListener('pointerup', up, po);
  input.addEventListener('pointercancel', up, po);
  doc.addEventListener('pointerup', up, po);
  // The click a drag's release produces belongs to the drag (a tap zone under the finger must not turn again).
  input.addEventListener('click', (e) => {
    if (e.timeStamp - lastDragEnd < PT_CLICK_GUARD_MS) { e.stopPropagation(); e.preventDefault(); }
  }, { capture: true, signal });

  build();

  return {
    jump,
    next: () => turnAuto(1),
    prev: () => turnAuto(-1),
    // A size or orientation change rebuilds the rigs (new viewers) and the source jumps back to its place.
    rebuild: (to) => { if (T && T.raf) caf(T.raf); T = null; drag = null; pending = 0; swapAfter = null; build(); jump(to); },
    attachDocument,
    isCurrent: (v) => v === current && !T && !swapAfter,
    current: () => current,
    turning: () => Boolean(T),
    layout: () => G,
    viewers: () => viewers.slice(),
    refreshStacks: updateStacks,
    destroy: () => {
      destroyed = true;
      if (T && T.raf) caf(T.raf);
      ac.abort();
      for (const v of viewers) { try { v.destroy(); } catch (_) { /* gone */ } }
      viewers = [];
      desk.remove();
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PT_PAPER, PT_SHADOW, PT_THROUGH, PT_COMMIT, PT_FLICK, PT_PULLBACK, PT_DRAG_PX, PT_TOP_FRACTION, PT_AUTO_V0,
    PT_SPREAD_MIN_W, PT_SPREAD_RATIO, PT_STACK_LAYERS, PT_THEME_SHADE,
    ptLayout, ptRigOffsets, ptFold, ptReleaseVelocity, ptShouldTurn, ptOmega, ptSpringStep, ptSettled,
    ptRecognize, ptStackCounts, ptMul, ptInv, createPageTurn,
  };
}
if (typeof window !== 'undefined') {
  window.FileTubePageTurn = { createPageTurn, ptLayout };
}
