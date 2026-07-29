'use strict';

// [INTEGRATION] v1.53 - manual channel attribution, against the REAL app:
// the attribute/clear endpoint (validation, sticky flag, unit writes), the
// targets picker, manual-wins across the scan's writers (consume bridge +
// re-init carry), the reheat conflict signal (Dean's "specific error so
// it's known"), and the bulk path incl. the background mover with collision
// counting. Divergent fixture spellings throughout.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-attrib-'));
delete process.env.FILETUBE_YTDLP_ENABLED;
delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const {
  app, saveDatabase, loadDatabase, updateDatabase, getMediaId, scanDirectories,
  recordRepulledItemMeta, scanState,
} = require('../../server');
const store = require('../../lib/ytdlp/store');
const activity = require('../../lib/ytdlp/activity');
const { authenticateFetch } = require('../helpers/auth');

let server;
let base;
let mediaDir;
let downloadDir;

before(async () => {
  mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-attrib-media-'));
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-attrib-dl-'));
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  authenticateFetch(server, base);
});

after(async () => {
  delete process.env.FILETUBE_YTDLP_ENABLED;
  delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  for (const d of [mediaDir, downloadDir]) fs.rmSync(d, { recursive: true, force: true });
});

async function waitForScanIdle(maxWaitMs = 10000) {
  const start = Date.now();
  while ((scanState.scanning || scanState.rescanRequested) && Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 25));
  }
}

function seedFile(dir, name) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, `bytes-of-${name}`);
  return filePath;
}

function baseItem(filePath, extra = {}) {
  const stats = fs.statSync(filePath);
  const id = getMediaId(filePath);
  return {
    id, name: path.basename(filePath), title: path.basename(filePath, path.extname(filePath)),
    filePath, folderName: path.basename(path.dirname(filePath)), size: stats.size,
    ext: path.extname(filePath), type: 'video', addedAt: stats.birthtimeMs || stats.mtimeMs,
    duration: 10, hasThumbnail: false, artist: '', ...extra,
  };
}

const TARGET = {
  channelUrl: 'https://www.youtube.com/channel/UCzzzzzzzzzzzzzzzzzzzzzz',
  channelName: 'Résurrected Chännel',
  channelId: 'UCzzzzzzzzzzzzzzzzzzzzzz',
  channelAvatarUrl: 'https://yt3.example/rez.jpg',
};

