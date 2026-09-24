'use strict';

// [UNIT] v1.319 Chapter Snap (gate r1 qa S8): the Setup "Chapter snap lead-in" select,
// through the REAL setup.js in jsdom - BOTH directions: the load populates it from
// /api/settings (a stored value that is not one of the offered options gets its own
// option rather than silently showing the default), and a change POSTs the number.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SETUP_HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');

function boot() {
  delete global.document; delete global.window; delete global.fetch;
  // The select exactly as setup.html ships it (lifted, not re-typed).
  const m = SETUP_HTML.match(/<select id="chapter-snap-leadin-select"[\s\S]*?<\/select>/);
  assert.ok(m, 'setup.html ships the lead-in select');
  const dom = new JSDOM(`<!DOCTYPE html><body>${m[0]}<small id="chapter-snap-leadin-error"></small></body>`, { url: 'http://localhost/' });
  global.window = dom.window;
  global.document = dom.window.document;
  delete require.cache[require.resolve('../../public/js/setup.js')];
  return { mod: require('../../public/js/setup.js'), dom };
}

test('load: the select shows the stored lead-in; an off-list stored value gets its own option', async () => {
  const { mod, dom } = boot();
  const sel = dom.window.document.getElementById('chapter-snap-leadin-select');
  assert.strictEqual(sel.value, '0.25', 'precondition: the static default');
  global.fetch = async () => ({ json: async () => ({ chapterSnapLeadInSec: 1.5 }) });
  await mod.loadAutomationSettings();
  assert.strictEqual(sel.value, '1.5', 'the stored value is shown');
  global.fetch = async () => ({ json: async () => ({ chapterSnapLeadInSec: 0.33 }) });
  await mod.loadAutomationSettings();
  assert.strictEqual(sel.value, '0.33', 'an off-list value is shown, not replaced by a default');
  dom.window.close();
});

test('change: picking a lead-in POSTs /api/settings with the NUMBER', async () => {
  const { mod, dom } = boot();
  const posts = [];
  global.fetch = async (url, init) => { posts.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({}) }; };
  mod.wireChapterSnapLeadIn();
  const sel = dom.window.document.getElementById('chapter-snap-leadin-select');
  sel.value = '0.75';
  sel.dispatchEvent(new dom.window.Event('change'));
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(posts, [{ url: '/api/settings', body: { chapterSnapLeadInSec: 0.75 } }]);
  dom.window.close();
});
