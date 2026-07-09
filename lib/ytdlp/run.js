'use strict';

// The ONLY module in lib/ytdlp/ that touches `child_process`. Every
// invocation goes through an ARGUMENT ARRAY, never a shell string, and never
// sets `shell: true`. This mirrors server.js's FFmpeg pattern (`spawn('ffmpeg',
// args)`, server.js:665) and RELIABILITY.md's "wrap spawn/filesystem calls in
// try/catch; log and degrade, never crash."
//
// This file is a THIN invocation seam only: `runList`/`runDownload` just
// build args (via ./args.js) and call the spawn wrappers below. There is no
// scheduling, dedup, shouldSkip/premiere filtering, or db write here -- that
// is T4's poll loop. Nothing in this file runs at import time or as a side
// effect of requiring it.

// `child_process` is required as a whole module (not destructured) and its
// methods are referenced at CALL time inside the spawn wrappers, rather than
// bound to a local const at require time. This is what lets tests spy on the
// real spawn boundary by monkey-patching `require('child_process').spawn`
// (no mocking library / no dependency injection needed) and still prove the
// exact call shape (`'yt-dlp'`, an array, no `shell: true`) that production
// code takes. (Both the LIST and DOWNLOAD paths use `cp.spawn` -- `execFile`
// is no longer called anywhere in this file; see the LIST-path module
// comment below for why.)
const cp = require('child_process');
// Used to decode the bounded stderr tail (both paths) BOUNDARY-SAFELY --
// see the multibyte-UTF-8 note near `STDERR_TAIL_LIMIT`, below.
const { StringDecoder } = require('string_decoder');
const { buildYtdlpListArgs, buildYtdlpDownloadArgs, CHANNEL_META_SENTINEL } = require('./args');
// FR-E: the pure progress-line parser. This file feeds it already-decoded
// plain-text lines from yt-dlp's OWN stdout/stderr on the DOWNLOAD path only
// -- see `spawnYtdlpDownload`'s `onProgress` handling, below. The parser
// itself never sees the argv/cookies path (SF1 is unaffected).
const { parseProgressLine } = require('./progress');

// LIST pass: metadata-only (`--dump-json`), no file is ever written. Its
// stdout IS the JSON T4/rules.js parses. This USED to go through `execFile` +
// a fixed `maxBuffer` (10MB) on the theory that a channel's metadata dump is
// "large but finite and known ahead of time" -- that assumption was wrong: a
// channel with enough videos legitimately exceeds 10MB of `--dump-json`
// output, and Node's response to a `maxBuffer` overrun is to SIGTERM the
// child before a single video is even considered, i.e. any sufficiently
// large/active channel could never be listed at all (the production bug this
// hotfix fixes). The list path now uses `cp.spawn` (see `spawnYtdlp`, below)
// -- the same streaming approach `spawnYtdlpDownload` already used for
// downloads -- so there is no size-based cap that can ever abort a valid
// listing. Real-world size is separately (and primarily) bounded by
// `--playlist-end` (lib/ytdlp/args.js's `buildYtdlpListArgs`, driven by the
// `FILETUBE_YTDLP_MAX_VIDEOS` config / `config.maxVideos`, default 25 newest
// videos) -- `spawn` without a maxBuffer is defense-in-depth on top of that
// bound (including for the `maxVideos: 0` "unlimited" case), not a
// replacement for it.

// Non-zero spawn timeouts (SF2). `timeout: 0` is UNBOUNDED in Node -- a
// livestream/premiere/slowloris URL would otherwise hang the child forever
// and wedge the (T4) poll loop's awaiting promise. Listing metadata is a
// quick network round-trip so it gets a short ceiling; a real download can
// legitimately run for a long time, so it gets a much longer one. Both are
// finite so a hung child is always eventually reclaimed.
const DEFAULT_LIST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes -- a listing/metadata pass should be quick
// v1.15.1 hotfix: raised from a hardcoded 60 minutes to 180 (3 hours) -- a
// multi-gigabyte video (yt-dlp downloads video+audio as separate streams,
// then merges them) can legitimately take well over an hour on a modest home
// connection, and hitting the old 60-minute ceiling SIGKILLed the child
// mid-download every time, always leaving intermediate/partial files behind
// (lib/ytdlpIntermediates.js). This constant is now only the FALLBACK used
// when a caller doesn't supply a `config` with its own
// `downloadTimeoutMinutes` (see `resolveDownloadTimeoutMs`, below) -- the
// real, configurable ceiling is `config.downloadTimeoutMinutes`
// (FILETUBE_YTDLP_DOWNLOAD_TIMEOUT_MINUTES, lib/ytdlp/config.js), which
// defaults to this same 180 minutes.
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 180 * 60 * 1000; // 180 minutes -- a real video download can legitimately take a while

// `SIGKILL` (not `SIGTERM`) so a wedged/hung yt-dlp process is unconditionally
// reclaimed -- a hung child is, by definition, not responding to signals it
// could otherwise handle gracefully, and there is no cleanup yt-dlp needs to
// do on our behalf (a killed download simply leaves a partial file, which is
// already the outcome of any other yt-dlp failure and is handled the same way
// downstream: re-polled/re-attempted, never silently treated as success).
const DEFAULT_KILL_SIGNAL = 'SIGKILL';

