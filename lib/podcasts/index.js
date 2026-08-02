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
// Coalesced-rerun state: null = none requested; '*' = a full poll; else the
// single explicit subId to re-target. Keeping the TARGET (gate fix,
// adversarial #14) means a "check now" on a paused/backed-off sub that
// arrives mid-poll still runs - a plain rerun-all would filter it back out
// after the route already answered 202.
let pollRerunTarget = null;
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
  // Captured as a PRIMITIVE at cycle start: the download loop's pause-
  // transition check compares against this, and `sub` itself can alias the
  // live db object under an in-memory loadDatabase (tests) - a reference
  // comparison would see its own future.
  const pausedAtCycleStart = sub.paused === true;

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

  // Gate fix (adversarial #2): feed-derived PROSE (title/link/description/
  // author) is REDACTED at this boundary, before persistence - a feed
  // echoing its own tokened URL in its text was the measured leak.
  // Delta-round CRITICAL D2: the GUID is normalized through guidKey - the
  // SAME decision function the filename bracket uses - NOT through
  // redactSecretText. (Round 1 DID key identity through redaction, on the
  // theory that its output was deterministic; the delta round REFUTED that
  // by measurement - redaction depends on the GLOBAL secrets map, so an
  // unrelated subscription's ?format=podcast query value rewrote THIS
  // show's episode identities: 3 duplicate records + a full re-download of
  // an untouched show. Never key identity through redaction.) guidKey is
  // leak-free by construction (a URL-shaped guid, tokened or not, becomes
  // md5; a safe-charset guid like Patreon's numeric post id stays verbatim)
  // and depends on nothing but the guid itself.
  const cleanItems = parsed.items.map((it) => ({
    ...it,
    guid: podcastPaths.guidKey(it.guid),
    title: redactSecretText(it.title, allSecretUrls),
    link: redactSecretText(it.link, allSecretUrls),
    description: redactSecretText(it.description, allSecretUrls),
  }));

  // Adopt feed metadata + resolve the show dir (name adopted only into an
  // empty user-visible name; the DIR name latches once and never follows a
  // feed retitle - a renamed feed must not orphan the existing folder).
  const adoptedTitle = redactSecretText(parsed.channel.title || '', allSecretUrls);
  const dirName = sub.showDirName || podcastPaths.sanitizeShowDirName(adoptedTitle || sub.feedUrlDisplay);
  const root = resolvePodcastsRoot(db, deps);
  const showDir = podcastPaths.resolveShowDir(root, dirName);

  // Diff guids -> backfill split -> record the new episodes.
  const knownGuids = new Set(store.episodesForSub(ns.episodes, subId).map((e) => e.guid));
  const firstPoll = knownGuids.size === 0;
  const split = store.selectBackfill(cleanItems, knownGuids, sub.backfill, firstPoll);
  await deps.updateDatabase((mdb) => {
    const mns = store.ensurePodcasts(mdb);
    store.reduceUpsertEpisodes(mns, subId, split.download, 'pending', nowMs);
    store.reduceUpsertEpisodes(mns, subId, split.skip, 'skipped', nowMs);
    store.reduceSetSubscriptionStatus(mns, subId, {
      adoptedTitle,
      adoptedShowDirName: dirName,
      author: redactSecretText(parsed.channel.author, allSecretUrls),
      description: redactSecretText(parsed.channel.description, allSecretUrls),
      secretMissing: false,
    });
    return true;
  });

  // Everything downloadable THIS cycle: fresh pendings + prior pending/failed
  // whose guid the current feed still carries (enclosure URLs are never
  // persisted - Patreon signs them with expiring tokens; always use fresh).
  // Keyed by the REDACTED guid (the stored identity); the values keep their
  // raw enclosureUrl - in memory only, needed to actually download.
  const urlByGuid = new Map(cleanItems.map((it) => [it.guid, it]));
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
    // Gate fix (adversarial #6): the targets list is a snapshot - re-read
    // the subscription each iteration so an UNSUBSCRIBE (or a pause taken
    // DURING the cycle) stops the loop at the next episode boundary instead
    // of downloading a deleted show for hours on the heavy gate. A pause
    // TRANSITION is what stops; a sub that was already paused when this
    // cycle started keeps going - that is the explicit-check bypass (an
    // explicit check on a paused sub deliberately runs, and its downloads
    // must run with it).
    const liveSub = store.readPodcasts(deps.loadDatabase()).subscriptions.find((s) => s && s.id === subId);
    if (!liveSub || (liveSub.paused === true && !pausedAtCycleStart)) {
      delete activity[subId];
      // Delta-round suggestion #4: the pause-stop path must not strand a
      // stale "pending first check" status - write an honest terminal line.
      // (The unsubscribe path has no record left to write to.)
      if (liveSub) {
        const remaining = targets.length - (downloadedCount + failedCount);
        await deps.updateDatabase((mdb) => store.reduceSetSubscriptionStatus(store.ensurePodcasts(mdb), subId, {
          lastCheckedAt: deps.now(),
          lastStatus: `paused mid-check: ${downloadedCount} downloaded, ${remaining} still queued`,
        }));
      }
      return;
    }
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
  if (pollBusy) {
    // Coalesce, preserving the explicit target; two DIFFERENT targets (or
    // any all-subs request) escalate to a full rerun.
    pollRerunTarget = (pollRerunTarget === null && onlySubId) ? onlySubId : '*';
    return;
  }
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
    if (pollRerunTarget !== null) {
      const target = pollRerunTarget === '*' ? null : pollRerunTarget;
      pollRerunTarget = null;
      setImmediate(() => { runPodcastPoll(deps, target).catch(() => {}); });
    }
  }
}

