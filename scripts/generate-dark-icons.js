#!/usr/bin/env node
'use strict';

// v1.91 (Dean: adaptive dark PWA icon) -- generate the DARK-mode home-screen
// icon with NO new dependency, reusing the repo's existing icon plumbing:
//   * decodePng   (scripts/strip-icon-background.js) -- the same decoder the
//                 v1.28.1 transparency work + pwa-icons tests use.
//   * buildPng    (scripts/generate-pwa-icons.js)    -- node:zlib RGBA encoder.
//
// WHY: apple-touch-icon.png is the glossy logo composited onto WHITE, opaque on
// purpose because iOS renders icon transparency as BLACK (v1.28.1). On a dark
// home screen that white field looks wrong. iOS 16.4+ honours a dark variant via
// `<link rel="apple-touch-icon" media="(prefers-color-scheme: dark)">`; older iOS
// keeps the light one. This composites the ALREADY-TRANSPARENT icon-192 onto the
// app's dark surface (#0f0f0f, the manifest background_color) so the dark variant
// is the same logo on a dark field instead of white -- opaque, iOS-safe.
//
// Run manually to (re)generate the committed asset:
//   node scripts/generate-dark-icons.js

const fs = require('fs');
const path = require('path');
const { decodePng } = require('./strip-icon-background');
const { buildPng } = require('./generate-pwa-icons');

const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');
// The app's dark surface -- the manifest's own background_color, so the dark
// icon matches the splash/theme rather than a bespoke value.
const DARK_BG = [0x0f, 0x0f, 0x0f];

// Alpha-composite a decoded RGBA image over an opaque background colour, so the
// result is fully opaque (iOS requirement) with the logo's transparent field
// filled by `bg` instead of white.
function compositeOntoOpaque(pngBuffer, bg) {
  const { width, height, rgba } = decodePng(pngBuffer);
  const out = Buffer.from(rgba); // copy -- never mutate the decoder's buffer
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3] / 255;
    out[i] = Math.round(out[i] * a + bg[0] * (1 - a));
    out[i + 1] = Math.round(out[i + 1] * a + bg[1] * (1 - a));
    out[i + 2] = Math.round(out[i + 2] * a + bg[2] * (1 - a));
    out[i + 3] = 255; // opaque
  }
  return buildPng(width, height, out);
}

function main() {
  const src = fs.readFileSync(path.join(ICONS_DIR, 'icon-192.png')); // the transparent logo
  const darkPng = compositeOntoOpaque(src, DARK_BG);
  const outPath = path.join(ICONS_DIR, 'apple-touch-icon-dark.png');
  fs.writeFileSync(outPath, darkPng);
  console.log(`Wrote ${outPath} (${darkPng.length} bytes)`);
}

module.exports = { compositeOntoOpaque, DARK_BG };

if (require.main === module) {
  main();
}
