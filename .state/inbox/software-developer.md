# Software Developer — Task T5: /subscriptions UI page + client + nav injection

Feature: **Optional yt-dlp subscription integration module**, branch `feat/ytdlp-integration`.
T1–T4 are DONE and committed (config/wiring, persistence+CRUD, invocation+security, the
download loop — all verified green, 488 tests). T5 builds the **UI layer** on top of the
existing, tested API. No new product or architectural decision — the page, its controls, the
dedicated-page decision (D4), and the nav-injection approach were all locked in discovery/
design. Implement straight from the design; scope tightly to the UI.

> **PREREQUISITE:** do NOT start until the coordinator confirms the T4 commit has landed
> (it's the clean rollback point before T5).

## Read first

- `.state/feature-state.json` → `tasks[T5]` (description + `done_when` + `routing_note`) and
  `locked_decisions.D4` (DEDICATED /subscriptions page linked from Settings; when disabled the
  nav link AND the route are structurally absent, NOT CSS-hidden).
- `docs/exec-plans/active/2026-07-05-yt-dlp-integration-module.md` → the UI section of the
  `## Design` + the acceptance criteria (esp. **AC3** disabled ⇒ page+nav absent, **AC32**
  enabled ⇒ full UI flow works).
- `docs/CONTRIBUTING.md` (2-space, semicolons, single quotes, vanilla DOM in `public/js/`,
  no framework/bundler, `node:test`, lint 0, every change ships with tests).
- Existing patterns to mirror:
  - `lib/ytdlp/index.js` `registerRoutes(app, deps, config)` — the `isEnabled` early-return
    gate; ALL T5 routes (the page + its assets) register INSIDE this gate so they 404 when
    disabled. The `GET /api/subscriptions/health` probe (200 enabled / 404 disabled) already
    exists here. The CRUD + re-pull + settings endpoints T5 binds to
    (`GET/POST/DELETE /api/subscriptions`, `GET/POST /api/subscriptions/settings`,
    `POST /api/subscriptions/repull`, `POST /api/subscriptions/:id/repull`) are already
    implemented and tested — T5 is a client for them, do not change them.
  - `server.js:1238` `express.static(public)` — **keep T5's page + client OUT of `public/`**
    (in `lib/ytdlp/views/` + `lib/ytdlp/client/`) so `express.static` cannot serve them when
    the module is disabled; serve them only via the conditional routes inside `registerRoutes`.
  - `public/js/common.js` — the bottom-nav / Settings surface (`getActiveNavForRoute` ~:482,
    the nav wiring ~:613+). This is where the capability probe + nav-link injection go.

## What to build

1. **`lib/ytdlp/views/subscriptions.html`** — the dedicated page shell (retro YouTube style,
   consistent with the existing pages). No inline secrets; no framework.
2. **`lib/ytdlp/client/subscriptions.js`** — a vanilla per-page controller:
   - List each subscription: name / format / quality / last-checked / status.
   - Add form: channel URL + audio|video + optional quality.
   - Per-row delete + re-pull-one; a re-pull-all action; the members-only toggle bound to
     `db.ytdlp.allowMembersOnly` (via `GET/POST /api/subscriptions/settings`).
   - NO queue visualization, NO per-video picker, NO progress bars (out of scope).
3. **`lib/ytdlp/index.js`** — inside `registerRoutes` (the `isEnabled` gate), add the routes
   that serve the page HTML + the client JS (both from `lib/ytdlp/`, not `public/`). Keep the
   disabled path a no-op (routes absent ⇒ native 404).
4. **`public/js/common.js`** — capability probe: `fetch('GET /api/subscriptions/health')`; on
   **200** inject a 'Subscriptions' nav link into the Settings surface; on **404** do nothing
   (the link is ABSENT from the DOM, not CSS-hidden — D4/AC3).

## SECURITY — non-negotiable (T2-QA-folded)

Every server/user-derived string rendered in the UI — subscription **`name`**, the
**status** string, channel URL, etc. — MUST be rendered as **TEXT** (`textContent` or proper
escaping / safe DOM construction), **NEVER via `innerHTML`** with interpolated data. A
subscription name is derived from yt-dlp metadata at add-time and a malicious channel could
craft it — no XSS-injection surface in the UI. (Note: `common.js` uses `innerHTML` elsewhere
with static/trusted strings; do NOT follow that pattern for the subscription data — build
those nodes with `createElement` + `textContent`.)

## Tests

- **AC3 (disabled):** with the module disabled, the `/subscriptions` page route 404s AND the
  nav link is absent from the served DOM (assert the probe returns 404 ⇒ no injection). Assets
  are not reachable via `express.static` either.
- **AC32 (enabled):** the full UI flow — list / add / delete / re-pull-all / re-pull-one /
  status / members-toggle — works against the real routes (integration test booting `app` on
  an ephemeral port against an isolated temp `DATA_DIR`, mirroring the existing integration
  suite). Include a test that a hostile subscription `name` is rendered as text, not HTML
  (assert no element is created from the injected markup / it appears escaped).
- Keep the disabled-no-op guarantee intact (the 488 existing tests stay green).

## Done when

- `/subscriptions` page + nav link present and the full UI flow works when enabled (AC32);
  page route 404s and the nav link is absent from the served DOM (not CSS-hidden) when disabled
  (AC3); assets live outside `public/`.
- No `innerHTML` with server/user-derived data (XSS-safe).
- FULL suite green + lint 0. Run the project commands and fix any failures before reporting:
  - `export PATH="/home/coder/.local/share/fnm/node-versions/v24.14.0/installation/bin:$PATH"`
    (fnm not auto-sourced — FIRST, before every npm/node command)
  - `npm run lint` (0 warnings beyond the documented exported-globals baseline)
  - `npm test`
- Report files changed, tests added, and lint/test results.

Then this goes to `/prep-build-verify`; after build-verify passes, a **QA-agent review** (not
the full two-reviewer gate — T5 isn't a gate task, but the XSS surface + the AC3
disabled-absent guarantee warrant one focused review). Do NOT commit unless the coordinator
asks — the coordinator owns git for this feature.
