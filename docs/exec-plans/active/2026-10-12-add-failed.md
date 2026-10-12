---
plan: add-failed
harness: v2 · full
branch: fix/v1.387.1-add-failed
anchor: spec
status: Draft
next: build W1, then the gate
design: the iOS Root's proposal (2026-10-12, its v0.9.0 gate QA S2), Dean's go to the FileTube Root the same day ("Go: new message"). Base = main e78c53ff (v1.387.0).
builder: standard (one add-only contract entry and one web state, on the v1.387.0 seams named below)
gate: pending
---

# v1.387.1: the web hears when an offline add fails as a whole

Norms: no em dashes; stage by name; `git commit -F <file>`; never pipe a commit or push; fnm Node 22.23.1 PATH before any
node/npm/git command; never `--no-verify`; never self-merge. A status report NEVER ends your turn.

Read first: AGENTS.md; docs/references/native-bridge.md + native-bridge.v1.schema.json (the v1.387.0 `downloads` section);
docs/references/offline-api.md; the completed plan docs/exec-plans/completed/2026-10-11-offline-server.md (D5, D6 and its
evidence); docs/LESSONS.md 0, 1, 2, 4.

## Step 0 (builder)
- Work ONLY in `.claude/worktrees/fix-v1.387.1-add-failed` (give it its OWN `npm ci` in the worktree and in tools/capture;
  never symlink main's node_modules; never staged).
- Stop and ask Dean (AskUserQuestion) when: the shape below cannot express a need; a browser (no host) behaviour would change;
  the gate reaches round 3. Merges: when the gate is closed and the PR's required checks are green, SendMessage "FileTube Root"
  the PR number and sha; the Root merges.
- Close-out after approval: a bookkeeping-only diff needs no seat re-check (docs/RELEASING.md step 1, Dean 2026-10-12); verdict
  lines ride the commit already happening.

## 1. Outcome
In the iOS app, tapping "Make available offline" on an album or a TV season that cannot start at all (server unreachable,
the album gone, a manifest the app cannot read, the device removed) shows the reason on that album's menu right away, instead
of the button silently staying as it was. Tapping it again retries. Browsers and the PWA: no change at all.

## 2. Contract v1 addition (add-only; land EXACTLY this shape)
- Native to web event `downloadsAddFailed { kind, id, error }`: `kind` = any `downloads.add` kind (track | album |
  podcastEpisode | video | tvEpisode | tvSeason), `id` string 1..512 (the id the web sent), `error` = the existing `download`
  error enum (network | storageFull | revoked | notOnServer | notReady | notPlayable | other). All three required. Sent ONCE
  when an add cannot produce any member (a container) or cannot start (a single item that never reached a `download` event).
  Lenient: an unknown `error` maps to `other` (the `download` event's rule); an unknown `kind` drops the event.
- Owners unchanged (native owns state; the web displays). Not part of `downloadsSnapshot` (a failed add holds nothing on the
  phone). Older pages ignore the unknown type (the existing rule).

## 3. Design (web)
- **D1 Contract**: schema `nativeToWeb.oneOf` entry, native-bridge.md sections 3 and the downloads rules (when native sends it,
  that it is once per failed add, that a retry is a new add), host-adapter.js `EVENTS` entry with the lenient error mapping, and
  the conformance test binding both ways. offline-api.md gains a one-paragraph "Telling the web an add failed" note for the app.
- **D2 offline.js**: a `failedAdds` map keyed like the items map (`kind:id`, the id normalized the way `add()` normalizes it).
  `downloadsAddFailed` sets `{ state: 'failed', error }` for that key and notifies the surfaces (`notify(kind, id)`), so
  `menuEntry` shows LABEL_ADD with the error copy for an album / season exactly as it does for a failed single item today.
  The entry is cleared by: the next `add()` of that key; any `download` event whose parentKind / parentId (or kind / id)
  matches; a `downloadsSnapshot` (it replaces the world); unsubscribe on pagehide. A container's rolled-up state prefers real
  members over a stale failure. No timers. No pending state is added (an older app never sends the event, and a pending
  state would then hang).
- **D3 No-host equality**: no host = no listener beyond the inert ones, identical DOM (extend the existing no-host test).

## 4. Waves
- **W1** D1-D3 with tests: the conformance binding (mutate either side, watch it red); a fake-host test per clearing path (re-add,
  member event, snapshot, pagehide); album and season menus show each error's copy; an unknown error shows "other"; an unknown
  kind is dropped; a single-item failure via the new event works the same; no-host DOM equality. Full `npm test` on Node 22.
- **W2** close-out: ledger (user language), ROADMAP Shipped, docs/DEVICE-CHECKS.md "Offline add failures (v1.387.1)" (in the app
  with the server unreachable, make an album available offline -> its menu shows "No connection right now..."; tap again once
  online -> it starts), LESSONS only if the gate finds a new class.

## 5. Gate
adversary + qa (the scrutiny table; add security-brief if it says so). Brief: a failure that never clears (each clearing path
mutated away); a stale failure hiding real member progress; an id normalized differently on add and on the event (an album key
with its separator); a schema / adapter mismatch; any change with no host.

## 6. Release
docs/RELEASING.md + AGENTS.md; close the plan in the same PR (`node scripts/plan-complete.js
docs/exec-plans/active/2026-10-12-add-failed.md "Shipped v1.387.1" --apply`); the Root merges on green; shipped = the tag's
"Publish Docker Image" green; then SendMessage "FileTube iOS Root Session" the merge commit so it can pin the event for v0.11.0,
and "FileTube Root" the result; then claude-close.sh.

## 7. Evidence (builder fills)

## 8. Out of scope
A pending / spinner state for container adds; anything native; retry policy (the app's).

Gate: CHANGES r1 @4166023b - qa
Gate: CHANGES r1 @4166023b - adversary
Round 1 fix (builder): the album drill pill and the TV pills repaint in place on an offline change and carry the reason as a title; one toast with the reason per failed add (touch has no title); the event key uses the normalized id; tests on the REAL music.js / tv.js mounts (test/unit/offline-pill-repaint.test.js). Scope note: the pill repaint also makes v1.387.0's saving / done states live on those pills.
