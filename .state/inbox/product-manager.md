# Discovery — v1.16.0 "Watch experience" (5 items)

You are the **product-manager** for FileTube. This is Discovery for a NEW cohesive
round, **v1.16.0 "Watch experience"** — 5 items themed around **"keep watching /
keep your place."** Author the execution plan with grouped, tagged acceptance
criteria. You have no shared context with the EM — everything you need is below.

## First, read (for grounding)
- `.state/feature-state.json` — the full round spec: `scope_items` 1–5,
  `hard_constraints`, `product_forks_for_dean`, `pe_design_items`, `cross_cutting`.
- `docs/CONTRIBUTING.md` — coding standards (vanilla DOM, CommonJS, node:test,
  lint 0, no new deps, era-theme tokens, textContent-not-innerHTML).
- `docs/RELIABILITY.md` — testing strategy + invariants.
- `lib/ytdlp/url.js` — the item-5 security guard (read it closely).
- `public/watch.html` + `public/js/watch.js` — the item-1/2/3 player surface.
- `public/js/main.js` + `public/js/common.js` — home sort/`rankRelated` (items 2/4).

## Your deliverable
Author the exec plan at:
`docs/exec-plans/active/2026-07-06-v1.16-watch-experience.md`

with these sections:
- **Goal** — one paragraph: keep the video playing + keep the user's place across
  the watch/home experience, and accept real-world YouTube share-sheet URLs safely.
- **Scope** — the 5 items (FR-1..FR-5, one per scope item).
- **Out of scope** — cross-check nothing here conflicts with a CONTRIBUTING.md
  mandatory standard. Explicitly out: any docked in-app mini-player / SPA refactor
  (Dean LOCKED item 1 to **native** Picture-in-Picture); re-enabling general mobile
  autoplay for the initial load; weakening any existing `validateChannelUrl` guard.
- **Constraints** — restate the `hard_constraints` from state in product terms
  (additive/no-regression; disabled-module byte-identical; item-5 strict guards
  UNCHANGED; era-theme tokens; no new deps; Node 22; textContent-not-innerHTML).
- **FR-1..FR-5** — one functional requirement per item (titles in `scope_items`).
- **Acceptance criteria** — grouped by item and **tagged** `[UNIT]` /
  `[INTEGRATION]` / `[MANUAL]` (Dean on-device) / `[PROCESS]`. Then a
  **Cross-cutting** AC group (disabled-module no-op, era-theme, no-new-deps,
  Node 22, lint 0, the two-reviewer gate for item 5 vs single-QA-no-regression for
  items 1–4, the item-2→item-3 dependency).

### Item-specific AC guidance
- **Item 1 (PiP):** control shown ONLY when PiP is feature-detected; standard
  `requestPictureInPicture()` path AND the iOS `webkitSetPresentationMode` fallback;
  PiP survives navigation (native OS window); existing `playsinline` unbroken. Most
  ACs are `[MANUAL]` (Dean on-device, esp. iOS Safari + desktop/Android Chromium).
- **Item 2 (prev/next):** steps through the derived order; disable at ends
  (recommended); refresh/deep-link still works. `[MANUAL]` + one `[UNIT]` on the
  order/position helper if extracted.
- **Item 3 (autoplay-next):** OFF by default; fires on `'ended'`; navigates to
  item-2's next; at the end does nothing; setting round-trips. `[INTEGRATION]`
  (settings round-trip) + `[MANUAL]`. Note the item-2 dependency.
- **Item 4 (persist home view):** restore folder+search+sort+scroll ONLY when
  returning from within the app; fresh/deep-link load unaffected. `[MANUAL]`.
- **Item 5 (url.js) — MANDATED security-regression + acceptance tests** (all `[UNIT]`;
  these are non-negotiable, copy them into the ACs):
  - Hostile embedded URL STILL rejected: `click https://evil.com/x` → extracted
    `evil.com` fails the host allowlist.
  - Extracted URL with a shell metachar / leading `-` / userinfo → STILL rejected.
  - Oversized input → STILL rejected.
  - A channel/playlist/handle on the one-off single-video path → STILL 400.
  - ACCEPT: ` https://youtu.be/<id>?si=<x>\n` trims → valid video.
  - ACCEPT: `Title\nhttps://www.youtube.com/watch?v=<id>&si=<x>` extracts → valid.
  - `classifySingleVideo` → kind `'video'` + right videoId + clean `buildWatchUrl`
    (no `?si`).

## Forks — restate as RESOLVED with the recommendation (don't re-open unless you
find a genuine product problem). See `product_forks_for_dean` in state for the full
rationale:
1. **Item 2 order source** → recommend the **current home sort order** (not
   rankRelated); PE owns how the order reaches the watch page.
2. **Item 2 ends** → recommend **disable at start/end** (no wrap).
3. **Item 3 pref storage** → recommend a **server `db.settings` setting**
   (`autoplayNext`, defaultView-style), OFF by default.
4. **Item 4 restore mechanism** → recommend **sessionStorage** (view + scroll),
   restore only when returning from within the app.
5. **Item 5 extraction** → recommend **extract-first-URL then strictly validate**
   (accept the share-sheet payload; every guard unchanged).

If you surface a NEW genuine fork, state it with a recommendation — don't block.

## Flag for the principal-engineer (Design stage)
Note in the plan which items need PE mechanics: **1** (PiP cross-browser + iOS
fallback + feature-detect + control), **2** (prev/next order-derivation +
delivery to the watch page + ends behavior), **4** (persist-state mechanism +
what-to-preserve), **5** (URL-extraction pre-step placement, guards unchanged).
Item **3** (autoplay-next) is more direct but rides through Design because it
DEPENDS on item 2's derived-next foundation.

## When done
Report back (do NOT advance stages yourself). The EM will verify the plan and run
`/prep-pe-design` to route Design to the principal-engineer.
