---
plan: sub-bell-polish
harness: v2 · lean
branch: fix/sub-bell-polish
anchor: spec
status: Building
next: build B1 (in-place row bell) + B2 (the chip joins the .btn family) with their tests; measure per theme x mode with scripts/sub-row-chip-probe.js and the action-row probe; dual-Node suites; gate (adversary + qa + security-brief, forced by the lib/ytdlp/client glob); release v1.316.0 per docs/RELEASING.md
design: Approved 2026-09-23 @8536f399 (Dean: "GO." on the wave register D1-D4, recorded on feat/music-channel-chapters at 10c3be1e; this branch is the first slice of docs/exec-plans/active/2026-09-23-music-channel-chapters-wave.md)
gate: pending
---

# Subscription bell polish: no page refresh on toggle, the chip styled per era

Dean (from v1.314.0): "make sure the notification bell we picked not only doesn't refresh the
subscription page on toggle but is styled appropriately with the design language per theme."

Base: main 8536f399 (v1.315.0). The wave umbrella (register D1-D15, intake record, survey
anchors at v1.314.0) lives on `feat/music-channel-chapters`; this doc carries only the two bell
items and their bound markers (one piece, one plan).

## Decisions (from the wave register, Dean's go 2026-09-23)

| ID | Decision |
|----|----------|
| D2 | B1: after the PATCH resolves, update the clicked row IN PLACE from the response (glyph, `-active`, aria) and patch the record in `currentSubs`; no `loadSubscriptions()`. A non-2xx logs and leaves the row. Pause keeps its reload (out of scope). |
| D3 | B2: the row's bell, pin and kebab chips share the `.btn` rule family (a `btn btn-chip` variant) rather than a hand-copied per-era override. |
| D4 | B2 proof: computed-style + pixel sampling of the chip vs the era's `.btn`, side by side on one page, per theme x mode (2005/2009/2014/2021 x light/dark), plus the action-row probe before/after. The numbers are recorded below. |

## Diagnosis (read, not theorised)

- **B1 - the refresh.** `toggleBell` (lib/ytdlp/client/subscriptions.js) did `PATCH` then
  `loadSubscriptions()`, which clears the list, paints five skeleton rows, re-fetches
  `/api/subscriptions` and rebuilds every row. That IS the refresh Dean sees. The ~2.5s poll
  already updates rows in place (`applyStatusUpdatesInPlace`, keyed by `data-sub-id` through
  `rowElementsById`), and the watch page bell (`handleToggleBell`) already updates in place from
  the PATCH response. The PATCH route returns the updated record (`res.json(updated)`), so the
  response carries `pushBell`.
- **B2 - the styling.** `.sub-row-pin, .sub-row-bell` (and `.sub-row-kebab`) were ONE
  token-driven chip rule: `--bg-color` fill, a two-tone bevel border, `--radius`. That inherits
  each era's COLOUR tokens but never its control TREATMENT: the 2009 gloss is a
  `background-image` declared on `.btn` only (style.css :556/:567), the 2005 flat look, 2014
  flat and 2021 shadow all ride `.btn`'s `--btn-bg` + `--shadow`. The watch page bell is a
  `.btn` and already takes every era treatment; the row chips did not.

## Design

