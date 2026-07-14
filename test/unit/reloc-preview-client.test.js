'use strict';

// [UNIT] v1.41.7 (Dean has NO media backup) -- the DRY-RUN relocation preview
// CLIENT: pure formatters + createElement/textContent-only modal builders + the
// fetch-only trigger. Verifies the plain-language TAXONOMY summary (Dean's "what
// would be touched, and in what way"), the cross-filesystem COPY warning that is
// the whole point, the metadata-effect wording (never overstated), XSS
// discipline (untrusted paths/titles rendered via textContent, never innerHTML),
// and that the trigger opens the modal after a successful fetch.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  formatBytes,
  formatRelocationReason,
  formatMetadataEffect,
  formatRelocationRowEffect,
  summarizeRelocationPreview,
  renderRelocationPreview,
  triggerReheatPreview,
  closeRelocationPreview,
} = require('../../lib/ytdlp/client/subscriptions.js');

// A minimal fake DOM mirroring ytdlp-subscriptions-client.test.js's harness --
// `innerHTML` is a hard failure so an accidental markup injection is caught.
class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.className = '';
    this._text = '';
    this.hidden = false;
    this.disabled = false;
    this._listeners = {};
  }
  appendChild(child) { this.children.push(child); if (child instanceof FakeElement) child.parentNode = this; return child; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  get textContent() { return this._text; }
  set textContent(v) { this._text = v; this.children = []; }
  set innerHTML(_v) { throw new Error('preview must never assign innerHTML -- use textContent'); }
  get innerHTML() { throw new Error('preview must never read innerHTML'); }
  *walk() { yield this; for (const c of this.children) if (c instanceof FakeElement) yield* c.walk(); }
  collectText() { let s = this._text; for (const c of this.children) if (c instanceof FakeElement) s += ' ' + c.collectText(); return s; }
}
const fakeDoc = { createElement: (t) => new FakeElement(t) };

// ---- formatBytes -----------------------------------------------------------

test('formatBytes renders binary units and clamps garbage to 0 B', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(3.5 * 1024 * 1024 * 1024), '3.5 GB');
  assert.equal(formatBytes(-5), '0 B');
  assert.equal(formatBytes(NaN), '0 B');
  assert.equal(formatBytes('nope'), '0 B');
});

// ---- formatRelocationReason / formatMetadataEffect -------------------------

test('formatRelocationReason maps known reasons and passes unknown ones through', () => {
  assert.match(formatRelocationReason('would-hydrate-first'), /hydrate first/i);
  assert.match(formatRelocationReason('destination-occupied'), /already exists/i);
  assert.equal(formatRelocationReason('some-future-reason'), 'some-future-reason');
  assert.equal(formatRelocationReason(undefined), 'skipped');
});

test('formatMetadataEffect never overstates -- "may be refreshed" unless already up to date', () => {
  assert.match(formatMetadataEffect('up-to-date'), /already up to date/i);
  assert.match(formatMetadataEffect('may-refresh'), /may be refreshed/i);
  assert.match(formatMetadataEffect(undefined), /may be refreshed/i); // never asserts a change
});

// ---- formatRelocationRowEffect (the per-row "in what way") -----------------

test('formatRelocationRowEffect states the FULL effect (file + metadata) per category', () => {
  assert.match(formatRelocationRowEffect({ category: 'move-hardlink', metadataEffect: 'up-to-date' }), /Hard-link.*no data copied.*already up to date/i);
  assert.match(formatRelocationRowEffect({ category: 'move-copy', sizeBytes: 1024 * 1024 * 1024, metadataEffect: 'may-refresh' }), /COPY across filesystems \(1\.0 GB\).*deleted after a checksum match/i);
  assert.match(formatRelocationRowEffect({ category: 'metadata-only', reason: 'already-in-download-root', metadataEffect: 'may-refresh' }), /Stays where it is.*file not moved.*may be refreshed/i);
  assert.match(formatRelocationRowEffect({ category: 'would-hydrate-first' }), /hydrated first.*destination unknown/i);
  // HONESTY 1a/1c: untouched includes the metadata caveat, conditional on the effect.
  assert.match(formatRelocationRowEffect({ category: 'untouched', reason: 'no-youtube-identity', metadataEffect: 'may-refresh' }), /Not touched.*metadata may be refreshed/i);
  assert.match(formatRelocationRowEffect({ category: 'untouched', reason: 'no-youtube-identity', metadataEffect: 'up-to-date' }), /Not touched.*already up to date/i);
  assert.doesNotMatch(formatRelocationRowEffect({ category: 'untouched', reason: 'no-youtube-identity', metadataEffect: 'up-to-date' }), /may be refreshed/i);
});

