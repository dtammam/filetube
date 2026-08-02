'use strict';

// v1.69.0 (podcasts): the wiring surface - routes, the poll loop, download
// orchestration, reconcile. Thin by design: every decision lives in the pure
// siblings (store.js / feed.js / feedUrl.js / paths.js) or the injected
// primitives; this file sequences them.
//
// Deps bundle (the lib/ytdlp circular-require-avoiding bridge, verbatim):
//   updateDatabase(mutator)  - the serialized writer
//   loadDatabase()           - fresh read (mutation-adjacent paths)
//   getCachedDatabase()      - read-cache (GET routes)
//   dataDir                  - where the secrets file lives
//   userStore                - per-user progress/played + the TENTH carrier
//   runExclusive(fn, meta)   - the server-wide heavy-job gate (lib/heavyGate)
//   sendRangeable(req,res,path,type) - the shared 206 streamer
//   now()                    - injectable clock (tests)
//   fetchFeedImpl/downloadEnclosureImpl - injectable transports (tests)
//
// Auth posture: the app's global authGate covers every route here (the
// existing LAN posture - same as music/books/ytdlp). No extra role gate.
//
// Unlike lib/ytdlp there is NO env enable flag: podcasts is a first-class
// place like Music - routes always exist, and the CLIENT gates the nav on
// content (zero subscriptions = byte-identical chrome, enforced by test).
// What IS gated: no directory is created, no timer armed, no file written
// until the first subscription exists.

const fs = require('fs');
const path = require('path');
const store = require('./store');
const secrets = require('./secrets');
const feedLib = require('./feed');
const fetchGuard = require('./fetchGuard');
const podcastPaths = require('./paths');
const { redactSecretText, validateFeedUrl } = require('./feedUrl');

const DEFAULT_POLL_MINUTES = 60;
const COVER_MAX_BYTES = 8 * 1024 * 1024;
const CONTENT_TYPES = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.wav': 'audio/wav',
};

// ---- module state (single process, single poll pipeline) ------------------
let pollBusy = false;
let pollRerunRequested = false;
let podcastsPollTimer = null;
// Live per-sub activity for the status route: { [subId]: {state, detail} }.
const activity = Object.create(null);

/** The podcasts download root: settings override > env > <dataDir>/podcasts. */
function resolvePodcastsRoot(db, deps) {
  const ns = store.readPodcasts(db);
  const fromSettings = typeof ns.settings.downloadDir === 'string' && ns.settings.downloadDir !== '' ? ns.settings.downloadDir : null;
  const fromEnv = typeof process.env.FILETUBE_PODCASTS_DIR === 'string' && process.env.FILETUBE_PODCASTS_DIR !== '' ? process.env.FILETUBE_PODCASTS_DIR : null;
  return path.resolve(fromSettings || fromEnv || path.join(deps.dataDir, 'podcasts'));
}

function pollMinutesFrom(db) {
  const ns = store.readPodcasts(db);
  const v = ns.settings.pollMinutes;
  if (Number.isInteger(v) && v >= 0) return v; // 0 = manual-only
  return DEFAULT_POLL_MINUTES;
}

/** Compose + redact a status line. `secretUrls` = every stored feed URL. */
function redactedStatus(text, secretUrls) {
  return redactSecretText(String(text || ''), secretUrls).slice(0, store.MAX_STATUS_LENGTH);
}

/** Public projection of a subscription record + derived episode counts. */
function publicSubscription(sub, episodes) {
  const eps = store.episodesForSub(episodes, sub.id);
  let downloaded = 0, pending = 0, failed = 0;
  for (const e of eps) {
    if (e.status === 'downloaded') downloaded += 1;
    else if (e.status === 'pending') pending += 1;
    else if (e.status === 'failed') failed += 1;
  }
  return {
    id: sub.id,
    name: sub.name || sub.feedUrlDisplay,
    feedUrlDisplay: sub.feedUrlDisplay,
    feedHost: sub.feedHost,
    author: sub.author,
    description: sub.description,
    paused: sub.paused === true,
    backfill: sub.backfill,
    order: sub.order,
    addedAt: sub.addedAt,
    lastCheckedAt: sub.lastCheckedAt,
    lastStatus: sub.lastStatus,
    secretMissing: sub.secretMissing === true,
    episodeCount: eps.length,
    downloadedCount: downloaded,
    pendingCount: pending,
    failedCount: failed,
    newestPubDateMs: eps.length ? (eps[0].pubDateMs || null) : null,
    activity: Object.prototype.hasOwnProperty.call(activity, sub.id) ? activity[sub.id] : null,
  };
}

