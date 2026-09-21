# Performance diagnostics suite (Settings > Experimental)

Status: IN GATE (branch `exp/perf-diagnostics`). Owner: main session. Gate: FULL
(adversary + qa + security-brief - escalated to add security-brief: new network
boundary, admin/RBAC surface, client-POST file-writing store, byte-serving probes).

## Intent (Dean)
FileTube feels slow on mobile over an always-on VPN. Before building fixes, Dean
wants a device-real MEASUREMENT instrument to attribute latency to a cause (VPN
RTT floor vs navigation fan-out vs throughput ceiling vs playback start vs
stalls) so the highest-ROI fix is chosen from data, not theory. It must be a
durable, usable feature in a normal install - toggled in-app, no env flags, no
restart - not a throwaway env-gated branch.

## What was built
A measurement suite gated by a new persisted experimental setting:
- **Passive collector** (`public/js/perf-collector.js`) injected on EVERY shell
  from the single `sendShellHtml` choke point (behind the gate); records
  Resource/Navigation timing + media events into localStorage per labelled run
  (survives full-document section loads); inert until a run is armed.
- **/diag control page** (`public/diag.html` + `public/js/diag-page.js`): arm/
  label/stop runs, guided scenarios, active probes, and the isolation matrix
  (single + LAN-vs-VPN compare).
- **Active probes** (`lib/diag/routes.js`): `/api/diag/ping` (RTT),
  `/api/diag/blob` (throughput), `/api/diag/payload?enc=` (compression delta).
- **Server-Timing middleware** (`lib/diag/timing.js`): splits server-compute out
  of TTFB; installed once at top of stack, no-ops unless enabled.
- **Run store** (`lib/diag/runStore.js`): one JSON per run under `DATA_DIR/.diag`.

## Gate = the setting (not env)
`perfDiagnosticsEnabled` (Settings > Experimental, default OFF). Single predicate
`isDiagEnabled()` = `FT_DIAG` force-on OR `settingsStore.getKey(...)` (direct
read, no cache - toggle is live, no restart). FT_DIAG=1 kept only as a headless
override. Every entry point (timing middleware, shell injection, all route
handlers) consults it.

## Machine-derived facts (re-verify at each commit; never hand-enumerated)
- New routes: **8** = `GET /diag`, `GET /api/diag/ping|blob|payload`,
  `POST /api/diag/runs`, `GET /api/diag/runs`, `GET /api/diag/runs/:id`,
  `DELETE /api/diag/runs/:id`. All registered UNCONDITIONALLY; gated per-handler.
- Gate order per route: `requireAdmin` FIRST, then feature-check - a member 403s
  (like every admin route), an admin 404s while OFF, reaches it ON.
- Setting threaded through: `DEFAULT_SETTINGS` (server.js), `KNOWN_KEYS`,
  validation block, `settingsResponse` projection (lib/config/routes.js), setup
  UI toggle + prefill + save (public/setup.html, public/js/setup.js).
- Census/guard updates: rbac route-count `238 -> 246`; route-read READ (6 GETs
  `ADMIN`); route-write CLASSIFICATION+VISIBILITY (2 mutating `admin`/`na`);
  module-map registrations `12 -> 13` (new top-level `app.use` timing mw);
  reveal-toggle count `9 -> 10`; shell-collision roster excludes `diag.html`
  (standalone page); css-token-lint `// token-exempt` on the injected badge.
- Run store: `DATA_DIR/.diag/run-<id>.json`, id server-minted, `MAX_RUN_BYTES`
  8MB; blob cap `MAX_BLOB_BYTES` 30MB; payload sample ~217KB (br ~12KB).

## Named attack surfaces -> gate brief
1. **Path traversal**: `runStore.get/remove` derive the file path from
   `req.params.id`. `runPath` sanitizes `String(id).replace(/[^a-zA-Z0-9_-]/g,'')`
   and rejects empty. VERIFY the sanitizer admits no traversal/absolute path and
   that no other sink uses caller input to build a path.
