'use strict';

// [INTEGRATION] T5 -- the /subscriptions page route + its client controller
// route (both registered inside `registerRoutes`'s `isEnabled` gate,
// lib/ytdlp/index.js), and the full UI-facing endpoint flow they bind to.
//
// AC3 (disabled ⇒ page + client asset + nav-probe all structurally ABSENT,
// not CSS-hidden -- D4) and AC32 (enabled ⇒ the routes serve real content and
// the endpoints the client calls work end-to-end) are both proven here.
//
// Uses the SAME bare-express + `registerRoutes(app, deps, config)` pattern
// already established by test/integration/ytdlp-disabled-noop.test.js's
// on/off toggle test and ytdlp-repull-endpoints.test.js, rather than
// requiring the real server.js (which fixes its config at require time) --
// this lets one file prove both the disabled and enabled configs with no
// env-var/module-reload tricks. `run.runList`/`run.runDownload` are mocked
// for the re-pull assertions -- no real yt-dlp binary or network is ever
// touched (mirrors ytdlp-repull-endpoints.test.js's convention).

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const express = require('express');

const ytdlp = require('../../lib/ytdlp');
const run = require('../../lib/ytdlp/run');

const originalRunList = run.runList;
const originalRunDownload = run.runDownload;

afterEach(() => {
  run.runList = originalRunList;
  run.runDownload = originalRunDownload;
  ytdlp.armYtdlpTimer(ytdlp.parseYtdlpConfig({})); // clear any armed timer between tests
});

function makeFakeDeps() {
  const db = {};
  return {
    loadDatabase: () => db,
    updateDatabase: (mutatorFn) => Promise.resolve(mutatorFn(db)),
    scanDirectories: async () => {},
    getMediaId: (input) => crypto.createHash('md5').update(String(input)).digest('hex'),
  };
}

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

function staticMiddleware() {
  // Mirrors server.js's real express.static mount (server.js:1238) exactly,
  // including the no-cache header -- used to prove express.static alone
  // cannot serve the gated page/client script regardless of enable state.
  return express.static(PUBLIC_DIR, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  });
}

async function bootApp({ config, deps, withRegisterRoutes = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use(staticMiddleware());
  if (withRegisterRoutes) {
    ytdlp.registerRoutes(app, deps || makeFakeDeps(), config);
  }
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const disabledConfig = ytdlp.parseYtdlpConfig({});

function enabledConfig(tmpDir, overrides = {}) {
  return ytdlp.parseYtdlpConfig({
    FILETUBE_YTDLP_ENABLED: 'true',
    FILETUBE_YTDLP_POLL_MINUTES: '0',
    FILETUBE_YTDLP_DOWNLOAD_DIR: tmpDir,
    ...overrides,
  });
}

// ---- AC3: disabled ⇒ page route + client script route + nav-probe absent --

test('AC3: GET /subscriptions 404s when the module is disabled', async () => {
  const { base, close } = await bootApp({ config: disabledConfig });
  try {
    const res = await fetch(`${base}/subscriptions`);
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});

test('AC3: GET /js/subscriptions.js 404s when the module is disabled', async () => {
  const { base, close } = await bootApp({ config: disabledConfig });
  try {
    const res = await fetch(`${base}/js/subscriptions.js`);
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});

test('AC3: the nav-injection capability probe 404s when disabled, so common.js\'s shouldInjectSubscriptionsNav injects nothing', async () => {
  const { base, close } = await bootApp({ config: disabledConfig });
  try {
    const res = await fetch(`${base}/api/subscriptions/health`);
    assert.equal(res.status, 404);
    // The client-side decision this drives (public/js/common.js's
    // shouldInjectSubscriptionsNav) is unit-tested directly in
    // test/unit/ytdlp-nav-injection.test.js -- a 404 there resolves to
    // `false`, i.e. no link is ever added to the DOM.
  } finally {
    await close();
  }
});

// ---- T5: disabled ⇒ the new one-shot/edit/status surfaces the UI drives ---
// are ALSO absent (native 404), same as every other route above. AC1-3/25/32
// are asserted end-to-end at the endpoint level in ytdlp-disabled-noop.test.js
// -- this re-asserts them here too, grouped with the rest of the UI-facing
// route inventory this file owns, so a T5 regression (e.g. a route
// accidentally registered outside the `isEnabled` gate while wiring the new
// forms) fails loudly in the same file that proves the page itself is gated.

test('T5/AC1,3,25,32: the new one-shot/edit/status endpoints the UI forms call are ALL 404 when disabled', async () => {
  const { base, close } = await bootApp({ config: disabledConfig });
  try {
    const oneShot = await fetch(`${base}/api/ytdlp/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ' }),
    });
    assert.equal(oneShot.status, 404, 'POST /api/ytdlp/download (one-shot form) must 404 when disabled');

    const patch = await fetch(`${base}/api/subscriptions/some-id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: true }),
    });
    assert.equal(patch.status, 404, 'PATCH /api/subscriptions/:id (pause/edit) must 404 when disabled');

    const status = await fetch(`${base}/api/subscriptions/status`);
    assert.equal(status.status, 404, 'GET /api/subscriptions/status (live poll) must 404 when disabled');
  } finally {
    await close();
  }
});

test('AC3: express.static ALONE (no registerRoutes call at all) can never serve the page or the client script', async () => {
  const { base, close } = await bootApp({ withRegisterRoutes: false });
  try {
    const page = await fetch(`${base}/subscriptions`);
    assert.equal(page.status, 404);
    const script = await fetch(`${base}/js/subscriptions.js`);
    assert.equal(script.status, 404);
  } finally {
    await close();
  }
});

test('AC3: the page + client source files are not present under public/ (structural guarantee), and DO exist where the gated routes serve them from', () => {
  assert.equal(fs.existsSync(path.join(PUBLIC_DIR, 'subscriptions.html')), false);
  assert.equal(fs.existsSync(path.join(PUBLIC_DIR, 'js', 'subscriptions.js')), false);
  assert.equal(
    fs.existsSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'views', 'subscriptions.html')),
    true
  );
  assert.equal(
    fs.existsSync(path.join(__dirname, '..', '..', 'lib', 'ytdlp', 'client', 'subscriptions.js')),
    true
  );
});