/** Public projection of an episode (never the enclosure URL - not stored). */
function publicEpisode(ep, userState) {
  return {
    id: ep.id,
    subId: ep.subId,
    title: ep.title,
    description: ep.description,
    link: ep.link,
    pubDateMs: ep.pubDateMs,
    durationSec: ep.durationSec,
    status: ep.status,
    bytes: ep.bytes,
    downloadedAt: ep.downloadedAt,
    progress: userState && userState.progress ? userState.progress : null,
    played: !!(userState && userState.played),
  };
}

// ---- the poll cycle --------------------------------------------------------

/**
 * One subscription's check-and-download cycle. Runs OUTSIDE any db lock;
 * every db touch is its own short updateDatabase mutation (the ytdlp law:
 * long downloads never hold the writer).
 */
async function processSubscription(deps, subId) {
  const nowMs = deps.now();
  const db = deps.loadDatabase();
  const ns = store.readPodcasts(db);
  const sub = ns.subscriptions.find((s) => s && s.id === subId);
  // Paused/backoff filtering happens at TARGET SELECTION (runPodcastPoll) -
  // an explicit per-sub check deliberately bypasses both, so this function
  // must not re-check them (the ytdlp repull precedent).
  if (!sub) return;

  const secretMap = secrets.loadFeedSecrets(deps.dataDir);
  const allSecretUrls = Object.values(secretMap);
  const feedUrl = secretMap[subId];
  if (!feedUrl) {
    await deps.updateDatabase((mdb) => store.reduceSetSubscriptionStatus(store.ensurePodcasts(mdb), subId, {
      lastCheckedAt: nowMs,
      lastStatus: 'feed URL needs re-entry (restored without its token?)',
      secretMissing: true,
    }));
    return;
  }

  activity[subId] = { state: 'checking', detail: '' };
  const fetched = await (deps.fetchFeedImpl || fetchGuard.fetchFeed)(feedUrl, deps.transport || {});
  if (!fetched.ok) {
    const failures = (Number.isInteger(sub.checkFailures) ? sub.checkFailures : 0) + 1;
    await deps.updateDatabase((mdb) => store.reduceSetSubscriptionStatus(store.ensurePodcasts(mdb), subId, {
      lastCheckedAt: nowMs,
      lastStatus: redactedStatus(`error: feed fetch failed (${fetched.error})`, allSecretUrls),
      checkFailures: failures,
      backoffUntil: store.computeFeedBackoff(failures, nowMs),
      secretMissing: false,
    }));
    delete activity[subId];
    return;
  }

  const parsed = feedLib.parsePodcastFeed(fetched.body);
  if (!parsed.ok) {
    const failures = (Number.isInteger(sub.checkFailures) ? sub.checkFailures : 0) + 1;
    await deps.updateDatabase((mdb) => store.reduceSetSubscriptionStatus(store.ensurePodcasts(mdb), subId, {
      lastCheckedAt: nowMs,
      lastStatus: redactedStatus(`error: ${parsed.error}`, allSecretUrls),
      checkFailures: failures,
      backoffUntil: store.computeFeedBackoff(failures, nowMs),
      secretMissing: false,
    }));
    delete activity[subId];
    return;
  }

  // Adopt feed metadata + resolve the show dir (name adopted only into an
  // empty user-visible name; the DIR name latches once and never follows a
  // feed retitle - a renamed feed must not orphan the existing folder).
  const adoptedTitle = parsed.channel.title || '';
  const dirName = sub.showDirName || podcastPaths.sanitizeShowDirName(adoptedTitle || sub.feedUrlDisplay);
  const root = resolvePodcastsRoot(db, deps);
  const showDir = podcastPaths.resolveShowDir(root, dirName);

  // Diff guids -> backfill split -> record the new episodes.
  const knownGuids = new Set(store.episodesForSub(ns.episodes, subId).map((e) => e.guid));
  const firstPoll = knownGuids.size === 0;
  const split = store.selectBackfill(parsed.items, knownGuids, sub.backfill, firstPoll);
  await deps.updateDatabase((mdb) => {
    const mns = store.ensurePodcasts(mdb);
    store.reduceUpsertEpisodes(mns, subId, split.download, 'pending', nowMs);
    store.reduceUpsertEpisodes(mns, subId, split.skip, 'skipped', nowMs);
    store.reduceSetSubscriptionStatus(mns, subId, {
      adoptedTitle,
      adoptedShowDirName: dirName,
      author: parsed.channel.author,
      description: parsed.channel.description,
      secretMissing: false,
    });
    return true;
  });

  // Everything downloadable THIS cycle: fresh pendings + prior pending/failed
  // whose guid the current feed still carries (enclosure URLs are never
  // persisted - Patreon signs them with expiring tokens; always use fresh).
  const urlByGuid = new Map(parsed.items.map((it) => [it.guid, it]));
  const db2 = deps.loadDatabase();
  const targets = store.episodesForSub(store.readPodcasts(db2).episodes, subId)
    .filter((e) => (e.status === 'pending' || e.status === 'failed') && urlByGuid.has(e.guid));

  let downloadedCount = 0, failedCount = 0;
  if (targets.length > 0) {
    try {
      fs.mkdirSync(showDir, { recursive: true });
    } catch {
      await deps.updateDatabase((mdb) => store.reduceSetSubscriptionStatus(store.ensurePodcasts(mdb), subId, {
        lastCheckedAt: nowMs,
        lastStatus: 'error: cannot create the show directory',
      }));
      delete activity[subId];
      return;
    }
  }

  // Show cover (best-effort, once): the channel <itunes:image> lands as
  // cover.jpg/png so the sidecar-art convention serves it. Failures are
  // silent by design - art must never block or fail a download cycle.
  const coverName = /\.png(\?|$)/i.test(parsed.channel.imageUrl || '') ? 'cover.png' : 'cover.jpg';
  if (parsed.channel.imageUrl && targets.length > 0
    && !fs.existsSync(path.join(showDir, 'cover.jpg')) && !fs.existsSync(path.join(showDir, 'cover.png'))) {
    try {
      await (deps.downloadEnclosureImpl || fetchGuard.downloadEnclosure)(
        parsed.channel.imageUrl, showDir, coverName, { ...(deps.transport || {}), maxBytes: COVER_MAX_BYTES }
      );
    } catch { /* downloadEnclosure never throws by contract; belt for a hostile impl */ }
  }

  for (const ep of targets) {
    const item = urlByGuid.get(ep.guid);
    const fileName = podcastPaths.episodeFileName(ep.title || item.title, ep.guid, item.enclosureUrl);
    activity[subId] = { state: 'downloading', detail: `${downloadedCount + failedCount + 1}/${targets.length}` };
    const result = await deps.runExclusive(
      () => (deps.downloadEnclosureImpl || fetchGuard.downloadEnclosure)(item.enclosureUrl, showDir, fileName, deps.transport || {}),
      { kind: 'podcast', label: sub.name || dirName, jobId: ep.id }
    );
    if (result && result.ok) {
      downloadedCount += 1;
      await deps.updateDatabase((mdb) => store.reduceEpisodeDownloaded(store.ensurePodcasts(mdb), ep.id, {
        fileName, filePath: result.filePath, bytes: result.bytes, nowMs: deps.now(),
      }));
    } else {
      failedCount += 1;
      await deps.updateDatabase((mdb) => store.reduceEpisodeFailed(store.ensurePodcasts(mdb), ep.id,
        redactedStatus(result ? result.error : 'download failed', allSecretUrls)));
    }
  }

  const newCount = split.download.length;
  const parts = [`ok: ${newCount} new`];
  if (downloadedCount) parts.push(`${downloadedCount} downloaded`);
  if (failedCount) parts.push(`${failedCount} failed`);
  if (split.skip.length) parts.push(`${split.skip.length} skipped by backfill policy`);
  if (parsed.skippedNoAudio) parts.push(`${parsed.skippedNoAudio} non-audio items ignored`);
  if (parsed.truncatedItems) parts.push(`feed truncated at ${feedLib.MAX_ITEMS} items`);
  await deps.updateDatabase((mdb) => store.reduceSetSubscriptionStatus(store.ensurePodcasts(mdb), subId, {
    lastCheckedAt: deps.now(),
    lastStatus: redactedStatus(parts.join(', '), allSecretUrls),
    checkFailures: 0,
    backoffUntil: 0,
  }));
  delete activity[subId];
}

