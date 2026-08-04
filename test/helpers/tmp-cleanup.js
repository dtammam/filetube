'use strict';

// Residual #110 fix: the test suite leaked its mkdtemp DATA_DIRs. ~83 of the
// 182 files that `fs.mkdtempSync(os.tmpdir()/'filetube-...')` never removed
// them, so a run left ~150 throwaway dirs behind and they accumulated across
// runs - this session they reached ~1.05M dirs / 91% inodes and thrashed the
// overlay filesystem's journal badly enough to HANG the parallel suite (and
// the pre-push hook that runs it).
//
// Rather than edit 83 files, this preload patches mkdtempSync ONCE, per test
// child process, to record every `filetube-`-prefixed temp dir it creates and
// remove them on process exit. node:test runs each test file in its own
// child; wiring this via NODE_OPTIONS (see package.json `pretest`/scripts)
// means every child cleans up after ITSELF the moment it exits. That keeps the
// live temp-dir set bounded to roughly the concurrency (a handful) at any
// instant DURING a run - which is what stops the mid-run accumulation, not
// just the cross-run buildup.
//
// It is additive and idempotent: a file that already has its own after()
// cleanup still works (rmSync with force:true double-removing is a no-op), and
// a file that cleans nothing is now covered. Only dirs matching our own
// prefix under the OS tmp root are tracked - never anything a test explicitly
// created elsewhere.

const fs = require('node:fs');
const path = require('node:path');

const TRACK_PREFIX = 'filetube-';
const created = new Set();

function track(dir) {
  if (typeof dir === 'string' && path.basename(dir).startsWith(TRACK_PREFIX)) {
    created.add(dir);
  }
  return dir;
}

const realMkdtempSync = fs.mkdtempSync;
fs.mkdtempSync = function mkdtempSync(prefix, options) {
  return track(realMkdtempSync.call(this, prefix, options));
};

// Also cover the async/promise flavors, in case a test uses them.
const realMkdtemp = fs.mkdtemp;
if (typeof realMkdtemp === 'function') {
  fs.mkdtemp = function mkdtemp(prefix, options, cb) {
    const callback = typeof options === 'function' ? options : cb;
    const opts = typeof options === 'function' ? undefined : options;
    return realMkdtemp.call(this, prefix, opts, (err, dir) => {
      if (!err) track(dir);
      callback(err, dir);
    });
  };
}
if (fs.promises && typeof fs.promises.mkdtemp === 'function') {
  const realMkdtempP = fs.promises.mkdtemp;
  fs.promises.mkdtemp = function mkdtemp(prefix, options) {
    return realMkdtempP.call(this, prefix, options).then(track);
  };
}

// Synchronous exit hook: 'exit' cannot await, and rmSync is synchronous, so
// this reliably runs during the process's final tick. Best-effort - a failure
// to remove a temp dir must never fail a test run.
process.on('exit', () => {
  for (const dir of created) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {
      /* best-effort: the dir may already be gone (the file's own after() got it) */
    }
  }
});
