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
const { formatBodyParserError } = require('../../lib/bodyParserErrors');

const originalRunList = run.runList;
const originalRunDownload = run.runDownload;
const originalProbeChannel = run.probeChannel;
const originalProbeChannelAvatar = run.probeChannelAvatar;

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-oneshot-'));
  // v1.25 QoL (T3): every test in this file gets a DETERMINISTIC probe by
  // default (resolves "no channel found") so pre-existing tests that don't
  // care about channel routing aren't at the mercy of whether a real yt-dlp
  // binary happens to be on the test-runner's PATH. Tests that DO care about
  // probe/routing behavior override this per-test, exactly like `run.runList`/
  // `run.runDownload` are already overridden per-test below.
  run.probeChannel = async () => null;
  // v1.25.5 QoL follow-up (channel avatars, round 2): same DETERMINISTIC-
  // default posture as `run.probeChannel` immediately above, for the SAME
  // reason -- a pre-existing test that supplies `channelMeta` with a valid
  // `channelUrl` (and no explicit `folder`) would otherwise trigger a REAL
  // `run.probeChannelAvatar` spawn attempt. Tests that DO care about
  // avatar-probe behavior override this per-test below.
  run.probeChannelAvatar = async () => null;
});

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  run.probeChannel = originalProbeChannel;
  run.probeChannelAvatar = originalProbeChannelAvatar;
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
  // v1.28.0: mirrors server.js's own JSON-parse/body-parser-error middleware
  // (registered right after `express.json()` there too, using the SAME
  // shared `formatBodyParserError` mapping -- see lib/bodyParserErrors.js)
  // so the malformed/oversized-JSON tests below exercise the SAME behavior
  // this bare test app's real counterpart ships -- a bad JSON body 400s/413s
  // as JSON, never Express's default HTML stack page. Every other error
  // still passes through untouched via `next(err)`.
  app.use((err, req, res, next) => {
    const mapped = formatBodyParserError(err);
    if (mapped) {
      return res.status(mapped.status).json(mapped.body);
    }
    return next(err);
  });
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

// ---- AC11 (v1.25 QoL T3 revision): lands under the confined root, in a  ----
// PER-CHANNEL folder derived from a pre-download probe (or the fixed
// 'Uncategorized' fallback when the probe finds nothing), and triggers a
// scan (indexed) -- replaces the old flat "One-Off" default.

test('a successful one-shot download with a probed channel routes into that channel\'s own confined folder and triggers a scan (AC11)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  run.probeChannel = async () => 'Some Creator';

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

    assert.equal(capturedSub.name, 'Some Creator');
    const channelDir = path.join(tmpDir, 'Some Creator');
    assert.equal(fs.existsSync(channelDir), true, 'the file must have landed under the confined per-channel subfolder');
    assert.equal(deps.scanCalls.length, 1, 'a successful one-shot must trigger a scan so the file is indexed (AC11)');

    const statusRes = await fetch(`${base}/api/subscriptions/status`);
    const snap = await statusRes.json();
    assert.equal(snap.oneShots[jobId].state, 'done');
    assert.equal(snap.oneShots[jobId].label, 'Some Creator', 'the resolved (probed) folder must be reflected back as the job label');
  } finally {
    await close();
  }
});

test('a successful one-shot download whose probe finds NO channel falls back to the confined "Uncategorized" folder (never the old flat "One-Off") and triggers a scan', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  run.probeChannel = async () => null; // explicit -- mirrors the beforeEach default, spelled out for clarity here

  let capturedSub = null;
  run.runDownload = async (sub, cfg, targetIds) => {
    capturedSub = sub;
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

    assert.equal(capturedSub.name, 'Uncategorized');
    const fallbackDir = path.join(tmpDir, 'Uncategorized');
    assert.equal(fs.existsSync(fallbackDir), true, 'the file must have landed under the confined Uncategorized fallback subfolder');
    assert.equal(deps.scanCalls.length, 1);

    const statusRes = await fetch(`${base}/api/subscriptions/status`);
    const snap = await statusRes.json();
    assert.equal(snap.oneShots[jobId].state, 'done');
  } finally {
    await close();
  }
});

