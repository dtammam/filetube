'use strict';

// [UNIT] scripts/ui-lint.js - the UI guardrail runner (UI professionalism pass, plan D10.1/D10.3).
//
// What this file binds (LESSONS 2: a guard is bound only if deleting it turns a test red):
//   1. every rule's canary pair fires exactly on the committed tree (`--canaries` exits 0);
//   2. MUTATION: each rule's detector, neutered in a copy of the real script, makes the runner
//      exit 2 naming that rule - all twelve, one by one; a missing fixture or a wrong
//      expect= also exits 2;
//   3. the modes' exit codes against a temp exceptions file: exact -> 0, new debt -> 1, paid
//      debt not shrunk -> 1, malformed -> 1, missing with --enforce -> 1, --write-baseline
//      refuses an existing file; the report mode on the real tree exits 0 and prints every rule;
//   4. each sub-check of the rules, in process, with EXACT counts and one axis varied at a time.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'ui-lint.js');
const L = require(SCRIPT);

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ui-lint-'));
function run(args, opts = {}) {
  const r = spawnSync(process.execPath, [opts.script || SCRIPT, ...args], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: path.join(REPO, 'node_modules') },
    timeout: 120000,
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const INFO = L.tokensInfo(REPO);
/** Run one rule over inline sources; returns Map(key -> count). */
function lint(ruleId, sources) {
  const rule = L.RULES.find((r) => r.id === ruleId);
  const model = L.buildModel(sources.map(([p, text]) => ({ path: p, text, kind: p.endsWith('.css') ? 'css' : p.endsWith('.html') ? 'html' : 'js' })), INFO);
  assert.deepStrictEqual(model.errors, [], 'the fixture parses');
  return L.runRule(rule, model).keys;
}
const total = (keys) => [...keys.values()].reduce((s, n) => s + n, 0);

// ---- 1. canaries -----------------------------------------------------------------------

test('every rule has a canary pair and --canaries exits 0 on the committed tree', () => {
  for (const r of L.RULES) {
    const dir = path.join(REPO, 'test/fixtures/ui-lint', r.id);
    const files = fs.readdirSync(dir);
    assert.ok(files.some((f) => f.startsWith('bad')), `${r.id} has a bad fixture`);
    assert.ok(files.some((f) => f.startsWith('good')), `${r.id} has a good fixture`);
  }
  assert.deepStrictEqual(L.runCanaries(REPO), []);
  const r = run(['--canaries']);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /canaries OK \(12 rules/);
});

test('the rule table is the twelve D10.1 rules, with no-legacy-tokens OFF until step 7', () => {
  assert.deepStrictEqual(L.RULE_IDS, ['no-raw-values', 'no-legacy-tokens', 'no-bespoke-controls', 'hover-gated', 'pressed-state',
    'native-interaction', 'icons', 'no-layout-transition', 'z-ladder', 'display-ownership', 'colour-roles', 'no-shell-style']);
  assert.deepStrictEqual(L.RULES.filter((r) => !r.on).map((r) => r.id), ['no-legacy-tokens']);
});

// ---- 2. mutation: a neutered detector must make the runner exit 2 ---------------------

test('MUTATION: neutering each rule\'s detector in turn makes --canaries exit 2 naming that rule', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const dir = tmpDir();
  const results = [];
  for (const rule of L.RULES) {
    const name = rule.detect.name;
    const sig = `function ${name}(model, report) {`;
    assert.strictEqual(src.split(sig).length - 1, 1, `${name} is declared exactly once`);
    const mutant = path.join(dir, `ui-lint-${rule.id}.js`);
    fs.writeFileSync(mutant, src.replace(sig, `${sig} return;`));
    const r = run(['--canaries', '--root', REPO], { script: mutant });
    results.push(`${rule.id}: exit ${r.code}`);
    assert.strictEqual(r.code, 2, `${rule.id}: a neutered detector must exit 2, got ${r.code}\n${r.out}\n${r.err}`);
    assert.match(r.err, new RegExp(`\\n  ${rule.id}: the bad canary produced 0 hit\\(s\\)`), `${rule.id} is named`);
    assert.doesNotMatch(r.err.replace(new RegExp(`  ${rule.id}:[^\\n]*`), ''), /the bad canary produced/, `only ${rule.id} fails`);
  }
  assert.strictEqual(results.length, 12);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('MUTATION: a missing fixture, a wrong expect= and a firing good fixture each exit 2', () => {
  const root = tmpDir();
  fs.mkdirSync(path.join(root, 'public/css'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'public/css/tokens.css'), path.join(root, 'public/css/tokens.css'));
  const fx = path.join(root, 'test/fixtures/ui-lint');
  fs.cpSync(path.join(REPO, 'test/fixtures/ui-lint'), fx, { recursive: true });
  assert.strictEqual(run(['--canaries', '--root', root]).code, 0, 'the copied tree is green first');

  fs.rmSync(path.join(fx, 'hover-gated/good.css'));
  let r = run(['--canaries', '--root', root]);
  assert.strictEqual(r.code, 2);
  assert.match(r.err, /hover-gated: missing canary fixture pair/);
  fs.copyFileSync(path.join(REPO, 'test/fixtures/ui-lint/hover-gated/good.css'), path.join(fx, 'hover-gated/good.css'));

  const bad = path.join(fx, 'z-ladder/bad.css');
  fs.writeFileSync(bad, fs.readFileSync(bad, 'utf8').replace('expect=5', 'expect=6'));
  r = run(['--canaries', '--root', root]);
  assert.strictEqual(r.code, 2);
  assert.match(r.err, /z-ladder: the bad canary produced 5 hit\(s\), expected exactly 6/);
  fs.copyFileSync(path.join(REPO, 'test/fixtures/ui-lint/z-ladder/bad.css'), bad);

  fs.appendFileSync(path.join(fx, 'colour-roles/good.css'), '.z:hover { color: var(--accent); }\n');
  r = run(['--canaries', '--root', root]);
  assert.strictEqual(r.code, 2);
  assert.match(r.err, /colour-roles: the good canary produced 1 hit\(s\), expected 0/);

  // --enforce and --write-baseline run the canaries first; report mode warns but exits 0
  assert.strictEqual(run(['--enforce', '--root', root]).code, 2);
  assert.strictEqual(run(['--write-baseline', '--root', root, '--exceptions', path.join(root, 'x.json')]).code, 2);
  assert.ok(!fs.existsSync(path.join(root, 'x.json')), 'a broken linter writes no baseline');
  fs.rmSync(root, { recursive: true, force: true });
});

// ---- 3. modes and exit codes against a temp exceptions file -----------------------------

test('modes: write-baseline, exact, new debt, paid debt, malformed, missing, refuse-existing', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'ui-exceptions.json');

  let r = run(['--enforce', '--exceptions', file]);
  assert.strictEqual(r.code, 1, 'missing file with --enforce');
  assert.match(r.err, /does not exist/);

  r = run(['--write-baseline', '--exceptions', file]);
  assert.strictEqual(r.code, 0, r.err);
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(L.validateExceptions(base), []);
  assert.ok(!('no-legacy-tokens' in base.rules), 'an OFF rule is not baselined');
  for (const [rule, entries] of Object.entries(base.rules)) {
    for (const e of entries) assert.doesNotMatch(e.key, /:\d+$|\|\d+\|/, `${rule} key carries no line number: ${e.key}`);
  }
  const baseText = fs.readFileSync(file, 'utf8');

  r = run(['--write-baseline', '--exceptions', file]);
  assert.strictEqual(r.code, 1, 'write-baseline refuses an existing file');
  assert.match(r.err, /REFUSED/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), baseText, 'and leaves it untouched');

  r = run(['--enforce', '--exceptions', file]);
  assert.strictEqual(r.code, 0, `exact baseline passes\n${r.err}`);
  assert.match(r.out, /no-raw-values\s+\d+/, 'the per-rule debt table prints');
  assert.match(r.out, /OK - the live debt equals/);

  const rule = Object.keys(base.rules).find((k) => base.rules[k].length);
  const newDebt = JSON.parse(baseText);
  const dropped = newDebt.rules[rule].shift();
  fs.writeFileSync(file, JSON.stringify(newDebt));
  r = run(['--enforce', '--exceptions', file]);
  assert.strictEqual(r.code, 1, 'a live key with no entry is new debt');
  assert.match(r.err, /NEW debt/);
  assert.ok(r.err.includes(dropped.key), 'the new key is named');

  const paid = JSON.parse(baseText);
  paid.rules[rule][0].count += 1;
  fs.writeFileSync(file, JSON.stringify(paid));
  r = run(['--enforce', '--exceptions', file]);
  assert.strictEqual(r.code, 1, 'an entry above the live count is paid debt not shrunk');
  assert.match(r.err, /PAID debt/);
  assert.match(r.err, /set count to|delete the entry/);

  fs.writeFileSync(file, '{ not json');
  r = run(['--enforce', '--exceptions', file]);
  assert.strictEqual(r.code, 1, 'invalid JSON');
  assert.match(r.err, /not valid JSON/);

  const shape = JSON.parse(baseText);
  shape.rules['no-such-rule'] = [];
  fs.writeFileSync(file, JSON.stringify(shape));
  r = run(['--enforce', '--exceptions', file]);
  assert.strictEqual(r.code, 1, 'an unknown rule is malformed');
  assert.match(r.err, /malformed/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--shrink: lowers paid entries and deletes zeroes, refuses (writing nothing) on new debt, then --enforce passes', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'ui-exceptions.json');
  let r = run(['--write-baseline', '--exceptions', file]);
  assert.strictEqual(r.code, 0, r.err);
  const baseText = fs.readFileSync(file, 'utf8');
  const base = JSON.parse(baseText);
  const rule = Object.keys(base.rules).find((k) => base.rules[k].length >= 2);

  // paid debt: one entry raised by 2 (so the live count is below it), plus a key that no longer exists
  const paid = JSON.parse(baseText);
  paid.rules[rule][0].count += 2;
  paid.rules[rule].push({ key: 'gone.css|.long-deleted|color', count: 3, reason: 'test', added: '2026-09-27' });
  fs.writeFileSync(file, JSON.stringify(paid, null, 2) + '\n');
  r = run(['--shrink', '--exceptions', file]);
  assert.strictEqual(r.code, 0, r.err);
  assert.match(r.out, /shrank .* 2 key\(s\), 5 item\(s\) of debt paid/);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), base, 'back to exactly the live debt');
  assert.strictEqual(run(['--enforce', '--exceptions', file]).code, 0);
  r = run(['--shrink', '--exceptions', file]);
  assert.match(r.out, /nothing to shrink/);

  // new debt: shrink refuses and the file is untouched, even with paid debt beside it
  const mixed = JSON.parse(baseText);
  mixed.rules[rule].shift();
  mixed.rules[rule][0].count += 1;
  const mixedText = JSON.stringify(mixed, null, 2) + '\n';
  fs.writeFileSync(file, mixedText);
  r = run(['--shrink', '--exceptions', file]);
  assert.strictEqual(r.code, 1);
  assert.match(r.err, /SHRINK REFUSED/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), mixedText, 'nothing written');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('report mode on the real tree exits 0 and prints every rule\'s debt', () => {
  const r = run([]);
  assert.strictEqual(r.code, 0, r.err);
  for (const id of L.RULE_IDS) assert.match(r.out, new RegExp(`\\n  ${id}\\s+(\\d+|OFF)`), `${id} row`);
  assert.match(r.out, /TOTAL\s+\d+/);
  assert.doesNotMatch(r.err, /CANARY FAILURE|parse problems/);
});

