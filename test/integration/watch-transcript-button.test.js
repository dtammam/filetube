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
      if (prompts === 'reject') return Promise.reject(new TypeError('network down'));
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

test('watch page (phone): NO prompts configured -> no AI pick; a FAILING or REJECTING settings fetch -> no AI pick but Share/Copy still work', async () => {
  for (const prompts of [[], 'fail', 'reject']) {
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

// ---- GATE fix round 1: the unbound-but-correct branches ----
test('watch page (phone): SPA navigation away with the AI prompt pick-one open tears it down', async () => {
  const { fetchImpl } = makeWatchFetchStub(true, 200, TWO_PROMPTS);
  const { dom } = await loadWatchWithFetchStub(fetchImpl, null, true);
  try {
    await settle();
    const { document } = dom.window;
    click(dom, document.getElementById('transcript-media-btn'));
    await settle();
    click(dom, document.querySelectorAll('.choice-modal-btn')[2]);
    await new Promise((r) => setTimeout(r, 400));
    assert.deepStrictEqual(choiceLabels(document), ['Summarize', 'Analyze'], 'the pick-one is open');
    dom.window.FileTube.navigate('/');
    await new Promise((r) => setTimeout(r, 500));
    assert.strictEqual(document.querySelector('.choice-modal-list'), null, 'torn down on view abort');
  } finally { dom.window.close(); }
});

test('watch page (phone): a COMPLETED share-sheet share shows no toast; the clipboard fallback does', async () => {
  const { fetchImpl } = makeWatchFetchStub(true, 200, ONE_PROMPT);
  let { dom } = await loadWatchWithFetchStub(fetchImpl, (w) => { w.navigator.share = () => Promise.resolve(); }, true);
  try {
    await settle();
    const { document } = dom.window;
    click(dom, document.getElementById('transcript-media-btn'));
    await settle();
    click(dom, document.querySelectorAll('.choice-modal-btn')[2]);
    await settle();
    assert.strictEqual(document.querySelector('.toast'), null, 'the user saw the sheet - no toast on success');
  } finally { dom.window.close(); }
  const writes = [];
  ({ dom } = await loadWatchWithFetchStub(fetchImpl, (w) => installClipboard(w, writes), true));
  try {
    await settle();
    const { document } = dom.window;
    click(dom, document.getElementById('transcript-media-btn'));
    await settle();
    click(dom, document.querySelectorAll('.choice-modal-btn')[2]);
    await settle();
    assert.deepStrictEqual(writes, ['Summarize this.\n\n' + PLAIN_TEXT]);
    assert.match(document.querySelector('.toast').textContent, /Copied with your prompt/);
  } finally { dom.window.close(); }
});

// ---- v1.202 (Dean's action-row re-evaluation): the compact-mode "More" pick-one ----
test('watch page: More lists exactly the MOUNTED secondary buttons, in tier order, with their CURRENT labels; a pick clicks the real button', async () => {
  const watchedPosts = [];
  const { fetchImpl } = makeWatchFetchStub(true, 200, []);
  const wrapped = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    if (url === `/api/watched/${MEDIA_ID}` && init && init.method === 'POST') { watchedPosts.push(url); return Promise.resolve({ ok: true, status: 200, json: async () => ({}) }); }
    return fetchImpl(input, init);
  };
  const { dom } = await loadWatchWithFetchStub(wrapped);
  try {
    await settle();
    const { document } = dom.window;
    const more = document.getElementById('more-actions-btn');
    assert.ok(more, 'the More button ships in the markup');
    assert.ok(document.querySelector('.watch-action-btns').contains(more));
    click(dom, more);
    await settle();
    // NOT listed, by the mechanism: Delete is `hidden` and Move never mounts
    // because this stub's user probe never resolves (no canModifyLibrary);
    // Reheat's yt-dlp health probe never resolves; Attribute is behind the
    // v1.202 flag. The label is the button's CURRENT .btn-label text.
    assert.deepStrictEqual(choiceLabels(document), ['Next', 'Download', 'Mark watched'], 'mounted, non-hidden secondary buttons only, in SECONDARY_ACTION_IDS order');
    click(dom, document.querySelectorAll('.choice-modal-btn')[2]);
    await settle();
    assert.deepStrictEqual(watchedPosts, [`/api/watched/${MEDIA_ID}`], 'the pick ran the REAL Mark-watched handler');
  } finally { dom.window.close(); }
});

test('watch page: the More pick-one reflects a mutated label and is torn down on SPA navigation', async () => {
  const { fetchImpl } = makeWatchFetchStub(true, 200, []);
  const { dom } = await loadWatchWithFetchStub(fetchImpl);
  try {
    await settle();
    const { document } = dom.window;
    const watched = document.getElementById('watched-media-btn');
    watched.querySelector('.btn-label').textContent = 'Watched';
    click(dom, document.getElementById('more-actions-btn'));
    await settle();
    assert.ok(choiceLabels(document).includes('Watched'), 'says what the button says now');
    dom.window.FileTube.navigate('/');
    await new Promise((r) => setTimeout(r, 500));
    assert.strictEqual(document.querySelector('.choice-modal-list'), null, 'torn down on view abort');
  } finally { dom.window.close(); }
});

// ---- v1.202: the manual-attribution opt-in on the watch page (gate: the client gate was unbound) ----
// An ADMIN user probe plus a controllable /api/settings answer. `holdSettings`
// / `holdMe` park the answer until the test releases it (resolution order).
function adminStub(flag, opts) {
  const o = opts || {};
  const { fetchImpl } = makeWatchFetchStub(true, 200, []);
  const held = { settings: [], me: null, release() { held.settings.splice(0).forEach((r) => r()); } };
  const wrapped = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url);
    const method = (init && init.method) || 'GET';
    if (url === '/api/auth/me') {
      const ans = { ok: true, status: 200, json: async () => ({ user: { username: 'dean', role: 'admin' }, settings: {} }) };
      if (o.holdMe) return new Promise((r) => { held.me = () => r(ans); });
      return Promise.resolve(ans);
    }
    if (url === '/api/settings' && method === 'GET') {
      if (flag === 'reject') return Promise.reject(new TypeError('network down'));
      const ans = { ok: true, status: 200, json: async () => ({ mobileCustomPlayer: false, transcriptAiPrompts: [], attributeControlEnabled: flag }) };
      if (o.holdSettings) return new Promise((r) => { held.settings.push(() => r(ans)); });
      return Promise.resolve(ans);
    }
    return fetchImpl(input, init);
  };
  return { wrapped, held };
}
const attrBtn = (d) => d.getElementById('attribute-media-btn');
const barRevealed = (d) => !d.querySelector('.watch-actions').hasAttribute('data-loading');