test('a one-off channel probe that REJECTS (throws) never crashes the job -- it still falls back to "Uncategorized"', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  run.probeChannel = async () => {
    throw new Error('a defensive-in-depth regression: probeChannel is documented to never reject, but this proves runOneShot survives it anyway');
  };
  run.runDownload = async (sub) => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    const { jobId } = await res.json();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const statusRes = await fetch(`${base}/api/subscriptions/status`);
    const snap = await statusRes.json();
    assert.equal(snap.oneShots[jobId].state, 'done', 'a throwing probe must never surface as a job failure');
    assert.equal(snap.oneShots[jobId].label, 'Uncategorized');
  } finally {
    await close();
  }
});

test('an explicit body.folder override always wins -- the channel probe is never even invoked', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  let probeCalls = 0;
  run.probeChannel = async () => {
    probeCalls += 1;
    return 'Should Never Be Used';
  };
  let capturedSub = null;
  run.runDownload = async (sub) => {
    capturedSub = sub;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL, folder: 'My Custom Folder' });
    assert.equal(res.status, 202);
    const { jobId } = await res.json();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(capturedSub.name, 'My Custom Folder');
    assert.equal(probeCalls, 0, 'an explicit folder override must skip the probe entirely');

    const statusRes = await fetch(`${base}/api/subscriptions/status`);
    const snap = await statusRes.json();
    assert.equal(snap.oneShots[jobId].label, 'My Custom Folder', 'the label must already reflect the override even at "queued" time (no probe round-trip needed)');
  } finally {
    await close();
  }
});