test('validateExceptions: each malformed shape is named', () => {
  const ok = { comment: 'c', rules: { 'hover-gated': [{ key: 'a|b', count: 1, reason: 'r', added: '2026-09-27' }] } };
  assert.deepStrictEqual(L.validateExceptions(ok), []);
  const bad = (mut, re) => { const d = JSON.parse(JSON.stringify(ok)); mut(d); assert.match(L.validateExceptions(d).join('\n'), re); };
  bad((d) => { delete d.comment; }, /comment/);
  bad((d) => { d.extra = 1; }, /unknown top-level field/);
  bad((d) => { d.rules = []; }, /"rules" must be an object/);
  bad((d) => { d.rules.nope = []; }, /unknown rule "nope"/);
  bad((d) => { d.rules['hover-gated'][0].count = 0; }, /count must be a positive integer/);
  bad((d) => { d.rules['hover-gated'][0].count = 1.5; }, /count must be a positive integer/);
  bad((d) => { d.rules['hover-gated'][0].reason = ' '; }, /reason/);
  bad((d) => { d.rules['hover-gated'][0].added = 'yesterday'; }, /added/);
  bad((d) => { d.rules['hover-gated'].push({ ...d.rules['hover-gated'][0] }); }, /duplicated/);
  bad((d) => { d.rules['hover-gated'][0].line = 3; }, /unknown field "line"/);
  assert.match(L.validateExceptions(null).join(), /not a JSON object/);
});

