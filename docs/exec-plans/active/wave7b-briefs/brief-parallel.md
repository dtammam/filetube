# Wave 7b R2 - the PARALLEL slice addendum (read with brief-s1a.md, the full rules)

Four slices run at the same time, each in its own worktree, all branched from the SAME base
commit of `feat/wave7b-r2`. The main session merges the four branches one by one afterwards
and re-runs `node scripts/verify-split-slice.js` on each. To keep the merges clean:

1. **Confine your server.js edits to your own groups.** You remove your groups' route
   statements (and only helpers you PROVED private to them by grep), and you add exactly one
   register call per contiguous sub-group at the position of that sub-group's first route.
   Touch nothing else in server.js - no comment fixes elsewhere, no reordering, no shared
   require block edits.
2. **Place your `require` IMMEDIATELY ABOVE your first register call**, e.g.
   ```js
   const musicRoutes = require('./lib/music/routes'); // Wave 7b S3: the module's require sits at its call site so parallel slices never touch the same hunk
   musicRoutes.registerRoutes(app, { ... });
   ```
   NEVER in the top-of-file require block (every slice would edit the same lines).
3. **The route-surface registry** (`test/unit/route-surface.test.js`, the `EXPECTED` list):
   add your module path(s) in sorted position. This is the ONE file where a merge conflict
   is expected; the main session resolves it by taking every slice's additions.
4. **Exact-count and floor locks** you must re-measure (podcastsDb / ytdlpDb / booksDb /
   musicDb / tvDb counts on the route surface, etc.): change them, and REPORT old -> new with
   the reason, because the other slices may move the same counts and the main session
   re-measures on the merged tree.
5. **Do not touch docs** (DIAGRAMS, the plan, the tracker) - the main session writes the
   R2 record after the merges.
6. Everything else as in brief-s1a.md: bodies byte-identical (one indent level on CODE lines
   only - lines inside a multi-line template/string literal are content and stay put), the
   census's deps list (scope-unaware: a name every use shadows locally, like `mime`, is a
   false positive - prove it and leave it out), a deliberate non-byte-identical token only for
   a MUTABLE seam (a `let` reassigned later, a `__set...ForTests`), mutation-proven and
   documented in the header, the call site and the commit message; the routing signature
   (`scripts/route-order-signature.js`, unsorted) identical to the base commit's; text locks
   re-pointed onto the route surface (`test/helpers/route-surface.js`) never loosened; no
   literal slash-star inside any line comment you write or move; `npm run lint`, `npm run
   test:unit`, then `npm test` in the worktree (expect 3 Playwright skips there - a missing
   nested install, environmental); measured numbers only (re-run the instrument on the
   staged tree right before writing the commit message); explicit staging; no merge, no
   push, worktree left committed and clean, not removed.
7. **Run the shipped verifier yourself before you report** (from the MAIN checkout's root,
   pointing at your worktree):
   `cd /home/coder/projects/filetube && node scripts/verify-split-slice.js <BASE> .claude/worktrees/<yours> <group>=<module> ...`
   Paste its output. The only acceptable FAIL is a documented mutable-seam token.

Report as in brief-s1a.md (commit hash, per group lines/deps/helpers with grep proof, the
signature check, every re-pointed lock old -> new, any token deviation with its proof, suite
counts verbatim, residuals honestly).
