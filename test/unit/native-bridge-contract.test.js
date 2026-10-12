'use strict';

// [UNIT] v1.384.0 (plan D2): the conformance net between docs/references/native-bridge.v1.schema.json
// (the authority) and public/js/host-adapter.js (its mirror). No JSON-schema dependency: the schema is read
// as JSON and compared with the adapter's message and event tables, so a schema edit without an adapter
// edit fails here, and the other way round. Then the adapter itself: a message the schema does not allow
// is never posted, an unannounced capability is never used, and events are validated as data.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const adapterModule = require('../../public/js/host-adapter.js');
const { installFakeHost, loadAdapter } = require('../helpers/fake-host');

const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'references', 'native-bridge.v1.schema.json'), 'utf8'));
const { MESSAGES, EVENTS, CAPABILITIES } = adapterModule;

// One schema branch -> { type, fields: { name: spec } } in the adapter's vocabulary.
// A `$ref` inside this document resolves to its $defs entry (v1.387.0: downloadsSnapshot.items -> downloadItem).
function deref(s) {
  if (s && typeof s.$ref === 'string' && s.$ref.startsWith('#/$defs/')) return SCHEMA.$defs[s.$ref.slice('#/$defs/'.length)];
  return s;
}
function specOf(s) {
  s = deref(s);
  if (s.const !== undefined) return { eq: s.const };
  if (s.enum) return { enum: s.enum.slice() };
  const types = Array.isArray(s.type) ? s.type : [s.type];
  const out = { is: types.find((t) => t !== 'null') };
  if (types.includes('null')) out.nullable = true;
  if (s.minimum !== undefined) out.min = s.minimum;
  if (s.maximum !== undefined) out.max = s.maximum;
  if (s.minLength !== undefined) out.min = s.minLength; // v1.387.0: a string's length bounds (an id is 1..512)
  if (s.maxLength !== undefined) out.max = s.maxLength;
  if (s.maxItems !== undefined) out.max = s.maxItems; // v1.387.0: an array's length cap
  if (s.properties) out.props = fieldsOf(s.properties, s.required || []);
  if (s.type === 'array' && s.items) {
    out.items = specOf(s.items);
    // The adapter's per-element lenient mapping is not a schema concept: strip it before comparing.
  }
  return out;
}
// The adapter's spec with the per-element `lenient` map removed (a web-side reading rule, not a schema field).
function withoutLenient(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = { ...v };
    if (out[k].items) { out[k].items = { ...out[k].items }; delete out[k].items.lenient; }
  }
  return out;
}
function fieldsOf(props, required) {
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (k === 'type' || k === 'v') continue;
    const spec = specOf(v);
    if (required.includes(k)) spec.req = true;
    out[k] = spec;
  }
  return out;
}
function branches(def) {
  return def.oneOf.map((b) => ({ type: b.properties.type.const, fields: fieldsOf(b.properties, b.required || []) }));
}
// An object spec's `props` carry their own req flags; strip `cap` before comparing (not a schema field).
test('conformance: the adapter sends exactly the schema\'s web-to-native types, with the schema\'s fields', () => {
  const want = branches(SCHEMA.$defs.webToNative);
  assert.deepEqual(Object.keys(MESSAGES).sort(), want.map((b) => b.type).sort(), 'message types drifted from the schema');
  for (const b of want) assert.deepEqual(MESSAGES[b.type].fields, b.fields, `fields of ${b.type} drifted from the schema`);
});

test('conformance: the adapter accepts exactly the schema\'s native-to-web events, with the schema\'s fields', () => {
  const want = branches(SCHEMA.$defs.nativeToWeb);
  assert.deepEqual(Object.keys(EVENTS).sort(), want.map((b) => b.type).sort(), 'event types drifted from the schema');
  for (const b of want) assert.deepEqual(withoutLenient(EVENTS[b.type].fields), b.fields, `fields of ${b.type} drifted from the schema`);
  // The shared item definition is the same table twice (an event, a snapshot element).
  assert.deepEqual(withoutLenient(EVENTS.downloadsSnapshot.fields).items.items.props, EVENTS.download.fields, 'a snapshot element has exactly the download event\'s fields');
});

