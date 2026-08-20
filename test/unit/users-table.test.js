'use strict';

// [UNIT] v1.159 (Dean): the admin Users list as a sortable table (Name | Role |
// Status + an actions cell). The RBAC-sensitive property the gate flagged: an
// action button must hit the CORRECT user even AFTER a sort reorders the rows -
// never a stale index. Also: the role cell's capability badges, and that the
// data columns don't disturb the existing action calls.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const common = require('../../public/js/common.js');
global.buildSortableTable = common.buildSortableTable;
const setup = require('../../public/js/setup.js');

const USERS = [
  { id: 'u-zoe', username: 'zoe', displayName: 'Zoe', role: 'member', canManageSubscriptions: true, canModifyLibrary: false, disabled: false },
  { id: 'u-amy', username: 'amy', displayName: 'Amy', role: 'admin', canManageSubscriptions: false, canModifyLibrary: false, disabled: false },
  { id: 'u-bob', username: 'bob', displayName: 'Bob', role: 'member', canManageSubscriptions: false, canModifyLibrary: true, disabled: true },
];
const ME = { id: 'u-amy' };

function mount() {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="users-list"></div></body>', { url: 'http://localhost/setup.html' });
  global.window = dom.window; global.document = dom.window.document;
  return dom;
}
function teardown(dom) {
  try { global.window.localStorage.clear(); } catch (_) { /* ignore */ }
  delete global.window; delete global.document; delete global.fetch; dom.window.close();
}
// A fetch stub: GET /api/users returns the fixture; other calls are recorded.
function stubFetch(calls) {
  global.fetch = (url, opts) => {
    if (url === '/api/users') return Promise.resolve({ ok: true, json: () => Promise.resolve({ users: USERS }) });
    calls.push({ url, method: (opts && opts.method) || 'GET', body: opts && opts.body ? JSON.parse(opts.body) : undefined });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const names = (host) => Array.from(host.querySelectorAll('.stable-row .stable-cell--name')).map((c) => c.textContent);

test('renders Name/Role/Status columns, default Name-asc, with capability badges in the role cell', async () => {
  const dom = mount();
  try {
    stubFetch([]);
    await setup.loadUsersList(new dom.window.AbortController().signal, ME);
    await tick();
    const listEl = global.document.getElementById('users-list');
    const headers = Array.from(listEl.querySelectorAll('.stable-th')).map((t) => t.textContent).filter(Boolean);
    assert.deepEqual(headers, ['Name', 'Role', 'Status']);
    assert.deepEqual(names(listEl), ['Amy', 'Bob', 'Zoe'], 'default Name asc');
    // Zoe (subscriptions) + Bob (can edit) show cap badges
    assert.ok(listEl.textContent.includes('subscriptions'), 'subscriptions cap badge');
    assert.ok(listEl.textContent.includes('can edit'), 'edit cap badge');
    // self (Amy) shows "You"; the disabled member shows "Disabled"
    assert.ok(listEl.textContent.includes('You') && listEl.textContent.includes('Disabled'));
  } finally { teardown(dom); }
});

test('GATE: an action button hits the CORRECT user after a sort reorders the rows', async () => {
  const dom = mount();
  const calls = [];
  try {
    stubFetch(calls);
    await setup.loadUsersList(new dom.window.AbortController().signal, ME);
    await tick();
    const listEl = global.document.getElementById('users-list');

    // Sort by Name DESC so Zoe becomes row 0 (was row 2 at default asc).
    const nameTh = listEl.querySelector('.stable-th[data-col="name"]');
    nameTh.dispatchEvent(new dom.window.Event('click')); // asc (already) -> flip? default name asc, click -> desc
    assert.deepEqual(names(listEl), ['Zoe', 'Bob', 'Amy'], 'now Name desc');

    // Click "Make admin" in row 0 - it MUST target Zoe (u-zoe), not the pre-sort row-0 user.
    const row0 = listEl.querySelectorAll('.stable-row')[0];
    const makeAdmin = Array.from(row0.querySelectorAll('button')).find((b) => b.textContent === 'Make admin');
    assert.ok(makeAdmin, 'row 0 has a Make admin button');
    makeAdmin.dispatchEvent(new dom.window.Event('click'));
    await tick();
    const roleCall = calls.find((c) => c.url && c.url.includes('/role'));
    assert.ok(roleCall, 'a role change fired');
    assert.strictEqual(roleCall.url, '/api/users/u-zoe/role', 'targeted Zoe, the actual row-0 user');
    assert.deepEqual(roleCall.body, { role: 'admin' });
  } finally { teardown(dom); }
});
