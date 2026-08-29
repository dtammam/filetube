'use strict';

// [UNIT] Wave B - the PROVIDER-COVERAGE CENSUS. "Automatic" universal search
// is enforced-by-test: every browsable media LIBRARY (the KIND_TO_LIBRARY
// authority the RBAC layer already uses) must have a registered search
// provider. A future media type added to KIND_TO_LIBRARY without a provider
// goes RED here - the honest version of zero-code auto-discovery (Dean's
// approved framing). This is the coverage half; the LEAK half (a provider that
// skips its RBAC gate) is bound in rbac-census.test.js against the real app.

const { test } = require('node:test');
const assert = require('node:assert');
const { KIND_TO_LIBRARY } = require('../../lib/auth/visibility');
const { PROVIDERS, SEARCH_CHIPS } = require('../../lib/search/registry');

test('census: every media library (KIND_TO_LIBRARY) has >= 1 registered search provider', () => {
  const covered = new Set(PROVIDERS.map((p) => p.library));
  const libraries = new Set(Object.values(KIND_TO_LIBRARY));
  assert.ok(libraries.size >= 5, `expected the known libraries (video/music/podcasts/books/tv), saw ${[...libraries]}`);
  for (const lib of libraries) {
    assert.ok(covered.has(lib),
      `library '${lib}' has NO search provider - a browsable media type must be searchable (add one to lib/search/registry.js)`);
  }
});

test('census: every provider names a REAL library (no typo that would silently never match the authority)', () => {
  const libraries = new Set(Object.values(KIND_TO_LIBRARY));
  for (const p of PROVIDERS) {
    assert.ok(libraries.has(p.library), `provider '${p.type}' claims library '${p.library}' which is not in KIND_TO_LIBRARY`);
  }
});

test('census: every provider is well-formed (type, chip in SEARCH_CHIPS, search fn)', () => {
  const types = new Set();
  for (const p of PROVIDERS) {
    assert.ok(typeof p.type === 'string' && p.type !== '', 'has a type');
    assert.ok(!types.has(p.type), `duplicate provider type '${p.type}'`);
    types.add(p.type);
    assert.ok(SEARCH_CHIPS.includes(p.chip), `provider '${p.type}' chip '${p.chip}' is a valid chip`);
    assert.strictEqual(typeof p.search, 'function', `provider '${p.type}' has a search fn`);
  }
});

test('census: every SEARCH_CHIPS value is served by >= 1 provider (no dead chip)', () => {
  const served = new Set(PROVIDERS.map((p) => p.chip));
  for (const chip of SEARCH_CHIPS) {
    assert.ok(served.has(chip), `chip '${chip}' has no provider`);
  }
});
