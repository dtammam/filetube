'use strict';

// v1.43 test auth helper. The auth gate (installed in server.js) requires a
// valid session on every route. Pre-auth integration suites test route
// BEHAVIOR, not auth — so they authenticate through the REAL gate with a
// genuine session cookie (minted by the server's __mintTestSession export;
// NOT a bypass — it's the same cookie a browser login produces). One call in
// a suite's before() patches global.fetch to carry the cookie on requests to
// the test server, so existing `fetch(base + ...)` calls keep working
// unchanged. The gate's SECURITY is proven separately by lib/auth's unit
// suites + test/integration/auth-flow.test.js (which does NOT patch, so it
// exercises the unauthenticated paths).

// Patch global.fetch so any request whose URL starts with `base` gets the
// session cookie header (unless the caller already set a Cookie, e.g. an
// auth-negative test). Returns { cookie, user, restore }.
function authenticateFetch(server, base) {
  const { __mintTestSession } = require('../../server');
  const { cookie } = __mintTestSession();
  const realFetch = global.fetch;
  global.fetch = function (url, opts) {
    const u = typeof url === 'string' ? url : (url && url.url) || '';
    if (u.startsWith(base)) {
      opts = opts || {};
      const headers = Object.assign({}, opts.headers);
      // Respect an explicit Cookie (auth-negative tests set their own / none).
      const hasCookie = Object.keys(headers).some((k) => k.toLowerCase() === 'cookie');
      if (!hasCookie) headers.Cookie = cookie;
      opts = Object.assign({}, opts, { headers });
    }
    return realFetch(url, opts);
  };
  return {
    cookie,
    restore() { global.fetch = realFetch; },
  };
}

module.exports = { authenticateFetch };
