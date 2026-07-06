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
// real spawn boundary by monkey-patching `require('child_process').execFile`/
// `.spawn` (no mocking library / no dependency injection needed) and still
// prove the exact call shape (`'yt-dlp'`, an array, no `shell: true`) that
// production code takes.
const cp = require('child_process');
const { buildYtdlpListArgs, buildYtdlpDownloadArgs } = require('./args');

// LIST pass: metadata-only (`--dump-json`), no file is ever written. Its
// stdout is the JSON T4 parses, so a bounded `maxBuffer` is appropriate here
// (SF3) -- a channel's metadata dump is large but finite and known ahead of
// time, unlike a download's open-ended stderr progress stream.
const DEFAULT_LIST_MAX_BUFFER = 10 * 1024 * 1024; // 10MB of stdout

// Non-zero spawn timeouts (SF2). `timeout: 0` is UNBOUNDED in Node -- a
// livestream/premiere/slowloris URL would otherwise hang the child forever
// and wedge the (T4) poll loop's awaiting promise. Listing metadata is a
// quick network round-trip so it gets a short ceiling; a real download can
// legitimately run for a long time, so it gets a much longer one. Both are
// finite so a hung child is always eventually reclaimed.
const DEFAULT_LIST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes -- a listing/metadata pass should be quick
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes -- a real video download can legitimately take a while

// `SIGKILL` (not `SIGTERM`) so a wedged/hung yt-dlp process is unconditionally
// reclaimed -- a hung child is, by definition, not responding to signals it
// could otherwise handle gracefully, and there is no cleanup yt-dlp needs to
// do on our behalf (a killed download simply leaves a partial file, which is
// already the outcome of any other yt-dlp failure and is handled the same way
// downstream: re-polled/re-attempted, never silently treated as success).
const DEFAULT_KILL_SIGNAL = 'SIGKILL';

// Bounded tail kept for a download's stderr for diagnostics ONLY -- SF3 is
// explicitly about NOT accumulating a download's stderr (its periodic
// progress output can be unbounded over a multi-hour run and, with `execFile`
// + `maxBuffer`, would eventually SIGTERM the child mid-download). This tail
// is small and fixed-size regardless of how long the process runs.
const STDERR_TAIL_LIMIT = 4096;

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
 * Invoke yt-dlp with a pre-built argument array via `execFile`. NEVER pass a
 * shell string and NEVER set `{ shell: true }` -- `execFile` with an array
 * argv is what guarantees shell metacharacters in any argument (a URL, a
 * path, ...) are never interpreted by a shell. Wrapped so this never
 * throws/rejects uncaught: any failure (binary missing, non-zero exit,
 * timeout) resolves to a structured `{ ok: false, ... }` result instead, per
 * RELIABILITY.md ("log and degrade, never crash").
 *
 * This is the LIST-path (and presence-check) invocation: its stdout is
 * bounded JSON metadata, so a `maxBuffer` is appropriate (see the module
 * comment above re: SF3). Downloads use `spawnYtdlpDownload` instead.
 * @param {string[]} args flat argv (see lib/ytdlp/args.js builders)
 * @param {{maxBuffer?: number, timeoutMs?: number, cwd?: string, cookiesPath?: string, killSignal?: string}} [opts]
 * @returns {Promise<{ok: boolean, code: (number|string|null), stdout: string, stderr: string, error?: string}>}
 */
function spawnYtdlp(args, opts = {}) {
  const cookiesPath = opts.cookiesPath || null;
  return new Promise((resolve) => {
    const execOpts = {
      maxBuffer: opts.maxBuffer || DEFAULT_LIST_MAX_BUFFER,
      // Non-zero default (SF2): `timeout: 0` is unbounded in Node.
      timeout: opts.timeoutMs || DEFAULT_LIST_TIMEOUT_MS,
      killSignal: opts.killSignal || DEFAULT_KILL_SIGNAL,
      cwd: opts.cwd,
      // Deliberately NO `shell` key: execFile defaults to `shell: false`.
      // Never set this to `true` -- see the module comment above.
    };
    try {
      cp.execFile('yt-dlp', args, execOpts, (error, stdout, stderr) => {
        if (error) {
          // SF1: log a SAFE, composed description -- never `error.message`
          // (which can embed the full un-redacted argv, incl. the cookies
          // path, defeating `redactArgs` if logged/returned directly).
          console.error('yt-dlp failed:', describeFailure(args, error));
          // A timeout kill (SF2) surfaces as `error.killed` with no numeric
          // exit code -- reported as a distinct 'ETIMEDOUT' code so callers
          // can distinguish "the process hung" from "yt-dlp exited non-zero".
          const code = error.killed ? 'ETIMEDOUT' : (error.code !== undefined && error.code !== null ? error.code : null);
          resolve({
            ok: false,
            code,
            stdout: stdout || '',
            stderr: stderr || '',
            // SF1: the RETURNED error is redacted too -- this is the field
            // T4 would persist to db.json / expose via GET /api/subscriptions.
            error: redactString(error.message, cookiesPath),
          });
          return;
        }
        resolve({ ok: true, code: 0, stdout: stdout || '', stderr: stderr || '' });
      });
    } catch (err) {
      // A synchronous throw from execFile itself (malformed args, etc.) --
      // still never propagates uncaught, and still never leaks the raw
      // message/cookies path (SF1's sync-throw path).
      console.error('Failed to start yt-dlp:', describeFailure(args, err));
      resolve({ ok: false, code: null, stdout: '', stderr: '', error: redactString(err.message, cookiesPath) });
    }
  });
}

