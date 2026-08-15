<!-- Maintained by Dean. Populated 2026-07-16 by the working agent at Dean's
     EXPLICIT direction (v1.41.11 wave intake, overriding the previous
     "humans only" rule for that one request). Re-graded 2026-08-15 by the
     working agent at Dean's explicit per-instance direction ("Update it,
     it's okay" - v1.129 Wave C intake). Future agents: do NOT modify
     this file again without Dean's explicit, per-instance request. -->

# Quality Score

Grades each domain by architectural layer. Updated periodically.
If a grade is C/D/F, the next action must be concrete.

Graded 2026-08-15 (v1.129) from the shipped evidence: the ROADMAP release
history through v1.128, `docs/exec-plans/tech-debt-tracker.md` (116 open
items, count hook-derived and test-bound), the recurring bug classes the
gates have caught, two external static reviews (2026-08-14/15) and the three
waves that answered them, and the test suite (6,928 tests, 340 unit + 190
integration files, run on a Node 22 + 24 matrix in CI and for every release).

| Domain | Types | Repo | Service | Runtime | UI | Tests | Overall |
|--------|-------|------|---------|---------|-----|-------|---------|
| Media streaming & transcoding | C | C | B | B+ | B | B+ | **B** |
| Library scan & SQLite persistence | D | C | B+ | B+ | — | A- | **B** |
| Delete & file integrity (tombstones/trash) | C | C | B+ | B+ | B | A- | **B+** |
| yt-dlp subscriptions & downloads | C | C | B | B | B | B | **B** |
| Books & TTS | C | B+ | B | B | B | B | **B** |
| Music library | C | B+ | B | B | B | B | **B** |
| Podcasts (private-RSS engine) | C | B+ | B+ | B | B | B+ | **B+** |
| Player (web client) | C | C | B | B | B- | C+ | **B-** |
| SPA shell & views | C | C+ | — | B | C+ | B- | **C+** |
| Stats & reporting | C | B+ | B+ | B+ | B | B+ | **B+** |
| Security & multi-user | C | B | B | B | B | B+ | **B** |
| Build, test & release engineering | — | B+ | — | — | — | A- | **A-** |

## Grading scale

- **A:** Exemplary. No known issues.
- **B:** Good. Minor issues, no blockers.
- **C:** Needs work. Known gaps that should be addressed soon.
- **D:** Problematic. Active risk to reliability or velocity.
- **F:** Critical. Must be addressed before new feature work.

## Rationale (the honest version)

- **Types (C, with scan/persistence still D):** still deliberately plain
  JavaScript, no machine-checked typing anywhere. The contract-comment +
  lock-test mitigation works but the db-item shape STILL has no single
  authoritative definition, and the persist-gate/stale-snapshot class struck
  again since the last grade (v1.115/v1.116 - a `!field` carry reverting a
  mid-scan backfill). The feature-OWNED namespaces (books/music/podcasts)
  avoid the class entirely, which is the pattern's vindication.
- **Repo (C for the giants):** the mega-files have GROWN since the last
  grade: `server.js` ~17,200 lines (was ~9,400), `common.js` ~12,000,
  `style.css` ~11,500, `player.js` ~7,300, `lib/ytdlp` ~7,200. The newer
  subsystems (books/music/podcasts/stats/visibility/queue reducers) are
  properly extracted behind deps-bundle seams. Dean's standing call
  (2026-08-15): no big-bang decomposition - new code lands in modules,
  extraction is opportunistic.
- **Library scan & SQLite persistence (B, up from B-):** node:sqlite behind
  the unchanged updateDatabase seam since v1.42 - WAL with fallback,
  transactions, the unknown-key persistence lock, a real kill-9 crash test,
  and (v1.127) a schema version that REFUSES databases from the future plus
  a documented rollback floor. The v1.126 downgrade write-outage (caught by
  external review, confirmed by a live repro against the released v1.122
  adapter) is why the rule "new namespace = version bump, same commit" now
  exists in RELEASING.md.