test('a custom folder value is honored (confined) instead of the probed/fallback default', async () => {
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

// v1.15.1 hotfix: a failed one-shot download cleans up any yt-dlp
// intermediate artifacts it left in the (confined) target folder, but never
// touches an unrelated, already-completed file sitting in the same folder.
test('a FAILED one-shot download cleans up yt-dlp intermediate artifacts in its target folder, but leaves a completed final file untouched', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  // beforeEach's default `run.probeChannel` stub resolves null -> the
  // one-off falls back to the fixed 'Uncategorized' folder.
  const channelDir = args.resolveChannelDir(config, { name: 'Uncategorized' });
  fs.mkdirSync(channelDir, { recursive: true });
  const finalPath = path.join(channelDir, 'Already Downloaded [dQw4w9WgXcQ].mp4');
  const fragmentPath = path.join(channelDir, 'Killed Video [wSx0Or20MZE].f399.mp4');
  const mergeTempPath = path.join(channelDir, 'Killed Video [wSx0Or20MZE].temp.mp4');
  fs.writeFileSync(finalPath, 'a real, already-completed video');
  fs.writeFileSync(fragmentPath, 'yt-dlp leftover bytes');
  fs.writeFileSync(mergeTempPath, 'yt-dlp leftover bytes');

  run.runDownload = async () => ({ ok: false, code: 'ETIMEDOUT', stdout: '', stderr: '', error: 'yt-dlp download timed out after 180m (absolute ceiling) and was killed' });

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    const { jobId } = await res.json();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const statusRes = await fetch(`${base}/api/subscriptions/status`);
    const snap = await statusRes.json();
    assert.equal(snap.oneShots[jobId].state, 'error');

    assert.equal(fs.existsSync(fragmentPath), false, 'the per-format fragment must be cleaned up after the failed download');
    assert.equal(fs.existsSync(mergeTempPath), false, 'the merge temp must be cleaned up after the failed download');
    assert.equal(fs.existsSync(finalPath), true, 'a completed/final file must never be removed by the cleanup');
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

// ---- FIX 2 (two-reviewer gate, post-v1.25.0): the pre-download channel -----
// probe (`run.probeChannel`, via `resolveOneOffFolder`) now runs OUTSIDE the
// shared `runExclusive` FIFO gate -- a slow/hung probe must never hold that
// gate hostage (pre-fix, the WHOLE of `runOneShot`, probe included, ran
// inside `runExclusive`, so a hung probe blocked every other queued one-shot
// AND subscription poll behind it for up to the old 5-minute list timeout).

test('FIX 2: a hung channel probe for one job does NOT block a concurrently-requested download (with no probe of its own) from proceeding', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();

  // Job A's probe hangs forever (never resolves) -- captured so the test can
  // resolve it later to prove the hang was only transient, not permanent.
  let hungResolve;
  run.probeChannel = () => new Promise((resolve) => {
    hungResolve = resolve;
  });

  const downloadCalls = [];
  run.runDownload = async (sub) => {
    downloadCalls.push(sub.name);
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    // Job A: no explicit folder -> requires the (hung) probe.
    const resA = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(resA.status, 202);

    // Give job A's resolveOneOffFolder a moment to actually call probeChannel
    // (and hang there).
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof hungResolve, 'function', 'sanity: job A must have already invoked the (now-hung) probe');

    // Job B: an EXPLICIT folder -> skips the probe entirely and can join the
    // exclusive download FIFO immediately.
    const resB = await postJson(base, '/api/ytdlp/download', { url: WATCH_VIDEO_URL, folder: 'Explicit Folder' });
    assert.equal(resB.status, 202);

    await new Promise((resolve) => setTimeout(resolve, 30));

    // Job B's download must have proceeded even though job A's probe NEVER
    // resolved during this whole window -- proving the hung probe never held
    // the shared runExclusive gate hostage (pre-fix, job B would still be
    // stuck waiting behind job A's in-flight-forever probe+download job).
    assert.deepEqual(downloadCalls, ['Explicit Folder'], 'job B must download without waiting for job A\'s hung probe');

    // Resolving job A's probe now lets its own download finally join the
    // FIFO and complete too -- the hang was only in the (now unlocked) probe
    // stage, never a permanent block.
    hungResolve('Probed Channel');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(downloadCalls, ['Explicit Folder', 'Probed Channel'], 'job A must still eventually download once its probe resolves');
  } finally {
    await close();
  }
});

test('FIX 2: a hung channel probe for a one-shot does NOT block a concurrently-triggered subscription poll from spawning', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chanA', format: 'video' });

  run.probeChannel = () => new Promise(() => {}); // hangs for the entire test
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  let listStarted = false;
  run.runList = async () => {
    listStarted = true;
    return { ok: true, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const oneShotRes = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(oneShotRes.status, 202);
    await new Promise((resolve) => setImmediate(resolve));

    // A poll trigger arrives while the one-shot's probe is still hung --
    // pre-fix, this would have queued behind the WHOLE one-shot job
    // (probe included) and never started its own spawn until that hung probe
    // (bounded only by the old 5-minute list timeout) finally settled.
    const pollResult = await ytdlp.runPoll(deps, config);
    assert.equal(pollResult.started, true);
    assert.equal(listStarted, true, 'the poll\'s own runList spawn must have run without waiting for the one-shot\'s hung probe');
  } finally {
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

// ---- v1.36.2 gate follow-up (adversarial WARNING): subs-only one-off = done --

test('v1.36.2: a one-off whose media completed but whose SUBTITLES exit-1d resolves to the SUCCESS path -- done state, archive appended, never a red chip', async () => {
  const deps = makeFakeDeps();
  const argsModule = require('../../lib/ytdlp/args');
  const activityModule = require('../../lib/ytdlp/activity');

  run.runDownload = async () => ({
    ok: false, // yt-dlp exited 1 -- but only because of subtitles
    code: 1,
    stdout: '',
    stderr: '',
    error: 'yt-dlp exited with code 1',
    itemFailures: [{ videoId: 'dQw4w9WgXcQ', reason: "Unable to download video subtitles for 'en': HTTP Error 429", subtitleOnly: true }],
    // The FTCHMETA capture line the completed download printed -- the
    // corroborating positive evidence.
    channelMeta: [{ videoId: 'dQw4w9WgXcQ', channelUrl: 'https://www.youtube.com/@subsflaky' }],
  });

  const config = enabledConfig();
  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: WATCH_VIDEO_URL });
    assert.equal(res.status, 202);
    const { jobId } = await res.json();

    // Wait for the job to settle (bounded).
    let entry = null;
    for (let i = 0; i < 100; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      entry = activityModule.getSnapshot().oneShots[jobId];
      if (entry && entry.state !== 'downloading' && entry.state !== 'queued') break;
    }
    assert.ok(entry, 'the job must have an activity entry');
    assert.equal(entry.state, 'done', 'a subs-only non-zero exit must settle as DONE, not a red error chip contradicting its own success run-log line');

    const archivePath = argsModule.resolveArchivePath(config);
    const archiveText = fs.existsSync(archivePath) ? fs.readFileSync(archivePath, 'utf8') : '';
    assert.ok(archiveText.includes('youtube dQw4w9WgXcQ'), 'the success path must run: the id is archived so a later subscription poll never re-downloads a duplicate');
  } finally {
    await close();
  }
});

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

// ---- v1.20.0 FR-2: one-shot channel-identity capture (NO fallback) --------

test('a successful one-shot download persists its captured (sanitized) channel identity into db.ytdlp.downloadMeta', async () => {
  const deps = makeFakeDeps();
  run.runDownload = async () => ({
    ok: true,
    code: 0,
    stdout: '',
    stderr: '',
    channelMeta: [{
      videoId: 'dQw4w9WgXcQ',
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
      uploaderUrl: 'https://www.youtube.com/@RickAstley',
      channelName: 'Rick Astley',
    }],
  });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const ns = store.ensureYtdlp(deps.loadDatabase());
    assert.ok(ns.downloadMeta.dQw4w9WgXcQ, 'the captured channel identity must be persisted, keyed by the video id');
    assert.equal(ns.downloadMeta.dQw4w9WgXcQ.channelUrl, 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw');
    assert.equal(ns.downloadMeta.dQw4w9WgXcQ.channelName, 'Rick Astley');
  } finally {
    await close();
  }
});

test('a one-shot capture MISS (no channelMeta captured) leaves NO downloadMeta entry -- the one-shot path has no fallback, unlike subscriptions', async () => {
  const deps = makeFakeDeps();
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [] });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const ns = store.ensureYtdlp(deps.loadDatabase());
    assert.equal(ns.downloadMeta.dQw4w9WgXcQ, undefined, 'a one-shot capture miss must leave no channel identity -- no fallback exists for the one-shot path');
  } finally {
    await close();
  }
});

