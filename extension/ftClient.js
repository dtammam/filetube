// FileTube Downloader - PURE client logic (no chrome.*, no DOM, no I/O).
//
// Everything that decides "what request do we send" and "what does the response
// mean" lives here so it can be exercised by node:test WITHOUT a browser (see
// the test-harness proposal in the design doc). background.js is a thin shell
// that reads chrome.storage, calls these builders, does the fetch, and passes
// the raw {status, payload, contentType} back into these interpreters.
//
// Server contract (EXISTS today; zero server change - D2):
//   POST {instanceUrl}/api/ytdlp/download
//   headers: Content-Type: application/json, X-FileTube-Token: <token>
//   body:    { url, format }              // format: 'audio' | 'video' (D4)
//   -> 202 { accepted:true, jobId }       // queued
//   -> 400 { error }                      // bad url/format
//   -> 401 { error }                      // bad/missing token   (lib/auth/gate.js:256)
//   -> 403 { error, readOnlyMedia:true }  // instance in read-only-media mode
//   -> 503 { error }                      // download queue full

export const DOWNLOAD_PATH = '/api/ytdlp/download';
export const VALID_FORMATS = ['audio', 'video'];

// Strip trailing slashes so `${base}${DOWNLOAD_PATH}` is always clean.
export function normalizeInstanceUrl(raw) {
  return String(raw || '').trim().replace(/\/+$/, '');
}

// Turn an instance URL into an origin match pattern for a scoped host permission.
// Throws on an unparseable URL (the caller reports it).
export function originPattern(rawUrl) {
  const u = new URL(rawUrl);
  return `${u.protocol}//${u.host}/*`;
}

// Validate config + inputs and produce the fetch args, or an error result.
// Returns either { ok:true, request:{ endpoint, init } }
//         or     { ok:false, error, configured? }.
export function buildDownloadRequest({ instanceUrl, apiToken, url, format }) {
  const base = normalizeInstanceUrl(instanceUrl);
  if (!base || !apiToken) {
    return {
      ok: false,
      configured: false,
      error: 'FileTube is not configured yet. Open the extension options and set your instance URL and API token.',
    };
  }
  if (!VALID_FORMATS.includes(format)) {
    return { ok: false, error: "format must be 'audio' or 'video'" };
  }
  if (typeof url !== 'string' || url.trim() === '') {
    return { ok: false, error: 'No page URL to download.' };
  }
  return {
    ok: true,
    request: {
      endpoint: `${base}${DOWNLOAD_PATH}`,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // D1: the route-scoped bearer token - NOT a cookie. The server has no
          // CORS and its session cookie is SameSite=Lax, so a cross-site
          // extension POST would never carry a cookie anyway.
          'X-FileTube-Token': apiToken,
        },
        // D4: v1 sends only { url, format }; the server defaults quality=best
        // and auto-routes the destination folder.
        body: JSON.stringify({ url, format }),
      },
    },
  };
}

// Interpret a download response. `payload` is the parsed JSON body (or null).
// Always surfaces the SERVER's own error message verbatim - never invents one.
export function interpretDownloadResponse(status, payload) {
  if (status === 202 && payload && payload.accepted) {
    return { ok: true, status, jobId: payload.jobId };
  }
  return {
    ok: false,
    status,
    error: (payload && payload.error) || `Request failed (HTTP ${status}).`,
  };
}

// Build a side-effect-free "test connection" request.
//
// WHY this shape: the X-FileTube-Token header is accepted by the auth gate for
// EXACTLY one route - POST /api/ytdlp/download (lib/auth/gate.js:244). Every
// other authed endpoint needs the session cookie, which the extension does not
// have, so there is no generic authed GET to probe. We therefore probe the one
// route the token unlocks, with an EMPTY url: the handler validates the url
// synchronously and returns 400 BEFORE queueing anything (lib/ytdlp/index.js
// :6002-6004), so no download is ever triggered. A bad token 401s at the gate
// before the handler ever runs.
export function buildTestRequest({ instanceUrl, apiToken }) {
  const base = normalizeInstanceUrl(instanceUrl);
  if (!base || !apiToken) {
    return { ok: false, error: 'Enter both an instance URL and an API token first.' };
  }
  return {
    ok: true,
    request: {
      endpoint: `${base}${DOWNLOAD_PATH}`,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-FileTube-Token': apiToken,
        },
        body: JSON.stringify({ url: '' }), // empty url -> 400 before any queue
      },
    },
  };
}

// Interpret a test-connection response.
//   401                         -> bad/missing token
//   404 / non-JSON (HTML shell) -> endpoint not found (yt-dlp disabled? wrong URL?)
//   403 readOnlyMedia           -> token OK, but instance is read-only right now
//   otherwise a JSON reply      -> token accepted + endpoint reachable = OK
export function interpretTestResponse(status, payload, contentType) {
  if (status === 401) {
    return { ok: false, message: (payload && payload.error) || 'Invalid API token.' };
  }
  const isJson = typeof contentType === 'string' && contentType.includes('application/json');
  if (status === 404 || !isJson) {
    return {
      ok: false,
      message: 'Reached the server, but the download endpoint was not found. Is FILETUBE_YTDLP_ENABLED set, and is the instance URL correct?',
    };
  }
  if (status === 403 && payload && payload.readOnlyMedia) {
    return {
      ok: true,
      message: 'Token accepted, but the instance is in read-only-media mode; downloads are disabled there right now.',
    };
  }
  // 400 (our empty url), 202, 503, or any other JSON reply from the handler all
  // mean the token got PAST the auth gate and the endpoint is live.
  return { ok: true, message: 'Connection OK - token accepted and the download endpoint is reachable.' };
}
