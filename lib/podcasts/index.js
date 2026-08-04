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
const { computeTrashTarget } = require('../trashPaths');
const { redactSecretText, validateFeedUrl } = require('./feedUrl');

const DEFAULT_POLL_MINUTES = 60;
// v1.70 F1: 8 MB silently killed Dean's real cover - Patreon serves a
// 3000x3000 PNG of 15,494,765 bytes (measured live). 32 MB = 2x headroom
// over the measured real-world shape; the mid-stream abort still bounds a
// hostile image.
const COVER_MAX_BYTES = 32 * 1024 * 1024;
// Art is best-effort decoration: it gets a two-minute ceiling, never the
// episode transfer's hour (gate WARNING #3).
const COVER_TOTAL_TIMEOUT_MS = 2 * 60 * 1000;
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

/**
 * The podcasts download root: env > <dataDir>/podcasts. OPERATOR-CONTROLLED
 * ONLY, never db-controlled.
 *
 * v1.70 gate CRITICAL (delta round): this used to prefer
 * `db.podcasts.settings.downloadDir`, which rides the backup bundle - so a
 * crafted admin bundle did not need to escape the confinement root, it
 * simply MOVED the root and isConfinedUnderRoot then approved reading,
 * moving and destroying anything under the attacker's chosen directory
 * (measured: a live session-secret round-tripped out and back, its contents
 * streamed over /episode/:id). No route has ever written that field, so
 * dropping it from the chain costs nothing and closes the primitive at its
 * source rather than at each leaf. The db must never be able to relocate a
 * filesystem boundary the db's own contents are checked against.
 */
function resolvePodcastsRoot(db, deps) {
  const fromEnv = typeof process.env.FILETUBE_PODCASTS_DIR === 'string' && process.env.FILETUBE_PODCASTS_DIR !== '' ? process.env.FILETUBE_PODCASTS_DIR : null;
  return path.resolve(fromEnv || path.join(deps.dataDir, 'podcasts'));
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
    // v1.71: the per-user like (heart) state.
    liked: !!(userState && userState.liked),
    // v1.70: the trash lane's public face - the timestamp only, never the
    // server-side trashPath.
    trashedAt: Number.isFinite(ep.trashedAt) ? ep.trashedAt : null,
  };
}

/**
 * v1.70 gate CRITICAL #1: BOTH endpoints of every trash move must be
 * confined under the podcasts root. The original code checked only the
 * COMPUTED trash target - the one endpoint that cannot escape (it is built
 * from root + basename) - and left `ep.filePath`/`ep.trashPath`, which come
 * from persisted records an admin backup bundle can supply, unchecked. That
 * was an arbitrary-file read (restore FROM anywhere, then stream it via
 * /episode/:id), create (restore INTO anywhere, mkdir -p included) and
 * destroy (delete moves a system file into the trash) primitive, proven end
 * to end from a restored bundle against a live session-secret. Refuse
 * loudly; never move a byte first.
 *
 * LEXICAL, not realpath: a symlink INSIDE the root pointing outside would
 * pass (creating one already implies filesystem access, so this is a
 * documented property, not a hole). The root itself is operator-controlled
 * only - see resolvePodcastsRoot.
 * @returns {boolean} true when `candidate` resolves strictly inside `root`
 */
function isConfinedUnderRoot(candidate, root) {
  if (typeof candidate !== 'string' || candidate === '') return false;
  const resolved = path.resolve(candidate);
  const base = path.resolve(root);
  return resolved.startsWith(base + path.sep);
}

/**
 * v1.70 D3: move a file with the v1.65 posture - rename first, EXDEV falls
 * back to copy+fsync+size-verify+unlink. Throws on failure (callers map to
 * a clean 500); never leaves a half-copy at the destination. Callers MUST
 * have confined both paths (isConfinedUnderRoot) before calling.
 */
