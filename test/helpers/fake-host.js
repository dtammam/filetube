'use strict';

// v1.384.0 (plan D3): a fake native host for the web half of the iOS bridge. installFakeHost(window, opts)
// defines window.FileTubeHost (what the app's document-start script injects) BEFORE the adapter loads;
// loadAdapter(window) then evaluates the REAL committed public/js/host-adapter.js in that window, exactly
// as a shell's <script> tag would. The host records every message the adapter lets through and can emit
// native-to-web events. With installFakeHost never called, loadAdapter yields the no-host (browser) path.

const fs = require('node:fs');
const path = require('node:path');

const ADAPTER_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'host-adapter.js'), 'utf8');

function installFakeHost(win, opts = {}) {
  const posts = [];
  const host = {
    bridge: opts.bridge === undefined ? 1 : opts.bridge,
    app: { name: 'filetube-ios', version: '0.1.0', build: '1' },
    platform: 'ios',
    capabilities: opts.capabilities || ['orientation', 'haptics', 'battery', 'serverSettings'],
    post(msg) { posts.push(JSON.parse(JSON.stringify(msg))); },
  };
  win.FileTubeHost = host;
  return {
    host,
    posts,
    // Every recorded message of one type (host.hello excluded unless asked for).
    of(type) { return posts.filter((m) => m.type === type); },
    types() { return posts.map((m) => m.type); },
    clear() { posts.length = 0; },
    // Native dispatches a 'filetube-host' CustomEvent on window with detail = { v: 1, type, ... }.
    emit(detail) {
      win.dispatchEvent(new win.CustomEvent('filetube-host', { detail }));
    },
  };
}

function loadAdapter(win) {
  win.eval(ADAPTER_SRC); // the window must be a jsdom window built with runScripts: 'outside-only' or 'dangerously'
  return win.FileTube && win.FileTube.host;
}

module.exports = { installFakeHost, loadAdapter, ADAPTER_SRC };
