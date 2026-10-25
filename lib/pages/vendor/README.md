# lib/pages/vendor - Mozilla Readability, vendored

FileTube does not install npm packages for runtime code (Dean's ruling P14, v1.395.0). These three files are
the one exception so far, judged against the vendoring rule in `docs/ARCHITECTURE.md` ("Vendored code"): a core
capability (finding the article in a web page) we could not write and maintain at the same quality, plain
JavaScript with no dependencies of its own (zero `require(` calls), stable (0.4.0 2020-12-23, 0.5.0 2023-12-15,
0.6.0 2025-03-03), compatible licenses.

| File | Upstream | License | sha256 |
|------|----------|---------|--------|
| `Readability.js` | `@mozilla/readability` 0.6.0 | Apache-2.0 | `34dcab3d0832d0019f02990eed6b6124e029e8c32b9f0c6f2550544ff8dff174` |
| `JSDOMParser.js` | `@mozilla/readability` 0.6.0 | MPL-2.0 (file-level; the header stays) | `6b8eae46939f187ef4565c67f452a9098211daea80e50c9aea74d72015b73680` |
| `Readability-readerable.js` | `@mozilla/readability` 0.6.0 | Apache-2.0 | `a98d28805804c1986ceed470678a3f409f150ee7f1d227f8c8239c005d21de65` |

- Source: `https://registry.npmjs.org/@mozilla/readability/-/readability-0.6.0.tgz`, read 2026-10-25
  (project: `https://github.com/mozilla/readability`). `LICENSE-readability.md` is the package's `LICENSE.md`.
- The files are **unmodified**. `test/unit/pages-vendor.test.js` fails if a file's sha256 drifts from this
  table, if a file appears here that the table does not list, or if a file gains a `require(`. Every local
  behaviour lives in our wrappers: `lib/pages/tidy.js` (JSDOMParser needs well-formed markup, so every input is
  tidied first) and `lib/pages/extract.js` (options, metadata fill-in). ESLint skips this folder
  (`eslint.config.js`); the upstream code follows its own style.

## Updating

1. Download the new tarball from the registry, read its `package.json` (still no `dependencies`), its
   CHANGELOG, and every changed line of the three files.
2. Copy the three files here unmodified, update the table (version, date, each sha256 from `sha256sum`).
3. Run `test/unit/pages-vendor.test.js` and the fixture corpus (`test/unit/pages-extract.test.js`), and
   compare the per-page results with the plan's Evidence of the release that last touched this folder.
4. The release that updates the files goes through the full gate (third-party code, scrutiny.toml).
