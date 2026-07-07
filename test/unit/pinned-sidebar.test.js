'use strict';

// [UNIT] v1.22.0 FR-5 (AC32-AC38): `renderPinnedSidebar` (public/js/common.js)
// -- the desktop left-nav sidebar's pinned-channel section. Mirrors the
// v1.21.0 FR-5 mobile Playlists-sheet's `renderPinnedPlaylists` EXACTLY: the
// same pure `derivePinnedPlaylistEntries` derivation (AC34), the same
// createElement/textContent/createTextNode-only construction discipline
// (AC35 -- a pin's label is the SAME untrusted, creator-controlled
// snapshot), the same idempotent-remove-then-rebuild posture, and the same
// render-nothing-when-empty no-op (which is what makes a disabled module's
// 404-resolved-to-`[]` response look identical to an enabled-but-unused one,
// AC37). The one NEW invariant this task adds over the mobile sheet: the
// section must be inserted as a SEPARATE SIBLING of `#sidebar-folders-list`
// (never a child), so the three independently-duplicated
// `renderSidebarFolders` implementations' frequent `innerHTML` rebuilds
// (drag-reorder persist, cache restore) never wipe pins out from under it --
// the fake DOM below proves the sibling relationship directly (AC32/AC33).
//
// `common.js` only touches the GLOBAL `document` inside function bodies,
// never at module-eval time (guarded -- see its own "Guarded so requiring
// this file in Node never touches document" comment), so `common.js` is
// required FIRST, with `document` left undefined (its top-level
// DOMContentLoaded wiring is skipped entirely as a result), and only THEN
// does this file install a fake `global.document`, before invoking
// `renderPinnedSidebar`. Each test file runs in its own process (node:test),
// so this global shim never leaks into any other test file.

const { test } = require('node:test');
const assert = require('node:assert');

const { renderPinnedSidebar, derivePinnedPlaylistEntries } = require('../../public/js/common.js');

// ---- Minimal fake DOM (mirrors the FakeElement/innerHTML-throws pattern
// established by test/unit/subscribe-button.test.js and
// test/unit/hard-delete-local-files.test.js) ---------------------------------

class FakeNode {
  constructor(tag) {
    this.tagName = tag ? String(tag).toUpperCase() : undefined;
    this.id = '';
    this.className = '';
    this.children = [];
    this.parentNode = null;
    this._textContent = '';
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
    child.parentNode = null;
    return child;
  }

  insertBefore(newNode, refNode) {
    const idx = refNode ? this.children.indexOf(refNode) : -1;
    newNode.parentNode = this;
    if (idx === -1) this.children.push(newNode);
    else this.children.splice(idx, 0, newNode);
    return newNode;
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.children.indexOf(this);
    return idx === -1 ? null : (this.parentNode.children[idx + 1] || null);
  }

  set textContent(value) {
    this._textContent = value;
    this.children = [];
  }

  get textContent() {
    return this._textContent;
  }

  // Regression guard (AC35): renderPinnedSidebar must build every node via
  // createElement/textContent/createTextNode only -- never innerHTML.
  set innerHTML(_value) {
    throw new Error('renderPinnedSidebar must never assign innerHTML -- use textContent/createTextNode instead');
  }

  get innerHTML() {
    throw new Error('renderPinnedSidebar must never read/assign innerHTML');
  }
}

function makeFakeDoc(registry) {
  return {
    getElementById: (id) => registry[id] || null,
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  };
}

function makeShellWithFolderList() {
  const sidebarShell = new FakeNode('div');
  const folderList = new FakeNode('div');
  folderList.id = 'sidebar-folders-list';
  sidebarShell.appendChild(folderList);
  return { sidebarShell, folderList };
}

const PIN = { id: 'p1', channelDir: '/data/ytdlp-downloads/Real Creator', label: 'Real Creator' };

test('renderPinnedSidebar: inserts the pinned section as a SIBLING immediately after #sidebar-folders-list, never as a child (AC32/AC33)', () => {
  const { sidebarShell, folderList } = makeShellWithFolderList();
  global.document = makeFakeDoc({ 'sidebar-folders-list': folderList });

  renderPinnedSidebar([PIN]);

  assert.strictEqual(sidebarShell.children.length, 2, 'pinned section must be a sibling, not appended inside #sidebar-folders-list');
  assert.strictEqual(sidebarShell.children[0], folderList);
  const section = sidebarShell.children[1];
  assert.strictEqual(section.id, 'sidebar-pinned-section');
  assert.strictEqual(section.parentNode, sidebarShell);
  assert.strictEqual(folderList.children.length, 0, '#sidebar-folders-list itself must stay untouched -- no child added to it');
});

