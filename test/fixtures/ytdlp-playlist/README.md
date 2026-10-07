# yt-dlp flat-playlist fixtures (v1.369.0 W2)

Captured with yt-dlp 2026.08.19 on the dev box on 2026-10-07 (the plan's T0,
docs/exec-plans/active/2026-10-06-v1369-playlist-picker.md section 7), with
`yt-dlp --flat-playlist -J --playlist-end 200 -- <url>`.

- `example-list-PLUtyNbQXMTLg.json`: VERBATIM stdout for Dean's example list
  (`/playlist?list=PLUtyNbQXMTLg`, 24 entries, `playlist_count` 24).
- `missing-list.stderr.txt`: VERBATIM stderr for a list that does not exist
  (exit code 1; stdout was `null`).
- `uploads-page2-trimmed.json`: page 2 (`--playlist-start 201 --playlist-end
  400`) of a 476-entry list, TRIMMED to 4 entries (the first three and the
  one with no duration, a past live stream); every kept entry and every
  top-level field is verbatim except `requested_entries`, which was dropped.
- `mix-as-video-subset.json`: a Mix link (`list=RD...`) answers as ONE video
  (`_type` video). A SUBSET of the verbatim object (id, title, `_type`,
  channel, duration, webpage_url); the full object is a 650 KB single-video
  dump that nothing here reads.

Private and deleted entries were not in any captured list. The tests derive
them from a verbatim entry using the shape yt-dlp's own source gives them
(`yt_dlp/extractor/youtube/_tab.py` `_extract_video`: the title is YouTube's
renderer text, "[Private video]" / "[Deleted video]"; `availability` comes
from the row's badges and is often null).
