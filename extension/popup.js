// FileTube Downloader - popup.
//
// Reads the active tab URL (activeTab, granted on this user gesture), runs a
// permissive client-side compatibility heuristic to enable/disable the buttons,
// and hands a download request to the background service worker.

const urlEl = document.getElementById('url');
const reasonEl = document.getElementById('reason');
const statusEl = document.getElementById('status');
const audioBtn = document.getElementById('audio');
const videoBtn = document.getElementById('video');

let currentUrl = '';

// Client compatibility heuristic. Intentionally PERMISSIVE - it mirrors the
// server's isPlausibleMediaUrl (lib/ytdlp/url.js) rather than a curated host
// list (which would rot against yt-dlp's ~1800 extractors). It only hard-blocks
// pages yt-dlp can never take. The authoritative verdict is the server's own
// response to the download POST (see the design doc, "Compatibility-check").
function checkCompatible(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return { ok: false, reason: 'No page URL available.' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: 'Only http(s) pages can be downloaded.' };
  }
  const host = u.hostname.toLowerCase();
  const isLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (isLocal) {
    return { ok: false, reason: 'Local/private hosts are not supported.' };
  }
  // NOTE: we do NOT try to detect the FileTube instance origin here - that check
  // belongs alongside the configured instanceUrl and can be added once options
  // are wired end-to-end. Permissive by design.
  return { ok: true, reason: 'yt-dlp will make the final call when you download.' };
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentUrl = (tab && tab.url) || '';
  urlEl.textContent = currentUrl || 'No active tab URL.';

  // Not-configured takes precedence: no point enabling buttons that can't reach
  // an instance. Asking the worker (rather than reading storage here) keeps the
  // token inside the service worker (D1).
  const status = await chrome.runtime.sendMessage({ type: 'status' });
  if (!status || !status.configured) {
    audioBtn.disabled = true;
    videoBtn.disabled = true;
    reasonEl.innerHTML = 'Not configured. <a href="#" id="open-options-inline">Open options</a> to set your FileTube instance and token.';
    const link = document.getElementById('open-options-inline');
    if (link) link.addEventListener('click', openOptions);
    return;
  }

  const compat = checkCompatible(currentUrl);
  reasonEl.textContent = compat.reason;
  audioBtn.disabled = !compat.ok;
  videoBtn.disabled = !compat.ok;
}

async function download(format) {
  audioBtn.disabled = true;
  videoBtn.disabled = true;
  setStatus('Sending to FileTube...', null);

  const result = await chrome.runtime.sendMessage({ type: 'download', url: currentUrl, format });

  if (result && result.ok) {
    setStatus(`Accepted (${format}). Job ${result.jobId}.`, 'ok');
    return; // leave buttons disabled after a successful enqueue
  }

  // Surface the server's / worker's message verbatim.
  setStatus((result && result.error) || 'Download failed.', 'error');
  if (result && result.configured === false) {
    reasonEl.innerHTML = '<a href="#" id="open-options-inline">Open options to configure FileTube</a>';
    const link = document.getElementById('open-options-inline');
    if (link) link.addEventListener('click', openOptions);
  }
  // Re-enable so the user can retry.
  const compat = checkCompatible(currentUrl);
  audioBtn.disabled = !compat.ok;
  videoBtn.disabled = !compat.ok;
}

function openOptions(e) {
  if (e) e.preventDefault();
  chrome.runtime.openOptionsPage();
}

audioBtn.addEventListener('click', () => download('audio'));
videoBtn.addEventListener('click', () => download('video'));
document.getElementById('open-options').addEventListener('click', openOptions);

init().catch((err) => setStatus(String(err && err.message ? err.message : err), 'error'));