2. **Resource exhaustion**: `/api/diag/blob` streams up to 30MB of
   `crypto.randomBytes`; `/api/diag/payload` brotli/gzip a cached buffer. All
   admin-gated + feature-gated. VERIFY caps hold, no unbounded `bytes`, no way to
   run these unauthenticated or with the feature off.
3. **Auth/RBAC**: VERIFY every diag route is behind `requireAdmin` (member 403)
   AND the feature check (404 when off); no handler bypasses the shared gate;
   the global `authGate` still fronts everything.
4. **Stored-render (XSS)**: run labels/notes/scenario names/media filenames are
   POSTed then rendered by diag-page.js. Admin-authored + admin-viewed only.
   VERIFY the blast radius is admin-self (no cross-user render path).
5. **Global middleware regression**: the Server-Timing mw monkeypatches
   `res.writeHead` on EVERY request when enabled. VERIFY it cannot corrupt a
   response, double-set, or throw; and that it is a genuine no-op when OFF.
6. **Shell injection correctness**: the collector `<script>` is added by a
   `</body>` regex replace on every shell. VERIFY it lands once, only when
   enabled, and breaks no shell (incl. pages with no `</body>`).
7. **Persist-gate / carry-forward**: new setting must default cleanly on an
   existing install (kvStore defaults-merge) and not strip on partial writes.

## Acceptance criteria
- [ ] Default OFF: no shell injection, no Server-Timing, diag routes 404; a
      normal/ test build is behaviourally unchanged (full suite green: 8854/0).
- [ ] Toggle in Settings > Experimental persists, projects, validates, and gates
      the surface live BOTH ways (bound by settings-cache-api.test.js).
- [ ] Admin-only: members 403 on every diag route (bound by route-write
      enforcement census).
- [ ] Non-content-serving: RBAC census (count + read/write classification)
      satisfied.
- [ ] Probes/store enforce their caps; no traversal; no unauth path.

## Gate verdicts (seats append; bound to the reviewed sha)
Gate: APPROVED r1 @2a30957a — security-brief
- S1 Path traversal — CLEARED. `runPath` strips every char outside `[A-Za-z0-9_-]` before `path.join`, so `../`, absolute paths, encoded slashes (express decodes `:id` to one segment), and NUL all collapse to a bare slug; `run-<slug>.json` prefix/suffix are literal and unescapable (no `.` or `/` survives). Empty-after-strip throws (rejected). No other diag sink builds a path from caller input.
- S2 Resource exhaustion — CLEARED. `/blob` bytes = `parseInt`; non-finite/<=0 → 1MB default, then `Math.min(bytes, 30MB)`; negative/NaN/huge all bounded; Content-Length matches the capped value; streamed in 256KB `crypto.randomBytes` chunks with backpressure (never holds 30MB). `/payload` compresses a fixed ~217KB cached buffer. Both admin+feature gated. Unbounded concurrency is admin-only (trusted). No unauth/feature-off path.
- S3 AuthZ/RBAC — CLEARED. Global `authGate` (app.use, before route registration) fronts all diag paths; `/diag`, `/api/diag/*`, `/js/perf-collector.js` are NOT allowlisted → unauth 401/redirect. Every one of the 8 handlers uses the shared `gate = [admin, enabledCheck]` with `requireAdmin` FIRST (member → 403) then feature check (admin → 404 when off); POST's `jsonBig` runs after the gate. No handler skips the array.
- S4 Stored/reflected XSS — CLEARED (admin-self, LOW residual). Every innerHTML-rendered field (label, note, scenario) originates on the admin's own browser: label/note typed on /diag, scenario from the fixed `SCENARIOS` key set. Runs are per-browser localStorage POSTed only by an admin (gate); a member cannot write the admin's store or influence collected events. Media `src`/resource names are recorded but never reach a render sink. No cross-user path. Residual is admin-authored→admin-viewed self-XSS (LOW, accept; textContent would harden).
- S5 Global middleware — CLEARED. `diagTiming` returns `next()` immediately when disabled (never patches writeHead); when enabled the wrapper is fully try/catch-guarded, only sets `Server-Timing: app;dur=<ms>` if headers open and unset, always calls through to the original. Leaks only server-compute ms (not sensitive).
- S6 Shell injection — CLEARED. Injection is a fixed literal `<script src="/js/perf-collector.js">` via `</body>` regex replace, only inside `isDiagEnabled()`. No caller/user input flows into the replacement; a shell lacking `</body>` merely no-ops (functional, not security).
- S7 Setting write path — CLEARED. POST /api/settings calls `requireAdmin` first (member → 403), rejects unknown keys, and `perfDiagnosticsEnabled` must be a strict boolean (400 otherwise). No coercion/bypass.
- INFO (non-blocking): GET/DELETE `/api/diag/runs/:id` with an id that sanitizes to empty (e.g. `/api/diag/runs/...`) makes `runPath` throw uncaught → 500 (get/remove lack the try/catch the POST handler has). Admin-only, no data impact — cosmetic robustness nit.

