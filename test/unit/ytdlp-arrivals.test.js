'use strict';

// [UNIT] v1.373.0 lib/ytdlp/arrivals.js: the playlist arrivals store (untrusted at rest, bounded, expiring).

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

test('add + find: the entry, one per video (a re-add refreshes it); an unknown id finds nothing', () => {
  assert.deepStrictEqual(arrivals.addArrival(dir, { youtubeId: 'vid00000001', userId: 7, hide: true, sinceMs: NOW - 1 }, NOW),
    { youtubeId: 'vid00000001', userId: 7, hide: true, sinceMs: NOW - 1, createdAt: NOW });
  arrivals.addArrival(dir, { youtubeId: 'vid00000001', hide: false }, NOW + 5);
  assert.deepStrictEqual(arrivals.findArrival(dir, 'vid00000001', NOW + 6), { youtubeId: 'vid00000001', userId: null, hide: false, sinceMs: NOW + 5, createdAt: NOW + 5 });
  assert.strictEqual(JSON.parse(fs.readFileSync(file(), 'utf8')).length, 1);
  assert.strictEqual(arrivals.findArrival(dir, 'vid00000002', NOW), null);
});

test('a hide needs a real user id (users.id is an INTEGER); without one the entry is quiet only', () => {
  assert.strictEqual(arrivals.addArrival(dir, { youtubeId: 'vid00000001', userId: '7', hide: true }, NOW).hide, false, 'a string id is not a user');
  assert.strictEqual(arrivals.addArrival(dir, { youtubeId: 'vid00000002', userId: 0, hide: true }, NOW).hide, false);
  assert.strictEqual(arrivals.addArrival(dir, { youtubeId: 'vid00000003', userId: 7, hide: false }, NOW).userId, null, 'no hide, no user id kept');
  assert.strictEqual(arrivals.addArrival(dir, { youtubeId: 'bad id;rm', userId: 7, hide: true }, NOW), null, 'a hostile id is refused');
});

test('at rest: a tampered entry (hostile id, a hide with no user, a string user, junk) is dropped; an expired one too', () => {
  fs.writeFileSync(file(), JSON.stringify([
    { youtubeId: 'vid00000001', userId: 7, hide: true, sinceMs: NOW, createdAt: NOW },
    { youtubeId: '__proto__x;', userId: 7, hide: true, sinceMs: NOW, createdAt: NOW },
    { youtubeId: 'vid00000002', userId: null, hide: true, sinceMs: NOW, createdAt: NOW },
    { youtubeId: 'vid00000003', userId: '7', hide: true, sinceMs: NOW, createdAt: NOW },
    { youtubeId: 'vid00000004', userId: null, hide: false, sinceMs: NOW, createdAt: NOW - arrivals.ARRIVAL_TTL_MS },
    'junk', null, 7,
  ]));
  assert.ok(arrivals.findArrival(dir, 'vid00000001', NOW));
  for (const id of ['vid00000002', 'vid00000003', 'vid00000004']) assert.strictEqual(arrivals.findArrival(dir, id, NOW), null, id);
  assert.strictEqual(arrivals.findArrival(dir, 'vid00000001', NOW + arrivals.ARRIVAL_TTL_MS), null, 'expires');
});

test('bounded: the oldest entries go past MAX_ARRIVALS; a missing or corrupt file reads as empty', () => {
  assert.strictEqual(arrivals.findArrival(dir, 'vid00000001', NOW), null);
  fs.writeFileSync(file(), '{not json');
  assert.strictEqual(arrivals.findArrival(dir, 'vid00000001', NOW), null);
  const many = Array.from({ length: arrivals.MAX_ARRIVALS }, (_, i) => ({ youtubeId: 'v' + String(i).padStart(10, '0'), userId: null, hide: false, sinceMs: NOW, createdAt: NOW }));
  fs.writeFileSync(file(), JSON.stringify(many));
  arrivals.addArrival(dir, { youtubeId: 'vnewest0001', hide: false }, NOW);
  const kept = JSON.parse(fs.readFileSync(file(), 'utf8'));
  assert.strictEqual(kept.length, arrivals.MAX_ARRIVALS);
  assert.strictEqual(kept[0].youtubeId, 'v0000000001', 'the oldest went');
  assert.ok(arrivals.findArrival(dir, 'vnewest0001', NOW));
});
