'use strict';

// [UNIT] v1.373.0 lib/ytdlp/arrivals.js: the playlist arrivals store - one download's (id AND type), untrusted at rest,
// bounded, expiring, removable.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const arrivals = require('../../lib/ytdlp/arrivals');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-arrivals-unit-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });
const file = () => path.join(dir, arrivals.ARRIVALS_FILENAME);
const NOW = 1_800_000_000_000;
const live = () => arrivals.listArrivals(dir, NOW + 10);

test('add + find: one entry per DOWNLOAD (id and type); a re-add of the same download refreshes it; the other type is separate', () => {
  assert.deepStrictEqual(arrivals.addArrival(dir, { youtubeId: 'vid00000001', type: 'audio', userId: 7, hide: true, sinceMs: NOW - 1 }, NOW),
    { youtubeId: 'vid00000001', type: 'audio', userId: 7, hide: true, sinceMs: NOW - 1, createdAt: NOW });
  arrivals.addArrival(dir, { youtubeId: 'vid00000001', type: 'audio', hide: false }, NOW + 5);
  arrivals.addArrival(dir, { youtubeId: 'vid00000001', type: 'video', hide: false }, NOW + 6);
  assert.strictEqual(live().length, 2);
  assert.deepStrictEqual(arrivals.findArrival(live(), 'vid00000001', 'audio'), { youtubeId: 'vid00000001', type: 'audio', userId: null, hide: false, sinceMs: NOW + 5, createdAt: NOW + 5 });
  assert.strictEqual(arrivals.findArrival(live(), 'vid00000001', 'video').type, 'video');
  assert.strictEqual(arrivals.findArrival(live(), 'vid00000002', 'audio'), null);
  assert.strictEqual(arrivals.findArrival(null, 'vid00000001', 'audio'), null);
});

test('remove: by id AND type only; nothing to remove writes nothing', () => {
  arrivals.addArrival(dir, { youtubeId: 'vid00000001', type: 'audio', hide: false }, NOW);
  arrivals.addArrival(dir, { youtubeId: 'vid00000001', type: 'video', hide: false }, NOW);
  assert.strictEqual(arrivals.removeArrivals(dir, [{ youtubeId: 'vid00000001', type: 'audio' }], NOW), 1);
  assert.deepStrictEqual(live().map((e) => e.type), ['video']);
  const before = fs.statSync(file()).mtimeMs;
  assert.strictEqual(arrivals.removeArrivals(dir, [{ youtubeId: 'vid00000009', type: 'audio' }], NOW), 0);
  assert.strictEqual(fs.statSync(file()).mtimeMs, before);
  assert.strictEqual(arrivals.removeArrivals(dir, [], NOW), 0);
});

test('a hide needs a real user id (users.id is an INTEGER); a bad type or id is refused', () => {
  assert.strictEqual(arrivals.addArrival(dir, { youtubeId: 'vid00000001', type: 'audio', userId: '7', hide: true }, NOW).hide, false, 'a string id is not a user');
  assert.strictEqual(arrivals.addArrival(dir, { youtubeId: 'vid00000002', type: 'audio', userId: 0, hide: true }, NOW).hide, false);
  assert.strictEqual(arrivals.addArrival(dir, { youtubeId: 'vid00000003', type: 'audio', userId: 7, hide: false }, NOW).userId, null);
  assert.strictEqual(arrivals.addArrival(dir, { youtubeId: 'bad id;rm', type: 'audio', userId: 7, hide: true }, NOW), null);
  assert.strictEqual(arrivals.addArrival(dir, { youtubeId: 'vid00000004', type: 'mp3', hide: false }, NOW), null);
});

test('at rest: a tampered entry (hostile id, bad type, a hide with no user, a string user, junk) is dropped; an expired one too', () => {
  fs.writeFileSync(file(), JSON.stringify([
    { youtubeId: 'vid00000001', type: 'audio', userId: 7, hide: true, sinceMs: NOW, createdAt: NOW },
    { youtubeId: '__proto__x;', type: 'audio', userId: 7, hide: true, sinceMs: NOW, createdAt: NOW },
    { youtubeId: 'vid00000005', type: 'mp3', userId: null, hide: false, sinceMs: NOW, createdAt: NOW },
    { youtubeId: 'vid00000002', type: 'audio', userId: null, hide: true, sinceMs: NOW, createdAt: NOW },
    { youtubeId: 'vid00000003', type: 'audio', userId: '7', hide: true, sinceMs: NOW, createdAt: NOW },
    { youtubeId: 'vid00000004', type: 'audio', userId: null, hide: false, sinceMs: NOW, createdAt: NOW - arrivals.ARRIVAL_TTL_MS },
    'junk', null, 7,
  ]));
  assert.deepStrictEqual(arrivals.listArrivals(dir, NOW).map((e) => e.youtubeId), ['vid00000001']);
  assert.deepStrictEqual(arrivals.listArrivals(dir, NOW + arrivals.ARRIVAL_TTL_MS), [], 'expires');
});

test('bounded: the oldest entries go past MAX_ARRIVALS; a missing or corrupt file reads as empty', () => {
  assert.deepStrictEqual(arrivals.listArrivals(dir, NOW), []);
  fs.writeFileSync(file(), '{not json');
  assert.deepStrictEqual(arrivals.listArrivals(dir, NOW), []);
  const many = Array.from({ length: arrivals.MAX_ARRIVALS }, (_, i) => ({ youtubeId: 'v' + String(i).padStart(10, '0'), type: 'audio', userId: null, hide: false, sinceMs: NOW, createdAt: NOW }));
  fs.writeFileSync(file(), JSON.stringify(many));
  arrivals.addArrival(dir, { youtubeId: 'vnewest0001', type: 'audio', hide: false }, NOW);
  const kept = JSON.parse(fs.readFileSync(file(), 'utf8'));
  assert.strictEqual(kept.length, arrivals.MAX_ARRIVALS);
  assert.strictEqual(kept[0].youtubeId, 'v0000000001', 'the oldest went');
  assert.ok(arrivals.findArrival(arrivals.listArrivals(dir, NOW), 'vnewest0001', 'audio'));
});
