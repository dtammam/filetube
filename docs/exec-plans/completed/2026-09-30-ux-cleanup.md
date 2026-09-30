---
plan: ux-cleanup
harness: v2 · lean
branch: chore/ux-cleanup
anchor: spec
status: Shipped v1.347.3
next: Step 0 (read this whole plan once, top to bottom, before touching anything)
design: Approved 2026-09-30 (Dean: "handle the UX overhaul code cleanup ... I've tested the new system and just love it"; scope and rulings below are the architect's, taken on his word "I will take your advice")
gate: pending (full: adversary + qa + security-brief; scrutiny.toml forces it for tokens.css and package.json)
---

# UX overhaul cleanup: retire the leftovers of the v1.341 UI pass, change no pixel, then a fresh README

Written 2026-09-30 by an Opus session for a **Sonnet** builder in a fresh session. Every scope decision
is already made. **Your job is to remove and re-spell, never to redesign.** If something here does not
match the code you find, follow the stop rules in section 0.8.

## Why this exists

v1.341.0 ("One consistent look", plan `docs/exec-plans/completed/2026-09-27-ui-professionalism-pass.md`)
built the new design system (tokens.css roles, ui.css / ui.js primitives, ui-lint) and swept every
surface onto it. It deliberately left debt on a shrink-only ratchet (`docs/ui-exceptions.json`, plan
D10.3 / D10.4 amendment) and promised "one true-up wave to clear them ... opened only if Dean signs the
pass off on device" (tech-debt #289 (d)). Dean signed it off on 2026-09-30. This is that wave. It closes with W5 (added by Dean, 2026-09-30):
the README's screenshots are retaken from the cleaned-up UI and the README is freshened, which also
closes the ROADMAP chore "Refresh the README screenshots" (Dean, 2026-09-29).

**The one rule that defines success: the app looks exactly the same.** Dean loves the current look. A
cleanup that moves one pixel is a regression. Every wave is proven pixel-identical against `origin/main`
across all four eras, both modes and every viewport (Step 0.3).

## Measured starting point (origin/main @ 39707089, v1.347.2)

`npm run lint:ui` TOTAL 3225. Of that, the part THIS plan pays:

| Debt | Count | Where | Wave |
|---|---|---|---|
| `no-raw-values`, reason "raw value, same pixels as a token ... retire when touched" | 377 | style.css 368, main.js 5, ui.css 1, setup.js 1, watch.js 1, stats.html 1 | W2 |
| `no-legacy-tokens`, reason "legacy token with no exact role (step 7 ...)" | 354 | style.css 349, watch.js 2, ui.css 1, common.js 1, main.js 1 | W3 |
| Dead CSS rules / JS functions the sweeps replaced but did not delete | unknown (census in W0) | public/ | W1 |
| Docs that still teach the retired system | unknown (census in W0) | docs/, AGENTS.md | W4 |
| README screenshots from before the skins, the Pocket and the one look; README copy behind the features | 7 shots + copy | README.md, assets/images/ | W5 |

A rough scan (not proof) found 173 style.css classes with no literal reference in public/, lib/ or
server.js. Most are skin classes built at runtime (`mms-ipod-*`, `mms-look-*`, `icon-*`), so they are
NOT dead; a few may be (examples to CHECK, not to delete on sight: `subs-root`, `subs-toolbar`,
`subs-tool*`, `subs-head`, `subs-search`, `subs-panel-intro`, `subs-activity-pane`, `audio-artwork`,
`theme-night`, `theme-sepia`, `chapter-snap-note--hint`, `chapter-snap-note--moved`).

## OUT of scope (do not touch; each is a separate decision for Dean)

1. **The player overlay carve-out** (every exception whose reason starts "player overlay rewrite (post
   black-screen fix)", about 300 debt across 7 rules). That is a player rewrite, not a cleanup, and it
   sits on the black-screen fix.
2. **The Settings/Stats master-detail nav** (`.md-row`, `.md-back`, `.md-row-badge`, the 4 tile glyphs in
   common.js). That is a redesign that needs Dean's eye.
3. **The `showConfirmModal` shim and its callers** (common.js ~14443, "116 call sites"). Several are
   delete confirms: a data-loss surface. Leave every caller and the shim alone.
4. **Skin art and carve-outs:** anything whose reason says "Pocket/whcal skin art", "diag.html", or
   "read.html". The skin palettes, music-skins.js, skin-surface.js and ipod-brick.js are skin data.
5. **The 204 counted `token-exempt` annotations** and the remaining "left at step 7" bespoke-control
   entries (`.account-menu`, `.books-home-row`, `.modern-*`, `.shortcuts-*`, `select`, `.sidebar` z).
6. **Data-compatibility readers.** Anything that reads an OLD stored shape stays, even when it says
   "legacy": `LEGACY_IDS` / `rewriteLegacy` (music-skins.js), `resolveTheme`'s legacy `theme` key,
   `migrateIconPref` / `LEGACY_ICON_SET_MAP`, the `?id=` watch-URL fallback, untagged legacy pins, legacy
   null `updated_at` rows, legacy items with no stored dims, the legacy continue-listening id. Removing
   one breaks a real user's saved data or old links.
7. **Server code** (`lib/`, `server.js`), tests unrelated to a deleted item, and any behavior change.

Anything else you notice: add one line to ROADMAP.md (Chores) or the tech-debt tracker and move on.

## 0. Rules for the builder (read first, follow exactly)

1. Read `AGENTS.md`, then `docs/LESSONS.md` sections 2, 3, 4, 6 and 13, then this plan to the end.
2. **Environment, every shell:** `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.
3. **Worktree (already created):** `/home/coder/projects/filetube/.claude/worktrees/ux-cleanup` on branch
   `chore/ux-cleanup` from origin/main @ 39707089. Work ONLY there. Before any commit:
   `ln -s /home/coder/projects/filetube/node_modules node_modules` (never stage it; `rm node_modules`
   when the branch is done).
4. **Git:** stage files BY NAME, commit with `git commit -F <file>`, never `--no-verify`, never
   force-push, never pipe a commit or push; verify every commit with `git log -1`. One commit per wave
   (W1a/W1b may be two), so a regression bisects to a wave.
5. **Do it yourself, sequentially.** Every wave edits style.css, so parallel subagents would conflict.
   Use subagents ONLY for the gate seats (Step 5) and, if you want, a read-only census helper.
6. **The ratchet moves with the code.** `lint:ui --enforce` fails when live debt is BELOW its entry, so
   every commit that pays debt lowers or deletes the matching `docs/ui-exceptions.json` entries in the
   same commit. Never add a key or raise a count (the ratchet test fails it).
7. **Report failures verbatim** with counts. Node 24 prints `ℹ`, not `#`: an empty grep is not green.
8. **Stop rules.**
   - A change makes the pixel A/B (0.3) show ANY changed pixel: revert that change, keep the debt entry,
     note it in the Build log. Do not "fix" the look, do not ask; reverting is the answer.
   - A test fails after a deletion: if the test pins ONLY the deleted dead item, delete or trim that test
     in the same commit and name it in the commit message; if it pins anything live, you deleted
     something live: restore it.
   - Ask Dean (AskUserQuestion) for the W5 screenshot pick (planned), and otherwise only for: the noise run in 0.3 is not 0 changed pixels; a step's command
     does not exist or behaves unlike this plan says; the gate reaches a 3rd CHANGES round.
9. No em dashes in docs, commit messages or the ledger (plain hyphens). Do not narrate ceremony to Dean.

## Step 0. Setup, the pixel oracle, the census

**0.1** Environment + worktree check: `git -C <worktree> status` clean, `git log -1` = the plan commit
on top of 39707089.

**0.2** Baseline instruments on the untouched branch, recorded verbatim in the Build log:
`npm run lint:ui` (TOTAL 3225), `npm run lint`, `npm run lint:overlay`, `npm run test:unit` (count).

**0.3 The pixel oracle (the acceptance instrument for every wave).** Base = a second worktree:
`git -C /home/coder/projects/filetube worktree add .claude/worktrees/ux-cleanup-base 39707089` (detached;
symlink node_modules into it too). Playwright comes from `tools/capture/node_modules` (if missing:
`cd tools/capture && npm ci && npx playwright install chromium`). Read `test/visual/README.md` first.

- Seed ONCE into a fixed dir both trees share (media ids hash the path, so both must serve the same
  dir): `node test/visual/seed.js --data /tmp/ft-ab-data`. Never re-seed between A and B.
- Capture a tree: from that tree's root, `test/visual/start-server.sh /tmp/ft-ab-data <PORT> &`, wait for
  it to answer, then
  `BASE_URL=http://127.0.0.1:<PORT> node test/visual/capture.js --data /tmp/ft-ab-data --out <DIR> --era all --vp all`,
  then stop that server. Use port 3931 for base, 3932 for the branch. Run captures in the background;
  one full matrix can take a long time. Never run two captures at once (single-thread raster).
- Compare: `node tools/capture/compare.js <BASE_DIR> <BRANCH_DIR>` (read its header/argv for the exact
  flags and where it writes report.md). Pass = 0 changed pixels, 0 missing, 0 extra.
- **Noise run first:** capture the BASE twice (`/tmp/ft-ab/base1`, `/tmp/ft-ab/base2`) and compare them.
  It must be 0 changed pixels. If it is not, list the noisy scenes; if they are few and clearly
  animation/clock noise, exclude them by name for every later compare and write that down; if many,
  STOP and ask Dean.
- After that, `/tmp/ft-ab/base1` is the reference for every wave. Keep it until the branch merges.

**0.4 Census** (read-only; write the results into this plan's Build log as lists, before any edit):

- **Dead CSS:** every class and id selector in `public/css/style.css` and `public/css/ui.css` with no
  reference in `public/**/*.{js,html}`, `lib/**`, `server.js`, `public/sw.js` (if present). A class is
  REFERENCED if its full name appears anywhere OR it can be built at runtime: search for its prefix
  followed by a quote or `+`/`${` (e.g. `'subs-' +`, `` `subs-${ ``, `'theme-' +`), and for
  `classList.toggle/add` with a computed name. Treat whole families as live when any member is built
  dynamically (`mms-*`, `icon-*`, `theme-*`, `era-*`, `whcal-*`, `pk-*`, `ui-*` modifiers). A rule is
  dead only when EVERY selector in its selector list is dead.
- **Dead JS:** every top-level `function name(` and `const name = (`/`function` in `public/js/*.js`
  whose name appears exactly once across `public/**/*.{js,html}` (count words in ONE pass: build a
  word-frequency map of all files, then look names up; a per-name regex over 72k lines is too slow).
  Also check `window.X` / `FileTube.X` exports, string-keyed dispatch (`handlers[name]`), and
  `onclick="name(` in HTML/templates before calling one dead.
- **Raw values (W2):** from `docs/ui-exceptions.json`, the 377 keyed entries in 0.2's table, grouped by
  property, each with its raw value.
- **Legacy tokens (W3):** every legacy name `scripts/ui-lint.js` bans (`tokensInfo`: the alias block,
  the `/* legacy */` per-era names, `--fs-*`, `--scrim-legacy`, `RETIRED_ALIASES`), with its consumer
  count.
- **Stale docs (W4):** grep `docs/`, `AGENTS.md`, `README.md`, `.claude/agents/` (read-only there) for
  names that no longer exist: `.btn` (as a class to reuse), `.btn-label`, `setup-select`, `lint:css`,
  `css-token-lint`, `action-row-probe`, `--yt-red`, `--radius` (as advice), "emoji" icon set, every
  class W1 deletes.

Commit the plan with the census filled in (docs-only commit).

## W1. Delete dead code (commit "chore(cleanup): W1 delete dead UI code")

- Delete each dead CSS rule from the census. For a multi-selector rule, remove only the dead selectors.
- Delete each dead JS function from the census, and any now-unused constants it alone used.
- Keep a deleted-items list (name, file) for the commit message.
- Lower/delete the `docs/ui-exceptions.json` entries whose selectors you removed (lint:ui tells you
  which: it reports "below its entry").
- Tokens left with zero consumers in tokens.css are W3's, not W1's.
- Acceptance: pixel A/B = 0; `npm run lint:ui`, `npm run lint`, `npm run lint:overlay`,
  `npm run test:unit` green; `npm run test:geometry:fast` green. Record style.css line count before and
  after.
- If the list is large, split into W1a (CSS) and W1b (JS), each with its own A/B.

## W2. Raw values to tokens, same pixels (commit "chore(cleanup): W2 raw values to tokens")

For each of the 377 entries:
- Find a token whose computed value equals the raw value **in every era and mode the rule can apply
  to**. Era blocks in tokens.css override many tokens (`--r-md` is 12px in Modern and 0 in 2005), so a
  token that matches in Modern only is WRONG. Prefer tokens defined once on `:root` and never overridden
  in a `[data-theme]` / `[data-mode]` block. If the rule itself is scoped to one era (its selector
  carries `[data-theme="..."]`), matching that era is enough.
- Replace the raw value with `var(--token)` (or `calc()` over tokens), never with a new token minted
  just to hold the value.
- No exact era-safe token: leave it, keep its entry, and update its reason to
  `"raw value, no era-invariant token of the same value (true-up 2026-09-30): kept"`. Changing a reason
  string is allowed; the ratchet compares keys and counts.
- Acceptance: pixel A/B = 0; the four instruments green; lint:ui `no-raw-values` down by the number
  replaced, recorded.

## W3. Legacy tokens to roles, where exact (commit "chore(cleanup): W3 legacy tokens to roles")

- Build the value table: for each legacy name and each candidate role, the computed value in all 8
  era x mode combinations. Compute it in a browser (Playwright, the seeded server: set
  `data-theme`/`data-mode` on `documentElement`, read `getComputedStyle(documentElement).getPropertyValue`)
  rather than by reading tokens.css by hand. Paste the table into the Build log.
- A legacy name is retired at a use site ONLY when a role (or an existing `var()` of roles) equals it in
  all 8 combinations. Re-spell those uses. Where a legacy name has zero consumers left, delete its
  definition from every era block, and keep ui-lint's ban on it (check how `RETIRED_ALIASES` works; add
  the name there if deleting the definition would drop it from the banned set).
- No exact role (expected for most of `--fs-*`, `--yt-red`, `--border-dark`, `--btn-hover`,
  `--star-*`): leave it, keep its entries, reason becomes
  `"legacy token, no role equal in all 8 era x mode combinations (true-up 2026-09-30): kept"`.
- Tests that pin a legacy spelling (the UI pass plan, section on Step 7, lists this class of lock):
  re-spell the lock to the role in the same commit; it must still fail when the rule is broken (LESSONS
  2: break it once, watch it red, restore).
- Acceptance: pixel A/B = 0; four instruments green; `no-legacy-tokens` count recorded.

## W4. Docs tell the truth (commit "docs(cleanup): W4 docs match the design system")

- Fix every stale-docs hit from the census so docs name what exists: `ui.button`/`ui-btn`, `ui.confirm`,
  the icon registry, `npm run lint:ui`, the token roles. Do not edit harness-owned regions of AGENTS.md
  (between `harness:region` markers other than `id=project keep`) or `.claude/agents/*`.
- Update `docs/exec-plans/tech-debt-tracker.md` #289 (d): what this wave retired (counts) and what stays
  with its new reason; do not close #289 (its device checks and the out-of-scope items stay).
- Docs-only commit: the fast pre-commit path; no suite run needed.

## W5. Fresh README screenshots and copy (commit "docs(readme): W5 new screenshots and a fresher README")

Added by Dean (2026-09-30): "as part of the finished cleanup/snapshots ... replace snapshots in the
README and generally freshen up the readme". Do this AFTER W4, from the cleaned-up head, so the shots
show exactly what ships.

**5a. The shots come from the seeded fixture, never a real library.** `test/visual/seed.js` data is
synthetic (fictional channels, drawn thumbnails and art): safe to publish. Never photograph Dean's
server, a real channel, a real thumbnail or a creator's art.

**5b. Pick the set** (today's README: 3 desktop shots in the old light era, 4 phone shots in the dark
Modern era; ROADMAP chore: light and dark, desktop and phone, plus one of the Pocket with a skin).
Proposed set, 8 shots, scene ids from `test/visual/capture.js`:
- Desktop, large hero: `01-home` (2021 Modern, light).
- Desktop pair: `17-watch-top` (2021, dark) and `01-home` or `03-channel-page` in the 2005 Original
  era (light), to show the eras.
- Phone row of four: `01-home` (dark), `17-watch-top` or `18-watch-action-row-channel` (dark),
  `10-music-home` or `14-music-album-drill` (dark), and one `41-pocket-*` scene with a skin (Click or
  one of the iPod colorways; lighting off, as the scene already sets it).
- Optional fifth phone shot if it reads well: `50-books-library` or `08-podcasts-list`.
Capture them from the W4 head with `--only <ids> --era <era> --vp <vp> --dpr 2` into a scratch dir
(the seeded server as in 0.3). Leave out any shot with a toast, a spinner, a half-open sheet or a clipped
edge; pick a different scene instead.

**5c. Dean picks before anything is committed.** Build one contact sheet (a simple HTML page or a
stitched PNG: every candidate labeled with scene, era, mode, viewport), send it to Dean with
SendUserFile, and ask with AskUserQuestion: approve the set, or name swaps. This is the plan's only
planned Dean checkpoint besides the stop rules; wait for his answer.

**5d. Files.**
- New names describe the content, not the era word: e.g. `desktop-home-light.png`,
  `desktop-watch-dark.png`, `desktop-home-2005.png`, `phone-home-dark.png`, `phone-watch-dark.png`,
  `phone-music-dark.png`, `phone-pocket-<skin>.png`.
- Size budget: each file at most 1 MB, the new set at most 6 MB in total. No compressor is installed
  (pngquant/cwebp/ImageMagick are absent); if a PNG is over budget, re-encode it as JPEG quality 85
  with Playwright (open the PNG in a page, `page.screenshot({ type: 'jpeg', quality: 85 })` at its
  size), and use the `.jpg` name. Do not add a dependency for this.
- Delete the replaced images and the unreferenced old ones (`desktop1.png`, `mobile1.jpg`,
  `mobile2.jpg`, `mobilecomments.png`, the three `lightExampleOldEra-*`, the four `darkExampleEra-*`)
  only after `grep -rn "<name>" --exclude-dir=node_modules --exclude-dir=.git .` shows README.md as the
  sole reference (it did on 2026-09-30). Keep the banners, the logo and the icon.
- Stage images by name (`git add assets/images/<file>` each; `git rm` each deleted file).

**5e. Freshen the README copy.**
- Keep its skeleton (banner, badges, Screenshots, Features, Roku, extension, Quick Start, Configuration,
  Local development, Roadmap, License) and everything in Quick Start / Configuration / Local development
  that is still true. Check every command, env var, port and path against `docs/CONFIGURATION.md`,
  `docker-compose*.yml`, `Dockerfile` and `package.json` before keeping it; fix any that drifted.
- Update Features so it describes what ships today, in plain user language, one short line per
  feature. Source every claim from a ROADMAP.md Shipped entry (skins and the Pocket, the four eras, Watch
  later, Clean up suggestions, Share for any download, chapters, Liked, Listen/Watch keeping your place,
  and so on). Do not invent or oversell a feature; do not mention anything planned, parked or in a
  branch.
- Rewrite the Screenshots captions for the new set (alt text says what the shot shows).
- No em dashes; plain hyphens. Leave the existing emoji headings as they are unless Dean says otherwise.
  Keep the README shorter than or about as long as today (197 lines).
- Tick the ROADMAP chore "Refresh the README screenshots" with "DONE in v1.347.3".
- Acceptance: every `<img>`/`![]` path in README.md resolves to a file in the tree (script it:
  extract the paths, `test -f` each, count 0 missing); every link to a repo file resolves; Dean approved
  the shots in 5c. Docs/assets only: no suite run needed for this commit, and it cannot move the pixel
  A/B (it touches nothing under `public/`).

## Step 5. Verify, gate, release

**5.1 Full verification** (sequential, nothing else running, reviewers idle): `npm run lint:ui`,
`npm run lint`, `npm run lint:overlay`, `npm run test:geometry`, then `npm test` on Node 22.23.1 and
again on Node 24.20.0 (`$HOME/.local/share/fnm/node-versions/v24.20.0/installation/bin`). One final
full pixel A/B of HEAD vs `/tmp/ft-ab/base1`. Record every count verbatim in the Build log.

**5.2 Gate (full; scrutiny.toml forces it: tokens.css matches `**/*token*`, package.json matches deps).**
Spawn fresh `adversary`, `qa` and `security-brief` agents, each with {branch `chore/ux-cleanup`, base
sha 39707089, head sha, this plan}. Attack surfaces to name in the brief:
- **Inert/live confusion (LESSONS 11):** a "dead" CSS rule or JS function that IS reachable through a
  built class name, a template string, an HTML `onclick`, a `FileTube.*` export, or a skin/era scope.
  Ask the adversary to prove reachability for a sample of deletions against the running seeded app.
- **Era leaks:** a W2/W3 re-spelling that is equal in Modern but not in 2005/2009/2014, or not in dark.
  The pixel A/B covers the seeded scenes only; ask for a check of rules the scenes do not render.
- **Ratchet honesty:** every lowered count in ui-exceptions.json matches a real removal; no key renamed
  to dodge a count; reasons changed only as this plan allows.
- **Test weakening:** every deleted or re-spelled test pinned only dead code, and each re-spelled lock
  still fails on the break.
- **README truth (W5):** every feature claim traces to a Shipped entry; every command/env var/path in
  Quick Start and Configuration exists in the tree; every image resolves; no shot shows real content.
- **Out-of-scope drift:** nothing from the OUT list changed (`git diff 39707089 -- lib/ server.js`
  must be empty; no player-carve-out, skin, md-nav or showConfirmModal edits).
CHANGES: fix, re-engage the SAME seat for a delta re-confirm. After 2 CHANGES rounds, ask Dean before
round 3. Verdicts are written into this plan; commit them.

**5.3 Release v1.347.3** per `docs/RELEASING.md` and the protected-main flow in memory: `npm version
1.347.3 --no-git-tag-version`; ROADMAP.md Shipped entry above v1.347.2 (what was retired, the counts,
style.css lines before/after, "0 changed pixels across N shots", gate result, what stays and why); tick
tech-debt #289 (d) partially as in W4; the ROADMAP README chore ticked in W5; a `docs/releases.json` entry in plain user language (suggested:
title "A tidier app under the hood", body along the lines of "Old code left behind by the new look is
gone. Nothing looks or works differently."); a LESSONS.md entry only if the wave taught a reusable
lesson; `node scripts/plan-complete.js docs/exec-plans/active/2026-09-30-ux-cleanup.md "Shipped v1.347.3" --apply`.
Push, PR, unit CI green, merge, tag, delete branches, remove both worktrees (`rm node_modules` first).

**5.4 Report to Dean in two lines:** what was retired (counts, style.css lines before/after) and that
the look is unchanged (0 changed pixels over N shots); device check: "use it for a day; anything that
looks or acts different is a regression".

## Acceptance (all measured, all in the Build log)

- **AC1** Pixel A/B of the final head vs origin/main 39707089: 0 changed pixels, 0 missing, 0 extra, all
  eras, both modes, all viewports (minus any noise scenes named in 0.3).
- **AC2** `lint:ui` TOTAL strictly lower than 3225; every remaining entry in the W2/W3 scope carries
  either its original reason or the "kept" reason from this plan; no key added, no count raised.
- **AC3** Every item W1 deleted is in the census list with its reachability evidence.
- **AC4** Unit, geometry, lint, overlay green; full suite green on Node 22.23.1 and 24.20.0, counts
  verbatim.
- **AC5** `git diff 39707089 -- lib/ server.js` is empty; nothing in the OUT list changed.
- **AC6** Gate APPROVED by adversary, qa and security-brief, bound to the head sha.
- **AC7** README: the new shots are the set Dean approved in W5 (from the seeded fixture), 0 missing
  image paths, the old replaced images removed, each image at most 1 MB and the set at most 6 MB, and
  Features matches the Shipped entries.

## Build log

### Step 0 baselines (untouched base 39707089, Node 22.23.1)

- `lint:ui` TOTAL 3225; `lint` 0 errors, 6 warnings; `lint:overlay` clean (0 violations); `test:unit` 8012 tests, 8012 pass, 0 fail.
- Pixel oracle: seeded fixture /tmp/ft-ab-data (SEED_NOW=1788264000000, TZ=UTC), base worktree ux-cleanup-base, captures /tmp/ft-ab/base1 and base2.

### Census

- **Dead CSS (W1):** the class scan flagged 173 names, but nearly all are built at runtime (mms-*, icon-*, ui modifiers, skin classes). One rule is dead with no static or dynamic reference: `.audio-artwork` (deleted, 3 ratchet entries and 1 token-exempt annotation paid). No dead keyframes.
- **Dead JS (W1):** none outside the OUT list.
- **Raw values (W2):** 368 keyed entries (375 hits) carried the "same pixels as a token" reason. Era-invariant tokens with an equal value exist for many sizes, but most are the wrong role (font-size tokens as widths, avatar sizes as icon sizes), and `--hairline` is 0.5px at 2dppx so 1px borders cannot use it. 13 role-correct sites were re-spelled: `--ring-w` (focus outline and offset, spinner borders, sidebar drag indicators), `--progress-h`, `--grab-h`, `--icon-sm/md/lg`. The rest are kept with the "kept" reason.
- **Legacy tokens (W3):** computed table of all 185 tokens over 4 eras x 2 modes. Exact role matches: `--radius-lg` = `--r-md`, `--star-gold` = `--star`; `--yt-red-dark` had no consumers. All three definitions deleted and added to RETIRED_ALIASES (ban kept). Every other legacy token varies per era with no equal role: kept with the "kept" reason.
- **Stale docs (W4):** see W4 result below.

### Results per wave

- **A/B oracle:** noise run base1 vs base2 = 1896 scenes, 0 with differences; base1 vs branch1 (head after W1-W4) = 1896 scenes, 0 with differences. No pixel moved, so nothing was reverted.
- **W1 (dead CSS):** only `.audio-artwork` was dead; deleted (style.css 12224 -> 12214 lines).
- **W2 (raw values):** 13 role-correct sites moved to `--ring-w`, `--progress-h`, `--grab-h`, `--icon-sm/md/lg`; 19 `--radius-lg` and 2 `--star-gold` uses re-spelled. The other ~350 entries kept with a measured reason (equal-value tokens are the wrong role; `--hairline` is 0.5px at 2x so it cannot do 1px).
- **W3 (legacy tokens):** `--radius-lg`, `--star-gold`, `--yt-red-dark` retired (added to RETIRED_ALIASES so the ban stays); every other legacy token varies per era and was kept. `lint:ui` TOTAL 3225 -> 3183.
- **W4 (docs):** live docs already accurate; tracker #289 (d) marked done.
- **W5 (README):** 8 new screenshots (Dean's pick, synthetic seeded library), 11 old images removed, copy freshened; all README paths resolve.
