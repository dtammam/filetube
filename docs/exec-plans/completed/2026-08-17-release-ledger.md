# The release ledger: user-intent release notes, GitHub-published, version-row linked

Status: SHIPPED v1.144.0 (2026-08-17). Slim gate, 1 fix round, APPROVE (the CRITICAL: three first-of-a-pair ledger entries claimed their follow-up's victory - reworded). Owner: main session.

Dean (2026-08-17): "Make the releases more clear. Clearer into the intent
organically. If possible retroactively update descriptions. And make the
version in the settings menu when you click avatar be clickable, go to the
release, show the specific context of the release." Intake rulings: (1)
tiered retroactive backfill, (2) the surface is the EXTERNAL GitHub
release page, (3) pure user language, zero process jargon, (4) the
ceremony must carry this forward permanently (CLAUDE.md/RELEASING.md).

## Framing

The engineering record (ROADMAP.md Shipped, commit messages, tags) stays
UNTOUCHED - tags are immutable refs and ROADMAP is the gate's honest
archaeology. "Retroactive" means a NEW curated layer: a checked-in ledger
of user-facing notes, published to GitHub Releases (which sit ON the
existing tags - nothing force-moved), linked from the app.

## Machine-derived facts (re-verified at every commit)

- `git tag | wc -l` = 294 tags, v1.0.0 .. v1.143.0.
- ROADMAP.md `^### v` headings = 215, covering v1.31.0+.
- Repo is PUBLIC (api.github.com/repos/dtammam/filetube -> 200): the
  release links work for every household member, not just Dean.
- The account-menu version row exists (common.js injectAccountMenu,
  v1.90) - today a non-interactive `div.account-menu-version` reading the
  server-stamped `<meta name="ft-version">`.
- `.github/workflows/docker-publish.yml` already triggers on
  `tags: ['v*.*.*']` - the natural publisher host.
- No `gh` CLI on the dev box -> publishing runs in CI (runners ship gh +
  GITHUB_TOKEN), never locally.

## Tasks

- **T1 - the ledger.** `docs/releases.json`: ascending array of
  `{version, date, title, intent}` - `intent` is 1-3 sentences of pure
  user language. Tiered backfill: v1.31.0+ distilled from ROADMAP
  entries; v1.0.0-v1.30.x one-liners distilled from merge/release commit
  subjects. ALL 294 tags covered (predicted count; the checker re-derives).
- **T2 - the checker** (test/unit/release-ledger.test.js, the DIAGRAMS
  posture): JSON parses; versions valid semver, strictly ascending,
  unique; dates ISO and non-decreasing; title/intent non-empty;
  `package.json` version HAS an entry (the ceremony cannot ship without
  writing the note); every `git tag` has an entry (guarded: skipped with
  a note when the clone has no tags - CI checkouts are shallow); and a
  TONE TRIPWIRE - a jargon blocklist (gate/mutant/adversarial/suite/
  APPROVE/dual-Node/regression/reviewer...) rejects process language in
  title/intent. Blocklists are porous by nature (#157) - this one is a
  tripwire, not the contract; the contract is editorial.
- **T3 - the clickable version.** The account-menu version row becomes an
  anchor to `https://github.com/dtammam/filetube/releases/tag/v<version>`
  (new tab, rel=noopener). Bound in the existing injectAccountMenu jsdom
  tests (behavioral, not a source lock - the harness exists here).
- **T4 - the publisher.** `scripts/sync-github-releases.js` (pure helpers
  unit-tested; gh-shelling walked by the script): for every tag with a
  ledger entry and NO existing GitHub Release, `gh release create
  <tag> --verify-tag` with title + intent. Idempotent - safe to run any
  time. DEVIATION (recorded, gate W3): originally planned as a job inside
  docker-publish.yml; BUILT as the separate `release-notes.yml` workflow
  instead - a job in the shared workflow would have made every manual
  backfill dispatch spin the whole qualify/publish pipeline, and jobs
  without an `if` run on ALL of a workflow's triggers. Same triggers as
  planned: tag push (future releases publish themselves) AND
  `workflow_dispatch` (Dean's ONE manual click backfills all 294 - the
  only human step). Creating a release on an existing tag emits a
  `release` event, never `push`, so the sync can never re-trigger Docker.
- **T5 - the contract.** CLAUDE.md release ceremony gains the step
  (ledger entry in user language BEFORE the release commit; the checker
  enforces); RELEASING.md documents the mechanics + the dispatch
  backfill; the branch-hygiene docs-rider from memory (the CLAUDE.md
  "push all refs" line) rides along if still stale.

## Risks / disclosed

- The tone tripwire cannot judge quality - only block obvious jargon.
- GitHub Release CREATION is outward-facing publishing: it happens only
  in CI on Dean's explicit dispatch (backfill) or on a tag HE pulls the
  trigger on via the existing release ceremony - never from this box.
- Tag dates vs entry dates: entries carry the tag's creator date;
  same-day releases share dates (non-decreasing, not strictly).
- gh api rate limits: 294 creates in one dispatch is well under limits.

## Stop

Dean clicks "Run workflow" once (backfill), then pulls, opens the
account menu, clicks the version, lands on the release page for the
running build. Gate: slim (docs+data+small client+CI; nothing can lose
data). Release as v1.144.0.
