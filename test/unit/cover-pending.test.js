'use strict';

// [UNIT] v1.376.0 W6 (b) (plan docs/exec-plans/active/2026-10-08-v1376-notify-podcasts-polish.md, W6): a file whose
// album cover is still being written is DEFERRED by every scan walker, and a deferred file is never pruned.
//
//   - lib/ytdlp/coverPending.js: what a claim covers (the job folder + the video's `[id]` bracket, an FTCHDST path in
//     that folder), what it does not (another id, another folder, a path outside the folder), symlinked spellings, a
//     folder that does not exist yet, release.
//   - the video walker (lib/scan/orchestrator.js scanDirRecursive, built through the real factory): a pending file is
//     recorded in `deferred` and kept out of `results`; released, it is indexed.
//   - selectPrunableIds guard (1b): an entry whose path was deferred is kept, whatever the other guards say.
//   - the music walker (lib/music/scan.js collectTracks): a pending file is never probed; its existing record is
//     carried forward (it survives the prune), a new one is not added.
// The end-to-end race (a scan between the file landing and the re-embed, over the real job and the real scan) is
// test/integration/scan-cover-pending.test.js.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const coverPending = require('../../lib/ytdlp/coverPending');
const { selectPrunableIds } = require('../../lib/scan/merge');
const { createScanOrchestrator } = require('../../lib/scan/orchestrator');
const musicScan = require('../../lib/music/scan');

