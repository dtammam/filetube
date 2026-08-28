'use strict';

// [INTEGRATION] Transcript export (Dean) -- the watch-page "Transcript" button.
// Boots the REAL watch.html + public/js under jsdom (the watch-share-button
// harness) with a scripted fetch stub and binds the DOM contract:
//
//   - mounts inside `.watch-action-btns` ONLY when `/api/videos/:id` carries
//     `hasSubtitles: true`; absent otherwise
//   - DESKTOP click: fetches `/api/transcript/:id` (no timestamps) and opens
//     the read-only text-field modal holding that exact text; the "Show
//     timestamps" box re-fetches with `?timestamps=1` (and back); Copy writes
//     the textarea's CURRENT value to the clipboard with "Copied!" feedback
//   - PHONE width (the page's 768px query): the same click opens the
//     share/copy picker instead; "Share transcript" calls
//     `navigator.share({title, text})` with the fetched text (no url)
//   - an error from the transcript route toasts, never opens anything
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const WATCH_HTML_PATH = path.join(PUBLIC_DIR, 'watch.html');

const MEDIA_ID = 'transcript-item-1';
const PLAIN_TEXT = 'A Captioned Video\nPublished January 5, 2024\nTim Dylan\n\nLadies and gentlemen\nwelcome back\n';
const TS_TEXT = 'A Captioned Video\nPublished January 5, 2024\nTim Dylan\n\n[0:00] Ladies and gentlemen\n[0:02] welcome back\n';

function contentTypeFor(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}

function makeMediaResponse(hasSubtitles) {
  return {
    id: MEDIA_ID, title: 'A Captioned Video', filePath: `/media/folder/${MEDIA_ID}.mp4`, folderName: 'folder',
    type: 'video', ext: '.mp4', duration: 120, size: 5000, addedAt: 100000, liked: false,
    ...(hasSubtitles ? { hasSubtitles: true } : {}),
  };
}

// `transcriptStatus` lets a test make the route fail. Records every
// transcript URL requested so the timestamps toggle is bound by URL.
const ONE_PROMPT = [{ id: 'summarize', name: 'Summarize', text: 'Summarize this.' }];
const TWO_PROMPTS = [{ id: 'summarize', name: 'Summarize', text: 'Summarize this.' }, { id: 'analyze', name: 'Analyze', text: 'Analyze this deeply.' }];

// `aiPrompts`: the /api/settings answer's transcriptAiPrompts (default ONE);
// [] = none configured; 'fail' = the settings route 500s.
function makeWatchFetchStub(hasSubtitles, transcriptStatus, aiPrompts) {
  const transcriptUrls = [];
  const prompts = aiPrompts === undefined ? ONE_PROMPT : aiPrompts;
  const fetchImpl = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    if (url === '/api/settings' && method === 'GET') {
      if (prompts === 'fail') return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ mobileCustomPlayer: false, transcriptAiPrompts: prompts }) });
    }
    if (url === '/api/config' && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ folders: [], folderSettings: {} }) });
    }
    if (url === `/api/videos/${MEDIA_ID}` && method === 'GET') {
      return Promise.resolve({ ok: true, status: 200, json: async () => makeMediaResponse(hasSubtitles) });
    }
    if (typeof url === 'string' && url.startsWith(`/api/transcript/${MEDIA_ID}`)) {
      transcriptUrls.push(url);
      const status = transcriptStatus || 200;
      if (status !== 200) return Promise.resolve({ ok: false, status, text: async () => '' });
      return Promise.resolve({ ok: true, status: 200, text: async () => (url.includes('timestamps=1') ? TS_TEXT : PLAIN_TEXT) });
    }
    // The SPA router fetches the NEXT view's shell BEFORE calling this
    // view's destroy() - the abort-teardown test below needs that fetch to
    // resolve, so any non-API URL answers with the real index.html.
    if (typeof url === 'string' && !url.startsWith('/api/')) {
      const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
      return Promise.resolve({ ok: true, status: 200, url: 'http://localhost/', redirected: false, headers: { get: (h) => (/content-type/i.test(h) ? 'text/html' : null) }, text: async () => html });
    }
    return new Promise(() => {}); // everything else -- irrelevant here
  };
  return { fetchImpl, transcriptUrls };
}

