// Proof-of-approach tests for the pure client module (no browser, no server).
// Run standalone:  node --test extension/ftClient.test.js
// These bind the auth/POST request-building and response-interpretation logic
// that would otherwise only be exercisable by hand in a browser. NOT yet wired
// into the repo's `npm test` (that suite is server-side) - see the design doc's
// test-harness proposal and open decision on where extension tests live in CI.

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ftClient.js is an ES module; node:test can import it dynamically.
async function mod() { return import('./ftClient.js'); }

test('buildDownloadRequest: not configured -> configured:false', async () => {
  const { buildDownloadRequest } = await mod();
  const r = buildDownloadRequest({ instanceUrl: '', apiToken: '', url: 'https://x.tld/a', format: 'audio' });
  assert.equal(r.ok, false);
  assert.equal(r.configured, false);
});

test('buildDownloadRequest: rejects a bad format', async () => {
  const { buildDownloadRequest } = await mod();
  const r = buildDownloadRequest({ instanceUrl: 'https://ft.tld', apiToken: 't', url: 'https://x.tld/a', format: 'mp3' });
  assert.equal(r.ok, false);
  assert.match(r.error, /audio.*video/);
});

test('buildDownloadRequest: builds the token POST with {url, format} only (D4)', async () => {
  const { buildDownloadRequest, DOWNLOAD_PATH } = await mod();
  const r = buildDownloadRequest({ instanceUrl: 'https://ft.tld/', apiToken: 'secret', url: 'https://x.tld/a', format: 'video' });
  assert.equal(r.ok, true);
  assert.equal(r.request.endpoint, `https://ft.tld${DOWNLOAD_PATH}`); // trailing slash normalized
  assert.equal(r.request.init.method, 'POST');
  assert.equal(r.request.init.headers['X-FileTube-Token'], 'secret');
  assert.equal(r.request.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(r.request.init.body), { url: 'https://x.tld/a', format: 'video' });
});

test('interpretDownloadResponse: 202 -> jobId; error -> verbatim server message', async () => {
  const { interpretDownloadResponse } = await mod();
  assert.deepEqual(interpretDownloadResponse(202, { accepted: true, jobId: 'j1' }), { ok: true, status: 202, jobId: 'j1' });
  const bad = interpretDownloadResponse(400, { error: 'That YouTube URL is not a single video' });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'That YouTube URL is not a single video'); // verbatim, not invented
});

test('buildTestRequest: side-effect-free empty-url probe', async () => {
  const { buildTestRequest } = await mod();
  const r = buildTestRequest({ instanceUrl: 'https://ft.tld', apiToken: 't' });
  assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(r.request.init.body), { url: '' }); // empty url -> server 400 before any queue
});

test('interpretTestResponse: token/endpoint verdicts', async () => {
  const { interpretTestResponse } = await mod();
  assert.equal(interpretTestResponse(401, { error: 'invalid API token' }, 'application/json').ok, false);
  assert.equal(interpretTestResponse(400, { error: 'A media URL is required' }, 'application/json').ok, true); // token accepted
  assert.equal(interpretTestResponse(404, null, 'text/html').ok, false); // endpoint missing
  assert.equal(interpretTestResponse(200, null, 'text/html').ok, false); // HTML shell = not the API
  const ro = interpretTestResponse(403, { readOnlyMedia: true, error: 'read-only' }, 'application/json');
  assert.equal(ro.ok, true);
  assert.match(ro.message, /read-only/i);
});

// v1.370.0 (R10): Audio / Video send ONE video; a playlist tab offers the picker (never for a Mix).
test('singleVideoUrl: a watch link that names a list loses the list; everything else is untouched', async () => {
  const { singleVideoUrl, buildDownloadRequest } = await mod();
  assert.equal(singleVideoUrl('https://www.youtube.com/watch?v=U3P8pUboZ5g&list=PLUtyNbQXMTLg&index=3'), 'https://www.youtube.com/watch?v=U3P8pUboZ5g');
  assert.equal(singleVideoUrl('https://youtu.be/U3P8pUboZ5g?list=PLUtyNbQXMTLg&si=x'), 'https://youtu.be/U3P8pUboZ5g?si=x');
  assert.equal(singleVideoUrl('https://www.youtube.com/watch?v=U3P8pUboZ5g&list=RDU3P8pUboZ5g&start_radio=1'), 'https://www.youtube.com/watch?v=U3P8pUboZ5g');
  assert.equal(singleVideoUrl('https://www.youtube.com/playlist?list=PLUtyNbQXMTLg'), 'https://www.youtube.com/playlist?list=PLUtyNbQXMTLg', 'a list page has no one video');
  assert.equal(singleVideoUrl('https://vimeo.com/1?list=2'), 'https://vimeo.com/1?list=2');
  assert.equal(singleVideoUrl('not a url'), 'not a url');
  const r = buildDownloadRequest({ instanceUrl: 'https://ft.example', apiToken: 't', url: 'https://www.youtube.com/watch?v=U3P8pUboZ5g&list=PLUtyNbQXMTLg', format: 'video' });
  assert.deepEqual(JSON.parse(r.request.init.body), { url: 'https://www.youtube.com/watch?v=U3P8pUboZ5g', format: 'video' });
});

test('playlistPickUrl: a list tab opens the instance picker; a Mix, a plain video, another site: none', async () => {
  const { playlistPickUrl } = await mod();
  const tab = 'https://www.youtube.com/watch?v=U3P8pUboZ5g&list=PLUtyNbQXMTLg';
  assert.equal(playlistPickUrl('https://ft.example/', tab), 'https://ft.example/subscriptions?pick=' + encodeURIComponent(tab));
  assert.equal(playlistPickUrl('https://ft.example', 'https://www.youtube.com/watch?v=U3P8pUboZ5g&list=RDU3P8pUboZ5g'), null);
  assert.equal(playlistPickUrl('https://ft.example', 'https://www.youtube.com/watch?v=U3P8pUboZ5g'), null);
  assert.equal(playlistPickUrl('https://ft.example', 'https://example.com/?list=PL1'), null);
  assert.equal(playlistPickUrl('', tab), null);
});

