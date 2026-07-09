# T6 — Subscriptions UI: repull + poll display + pin-from-watch + DnD client (v1.24, Wave 2)

**Cluster A/B · FR A5, B1, A4-display, B3, B4-client · Gate: light · Depends on: T7, T8**

Read at wave start: `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`
(`## Design` A4/A5/B1/B3/B4; `## Task breakdown` Wave 2 + the [EM-REFINED]
partition note). Re-read your owned files fresh before editing.

## Files you own (edit ONLY these)
- `public/index.html`
- `lib/ytdlp/views/subscriptions.html`
- `lib/ytdlp/client/subscriptions.js`
- `public/js/watch.js`

`public/js/common.js` is REUSED VERBATIM (its `moveArrayItem`/`computeDropIndex`)
— do NOT edit it.

## Scope
- **A5:** a prominent "check all subscriptions now" control high in the
  subscriptions view, calling the EXISTING `POST /api/subscriptions/repull`.
- **B1:** a "Re-pull this channel now" button in `public/index.html`'s
  `.section-actions` row (~L108), shown ONLY when the current `?root=` folder is
  a subscription's resolved `channelDir`, calling the EXISTING
  `POST /api/subscriptions/:id/repull`; visible "checking…" feedback; hidden for
  non-subscription views.
- **A4-display:** show last-pulled (`sub.lastCheckedAt`), next-pull estimate
  (T8's `computeNextPollDue` via the status/settings response), and a
  "checking now" indicator driven by the existing activity state, no reload
  (reuse the ~2.5s status poll).
- **B4-client:** DnD reorder on the subscriptions management list in
  `subscriptions.html`, reusing `common.js` `moveArrayItem`/`computeDropIndex`
  VERBATIM; POST the new order to T8's `POST /api/subscriptions/reorder`;
  drop-before/after indicator, touch-friendly.
- **B3:** a one-tap "Pin this channel" control on a downloaded video's watch
  page (when it has channel identity), pin/unpin without navigating away, via
  the pin route T8 exposes; reuse the gated pins store, NEVER `db.folders`.

## Frozen cross-file contracts
- Consumes: T7's `order` field on subscription records; T8's
  `POST /api/subscriptions/reorder`, the pin route, and the poll-timing fields on
  `GET /api/subscriptions/status`/`settings`.
- No new backend route for A5/B1 (existing endpoints).
- Disabled-module no-op: nothing you add is reachable with
  `FILETUBE_YTDLP_ENABLED=false`.

## Acceptance criteria (exec-plan A5, B1, A4, B3, B4)
- [UNIT] no new backend route for A5/B1 (assertion). [MANUAL] all five behaviors
  per the exec-plan ACs; B1 hidden for non-subscription views; B4 persists across
  reload; B3 pin record shape matches the existing subscriptions-page pin flow.

## Standard footer (v1.24 UX Round — every SDE task)
- **Node 22 toolchain:** prepend to PATH:
  `/tmp/claude-1000/-home-coder-projects-filetube/139c0e56-b545-4e8e-ba05-f892f6dd6d0d/scratchpad/node-v22.23.1-linux-x64/bin`
- **Verify:** `npm test` (baseline 1735 green) + `npm run lint` (0 errors + 8
  pre-existing `common.js` warnings baseline — add none). New helpers get tests.
- **Standards:** vanilla DOM, `textContent` over `innerHTML`, no new runtime deps.
- **Ownership:** edit ONLY the four files above; `common.js` reused verbatim.
  Need another file? STOP/report.
- **Git:** COORDINATOR owns ALL git. Do NOT commit/branch/stage/push. Report
  files changed + tests + Node 22 `npm test`/`npm run lint` results.
