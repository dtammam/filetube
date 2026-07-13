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

module.exports = { parseTtsConfig, activeBin };
