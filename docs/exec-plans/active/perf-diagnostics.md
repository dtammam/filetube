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
