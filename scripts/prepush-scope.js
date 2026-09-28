#!/usr/bin/env node
'use strict';
// Pre-push scope (Dean, 2026-09-28: the full ~7 min suite ran on EVERY push, branch deletes and
// docs-only pushes included). hooks/pre-push pipes git's push lines here:
//   <local ref> <local sha> <remote ref> <remote sha>
// Exit 0 = SKIP the checks (every ref is a delete, or its commits touch only docs), exit 1 = run
// them. Anything unclear (no lines, a sha git cannot diff, a malformed line) runs them.
const { execFileSync } = require('node:child_process');

const ZERO = /^0+$/;
// The paths a docs-only push may touch: the same set the visual workflow's paths-ignore skips.
function isDocsPath(f) { return /\.md$/i.test(f) || f.startsWith('docs/'); }

// lines: git's push lines; changedFiles(localSha, remoteSha) -> [paths] | null (null = unknown).
// Returns { skip, why }.
function classify(lines, changedFiles) {
  const refs = lines.map((l) => l.trim()).filter(Boolean);
  if (refs.length === 0) return { skip: false, why: 'no push lines (run by hand?)' };
  for (const line of refs) {
    const parts = line.split(/\s+/);
    if (parts.length !== 4) return { skip: false, why: `unreadable push line: ${line}` };
    const [, localSha, , remoteSha] = parts;
    if (ZERO.test(localSha)) continue; // a branch delete ships no code
    const files = changedFiles(localSha, remoteSha);
    if (!files) return { skip: false, why: `cannot tell what ${localSha.slice(0, 8)} changes` };
    const code = files.filter((f) => !isDocsPath(f));
    if (files.length === 0 || code.length) return { skip: false, why: code.length ? `code changes (${code[0]}${code.length > 1 ? ' +' + (code.length - 1) : ''})` : 'no changed files' };
  }
  return { skip: true, why: 'only branch deletes and docs-only commits' };
}

function gitChangedFiles(localSha, remoteSha) {
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    let base;
    if (!ZERO.test(remoteSha)) {
      git('cat-file', '-e', `${remoteSha}^{commit}`); // throws when we do not have it: unknown
      base = remoteSha;
    } else {
      // A new branch: everything it adds over main.
      const main = (() => { try { return git('rev-parse', '--verify', '-q', 'origin/main'); } catch (_) { return ''; } })();
      if (!main) return null;
      base = git('merge-base', localSha, main);
    }
    const out = git('diff', '--name-only', `${base}..${localSha}`);
    return out ? out.split('\n') : [];
  } catch (_) {
    return null;
  }
}

if (require.main === module) {
  const input = require('node:fs').readFileSync(0, 'utf8');
  const r = classify(input.split('\n'), gitChangedFiles);
  console.log(r.skip ? `→ skipping the pre-push checks: ${r.why}` : `→ pre-push scope: full checks (${r.why})`);
  process.exit(r.skip ? 0 : 1);
}

module.exports = { classify, isDocsPath };