/**
 * The poll entry: all-subs (timer) or one sub (manual check). Single-flight
 * with one coalesced rerun (the ytdlp posture, simplified).
 */
async function runPodcastPoll(deps, onlySubId) {
  if (pollBusy) { pollRerunRequested = true; return; }
  pollBusy = true;
  try {
    const nowMs = deps.now();
    const ns = store.readPodcasts(deps.loadDatabase());
    const targets = ns.subscriptions.filter((s) => {
      if (!s || (onlySubId && s.id !== onlySubId)) return false;
      if (onlySubId) return true; // an explicit check bypasses pause + backoff
      return s.paused !== true && !store.isInFeedBackoff(s, nowMs);
    });
    for (const sub of targets) {
      try {
        await processSubscription(deps, sub.id);
      } catch (err) {
        // A cycle bug must not kill the loop for later subs. Status carries
        // a REDACTED, code-only description - never err.message verbatim
        // (Node embeds full URLs in transport errors).
        delete activity[sub.id];
        try {
          await deps.updateDatabase((mdb) => store.reduceSetSubscriptionStatus(store.ensurePodcasts(mdb), sub.id, {
            lastCheckedAt: deps.now(),
            lastStatus: `error: internal (${err && err.code ? err.code : 'unexpected'})`,
          }));
        } catch { /* the writer itself failed - nothing safe to do */ }
      }
    }
    await reconcileDownloads(deps);
  } finally {
    pollBusy = false;
    if (pollRerunRequested) {
      pollRerunRequested = false;
      setImmediate(() => { runPodcastPoll(deps, null).catch(() => {}); });
    }
  }
}

