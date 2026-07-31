'use strict';
/*
 * Image-quiescence gate (2026-07-31, determinism fix).
 *
 * The determinism gate failed 34/89: `waitUntil:'networkidle'` fires
 * BEFORE lazy images ever start fetching (loading="lazy" defers the
 * request until the viewport check), so whether an avatar/thumbnail/
 * cover has painted by screenshot time was a coin flip between runs.
 *
 * The fix: after the scene's actions settle, (1) flip every
 * loading="lazy" image to eager - per the HTML spec this starts the
 * fetch immediately, no scrolling required (scrolling would be WRONG
 * here: it trips scroll-driven state like the music drill's collapse
 * observer and would change the very scene being photographed); then
 * (2) await load/decode of every image in the document, bounded. The
 * bound means a genuinely broken image cannot hang the run - but a
 * timeout is REPORTED (run-record imageWaitPending) because undecoded
 * images are exactly the nondeterminism this gate exists to kill.
 */

async function settlePageImages(page, timeoutMs = 8000) {
  // Up to three passes: an SPA render can INSERT images while a pass is
  // settling (the field failures were exactly post-networkidle
  // insertions racing the screenshot), so we repeat until the image
  // count is stable and nothing is pending.
  let last = { total: -1, pending: -1, outcome: 'none' };
  for (let pass = 0; pass < 3; pass++) {
    const result = await page.evaluate(async (budget) => {
      for (const img of document.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';

      const imgs = Array.from(document.images);
      const settle = Promise.all(imgs.map((img) => {
        // complete==true covers BOTH loaded and already-ERRORED images; an
        // errored one has naturalWidth 0 and its load/error events already
        // fired, so waiting on them hangs a full budget per pass (gate
        // W1: one 404 avatar cost 24s per scene and cried nondeterminism
        // about a stably-broken, perfectly deterministic image).
        if (img.complete) return img.naturalWidth > 0 ? img.decode().catch(() => {}) : Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener('load', () => img.decode().catch(() => {}).then(resolve), { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
      })).then(() => 'settled');
      const outcome = await Promise.race([settle, new Promise((r) => setTimeout(() => r('timeout'), budget))]);
      if (document.fonts && document.fonts.ready) await document.fonts.ready.catch?.(() => {});
      const now = Array.from(document.images);
      // pending = still IN FLIGHT only: a settled-broken image paints
      // identically every run and must neither block stability nor alarm.
      return { total: now.length, pending: now.filter((i) => !i.complete).length, outcome };
    }, timeoutMs);
    const stable = result.total === last.total && result.pending === 0;
    last = result;
    if (stable) break;
  }
  return last;
}

// P1 determinism masking - shared so the regression test binds the exact
// CSS the driver injects. visibility:hidden preserves the layout box.
// #added-date-text: the watch page's third formatRelativeTime consumer
// (gate W3) - minute/hour granularity glyphs on scenes 01/01b/05/22.
const VOLATILE_MASK_CSS = '.sub-list-header-status,.notif-row-time,#added-date-text{visibility:hidden!important}';

module.exports = { settlePageImages, VOLATILE_MASK_CSS };
