'use strict';
// v1.381.0 Feed, TikTok style (plan D10): WHY do items the user never really started show as "Continue"?
// A READ-ONLY report over a FileTube database (opened with readOnly: true; it never writes). For every user it lists
// what the Feed (before v1.381.0's one-minute rule) would call "Continue" - a video in progress (above the 0.5% watching floor, under 90%, not watched),
// an episode with any position above 0 s and not played, a book with a stored place and not finished - and sorts each
// one by:
//   - how far in it really is (under 60 s / 60 s - 5 min / more; books: still in the first chapter or not),
//   - whether a FEED session moved it (its session record's `moves` name the item): the feed wrote that place.
// Run it on the server, inside the container (DATA_DIR is /app/data in the image):
//   node scripts/feed-stale-continue.js /app/data/filetube.db            # a summary per user
//   node scripts/feed-stale-continue.js /app/data/filetube.db --items    # plus every item, oldest first
// Not a CI gate: a measurement tool (test/integration/feed-stale-continue.test.js binds what it reports). Node 22.5+ (node:sqlite).

const { openReadOnlyQuery } = require('../lib/db/sqlite'); // the one node:sqlite module; readOnly at the driver

const WATCHING_MIN_PCT = 0.5; // lib/videoQuery.js
const WATCHED_PCT = 90;

function bucketSec(sec) {
  if (!(sec >= 0)) return 'unknown';
  if (sec < 60) return 'under 1 min';
  if (sec < 300) return '1-5 min';
  return 'over 5 min';
}

function main() {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/feed-stale-continue.js <path to filetube.db> [--items]'); process.exit(2); }
  const showItems = process.argv.includes('--items');
  const db = openReadOnlyQuery(file);
  const all = db.all;
  const hasTable = (t) => all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", t).length === 1;
  const users = all('SELECT id, username FROM users ORDER BY id');
  const report = [];
  for (const u of users) {
    // every (kind, id) a feed session moved, with the earliest move time
    const fed = new Map();
    let sessions = 0;
    if (hasTable('user_feed_sessions')) {
      for (const s of all('SELECT summary_json FROM user_feed_sessions WHERE user_id = ?', u.id)) {
        sessions += 1;
        let sum = null;
        try { sum = JSON.parse(s.summary_json || 'null'); } catch (_) { sum = null; }
        for (const m of (sum && Array.isArray(sum.moves) ? sum.moves : [])) {
          if (!m || typeof m.id !== 'string') continue;
          const k = `${m.kind}:${m.id}`;
          if (!fed.has(k) || String(m.at) < fed.get(k)) fed.set(k, String(m.at || ''));
        }
      }
    }
    const items = [];
    const watched = new Set(all('SELECT media_id FROM user_watched WHERE user_id = ?', u.id).map((r) => r.media_id));
    for (const r of all('SELECT media_id, timestamp, duration, updated_at FROM user_progress WHERE user_id = ?', u.id)) {
      const ts = Number(r.timestamp) || 0;
      const dur = Number(r.duration) || 0;
      const pct = dur > 0 ? (ts / dur) * 100 : 0;
      if (watched.has(r.media_id) || pct <= WATCHING_MIN_PCT || pct >= WATCHED_PCT) continue;
      items.push({ kind: 'video', id: r.media_id, at: r.updated_at || '', sec: Math.round(ts), pct: Math.round(pct * 10) / 10, bucket: bucketSec(ts), feed: fed.has(`media:${r.media_id}`) });
    }
    if (hasTable('user_podcast_progress')) {
      const played = new Set(all('SELECT episode_id FROM user_podcast_played WHERE user_id = ?', u.id).map((r) => r.episode_id));
      for (const r of all('SELECT episode_id, position_seconds, duration_seconds, updated_at FROM user_podcast_progress WHERE user_id = ?', u.id)) {
        const pos = Number(r.position_seconds) || 0;
        if (played.has(r.episode_id) || !(pos > 0)) continue;
        const dur = Number(r.duration_seconds) || 0;
        items.push({ kind: 'podcast', id: r.episode_id, at: r.updated_at || '', sec: Math.round(pos), pct: dur > 0 ? Math.round((pos / dur) * 1000) / 10 : null, bucket: bucketSec(pos), feed: fed.has(`podcast:${r.episode_id}`) });
      }
    }
    if (hasTable('user_book_progress')) {
      const finished = new Set(all('SELECT book_id FROM user_book_finished WHERE user_id = ?', u.id).map((r) => r.book_id));
      for (const r of all('SELECT book_id, position_json, updated_at FROM user_book_progress WHERE user_id = ?', u.id)) {
        if (finished.has(r.book_id)) continue;
        let pos = null;
        try { pos = JSON.parse(r.position_json); } catch (_) { pos = null; }
        const loc = pos && pos.locator ? pos.locator : {};
        const spine = Number.isInteger(loc.spineIndex) ? loc.spineIndex : null;
        const pct = pos && Number.isFinite(Number(pos.percent)) ? Number(pos.percent) : null;
        items.push({ kind: 'book', id: r.book_id, at: r.updated_at || '', spine, block: Number.isInteger(loc.blockIndex) ? loc.blockIndex : null, pct, bucket: spine === null ? 'unknown' : (spine <= 1 ? 'first chapter or front matter' : 'further in'), feed: fed.has(`book:${r.book_id}`) });
      }
    }
    const count = (pred) => items.filter(pred).length;
    const byKind = {};
    for (const kind of ['video', 'podcast', 'book']) {
      const mine = items.filter((i) => i.kind === kind);
      const buckets = {};
      for (const i of mine) buckets[i.bucket] = (buckets[i.bucket] || 0) + 1;
      byKind[kind] = { continueItems: mine.length, buckets, movedByFeed: count((i) => i.kind === kind && i.feed) };
    }
    report.push({ user: u.username, feedSessions: sessions, byKind, items: showItems ? items.sort((a, b) => String(a.at).localeCompare(String(b.at))) : undefined });
  }
  db.close();
  for (const r of report) {
    console.log(`== ${r.user}: ${r.feedSessions} feed sessions`);
    for (const [kind, k] of Object.entries(r.byKind)) console.log(`  ${kind.padEnd(8)} Continue ${k.continueItems}  moved by a feed session ${k.movedByFeed}  ${JSON.stringify(k.buckets)}`);
    if (r.items) for (const i of r.items) console.log(`    ${i.at} ${i.kind} ${i.id} ${i.bucket}${i.sec !== undefined ? ' ' + i.sec + ' s' : ''}${i.pct !== null && i.pct !== undefined ? ' ' + i.pct + '%' : ''}${i.feed ? ' FEED' : ''}`);
  }
  console.log(`SUMMARY stale-continue: ${report.length} users, read-only`);
}

main();
