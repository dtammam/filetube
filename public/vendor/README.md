# Vendored client libraries (v1.37.0 books)

Static CLIENT assets only — lazily loaded by the reader/books views, never
executed server-side (the repo's no-new-server-runtime-deps posture is
about the server; vendored client JS is the established precedent from
docs/mobile-custom-player-findings.md). Each dir carries the upstream
LICENSE verbatim. Update by re-downloading the pinned dist from jsdelivr
and bumping this table + the books-vendor-licenses source-lock test.

| Lib | Version | License | Files | Actual size |
|---|---|---|---|---|
| JSZip | 3.10.1 | MIT (dual MIT/GPLv3 — MIT taken) | jszip/jszip.min.js | 98 KB |
| epub.js | 0.3.93 | BSD-2-Clause ("Free BSD") | epubjs/epub.min.js | 224 KB |
| pdf.js (pdfjs-dist) | 4.10.38 | Apache-2.0 | pdfjs/pdf.min.mjs + pdfjs/pdf.worker.min.mjs | 353 KB + 1.4 MB |

Load order contract: JSZip MUST load before epub.js (its runtime
dependency). pdf.js is an ESM build — dynamic import()ed by read.js, with
the worker file served same-origin from this directory.
