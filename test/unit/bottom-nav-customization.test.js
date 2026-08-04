'use strict';

// [UNIT] v1.44 T12 — resolveBottomNavLayout (common.js): the pure order+hide
// decision behind the customizable bottom bar. Optional items reorder/hide per
// the config; a config entry for a NOT-present item is inert (the module gate
// wins). v1.71 adds the DEFAULT-HIDDEN class (podcasts): present in the DOM but
// invisible until the config's `shown` list opts it in.
//
// v1.75 retires the two hard-bound anchors: `home` and `settings` are ordinary
// roster entries (sortable, hidable) and `liked` joins as a new default-hidden
// one. The v1.44/v1.71 tests below are kept verbatim wherever the contract is
// unchanged and rewritten (with a v1.75 note) exactly where it moved - a test
// left asserting the retired anchors would be asserting a ghost.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  resolveBottomNavLayout,
  BOTTOM_NAV_DEFAULT_HIDDEN,
  BOTTOM_NAV_OPTIONAL,
  BOTTOM_NAV_COMPAT_HEAD,
  BOTTOM_NAV_COMPAT_TAIL,
} = require('../../public/js/common.js');

// A v1.44-era shell's present ids. NOTE the spelling: `oneoff-download` before
// `subscriptions`. The original fixture had them the other way round, an order
// no real shell has ever produced - both are injected with
// insertAdjacentElement('afterend') on the Settings item, so their DOM order is
// a race (adversarial gate W1). Since ids the config does not name now rank by
// the ROSTER rather than by DOM position, the fixture is spelled the way the
// roster reads; the tests below assert that resolved order, not an input order.
const ALL = ['home', 'playlists', 'history', 'theme', 'oneoff-download', 'subscriptions', 'settings'];

test('T12: default config resolves to roster order, home first + settings last', () => {
  const out = resolveBottomNavLayout(ALL, {});
  assert.deepEqual(out.visible, ALL);
  assert.deepEqual(out.hiddenPresent, []);
});

test('v1.75: hidden optionals are dropped from visible - and home/settings now honour a hide like any other entry (ruling R2)', () => {
  // Pre-v1.75 this asserted the opposite ("home/settings ignore a hide
  // request"); retiring the anchors is the wave's point, so the assertion is
  // rewritten rather than deleted - the hide path still has to be bound.
  const out = resolveBottomNavLayout(ALL, { hidden: ['subscriptions', 'home', 'settings'] });
  assert.deepEqual(out.visible, ['playlists', 'history', 'theme', 'oneoff-download'], 'home + settings hide like any other entry');
  assert.deepEqual(out.hiddenPresent.slice().sort(), ['home', 'settings', 'subscriptions'], 'all three report as present-and-hidden');
});

test('T12: order reorders the optional middle; unlisted optionals keep their default order after', () => {
  const out = resolveBottomNavLayout(ALL, { order: ['theme', 'oneoff-download'] });
  assert.deepEqual(out.visible, ['home', 'theme', 'oneoff-download', 'playlists', 'history', 'subscriptions', 'settings']);
});

test('T12: order + hide compose', () => {
  const out = resolveBottomNavLayout(ALL, { order: ['oneoff-download', 'subscriptions', 'playlists', 'theme'], hidden: ['theme'] });
  assert.deepEqual(out.visible, ['home', 'oneoff-download', 'subscriptions', 'playlists', 'history', 'settings']);
});

test('T12: a config entry for a NOT-present item is inert (module gate wins)', () => {
  // subscriptions + download not present (modules disabled); config references them.
  const present = ['home', 'playlists', 'theme', 'settings'];
  const out = resolveBottomNavLayout(present, { order: ['subscriptions', 'theme', 'oneoff-download', 'playlists'], hidden: ['subscriptions'] });
  assert.deepEqual(out.visible, ['home', 'theme', 'playlists', 'settings'], 'absent items neither appear nor break ordering');
});

test('T12: missing home or settings anchors are simply omitted (never fabricated)', () => {
  const out = resolveBottomNavLayout(['playlists', 'theme'], {});
  assert.deepEqual(out.visible, ['playlists', 'theme']);
});

