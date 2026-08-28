'use strict';

// Transcript export (Dean: "allow me to see and then copy/paste the full
// transcript from the video"). Pure, dependency-free helpers that turn a
// WebVTT document (the same sidecar `GET /api/subtitles/:id` serves) into
// plain readable text, served by `GET /api/transcript/:id` (server.js).
//
// THE problem this module exists for: yt-dlp's `--write-auto-subs` output
// (YouTube auto-captions) is a ROLLING document. Every spoken line appears
// in two or three consecutive cues -- first with per-word timing tags
// (`Ladies<00:00:00.640><c> and</c>...`), then as the top line of the next
// cue while the following line rolls in beneath it -- because that is how
// YouTube animates its two-line caption box. Naively concatenating cue text
// therefore yields every line twice. `buildTranscriptLines` strips the inline
// tags and drops the ROLLED-FORWARD lines: the previous cue's trailing lines
// that reappear as the next cue's LEADING lines (a suffix/prefix overlap),
// when the two cues are time-CONTIGUOUS. It is an overlap, deliberately NOT
// a membership test: a new utterance that happens to equal the rolled line
// (a second speaker saying "I'm in." back) sits AFTER the rolled copy in the
// same cue, and a membership rule silently dropped it - the gate caught 4
// such genuine lines lost in one real file. Hand-authored `.srt`/`.vtt`
// captions (one cue per line, gaps between cues) pass through untouched; a
// genuinely repeated line ("Yeah." twice) survives whenever the two cues are
// not contiguous.
//
// Nothing here touches the filesystem or the db: the route resolves the
// sidecar exactly as the subtitles route does and hands the text in.

const { VTT_CUE_TIMING_LINE, parseVttTimeMs } = require('./subtitles');

// Two rolling cues are "contiguous" when the next starts within this many
// ms of the previous cue's end. Real auto-sub documents abut exactly
// (end === next start); the slack absorbs rounding in re-timed files.
const CONTIGUOUS_GAP_MS = 500;

// The handful of entities YouTube/yt-dlp actually emit in cue payloads. A
// generic decoder is deliberately NOT attempted (no runtime dep, and this
// is plain text output -- an undecoded rarity is a cosmetic miss, not a
// bug class).
const ENTITY_MAP = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
  '&nbsp;': ' ', '&lrm;': '', '&rlm;': '',
};

/**
 * Strip inline cue markup (`<c>`, `</c>`, `<00:00:01.000>`, `<b>`, `<v Name>`
 * voice spans...) and decode the common entities. Pure.
 * @param {string} text one payload line
 * @returns {string}
 */
function cleanCueLine(text) {
  const raw = typeof text === 'string' ? text : '';
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp|lrm|rlm);/g, (m) => ENTITY_MAP[m])
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a WebVTT document into cues. Cue-BLOCK aware, same discipline as
 * shiftVttCues/centerVttCues (lib/subtitles.js): only a timing line at a
 * block boundary opens a cue; a payload line that merely looks like one is
 * payload. NOTE/STYLE/REGION blocks and the header are skipped. Never throws;
 * garbage in => `[]` out.
 * @param {string} text WebVTT text
 * @returns {Array<{startMs:number, endMs:number, lines:string[]}>}
 */
function parseVttCues(text) {
  const raw = typeof text === 'string' ? text : '';
  const lines = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const cues = [];
  let current = null; // the open cue, or null between blocks
  let inSkippedBlock = false; // NOTE/STYLE/REGION -- swallowed to the blank line
  for (const line of lines) {
    // Per the WebVTT spec a cue block ends at an EMPTY line. A whitespace-only
    // line inside a cue is payload (yt-dlp auto-subs open their first cue with
    // a lone " " line before the tagged text) -- treating it as a terminator
    // orphaned that cue's real text as a stray identifier and shifted the
    // line's timestamp onto the NEXT rolling cue. Between blocks, whitespace
    // is just whitespace.
    if (line === '' || (!current && line.trim() === '')) {
      current = null;
      inSkippedBlock = false;
      continue;
    }
    if (current) {
      const cleaned = cleanCueLine(line);
      if (cleaned !== '') current.lines.push(cleaned);
      continue;
    }
    if (inSkippedBlock) continue;
    const m = VTT_CUE_TIMING_LINE.exec(line);
    if (m) {
      const startMs = parseVttTimeMs(m[1]);
      const endMs = parseVttTimeMs(m[2]);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        inSkippedBlock = true; // malformed timing: swallow the block, never guess
        continue;
      }
      current = { startMs, endMs, lines: [] };
      cues.push(current);
      continue;
    }
    if (/^(NOTE|STYLE|REGION)\b/.test(line.trim()) || /^WEBVTT/.test(line.trim())) {
      inSkippedBlock = true;
      continue;
    }
    // Anything else at a block boundary is a cue IDENTIFIER line (or a
    // header field like "Kind: captions") -- the next line decides.
  }
  return cues;
}

