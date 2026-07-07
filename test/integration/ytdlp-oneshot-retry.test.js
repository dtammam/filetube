'use strict';

// [INTEGRATION] v1.21.0 FR-8 (T7) -- one-shot download RETRY (AC52/AC53's
// "real gap"): a failed one-shot's ephemeral activity `LiveEntry` now carries
// the additive `format`/`quality`/`filetype` fields (lib/ytdlp/index.js,
// alongside the pre-existing `url`/`label`) so the client can reconstruct
// the ORIGINAL request body and re-POST it to the SAME, unmodified
// `POST /api/ytdlp/download` route -- a normal new one-shot through the same
// `classifySingleVideo`/format-allowlist/`normalizeQuality`/`validateFiletype`
// validation path, never a bypass or a second/parallel validator. The
// reconstruction helper itself (`buildOneShotRetryBody`) lives in
// public/js/common.js (the chip's own retry wiring uses it) and is required
// directly here, unit-tested end-to-end against the real route rather than
// only against a hand-built fixture. Mirrors ytdlp-oneshot.test.js's
// same-process express-app bootstrap; no real yt-dlp binary or network.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');
const { buildOneShotRetryBody } = require('../../public/js/common.js');

const originalRunList = run.runList;
const originalRunDownload = run.runDownload;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-oneshot-retry-'));
});

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  ytdlp.resetPollRerunStateForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeFakeDeps(initialDb = {}) {
  let db = initialDb;
  return {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
  };
}

function enabledConfig(overrides = {}) {
  return ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: '0',
    FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir,
    ...overrides,
  });
}

async function startTestApp(deps, config) {
  const app = express();
  app.use(express.json());
  ytdlp.registerRoutes(app, deps, config);
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

const SINGLE_VIDEO_URL = 'https://youtu.be/dQw4w9WgXcQ';

function postJson(base, urlPath, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('a failed one-shot exposes format/quality/filetype on its status entry, sufficient to reconstruct a retry body', async () => {
  const deps = makeFakeDeps();
  run.runDownload = async () => ({ ok: false, code: 1, stdout: '', stderr: '', error: 'yt-dlp exited with code 1' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', {
      url: SINGLE_VIDEO_URL, format: 'audio', quality: '720p', filetype: 'mp3', folder: 'My Folder',
    });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const snap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    const entry = Object.values(snap.oneShots)[0];
    assert.equal(entry.state, 'error');

    const retryBody = buildOneShotRetryBody(entry);
    // `classifySingleVideo` canonicalizes the URL (e.g. a `youtu.be` short
    // link becomes its `www.youtube.com/watch?v=` form) -- the activity
    // entry's `url` is already that CANONICAL watch URL, not an echo of
    // whatever was originally POSTed, so the reconstructed retry body
    // carries the canonical form too.
    assert.deepEqual(retryBody, {
      url: entry.url,
      format: 'audio',
      quality: '720p',
      filetype: 'mp3',
      folder: 'My Folder',
    });
    assert.ok(retryBody.url.startsWith('https://www.youtube.com/watch?v='));
  } finally {
    await close();
  }
});

test('retry: re-POSTing the reconstructed body starts a NEW one-shot through the SAME validation path, with matching options', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  let attempt = 0;
  const capturedSubs = [];
  run.runDownload = async (sub) => {
    attempt += 1;
    capturedSubs.push(sub);
    // First attempt fails; a retry (second attempt) succeeds.
    if (attempt === 1) return { ok: false, code: 1, stdout: '', stderr: '', error: 'yt-dlp exited with code 1' };
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const firstRes = await postJson(base, '/api/ytdlp/download', {
      url: SINGLE_VIDEO_URL, format: 'video', quality: '1080p', filetype: 'mkv',
    });
    assert.equal(firstRes.status, 202);
    const { jobId: firstJobId } = await firstRes.json();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const snapAfterFailure = await (await fetch(`${base}/api/subscriptions/status`)).json();
    const failedEntry = snapAfterFailure.oneShots[firstJobId];
    assert.equal(failedEntry.state, 'error');

    const retryBody = buildOneShotRetryBody(failedEntry);
    const retryRes = await postJson(base, '/api/ytdlp/download', retryBody);
    assert.equal(retryRes.status, 202, 'the retry re-POST must be accepted by the SAME, unmodified route');
    const { jobId: retryJobId } = await retryRes.json();
    assert.notEqual(retryJobId, firstJobId, 'a retry is a NORMAL new one-shot job, not a mutation of the failed one');
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(attempt, 2, 'the retry must actually reach run.runDownload a second time');
    assert.equal(capturedSubs[1].format, 'video');
    assert.equal(capturedSubs[1].quality, '1080p');
    assert.equal(capturedSubs[1].filetype, 'mkv');

    const snapAfterRetry = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(snapAfterRetry.oneShots[retryJobId].state, 'done');
  } finally {
    await close();
  }
});

test('retry: a reconstructed body carrying a HOSTILE/non-video url is still rejected by the SAME classifySingleVideo validation -- no bypass', async () => {
  const deps = makeFakeDeps();
  let downloadCalls = 0;
  run.runDownload = async () => {
    downloadCalls += 1;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    // Simulates a corrupted/tampered activity entry (defense-in-depth,
    // regardless of how such an entry could arise) -- the reconstruction
    // helper performs NO validation of its own; it is the SERVER route that
    // must still reject a hostile reconstructed url.
    const hostileEntry = {
      url: 'https://www.youtube.com/watch?v=; rm -rf /',
      label: 'One-Off',
      format: 'video',
      quality: 'best',
      filetype: 'mp4',
    };
    const retryBody = buildOneShotRetryBody(hostileEntry);
    assert.equal(typeof retryBody.url, 'string');

    const res = await postJson(base, '/api/ytdlp/download', retryBody);
    assert.equal(res.status, 400, 'a hostile reconstructed url must still 400, exactly like a brand-new request would');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(downloadCalls, 0, 'a rejected retry must never reach a spawn');
  } finally {
    await close();
  }
});

test('buildOneShotRetryBody returns null for an entry with no reconstructable url (fail-safe, never POSTs an empty/garbage body)', () => {
  assert.equal(buildOneShotRetryBody(null), null);
  assert.equal(buildOneShotRetryBody({}), null);
  assert.equal(buildOneShotRetryBody({ url: '' }), null);
  assert.equal(buildOneShotRetryBody({ url: '   ' }), null);
});

test('buildOneShotRetryBody omits format/quality/filetype/folder when the entry does not carry them (older/partial entries degrade gracefully)', () => {
  const body = buildOneShotRetryBody({ url: SINGLE_VIDEO_URL });
  assert.deepEqual(body, { url: SINGLE_VIDEO_URL });
});