test('watch page: admin + flag ON -> the Attribute button mounts (with the icon-attribute glyph); admin + flag OFF -> absent', async () => {
  let { wrapped } = adminStub(true);
  let { dom } = await loadWatchWithFetchStub(wrapped);
  try {
    await settle(20);
    const btn = attrBtn(dom.window.document);
    assert.ok(btn, 'mounted for an admin with the opt-in on');
    assert.strictEqual(btn.querySelector('i').className, 'icon-attribute');
  } finally { dom.window.close(); }
  ({ wrapped } = adminStub(false));
  ({ dom } = await loadWatchWithFetchStub(wrapped));
  try {
    await settle(20);
    assert.strictEqual(attrBtn(dom.window.document), null, 'absent with the opt-in off, even for an admin');
  } finally { dom.window.close(); }
});

test('watch page: the flag gate holds in BOTH resolution orders (settings last / user probe last), and a rejected settings fetch leaves it absent', async () => {
  let { wrapped, held } = adminStub(true, { holdSettings: true });
  let { dom } = await loadWatchWithFetchStub(wrapped);
  try {
    await settle(20);
    assert.strictEqual(attrBtn(dom.window.document), null, 'not before the flag is known');
    held.release(); await settle(20);
    assert.ok(attrBtn(dom.window.document), 'mounts when the flag arrives last');
  } finally { dom.window.close(); }
  ({ wrapped, held } = adminStub(true, { holdMe: true }));
  ({ dom } = await loadWatchWithFetchStub(wrapped));
  try {
    await settle(20);
    assert.strictEqual(attrBtn(dom.window.document), null);
    held.me(); await settle(20);
    assert.ok(attrBtn(dom.window.document), 'mounts when the user probe arrives last');
  } finally { dom.window.close(); }
  ({ wrapped } = adminStub('reject'));
  ({ dom } = await loadWatchWithFetchStub(wrapped));
  try {
    await settle(20);
    assert.strictEqual(attrBtn(dom.window.document), null, 'a failed settings fetch = opt-in unknown = absent');
    assert.ok(barRevealed(dom.window.document), 'the bar still reveals (the flag SETTLED on failure)');
  } finally { dom.window.close(); }
});