function moveFileAtomicish(fromPath, toPath) {
  try {
    fs.renameSync(fromPath, toPath);
    return;
  } catch (err) {
    if (!err || err.code !== 'EXDEV') throw err;
  }
  try {
    fs.copyFileSync(fromPath, toPath);
    const fd = fs.openSync(toPath, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (fs.statSync(toPath).size !== fs.statSync(fromPath).size) {
      throw new Error('size mismatch after cross-device copy');
    }
    fs.unlinkSync(fromPath);
  } catch (err) {
    try { fs.unlinkSync(toPath); } catch { /* best-effort undo */ }
    throw err;
  }
}

/**
 * v1.70 D4: the retention sweep over TRASHED episodes. Runs at boot and
 * after each poll cycle; never when the root is absent (mount-loss guard),
 * never touches non-'trashed' records. Purge order: unlink the trash file
 * (best-effort - a missing file still tombstones), ONE mutation tombstones
 * the batch, then the per-user rows retire (v1.65's law: trash keeps
 * state, PURGE retires it).
 */
async function sweepExpiredTrash(deps) {
  const db = deps.loadDatabase();
  const root = resolvePodcastsRoot(db, deps);
  if (!fs.existsSync(root)) return;
  const retentionDays = db && db.settings ? db.settings.trashRetentionDays : undefined;
  const ns = store.readPodcasts(db);
  const allExpired = store.selectExpiredTrashedEpisodes(ns.episodes, retentionDays, deps.now());
  // Gate delta WARNING #2: guard the BYTES and the RECORD in lockstep. The
  // unlink loop already refused unconfined trashPaths, but the tombstone
  // mutation did not - so after an operator moved FILETUBE_PODCASTS_DIR, an
  // expired episode was tombstoned, its pointer dropped and its per-user
  // rows purged while the only copy sat on the old volume forever. An id we
  // will not unlink is an id we do not retire.
  const expired = [];
  const unconfined = [];
  for (const id of allExpired) {
    const ep = ns.episodes[id];
    if (ep && isConfinedUnderRoot(ep.trashPath, root)) expired.push(id);
    else unconfined.push(id);
  }
  if (unconfined.length > 0) {
    console.warn(`Podcasts: ${unconfined.length} expired trashed episode(s) point outside the current podcasts folder - leaving both the files and the records alone (did FILETUBE_PODCASTS_DIR change?).`);
  }
  if (expired.length === 0) return;
  // Gate CRITICAL #2: the SECOND mount-loss guard, which this sweep shipped
  // without - the v1.69 headline defect re-introduced verbatim in new code
  // (existsSync alone passes an unmounted share's empty mountpoint, and the
  // unlink failure is swallowed BY DESIGN here, so a mount loss was
  // indistinguishable from a real purge: every expired episode tombstoned,
  // its trashPath dropped and its per-user rows purged while the bytes sat
  // intact on the unmounted volume, referenced by nothing).
  const tracked = [];
  for (const id of Object.keys(ns.episodes)) {
    if (!Object.prototype.hasOwnProperty.call(ns.episodes, id)) continue;
    const ep = ns.episodes[id];
    if (ep && ep.status === 'trashed' && isConfinedUnderRoot(ep.trashPath, root)) tracked.push(ep.trashPath);
  }
  if (tracked.length > 0 && tracked.every((p) => !fs.existsSync(p))) {
    console.warn(`Podcasts: every tracked trash file under ${root} is missing at once - treating as an unmounted volume, purging NOTHING.`);
    return;
  }
  for (const id of expired) {
    const ep = ns.episodes[id];
    // Belt to the pre-filter's braces: the byte-level floor stays here so a
    // future refactor of the filter above cannot reintroduce an unlink of a
    // bundle-supplied path.
    if (ep && isConfinedUnderRoot(ep.trashPath, root)) {
      try { fs.unlinkSync(ep.trashPath); } catch { /* already gone - still tombstone */ }
    }
  }
  // Delta-round-3 SUGGESTION #1: purge the rows the mutation ACTUALLY
  // tombstoned, not the pre-mutation selection - otherwise the {from} guard
  // saves the record while the user's progress/played for it is destroyed
  // anyway. Rows and record in lockstep, the same lesson as WARNING #2 one
  // layer in.
  const tombstoned = [];
  await deps.updateDatabase((mdb) => {
    const mns = store.ensurePodcasts(mdb);
    tombstoned.length = 0;
    // { from: 'trashed' } - never tombstone a record that changed state
    // between this sweep's selection and its mutation.
    for (const id of expired) {
      if (store.reduceEpisodeStatus(mns, id, 'tombstone', { from: 'trashed' })) tombstoned.push(id);
    }
    return tombstoned.length > 0;
  });
  if (tombstoned.length === 0) return;
  try { deps.userStore.removePodcastEpisodeState(tombstoned); } catch (err) {
    console.error('Podcasts: per-user purge failed after trash retention sweep:', err && err.code ? err.code : 'error');
  }
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
  // v1.73 (Dean ruling 7): finished downloads collected for ONE post-batch
  // notification record (the scan bridge's post-commit posture).
  const downloadedNotifications = [];
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

  // Show cover: the channel <itunes:image> lands as cover.jpg/png so the
  // sidecar-art convention serves it. v1.70 F1 (Dean's device find): the
  // attempt is NO LONGER coupled to this cycle's downloads - it retries on
  // EVERY poll until art exists (one oversized/failed fetch used to be
  // permanent-and-silent) - and a failure is REPORTED via the cycle status
  // (redacted lane) instead of swallowed. Art still never blocks or fails
  // the cycle itself.
  let coverFailure = null;
  if (parsed.channel.imageUrl
    && !fs.existsSync(path.join(showDir, 'cover.jpg')) && !fs.existsSync(path.join(showDir, 'cover.png'))) {
    const coverName = /\.png(\?|$)/i.test(parsed.channel.imageUrl) ? 'cover.png' : 'cover.jpg';
    try {
      // Gate CRITICAL #2 (the compounding half): mkdir RECURSIVE would
      // recreate a vanished ROOT, converting a safe mount-loss cycle into a
      // destructive one in the same tick. Only ever create the show dir
      // BELOW an already-present root.
      if (!fs.existsSync(root)) {
        // Delta-round SUGGESTION #3: name the REAL problem. Without this the
        // generic catch reported "cover art failed (unexpected)" every cycle
        // during exactly the incident an operator most needs named.
        coverFailure = 'the podcasts folder is missing - is the volume mounted?';
        throw new Error('podcasts root absent');
      }
      fs.mkdirSync(showDir, { recursive: true }); // a new-only sub may have no dir yet
      const coverResult = await (deps.downloadEnclosureImpl || fetchGuard.downloadEnclosure)(
        parsed.channel.imageUrl, showDir, coverName,
        // Gate WARNING #3: art must NOT inherit the 60-minute episode
        // ceiling - a dribbling image host defeats the idle timer and would
        // stall every poll cycle (and every episode behind it) for an hour.
        { ...(deps.transport || {}), maxBytes: COVER_MAX_BYTES, totalTimeoutMs: COVER_TOTAL_TIMEOUT_MS }
      );
      if (!coverResult || !coverResult.ok) coverFailure = coverResult ? coverResult.error : 'unknown';
    } catch {
      // Preserve a SPECIFIC diagnosis the try block already set (the
      // mount-loss line); only an unrecognized throw is 'unexpected'.
      // (Bound by test - the first version of this clobbered the specific
      // message unconditionally, which is exactly what the seat predicted
      // an unbound status string would do.)
      if (!coverFailure) coverFailure = 'unexpected'; /* downloadEnclosure never throws by contract; belt for a hostile impl */
    }
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
      // v1.73 (Dean ruling 7): a finished episode is a notification event -
      // collected here, recorded AFTER the batch (the scan bridge's
      // post-commit posture), kind CARRIED.
      downloadedNotifications.push({ mediaId: ep.id, createdAt: deps.now(), kind: 'podcast' });
    } else {
      failedCount += 1;
      await deps.updateDatabase((mdb) => store.reduceEpisodeFailed(store.ensurePodcasts(mdb), ep.id,
        redactedStatus(result ? result.error : 'download failed', allSecretUrls)));
    }
  }

  // v1.73: record the batch's notifications post-commit; push fires
  // DETACHED (the scan bridge's exact posture - a slow endpoint must never
  // stall the poll). QA gate W3: recording is UNCONDITIONAL like the scan
  // bridge - the feature flag gates DELIVERY (deliver.js checks
  // deps.enabled() itself) and the bell routes 404 while disabled, so rows
  // recorded during an off window surface the moment the feature turns on,
  // exactly as media downloads always have. A store failure is best-effort
  // (the episodes are downloaded either way).
  if (downloadedNotifications.length > 0 && deps.userStore
    && typeof deps.userStore.recordNotifications === 'function') {
    try {
      const inserted = deps.userStore.recordNotifications(downloadedNotifications);
      if (inserted > 0 && deps.pushDelivery && typeof deps.pushDelivery.trigger === 'function') {
        deps.pushDelivery.trigger('podcasts');
      }
    } catch (err) {
      console.error('Podcasts: notification record failed (continuing):', err && err.message);
    }
  }

  const newCount = split.download.length;
  const parts = [`ok: ${newCount} new`];
  if (downloadedCount) parts.push(`${downloadedCount} downloaded`);
  if (failedCount) parts.push(`${failedCount} failed`);
  if (split.skip.length) parts.push(`${split.skip.length} skipped by backfill policy`);
  if (parsed.skippedNoAudio) parts.push(`${parsed.skippedNoAudio} non-audio items ignored`);
  if (parsed.truncatedItems) parts.push(`feed truncated at ${feedLib.MAX_ITEMS} items`);
  if (coverFailure) parts.push(`cover art failed (${coverFailure})`);
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
    await sweepExpiredTrash(deps);
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
  sweepExpiredTrash(deps).catch(() => {});
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
      // QA delta S5, tightened at the adversarial hash re-confirm: reap
      // exactly THE SECRET THIS ADD JUST WROTE - never a global sweep here.
      // The global sweep on a failure path had a measured latent race
      // (tech-debt #85): any sweep firing inside ANOTHER add's secret-
      // written-but-record-pending window reaps that add's credential. The
      // scoped delete has no blast radius by construction.
      secrets.deleteFeedSecret(d.dataDir, id);
      return res.status(500).json({ error: 'could not save the subscription' });
    }
    if (!added) return res.status(200).json({ ok: true, id, existed: true });
    // Create the podcasts ROOT here, deliberately. In the read/retry/sweep
    // paths (cover retry, reconcile, the retention sweep) a missing root
    // means MOUNT LOSS, and that ambiguity is exactly what the gate's
    // CRITICAL #2 turned destructive. KNOWN pre-existing exception: the
    // episode-download path (the mkdirSync(showDir) in processSubscription)
    // also recreates the root implicitly, with no root-presence guard -
    // mount loss while a feed offers a new item lands downloads on the
    // boot disk. Zero subscriptions still creates nothing (the
    // fresh-install guarantee): this line only runs once an add has
    // genuinely landed.
    try { fs.mkdirSync(resolvePodcastsRoot(d.loadDatabase(), d), { recursive: true }); } catch (err) {
      console.error('Podcasts: could not create the podcasts folder:', err && err.code ? err.code : 'error');
    }
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
    // v1.72: the show's Playlists pins retire with the subscription (every
    // user - the delete carrier joined the pins' birth commit).
    try { d.userStore.removePodcastShowPins(req.params.id); } catch (err) {
      console.error('Podcasts: show-pin purge failed after sub delete:', err && err.code ? err.code : 'error');
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

  // ---- v1.72: show pins in the Playlists surface (intake ruling 5) --------
  // The /api/books/pins quartet, show-flavored: GET pre-shapes for the
  // shared pinned-sidebar renderer (channelDir is the field it keys on -
  // an opaque 'podcast:<subId>' here, since href always overrides the
  // /?root= fallback), POST is existence-gated on the subscription and
  // runs the pure reducer, DELETE + reorder mirror the shelf routes.
  app.get('/api/podcasts/pins', (req, res) => {
    const pins = d.userStore.getPodcastPins(req.user.id);
    res.json(pins.map((p) => ({
      id: p.id,
      channelDir: `podcast:${p.id}`,
      label: p.label,
      channelAvatarUrl: `/podcastart/${encodeURIComponent(p.id)}`,
      href: `/podcasts?show=${encodeURIComponent(p.id)}`,
    })));
  });
  app.post('/api/podcasts/pins', (req, res) => {
    const subId = req.body && typeof req.body.subId === 'string' ? req.body.subId : '';
    const ns = store.readPodcasts(d.getCachedDatabase());
    const sub = ns.subscriptions.find((s) => s && s.id === subId);
    if (!sub) return res.status(404).json({ error: 'no such subscription' });
    const result = store.reduceAddShowPin(d.userStore.getPodcastPins(req.user.id), {
      id: sub.id, label: sub.name, pinnedAt: new Date(d.now()).toISOString(),
    });
    if (result.changed) d.userStore.setPodcastPins(req.user.id, result.pins);
    res.json(result.record);
  });
  app.delete('/api/podcasts/pins/:id', (req, res) => {
    const result = store.reduceRemoveShowPin(d.userStore.getPodcastPins(req.user.id), req.params.id);
    if (!result.changed) return res.status(404).json({ error: 'no such pin' });
    d.userStore.setPodcastPins(req.user.id, result.pins);
    res.json({ ok: true });
  });
  app.post('/api/podcasts/pins/reorder', (req, res) => {
    const orderedIds = req.body ? req.body.orderedIds : undefined;
    if (!Array.isArray(orderedIds) || !orderedIds.every((u) => typeof u === 'string' && u !== '')) {
      return res.status(400).json({ error: 'orderedIds must be an array of non-empty strings' });
    }
    const reordered = store.reduceReorderShowPins(d.userStore.getPodcastPins(req.user.id), orderedIds);
    d.userStore.setPodcastPins(req.user.id, reordered);
    res.json({ ok: true });
  });

  // v1.71 T4: episode likes (the music-liked pattern). GET returns ids
  // latest-first (the store's contract). v1.75: the podcasts place's Liked
  // lane that consumed this (and filter=liked below) is REMOVED - the
  // central /?liked=1 playlist is the one read surface. Both routes stay:
  // server.js's /api/liked aggregation reads the same carrier, and both keep
  // integration coverage. Neither has a client caller today (tech-debt #105).
  app.get('/api/podcasts/liked', (req, res) => {
    res.json({ episodeIds: d.userStore.getPodcastLiked(req.user.id).map((l) => l.episodeId) });
  });
  app.post('/api/podcasts/episodes/:id/liked', (req, res) => {
    const ns = store.readPodcasts(d.getCachedDatabase());
    if (!Object.prototype.hasOwnProperty.call(ns.episodes, req.params.id)) {
      return res.status(404).json({ error: 'no such episode' }); // the phantom-id discipline
    }
    d.userStore.addPodcastLiked(req.user.id, req.params.id, new Date(d.now()).toISOString());
    res.json({ liked: true });
  });
  app.delete('/api/podcasts/episodes/:id/liked', (req, res) => {
    // Idempotent like DELETE /api/music/liked/:id - unliking the unliked
    // (or a phantom) is a no-op success.
    d.userStore.removePodcastLiked(req.user.id, req.params.id);
    res.json({ liked: false });
  });

  // v1.71: cross-show episode selections. filter=recent-listening feeds
  // home's Continue-listening row (T5), music's exact selection contract
  // (position > 0, updatedAt desc, server.js:/api/music recent-listening).
  // filter=liked fed the v1.71 Liked lane, REMOVED in v1.75 - it has no
  // client caller now (tech-debt #105) and is kept, tested, for the
  // aggregation and for a future consumer. Downloaded episodes only - a
  // selection must be playable on tap. No filter = 400: this route is a
  // selection surface, never an unbounded catalog dump.
  app.get('/api/podcasts/episodes', (req, res) => {
    const db = d.getCachedDatabase();
    const ns = store.readPodcasts(db);
    const progress = d.userStore.getPodcastProgress(req.user.id);
    const played = d.userStore.getPodcastPlayed(req.user.id);
    const likedRows = d.userStore.getPodcastLiked(req.user.id);
    const likedSet = new Set(likedRows.map((l) => l.episodeId));
    const subById = new Map(ns.subscriptions.filter(Boolean).map((s) => [s.id, s]));
    const shape = (ep) => Object.assign(publicEpisode(ep, {
      progress: Object.prototype.hasOwnProperty.call(progress, ep.id) ? progress[ep.id] : null,
      played: Object.prototype.hasOwnProperty.call(played, ep.id),
      liked: likedSet.has(ep.id),
    }), { showName: subById.has(ep.subId) ? subById.get(ep.subId).name : null });
    const filter = req.query.filter;
    let list;
    if (filter === 'liked') {
      list = likedRows
        .map((l) => (Object.prototype.hasOwnProperty.call(ns.episodes, l.episodeId) ? ns.episodes[l.episodeId] : null))
        .filter((ep) => ep && ep.status === 'downloaded');
    } else if (filter === 'recent-listening') {
      list = Object.keys(progress)
        .map((id) => (Object.prototype.hasOwnProperty.call(ns.episodes, id) ? ns.episodes[id] : null))
        .filter((ep) => ep && ep.status === 'downloaded' && Number(progress[ep.id].position) > 0)
        .sort((a, b) => String((progress[b.id] || {}).updatedAt || '').localeCompare(String((progress[a.id] || {}).updatedAt || '')));
    } else {
      return res.status(400).json({ error: 'a filter is required (liked | recent-listening)' });
    }
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 50));
    res.json({ episodes: list.slice(0, limit).map(shape) });
  });

  // v1.71 T5: single-episode resolution for the /podcasts?play= deep link
  // (a home Continue-listening card or a queue advance needs the owning
  // show before it can open the drill and start the dock).
  app.get('/api/podcasts/episodes/:id', (req, res) => {
    const db = d.getCachedDatabase();
    const ns = store.readPodcasts(db);
    if (!Object.prototype.hasOwnProperty.call(ns.episodes, req.params.id)) {
      return res.status(404).json({ error: 'no such episode' });
    }
    const ep = ns.episodes[req.params.id];
    const sub = ns.subscriptions.find((s) => s && s.id === ep.subId);
    const likedSet = new Set(d.userStore.getPodcastLiked(req.user.id).map((l) => l.episodeId));
    res.json(Object.assign(publicEpisode(ep, {
      progress: d.userStore.getOnePodcastProgress(req.user.id, ep.id),
      played: Object.prototype.hasOwnProperty.call(d.userStore.getPodcastPlayed(req.user.id), ep.id),
      liked: likedSet.has(ep.id),
    }), { showName: sub ? sub.name : null }));
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
    const liked = new Set(d.userStore.getPodcastLiked(req.user.id).map((l) => l.episodeId));
    res.json({
      show: publicSubscription(sub, ns.episodes),
      episodes: eps.map((ep) => publicEpisode(ep, {
        progress: Object.prototype.hasOwnProperty.call(progress, ep.id) ? progress[ep.id] : null,
        played: Object.prototype.hasOwnProperty.call(played, ep.id),
        liked: liked.has(ep.id),
      })),
    });
  });

  app.get('/episode/:id', (req, res) => {
    const db = d.getCachedDatabase();
    const ns = store.readPodcasts(db);
    const ep = Object.prototype.hasOwnProperty.call(ns.episodes, req.params.id) ? ns.episodes[req.params.id] : null;
    if (!ep || ep.status !== 'downloaded' || typeof ep.filePath !== 'string' || ep.filePath === '') {
      return res.status(404).json({ error: 'no such episode' });
    }
    // Delta-round CRITICAL: this route is the shortest path to an arbitrary
    // FILE READ - it serves ep.filePath, which a restored backup bundle can
    // author, and needs no trash lane or move to do it (a live
    // session-secret came back over HTTP in the seat's repro). The move
    // lanes' confinement does not cover the read; apply the same helper.
    const streamRoot = resolvePodcastsRoot(db, d);
    if (!isConfinedUnderRoot(ep.filePath, streamRoot)) {
      return res.status(404).json({ error: 'no such episode' }); // neutral: never confirm a path exists
    }
    if (!fs.existsSync(ep.filePath)) return res.status(404).json({ error: 'file missing' });
    const ext = path.extname(ep.filePath).toLowerCase();
    // v1.71 T3: ?download=1 = the app-wide save-to-device affordance (the
    // /video/:id?download=1 pattern). Same confined path, same rangeable
    // send - only the disposition header differs. The filename helper is
    // server.js's injection-safe contentDispositionAttachment, threaded in
    // via deps like sendRangeable.
    if (req.query.download === '1' && typeof d.contentDispositionAttachment === 'function') {
      res.setHeader('Content-Disposition', d.contentDispositionAttachment(ep.title || 'episode', ext));
    }
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
    // v1.78 device handoff: presence is a side effect of the ping, recorded
    // through the SHARED writer in server.js (never a second implementation
    // here - the v1.41.4 scar). Optional in the deps bundle so a test that
    // registers these routes with a partial bundle still boots.
    if (typeof d.recordPresenceFromPing === 'function') {
      d.recordPresenceFromPing(req, 'podcast', episodeId, position, Number.isFinite(duration) && duration > 0 ? duration : 0);
    }
    res.json({ ok: true });
  });

  // v1.70 D3: the recoverable delete. Only a 'downloaded' episode; the file
  // moves to <podcastsRoot>/.filetube-trash (same FS, atomic rename) and the
  // record flips in ONE mutation. Per-user rows are KEPT - restore must
  // find progress/played intact; only retention PURGE retires them.
  app.delete('/api/podcasts/episodes/:id', async (req, res) => {
    const db = d.loadDatabase();
    const ns = store.readPodcasts(db);
    const ep = Object.prototype.hasOwnProperty.call(ns.episodes, req.params.id) ? ns.episodes[req.params.id] : null;
    if (!ep) return res.status(404).json({ error: 'no such episode' });
    if (ep.status !== 'downloaded') return res.status(400).json({ error: 'only a downloaded episode can be deleted' });
    const root = resolvePodcastsRoot(db, d);
    // Gate CRITICAL #1: confine the SOURCE before touching it. A record
    // whose filePath sits outside the current root (a hostile bundle, or
    // simply FILETUBE_PODCASTS_DIR changed between boots) must never be
    // moved by this route.
    if (!isConfinedUnderRoot(ep.filePath, root)) {
      return res.status(409).json({ error: 'this episode\'s file is outside the current podcasts folder; not touching it' });
    }
    if (!fs.existsSync(ep.filePath)) {
      // The file is already gone (external deletion the reconcile has not
      // seen yet) - record the truth instead of failing the intent.
      await d.updateDatabase((mdb) => store.reduceEpisodeStatus(store.ensurePodcasts(mdb), ep.id, 'deleted-on-disk'));
      return res.json({ ok: true, status: 'deleted-on-disk' });
    }
    const { trashDir, trashPath } = computeTrashTarget(ep.filePath, ep.id, root, d.now());
    if (!isConfinedUnderRoot(trashPath, root)) {
      return res.status(500).json({ error: 'refusing a trash target outside the podcasts root' });
    }
    try {
      fs.mkdirSync(trashDir, { recursive: true });
      moveFileAtomicish(ep.filePath, trashPath);
    } catch {
      return res.status(500).json({ error: 'could not move the file to trash' });
    }
    let flipped = false;
    await d.updateDatabase((mdb) => {
      flipped = store.reduceEpisodeTrashed(store.ensurePodcasts(mdb), ep.id, { trashPath, nowMs: d.now() });
      return flipped;
    });
    if (!flipped) {
      // The record changed under us (raced) - put the bytes back rather
      // than strand them referenced by nothing.
      try { moveFileAtomicish(trashPath, ep.filePath); } catch { /* best-effort */ }
      return res.status(409).json({ error: 'the episode changed state during the delete; nothing was deleted' });
    }
    res.json({ ok: true, status: 'trashed' });
  });

  // v1.70 D3: restore from trash. Refuses to clobber an existing file at
  // the original path (409); a vanished trash file tombstones honestly (410).
  app.post('/api/podcasts/episodes/:id/restore', async (req, res) => {
    const db = d.loadDatabase();
    const ns = store.readPodcasts(db);
    const ep = Object.prototype.hasOwnProperty.call(ns.episodes, req.params.id) ? ns.episodes[req.params.id] : null;
    if (!ep) return res.status(404).json({ error: 'no such episode' });
    if (ep.status !== 'trashed') return res.status(400).json({ error: 'only a trashed episode can be restored' });
    // Gate CRITICAL #1: BOTH endpoints confined before any I/O - trashPath
    // is the read/move SOURCE and filePath the write DESTINATION, and both
    // come from a persisted record a backup bundle can author.
    const restoreRoot = resolvePodcastsRoot(db, d);
    if (!isConfinedUnderRoot(ep.trashPath, restoreRoot) || !isConfinedUnderRoot(ep.filePath, restoreRoot)) {
      return res.status(409).json({ error: 'this episode\'s paths are outside the current podcasts folder; not touching them' });
    }
    if (typeof ep.trashPath !== 'string' || !fs.existsSync(ep.trashPath)) {
      await d.updateDatabase((mdb) => store.reduceEpisodeStatus(store.ensurePodcasts(mdb), ep.id, 'tombstone'));
      try { d.userStore.removePodcastEpisodeState([ep.id]); } catch { /* best-effort */ }
      return res.status(410).json({ error: 'the trashed file no longer exists; the episode is now permanently gone' });
    }
    if (fs.existsSync(ep.filePath)) {
      return res.status(409).json({ error: 'a file already exists at the original location; not overwriting it' });
    }
    // Snapshot BEFORE the mutation below: ep aliases the live record, and a
    // racing writer (the retention sweep's tombstone) clears these fields on
    // the shared object - the move-back must not read through the alias.
    const restoreSrc = ep.trashPath;
    const restoreDst = ep.filePath;
    try {
      fs.mkdirSync(path.dirname(restoreDst), { recursive: true });
      moveFileAtomicish(restoreSrc, restoreDst);
    } catch {
      return res.status(500).json({ error: 'could not restore the file' });
    }
    let restored = false;
    await d.updateDatabase((mdb) => {
      restored = store.reduceEpisodeRestored(store.ensurePodcasts(mdb), ep.id);
      return restored;
    });
    if (!restored) {
      // The record changed under us (e.g. the retention sweep tombstoned it
      // in the one-await window after our checks) - put the bytes back in
      // trash rather than report a success that did not happen. Mirrors the
      // DELETE route's `flipped` handling.
      try { moveFileAtomicish(restoreDst, restoreSrc); } catch { /* best-effort */ }
      return res.status(409).json({ error: 'the episode changed state during the restore; nothing was restored' });
    }
    res.json({ ok: true, status: 'downloaded' });
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
  sweepExpiredTrash,
  sweepPartFiles,
  sweepOrphanFeedSecrets,
  resolvePodcastsRoot,
  isConfinedUnderRoot,
  COVER_MAX_BYTES,
  COVER_TOTAL_TIMEOUT_MS,
  publicSubscription,
  publicEpisode,
  resetPodcastsStateForTests,
  DEFAULT_POLL_MINUTES,
};
