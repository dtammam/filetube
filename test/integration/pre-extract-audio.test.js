'use strict';

// [INTEGRATION] v1.35 (Dean, deterministic background audio) -- the
// preExtractAudio setting's two server-side halves, against the REAL app
// with the stub-ffmpeg-on-PATH harness (transcode-execution.test.js's
// pattern -- CI has no ffmpeg):
//
//   1. EXTRACT AT DOWNLOAD: a freshly-scanned VIDEO under the yt-dlp
//      download root gets its .m4a sidecar queued at scan time (fired
//      post-save -- the stale-snapshot discipline) when the setting is ON;
//      never when OFF; never for non-yt-dlp library files.
//   2. PINNING: while ON, .m4a sidecars are exempt from the size-cap
//      eviction and the age sweep; OFF restores normal eviction. The
//      manual cache-clear endpoint still removes them (explicit intent).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-ffmpeg-pre-'));
fs.writeFileSync(path.join(binDir, 'ffmpeg'), `#!/bin/bash
if [[ "$1" == "-version" ]]; then echo "ffmpeg version 0.0-filetube-test-stub"; exit 0; fi
last="\${@: -1}"
echo "time=00:00:00.50" >&2
head -c 2048 /dev/zero > "$last"
exit 0
`, { mode: 0o755 });
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-preextract-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  scanDirectories, loadDatabase, saveDatabase, getMediaId, audioPath,
  evictTranscodeCache, sweepAgedTranscodes,
} = require('../../server');

let downloadDir;
let libDir;

before(() => {
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-preextract-dl-'));
  libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-preextract-lib-'));
});

after(() => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  fs.rmSync(downloadDir, { recursive: true, force: true });
  fs.rmSync(libDir, { recursive: true, force: true });
  fs.rmSync(binDir, { recursive: true, force: true });
});

function baseSettings(overrides) {
  return {
    scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null,
    cacheMaxAgeDays: 30, ...overrides,
  };
}

async function waitForSidecar(id, deadlineMs = 8000) {
  const startedAt = Date.now();
  for (;;) {
    if (fs.existsSync(audioPath(id))) return true;
    if (Date.now() - startedAt > deadlineMs) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('setting ON: a fresh yt-dlp-rooted VIDEO gets its .m4a sidecar extracted at scan time; a plain library file does not', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const dlPath = path.join(downloadDir, 'Fresh Download [aaaaaaaaaaa].mp4');
    fs.writeFileSync(dlPath, 'video-bytes');
    const libPath = path.join(libDir, 'Home Movie.mp4');
    fs.writeFileSync(libPath, 'video-bytes');
    saveDatabase({
      folders: [libDir], folderSettings: {}, progress: {}, metadata: {},
      settings: baseSettings({ preExtractAudio: true }),
    });

    await scanDirectories();

    const dlId = getMediaId(dlPath);
    const libId = getMediaId(libPath);
    assert.ok(await waitForSidecar(dlId), 'the downloaded video must get its sidecar without ever being watched');
    assert.equal(loadDatabase().metadata[dlId].audioStatus, 'ready', 'and the persisted status must reflect it');
    await new Promise((r) => setTimeout(r, 200)); // let any (wrong) extra jobs drain
    assert.ok(!fs.existsSync(audioPath(libId)), 'a plain library file is NOT in scope (downloads + played only)');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('setting OFF: no scan-time extraction happens at all (lazy-on-first-watch behavior unchanged)', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const dlPath = path.join(downloadDir, 'Off Setting [bbbbbbbbbbb].mp4');
    fs.writeFileSync(dlPath, 'video-bytes');
    saveDatabase({
      folders: [], folderSettings: {}, progress: {}, metadata: {},
      settings: baseSettings({ preExtractAudio: false }),
    });

    await scanDirectories();
    await new Promise((r) => setTimeout(r, 400));

    assert.ok(!fs.existsSync(audioPath(getMediaId(dlPath))), 'no eager extraction when the setting is off');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('pinning: while ON, .m4a sidecars survive the size-cap eviction and the age sweep; OFF restores normal eviction', () => {
  const TRANSCODE_DIR = path.dirname(audioPath('pin-probe'));
  fs.mkdirSync(TRANSCODE_DIR, { recursive: true });
  const m4a = path.join(TRANSCODE_DIR, 'pinned1111.m4a');
  const mp4 = path.join(TRANSCODE_DIR, 'evictme222.mp4');
  const seed = () => {
    fs.writeFileSync(m4a, Buffer.alloc(4000));
    fs.writeFileSync(mp4, Buffer.alloc(4000));
    const old = Date.now() - 90 * 24 * 60 * 60 * 1000;
    fs.utimesSync(m4a, old / 1000, old / 1000);
    fs.utimesSync(mp4, old / 1000, old / 1000);
  };

  // ON: the mp4 is evictable, the m4a is pinned.
  saveDatabase({
    folders: [], folderSettings: {}, progress: {}, metadata: {},
    settings: baseSettings({ preExtractAudio: true, cacheMaxAgeDays: 1 }),
  });
  seed();
  evictTranscodeCache(1000); // cap far below the combined size
  assert.ok(fs.existsSync(m4a), 'size-cap eviction must skip a pinned sidecar');
  assert.ok(!fs.existsSync(mp4), 'the mp4 is still evicted normally');
  seed();
  sweepAgedTranscodes(Date.now());
  assert.ok(fs.existsSync(m4a), 'the age sweep must skip a pinned sidecar');
  assert.ok(!fs.existsSync(mp4), 'the aged mp4 still sweeps');

  // OFF: the m4a becomes an ordinary cache entry again.
  saveDatabase({
    folders: [], folderSettings: {}, progress: {}, metadata: {},
    settings: baseSettings({ preExtractAudio: false, cacheMaxAgeDays: 1 }),
  });
  seed();
  sweepAgedTranscodes(Date.now());
  assert.ok(!fs.existsSync(m4a), 'turning the setting OFF un-pins (normal age sweep applies)');
});
