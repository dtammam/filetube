# Capture harness (Tier 3 baselines / Stop B compare)

AUTHORITATIVE manifest = scenes.js (the original prose manifest's
mid-fade spec is SUPERSEDED by frozen end-state per Dean's ruling -
endorsed, not a deviation; no future run should resurrect it).
Manual scenes carry cls markers: LEDGER-TOUCHED (gate-blocking
before-shots: 13-toast, 04-resume, 10-audio-expanded) vs JUDGMENT-ONLY.

Isolated package: Playwright and its tree NEVER enter the app's root
package-lock (`npm ci` for FileTube is unaffected). Install here only:

    cd tools/capture && npm install && npx playwright install chromium

Capture (any machine with a browser, against any instance):

    BASE_URL=http://your-host:3000 node capture.js \
      --fixture-video <mediaId> --fixture-book <bookId> [--only 06,16]

One dated directory, filenames = sceneId-era-mode-viewport.png, plus
run-record.json (notes the EMULATED-baseline caveat + the manual-scene
list). Pin content: pick one video + one book that never change and pass
their ids - before/after runs then photograph the same pixels.

Compare (Stop B):

    node compare.js <baselineDir> <afterDir> <reportDir>

Dependency-free diff (png.js, node:zlib only): channel threshold 16 with
4-neighborhood antialiasing suppression, report.md/json ranked by
magnitude, side-by-side crops per changed scene. The compare layer and
scenes.js are driver-agnostic - if Playwright is rejected, only
capture.js is replaced.

Manual scenes (not automatable deterministically - Dean's device list):
02 playing-frame, 03 cc-over-bright (legibility judgment), 04 resume
overlay (unless progress seeded), 10 audio-expanded, 11b reheat-running,
13 toast. Recorded per-run in run-record.json.

Ledger coverage-audit additions (2026-07-30): 25-login, 26-playlists-
sheet (phone-only via the new per-scene `viewports` field), 23d-ghost-
red-reader. Gate-blocker VALUE corrections live in scenes.js's manual-
scene comment (toast is 3a-only; resume is .85->.8). Ruling-B
additions: 24b-24e photograph the seven era-varying --radius-lg
adoption surfaces in 2005/2009 (music lib + drill, books, reloc).

Baseline-run fixes (2026-07-30, cutecontainer run, 19 deterministic
failures): 09/24c wait on the EXPANDED drill (.music-drill-art - the
sticky is unreachable without scrolling and hides the header when
shown); 15/24d wait on .book-cover-link (what books.js renders);
01 is desktop-only with new 01b driving the phone bottom-nav entry;
scrollTo/click pass full selector unions (the split dropped
fallbacks). **21-hard-delete is REMOVED from automation: for
yt-dlp-managed cards the two-tap flow deletes with NO modal - manual
only, throwaway/non-managed items only.**

READ-ONLY ENFORCEMENT (2026-07-30 hardening, after that scene really
deleted 8 files): every browser context is created through
request-policy.js's newGuardedContext - the ONLY context factory
(tested; bare newContext is banned from capture.js by a source lock).
Mutating requests are FULFILLED with an empty 200 (never aborted -
aborts fire the page's error paths and corrupt the pixels being
baselined) and never reach the server; only the login POST and the
relocation dry-run preview pass, and never via a redirect hop.
run-record.json carries blockedRequests (unexpected - these FAIL the
run) and blockedExpected (the app's own fire-and-forget view/progress/
seen telemetry - recorded, not fatal). Allowlisted POSTs are fetched by
the guard itself with redirects DISABLED - a redirect out of the
allowlist is refused, never followed (proven by a real-Chromium test).
TRADE, disclosed: fulfillment tells the page a blocked mutation
SUCCEEDED, so a scene that actuates a destructive control can
screenshot optimistic UI that lies about server state - the exit-1
alarm on any unexpected block is what marks that frame untrustworthy.
Server-side twin: FILETUBE_READONLY=1 (see docs/CONFIGURATION.md).

DETERMINISM (2026-07-31, after the field gate failed 34/89): every shot
now waits for IMAGE QUIESCENCE (settle.js) - lazy images flipped eager
and every image load+decode awaited, in up-to-three stable passes,
because networkidle fires before SPA renders insert their images and
lazy fetches begin; a timeout lands in run-record imageWaitPending as a
loud nondeterminism warning. GENUINELY LIVE text (the subscriptions
status line, notification relative timestamps) is masked at capture
time by VOLATILE_MASK_CSS via visibility:hidden - the layout box (the
actual token witness) still photographs; only the changing glyphs
vanish. Both mechanisms are bound by
test/integration/capture-determinism.test.js, which reproduces the
post-idle insertion race in real Chromium and requires two gated
captures to be byte-identical. Known blind spot: the gate sees
document.images only - CSS background-image loads are invisible to it;
the app's one dynamic case (the expanded-audio backdrop, player.js
audioBgArt) is reachable only from manual scene 10, so no automated
shot depends on it today. A stably-broken image (404 avatar/cover)
fast-paths: it neither slows the gate nor raises the alarm - it paints
identically every run.
