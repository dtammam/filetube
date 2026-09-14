# Releasing FileTube

FileTube publishes a Docker image to `deantammam/filetube` on every push, but the
**tags** differ by what you push — so `latest` means "newest release," not
"newest commit."

## Image tags

| You push… | Image tags produced | Use it for |
|-----------|---------------------|------------|
| A commit to `main` | `edge`, `sha-<short>` | Bleeding-edge testing |
| A version tag `vX.Y.Z` | `X.Y.Z`, `X.Y`, `X`, `latest` | Real releases |

So consumers can:
- **Track releases:** `deantammam/filetube:latest` (updates only when you cut a release)
- **Pin exactly:** `deantammam/filetube:1.4.2`
- **Pin to a minor/major line:** `1.4` or `1` (get patches/minors automatically)
- **Live on the edge:** `deantammam/filetube:edge` (newest `main`)

[Watchtower](https://containrrr.dev/watchtower/) following `latest` auto-updates
on each release; following a pinned `1.4.2` never moves.

## Release notes (the ledger)

v1.144 (Dean): every release carries USER-LANGUAGE release notes, and the
app's account-menu version row links straight to them.

- **Source of truth:** `docs/releases.json` - one `{version, date, title,
  intent}` entry per release, appended in the release commit alongside the
  version bump. `intent` is 1-3 sentences for the person using the app:
  what changed and why they'd care. No process jargon - the
  `release-ledger` checker test enforces presence, ordering, tag
  completeness, and a jargon tripwire, so a release literally cannot ship
  without its note.
- **Publishing:** `.github/workflows/release-notes.yml` runs
  `scripts/sync-github-releases.js` on every tag push - it creates the
  GitHub Release for any tag that has a ledger entry and no release yet
  (idempotent; re-runs are always safe). The historical backfill (and any
  recovery re-run) is the same job triggered manually: Actions -> "Sync
  Release Notes" -> Run workflow.
- **The link:** the account menu's version row opens
  `https://github.com/dtammam/filetube/releases/tag/v<version>` - the
  running build's own notes.

## Cutting a release

> **Scope note:** the steps below are the minimal manual/Docker-tag
> mechanics. The full release ceremony actually used for this repo
> (release branch → gate → no-ff merge → tag → push) lives in
> `CLAUDE.md`; this doc is authoritative only for how tags map to
> published images.

1. Make sure `main` is green (CI passes) and you're on it:
   ```bash
   git checkout main && git pull
   ```
2. Bump the version in `package.json` to match the release, commit it
   (stage EXPLICIT paths - never `-a`/`-A`; blind staging once swept scratch
   files into a release commit. A Claude Code PreToolUse hook blocks it in
   agent sessions; on a plain shell NOTHING blocks it - the discipline is
   yours):
   ```bash
   npm version 1.4.0 --no-git-tag-version
   git add package.json package-lock.json
   git commit -m "Release v1.4.0"
   git push
   ```
3. Tag and push the tag (this triggers the versioned image build):
   ```bash
   git tag v1.4.0
   git push origin v1.4.0
   ```
   — or, equivalently, **draft a GitHub Release** in the UI with tag `v1.4.0`
   (publishing it creates and pushes the tag, which triggers the same build).
4. Watch the **Publish Docker Image** workflow. When it's green,
   `deantammam/filetube:1.4.0` and `:latest` are live.

   > **Rapid tag chains:** publishes are serialized per concurrency group and
   > GitHub holds at most ONE pending run per group - pushing three tags in
   > quick succession cancels the MIDDLE tag's run, so its versioned image
   > never publishes (`latest` still ends correct). After a same-day hotfix
   > chain, check the Actions list for a cancelled publish and re-run it.

Use [semver](https://semver.org/): bump **patch** for fixes, **minor** for
backward-compatible features, **major** for breaking changes.

## Schema versions and the rollback floor

FileTube's SQLite schema is versioned by `PRAGMA user_version`
(`SCHEMA_VERSION` in `lib/db/sqlite.js`). Two rules, both instated in
v1.127 after an external review proved the cost of skipping them
(v1.126 added the `folderDisplayNames` namespace at an unchanged version,
which made every durable write FAIL after a downgrade to <=v1.125):

1. **Any commit that adds or renames a persisted namespace bumps
   `SCHEMA_VERSION` in that same commit** - even when there is no
   structural migration to run (v18 is exactly such a marker). The stamp is
   what makes the change visible to other builds.
2. **A build refuses to open a database stamped newer than itself**
   (`migrateSchema` throws at boot, naming both versions). Silent
   forward-acceptance is how the v1.126 outage became possible.

**Rollback floor: a database touched by v1.126 or later is not writable by
v1.125 or earlier.** Released adapters can't be repaired retroactively
(they skip, rather than refuse, any version at or above their own), so
never downgrade an instance across that line; restore the matching backup
instead if you truly must run an older build.

**Second floor - schema v21 (v1.291, relational-migration arc Wave 1).** The
per-item view counter moved from the `doc_kv` `viewCounts` namespace into
the `media_view_counts` table, and the v21 migration deletes the doc rows
after copying them. A v1.290-or-earlier build REFUSES a v21 database at boot
(rule 2 above), so a downgrade is a clean refusal rather than lost counts.
To run an older build, restore that build's own backup bundle: the bundle
carries `viewCounts` in the same `{ id: count }` shape on both sides of the
line, so a v1.291+ bundle also restores into v1.290 and vice versa. Every
later wave of the arc adds a floor the same way (the plan lists them).

**Third floor - schema v22 (v1.292, Wave 2).** The frozen pre-auth watch
positions (`progress`) and the deferred-delete tombstones
(`deleteTombstones`) moved from `doc_kv` into `media_progress` and
`media_delete_tombstones`; the v22 migration copies the records verbatim
and deletes the doc rows. A v1.291-or-earlier build refuses a v22 database
at boot; bundles carry both keys in the same `{ id: record }` shapes on
both sides of the line.

**Fourth floor - schema v23 (v1.293, Wave 3).** The trashed-item records
(`trash`) moved from `doc_kv` into `media_trash`; the v23 migration copies
the records verbatim and deletes the doc rows. A v1.292-or-earlier build
refuses a v23 database at boot; bundles carry `trash` in the same
`{ trashId: record }` shape on both sides of the line, and a bundle
without the key still preserves the live records (the v1.65 rule).

**Fifth floor - schema v24 (v1.294, Wave 4, first group).** The app
settings (`settings`) moved from `doc_single` into `app_settings`, one row
per key; the v24 migration splits the object and deletes the doc row. A
v1.293-or-earlier build refuses a v24 database at boot; bundles carry
`settings` as the same merged object on both sides of the line.

**Sixth floor - schema v25 (v1.294, Wave 4, second group).** The folder
config (`folders`, `folderSettings`, `folderDisplayNames`) moved from
`doc_single` into `library_folders`, `library_folder_settings` and
`channel_folder_display_names`; the v25 migration splits the list and the
two maps into rows and deletes the doc rows. A v1.293-or-earlier build
refuses a v25 database at boot; bundles carry the three keys in their old
shapes on both sides of the line.

**Seventh floor - schema v26 (v1.294, Wave 4, third group).** The frozen
pre-auth likes (`liked`) moved from `doc_single` into `media_liked` (one row
per id, like order); the v26 migration copies the list and deletes the doc
row. A v1.293-or-earlier build refuses a v26 database at boot; bundles carry
`liked` as the same array on both sides of the line. After this floor no
top-level `doc_single` name remains - only container sub-keys.

## The publish pipeline: build once, smoke, promote (v1.148)

Since v1.148 the publish job never rebuilds between testing and pushing:

1. The image is built ONCE (`load: true`, a local `filetube-candidate`
   tag) - nothing is pushed yet.
2. A SMOKE TEST boots that exact image against a fresh anonymous data
   volume and asserts the measured first-run contract: `GET /login`
   (following redirects) reaches 200 via `/welcome`, and an
   unauthenticated `GET /api/stats` answers 401. A failed smoke dumps
   the container logs and blocks the push - nothing untested ships.
3. The SAME local image is promoted by identity (`docker tag` +
   `docker push`) to every release tag; the image id and repo digests
   are written to the run's step summary.

The pipeline is single-arch (amd64) by decision - build/load/run/push
depends on the runner executing the image.

**The dry-run lever (REQUIRED after any edit to docker-publish.yml):**
the workflow has a `workflow_dispatch` trigger that runs qualify, the
secret scan, the audit gate, the build, and the smoke with ALL push-side
steps skipped. (A dry-run shares the branch-push concurrency lane with
`edge` publishes - one pending slot; an evicted `edge` self-heals on the
next main push, and the tag lane is unaffected.)
The workflows cannot execute on the dev box, so a wave that changes
this file validates it with a post-merge dry-run (Actions -> "Publish
Docker Image" -> Run workflow) BEFORE the next real tag.

## The dependency audit gate (v1.148)

CI fails on any HIGH or CRITICAL `npm audit` advisory (full tree,
lockfile-only - `npm run audit:check`), and the SAME gate runs as its
own job on the release path inside docker-publish.yml (tag pushes skip
ci.yml - the v1.123 mirroring pattern), blocking a publish. The escape
hatch is
`docs/audit-exceptions.json`: EMPTY is the healthy state, and every
entry needs a GHSA id, a reason (>=15 chars), an added date, and a
revisit trigger - adding one is a reviewed commit, never a shrug. Stale
entries (advisory no longer reported) warn until removed. An upstream
advisory can red all CI overnight with zero local changes: that is the
gate working - fix with `npm audit fix` (preferred) or add the reviewed
exception. Dependabot (`.github/dependabot.yml`, weekly: npm grouped
minor+patch, the docker base image, github-actions) surfaces the fixes
as PRs; see the tiered auto-merge below.

**Reverting any of this** is one commit: delete `.github/dependabot.yml`
(bot stops; close open PRs), drop the `audit` job from ci.yml, or
`git revert` the docker-publish.yml change - all pure config, no data.

## Tiered Dependabot auto-merge (v1.206, reverses v1.148's no-auto-merge)

A low-risk Dependabot PR that passes full CI (both Node legs + the audit
gate) merges itself; a high-risk one waits for Dean.
`.github/workflows/dependabot-auto-merge.yml` arms `gh pr merge --auto`
(which GitHub holds until the required checks pass) only for the AUTO tier:

- **AUTO** (self-merges once CI is green): a github-actions bump that is not
  a major, and an npm **dev** dependency (`direct:development`) patch/minor
  bump that does not touch **jsdom**. The `npm-minor-patch` group is dev-only,
  so a grouped PR is all-development.
- **MANUAL** (Dean reviews a short digest): every **major** (any ecosystem);
  every **runtime** dep (`direct:production` - dotenv/express/mime-types ship
  in the image); the **Docker base image**; and **jsdom** (test-infra the
  whole suite rides). No workflow step runs for these - the PR just sits.

**Repo settings Dean must enable ONCE.** Until they are set, an AUTO-tier PR's
merge step ERRORS ("Auto-merge is not allowed for this repository") - so that
PR shows a failed "Dependabot auto-merge" check and nothing merges; it waits
for Dean and self-heals the moment the settings are on. (It is NOT a silent
no-op, and the workflow does no harm - it just cannot complete the merge yet.)

1. Settings -> General -> Pull Requests -> tick **Allow auto-merge** AND
   **Allow squash merging** (the workflow uses `gh pr merge --auto --squash`,
   which needs squash enabled).
2. Settings -> Branches -> add a **branch protection rule** for `main`:
   "Require status checks to pass before merging", and select the CI checks
   (the `ci` matrix jobs, `secret-scan`, `audit`). This is what makes
   auto-merge WAIT for green CI rather than merge immediately; it also
   protects `main` for human PRs.

Reverting the auto-merge: delete `.github/workflows/dependabot-auto-merge.yml`
(and, if desired, the two repo settings) - pure config, no data.

## Notes

- The version tag drives the image version; `package.json` is kept in sync by
  step 2 for humans and tooling (it isn't read by the build).
- Only tags matching `v*.*.*` trigger a release build.
