'use strict';

// v1.365.0 (W3, ROADMAP "one-off download stuck"): the one-off download TRACE. An append-only, capped JSONL
// file `<dataDir>/ytdlp-oneshot-trace.jsonl` recording every lifecycle step of every one-off download, so the
// next time a row looks stuck the owner can export it (Settings > Troubleshooting > Download trace, admin only,
// `GET /api/ytdlp/oneshot-trace.txt`) BEFORE restarting FileTube, and the file says where the job stopped: on
// the shared gate, in the child, between the child's exit and its pipes closing, or after it.
//
// An INSTRUMENT, not a fix: it changes no timeout, sweep, gate or kill behaviour. Every write is wrapped and
// counted; a trace write can never throw into a job. Privacy: the only URL piece ever written is the HOST
// (`queued`, `boot-requeue`); never a path, a query or a token.
//
// Events, each `{ t: ISO, jobId, ev, ...fields }`:
//   queued (host, lane) | boot-requeue (host) | gate-wait | gate-enter | gate-leave (ok)
//   spawn (pid, attempt) | child-exit (code, signal, ms, attempt) | child-close (code, signal, msAfterExit, attempt)
//   state (from, to) | progress (pct, msSinceOutput; at most every 30 s while a child runs)
//   cancel-requested | kill (signal, pid, why) | sweep (from, to)

const fs = require('fs');
const path = require('path');

const TRACE_FILENAME = 'ytdlp-oneshot-trace.jsonl';
const TRACE_MAX_LINES = 2000;
// Trim (an atomic rewrite to the last TRACE_MAX_LINES) only once the file holds this many lines, so a full
// trace is not rewritten on every event. The reader always returns at most TRACE_MAX_LINES.
const TRACE_TRIM_AT = TRACE_MAX_LINES + 200;
const TRACE_PROGRESS_MS = 30 * 1000;

let fsImpl = fs;
let tmpSeq = 0;
const lineCounts = new Map(); // file path -> lines on disk (lazy; null = unknown, re-counted on next write)
const counters = { writes: 0, errors: 0 };

function tracePath(dataDir) {
  return path.join(dataDir, TRACE_FILENAME);
}

// Only the host of a URL ('' when it does not parse). Never the path, the query or a token.
function hostOf(u) {
  if (typeof u !== 'string' || u === '') return '';
  try { return new URL(u).host; } catch (_) { return ''; }
}

function countLines(file) {
  try {
    const raw = fsImpl.readFileSync(file, 'utf8');
    let n = 0;
    for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === 10) n++;
    return n;
  } catch (_) {
    return 0;
  }
}

function trim(file) {
  const raw = fsImpl.readFileSync(file, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  const kept = lines.slice(-TRACE_MAX_LINES);
  const tmp = `${file}.${process.pid}.${tmpSeq++}.tmp`;
  fsImpl.writeFileSync(tmp, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');
  fsImpl.renameSync(tmp, file); // atomic within dataDir's filesystem
  return kept.length;
}

/**
 * Append one event. Never throws: a failure (no dataDir, a full disk, a read-only volume, a bad field) is
 * counted in `stats().errors` and dropped.
 */
function record(dataDir, jobId, ev, fields) {
  try {
    if (typeof dataDir !== 'string' || dataDir === '') return;
    if (typeof jobId !== 'string' || jobId === '' || typeof ev !== 'string' || ev === '') return;
    const file = tracePath(dataDir);
    const head = { t: new Date().toISOString(), jobId, ev };
    // The caller's fields never override the three keys the reader relies on.
    const entry = Object.assign({}, head, fields && typeof fields === 'object' ? fields : {}, head);
    let n = lineCounts.get(file);
    if (typeof n !== 'number') n = countLines(file);
    fsImpl.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
    n += 1;
    if (n >= TRACE_TRIM_AT) n = trim(file);
    lineCounts.set(file, n);
    counters.writes += 1;
  } catch (err) {
    counters.errors += 1;
    try { lineCounts.delete(tracePath(dataDir)); } catch (_) { /* never throws */ }
  }
}

/** The last TRACE_MAX_LINES parsed events, oldest first. Malformed lines are skipped. Never throws. */
function readEntries(dataDir) {
  if (typeof dataDir !== 'string' || dataDir === '') return [];
  let raw;
  try { raw = fsImpl.readFileSync(tracePath(dataDir), 'utf8'); } catch (_) { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (s === '') continue;
    try {
      const v = JSON.parse(s);
      if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v);
    } catch (_) { /* a torn line: skip */ }
  }
  return out.slice(-TRACE_MAX_LINES);
}

/** The exported file: a self-describing header, then one line per event, oldest first. Pure. */
function formatTraceText(entries, meta) {
  const m = meta || {};
  const list = Array.isArray(entries) ? entries : [];
  const head = [
    'FileTube one-off download trace',
    'What it is: every step of every recent one-off download (queued, waiting for and entering the download slot,',
    'the yt-dlp process starting, exiting and closing, state changes, progress every 30 s, cancel, kill).',
    'server time: ' + (m.serverTime || '-'),
    'version: ' + (m.version || '-'),
    'entries: ' + list.length + (m.writeErrors ? ' (trace write errors since start: ' + m.writeErrors + ')' : ''),
    '',
  ];
  const rows = list.map((e) => {
    const rest = Object.keys(e).filter((k) => k !== 't' && k !== 'jobId' && k !== 'ev')
      .map((k) => k + '=' + (typeof e[k] === 'string' ? e[k] : JSON.stringify(e[k]))).join(' ');
    return (e.t || '-') + ' ' + (e.jobId || '-') + ' ' + (e.ev || '?') + (rest ? ' ' + rest : '');
  });
  return head.concat(rows).join('\n') + '\n';
}

function stats() {
  return { writes: counters.writes, errors: counters.errors };
}

// Test-only: swap the fs the writer uses (a throwing fs proves a trace write never breaks a job).
function setFsForTests(impl) {
  fsImpl = impl || fs;
  lineCounts.clear();
}
function resetForTests() {
  fsImpl = fs;
  lineCounts.clear();
  counters.writes = 0;
  counters.errors = 0;
}

module.exports = {
  TRACE_FILENAME,
  TRACE_MAX_LINES,
  TRACE_TRIM_AT,
  TRACE_PROGRESS_MS,
  tracePath,
  hostOf,
  record,
  readEntries,
  formatTraceText,
  stats,
  setFsForTests,
  resetForTests,
};