test('T12: junk config is tolerated (treated as empty)', () => {
  assert.deepEqual(resolveBottomNavLayout(ALL, null).visible, ALL);
  assert.deepEqual(resolveBottomNavLayout(ALL, { hidden: 'x', order: 5 }).visible, ALL);
  assert.deepEqual(resolveBottomNavLayout(null, {}).visible, []);
});

// ---- v1.71: the default-hidden class ----------------------------------------

const WITH_PODCASTS = ['home', 'playlists', 'history', 'podcasts', 'theme', 'settings'];

test('v1.71/v1.72/v1.75: the roster names podcasts + music + books + downloads + liked default-hidden', () => {
  // v1.72 (cap 2): music + books + downloads joined with the same opt-in
  // posture; v1.75 (ruling R3) adds liked.
  assert.deepEqual(BOTTOM_NAV_DEFAULT_HIDDEN, ['podcasts', 'music', 'books', 'downloads', 'liked']);
});

test('v1.71: a present default-hidden item is INVISIBLE with an empty config and with every pre-v1.71 config shape', () => {
  for (const cfg of [{}, null, { hidden: [], order: [] }, { hidden: ['theme'], order: ['history'] }]) {
    const out = resolveBottomNavLayout(WITH_PODCASTS, cfg);
    assert.ok(out.visible.indexOf('podcasts') === -1, `podcasts stays off for config ${JSON.stringify(cfg)}`);
    assert.ok(out.hiddenPresent.indexOf('podcasts') >= 0, 'but reports as present-and-hidden (hiddenPresent has no production consumer today - this binds the resolver\'s contract, gate S6)');
  }
});

test('v1.71: shown opts a default-hidden item in; hidden still beats shown; other items ignore shown', () => {
  const out = resolveBottomNavLayout(WITH_PODCASTS, { shown: ['podcasts'] });
  assert.deepEqual(out.visible, WITH_PODCASTS, 'opted in at its DOM position');
  const both = resolveBottomNavLayout(WITH_PODCASTS, { shown: ['podcasts'], hidden: ['podcasts'] });
  assert.ok(both.visible.indexOf('podcasts') === -1, 'an explicit hide wins over shown');
  const noise = resolveBottomNavLayout(WITH_PODCASTS, { shown: ['theme', 'nonsense'] });
  assert.ok(noise.visible.indexOf('podcasts') === -1, 'shown for OTHER ids never leaks visibility to podcasts');
  assert.ok(noise.visible.indexOf('theme') >= 0, 'a shown entry for a normal item is harmless');
});

test('v1.71: an opted-in podcasts item reorders like any optional', () => {
  const out = resolveBottomNavLayout(WITH_PODCASTS, { shown: ['podcasts'], order: ['podcasts', 'theme'] });
  assert.deepEqual(out.visible, ['home', 'podcasts', 'theme', 'playlists', 'history', 'settings']);
});

// ---- v1.75: the roster, the compat matrix, the floor ------------------------

// The ids a v1.75 shell actually mounts, in DOM order. `subscriptions` and
// `oneoff-download` are INJECTED after Settings (common.js's two injectors both
// anchor on [data-nav="settings"]), which is why they trail here: this list is
// what querySelectorAll('.bottom-nav-item') hands applyBottomNavCustomization.
const SHELL_V175 = ['home', 'liked', 'playlists', 'history', 'podcasts', 'music', 'books', 'downloads', 'theme', 'settings', 'oneoff-download', 'subscriptions'];
// The same shell one release earlier - byte-identical minus the new `liked`
// item. The compat oracle below renders THIS with the v1.74 algorithm.
const SHELL_V174 = SHELL_V175.filter((id) => id !== 'liked');

test('v1.75: the roster is the 12 sortable ids, and home/settings are now IN it', () => {
  assert.equal(BOTTOM_NAV_OPTIONAL.length, 12, 'nine optionals + home + settings + liked');
  for (const id of ['home', 'settings', 'liked']) {
    assert.ok(BOTTOM_NAV_OPTIONAL.indexOf(id) >= 0, `${id} joined the sortable roster`);
  }
  // Every id a shell mounts must be in the roster, or the Settings editor can
  // never reach it (the enumerate-by-grep lesson, bound instead of trusted).
  for (const id of SHELL_V175) {
    assert.ok(BOTTOM_NAV_OPTIONAL.indexOf(id) >= 0, `${id} is missing from BOTTOM_NAV_OPTIONAL`);
  }
  assert.equal(BOTTOM_NAV_OPTIONAL.length, new Set(BOTTOM_NAV_OPTIONAL).size, 'no duplicate ids');
});

