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

// ---- v1.13.0 item 4: one-shot filetype validated + threaded through -------

test('POST /api/ytdlp/download accepts a valid filetype and threads it through to buildYtdlpDownloadArgs (video -> --merge-output-format)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  let capturedArgs = null;
  const originalRunDownload = run.runDownload;
  run.runDownload = async (sub, cfg, targetIds) => {
    capturedArgs = args.buildYtdlpDownloadArgs(sub, cfg, targetIds);
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL, format: 'video', filetype: 'mkv' });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(capturedArgs, 'runDownload must have been invoked');
    const idx = capturedArgs.indexOf('--merge-output-format');
    assert.ok(idx >= 0, '--merge-output-format must be present in the actually-built argv');
    assert.equal(capturedArgs[idx + 1], 'mkv');
  } finally {
    run.runDownload = originalRunDownload;
    await close();
  }
});

// ---- v1.15.0 item 6: runOneShot threads oneOff:true (archive bypass) ------

test('POST /api/ytdlp/download (one-shot) threads oneOff:true to run.runDownload, and the resulting built args bypass the shared archive', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  let capturedOpts = null;
  let capturedBuiltArgs = null;
  const originalRunDownload = run.runDownload;
  run.runDownload = async (sub, cfg, targetIds, opts) => {
    capturedOpts = opts;
    capturedBuiltArgs = args.buildYtdlpDownloadArgs(sub, cfg, targetIds, { oneOff: opts && opts.oneOff });
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.ok(capturedOpts, 'run.runDownload must have been invoked with an opts object');
    assert.equal(capturedOpts.oneOff, true, 'runOneShot must pass oneOff:true to run.runDownload');

    assert.ok(capturedBuiltArgs.includes('--no-download-archive'));
    assert.ok(capturedBuiltArgs.includes('--force-overwrites'));
    assert.ok(!capturedBuiltArgs.includes('--download-archive'), 'a one-off download must never carry the shared --download-archive flag');
  } finally {
    run.runDownload = originalRunDownload;
    await close();
  }
});

test('POST /api/ytdlp/download with a mismatched-format filetype (audio format, video filetype) responds 400', async () => {
  const deps = makeFakeDeps();
  let downloadCalls = 0;
  run.runDownload = async () => {
    downloadCalls += 1;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL, format: 'audio', filetype: 'mp4' });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(downloadCalls, 0, 'an invalid filetype must never reach a spawn');
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

// ---- FIX-7 (two-reviewer gate): a poll queued behind an in-flight one-shot -
// must already show its targeted subscriptions as 'queued' in the status ---
// snapshot, not stale/idle, for the ENTIRE time it waits its turn on the ----
// shared runExclusive FIFO. -------------------------------------------------

test('FIX-7 regression: a poll queued behind an in-flight one-shot shows its targeted subscriptions as "queued" in the status snapshot while it waits', async () => {
  const deps = makeFakeDeps();
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });
  const config = enabledConfig();

  let resolveOneShotDownload;
  let pollListStarted = false;
  run.runDownload = () => new Promise((resolve) => {
    resolveOneShotDownload = () => resolve({ ok: true, code: 0, stdout: '', stderr: '' });
  });
  run.runList = async () => {
    pollListStarted = true;
    return { ok: true, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const oneShotRes = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(oneShotRes.status, 202);
    // Give the one-shot's runExclusive job a moment to actually start.
    await new Promise((resolve) => setImmediate(resolve));

    // A poll trigger arrives while the one-shot's download is still pending
    // -- it must queue behind it on the shared FIFO (NFR2), never spawning
    // concurrently.
    const pollPromise = ytdlp.runPoll(deps, config);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(pollListStarted, false, 'sanity: the poll job must not have started its spawn yet -- it is still queued behind the one-shot');

    // FIX-7: even though the poll's OWN turn on the FIFO hasn't arrived,
    // its targeted subscription must already read 'queued' in the status
    // snapshot -- pre-fix, this write only happened INSIDE the
    // runExclusive callback, so it never ran until the poll actually got
    // its turn, leaving the snapshot looking stale/idle the whole time a
    // poll was genuinely pending.
    const midSnap = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.equal(midSnap.subscriptions[sub.id].state, 'queued', 'the targeted subscription must show "queued" while the poll waits behind an in-flight one-shot');

    resolveOneShotDownload();
    await pollPromise;
    assert.equal(pollListStarted, true, 'sanity: the poll eventually ran once the one-shot ahead of it completed');
  } finally {
    await close();
  }
});

// ---- FIX-10 (two-reviewer gate, LOW): bound the one-shot pending queue -----
// depth -- reject once too many are already queued, rather than growing it --
// without bound. `run.runDownload` here is mocked to NEVER resolve, so every
// accepted one-shot's `runExclusive` job stays pending for the rest of this
// test -- deliberately placed LAST in this file so its permanently-inflated
// `ytdlpQueueLength` (a module-level singleton shared by every test file that
// requires `lib/ytdlp` in this SAME process) can never affect an earlier or
// later test's own FIFO-ordering assertions.

// ---- Review-gate item 6 regression fix: a one-off records its id in the ---
// SHARED archive after success, so a LATER subscription poll of the same ---
// video is deduped (no duplicate library entry), while the one-off DOWNLOAD -
// pass itself keeps ignoring the archive (still re-downloads on request). ---

test('after a successful one-shot download, the video id is appended to the shared archive as "youtube <id>"', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const archiveText = fs.readFileSync(args.resolveArchivePath(config), 'utf8');
    assert.ok(
      archiveText.split('\n').includes('youtube dQw4w9WgXcQ'),
      `expected the archive to contain "youtube dQw4w9WgXcQ", got: ${archiveText}`,
    );
  } finally {
    await close();
  }
});

