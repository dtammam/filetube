# Exec plan: local channel-identity reconciliation (v1.116)

- Owner: main session (lean mode)
- Opened: 2026-08-13
- Target: v1.116.0
- Device pass: PENDING (Dean) - the live library is the arbiter.
- DATA-MUTATING wave (writes channelId + channelName + channelUrl/handleUrl +
  avatar onto existing rows) -> **FULL gate**, adversarial briefed to DESTROY the
  identity (cross-channel bleed, mixed-folder mis-heal, persist-gate revert).
  Never slim.

## The bug (Dean, on v1.115 device pass)

The v1.115 "Refresh channel names" backfill left channels like **NESTALGIA**
untouched. Root cause (proven on prod, read-only diagnostic):

1. The backfill hard-filtered `type === 'video'` (index.js:1637 + :1679).
   NESTALGIA is the **music** library -> its items are `type: 'audio'` -> the
   whole channel (347 items) was skipped before any probe.
2. The channel is **fragmented into two identities** in the DB:
   - **332** items: `channelName:"@nestalgiamusic"`, `channelId:null`,
     `channelUrl:".../@nestalgiamusic"` (bad name, no id).
   - **15** items: `channelName:"NESTALGIA"`, `channelId:"UC-6oT0FOyAqCGfdNLi4fmXA"`,
     `channelUrl:".../channel/UC-…"`, `channelHandleUrl:".../@nestalgiamusic"`
     (the real name + canonical id).

Dean's insight: the item that already carries the `channelId` is **local ground
truth** - heal the fragments from it, no network needed.

## Machine-derived sizing (prod, `channel-heal-sizing.js`, 2026-08-13)

Bucketed by physical folder (dirname of filePath), video+audio:

| bucket | channels | items |
| ------ | -------- | ----- |
| **HEAL LOCALLY** (folder has exactly 1 canonical channelId) | **8** | **516** |
| network probe (bad, no canonical sibling, has a URL) | 1 | 1 |
| unrecoverable (bad, no channelId anywhere, no URL) | 70 | 1217 |
| conflict (folder has >1 channelId) | 1 | - |

Examples: nestalgiamusic 332 -> "NESTALGIA", CGTioMusic 96, heavymachinegun 66,
HungrySkullMedia 10, kaimakesmusic4 6, vapidVGM 3, BillMcClintockMashups 2,
aijuex 1. Conflict = "Miscellaneous from SLS" (12 channelIds - a junk-drawer,
correctly skipped). **These counts are PREDICTIONS the unit tests + a prod
re-run must reproduce.**

Decision (Dean): the local heal is the wave. The 1-item network case is
negligible; the existing v1.115 network path already covers the remainder when
the button runs. The 1217 unrecoverable stay disclosed (re-download only).

## Design

Fold into the EXISTING "Refresh channel names" button. Pressing it now runs a
**local reconciliation pass FIRST** (instant, no spawn), then the existing
network probe for whatever is still bad.

### T1 - widen the network path to audio
Drop the `type === 'video'` gate to `video || audio` in
`collectDistinctChannelNameTargets` (1637) and `applyBackfilledChannelName`
(1679). Tests: an audio bad-name channel becomes a target + is written.

### T2 - pure local-heal core (lib/ytdlp/index.js)
- `collectLocalChannelHealTargets(db)` - bucket video+audio items by
  `dirname(filePath)`; a bucket yields a target IFF it has EXACTLY ONE
  "canonical" member (non-empty channelId AND non-bad name) AND at least one
  bad, non-manual item. Returns `{ folderKey, identity: {channelId, channelName,
  channelUrl, channelHandleUrl, channelAvatarUrl}, urls:Set<string> }`. Skips
  multi-canonical (conflict) buckets. Pure, never throws, never mutates.
- `applyLocalChannelHeal(metadata, target)` - for each item whose
  `dirname(filePath) === target.folderKey`, is `type` video/audio, NOT manual,
  and has a BAD name: heal IFF it has no channel URL at all OR its
  `channelUrl`/`channelHandleUrl` is in `target.urls` (handle corroboration -
  never adopt a foreign channel's identity that happens to share a folder).
  Adopt the identity as a UNIT (channelId/channelName/channelUrl/handleUrl, and
  channelAvatarUrl only if the canonical has one and the item lacks one). Return
  count. Guards mirror applyBackfilledChannelName (manual wins, bad-name only,
  200-char bound, control-char strip on the name).

### T3 - fanout writer (server.js)
`recordLocalChannelHealFanout(deps, target)` - wraps `applyLocalChannelHeal` +
`refreshPinLabelsForBackfilledChannel` in ONE `updateDatabase`. Mirrors
`recordChannelNameBackfillFanout`.

### T4 - persist-gate carry-forward (server.js Phase-2 merge)
The heal now populates `channelId`/`channelAvatarUrl` on items that ALREADY have
a `channelUrl` (the 332), so the existing `!item.channelUrl` identity-carry
(5003) SKIPS them - a mid-scan heal would be reverted (persist-gate class,
AGAIN). Add gap-fills, marker-agnostic, manual-guarded:
- `channelId`: `if (!item.channelId && freshItem.channelId) item.channelId =
  freshItem.channelId` (adopt the avatar/handle with it as a unit).
- `channelAvatarUrl`: gap-fill when missing.
The name is already covered by the v1.115 gap-fill (5022). LOAD-BEARING mid-scan
test (mirror channel-name-backfill-midscan): drive a heal write between Phase-1
and Phase-2, assert channelId+name survive; mutation-verify.

### T5 - endpoint integration
In `runChannelNameBackfillBatch`, before the network loop: run
`collectLocalChannelHealTargets` + `recordLocalChannelHealFanout` for each,
accumulate into `itemsUpdated`, then recompute the network targets on the UPDATED
db (healed channels are no longer bad). Integration bridge test: the real
endpoint heals the audio fragments (id+name+avatar) end to end.

### T6 - client (minimal)
The button stays "Refresh channel names". Summary text may note items healed.
Keep client churn minimal - itemsUpdated already flows through.

## Named attack surfaces for the adversarial seat (FULL gate)
- **Cross-channel bleed / mixed-folder mis-heal**: a bad item that belongs to a
  DIFFERENT channel but sits in a single-canonical folder must NOT adopt the
  canonical identity - the handle-URL corroboration is the guard. Mutation-test:
  delete the corroboration, prove a foreign-handle item gets mis-healed.
- **Conflict folder**: a >1-canonical-id folder must be skipped wholesale.
- **Manual attribution CLOBBER**: never heal over `channelAttributedManually`.
- **Persist-gate**: healed channelId/name/avatar must survive a subsequent scan
  (T4). Mutation-test the gap-fills.
- **Idempotency**: a second run heals 0 (the now-good items aren't bad).
- **Identity UNIT**: never mix channel A's id with channel B's name/url.

## Stop condition
Both seats APPROVE (full gate); dual-Node green; a prod re-run of the sizing
reproduces 8 channels / 516 items healed (Dean); released with device pass
PENDING. Move to completed/ at release.
