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
// remove them on process exit. It is wired into `npm test`/`test:unit` as
// `node --require ./test/helpers/tmp-cleanup.js` (see package.json).
//
// WHY `--require` and NOT `NODE_OPTIONS` - this is the load-bearing choice, so
// the comment must not lie about it: `--require` propagates only to node:test's
// own per-file worker processes, which is exactly the set that leaks the
// DATA_DIRs. `NODE_OPTIONS="--require ..."` would additionally reach any node
// CLI a test SPAWNS itself - and such a CLI may mkdtemp a `filetube-` dir the
// parent test still needs to inspect AFTER the child exits, which this exit
// hook would then delete out from under it. So spawned CLIs are deliberately
// left untouched here; a CLI that leaks its own tmpDir cleans up itself (see
// scripts/migrate-check.js's process.on('exit'), the fix for exactly that).
//
// Cleaning on the worker's exit keeps the live temp-dir set bounded to roughly
// the concurrency at any instant during a run - stopping the mid-run
// accumulation, not just the cross-run buildup.
//
// It is additive and idempotent: a file that already has its own after()
// cleanup still works (rmSync with force:true double-removing is a no-op), and
// a file that cleans nothing is now covered. Only `filetube-`-prefixed dirs
// UNDER the OS tmp root are tracked (enforced below, not merely asserted) -
// never anything a test explicitly created elsewhere, since this hook does an
// rm -rf.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TRACK_PREFIX = 'filetube-';
// The tmp root AS THE TESTS SEE IT - the same os.tmpdir() they pass to
// path.join(). Deliberately NOT realpath-resolved: on a box where /tmp is a
// symlink, the dir mkdtemp returns has dirname === os.tmpdir() (the symlink
// path), which a realpath'd root would fail to match, silently tracking
// nothing and re-opening the leak.
const TMP_ROOT = os.tmpdir();
const created = new Set();

// Track a dir only if it is a `filetube-` entry DIRECTLY under the OS tmp root.
// The containment check makes the rm -rf that fires at exit provably unable to
// touch anything outside the tmp root, even if a test elsewhere happens to use
// the same prefix (the adversarial slim-gate caught the comment claiming this
// guard while the code only checked the prefix).
function track(dir) {
  if (typeof dir === 'string'
      && path.dirname(dir) === TMP_ROOT
      && path.basename(dir).startsWith(TRACK_PREFIX)) {
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