/**
 * Flatten parsed cues into transcript lines with the rolling-caption
 * de-duplication described in the module header. Pure.
 * @param {Array<{startMs:number, endMs:number, lines:string[]}>} cues
 * @returns {Array<{startMs:number, text:string}>}
 */
function buildTranscriptLines(cues) {
  const out = [];
  let prev = null; // the last NON-EMPTY cue (see the empty-cue carry below)
  for (const cue of Array.isArray(cues) ? cues : []) {
    if (!cue || !Array.isArray(cue.lines)) continue;
    const contiguous = prev !== null && cue.startMs <= prev.endMs + CONTIGUOUS_GAP_MS;
    if (cue.lines.length === 0) {
      // yt-dlp emits text-less "hold" cues between rolling cues. Carrying the
      // previous text cue across it (extending its end so contiguity still
      // holds) keeps the overlap comparison against the cue that actually
      // rolled - otherwise `[A,B] -> [] -> [B,C]` would emit B twice.
      if (contiguous) prev = { startMs: prev.startMs, endMs: Math.max(prev.endMs, cue.endMs), lines: prev.lines };
      else prev = null;
      continue;
    }
    let overlap = 0;
    if (contiguous) {
      // Largest k such that prev's last k lines === this cue's first k lines.
      const max = Math.min(prev.lines.length, cue.lines.length);
      for (let k = max; k > 0; k--) {
        let same = true;
        for (let i = 0; i < k; i++) {
          if (prev.lines[prev.lines.length - k + i] !== cue.lines[i]) { same = false; break; }
        }
        if (same) { overlap = k; break; }
      }
    }
    for (let i = overlap; i < cue.lines.length; i++) out.push({ startMs: cue.startMs, text: cue.lines[i] });
    prev = cue;
  }
  return out;
}

// ms -> "m:ss" / "h:mm:ss" (the app's on-screen duration vocabulary, not
// VTT's zero-padded form -- this is prose, not a caption file).
function formatTranscriptTime(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Render transcript lines to text, one line each, optionally prefixed
 * `[m:ss] `. Pure.
 * @param {Array<{startMs:number, text:string}>} lines
 * @param {{timestamps?: boolean}} [opts]
 * @returns {string}
 */
function renderTranscriptBody(lines, opts) {
  const withTimes = !!(opts && opts.timestamps);
  return (Array.isArray(lines) ? lines : [])
    .map((l) => (withTimes ? `[${formatTranscriptTime(l.startMs)}] ${l.text}` : l.text))
    .join('\n');
}

// Day-precision, UTC: `releaseDate` is captured as UTC midnight of yt-dlp's
// upload_date (lib/ytdlp/store.js parseCapturedReleaseDate), so formatting
// in any local zone could roll it to the previous day. `addedAt` is a real
// instant, but day precision in UTC is honest enough for a document header.
function formatTranscriptDate(epochMs) {
  const d = new Date(epochMs);
  if (!Number.isFinite(epochMs) || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * The complete export document (Dean's spec: title, date published, channel,
 * then the transcript). Pure.
 * @param {{title?:string, releaseDate?:number, addedAt?:number, channelName?:string}} meta
 * @param {string} body the rendered transcript text
 * @returns {string}
 */
function buildTranscriptDocument(meta, body) {
  const m = meta || {};
  const header = [];
  header.push(typeof m.title === 'string' && m.title.trim() !== '' ? m.title.trim() : 'Untitled');
  if (typeof m.releaseDate === 'number' && Number.isFinite(m.releaseDate)) {
    header.push(`Published ${formatTranscriptDate(m.releaseDate)}`);
  } else if (typeof m.addedAt === 'number' && Number.isFinite(m.addedAt)) {
    // Honest label: we know when the file arrived, not when it was published.
    header.push(`Added ${formatTranscriptDate(m.addedAt)}`);
  }
  if (typeof m.channelName === 'string' && m.channelName.trim() !== '') header.push(m.channelName.trim());
  return `${header.join('\n')}\n\n${typeof body === 'string' ? body : ''}\n`;
}

/**
 * One-call convenience the route uses: VTT text + item metadata -> document.
 * @param {string} vttText
 * @param {object} meta see buildTranscriptDocument
 * @param {{timestamps?: boolean}} [opts]
 * @returns {string}
 */
function vttToTranscriptDocument(vttText, meta, opts) {
  return buildTranscriptDocument(meta, renderTranscriptBody(buildTranscriptLines(parseVttCues(vttText)), opts));
}

module.exports = {
  cleanCueLine,
  parseVttCues,
  buildTranscriptLines,
  renderTranscriptBody,
  formatTranscriptTime,
  formatTranscriptDate,
  buildTranscriptDocument,
  vttToTranscriptDocument,
  CONTIGUOUS_GAP_MS,
};
