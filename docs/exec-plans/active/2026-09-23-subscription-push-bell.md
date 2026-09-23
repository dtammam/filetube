---
plan: subscription-push-bell
harness: v2 · lean
branch: feat/subscription-push-bell
anchor: spec
status: Draft
next: Dean's go on the decision register D1-D9 below (the three defaulted calls are D3, D4, D5); then Step 1 (store field + validators) on this branch
design: pending
gate: pending
---

# Per-subscription web push opt-in bell (off by default)

## The request (restated)

Dean, 2026-09-23: "iOS/browser notifications fully work, it's great, I just don't want
to be hit by notifications for all channels - I'd rather opt in" and "that bell should
denote which channels will notify on downloads."

So: a bell per YouTube subscription. Bell ON means a download from that channel sends a
WEB PUSH notification to every browser that has push registered. Bell OFF (the default,
including every subscription that exists today) means no push for that channel. The
in-app notifications feed (the bell icon in the header, `lib/notifications/routes.js`)
is NOT gated: it keeps listing every download as it does today.

## Survey (verified against source 2026-09-23, file:line)

- **There is no per-channel push writer.** Every download producer writes a row into the
  SQLite `notifications` table (`userStore.recordNotifications`, lib/auth/store.js:811)
  and calls `pushDelivery.trigger(reason)`. `deliverRound` (lib/push/deliver.js:219-275)
  reads the rows after each browser's cursor (`store.listNotificationsAfter(sub.lastPushedId,
  FEED_READ_LIMIT)`), rows are `{id, mediaId, createdAt, kind}` only, and pushes them:
  up to `COLLAPSE_MAX` (3) rows individually, more as one "N new videos" summary
  (`decideDeliveries`, :70-74).
- **Cursor discipline is load-bearing.** `applyResult` (:210-220) returns true ONLY when
  the cursor advanced; `trigger` (:281-303) re-runs a truncated round only when
  `c.sent > 0`, and the comment records the 314-round spin that gate found when a round
  claimed progress without advancing. A row whose media vanished already advances the
  cursor without a send (:254-258).
- **Per-row meta** comes from `resolvePushMeta(db, row)` (server.js:348-366): for a
  media row it reads `db.metadata[mediaId]` and returns `{title, channel: item.folderName,
  kind: 'media', type, chaptered}`. The scanned yt-dlp item carries `channelUrl`,
  `channelHandleUrl`, `channelId` (lib/scan/orchestrator.js:1137-1144, :1500-1503),
  regardless of media type (audio too). A non-YouTube item has only `channelName`.
- **Item to subscription:** `findSubscriptionForChannel(db, channel)`
  (lib/ytdlp/index.js:5046, exported :7651) matches on channelId when both sides have
  one, else on the normalised URL against the item's URL forms; `db` is the ytdlp holder
  (`ytdlpDb.holder(['subscriptions'])`, the pattern at :5147). server.js already holds
  `ytdlpDb` (:567) and `ytdlp` (:15). Known blind spot (documented at :5076-5090): an
  id-less `/c/` or `/user/` subscription may not match an item. Under D4 that item keeps
  pushing.
- **Storage:** `ytdlp_subscriptions (id, position, json)` stores each record as a JSON
  blob (lib/db/sqlite.js:1250), so a new boolean field needs NO schema bump.
  `ensureYtdlp` (lib/ytdlp/store.js:94; per-sub backfill loop :137-185) is where
  `paused`/`skipShorts`/`libraryPlace`/`order`/`cutoffDate` get their in-memory
  defaults for records written before the field existed. `validateSubscriptionPatch`
  (:483) validates a PATCH body and `updateSubscription` (:1949; paused applied at :1996,
  skipShorts at :2002) applies it: a field must be in BOTH or the patch validates
  and never applies (the lesson recorded at :2026-2030). `addSubscription`'s record
  literal is at :1569.
- **Routes:** `PATCH /api/subscriptions/:id` (lib/ytdlp/index.js:5601) already carries
  `requireManageSubscriptions` (server.js:3273: admin or `canManageSubscriptions`).
  `GET /api/subscriptions` (:5500) returns the whole record spread (`{...sub, channelDir}`),
  so the new field is exposed with no serializer change; the route has no RBAC today.
  No new route, so no route-census churn.
- **Backup:** the bundle carries `ytdlpDb.read()` whole (lib/admin/backup.js:552);
  unknown record FIELDS round-trip.
- **UI, two renderers:** (1) the watch page channel block, `applySubscribeAndPinState`
  (public/js/watch.js:2725) builds `#pin-channel-btn` (:2761) beside Subscribe from the
  same answer set; the matched record is `subs.find(s => s.id === currentSubState.subId)`
  (:2758); its FIRST render reads the capability cache, which `scrubSubsForCache`
  (public/js/common.js:3393) reduces to six fields, so the flag MUST be added there or
  the cached frame-one render is wrong (INERT SIBLING LIST; the key list is locked at
  test/unit/capability-cache.test.js:55). `handleTogglePin` (:2652) is the toggle
  template (disable, request, write-through, re-label). (2) the /subscriptions page row,
  `createSubscriptionRow` (lib/ytdlp/client/subscriptions.js:2529; the pin star :2751-2764,
  exported for node:test :4747); `togglePause` (:4167) is the PATCH-then-reload template;
  handlers are wired at :3943/:3982.
