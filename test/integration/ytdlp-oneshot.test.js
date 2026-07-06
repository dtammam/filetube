'use strict';

// [INTEGRATION] T3/FR-A: `POST /api/ytdlp/download` (the one-shot single-
// video download endpoint) + the `runExclusive` FIFO gate that serializes it
// against the poll loop (NFR2). `run.runList`/`run.runDownload` are mocked by
// monkey-patching the module object's own methods (the same pattern
// established in ytdlp-poll.test.js/ytdlp-repull-endpoints.test.js) -- no
// real yt-dlp binary or network is ever touched. Uses a fresh `express()` app
// per test (ytdlp-repull-endpoints.test.js's same-process pattern).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');
const store = require('../../lib/ytdlp/store');
const args = require('../../lib/ytdlp/args');

const originalRunList = run.runList;
const originalRunDownload = run.runDownload;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-oneshot-'));
});

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  ytdlp.resetPollRerunStateForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeFakeDeps(initialDb = {}) {
  let db = initialDb;
  const scanCalls = [];
  return {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {
      scanCalls.push(Date.now());
    },
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
    scanCalls,
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
const WATCH_VIDEO_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const CHANNEL_URL = 'https://www.youtube.com/@somechannel';
const PLAYLIST_URL = 'https://www.youtube.com/playlist?list=PLabc123def456';

function postJson(base, urlPath, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---- AC8/AC54: valid single video -> 202 + jobId, background download -----

test('POST /api/ytdlp/download with a valid single-video URL responds 202+jobId immediately, before the download completes', async () => {
  const deps = makeFakeDeps();
  let resolveDownload;
  let downloadCalls = 0;
  run.runDownload = (sub, config, targetIds) => {
    downloadCalls += 1;
    return new Promise((resolve) => {
      resolveDownload = () => resolve({ ok: true, code: 0, stdout: '', stderr: '' });
    });
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.accepted, true);
    assert.equal(typeof body.jobId, 'string');
    assert.ok(body.jobId.length > 0);

    // The response already arrived even though the download hasn't resolved.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(downloadCalls, 1, 'the download must have been kicked off in the background');

    // NEVER creates a subscription.
    assert.deepEqual(store.listSubscriptions(deps), []);

    resolveDownload();
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    await close();
  }
});

test('POST /api/ytdlp/download with a www.youtube.com/watch?v= URL is also accepted', async () => {
  const deps = makeFakeDeps();
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: WATCH_VIDEO_URL });
    assert.equal(res.status, 202);
  } finally {
    await close();
  }
});

// ---- AC9: channel/playlist/handle URL -> 400, never spawns -----------------

test('POST /api/ytdlp/download with a channel URL responds 400 and never spawns yt-dlp', async () => {
  const deps = makeFakeDeps();
  let downloadCalls = 0;
  run.runDownload = async () => {
    downloadCalls += 1;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: CHANNEL_URL });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(downloadCalls, 0);
    assert.deepEqual(store.listSubscriptions(deps), [], 'a rejected one-shot must never create a subscription');
  } finally {
    await close();
  }
});

test('POST /api/ytdlp/download with a playlist URL responds 400 and never spawns yt-dlp', async () => {
  const deps = makeFakeDeps();
  let downloadCalls = 0;
  run.runDownload = async () => {
    downloadCalls += 1;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: PLAYLIST_URL });
    assert.equal(res.status, 400);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(downloadCalls, 0);
  } finally {
    await close();
  }
});

// ---- AC10: malformed/non-YouTube/non-http(s) -> 400 -------------------------

test('POST /api/ytdlp/download with a malformed/non-YouTube/non-http(s) URL responds 400', async () => {
  const deps = makeFakeDeps();
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const nonHttp = await postJson(base, '/api/ytdlp/download', { url: 'ftp://example.com/video' });
    assert.equal(nonHttp.status, 400);

    const notAUrl = await postJson(base, '/api/ytdlp/download', { url: 'not a url at all' });
    assert.equal(notAUrl.status, 400);

    const wrongHost = await postJson(base, '/api/ytdlp/download', { url: 'https://vimeo.com/12345' });
    assert.equal(wrongHost.status, 400);

    const missingUrl = await postJson(base, '/api/ytdlp/download', {});
    assert.equal(missingUrl.status, 400);
  } finally {
    await close();
  }
});

// ---- AC56 (cross-cutting): a metacharacter-laden URL is rejected, never ---
// reaching the spawn boundary --------------------------------------------

test('POST /api/ytdlp/download with a shell-metacharacter-laden URL responds 400 and never spawns yt-dlp', async () => {
  const deps = makeFakeDeps();
  let downloadCalls = 0;
  run.runDownload = async () => {
    downloadCalls += 1;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: 'https://www.youtube.com/watch?v=; rm -rf /' });
    assert.equal(res.status, 400);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(downloadCalls, 0);
  } finally {
    await close();
  }
});