/**
 * Reconcile: a downloaded episode whose file vanished while the podcasts
 * ROOT still exists becomes `deleted-on-disk` (tombstoned - never
 * re-downloaded). Root missing = the MOUNT-LOSS GUARD: touch nothing.
 */
async function reconcileDownloads(deps) {
  const db = deps.loadDatabase();
  const ns = store.readPodcasts(db);
  const root = resolvePodcastsRoot(db, deps);
  if (!fs.existsSync(root)) return; // mount-loss guard
  const gone = [];
  for (const id of Object.keys(ns.episodes)) {
    if (!Object.prototype.hasOwnProperty.call(ns.episodes, id)) continue;
    const ep = ns.episodes[id];
    if (!ep || ep.status !== 'downloaded' || typeof ep.filePath !== 'string' || ep.filePath === '') continue;
    // Only reconcile files under OUR root - a future external-folder episode
    // (not a thing today) would need its own root presence check.
    if (!ep.filePath.startsWith(root + path.sep)) continue;
    if (!fs.existsSync(ep.filePath)) gone.push(id);
  }
  if (gone.length === 0) return;
  await deps.updateDatabase((mdb) => {
    const mns = store.ensurePodcasts(mdb);
    let changed = false;
    for (const id of gone) changed = store.reduceEpisodeStatus(mns, id, 'deleted-on-disk') || changed;
    return changed;
  });
  // The per-user rows for a deleted-on-disk episode stay: the file may come
  // back (a restored backup of the media volume) and history is cheap.
}

/** Sweep orphaned .ptpart temps (crash leftovers) under the root. Bounded: root + one level of show dirs. */
function sweepPartFiles(deps) {
  const root = resolvePodcastsRoot(deps.loadDatabase(), deps);
  if (!fs.existsSync(root)) return;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (f.startsWith('.') && f.endsWith(podcastPaths.PART_SUFFIX)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* best-effort */ }
      }
    }
  }
}

// ---- timer + boot ----------------------------------------------------------

function armPodcastsTimer(deps) {
  if (podcastsPollTimer) { clearInterval(podcastsPollTimer); podcastsPollTimer = null; }
  const minutes = pollMinutesFrom(deps.loadDatabase());
  if (minutes <= 0) return; // manual-only
  podcastsPollTimer = setInterval(() => {
    runPodcastPoll(deps, null).catch((err) => {
      console.error('Podcasts poll tick failed:', err && err.code ? err.code : 'error');
    });
  }, minutes * 60 * 1000);
  if (podcastsPollTimer.unref) podcastsPollTimer.unref();
}