// The v1.74 resolver, transcribed verbatim as an ORACLE. The compat claim of
// this wave is not "the new code looks right" but "it renders what the old code
// rendered", so the old code is the thing to compare against - a hand-written
// expected list would just re-encode my own belief about v1.74's output.
function resolveV174(presentIds, config) {
  const FIXED_FIRST = 'home';
  const FIXED_LAST = 'settings';
  const DEFAULT_HIDDEN = ['podcasts', 'music', 'books', 'downloads'];
  const present = Array.isArray(presentIds) ? presentIds.slice() : [];
  const cfg = (config && typeof config === 'object') ? config : {};
  const hidden = new Set(Array.isArray(cfg.hidden) ? cfg.hidden : []);
  const shown = new Set(Array.isArray(cfg.shown) ? cfg.shown : []);
  const order = Array.isArray(cfg.order) ? cfg.order : [];
  const isHidden = (id) => hidden.has(id) || (DEFAULT_HIDDEN.indexOf(id) >= 0 && !shown.has(id));
  const middle = present.filter((id) => id !== FIXED_FIRST && id !== FIXED_LAST);
  const seen = new Set();
  const ordered = [];
  order.forEach((id) => { if (middle.indexOf(id) >= 0 && !seen.has(id)) { ordered.push(id); seen.add(id); } });
  middle.forEach((id) => { if (!seen.has(id)) { ordered.push(id); seen.add(id); } });
  const visible = [];
  if (present.indexOf(FIXED_FIRST) >= 0) visible.push(FIXED_FIRST);
  ordered.forEach((id) => { if (!isHidden(id)) visible.push(id); });
  if (present.indexOf(FIXED_LAST) >= 0) visible.push(FIXED_LAST);
  return visible;
}

// Every config shape a device can be carrying into the upgrade. None of them
// can name home/settings in `order` (nothing could write those ids before
// v1.75) and none of them can mention `liked` (it did not exist).
const PRE_V175_CONFIGS = [
  ['a device that never opened Settings', null],
  ['an empty config object', {}],
  ['a pre-v1.71 config (no shown key at all)', { hidden: ['history'], order: ['theme', 'playlists'] }],
  ['a pre-v1.71 config that hid nothing', { hidden: [], order: [] }],
  ['a v1.71 config opting podcasts in', { hidden: [], order: [], shown: ['podcasts'] }],
  ['a v1.72 config opting music + books in', { hidden: ['history'], order: ['music', 'theme', 'playlists'], shown: ['music', 'books'] }],
  ['a v1.74-era full reorder of the nine optionals', { hidden: ['subscriptions'], order: ['downloads', 'theme', 'history', 'playlists', 'music', 'books', 'podcasts', 'oneoff-download'], shown: ['downloads'] }],
  ['a config naming ids whose modules are off', { hidden: ['subscriptions', 'oneoff-download'], order: ['subscriptions', 'theme'], shown: [] }],
];

test('v1.75 COMPAT: an untouched device keeps identical bar MEMBERSHIP and opt-in state, for every pre-v1.75 config shape', () => {
  // Deliberately not titled "the IDENTICAL bar": D2-bis records that ORDER
  // does change where the deleted CSS ladder had been overriding the resolver.
  // What this binds is the part that did NOT change - which ids are on the bar
  // and which are opted in. (It happens to bind order too, for these fixtures:
  // the shells' DOM order and the roster coincide, so resolveV174's DOM-order
  // ranking and the new roster ranking agree. That is why scrambling the
  // roster fails this test as well as the W3 one.)
  for (const [label, cfg] of PRE_V175_CONFIGS) {
    const after = resolveBottomNavLayout(SHELL_V175, cfg).visible;
    const before = resolveV174(SHELL_V174, cfg);
    assert.deepEqual(after, before, `${label}: the bar's membership changed under the user`);
    assert.ok(after.indexOf('liked') === -1, `${label}: the new Liked entry must stay off until opted in`);
  }
});

