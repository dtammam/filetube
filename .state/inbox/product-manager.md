# Product Manager — Discovery for v1.10.0 (feat/audio-art-and-related)

You are the Product Manager. Produce requirements + acceptance criteria for ONE
branch containing TWO independent, additive media-experience features for FileTube.
They ship as SEPARATE commits/tasks and must revert independently.

## First, read (self-contained — you share no context with the EM)

- `.state/feature-state.json` — the feature description, `grounding`, and constraints (READ the `grounding` block; it has exact file:line anchors).
- `CLAUDE.md`, `docs/CONTRIBUTING.md`, `docs/RELIABILITY.md`, `docs/ARCHITECTURE.md`.
- `public/watch.html` (player markup: `#media-player` at :119 with `playsinline`; `#audio-visualizer` vinyl view at :139-145; `#player-wrapper` at :98).
- `public/js/watch.js` — especially `setupPlayer()` (:285-344, audio branch :288-295), `loadRelatedFiles()` (:710-753), `setupMediaSession()` (:249-265, lock-screen only), and the v1.2.2 iOS background-audio / no-custom-action-handler rationale (:242-248).
- `public/js/common.js` tail (:483, the `module.exports` browser+node UMD pattern) and a couple of `test/unit/*.test.js` that exercise those helpers (e.g. `clamp-position-state.test.js`, `star-rating.test.js`) so you can model the testability expectation.
- Server anchors: `GET /thumbnail/:id` (`server.js:1605`, never 404s — real jpg or SVG placeholder) and `GET /api/videos` (`server.js:1432`, newest-first list; item field shape is in state `grounding`).

## Deliverable

Write the exec plan to `docs/exec-plans/active/2026-07-05-audio-art-and-related.md`
with a Goal, Scope, Out-of-scope, Constraints, and TWO clearly separated
requirements+acceptance-criteria sections (Feature 1, Feature 2). Then update
`.state/feature-state.json`: set `artifacts.requirements` and `artifacts.exec_plan`
to that path (leave `artifacts.design` null — that's the PE's).

Tag EVERY acceptance criterion with exactly one of: **[UNIT]**, **[INTEGRATION]**,
**[MANUAL]**, **[PROCESS]** (lint/build/tests-green). Keep the two features'
AC in separate sections so they map to separate commits.

Cross-check: nothing you put in Out-of-scope may conflict with a CONTRIBUTING.md
mandatory standard (tests-with-every-change, lint-0, additive/zero-regression).

## Feature 1 — audio playback shows the thumbnail as background art (FEASIBILITY-GATED)

**Problem:** on iOS Safari an AUDIO-only file plays in the HTML5 player as a BLACK
background (no video track). Dean wants the item's THUMBNAIL shown as the art/
background so audio "looks like a video is playing." Video files already show their
frame fine ("it works perfectly for video").

**This is explicitly feasibility-gated.** Dean said: "If it's not [technically
possible], I can drop the ambitions knowing this is PWA only." So:

- Requirements MUST call out a **FEASIBILITY SPIKE** owned by Discovery→Design:
  can mobile Safari (iOS) render the thumbnail behind/around an audio-only
  `<video>` DURING playback? Frame the candidate approaches for the PE to test:
  - **(a) `poster` attribute** — NOTE the code ALREADY does this (`watch.js:288-295`
    sets `mediaPlayer.poster='/thumbnail/'+mediaId` for audio and hides
    `#audio-visualizer`). `poster` typically disappears once playback starts, which
    is very likely the exact black screen being reported. So (a) alone is suspect.
  - **(b) CSS background-image** (thumbnail) on `#player-wrapper` behind a
    transparent / still-poster'd player, with `object-fit: cover`-style framing.
  - **(c)** iOS's native audio takeover may force black regardless — a real
    possibility the spike must be allowed to conclude.
- The lock-screen Media Session artwork (`setupMediaSession`) is ALREADY wired and
  is the LOCK SCREEN, not the in-page player. Do NOT conflate them.
- **If achievable on iOS:** implement thumbnail-as-audio-background (cover framing so
  it reads like video), WITHOUT regressing how video files display.
- **If NOT achievable on iOS:** degrade gracefully — keep/restore the existing PWA
  custom `#audio-visualizer` (vinyl/cover-art view) as the documented **PWA-only**
  fallback. Dean ACCEPTS this fallback explicitly.
- **Acceptance criteria MUST cover BOTH** the works-case AND the graceful-fallback
  case, AND must state the feasibility finding explicitly (the finding itself is a
  deliverable). Most AC here are **[MANUAL]** on-device (Dean confirms on iOS), plus
  any **[UNIT]** for a pure helper (e.g. resolving the right thumbnail URL / deciding
  whether to show background art for an audio item — note `hasThumbnail` distinguishes
  a real thumbnail from the SVG placeholder).
- Hard non-regression AC: preserve the v1.2.2 iOS background-audio behavior AND the
  `playsinline` inline-playback behavior.

## Feature 2 — related items = fuzzy-similar, not just most-recent

**Problem:** "Related Files" is essentially most-recent today (`loadRelatedFiles`:
newest-first, same-folder-first, slice 10). Dean wants it to feel actually RELATED:
"if there's some keyword or something related... a basic [fuzzy] search where if
there's a certain part that's fuzzy similar, show those." **Keep it SIMPLE — "nothing
crazy," a basic tokenize + score, NOT a search engine.**

- Requirements: a lightweight similarity ranking. The CORE must be a **PURE,
  exported, UNIT-TESTABLE** ranking function — e.g. `rankRelated(currentItem, allItems)
  -> ordered list` — with deterministic scoring, defined tie-breaks, a fallback
  threshold, and self-exclusion. Candidate similarity signals (the PE will CHOOSE
  the final set — surface this as an open question, don't over-specify): title/
  filename token overlap, shared folder, shared artist/channel/tags.
- **Never-empty / no-regression:** FALL BACK to most-recent when there aren't enough
  similar items (fewer than some N), so the list is never empty or worse than today.
  Keep the current `.related-card` rendering working.
- Note the pure-fn home is the PE's call — the repo already has a browser+node
  dual-export precedent (`common.js:483`) so `rankRelated` can be a shared client-side
  fn fed by the existing `/api/videos` with NO new server endpoint; don't mandate a
  home, just require it be pure + node:testable.
- Acceptance criteria: **[UNIT]** for the ranking function (similar items rank above
  unrelated; self excluded; deterministic; fallback-to-recent when < N similar; tie
  breaks defined) PLUS **[MANUAL]** that the related list feels related on real content.
  Additive/zero-regression.

## Out of scope (do NOT act on)

- The "optional yt-dlp integration module" (`docs/exec-plans/future/yt-dlp-integration-module.md`,
  referenced by ROADMAP) is the branch-AFTER-next, explicitly PARKED.

## Open questions to surface for the design gate (headline)

End the exec plan with an "Open questions" section highlighting the two the EM will
relay to Dean before the design gate:

1. **F1 feasibility framing** — which approach(es) to actually test on real iOS
   (poster vs CSS background vs accept-native-black), and confirmation that the
   `#audio-visualizer` fallback is the accepted degrade.
2. **F2 similarity signals** — which signals to rank on (title/filename tokens,
   folder, artist/channel, tags) and the fallback threshold N.

Keep requirements product-level (what/why + testable AC); the HOW (poster vs CSS,
exact scoring formula, pure-fn home) is the Principal Engineer's design stage.
