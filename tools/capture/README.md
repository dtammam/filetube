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