test('v1.75 COMPAT: the head/tail fallbacks are what hold that identity (each one alone is load-bearing)', () => {
  // Named ids, not string literals - a rename must not silently pass.
  assert.equal(BOTTOM_NAV_COMPAT_HEAD, 'home');
  assert.equal(BOTTOM_NAV_COMPAT_TAIL, 'settings');
  // An order that omits both: home is FIRST and settings is LAST even though
  // the config's own sequence would otherwise put `theme` first. Drop the head
  // fallback and home slides behind theme; drop the tail fallback and settings
  // slides ahead of the unlisted items. Both are asserted positionally.
  const out = resolveBottomNavLayout(SHELL_V175, { order: ['theme', 'history'], shown: [] }).visible;
  assert.equal(out[0], 'home', 'head fallback: an order that never names home keeps it first');
  assert.equal(out[out.length - 1], 'settings', 'tail fallback: an order that never names settings keeps it last');
  assert.equal(out[1], 'theme', 'and the config order still drives everything between them');
});

test('v1.75: once the order NAMES home/settings, the fallbacks release - Home is no longer left-most bound', () => {
  // This is Dean's headline ask ("Home is not always left-most bound"): the
  // Settings editor writes the full roster on any reorder, and from then on the
  // config is the whole truth.
  const order = ['theme', 'settings', 'history', 'playlists', 'home'];
  const out = resolveBottomNavLayout(SHELL_V175, { order, shown: [] }).visible;
  assert.deepEqual(out, ['theme', 'settings', 'history', 'playlists', 'home', 'oneoff-download', 'subscriptions'],
    'the named ids sort exactly as configured; unlisted present ids trail in DOM order');
  assert.equal(out[0], 'theme', 'home is NOT first');
  assert.notEqual(out[out.length - 1], 'settings', 'settings is NOT last');
});

test('v1.75: naming only ONE of the two releases only that one (a half-migrated config keeps the other pin)', () => {
  const outHead = resolveBottomNavLayout(SHELL_V175, { order: ['history', 'home', 'theme'] }).visible;
  assert.equal(outHead[0], 'history', 'home named -> home moves');
  assert.equal(outHead[outHead.length - 1], 'settings', 'settings unnamed -> still pinned last');
  const outTail = resolveBottomNavLayout(SHELL_V175, { order: ['settings', 'theme'] }).visible;
  assert.equal(outTail[0], 'home', 'home unnamed -> still pinned first');
  assert.equal(outTail[1], 'settings', 'settings named -> moves right behind the pinned home');
});

test('v1.75: the opted-in Liked entry appears at its DOM position and reorders like any other', () => {
  const shownOnly = resolveBottomNavLayout(SHELL_V175, { shown: ['liked'] }).visible;
  assert.deepEqual(shownOnly, ['home', 'liked', 'playlists', 'history', 'theme', 'oneoff-download', 'subscriptions', 'settings'],
    'liked rides second, right after home, with the rest of the bar untouched');
  const moved = resolveBottomNavLayout(SHELL_V175, { shown: ['liked'], order: ['home', 'theme', 'liked', 'playlists', 'history', 'settings'] }).visible;
  assert.deepEqual(moved, ['home', 'theme', 'liked', 'playlists', 'history', 'settings', 'oneoff-download', 'subscriptions']);
  const hiddenAgain = resolveBottomNavLayout(SHELL_V175, { shown: ['liked'], hidden: ['liked'] }).visible;
  assert.ok(hiddenAgain.indexOf('liked') === -1, 'an explicit hide still beats shown');
});

test('v1.75: a post-v1.75 config exercising all three new ids at once', () => {
  const cfg = {
    order: ['liked', 'settings', 'history', 'home', 'theme', 'playlists', 'music'],
    hidden: ['playlists'],
    shown: ['liked', 'music'],
  };
  const out = resolveBottomNavLayout(SHELL_V175, cfg);
  assert.deepEqual(out.visible, ['liked', 'settings', 'history', 'home', 'theme', 'music', 'oneoff-download', 'subscriptions'],
    'all three new ids sort, hide and opt in exactly like the nine that came before');
  assert.deepEqual(out.hiddenPresent, ['playlists', 'podcasts', 'books', 'downloads'], 'hidden = explicit hides plus the un-opted default-hidden ids, in resolved order');
  assert.equal(out.flooredToDefault, false, 'a legal config never trips the floor');
});

