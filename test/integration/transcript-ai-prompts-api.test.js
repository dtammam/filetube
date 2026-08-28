'use strict';

// [INTEGRATION] v1.201 (Dean): `settings.transcriptAiPrompts` - the named
// preambles the watch page's "Share with AI" action sends in front of a
// transcript. Instance-wide: admin writes via POST /api/settings (the
// existing write-RBAC), every signed-in user reads via GET /api/settings.
// Binds the validation SHAPE (400 + nothing persists on any bad item), the
// normalization (trim, server-assigned unique ids, ids kept across edits),
// the default, and the empty-list case.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-transcript-ai-prompts-'));

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { app, saveDatabase, __mintTestSession } = require('../../server');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;
before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});
after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

function baseDb(settings) {
  return { folders: [], folderSettings: {}, progress: {}, metadata: {}, settings: { scanIntervalMinutes: 30, pruneMissing: true, cacheMaxBytes: null, cacheMaxAgeDays: 30, ...(settings || {}) } };
}
beforeEach(() => saveDatabase(baseDb()));

const DEFAULT_PROMPT = { id: 'summarize', name: 'Summarize', text: "I'm sharing a video transcript below. Summarize the narrative and key points, then note anything notable or questionable." };
const post = (body) => fetch(`${base}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const getPrompts = async () => (await (await fetch(`${base}/api/settings`)).json()).transcriptAiPrompts;

test('GET /api/settings: a db without the key (fresh OR pre-v1.201) serves the ONE default prompt', async () => {
  assert.deepEqual(await getPrompts(), [DEFAULT_PROMPT]);
});

test('POST /api/settings accepts a prompt list, trims, assigns ids from names, and round-trips', async () => {
  const res = await post({ transcriptAiPrompts: [{ name: '  Summarize ', text: ' Sum it up. ' }, { name: 'Deep analysis!', text: 'Analyze.' }] });
  assert.equal(res.status, 200);
  assert.deepEqual(await getPrompts(), [
    { id: 'summarize', name: 'Summarize', text: 'Sum it up.' },
    { id: 'deep-analysis', name: 'Deep analysis!', text: 'Analyze.' },
  ]);
});

test('POST /api/settings keeps a known id when its name changes; slug collisions get a numeric suffix; names are unique case-insensitively', async () => {
  await post({ transcriptAiPrompts: [{ name: 'Summarize', text: 'a' }, { name: 'Analyze', text: 'b' }] });
  let res = await post({ transcriptAiPrompts: [{ id: 'summarize', name: 'Quick summary', text: 'a' }, { id: 'analyze', name: 'Analyze', text: 'b' }] });
  assert.equal(res.status, 200);
  assert.deepEqual((await getPrompts()).map((p) => p.id), ['summarize', 'analyze']);
  res = await post({ transcriptAiPrompts: [{ name: 'Sum up', text: 'x' }, { name: 'SUM UP', text: 'y' }] });
  assert.equal(res.status, 400, 'case-insensitive duplicate name');
  res = await post({ transcriptAiPrompts: [{ name: 'Sum up', text: 'x' }, { name: 'Sum up!', text: 'y' }] });
  assert.equal(res.status, 200);
  assert.deepEqual((await getPrompts()).map((p) => p.id), ['sum-up', 'sum-up-2']);
});

test('POST /api/settings: an EMPTY list is valid (it hides the AI action)', async () => {
  const res = await post({ transcriptAiPrompts: [] });
  assert.equal(res.status, 200);
  assert.deepEqual(await getPrompts(), []);
});

test('POST /api/settings rejects every bad shape with 400 and persists NOTHING - including a valid sibling key in the same request', async () => {
  const before = await getPrompts();
  const bad = [
    { transcriptAiPrompts: 'not an array' },
    { transcriptAiPrompts: { name: 'a', text: 'b' } },
    { transcriptAiPrompts: [null] },
    { transcriptAiPrompts: [['a']] },
    { transcriptAiPrompts: [{ name: '', text: 'x' }] },
    { transcriptAiPrompts: [{ name: 'a', text: '   ' }] },
    { transcriptAiPrompts: [{ name: 'x'.repeat(61), text: 'x' }] },
    { transcriptAiPrompts: [{ name: 'a', text: 'x'.repeat(4001) }] },
    { transcriptAiPrompts: [{ name: 'Same', text: 'a' }, { name: 'same', text: 'b' }] },
    { transcriptAiPrompts: Array.from({ length: 13 }, (_, i) => ({ name: `p${i}`, text: 't' })) },
    { transcriptAiPrompts: [{ name: 42, text: 'x' }] },
  ];
  for (const body of bad) {
    const res = await post({ ...body, pruneMissing: false });
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
    assert.match((await res.json()).error, /transcriptAiPrompts/);
  }
  assert.deepEqual(await getPrompts(), before, 'the list is untouched');
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).pruneMissing, true, 'the valid sibling key in a rejected request did NOT persist');
});

test('POST /api/settings: a non-admin member gets 403 on the prompts (existing write-RBAC), but GET still shows them', async () => {
  const member = __mintTestSession({ role: 'member', username: 'reader' });
  const res = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: member.cookie }, body: JSON.stringify({ transcriptAiPrompts: [] }) });
  assert.equal(res.status, 403);
  const seen = await (await fetch(`${base}/api/settings`, { headers: { Cookie: member.cookie } })).json();
  assert.deepEqual(seen.transcriptAiPrompts, [DEFAULT_PROMPT]);
});

// GATE (adversarial W2): the id rules were present but UNBOUND.
test('POST /api/settings: a KNOWN id claimed twice in one request is kept once (the second re-mints); an UNKNOWN client id is never trusted', async () => {
  await post({ transcriptAiPrompts: [{ name: 'Summarize', text: 'a' }] });
  let res = await post({ transcriptAiPrompts: [{ id: 'summarize', name: 'A', text: 'x' }, { id: 'summarize', name: 'B', text: 'y' }] });
  assert.equal(res.status, 200);
  assert.deepEqual((await getPrompts()).map((p) => p.id), ['summarize', 'b']);
  res = await post({ transcriptAiPrompts: [{ id: '<script>evil</script>', name: 'A', text: 'x' }, { id: 'not-in-the-list', name: 'B', text: 'y' }] });
  assert.equal(res.status, 200);
  assert.deepEqual((await getPrompts()).map((p) => p.id), ['a', 'b'], 'ids are re-minted from the names - a client id is honoured only when it already exists');
});
