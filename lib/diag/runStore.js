'use strict';

// lib/diag/runStore.js - persistence for the perf-diagnostics suite (branch
// exp/perf-diagnostics). A "run" is one labeled measurement session: the client
// collects Resource/Navigation timing + media events + active-probe results
// into localStorage across the guided scenario, then POSTs the whole thing ONCE
// at stop. We store it as a single JSON file per run under DATA_DIR/.diag, so a
// run is atomic to write (no server-side append races) and trivial to diff LAN
// vs VPN by hand or in the compare view.
//
// This whole module is inert in a normal build: server.js only wires the diag
// routes when FT_DIAG=1, so DATA_DIR/.diag is never created otherwise.

const MAX_RUN_BYTES = 8 * 1024 * 1024; // a few minutes of timing events is well under this; reject anything larger as a client bug

function createRunStore({ fs, path, diagDir }) {
  function ensureDir() {
    if (!fs.existsSync(diagDir)) fs.mkdirSync(diagDir, { recursive: true });
  }

  function runPath(id) {
    // id is server-minted (see save), so it is always a safe slug; still, never
    // let a caller-supplied id escape the dir.
    const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safe) throw new Error('bad run id');
    return path.join(diagDir, `run-${safe}.json`);
  }

  function mintId() {
    // sortable-by-time prefix + random tail, filesystem-safe.
    const ts = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
    const rand = Math.random().toString(36).slice(2, 8);
    return `${ts}-${rand}`;
  }

  // Persist a complete run. The client sends everything but the id/createdAt,
  // which we mint server-side so two devices can't collide and the file name is
  // always trustworthy.
  function save(runBody) {
    ensureDir();
    const id = mintId();
    const record = {
      id,
      createdAt: Date.now(),
      label: typeof runBody.label === 'string' ? runBody.label.slice(0, 120) : '',
      note: typeof runBody.note === 'string' ? runBody.note.slice(0, 2000) : '',
      client: runBody.client || {}, // userAgent, navigator.connection snapshot, screen, etc.
      scenarios: Array.isArray(runBody.scenarios) ? runBody.scenarios : [],
      events: Array.isArray(runBody.events) ? runBody.events : [],
      probes: runBody.probes && typeof runBody.probes === 'object' ? runBody.probes : {},
      summary: runBody.summary && typeof runBody.summary === 'object' ? runBody.summary : {},
    };
    const json = JSON.stringify(record);
    if (Buffer.byteLength(json) > MAX_RUN_BYTES) {
      const err = new Error('run payload too large');
      err.code = 'RUN_TOO_LARGE';
      throw err;
    }
    fs.writeFileSync(runPath(id), json);
    return record;
  }

  // Lightweight listing for the run browser: never reads the full events array
  // into the response (runs can be large), only the header fields + counts.
  function list() {
    ensureDir();
    const files = fs.readdirSync(diagDir).filter((f) => f.startsWith('run-') && f.endsWith('.json'));
    const out = [];
    for (const f of files) {
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(diagDir, f), 'utf8'));
        out.push({
          id: rec.id,
          createdAt: rec.createdAt,
          label: rec.label,
          note: rec.note,
          eventCount: Array.isArray(rec.events) ? rec.events.length : 0,
          scenarioCount: Array.isArray(rec.scenarios) ? rec.scenarios.length : 0,
          summary: rec.summary || {},
          probes: rec.probes || {},
        });
      } catch (_) {
        // a half-written or hand-edited file should not sink the whole listing
      }
    }
    out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return out;
  }

  function get(id) {
    const p = runPath(id);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  function remove(id) {
    const p = runPath(id);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      return true;
    }
    return false;
  }

  return { save, list, get, remove, mintId };
}

module.exports = { createRunStore, MAX_RUN_BYTES };
