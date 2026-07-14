'use strict';

// v1.38.0 TTS — PURE env-config parsing (the yt-dlp opt-in posture). No fs, no
// spawning; the server does the availability probe. Piper is the default and is
// STRICTLY opt-in: absent binary/model ⇒ books still work and the Listen
// control stays dark. espeak-ng is a config-selectable fallback engine value.

// Parse the FILETUBE_TTS_* environment into a normalized config object.
function parseTtsConfig(env = {}) {
  const engine = env.FILETUBE_TTS_ENGINE === 'espeak-ng' ? 'espeak-ng' : 'piper';
  return {
    engine,
    // PATH-resolved literal default, exactly like yt-dlp's 'yt-dlp'.
    piperBin: (env.FILETUBE_TTS_PIPER_BIN && String(env.FILETUBE_TTS_PIPER_BIN)) || 'piper',
    // No default: Piper needs an explicit voice model to light.
    piperModel: (env.FILETUBE_TTS_PIPER_MODEL && String(env.FILETUBE_TTS_PIPER_MODEL)) || null,
    // null ⇒ let piper derive <model>.json (its own default).
    piperConfig: (env.FILETUBE_TTS_PIPER_CONFIG && String(env.FILETUBE_TTS_PIPER_CONFIG)) || null,
    espeakBin: (env.FILETUBE_TTS_ESPEAK_BIN && String(env.FILETUBE_TTS_ESPEAK_BIN)) || 'espeak-ng',
    espeakVoice: (env.FILETUBE_TTS_ESPEAK_VOICE && String(env.FILETUBE_TTS_ESPEAK_VOICE)) || 'en',
  };
}

// The binary the active engine will spawn (for the availability probe).
function activeBin(config) {
  return config.engine === 'espeak-ng' ? config.espeakBin : config.piperBin;
}

// v1.41.0: parse a version string from an engine's `--version` stdout, for the
// Stats About section. ESPEAK-NG ONLY: it prints e.g. "eSpeak NG text-to-speech:
// 1.51  Data at: ...". PIPER is deliberately excluded -- the maintained
// piper1-gpl parses unknown flags via parse_known_args and can emit synthesized
// AUDIO for `--version` (the v1.38.0 gate lesson), so its stdout is not a
// trustworthy version string; return null and show just the engine name. Pure;
// tolerant of missing/garbage input.
function parseEngineVersion(engine, versionOutput) {
  if (engine !== 'espeak-ng' || typeof versionOutput !== 'string') return null;
  const m = versionOutput.match(/(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}

module.exports = { parseTtsConfig, activeBin, parseEngineVersion };
