'use strict';

// [UNIT] v1.129 Wave C (C2) - the docs LINK census, checker-first.
//
// The v1.125 docs reset moved plans between exec-plans/ subdirs and left at
// least one dangling relative link behind (CONTRIBUTING.md -> the shimmer
// audit's old active/ path; external review round 2). A moved doc's inbound
// links are exactly the thing a hand-aimed sweep misses, so: every RELATIVE
// markdown link in the repo's documentation set must resolve to a real file.
// External links (http/https/mailto), pure anchors (#...), and code spans are
// out of scope.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');

// The documentation set: every .md under docs/ (recursively) + the root docs.
function docFiles() {
  const out = [path.join(REPO, 'README.md'), path.join(REPO, 'CLAUDE.md'), path.join(REPO, 'ROADMAP.md')];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.md')) out.push(full);
    }
  };
  walk(path.join(REPO, 'docs'));
  return out.filter((f) => fs.existsSync(f));
}

// Markdown links + images: [text](target) / ![alt](target). Skips external
// schemes and pure anchors; strips a #fragment before resolving.
// DELIBERATE SCOPE (gate S2): reference-style definitions (`[ref]: path`) and
// autolinks (`<path>`) are NOT scanned - the corpus contains zero today; if
// one is ever introduced and rots, extend this regex rather than assuming
// coverage.
const LINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

// Code spans/fences are NOT links: regexes like `[a-z]*(x)` written in
// markdown match the LINK shape (a first-run false positive of this very
// checker). Strip fenced blocks and inline code before scanning.
function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

test('every relative doc link resolves to a real file (the moved-doc dangling-link class)', () => {
  const broken = [];
  for (const file of docFiles()) {
    const text = stripCode(fs.readFileSync(file, 'utf8'));
    const rel = path.relative(REPO, file);
    for (const m of text.matchAll(LINK)) {
      const target = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, https:, mailto:, data: ...
      if (target.startsWith('#')) continue; // in-page anchor
      const clean = target.split('#')[0];
      if (clean === '') continue;
      const fromFile = path.resolve(path.dirname(file), decodeURIComponent(clean));
      // Historical plans link source as REPO-ROOT-relative paths
      // (server.js#L123). The census's purpose is catching targets that exist
      // NOWHERE (a moved/deleted doc), not GitHub-rendering pedantry - so a
      // target that resolves from the repo root also passes.
      const fromRoot = path.resolve(REPO, decodeURIComponent(clean));
      if (!fs.existsSync(fromFile) && !fs.existsSync(fromRoot)) broken.push(`${rel} -> ${target}`);
    }
  }
  assert.deepStrictEqual(broken, [],
    `dangling relative doc link(s) - the target moved or never existed; fix the link\n`
    + `(or the census, if the target is legitimately generated at runtime):\n  ${broken.join('\n  ')}`);
});

// The CONTRIBUTING shimmer-audit reference (the review's find) was NOT a
// markdown link - it was a path in backticks, invisible to the link scan
// above. Backtick doc-paths rot exactly the same way, so: any code-span path
// that POINTS INTO docs/ and ends .md must exist from the repo root. Scoped
// to `docs/...md` deliberately - illustrative paths (/media/videos, DATA_DIR
// shapes) and source refs stay out of scope.
test('every backtick `docs/*.md` path reference in a LIVING doc resolves (the moved-doc stale-reference class)', () => {
  const broken = [];
  for (const file of docFiles()) {
    const rel = path.relative(REPO, file);
    // FROZEN history is out of scope - references there were correct when
    // written and rot as later waves move things; editing them retroactively
    // is churn, not truth. That set: completed/archived plans, the handoff
    // archive, the legacy-pipeline archive doc, and ROADMAP.md (its Shipped
    // section is release narrative that legitimately names since-deleted
    // files, e.g. "docs/AGENTS.md deleted per Dean's ruling"). Living docs
    // (the reference set a reader follows TODAY) must not dangle.
    if (/^docs\/exec-plans\/(completed|archive)\//.test(rel)) continue;
    if (/^docs\/references\/(handoffs-archive\/|legacy-agent-pipeline\.md)/.test(rel)) continue;
    if (rel === 'ROADMAP.md') continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/`(docs\/[^`\s]+\.md)(?:#[^`]*)?`/g)) {
      if (m[1].includes('<')) continue; // template placeholder (docs/exec-plans/active/<name>.md)
      if (!fs.existsSync(path.resolve(REPO, m[1]))) broken.push(`${rel} -> ${m[1]}`);
    }
  }
  assert.deepStrictEqual(broken, [],
    `stale backtick docs-path reference(s) in a LIVING doc - the doc moved; update the reference:\n  ${broken.join('\n  ')}`);
});