Gate: CHANGES r1 @2a30957a — qa

Instruments (all green): `npm test` 8854 pass / 0 fail / 0 skipped;
`node scripts/css-token-lint.js --enforce` TOTAL 0 (exit 0);
`node scripts/route-order-signature.js` exit 0 (diag timing mw present in every
signature). Census/guard tests all pass at their new numbers: rbac route-count
246, route-read (6 ADMIN GETs), route-write (2 admin/na mutating), module-map
13 registrations, reveal-toggle 10, shell-collision roster excludes diag.html,
settings-shape LOCK + the new both-ways gate test. Working tree clean apart from
this line.

Findings (all WARNING, comment accuracy — no runtime defect found):
- lib/diag/routes.js:4-6 — "Registered by server.js ONLY when FT_DIAG=1 ... so
  this is doubly inert/closed in a normal or unauthenticated context" is FALSE
  and materially misstates the security posture. Routes are registered
  UNCONDITIONALLY (server.js ~3400) and gated per-handler by requireAdmin +
  isDiagEnabled(); the new settings-cache-api test proves /api/diag/ping returns
  200 when the SETTING is on with FT_DIAG unset. Scenario: admin toggles the
  setting ON, no env var → routes live; the comment says that path cannot exist.
- lib/diag/runStore.js:11-12 — "server.js only wires the diag routes when
  FT_DIAG=1, so DATA_DIR/.diag is never created otherwise" is FALSE for the same
  reason. Scenario: admin toggles ON (no FT_DIAG), POSTs a run → ensureDir()
  creates DATA_DIR/.diag; the comment claims this never happens.
- server.js:208 — "The read is TTL-cached so the hot path stays a variable
  compare" contradicts the actual code AND its own sibling comment at
  server.js:531 ("called directly, no cache"). isDiagEnabled() calls
  settingsStore.getKey() directly on every invocation; there is no cache. One of
  the two comments is a lie; the code matches server.js:531, so server.js:208 is
  the wrong one.

Disclosed / accepted (not blocking): diag-page.js:253/303 render admin-authored
run labels via innerHTML with no escaping — matches the plan's stated admin-self
blast radius (admin-authored + admin-viewed; runStore length-caps but does not
HTML-sanitize). Flagged for the security-brief seat's deep pass; not a new
cross-user path. Shell injection is a no-op on any shell lacking </body> (regex
replace) — measurement-completeness only, no correctness/security impact.

Verified: default-OFF byte-identity (timing mw returns next() without patching
writeHead when disabled; no shell injection); path-traversal sanitizer
(String(id).replace(/[^a-zA-Z0-9_-]/g,'') strips ./ and /, rejects empty — every
get/remove sink routes through runPath); blob 30MB / run 8MB caps; admin-first
gate order (member 403, admin-off 404); authGate still fronts the diag routes
(registered after app.use(authGate)).

Gate: CHANGES r1 @2a30957a — adversary

