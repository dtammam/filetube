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

test('gate C1 lock: every non-2021 era OVERRIDES --heading-font to its own stack -- :root\'s 2021 default INHERITS otherwise (custom properties ignore the var() fallback once defined up-tree)', () => {
  for (const era of ['2005', '2009', '2014']) {
    const block = eraBlock(era);
    assert.match(block, /--heading-font:\s*var\(--font-family\)/, `${era} must re-point the heading family at its own body stack`);
    const headingFontLine = /--heading-font:[^;]*/.exec(block)[0];
    assert.doesNotMatch(headingFontLine, /Roboto|YouTube Sans/, `${era} heading font must name neither Roboto nor YouTube Sans literally`);
  }
});

test('the three title surfaces consume the tokens with safe fallbacks -- and ONLY those three (body text untouched)', () => {
  for (const selector of ['.section-title', '.video-title', '.watch-title']) {
    const m = new RegExp(`\\n\\${selector} \\{([\\s\\S]*?)\\}`).exec(css);
    assert.ok(m, `expected the base ${selector} rule`);
    assert.match(m[1], /font-family:\s*var\(--heading-font, var\(--font-family\)\)/, `${selector} heading family token`);
    // Tier 2 commit 4 (DELIBERATE lock update): the vacuous fallback is now
    // spelled var(--fw-bold) - same resolved weight (700 == bold, pinned by
    // the token-scale lock), one weight spelling system-wide.
    assert.match(m[1], /font-weight:\s*var\(--heading-weight, var\(--fw-bold\)\)/, `${selector} falls back to the historical bold via the token`);
    assert.match(m[1], /letter-spacing:\s*var\(--heading-tracking, normal\)/, `${selector} falls back to normal tracking`);
  }
  // Gate S3: count all three tokens, not just weight -- a rogue family-only
  // or tracking-only consumer must trip this too.
  for (const token of ['--heading-font', '--heading-weight', '--heading-tracking']) {
    const consumers = css.match(new RegExp(`var\\(${token}`, 'g')) || [];
    assert.strictEqual(consumers.length, 3, `exactly the three title surfaces consume ${token} -- a fourth needs its own review`);
  }
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
  // Gate W1: "everywhere" includes the yt-dlp module's OWN served shell
  // (lib/ytdlp/views/) -- the first sweep missed it entirely and this test
  // was structurally blind to it.
  const shellDirs = [
    path.join(__dirname, '..', '..', 'public'),
    path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views'),
  ];
  for (const dir of shellDirs) {
    for (const shell of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(dir, shell), 'utf8');
      for (const phrase of CONVERTED) {
        // Gate W4: plain substring, not '>phrase<' -- the sidebar's
        // '<i class="icon-cog"></i> Library Settings\n</a>' shape (icon
        // sibling + whitespace) let a reverted phrase survive the enclosed
        // check. The sweeps converted comments too, so substring is safe.
        assert.ok(!html.includes(phrase), `${shell} still contains "${phrase}" -- the sentence-case pass must hold everywhere`);
      }
    }
  }
  // Gate W2: the sweep's own sed-ordering bug left half-converted hybrids
  // ("Save Book folders") that the old-spelling-absent check can't see --
  // lock the CORRECT spellings present on the settings page.
  const setup = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'setup.html'), 'utf8');
  assert.ok(setup.includes('>Save book folders<'), 'setup.html must render "Save book folders"');
  assert.ok(setup.includes('>Save music folders<'), 'setup.html must render "Save music folders"');
  assert.ok(!/[>]Save (Book|Music) folders[<]/.test(setup), 'no half-converted hybrids');
  // Gate W3: the JS writer that repaints the converted heading must write
  // sentence case too.
  const mainJs = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'main.js'), 'utf8');
  assert.ok(mainJs.includes('Search results for'), 'the search heading writer uses sentence case');
  assert.ok(!mainJs.includes('Search Results for'), 'no Title Case search heading');
});
