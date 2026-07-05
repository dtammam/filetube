# Tech Debt Tracker

## Active

| # | Description | Severity | Added | Source |
|---|-------------|----------|-------|--------|
| 2 | `sweepAgedTranscodes` and `evictTranscodeCache` each do an independent `readdir`+`statSync` over `TRANSCODE_DIR` back-to-back at both call sites (startup + post-produce), a double directory pass per produce. Minor perf; fold into a single shared enumeration if the cache-hygiene path is revisited. | Low | 2026-07-05 | settings-automation-cache review round 1 (PE remediation, non-blocking) |
| 3 | FR3.4's `MAX_RESCAN_FOLLOWUPS=1` rescan-drain bound can DROP a rescan requested during the single follow-up pass, but ONLY when auto-scan is Off (no periodic timer to self-heal). Scenario: `scanIntervalMinutes` Off; scan in flight (pass 1); a rescan is requested (pass 2 = the one allowed follow-up); a `POST /api/config` folder-add lands DURING pass 2 → sets `rescanRequested=true`, but the drain has spent its budget and exits leaving it unconsumed → folder B's media isn't indexed until a manual "Scan now". NO data loss (the folder is persisted in `db.folders`); with the timer On (30m default) the next periodic scan covers it. This is the documented trade-off of bounding FR3.4's livelock. Proposed future fix: when the drain budget is exhausted with `rescanRequested` still set, schedule ONE deferred/rate-limited rescan via a short `unref()`'d timer instead of dropping it — resolves the livelock and the dropped-rescan together. | Low | 2026-07-05 | settings-automation-cache review round 3 (final re-review, converged tail; tech-debt-tracked, no FR4) |
<!-- Items added by agents when persistent failures or gaps are found -->

## Closed

| # | Description | Severity | Added | Closed | Resolution |
|---|-------------|----------|-------|--------|------------|
| 1 | Transcode cache (`data/transcoded/`) grew unbounded — watched AVIs accumulated (~5.6 GB pileup observed) with no eviction | High | 2026-07-04 | 2026-07-04 | Size-capped LRU eviction (`TRANSCODE_CACHE_MAX_BYTES`, default 5 GB) + startup orphan `.tmp.mp4` cleanup + recently-served protection so an actively-watched file is never evicted (feature `avi-ux-refinement`) |