/**
 * Reconcile: a downloaded episode whose file vanished while the podcasts
 * ROOT still exists becomes `deleted-on-disk` (tombstoned - never
 * re-downloaded). TWO mount-loss guards, per the media scanner's v1.33 T4
 * lesson (server.js detectVanishedRoots - an unmounted share usually leaves
 * its mountpoint present and EMPTY, so existsSync alone is the exact guard
 * that section documents as insufficient):
 *  1. root absent -> touch nothing;
 *  2. EVERY tracked downloaded episode vanished at once while the root is
 *     present -> that is an unmount/mount-wedge signature, not a plausible
 *     organic deletion - touch nothing, log loudly. One surviving file
 *     defuses the signature (partial deletions of any size reconcile
 *     normally). Deliberate, accepted cost (same as the scanner's): truly
 *     emptying the whole library out-of-band retains stale records with a
 *     per-cycle warning instead of tombstoning; the escape hatch is
 *     deleting the subscription.
 * (v1.69 gate, adversarial CRITICAL #1 - the repro tombstoned a whole
 * archive unrecoverably across a simulated unmount before this.)
 */
async function reconcileDownloads(deps) {
  const db = deps.loadDatabase();
  const ns = store.readPodcasts(db);
  const root = resolvePodcastsRoot(db, deps);
  if (!fs.existsSync(root)) return; // mount-loss guard 1: root absent
  const gone = [];
  let tracked = 0;
  for (const id of Object.keys(ns.episodes)) {
    if (!Object.prototype.hasOwnProperty.call(ns.episodes, id)) continue;
    const ep = ns.episodes[id];
    if (!ep || ep.status !== 'downloaded' || typeof ep.filePath !== 'string' || ep.filePath === '') continue;
    // Only reconcile files under OUR root - a future external-folder episode
    // (not a thing today) would need its own root presence check.
    if (!ep.filePath.startsWith(root + path.sep)) continue;
    tracked += 1;
    if (!fs.existsSync(ep.filePath)) gone.push(id);
  }
  if (gone.length === 0) return;
  if (gone.length === tracked) {
    // Mount-loss guard 2: the empty-but-present mountpoint signature.
    console.warn(`Podcasts: every tracked episode under ${root} vanished at once - treating as an unmounted volume, tombstoning NOTHING. If you really deleted the whole library, delete the subscription(s) instead.`);
    return;
  }
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

/**
 * Reap secrets-file entries whose subscription no longer exists (gate fix,
 * adversarial #5): a pre-v1.69 backup restore rebuilds db namespaces from
 * the bundle and wipes db.podcasts, but the secrets file is deliberately
 * outside bundles - without this sweep those live credentials would be
 * unremovable forever (the delete route 404s before reaching the secret).
 * Run on add, delete, and boot. Best-effort; never throws.
 */
function sweepOrphanFeedSecrets(deps) {
  try {
    const map = secrets.loadFeedSecrets(deps.dataDir);
    const live = new Set(store.readPodcasts(deps.loadDatabase()).subscriptions.map((s) => s && s.id).filter(Boolean));
    const orphans = Object.keys(map).filter((subId) => !live.has(subId));
    if (orphans.length === 0) return;
    // Delta-round suggestion #5: ARCHIVE the reaped credentials (0600
    // .orphaned sibling) rather than destroying them - the sweep is gated
    // on a db read, and a credential store deserves the recoverable verb.
    const archived = {};
    for (const subId of orphans) { archived[subId] = map[subId]; delete map[subId]; }
    secrets.archiveOrphanedSecrets(deps.dataDir, archived);
    secrets.saveFeedSecrets(deps.dataDir, map);
    console.warn(`Podcasts: moved ${orphans.length} orphaned feed secret(s) (no owning subscription - likely a restored pre-podcasts backup) aside to the .orphaned archive.`);
  } catch { /* best-effort */ }
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
    // Zero subscriptions: no dir creation, no timer, byte-identical install
    // - EXCEPT the orphan-secret sweep, which must run exactly when the
    // subscription list is empty but a stale secrets file survives (the
    // restored-backup shape). It reads/writes only its own file and only
    // when orphans exist, so the fresh-install no-op guarantee holds (no
    // secrets file = nothing loaded, nothing written).
    sweepOrphanFeedSecrets(deps);
    return;
  }
  sweepOrphanFeedSecrets(deps);
  try { sweepPartFiles(deps); } catch { /* best-effort */ }
  reconcileDownloads(deps).catch(() => {});
  armPodcastsTimer(deps);
  // v1.69 gate suggestion #12: a boot-time warning when the podcasts root
  // sits inside (or contains) a configured library root - the config routes
  // guard saves, but FILETUBE_PODCASTS_DIR is env-set and never passes
  // through them.
  try {
    const db = deps.loadDatabase();
    const root = resolvePodcastsRoot(db, deps);
    const others = [
      ...(Array.isArray(db.folders) ? db.folders : []),
      ...((db.music && Array.isArray(db.music.folders)) ? db.music.folders : []),
      ...((db.books && Array.isArray(db.books.folders)) ? db.books.folders : []),
    ].map((f) => path.resolve(f));
    for (const other of others) {
      if (root === other || root.startsWith(other + path.sep) || other.startsWith(root + path.sep)) {
        console.warn(`Podcasts: the podcasts folder (${root}) overlaps a configured library folder (${other}) - episodes will be double-indexed and a media-side delete can tombstone them. Move FILETUBE_PODCASTS_DIR outside your library roots.`);
      }
    }
  } catch { /* best-effort */ }
}

