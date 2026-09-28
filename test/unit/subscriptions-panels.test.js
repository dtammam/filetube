// v1.156 (T3) -> UI pass S5: the Subscriptions toolbar opens its panels as ui.sheets.
// The panel CONTENT stays static in the view (a `.subs-panel` in the hidden
// `.subs-panels` holder) so every id is wired once at init; the controller moves a
// panel into a ui.sheet body on open and back into the holder on close (bound
// behaviourally by subscriptions-panels-behavior.test.js). These bind the
// STRUCTURAL contract that controller relies on: every toolbar button points at a
// real panel, the panels sit hidden inside #view-root, and the relocated content
// (forms, maintenance, history/failures mount points) is where the wiring expects it.
//
// Converted in UI pass S5 (AC12): the old `.sub-sheet-backdrop.sub-panel[hidden]`
// guard lock is replaced by ui.css's ONE global [hidden] rule (ui-css-contract /
// touch-eating-overlay-audit) plus the holder assertion below.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SUBS_HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html'),
  'utf8',
);
const STYLE_CSS = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'css', 'style.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ''); // comments stripped -- assert on RULES only
const UI_CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'css', 'ui.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

test('every data-sub-panel button points at a real #sub-panel-<key> that exists', () => {
  const keys = [...SUBS_HTML.matchAll(/data-sub-panel="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual([...keys].sort(), ['activity', 'add', 'oneoff'], 'exactly the three panel-opening buttons');
  for (const key of keys) {
    assert.ok(SUBS_HTML.includes(`id="sub-panel-${key}"`), `button "${key}" has no matching #sub-panel-${key}`);
  }
});

test('the toolbar speaks ONE button language: tonal ui-btn controls and exactly one primary (Add)', () => {
  const bar = /<div class="subs-toolbar"[^>]*>([\s\S]*?)<\/div>/.exec(SUBS_HTML);
  assert.ok(bar, 'the .subs-toolbar exists');
  const buttons = [...bar[1].matchAll(/<button([^>]*)>/g)].map((m) => m[1]);
  assert.strictEqual(buttons.length, 4, 'Check all, Activity, One-off, Add');
  for (const b of buttons) assert.match(b, /class="ui-btn ui-btn--(tonal|primary) ui-btn--sm"/, `a toolbar button is not a tonal/primary sm ui-btn: ${b}`);
  const primaries = buttons.filter((b) => /ui-btn--primary/.test(b));
  assert.strictEqual(primaries.length, 1, 'ONE primary per surface');
  assert.match(primaries[0], /data-sub-panel="add"/, 'the primary is Add');
});

test('Check all is an ACTION button, not a panel opener (keeps #sub-repull-all-btn, no data-sub-panel)', () => {
  const btn = /<button[^>]*id="sub-repull-all-btn"[^>]*>/.exec(SUBS_HTML);
  assert.ok(btn, 'the Check all button must exist');
  assert.ok(!/data-sub-panel=/.test(btn[0]), 'Check all triggers the re-pull action directly, it does not open a panel');
  assert.match(btn[0], /class="ui-btn ui-btn--tonal ui-btn--sm"/, 'Check all is a tonal ui-btn');
});

test('each panel is a .subs-panel with a sheet title, inside the ONE hidden holder in #view-root', () => {
  const holder = /<div class="subs-panels" hidden>([\s\S]*)<\/div><!-- \/\.subs-root -->/.exec(SUBS_HTML);
  assert.ok(holder, 'the panels live in a hidden .subs-panels holder inside .subs-root');
  const viewRoot = SUBS_HTML.indexOf('<div id="view-root"');
  assert.ok(viewRoot !== -1 && SUBS_HTML.indexOf('<div class="subs-panels" hidden>') > viewRoot, 'inside #view-root (the SPA swap mounts it)');
  for (const [key, title] of [['add', 'Add a subscription'], ['oneoff', 'One-off download'], ['activity', 'Activity']]) {
    assert.match(holder[1], new RegExp(`<div class="subs-panel" id="sub-panel-${key}" data-title="${title}">`), `#sub-panel-${key}`);
  }
  // no bespoke overlay chrome is left: the sheet, scrim, Close and Esc are ui.sheet's
  assert.doesNotMatch(SUBS_HTML, /sub-sheet|data-sub-panel-close/, 'no .sub-sheet overlay or back button markup remains');
  // the holder is hidden by the ONE global [hidden] rule (ui.css), which beats any display
  assert.match(UI_CSS, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/, 'ui.css keeps the global [hidden] rule');
  assert.doesNotMatch(STYLE_CSS, /\.subs-panels\s*\{[^}]*display/, 'no author display rule on the holder');
});

test('the Add and One-off forms kept every id inside their panels', () => {
  const addPanel = /id="sub-panel-add"[\s\S]*?id="sub-panel-oneoff"/.exec(SUBS_HTML);
  assert.ok(addPanel, 'add panel region');
  for (const id of ['sub-add-url', 'sub-add-format', 'sub-add-quality', 'sub-add-filetype', 'sub-add-cutoffdate',
    'sub-add-minduration', 'sub-add-maxduration', 'sub-add-btn', 'sub-add-error', 'sub-members-only-check', 'sub-add-skipshorts']) {
    assert.ok(addPanel[0].includes(`id="${id}"`), `add panel lost #${id}`);
  }
  const oneoffPanel = /id="sub-panel-oneoff"[\s\S]*?id="sub-panel-activity"/.exec(SUBS_HTML);
  assert.ok(oneoffPanel, 'one-off panel region');
  for (const id of ['oneshot-url', 'oneshot-format', 'oneshot-quality', 'oneshot-filetype', 'oneshot-folder',
    'oneshot-download-btn', 'oneshot-error', 'oneshot-status', 'oneshot-list-container']) {
    assert.ok(oneoffPanel[0].includes(`id="${id}"`), `one-off panel lost #${id}`);
  }
});

test('the forms are ui-field / ui-select / ui-switch markup with no inline style (D4.10)', () => {
  const panels = /<div class="subs-panels" hidden>([\s\S]*)<\/div><!-- \/\.subs-root -->/.exec(SUBS_HTML)[1];
  assert.doesNotMatch(panels, /\sstyle="/, 'no inline style attribute in any panel');
  for (const id of ['sub-add-url', 'sub-add-cutoffdate', 'sub-add-minduration', 'sub-add-maxduration', 'oneshot-url', 'oneshot-folder']) {
    assert.match(panels, new RegExp(`<input class="ui-field__input"[^>]*id="${id}"`), `#${id} is a ui-field input`);
    assert.match(panels, new RegExp(`<label class="ui-field__label" for="${id}">`), `#${id} has its label`);
  }
  for (const id of ['sub-add-format', 'sub-add-quality', 'sub-add-filetype', 'oneshot-format', 'oneshot-quality', 'oneshot-filetype']) {
    assert.match(panels, new RegExp(`<span class="ui-select"><select class="ui-select__native" id="${id}">`), `#${id} is a ui-select`);
  }
  for (const id of ['sub-add-skipshorts', 'sub-members-only-check']) {
    assert.match(panels, new RegExp(`<button class="ui-switch" type="button" role="switch" aria-checked="false" id="${id}"`), `#${id} is a ui-switch, off at rest`);
  }
});

test('the Activity panel holds the segmented host, the history/failures mount points + all 5 maintenance controls', () => {
  const activity = /id="sub-panel-activity"[\s\S]*?id="reloc-preview-panel"/.exec(SUBS_HTML);
  assert.ok(activity, 'activity panel region');
  const body = activity[0];
  assert.ok(body.includes('id="sub-activity-tabs"'), 'the segmented control host');
  assert.match(body, /data-activity-pane="history" id="sub-activity-history">/, 'history pane (shown first)');
  assert.match(body, /data-activity-pane="failures" id="sub-activity-failures" hidden>/, 'failures pane (hidden at rest)');
  assert.match(body, /data-activity-pane="maintenance" id="sub-activity-maintenance" hidden>/, 'maintenance pane (hidden at rest)');
  for (const id of ['sub-reheat-preview-btn', 'sub-reheat-btn', 'sub-refresh-avatars-btn', 'sub-reheat-subs-btn', 'sub-backfill-names-btn',
    'sub-reheat-status', 'sub-refresh-avatars-status', 'sub-reheat-subs-status', 'sub-backfill-names-status']) {
    assert.ok(body.includes(`id="${id}"`), `Activity panel lost #${id}`);
  }
});

test('v1.160.1: the header is the shared iOS-style .md-hero block (icon tile + title + explainer); its glyph is the sprite', () => {
  const hero = /<div class="subs-head md-hero">[\s\S]*?<\/div>\s*<\/div>/.exec(SUBS_HTML);
  assert.ok(hero, 'the header is a .md-hero block');
  assert.match(hero[0], /<span class="md-tile md-tile--hero"><svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#i-subscriptions"\/><\/svg><\/span>/,
    'the hero icon tile draws the registry glyph (no inline path, no data-md-* attr)');
  assert.doesNotMatch(hero[0], /data-md-/, 'the hero carries NO data-md-* attrs (coloured via CSS instead)');
  assert.match(hero[0], /<div class="md-hero-text">\s*<h2>Subscriptions<\/h2>/, 'the title in .md-hero-text h2 (matches Stats/Settings)');
  assert.match(hero[0], /<p>[^<]*channels you follow[\s\S]*?<\/p>/, 'an explainer paragraph');
  assert.match(STYLE_CSS, /\.subs-head \.md-tile--hero\s*\{\s*background:\s*var\(--md-graphite\);/, 'the tile colour comes from style.css');
});