// Bounded tail kept for stderr (both the list and download paths) for
// diagnostics ONLY -- SF3 is explicitly about NOT accumulating stderr in an
// unbounded buffer (a download's periodic progress output, or a listing's
// warnings, can in principle be large over a long-running process, and with
// `execFile` + `maxBuffer` would eventually SIGTERM the child). This tail is
// small and fixed-size regardless of how long the process runs or how much
// it prints.
//
// The tail is built from a per-stream `StringDecoder('utf8')`, NOT repeated
// independent `chunk.toString()` calls: a raw Buffer chunk boundary can land
// in the MIDDLE of a multi-byte UTF-8 character (e.g. an emoji/CJK character
// in yt-dlp's warning/progress text), and decoding each chunk independently
// would corrupt it into U+FFFD on both sides of the split. `StringDecoder`
// buffers an incomplete trailing byte sequence internally until its
// continuation arrives in a later chunk, so only the fully-bounded string
// output is ever sliced to the fixed tail length -- never the raw bytes.
const STDERR_TAIL_LIMIT = 4096;

// v1.20.0 FR-2: a hard cap on how many parsed channel-meta lines a single
// download spawn ever accumulates. In normal operation there is exactly one
// `FTCHMETA` line per downloaded video (args.js's `--print after_move:`
// template, emitted once per target), and a single `runDownload` call never
// targets more than a modest number of survivor ids -- but this cap exists
// as the SAME defensive posture as `STDERR_TAIL_LIMIT`: a pathological/
// adversarial yt-dlp output (or a future template bug that emits the line
// more than once per video) must never let this in-memory array grow
// unbounded for the lifetime of one spawn. Exported like `STDERR_TAIL_LIMIT`
// so tests can assert the cap against the real constant.
const MAX_CAPTURED_META = 1000;

/**
 * v1.20.0 FR-2: pure parser for the `--print after_move:FTCHMETA <json>` line
 * `args.js`'s download builder adds to stdout (see
 * `CHANNEL_META_PRINT_TEMPLATE`'s doc comment there). Recognizes ONLY a line
 * that starts with the fixed `FTCHMETA ` sentinel (sentinel + a single
 * space); anything else (a normal `--newline` progress line, a warning, blank
 * output) returns `null` and is left for `parseProgressLine` to handle
 * exactly as before this feature.
 *
 * SECURITY (two-reviewer-gate fix, post-release): the payload after the
 * sentinel is now a SINGLE JSON object (see `CHANNEL_META_PRINT_TEMPLATE`'s
 * `.{...}j` field selector) rather than a tab-delimited string -- JSON.parse
 * is the ONLY thing that ever splits this payload into fields, so an
 * embedded newline inside any field's value (e.g. a hostile `channel` display
 * name) can never forge a second, independently-parseable capture line: it
 * arrives already escaped as the two-character sequence `\n` INSIDE the JSON
 * string, never as a raw line break. A payload that fails `JSON.parse` (a
 * corrupt/truncated line, or anything else that merely happens to start with
 * the sentinel) is treated as malformed and this returns `null` -- it must
 * NEVER throw, since a throw here would otherwise propagate out of the
 * streamed line-splitter and break the whole download.
 *
 * yt-dlp's `%(...)j` JSON conversion renders an unavailable field as JSON
 * `null` (its own convention for this conversion, distinct from the `NA`
 * string used by plain `%(field)s` interpolation); an empty string is also
 * possible. Both normalize to `null` (absent) on the returned object -- never
 * treated as literal data.
 *
 * IMPORTANT: this function is wired to run ONLY against the DOWNLOAD
 * spawn's STDOUT line stream (see `spawnYtdlpDownload` below) -- `--print`
 * only ever writes to stdout, so parsing stderr for this sentinel gains
 * nothing and is a needless attack surface: yt-dlp echoes other
 * attacker-controlled, potentially MULTI-LINE text (e.g. video descriptions)
 * to stderr, and a raw (non-JSON-escaped) newline there could otherwise be
 * used to plant a line that merely LOOKS like a capture line. Stderr lines
 * are never handed to this parser at all, regardless of their shape.
 *
 * Returned values are RAW, UNVALIDATED strings straight from yt-dlp's own
 * stdout (untrusted input) -- this function does NO validation itself; see
 * `store.sanitizeCapturedChannelMeta` for the mandatory validation gate that
 * MUST run before any of these values are persisted or used.
 * @param {*} line a single already-decoded, newline-stripped line
 * @returns {{videoId: (string|null), channelUrl: (string|null), channelId: (string|null), uploaderUrl: (string|null), channelName: (string|null), uploadDate: (string|null), releaseDate: (string|null), channelThumbnail: (string|null)} | null}
 */
