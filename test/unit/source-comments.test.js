'use strict';

// [UNIT] v1.394.0 W2: the comments snapshot rules (lib/media/sourceComments.js) and the download
// argv (lib/ytdlp/args.js). Fixtures are the REAL lines the pinned yt-dlp printed on the dev box
// (test/fixtures/ytdlp-comments/README.md), never hand-typed shapes, plus divergent hand-made
// inputs only where the rule needs one (partial, zero, hostile).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const SC = require('../../lib/media/sourceComments');
const args = require('../../lib/ytdlp/args');
const run = require('../../lib/ytdlp/run');

const FIX = path.join(__dirname, '..', 'fixtures', 'ytdlp-comments');
const REAL_LINE = fs.readFileSync(path.join(FIX, 'ftcomments-jNQXAC9IVRw.txt'), 'utf8').trim();
const DISABLED_LINE = fs.readFileSync(path.join(FIX, 'ftcomments-disabled-injected.txt'), 'utf8').trim();
const REAL = JSON.parse(REAL_LINE.slice('FTCOMMENTS '.length));
const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

// ---- R9: decideSnapshot -------------------------------------------------------------------

test('decideSnapshot: the real line (10 comments, comment_count 10) is an ok snapshot of 10', () => {
  const s = SC.decideSnapshot(REAL, NOW);
  assert.strictEqual(s.state, 'ok');
  assert.strictEqual(s.comments.length, 10);
  assert.strictEqual(s.fetchedAt, new Date(NOW).toISOString());
  assert.strictEqual(s.comments[0].isPinned, true, 'the pinned comment comes first and counts toward the 10 (R5)');
});

test('decideSnapshot: the comments-off shape (both keys absent, measured) is the disabled state', () => {
  const s = SC.decideSnapshot(JSON.parse(DISABLED_LINE.slice('FTCOMMENTS '.length)), NOW);
  assert.deepStrictEqual(s, { state: 'disabled', fetchedAt: new Date(NOW).toISOString(), comments: [] });
  assert.strictEqual(SC.decideSnapshot({ id: 'x', comments: null, comment_count: null }, NOW).state, 'disabled', 'null reads as absent (a dump keeps None out too)');
});

test('decideSnapshot: R9 keeps the stored snapshot (null) for interrupted, zero, short-count and malformed shapes', () => {
  const partial = { ...REAL, comment_count: null }; // interrupted / an error swallowed under --ignore-errors
  assert.strictEqual(SC.decideSnapshot(partial, NOW), null, 'interrupted');
  assert.strictEqual(SC.decideSnapshot({ id: 'x', comments: [], comment_count: 0 }, NOW), null, 'zero comments');
  assert.strictEqual(SC.decideSnapshot({ id: 'x', comments: REAL.comments, comment_count: 3 }, NOW), null, 'a count below the list length is not a clean fetch');
  assert.strictEqual(SC.decideSnapshot({ id: 'x', comments: 'nope', comment_count: 1 }, NOW), null);
  assert.strictEqual(SC.decideSnapshot({ id: 'x', comment_count: 12 }, NOW), null, 'a count with no list (the page total, comments not fetched)');
  assert.strictEqual(SC.decideSnapshot({ id: 'x', comments: [{ text: '' }], comment_count: 1 }, NOW), null, 'nothing usable survives sanitizing');
  assert.strictEqual(SC.decideSnapshot(null, NOW), null);
});

// ---- sanitizing ---------------------------------------------------------------------------

test('sanitize: only the rendered fields are kept - never author_url, author_thumbnail, author_id', () => {
  const s = SC.decideSnapshot(REAL, NOW);
  const allowed = new Set(['id', 'text', 'author', 'likeCount', 'isPinned', 'isUploader', 'timestamp', 'timeText']);
  for (const c of s.comments) for (const k of Object.keys(c)) assert.ok(allowed.has(k), 'unexpected key ' + k);
  assert.ok(REAL.comments[0].author_url && REAL.comments[0].author_thumbnail, 'precondition: the real line carries them');
  assert.ok(!JSON.stringify(s).includes('yt3.ggpht') && !JSON.stringify(s).includes('/channel/'), 'no third-party image or channel link survives');
});