/** Boot: cheap hygiene only (sweep + reconcile + arm). No network. */
function startBackground(deps) {
  const ns = store.readPodcasts(deps.loadDatabase());
  if (ns.subscriptions.length === 0) {
    // Zero subscriptions: no dir creation, no timer, byte-identical install.
    return;
  }
  try { sweepPartFiles(deps); } catch { /* best-effort */ }
  reconcileDownloads(deps).catch(() => {});
  armPodcastsTimer(deps);
}

// ---- routes ----------------------------------------------------------------

function registerRoutes(app, deps) {
  const d = { now: () => Date.now(), ...deps };

  app.get('/api/podcasts/health', (req, res) => {
    const ns = store.readPodcasts(d.getCachedDatabase());
    let episodes = 0;
    for (const id of Object.keys(ns.episodes)) {
      if (Object.prototype.hasOwnProperty.call(ns.episodes, id)) episodes += 1;
    }
    res.json({ shows: ns.subscriptions.length, episodes });
  });

  app.get('/api/podcasts/subscriptions', (req, res) => {
    const ns = store.readPodcasts(d.getCachedDatabase());
    const subs = [...ns.subscriptions].sort((a, b) => (a.order || 0) - (b.order || 0));
    res.json({ subscriptions: subs.map((s) => publicSubscription(s, ns.episodes)) });
  });

  app.post('/api/podcasts/subscriptions', async (req, res) => {
    const input = store.validateAddInput(req.body || {});
    if (!input.ok) return res.status(400).json({ error: input.error });
    const id = store.subscriptionIdFor(input.feed.url);
    // Secret first: a record without its secret is a worse failure mode
    // (permanently "needs re-entry") than a secret without its record
    // (overwritten or orphan-cleaned on the next add/delete).
    if (!secrets.setFeedSecret(d.dataDir, id, input.feed.url)) {
      return res.status(500).json({ error: 'could not store the feed URL' });
    }
    let added = false;
    try {
      await d.updateDatabase((mdb) => {
        const mns = store.ensurePodcasts(mdb);
        const record = store.subscriptionRecordFrom({ id, feed: input.feed, name: input.name, backfill: input.backfill, nowMs: d.now(), order: 0 });
        added = store.reduceAddSubscription(mns, record);
        return added;
      });
    } catch {
      return res.status(500).json({ error: 'could not save the subscription' });
    }
    if (!added) return res.status(200).json({ ok: true, id, existed: true });
    // First check + backfill kick off in the background; the UI polls status.
    setImmediate(() => { runPodcastPoll(d, id).catch(() => {}); });
    res.status(201).json({ ok: true, id });
  });

  app.patch('/api/podcasts/subscriptions/:id', async (req, res) => {
    const v = store.validatePatch(req.body || {});
    if (!v.ok) return res.status(400).json({ error: v.error });
    let found = false;
    await d.updateDatabase((mdb) => {
      found = store.reduceUpdateSubscription(store.ensurePodcasts(mdb), req.params.id, v.patch);
      return found;
    });
    if (!found) return res.status(404).json({ error: 'no such subscription' });
    res.json({ ok: true });
  });

  app.delete('/api/podcasts/subscriptions/:id', async (req, res) => {
    let removedEpisodeIds = false;
    await d.updateDatabase((mdb) => {
      removedEpisodeIds = store.reduceDeleteSubscription(store.ensurePodcasts(mdb), req.params.id);
      return removedEpisodeIds !== false;
    });
    if (removedEpisodeIds === false) return res.status(404).json({ error: 'no such subscription' });
    // Post-commit carriers (the removeMediaState ordering): per-user rows,
    // then the secret. Files on disk are NOT touched - disclosed in the UI.
    try { d.userStore.removePodcastEpisodeState(removedEpisodeIds); } catch (err) {
      console.error('Podcasts: per-user state purge failed after sub delete:', err && err.code ? err.code : 'error');
    }
    secrets.deleteFeedSecret(d.dataDir, req.params.id);
    res.json({ ok: true, filesKept: true });
  });

  // Secret re-entry (the restored-backup lane). The URL must be the SAME
  // feed: its display form has to match the record - a rotated token passes,
  // a different feed does not.
  app.post('/api/podcasts/subscriptions/:id/feed-url', async (req, res) => {
    const body = req.body || {};
    const v = validateFeedUrl(body.feedUrl);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const ns = store.readPodcasts(d.loadDatabase());
    const sub = ns.subscriptions.find((s) => s && s.id === req.params.id);
    if (!sub) return res.status(404).json({ error: 'no such subscription' });
    if (v.display !== sub.feedUrlDisplay) {
      return res.status(400).json({ error: 'that URL is a different feed than this subscription' });
    }
    if (!secrets.setFeedSecret(d.dataDir, sub.id, v.url)) {
      return res.status(500).json({ error: 'could not store the feed URL' });
    }
    await d.updateDatabase((mdb) => store.reduceSetSubscriptionStatus(store.ensurePodcasts(mdb), sub.id, { secretMissing: false, lastStatus: 'feed URL updated' }));
    setImmediate(() => { runPodcastPoll(d, sub.id).catch(() => {}); });
    res.json({ ok: true });
  });

  app.post('/api/podcasts/subscriptions/:id/check', (req, res) => {
    const ns = store.readPodcasts(d.getCachedDatabase());
    if (!ns.subscriptions.some((s) => s && s.id === req.params.id)) {
      return res.status(404).json({ error: 'no such subscription' });
    }
    setImmediate(() => { runPodcastPoll(d, req.params.id).catch(() => {}); });
    res.status(202).json({ accepted: true });
  });

  app.post('/api/podcasts/check', (req, res) => {
    setImmediate(() => { runPodcastPoll(d, null).catch(() => {}); });
    res.status(202).json({ accepted: true });
  });

  app.get('/api/podcasts/status', (req, res) => {
    res.json({ polling: pollBusy, activity: { ...activity } });
  });

  app.get('/api/podcasts/shows', (req, res) => {
    const ns = store.readPodcasts(d.getCachedDatabase());
    const subs = [...ns.subscriptions].sort((a, b) => (a.order || 0) - (b.order || 0));
    res.json({ shows: subs.map((s) => publicSubscription(s, ns.episodes)) });
  });

  app.get('/api/podcasts/shows/:id/episodes', (req, res) => {
    const ns = store.readPodcasts(d.getCachedDatabase());
    const sub = ns.subscriptions.find((s) => s && s.id === req.params.id);
    if (!sub) return res.status(404).json({ error: 'no such show' });
    const eps = store.episodesForSub(ns.episodes, sub.id);
    const progress = d.userStore.getPodcastProgress(req.user.id);
    const played = d.userStore.getPodcastPlayed(req.user.id);
    res.json({
      show: publicSubscription(sub, ns.episodes),
      episodes: eps.map((ep) => publicEpisode(ep, {
        progress: Object.prototype.hasOwnProperty.call(progress, ep.id) ? progress[ep.id] : null,
        played: Object.prototype.hasOwnProperty.call(played, ep.id),
      })),
    });
  });

  app.get('/episode/:id', (req, res) => {
    const ns = store.readPodcasts(d.getCachedDatabase());
    const ep = Object.prototype.hasOwnProperty.call(ns.episodes, req.params.id) ? ns.episodes[req.params.id] : null;
    if (!ep || ep.status !== 'downloaded' || typeof ep.filePath !== 'string' || ep.filePath === '') {
      return res.status(404).json({ error: 'no such episode' });
    }
    if (!fs.existsSync(ep.filePath)) return res.status(404).json({ error: 'file missing' });
    const ext = path.extname(ep.filePath).toLowerCase();
    d.sendRangeable(req, res, ep.filePath, CONTENT_TYPES[ext] || 'application/octet-stream');
  });

  app.get('/podcastart/:subId', (req, res) => {
    const db = d.getCachedDatabase();
    const ns = store.readPodcasts(db);
    const sub = ns.subscriptions.find((s) => s && s.id === req.params.subId);
    if (sub && sub.showDirName) {
      const root = resolvePodcastsRoot(db, d);
      let showDir;
      try { showDir = podcastPaths.resolveShowDir(root, sub.showDirName); } catch { showDir = null; }
      if (showDir) {
        for (const name of ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png']) {
          const p = path.join(showDir, name);
          if (fs.existsSync(p)) {
            res.set('Cache-Control', 'public, max-age=86400');
            return res.sendFile(p);
          }
        }
      }
    }
    // Escaped-SVG placeholder (the /albumart posture).
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#2b3e50"/><text x="150" y="160" font-size="90" text-anchor="middle" fill="#ffffff" font-family="sans-serif">&#127911;</text></svg>');
  });

  // The player controller reads progress at `progressEndpoint + '/' + id`
  // before an episode starts (the resumeMode 'podcast' branch). Shape
  // mirrors what the write below stores; a never-played episode reads 0s.
  app.get('/api/podcasts/progress/:episodeId', (req, res) => {
    const row = d.userStore.getOnePodcastProgress(req.user.id, req.params.episodeId);
    res.json(row || { position: 0, duration: null, updatedAt: null });
  });

  app.post('/api/podcasts/progress', (req, res) => {
    const body = req.body || {};
    // Two accepted shapes: the podcasts UI's {episodeId, position} and the
    // shared player controller's generic {id, timestamp} (the body shape
    // saveProgressToServer posts to every progressEndpoint - the music
    // route accepts it the same way).
    const episodeId = typeof body.episodeId === 'string' ? body.episodeId
      : typeof body.id === 'string' ? body.id : '';
    const position = Number(body.position !== undefined ? body.position : body.timestamp);
    const duration = Number(body.duration);
    if (episodeId === '' || !Number.isFinite(position) || position < 0) {
      return res.status(400).json({ error: 'episodeId and a non-negative position are required' });
    }
    const ns = store.readPodcasts(d.getCachedDatabase());
    if (!Object.prototype.hasOwnProperty.call(ns.episodes, episodeId)) {
      return res.status(400).json({ error: 'no such episode' }); // the phantom-id discipline
    }
    d.userStore.setPodcastProgress(req.user.id, episodeId, {
      position,
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      updatedAt: new Date(d.now()).toISOString(),
    });
    // The >=95% auto-latch (D10) - server-side so every playback surface counts.
    if (Number.isFinite(duration) && duration > 0 && position / duration >= 0.95) {
      d.userStore.setPodcastPlayed(req.user.id, episodeId, new Date(d.now()).toISOString());
    }
    res.json({ ok: true });
  });

  app.post('/api/podcasts/episodes/:id/played', (req, res) => {
    const ns = store.readPodcasts(d.getCachedDatabase());
    if (!Object.prototype.hasOwnProperty.call(ns.episodes, req.params.id)) {
      return res.status(400).json({ error: 'no such episode' });
    }
    const wantPlayed = !(req.body && req.body.played === false);
    if (wantPlayed) d.userStore.setPodcastPlayed(req.user.id, req.params.id, new Date(d.now()).toISOString());
    else d.userStore.clearPodcastPlayed(req.user.id, req.params.id);
    res.json({ ok: true, played: wantPlayed });
  });

  app.get('/api/podcasts/settings', (req, res) => {
    const db = d.getCachedDatabase();
    res.json({
      pollMinutes: pollMinutesFrom(db),
      downloadDir: resolvePodcastsRoot(db, d),
    });
  });

  app.post('/api/podcasts/settings', async (req, res) => {
    const body = req.body || {};
    if (body.pollMinutes === undefined) return res.status(400).json({ error: 'nothing to update' });
    const v = Number(body.pollMinutes);
    if (!Number.isInteger(v) || v < 0 || v > 7 * 24 * 60) {
      return res.status(400).json({ error: 'pollMinutes must be an integer 0..10080 (0 = manual only)' });
    }
    await d.updateDatabase((mdb) => {
      const mns = store.ensurePodcasts(mdb);
      mns.settings.pollMinutes = v;
      return true;
    });
    armPodcastsTimer(d); // re-arm live, the armScanTimer contract
    res.json({ ok: true, pollMinutes: v });
  });
}

// Test-only reset (the ytdlp resetForTests convention).
function resetPodcastsStateForTests() {
  pollBusy = false;
  pollRerunRequested = false;
  if (podcastsPollTimer) { clearInterval(podcastsPollTimer); podcastsPollTimer = null; }
  for (const k of Object.keys(activity)) delete activity[k];
}

module.exports = {
  registerRoutes,
  startBackground,
  armPodcastsTimer,
  runPodcastPoll,
  processSubscription,
  reconcileDownloads,
  sweepPartFiles,
  resolvePodcastsRoot,
  publicSubscription,
  publicEpisode,
  resetPodcastsStateForTests,
  DEFAULT_POLL_MINUTES,
};