test('v1.75 SEQUENCE: visible + hiddenPresent interleave into one row order the Settings editor can render', () => {
  const cfg = { order: ['theme', 'liked', 'history'], hidden: ['playlists'], shown: ['liked'] };
  const out = resolveBottomNavLayout(SHELL_V175, cfg);
  assert.deepEqual(out.sequence, ['home', 'theme', 'liked', 'history', 'playlists', 'podcasts', 'music', 'books', 'downloads', 'oneoff-download', 'subscriptions', 'settings']);
  // The contract the editor depends on: sequence is exactly visible + hidden,
  // and every visible id keeps its relative order inside it.
  assert.deepEqual(out.sequence.filter((id) => out.visible.indexOf(id) >= 0), out.visible);
  assert.deepEqual(out.sequence.filter((id) => out.hiddenPresent.indexOf(id) >= 0), out.hiddenPresent);
  assert.equal(out.sequence.length, out.visible.length + out.hiddenPresent.length);
});

// ---- v1.75 adversarial gate W1: the resolved order is a pure function of the
// ---- CONFIG, not of the DOM order it is handed ------------------------------

test('W1: the two async injectors race, and the resolved bar must not', () => {
  // Both nav injectors do insertAdjacentElement('afterend') on the Settings
  // item, so whichever capability probe resolves LAST lands FIRST. Deleting the
  // v1.39.2 CSS ladder removed the pin that used to hide this, so Download and
  // Subs swapped between page loads until ids were ranked by the roster.
  const base = ['home', 'liked', 'playlists', 'history', 'podcasts', 'music', 'books', 'downloads', 'theme', 'settings'];
  const subsFirst = base.concat(['subscriptions', 'oneoff-download']);
  const downloadFirst = base.concat(['oneoff-download', 'subscriptions']);
  for (const cfg of [{}, { shown: ['music', 'liked'] }, { order: ['theme', 'history'] }, { hidden: ['playlists'] }]) {
    assert.deepEqual(
      resolveBottomNavLayout(subsFirst, cfg).visible,
      resolveBottomNavLayout(downloadFirst, cfg).visible,
      `injection order leaked into the bar for config ${JSON.stringify(cfg)}`,
    );
  }
  // And the outcome is the roster's order, not either race winner's.
  const out = resolveBottomNavLayout(subsFirst, {}).visible;
  assert.ok(out.indexOf('oneoff-download') < out.indexOf('subscriptions'), 'Download precedes Subs, deterministically');
});

test('W1: applying twice is idempotent - a resolution fed its own output re-resolves identically', () => {
  // applyBottomNavCustomization re-appends the visible items, so the NEXT call
  // reads a DOM whose order is the previous call's output with the hidden items
  // stranded in front. Every apply must still land on the same bar, or ticking
  // an item in Settings puts it somewhere a reload will not reproduce.
  const present = ['home', 'liked', 'playlists', 'history', 'podcasts', 'music', 'books', 'downloads', 'theme', 'settings', 'oneoff-download', 'subscriptions'];
  for (const cfg of [{}, { shown: ['music'] }, { shown: ['liked', 'books'], order: ['theme'] }, { hidden: ['home'] }]) {
    const first = resolveBottomNavLayout(present, cfg);
    const mutatedDom = present.filter((id) => first.visible.indexOf(id) < 0).concat(first.visible);
    const second = resolveBottomNavLayout(mutatedDom, cfg);
    assert.deepEqual(second.visible, first.visible, `re-apply drifted for config ${JSON.stringify(cfg)}`);
    assert.deepEqual(second.sequence, first.sequence, 'and the panel would have drifted with it');
  }
});

test('W1: an id absent from the roster still resolves, after every known id, in DOM order', () => {
  const present = ['home', 'zzz-unknown', 'playlists', 'aaa-unknown', 'settings'];
  const out = resolveBottomNavLayout(present, {}).visible;
  assert.deepEqual(out, ['home', 'playlists', 'zzz-unknown', 'aaa-unknown', 'settings'],
    'unknown ids never sort to the front by scoring -1, and keep their relative DOM order');
});

