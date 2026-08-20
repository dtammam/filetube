# Exec plan: Subscriptions redesign (list-first, scale-ready)

Status: ACTIVE
Branch: `feat/subscriptions-redesign`
Target releases: **v1.155.0 = T1 + T2** (Dean's call, 2026-08-20: ship the
scale fix + iOS panels now, device-validate before the nav restructure);
**v1.156.0 = T3 + T4** (toolbar-pills restructure + crispness).
Owner: main session (lean mode)
Design spec: the approved prototype (Artifact `e824d76e-...`), captured below.

## Progress
- **T1 DONE** (v1.155.0): A-Z sectioned list + live search + scrubber; drop
  drag-reorder.
- **T2 DONE** (v1.155.0): channel row -> iOS slide-in settings panel.
- **v1.155.1 hotfix**: the collapse toggle crushed the list (Dean device).
- **T3 DONE** (v1.156, this build): the master-detail menu REPLACED by a pills
  toolbar [Check all][One-off][Activity][+ Add] over the always-visible A-Z
  list; One-off/Activity/+Add open static `.sub-sheet` slide-in panels;
  maintenance moved into the Activity panel; collapse toggle removed (Dean Q1,
  kills the floating-rail jank); desktop = mobile (Q3). Built as OPTION B (a
  fresh pills+panel controller; stopped calling wireMasterDetail for this page)
  per the investigation - the shared component has no open-a-group API and the
  `.sub-sheet` overlay is already desktop=mobile with no media fork.
