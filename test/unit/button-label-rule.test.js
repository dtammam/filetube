'use strict';

// [UNIT] v1.341.4 (Dean): every menu row and action button is a SHORT VERB PHRASE - 1-3 words, sentence case,
// no full sentence, no trailing punctuation ("Like", "Fix chapter times", "Add to queue", "Share"). The rule
// is in docs/CONTRIBUTING.md. The labels come from a few literal shapes, so this scans the client source for
// each shape: an object literal with a static `label:` beside an `icon:` or an `onPick`, the Extras menu's
// `data-skin-x` buttons, and the two chapter-menu entries player.js writes with textContent.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const JS = path.join(__dirname, '..', '..', 'public', 'js');
const RULE = /^[A-Z][a-z]*( [a-z0-9]+){0,2}$/;
// proper nouns and acronyms the sentence-case pattern cannot express
const ALLOWED = new Set(['Move to Trash', 'Share with AI', 'Copy for AI']);

function sourceLabels() {
  const out = [];
  for (const f of fs.readdirSync(JS).filter((n) => n.endsWith('.js'))) {
    const lines = fs.readFileSync(path.join(JS, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const at = `${f}:${i + 1}`;
      const re = /\blabel: '([^']+)'\s*[,}]/g; let m;
      if (/\bicon: |\bonPick\b/.test(line)) while ((m = re.exec(line))) out.push({ at, text: m[1] });
      const x = /data-skin-x="[a-z-]+"[^>]*>(?:<i class="icon-[a-z-]+"><\/i>)?([A-Z][^<]*)</g;
      while ((m = x.exec(line))) out.push({ at, text: m[1] });
      const c = /(?:snapEntry|edit)\.textContent = (?:[^?]* \? )?'([^']+)'(?: : '([^']+)')?/.exec(line);
      if (c) { out.push({ at, text: c[1] }); if (c[2]) out.push({ at, text: c[2] }); }
    });
  }
  return out;
}

test('every static menu-row and action-button label is a short verb phrase', () => {
  const labels = sourceLabels();
  assert.ok(labels.length >= 60, 'the scan finds the labels (found ' + labels.length + ')');
  const bad = labels.filter((l) => !ALLOWED.has(l.text) && !RULE.test(l.text));
  // the Pocket iPod menus keep the device's own Title Case names ("Shuffle Songs") and are not scanned here
  assert.deepStrictEqual(bad.map((l) => `${l.at} "${l.text}"`), [], 'labels that break the rule');
});

test('the scan reaches the rows Dean named (a rule that finds nothing proves nothing)', () => {
  const texts = new Set(sourceLabels().map((l) => l.text));
  for (const t of ['Like', 'Share', 'Add to queue', 'Fix chapter times', 'Move to folder', 'Edit chapters', 'Assign channel']) {
    assert.ok(texts.has(t), 'scanned: ' + t);
  }
});

test('the pattern rejects a sentence, a trailing ellipsis and a fourth word', () => {
  for (const s of ['This chapter starts wrong', 'Move to...', 'Fix chapter times…', 'Move to another folder', 'like']) assert.ok(!RULE.test(s), s);
  for (const s of ['Like', 'Fix chapter times', 'Add to queue', 'Share', 'Share at 1']) assert.ok(RULE.test(s), s);
});