// ---- routes ----------------------------------------------------------------

function registerRoutes(app, deps) {
  const d = { now: () => Date.now(), ...deps };

  // External (yt-dlp file-under-Podcasts) shows, deps-injected by server.js
  // (D15). Absent dep = none - the module stays self-contained in tests.
  const externalShows = (db) => {
    try { return typeof d.listExternalShows === 'function' ? (d.listExternalShows(db) || []) : []; } catch { return []; }
  };

  app.get('/api/podcasts/health', (req, res) => {
    const db = d.getCachedDatabase();
    const ns = store.readPodcasts(db);
    let episodes = 0;
    for (const id of Object.keys(ns.episodes)) {
      if (Object.prototype.hasOwnProperty.call(ns.episodes, id)) episodes += 1;
    }
    // The nav gate counts external shows too - a ytdlp-only podcast user
    // still gets the Podcasts entry.
    res.json({ shows: ns.subscriptions.length + externalShows(db).length, episodes });
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
    // (permanently "needs re-entry") than a secret without its record -
    // sweepOrphanFeedSecrets (below, run on add/delete/boot) reaps a
    // secret whose subscription never landed or was later lost.
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
      // QA delta S5: the secret was written first (deliberately) - reap it
      // now rather than leaving an orphan until the next add/delete/boot.
      sweepOrphanFeedSecrets(d);
      return res.status(500).json({ error: 'could not save the subscription' });
    }
    if (!added) return res.status(200).json({ ok: true, id, existed: true });
    // Gate fix (adversarial #3): startBackground arms no timer on a
    // zero-subscription boot, so the FIRST add must arm it here or feeds
    // never auto-check again until a restart. Idempotent (clear + re-arm).
    armPodcastsTimer(d);
    sweepOrphanFeedSecrets(d);
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
    // Gate fix (adversarial #5): reap any OTHER orphaned secret too - a
    // pre-v1.69 backup restore wipes db.podcasts but cannot touch this
    // file, leaving live credentials with no owning record and (before
    // this sweep) no removal path at all.
    sweepOrphanFeedSecrets(d);
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
    const db = d.getCachedDatabase();
    const ns = store.readPodcasts(db);
    const subs = [...ns.subscriptions].sort((a, b) => (a.order || 0) - (b.order || 0));
    res.json({ shows: [...subs.map((s) => publicSubscription(s, ns.episodes)), ...externalShows(db)] });
  });

  app.get('/api/podcasts/shows/:id/episodes', (req, res) => {
    const db = d.getCachedDatabase();
    // External (yt-dlp) shows: server-owned projection, media-item episodes.
    if (req.params.id.startsWith('yt:')) {
      let payload = null;
      try { payload = typeof d.listExternalEpisodes === 'function' ? d.listExternalEpisodes(db, req.params.id, req.user.id) : null; } catch { payload = null; }
      if (!payload) return res.status(404).json({ error: 'no such show' });
      return res.json(payload);
    }
    const ns = store.readPodcasts(db);
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
  pollRerunTarget = null;
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
  sweepOrphanFeedSecrets,
  resolvePodcastsRoot,
  publicSubscription,
  publicEpisode,
  resetPodcastsStateForTests,
  DEFAULT_POLL_MINUTES,
};