- **T4 (this view's cold-launch crispness) FOLDS INTO Dean's #2 full-shell
  crispness sweep** (a separate wave) rather than gating v1.156 on it. The list
  already skeletons; the panels are static. So v1.156 ships T3.

## Why

The current Subscriptions page is a master-detail menu whose "Following" pane
holds a FLAT `.sub-row` list. Dean's device feedback: it "feels kinda clunky,"
and critically "how do we deal with someone with 200+ subscriptions? It'd be a
lot of scrolling to get to that bottom set." The flat list plus a
bottom-of-page toolbar does not scale: secondary actions get buried and there
is no way to jump to a channel.

## The approved design (prototype, Dean-confirmed)

A single **master list screen** + **slide-in detail panels** (replaces the
master-detail nav model for THIS page):

- **Sticky top bar** on the master screen:
  - a **search field** (filters channels live by name + handle);
  - a compact **toolbar of pills**: `Check all`, `One-off`, `Activity`, and
    the `+ Add` affordance. These stay pinned so secondary actions are never
    buried under a long list.
- **Channel list**: alphabetical, grouped into **A-Z sections** with sticky
  section headers, plus an **A-Z scrubber rail** on the right (iOS Contacts) to
  jump to a letter. Each row is tappable and opens that channel's settings.
- **Per-channel settings** open as an **in-view slide-in panel** (Q1: no URL /
  no SPA route - avoids the D3 view-level-pushState bug class) with an **iOS
  nav-bar**: centered title + a pinned back arrow that slides the panel back.
  The panel reuses the EXISTING `buildSettingsSheet` field set + save wiring
  (all fields + PATCH logic unchanged) - only the container/chrome/animation
  change.
- **One-off / Add / Activity** each open as the same slide-in panel mechanism.
- **Activity** panel holds Download history + Download failures + a
  **Maintenance** subsection housing the 5 power-user bulk buttons (Q3: Reheat
  metadata, Refresh avatars, Reheat sub counts, Refresh channel names, Preview
  changes) so the top toolbar stays the clean three pills.

### Confirmed decisions (Dean, this wave)
- Q1 = **slide-in panel, no URL** (reuse iOS push-in; avoid D3 SPA-depth risk).
- Q2 = **drop drag-to-reorder** (the list is alphabetical now). Server `order`
  field + `POST /api/subscriptions/reorder` route left intact but unused
  client-side. Disclosed removal.
- Q3 = **maintenance tucked into Activity** under a Maintenance subsection.

## Architecture (current -> new), from the recon map

Current (all in `lib/ytdlp/client/subscriptions.js` + `.../views/subscriptions.html`):
- `.md-root[data-md-page="subscriptions"]` shell, groups Following/Add/Activity,
  wired by `wireMasterDetail` (common.js:4982).
- `createSubscriptionsListElement`/`createSubscriptionRow` build the flat list;
  `wireSubRowDragAndDrop` + `persistReorder` do reorder.
- `buildSettingsSheet` builds a body-appended bottom-sheet (fields: format,
  quality, filetype, cutoffDate, maxDurationSeconds, skipShorts, libraryPlace;
  actions Pause/Repull/Delete/Save; save -> `PATCH /api/subscriptions/:id`).
- History/Failures cards injected at runtime (`data-md-group="Activity"`).
- 5 maintenance buttons loose in the list-header `.action-bar`.

New:
- New master screen (`.subs`): sticky `.subs-topbar` (search + pills) +
  `.subs-sections` (A-Z sections) + `.subs-scrub` (rail) + empty/no-results.
- One reusable **slideover** primitive (`.subs-panel`, translateX push-in, iOS
  nav-bar via reused `.md-detail-head`/`.md-back`/`.md-detail-title` classes)
  hosting: per-channel settings, Add, One-off, Activity.
- Reorder wiring REMOVED (29 client lines per baseline grep).
- Master-detail shell REMOVED for this page (7 `md-*` hooks in the view).

## Task commits (each green before the next; ONE gate over the whole diff)

- **T1 - Master screen: search + A-Z sections + scrubber; drop reorder.**
  Replace the flat list render with grouped A-Z sections (sticky headers),
  a live search filter (name + channel handle/`channelUrl`), and the A-Z
  scrubber (jump via `scrollIntoView`). Rows keep essential info (avatar, name,
  meta/status line, warnings, failures, retry, pin) and remain tappable -> for
  T1 they still open the EXISTING sheet (panel conversion is T2). Remove
  `wireSubRowDragAndDrop`/`persistReorder`/`deriveReorderRowSubs`/
  `buildSubscriptionReorderHandler` + reorder CSS. Empty-state + no-search-
  results state. Poll's in-place row updates (`applyStatusUpdatesInPlace`) must
  still target the correct rows inside sections.
  Tests: new `subscriptions-az-sections.test.js` (grouping/sort/letterOf,
  search filter incl. handle match, scrubber targets, no-results); update
  `ytdlp-subscriptions-client.test.js` row-anatomy where changed; DELETE
  `ytdlp-subscriptions-reorder.test.js` (+ prune reorder asserts elsewhere).

- **T2 - Per-channel settings: sheet -> slide-in panel.**
  Re-parent `buildSettingsSheet` output into `.subs-panel` with the iOS nav-bar
  (centered channel name + back arrow). Keep every field + the patch/save/
  pause/repull/delete wiring byte-for-byte in behavior. Back arrow + backdrop/
  Esc close the panel (slide back). Preserve the FR-1 protection: the poll must
  not clobber an open panel.
  Tests: panel open/close/back, focus + Esc, save-patch shape unchanged
  (reuse existing sheet assertions against the new container).

- **T3 - Toolbar panels + Activity/maintenance; remove master-detail shell.**
  Wire the `Check all` / `One-off` / `Activity` pills + `+ Add`. One-off, Add,
  and Activity render into slide-in panels. Move the 5 maintenance buttons into
  the Activity panel under a "Maintenance" subsection (endpoints unchanged).
  Remove `.md-root`/`data-md-*` from `subscriptions.html` and the
  `wireMasterDetail('subscriptions', ...)` call. Keep History/Failures
  builders + endpoints intact, mounted inside the Activity panel.
  Tests: update `subscriptions-master-detail.test.js` + the subscriptions
  assertions in `master-detail.test.js` (page no longer uses `.md-root`);
  toolbar-pill -> panel wiring; maintenance-buttons-present-in-activity.

- **T4 - Crispness + CSS polish.**
  Skeleton rows on cold load (already exist - keep), no layout shift, sticky
  headers/scrubber paint, reduced-motion honored, design-token census stays
  ZERO (any new value goes through a token + the token-scale-lock authority).
  (The full cold-launch shell shimmer sweep is a SEPARATE wave - this T4 only
  covers this view's own crispness.)

## Predictions (machine-derived; re-verify at every commit)
- Unit baseline now: **5443/5443** pass (fast subset). Net change expected
  positive (new AZ/search/panel tests minus deleted reorder tests).
- Reorder removal touches **29** client lines (baseline grep) -> expect the
  grep for `reorder|Reorder|wireReorderable|persistReorder` in
  `subscriptions.js` to drop to **0** client-side (server route untouched).
- `md-root|data-md-` in `subscriptions.html`: **7 -> 0**.
- Design-token census: **0 -> 0** (ceiling). `npm run lint`, `lint:css`,
  `ledger:check` green.

## Gate
FULL two-reviewer gate (this reworks a live download-managing module and its
save path). Adversarial brief - named attack surfaces:
1. Search/section filter that hides a channel whose download is ACTIVE (does
   the poll still update a filtered-out row? does hiding drop its status?).
2. The panel conversion silently changing the save patch shape (mutation-test
   the field->patch mapping; the 314-case client suite is the anchor).
3. Poll clobbering an OPEN panel (FR-1 regression).
4. A dropped reorder leaving a dead endpoint call or orphaned handler that
   throws on load.
5. Maintenance buttons relocated but a status span / poll binding left dangling.
6. Empty-state vs no-search-results confusion (born-empty vacuous tests).

## Device probes (Dean, after ship)
- 200-channel feel: search filters instantly; A-Z scrubber jumps; sections
  sticky; no scroll-to-bottom for secondary actions.
- Tap a channel -> settings slide in, centered title + back arrow slides back;
  Save/Pause/Repull/Delete still work; edits persist.
- Check all / One-off / Add / Activity pills each open their panel.
- Activity holds history + failures + the 5 maintenance actions.
- A download in progress keeps updating while you search/scroll; opening a
  panel mid-download does not freeze its status.
- Cold PWA launch: skeletons then list, no layout jump.