// ---- AC55: folder confinement -----------------------------------------------
//
// `resolveChannelDir` (lib/ytdlp/args.js) confines by SANITIZING the folder
// name first (`sanitizeChannelName` strips `..`/path separators down to a
// safe single-segment name) -- a traversal ATTEMPT is neutralized into a
// harmless folder name rather than rejected outright, so the correct
// assertion here is that the download can never land OUTSIDE the confined
// root, not that the request itself 400s.

test('POST /api/ytdlp/download with a traversal-attempt folder value is confined -- the download can never land outside the root', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  let capturedSub = null;
  run.runDownload = async (sub) => {
    capturedSub = sub;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL, folder: '../../../etc' });
    // Never rejected outright (the traversal attempt is neutralized, not an
    // error) -- what matters is that the resolved channel dir stays confined.
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.ok(capturedSub, 'the download must still have been attempted (with a sanitized folder name)');
    const resolvedDir = args.resolveChannelDir(config, capturedSub);
    const resolvedRoot = path.resolve(tmpDir);
    assert.ok(
      resolvedDir === resolvedRoot || resolvedDir.startsWith(resolvedRoot + path.sep),
      `a traversal-attempt folder must never resolve outside the confined download root, got: ${resolvedDir}`,
    );
  } finally {
    await close();
  }
});

test('POST /api/ytdlp/download with a folder value that resolveChannelDir would reject responds 400 and never spawns', async () => {
  // Simulate an actual confinement-guard rejection (rather than the
  // sanitizer neutralizing the input first) by monkey-patching
  // `resolveChannelDir` for the duration of this test -- this proves the
  // route's own `400`-on-throw branch is real and reachable, independent of
  // whether any known input can currently trigger it end-to-end.
  const originalResolveChannelDir = args.resolveChannelDir;
  args.resolveChannelDir = () => {
    throw new Error('Refusing to resolve channel dir outside the download root');
  };
  const deps = makeFakeDeps();
  let downloadCalls = 0;
  run.runDownload = async () => {
    downloadCalls += 1;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL, folder: 'anything' });
    assert.equal(res.status, 400);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(downloadCalls, 0, 'a folder rejected by resolveChannelDir must never reach a spawn');
  } finally {
    args.resolveChannelDir = originalResolveChannelDir;
    await close();
  }
});

// ---- AC11: lands under the confined root, in "One-Off" by default, and ----
// triggers a scan (indexed) --------------------------------------------------

test('a successful one-shot download lands in the confined "One-Off" subfolder by default and triggers a scan (AC11)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();

  let capturedSub = null;
  run.runDownload = async (sub, cfg, targetIds) => {
    capturedSub = sub;
    // Simulate yt-dlp actually writing a file into the confined channel dir.
    const channelDir = args.resolveChannelDir(cfg, sub);
    fs.mkdirSync(channelDir, { recursive: true });
    fs.writeFileSync(path.join(channelDir, `video [${targetIds[0]}].mp4`), 'fake video bytes');
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    const { jobId } = await res.json();

    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(capturedSub.name, 'One-Off');
    const oneOffDir = path.join(tmpDir, 'One-Off');
    assert.equal(fs.existsSync(oneOffDir), true, 'the file must have landed under the confined One-Off subfolder');
    assert.equal(deps.scanCalls.length, 1, 'a successful one-shot must trigger a scan so the file is indexed (AC11)');

    const statusRes = await fetch(`${base}/api/subscriptions/status`);
    const snap = await statusRes.json();
    assert.equal(snap.oneShots[jobId].state, 'done');
  } finally {
    await close();
  }
});

test('a custom folder value is honored (confined) instead of the "One-Off" default', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  let capturedSub = null;
  run.runDownload = async (sub) => {
    capturedSub = sub;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL, folder: 'My Custom Folder' });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(capturedSub.name, 'My Custom Folder');
  } finally {
    await close();
  }
});

// ---- Never creates a subscription ------------------------------------------

