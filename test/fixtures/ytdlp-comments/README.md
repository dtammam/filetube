# yt-dlp comment capture fixtures (v1.394.0)

Captured on the dev box from the pinned yt-dlp 2026.8.17.73947.dev0 (2026-10-23), the
FileTube download argv with "Save top comments" on, video jNQXAC9IVRw:

- `ftcomments-jNQXAC9IVRw.txt` - the real `FTCOMMENTS` stdout line (5,716 bytes: 10 top-level
  comments, `comment_count` 10). Longer than run.js's 4096-character stderr cap, which is why the
  stdout splitter has its own limit (`STDOUT_LINE_LIMIT`).
- `ftchmeta-jNQXAC9IVRw.txt` - the `FTCHMETA` line from the same run.
- `ftcomments-disabled-injected.txt` - the line printed when the YouTube extractor raised
  `CommentsDisabled` (injected by patching `_comment_entries` in the same real run): the `.{}`
  selector drops the None `comments` / `comment_count` keys, so only `id` remains.
