'use strict';

// [UNIT] v1.53 - attribution client wiring locks. The picker/buttons are DOM
// thin-shells (no browser harness); these are comment-stripped,
// statement-anchored SOURCE LOCKS -- presence, not binding, honestly labeled
// (the v1.52 posture) -- so deleting a call site, not merely mentioning it,
// is what fails. Dean's device probes remain the behavior gate.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

function strippedSource(rel) {
  return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('LOCK (wiring): the watch page mounts the Attribute control, gated on the ONE unattributed predicate', () => {
  const src = strippedSource('public/js/watch.js');
  assert.match(src, /setupAttributeButton\(\);/, 'the initWatch call site was deleted');
  assert.match(src, /resolveFileChannelIdentity\(mediaData\) !== null/, 'the visibility gate must be the shared predicate, never resolveChannelName');
  assert.match(src, /\/api\/videos\/\$\{encodeURIComponent\(mediaId\)\}\/attribute-channel/, 'the attribute POST was deleted');
  assert.match(src, /window\.FileTube\.player\.close\(\);/, 'the move confirm must close the player before moving (the offerRelocation posture)');
  assert.match(src, /entry\.attributionConflict && entry\.attributionConflict\.kept/, 'the conflict toast branch was deleted (decision 3: the conflict must be NAMED)');
});

test('LOCK (wiring): the folder view mounts the bulk control with the order-band CSS', () => {
  const main = strippedSource('public/js/main.js');
  assert.match(main, /ensureAttributeFolderButton\(sectionActions\);/, 'the render call site was deleted');
  assert.match(main, /typeof it\.channelUrl !== 'string' \|\| it\.channelUrl === ''/, 'the unattributed predicate was changed');
  assert.match(main, /\/api\/videos\/attribute-channel-bulk/, 'the bulk POST was deleted');
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/style.css'), 'utf8');
  const idx = css.indexOf('.section-actions #attribute-folder-btn');
  assert.ok(idx !== -1, 'the order-band rule exists');
  assert.match(css.slice(idx, css.indexOf('}', idx)), /order: 12/, 'the v1.50.4 orphan-row lesson: an explicit order after repull’s 11');
});

test('LOCK (wiring): the shared picker exists once, in common.js, and both callers use it', () => {
  const common = strippedSource('public/js/common.js');
  assert.match(common, /function showAttributionPicker\(targets, opts, onPick\)/);
  const watch = strippedSource('public/js/watch.js');
  const main = strippedSource('public/js/main.js');
  assert.match(watch, /showAttributionPicker\(targets, \{ title: 'Attribute this video to' \}/);
  assert.match(main, /showAttributionPicker\(targets, \{ title: 'Attribute this folder to', showRelocate: true \}/);
});
