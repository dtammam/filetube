'use strict';

// [UNIT] v1.401.0 live dock picture, W1 (plan docs/exec-plans/completed/2026-11-01-live-dock-picture.md, the Contract): the
// `nativeVideoDock` half of the bridge contract AT THE ADAPTER. The conformance net (native-bridge-contract.test.js) proves the
// tables equal the schema; this file proves they BIND: `video.surface.layer` leaves the page only under `nativeVideoDock` (a host
// without the capability never receives the field - the whole message is refused, never trimmed to a 'below' it did not mean),
// `'above'` pairs only with `space: 'viewport'`, and a host without the capability still gets exactly the v1.399.0 message.

const { test } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const { installFakeHost, loadAdapter } = require('../helpers/fake-host');
const adapterModule = require('../../public/js/host-adapter.js');

function realm(caps) {
  const dom = new JSDOM('<!doctype html><html><head><meta name="ft-version" content="1.401.0"></head><body></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window;
  const fake = installFakeHost(win, { capabilities: caps });
  const host = loadAdapter(win);
  fake.clear();
  return { win, fake, host };
}
const VIDEO_CAPS = ['nativeAudio', 'nativeVideoAudio', 'nativeVideo'];
const DOCK_CAPS = VIDEO_CAPS.concat(['nativeVideoDock']);
const RECT = { x: 222, y: 640, w: 160, h: 90 };
const surface = (extra) => Object.assign({ rect: RECT, space: 'viewport', visible: true, fit: 'contain', radius: 12 }, extra || {});

test('nativeVideoDock is a known capability; layer is an optional enum on video.surface gated by it (the Contract)', () => {
  assert.ok(adapterModule.CAPABILITIES.includes('nativeVideoDock'));
  assert.deepStrictEqual(adapterModule.SURFACE_LAYERS, ['below', 'above']);
  const def = adapterModule.MESSAGES['video.surface'];
  assert.strictEqual(def.cap, 'nativeVideo', 'the message itself still needs nativeVideo');
  assert.deepStrictEqual(def.fieldCaps, { layer: 'nativeVideoDock' }, 'the FIELD is gated by nativeVideoDock');
  assert.deepStrictEqual(def.fields.layer, { enum: ['below', 'above'] }, 'optional: absent = below');
  assert.deepStrictEqual(Object.keys(adapterModule.MESSAGES).filter((t) => t.indexOf('video.') === 0), ['video.surface', 'video.pip'], 'nativeVideoDock added no message of its own (video.pip is v1.404.0, nativeVideoPip)');
});

test('a host WITHOUT nativeVideoDock never receives `layer`: a message carrying it is refused (below and above alike), one without it goes out exactly as in v1.399.0', () => {
  const { win, fake, host } = realm(VIDEO_CAPS);
  assert.strictEqual(host.has('nativeVideoDock'), false, 'a v0.16 build');
  assert.strictEqual(host.post('video.surface', surface({ layer: 'above' })), false, "'above' without the capability: refused");
  assert.strictEqual(host.post('video.surface', surface({ layer: 'below' })), false, "'below' without the capability: refused too (the web never sends the field without it)");
  assert.deepStrictEqual(fake.posts, [], 'nothing left the page');
  assert.strictEqual(host.post('video.surface', surface()), true);
  assert.deepStrictEqual(fake.posts, [{ v: 1, type: 'video.surface', rect: RECT, space: 'viewport', visible: true, fit: 'contain', radius: 12 }], 'the v1.399.0 shape, no layer key at all');
  win.close();
});

test("with nativeVideoDock: layer 'below' or 'above' goes out as sent; absent stays absent; 'above' only with space 'viewport'; a bad value is refused", () => {
  const { win, fake, host } = realm(DOCK_CAPS);
  assert.strictEqual(host.has('nativeVideoDock'), true);
  assert.strictEqual(host.post('video.surface', surface({ layer: 'above' })), true, 'the docked picture above the web view');
  assert.strictEqual(host.post('video.surface', surface({ layer: 'below', space: 'document', rect: { x: 0, y: 300, w: 393, h: 221 } })), true, 'the in-page picture, explicit below');
  assert.strictEqual(host.post('video.surface', surface({ layer: 'below' })), true, 'below + viewport (CSS fullscreen) is legal');
  assert.strictEqual(host.post('video.surface', surface({ layer: 'above', visible: false })), true, 'a hidden above layer (the dock covered by a sheet)');
  assert.strictEqual(host.post('video.surface', surface()), true, 'no layer: absent on the wire');
  assert.deepStrictEqual(fake.posts.map((m) => m.layer), ['above', 'below', 'below', 'above', undefined]);
  assert.ok(!('layer' in fake.posts[4]), 'absent means absent, not null');
  fake.clear();
  assert.strictEqual(host.post('video.surface', surface({ layer: 'above', space: 'document' })), false, "'above' with 'document': refused (native rejects it)");
  for (const bad of ['top', 'ABOVE', '', 1, null, true, {}]) assert.strictEqual(host.post('video.surface', surface({ layer: bad })), false, 'layer ' + JSON.stringify(bad));
  assert.deepStrictEqual(fake.posts, []);
  win.close();
});

test('the schema and the doc carry the capability (inert sibling list, LESSONS 12)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'references', 'native-bridge.v1.schema.json'), 'utf8'));
  assert.ok(schema.$defs.host.properties.capabilities.items.enum.includes('nativeVideoDock'));
  assert.deepStrictEqual(schema.$defs.surfaceLayer.enum, ['below', 'above']);
  const branch = schema.$defs.webToNative.oneOf.find((b) => b.properties.type.const === 'video.surface');
  assert.deepStrictEqual(branch.properties.layer, { $ref: '#/$defs/surfaceLayer' });
  assert.ok(!branch.required.includes('layer'), 'optional: add-only within v1');
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'references', 'native-bridge.md'), 'utf8');
  assert.ok(doc.includes("'nativeVideo', 'nativeVideoDock'"), 'section 1 announces it');
  assert.ok(/\| `video\.surface` \|[^\n]*`layer: 'below' \\\| 'above'`/.test(doc), 'the message table carries layer');
  assert.ok(doc.includes('**Live dock picture (v1.401.0'), 'the section 3 block');
  assert.ok(/^\| nativeVideoDock \|/m.test(doc), 'the owners table (section 5)');
});
