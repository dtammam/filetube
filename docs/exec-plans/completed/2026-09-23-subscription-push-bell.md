---
plan: subscription-push-bell
harness: v2 · lean
branch: feat/subscription-push-bell
anchor: spec
status: Shipped v1.314.0
next: tracker #233 (the in-flight bell tap race + two test nits, one slim commit) in a later wave; Dean's device check: Notify beside Pin on a subscribed video, the bell on /subscriptions rows, a bell-on channel pushes, a bell-off one only lands in the in-app feed
design: Approved 2026-09-23 @360f8e7f (Dean: "Please go")
gate: APPROVED r2 @d7342962 — adversary, qa, security-brief
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
| D4 | Items that match NO subscription | keep pushing (one-off `POST /api/ytdlp/download`, non-YouTube items, the `/c/`-URL blind spot - which CLOSES after the subscription's first successful poll captures its channelId, lib/ytdlp/index.js ~3464, before that poll's scan trigger; gate r1 adversary S3) | The bell is a per-channel opt-in, not a global mute; a one-off download is an explicit act |
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

## Build record (2026-09-23)

| Step | Commit | What |
|------|--------|------|
| 1 | d6c7571a | store: `pushBell` validator, PATCH subset, `ensureYtdlp` backfill (absent/junk -> false), `addSubscription` literal false, `updateSubscription` apply; ytdlp-store tests (AC7 restart, AC8 validate/persist) |
| 2a | 7a60be8c | deliver.js: rows classified once (`classifyRow`), collapse on the sendable subset, summary cursor = last row READ, the individual walk covers every row in order and stops at the first failure, `counters.advanced`, trigger re-run on `sent \|\| advanced`; push-delivery tests (AC4, AC5, AC6, AC10) |
| 2b | 82ed4fa2 | server.js: `pushMutedForItem` (join via `findSubscriptionForChannel` over `ytdlpDb.holder(['subscriptions'])`, fails open), `resolvePushMeta` carries `pushMuted`; notifications-api test (subscribed+absent field -> muted, id-only item joins, one-off/non-YouTube/podcast never muted, flip through the store) |
| 3 | a9b9481d | scan-push-bridge: real scan -> off is silent with the cursor advanced, on pushes once and off again mutes, an unsubscribed one-off pushes (AC1-3) |
| 4 | 67918102 | routes + bundle: PATCH round-trip (body + GET) and 400 naming the field (ytdlp-patch-pause), plain member 403 (rbac-subscriptions-flag), backup restore of a pre-bell record reads OFF and an ON bell survives (backup-restore) |
| 5 | 5dafcbea | watch.js `#notify-channel-btn` + `handleToggleBell` (write-through to the capability cache), common.js `scrubSubsForCache` carries `pushBell`, subscriptions.js `.sub-row-bell` + `toggleBell` wired via `onToggleBell`, style.css bell shares the pin rule family; tests: row anatomy/glyph/click/wiring lock, cache scrub, watch frame-one ON/OFF/unsubscribed (AC9) |

Dual-Node full suites at 5dafcbea: Node 22.23.1 8988/8988 exit 0; Node 24.20.0 8988/8988 exit 0 (sequential, never alongside a reviewer). Instruments at 5dafcbea: `npm run lint:css` TOTAL 0; `npm run lint:overlay` clean;
`check-markers` clean. Disclosed while building: the watch-init shim's
`setAttribute` is a no-op, so the watch page's `aria-pressed` is bound by the label
there and by the row test on the /subscriptions side; the row anatomy lock
(`ytdlp-subscriptions-client` "single trailing kebab") was updated to the new
`[avatar, info, bell, kebab]` shape - the bell renders for every row with an id, the
pin still only for a navigable row.

## Security-brief r1 @7c76380d

Tooling gap, stated first: this seat has no Bash, so the review is of the tip's
files on disk (every `pushBell` / `pushMuted` site found by grep), not a literal
`git diff 92d48874`. No tests were run by this seat.

Findings that block (CRITICAL/HIGH): none.
Findings to fix-or-accept (MEDIUM/LOW): none.