Measurement (all verified, not asserted):
- Full suite `npm test`: tests 8854 / pass 8854 / fail 0 / skipped 0, exit 0.
- Gate binds BOTH axes - three mutations against the committed tree in a /tmp
  git-archive sandbox each turned settings-cache-api's gate test RED: (a)
  isDiagEnabled->always-true reds "diag is 404 while off"; (b) gate=[admin]
  (drop enabledCheck) reds the same; (c) enabledCheck->always-404 reds "diag
  surface is live once on". Binding is not vacuous.
- Census bindings all bind (each mutation red): route-count 246->238 (actual
  246); route-read remove '/api/diag/ping' -> unclassified-route fail;
  route-write remove 'POST /api/diag/runs' classification -> fail; module-map
  DIAGRAMS 13->12 -> fail; reveal-toggle 10->9 -> fail.
- Default-OFF is inert (live boot, scratch DATA_DIR, FT_DIAG unset): /welcome
  shell carries NO Server-Timing header and 0 perf-collector script tags;
  /api/diag/ping 401 (authGate fronts it). With FT_DIAG=1: Server-Timing
  present, exactly one collector `<script>` before `</body>`, diag still 401
  unauth. Injection path is genuinely conditional AND reachable.
- Path sanitizer robust: `String(id).replace(/[^a-zA-Z0-9_-]/g,'')` collapses
  ../, absolute, encoded-slash, and NUL to a bare slug and rejects empty; no
  diag sink escapes DATA_DIR/.diag.
- Timing writeHead wrapper: sets Server-Timing before flush, never double-sets
  (headersSent guard), never overwrites a pre-existing value, survives a
  throwing getHeader (try/catch), leaves writeHead untouched when disabled.
- diag.html loads only /js/diag-page.js (standalone control page, not an SPA
  shell) - correctly excluded from the collision roster and not collector-
  injected.

Findings:
- WARNING - stale/lying comments materially misstate the security posture and
  hot-path cost of this security-reviewed, admin-gated, data-writing, always-on
  module (converges with qa):
  - lib/diag/routes.js:4-6 "Registered by server.js ONLY when FT_DIAG=1 ... so
    this is doubly inert/closed in a normal or unauthenticated context" - FALSE.
    Routes register UNCONDITIONALLY (server.js ~3398) and gate per-handler.
    Measured: server booted FT_DIAG-unset, setting toggled on -> /api/diag/ping
    200. A maintainer trusting "not registered without FT_DIAG" could drop the
    per-handler gate and reopen the surface.
  - lib/diag/runStore.js:11-12 "server.js only wires the diag routes when
    FT_DIAG=1, so DATA_DIR/.diag is never created otherwise" - FALSE for the
    same reason (setting-on -> POST run -> ensureDir creates .diag).
  - server.js:208-209 "The read is TTL-cached so the hot path stays a variable
    compare" - FALSE and self-contradicting: isDiagEnabled() calls
    settingsStore.getKey() DIRECTLY every call (a per-request SQLite point-query
    via kvStore.getKey -> st().get.get), and its own sibling comment at
    server.js:~531 says "called directly, no cache". Surface 6's "no-op cost
    when OFF" is thus not literally true - every request pays one indexed
    app_settings lookup (defensible design, but NOT the cached variable-compare
    the comment claims).
  - public/js/perf-collector.js:3 "injected ... behind FT_DIAG=1" - the gate is
    the SETTING or FT_DIAG; the env-only framing is misleading.
- SUGGESTION - GET/DELETE /api/diag/runs/:id lack the try/catch the POST handler
  has; an id that sanitizes to empty (e.g. `/api/diag/runs/...`) makes runPath
  throw 'bad run id' -> Express 500 instead of a clean 404. Verified via direct
  runStore.get('...') call. Admin-only, no data impact - robustness nit (mirrors
  security-brief's INFO).
- SUGGESTION (disclosed, admin-self) - diag-page.js:253/303 render admin-authored
  run.label via innerHTML unescaped. No cross-user path (members 403 on POST
  /api/diag/runs, 404 on /diag), so defense-in-depth only; textContent would
  harden. Matches the plan's stated admin-self blast radius.

The four comment fixes + two try/catch guards are cheap; behavior is otherwise
correct and fully bound. Re-engage this instance for the r2 delta.
