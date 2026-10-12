---
plan: speed-pass
harness: v2 · full
branch: perf/v1.386.0-speed-pass
anchor: outcome
status: Building
next: the FULL gate (adversary, qa, security-brief) on this sha
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
| chromium | home | cold | n/a | 6 | 10 | 16 | 360 KB | 0 |
| chromium | home | warm | n/a | 6 | 4 | 10 | 1 KB | 0 |
| chromium | vpn | cold | n/a | 6 | 259 | 265 | 364 KB | 0 |
| chromium | vpn | warm | n/a | 7 | 136 | 142 | 2 KB | 0 |
| webkit | home | cold | n/a | 4 | 16 | 20 | 360 KB | 0 |
| webkit | home | warm | n/a | 4 | 14 | 18 | 360 KB | 0 |
| webkit | vpn | cold | n/a | 5 | 238 | 243 | 364 KB | 0 |
| webkit | vpn | warm | n/a | 5 | 240 | 245 | 364 KB | 0 |


### W1: the named causes
1. **Skin picker** (Dean: "a weird picture, and then all of a sudden the image shows"): CONFIRMED. The Transparent skins'
   board (234 KB) and ring (125 KB) photos are CSS url()s that only start downloading when the new skin's class lands, and
   the class lands at the tap (4-7 ms), so the frame paints without them: 238-259 ms over the modelled VPN cold, and still
   136 ms warm in Chromium (every static file is `no-cache`, so even a cached photo waits a round trip) and 240 ms warm in
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
  writer is seen and a rolled-back write is undone with its count; nothing written to the database file). Writers are
  untouched (mutate() still diffs a fresh read). Visibility (RBAC) still filters per request. Sorts use one cached
  Intl.Collator per option set (the same order by ECMA-402; an oracle test compiles the module back to localeCompare and
  compares every sort and grouping).
- **JSON compression** (lib/jsonCompression.js): a GET's JSON 200 of 8 KB or more goes out brotli/gzip; Express's ETag and
  304 are untouched.

### W4: after (HEAD of perf/v1.386.0-speed-pass, the same instruments)

Browser (tools/speed-proof/results/after-browser.jsonl; the Coil pick rows: before had 0 failed reps too):

| engine | network | open | Home drawn (ms) | last main-thread stall ends (ms) | requests reaching the server (200 / 304) | bytes over the wire | music API server ms (sum) | all server ms (sum) |
|---|---|---|---|---|---|---|---|---|
| chromium | home (4 ms RTT, 300 Mbit/s) | cold | 640 | 644 | 144 / 1 | 3.07 MB | 767 | 1707 |
| chromium | home (4 ms RTT, 300 Mbit/s) | warm | 585 | 569 | 0 / 22 | 7 KB | 730 | 1219 |
| chromium | vpn (80 ms RTT, 20 Mbit/s) | cold | 1401 | 0 | 142 / 1 | 3.03 MB | 777 | 1054 |
| chromium | vpn (80 ms RTT, 20 Mbit/s) | warm | 894 | 911 | 0 / 22 | 7 KB | 585 | 924 |
| webkit | home (4 ms RTT, 300 Mbit/s) | cold | 742 | 778 | 104 / 0 | 2.44 MB | 698 | 1347 |
| webkit | home (4 ms RTT, 300 Mbit/s) | warm | 746 | 772 | 103 / 0 | 2.44 MB | 647 | 1257 |
| webkit | vpn (80 ms RTT, 20 Mbit/s) | cold | 1520 | 1528 | 103 / 0 | 2.44 MB | 875 | 1507 |
| webkit | vpn (80 ms RTT, 20 Mbit/s) | warm | 1411 | 1421 | 103 / 0 | 2.44 MB | 567 | 1137 |

