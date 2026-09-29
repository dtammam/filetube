---
plan: audit-fix
harness: v2 · lean
branch: chore/audit-fix-undici
anchor: spec
status: Shipped v1.345.0
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

Adversary r1: package.json unchanged; lock diff = 6 version/range bumps only, no added/removed pkgs, all resolved on registry.npmjs.org, integrity matches `npm view` for qs/path-to-regexp/express. audit --package-lock-only: 0 vulns; audit:check OK. qs 6.16.0 changelog (primary) touches only arrayLimit-on-comma/stringify; server uses only scalar req.query.variant/t and express.json() (no qs body parsing) so no parsing change. Full suite not duplicated (builder).

Gate: APPROVED r1 @ed3f7289 — security-brief
Gate: APPROVED r1 @ed3f7289 — adversary
Evidence: all five changed packages resolve to registry.npmjs.org with sha512 integrity; lock has zero non-registry resolved URLs and zero hasInstallScript. (No Bash: no diff run, so add/remove and package.json-unchanged not independently verified.)
QA r1: AC1 verified (diff = package-lock.json + plan only; package.json untouched; bumps in range: express ^4.19.2, transitive ~ ranges; path-to-regexp stays 0.1.13, only the dependents' declared range moved ~0.1.12 to ~0.1.13, so the plan's path-to-regexp wording is accurate). AC2 verified in a git-archive sandbox: audit:check OK high:0 critical:0; npm audit 0 vulnerabilities. Commit message accurate. No security surface beyond the bumps moving to patched versions; integrity/resolved consistent. AC3 owned by the Architect.
Gate: APPROVED r1 @ed3f7289 — qa

## Build record

Measured 2026-09-29. A clean `npm ci` of this lockfile (git archive copy) resolved express 4.22.3, body-parser
1.20.8, qs 6.16.0, undici 7.30.0; `npm audit` 0 vulnerabilities; `npm run audit:check` OK. Full `npm test` on Node
22.23.1 there: 10355 pass, 6 fail - all six are `git ls-files` source-lock tests that need a `.git` the archive
copy lacks ("fatal: not a git repository"), not a dependency effect; the hook and CI run them in a real checkout.
Node 24 is covered by CI (ci (24)).
