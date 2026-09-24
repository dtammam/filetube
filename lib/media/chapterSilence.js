'use strict';

// Chapter Snap (2026-09-24): the silence SCAN - one bounded ffmpeg `silencedetect`
// pass over a file - and its CACHE.
//
// The cache is a FEATURE-OWNED store (Dean 2026-09-24: its own store, never a
// new per-item db.metadata field): one small JSON file per media item under
// DATA_DIR/.chapter-silence/, named by the sha256 of the media id (so no id
// byte ever reaches a path). It is a CACHE, not user data: nothing else reads
// it, the scan never touches it (a rescan carries it forward by not knowing it
// exists), the backup bundle does not carry it (it is re-derivable), and it
// has no schema version to bump. Each record carries the file's size and
// mtime at scan time plus the detector parameters; a read whose file no
// longer matches (a replaced or re-encoded file) is STALE and is never used.
//
// The ffmpeg run: spawn with an argv array (never a shell string), stdin and
// stdout ignored, stderr parsed line by line as it streams (a bounded partial
// line buffer, a bounded event count), a hard timeout that SIGKILLs, ONE run
// per item at a time (a second request joins the first), and ONE run
// server-wide at a time (a small FIFO, capped - a full queue answers busy).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn: nodeSpawn } = require('node:child_process');

// The detector: quieter than -45 dB for at least half a second. A song gap on
// a ripped album is rarely digital silence, so -45 dB (not -60) - and short
// dips inside a song (< 0.5 s) are not a gap.
const SILENCE_NOISE_DB = -45;
const SILENCE_MIN_SEC = 0.5;
// Bump the trailing version when the detector or the record shape changes:
// every cached record with another key reads as stale and is rescanned.
// v2 (gate r1): the parser was anchored - every v1 record may hold a gap forged
// by metadata, so none is reused.
const SILENCE_PARAMS_KEY = `n${SILENCE_NOISE_DB}d${SILENCE_MIN_SEC}v2`;
const MAX_SILENCES = 5000;
const MAX_PARTIAL_LINE = 64 * 1024;
const MAX_QUEUE = 8;
const MAX_RECORD_BYTES = 1024 * 1024; // a record of MAX_SILENCES pairs is ~250 KB

function silenceDetectFilter() {
  return `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_SEC}`;
}

// The argv (no shell). `-v info` because silencedetect reports at info level;
// -vn/-sn/-dn so a VIDEO file decodes only its audio.
function buildSilenceDetectArgs(filePath) {
  return ['-hide_banner', '-nostats', '-nostdin', '-v', 'info', '-i', filePath, '-vn', '-sn', '-dn', '-af', silenceDetectFilter(), '-f', 'null', '-'];
}

// A generous but hard ceiling: decoding runs far faster than real time, so a
// quarter of the duration plus a minute covers a slow box; never under two
// minutes, never over thirty.
function silenceTimeoutMs(durationSec) {
  const d = Number(durationSec);
  const secs = Number.isFinite(d) && d > 0 ? 60 + d * 0.25 : 120;
  return Math.round(Math.min(1800, Math.max(120, secs)) * 1000);
}

const NUM = '(-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)';
// ANCHORED at the start of the line (gate r1: security-brief S-1, adversary W6,
// qa W3 - all measured): at `-v info` ffmpeg echoes the input's metadata (title,
// description, chapter titles) to stderr, and a yt-dlp download embeds the
// uploader's strings there. The detector's own lines always START with
// "[silencedetect @ 0x...] "; an echoed metadata value never does (ffmpeg indents
// every metadata line, continuation lines included). An unanchored match let an
// uploader forge a gap from a video description.
const LINE_RE = new RegExp(`^\\[silencedetect @ [^\\]]*\\] silence_(start|end):\\s*${NUM}`);

// One stderr line -> an event or null.
function parseSilenceLine(line) {
  if (typeof line !== 'string') return null;
  const m = LINE_RE.exec(line);
  if (!m) return null;
  return { kind: m[1], t: Number(m[2]) };
}

