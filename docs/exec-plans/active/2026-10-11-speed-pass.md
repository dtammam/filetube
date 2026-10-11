---
plan: speed-pass
harness: v2 · full
branch: perf/v1.386.0-speed-pass
anchor: outcome
status: Building
next: W4 close-out (after numbers, device checks), then the FULL gate
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

## 7. Out of scope
Offline downloads (docs/references/ios-offline.md, its own plans); anything native; changing how any page looks.
