---
plan: ipod-trueup
harness: v2 · lean
branch: feat/ipod-trueup
anchor: spec
status: Building
next: Dean says go; then Step 0 (read this whole plan once, top to bottom, before touching anything)
gate: pending
---

# iPod skin true-up: 27 new colorways, real model names, Extras by line and generation

Written 2026-09-29 by the v1.344.2 session (Opus) for a **Sonnet** builder in a fresh session. Every
decision below is already made by Dean; every color, id, name and CSS value is already computed and
proven. **Your job is to apply and wire, not to design.** If anything here does not match the code you
find, STOP and ask Dean (AskUserQuestion). Never invent a color, id, name, label, or token.

## 0. Rules for the builder (read first, follow exactly)

1. Read `AGENTS.md`, then `docs/LESSONS.md` sections 2, 3, 4 and 5, then this plan to the end.
2. **Environment, every shell:** `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
3. **Worktree:** `git -C /home/coder/projects/filetube fetch origin && git -C /home/coder/projects/filetube worktree add .claude/worktrees/ipod-trueup -b feat/ipod-trueup origin/main`,
   then work ONLY in that directory. Before any commit: `ln -s /home/coder/projects/filetube/node_modules node_modules`
   (never stage it; `rm node_modules` when the branch is done).
4. **Git:** stage files BY NAME (never `git add -A` or `.`), commit with `git commit -F <file>`, never
   `--no-verify`, never force-push, never pipe a commit or push. Long pushes: prefix
   `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=60"` and run in the background.
5. **Do not touch:** the Original skin (`ipod-original`: its registry entry stays byte-identical, its CSS
   and look stay as they are), Cider (`apple`), Nordic (`spotify`), any skin id (ids are saved on users'
   devices: renaming one loses their pick), the render functions, `skin-surface.js` beyond the two lines
   named in Step 3, and the 21 existing role blocks other than Gold.
6. **Do not re-derive** the colors or re-run `payload/gen-skins.py`. The payload is the source of truth.
7. **Report failures verbatim** with counts. A test you change must still fail when the code is wrong
   (LESSONS 2): after changing a test, break the code on purpose once, watch it fail, restore.
8. **Stop and ask Dean** (AskUserQuestion) if: an anchor in Step 2 does not match; a test fails for a
   reason not listed here; a step's expected output differs; you want to change anything in section 2.

## 1. Acceptance (what "done" means; every item is measured in Step 6)

- **AC1** The registry has 52 entries: Cider, Nordic, 49 line colorways (22 existing, relabeled; 27 new)
  and Original. `clickColorways().length === 50`. No existing id is renamed or removed.
- **AC2** Every line colorway's label is `<Line> <n>G <Color> (<year>)` exactly as in `payload/table.md`.
- **AC3** Extras > Skins (the Pocket menu) reads, in order: `Original`, `Classic`, `Mini`, `Nano`,
  `Shuffle`, `Cider`, `Nordic`. A line opens its generations (`4G (2004)` ...), a generation opens its
  colors (`Orange`, or `Black (2007)` when two colors in that generation share a name). Checks, the
  live preview, Select and MENU behave exactly as today at every level.
- **AC4** Settings > Music skin shows one group per generation (heading `Nano 4G (2008)`), plus Original,
  Cider and Nordic; a line colorway's tile name is its color (the same text as its menu row).
- **AC5** The Gold skin (`ipod-gold`) is the real Mini 1G Gold (2004): champagne body, the grey Mini 1G
  wheel, grey lettering and grey center, like its Mini 1G siblings.
- **AC6** `npm run lint:ui` passes (the live debt equals `docs/ui-exceptions.json`) and the ratchet test
  passes: the only keys added are skin-palette keys, admitted by the Step 1 exemption.
- **AC7** Full `npm test` on Node 22.23.1 AND 24.20.0: 0 failures (the known critter-mode load flake is
  re-run alone, never skipped); `npx eslint .` 0 errors; `node scripts/overlay-containment-lint.js --enforce` clean.
- **AC8** Dean has seen the real Settings grid screenshot (Step 5) before the gate.

