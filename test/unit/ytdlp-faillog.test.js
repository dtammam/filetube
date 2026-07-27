'use strict';

// [UNIT] v1.47.4 item 7 -- lib/ytdlp/faillog.js, the durable per-failure log.
//
// Dean: "If any downloads fail I'd like it to be explicitly logged and have the
// error so one can look in posterity. It should be able to be cleared/deleted
// as well."
//
// This store can DELETE user-visible records, so per the repo's destructive-work
// norm it is tested against a real temp filesystem (never mocked fs), and the
// delete/clear paths are asserted for what they must NOT destroy as much as for
// what they must.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const faillog = require('../../lib/ytdlp/faillog');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-faillog-'));
}

function failure(overrides = {}) {
  return {
    source: 'one-off',
    videoId: 'vid1',
    title: 'Some Video',
    url: 'https://www.youtube.com/watch?v=vid1',
    reason: 'ERROR: Unable to download video subtitles',
    ...overrides,
  };
}

// ---- no-op / disabled-module guarantees ------------------------------------

test('a read against a missing file returns [] and NEVER creates the file', () => {
  const dir = tmpDir();
  assert.deepEqual(faillog.readFailures(dir), []);
  // R0.7: merely reading must stay a pure no-op, so a yt-dlp-less install never
  // grows stray files in its data dir.
  assert.equal(fs.readdirSync(dir).length, 0, 'read must not create the log file');
});

test('recordFailures is a silent no-op for a bad dataDir or an empty/non-array input', () => {
  const dir = tmpDir();
  for (const bad of [undefined, null, '', 42, {}]) {
    assert.equal(faillog.recordFailures(bad, [failure()]), 0);
  }
  for (const bad of [undefined, null, [], 'nope', {}, [null, undefined, 'x']]) {
    assert.equal(faillog.recordFailures(dir, bad), 0, `${JSON.stringify(bad)} must record nothing`);
  }
  assert.equal(fs.readdirSync(dir).length, 0);
});

// ---- record + read ----------------------------------------------------------

test('recordFailures persists the VERBATIM reason and reads back newest-first', () => {
  const dir = tmpDir();
  assert.equal(faillog.recordFailures(dir, [failure({ videoId: 'first', reason: 'first error' })]), 1);
  assert.equal(faillog.recordFailures(dir, [failure({ videoId: 'second', reason: 'second error' })]), 1);
  const rows = faillog.readFailures(dir);
  assert.equal(rows.length, 2);
  // Newest-first is this module's contract (unlike runlog.readRuns, which hands
  // back on-disk order) so no caller has to remember to reverse it.
  assert.equal(rows[0].videoId, 'second');
  assert.equal(rows[1].videoId, 'first');
  assert.equal(rows[0].reason, 'second error', 'the operator needs the real error text, not a summary');
});

test('every entry gets a unique id, even within one batch sharing a millisecond', () => {
  const dir = tmpDir();
  // Timestamp-derived ids would collide here, and a collision would make one
  // row delete the other.
  faillog.recordFailures(dir, [failure({ videoId: 'a' }), failure({ videoId: 'b' }), failure({ videoId: 'c' })], 1700000000000);
  const rows = faillog.readFailures(dir);
  const ids = new Set(rows.map((r) => r.id));
  assert.equal(rows.length, 3);
  assert.equal(ids.size, 3, 'ids must be unique within a single batch');
  assert.ok(rows.every((r) => typeof r.id === 'string' && r.id.length > 0));
});

test('source is constrained to the known set (a typo can never create an unfilterable category)', () => {
  const dir = tmpDir();
  faillog.recordFailures(dir, [
    failure({ source: 'subscription' }),
    failure({ source: 'one-off' }),
    failure({ source: 'nonsense' }),
    failure({ source: undefined }),
    failure({ source: { evil: true } }),
  ]);
  for (const row of faillog.readFailures(dir)) {
    assert.ok(['one-off', 'subscription'].includes(row.source), `unexpected source ${JSON.stringify(row.source)}`);
  }
});

test('a missing reason is recorded honestly rather than dropped', () => {
  const dir = tmpDir();
  faillog.recordFailures(dir, [failure({ reason: undefined })]);
  const [row] = faillog.readFailures(dir);
  // The row must still exist -- the failure DID happen, and silently omitting
  // it would under-report exactly what this log is for.
  assert.match(row.reason, /Unknown error/);
});

