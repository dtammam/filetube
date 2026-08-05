# HANDOFF: v1.75.0 wave - Liked consolidation + bottom-bar freedom

You are a new session (Opus) picking up a prepped minor wave. This file is
your opening prompt; it was written 2026-08-03 by the outgoing session,
which also shipped v1.74.0 (era scrollbars) the same day.

## Read order, before any code

1. `CLAUDE.md` - the working method ("lean mode"). It is the contract, not
   advice. The two-reviewer gate and ruthless honesty are the two pillars;
   neither is ever traded for speed.
2. `docs/references/CLAUDE-WORKING-STYLE.md` - how to communicate with
   Dean, and the repo's expensive lessons in narrative form.
3. `docs/exec-plans/completed/2026-08-03-v1.75-liked-consolidation-bottom-bar.md` - THE
   SPEC for this wave. Scope, design, task commits T1-T5, machine-derived
   current-state pointers (re-derive them; do not trust across commits),
   gate plan with named attack surfaces, and Dean's open rulings R1-R5.
4. Persistent memory auto-loads - the index's "Norms + environment" and
   "Recurring bug classes" sections all apply to you.

## The wave in Dean's words (2026-08-03)

1. "Remove liked section for podcasts (and for songs if it exists). It all
   gets centralized under the one central Liked (it's currently there)."
2. "In bottom bar, Home is not always left-most bound. It's also not an
   option in Bottom bar, add as an option."
3. "Add liked as a bottom bar option as well. And settings. And make
   sort-able."

## Kickoff procedure

FIRST MESSAGE to Dean: present rulings R1-R5 from the exec plan, numbered,
each with the recommendation inline, so he can reply "agree" or override
per number. Do NOT re-litigate the scope above or re-ask what the plan
already records - only the R-numbers are open. Once he rules, run the
whole lifecycle autonomously: implement -> full two-reviewer gate -> fix
rounds with delta re-confirm to the SAME agent instances -> dual-Node
suites -> release ceremony -> memory + report with his on-device probe
list.

## Process non-negotiables (compressed; CLAUDE.md is authoritative)

- Export the fnm PATH before EVERY npm/node/git command:
  `export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`
  (v24.14.0 for the second suite run; sequential, reviewers idle; Node
  24's reporter prints the i-glyph, not `#` - an empty grep is NOT green).
- EVERY change goes branch -> gate -> `merge --no-ff` -> push. Commit via
  the `/commit-only` command. Verify every commit landed with `git log`
  (the pre-commit hook runs the full unit suite and REFUSES red; a
  refused commit swallowed by a pipe is the known phantom-commit trap).
- Full gate for this wave (QA seat = `quality-assurance` agent,
  adversarial seat = `adversarial-reviewer` agent - spawn BY TYPE, brief
  each with branch, commit range, this spec, and the attack surfaces the
  plan names). Both must APPROVE. Gate pacing: 2 rounds per seat, ship on
  CRITICAL/WARNING closure, tech-debt the rest; at round 3, ASK Dean.
- Ruthless honesty: failures verbatim with counts before any framing; a
  regression is a regression; known gaps ship DISCLOSED (ROADMAP +
  report); residuals go in `docs/exec-plans/tech-debt-tracker.md` with a
  revisit trigger.
- Release ceremony per CLAUDE.md step 7; the Docker pull onto Dean's
  server is ALWAYS Dean's. Move the exec plan to `completed/` only when
  its Stop closes (device pass) - at ship time it stays in `active/` with
  the release disclosed as device-pass PENDING.
- No em dashes in any docs/prose - plain " - " hyphens.
- Update persistent memory before the final report.

## Landmines specific to THIS wave (each has drawn blood before)

- COMPAT IS THE HEADLINE RISK: an untouched device must render the
  IDENTICAL bar after upgrade (the v1.71/v1.72 opt-in posture). The
  compat matrix in the plan (pre-v1.71, v1.74-era, post-v1.75 configs) is
  the core of T1's tests. Mutation-test the fallbacks.
- Enumerate the NINE shells by grep, never memory (v1.68 lesson). Every
  surface that renders the bar gets the new entry; setup.js and shell
  copy may special-case 'home'/'settings' - grep for both.
- SPA swaps only #view-root (v1.38): "works on refresh but not in-app
  nav" is the tell. The music tab removal needs the deep-link fallback
  tested both ways.
- Glyphs live in CSS/icon assets, NEVER emoji codepoints in markup
  (v1.38); new glyph follows the v1.73.2 Books pattern - single asset,
  ALL icon sets covered up front including the emoji set (v1.73 W2).
- Testing a DECISION is not testing its USE (struck at least 4 times):
  constants and config tests are not bar-rendering tests. Bind the
  rendered ORDER, not the config that implies it.
- Removed surfaces take their tests WITH them; a test kept green against
  a ghost is the divergent-fixture class (v1.41.9 et al.).
- Remove UI only - server routes stay (other consumers + tests). The
  plan's D1 note governs.
- The token census is SELECTOR-BLIND to [data-theme]-scoped consumer CSS
  (tech-debt #103, found 2026-08-03): if you write any era-scoped CSS,
  it needs its own tokens-only lock (era-scrollbar-css.test.js is the
  template). Any new CSS consumes existing tokens; never mint a token
  casually (CONTRIBUTING.md, mandatory styling section).

## State you inherit

- main = v1.74.0 (tag pushed; Docker published; Dean's device pass
  PENDING for v1.74.0's desktop scrollbar probes and several earlier
  waves - his device reports may arrive mid-wave; treat any on-device
  FAIL he reports as interrupting priority).
- Suite baseline at v1.74.0: 5904/5904 on BOTH Node versions, 0 fail.
- Tech-debt #93 is CLOSED BY this wave (record it); #42 (server-side
  bottom-nav prefs) stays OPEN and is explicitly out of scope.
- Branch naming: work on `release/v1.75.0` from current main; the same
  branch carries the release commit after the gate approves.

## Definition of done

Dean's on-device pass is the arbiter, with these probes in the ship
report: (1) an untouched device's bar has identical MEMBERSHIP and opt-in
state after upgrade - its ORDER changes exactly as the exec plan's D2-bis
consequence list records, because a CSS ladder found mid-wave had been
overriding the resolver (see D2-bis; probe (1) as originally written here
promised "the identical bar" and this wave deliberately does not);
(2) Home reordered away from first sticks across shells and reloads;
(3) the opted-in Liked entry navigates to the central Liked (/?liked=1)
and highlights correctly vs Home; (4) podcasts place shows no Liked card;
(5) music place shows no Liked tab; (6) hearts still toggle on song rows
and episode rows, and the central Liked reflects both immediately.
