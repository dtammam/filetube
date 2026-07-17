'use strict';

// [UNIT] v1.42 — smoke test for scripts/migrate-check.js (QA-gate
// suggestion): the owner's pre-upgrade safety net gets an end-to-end CLI
// run, not just faith in the importDbJson functions it wraps. Exit codes
// and the db.json-untouched guarantee are the contract.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'migrate-check.js');

function runCli(jsonPath) {
  return spawnSync(process.execPath, [SCRIPT, jsonPath], { encoding: 'utf8', timeout: 30000 });
}

test('migrate-check: a healthy db.json passes (exit 0, summary printed, file untouched)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-mc-'));
  try {
    const jsonPath = path.join(dir, 'db.json');
    fs.writeFileSync(jsonPath, JSON.stringify({
      folders: ['/media'], folderSettings: {}, progress: { v1: 9 },
      metadata: { v1: { id: 'v1', title: 'T', viewCount: 2 } }, settings: { defaultView: '' },
    }, null, 2), 'utf8');
    const before = crypto.createHash('sha256').update(fs.readFileSync(jsonPath)).digest('hex');

    const res = runCli(jsonPath);
    assert.equal(res.status, 0, `expected exit 0, got ${res.status}; stderr: ${res.stderr}`);
    assert.match(res.stdout, /MIGRATION CHECK PASSED/);
    assert.match(res.stdout, /metadata: 1/);
    assert.match(res.stdout, /viewCounts: 1/, 'the extraction is reported');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(jsonPath)).digest('hex'), before, 'db.json untouched');
    assert.ok(!fs.existsSync(path.join(dir, 'filetube.db')), 'a dry run leaves nothing behind in the source dir');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migrate-check: a corrupt db.json fails honestly (exit 1, nothing migrated, file untouched)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-mc-bad-'));
  try {
    const jsonPath = path.join(dir, 'db.json');
    fs.writeFileSync(jsonPath, '{ this is not valid json', 'utf8');
    const res = runCli(jsonPath);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /MIGRATION CHECK FAILED/);
    assert.match(res.stderr, /has not been touched/i);
    assert.equal(fs.readFileSync(jsonPath, 'utf8'), '{ this is not valid json', 'file untouched');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migrate-check: a missing path fails with usage guidance (exit 1)', () => {
  const res = runCli('/nonexistent/db.json');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /no db\.json found/);
});