function postAttribute(id, body) {
  return fetch(`${base}/api/videos/${id}/attribute-channel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('attribute: identity lands as a UNIT with the sticky flag; validation refuses garbage; clear is manual-only', async () => {
  const filePath = seedFile(mediaDir, 'Orphan Vïdeo.mp4');
  const item = baseItem(filePath);
  saveDatabase({ folders: [mediaDir], folderSettings: {}, progress: {}, metadata: { [item.id]: item }, settings: { scanIntervalMinutes: 0, pruneMissing: false, cacheMaxBytes: null, cacheMaxAgeDays: 0, defaultView: '' } });

  // Garbage refused at the boundary.
  assert.equal((await postAttribute(item.id, { target: { channelUrl: 'javascript:alert(1)', channelName: 'X' } })).status, 400);
  assert.equal((await postAttribute(item.id, { target: { channelUrl: TARGET.channelUrl, channelName: '   ' } })).status, 400);
  assert.equal((await postAttribute('nonexistent-id', { target: TARGET })).status, 404);
  // Clearing a NON-manual item is refused (capture-derived identity is real data).
  assert.equal((await postAttribute(item.id, { clear: true })).status, 400);

  const res = await postAttribute(item.id, { target: TARGET });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.result, 'attributed');

  const stored = loadDatabase().metadata[item.id];
  assert.equal(stored.channelUrl, TARGET.channelUrl);
  assert.equal(stored.channelName, 'Résurrected Chännel');
  assert.equal(stored.channelId, TARGET.channelId);
  assert.equal(stored.channelAvatarUrl, TARGET.channelAvatarUrl);
  assert.equal(stored.channelAttributedManually, true);

  // Clear: manual -> identity unit gone, flag gone.
  const clearRes = await postAttribute(item.id, { clear: true });
  assert.equal(clearRes.status, 200);
  const cleared = loadDatabase().metadata[item.id];
  assert.equal(cleared.channelUrl, undefined);
  assert.equal(cleared.channelName, undefined);
  assert.equal(cleared.channelAttributedManually, undefined);
});

test('manual attribution SURVIVES the scan: unchanged rescan AND the changed-file re-init carry', async () => {
  const filePath = seedFile(mediaDir, 'Stïcky Video.mp4');
  const item = baseItem(filePath);
  await updateDatabase((db) => { db.metadata[item.id] = item; if (!db.folders.includes(mediaDir)) db.folders.push(mediaDir); });
  assert.equal((await postAttribute(item.id, { target: TARGET })).status, 200);

  await scanDirectories();
  await waitForScanIdle();
  let after = loadDatabase().metadata[item.id];
  assert.equal(after.channelAttributedManually, true, 'flag survives an unchanged rescan');
  assert.equal(after.channelUrl, TARGET.channelUrl);

  // Changed file (same path, new size) -> the re-init branch must carry it.
  fs.appendFileSync(filePath, 'grew');
  await scanDirectories();
  await waitForScanIdle();
  after = loadDatabase().metadata[item.id];
  assert.equal(after.channelAttributedManually, true, 'flag survives the re-init carry (seventh-strike class)');
  assert.equal(after.channelName, 'Résurrected Chännel');
});

test('manual wins over the consume bridge: a fresh capture cannot re-point a manual attribution', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const filePath = seedFile(downloadDir, 'Bracket Video [bbbbbbbbbbb].mp4');
    const item = baseItem(filePath);
    await updateDatabase((db) => { db.metadata[item.id] = item; });
    assert.equal((await postAttribute(item.id, { target: TARGET })).status, 200);

    // A capture arrives for its bracket id, naming a DIFFERENT channel, and
    // the file changes (so the consume guard's freshlyScannedIds fires).
    await updateDatabase((db) => {
      const ns = store.ensureYtdlp(db);
      ns.downloadMeta.bbbbbbbbbbb = {
        channelUrl: 'https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa',
        channelName: 'Nétwork Channel',
        // Gate round 2 (M5): the D1b lane's STANDALONE avatar write is only
        // reachable when the capture carries a thumbnail -- without this the
        // avatar guard was tested in name only (the reviewer's re-audit).
        channelThumbnail: 'https://yt3.example/network-face.jpg',
        sourceViewCount: 777,
        capturedAt: Date.UTC(2026, 5, 1),
      };
    });
    fs.appendFileSync(filePath, 'grew');
    await scanDirectories();
    await waitForScanIdle();

    const after = loadDatabase().metadata[item.id];
    assert.equal(after.channelUrl, TARGET.channelUrl, 'manual identity KEPT against a fresh capture');
    assert.equal(after.channelName, 'Résurrected Chännel');
    assert.equal(after.channelAvatarUrl, TARGET.channelAvatarUrl,
      'the D1b standalone avatar write declined the captured thumbnail (M5 -- the name-over-wrong-face chimera)');
    assert.equal(after.channelAttributedManually, true);
    assert.equal(after.sourceViewCount, 777, 'non-identity capture facts still land');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('gate round (M2/M3/M5): the UNIVERSAL and D1a consume lanes + the avatar write all decline a manual attribution', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    // Universal lane (M2): channelName guard.
    const uBase = 'Ünivers Video [Vimeo=8675309].mp4';
    const uPath = seedFile(downloadDir, uBase);
    const uItem = baseItem(uPath);
    await updateDatabase((db) => { db.metadata[uItem.id] = uItem; });
    assert.equal((await postAttribute(uItem.id, { target: TARGET })).status, 200);
    await updateDatabase((db) => {
      const ns = store.ensureYtdlp(db);
      ns.downloadMeta[uBase] = { universal: true, sourceExtractor: 'Vimeo', sourceId: '8675309', channelName: 'Vïmeo Studio', capturedAt: Date.UTC(2026, 5, 2) };
    });
    fs.appendFileSync(uPath, 'grew');

    // D1a proxy-host lane (M3+M5): full identity + avatar guards.
    const dBase = 'Prôxy Video [Youtube=ccccccccccc].mp4';
    const dPath = seedFile(downloadDir, dBase);
    const dItem = baseItem(dPath);
    await updateDatabase((db) => { db.metadata[dItem.id] = dItem; });
    assert.equal((await postAttribute(dItem.id, { target: TARGET })).status, 200);
    await updateDatabase((db) => {
      const ns = store.ensureYtdlp(db);
      ns.downloadMeta.ccccccccccc = {
        channelUrl: 'https://www.youtube.com/channel/UCbbbbbbbbbbbbbbbbbbbbbb',
        channelName: 'Prôxy Channel',
        channelThumbnail: 'https://yt3.example/proxy.jpg',
        capturedAt: Date.UTC(2026, 5, 2),
      };
    });
    fs.appendFileSync(dPath, 'grew');

    await scanDirectories();
    await waitForScanIdle();

    const uAfter = loadDatabase().metadata[uItem.id];
    assert.equal(uAfter.channelName, 'Résurrected Chännel', 'universal capture channelName declined (M2)');
    assert.equal(uAfter.sourceExtractor, 'Vimeo', 'non-identity universal facts still land');
    const dAfter = loadDatabase().metadata[dItem.id];
    assert.equal(dAfter.channelUrl, TARGET.channelUrl, 'D1a identity declined (M3)');
    assert.equal(dAfter.channelAvatarUrl, TARGET.channelAvatarUrl, 'D1a avatar declined (M5)');
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('gate round: bulk root CONFINEMENT (C2) + preview (C3) + relocateSkipped when the module is off (M17)', async () => {
  // An unconfined ancestor of the library roots swept the reviewer's entire
  // fixture library into one channel folder -- the exact request now 400s.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-attrib-outside-'));
  const sweep = await fetch(`${base}/api/videos/attribute-channel-bulk`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: path.dirname(mediaDir), target: TARGET, relocate: true }),
  });
  assert.equal(sweep.status, 400, 'an ancestor-of-roots selector is refused');
  assert.equal((await fetch(`${base}/api/videos/attribute-channel-bulk`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: outside, target: TARGET }),
  })).status, 400, 'a path outside every library root is refused');
  fs.rmSync(outside, { recursive: true, force: true });

  // Preview: counts without writing.
  const pvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-attrib-pv-'));
  const f1 = seedFile(pvDir, 'Prevïew One.mp4');
  const it1 = baseItem(f1);
  await updateDatabase((db) => {
    db.metadata[it1.id] = it1;
    if (!db.folders.includes(pvDir)) db.folders.push(pvDir);
  });
  const pv = await (await fetch(`${base}/api/videos/attribute-channel-bulk`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: pvDir, target: TARGET, relocate: true, preview: true }),
  })).json();
  assert.equal(pv.preview, true);
  assert.equal(pv.matched, 1);
  assert.equal(loadDatabase().metadata[it1.id].channelAttributedManually, undefined, 'preview wrote NOTHING');

  // M17: module off -> attribute succeeds, relocation honestly skipped.
  const run = await (await fetch(`${base}/api/videos/attribute-channel-bulk`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: pvDir, target: TARGET, relocate: true }),
  })).json();
  assert.equal(run.attributed, 1);
  assert.equal(run.relocating, false);
  assert.equal(run.relocateSkipped, 'module-disabled', 'the skip reason is NAMED, never silent');
  fs.rmSync(pvDir, { recursive: true, force: true });
});

test('gate round 2 (M21/M24-half): the single-flight latch 409s a second bulk; cancel answers honestly when nothing runs', async () => {
  const { __setAttributeBulkInProgressForTests } = require('../../server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-attrib-latch-'));
  await updateDatabase((db) => { if (!db.folders.includes(dir)) db.folders.push(dir); });
  try {
    __setAttributeBulkInProgressForTests(true);
    const res = await fetch(`${base}/api/videos/attribute-channel-bulk`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: dir, target: TARGET, relocate: false }),
    });
    assert.equal(res.status, 409, 'a second bulk while one runs is refused (single-flight)');
    assert.equal((await res.json()).alreadyRunning, true);
  } finally {
    __setAttributeBulkInProgressForTests(false);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const cancelIdle = await (await fetch(`${base}/api/videos/attribute-channel-bulk/cancel`, { method: 'POST' })).json();
  assert.deepEqual(cancelIdle, { cancelled: false, running: false }, 'cancel never claims to have cancelled work that was not running');
});

test('gate round 2 (M23): a re-run RESUMES - an attributed-but-unmoved item is counted and moved', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const resumeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-attrib-resume-'));
    const fp = seedFile(resumeDir, 'Strandéd After Crash.mp4');
    // The crash shape: attributed to TARGET (flag set), file still outside
    // the channel folder -- exactly what a mid-loop restart leaves behind.
    const it = baseItem(fp, { ...{
      channelUrl: TARGET.channelUrl, channelName: TARGET.channelName,
      channelId: TARGET.channelId, channelAttributedManually: true,
    } });
    await updateDatabase((db) => {
      db.metadata[it.id] = it;
      if (!db.folders.includes(resumeDir)) db.folders.push(resumeDir);
      const ns = store.ensureYtdlp(db);
      if (!ns.subscriptions.some((s) => s.channelUrl === TARGET.channelUrl)) {
        ns.subscriptions.push({ id: 'subRez2', channelUrl: TARGET.channelUrl, channelId: TARGET.channelId, name: 'Résurrected Chännel', order: 10 });
      }
    });

    const pv = await (await fetch(`${base}/api/videos/attribute-channel-bulk`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: resumeDir, target: TARGET, relocate: true, preview: true }),
    })).json();
    assert.equal(pv.resuming, 1, 'the preview names the stranded item as resumable');

    const run = await (await fetch(`${base}/api/videos/attribute-channel-bulk`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: resumeDir, target: TARGET, relocate: true }),
    })).json();
    assert.equal(run.resuming, 1);
    assert.equal(run.relocating, true);

    const start = Date.now();
    let entry = null;
    while (Date.now() - start < 10000) {
      entry = activity.getSnapshot().oneShots && activity.getSnapshot().oneShots['attribute-bulk'];
      if (entry && (entry.state === 'done' || entry.state === 'error')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(entry.state, 'done');
    assert.equal(entry.moved, 1, 'the stranded file finished its move on the re-run');
    const moved = Object.values(loadDatabase().metadata).find((x) => x && x.name === 'Strandéd After Crash.mp4');
    assert.ok(!moved.filePath.startsWith(resumeDir), 'physically out of the stranded location');
    fs.rmSync(resumeDir, { recursive: true, force: true });
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});

test('reheat conflict (decision 3): manual kept, conflict REPORTED via the out-field; same-channel gap-fill declines manual items', async () => {
  const filePath = seedFile(mediaDir, 'Cönflict Video.mp4');
  const item = baseItem(filePath);
  await updateDatabase((db) => { db.metadata[item.id] = item; });
  assert.equal((await postAttribute(item.id, { target: TARGET })).status, 200);

  // Network resolves a DIFFERENT channel.
  const meta = {
    channel: { channelUrl: 'https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa', channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', channelName: 'Nétwork Channel' },
    channelAvatarUrl: 'https://yt3.example/net.jpg',
    filePath, markComplete: true,
  };
  const persisted = await recordRepulledItemMeta({ loadDatabase, updateDatabase, getMediaId }, item.id, meta, Date.now());
  assert.equal(persisted, true);
  const after = loadDatabase().metadata[item.id];
  assert.equal(after.channelUrl, TARGET.channelUrl, 'manual identity untouched');
  assert.equal(after.channelAvatarUrl, TARGET.channelAvatarUrl, 'manual avatar untouched');
  assert.ok(meta.attributionConflict, 'the conflict is REPORTED, never silent');
  assert.equal(meta.attributionConflict.kept, 'Résurrected Chännel');
  assert.equal(meta.attributionConflict.discovered, 'Nétwork Channel');

  // Same channel -> no conflict, and gap-fill still declines a manual item.
  const metaSame = {
    channel: { channelUrl: TARGET.channelUrl, channelId: TARGET.channelId, channelName: 'Rénamed Later', channelHandleUrl: 'https://www.youtube.com/@rez' },
    filePath, markComplete: true,
  };
  await recordRepulledItemMeta({ loadDatabase, updateDatabase, getMediaId }, item.id, metaSame, Date.now());
  const after2 = loadDatabase().metadata[item.id];
  assert.equal(metaSame.attributionConflict, undefined, 'same channel is not a conflict');
  assert.equal(after2.channelName, 'Résurrected Chännel', 'manual name not rewritten by same-channel gap-fill');
  assert.equal(after2.channelHandleUrl, undefined, 'no uninvited gap-fill onto a manual unit');
});

test('attribution targets: subscriptions + library identity groups, deduped, sorted', async () => {
  await updateDatabase((db) => {
    const ns = store.ensureYtdlp(db);
    ns.subscriptions.push({ id: 'subX', channelUrl: 'https://www.youtube.com/@zébra', name: 'Zébra Films', order: 0, channelAvatarUrl: 'https://yt3.example/z.jpg' });
    // A library-only identity group (dead channel, previously attributed).
    const fp = seedFile(mediaDir, 'Old Attributed.mp4');
    const it = baseItem(fp, { channelUrl: 'https://www.youtube.com/channel/UCdddddddddddddddddddddd', channelName: 'Äncient Channel', channelId: 'UCdddddddddddddddddddddd' });
    db.metadata[it.id] = it;
  });
  const { targets } = await (await fetch(`${base}/api/attribution-targets`)).json();
  const names = targets.map((t) => t.channelName);
  assert.ok(names.includes('Zébra Films'), 'subscription target present');
  assert.ok(names.includes('Äncient Channel'), 'library identity group present');
  assert.ok(names.includes('Résurrected Chännel'), 'a manually-created identity becomes a reusable target');
  const sorted = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  assert.deepEqual(names, sorted, 'sorted by name');
});

test('bulk: unattributed items under root get the identity; attributed items are never re-pointed; relocate moves with collision counting', async () => {
  process.env.FILETUBE_YTDLP_ENABLED = 'true';
  process.env.FILETUBE_YTDLP_DOWNLOAD_DIR = downloadDir;
  try {
    const bulkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-attrib-bulk-'));
    const fpA = seedFile(bulkDir, 'Bulk Ä.mp4');
    const fpB = seedFile(bulkDir, 'Bulk B.mp4');
    const fpC = seedFile(bulkDir, 'Bulk C attributed.mp4');
    const a = baseItem(fpA); const b = baseItem(fpB);
    const c = baseItem(fpC, { channelUrl: 'https://www.youtube.com/channel/UCeeeeeeeeeeeeeeeeeeeeee', channelName: 'Kéep Me', channelAttributedManually: true });
    await updateDatabase((db) => {
      db.metadata[a.id] = a; db.metadata[b.id] = b; db.metadata[c.id] = c;
      if (!db.folders.includes(bulkDir)) db.folders.push(bulkDir);
      const ns = store.ensureYtdlp(db);
      // A subscription matching the target -> the channel dir resolves
      // deterministically under the download root.
      if (!ns.subscriptions.some((s) => s.channelUrl === TARGET.channelUrl)) {
        ns.subscriptions.push({ id: 'subRez', channelUrl: TARGET.channelUrl, channelId: TARGET.channelId, name: 'Résurrected Chännel', order: 9 });
      }
    });

    // Pre-place a collision: a file with Bulk Ä's name already at the destination.
    const ytdlpMod = require('../../lib/ytdlp');
    const destDir = ytdlpMod.resolveChannelDirForChannel(loadDatabase(), ytdlpMod.parseYtdlpConfig(), TARGET);
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(path.join(destDir, 'Bulk Ä.mp4'), 'occupied');

    const res = await fetch(`${base}/api/videos/attribute-channel-bulk`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: bulkDir, target: TARGET, relocate: true }),
    });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.attributed, 2, 'both unattributed items attributed; the attributed one untouched');

    // Wait for the background mover's one-shot to reach a terminal state.
    const start = Date.now();
    let entry = null;
    while (Date.now() - start < 10000) {
      entry = activity.getSnapshot().oneShots && activity.getSnapshot().oneShots['attribute-bulk'];
      if (entry && (entry.state === 'done' || entry.state === 'error')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(entry, 'the bulk one-shot exists');
    assert.equal(entry.state, 'done');
    assert.equal(entry.moved, 1, 'B moved');
    assert.equal(entry.collisions, 1, 'Ä counted as a collision, not an error');
    assert.equal(entry.failed, 0);

    const db = loadDatabase();
    const movedItem = Object.values(db.metadata).find((it) => it.name === 'Bulk B.mp4');
    assert.ok(movedItem.filePath.startsWith(destDir), 'B physically lives under the channel dir');
    assert.equal(movedItem.channelAttributedManually, true, 'the flag rode the move (re-key carry)');
    const keptC = Object.values(db.metadata).find((it) => it.name === 'Bulk C attributed.mp4');
    assert.equal(keptC.channelName, 'Kéep Me', 'bulk never re-points an attributed item');
    fs.rmSync(bulkDir, { recursive: true, force: true });
  } finally {
    delete process.env.FILETUBE_YTDLP_ENABLED;
    delete process.env.FILETUBE_YTDLP_DOWNLOAD_DIR;
  }
});
