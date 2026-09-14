# Wave 7b, slice S1a - the user-state routers leave server.js

You are an Opus worktree subagent doing ONE mechanical slice of the monolith split.
Repo: /home/coder/projects/filetube. Base branch: `feat/wave7b-r1` (its tip is the design
commit; read the Wave 7b section of
docs/exec-plans/active/2026-09-13-sqlite-relational-migration.md FIRST - it is the spec).
Export the Node PATH before every node/npm/git command:
`export PATH="$HOME/.local/share/fnm/node-versions/v22.23.1/installation/bin:$PATH"`.

## Isolation
Work ONLY in your own worktree: `git worktree add .claude/worktrees/w7b-s1a -b w7b/s1a feat/wave7b-r1`
(from the repo root), then `cd` there for everything. Never touch the main checkout's files
or branch. The pre-commit hook resolves node_modules by walking up, so commits work in the
worktree (it lints + runs the unit suite; commit in the background if it exceeds 2 minutes).
No `git add -A` / `git add .` / `commit -a` - stage explicit paths. Commit messages carry
MEASURED numbers only (re-run the instrument on the staged tree before writing them).

## The move (S1a, ~515 route lines - census numbers)
Move these route groups out of server.js into modules exporting `registerRoutes(app, deps)`:
- `/api/queue` (6 routes, 77 lines) -> lib/queue/routes.js
- `/api/notifications` (6 routes, 194 lines) -> lib/notifications/routes.js (new directory)
- `/api/push` (3 routes, 69 lines) -> lib/push/routes.js
- `/api/history` (3, 73), `/api/search-history` (4, 20), `/api/watched` (2, 15),
  `/api/prefs` (2, 24), `/api/feed-hidden` (3, 43) -> lib/user/routes.js (new directory)
`node scripts/monolith-split-census.js --group /api/queue` (etc.) prints each group's
measured deps list - the module-scope names its callbacks reference.

Rules (the plan's invariants, all machine-checked):
1. **Bodies byte-identical.** Each `app.<verb>('<path>', <callback>)` statement moves VERBATIM
   into the module's `registerRoutes` body - same text, same order within the group. Inside
   the module the free identifiers resolve from `const { a, b, ... } = deps;` at the top of
   registerRoutes, listing exactly the census deps (drop `app`). Do not rename, reformat,
   reorder or "improve" anything. Comments immediately above a route belong to it and move
   with it.
2. **Group-private helpers move; shared ones are deps.** A module-scope function/constant
   referenced ONLY by the group's routes (check with grep across server.js and lib/) may move
   into the module verbatim (e.g. `notificationsFeatureEnabled`, `shapedQueue`,
   `normalizeSearchTerm`, `SEARCH_HISTORY_CAP`, `SYNCED_PREF_KEYS`, the `PREF_*` constants -
   VERIFY each by grep; if anything else references it, or server.js EXPORTS it, keep it in
   server.js and pass it as a dep). Anything server.js exports keeps being exported from
   server.js as the SAME function object (re-export the module's function).
3. **The registerRoutes CALL sits exactly where the group's FIRST route was** in server.js
   (the `require` goes with the other requires near the top). The deps object is literal at
   the call site, one property per name, a one-line comment per non-obvious dep (the style
   of the `ytdlp.registerRoutes(app, {...})` call near the bottom of server.js).
4. **Routing signature unchanged.** Before you edit: `node scripts/route-order-signature.js
   2>/dev/null | grep '^sig ' | sort > /tmp/.../before.txt`. After: the same to after.txt.
   `diff` must be EMPTY, and each moved group's lines must appear in the same relative order
   in both (unsorted outputs). Paste the diff (empty) in your report.
5. **Text locks re-pointed, never loosened.** 22 tests read server.js as text. Run
   `npm run test:unit`; for any lock that now fails because its sentence moved, point it at
   the new file for the SAME sentence (or bind both files). Never delete or weaken an assert.
6. Green: `npm run lint`, `npm run test:unit`, then `npm test` (full; ~7 minutes - background
   it, one run per background task). Report the counts verbatim (Node 24's reporter prints
   `ℹ`, Node 22 `#`).
7. Re-run `node scripts/monolith-split-census.js`: the moved groups must be GONE from the
   route-group table; report the new serverLines and the per-module line counts.

Module skeleton (match the repo's style: 'use strict', a header comment saying what moved and
from where, `module.exports = { registerRoutes }` plus any moved helper a test needs):
```js
'use strict';
// lib/queue/routes.js - the /api/queue routes, moved VERBATIM out of server.js in
// Wave 7b (slice S1a) of the relational-migration arc; server.js hands the
// collaborators in through `deps` (the lib/ytdlp registerRoutes pattern).
function registerRoutes(app, deps) {
  const { getCachedDatabase, mediaVisibleTo, /* ... */ } = deps;
  app.get('/api/queue', (req, res) => { /* verbatim */ });
  // ...
}
module.exports = { registerRoutes };
```
If a dep is missing at runtime the module must fail loudly (a destructured undefined that is
later called throws anyway; do not add fallbacks).

## Report (to the main session; it verifies by machine, not by your prose)
- The commit hash on `w7b/s1a`; files created/changed with line counts.
- For each group: lines moved, the deps list as passed, which helpers moved (with the grep
  proof they were private).
- The routing-signature diff (must be empty) and the order check.
- Every test you re-pointed, with the old and new lock line.
- Suite counts verbatim (unit + full). Any residual you could not resolve, honestly.
Leave the worktree committed and clean; do NOT merge, do NOT push, do NOT touch main or
`feat/wave7b-r1`. Do not delete the worktree (the main session inspects it).
