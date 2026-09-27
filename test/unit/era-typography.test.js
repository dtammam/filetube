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

// UI pass step 1 (DELIBERATE lock update): the era token blocks moved to tokens.css. The
// family knobs are --font-ui / --font-heading (plan D2.5); --font-family and
// --heading-font are aliases of them in tokens.css's alias block. 2021 light is the
// :root safe-default block, which every era inherits roles from ONLY by omission -
// and every era block now writes every knob (ui-era-roles), so none inherits Geist.
const stylesheets = require('../helpers/stylesheets');
function eraBlock(era) {
  const block = stylesheets.eraBlock(era);
  assert.ok(block !== null, `expected the [data-theme="${era}"] token block`);
  return block;
}

test('2014 Flat is Arial, not Roboto (era-accurate: pre-Polymer YouTube desktop was Arial)', () => {
  const block = eraBlock('2014');
  assert.match(block, /--font-ui:\s*Arial, Helvetica, sans-serif/);
  assert.doesNotMatch(block, /--font-ui:[^;]*Roboto/, 'Roboto in 2014 reads as "2017 wearing a 2014 layout"');
});

test('v1.107: 2021 Modern is GEIST across all elements (body + logo + headings), medium weight, slight negative tracking', () => {
  const block = eraBlock('2021');
  assert.match(block, /--font-ui:\s*'Geist',\s*'Roboto'/, 'body: Geist first, Roboto the bundled fallback');
  assert.match(block, /--logo-font:\s*'Geist'/, 'logo: Geist too (one font across all elements)');
  assert.match(block, /--font-heading:\s*'Geist',\s*'Roboto'/, 'headings: Geist (replaces the old YouTube-Sans-first stack)');
  assert.doesNotMatch(block, /YouTube Sans/, 'the proprietary YouTube Sans heading face is gone - Geist is bundled');
  assert.match(block, /--heading-weight:\s*500/, 'Modern titles stay medium, not bold');
  assert.match(block, /--heading-tracking:\s*-0\.01em/);
});

test('every era defines --heading-weight; non-2021 eras stay bold/normal (byte-identical look to pre-v1.50.2)', () => {
  for (const era of ['2005', '2009', '2014']) {
    const block = eraBlock(era);
    assert.match(block, /--heading-weight:\s*bold/, `${era} headings stay bold`);
    assert.match(block, /--heading-tracking:\s*normal/, `${era} tracking unchanged`);
  }
});

test('gate C1 lock: every non-2021 era sets its heading family to its OWN body stack (never inherits Modern Geist), and the old names alias the knobs', () => {
  for (const era of ['2005', '2009', '2014']) {
    const block = eraBlock(era);
    const ui = /--font-ui:\s*([^;]*)/.exec(block);
    const heading = /--font-heading:\s*([^;]*)/.exec(block);
    assert.ok(ui && heading, `${era} must define both family knobs`);
    assert.equal(heading[1].trim(), ui[1].trim(), `${era} headings use its own body stack`);
    assert.doesNotMatch(heading[1], /Roboto|YouTube Sans|Geist/, `${era} heading font must name neither Roboto, YouTube Sans nor Geist`);
  }
  const css = stylesheets.readTokensCss();
  assert.match(css, /--heading-font:\s*var\(--font-heading\);/, 'the legacy --heading-font aliases the knob');
  assert.match(css, /--font-family:\s*var\(--font-ui\);/, 'the legacy --font-family aliases the knob');
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

test('v1.107: the Modern face (Geist) is a self-hosted VARIABLE font (100-900), so weight 500 is genuine not synthesized', () => {
  // Geist @font-face named FIRST (v1262-pwa-chrome resolves the shells' preload
  // off the first @font-face src, so it must be Geist).
  assert.match(css, /@font-face\s*\{[^}]*font-family:\s*'Geist'[^}]*font-weight:\s*100 900[^}]*url\('\/fonts\/geist\.woff2'\)/,
    'Geist is a self-hosted variable woff2 (100-900)');
  const firstFace = /@font-face\s*\{[^}]*url\('([^']+)'\)/.exec(css);
  assert.equal(firstFace[1], '/fonts/geist.woff2', 'Geist @font-face is FIRST (the shells preload it)');
  // Roboto survives as the bundled fallback, also variable.
  assert.match(css, /@font-face\s*\{[^}]*font-family:\s*'Roboto'[^}]*font-weight:\s*100 900/, 'Roboto stays bundled as the variable fallback');
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