// ---- summarizeRelocationPreview (plain-language taxonomy) -------------------

test('summarize builds the taxonomy lines and flags the cross-filesystem COPY line', () => {
  const { lines, hasCrossFsCopy } = summarizeRelocationPreview({
    summary: {
      hardlinkCount: 3, copyCount: 1, unknownCount: 0, copyBytes: 2.4 * 1024 * 1024 * 1024,
      metadataOnlyCount: 12, wouldHydrateCount: 2, untouchedCount: 40, untouchedMayRefreshCount: 0,
    },
  });
  assert.equal(hasCrossFsCopy, true);
  const joined = lines.map((l) => l.text).join('\n');
  assert.match(joined, /3 files would be hard-linked into channel folders \(no data copied\)\./);
  assert.match(joined, /1 file would be COPIED across filesystems \(2\.4 GB\) and the original deleted after a checksum match\./);
  assert.match(joined, /12 items would stay where they are \(channel info may be refreshed; file not moved\)\./);
  assert.match(joined, /2 items would be hydrated first — destination unknown until then\./);
  assert.match(joined, /40 items will not be touched\./);
  // The COPY line is the one marked for highlighting.
  const copyLine = lines.find((l) => l.kind === 'copy');
  assert.ok(copyLine && /COPIED across filesystems/.test(copyLine.text));
});

test('summarize splits the untouched count honestly: never-reheated items disclose the local tag check (HONESTY 1b)', () => {
  const { lines } = summarizeRelocationPreview({
    summary: { untouchedCount: 10, untouchedMayRefreshCount: 4 },
  });
  const joined = lines.map((l) => l.text).join('\n');
  assert.match(joined, /4 items would not be moved — a reheat re-checks their file tags, but nothing here points to YouTube\./);
  assert.match(joined, /6 items will not be touched\./);
});

test('summarize with only hard links sets no copy warning', () => {
  const { lines, hasCrossFsCopy } = summarizeRelocationPreview({ summary: { hardlinkCount: 2, copyCount: 0, untouchedCount: 1, untouchedMayRefreshCount: 0 } });
  assert.equal(hasCrossFsCopy, false);
  assert.ok(!lines.some((l) => l.kind === 'copy'));
  assert.match(lines.map((l) => l.text).join('\n'), /2 files would be hard-linked/);
});

test('summarize with nothing to do says so', () => {
  const { lines } = summarizeRelocationPreview({ summary: {} });
  assert.match(lines[0].text, /Nothing to do/);
});

// ---- renderRelocationPreview (grouped, createElement/textContent only) -----

test('render groups by category, shows a COPY badge + warning, and renders untrusted titles as inert text (never innerHTML)', () => {
  const summaryEl = new FakeElement('div');
  const bodyEl = new FakeElement('div');
  const preview = {
    summary: { hardlinkCount: 0, copyCount: 1, copyBytes: 1024 * 1024 * 1024, metadataOnlyCount: 1, untouchedCount: 0, wouldHydrateCount: 0 },
    moves: [{
      mediaId: 'm1',
      title: 'A Video <script>alert(1)</script>',
      currentPath: '/nas/lib/A Video.mp4',
      destinationPath: '/dl/Rick Astley/A Video [dQw4w9WgXcQ].mp4',
      transfer: 'copy',
      category: 'move-copy',
      metadataEffect: 'up-to-date',
      sizeBytes: 1024 * 1024 * 1024,
    }],
    skips: [{ mediaId: 's1', title: 'Native Download', currentPath: '/dl/chan/x.mp4', reason: 'already-in-download-root', category: 'metadata-only', metadataEffect: 'may-refresh' }],
  };

  renderRelocationPreview(fakeDoc, summaryEl, bodyEl, preview);

  assert.match(summaryEl.collectText(), /1 file would be COPIED across filesystems/);
  assert.ok(summaryEl.children.some((c) => c.className === 'reloc-copy-warning'), 'the cross-fs COPY warning must be shown');
  // HONESTY 2: the best-effort-prediction + checksum-safety disclosure must be present.
  assert.ok(summaryEl.children.some((c) => c.className === 'reloc-preview-note'), 'the best-effort/checksum disclosure note must be shown');
  assert.match(summaryEl.collectText(), /best-effort prediction/i);
  assert.match(summaryEl.collectText(), /safe regardless of how a row is classified/i);
  assert.match(summaryEl.collectText(), /non-force/i);

  const bodyText = bodyEl.collectText();
  assert.match(bodyText, /Move — COPY across filesystems.*\(1\)/);
  assert.match(bodyText, /Metadata only — file stays put \(1\)/);
  // The untrusted title survives verbatim as inert TEXT (never parsed as markup).
  assert.match(bodyText, /A Video <script>alert\(1\)<\/script>/);
  assert.match(bodyText, /COPY across filesystems \(1\.0 GB\)/);
  assert.match(bodyText, /\/dl\/Rick Astley\/A Video \[dQw4w9WgXcQ\]\.mp4/);
  assert.match(bodyText, /Stays where it is/);
  // No node anywhere is an actual <script> element (the title was inert text).
  for (const node of bodyEl.walk()) assert.notEqual(node.tagName, 'SCRIPT');
});

