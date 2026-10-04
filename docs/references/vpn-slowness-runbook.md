# Runbook: finding out what is slow over the VPN

A walkthrough for one job: FileTube feels slow on the phone over the VPN, and you want to know WHICH part
is slow before anything gets built. It uses only what FileTube already has (the performance diagnostics
page, `/diag`, added in v1.307.0). Nothing here changes the app. Plan on about 20 minutes per network, and
a little over an hour for all four.

Every button, label and row name below was copied from the real pages (Settings and `/diag`) on
2026-10-04. If a name on your screen differs, trust the screen and tell Claude.

## 1. What this finds

"Slow" is really several different things, and each has a different fix:

- **The tunnel itself is slow to answer** (every tap waits on a long round trip). Fix lives in the VPN:
  the server location, WireGuard settings, the packet size (MTU).
- **The pipe is too thin** (big things like video arrive slowly). Fix lives in the home internet upload
  speed or in smaller video files.
- **The app asks for too much** (many small requests per page, each paying the round trip). Fix lives
  in FileTube: fewer, bigger requests, compression, caching.
- **The server box is slow** (it would be slow on Wi-Fi too). Fix lives in the server, not the VPN.

The runs below measure each of these separately, first at home without the VPN (the baseline), then on
the VPN, so the difference points at the cause.

Two words used below:

- **Round trip (RTT):** the time for one tiny request to go to the server and come back. Every page load
  pays it many times.
- **Throughput:** how many megabits per second actually arrive. This is what video needs.

## 2. Before you start

1. **Turn the suite on.** In FileTube: Settings > **Experimental** > switch on **Performance diagnostics
   (experimental)**. A button **Open performance diagnostics** appears under it. It is admin only and off
   by default; switch it off again when you are done (it adds a small timing header to every response
   while on).
2. **Use Safari, not the home-screen app.** The `/diag` page and the app tab talk through the browser's
   own storage, so both must be tabs in the same Safari. A home-screen app keeps its own separate storage
   (`docs/references/pwa-ios-notes.md`), so a run armed in one would not record in the other. Sign in to
   FileTube in Safari once if you have not.
3. **Switch off the extra handoff.** Settings > **Experimental** > **Instant background-audio handoff
   (experimental)**: off for these runs. It makes extra requests that would blur the numbers. Switch it
   back on after if you use it.
4. **Same phone, same everything.** Close other apps that download (photos backup, app updates). Keep
   the screen on. Use the same video for every run (pick one longer than 2 minutes).
5. **Write down the VPN details** for the note field: the VPN app, which server or endpoint, and
   (once, from a speed test at home) your home internet **upload** speed. Your phone downloads from
   home, so home upload is the ceiling for everything over the VPN.
6. **Data use.** The throughput probe downloads about 26 MB each time you press it (1 + 5 + 20 MB).
   On 5G that is real data.

## 3. The runs, in order

Do four runs, one per network, in this order:

| Run | Network | Chip to tap |
|---|---|---|
| 1 (baseline) | Home Wi-Fi, VPN off | **LAN** (fills "LAN (home wifi, no VPN)") |
| 2 | Home Wi-Fi, VPN on | **WiFi + VPN** (fills "Home wifi + VPN") |
| 3 | 5G, VPN on | **5G + VPN** (fills "5G + VPN") |
| 4 | 5G, VPN off (only if FileTube is reachable without the VPN) | **5G no VPN** (fills "5G, no VPN") |

Run 2 against run 1 isolates the VPN alone (same internet, tunnel on or off). Run 3 against run 2 adds
the mobile network. Skip run 4 if FileTube is only reachable through the VPN.

For each run:

1. Open `/diag` (Settings > Experimental > **Open performance diagnostics**). It opens in a new tab.
2. Under **1 · Arm a run**, tap the chip for this network (the **Network label** box fills in). In
   **Note (optional - device, signal bars, anything)** write the VPN server, signal bars and anything
   unusual.
3. Tap **Arm run & start recording**. The grey status line turns red: "RECORDING - <label> · scenario:
   (none) · 0 events captured".