// ---- AC32: enabled ⇒ the page + client JS serve, wired to the real endpoints --

test('AC32: GET /subscriptions serves the page HTML when enabled, referencing the gated client script + its controls', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-ui-'));
  const { base, close } = await bootApp({ config: enabledConfig(tmpDir) });
  try {
    const res = await fetch(`${base}/subscriptions`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /html/);
    const body = await res.text();
    assert.match(body, /\/js\/subscriptions\.js/, 'page must load the gated client controller');
    assert.match(body, /sub-list-container/, 'page must contain the list container the client renders into');
    assert.match(body, /sub-add-url/, 'page must contain the add-subscription form');
    assert.match(body, /sub-add-format/, 'page must contain the audio/video format control');
    assert.match(body, /sub-members-only-check/, 'page must contain the members-only toggle');
    assert.match(body, /sub-repull-all-btn/, 'page must contain the re-pull-all control');

    // T5/FR-B: the free-text quality input is gone -- a dropdown with the
    // full args.QUALITY_ALLOWLIST is present instead (AC14).
    assert.doesNotMatch(body, /id="sub-add-quality"[^>]*type="text"/, 'the quality field must be a <select>, not a free-text input');
    assert.match(body, /<select id="sub-add-quality"/, 'the subscription add form must present quality as a dropdown (AC14)');
    for (const quality of ['best', '2160p', '1440p', '1080p', '720p', '480p', '360p']) {
      assert.match(body, new RegExp(`<option value="${quality}"`), `sub-add-quality must offer ${quality}`);
    }

    // T5/FR-C: per-channel maxVideos input.
    assert.match(body, /sub-add-maxvideos/, 'page must contain the per-channel maxVideos input (FR-C)');

    // T5/FR-A: the one-shot form (paste-URL + format/quality dropdowns).
    assert.match(body, /oneshot-url/, 'page must contain the one-shot URL field (AC13/15)');
    assert.match(body, /oneshot-format/, 'page must contain the one-shot format dropdown (AC15)');
    assert.match(body, /oneshot-quality/, 'page must contain the one-shot quality dropdown (AC15)');
    assert.match(body, /oneshot-download-btn/, 'page must contain the one-shot submit control');
    assert.match(body, /oneshot-list-container/, 'page must contain the one-shot live-status list container');

    // v1.13.0 item 4 (AC13/17): the filetype/container dropdown is present
    // on BOTH the add-subscription form and the one-shot form, defaulting to
    // the video option set (mp4 selected) to match each form's default
    // format select.
    assert.match(body, /<select id="sub-add-filetype"/, 'the subscription add form must present a filetype/container dropdown');
    assert.match(body, /<select id="oneshot-filetype"/, 'the one-shot form must present a filetype/container dropdown');
    for (const filetype of ['mp4', 'mkv', 'webm', 'default']) {
      assert.match(body, new RegExp(`<option value="${filetype}"`), `sub-add-filetype/oneshot-filetype must offer ${filetype}`);
    }
  } finally {
    await close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('AC32: GET /js/subscriptions.js serves the client controller as javascript when enabled', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-ui-'));
  const { base, close } = await bootApp({ config: enabledConfig(tmpDir) });
  try {
    const res = await fetch(`${base}/js/subscriptions.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /javascript/);
    const body = await res.text();
    assert.match(body, /createSubscriptionRow/);
    assert.match(body, /createOneShotRow/, 'T5: the one-shot job row builder must be present');
    assert.match(body, /formatLiveStatusText/, 'T5: the live status-poll formatter must be present');
    assert.match(body, /textContent/);
    // v1.13.0 item 4: the format-dependent filetype select builder/reducer
    // must be present in the served client bundle.
    assert.match(body, /buildFiletypeSelect/, 'the filetype/container select builder must be present');
    assert.match(body, /reduceFiletypeOptions/, 'the format->filetype repopulation reducer must be present');
    // No LIVE (non-comment) `.innerHTML =` assignment anywhere in the served
    // file -- the hard XSS bar from the shipped v1.11.0 /subscriptions page,
    // now covering the new one-shot/edit/pause code paths too.
    assert.doesNotMatch(body.replace(/\/\/.*$/gm, ''), /\.innerHTML\s*=/, 'no live code path may assign innerHTML');
  } finally {
    await close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('AC32: the full UI flow works end-to-end against the real routes -- list/add/members-toggle/re-pull-one/re-pull-all/delete', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-ui-'));
  const deps = makeFakeDeps();

  run.runList = async () => ({ ok: true, stdout: '', stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const { base, close } = await bootApp({ config: enabledConfig(tmpDir), deps });
  try {
    // list starts empty (the client's initial loadSubscriptions() call)
    let list = await (await fetch(`${base}/api/subscriptions`)).json();
    assert.deepEqual(list, []);

    // add (the client's add form posts exactly this shape)
    const addRes = await fetch(`${base}/api/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelUrl: 'https://www.youtube.com/@somechannel', format: 'audio', quality: 'best' }),
    });
    assert.equal(addRes.status, 201);
    const added = await addRes.json();
    assert.equal(added.format, 'audio');
    assert.equal(added.quality, 'best');

    list = await (await fetch(`${base}/api/subscriptions`)).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, added.id);

    // reject a malformed add (the client surfaces `data.error` as textContent)
    const badAddRes = await fetch(`${base}/api/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelUrl: 'not a url', format: 'video' }),
    });
    assert.equal(badAddRes.status, 400);
    assert.ok((await badAddRes.json()).error);

    // members-only settings toggle (the client's checkbox: default false -> true)
    let settings = await (await fetch(`${base}/api/subscriptions/settings`)).json();
    assert.equal(settings.allowMembersOnly, false);
    const setRes = await fetch(`${base}/api/subscriptions/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowMembersOnly: true }),
    });
    assert.equal(setRes.status, 200);
    settings = await (await fetch(`${base}/api/subscriptions/settings`)).json();
    assert.equal(settings.allowMembersOnly, true);

    // re-pull-one (the client's per-row button)
    const repullOneRes = await fetch(`${base}/api/subscriptions/${added.id}/repull`, { method: 'POST' });
    assert.equal(repullOneRes.status, 202);

    // re-pull-all (the client's global button)
    const repullAllRes = await fetch(`${base}/api/subscriptions/repull`, { method: 'POST' });
    assert.equal(repullAllRes.status, 202);

    // give the fire-and-forget mocked polls a moment to run + persist status
    await new Promise((resolve) => setTimeout(resolve, 50));
    list = await (await fetch(`${base}/api/subscriptions`)).json();
    assert.equal(list[0].lastStatus, 'ok: no new videos');

    // delete (the client's per-row delete button, after window.confirm)
    const delRes = await fetch(`${base}/api/subscriptions/${added.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);

    list = await (await fetch(`${base}/api/subscriptions`)).json();
    assert.deepEqual(list, []);

    // 404 for the now-deleted subscription's re-pull-one (client surfaces this too)
    const repullDeletedRes = await fetch(`${base}/api/subscriptions/${added.id}/repull`, { method: 'POST' });
    assert.equal(repullDeletedRes.status, 404);
  } finally {
    await close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---- T5: the NEW form flows (maxVideos, pause/edit, one-shot, live status) --
//
// Exercises the exact request shapes `lib/ytdlp/client/subscriptions.js`'s
// add form / edit panel / pause toggle / one-shot form send, end-to-end
// against the real registered routes -- proves the UI and the server-side
// contract (T3) actually agree, not just that each side is unit-tested in
// isolation.

test('T5: add with maxVideos, pause/resume toggle, inline edit (PATCH), one-shot download, and the status snapshot all work end-to-end', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filetube-ytdlp-ui-'));
  const deps = makeFakeDeps();

  run.runList = async () => ({ ok: true, stdout: '', stderr: '' });
  run.runDownload = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });

  const { base, close } = await bootApp({ config: enabledConfig(tmpDir), deps });
  try {
    // Add form: channelUrl + format/quality/filetype DROPDOWN values + maxVideos
    // -- v1.13.0 item 4's `filetype` field is now part of the exact body
    // shape the add form composes (lib/ytdlp/client/subscriptions.js).
    const addRes = await fetch(`${base}/api/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelUrl: 'https://www.youtube.com/@somechannel',
        format: 'video',
        quality: '720p',
        filetype: 'mkv',
        maxVideos: 10,
      }),
    });
    assert.equal(addRes.status, 201);
    const added = await addRes.json();
    assert.equal(added.quality, '720p');
    assert.equal(added.filetype, 'mkv', 'the add form\'s filetype selection must persist on the created subscription');
    assert.equal(added.maxVideos, 10);
    assert.equal(added.paused, false, 'a fresh subscription must default to unpaused (FR-D backfill)');

    // Pause toggle: the row's Pause button sends exactly `{ paused: true }`.
    const pauseRes = await fetch(`${base}/api/subscriptions/${added.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: true }),
    });
    assert.equal(pauseRes.status, 200);
    assert.equal((await pauseRes.json()).paused, true);

    // Inline edit panel's Save sends format/quality/filetype (always) +
    // maxVideos (only when the input was non-blank) -- other fields
    // (addedAt, lastCheckedAt, lastStatus, paused) must be preserved
    // untouched (AC21). filetype='mp3' is valid for the new format='audio'.
    const editRes = await fetch(`${base}/api/subscriptions/${added.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'audio', quality: 'best', filetype: 'mp3', maxVideos: 3 }),
    });
    assert.equal(editRes.status, 200);
    const edited = await editRes.json();
    assert.equal(edited.format, 'audio');
    assert.equal(edited.quality, 'best');
    assert.equal(edited.filetype, 'mp3', 'the edit panel\'s filetype selection must persist (AC17)');
    assert.equal(edited.maxVideos, 3);
    assert.equal(edited.paused, true, 'the earlier pause must survive an edit that does not touch it (AC21)');
    assert.equal(edited.channelUrl, added.channelUrl);
    assert.equal(edited.id, added.id);

    // Resume (Resume button sends `{ paused: false }`).
    const resumeRes = await fetch(`${base}/api/subscriptions/${added.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: false }),
    });
    assert.equal((await resumeRes.json()).paused, false);

    // PATCH on an unknown id 404s (AC24) -- the edit panel's error path.
    const unknownPatch = await fetch(`${base}/api/subscriptions/does-not-exist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: true }),
    });
    assert.equal(unknownPatch.status, 404);

    // One-shot form: exactly the body shape subscriptions.js's download
    // button composes -- {url, format, quality, filetype, folder} (folder
    // omitted when blank, format/quality/filetype always the three dropdown
    // values, per v1.13.0 item 4).
    const oneShotRes = await fetch(`${base}/api/ytdlp/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://youtu.be/dQw4w9WgXcQ', format: 'video', quality: 'best', filetype: 'webm' }),
    });
    assert.equal(oneShotRes.status, 202);
    const oneShotBody = await oneShotRes.json();
    assert.equal(oneShotBody.accepted, true);
    assert.equal(typeof oneShotBody.jobId, 'string');

    // A malformed/channel URL posted through the one-shot form 400s, never
    // spawning (AC9/10) -- exactly the error path setFieldError renders.
    const badOneShot = await fetch(`${base}/api/ytdlp/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.youtube.com/@somechannel', format: 'video', quality: 'best' }),
    });
    assert.equal(badOneShot.status, 400);
    assert.ok((await badOneShot.json()).error);

    // The status endpoint the ~2.5s poll hits reflects the one-shot job
    // (queued/downloading/done) and is shaped exactly as
    // `formatLiveStatusText`/`createOneShotRow` expect.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const snapshot = await (await fetch(`${base}/api/subscriptions/status`)).json();
    assert.ok(snapshot.oneShots[oneShotBody.jobId], 'the one-shot job must appear in the status snapshot');
    assert.equal(snapshot.oneShots[oneShotBody.jobId].state, 'done');
    assert.equal(typeof snapshot.oneShots[oneShotBody.jobId].updatedAt, 'string');
    assert.ok(snapshot.subscriptions, 'the subscriptions namespace must always be present, even if empty');
  } finally {
    await close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
