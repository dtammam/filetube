// v1.156 (T3): the Subscriptions pills toolbar + slide-in panels replaced the
// master-detail menu. The panel open/close controller is closure-internal (no
// mount harness), so these bind the STRUCTURAL contract the controller relies
// on: every pill points at a real panel, every panel is a hidden .sub-sheet
// overlay with a back button, and the relocated content (forms, maintenance,
// history/failures mount points) is where the wiring expects it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SUBS_HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html'),
  'utf8',
);

test('every data-sub-panel pill points at a real #sub-panel-<key> that exists', () => {
  const keys = [...SUBS_HTML.matchAll(/data-sub-panel="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual([...keys].sort(), ['activity', 'add', 'oneoff'], 'exactly the three panel-opening pills');
  for (const key of keys) {
    assert.ok(SUBS_HTML.includes(`id="sub-panel-${key}"`), `pill "${key}" has no matching #sub-panel-${key}`);
  }
});

test('Check all is an ACTION pill, not a panel opener (keeps #sub-repull-all-btn, no data-sub-panel)', () => {
  const btn = /<button[^>]*id="sub-repull-all-btn"[^>]*>/.exec(SUBS_HTML);
  assert.ok(btn, 'the Check all pill must exist');
  assert.ok(!/data-sub-panel=/.test(btn[0]), 'Check all triggers the re-pull action directly, it does not open a panel');
  assert.match(btn[0], /class="[^"]*sub-pill/, 'Check all is styled as a pill');
});

test('each slide-in panel is a hidden .sub-sheet overlay with a back button', () => {
  for (const key of ['add', 'oneoff', 'activity']) {
    const re = new RegExp(`<div class="sub-sheet-backdrop sub-panel" id="sub-panel-${key}"([^>]*)>([\\s\\S]*?)<div class="sub-sheet-body">`);
    const m = re.exec(SUBS_HTML);
    assert.ok(m, `#sub-panel-${key} must be a .sub-sheet-backdrop.sub-panel`);
    assert.match(m[1], /\bhidden\b/, `#sub-panel-${key} must start hidden`);
    assert.match(m[2], /class="sub-sheet"/, `#sub-panel-${key} must wrap a .sub-sheet`);
    assert.match(m[2], /data-sub-panel-close/, `#sub-panel-${key} must have a back/close control`);
  }
});

test('the Add and One-off forms kept every id inside their panels', () => {
  const addPanel = /id="sub-panel-add"[\s\S]*?id="sub-panel-oneoff"/.exec(SUBS_HTML);
  assert.ok(addPanel, 'add panel region');
  for (const id of ['sub-add-url', 'sub-add-format', 'sub-add-btn', 'sub-members-only-check', 'sub-add-skipshorts']) {
    assert.ok(addPanel[0].includes(`id="${id}"`), `add panel lost #${id}`);
  }
  const oneoffPanel = /id="sub-panel-oneoff"[\s\S]*?id="sub-panel-activity"/.exec(SUBS_HTML);
  assert.ok(oneoffPanel, 'one-off panel region');
  for (const id of ['oneshot-url', 'oneshot-download-btn', 'oneshot-list-container']) {
    assert.ok(oneoffPanel[0].includes(`id="${id}"`), `one-off panel lost #${id}`);
  }
});

test('the Activity panel holds the history/failures mount points + all 5 maintenance controls', () => {
  const activity = /id="sub-panel-activity"[\s\S]*?<\/div><!-- \/\.subs-root -->/.exec(SUBS_HTML)
    || /id="sub-panel-activity"([\s\S]*)$/.exec(SUBS_HTML);
  assert.ok(activity, 'activity panel region');
  const body = activity[0];
  assert.ok(body.includes('id="sub-activity-history"'), 'history mount point');
  assert.ok(body.includes('id="sub-activity-failures"'), 'failures mount point');
  for (const id of ['sub-reheat-preview-btn', 'sub-reheat-btn', 'sub-refresh-avatars-btn', 'sub-reheat-subs-btn', 'sub-backfill-names-btn']) {
    assert.ok(body.includes(`id="${id}"`), `Activity panel lost the maintenance control #${id}`);
  }
});