test('compareDebt: over and under are both reported, OFF rules are ignored', () => {
  const results = {};
  for (const id of L.RULE_IDS) results[id] = { keys: new Map() };
  results['hover-gated'].keys.set('k1', 2).set('k2', 1);
  results['no-legacy-tokens'].keys.set('legacy', 9);
  const data = { rules: { 'hover-gated': [{ key: 'k1', count: 2 }, { key: 'k3', count: 1 }] } };
  const { over, under } = L.compareDebt(results, data);
  assert.deepStrictEqual(over, [{ rule: 'hover-gated', key: 'k2', live: 1, allowed: 0 }]);
  assert.deepStrictEqual(under, [{ rule: 'hover-gated', key: 'k3', live: 0, allowed: 1 }]);
});

// ---- 4. the sub-checks, in process, exact counts ----------------------------------------

test('no-raw-values: the classifier, one category per fixture', () => {
  const c = (p, v) => L.classifyValue(p, v, INFO.ladder);
  assert.deepStrictEqual(c('color', '#fff'), ['colour']);
  assert.deepStrictEqual(c('background', 'rgba(0,0,0,.5)'), ['colour']);
  assert.deepStrictEqual(c('color', 'white'), ['colour']);
  assert.deepStrictEqual(c('font-family', 'Tan Sans'), [], 'a named colour only counts in a colour property');
  assert.deepStrictEqual(c('width', '10px'), ['size']);
  assert.deepStrictEqual(c('min-height', '2em'), ['size']);
  assert.deepStrictEqual(c('width', '10vw'), []);
  assert.deepStrictEqual(c('height', '100dvh'), []);
  assert.deepStrictEqual(c('width', 'calc(100% - var(--inset))'), []);
  assert.deepStrictEqual(c('width', 'clamp(var(--a), 50%, var(--b))'), []);
  assert.deepStrictEqual(c('width', 'min(100%, 600px)'), ['size']);
  assert.deepStrictEqual(c('border', '1px solid var(--separator)'), ['size']);
  assert.deepStrictEqual(c('border', '1px solid #ccc'), ['colour', 'size']);
  assert.deepStrictEqual(c('border-radius', '4px'), ['radius']);
  assert.deepStrictEqual(c('border-radius', '50%'), []);
  assert.deepStrictEqual(c('border-radius', 'calc(var(--r-md) - 2px)'), [], 'the radius trim idiom');
  assert.deepStrictEqual(c('font-size', '13px'), ['size']);
  assert.deepStrictEqual(c('font-size', 'var(--t-body-size)'), []);
  assert.deepStrictEqual(c('font', '600 15px/20px Geist'), ['font']);
  assert.deepStrictEqual(c('font', 'var(--t-body)'), []);
  assert.deepStrictEqual(c('font-weight', 'bold'), ['weight']);
  assert.deepStrictEqual(c('font-weight', '600'), ['weight']);
  assert.deepStrictEqual(c('font-weight', 'normal'), []);
  assert.deepStrictEqual(c('line-height', '1.4'), ['line-height']);
  assert.deepStrictEqual(c('line-height', 'normal'), []);
  assert.deepStrictEqual(c('box-shadow', '0 2px 4px var(--c)'), ['shadow']);
  assert.deepStrictEqual(c('box-shadow', 'var(--shadow-overlay)'), []);
  assert.deepStrictEqual(c('z-index', '10'), ['z-index']);
  assert.deepStrictEqual(c('z-index', 'calc(var(--z-modal) + 1)'), []);
  assert.deepStrictEqual(c('z-index', 'calc(var(--z-hack) + 1)'), ['z-index'], 'only ladder names make the idiom');
  assert.deepStrictEqual(c('transition', 'opacity .2s'), ['duration']);
  assert.deepStrictEqual(c('animation-duration', '300ms'), ['duration']);
  assert.deepStrictEqual(c('transition', 'opacity var(--dur-fade) cubic-bezier(.2,0,0,1)'), ['easing']);
  assert.deepStrictEqual(c('transition-timing-function', 'ease-out'), ['easing']);
  assert.deepStrictEqual(c('animation', 'spin var(--dur-spin) linear infinite'), []);
  assert.deepStrictEqual(c('color', 'var(--x, #c00)'), ['colour'], 'a var() fallback paints');
  assert.deepStrictEqual(c('padding-bottom', 'env(safe-area-inset-bottom, 0px)'), []);
  assert.deepStrictEqual(c('padding-bottom', 'env(safe-area-inset-bottom, 12px)'), ['size']);
  assert.deepStrictEqual(c('background', 'url("x.svg#abc")'), []);
  assert.deepStrictEqual(c('--local', '12px'), ['size']);
  assert.deepStrictEqual(c('transform', 'translateY(4px)'), [], 'positional art is not governed');
});

