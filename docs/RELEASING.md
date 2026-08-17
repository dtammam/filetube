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

## Notes

- The version tag drives the image version; `package.json` is kept in sync by
  step 2 for humans and tooling (it isn't read by the build).
- Only tags matching `v*.*.*` trigger a release build.
