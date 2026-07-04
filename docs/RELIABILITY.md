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

- **Unit tests** (`test/unit/`): `node:test` covers the regression-prone pure
  logic — id hashing, `needsTranscode`, `matchRootFolder` (prefix boundaries),
  `transcodedPath`, `loadDatabase`/`saveDatabase` (defaults, corrupt-JSON
  recovery, round-trip), and every branch of `reconcileTranscode`.
- **Integration tests** (`test/integration/`): boot `app` on an ephemeral port
  against an isolated temp `DATA_DIR` and exercise the real routes — status
  codes, validation (400/404), and a watch-progress round-trip. No FFmpeg needed.
- **E2E tests:** None automated yet. The FFmpeg-dependent transcode paths
  (desktop live stream, mobile lazy transcode) are still verified manually in a
  browser; keep FFmpeg out of the automated suite (not installed on CI).
- **CI** (`.github/workflows/ci.yml`): runs `npm run lint` + `npm test` on Node
  22 for every push and PR. `pre-commit` gates lint + unit tests locally;
  `pre-push` runs the full suite.

## Monitoring

- No external monitoring. Health is observed through container logs and the
  in-app status endpoints that report live scan/transcode progress.

## Incident response

- If a build breaks on main, fix it before any new feature work
- Tech debt items go in `docs/exec-plans/tech-debt-tracker.md`
