'use strict';

// [INTEGRATION] v1.393.0 W4 (plan 2026-10-20-listing-overflow, R5): the SUBSCRIPTION lane writes the download
// trace too (ROADMAP Planned "A subscription download has no trace hook"), tagged `sub:<subscription id>`. Driven
// through a REAL fake yt-dlp (list pass prints one video, the download exits 0): the trace shows the gate, the
// list pass (start and end, with its byte count) and the real spawn / exit / close lines of the download.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const ytdlp = require('../../lib/ytdlp');
const ytdlpStoreModule = require('../../lib/ytdlp/store');
const { featureStoreFor, docView } = require('../helpers/scratch-feature-store');
const engine = require('../../lib/ytdlp/engine');
const store = require('../../lib/ytdlp/store');
const oneshotTrace = require('../../lib/ytdlp/oneshotTrace');

let tmpDir;
const origBinary = engine.activeBinaryPath;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-sub-trace-')); });
afterEach(() => {
  engine.activeBinaryPath = origBinary;
  oneshotTrace.resetForTests();
  ytdlp.resetPollRerunStateForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeFakeDeps() {
  const db = {};
  return {
    ytdlpDb: featureStoreFor(ytdlpStoreModule.FEATURE, db),
    loadDatabase: () => docView(db, featureStoreFor(ytdlpStoreModule.FEATURE, db)),
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(input).digest('hex'),
    dataDir: tmpDir,
  };
}

test('R5 a subscription poll writes sub:<id> gate, list and download lines to the trace, from a real list + download child', async () => {
  const bin = path.join(tmpDir, 'fake-ytdlp');
  fs.writeFileSync(bin, `#!${process.execPath}
if (process.argv.includes('--dump-json')) {
  process.stdout.write(JSON.stringify({ id: 'abcdefghijk', title: 'A video', upload_date: '20991231', channel_id: 'UCabcdefghijklmnopqrstuv', automatic_captions: { en: ['x'.repeat(2000)] } }) + '\\n');
}
process.exit(0);
`, { mode: 0o755 });
  engine.activeBinaryPath = () => bin;
  const dl = path.join(tmpDir, 'dl');
  fs.mkdirSync(dl);
  const deps = makeFakeDeps();
  const config = ytdlp.parseYtdlpConfig({ FILETUBE_YTDLP_ENABLED: 'true', FILETUBE_YTDLP_POLL_MINUTES: '0', FILETUBE_YTDLP_DOWNLOAD_DIR: dl });
  const sub = await store.addSubscription(deps, { channelUrl: 'https://www.youtube.com/@chan', format: 'video', quality: 'best' });
  await ytdlp.runPoll(deps, config);

  const mine = oneshotTrace.readEntries(tmpDir).filter((e) => e.jobId === `sub:${sub.id}`);
  const evs = mine.map((e) => e.ev);
  const at = (name) => evs.indexOf(name);
  for (const name of ['gate-enter', 'list-start', 'list-end', 'spawn', 'child-exit', 'child-close', 'gate-leave']) {
    assert.ok(at(name) >= 0, `${name} missing from ${JSON.stringify(evs)}`);
  }
  assert.ok(at('gate-enter') < at('list-start') && at('list-start') < at('list-end') && at('list-end') < at('spawn') && at('spawn') < at('child-close') && at('child-close') < at('gate-leave'), JSON.stringify(evs));
  const listEnd = mine.find((e) => e.ev === 'list-end');
  assert.strictEqual(listEnd.ok, true);
  assert.strictEqual(listEnd.entries, 1);
  assert.ok(listEnd.bytes > 2000, 'bytes read: ' + listEnd.bytes);
  assert.strictEqual(mine.find((e) => e.ev === 'gate-leave').ok, true);
});
