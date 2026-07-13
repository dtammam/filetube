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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    READER_BLOCK_SELECTOR,
    READER_TTS_REV,
    clampReaderFontSize,
    normalizeReaderTheme,
    buildEpubLocator,
    buildPdfLocator,
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

  const FONT_KEY = 'filetube_reader_fontsize';
  const THEME_KEY = 'filetube_reader_theme';

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

  function setStatus(root, text) {
    const status = root.querySelector('#reader-status');
    if (!status) return;
    if (text) {
      status.textContent = text;
      status.hidden = false;
    } else {
      status.hidden = true;
    }
  }

  function updateProgressBar(root, percent) {
    const fill = root.querySelector('#reader-progress-fill');
    const label = root.querySelector('#reader-percent');
    const clamped = Math.min(100, Math.max(0, percent));
    if (fill) fill.style.width = `${clamped}%`;
    if (label) label.textContent = `${Math.round(clamped)}%`;
  }

  // ---- v1.38.0 TTS "Listen from Here" -----------------------------------------

  // A brief SILENT audio clip (built once, at runtime, so no huge literal sits
  // in source). It exists solely to satisfy the iOS autoplay gesture wall: the
  // REAL chapter audio only becomes playable seconds after the tap (synthesis +
  // status poll + blocks fetch), by which point the tap gesture is long gone and
  // iOS silently blocks play() (the swallowed NotAllowedError = "no audio, the
  // Preparing text just disappears"). Playing this clip DURING the tap
  // user-activates ("blesses") the shared media element; that blessing is scoped
  // to the ELEMENT, not the src (see player.js), so the real audio then plays.
  function makeSilentWavDataUri(seconds) {
    const sr = 8000; const dataSize = sr * seconds; // 8-bit mono PCM
    const bytes = new Uint8Array(44 + dataSize);
    const dv = new DataView(bytes.buffer);
    const wr = (off, s) => { for (let i = 0; i < s.length; i++) bytes[off + i] = s.charCodeAt(i); };
    wr(0, 'RIFF'); dv.setUint32(4, 36 + dataSize, true); wr(8, 'WAVE');
    wr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
    wr(36, 'data'); dv.setUint32(40, dataSize, true);
    bytes.fill(0x80, 44); // 0x80 = 8-bit PCM silence
    let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return 'data:audio/wav;base64,' + btoa(bin);
  }
  const TTS_UNLOCK_CLIP = makeSilentWavDataUri(30);

  // Mount + user-activate the shared player's media element DURING the Listen
  // tap. player.load() mounts the host and sets the src synchronously; the
  // direct play() right after is what blesses the element within the gesture
  // (player.load's OWN play() is deferred behind an async progress fetch, so it
  // can't do the blessing itself). Best-effort throughout.
  function primeAudioForGesture(root) {
    const player = window.FileTube && window.FileTube.player;
    if (!player || typeof player.load !== 'function') return;
    const titleEl = root.querySelector('#reader-title');
    player.load(bookId, {
      type: 'audio',
      title: titleEl ? titleEl.textContent : 'Book',
      folderName: '',
      streamSrc: TTS_UNLOCK_CLIP,
      artUrl: `/bookcover/${encodeURIComponent(bookId)}`,
    }, {});
    const mp = document.getElementById('media-player');
    if (mp) {
      try { const p = mp.play(); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch (_) { /* blessed on the call itself */ }
    }
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

  // Fetch the block->startSec map, hand the chapter audio to the shared player
  // (the battle-won background-audio path) with the book cover as artwork, and
  // seek to the paragraph the reader is on. Also prefetches the next chapter.
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
        const titleEl = root.querySelector('#reader-title');
        const player = window.FileTube && window.FileTube.player;
        if (!player || typeof player.load !== 'function') return;
        player.load(bookId, {
          type: 'audio',
          title: titleEl ? titleEl.textContent : 'Book',
          folderName: '',
          streamSrc: `/book/${encodeURIComponent(bookId)}/tts/${spineIndex}`,
          artUrl: `/bookcover/${encodeURIComponent(bookId)}`,
        }, {});
        if (startSec > 0) {
          const mp = document.getElementById('media-player');
          if (mp) {
            const onMeta = () => { try { mp.currentTime = startSec; } catch (_) { /* seek unsupported */ } mp.removeEventListener('loadedmetadata', onMeta); };
            mp.addEventListener('loadedmetadata', onMeta);
          }
        }
        setStatus(root, '');
        // Warm the next chapter so playback continues seamlessly.
        fetch(`/book/${encodeURIComponent(bookId)}/tts/${spineIndex + 1}/ensure`, { method: 'POST' }).catch(() => {});
      });
  }

  function startListenFromHere(root, btn) {
    if (!lastLocator || lastLocator.kind !== 'epub' || typeof lastLocator.spineIndex !== 'number') {
      setStatus(root, 'Listening isn’t available for this spot.');
      return;
    }
    const spineIndex = lastLocator.spineIndex;
    const blockIndex = typeof lastLocator.blockIndex === 'number' ? lastLocator.blockIndex : 0;
    // Unlock playback WITHIN this tap (the iOS gesture wall) before any async
    // work -- the real audio's play() lands seconds later, outside the gesture.
    primeAudioForGesture(root);
    btn.disabled = true;
    setStatus(root, 'Preparing audio…');
    fetch(`/book/${encodeURIComponent(bookId)}/tts/${spineIndex}/ensure`, { method: 'POST' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`ensure ${r.status}`))))
      .then(() => pollTtsReady(bookId, spineIndex))
      .then((ok) => {
        btn.disabled = false;
        if (!ok) { setStatus(root, 'Audio isn’t available for this chapter.'); return null; }
        return startTtsPlayback(root, spineIndex, blockIndex);
      })
      .catch((err) => {
        btn.disabled = false;
        console.error('Listen from here failed:', err);
        setStatus(root, 'Audio isn’t available right now.');
      });
  }

  function renderToc(root, entries, onSelect, signal) {
    const list = root.querySelector('#reader-toc-list');
    if (!list) return;
    list.innerHTML = '';
    if (!entries.length) {
      const none = document.createElement('div');
      none.className = 'reader-toc-item';
      none.textContent = 'No table of contents in this book.';
      list.appendChild(none);
      return;
    }
    for (const entry of entries) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'reader-toc-item';
      btn.textContent = entry.label;
      btn.addEventListener('click', () => {
        onSelect(entry);
        const drawer = root.querySelector('#reader-toc-drawer');
        if (drawer) drawer.hidden = true;
      }, { signal });
      list.appendChild(btn);
    }
  }

  // ---- EPUB adapter ----------------------------------------------------------

  async function openEpub(root, pane, detail, signal) {
    setStatus(root, 'Loading reader…');
    // JSZip MUST load before epub.js (its runtime dependency).
    await loadScriptOnce('/vendor/jszip/jszip.min.js');
    await loadScriptOnce('/vendor/epubjs/epub.min.js');
    if (signal.aborted) return null;
    setStatus(root, 'Opening book…');

    // openAs: 'epub' is REQUIRED (v1.37.1 hotfix, Dean's stuck-open report):
    // epub.js type-sniffs its input by URL EXTENSION -- /book/<id>/file has
    // none, so it was treated as an UNPACKED book directory and epub.js
    // fetched /book/<id>/file/META-INF/container.xml (404) forever.
    const book = window.ePub(`/book/${encodeURIComponent(detail.id)}/file`, { openAs: 'epub' });
    // Gate residual (v1.37.1 slim gate): epub.js converts ANY genuine open
    // failure into an 'openFailed' EVENT (never a promise rejection) --
    // without this subscription, a future failure class would hang at
    // 'Opening book...' exactly like the type-sniff bug did.
    book.on('openFailed', () => setStatus(root, 'Could not open this book.'));
    // v1.37.3: EXPLICIT PIXELS, never percentages -- see waitForPaneSize's
    // comment for the whole-chapter-as-one-page failure mode percentages
    // caused on-device. minSpreadWidth 800 keeps phones strictly
    // single-page; wide desktop panes get two.
    const paneSize = await waitForPaneSize(pane, signal);
    if (!paneSize || signal.aborted) return null;
    const rendition = book.renderTo(pane, {
      width: paneSize.width,
      height: paneSize.height,
      flow: 'paginated',
      spread: 'auto',
      minSpreadWidth: 800,
      allowScriptedContent: false,
    });

    // Reading themes: epub.js injects these into the chapter iframe; the
    // pane background is handled by the .reader-content theme class.
    rendition.themes.register('paper', { body: { color: '#1c1c1c', background: '#f7f4ec' } });
    rendition.themes.register('sepia', { body: { color: '#3a2f20', background: '#f0e3c9' } });
    rendition.themes.register('night', { body: { color: '#c8c8d0', background: '#101014' } });

    function applyPrefs() {
      rendition.themes.select(normalizeReaderTheme(readPref(THEME_KEY, 'paper')));
      rendition.themes.fontSize(`${clampReaderFontSize(readPref(FONT_KEY, '100'))}%`);
    }
    applyPrefs();

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

    rendition.on('relocated', (location) => {
      if (!location || !location.start) return;
      let percent = 0;
      try {
        percent = book.locations.length() ? book.locations.percentageFromCfi(location.start.cfi) * 100 : 0;
      } catch (_) { percent = 0; }
      updateProgressBar(root, percent);
      // blockIndex: the wave-2 listen-from-here bridge (see
      // READER_BLOCK_SELECTOR's contract comment).
      let blockIndex = null;
      try {
        const contents = rendition.getContents()[0];
        if (contents && contents.document) {
          const range = contents.range(location.start.cfi);
          blockIndex = range ? blockIndexForNode(contents.document, range.startContainer) : null;
        }
      } catch (_) { blockIndex = null; }
      queueProgressPing(buildEpubLocator(location.start.cfi, location.start.index, blockIndex), percent);
    });

    // Resume from the saved locator, else the beginning.
    const startCfi = detail.locator && detail.locator.kind === 'epub' && detail.locator.cfi ? detail.locator.cfi : undefined;
    try {
      await rendition.display(startCfi);
    } catch (_) {
      await rendition.display(); // a stale/foreign CFI falls back to the start
    }
    // v1.37.3 (Dean: desktop pages sometimes EMPTY until a tap): epub.js can
    // complete display() without painting when the container was measured
    // mid-layout -- a tap forces the reflow it missed. Nudge one explicit
    // re-measure a frame after display so the first paint never depends on
    // user interaction.
    requestAnimationFrame(() => {
      const w = Math.floor(pane.clientWidth);
      const h = Math.floor(pane.clientHeight);
      if (w > 50 && h > 50) {
        try { rendition.resize(w, h); } catch (_) { /* not ready */ }
      }
    });
    setStatus(root, '');

    const toc = [];
    try {
      const nav = await book.loaded.navigation;
      for (const item of (nav && nav.toc) || []) {
        toc.push({ label: (item.label || '').trim() || item.href, href: item.href });
        for (const sub of item.subitems || []) {
          toc.push({ label: ` ${(sub.label || '').trim() || sub.href}`, href: sub.href });
        }
      }
    } catch (_) { /* no nav -- empty toc */ }
    renderToc(root, toc, (entry) => { rendition.display(entry.href).catch(() => {}); }, signal);

    return {
      next: () => rendition.next().catch(() => {}),
      prev: () => rendition.prev().catch(() => {}),
      setFontSize: (pct) => rendition.themes.fontSize(`${pct}%`),
      setTheme: (name) => rendition.themes.select(name),
      // v1.37.2: called (debounced) on window resize -- re-measures the
      // pane so pagination/spread track the new dimensions.
      refit: () => {
        const w = Math.floor(pane.clientWidth);
        const h = Math.floor(pane.clientHeight);
        if (w > 50 && h > 50) {
          try { rendition.resize(w, h); } catch (_) { /* not ready yet */ }
        }
      },
      destroy: () => { try { book.destroy(); } catch (_) { /* already torn down */ } },
    };
  }

  // ---- PDF adapter -----------------------------------------------------------

  async function openPdf(root, pane, detail, signal) {
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
      holder.style.minHeight = '200px';
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
        holder.style.minHeight = '';
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

    renderToc(root, [], () => {}, signal); // PDFs: no TOC drawer content wave 1

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
      const height = Math.max(320, window.innerHeight - top - navH);
      chassis.style.height = height + 'px';
    }
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
      setStatus(root, 'No book selected.');
      return;
    }

    // Apply the persisted reading theme to the pane immediately.
    const applyPaneTheme = (name) => {
      for (const theme of READER_THEMES) content.classList.remove(`theme-${theme}`);
      content.classList.add(`theme-${normalizeReaderTheme(name)}`);
    };
    applyPaneTheme(readPref(THEME_KEY, 'paper'));

    // Drawers — [hidden] companions live in the page CSS (the
    // chapters-menu lesson); pointerdown-outside closes (the iOS
    // synthesized-click lesson).
    const tocDrawer = root.querySelector('#reader-toc-drawer');
    const settingsDrawer = root.querySelector('#reader-settings-drawer');
    const tocBtn = root.querySelector('#reader-toc-btn');
    const settingsBtn = root.querySelector('#reader-settings-btn');
    if (tocBtn && tocDrawer) {
      tocBtn.addEventListener('click', () => {
        tocDrawer.hidden = !tocDrawer.hidden;
        if (settingsDrawer) settingsDrawer.hidden = true;
      }, { signal });
    }
    if (settingsBtn && settingsDrawer) {
      settingsBtn.addEventListener('click', () => {
        settingsDrawer.hidden = !settingsDrawer.hidden;
        if (tocDrawer) tocDrawer.hidden = true;
      }, { signal });
    }
    document.addEventListener('pointerdown', (event) => {
      for (const drawer of [tocDrawer, settingsDrawer]) {
        if (!drawer || drawer.hidden) continue;
        const opener = drawer === tocDrawer ? tocBtn : settingsBtn;
        if (!drawer.contains(event.target) && event.target !== opener && !(opener && opener.contains(event.target))) {
          drawer.hidden = true;
        }
      }
    }, { signal });

    // Settings wiring.
    const fontSmaller = root.querySelector('#reader-font-smaller');
    const fontLarger = root.querySelector('#reader-font-larger');
    const bumpFont = (delta) => {
      const next = clampReaderFontSize(Number(readPref(FONT_KEY, '100')) + delta);
      writePref(FONT_KEY, next);
      if (adapter) adapter.setFontSize(next);
    };
    if (fontSmaller) fontSmaller.addEventListener('click', () => bumpFont(-READER_FONT_STEP), { signal });
    if (fontLarger) fontLarger.addEventListener('click', () => bumpFont(READER_FONT_STEP), { signal });
    for (const btn of root.querySelectorAll('[data-reader-theme]')) {
      btn.addEventListener('click', () => {
        const name = normalizeReaderTheme(btn.getAttribute('data-reader-theme'));
        writePref(THEME_KEY, name);
        applyPaneTheme(name);
        if (adapter) adapter.setTheme(name);
      }, { signal });
    }

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
      listenBtn.addEventListener('click', () => startListenFromHere(root, listenBtn), { signal });
    }

    // Tap zones + keys.
    const tapPrev = root.querySelector('#reader-tap-prev');
    const tapNext = root.querySelector('#reader-tap-next');
    if (tapPrev) tapPrev.addEventListener('click', () => adapter && adapter.prev(), { signal });
    if (tapNext) tapNext.addEventListener('click', () => adapter && adapter.next(), { signal });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') { if (adapter) adapter.next(); }
      if (event.key === 'ArrowLeft') { if (adapter) adapter.prev(); }
    }, { signal });

    // Flush the pending position on backgrounding — keepalive so the write
    // survives the page going away (the background-lifecycle lesson).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') sendProgress(true);
    }, { signal });
    window.addEventListener('pagehide', () => sendProgress(true), { signal });

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
        const open = detail.format === 'pdf' ? openPdf : openEpub;
        return open(root, pane, detail, signal);
      })
      .then((created) => { adapter = created; })
      .catch((err) => {
        console.error('Reader: failed to open book:', err);
        setStatus(root, 'Could not open this book.');
      });
  }

  function destroy() {
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
    bookId = null;
    lastLocator = null;
  }

  if (window.FileTube && typeof window.FileTube.registerView === 'function') {
    window.FileTube.registerView('read', { init, destroy });
  }
})();
