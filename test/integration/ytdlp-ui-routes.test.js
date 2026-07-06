'use strict';

// [INTEGRATION] T5 -- the /subscriptions page route + its client controller
// route (both registered inside `registerRoutes`'s `isEnabled` gate,
// lib/ytdlp/index.js), and the full UI-facing endpoint flow they bind to.
//
// AC3 (disabled ⇒ page + client asset + nav-probe all structurally ABSENT,
// not CSS-hidden -- D4) and AC32 (enabled ⇒ the routes serve real content and
// the endpoints the client calls work end-to-end) are both proven here.
//
// Uses the SAME bare-express + `registerRoutes(app, deps, config)` pattern
// already established by test/integration/ytdlp-disabled-noop.test.js's
// on/off toggle test and ytdlp-repull-endpoints.test.js, rather than
// requiring the real server.js (which fixes its config at require time) --
// this lets one file prove both the disabled and enabled configs with no
// env-var/module-reload tricks. `run.runList`/`run.runDownload` are mocked
// for the re-pull assertions -- no real yt-dlp binary or network is ever
// touched (mirrors ytdlp-repull-endpoints.test.js's convention).

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');

const originalRunList = run.runList;
const originalRunDownload = run.runDownload;

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  ytdlp.armYtdlpTimer(ytdlp.parseYtdlpConfig({})); // clear any armed timer between tests
});

function makeFakeDeps() {
  const db = {};
  return {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(String(input)).digest('hex'),
  };
}

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

function staticMiddleware() {
  // Mirrors server.js's real express.static mount (server.js:1238) exactly,
  // including the no-cache header -- used to prove express.static alone
  // cannot serve the gated page/client script regardless of enable state.
  return express.static(PUBLIC_DIR, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  });
}

async function bootApp({ config, deps, withRegisterRoutes = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use(staticMiddleware());
  if (withRegisterRoutes) {
    ytdlp.registerRoutes(app, deps || makeFakeDeps(), config);
  }
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const disabledConfig = ytdlp.parseYtdlpConfig({});

function enabledConfig(tmpDir, overrides = {}) {
  return ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: '0',
    FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir,
    ...overrides,
  });
}

// ---- AC3: disabled ⇒ page route + client script route + nav-probe absent --

test('AC3: GET /subscriptions 404s when the module is disabled', async () => {
  const { base, close } = await bootApp({ config: disabledConfig });
  try {
    const res = await fetch(`${base}/subscriptions`);
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});

test('AC3: GET /js/subscriptions.js 404s when the module is disabled', async () => {
  const { base, close } = await bootApp({ config: disabledConfig });
  try {
    const res = await fetch(`${base}/js/subscriptions.js`);
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});

test('AC3: the nav-injection capability probe 404s when disabled, so common.js\'s shouldInjectSubscriptionsNav injects nothing', async () => {
  const { base, close } = await bootApp({ config: disabledConfig });
  try {
    const res = await fetch(`${base}/api/subscriptions/health`);
    assert.equal(res.status, 404);
    // The client-side decision this drives (public/js/common.js's
    // shouldInjectSubscriptionsNav) is unit-tested directly in
    // test/unit/ytdlp-nav-injection.test.js -- a 404 there resolves to
    // `false`, i.e. no link is ever added to the DOM.
  } finally {
    await close();
  }
});

test('AC3: express.static ALONE (no registerRoutes call at all) can never serve the page or the client script', async () => {
  const { base, close } = await bootApp({ withRegisterRoutes: false });
  try {
    const page = await fetch(`${base}/subscriptions`);
    assert.equal(page.status, 404);
    const script = await fetch(`${base}/js/subscriptions.js`);
    assert.equal(script.status, 404);
  } finally {
    await close();
  }
});

test('AC3: the page + client source files are not present under public/ (structural guarantee), and DO exist where the gated routes serve them from', () => {
  assert.equal(fs.existsSync(path.join(PUBLIC_DIR, 'subscriptions.html')), false);
  assert.equal(fs.existsSync(path.join(PUBLIC_DIR, 'js', 'subscriptions.js')), false);
  assert.equal(
    fs.existsSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html')),
    true
  );
  assert.equal(
    fs.existsSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'client', 'subscriptions.js')),
    true
  );
});

// ---- AC32: enabled ⇒ the page + client JS serve, wired to the real endpoints --

