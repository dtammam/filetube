'use strict';

// [UNIT] v1.50.2 (Dean: "super era-appropriate fonts... Modern and Flat
// don't feel like YouTube text wise" + the sentence-case pass).
// Two claims locked here:
//  1. Era-accurate families/weights: 2014 is ARIAL (the real 2012-2016
//     pre-Polymer YouTube; Roboto only took the site in 2017) and 2021
//     titles are medium-weight with 'YouTube Sans' named FIRST in the
//     heading stack (zero files shipped -- local-install progressive
//     enhancement; the face is proprietary and cannot be bundled).
//  2. The pass is spacing-safe by construction: title surfaces consume
//     tokens with fallbacks that resolve to the exact pre-v1.50.2 values
//     (bold/normal) in every era that doesn't override them.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'style.css'), 'utf8');

function eraBlock(era) {
  const m = new RegExp(`\\[data-theme="${era}"\\] \\{([\\s\\S]*?)\\}`).exec(css);
  assert.ok(m, `expected the [data-theme="${era}"] token block`);
  return m[1];
}

test('2014 Flat is Arial, not Roboto (era-accurate: pre-Polymer YouTube desktop was Arial)', () => {
  const block = eraBlock('2014');
  assert.match(block, /--font-family:\s*Arial, Helvetica, sans-serif/);
  assert.doesNotMatch(block, /--font-family:[^;]*Roboto/, 'Roboto in 2014 reads as "2017 wearing a 2014 layout"');
});

test('2021 Modern headings: YouTube Sans named FIRST (local-only, never bundled), medium weight, slight negative tracking', () => {
  const block = eraBlock('2021');
  assert.match(block, /--heading-font:\s*'YouTube Sans',\s*'Roboto'/, 'the stack ships no files -- local install wins, Roboto is the fallback');
  assert.match(block, /--heading-weight:\s*500/, 'modern YouTube titles are medium, not bold');
  assert.match(block, /--heading-tracking:\s*-0\.01em/);
});

test('every era defines --heading-weight; non-2021 eras stay bold/normal (byte-identical look to pre-v1.50.2)', () => {
  for (const era of ['2005', '2009', '2014']) {
    const block = eraBlock(era);
    assert.match(block, /--heading-weight:\s*bold/, `${era} headings stay bold`);
    assert.match(block, /--heading-tracking:\s*normal/, `${era} tracking unchanged`);
  }
});

test('the three title surfaces consume the tokens with safe fallbacks -- and ONLY those three (body text untouched)', () => {
  for (const selector of ['.section-title', '.video-title', '.watch-title']) {
    const m = new RegExp(`\\n\\${selector} \\{([\\s\\S]*?)\\}`).exec(css);
    assert.ok(m, `expected the base ${selector} rule`);
    assert.match(m[1], /font-family:\s*var\(--heading-font, var\(--font-family\)\)/, `${selector} heading family token`);
    assert.match(m[1], /font-weight:\s*var\(--heading-weight, bold\)/, `${selector} falls back to the historical bold`);
    assert.match(m[1], /letter-spacing:\s*var\(--heading-tracking, normal\)/, `${selector} falls back to normal tracking`);
  }
  const consumers = css.match(/var\(--heading-weight/g) || [];
  assert.strictEqual(consumers.length, 3, 'exactly the three title surfaces consume the heading tokens -- a fourth needs its own review');
});

test('no Roboto @font-face change: the bundled variable font (100-900) is what makes weight 500 genuine', () => {
  assert.match(css, /font-weight:\s*100 900/, 'the variable-font declaration must survive -- 500 must never be synthesized');
});

test('sentence-case pass: none of the converted Title Case phrases survive in any shell', () => {
  const CONVERTED = [
    'Library Settings', 'Resume Playback?', 'Related Files', 'Recently Added',
    'Most Recent', 'Configure Media Folders', 'Folder Uploader', 'Playlist Folder',
    'Audio Track Title', 'Add Folder', 'Configured Directories', 'Scan Books Now',
    'Scan Music Now', 'Save Book Folders', 'Save Music Folders',
  ];
  const shells = fs.readdirSync(path.join(__dirname, '..', '..', 'public')).filter((f) => f.endsWith('.html'));
  for (const shell of shells) {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', shell), 'utf8');
    for (const phrase of CONVERTED) {
      assert.ok(!html.includes('>' + phrase + '<'), `${shell} still renders "${phrase}" -- the sentence-case pass must hold everywhere`);
    }
  }
});