test('no-raw-values: tokens.css definitions and token-exempt lines are exempt; keyframes are not', () => {
  assert.strictEqual(total(lint('no-raw-values', [['public/css/tokens.css', ':root { --a: 12px; }\n.x { width: 12px; }']])), 1, 'only the non-definition');
  assert.strictEqual(total(lint('no-raw-values', [['public/css/style.css', ':root { --a: 12px; }']])), 1, 'a definition outside tokens.css counts');
  assert.strictEqual(total(lint('no-raw-values', [['public/css/style.css', '.x {\n  width: 12px; /* token-exempt: why */\n  height: 12px;\n}']])), 1);
  assert.strictEqual(total(lint('no-raw-values', [['public/css/style.css', '@keyframes k { from { color: #fff; } }']])), 1);
  assert.strictEqual(total(lint('no-raw-values', [['public/css/style.css', '@font-face { font-family: X; font-weight: 100 900; }']])), 0);
  assert.strictEqual(total(lint('no-raw-values', [['public/css/style.css', '[data-theme="2009"] .x { color: #fff; }']])), 1, 'era-scoped rules are no longer blind (#103)');
  const js = lint('no-raw-values', [['public/js/a.js', "el.style.width = '10px';\nel.style.width = '10px'; // token-exempt: ok\nel.style.width = n + 'px';\n"]]);
  assert.deepStrictEqual([...js], [['public/js/a.js|js-style|width', 1]]);
});