test('conformance: the capability list equals the schema\'s and every message names a known capability', () => {
  assert.deepEqual(CAPABILITIES.slice().sort(), SCHEMA.$defs.host.properties.capabilities.items.enum.slice().sort());
  for (const [type, def] of Object.entries(MESSAGES)) {
    assert.ok(def.cap === null || CAPABILITIES.includes(def.cap), `${type} names an unknown capability`);
  }
  assert.equal(MESSAGES['host.hello'].cap, null, 'host.hello needs no capability');
});

function windowWith(opts) {
  const dom = new JSDOM('<!doctype html><html><head><meta name="ft-version" content="1.384.0"></head><body></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window;
  const fake = opts ? installFakeHost(win, opts) : null;
  const host = loadAdapter(win);
  return { win, fake, host };
}

test('no host: present false, every call a silent no-op', () => {
  const { win, host } = windowWith(null);
  assert.equal(host.present, false);
  assert.equal(host.bridge, 0);
  assert.equal(host.has('haptics'), false);
  assert.equal(host.post('haptics.tick', { style: 'detent' }), false);
  const un = host.on('battery', () => assert.fail('no host, no events'));
  win.dispatchEvent(new win.CustomEvent('filetube-host', { detail: { v: 1, type: 'battery', level: 0.5, state: 'full' } }));
  assert.equal(typeof un, 'function');
  un();
  win.close();
});

test('host present: host.hello goes out once on load with the server version', () => {
  const { win, fake, host } = windowWith({});
  assert.equal(host.present, true);
  assert.equal(host.bridge, 1);
  assert.deepEqual(fake.posts, [{ v: 1, type: 'host.hello', web: { version: '1.384.0' } }]);
  win.close();
});

test('post: valid messages are sent in the contract shape; invalid ones are dropped, never thrown', () => {
  const { win, fake, host } = windowWith({});
  fake.clear();
  assert.equal(host.post('orientation.lock', { orientation: 'portrait' }), true);
  assert.equal(host.post('orientation.lock', { orientation: 'landscape' }), false, 'only portrait is in the contract');
  assert.equal(host.post('orientation.lock'), false, 'orientation is required');
  assert.equal(host.post('orientation.unlock'), true);
  assert.equal(host.post('haptics.tick', { style: 'detent', intensity: 0.5 }), true);
  assert.equal(host.post('haptics.tick', { style: 'thud' }), false, 'style is an enum');
  assert.equal(host.post('haptics.tick', { style: 'letter', intensity: 2 }), false, 'intensity is 0..1');
  assert.equal(host.post('haptics.tick'), false, 'style is required');
  assert.equal(host.post('haptics.tick', { style: 'snap', sneaky: 'x' }), true);
  assert.equal(host.post('made.up'), false);
  assert.equal(host.post('__proto__'), false);
  assert.equal(host.post('constructor'), false);
  assert.equal(host.post('host.hello', { web: {} }), false, 'web.version is required');
  assert.deepEqual(fake.posts, [
    { v: 1, type: 'orientation.lock', orientation: 'portrait' },
    { v: 1, type: 'orientation.unlock' },
    { v: 1, type: 'haptics.tick', style: 'detent', intensity: 0.5 },
    { v: 1, type: 'haptics.tick', style: 'snap' },
  ], 'unknown fields never leave the page; v and type cannot be overridden');
  assert.equal(host.post('orientation.unlock', { v: 9, type: 'x' }), true);
  assert.deepEqual(fake.posts[fake.posts.length - 1], { v: 1, type: 'orientation.unlock' });
  win.close();
});

test('post: a capability the host did not announce is never used', () => {
  const { win, fake, host } = windowWith({ capabilities: ['haptics'] });
  fake.clear();
  assert.equal(host.has('haptics'), true);
  assert.equal(host.has('battery'), false);
  assert.equal(host.post('battery.subscribe'), false);
  assert.equal(host.post('orientation.unlock'), false);
  assert.equal(host.post('host.openServerSettings'), false);
  assert.equal(host.post('haptics.prepare'), true);
  assert.deepEqual(fake.types(), ['haptics.prepare']);
  win.close();
});

test('post: a native call that throws never reaches the page', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  dom.window.FileTubeHost = { bridge: 1, capabilities: ['haptics'], post() { throw new Error('native gone'); } };
  const host = loadAdapter(dom.window);
  assert.equal(host.post('haptics.prepare'), false);
  dom.window.close();
});