function parseChannelMetaLine(line) {
  if (typeof line !== 'string') return null;
  const prefix = `${CHANNEL_META_SENTINEL} `;
  if (!line.startsWith(prefix)) return null;
  const payload = line.slice(prefix.length);
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    // Malformed/truncated JSON -- skip this line entirely, never throw.
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const present = (value) => (typeof value === 'string' && value !== '' && value !== 'NA' ? value : null);
  return {
    videoId: present(parsed.id),
    channelUrl: present(parsed.channel_url),
    channelId: present(parsed.channel_id),
    uploaderUrl: present(parsed.uploader_url),
    channelName: present(parsed.channel),
    // v1.24.0 C5-ytdlp/C6: raw (unvalidated) upload/release date + channel
    // thumbnail URL, straight off the same `--print` line -- bounded/
    // validated downstream by `store.sanitizeCapturedChannelMeta` (which
    // expects EXACTLY these key names: `uploadDate`/`releaseDate`/
    // `channelThumbnail`), never here (this function's job is JSON-parse +
    // presence-check only).
    uploadDate: present(parsed.upload_date),
    releaseDate: present(parsed.release_date),
    channelThumbnail: present(parsed.channel_thumbnail),
  };
}

/**
 * Redact the value of every `--cookies <path>` pair in an args array. Used
 * for ANY log line that might include the argv -- the cookies path is a
 * reference to a mounted, potentially sensitive credentials file and must
 * NEVER appear in logs (or, by extension, anywhere persisted). Returns a new
 * array; never mutates the input.
 */
function redactArgs(args) {
  if (!Array.isArray(args)) return args;
  const redacted = [];
  for (let i = 0; i < args.length; i++) {
    redacted.push(args[i]);
    if (args[i] === '--cookies' && i + 1 < args.length) {
      redacted.push('<redacted>');
      i += 1; // skip the real path -- it must never be pushed/logged
    }
  }
  return redacted;
}

/**
 * SF1: strip every occurrence of `cookiesPath` out of an arbitrary string
 * (typically Node's own `error.message`, which for `execFile`/`spawn`
 * failures is `"Command failed: yt-dlp <full argv incl. --cookies
 * <path>> -- <url>\n<stderr>"` -- the FULL, un-redacted argv, defeating
 * `redactArgs` when the message itself is what gets logged/returned instead
 * of a value built from `redactArgs`'s output). A single global substring
 * replace also covers a `--cookies=<path>` equals-form rendering of the same
 * path, since it is the path text itself being matched, not a `--cookies
 * <path>` token pair. Guarded against a null/empty `cookiesPath` (returned
 * unchanged) so callers can pass `config.cookiesFile` unconditionally.
 */
function redactString(str, cookiesPath) {
  if (typeof str !== 'string' || str === '') return str;
  if (typeof cookiesPath !== 'string' || cookiesPath === '') return str;
  return str.split(cookiesPath).join('<redacted>');
}

/**
 * Compose a SAFE, loggable/returnable description of a spawn failure from
 * known-good pieces ONLY -- never the raw `error.message`/`stderr`, which on
 * Node can embed the full argv (including a `--cookies <path>` value) even
 * when the args array handed to `execFile`/`spawn` was itself never
 * shell-interpolated (SF1). `redactArgs(args)` is already safe to include;
 * `error.code`/`signal` are structured fields Node sets independently of the
 * message text.
 */
function describeFailure(args, error) {
  const code = error && error.code !== undefined && error.code !== null ? error.code : 'unknown';
  const signal = error && error.signal ? ` signal=${error.signal}` : '';
  return `code=${code}${signal} args=${redactArgs(args).join(' ')}`;
}

/**
 * Invoke yt-dlp for the LIST/metadata pass (and the `--version`
 * presence-check) using `spawn` (arg-array, NO shell -- same guarantee as
 * before: NEVER pass a shell string, NEVER set `{ shell: true }`) instead of
 * `execFile` + `maxBuffer`. See the module comment above (near
 * `STDERR_TAIL_LIMIT`) for why: `execFile`'s fixed `maxBuffer` made Node
 * SIGTERM the child the moment a channel's `--dump-json` dump exceeded it,
 * failing the ENTIRE listing (and therefore the whole poll) for any
 * sufficiently large channel, before a single video was even considered.
 *
 * DESIGN CHOICE (this hotfix): stdout is still collected and returned as a
 * single joined string on `result.stdout` -- the exact same shape as before
 * -- so `runList` / `rules.parseYtdlpVideoList` remain the one NDJSON-parsing
 * seam, unchanged. RAW Buffer chunks are pushed into an array and decoded
 * ONCE, together, at `close` via `Buffer.concat(stdoutChunks).toString('utf8')`
 * -- this is not just an O(n^2) string-copy avoidance, it is what makes
 * chunk boundaries irrelevant to correctness: decoding each chunk
 * independently (the pre-fix behavior) can split a multi-byte UTF-8
 * character -- an emoji or CJK character in a video title/uploader/
 * description is common -- across two chunks, corrupting it into U+FFFD on
 * both sides while `JSON.parse` still succeeds (a silent data-corruption
 * bug, not a crash). Buffering the raw bytes and decoding once at the end
 * closes that gap entirely. There is no `maxBuffer`-style hard cap anywhere
 * in this path that could ever abort a valid listing. Real-world size is
 * bounded upstream instead, by `--playlist-end`
 * (`buildYtdlpListArgs`/`FILETUBE_YTDLP_MAX_VIDEOS`), which is the primary
 * fix for unbounded channels; removing the artificial `maxBuffer` ceiling here
 * is defense-in-depth on top of that bound (including for the
 * `maxVideos: 0` "unlimited" case).
 *
 * Wrapped so this never throws/rejects uncaught: any failure (binary
 * missing, non-zero exit, timeout, a broken stdout/stderr stream) resolves to
 * a structured `{ ok: false, ... }` result instead, per RELIABILITY.md ("log
 * and degrade, never crash"). Same redaction (SF1), non-zero-timeout-with-
 * killSignal (SF2), and settled-guard/stream-'error' handling (SF7)
 * guarantees as `spawnYtdlpDownload` apply here too. Downloads use
 * `spawnYtdlpDownload` instead (unaffected by this change).
 * @param {string[]} args flat argv (see lib/ytdlp/args.js builders)
 * @param {{timeoutMs?: number, cwd?: string, cookiesPath?: string, killSignal?: string}} [opts]
 * @returns {Promise<{ok: boolean, code: (number|string|null), stdout: string, stderr: string, error?: string}>}
 */
