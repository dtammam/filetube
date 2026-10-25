'use strict';

// [UNIT] v1.387.0 offline playback, plan D1 - Settings > Account > Devices and the admin
// Users panel's Devices expando, through the REAL setup.js renderer with a stubbed fetch and
// a stubbed ui.confirm: rows carry the name, "added <date>" and "last used"; the empty state
// and the failed load each say so; Remove confirms, sends ONE DELETE to the right route and
// re-fetches; Cancel sends nothing; the admin panel adds Remove all; text only (a hostile
// device name never becomes markup); a browser without the section is untouched.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const common = require('../../public/js/common.js');
global.buildSortableTable = common.buildSortableTable;
global.formatRelativeTime = common.formatRelativeTime;
const setup = require('../../public/js/setup.js');

const DEVICES = [
  { id: 3, name: "Kid's iPhone", platform: 'ios', createdAt: '2026-10-01T10:00:00.000Z', lastUsedAt: null },
  { id: 9, name: '<img src=x onerror=alert(1)>', platform: 'ios', createdAt: '2026-09-01T10:00:00.000Z', lastUsedAt: new Date(Date.now() - 3 * 3600e3).toISOString() },
];

function mount(html) {
  const dom = new JSDOM('<!DOCTYPE html><body>' + (html || '<div id="devices-list">Loading devices...</div>') + '</body>', { url: 'http://localhost/setup.html' });
  global.window = dom.window; global.document = dom.window.document;
  return dom;
}
function teardown(dom) {
  delete global.window; delete global.document; delete global.fetch; dom.window.close();
}
// fetch stub: GETs answer from `routes`, every call is recorded.
function stubFetch(routes, calls, failGet) {
  global.fetch = (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    calls.push({ url, method });
    if (method === 'GET') {
      if (failGet) return Promise.reject(new Error('offline'));
      const body = routes[url];
      return Promise.resolve(body === undefined ? { ok: false, json: () => Promise.resolve({}) } : { ok: true, json: () => Promise.resolve(body) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) });
  };
}
function stubConfirm(answer, seen) {
  global.window.ui = {
    confirm: (o) => { seen.push(o); return Promise.resolve(answer); },
    toast: (msg, o) => { seen.push({ toast: msg, kind: o && o.kind }); },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => { for (let i = 0; i < 6; i++) await tick(); };

test('Account > Devices: rows carry the name, added date and last used (never for a phone that has not called); text only', async () => {
  const dom = mount();
  const calls = [];
  try {
    stubFetch({ '/api/devices': { devices: DEVICES } }, calls);
    await setup.wireDevicesSection(new dom.window.AbortController().signal, dom.window);
    await flush();
    const host = global.document.getElementById('devices-list');
    const rows = Array.from(host.querySelectorAll('.ui-row'));
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows.map((r) => r.getAttribute('data-device-id')), ['3', '9']);
    assert.strictEqual(rows[0].querySelector('.ui-row__title').textContent, "Kid's iPhone");
    assert.match(rows[0].querySelector('.ui-row__subtitle').textContent, /^added .+ · never used$/);
    assert.match(rows[1].querySelector('.ui-row__subtitle').textContent, /^added .+ · last used 3 hours ago$/);
    assert.strictEqual(host.querySelector('img'), null, 'a hostile name is text, never markup');
    assert.strictEqual(rows[1].querySelector('.ui-row__title').textContent, '<img src=x onerror=alert(1)>');
    assert.strictEqual(host.querySelectorAll('[data-device-remove]').length, 2, 'one Remove per row');
    assert.strictEqual(host.querySelector('[data-device-remove-all]'), null, 'no Remove all on the self surface');
    assert.ok(!host.innerHTML.includes('ftd_'));
    assert.deepStrictEqual(calls, [{ url: '/api/devices', method: 'GET' }]);
  } finally { teardown(dom); }
});

test('Account > Devices: the empty state and the failed load each say so; a page without the section is untouched', async () => {
  let dom = mount();
  try {
    stubFetch({ '/api/devices': { devices: [] } }, []);
    await setup.wireDevicesSection(new dom.window.AbortController().signal, dom.window);
    await flush();
    assert.strictEqual(global.document.querySelector('#devices-list .devices-empty').textContent, setup.DEVICES_EMPTY_TEXT);
    // v1.395.0 (gate r1 qa S1): the list also holds the Pages save tokens, so the empty text names them.
    assert.strictEqual(setup.DEVICES_EMPTY_TEXT, 'No devices. Devices appear here when the FileTube app is set up for offline playback, or a Pages token is made (Settings > Pages).');
  } finally { teardown(dom); }
  dom = mount();
  try {
    stubFetch({}, [], true);
    await setup.wireDevicesSection(new dom.window.AbortController().signal, dom.window);
    await flush();
    assert.strictEqual(global.document.querySelector('#devices-list .devices-error').textContent, 'Could not load the devices.');
  } finally { teardown(dom); }
  dom = mount('<div id="other"></div>');
  try {
    const calls = [];
    stubFetch({}, calls);
    await setup.wireDevicesSection(new dom.window.AbortController().signal, dom.window);
    assert.deepStrictEqual(calls, [], 'no section, no request');
    assert.strictEqual(global.document.body.innerHTML, '<div id="other"></div>');
  } finally { teardown(dom); }
});

test('Account > Devices: Remove confirms, sends ONE DELETE /api/devices/:id for THAT row and re-fetches; Cancel sends nothing', async () => {
  const dom = mount();
  const calls = [];
  const seen = [];
  try {
    stubFetch({ '/api/devices': { devices: DEVICES } }, calls);
    stubConfirm(false, seen);
    await setup.wireDevicesSection(new dom.window.AbortController().signal, dom.window);
    await flush();
    global.document.querySelector('[data-device-remove="9"]').click();
    await flush();
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].title, 'Remove <img src=x onerror=alert(1)>?');
    assert.strictEqual(seen[0].danger, true);
    assert.deepStrictEqual(calls.filter((c) => c.method === 'DELETE'), [], 'Cancel sends nothing');
    stubConfirm(true, seen);
    global.document.querySelector('[data-device-remove="9"]').click();
    await flush();
    assert.deepStrictEqual(calls.filter((c) => c.method === 'DELETE'), [{ url: '/api/devices/9', method: 'DELETE' }]);
    assert.strictEqual(calls.filter((c) => c.method === 'GET').length, 2, 're-fetched after the remove');
    assert.ok(seen.some((s) => s.toast === 'Device removed.' && s.kind === 'success'));
  } finally { teardown(dom); }
});

