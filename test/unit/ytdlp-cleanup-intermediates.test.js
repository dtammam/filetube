'use strict';

// [UNIT] v1.15.1 hotfix -- lib/ytdlp/index.js's `cleanupFailedDownloadIntermediates`,
// tested directly (fs-only, no spawn/mocking needed) rather than only
// indirectly through runPoll/runOneShot (see test/integration/ytdlp-poll.test.js
// and test/integration/ytdlp-oneshot.test.js for the end-to-end proof that
// this actually runs on a failed download).

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const { cleanupFailedDownloadIntermediates } = require('../../lib/ytdlp');

test('cleanupFailedDownloadIntermediates removes yt-dlp intermediates but leaves a completed file and unrelated files untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cleanup-'));
  const finalPath = path.join(dir, 'Already Downloaded [dQw4w9WgXcQ].mp4');
  const fragmentPath = path.join(dir, 'Killed Video [wSx0Or20MZE].f399.mp4');
  const audioFragmentPath = path.join(dir, 'Killed Video [wSx0Or20MZE].f251.webm');
  const mergeTempPath = path.join(dir, 'Killed Video [wSx0Or20MZE].temp.mp4');
  const partPath = path.join(dir, 'Killed Video [wSx0Or20MZE].mp4.part');
  const ytdlPath = path.join(dir, 'Killed Video [wSx0Or20MZE].mp4.ytdl');
  const unrelatedPath = path.join(dir, '.ytdlp-archive.txt');
  for (const p of [finalPath, fragmentPath, audioFragmentPath, mergeTempPath, partPath, ytdlPath, unrelatedPath]) {
    fs.writeFileSync(p, 'bytes');
  }

  const removed = cleanupFailedDownloadIntermediates(dir);

  assert.equal(removed, 5, 'exactly the 5 intermediate files should be removed');
  for (const p of [fragmentPath, audioFragmentPath, mergeTempPath, partPath, ytdlPath]) {
    assert.equal(fs.existsSync(p), false, `${p} should have been removed`);
  }
  assert.equal(fs.existsSync(finalPath), true, 'a completed/final file must never be removed');
  assert.equal(fs.existsSync(unrelatedPath), true, 'an unrelated module file must never be removed');
});

// v1.15.1 hotfix-2 (CRITICAL data-loss regression test): a REAL user file
// that merely shares a suffix shape with a yt-dlp intermediate -- but lacks
// yt-dlp's own " [<id>]" bracket -- must SURVIVE a failed-download cleanup
// sweep of its directory. Pre-fix, every one of these was wrongly deleted.
test('cleanupFailedDownloadIntermediates never deletes a bracket-less lookalike file (no yt-dlp id bracket)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cleanup-bracketless-'));
  const lookalikePaths = [
    path.join(dir, 'Vacation.f2.mp4'),
    path.join(dir, 'Draft.temp.mp4'),
    path.join(dir, 'notes.part'),
    path.join(dir, 'data.ytdl'),
    path.join(dir, 'My.Video.2024.mp4'),
    path.join(dir, 'Episode.4.mp4'),
    path.join(dir, 'song.remix.mp3'),
  ];
  for (const p of lookalikePaths) {
    fs.writeFileSync(p, 'bytes');
  }

  const removed = cleanupFailedDownloadIntermediates(dir);

  assert.equal(removed, 0, 'no bracket-less file should ever be removed');
  for (const p of lookalikePaths) {
    assert.equal(fs.existsSync(p), true, `${p} (a real file with no yt-dlp id bracket) must survive cleanup`);
  }
});

test('cleanupFailedDownloadIntermediates on a missing/unreadable directory never throws and returns 0', () => {
  const missingDir = path.join(os.tmpdir(), `filetube-ytdlp-cleanup-missing-${Date.now()}`);
  assert.doesNotThrow(() => {
    const removed = cleanupFailedDownloadIntermediates(missingDir);
    assert.equal(removed, 0);
  });
});

test('cleanupFailedDownloadIntermediates on an empty directory removes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-cleanup-empty-'));
  assert.equal(cleanupFailedDownloadIntermediates(dir), 0);
});
