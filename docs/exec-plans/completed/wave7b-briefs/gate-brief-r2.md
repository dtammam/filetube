# Wave 7b R2 gate brief - four parallel slices of the monolith split (v1.298.0 candidate)

Branch `feat/wave7b-r2` off main `c5b91c31` (v1.297.0). Spec: the "Wave 7b - the monolith
split" section of docs/exec-plans/completed/2026-09-13-sqlite-relational-migration.md incl. its R1
and R2 records (the R2 record on the branch tip is the full claim list). Instruments:
`node scripts/monolith-split-census.js`, `node scripts/route-order-signature.js`,
`node scripts/verify-split-slice.js <base> <tree> <group>=<module> ...` (run from the checkout;
against base 52d3e03e for every R2 group the ONLY failures are the documented seam lines).

## The claims
Four slices moved 78 route + middleware registrations (98 -> ~20 left) and three scan passes
out of server.js into lib/music/routes.js + scanRunner.js, lib/tv/routes.js + scanRunner.js,
lib/config/routes.js, lib/media/routes.js, byte-identical except the DOCUMENTED tokens:
- the mutable `ffmpegAvailable` (a `let` an async boot probe flips AFTER registration) crosses
  as a live reader in S3 (1 site), S4 (4 sites), S10a (1 site) - each mutation-proven;
- `ttsEngineVersion` (S10a, same class);
- two relative require specifiers re-rooted (`./lib/ytdlp/activity` -> `../ytdlp/activity`) -
  the R2 find: a relative specifier inside a moved body resolves against the NEW file; broke a
  route's async tail until the integration suite caught it; now an AST net
  (test/unit/media-routes-live-seams.test.js) resolves every relative specifier in every
  extracted module.
Everything else: register calls at each contiguous block's first-route site (4 + 1 + 6 + 7
register functions, each split measured - a TDZ or a signature diff, never assumed); helpers
moved only with grep/espree proof; locks re-pointed onto the route surface never loosened;
exact counts re-measured on the MERGED tree; the routing signature's unsorted output identical
to the base for every slice.

## Named attack surfaces (adversarial seat)
- **Relative specifiers + `__dirname`/`__filename` + `require.resolve` inside moved bodies**:
  the R2 find generalised. Sweep every extracted module (all 14) for `require('./`, `require('../`,
  `__dirname`, `path.join(__dirname`, `require.resolve`, `import(`; the new net claims to resolve
  every relative specifier - mutate a specifier and confirm red; check `__dirname`-based paths
  (S10a kept `crittersDir` in server.js for this reason - is anything else `__dirname`-relative
  in a moved body?).
- **Mutable seams, again, now at scale**: AST-walk every deps object across ALL 25+ register /
  factory calls for names reassigned anywhere in server.js (`let`, `__set*ForTests`, lazily
  assigned); the three slices found `ffmpegAvailable` and `ttsEngineVersion` - find a fourth.
  Also the reverse: a `let` that MOVED with its writers (S4's busy flags, S10a's bulk latch) -
  does any server.js code still read the OLD binding (now undefined)? `grep` each moved `let`'s
  name in server.js code.
- **TDZ / boot order** at every new call site (seven in S10a alone): each deps name declared
  above the call, or a hoisted function.
- **Four-slice interaction**: a helper one slice moved that another slice's routes referenced
  (each was proven private on the BASE, not on the merged tree - prove it again on the tip);
  two slices moving code near the same lines; the merged exact counts (podcastsDb 13, ytdlpDb
  15, musicDb.mutate 3, tvDb.mutate 2, tvDb.read >= 13, booksDb.mutate 5) re-counted by you.
- **The scan runners** (music, tv - the book one from R1): the factory closes over deps at
  boot; `scanMusic`/`scanTv` in server.js drive them; the deferred-rescan timers stay in
  server.js - run the scan integration suites and a real scan of a temp library for each.
- **Route-order**: S10a's seven-way split and S3's four-way split were forced by order; prove
  by first-match resolution over generated URLs against a v1.297.0 sandbox that no request
  resolves differently (esp. `/api/videos/:id` vs the static `/api/videos/...` siblings,
  `/api/music/:id` vs `/api/music/progress`, `/tv*`).
- **RBAC**: the moved mutating routes (`/api/videos` rename/move/delete/attribute/bulk,
  `/api/config`, `/api/settings`, `/api/cache`, `/api/tv/config`, `/api/music/config`, critters
  upload/delete) - the route-table-derived nets + hit a few as a member against a v1.297.0
  sandbox.
- **The re-export identities** (13 in S10a incl. the bulk-attribution setter) and the moved
  latch: `__setAttributeBulkInProgressForTests` through server.js sets the MODULE's variable
  (the one the routes read)?
- **Locks**: card-like's statement-scoped window (mutant M4 survived the first cut); the
  critter-manager marker with four-space indent; the tv-server-wiring windows; every re-pointed
  lock mutated once.
- **Counts** in the four commit messages + the merge commits vs the instrument at each commit.

## Measured at the branch tip (Node 22.23.1, main checkout, no parallel load)
NOTE (added post-gate): the figures below are the PRE-fix-round tip at 6b1476f1. The released tip
after the gate fix round is server.js **13,563** lines and `npm test` **8785 / 8785 / 0 / 0**.
Census: server.js 13,566 lines (17,093 at v1.297.0); 22 route + middleware registrations (98);
251 functions = 7,735 lines; 513 module-scope names. Merged tree `npm test`: 8782 / 8782 / 0 / 0.
Verifier over all 29 R2 groups vs 52d3e03e: exactly the six documented seam routes fail;
201 base export names intact; 13 re-export identities checked. Routing signature unsorted
identical to the R2 base (199 routes).