test('keys are file|selector|property (or a class), never a line number, and count repeats', () => {
  const keys = lint('no-raw-values', [['public/css/style.css', '.a { width: 1px; }\n\n\n@media (max-width: 9px) { .a { width: 2px; } }']]);
  assert.deepStrictEqual([...keys], [['public/css/style.css|.a|width', 2]]);
});

// UI pass S7 (D7): the Pocket takeover's device-class scope replaced a @media wrapper, and at-rule
// preludes were never part of a key - so the scope is not either (the same rule keeps its key, in
// every part of a selector list). Only that exact scope: any other :where() stays in the key.
test('keys drop the Pocket device-class scope exactly (it replaced an @media prelude), and nothing else', () => {
  const S = ':where(html.is-phone, html.mms-popout) ';
  const keys = lint('no-raw-values', [['public/css/style.css', S + '.m .x { width: 1px; }\n' + S + '.a, ' + S + '.b { height: 2px; }\n:where(html.is-phone) .m .x { width: 3px; }']]);
  assert.deepStrictEqual([...keys].sort(), [
    ['public/css/style.css|.a, .b|height', 1],
    ['public/css/style.css|.m .x|width', 1],
    ['public/css/style.css|:where(html.is-phone) .m .x|width', 1],
  ]);
});

test('no-legacy-tokens: tokens.css\'s alias and legacy names are read from the file', () => {
  for (const n of ['--bg-color', '--text-primary', '--border-color', '--yt-red', '--text-link', '--btn-bg', '--star-gold', '--radius-lg', '--shadow-lg', '--scrim-legacy']) {
    assert.ok(INFO.legacy.has(n), `${n} is legacy`);
  }
  for (const n of ['--surface-0', '--ink-1', '--accent', '--btn-fill', '--btn-radius', '--r-md', '--sticky-bar-top']) assert.ok(!INFO.legacy.has(n), `${n} is not legacy`);
  assert.deepStrictEqual(INFO.ladder, ['--z-nav', '--z-chip', '--z-dock', '--z-header', '--z-player-max', '--z-sheet', '--z-panel', '--z-modal', '--z-top']);
  assert.strictEqual(total(lint('no-legacy-tokens', [['public/css/style.css', '.a { color: var(--fs-md); b: var(--ink-1); }']])), 1);
});

