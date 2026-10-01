---
plan: device-names-mobile-player
harness: v2 · lean
branch: feat/v1.349-device-names
anchor: spec
status: Approved, not started
next: Step 0 (read this whole plan once, top to bottom, before touching anything)
design: Approved 2026-10-01 (Dean, three rounds of Q&A; every ruling in section 2 is his answer)
gate: adversary + qa (client UI and Settings; no server, auth or data change)
---

# v1.349: the Remote control switch shows On, a Mobile player section, device names, the visual rule

Written 2026-10-01 by an Opus session for a **Sonnet** builder in a fresh session. Every scope decision
is made. Build exactly this. If the code you find does not match what this plan says, follow the stop
rules in 0.8; do not improvise a redesign.

## 1. The outcome (what Dean will do on device)

1. On his Mac, Music page, he clicks **Remote control**. The button turns the system's selected gray
   (the same look as a pressed Loop / Autoplay chip) and reads **Remote control: On**. Clicking again
   returns it to the plain tonal button reading **Remote control**. The button does not change width.
2. In Settings he sees a new **Mobile player** row right under Appearance. It holds the Music skin grid
   and the Player sticker, moved out of Appearance. Appearance is short again.
3. He has three computers listening. On his iPhone, **Play on...** lists them as e.g. **Mac · Otter**,
   **PC · Maple**, **Mac · Pebble**: each device's type plus a short word that never changes for that
   browser. On the Mac he hovers the Remote control button and the tooltip tells him this one is
   **Mac · Otter**. In Settings > Account he types **Snowy Table** into "This device's name"; from then
   on that Mac shows as **Snowy Table** everywhere (Play on..., the "Controlled by" pill, the handoff
   card). Clearing the field brings back **Mac · Otter**. The top bar is unchanged.
4. A contributor (human or agent) reading `docs/CONTRIBUTING.md` knows exactly what to do about visual
   baselines, and a unit test fails if a Settings section has no screenshot scene.

## 2. Rulings (Dean, 2026-10-01)

| # | Question | Ruling |
|---|---|---|
| R1 | Remote control button ON look | The system's selected look: `--fill-selected` layered over the button's own ground, semibold, **never red, no new token**. Label reads **Remote control: On** when on. The fill rule is written for any pressed tonal button (`.ui-btn--tonal[aria-pressed="true"]`), so future toggles get it. |
| R2 | Where the mobile player settings live | A **new top-level Settings section** "Mobile player", directly under Appearance, deep link `/setup.html#mobile-player`. Not a nested page. |
| R3 | What moves | **Music skin** and **Player sticker** only. Star ratings, Library icons, Era, Icons and Logo stay in Appearance. |
| R4 | Device identity | A browser cannot read the hostname (verified: no API; WebRTC local addresses are mDNS-obfuscated). So: every device gets an automatic **type · word** label (`Mac · Otter`), the word derived from the existing per-browser device id. An optional **typed name** replaces the whole label. No network or reverse-DNS lookup. |
| R5 | Where the name is set and shown | A "This device's name" field in **Settings > Account**, placeholder = the automatic label. The name shows in Play on..., the "Controlled by" pill and the handoff card. On the PC itself, the Remote control button's tooltip names it. **Nothing in the top bar.** |
| R6 | The visual rule | A short "Visual changes" section in CONTRIBUTING **plus a unit test** that fails when a Settings section has no screenshot scene. |

Consequences Dean accepted (do not "fix" them):
- The word belongs to the browser (`localStorage['ft-device-id']`): two browsers on one Mac get two words,
  and clearing site data picks a new one.
- R1's generic rule also lights the **Pop out** buttons (Music and Podcasts set `aria-pressed` while the
  pop-out is open). That is the intended consistency.

