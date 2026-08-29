'use strict';

// [INTEGRATION] v1.203 (Dean): the Transcript card corner runs the SAME flow
// as the watch page (common.js openTranscriptFor). Boots the real index.html
// on a `?root=` view with a captioned item and the corner assigned via the
// per-user prefs (/api/auth/me settings.cornerTL etc.), then: the corner
// renders only for the captioned item; a click fetches the transcript +
// prompts and opens the modal (desktop) or the picker (phone width) with the
// SAME picks; the payload shared from the picker is the fetched document.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole, requestInterceptor } = require('jsdom');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const ROOT = '/media/Some Channel';
const TEXT = 'A Captioned Clip\nPublished January 5, 2024\nSome Channel\n\nhello there\n';
function contentTypeFor(p) { return p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'application/octet-stream'; }

// `defer`: park every /api/transcript answer in `deferred` until the test releases it.
function loadFolder({ phone, prompts, defer }) {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const transcriptUrls = [];
  const deferred = [];
  const items = [
    { id: 'cap', title: 'A Captioned Clip', filePath: `${ROOT}/a.mp4`, folderName: 'Some Channel', rootFolder: ROOT, type: 'video', ext: '.mp4', duration: 10, size: 1, addedAt: 2, hasSubtitles: true, channelUrl: 'https://youtube.com/@x' },
    { id: 'plain', title: 'No Captions', filePath: `${ROOT}/b.mp4`, folderName: 'Some Channel', rootFolder: ROOT, type: 'video', ext: '.mp4', duration: 10, size: 1, addedAt: 1, channelUrl: 'https://youtube.com/@x' },
  ];
  return new Promise((resolve) => {
    const dom = new JSDOM(html, {
      url: `http://localhost/?root=${encodeURIComponent(ROOT)}`,
      runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
      resources: { interceptors: [requestInterceptor((request) => {
        const p = new URL(request.url).pathname; const f = path.join(PUBLIC_DIR, p);
        if (fs.existsSync(f) && fs.statSync(f).isFile()) return new Response(fs.readFileSync(f, 'utf8'), { status: 200, headers: { 'Content-Type': contentTypeFor(f) } });
        return new Response('', { status: 404 });
      })] },
      beforeParse(window) {
        window.matchMedia = (q) => ({ matches: !!phone && q === '(max-width: 768px)', media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
        window.fetch = (input, init) => {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          const method = (init && init.method) || 'GET';
          const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
          if (url === '/api/settings' && method === 'GET') return json({ defaultView: '', defaultSort: 'release-date', attributeControlEnabled: false, transcriptAiPrompts: prompts || [] });
          if (url === '/api/auth/me') return json({ user: { username: 'dean', role: 'admin' }, settings: { cornerTL: 'transcript', cornerTR: 'none', cornerBL: 'none' } });
          if (url === '/api/config') return json({ folders: [ROOT], folderSettings: {} });
          if (url.startsWith('/api/transcript/')) { transcriptUrls.push(url); const ans = { ok: true, status: 200, text: async () => TEXT }; if (defer) return new Promise((r) => deferred.push(() => r(ans))); return Promise.resolve(ans); }
          if (url.startsWith('/api/videos')) return json({ items, total: items.length, offset: 0, limit: 50 });
          if (url.startsWith('/api/')) return json({ items: [], folders: [], rows: [] });
          // The SPA router fetches the next view's SHELL on navigation - answer
          // with the real index.html (a hanging shell would keep the old view
          // mounted and make the navigate-away scenario vacuous).
          return Promise.resolve({ ok: true, status: 200, url: 'http://localhost' + url, redirected: false, headers: { get: (h) => (/content-type/i.test(h) ? 'text/html' : null) }, text: async () => html });
        };
      },
    });
    dom.window.addEventListener('load', () => setTimeout(() => resolve({ dom, transcriptUrls, deferred }), 60));
    setTimeout(() => resolve({ dom, transcriptUrls, deferred }), 5000);
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

test('card corner: Transcript renders on the captioned card only; a click (desktop) opens the read-only modal with the fetched document', async () => {
  const { dom, transcriptUrls } = await loadFolder({ phone: false });
  try {
    await wait(400);
    const d = dom.window.document;
    const corners = Array.from(d.querySelectorAll('.card-transcript-btn'));
    assert.deepStrictEqual(corners.map((b) => b.dataset.id), ['cap'], 'only the captioned item gets the corner');
    click(dom, corners[0]);
    await wait(200);
    assert.deepStrictEqual(transcriptUrls, ['/api/transcript/cap']);
    const ta = d.getElementById('transcript-text');
    assert.ok(ta && ta.readOnly, 'the SAME modal as the watch page');
    assert.strictEqual(ta.value, TEXT);
  } finally { dom.window.close(); }
});

test('card corner (phone width): the click opens the SAME picker - Share / Copy / Share with AI - and Share hands navigator.share {title, text}', async () => {
  const shares = [];
  const { dom } = await loadFolder({ phone: true, prompts: [{ id: 'summarize', name: 'Summarize', text: 'Sum it.' }] });
  try {
    dom.window.navigator.share = (p) => { shares.push(p); return Promise.resolve(); };
    await wait(400);
    const d = dom.window.document;
    click(dom, d.querySelector('.card-transcript-btn'));
    await wait(200);
    assert.deepStrictEqual(Array.from(d.querySelectorAll('.choice-modal-btn')).map((b) => b.textContent), ['Share transcript', 'Copy transcript', 'Share with AI']);
    click(dom, d.querySelectorAll('.choice-modal-btn')[0]);
    await wait(50);
    assert.strictEqual(shares.length, 1);
    assert.strictEqual(shares[0].title, 'A Captioned Clip', 'the item title from the fetched list');
    assert.strictEqual(shares[0].text, TEXT);
  } finally { dom.window.close(); }
});

// ---- GATE (adversarial): a late text must never open over ANOTHER page ----
test('card corner: click, then navigate away before the text lands -> nothing opens (cached-away view via stillWanted AND a real abort)', async () => {
  for (const target of ['/history', '/?liked=1']) {
    const { dom, deferred } = await loadFolder({ phone: false, defer: true });
    try {
      await wait(400);
      const d = dom.window.document;
      click(dom, d.querySelector('.card-transcript-btn'));
      await wait(50);
      dom.window.FileTube.navigate(target);
      await wait(400);
      deferred.splice(0).forEach((r) => r());
      await wait(300);
      assert.strictEqual(d.querySelector('.transcript-modal'), null, `no modal over ${target}`);
      assert.strictEqual(d.querySelector('.choice-modal-list'), null);
    } finally { dom.window.close(); }
  }
});

test('card corner: three rapid clicks while the text is loading -> ONE fetch and ONE modal (the corner disables itself)', async () => {
  const { dom, transcriptUrls, deferred } = await loadFolder({ phone: false, defer: true });
  try {
    await wait(400);
    const d = dom.window.document;
    const corner = d.querySelector('.card-transcript-btn');
    click(dom, corner); click(dom, corner); click(dom, corner);
    await wait(50);
    assert.strictEqual(transcriptUrls.length, 1, 'one fetch');
    assert.strictEqual(corner.disabled, true, 'disabled while loading');
    deferred.splice(0).forEach((r) => r());
    await wait(300);
    assert.strictEqual(d.querySelectorAll('.transcript-modal').length, 1);
    assert.strictEqual(corner.disabled, false, 're-enabled after');
  } finally { dom.window.close(); }
});
