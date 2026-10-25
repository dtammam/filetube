// FileTube Downloader - MV3 background service worker (thin shell).
//
// This is the ONLY component that reads the token from storage and makes network
// calls to the instance (D1). All request-building / response-interpretation is
// the pure module ftClient.js; this file just glues chrome.storage + fetch to it.
//
// Messages handled (from popup.js / options.js):
//   { type:'download', url, format }              -> POSTs the one-off download
//   { type:'test', instanceUrl?, apiToken? }      -> side-effect-free connection test
//   { type:'status' }                             -> { configured, pagesConfigured, instanceUrl } (no secret leaves the worker)
//   { type:'savePage', url, html? }               -> v1.395.0: POSTs the tab to the user's Pages

import {
  buildDownloadRequest,
  interpretDownloadResponse,
  buildTestRequest,
  interpretTestResponse,
  buildSavePageRequest,
  interpretSavePageResponse,
} from './ftClient.js';

async function getConfig() {
  const { instanceUrl, apiToken, pagesToken } = await chrome.storage.local.get(['instanceUrl', 'apiToken', 'pagesToken']);
  return { instanceUrl: instanceUrl || '', apiToken: apiToken || '', pagesToken: pagesToken || '' };
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
  const { instanceUrl, apiToken, pagesToken } = await getConfig();
  // v1.370.0 (R10): the instance URL (not the token) so the popup can open the playlist picker there
  return { configured: Boolean(instanceUrl && apiToken), pagesConfigured: Boolean(instanceUrl && pagesToken), instanceUrl: instanceUrl || '' };
}

// v1.395.0 Pages: the tab's rendered HTML (or its URL alone) to the user's own Pages.
async function handleSavePage({ url, html }) {
  const { instanceUrl, pagesToken } = await getConfig();
  const built = buildSavePageRequest({ instanceUrl, pagesToken, url, html });
  if (!built.ok) return built;
  try {
    const { status, payload } = await send(built.request);
    if (status === 413 && built.sentHtml) {
      // Too large for the server after all: send the link alone and let the server fetch it.
      const linkOnly = buildSavePageRequest({ instanceUrl, pagesToken, url, html: null });
      const again = await send(linkOnly.request);
      return { ...interpretSavePageResponse(again.status, again.payload), sentHtml: false };
    }
    return { ...interpretSavePageResponse(status, payload), sentHtml: built.sentHtml };
  } catch (err) {
    const base = instanceUrl.replace(/\/+$/, '');
    return { ok: false, error: `Could not reach FileTube at ${base}: ${err && err.message ? err.message : err}` };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;
  let work = null;
  if (msg.type === 'download') work = handleDownload(msg);
  else if (msg.type === 'test') work = handleTest(msg);
  else if (msg.type === 'status') work = handleStatus();
  else if (msg.type === 'savePage') work = handleSavePage(msg);
  else return false;
  work.then(sendResponse);
  return true; // keep the message channel open for the async response
});