test('sanitize: replies are dropped (top-level only), at most 10, text capped, controls stripped, the byte cap holds', () => {
  const many = Array.from({ length: 15 }, (_, i) => ({ id: 'c' + i, text: 'x'.repeat(5000) + '\u0000\u0007\n', author: 'a‮', parent: i === 0 ? 'abc' : 'root', like_count: i }));
  const s = SC.decideSnapshot({ comments: many, comment_count: 15 }, NOW);
  assert.ok(s.comments.every((c) => c.id !== 'c0'), 'the reply is gone');
  assert.ok(s.comments.length <= SC.MAX_COMMENTS);
  assert.ok(s.comments.every((c) => c.text.length <= SC.MAX_TEXT && !c.text.includes('\u0000') && !c.text.includes('\u0007')));
  assert.ok(Buffer.byteLength(JSON.stringify(s.comments)) <= SC.MAX_PAYLOAD_BYTES);
});

test('sanitize: an implausible timestamp or like count is dropped, never stored', () => {
  const s = SC.decideSnapshot({ comments: [{ text: 'hi', timestamp: 1e15, like_count: -5 }, { text: 'yo', timestamp: 100, like_count: 1.5 }], comment_count: 2 }, NOW);
  for (const c of s.comments) { assert.strictEqual(c.timestamp, undefined); assert.strictEqual(c.likeCount, undefined); }
});

test('sanitizeSnapshot: re-validates a stored shape (camelCase) identically, and refuses an empty ok', () => {
  const s = SC.decideSnapshot(REAL, NOW);
  assert.deepStrictEqual(SC.sanitizeSnapshot(s, NOW), s, 'idempotent');
  assert.strictEqual(SC.sanitizeSnapshot({ ...s, comments: [] }, NOW), null);
  assert.strictEqual(SC.sanitizeSnapshot({ ...s, state: 'nope' }, NOW), null);
  assert.strictEqual(SC.sanitizeSnapshot({ ...s, fetchedAt: '2099-01-01T00:00:00Z' }, NOW), null, 'a fetch time in the future');
});

// ---- the stdout line ----------------------------------------------------------------------

test('parseCommentsLine: the real line parses; other lines are not ours', () => {
  const p = run.parseCommentsLine(REAL_LINE, NOW);
  assert.strictEqual(p.videoId, 'jNQXAC9IVRw');
  assert.strictEqual(p.snapshot.comments.length, 10);
  assert.strictEqual(run.parseCommentsLine('FTCHMETA {"id":"x"}'), null);
  assert.deepStrictEqual(run.parseCommentsLine('FTCOMMENTS {not json'), { videoId: null, snapshot: null });
});

test('the real line is longer than the 4096 stderr cap, and the stdout cap admits it (the inert-feature trap)', () => {
  assert.ok(REAL_LINE.length > 4096, 'precondition: measured 5.7 KB');
  assert.ok(run.STDOUT_LINE_LIMIT >= 1024 * 1024);
});

// ---- the download argv --------------------------------------------------------------------

const ytElements = (argv) => argv.filter((v, i) => argv[i - 1] === '--extractor-args' && v.startsWith('youtube:'));
const build = (opts, cfg, sub) => args.buildYtdlpDownloadArgs({ format: 'video', ...(sub || {}) }, { downloadDir: '/tmp/ft-sc-args', ...(cfg || {}) }, ['jNQXAC9IVRw'], opts);

test('argv: comments on -> ONE youtube --extractor-args element with skip, the player client, max_comments and comment_sort', () => {
  const argv = build({ saveComments: true }, { playerClient: 'web' });
  const yt = ytElements(argv);
  assert.strictEqual(yt.length, 1, 'exactly one youtube element (a second one REPLACES the first)');
  assert.strictEqual(argv.filter((v) => v === '--extractor-args').length, 1);
  const parts = yt[0].slice('youtube:'.length).split(';');
  for (const want of ['skip=translated_subs', 'player_client=web', 'max_comments=10,all,0', 'comment_sort=top']) assert.ok(parts.includes(want), want);
  assert.ok(argv.includes('--get-comments'));
  assert.ok(argv.includes('--no-write-info-json'), 'never an info.json (yt-dlp would turn it on for --get-comments)');
  assert.ok(argv.includes(args.COMMENTS_PRINT_TEMPLATE));
  assert.ok(argv.indexOf(args.COMMENTS_PRINT_TEMPLATE) < argv.indexOf('--'), 'before the targets');
});

