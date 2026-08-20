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
const STYLE_CSS = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'css', 'style.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ''); // comments stripped -- assert on RULES only

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

test('v1.160.1: the header is the shared iOS-style .md-hero block (icon tile + title + explainer)', () => {
  // Dean: Subscriptions lost the master-detail hero (title + explainer) in v1.156;
  // it now reuses the shared .md-hero styling as static markup (this page is not a
  // .md-root, so wireMasterDetail never touches it).
  const hero = /<div class="subs-head md-hero">[\s\S]*?<\/div>\s*<\/div>/.exec(SUBS_HTML);
  assert.ok(hero, 'the header is a .md-hero block');
  assert.match(hero[0], /<span class="md-tile md-tile--hero"><svg[\s\S]*?<\/svg><\/span>/, 'the hero icon tile (no data-md-* attr - the v1.156 drop lock)');
  assert.doesNotMatch(hero[0], /data-md-/, 'the hero carries NO data-md-* attrs (coloured via CSS instead)');
  assert.match(hero[0], /<div class="md-hero-text">\s*<h2>Subscriptions<\/h2>/, 'the title in .md-hero-text h2 (matches Stats/Settings)');
  assert.match(hero[0], /<p>[^<]*channels you follow[\s\S]*?<\/p>/, 'an explainer paragraph');
  // the old .subs-title h1 + its dead CSS are gone
  assert.doesNotMatch(SUBS_HTML, /class="subs-title"/, 'the old .subs-title element is gone');
  assert.doesNotMatch(STYLE_CSS, /\.subs-title\s*\{/, 'and its now-dead CSS rule is removed');
});

test('v1.160: Maintenance is a DEFAULT-COLLAPSED collapsible section, ids + status spans intact', () => {
  const activity = /id="sub-panel-activity"([\s\S]*)$/.exec(SUBS_HTML);
  const body = activity[0];
  // Maintenance is now a <details data-collapse-key="maintenance"> with NO `open`
  // (collapsed) - matching the history/failures sections; the old <div class="sub-maint">
  // + <h3> are gone.
  const maint = /<details[^>]*data-collapse-key="maintenance"[^>]*>[\s\S]*?<\/details>/.exec(body);
  assert.ok(maint, 'Maintenance is a collapsible <details data-collapse-key="maintenance">');
  assert.doesNotMatch(maint[0].match(/<details[^>]*>/)[0], /\bopen\b/, 'default COLLAPSED (no open attr)');
  assert.match(maint[0], /<summary[^>]*>Maintenance<\/summary>/, 'a summary, not an <h3>');
  // all 5 action ids + 4 status ids still live INSIDE the collapsible (wiring untouched)
  for (const id of ['sub-reheat-preview-btn', 'sub-reheat-btn', 'sub-refresh-avatars-btn', 'sub-reheat-subs-btn', 'sub-backfill-names-btn',
    'sub-reheat-status', 'sub-refresh-avatars-status', 'sub-reheat-subs-status', 'sub-backfill-names-status']) {
    assert.ok(maint[0].includes(`id="${id}"`), `Maintenance collapsible lost #${id}`);
  }
});

test('the static panels are hidden at rest: the [hidden] guard exists and out-specifies the display:flex base (gate WARNING 2)', () => {
  // The three panels reuse `.sub-sheet-backdrop` (position:fixed; display:flex).
  // If the guard is dropped, all three full-screen backdrops render STACKED over
  // the channel list on load -- the [hidden]-loses-to-display class this repo
  // has repeatedly paid for. jsdom can't measure the cascade, so bind the guard
  // by source: it must exist AND out-specify the flex base it has to beat.
  assert.match(STYLE_CSS, /\.sub-sheet-backdrop\s*\{[^}]*display:\s*flex/,
    'the .sub-sheet-backdrop display:flex base must exist (what the guard beats)');
  assert.match(STYLE_CSS, /\.sub-sheet-backdrop\.sub-panel\[hidden\]\s*\{[^}]*display:\s*none/,
    'the .sub-sheet-backdrop.sub-panel[hidden] { display:none } guard must exist -- else the panels render over the list on load');
});