test('a one-shot with a HOSTILE captured channelUrl records nothing (dropped by the sanitizer, never stored)', async () => {
  const deps = makeFakeDeps();
  run.runDownload = async () => ({
    ok: true,
    code: 0,
    stdout: '',
    stderr: '',
    channelMeta: [{
      videoId: 'dQw4w9WgXcQ',
      channelUrl: 'https://evil.com/@x; rm -rf /',
      channelId: null,
      uploaderUrl: null,
      channelName: 'Hostile',
    }],
  });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const ns = store.ensureYtdlp(deps.loadDatabase());
    assert.equal(ns.downloadMeta.dQw4w9WgXcQ, undefined, 'a hostile captured channelUrl must never be persisted');
  } finally {
    await close();
  }
});

test('a one-shot download FAILURE never persists a channel-identity capture (only a successful download\'s channelMeta is recorded)', async () => {
  const deps = makeFakeDeps();
  run.runDownload = async () => ({
    ok: false,
    code: 1,
    stdout: '',
    stderr: '',
    error: 'yt-dlp exited with code 1',
    channelMeta: [{
      videoId: 'dQw4w9WgXcQ',
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channelId: null,
      uploaderUrl: null,
      channelName: 'Should Not Be Stored',
    }],
  });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const ns = store.ensureYtdlp(deps.loadDatabase());
    assert.equal(ns.downloadMeta.dQw4w9WgXcQ, undefined, 'a FAILED download must never persist a channel-identity capture');
  } finally {
    await close();
  }
});

// ---- v1.25.5 QoL follow-up (channel avatars, round 2): item-level avatar --
// for a one-off download of a NON-subscribed channel -----------------------

test('a successful one-off download with a resolved channel probes the channel avatar and folds it into the persisted downloadMeta entry', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  run.runDownload = async () => ({
    ok: true,
    code: 0,
    stdout: '',
    stderr: '',
    channelMeta: [{
      videoId: 'dQw4w9WgXcQ',
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
      uploaderUrl: 'https://www.youtube.com/@RickAstley',
      channelName: 'Rick Astley',
    }],
  });

  let probeCalls = [];
  run.probeChannelAvatar = async (channelUrl) => {
    probeCalls.push(channelUrl);
    return { avatarUrl: 'https://example.com/avatar.jpg', channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw', channelUrl };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.deepEqual(probeCalls, ['https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw'], 'the avatar probe must be called with the download\'s own captured channelUrl');

    const ns = store.ensureYtdlp(deps.loadDatabase());
    assert.equal(ns.downloadMeta.dQw4w9WgXcQ.channelAvatarUrl, 'https://example.com/avatar.jpg', 'the probed avatar must be folded into the persisted downloadMeta entry, ready for the next scan\'s consumeDownloadChannelMeta bridge');
    assert.equal(ns.channelAvatars.UCuAXFkgsw1L7xaCfnd5JJOw.avatarUrl, 'https://example.com/avatar.jpg', 'a one-off (non-subscribed) channel\'s avatar must ALSO be registered into the canonical registry, keyed by channelId');
  } finally {
    await close();
  }
});

