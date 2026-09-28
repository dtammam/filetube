'use strict';

// [UNIT] UI professionalism pass, step 3 (plan D4 / D6 / D9): the DOM contract of
// public/js/ui.js, the builders ui.css styles. Every builder runs for real against
// a jsdom document; timers (sheet exit, toast queue, the next-frame fallback) run
// on node:test's mock clock so the order is deterministic, not a race.
// Plus a source lock: no inline visual style (only the listed custom properties)
// and no markup strings.

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ui = require('../../public/js/ui.js');
const BL = require('../../public/js/body-scroll-lock.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'ui.js'), 'utf8');

function page(opts) {
  const dom = new JSDOM('<!DOCTYPE html><body><main><button id="opener">open</button></main></body>');
  const win = dom.window;
  win.FileTubeBodyLock = BL;
  win.scrollTo = () => {};
  const phone = !!(opts && opts.phone);
  win.matchMedia = (q) => ({ matches: q === '(max-width: 768px)' ? phone : false, media: q });
  return { win, doc: win.document };
}
function classes(n) { return (n.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
function kids(n) { return Array.from(n.children); }
function key(win, target, k) {
  const e = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}
function clock() { mock.timers.enable({ apis: ['setTimeout'] }); return mock.timers; }
afterEach(() => { mock.timers.reset(); });

// Every element under root carries no inline style except the listed custom properties.
const ALLOWED_PROPS = new Set(['--p', '--ui-anchor-x', '--ui-anchor-y', '--ui-drag']);
function assertNoInlineStyle(root) {
  const all = [root, ...root.querySelectorAll('*')];
  for (const n of all) {
    const st = n.style;
    if (!st) continue;
    for (let i = 0; i < st.length; i++) {
      assert.ok(ALLOWED_PROPS.has(st[i]), 'inline style ' + st[i] + ' on ' + n.tagName + '.' + n.getAttribute('class'));
    }
  }
}

// ------------------------------------------------------------------ icon
test('ui.icon: the svg/use contract, dots become dashes, sizes and extra class', () => {
  const { doc } = page();
  const s = ui.icon('keep.fill', { doc, size: 'lg', cls: 'x-y' });
  assert.strictEqual(s.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.strictEqual(s.tagName, 'svg');
  assert.deepStrictEqual(classes(s), ['ui-icon', 'ui-icon--lg', 'x-y']);
  assert.strictEqual(s.getAttribute('aria-hidden'), 'true');
  assert.strictEqual(s.getAttribute('focusable'), 'false');
  assert.strictEqual(s.children.length, 1);
  assert.strictEqual(s.children[0].tagName, 'use');
  assert.strictEqual(s.children[0].getAttribute('href'), '#i-keep-fill');
  assert.deepStrictEqual(classes(ui.icon('close', { doc })), ['ui-icon', 'ui-icon--md'], 'md is the default');
  assert.deepStrictEqual(classes(ui.icon('close', { doc, size: 'huge' })), ['ui-icon', 'ui-icon--md']);
});

test('ui.icon: an unknown name THROWS naming it (F39: never a blank glyph), in buttons and toggles too', () => {
  const { doc } = page();
  assert.throws(() => ui.icon('no_such_glyph', { doc }), /no_such_glyph/);
  assert.throws(() => ui.button({ icon: 'bogus_one', label: 'x', doc }), /bogus_one/);
  // The toggle's OTHER state is checked at build time, not at the first tap.
  assert.throws(() => ui.button({ icon: { off: 'keep', on: 'keep.nope' }, pressed: false, label: 'x', doc }), /keep\.nope/);
});

// ------------------------------------------------------------------ button
test('ui.button: classes, type, icon slot then label, icon size per button size/shape', () => {
  const { doc } = page();
  let clicks = 0;
  const b = ui.button({ variant: 'primary', size: 'lg', icon: 'share', label: 'Share', pill: true, onClick: () => { clicks++; }, doc });
  assert.strictEqual(b.tagName, 'BUTTON');
  assert.deepStrictEqual(classes(b), ['ui-btn', 'ui-btn--primary', 'ui-btn--lg', 'ui-btn--pill']);
  assert.strictEqual(b.getAttribute('type'), 'button');
  assert.strictEqual(b.hasAttribute('aria-pressed'), false, 'not a toggle');
  assert.deepStrictEqual(kids(b).map((k) => k.className), ['ui-btn__icon', 'ui-btn__label']);
  assert.deepStrictEqual(classes(b.querySelector('svg')), ['ui-icon', 'ui-icon--md']);
  assert.strictEqual(b.querySelector('.ui-btn__label').textContent, 'Share');
  b.click();
  assert.strictEqual(clicks, 1);

  const d = ui.button({ label: 'Cancel', doc });
  assert.deepStrictEqual(classes(d), ['ui-btn', 'ui-btn--secondary', 'ui-btn--md'], 'defaults');
  assert.deepStrictEqual(kids(d).map((k) => k.className), ['ui-btn__label']);

  const sm = ui.button({ size: 'sm', icon: 'add', label: 'Add', doc });
  assert.deepStrictEqual(classes(sm.querySelector('svg')), ['ui-icon', 'ui-icon--sm']);
  const st = ui.button({ shape: 'stack', icon: 'thumb_up', label: 'Like', doc });
  assert.deepStrictEqual(classes(st), ['ui-btn', 'ui-btn--secondary', 'ui-btn--md', 'ui-btn--stack']);
  assert.deepStrictEqual(classes(st.querySelector('svg')), ['ui-icon', 'ui-icon--lg']);

  const dis = ui.button({ label: 'x', disabled: true, type: 'submit', ariaLabel: 'Do x', doc });
  assert.strictEqual(dis.disabled, true);
  assert.strictEqual(dis.getAttribute('type'), 'submit');
  assert.strictEqual(dis.getAttribute('aria-label'), 'Do x');
  assertNoInlineStyle(b);
});

test('ui.button shape icon: no label span, ariaLabel REQUIRED', () => {
  const { doc } = page();
  assert.throws(() => ui.button({ shape: 'icon', icon: 'close', doc }), /ariaLabel/);
  const b = ui.button({ variant: 'plain', shape: 'icon', icon: 'close', label: 'ignored', ariaLabel: 'Close', doc });
  assert.deepStrictEqual(classes(b), ['ui-btn', 'ui-btn--plain', 'ui-btn--md', 'ui-btn--icon']);
  assert.strictEqual(b.querySelector('.ui-btn__label'), null);
  assert.deepStrictEqual(kids(b).map((k) => k.className), ['ui-btn__icon']);
  assert.strictEqual(b.getAttribute('aria-label'), 'Close');
});

test('ui.button toggle: stable label stack (every label laid out, only the current one live) and setPressed swaps stack + icon', () => {
  const { doc } = page();
  const b = ui.button({ icon: { off: 'keep', on: 'keep.fill' }, labels: ['Pin', 'Pinned'], pressed: false, doc });
  assert.strictEqual(b.getAttribute('aria-pressed'), 'false');
  const stack = b.querySelector('.ui-btn__label');
  assert.deepStrictEqual(classes(stack), ['ui-btn__label', 'ui-btn__stack']);
  assert.strictEqual(stack.getAttribute('data-label'), 'Pin');
  const slots = kids(stack);
  assert.deepStrictEqual(slots.map((s) => s.className), ['ui-btn__slot', 'ui-btn__slot']);
  assert.deepStrictEqual(slots.map((s) => s.textContent), ['Pin', 'Pinned']);
  assert.deepStrictEqual(slots.map((s) => s.hasAttribute('data-idle')), [false, true]);
  assert.strictEqual(b.querySelector('use').getAttribute('href'), '#i-keep');

  ui.setPressed(b, true);
  assert.strictEqual(b.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(stack.getAttribute('data-label'), 'Pinned');
  assert.deepStrictEqual(slots.map((s) => s.hasAttribute('data-idle')), [true, false]);
  assert.strictEqual(b.querySelector('use').getAttribute('href'), '#i-keep-fill');

  ui.setPressed(b, false);
  assert.strictEqual(b.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(stack.getAttribute('data-label'), 'Pin');
  assert.deepStrictEqual(slots.map((s) => s.hasAttribute('data-idle')), [false, true]);
  assert.strictEqual(b.querySelector('use').getAttribute('href'), '#i-keep');

  const on = ui.button({ labels: ['Like', 'Liked'], pressed: true, doc });
  assert.strictEqual(on.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(on.querySelector('.ui-btn__stack').getAttribute('data-label'), 'Liked');
  assert.deepStrictEqual(Array.from(on.querySelectorAll('.ui-btn__slot')).map((s) => s.hasAttribute('data-idle')), [true, false]);

  const iconToggle = ui.button({ shape: 'icon', icon: { off: 'notifications_off', on: 'notifications_active' }, pressed: true, ariaLabel: 'Notify', doc });
  assert.strictEqual(iconToggle.querySelector('use').getAttribute('href'), '#i-notifications_active');
  ui.setPressed(iconToggle, false);
  assert.strictEqual(iconToggle.querySelector('use').getAttribute('href'), '#i-notifications_off');
});

test('ui.setBusy: aria-busy="true" on, removed off', () => {
  const { doc } = page();
  const b = ui.button({ label: 'Save', doc });
  ui.setBusy(b, true);
  assert.strictEqual(b.getAttribute('aria-busy'), 'true');
  ui.setBusy(b, false);
  assert.strictEqual(b.hasAttribute('aria-busy'), false);
});

// ------------------------------------------------------------------ list / row
test('ui.list: every modifier class present, role list, label', () => {
  const { doc } = page();
  const l = ui.list({ size: 'media', grouped: true, media: 'thumb', aside: 'text', actions: 2, divider: 'full', label: 'Episodes', doc });
  assert.strictEqual(l.tagName, 'DIV');
  assert.deepStrictEqual(classes(l), ['ui-list', 'ui-list--media', 'ui-list--media-thumb', 'ui-list--aside-text',
    'ui-list--actions-2', 'ui-list--divider-full', 'ui-list--grouped']);
  assert.strictEqual(l.getAttribute('role'), 'list');
  assert.strictEqual(l.getAttribute('aria-label'), 'Episodes');
  const d = ui.list({ doc });
  assert.deepStrictEqual(classes(d), ['ui-list', 'ui-list--default', 'ui-list--media-none', 'ui-list--aside-none',
    'ui-list--actions-0', 'ui-list--divider-inset']);
  // the unread-dot column is opt-in (a list that shows dots declares it)
  assert.ok(classes(ui.list({ lead: true, doc })).includes('ui-list--lead'));
  assert.ok(!classes(d).includes('ui-list--lead'));
  assertNoInlineStyle(l);
});

test('ui.row: slots ALWAYS present and in order; empty ones reserved', () => {
  const { doc } = page();
  const r = ui.row({ title: 'Just a title', doc });
  assert.strictEqual(r.tagName, 'DIV');
  assert.deepStrictEqual(classes(r), ['ui-row', 'ui-row--default']);
  assert.strictEqual(r.getAttribute('role'), 'listitem');
  assert.deepStrictEqual(kids(r).map((k) => k.className), ['ui-row__lead', 'ui-row__media', 'ui-row__body', 'ui-row__aside', 'ui-row__actions']);
  assert.deepStrictEqual(kids(r).map((k) => k.tagName), ['SPAN', 'SPAN', 'SPAN', 'SPAN', 'SPAN']);
  assert.strictEqual(r.querySelector('.ui-row__media').childNodes.length, 0);
  assert.strictEqual(r.querySelector('.ui-row__aside').childNodes.length, 0);
  assert.deepStrictEqual(kids(r.querySelector('.ui-row__body')).map((k) => k.className), ['ui-row__title']);
  assert.throws(() => ui.row({ doc }), /title/);
});

test('ui.row: full row - dot lead, media, overline/title/meta, aside, actions with a reserved null slot', () => {
  const { doc } = page();
  const av = ui.avatar({ name: 'A B', doc });
  const act = ui.button({ variant: 'plain', shape: 'icon', icon: 'more_vert', ariaLabel: 'More', doc });
  const r = ui.row({ size: 'media', lead: 'dot', media: av, overline: 'NEW', title: 'Episode <b>1</b>', meta: '3 min', aside: '12:00', actions: [null, act], danger: true, doc });
  assert.deepStrictEqual(classes(r), ['ui-row', 'ui-row--media', 'ui-row--danger']);
  assert.strictEqual(r.tagName, 'DIV');
  assert.strictEqual(r.querySelector('.ui-row__lead').children[0].className, 'ui-row__dot');
  assert.strictEqual(r.querySelector('.ui-row__media').children[0], av);
  assert.deepStrictEqual(kids(r.querySelector('.ui-row__body')).map((k) => k.className), ['ui-row__overline', 'ui-row__title', 'ui-row__meta']);
  assert.strictEqual(r.querySelector('.ui-row__title').textContent, 'Episode <b>1</b>', 'user text stays text');
  assert.strictEqual(r.querySelector('b'), null);
  assert.strictEqual(r.querySelector('.ui-row__aside').textContent, '12:00');
  const acts = kids(r.querySelector('.ui-row__actions'));
  assert.strictEqual(acts.length, 2);
  assert.strictEqual(acts[0].className, 'ui-row__slot');
  assert.strictEqual(acts[0].getAttribute('aria-hidden'), 'true');
  assert.strictEqual(acts[1], act);
  const metaNode = doc.createElement('em');
  const r2 = ui.row({ title: 't', meta: metaNode, aside: doc.createElement('i'), doc });
  assert.strictEqual(r2.querySelector('.ui-row__meta').children[0], metaNode);
  assert.strictEqual(r2.querySelector('.ui-row__aside').children[0].tagName, 'I');
  assert.strictEqual(r2.querySelector('.ui-row__lead').childNodes.length, 0, 'lead empty unless dot');
});

test('ui.row: the tag rule - a / button / div, and a div row with actions carries the link in its title', () => {
  const { doc } = page();
  const a = ui.row({ title: 'Go', href: '/watch?v=1', doc });
  assert.strictEqual(a.tagName, 'A');
  assert.strictEqual(a.getAttribute('href'), '/watch?v=1');
  assert.strictEqual(a.querySelector('.ui-row__link'), null);

  let clicked = 0;
  const b = ui.row({ title: 'Tap', onClick: () => { clicked++; }, doc });
  assert.strictEqual(b.tagName, 'BUTTON');
  assert.strictEqual(b.getAttribute('type'), 'button');
  b.click();
  assert.strictEqual(clicked, 1);

  const act = ui.button({ shape: 'icon', icon: 'delete', ariaLabel: 'Delete', doc });
  const withActs = ui.row({ title: 'Tap me', onClick: () => { clicked++; }, actions: [act], doc });
  assert.strictEqual(withActs.tagName, 'DIV', 'a button cannot contain buttons');
  const link = withActs.querySelector('.ui-row__title > button.ui-row__link');
  assert.ok(link, 'the title holds a button link');
  assert.strictEqual(link.getAttribute('type'), 'button');
  assert.strictEqual(link.textContent, 'Tap me');
  link.click();
  assert.strictEqual(clicked, 2);
  act.click();
  assert.strictEqual(clicked, 2, 'an action does not trigger the row');

  const hrefActs = ui.row({ title: 'Channel', href: '/c/1', actions: [null], doc });
  assert.strictEqual(hrefActs.tagName, 'DIV');
  const al = hrefActs.querySelector('.ui-row__title > a.ui-row__link');
  assert.ok(al);
  assert.strictEqual(al.getAttribute('href'), '/c/1');
  assert.strictEqual(hrefActs.hasAttribute('href'), false);
});

// ------------------------------------------------------------------ avatar / thumb
test('ui.avatar: monogram initials, stable tone 1..8, circle vs art by kind, size', () => {
  const { doc } = page();
  const a = ui.avatar({ name: 'linus tech tips', doc });
  assert.deepStrictEqual(classes(a), ['ui-avatar', 'ui-avatar--md']);
  const m = a.querySelector('.ui-avatar__mono');
  assert.strictEqual(m.tagName, 'SPAN');
  assert.strictEqual(m.textContent, 'LT');
  const tone = Number(m.getAttribute('data-tone'));
  assert.ok(tone >= 1 && tone <= 8);
  assert.strictEqual(ui.avatar({ name: 'linus tech tips', doc }).querySelector('.ui-avatar__mono').getAttribute('data-tone'), String(tone), 'stable');
  assert.strictEqual(ui.avatar({ name: '', doc }).textContent, '?');
  assert.strictEqual(ui.avatar({ name: '   ', doc }).textContent, '?');
  assert.strictEqual(ui.avatar({ name: 'madonna', doc }).textContent, 'M');
  // The tone really spreads over the palette (a constant tone would pass a range check).
  const tones = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p'].map((n) => ui.toneOf(n)));
  assert.ok(tones.size >= 5, 'tones seen: ' + [...tones]);
  for (const kind of ['podcast', 'album', 'book']) {
    assert.deepStrictEqual(classes(ui.avatar({ name: 'x', kind, size: 'xl', doc })), ['ui-art', 'ui-avatar--xl'], kind);
  }
  assert.deepStrictEqual(classes(ui.avatar({ name: 'x', kind: 'person', size: '2xl', doc })), ['ui-avatar', 'ui-avatar--2xl']);
});

test('ui.avatar: a photo url paints an img; a BROKEN image becomes the monogram (never a broken glyph)', () => {
  const { win, doc } = page();
  const a = ui.avatar({ name: 'Some Channel', url: '/avatars/x.jpg', doc });
  const img = a.querySelector('img');
  assert.strictEqual(img.className, 'ui-avatar__img');
  assert.strictEqual(img.getAttribute('alt'), '');
  assert.strictEqual(img.getAttribute('decoding'), 'async');
  assert.strictEqual(img.getAttribute('loading'), 'lazy');
  assert.strictEqual(img.getAttribute('src'), '/avatars/x.jpg');
  assert.strictEqual(a.querySelector('.ui-avatar__mono'), null, 'no monogram while the photo stands');
  img.dispatchEvent(new win.Event('error'));
  assert.strictEqual(a.querySelector('img'), null, 'the broken img is removed');
  assert.strictEqual(a.querySelector('.ui-avatar__mono').textContent, 'SC');
  img.dispatchEvent(new win.Event('error'));
  assert.strictEqual(a.querySelectorAll('.ui-avatar__mono').length, 1, 'one monogram only');
});

test('ui.thumb: aspect/context classes, img, duration text, progress --p clamped, error keeps the ground', () => {
  const { win, doc } = page();
  const t = ui.thumb({ src: '/t.jpg', aspect: '1x1', context: 'row', duration: 3725, progress: 0.25, alt: 'cover', doc });
  assert.strictEqual(t.tagName, 'DIV');
  assert.deepStrictEqual(classes(t), ['ui-thumb', 'ui-thumb--1x1', 'ui-thumb--row']);
  assert.deepStrictEqual(kids(t).map((k) => k.className), ['ui-thumb__img', 'ui-thumb__duration', 'ui-thumb__progress']);
  assert.strictEqual(t.querySelector('img').getAttribute('alt'), 'cover');
  assert.strictEqual(t.querySelector('.ui-thumb__duration').textContent, '1:02:05');
  const bar = t.querySelector('.ui-thumb__progress > .ui-thumb__bar');
  assert.strictEqual(bar.style.getPropertyValue('--p'), '0.25');
  assertNoInlineStyle(t);

  const d = ui.thumb({ doc });
  assert.deepStrictEqual(classes(d), ['ui-thumb', 'ui-thumb--16x9', 'ui-thumb--card']);
  assert.strictEqual(d.children.length, 0, 'no src/duration/progress -> just the ground');
  assert.strictEqual(ui.thumb({ duration: 65, doc }).querySelector('.ui-thumb__duration').textContent, '1:05');
  assert.strictEqual(ui.thumb({ duration: 5, doc }).querySelector('.ui-thumb__duration').textContent, '0:05');
  assert.strictEqual(ui.thumb({ duration: 0, progress: 0, doc }).children.length, 0);
  assert.strictEqual(ui.thumb({ progress: 7, doc }).querySelector('.ui-thumb__bar').style.getPropertyValue('--p'), '1');

  const img = t.querySelector('img');
  img.dispatchEvent(new win.Event('error'));
  assert.strictEqual(t.querySelector('img'), null);
  assert.ok(t.isConnected === false && t.classList.contains('ui-thumb'), 'the ground element stays');
});

// ------------------------------------------------------------------ chip
test('ui.chip: filter button aria-pressed, meta span, count hidden at 0', () => {
  const { doc } = page();
  let n = 0;
  const f = ui.chip({ kind: 'filter', label: 'Music', selected: true, onClick: () => { n++; }, doc });
  assert.strictEqual(f.tagName, 'BUTTON');
  assert.deepStrictEqual(classes(f), ['ui-chip', 'ui-chip--filter']);
  assert.strictEqual(f.getAttribute('type'), 'button');
  assert.strictEqual(f.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(f.textContent, 'Music');
  f.click();
  assert.strictEqual(n, 1);
  assert.strictEqual(ui.chip({ kind: 'filter', label: 'x', doc }).getAttribute('aria-pressed'), 'false');
  const m = ui.chip({ kind: 'meta', label: '1.2K subscribers', doc });
  assert.strictEqual(m.tagName, 'SPAN');
  assert.deepStrictEqual(classes(m), ['ui-chip', 'ui-chip--meta']);
  const c = ui.chip({ kind: 'count', label: 3, doc });
  assert.deepStrictEqual(classes(c), ['ui-chip', 'ui-chip--count']);
  assert.strictEqual(c.textContent, '3');
  assert.strictEqual(c.hidden, false);
  assert.strictEqual(ui.chip({ kind: 'count', label: 0, doc }).hidden, true);
});

// ------------------------------------------------------------------ sheet
test('ui.sheet: DOM contract (dialog), is-open ALWAYS added on the next frame, focus in, lock taken', () => {
  const t = clock();
  const { doc, win } = page();
  // Reduced motion must not skip the open class (F48).
  win.matchMedia = (q) => ({ matches: q === '(prefers-reduced-motion: reduce)', media: q });
  const opener = doc.getElementById('opener');
  opener.focus();
  const content = doc.createElement('p');
  content.textContent = 'hello';
  const c = ui.sheet({ variant: 'dialog', title: 'Title <i>x</i>', content, doc, win });
  assert.strictEqual(c.el.isConnected, false, 'not in the DOM before open');
  c.open();
  assert.strictEqual(c.isOpen(), true);
  const bodyKids = kids(doc.body);
  assert.strictEqual(bodyKids[bodyKids.length - 2], c.scrim);
  assert.strictEqual(bodyKids[bodyKids.length - 1], c.el);
  assert.deepStrictEqual(classes(c.scrim), ['ui-scrim']);
  assert.deepStrictEqual(classes(c.el), ['ui-sheet', 'ui-sheet--dialog']);
  assert.strictEqual(c.el.getAttribute('role'), 'dialog');
  assert.strictEqual(c.el.getAttribute('aria-modal'), 'true');
  assert.strictEqual(c.el.hidden, false);
  assert.deepStrictEqual(kids(c.el).map((k) => k.className), ['ui-sheet__header', 'ui-sheet__body']);
  const h = c.el.querySelector('.ui-sheet__header > h2.ui-sheet__title');
  assert.strictEqual(h.textContent, 'Title <i>x</i>');
  assert.strictEqual(c.el.getAttribute('aria-labelledby'), h.id);
  assert.ok(h.id);
  const close = c.el.querySelector('.ui-sheet__header > .ui-sheet__close');
  assert.deepStrictEqual(classes(close), ['ui-btn', 'ui-btn--plain', 'ui-btn--md', 'ui-btn--icon', 'ui-sheet__close']);
  assert.strictEqual(close.getAttribute('aria-label'), 'Close');
  assert.strictEqual(c.body, c.el.querySelector('.ui-sheet__body'));
  assert.strictEqual(c.body.children[0], content);
  assert.strictEqual(BL.isLocked(doc), true, 'body lock taken');
  assert.strictEqual(doc.activeElement, c.el, 'focus moved into the sheet (the sheet itself, so no ring on Close)');
  assert.strictEqual(c.el.getAttribute('tabindex'), '-1');
  assert.strictEqual(c.el.classList.contains('is-open'), false, 'not before the frame');
  t.tick(16);
  assert.strictEqual(c.el.classList.contains('is-open'), true);
  assert.strictEqual(c.scrim.classList.contains('is-open'), true);
  assertNoInlineStyle(c.el);
});

test('ui.sheet: open() twice never stacks a second scrim, keeps the first opener and one close; setContent replaces', () => {
  const t = clock();
  const { doc, win } = page();
  const opener = doc.getElementById('opener');
  opener.focus();
  let closed = 0;
  const c = ui.sheet({ title: 'T', onClose: () => { closed++; }, doc, win });
  c.open();
  c.open();
  assert.strictEqual(doc.querySelectorAll('.ui-scrim').length, 1);
  assert.strictEqual(doc.querySelectorAll('.ui-sheet').length, 1);
  // The second open is a no-op: it must not re-capture the opener (focus is now
  // inside the sheet) nor register the sheet twice for Esc.
  key(win, doc.body, 'Escape');
  assert.strictEqual(c.isOpen(), false);
  t.tick(400);
  assert.strictEqual(doc.activeElement, opener, 'focus returns to the ORIGINAL opener');
  assert.strictEqual(closed, 1);
  const next = ui.sheet({ title: 'N', doc, win }).open();
  key(win, doc.body, 'Escape');
  assert.strictEqual(next.isOpen(), false, 'no stale registration swallows the next Esc');
  c.open();
  const a = doc.createElement('span'); a.textContent = 'a';
  const b = doc.createElement('span'); b.textContent = 'b';
  c.setContent(a);
  c.setContent(b);
  assert.deepStrictEqual(kids(c.body), [b]);
});

test('ui.sheet close: removes is-open, then (fallback timer) removes both nodes, releases the lock, restores focus, onClose ONCE', () => {
  const t = clock();
  const { doc, win } = page();
  let closed = 0;
  const opener = doc.getElementById('opener');
  opener.focus();
  const c = ui.sheet({ title: 'T', onClose: () => { closed++; }, doc, win });
  c.open();
  t.tick(16);
  c.close();
  c.close();
  assert.strictEqual(c.isOpen(), false);
  assert.strictEqual(c.el.classList.contains('is-open'), false);
  assert.strictEqual(c.scrim.classList.contains('is-open'), false);
  assert.strictEqual(c.el.isConnected, true, 'still animating out');
  assert.strictEqual(closed, 0);
  t.tick(400);
  assert.strictEqual(c.el.isConnected, false);
  assert.strictEqual(c.scrim.isConnected, false);
  assert.strictEqual(BL.isLocked(doc), false);
  assert.strictEqual(doc.activeElement, opener);
  assert.strictEqual(closed, 1);
});

// Sweep S9 (primitive addition): a closing sheet carries `is-closing` until it is gone or
// re-opened - the ui.css exit easing keys on it, and a caller asks "is a LIVE dialog up?"
// with `.ui-sheet:not(.is-closing)` (the watch page's relocation offer).
test('ui.sheet: is-closing marks the exit only - off while open, on from close() until removed, off again on a re-open', () => {
  const t = clock();
  const { doc, win } = page();
  const c = ui.sheet({ title: 'T', doc, win });
  c.open();
  t.tick(16);
  assert.strictEqual(c.el.classList.contains('is-closing'), false, 'an open sheet is not closing');
  assert.ok(doc.querySelector('.ui-sheet:not(.is-closing)'), 'the live-dialog query sees an open sheet');
  c.close();
  assert.strictEqual(c.el.classList.contains('is-closing'), true, 'marked the moment close() runs');
  assert.strictEqual(doc.querySelector('.ui-sheet:not(.is-closing)'), null, 'a closing sheet is not a live dialog');
  c.open(); // re-opened mid-exit keeps the nodes
  assert.strictEqual(c.el.classList.contains('is-closing'), false, 'a re-open clears it');
  c.close();
  t.tick(400);
  assert.strictEqual(c.el.isConnected, false);
  assert.strictEqual(c.el.classList.contains('is-closing'), false, 'a removed sheet does not keep the mark (it can be opened again)');
  c.open();
  assert.strictEqual(c.el.classList.contains('is-closing'), false);
});

test('ui.sheet close: the sheet\'s own transitionend removes it early; a child\'s transitionend does not', () => {
  clock();
  const { doc, win } = page();
  let closed = 0;
  const c = ui.sheet({ title: 'T', onClose: () => { closed++; }, doc, win });
  c.open();
  c.close();
  c.el.querySelector('.ui-sheet__close').dispatchEvent(new win.Event('transitionend', { bubbles: true }));
  assert.strictEqual(c.el.isConnected, true, 'a bubbled child transition is ignored');
  c.el.dispatchEvent(new win.Event('transitionend', { bubbles: true }));
  assert.strictEqual(c.el.isConnected, false);
  assert.strictEqual(closed, 1);
});

test('ui.sheet: Esc, scrim click and the close button each close it; Esc closes only the TOP sheet', () => {
  const t = clock();
  const { doc, win } = page();
  for (const how of ['esc', 'scrim', 'button']) {
    let closed = 0;
    const c = ui.sheet({ title: how, onClose: () => { closed++; }, doc, win });
    c.open();
    if (how === 'esc') key(win, doc.activeElement, 'Escape');
    if (how === 'scrim') c.scrim.click();
    if (how === 'button') c.el.querySelector('.ui-sheet__close').click();
    assert.strictEqual(c.isOpen(), false, how);
    t.tick(400);
    assert.strictEqual(closed, 1, how);
  }
  const under = ui.sheet({ title: 'under', doc, win }).open();
  const top = ui.sheet({ title: 'top', doc, win }).open();
  key(win, doc.body, 'Escape');
  assert.strictEqual(top.isOpen(), false);
  assert.strictEqual(under.isOpen(), true);
  key(win, doc.body, 'Escape');
  assert.strictEqual(under.isOpen(), false);
});

test('ui.sheet: two sheets hold the body lock under separate owners (closing one keeps the other locked)', () => {
  const t = clock();
  const { doc, win } = page();
  const a = ui.sheet({ title: 'a', doc, win }).open();
  const b = ui.sheet({ title: 'b', doc, win }).open();
  a.close();
  t.tick(400);
  assert.strictEqual(BL.isLocked(doc), true, 'b still holds it');
  b.close();
  t.tick(400);
  assert.strictEqual(BL.isLocked(doc), false);
});

test('ui.sheet: no title -> aria-label instead of aria-labelledby, and no title element', () => {
  clock();
  const { doc, win } = page();
  const c = ui.sheet({ label: 'Actions', doc, win }).open();
  assert.strictEqual(c.el.getAttribute('aria-label'), 'Actions');
  assert.strictEqual(c.el.hasAttribute('aria-labelledby'), false);
  assert.strictEqual(c.el.querySelector('.ui-sheet__title'), null);
});

test('ui.sheet variants: bottom has the grab first; popover has a clear scrim and anchor custom properties; auto resolves at open', () => {
  clock();
  const { doc, win } = page();
  const bot = ui.sheet({ variant: 'bottom', title: 'B', doc, win }).open();
  assert.deepStrictEqual(classes(bot.el).slice(0, 2), ['ui-sheet', 'ui-sheet--bottom']);
  assert.deepStrictEqual(kids(bot.el).map((k) => k.className), ['ui-sheet__grab', 'ui-sheet__header', 'ui-sheet__body']);

  const anchor = doc.getElementById('opener');
  anchor.getBoundingClientRect = () => ({ left: 120, top: 40, right: 160, bottom: 72, width: 40, height: 32 });
  const pop = ui.sheet({ variant: 'popover', title: 'P', anchor, doc, win }).open();
  assert.deepStrictEqual(classes(pop.el).slice(0, 2), ['ui-sheet', 'ui-sheet--popover']);
  assert.deepStrictEqual(classes(pop.scrim), ['ui-scrim', 'ui-scrim--clear']);
  assert.strictEqual(pop.el.style.getPropertyValue('--ui-anchor-x'), '120px');
  assert.strictEqual(pop.el.style.getPropertyValue('--ui-anchor-y'), '72px');
  assert.strictEqual(pop.el.querySelector('.ui-sheet__grab'), null);
  assertNoInlineStyle(pop.el);

  const autoDlg = ui.sheet({ variant: 'auto', title: 'A', doc, win }).open();
  assert.ok(autoDlg.el.classList.contains('ui-sheet--dialog'), 'desktop, no anchor -> dialog');
  const autoPop = ui.sheet({ variant: 'auto', title: 'A', anchor, doc, win }).open();
  assert.ok(autoPop.el.classList.contains('ui-sheet--popover'), 'desktop + anchor -> popover');
  const phone = page({ phone: true });
  const autoBot = ui.sheet({ variant: 'auto', title: 'A', anchor, doc: phone.doc, win: phone.win }).open();
  assert.ok(autoBot.el.classList.contains('ui-sheet--bottom'), 'phone -> bottom, even with an anchor');
  assert.strictEqual(autoBot.el.firstElementChild.className, 'ui-sheet__grab');
  assert.deepStrictEqual(classes(ui.sheet({ variant: 'panel', doc, win }).open().el).slice(0, 2), ['ui-sheet', 'ui-sheet--panel']);
});

test('ui.sheet bottom drag: --ui-drag follows, is-dragging while dragging; past 30% closes, short snaps back', () => {
  clock();
  const { doc, win } = page();
  function pe(type, y, target) {
    const e = new win.Event(type, { bubbles: true });
    e.clientY = y; e.pointerId = 1;
    target.dispatchEvent(e);
  }
  const c = ui.sheet({ variant: 'bottom', title: 'B', doc, win }).open();
  c.el.getBoundingClientRect = () => ({ height: 400, top: 0, bottom: 400, left: 0, right: 0, width: 0 });
  const grab = c.el.querySelector('.ui-sheet__grab');
  pe('pointerdown', 500, grab);
  assert.ok(c.el.classList.contains('is-dragging'));
  pe('pointermove', 560, doc);
  assert.strictEqual(c.el.style.getPropertyValue('--ui-drag'), '60px');
  pe('pointerup', 560, doc);
  assert.strictEqual(c.el.classList.contains('is-dragging'), false);
  assert.strictEqual(c.el.style.getPropertyValue('--ui-drag'), '', 'snapped back');
  assert.strictEqual(c.isOpen(), true, '60 of 400 is under 30%');

  pe('pointerdown', 500, c.el.querySelector('.ui-sheet__header'));
  pe('pointermove', 400, doc);
  assert.strictEqual(c.el.style.getPropertyValue('--ui-drag'), '0px', 'never drags up');
  pe('pointermove', 630, doc);
  pe('pointerup', 630, doc);
  assert.strictEqual(c.isOpen(), false, '130 of 400 is past 30%');
  assertNoInlineStyle(c.el);

  const d = ui.sheet({ variant: 'dialog', title: 'D', doc, win }).open();
  pe('pointerdown', 0, d.el.querySelector('.ui-sheet__header'));
  assert.strictEqual(d.el.classList.contains('is-dragging'), false, 'only bottom sheets drag');
});

// ------------------------------------------------------------------ menu
test('ui.menu: an opened sheet of compact rows; the selected item is a trailing ink CHECK; select closes then calls onSelect', () => {
  clock();
  const { doc, win } = page();
  const order = [];
  const c = ui.menu({
    title: 'Sort',
    items: [
      { icon: 'history', label: 'Newest', value: 'new', checked: true, onSelect: (v) => order.push(['select', v, c.isOpen()]) },
      { icon: 'star', label: 'Top rated', value: 'top', onSelect: (v) => order.push(['select', v, c.isOpen()]) },
      { icon: 'delete', label: 'Clear', value: 'clear', danger: true },
    ],
    doc, win,
  });
  assert.strictEqual(c.isOpen(), true);
  const l = c.body.querySelector('.ui-list');
  assert.deepStrictEqual(classes(l), ['ui-list', 'ui-list--compact', 'ui-list--media-avatar', 'ui-list--aside-text',
    'ui-list--actions-0', 'ui-list--divider-inset']);
  const rows = kids(l);
  assert.strictEqual(rows.length, 3);
  rows.forEach((r) => {
    assert.strictEqual(r.tagName, 'BUTTON');
    assert.ok(r.classList.contains('ui-row--compact'));
    assert.strictEqual(r.querySelector('.ui-row__media svg').tagName, 'svg');
  });
  assert.strictEqual(rows[0].querySelector('.ui-row__aside use').getAttribute('href'), '#i-check');
  assert.strictEqual(rows[1].querySelector('.ui-row__aside').childNodes.length, 0);
  assert.strictEqual(rows[0].classList.contains('ui-row--danger'), false, 'selected is never red');
  assert.strictEqual(rows[2].classList.contains('ui-row--danger'), true);
  rows[1].click();
  assert.deepStrictEqual(order, [['select', 'top', false]], 'closed BEFORE onSelect ran');

  const plain = ui.menu({ items: [{ label: 'One', value: 1 }], doc, win });
  assert.ok(plain.body.querySelector('.ui-list').classList.contains('ui-list--media-none'));
});

// Sweep S9 (primitive addition): a second tap on a menu row while the menu animates out
// picks NOTHING (the choice modal it replaces settled once; a double tap on Share / Delete
// must not run the pick twice). Tapping the SAME row again and tapping ANOTHER row both count.
test('ui.menu: one pick per menu - a second tap (same row or another) while it closes runs no onSelect', () => {
  clock();
  const { doc, win } = page();
  const picks = [];
  const menuPicks = [];
  const c = ui.menu({
    items: [{ label: 'A', value: 'a', onSelect: (v) => picks.push(v) }, { label: 'B', value: 'b', onSelect: (v) => picks.push(v) }],
    onSelect: (v) => menuPicks.push(v), doc, win,
  });
  const rows = kids(c.body.querySelector('.ui-list'));
  rows[0].click();
  rows[0].click();
  rows[1].click();
  assert.deepStrictEqual(picks, ['a'], 'one item pick');
  assert.deepStrictEqual(menuPicks, ['a'], 'one menu-level pick');
});

// Sweep S9 (primitive addition): `canDismiss` - a sheet mid-request refuses a USER dismissal
// (Esc, the scrim, Close, a drag down) and stays up; its owner's ctrl.close() and a signal
// abort still close it.
test('ui.sheet canDismiss: false keeps it up on Esc / scrim / Close; ctrl.close() and an abort still close; true lets them through', () => {
  const t = clock();
  const { doc, win } = page();
  let allow = false;
  const ac = new win.AbortController();
  const c = ui.sheet({ title: 'T', canDismiss: () => allow, signal: ac.signal, doc, win });
  c.open();
  t.tick(16);
  key(win, doc.body, 'Escape');
  assert.strictEqual(c.isOpen(), true, 'Esc refused');
  c.scrim.click();
  assert.strictEqual(c.isOpen(), true, 'scrim refused');
  c.el.querySelector('.ui-sheet__close').click();
  assert.strictEqual(c.isOpen(), true, 'Close refused');
  c.close();
  assert.strictEqual(c.isOpen(), false, 'the owner closes it');
  t.tick(400);
  c.open();
  t.tick(16);
  ac.abort();
  assert.strictEqual(c.isOpen(), false, 'an abort closes it');
  t.tick(400);
  const d = ui.sheet({ title: 'U', canDismiss: () => allow, doc, win });
  d.open();
  allow = true;
  key(win, doc.body, 'Escape');
  assert.strictEqual(d.isOpen(), false, 'allowed: Esc closes');
});

test('ui.sheet canDismiss: a refused drag-down snaps back (the sheet stays, --ui-drag cleared)', () => {
  clock();
  const { doc, win } = page({ phone: true });
  const c = ui.sheet({ variant: 'bottom', title: 'T', canDismiss: () => false, doc, win }).open();
  c.el.getBoundingClientRect = () => ({ height: 100, width: 390, top: 0, left: 0, right: 390, bottom: 100 });
  const pe = (type, y, target) => {
    const e = new win.Event(type, { bubbles: true });
    e.clientY = y; e.pointerId = 1;
    (target || doc).dispatchEvent(e);
  };
  pe('pointerdown', 0, c.el.querySelector('.ui-sheet__header'));
  pe('pointermove', 80);
  assert.strictEqual(c.el.style.getPropertyValue('--ui-drag'), '80px');
  pe('pointerup', 80);
  assert.strictEqual(c.isOpen(), true, 'a refused drag keeps it open');
  assert.strictEqual(c.el.style.getPropertyValue('--ui-drag'), '', 'and snaps back');
});

// ------------------------------------------------------------------ toast
test('ui.toast: one host (aria-live), DOM per kind, is-visible on the next frame', () => {
  const t = clock();
  const { doc, win } = page();
  const a = ui.toast('Saved', { kind: 'success', doc, win });
  const hosts = doc.querySelectorAll('.ui-toast-host');
  assert.strictEqual(hosts.length, 1);
  assert.strictEqual(hosts[0].getAttribute('aria-live'), 'polite');
  const el = hosts[0].querySelector('.ui-toast');
  assert.deepStrictEqual(classes(el), ['ui-toast', 'ui-toast--success']);
  assert.deepStrictEqual(kids(el).map((k) => k.tagName.toLowerCase()), ['svg', 'span']);
  assert.strictEqual(el.querySelector('use').getAttribute('href'), '#i-check');
  assert.strictEqual(el.querySelector('.ui-toast__text').textContent, 'Saved');
  assert.strictEqual(el.classList.contains('is-visible'), false);
  t.tick(16);
  assert.strictEqual(el.classList.contains('is-visible'), true);
  a.dismiss();
  t.tick(500);
  const e = ui.toast('Failed <b>x</b>', { kind: 'error', doc, win });
  assert.strictEqual(doc.querySelectorAll('.ui-toast-host').length, 1, 'the host is created once');
  assert.strictEqual(e.el.querySelector('use').getAttribute('href'), '#i-warning');
  assert.strictEqual(e.el.querySelector('b'), null);
  e.dismiss();
  t.tick(500);
  const n = ui.toast('Plain', { doc, win });
  assert.deepStrictEqual(kids(n.el).map((k) => k.className), ['ui-toast__text'], 'neutral has no icon');
});

test('ui.toast: ONE queue - the second waits for the first; default durations 2500 / 5000 with an action', () => {
  const t = clock();
  const { doc, win } = page();
  let acted = 0;
  const first = ui.toast('first', { doc, win });
  const second = ui.toast('second', { action: { label: 'Undo', onAction: () => { acted++; } }, doc, win });
  const host = doc.querySelector('.ui-toast-host');
  const texts = () => Array.from(host.querySelectorAll('.ui-toast__text')).map((x) => x.textContent);
  assert.deepStrictEqual(texts(), ['first']);
  t.tick(2499);
  assert.deepStrictEqual(texts(), ['first']);
  t.tick(1);
  assert.strictEqual(first.el.classList.contains('is-visible'), false, 'dismissed at 2500');
  t.tick(300);
  assert.deepStrictEqual(texts(), ['second'], 'the next shows after the previous is gone');
  const act = second.el.querySelector('.ui-toast__action');
  assert.deepStrictEqual(classes(act), ['ui-btn', 'ui-btn--plain', 'ui-btn--sm', 'ui-toast__action']);
  assert.strictEqual(act.textContent, 'Undo');
  t.tick(4900);
  assert.deepStrictEqual(texts(), ['second'], 'an action toast lasts 5000');
  act.click();
  assert.strictEqual(acted, 1);
  t.tick(300);
  assert.deepStrictEqual(texts(), []);

  // A queued toast dismissed before it shows never shows.
  const x = ui.toast('x', { duration: 100, doc, win });
  const y = ui.toast('y', { doc, win });
  const z = ui.toast('z', { doc, win });
  y.dismiss();
  t.tick(100);
  x.dismiss();
  t.tick(300);
  assert.deepStrictEqual(texts(), ['z']);
  z.dismiss();
});

// ------------------------------------------------------------------ confirm / prompt
function confirmPage() {
  const t = clock();
  const { doc, win } = page();
  return { t, doc, win, sheet: () => doc.querySelector('.ui-sheet') };
}

test('ui.confirm: dialog DOM, actions order, destructive class when danger', async () => {
  const { t, doc, win, sheet } = confirmPage();
  const p = ui.confirm({ title: 'Delete this file permanently?', body: 'It cannot be undone.', confirmLabel: 'Delete permanently', danger: true, doc, win });
  const s = sheet();
  assert.ok(s.classList.contains('ui-sheet--dialog'));
  assert.strictEqual(s.querySelector('.ui-sheet__title').textContent, 'Delete this file permanently?');
  const body = s.querySelector('.ui-sheet__body');
  assert.deepStrictEqual(kids(body).map((k) => k.className), ['ui-confirm__body', 'ui-confirm__actions']);
  assert.strictEqual(body.querySelector('p.ui-confirm__body').textContent, 'It cannot be undone.');
  const [cancel, ok] = kids(body.querySelector('.ui-confirm__actions'));
  assert.deepStrictEqual(classes(cancel), ['ui-btn', 'ui-btn--secondary', 'ui-btn--md']);
  assert.strictEqual(cancel.textContent, 'Cancel');
  assert.deepStrictEqual(classes(ok), ['ui-btn', 'ui-btn--primary', 'ui-btn--md', 'ui-btn--destructive']);
  assert.strictEqual(ok.textContent, 'Delete permanently');
  ok.click();
  assert.strictEqual(await p, true);
  t.tick(400);
  assert.strictEqual(sheet(), null);

  const q = ui.confirm({ title: 'Go?', doc, win });
  const acts = kids(sheet().querySelector('.ui-confirm__actions'));
  assert.strictEqual(acts[1].textContent, 'OK');
  assert.strictEqual(acts[1].classList.contains('ui-btn--destructive'), false);
  assert.strictEqual(sheet().querySelector('.ui-confirm__body'), null, 'no body -> no paragraph');
  acts[1].click();
  assert.strictEqual(await q, true);
});

test('ui.confirm: resolves false on EVERY cancel path (Cancel, scrim, Esc, close button), exactly once, before the exit animation', async () => {
  const paths = {
    cancel: (s) => kids(s.querySelector('.ui-confirm__actions'))[0].click(),
    scrim: (s, doc) => doc.querySelector('.ui-scrim').click(),
    esc: (s, doc, win) => key(win, doc.body, 'Escape'),
    close: (s) => s.querySelector('.ui-sheet__close').click(),
  };
  for (const [name, act] of Object.entries(paths)) {
    const { t, doc, win, sheet } = confirmPage();
    let settledCount = 0;
    const p = ui.confirm({ title: name, doc, win }).then((v) => { settledCount++; return v; });
    const s = sheet();
    act(s, doc, win);
    // A later confirm click on the dying sheet must not flip the answer.
    kids(s.querySelector('.ui-confirm__actions'))[1].click();
    // Answered when the dismissal STARTS, not after the exit animation.
    assert.strictEqual(await p, false, name);
    assert.strictEqual(settledCount, 1, name);
    assert.ok(s.isConnected, name + ': still animating out when answered');
    t.tick(400);
    assert.strictEqual(sheet(), null, name + ': removed');
    mock.timers.reset();
  }
});

// UI pass S6 (the primitive addition): `signal` ties an overlay to its owner (a view's
// AbortController). An abort closes an open sheet/menu/confirm - a confirm answers false - and an
// already-aborted signal never opens one, so an SPA nav away cannot strand an overlay on <body>
// or leave a confirm that could still act for a dead view.
test('ui.sheet / ui.menu / ui.confirm signal: an abort closes the overlay (confirm resolves false); an aborted signal never opens', async () => {
  {
    const { t, doc, win, sheet } = confirmPage();
    const ac = new win.AbortController();
    const p = ui.confirm({ title: 'Delete?', danger: true, signal: ac.signal, doc, win });
    const s = sheet();
    assert.ok(s && s.isConnected, 'open');
    ac.abort();
    assert.strictEqual(await p, false, 'an abort answers false');
    kids(s.querySelector('.ui-confirm__actions'))[1].click();
    t.tick(400);
    assert.strictEqual(sheet(), null, 'removed');
    assert.strictEqual(doc.querySelector('.ui-scrim'), null, 'scrim removed');
    mock.timers.reset();
  }
  {
    const { doc, win, sheet } = confirmPage();
    const ac = new win.AbortController();
    ac.abort();
    assert.strictEqual(await ui.confirm({ title: 'Late', signal: ac.signal, doc, win }), false, 'pre-aborted: false at once');
    assert.strictEqual(sheet(), null, 'and nothing opened');
    const ctrl = ui.sheet({ title: 'x', signal: ac.signal, doc, win }).open();
    assert.strictEqual(ctrl.isOpen(), false, 'a sheet on an aborted signal never opens');
    assert.strictEqual(sheet(), null);
    mock.timers.reset();
  }
  {
    const { t, doc, win, sheet } = confirmPage();
    const ac = new win.AbortController();
    const m = ui.menu({ items: [{ label: 'One' }], signal: ac.signal, doc, win });
    assert.ok(m.isOpen(), 'the menu opened');
    ac.abort();
    assert.strictEqual(m.isOpen(), false, 'an abort closes the menu');
    t.tick(400);
    assert.strictEqual(sheet(), null);
    mock.timers.reset();
  }
});

test('ui.prompt: a field, Enter submits the value, Cancel/Esc give null; password gets a reveal toggle', async () => {
  const { t, doc, win, sheet } = confirmPage();
  const p = ui.prompt({ title: 'Rename', label: 'Name', value: 'old', doc, win });
  const s = sheet();
  const input = s.querySelector('.ui-field > input.ui-field__input');
  assert.strictEqual(input.getAttribute('type'), 'text');
  assert.strictEqual(input.value, 'old');
  assert.strictEqual(doc.activeElement, input, 'focus lands in the field');
  assert.strictEqual(s.querySelector('.ui-field__reveal'), null);
  input.value = 'new name';
  key(win, input, 'Enter');
assert.strictEqual(await p, "new name");
  t.tick(400);

  const c = ui.prompt({ title: 'Rename', label: 'Name', doc, win });
  kids(sheet().querySelector('.ui-confirm__actions'))[0].click();
assert.strictEqual(await c, null);
  t.tick(400);
  const e = ui.prompt({ title: 'Rename', label: 'Name', doc, win });
  key(win, doc.body, 'Escape');
assert.strictEqual(await e, null);
  t.tick(400);

  const pw = ui.prompt({ title: 'Reset password', label: 'New password', type: 'password', confirmLabel: 'Set', doc, win });
  const ps = sheet();
  const pin = ps.querySelector('input.ui-field__input');
  assert.strictEqual(pin.getAttribute('type'), 'password');
  const rev = ps.querySelector('.ui-field__reveal');
  assert.ok(rev.classList.contains('ui-btn--plain') && rev.classList.contains('ui-btn--icon'));
  assert.strictEqual(rev.getAttribute('aria-pressed'), 'false');
  assert.strictEqual(rev.querySelector('use').getAttribute('href'), '#i-visibility');
  rev.click();
  assert.strictEqual(pin.getAttribute('type'), 'text');
  assert.strictEqual(rev.getAttribute('aria-pressed'), 'true');
  assert.strictEqual(rev.querySelector('use').getAttribute('href'), '#i-visibility_off');
  rev.click();
  assert.strictEqual(pin.getAttribute('type'), 'password');
  pin.value = 's3cret';
  const ok = kids(ps.querySelector('.ui-confirm__actions'))[1];
  assert.strictEqual(ok.textContent, 'Set');
  ok.click();
  assert.strictEqual(await pw, 's3cret');
});

// ------------------------------------------------------------------ forms
test('ui.switch: role switch, aria-checked flips on click, onChange(newValue)', () => {
  const { doc } = page();
  const seen = [];
  const s = ui.switch({ checked: false, label: 'Autoplay', onChange: (v) => seen.push(v), doc });
  assert.strictEqual(s.tagName, 'BUTTON');
  assert.deepStrictEqual(classes(s), ['ui-switch']);
  assert.strictEqual(s.getAttribute('type'), 'button');
  assert.strictEqual(s.getAttribute('role'), 'switch');
  assert.strictEqual(s.getAttribute('aria-checked'), 'false');
  assert.strictEqual(s.getAttribute('aria-label'), 'Autoplay');
  s.click();
  assert.strictEqual(s.getAttribute('aria-checked'), 'true');
  s.click();
  assert.strictEqual(s.getAttribute('aria-checked'), 'false');
  assert.deepStrictEqual(seen, [true, false]);
  assert.strictEqual(ui.switch({ checked: true, disabled: true, doc }).disabled, true);
});

test('ui.segmented: radiogroup, exactly one aria-checked, click and arrow keys move it', () => {
  const { win, doc } = page();
  const seen = [];
  const g = ui.segmented({ label: 'View', value: 'b', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }], onChange: (v) => seen.push(v), doc });
  doc.body.appendChild(g);
  assert.deepStrictEqual(classes(g), ['ui-segmented']);
  assert.strictEqual(g.getAttribute('role'), 'radiogroup');
  assert.strictEqual(g.getAttribute('aria-label'), 'View');
  const items = kids(g);
  const checked = () => items.map((b) => b.getAttribute('aria-checked'));
  items.forEach((b) => { assert.strictEqual(b.className, 'ui-segmented__item'); assert.strictEqual(b.getAttribute('role'), 'radio'); });
  assert.deepStrictEqual(checked(), ['false', 'true', 'false']);
  key(win, items[1], 'ArrowRight');
  assert.deepStrictEqual(checked(), ['false', 'false', 'true']);
  assert.strictEqual(doc.activeElement, items[2]);
  key(win, items[2], 'ArrowRight');
  assert.deepStrictEqual(checked(), ['true', 'false', 'false'], 'wraps');
  key(win, items[0], 'ArrowLeft');
  assert.deepStrictEqual(checked(), ['false', 'false', 'true']);
  items[1].click();
  items[1].click();
  assert.deepStrictEqual(checked(), ['false', 'true', 'false']);
  assert.deepStrictEqual(seen, ['c', 'a', 'c', 'b'], 'onChange only on a change');
  const none = ui.segmented({ options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }], value: 'zzz', doc });
  assert.deepStrictEqual(kids(none).map((b) => b.getAttribute('aria-checked')), ['true', 'false'], 'exactly one, even for an unknown value');
});

test('ui.field: label for=id (generated when absent), input, help, error with role alert + aria-invalid', () => {
  const { doc } = page();
  const f = ui.field({ label: 'Name', value: 'v', placeholder: 'p', name: 'n', help: 'Shown on your profile', error: 'Required', doc });
  assert.deepStrictEqual(classes(f.el), ['ui-field']);
  assert.deepStrictEqual(kids(f.el).map((k) => k.tagName + '.' + k.className),
    ['LABEL.ui-field__label', 'INPUT.ui-field__input', 'P.ui-field__help', 'P.ui-field__error']);
  const label = f.el.querySelector('label');
  assert.ok(f.input.id);
  assert.strictEqual(label.getAttribute('for'), f.input.id);
  assert.strictEqual(label.textContent, 'Name');
  assert.strictEqual(f.input.getAttribute('type'), 'text');
  assert.strictEqual(f.input.value, 'v');
  assert.strictEqual(f.input.getAttribute('placeholder'), 'p');
  assert.strictEqual(f.input.getAttribute('name'), 'n');
  assert.strictEqual(f.el.querySelector('.ui-field__error').getAttribute('role'), 'alert');
  assert.strictEqual(f.input.getAttribute('aria-invalid'), 'true');
  const g = ui.field({ label: 'Email', id: 'email', type: 'email', doc });
  assert.strictEqual(g.input.id, 'email');
  assert.strictEqual(g.el.querySelector('label').getAttribute('for'), 'email');
  assert.strictEqual(g.input.getAttribute('type'), 'email');
  assert.strictEqual(g.input.hasAttribute('aria-invalid'), false);
  assert.deepStrictEqual(kids(g.el).map((k) => k.className), ['ui-field__label', 'ui-field__input']);
  assert.notStrictEqual(ui.field({ label: 'a', doc }).input.id, ui.field({ label: 'b', doc }).input.id, 'generated ids are unique');
});

test('ui.select: field > label + span.ui-select > native select + chevron icon', () => {
  const { doc } = page();
  const s = ui.select({ label: 'Quality', name: 'q', value: '720', options: [{ value: '1080', label: '1080p' }, { value: '720', label: '720p' }], doc });
  assert.deepStrictEqual(classes(s.el), ['ui-field']);
  assert.deepStrictEqual(kids(s.el).map((k) => k.className), ['ui-field__label', 'ui-select']);
  const box = s.el.querySelector('.ui-select');
  assert.strictEqual(box.tagName, 'SPAN');
  assert.strictEqual(kids(box)[0], s.select);
  assert.strictEqual(s.select.className, 'ui-select__native');
  assert.deepStrictEqual(classes(kids(box)[1]), ['ui-icon', 'ui-icon--md', 'ui-select__chevron']);
  assert.strictEqual(kids(box)[1].querySelector('use').getAttribute('href'), '#i-expand_more');
  assert.strictEqual(s.el.querySelector('label').getAttribute('for'), s.select.id);
  assert.strictEqual(s.select.value, '720');
  assert.strictEqual(s.select.getAttribute('name'), 'q');
  assert.deepStrictEqual(Array.from(s.select.options).map((o) => o.textContent), ['1080p', '720p']);
});

test('ui.state: icon (lg), title, body, secondary action', () => {
  const { doc } = page();
  let n = 0;
  const s = ui.state({ icon: 'error', title: 'Could not load books', body: 'Check the connection.', action: { label: 'Retry', onClick: () => { n++; } }, doc });
  assert.deepStrictEqual(classes(s), ['ui-state']);
  assert.deepStrictEqual(kids(s).map((k) => k.tagName + '.' + k.className),
    ['SPAN.ui-state__icon', 'H3.ui-state__title', 'P.ui-state__body', 'BUTTON.ui-btn ui-btn--secondary ui-btn--md']);
  assert.deepStrictEqual(classes(s.querySelector('.ui-state__icon svg')), ['ui-icon', 'ui-icon--lg']);
  assert.strictEqual(s.querySelector('h3').textContent, 'Could not load books');
  s.querySelector('button').click();
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(kids(ui.state({ title: 'Empty', doc })).map((k) => k.className), ['ui-state__title']);
});

// ------------------------------------------------------------------ copy
test('ui.copy: clipboard.writeText then a success toast with the label', async () => {
  clock();
  const { doc, win } = page();
  const written = [];
  Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: (s) => { written.push(s); return Promise.resolve(); } }, configurable: true });
  assert.strictEqual(await ui.copy('/media/a.mp4', { label: 'Path copied', doc, win }), true);
  assert.deepStrictEqual(written, ['/media/a.mp4']);
  const t = doc.querySelector('.ui-toast');
  assert.ok(t.classList.contains('ui-toast--success'));
  assert.strictEqual(t.querySelector('.ui-toast__text').textContent, 'Path copied');
});

test('ui.copy: a rejected clipboard falls back to execCommand on a transient textarea', async () => {
  clock();
  const { doc, win } = page();
  Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
  let seen = null;
  doc.execCommand = (cmd) => { const ta = doc.querySelector('textarea'); seen = { cmd, value: ta && ta.value, sel: ta && ta.value.slice(ta.selectionStart, ta.selectionEnd) }; return true; };
  assert.strictEqual(await ui.copy('hello', { doc, win }), true);
  assert.deepStrictEqual(seen, { cmd: 'copy', value: 'hello', sel: 'hello' });
  assert.strictEqual(doc.querySelector('textarea'), null, 'the textarea is gone');
  assert.strictEqual(doc.querySelector('.ui-toast__text').textContent, 'Copied');
});

test('ui.copy: both paths failing resolves false with an error toast', async () => {
  clock();
  const { doc, win } = page();
  Object.defineProperty(win.navigator, 'clipboard', { value: undefined, configurable: true });
  doc.execCommand = () => false;
  assert.strictEqual(await ui.copy('x', { doc, win }), false);
  const t = doc.querySelector('.ui-toast');
  assert.ok(t.classList.contains('ui-toast--error'));
  assert.strictEqual(t.querySelector('.ui-toast__text').textContent, 'Could not copy');
});

// ------------------------------------------------------------------ wiring + source lock
test('ui.js sets window.ui in a browser page (the classic-script half of the dual export)', () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
  dom.window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'icons.js'), 'utf8'));
  dom.window.eval(SRC);
  const w = dom.window;
  assert.strictEqual(typeof w.ui.button, 'function');
  assert.strictEqual(typeof w.FTIcons.has, 'function');
  assert.throws(() => w.ui.icon('nope_nope'), /nope_nope/, 'the page registry is the one consulted');
  assert.strictEqual(w.ui.icon('close').getAttribute('class'), 'ui-icon ui-icon--md', 'defaults to the global document');
});

test('source lock: no inline visual style (only the listed custom properties) and no markup strings', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/.*$/gm, '$1');
  const styleUses = code.match(/\.style\b[^;\n]*/g) || [];
  assert.ok(styleUses.length > 0, 'anti-vacuity: the file does write custom properties');
  for (const u of styleUses) {
    assert.match(u, /^\.style\.(setProperty|removeProperty)\('--(p|ui-anchor-x|ui-anchor-y|ui-drag)'/, 'forbidden style use: ' + u);
  }
  assert.doesNotMatch(code, /cssText/);
  assert.doesNotMatch(code, /setAttribute\(\s*['"]style['"]/);
  assert.doesNotMatch(code, /style\s*=\s*["']/);
  assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  // Every custom property the code writes is listed in the header comment.
  const header = SRC.slice(0, SRC.indexOf('(function'));
  for (const m of code.matchAll(/setProperty\('(--[\w-]+)'/g)) assert.ok(header.includes(m[1]), m[1] + ' is listed at the top');
});
