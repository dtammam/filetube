'use strict';
/* global chrome, document, XMLSerializer */

// tools/pages/extension-probe.js - v1.395.0 Pages, plan Step 6 demo: the Chromium extension saves a
// live page. Boots the real server in-process (scratch DATA_DIR), mints a save-only Pages token the
// way Settings does (POST /api/devices, platform 'shortcut', the account password), serves an
// article from a local http server, loads extension/ UNPACKED in Chromium (a scratch copy whose
// manifest pre-grants host access - a headless run cannot click the optional-permission prompt),
// stores the instance URL + token through the extension's own storage, opens the article in a tab,
// and from an extension page runs the popup's exact capture (chrome.scripting + XMLSerializer) and
// sends { type: 'savePage' } to the extension's background worker, which POSTs to /api/pages.
// Prints the saved item as the server stores it. Run: node tools/pages/extension-probe.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-pages-ext-'));
const { app, pages, userStore, __mintTestSession } = require('../../server');
const authCrypto = require('../../lib/auth/crypto');
const pw = require(path.join(__dirname, '..', 'capture', 'node_modules', 'playwright'));

const ARTICLE = `<!doctype html><html lang="en"><head><title>The members-only boathouse report</title><meta name="author" content="Sam Rivers"></head>
<body><nav>Home | News</nav><article><h1>The members-only boathouse report</h1>
<p>${'Only signed-in readers can see this paragraph about the boathouse moving upstream. '.repeat(10)}</p>
<p>The council vote was seven to two, and the cafe stays open.</p></article>
<script>document.body.insertAdjacentHTML('beforeend', '<p id="rendered">Added by the page script after load.</p>');</script></body></html>`;

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const s0 = __mintTestSession({ username: 'testadmin' });
  userStore.updatePassword(s0.user.id, await authCrypto.hashPassword('probe-password'));
  const owner = __mintTestSession({ username: 'testadmin' });
  const paired = await fetch(base + '/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: owner.cookie }, body: JSON.stringify({ name: 'Browser extension', platform: 'shortcut', password: 'probe-password' }) }).then((r) => r.json());
  if (!paired.token) throw new Error('pairing failed: ' + JSON.stringify(paired));

  const site = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(ARTICLE); });
  site.listen(0, '127.0.0.1');
  await new Promise((r) => site.once('listening', r));
  const articleUrl = `http://127.0.0.1:${site.address().port}/news/boathouse`;

  const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ext-copy-'));
  fs.cpSync(path.join(__dirname, '..', '..', 'extension'), extDir, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-ext-profile-'));
  const ctx = await pw.chromium.launchPersistentContext(profile, {
    headless: true,
    channel: 'chromium', // the full Chromium build (new headless): the headless shell loads no extensions
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  await sw.evaluate(([instanceUrl, pagesToken]) => chrome.storage.local.set({ instanceUrl, pagesToken }), [base, paired.token]);

  const tab = await ctx.newPage();
  await tab.goto(articleUrl, { waitUntil: 'load' });
  const extPage = await ctx.newPage();
  await extPage.goto(`chrome-extension://${extId}/options.html`);
  const result = await extPage.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const target = tabs.find((t) => t.url === url);
    const [res] = await chrome.scripting.executeScript({ target: { tabId: target.id }, func: () => new XMLSerializer().serializeToString(document) });
    const status = await chrome.runtime.sendMessage({ type: 'status' });
    const saved = await chrome.runtime.sendMessage({ type: 'savePage', url, html: res.result });
    return { status, saved, htmlChars: res.result.length };
  }, articleUrl);
  console.log(JSON.stringify({ extension: manifest.version, permissions: manifest.permissions, ...result }));

  const listed = pages.service.index.listItems(owner.user.id).items;
  const item = listed[0];
  const text = item ? pages.service.readFile(item, 'text.txt') : '';
  console.log(JSON.stringify({
    savedItems: listed.length,
    title: item && item.title,
    author: item && item.author,
    source: item && pages.service.readRecord(item).source,
    readerHasRenderedParagraph: /Added by the page script after load/.test(pages.service.readFile(item, 'original.html') || ''),
    textHasArticle: /council vote was seven to two/.test(text),
  }));
  await ctx.close();
  site.close();
  server.close();
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