test('discovery: a host that does not match the contract is no host', () => {
  for (const bad of [{ bridge: 2, capabilities: ['haptics'], post() {} }, { bridge: 1, capabilities: 'haptics', post() {} }, { bridge: 1, capabilities: [] }, 'yes', 7]) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
    dom.window.FileTubeHost = bad;
    assert.equal(loadAdapter(dom.window).present, false, JSON.stringify(bad));
    dom.window.close();
  }
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  dom.window.FileTubeHost = { bridge: 1, capabilities: ['haptics', 'teleport', 'haptics'], post() {} };
  const host = loadAdapter(dom.window);
  assert.equal(host.has('haptics'), true);
  assert.equal(host.has('teleport'), false, 'an unknown capability is ignored');
  dom.window.close();
});

test('on: valid events arrive; malformed, unknown and wrong-version ones are ignored; unsubscribe works', () => {
  const { win, fake, host } = windowWith({});
  const got = [];
  const un = host.on('battery', (d) => got.push(d));
  fake.emit({ v: 1, type: 'battery', level: 0.42, state: 'charging', extra: 'x' });
  fake.emit({ v: 1, type: 'battery', level: null, state: 'unknown' });
  fake.emit({ v: 2, type: 'battery', level: 0.5, state: 'full' });
  fake.emit({ v: 1, type: 'battery', level: 7, state: 'full' });
  fake.emit({ v: 1, type: 'battery', level: '0.5', state: 'full' });
  fake.emit({ v: 1, type: 'battery', level: 0.5, state: 'sparkling' });
  fake.emit({ v: 1, type: 'battery', level: 0.5 });
  fake.emit({ v: 1, type: 'telepathy', level: 0.5, state: 'full' });
  fake.emit(null);
  assert.deepEqual(got, [{ level: 0.42, state: 'charging' }, { level: null, state: 'unknown' }]);
  un();
  fake.emit({ v: 1, type: 'battery', level: 0.1, state: 'full' });
  assert.equal(got.length, 2, 'unsubscribed');
  assert.equal(typeof host.on('telepathy', () => {}), 'function', 'an unknown type gives a no-op unsubscribe');
  assert.equal(typeof host.on('battery', null), 'function');
  win.close();
});

test('on: a throwing listener never breaks the page or the next listener', () => {
  const { win, fake, host } = windowWith({});
  let second = 0;
  host.on('battery', () => { throw new Error('listener bug'); });
  host.on('battery', () => { second++; });
  fake.emit({ v: 1, type: 'battery', level: 0.5, state: 'full' });
  assert.equal(second, 1);
  win.close();
});

test('appLike: standalone OR host present', () => {
  const a = windowWith(null);
  assert.equal(a.host.appLike(), false);
  a.win.navigator.standalone; // jsdom: undefined
  Object.defineProperty(a.win.navigator, 'standalone', { value: true, configurable: true });
  assert.equal(a.host.appLike(), true, 'the home-screen PWA');
  a.win.close();
  const b = windowWith({});
  assert.equal(b.host.appLike(), true, 'the native host');
  b.win.close();
});

test('the adapter loads twice without replacing the first host object', () => {
  const { win, host } = windowWith({});
  loadAdapter(win);
  assert.equal(win.FileTube.host, host);
  win.close();
});

test('post: a null where the schema wants a number is dropped; prototype keys are no event type', () => {
  const { win, fake, host } = windowWith({});
  fake.clear();
  assert.equal(host.post('haptics.tick', { style: 'detent', intensity: null }), false, 'intensity is a number, not nullable');
  assert.deepEqual(fake.posts, []);
  for (const k of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    let called = 0;
    host.on(k, () => { called++; });
    fake.emit({ v: 1, type: k, level: 0.5, state: 'full' });
    assert.equal(called, 0, k);
  }
  win.close();
});

test('v1.385.0: statusBar and network messages, gated by their own capability, no fields', () => {
  const { win, fake, host } = windowWith({ capabilities: ['statusBar', 'network'] });
  fake.clear();
  for (const t of ['statusBar.hide', 'statusBar.show', 'network.subscribe', 'network.unsubscribe']) assert.equal(host.post(t, { junk: 1 }), true, t);
  assert.deepEqual(fake.types(), ['statusBar.hide', 'statusBar.show', 'network.subscribe', 'network.unsubscribe']);
  assert.deepEqual(fake.posts[0], { v: 1, type: 'statusBar.hide' }, 'no fields leave the page');
  win.close();
  const other = windowWith({ capabilities: ['battery'] });
  other.fake.clear();
  for (const t of ['statusBar.hide', 'statusBar.show', 'network.subscribe', 'network.unsubscribe']) assert.equal(other.host.post(t), false, t + ' needs its capability');
  assert.equal(other.host.has('statusBar'), false);
  other.win.close();
});