function spawnYtdlp(args, opts = {}) {
  const cookiesPath = opts.cookiesPath || null;
  const timeoutMs = opts.timeoutMs || DEFAULT_LIST_TIMEOUT_MS;
  const killSignal = opts.killSignal || DEFAULT_KILL_SIGNAL;

  return new Promise((resolve) => {
    let child;
    try {
      child = cp.spawn('yt-dlp', args, {
        cwd: opts.cwd,
        // stdout is piped and streamed below (no maxBuffer-style cap);
        // stderr is piped and drained into a bounded tail only, exactly like
        // `spawnYtdlpDownload`.
        stdio: ['ignore', 'pipe', 'pipe'],
        // Deliberately NO `shell` key: spawn defaults to `shell: false`.
        // Never set this to `true` -- see the module comment above.
      });
    } catch (err) {
      // A synchronous throw from spawn itself (malformed args, etc.) -- still
      // never propagates uncaught, and still never leaks the raw
      // message/cookies path (SF1's sync-throw path).
      console.error('Failed to start yt-dlp:', describeFailure(args, err));
      resolve({ ok: false, code: null, stdout: '', stderr: '', error: redactString(err.message, cookiesPath) });
      return;
    }

    // Raw Buffer chunks (NOT pre-decoded strings) -- decoded ONCE, together,
    // at 'close'. See the module comment above (near `spawnYtdlp`'s JSDoc)
    // for why this matters: chunk-boundary-safe multibyte UTF-8 decoding.
    const stdoutChunks = [];
    const stderrDecoder = new StringDecoder('utf8');
    let stderrTail = '';
    let timedOut = false;
    let settled = false;

    let timer = null;
    function clear() {
      if (timer) clearTimeout(timer);
    }

    // SF7: a piped stream can itself emit 'error' (a rare underlying fd/read
    // error) independently of the child process's own 'error'/'close'
    // events. An EventEmitter with ZERO 'error' listeners THROWS
    // synchronously when one fires -- without a listener here that throw
    // would happen before any settle-the-promise logic runs, hanging this
    // promise forever. Both stdout and stderr are guarded (unlike the
    // download path, which only pipes stderr): the list path pipes BOTH
    // streams, so both need the same guard. Each handler also calls
    // `child.kill(killSignal)` BEFORE resolving -- a stream-'error' can fire
    // while the child is still running, and `clear()` has just disarmed the
    // timeout timer, so without an explicit kill here (mirroring the timeout
    // path) that child would be orphaned with nothing left to reap it.
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdoutChunks.push(chunk);
      });
      child.stdout.on('error', (err) => {
        if (settled) return;
        settled = true;
        clear();
        child.kill(killSignal);
        console.error('yt-dlp stdout stream failed:', describeFailure(args, err));
        resolve({
          ok: false,
          code: 'ESTDOUT',
          stdout: '',
          stderr: redactString(stderrTail, cookiesPath),
          error: redactString(err.message, cookiesPath),
        });
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        // Boundary-safe decode (see the `STDERR_TAIL_LIMIT` module comment)
        // -- only the DECODED string is sliced to the bounded tail, never
        // the raw bytes, so the tail stays fixed-size (SF3) without ever
        // splitting a multi-byte character across the slice boundary.
        stderrTail = (stderrTail + stderrDecoder.write(chunk)).slice(-STDERR_TAIL_LIMIT);
      });
      child.stderr.on('error', (err) => {
        if (settled) return;
        settled = true;
        clear();
        child.kill(killSignal);
        console.error('yt-dlp stderr stream failed:', describeFailure(args, err));
        resolve({
          ok: false,
          code: 'ESTDERR',
          stdout: '',
          stderr: redactString(stderrTail, cookiesPath),
          error: redactString(err.message, cookiesPath),
        });
      });
    }

    // Non-zero default (SF2): `timeout: 0` (or omitted) is unbounded in Node,
    // so a hung/slowloris listing would otherwise wedge the poll loop
    // forever. `.unref()`'d so a real child process (which itself keeps the
    // event loop alive) doesn't need this timer to also do so -- see the
    // v1.11.1 CI lesson referenced in `spawnYtdlpDownload`, below.
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill(killSignal);
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clear();
      console.error('yt-dlp failed to start:', describeFailure(args, err));
      resolve({ ok: false, code: null, stdout: '', stderr: '', error: redactString(err.message, cookiesPath) });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clear();
      // Flush any trailing bytes the decoder was still holding onto pending
      // a continuation that will now never arrive (the process has closed).
      stderrTail = (stderrTail + stderrDecoder.end()).slice(-STDERR_TAIL_LIMIT);
      const safeStderr = redactString(stderrTail, cookiesPath);
      // Decode ONCE, from the raw, fully-buffered bytes -- see the module
      // comment above `spawnYtdlp` for why this (not per-chunk decoding) is
      // what makes chunk boundaries irrelevant to multibyte correctness.
      const safeStdout = redactString(Buffer.concat(stdoutChunks).toString('utf8'), cookiesPath);
      if (timedOut) {
        console.error('yt-dlp timed out:', describeFailure(args, { code: 'ETIMEDOUT', signal }));
        resolve({ ok: false, code: 'ETIMEDOUT', stdout: '', stderr: safeStderr, error: 'yt-dlp timed out and was killed' });
        return;
      }
      if (code === 0) {
        resolve({ ok: true, code: 0, stdout: safeStdout, stderr: safeStderr });
        return;
      }
      // SF1: log a SAFE, composed description -- never the raw error
      // message/stderr (which can embed the full un-redacted argv, incl. the
      // cookies path, defeating `redactArgs` if logged/returned directly).
      const resultCode = code !== null && code !== undefined ? code : (signal || null);
      console.error('yt-dlp failed:', describeFailure(args, { code: resultCode, signal }));
      resolve({
        ok: false,
        code: resultCode,
        stdout: safeStdout,
        stderr: safeStderr,
        // SF1: the RETURNED error is redacted too -- this is the field T4
        // would persist to db.json / expose via GET /api/subscriptions.
        error: redactString(`yt-dlp exited with code ${resultCode}`, cookiesPath),
      });
    });
  });
}

