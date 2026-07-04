# Tech Debt Tracker

## Active

| # | Description | Severity | Added | Source |
|---|-------------|----------|-------|--------|
<!-- Items added by agents when persistent failures or gaps are found -->

## Closed

| # | Description | Severity | Added | Closed | Resolution |
|---|-------------|----------|-------|--------|------------|
| 1 | Transcode cache (`data/transcoded/`) grew unbounded — watched AVIs accumulated (~5.6 GB pileup observed) with no eviction | High | 2026-07-04 | 2026-07-04 | Size-capped LRU eviction (`TRANSCODE_CACHE_MAX_BYTES`, default 5 GB) + startup orphan `.tmp.mp4` cleanup + recently-served protection so an actively-watched file is never evicted (feature `avi-ux-refinement`) |