- **B1.** One writer of the bell's rendered state: `applyBellState(bellBtn, on)` (module
  level) sets class / aria-label / aria-pressed / glyph; `createSubscriptionRow` calls it at
  build time and `applyBellUpdateInPlace(rowElementsById, subId, on)` calls it after a PATCH
  (it finds the row's bell by class token, so it works on the real DOM and the unit fake).
  `toggleBell` disables the bell for the flight, PATCHes, and on 2xx reads `data.pushBell`
  from the RESPONSE (never the request), patches `sub.pushBell` + the `currentSubs` entry by
  id (the next tap reads it; a search-keystroke re-render rebuilds from it), then updates the
  row in place. A non-2xx logs `data.error || status` and leaves the row. `rowElementsById`
  is read at RESPONSE time, so a re-render mid-flight still lands on the live row. The tapped
  bell is disabled for its own flight; a rebuild mid-flight (Pause / Retry / search) builds a
  fresh enabled bell, and a second flight from it converges on server truth (#233 class).
- **B2.** A `.btn-chip` variant right after `.btn:active`: squares the box
  (`--size-control-sm`), drops the text padding, centres the glyph, rest colour
  `--text-secondary`. It declares NO background, border, radius or shadow of its own, so those
  can only come from `.btn` (locked by test). The three chip builders write
  `btn btn-chip sub-row-<x>`; the old chip rules keep only their state colours (hover red,
  active gold, the kebab's larger glyph).

## Acceptance (each names its binding test)

- AC1 (B1): toggling a row bell issues exactly one PATCH and NO `/api/subscriptions` list
  fetch after the initial load; the row element identity is unchanged after the toggle; the
  glyph/class/aria follow the RESPONSE (a response that differs from the request wins); the
  second tap sends the flipped value (the record was patched). `test/unit/sub-bell-in-place.test.js`
  (the real view mounted in jsdom, a routed fetch spy, driven clicks).
- AC2 (B1): a 403 leaves the row byte-identical (class/aria/glyph/identity), logs once, and
  still issues no list fetch. Same file.
- AC3 (B1): one writer - the source carries the bell glyphs exactly once (inside
  `applyBellState`), the row builder calls it, `toggleBell` no longer calls
  `loadSubscriptions`. `test/unit/sub-row-chip-btn-family.test.js`.
- AC4 (B2): every chip (pin, bell, kebab) is built with `btn btn-chip`; no rule targeting a
  chip class declares background / border / radius / shadow / size (vendor + case variants
  included); `.btn-chip` declares none of those either; the 2009 gloss still targets `.btn`.
  `test/unit/sub-row-chip-btn-family.test.js`.
- AC5 (B2, measured): for each theme x mode the chip's computed background-color,
  background-image, border colours, border-radius and box-shadow equal the era `.btn`'s on the
  same page, and the sampled top/bottom band pixels match the reference button's
  (`scripts/sub-row-chip-probe.js`, numbers below). The watch action row's `.btn` geometry is
  byte-identical before/after (`scripts/action-row-probe.js` at 390 and 1280).
- AC6: the existing v1.314 row tests keep passing with the new class shape (bell before the
  kebab, after the pin; off/on/junk/no-id arms; click never opens the settings sheet).
- AC7 (gate r1, adversary MB): a list rebuild MID-FLIGHT (Pause -> `loadSubscriptions`) - the
  held bell response lands on the NEW row and patches the NEW `currentSubs` record, so the next
  tap sends the flipped value. `test/unit/sub-bell-in-place.test.js` (the drive the seat
  prescribed). AC1 now also binds the in-flight `disabled` BEFORE the response (adversary ME/ME2).

## Gate r1 fixes (one commit after be9de1be)

- Adversary W1 (in-flight disable unbound): AC1 asserts `bell.disabled === true` right after
  the click, before the settle (not by double-dispatch: jsdom delivers synthetic clicks to
  disabled buttons). W2 (`currentSubs` patch unbound): AC7 above, the Pause-mid-flight drive.
  #3 + QA #4 (census gaps): `BOX_PROP` widened (min/max box, margin, inset, aspect-ratio,
  flex-*, box-sizing, opacity, transform/scale/translate/filter/mask/clip-path, `-o-`); a
  divergent-selector census (`.sub-row > button`, `.sub-list .btn` shapes) reaching the chips
  through an ancestor; the `.btn-chip` base rule may declare no min/max/margin/opacity either
  (MJ2). #4 (timing-vacuous skeleton assert): removed; the identity asserts bind no-rebuild.
  #5 / QA #3 / security INFO (re-render mid-flight leaves a fresh enabled bell): code unchanged,
  the toggleBell comment and the Design line now say exactly that (the #233 class, disclosed).
- QA #1: probe header `bottom-4`. QA #2: the two legacy CSS comments (FR-5 pin note, the
  `#dl-status-chip` note) now say the chips' box/bevel comes from `.btn.btn-chip`.

## Out of scope
Pause's page reload (same shape as B1, later); per-user bells; #233's in-flight race across an
unsubscribe on the WATCH page (this branch only disables the ROW bell for its own flight).

## Build record

- B1: `applyBellState` / `findBellButton` / `applyBellUpdateInPlace` (module level, exported);
  `createSubscriptionRow` routes its bell through the writer; `toggleBell` disables the bell for
  the flight, PATCHes, and on 2xx patches `sub.pushBell` + the `currentSubs` entry and updates
  the row in place from `data.pushBell`; a non-2xx logs and leaves the row.
- B2: `.btn-chip` after `.btn:active`; pin/bell/kebab built as `btn btn-chip <role>`; the two
  old chip rule blocks keep only their state colours; one phone-block exemption
  `.btn-chip { min-height: var(--size-control-sm) }` because the v1.95 `.btn { min-height: 44px }`
  touch floor otherwise stretched the square chip to 32x44 (measured at 390px, first cut).
- Tests: `test/unit/sub-bell-in-place.test.js` (4, the real view in jsdom),
  `test/unit/sub-row-chip-btn-family.test.js` (5), the v1.314 lock in
  `ytdlp-subscriptions-client.test.js` rewritten to the in-place shape, its chip-class
  assertions moved to a role-token helper.
- Instrument: `scripts/sub-row-chip-probe.js` (new; raw CDP, the tree's real row builder, a
  `.btn` reference on the same page, computed styles + 1x1 pixel bands, 2 widths x 4 themes x
  2 modes, a theme read-back guard). Its first cut was VACUOUS twice - common.js re-applied the
  saved theme over the query's, then the phone emulation laid out at 980px without a viewport
  meta - both caught by adding the read-back guard, both fixed in the instrument.

### Mutation check (committed tree 26cd0906, `git archive` sandbox, the three binding files)

Baseline green. 13/13 mutants killed: M1 re-fetch the list after the PATCH (AC1 x2 + the lock);
M2 glyph follows the REQUEST (anti-echo + lock); M3 record not patched (AC1 + lock); M4 row
rebuilt instead of updated (AC1 + lock); M5 a non-2xx flips the row (AC2); M6 the builder writes
the bell class itself / drops btn-chip (AC1, AC4, AC3 + 2 more); M7 the kebab leaves the .btn
family (AC4 + the anatomy test); M8 applyBellState forgets aria-pressed (5 tests); M9 a chip role
rule paints `-WEBKIT-BACKGROUND-IMAGE` (AC4 vendor+case); M10 `.btn-chip` declares `Border:`
(AC4); M11 the 2009 gloss moves onto a per-chip copy (AC4 x2); M12 the phone floor exemption
dropped (AC4); M13 `.btn-chip` moved before `.btn` (AC4 source order).

## Measurements (D4 / AC5)

`scripts/sub-row-chip-probe.js`, BEFORE = `git archive main` (8536f399), AFTER = this branch.
Per width x theme x mode: the bell chip's computed background-color / background-image /
border colours / border-width / border-radius / box-shadow vs the reference `.btn` on the same
page, and the top/bottom band pixels (x = left+6, y = top+3 / bottom-4).

| Run | Combos | Style diffs (bell vs `.btn`) | Chip box | Pixel bands |
|-----|--------|-------------------------------|----------|-------------|
| BEFORE | 16/16 | every combo differs: bg-color + bottom border on all; + bg-image (the gloss) and box-shadow on 2009; + box-shadow on 2021 | 32x32 | all three chips FLAT on 2009 (255,255,255 / 255,255,255 light; 20,18,16 dark) while the `.btn` is glossy (222 -> 198 light; 51,47,41 -> 35,31,26 dark) |
| AFTER | 16/16 | NONE on any combo (2005/2009/2014/2021 x light/dark x 390/1280) | 32x32 at both widths (the phone floor exemption holds) | 2005/2014/2021: chip pixels == `.btn` pixels top and bottom, all 3 chips. 2009: all 3 chips GLOSSY with the `.btn`'s own band colours within 1/255 (light 222->198 vs 222->198 at 390, 222->199 vs 221->199 at 1280; dark 51,47,41->34,30,26 vs 51,47,41->35,31,26) - the residual is the gradient sampled at a different relative height (32px chip vs 28/44px button), not a style difference (computed background-image is identical) |

Computed per era (AFTER, 1280 light, the bell): 2005 no gradient, radius 0, no shadow (flat
bevel); 2009 `linear-gradient(#e0e0e0, #c4c4c4)`, radius 2px, the 0.15 shadow; 2014 flat,
radius 2px, no shadow; 2021 radius 4px, the 0.1 shadow. All three chips sit on one row line
(`sameRowY`) at both widths.

`scripts/action-row-probe.js` at 390 and 1280 (BEFORE = the main archive via `FT_ROOT`,
AFTER = this tree): rows 1/1, column 358/358 (390) and 598/598 (1280), button geometry diffs
NONE - the `.btn` rule itself is untouched, only the `.btn-chip` variant was added.

## Gate r1 - security-brief (@e52a9325)

Trigger: the `**/*client*` path glob (lib/ytdlp/client/subscriptions.js). Context reasoned for:
solo-dev self-hosted server behind its own login; /subscriptions is manage-subscriptions territory.

**Tooling gap, stated first:** this seat has no Bash, so `git diff 8536f399..HEAD` was NOT run. I
reviewed the on-disk files the brief names (subscriptions.js, style.css, sub-row-chip-probe.js, the
three tests, this doc) by reading them directly, plus the server PATCH route and store for the
response contract. The file list itself is taken from the brief, not independently enumerated.

**No exploitable weakness found.** What was checked (verified = the exact code path was read):

1. **DOM writers (verified).** The only new writer is `applyBellState` (subscriptions.js:3134-3141):
   `className` / `aria-label` / `aria-pressed` / `textContent` are all chosen from FIXED literals by a
   boolean; no server or user string reaches the DOM. `toggleBell` (4266-4291) derives `on` as
   `!!(data && data.pushBell === true)`; `data.error` goes to `console.error` only (4279), never the
   DOM; a `res.json()` parse failure degrades to `{}`. The in-flight flag is `disabled = true/false`
   on the element found at click time. Grep of the client for `innerHTML|insertAdjacentHTML|
   outerHTML|document.write`: only comments and the existing no-innerHTML discipline notes; none in
   the tests or the probe either. The new "SECURITY: fixed literal" comment at :3132 is accurate.
2. **Client-side trust of the response (verified).** The applier keys on `subId` captured at click
   time (the same id the PATCH URL was built from), never on `data.id`; the server route
   (lib/ytdlp/index.js:5601-5615) looks the record up by `req.params.id` (store.js:1984) and returns
   THAT record, so keying by the request id is the right choice - keying by `data.id` would let a
   response steer a different row, keying by request id cannot. A 403 (or any non-2xx) takes the
   log-only arm and touches neither `sub`, `currentSubs` nor the row (AC2 test binds this). A stale
   response after a search re-render: `rowElementsById` is the closure `let` rebuilt per render
   (:4074-4081) and is read at RESPONSE time, so the update lands on the live row for that id or
   no-ops if the row is gone; `currentSubs` is patched by id. Worst case is a UI/state mismatch on a
   double-flight (see INFO below), never a cross-row or privilege effect. Server truth is unchanged:
   `requireManageSubscriptions` still gates the route and `validateSubscriptionPatch` /
   `validatePushBell` (store.js:327, :567-571, :2034-2038) still bound the value to a boolean.
3. **Probe static server (verified, INFO).** `new URL(req.url, 'http://x').pathname` is
   WHATWG-normalised, so `..`, `%2e%2e`, and `\` dot-segments collapse before the `startsWith`
   check and `path.join(ROOT, 'public', pathname)` can never leave `<root>/public`; `%2f` stays a
   literal and misses `existsSync`. Exposure: `<root>/public/{css,fonts,js}` (already public assets in
   the app) plus `lib/ytdlp/client/subscriptions.js` (client source), on 127.0.0.1, ephemeral port,
   for the seconds the dev script runs, with NO session cookie minted (unlike action-row-probe.js).
   `--root` is an operator CLI arg resolving any local dir, served only to loopback - operator
   self-trust, not an attack surface. Two INFO nits, not findings: (a) `theme`/`mode` query values
   are interpolated unescaped into the fixture HTML attributes (:72) - reflected only to the
   loopback requester who sent them, and the read-back guard at :211-212 aborts on any value that
   is not a real theme; (b) a request for a directory path (e.g. `/css/`) passes `existsSync` and
   `createReadStream(dir)` would emit an unhandled EISDIR and crash the probe - a local
   self-inflicted DoS of a dev tool. Neither matters for this deployment.
4. **Chromium flags (verified).** sub-row-chip-probe.js:166-167 are byte-identical to
   action-row-probe.js:140-141 (`--headless=new`, `--remote-debugging-port`, `--user-data-dir=<mkdtemp>`,
   `--no-sandbox`, `--disable-dev-shm-usage`, `--use-angle=swiftshader`, `--enable-unsafe-swiftshader`,
   `--hide-scrollbars`). Acceptable here: the browser only ever navigates to the loopback fixture
   serving this tree's own files, carries no credentials, runs in a fresh temp profile and is
   SIGKILLed on exit. The debug port is loopback-bound by Chromium's default; a local process could
   attach, but there is nothing behind it (no session). Same posture as the existing instrument.
5. **Auth / secrets / cookies / network / dependencies (verified none).** No route, RBAC check,
   validator, cookie or token handling changed; the PATCH route is untouched. The probe uses only
   node builtins (`http`, `fs`, `path`, `zlib`, `child_process`, global `fetch`/`WebSocket`) - no
   package.json change, no new dependency. `process.env.CHROME` is an operator-chosen binary path
   (same as the existing probe). Nothing in the diff reaches an external network.

INFO (functional, for the QA/adversary lane, not a security band): `inFlightBtn` is captured at
click time (:4269); a search-keystroke re-render mid-flight leaves the NEW bell enabled (the old,
detached one is what `finally` re-enables), so a second tap can put two PATCHes in flight and the
later-resolving response wins the glyph. Both responses are server truth for that id, so the only
effect is a possible transient glyph/server mismatch on a double-tap-during-re-render; the plan's
out-of-scope line already discloses the same race class (#233) on the watch page.

Pre-existing, out of this diff's scope, noted for the tracker only: the RBAC idiom
`if (deps.requireManageSubscriptions && !deps.requireManageSubscriptions(req, res)) return;` is
fail-OPEN when the dep is not injected (index.js:5770 comment acknowledges it). Unchanged by this
branch.

Gate: APPROVED r1 @e52a9325 — security-brief

## Gate r1 - qa (@e52a9325)

Reviewed `git diff 8536f399..HEAD` (7 files, +907/-84), HEAD = e52a9325 on fix/sub-bell-polish, working
tree clean at start (`git status` empty). Node 22.23.1 via the fnm PATH. Full `npm test` NOT run (per the
brief); the 9005/9005 claim in the build record and the 13/13 mutation table are the Architect's numbers,
not re-measured here.

### Instruments (verbatim)

- `npm run lint`: `✖ 7 problems (0 errors, 7 warnings)` - all 7 are pre-existing `no-unused-vars` in
  public/js/common.js (setTheme, homeFeedEnabled, setIconSet, addToQueue, openTranscriptFor,
  showChaptersEditor, shareExternalUrl); none in a changed file.
- `npm run lint:css`: `TOTAL 0  (the token census; ceiling ZERO since v1.61.0)`.
- `npm run lint:overlay`: `overlay-containment: clean (0 violations)`.
- `bash .harness/lib/check-markers.sh`: `✗ docs/exec-plans/active/2026-09-23-sub-bell-polish.md: stale
  approval @8536f399 — reviewed code changed since; re-gate` / `check-markers: 1 issue(s) found` (exit 1).
  That is exactly the known, tolerated shape: the design approval is bound to the base sha while the
  branch builds; nothing else is flagged.
- `node --test --test-reporter=tap test/unit/sub-bell-in-place.test.js`: `# tests 4 / # pass 4 / # fail 0`.
- `node --test --test-reporter=tap test/unit/sub-row-chip-btn-family.test.js`: `# tests 5 / # pass 5 / # fail 0`.
- `node --test --test-reporter=tap test/unit/ytdlp-subscriptions-client.test.js`: `# tests 320 / # pass 320 / # fail 0`.
- `node --test --test-reporter=tap test/unit/subscriptions-panels-behavior.test.js`: `# tests 3 / # pass 3 / # fail 0`.
- Em dashes in ADDED lines of the diff: `git diff 8536f399..HEAD | grep "^+" | grep -c "—"` = 0.
- `node scripts/sub-row-chip-probe.js <scratch>` re-run (exit 0, 16 JSON lines, empty stderr):
  `combos=16 combosWithStyleDiffs=0`; every chip `32x32` at 390 AND 1280 (ref `.btn` 93x44 at 390, 93x28
  at 1280); `sameRowY=true` on all 16; pixel bands: 2005/2014/2021 top+bottom identical to the ref on all
  three chips; 2009 light 390 `ref=222->198 bell=222->198`; 2009 dark 390 `ref=51,47,41->35,31,26
  bell=51,47,41->34,30,26`; 2009 light 1280 `ref=221->199 bell=222->199`; 2009 dark 1280
  `ref=50,46,40->35,31,27 bell=50,46,40->35,31,27`. The Measurements table's AFTER row is reproduced
  number for number. Bell/pin computed `color` = `rgb(224, 168, 0)` (the gold active accent) on all 16 -
  the state colour survives the move into the `.btn` family (the era `.btn` rules at style.css:556/:567
  declare only `background-image`, so nothing at 0-3-0 outranks the 0-1-0 role colours).

### Verified by reading (focus surfaces 1-6)

- B1 arms: `togglePause` still reloads and `PATCH /api/subscriptions/:id` returns `res.json(updated)`
  (lib/ytdlp/index.js:5601-5610) with `validateSubscriptionPatch` only setting provided fields
  (store.js:567-571), so a pause reload after a bell toggle rebuilds from the server's already-patched
  record. The settings sheet has no `pushBell` consumer (grep: only the row builder :2781 and toggleBell
  :4274-4285). `filterSubscriptions` (:3332) returns the SAME record references (slice/filter), so a
  search-keystroke rebuild and `sub.pushBell = on` agree. The poll's `applyStatusUpdatesInPlace` never
  touches the bell. Destroy/abort: a PATCH resolving after navigate-away writes a stale closure `sub`,
  the OLD closure's `currentSubs`, a detached row, and `.finally` re-enables a detached button - none of
  it reaches the live document or `listContainer`, so the missing `signal.aborted` check is harmless
  (togglePin/togglePause share the same posture); no finding.
- New-comment accuracy: `findChildByClassName` IS an exact `className ===` match (:3183), so the
  findBellButton comment is right; "four lines" = className/aria-label/aria-pressed/textContent; the
  2009 rules are at :556/:567 as both the CSS comment and the plan cite; `applyBellUpdateInPlace`
  returns the boolean it documents; the kebab block keeps only `font-size`; `10c3be1e` (cited in the
  frontmatter) exists on the tree.
- Standards: no `innerHTML` in the file (grep: comments only); createElement only; `--size-control-sm`
  is a contract token (design-token-audit-v1.1.md:59); `--fs-xl`/`--fs-2xl` exist (:116/:122); the one
  `token-exempt` (`line-height: 1`) is the same idiom the deleted chip rules carried.
- Test bindings: the in-place test mounts the real subscriptions.html + subscriptions.js in jsdom with
  the exact globals the shell provides (common.js's deriveAvatar/resolveAvatarSource, openOverlay,
  closeOverlayThen) and drives real bubbling clicks; the `settle` loop `assert.fail`s after 50 ticks -
  it cannot time out green; `skeleton-row` (:3214) is the real skeleton class, so the "no skeleton
  painted" assertion binds; the row/bell IDENTITY assertions bind "no rebuild" independently.
  `rulesTargeting`'s flat `[^{}]+\{[^{}]*\}` regex skips an `@media` prelude (the prelude's brace is
  followed by an inner `{`, so the match restarts after it) and sees the exemption rule inside
  `@media (max-width: 768px)` - proven by the passing `chip.length === 2` assertion; style.css has no
  `content:` string containing a brace (grep empty), so nothing derails it today. `BOX_PROP` catches
  `background:` and `border:` shorthands, upper case, `-webkit/-moz/-ms` prefixes and `outline`.
- Security surface: the only new DOM writer takes a boolean derived from `data.pushBell === true` and
  writes fixed literals; `data.error` goes to console only; the probe serves `<root>/public/{css,fonts,js}`
  + the client source on 127.0.0.1 at an ephemeral port with WHATWG-normalised pathnames (no traversal).
  No exploitable surface in this diff; the security-brief seat's deeper pass above agrees.

### Findings

1. SUGGESTION - scripts/sub-row-chip-probe.js:21 vs :216. The header says the bottom band is sampled at
   `bottom-3`; the code samples `rect.y + rect.h - 4` and the plan's Measurements section says
   `bottom-4`. A number in prose that does not match the code (the comment-accuracy class). Scenario: a
   future tuner "moves the sample one pixel up" from the header's number and lands on the border row.
   Fix: change the header to `bottom-4`.
2. SUGGESTION - public/css/style.css:8352-8355 and :8598 (untouched legacy comments the diff made stale).
   The v1.21 FR-5 note says `.sub-row-pin` "mirrors `.sub-row-kebab`'s chunky/beveled 32x32 silhouette
   (line ~1901 above)" and the `#dl-status-chip` note says its bevels "mirror `.sub-row-pin`'s beveled
   treatment above" - neither chip has a beveled treatment of its own any more (the diff deleted both
   rule blocks; the box now comes from `.btn`/`.btn-chip`). Scenario: a reader hunting for the pin's
   bevel to mirror it finds nothing. The rewritten v1.314/v1.316 note at :8370-8374 corrects the first in
   the same block, which is why this is not a WARNING. Fix: one clause each pointing at `.btn-chip`.
