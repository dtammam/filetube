---
plan: speed-pass
harness: v2 · full
branch: perf/v1.386.0-speed-pass
anchor: outcome
status: Gate:CHANGES r2 @576a6bc8
next: round 3 (Dean asked): fix the r2 CRITICAL (pickHold left set by a superseding sticker pick) + WARNING (index cache unbound), then delta re-confirm
design: Dean's friction report (2026-10-11) and the Root's first read; measure-first. Base main = v1.385.0.
builder: smart (an open diagnosis: measure, decide the cause, then fix; shared caching rules touch every page)
gate: not yet run (FULL: adversary, qa - caching mistakes ship stale code to every device)
---

# v1.386.0: speed pass - the skin picker shows the right picture at once, the music library is responsive

Norms: no em dashes; stage by name; `git commit -F <file>`; never pipe a commit or push; fnm Node 22.23.1 PATH (local = Node 22);
never `--no-verify`; never self-merge. A status report NEVER ends your turn.

Read first: AGENTS.md; docs/LESSONS.md 0, 1 (numbers from an instrument), 2, 6, 8; docs/references/vpn-slowness-runbook.md and
the /diag performance page (v1.307.0) - reuse them; docs/references/ios-host.md (the app is a WKWebView that honours HTTP cache
headers like Safari).

## Step 0 (builder)
- Work ONLY in the launcher's worktree `.claude/worktrees/perf-v1.386.0-speed-pass`.
- Stop and ask Dean (AskUserQuestion) when: the measured cause is not what this plan guesses and the fix would be larger than a
  release; a fix would change what any page shows (this plan changes speed only); the gate reaches round 3; `gh pr merge` refused.

## 1. Outcome (Dean, 2026-10-11)
"I get some friction whenever I try to pick the transparent Coil. It takes a second to load. It's like a weird picture, and then
all of a sudden the image shows... When I open the music library, it takes a while for it to be responsive." The device pass is
the arbiter: picking any skin shows its real look at once; the music library is usable within about a second of opening, on
his server over the VPN and at home.

## 2. Leads from the Root's read (verify; do not assume)
- **Every static file is `Cache-Control: no-cache`** (server.js ~:3520-3527, express.static): the phone revalidates each asset
  on every use (a round trip each, painful over the VPN). Candidate: content-hashed or versioned asset URLs with a long
  `max-age, immutable`, keeping `no-cache` only for the HTML shells, so a new release still shows at once. Check how shells
  reference JS / CSS / assets today and how a release would bust the cache (the release must never leave a phone on stale code;
  that is the LESSONS-class risk here).
- **The transparent skins load three board images over 200 KB each** (public/assets/skins/transparent-board*.webp) only when
  picked, so the picker paints a placeholder first. Candidates: preload the boards when the picker opens (or when the Click /
  transparent family is visible), keep the current look until the new one has decoded (`img.decode()` before swap), and check
  the image sizes are right for the largest phone (re-encode if oversized; same look).
- **The music library loads the whole library up front**: GET /api/music (lib/music/routes.js ~:222) for ~23,000 tracks, then
  client work over all of it. Measure payload size (raw and compressed), server time, transfer time over the VPN, and client
  parse / render time separately before choosing: compression if missing, an ETag + 304 so an unchanged library is free, a
  smaller first page with the rest streamed or paged, list virtualisation, or deferring work until after first paint.

## 3. Waves
- **W1 Measure** (no fixes): with the /diag suite and headless WebKit + Chromium, time (a) opening the skin picker and picking a
  transparent skin, cold and warm; (b) opening the music library, cold and warm: request count, bytes, server ms, transfer,
  parse, render, time to interactive. Also a one-line instrument Dean can run on his phone if the headless numbers disagree with
  his experience (the log-collection export pattern). Write the numbers into the plan; name the cause of each friction.
- **W2 Assets**: the caching change for static assets (with the release cache-busting proof: a changed JS file reaches a phone
  that has the old one cached), skin preloading / decode-before-swap, image sizes.
- **W3 Music library**: the fixes the W1 numbers justify, in order of measured payoff.
- **W4 Close-out**: before / after numbers, device checks in docs/DEVICE-CHECKS.md (transparent Coil picked: no placeholder;
  music library responsive within ~1 s at home and over the VPN; a new release still shows at once after this), ROADMAP, LESSONS
  if earned.

## 4. Gate
FULL: adversary, qa. Brief: prove a release can never leave a phone (app or PWA) on stale JS / CSS (the single most dangerous
outcome of a caching change); a skin that shows the wrong look while loading; the music library dropping, reordering or
duplicating tracks after paging / virtualisation; restricted accounts still seeing only their items; numbers re-measured, not
quoted.