// Events -> [{start, end}] (seconds, rounded to the millisecond, ascending).
// A start below 0 (the detector's pre-roll) clamps to 0; an unterminated
// trailing start closes at the duration when one is known (older ffmpeg
// builds do not emit the final silence_end); an end without a start, or a
// non-positive interval, is dropped.
function silencesFromEvents(events, durationSec) {
  const out = [];
  let open = null;
  for (const ev of events) {
    if (!ev || !Number.isFinite(ev.t)) continue;
    if (ev.kind === 'start') { open = Math.max(0, ev.t); continue; }
    if (ev.kind === 'end' && open !== null) {
      const end = ev.t;
      if (end > open) out.push({ start: Math.round(open * 1000) / 1000, end: Math.round(end * 1000) / 1000 });
      open = null;
      if (out.length >= MAX_SILENCES) break;
    }
  }
  const dur = Number(durationSec);
  if (open !== null && Number.isFinite(dur) && dur > open && out.length < MAX_SILENCES) {
    out.push({ start: Math.round(open * 1000) / 1000, end: Math.round(dur * 1000) / 1000 });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

// Whole captured stderr text -> silences (the tests' entry point).
function parseSilenceDetectOutput(text, durationSec) {
  const events = [];
  for (const line of String(text || '').split(/\r?\n|\r/)) {
    const ev = parseSilenceLine(line);
    if (ev) events.push(ev);
  }
  return silencesFromEvents(events, durationSec);
}

// Run the detector. Resolves [{start,end}] or rejects with an Error whose
// message is short and safe to show (no path, no stderr dump beyond a tail).
function runSilenceDetect(filePath, opts) {
  const o = opts || {};
  const spawn = o.spawn || nodeSpawn;
  const bin = o.bin || 'ffmpeg';
  const timeoutMs = o.timeoutMs || silenceTimeoutMs(o.durationSec);
  return new Promise((resolve, reject) => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || filePath.includes('\u0000')) {
      reject(new Error('The file path is not usable.'));
      return;
    }
    // chapter snap gate r2 (qa S4, measured): ffmpeg echoes the input path raw on its
    // "Input #0 ... from '<path>'" line, so a file NAME carrying a line break followed by
    // the detector prefix could open a forged "[silencedetect ...]" line. Refuse such a
    // path outright (a yt-dlp name never has one; a local name that does is renamed).
    if (/[\r\n]/.test(filePath)) {
      reject(new Error('This file name contains a line break, so its silence cannot be read safely. Rename the file and try again.'));
      return;
    }
    let proc;
    try {
      proc = spawn(bin, buildSilenceDetectArgs(filePath), { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      reject(new Error(`Could not start ffmpeg: ${err && err.message ? err.message : err}`));
      return;
    }
    const events = [];
    let partial = '';
    let tail = '';
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGKILL'); } catch (_) { /* already gone */ }
    }, timeoutMs); // referenced on purpose: the child keeps the loop alive anyway, and it is cleared on close
    function consume(line) {
      const ev = parseSilenceLine(line);
      if (ev && events.length < MAX_SILENCES * 2 + 2) events.push(ev);
    }
    if (proc.stderr) {
      proc.stderr.on('data', (chunk) => {
        const text = partial + chunk.toString('utf8');
        const lines = text.split(/\r?\n|\r/);
        partial = lines.pop();
        if (partial.length > MAX_PARTIAL_LINE) partial = partial.slice(-MAX_PARTIAL_LINE);
        for (const line of lines) consume(line);
        tail = (tail + chunk.toString('utf8')).slice(-1024);
      });
    }
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(err && err.code === 'ENOENT' ? 'ffmpeg is not installed on this server.' : `ffmpeg failed: ${err && err.message ? err.message : err}`));
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (partial) consume(partial);
      if (timedOut) { reject(new Error('Finding the silence took too long and was stopped.')); return; }
      if (code !== 0) {
        // The stderr tail goes to the SERVER log only: its lines usually start
        // with the file path, and the message below reaches the client.
        const last = tail.trim().split(/\r?\n/).pop() || '';
        if (last) console.error(`[chapter-snap] ffmpeg silencedetect exited ${code}: ${last.slice(0, 300)}`);
        reject(new Error('ffmpeg could not read this file.'));
        return;
      }
      resolve(silencesFromEvents(events, o.durationSec));
    });
  });
}

function isCacheableId(id) {
  return typeof id === 'string' && id !== '' && !id.includes('\u0000');
}

// The on-disk cache. `dir` is created lazily on the first write.
function createSilenceCache(dir) {
  function fileFor(id) {
    return path.join(dir, `${crypto.createHash('sha256').update(id, 'utf8').digest('hex')}.json`);
  }
  function read(id) {
    if (!isCacheableId(id)) return null;
    try {
      const file = fileFor(id);
      // gate r1 security-brief S-3: a bounded read, and every silence shape-checked
      // (a hand-edited element must read as "no record", never throw at the GET).
      if (fs.statSync(file).size > MAX_RECORD_BYTES) return null;
      const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!rec || typeof rec !== 'object' || rec.mediaId !== id || !Array.isArray(rec.silences)) return null;
      if (rec.silences.length > MAX_SILENCES) return null;
      if (!rec.silences.every((x) => x && typeof x === 'object' && Number.isFinite(x.start) && Number.isFinite(x.end) && x.start >= 0 && x.end > x.start)) return null;
      return rec;
    } catch (_) { return null; }
  }
  function write(id, record) {
    if (!isCacheableId(id)) throw new Error('chapter silence cache: refusing an empty or NUL-bearing media id');
    fs.mkdirSync(dir, { recursive: true });
    const target = fileFor(id);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.assign({}, record, { mediaId: id })));
    fs.renameSync(tmp, target);
  }
  function remove(id) {
    if (!isCacheableId(id)) return;
    try { fs.unlinkSync(fileFor(id)); } catch (_) { /* absent */ }
  }
  return { read, write, remove, fileFor };
}

