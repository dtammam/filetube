# Smoothness audit: why FileTube loads in stages (analysis only)

Status: ACTIVE (analysis only, 2026-11-08). No app code changed. Input for Dean's pick of a first wave; not a build plan yet.

## Executive summary

1. FileTube is NOT a plain multi-page app: every in-app hop (home, watch, music, tabs, back) is the SPA-lite router in common.js swapping `#view-root` with `pushState`. Measured: no hop in the core flows was a document load. So cross-document view transitions and bfcache (fixes B-cross-doc, D) do not apply to what Dean feels.
2. Biggest single cause of the black player, now proven on Dean's own layout: a card on the **Modern** home carries no `filePath` / `size` / `hasThumbnail` (server.js `resolveModernGridItem`), so the v1.52 "instant watch" seed fails `isFullWatchSeedItem` and the player does not start until the page HTML plus two API calls return. Title paints at once, the player box stays black. Reproduced in Chromium (black 215-415 ms on a VPN model) and on the iPhone recording (black 2.4 s).
3. Under the app's native video surface the web removes the poster on purpose and opens a see-through hole before native has a frame, so even a seeded video shows black until AVPlayer's first frame (code-proven; duration needs the device).
4. Every in-app tap first waits for the destination's whole HTML shell (35-44 KB, uncompressed, `no-cache`) and, for Music, a lazy `music.js` loaded with an unversioned URL, in series. Measured dead time after a tap before anything changes: 110-260 ms on the VPN model, 390-930 ms on the cell model.
5. Music opens on an empty skin frame ("Unknown track", white art box) for 2 serial API round trips: measured 195-330 ms (VPN model), 735 ms (cell model), 0.5 s on the iPhone. The tapped card already holds the title and art.
6. Cold launch: a 1.9 s black screen with a native spinner, then the skeleton, then content at about 3.8 s (iPhone). In the browser model the critical chain is HTML, all scripts, then `/api/config` -> `/api/settings` -> `/api/videos` in series, behind about 28 boot API calls (several duplicated).
7. Dean's "thumbnails change after Back" is not a thumbnail bug: the moving frames are the Modern home's preview clips (`PreviewCards`, 1.5 s delay), and after Back they never restart because restored cards keep `data-pv-obs` and are never re-observed (code-traced).
8. Recommended first wave: (a) fix the Modern seed and cover the player with the tapped thumbnail until the first frame (web + one add-only native signal); (b) cache view shells in memory and load lazy view scripts in parallel and versioned; (c) seed the Music player from the tapped item.
9. Second wave: launch (native splash held until first content, last-known home painted from storage, boot fetch diet), the preview-restart bug, a 150 ms shimmer delay. View transitions (same-document only) after that, gated on a device check.
10. Not measurable here: anything native (AVPlayer first frame, splash, media token), real WebKit on iOS, Dean's real network and library size. The cheapest closers are named in the last section.

## Method and honesty notes

- Instrument: a throwaway probe (scratchpad `smooth-audit/sa-probe.js`, not committed) boots this repo's real server on a scratch DATA_DIR with 30 real H.264 videos (1280x720, faststart), 40 real AAC tracks with 140-320 KB art, and a listening history, then drives Playwright 1.62 (tools/capture) Chromium 151 and WebKit 26.5 at 390x844 touch. A per-frame sampler records view, skeleton count, cards with decoded thumbnails, watch title, video poster / readyState, the music panel's text and art, plus Resource Timing; Chromium also records a CDP screencast picked every 100 ms.
- Network model: tools/speed-proof/latency-proxy.js. home = 4 ms RTT 300 Mbps; vpn = 80 ms RTT 20 Mbps (the speed-pass VPN model); cell = 300 ms RTT 5 Mbps. HTTP/1.1, no TLS, no loss.
- CPU: Chromium 1x and 4x throttle (CDP). WebKit cannot throttle and runs at DPR 1: at DPR 3 the Linux WPE build's software raster made the music skin frames take 1.4-1.6 s each (measured: rAF gaps of 1636 ms and 1364 ms), which vanished at DPR 1 (max 167 ms). That is a raster artifact of this box, not iOS.
- Chromium is not WebKit, and Linux WebKit is not iOS WebKit (GStreamer media, software raster). Every number below is "measured" in that model, n = 1 per cell, box load average 2.5-6.7 during runs (other projects). Treat them as ratios and chains, not device times. "Inferred" and "code-traced" are marked.
- Library shape: Classic home unless noted; Dean uses Modern. Runs are labelled.
- Chromium cell-model runs crashed on a navigation timeout and were not re-run; WebKit cell ran.