test('control characters are stripped and fields are bounded at the storage boundary', () => {
  const dir = tmpDir();
  const hostile = 'a\x00\x1b[31mb\x7f' + 'x'.repeat(5000);
  faillog.recordFailures(dir, [failure({ reason: hostile, title: hostile })]);
  const [row] = faillog.readFailures(dir);
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(row.reason, /[\x00-\x1f\x7f]/, 'terminal escapes must never be persisted');
  assert.ok(row.reason.length <= faillog.MAX_FIELD_LENGTH);
  assert.ok(row.title.length <= faillog.MAX_FIELD_LENGTH);
});

test('the on-disk file is capped, oldest falling off the front', () => {
  const dir = tmpDir();
  const over = faillog.YTDLP_FAILLOG_MAX_ENTRIES + 25;
  faillog.recordFailures(dir, Array.from({ length: over }, (_, i) => failure({ videoId: `v${i}` })));
  const rows = faillog.readFailures(dir);
  assert.equal(rows.length, faillog.YTDLP_FAILLOG_MAX_ENTRIES, 'exact cap, not best-effort');
  // Newest-first, so the newest id must be the LAST one recorded.
  assert.equal(rows[0].videoId, `v${over - 1}`);
  const onDisk = fs.readFileSync(path.join(dir, 'ytdlp-failures.jsonl'), 'utf8').trim().split('\n');
  assert.equal(onDisk.length, faillog.YTDLP_FAILLOG_MAX_ENTRIES, 'the CAP is enforced on disk, not just on read');
});

// ---- defensive read ---------------------------------------------------------

test('a corrupt/partial/hostile file degrades to the salvageable lines, never throws', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'ytdlp-failures.jsonl');
  fs.writeFileSync(file, [
    '{"id":"keep1","ts":"2026-07-27T00:00:00.000Z","source":"one-off","reason":"fine"}',
    'not json at all',
    '{"id":"trunc","ts":"2026',     // half-written line, e.g. a killed process
    '[1,2,3]',                       // valid JSON, wrong shape
    'null',
    '{"no":"id"}',                   // unaddressable -> must not be surfaced
    '{"id":"keep2","ts":"2026-07-27T00:00:01.000Z","source":"subscription","reason":"also fine"}',
  ].join('\n') + '\n', 'utf8');
  let rows;
  assert.doesNotThrow(() => { rows = faillog.readFailures(dir); });
  assert.deepEqual(rows.map((r) => r.id), ['keep2', 'keep1']);
});

test('an id-less entry is never surfaced (it could never be deleted)', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'ytdlp-failures.jsonl'), '{"reason":"orphan"}\n', 'utf8');
  // Surfacing it would put a permanently-undeletable row in a list whose entire
  // purpose is being clearable.
  assert.deepEqual(faillog.readFailures(dir), []);
});

// ---- delete (destructive -- full-gate territory) ---------------------------

test('deleteFailure removes EXACTLY the addressed entry and leaves the rest byte-intact', () => {
  const dir = tmpDir();
  faillog.recordFailures(dir, [failure({ videoId: 'a' }), failure({ videoId: 'b' }), failure({ videoId: 'c' })]);
  const before = faillog.readFailures(dir);
  const target = before.find((r) => r.videoId === 'b');
  assert.equal(faillog.deleteFailure(dir, target.id), true);
  const after = faillog.readFailures(dir);
  assert.equal(after.length, 2);
  assert.ok(!after.some((r) => r.id === target.id), 'the target is gone');
  // The survivors must be untouched, field for field -- a delete must never
  // rewrite or re-mint neighbouring rows.
  assert.deepEqual(after, before.filter((r) => r.id !== target.id));
});

test('deleteFailure with an unknown/stale/malformed id destroys NOTHING and does not rewrite', () => {
  const dir = tmpDir();
  faillog.recordFailures(dir, [failure({ videoId: 'a' }), failure({ videoId: 'b' })]);
  const file = path.join(dir, 'ytdlp-failures.jsonl');
  const bytesBefore = fs.readFileSync(file);
  const mtimeBefore = fs.statSync(file).mtimeMs;
  for (const bad of ['no-such-id', '', null, undefined, 42, {}]) {
    assert.equal(faillog.deleteFailure(dir, bad), false, `${JSON.stringify(bad)} must delete nothing`);
  }
  assert.deepEqual(fs.readFileSync(file), bytesBefore, 'the file must be byte-identical');
  assert.equal(fs.statSync(file).mtimeMs, mtimeBefore, 'a no-match must not rewrite the file at all');
  assert.equal(faillog.readFailures(dir).length, 2);
});