/**
 * A tiny, bounded line-splitter used ONLY for FR-E progress parsing on the
 * download path. Operates on already-decoded strings (each stream feeding it
 * keeps its OWN `StringDecoder`, exactly like the diagnostic stderr tail, so
 * a multi-byte UTF-8 character split across a raw Buffer chunk boundary is
 * never corrupted). `onLine` fires once per COMPLETE line (the trailing `\n`
 * is stripped, never included). The not-yet-terminated remainder ("carry")
 * is capped at `STDERR_TAIL_LIMIT` so a pathological/adversarial stream that
 * never emits a newline cannot grow this buffer without bound -- this is a
 * PARSE-time buffer only, distinct from (and in addition to) the stderr
 * diagnostic tail; nothing here is ever accumulated for the RETURNED result
 * (SF3 is unaffected: `spawnYtdlpDownload` still returns `stdout: ''`).
 */
function makeLineSplitter(onLine) {
  let carry = '';
  return {
    push(text) {
      if (typeof text !== 'string' || text === '') return;
      carry += text;
      let idx = carry.indexOf('\n');
      while (idx !== -1) {
        onLine(carry.slice(0, idx));
        carry = carry.slice(idx + 1);
        idx = carry.indexOf('\n');
      }
      if (carry.length > STDERR_TAIL_LIMIT) {
        carry = carry.slice(-STDERR_TAIL_LIMIT);
      }
    },
    // Called once, at 'close': whatever partial line never received a
    // trailing newline (yt-dlp's very last progress update commonly has no
    // trailing `\n` before the process exits) is still worth a final parse
    // attempt.
    flush() {
      if (carry !== '') {
        const last = carry;
        carry = '';
        onLine(last);
      }
    },
  };
}

/**
 * Invoke yt-dlp for a DOWNLOAD using `spawn` (arg-array, NO shell -- same
 * guarantee as `spawnYtdlp` above). SF3: `execFile`'s `maxBuffer` (the
 * mechanism BOTH this path and the list path used to use) bounds stdout AND
 * stderr combined; a long-running download's periodic stderr progress output
 * can exceed it, and Node's response is to SIGTERM the child -- killing a
 * legitimate multi-hour download and leaving a partial file. `spawn` gives
 * direct access to the stderr stream so it can be drained WITHOUT
 * accumulating an in-memory buffer that could ever trip a size limit: only a
 * small, fixed-size tail is kept (for diagnostics), no matter how long the
 * process runs or how much it prints.
 *
 * Same redaction (SF1) and non-zero-timeout-with-killSignal (SF2) guarantees
 * as `spawnYtdlp` apply here too.
 *
 * FR-E: `opts.onProgress`, when a function, is called with each non-null
 * `parseProgressLine(line)` patch parsed from EITHER stream (yt-dlp writes
 * `--newline` progress to stdout; some diagnostic lines land on stderr too).
 * stdout is now piped (previously ignored) but is PARSED-AND-DISCARDED --
 * never accumulated -- so the returned `result.stdout` stays `''`, exactly
 * as before this feature, and SF3's "no unbounded buffer" guarantee is
 * unaffected. `onProgress` is wrapped so a throwing callback can NEVER break
 * this download's own promise/settle logic. Backward-compatible: when
 * `opts.onProgress` is omitted, behavior is identical to before (the only
 * difference anywhere on this path is the harmless `--newline` flag added in
 * lib/ytdlp/args.js).
 * @param {string[]} args flat argv (see lib/ytdlp/args.js's buildYtdlpDownloadArgs)
 * @param {{timeoutMs?: number, cwd?: string, cookiesPath?: string, killSignal?: string, onProgress?: (patch: object) => void}} [opts]
 * @returns {Promise<{ok: boolean, code: (number|string|null), stdout: string, stderr: string, error?: string}>}
 */