test('no-bespoke-controls: subject, suffix, button, role and cursor axes', () => {
  const k = (css) => [...lint('no-bespoke-controls', [['public/css/style.css', css]]).keys()];
  assert.deepStrictEqual(k('.card-download-btn { color: red; }'), ['.card-download-btn']);
  assert.deepStrictEqual(k('.btn { color: red; }'), ['.btn']);
  assert.deepStrictEqual(k('.sub-row .title { color: red; }'), [], 'only the SUBJECT compound counts');
  assert.deepStrictEqual(k('.row-title { color: red; }'), [], 'a suffix, not a prefix');
  assert.deepStrictEqual(k('.x > button:not(.y) { color: red; }'), ['public/css/style.css|.x > button:not(.y)']);
  assert.deepStrictEqual(k("[role='button'] { color: red; }"), ["public/css/style.css|[role='button']"]);
  assert.deepStrictEqual(k('.link { cursor: pointer; }'), ['.link']);
  assert.deepStrictEqual(k('.link { cursor: default; }'), []);
  assert.deepStrictEqual(k('.ui-btn.card-btn, .ui-row { cursor: pointer; }'), []);
  assert.deepStrictEqual(k('.a-menu:hover, .b-thumb { color: red; }'), ['.a-menu', '.b-thumb'], 'one per selector in the list');
  const js = lint('no-bespoke-controls', [['public/js/a.js', "const b = document.createElement('button');\nb.className = 'x';\nconst c = document.createElement('button');\nc.setAttribute('class', 'ui-btn');\nel.innerHTML = '<button class=\"btn\" type=button>';\n"]]);
  assert.deepStrictEqual([...js].sort(), [['public/js/a.js|<button>|btn', 1], ['public/js/a.js|createElement(button)|b', 1]]);
});