test('a one-off download with an EXPLICIT manual folder override skips the avatar probe entirely (no channel identity to key it off of)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  run.runDownload = async () => ({
    ok: true,
    code: 0,
    stdout: '',
    stderr: '',
    channelMeta: [{
      videoId: 'dQw4w9WgXcQ',
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
      uploaderUrl: null,
      channelName: 'Rick Astley',
    }],
  });

  let probeCalls = 0;
  run.probeChannelAvatar = async () => {
    probeCalls += 1;
    return 'https://example.com/avatar.jpg';
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL, folder: 'My Custom Folder' });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(probeCalls, 0, 'an explicit manual folder override must skip the avatar probe entirely');

    const ns = store.ensureYtdlp(deps.loadDatabase());
    assert.equal(ns.downloadMeta.dQw4w9WgXcQ.channelAvatarUrl, undefined, 'no avatar must be persisted when the probe was skipped');
    // The identity capture itself (channel name etc, unrelated to the
    // avatar) is still recorded exactly as before this feature.
    assert.equal(ns.downloadMeta.dQw4w9WgXcQ.channelName, 'Rick Astley');
  } finally {
    await close();
  }
});

test('a channel-avatar probe failure (throw) never breaks the download -- no avatar is persisted, the job still succeeds', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  run.runDownload = async () => ({
    ok: true,
    code: 0,
    stdout: '',
    stderr: '',
    channelMeta: [{
      videoId: 'dQw4w9WgXcQ',
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channelId: null,
      uploaderUrl: null,
      channelName: 'Rick Astley',
    }],
  });
  run.probeChannelAvatar = async () => {
    throw new Error('a defensive-in-depth regression: probeChannelAvatar is documented to never reject, but this proves runOneShot survives it anyway');
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    const { jobId } = await res.json();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const statusRes = await fetch(`${base}/api/subscriptions/status`);
    const snap = await statusRes.json();
    assert.equal(snap.oneShots[jobId].state, 'done', 'a throwing avatar probe must never surface as a job failure');

    const ns = store.ensureYtdlp(deps.loadDatabase());
    assert.equal(ns.downloadMeta.dQw4w9WgXcQ.channelAvatarUrl, undefined, 'a failed probe must never persist an avatar');
    assert.equal(ns.downloadMeta.dQw4w9WgXcQ.channelName, 'Rick Astley', 'the rest of the captured identity must still be persisted despite the avatar probe throwing');
  } finally {
    await close();
  }
});

test('a null probe result (no avatar found for this channel) persists no avatar, without error', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  run.runDownload = async () => ({
    ok: true,
    code: 0,
    stdout: '',
    stderr: '',
    channelMeta: [{
      videoId: 'dQw4w9WgXcQ',
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channelId: null,
      uploaderUrl: null,
      channelName: 'Rick Astley',
    }],
  });
  run.probeChannelAvatar = async () => null;

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const ns = store.ensureYtdlp(deps.loadDatabase());
    assert.equal(ns.downloadMeta.dQw4w9WgXcQ.channelAvatarUrl, undefined);
  } finally {
    await close();
  }
});

test('a capture MISS (no channelMeta at all) never attempts an avatar probe -- there is no channelUrl to key it off of', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '', channelMeta: [] });

  let probeCalls = 0;
  run.probeChannelAvatar = async () => {
    probeCalls += 1;
    return 'https://example.com/avatar.jpg';
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(probeCalls, 0, 'no captured channelUrl means nothing to probe');
  } finally {
    await close();
  }
});

