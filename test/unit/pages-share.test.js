'use strict';

// [UNIT] v1.395.0 Pages (plan P8): the Share with AI text - the chosen prompt, a
// metadata header (title, author, site, URL, published, saved, the note), then the
// Reader text; a list joins each item's own document with a `---` line.

const test = require('node:test');
const assert = require('node:assert');
const share = require('../../lib/pages/share');

const item = { title: 'The  boathouse\nmoves', author: 'Sam Rivers', site: 'River Gazette', url: 'https://news.example.com/b', publishedAt: new Date(2026, 9, 20, 9).toISOString(), savedAt: new Date(2026, 9, 25, 12).toISOString() };

test('one item: header lines in order, absent fields omitted, a multi-line note on one line, then the text', () => {
  const doc = share.itemDocument(item, { note: 'from Sam\nreread the end' }, '\nBody text.\n');
  assert.strictEqual(doc, 'Title: The boathouse moves\nAuthor: Sam Rivers\nSite: River Gazette\nURL: https://news.example.com/b\nPublished: 2026-10-20\nSaved: 2026-10-25\nNote: from Sam / reread the end\n\nBody text.');
  const bare = share.itemDocument({ title: 'Saved text', savedAt: item.savedAt }, { note: '' }, 'Hello');
  assert.strictEqual(bare, 'Title: Saved text\nSaved: 2026-10-25\n\nHello');
});

test('the prompt goes first, once, with a blank line; no prompt = the document alone (what the client composes from)', () => {
  assert.strictEqual(share.withPrompt('  Summarize.  ', 'DOC'), 'Summarize.\n\nDOC');
  assert.strictEqual(share.withPrompt('', 'DOC'), 'DOC');
  assert.strictEqual(share.listDocument(['A', 'B', 'C']), 'A\n\n---\n\nB\n\n---\n\nC');
});
