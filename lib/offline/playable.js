'use strict';

// lib/offline/playable.js - the iOS playability rule (v1.387.0 offline playback,
// plan D3). ONE pure function: given a file's container, codecs and (for HEVC)
// its codec tag, decide what the offline file route serves to the iOS app.
//
// This is deliberately NOT the browser's `needsTranscode` (server.js): that
// predicate transcodes ALAC to AAC 160k (a permanent loss for a lossless offline
// copy) and flags HEVC because only h264 counts, while iOS plays ALAC, FLAC and
// hvc1-tagged HEVC natively (plan correction 3). The table lives in
// docs/references/offline-api.md and is confirmed on a device by the iOS Root.
//
//   'original'  - serve the source file as is
//   'transcode' - serve the cached H.264/AAC MP4 the existing queue makes
//                 (TRANSCODE_DIR/<id>.mp4 or tv-<id>.mp4), queueing it when absent
//   'none'      - not offerable (409, terminal): no transcode path, ffmpeg absent,
//                 or the transcode already failed

// Containers iOS plays natively (the lowercase extension with its dot).
const VIDEO_CONTAINERS = new Set(['.mp4', '.m4v', '.mov']);
const AUDIO_CONTAINERS = new Set(['.m4a', '.mp3', '.aac', '.flac', '.wav', '.caf']);
// Podcast episodes have no stored codec: decided by extension only.
const PODCAST_CONTAINERS = new Set(['.mp3', '.m4a', '.aac', '.mp4']);

const VIDEO_CODECS = new Set(['h264', 'avc1']);
const HEVC_CODECS = new Set(['hevc', 'h265', 'hvc1', 'hev1']);
const HEVC_TAG_OK = 'hvc1';
// opus: confirmed playing in an mp4 on a device (iOS Root, iPhone XS iOS 18.7.10, 2026-10-11, row 16 of the table).
// The ogg / opus CONTAINERS stay out until the iOS 27 run and the iOS 17 floor question are answered.
const AUDIO_CODECS = new Set(['aac', 'mp3', 'alac', 'flac', 'ac3', 'eac3', 'opus']);

function norm(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}
function audioCodecOk(codec) {
  const c = norm(codec);
  if (c === '') return true; // unknown = not flagged (positive identification only, the musicCodecNeedsTranscode posture)
  return AUDIO_CODECS.has(c) || c.startsWith('pcm');
}
// `hevcTag` is the stream's codec_tag_string from a lazy ffprobe at manifest time
// (null / undefined / 'unknown' when the probe could not say): only `hvc1` plays.
function videoCodecOk(codec, hevcTag) {
  const c = norm(codec);
  if (c === '') return true; // unknown = not flagged
  if (VIDEO_CODECS.has(c)) return true;
  if (HEVC_CODECS.has(c)) return norm(hevcTag) === HEVC_TAG_OK;
  return false;
}
function isHevc(codec) {
  return HEVC_CODECS.has(norm(codec));
}

// -> { mode, reason }. `input`:
//   kind              'video' | 'tvEpisode' | 'track' | 'podcastEpisode'
//   ext               '.mp4' (lowercase, with the dot)
//   videoCodec        the stored video codec (media `codec`, tv `codec`); audio-only kinds pass none
//   audioCodec        the stored audio codec (media `audioCodec`, tv `audioCodec`, a track's `codec`)
//   hevcTag           the probed codec_tag_string for an HEVC item, else undefined
//   isAudio           true for an audio-only MEDIA item (library audio shown in Music) - audio containers apply
//   transcodeAvailable  ffmpeg present (a live reader at the call site)
//   transcodeFailed   the item's transcode already failed (media `transcodeStatus === 'failed'`)
function decidePlayability(input) {
  const kind = input && input.kind;
  const ext = norm(input && input.ext);
  if (kind === 'podcastEpisode') {
    return PODCAST_CONTAINERS.has(ext) ? { mode: 'original' } : { mode: 'none', reason: 'container' };
  }
  if (kind === 'track' || (kind === 'video' && input.isAudio)) {
    // Audio: the original or nothing (no audio transcode path offline; ALAC and FLAC stay lossless).
    const containerOk = AUDIO_CONTAINERS.has(ext) || VIDEO_CONTAINERS.has(ext);
    if (containerOk && audioCodecOk(input.audioCodec)) return { mode: 'original' };
    return { mode: 'none', reason: containerOk ? 'audioCodec' : 'container' };
  }
  if (kind === 'video' || kind === 'tvEpisode') {
    if (VIDEO_CONTAINERS.has(ext) && videoCodecOk(input.videoCodec, input.hevcTag) && audioCodecOk(input.audioCodec)) {
      return { mode: 'original' };
    }
    if (input.transcodeFailed) return { mode: 'none', reason: 'transcodeFailed' };
    if (!input.transcodeAvailable) return { mode: 'none', reason: 'noTranscoder' };
    return { mode: 'transcode' };
  }
  return { mode: 'none', reason: 'kind' };
}

module.exports = {
  decidePlayability,
  isHevc,
  videoCodecOk,
  audioCodecOk,
  VIDEO_CONTAINERS,
  AUDIO_CONTAINERS,
  PODCAST_CONTAINERS,
  VIDEO_CODECS,
  HEVC_CODECS,
  AUDIO_CODECS,
  HEVC_TAG_OK,
};