3. SUGGESTION - lib/ytdlp/client/subscriptions.js:4269/:4290 + the comment's last sentence (:4264-4265).
   `inFlightBtn` is the bell at CLICK time; a search-keystroke re-render mid-flight builds a NEW, enabled
   bell, and `.finally` re-enables the detached old one. Scenario: tap (slow PATCH) -> type a search
   character -> tap the new bell: two PATCHes fly (both `pushBell:true`, since the shared record is still
   unpatched), both responses are server truth, the later one lands on the live row - the end state is
   consistent, so "a double-tap cannot race two PATCHes" is true only without a re-render. Not a
   regression (v1.314 had no guard at all). Optional fix: re-find the bell in `.finally` via
   `findBellButton(rowElementsById[subId])` as well, or soften the comment.
4. SUGGESTION - test/unit/sub-row-chip-btn-family.test.js:48 + :477-486. `BOX_PROP` covers no
   `max-width`/`max-height`, `margin`, `inset`, `aspect-ratio`, `flex-basis`, `box-sizing`, nor the `-o-`
   prefix, and the census keys on the ROLE classes only. Scenario: a later `.sub-row-kebab { max-height:
   20px }` or a `.sub-row > button { border: 0 }` deforms/flattens the chip while AC4 stays green (no such
   rule exists today - grep of `.sub-row button`/`.sub-row > button` is empty). AC4's text claims "size"
   coverage; either widen the list or narrow the AC's wording.

