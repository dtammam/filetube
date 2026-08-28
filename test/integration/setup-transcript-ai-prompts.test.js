'use strict';

// [INTEGRATION] v1.201 (Dean): the Settings-page "Share with AI" prompt
// editor (setup.js renderTranscriptAiPromptsEditor). Boots the REAL
// setup.html + scripts under jsdom (the push-settings harness posture: only
// the fetches this editor needs resolve; everything else hangs) and binds:
// rows render from GET /api/settings; an edit POSTs the WHOLE list
// (debounced) as `{ transcriptAiPrompts: [...] }`; Remove POSTs without the
// row; Add appends an unsaved blank row; a 400 lands in the field error and
// keeps the typed rows.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, requestInterceptor } = require('jsdom');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
function contentTypeFor(p) { return p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'application/octet-stream'; }

const TWO = [{ id: 'summarize', name: 'Summarize', text: 'Sum it up.' }, { id: 'analyze', name: 'Analyze', text: 'Analyze it.' }];

// `holdPosts`: when true every POST response is parked in `released` until the
// test resolves it (for the in-flight-response race).
function loadSetup({ prompts, postStatus, holdPosts }) {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'setup.html'), 'utf8');
  const posts = [];
  const released = [];
  return new Promise((resolve) => {
    const dom = new JSDOM(html, {
      url: 'https://filetube.example/setup.html',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      resources: { interceptors: [requestInterceptor((request) => {
        const p = new URL(request.url).pathname;
        const filePath = path.join(PUBLIC_DIR, p);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return new Response(fs.readFileSync(filePath, 'utf8'), { status: 200, headers: { 'Content-Type': contentTypeFor(filePath) } });
        return new Response('', { status: 404 });
      })] },
      beforeParse(window) {
        window.matchMedia = (q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
        let current = prompts.slice();
        window.fetch = (input, init) => {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          const method = (init && init.method) || 'GET';
          if (url === '/api/settings' && method === 'GET') {
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ scanIntervalMinutes: 30, pruneMissing: true, cacheMaxAgeDays: 30, trashRetentionDays: 30, defaultView: '', autoplayNext: false, backgroundAudioForVideo: false, defaultSort: 'release-date', mobileCustomPlayer: false, preExtractAudio: false, bgAudioSyncPosition: false, relocateHydratedImports: true, notificationsEnabled: true, transcriptAiPrompts: current, effectiveCacheMaxBytes: 1 }) });
          }
          if (url === '/api/settings' && method === 'POST') {
            const body = JSON.parse(init.body);
            posts.push(body);
            if (postStatus === 400) return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'transcriptAiPrompts[0].name must be 1-60 characters' }) });
            // Echo the server's normalization: ids from names.
            // The REAL server rule for a blank row: 400 on the whole list.
            // Per-request SNAPSHOT (gate: a lazily-read `current` made every
            // held answer carry the latest list, so a stale answer could never
            // clobber and the sequence counter was unbound).
            const bad = body.transcriptAiPrompts.findIndex((p) => !p.name || !p.name.trim() || !p.text || !p.text.trim());
            if (bad !== -1) return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: `transcriptAiPrompts[${bad}].name must be 1-60 characters` }) });
            current = body.transcriptAiPrompts.map((p) => ({ id: p.id || p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: p.name.trim(), text: p.text.trim() }));
            const snapshot = current.map((p) => ({ ...p }));
            const answer = { ok: true, status: 200, json: () => Promise.resolve({ transcriptAiPrompts: snapshot }) };
            if (holdPosts) return new Promise((resolve) => released.push(() => resolve(answer)));
            return Promise.resolve(answer);
          }
          if (url.indexOf('/api/auth/me') !== -1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: { username: 'dean', role: 'admin' }, settings: {} }) });
          return new Promise(() => {}); // everything else hangs
        };
      },
    });
    dom.window.addEventListener('load', () => setTimeout(() => resolve({ dom, posts, released }), 60));
    setTimeout(() => resolve({ dom, posts, released }), 5000);
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = (d) => Array.from(d.querySelectorAll('.transcript-ai-prompt-row'));

test('setup: the prompt editor renders one row per prompt from GET /api/settings (name input + textarea + Remove)', async () => {
  const { dom } = await loadSetup({ prompts: TWO });
  try {
    await wait(100);
    const d = dom.window.document;
    const r = rows(d);
    assert.strictEqual(r.length, 2);
    assert.strictEqual(r[0].querySelector('.transcript-ai-prompt-name').value, 'Summarize');
    assert.strictEqual(r[0].querySelector('.transcript-ai-prompt-text').value, 'Sum it up.');
    assert.strictEqual(r[1].dataset.promptId, 'analyze');
    assert.ok(r[1].querySelector('button.btn').textContent === 'Remove');
  } finally { dom.window.close(); }
});

