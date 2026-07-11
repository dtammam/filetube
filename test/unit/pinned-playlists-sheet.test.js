'use strict';

// [UNIT] v1.24.0 (T3, F1): `renderPinnedPlaylists` (public/js/common.js) --
// the mobile Playlists-sheet pinned-channel-playlist subsection. Newly
// exported this task (was previously exercised only indirectly); this file
// locks its avatar-precedence rendering, mirroring
// test/unit/pinned-sidebar.test.js's desktop-sidebar coverage of the SAME
// `buildPinAvatarNode` helper the two render functions share.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { renderPinnedPlaylists, deriveAvatar } = require('../../public/js/common.js');

const COMMON_JS_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'common.js');
const commonJsSrc = fs.readFileSync(COMMON_JS_PATH, 'utf8');

class FakeNode {
  constructor(tag) {
    this.tagName = tag ? String(tag).toUpperCase() : undefined;
    this.id = '';
    this.className = '';
    this.children = [];
    this.parentNode = null;
    this._textContent = '';
    this.style = {};
  }

  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
    child.parentNode = null;
    return child;
  }

  set textContent(value) { this._textContent = value; this.children = []; }
  get textContent() { return this._textContent; }

  set innerHTML(_value) {
    throw new Error('renderPinnedPlaylists must never assign innerHTML -- use textContent/createTextNode instead');
  }

  get innerHTML() {
    throw new Error('renderPinnedPlaylists must never read/assign innerHTML');
  }
}

function makeFakeDoc(registry) {
  return {
    getElementById: (id) => registry[id] || null,
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  };
}

const PIN = { id: 'p1', channelDir: '/data/ytdlp-downloads/Real Creator', label: 'Real Creator' };

test('renderPinnedPlaylists: renders nothing (no-op) for zero/malformed pins -- disabled-module no-op', () => {
  const list = new FakeNode('div');
  list.id = 'playlists-sheet-list';
  global.document = makeFakeDoc({ 'playlists-sheet-list': list });

  renderPinnedPlaylists([]);
  assert.strictEqual(list.children.length, 0);

  renderPinnedPlaylists(undefined);
  assert.strictEqual(list.children.length, 0);
  delete global.document;
});

// v1.26.3 (Item 2): a "No playlists pinned yet." empty-state message is now
// shown for zero pins -- but ONLY when the caller has confirmed (via
// `moduleEnabled`) that this is a genuine enabled-but-unused case, never for
// a disabled module's 404-resolved-to-`[]` (which must keep rendering
// nothing at all -- the disabled-module no-op guarantee).

test('renderPinnedPlaylists: moduleEnabled=false (the default, e.g. omitted) still renders NOTHING for zero pins -- preserves the disabled-module no-op guarantee', () => {
  const list = new FakeNode('div');
  list.id = 'playlists-sheet-list';
  global.document = makeFakeDoc({ 'playlists-sheet-list': list });

  renderPinnedPlaylists([], false);
  assert.strictEqual(list.children.length, 0);
  delete global.document;
});

test('renderPinnedPlaylists: moduleEnabled=true renders a "No playlists pinned yet." empty-state message for zero pins', () => {
  const list = new FakeNode('div');
  list.id = 'playlists-sheet-list';
  global.document = makeFakeDoc({ 'playlists-sheet-list': list });

  renderPinnedPlaylists([], true);
  assert.strictEqual(list.children.length, 1);
  const empty = list.children[0];
  assert.strictEqual(empty.id, 'playlists-pinned-section');
  assert.strictEqual(empty.className, 'empty-state empty-state-inline');
  const message = empty.children[0];
  assert.strictEqual(message.className, 'empty-state-message');
  assert.strictEqual(message.textContent, 'No playlists pinned yet.');
  delete global.document;
});

test('renderPinnedPlaylists: moduleEnabled=true with real pins renders the pins, not the empty message', () => {
  const list = new FakeNode('div');
  list.id = 'playlists-sheet-list';
  global.document = makeFakeDoc({ 'playlists-sheet-list': list });

  renderPinnedPlaylists([PIN], true);
  assert.strictEqual(list.children.length, 1);
  assert.notStrictEqual(list.children[0].className, 'empty-state empty-state-inline');
  delete global.document;
});