test('hover-gated: only @media (hover: hover) gates a :hover rule', () => {
  assert.strictEqual(total(lint('hover-gated', [['public/css/style.css', '.a:hover{} @media (hover:hover){.b:hover{}} @media (any-hover: hover){.c:hover{}} @media (hover: none){.d:hover{}} .e:not(:hover){}']])), 3, '.a, .d and .e (a :not(:hover) rule still depends on hover)');
});

test('pressed-state: an interactive ui-* class needs its own :active or [data-pressed] rule', () => {
  assert.deepStrictEqual([...lint('pressed-state', [['public/css/ui.css', '.ui-a{cursor:pointer} .ui-b{cursor:pointer} .ui-b:active{} .ui-c{cursor:pointer} .ui-cc:active{}']]).keys()], ['.ui-a', '.ui-c']);
});

test('native-interaction: the D6 base rules, each missing alone, are named', () => {
  const D6 = {
    html: 'html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }',
    body: 'body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }',
    drag: 'img, a, video, svg { -webkit-user-drag: none; user-drag: none; }',
    input: 'input, textarea, select, [contenteditable="true"], [contenteditable=""] { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }',
  };
  const all = Object.values(D6).join('\n');
  assert.strictEqual(total(lint('native-interaction', [['public/css/ui.css', all]])), 0);
  const missing = { html: 'd6:html-text-size-adjust', body: 'd6:body', drag: 'd6:no-drag', input: 'd6:field-reenable' };
  for (const part of Object.keys(D6)) {
    const css = Object.entries(D6).filter(([k]) => k !== part).map(([, v]) => v).join('\n');
    assert.deepStrictEqual([...lint('native-interaction', [['public/css/ui.css', css]]).keys()], [`public/css/ui.css|${missing[part]}`], part);
  }
  // the body rule missing ONE declaration is not the base rule (its four UA props then count too)
  const weakBody = all.replace(' touch-action: manipulation;', '');
  assert.ok(lint('native-interaction', [['public/css/ui.css', weakBody]]).has('public/css/ui.css|d6:body'));
  // the base rules must be in ui.css, not style.css
  assert.ok(lint('native-interaction', [['public/css/style.css', all]]).has('public/css/ui.css|d6:body'));
  // order: a later user-select rule (style.css comes after ui.css) breaks "the input rule is last"
  const later = lint('native-interaction', [['public/css/ui.css', all], ['public/css/style.css', '.x { user-select: none; }']]);
  assert.deepStrictEqual([...later.keys()].sort(), ['public/css/style.css|.x|user-select', 'public/css/ui.css|d6:field-reenable-not-last']);
  const earlier = lint('native-interaction', [['public/css/tokens.css', '.x { user-select: none; }'], ['public/css/ui.css', all]]);
  assert.deepStrictEqual([...earlier.keys()], ['public/css/tokens.css|.x|user-select'], 'tokens.css precedes ui.css in the cascade');
  const sel = lint('native-interaction', [['public/css/ui.css', all + '\n.ui-selectable { user-select: text; }']]);
  assert.deepStrictEqual([...sel.keys()], ['public/css/ui.css|d6:field-reenable-not-last'], 'ui-selectable is allowed, but not after the input rule');
});