/**
 * Invoke yt-dlp for a DOWNLOAD using `spawn` (arg-array, NO shell -- same
 * guarantee as `execFile` above) instead of `execFile`. SF3: `execFile`'s
 * `maxBuffer` bounds stdout AND stderr combined; a long-running download's
 * periodic stderr progress output can exceed it, and Node's response is to
 * SIGTERM the child -- killing a legitimate multi-hour download and leaving a
 * partial file. `spawn` gives direct access to the stderr stream so it can be
 * drained WITHOUT accumulating an in-memory buffer that could ever trip a
 * size limit: only a small, fixed-size tail is kept (for diagnostics), no
 * matter how long the process runs or how much it prints.
 *
 * Same redaction (SF1) and non-zero-timeout-with-killSignal (SF2) guarantees
 * as `spawnYtdlp` apply here too.
 * @param {string[]} args flat argv (see lib/ytdlp/args.js's buildYtdlpDownloadArgs)
 * @param {{timeoutMs?: number, cwd?: string, cookiesPath?: string, killSignal?: string}} [opts]
 * @returns {Promise<{ok: boolean, code: (number|string|null), stdout: string, stderr: string, error?: string}>}
 */
function spawnYtdlpDownload(args, opts = {}) {
  const cookiesPath = opts.cookiesPath || null;
  const timeoutMs = opts.timeoutMs || DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const killSignal = opts.killSignal || DEFAULT_KILL_SIGNAL;

  return new Promise((resolve) => {
    let child;
    try {
      child = cp.spawn('yt-dlp', args, {
        cwd: opts.cwd,
        // stdin/stdout ignored (nothing consumes stdout during a download;
        // yt-dlp writes the file itself); stderr piped so it can be drained
        // below WITHOUT letting Node accumulate/buffer it internally the way
        // `execFile`'s `maxBuffer` does.
        stdio: ['ignore', 'ignore', 'pipe'],
        // Deliberately NO `shell` key: `spawn` defaults to `shell: false`.
        // Never set this to `true` -- see the module comment above.
      });
    } catch (err) {
      console.error('Failed to start yt-dlp:', describeFailure(args, err));
      resolve({ ok: false, code: null, stdout: '', stderr: '', error: redactString(err.message, cookiesPath) });
      return;
    }

    let stderrTail = '';
    let timedOut = false;
    let settled = false;

    let timer = null;
    function clear() {
      if (timer) clearTimeout(timer);
    }

    // SF7: a piped stream (child.stderr here) can itself emit 'error' (a rare
    // underlying fd/read error) independently of the child process's own
    // 'error'/'close' events. An EventEmitter with ZERO 'error' listeners
    // THROWS synchronously when one fires -- and that throw happens BEFORE
    // any of the settle-the-promise logic below runs, so without a listener
    // here this promise would never resolve (a silent hang for that one poll
    // iteration, exactly the kind of hang SF2/SF3 were meant to eliminate).
    // Routing it through the same `settled` guard as 'error'/'close' below
    // both prevents the throw AND resolves deterministically -- and the
    // guard itself prevents a double-resolve if 'close' also fires
    // afterwards (or the reverse).
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        // Keep only a bounded tail -- never let this grow with the process's
        // lifetime (the whole point of SF3).
        stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_LIMIT);
      });
      child.stderr.on('error', (err) => {
        if (settled) return;
        settled = true;
        clear();
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
      const safeStderr = redactString(stderrTail, cookiesPath);
      if (timedOut) {
        console.error('yt-dlp timed out:', describeFailure(args, { code: 'ETIMEDOUT', signal }));
        resolve({ ok: false, code: 'ETIMEDOUT', stdout: '', stderr: safeStderr, error: 'yt-dlp timed out and was killed' });
        return;
      }
      if (code === 0) {
        resolve({ ok: true, code: 0, stdout: '', stderr: safeStderr });
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
      });
    });
  });
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
 */
function runDownload(sub, config, targetIds) {
  return spawnYtdlpDownload(buildYtdlpDownloadArgs(sub, config, targetIds), {
    timeoutMs: DEFAULT_DOWNLOAD_TIMEOUT_MS,
    cookiesPath: config && config.cookiesFile,
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
};