test('argv: R7 off, an audio download, the universal lane and the stripped retry carry none of it', () => {
  const none = (argv, why) => {
    assert.ok(!argv.includes('--get-comments'), why);
    assert.ok(!argv.some((v) => /FTCOMMENTS|max_comments|comment_sort/.test(v)), why);
    assert.strictEqual(ytElements(argv).length, 1, why + ': the youtube element itself stays');
  };
  none(build({ saveComments: false }), 'R7 off');
  none(build({}), 'unset');
  none(build({ saveComments: true }, {}, { format: 'audio' }), 'audio');
  none(build({ saveComments: true, skipComments: true }), 'the retry');
  none(args.buildYtdlpDownloadArgs({ format: 'video' }, { downloadDir: '/tmp/ft-sc-args' }, [], { saveComments: true, oneOff: true, sourceUrl: 'https://vimeo.com/123456' }), 'universal');
});

// ---- the table: schema v38 and the store ------------------------------------------------------

const os = require('node:os');
const { SqliteAdapter, SQLITE_FILENAME, SCHEMA_VERSION } = require('../../lib/db/sqlite');

function freshAdapter() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-sc-db-'));
  return { dir, adapter: new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} }) };
}

test('schema v38: a fresh database has media_source_comments; a v37 database gains it and stamps 38; a re-run is a no-op', () => {
  assert.strictEqual(SCHEMA_VERSION, 38);
  let { dir, adapter } = freshAdapter();
  const cols = () => adapter.sql.prepare('PRAGMA table_info(media_source_comments)').all().map((c) => c.name);
  assert.deepStrictEqual(cols(), ['media_id', 'payload', 'fetched_at', 'state']);
  const store = SC.createSourceCommentStore(adapter);
  store.apply('keep', SC.decideSnapshot(REAL, NOW));
  // rewind: drop the table and stamp 37 (the source lock keeps node:sqlite to lib/db/sqlite.js)
  adapter.sql.exec('DROP TABLE media_source_comments');
  adapter.sql.exec('PRAGMA user_version = 37');
  adapter.close();
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, 38);
  assert.deepStrictEqual(cols(), ['media_id', 'payload', 'fetched_at', 'state'], 'born again, empty');
  SC.createSourceCommentStore(adapter).apply('x', SC.decideSnapshot(REAL, NOW));
  adapter.sql.exec('PRAGMA user_version = 37'); // a crash between the CREATE and the stamp
  adapter.close();
  adapter = new SqliteAdapter(path.join(dir, SQLITE_FILENAME), { log: () => {} });
  assert.strictEqual(adapter.sql.prepare('PRAGMA user_version').get().user_version, 38);
  assert.strictEqual(SC.createSourceCommentStore(adapter).size(), 1, 'IF NOT EXISTS: the re-run keeps the rows');
  adapter.close();
});

test('store.apply is R9\'s writer: null keeps the row, a snapshot replaces it, disabled replaces it', () => {
  const { adapter } = freshAdapter();
  const store = SC.createSourceCommentStore(adapter);
  const ok = SC.decideSnapshot(REAL, NOW);
  assert.strictEqual(store.apply('v', ok), true);
  assert.strictEqual(store.apply('v', null), false, 'a failed fetch writes nothing');
  assert.strictEqual(store.apply('v', SC.decideSnapshot({ ...REAL, comment_count: null }, NOW)), false, 'an interrupted fetch writes nothing');
  assert.deepStrictEqual(store.get('v'), ok, 'the snapshot survives');
  const newer = SC.decideSnapshot({ comments: [{ text: 'newer', parent: 'root' }], comment_count: 1 }, NOW + 1000);
  assert.strictEqual(store.apply('v', newer), true);
  assert.strictEqual(store.get('v').comments[0].text, 'newer');
  assert.strictEqual(store.apply('v', SC.decideSnapshot({ id: 'v' }, NOW + 2000)), true);
  assert.strictEqual(store.get('v').state, 'disabled');
  assert.strictEqual(store.get('nope\u0000'), null, 'reads are tolerant');
  assert.throws(() => store.replaceAll({ a: ok, b: { state: 'ok', fetchedAt: ok.fetchedAt, comments: [] } }), /not valid/);
  assert.strictEqual(store.get('v').state, 'disabled', 'a refused replaceAll touched nothing');
  adapter.close();
});