test('setup: editing a prompt POSTs the WHOLE list once (debounced), with ids kept and the new text', async () => {
  const { dom, posts } = await loadSetup({ prompts: TWO });
  try {
    await wait(100);
    const d = dom.window.document;
    const ta = rows(d)[1].querySelector('.transcript-ai-prompt-text');
    for (const v of ['Analyze it', 'Analyze it deeply', 'Analyze it deeply.']) {
      ta.value = v;
      ta.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      await wait(50);
    }
    assert.strictEqual(posts.length, 0, 'nothing POSTed inside the debounce window');
    await wait(600);
    assert.strictEqual(posts.length, 1, 'exactly one POST for three keystrokes');
    assert.deepStrictEqual(posts[0], { transcriptAiPrompts: [
      { id: 'summarize', name: 'Summarize', text: 'Sum it up.' },
      { id: 'analyze', name: 'Analyze', text: 'Analyze it deeply.' },
    ] });
  } finally { dom.window.close(); }
});

test('setup: Remove POSTs the list WITHOUT that row immediately; Add appends an unsaved blank row', async () => {
  const { dom, posts } = await loadSetup({ prompts: TWO });
  try {
    await wait(100);
    const d = dom.window.document;
    rows(d)[0].querySelector('button.btn').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(100);
    assert.strictEqual(posts.length, 1);
    assert.deepStrictEqual(posts[0].transcriptAiPrompts.map((p) => p.id), ['analyze']);
    assert.strictEqual(rows(d).length, 1);
    d.getElementById('transcript-ai-add-btn').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(600);
    assert.strictEqual(rows(d).length, 2, 'a blank row appeared');
    assert.strictEqual(rows(d)[1].querySelector('.transcript-ai-prompt-name').value, '');
    assert.strictEqual(posts.length, 1, 'a blank row is NOT saved until typed (the server would 400 it)');
  } finally { dom.window.close(); }
});

test('setup: a 400 from the server lands in the field error and the typed rows stay', async () => {
  const { dom, posts } = await loadSetup({ prompts: TWO, postStatus: 400 });
  try {
    await wait(100);
    const d = dom.window.document;
    const name = rows(d)[0].querySelector('.transcript-ai-prompt-name');
    name.value = '';
    name.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await wait(600);
    assert.strictEqual(posts.length, 1);
    assert.match(d.getElementById('transcript-ai-error').textContent, /name must be 1-60/);
    assert.strictEqual(rows(d).length, 2, 'rows not re-rendered away');
    assert.strictEqual(rows(d)[0].querySelector('.transcript-ai-prompt-name').value, '', 'the typed (empty) name stays for fixing');
  } finally { dom.window.close(); }
});

test('setup.html: the section is registered like its siblings (setup-box, collapse key, md icon + Advanced group) and uses NO reveal-toggle barrier', () => {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'setup.html'), 'utf8');
  assert.match(html, /<details class="setup-box sub-collapsible" data-collapse-key="transcript-ai" data-md-icon="copy" data-md-group="Advanced" open>/);
  const section = html.slice(html.indexOf('data-collapse-key="transcript-ai"'));
  const end = section.indexOf('</details>');
  assert.ok(!section.slice(0, end).includes('reveal-toggle'), 'the editor is fed by its own fetch, not the automation-settings barrier (the v1.96 rule)');
});

// ---- GATE fix round 1 (both seats): the blank Add row must never poison a save ----
function typeInto(dom, el, value) { el.value = value; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }

test('setup: Add -> type only a NAME: nothing is POSTed and no error shows until the row is whole; completing it saves it', async () => {
  const { dom, posts } = await loadSetup({ prompts: TWO });
  try {
    await wait(100);
    const d = dom.window.document;
    d.getElementById('transcript-ai-add-btn').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(50);
    typeInto(dom, rows(d)[2].querySelector('.transcript-ai-prompt-name'), 'Analyze');
    await wait(600);
    assert.strictEqual(posts.length, 0, 'a half-filled NEW row is not part of the list yet');
    assert.strictEqual(d.getElementById('transcript-ai-error').textContent, '', 'no red error while still authoring');
    typeInto(dom, rows(d)[2].querySelector('.transcript-ai-prompt-text'), 'Analyze this.');
    await wait(600);
    assert.strictEqual(posts.length, 1);
    assert.deepStrictEqual(posts[0].transcriptAiPrompts.map((p) => p.name), ['Summarize', 'Analyze', 'Analyze']);
  } finally { dom.window.close(); }
});

test('setup: with a blank Add row present, Remove of another row and an edit of an existing row both PERSIST (the blank row is left out of the POST)', async () => {
  const { dom, posts } = await loadSetup({ prompts: TWO });
  try {
    await wait(100);
    const d = dom.window.document;
    d.getElementById('transcript-ai-add-btn').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(50);
    typeInto(dom, rows(d)[1].querySelector('.transcript-ai-prompt-text'), 'Analyze it thoroughly.');
    await wait(600);
    assert.strictEqual(posts.length, 1);
    assert.deepStrictEqual(posts[0].transcriptAiPrompts.map((p) => p.text), ['Sum it up.', 'Analyze it thoroughly.'], 'the edit went, the blank row did not');
    rows(d)[0].querySelector('button.btn').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(100);
    assert.strictEqual(posts.length, 2);
    assert.deepStrictEqual(posts[1].transcriptAiPrompts.map((p) => p.id), ['analyze'], 'the remove persisted; no blank row');
    assert.strictEqual(d.getElementById('transcript-ai-error').textContent, '');
  } finally { dom.window.close(); }
});

