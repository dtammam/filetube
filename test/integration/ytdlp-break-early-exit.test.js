'use strict';

// [INTEGRATION] v1.36 F1: yt-dlp's exit code 101 -- its documented "aborted
// on purpose by a --break-* condition" code -- must read as SUCCESS for the
// break-early LIST pass (the JSON already printed IS the complete
// post-cutoff listing) and remain a FAILURE everywhere else. Exercised
// against a REAL spawned child via a fake `yt-dlp` on PATH (the same
// stub-binary-on-PATH harness transcode-execution.test.js uses for ffmpeg --
// CI has no yt-dlp either), because the 101 mapping lives in spawnYtdlp's
// close handler and monkey-patching runList would bypass exactly the code
// under test.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

// The fake binary: prints two NDJSON video lines (what a real break-early
// listing leaves on stdout) then exits with the code named by its LAST arg
// -- each test picks the exit code via the positional URL, so one stub
// serves every case.
const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-fake-ytdlp-'));
fs.writeFileSync(path.join(binDir, 'yt-dlp'), `#!/bin/bash
echo '{"id":"newvid1","availability":"public"}'
echo '{"id":"newvid2","availability":"public"}'
last="\${@: -1}"
if [[ "$last" == *"exit101"* ]]; then exit 101; fi
if [[ "$last" == *"exit1"* ]]; then exit 1; fi
exit 0
`, { mode: 0o755 });
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

const { test, after } = require('node:test');
const assert = require('node:assert');

const run = require('../../lib/ytdlp/run');

after(() => {
  fs.rmSync(binDir, { recursive: true, force: true });
});

test('v1.36 F1: spawnYtdlp with breakExitOk:true maps exit 101 to ok:true with stdout intact (code passed through verbatim)', async () => {
  const result = await run.spawnYtdlp(['--dump-json', '--', 'https://example.com/exit101'], { breakExitOk: true, timeoutMs: 30000 });
  assert.equal(result.ok, true, 'a break-early stop is a SUCCESS for the list pass');
  assert.equal(result.code, 101, 'the caller can still distinguish "stopped at the cutoff" from "ran to the end"');
  assert.ok(result.stdout.includes('"newvid1"') && result.stdout.includes('"newvid2"'), 'the JSON printed before the break must survive');
});

test('v1.36 F1: WITHOUT breakExitOk, exit 101 stays a failure -- the opt-in never leaks to other spawn callers (e.g. the download pass)', async () => {
  const result = await run.spawnYtdlp(['--dump-json', '--', 'https://example.com/exit101'], { timeoutMs: 30000 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 101);
  assert.match(result.error, /exited with code 101/);
});

test('v1.36 F1: breakExitOk maps ONLY 101 -- a genuine exit 1 is still a failure even on the break-early list path', async () => {
  const result = await run.spawnYtdlp(['--dump-json', '--', 'https://example.com/exit1'], { breakExitOk: true, timeoutMs: 30000 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 1);
});

test('v1.36 F1: runList end-to-end -- a break-early exit 101 yields ok:true and a parseable listing (runList opts carry breakExitOk)', async () => {
  const sub = { channelUrl: 'https://www.youtube.com/@exit101', cutoffDate: '20260710', format: 'video', quality: 'best' };
  const config = { downloadDir: fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-break-dl-')) };
  const result = await run.runList(sub, config);
  assert.equal(result.ok, true, 'runList must treat the break-early stop as success');
  assert.ok(result.stdout.includes('"newvid1"'), 'the listing must be intact for parseYtdlpVideoList');
  fs.rmSync(config.downloadDir, { recursive: true, force: true });
});

test('v1.36 F1: exit 0 (listing ran to the end, nothing pre-cutoff encountered) is unchanged -- still ok:true, code 0', async () => {
  const result = await run.spawnYtdlp(['--dump-json', '--', 'https://example.com/clean'], { breakExitOk: true, timeoutMs: 30000 });
  assert.equal(result.ok, true);
  assert.equal(result.code, 0);
});