test('a one-shot download never creates a subscription record, success or failure', async () => {
  const deps = makeFakeDeps();
  run.runDownload = async () => ({ ok: false, code: 1, stdout: '', stderr: '', error: 'yt-dlp exited with code 1' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(store.listSubscriptions(deps), []);
  } finally {
    await close();
  }
});

// ---- A background FAILURE never crashes the process, sets an error status -

test('a one-shot background failure (ok:false result) sets the activity error state, never crashes', async () => {
  const deps = makeFakeDeps();
  run.runDownload = async () => ({ ok: false, code: 1, stdout: '', stderr: '', error: 'yt-dlp exited with code 1' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    const { jobId } = await res.json();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const statusRes = await fetch(`${base}/api/subscriptions/status`);
    const snap = await statusRes.json();
    assert.equal(snap.oneShots[jobId].state, 'error');
    assert.ok(typeof snap.oneShots[jobId].error === 'string' && snap.oneShots[jobId].error.length > 0);
  } finally {
    await close();
  }
});

test('a one-shot background SYNCHRONOUS THROW from runDownload is caught (never an unhandled rejection) and sets the activity error state', async () => {
  const deps = makeFakeDeps();
  run.runDownload = () => {
    throw new Error('synchronous boom from a hostile/buggy runDownload');
  };

  const unhandled = [];
  const onUnhandled = (err) => unhandled.push(err);
  process.on('unhandledRejection', onUnhandled);

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    const { jobId } = await res.json();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const statusRes = await fetch(`${base}/api/subscriptions/status`);
    const snap = await statusRes.json();
    assert.equal(snap.oneShots[jobId].state, 'error');
    assert.deepEqual(unhandled, [], 'a background one-shot failure must never surface as an unhandled promise rejection');
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
    await close();
  }
});

// ---- SF1/NFR3/AC31/57: cookies redaction on the one-shot's error field -----

test('a one-shot failure whose error embeds the cookies path never leaks it into the activity status', async () => {
  const cookiesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cookies-'));
  const cookiesFile = path.join(cookiesDir, 'cookies.txt');
  fs.writeFileSync(cookiesFile, 'session=abc123');
  const deps = makeFakeDeps();
  const config = enabledConfig({ FILETUBE_YTDLP_COOKIES_FILE: cookiesFile });

  run.runDownload = async () => ({
    ok: false,
    code: 1,
    stdout: '',
    stderr: '',
    error: `Command failed: yt-dlp --cookies ${cookiesFile} -- https://www.youtube.com/watch?v=dQw4w9WgXcQ`,
  });

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    const { jobId } = await res.json();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const statusRes = await fetch(`${base}/api/subscriptions/status`);
    const snap = await statusRes.json();
    assert.ok(!JSON.stringify(snap).includes(cookiesFile), `cookies path leaked into the status snapshot: ${JSON.stringify(snap)}`);
    assert.equal(snap.oneShots[jobId].state, 'error');
  } finally {
    fs.rmSync(cookiesDir, { recursive: true, force: true });
    await close();
  }
});

// ---- NFR2: runExclusive serializes a one-shot against an in-flight poll ---
// (ordering, not just non-crash) ---------------------------------------------

test('runExclusive: a one-shot fired while a poll is in-flight is queued -- it never spawns until the poll job finishes (ordering proven)', async () => {
  const deps = makeFakeDeps();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  const config = enabledConfig();

  let resolvePollList;
  let listEndedAt = null;
  let downloadStartedAt = null;
  run.runList = () => new Promise((resolve) => {
    resolvePollList = () => {
      listEndedAt = Date.now();
      resolve({ ok: true, stdout: '', stderr: '' });
    };
  });
  run.runDownload = async () => {
    downloadStartedAt = Date.now();
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    // Start a poll directly (it targets the one subscription above, blocked
    // on runList) -- this is the FIRST job queued on the shared runExclusive
    // FIFO.
    const pollPromise = ytdlp.runPoll(deps, config);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ytdlp.isPollBusy(), true, 'sanity: the poll must be in flight');

    // Fire the one-shot WHILE the poll is still in flight -- it must queue
    // behind the poll's job, not spawn concurrently with it.
    const oneShotRes = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(oneShotRes.status, 202);

    // Give the one-shot's queued runExclusive job a moment: it must NOT have
    // started its download yet, since the poll's job is still ahead of it in
    // the FIFO.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(downloadStartedAt, null, 'the one-shot must not spawn while the poll job is still ahead of it in the FIFO queue');

    // Let the poll's (only) spawn finish.
    resolvePollList();
    await pollPromise;

    // Now the one-shot's queued job should be allowed to run.
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(downloadStartedAt !== null, 'the one-shot must eventually spawn once the poll job ahead of it completes');
    assert.ok(downloadStartedAt >= listEndedAt, 'the one-shot download must start only AFTER the poll job (runList) finished -- never concurrently');
  } finally {
    await close();
  }
});

test('runExclusive: a poll trigger arriving while a one-shot is in-flight queues behind it -- never spawns concurrently', async () => {
  const deps = makeFakeDeps();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  const config = enabledConfig();

  let resolveOneShotDownload;
  let oneShotEndedAt = null;
  let pollListStartedAt = null;
  run.runDownload = () => new Promise((resolve) => {
    resolveOneShotDownload = () => {
      oneShotEndedAt = Date.now();
      resolve({ ok: true, code: 0, stdout: '', stderr: '' });
    };
  });
  run.runList = async () => {
    pollListStartedAt = Date.now();
    return { ok: true, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const oneShotRes = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(oneShotRes.status, 202);
    // Give the one-shot's runExclusive job a moment to actually start (it's
    // the first, and only, job queued so far).
    await new Promise((resolve) => setImmediate(resolve));

    // A poll trigger arrives while the one-shot's download is still pending.
    const pollPromise = ytdlp.runPoll(deps, config);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(pollListStartedAt, null, 'the poll job must not have started its spawn while the one-shot job is still ahead of it in the FIFO');

    resolveOneShotDownload();
    await pollPromise;

    assert.ok(pollListStartedAt !== null, 'the poll job must eventually run once the one-shot job ahead of it completes');
    assert.ok(pollListStartedAt >= oneShotEndedAt, 'the poll must start only AFTER the one-shot finished -- never concurrently');
  } finally {
    await close();
  }
});
