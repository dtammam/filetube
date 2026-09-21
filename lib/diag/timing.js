'use strict';

// lib/diag/timing.js - a top-of-stack Server-Timing middleware for the
// perf-diagnostics suite (branch exp/perf-diagnostics). Its whole job is to let
// us split a request's client-observed TTFB into "time the box spent" vs "time
// the pipe spent": the client already sees TTFB via the Resource Timing API
// (responseStart - requestStart); this header tells it how much of that was
// server compute, so `network ~= TTFB - Server-Timing:app`.
//
// It must be registered BEFORE the app's own routes (near the top of server.js)
// or it cannot wrap their header flush - a route registered earlier in the
// Express stack responds without ever reaching a middleware added later. It is
// always installed, but no-ops per request unless isEnabled() is true (the
// persisted perfDiagnosticsEnabled setting or FT_DIAG), so a normal install
// pays only the predicate check and never patches writeHead.
//
// Mechanism: we record a start time, then wrap res.writeHead so that at the
// moment the status/headers are about to flush (i.e. first byte), we stamp
// Server-Timing with the elapsed server time. Doing it in writeHead (not an
// 'finish' listener) is deliberate: headers cannot be added once they are sent,
// and first-byte is exactly the boundary we want to measure to.

function createDiagTiming({ isEnabled }) {
  const enabled = typeof isEnabled === 'function' ? isEnabled : function () { return !!isEnabled; };
  return function diagTiming(req, res, next) {
    if (!enabled()) return next();
    const start = process.hrtime.bigint();
    const origWriteHead = res.writeHead;
    res.writeHead = function patchedWriteHead(...args) {
      try {
        const durMs = Number(process.hrtime.bigint() - start) / 1e6;
        // Only set if headers are still open and nothing set it already.
        if (!res.headersSent && !res.getHeader('Server-Timing')) {
          res.setHeader('Server-Timing', `app;dur=${durMs.toFixed(1)}`);
        }
      } catch (_) {
        // never let instrumentation break a response
      }
      return origWriteHead.apply(this, args);
    };
    next();
  };
}

module.exports = { createDiagTiming };
