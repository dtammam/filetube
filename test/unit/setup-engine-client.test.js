'use strict';

// [UNIT] v1.146 T7 - the Downloads box's client half: the pure
// status -> view-model mapper (the DOM writer/wiring is the usual
// on-device-validated thin shell) plus source locks on setup.html: the box
// ships HIDDEN (the admin+module probe reveals it), carries a collapse key,
// and its checkbox is NOT part of the /api/settings reveal set (that
// binding lives in setup-automation-reveal.test.js's FOREIGN list).

const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const { buildEngineViewModel } = require('../../public/js/setup.js');

const SETUP_HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');

// ---- source locks ----------------------------------------------------------

test('setup.html: the Downloads box ships hidden with a collapse key and all three channel radios', () => {
  // v1.152: the opening tag gained data-md-* attrs for the master-detail menu;
  // match the load-bearing bits (hidden + collapse key) without pinning attr order.
  assert.match(SETUP_HTML, /<details class="setup-box sub-collapsible"[^>]*id="downloads-box"[^>]*hidden[^>]*data-collapse-key="downloads"[^>]*open>/);
  for (const value of ['bundled', 'stable', 'nightly']) {
    assert.match(SETUP_HTML, new RegExp(`<input type="radio" name="engine-channel" value="${value}"`), `radio ${value}`);
  }
  assert.match(SETUP_HTML, /id="engine-autoupdate-check"/);
  assert.match(SETUP_HTML, /id="engine-update-btn"/);
});

test('style.css: the engine channel cards have a real styling source (no orphan classes)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');
  for (const cls of ['.engine-channels', '.engine-channel', '.engine-channel-name', '.engine-channel-version']) {
    assert.match(css, new RegExp(cls.replace(/\./g, '\\.') + '\\s*\\{'), `${cls} has a rule`);
  }
});

// ---- buildEngineViewModel ---------------------------------------------------

const BASE = {
  supported: true,
  reason: null,
  channel: 'bundled',
  active: 'bundled',
  autoUpdate: false,
  bundledVersion: '2026.8.10.11111.dev0',
  installed: null,
  latest: { stable: '2026.7.4', nightly: '2026.8.17.73947.dev0', checkedAt: 1, error: null },
  busy: null,
  lastCheckAt: null,
  lastResult: null,
  revert: null,
};

test('view model: the default bundled state - versions side by side, update disabled', () => {
  const vm = buildEngineViewModel(BASE);
  assert.equal(vm.bundledText, '2026.8.10.11111.dev0');
  assert.equal(vm.stableText, '2026.7.4');
  assert.equal(vm.nightlyText, '2026.8.17.73947.dev0');
  assert.equal(vm.channel, 'bundled');
  assert.equal(vm.controlsDisabled, false);
  assert.equal(vm.updateDisabled, true, 'Update now is meaningless on bundled');
  assert.match(vm.statusText, /Active engine: bundled\./);
});

test('view model: an active venv engine names itself and enables Update now', () => {
  const vm = buildEngineViewModel({
    ...BASE,
    channel: 'nightly',
    active: 'venv',
    installed: { version: '2026.8.17.73947.dev0', reported: '2026.08.17.073947', channel: 'nightly', installedAt: 1 },
    lastResult: { at: 1, ok: true, action: 'install', version: '2026.8.17.73947.dev0', message: 'installed 2026.08.17.073947 (nightly) and passed the health check' },
  });
  assert.match(vm.statusText, /Active engine: 2026\.08\.17\.073947 \(nightly\)\./);
  assert.match(vm.statusText, /passed the health check/);
  assert.equal(vm.updateDisabled, false);
});

test('view model: offline PyPI reads "unavailable (offline?)" and never blocks the bundled row (term 5)', () => {
  const vm = buildEngineViewModel({
    ...BASE,
    latest: { stable: null, nightly: null, checkedAt: 1, error: 'PyPI check failed: ENOTFOUND' },
  });
  assert.equal(vm.bundledText, '2026.8.10.11111.dev0');
  assert.equal(vm.stableText, 'unavailable (offline?)');
  assert.equal(vm.nightlyText, 'unavailable (offline?)');
});

test('view model: busy disables everything and says which phase; a revert reads out honestly', () => {
  const busyVm = buildEngineViewModel({ ...BASE, channel: 'nightly', busy: { status: 'queued', channel: 'nightly', trigger: 'channel-switch' } });
  assert.equal(busyVm.controlsDisabled, true);
  assert.equal(busyVm.updateDisabled, true);
  assert.match(busyVm.statusText, /Queued behind the current download/);
  const installingVm = buildEngineViewModel({ ...BASE, busy: { status: 'installing', channel: 'nightly', trigger: 'manual-update' } });
  assert.match(installingVm.statusText, /Installing/);
  const revertVm = buildEngineViewModel({
    ...BASE,
    channel: 'nightly',
    revert: { fromVersion: '2026.8.17.73947.dev0', reason: 'engine failed to start: spawn ENOENT', at: 5 },
  });
  assert.match(revertVm.statusText, /Reverted from 2026\.8\.17\.73947\.dev0: engine failed to start/);
});

test('view model: an unsupported host disables the controls and leads with the honest reason', () => {
  const vm = buildEngineViewModel({
    ...BASE,
    supported: false,
    reason: 'python3 is not available on this system, so alternate downloader engines cannot be installed. The bundled engine stays in use.',
    latest: null,
  });
  assert.equal(vm.controlsDisabled, true);
  assert.equal(vm.updateDisabled, true);
  assert.match(vm.statusText, /python3 is not available/);
});

test('view model: garbage in -> null out (the DOM writer no-ops)', () => {
  assert.equal(buildEngineViewModel(null), null);
  assert.equal(buildEngineViewModel('nope'), null);
});
