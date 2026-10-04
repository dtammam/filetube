'use strict';
// v1.362 minimize probes: the hold-lock proof server (real server, throwaway DATA_DIR, one VP8 clip, one WAV)
// plus a SECOND video item (clip2, the same file) so a watch -> watch history can be driven.
//   const { start } = require('./serve'); const s = await start(); ... await s.stop();
const base = require('../hold-lock-proof/serve');

async function start(opts) {
  const s = await base.start(opts);
  const server = require('../../server');
  await server.updateDatabase((db) => {
    const c1 = db.metadata.clip1;
    db.metadata.clip2 = Object.assign({}, c1, { id: 'clip2', title: 'Proof Clip Two', addedAt: c1.addedAt + 2 });
    return true;
  });
  return s;
}

module.exports = { start };
