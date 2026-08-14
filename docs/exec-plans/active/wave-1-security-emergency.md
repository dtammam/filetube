# Wave 1: security emergency (v1.123.0)

Status: ACTIVE (implementing). Date: 2026-08-14. Grounded at `aa06fa2` (v1.122.0).

Origin: an external adversarial codebase review (2026-08-14) graded security F
on five claims. Every claim in scope here was RE-VERIFIED against the tree
before this plan was written - nothing below is taken on the review's word.
Dean's deployment posture (stated 2026-08-14): self-hosted, LAN-only, no
internet-facing reverse proxy. That bounds the blast radius of F1 but does not
change the fixes.

Intake decisions (Dean, 2026-08-14): scope agreed as below; NO git-history
rewrite (the secret is dead after rotation; rewriting main breaks tags/clones);
gitleaks scanning IN; `latest`-after-device-pass promotion OUT (publish gating
on a green suite gets the real safety); items 6-10 of the external review are
NOT adopted here (separate programs, separate intakes).

## Verified findings

- **F1 - the live cookie-signing secret is tracked in a PUBLIC repo.**
  `session-secret` (repo root) has been tracked since v1.43 (`15998c3`), and
  `github.com/dtammam/filetube` answers unauthenticated API calls (HTTP 200) -
  the repo is public. Anyone can read the secret and forge session cookies for
  any instance whose secret matches. The resolver
  (`lib/auth/gate.js resolveSessionSecret`) re-mints a fresh 0600 secret when
  the file is absent; no test reads the tracked file (all tests mint their own
  in temp DATA_DIRs - verified by grep).
- **F2 - podcast delete/restore ignore the visibility axis.**
  `episodeVisibleTo` (v1.80 RBAC) gates the read routes
  (`lib/podcasts/index.js:769,914,1060,1084` and `/podcastart`), but
  `DELETE /api/podcasts/episodes/:id` (`:1184`) and
  `POST /api/podcasts/episodes/:id/restore` (`:1236`) check only
  `requireModifyLibrary` - a member holding the modify-library capability can
  trash/restore episodes of a show HIDDEN from them, by id. This is the
  "writer has capability but resource is hidden" matrix gap the v1.81 wave's
  net does not cover (that net binds the capability axis only).
  Known additional candidate found during verification:
  `POST /api/podcasts/episodes/:id/played` (`:1290`) has no visibility check
  (per-user write + existence oracle); the audit classifies it with the rest.
- **F3 - visibility-gated art is publicly cacheable; the backup is cacheable at all.**
  Book covers (`server.js:7221`), album art (`server.js:8139,8145`) and podcast
  art (`lib/podcasts/index.js:1124,1132`) all 404 per-user via RBAC yet serve
  `Cache-Control: public` - a shared cache (reverse proxy) can hand a
  restricted user another user's copy. `GET /api/admin/backup`
  (`server.js:8485`) - password hashes, per-user state, podcast secrets -
  sets NO Cache-Control at all. The correct posture already exists in-tree:
  video thumbnails serve `private, max-age=86400` (`server.js:15573`).
- **F4 - Docker publish is ungated; CI is single-Node.**
  `.github/workflows/docker-publish.yml` triggers on any push to main or any
  `v*` tag with zero dependency on the CI workflow - a red suite still
  publishes `latest`. `ci.yml` runs Node 22 only while the release ceremony
  claims dual-Node 22/24 (its "no matrix" comment documents a decision the
  ceremony contradicts - a comment-accuracy finding in its own right).

## Tasks (each its own commit, each green before the next)

- **T1 - rotate + untrack the secret.** `git rm --cached session-secret`,
  delete the local file (next dev boot re-mints), add `/session-secret` to
  .gitignore next to the vapid-keys entry. NO history rewrite (intake
  decision). Release notes disclose the exposure window (public since v1.43).
- **T2 - secret scanning in CI.** A gitleaks step in `ci.yml` scanning the
  CURRENT TREE (not history - the historical leak is known, disclosed, and
  dead after rotation; a history scan would be permanently red). Pin the
  action/binary version.
- **T3 - close F2 + build the capability x visibility forcing net.**
  Delete/restore get the same `episodeVisibleTo` -> 404 posture as the read
  routes (404, not 403 - never confirm a hidden resource exists). Then the
  net: machine-enumerate every id-addressed route across server.js and
  lib/*/index.js, classify each on BOTH axes (capability gate, visibility
  check) in a table the test derives from source - an unclassified route
  FAILS the suite, the v1.81 pattern extended with the second axis.
  Behavioral tests: a restricted member WITH modify-library 404s on
  delete/restore of a hidden episode and the file does NOT move.
- **T4 - cache headers.** The five art sites -> `private, max-age=86400`
  (placeholder SVGs -> `private, max-age=3600`), matching the thumbnail
  posture. Backup -> `no-store`. Header assertions bound behaviorally
  (flip a header, watch the test go red).
- **T5 - gate Docker publish + align the Node matrix.** A `qualify` job
  (npm ci, lint, token ratchet, full suite) inside docker-publish.yml runs on
  the EXACT SHA being published; the publish job `needs` it. `ci.yml` gets a
  Node 22/24 matrix and its "no matrix" comment is corrected (a lying comment
  is a finding). Both changes are declarative YAML - reviewers verify by
  reading the `needs:` edge and the matrix, not by running Actions.

## Machine-derived predictions (re-verified at every commit)

These are PREDICTIONS the tools re-check, not hand-maintained truth:

- **Visibility-gap set (T3).** Re-derive with:
  `grep -rnE "app\.(post|delete|patch|put)\(['\"][^'\"]*:id" server.js lib/*/index.js`
  then subtract routes writing ONLY the caller's own per-user state. As of
  `aa06fa2` the SHARED-resource mutators missing a visibility check are
  exactly two: `DELETE /api/podcasts/episodes/:id` and
  `POST /api/podcasts/episodes/:id/restore`. The per-user personal routes that
  also skip the check (`.../played`, music/book liked+progress) write only the
  caller's namespace; the net CLASSIFIES them explicitly (personal-oracle,
  non-blocking) so none is silently uncovered. If this count changes, the plan
  is stale - re-verify before coding.
- **Cache-header sites (T4).** Predicted 5 art sites + 1 backup route. Re-derive:
  `grep -rn "Cache-Control', 'public" server.js lib/podcasts/index.js` (expect
  book cover, album art x2, podcast art x2) and the `/api/admin/backup` handler
  (expect zero Cache-Control today).

## Gate

FULL gate (F1 can forge admin sessions; F2 can destroy shared media - the
data-loss trigger for the never-slim rule). Adversarial seat briefed to: forge
a session from the tracked secret; as a modify-library member, trash an episode
of a show restricted from them and prove the file moved; fetch restricted art
and prove a shared cache would serve it cross-user; construct a red tree and
prove the publish job would still fire. Reviewers verify every prescription,
including their own.

## Stop condition

Both seats APPROVE; dual-Node (22 + 24) suites green and reported verbatim;
secret rotated + untracked + ignored; the forcing net fails on an unclassified
id-route and on a visibility regression; publish gated on the exact-SHA qualify
job. Then release ceremony (v1.123.0), device-probe list to Dean, plan moves to
`completed/`.