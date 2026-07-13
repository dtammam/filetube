'use strict';

// [UNIT] v1.38.0 T5/T6 — pure engine + encode argv builders. Asserts the exact
// (verified-against-source) flag shapes and the rate mapping, with NO binary.

const { test } = require('node:test');
const assert = require('node:assert');

const eng = require('../../lib/books/tts-engine');

// ---- rate mapping ------------------------------------------------------------

test('clampRate: bounds to 0.5..2.0 and defaults garbage to 1.0', () => {
  assert.strictEqual(eng.clampRate(1), 1);
  assert.strictEqual(eng.clampRate(3), 2.0);
  assert.strictEqual(eng.clampRate(0.1), 0.5);
  assert.strictEqual(eng.clampRate(0), 1.0);
  assert.strictEqual(eng.clampRate(-2), 1.0);
  assert.strictEqual(eng.clampRate('nope'), 1.0);
});

test('mapRate: piper uses length_scale = 1/rate (>1 slower), espeak uses wpm = 175*rate', () => {
  assert.deepStrictEqual(eng.mapRate('piper', 1), { lengthScale: 1 });
  assert.deepStrictEqual(eng.mapRate('piper', 2), { lengthScale: 0.5 }); // 2x faster
  assert.deepStrictEqual(eng.mapRate('piper', 0.5), { lengthScale: 2 }); // half speed
  assert.deepStrictEqual(eng.mapRate('espeak-ng', 1), { wpm: 175 });
  assert.deepStrictEqual(eng.mapRate('espeak-ng', 2), { wpm: 350 });
  // Unknown engine falls back to the piper mapping.
  assert.deepStrictEqual(eng.mapRate('whatever', 1), { lengthScale: 1 });
});

// ---- Piper argv (verified: stdin text, --model/--config/--length_scale/--output_file/--quiet)

test('buildPiperArgs: exact flag shape; --config omitted when absent; NO --rate flag', () => {
  const args = eng.buildPiperArgs({ model: '/m/voice.onnx', wavOut: '/tmp/b0.wav', rate: 1 });
  assert.deepStrictEqual(args, [
    '--model', '/m/voice.onnx',
    '--length_scale', '1',
    '--sentence_silence', '0.4',
    '--output_file', '/tmp/b0.wav',
    '--quiet',
  ]);
  assert.ok(!args.includes('--rate') && !args.includes('--speed'), 'piper has no --rate/--speed flag');
});

test('buildPiperArgs: includes --config when given and maps rate to length_scale', () => {
  const args = eng.buildPiperArgs({ model: '/m/v.onnx', config: '/m/v.onnx.json', wavOut: '/o.wav', rate: 2 });
  const ci = args.indexOf('--config');
  assert.ok(ci >= 0 && args[ci + 1] === '/m/v.onnx.json');
  const li = args.indexOf('--length_scale');
  assert.strictEqual(args[li + 1], '0.5');
});

test('buildPiperArgs: text is never an argv token (injection-safe by construction)', () => {
  const args = eng.buildPiperArgs({ model: '/m.onnx', wavOut: '/o.wav', rate: 1 });
  // No positional text; the worker pipes it to stdin. Every token is a flag or a value.
  assert.ok(!args.some((a) => /passwd|; rm|\$\(/.test(a)));
});

// ---- espeak-ng argv ----------------------------------------------------------

test('buildEspeakArgs: --stdin + -v + -s(wpm) + -w, default voice en', () => {
  assert.deepStrictEqual(
    eng.buildEspeakArgs({ wavOut: '/o.wav', rate: 1 }),
    ['--stdin', '-v', 'en', '-s', '175', '-w', '/o.wav'],
  );
  assert.deepStrictEqual(
    eng.buildEspeakArgs({ voice: 'en-us', wavOut: '/o.wav', rate: 2 }),
    ['--stdin', '-v', 'en-us', '-s', '350', '-w', '/o.wav'],
  );
});

// ---- WAV→m4a encode ----------------------------------------------------------

test('buildTtsEncodeArgs: concat demuxer -> mono 96k AAC + faststart, no shell interpolation', () => {
  assert.deepStrictEqual(
    eng.buildTtsEncodeArgs('/tmp/list.txt', '/tmp/out.tmp.m4a'),
    ['-f', 'concat', '-safe', '0', '-i', '/tmp/list.txt',
     '-c:a', 'aac', '-b:a', '96k', '-ac', '1',
     '-movflags', '+faststart',
     '-y', '/tmp/out.tmp.m4a'],
  );
});
