'use strict';
/* global document, window, getComputedStyle */
// v1.386.0 W2: the release cache-busting proof (plan section 4: "prove a release can never leave a phone on stale
// JS / CSS"). In real engines with a PERSISTENT profile (a disk cache that survives page loads, like a phone's):
//   1. a sandbox copy of this working tree is served; its icons.js sets window.__ftBuild = 'A' and its style.css
//      sets --ft-build: "A" on :root; /music is opened and both read 'A';
//   2. /music is opened again the ordinary way: the server log shows NO request for icons.js or style.css (served
//      from cache under their versioned URLs - the speed claim), and the page still reads 'A';
//   3. a RELEASE: the server process stops, both files change to 'B', a NEW server process starts on the same
//      origin (a new container); /music is opened the ordinary way and must read 'B' for BOTH files, and the server
//      log shows each fetched once under its new version;
//   3b. build A's OLD stamps, asked for after the release, answer the new bytes with no-cache (never immutable);
//   4. the same edit made while the server keeps running (a dev box) also reaches the page.
// Prints one JSON line per engine and step; exits 1 on any failed check.
//   node tools/speed-proof/cache-bust-proof.js [chromium,webkit]
// SPEED_MUTANT=unversioned runs the negative control (a year-long cache with no version stamp): the release checks
// must FAIL there (the device keeps build A), which shows the proof can see the danger it guards against.
// SPEED_MUTANT=anyv (any ?v= cached a year): check 3b must FAIL there.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const ROOT = path.join(__dirname, '..', '..');
const { chromium, webkit } = require(path.join(ROOT, 'tools', 'capture', 'node_modules', 'playwright'));

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cachebust-'));
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT, env: Object.assign({}, process.env, { GIT_DIR: undefined, GIT_WORK_TREE: undefined }) })
    .toString('utf8').split('\0').filter(Boolean);
  for (const f of files) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src) || fs.lstatSync(src).isSymbolicLink() || !fs.statSync(src).isFile()) continue;
    fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
    fs.copyFileSync(src, path.join(dir, f));
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  if (process.env.SPEED_MUTANT === 'unversioned') {
    // the negative control: a long cache WITHOUT the version stamp (every static file a year, shells unstamped).
    // The release check below must go red against it, or this proof proves nothing.
    const f = path.join(dir, 'lib', 'staticAssets.js');
    let src = fs.readFileSync(f, 'utf8');
    const a = "const cacheControl = (typeof v === 'string' && v === entry.hash) ? IMMUTABLE : REVALIDATE;";
    const b = 'function rewriteHtml(html) {';
    if (!src.includes(a) || !src.includes(b)) throw new Error('mutant anchors missing');
    src = src.replace(a, () => 'const cacheControl = IMMUTABLE;').replace(b, () => 'function rewriteHtml(html) { return String(html);');
    fs.writeFileSync(f, src);
  }
  if (process.env.SPEED_MUTANT === 'anyv') {
    // the second negative control (gate r1 adversary): any ?v= is cached a year. Check 3b must go red against it.
    const f = path.join(dir, 'lib', 'staticAssets.js');
    const src = fs.readFileSync(f, 'utf8');
    const a = "(typeof v === 'string' && v === entry.hash) ? IMMUTABLE : REVALIDATE";
    if (!src.includes(a)) throw new Error('mutant anchor missing');
    fs.writeFileSync(f, src.replace(a, () => "(typeof v === 'string') ? IMMUTABLE : REVALIDATE"));
  }
  return dir;
}
function startServer(dir, port, reqLog) {
  const child = spawn(process.execPath, [path.join(dir, 'tools', 'speed-proof', 'serve.js'), '5'], { cwd: dir, env: Object.assign({}, process.env, { SPEED_REQLOG: reqLog, SPEED_PORT: String(port || 0) }), stdio: ['ignore', 'pipe', 'ignore'] });
  return new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; for (const line of buf.split('\n')) { if (line.startsWith('{"base"')) { const info = JSON.parse(line); info.child = child; return resolve(info); } } });
    child.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
}
const stop = (s) => new Promise((r) => { s.child.on('exit', () => r()); s.child.kill('SIGKILL'); });
function setBuild(dir, tag) {
  const js = path.join(dir, 'public', 'js', 'icons.js');
  const css = path.join(dir, 'public', 'css', 'style.css');
  const strip = (t) => t.replace(/\n;window\.__ftBuild = '[A-Z]';\n$/, '').replace(/\n:root\{--ft-build:"[A-Z]"\}\n$/, '');
  fs.writeFileSync(js, strip(fs.readFileSync(js, 'utf8')) + `\n;window.__ftBuild = '${tag}';\n`);
  fs.writeFileSync(css, strip(fs.readFileSync(css, 'utf8')) + `\n:root{--ft-build:"${tag}"}\n`);
}
const hits = (reqLog, from, re) => fs.readFileSync(reqLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r[0] >= from && re.test(r[3]));