| engine | network | pick | tap -> Coil shown (ms) | Coil shown WITHOUT its photos (ms) | photos arrive after tap (ms) | photo bytes this pick | failed reps |
|---|---|---|---|---|---|---|---|
| chromium | home | cold | 23 | 0 | -30 | 0 KB | 0 |
| chromium | home | warm | 24 | 0 | -34 | 0 KB | 0 |
| chromium | vpn | cold | 176 | 0 | 145 | 360 KB | 0 |
| chromium | vpn | warm | 27 | 0 | -26 | 0 KB | 0 |
| webkit | home | cold | 9 | 0 | -67 | 0 KB | 0 |
| webkit | home | warm | 8 | 0 | -63 | 0 KB | 0 |
| webkit | vpn | cold | 158 | 0 | 126 | 125 KB | 0 |
| webkit | vpn | warm | 160 | 0 | 126 | 125 KB | 0 |

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
- The Coil is never shown without its photos: 0 ms in all 8 cells (was 4-259 ms; 136-259 ms over the VPN model). Over the VPN
  a first-ever pick shows 158-176 ms after the tap (the old look stays meanwhile); once cached, 8-27 ms.
- Home drawn: Chromium 3888 -> 640 ms cold / 3905 -> 585 ms warm at home; 3698 -> 1401 ms cold / 3249 -> 894 ms warm on the VPN
  model. WebKit 3026 -> 742 / 2958 -> 746 at home, 3766 -> 1520 / 3759 -> 1411 on the VPN model (its warm row re-downloads:
  see the instrument limits). Server time for one open: 17,590-22,569 ms -> 924-1,707 ms (Chromium, all requests summed).
- A warm open reaches the server with 0 x 200 + 22 x 304 (the shell, the API reads, /logo) instead of 6 + 49: no static file,
  font, icon or cover is asked for at all.
- The cold wire is ~3 MB now and was ~4.6 MB; the remaining bytes are mostly album covers, which now finish inside the window
  (each cover cost 476 ms of server time before, 3 ms now, so before most were still queued when the window closed).

### The cache-busting proof (plan section 4's most dangerous outcome)
`tools/speed-proof/cache-bust-proof.js` (results/cache-bust-proof.jsonl): Chromium and WebKit with a PERSISTENT profile.
Build A is opened, then re-opened (0 requests for the two files: cached); a release (server stopped, icons.js and style.css
changed to build B, a new server process on the same origin) is followed by an ordinary open: both engines run B for JS AND CSS,
each file fetched once under its new stamp; an edit on a running server also reaches the next open. 10/10 checks pass.
Negative control (`SPEED_MUTANT=unversioned`, a year-long cache with no stamp; results/cache-bust-negative-control.jsonl): the 6
release checks FAIL (both engines stay on build A), so the proof sees the danger it guards. Unit and integration binding:
test/unit/static-assets.test.js (a census over every shipped static file: immutable only under the hash of its bytes, any
other stamp revalidates; the CSS bust chain), test/integration/static-assets-shells.test.js (every shell stamped and
`no-cache`, the login shell's files load signed out, root files keep `no-cache`).

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
`npm test` on Node 22.23.1 (local), on the W4 tree: `# tests 12302 / # pass 12292 / # fail 0 / # skipped 10`, exit 0. (The first full
run, before the lock updates, was `# tests 12300 / # pass 12287 / # fail 3`: the cleanup shell's exact `<script src>` lock, the
DIAGRAMS registration count, and the music read census - each an intended change, updated with its intent kept.) `npm run lint:ui`:
OK (debt equals docs/ui-exceptions.json); eslint clean on every changed file. Node 24 runs in PR CI.

### Binding (my own sweep, before the gate)
20 mutants on the committed tree in a /tmp `git archive` sandbox, each against its test: 18 killed first time; the 2
survivors (a snapshot cached inside a transaction; the style memo on a mutable track) got tests (1e0db0ee) and are killed.

## 7. Out of scope
Offline downloads (docs/references/ios-offline.md, its own plans); anything native; changing how any page looks.
