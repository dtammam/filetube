// FileTube Downloader - MV3 background service worker (thin shell).
//
// This is the ONLY component that reads the token from storage and makes network
// calls to the instance (D1). All request-building / response-interpretation is
// the pure module ftClient.js; this file just glues chrome.storage + fetch to it.
//
// Messages handled (from popup.js / options.js):
//   { type:'download', url, format }              -> POSTs the one-off download
//   { type:'test', instanceUrl?, apiToken? }      -> side-effect-free connection test
//   { type:'status' }                             -> { configured: boolean } (no secret leaves the worker)

import {
  buildDownloadRequest,
  interpretDownloadResponse,
  buildTestRequest,
  interpretTestResponse,
} from './ftClient.js';

async function getConfig() {
  const { instanceUrl, apiToken } = await chrome.storage.local.get(['instanceUrl', 'apiToken']);
  return { instanceUrl: instanceUrl || '', apiToken: apiToken || '' };
}

// Run a built request and parse the reply into { status, payload, contentType }.
async function send({ endpoint, init }) {
  const res = await fetch(endpoint, init);
  const contentType = res.headers.get('content-type') || '';
  let payload = null;
  try { payload = await res.json(); } catch { /* non-JSON body (e.g. an HTML shell) */ }
  return { status: res.status, payload, contentType };
}

async function handleDownload({ url, format }) {
  const { instanceUrl, apiToken } = await getConfig();
  const built = buildDownloadRequest({ instanceUrl, apiToken, url, format });
  if (!built.ok) return built; // { ok:false, error, configured? }
  try {
    const { status, payload } = await send(built.request);
    return interpretDownloadResponse(status, payload);
  } catch (err) {
    const base = instanceUrl.replace(/\/+$/, '');
    return { ok: false, error: `Could not reach FileTube at ${base}: ${err && err.message ? err.message : err}` };
  }
}

async function handleTest(msg) {
  // Use the values the options page passes (what the user just typed); fall back
  // to stored config. The token still only leaves the worker via the fetch below.
  const stored = await getConfig();
  const instanceUrl = msg && typeof msg.instanceUrl === 'string' ? msg.instanceUrl : stored.instanceUrl;
  const apiToken = msg && typeof msg.apiToken === 'string' ? msg.apiToken : stored.apiToken;
  const built = buildTestRequest({ instanceUrl, apiToken });
  if (!built.ok) return built; // { ok:false, error }
  try {
    const { status, payload, contentType } = await send(built.request);
    return interpretTestResponse(status, payload, contentType);
  } catch (err) {
    const base = String(instanceUrl || '').replace(/\/+$/, '');
    return { ok: false, message: `Could not reach ${base}: ${err && err.message ? err.message : err}` };
  }
}

async function handleStatus() {
  const { instanceUrl, apiToken } = await getConfig();
  return { configured: Boolean(instanceUrl && apiToken) };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;
  let work = null;
  if (msg.type === 'download') work = handleDownload(msg);
  else if (msg.type === 'test') work = handleTest(msg);
  else if (msg.type === 'status') work = handleStatus();
  else return false;
  work.then(sendResponse);
  return true; // keep the message channel open for the async response
});
