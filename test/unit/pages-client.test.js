'use strict';

// [UNIT] v1.395.0 Pages, Step 5: the client. (1) The Download dialog's Page choice (P11): with
// yt-dlp on it is a third choice beside Video and Audio and hides the media-only fields; with
// yt-dlp off it is the only choice and the dialog is "Save to Pages"; a Page save never builds a
// media download body. (2) public/js/pages.js's pure helpers. (3) The item view in jsdom: the
// Reader HTML lands in its own container, and the Original is an iframe with
// sandbox="allow-popups allow-popups-to-escape-sandbox" (no allow-scripts, no allow-same-origin).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { buildOneOffModal, oneOffFormatOptions } = require('../../public/js/common.js');
const P = require('../../public/js/pages.js');

const fakeDom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
const fakeDoc = fakeDom.window.document;
const fire = (el, type) => el.dispatchEvent(new fakeDom.window.Event(type, { bubbles: true }));

test('Download dialog, yt-dlp on: Video, Audio, Page; Page hides quality / file type / folder and saves the link', () => {
  assert.deepStrictEqual(oneOffFormatOptions(true).map((o) => o.value), ['video', 'audio', 'page']);
  const saved = [];
  const downloads = [];
  const m = buildOneOffModal(fakeDoc, { onSavePage: (u) => saved.push(u), onDownload: (b) => downloads.push(b) });
  assert.deepStrictEqual([...m.formatSelect.options].map((o) => o.value), ['video', 'audio', 'page']);
  assert.strictEqual(m.formatSelect.value, 'video');
  assert.strictEqual(m.downloadBtn.textContent, 'Download');
  assert.strictEqual(m.qualitySelect.parentElement.hidden, false);
  m.formatSelect.value = 'page';
  fire(m.formatSelect, 'change');
  assert.strictEqual(m.qualitySelect.parentElement.hidden, true);
  assert.strictEqual(m.filetypeSelect.parentElement.hidden, true);
  assert.strictEqual(m.folderInput.hidden, true);
  assert.strictEqual(m.downloadBtn.textContent, 'Save to Pages');
  m.urlInput.value = '  https://example.com/story  ';
  m.downloadBtn.click();
  assert.deepStrictEqual(saved, ['https://example.com/story']);
  assert.deepStrictEqual(downloads, [], 'a Page never posts a media download');
  m.formatSelect.value = 'audio';
  fire(m.formatSelect, 'change');
  assert.strictEqual(m.qualitySelect.parentElement.hidden, false, 'back to a media choice: the fields return');
  assert.strictEqual(m.downloadBtn.textContent, 'Download');
  m.downloadBtn.click();
  assert.strictEqual(downloads.length, 1);
  assert.strictEqual(downloads[0].format, 'audio');
  assert.strictEqual(m.sheet.el.querySelector('.ui-sheet__title').textContent, 'One-off download');
});