No CRITICAL, no WARNING. The four suggestions are safe to ship disclosed; none changes behaviour the ACs
bind, and the ACs are each bound by a test that exists and asserts what the AC says (AC1/AC2 ->
sub-bell-in-place, AC3/AC4 -> sub-row-chip-btn-family, AC5 -> the probe re-run above, AC6 -> the 320
passing v1.314 rows).

Tree proof: before this append `git status --porcelain` showed only this plan doc (the other seats'
sections); no other file was touched by this seat; the probe wrote only under the session scratchpad.

Gate: APPROVED r1 @e52a9325 — qa

## Gate r1 - adversary (@e52a9325)

Reviewed `git diff 8536f399..HEAD` (7 files), HEAD = e52a9325 on fix/sub-bell-polish. Node 22.23.1.
Full `npm test` not run (per the brief). Every number below is this seat's own measurement.

### Instruments (verbatim)

- `node --test test/unit/sub-bell-in-place.test.js test/unit/sub-row-chip-btn-family.test.js
  test/unit/ytdlp-subscriptions-client.test.js`: `# pass 329 / # fail 0` on the committed tree AND in a
  `git archive HEAD` sandbox (the mutant base). The in-place test emits no console noise on mount.
- `node scripts/sub-row-chip-probe.js` on the committed tree: exit 0, 16 lines, empty stderr. 16/16
  combos `styleDiffs=NONE`; every chip 32x32 at 390 and 1280 (ref `.btn` 93x44 / 93x28); `sameRowY=true`
  x16; 2009 light 390 `ref 222->198 bell 222->198`, 2009 dark 390 `ref 51,47,41->35,31,26 bell
  51,47,41->34,30,26`; the plan's AFTER row reproduces number for number.