**Note on baselines (read before W1).** Since 2026-09-30 (`docs/RELEASING.md`, "The visual job and
baselines") baselines refresh THEMSELVES after a merge: the PR comment shows every changed look, then
the bot reuses the PR run's shots and merges a baselines-only PR. Nobody downloads or commits baselines
by hand. A look change is reported, never a failure. What still needs a human is a NEW surface: it is
only ever shot if a scene exists for it. That is what W1 codifies.

## 0. Step 0 - read, set up, and the stop rules

0.1 Read `AGENTS.md`, then `docs/LESSONS.md` sections **0, 2, 3, 4, 6, 12**. Read this plan fully once.

0.2 Environment, every shell: `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
Dual-Node for the final suite: 22.23.1 and 24.20.0 (Node 24 prints `ℹ`, not `#`).

0.3 Worktree: `git -C /home/coder/projects/filetube worktree add .claude/worktrees/device-names feat/v1.349-device-names`
(the branch exists locally and carries this plan). Rebase onto `origin/main` first if main moved. In the
worktree: `ln -s /home/coder/projects/filetube/node_modules node_modules` before any commit/push,
`rm node_modules` after, never stage it.

0.4 Git: stage files BY NAME; `git commit -F <file>`; never `--no-verify`, never force-push, never pipe a
commit or push; verify with `git log` / `git ls-remote`.

0.5 Tests while building: the targeted files named in each wave. The full dual-Node suite once at the end
of W5 (and again only if a gate round changes code).

0.6 Report every failure verbatim with counts. "Verified" means you ran it and saw it.

0.7 No em dashes in docs, comments or UI text. UI uses the app's tokens and `ui.js` primitives;
`npm run lint:ui` must not grow; `node scripts/overlay-containment-lint.js --enforce` stays 0. No new
color tokens anywhere in this wave.

0.8 **Stop rules.** Stop and ask Dean (AskUserQuestion) if: (a) a seam in section 3 does not exist or
behaves differently and the fix is not a like-for-like rename; (b) the R1 contrast test (W3) cannot pass
in some era x mode without a new token or a red; (c) a step would need a new npm dependency or any server
change; (d) a gate seat asks for a scope change. Never widen scope: log extras in ROADMAP.md Planned.

## 3. The seams (mapped 2026-10-01 at v1.348.0 + b4db80f3; line numbers drift, names do not)

Remote control button:
- Markup `public/music.html` `#music-remote-btn`: `ui-btn ui-btn--tonal ui-btn--sm ui-btn--pill`,
  `title="Let your other devices play music in this tab"`, `aria-pressed="false"`, label span
  `.ui-btn__label` "Remote control". Hidden on phones (`html.is-phone #music-remote-btn`, style.css).
- Handler `public/js/music.js`, the "v1.348 Listen Control" block: `paintRemote()` sets `aria-pressed`
  from `REMOTE.isOn()`; click = `REMOTE.toggle(); paintRemote()`; also subscribed to `REMOTE.onChange`.
- **No CSS styles `.ui-btn[aria-pressed="true"]` today** (the only aria-pressed ui-btn rule is busy state).
- The selected precedent: `public/css/ui.css` `.ui-chip--filter[aria-pressed="true"]` layers
  `linear-gradient(var(--fill-selected), var(--fill-selected))` over the chip's ground + `--fw-semibold`.
  Its contrast proof: `test/unit/ui-chip-selected.test.js` (resolves tokens per era x mode, MIN_STEP 12,
  and forbids era rules that re-ground the chip).
- Tonal ground: `.ui-btn--tonal { background: var(--surface-2) }`; **2009 overrides it with
  `background: var(--btn-fill)` (the gloss)**; 2005/2009 add `border: var(--btn-border)`. The selected
  layer must sit OVER the 2009 gloss (multiple backgrounds), not replace it.
- `--fill-selected`: `rgba(120,120,128,0.16)` light, `0.32` dark, every era (tokens.css). Design rule
  (tokens.css header): selected = ink on `--fill-selected`; red is never "selected".
- Other tonal buttons that set aria-pressed: `#music-popout-btn` and `#podcast-popout-btn` (open state).
  `#theater-btn` has its own red rule in style.css; it is not tonal, leave it alone.

Settings:
- `public/setup.html`: `.md-root[data-md-page="setup"]`; each section is
  `<details class="setup-box setup-sec sub-collapsible" data-collapse-key=... data-md-icon=... [data-md-group=...]>`.
  Appearance (`data-collapse-key="appearance"`, `data-md-icon="era"`, ungrouped) is first; Critters
  (ungrouped) second.
- Inside Appearance, `.setup-group` blocks: Era (`#theme-picker`), Icons, **Music skin**
  (`#music-skin-picker`, comment "v1.230"), **Player sticker** (`#sticker-picker` + `#sticker-file-input`,
  comment "v1.238"), Star ratings, Library icons, Logo.
- `public/js/setup.js` wires everything BY ID (`renderMusicSkinPicker`, `renderStickerPicker`), never by
  document order (the v1.48 comment), so moving the two blocks with ids unchanged keeps them working.
- `wireMasterDetail` (common.js) builds the menu; `#<collapse-key>` deep-links a section (hashchange).
  Section tiles: `mdTileHtml` -> `mdSvg(icon)` from `MD_ICON_PATHS` (stroke paths, 24x24); unknown names
  fall back to `info`. `era` is special (the era tile). Existing icon names: account backup book copy
  download era flask hidden music paw podcast sliders trash tv users video wrench.
- Tests that pin the moved blocks: `test/unit/setup-music-skin-picker.test.js`,
  `test/unit/setup-sticker-picker.test.js`, `test/unit/master-detail.test.js`,
  `test/unit/seattle-removed-census.test.js`, `test/unit/retire-r3-surfaces.test.js` (read each; update
  only what the move invalidates).
- Account section: `data-collapse-key="account"`, `id="account-box"`, group "Account": account chip +
  Sign out, Profile photo row.

Device label:
- `public/js/common.js`: `resolveDeviceLabel(ua, {maxTouchPoints})` (pure, exported, UA roster with
  load-bearing order) -> 'iPod' | 'iPhone' | 'iPad' | 'Android phone' | 'Android tablet' | 'Chromebook' |
  'PC' | 'Mac' | 'Linux PC' | 'Another device'. `getDeviceId()` (`localStorage['ft-device-id']`, in-memory
  fallback). `getDeviceLabel()` wraps resolveDeviceLabel; exported as `window.FileTube.getDeviceLabel`.
- Consumers (all read the label per request, so a rename reaches them on the next request, no reload):
  `public/js/remote.js` `env.label()` (sent as `?label=` on every target/controller request; the pill
  "Controlled by <label>"), `public/js/player.js` progress pings `body.deviceLabel` (presence/handoff),
  `public/js/music.js` `playOnItems()` ("This " + label, then each target's `t.label`).
- Server: `lib/presence/store.js` `normalizeLabel` strips control/bidi chars only and caps at
  `LABEL_MAX` 32. The middle dot U+00B7 passes. **No server change in this wave.**

Visual scenes:
- `test/visual/capture.js` `SETTINGS_SECTIONS` rows `[idDigit, name, collapseKey, phoneScroll?]` map to
  scene `6<id>-settings-<name>` at `/setup.html#<key>`. Currently covered: appearance, critters,
  video-folders, automation-storage (+mid), downloads, trash, users, backup-restore, experimental. Other
  scenes may open Settings sections too (search for `setup.html#` in capture.js).
- Scene-id index: `test/visual/README.md` ("Scene ids follow ...").

## 4. Waves (one branch, a commit per wave, one gate, one release)

### W1 - The visual rule, codified (item 3)

1. `docs/CONTRIBUTING.md`: add a section **"Visual changes and baselines"** (near the existing measured
   button rules), in plain words:
   - A changed look: do nothing special. The PR's visual comment shows it with crops; review it there.
     After the merge the baselines refresh themselves (link `docs/RELEASING.md` "The visual job and
     baselines"). Never commit baselines by hand; never take them on a dev box.
   - A NEW surface (a Settings section, a page, a sheet, a menu level): add its scene to
     `test/visual/capture.js` in the SAME PR. The PR comment lists it as new; the refresh adds its
     baseline after the merge. A surface with no scene is never checked.
   - A removed or renamed surface: remove or rename its scene in the same PR.
   - Changing a button's label, icon or count is also a measured change (the existing geometry rules).
2. `test/unit/visual-settings-coverage.test.js` (new): parse every `data-collapse-key` in
   `public/setup.html`; collect the keys a scene opens (SETTINGS_SECTIONS keys plus any
   `setup.html#<key>` path in capture.js). Assert every section key is covered OR listed in an
   `UNCOVERED` array inside the test, each entry with a one-line reason, and assert `UNCOVERED` contains
   no key that IS covered (so it can only shrink). Seed `UNCOVERED` with exactly today's uncovered keys,
   measured, not guessed. Comment: a NEW section must get a scene, never an UNCOVERED entry.
3. Prove the test can fail: temporarily add a fake section key to a copy of the HTML input (or remove a
   SETTINGS_SECTIONS row) and watch it go red (LESSONS 2, presence is not binding). Record the output.

### W2 - The Mobile player section (item 2)

1. `public/setup.html`: new section directly after Appearance's `</details>`:
   `<details class="setup-box setup-sec sub-collapsible" data-collapse-key="mobile-player" data-md-icon="phone" open>`,
   `<summary>Mobile player</summary>`, a one-sentence `setup-intro` (e.g. "How the full-screen Music
   player looks on this phone."), then the **Music skin** and **Player sticker** `.setup-group` blocks
   moved verbatim from Appearance (ids, comments and the hidden file input unchanged). Ungrouped, like
   Appearance and Critters.
2. `public/js/common.js` `MD_ICON_PATHS`: add `phone` (a simple stroke phone outline: rounded rect +
   a short speaker line), drawn in the same style as its neighbours.
3. Anything that linked to `setup.html#appearance` for skins or stickers now uses `#mobile-player`
   (measured 2026-10-01: nothing in public/ does; re-grep anyway).
4. Update the pinned tests from section 3 only where the move invalidates them; add an assertion that
   `#music-skin-picker` and `#sticker-picker` live inside the `mobile-player` section and NOT inside
   `appearance`.
5. `test/visual/capture.js` `SETTINGS_SECTIONS`: add `['0b', 'mobile-player', 'mobile-player']`
   (scene `60b-settings-mobile-player`); note it in `test/visual/README.md`'s index. The W1 test must be
   red before this row and green after it (record both).
6. Targeted: `node --test test/unit/setup-*.test.js test/unit/master-detail.test.js test/unit/visual-*.test.js`.

### W3 - Remote control: On (item 1)

1. `public/css/ui.css`, next to the chip rule: `.ui-btn--tonal[aria-pressed="true"]` layers
   `linear-gradient(var(--fill-selected), var(--fill-selected))` over the button's ground and sets
   `--fw-semibold`; in 2009 the layer goes OVER the gloss (`background-image` with both layers, the
   selected layer first). Never red, no new token. Hover/press tints keep working on top.
2. `public/music.html` `#music-remote-btn`: the label holds BOTH strings so the width never changes:
   e.g. `.ui-btn__label` containing two stacked spans in one grid cell ("Remote control" and
   "Remote control: On"), the inactive one `visibility:hidden` (still sized). `paintRemote()` flips which
   one shows alongside `aria-pressed`. `aria-label` stays "Remote control" (aria-pressed carries state).
3. Tooltip: `paintRemote()` sets `title` to "Let your other devices play music in this tab. This
   device: <label>" using `FileTube.getDeviceLabel()` (W4 makes that label carry the word).
4. `test/unit/ui-btn-selected.test.js` (new, modelled on `ui-chip-selected.test.js`): per era x mode,
   the pressed tonal button differs from the unpressed one by at least MIN_STEP 12 in some channel,
   resolved from tokens the way the cascade composites them (2009: over `--btn-fill`); and no rule paints
   a pressed tonal button with `--accent`/`--yt-red`/`--danger`. Mutate it red once.
5. Geometry: the button's width is identical pressed and unpressed (bind it in a unit test on the markup
   AND measure once in a real browser on the music toolbar at 1440 and 900 wide; record the numbers).
6. Targeted: the new test, `test/unit/ui-chip-selected.test.js`, any music-toolbar/remote unit tests
   (`ls test/unit | grep -i -E "remote|music-tool|toolbar"`).

### W4 - Device names (item 4)

1. `public/js/common.js`, beside `resolveDeviceLabel`:
   - `DEVICE_WORDS`: a frozen array of 96-128 short, friendly, distinct English words (nature, animals,
     food, objects), each 3-7 ASCII letters, capitalized, no two sharing a first 4 letters, nothing that
     reads as rude or as a device type. Pure data.
   - `deviceWord(id)`: pure; a stable string hash of the id (FNV-1a 32-bit) mod the list length.
   - `DEVICE_NAME_KEY = 'ft-device-name'`; `getDeviceName()` / `setDeviceName(v)`: trimmed, control and
     bidi characters stripped like the server's `normalizeLabel`, capped at 32; empty removes the key.
     try/catch around storage (private mode).
   - `getDeviceLabel()` returns the typed name if set, else `resolveDeviceLabel(...) + ' · ' +
     deviceWord(getDeviceId())`. Keep `resolveDeviceLabel` itself unchanged (its tests pin the roster).
     Add `getAutoDeviceLabel()` (the label without the typed name) for the Settings placeholder.
   - Export the new pure functions for node:test the way `resolveDeviceLabel` is exported, and
     `getDeviceName`/`setDeviceName`/`getAutoDeviceLabel` on `window.FileTube`.
2. `public/setup.html` Account section: a `ui-field` "This device's name" with a text input
   (`maxlength="32"`, `autocomplete="off"`), placeholder filled by setup.js with `getAutoDeviceLabel()`,
   value = `getDeviceName()`, and a `setup-note`: "Only this browser. Shown in Play on... and when this
   device controls another. Leave blank to use <auto label>." Save on `change` (and Enter); show the
   saved state in the existing `action-status` pattern. Use `ui.js`/existing field markup, no new CSS
   beyond what lint:ui allows.
3. Nothing else changes: every consumer already calls `getDeviceLabel()` per request, so the "This ..."
   row, Play on... targets, the pill and presence pick it up. Verify each of the four consumers in
   section 3 actually shows the new label (read the code path; then see W5's two-browser proof).
4. Tests (`test/unit/device-name.test.js`, new): the word is stable for an id, differs across a sample
   of ids, the list obeys its rules (count, length, charset, uniqueness, 4-letter prefixes);
   `getDeviceLabel` returns `Type · Word` without a name and the name with one; `setDeviceName` trims,
   strips, caps at 32 and clears on empty; the label always passes the server's `normalizeLabel`
   unchanged (import it from `lib/presence/store.js`). Mutate one assertion red.
5. `test/visual/capture.js`: Account is a surface this wave changes; add
   `['7b', 'account', 'account']` (scene `67b-settings-account`) and drop `account` from W1's
   `UNCOVERED` list. The fixture's auto label is deterministic only if the fixture's device id is: if the
   placeholder text would vary run to run, mask the field's text via `MASK_CSS` (box kept, glyphs hidden)
   and say so in a comment.

### W5 - End-to-end proof, then release

1. Two-browser proof (headless Chromium is fine): server seeded with a fixture, browser A = desktop
   Music page with Remote control turned On, browser B = phone viewport. Record: A's button
   `aria-pressed="true"` and its computed background differs from the unpressed one; B's Play on... list
   shows A as `Mac · <word>` (or the UA's type); set A's name to "Snowy Table" in Settings, and B's next
   Play on... shows "Snowy Table" without a reload of A; A's pill shows B's label when B attaches.
2. `npm run lint`, `npm run lint:ui`, `node scripts/overlay-containment-lint.js --enforce`, the full
   suite on Node 22.23.1 and 24.20.0. Paste the tallies.
3. Expect the PR's visual comment to show: Settings Appearance (shorter), the new `60b` and `67b`
   scenes, and the desktop Music toolbar unchanged when off. That is correct and needs no action; the
   baselines refresh after the merge.

## 5. The gate

Adversary (floor) + QA, spawned fresh on the committed branch with: this plan, base sha, and the attack
surfaces below. Ship on CRITICAL/WARNING closure; after 2 rounds, ask Dean at round 3.

- R1: the ON state is visible in EVERY era x mode, including 2009's gloss and 2005's border; never red;
  the button width is identical in both states; Pop out's new ON look is not broken.
- R2/R3: the moved pickers still work on desktop and phone (pick a skin, upload/reset a sticker); the
  deep link `#mobile-player` opens the section; the Appearance tile and the era tile are unaffected;
  nothing still points at the old location.
- R4: the word is stable across reloads and differs across ids; the typed name round-trips, clears, is
  capped and stripped; a hostile name (bidi, control chars, 500 chars, `<img>`) renders as text
  everywhere it shows (the pill, Play on..., the Settings placeholder, the handoff card), never as HTML.
- R6: the coverage test can fail (mutate it), and `UNCOVERED` can only shrink.
- Lying comments (LESSONS 12): the v1.348 "rename deferred" comment by `resolveDeviceLabel` and any
  comment saying skins live in Appearance must be updated.

## 6. Release (docs/RELEASING.md is the authority)

v1.349.0 via the protected-main PR flow. ROADMAP.md Shipped entry; a `docs/releases.json` entry in pure
user language (e.g. "The Remote control button now shows when it's on. Each device gets a short name
like Mac · Otter, and you can name it yourself in Settings. Phone player skins and stickers have their
own Settings page."). LESSONS.md: add or bump a lesson only if this wave struck a real class. Move this
plan AND `docs/exec-plans/active/2026-09-30-visual-refresh-quiet.md` to `completed/` in the release
commit (the latter's last owed item, the `rebaseline` dispatch proof, passed 2026-10-01: run
36799434872, 1896 baselines identical to main's). Device checks for Dean go in DEVICE-CHECKS.md.

## 7. Out of scope (log, do not build)

- Any hostname, reverse-DNS or router lookup (R4 ruled it out).
- Syncing a device's name across browsers or to the server; renaming OTHER devices from this one.
- The line > gen > color drill-down for the Settings skin grid (the Pocket Extras > Skins menu has it).
- A visual scene for the Music toolbar with Remote control ON (needs a live remote session in the
  read-only fixture); W3's unit contrast test and W5's proof cover it.
- Showing the device name in the top bar.

## 8. Evidence and gate verdicts

### Builder evidence (Sonnet, 2026-10-01; branch tip f4f88235)

- **W1:** `visual-settings-coverage.test.js` reads SETTINGS_SECTIONS plus `section(...)`/`openSettingsSection` scenes;
  three tests, including one that proves the reader can fail (fake section, dropped row, changed key). UNCOVERED
  = music-folders, tv-folders, podcasts-place, troubleshooting (each with a reason); it can only shrink.
- **W2:** new `mobile-player` section (open, ungrouped, after Appearance) holds Music skin + Player sticker; scene
  `['0b','mobile-player','mobile-player']` added; setup-master-detail now expects 15 sections; the two picker tests
  assert the pickers are in mobile-player and NOT in appearance.
- **W3:** `.ui-btn--tonal[aria-pressed="true"]` layers `--fill-selected` over the ground (never red, no new token); 2009
  keeps its gloss. Measured button width, all 16 era x mode combos: identical on and off (2021 light/dark 175px;
  2014 was 169.39 -> 178.67 before the fix, equal after sizing the On wording semibold in both states).
  **Disclosed side effect:** the button is wider even when OFF (149px -> 175px in 2021, +26px); toolbar row count and bar height
  unchanged vs main (1 row / 32px at 1440; the same 2-row wrap / 72px at 900).
- **W4:** 118 words (Violin dropped for the Violet/Violin 4-letter collision), FNV-1a pinned (`deviceWord('a')` =
  0xe40c292c mod list). Mutants killed: deviceWord constant (fail 1), getDeviceLabel ignoring the name (fail 2), bidi
  isolates un-stripped (fail 1), cap 32->64 (fail 2).
- **W4 deviation:** no new `67b` scene: `9a-settings-account` already shows Account; `capture.js` now seeds
  `ft-device-id` so its placeholder is deterministic. No UNCOVERED entry existed for account, so nothing to drop.
- **W5 two-browser proof** (headless Chromium, fresh seeded data dir, writable server, A = Mac UA 1440, B = iPhone UA 390):
  A button `aria-pressed` false -> true, background-image none -> `linear-gradient(rgba(120,120,128,0.16)...)`, width 175 both,
  visible wording "Remote control" -> "Remote control: On". B's Play on... targets: `["Mac · Cobalt"]`; B's own label
  `iPhone · Peach`; Settings placeholder = A's auto label. **FIRST RUN FAILED:** after naming A "Snowy Table" in Settings, B's
  targets stayed `["Mac · Sorrel"]` for 10s (A's tab already reported the new label; the server only learns a label when the
  stream opens). Fixed in f4f88235 (target reopens its stream on rename; other tabs via the `storage` event; two
  mutants red). Re-run: B's targets `["Snowy Table"]` at t+0s with no reload of A. A's pill read
  "Controlled by iPhone · Peach". Hostile name (`<img onerror>` + RLO + 200 chars): B saw it capped at 32 chars as text,
  `window.__pwn` undefined in both browsers, 0 injected `<img>` in note/status/pill.
- **Known limits:** a controller's own rename while attached shows on the PC pill only after it re-attaches (controller
  label rides the attach URL); not built (scope). No server change.
- **Lint:** `npm run lint` 0 errors (6 pre-existing warnings); `lint:ui` OK (debt equals exceptions); overlay-containment 0.

(the builder fills this: W1 red/green outputs, W3 width numbers, W5 proof, suite tallies, verdicts bound
to the reviewed sha)