## Device measurements (Dean's iPhone, iOS app, Wi-Fi, 2026-11-08)

Dean's screen recordings (`/home/coder/smooth-recordings/`, rec1 = FileTube, rec2 = YouTube app), about 60 fps, measured by frame luma at 10-20 fps, +-0.1 s. I also read rec1 at 2 fps to trace causes.

| Flow | FileTube (iPhone) | YouTube app |
|---|---|---|
| Cold launch | icon tap -> 1.9 s pure black with a small native spinner -> 1.8 s grey skeleton -> content at about 3.8 s -> cards first show the item's own thumbnail (for these JRE items, the show logo), preview clips replace two of them at about 5.4 s; the image behind the bottom pill last | branded splash, a progress bar, content at 1.5-2 s; never black, no skeleton |
| Home -> watch (an audio item) | title, channel, description in frame one; player box pure black 2.4 s until the artwork (the audio art) appears; the time counter was already running about 1 s before the art | the tapped thumbnail in the player at once, skeleton below, video 0.5-1 s later; never black |
| Watch -> Back | mini player docks fine; cards show their thumbnails, but the preview clips never come back (about 20 s observed) | list intact, no reload |
| Home -> Music tab | grey skeleton tiles about 1 s, then art | - |
| Music: tap a Jump back in tile | Classic skin opens on "Unknown track" and a white art box for 0.5 s, title next, art at about 0.7 s | - |

Not recorded: tab switches other than Music, a partly watched video. Not assumed.

## Inventory: every blank, black or placeholder moment

Times are from the tap (or navigation start for a launch). Chromium VPN model at 4x CPU unless stated; WebKit VPN at 1x in brackets.

### 1. Cold launch (once per launch; highest visibility)

What the user sees (iPhone): 1.9 s black + spinner, 1.8 s skeleton, content about 3.8 s. Browser model, warm HTTP cache, fresh tab:

| Run | TTFB | first paint / FCP | grid skeleton | first card | cards with thumbs |
|---|---|---|---|---|---|
| chromium home 1x | 12 | 116 / 116 | 86 | 224 | 322 |
| chromium vpn 1x | 85 | 184 / 184 | 166 | 559 | 592 |
| chromium vpn 4x | 86 | 368 / 428 | 403 (full grid about 790) | 1267 | 1267-1651 |
| chromium vpn 4x Modern | 85 | 332 / 372 | 354 | 1445 | - |
| webkit vpn 1x | 98 | - / 409 | 408 | 1286 | - |
| webkit cell 1x | 361 | - / 1122 | 1122 | 4103 | - |

Filmstrip (chromium vpn 4x, `smooth-audit/sheets/chromium-vpn-cpu4-1-cold-home.png`): white 0-400 ms; header and "Recently added" over an empty grid 500-800; grid skeleton 900-1100; at 1200 the Continue rows push in, the logo pops in, the handoff card slides up; thumbnails 1400-1500; the item count arrives at 1600. That is the "loads in stages".

Why (code-traced, timings measured):
- Before any web paint: the native app checks `/api/host-info`, then loads the shell (ios-host.md "Versions both ways"); the spinner is native. Native-side, unmeasured.
- The shell has no content markup: `#video-grid` is empty until main.js runs after about 20 synchronous scripts (about 3.5 MB raw; 1.4 MB transferred on a cold WebKit cache).
- The grid's chain is serial: `/api/config` (with `/api/auth/me`), then `/api/settings` (awaited after config in main.js `loadLibrary`, though it does not need it to start), then the grid fetch, then thumbnails. On the vpn 4x run: config 561-681, settings 1171-1267, videos 1290-1376, thumbs 1165-1586 (ms).
- About 28 API calls fire at boot and compete on 6 HTTP/1.1 connections: `/api/subscriptions/health` x4, `/api/config` x2, `/api/auth/me` x2, `/logo` x2, plus pins, badge, handoff, history, queue, counts. The health probe has no in-flight memo (common.js ~3876), and the session capability cache lives in sessionStorage, which a relaunched app does not keep.
- Nothing remembers the last home: the service worker is push-only by hard contract and service workers are unavailable in this WKWebView anyway (ios-host.md), so every launch starts from skeletons.