- Probe MUTANT (second sandbox, `btn` removed from the bell's className only, pin/kebab untouched):
  every combo reports bell diffs (`background-color` + border colours/width everywhere; +
  `background-image`/radius/shadow on 2009; + radius on 2014; + shadow on 2021), bell pixel bands
  mismatch top AND bottom, pin/kebab still match. The instrument sees a chip fall out of the family.
- Mutant battery: 21 mutants against the sandbox, each `diff -q`'d against HEAD before crediting and
  restored after. 15 killed, 6 survived: MB, ME, ME2, MI2, MI3, MJ2 (all below). Killed: MA no-op
  applier (2 red), MB2 drop `sub.pushBell = on` (LOCK only), MB3 drop both record patches (AC1 + LOCK),
  MC glyph follows the request (anti-echo + LOCK), MD non-2xx treated as success (AC2 + LOCK), MF never
  re-enable (3 red), MH rebuild instead of in-place (AC1 + LOCK), MH2 applier hits `.sub-row-info`
  (AC1 + applier test), MI `-WEBKIT-BACKGROUND-IMAGE` on a role rule (AC4), MJ phone exemption dropped
  (AC4), MK a second bell-class writer in the builder (5 red), ML pin loses `btn` (5 red), MM applier
  reads `document.querySelector('.sub-row')` instead of the map (applier test), MN request value read
  from the DOM aria instead of the record (LOCK).

### Reachability (surfaces 1-2, driven, not reasoned)

Rebuild arms enumerated: search input :4686 (`renderSubscriptions`), `loadSubscriptions` from Retry
:4141, the repull one-shot :4184, togglePause :4246, sheet actions :4348/:4370/:4432, initial :4681;
togglePin :4326; the poll :4641 is in-place only. `rowElementsById` is read at RESPONSE time in every
case. `filterSubscriptions`/`groupSubscriptionsByLetter` slice, never clone, so the row's closure `sub`
IS the `currentSubs` entry until `loadSubscriptions()` replaces the array. Scratch drive (sandbox only):
mount the real view, tap s1's bell with the PATCH HELD, click `.sub-row-kebab`, press the sheet's
Pause (immediate 200) -> `loadSubscriptions` rebuilds the rows (s1 shown OFF, its new bell enabled),
release the bell response `{pushBell:true}` -> the NEW row flips ON in place -> tap the new bell ->
the PATCH body is `{pushBell:false}`. Passes on the committed code: the in-place path is reachable and
survives a mid-flight reload. Server truth: the route awaits `store.updateSubscription` before
`res.json(updated)` (index.js:5601-5610), so a pause reload after a landed bell PATCH reads the
patched record.

### Findings

1. WARNING (presence-not-binding) - the in-flight disable guard is UNBOUND.
   lib/ytdlp/client/subscriptions.js:4269-4270 and :4290, claimed at :4264-4265 ("a double-tap cannot
   race two PATCHes") and in the plan's Design. Mutant ME (`inFlightBtn.disabled = true` removed):
   329/329 green. ME2 (the disable AND the `.finally` re-enable removed): 329/329 green. AC1's only
   `disabled` assertion is `=== false` AFTER the flight, which a never-disabled button satisfies; the
   anti-echo/AC2 settle predicates use `bell.disabled === false`, which under ME resolves before the
   response lands (still green only because the chain is microtask-only). Repro: apply ME2 to a
   sandbox, run the three files, 329 pass. Prescription: in AC1, immediately after the first
   `click(window, bell)` and before the settle, `assert.strictEqual(bell.disabled, true, 'disabled for
   the flight')` (verified red under ME2 in my drive). TRAP: do not bind it by dispatching a second
   click and counting PATCHes - jsdom delivers synthetic clicks to disabled buttons (measured on the
   CORRECT code: triple dispatch = 3 PATCHes with `disabled === true` after the first), so that lookalike
   is green on both sides.
2. WARNING (presence-not-binding) - the `currentSubs` by-id patch (:4285) is reachable and UNBOUND.
   Mutant MB (that one line removed): 329/329 green. The plan's M3 removed `sub.pushBell = on` and was
   killed by the SOURCE lock, not by behaviour (MB2: only the LOCK reds; AC1 stays green because `sub`
   is the same object). The forEach is the only thing that patches the record after a mid-flight
   `loadSubscriptions()` (Pause / repull one-shot / Retry). Repro = the drive above under MB: the new
   row flips ON, but the next tap sends `{pushBell:true}` again (the new record still says off), so the
   tap appears to do nothing and a search keystroke would snap the bell back to OFF. Prescription: add
   that drive as a fifth test in test/unit/sub-bell-in-place.test.js (hold the bell PATCH in a deferred
   promise, answer the pause PATCH with an immediate 200, find Pause via
   `[...document.querySelectorAll('button')].find((b) => b.textContent === 'Pause')` after clicking
   the kebab, assert the new row's bell flips ON and the third PATCH body is `{pushBell:false}`).
3. SUGGESTION - AC4 lock gaps, measured survivors: MI2 `opacity: 0.3; margin: 10px` on
   `.sub-row-kebab:hover` (green); MI3 `.sub-row > button { background: red; border: 3px dotted lime }`
   (green, the divergent-selector class); MJ2 `.btn-chip { min-width: 44px }` (green; the `.btn-chip`
   test checks fill/border/shadow but not size). None exists in the tree today (grep of
   `(sub-row|sub-section|sub-list|view-root)[^{]*\bbutton\b` in style.css + subscriptions.html is
   empty). Same class as QA #4; concur. Cheapest closure: also census rules whose selector contains
   `.sub-row` plus a `button`/`.btn-chip` token, and apply `BOX_PROP` minus width/height/padding/
   min-height to `.btn-chip`'s base rule.
4. SUGGESTION - test/unit/sub-bell-in-place.test.js:130 "no skeleton rows were painted" is
   timing-vacuous: under the old code the settle on the detached bell's `textContent` fails first, and
   the skeletons are gone by the time any assertion runs. The row/bell IDENTITY asserts are the real
   binding (MH red). Harmless; not the binding its label implies.
5. SUGGESTION - the security-brief INFO / QA #3 re-render race is real; measured shape from my drive:
   after a mid-flight reload the NEW bell is enabled (`disabled === false` asserted) while the old
   flight is pending. End state converges (both responses are server truth). Disclosed via the plan's
   out-of-scope line (#233); fine to ship.

Observation, no finding: critter mode weights `.btn` anchors x3 (public/js/common.js:7869, :7878);
each row now carries 2-3 `.btn` chips, so critters will favour the chips on /subscriptions. Cosmetic.

### B2 blast radius (surface 4), skeleton (6), security (7) - verified by reading every `.btn` rule

`.btn:disabled` opacity .6 (the bell in flight dims: correct); `.btn:hover` bg `--btn-hover`;
`.btn:active` translateY(1px) + shadow none (chips now press like buttons); the transition list;
`touch-action` already covered `button` (:12); the 44px phone floor is exempted by the later
same-specificity `.btn-chip` rule inside the same media block (MJ red); no `#view-root`/`.sub-*`-scoped
`.btn` rule exists; `.header-right .btn { display:none }` cannot reach the row; `[data-theme="2005"]
a.btn` is anchor-only; `.btn-busy` is only added by common.js `setBusy` on buttons it is handed. Exact
className consumers: `findChildByClassName` is called only for status/failures/warning
(:3078/:3110/:3117), never a chip; tools/capture/scenes.js uses `.sub-row-kebab` as a selector (token
match); the kebab's `font-size` (:3986) outranks `.btn-chip` by source order. Skeleton: `* { box-sizing:
border-box }` (:735), chips measure 32x32, the avatar is 36px (`--size-control`), so the row's cross size
was and is set by avatar+info, which the skeleton mirrors; unchanged. Security: DOM writers take
`!!(data && data.pushBell === true)` only; `data.error` -> console.error; no innerHTML. Probe URL
handling tested: `/css/../../etc/passwd`, `/css/%2e%2e/%2e%2e/etc/passwd`, `/js/../../../etc/passwd`,
`/fonts/%2E%2E/%2E%2E/AGENTS.md` normalise to a non-prefixed pathname and are rejected;
`/css/..%2f..%2fetc/passwd` and `/css/....//....//etc/passwd` pass the prefix but resolve to literal
non-existent names under public/css. Loopback, ephemeral port, no credentials, not served by the app.
Concur with security-brief.

Tree proof: `git status --porcelain` before this append = ` M docs/exec-plans/active/2026-09-23-sub-bell-polish.md`
only (the seats' sections); all mutants ran in `git archive HEAD` sandboxes under the session scratchpad,
each restored and `diff -q`'d against HEAD; the scratch drive lives only in the sandbox; no pre-existing
untracked files.

Verdict: CHANGES. Two protections the plan claims (the flight disable, the `currentSubs` patch) each
survive a no-op mutant at 329/329; the shipped code is correct, the fixes are test-only (one assertion +
one drive). Re-engage this seat for r2 with the fix sha.

Gate: CHANGES r1 @e52a9325 — adversary (see findings)
