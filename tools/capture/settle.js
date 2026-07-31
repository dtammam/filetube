'use strict';
/*
 * Image-quiescence gate (2026-07-31; rebuilt after field gate round 2).
 *
 * Round 1 (34/89): networkidle fires before SPA renders insert their
 * images and before lazy fetches begin - paint state raced the shot.
 * Round 2 (32/89) exposed the deeper shape: a FIXED PASS CAP cannot
 * outlast an async render. The sidebar/channel-avatar list renders from
 * a fetch that resolves AFTER a capped loop exits clean - both field
 * run-records had imageWaitPending EMPTY while avatars visibly raced the
 * shot, meaning every check (final recount included) ran in a window
 * where those <img> nodes did not exist yet.
 *
 * So the gate now CONVERGES instead of counting passes: it requires TWO
 * consecutive observations, `quietMs` apart, in which (a) the IDENTITY
 * SET of document.images (the src list) is unchanged and (b) every one
 * is settled (complete; decoded when it loaded). A late render resets
 * convergence and extends the loop. Bounded by `budgetMs` overall; a
 * budget exit is REPORTED (stable:false -> run-record imageWaitPending),
 * never silent.
 *
 * Still deliberate: the lazy->eager flip happens on EVERY observation
 * (late-rendered imgs arrive lazy too), and there is NO scrolling -
 * scroll trips scroll-driven state (the music drill collapse observer)
 * and would change the scene being photographed. Errored images are
 * settled (counted in `errored`, never blocking): a stably-broken image
 * paints identically every run; an image erroring in one run and
 * loading in the next is SERVER nondeterminism, made diagnosable by the
 * count.
 */

async function settlePageImages(page, budgetMs = 15000, quietMs = 450) {
  const deadline = Date.now() + budgetMs;
  let prevKey = null;
  let quietSince = 0;
  let last = { total: 0, pending: 0, fontsPending: 0, errored: 0 };
  let observations = 0;
  for (;;) {
    const raceMs = Math.min(4000, Math.max(100, deadline - Date.now()));
    const obs = await page.evaluate(async (imgRaceMs) => {
      for (const img of document.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
      // Fonts are the eager-flip's sibling (field gate 3, the 17b/17c
      // residual that survived three gates): a font face loads lazily on
      // first USE, and the icon-font consumers (reorder chevrons, header
      // and nav glyphs) render from async fetches WITH NO IMAGES - so
      // image-set convergence completes and fonts.ready, sampled before
      // the trigger, is vacuously resolved. Force every declared face to
      // start loading NOW; quiescence below then waits for them.
      try { for (const f of document.fonts) { if (f.status === 'unloaded') f.load().catch(() => {}); } } catch { /* FontFaceSet iteration unavailable - nothing to force */ }
      const imgs = Array.from(document.images);
      await Promise.all(imgs.map((img) => {
        // complete==true covers loaded AND already-errored (naturalWidth
        // 0) - an errored image's events already fired; waiting on them
        // burned 24s/scene in an earlier round.
        if (img.complete) return img.naturalWidth > 0 ? img.decode().catch(() => {}) : Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener('load', () => img.decode().catch(() => {}).then(() => resolve()), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        });
      }).map((p) => Promise.race([p, new Promise((r) => setTimeout(r, imgRaceMs))])));
      if (document.fonts && document.fonts.ready) await document.fonts.ready.catch?.(() => {});
      const now = Array.from(document.images);
      let fontsPending = 0;
      let fontsKey = '';
      try {
        const faces = Array.from(document.fonts);
        fontsPending = faces.filter((f) => f.status === 'loading').length;
        // Face-set size joins the identity key: a stylesheet arriving late
        // (new @font-face) must reset convergence like a new image does.
        fontsKey = `|fonts:${faces.length}`;
      } catch { /* no FontFaceSet - fonts cannot pend */ }
      return {
        key: now.map((i) => i.currentSrc || i.src).join('\n') + fontsKey,
        total: now.length,
        pending: now.filter((i) => !i.complete).length,
        fontsPending,
        errored: now.filter((i) => i.complete && i.naturalWidth === 0).length,
      };
    }, raceMs);
    observations++;
    last = { total: obs.total, pending: obs.pending, fontsPending: obs.fontsPending, errored: obs.errored };
    if (obs.pending === 0 && obs.fontsPending === 0 && obs.key === prevKey) {
      if (quietSince && Date.now() - quietSince >= quietMs) {
        return { ...last, stable: true, observations };
      }
      if (!quietSince) quietSince = Date.now();
    } else {
      quietSince = 0;
    }
    prevKey = obs.key;
    if (Date.now() >= deadline) return { ...last, stable: false, observations };
    await page.waitForTimeout(Math.min(quietMs, Math.max(50, deadline - Date.now())));
  }
}

// P1 determinism masking - shared so the regression test binds the exact
// CSS the driver injects. visibility:hidden preserves the layout box;
// #added-date-text is the watch page's third formatRelativeTime consumer
// (minute/hour-granularity glyphs on scenes 01/01b/05/22). The subs
// status line is ADDITIONALLY clamped to one line (nowrap + hidden
// overflow): field round 2 showed its text can WRAP to a different line
// count between runs (10.31% on 11-subs-top-2005 - a full reflow of
// every row below), and visibility:hidden preserves whatever geometry
// the text happens to have. One clamped line is deterministic in every
// era; the clamp normalizes a masked live region, not a token witness -
// documented in the README.
const VOLATILE_MASK_CSS =
  '.sub-list-header-status,.notif-row-time,#added-date-text{visibility:hidden!important}'
  + '.sub-list-header-status{white-space:nowrap!important;overflow:hidden!important}';

// Belt-and-braces scroll normalization (2026-07-31): probing showed
// headless Chromium already quantizes scroll to integer CSS pixels
// (fractional-scroll was the FIRST hypothesis for the 17b/17c residual
// and was DISPROVEN by measurement - the real cause was the icon-font
// load race above). The snap stays because it is one cheap evaluate,
// scrollIntoViewIfNeeded mid-smooth-glide and scroll anchoring on
// resize remain real variables on non-headless drivers, and the driver
// CSS freezes both (scroll-behavior:auto, overflow-anchor:none).
async function snapScroll(page) {
  await page.evaluate(() => {
    const x = Math.round(window.scrollX);
    const y = Math.round(window.scrollY);
    window.scrollTo({ left: x, top: y, behavior: 'instant' });
  });
}

module.exports = { settlePageImages, snapScroll, VOLATILE_MASK_CSS };
