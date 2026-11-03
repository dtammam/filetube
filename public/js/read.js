// FileTube Reader (v1.37.0 T9) — the /read.html?b=<id> view module.
// Two format adapters behind one small interface:
//   EPUB — vendored epub.js (+ JSZip, its runtime dep), paginated flow,
//          CFI locators, reader themes/font-size via epub.js themes.
//   PDF  — vendored pdf.js (ESM, dynamic import), scrollable page column,
//          page locators, one-shot page-1 cover backfill.
// Vendor libs load lazily HERE, per format — no other page fetches a byte
// of them. Progress pings go to POST /api/books/:id/progress (the
// books-owned coalescer) on a debounce, with a keepalive flush on
// pagehide/hide (the background-lifecycle lesson).

// ---- Pure/shared contract pieces (node:test-covered) ------------------------

// THE block-level element rule (exec plan §3): blockIndex = index of the
// reading position's containing element among the chapter document's
// block-level elements in document order. This selector IS the contract —
// the wave-2 server-side TTS chunker must implement the SAME rule against
// the same chapter XHTML so "Listen from Here" lands on the same paragraph.
// Source-locked by test; change it only in lockstep with the (future)
// server chunker's ttsRev bump.
const READER_BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure, td';

// v1.38.0 TTS: the block-contract version. It is baked into the TTS cache key
// (sha1(...:ttsRev)), so bumping it INVALIDATES every cached chapter audio.
// HARD RULE: any change to READER_BLOCK_SELECTOR above — or to how the server
// chunker (lib/books/tts-chunk.js) derives blocks from it — MUST bump this in
// lockstep, so the reader's blockIndex math and the server's audio offsets can
// never silently desync. Source-locked by test/unit/books-tts-chunk.test.js.
const READER_TTS_REV = 1;

// Reader prefs: bounded font scale (percent) + a named reading theme.
const READER_FONT_MIN = 80;
const READER_FONT_MAX = 170;
const READER_FONT_STEP = 10;
const READER_THEMES = ['paper', 'sepia', 'night'];

function clampReaderFontSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.min(READER_FONT_MAX, Math.max(READER_FONT_MIN, Math.round(n / READER_FONT_STEP) * READER_FONT_STEP));
}

function normalizeReaderTheme(value) {
  return READER_THEMES.includes(value) ? value : 'paper';
}

// Locator (de)serialization guards — what the reader SENDS must match what
// the server validates (bounded, per-format).
function buildEpubLocator(cfi, spineIndex, blockIndex) {
  const locator = { kind: 'epub', cfi: String(cfi || '').slice(0, 2000) };
  if (Number.isInteger(spineIndex) && spineIndex >= 0) locator.spineIndex = spineIndex;
  if (Number.isInteger(blockIndex) && blockIndex >= 0) locator.blockIndex = blockIndex;
  return locator;
}

function buildPdfLocator(page) {
  return { kind: 'pdf', page: Number.isInteger(page) && page > 0 ? page : 1 };
}

// v1.39.0: clamp a target chapter (spine) index to the valid range for prev/next
// chapter narration. `count` null => unknown length (only the lower bound is
// enforced). Returns the index, or null when out of range (a first/last edge).
function clampSpineIndex(idx, count) {
  if (!Number.isInteger(idx) || idx < 0) return null;
  if (count != null && idx >= count) return null;
  return idx;
}

// UI pass sweep S10: the reader toolbar's More menu (ui.menu items). Finished is a
// toggle whose label says what a tap will do; Save and Share act on the book file.
// v1.402.0 P4: a PDF adds the page layout choice; its label says what a tap will do.
function readerMoreMenuItems(state) {
  const finished = Boolean(state && state.finished);
  const items = [
    { value: 'finished', icon: 'check', label: finished ? 'Mark as unfinished' : 'Mark as finished' },
    { value: 'save', icon: 'download', label: 'Save to device' },
    { value: 'share', icon: 'share', label: 'Share' },
  ];
  if (state && state.format === 'pdf') {
    items.push(normalizePdfLayout(state.pdfLayout) === 'scroll'
      ? { value: 'pdf-layout', icon: 'menu_book', label: 'Turn pages' }
      : { value: 'pdf-layout', icon: 'view_list', label: 'Scroll pages' });
  }
  return items;
}

// The Aa sheet's text-size stepper: the value it shows and whether each end is live.
// PDF pages are fixed-layout, so both ends are off there.
function readerFontStepper(size, format) {
  const value = clampReaderFontSize(size);
  const fixed = format === 'pdf';
  return {
    value,
    label: fixed ? 'Fixed' : `${value}%`,
    canShrink: !fixed && value > READER_FONT_MIN,
    canGrow: !fixed && value < READER_FONT_MAX,
  };
}

// v1.402.0 P9 (Dean, 2026-11-03): the chapter frame is guarded by a script-blocking policy instead of the
// no-scripts sandbox. WebKit runs no listener the reader adds to a sandboxed no-scripts document (0 events
// measured, mouse and touch; plan Evidence, Step 1), so the page turn could not hear a finger on the iPhone.
// epub.js now runs with allowScriptedContent (sandbox "allow-same-origin allow-scripts": top navigation,
// popups and forms stay blocked), and hardenChapterMarkup rewrites every chapter's markup AFTER epub.js
// serializes it and BEFORE it becomes the frame's srcdoc (a book.spine serialize hook):
//   - the policy meta is PREPENDED: the first bytes the frame's HTML parser reads, so it lands first in
//     <head> whatever the chapter does before its own head (gate r1: qa and the adversary ran book code by
//     putting content, a body or a CDATA before <head> - the HTML parser then moved a head-placed meta into
//     <body>, where browsers ignore it);
//   - the chapter is re-parsed as HTML (what the frame will build, names case-insensitive: gate r1 W1, an
//     uppercase <SCRIPT> or HTTP-EQUIV survived an XML-DOM strip) and every script, nested frame, object,
//     embed, <base>, http-equiv meta (a refresh navigates the frame), inline on* handler and javascript:
//     URL is removed there, then serialized again.
// The serialized chapter has no doctype either way (epub.js serializes the root element), so the page's
// layout mode is unchanged. Measured: the gate's hostile chapters run nothing in WebKit and Chromium
// (scripts/page-turn-probe.js csp). The policy names only what runs code or embeds another document; a
// book's own images, fonts and styles load exactly as before.
const READER_CHAPTER_CSP = "script-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
const READER_CHAPTER_CSP_META = `<meta http-equiv="Content-Security-Policy" content="${READER_CHAPTER_CSP}">`;
const READER_CHAPTER_DROP = 'script, iframe, frame, object, embed, base, meta[http-equiv], noscript';
const READER_URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction', 'data', 'srcdoc'];

// output: epub.js's serialized chapter. DomParser: the DOMParser constructor (window's in the reader, jsdom's
// in the tests). Returns the markup the frame gets: the policy meta first, then the cleaned chapter.
function hardenChapterMarkup(output, DomParser) {
  const doc = new DomParser().parseFromString(String(output || ''), 'text/html');
  for (const el of Array.from(doc.querySelectorAll(READER_CHAPTER_DROP))) el.remove();
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      // any scheme that runs or synthesizes a document, however it is spelled or padded
      const value = Array.from(String(attr.value)).filter((ch) => ch.charCodeAt(0) > 32).join('').toLowerCase();
      if (name.startsWith('on') || (READER_URL_ATTRS.includes(name) && /^(javascript|vbscript|data:text\/html)/.test(value))) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return READER_CHAPTER_CSP_META + doc.documentElement.outerHTML;
}

// v1.402.0: an in-book link names a chapter file the way epub.js hands it over (resolved against the book's
// archive path: "../ch2.xhtml#note-3"), which epub.js's own spine lookup does not find - links in a book went
// nowhere before this. Match it to the spine's own hrefs by path (dot segments dropped, a suffix on a
// directory boundary), keep the #fragment, and name the spine index. null = not a chapter of this book (the
// reader then stays where it is: a jump that failed would fall back to the book's start and save it).
function resolveBookLink(target, spineHrefs) {
  if (typeof target !== 'string' || !target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  const hashAt = target.indexOf('#');
  const file = (hashAt >= 0 ? target.slice(0, hashAt) : target).split('?')[0];
  const hash = hashAt >= 0 ? target.slice(hashAt) : '';
  const parts = file.split('/').filter((p) => p && p !== '.' && p !== '..');
  if (!parts.length) return null;
  const tail = parts.join('/');
  const list = (Array.isArray(spineHrefs) ? spineHrefs : []).map((h) => String(h || ''));
  // an exact path first, so two chapters with one file name in different folders never swap places
  const exact = list.indexOf(tail);
  if (exact >= 0) return { target: list[exact] + hash, spine: exact };
  for (let i = 0; i < list.length; i++) {
    const href = list[i];
    if (href && (href.endsWith(`/${tail}`) || tail.endsWith(`/${href}`))) return { target: href + hash, spine: i };
  }
  return null;
}

// v1.402.0 P4: PDFs open as turning pages; "Scroll pages" in the More menu brings back the scroll column,
// remembered per device.
const READER_PDF_LAYOUTS = ['pages', 'scroll'];
const READER_PDF_LAYOUT_KEY = 'filetube_reader_pdf_layout';
function normalizePdfLayout(value) { return READER_PDF_LAYOUTS.includes(value) ? value : 'pages'; }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    READER_BLOCK_SELECTOR,
    READER_CHAPTER_CSP,
    hardenChapterMarkup,
    resolveBookLink,
    normalizePdfLayout,
    READER_TTS_REV,
    clampReaderFontSize,
    normalizeReaderTheme,
    buildEpubLocator,
    buildPdfLocator,
    clampSpineIndex,
    readerMoreMenuItems,
    readerFontStepper,
  };
}

