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

- **Unit tests:** None configured yet. Recommended: `node:test` or Jest for pure
  helpers (id hashing, `needsTranscode`, path builders).
- **Integration tests:** None yet. CI (`.github/workflows/ci.yml`) currently only
  runs `npm ci`; the `npm test` step is commented out until a suite exists.
- **E2E tests:** None automated. Verification is manual via the browser (desktop
  live playback + mobile transcode path).

## Monitoring

- No external monitoring. Health is observed through container logs and the
  in-app status endpoints that report live scan/transcode progress.

## Incident response

- If a build breaks on main, fix it before any new feature work
- Tech debt items go in `docs/exec-plans/tech-debt-tracker.md`
