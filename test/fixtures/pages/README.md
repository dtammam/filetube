# Pages fixture corpus (v1.395.0)

Real pages saved as raw HTML, the input `test/unit/pages-extract.test.js` runs through BOTH capture paths (the
server's tidy + extract, and the browser-serialized form a device sends, made here by jsdom's `XMLSerializer`).
`corpus.json` names each page's kind and the expectations: title, author and published date from the source's
own expected metadata where it has one, a word-count range, and sentences the Reader text must contain.

Sources and licenses:

- `bbc-1`, `wapo-1`, `medium-1`, `dropbox-blog`, `daringfireball-1`, `quanta-1`, `keep-tabular-data`, `v8-blog`,
  `google-sre-book-1`, `lazy-image-1`, `lemonde-1`, `hukumusume`: the `source.html` of the same-named page in
  Mozilla Readability's own test corpus (`https://github.com/mozilla/readability`, tag 0.6.0,
  `test/test-pages/<name>/`), redistributed there as test fixtures; the expectations come from that page's
  `expected-metadata.json` and `expected.html`, so they are independent of our code.
- `cern`: the first website, `http://info.cern.ch/hypertext/WWW/TheProject.html` (CERN, 1992 markup; no `<html>`
  or `<body>`, unclosed `<P>`, unquoted attributes), captured 2026-10-25.
- `govuk-home`: `https://www.gov.uk/` (Open Government Licence v3.0), captured 2026-10-25: a non-article page.
- `mdn-table`: `https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/table` (MDN Web Docs, CC BY-SA
  2.5), captured 2026-10-25: docs with tables and code.

The "Substack-style newsletter" kind of the plan is `medium-1`, a hosted-newsletter platform page of the same
shape (one post, the platform's chrome around it); no Substack page is redistributable under a license that
allows it here.
