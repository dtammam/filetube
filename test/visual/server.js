'use strict';
// Seed + a FRESH fixture server, for test/visual/run.js and test/geometry/run.js.
//
// Every visual or geometry run boots its own server on a just-seeded DATA_DIR and stops it
// at the end (plan D10.5: a long-running server drifts - step 3's podcast status line), and
// waits for the boot scans to finish before the first page loads, so no scene can race
// the scan that runs at listen.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..');
// The pinned fixture clock (ms): 2026-09-01T12:00:00Z. A constant, so every run on every
// machine and every calendar day seeds the same rows and reads the same relative dates.
const SEED_NOW = Date.UTC(2026, 8, 1, 12, 0, 0);

function seed(dataDir, { log = () => {} } = {}) {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'seed.js'), '--data', dataDir], {
    cwd: REPO, env: { ...process.env, SEED_NOW: String(SEED_NOW), TZ: 'UTC', FILETUBE_CLOCK_MS: '' },
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  }).toString();
  log(`seeded ${dataDir}`);
  const fx = JSON.parse(fs.readFileSync(path.join(dataDir, 'fixtures.json'), 'utf8'));
  if (!fx.pinned || fx.seededAt !== SEED_NOW) throw new Error(`seed did not pin its clock (fixtures.json seededAt ${fx.seededAt}); seed output tail: ${out.slice(-400)}`);
  return fx;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error(`fixture server exited (code ${child.exitCode}) while waiting for ${what}`);
    try { if (await fn()) return; } catch (e) { last = e; }
    await sleep(200);
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}${last ? ': ' + last.message : ''}`);
}

// Boots test/visual/start-server.sh on DATA_DIR; resolves once the login page answers and
// the four boot scans (library, music, books, TV) report idle twice in a row.
async function boot(dataDir, { port, logFile, log = () => {} } = {}) {
  const p = port || await freePort();
  const out = logFile ? fs.openSync(logFile, 'a') : 'ignore';
  const child = spawn('bash', [path.join(__dirname, 'start-server.sh'), dataDir, String(p)], {
    cwd: REPO, env: { ...process.env, FILETUBE_CLOCK_MS: '' }, stdio: ['ignore', out, out],
  });
  const base = `http://127.0.0.1:${p}`;
  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null) { resolve(); return; }
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 5000).unref();
  });
  try {
    await waitFor(async () => (await fetch(base + '/login')).ok, 'GET /login', 30000, child);
    const fx = JSON.parse(fs.readFileSync(path.join(dataDir, 'fixtures.json'), 'utf8'));
    const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: fx.user, password: fx.password }) });
    if (!r.ok) throw new Error(`fixture login failed: ${r.status}`);
    const cookie = String(r.headers.get('set-cookie') || '').split(';')[0];
    const scans = ['/api/scan-status', '/api/music/scan-status', '/api/books/scan-status', '/api/tv/scan-status'];
    let idleStreak = 0;
    await waitFor(async () => {
      const states = await Promise.all(scans.map((u) => fetch(base + u, { headers: { Cookie: cookie } }).then((x) => (x.ok ? x.json() : { scanning: true }))));
      const idle = states.every((s) => s && s.scanning === false) && Boolean(states[0].lastScan);
      idleStreak = idle ? idleStreak + 1 : 0;
      return idleStreak >= 2;
    }, 'the boot scans to finish', 60000, child);
    log(`fixture server up on ${base} (pid ${child.pid})`);
  } catch (e) {
    await stop();
    throw e;
  }
  return { base, port: p, pid: child.pid, stop };
}

module.exports = { SEED_NOW, seed, boot, freePort };
