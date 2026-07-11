# Verification — T13 (v1.30 Scale Perf + Polish Wave) — elegant-button polish (FINAL task)

You are the **build-specialist**. Independently verify the T13 implementation by
running the project's build/test/lint commands and reporting pass/fail with full
output for any failure. You do NOT write code or fix failures — you report. This is
the LAST implementation task; your PASS puts all 13 tasks through the build gate.

## Environment (do this FIRST — v1.29 process learning)

```bash
export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"
node --version   # expect v22.23.1 (CI parity)
```

## What T13 changed (context for your review)

Task **T13** (C4) is a **conservative, CSS-only** button polish — `public/css/style.css`,
the base `.btn` rule only:
- `border-radius` reads `var(--radius)` directly (drops the old `+1px` bump; 2005
  becomes exact-0 sharp per its documented character).
- Horizontal padding 14px → 12px (vertical padding / tap-targets untouched; all
  44px-floor scoped overrides self-declare).
- `box-shadow: var(--shadow)` at rest (era-resolving: ambient for 2021/2009, none
  for flat 2005/2014) with `:active` clearing it to pair with the existing
  `translateY` press nudge.
- **No new tokens, no `font-size`, no markup, no new tests.** The SDE audited all
  `.btn`-referencing lock tests and none lock the base rule, so zero test updates.

**AC7.6 (subjective "elegant buttons" quality) is Dean-on-device-post-release — NOT
a machine PASS.** Do not attempt to judge the aesthetics; only confirm the suite is
green and the guards hold.

## Commands to run (report each pass/fail; full output on failure)

1. `npm ci` (install; the "build")
2. `npm test`
3. `npm run lint`

## Expected results (from the SDE's self-report — confirm independently)

- **`npm test`: 3593/3593 passing** on Node 22.23.1 — **same count as after T12**
  (T13 is a CSS-only polish that added NO new tests). Any failing/errored test, or a
  count other than 3593, is a FAIL — report the full output.
- **`npm run lint`: 0 errors, 7 baseline warnings.** More than 0 errors is a FAIL.

## Specifically confirm (T13 acceptance evidence — call these out BY NAME)

- **AC7.1** static-scan (font-size still all `var(--fs-*)` except allowlist) — the
  button polish must NOT have reintroduced a literal `font-size`. Still green.
- **AC7.2** 16px input-floor tests — still green (both floor test files).
- The **existing CSS-lock tests** (any `.btn`/border-radius/box-shadow locks) still
  pass — i.e. the base-rule polish didn't break a lock the SDE said it wouldn't.

## Report back (concise)

For each command: PASS/FAIL, and for `npm test` the exact passing/total count and
Node version. Explicitly state whether AC7.1, AC7.2, and the CSS-lock tests are
still green. Full output for any failure. Do NOT commit, push, or edit code.

When done, return to the EM session and run:
- **all PASS →** all 13 tasks are through the build gate; run `/prep-qa-review` to
  open the two-reviewer gate (both reviewer inboxes are already written).
- **any FAIL →** report; EM re-routes to the software-developer with the output.