// A record matches a file when the detector parameters and the file's size
// and mtime are the ones it was built from.
function recordMatches(rec, st) {
  return !!(rec && st && rec.params === SILENCE_PARAMS_KEY && rec.size === st.size && rec.mtimeMs === st.mtimeMs);
}

// The service the routes use: state per item, and a start that joins an
// in-flight run or queues a new one (one at a time server-wide).
function createSilenceService(opts) {
  const o = opts || {};
  const cache = o.cache || createSilenceCache(o.dir);
  const statSync = o.statSync || fs.statSync;
  const run = o.run || runSilenceDetect;
  const maxQueue = o.maxQueue || MAX_QUEUE;
  const inflight = new Map(); // id -> promise
  const failures = new Map(); // id -> { error, size, mtimeMs }
  let chain = Promise.resolve();
  let queued = 0;

  function statOf(filePath) {
    try {
      const st = statSync(filePath);
      return st && st.isFile() ? { size: st.size, mtimeMs: st.mtimeMs } : null;
    } catch (_) { return null; }
  }

  // { state: 'ready', silences } | 'running' | 'failed' (+error) | 'none' | 'stale' | 'unavailable'
  function stateFor(item) {
    if (!item || !isCacheableId(item.id)) return { state: 'unavailable' };
    const st = typeof item.filePath === 'string' ? statOf(item.filePath) : null;
    if (!st) return { state: 'unavailable' };
    const rec = cache.read(item.id);
    if (recordMatches(rec, st)) return { state: 'ready', silences: rec.silences, scannedAt: rec.scannedAt || null };
    if (inflight.has(item.id)) return { state: 'running' };
    const f = failures.get(item.id);
    if (f && f.size === st.size && f.mtimeMs === st.mtimeMs) return { state: 'failed', error: f.error };
    return { state: rec ? 'stale' : 'none' };
  }

  // -> 'ready' | 'running' | 'busy' | 'unavailable'
  function start(item) {
    if (!item || !isCacheableId(item.id)) return 'unavailable';
    const id = item.id;
    const filePath = item.filePath;
    const durationSec = item.duration;
    const st = typeof filePath === 'string' ? statOf(filePath) : null;
    if (!st) return 'unavailable';
    if (recordMatches(cache.read(id), st)) return 'ready';
    if (inflight.has(id)) return 'running';
    if (queued >= maxQueue) return 'busy';
    failures.delete(id);
    queued += 1;
    const job = chain.then(async () => {
      let silences;
      try {
        silences = await run(filePath, { durationSec });
      } catch (err) {
        // The runner's messages are written for the client (no path).
        failures.set(id, { error: (err && err.message) || 'Finding the silence failed.', size: st.size, mtimeMs: st.mtimeMs });
        return;
      }
      try {
        // Re-check AFTER the await: a file replaced while ffmpeg read it must
        // not be cached under the new file's identity.
        const after = statOf(filePath);
        if (!after || after.size !== st.size || after.mtimeMs !== st.mtimeMs) {
          failures.set(id, { error: 'The file changed while it was being read. Try again.', size: after ? after.size : -1, mtimeMs: after ? after.mtimeMs : -1 });
          return;
        }
        cache.write(id, { params: SILENCE_PARAMS_KEY, size: st.size, mtimeMs: st.mtimeMs, durationSec: Number(durationSec) || null, silences, scannedAt: new Date().toISOString() });
      } catch (err) {
        // gate r1 security-brief S-2: an fs error names the DATA_DIR path - the
        // detail goes to the server log, the client gets a fixed sentence.
        console.error(`[chapter-snap] could not store the silence scan for ${id}:`, err && err.message ? err.message : err);
        failures.set(id, { error: 'The silence was found but could not be saved on the server.', size: st.size, mtimeMs: st.mtimeMs });
      }
    }).finally(() => {
      queued -= 1;
      inflight.delete(id);
    });
    chain = job.catch(() => {});
    inflight.set(id, job);
    return 'running';
  }

  // Tests: wait for an item's in-flight run.
  function whenIdle(id) {
    return inflight.get(id) || Promise.resolve();
  }

  return { stateFor, start, whenIdle, cache };
}

module.exports = {
  SILENCE_NOISE_DB,
  SILENCE_MIN_SEC,
  SILENCE_PARAMS_KEY,
  MAX_SILENCES,
  silenceDetectFilter,
  buildSilenceDetectArgs,
  silenceTimeoutMs,
  parseSilenceLine,
  silencesFromEvents,
  parseSilenceDetectOutput,
  runSilenceDetect,
  createSilenceCache,
  createSilenceService,
  recordMatches,
};