test('the avatar probe is non-blocking: the 202 response is never delayed by it', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  run.runDownload = async () => ({
    ok: true,
    code: 0,
    stdout: '',
    stderr: '',
    channelMeta: [{
      videoId: 'dQw4w9WgXcQ',
      channelUrl: 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw',
      channelId: null,
      uploaderUrl: null,
      channelName: 'Rick Astley',
    }],
  });
  // A probe that stays pending for the DURATION OF THIS TEST's own
  // assertions -- if the 202 response were somehow gated on it, this test
  // would time out. Deliberately NOT a promise that never resolves at all
  // (unlike FIX-10's own `run.runDownload` stub immediately below): this
  // file's module-level `ytdlpQueueLength` counter is shared across every
  // test in this process (see FIX-10's own comment), so a job left
  // permanently pending here would leak into -- and corrupt -- that later
  // test's exact-count assertions. `releaseProbe()` in `finally` lets this
  // job settle before the test ends.
  let releaseProbe;
  const probeGate = new Promise((resolve) => { releaseProbe = resolve; });
  run.probeChannelAvatar = () => probeGate.then(() => 'https://example.com/avatar.jpg');

  const { base, close } = await startTestApp(deps, config);
  try {
    const start = Date.now();
    const res = await postJson(base, '/api/ytdlp/download', { url: SINGLE_VIDEO_URL });
    assert.equal(res.status, 202);
    assert.ok(Date.now() - start < 500, 'the 202 response must arrive immediately, never waiting on the (hung) avatar probe');
  } finally {
    releaseProbe();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await close();
  }
});

// ---- v1.28.0: iOS Shortcuts / share-sheet robustness (endpoint-level) ------
//
// `lib/ytdlp/url.js`'s own unit suite (test/unit/ytdlp-url.test.js) already
// covers the normalization/canonicalization logic exhaustively -- these
// tests instead prove the END-TO-END wiring: the mocked spawn layer
// (`run.runDownload`) receives the CANONICAL watch URL (never the raw
// input), a `text/plain` body works, and malformed JSON 400s as JSON.
// Deliberately placed BEFORE the FIX-10 queue-cap test above (which is
// documented to stay LAST in this file, since it permanently inflates the
// shared `ytdlpQueueLength` singleton for the rest of the process).

test('v1.28.0: POST /api/ytdlp/download with a /shorts/<id> URL is accepted -- the spawn-bound TARGET is the CANONICAL video id, never the raw /shorts/ path', async () => {
  const deps = makeFakeDeps();
  let capturedTargetIds = null;
  run.runDownload = async (sub, cfg, targetIds) => {
    capturedTargetIds = targetIds;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(capturedTargetIds, ['dQw4w9WgXcQ'], 'run.runDownload must receive the canonical video id (args.js rebuilds it into the canonical watch URL via buildWatchUrl)');
  } finally {
    await close();
  }
});

// F7 (explicit, mirrors ytdlp-crud.test.js's SUBSCRIPTION-side rejection of
// the SAME URL): the one-off download classifier is the ONLY caller that
// opts into recognizing /shorts//live//embed -- accepted HERE, rejected on
// the subscription-add path, never the other way around.
test('F7: POST /api/ytdlp/download with a /shorts/<id> URL responds 202 with the canonical watch id (only the one-off path opts into this shape)', async () => {
  const deps = makeFakeDeps();
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.accepted, true);
  } finally {
    await close();
  }
});

test('v1.28.0: POST /api/ytdlp/download with an "&"-param URL (youtu.be/<id>?si=<x>&t=5) is accepted and canonicalizes before spawning', async () => {
  const deps = makeFakeDeps();
  let capturedTargetIds = null;
  run.runDownload = async (sub, cfg, targetIds) => {
    capturedTargetIds = targetIds;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: 'https://youtu.be/dQw4w9WgXcQ?si=abc123&t=5' });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(capturedTargetIds, ['dQw4w9WgXcQ'], 'the "&"-joined query must never survive into the spawn-bound target');
  } finally {
    await close();
  }
});

test('v1.28.0: POST /api/ytdlp/download with a quote-wrapped URL body is accepted (a Shortcut\'s own literal typed quote characters)', async () => {
  const deps = makeFakeDeps();
  let downloadCalls = 0;
  run.runDownload = async () => {
    downloadCalls += 1;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: `"${SINGLE_VIDEO_URL}"` });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(downloadCalls, 1);
  } finally {
    await close();
  }
});

test('v1.28.0: POST /api/ytdlp/download accepts a text/plain body, mapping the bare string to {url: body}', async () => {
  const deps = makeFakeDeps();
  let capturedTargetIds = null;
  run.runDownload = async (sub, cfg, targetIds) => {
    capturedTargetIds = targetIds;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/ytdlp/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: SINGLE_VIDEO_URL,
    });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.accepted, true);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.deepEqual(capturedTargetIds, ['dQw4w9WgXcQ'], 'the download must have been kicked off from a text/plain body, with the correct video id');
  } finally {
    await close();
  }
});

