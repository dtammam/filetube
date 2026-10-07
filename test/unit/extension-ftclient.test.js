'use strict';

// [UNIT] v1.370.0 (gate r1 adversary S8): the browser extension's pure client tests (extension/ftClient.test.js)
// ran only by hand, so the one-video strip and the playlist reply had no CI binding. Loading the file here
// registers its tests in `npm test` (they import extension/ftClient.js, an ES module, themselves).
require('../../extension/ftClient.test.js');