Notes (INFO, verified unless marked otherwise):
- S1 PATCH boundary (verified): `pushBell` is accepted only by `validatePushBell`
  (boolean or absent) inside `validateSubscriptionPatch`, and `updateSubscription`
  re-validates before mutating. Every route that writes a subscription record
  (POST, PATCH, DELETE, reorder, settings, repull, skip, cancel, failures) carries
  `requireManageSubscriptions` (admin or `canManageSubscriptions`); the add body
  ignores the field (`addSubscription` literal `false`). The settings sheet `onSave`
  builds its patch from its own inputs and never carries the field; the
  channelId/avatar backfills mutate one field each. `reduceReorder` re-sorts the
  same objects (should-be-safe: only its head was read). No unguarded writer found.
- S2 Read exposure (verified): `GET /api/subscriptions` had no RBAC before this
  branch (v1.80 ruling: a plain member may browse the registry). The new field is a
  boolean preference; it reveals nothing about which users/browsers hold a push
  registration. Not a new exposure class. The capability cache is `sessionStorage`
  (not localStorage as briefed), `scrubSubsForCache` carries the flag only when it
  is a boolean, and `sanitizeCapabilityCache` remains the flat-primitive scrub.
- S3 Renderers (verified): both bells use fixed literal `textContent` / `aria-label`
  strings; the only record-derived input is `sub.pushBell === true` as a branch
  condition. `#notify-channel-btn` id/class are literals. No interpolation.
- S4 Push content (verified): `decideDeliveries` runs on `sendable` only, so the
  "N new videos" count excludes muted and vanished rows; `payloadForRow` is called
  only when `c.send`, so a muted row's title/channel never enters an encrypted
  body. Cursor targets (last row read) carry no content.
- S5 Delivery loop (verified): `pushMutedForItem` is wrapped in try/catch and fails
  open; `findSubscriptionForChannel` -> `nonEmpty` / `new URL` /
  `normalizeChannelUrl` / `extractChannelIdFromUrl` are pure string ops, no spawn
  or shell. Perf (advisory): each media row does a fresh
  `ytdlpDb.holder(['subscriptions'])` table read, up to 200 rows x N browsers per
  detached round; small table, and only a manager can generate rows, so not an
  attacker-reachable DoS. A per-round memo is a later nicety, not a fix.
- S6 Backup/restore (verified): the bundle carries `ytdlpDb.read()` whole and the
  restore is `replaceAll`; every reader (`listSubscriptions`,
  `findSubscriptionForChannel`) goes through `ensureYtdlp`, which coerces a
  non-boolean `pushBell` to `false`; backup-restore.test.js:885 binds it.
- S7 D8 disclosure stands: a viewer-only user sees a bell they cannot flip; the
  403 surfaces as a console error and the label reverts. Usability, not security.

Gate: APPROVED r1 @7c76380d — security-brief

## Security-brief r2 @d7342962 (delta re-confirmation)

Same tooling gap as r1 (no Bash; the delta was read from the tip's files on
disk, not a literal diff). Re-verified against the fix commit:
- S1-S7 all still hold. No new writer of the subscription record: `ensureBell`
  (watch.js:2659) builds/relabels the same literal-only button and `removeBell`
  (:2674) drops it; neither issues a request. The subscribe POST response's
  `pushBell` is consumed only as `data.pushBell === true` (:2578, :2597), and
  the new cache entry still goes through `scrubSubsForCache`'s boolean filter.
  `removeBell` on the unsubscribe ok arm also closes a benign stale-id PATCH
  (would have been a 404 under the same RBAC gate).
- deliver.js walk arm (:294-297): the `Number.isInteger(row.id)` guard only
  tightens termination - a non-integer id is neither advanced nor counted, so
  `advanced` can never claim progress the store did not record. No content or
  count change to any push body.
- Test-only files: not security-relevant.
Nothing new introduced by the fix. No findings.

Gate: APPROVED r2 @d7342962 — security-brief

## Gate r1 - qa findings @7c76380d

Instruments (verified, Node 22.23.1): `npm run lint:css` TOTAL 0; `npm run lint:overlay` clean (0 violations); `check-markers` 1 issue = the known "stale approval @360f8e7f" note on this active plan. Targeted suites: 6 unit files (push-delivery, ytdlp-store, capability-cache, watch-init-behavioral, ytdlp-subscriptions-client, ambient-glow-engine) 646/646 pass; 5 integration files (notifications-api, scan-push-bridge, ytdlp-patch-pause, rbac-subscriptions-flag, backup-restore) 62/62 pass. Full `npm test` NOT re-run by this seat (the build record's dual-Node 8988/8988 at 5dafcbea stands; the only later commit is the plan doc). No em dashes in any added line (grep of the diff's `+` lines: empty).

