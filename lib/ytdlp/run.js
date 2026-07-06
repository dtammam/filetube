'use strict';

// The ONLY module in lib/ytdlp/ that touches `child_process`. Every
// invocation goes through `execFile('yt-dlp', argsArray, opts)` -- an ARGUMENT
// ARRAY, never a shell string, and `opts` never sets `shell: true` (so it
// defaults to `false`). This mirrors server.js's FFmpeg pattern
// (`spawn('ffmpeg', args)`, server.js:665) and RELIABILITY.md's "wrap
// spawn/filesystem calls in try/catch; log and degrade, never crash."
//
// This file is a THIN invocation seam only: `runList`/`runDownload` just
// build args (via ./args.js) and call `spawnYtdlp`. There is no scheduling,
// dedup, shouldSkip/premiere filtering, or db write here -- that is T4's poll
// loop. Nothing in this file runs at import time or as a side effect of
// requiring it.

// `child_process` is required as a whole module (not destructured) and
// `cp.execFile` is referenced at CALL time inside `spawnYtdlp`, rather than
// bound to a local const at require time. This is what lets tests spy on
// the real spawn boundary by monkey-patching `require('child_process').execFile`
// (no mocking library / no dependency injection needed) and still prove the
// exact call shape (`'yt-dlp'`, an array, no `shell: true`) that production
// code takes.
const cp = require('child_process');
const { buildYtdlpListArgs, buildYtdlpDownloadArgs } = require('./args');

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10MB of stdout (a channel's --dump-json output can be sizeable)

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
 * Invoke yt-dlp with a pre-built argument array. NEVER pass a shell string
 * and NEVER set `{ shell: true }` -- `execFile` with an array argv is what
 * guarantees shell metacharacters in any argument (a URL, a path, ...) are
 * never interpreted by a shell. Wrapped so this never throws/rejects
 * uncaught: any failure (binary missing, non-zero exit, timeout) resolves to
 * a structured `{ ok: false, ... }` result instead, per RELIABILITY.md
 * ("log and degrade, never crash").
 * @param {string[]} args flat argv (see lib/ytdlp/args.js builders)
 * @param {{maxBuffer?: number, timeoutMs?: number, cwd?: string}} [opts]
 * @returns {Promise<{ok: boolean, code: (number|null), stdout: string, stderr: string, error?: string}>}
 */
function spawnYtdlp(args, opts = {}) {
  return new Promise((resolve) => {
    const execOpts = {
      maxBuffer: opts.maxBuffer || DEFAULT_MAX_BUFFER,
      timeout: opts.timeoutMs || 0,
      cwd: opts.cwd,
      // Deliberately NO `shell` key: execFile defaults to `shell: false`.
      // Never set this to `true` -- see the module comment above.
    };
    try {
      cp.execFile('yt-dlp', args, execOpts, (error, stdout, stderr) => {
        if (error) {
          console.error(`yt-dlp failed (${redactArgs(args).join(' ')}):`, error.message);
          resolve({
            ok: false,
            code: typeof error.code === 'number' ? error.code : null,
            stdout: stdout || '',
            stderr: stderr || '',
            error: error.message,
          });
          return;
        }
        resolve({ ok: true, code: 0, stdout: stdout || '', stderr: stderr || '' });
      });
    } catch (err) {
      // A synchronous throw from execFile itself (malformed args, etc.) --
      // still never propagates uncaught.
      console.error(`Failed to start yt-dlp (${redactArgs(args).join(' ')}):`, err.message);
      resolve({ ok: false, code: null, stdout: '', stderr: '', error: err.message });
    }
  });
}

/**
 * Thin seam for T4: build the metadata-listing args and run them. No
 * scheduling/dedup/filtering here -- see the module comment above.
 */
function runList(sub, config) {
  return spawnYtdlp(buildYtdlpListArgs(sub, config));
}

/**
 * Thin seam for T4: build the download args and run them. No scheduling/
 * dedup/filtering here -- see the module comment above.
 */
function runDownload(sub, config) {
  return spawnYtdlp(buildYtdlpDownloadArgs(sub, config));
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
  // Alias kept for naming parity with the exec-plan design doc (`runYtdlp`)
  // -- both names refer to the exact same function.
  runYtdlp: spawnYtdlp,
  redactArgs,
  runList,
  runDownload,
  checkYtdlpAvailable,
};