(function () {
  if (typeof window === 'undefined') return;
  let controller = null;
  let adapter = null;
  let progressTimer = null;
  let lastLocator = null;
  let lastPercent = 0;
  let bookId = null;
  // v1.39.0 narration bar state.
  let spineCount = null;      // number of chapters (from GET /api/books/:id)
  let currentTtsSpine = null; // the chapter whose audio is currently loaded
  let listenBusy = false;     // guards overlapping Listen/chapter-advance requests
  let readerKeyHandler = null;  // init()'s arrow-key handler; v1.402.0 also hears it from inside a chapter
                                // (a press in the page's text gives that document the keyboard focus)
  let sizeReaderSurface = null; // init() exposes its measure-and-fit fn so the
                                // narration bar reveal can re-fit the chassis
  // UI pass sweep S10: the reader's sheets (Contents, Aa, More) live on <body>, outside
  // #view-root, so destroy() closes whichever is open; the key handler stands down
  // while one is (arrow keys belong to the sheet's controls, never a page flip).
  const openSheets = new Set();
  function trackSheet(ctrl) {
    if (!ctrl) return ctrl;
    openSheets.add(ctrl);
    return ctrl;
  }
  function anySheetOpen() {
    for (const ctrl of openSheets) {
      if (ctrl.isOpen()) return true;
      openSheets.delete(ctrl);
    }
    return false;
  }
  function readerUi() {
    return (typeof window !== 'undefined' && window.ui) || null;
  }

  const FONT_KEY = 'filetube_reader_fontsize';
  const THEME_KEY = 'filetube_reader_theme';

  // P5: with Reduce Motion on, a turn changes the page at once (no curl, no spring). Read at each turn, so
  // switching the setting takes effect without reopening the book.
  function readerReducedMotion() {
    try { return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; }
  }

  function readPref(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; }
  }
  function writePref(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) { /* storage disabled */ }
  }

  // DOM-thin: the block-index computation over a live chapter document —
  // the pure CONTRACT (selector + doc-order index) is the exported constant
  // above; this walk is untestable-by-necessity in this repo (no DOM
  // harness), same posture as the router's swap machinery.
  function blockIndexForNode(doc, node) {
    if (!doc || !node) return null;
    let el = node.nodeType === 1 ? node : node.parentElement;
    const blocks = Array.from(doc.querySelectorAll(READER_BLOCK_SELECTOR));
    while (el) {
      const idx = blocks.indexOf(el);
      if (idx >= 0) return idx;
      el = el.parentElement;
    }
    return null;
  }

  // v1.37.3 (Dean's pagination report): epub.js's paginated flow columnizes
  // each chapter against its container's MEASURED size. Handed percentage
  // dimensions (or an unsettled container), it silently renders whole
  // chapters as one enormous un-columned page -- overflow past the border,
  // arrow keys skipping entire chapters, per-page size drift, and a
  // chapter-granular progress bar (every symptom reported on-device).
  // The fix everywhere: EXPLICIT, measured pixel dimensions, and never
  // opening until the pane has settled ones.
  function waitForPaneSize(pane, signal) {
    return new Promise((resolve) => {
      let tries = 0;
      const check = () => {
        if (signal.aborted) return resolve(null);
        const w = pane.clientWidth;
        const h = pane.clientHeight;
        if (w > 50 && h > 50) return resolve({ width: Math.floor(w), height: Math.floor(h) });
        tries += 1;
        if (tries > 100) return resolve({ width: Math.max(320, Math.floor(w) || 320), height: Math.max(320, Math.floor(h) || 480) });
        requestAnimationFrame(check);
      };
      check();
    });
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const script = document.createElement('script');
      script.src = src;
      script.addEventListener('load', () => resolve());
      script.addEventListener('error', () => reject(new Error(`failed to load ${src}`)));
      document.body.appendChild(script);
    });
  }

  function queueProgressPing(locator, percent) {
    lastLocator = locator;
    lastPercent = percent;
    if (progressTimer) return;
    progressTimer = setTimeout(() => {
      progressTimer = null;
      sendProgress(false);
    }, 3000);
  }

  function sendProgress(useKeepalive) {
    if (!bookId || !lastLocator) return;
    const body = JSON.stringify({ locator: lastLocator, percent: lastPercent });
    try {
      fetch(`/api/books/${encodeURIComponent(bookId)}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: Boolean(useKeepalive),
      }).catch(() => {});
    } catch (_) { /* never let a ping throw into the reader */ }
  }

  // The pane's status layer. `text` alone is a plain line ("Opening book..."); with
  // `{ error: true }` it is a ui-state block (plan D9) whose action leads back to the
  // library; falsy text hides it.
  function setStatus(root, text, opts) {
    const status = root.querySelector('#reader-status');
    if (!status) return;
    // v1.38.4: any status change drops the tap-to-play affordance (its button is
    // replaced below). v1.39.0: drop any pending tap-to-play click listener so it
    // can't leak across chapters (a stale ch2 handler firing on a ch3 element).
    if (status._tapHandler) { status.removeEventListener('click', status._tapHandler); status._tapHandler = null; }
    if (!text) {
      status.hidden = true;
      return;
    }
    const ui = readerUi();
    if (opts && opts.error && ui) {
      const go = () => {
        if (window.FileTube && typeof window.FileTube.navigate === 'function') window.FileTube.navigate('/books');
        else window.location.assign('/books');
      };
      status.replaceChildren(ui.state({ icon: 'error', title: text, body: opts.body || '',
        action: { label: 'Back to books', onClick: go }, doc: status.ownerDocument }));
    } else {
      status.textContent = text;
    }
    status.hidden = false;
  }

  function updateProgressBar(root, percent) {
    const fill = root.querySelector('#reader-progress-fill');
    const label = root.querySelector('#reader-percent');
    const clamped = Math.min(100, Math.max(0, percent));
    // --p is DATA (the read fraction); the CSS scales the bar by it (no inline width).
    if (fill) fill.style.setProperty('--p', String(clamped / 100));
    if (label) label.textContent = `${Math.round(clamped)}%`;
  }

  // ---- v1.38.0 TTS "Listen from Here" -----------------------------------------

  // Per-CHAPTER media id (never the bare bookId): a book has many chapters, and
  // a shared id would make chapter N+1 get adopted by the player (isAdoptLoad),
  // so its audio would never load.
  function ttsMediaId(spineIndex) { return `booktts:${bookId}:${spineIndex}`; }

  // Hand a book-audio item to the shared player as the in-reader NOW-PLAYING BAR.
  // We mount FULL into #player-slot and DO NOT dock -- the host stays FULL so its
  // full control bar (play/pause + scrub + elapsed/total time) renders as the
  // bar (docking hid all of that behind a 160px chip; v1.39.0). `suppressProgress`
  // keeps the player from reading/writing /api/progress for the synthetic id
  // (book progress is the reader's own); lock-screen prev/next route to chapter
  // advance via the player's setTrackNav seam. Returns #media-player.
  function loadReaderAudio(root, id, streamSrc) {
    const player = window.FileTube && window.FileTube.player;
    if (!player || typeof player.load !== 'function') return null;
    const slot = root.querySelector('#player-slot') || document.getElementById('player-slot');
    if (!slot) return null;
    const titleEl = root.querySelector('#reader-title');
    player.load(id, {
      type: 'audio',
      title: titleEl ? titleEl.textContent : 'Book',
      folderName: '',
      streamSrc,
      artUrl: `/bookcover/${encodeURIComponent(bookId)}`,
      readerHref: `/read.html?b=${encodeURIComponent(bookId)}`,
      suppressProgress: true,
    }, { slot });
    // No dock() -- keep it FULL in the reader bar.
    const bar = root.querySelector('#reader-nowplaying');
    if (bar) bar.hidden = false;
    // Now the bar is visible, re-fit the reading surface above it (its footprint
    // is now measurable). rAF lets the just-revealed bar lay out first; refit
    // re-paginates the reader to the new height. Runs on desktop + mobile.
    if (typeof sizeReaderSurface === 'function') {
      requestAnimationFrame(() => {
        sizeReaderSurface();
        if (adapter && typeof adapter.refit === 'function') adapter.refit();
      });
    }
    // The bar's cover: book art is a rounded square (decision 7), ui.avatar kind 'book'
    // (a broken cover falls back to the title's monogram, never a broken image).
    const art = root.querySelector('#reader-np-art');
    const ui = readerUi();
    const coverUrl = `/bookcover/${encodeURIComponent(bookId)}`;
    if (art && ui && art.getAttribute('data-src') !== coverUrl) {
      art.setAttribute('data-src', coverUrl);
      art.replaceChildren(ui.avatar({ kind: 'book', size: 'sm', url: coverUrl, name: titleEl ? titleEl.textContent : 'Book', doc: art.ownerDocument }));
    }
    if (typeof player.setTrackNav === 'function') {
      player.setTrackNav({ onPrev: () => advanceChapter(root, -1), onNext: () => advanceChapter(root, 1) });
    }
    return document.getElementById('media-player');
  }

  // Reflect the currently-playing chapter in the bar (label + prev/next enabled).
  function updateNowPlayingChrome(root, spineIndex) {
    const label = root.querySelector('#reader-np-chapter');
    if (label) {
      label.textContent = (typeof spineIndex === 'number')
        ? (spineCount ? `Chapter ${spineIndex + 1} of ${spineCount}` : `Chapter ${spineIndex + 1}`)
        : '';
    }
    const prev = root.querySelector('#reader-np-prev');
    const next = root.querySelector('#reader-np-next');
    if (prev) prev.disabled = !(typeof spineIndex === 'number' && spineIndex > 0);
    if (next) next.disabled = !(typeof spineIndex === 'number' && spineCount != null && spineIndex < spineCount - 1);
  }

  // Poll a chapter's synthesis status until it is ready (true) or failed/timed
  // out (false). Synthesis of a long chapter can take a while, so the ceiling is
  // generous; the reader shows an honest "Preparing audio…" throughout.
  function pollTtsReady(id, spineIndex) {
    return new Promise((resolve) => {
      const deadline = Date.now() + 120000;
      const tick = () => {
        fetch(`/api/books/${encodeURIComponent(id)}/tts/${spineIndex}/status`)
          .then((r) => r.json())
          .then((s) => {
            if (s.status === 'ready') return resolve(true);
            if (s.status === 'failed' || Date.now() > deadline) return resolve(false);
            setTimeout(tick, 1000);
          })
          .catch(() => resolve(false));
      };
      tick();
    });
  }

  // A tappable "start listening" affordance filling the reading pane -- the
  // RELIABLE iOS path: the tap is a fresh user gesture WITH the audio loaded, so
  // play() is always permitted, and that first successful user-initiated play()
  // unlocks the persistent media element for the session so every later chapter
  // auto-plays (player.js's own documented behavior).
  function offerTapToPlay(root, mp, startSec) {
    const status = root.querySelector('#reader-status');
    if (!status) return;
    // Drop any prior tap handler first (a fast chapter change before the user
    // tapped would otherwise leave two handlers on one click).
    if (status._tapHandler) { status.removeEventListener('click', status._tapHandler); status._tapHandler = null; }
    const ui = readerUi();
    if (ui) {
      status.replaceChildren(ui.button({ variant: 'primary', size: 'lg', pill: true, icon: 'play_arrow',
        label: 'Tap to start listening', doc: status.ownerDocument }));
    } else {
      status.textContent = 'Tap to start listening';
    }
    status.hidden = false;
    const onTap = () => {
      status.removeEventListener('click', onTap);
      status._tapHandler = null;
      try { if (startSec > 0) mp.currentTime = startSec; } catch (_) { /* seek unsupported */ }
      const pr = mp.play();
      if (pr && typeof pr.then === 'function') {
        pr.then(() => setStatus(root, '')).catch(() => offerTapToPlay(root, mp, startSec)); // still blocked -> keep offering
      } else {
        setStatus(root, '');
      }
    };
    status._tapHandler = onTap;
    status.addEventListener('click', onTap);
  }

  // Fetch the block->startSec map, mount the chapter audio into the now-playing
  // bar (book cover as artwork), start playback from the reading paragraph, and
  // prefetch the next chapter. play() is attempted IMMEDIATELY (never gated on a
  // media event -- iOS may never fire one before a gesture) and OBSERVED: on an
  // autoplay block it falls back to the "Tap to start listening" button.
  function startTtsPlayback(root, spineIndex, blockIndex) {
    return fetch(`/book/${encodeURIComponent(bookId)}/tts/${spineIndex}/blocks`)
      .then((r) => (r.ok ? r.json() : []))
      .then((blocks) => {
        // The nearest block whose index is <= our position (an ancestor-only
        // slot shares the next real block's startSec, so this always lands on
        // spoken audio at or before the reading point).
        let startSec = 0;
        for (const b of blocks) {
          if (typeof b.blockIndex === 'number' && b.blockIndex <= blockIndex) startSec = b.startSec;
          else break;
        }
        const mp = loadReaderAudio(root, ttsMediaId(spineIndex), `/book/${encodeURIComponent(bookId)}/tts/${spineIndex}`);
        if (!mp) { setStatus(root, 'Audio isn’t available right now.'); return; }
        currentTtsSpine = spineIndex;
        updateNowPlayingChrome(root, spineIndex);
        // Seek to the paragraph once metadata is available (best-effort; a tiny
        // start-of-chapter blip if metadata lags the first samples).
        const seek = () => { try { if (startSec > 0) mp.currentTime = startSec; } catch (_) { /* unsupported */ } };
        if (mp.readyState >= 1) seek();
        mp.addEventListener('loadedmetadata', seek, { once: true });
        // Attempt play NOW and observe the block -> tap-to-play fallback.
        const pr = mp.play();
        if (pr && typeof pr.then === 'function') {
          pr.then(() => setStatus(root, '')).catch(() => offerTapToPlay(root, mp, startSec));
        } else {
          setStatus(root, '');
        }
        // Warm the next chapter so it's ready when the reader advances.
        fetch(`/book/${encodeURIComponent(bookId)}/tts/${spineIndex + 1}/ensure`, { method: 'POST' }).catch(() => {});
      });
  }

  // The shared synthesize -> poll -> play flow for a given chapter/paragraph,
  // guarded against overlapping requests (a fast prev/next tap or a re-Listen).
  function beginListen(root, spineIndex, blockIndex) {
    if (listenBusy) return Promise.resolve();
    listenBusy = true;
    setStatus(root, 'Preparing audio…');
    return fetch(`/book/${encodeURIComponent(bookId)}/tts/${spineIndex}/ensure`, { method: 'POST' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`ensure ${r.status}`))))
      .then(() => pollTtsReady(bookId, spineIndex))
      .then((ok) => {
        if (!ok) { setStatus(root, 'Audio isn’t available for this chapter.'); return null; }
        return startTtsPlayback(root, spineIndex, blockIndex);
      })
      .catch((err) => {
        console.error('Listen from here failed:', err);
        setStatus(root, 'Audio isn’t available right now.');
      })
      .then((v) => { listenBusy = false; return v; }, (e) => { listenBusy = false; throw e; });
  }

  function startListenFromHere(root) {
    if (!lastLocator || lastLocator.kind !== 'epub' || typeof lastLocator.spineIndex !== 'number') {
      setStatus(root, 'Listening isn’t available for this spot.');
      return;
    }
    beginListen(root, lastLocator.spineIndex, typeof lastLocator.blockIndex === 'number' ? lastLocator.blockIndex : 0);
  }

  // Prev/next CHAPTER: advance the narration to the neighbouring chapter (from
  // its start) and follow the reader page to match. Bounded by the spine.
  function advanceChapter(root, delta) {
    if (currentTtsSpine == null || listenBusy) return; // ignore taps while a chapter is preparing
    const next = clampSpineIndex(currentTtsSpine + delta, spineCount);
    if (next == null) return; // at the first/last chapter
    // Follow the page ONLY once the new chapter actually starts playing
    // (currentTtsSpine flips to `next` on success) -- otherwise a failed/blocked
    // synth would leave the page on a chapter whose audio never loaded.
    beginListen(root, next, 0).then(() => {
      if (currentTtsSpine === next && adapter && typeof adapter.goToSpine === 'function') adapter.goToSpine(next);
    });
  }

  // The book's table of contents, handed over by the format adapter; the Contents sheet
  // (openContentsSheet in init) renders it each time it opens.
  let tocEntries = [];
  let tocSelect = null;
  function renderToc(root, entries, onSelect) {
    tocEntries = Array.isArray(entries) ? entries : [];
    tocSelect = typeof onSelect === 'function' ? onSelect : null;
  }

  // ---- EPUB adapter ----------------------------------------------------------
  //
  // v1.402.0 (plan 2026-11-03-book-page-turn): books turn like paper. The page turn (page-turn.js) shows
  // several pages at once - per direction the page under, the turning leaf's front and its back - so the book
  // is held by a POOL of single-page epub.js renditions of the one Book (`spread: 'none'`, each sized to one
  // page, all with the same theme and font so they paginate identically), each parked on a page by display() +
  // next()/prev(). Measured in the Step 1 spike (plan Evidence): eight renditions of War and Peace coexist and
  // each keeps its own place; a hidden view re-pointed across a chapter takes 54 ms median.
  // P3: two pages when the reader is wider than tall and at least 640 px wide (page-turn.js ptLayout, one rule
  // for EPUB and PDF), one page otherwise - phones in portrait are strictly one page. It replaced epub.js's own
  // spread rule (minSpreadWidth 800).

  // The book's place (P8) is the CURRENT viewer's: the one showing the base page on the top rig. A parked
  // neighbour (the next page, the leaf's back) never saves a place. epubLocationReport(book, location,
  // contents) -> { locator, percent } or null, from epub.js's own location object (relocated's, or
  // currentLocation()'s: the same shape).
  function epubLocationReport(book, location, contents) {
    if (!location || !location.start) return null;
    let percent = 0;
    try {
      percent = book.locations.length() ? book.locations.percentageFromCfi(location.start.cfi) * 100 : 0;
    } catch (_) { percent = 0; }
    // blockIndex: the listen-from-here bridge (see READER_BLOCK_SELECTOR's contract comment).
    let blockIndex = null;
    try {
      if (contents && contents.document) {
        const range = contents.range(location.start.cfi);
        blockIndex = range ? blockIndexForNode(contents.document, range.startContainer) : null;
      }
    } catch (_) { blockIndex = null; }
    return { locator: buildEpubLocator(location.start.cfi, location.start.index, blockIndex), percent };
  }

  async function openEpub(root, pane, detail, signal) {
    setStatus(root, 'Loading reader…');
    // JSZip MUST load before epub.js (its runtime dependency).
    await loadScriptOnce('/vendor/jszip/jszip.min.js');
    await loadScriptOnce('/vendor/epubjs/epub.min.js');
    await loadScriptOnce('/js/page-turn.js');
    if (signal.aborted) return null;
    setStatus(root, 'Opening book…');

    // openAs: 'epub' is REQUIRED (v1.37.1 hotfix, Dean's stuck-open report):
    // epub.js type-sniffs its input by URL EXTENSION -- /book/<id>/file has
    // none, so it was treated as an UNPACKED book directory and epub.js
    // fetched /book/<id>/file/META-INF/container.xml (404) forever.
    const book = window.ePub(`/book/${encodeURIComponent(detail.id)}/file`, { openAs: 'epub' });
    const spineHrefs = () => book.spine.spineItems.map((x) => x.href);
    // P9: every chapter's markup is hardened after epub.js serializes it and before it becomes a frame's
    // srcdoc (see hardenChapterMarkup). epub.js runs serialize hooks in registration order and its OWN hook (an
    // archived book's resource URLs swapped for blob: URLs) rewrites section.output from the ORIGINAL markup,
    // so a guard registered before it is silently undone (gate r1 fix round, measured: the frame got the
    // book's markup untouched). That hook is registered while the book opens; book.ready resolves after it,
    // so the guard is registered after book.ready, runs LAST, and hardens section.output as epub.js left it.
    // No page view exists before this (every renderTo comes after it). epub.js resolves render() with
    // section.output read after the hooks, so the hardened markup is what renders. Each pool view renders the
    // chapter again: the hardened markup is kept per chapter and reused.
    try { await book.ready; } catch (_) { /* openFailed shows the error state */ }
    if (signal.aborted) return null;
    const hardened = new Map();
    book.spine.hooks.serialize.register((output, section) => {
      if (!section) return;
      const raw = typeof section.output === 'string' ? section.output : output;
      const key = section.href || section.idref || String(section.index);
      const hit = hardened.get(key);
      if (hit && hit.raw === raw) { section.output = hit.out; return; }
      const out = hardenChapterMarkup(raw, window.DOMParser);
      hardened.set(key, { raw, out });
      section.output = out;
    });
    // Gate residual (v1.37.1 slim gate): epub.js converts ANY genuine open
    // failure into an 'openFailed' EVENT (never a promise rejection) --
    // without this subscription, a future failure class would hang at
    // 'Opening book...' exactly like the type-sniff bug did.
    book.on('openFailed', () => setStatus(root, 'Could not open this book', { error: true, body: 'The file may be damaged or not a valid EPUB.' }));
    // v1.37.3: EXPLICIT PIXELS, never percentages -- see waitForPaneSize's
    // comment for the whole-chapter-as-one-page failure mode percentages
    // caused on-device. Each pool rendition gets the page's measured pixel size.
    const paneSize = await waitForPaneSize(pane, signal);
    if (!paneSize || signal.aborted) return null;

    // Reading themes: applied to the chapter iframe via themes.override()
    // per property; the pane background is handled by the .reader-content
    // theme class. The values are the --reader-* tokens (style.css :root,
    // the reader's own axis) read via getComputedStyle - the iframe is a
    // separate document, so CSS var() cannot reach it and a literal copy
    // here would be the two-source divergence tranche F.5 exists to kill.
    // token-scale-lock pins the token values byte-exactly.
    //
    // v1.60.1 (Dean, on-device: "if I choose night I can't go back"):
    // NEVER use themes.register()+select() here. epub.js injects a
    // registered theme's rules as UNSCOPED `body {...}` into a per-theme
    // style node in the current chapter iframe; re-selecting an earlier
    // theme re-inserts duplicate rules into that theme's EXISTING style
    // node, which keeps its original document position - so the
    // LAST-CREATED theme node wins the cascade forever (the class
    // select() swaps is referenced by no injected rule, and the upstream
    // `injected` flag is write-only dead code - gate-verified in the
    // vendored source). Switching back only "works" after a chapter turn
    // builds a fresh iframe. Pre-existing since the v1.37.0 reader;
    // surfaced by the F.5 flip-all-three probe.
    // themes.override(prop, value) stores one value per property and
    // re-applies it to current AND future contents via contents.css() -
    // last call wins, fully reversible (verified in the vendored source).
    const readerToken = (name) => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (!v) throw new Error(`reader theme token ${name} missing from :root`);
      return v;
    };
    const EPUB_THEMES = {
      paper: { fg: readerToken('--reader-paper-fg'), bg: readerToken('--reader-paper-bg') },
      sepia: { fg: readerToken('--reader-sepia-fg'), bg: readerToken('--reader-sepia-bg') },
      night: { fg: readerToken('--reader-night-fg'), bg: readerToken('--reader-night-bg') },
    };
    function applyEpubTheme(rendition, name) {
      const t = EPUB_THEMES[normalizeReaderTheme(name)];
      rendition.themes.override('color', t.fg);
      rendition.themes.override('background', t.bg);
    }
    function applyPrefs(rendition) {
      applyEpubTheme(rendition, readPref(THEME_KEY, 'paper'));
      rendition.themes.fontSize(`${clampReaderFontSize(readPref(FONT_KEY, '100'))}%`);
    }

    // Locations power the percent readout. Generating them walks the whole
    // book once; cache the serialized result per book id+size so reopening
    // is instant (client-only concern; a cache miss regenerates).
    const locationsKey = `filetube_locations_${detail.id}_${detail.size}`;
    // Gate fix (adversarial S3): the per-book locations cache is BOUNDED --
    // keep at most 20 entries; evict strangers beyond that (no timestamps
    // needed: an eviction just costs one regenerate-on-open later).
    try {
      const locationKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('filetube_locations_') && key !== locationsKey) locationKeys.push(key);
      }
      for (const key of locationKeys.slice(19)) localStorage.removeItem(key);
    } catch (_) { /* storage disabled */ }
    book.ready.then(() => {
      const cached = readPref(locationsKey, '');
      if (cached) {
        try {
          book.locations.load(cached);
          return null;
        } catch (_) { /* regenerate below */ }
      }
      return book.locations.generate(600).then(() => {
        try { writePref(locationsKey, book.locations.save()); } catch (_) { /* storage full: skip */ }
      });
    }).catch(() => {});

    let engine = null;
    let placeCfi = null;   // the start CFI of the page the reader is on (re-anchors a font change or relayout)
    let placeSpine = null; // and its chapter (the fallback if that CFI is ever refused: never the book's start)

    function report(viewer, location) {
      if (!viewer.rendition) return;
      const contents = viewer.rendition.getContents()[0];
      const out = epubLocationReport(book, location, contents);
      if (!out) return;
      placeCfi = location.start.cfi;
      placeSpine = Number.isInteger(location.start.index) ? location.start.index : placeSpine;
      updateProgressBar(root, out.percent);
      queueProgressPing(out.locator, out.percent);
      if (engine) engine.refreshStacks();
    }

    // One page viewer: an epub.js rendition parked on one page. show(gen, idx, anchor) walks it there - a jump
    // (a new generation) displays the anchor, then next()/prev() step; within a generation it steps from the
    // page it holds. Past either end of the book it holds its last real page and reports present() false (the
    // engine then draws plain paper). Calls queue; only the latest target is walked to.
    function createEpubViewer() {
      const el = document.createElement('div');
      el.className = 'reader-epub-page';
      const viewer = { el, rendition: null };
      let atGen = -1;
      let pos = 0;
      let want = null;
      let present = false;
      let chain = Promise.resolve();
      function ensure() {
        if (viewer.rendition) return viewer.rendition;
        const g = engine.layout();
        const r = book.renderTo(el, {
          width: g.W,
          height: g.H,
          flow: 'paginated',
          spread: 'none',
          allowScriptedContent: true, // P9: the frame needs scripts ON for the reader's listeners; the policy blocks the book's own
        });
        applyPrefs(r);
        // An in-book link (a footnote, the book's own contents page) moves the WHOLE pool, not the one view
        // that was tapped: epub.js follows a link by calling display() on that rendition, so a tap marks the
        // click (below) and the marked display() becomes a jump. epub.js's own display() calls (a resize
        // re-showing its place) pass through untouched.
        const ownDisplay = r.display.bind(r);
        let linkTap = false;
        r.display = (target) => {
          if (!linkTap) return ownDisplay(target);
          linkTap = false;
          const to = resolveBookLink(target, spineHrefs());
          if (to) engine.jump(to);
          return Promise.resolve();
        };
        viewer.markLinkTap = () => { linkTap = true; setTimeout(() => { linkTap = false; }, 0); };
        // P6: a sideways drag anywhere on the page turns it; the browser's own sideways pan never starts,
        // while a long press still selects and a tap on a link still follows it (vertical pan and pinch stay).
        r.themes.override('touch-action', 'pan-y pinch-zoom');
        r.hooks.content.register((contents) => {
          const cdoc = contents.document;
          const frame = cdoc && cdoc.defaultView && cdoc.defaultView.frameElement;
          if (!frame || !engine) return;
          engine.attachDocument(cdoc, frame);
          cdoc.addEventListener('click', (event) => {
            const a = event.target && event.target.closest ? event.target.closest('a[href]') : null;
            if (a && viewer.markLinkTap) viewer.markLinkTap();
          }, { capture: true, signal });
          cdoc.addEventListener('keydown', (event) => { if (readerKeyHandler) readerKeyHandler(event); }, { signal });
        });
        // epub.js's own relocated stays the source of the place, but only for the CURRENT viewer (P8): a
        // parked neighbour moving to the next page must never save it.
        r.on('relocated', (location) => { if (engine && engine.isCurrent(viewer)) report(viewer, location); });
        viewer.rendition = r;
        return r;
      }
      async function displayAnchor(r, a) {
        if (a && a.feedBlock != null) {
          // v1.379.0 Feed mode (plan D4/D5): a place the FEED moved is a BLOCK position -
          // { cfi: '', spineIndex, blockIndex } - because the server cannot write a CFI epub.js will
          // honour (epub.js loads a chapter through srcdoc, i.e. the HTML parser, which inserts a <head> and
          // re-nests lax markup, so an element path computed over the raw XHTML names the wrong node;
          // measured in W1, tools/feed-proof/reader-resume.js). The reader is the one place that has
          // epub.js's live DOM, so it resolves the block itself: open the chapter, take the blockIndex-th
          // element of READER_BLOCK_SELECTOR (the chunker's own count), and display epub.js's CFI FOR THAT
          // NODE. The reader's own locators keep their text-precise CFI and never enter this branch.
          await r.display(a.spine);
          const contents = r.getContents()[0];
          const blocks = contents && contents.document ? contents.document.querySelectorAll(READER_BLOCK_SELECTOR) : [];
          // Gate r1 (adversary W5): the chunker and the HTML parser can count blocks differently on
          // lax markup (a block inside <p>, a stray <td>). A block past this DOM's count lands on the
          // chapter's LAST block, never its start - the first place saved after display() stores
          // the page shown, and the chapter start would move a real bookmark back a whole chapter.
          const node = blocks.length ? blocks[Math.min(a.feedBlock, blocks.length - 1)] : null;
          if (node && typeof contents.cfiFromNode === 'function') await r.display(contents.cfiFromNode(node));
          return;
        }
        try {
          await r.display(a ? a.target : undefined);
        } catch (err) {
          // A refused CFI lands in its CHAPTER when the anchor names one, never at the
          // start of the book: the first place saved after display() overwrites the
          // saved place, so a start fallback would move a real bookmark to page 1.
          // Only the open (resume) may end at the book's start - a book with no usable
          // place; a jump while reading (Contents, a font change, a relayout) never does
          // (gate r1 qa: a Contents link epub.js refused moved the bookmark to page 1).
          if (a && a.spine != null) {
            try { await r.display(a.spine); return; } catch (_) { /* below */ }
          }
          if (a && a.resume) { await r.display(); return; }
          throw err;
        }
      }
      async function walk() {
        const w = want;
        if (!w || signal.aborted) return;
        const r = ensure();
        if (atGen !== w.gen) {
          await displayAnchor(r, w.anchor);
          atGen = w.gen; pos = 0; present = true;
        }
        while (pos !== w.idx) {
          if (want !== w || signal.aborted) return; // superseded: the next queued walk carries on from here
          const loc = r.currentLocation();
          if (w.idx > pos) {
            if (loc && loc.atEnd) { present = false; break; }
            await r.next();
            pos += 1;
          } else {
            if (loc && loc.atStart) { present = false; break; }
            await r.prev();
            pos -= 1;
          }
          present = true;
        }
        if (pos === w.idx) present = true;
        el.classList.toggle('is-blank', !present);
      }
      viewer.show = (gen, idx, anchor) => {
        want = { gen, idx, anchor };
        chain = chain.then(walk).catch(() => {});
        return chain;
      };
      viewer.present = () => present;
      viewer.destroy = () => { want = null; try { if (viewer.rendition) viewer.rendition.destroy(); } catch (_) { /* gone */ } viewer.rendition = null; };
      return viewer;
    }

    engine = window.FileTubePageTurn.createPageTurn({
      host: pane,
      inputRoot: pane.parentElement || pane,
      source: { fixedAspect: null, createViewer: createEpubViewer },
      shadeTheme: () => normalizeReaderTheme(readPref(THEME_KEY, 'paper')),
      reducedMotion: readerReducedMotion,
      fraction: () => lastPercent / 100,
      onPlace: (viewer) => {
        if (!viewer || !viewer.rendition) return;
        report(viewer, viewer.rendition.currentLocation());
        if (!signal.aborted) setStatus(root, ''); // the first page has painted
      },
    });

    // Resume from the saved locator, else the beginning.
    const startCfi = detail.locator && detail.locator.kind === 'epub' && detail.locator.cfi ? detail.locator.cfi : undefined;
    const startSpine = detail.locator && detail.locator.kind === 'epub' && Number.isInteger(detail.locator.spineIndex) && detail.locator.spineIndex >= 0
      ? detail.locator.spineIndex : null;
    const feedBlock = startCfi === undefined && startSpine !== null
      && Number.isInteger(detail.locator.blockIndex) && detail.locator.blockIndex >= 0 ? detail.locator.blockIndex : null;
    // (v1.37.3's one-frame re-measure after display() is gone on purpose: it re-sized a rendition laid out
    // against a pane that might still be settling. Each pool rendition is sized to the page box the engine laid
    // out from the SETTLED pane (waitForPaneSize above) and is never resized; a new pane size rebuilds the
    // pool. The first paint is a device check, DEVICE-CHECKS "Page turn (v1.402.0)" (j).)
    engine.jump(feedBlock !== null ? { feedBlock, spine: startSpine, resume: true } : { target: startCfi, spine: startSpine, resume: true });

    const toc = [];
    try {
      const nav = await book.loaded.navigation;
      for (const item of (nav && nav.toc) || []) {
        toc.push({ label: (item.label || '').trim() || item.href, href: item.href });
        for (const sub of item.subitems || []) {
          toc.push({ label: (sub.label || '').trim() || sub.href, href: sub.href, sub: true });
        }
      }
    } catch (_) { /* no nav -- empty toc */ }
    // A Contents entry names its chapter the way the book's nav document does ("../Text/c2.xhtml#s3"); it is
    // matched to the spine first (resolveBookLink), and an entry that names no chapter leaves the reader where
    // it is - never a jump epub.js would refuse (gate r1 qa: that fell back to the book's start and saved it).
    renderToc(root, toc, (entry) => {
      const to = resolveBookLink(entry.href, spineHrefs());
      if (to) engine.jump(to);
    });

    const here = () => ({ target: placeCfi || undefined, spine: placeSpine });
    let lastSize = `${pane.clientWidth}x${pane.clientHeight}`;
    return {
      next: () => engine.next(),
      prev: () => engine.prev(),
      // v1.39.0: jump the visible page to a spine index (epub.js display()
      // accepts a numeric spine position) -- used to follow prev/next chapter
      // narration.
      goToSpine: (idx) => engine.jump({ target: idx, spine: idx }),
      // A new size re-paginates every view: the pool re-parks from the page the reader is on.
      setFontSize: (pct) => {
        for (const v of engine.viewers()) { if (v.rendition) v.rendition.themes.fontSize(`${pct}%`); }
        engine.jump(here());
      },
      // v1.60.1: override(), never select() - see the theme block above. A theme repaints, never re-paginates.
      setTheme: (name) => { for (const v of engine.viewers()) { if (v.rendition) applyEpubTheme(v.rendition, name); } },
      // v1.37.2: called (debounced) on window resize -- a new pane size rebuilds the page viewers at the new
      // page size (and one or two pages, P3) and re-parks them on the reader's page.
      refit: () => {
        const size = `${pane.clientWidth}x${pane.clientHeight}`;
        if (size === lastSize || pane.clientWidth <= 50 || pane.clientHeight <= 50) return;
        lastSize = size;
        engine.rebuild(here());
      },
      destroy: () => {
        try { engine.destroy(); } catch (_) { /* torn down */ }
        try { book.destroy(); } catch (_) { /* already torn down */ }
      },
    };
  }

  // ---- PDF adapter -----------------------------------------------------------
  //
  // v1.402.0 P4: a PDF opens as turning pages (the same curl and two-page view as an EPUB); "Scroll pages" in
  // the More menu brings back the scroll column below (openPdfScroll, unchanged), remembered per device.
  function openPdf(root, pane, detail, signal) {
    return normalizePdfLayout(readPref(READER_PDF_LAYOUT_KEY, 'pages')) === 'scroll'
      ? openPdfScroll(root, pane, detail, signal)
      : openPdfPaged(root, pane, detail, signal);
  }

  // One-shot cover backfill: page 1 snapshotted for the library card (no-clobber server-side; hasCover gates
  // the attempt). The paged reader renders it on its own (the scroll column reuses its page-1 canvas).
  function postPdfCover(detail, numPages, canvas) {
    const snap = document.createElement('canvas');
    const ratio = canvas.height / canvas.width;
    snap.width = 480;
    snap.height = Math.round(480 * ratio);
    snap.getContext('2d').drawImage(canvas, 0, 0, snap.width, snap.height);
    snap.toBlob((blob) => {
      if (!blob || blob.size > 512 * 1024) return; // over the route cap: skip
      fetch(`/api/books/${encodeURIComponent(detail.id)}/cover?pages=${numPages}`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      }).catch(() => {});
    }, 'image/jpeg', 0.8);
  }

  // Paged: each page viewer is a canvas; pointing it at a page draws that page from a small cache of pages
  // rendered ahead (the base page +-4), so a turn never waits on pdf.js. Pages keep renderPage's device-pixel
  // sizing (the canvas is the page's CSS size times devicePixelRatio).
  async function openPdfPaged(root, pane, detail, signal) {
    setStatus(root, 'Loading reader…');
    const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    await loadScriptOnce('/js/page-turn.js');
    if (signal.aborted) return null;
    setStatus(root, 'Opening book…');
    const doc = await pdfjs.getDocument({ url: `/book/${encodeURIComponent(detail.id)}/file` }).promise;
    if (signal.aborted) { try { doc.destroy(); } catch (_) { /* torn down */ } return null; }
    const numPages = doc.numPages;
    const first = (await doc.getPage(1)).getViewport({ scale: 1 });
    const aspect = first.width / first.height;
    const dpr = () => Math.min(3, window.devicePixelRatio || 1);

    let engine = null;
    const cache = new Map(); // `${W}x${H}:${page}` -> Promise<canvas>, least recently used first
    const CACHE_MAX = 12;
    function rendered(pageNum) {
      const g = engine.layout();
      const key = `${g.W}x${g.H}:${pageNum}`;
      if (cache.has(key)) { const hit = cache.get(key); cache.delete(key); cache.set(key, hit); return hit; }
      const job = doc.getPage(pageNum).then(async (page) => {
        const vp = page.getViewport({ scale: 1 });
        const scale = Math.min(g.W / vp.width, g.H / vp.height) * dpr();
        const scaled = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(scaled.width);
        canvas.height = Math.round(scaled.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: scaled }).promise;
        return canvas;
      });
      job.catch(() => cache.delete(key)); // allow a retry on the next pass
      cache.set(key, job);
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      return job;
    }

    function createPdfViewer() {
      const el = document.createElement('div');
      el.className = 'reader-pdf-leaf';
      const canvas = document.createElement('canvas');
      el.appendChild(canvas);
      const viewer = { el, page: null };
      let present = false;
      let ticket = 0;
      let sized = '';
      viewer.show = async (gen, idx, anchor) => {
        const mine = ++ticket;
        const pageNum = Number(anchor) + idx;
        present = Number.isInteger(pageNum) && pageNum >= 1 && pageNum <= numPages;
        el.classList.toggle('is-blank', !present);
        if (!present) { viewer.page = null; return; }
        if (viewer.page === pageNum) return;
        let src = null;
        try { src = await rendered(pageNum); } catch (_) { src = null; }
        if (mine !== ticket || !src) return;
        const g = engine.layout();
        const want = `${Math.round(g.W * dpr())}x${Math.round(g.H * dpr())}`;
        if (sized !== want) { canvas.width = Math.round(g.W * dpr()); canvas.height = Math.round(g.H * dpr()); sized = want; }
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Centre the page in the sheet (a page of another shape than page 1 is letterboxed, never stretched).
        const x = Math.round((canvas.width - src.width) / 2);
        const y = Math.round((canvas.height - src.height) / 2);
        ctx.drawImage(src, x, y);
        viewer.page = pageNum;
      };
      viewer.present = () => present;
      viewer.destroy = () => { ticket += 1; };
      return viewer;
    }

    let placePage = 1;
    let opened = false;
    engine = window.FileTubePageTurn.createPageTurn({
      host: pane,
      inputRoot: pane.parentElement || pane,
      source: { fixedAspect: aspect, createViewer: createPdfViewer },
      shadeTheme: () => normalizeReaderTheme(readPref(THEME_KEY, 'paper')),
      reducedMotion: readerReducedMotion,
      fraction: () => lastPercent / 100,
      onPlace: (viewer) => {
        if (!viewer || !viewer.page) return;
        placePage = viewer.page;
        const percent = (placePage / numPages) * 100;
        updateProgressBar(root, percent);
        lastPercent = percent;
        if (engine) engine.refreshStacks();
        if (opened) queueProgressPing(buildPdfLocator(placePage), percent);
        opened = true;
        if (!signal.aborted) setStatus(root, '');
        for (let p = placePage - 3; p <= placePage + 4; p++) if (p >= 1 && p <= numPages) rendered(p).catch(() => {});
      },
    });

    // Resume position.
    const startPage = detail.locator && detail.locator.kind === 'pdf' && Number.isInteger(detail.locator.page)
      ? Math.min(Math.max(1, detail.locator.page), numPages)
      : 1;
    placePage = startPage;
    updateProgressBar(root, (startPage / numPages) * 100);
    engine.jump(startPage);

    if (detail.hasCover !== true) {
      doc.getPage(1).then(async (page) => {
        const vp = page.getViewport({ scale: 480 / page.getViewport({ scale: 1 }).width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        if (!signal.aborted) postPdfCover(detail, numPages, canvas);
      }).catch(() => {});
    }

    renderToc(root, [], () => {}); // PDFs: no TOC content wave 1

    let lastSize = `${pane.clientWidth}x${pane.clientHeight}`;
    return {
      next: () => engine.next(),
      prev: () => engine.prev(),
      setFontSize: () => {}, // PDF pages are fixed-layout
      setTheme: () => {},    // a scan keeps its own paper whatever the reading theme
      page: () => placePage,
      refit: () => {
        const size = `${pane.clientWidth}x${pane.clientHeight}`;
        if (size === lastSize || pane.clientWidth <= 50 || pane.clientHeight <= 50) return;
        lastSize = size;
        engine.rebuild(placePage);
      },
      destroy: () => {
        try { engine.destroy(); } catch (_) { /* torn down */ }
        cache.clear();
        try { doc.destroy(); } catch (_) { /* torn down */ }
      },
    };
  }

  // Scroll pages (P4's choice): today's scroll column, as it was.
  async function openPdfScroll(root, pane, detail, signal) {
    setStatus(root, 'Loading reader…');
    const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    if (signal.aborted) return null;
    setStatus(root, 'Opening book…');

    pane.classList.add('pdf-scroll');
    const doc = await pdfjs.getDocument({ url: `/book/${encodeURIComponent(detail.id)}/file` }).promise;
    const numPages = doc.numPages;
    const holders = [];
    const rendered = new Set();

    // Page holders up front (cheap divs sized by the first page's ratio once
    // known); canvases render lazily in a window around the viewport.
    for (let i = 1; i <= numPages; i++) {
      const holder = document.createElement('div');
      holder.dataset.page = String(i);
      holder.className = 'reader-pdf-page is-pending'; // holds a page-sized gap until it renders
      pane.appendChild(holder);
      holders.push(holder);
    }

    async function renderPage(pageNum) {
      if (rendered.has(pageNum) || pageNum < 1 || pageNum > numPages) return;
      rendered.add(pageNum);
      try {
        const page = await doc.getPage(pageNum);
        const containerWidth = Math.min(pane.clientWidth - 16, 900) || 600;
        const viewport = page.getViewport({ scale: 1 });
        const scale = containerWidth / viewport.width;
        const scaled = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
        const canvas = document.createElement('canvas');
        canvas.width = scaled.width;
        canvas.height = scaled.height;
        canvas.style.width = `${Math.floor(containerWidth)}px`;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: scaled }).promise;
        const holder = holders[pageNum - 1];
        holder.classList.remove('is-pending');
        holder.innerHTML = '';
        holder.appendChild(canvas);
      } catch (_) {
        rendered.delete(pageNum); // allow a retry on the next pass
      }
    }

    function currentPage() {
      const paneTop = pane.scrollTop;
      for (let i = 0; i < holders.length; i++) {
        if (holders[i].offsetTop + holders[i].offsetHeight - paneTop > pane.clientHeight * 0.35) return i + 1;
      }
      return numPages;
    }

    function renderAround(pageNum) {
      for (let p = pageNum - 1; p <= pageNum + 2; p++) renderPage(p);
    }

    let scrollDebounce = null;
    pane.addEventListener('scroll', () => {
      if (scrollDebounce) return;
      scrollDebounce = setTimeout(() => {
        scrollDebounce = null;
        const page = currentPage();
        renderAround(page);
        const percent = (page / numPages) * 100;
        updateProgressBar(root, percent);
        queueProgressPing(buildPdfLocator(page), percent);
      }, 150);
    }, { signal, passive: true });

    // Resume position, then render its window.
    const startPage = detail.locator && detail.locator.kind === 'pdf' && Number.isInteger(detail.locator.page)
      ? Math.min(Math.max(1, detail.locator.page), numPages)
      : 1;
    renderAround(startPage);
    await renderPage(startPage);
    holders[startPage - 1].scrollIntoView();
    updateProgressBar(root, (startPage / numPages) * 100);
    setStatus(root, '');

    // One-shot cover backfill: page 1 is decoded anyway — snapshot it for
    // the library card (no-clobber server-side; hasCover gates the attempt).
    if (detail.hasCover !== true) {
      renderPage(1).then(() => {
        const canvas = holders[0] && holders[0].querySelector('canvas');
        if (!canvas) return;
        const snap = document.createElement('canvas');
        const ratio = canvas.height / canvas.width;
        snap.width = 480;
        snap.height = Math.round(480 * ratio);
        snap.getContext('2d').drawImage(canvas, 0, 0, snap.width, snap.height);
        snap.toBlob((blob) => {
          if (!blob || blob.size > 512 * 1024) return; // over the route cap: skip
          fetch(`/api/books/${encodeURIComponent(detail.id)}/cover?pages=${numPages}`, {
            method: 'POST',
            headers: { 'Content-Type': 'image/jpeg' },
            body: blob,
          }).catch(() => {});
        }, 'image/jpeg', 0.8);
      }).catch(() => {});
    }

    renderToc(root, [], () => {}); // PDFs: no TOC content wave 1

    const pageStep = (delta) => {
      const target = Math.min(Math.max(1, currentPage() + delta), numPages);
      renderAround(target);
      holders[target - 1].scrollIntoView({ behavior: 'smooth' });
    };
    return {
      next: () => pageStep(1),
      prev: () => pageStep(-1),
      setFontSize: () => {}, // PDF pages are fixed-layout
      setTheme: () => {},
      destroy: () => { try { doc.destroy(); } catch (_) { /* torn down */ } },
    };
  }

  // ---- View lifecycle ---------------------------------------------------------

  function init(root) {
    controller = new AbortController();
    const { signal } = controller;
    const pane = root.querySelector('#reader-pane');
    const content = root.querySelector('#reader-content');
    if (!pane || !content) return;
    // v1.44.3: immersive reading — hide the shell header (logo+search is wasted
    // space while reading; the reader has its own topbar with Back/Contents/Aa).
    // Added HERE, BEFORE sizeReader() measures the chassis offset below, so the
    // reading area is sized against the reclaimed full-height viewport. On a
    // direct /read load read.html's FOUC script already set it pre-paint;
    // destroy() removes it so the header returns on nav-away. Idempotent.
    document.documentElement.classList.add('reader-immersive');

    // v1.37.2 (Dean's report: topbar buttons lost on desktop; unusable
    // sizing on mobile): the CSS-var height guess was wrong on both form
    // factors -- MEASURE the real available space instead. The chassis's
    // own top offset accounts for the actual header (any theme/viewport),
    // and the bottom-nav's live height accounts for mobile chrome. Re-run
    // on resize/orientation change so the reading area always scales with
    // the device.
    const chassis = root.querySelector('#reader-chassis');
    function sizeReader() {
      if (!chassis) return;
      const top = chassis.getBoundingClientRect().top + window.scrollY;
      const bottomNav = document.getElementById('bottom-nav');
      const navVisible = bottomNav && getComputedStyle(bottomNav).display !== 'none';
      const navH = navVisible ? bottomNav.offsetHeight : 0;
      // v1.39.3 (Dean's report: the narration bar covers the reading-% bar on
      // BOTH form factors). The now-playing bar is a fixed element sitting just
      // above the nav -- reserve its REAL rendered height (not a guessed px or
      // %) so the reader's own bottom bar stays visible above it. Same live-
      // measurement approach already used for the header offset + nav height;
      // adapts to any device, font size, or bar layout with zero magic numbers.
      const np = root.querySelector('#reader-nowplaying');
      const npH = (np && !np.hidden) ? np.offsetHeight : 0;
      const height = Math.max(320, window.innerHeight - top - navH - npH);
      chassis.style.setProperty('--reader-h', height + 'px');
    }
    sizeReaderSurface = sizeReader;
    sizeReader();
    let sizeDebounce = null;
    window.addEventListener('resize', () => {
      if (sizeDebounce) clearTimeout(sizeDebounce);
      sizeDebounce = setTimeout(() => {
        sizeDebounce = null;
        sizeReader();
        if (adapter && typeof adapter.refit === 'function') adapter.refit();
      }, 150);
    }, { signal });

    const params = new URLSearchParams(window.location.search);
    bookId = params.get('b');
    if (!bookId) {
      setStatus(root, 'No book selected', { error: true, body: 'Open a book from your library.' });
      return;
    }

    // Apply the persisted reading theme to the pane immediately.
    const applyPaneTheme = (name) => {
      for (const theme of READER_THEMES) content.classList.remove(`theme-${theme}`);
      content.classList.add(`theme-${normalizeReaderTheme(name)}`);
    };
    applyPaneTheme(readPref(THEME_KEY, 'paper'));

    const ui = readerUi();
    const doc = root.ownerDocument || document;
    let bookFormat = null; // 'epub' | 'pdf' once the detail resolves

    // UI pass sweep S10 (F69): Contents is a panel sheet and Aa a popover (desktop) /
    // bottom sheet (phone), both ui.sheet: one scrim, Esc and scrim close, focus in and
    // back to the opener, the body scroll lock. They replace the two hand-built drawers
    // (no transition, no scrim, no close control).
    const tocBtn = root.querySelector('#reader-toc-btn');
    const settingsBtn = root.querySelector('#reader-settings-btn');

    function openContentsSheet() {
      if (!ui || anySheetOpen()) return;
      let ctrl = null;
      let body;
      if (!tocEntries.length) {
        body = ui.state({ icon: 'toc', title: 'No contents', body: 'This book has no table of contents.', doc });
      } else {
        body = ui.list({ size: 'compact', label: 'Contents', doc });
        for (const entry of tocEntries) {
          const row = ui.row({ size: 'compact', title: entry.label, doc, onClick: () => {
            if (ctrl) ctrl.close();
            if (tocSelect) tocSelect(entry);
          } });
          if (entry.sub) row.classList.add('reader-toc-sub');
          body.appendChild(row);
        }
      }
      ctrl = trackSheet(ui.sheet({ variant: 'panel', title: 'Contents', content: body, doc }));
      ctrl.open();
    }

    function buildSettingsContent() {
      const wrap = doc.createElement('div');
      wrap.className = 'reader-settings';

      const sizeLine = doc.createElement('div');
      sizeLine.className = 'reader-setting';
      const sizeName = doc.createElement('span');
      sizeName.className = 'reader-setting__name';
      sizeName.textContent = 'Text size';
      const stepper = doc.createElement('div');
      stepper.className = 'reader-stepper';
      const smaller = ui.button({ variant: 'tonal', size: 'sm', shape: 'icon', icon: 'remove', ariaLabel: 'Smaller text', doc });
      const value = doc.createElement('span');
      value.className = 'reader-stepper__value';
      const larger = ui.button({ variant: 'tonal', size: 'sm', shape: 'icon', icon: 'add', ariaLabel: 'Larger text', doc });
      smaller.id = 'reader-font-smaller';
      larger.id = 'reader-font-larger';
      const paintStepper = () => {
        const st = readerFontStepper(Number(readPref(FONT_KEY, '100')), bookFormat);
        value.textContent = st.label;
        smaller.disabled = !st.canShrink;
        larger.disabled = !st.canGrow;
      };
      const bumpFont = (delta) => {
        const next = clampReaderFontSize(Number(readPref(FONT_KEY, '100')) + delta);
        writePref(FONT_KEY, next);
        if (adapter) adapter.setFontSize(next);
        paintStepper();
      };
      smaller.addEventListener('click', () => bumpFont(-READER_FONT_STEP));
      larger.addEventListener('click', () => bumpFont(READER_FONT_STEP));
      paintStepper();
      stepper.append(smaller, value, larger);
      sizeLine.append(sizeName, stepper);

      const themeLine = doc.createElement('div');
      themeLine.className = 'reader-setting';
      const themeName = doc.createElement('span');
      themeName.className = 'reader-setting__name';
      themeName.textContent = 'Theme';
      const themes = ui.segmented({
        label: 'Reading theme',
        value: normalizeReaderTheme(readPref(THEME_KEY, 'paper')),
        options: [{ value: 'paper', label: 'Paper' }, { value: 'sepia', label: 'Sepia' }, { value: 'night', label: 'Night' }],
        onChange: (name) => {
          const theme = normalizeReaderTheme(name);
          writePref(THEME_KEY, theme);
          applyPaneTheme(theme);
          if (adapter) adapter.setTheme(theme);
        },
        doc,
      });
      themeLine.append(themeName, themes);
      wrap.append(sizeLine, themeLine);
      return wrap;
    }

    function openSettingsSheet() {
      if (!ui || anySheetOpen()) return;
      const ctrl = trackSheet(ui.sheet({ variant: 'auto', anchor: settingsBtn, title: 'Reader settings',
        content: buildSettingsContent(), doc }));
      ctrl.open();
    }

    if (tocBtn) tocBtn.addEventListener('click', openContentsSheet, { signal });
    if (settingsBtn) settingsBtn.addEventListener('click', openSettingsSheet, { signal });

    // v1.38.0 TTS "Listen from Here": the control lights only when an engine is
    // configured (opt-in like yt-dlp) AND the book is an EPUB (PDF has no
    // server-side text extraction here). Both gates must pass to unhide it.
    const listenBtn = root.querySelector('#reader-listen-btn');
    let ttsEngineReady = false;
    let listenBookIsEpub = false;
    const maybeShowListen = () => {
      if (listenBtn && ttsEngineReady && listenBookIsEpub) listenBtn.hidden = false;
    };
    if (listenBtn) {
      fetch('/api/books/tts/config')
        .then((r) => (r.ok ? r.json() : null))
        .then((cfg) => { if (cfg && cfg.available) { ttsEngineReady = true; maybeShowListen(); } })
        .catch(() => { /* keep the control hidden on any error */ });
      listenBtn.addEventListener('click', () => startListenFromHere(root), { signal });
    }

    // v1.72 books first-class: like (the toolbar toggle) and mark-finished + save
    // (the More menu). Disabled until the detail resolves (their state seeds from the
    // server-derived liked/finished fields - never a client re-derivation); toggles
    // are non-optimistic (the watch-page shape: busy during the request, flip the
    // mirror only on ok). F69: the pressed look is the filled icon, never a red fill.
    const bookLikeBtn = root.querySelector('#reader-like-btn');
    const moreBtn = root.querySelector('#reader-more-btn');
    // v1.287 (Dean, "everything shareable"): share the book FILE. Books have no external source,
    // so it's file-only (shareMediaFile -> navigator.share({files}), download fallback). The
    // title is captured on detail-resolve.
    let bookShareTitle = 'Book';
    let bookLiked = false;
    let bookFinished = false;
    let finishedBusy = false;
    function paintBookLike() {
      if (!bookLikeBtn) return;
      if (ui) ui.setPressed(bookLikeBtn, bookLiked);
      else bookLikeBtn.setAttribute('aria-pressed', bookLiked ? 'true' : 'false');
      bookLikeBtn.title = bookLiked ? 'Unlike' : 'Like';
    }
    if (bookLikeBtn) {
      bookLikeBtn.addEventListener('click', () => {
        if (bookLikeBtn.getAttribute('aria-busy') === 'true') return;
        if (ui) ui.setBusy(bookLikeBtn, true);
        fetch(`/api/books/liked/${encodeURIComponent(bookId)}`, { method: bookLiked ? 'DELETE' : 'POST' })
          .then((res) => {
            if (!res || !res.ok) { console.error('Book like toggle failed:', res && res.status); return; }
            bookLiked = !bookLiked;
            // The sidebar Liked entry is count-gated across ALL kinds now -
            // refresh it the moment a book like changes the total (the
            // watch-page like's exact follow-up).
            if (typeof applyLikedSidebarEntry === 'function') {
              applyLikedSidebarEntry(document.getElementById('sidebar-folders-list'), { force: true });
            }
          })
          .catch((err) => console.error('Book like toggle failed (network error):', err))
          .finally(() => { if (ui) ui.setBusy(bookLikeBtn, false); paintBookLike(); });
      }, { signal });
    }

    function toggleFinished() {
      if (finishedBusy) return;
      finishedBusy = true;
      fetch(`/api/books/${encodeURIComponent(bookId)}/finished`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finished: !bookFinished }),
      })
        .then((res) => {
          if (!res || !res.ok) {
            console.error('Book finished toggle failed:', res && res.status);
            if (ui) ui.toast('Could not update this book', { kind: 'error', doc });
            return;
          }
          bookFinished = !bookFinished;
          if (ui) ui.toast(bookFinished ? 'Marked as finished' : 'Marked as unfinished', { kind: 'success', doc });
        })
        .catch((err) => {
          console.error('Book finished toggle failed (network error):', err);
          if (ui) ui.toast('Could not update this book', { kind: 'error', doc });
        })
        .finally(() => { finishedBusy = false; });
    }

    // Save to device: the file's ?download=1 stream through a transient <a download>.
    function saveBook() {
      const a = doc.createElement('a');
      a.href = `/book/${encodeURIComponent(bookId)}/file?download=1`;
      a.download = '';
      a.hidden = true;
      doc.body.appendChild(a);
      a.click();
      a.remove();
    }

    function shareBook() {
      if (typeof window.shareMediaFile !== 'function') return;
      window.shareMediaFile({ url: `/book/${encodeURIComponent(bookId)}/file?download=1`, title: bookShareTitle, filename: bookShareTitle });
    }

    if (moreBtn) {
      moreBtn.addEventListener('click', () => {
        if (!ui || anySheetOpen()) return;
        trackSheet(ui.menu({
          label: 'More actions',
          anchor: moreBtn,
          items: readerMoreMenuItems({ finished: bookFinished, format: bookFormat, pdfLayout: readPref(READER_PDF_LAYOUT_KEY, 'pages') }),
          onSelect: (value) => {
            if (signal.aborted) return;
            if (value === 'finished') toggleFinished();
            else if (value === 'save') saveBook();
            else if (value === 'share') shareBook();
            else if (value === 'pdf-layout') switchPdfLayout();
          },
          doc,
        }));
      }, { signal });
    }

    // v1.39.0: the now-playing bar's prev/next CHAPTER buttons.
    const npPrev = root.querySelector('#reader-np-prev');
    const npNext = root.querySelector('#reader-np-next');
    if (npPrev) npPrev.addEventListener('click', () => advanceChapter(root, -1), { signal });
    if (npNext) npNext.addEventListener('click', () => advanceChapter(root, 1), { signal });

    // Tap zones + keys.
    const tapPrev = root.querySelector('#reader-tap-prev');
    const tapNext = root.querySelector('#reader-tap-next');
    if (tapPrev) tapPrev.addEventListener('click', () => adapter && adapter.prev(), { signal });
    if (tapNext) tapNext.addEventListener('click', () => adapter && adapter.next(), { signal });
    readerKeyHandler = (event) => {
      // v1.43.1 B3: never page-flip while the user is TYPING (header search,
      // any modal input) -- this handler previously had no guard at all: an
      // arrow key pressed mid-word in the search box silently flipped the
      // book underneath. Deliberately NARROWER than player.js's shortcut
      // guard (which also skips BUTTON/A): Space/Enter activate a focused
      // button, so the player must stand down there -- arrows don't, and
      // page-flipping should keep working while e.g. the Listen button holds
      // focus. Typing surfaces only.
      const el = document.activeElement;
      const tag = (el && el.tagName) || '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || (el && el.isContentEditable)) return;
      // v1.47.8 gate W7: never flip pages while the keyboard-shortcuts dialog
      // is open. That dialog focuses its close BUTTON, and the guard above
      // deliberately allows BUTTON through (so arrows keep working while e.g.
      // Listen holds focus) -- so without this, scanning the shortcut list with
      // the arrow keys silently turned the book behind it and lost the reader's
      // place. Checked via `window` so this file still require()s in node:test.
      const shortcutsOpen = (typeof window !== 'undefined')
        && typeof window.isShortcutsModalOpen === 'function'
        && window.isShortcutsModalOpen();
      if (shortcutsOpen) return;
      // UI pass sweep S10: an open reader sheet owns the arrows (the theme segmented
      // control moves on ArrowLeft/Right) - flipping the page under it loses the place.
      if (anySheetOpen()) return;
      if (event.key === 'ArrowRight') { if (adapter) adapter.next(); }
      if (event.key === 'ArrowLeft') { if (adapter) adapter.prev(); }
    };
    document.addEventListener('keydown', readerKeyHandler, { signal });

    // Flush the pending position on backgrounding — keepalive so the write
    // survives the page going away (the background-lifecycle lesson).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') sendProgress(true);
    }, { signal });
    window.addEventListener('pagehide', () => sendProgress(true), { signal });

    // v1.402.0: each open of the book gets its own abort signal (chained to the view's), so switching a PDF
    // between turning pages and the scroll column tears the old adapter's listeners down with it.
    let bookDetail = null;
    let openCtl = null;
    function openBook(detail) {
      if (openCtl) openCtl.abort();
      openCtl = new AbortController();
      const mine = openCtl;
      signal.addEventListener('abort', () => mine.abort(), { once: true });
      const open = detail.format === 'pdf' ? openPdf : openEpub;
      return open(root, pane, detail, mine.signal).then((created) => {
        if (mine.signal.aborted) { if (created) { try { created.destroy(); } catch (_) { /* torn down */ } } return null; }
        adapter = created;
        return created;
      });
    }
    // P4: the More menu's "Scroll pages" / "Turn pages" - remembered per device, the book reopens on its page.
    function switchPdfLayout() {
      if (!bookDetail || bookFormat !== 'pdf') return;
      const now = normalizePdfLayout(readPref(READER_PDF_LAYOUT_KEY, 'pages'));
      writePref(READER_PDF_LAYOUT_KEY, now === 'scroll' ? 'pages' : 'scroll');
      const page = lastLocator && lastLocator.kind === 'pdf' ? lastLocator.page
        : (adapter && typeof adapter.page === 'function' ? adapter.page() : null);
      if (adapter) { try { adapter.destroy(); } catch (_) { /* torn down */ } adapter = null; }
      pane.classList.remove('pdf-scroll');
      pane.replaceChildren();
      pane.scrollTop = 0;
      const detail = Object.assign({}, bookDetail, page ? { locator: buildPdfLocator(page), hasCover: true } : { hasCover: true });
      openBook(detail).catch((err) => {
        console.error('Reader: failed to reopen book:', err);
        setStatus(root, 'Could not open this book', { error: true, body: 'It may have moved, or the server could not read it.' });
      });
    }

    // Load the book detail, then hand off to the format adapter.
    fetch(`/api/books/${encodeURIComponent(bookId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`detail ${res.status}`);
        return res.json();
      })
      .then((detail) => {
        const title = root.querySelector('#reader-title');
        if (title) title.textContent = detail.title || 'Untitled';
        document.title = `${detail.title || 'Read'} - FileTube`;
        if (detail.progress && typeof detail.progress.percent === 'number') {
          updateProgressBar(root, detail.progress.percent);
        }
        // v1.38.0 TTS: only EPUB books can "Listen from here".
        if (detail.format === 'epub') { listenBookIsEpub = true; maybeShowListen(); }
        // v1.72 books first-class: seed the like toggle from the server's derived
        // fields and enable the reserved controls (they never pop in: F69).
        bookFormat = detail.format === 'pdf' ? 'pdf' : 'epub';
        bookLiked = detail.liked === true;
        bookFinished = detail.finished === true;
        paintBookLike();
        if (bookLikeBtn) bookLikeBtn.disabled = false;
        bookShareTitle = detail.title || 'Book'; // v1.287: for the share filename/title
        if (moreBtn) moreBtn.disabled = false;
        // v1.39.0: chapter count for prev/next-chapter bounds.
        spineCount = Array.isArray(detail.spine) ? detail.spine.length : null;
        bookDetail = detail;
        return openBook(detail);
      })
      .catch((err) => {
        console.error('Reader: failed to open book:', err);
        setStatus(root, 'Could not open this book', { error: true, body: 'It may have moved, or the server could not read it.' });
      });
  }

  function destroy() {
    // The reader's sheets live on <body>: an in-app nav away must not strand one.
    for (const ctrl of openSheets) { if (ctrl.isOpen()) ctrl.close(); }
    openSheets.clear();
    tocEntries = [];
    tocSelect = null;
    if (progressTimer) {
      clearTimeout(progressTimer);
      progressTimer = null;
    }
    sendProgress(true); // last position wins, even on an in-app swap away
    if (adapter) {
      try { adapter.destroy(); } catch (_) { /* torn down */ }
      adapter = null;
    }
    if (controller) controller.abort();
    controller = null;
    sizeReaderSurface = null; // its closure references the torn-down chassis
    readerKeyHandler = null;
    bookId = null;
    lastLocator = null;
    // v1.39.0: drop reader-scoped narration state. The player itself is NOT
    // closed here -- leaving the reader lets narration keep playing (the router
    // docks it); but the lock-screen prev/next CHAPTER handlers reference this
    // torn-down view, so clear them.
    spineCount = null;
    currentTtsSpine = null;
    listenBusy = false;
    const player = window.FileTube && window.FileTube.player;
    if (player && typeof player.setTrackNav === 'function') player.setTrackNav(null);
    // v1.44.3: leaving the reader — restore the shell header (see init()).
    document.documentElement.classList.remove('reader-immersive');
  }

  if (window.FileTube && typeof window.FileTube.registerView === 'function') {
    window.FileTube.registerView('read', { init, destroy });
  }
})();