test('gate r1: a 202 "playlist waiting" reply is a message, not a failure; Audio / Video are off on a playlist page', async () => {
  const { interpretDownloadResponse, isPlaylistOnly } = await mod();
  assert.deepEqual(interpretDownloadResponse(202, { accepted: false, playlist: true, waiting: true, message: 'Playlist found: open FileTube to choose' }),
    { ok: true, status: 202, waiting: true, message: 'Playlist found: open FileTube to choose' });
  assert.equal(interpretDownloadResponse(202, { accepted: true, jobId: 'j' }).jobId, 'j');
  assert.equal(isPlaylistOnly('https://www.youtube.com/playlist?list=PLUtyNbQXMTLg'), true);
  assert.equal(isPlaylistOnly('https://www.youtube.com/watch?list=PLUtyNbQXMTLg'), true);
  assert.equal(isPlaylistOnly('https://www.youtube.com/watch?v=U3P8pUboZ5g&list=PLUtyNbQXMTLg'), false, 'a video: Audio / Video send it alone');
  assert.equal(isPlaylistOnly('https://youtu.be/U3P8pUboZ5g?list=PLUtyNbQXMTLg'), false);
  assert.equal(isPlaylistOnly('https://example.com/?list=1'), false);
});

// v1.395.0 Pages: Save to Pages - the save-only token as a Bearer, the rendered HTML when it fits.
test('buildSavePageRequest: not configured without a Pages token; only http(s) tabs', async () => {
  const { buildSavePageRequest } = await mod();
  const r = buildSavePageRequest({ instanceUrl: 'https://ft.tld', pagesToken: '', url: 'https://x.tld/a', html: '<p/>' });
  assert.equal(r.ok, false);
  assert.equal(r.configured, false);
  assert.equal(buildSavePageRequest({ instanceUrl: 'https://ft.tld', pagesToken: 'ftd_x', url: 'chrome://extensions', html: null }).ok, false);
  assert.equal(buildSavePageRequest({ instanceUrl: 'https://ft.tld', pagesToken: 'ftd_x', url: 'not a url', html: null }).ok, false);
});

test('buildSavePageRequest: POST /api/pages with Authorization Bearer, { url, html, source }', async () => {
  const { buildSavePageRequest, PAGES_PATH } = await mod();
  const r = buildSavePageRequest({ instanceUrl: 'https://ft.tld/', pagesToken: 'ftd_tok', url: 'https://x.tld/a', html: '<html><body>Hi</body></html>' });
  assert.equal(r.ok, true);
  assert.equal(r.sentHtml, true);
  assert.equal(r.request.endpoint, `https://ft.tld${PAGES_PATH}`);
  assert.equal(r.request.init.method, 'POST');
  assert.equal(r.request.init.headers.Authorization, 'Bearer ftd_tok');
  assert.ok(!('X-FileTube-Token' in r.request.init.headers), 'never the shared API token');
  assert.deepEqual(JSON.parse(r.request.init.body), { url: 'https://x.tld/a', source: 'extension', html: '<html><body>Hi</body></html>' });
});

test('buildSavePageRequest: a page larger than the cap (or none) is sent as its URL alone', async () => {
  const { buildSavePageRequest, PAGE_HTML_MAX_BYTES } = await mod();
  const big = buildSavePageRequest({ instanceUrl: 'https://ft.tld', pagesToken: 't', url: 'https://x.tld/a', html: 'x'.repeat(PAGE_HTML_MAX_BYTES + 1) });
  const cjk = buildSavePageRequest({ instanceUrl: 'https://ft.tld', pagesToken: 't', url: 'https://x.tld/a', html: '\u6f22'.repeat(3 * 1024 * 1024) });
  assert.equal(cjk.sentHtml, false, '3 M CJK characters are 9 MB: over the byte cap though under it in characters');
  assert.equal(big.sentHtml, false);
  assert.deepEqual(JSON.parse(big.request.init.body), { url: 'https://x.tld/a', source: 'extension' });
  const none = buildSavePageRequest({ instanceUrl: 'https://ft.tld', pagesToken: 't', url: 'https://x.tld/a', html: null });
  assert.equal(none.sentHtml, false);
});

test('interpretSavePageResponse: saved, already saved, a refused token, the server message verbatim', async () => {
  const { interpretSavePageResponse } = await mod();
  assert.deepEqual(interpretSavePageResponse(200, { item: { title: 'T' }, duplicate: false, message: 'Saved to Pages' }), { ok: true, duplicate: false, message: 'Saved to Pages', title: 'T' });
  assert.equal(interpretSavePageResponse(200, { item: { title: 'T' }, duplicate: true, message: 'Already in Pages' }).message, 'Already in Pages');
  assert.deepEqual(interpretSavePageResponse(200, { duplicate: true, message: 'Already in Pages' }), { ok: true, duplicate: true, message: 'Already in Pages', title: '' }, 'the save-only token gets no item back');
  assert.match(interpretSavePageResponse(401, { error: 'device token revoked' }).error, /revoked/);
  assert.match(interpretSavePageResponse(401, null).error, /Pages token/);
  assert.equal(interpretSavePageResponse(502, { error: 'Could not fetch the page: timeout' }).error, 'Could not fetch the page: timeout');
});
