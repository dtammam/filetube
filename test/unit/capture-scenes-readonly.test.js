'use strict';
// P1 scene lint (2026-07-30 hardening): capture scenes are read-only by
// contract - they never actuate destructive controls. Scene 21 drove the
// home delete flow and destroyed 8 real files; this lint makes that class
// unrepresentable. It scans the STRUCTURED scene data (not source text),
// so comments and notes can mention deletion freely - only actions count.

const { test } = require('node:test');
const assert = require('node:assert');
const { scenes, p3, notAutomatable } = require('../../tools/capture/scenes.js');

// Interaction ops that actuate UI. 'wait' observes; it cannot click.
const ACTUATING_OPS = new Set(['click', 'hover', 'evalJs']);
const DESTRUCTIVE = /delete|remove|trash|purge|destroy|confirm|unpin|wipe|reset/i;

const allScenes = [...scenes, ...p3];

test('no automated scene actuates a destructive control', () => {
  const offenders = [];
  for (const scene of allScenes) {
    for (const [op, target] of scene.actions) {
      if (!ACTUATING_OPS.has(op)) continue;
      if (DESTRUCTIVE.test(String(target))) offenders.push(`${scene.id}: [${op}] ${target}`);
    }
  }
  assert.deepStrictEqual(offenders, [], 'destructive actuation in scenes:\n' + offenders.join('\n'));
});

test('no automated scene id resurrects the hard-delete scene', () => {
  for (const scene of allScenes) {
    assert.doesNotMatch(scene.id, /delete/i, `scene id ${scene.id}`);
  }
});

test('the retired hard-delete scene stays retired AND marked destructive in the manual list', () => {
  const entry = notAutomatable.find((s) => s.id === '21-hard-delete');
  assert.ok(entry, '21-hard-delete must remain documented in notAutomatable');
  assert.match(entry.cls, /DESTRUCTIVE/i);
  assert.ok(!allScenes.some((s) => s.id.startsWith('21')), 'no automated scene may reclaim id 21');
});

test('every action tuple is a known op (no vocabulary drift past the lint)', () => {
  const KNOWN = new Set(['wait', 'click', 'hover', 'scrollTo', 'setViewportWidth', 'evalJs', 'goto']);
  for (const scene of allScenes) {
    for (const [op] of scene.actions) {
      assert.ok(KNOWN.has(op), `${scene.id}: unknown op '${op}' - extend the lint before extending the vocabulary`);
    }
  }
});
