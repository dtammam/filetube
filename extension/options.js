// FileTube Downloader - options page.
//
// Saves the instance URL + API token to chrome.storage.local and requests a
// host permission scoped to EXACTLY the configured instance origin (from the
// broad optional_host_permissions in the manifest). The default install has no
// network reach until the user configures one instance. The actual network
// calls (save-test and downloads) happen in the background service worker (D1);
// this page only reads the fields and messages the worker.

import { originPattern } from './ftClient.js';

const instanceEl = document.getElementById('instanceUrl');
const tokenEl = document.getElementById('apiToken');
const saveBtn = document.getElementById('save');
const testBtn = document.getElementById('test');
const statusEl = document.getElementById('status');

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
}

// Validate the fields and return { instanceUrl, apiToken, pattern } or null
// (having set an error status). Also requests the scoped host permission, which
// must be user-gesture driven - both Save and Test are clicks, so this is valid.
async function validateAndAuthorize() {
  const instanceUrl = instanceEl.value.trim().replace(/\/+$/, '');
  const apiToken = tokenEl.value;

  let pattern;
  try {
    pattern = originPattern(instanceUrl);
    if (!/^https?:$/.test(new URL(instanceUrl).protocol)) {
      setStatus('Instance URL must be http(s).', 'error');
      return null;
    }
  } catch {
    setStatus('That does not look like a valid URL.', 'error');
    return null;
  }
  if (!apiToken) {
    setStatus('An API token is required.', 'error');
    return null;
  }

  let granted;
  try {
    granted = await chrome.permissions.request({ origins: [pattern] });
  } catch (err) {
    setStatus(`Permission request failed: ${err && err.message ? err.message : err}`, 'error');
    return null;
  }
  if (!granted) {
    setStatus('Host permission for the instance was not granted; downloads will not work until it is.', 'error');
    return null;
  }
  return { instanceUrl, apiToken, pattern };
}

async function load() {
  const { instanceUrl, apiToken } = await chrome.storage.local.get(['instanceUrl', 'apiToken']);
  if (instanceUrl) instanceEl.value = instanceUrl;
  if (apiToken) tokenEl.value = apiToken;
}

async function save() {
  const v = await validateAndAuthorize();
  if (!v) return;
  await chrome.storage.local.set({ instanceUrl: v.instanceUrl, apiToken: v.apiToken });
  setStatus('Saved.', 'ok');
}

async function test() {
  const v = await validateAndAuthorize();
  if (!v) return;
  setStatus('Testing...', null);
  // The worker runs the side-effect-free probe using the values we pass (what
  // the user just typed), so Test works before Save too.
  const result = await chrome.runtime.sendMessage({
    type: 'test',
    instanceUrl: v.instanceUrl,
    apiToken: v.apiToken,
  });
  setStatus((result && result.message) || 'Test failed.', result && result.ok ? 'ok' : 'error');
}

saveBtn.addEventListener('click', save);
testBtn.addEventListener('click', test);
load().catch((err) => setStatus(String(err && err.message ? err.message : err), 'error'));