## 2. Decisions (all Dean's, 2026-09-29; do not reopen)

| ID | Decision |
|---|---|
| D1 | Source: nanochromatic.com's reference cards (5 lines, 21 generations, one body hex per colorway; extracted verbatim in `payload/site-cards.json`). |
| D2 | Scope: every line, drawn on the click-wheel body. Near-duplicate colors dropped: a card is dropped when its hex is within CIE76 dE < 10 of a colorway already kept; priority Classic, Mini, Nano, Shuffle, Touch; existing skins kept first. Result: 27 new. Touch adds none (every Touch color equals a Nano 7G color). The Classic 5G U2 (2006) was dropped by hand: on the body it is the same skin as the 4G one (Encore). |
| D3 | Names: `<Line> <n>G <Color> (<year>)`, e.g. `Nano 4G Orange (2008)`. `PRODUCT(RED)` is `Red`; the U2 edition is `Special Edition` (never the band's name, Dean's standing rule); the Avon gold is `Gold`. |
| D4 | Extras: line > generation > color. Top level order: Original, Classic, Mini, Nano, Shuffle, Cider, Nordic. |
| D5 | Wheel style follows the real device (Dean: "some colorways have the same color text on the wheel as the skin (reminiscent of the mini) and some without. It's great"): existing colorways keep theirs; new ones use one of three styles, fixed per row in `payload/table.md`: **nano-white** (white wheel, grey lettering, body-colored center), **dark** (dark wheel, light lettering, body-colored center: Nano 6G's black front, Nano 7G Slate and Space Gray), **tonal** (a wheel one shade lighter than the body, pale lettering, a darker center: the Shuffle's body-colored control ring). |
| D6 | Gold: retune `ipod-gold` (id kept) to the real Mini 1G Gold (#e2d6a3) with the Mini 1G wheel (Click (Sky)'s wheel tokens). Its old antique-gold look is retired. |
| D7 | The UI lint ratchet gets a narrow skin-art exemption (Step 1): D10.4 made skin palettes a permanent carve-out, but the ratchet test rejects any added key. |
| D8 | Release: v1.345.0 (a feature: minor). |

## 3. The data (already computed; `payload/`)

| File | What it is | Used in |
|---|---|---|
| `table.md` | All 49 line colorways in display order: id, full label, line, gen, gen year, color, site hex, status (KEEP / RETUNE / NEW), wheel style. The single human-readable reference. | Steps 2-4, tests |
| `registry.js` | The complete replacement `var SKINS = [ ... ];` block (52 entries, with the new fields `line`, `gen`, `year`, `color`). | Step 2 |
| `roles-new.css` | The 27 new CSS role blocks, one per new id, in the existing blocks' exact format. | Step 2 |
| `role-gold.css` | The replacement role block for `.mms-ipod-gold` (D6). | Step 2 |
| `ui-exceptions-add.json` | The 329 `no-raw-values` entries the new blocks need (one per literal-bearing token). | Step 2 |
| `blurbs.json` | Settings blurbs: 27 new ids plus the new `ipod-gold` text. | Step 2 |
| `apply-payload.py` | Applies all of the above to four files, once, with exact anchors. Proven on a clean archive of `d1b9ca0d`. | Step 2 |
| `capture-skins.js` | Screenshots the real Settings skin grid from a running seeded instance. Proven against today's grid. | Step 5 |
| `gen-skins.py`, `site-cards.json` | Provenance only (how the payload was made). Do not run. | none |

Generation years (the label of a generation row, and part of a group heading). Put this map in the code
exactly (Step 3):

| line | gens: year |
|---|---|
| classic | 4: 2004, 5: 2005, 6: 2007 |
| mini | 1: 2004, 2: 2005 |
| nano | 2: 2006, 3: 2007, 4: 2008, 5: 2009, 6: 2010, 7: 2012 |
| shuffle | 2: 2006, 3: 2009, 4: 2010 |

## 4. Steps

Commit after each step (a WIP commit is fine; the gate reviews the branch). Each step lists its
expected output: if you see something else, STOP (rule 8).

### Step 0 - Setup

Worktree and symlink (rule 3). Run `git log --oneline -1` (should be the merge of v1.344.2 or later) and
`node --test test/unit/pocket-skins-menu.test.js test/unit/setup-music-skin-picker.test.js test/unit/ui-exceptions-ratchet.test.js test/unit/ui-lint.test.js`
(expected: all pass, before any change). Set this plan's frontmatter `status: Building`, `branch` stays.

### Step 1 - The ratchet's skin-art exemption (D7)

File: `scripts/ui-lint.js`, function `compareRatchet(base, current)`.

Today it indexes only counts, and reports `key added` for ANY key not in the base. Change it so that an
ADDED key is allowed (not reported) only when ALL of these hold:
- the rule is `no-raw-values`;
- the key matches exactly `/^public\/css\/style\.css\|\.mms-ipod-[a-z0-9-]+\|--pk-c-[a-z0-9-]+$/`;
- the entry's `reason` is exactly the constant
  `SKIN_ART_REASON = 'Pocket/whcal skin art (D10.4 carve-out): the device palette and the controls painted as part of it'`
  (the text the existing 21 colorways already carry; declare it once as a top-level const and export it).

Everything else is unchanged: a raised count is still reported for every key (skin keys included), and
any other added key is still reported. Update the `comment` string in `baselineData` (and the same text
at the top of `docs/ui-exceptions.json`) with one sentence: `Added skin-palette keys (.mms-ipod-* | --pk-c-*)
carrying the D10.4 skin-art reason are allowed (the permanent carve-out).`

Tests, in `test/unit/ui-lint.test.js` (add one `test(...)`, using `compareRatchet` directly with small
in-memory objects):
1. an added `public/css/style.css|.mms-ipod-nano3-blue|--pk-c-body` entry with `SKIN_ART_REASON`: no problems;
2. the same key with reason `'x'`: one `key added` problem;
3. an added `public/css/style.css|.foo|color` with `SKIN_ART_REASON`: one `key added` problem;
4. an added `.mms-ipod-x|--pk-c-body` key under a rule other than `no-raw-values`: one problem;
5. an existing skin key whose count goes 1 -> 2: one `count raised` problem.

Mutation check (rule 7): make the exemption ignore the reason; test 2 must fail. Restore.
Expected: `node --test test/unit/ui-lint.test.js test/unit/ui-exceptions-ratchet.test.js` all pass.

### Step 2 - Apply the payload

From the worktree root: `python3 docs/exec-plans/active/2026-09-29-ipod-trueup/payload/apply-payload.py <today YYYY-MM-DD>`

Expected output: `applied: public/js/music-skins.js, public/css/style.css, docs/ui-exceptions.json, public/js/setup.js`.
Then, expected exactly:
- `node -e "const s=require('./public/js/music-skins.js'); console.log(s.IDS.length, s.clickColorways().length)"` prints `52 50`;
- `npm run lint:ui` ends with `ui-lint: OK - the live debt equals docs/ui-exceptions.json`;
- `node --test test/unit/ui-exceptions-ratchet.test.js` passes (Step 1's exemption admits the 329 keys);
- `node --test test/unit/setup-music-skin-picker.test.js` passes (one blurb per skin).

`node --test test/unit/pocket-skins-menu.test.js` now FAILS 4 tests (the old `Click` family and the
`colorwayLabel` regex): that is expected and fixed in Steps 3-4. Do not edit the payload's output by hand.
Commit (stage the four files by name).

### Step 3 - The code: families, lines, labels, the menu levels

All in `public/js/music-skins.js` unless named. Keep the file's ES5 style (`var`, `function`).

1. **Constants** (near `FAMILY_LABEL`, which you delete along with `familyKeyOf`):
   ```js
   var SKIN_LINES = [{ key: 'classic', label: 'Classic' }, { key: 'mini', label: 'Mini' }, { key: 'nano', label: 'Nano' }, { key: 'shuffle', label: 'Shuffle' }];
   var GEN_YEAR = { classic: { 4: '2004', 5: '2005', 6: '2007' }, mini: { 1: '2004', 2: '2005' },
     nano: { 2: '2006', 3: '2007', 4: '2008', 5: '2009', 6: '2010', 7: '2012' }, shuffle: { 2: '2006', 3: '2009', 4: '2010' } };
   ```
2. **`skinFamilies()`** returns the groups in EXACTLY this order (the Settings grid order):
   `{ key: 'original', label: 'Original', ids: ['ipod-original'] }`; then for each line in `SKIN_LINES`
   order and each gen ascending, `{ key: '<line>-<gen>', label: '<Line> <gen>G (<GEN_YEAR>)', line, gen,
   ids: [registry order] }`; then `{ key: 'apple', label: 'Cider', ids: ['apple'] }`,
   `{ key: 'spotify', label: 'Nordic', ids: ['spotify'] }`. Derive it from the registry (a skin with
   `line` goes to its line-gen group; `ipod-original`, `apple` and `spotify` are placed as above). There
   are 17 groups. Never hand-list ids.
3. **`skinLines()`** (new, exported): `[{ key: 'classic', label: 'Classic', gens: ['classic-4', 'classic-5', 'classic-6'] }, ...]`
   derived from `skinFamilies()` (only lines that have skins; all four do).
4. **`colorwayLabel(id)`**: for a skin with `line`: its `color`, plus ` (<year>)` when another skin with
   the same `line` AND `gen` has the same `color`. For the rest keep today's behavior. Expected:
   `ipod-red` -> `Red`, `ipod` -> `White`, `ipod-charcoal` -> `Black (2007)`, `ipod-matte` -> `Black (2008)`,
   `ipod-nano7-spacegray` -> `Space Gray`, `ipod-original` -> `Original`, `apple` -> `Cider`.
5. **`menuSkinItems(node, active)`** handles three node types (`row(id, label)` stays as it is):
   - `skins`: rows in order: `row('ipod-original', 'Original')`; one row per line
     `{ label: 'Classic', node: { type: 'skinLine', key: 'classic', label: 'Classic' }, check: <active is in this line> }`;
     `row('apple', 'Cider')`; `row('spotify', 'Nordic')`.
   - `skinLine` (key = a line): one row per generation
     `{ label: '4G (2004)', node: { type: 'skinGen', key: 'classic-4', label: 'Classic 4G' }, check: <active is in this gen> }`.
   - `skinGen` (key = a family key): `ids.map(id => row(id, colorwayLabel(id)))`.
   The node `label` is also the level's title (`menuTitle` reads `node.label`): `Classic`, `Classic 4G`.
6. **Rename the node type `skinFamily` everywhere** to the two new types. Exactly these places (grep
   `skinFamily` must return nothing afterwards):
   - `music-skins.js` `menuStaticItems`: `if (t === 'skins' || t === 'skinLine' || t === 'skinGen') return menuSkinItems(node, o.activeSkin);`
   - `music-skins.js` `NON_ITEM_LEVELS`: replace `'skinFamily'` with `'skinLine', 'skinGen'`.
   - `skin-surface.js` `syncPreview` and the pane refresh (2 lines): replace
     `pane.node.type === 'skinFamily'` with `pane.node.type === 'skinLine' || pane.node.type === 'skinGen'`.
   Nothing else in `skin-surface.js` changes: it already opens each level on its checked row.
7. **`public/js/setup.js` `renderMusicSkinPicker`**: the tile name becomes
   `const name = (s && s.line) ? skins.colorwayLabel(id) : fam.label;` (headings stay `fam.label`).
8. Update the comments you touched so they are TRUE (LESSONS: a lying comment is a most-struck class):
   the registry header (`Labels are CHEEKY riffs...` now: the iPod colorways use real model names, Dean
   2026-09-29; Cider and Nordic stay cheeky), and the families/menu comments.

### Step 4 - Tests

Update `test/unit/pocket-skins-menu.test.js` to the new structure; keep every assertion's INTENT (what it
proves), change only the path and the expected labels:
- families: labels exactly `['Original', 'Classic 4G (2004)', 'Classic 5G (2005)', 'Classic 6G (2007)',
  'Mini 1G (2004)', 'Mini 2G (2005)', 'Nano 2G (2006)', 'Nano 3G (2007)', 'Nano 4G (2008)', 'Nano 5G (2009)',
  'Nano 6G (2010)', 'Nano 7G (2012)', 'Shuffle 2G (2006)', 'Shuffle 3G (2009)', 'Shuffle 4G (2010)', 'Cider', 'Nordic']`;
- `colorwayLabel`: the seven expected values in Step 3.4;
- top level: `['Original', 'Classic', 'Mini', 'Nano', 'Shuffle', 'Cider', 'Nordic']`; a line row's node is
  `{ type: 'skinLine', key: 'classic', label: 'Classic' }`; the Classic level lists `['4G (2004)', '5G (2005)', '6G (2007)']`;
  the `classic-6` level lists `['Silver', 'Black (2007)', 'Black (2008)']`;
- `menuIsItemLevel` is false for `skins`, `skinLine`, `skinGen`; `menuTitle` of the gen node is `Classic 4G`;
- the helper `openClickColorways(b)` becomes: Extras, Skins, Classic, `5G (2005)` (the tests' saved skin
  `ipod-black` lives there); the test "the menu opens on the saved family" now expects the cursor on
  `Classic` at the top level and on `5G (2005)` at the Classic level;
- checks: with `ipod-matte` active, the top `Classic` row, the `6G (2007)` row and the `Black (2008)` row
  are checked, and nothing else at those levels.
Add to `test/unit/setup-music-skin-picker.test.js`: the rendered grid has 17 `.skin-family` groups whose
headings are the list above, and the `ipod-charcoal` tile's name is `Black (2007)`.
Add one registry test (any existing skins test file): every `line` skin's `label` equals
`` `${Line} ${gen}G ${color} (${year})` `` (AC2), every `line`/`gen` pair has a `GEN_YEAR`, and no id from
this list was removed: `ipod ipod-black ipod-matte ipod-red ipod-silver ipod-encore ipod-blue ipod-green
ipod-pink ipod-gold ipod-frost ipod-sky ipod-olive ipod-blush ipod-2004 ipod-charcoal ipod-violet ipod-yellow
ipod-lime ipod-cobalt ipod-magenta ipod-raspberry ipod-original apple spotify` (AC1).
Mutation checks (rule 7), each must fail at least one test, then restore: (a) `colorwayLabel` never adds
the year; (b) `menuSkinItems` returns the old flat list at `skins`; (c) `skinFamilies` sorts gens descending.

### Step 5 - Look check for Dean (AC8), before the gate

1. Seed and serve: `node test/visual/seed.js --data <scratch>/ipod-data` then
   `DATA_DIR=<scratch>/ipod-data PORT=<a free port> TZ=UTC FILETUBE_READ_ONLY_MEDIA=1 FILETUBE_YTDLP_ENABLED=true FILETUBE_YTDLP_POLL_MINUTES=0 node server.js`
   in the background (check the port is free first with `curl`; never kill a process you did not start).
2. `BASE=http://127.0.0.1:<port> FIXTURES=<scratch>/ipod-data/fixtures.json OUT=<scratch>/skins-settings.png node docs/exec-plans/active/2026-09-29-ipod-trueup/payload/capture-skins.js`
   Expected: `tiles 52 -> ...`.
3. Send the PNG to Dean with SendUserFile (caption: the 17 groups, the 27 new, the retuned Gold) and
   wait for his OK. If he wants a color changed, that is a new ruling: record it here, ask him for the
   value, change only that block and its exception entries.
4. Stop the server you started.

### Step 6 - Measure every AC, then the docs

Run and paste the counts into this plan under `## Build record`: the Step 2 checks, `npx eslint .`,
`npm run lint:ui`, `node scripts/overlay-containment-lint.js --enforce`, full `npm test` on BOTH Nodes
(`$HOME/.local/share/fnm/node-versions/v24.20.0/installation/bin` for 24), `bash .harness/lib/check-markers.sh`.
Then the release docs (in the release commit, per `docs/RELEASING.md` and AGENTS.md):
`npm version 1.345.0 --no-git-tag-version`; a ROADMAP.md `### v1.345.0 - ...` Shipped entry above
v1.344.2's; a `docs/releases.json` entry in plain user language (the ledger test checks the tone: no
process words); one `docs/DEVICE-CHECKS.md` line (`- [ ] v1.345.0 - On the phone: Extras > Skins > Nano >
7G (2012) > Purple previews live and Select keeps it; Settings shows the groups; the Gold skin is champagne.`).
The visual CI job will show many changed Settings scenes: that is expected and report-only; the
baselines bot opens its PR after the merge. Never commit screenshots.

