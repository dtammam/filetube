'use strict';

// [INTEGRATION] v1.15.0 item 3 -- the header one-off download button + modal
// are injected at RUNTIME by public/js/common.js (gated on a genuine 2xx
// from `GET /api/subscriptions/health`), never server-rendered into any page
// -- so the served HTML for index.html/watch.html/setup.html carries no
// button/modal artifact regardless of whether the optional yt-dlp module is
// enabled or disabled (AC3.3/ACX.1: "the served header HTML is byte-identical
// to the pre-v1.15 output"). This mirrors the existing pattern in
// test/integration/ytdlp-ui-routes.test.js (the /subscriptions page's own
// disabled-path assertions) and reuses its bare-express + `registerRoutes`
// bootstrap so both the disabled and enabled configs are provable here
// without a real yt-dlp binary or network call.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');

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

function enabledConfig(tmpDir) {
  return ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: '0',
    FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir,
  });
}

const PAGES = ['/', '/watch.html', '/setup.html'];

for (const page of PAGES) {
  test(`AC3.3: GET ${page} never contains the one-off button/modal artifact when the module is DISABLED`, async () => {
    const { base, close } = await bootApp({ config: disabledConfig });
    try {
      const res = await fetch(`${base}${page}`);
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.doesNotMatch(body, /ytdlp-oneoff/, `${page} must not server-render the one-off button/modal id`);
      assert.doesNotMatch(body, /oneoff-modal/, `${page} must not server-render the one-off modal markup`);
    } finally {
      await close();
    }
  });

  test(`AC3.3: GET ${page} ALSO never server-renders the artifact when the module is ENABLED (injection is runtime-only)`, async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-oneoff-'));
    const { base, close } = await bootApp({ config: enabledConfig(tmpDir) });
    try {
      const res = await fetch(`${base}${page}`);
      assert.equal(res.status, 200);
      const body = await res.text();
      // Structural guarantee either way: the button/modal only ever exist
      // after common.js's client-side health probe resolves in a real
      // browser -- the served HTML itself is identical regardless of state.
      assert.doesNotMatch(body, /ytdlp-oneoff/, `${page} must not server-render the one-off button/modal id even when enabled`);
      assert.doesNotMatch(body, /oneoff-modal/, `${page} must not server-render the one-off modal markup even when enabled`);
    } finally {
      await close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
}

test('AC3.4: the capability probe 404s when disabled, so the client-side injection never fires (fail closed)', async () => {
  const { base, close } = await bootApp({ config: disabledConfig });
  try {
    const res = await fetch(`${base}/api/subscriptions/health`);
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});

test('the capability probe 200s when enabled, which is the ONLY condition under which the client injects the button (see test/unit/ytdlp-oneoff-modal.test.js\'s shouldInjectOneOffButton coverage)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-oneoff-'));
  const { base, close } = await bootApp({ config: enabledConfig(tmpDir) });
  try {
    const res = await fetch(`${base}/api/subscriptions/health`);
    assert.equal(res.status, 200);
  } finally {
    await close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('GET /js/common.js is served unconditionally (public/, not the gated lib/ytdlp path) and carries the gated injection logic + no unrelated regression', async () => {
  const { base, close } = await bootApp({ config: disabledConfig });
  try {
    const res = await fetch(`${base}/js/common.js`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /injectOneOffDownloadButtonIfEnabled/, 'the gated injection function must ship in the common bundle');
    assert.match(body, /shouldInjectOneOffButton/, 'the pure gating decision must ship in the common bundle');
    assert.match(body, /\/api\/subscriptions\/health/, 'the injection must probe the same capability endpoint as the nav-link injection');
  } finally {
    await close();
  }
});

test('the one-off download endpoint the modal calls is 404 when disabled, and works end-to-end when enabled', async () => {
  const disabled = await bootApp({ config: disabledConfig });
  try {
    const res = await fetch(`${disabled.base}/api/ytdlp/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ', format: 'video', quality: 'best' }),
    });
    assert.equal(res.status, 404);
  } finally {
    await disabled.close();
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-oneoff-'));
  const run = require('../../lib/ytdlp/run');
  const originalRunDownload = run.runDownload;
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });
  const enabled = await bootApp({ config: enabledConfig(tmpDir) });
  try {
    // Exactly the body shape buildOneOffDownloadBody composes.
    const res = await fetch(`${enabled.base}/api/ytdlp/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ', format: 'video', quality: 'best', filetype: 'mp4' }),
    });
    assert.equal(res.status, 202);
    const data = await res.json();
    assert.equal(data.accepted, true);
    assert.equal(typeof data.jobId, 'string');

    // The modal's poll target -- the job must show up in the status snapshot.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const snapshot = await (await fetch(`${enabled.base}/api/subscriptions/status`)).json();
    assert.ok(snapshot.oneShots[data.jobId]);
  } finally {
    run.runDownload = originalRunDownload;
    await enabled.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