- **Test templates:** test/integration/scan-push-bridge.test.js (a REAL scan writes the
  row and the detached round pushes through `__setPushTransportForTests`; it seeds a
  subscription with `channelUrl` and plants `downloadMeta` so the scanned item carries
  the channel identity); test/unit/push-delivery.test.js (`createPushDelivery` with fake
  store/transport, the spin breaker at :207-219); test/unit/ytdlp-store.test.js
  (validators + updateSubscription); test/integration/backup-restore.test.js.

## Decision register (spec anchor; ordered by blast radius)

| ID | Decision | Recommendation | Why |
|----|----------|----------------|-----|
| D1 | The field | `pushBell: boolean` on the subscription JSON record, default `false`; backfilled in `ensureYtdlp` like `paused`; added to `validateSubscriptionPatch` AND `updateSubscription` AND the `addSubscription` literal | No DDL, no migration, backup round-trips it; the three-writer list is the persist-gate class |
| D2 | Where the gate runs | At DELIVERY, per row, in `deliverRound` BEFORE `decideDeliveries`; `resolvePushMeta` (server.js) resolves the item to its subscription and returns `pushMuted: true` when the sub exists and `pushBell !== true` | Rows carry no channel; the feed stays complete for the in-app bell; the one seam every producer already flows through |
| D3 | Scope of the flag | ONE flag per subscription, not per user | Dean's ask is about channels; per-user needs a new table and settings UI; a self-hosted family server rarely wants both |
| D4 | Items that match NO subscription | keep pushing (one-off `POST /api/ytdlp/download`, non-YouTube items, the `/c/`-URL blind spot) | The bell is a per-channel opt-in, not a global mute; a one-off download is an explicit act |
| D5 | Podcasts | out of scope (kind `podcast`, their own path) | Different store and UI; a later wave can mirror the field |
| D6 | Cursor + re-run under filtering | A muted row advances the cursor exactly like a vanished row; the summary's `maxId` is the last row READ (not the last row that passed); the individual path walks ALL rows in feed order and stops at the first send failure; `counters.advanced` counts cursor moves without a send and the truncation re-run gates on `sent > 0 \|\| advanced > 0` | Otherwise a full read of muted rows strands the cursor until the next trigger; the walk order keeps "cursor holds at the last success" true when muted and failing rows interleave |
| D7 | UI surfaces | (a) watch page: a bell button beside Pin, only when subscribed (`currentSubState.subscribed`), label "Notify 🔔" / "Notify off 🔕" with `aria-pressed`; (b) /subscriptions row: a bell icon button beside the pin star, same glyph pair; both PATCH `{pushBell}` and re-render from the response. `scrubSubsForCache` carries `pushBell` | Both places a subscription is already controlled; one control per surface (the settings sheet is not extended in this wave) |
| D8 | Who can toggle | whoever passes the existing `requireManageSubscriptions` on PATCH; the buttons render for everyone the subscribe controls render for, a 403 surfaces as a console error and the label reverts | No new route; matches Pause/Skip-shorts today. Disclosed: a viewer-only user sees a bell they cannot flip |
| D9 | Add path | `addSubscription` writes `pushBell: false`; the add body does NOT accept the field | Off by default is the whole point; the toggle is one tap after adding |

## Acceptance (each names its binding test)

1. **Bell off, no push, cursor advances.** Real scan -> row -> round with the matched
   subscription's `pushBell: false`: zero transport sends, the browser's `lastPushedId`
   equals the new row id. (scan-push-bridge.test.js, new case)
2. **Bell on, one push.** PATCH `{pushBell: true}` then another real scan of the same
   channel: exactly one send with the video's title. (scan-push-bridge.test.js)
3. **Unmatched still pushes.** A download whose item has no channelUrl/channelId, and one
   whose channel is not subscribed, each push. (scan-push-bridge.test.js)
4. **Collapse counts only passing rows.** 5 rows read, 3 muted -> 2 individual pushes;
   4 passing + 3 muted -> one "4 new videos" summary whose cursor lands on the LAST row
   read. (push-delivery.test.js)