test('AC32: GET /subscriptions serves the page HTML when enabled, referencing the gated client script + its controls', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-ui-'));
  const { base, close } = await bootApp({ config: enabledConfig(tmpDir) });
  try {
    const res = await fetch(`${base}/subscriptions`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /html/);
    const body = await res.text();
    assert.match(body, /\/js\/subscriptions\.js/, 'page must load the gated client controller');
    assert.match(body, /sub-list-container/, 'page must contain the list container the client renders into');
    assert.match(body, /sub-add-url/, 'page must contain the add-subscription form');
    assert.match(body, /sub-add-format/, 'page must contain the audio/video format control');
    assert.match(body, /sub-members-only-check/, 'page must contain the members-only toggle');
    assert.match(body, /sub-repull-all-btn/, 'page must contain the re-pull-all control');
  } finally {
    await close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('AC32: GET /js/subscriptions.js serves the client controller as javascript when enabled', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-ui-'));
  const { base, close } = await bootApp({ config: enabledConfig(tmpDir) });
  try {
    const res = await fetch(`${base}/js/subscriptions.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /javascript/);
    const body = await res.text();
    assert.match(body, /createSubscriptionRow/);
    assert.match(body, /textContent/);
    assert.doesNotMatch(body.replace(/\/\/.*$/gm, ''), /\.innerHTML\s*=/, 'no live code path may assign innerHTML');
  } finally {
    await close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('AC32: the full UI flow works end-to-end against the real routes -- list/add/members-toggle/re-pull-one/re-pull-all/delete', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-ui-'));
  const deps = makeFakeDeps();

  run.runList = async () => ({ ok: true, stdout: '', stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const { base, close } = await bootApp({ config: enabledConfig(tmpDir), deps });
  try {
    // list starts empty (the client's initial loadSubscriptions() call)
    let list = await (await fetch(`${base}/api/subscriptions`)).json();
    assert.deepEqual(list, []);

    // add (the client's add form posts exactly this shape)
    const addRes = await fetch(`${base}/api/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@somechannel', format: 'audio', quality: 'best' }),
    });
    assert.equal(addRes.status, 201);
    const added = await addRes.json();
    assert.equal(added.format, 'audio');
    assert.equal(added.quality, 'best');

    list = await (await fetch(`${base}/api/subscriptions`)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, added.id);

    // reject a malformed add (the client surfaces `data.error` as textContent)
    const badAddRes = await fetch(`${base}/api/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelUrl: 'not a url', format: 'video' }),
    });
    assert.equal(badAddRes.status, 400);
    assert.ok((await badAddRes.json()).error);

    // members-only settings toggle (the client's checkbox: default false -> true)
    let settings = await (await fetch(`${base}/api/subscriptions/settings`)).json();
    assert.equal(settings.allowMembersOnly, false);
    const setRes = await fetch(`${base}/api/subscriptions/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowMembersOnly: true }),
    });
    assert.equal(setRes.status, 200);
    settings = await (await fetch(`${base}/api/subscriptions/settings`)).json();
    assert.equal(settings.allowMembersOnly, true);

    // re-pull-one (the client's per-row button)
    const repullOneRes = await fetch(`${base}/api/subscriptions/${added.id}/repull`, { method: 'POST' });
    assert.equal(repullOneRes.status, 202);

    // re-pull-all (the client's global button)
    const repullAllRes = await fetch(`${base}/api/subscriptions/repull`, { method: 'POST' });
    assert.equal(repullAllRes.status, 202);

    // give the fire-and-forget mocked polls a moment to run + persist status
    await new Promise((resolve) => setTimeout(resolve, 50));
    list = await (await fetch(`${base}/api/subscriptions`)).json();
    assert.equal(list[0].lastStatus, 'ok: no new videos');

    // delete (the client's per-row delete button, after window.confirm)
    const delRes = await fetch(`${base}/api/subscriptions/${added.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);

    list = await (await fetch(`${base}/api/subscriptions`)).json();
    assert.deepEqual(list, []);

    // 404 for the now-deleted subscription's re-pull-one (client surfaces this too)
    const repullDeletedRes = await fetch(`${base}/api/subscriptions/${added.id}/repull`, { method: 'POST' });
    assert.equal(repullDeletedRes.status, 404);
  } finally {
    await close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