test('Users panel: every user row gets a Devices button; the expando lists that user\'s phones from the admin route, Remove and Remove all hit the admin routes', async () => {
  const dom = mount('<div id="users-list"></div>');
  const calls = [];
  const seen = [];
  const USERS = [
    { id: 'u-amy', username: 'amy', displayName: 'Amy', role: 'admin', canManageSubscriptions: false, canModifyLibrary: false, disabled: false },
    { id: 'u-kid', username: 'kid', displayName: 'Kid', role: 'member', canManageSubscriptions: false, canModifyLibrary: false, disabled: false },
  ];
  try {
    stubFetch({ '/api/users': { users: USERS }, '/api/users/u-kid/devices': { devices: [DEVICES[0]] } }, calls);
    stubConfirm(true, seen);
    await setup.loadUsersList(new dom.window.AbortController().signal, { id: 'u-amy' });
    await flush();
    const buttons = Array.from(global.document.querySelectorAll('[data-user-action="devices"]'));
    assert.strictEqual(buttons.length, 2, 'admins have phones too');
    const kidRow = Array.from(global.document.querySelectorAll('.stable-row')).find((r) => r.textContent.includes('Kid'));
    kidRow.querySelector('[data-user-action="devices"]').click();
    await flush();
    const panel = kidRow.querySelector('.devices-panel');
    assert.ok(panel, 'the expando opened under the kid\'s row');
    assert.ok(calls.some((c) => c.url === '/api/users/u-kid/devices' && c.method === 'GET'));
    assert.strictEqual(panel.querySelectorAll('.ui-row').length, 1);
    assert.strictEqual(panel.querySelector('.ui-row__title').textContent, "Kid's iPhone");
    panel.querySelector('[data-device-remove="3"]').click();
    await flush();
    assert.deepStrictEqual(calls.filter((c) => c.method === 'DELETE'), [{ url: '/api/users/u-kid/devices/3', method: 'DELETE' }]);
    panel.querySelector('[data-device-remove-all]').click();
    await flush();
    assert.deepStrictEqual(calls.filter((c) => c.method === 'DELETE').map((c) => c.url), ['/api/users/u-kid/devices/3', '/api/users/u-kid/devices']);
    assert.ok(seen.some((s) => s.title === 'Remove all devices?'));
    // Toggle: a second click closes it.
    kidRow.querySelector('[data-user-action="devices"]').click();
    await flush();
    assert.strictEqual(kidRow.querySelector('.devices-panel'), null);
  } finally { teardown(dom); }
});