5. **No spin, no strand.** A full-limit read of all-muted rows advances the cursor and
   re-runs once (`advanced > 0`), then terminates; the round breaker never trips.
   (push-delivery.test.js, the existing breaker harness)
6. **Cursor holds at the last success.** Rows [muted, ok, muted, fail, muted]: the
   cursor ends on the failing row's predecessor, never past the failure. (push-delivery.test.js)
7. **Existing subs read off.** A record without the field reads `pushBell: false` from
   `ensureYtdlp`, and after a backup restore of a bundle written without the field;
   a bundle with `pushBell: true` restores true. (ytdlp-store.test.js + backup-restore.test.js)
8. **PATCH contract.** `{pushBell: 'yes'}` -> 400 "pushBell must be a boolean";
   `{pushBell: true}` persists and the GET shows it; a non-manager gets 403 and the
   record is unchanged. Mutation: removing the `updateSubscription` apply line turns
   the persist assertion red. (ytdlp-store.test.js + the route test)
9. **Both renderers.** The watch page shows the bell only when subscribed, with the
   cached first render matching the confirmed one (capability-cache key list updated);
   the /subscriptions row shows the bell state and a click PATCHes `{pushBell: !current}`.
   (uploader-channel-link / watch tests, subscriptions row test, capability-cache.test.js)
10. **Podcast rows never consult the bell.** (push-delivery / resolvePushMeta unit)

## Design

### Data model
`subscription.pushBell: boolean` (default false). Writers: `ensureYtdlp` backfill,
`addSubscription` literal, `updateSubscription` apply. Reader: `resolvePushMeta`.

### Delivery
```
resolvePushMeta(db, row)            // server.js
  media arm: item = db.metadata[mediaId]
  sub = (item.channelUrl || item.channelId)
        ? ytdlp.findSubscriptionForChannel(ytdlpDb.holder(['subscriptions']), item) : null
  pushMuted = !!sub && sub.pushBell !== true
  return { ...existing, pushMuted }

deliverRound (deliver.js)
  resolved = rows.map(row => ({ row, meta: deps.resolveMeta(row) }))
  passing  = resolved.filter(r => r.meta && !r.meta.pushMuted)
  decision = decideDeliveries(passing.map(r => r.row))
  summary: send "N new videos", advance to rows[rows.length-1].id
  individual: for r of resolved in order:
     skip (null or muted) -> advancePushCursor(row.id); counters.advanced++
     else send; ok -> advance; fail -> break
  none (everything skipped): advance to last row id, counters.advanced++
trigger: again = c.truncated && (c.sent > 0 || c.advanced > 0)
```
`payloadForRow` takes the already-resolved meta (no second resolve per row).

### Client
- watch.js: `#notify-channel-btn` created in `applySubscribeAndPinState` after the pin
  button, removed when not subscribed; `handleToggleBell` mirrors `handleTogglePin`
  (PATCH, then write the returned record's `pushBell` into the capability-cache `subs`
  entry so the next frame-one render is truthful).
- subscriptions.js: `.sub-row-bell` button in `createSubscriptionRow` (only when
  `sub.id`), handler `onToggleBell(sub)` -> `toggleBell` (PATCH then `loadSubscriptions()`,
  the `togglePause` shape). CSS: reuse the `.sub-row-pin` rule family with a sibling
  selector, tokens only (`npm run lint:css` ceiling zero).

### Error handling
A failed PATCH leaves the label at the server's truth (re-read on the next load) and
logs; the delivery filter never throws (a missing holder or a throwing finder counts
as "not muted", so a bug there can only over-notify, never silently mute).

### Steps (each with its Demo)
1. Store: field + validators + backfill + apply, with ytdlp-store tests (AC7, AC8 validate/persist). Demo: `PATCH {pushBell:true}` round-trips through GET; a restart reads false for an old record.
2. Delivery: `resolvePushMeta` mute flag + `deliverRound` filter/cursor/`advanced` (AC4-6, AC10). Demo: the unit harness shows 3 muted rows advance the cursor with zero sends.
3. Bridge: the real scan-to-push cases (AC1-3). Demo: scan-push-bridge shows off -> silent, on -> one push, one-off -> push.
4. Route + backup (AC8 403, AC7 restore).
5. Clients: watch page button + cache scrub + /subscriptions row (AC9), CSS lint zero.
6. Dual-Node full suites (22.23.1 then 24.20.0, sequential), then the gate: adversary + qa + security-brief (`lib/ytdlp/client/subscriptions.js` matches `**/*client*`).

## Out of scope (disclosed)
Per-user bells (D3); a global "mute all" switch; podcasts (D5); the settings sheet
toggle (D7); accepting `pushBell` on POST (D9); the `/c/`-URL matching blind spot
(pre-existing, documented in `findSubscriptionForChannel`).
