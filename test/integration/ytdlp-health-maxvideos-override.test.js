'use strict';

// [INTEGRATION] two-reviewer-gate fix (post-release), AC26 follow-up:
// `GET /api/subscriptions/health`'s `defaultMaxVideos` field must reflect the
// operator's ENV-RESOLVED effective default (`config.maxVideos`), not the bare
// `DEFAULT_MAX_VIDEOS` constant -- otherwise an operator who sets
// `FILETUBE_YTDLP_MAX_VIDEOS` has that override silently ignored by every
// watch-page Subscribe modal (which always pre-fills and then SENDS this
// value), while the plain `/subscriptions` add-form path (which falls back to
// `config.maxVideos` server-side when its own field is left blank) DOES honor
// it -- a two-entry-point inconsistency this test locks against regressing.
//
// Uses the bare-express + `registerRoutes(app, deps, config)` pattern (see
// test/integration/ytdlp-status-endpoint.test.js for precedent) so each case
// gets its own explicit config object, in-process, with no env-var/process
// isolation needed.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');

let tmpDir;
let server;

afterEach(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

async function startTestApp(config) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-health-'));
  const app = express();
  ytdlp.registerRoutes(app, {}, config);
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('GET /api/subscriptions/health defaultMaxVideos === 2 (DEFAULT_MAX_VIDEOS) when no FILETUBE_YTDLP_MAX_VIDEOS override is set', async () => {
  const config = ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: '0',
  });
  const base = await startTestApp(config);
  const res = await fetch(`${base}/api/subscriptions/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { enabled: true, defaultMaxVideos: 2 });
});

test('GET /api/subscriptions/health defaultMaxVideos reflects an operator FILETUBE_YTDLP_MAX_VIDEOS override, matching the add-form\'s effective default', async () => {
  const config = ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: '0',
    FILETUBE_YTDLP_MAX_VIDEOS: '10',
  });
  const base = await startTestApp(config);
  const res = await fetch(`${base}/api/subscriptions/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { enabled: true, defaultMaxVideos: 10 });
});

test('GET /api/subscriptions/health defaultMaxVideos reflects 0 ("unlimited") when the operator has explicitly configured that -- the operator\'s own configured default, per 0-means-unlimited semantics', async () => {
  const config = ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: '0',
    FILETUBE_YTDLP_MAX_VIDEOS: '0',
  });
  const base = await startTestApp(config);
  const res = await fetch(`${base}/api/subscriptions/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { enabled: true, defaultMaxVideos: 0 });
});
