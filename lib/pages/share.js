'use strict';

// lib/pages/share.js - the text "Share with AI" sends (plan P8). One prompt list
// for transcripts AND Pages (the `transcriptAiPrompts` setting, unchanged). The
// shape, item by item:
//
//   <the chosen prompt>            (only when one is chosen)
//   <blank line>
//   Title: ... / Author: ... / Site: ... / URL: ... / Published: ... / Saved: ... / Note: ...
//   <blank line>
//   <the Reader text as plain text>
//
// A list shares every item in list order, each with its own header, separated by
// a `---` line; the prompt appears once, at the top. The client composes the
// prompt in front itself (common.js composeTranscriptAiShare) so a tap on a
// prompt is answered from text it already holds (the iOS share/clipboard rule);
// the server builds the same string when a promptId is asked for.

const LIST_SEPARATOR = '\n\n---\n\n';
const MAX_SHARE_CHARS = 4 * 1024 * 1024;

function pad2(n) { return n < 10 ? '0' + n : String(n); }

// A date as the reader sees it on the page: local YYYY-MM-DD (LESSONS 11).
function dayOf(iso) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function oneLine(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

// One item's document: the metadata header, a blank line, the text.
function itemDocument(item, record, text) {
  const lines = [];
  lines.push('Title: ' + oneLine(item.title || 'Untitled'));
  if (item.author) lines.push('Author: ' + oneLine(item.author));
  if (item.site) lines.push('Site: ' + oneLine(item.site));
  if (item.url) lines.push('URL: ' + item.url);
  const pub = dayOf(item.publishedAt);
  if (pub) lines.push('Published: ' + pub);
  const saved = dayOf(item.savedAt);
  if (saved) lines.push('Saved: ' + saved);
  const note = record && typeof record.note === 'string' ? record.note.trim() : '';
  if (note) lines.push('Note: ' + note.replace(/\n+/g, ' / '));
  const body = typeof text === 'string' ? text.trim() : '';
  return lines.join('\n') + '\n\n' + body;
}

function withPrompt(promptText, doc) {
  const p = typeof promptText === 'string' ? promptText.trim() : '';
  return p ? p + '\n\n' + doc : doc;
}

function listDocument(docs) {
  const out = docs.join(LIST_SEPARATOR);
  return out.length > MAX_SHARE_CHARS ? out.slice(0, MAX_SHARE_CHARS) : out;
}

module.exports = { itemDocument, withPrompt, listDocument, dayOf, LIST_SEPARATOR, MAX_SHARE_CHARS };