Gate: APPROVED r1 @d0e7d197 - security-brief (read-only source review, no Bash: no git diff, no runtime probe was run; all items below are traced in source unless marked reasoned)
- No CRITICAL, no WARNING.
- SUGGESTION (pre-existing, not introduced here): lib/music/routes.js POST /api/music/liked/:id checks ownTrack only, not trackVisibleTo, so a restricted member gets 200 vs 404 for a hidden track id (existence oracle) and can seed a liked row; the reads filter it back out. Out of scope for this release; ROADMAP candidate.
- INFO: lib/staticAssets.js sends no `X-Content-Type-Options: nosniff` (parity with the express.static it replaces; all bytes are shipped public/ files, no user content), so no new exposure.
- INFO (reasoned): lib/jsonCompression.js BREACH needs an on-path observer plus cookie-bearing cross-site repeats; the session cookie is HttpOnly SameSite=Lax (lib/auth/gate.js:87), JSON bodies carry no CSRF token or session secret, and the one token-bearing JSON (lib/feed/routes.js:305) is under the 8 KB floor.
- Verified clean: staticAssets traversal (one decode, STATIC_PATH, NUL, dot-segment and dotfile refusal, path.join + root prefix check; double-encoding resolves to a literal absent name), memory/CPU bounded by the shipped file set (entries keyed by existing absolute path, at most 2 encodings each; query variants add nothing), `v` arrays/objects fall to no-cache, IMMUTABLE is `private` and only for the exact hash; middleware sits after the auth gate, and the gate's allowlist (query stripped, same single decode) admits exactly the bytes staticAssets serves, so nothing new is reachable signed out and the login shell's ?v= URLs still pass. jsonCompression: GET 200 application/json only, skips set Content-Encoding and headersSent, no request data in headers. Shared snapshot: deepFrozen, keyed on adapter.sql + TEMP-trigger generation (only one writable connection), every switched site (music, queue, media, user-routes, feed, search, resolveRemoteTracks) runs trackVisibleTo per request; trigger SQL table name passes IDENT and comes from code. Stations WeakMap memo is viewer-free. skinArtUrls reads only same-origin skin-class rules the CSS itself would fetch, so no new request capability.