### 2. Home -> watch (every video tap; highest frequency)

| Run | URL change (dead time) | view swapped, title | poster on screen | first frame | playing |
|---|---|---|---|---|---|
| chromium vpn 4x, Classic | 134 | 279 | 279 | 568 | 690 |
| chromium vpn 4x, Modern | 144 | 215 | **415 (black box 215-415)** | 675 | 726 |
| webkit vpn 1x, Classic | 122 | 214 | 214 | 687 | 637 |
| webkit cell 1x, Classic | 390 | 486 | 486 | 1456 | 1438 |
| iPhone (Modern, audio item) | - | frame one | **black 2.4 s** | - | about 1.4 s |

Why:
- Dead time: `navigate()` fetches the full watch.html (40,360 bytes measured, sent uncompressed with `no-cache`) before it swaps; the old page stays frozen with no tap feedback.
- Modern home: `/api/home?view=grid` items (server.js `resolveModernGridItem`) carry no `filePath`, `size` or `hasThumbnail`. watch.js asks `isFullWatchSeedItem(item)` (common.js 3840: needs `type`, `size`, `filePath`), so `canSeedPreload` is false and `player.load` waits for watch.html, `/api/config` and `/api/videos/:id`. Until then `#player-slot` holds an empty player (Chromium filmstrip `sheets/modern-vpn-cpu4-2-home-to-watch.png`: black at +300 and +400 ms). Classic home cards carry the full record, so they seed and show the poster at the swap.
- Audio items: once loaded, the art is a CSS background on `#audio-bg-art` set from `resolveAudioArtUrl` (needs `hasThumbnail`, again missing from the Modern seed), downloaded and decoded only then. On the iPhone the time counter ran about 1 s before the art appeared (inferred: the art image fetch/decode after a late load).
- Native video surface (inferred from code, duration unmeasured): under `nativeVideo` the web deliberately removes the poster (`applyNativeVideoClaim`, player.js ~10385) and opens a transparent hole with `visible: true` before `audio.load` (native-bridge.md "on a new video the web's visible: true goes out just BEFORE the audio.load"). Native's layer has nothing to draw until AVPlayer's first frame (media token, range reads, decode), so the hole shows black for that whole time. No `audioState` field says "picture ready".
- After the swap, two `limit=1000000` list fetches (related rail and prev/next, watch.js ~2103 and ~2246), `/api/settings` x3 and the health probe x2 start while the video is still starting and compete for the link. Their size on Dean's library is unknown (2 KB here).

### 3. Watch -> Back (frequent)

Measured: swap 113-189 ms (chromium vpn 4x), 78 ms (webkit vpn); no fetch, no skeleton (home is a cached node). Fine. Dean's "different look after Back" (code-traced): Modern cards play muted preview clips on a phone (`PreviewCards`, main.js ~1158, `START_DELAY_MS` 1500, at most 2). When home is detached, `refresh()` unobserves the detached cards but leaves `data-pv-obs="1"` on them; on restore `refresh()` only looks at `:not([data-pv-obs])`, so restored cards are never observed again and no preview ever plays. The thumbnails themselves are unchanged (for these JRE audio items the real thumbnail is the show logo; the "real frames" at launch were the previews).

### 4. Home -> Music player (`/music?play=`, a Continue / Jump back in tap)

| Run | URL change | empty skin frame from | title | art | playing |
|---|---|---|---|---|---|
| chromium vpn 1x | 241 | 261 | 456 | 456 | 663 |
| chromium vpn 4x (Cider) | 258 | 360 | 676 | 832 | 1071 |
| chromium vpn 4x (Classic 2) | 258 | 354 | 690 | 817 | 975 |
| webkit vpn 1x | 254 | 286 | 491 | 747 | 974 |
| webkit cell 1x | 926 | 968 | 1703 | 2237 | 3234 |
| iPhone (Classic skin, from a Jump back in tile) | - | 0 | about 0.5 s | about 0.7 s | - |

Why (chain measured, chromium vpn 1x): `music.js` 1-132 ms (lazy, unversioned `/js/music.js`, `no-cache`, 111 KB transferred on its first use) then `/music?play=` HTML 136-239 (44 KB, uncompressed) - in series (`ensureViewScriptLoaded(...).then(fetch)`). Then `mountEarlyCover()` paints the skin with `buildSkinCtx(-1)`: no track, so "Unknown track" / an empty "Now Playing" and a blank art box. Then `/api/music?filter=recent-listening&limit=200` (255-341) only to find the tapped track, then the album (349-432), then the panel fills (456). Also measured: when another item is still loaded, the empty frame shows that item's time ("Unknown track 0:01 -0:18"), because `buildSkinCtx(-1)` reads the live media element.

