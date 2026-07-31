'use strict';
// Boot-time safe-mode coverage (2026-07-31 capture-profile gate finding):
// FILETUBE_READ_ONLY_MEDIA was REQUEST-scoped - startBackground's boot
// work (the pending one-shot requeue, the stale-dir migration) ran before
// any request existed, so a data dir carrying pending one-shots would
// start downloading at process start with every request-level protection
// blind to it. These tests bind the gate BEHAVIORALLY: a pending entry
// with an invalid URL is DROPPED by the ungated requeue path (the file is
// rewritten and a runlog line lands - observable without any spawn), so
// under read-only media the file must remain byte-identical and the
// runlog empty.
//
// BINDING HONESTY (gate correction): the REQUEUE gate is bound by these
// tests; the MIGRATION gate (migrateStaleDownloadDirFromFolders) is
// gated-but-UNBOUND - binding it needs a stale download-dir folder
// structure fixture, judged not worth it for a non-download path whose
// gate mutant only moves folders. One bound, one gated; disclosed.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ytdlp = require('../../lib/ytdlp');
const { parseYtdlpConfig } = require('../../lib/ytdlp/config.js');

function bootFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-ro-boot-'));
  const pendingPath = path.join(dir, 'ytdlp-pending-oneshots.json');
  // An invalid-URL entry: the ungated requeue classifies it, DROPS it
  // (rewriting this file) and records a runlog line. No spawn involved.
  fs.writeFileSync(pendingPath, JSON.stringify([{ jobId: 'ro-boot-probe', url: 'not a url at all', format: 'mp4' }]));
  return { dir, pendingPath, before: fs.readFileSync(pendingPath, 'utf8') };
}

function cfg(extra) {
  return parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: '1',
    FILETUBE_YTDLP_DOWNLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'ytdlp-ro-dl-')),
    ...extra,
  });
}

test('read-only media: boot-time requeue and migration are SKIPPED - the pending file survives byte-identical', () => {
  const fx = bootFixture();
  try {
    ytdlp.startBackground({ dataDir: fx.dir }, cfg({ FILETUBE_READ_ONLY_MEDIA: '1' }));
    assert.strictEqual(fs.readFileSync(fx.pendingPath, 'utf8'), fx.before, 'pending one-shots must be left queued, not launched/dropped, under read-only media');
    assert.ok(!fs.existsSync(path.join(fx.dir, 'ytdlp-runlog.json')) || !fs.readFileSync(path.join(fx.dir, 'ytdlp-runlog.json'), 'utf8').includes('ro-boot-probe'), 'no runlog activity for the probe entry');
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('writable boot (control): the same entry IS processed - proving the fixture actually exercises the gated path', () => {
  const fx = bootFixture();
  try {
    ytdlp.startBackground({ dataDir: fx.dir }, cfg({}));
    assert.notStrictEqual(fs.readFileSync(fx.pendingPath, 'utf8'), fx.before, 'without read-only media the requeue must touch the pending file (the invalid probe is dropped) - if this fails, the read-only test above is vacuous');
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});