function loadWatchWithFetchStub(fetchImpl, configureWindow, phoneWidth) {
  const html = fs.readFileSync(WATCH_HTML_PATH, 'utf8');
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    url: `http://localhost/watch.html?v=${MEDIA_ID}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    resources: {
      interceptors: [
        requestInterceptor((request) => {
          const requestUrl = new URL(request.url);
          const filePath = path.join(PUBLIC_DIR, requestUrl.pathname);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            return new Response(fs.readFileSync(filePath, 'utf8'), { status: 200, headers: { 'Content-Type': contentTypeFor(filePath) } });
          }
          return new Response('', { status: 404 });
        }),
      ],
    },
    beforeParse(window) {
      window.fetch = fetchImpl;
      // ARGUMENT-AWARE (the v1.198.2 lesson): only the page's phone query
      // answers true under `phoneWidth`; every other query stays false, so a
      // test cannot pass by an any-query stub.
      window.matchMedia = function (query) {
        return {
          matches: !!phoneWidth && query === '(max-width: 768px)',
          media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
        };
      };
      if (configureWindow) configureWindow(window);
    },
  });
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; resolve({ dom }); };
    dom.window.addEventListener('load', () => setTimeout(finish, 20));
    setTimeout(finish, 5000);
  });
}

function flush() { return new Promise((resolve) => setTimeout(resolve, 0)); }
async function settle(times) { for (let i = 0; i < (times || 10); i++) await flush(); }

function installClipboard(window, writes) {
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (text) => { writes.push(text); return Promise.resolve(); } },
  });
}

function click(dom, el) { el.dispatchEvent(new dom.window.Event('click', { bubbles: true })); }

test('watch page: the Transcript button mounts inside .watch-action-btns (icon + hideable label) when the item has captions', async () => {
  const { fetchImpl } = makeWatchFetchStub(true);
  const { dom } = await loadWatchWithFetchStub(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const btn = document.getElementById('transcript-media-btn');
    assert.ok(btn, 'expected a #transcript-media-btn');
    assert.ok(document.querySelector('.watch-action-btns').contains(btn), 'lives in the nowrap button sub-group beside Share');
    assert.strictEqual(btn.querySelector('.btn-label').textContent, 'Transcript');
    assert.ok(btn.querySelector('i.icon-transcript'), 'the glyph accompanies the phone-hideable label');
    assert.strictEqual(btn.className, 'btn', 'the SAME .btn as Share/Like - no bespoke sizing');
  } finally { dom.window.close(); }
});

test('watch page: NO Transcript button for an item without captions', async () => {
  const { fetchImpl } = makeWatchFetchStub(false);
  const { dom } = await loadWatchWithFetchStub(fetchImpl);
  try {
    await settle();
    assert.strictEqual(dom.window.document.getElementById('transcript-media-btn'), null);
  } finally { dom.window.close(); }
});

test('watch page (desktop): click fetches the plain transcript and opens the read-only text-field modal holding it', async () => {
  const { fetchImpl, transcriptUrls } = makeWatchFetchStub(true);
  const { dom } = await loadWatchWithFetchStub(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    click(dom, document.getElementById('transcript-media-btn'));
    await settle();
    assert.deepStrictEqual(transcriptUrls, [`/api/transcript/${MEDIA_ID}`], 'exactly one fetch, WITHOUT timestamps (default off)');
    const modal = document.querySelector('.modal-content.transcript-modal');
    assert.ok(modal, 'the transcript modal opened');
    const ta = modal.querySelector('textarea#transcript-text');
    assert.ok(ta && ta.readOnly, 'a READ-ONLY textarea');
    assert.strictEqual(ta.value, PLAIN_TEXT);
    const box = modal.querySelector('#transcript-timestamps');
    assert.ok(box && box.checked === false, '"Show timestamps" defaults OFF (Dean)');
    assert.strictEqual(document.querySelector('.choice-modal-list'), null, 'desktop never gets the phone picker');
  } finally { dom.window.close(); }
});

test('watch page (desktop): toggling "Show timestamps" re-fetches with ?timestamps=1 and swaps the text; untoggling restores it', async () => {
  const { fetchImpl, transcriptUrls } = makeWatchFetchStub(true);
  const { dom } = await loadWatchWithFetchStub(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    click(dom, document.getElementById('transcript-media-btn'));
    await settle();
    const box = document.getElementById('transcript-timestamps');
    const ta = document.getElementById('transcript-text');
    box.checked = true;
    box.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    assert.strictEqual(ta.value, TS_TEXT);
    box.checked = false;
    box.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    assert.strictEqual(ta.value, PLAIN_TEXT);
    assert.deepStrictEqual(transcriptUrls, [
      `/api/transcript/${MEDIA_ID}`, `/api/transcript/${MEDIA_ID}?timestamps=1`, `/api/transcript/${MEDIA_ID}`,
    ]);
    assert.strictEqual(box.disabled, false, 're-enabled after each load');
  } finally { dom.window.close(); }
});

test('watch page (desktop): Copy writes the textarea\'s CURRENT value (timestamped when toggled) and shows "Copied!"', async () => {
  const writes = [];
  const { fetchImpl } = makeWatchFetchStub(true);
  const { dom } = await loadWatchWithFetchStub(fetchImpl, (w) => installClipboard(w, writes));
  try {
    await settle();
    const { document } = dom.window;
    click(dom, document.getElementById('transcript-media-btn'));
    await settle();
    const copyBtn = document.getElementById('transcript-copy-btn');
    click(dom, copyBtn);
    await settle();
    assert.deepStrictEqual(writes, [PLAIN_TEXT]);
    assert.strictEqual(copyBtn.textContent, 'Copied!');
    const box = document.getElementById('transcript-timestamps');
    box.checked = true;
    box.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    click(dom, copyBtn);
    await settle();
    assert.deepStrictEqual(writes, [PLAIN_TEXT, TS_TEXT], 'copies what is SHOWN, not a stale cache');
  } finally { dom.window.close(); }
});

test('watch page (desktop): Close tears the modal down; a second click opens a fresh one', async () => {
  const { fetchImpl } = makeWatchFetchStub(true);
  const { dom } = await loadWatchWithFetchStub(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const btn = document.getElementById('transcript-media-btn');
    click(dom, btn);
    await settle();
    const closeBtn = Array.from(document.querySelectorAll('.transcript-modal .modal-actions .btn')).find((b) => b.textContent === 'Close');
    assert.ok(closeBtn, 'a Close button');
    click(dom, closeBtn);
    // closeOverlayThen waits for transitionend or its 300ms fallback (jsdom
    // fires no transition events) - wait real time, not microtasks.
    await new Promise((r) => setTimeout(r, 400));
    assert.strictEqual(document.querySelector('.transcript-modal'), null, 'removed from the body after the close transition');
    click(dom, btn);
    await settle();
    assert.strictEqual(document.querySelectorAll('.transcript-modal').length, 1);
  } finally { dom.window.close(); }
});

test('watch page (phone width): click opens the share/copy picker; "Share transcript" hands navigator.share {title, text}', async () => {
  const shareCalls = [];
  const { fetchImpl } = makeWatchFetchStub(true);
  const { dom } = await loadWatchWithFetchStub(fetchImpl, (w) => {
    w.navigator.share = (payload) => { shareCalls.push(payload); return Promise.resolve(); };
  }, true);
  try {
    await settle();
    const { document } = dom.window;
    click(dom, document.getElementById('transcript-media-btn'));
    await settle();
    assert.strictEqual(document.querySelector('.transcript-modal'), null, 'phones never get the textarea modal');
    const choices = Array.from(document.querySelectorAll('.choice-modal-btn')).map((b) => b.textContent);
    // v1.201: the stub serves ONE default prompt, so the AI pick is third.
    assert.deepStrictEqual(choices, ['Share transcript', 'Copy transcript', 'Share with AI']);
    click(dom, document.querySelectorAll('.choice-modal-btn')[0]);
    await settle();
    assert.strictEqual(shareCalls.length, 1);
    assert.strictEqual(shareCalls[0].title, 'A Captioned Video');
    assert.strictEqual(shareCalls[0].text, PLAIN_TEXT);
    assert.strictEqual(Object.keys(shareCalls[0]).length, 2, 'exactly {title, text} - no url');
  } finally { dom.window.close(); }
});

test('watch page (phone width): "Copy transcript" writes the prefetched text to the clipboard', async () => {
  const writes = [];
  const { fetchImpl, transcriptUrls } = makeWatchFetchStub(true);
  const { dom } = await loadWatchWithFetchStub(fetchImpl, (w) => installClipboard(w, writes), true);
  try {
    await settle();
    const { document } = dom.window;
    click(dom, document.getElementById('transcript-media-btn'));
    await settle();
    const before = transcriptUrls.length;
    click(dom, document.querySelectorAll('.choice-modal-btn')[1]);
    await settle();
    assert.deepStrictEqual(writes, [PLAIN_TEXT]);
    assert.strictEqual(transcriptUrls.length, before, 'copy uses the PREFETCHED text - no fetch inside the tap (iOS gesture rule)');
  } finally { dom.window.close(); }
});

test('watch page: a failing transcript route toasts and opens nothing; the button re-enables', async () => {
  const { fetchImpl } = makeWatchFetchStub(true, 404);
  const { dom } = await loadWatchWithFetchStub(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const btn = document.getElementById('transcript-media-btn');
    click(dom, btn);
    await settle();
    assert.strictEqual(document.querySelector('.transcript-modal'), null);
    assert.strictEqual(document.querySelector('.choice-modal-list'), null);
    assert.ok(document.querySelector('.toast'), 'a toast explains the failure');
    assert.strictEqual(btn.disabled, false);
  } finally { dom.window.close(); }
});

// GATE (QA W2 / adversarial W3): the abort teardown was implemented but
// UNBOUND - deleting the `signal.addEventListener('abort', ...)` line left
// 9/9 green. A body-level modal outlives SPA navigation on its own (the
// v1.49 lesson), so navigating away must close BOTH shapes.
test('watch page: SPA navigation away tears down the open transcript modal (desktop) and the picker (phone)', async () => {
  for (const phone of [false, true]) {
    const { fetchImpl } = makeWatchFetchStub(true);
    const { dom } = await loadWatchWithFetchStub(fetchImpl, null, phone);
    try {
      await settle();
      const { document } = dom.window;
      click(dom, document.getElementById('transcript-media-btn'));
      await settle();
      const sel = phone ? '.choice-modal-list' : '.transcript-modal';
      assert.ok(document.querySelector(sel), 'opened: ' + sel);
      assert.equal(typeof dom.window.FileTube.navigate, 'function', 'the real router is up');
      dom.window.FileTube.navigate('/');
      await new Promise((r) => setTimeout(r, 500)); // shell fetch + destroy() + the 300ms close fallback
      assert.strictEqual(document.querySelector(sel), null, 'torn down on view abort: ' + sel);
    } finally { dom.window.close(); }
  }
});

// ---- v1.201 (Dean): "Share with AI" ------------------------------------------
// Payload contract: `<prompt>\n\n<the same document Share/Copy send>`.

function choiceLabels(document) { return Array.from(document.querySelectorAll('.choice-modal-btn')).map((b) => b.textContent); }

test('watch page (phone): "Share with AI" is the THIRD pick when one prompt exists, and shares prompt + blank line + transcript', async () => {
  const shareCalls = [];
  const { fetchImpl } = makeWatchFetchStub(true, 200, ONE_PROMPT);
  const { dom } = await loadWatchWithFetchStub(fetchImpl, (w) => { w.navigator.share = (p) => { shareCalls.push(p); return Promise.resolve(); }; }, true);
  try {
    await settle();
    const { document } = dom.window;
    click(dom, document.getElementById('transcript-media-btn'));
    await settle();
    assert.deepStrictEqual(choiceLabels(document), ['Share transcript', 'Copy transcript', 'Share with AI']);
    click(dom, document.querySelectorAll('.choice-modal-btn')[2]);
    await settle();
    assert.strictEqual(shareCalls.length, 1, 'ONE prompt shares immediately - no second pick');
    assert.strictEqual(shareCalls[0].text, 'Summarize this.\n\n' + PLAIN_TEXT);
    assert.strictEqual(shareCalls[0].title, 'A Captioned Video');
    assert.strictEqual(Object.keys(shareCalls[0]).length, 2);
  } finally { dom.window.close(); }
});

test('watch page (phone): with SEVERAL prompts, "Share with AI" opens a pick-one of their names; the pick decides the preamble', async () => {
  const shareCalls = [];
  const { fetchImpl } = makeWatchFetchStub(true, 200, TWO_PROMPTS);
  const { dom } = await loadWatchWithFetchStub(fetchImpl, (w) => { w.navigator.share = (p) => { shareCalls.push(p); return Promise.resolve(); }; }, true);
  try {
    await settle();
    const { document } = dom.window;
    click(dom, document.getElementById('transcript-media-btn'));
    await settle();
    click(dom, document.querySelectorAll('.choice-modal-btn')[2]);
    await new Promise((r) => setTimeout(r, 400)); // the first picker closes (300ms fallback), the second opens
    assert.deepStrictEqual(choiceLabels(document), ['Summarize', 'Analyze'], 'the prompt names, in settings order');
    assert.strictEqual(shareCalls.length, 0, 'nothing shared until a prompt is picked');
    click(dom, document.querySelectorAll('.choice-modal-btn')[1]);
    await settle();
    assert.strictEqual(shareCalls[0].text, 'Analyze this deeply.\n\n' + PLAIN_TEXT);
  } finally { dom.window.close(); }
});

test('watch page (phone): NO prompts configured -> no AI pick; a FAILING settings route -> no AI pick but Share/Copy still work', async () => {
  for (const prompts of [[], 'fail']) {
    const { fetchImpl } = makeWatchFetchStub(true, 200, prompts);
    const { dom } = await loadWatchWithFetchStub(fetchImpl, null, true);
    try {
      await settle();
      const { document } = dom.window;
      click(dom, document.getElementById('transcript-media-btn'));
      await settle();
      assert.deepStrictEqual(choiceLabels(document), ['Share transcript', 'Copy transcript'], JSON.stringify(prompts));
    } finally { dom.window.close(); }
  }
});

test('watch page (desktop): the modal gets "Copy for AI" without a share sheet; it copies prompt + blank line + the CURRENT text (timestamps follow the box)', async () => {
  const writes = [];
  const { fetchImpl } = makeWatchFetchStub(true, 200, ONE_PROMPT);
  const { dom } = await loadWatchWithFetchStub(fetchImpl, (w) => installClipboard(w, writes));
  try {
    await settle();
    const { document } = dom.window;
    click(dom, document.getElementById('transcript-media-btn'));
    await settle();
    const aiBtn = document.getElementById('transcript-ai-btn');
    assert.ok(aiBtn, 'the third button exists');
    assert.strictEqual(aiBtn.textContent, 'Copy for AI', 'no navigator.share in this jsdom -> the copy label');
    click(dom, aiBtn);
    await settle();
    assert.deepStrictEqual(writes, ['Summarize this.\n\n' + PLAIN_TEXT]);
    const box = document.getElementById('transcript-timestamps');
    box.checked = true;
    box.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();
    click(dom, aiBtn);
    await settle();
    assert.deepStrictEqual(writes[1], 'Summarize this.\n\n' + TS_TEXT, 'follows the Show timestamps box');
  } finally { dom.window.close(); }
});

test('watch page (desktop): with a share sheet the button reads "Share with AI"; several prompts -> a pick-one first; no prompts -> no button', async () => {
  const shareCalls = [];
  let { fetchImpl } = makeWatchFetchStub(true, 200, TWO_PROMPTS);
  let { dom } = await loadWatchWithFetchStub(fetchImpl, (w) => { w.navigator.share = (p) => { shareCalls.push(p); return Promise.resolve(); }; });
  try {
    await settle();
    const { document } = dom.window;
    click(dom, document.getElementById('transcript-media-btn'));
    await settle();
    const aiBtn = document.getElementById('transcript-ai-btn');
    assert.strictEqual(aiBtn.textContent, 'Share with AI');
    click(dom, aiBtn);
    await settle();
    assert.deepStrictEqual(choiceLabels(document), ['Summarize', 'Analyze']);
    click(dom, document.querySelectorAll('.choice-modal-btn')[0]);
    await settle();
    assert.strictEqual(shareCalls[0].text, 'Summarize this.\n\n' + PLAIN_TEXT);
  } finally { dom.window.close(); }
  ({ fetchImpl } = makeWatchFetchStub(true, 200, []));
  ({ dom } = await loadWatchWithFetchStub(fetchImpl));
  try {
    await settle();
    click(dom, dom.window.document.getElementById('transcript-media-btn'));
    await settle();
    assert.ok(dom.window.document.querySelector('.transcript-modal'), 'modal still opens');
    assert.strictEqual(dom.window.document.getElementById('transcript-ai-btn'), null, 'no prompts -> no AI button');
  } finally { dom.window.close(); }
});

test('watch page (desktop): SPA navigation away with the prompt pick-one open tears BOTH modals down', async () => {
  const { fetchImpl } = makeWatchFetchStub(true, 200, TWO_PROMPTS);
  const { dom } = await loadWatchWithFetchStub(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    click(dom, document.getElementById('transcript-media-btn'));
    await settle();
    click(dom, document.getElementById('transcript-ai-btn'));
    await settle();
    assert.ok(document.querySelector('.choice-modal-list'), 'the pick-one is open over the modal');
    dom.window.FileTube.navigate('/');
    await new Promise((r) => setTimeout(r, 500));
    assert.strictEqual(document.querySelector('.transcript-modal'), null);
    assert.strictEqual(document.querySelector('.choice-modal-list'), null);
  } finally { dom.window.close(); }
});
