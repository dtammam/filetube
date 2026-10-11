---
plan: speed-pass
harness: v2 · full
branch: perf/v1.386.0-speed-pass
anchor: outcome
status: Planned (kickoff 2026-10-11, Opus Root); builder not started
next: builder Step 0, then W1 (measure)
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
- W1 measurements (cold / warm, each step), the named causes, before / after numbers, the cache-busting proof, suites, gate rounds.

## 7. Out of scope
Offline downloads (docs/references/ios-offline.md, its own plans); anything native; changing how any page looks.