test('render shows a hard-link category with NO warning when nothing is copied', () => {
  const summaryEl = new FakeElement('div');
  const bodyEl = new FakeElement('div');
  renderRelocationPreview(fakeDoc, summaryEl, bodyEl, {
    summary: { hardlinkCount: 1, copyCount: 0, metadataOnlyCount: 0, untouchedCount: 0, wouldHydrateCount: 0 },
    moves: [{ mediaId: 'm', title: 'T', currentPath: '/a', destinationPath: '/b', transfer: 'hardlink', category: 'move-hardlink', metadataEffect: 'up-to-date', sizeBytes: 10 }],
    skips: [],
  });
  assert.ok(!summaryEl.children.some((c) => c.className === 'reloc-copy-warning'), 'no copy warning when nothing is copied');
  assert.match(bodyEl.collectText(), /Move — hard link \(no data copied\)/);
  assert.match(bodyEl.collectText(), /Hard-link into the channel folder/);
});

// ---- triggerReheatPreview / closeRelocationPreview -------------------------

test('triggerReheatPreview fetches the preview, renders it, and opens the modal', async () => {
  const button = new FakeElement('button');
  const backdrop = new FakeElement('div'); backdrop.hidden = true;
  const summary = new FakeElement('div');
  const body = new FakeElement('div');
  const status = new FakeElement('span');
  const payload = {
    summary: { hardlinkCount: 1, copyCount: 0, metadataOnlyCount: 0, untouchedCount: 0, wouldHydrateCount: 0 },
    moves: [{ mediaId: 'm', title: 'T', currentPath: '/a', destinationPath: '/b', transfer: 'hardlink', category: 'move-hardlink', metadataEffect: 'up-to-date', sizeBytes: 1 }],
    skips: [],
  };
  let requestedUrl = null;
  let requestedMethod = null;
  const fakeFetch = (url, opts) => {
    requestedUrl = url; requestedMethod = opts && opts.method;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });
  };

  triggerReheatPreview({ button, backdrop, summary, body, status, doc: fakeDoc }, fakeFetch);
  await new Promise((r) => setImmediate(r));

  assert.equal(requestedUrl, '/api/ytdlp/repull-metadata/preview');
  assert.equal(requestedMethod, 'POST');
  assert.equal(backdrop.hidden, false, 'the modal must be shown after a successful preview');
  assert.equal(button.disabled, false, 'the button must be re-enabled');
  assert.match(body.collectText(), /Move — hard link/);
});

test('triggerReheatPreview on a failed response shows an error and does NOT open the modal', async () => {
  const button = new FakeElement('button');
  const backdrop = new FakeElement('div'); backdrop.hidden = true;
  const summary = new FakeElement('div');
  const body = new FakeElement('div');
  const status = new FakeElement('span');
  const fakeFetch = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'boom' }) });

  triggerReheatPreview({ button, backdrop, summary, body, status, doc: fakeDoc }, fakeFetch);
  await new Promise((r) => setImmediate(r));

  assert.equal(backdrop.hidden, true, 'the modal must stay closed on a failed preview');
  assert.match(status.textContent, /Could not compute the preview/);
});

test('closeRelocationPreview hides the backdrop', () => {
  const backdrop = new FakeElement('div'); backdrop.hidden = false;
  closeRelocationPreview({ backdrop });
  assert.equal(backdrop.hidden, true);
});
