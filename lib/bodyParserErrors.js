'use strict';

// Shared body-parser-error -> JSON-response mapping (two-reviewer gate
// follow-up, v1.28.0, F1). Required directly by BOTH server.js's global
// `express.json()` error middleware AND lib/ytdlp/index.js's route-scoped
// `express.text()` error middleware on `POST /api/ytdlp/download` -- a
// single shared function (not two independently-maintained copies)
// guarantees both surfaces stay byte-identical as this mapping evolves, and
// that every JSON-API caller (a browser fetch(), curl, an iOS Shortcut) gets
// the exact same clean-JSON-error contract regardless of which body parser
// or which route rejected its body.
//
// They CANNOT instead share a single MIDDLEWARE INSTANCE: Express only ever
// walks its error-handling stack FORWARDS from the point an error is raised
// (`stack[idx++]` in express/lib/router/index.js's `next()` -- there is no
// rewind), so a middleware registered in server.js BEFORE
// `ytdlp.registerRoutes` is even called can never be reached by an error
// raised inside a route that module registers afterward. This was confirmed
// empirically while fixing F1: an oversized text/plain body posted to a
// later-mounted route still rendered Express's own default HTML error page
// even with an earlier, already-broadened JSON-error middleware sitting in
// the stack. Hence: one shared mapping FUNCTION, two separate middleware
// call sites -- one per module, each registered immediately after the parser
// whose errors it exists to catch.
//
// Returns `{ status, body }` for a recognized body-parser failure, or `null`
// for anything else -- the caller's own middleware must `next(err)` in that
// case (a `null` return NEVER swallows an unrelated error; e.g. a route
// handler's own thrown error must still reach Express's normal handling).
function formatBodyParserError(err) {
  if (!err || typeof err.type !== 'string') return null;

  if (err.type === 'entity.too.large') {
    // The same underlying `raw-body` failure for BOTH `express.json()` and
    // `express.text()` (body-parser's `read.js` -- the actual stream reader
    // -- is shared by every body-parser body type): an oversized body is an
    // oversized body regardless of Content-Type, so both callers see this
    // exact mapping.
    return { status: 413, body: { error: 'request body too large' } };
  }
  if (err.type === 'entity.parse.failed') {
    // JSON-specific: only body-parser's `json` parser ever raises this type
    // (a body that looked like it should parse as JSON and didn't).
    // `express.text()` never raises it -- a text/plain body is never
    // "parsed" in that sense, it is just read as a string.
    return { status: 400, body: { error: `request body is not valid JSON: ${err.message}` } };
  }
  if (err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') {
    // A malformed/unsupported `Content-Encoding` or charset -- body-parser's
    // `read.js` raises these for either parser type before any actual
    // JSON/text interpretation happens.
    return { status: 400, body: { error: `request body could not be read: ${err.message}` } };
  }
  return null;
}

module.exports = { formatBodyParserError };