const VID = 'c1Paj8je5sM';
let tmp;
beforeEach(() => { coverPending.resetForTests(); tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cover-pending-'))); });
afterEach(() => { coverPending.resetForTests(); fs.rmSync(tmp, { recursive: true, force: true }); });

function file(rel, body = 'x') {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
}

// ---- the registry ----------------------------------------------------------------------------------------------

test('a claim covers the job folder\'s files carrying the video\'s [id] bracket, nothing else', () => {
  const dir = path.join(tmp, 'Kyle Gordon');
  const h = coverPending.claim({ dir, videoId: VID });
  assert.ok(h);
  assert.strictEqual(coverPending.isPending(path.join(dir, `Mr. Jambo [${VID}].mp3`)), true);
  assert.strictEqual(coverPending.isPending(path.join(dir, `Mr. Jambo [${VID}].webm`)), true, 'the source yt-dlp converts too');
  assert.strictEqual(coverPending.isPending(path.join(dir, 'Mr. Jambo [vid00000002].mp3')), false, 'another video');
  assert.strictEqual(coverPending.isPending(path.join(tmp, 'Other', `Mr. Jambo [${VID}].mp3`)), false, 'another folder');
  assert.strictEqual(coverPending.isPending(path.join(dir, `Mr. Jambo ${VID}.mp3`)), false, 'the id without its bracket');
  h.release();
  assert.strictEqual(coverPending.isPending(path.join(dir, `Mr. Jambo [${VID}].mp3`)), false, 'released');
  assert.strictEqual(coverPending.pendingCount(), 0);
  h.release(); // idempotent
  assert.strictEqual(coverPending.pendingCount(), 0);
});

test('an FTCHDST path joins the claim only inside the claimed folder; a released claim takes nothing', () => {
  const dir = path.join(tmp, 'Kyle Gordon');
  const h = coverPending.claim({ dir, videoId: VID });
  assert.strictEqual(h.addFile(path.join(dir, 'Mr. Jambo.mp3')), true);
  assert.strictEqual(coverPending.isPending(path.join(dir, 'Mr. Jambo.mp3')), true, 'an exact final name (any template)');
  assert.strictEqual(h.addFile(path.join(tmp, 'Elsewhere', 'Victim.mp3')), false, 'a path outside the folder is refused');
  assert.strictEqual(coverPending.isPending(path.join(tmp, 'Elsewhere', 'Victim.mp3')), false);
  assert.strictEqual(h.addFile('relative.mp3'), false);
  h.release();
  assert.strictEqual(h.addFile(path.join(dir, 'Late.mp3')), false);
  assert.strictEqual(coverPending.isPending(path.join(dir, 'Late.mp3')), false);
});

test('a claim refuses a relative folder or an unsafe id (no claim, nothing pending)', () => {
  assert.strictEqual(coverPending.claim({ dir: 'rel/dir', videoId: VID }), null);
  assert.strictEqual(coverPending.claim({ dir: tmp, videoId: '' }), null);
  assert.strictEqual(coverPending.claim({ dir: tmp, videoId: 'a/b' }), null);
  assert.strictEqual(coverPending.claim({ dir: tmp, videoId: 'x]y' }), null);
  assert.strictEqual(coverPending.pendingCount(), 0);
});

test('a walker spelling the folder through a symlinked root still matches, even when the folder is created after the claim', () => {
  const realRoot = path.join(tmp, 'downloads-real');
  fs.mkdirSync(realRoot);
  const link = path.join(tmp, 'downloads-link');
  fs.symlinkSync(realRoot, link);
  // the job claims through the LINK spelling before yt-dlp creates the channel folder
  const h = coverPending.claim({ dir: path.join(link, 'Kyle Gordon'), videoId: VID });
  fs.mkdirSync(path.join(realRoot, 'Kyle Gordon'));
  // a library root configured as the REAL path walks this spelling
  assert.strictEqual(coverPending.isPending(path.join(realRoot, 'Kyle Gordon', `Song [${VID}].mp3`)), true);
  assert.strictEqual(coverPending.isPending(path.join(link, 'Kyle Gordon', `Song [${VID}].mp3`)), true);
  h.release();
  // and the other way round: claimed through the real path, walked through the link
  const h2 = coverPending.claim({ dir: path.join(realRoot, 'Kyle Gordon'), videoId: VID });
  assert.strictEqual(coverPending.isPending(path.join(link, 'Kyle Gordon', `Song [${VID}].mp3`)), true);
  h2.release();
});

// ---- the video walker ------------------------------------------------------------------------------------------

function walker() {
  const orch = createScanOrchestrator({
    fs, path,
    ALL_EXTENSIONS: ['.mp3', '.m4a', '.mp4'],
    TRASH_DIR_NAME: '.filetube-trash',
    isYtdlpIntermediate: () => false,
    isInFlightTranscode: () => false,
    maybeYieldScan: async () => {},
    scanState: {},
  });
  return orch.scanDirRecursive;
}

test('the video walker DEFERS a pending file (recorded, not indexed) and indexes it once released', async () => {
  const scanDirRecursive = walker();
  const pendingFile = file(`Kyle Gordon/Mr. Jambo [${VID}].mp3`, 'OWN-ART');
  const other = file('Kyle Gordon/Intro [vid00000001].mp3', 'COVER');
  const h = coverPending.claim({ dir: path.join(tmp, 'Kyle Gordon'), videoId: VID });
  let results = new Map(); let deferred = new Set(); const unreadable = new Set();
  await scanDirRecursive(tmp, tmp, results, unreadable, { count: 0 }, deferred);
  assert.deepStrictEqual([...results.keys()], [other], 'only the settled file is indexed');
  assert.deepStrictEqual([...deferred], [pendingFile], 'the pending file is recorded as deferred');
  assert.deepStrictEqual([...unreadable], []);
  h.release();
  results = new Map(); deferred = new Set();
  await scanDirRecursive(tmp, tmp, results, unreadable, { count: 0 }, deferred);
  assert.deepStrictEqual([...results.keys()].sort(), [other, pendingFile].sort(), 'released: indexed');
  assert.deepStrictEqual([...deferred], []);
});

// ---- the prune -------------------------------------------------------------------------------------------------

test('selectPrunableIds (1b): an entry whose file the walk DEFERRED is never pruned (every other guard says prune)', () => {
  const old = { deferred: { filePath: '/media/Kyle Gordon/Mr. Jambo [x].mp3', rootFolder: '/media' }, gone: { filePath: '/media/gone.mp3', rootFolder: '/media' } };
  const opts = { missingRoots: [], unreadablePaths: [], folders: ['/media'], pruneMissing: true };
  assert.deepStrictEqual(selectPrunableIds(old, new Set(), opts), ['deferred', 'gone'], 'control: without the deferral both prune');
  assert.deepStrictEqual(selectPrunableIds(old, new Set(), { ...opts, deferredPaths: new Set(['/media/Kyle Gordon/Mr. Jambo [x].mp3']) }), ['gone']);
  assert.deepStrictEqual(selectPrunableIds(old, new Set(), { ...opts, deferredPaths: ['/media/Kyle Gordon/Mr. Jambo [x].mp3'] }), ['gone'], 'an array works too');
});

// ---- the music walker ------------------------------------------------------------------------------------------

test('the music walker never probes a pending file: its existing record survives unchanged, a new one waits', async () => {
  const known = file(`Kyle Gordon/Known [${VID}].mp3`, 'OWN-ART');
  const fresh = file(`Kyle Gordon/Fresh [${VID}].m4a`, 'OWN-ART');
  const settled = file('Kyle Gordon/Intro [vid00000001].mp3', 'COVER');
  const getMediaId = (p) => 'id:' + path.basename(p);
  const prevKnown = { id: getMediaId(known), filePath: known, size: 1, title: 'Known (as indexed)', albumArtKey: 'k' };
  const probed = [];
  const probe = async (p) => { probed.push(p); return { tags: { title: path.basename(p) }, durationSec: 1 }; };
  const h = coverPending.claim({ dir: path.join(tmp, 'Kyle Gordon'), videoId: VID });
  const r = await musicScan.collectTracks([tmp], { [prevKnown.id]: prevKnown }, { getMediaId, probe });
  assert.deepStrictEqual(probed, [settled], 'only the settled file is probed');
  assert.strictEqual(r.tracks[getMediaId(known)], prevKnown, 'the existing record is carried forward unchanged');
  assert.ok(r.survivingIds.has(getMediaId(known)), 'so the prune keeps it');
  assert.strictEqual(r.tracks[getMediaId(fresh)], undefined, 'a new pending file is not indexed yet');
  assert.ok(!r.survivingIds.has(getMediaId(fresh)));
  h.release();
  const r2 = await musicScan.collectTracks([tmp], { [prevKnown.id]: prevKnown }, { getMediaId, probe });
  assert.ok(r2.tracks[getMediaId(fresh)], 'released: indexed');
  assert.ok(probed.includes(known), 'released: the changed file is probed again');
});
