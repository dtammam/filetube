'use strict';

// v1.144 (Dean): publish the release LEDGER (docs/releases.json - the
// user-language release notes) to GitHub Releases. Runs in CI (the runner
// ships the `gh` CLI + GITHUB_TOKEN) - never from a dev box.
//
// IDEMPOTENT by design: for every existing `vX.Y.Z` git tag that has a
// ledger entry and NO GitHub Release yet, create one (title + intent as the
// body). Tags with a release already are skipped untouched - re-running is
// always safe, so the SAME script serves both the one-time 294-release
// backfill (workflow_dispatch) and every future tag push. A tag with no
// ledger entry is reported and skipped (the release-ledger checker makes
// that impossible for new releases; it can only mean a hand-pushed tag).
//
// Pure decision helpers are exported for node:test; the gh-shelling walk
// lives in main() and is exercised end to end by the CI runs themselves.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** The release title as shown on GitHub: "vX.Y.Z - Title". */
function formatReleaseTitle(entry) {
  return `v${entry.version} - ${entry.title}`;
}

/** The release body: the user-language intent, plus a dated footer. */
function formatReleaseBody(entry) {
  return `${entry.intent}\n\n_Released ${entry.date}._\n`;
}

/**
 * The work list: every tag that has a ledger entry but no existing release.
 * Pure over its inputs (tag list, existing-release tag list, ledger array).
 * Returns { toCreate: [entry...], unledgered: [tag...] }.
 */
function planReleaseSync(tags, existingReleaseTags, ledger) {
  const byVersion = new Map(ledger.map((e) => [e.version, e]));
  const existing = new Set(existingReleaseTags);
  const toCreate = [];
  const unledgered = [];
  for (const tag of tags) {
    if (!/^v\d+\.\d+\.\d+$/.test(tag)) continue;
    if (existing.has(tag)) continue;
    const entry = byVersion.get(tag.slice(1));
    if (!entry) { unledgered.push(tag); continue; }
    toCreate.push(entry);
  }
  return { toCreate, unledgered };
}

function main() {
  const root = path.join(__dirname, '..');
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'releases.json'), 'utf8'));
  const tags = execFileSync('git', ['tag'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  // Paginated list of ALL existing releases' tag names via the gh API
  // (--paginate follows every page; 294+ releases exceed one page).
  const existingRaw = execFileSync('gh', [
    'api', '--paginate', 'repos/{owner}/{repo}/releases', '--jq', '.[].tag_name',
  ], { cwd: root, encoding: 'utf8' });
  const existing = existingRaw.split('\n').filter(Boolean);

  const { toCreate, unledgered } = planReleaseSync(tags, existing, ledger);
  for (const tag of unledgered) {
    console.log(`SKIP ${tag}: no ledger entry (hand-pushed tag?)`);
  }
  console.log(`${toCreate.length} release(s) to create; ${existing.length} already exist.`);
  let created = 0;
  let failed = 0;
  for (const entry of toCreate) {
    try {
      execFileSync('gh', [
        'release', 'create', `v${entry.version}`,
        '--verify-tag',
        '--title', formatReleaseTitle(entry),
        '--notes', formatReleaseBody(entry),
      ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      created += 1;
      console.log(`created v${entry.version}`);
    } catch (err) {
      // One bad tag never wedges the rest - report and continue.
      failed += 1;
      console.error(`FAILED v${entry.version}: ${err && err.message}`);
    }
  }
  console.log(`done: ${created} created, ${failed} failed, ${unledgered.length} unledgered.`);
  if (failed > 0) process.exitCode = 1;
}

module.exports = { formatReleaseTitle, formatReleaseBody, planReleaseSync };

if (require.main === module) main();