test('v1.385.0: the network event is validated as data; an unknown connection kind reads as other', () => {
  const { win, fake, host } = windowWith({ capabilities: ['network'] });
  const got = [];
  host.on('network', (d) => got.push(d));
  fake.emit({ v: 1, type: 'network', connection: 'wifi', constrained: true, expensive: false, sneaky: 1 });
  fake.emit({ v: 1, type: 'network', connection: 'satellite' });
  fake.emit({ v: 1, type: 'network' });
  fake.emit({ v: 1, type: 'network', connection: 3 });
  fake.emit({ v: 1, type: 'network', connection: 'cellular', constrained: 'yes' });
  fake.emit({ v: 2, type: 'network', connection: 'wifi' });
  assert.deepEqual(got, [
    { connection: 'wifi', constrained: true, expensive: false },
    { connection: 'other' },
    { connection: 'cellular' },
  ], 'a bad optional field is dropped, never the connection change with it');
  win.close();
});

// ---- v1.387.0 offline playback (plan D5): the downloads capability -------------------------------------------
test('v1.387.0: downloads messages are gated by their capability; add / remove carry exactly kind + id (the manifest enum, an id of 1..512); subscribe / unsubscribe / show carry nothing', () => {
  const { win, fake, host } = windowWith({ capabilities: ['downloads'] });
  fake.clear();
  assert.equal(host.post('downloads.add', { kind: 'album', id: 'Pink Floyd\u001fThe Wall', junk: 1 }), true);
  assert.equal(host.post('downloads.remove', { kind: 'tvSeason', id: 'show:1' }), true);
  for (const t of ['downloads.subscribe', 'downloads.unsubscribe', 'downloads.show']) assert.equal(host.post(t, { junk: 1 }), true, t);
  assert.deepEqual(fake.posts, [
    { v: 1, type: 'downloads.add', kind: 'album', id: 'Pink Floyd\u001fThe Wall' },
    { v: 1, type: 'downloads.remove', kind: 'tvSeason', id: 'show:1' },
    { v: 1, type: 'downloads.subscribe' }, { v: 1, type: 'downloads.unsubscribe' }, { v: 1, type: 'downloads.show' },
  ], 'exactly the contract fields leave the page');
  fake.clear();
  assert.equal(host.post('downloads.add', { kind: 'book', id: 'x' }), false, 'kind is the manifest enum');
  assert.equal(host.post('downloads.add', { kind: 'video' }), false, 'id is required');
  assert.equal(host.post('downloads.add', { kind: 'video', id: '' }), false, 'an empty id');
  assert.equal(host.post('downloads.add', { kind: 'video', id: 'x'.repeat(513) }), false, 'an id over 512');
  assert.equal(host.post('downloads.add', { kind: 'video', id: 'x'.repeat(512) }), true, 'an id of exactly 512');
  assert.equal(host.post('downloads.add', { kind: 'video', id: 7 }), false, 'id is a string');
  assert.equal(host.post('downloads.remove', { id: 'x' }), false, 'kind is required');
  assert.deepEqual(fake.types(), ['downloads.add']);
  win.close();
  const other = windowWith({ capabilities: ['network', 'battery'] });
  other.fake.clear();
  for (const t of ['downloads.add', 'downloads.remove', 'downloads.subscribe', 'downloads.unsubscribe', 'downloads.show']) {
    assert.equal(other.host.post(t, { kind: 'video', id: 'x' }), false, t + ' needs its capability');
  }
  assert.equal(other.host.has('downloads'), false);
  assert.deepEqual(other.fake.posts, []);
  other.win.close();
});