### Step 7 - Gate, then release

The diff touches `package.json`, so `.harness/scrutiny.toml` forces the FULL gate: spawn `adversary`,
`qa` and `security-brief` fresh, in parallel, on the committed branch (brief: branch, base sha, this
plan, and these attack surfaces):
- **Saved picks survive:** every pre-existing id still resolves (`normalizeSkinId`), a saved `ipod-gold`
  loads the champagne Mini, and no id outside the list was renamed.
- **The ratchet exemption cannot admit non-skin debt** (mutate it; try every clause).
- **Menu levels:** checks, the cursor opening on the saved row at each level, the live preview only on
  color rows, MENU backing out one level at a time, Select saving once; the Settings grid's groups.
- **Registry-derived lists** (the INERT SIBLING class, LESSONS 3): Brick, lighting, the probes and the
  Settings grid see all 50 Click colorways without a second list.
- **The comments** touched are true.
Seats write verdicts into this plan under `## Gate`. CHANGES: fix, then re-engage the SAME seat on the
delta. After 2 CHANGES rounds, ask Dean before round 3. Then the release per AGENTS.md: plan close
(`node scripts/plan-complete.js docs/exec-plans/active/2026-09-29-ipod-trueup/plan.md "Shipped v1.345.0" --apply`),
push, `gh pr create`, green unit CI (`ci (22)`, `ci (24)`, `audit`, `secret-scan`), `gh pr merge <n> --merge`
(if the classifier refuses it, ask Dean), `git -C /home/coder/projects/filetube pull --ff-only`, the tag
by API (`gh api repos/dtammam/filetube/git/refs -f ref=refs/tags/v1.345.0 -f sha=<merge sha>`), then
delete the branch remote (`gh api -X DELETE repos/dtammam/filetube/git/refs/heads/feat/ipod-trueup`)
and local (`git branch -d`), and remove the worktree.