function spawnYtdlpDownload(args, opts = {}) {
  const cookiesPath = opts.cookiesPath || null;
  const timeoutMs = opts.timeoutMs || DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const killSignal = opts.killSignal || DEFAULT_KILL_SIGNAL;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  return new Promise((resolve) => {
    let child;
    try {
      child = cp.spawn('yt-dlp', args, {
        cwd: opts.cwd,
        // FR-E: stdout is now piped too (previously `'ignore'`) so download
        // progress lines (yt-dlp writes them to stdout under `--newline`) can
        // be parsed; it is parsed-and-discarded below, never accumulated.
        // stderr remains piped so it can be drained below WITHOUT letting
        // Node accumulate/buffer it internally the way `execFile`'s
        // `maxBuffer` does.
        stdio: ['ignore', 'pipe', 'pipe'],
        // Deliberately NO `shell` key: `spawn` defaults to `shell: false`.
        // Never set this to `true` -- see the module comment above.
      });
    } catch (err) {
      console.error('Failed to start yt-dlp:', describeFailure(args, err));
      resolve({ ok: false, code: null, stdout: '', stderr: '', error: redactString(err.message, cookiesPath), channelMeta: [] });
      return;
    }

    const stderrDecoder = new StringDecoder('utf8');
    let stderrTail = '';
    let timedOut = false;
    let settled = false;
    // v1.20.0 FR-2: bounded capture of parsed FTCHMETA lines (see
    // `parseChannelMetaLine`'s doc comment above and `MAX_CAPTURED_META`).
    // Raw/untrusted -- returned to the caller as-is; validation happens
    // downstream in `store.sanitizeCapturedChannelMeta`, never here.
    const capturedMeta = [];

    let timer = null;
    function clear() {
      if (timer) clearTimeout(timer);
    }

    // FR-E: onProgress must NEVER break this download's own promise/settle
    // logic -- a throwing callback is caught and logged, never propagated.
    function safeOnProgress(patch) {
      if (!onProgress || !patch) return;
      try {
        onProgress(patch);
      } catch (err) {
        console.error('yt-dlp onProgress callback threw (ignored):', err && err.message);
      }
    }
    // v1.20.0 FR-2 (two-reviewer-gate fix, post-release): FTCHMETA capture
    // parsing is now attempted ONLY on stdout lines, never stderr -- see
    // `parseChannelMetaLine`'s doc comment above for why. `--print` (the
    // only thing that ever produces this sentinel) writes exclusively to
    // stdout, so stderr never legitimately carries a capture line; treating
    // an FTCHMETA-shaped stderr line as one would let attacker-controlled
    // stderr text (yt-dlp echoes descriptions/warnings there, which CAN
    // contain raw, un-JSON-escaped newlines) plant a forged capture entry.
    function handleStdoutLine(line) {
      const meta = parseChannelMetaLine(line);
      if (meta) {
        if (capturedMeta.length < MAX_CAPTURED_META) capturedMeta.push(meta);
        return;
      }
      safeOnProgress(parseProgressLine(line));
    }
    // stderr NEVER attempts FTCHMETA recognition -- only the existing
    // progress/log parsing, unchanged from before this fix. A line here that
    // happens to start with the FTCHMETA sentinel is simply not progress
    // (parseProgressLine returns null for it) and is silently dropped, same
    // as any other unrecognized stderr line.
    function handleStderrLine(line) {
      safeOnProgress(parseProgressLine(line));
    }
    // Each stream gets its OWN StringDecoder + line-splitter (see
    // `makeLineSplitter`'s comment above) so a multi-byte character split
    // across a chunk boundary decodes intact on either channel.
    const stdoutDecoder = new StringDecoder('utf8');
    const stdoutLineSplitter = makeLineSplitter(handleStdoutLine);
    const stderrLineSplitter = makeLineSplitter(handleStderrLine);

    // SF7: a piped stream can itself emit 'error' (a rare underlying fd/read
    // error) independently of the child process's own 'error'/'close'
    // events. An EventEmitter with ZERO 'error' listeners THROWS
    // synchronously when one fires -- and that throw happens BEFORE any of
    // the settle-the-promise logic below runs, so without a listener here
    // this promise would never resolve. Both stdout and stderr are guarded
    // (stdout is now piped on this path too, mirroring the list path's own
    // dual-stream guard). Each handler also calls `child.kill(killSignal)`
    // BEFORE resolving -- a stream-'error' can fire while the child is still
    // running, and `clear()` has just disarmed the timeout timer, so without
    // an explicit kill here that child would be orphaned with nothing left
    // to reap it.
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        // FIX-3 (two-reviewer gate): once this download's promise has
        // already settled (a normal 'close', a timeout-kill, or a stream
        // 'error' on EITHER stream), a still-buffered/late 'data' event on
        // stdout must not dispatch onProgress -- without this guard, a
        // late, non-terminal `{state: 'downloading', ...}` patch could
        // OVERWRITE the orchestrator's own terminal state transition
        // (`activity.setSubscription`'s 'done'/'error', written immediately
        // after this promise resolves), leaving a phantom entry stuck
        // non-terminal forever (never TTL-pruned, since only one-shots are
        // TTL-pruned and subscriptions aren't pruned by age at all). The
        // decoder must still be DRAINED even when discarding (never skip
        // `stdoutDecoder.write`) so a multi-byte character split across this
        // chunk boundary and the next doesn't corrupt state for whichever
        // later chunk actually does still get parsed. The close-time flush
        // below is NOT gated by this check -- it is the deliberate final
        // step of the SAME settle sequence, not a stray late event.
        const decoded = stdoutDecoder.write(chunk);
        if (settled) return;
        stdoutLineSplitter.push(decoded);
      });
      child.stdout.on('error', (err) => {
        if (settled) return;
        settled = true;
        clear();
        child.kill(killSignal);
        console.error('yt-dlp stdout stream failed:', describeFailure(args, err));
        resolve({
          ok: false,
          code: 'ESTDOUT',
          stdout: '',
          stderr: redactString(stderrTail, cookiesPath),
          error: redactString(err.message, cookiesPath),
          channelMeta: capturedMeta,
        });
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        // Boundary-safe decode (see the `STDERR_TAIL_LIMIT` module comment
        // near `spawnYtdlp`) -- only the DECODED string is sliced to the
        // bounded tail, never the raw bytes, so the tail stays fixed-size
        // (SF3) without ever splitting a multi-byte character. The SAME
        // decoded string also feeds the FR-E line-splitter (parsed and
        // discarded, never itself accumulated).
        const decoded = stderrDecoder.write(chunk);
        stderrTail = (stderrTail + decoded).slice(-STDERR_TAIL_LIMIT);
        // FIX-3 (two-reviewer gate): same settled-guard as the stdout 'data'
        // handler above -- the diagnostic tail keeps accumulating either way
        // (harmless, still bounded), but progress dispatch must stop once
        // this download's promise has already settled.
        if (settled) return;
        stderrLineSplitter.push(decoded);
      });
      child.stderr.on('error', (err) => {
        if (settled) return;
        settled = true;
        clear();
        child.kill(killSignal);
        console.error('yt-dlp stderr stream failed:', describeFailure(args, err));
        resolve({
          ok: false,
          code: 'ESTDERR',
          stdout: '',
          stderr: redactString(stderrTail, cookiesPath),
          error: redactString(err.message, cookiesPath),
          channelMeta: capturedMeta,
        });
      });
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill(killSignal);
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clear();
      console.error('yt-dlp failed to start:', describeFailure(args, err));
      resolve({ ok: false, code: null, stdout: '', stderr: '', error: redactString(err.message, cookiesPath), channelMeta: capturedMeta });
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clear();
      // Flush any trailing bytes the decoders were still holding onto
      // pending a continuation that will now never arrive (the process has
      // closed), then let each line-splitter parse whatever final partial
      // line never received a trailing newline.
      const trailingStdout = stdoutDecoder.end();
      if (trailingStdout) stdoutLineSplitter.push(trailingStdout);
      stdoutLineSplitter.flush();
      stderrTail = (stderrTail + stderrDecoder.end()).slice(-STDERR_TAIL_LIMIT);
      stderrLineSplitter.flush();
      const safeStderr = redactString(stderrTail, cookiesPath);
      if (timedOut) {
        console.error('yt-dlp timed out:', describeFailure(args, { code: 'ETIMEDOUT', signal }));
        resolve({ ok: false, code: 'ETIMEDOUT', stdout: '', stderr: safeStderr, error: 'yt-dlp timed out and was killed', channelMeta: capturedMeta });
        return;
      }
      if (code === 0) {
        resolve({ ok: true, code: 0, stdout: '', stderr: safeStderr, channelMeta: capturedMeta });
        return;
      }
      const resultCode = code !== null && code !== undefined ? code : (signal || null);
      console.error('yt-dlp failed:', describeFailure(args, { code: resultCode, signal }));
      resolve({
        ok: false,
        code: resultCode,
        stdout: '',
        stderr: safeStderr,
        error: redactString(`yt-dlp exited with code ${resultCode}`, cookiesPath),
        channelMeta: capturedMeta,
      });
    });
  });
}

