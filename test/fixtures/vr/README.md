# VR / 360 fixtures (v1.366.0, W4)

Tiny real files for the 360 view: every one is a 2 s, 5 fps clip of a 512 px wide grey panorama with
four colour bands at known longitudes (front = red, centred at x 256; right = green, x 384; left =
yellow, x 128; back = blue, at both edges). Made 2026-10-05 with ffmpeg 7.0.2-static (`lavfi color` +
`drawbox`; this build has no `drawtext`, so the sides are labelled by colour, not letters) and Google's
spatial-media injector (github.com/google/spatial-media, master, run with python 3.12 in a /tmp venv).

| File | How | What ffprobe 7.0.2 reports |
|---|---|---|
| `vr-360-v1.mp4` | `spatialmedia -i pano.mp4` (v1 XML uuid box) | Spherical Mapping, equirectangular |
| `vr-360-v2.mp4` | `spatialmedia -i -2 pano.mp4` (v2 sv3d) | Spherical Mapping, equirectangular |
| `vr-360-tb-v2.mp4` | the panorama stacked twice (512x512), `-i -2 -s top-bottom` | Stereo 3D top and bottom + equirectangular |
| `vr-180-sbs-v2.mp4` | the front half (256x256) side by side twice (512x256), `-i -2 -s left-right -b 0:0:1073741824:1073741824` | Stereo 3D side by side + tiled equirectangular, bound_left 257, bound_right 255 |
| `clip_360_TB.mp4` | the stacked panorama, no metadata (the file-name rule) | no side data |
| `rot90.mp4` | `ffmpeg -display_rotation 90 -i pano.mp4 -c copy` (the rotation control) | Display Matrix, rotation 90 |
| `pano_360.mp4` | the plain panorama (512x256, 2:1), no metadata: 360 by its name; the real-browser row plays it | no side data |

`ffprobe-grown.json` is the real ffprobe output of each file with the grown `stream_side_data` keys
(`rotation,side_data_type,projection,type,bound_left,bound_right`). Unit tests read the side-data
shapes from it, never from hand-typed objects. Regenerate it with the command in its `_comment`.
