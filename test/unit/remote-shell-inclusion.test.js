'use strict';
// v1.348 Listen Control: the target stream lives in the persistent shell, so EVERY in-app shell
// that loads common.js must load remote.js right after it (the inert-sibling-list guard: a shell
// that forgets it silently drops the PC's remote channel when the user navigates in from it).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const EXEMPT = new Set(['login.html', 'setup.html', 'welcome.html']);
const COMMON = '<script src="/js/common.js"></script>';
const REMOTE = '<script src="/js/remote.js"></script>';

const shells = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html')
  && fs.readFileSync(path.join(PUBLIC, f), 'utf8').includes(COMMON));

test('the shell census finds the shells (a rename cannot empty the guard)', () => {
  assert.ok(shells.length >= 12, 'found ' + shells.length);
  for (const f of ['music.html', 'index.html', 'watch.html', 'books.html', 'podcasts.html', 'stats.html', 'tv.html', 'history.html', 'read.html']) {
    assert.ok(shells.includes(f), f);
  }
});

for (const f of shells) {
  if (EXEMPT.has(f)) continue;
  test(f + ' loads remote.js after common.js', () => {
    const html = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
    const c = html.indexOf(COMMON);
    const r = html.indexOf(REMOTE);
    assert.ok(r > c && c >= 0, f + ' must load remote.js after common.js');
    assert.strictEqual(html.split(REMOTE).length - 1, 1, 'exactly once');
  });
}

for (const f of EXEMPT) {
  test(f + ' (exempt) does not load remote.js', () => {
    assert.ok(!fs.readFileSync(path.join(PUBLIC, f), 'utf8').includes(REMOTE));
  });
}