test('watch page: the action-bar reveal barrier WAITS for the flag answer (no late Attribute pop-in) - gate finding', async () => {
  const { wrapped, held } = adminStub(true, { holdSettings: true });
  const { dom } = await loadWatchWithFetchStub(wrapped);
  try {
    await settle(20);
    const d = dom.window.document;
    assert.strictEqual(barRevealed(d), false, 'media + capability settled, but the flag has not - still barriered');
    held.release(); await settle(20);
    assert.ok(barRevealed(d), 'revealed once the flag answered');
    assert.ok(attrBtn(d), 'and Attribute is already in the row at reveal time');
  } finally { dom.window.close(); }
});

test('watch page: More lists Attribute for admin + flag, and OMITS a disabled secondary button', async () => {
  const { wrapped } = adminStub(true);
  const { dom } = await loadWatchWithFetchStub(wrapped);
  try {
    await settle(20);
    const d = dom.window.document;
    d.getElementById('move-media-btn').disabled = true;
    click(dom, d.getElementById('more-actions-btn'));
    await settle();
    assert.deepStrictEqual(choiceLabels(d), ['Next', 'Download', 'Delete', 'Mark watched', 'Attribute'], 'Move (disabled) omitted; Attribute (flag on, admin, unattributed) listed');
  } finally { dom.window.close(); }
});

// ---- GATE (adversarial): one transcript surface at a time - the move had dropped the dismiss-before-open ----
test('watch page: activating Transcript again while its modal (desktop) or picker (phone) is open leaves exactly ONE', async () => {
  for (const phone of [false, true]) {
    const { fetchImpl } = makeWatchFetchStub(true, 200, []);
    const { dom } = await loadWatchWithFetchStub(fetchImpl, null, phone);
    try {
      await settle();
      const { document } = dom.window;
      const btn = document.getElementById('transcript-media-btn');
      click(dom, btn);
      await settle();
      click(dom, btn); // a keyboard user can reach the button behind the backdrop (no focus trap)
      await new Promise((r) => setTimeout(r, 500));
      const sel = phone ? '.choice-modal-list' : '.transcript-modal';
      assert.strictEqual(document.querySelectorAll(sel).length, 1, `one ${sel} (phone=${phone})`);
    } finally { dom.window.close(); }
  }
});

test('openTranscriptFor: a missing id resolves null and fetches nothing', async () => {
  const calls = [];
  const { fetchImpl } = makeWatchFetchStub(true, 200, []);
  const { dom } = await loadWatchWithFetchStub((i, init) => { calls.push(typeof i === 'string' ? i : i.url); return fetchImpl(i, init); });
  try {
    await settle();
    const before = calls.filter((u) => u.startsWith('/api/transcript/')).length;
    const out = await dom.window.openTranscriptFor({ id: undefined, title: 'x' });
    assert.strictEqual(out, null);
    assert.strictEqual(calls.filter((u) => u.startsWith('/api/transcript/')).length, before, 'no fetch');
  } finally { dom.window.close(); }
});