test('setup: blanking an EXISTING prompt (it has an id) still reaches the server and shows its 400', async () => {
  const { dom, posts } = await loadSetup({ prompts: TWO });
  try {
    await wait(100);
    const d = dom.window.document;
    typeInto(dom, rows(d)[0].querySelector('.transcript-ai-prompt-name'), '');
    await wait(600);
    assert.strictEqual(posts.length, 1, 'a row WITH an id always goes');
    assert.match(d.getElementById('transcript-ai-error').textContent, /transcriptAiPrompts\[0\]/);
  } finally { dom.window.close(); }
});

test('setup: a save response never re-renders while a field is focused (the caret and typed text survive)', async () => {
  const { dom, posts } = await loadSetup({ prompts: TWO });
  try {
    await wait(100);
    const d = dom.window.document;
    const ta = rows(d)[1].querySelector('.transcript-ai-prompt-text');
    ta.focus();
    typeInto(dom, ta, 'Analyze it more');
    await wait(600);
    assert.strictEqual(posts.length, 1);
    assert.strictEqual(d.activeElement, ta, 'the SAME node is still focused - no re-render swapped it');
    assert.strictEqual(ta.value, 'Analyze it more');
  } finally { dom.window.close(); }
});

test('setup: an in-flight save response is IGNORED when a newer burst is pending or superseded it (no clobber)', async () => {
  const { dom, posts, released } = await loadSetup({ prompts: TWO, holdPosts: true });
  try {
    await wait(100);
    const d = dom.window.document;
    const a = rows(d)[0].querySelector('.transcript-ai-prompt-text');
    typeInto(dom, a, 'First edit.');
    await wait(600); // POST 1 fires and is HELD
    assert.strictEqual(posts.length, 1);
    const b = rows(d)[1].querySelector('.transcript-ai-prompt-text');
    b.focus();
    typeInto(dom, b, 'Second edit, still typing');
    b.blur();
    await wait(100); // POST 2's debounce is pending; nothing focused
    released[0](); // POST 1's answer lands NOW (carries the OLD row B)
    await wait(50);
    assert.strictEqual(rows(d)[1].querySelector('.transcript-ai-prompt-text').value, 'Second edit, still typing', 'the stale answer did not revert B');
    await wait(500); // POST 2 fires
    assert.strictEqual(posts.length, 2);
    assert.strictEqual(posts[1].transcriptAiPrompts[1].text, 'Second edit, still typing', 'POST 2 carries the NEW B, not a re-rendered old one');
    released[1]();
    await wait(50);
    assert.strictEqual(rows(d)[1].querySelector('.transcript-ai-prompt-text').value, 'Second edit, still typing');
  } finally { dom.window.close(); }
});

test('setup: a NEW row with a name and whitespace-only text is not posted (the filter trims); reverting a 400\'d edit to the saved value clears the error line', async () => {
  const { dom, posts } = await loadSetup({ prompts: TWO });
  try {
    await wait(100);
    const d = dom.window.document;
    d.getElementById('transcript-ai-add-btn').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    await wait(50);
    typeInto(dom, rows(d)[2].querySelector('.transcript-ai-prompt-name'), 'Analyze');
    typeInto(dom, rows(d)[2].querySelector('.transcript-ai-prompt-text'), '   \n ');
    await wait(600);
    assert.strictEqual(posts.length, 0, 'whitespace-only text is blank');
    const name = rows(d)[0].querySelector('.transcript-ai-prompt-name');
    typeInto(dom, name, '');
    await wait(600);
    assert.strictEqual(posts.length, 1);
    assert.match(d.getElementById('transcript-ai-error').textContent, /name must be/);
    typeInto(dom, name, 'Summarize');
    await wait(600);
    assert.strictEqual(posts.length, 1, 'back to the saved value: nothing to POST');
    assert.strictEqual(d.getElementById('transcript-ai-error').textContent, '', 'and the stale error is cleared');
  } finally { dom.window.close(); }
});

test('setup: two held POSTs released in REVERSE order - the newer list wins on screen (the sequence counter, now bound)', async () => {
  const { dom, posts, released } = await loadSetup({ prompts: TWO, holdPosts: true });
  try {
    await wait(100);
    const d = dom.window.document;
    typeInto(dom, rows(d)[0].querySelector('.transcript-ai-prompt-text'), 'One.');
    await wait(600);
    typeInto(dom, rows(d)[0].querySelector('.transcript-ai-prompt-text'), 'Two.');
    await wait(600);
    assert.strictEqual(posts.length, 2);
    released[1](); await wait(50); // the NEWER answer lands first
    released[0](); await wait(50); // then the STALE one - must be ignored
    assert.strictEqual(rows(d)[0].querySelector('.transcript-ai-prompt-text').value, 'Two.');
  } finally { dom.window.close(); }
});