- **Delete & file integrity (B+):** the most battle-verified code in the
  repo; every id-keyed per-user set joins every carrier including the backup
  bundle (the v1.97 lesson), trash is recoverable, moves are confined and
  mutation-tested. Not an A because the class keeps recurring on NEW
  carriers.
- **Security & multi-user (B, up from D - the biggest change since the last
  grade):** a mandatory auth wall (scrypt, HMAC sessions, per-request
  revocation, HttpOnly/SameSite/conditional-Secure cookies), admin/member
  roles with two write capabilities, per-user visibility restrictions
  (blocklist AND fail-closed allowlist) enforced across video/music/books/
  podcasts - and, after the v1.123-v1.128 arc: rotated instance secret +
  gitleaks CI, the object-visibility sweep, the bulk-route closure (v1.127),
  and the read-surface metadata isolation (v1.128). BOTH route tables are
  now bound by forcing nets (write classification with justified exemptions;
  read classification of all 84 GET routes). Not higher because: the posture
  is LAN-only by design - no CSP/security headers, root container, no image
  scanning (all bundled as tech-debt #154, trigger = any internet exposure);
  disclosed count-oracles remain (#150/#152/#153); and the personal-write
  routes are existence-oracles.
- **Player (B- overall):** functionally strong and battle-won (bg audio,
  chapters, custom captions, faux-fullscreen, handoff), but the CSS cascade
  and iOS-specific traps still only fall to Dean's on-device pass; there is
  still no real-browser automation lane. One open static inference: captions
  in PiP/native-fullscreen (#155, awaiting the device probe).
- **SPA shell & views (C+):** the router's "swap only #view-root" contract
  and shell-ownership class keep needing the lesson re-applied (v1.117's
  sidebar parity net helped); Tests moves to B- on the strength of the
  parity/forcing nets.
- **Build/test/release (A-):** dual-Node 22+24 CI matrix, publish gated on
  re-qualifying the EXACT pushed ref + a pinned secret scan, a tag==package
  version assert, serialized publish lanes, checker-first docs censuses
  (status, links, tracker topology - each executed in the suite), and the
  two-reviewer gate now running in ISOLATED worktrees. Docked a notch for:
  documented load-flakes (#76/#135), no built-image smoke test (the source
  is qualified, the image is not booted - #154), and no real-browser lane.

## Action items

<!-- For any C/D/F grade, list the specific next step here. -->

- **Scan/persistence Types (D):** unchanged and still the top structural
  item - define the db-item shape ONCE (a `normalizeItem()`/schema module
  every writer passes through) to retire the persist-gate class structurally.
  It struck again at v1.115/116 after this item was first written.
- **Repo layout (C):** hold Dean's line - new code in `lib/` modules behind
  deps seams; extract a domain when a feature next forces it open
  (streaming/`sendRangeable` and the delete flow remain the ripest).
- **Player/UI tests (C+):** a real-browser smoke lane (Playwright boots the
  shells + player mount) is still the missing instrument for the cascade
  class; Dean's device pass stays the arbiter. Probe #155 (PiP captions)
  first.
- **SPA shell & views (C+):** finish tech-debt #34's `.sub-*` slice; keep
  applying the sidebar-parity net pattern to new shells.
- **Security (B):** nothing before exposure; if FileTube ever leaves the
  LAN/VPN, execute tech-debt #154 as its own full wave FIRST.
- **Types elsewhere (C):** unchanged low-cost step - `// @ts-check` + JSDoc
  typedefs on NEW lib/ modules only.

## History

- **2026-07-16 (v1.41.11):** initial population, at Dean's explicit request.
- **2026-08-15 (v1.129):** full re-grade at Dean's explicit per-instance
  request (Wave C). Biggest movements: Security D -> B (the v1.42-44
  auth/RBAC tranche + the v1.79-81 visibility/write-RBAC waves + the
  v1.123-128 external-review response); persistence B- -> B (SQLite,
  rollback floor); release engineering's old dock ("discipline, not
  automation") retired - the gates are IN CI now. The mega-file Repo grades
  did not improve and the files are larger; that is a deliberate,
  Dean-ratified trade.
