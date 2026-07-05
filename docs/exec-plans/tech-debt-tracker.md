# Tech Debt Tracker

## Active

| # | Description | Severity | Added | Source |
|---|-------------|----------|-------|--------|
| 2 | `sweepAgedTranscodes` and `evictTranscodeCache` each do an independent `readdir`+`statSync` over `TRANSCODE_DIR` back-to-back at both call sites (startup + post-produce), a double directory pass per produce. Minor perf; fold into a single shared enumeration if the cache-hygiene path is revisited. | Low | 2026-07-05 | settings-automation-cache review round 1 (PE remediation, non-blocking) |
<!-- Items added by agents when persistent failures or gaps are found -->

## Closed

| # | Description | Severity | Added | Closed | Resolution |
|---|-------------|----------|-------|--------|------------|
| 1 | Transcode cache (`data/transcoded/`) grew unbounded — watched AVIs accumulated (~5.6 GB pileup observed) with no eviction | High | 2026-07-04 | 2026-07-04 | Size-capped LRU eviction (`TRANSCODE_CACHE_MAX_BYTES`, default 5 GB) + startup orphan `.tmp.mp4` cleanup + recently-served protection so an actively-watched file is never evicted (feature `avi-ux-refinement`) |
