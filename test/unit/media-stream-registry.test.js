'use strict';

// [UNIT] v1.41.10 -- the leaked-streaming-fd / DELETE_PENDING fix (the
// "undeletable emoji files" incident, 2026-07-16). Production was found
// holding ~180 open fds on three "undeletable" videos: every browser seek
// aborts its Range request, `.pipe()` never destroys the source stream, and
// on SMB/CIFS those pinned handles put a deleted file into server-side
// DELETE_PENDING -- dirent still enumerable, every unlink retry ENOENT, scan
// resurrects the card forever.
//
// Covered here, directly against the exported primitives:
//   - registerMediaStream/destroyMediaStreams bookkeeping: register, destroy,
//     count, deregister-on-close (normal end AND destroy), map hygiene.
//   - destroyMediaStreams' bounded wait: resolves even when a stream never
//     emits 'close' (the unlink must not hang behind a wedged stream).
//   - leafStillEnumerated: the parent-dir raw-byte post-verify that
//     distinguishes "gone" from "undead" (string and Buffer path shapes,
//     Unicode leaves, unreadable-dir fails toward "gone").

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const assert = require('node:assert');

const {
  activeMediaStreams,
  registerMediaStream,
  destroyMediaStreams,
  leafStillEnumerated,
} = require('../../server');

// A minimal stand-in for fs.ReadStream: destroy() emits 'close' async, the
// way autoDestroy fs streams behave. `stubborn: true` models a wedged stream
// that never closes (the bounded-wait case).
function fakeStream({ stubborn = false } = {}) {
  const s = new EventEmitter();
  s.closed = false;
  s.destroyed = false;
  s.destroyCalls = 0;
  s.destroy = () => {
    s.destroyCalls++;
    s.destroyed = true;
    if (!stubborn && !s.closed) {
      setImmediate(() => {
        s.closed = true;
        s.emit('close');
      });
    }
  };
  return s;
}

test('register + destroy: all live streams on a path are destroyed, counted, and deregistered', async () => {
  const p = '/media/fake/a.mp4';
  const s1 = fakeStream();
  const s2 = fakeStream();
  registerMediaStream(p, s1);
  registerMediaStream(p, s2);
  assert.equal(activeMediaStreams.get(p).size, 2);

  const n = await destroyMediaStreams(p);
  assert.equal(n, 2, 'both streams counted');
  assert.equal(s1.destroyCalls, 1);
  assert.equal(s2.destroyCalls, 1);
  assert.equal(activeMediaStreams.has(p), false, 'map entry removed once the set drains');
});

test('a stream that ends normally deregisters itself (no destroy needed)', () => {
  const p = '/media/fake/b.mp4';
  const s = fakeStream();
  registerMediaStream(p, s);
  assert.equal(activeMediaStreams.get(p).size, 1);
  s.closed = true;
  s.emit('close'); // what a completed fs stream emits on its own
  assert.equal(activeMediaStreams.has(p), false);
});

test('destroyMediaStreams on an unknown path resolves 0 immediately', async () => {
  assert.equal(await destroyMediaStreams('/media/fake/never-registered.mp4'), 0);
});

test('destroyMediaStreams is bounded: resolves even when a stream never emits close', async () => {
  const p = '/media/fake/wedged.mp4';
  const s = fakeStream({ stubborn: true });
  registerMediaStream(p, s);
  const started = Date.now();
  const n = await destroyMediaStreams(p, 100); // 100ms cap for the test
  assert.equal(n, 1, 'still counted');
  assert.ok(Date.now() - started < 3000, 'resolved by the cap, not hung');
  assert.equal(s.destroyCalls, 1);
  // The wedged stream never emitted 'close', so its registry entry remains --
  // correct: the fd genuinely is still open. Clean it up for later tests.
  activeMediaStreams.delete(p);
});

test('paths are independent: destroying one path leaves siblings alone', async () => {
  const pa = '/media/fake/c.mp4';
  const pb = '/media/fake/d.mp4';
  const sa = fakeStream();
  const sb = fakeStream();
  registerMediaStream(pa, sa);
  registerMediaStream(pb, sb);
  await destroyMediaStreams(pa);
  assert.equal(sa.destroyCalls, 1);
  assert.equal(sb.destroyCalls, 0, 'sibling path untouched');
  assert.equal(activeMediaStreams.get(pb).size, 1);
  await destroyMediaStreams(pb); // cleanup
});

test('leafStillEnumerated: present and absent leaves, string path, Unicode name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-leaf-'));
  const name = 'Diarrhea Parasite Situation Is Insane \u{1F633} [lUirOY2Xf_4].mp4';
  fs.writeFileSync(path.join(dir, name), 'x');
  assert.equal(leafStillEnumerated(path.join(dir, name)), true, 'present emoji leaf is found');
  assert.equal(leafStillEnumerated(path.join(dir, 'not-there.mp4')), false, 'absent leaf is not');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('leafStillEnumerated: Buffer path (the realPathRaw shape) matches by exact bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-leafbuf-'));
  const name = 'clip ？ [N5OU1gTCc5M].mp4'; // full-width ? -- the incident's own shape
  fs.writeFileSync(path.join(dir, name), 'x');
  const bufPath = Buffer.from(path.join(dir, name), 'utf8');
  assert.equal(leafStillEnumerated(bufPath), true, 'Buffer path resolves to the same dirent');
  const absent = Buffer.from(path.join(dir, 'gone.mp4'), 'utf8');
  assert.equal(leafStillEnumerated(absent), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('leafStillEnumerated fails toward "gone": unreadable/missing parent dir returns false', () => {
  assert.equal(leafStillEnumerated('/definitely/not/a/real/dir/file.mp4'), false);
  assert.equal(leafStillEnumerated(Buffer.from('no-separator-at-all', 'utf8')), false, 'separator-less Buffer path is a safe false');
});