## Research record (why the payload is what it is)

- **Existing mapping:** each of the 22 existing line colorways was photo-sampled from a real model
  (their CSS comments cite the source photo); each maps to one site card (`payload/table.md`). Click
  (Matte) matched the Classic 6G (2008) black (#7a777a vs the matte body #7a7a7e).
- **Duplicate threshold:** CIE76 dE < 10 against every kept color, existing first, lines in priority
  order (D2). Chronological order alone let the Shuffle claim the Nano 3G colors from the same month.
- **The CSS formula** (new blocks only): body ramp = the site hex at 30% with HLS lightness +.05 / -.05 /
  -.11 / -.17 at 0 / 60 / 85 / 100%, edge -.34, the existing side vignette and sheen; wheel tokens per D5;
  lighting glow = the hex +.12 lightness, core = glow mixed 60% with white; the lit bands are Click
  (Violet)'s. It was previewed as real Settings swatches and shown to Dean on 2026-09-29.
- **Proven before handoff (2026-09-29, a clean archive of d1b9ca0d):** `apply-payload.py` ran clean;
  52 ids, 50 Click colorways; `ui-lint: OK - the live debt equals docs/ui-exceptions.json` (TOTAL 2260);
  eslint clean on the two JS files; the blurb test passes; `pocket-skins-menu.test.js` fails exactly the 4
  tests Step 4 rewrites; a second apply run stops (`already applied`). `capture-skins.js` captured
  today's grid (25 tiles) from a seeded instance.
