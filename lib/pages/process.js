'use strict';

// lib/pages/process.js - the CPU-heavy half of a capture (tidy, the vendored Readability, both
// sanitize passes) in a worker thread with a deadline, never on the server's event loop. Gate r1
// (adversary A2) measured a 1.2 MB hostile page holding Readability for 39.6 s on the main thread,
// stalling every other request; JSDOMParser + Readability are synchronous and we keep the vendored
// files unmodified, so the only safe place for them is off the main thread.
//
// Two phases, each posted as soon as it is done:
//   1. 'original': the tidied page, its metadata (title, author, dates...), the sanitized Original
//      and its plain text - everything an Original-only item needs;
//   2. 'reader':   Readability's article, sanitized for the Reader, and its text.
// At the deadline the worker is terminated: phase 2 missing = the item is saved Original-only
// ("Reader view unavailable", the plan's extraction-failed rule); phase 1 missing = nothing is
// written and the save answers an error (the user still has the link).

const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DEADLINE_MS = 20000;
const WORKER_HEAP_MB = 1024;

function processPage(html, pageUrl, post) {
  const tidy = require('./tidy');
  const { extractArticle, readMetadata, mergeMetadata, treeToText } = require('./extract');
  const { sanitize, readerFragment, originalDocument } = require('./sanitize');
  const tree = tidy.ensureDocument(tidy.parse(html));
  const pageMeta = readMetadata(tree, pageUrl);
  const originalClean = sanitize(tree, { profile: 'original', base: pageUrl });
  post({
    phase: 'original',
    metadata: mergeMetadata(pageMeta, null, pageUrl),
    original: originalDocument(originalClean.tree),
    originalText: treeToText(originalClean.tree),
  });
  const { article, error } = extractArticle(tree, pageUrl);
  if (!article) { post({ phase: 'reader', reader: null, error }); return; }
  const readerClean = sanitize(article.tree, { profile: 'reader', base: pageUrl });
  post({
    phase: 'reader',
    metadata: mergeMetadata(pageMeta, article, pageUrl),
    reader: readerFragment(readerClean.tree),
    text: article.text,
    error: null,
  });
}

if (!isMainThread && workerData && workerData.__pagesProcess) {
  try {
    processPage(workerData.html, workerData.pageUrl, (m) => parentPort.postMessage(m));
  } catch (err) {
    parentPort.postMessage({ phase: 'error', error: err && err.message ? err.message : String(err) });
  }
}

// Resolves { original: {metadata, original, originalText} | null, reader: {...} | null, error }.
// Never rejects.
function processInWorker(html, pageUrl, { deadlineMs = DEADLINE_MS } = {}) {
  return new Promise((resolve) => {
    const got = { original: null, reader: null, error: null };
    let settled = false;
    let worker;
    const done = (why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (why && !got.error) got.error = why;
      if (worker) worker.terminate().catch(() => {});
      resolve(got);
    };
    try {
      worker = new Worker(path.join(__dirname, 'process.js'), {
        workerData: { __pagesProcess: true, html, pageUrl },
        resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB },
      });
    } catch (err) {
      resolve({ original: null, reader: null, error: 'could not start the page processor: ' + (err && err.message) });
      return;
    }
    const timer = setTimeout(() => done('the page took too long to process'), deadlineMs);
    if (timer.unref) timer.unref();
    worker.on('message', (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.phase === 'original') got.original = m;
      else if (m.phase === 'reader') { got.reader = m.reader ? m : null; if (m.error) got.error = m.error; done(null); }
      else if (m.phase === 'error') done(m.error);
    });
    worker.on('error', (err) => done(err && err.message ? err.message : 'the page processor failed'));
    worker.on('exit', () => done(got.reader ? null : 'the page processor stopped'));
  });
}

module.exports = { processInWorker, processPage, DEADLINE_MS };
