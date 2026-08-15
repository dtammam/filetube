# Reliability

Standards for keeping this project stable and maintainable.

## Error handling

- Wrap filesystem and FFmpeg (`spawn`) calls in `try/catch`; on failure log and
  degrade gracefully rather than crashing the server process.
- Media endpoints return explicit HTTP status codes with JSON error bodies
  (`404` missing item/file, `503` transcoding-in-progress, `500` unexpected).
- FFmpeg child processes handle both `error` and `close` events; failed
  transcodes clean up their `.tmp.mp4` and mark the item `failed` (never serve a
  partial file).
- Never let one bad/corrupt file take down a scan — reconcile per-item and continue.

## Logging

- Plain `console.log` (stdout) for lifecycle/progress, `console.error` (stderr)
  for failures. No structured logging library.
- In Docker, logs surface via `docker logs` / compose.

## Testing strategy

- **Unit tests** (`test/unit/`): `node:test` over the regression-prone pure
  logic — id hashing, `needsTranscode`, `matchRootFolder`, `transcodedPath`,
  the SQLite adapter (schema migrations incl. the future-version refusal,
  save/load round-trip, the unknown-key persistence lock, the db.json
  importer's strict-parse abort), query/reducer modules, and the docs censuses.
- **Integration tests** (`test/integration/`): boot the real `app` on an
  ephemeral port against an isolated temp `DATA_DIR` (real SQLite, real auth
  sessions) and exercise the live routes — RBAC visibility and write gates,
  the route-table-derived forcing nets (write classification + read
  classification), backup/restore, scan/prune, podcasts, queues. No FFmpeg
  needed. As of v1.128 the full suite is ~6,900 tests.
- **E2E tests:** None automated yet. The FFmpeg-dependent transcode paths
  (desktop live stream, mobile lazy transcode) are still verified manually in a
  browser; keep FFmpeg out of the automated suite (not installed on CI). Two
  Chromium capture tests run only where a separately-installed Playwright
  exists and skip cleanly elsewhere.
- **CI** (`.github/workflows/ci.yml`): runs `npm run lint` + `npm test` on a
  Node **22 + 24 matrix** for every push and PR (matching the dual-Node
  release ceremony; v1.123). The Docker publish workflow re-qualifies the
  exact pushed ref on the same matrix plus a secret scan before any image is
  built. `pre-commit` gates lint + unit tests locally; `pre-push` runs the
  full suite.

## Monitoring

- No external monitoring. Health is observed through container logs and the
  in-app status endpoints that report live scan/transcode progress.

## Incident response

- If a build breaks on main, fix it before any new feature work
- Tech debt items go in `docs/exec-plans/tech-debt-tracker.md`
