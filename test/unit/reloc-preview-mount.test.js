'use strict';

// [UNIT] v1.41.8 bug-fix LOCK -- the DRY-RUN relocation preview modal MOUNT +
// STYLE location. v1.41.7 shipped the modal as a shell-level sibling (outside
// #view-root) with its styles in subscriptions.html's page-local <head>
// <style>. The SPA router (public/js/common.js extractViewFragment) swaps ONLY
// the #view-root subtree on in-app navigation, so on a nav-link click NEITHER
// the modal markup nor its styles came along: getElementById('reloc-preview-
// backdrop') was null and "Preview changes" silently no-opped (it worked only
// on a HARD load of /subscriptions.html). This test LOCKS both halves of the
// fix so the bug class (tech-debt #34 / the SPA-router lesson) cannot recur:
//   (1) the modal + its required IDs are DESCENDANTS of #view-root, so an
//       in-app swap mounts them (exactly what extractViewFragment returns);
//   (2) the .reloc-preview-* rules live in public/css/style.css (survives the
//       swap) and are NOT left behind in subscriptions.html's <style>.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { triggerReheatPreview } = require('../../lib/ytdlp/client/subscriptions.js');

const ROOT = path.join(__dirname, '../..');
const SUBS_HTML_PATH = path.join(ROOT, 'lib', 'ytdlp', 'views', 'subscriptions.html');
const STYLE_CSS_PATH = path.join(ROOT, 'public', 'css', 'style.css');

const subsHtml = fs.readFileSync(SUBS_HTML_PATH, 'utf8');
const styleCss = fs.readFileSync(STYLE_CSS_PATH, 'utf8');

// The four element IDs the preview handler resolves from the DOM
// (subscriptions.js's reheatPreviewElements) -- all must be reachable AFTER an
// in-app swap, i.e. from within the #view-root fragment.
const REQUIRED_IDS = [
  'reloc-preview-backdrop',
  'reloc-preview-summary',
  'reloc-preview-body',
  'reloc-preview-close',
];

// Parse the shell WITHOUT running scripts / fetching sub-resources (default
// JSDOM) -- we only want the static structure.
function parseSubs() {
  return new JSDOM(subsHtml).window.document;
}

test('the preview modal + its required IDs are descendants of #view-root (so an in-app SPA swap mounts them)', () => {
  const doc = parseSubs();
  // extractViewFragment(html) does exactly `doc.getElementById('view-root')`
  // and returns ONLY that subtree; mirror it here.
  const viewRoot = doc.getElementById('view-root');
  assert.ok(viewRoot, '#view-root must exist');

  for (const id of REQUIRED_IDS) {
    const withinFragment = viewRoot.querySelector('#' + id);
    assert.ok(
      withinFragment,
      `#${id} must be INSIDE #view-root so the SPA fragment swap mounts it (was a shell-level sibling in v1.41.7 -> null on nav)`
    );
    // Belt: it is not ALSO duplicated somewhere outside the fragment.
    assert.equal(
      doc.getElementById(id),
      withinFragment,
      `#${id} must be the single copy that lives inside #view-root`
    );
  }
});

test('the .reloc-preview-* styles live in public/css/style.css (survive the #view-root swap)', () => {
  // The load-bearing rules (backdrop overlay + its hidden state + the panel and
  // the copy-warning that is the whole point of the preview).
  assert.match(styleCss, /\.reloc-preview-backdrop\s*\{/, 'backdrop rule must be in style.css');
  assert.match(styleCss, /\.reloc-preview-backdrop\[hidden\]\s*\{/, 'the [hidden] display:none rule must be in style.css');
  assert.match(styleCss, /\.reloc-preview-panel\s*\{/, 'panel rule must be in style.css');
  assert.match(styleCss, /\.reloc-preview-summary\s+\.reloc-copy-warning\s*\{/, 'copy-warning rule must be in style.css');
  assert.match(styleCss, /\.reloc-preview-badge\.reloc-badge-copy\s*\{/, 'copy badge rule must be in style.css');
});

test('the .reloc-preview-* styles are NOT left behind in subscriptions.html <style> (page-local styles are lost on an in-app swap)', () => {
  const styleMatch = subsHtml.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(styleMatch, 'subscriptions.html still has a <style> block');
  const pageLocalCss = styleMatch[1];
  // Match an actual RULE (a `.reloc-preview-*` selector opening a `{` block) --
  // a passing-mention in the explanatory comment left behind is fine and
  // expected (it points readers at style.css), but a real declaration is not.
  assert.doesNotMatch(
    pageLocalCss,
    /\.reloc-preview-[\w-]*(\[[^\]]*\])?\s*(,[^{]*)?\{/,
    'no .reloc-preview-* RULE may remain in the page-local <style> -- it would be lost on an in-app swap'
  );
});

test('driving triggerReheatPreview against the #view-root fragment shows the modal (backdrop.hidden -> false)', async () => {
  // Prove the fix end-to-end at the mount point: resolve the handler's element
  // refs the SAME way subscriptions.js does, but scoped to the fragment
  // extractViewFragment returns -- if the modal were still outside #view-root
  // these would be null and the open would no-op (the v1.41.7 bug).
  const doc = parseSubs();
  const viewRoot = doc.getElementById('view-root');

  const elements = {
    button: viewRoot.querySelector('#sub-reheat-preview-btn'),
    backdrop: viewRoot.querySelector('#reloc-preview-backdrop'),
    summary: viewRoot.querySelector('#reloc-preview-summary'),
    body: viewRoot.querySelector('#reloc-preview-body'),
    status: viewRoot.querySelector('#sub-reheat-status'),
    doc,
  };
  for (const [name, el] of Object.entries(elements)) {
    if (name === 'doc') continue;
    assert.ok(el, `#${name} ref must resolve from within the #view-root fragment`);
  }
  assert.equal(elements.backdrop.hidden, true, 'the modal starts hidden');

  const payload = {
    summary: { hardlinkCount: 1, copyCount: 0, metadataOnlyCount: 0, untouchedCount: 0, wouldHydrateCount: 0 },
    moves: [{ mediaId: 'm', title: 'T', currentPath: '/a', destinationPath: '/b', transfer: 'hardlink', category: 'move-hardlink', metadataEffect: 'up-to-date', sizeBytes: 1 }],
    skips: [],
  };
  const fakeFetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });

  triggerReheatPreview(elements, fakeFetch);
  await new Promise((r) => setImmediate(r));

  assert.equal(elements.backdrop.hidden, false, 'the modal must become visible after a successful preview when mounted inside #view-root');
});