4. Make sure no FileTube tab from an earlier run is still open (close it first: an old tab can write
   its old events over this run's). Then tap **Open FileTube in new tab**. In that tab a small red
   **REC** badge shows at the bottom-left while the run records. You will switch between the two tabs.
5. Under **2 · Guided scenarios**, for each scenario in turn: in the `/diag` tab tap its **Set active**
   (it changes to **Active**), switch to the app tab and do it, then switch back to `/diag` straight away.
   A scenario's time runs from its first request to its last, and the app checks in with the server in
   the background (every 30 to 60 seconds), so lingering in the app tab stretches the numbers. The eight:
   1. **Cold app load -> Home**: "Open FileTube fresh in the app tab (or hard-reload). Wait until Home
      fully populates."
   2. **Soft-nav: Home -> Music**: "Inside the app, navigate Home to Music (same-section view swap)."
   3. **Cross-section: Music -> TV**: "Navigate Music to TV (a full-document section load)."
   4. **Open a video (time-to-first-frame)**: "Tap a video. Stop interacting the moment it starts
      playing."
   5. **Seek to the middle**: "While a video plays, seek to roughly its midpoint."
   6. **Scrub a feed row (thumbnails)**: "Scroll a feed row so a batch of thumbnails loads."
   7. **Play ~60s untouched (stalls)**: "Let a video or track play for about a minute without touching
      it."
   8. **Warm reload -> Home**: "Reload Home once more, to compare against the cold load."
   (If you have no TV or Music library, skip that scenario; the rest still work.)
6. Under **3 · Active probes (isolate one variable each)**, tap each and wait for its "done" line:
   **Measure RTT (20×)**, then **Throughput (1 / 5 / 20 MB)**, then **Compression delta**.
7. Close the FileTube tab this run opened, then, in `/diag`, tap **Stop & save**. The line under the
   probes says "Saved run <id>" (for example
   "Saved run 2026-10-04-0310-zxtxn4"). Write the id in the results table (section 7).

The saved run appears under **4 · Saved runs & isolation matrix** with its label, event count ("85 ev")
and scenario count ("2 scen"). **View** shows one run; **Delete** removes it.

## 4. Reading the results

Tick two runs (for example run 1 and run 2), then tap **Compare selected (2)** ("Tick two runs (e.g. LAN
+ VPN) to compare."). The **Isolation matrix** shows one column per run and a last column, **Lever it
points to**. Under it, **Per-scenario detail** breaks down the first column (Wall, API reqs, Total reqs,
Σ TTFB, Bytes, TTFF, Stalls) per scenario.

Read each row as "how much worse is the VPN column than the baseline column". A rough rule of thumb: about
the same means that part is fine; double or more means that part is a real cost.

| Row | What it measures | If the VPN column is much worse here | Lever it points to (on the page) |
|---|---|---|---|
| **RTT wall (median)** | One tiny request, there and back (median of 20, with min and p95) | Every tap pays the tunnel's delay. The VPN route is the problem: try a different VPN server, check WireGuard and its MTU (packet size) setting. A p95 far above the median means it is jittery, not just far. | WireGuard / MTU / VPN endpoint |
| **RTT pipe-only (median)** | The same, minus the time the server spent | Same reading as above, with the server's share removed: this is the network alone. | network minus server compute |
| **Server compute (avg)** | Time the server itself spent per request | Should be about the same in every run. If it is high in the baseline too, the box is slow and the VPN is not to blame. | rules the BOX in or out |
| **Throughput @20MB** | Download speed of a 20 MB file from home | The pipe is thin. Compare with your home upload speed: if they match, home upload is the ceiling. If the VPN number is far below both, the tunnel is throttling. Video needs more than its own bitrate here or it stalls. | mobile rendition / home-upload cap |
| **Compression wire size** | A typical page of data, sent plain vs compressed (shown as plain → brotli, with the saving) | This is what compression WOULD save; FileTube does not compress today. A large saving matters most when throughput is low. | brotli / gzip |
| **Nav fan-out (worst view)** | Requests needed for the busiest page you visited ("28 API reqs, 59 total, 80 ms") | Many requests times a slow round trip = a slow page. If RTT is high and this count is high, fewer requests per page is the fix. | aggregated bootstrap endpoint |
| **Time-to-first-frame** | From "load the video" to "it plays", in the Open a video scenario | Long here while throughput is fine points at the files themselves (see 5.1). Long with low throughput is the pipe. | confirms faststart is fine |
| **Stalls (60s play)** | How often the video paused to wait for data in the Play ~60s scenario, and for how long | Stalls on the VPN but not at home: the pipe cannot keep up with the file's bitrate (FileTube plays the original file; there is no lower-quality version). | adaptive bitrate |
| **Cold vs warm Home** | Home's load time on a fresh open vs a reload | Both slow on the VPN: each page re-checks every file with the server (the app's files are served "no-cache", so every load revalidates). | service-worker shell/thumb caching |