async function main() {
  const engines = (process.argv[2] || 'chromium,webkit').split(',');
  let failed = 0;
  const check = (ok, what, extra) => { if (!ok) failed++; console.log(JSON.stringify(Object.assign({ check: what, ok }, extra || {}))); };
  for (const eng of engines) {
    const dir = sandbox();
    const reqLog = path.join(dir, 'req.jsonl'); fs.writeFileSync(reqLog, '');
    setBuild(dir, 'A');
    let s = await startServer(dir, 0, reqLog);
    const port = s.port;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-cachebust-profile-'));
    const ctx = await ({ chromium, webkit })[eng].launchPersistentContext(profile, { headless: true, viewport: { width: 390, height: 844 } });
    const login = async (info) => { await ctx.addCookies([{ name: info.cookie.name, value: info.cookie.value, url: info.base }]); };
    await login(s);
    const page = await ctx.newPage();
    const read = async () => {
      await page.goto(s.base + '/music', { waitUntil: 'load' });
      return page.evaluate(() => ({ js: window.__ftBuild || null, css: getComputedStyle(document.documentElement).getPropertyValue('--ft-build').trim().replace(/"/g, '') }));
    };
    // 1. first open
    let r = await read();
    check(r.js === 'A' && r.css === 'A', eng + ' first open runs build A', r);
    // 2. an ordinary re-open: from cache, no request for either file
    await new Promise((x) => setTimeout(x, 300));
    let from = Date.now();
    r = await read();
    const again = hits(reqLog, from, /^\/(js\/icons\.js|css\/style\.css)/);
    check(r.js === 'A' && r.css === 'A' && again.length === 0, eng + ' re-open serves both files from cache (no request)', { r, requests: again.map((x) => [x[2], x[3]]) });
    // the stamps build A's shell names (to ask for them again after the release)
    const oldStamps = fs.readFileSync(reqLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)[3])
      .filter((u) => /^\/(js\/icons\.js|css\/style\.css)\?v=/.test(u));
    // 3. a release: new files, a new server process on the same origin
    await stop(s);
    setBuild(dir, 'B');
    s = await startServer(dir, port, reqLog);
    await login(s);
    from = Date.now();
    r = await read();
    const fetched = hits(reqLog, from, /^\/(js\/icons\.js|css\/style\.css)/);
    check(r.js === 'B' && r.css === 'B', eng + ' after a release the next ordinary open runs build B (JS and CSS)', r);
    check(fetched.length === 2 && fetched.every((x) => x[2] === 200 && /\?v=[0-9a-f]{16}$/.test(x[3])), eng + ' each changed file fetched once under its new version', { requests: fetched.map((x) => [x[2], x[3]]) });
    // 3b. a page still holding build A's shell asks for its OLD stamps after the release: it gets the new bytes, and
    //     never under a year-long cache (else a rollback or a racing deploy could pin the wrong bytes to that stamp)
    const old = [];
    for (const u of [...new Set(oldStamps)]) {
      const r = await fetch(s.base + u, { headers: { Cookie: s.cookie.name + '=' + s.cookie.value } });
      const body = await r.text();
      old.push({ u, cc: r.headers.get('cache-control'), build: /'B'|"B"/.test(body.slice(-60)) ? 'B' : '?' });
    }
    check(old.length === 2 && old.every((x) => x.cc === 'no-cache' && x.build === 'B'), eng + ' an old stamp after a release answers the new bytes, revalidated (never immutable)', { old });
    // 4. an edit while the same server keeps running
    setBuild(dir, 'C');
    r = await read();
    check(r.js === 'C' && r.css === 'C', eng + ' an edit on a running server reaches the next open', r);
    await ctx.close();
    await stop(s);
  }
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
