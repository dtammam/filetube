'use strict';

// lib/pages/index.js - Pages (v1.395.0, plan docs/exec-plans/active/2026-10-25-pages.md):
// save web pages and text, read them in Reader or Original, lists, full-text
// search, Share with AI. The module map:
//
//   paths.js      validated, confined folder and file names
//   meta.js       item.json: one normalizer, one byte order
//   disk.js       the files (the source of truth) + the trash
//   indexStore.js the database index + per-user state + lists (schema v39)
//   service.js    files + index in step, inside one serial queue
//   tidy.js / entities.js   tag soup -> a tree -> well-formed markup
//   extract.js    vendored Readability (vendor/) + metadata
//   sanitize.js / css.js    the allowlist sanitizer (capture + final modes)
//   fetch.js      every outbound request, through the podcasts' SSRF guard
//   assets.js     images / stylesheets / fonts stored locally
//   capture.js    one URL save end to end
//   routes.js     the HTTP surface
//
// Always on (P1): nothing here depends on yt-dlp.

const paths = require('./paths');
const { createPagesService } = require('./service');
const { createCapture } = require('./capture');
const routes = require('./routes');

const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

function createPages({ adapter, dataDir, userStore, log = console.log, env = process.env, fetchDeps = undefined, now = () => Date.now() }) {
  const root = paths.resolvePagesRoot(dataDir, env);
  const service = createPagesService({ adapter, root, userStore, log, now });
  const capture = createCapture({ service, deps: { fetch: fetchDeps }, log, now });
  let timer = null;

  // Boot (server.js, under require.main): rebuild an empty index from the files,
  // finish images a restart interrupted, expire old trash now and every 6 hours.
  // Best effort: a failure is logged and never blocks startup.
  async function start() {
    try {
      const r = await service.rebuildIfEmpty();
      if (r.ran && r.indexed > 0) log(`[pages] rebuilt the index from ${root}: ${r.indexed} item(s)`);
    } catch (err) { log(`[pages] index rebuild at boot failed: ${err && err.message}`); }
    try { await service.purgeExpired(); } catch (err) { log(`[pages] trash expiry failed: ${err && err.message}`); }
    timer = setInterval(() => { service.purgeExpired().catch((err) => log(`[pages] trash expiry failed: ${err && err.message}`)); }, PURGE_INTERVAL_MS);
    if (timer.unref) timer.unref();
    capture.resumePending().catch((err) => log(`[pages] resuming images failed: ${err && err.message}`));
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { root, service, capture, start, stop };
}

function registerRoutes(app, deps) {
  return routes.registerPagesRoutes(app, deps);
}

module.exports = { createPages, registerRoutes, PURGE_INTERVAL_MS };
