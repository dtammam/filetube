---
plan: audit-fix
harness: v2 · lean
branch: chore/audit-fix-undici
anchor: spec
status: In review
next: gate, then merge, then rebase feat/ipod-more-colors (PR #52)
gate: pending
---

# Clear the CI dependency-audit gate (undici, qs)

CI `audit` failed on PR #52 (unrelated diff): new advisories GHSA-rfgv-xxqx-mfg5 and GHSA-w293-vg96-wgc3
(undici, high), plus qs (moderate, via express/body-parser). Dean chose (2026-09-29): a separate fix PR first.

## Acceptance
- **AC1** `package-lock.json` only; `package.json` unchanged; every bump inside its existing semver range:
  undici 7.29.0 to 7.30.0 (dev, via jsdom), qs 6.15.3 to 6.16.0, express 4.22.2 to 4.22.3,
  body-parser 1.20.6 to 1.20.8, path-to-regexp range ~0.1.13 (RUNTIME deps: express, body-parser, qs).
- **AC2** `npm run audit:check` OK; `npm audit` 0 vulnerabilities.
- **AC3** A clean `npm ci` of this lockfile passes the full suite on Node 22.23.1 (and 24.20.0).

## Gate

## Build record
