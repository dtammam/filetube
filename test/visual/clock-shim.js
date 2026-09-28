'use strict';
// A pinned wall clock for the visual and geometry fixtures (plan D10.5 determinism).
//
// Loaded with `node --require test/visual/clock-shim.js` (start-server.sh does it via
// NODE_OPTIONS) or required first by seed.js. When FILETUBE_CLOCK_MS is set, the process
// starts its wall clock at that instant and lets it FLOW at the real rate from there:
// `Date.now()` and `new Date()` return FILETUBE_CLOCK_MS + (real time since load). Every
// other Date use (`new Date(x)`, parse, UTC, instanceof) is untouched, and no timer is faked,
// so nothing that waits for time to pass can hang.
//
// Why the SERVER needs it and not only the browser: the seeder stamps rows through the real
// routes (watch progress), and the server compares stored times with its own clock (retention
// windows, "recent" filters). With a fixed seed date and a real server clock, those
// comparisons drift as the calendar moves, and a 0-changed-pixel baseline would go red months
// later with no code change. Session cookies use Max-Age (lib/auth/gate.js), never Expires,
// so a server clock in the past cannot expire the browser's login.
//
// The browser side is the same idea as an init script (capture.js clockInitScript).
const ms = Number(process.env.FILETUBE_CLOCK_MS);
if (Number.isFinite(ms) && ms > 0 && !globalThis.__filetubeClockShim) {
  const RealDate = Date;
  const offset = ms - RealDate.now();
  const now = () => RealDate.now() + offset;
  // A function, not a class: `Date()` without `new` must still return a string.
  function PinnedDate(...args) {
    if (!new.target) return new RealDate(now()).toString();
    return args.length ? new RealDate(...args) : new RealDate(now());
  }
  Object.setPrototypeOf(PinnedDate, RealDate);
  PinnedDate.prototype = RealDate.prototype;
  PinnedDate.now = now;
  PinnedDate.parse = RealDate.parse;
  PinnedDate.UTC = RealDate.UTC;
  globalThis.Date = PinnedDate;
  globalThis.__filetubeClockShim = { startedAt: ms };
}
