# Capture harness (Tier 3 baselines / Stop B compare)

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
