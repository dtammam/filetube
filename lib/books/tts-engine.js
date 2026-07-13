'use strict';

// v1.38.0 TTS — PURE argument-array builders for the synthesis engines and the
// WAV→m4a encode. No spawning, no fs, no shell here (the server worker owns the
// process lifecycle); these are the injection-safe argv shapes the worker hands
// to `cp.spawn(bin, args)`, mirroring server.js's buildAudioExtractArgs. Every
// builder is table-flat and unit-testable without a real binary.
//
// Engine flags are pinned to VERIFIED sources (the repo has shipped inert flag
// assumptions twice):
//   Piper (rhasspy/piper src/cpp/main.cpp + OHF-Voice/piper1-gpl): text on
//     STDIN (one utterance per line), `--model <onnx>`, `--config <json>`
//     (defaults to <model>.json), `--output_file <wav>`, `--length_scale <n>`
//     (SPEAKING RATE knob — there is NO --rate/--speed flag; >1 = slower,
//     <1 = faster), `--sentence_silence <sec>`. We do NOT pass --quiet: the
//     maintained piper1-gpl parses unknown flags AS SPOKEN TEXT (see below).
//   espeak-ng (man page): `--stdin`, `-w <wav>`, `-v <voice>`, `-s <wpm>`
//     (default 175).

// Speaking-rate multiplier bounds shared with db.books.settings.rate: 1.0 =
// normal, higher = faster. Bounded so a hostile/garbage setting can't produce
// absurd length_scale/wpm values.
const RATE_MIN = 0.5;
const RATE_MAX = 2.0;

function clampRate(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return 1.0;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, n));
}

// Map the engine-agnostic rate multiplier to each engine's own knob.
//   piper.length_scale = 1/rate  (phoneme duration: >1 slower), bounded 0.5..2.
//   espeak.wpm         = 175*rate (words per minute, espeak's default is 175).
function mapRate(engine, rate) {
  const r = clampRate(rate);
  if (engine === 'espeak-ng') return { wpm: Math.round(175 * r) };
  return { lengthScale: Number(Math.min(2, Math.max(0.5, 1 / r)).toFixed(3)) };
}

const DEFAULT_SENTENCE_SILENCE = 0.4;

// Piper argv for synthesizing ONE block's WAV. `text` is NEVER an argv token —
// the worker writes it to the child's stdin (no interpolation/injection).
function buildPiperArgs({ model, config, wavOut, rate, sentenceSilence } = {}) {
  const { lengthScale } = mapRate('piper', rate);
  const args = ['--model', String(model)];
  // Omit --config to let piper derive <model>.json (its own default) when the
  // caller has no explicit config path.
  if (config) args.push('--config', String(config));
  args.push(
    '--length_scale', String(lengthScale),
    '--sentence_silence', String(Number.isFinite(sentenceSilence) ? sentenceSilence : DEFAULT_SENTENCE_SILENCE),
    '--output_file', String(wavOut),
  );
  // NB: deliberately NO --quiet. rhasspy/piper (archived 2025-10) accepts it,
  // but the MAINTAINED fork OHF-Voice/piper1-gpl (what `pip install piper-tts`
  // installs today) parses with parse_known_args() and treats any UNRECOGNIZED
  // token -- including --quiet -- as the TEXT to speak, so it would synthesize
  // the literal "--quiet" and never read our piped block text (false-success
  // garbage audio). We don't need it either way: the worker spawns piper with
  // stdout ignored and piper's progress logging goes to stderr (captured +
  // dropped on success). Verified against both sources (gate finding, v1.38.0).
  return args;
}

// espeak-ng argv for ONE block's WAV (the config-selectable fallback engine).
// Text is written to stdin (`--stdin`), never an argv token.
function buildEspeakArgs({ voice, wavOut, rate } = {}) {
  const { wpm } = mapRate('espeak-ng', rate);
  return [
    '--stdin',
    '-v', String(voice || 'en'),
    '-s', String(wpm),
    '-w', String(wavOut),
  ];
}

// WAV→m4a encode argv, mirroring buildAudioExtractArgs exactly but for a concat
// of per-block WAVs. Speech, not music: mono + 96k (smaller cache, and a cheap
// future "export as audiobook" concat). `+faststart` for range/streaming; atomic
// `.tmp`→rename is the worker's job. concatListPath is an ffmpeg concat-demuxer
// file list (`file '<path>'` lines).
function buildTtsEncodeArgs(concatListPath, tmpM4aPath) {
  return [
    '-f', 'concat', '-safe', '0', '-i', String(concatListPath),
    '-c:a', 'aac', '-b:a', '96k', '-ac', '1',
    '-movflags', '+faststart',
    '-y', String(tmpM4aPath),
  ];
}

module.exports = {
  RATE_MIN,
  RATE_MAX,
  clampRate,
  mapRate,
  buildPiperArgs,
  buildEspeakArgs,
  buildTtsEncodeArgs,
  DEFAULT_SENTENCE_SILENCE,
};