### 5. Tab switches

Home tab: cached node, 28-200 ms, no skeleton (measured). Music tab: HTML fetch, then skeleton for 97-153 ms (vpn), 353 ms (webkit cell), about 1 s on the iPhone, then shelves (five parallel API calls). Each tab hop pays the same dead time as section 2.

### 6. Music: tap a song row, and the dock tap

Song row: the panel fills from the queue at once (measured 140-344 ms after the tap, mostly the tap-to-handler time under 4x CPU); sound at 419-710 ms. Dock tap back to Music: panel real at 294-343 ms (one HTML round trip). Both fine apart from the shared dead time.

### 7. Placeholders in general

About 120 skeleton sites (common.js 22, main.js 21, watch.js 15, music.js 13, shells 20+), none with a delay, so a load that finishes in 100 ms still flashes a shimmer (the music tab's 97 ms skeleton on vpn is one).

## Fix families against the evidence

Effort S < 1 day, M a wave, L several waves.

| Fix | Closes | Effort | Risk | Verify on the iPhone |
|---|---|---|---|---|
| **A1. Seed every watch surface fully** (the Modern grid item gains `type`, `size`, `filePath`-free seed fields the player needs, or `isFullWatchSeedItem` accepts what the player actually reads; `hasThumbnail` for the poster and audio art) | 2 (black box on Modern, audio art late) | S-M | the seed predicate guards stream decisions (v1.52 gate C2); the projection is an RBAC surface (never add a path the client must not see) | Modern home -> any video and any audio item: thumbnail or art from the first frame |
| **A2. Thumbnail until the first frame under native video**: keep the tapped thumbnail (an `<img>` over the box, not the poster: LESSONS 8 v1.401.1) and the hole shut until native says the picture is ready; interim signal: `audioState.state === 'playing'` plus the first `audioTick`; final: an add-only field (for example `audioState.pictureReady` from `AVPlayerLayer.isReadyForDisplay`) | 2 (black under native) | S web + S native (relay) | the "covered by a hole or above, never neither" rule (LESSONS 4); every stand-down must drop the cover (reveal / clear, LESSONS 0) | 120 fps recording of a video tap: zero black frames |
| **A3. Seed the Music player** from the tapped item (title, artist, album key, art URL, duration) in an in-memory stash like `stashWatchSeed` (same document, so no sessionStorage needed); `mountEarlyCover` paints it; fetch the album directly when the seed has `albumKey`, skipping the recent-listening lookup | 4 | S-M | wrong-item race (LESSONS 4 TOCTOU): the seed is consumed by id and expires | Jump back in / Continue tap: title and art in the first frame |
| **G. View-shell cache** (new): every shell's `#view-root` is static per path (feed / pages / cleanup shells included), so cache the parsed fragment per pathname and clone it on each hop; prefetch the main ones at idle; load the lazy view script in parallel with it and by its hashed URL | 2, 4, 5 dead time (110-930 ms per hop) | M | LESSONS 4 SPA-shell class: never reuse a node, clone per hop; same-route and hash rules; a release mid-session keeps old JS and old shells together | tap feedback within one frame on every hop |
| **E1. Native splash held until first content** (relay): the web posts an add-only `host.ready` when real cards (with decoded thumbnails) are on screen; native hides its splash then, capped at about 2 s | 1 (black + spinner) | S + S | a cap so a broken page never hangs the splash | 120 fps launch recording |
| **E2. Last-known home**: store the first screen of the default home (ids, titles, thumb URLs, per user) in localStorage; paint it synchronously at init; revalidate in place | 1 (skeleton stage) | M | stale items, a deleted item flashing, user switch (key by user, clear on logout); random sort keeps the order seen | relaunch: no skeleton when a snapshot exists |
| **E3. Boot fetch diet**: start `/api/settings` with `/api/config`; single-flight the health probe; defer pins, badge, handoff, history, queue counts until after the grid's first render | 1 | S-M | the chrome's placeholders and count-gated nav items (cold-launch-crispness work) must not regress | launch recording |
| **H. Out of the first frame's way**: defer the watch page's two full-list fetches and duplicate settings / health calls until `playing` (or idle) | 2 | S | prev / next and related must still be ready in time | measure `/api/videos?limit=1000000` size on Dean's server first |
| **P. Preview restart after Back** (bug): clear `data-pv-obs` on detach, or observe by the `observed` set, not the attribute | 3 | S | the v1.85 leak guard stays | Back: previews play again |
| **F. Placeholder discipline**: one CSS rule fades the shimmer in after 150 ms (the box still reserves space); no placeholder when a snapshot or seed exists (E2, A1, A3) | 5, 7 | S | motion tokens (UI ratchet) | none special |
| **C. Intent prefetch on pointerdown** | residual API wait after G | S-M | wasted requests on scrolls (start on pointerdown, cancel on pointercancel) | - |
| **B. View transitions**: cross-document does not apply (no document navigations in-app, measured). Same-document `document.startViewTransition` around `swapToView` exists in both engines here; it would not remove any wait, and the native picture layer is outside the snapshot, so it must stay off while native owns a surface. The v1.362.4 dim-and-fade on the dock return is the house precedent | polish | M-L | native surface, input blocked during the animation | WKWebView support (`typeof document.startViewTransition`) via the log export |
| **D. bfcache** | none of the core flows (Back is a cached in-document node, 28-189 ms) | - | - | - |

D hygiene only: shells are `no-cache` (not `no-store`, fine); `unload` listeners exist in native-audio.js 432 (only under `nativeVideo`) and skin-surface.js 4412 (the pop-out window); remote.js holds an EventSource while the listening control is on.

## Ranked list (frequency x duration x visibility)

1. Black player after a video / audio tap: every tap, 2.4 s on the iPhone, full black box. A1 + A2 (+ H).
2. Cold launch black + skeleton: every launch, about 3.8 s to content. E1 + E2 + E3.
3. Dead time on every in-app hop: every tap, 110-930 ms modelled, no feedback. G.
4. Music player "Unknown track" frame: every song open from a tile, 0.5 s on the iPhone. A3.
5. Music tab skeleton: each visit, about 1 s on the iPhone. G + F (+ a music home snapshot later).
6. Previews never restart after Back: every Back on Modern. P.
7. Short shimmer flashes everywhere. F.

**Recommended first wave (2-3 changes):** (1) A1 + A2 together, "the player never shows black" (web, plus a one-field relay to the iOS Root); (2) G, the view-shell cache with parallel versioned view scripts; (3) A3, the seeded Music player. P is a one-line rider if Dean wants it in the same wave. Wave 2: E1 + E2 + E3 and F.

## Needs the device

| Question | Why only the phone | Cheapest way |
|---|---|---|
| How long native video stays black (claim -> AVPlayer first frame), and how much is media token, range reads, decode | native, AVFoundation | a 120 fps recording of 3 named video taps; then marks: web posts the claim time, native adds a first-frame timestamp to its log (iOS Root relay) |
| What the 1.9 s black at launch is made of (host-info check, web view creation, HTML, scripts) | native lifecycle | iOS Root logs launch -> host-info answered -> navigation committed -> first web message; the web adds `performance.timing` marks |
| Whether WKWebView in the app exposes `document.startViewTransition` | WKWebView feature flags | one line in the lifecycle log at boot, read from Settings > Troubleshooting > Export log |
| Real network: RTT, HTTP/1.1 or HTTP/2 through Dean's proxy, and the size of `/api/videos?limit=1000000` on his library | his server and VPN | the existing /diag page (ping, payload), plus one curl on the server |
| Real timings of each hop after a fix | iOS WebKit | perf marks (tap, swap, seed paint, poster, surface visible, first frame / `pictureReady`, panel filled, first card painted) recorded into the existing lifecycle log behind its switch and exported with its one button (the house rule; note the switch label rename to "Player event log" is still owed) |

## Artifacts (scratchpad, not committed)

`/tmp/claude-1000/-home-coder-projects-filetube/df513e2e-7791-440e-a623-0bb8202124ea/scratchpad/smooth-audit/`: `sa-probe.js` (the probe), `out-main/`, `out-modern/`, `out-ipod/` (per-run JSON with timelines and resource waterfalls), `sheets/` (100 ms filmstrips), `rec1-a.png` / `rec1-b.png` (Dean's recording at 2 fps).
