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
const savePageBtn = document.getElementById('save-page'); // v1.395.0 Pages
let currentTabId = null;

let currentUrl = '';

// A small, hand-picked set of well-known yt-dlp-supported sites, used ONLY as a
// POSITIVE hint ("we recognize this one") - never as a gate. yt-dlp supports
// ~1800 sites, so an unrecognized host is NOT rejected; it simply gets the
// permissive "yt-dlp will decide" message. Matched by hostname suffix so
// subdomains (m.youtube.com, www.vimeo.com) still resolve.
const KNOWN_SITES = [
  { name: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  { name: 'Vimeo', hosts: ['vimeo.com'] },
  { name: 'SoundCloud', hosts: ['soundcloud.com'] },
  { name: 'Twitch', hosts: ['twitch.tv'] },
  { name: 'Dailymotion', hosts: ['dailymotion.com', 'dai.ly'] },
  { name: 'TikTok', hosts: ['tiktok.com'] },
  { name: 'X (Twitter)', hosts: ['twitter.com', 'x.com'] },
  { name: 'Reddit', hosts: ['reddit.com'] },
  { name: 'Facebook', hosts: ['facebook.com', 'fb.watch'] },
  { name: 'Instagram', hosts: ['instagram.com'] },
  { name: 'Bandcamp', hosts: ['bandcamp.com'] },
  { name: 'BiliBili', hosts: ['bilibili.com'] },
];

// The display names shown in the always-visible "supported sites" hint.
const SITE_HINT = 'YouTube, Vimeo, SoundCloud, Twitch, TikTok';

// Return the friendly name of a recognized site for `host`, or null.
function recognizeSite(host) {
  for (const site of KNOWN_SITES) {
    if (site.hosts.some((h) => host === h || host.endsWith('.' + h))) return site.name;
  }
  return null;
}

// Client compatibility heuristic. Intentionally PERMISSIVE - it mirrors the
// server's isPlausibleMediaUrl (lib/ytdlp/url.js) rather than a curated host
// list (which would rot against yt-dlp's ~1800 extractors). It only hard-blocks
// pages yt-dlp can never take, and RECOGNIZES a few well-known sites for a
// friendlier message. The authoritative verdict is the server's own response to
// the download POST (see the design doc, "Compatibility-check").
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
  const site = recognizeSite(host);
  if (site) {
    return { ok: true, site, reason: `✓ ${site} — a supported site.` };
  }
  return { ok: true, site: null, reason: 'yt-dlp will make the final call when you download.' };
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentUrl = (tab && tab.url) || '';
  currentTabId = tab && typeof tab.id === 'number' ? tab.id : null;
  urlEl.textContent = currentUrl || 'No active tab URL.';

  // Always show which sites are supported (a positive hint, shown even when the
  // extension isn't configured yet).
  const hintEl = document.getElementById('sites-hint');
  if (hintEl) hintEl.textContent = `Supported: ${SITE_HINT} — & ~1800 more via yt-dlp.`;

  // Not-configured takes precedence: no point enabling buttons that can't reach
  // an instance. Asking the worker (rather than reading storage here) keeps the
  // token inside the service worker (D1).
  const status = await chrome.runtime.sendMessage({ type: 'status' });
  // v1.395.0 Pages: Save to Pages needs only the instance and a Pages token (not yt-dlp).
  savePageBtn.disabled = !(status && status.pagesConfigured) || !/^https?:/i.test(currentUrl);
  if (status && !status.pagesConfigured) savePageBtn.title = 'Set a Pages token in Options (FileTube Settings > Pages).';
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
  reasonEl.classList.toggle('compat-yes', !!compat.site);
  audioBtn.disabled = !compat.ok;
  videoBtn.disabled = !compat.ok;
  // v1.370.0: a playlist page has no one video for Audio / Video (Choose from playlist... is the way)
  const { isPlaylistOnly } = await import('./ftClient.js');
  if (isPlaylistOnly(currentUrl)) {
    audioBtn.disabled = true;
    videoBtn.disabled = true;
    reasonEl.textContent = 'This is a playlist: use Choose from playlist to pick its videos.';
  }

  // v1.370.0 (R10): a playlist tab (not a Mix) gets "Choose from playlist...": FileTube's picker in a new tab,
  // with the user's normal login (the API token is never used for it)
  const pickBtn = document.getElementById('pick');
  const pickUrl = await pickUrlFor(status.instanceUrl, currentUrl);
  if (pickBtn && pickUrl) {
    pickBtn.hidden = false;
    pickBtn.addEventListener('click', () => { chrome.tabs.create({ url: pickUrl }); window.close(); });
  }
}

async function pickUrlFor(instanceUrl, tabUrl) {
  const { playlistPickUrl } = await import('./ftClient.js');
  return playlistPickUrl(instanceUrl, tabUrl);
}

async function download(format) {
  audioBtn.disabled = true;
  videoBtn.disabled = true;
  setStatus('Sending to FileTube...', null);

  const result = await chrome.runtime.sendMessage({ type: 'download', url: currentUrl, format });

  if (result && result.ok && result.waiting) {
    setStatus(result.message, 'ok'); // v1.370.0: the playlist waits in FileTube
    return;
  }
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

// v1.395.0 Pages: the tab as the browser rendered it (logins, paywalls: exactly what you see),
// serialized with XMLSerializer in the page; a page the extension cannot read (the Web Store, a
// PDF viewer) is sent as its URL alone and the server fetches it.
async function savePage() {
  savePageBtn.disabled = true;
  setStatus('Saving to Pages...', null);
  let html = null;
  if (currentTabId !== null && chrome.scripting) {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        func: () => new XMLSerializer().serializeToString(document),
      });
      if (res && typeof res.result === 'string') html = res.result;
    } catch { html = null; }
  }
  const result = await chrome.runtime.sendMessage({ type: 'savePage', url: currentUrl, html });
  if (result && result.ok) {
    setStatus(result.message + (result.sentHtml ? '' : ' (from its link)'), 'ok');
    return;
  }
  setStatus((result && result.error) || 'Could not save the page.', 'error');
  savePageBtn.disabled = false;
}

function openOptions(e) {
  if (e) e.preventDefault();
  chrome.runtime.openOptionsPage();
}

savePageBtn.addEventListener('click', savePage);
audioBtn.addEventListener('click', () => download('audio'));
videoBtn.addEventListener('click', () => download('video'));
document.getElementById('open-options').addEventListener('click', openOptions);

init().catch((err) => setStatus(String(err && err.message ? err.message : err), 'error'));
