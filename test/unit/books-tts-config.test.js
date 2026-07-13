'use strict';

// [UNIT] v1.38.0 T3 — pure FILETUBE_TTS_* env parsing (yt-dlp opt-in posture).

const { test } = require('node:test');
const assert = require('node:assert');

const { parseTtsConfig, activeBin } = require('../../lib/books/tts-config');

test('defaults: piper engine, PATH-literal binaries, NO model (opt-in stays dark)', () => {
  const c = parseTtsConfig({});
  assert.strictEqual(c.engine, 'piper');
  assert.strictEqual(c.piperBin, 'piper');
  assert.strictEqual(c.piperModel, null, 'no default model — Piper only lights when a model is configured');
  assert.strictEqual(c.piperConfig, null, 'null lets piper derive <model>.json');
  assert.strictEqual(c.espeakBin, 'espeak-ng');
  assert.strictEqual(c.espeakVoice, 'en');
  assert.strictEqual(activeBin(c), 'piper');
});

test('env overrides are honored; unknown engine falls back to piper', () => {
  const c = parseTtsConfig({
    FILETUBE_TTS_ENGINE: 'espeak-ng',
    FILETUBE_TTS_PIPER_BIN: '/opt/piper/piper',
    FILETUBE_TTS_PIPER_MODEL: '/models/en_US-amy.onnx',
    FILETUBE_TTS_PIPER_CONFIG: '/models/en_US-amy.onnx.json',
    FILETUBE_TTS_ESPEAK_BIN: '/usr/bin/espeak-ng',
    FILETUBE_TTS_ESPEAK_VOICE: 'en-us',
  });
  assert.strictEqual(c.engine, 'espeak-ng');
  assert.strictEqual(c.piperBin, '/opt/piper/piper');
  assert.strictEqual(c.piperModel, '/models/en_US-amy.onnx');
  assert.strictEqual(c.piperConfig, '/models/en_US-amy.onnx.json');
  assert.strictEqual(activeBin(c), '/usr/bin/espeak-ng', 'active engine espeak-ng => espeak binary is probed');

  assert.strictEqual(parseTtsConfig({ FILETUBE_TTS_ENGINE: 'bogus' }).engine, 'piper');
});

test('empty-string env values fall back to defaults (never "" paths)', () => {
  const c = parseTtsConfig({ FILETUBE_TTS_PIPER_BIN: '', FILETUBE_TTS_PIPER_MODEL: '' });
  assert.strictEqual(c.piperBin, 'piper');
  assert.strictEqual(c.piperModel, null);
});
