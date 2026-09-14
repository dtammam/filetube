# Wave 7b R3 - the giant FUNCTION extractions (common addendum; read with brief-s1a.md + brief-parallel.md)

R3 moves FUNCTIONS, not route groups. Same contract (byte-identical bodies modulo one indent
level on CODE lines, helpers only with grep/espree proof, locks re-pointed never loosened,
parallel-safe edits, measured numbers, the shipped verifier), with these R3-specific rules:

1. **Shape: a factory.** Each module exports `create<Thing>(deps)` returning the moved functions
   as an object, e.g. `const { trashItem, restoreTrashItem, ... } = require('./lib/media/trash').createTrashOps({ ... })`
   at the position of the FIRST moved function's declaration in server.js. The moved functions
   keep their names and bodies verbatim inside the factory (declared as `function name(...) {}`
   inside it, so they still hoist relative to each other and `arguments`/`this` semantics are
   unchanged - a moved function that used `this` or `arguments` at top level must be reported).
2. **server.js keeps exporting every moved name it exported before, as the SAME function
   object** (the destructured binding from the factory). Tests and lib modules that import a
   moved name from server.js by path must keep working (re-export identity is checked).
3. **Mutable state moves WITH all its readers and writers, or stays with all of them** (the R2
   lesson: a destructured dep FREEZES a `let`). For every `let` / mutable object the moved
   functions touch: if EVERY reader and writer is in your slice, it moves into the factory; if
   any reader/writer stays in server.js, the value crosses as a LIVE accessor (`get x() {
   return x; }` on the deps object, or a `() => x` reader) - never a bare destructured copy.
   Report each such variable and which way it went.
4. **Cross-slice function deps: LAZY.** Another R3 slice may turn a top-level function
   declaration your code calls (hoisted today) into a `const` from a factory call that sits
   BELOW your call site (TDZ at boot). For any dep that is a top-level FUNCTION of server.js
   AND is on another R3 slice's move list (named in each brief), pass a lazy wrapper:
   `moveItemToFolder: (...args) => moveItemToFolder(...args)`. For functions no other slice
   moves, pass the binding directly.
5. **Relative `require()` specifiers and `__dirname` inside moved bodies** resolve against the
   NEW file (the R2 find): re-root every relative specifier (`./lib/x` -> `../x` etc.) and
   report each; a `__dirname`-based path stays in server.js and crosses as a dep. The
   live-seams net (test/unit/media-routes-live-seams.test.js) must stay green over your module
   - extend its module list if it is hand-kept.
6. **The verifier** (`scripts/verify-split-slice.js`) checks ROUTE statements. For functions,
   run the main session's function check (same directory as the briefs, `verify-functions.js`,
   usage in its header) from the main checkout and paste its output; the only acceptable
   FAIL is a documented live-accessor / re-rooted-require line.
7. **Data-loss discipline**: these functions hold the only way back for a user's files (trash,
   restore, move, backup) or rebuild the whole index (scan). Run EVERY integration suite that
   exercises your functions (grep test/ for each moved name) and report the counts verbatim;
   a failure is reported verbatim, then diagnosed - never re-run into green.
8. Everything else as in brief-s1a.md / brief-parallel.md (worktree from the R3 base, require
   at the call site, registry list additions, no docs, lint + unit + full suite, honest
   residuals, worktree left committed and clean, not removed).