test('deleteFailure on a bad dataDir is a no-op, never a throw', () => {
  for (const bad of [undefined, null, '', 42]) {
    assert.doesNotThrow(() => faillog.deleteFailure(bad, 'some-id'));
    assert.equal(faillog.deleteFailure(bad, 'some-id'), false);
  }
});

// ---- clear (destructive) ----------------------------------------------------

test('clearFailures empties the log and reports the REAL removed count', () => {
  const dir = tmpDir();
  faillog.recordFailures(dir, [failure(), failure(), failure()]);
  assert.equal(faillog.clearFailures(dir), 3, 'the caller must report a real count, never an assumed one');
  assert.deepEqual(faillog.readFailures(dir), []);
});

test('clearFailures on an already-empty/missing log reports 0 and does not create the file', () => {
  const dir = tmpDir();
  assert.equal(faillog.clearFailures(dir), 0);
  assert.equal(fs.readdirSync(dir).length, 0, 'clearing nothing must not materialize a file');
});

test('clearFailures TRUNCATES rather than unlinking (preserves the file, so permissions survive)', () => {
  const dir = tmpDir();
  faillog.recordFailures(dir, [failure()]);
  const file = path.join(dir, 'ytdlp-failures.jsonl');
  fs.chmodSync(file, 0o600);
  faillog.clearFailures(dir);
  // An unlink-then-recreate would silently reset ownership/permissions; keeping
  // the inode's mode is the reason this writes an empty file instead.
  assert.ok(fs.existsSync(file), 'the file must survive a clear');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'permissions must survive a clear');
  assert.equal(fs.readFileSync(file, 'utf8'), '');
});

test('the log survives a clear followed by fresh records (no wedged state)', () => {
  const dir = tmpDir();
  faillog.recordFailures(dir, [failure({ videoId: 'old' })]);
  faillog.clearFailures(dir);
  assert.equal(faillog.recordFailures(dir, [failure({ videoId: 'new' })]), 1);
  const rows = faillog.readFailures(dir);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].videoId, 'new');
});

// ---- item 1 (L3) integration point -----------------------------------------

test('subtitleFallback is preserved so a caption-less-but-downloaded item reads honestly', () => {
  const dir = tmpDir();
  faillog.recordFailures(dir, [failure({ subtitleFallback: true }), failure({})]);
  const rows = faillog.readFailures(dir);
  const withFallback = rows.find((r) => r.subtitleFallback === true);
  assert.ok(withFallback, 'the flag must survive persistence');
  // Strictly `=== true`: the flag changes what the UI CLAIMS happened ("saved
  // without captions" vs "download failed"), so a truthy-ish value must not
  // silently upgrade a real failure into a partial success.
  assert.equal(rows.filter((r) => r.subtitleFallback === true).length, 1);
});

// ---- v1.47.4 gate delta (adversarial SUGGESTION): honest return count ------

test('recordFailures reports what SURVIVED the cap, not what it was handed', () => {
  // The return value used to be `normalized.length`, which lied whenever a
  // batch pushed the file past its cap: handing it 1500 against a 1000 cap
  // claimed 1500 while 1000 were on disk. A caller reporting that to a user
  // would overstate what was kept.
  const dir = tmpDir();
  const over = faillog.YTDLP_FAILLOG_MAX_ENTRIES + 500;
  const claimed = faillog.recordFailures(dir, Array.from({ length: over }, (_, i) => failure({ videoId: `v${i}` })));
  assert.equal(claimed, faillog.YTDLP_FAILLOG_MAX_ENTRIES, 'the count must match the cap, not the input size');
  assert.equal(faillog.readFailures(dir).length, claimed, 'claimed count == what is actually readable');
});

test('recordFailures still reports the exact count for an ordinary under-cap batch', () => {
  const dir = tmpDir();
  assert.equal(faillog.recordFailures(dir, [failure(), failure(), failure()]), 3);
  assert.equal(faillog.readFailures(dir).length, 3);
});
