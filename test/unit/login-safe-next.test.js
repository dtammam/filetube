'use strict';

// [UNIT] v1.352 W1: login.js safeNextFrom, where a sign-in lands. Every off-origin shape returns '/'
// (the v1.43 prefix check let /\evil and /<TAB>/evil through: a browser resolves both to //evil),
// and a same-origin page keeps its query (the speaker bookmark /music?remote=on survives a login).

const { test } = require('node:test');
const assert = require('node:assert');
const { safeNextFrom } = require('../../public/js/login.js');

const ORIGIN = 'https://filetube.tamm.am';
const nx = (raw) => safeNextFrom('?next=' + raw, ORIGIN);

test('a same-origin page and its query are kept', () => {
  assert.strictEqual(nx(encodeURIComponent('/music?remote=on')), '/music?remote=on');
  assert.strictEqual(nx(encodeURIComponent('/watch?v=abc&t=90#c')), '/watch?v=abc&t=90#c');
  assert.strictEqual(nx('/setup'), '/setup');
  assert.strictEqual(nx(encodeURIComponent('/@evil')), '/@evil', 'a path segment, same origin');
  assert.strictEqual(nx('%2F%2E%2E%2Fsetup'), '/setup', 'dot segments are resolved, still on this origin');
});

test('every off-origin or non-path shape lands on /', () => {
  for (const raw of [
    '%2F%5Cevil.example', // /\evil.example
    '%2F%09%2Fevil.example', // /<TAB>/evil.example
    '%2F%0A%2Fevil.example', // /<LF>/evil.example
    '%2F%0D%2Fevil.example',
    '%2F%5C%5Cevil.example',
    '%2F%2Fevil', '//evil', '%5C%5Cevil', '%5Cevil',
    'https://evil', 'https%3A%2F%2Fevil', 'javascript:alert(1)', 'javascript%3Aalert(1)', 'data:text/html,x',
    '%2F%2F%2Fevil', 'evil.example', '', '%20%2F%2Fevil',
    '%2F%5Cevil.example%2F%2Fx', // off-origin with a path: its pathname //x would leave again
    '%2F%5Cevil.example%2Fphish',
    '%2F.%2F%2Fevil', // same origin, but its path //evil leaves again when assigned
    '%2Fx%2F..%2F%2Fevil',
  ]) {
    assert.strictEqual(nx(raw), '/', raw);
  }
  assert.strictEqual(safeNextFrom('', ORIGIN), '/');
  assert.strictEqual(safeNextFrom(null, ORIGIN), '/');
});

test('nothing it returns can leave the origin when assigned (no // or /\\ start, resolves here)', () => {
  const shapes = ['/a', '//b', '/\\c', '/\t/d', '/%2F/e', '/\\f//g', '/.//h', '/..//i', '/?//j', '/#//k'];
  for (const raw of shapes) {
    const out = safeNextFrom('?next=' + encodeURIComponent(raw), ORIGIN);
    assert.ok(out.charAt(0) === '/' && !/^[/\\]{2}/.test(out), raw + ' -> ' + out);
    assert.strictEqual(new URL(out, ORIGIN + '/login').origin, ORIGIN, raw + ' -> ' + out);
  }
});