// ---- v1.75 (QA W3 / adversarial S1): the roster's ORDER is what the Settings
// ---- panel renders and what the first move-button tap persists --------------

test('W3: BOTTOM_NAV_OPTIONAL IS the default bar - derived from the shells, never typed here', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const pub = path.join(__dirname, '../../public');
  const shells = fs.readdirSync(pub).filter((f) => f.endsWith('.html'))
    .filter((f) => fs.readFileSync(path.join(pub, f), 'utf8').includes('class="bottom-nav'));
  assert.ok(shells.length >= 9, `expected the full shell roster, found ${shells.length}`);
  // Every shell must mount the SAME ids in the SAME order, or "the roster is
  // the default bar" is not even a well-formed claim.
  const perShell = shells.map((f) => (fs.readFileSync(path.join(pub, f), 'utf8')
    .match(/data-nav="[a-z-]+"/g) || []).map((m) => m.slice(10, -1)));
  for (let i = 1; i < perShell.length; i += 1) {
    assert.deepEqual(perShell[i], perShell[0], `${shells[i]} mounts a different bar than ${shells[0]}`);
  }
  // The two injected ids are not in any shell's HTML; both land after Settings.
  const present = perShell[0].concat(['oneoff-download', 'subscriptions']);
  // Compare the roster against the SHELLS directly. Going through the resolver
  // alone would be tautological now that it RANKS by this roster - the sequence
  // follows any scramble of it (gate round 2, S2 measured exactly that). The
  // one adjustment: `settings` is mounted mid-markup but resolves to the tail,
  // so it moves to the end here before the comparison.
  assert.deepEqual(
    perShell[0].filter((id) => id !== 'settings').concat(['oneoff-download', 'subscriptions', 'settings']),
    BOTTOM_NAV_OPTIONAL,
    'the roster must be spelled in the order the shells mount the bar - it is what the Settings panel '
    + 'lists and what the bar opens in, so a roster that drifts from the markup silently reorders both',
  );
  assert.deepEqual(
    resolveBottomNavLayout(present, {}).sequence,
    BOTTOM_NAV_OPTIONAL,
    'the roster must equal the default resolved bar. Since the gate-round-1 fix both surfaces RANK by '
    + 'this roster, so they cannot disagree with each other - what a failure here means is that the '
    + 'roster has drifted from the shells, i.e. the bar no longer opens in the order its markup reads',
  );
});

test('v1.75 FLOOR: a hand-edited config that hides EVERY entry renders the default bar instead of an empty strip', () => {
  const cfg = { hidden: SHELL_V175.slice(), order: [], shown: [] };
  const out = resolveBottomNavLayout(SHELL_V175, cfg);
  assert.ok(out.visible.length > 0, 'the bar is never left empty while items exist');
  assert.deepEqual(out.visible, resolveBottomNavLayout(SHELL_V175, {}).visible, 'and what renders is exactly the DEFAULT layout');
  assert.equal(out.flooredToDefault, true, 'the floor reports that it fired (the Settings editor reads this to refuse the last un-check)');
});

test('v1.75 FLOOR: hiding all but one does NOT trip it (the floor is >=1 visible, not >=2)', () => {
  const cfg = { hidden: SHELL_V175.filter((id) => id !== 'theme'), order: [], shown: [] };
  const out = resolveBottomNavLayout(SHELL_V175, cfg);
  assert.deepEqual(out.visible, ['theme'], 'one survivor is a legal bar');
  assert.equal(out.flooredToDefault, false);
});

test('v1.75 FLOOR: it never FABRICATES a bar - a shell whose every present id is default-hidden still renders nothing', () => {
  // The v1.71 posture: a surface carrying only opt-in items shows an empty bar
  // until Settings opts one in. The floor must not "helpfully" reveal them.
  const out = resolveBottomNavLayout(['podcasts', 'music', 'liked'], {});
  assert.deepEqual(out.visible, []);
  assert.equal(out.flooredToDefault, false, 'nothing was overridden - there was simply nothing opted in');
  assert.deepEqual(resolveBottomNavLayout([], { hidden: ['home'] }).visible, [], 'and an empty shell stays empty');
});