test('renderPinnedSidebar: renders a pin entry with an icon-star and the label as inert text, never innerHTML (AC35)', () => {
  const { sidebarShell, folderList } = makeShellWithFolderList();
  global.document = makeFakeDoc({ 'sidebar-folders-list': folderList });

  renderPinnedSidebar([PIN]);

  const section = sidebarShell.children[1];
  // First child is the "Pinned" heading; second is the pin link.
  const link = section.children[1];
  assert.strictEqual(link.tagName, 'A');
  assert.strictEqual(link.className, 'sidebar-item');
  assert.strictEqual(link.href, '/?root=' + encodeURIComponent(PIN.channelDir));
  const icon = link.children.find((c) => c.tagName === 'I');
  assert.ok(icon, 'expected an <i> icon child');
  assert.strictEqual(icon.className, 'icon-star');
  const textNode = link.children.find((c) => c.nodeType === 3);
  assert.ok(textNode, 'expected a createTextNode-built label, not a textContent assignment (which would also wipe the icon)');
  assert.match(textNode.textContent, /Real Creator/);
});

test('renderPinnedSidebar: a hostile label is rendered as inert text, never assigned via innerHTML (XSS regression, AC35)', () => {
  const { folderList } = makeShellWithFolderList();
  global.document = makeFakeDoc({ 'sidebar-folders-list': folderList });

  const hostile = { id: 'p2', channelDir: '/data/ytdlp-downloads/x', label: '<img src=x onerror=alert(1)>' };
  // Must not throw -- if the implementation ever assigned innerHTML with this
  // string, FakeNode's innerHTML setter above would throw and fail this test.
  assert.doesNotThrow(() => renderPinnedSidebar([hostile]));
});

test('renderPinnedSidebar: zero/empty pins renders nothing at all -- disabled-module no-op (AC37)', () => {
  const { sidebarShell, folderList } = makeShellWithFolderList();
  global.document = makeFakeDoc({ 'sidebar-folders-list': folderList });

  renderPinnedSidebar([]);
  assert.strictEqual(sidebarShell.children.length, 1, 'no pinned section should be added for zero pins');

  renderPinnedSidebar(undefined);
  assert.strictEqual(sidebarShell.children.length, 1, 'a malformed (non-array) pins response also renders nothing, never throws');
});

test('renderPinnedSidebar: idempotent -- a second call removes the prior section rather than duplicating it', () => {
  const { sidebarShell, folderList } = makeShellWithFolderList();
  const registry = { 'sidebar-folders-list': folderList };
  global.document = makeFakeDoc(registry);

  renderPinnedSidebar([PIN]);
  const firstSection = sidebarShell.children[1];
  registry['sidebar-pinned-section'] = firstSection;

  renderPinnedSidebar([PIN, { id: 'p2', channelDir: '/data/ytdlp-downloads/Second', label: 'Second Creator' }]);

  assert.strictEqual(sidebarShell.children.length, 2, 'still exactly one folder list + one pinned section, never a duplicate');
  const secondSection = sidebarShell.children[1];
  assert.notStrictEqual(secondSection, firstSection, 'the stale section must be removed, not reused/duplicated');
  assert.strictEqual(secondSection.children.length, 3, 'heading + 2 pin links');
});

test('renderPinnedSidebar: no-ops safely when #sidebar-folders-list is missing from the DOM (defensive)', () => {
  global.document = makeFakeDoc({});
  assert.doesNotThrow(() => renderPinnedSidebar([PIN]));
});

// ---- AC34: reuses the SAME pure derivePinnedPlaylistEntries helper ---------

test('renderPinnedSidebar: filters/derives pins the SAME way derivePinnedPlaylistEntries does (AC34) -- drops a pin missing channelDir, falls back to basename', () => {
  const { sidebarShell, folderList } = makeShellWithFolderList();
  global.document = makeFakeDoc({ 'sidebar-folders-list': folderList });

  const rawPins = [
    { id: 'bad', label: 'No channelDir' }, // dropped -- no usable channelDir
    { id: 'ok', channelDir: '/data/ytdlp-downloads/Some Chan' }, // falls back to basename label
  ];
  renderPinnedSidebar(rawPins);

  const expected = derivePinnedPlaylistEntries(rawPins);
  assert.strictEqual(expected.length, 1, 'sanity: the malformed pin is dropped by derivePinnedPlaylistEntries itself');

  const section = sidebarShell.children[1];
  const links = section.children.filter((c) => c.tagName === 'A');
  assert.strictEqual(links.length, expected.length, 'renderPinnedSidebar must render exactly what derivePinnedPlaylistEntries derives -- no second, divergent filter');
  assert.strictEqual(links[0].href, '/?root=' + encodeURIComponent(expected[0].channelDir));
});

// ---- Static-source regression guard (mirrors the pattern established by
// test/unit/subscribe-button.test.js / hard-delete-local-files.test.js /
// ytdlp-oneoff-modal.test.js) -------------------------------------------------

test('renderPinnedSidebar source calls derivePinnedPlaylistEntries and contains no innerHTML assignment (static regression guard)', () => {
  const stripComments = (src) => src.replace(/\/\/.*$/gm, '');
  const src = stripComments(renderPinnedSidebar.toString());
  assert.doesNotMatch(src, /\.innerHTML\s*=/, 'renderPinnedSidebar must never assign innerHTML');
  assert.match(src, /derivePinnedPlaylistEntries\(/, 'must reuse derivePinnedPlaylistEntries, not a second divergent derivation');
});
