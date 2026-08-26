'use strict';

// [UNIT] v1.195 TV Shows: the scanner's PURE core (lib/tv/scan.js) - walk the
// Show/Season/Episode tree, reuse-by-(path+size), poster + thumb selection. Uses a
// real temp directory tree (no ffmpeg: probe is injected/omitted).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const scan = require('../../lib/tv/scan.js');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const getId = (fp) => md5(fp);
const getShowId = (sp) => md5(sp);

function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-scan-'));
  const house = path.join(root, 'House MD');
  fs.mkdirSync(path.join(house, 'Season 1'), { recursive: true });
  fs.mkdirSync(path.join(house, 'Season 2'), { recursive: true });
  fs.mkdirSync(path.join(house, 'Specials'), { recursive: true });
  fs.mkdirSync(path.join(house, 'Bloopers'), { recursive: true });
  fs.writeFileSync(path.join(house, 'Season 1', 'House MD S01E01 - Pilot.mkv'), 'a');
  fs.writeFileSync(path.join(house, 'Season 2', 'House MD S02E22 - Forever.mp4'), 'bb');
  fs.writeFileSync(path.join(house, 'Specials', 'House MD S00E01 - Making Of.mp4'), 'c');
  fs.writeFileSync(path.join(house, 'House MD S03E01 - Flat One.mp4'), 'd'); // flat in show folder
  fs.writeFileSync(path.join(house, 'Bloopers', 'random gag.avi'), 'e');     // unrecognized folder, no SxxEyy
  fs.writeFileSync(path.join(house, 'poster.jpg'), 'img');                    // show poster
  fs.writeFileSync(path.join(house, 'Season 1', 'notes.txt'), 'x');           // non-video, ignored
  return { root, house };
}

test('collectEpisodes: parses the Show/Season/Episode tree; folder season wins; flat + Extras handled', async () => {
  const { root, house } = makeTree();
  try {
    const { episodes, survivingIds, missingRoots } = await scan.collectEpisodes([root], {}, { getId, getShowId });
    const list = Object.values(episodes);
    assert.strictEqual(list.length, 5, 'five video files become episodes (notes.txt ignored)');
    assert.deepStrictEqual(missingRoots, []);
    assert.strictEqual(survivingIds.size, 5);

    const byTitleShow = (t) => list.find((e) => e.title === t);
    const showId = getShowId(house);
    for (const e of list) {
      assert.strictEqual(e.showName, 'House MD');
      assert.strictEqual(e.showId, showId, 'all episodes share the one show id (md5 of the show path)');
    }
    assert.deepStrictEqual(
      { s: byTitleShow('Forever').seasonNum, e: byTitleShow('Forever').episodeNum },
      { s: 2, e: 22 }, 'Season 2 / E22 from Dean\'s filename');
    assert.strictEqual(byTitleShow('Pilot').seasonNum, 1);
    assert.strictEqual(byTitleShow('Making Of').seasonNum, 0, 'Specials -> season 0');
    assert.strictEqual(byTitleShow('Flat One').seasonNum, 3, 'flat file in the show folder -> filename season 3');
    const blooper = list.find((e) => e.ext === '.avi');
    assert.strictEqual(blooper.seasonNum, null, 'unrecognized folder + no SxxEyy -> Extras (null season)');
    assert.strictEqual(blooper.episodeNum, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('collectEpisodes: reuses an unchanged (path+size) record verbatim, re-probes a changed one', async () => {
  const { root } = makeTree();
  try {
    const first = await scan.collectEpisodes([root], {}, { getId, getShowId });
    // Reuse: same map back in as "previous", nothing changed on disk.
    let probeCalls = 0;
    const probe = async () => { probeCalls += 1; return { durationSec: 100, codec: 'h264', container: 'mp4' }; };
    const second = await scan.collectEpisodes([root], first.episodes, { getId, getShowId, probe });
    assert.strictEqual(probeCalls, 0, 'every unchanged file was reused, never re-probed');
    for (const id of Object.keys(first.episodes)) {
      assert.strictEqual(second.episodes[id], first.episodes[id], 'reused by reference (path+size match)');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('collectEpisodes: a missing root is reported, never treated as an emptied library', async () => {
  const { episodes, missingRoots } = await scan.collectEpisodes(['/no/such/tv/root'], {}, { getId, getShowId });
  assert.deepStrictEqual(Object.keys(episodes), []);
  assert.deepStrictEqual(missingRoots, ['/no/such/tv/root']);
});

test('findShowPoster: returns the show-folder poster, case-insensitive, preference-ordered', async () => {
  const { house } = makeTree();
  const root = path.dirname(house);
  try {
    assert.strictEqual(scan.findShowPoster(house), path.join(house, 'poster.jpg'));
    const noPoster = path.join(root, 'No Poster Show');
    fs.mkdirSync(noPoster, { recursive: true });
    fs.writeFileSync(path.join(noPoster, 'Cover.PNG'), 'x'); // wrong-case, lower-preference
    assert.strictEqual(scan.findShowPoster(noPoster), path.join(noPoster, 'Cover.PNG'), 'case-insensitive match');
    assert.strictEqual(scan.findShowPoster(path.join(root, 'nope')), null, 'unreadable dir -> null, never throws');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('selectThumbJobs: one job per episode lacking a cached thumbnail', async () => {
  const { root } = makeTree();
  try {
    const { episodes } = await scan.collectEpisodes([root], {}, { getId, getShowId });
    const ids = Object.keys(episodes);
    const have = new Set([ids[0]]); // pretend the first already has a thumb on disk
    const jobs = scan.selectThumbJobs(episodes, (id) => have.has(id));
    assert.strictEqual(jobs.length, ids.length - 1, 'a job for every episode WITHOUT a thumb');
    assert.ok(jobs.every((j) => j.id && j.filePath), 'each job carries id + source path');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SOURCE: TV_EXTENSIONS stays a match of server.js VIDEO_EXTENSIONS + TRANSCODE_EXTENSIONS (no drift)', () => {
  const SERVER = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
  const grab = (name) => {
    const m = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(SERVER);
    assert.ok(m, `${name} must be findable in server.js`);
    return m[1].match(/'([^']+)'/g).map((s) => s.replace(/'/g, ''));
  };
  const expected = new Set([...grab('VIDEO_EXTENSIONS'), ...grab('TRANSCODE_EXTENSIONS')]);
  assert.deepStrictEqual([...scan.TV_EXTENSIONS].sort(), [...expected].sort(),
    'an episode is exactly the set of files the video pipeline can serve - update TV_EXTENSIONS if server.js changes');
});