A row shows "-" when nothing in that run feeds it (Stalls needs **Play ~60s untouched (stalls)**;
Time-to-first-frame needs **Open a video (time-to-first-frame)**). **Cold vs warm Home** is different: a
half that was not done prints **0 ms**, so "80 ms cold / 0 ms warm" means the warm reload was not tagged,
not that it was instant.

Some readings put together:

- **High RTT, normal throughput:** pages feel slow, video is fine once it starts. The VPN route or the
  app's request count.
- **Normal RTT, low throughput:** pages are fine, video stalls or starts slowly. Home upload speed or
  the tunnel's bandwidth.
- **Both bad:** start with the VPN endpoint (it affects both), then measure again.
- **Server compute high in every run:** the server box, not the network.

## 5. Extra checks

1. **Slow-starting files.** Some .mp4 files keep their index at the end, so the phone must download far
   into the file before frame one. A read-only check lists them (it changes nothing):
   `docker exec <your container> node scripts/probe-faststart.js --list`. Most worth running if
   **Time-to-first-frame** is long while **Throughput @20MB** is fine.
2. **Stalls on the phone, live.** Settings > **Troubleshooting** > **Show lifecycle debug log**, then
   reload. While a video plays, a `video:waiting` or `video:stalled` line appears each time it runs out of
   data, and a `video:check` line about 6 seconds after each start shows whether frames advance. Newest
   lines are at the top. Switch it off after.
3. **A public speed test,** with the VPN on and off, on the same network. If the VPN halves a speed test
   too, the tunnel is the limit for everything, FileTube included.
4. **Your home upload speed** (a speed test at home on a computer). Over the VPN, the phone can never
   download faster than home can upload.

## 6. What to send Claude

- The run ids (the "Saved run ..." lines), and which network each one was.
- Or the files themselves: each run is saved on the server as `run-<id>.json` in the `.diag` folder of
  FileTube's data directory (DATA_DIR); they stay there after you switch the suite off. While the switch
  is on, the same data is at `/api/diag/runs/<id>` (signed in as an admin).
- Keep these files private (send them to Claude, never post them): a run records your phone's browser
  details, the server's address, your note, and every address the app requested, including searches
  and video ids.
- Your results table (section 7), the speed tests, and the VPN details from section 2.
- Anything that felt slow that no scenario covered.

## 7. Results template

| | Run 1: Wi-Fi, no VPN | Run 2: Wi-Fi + VPN | Run 3: 5G + VPN | Run 4: 5G, no VPN |
|---|---|---|---|---|
| Run id | | | | |
| VPN server / signal | | | | |
| RTT wall (median) | | | | |
| RTT pipe-only (median) | | | | |
| Server compute (avg) | | | | |
| Throughput @20MB | | | | |
| Compression wire size | | | | |
| Nav fan-out (worst view) | | | | |
| Time-to-first-frame | | | | |
| Stalls (60s play) | | | | |
| Cold vs warm Home | | | | |
| Public speed test (down / up) | | | | |
| How it felt (one line) | | | | |

Home upload speed (measured at home): ________

## 8. What FileTube cannot measure today

Said plainly, so a gap is not mistaken for a clean result:

- No record of how much data the app uses over time (no data-usage accounting).
- No server log of slow requests; the timing header exists only while the diagnostics switch is on.
- No compression of its own (the Compression delta row shows what it would save; it does not turn it on).
- No offline or cached copy of pages or thumbnails on the phone.
- No lower-quality version of a video, no quality picker and no data-saver setting: every video plays at
  its original size.
- No page-smoothness measures (long tasks, Web Vitals) and no load testing.
- No timing in the transcode or library-scan logs.

If the runs point at one of these, that is the next thing to build, and the numbers say which one first.