test('a one-off download that FAILS never records anything in the shared archive', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  run.runDownload = async () => ({ ok: false, code: 1, stdout: '', stderr: '', error: 'yt-dlp exited with code 1' });

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const archivePath = args.resolveArchivePath(config);
    const archiveText = fs.existsSync(archivePath) ? fs.readFileSync(archivePath, 'utf8') : '';
    assert.ok(!archiveText.includes('dQw4w9WgXcQ'), 'a failed one-off must never record the video id in the archive');
  } finally {
    await close();
  }
});

test('idempotent: one-off-ing the same video twice appends "youtube <id>" to the shared archive exactly once', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const { base, close } = await startTestApp(deps, config);
  try {
    const first = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(first.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(second.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const archiveText = fs.readFileSync(args.resolveArchivePath(config), 'utf8');
    const occurrences = archiveText.split('\n').filter((line) => line.trim() === 'youtube dQw4w9WgXcQ').length;
    assert.equal(occurrences, 1, `expected exactly one archive line for the id, got ${occurrences} in: ${archiveText}`);
  } finally {
    await close();
  }
});

test('a re-download of an already-archived video still actually re-downloads (the one-off download pass itself ignores the archive)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  // Pre-seed the archive as if a subscription (or a prior one-off) already
  // recorded this id -- the one-off DOWNLOAD pass must still spawn (never
  // silently skip) since buildYtdlpDownloadArgs's oneOff branch keeps
  // --no-download-archive regardless of what's already recorded.
  fs.mkdirSync(config.downloadDir, { recursive: true });
  fs.writeFileSync(args.resolveArchivePath(config), 'youtube dQw4w9WgXcQ\n', 'utf8');

  let downloadCalls = 0;
  run.runDownload = async () => {
    downloadCalls += 1;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(downloadCalls, 1, 'a one-off of an already-archived video must still actually re-download');

    // Still recorded exactly once afterward (idempotent re-assert of the
    // append, not a duplicate line from the re-download).
    const archiveText = fs.readFileSync(args.resolveArchivePath(config), 'utf8');
    const occurrences = archiveText.split('\n').filter((line) => line.trim() === 'youtube dQw4w9WgXcQ').length;
    assert.equal(occurrences, 1);
  } finally {
    await close();
  }
});

test('a subscription poll for a video that was previously one-offed now SKIPS it (isArchived true), preventing a duplicate download', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();

  // Step 1: one-off the video -- records it in the shared archive.
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });
  const oneOffRes = await (async () => {
    const { base, close } = await startTestApp(deps, config);
    try {
      const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
      await new Promise((resolve) => setTimeout(resolve, 20));
      return res;
    } finally {
      await close();
    }
  })();
  assert.equal(oneOffRes.status, 202);

  // Step 2: the SAME video now appears in a subscription's list pass -- the
  // subscription poll must treat it as already-archived and never target it
  // for download.
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@somechannel', format: 'video' });
  run.runList = async () => ({
    ok: true,
    stdout: JSON.stringify({ id: 'dQw4w9WgXcQ', extractor_key: 'Youtube', availability: 'public' }),
    stderr: '',
  });
  let downloadCalls = 0;
  run.runDownload = async (_sub, _cfg, targetIds) => {
    downloadCalls += 1;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const result = await ytdlp.runPoll(deps, config);
  assert.equal(result.started, true);
  assert.equal(downloadCalls, 0, 'a video already recorded by a prior one-off must never be re-downloaded by a subscription poll');

  const [persisted] = store.listSubscriptions(deps).filter((s) => s.id === sub.id);
  assert.ok(persisted.lastStatus.startsWith('ok'), `expected a safe ok status, got: ${persisted.lastStatus}`);
});

test('a failure to append to the archive does NOT fail the one-off -- the download still reports success and the failure is only logged', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  // Force the append to fail: make the resolved archive path itself a
  // directory, so fs.appendFileSync against it throws (EISDIR).
  fs.mkdirSync(args.resolveArchivePath(config), { recursive: true });

  const originalConsoleError = console.error;
  const errorLogs = [];
  console.error = (...msgArgs) => { errorLogs.push(msgArgs.join(' ')); };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    const { jobId } = await res.json();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const statusRes = await fetch(`${base}/api/subscriptions/status`);
    const snap = await statusRes.json();
    assert.equal(snap.oneShots[jobId].state, 'done', 'the one-off must still report success even though the archive append failed');
    assert.ok(
      errorLogs.some((line) => line.includes('failed to record one-off download')),
      'the append failure must be logged',
    );
  } finally {
    console.error = originalConsoleError;
    await close();
  }
});

test('FIX-10 regression: POST /api/ytdlp/download rejects once the pending one-shot queue exceeds the cap, instead of enqueuing unbounded', async () => {
  const deps = makeFakeDeps();
  run.runDownload = () => new Promise(() => {}); // never resolves -- keeps every queued job pending indefinitely
  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const cap = ytdlp.MAX_ONESHOT_QUEUE_LENGTH;
    assert.equal(typeof cap, 'number');
    assert.ok(cap > 0);

    for (let i = 0; i < cap; i++) {
      const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
      assert.equal(res.status, 202, `request ${i} should be accepted (still under the cap)`);
    }

    const overCapRes = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(overCapRes.status, 503, 'a one-shot POST beyond the cap must be rejected, not enqueued');
    const body = await overCapRes.json();
    assert.equal(typeof body.error, 'string');
    assert.ok(body.error.length > 0);
  } finally {
    await close();
  }
});