Gate: CHANGES r1 @d0e7d197 - qa
- Instruments (sandbox, Node 22.23.1): npm test exit 1, tests 12302 / pass 12282 / fail 9 / skipped 11; the 9 re-run in a git-initialised sandbox pass 101/101 (8 need `git ls-files`, absent from a `git archive` tree; ytdlp-playlist-job "Hide from feed ... tampered user id" was a load flake at load avg ~20, green alone). lint exit 0 (0 errors, 6 pre-existing warnings in common.js), lint:ui OK, overlay lint 0 violations, census set (route-census, route-read-classification, docs-diagrams-census, exec-plans-census, release-ledger, music-feature-store) 27/27.
- Verified: base-vs-head differential (3,000 tracks with accents, case, empty titles, addedAt ties, two roots, a path-restricted member): all 11 sorts x 2 pages, albums/artists x 6 sorts, search, stations, config, liked, queue, /api/search and restricted /api/music/:id, /track/:id, /albumart identical (244/244) before and after a store write; the member never sees the restricted root. CSS rewrite: 210 url()s, 207 stamped, only `?v=` inserted, every target exists. Signed out: the 11 login-shell stamped files 200 immutable; traversal/encoded/dotfile probes 401 signed out, 404 signed in. Skin art in real Chromium CSSOM: only the 3 Transparent skins wait. My 31 mutants: 26 killed.
- WARNING public/js/skin-surface.js:2048-2062 (Pocket Extras > Skins): the preview wait, the Select wait and the Select hold are unbound. Mutants survive skin-surface, pocket-skins-menu, music-skin-integration, music-sticker-menu/extras, music-pocket-menus: `whenSkinArt('preview', null, ...)` (preview shows at once), `whenSkinArt('pick', null, ...)` (Select repaints at once), and deleting `if (paintedSkinId) previewSkin = paintedSkinId;`. browser-cost.js only drives the sticker path, so the Pocket half of the fix the plan and ROADMAP claim has no instrument. Add jsdom tests on the pocket path (held whenSkinArtReady, as holdArt does for the sticker).
- WARNING docs/exec-plans/active/2026-10-11-speed-pass.md:95-97: "W1: before" is an empty heading in every commit since 4d657f26; the "Read together" bullets and ROADMAP ("before / after numbers in the plan") cite before tables that are not there. `node tools/speed-proof/table.js results/before-browser.jsonl results/before-skin.jsonl` prints them; the numbers quoted match (3888, 3905, 3698, 3249, 3026, 2958, 3766, 3759; 4-259 ms; 17,590-22,569 ms). Paste them in.
- SUGGESTION lib/music/stations.js:285-288: the comment says the topN call is "exactly the old sort-then-slice; test/unit/stations-style-memo.test.js", but reversing the id tiebreak at the call site survives every stations/collator test (that test binds topN with its own comparator; the oracle keeps topN in both builds). The code is right (my differential with addedAt ties matches), but the claim is not bound.
- SUGGESTION public/js/skin-surface.js:2048-2062 (reasoned, not run): after Select on the Coil, turning onto a no-photo row (preview applies at once) and pressing MENU before the Coil photos land sends onPreview(null), so previewSkin is cleared and getSkinId() returns the saved Coil before its photos are in. That briefly shows the frame without its photos, the exact symptom, until the pick callback fires.
- SUGGESTION lib/db/tableGeneration.js:7-9 and plan section 6 "every writer is seen": TEMP triggers see writes on this connection only. A second connection (an operator's sqlite3 CLI on a live box) leaves the snapshot stale until the next in-process write (measured: base drops the row, head still lists it). Say "every writer on this connection", or add `PRAGMA data_version` to the key.
- SUGGESTION public/errors.html:20, public/ui-kit.html:9: these pages are not rewritten shells, so their unstamped geist preload no longer matches style.css's stamped @font-face URL. The preload goes unused and the font downloads twice.
- SUGGESTION lib/staticAssets.js:6-8: "~30 files ... ~3.7 MB" does not match the shells (music.html 25 files, 4.37 MB) or the plan's 49 revalidations / ~4.5 MB. ROADMAP "lazily loaded view scripts (tv, books, read)" leaves out music, podcasts, history, feed, stats and cleanup, which also load unstamped on a soft nav.

Gate: CHANGES r1 @d0e7d197 - adversary
- Instruments (sandboxes, Node 22.23.1, load avg 7-10 from parallel seats): npm test on a `git archive` copy exit 1, tests 12302 / pass 12282 / fail 9 / skipped 11; all 9 are git-less-sandbox artifacts and pass in a git-initialised copy. eslint on every changed file exit 0; lint:ui OK. cache-bust-proof 10/10, its negative control 6 red (exit 1).
- WARNING (blocks) public/js/skin-surface.js warmSkinArtList + music-skins.js skinArtUrls: a new main-thread freeze on the skin-picking path. warmSkinArtList runs skinArtUrls for all 131 skins, each a full CSSOM walk (2,583 rules), synchronously, on EVERY onPreview with a Click skin and on every sticker Skin-page open (never memoised). Measured, sync ms of one click: sticker > Skin page open 471-532 (WebKit) and 1248-1334 (Chromium, 4x CPU throttle) vs 1-22 on base; Pocket Extras > Skins > Classic > 4G entry 301 (Chromium) / 518 (WebKit) vs 2-3 on base. Every highlight change between Click-skin rows calls it again (reasoned from syncPreview; one transition measured). No instrument or test sees it (browser-cost times tap to class, after the page is open). Fix: one CSSOM walk builds a class-to-urls index (memoised per document and stylesheet set), warm once per Skins-level entry, and add the page-open stall to browser-cost.
- WARNING (concur with qa) Pocket Extras > Skins half of the fix is unbound: mutants K1 (drop the Select hold), K2 (Select repaints at once), K3 (preview at once), K7 (no warm on the Skin page), K11 (Select repaints a dead surface) each leave skin-surface + skin-art-ready at 81 pass / 0 fail. Behaviour verified correct at this sha by my own drive (Pocket Select of the Coil with photos delayed 1.5 s: class lands after the photos in Chromium and WebKit, 0 ms; base 1503-1506 ms), but nothing holds it.
- SUGGESTION cache-bust-proof.js passes 10/10 against the mutant "immutable for ANY ?v=" (a deploy race then caches new bytes under an old stamp; a rollback re-serves them). test/unit/static-assets.test.js kills it; add an old-stamp-after-release check to the proof.
- SUGGESTION TEMP triggers slow bulk writes on the event loop: 23,000 rows insert 306 to 614 ms, update 307 to 602 ms, DELETE FROM all 17 to 440 ms (the trigger disables SQLite's truncate optimisation; restore wipes this way). Disclose in section 6.
- SUGGESTION GET /api/admin/backup (the Settings `<a download>`) now ships gzip/br (measured: 300-track bundle 19,173 bytes gzip). Chromium and WebKit saved valid JSON (verified); not named in the plan; add a device check (download a backup in Safari and the app, open it).
- SUGGESTION unbound guards: the snapshot's `shared.sql === adapter.sql` (mutant survives; production never swaps adapter.sql), and no test binds the hot routes to readPartShared (reverting visibleMusicList to musicDb.read() stays green); stations.js COLLATE swaps sit outside the collator oracle (a tie-break flip survives).
- Verified: base-vs-head differential, 558 responses (admin, path- and folder-restricted members; 14 sorts x 3 pages, albums/artists, search, stations, config, liked, queue, home, radio, /api/music/:id, /track, /albumart; accents, case, empties, addedAt ties) byte-identical. Snapshot freshness through mutate edit/insert/delete, a throwing write, restore wipe, reseed, reset; triggers fire on DELETE-all, FK cascade, REPLACE, roll back with a rollback, survive VACUUM and ADD COLUMN. 14 shells no-cache, every stamp immutable; 195 static files same status and type as express.static. Re-measured (loaded box, direction reproduced, absolutes not): Pocket Songs 5000 min 3011 to 427 ms, covers x12 254 to 4 ms; browser chromium vpn Home drawn 3814 to 1988 cold, 3253 to 843 warm, Coil without photos 263/136 to 0/0.

Gate: APPROVED r2 @576a6bc8 - security-brief (delta re-confirm of d0e7d197..576a6bc8 from head source; no Bash, so no git diff of my own; the coordinator reports the four signed-out probes ran on d0e7d197: 401, 401, 401, 200 no-cache for `?v=x&v=y`, which matches what r1 predicted)
- r1 SUGGESTION (POST /api/music/liked/:id existence oracle, existed before this release): accepted as a ROADMAP Planned > Bugs entry, per the coordinator. Not fixed here, and that is acceptable for this release.
- r1 INFOs unchanged; nothing NEW found.
- public/js/music-skins.js skinArtIndex: same trust boundary as r1. Cross-origin sheets are still skipped (try/catch on cssRules), only rules naming `.mms-*` with a url() are indexed, URLs are resolved against the sheet href, and the only sink is `Image().src` of the URLs the CSS would fetch itself. The WeakMap is keyed per document, and the cache key is the sheet count + hrefs. skin-surface.js runs warmSkinArtList through requestIdleCallback/setTimeout, which changes timing only.
- lib/db/tableGeneration.js: the data_version subquery is a constant string, the table name is still IDENT-checked and comes from code, and the key is now `gen:dv` (string compare in getAllShared). This also closes the outside-connection staleness r1 reasoned about.
- lib/staticAssets.js: absFor, STATIC_PATH, IMMUTABLE and middleware logic read the same as r1 (only the header comment changed). The readPartShared call sites are the same set, and each still runs trackVisibleTo.
- INFO (reasoned, from the adversary's note at line 90): GET /api/admin/backup now goes out compressed. It is admin-only and holds no attacker-reflected input, so the BREACH preconditions do not hold. No security action.

Gate: APPROVED r2 @576a6bc8 - qa
- r1 W1 (Pocket Extras > Skins unbound): fixed as prescribed. My three r1 survivors are now killed by the new pocket-skins-menu tests (preview no wait, Select no wait, Select no hold), and so are the MENU race (`previewSkin = next || pickHold` -> `next`), the warm removed, the warm on every highlight, and the warm run inside the tap. 14/17 of my r2 mutants killed.
- r1 W2 (empty before section): fixed. The before and after tables in section 6 match `tools/speed-proof/table.js` output line for line (20/20 each), and the Read-together numbers match the tables.
- r1 suggestions: the MENU race is fixed. The topN call-site tiebreak is bound (flip killed by the new "Recently added" test). PRAGMA data_version is fixed and bound (dropping `dv` from the key is killed): my base-vs-head differential is now 318/318 identical, including after a second-connection DELETE (r1: 74 stale). The double font fetch and the unstamped in-app script loads are disclosed. The staticAssets.js header numbers are corrected.
- Instruments on the 576a6bc8 sandbox (git-initialised): npm test tests 12310 / pass 12296 / fail 3 / skipped 11. All 3 failures are in files this branch never touched (chapter-snap-shift "400 mixed steps", native-bridge-wheel "HAPTIC_MIN_MS", ytdlp-oneshot-trace "X18 heartbeat") and failed under the load of my concurrent mutant run; those three files alone, run twice: 52 tests, 51 pass, 0 fail. lint 0 errors (6 pre-existing common.js warnings), lint:ui OK, overlay 0 violations, census set + new tests 69/69. In real Chromium CSSOM the index still yields art for exactly the 3 Transparent skins, the same URLs as r1. The music read routes have no new security surface (RBAC filter unchanged; the member never sees the restricted root in the differential).
- SUGGESTION (unbound, code correct) public/js/skin-surface.js `pickHold = null;` in the Select callback: deleting it survives every skin test. A jsdom probe shows the consequence: hold the target's photos, Select it, release, then preview the other row and press MENU. Real code shows the saved skin; the mutant shows the OLD skin under the new saved id. Worth a test.
- SUGGESTION (behaviour, not a broken look) skin-surface.js, the same callback: a waited Select that lands while the user is previewing another row clears that preview. jsdom probe: cursor on ipod-black, panel shows the saved ipod until the next wheel nudge. Before v1.386.0 the preview stayed. Restore the live preview instead of nulling it.
- Not findings: N12 (the stylesheet index ignoring its sheet key) survives, but the sheet set is fixed for a page's life. N17 (the feed label route back to `read()`) survives because the new routes test does not list feed, and it does not claim to.

Gate: CHANGES r2 @576a6bc8 - adversary
- Instruments (git-initialised `git archive 576a6bc8` copy, Node 22.23.1, load avg 11-16): npm test exit 0, tests 12310 / pass 12299 / fail 0 / skipped 11. cache-bust-proof 12/12; unversioned control fails 8, anyv control fails exactly the 2 old-stamp checks. Base-vs-head differential (558 responses, 3 users incl. 2 restricted) still byte-identical. skinArtUrls via the index returns the same URLs as r1 in Chromium and WebKit; Pocket Select of the Coil with photos delayed: 0 ms without photos in both engines.
- r1 W1 (Skin-list stall): fixed differently, accepted for the sticker page: Skin page open sync 31-42 ms (Chromium 4x throttle) / 1-13 ms (WebKit), was 1248-1334 / 471-532 (base 4-22 / 1-2). Residual: the index's one-time build (271 ms Chromium 4x, 60 ms WebKit) still lands inside the FIRST Pocket preview tap (whenSkinArt('preview') builds it synchronously): Classic > 4G entry 55-805 ms Chromium / 105-158 ms WebKit vs base 6-16. Once per page, so a SUGGESTION: build the index in idle when the panel first paints, or skip rules whose cssText has no url( before reading properties.
- r1 W2 (Pocket path unbound): fixed. Re-run against test/unit/pocket-skins-menu.test.js: K1, K2, K3, K11, MENU race, warm-every-highlight, warm-inside-the-tap, previewWarmed-never-reset all killed. D10 (hot route back to read()) and the albumart variant killed by music-shared-snapshot-routes; the Recently added tiebreak flip killed; data_version dropped from the key killed.
- CRITICAL (new, introduced by the pickHold fix; wrong look that persists) public/js/skin-surface.js onSkinChosen/onPreview: pickHold is cleared only in the Pocket pick callback, so a sticker chip pick that supersedes a waiting Pocket Select (same 'pick' channel) leaves pickHold set forever, and every later onPreview(null) paints the stale held skin. Repro (race3.js, transparent photos delayed 3 s, Chromium and WebKit): skin ipod; Pocket Extras > Skins > Custom > 5G > Select Transparent Coil; within the wait, sticker > Skin > ipod-2004; MENU x4 out of the Skins levels: panel `mms-ipod`, saved `ipod-2004`; still `mms-ipod` after pause/play. Base ends `mms-ipod mms-ipod-2004`; r1 sha also correct. Fix: clear pickHold when any pick starts (whenSkinArt('pick', ...) or the sticker path) or when its pick is superseded; add the sticker-supersedes-Pocket case to pocket-skins-menu.test.js.
- WARNING (the r1 W1 fix is unbound) public/js/music-skins.js skinArtIndex: deleting the cache return (`if (cached && cached.key === key) return cached.index;`) leaves skin-art-ready + pocket-skins-menu + skin-surface at 97 pass / 0 fail, and browser-cost's skinsPageOpenMs cannot see it (the warm now runs after the tap). Uncached, every skinArtUrls rebuilds (60-271 ms each) and the idle warm of 131 skins blocks for seconds. Bind it: count cssRules reads across two skinArtUrls calls on the stand-in CSSOM. Also unbound: the sticker Skin-page warm (r1 K7 on the sticker path, removing `warmSkinArtList()` at the Skin page survives) and the index key (key = sheet count only survives).

## 5. Release
docs/RELEASING.md + AGENTS.md; close the plan in the same PR (`node scripts/plan-complete.js
docs/exec-plans/active/2026-10-11-speed-pass.md "Shipped vX.Y.Z" --apply`); ask Dean before `gh pr merge`; shipped = the tag's
"Publish Docker Image" green. Take the next free minor if another release merges first.

## 6. Evidence (builder fills)

### W1: how it was measured (instruments in tools/speed-proof/, all committed)
- `serve.js` boots the REAL server on a throwaway DATA_DIR with a library the size of Dean's: 23,000 native tracks
  (1,917 albums, art on disk for every album) plus one playable WAV. `latency-proxy.js` puts a modelled link between
  browser and server: **home** = 4 ms RTT, 300 Mbit/s; **vpn** = 80 ms RTT, 20 Mbit/s (a model, not Dean's measured
  VPN: his /diag runs are the on-device instrument, see below).
- `browser-cost.js`: Playwright Chromium and WebKit, phone viewport (390x844, touch), 3 reps per cell, medians; a fresh
  server per cell; the server is idle between scenarios. (a) open /music cold (empty cache) and warm (a second open in
  the same profile): when the Home shelves are drawn FROM DATA (the "Recently added" shelf, not the skeleton), the end of
  the last main-thread stall over 50 ms, requests reaching the server by status, bytes on the wire, server ms per
  request (timed inside the server). (b) the Pocket sticker menu > Skin > Transparent Coil, cold and warm: when the
  Coil's class lands on the panel, when its board and ring photos arrive, and the gap between (the Coil shown WITHOUT
  its photos; decode time not included, so a lower bound).
- `api-cost.js`: every music call the browse view and the Pocket menus make, server ms (median of 5) and body size raw /
  gzip / brotli; `profile-floor.js`: a CPU profile of N requests of one URL.
- Raw outputs: tools/speed-proof/results/*.jsonl; the tables below are printed from them by `table.js`.
- Instrument limits, said plainly: Playwright's Linux WebKit kept NO HTTP cache between pages in a non-persistent
  context (its warm rows re-download everything; a persistent profile does cache, see the cache-busting proof), so WebKit
  warm rows are not Safari's; headless main-thread numbers are a desktop CPU, not a phone.
- On-device instrument: the existing /diag suite (v1.307.0, docs/references/vpn-slowness-runbook.md) already records
  every request of a tagged scenario on the phone ("Soft-nav: Home -> Music" covers the library; a skin pick shows as the
  board/ring requests). The headless numbers reproduce both of Dean's reports, so no new instrument was built.

### W1: before (main = v1.385.0, measured from a pristine `git archive` of the base)

| engine | network | open | Home drawn (ms) | last main-thread stall ends (ms) | requests reaching the server (200 / 304) | bytes over the wire | music API server ms (sum) | all server ms (sum) |
|---|---|---|---|---|---|---|---|---|
| chromium | home (4 ms RTT, 300 Mbit/s) | cold | 3888 | 3001 | 55 / 1 | 4.60 MB | 3167 | 19582 |
| chromium | home (4 ms RTT, 300 Mbit/s) | warm | 3905 | 3921 | 6 / 49 | 124 KB | 3938 | 22365 |
| chromium | vpn (80 ms RTT, 20 Mbit/s) | cold | 3698 | 3712 | 54 / 1 | 4.58 MB | 4328 | 17590 |
| chromium | vpn (80 ms RTT, 20 Mbit/s) | warm | 3249 | 3247 | 6 / 49 | 123 KB | 3901 | 22569 |
| webkit | home (4 ms RTT, 300 Mbit/s) | cold | 3026 | 3038 | 53 / 0 | 4.51 MB | 4222 | 7853 |
| webkit | home (4 ms RTT, 300 Mbit/s) | warm | 2958 | 2967 | 52 / 0 | 4.51 MB | 4041 | 6899 |
| webkit | vpn (80 ms RTT, 20 Mbit/s) | cold | 3766 | 3776 | 51 / 0 | 4.51 MB | 4072 | 7612 |
| webkit | vpn (80 ms RTT, 20 Mbit/s) | warm | 3759 | 3771 | 51 / 0 | 4.51 MB | 3958 | 6189 |

| engine | network | pick | Skin page opens (ms, page blocked) | tap -> Coil shown (ms) | Coil shown WITHOUT its photos (ms) | photos arrive after tap (ms) | photo bytes this pick | failed reps |
|---|---|---|---|---|---|---|---|---|
| chromium | home | cold | 6 | 8 | 51 | 57 | 360 KB | 1 |
| chromium | home | warm | 6 | 7 | 5 | 12 | 1 KB | 1 |
| chromium | vpn | cold | 6 | 7 | 257 | 264 | 364 KB | 0 |
| chromium | vpn | warm | 6 | 6 | 133 | 140 | 2 KB | 0 |
| webkit | home | cold | 2 | 5 | 16 | 21 | 360 KB | 0 |
| webkit | home | warm | 4 | 7 | 27 | 34 | 382 KB | 1 |
| webkit | vpn | cold | 2 | 4 | 239 | 243 | 364 KB | 0 |
| webkit | vpn | warm | 2 | 4 | 238 | 242 | 364 KB | 0 |

The skin rows were re-run at the fix round with the Skin-page-open column (3 of 24 reps failed to open the player on the
base tree, a probe-side flake; the medians are of the rest).

### W1: the named causes
1. **Skin picker** (Dean: "a weird picture, and then all of a sudden the image shows"): CONFIRMED. The Transparent skins'
   board (234 KB) and ring (125 KB) photos are CSS url()s that only start downloading when the new skin's class lands, and
   the class lands at the tap (4-8 ms), so the frame paints without them: 239-257 ms over the modelled VPN cold, and still
   133 ms warm in Chromium (every static file is `no-cache`, so even a cached photo waits a round trip) and 238 ms warm in
   WebKit (re-downloaded). Decode time comes on top.
2. **Music library** ("it takes a while for it to be responsive"): CONFIRMED, and the plan's lead was half right. Home does
   NOT load the whole library (4 small calls), but EVERY music call did whole-library work on the server: each one re-read
   and JSON-parsed all 23,000 track rows from SQLite (~130 ms) and sorted them with a per-compare `localeCompare(...,
   options)` that builds a collator per call (a title sort of one 5,000-row Pocket page: ~3 s); `/albumart/<id>` (one per
   cover), `/track/<id>` and `/api/music/<id>` read every row for a single lookup (~200 ms per cover). Node runs them one
   at a time, so one cold /music open cost 17.6-22.6 s of server time in Chromium and the Home shelves drew after ~3-3.9 s
   even on the home LAN. The client is not the cause (longest main-thread stall ~55 ms in Chromium; WebKit ~340 ms of
   script parsing in total).
3. **Static files** (both reports, worst over the VPN): every file under public/ was `no-cache` and uncompressed: a first
   open downloaded ~4.5 MB of JS/CSS, and every warm open revalidated 49 files, one round trip each (six at a time).
4. **Large JSON uncompressed**: a 1,000-song page 524 KB (41 KB as brotli); the Pocket's Songs list ~12 MB in 5,000-row
   pages.

### W2 / W3: what changed (speed only; no page looks different)
- **Static files** (lib/staticAssets.js): the shells (still `no-cache`) name each script, stylesheet and preload as
  `?v=<sha256 of the exact bytes served>`; stylesheets stamp their own url()s (fonts, icon masks, skin photos) the same
  way, so a changed image changes the stylesheet's hash too. A URL whose `v` equals the hash of the bytes being sent is
  `private, max-age=31536000, immutable`; ANY other request (no v, an old v, a made-up v, a file changed since) is
  `no-cache` as before. Text files go out brotli/gzip. Root files (the push worker, the manifest), byte ranges and URLs
  built in JS at runtime keep the old behaviour.
- **Skin photos** (music-skins.js + skin-surface.js): a pick keeps the current look until the new skin's photos are
  downloaded AND decoded (cap 4 s, then the old behaviour), read from the loaded stylesheets themselves (no hand-kept
  list); opening the Skin page (sticker menu, or the Pocket's Extras > Skins) starts every listed skin's photos. A skin
  with no photos, or photos already decoded, applies in the same tap as before.
- **Music server**: the list routes, albums, artists, stations, config, liked, `/api/music/:id`, `/track/:id` and
  `/albumart/:id` read a shared, FROZEN snapshot of the track rows (jsonRowStore.getAllShared), rebuilt only when SQLite's
  own write counter for music_tracks moves (lib/db/tableGeneration.js: TEMP triggers on INSERT / UPDATE / DELETE, so every
  writer on the server's connection is seen and a rolled-back write is undone with its count; a write from ANOTHER connection
  moves SQLite's `PRAGMA data_version`, which is part of the key since gate r1; nothing written to the database file). Writers are
  untouched (mutate() still diffs a fresh read). Visibility (RBAC) still filters per request. Sorts use one cached
  Intl.Collator per option set (the same order by ECMA-402; an oracle test compiles the module back to localeCompare and
  compares every sort and grouping).
- **JSON compression** (lib/jsonCompression.js): a GET's JSON 200 of 8 KB or more goes out brotli/gzip; Express's ETag and
  304 are untouched.

### W4: after (HEAD of perf/v1.386.0-speed-pass, the same instruments)

Browser (tools/speed-proof/results/after-browser.jsonl, re-run on cf006383 after the gate r1 fixes; 0 failed reps):

| engine | network | open | Home drawn (ms) | last main-thread stall ends (ms) | requests reaching the server (200 / 304) | bytes over the wire | music API server ms (sum) | all server ms (sum) |
|---|---|---|---|---|---|---|---|---|
| chromium | home (4 ms RTT, 300 Mbit/s) | cold | 612 | 0 | 144 / 1 | 3.05 MB | 797 | 1273 |
| chromium | home (4 ms RTT, 300 Mbit/s) | warm | 597 | 0 | 1 / 21 | 7 KB | 753 | 1161 |
| chromium | vpn (80 ms RTT, 20 Mbit/s) | cold | 1385 | 0 | 141 / 1 | 3.01 MB | 631 | 857 |
| chromium | vpn (80 ms RTT, 20 Mbit/s) | warm | 888 | 219 | 0 / 22 | 7 KB | 592 | 1194 |
| webkit | home (4 ms RTT, 300 Mbit/s) | cold | 813 | 830 | 104 / 0 | 2.44 MB | 857 | 1561 |
| webkit | home (4 ms RTT, 300 Mbit/s) | warm | 727 | 750 | 103 / 0 | 2.44 MB | 722 | 1354 |
| webkit | vpn (80 ms RTT, 20 Mbit/s) | cold | 1424 | 1435 | 103 / 0 | 2.44 MB | 704 | 1002 |
| webkit | vpn (80 ms RTT, 20 Mbit/s) | warm | 1387 | 1402 | 103 / 0 | 2.44 MB | 519 | 867 |

| engine | network | pick | Skin page opens (ms, page blocked) | tap -> Coil shown (ms) | Coil shown WITHOUT its photos (ms) | photos arrive after tap (ms) | photo bytes this pick | failed reps |
|---|---|---|---|---|---|---|---|---|
| chromium | home | cold | 6 | 40 | 0 | 1 | 169 KB | 0 |
| chromium | home | warm | 6 | 39 | 0 | -8 | 0 KB | 0 |
| chromium | vpn | cold | 7 | 237 | 0 | 207 | 360 KB | 0 |
| chromium | vpn | warm | 6 | 41 | 0 | -1 | 0 KB | 0 |
| webkit | home | cold | 2 | 87 | 0 | 36 | 360 KB | 0 |
| webkit | home | warm | 2 | 84 | 0 | 36 | 360 KB | 0 |
| webkit | vpn | cold | 2 | 288 | 0 | 256 | 363 KB | 0 |
| webkit | vpn | warm | 2 | 288 | 0 | 254 | 363 KB | 0 |

Server cost per call, 23,000 tracks, median of 5 sequential requests on loopback (results/before-api.jsonl, after-api.jsonl;
"after" bytes are brotli when the browser accepts it):

| call | server ms before | after | on the wire before | after |
|---|---|---|---|---|
| `/api/music/artists?limit=12&sort=newest` | 432 | 72 | 4 KB | 4 KB |
| `/api/music/albums?limit=12&sort=newest` | 349 | 57 | 3 KB | 3 KB |
| `/api/music?filter=recent-listening&limit=60` | 297 | 32 | 44 B | 44 B |
| `/api/music/stations` | 659 | 154 | 6 KB | 6 KB |
| `/api/music?sort=newest&limit=1000` | 374 | 123 | 524 KB | 41 KB |
| `/api/music/albums?limit=10000&sort=title-asc` | 598 | 118 | 566 KB | 112 KB |
| `/api/music/artists?limit=10000&sort=title-asc` | 466 | 62 | 41 KB | 11 KB |
| `/api/music?limit=1` | 386 | 90 | 489 B | 489 B |
| `/api/music?sort=title-asc&limit=5000&offset=0` | 3292 | 264 | 2.61 MB | 339 KB |
| `/api/music?sort=title-asc&limit=5000&offset=20000` | 3080 | 190 | 1.56 MB | 201 KB |
| `/api/music/albums?sort=title-asc&limit=5000&offset=0` | 500 | 117 | 566 KB | 112 KB |
| `/api/music/artists?sort=title-asc&limit=5000&offset=0` | 353 | 64 | 41 KB | 11 KB |
| `/api/music?filter=recent-listening&include=finished&limit=200` | 273 | 30 | 45 B | 45 B |
| `/api/liked?limit=1` | 239 | 3 | 43 B | 43 B |
| `/api/queue` | 236 | 3 | 46 B | 46 B |
| `/api/config` | 2 | 2 | 139 B | 139 B |
| `/api/history?limit=1` | 2 | 2 | 43 B | 43 B |
| `/api/subscriptions/health` | 2 | 3 | 163 B | 163 B |
| `/api/watch-later/ids` | 2 | 2 | 10 B | 10 B |
| `/albumart/<id>?s=256 (x12)` | 476 | 3 | - | - |

Read together (copied from the tables above):
- The Coil is never shown without its photos: 0 ms in all 8 cells (before: 5-257 ms; 133-257 ms over the VPN model). Over the VPN
  a first-ever pick shows 237-288 ms after the tap, the old look staying meanwhile (the probe taps 3 ms after the list opens,
  before the list's idle-time warm; a person reading the list for a moment gets the warm first); once cached, 39-41 ms in Chromium.
- The Skin page opens in 2-7 ms (before: 2-6 ms). Gate r1 measured the first draft at 471-532 ms in WebKit; the stylesheet index
  and the idle-time warm took that out.
- Home drawn: Chromium 3888 -> 612 ms cold / 3905 -> 597 ms warm at home; 3698 -> 1385 ms cold / 3249 -> 888 ms warm on the VPN
  model. WebKit 3026 -> 813 / 2958 -> 727 at home, 3766 -> 1424 / 3759 -> 1387 on the VPN model (its warm row re-downloads: see
  the instrument limits). Server time for one open: 17,590-22,569 ms -> 857-1,273 ms (Chromium, all requests summed).
- A warm open reaches the server with 0-1 x 200 + 21-22 x 304 (the shell, the API reads, /logo) instead of 6 + 49: no static
  file, font, icon or cover is asked for at all.
- The cold wire is ~3 MB now and was ~4.6 MB; the remaining bytes are mostly album covers, which now finish inside the window
  (each cover cost 476 ms of server time before, 3 ms now, so before most were still queued when the window closed).

### The cache-busting proof (plan section 4's most dangerous outcome)
`tools/speed-proof/cache-bust-proof.js` (results/cache-bust-proof.jsonl, on cf006383): Chromium and WebKit with a PERSISTENT
profile. Build A is opened, then re-opened (0 requests for the two files: cached); a release (server stopped, icons.js and
style.css changed to build B, a new server process on the same origin) is followed by an ordinary open: both engines run B for JS
AND CSS, each file fetched once under its new stamp; build A's OLD stamps, asked for after the release, answer B's bytes with
`no-cache` (never immutable); an edit on a running server also reaches the next open. 12/12 checks pass.
Negative controls: `SPEED_MUTANT=unversioned` (a year-long cache with no stamp; results/cache-bust-negative-control.jsonl) fails 8
checks (both engines stay on build A); `SPEED_MUTANT=anyv` (any stamp immutable, the gate r1 adversary's blind spot;
results/cache-bust-negative-control-anyv.jsonl) fails the 2 old-stamp checks. Unit and integration binding:
test/unit/static-assets.test.js (a census over every shipped static file: immutable only under the hash of its bytes, any other
stamp revalidates; the CSS bust chain; dotfiles refused), test/integration/static-assets-shells.test.js (every shell stamped and
`no-cache`, the login shell's files load signed out, root files keep `no-cache`, the /diag plain baseline stays plain).

### Disclosed (what this release does not do, and what it costs)
- Scripts the SPA router loads on an in-app navigation (the view scripts it fetches on demand, vr-view.js), `/logo`, and URLs built
  in JS at runtime carry no stamp: they revalidate on each load as before. errors.html and ui-kit.html are served as plain files
  (not shells), so their font preload is unstamped while style.css asks for the stamped font: the font downloads twice there.
- The TEMP triggers cost every write to music_tracks a counter update. The adversary measured 23,000 rows: insert 306 -> 614 ms,
  update 307 -> 602 ms, delete-all 17 -> 440 ms (a trigger turns off SQLite's whole-table delete shortcut; a restore wipes this
  way). A scan writes only changed rows, so this bites a full re-import or a restore, once.
- The backup download (GET /api/admin/backup) is JSON and over 8 KB, so it now goes out compressed; Chromium and WebKit saved
  valid JSON in the adversary's run (a device check below).
- The snapshot's connection-identity guard is unreachable today (the app never reopens its connection while running); it stays
  as a belt for a future reopen and is not bound by a test.
- Found by the security seat, older than this release: `POST /api/music/liked/:id` checks the track exists but not that the
  member may see it (ROADMAP Planned > Bugs).

### Suites
`npm test` on Node 22.23.1 (local), on the gate r1 fix tree (cf006383 + this evidence): `# tests 12310 / # pass 12300 / # fail 0 /
# skipped 10`, exit 0. Earlier, on the W4 tree: `# tests 12302 / # pass 12292 / # fail 0 / # skipped 10`, exit 0. (The first full
run, before the lock updates, was `# tests 12300 / # pass 12287 / # fail 3`: the cleanup shell's exact `<script src>` lock, the
DIAGRAMS registration count, and the music read census - each an intended change, updated with its intent kept.) `npm run lint:ui`:
OK (debt equals docs/ui-exceptions.json); eslint clean on every changed file. Node 24 runs in PR CI.

### Binding (my own sweep, before the gate)
20 mutants on the committed tree in a /tmp `git archive` sandbox, each against its test: 18 killed first time; the 2
survivors (a snapshot cached inside a transaction; the style memo on a mutable track) got tests (1e0db0ee) and are killed.
Gate r1 fix round: 12 more mutants on 0dd079b2 (the seats' Pocket survivors K1 K2 K3 K7 K11, the warm on every highlight and
inside the tap, the MENU race, the index's sideways filter, data_version dropped, visibleMusicList back to read(), the Recently
added tiebreak flipped): 11 killed first time; K1 (no hold at Select) got a test for the nothing-previewed-yet case (cf006383)
and is killed.

## 7. Out of scope
Offline downloads (docs/references/ios-offline.md, its own plans); anything native; changing how any page looks.