/**
 * v1.15.1 hotfix: resolve the effective DOWNLOAD spawn timeout (ms) from
 * `config.downloadTimeoutMinutes` (lib/ytdlp/config.js's
 * `parseDownloadTimeoutMinutes`, itself already bounds-checked/defaulted at
 * the config-parsing boundary) -- falling back to `DEFAULT_DOWNLOAD_TIMEOUT_MS`
 * only when `config` doesn't carry a valid one (e.g. a test/caller that
 * builds a bare `{ downloadDir, cookiesFile }` config object directly,
 * bypassing `parseYtdlpConfig`). Re-validated here too (never trusts
 * `config` blindly) so a hostile/malformed `config.downloadTimeoutMinutes`
 * can never produce a zero/negative/non-finite `setTimeout` delay (SF2: a
 * download timeout must always be non-zero and finite).
 * @param {object} config
 * @returns {number} a positive, finite timeout in milliseconds
 */
function resolveDownloadTimeoutMs(config) {
  const minutes = config && config.downloadTimeoutMinutes;
  if (Number.isInteger(minutes) && minutes > 0) {
    return minutes * 60 * 1000;
  }
  return DEFAULT_DOWNLOAD_TIMEOUT_MS;
}

/**
 * Thin seam for T4: build the metadata-listing args and run them. No
 * scheduling/dedup/filtering here -- see the module comment above.
 */