Security (standing brief): no new surface. PATCH keeps `requireManageSubscriptions` (T9 extended with a pushBell 403); the field is validated at the route AND re-validated at mutate (junk is dropped, not written); `GET /api/subscriptions` sits behind the global `authGate` and exposed the whole record spread before this diff, so a non-sensitive boolean preference on it is a pre-existing exposure class, not a new one; `pushMutedForItem` typeof-guards the item strings, builds no SQL/shell, and fails open inside try/catch (a bug there over-notifies, never silently mutes); both client PATCHes `encodeURIComponent` the id; console logging carries only the server's error string.

- **WARNING 1 - public/js/watch.js:2611-2627 and :2573-2575 (D7 "created/removed from the same answer set" is only true on a reload).** The bell is created/removed ONLY inside `applySubscribeAndPinState`, but the in-page transitions bypass it: `handleUnsubscribe` flips `currentSubState.subscribed=false` and relabels Subscribe without touching `bellBtn`/`currentBellState`, and the subscribe modal's success arm sets `subscribed: true, subId` without re-running the applier. Scenario A: subscribed watch page -> tap Unsubscribe (200) -> "🔕 Notify" stays on screen bound to the DELETED subId -> tap -> `PATCH /api/subscriptions/<deleted>` -> 404 "Subscription not found" -> console error, label unchanged: a live control for a subscription that no longer exists. Scenario B: unsubscribed page -> Subscribe via the modal (201) -> no bell until a reload/nav, so D9's "the toggle is one tap after adding" is false on the watch page (Pin has the same gap pre-existing, but Pin is keyed to channelDir, not the record; the bell is a record property and the plan promises removal). Fix: in `handleUnsubscribe`'s ok arm remove `bellBtn` and reset `currentBellState`; in the modal's success arm create the bell (e.g. re-run `applySubscribeAndPinState` with the cache's subs, or a small `ensureBell(matchedSub)` helper shared with the applier). Bind both in watch-init-behavioral (drive the unsubscribe fetch resolve and assert `#notify-channel-btn` is gone; drive the subscribe success and assert it appears OFF).
- **WARNING 2 - test/unit/ambient-glow-engine.test.js:380-395 (#232 edit: the JS constraint lock got WEAKER than v1.313's).** The v1.313 lock matched the keyword anywhere in ENGINE+WIRING source; the replacement binds only `.style.<prop> =` (single `=`) and `.style.setProperty('<literal>'`. Measured in a scratchpad probe against both regexes: `back.style.transform += ' scale(1.2)'`, `back.style.filter ||= 'blur(8px)'`, `const s = back.style; s.filter = ...`, `Object.assign(back.style, { filter: ... })`, and `const p = 'filter'; back.style.setProperty(p, ...)` were ALL caught by the old lock and ALL slip the new one (5 of 7 mutant spellings; only the direct literal and the vendor camelCase still red). The tracker row says CLOSED with a mutation list that never tried these. Fix: make the property-write matcher `\.style\.([A-Za-z][\w-]*)\s*(?:[+\-*/|&?]{1,2})?=[^=]`; add to the UNSCOPED ban `Object\.assign\(\s*[^,]*\.style\b`, `setProperty\(\s*[^'"\s)]` (non-literal first arg) and a style-alias ban `\.style\s*(?:[;,)]|\s*$)` (a bare `.style` stored or passed rather than dotted); re-run the 7-mutant probe and record it in the tracker row. No runtime effect; a test-strength regression on the surface #232 was opened to strengthen.
- SUGGESTION 1 - lib/push/deliver.js:284-290 vs :265-268: the walk arm does `advancePushCursor(row.id); counters.advanced++` with no `Number.isInteger` guard while the `none` arm guards `lastReadId`; the comment at :229-232 ("a non-zero value implies a real cursor advance") is therefore only true for integer ids. Unreachable in prod (INTEGER AUTOINCREMENT) and the prior code advanced unguarded there too, but the trigger re-run now keys on `advanced`, so mirror the guard for the belt's consistency.
- SUGGESTION 2 - lib/push/deliver.js:73: `decideDeliveries` still returns `maxId`, which `deliverRound` no longer reads (the summary advances to `lastReadId`); only push-delivery.test.js:30 binds it. Drop it (and the test's expectation) or note it as test-only.
- SUGGESTION 3 - server.js:378 + deliver.js:270: `pushMutedForItem` reads `ytdlpDb.holder(['subscriptions'])` (a fresh table read) per ROW, and `deliverRound` now resolves meta for EVERY row read (up to 200 per device per round) where the summary path previously resolved none. Small sync table today; consider one subscriptions snapshot per round (memoise inside deliverRound or hand the finder a cached holder).
- SUGGESTION 4 - public/js/watch.js:2648: `bellBtn.classList.toggle('btn-primary', false)` is a dead statement (the bell is born `btn` and never gains `btn-primary`).
- SUGGESTION 5 - UX (D8 disclosed): a viewer-only user's 403 on either surface is console-only; the button re-enables with the same label and nothing tells the user why. Parity with Pin today; an inline hint or hiding the bell when `canManageSubscriptions` is false would be the honest surface. Not blocking.
- SUGGESTION 6 - test/unit/ytdlp-subscriptions-client.test.js:959-967: AC9's "a click PATCHes `{pushBell: !current}`" is bound by a comment-stripped SOURCE LOCK on `toggleBell` (it lives inside the `initSubscriptionsView` closure), not by driving a fetch; acceptable, disclose as a lock rather than a behavioural binding.

Acceptance audit: AC1-AC3 bound by real-scan cases in scan-push-bridge (sends counted, cursor asserted); AC4-AC6 + AC10 by push-delivery (decrypted titles, cursor visit order, breaker harness `rounds === 2`); AC7 by ytdlp-store backfill + backup-restore (pre-bell OFF, ON survives); AC8 by ytdlp-patch-pause (400 naming the field, GET shows it) + rbac T9 + the store's persisted-field assertion; AC9 by watch-init frame-one ON/OFF/unsubscribed (label-bound; the shim's setAttribute is a no-op as disclosed, aria-pressed is bound on the row side), the row anatomy/glyph/click tests and capability-cache. Every one would go red with the feature removed. Comment accuracy: the "lesson at the bottom of updateSubscription" pointer resolves to the libraryPlace block (the last field arm before `record = sub`); v1.314 markers consistent; `pushBell` spelled identically across store, routes, both clients, cache scrub and CSS.

Gate: CHANGES r1 @7c76380d — qa

## Gate r1 - adversary findings @7c76380d

Method: every mutant ran in a /tmp sandbox from `git archive 7c76380d` (never the working tree), Node 22.23.1; the working tree already carried the security-brief and qa sections above, uncommitted, before this seat wrote anything.

Instruments (measured): targeted suites at 7c76380d all green - unit push-delivery 28/28, ytdlp-store 259/259, ambient-glow-engine 22/22, capability-cache 5/5, watch-init-behavioral 12/12, ytdlp-subscriptions-client 320/320; integration scan-push-bridge 7/7, notifications-api 13/13, backup-restore 25/25, ytdlp-patch-pause 15/15, rbac-subscriptions-flag 2/2. `npm run lint:css` TOTAL 0; `npm run lint:overlay` clean (0); `eslint` on the touched files 0 errors (7 pre-existing warnings); `check-markers` 1 issue = the front-matter design approval @360f8e7f (not a finding).

Mutants that went RED as claimed (all restored): deliver.js none-arm no-op (2 red), summary cursor = decision.maxId (1), walk-arm `advanced++` dropped (1), trigger re-run on `sent` only (1), `continue` instead of `break` after a failed send (2), `pushMuted` ignored in classifyRow (5), collapse on all rows read (5); server.js `pushMuted: false` / field dropped (api 1-2 red + bridge AC1+AC2 red); store.js apply line dropped (store 1 + patch route 1), backfill dropped (store 1 + backup-restore 1), validator subset dropped (store 1 + route 1), add literal `true` (1); subscriptions.js `onToggleBell: toggleBell` unwired (lock red), optimistic no-reload (red), glyph inverted (red); common.js scrub drops the flag (capability-cache red). #232 locks: `style.webkitFilter`, `setProperty('-webkit-mask')`, `style.cssText`, `Element.animate`, `@keyframes stage-x`, `contain: paint` on the stage all RED; `[].filter(...)` + a trailing `// transform` comment + a keyframes step BODY mentioning "stage" all stay GREEN.

Reachability (verified by reading + the bridge): `resolvePushMeta` reads `getCachedDatabase().metadata[mediaId]`; a yt-dlp download's channelUrl/channelId reaches the item through `downloadMeta` (store.js:1296, written by `persistCapturedChannelMeta` for one-offs AND the subscription poll's `recordSurvivorChannelMetaFallback`, index.js:2544/2602, audio included) and is consumed by the orchestrator at :1673/:1698; `ytdlpDb.holder(['subscriptions'])` is a fresh table read per call (featureStore.js:120-128), and the flip-through-store cases in notifications-api + bridge AC2 bind that no stale snapshot is read. The `/c/`,`/user/` blind spot (D4) is accurately disclosed: the first poll's list capture records the channelId (index.js:3464) BEFORE the scan is triggered (:3534-3536), and the avatar probe (:3411) backfills it too, so it closes after the first successful poll; the residual gap is a `/c/` sub whose list capture yields no id while the per-video capture does.

- **WARNING 1 (measured) - public/js/watch.js:2611-2627 handleUnsubscribe + :2573-2575 modal success arm: the in-page transitions bypass the bell.** Driven in a scratch copy of the watch-init harness (makeEl's `addEventListener` recording the listener, DELETE resolved 200, everything else hanging): after tapping Subscribed on a warm-cache page the button reads "Subscribe" but `#notify-channel-btn` stays connected, visible, labelled "🔕 Notify", and tapping it fires `PATCH /api/subscriptions/s1` for the subscription just deleted (a 404 in prod). The modal's success arm (:2573) sets `currentSubState` + the label only, so a fresh in-page subscribe shows no bell until a reload (D9's "one tap after adding" is false on the watch page). Fix: in handleUnsubscribe's ok arm `if (bellBtn) { bellBtn.remove(); bellBtn = null; } currentBellState = { subId: null, on: false };` and in the modal's success arm create the bell (re-run `applySubscribeAndPinState` with the just-written cache subs, or a shared `ensureBell(matchedSub)`); bind both in watch-init-behavioral - the harness needs only a listener-recording `addEventListener(t, fn) { (el._l = el._l || {})[t] = fn; }` on makeEl and a `fetchImpl` resolving the DELETE/POST.
- **WARNING 2 (measured) - lib/push/deliver.js:284-290: `counters.advanced++` in the walk arm counts a cursor move the store refused.** The real `advancePushCursor` (lib/auth/store.js:1223) IGNORES a non-integer id; the none-arm guards `Number.isInteger(lastReadId)` but the walk arm does not, and trigger() now re-runs on `advanced > 0`. Repro (createPushDelivery, store advancing only integer ids, 200 rows with string ids, 199 muted + the ONE sendable row LAST): 41 rounds / 40 POSTs to one endpoint until the breaker (unbounded in prod); sendable-first and all-muted variants terminate. Unreachable with today's INTEGER AUTOINCREMENT ids, but it is exactly the class deliver.js's own comment (:199-207) says the belt's termination must not rest on. Fix: `if (Number.isInteger(row.id)) { deps.store.advancePushCursor(sub.endpoint, row.id); counters.advanced++; }` and a harness case with string ids + a trailing sendable row. Integer-id scenarios measured clean: 1 sendable + 199 muted + 5 behind -> 2 rounds, 1 POST, cursor 205; a 500 on the summary -> cursor holds, 1 round; a 500 mid-walk -> cursor 99, 2 rounds (the re-run is real progress, bounded).
- **WARNING 3 (measured) - test/unit/ambient-glow-engine.test.js:385-395 (#232): the scoped JS lock is WEAKER than the v1.313 lock it replaced.** Surviving mutants in the engine body: `Object.assign(back.style, { filter: 'blur(2px)' })` GREEN, `back.style.filter += 'blur(2px)'` GREEN, `var p = 'filter'; back.style.setProperty(p, 'blur(2px)')` GREEN; `back.style = 'filter: blur(2px)'` reds only by accident (an engine behaviour test, not the lock). Probe of the pre-#232 regex against the same four strings: all four caught. The tracker #232 row now says CLOSED "mutation-checked" with a list that never tried these. Fix: property-write matcher `\.style\.([A-Za-z][\w-]*)\s*(?:[+\-*/|&?]{1,2})?=[^=]`; add to the unscoped ban `Object\.assign\(\s*[^,)]*\.style\b`, `\.style\s*=[^=]`, and `setProperty\(\s*[^'"\s)]` (non-literal first arg); re-run these four plus the six above; amend the tracker row's mutation list. Test-strength only, no runtime effect.
- SUGGESTION 1 - unbound client arms (verified by reading only): dropping the bell removal in the confirmed-disabled arm (watch.js:2783), the `else if (bellBtn)` unsubscribed arm (:2832) and the cache write-through (:2672) all stay GREEN across watch-init-behavioral, uploader-channel-link, watch-pin-from-channel and capability-cache. The existing harness cannot reach the confirmed pass (hydration stops after /api/videos in the shim). The PATCH body `{"pushBell":true}`, the label-from-response, the cache write-through and the 403-leaves-label arm WERE driven green in the scratch harness above - worth landing as a real test alongside W1's fix.
- SUGGESTION 2 - lib/push/deliver.js:73 `decideDeliveries` still returns `maxId`; deliverRound no longer reads it (summary advances to `lastReadId`); only push-delivery.test.js:30 binds it. Drop or mark test-only.
- SUGGESTION 3 - the plan's D4 / Out-of-scope lines could name the closing mechanism for the `/c/` blind spot (channelId capture on the first poll, :3464 before :3534) so the next reader does not re-derive it.

Gate: CHANGES r1 @7c76380d — adversary

## Gate r1 -> r2 fix record (2026-09-23)

r1 verdicts @7c76380d: security-brief APPROVED; qa CHANGES (W1 watch-page bell arms, W2 lock
strength); adversary CHANGES (W1 same arms, W2 non-integer id counted as progress in the walk
arm, W3 lock strength). Fixes, one commit (the r2 sha in the Gate lines below):

- **W1 (both seats):** public/js/watch.js gains `ensureBell(matchedSub)` / `removeBell()`;
  the applier, `handleUnsubscribe`'s ok arm (removeBell) and the subscribe modal's success arm
  (ensureBell from the POST response, off by default) all route through them; the new record's
  cache write-through carries `pushBell`. Bound by three DRIVEN cases in
  test/unit/watch-init-behavioral.test.js (the shim now records listeners; `buildWatchRealm`
  takes `overrides` so the modal is captured): DELETE 200 removes the bell; modal confirm +
  POST 201 creates it OFF and caches it; the bell tap PATCHes `{pushBell:true}`, relabels from
  the response, writes through, and a 403 leaves the label (adversary S1 landed).
- **Adversary W2:** lib/push/deliver.js walk arm advances + counts `advanced` only for an
  integer id (mirrors the none arm); push-delivery case: 199 muted string-id rows + one
  sendable last -> bounded (<= 2 rounds, <= 1 POST; was 41 rounds / 40 POSTs).
- **W3 / qa W2 (#232 lock):** compound-assignment matcher + unscoped bans for
  `Object.assign(…style…)`, whole-style assignment, non-literal `setProperty`, a style alias;
  probed 7 red / 2 green; tracker row 232 amended.
- **S3:** D4 now names the closing mechanism of the `/c/`-URL blind spot.
- Not taken: qa S2 / adversary S2 (`decideDeliveries.maxId` is still bound by its own unit
  test and harmless), qa S3 (per-round subscriptions memo - a later nicety, the table is tiny
  and rows are manager-generated), qa S5 (viewer-only bell hint - D8 stands, disclosed).

## Gate r2 - qa delta re-confirmation @d7342962

Instruments (verified, Node 22.23.1): `npm run lint:css` TOTAL 0; `npm run lint:overlay` clean (0 violations); `check-markers` 2 issues = the two stale-approval notes (@360f8e7f, @7c76380d) on this active plan, the known r1 artifacts. Targeted unit (push-delivery, ytdlp-store, capability-cache, watch-init-behavioral, ytdlp-subscriptions-client, ambient-glow-engine): 650/650 pass (646 + 4 new). Targeted integration (notifications-api, scan-push-bridge, ytdlp-patch-pause, rbac-subscriptions-flag, backup-restore): 62/62 pass. No em dashes in any added line of the fix commit (grep count 0). Full `npm test` not re-run by this seat.

- **W1 - fixed as prescribed.** `ensureBell`/`removeBell` are the single seam; the applier, `handleUnsubscribe`'s ok arm and the modal success arm route through them, and the cached write-through carries `pushBell`. The three watch-init cases are DRIVEN (the shim now records the last listener per type; the DELETE/POST/PATCH fetches are routed, the modal captured via `overrides`). Binding proven in a scratchpad `git archive` sandbox (the working tree was never touched): with `removeBell()` and the modal's `ensureBell(...)` reverted, `not ok 13` (unsubscribe) and `not ok 14` (subscribe) - 13/15 pass vs 15/15 at HEAD. The S1 case verifies the PATCH body `{pushBell:true}`, the label from the RESPONSE, the cache write-through and the 403 no-flip.
- **W2 - fixed as prescribed (plus more).** Re-probed in the scratchpad against the r2 matchers: all five r1 slips (`+=`, `||=`, aliased `const s = el.style`, `Object.assign(el.style, ...)`, non-literal `setProperty(p, ...)`) now RED, plus `??=` and a style passed to a function; the direct literal and vendor camelCase still red; a legitimate `items.filter(...)` with a trailing `// no transform` comment and the real `background-image` setProperty stay GREEN (9 red / 2 green). Tracker row 232 records the r2 probe.
- **S1 - fixed (adversary W2).** The walk arm advances and counts only an integer id, mirroring the none arm; the comment at deliver.js:229-232 is now true in both arms. The new push-delivery case (199 muted string-id rows + one sendable) is bounded: sent=0 (applyResult refuses the string id), advanced=0, no re-run.
- **S3 - accepted declined** (tiny manager-generated table; a later nicety). **S2 - accepted declined** (`maxId` harmless, test-bound). **S5 - accepted declined** (D8 disclosed). **S4 - fixed** (dead `classList.toggle` gone). **S6 - disclosed** in the r1 record. D4 now names the `/c/`-URL closing mechanism; the pointer resolves (`recordSubscriptionChannelId` write at lib/ytdlp/index.js ~3462).
- **New regression check: none found.** The shim's listener recording adds only an `_l` property; no earlier watch-init assertion snapshots element keys (the file's only deepEquals are `seedCalls` and the PATCH body), and `overrides` defaults to an empty object. The fix commit touches no route, store or RBAC surface: the security posture is unchanged from r1.

Gate: APPROVED r2 @d7342962 — qa

## Gate r2 - adversary delta findings @d7342962

Method: fresh `git archive d7342962` sandboxes under a PRIVATE scratchpad subdirectory (the shared scratchpad's `sb/` was deleted by another seat mid-run in r2; nine baselines of that batch therefore ran with cwd = the working tree, which `git status` proved identical to d7342962 apart from this doc), Node 22.23.1. Working tree already carried the security-brief r2 (APPROVED) and qa r2 (APPROVED) sections, uncommitted, before this seat wrote.

Baselines at d7342962 (measured): push-delivery 29/29, watch-init-behavioral 15/15, ambient-glow-engine 22/22, ytdlp-store 259/259, capability-cache 5/5, ytdlp-subscriptions-client 320/320, uploader-channel-link 9/9, watch-pin-from-channel 4/4; scan-push-bridge 7/7, notifications-api 13/13, backup-restore 25/25, ytdlp-patch-pause 15/15, rbac-subscriptions-flag 2/2. `lint:css` TOTAL 0; `lint:overlay` clean; eslint on the touched files 0 errors; `check-markers` 2 issues = the design approval @360f8e7f and the security-brief r1 approval @7c76380d, both expected until the r2 markers are committed.

r1 findings against the fix:
- **W1 - fixed as prescribed (measured).** `ensureBell`/`removeBell` route the applier, `handleUnsubscribe`'s ok arm and the modal success arm; the r1 repro (DELETE 200 then tap) now shows no bell. Fix-binding mutants: `removeBell()` dropped from the unsubscribe arm -> W1 test A red; `ensureBell(...)` dropped from the modal arm -> W1 test B red; `pushBell` dropped from the modal's cache write -> red; write-through no-op'd -> S1 test red (r1 SUGGESTION 1 closed for that arm). `ensureBell` early-returns on a null `subscribeBtnContainer` (verified by reading; the modal arm respects it).
- **W2 - fixed as prescribed (measured).** All seven r1 spin scenarios terminate: string ids + sendable LAST = 1 round / 1 POST (was 41 / 40); string ids sendable first 1/1; string ids all muted 1/0; int 1 sendable + 199 muted + 5 behind = 2 rounds, 1 POST, cursor 205; int 500 mid-walk = cursor 99, 2 rounds; int summary 500 = cursor 0, 1 round; int 205 all muted = 2 rounds, 0 POSTs, cursor 205. Dropping the new `Number.isInteger(row.id)` guard reds the new push-delivery case (28/29).
- **W3 - fixed as prescribed (measured).** `Object.assign(back.style, {filter})`, `back.style.filter += ...`, `back.style.filter ||= ...`, `setProperty(p, ...)` with a variable, `back.style = '...'`, and `var st = back.style; st.filter = ...` are ALL red on the lock assertion now; `[].filter()` + trailing `// transform` comment and a style READ (`var w = back.style.opacity;`) stay green. Tracker row 232 amended.
- r1 S3 taken (D4 names the closing mechanism). S2 declined (`decideDeliveries.maxId` dead but harmless, bound by its own unit test) - agreed. qa S3/S5 declined - agreed, no refutation.

Full r1 mutant set re-run at d7342962: deliver.js M1-M8, server.js M11/M12, store.js M14/M15/M16/M16b, subscriptions.js M17/M17b/M17c, common.js M20, CSS C1/C2 all RED as before; C3 green as required.

New, introduced by the fix (measured in a scratch copy of the watch-init harness):
- **WARNING 1 (new, argued safe to ship DISCLOSED) - public/js/watch.js:2679-2708 `handleToggleBell` reads LIVE `bellBtn`/`currentBellState` after its await, so `removeBell`/`ensureBell` firing while the PATCH is in flight leave a dangling label.** Race A: tap the bell, tap Subscribed (DELETE 200) before the PATCH settles -> `removeBell` nulls `bellBtn`; when the PATCH settles (404 in prod) `.finally` throws `TypeError: Cannot set properties of null (setting 'disabled')` (an unhandled rejection in the console; the bell is already gone, so nothing visible). Race B: tap the bell, unsubscribe, re-subscribe via the modal (POST 201, new id, `pushBell:false`) all before the PATCH settles; the old PATCH resolves `{pushBell:true}` -> the NEW subscription's bell reads "🔔 Notifying" and the cache's new record is written `pushBell:true` while the server's record is OFF. Why disclosed-shippable: three taps inside one request's flight, no data loss, the label and cache self-heal on the next watch load (the confirmed fetch overwrites both), and the server's truth is never wrong. Fix (three lines, a slim follow-up or fold-in): capture `const btn = bellBtn; const subId = currentBellState.subId;` at click time and bail in `.then` and `.finally` when `bellBtn !== btn || currentBellState.subId !== subId`; bind with the two races above (the harness now supports them: a PATCH whose promise the test resolves after the DELETE/POST).
- SUGGESTION 1 - the S1 test's "label follows the RESPONSE" is a lookalike: the route echoes `body.pushBell`, so `on: next` (ignoring the response) stays GREEN (mutant M19b). Have the fake route return a value that differs from the request (or a clamped one) to bind the response.
- SUGGESTION 2 - test/unit/ambient-glow-engine.test.js:398 alias ban `[=,(]\s*ident\.style\s*[,;)\n]` false-trips a plain truthiness read: `if (back.style) { ... }` in the engine reds the lock (measured). Exempt a `.style)` preceded by `if (`/`&&`/`||`, or accept and note it.
- SUGGESTION 3 (carried from r1 S1) - the applier's confirmed-disabled removal (:2811) and the applier's `else removeBell()` (:2848) still survive deletion across watch-init-behavioral + uploader-channel-link (the harness cannot reach the confirmed pass; hydration stops after /api/videos in the shim). Verified by reading only.

Gate: APPROVED r2 @d7342962 — adversary

## Gate close (2026-09-23)

All three seats APPROVED r2 @d7342962 (security-brief, qa, adversary). Shipped DISCLOSED,
per the two-round gate norm, as tracker #233: the adversary's r2 WARNING 1 (a bell PATCH
still in flight when the user unsubscribes / re-subscribes can throw in `.finally` on a
nulled button, or relabel + cache the NEW record from the OLD response; three taps inside
one request, no data loss, server truth never wrong, self-heals on the next watch load) with
its 3-line fix (capture button + subId at click, bail after the await when either moved),
plus adversary S1 (the S1 test's echoing fake route makes "label follows the response" a
lookalike - return a differing value) and S2 (the alias ban false-trips a bare
`if (el.style)` truthiness read). Adversary S3 / qa S6 stand as disclosed.

Dual-Node full suites at 72f1eab7 (the gate-closed tip): Node 22.23.1 8992/8992 exit 0; Node 24.20.0 (recorded in the release commit message).
