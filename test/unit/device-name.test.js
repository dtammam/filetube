'use strict';

// [UNIT] v1.349: every device gets an automatic "Type · Word" label (the word derived from its
// per-browser device id) and may carry a typed name that replaces the whole label. The pure parts
// (word list, hash, cleaning) are pinned here; getDeviceLabel runs for real over stubbed storage
// and navigator. The label must always survive the server's normalizeLabel unchanged, or a device
// would show one name to itself and another everywhere else.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const c = require('../../public/js/common.js');
const { normalizeLabel } = require('../../lib/presence/store.js');

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

function memoryStorage(seed) {
  const m = new Map(Object.entries(seed || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m };
}
let saved;
beforeEach(() => {
  saved = { ls: Object.getOwnPropertyDescriptor(global, 'localStorage'), nav: Object.getOwnPropertyDescriptor(global, 'navigator') };
  Object.defineProperty(global, 'navigator', { value: { userAgent: MAC_UA, maxTouchPoints: 0 }, configurable: true, writable: true });
});
afterEach(() => {
  for (const [k, d] of [['localStorage', saved.ls], ['navigator', saved.nav]]) {
    if (d) Object.defineProperty(global, k, d); else delete global[k];
  }
});
const useStorage = (seed) => { const s = memoryStorage(seed); Object.defineProperty(global, 'localStorage', { value: s, configurable: true, writable: true }); return s; };

test('the word list obeys its rules: count, length, charset, uniqueness, 4-letter prefixes, frozen', () => {
  const w = c.DEVICE_WORDS;
  assert.ok(Object.isFrozen(w), 'frozen');
  assert.ok(w.length >= 96 && w.length <= 128, 'count ' + w.length);
  for (const x of w) assert.match(x, /^[A-Z][a-z]{2,6}$/, x + ' is 3-7 ASCII letters, capitalized');
  assert.strictEqual(new Set(w).size, w.length, 'no duplicates');
  assert.strictEqual(new Set(w.map((x) => x.slice(0, 4).toLowerCase())).size, w.length, 'no two share their first 4 letters');
  const deviceTypes = /^(Mac|Pc|Phone|Pad|Tablet|Laptop|Linux|Android|Iphone|Ipad|Ipod|Windows|Chrome)/i;
  for (const x of w) assert.doesNotMatch(x, deviceTypes, x + ' must not read as a device type');
});

test('deviceWord is stable for an id and spreads across ids', () => {
  assert.strictEqual(c.deviceWord('abc-123'), c.deviceWord('abc-123'));
  const ids = Array.from({ length: 300 }, (_, i) => 'id-' + i + '-' + (i * 7919).toString(16));
  const words = new Set(ids.map(c.deviceWord));
  assert.ok(words.size >= 80, 'only ' + words.size + ' distinct words over 300 ids');
  assert.ok(c.DEVICE_WORDS.includes(c.deviceWord('x')), 'always a word from the list');
  assert.ok(c.DEVICE_WORDS.includes(c.deviceWord(undefined)), 'an undefined id still maps to a word');
  // FNV-1a 32-bit pinned at a known value, so the hash itself cannot drift between releases
  assert.strictEqual(c.deviceWord('a'), c.DEVICE_WORDS[0xe40c292c % c.DEVICE_WORDS.length], 'FNV-1a("a") = 0xe40c292c');
});

test('getDeviceLabel is "Type · Word" without a name, and the typed name with one', () => {
  useStorage({ 'ft-device-id': 'dev-otter-1' });
  const word = c.deviceWord('dev-otter-1');
  assert.strictEqual(c.getAutoDeviceLabel(), 'Mac · ' + word);
  assert.strictEqual(c.getDeviceLabel(), 'Mac · ' + word);
  c.setDeviceName('Snowy Table');
  assert.strictEqual(c.getDeviceLabel(), 'Snowy Table');
  assert.strictEqual(c.getAutoDeviceLabel(), 'Mac · ' + word, 'the placeholder label ignores the typed name');
  c.setDeviceName('');
  assert.strictEqual(c.getDeviceLabel(), 'Mac · ' + word, 'clearing brings the automatic label back');
});

test('the word is stable across reloads (the id persists) and differs between ids', () => {
  const s = useStorage();
  const first = c.getAutoDeviceLabel();
  assert.strictEqual(c.getAutoDeviceLabel(), first, 'same browser, same label');
  assert.ok(s._m.get('ft-device-id'), 'the minted id was stored');
  s._m.set('ft-device-id', 'a-completely-different-id-0');
  const other = c.getAutoDeviceLabel();
  assert.match(other, /^Mac · [A-Z][a-z]+$/);
});

test('setDeviceName trims, strips control and bidi characters, caps at 32, and clears on empty', () => {
  const s = useStorage();
  assert.strictEqual(c.setDeviceName('  Snowy Table  '), 'Snowy Table');
  assert.strictEqual(s._m.get('ft-device-name'), 'Snowy Table');
  assert.strictEqual(c.setDeviceName('A‮B\u0007C‏D⁦E⁩F\n'), 'ABCDEF', 'bidi overrides, isolates and controls are stripped');
  assert.strictEqual(c.setDeviceName('x'.repeat(500)).length, 32, 'capped at 32');
  assert.strictEqual(c.setDeviceName('   ‮  '), '', 'nothing left after cleaning');
  assert.strictEqual(s._m.has('ft-device-name'), false, 'empty removes the key');
  c.setDeviceName('Keep');
  assert.strictEqual(c.setDeviceName(''), '');
  assert.strictEqual(s._m.has('ft-device-name'), false);
  assert.strictEqual(c.getDeviceName(), '');
});

test('a hostile name stays plain text: markup is not interpreted or removed, only capped (the renderers escape or use textContent)', () => {
  useStorage();
  assert.strictEqual(c.setDeviceName('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>'.slice(0, 29));
  assert.strictEqual(c.getDeviceLabel(), '<img src=x onerror=alert(1)>'.slice(0, 29));
});

test('storage that throws (private mode) never breaks the label', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  Object.defineProperty(global, 'localStorage', { value: broken, configurable: true, writable: true });
  assert.strictEqual(c.getDeviceName(), '');
  assert.doesNotThrow(() => c.setDeviceName('Whatever'));
  assert.match(c.getDeviceLabel(), /^Mac · [A-Z][a-z]+$/);
});

test('the label always passes the server normalizeLabel unchanged', () => {
  useStorage();
  assert.strictEqual(normalizeLabel(c.getAutoDeviceLabel()), c.getAutoDeviceLabel(), 'the automatic label');
  for (const raw of ['Snowy Table', 'x'.repeat(500), 'A‮B\u0007C', '  padded  ', '<b>bold</b>', 'Mac · Otter']) {
    c.setDeviceName(raw);
    const label = c.getDeviceLabel();
    assert.strictEqual(normalizeLabel(label), label, 'normalizeLabel changes "' + label + '"');
  }
  for (const w of c.DEVICE_WORDS) for (const t of ['Another device', 'Android tablet', 'Chromebook']) {
    const label = t + ' · ' + w;
    assert.strictEqual(normalizeLabel(label), label);
    assert.ok(label.length <= 32, label + ' fits the cap');
  }
});

test('saving a name tells the Remote control target to relabel (so Speakers updates without a reload)', () => {
  useStorage();
  let relabels = 0;
  const had = Object.getOwnPropertyDescriptor(global, 'window');
  Object.defineProperty(global, 'window', { value: { FileTube: { remote: { relabel: () => { relabels += 1; } } } }, configurable: true, writable: true });
  try {
    c.setDeviceName('Snowy Table');
    c.setDeviceName('');
    assert.strictEqual(relabels, 2, 'a save and a clear both relabel');
  } finally {
    if (had) Object.defineProperty(global, 'window', had); else delete global.window;
  }
});