test('native-interaction: contextmenu, ui-selectable allow-list and viewport meta', () => {
  const base = [['public/css/ui.css', fs.readFileSync(path.join(REPO, 'test/fixtures/ui-lint/native-interaction/good.css'), 'utf8')]];
  const keys = lint('native-interaction', base.concat([
    ['public/js/interaction.js', "el.addEventListener('contextmenu', f);"],
    ['public/js/main.js', "el.addEventListener('contextmenu', f);\nel.removeEventListener('contextmenu', f);"],
    ['public/js/player.js', "o.className = 'ui-selectable';"],
    ['public/js/music.js', "o.className = 'ui-selectable';"],
    ['public/read.html', '<meta name="viewport" content="width=device-width, maximum-scale=1, user-scalable=no">'],
    ['public/tv.html', '<meta name="viewport" content="width=device-width, maximum-scale=1">'],
  ]));
  assert.deepStrictEqual([...keys.keys()].sort(), ['public/js/main.js|contextmenu', 'public/js/music.js|ui-selectable', 'public/tv.html|meta-viewport']);
});

test('icons: sprite references pass, drawn svgs and glyphs (any spelling) do not, skin files are exempt', () => {
  const keys = lint('icons', [
    ['public/index.html', '<svg class="ui-icon"><use href="#i-home"/></svg>\n<svg><path d="M0"/></svg>\n<b>&#x2715; &rsaquo; ✓</b>'],
    ['public/js/a.js', "a = '\\u25B6';\nb = `<svg><use href=\"#i-${n}\"/></svg>`;\nc = '<svg>' + p + '</svg>';"],
    ['public/js/skin-surface.js', "a = '<svg><path/></svg> ★';"],
    ['public/js/icons.js', "a = '<svg><symbol id=\"i-x\"><path/></symbol></svg>';"],
  ]);
  assert.deepStrictEqual([...keys].sort(), [
    ['public/index.html|<svg>', 1], ['public/index.html|glyph|U+203A', 1], ['public/index.html|glyph|U+2713', 1], ['public/index.html|glyph|U+2715', 1],
    ['public/js/a.js|<svg>', 1], ['public/js/a.js|glyph|U+25B6', 1],
  ]);
});

test('no-layout-transition: the named and the implied property of each item', () => {
  assert.deepStrictEqual(L.transitionProps('transition', 'opacity .2s, width .3s ease'), ['opacity', 'width']);
  assert.deepStrictEqual(L.transitionProps('transition', '.2s'), ['all']);
  assert.deepStrictEqual(L.transitionProps('transition', 'var(--a) var(--b)'), [null]);
  assert.deepStrictEqual(L.transitionProps('transition', 'none'), []);
  assert.deepStrictEqual(L.transitionProps('transition-property', 'transform, grid-template-rows'), ['transform', 'grid-template-rows']);
});

test('z-ladder, display-ownership, colour-roles, no-shell-style: one axis each', () => {
  assert.strictEqual(total(lint('z-ladder', [['public/css/style.css', '.a{position:fixed;z-index:var(--z-top)} .b{position:-webkit-sticky;z-index:3} .c-scrim{z-index:calc(var(--z-modal) - 1)} .d{z-index:3}']])), 1);
  assert.strictEqual(total(lint('display-ownership', [['public/css/ui.css', '[hidden]{display:none!important} .x[hidden]{display:none!important}'], ['public/js/a.js', 'el.style.display = x;']])), 2);
  assert.strictEqual(total(lint('colour-roles', [['public/css/ui.css', '.ui-btn--primary:active{background:var(--accent-fill)} .ui-btn--primary:active{color:var(--accent-fill)} .x.selected{color:var(--accent)}']])), 2);
  assert.strictEqual(total(lint('no-shell-style', [['public/diag.html', '<style>a{}</style>'], ['public/a.html', '<!-- <style> -->']])), 1, 'diag.html is listed in the exceptions file, not hard-coded');
});

test('JS is read through tokens: comments never count, template literals read whole', () => {
  const keys = lint('no-bespoke-controls', [['public/js/a.js', "// '<button class=\"x\">'\n/* document.createElement('button') */\nh = `<button class=\"${c}\">`;\n"]]);
  assert.deepStrictEqual([...keys], [['public/js/a.js|<button>|${}', 1]]);
});