test('renderPinnedPlaylists: idempotent across an empty-message -> populated -> empty-message cycle -- never duplicates the section', () => {
  const list = new FakeNode('div');
  const registry = { 'playlists-sheet-list': list };
  global.document = makeFakeDoc(registry);

  renderPinnedPlaylists([], true);
  assert.strictEqual(list.children.length, 1);
  registry['playlists-pinned-section'] = list.children[0];

  renderPinnedPlaylists([PIN], true);
  assert.strictEqual(list.children.length, 1, 'the empty-state message must be removed, not left alongside the populated section');
  registry['playlists-pinned-section'] = list.children[0];

  renderPinnedPlaylists([], true);
  assert.strictEqual(list.children.length, 1, 'the populated section must be removed, not left alongside the empty-state message');
  delete global.document;
});

test('renderPinnedPlaylists: renders a generated avatar glyph (no channelAvatarUrl) as inert text/nodes, never innerHTML', () => {
  const list = new FakeNode('div');
  list.id = 'playlists-sheet-list';
  global.document = makeFakeDoc({ 'playlists-sheet-list': list });

  renderPinnedPlaylists([PIN]);

  const section = list.children[0];
  assert.strictEqual(section.id, 'playlists-pinned-section');
  const link = section.children[1]; // heading, then the pin link
  assert.strictEqual(link.tagName, 'A');
  const avatar = link.children.find((c) => c.tagName === 'SPAN');
  assert.ok(avatar, 'expected a generated avatar span');
  assert.strictEqual(avatar.className, 'pinned-avatar pinned-avatar-generated');
  // The glyph is the label's own first letter, uppercased -- assert against
  // `deriveAvatar` itself (the shared source of truth) rather than a
  // hardcoded letter.
  assert.strictEqual(avatar.children.find((c) => c.nodeType === 3).textContent, deriveAvatar(PIN.label).glyph);
  const textNode = link.children.find((c) => c.nodeType === 3);
  assert.match(textNode.textContent, /Real Creator/);
  delete global.document;
});

test('renderPinnedPlaylists: a pin with a channelAvatarUrl renders an <img> instead of the generated glyph (F1 precedence)', () => {
  const list = new FakeNode('div');
  list.id = 'playlists-sheet-list';
  global.document = makeFakeDoc({ 'playlists-sheet-list': list });

  const withAvatar = { id: 'p2', channelDir: '/data/ytdlp-downloads/Icon Chan', label: 'Icon Chan', channelAvatarUrl: 'https://example.com/a.jpg' };
  renderPinnedPlaylists([withAvatar]);

  const section = list.children[0];
  const link = section.children[1];
  const img = link.children.find((c) => c.tagName === 'IMG');
  assert.ok(img, 'expected an <img> child when channelAvatarUrl is present');
  assert.strictEqual(img.src, 'https://example.com/a.jpg');
  delete global.document;
});

test('renderPinnedPlaylists: idempotent -- a second call replaces the prior section rather than duplicating it', () => {
  const list = new FakeNode('div');
  list.id = 'playlists-sheet-list';
  const registry = { 'playlists-sheet-list': list };
  global.document = makeFakeDoc(registry);

  renderPinnedPlaylists([PIN]);
  const firstSection = list.children[0];
  registry['playlists-pinned-section'] = firstSection;

  renderPinnedPlaylists([PIN, { id: 'p3', channelDir: '/d/second', label: 'Second' }]);

  assert.strictEqual(list.children.length, 1, 'still exactly one pinned section');
  assert.notStrictEqual(list.children[0], firstSection);
  delete global.document;
});

// ---- Static-source regression guard: openPlaylistsSheet derives
// moduleEnabled from the response's OWN r.ok (a genuine 2xx), not from the
// resolved body -- a disabled module's 404 must never be able to look like
// a real "enabled but zero pins" response (v1.26.3, Item 2). ----------------

test('openPlaylistsSheet derives moduleEnabled from r.ok and threads it into renderPinnedPlaylists', () => {
  const re = /fetch\('\/api\/subscriptions\/pins'\)[\s\S]{0,300}?renderPinnedPlaylists\(pins, moduleEnabled\)/;
  assert.match(commonJsSrc, re, 'expected openPlaylistsSheet to call renderPinnedPlaylists(pins, moduleEnabled)');
  const openFn = /function openPlaylistsSheet\(\)[\s\S]*?\n\}/.exec(commonJsSrc);
  assert.ok(openFn);
  assert.match(openFn[0], /r\.ok/, 'moduleEnabled must be derived from the response\'s own r.ok');
});
