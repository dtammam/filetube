'use strict';

// [UNIT] v1.365.0 W3 (plan 2026-10-05-small-phones-pocket-downloads-vr): Settings > Troubleshooting > Download
// trace. A plain link with `download` to the admin-only route (no fetch before a share: iOS keeps the gesture),
// hidden by default and revealed ONLY by the Downloads box's own probe (an admin with the downloader on): both
// axes, through the REAL loadEngineSection on the real setup.html.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SETUP_HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');

test('setup.html: the Download trace link sits in Troubleshooting, a plain <a download> to the route, hidden by default, with its help line', () => {
  const doc = new JSDOM(SETUP_HTML).window.document;
  const group = doc.getElementById('download-trace-group');
  const link = doc.getElementById('download-trace-link');
  assert.ok(group && link);
  assert.strictEqual(group.hidden, true);
  assert.strictEqual(group.closest('details').getAttribute('data-collapse-key'), 'troubleshooting');
  assert.strictEqual(link.tagName, 'A');
  assert.strictEqual(link.getAttribute('href'), '/api/ytdlp/oneshot-trace.txt');
  assert.ok(link.hasAttribute('download'));
  assert.strictEqual(link.textContent.trim(), 'Download trace');
  assert.strictEqual(group.querySelector('.setup-note').textContent, 'If a download looks stuck, tap this before restarting FileTube and send the file.');
});

async function runEngineProbe(status) {
  const dom = new JSDOM(SETUP_HTML.replace(/<script[\s\S]*?<\/script>/g, ''), { url: 'http://localhost/setup.html' });
  const saved = { doc: global.document, win: global.window, fetch: global.fetch };
  global.window = dom.window;
  global.document = dom.window.document;
  global.fetch = async (url) => {
    if (url === '/api/ytdlp/engine') return { ok: status === 200, status, json: async () => ({ channel: 'bundled', versions: {}, autoUpdate: false }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  delete require.cache[require.resolve('../../public/js/setup.js')];
  const setup = require('../../public/js/setup.js');
  try {
    try { await setup.loadEngineSection(new AbortController().signal); } catch (_) { /* rendering details out of scope */ }
    return dom.window.document.getElementById('download-trace-group').hidden;
  } finally {
    global.document = saved.doc; global.window = saved.win; global.fetch = saved.fetch;
    if (saved.doc === undefined) delete global.document;
    if (saved.win === undefined) delete global.window;
    if (saved.fetch === undefined) delete global.fetch;
    dom.window.close();
  }
}

test('the Downloads probe reveals the link for an admin with the downloader on (200), and never otherwise (403, 404)', async () => {
  assert.strictEqual(await runEngineProbe(200), false, 'revealed');
  assert.strictEqual(await runEngineProbe(403), true, 'a member: hidden');
  assert.strictEqual(await runEngineProbe(404), true, 'the downloader off: hidden');
});