test('v1.28.0: POST /api/ytdlp/download with an unparseable JSON body responds 400 with a JSON error, never the default Express HTML stack page', async () => {
  const deps = makeFakeDeps();
  let downloadCalls = 0;
  run.runDownload = async () => {
    downloadCalls += 1;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/ytdlp/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ this is not valid JSON',
    });
    assert.equal(res.status, 400);
    assert.equal(res.headers.get('content-type').includes('application/json'), true, 'the error body must be JSON, not an HTML stack page');
    const body = await res.json();
    assert.equal(typeof body.error, 'string');
    assert.match(body.error, /request body is not valid JSON/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(downloadCalls, 0, 'a malformed-JSON request must never reach a spawn');
  } finally {
    await close();
  }
});

// ---- two-reviewer gate follow-up (F1): oversized bodies never render HTML --
//
// `express.text()` on this route is now explicitly capped at 256kb (well
// below the default), and BOTH parsers' oversized-body errors flow through
// the SAME `formatBodyParserError` mapping (lib/bodyParserErrors.js) -- see
// that route's own comment for why a route-scoped 4-arg middleware, not
// server.js's earlier-registered global one, is what actually catches this.

test('v1.28.0 (F1): POST /api/ytdlp/download with an oversized text/plain body responds 413 with a JSON error, never the default Express HTML stack page', async () => {
  const deps = makeFakeDeps();
  let downloadCalls = 0;
  run.runDownload = async () => {
    downloadCalls += 1;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/ytdlp/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'x'.repeat(300 * 1024), // past this route's explicit 256kb cap
    });
    assert.equal(res.status, 413);
    assert.equal(res.headers.get('content-type').includes('application/json'), true, 'the error body must be JSON, not an HTML stack page');
    const body = await res.json();
    assert.equal(typeof body.error, 'string');
    assert.match(body.error, /too large/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(downloadCalls, 0, 'an oversized-body request must never reach a spawn');
  } finally {
    await close();
  }
});

test('v1.28.0 (F1): POST /api/ytdlp/download with an oversized JSON body responds 413 with a JSON error, never the default Express HTML stack page', async () => {
  const deps = makeFakeDeps();
  let downloadCalls = 0;
  run.runDownload = async () => {
    downloadCalls += 1;
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, enabledConfig());
  try {
    const res = await fetch(`${base}/api/ytdlp/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // past express.json()'s own default 100kb cap (unchanged, global).
      body: JSON.stringify({ url: SINGLE_VIDEO_URL, padding: 'x'.repeat(150 * 1024) }),
    });
    assert.equal(res.status, 413);
    assert.equal(res.headers.get('content-type').includes('application/json'), true, 'the error body must be JSON, not an HTML stack page');
    const body = await res.json();
    assert.equal(typeof body.error, 'string');
    assert.match(body.error, /too large/);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(downloadCalls, 0, 'an oversized-body request must never reach a spawn');
  } finally {
    await close();
  }
});

test('v1.28.0: the pre-spawn re-validation in args.js still passes for a canonicalized one-shot URL (never re-rejects its own canonical output)', async () => {
  const deps = makeFakeDeps();
  const config = enabledConfig();
  let capturedArgs = null;
  const originalRunDownload = run.runDownload;
  run.runDownload = async (sub, cfg, targetIds) => {
    // Mirrors the existing "threads it through to buildYtdlpDownloadArgs"
    // test pattern above -- this is exactly the args.js re-validation path
    // (`requireValidUrl`, defense-in-depth) that runs immediately before a
    // real spawn.
    capturedArgs = args.buildYtdlpDownloadArgs(sub, cfg, targetIds);
    return { ok: true, code: 0, stdout: '', stderr: '' };
  };

  const { base, close } = await startTestApp(deps, config);
  try {
    const res = await postJson(base, '/api/ytdlp/download', { url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ?si=xyz' });
    assert.equal(res.status, 202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(capturedArgs, 'buildYtdlpDownloadArgs must have run (i.e. args.js\'s own re-validation did not throw/reject the canonical URL)');
    assert.ok(capturedArgs.includes(WATCH_VIDEO_URL), 'the built argv must carry the canonical watch URL');
  } finally {
    run.runDownload = originalRunDownload;
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
