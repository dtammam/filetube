'use strict';

// [UNIT] Residual #110 fix - the test-suite tmp-cleanup preload
// (test/helpers/tmp-cleanup.js), wired into `npm test`/`test:unit` via
// `node --require`.
//
// The suite leaked its mkdtemp DATA_DIRs (~83 of 182 files never removed them),
// which accumulated to ~1M dirs / 91% inodes this session and thrashed the
// overlay filesystem badly enough to HANG the parallel run. The preload patches
// mkdtempSync per test child to track `filetube-`-prefixed temp dirs and remove
// them on process exit.
//
// Cleanup fires on process EXIT, so this is proven the only honest way: spawn a
// real child that preloads the helper, creates dirs, and exits - then assert
// from the parent what survived. Two claims: (1) a `filetube-` temp dir is gone
// after the child exits; (2) a differently-prefixed temp dir is left ALONE (we
// only ever remove our own throwaway dirs, never something a test meant to
// keep).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HELPER = path.join(__dirname, '..', 'helpers', 'tmp-cleanup.js');

// A child that: creates one filetube- dir (should be auto-removed on exit) and
// one other- dir (should survive), drops a file inside the filetube- dir to
// prove recursive removal, and prints both paths.
const CHILD = `
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const gone = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-cleanuptest-'));
fs.writeFileSync(path.join(gone, 'nested.txt'), 'x'); // prove recursive rm
const kept = fs.mkdtempSync(path.join(os.tmpdir(), 'other-cleanuptest-'));
process.stdout.write(JSON.stringify({ gone, kept }));
`;

test('the preload removes filetube- temp dirs on process exit, and leaves others alone', () => {
  const out = execFileSync(process.execPath, ['--require', HELPER, '-e', CHILD], { encoding: 'utf8' });
  const { gone, kept } = JSON.parse(out);

  assert.equal(fs.existsSync(gone), false,
    'the filetube- temp dir (with nested content) must be recursively removed when the child exits');
  assert.equal(fs.existsSync(kept), true,
    'a non-filetube temp dir must be left untouched - the preload only cleans its own throwaway dirs');

  fs.rmSync(kept, { recursive: true, force: true }); // this test cleans up after itself
});

test('WITHOUT the preload the same child leaks its filetube- dir (proves the preload is what cleans)', () => {
  // The mutation-proof: the exact same child, minus the --require, leaves the
  // dir behind. If this ever starts passing WITH the dir gone, the leak got
  // fixed somewhere else and this lock is measuring nothing.
  const out = execFileSync(process.execPath, ['-e', CHILD], { encoding: 'utf8' });
  const { gone, kept } = JSON.parse(out);
  try {
    assert.equal(fs.existsSync(gone), true, 'without the preload the filetube- dir leaks (the bug the preload fixes)');
  } finally {
    fs.rmSync(gone, { recursive: true, force: true });
    fs.rmSync(kept, { recursive: true, force: true });
  }
});

test('the helper loads cleanly as a preload (no throw, patches mkdtempSync)', () => {
  // A require-time throw in the preload would fail EVERY node --test child at
  // once (it applies to the parent too) - exactly the failure that must never
  // ship in a file wired into the test command.
  const out = execFileSync(
    process.execPath,
    ['--require', HELPER, '-e', 'console.log(typeof require("node:fs").mkdtempSync)'],
    { encoding: 'utf8' }
  ).trim();
  assert.equal(out, 'function', 'mkdtempSync stays callable after the patch');
});