test('v1.387.0: the download event is validated as data - unknown state reads as none, unknown error as other, a bad optional field is dropped (never the event), a bad required field drops the event, parentKind / parentId and localSrc pass', () => {
  const { win, fake, host } = windowWith({ capabilities: ['downloads'] });
  const got = [];
  host.on('download', (d) => got.push(d));
  fake.emit({ v: 1, type: 'download', kind: 'video', id: 'v1', state: 'downloading', progress: 0.4, bytes: 400, totalBytes: 1000, sneaky: 'x' });
  fake.emit({ v: 1, type: 'download', kind: 'track', id: 't1', state: 'done', localSrc: 'filetube-local://t1.flac', parentKind: 'album', parentId: 'Floyd\u001fWall' });
  fake.emit({ v: 1, type: 'download', kind: 'tvEpisode', id: 'e1', state: 'teleporting' }); // unknown state -> none
  fake.emit({ v: 1, type: 'download', kind: 'podcastEpisode', id: 'p1', state: 'failed', error: 'cosmic' }); // unknown error -> other
  fake.emit({ v: 1, type: 'download', kind: 'video', id: 'v2', state: 'downloading', progress: 7 }); // bad optional dropped
  fake.emit({ v: 1, type: 'download', kind: 'video', id: 'v3', state: 'done', localSrc: '' }); // empty localSrc dropped
  fake.emit({ v: 1, type: 'download', kind: 'video', id: 'v4', state: 'done', parentKind: 'playlist', parentId: 'x' }); // bad parentKind dropped, parentId kept
  fake.emit({ v: 1, type: 'download', kind: 'album', id: 'a1', state: 'done' }); // a collection kind is never an item
  fake.emit({ v: 1, type: 'download', kind: 'video', state: 'done' }); // id required
  fake.emit({ v: 1, type: 'download', kind: 'video', id: 'v5' }); // state required
  fake.emit({ v: 1, type: 'download', kind: 'video', id: 'x'.repeat(513), state: 'done' }); // id over 512
  fake.emit({ v: 2, type: 'download', kind: 'video', id: 'v6', state: 'done' });
  assert.deepEqual(got, [
    { kind: 'video', id: 'v1', state: 'downloading', progress: 0.4, bytes: 400, totalBytes: 1000 },
    { kind: 'track', id: 't1', state: 'done', localSrc: 'filetube-local://t1.flac', parentKind: 'album', parentId: 'Floyd\u001fWall' },
    { kind: 'tvEpisode', id: 'e1', state: 'none' },
    { kind: 'podcastEpisode', id: 'p1', state: 'failed', error: 'other' },
    { kind: 'video', id: 'v2', state: 'downloading' },
    { kind: 'video', id: 'v3', state: 'done' },
    { kind: 'video', id: 'v4', state: 'done', parentId: 'x' },
  ]);
  win.close();
});

test('v1.387.0: a downloadsSnapshot carries an ARRAY of items - a bad element drops that element (never the snapshot), each element gets the lenient mapping, over 10000 elements drops the whole event, items is required', () => {
  const { win, fake, host } = windowWith({ capabilities: ['downloads'] });
  const got = [];
  host.on('downloadsSnapshot', (d) => got.push(d));
  fake.emit({ v: 1, type: 'downloadsSnapshot', items: [
    { kind: 'video', id: 'v1', state: 'done', localSrc: 'filetube-local://v1.mp4', extra: 1 },
    { kind: 'album', id: 'a', state: 'done' }, // a bad element
    'junk', null,
    { kind: 'track', id: 't1', state: 'frozen', progress: 'half' }, // lenient state, bad optional dropped
    { kind: 'tvEpisode', id: 'e1' }, // state required: dropped
  ], sneaky: true });
  fake.emit({ v: 1, type: 'downloadsSnapshot', items: [] });
  fake.emit({ v: 1, type: 'downloadsSnapshot' });
  fake.emit({ v: 1, type: 'downloadsSnapshot', items: 'none' });
  fake.emit({ v: 1, type: 'downloadsSnapshot', items: Array.from({ length: 10001 }, (_, i) => ({ kind: 'video', id: 'v' + i, state: 'done' })) });
  const big = Array.from({ length: 10000 }, (_, i) => ({ kind: 'video', id: 'v' + i, state: 'done' }));
  fake.emit({ v: 1, type: 'downloadsSnapshot', items: big });
  assert.equal(got.length, 3);
  assert.deepEqual(got[0], { items: [
    { kind: 'video', id: 'v1', state: 'done', localSrc: 'filetube-local://v1.mp4' },
    { kind: 'track', id: 't1', state: 'none' },
  ] });
  assert.deepEqual(got[1], { items: [] });
  assert.equal(got[2].items.length, 10000, 'exactly the cap passes');
  assert.ok(!('sneaky' in got[0]) && !('extra' in got[0].items[0]), 'unknown fields never reach the listener');
  win.close();
});