function runList(sub, config) {
  return spawnYtdlp(buildYtdlpListArgs(sub, config), {
    timeoutMs: DEFAULT_LIST_TIMEOUT_MS,
    cookiesPath: config && config.cookiesFile,
  });
}

/**
 * Thin seam for T4: build the download args and run them. No scheduling/
 * dedup/filtering here -- see the module comment above. Uses `spawnYtdlpDownload`
 * (SF3), not `spawnYtdlp`.
 *
 * C1 (T4 fix round): `targetIds` (a `string[]` of per-video ids T4 has already
 * filtered) is forwarded straight into `buildYtdlpDownloadArgs`, which is what
 * makes skip/defer decisions structurally binding on this spawn -- everything
 * else here (SF1 redaction, SF2 timeout, SF3 non-buffering stderr, SF7
 * settled-guard) is unchanged.
 *
 * FR-E: an optional 4th arg `opts = { onProgress }` is forwarded straight to
 * `spawnYtdlpDownload`. Omitting it (every pre-T2 call site) is fully
 * backward-compatible -- see that function's own doc comment.
 *
 * v1.15.0 item 6: `opts.oneOff` is forwarded to `buildYtdlpDownloadArgs` (its
 * own 4th param) -- see that function's doc comment. `undefined`/falsy
 * (every subscription call site) is unchanged behavior.
 *
 * v1.15.1 hotfix: the timeout is now `resolveDownloadTimeoutMs(config)`
 * (configurable via `config.downloadTimeoutMinutes`, default 180 minutes)
 * instead of the fixed `DEFAULT_DOWNLOAD_TIMEOUT_MS` constant -- see that
 * function's doc comment. A `config` without a valid
 * `downloadTimeoutMinutes` still gets `DEFAULT_DOWNLOAD_TIMEOUT_MS`, so this
 * is fully backward-compatible.
 * @param {object} sub
 * @param {object} config
 * @param {string[]} targetIds
 * @param {{onProgress?: (patch: object) => void, oneOff?: boolean}} [opts]
 */
function runDownload(sub, config, targetIds, opts = {}) {
  return spawnYtdlpDownload(buildYtdlpDownloadArgs(sub, config, targetIds, { oneOff: opts && opts.oneOff }), {
    timeoutMs: resolveDownloadTimeoutMs(config),
    cookiesPath: config && config.cookiesFile,
    onProgress: opts && opts.onProgress,
  });
}

/**
 * Best-effort presence check (`yt-dlp --version`) for a health/status line.
 * Never throws -- returns `false` on any failure (binary missing, spawn
 * error, non-zero exit), `true` only on a clean success.
 */
async function checkYtdlpAvailable() {
  const result = await spawnYtdlp(['--version']);
  return result.ok;
}

module.exports = {
  spawnYtdlp,
  spawnYtdlpDownload,
  // Alias kept for naming parity with the exec-plan design doc (`runYtdlp`)
  // -- both names refer to the exact same function.
  runYtdlp: spawnYtdlp,
  redactArgs,
  redactString,
  runList,
  runDownload,
  checkYtdlpAvailable,
  DEFAULT_LIST_TIMEOUT_MS,
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
  DEFAULT_KILL_SIGNAL,
  // v1.15.1 hotfix: exported so tests can assert the config-threading
  // behavior directly instead of only indirectly through `runDownload`.
  resolveDownloadTimeoutMs,
  // Exported so tests can assert the bounded-tail invariant (SF3) against
  // the real constant instead of a hardcoded duplicate.
  STDERR_TAIL_LIMIT,
  // v1.20.0 FR-2: the pure FTCHMETA line parser + its bounded-capture cap,
  // exported so tests can exercise/assert them directly instead of only
  // indirectly through spawnYtdlpDownload.
  parseChannelMetaLine,
  MAX_CAPTURED_META,
};