test('Download dialog, yt-dlp off: Page is the only choice and the dialog is "Save to Pages"', () => {
  assert.deepStrictEqual(oneOffFormatOptions(false).map((o) => o.value), ['page']);
  const saved = [];
  const m = buildOneOffModal(fakeDoc, { mediaAllowed: false, onSavePage: (u) => saved.push(u), onDownload: () => assert.fail('no media download') });
  assert.deepStrictEqual([...m.formatSelect.options].map((o) => o.value), ['page']);
  assert.strictEqual(m.downloadBtn.textContent, 'Save to Pages');
  assert.strictEqual(m.qualitySelect.parentElement.hidden, true);
  assert.strictEqual(m.sheet.el.querySelector('.ui-sheet__title').textContent, 'Save to Pages');
  m.downloadBtn.click();
  assert.match(m.statusEl.textContent, /page's URL/);
  m.urlInput.value = 'https://example.com/a';
  m.downloadBtn.click();
  assert.deepStrictEqual(saved, ['https://example.com/a']);
});

test('pages.js pure helpers: a link vs text, the save body, the meta line, the scroll fraction, the route, the view choice', () => {
  assert.strictEqual(P.pagesLooksLikeUrl('https://example.com/a?b=1'), true);
  assert.strictEqual(P.pagesLooksLikeUrl('see https://example.com/a'), false, 'text around a link is text');
  assert.strictEqual(P.pagesLooksLikeUrl('javascript:alert(1)'), false);
  assert.deepStrictEqual(P.pagesSaveBody(' https://example.com/a ', ' why ', 'web'), { url: 'https://example.com/a', note: 'why', source: 'web' });
  assert.deepStrictEqual(P.pagesSaveBody('Some text', '', 'web'), { text: 'Some text', source: 'web' });
  const meta = P.pagesMetaText({ site: 'BBC News', author: 'BBC News', savedAt: '2026-10-25T12:00:00.000Z', readingMinutes: 4 });
  assert.ok(meta.startsWith('BBC News · Saved '), meta);
  assert.ok(!/BBC News · BBC News/.test(meta), 'a byline equal to the site shows once');
  assert.ok(meta.endsWith('4 min read'));
  assert.strictEqual(P.pagesScrollFraction(100, 100, 2000, 1000), 0);
  assert.strictEqual(P.pagesScrollFraction(600, 100, 2000, 1000), 0.5);
  assert.strictEqual(P.pagesScrollFraction(5000, 100, 2000, 1000), 1);
  assert.strictEqual(P.pagesScrollFraction(0, 0, 500, 1000), 1, 'a Reader shorter than the screen is read');
  assert.deepStrictEqual(P.pagesRouteState('?id=0123456789ab'), { mode: 'item', id: '0123456789ab' });
  assert.deepStrictEqual(P.pagesRouteState('?id=../x'), { mode: 'library' });
  assert.strictEqual(P.pagesPreferredView('original', { hasReader: true, hasOriginal: true }), 'original');
  assert.strictEqual(P.pagesPreferredView('original', { hasReader: true, hasOriginal: false }), 'reader', 'a text item has Reader only');
  assert.strictEqual(P.pagesPreferredView('reader', { hasReader: false, hasOriginal: true }), 'original', 'extraction failed: Original');
});

// The item view, driven through the REAL view script in jsdom with the real ui.js.
async function itemView({ id = '0123456789ab', item, reader, pref = 'reader' }) {
  const html = '<!doctype html><html><body><main><div id="view-root" data-view="pages"><section id="pages-library"></section><article id="pages-item" hidden></article></div></main></body></html>';
  const dom = new JSDOM(html, { url: `http://localhost/pages?id=${id}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.localStorage.setItem(P.PAGES_VIEW_PREF, pref);
  const calls = [];
  let gets = 0;
  w.fetch = (url, opts) => {
    calls.push([url, (opts && opts.method) || 'GET', opts && opts.body]);
    let body = {};
    if (url === `/api/pages/${id}` && !(opts && opts.method)) {
      gets += 1;
      // `saving` items: the first GET says saving, the poll's next GET says done.
      body = { item: gets > 1 ? { ...item, saving: false } : item, reader };
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  let view = null;
  w.FileTube = { registerView: (name, v) => { if (name === 'pages') view = v; } };
  w.eval(fs.readFileSync(path.join(__dirname, '../../public/js/icons.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname, '../../public/js/ui.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(__dirname, '../../public/js/pages.js'), 'utf8'));
  assert.ok(view, 'the view registered');
  view.init(w.document.getElementById('view-root'));
  for (let k = 0; k < 20 && !w.document.querySelector('.pages-item-title'); k += 1) await new Promise((r) => setTimeout(r, 10));
  return { dom, w, calls, view };
}

const ITEM = { id: '0123456789ab', kind: 'url', title: 'The boathouse', site: 'Gazette', author: 'Sam', url: 'https://example.com/b', publishedAt: null, savedAt: '2026-10-25T12:00:00.000Z', readingMinutes: 3, hasReader: true, hasOriginal: true, saving: false, read: false, position: null, trashedAt: null, note: 'from Sam', lists: [] };

test('item view: the Reader HTML lands in its own container; switching to Original builds the sandboxed iframe', async () => {
  const { w, view } = await itemView({ item: ITEM, reader: '<p>Hello <strong>reader</strong></p>\n' });
  const d = w.document;
  assert.strictEqual(d.querySelector('.pages-item-title').textContent, 'The boathouse');
  assert.strictEqual(d.querySelector('.pages-reader-body').innerHTML.trim(), '<p>Hello <strong>reader</strong></p>');
  assert.strictEqual(d.querySelector('.pages-reader-body').style.fontSize, '120%', 'the text size (default 120 % with no saved size)');
  assert.strictEqual(d.querySelector('.pages-note-text').textContent, 'from Sam');
  assert.strictEqual(d.querySelector('.pages-original-frame'), null, 'the Original is not loaded until asked for');
  const original = [...d.querySelectorAll('.ui-segmented button, .ui-segmented [role="radio"], .ui-segmented input')].find((b) => /Original/.test(b.textContent || b.value || '') || (b.labels && b.labels[0] && /Original/.test(b.labels[0].textContent)));
  assert.ok(original, 'the Reader / Original toggle');
  original.click();
  const frame = d.querySelector('.pages-original-frame');
  assert.ok(frame, 'the iframe');
  assert.strictEqual(frame.getAttribute('sandbox'), 'allow-popups allow-popups-to-escape-sandbox');
  assert.ok(!/allow-scripts|allow-same-origin/.test(frame.getAttribute('sandbox')));
  assert.strictEqual(frame.getAttribute('src'), '/api/pages/0123456789ab/original');
  assert.strictEqual(w.localStorage.getItem(P.PAGES_VIEW_PREF), 'original', 'the choice is remembered (a synced pref)');
  view.destroy();
});

test('item view: the remembered Original opens in Original; extraction failed says so and has no toggle', async () => {
  const a = await itemView({ item: ITEM, reader: '<p>x</p>', pref: 'original' });
  assert.ok(a.w.document.querySelector('.pages-original-frame'), 'Original first');
  assert.strictEqual(a.w.document.querySelector('.pages-reader').hidden, true);
  a.view.destroy();
  const b = await itemView({ item: { ...ITEM, hasReader: false }, reader: null });
  assert.ok(b.w.document.querySelector('.pages-original-frame'));
  assert.ok(!b.w.document.querySelector('.ui-segmented'), 'no toggle with one view');
  assert.match(b.w.document.querySelector('.pages-item-note').textContent, /Reader view unavailable/);
  b.view.destroy();
});

// Settings > Pages: each button mints its OWN save-only token (password first, named so Account >
// Devices tells them apart), shows it once with Copy, and the steps name this server's endpoint.
test('Settings > Pages: the Shortcut and the extension each mint a named shortcut token, shown once', async () => {
  const setup = require('../../public/js/setup.js');
  const markup = fs.readFileSync(path.join(__dirname, '../../public/setup.html'), 'utf8');
  const start = markup.indexOf('<details class="setup-box setup-sec sub-collapsible" data-collapse-key="pages"');
  const section = markup.slice(start, markup.indexOf('</details>', start) + 10);
  const dom = new JSDOM('<body>' + section + '</body>', { url: 'https://ft.example/setup.html' });
  const w = dom.window;
  const posts = [];
  global.window = w;
  global.document = w.document;
  const answers = ['pw-1', 'pw-2'];
  w.ui = { prompt: () => Promise.resolve(answers.shift()), button: (o) => { const b = w.document.createElement('button'); b.textContent = o.label; return b; } };
  global.fetch = (url, opts) => { posts.push([url, JSON.parse(opts.body)]); return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ token: 'ftd_' + posts.length, name: 'x' }) }); };
  try {
    setup.wirePagesSection(new w.AbortController().signal, w);
    assert.strictEqual(w.document.querySelector('[data-pages-endpoint]').textContent, 'https://ft.example/api/pages', 'the steps name this server');
    w.document.getElementById('pages-shortcut-btn').click();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepStrictEqual(posts[0], ['/api/devices', { name: 'iOS Shortcut', platform: 'shortcut', password: 'pw-1' }]);
    assert.strictEqual(w.document.querySelector('.pages-shortcut-token-field').value, 'ftd_1');
    assert.strictEqual(w.document.getElementById('pages-shortcut-token').hidden, false);
    w.document.getElementById('pages-extension-btn').click();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepStrictEqual(posts[1], ['/api/devices', { name: 'Browser extension', platform: 'shortcut', password: 'pw-2' }]);
    assert.strictEqual(w.document.querySelectorAll('.pages-shortcut-token-field').length, 1, 'one token on screen at a time');
    assert.strictEqual(w.document.querySelector('.pages-shortcut-token-field').value, 'ftd_2');
  } finally {
    delete global.window;
    delete global.document;
    delete global.fetch;
    w.close();
  }
});

test('gate r1 qa W1: after the "saving images" poll re-renders, the first render\'s scroll listener is gone (a scroll on Original never marks the page read)', async () => {
  const { w, calls, view } = await itemView({ item: { ...ITEM, saving: true }, reader: '<p>' + 'Long text. '.repeat(50) + '</p>' });
  await new Promise((r) => setTimeout(r, 3400)); // the poll (3 s) renders again
  assert.ok(calls.filter((c) => c[0] === '/api/pages/0123456789ab' && c[1] === 'GET').length >= 2, 'the poll re-rendered');
  const original = [...w.document.querySelectorAll('.ui-segmented button, .ui-segmented [role="radio"], .ui-segmented input')].find((b) => /Original/.test(b.textContent || ''));
  original.click();
  w.dispatchEvent(new w.Event('scroll'));
  await new Promise((r) => setTimeout(r, 1700)); // past the position debounce
  const patches = calls.filter((c) => c[1] === 'PATCH');
  assert.deepStrictEqual(patches, [], 'no position / read write from a stale listener');
  view.destroy();
});
