# Roadmap

## Planned

### 🐞 Bugs

- [ ] **Mobile video fullscreen button shifted slightly right** — on mobile, the video fullscreen `#fs-btn` sits a little to the right of where it should (still usable). Likely a knock-on from the v1.24.0 button polish and/or the mobile control-hiding (vol/mute hidden) altering the control-bar spacing. Small CSS positioning fix. _(Dean, noticed on v1.24.0)_
- [x] **"Release date" sort + trust chain** — ✅ SHIPPED v1.33.0: `youtubeId` persisted per item (filename bracket / embedded purl-comment source URL), Reheat gained a LOCAL ffprobe tags pass (embedded date/purl/title, network fallback where an id exists, precedence network > embedded > mtime), bracket-less metube imports now reheat-eligible; sort verified with parity tests. Dean's on-device backfill run is the arbiter of coverage. Merged with the capture item below: verify the whole chain (yt-dlp upload_date capture correctness; local fallback sanity), add release-date capture to REHEAT so Dean's migrated metube-era library backfills (network re-pull and/or local embedded ffprobe tags — the files may already carry date/purl metadata), fix the sort with sensible missing-date fallback. — the Release-date sort option (shipped v1.24.0 as an available sort; local capture v1.24.0, yt-dlp `upload_date`/`release_date` capture v1.24.2) doesn't visibly order the library by release date on-device. Investigate what `db.metadata.releaseDate` actually holds: local files may only carry the weak mtime fallback (or nothing), and the yt-dlp `releaseDate` only lands on items downloaded/re-pulled AFTER v1.24.2 — so pre-existing items likely have no captured date at all. Check (a) the `sortItems` release-date case reads/compares the value correctly, (b) how many items actually have a populated `releaseDate`, and (c) whether an additive backfill from metadata the scan already has is warranted (no re-processing pass — thumbnail-backfill lesson). **Capture ACCURACY (Dean, v1.24.6):** beyond the sort not visibly working, Dean suspects the captured value itself may be wrong — "the source looks odd." So verify the whole chain end-to-end, not just the sort: is yt-dlp's `upload_date`/`release_date` actually landing as the correct epoch-ms on the right item (spot-check a known video against its real upload date), and is the local-file fallback (embedded ffprobe date → mtime) producing a sane value or a garbage/near-now timestamp? The real deliverable is a `releaseDate` you can trust, then the sort. _(Dean, noticed on v1.24.2; accuracy concern added v1.24.6)_
- [x] **Video PWA experience on app-minimize** — ✅ RESOLVED per Dean (2026-07-12): "we worked through it, it's better now." Reopen with fresh on-device specifics if it degrades again. — on the installed iPhone PWA, backgrounding / app-switching away from a playing VIDEO and returning has degraded recently (Dean, on v1.24.7). "Flakier" needs on-device specifics when picked up (video not resuming, losing position, black frame / not repainting on return, not pausing/resuming cleanly, MediaSession state, or the player host not re-mounting). Because it's a regression, first bisect against the recent player-lifecycle changes: v1.24.4's T12 **synchronous host reparent** on SPA nav, v1.24.4 T13 resume/dock changes, and the v1.24.5/.6 mobile CSS (`html { overflow-x: clip }`, dock/overlay rules) — any of which could interact with iOS's inline-video suspend/`visibilitychange`/`pagehide` handling. Grounding: FileTube pauses video + saves position on background via `shouldPauseForLifecycleEvent` (audio keeps playing via MediaSession); the persistent single `<video>` host is reparented across FULL/DOCKED/close. Related to the parked "Background audio for video" item below (same lifecycle surface). **Concrete repro (Dean, v1.24.7):** (1) previously he could **exit/minimize the app and playback would CONTINUE** (background audio kept going); **now it STOPS** on exit — a real background-playback regression. (2) Pressing **Play from the iOS media controls / lock screen (MediaSession)** is now **hit-or-miss** (flaky). Both symptoms point at the player LIFECYCLE + MediaSession binding, and the strongest suspect is v1.24.4's **T12 synchronous persistent-`<video>`-host reparent** on SPA nav — reparenting the media element can drop/not-re-establish the `MediaSession` action handlers (`setActionHandler('play'/'pause')`) and can trip iOS's "user gesture / same element" rules that keep background audio alive, which would explain BOTH the stop-on-background and the flaky remote Play. Verify the MediaSession handlers are (re)bound to the live host after every reparent/load. **KEY clarification (Dean):** it DOES still work if he **full-screens the video (the NATIVE iOS video player) and locks while that native player is focused** — so the reliable background path is the native fullscreen/PiP video element (iOS grants native video players background audio), while the **INLINE custom player gets suspended by iOS on background** (the fundamental inline-web-`<video>` limitation). That reframes it: this is less a pure T12/MediaSession bug and more the inline-vs-native background-video reality. It ties DIRECTLY to two items below — **"Optional mobile control style — custom bar vs native iOS"** (native controls would give free fullscreen + background audio) and **"Background audio for video"** (the PiP / audio-context levers). Open question to settle first: is it a genuine regression (did the INLINE player used to keep audio alive on background and a recent change — audio-mode/MediaSession/lifecycle — broke it) or has inline always required fullscreen? If regression → bisect the audio-mode/MediaSession/`shouldPauseForLifecycleEvent` handling; if fundamental → the real fix is a design call (native mobile controls, or a PiP/hidden-`<audio>` background approach), NOT a quick patch. Daily-use degradation. _(Dean, noticed on v1.24.7; repro + native-fullscreen clarification added same day)_

### 🎬 Player / mobile UX

- [x] **Force-closing the PWA doesn't stop video background audio** — ✅ RESOLVED per Dean (2026-07-12): "no longer a problem." — after v1.25.2 made mobile VIDEO keep its audio playing in the background (native iOS fullscreen/PiP path), Dean found that **force-closing** the PWA (fully killing the app from the app switcher) leaves the video's audio **still playing** — it shouldn't. IMPORTANT distinction he made: this is about **force-close/kill**, NOT backgrounding/app-switching (backgrounding keeping audio alive is the intended v1.25.2 feature and is correct). So the bug is specifically: a hard app-kill should release the audio session / stop playback, but iOS is keeping the native media session alive past the kill. Likely needs an explicit teardown on `pagehide`/`unload`/`freeze` that stops+releases the media element / audio session (or an investigation into whether iOS surfaces a kill signal to the web app at all — it may only reliably fire `pagehide`). Tie this into the v1.25.2 background-audio lifecycle (`handleBackgroundLifecycle`/`inNativeFullscreen`) and the next-batch native-AUDIO switch below — Dean raised it in the same breath ("for next batch if we switch iOS audio"). _(Dean, on-device 2026-07-10)_
- [x] **Rotating landscape→portrait pauses a playing video** — ✅ RESOLVED per Dean (2026-07-12): "playback better." — in STANDARD (non-fullscreen) mode, playing a video and rotating the phone to landscape keeps it playing (great) — but rotating BACK from landscape to portrait PAUSES it. Dean wants playback to continue through the rotation both ways. Root-cause the orientation/resize handling in `player.js` (there's orientation code ~`:2159/2168/2177` and the lifecycle/`applyControlsMode` path touched by v1.25.2's native-controls work) — something on the landscape→portrait transition issues a pause (possibly a spurious `shouldPauseForLifecycleEvent`/visibility/resize trigger, or a native-controls/fullscreen state flip on rotate). The fix: don't pause on an orientation change when the video is simply playing inline. Verify it doesn't regress the intended background-pause behavior (rotation ≠ backgrounding). Likely interacts with the v1.25.2 native-controls + lifecycle changes, so test alongside them. _(Dean, on-device 2026-07-10)_

- [x] **Optional mobile control style — custom bar vs. native iOS** — ✅ CLOSED per Dean (2026-07-12): the player/mobile-UX cluster is "considered good" as it stands. — the whole v1.22.x mobile-player arc landed on ONE hardcoded answer: mobile uses our custom control bar everywhere (video + audio), because native inline iOS controls auto-hide / re-reveal unreliably under our gesture layer (see v1.22.1). It works well now — but Dean isn't sure he loves the custom bar on mobile and may prefer **native iOS controls** there, accepting the trade-offs. Rather than re-litigate one global default, make it **optional / device-aware**:
  - A **setting** (and/or env/config) to pick the mobile control style: **custom bar** (today — era theming, the loop toggle, the persistent 1×–2× speed button, click-art-to-play, a cohesive retro look, one consistent bar across audio + video) vs **native iOS** (`<video controls>` — free full-screen / scrubber / playback-speed / AirPlay / PiP and the familiar iOS feel, but loses the themed bar + loop + speed-button styling + click-art, and reintroduces the inline auto-hide quirk the custom bar was chosen to avoid).
  - Consider a **device-based default** (e.g. native on iOS, custom on desktop) with a manual override — so it "just works" out of the box but stays a deliberate, overridable choice, not a silently-locked one.
  - **Scope/notes:** this reopens the mobile-VIDEO native-vs-custom decision from v1.22.0 / v1.22.1 (their exec plans are in `docs/exec-plans/completed/`). Mobile AUDIO would likely stay custom regardless — there's no native audio-fullscreen concept, which is exactly why v1.22.2 built the CSS "expanded now-playing" view. Reuse the existing shared form-factor helper (`resolveMobileFormFactor` / `isMobileFormFactor`) as the single detection seam; do not introduce a second "is this mobile" signal.
  - _(Deferred by Dean — "I don't know that I want to do it now / have the capacity." Captured so the custom-bar default stays a conscious choice we can revisit, with the option to hand control back to the user or the device.)_
- [x] **Test native iOS controls for mobile AUDIO** — ✅ CLOSED per Dean (2026-07-12): considered good as-is. — v1.25.2 switched mobile VIDEO to native iOS controls (FULL state) and Dean loves what the native iOS player gives — **chapters + CC** and the overall native experience. He wants to TEST doing the same for mobile **AUDIO**: flip it from the custom bar to native `<audio controls>` (mirroring the video change), as an experiment to see if the native audio experience is better. NOTE the nuance from the v1.25.2 work: audio has no native "fullscreen" concept (that's why v1.22.2 built the CSS "expanded now-playing" view), and native `<audio>` is a plain play/scrubber bar — so verify on-device whether native audio actually surfaces chapters/CC (those may be a video-track/fullscreen feature) before committing. Reuse the same `applyControlsMode`/`isMobileFormFactor` seam v1.25.2 used (the gate there is `mobile && isVideo && FULL` — this would extend/branch the `isVideo` case for audio). Ties into the deferred "Optional mobile control style" toggle above (this is the audio half of that decision) and the v1.25.2 native-video work. _(Dean, on-device 2026-07-10 — "I love the chapters and cc and what we get out of the iOS player… let's test changing it back to native like we did with video")_
- [x] **Background audio for video (keep playing on lock / app-switch)** — ✅ SHIPPED in **v1.27.0** (see Shipped) as the Lever-3 video→hidden-`<audio>` swap, behind the **"Background audio for video (experimental)"** setting (default OFF — flip it in Settings whenever you're ready to test; the sequencing + mutual-exclusion requirements below were honored). **AWAITING DEAN'S ON-DEVICE VALIDATION** — see the Shipped entry's checklist. Original item kept below for context. — today mobile VIDEO pauses when you lock the screen or switch apps (iOS suspends inline web video, so FileTube pauses cleanly + saves position via `shouldPauseForLifecycleEvent`), while AUDIO keeps playing (background audio + MediaSession). Dean wants videos to OPTIONALLY keep playing their **audio** in the background, YouTube-Premium style. **Not trivial on iOS web** — Apple blocks background inline video; the only levers are native Picture-in-Picture (limited on iPhone) or swapping the video to an audio context / hidden `<audio>` on background (fragile, iOS-version-dependent). Treat as exploratory, scope carefully. **On-device confirmation (Dean, 2026-07-10, on v1.25.6 w/ native controls):** FULLSCREEN video → lock or app-switch → **keeps playing** (the reliable v1.25.2 native path works). INLINE (non-fullscreen main-page) video → lock → **pauses** (finicky/inconsistent resume). So "must be fullscreen" is the missing link for _proper_ background play — Dean wants inline to keep going too. A delta/feasibility analysis is underway (levers: auto-PiP-on-background [likely gesture-blocked], auto-fullscreen-on-background [gesture-blocked + jarring], video→hidden-`<audio>`-swap on background [most promising, fragile], or simply NOT pausing inline + relying on MediaSession [only works if iOS doesn't suspend regardless — the crux]). Same lifecycle surface as the force-close-stops-audio bug + rotation-pause fix — design together. **DELTA ANALYSIS DONE + DEAN'S DECISION (2026-07-10): FIX IT.** Verdict: our `pause()` is NOT the sole cause — iOS suspends any inline element with a video track regardless (proven: same `<video>` element + same route keeps audio-track-less mp3 items alive but suspends video). Levers 1/2/4/5 (auto-PiP, auto-fullscreen, don't-pause, WebAudio) are all DEAD on iOS 2026 (user-gesture wall or no-op). **Lever 3 (swap video → hidden audio-only playback on background) is the ONLY viable mechanism** — but it's a real BACKEND feature: a new audio-only serve endpoint (FFmpeg audio extraction + a transcode-cache sidecar, mirroring `transcodedPath`) + a hidden `<audio>` element + a dual-element position-swap/re-sync state machine, and its key property (survives lock) is iOS-version-dependent + the swap-in `play()` may itself hit the gesture wall — so it needs Dean's on-device validation and may need iteration. Dean chose to build it anyway (not just the fullscreen-hint alternative). **SEQUENCING (mandatory):** land the **force-close-stops-audio** teardown FIRST (a backgrounded-and-playing swap element is exactly the leak force-close-stop must kill), and keep the new background path MUTUALLY EXCLUSIVE with the fullscreen/PiP path (`inNativePresentation`) so the two "keep playing" mechanisms don't double-fire and fight over the element. Reuse the `isAudio` conceptual boundary rather than forking a third state. _(Dean — "I want us to fix it", 2026-07-10)_
- [x] **Player flash on Prev/Next** — ✅ CLOSED per Dean (2026-07-12): considered good as-is. — not FOUC, but a brief moment where the player isn't visible when tapping Prev/Next. The persistent single `<video>` host should stay mounted continuously across SPA navigations; investigate why prev/next briefly blanks/re-shows it (likely the watch-view re-render tears down and re-mounts the host, or the new media load clears the frame before the poster/first frame paints). Keep the player element continuously visible across the navigation. _(Dean)_
- [x] **Skip the resume prompt for short saved progress** — ✅ CLOSED per Dean (2026-07-12): considered good as-is. — if saved playback is within the first ~1 minute, don't show the "Resume at…" prompt — just start from the top. `shouldShowResumeOverlay` currently prompts at >5s; raise the threshold (e.g. skip under ~60s) and expose it as a Settings option. _(Dean)_
- [ ] **~~Tapping the mini-player doesn't reliably restore FULL from video~~ (DISREGARDED — likely a one-time close/reopen fluke)** — Dean saw the docked mini-player not restore the video once, but after closing/reopening the app couldn't reliably reproduce it and said to disregard it — not a confirmed bug. Only revisit if it recurs consistently; do NOT spend time on it now. _(Dean, 2026-07-10 — disregarded)_
- [x] **Resume prompt is too small in the docked MiniPlayer** — ✅ CLOSED per Dean (2026-07-12): considered good as-is. — when a "Resume at…" prompt fires while the player is DOCKED (mini-player), the overlay renders inside the tiny docked box and is too small to read/tap. Handle it better: e.g. suppress the resume prompt while docked and only show it in FULL (or auto-resume in the mini-player), or expand the player to FULL when a resume decision is actually needed. _(Dean)_

### 📱 Mobile polish — residual (v1.23.0 shipped the quick wins)

- [x] **Subscriptions-page base zoom** — ✅ RESOLVED in v1.24.6. The subs page rendered "slightly more zoomed out" because a **stale `.mobile-logo` favicon `<img>`** (an unstyled, uncapped 512px SVG) was left behind on only the subscriptions shell, blowing its mobile header past the viewport → iOS fit-to-width shrink. Deleted it (restoring four-shell parity) + added an `html { overflow-x: clip }` shell guard so every page pins to 1.0 zoom. _(Dean — was low-priority "interesting"; fixed while chasing the broader per-page-zoom inconsistency)_
- [x] **"Playlists" label clarify** — ✅ RESOLVED (appears already satisfied): the bottom-nav Playlists control renders a "Playlists" text label under its icon, which is what the ask described. Reopen with a specific affordance if Dean meant a different control. _(clarify — closed as satisfied at the v1.83 roadmap reconcile)_
- [ ] **Subscriptions page slightly too large on mobile (NOT zoom)** — distinct from the zoom item above: the subs page's content/elements render a touch oversized on mobile (padding / font / row sizing), not a viewport-zoom issue. Tighten the mobile sizing on the subscriptions view. _(Dean)_
- [ ] **Favicon still not showing on all browsers** — the v1.22.2 PNG `rel="icon"` fallbacks helped but some browsers still don't pick it up. Add a real multi-res `favicon.ico` (the format legacy/some desktop browsers reliably use for tabs + bookmarks) and re-check the full `apple-touch-icon` / `sizes` / `shortcut icon` set across all four shells. _(Dean)_

### 📥 Downloads / yt-dlp UX (v1.23 candidate — Dean)

- [x] **Share button for yt-dlp items** — ✅ SHIPPED v1.33.0 (watch-page Share → native share sheet with the original YouTube link, clipboard fallback): a Share affordance on downloaded YouTube items that triggers the native share sheet with the ORIGINAL YouTube link (derivable from the bracketed video id / embedded purl-comment metadata), so Dean can send people the real video he downloaded. navigator.share with clipboard fallback.
- [x] **Accept share-sheet URL params in the one-shot download API** — ✅ SHIPPED in **v1.28.0** (see Shipped). Root cause was NOT just `?si=`/`?is=` (a single tracking param already passed) — Dean's iOS Shortcut error `channelUrl contains whitespace or disallowed characters` was FORBIDDEN_CHARS hitting glued quotes / a second `&`-param. A normalization pre-step in front of the unchanged guard now strips wrapping punctuation, extracts the URL from mixed text, drops the fragment, and rebuilds the query allowlist-style (only `v`/`list` survive). _(Dean)_
- [x] **Shorts URL not recognized for one-off download** — ✅ SHIPPED in **v1.28.0** (see Shipped). `/shorts/<id>` (+ `/live/`, `/embed/`) now classify as single videos for EXPLICIT one-off downloads only — gated behind an `allowSingleVideoShapes` opt so they can't leak into the subscription-add path (a gate finding); canonicalized to a plain watch URL via `buildWatchUrl`; the per-subscription skip-Shorts filter is untouched. _(Dean)_
- [x] **Make yt-dlp errors visible + obvious** — ✅ SHIPPED in **v1.29.0** (see Shipped). The real yt-dlp stderr reason (bot-check/429/age-gate/members-only) is now surfaced live AND persisted across restart instead of a generic exit-code-1, one failed video no longer fails the whole channel (honest partial-success with per-item reasons), a durable capped JSONL run log + `/subscriptions` history view record why runs failed, and anti-bot pacing flags (`--sleep-*`/`--retries` + a cookie-missing warning) target the exit-1 spike itself. _(Dean)_
- [x] **Cancel an in-progress download from the main page** — ✅ shipped for ONE-SHOTS (chip Cancel while downloading, v1.24.0 A3); Dean explicitly rejected a stop/cancel affordance for SUBSCRIPTION downloads on the chip (v1.24.9 reframe) — pause on the subs page is the intended control. Closed as decided. — add a cancel affordance (on the home status chip) that aborts a running download: cleanly kill the spawned yt-dlp process (arg-array spawn, no orphan), mark it **cancelled** (not failed), and reflect it in the status UI. Needs a cancel endpoint + process-handle tracking. _(Dean)_
- [x] **Clearer download progress** — ✅ COMPLETE across v1.29–v1.32: real reasons + durable history (v1.29), active-downloads chip conformance (v1.30), queue positions + phase-named timeouts (v1.31), check-noise cut + breaker line + reason-rendering history rows (v1.32). Original text kept below for the record. — make in-progress downloads' progress more visible + obvious (percent, speed, ETA, per-item), not just a terse status chip. Pairs with the visible-errors + cancel items above into one richer download-status surface. _(Dean)_ **PARTIALLY ADVANCED in v1.29.0:** honest per-item failure attribution + a durable download-history view + visible retry/"queued behind current run" now surface WHY and WHAT happened; the corner-chip active-downloads reframe below (the "N downloading 0%" noise → tappable active indicator) is the remaining open half.
  - **Concrete symptom (Dean, on v1.24.3, many subscriptions):** the status constantly reads a noisy aggregate like **"193 downloading 0%"** — apparently every pending item across all subscriptions lumped into one count that sits at 0%, with no clarity on what's actually happening. The fix is the same richer surface: show which channel / which video is actually downloading (vs merely queued), real per-item progress, and a sensible queued-vs-active distinction — not one big "N downloading 0%" number. Ties directly into the A-cluster download-status work (per-item attribution / clearer progress); land it with the **Wave 5** yt-dlp download-status pass. _(Dean, noticed on v1.24.3)_
  - **SHARPENED DIRECTION (Dean, on-device 2026-07-10):** after understanding how polling works, Dean realized the "192 queued" corner chip is effectively just "how many active subscriptions will download videos" — a count he can't (and doesn't want to) interact with or stop, so it reads as pure noise ("a noisy little thing in the corner that shows something I can't really interact with most of the time"). He can already PAUSE subs on the subscriptions page (which he did), so a stop-affordance on the chip isn't wanted (and he explicitly does NOT want the queued-item cancel/dequeue that was offered). The desired reframe: the corner chip should surface **ACTIVE downloads** — what's ACTUALLY downloading right now (0/nothing when idle, since subs serialize to ~1 at a time) — as a real, **tappable** indicator that expands to show the current download(s) + their progress/attribution. I.e. replace "N queued (subs)" with "active downloads" (tap → see the actual in-flight download), not a big static queued count. This supersedes/redefines the corner-chip half of this item; the richer per-item progress surface still applies to what the tap reveals. _(Dean, on-device 2026-07-10)_
- [x] **Surface a "Re-pull all channels" action** — ✅ effectively shipped: the "Check all" button lives in the subscriptions header action row, and v1.32's page restructure (version/breaker at top, collapsible list) keeps it above the fold. Reopen only if Dean still finds it buried. — make the manual re-pull (poll-now for every subscription) more prominent / higher up and easy to reach, rather than per-channel-only or buried — one clear "check all subscriptions now" button. _(Dean)_
- [x] **Subtitle grab + closed captions** — ✅ SHIPPED and confirmed by Dean (2026-07-12): "subtitles are grabbed / CC works." — grab subtitles / closed captions for downloads (yt-dlp `--write-subs` / `--write-auto-subs`, with language + format selection, as an embedded track or a sidecar `.vtt`/`.srt`) and render them in the player as a toggleable **CC track**: a `<track kind="captions">` on the persistent `<video>` plus a CC button on the control bar (convert `.srt` → `.vtt` server-side if needed). For LOCAL files, also pick up a sidecar subtitle file sitting next to the media. _(Dean)_
- [x] **Preserve emojis in yt-dlp video display titles** — ✅ SHIPPED v1.33.0: verification showed it WAS broken by design (`--restrict-filenames` strips emoji at download; true title never captured). Fixed: `title` captured off the FTCHMETA print line → sanitized `sourceTitle` supersedes the filename-derived display title; Reheat backfills real titles for existing items. — filename sanitization is stripping/altering emojis that were in the original video title, so the displayed name isn't the real title. The on-disk FILENAME can stay filesystem-safe, but the DISPLAY title should be the true video title with emojis intact — likely by capturing the real title from yt-dlp metadata (same mechanism as the channel-identity/avatar capture) and rendering that as the display name, instead of deriving it from the sanitized filename via `cleanDisplayTitle`. Don't let filename sanitization degrade what the user sees. _(Dean, noticed on v1.24.2)_

### 📚 Library & discovery

- [x] **Move files between folders** — ✅ SHIPPED and confirmed working by Dean (2026-07-12). — let the user move a file to another folder from the UI (e.g. relocate a yt-dlp download elsewhere in the network / into a curated library folder). Server-side: a move endpoint that `fs.rename`s within the mounted volumes (fall back to copy+delete across devices/mounts) and updates `db.metadata` filePath + any thumbnail/transcode/progress keyed off it; must be fail-safe (validate the target is under a configured/allowed mount, never escape the sandbox — same confinement discipline as the delete + yt-dlp paths) and interact cleanly with the next scan (a moved file must not look like a delete+new-add that loses watch progress). UI: a per-item "Move to…" picker over the known folders. _(Dean — "move something I downloaded with yt-dlp somewhere in my network")_
- [x] **Show item count per view / folder / playlist** — ✅ shipped v1.24.0 (item-count badge, `renderItemCountBadge`), preserved through the v1.30 pagination rewrite (`updateItemCountBadge` reads the server `total`). — display how many files are in the current view (a folder, playlist, channel, or the home list) — e.g. a "N videos" / "N items" count in the section header. _(Dean)_
- [x] **Format toggle — videos / audio / both** — ✅ shipped v1.24.0 (persisted preference), forwarded server-side by v1.30 pagination and honored by the v1.32 Liked view. — a toggle (or filter chips) on the library that switches the list between **videos only**, **audio files only**, or **both**. The item type (audio vs video) is already known per file, so this is primarily a client-side filter + a persisted preference. _(Dean)_
- [x] **Fun stats page** — ✅ SHIPPED and confirmed by Dean (2026-07-12): "works, and we have the page." — a dedicated stats / "insights" page so people can view information about their library: counts + total duration + total size, breakdowns by folder / channel / type, longest / shortest / newest, maybe most-watched (would need lightweight view tracking). Presented in a fun retro-dashboard style, on-brand with the era themes. _(Dean — "I want people to view information")_
- [x] **Release-date default sort (real-YouTube feed)** — ✅ SHIPPED v1.34.0: release-date is the out-of-the-box home order AND a "Default sort order" Settings dropdown makes it user-choosable (explicit per-browser dropdown picks still win in that browser).
- [x] **Use the YouTube channel's icon as its folder icon** — ✅ SHIPPED and confirmed by Dean (2026-07-12): "channel avatars are icons, we got this." — when a yt-dlp channel has an avatar, fetch + store it (yt-dlp can surface the channel thumbnail) alongside the channel identity, and render it as the icon for that channel's folder everywhere the folder is shown (sidebar, playlists, etc.) in place of the generic folder glyph. _(Dean)_

### 🎨 Visual polish

- [x] **Typography/UX homogenization** — ✅ SHIPPED v1.30 as the CONSERVATIVE token sweep (12 exact-value `--fs-*` tokens, zero literal font-sizes, pixel-identical render, 16px floor guarded). A deliberate visual RE-scale (actually changing sizes for consistency-by-eye) was NOT done — reopen as a new, explicitly visual item if Dean wants that. — Dean's post-v1.27.2 polish ask: "make text sizing, button fonts, and text all homogeneous so that it's a consistent UX throughout." Approach like the v1.26 branch: AUDIT first (every font-size/font-family/weight declaration across style.css + JS-injected styles + the 5 shells, grouped into a type scale — expect drift: hardcoded px sizes, per-surface one-offs), PRESENT the proposed unified scale (e.g. a small set of CSS custom-property size/weight tokens per era theme) to Dean as options, THEN implement as a token-driven sweep so future surfaces inherit instead of re-declaring. Mobile-first; don't regress the 16px input floor (v1.26.2) or the era-theme character. _(Dean, 2026-07-11 — "the next things" wave)_
- [x] **Like button → auto-add to a designated playlist** — ✅ SHIPPED: watch-page Like → server-side `db.liked` membership (v1.30); the Liked playlist surfaced in the sidebar + Playlists sheet with its own grid view (v1.32). — a "like" affordance on items (watch page + maybe cards); liking adds the item to a specific playlist (e.g. "Liked") so repeat favorites are one tap away — YouTube-style. Scope when picked up: where the like state lives (db.metadata flag vs. just playlist membership), the playlist plumbing that already exists for pins, unlike = remove, and where the button surfaces without crowding the watch actions row (which has overflow history — see v1.25.6). _(Dean, 2026-07-11 — "considering a future thing"; capture now, scope later)_
- [x] **Consistent user / uploader avatar icons** — ✅ SHIPPED v1.30 (deterministic hash color, real captured avatar wins; the glyph stays the first letter per unanimous gate-reviewer consensus, GD-1 — revisit only if Dean wants a richer identicon). — the uploader/channel avatar is currently just the first letter uppercased. Give each "user"/channel a consistent, deterministic generated icon (identicon-style, or a stable color + glyph derived from the channel name) so the same channel always shows the same avatar — more fun + recognizable, on-brand retro. (Ties into the "use the YouTube channel's real icon" item above — real avatar when available, generated one as the fallback.) _(Dean)_
- [x] **More elegant buttons (less blocky)** — ✅ SHIPPED v1.30 (era-token radius, tighter padding, era-aware shadow; tap targets untouched). Awaiting Dean's on-device feel verdict (AC7.6) — reopen if it doesn't land. — the blocky beveled buttons are on-brand retro, but Dean wants them a touch more refined/elegant: subtler bevels/rounding, tighter spacing + typography, cleaner hover — a polish pass that keeps the era-theme system and the 2000s character, not a redesign. _(Dean)_
- [x] **Subscriptions-list channel avatar (F1 fallback tail)** — ✅ SHIPPED v1.30 (rows + settings sheet route through the shared `resolveAvatarSource`). — the subscriptions-management page (`lib/ytdlp/client/subscriptions.js` — the `.sub-row-avatar` list rows + the per-subscription settings-sheet header) still shows the plain first-letter-uppercased avatar, unlike the sidebar / playlists / watch page which now render the real captured (or deterministic generated) channel avatar. v1.24.2's T11 already populates `sub.channelAvatarUrl` on every subscription record, so this is a small wiring task: route `createSubscriptionRow` + the sheet builder through `resolveAvatarSource(sub.name, sub.channelAvatarUrl)` the same way `buildPinAvatarNode` does (may need a small `.sub-row-avatar img` CSS rule — the classic client-file ownership pairing). Pre-existing Wave-1 F1 gap (T3 only owned `common.js`, never `subscriptions.js`), surfaced by the v1.24.2 gate; **Dean deferred to a follow-up** (2026-07-09). _(QA gate finding, deferred)_

### 🔐 Accounts & security

- [x] **Multi-user + permission-gated deletion (adds auth)** — ✅ SHIPPED across **v1.43.0** (auth wall: first-run admin setup, login/session with signed cookies, scrypt password hashing, per-user state), **v1.80.0** (RBAC per-user library VISIBILITY over all four libraries + `canManageSubscriptions` enforcement — the kid-safe account), and **v1.81.0** (write-RBAC: the `canModifyLibrary` capability gates delete / move / edit / scan / cache / trash — a member browses + plays but never deletes; admin bypasses via role). The permission model is admin vs. member (no third role). ONE deviation from the original ask, disclosed: it shipped as a **mandatory** auth wall (once an admin exists, login is required), NOT an optional LAN-only no-auth mode — the read-only safe-mode lever (`FILETUBE_READONLY`, v1.42) covers the "nobody can mutate" case instead. _(Dean — the v1.42→v1.44 multiuser tranche, finished v1.80/v1.81)_

### 🧪 Testing / infra

- [x] **Broaden core test coverage** — ✅ MAJOR PASS SHIPPED v1.33.0 ("eat our vegetables"): the transcode EXECUTION path finally tested (stub-ffmpeg-on-PATH harness — CI has no ffmpeg, which is why it was never covered): lazy 503 → queue drain → atomic finalize → Range, corrupt-source failure, live pipe, download bypass, reconcileTranscode healing; plus config validation, thumbnail fallback/escaping, cache-clear in-flight protection. Remaining thin spots (settings side-effect matrix, subtitles endpoint wiring) tracked as ordinary follow-ups. — the core app's scan/config/transcode logic + HTTP endpoints have thinner coverage than the yt-dlp module. Backfill unit + smoke tests. _(partially progressed)_

### 🧹 Tech-debt (see [docs/exec-plans/tech-debt-tracker.md](docs/exec-plans/tech-debt-tracker.md))

- [x] **yt-dlp prune/mount-loss deep redesign** (#10) — ✅ PARTIALLY CLOSED v1.33.0: Dean's Option C shipped globally (`detectVanishedRoots` — empty-but-present mountpoint = unmount signature, protect don't reap; escape hatch = remove the folder from Settings). Cases 2–3 (changed download-dir orphaning, disabled+transient unmount) remain in the tracker. — treat "a root's entire content vanished at once" as an unmount signature globally so an empty-but-present mountpoint can't reap library entries/watch-progress.
- [ ] **yt-dlp narrow-config edges** (#12–14) — dedup-collapse discards a duplicate alias's ephemeral progress; download-dir == a mapped folder loses its mount-loss row; cosmetic title-clean when the download dir is an ancestor of a library folder. Mitigated by "use a dedicated download dir."
- [ ] **v1.20.0 channel-capture edges** (#16–18) — a manually-named `[<id>].mp4` under the download root can absorb an unconsumed channel identity; the subscription fallback records identity for failed-download survivors; `channelDir` discloses an absolute server path. All LOW/bounded.
- [ ] **v1.22.0 FR-2 folder-match hardening** — the creator re-association matches an item's parent dir to a subscription's `channelDir` by exact string equality with neither side `realpath`-resolved, so a symlinked download dir silently no-ops the backfill (safe under the never-overwrite guard — a missed heal, not corruption); and two subscription names that sanitize to the same folder can first-match mis-attribute. Both LOW. _(adversarial-review follow-up, v1.22.0)_

## Shipped

### v1.234.0 - Pop the music player out into a floating window (desktop) (2026-09-01)

Dean's ask right after the wheel-scroll: let a desktop listener do "Picture in Picture" -
the iPod (or any) skin floating, appropriately sized, in the browser. A "Pop out" button
on the desktop music toolbar floats the player into a small window showing the user's
PICKED skin (Cider/Nordic/Pocket Classic/Black). Best-available: the Document
Picture-in-Picture API where supported (Chrome/Edge = always-on-top, over everything);
a plain independent `window.open` window elsewhere (Safari/Firefox = movable, not
always-on-top). Hidden on mobile (the phone already gets the in-tab full-screen skin) and
where neither mechanism exists.

The pop-out is a SECOND skin surface reusing the existing engine: the same button-proxy
(`bindSkinSurface`), render (`paintSkin`), and live-reflect (`reflectAllSkins`) drive it,
so **player.js is byte-unchanged** (audio/MediaSession/background all stay in the main
tab). The key trick: the skin CSS is gated behind `@media (max-width: 768px)`, so a
~380px pop-out window makes every skin render at its phone layout with zero re-styling -
and because the wheel gesture is Pointer events, the iPod wheel spins with a MOUSE
click-drag in the pop-out.

FULL two-reviewer gate, both seats APPROVE after a two-round fix cycle. QA caught an
async-open TOCTOU (a Document-PiP grant resolving after the view is destroyed would leak
a frozen, uncloseable always-on-top window); both seats caught a both-surfaces-live edge
where resizing the window narrow while the pop-out is open shared the wheel state. Fixed
by making `mountPopout` the single async funnel that re-gates on BOTH the view-alive and
the desktop-viewport checks, plus a resize listener that tears the pop-out down when the
window goes narrow - so "only one skin surface is ever live" is now an enforced invariant,
every arm mutation-bound. Known gap disclosed (tech-debt): T1's refactor of the shared
skin wiring. Dual-Node 8023/0 (Node 22 + 24). **Device pending** - the narrow-window
skin-render and the real Chrome/Edge always-on-top behavior are Dean's on-device call.

### v1.233.0 - The iPod click wheel really scrolls (2026-09-01)

Dean's ask after the v1.232 polish arc: "as soon as it's released let's do the wheel
scroll!!!!!" The iPod skin's click wheel is now a real ROTARY gesture. With the song
list open, spinning the wheel moves a selection CURSOR song-by-song; the center button
plays the highlighted song; a fast flick ACCELERATES (jumps several). In Now Playing the
spin does nothing (list-only, Dean's spec). Tapping a row still plays it, and the wheel's
tap zones (MENU/prev/next/play) are unchanged. Authentic touch: the blue selection bar
now follows the cursor (the row you're scrolling to) while the playing track keeps just
its ▶ marker, so you still see what's playing as you scroll.

Built against this repo's most expensive bug class (the v1.160/v1.163 gesture scars):
Pointer events, not touch, so there is NO global non-passive listener (the v1.160.1
scroll-perf scar); listeners are added on pointerdown and torn down on both pointerup and
pointercancel with capture taken lazily (v1.163); direction is re-evaluated every move,
never latched (v1.160.3); and the release's stray click is swallowed once by a
self-clearing flag that never eats a later tap. **player.js byte-unchanged** (the skin
only proxies to the hidden controls / plays via playAt).

FULL two-reviewer gate (both seats, given the gesture risk): both APPROVED. QA caught a
rare wheelSpin leak if the panel re-renders mid-gesture (fixed: render-time reset + an
identity-guarded teardown). Adversarial caught a two-finger jitter (fixed: pointerId
filter, behaviorally bound) and that the dead-center radius was untested (now bound with a
real-rect stub); every fix-round mutant went red. Known gap (disclosed, tech-debt #189):
the acceleration MULTIPLIER VALUES are source-locked only, not behaviorally bound (jsdom's
synchronous dispatch pins the clock so speed can't be varied) - a wrong value would only
over/under-shoot and clamp to a valid row. Dual-Node 8009/0 (Node 22 + 24). **Device
pending** - the feel (sensitivity/accel) is Dean's on-device call to tune.

### v1.232.5 - iPod list shows the whole album, opens on the current song (2026-09-01)

Dean device: in the iPod list you could only scroll up to earlier songs when the
current track was song 1 - otherwise the list started near the current, so nothing was
above. Now the iPod list is the whole album (from track 1; a wide current-centered
window if the queue is huge) and opens scrolled to the current song, so earlier tracks
are above (scroll up) and later below. Spotify's "Next in queue" stays upcoming-only.
player.js byte-unchanged. Slim gate (adversarial): APPROVE - a scroll-centering math
fix (subtract the container offset, mirroring the default panel) + source-locks applied,
all mutation-confirmed. Dual-Node 7990/0. **Device pending.**

### v1.232.4 - Seek bar resets cleanly on prev/next (2026-09-01)

Dean device: skipping tracks made the seek bar fill then abruptly refresh. Cause - the
fill kept the previous track's width during the load gap (it was only written when a
duration was known), then snapped. Now it drops to 0 and fills as the new track plays
(bound to loadstart/emptied/durationchange for a prompt reset); the remaining-time
label clears the same way. All four skins. player.js byte-unchanged. Slim gate: APPROVE,
one non-blocking suggestion applied (bind the label-reset axis too). Dual-Node 7988/0.

### v1.232.3 - Lock the page behind the player; calm the black iPod shine (2026-09-01)

Two device fixes:
- **The page no longer scrolls behind the full-screen player.** Dragging the skin body
  used to move the page behind it (body overflow:hidden doesn't stop iOS touch-scroll);
  now `touch-action:none` on the panel locks it, while the iPod song list and Spotify
  queue still scroll (pan-y). Verified in a real headless browser during the gate.
- **The black iPod's shine is calmer** - dropped the bright bottom-right glow, kept the
  soft top-left highlight.

CSS-only; player.js byte-unchanged. Slim gate (adversarial): APPROVE, no findings (the
reviewer measured the touch behavior in Chromium). Dual-Node 7987/0. **Device pending.**

### v1.232.2 - Silver Pocket Classic gets its gloss (2026-09-01)

Dean wanted the silver iPod (Pocket Classic) to have a sheen like the black one. A
white-on-white sheen is invisible, so the silver gloss is built from a crisp top
highlight + a soft bottom-edge shadow (the domed, reflective look). Silver-only (the
black variant keeps its own finish). +2 gloss tokens. player.js byte-unchanged. Slim
gate (adversarial): APPROVE, no findings (one pre-existing test-hygiene note logged as
tech-debt). Dual-Node 7986/0. **Device pending** (final legibility on the white body).

### v1.232.1 - Skin polish: rock-solid iPod screen, scroll on all skins, cheeky names (2026-09-01)

A batch of live device fixes + tweaks (Dean, same session):
- **The iPod screen can no longer resize** - the song list used to push it "out of
  bounds"; it's now locked to its shape (contain:size + min-height:0 + overflow), and
  the list scrolls inside.
- **Scrolling titles on every skin** - long song / artist / album names now scroll on
  Apple and Spotify too, not just iPod (reduced-motion still keeps them still).
- **Apple's dismiss handle** is a bigger tap target (the little pill was hard to find).
- **Spotify's play button is centered** now (it sat slightly left of center).
- **Cheeky skin names** instead of the real brands: **Cider** (the Apple-style skin),
  **Nordic** (Spotify-style), **Pocket Classic** and **Pocket Classic (Black)** (iPod).

player.js byte-unchanged. Slim gate (adversarial): APPROVE, two non-blocking comment/
copy suggestions applied + re-confirmed. Dual-Node 7986/0. **Device pending.**

### v1.232.0 - Black iPod skin, scrolling titles, no wheel tap-flash (2026-09-01)

Dean's three next-branch asks (built overnight, pre-authorized):
- **A black iPod** - a 4th pickable skin ("iPod (Black)") in the Settings picker: the
  space-black body + dark click wheel, same white screen and classic layout. It reuses
  the silver iPod's structure and only re-paints the body/wheel, so both stay in sync.
- **Scrolling titles** - long song / artist / album names now slowly scroll to reveal
  the full text, like a real iPod (constant speed; respects "reduce motion", where they
  keep their ellipsis instead).
- **No wheel tap-flash** - the grey highlight that appeared when you tapped a wheel
  button is gone, so the click wheel feels seamless.

player.js byte-unchanged. Slim gate (adversarial): APPROVE, two non-blocking suggestions
applied + re-confirmed (a bound duration-floor test + the black skin's picker blurb).
Dual-Node 7983/0. **Device pending.**

### v1.231.1 - iPod polish: compact screen, real glyphs, glossy sheen (2026-09-01)

Dean's device pass on v1.231.0 ("85% there"): the iPod screen was too tall (a big
empty white area), the wheel's skip icons rendered as blue iOS emoji, and the body /
wheel lacked the classic Apple gloss. Fixes (flat, no tilt, per his call):
- The LCD is now a compact ~4:3 screen at the top (the empty area was a bug - the
  screen was stretching to fill instead of holding the iPod's screen ratio); the body
  and wheel take the space below, matching the real proportions.
- The wheel's rewind / forward / play use clean gray SVG line-glyphs instead of the
  unicode characters iOS was turning into blue emoji (a test guards against regressing).
- Added the glossy Apple sheen to the body and the click wheel.

player.js byte-unchanged. Slim gate (adversarial): APPROVE, one non-blocking WARNING
(a test-completeness gap on the play glyph) applied + re-confirmed. Dual-Node 7979/0.
**Device pending:** on a small phone the compact screen could clip the tail of the
lower meta line - eyeball note. **Queued next (Dean):** a black iPod skin, marquee-
scrolling long titles, and removing the wheel's tap-highlight.

### v1.231.0 - A real click-wheel iPod; every button works; full-screen player (2026-09-01)

Dean's device pass on the skins: they work, but the decorative buttons felt broken,
the iPod wasn't bold/authentic enough ("beige tan not pure white"), and the app
header showing over the player was awkward. He approved a click-wheel iPod mockup and
these fixes (mockup: https://claude.ai/code/artifact/374aaf6c-8c92-4448-8a89-1316f98373de).

- **iPod rebuilt to the real Classic** (his reference photo): a warm-white glossy body,
  a black-bezelled LCD showing the authentic Now Playing screen (cover left; title /
  artist / album / ★★★★★ / "N of M" right; the glossy blue Aqua scrubber) OR the song
  list, and a flat **gray click wheel**. The wheel is tap-zones (not a scroll gesture,
  by design): MENU steps back (list -> Now Playing; Now Playing -> exits the player -
  the way out, no header needed), prev / next, bottom = play/pause; the center Select
  opens the list (tap a row to play). Play state shows in the status bar (▶/❚❚).
- **Every visible control is real** (Dean's rule). Removed Apple's fake ⋯ and bottom
  icon row (a grab handle dismisses) and Spotify's fake repeat + ♡. Spotify's shuffle
  now actually shuffles (it drives the real Shuffle-all).
- **True full-screen.** All three skins now cover the FileTube header for an immersive
  player; the grab handle / MENU is the way back.

Same engine - player.js byte-unchanged; the new controls proxy to the hidden ones.
The iPod palette was replaced wholesale (48 -> 54 skin tokens, all value-locked).
Slim gate (adversarial): APPROVE, no findings, two non-blocking suggestions applied +
re-confirmed (a killed mutant + a dropped dead marker class). Dual-Node 7979/0
(Node 22.23.1 + 24.14.0).

**Deferred (Dean's OK for now):** dragging the scrubber to scrub; a real rotational
click-wheel gesture (a candidate follow-up - it's a non-passive touch gesture that
deserves its own careful wave). **Dean's device pass PENDING** (the wheel geometry +
full-screen feel are on-device items).

### v1.230.0 - The Music-skin picker moves to the Settings page (and actually shows up) (2026-09-01)

Dean rebuilt v1.229 and couldn't find the skin picker anywhere - "I don't see it in
the You menu at all." Two problems: (1) the account menu builds ONCE at load and the
skins module (music-skins.js) was only loaded on two pages (Home + Music), so if the
first page loaded was anything else, `window.FileTubeMusicSkins` was absent when the
menu built and the row never appeared - and never rebuilt; (2) he expected the
control on the Settings page, where Theme and Icons live.

- **A "Music skin" picker on the Settings page** (Appearance, beside Theme/Icons),
  reusing the same card style: Apple Music / Spotify / iPod, the current one
  highlighted, applied and remembered per-device on click (no Save). The copy notes
  it applies to the phone Music player. Visible on desktop and phone.
- **Root cause fixed:** music-skins.js now loads on EVERY app shell that runs
  setup.js (books/history/podcasts/read/setup/stats/tv/watch added to the existing
  home/music), so the registry is always present when the picker renders. A test
  enforces the invariant (any shell with setup.js must also load music-skins.js), so
  this class of "picker silently empty" can't come back.
- **Removed** the v1.229 account-menu picker entirely, plus the live-re-render event
  it used (the Music view re-reads the chosen skin the next time it renders, so no
  event is needed).

Same engine - player.js byte-unchanged. No token change (the Settings picker reuses
existing appearance tokens). Slim gate (adversarial): APPROVE, no findings, 8 mutants
verified. Dual-Node 7975/0 (Node 22.23.1 + 24.14.0). **Dean's device pass PENDING.**

### v1.229.0 - Switch music skins from the account menu; drop the buggy in-player switcher (2026-09-01)

Dean's on-device report on v1.228: "So it works but I can't switch themes... once I
get to one of the themes the controls disappear." He identified the vanishing
"controls" as the in-player theme-switcher chips (they rendered faint/near-invisible
against some skins), and asked for switching to live in the menu.

- **A "Music skin" picker in the account menu.** The avatar dropdown now carries a
  three-way segmented control (Apple / Spotify / iPod) right beside Theme, with the
  current skin highlighted. Tap one and an open now-playing re-skins live. It's a
  per-device appearance choice (like Theme), remembered on the device, and **shows
  only on a phone** (the skins are phone-only) - it's absent on desktop.
- **Removed the in-player switcher chips** - the unreliable control Dean saw vanish.
  Switching now has one reliable home (the menu), so the disappearing-chips bug is
  gone at the source. The play / prev / next / scrubber controls are untouched.

Mechanism: the menu picker persists the choice and fires a `ft-music-skin-changed`
event; the music view listens (torn down with the view) and re-renders instantly.
The picker reuses the app's existing design tokens (no new ones); removing the chips
dropped 3 skin tokens (51 -> 48). Same engine - player.js byte-unchanged.

**Disclosure.** The "Music skin" row appears in the account menu only on pages that
load the music module - the Music page and the home feed - not on, e.g., the
Podcasts or Read pages (where the skin never shows anyway). Switch it from Music or
Home.

Slim gate (adversarial, presentation + a per-device pref): APPROVE, no findings
(one disclosure-only note, above); every binding mutation-verified. Dual-Node 7970/0
(Node 22.23.1 + 24.14.0). **Dean's device pass PENDING.**

### v1.228.0 - Bolder mobile music skins: three that actually look different (2026-09-01)

Dean's device read on v1.227: "it doesn't really feel like much of a difference
between the three... the same theme with three colors. Buttons same, text same."
He was right - the three skins shared one render structure and diverged only in CSS
colour, so they read as one player. This wave rebuilt each skin's LAYOUT, not just
its palette, so they're now genuinely distinct:

- **Apple** - art-first. A blurred, scaled-up wash of the cover fills the whole
  screen behind a large framed cover; an oversized heavy title with a hot-pink
  artist line; one big round white play. No track list - it's about the art.
- **Spotify** - dense and green. A bold purple-to-black canvas, a fat title, a full
  control row (a green circular play flanked by shuffle / prev / next / repeat), and
  a raised dark "Next in queue" panel with album-art thumbnails right on the screen.
- **iPod** - a real throwback. A brushed-aluminum title bar, a framed cover with a
  white mat, centred classic type, a chunky segmented aluminum transport cluster, a
  scrubber with a chrome knob, a classic blue-highlight track list with chevrons,
  and an "N of M" footer.

Also fixed the small thing Dean flagged - "there's scroll behind this... I see the
scroll bar on the page move": the full-screen skin now locks the page behind it, so
scrolling only moves the player's own list.

**Still the same engine.** As in v1.227, the skins are pure presentation over the
existing player - player.js is byte-unchanged across the whole wave, so background
play and lock-screen controls keep working exactly as they did. Phone-only; desktop
is untouched.

**Gate.** Slim gate (adversarial seat, presentation-only, engine untouched) - APPROVE
with two non-blocking suggestions, both applied and re-confirmed: a resilience note
on the new page-scroll lock (it can't be view-scoped, so it leans on the same
class-clear v1.227 hardened), and making the iPod collapse control a real keyboard
button. The bespoke skin palette grew 43->51 tokens, all held to the byte-exact
value-lock contract. Dual-Node 7968/0 (Node 22.23.1 + 24.14.0).

**Known gaps (disclosed, unchanged from v1.227).** The dock mini-bar still isn't
skinned (the mini returns you to the full skin); the scrubber still has no
keyboard-seek handler. **Dean's device pass PENDING** - the pixel feel of the bold
rebuild is the point, so expect an on-device tweak pass.

### v1.227.0 - Mobile music player: three pickable skins over one engine (2026-08-31)

Dean's big wave. The mobile-only music now-playing is now a user-pickable SKIN -
**Apple Music** (big art on near-black, pink accent), **Spotify** (purple->black
wash, green now-playing accent), or **iPod** (warm cream/aluminum, framed cover,
classic blue tracklist) - switchable from a segmented control in the now-playing.
Mockup approved (https://claude.ai/code/artifact/033b8ee3-bc04-4f27-9a87-3df589a6b204).

**The one architectural rule that made it safe:** KEEP the battle-won audio engine,
build a new PRESENTATION on top. The skin is pure chrome that PROXIES to the
player's existing hidden controls (play->#pp-btn, prev/next->#track-prev/next-btn,
seek->#seek-bar's full commit+save pipeline) and REFLECTS #media-player state - it
never calls audio / MediaSession / background-audio. **player.js is byte-unchanged**
(both gate seats verified), so background play + the lock screen are unreachable
from this diff. Gated strictly on mobile (matchMedia 768px) + music
(resumeMode==='music'); desktop and all non-music (video/podcast/book) are
untouched - double-gated (a body class AND @media, AND scoped to the music view).

**What the full gate caught (both seats APPROVE after one fix round).** The
adversarial seat found a real CRITICAL: `body.mms-on` leaked across an in-app
navigation, so after the skinned music page a video/podcast/book would render in a
collapsed 0-height player (they share #player-slot) - fixed by clearing the class on
view teardown AND scoping the takeover CSS to the music view. QA caught the 43 new
skin-palette tokens skipping the value-lock contract (now locked byte-exact) and a
seek comment that lied (fixed by routing seek through the real seek-bar pipeline -
so a skin scrub now saves position properly).

**Known gaps (disclosed).**
- The **skinned dock mini-bar** is deferred to a fast follow - the existing mini
  already returns you to the full skin; this ships the three full-screen skins +
  picker (Dean's core ask).
- The scrubber has no keyboard-seek handler yet (minor a11y follow-up).
- The **skins' pixel feel is device-pending** - the mockup was static; this is the
  first cut on the live engine and will want Dean's on-device tweak pass.

Full two-reviewer gate (QA + adversarial, both APPROVE, one fix round). Dual-Node
7966/0 (Node 22.23.1 + 24.14.0). **Dean's device pass PENDING.**

### v1.226.0 - Theatre now-playing no longer shoves "Jump back in" down on return (2026-08-31)

Dean device pass on v1.225: in THEATRE (up-next beside the player), returning via
the mini-player, the layout was right for ~1/4s then "Jump back in" (and the tabs/
content) got shoved down. Root cause: the up-next panel, filling with a 10-chapter
album, grew TALLER than the player art and grew the whole side-by-side flex stage,
pushing everything below it down.

Fix (measure the container, per the norm - never guess a CSS-var height):
`updateNowPlayingPanel` MEASURES the `#player-slot` height (in the same rAF as the
current-row scroll) and caps the now-playing panel to it in theatre; the panel is
`min-height:0; overflow:hidden` and its `.mnp-queue` flex-fills + scrolls, so
filling the up-next scrolls INSIDE the capped panel instead of growing the stage -
the stage stays the player's height and nothing below shifts. Cleared off-theatre;
recomputed on the theatre toggle. The v1.224 non-theatre 44vh cap is untouched, and
the shared podcast panel is unaffected (all rules id-scoped to
`#music-nowplaying-panel`).

Slim gate (adversarial seat, APPROVE; off-theatre + podcast untouched, mechanism
sound, all source-locks mutation-bound; its one SUGGESTION - a stale 68vh comment -
fixed). Dual-Node 7952/0 (Node 22.23.1 + 24.14.0). **Dean's device pass PENDING**
(the pixel behavior is device-only verifiable).

### v1.225.0 - Up-next scroll settles after the list grows + ♪ on pinned channels (2026-08-31)

Two follow-ups from Dean's v1.224 device pass (item 1 scroll-to-song and the
channel-view ♪ both confirmed working).

**1. Up-next scroll settles.** v1.224's scroll-to-playing-song "worked for a second,
then the list grew taller and pushed the song out." Dean confirmed the LIST itself
grows: the panel can render compact then re-render with the fuller queue, and the
synchronous scroll landed on the pre-growth layout. Fix: defer the scroll to
`requestAnimationFrame` so `offsetTop` is read after the final layout (the last
render's frame wins); synchronous fallback where rAF is absent.

**2. ♪ on a pinned channel.** The ♪ "Show in Music library" now appears when a
PINNED sidebar channel is clicked, not only the home->channel path. Root cause: a
pinned channel navigates via `?root=<dir>` (renderPinnedSidebar), not `?folder=`,
and the ♪ gated on `folderFilter` only. Fix: derive the channel folder as
`folderFilter` else - on a `?root=` view - the single `folderName` the loaded items
share (correct by construction; a multi-channel root gets no single mark). Write
stays server-gated by `requireModifyLibrary`.

Slim gate (adversarial seat, APPROVE, combined wave; RBAC airtight, stale-closure
safe). Dual-Node 7951/0 (Node 22.23.1 + 24.14.0). **Dean's device pass PENDING.**
Disclosed nuance: the Downloads aggregate `?root=` view can show the ♪ for one
channel if page 0 is a single channel (a UX-precision eyeball, not a defect).

### v1.224.0 - Music now-playing nits: scroll-to-song, bounded Up next, ♪ on the channel view (2026-08-31)

Three Dean device nits after v1.223 (a fourth - the Jump-back-to-video-watch
routing - is a separate cross-cutting decision, deferred pending Dean's call on
route-to-Music vs keep-music-out-of-the-video-continue).

**1. Scroll to the playing song.** The whole-queue Up next (v1.223) puts played
history above the current row, so the song you just picked could be off-screen.
The panel now scrolls the (bounded) queue box to the `.is-current` row on render -
scrollTop only, never the page.

**2. Bounded Up next.** `#music-nowplaying-panel .mnp-queue` gets a `44vh` cap +
overflow (scoped to music, not the shared podcast panel), so in non-theatre it's a
self-contained scroll area instead of flowing past the fold and clipping the last
row. Theatre keeps its larger 68vh.

**3. ♪ toggle on the channel view.** The "Show in Music library" ♪ appeared only on
the Downloads folder view, not the home->channel view. Root cause: it gated its
render on an audio file being in the LOADED page, so a channel whose first page is
videos hid it. Now it renders on any `?folder=` view for a library-write user and
uses the server's `hasAudio` (from the music-flag call it already makes) as the
authority - revealed when the folder has audio, removed when it does not. The write
route stays server-gated by `requireModifyLibrary` (no RBAC change).

Slim gate (adversarial seat, APPROVE, one round of its own SUGGESTIONs applied:
scoped the Up-next cap off the shared podcast panel; hardened the toggle
source-lock). Dual-Node 7950/0 (Node 22.23.1 + 24.14.0). **Dean's device pass
PENDING** (the three nits + a check that the podcast now-playing panel is unchanged).

### v1.223.0 - New albums surface in Recently added + Next Up shows the whole queue (2026-08-31)

Two Dean asks after v1.222.

**1. New YouTube downloads surface in "Recently added."** Root cause was a real
data seam: media items store `addedAt` as a NUMERIC epoch (birthtime/mtime), but
native music tracks store an ISO STRING, and every music "newest" sort
(`sortTracks` / `groupAlbums` / `groupArtists` via `sortGroups`) compares `addedAt`
as a STRING - so a projected download's numeric `addedAt` aggregated to `''` and
sank to the BOTTOM of newest (repro: a fresh mix landed below a Jan-2026 native
album). Fixed at the seam source: `projectAudioItem` normalizes `addedAt` to ISO
(`addedAtToIso`), range-guarded so an out-of-range epoch degrades to `''` instead
of throwing. One change fixes the album, artist, AND song newest sorts.

**2. "Next Up" shows the whole queue.** The panel listed only tracks AFTER the
current, so it shrank as you played. It now lists the whole queue - already-played
tracks greyed (`.is-played`, 0.55 opacity, restored on hover) but still clickable
to jump back, the current one marked, the rest up next.

**What the slim gate caught (adversarial, APPROVE after one fix round).** The
whole-queue list capped at 200 rows anchored at the queue START, so a deep current
index (the Songs tab loads up to 1000) would fill the panel with only played rows -
no current marker, no up-next. Fixed: the 200-row window is anchored near the
current track (`ci-20` history + current + up-next). Also verified: `addedAtToIso`
is throw-safe on garbage, native ISO ordering is unregressed, titles are escaped,
and the shared panel builder leaves the podcast panel unchanged.

Slim gate (adversarial seat, APPROVE, one fix round). Dual-Node 7949/0 (Node
22.23.1 + 24.14.0). **Dean's device pass PENDING** (Recently-added ordering + the
Next Up look).

### v1.222.0 - Chapter-album polish: art, album-in-search, desktop theatre, recently-played (2026-08-31)

Four Dean asks after v1.221's chapter-albums landed and he loved them.

**1. Chapter-album art.** A virtual chapter-track's id is `<mediaId>::c<idx>` with no
file of its own, so `/albumart/<chapterId>` fell to the grey placeholder. It now
strips the `::c<idx>` suffix and serves the shared file's thumbnail, re-gated by the
same `mediaVisibleTo(baseItem)` + `hasThumbnail` check (a chapter of a blocked file
still 404s to the placeholder). One fix covers the album tile, the search card, and
the recent-artist tile.

**2. Album in search.** A music result's byline was the artist alone; it now reads
"Artist . Album" (appended only when an album is present; the album is escaped).

**3. Desktop theatre.** A music-owned Theatre toggle (the watch page's button is
watch-only) lays the album / up-next panel BESIDE the expanded player on desktop
(>=1024px), filling the dead space where the watch page shows Related files, instead
of stacked below. Persisted (`ft-music-theater`), shown only while a track is
expanded, inert on mobile.

**4. Recently-played + resume.** v1.221 skipped saving a chapter's progress, so a
chapter-album never reached "Recently played" and never resumed. A chapter play now
records to the MEDIA store under the BASE file id at the file-absolute position;
"Recently played" collapses a file's many chapters to ONE entry - the chapter you
were in - so the artist shows once, and a resume-tap continues where you left off.

**What the gate caught (both seats APPROVE after one fix round).** A lying comment
(referenced a `data-music-expanded` attribute that never existed) - fixed. The
divergent resume axis (tapping a DIFFERENT chapter must play its head, not a stale
offset) was correct but only implied - now behaviourally bound. RBAC on the new
album-art id-strip, cross-user progress isolation, the collapse math, and album
escaping were all mutation-verified sound.

**Known gaps (disclosed).**
- *Resume feel (device-pending, Dean's call):* because the album view also computes
  progress, tapping the EXACT chapter you last played resumes it mid-chapter rather
  than restarting it (any other chapter starts fresh). This mirrors how a long single
  already resumes on a tap; if Dean wants an explicit tap to always restart, the fix
  is to carry the resume offset only down the continue/recent path.
- *Boundary edge (tech-debt):* a saved position exactly on a chapter boundary, or at/
  beyond the file end, is contained by no chapter window, so a just-finished chaptered
  file can drop out of "Recently played." Minor and non-destructive.
- *Slice 3 layout is device-pending* - the desktop two-column feel needs Dean's eye.

Full two-reviewer gate (QA + adversarial, both APPROVE, one fix round). Dual-Node
7944/0 (Node 22.23.1 + 24.14.0). **Dean's device pass PENDING.**

### v1.221.0 - Downloaded chaptered files become albums in Music (2026-08-31)

A downloaded audio file (yt-dlp, audio-only) that carries 2+ embedded YouTube
chapters now shows in Music as an **album**, each chapter a tapable track;
chapter titles are searchable as song names, and tapping a chapter plays the one
shared file seeked to that chapter (no re-encode). Auto-detected (any file with
2+ chapters). Applies only to downloaded library audio already opted into Music
(the v1.210/v1.211 `musicIncludesLibrary` toggle, default OFF).

**What shipped.** `expandAudioToTracks` (lib/music/libraryAudio.js) derives one
VIRTUAL track per chapter - id `<itemId>::c<idx>`, shared `streamSrc /video/<itemId>`,
per-chapter `durationSec` (span to the next chapter; last = file duration), and a
`chapterStartSec` seek offset. The chapters share the file's title as their album,
so the existing album grouping (`albumKeyFor`) folds them into one album drill with
no new drill code. Search surfaces the opted-in downloads and each chapter title as
music results. The player seeks a chapter on load and skips saving progress for the
synthetic id. A <2-chapter file stays a single track (never a bogus album).

**What the gate caught (both seats, independently).** The headline
"chapters-as-song-names in search" shipped **inert** in the first cut: a chapter
result rendered, but tapping it played nothing. The client re-resolves a tapped
track via `GET /api/music/:id` whenever it is not already in the recent-listening
list - and a chapter (whose progress is never saved) is never in that list - but
the route read only the native music store, so every chapter tap 404'd silently.
A divergent test fixture (the album served for recent-listening too) had hidden
it. Fix: `/api/music/:id` now falls back to the SAME opt-in projection the list
and search build - resolving by full-id match, so RBAC + eligibility + the opt-in
toggle stay in one gate ("resolvable == appears in the list"). The gate also
retired a dead helper with a lying comment and pinned the first-chapter
(`chapterStartSec 0`) seek behaviorally.

**Known gap (disclosed, tech-debt #188).** A chapter plays from its start but runs
to the END of the file - no auto-advance at the next chapter boundary, and no
resume WITHIN a chapter (re-tapping restarts at the chapter head). The transport
shows the chapter's own duration while the underlying media is the full file. The
minimal cut is seek-on-load only.

Full two-reviewer gate (QA + adversarial, both APPROVE after one fix round).
Dual-Node 7935/0 (Node 22.23.1 + 24.14.0). **Dean's device pass PENDING.**

### v1.220.0 - Critters stay out of scrolling strips (reverses v1.219's approach) (2026-08-31)

Dean tested v1.219's "make critters ride the scroll" on device and it was still
glitchy. His ruling: just don't place critters in scrollable areas at all.

**What shipped.** `critterInsideScroller(el)` (mirrors `critterInsideFixed`)
walks an anchor's ancestors for a genuinely-scrollable container (computed
overflow-x/y scroll|auto AND that axis actually overflows), and
`collectCritterRects` skips such anchors - so critters never land inside the
Music shelves (`.music-shelf-row`) or the books row (both `overflow-x: auto`),
while the page-scrolled grid/list views keep theirs. The entire v1.219
scroll-stick (the inner-scroll listener + `repositionCrittersForScroll` + its
test) was REVERTED - with the exclusion it would be unreachable dead code, the
class this repo has learned to stop shipping.

**Process note (honest).** The git-add-abort scar re-struck: a `git rm`'d path in
a `git add` list aborted the whole add, so the first commit landed with only the
deletion; caught before push and amended with the real changes. The slim gate
(adversarial) confirmed the revert is complete (zero dangling refs, wire/unwire
byte-identical to pre-v1.219) and - unlike the v1.219 miss - the fixture drives
the real overflow mechanism (jsdom reflects `overflow-x: auto`), so the exclusion
genuinely fires on the strips Dean flagged.

Slim gate (adversarial seat, APPROVE, no fix round). Dual-Node 7916/0
(Node 22.23.1 + 24.14.0). **Dean's device pass PENDING.**

### v1.219.0 - Critters ride a scrolling strip instead of detaching (2026-08-31)

Dean's device pics: a critter anchored to a tile inside the Music "Recently
played" horizontal strip stayed pinned to the page while the strip scrolled under
it, so it detached and looked broken. He chose "make them stick."

**What shipped.** A passive, capture-phase inner-scroll listener
(`onCritterInnerScroll`, wired in `wireCritterContentNudge` / removed in
`unwireCritterContentNudge`) rAF-coalesces to `repositionCrittersForScroll`,
which shifts each critter by its anchor's document-position delta so it rides the
strip. The critter and its anchor move together, so the sandwich clip/mask
geometry stays valid (only left/top shift) - no drop, no settle-ladder churn. A
page scroll leaves document coords fixed (delta 0) and is skipped outright, so
there is no scroll-perf cost.

**What the slim gate caught (adversarial seat).** A CRITICAL: the first pass added
the scroll listener at the top of `wireCritterContentNudge`, which then calls
`unwireCritterContentNudge` to refresh its observer - stripping the just-added
listener, so it was inert in a real browser (the tests passed only because the
fixture omitted `MutationObserver` and checked "addEventListener was called", not
"stays attached" - a dead-code + vacuous-binding pair). Fixed by re-attaching
after the observer refresh, with a browser-path net-attached regression test. Plus
a WARNING: match the wrapper by index, not the sprite id (which repeats).
Disclosed residuals (tech-debt #187): a non-full-width strip float and a
resize-mid-scroll stale mask - both non-blocking, and Dean's shelves are
full-width.

Slim gate (adversarial seat, APPROVE after one fix round). Dual-Node 7919/0
(Node 22.23.1 + 24.14.0). **Dean's device pass PENDING.**

### v1.218.0 - Consistent back: Podcasts + TV adopt the in-view back-stack (2026-08-30)

Dean device-confirmed v1.217 ("enjoyed it quite a bit") and asked to extend the
pattern to the other media types for a consistent page-follow. This wave adopts
the v1.217 router primitive (unchanged) in Podcasts and TV, each of which has one
in-view drill level (a grid -> a show):

- **Podcasts** mirrors Music: opening a show (card descent) stamps a `{t:'show'}`
  history level via `pushShowLevel`; `onShowPop` reconciles grid <-> show in
  place; the "All podcasts" back button consumes the entry via `history.back()`.
  A module-scoped live-handler ref delegates the stable `module.onPopState` to the
  mounted init (currentShow is init-closure-scoped, like Music).
- **TV** has the same one drill level. Its view functions are IIFE-level and
  stable across mount, so `onShowPop` registers DIRECTLY (no live-handler
  indirection); `currentShowId` tracks the open show. Episodes already navigate to
  the watch page (a real history entry), so only the show drill needed a level.
- **Books** was already consistent - opening a book is a page navigation to the
  reader, so Back already returns to the library. No change (verified).

So Back now steps within Podcasts/TV like it does in Music, and only leaves the
section at the grid. No player reparent on an in-view back (delegation happens
before the router's fetch/swap). Podcasts' now-playing collapse-on-back rides
Music's deferred slice (tech-debt #186).

**What the slim gate caught (adversarial seat).** APPROVE, no CRITICAL/WARNING.
It proved TV's direct-register can't act on stale state (every mount overwrites
`currentShowId` before use; the router only calls `onPopState` while the view is
mounted), no player reparent, no history spam (only the card click pushes), and
the Music tab-switch wart doesn't apply (neither view has a tab strip inside a
show). One non-blocking note: the same-id push guard is a defensive belt, not a
live dedup (the card only exists at the grid) - reworded honestly.

Slim gate (adversarial seat, APPROVE, no fix round needed). Dual-Node 7914/0
(Node 22.23.1 + 24.14.0). **Dean's device pass PENDING.** The media-nav arc
continues (the deferred now-playing slice; the exec plan stays ACTIVE).

### v1.217.0 - Back steps within Music: an in-view back-stack (drills) (2026-08-30)

Dean's device pass: the OS/Android back gesture (and the iOS left-edge swipe)
left Music entirely instead of stepping back out of an album/artist. Root cause:
the Music view had a zero-depth in-app back-stack - drills were in-memory only,
now-playing is player-driven, so back popped the single `/music` entry and left
the section. Dean chose "step back within Music first, then adopt the other views
incrementally with the same pattern."

**What shipped - a view-agnostic router primitive + Music as first adopter.**
(1) A history entry can carry an opt-in per-view `viewState` payload
(`buildHistoryState` 5th arg, threaded through parse + scroll-rewrite; inert for
every existing caller). (2) `pushViewState`/`replaceViewState` let a view add a
back level WITHOUT changing the URL (deep links untouched). (3) A per-view
`onPopState` hook (`popStateDelegate`): when a pop stays within the mounted view
and it opted in, the router hands the pop to the view to resolve IN PLACE -
before the fetch/swap, so no re-fetch, no view swap, and crucially NO player
reparent (background audio is never touched). (4) Music adopts it for DRILLS:
opening an album card, an artist card/row, tapping a SONG, or the "Playing from"
line stamps a level; OS-back reconciles the drill (parent -> browse) in place.
A cross-view back (leaving Music from the browse root) behaves exactly as before.

**Scoped to drills this wave** (the primitive is generic and reused unchanged by
the next adopters). Deferred + disclosed (tech-debt #186): now-playing
collapse-on-back and the dock-return drill (entangled with the `?nowplaying`
navigate + the player expand/dock lifecycle - the next slice); a one-extra-press
wart if you leave a drill by tapping a TAB instead of Back; and cross-view
re-entry not restoring the drill. Podcasts/TV/Books adopt the primitive in later
small waves.

**What the gate caught.** FULL gate, both seats. They independently caught that
the first pass wired the back-stack to album/artist CARDS but not to tapping a
SONG - the most common way into an album (v1.207) - which also caused a
history/live-drill desync (open an artist, tap a song from another album, and the
top entry still named the old parent). Fixed at one site (`playRowAt` stamps the
new album's level), interactive-only so the `?play=` init path adds no history
spam. Plus a same-drill dedup, comment/tally corrections, and an em-dash. A stray
NUL byte that slipped into one edit was caught before commit. Both APPROVE after
one fix round.

Full gate (both seats APPROVE, one fix round). Dual-Node 7907/0
(Node 22.23.1 + 24.14.0). **Dean's device pass PENDING.**

### v1.216.0 - Critters off the Music now-playing panel (2026-08-30)

Dean's v1.215 device pass: "Love it" - with a critter draped over the expanded
now-playing title + UP NEXT (screenshot). The big-art player was already a
critter no-go zone (`#player-wrapper`/`.player-container`), but the now-playing
metadata + up-next PANEL below it was not - and its up-next rows aren't critter
anchors, so the culprit was a critter anchored to nearby BROWSE furniture whose
placement box overhung the un-excluded panel. Added `.music-nowplaying-panel`
(the shared class, so the Podcasts now-playing panel is covered too) to
`CRITTER_EXCLUSION_SELECTORS` - the planner now drops any placement box over it.

**What the slim gate caught (adversarial seat).** My first pass excluded
`#player-slot` + `#music-nowplaying-panel` with a root-cause narrative and test
that were FICTION - the big art was already excluded and the up-next thumbs were
never anchors (a divergent-fixture, the class this repo keeps paying for). Round
1 corrected it: dropped the redundant `#player-slot` (it emitted a stray
full-width zero-height exclusion band while docked), switched to the shared class
(covering podcasts), rewrote the comment to the true mechanism, and rebound the
test to the real protection (both panels emit exclusion rects; the planner drops
an overhanging box). A residual non-vacuous-loop nit was closed too.

Slim gate (adversarial seat, APPROVE after one fix round). Dual-Node 7890/0
(Node 22.23.1 + 24.14.0). **Dean's device pass PENDING.** (The in-Music
back-swipe history work Dean also asked for is a separate wave, in design.)

### v1.215.0 - v1.214 device-pass fixes: recent-listening for downloads, critter + toggle glitches (2026-08-30)

Dean's device pass on v1.214: "Actually a lot better" - with three bugs.

**What shipped.** (1) A played DOWNLOADED artist (his NESTALGIA) never appeared
in Home's "Recently played" / "Jump back in". Root cause: v1.210 projected
library tracks save resume to the MEDIA store (`/api/progress`, unifying resume
with the feed), but `/api/music?filter=recent-listening` read ONLY the music
store - so a library track's position was invisible to it. New
`musicListProgressMap` merges both stores (native from `getMusicProgress`,
library from `getProgress`, normalizing the media `{timestamp}` key to the music
`{position}` shape), with pending-write overlay on both. Drives recent-listening
AND resume bars. (2) A critter (a fox) rendered ON the Shuffle button - its
Shuffle/Scan buttons are `.btn`s (a PRIORITY critter anchor) and the toolbar is
z-auto under the z:2 critter plane. Added `.music-toolbar` to
`CRITTER_EXCLUSION_SELECTORS` - critters still peek from the artwork below, never
over the controls. (3) The grid/list view toggle leaked onto album/song drills
(visible + inert): `.btn { display: inline-flex }` beat the UA `[hidden]` rule
(the repo's [hidden]-loses-to-display class), so the JS `.hidden = true` didn't
paint. Added `#music-view-toggle[hidden] { display: none !important }`, matching
the sort-select guard beside it.

**Behavior note (not a fix).** Native-track recent-listening now carries the
user's own pending-write overlay it did not before (read-your-writes, from the
user's own pings only) - a just-played native track surfaces before the flush.

**What the gate caught.** Both seats APPROVE, no CRITICAL/WARNING. Adversarial:
built a live two-user repro proving no cross-user progress leak through the merge
+ pending overlays, and confirmed RBAC gating holds (the map only covers the
already-filtered list); flagged the shared `.music-toolbar` class (Podcasts uses
it too - the exclusion helps that strip as well). QA: the merge target should be
`Object.create(null)` to match the source maps' null-proto contract (a hostile
`__proto__` id lands as an own key) - applied. All three fixes bound by
mutation-verified tests.

Full gate (both seats APPROVE after one fix round). Dual-Node 7890/0
(Node 22.23.1 + 24.14.0). **Dean's device pass PENDING.**

### v1.214.0 - Music friction pass: view toggle, release-date sort, recent artists (2026-08-30)

Dean, on v1.213: "much better rewrite ... but it's very friction heavy" - huge
circles, hard to find an artist, artist songs in arbitrary order, too many taps.
Three fixes he prioritized (search-surfaces-artists parked):

**What shipped.** (1) Smaller, denser circles + a grid/list VIEW TOGGLE on the
Artists tab - circles for browsing, a compact scannable list (avatar + name +
count) to find a known artist fast; persisted per device. (2) An artist's song
list is now SORTABLE, defaulting to RELEASE DATE for yt-dlp downloads (was
arbitrary/album-order): `sortTracks` gained release-newest/oldest, projected
tracks carry `releaseDate`; an album drill keeps album order. (3) A "Recently
played" artists row on Home (distinct artists from recent plays, one tap to their
page). Client + lib only.

**What the gate caught.** QA: two comments still described the OLD drill-sort
mechanism this wave inverted (drills were "hidden/album-order") - de-rotted; and a
`__proto__` dedup edge (null-proto map). Adversarial: three test-binding gaps -
the release-newest 0-bucket tiebreak (a stable-sort coincidence), the list-row
drill (never actually clicked), the drill sort-change write-key - all bound +
mutation-verified.

Full gate (both seats APPROVE after one fix round). Dual-Node 7887/0
(Node 22.23.1 + 24.14.0). **Dean's device pass PENDING.**

### v1.213.0 - Music redesign: Spotify-style shelf Home + all-circular artists (2026-08-30)

Dean: Slice 1 (v1.212) "wasn't really a radically redesigned page" and the
circles only hit the yt-dlp artists. He pivoted the direction: radically
restructure the WHOLE Music page in the app's EXISTING theme (function over form,
no new palette), circles for ALL artists including the ripped "old" music.

**What shipped.** (1) A new HOME tab (the default landing): a scroll of shelves -
"Your artists" (round circles) + "Recently added" (albums) - each a horizontal
row with a "See all" that opens the full tab; the "Jump back in" resume strip
still sits up top. (2) Artist tiles are ROUND across the WHOLE page: a channel
gets its avatar circle, a native/ripped artist gets its album art clipped to the
same circle. Albums/Artists/Songs remain full-list tabs. Client-only (no
server/RBAC/data change); reuses the existing endpoints; all on the app's
existing tokens (census 0).

**What the gate caught.** QA: the Sort dropdown was live but INERT on Home (fixed
- hidden there), and the Home skeleton seeded a wrong-shape grid (fixed - a
shelf-shaped skeleton, zero-shift). Adversarial: the See-all test didn't bind the
DESTINATION tab (both tabs render a grid, so a wrong target was invisible) - bound
+ mutation-verified. All fixed round 1.

Full gate (both seats APPROVE after one fix round). Dual-Node 7879/0
(Node 22.23.1 + 24.14.0). **Dean's device pass PENDING** - a subjective UI, his
reaction is the arbiter; more (album header + chapters-as-tracklist, now-playing
re-skin) can follow.

### v1.212.0 - Music redesign, Slice 1: artist circles + "Jump back in" (2026-08-30)

Dean: "Love love love go go go" on the redesign mockup. First slice of the arc
(spec = the mockup; plan `docs/exec-plans/active/music-redesign.md`, which stays
ACTIVE for slices 2-4).

**What shipped.** (1) The Artists tab renders round CHANNEL-AVATAR circles
(Spotify-style). The avatar already existed (`resolveItemChannelAvatarUrl`) but
the projection dropped it; now threaded through `groupArtists` (order-invariant,
lowest-id pick). A native-album artist with no channel falls back to the
album-art mosaic; a broken avatar degrades to a monogram (both reveal axes
bound). (2) A "Jump back in" resume strip above the tabs - what you were last
playing, one tap to resume; hidden when empty. Player engine untouched (a
re-skin). CSS fully tokenised (census 0), mobile-first horizontal scroll.

**What the gate caught.** Adversarial: the `&& t.avatarUrl` empty-avatar guard
was load-bearing but unbound (a lower-id ''-avatar track must not claim the slot
over a higher-id real avatar) - bound + mutation-verified. QA: reveal fast-path
parity with `buildAccountAvatarEl`. Both non-blocking, folded in round 1.

Full gate (both seats APPROVE). Dual-Node 7876/0 (Node 22.23.1 + 24.14.0).
**Dean's device pass PENDING.** Slices 2-4 (album header + chapters-as-tracklist,
artist page, now-playing) follow as their own releases - his reactions shape them.

### v1.211.0 - Honest all-or-nothing music channels + a Settings manager (2026-08-30)

Dean device report on v1.210: the ♪ toggle painted ON (blue) for NESTALGIA but
only 1 of 352 songs showed - and he couldn't find the per-channel control (it
lived only on one nav path to the channel's page).

**What shipped.** (1) The projection default is now CHANNEL-level all-or-nothing:
a channel auto-includes iff a STRICT MAJORITY of its audio is tagged genre
'Music' (Dean's call), and marking a channel includes ALL of its audio - killing
the "blue but 1 song" mismatch (a mixed channel like NESTALGIA, mostly "Gaming",
now shows NOTHING until marked, then all of it). `autoMusicChannels()` +
`channelEffectiveOn()` are the single source of truth shared by the projection,
the ♪ toggle, and the new list - so the toggle can never disagree with what
shows. (2) A "Channels in Music" manager in Settings (GET /api/music/channels) -
one discoverable, nav-path-independent place to pick channels, visibility-scoped
(audioCount is the per-user visible count; write stays library-write only).

**What the gate caught.** Adversarial: the strict-majority 50/50 boundary was
unbound (the `>` -> `>=` mutant survived with zero test signal) - closed with an
even-split test + mutation-verified. QA: a comment on the music-flag GET had
rotted (claimed the default was "the genre-seeded default over VISIBLE audio" -
both halves false under the channel model) - rewritten. Both fixed in one round;
also added a partial-visibility audioCount bind and de-rotted several comments.

Full gate (both seats APPROVE after one fix round). Dual-Node 7866/0
(Node 22.23.1 + 24.14.0). **Dean's device pass PENDING.**

### v1.210.0 - Downloaded music channels in the Music library (2026-08-30)

Dean: he downloads MP3s from music channels (game-music remixes, album mixes)
that sit in the media feed as normal downloads; he wanted the ones that are
really music to ALSO appear in the Music library for the music-player
experience - WITHOUT duplicating data (a virtual mapping), and while they stay
in the feed.

**Framing reversed by the live data.** We inspected the real instance
(`GET /api/videos?format=audio`) BEFORE designing: yt-dlp embeds only
`{title, artist, date, genre, ...}` - NO album/track/disc tags at all, and the
artist tag IS the channel. So the planned "surface audio with an album tag" gate
would have matched ZERO files; the only clean music/not-music line is the
CHANNEL (NESTALGIA game-music, genre "Gaming", vs an Opie & Anthony archive,
genre "Comedy", side by side). The design pivoted to a per-channel flag.

**What shipped (opt-in, default OFF).** A per-user master toggle (Settings) and
a per-folder "show in Music" mark (`db.music.channels` - a feature-OWNED
namespace that rides the backup bundle for free) with a genre-seeded default
(`genre === 'Music'` -> on). When on, library audio (`db.metadata` type audio)
is VIRTUALLY projected into the Music album/artist/song views - nothing copied -
each track keeping its OWN routes (`/video` stream, `/thumbnail` art,
`/api/progress`, which unifies its resume with the feed). A "♪" toggle on a
channel's folder page includes the ones YouTube tags differently (a game-music
channel tagged "Gaming"). No album sub-shelves (there is no album data) - each
channel is one artist.

**What the gate caught.** The adversarial seat found the projection's RBAC
gate-KIND was unbound: the tests used a PATH restriction, which the media and
track visibility gates enforce identically, so a `mediaVisibleTo`->`trackVisibleTo`
mutant survived on BOTH the projection and the `/albumart` fallback. Closed with
a gate-kind test using folder-kind + video-library-kind restrictions (media-only
in visibility.js), each mutation-verified red. Also bound the client source-gate
(not mere field presence) and a `db.metadata` null-guard; QA caught an em dash in
a new UI string. The route-classification net correctly forced an RBAC review of
the two new `/api/folders/music-flag` routes.

Full gate (both seats APPROVE after one fix round). Dual-Node 7857/0
(Node 22.23.1 + 24.14.0). **Dean's device pass PENDING.**

Known gaps (disclosed): no album sub-shelves; the per-folder mark is keyed by
`folderName`, so a folder rename re-keys it; universal-search projection deferred
(library audio is already searchable via the audio provider - a music-provider
projection would duplicate the result).

### v1.209.0 - Tap outside the open search to dismiss it (2026-08-29)

Dean (mobile + desktop): open search, change your mind, tap the home logo top-
left - search stayed open; you had to press the search button again.

**What shipped.** A document pointerdown listener (wireSearchAffordances,
common.js) closes the open search when the box is EMPTY and the tap lands
OUTSIDE the search area (input / toggle / history panel / .header-search host).
pointerdown (not click - the iOS tap-outside rule) fires BEFORE the target's own
click, so the outside control (the home logo) still activates on the same tap. A
TYPED query is preserved - an accidental tap-away never discards it. Bound once
(the idempotency guard), bubble-phase (no scroll tax, unlike a non-passive
touchmove). wireSearchAffordances is now exported so the behaviour is jsdom-
bound, not source-locked.

Slim gate (adversarial), APPROVE. Dual-Node 7831/0 (Node 22 + 24).
**Dean's device pass PENDING.**

### v1.208.0 - Watch length on the notification thumbnails (2026-08-29)

Dean: show the watch length on each notification's little content-preview thumb
so a short "preview" clip (or a long one) can be triaged before deleting -
without opening it. Some channels post ~1-minute previews he knows he won't
watch; the length badge makes that a glance.

**What shipped.**
- The notification panel's thumbnail now carries a small DURATION badge in its
  bottom-right corner, for anything with a real length - library videos AND
  podcast episodes. Nothing on lengthless items.
- It REUSES the existing card .duration-badge system (same --scrim background,
  radius, formatDuration - the v1.205.2 look) scaled to the 72x40 notif thumb
  using the app's own small-pill language (the list-view precedent: --fs-xs +
  tight 2/4 padding). MEASURED in Chromium: ~15px tall in the corner (width
  tracks the label), identical desktop + mobile - the 0-2-0 scope beats the
  mobile card-badge --fs-2xl bump, so it stays small everywhere.
- Server: GET /api/notifications carries durationSec per row (media from
  db.metadata.duration AFTER the visibility gate; podcast from ep.durationSec),
  0 when unknown. No new data exposure - the same item the row already shows.

**What the gate caught.** The podcast-row durationSec was unbound by any test
(a future rename would ship a podcast-badge regression silently) - bound on the
already-seeded episode.

Slim gate (adversarial), APPROVE. Dual-Node 7826/0 (Node 22 + 24).
**Dean's device pass PENDING.**

### v1.207.0 - Pick a song, land in its album (and keep it) (2026-08-29)

Dean's friction: searched a song, loved it, wanted the next track on the album -
but playing a song left him in the flat list; he had to go Music -> Albums ->
scroll -> find it -> pick, and the mini-player round-trip reset to the default
view. Intake: every new song -> its album view; an album-less track stays put.

**What shipped.**
- **Pick a song -> its ALBUM view.** playTrackInAlbum drills into the track's
  album (drill -> render()), so the album is the browse view AND the up-next
  queue (next/prev walk the album). Reuses the proven album-card path; never
  rebuilds the battle-won queue engine. Applies to a song-row tap and to
  ?play= (search / card deep-links); an album-less track plays in place.
- **The album persists across the mini-player.** A dock-tap return
  (?nowplaying=1) restores the now-playing track's album drill as the browse
  view - drill is set BEFORE the single render() so it never races
  rebuildPlayingQueue (the v1.104 desync scar); lock-screen Prev/Next are
  registered around the playing track in the album.

**What the gate caught (3 rounds).**
- A rapid cross-album double-tap could play the WRONG track (auto-play racing
  two album loads) - fixed with a select-generation guard (bail before playAt
  if superseded).
- A RESIDUAL of that: the loser's late album load clobbered the queue back
  under the winner's already-registered nav, so Prev/Next then played a
  wrong-ALBUM track - fixed at the shared side-effect (loadSongs claims a
  generation and a superseded load never writes the module queue/ctx). Both
  mutation-bound.
- Three unbound test claims (nav index, the scar guard, the same-album re-tap)
  tightened to real binds.

Full gate, 3 rounds, both seats APPROVE. Dual-Node 7823/0 (Node 22 + 24).
**Dean's device pass PENDING.**

**Disclosed behaviour changes (Dean's "every new song -> album" call).** Playing
a song now scopes next/prev to that one album: the flat Songs tab's "play all"
and an artist page's "play the whole artist" both end at the first tap (the tap
hands off to the track's album). A rapid cross-album double-tap can leave a
transient, self-healing header/list cosmetic mismatch (pre-existing
unserialized-render artifact; no wrong audio). On Dean's probe list.

### v1.206.0 - Tiered Dependabot auto-merge (reverses v1.148's no-auto-merge) (2026-08-29)

Dean (2026-08-29) REVERSES the v1.148 "NO AUTO-MERGE, EVER" decision in favour
of a TIERED policy: a low-risk dependency PR that passes full CI merges itself;
a high-risk one waits for Dean.

**What shipped.**
- **The auto-merge workflow** (`.github/workflows/dependabot-auto-merge.yml`):
  reads dependabot/fetch-metadata and arms `gh pr merge --auto` (GitHub holds
  it until the required checks pass) ONLY for the AUTO tier - a non-major
  github-actions bump, or an npm DEV dependency (direct:development) minor/patch
  that does not touch jsdom. Both arms gate POSITIVELY on minor/patch, so an
  unknown update-type fails CLOSED. MANUAL (no step runs, PR sits): every major,
  every runtime dep (direct:production), the Docker base image, jsdom.
- **The npm group is dev-only** (`dependency-type: "development"`), so a grouped
  PR can never carry a runtime dep past the direct:development gate.
- **The lock test** (`ci-pipeline-locks.test.js`): the old "NO auto-merge, ever"
  lock is REPLACED by tiered locks - the machinery is CONTAINED to the one
  workflow (the net now catches the `gh pr merge --auto` command spelling, not
  just the hyphenated noun), acts only on dependabot PRs, and the AUTO condition
  excludes majors/runtime/docker/jsdom. Every gate is mutation-bound.
- **The one safe branch merged:** globals 17.7.0 -> 17.11.0 (a dev-only minor,
  the AUTO-tier example). The 7 MAJOR Dependabot branches (node 26, checkout 7,
  metadata-action 6, dotenv 17, @eslint/js 10, jsdom 30, mime-types 3) stay for
  Dean's per-item review - all correctly held by the policy.

**What the gate caught.** The github-actions arm gated NEGATIVELY (fails open on
an unknown update-type) - switched to positive/fail-closed; the containment
regex missed the command spelling - broadened; the "no-op / sits exactly as
before" pre-enablement wording was wrong (an AUTO-tier PR's merge step ERRORS
with a failed check until the settings are on) - corrected in all three sites;
the squash-merge repo setting was undocumented - added.

Full gate, 2 rounds, both seats APPROVE. Dual-Node 7816/0 (Node 22 + 24).

**Dean's ONE-TIME repo settings** (until enabled, an AUTO-tier PR errors with a
failed check and waits - nothing merges): enable "Allow auto-merge" + "Allow
squash merging", and a branch-protection rule on `main` requiring the CI checks
(`ci`, `secret-scan`, `audit`). See docs/RELEASING.md. **HONEST CAVEAT:** the
workflow cannot run on the dev box, so the locks are drift tripwires, not
behavioural proof - the merge behaviour + fetch-metadata output strings are
confirmed by the first real Dependabot PR once Dean flips the settings.

### v1.205.2 - Card duration pill: non-bold + matches the corner-button background (2026-08-29)

Dean's v1.205.1 device pass ("the time is great ... it's excellent") with two
style tweaks on the duration pill: (1) it read too BOLD at the new larger size
- switched to a new --fw-normal (400) token; (2) its background was the darker
--scrim-heavy while the corner glyph buttons use --scrim - standardized the
pill to var(--scrim) so the row's pills are one look. CSS-only, no geometry
change. Slim gate (adversarial), APPROVE. Dual-Node 7813/0.

**Known (disclosed, device call):** the corner buttons carry opacity:0.85 at
rest and the pill does not, so the pill's --scrim background composites ~0.08
darker than a neighbouring button despite the identical token - subtle;
matching it exactly would fade the number text (element opacity), so left as
the token match Dean asked for. On his probe list.

### v1.205.1 - Card duration polish: matches the buttons, stays visible in preview (2026-08-29)

Dean's v1.204/v1.205 device pass ("everything is working amazingly") with two
card-tile visual nits.

**What shipped.**
- The duration pill ("11:10") now MATCHES the corner controls' height - it read
  3px shorter on desktop and 7px shorter on mobile (the corner glyphs grow
  14px->18px on mobile, the badge didn't). The pill now tracks the corner glyph
  size (var(--fs-md)=14px, var(--fs-2xl)=18px mobile) + line-height 1 + the
  buttons' padding. MEASURED in headless Chromium: 22px==22px desktop,
  26px==26px mobile.
- The duration STAYED VISIBLE while the hover-preview clip plays (it was being
  painted over): .card-preview is z-index:1 with a comment claiming "below
  badges", but the badge had NO z-index, so the opaque preview covered it (the
  corner buttons at z:2 stayed visible; the badge was forgotten). Gave the badge
  z-index:2; corrected the lying comment. Verified by a pixel sample: removing
  z:2 reproduces the disappearing-duration bug exactly.

**What the gate caught.** The wider mobile badge overlapped the bottom-left
corner button in the compact LIST view (a ~120px thumb can't hold a BL control
+ the 18px pill + a BR control) when the bottom-right corner is customized.
Fixed by capping the list-view duration to v1.204's exact size + padding: the
list-view HORIZONTAL geometry is now identical to v1.204 (the pill is 4px more
COMPACT vertically from the new line-height:1 - non-colliding, benign).

Slim gate (adversarial), 2 delta rounds, APPROVE. Dual-Node 7812/0 (Node 22 +
24). **Dean's device pass PENDING.**

### v1.205.0 - Universal search: one search box for everything (2026-08-29)

Dean: the global header search should return not just library videos/audio but
music, podcasts (shows AND episodes), TV (shows AND episodes), and books -
everything browsable - in one stream. Confirmed intake: blended-by-relevance
ranking; drop the video Titles/Channels sub-scope in unified search; header box
only (per-view boxes unchanged); titles + identity fields only for v1.

**What shipped.**
- **One blended stream.** A global header search now hits a new GET /api/search
  that blends eight providers (video, audio, music, podcast-show, podcast-
  episode, tv-show, tv-episode, book) into one ranked flat list with a type
  badge per card. Ranking (lib/search/rank.js): relevance tier (exact > prefix
  > substring-title > identity field) -> a fixed type priority -> recency.
  Pagination mirrors /api/videos (total = full ranked length, page = slice).
- **A content-type chip row** (All / Videos / Audio / Music / Podcasts / Shows /
  Books) replaces the video-only Titles/Channels toggle for a global search;
  ?type= deep-links it. A folder/root-scoped search is UNCHANGED (still
  /api/videos + its searchIn toggle) - `isUnifiedSearch` gates the new path.
- **The durability model (the headline).** A search-provider REGISTRY
  (lib/search/registry.js): each media module's provider owns its match
  predicate AND its EXISTING per-kind visibility gate (the same single RBAC
  decision as every list/serve route - never a divergent second gate). PLUS a
  provider-coverage census bound to KIND_TO_LIBRARY: a future media type with
  no registered provider fails CI. "Automatic" = enforced-by-test (the honest
  version Dean approved).
- **Mixed cards.** cardKindPresentation gained tv-show (-> /tv?show=) and
  tv-episode (-> /watch.html?tv=) arms; TV cards suppress the download/like
  corners (no such routes). The type badge sits in the info row, never colliding
  with the four configurable corners.

**What the gate caught.**
- Access control (the headline attack surface): the adversarial seat
  mutation-proved ALL EIGHT provider RBAC gates (removing any one turns the
  /api/search leak census red), that pagination cannot page into a blocked set,
  and that an unauthenticated caller gets 401. No leak.
- The podcast-episode provider surfaced NON-downloaded episodes
  (pending/failed/trashed/tombstone) - a card that 404s on click AND resurfaces
  a title the user had DELETED. Fixed: downloaded-only, mirroring the play gate.
- The recency tiebreak was INERT for music/books/TV: their addedAt is an ISO
  string and Number(ISO) is NaN -> 0. Fixed with rank.toRecency (numeric ms
  pass through; ISO -> Date.parse); tv-show recency derived from the visible
  episodes (parse.js's twin bug left out of scope, disclosed).
- Three client render guards were presence-not-binding (bound this round).

Full gate, 2 rounds, both seats APPROVE. Dual-Node 7809/0 (Node 22 + 24).
**Dean's device pass PENDING.**

**Known scope (disclosed).** Descriptions are NOT matched in v1 (generic
episode titles like "Episode 42" are harder to find) - a documented deferral.
The per-view search boxes are unchanged. The pre-existing tv/parse.js
latestAddedAt Number(ISO) bug (an inert Continue-row recency) is left for a
later TV pass.

### v1.204.0 - A fourth, selectable card corner (bottom-right) (2026-08-29)

Dean: make the bottom-right corner a fourth selectable slot; when a control
is assigned there the duration badge shifts slightly left to sit beside it,
and the badge stays in its home when the slot is empty.

**What shipped.**
- **The bottom-right corner is now selectable.** Settings -> Card corners
  grew a fourth "Bottom right" picker alongside Top left / Top right /
  Bottom left. Any of the seven controls (Download, Delete, Like, Queue,
  Share, Reheat, Transcript) can sit there, or None. It defaults to None,
  so no existing card changes until a user opts in.
- **The duration badge yields, PER CARD.** When a control actually renders
  in the bottom-right of a given card, that card's duration badge slides
  left to sit beside it (desktop right:36px, mobile right:40px - MEASURED
  in headless Chromium against the real stylesheet: 5px clear gap at both
  widths, no overlap). When the slot is empty - or its control does not
  apply to that card (Share needs the original link, Transcript needs
  captions, Delete needs the modify-library capability, a duplicate is
  deduped away under TL>TR>BL>BR) - the badge keeps its home. The shift
  keys off the RENDERED corner (buildCardCorners returns brOccupied), never
  the bare preference, so it is exactly right per card.
- **End-to-end persist.** cornerBR joined the server settings allowlist and
  rides the same per-user, cross-device mirror (POST /api/me/settings) as
  its three siblings; the client resolver defaults it to 'none'.

**What the gate caught.**
- The server settings allowlist deliberately EXCLUDED cornerBR ("bottom-
  right reserved") - without adding it the new picker's save would have
  silently 400'd (the end-to-end persist-gate class this repo keeps paying
  for). Added, bound by a test that goes red if the key is removed.
- A SECOND stale "bottom-right stays reserved for the duration badge"
  comment survived on the .card-like-btn CSS block - corrected (the first
  commit fixed five such comments and missed this one).
- Delete is the one corner control that EXPANDS: arming it reveals "Sure?"
  and the right-anchored button grows back over the shifted badge (measured
  31px overlap). Fixed for real, not disclosed: the badge is hidden while a
  bottom-right delete is armed (`:has(.card-corner-br.armed)`) so the
  confirm reads cleanly, returning on disarm; re-measured hidden in Chromium.

Full gate, 2 rounds, both seats APPROVE. Dual-Node 7768/0 (Node 22 + 24).
**Dean's device pass PENDING.**

**Known minor (disclosed).** On mobile a corner button's invisible 44px
tap-zone still grazes the badge's rightmost ~3px - the same accepted v1.147
tap-zone tradeoff every corner control already carries; the badge is
non-interactive, so nothing is stolen.

### v1.203.0 - Words on the phone action row + Transcript as a card corner (2026-08-29)

Dean, after the v1.202.0 device pass: "we can actually have them display
with the full text ... we have space, it's very centralized in the
middle"; "add the transcript button as a selectable option for a given
card ... from a card view maybe send a video along to an AI"; and, mid-
wave, the row order: "Queue Like Share Transcript More".

**What shipped.**
- **Words on the phone row.** The four primary buttons keep their words
  at every width; only More is a glyph ("..."). Order: Queue, Like, Share,
  Transcript, More (CSS `order`). Measured vs v1.202.0: Queue 73 + Like 56
  + Share 65 + Transcript 88 + More 29 = ONE row at 390, 375 and 360
  (311px in a 328px column), 39px, the stars back on their own line;
  narrow desktop (598px column) the same with words at 32px; wide desktop
  byte-identical. The v1.202 639px glyph threshold and the v1.47.6
  hide-all-words phone rule are gone (locks rewritten deliberately).
- **The transcript flow is shared.** `openTranscriptFor({ id, title,
  signal, onBusy })` in common.js - fetch text + prompts together, phone
  picker (Share / Copy / Share with AI) or desktop modal, abort teardown
  via the caller's signal. The watch page is a thin caller; every
  watch-page transcript test unchanged.
- **Transcript is a card corner.** Pickable per corner in Settings like
  Download / Delete / Like / Queue / Share / Reheat (roster six -> seven);
  renders only on cards whose video has captions; a click runs the
  identical flow with the card's id and title. New real-page harness test
  (index.html folder view): renders on the captioned card only, desktop
  opens the same modal, phone opens the same picker and Share hands the
  document to the sheet.

**What the gate caught (round 1).** Adversarial: a card-corner click
followed by navigation before the text landed opened the transcript modal
over the NEXT page - the home grid is cached on nav-away, so its abort
signal never fires (the v1.160 class); fixed with a `stillWanted` hook the
corner answers with "am I still on screen", bound for both the cached-away
and the real-abort paths (the harness had to serve HTML shells first, or
the old view never left and the scenario was vacuous). The move of the
flow into common.js had dropped the watch page's dismiss-before-open, so a
keyboard user could stack two modals - now one transcript surface at a
time across both callers, bound on both. QA: the Modern home grid's item
projection dropped `hasSubtitles`, so the corner would have rendered EMPTY
on every home card in modern mode (the projection's own "field-complete
for every corner" comment turned false) - projected and bound by a route
test. Plus two stale CSS comments from the row rework, the corner missing
from the touch-action list, and five correct-but-unbound branches (corner
busy, missing id, the aborted-view pre-open check, the editor option, the
disabled-corner arm). Commit-message corrections: the phone row SPAN is
326px in a 328px column at 360 (button widths alone sum to 311), and two
suite counts were off (17 not 21; 41 not 40).

**Known gaps (disclosed).**
- A 360px phone fits the words with 2px of slack; a device rendering any
  button 1px wider wraps More to a second line (a wrap, never a
  deformation - the v1.200 norm). Era fonts never reach the row (it is
  Arial 11px under every era - measured).
- The card harness cannot discriminate "title from the item" vs "title from
  the card's DOM text" (they render identically); the delegation reads the
  item and the code comment says so.
- Fixed row order (v1); the earlier v1.202 order lasted one release.

Dual-Node: 7756/0 on v22.23.1 and 7756/0 on v24.14.0 (sequential, reviewers idle). Round-2 APPROVE from both seats; QA's last arithmetic nit fixed in a90bbae. The prompt rows' POINTER drag and the card corner's pointer path are tested at the shared helper's layer; this wave binds the keyboard/click paths (disclosed). Device pass PENDING (Dean).

### v1.202.0 - Attribute behind an opt-in flag, draggable AI prompts, the two-tier action row (2026-08-29)

Dean, after the v1.201.0 device pass: Attribute "was valuable for me
because I was dealing with a lot of previously downloaded content that was
not attributed correctly ... if they just go super clean from the start
it's kind of an unnecessary function"; "make the boxes draggable/sortable.
No sort buttons"; and the action-row re-evaluation: his real taps are
Like, Share, Transcript, Queue - "Delete in More", a "More" in the app's own
pick-one style, fixed order for v1.

**What shipped.**
- **Manual channel attribution is opt-in.** `settings.attributeControlEnabled`
  (default off; Settings -> Experimental "Manual channel attribution"). Off
  hides the watch-page Attribute button and the folder-view bulk tool, and
  the target list, per-video and bulk attribution routes answer 404 -
  after each route's RBAC guard, so a member's 403 is unchanged and an
  admin gets a plain 404. The bulk CANCEL stays reachable (a job started
  while on must remain abortable). Attribute finally has a real glyph
  (Material `drive_file_move`, replacing `icon-user`, which had no mask
  anywhere - the blank box on phones since v1.53).
- **Draggable prompt rows** in Settings -> Transcript sharing, through the
  one mandated gesture layer (`wireReorderable`): a handle per row is the
  pointer grip AND the keyboard control (arrow keys / Home / End); a drop
  moves the row and saves the whole list at once.
- **The two-tier action row.** Primary = Like, Share, Transcript, Queue,
  then More; secondary = Next, Download, Delete, Move, Mark watched,
  Reheat, Attribute. One list (`SECONDARY_ACTION_IDS` in watch.js) mirrored
  by CSS and locked equal. CSS `order` fixes the row everywhere. By COLUMN
  width (the v1.201 container): wide (960px+) shows everything as words
  with More hidden; compact (under 960) hides the secondary tier and shows
  More with words; under 640 the words drop. More opens the pick-one
  listing every mounted secondary button by its current label and clicks
  the real button (its own handler/confirm/state). Measured against
  v1.201.0 with the probe, both modes: phones and the 598px column -> five
  glyphs on ONE row (the stars now share that row); 684/918px columns ->
  five with words; 1920 and every theatre width -> nine words, More
  hidden; every button 32px (39 on phones). Attribute is absent by default
  (the flag), so the wide row is nine, not ten.

**What the gate caught (round 1).** Adversarial CRITICAL: the draggable
prompt rows kept STALE wiring after a move - `wireReorderable` closes over
the row list and each handle's index at wire time, and the editor only
re-wired on a re-render (which the focus rule skips), so a second gesture
scrambled the order or left the DOM and the server disagreeing; the
committed test had dispatched the key with focus on body (a divergent
fixture - a keyboard user has the handle focused). Fixed by re-wiring
right after every DOM move (per-wiring AbortController), bound by two
focused-handle scenarios. Both seats: neither client-side flag gate (the
watch button, the folder bulk tool) was bound by any test - deleting
either left every suite green; now bound, the folder view through a new
index.html jsdom harness. The action-bar reveal barrier did not wait for
the flag (Attribute popped in after the reveal) - a third input added,
its source lock updated deliberately. Also: the plan still said the
cancel route 404s (the code deliberately exempts it - written back), the
server comment overstated "after each route's RBAC guard" (the target-list
GET has none), a "rulings B7-B12" reference that did not exist, a wasted
settings fetch on non-folder views, and the probe counting hidden buttons
as a row. Earlier, the pre-commit hook refused three commits on
deliberate locks (the Settings menu list, the docs-status census, the
reveal barrier's exact form) - each updated consciously.

**Known gaps (disclosed).**
- The flag is read once per watch/folder view; a toggle in another tab
  takes effect on the next navigation.
- A bulk attribution job started while the flag was on runs to completion
  if the flag is turned off mid-job (cancel remains reachable).
- Primary/secondary order is fixed (v1); customization only if Dean misses
  it.
- Probe stall residual unchanged (tech-debt 184).

Dual-Node: 7746/0 on v22.23.1 and 7746/0 on v24.14.0 (sequential, reviewers idle). Round-2 APPROVE from both seats; their two residual one-liners applied in e422153. The prompt rows' POINTER drag path is tested at the shared helper's own layer; this wave binds the keyboard path (disclosed). Device pass PENDING (Dean).

### v1.201.0 - Transcript: "Share with AI" prompts, prose mode, one-row desktop action bar (2026-08-28)

Dean, after the v1.200.0 device pass ("goddamn amazing"): (1) a "Share
Transcript with AI" action with a customizable prompt in front - "I could
just choose the Claude app ... and I wouldn't be locked into Claude",
several prompts "for different types of prompts"; (2) with timestamps off,
"a flat text block without all of those new lines"; (3) on desktop "the
button moves over to a 2nd row if not in theatre mode".

**What shipped.**
- `settings.transcriptAiPrompts` - named preamble prompts (`[{id, name,
  text}]`, max 12, name 1-60, text 1-4000, trimmed, unique names, server-
  assigned ids kept stable across edits). Instance-wide: admin edits (the
  existing write-RBAC), everyone reads. One default "Summarize" prompt so
  the action works on day one; an empty list hides it everywhere.
- Watch page: **Share with AI** - the third pick in the phone picker and a
  third button in the desktop modal ("Share with AI" where the browser has
  a share sheet, else "Copy for AI"). One prompt acts at once; several
  offer a pick-one of names. Payload: the prompt, a blank line, then the
  same document Share/Copy send (desktop follows the timestamps box).
  Prompts are fetched with the transcript; any failure just hides the pick.
- Settings -> Transcript sharing (Advanced): one row per prompt (name +
  text + Remove), Add prompt, saved on change (debounced, whole list),
  server errors shown inline with the typed rows kept.
- Prose mode: timestamps off -> lines joined into paragraphs, a new one
  only at a pause of 2s or more between captions. Timestamps on is
  byte-identical to v1.200.
- One-row desktop action bar: a CSS container query on `.watch-action-bar`
  drops the button words when the COLUMN is under 960px (the ten labelled
  buttons are 953px) - so the non-theatre column shows glyphs on one row
  while theatre's wide column keeps the words at the same viewport width.
  Measured against the v1.200.0 baseline with the probe (new `--theatre`
  flag): non-theatre 1280/1366/1600: 2 rows -> 1 glyph row, all 32px;
  1920 and every theatre width: unchanged (words, one row, 32px); phones
  unchanged.

**What the gate caught (round 1, both seats independently).** The blank
"Add prompt" row rode along in every save and 400'd the WHOLE list - a new
prompt tripped a red error on its first keystroke, a Remove of another row
did not persist (gone on screen, back on reload), and edits to existing
prompts were silently lost while the blank row existed; the commit's "a
blank row is not saved until typed" was literally true and functionally
wrong. Fixed: a new row joins the list only once it is whole; no-op saves
are skipped. Also: an in-flight save response could re-render over a newer
keystroke burst (sequence counter + no render while a burst is pending);
the server's id-uniqueness guards were correct but UNBOUND (a duplicate
known id and an arbitrary client id are now asserted); a rolled caption
line first shown in a 100ms cue then rolled through a 3s one opened a
false paragraph (its endMs now extends through every cue it rolls into);
plus five correct-but-unbound branches (phone pick-one teardown, focus
guard, no-toast-after-share, fetch rejection) and two stale comments. During
T3's own measurement: a first-draft 1100px threshold stripped theatre's
words at 1280/1366 where the baseline showed them fitting (960 is the
measured line), and glyph-only buttons measured 30px not 32 (the hidden
label carried the line box - fixed).

**Known gaps (disclosed).**
- The probe's stall residual is now MEASURED (tech-debt 184): in a
  multi-width run the third-or-later Chromium launch sometimes stalls -
  shell painted, no first POST for 30s, server log empty, no JS errors; a
  width alone never stalls. Reload-twice + rerun-alone rule stands.
- Prompts are instance-wide, not per user (Dean's ruling: it is his
  install); a member sees the admin's prompts and cannot edit them.
- A save answer that is superseded still paints its error line before the
  sequence check discards it (a stale 400 can flash until the next
  keystroke) - tech-debt 185.
- Attribute's blank glyph on phones and its move behind a flag: the next
  wave (v1.202.0).

Dual-Node: 7723/0 on v22.23.1 and 7723/0 on v24.14.0 (sequential, reviewers idle). Round-2 APPROVE from both seats; their four tech-debt-able one-liners were applied in a post-approval commit (e1f4493, tested). Device pass PENDING (Dean).

### v1.200.0 - Transcript export + the action row never deforms (2026-08-28)

Dean: "Transcript export of the closed caption. Allow me to see and then
copy/paste the full transcript from the video ... title - date published -
channel - and then the transcript. Text field on desktop, copy/share sheet
on mobile. Clean and native feeling like all else."

**What shipped.**
- `lib/transcript.js` (new, pure): WebVTT -> plain text. The load-bearing
  logic is the ROLLING-CAPTION de-dup: yt-dlp auto-subs repeat every spoken
  line across 2-3 contiguous cues (the first with per-word timing tags), so
  a naive join doubles every line. The rule is the largest SUFFIX/PREFIX
  overlap between contiguous cues (see "what the gate caught" - it started
  as set membership, which lost real lines). Header = title / `Published
  <date>` (falls back to `Added <date>`, UTC day precision) / channel.
- `GET /api/transcript/:id` (`text/plain`, nosniff): same sidecar resolver,
  RBAC 404 shape and trust posture as `/api/subtitles/:id`; `?timestamps=1`
  prefixes `[m:ss]`. In all three completeness nets (route count 228->229).
- Watch page: a **Transcript** button beside Share (only when the item has
  captions; Material `chat` glyph following the `.icon-share` one-base-mask
  precedent, in all three CSS lists). Desktop: read-only text-field modal +
  Copy + "Show timestamps" (default OFF). Phone width (768px): the
  share-sheet / clipboard picker; the text is PREFETCHED so Copy runs inside
  the tap (iOS). Torn down on SPA navigation.
- **The action row never deforms (Dean's ruling, reverses v1.25.4/6's
  desktop nowrap).** Measured in headless Chromium against main: the
  10-11 button row was ALREADY squeezed at 1280/1366 (every button 42px
  tall, "Mark watched" on two lines) and the new button tipped 1600 too. Now
  the group wraps at every width and a button never shrinks/line-breaks
  (`white-space: nowrap; flex-shrink: 0`) with a uniform `line-height`
  (Download is an `<a>`, buttons are `<button>`s - their natural heights
  differed by 3px, hidden by one stretched row, exposed by two). Result:
  every button 32px on desktop at every width (one row at 1920, two clean
  rows at 1280/1366/1600 - ten labelled buttons are 953px), 39px on phones,
  no button WIDTH changed on desktop; phones get a uniform 10->8px side
  padding so ten glyphs fit one row at 390 and 375. Codified as a MANDATORY norm in
  docs/CONTRIBUTING.md with a new instrument, `scripts/action-row-probe.js`
  (before/after geometry per width; FT_ROOT=<worktree> for a baseline).

**What the gate caught (two rounds).** Adversarial CRITICAL-class: the
membership de-dup DROPPED genuine repeated utterances - a second speaker
saying the same words - 4 lines lost in Dean's own sample file, invisible
because "0 adjacent duplicates" also describes over-dropping; fixed to the
overlap rule with five new fixture classes. QA + adversarial: the phone
padding comment cited a 12px base that was never in the cascade (10px) and
a 336px figure that was never measured (325px); the modal's SPA-abort
teardown was implemented but UNBOUND (now bound; deleting it is red). Also:
long title lines forced a horizontal scrollbar (`pre-wrap`), the phone
"Share transcript" pick swallowed its clipboard-fallback outcome, an icon
lock anchored after the first selector. The pre-commit hook then REFUSED
the fix-round commit on two source locks that encoded the old nowrap
ruling (5822/2) - rewritten to lock the new rule. Round 2 (adversarial):
those rewritten locks were COMMENT-POROUS (a commented copy of the rule
kept them green while every button deformed - the recurring class; now
comment-stripped at read, mutant red); the fix-round commit mis-quoted
1600 as "one row" from a half-mounted probe line (it is two rows - the
norm's own cautionary example now); the probe could hang ~30 min on a
dead renderer (wall-clock capped, CDP rejections fatal).

**Known gaps (disclosed).**
- TV episodes have no caption route, so no Transcript button there (Dean:
  out of scope; a separate "captions for Shows" feature).
- The Attribute button's `icon-user` mask does not exist in style.css, so
  at phone widths it renders as a narrower blank box (pre-existing since
  v1.53). Dean's ruling: NOT fixed here - a follow-up wave removes Attribute
  from the default UI behind an opt-in experimental flag and gives it a
  real glyph. A broader "critical re-evaluation of all the action buttons,
  mobile first" is also planned.
- The no-deform norm is MEASURED only on the watch action row; the other
  `.btn` rows it names are governed but unaudited (tech-debt row 184,
  revisit on the next change to any of them).
- Probe residual: under software GL a page load occasionally stalls (the
  seeded stub media races the connection pool); the probe reloads up to
  twice and says so; a width that still warns is rerun alone.
- A reheat that newly writes a sidecar does not mount the button until the
  page reloads (`reloadMediaAfterReheat` refreshes data only).

Dual-Node: 7690/0 on v22.23.1 and 7690/0 on v24.14.0 (sequential, reviewers idle). Device pass PENDING (Dean).

### v1.199.2 - fix: Roku Shows wall title/counts overlap - revert to the proven single-line tile (2026-08-28)

Dean on-device (v1.199.1): the title and the two count lines STILL overlapped.
Root cause: v1.199.1's `wrap="true" maxLines="2"` title - a wrapped title's real
on-device SmallestSystemFont line height exceeds the 28px budget I hand-computed,
so its second line spills onto the count lines. Hardcoded pixel positions can't
accommodate a variable-height wrapped label (the "measure, don't guess" lesson).

Fix: mirror the app's OWN shipped GridItem/ChannelItem tiles exactly - three
single-line, non-wrapping labels at a 28px pitch. A long show name CLIPS with an
ellipsis at the 256px tile edge (the video grid's own behaviour, confirmed by
authoritative Roku Label semantics AND 170+ releases of GridItem never bleeding),
which can never overlap the counts - and a single-line title has no second line
to spill. titleLabel drops wrap/maxLines (@392); metaTop @420, metaBottom @448;
portrait itemSize height 512 -> 480 (row 2 now peeks ~90%). Channel build
1.3.1 -> 1.3.2.

Trade disclosed: a very long name truncates rather than wraps (app-consistent; a
clean ellipsis beats an overlap). A 2-line wrapped title is possible via a
LayoutGroup (auto-stacks variable-height children) but needs on-device iteration
- deferred, Dean's call. Slim adversarial gate APPROVE, no findings (the
clip-vs-overflow assumption was the load-bearing surface; confirmed). Resume
report investigated and CLEARED - a transient dev-deploy state, Dean confirmed
resume works. BrightScript is test-less - **Dean's Roku is the arbiter** (sideload
roku/scripts/deploy.sh). **Dual-Node 7653/0** (Node 22.23.1 + 24.14.0).

### v1.199.1 - fix: Roku Shows poster wall - bigger tiles, wrapped title, split counts (2026-08-28)

Dean on-device (v1.199.0): the Shows poster wall (the first screen of the Roku
drill-down) rendered posters too small, the title truncated and overlapped the
meta line, and "N seasons . M episodes" ran together. Three fixes to the shared
ShowItem tile + the portrait grid geometry (GridScreen.applyGridGeometry):

- Poster tile widened 216x384 -> 256x384, grid 7 columns -> 6
  (6*256 + 5*24 spacing + 64 left = 1720 < 1920 FHD). Reads as a poster from
  the couch; one full row with row 2 peeking ~78% as the scroll cue.
- titleLabel now wrap=true maxLines=2: a long name wraps to two lines and
  ellipsizes instead of painting one unclipped line over the meta.
- The single "N seasons . M episodes" label is split into two stacked lines
  (metaTop/metaBottom, new ftMetaTop/ftMetaBottom content fields). ShowItem is
  shared with the seasons wall, which sets only metaTop ("M episodes") and
  leaves metaBottom "" -> hidden (no stray blank line).

scaleToZoom stays the cover mode (confirmed against the Roku Poster docs), so a
poster-less show's 16:9 thumbnail stays full-bleed, matching the web page's
object-fit:cover. Roku channel build bumped 1.3.0 -> 1.3.1.

Slim adversarial gate: round-1 REQUEST CHANGES - the first cut cured the
horizontal overflow but reused a 26px SmallestSystemFont line pitch between the
two count lines (and a 54px title->meta budget), and the app's own shipped
GridItem/ChannelItem prove 28px is the safe pitch and 26px is exactly what
overlapped. Fixed to a 28px pitch (metaTop 452, metaBottom 480, cell 504 ->
512); APPROVE round 2. BrightScript remains test-less (the repo's standing
posture) - **Dean's Roku is the arbiter** (sideload via roku/scripts/deploy.sh).
On-device probe: a long, 2-line show title's second line vs the count lines (a
2px clearance that assumes SmallestSystemFont line height <= 28px, at parity
with the shipped GridItem/ChannelItem layout). **Dual-Node 7653/0** (Node
22.23.1 + 24.14.0).

### v1.199.0 - feat: TV shows in the Roku channel (poster wall -> seasons -> episodes -> play, resume synced) (2026-08-27)

Dean: "Can we get shows to show up in the Roku app :)". The in-repo BrightScript
channel grows a Shows section riding the v1.47 Channels recipe: a kind-tagged
Libraries-picker row -> a 2:3 poster wall (ShowsTask + ShowItem, per-mode grid
geometry) -> seasons rendered from the cached ShowDetailTask result (single-
season shows auto-skip; Back skips symmetrically) -> episodes (GridItem tiles,
/tvthumb art) -> playback of `/tvepisode/:id` (no ?compat=roku - the tv
rendition already lands the Roku-safe profile). The season's episode list IS the
playback queue, so Next/Previous/Autoplay/Loop ride the existing machinery
untouched. Server: the `/api/tv/:showId` episode rows gain `ext`, codec strings,
codec-aware `needsTranscode`, and the REQUESTER's own `progress` (no new routes;
census stays 228). Completion contract MEASURED, not assumed: the web's 'ended'
cascade writes progress-0 through progressEndpoint for tv too, so Roku completion
posts BOTH the web-parity progress-0 AND an explicit `/api/tv/played` latch (the
channel's 30s ping cadence can miss the 90% auto-watch on short episodes).

Slim adversarial gate: round-1 REQUEST CHANGES - a stale ShowDetailTask fire
could teleport a re-entered shows wall (unobserved at the one resetAndLoad choke
point), and the audio axis of "codec-aware" was correct-but-unbound (an
ac3-in-mp4 fixture now binds BOTH call sites; five mutants re-run red). Also
applied: codec strings ride to the TV's playback-error line; the defensive
zero-seasons arm no longer strands "Loading…". APPROVE round 2. Disclosed
(tech-debt #183): the tv transcode lane has no terminal-'failed' contract, so a
permanently-failing episode shows "Preparing…" for the full poll (Back cancels)
while each probe re-queues the job - pre-existing server behaviour newly polled
at 1 Hz; README says so plainly. Also no episode captions/chapters/prewarm (no
server surface). BrightScript remains test-less (the repo's standing posture) -
**Dean's Roku is the arbiter** (sideload via roku/scripts/deploy.sh; manifest
1.3.0). **Dual-Node 7653/0** (Node 22.23.1 + 24.14.0).

### v1.198.2 - feat: a Settings toggle to hide "Continue watching" on the Shows page (2026-08-27)

Dean: the home page's "Show Continue watching" checkbox didn't govern the Shows
page's row - and it shouldn't have: it is labelled and scoped home-only
(`ft-home-continue-watching`). Widening it silently would make its label lie, so
Shows gets a SIBLING checkbox ("Show 'Continue watching' on the Shows page",
`ft-tv-continue-watching`) through the same wireHomeRowToggle/loadHomeRowControl
machinery - BOTH halves, persist + reflect-on-load (the v1.193 lesson). tv.js's
pure `tvContinueRowEnabled()` mirrors homeRowEnabled's semantics exactly
(absent = on, '0' = off, broken storage = on), and an OFF toggle skips the
`/api/tv/continue` fetch entirely - a disabled row costs nothing.

Slim adversarial gate: round-1 REQUEST CHANGES (the KEY identity was unbound -
the semantics mocks ignored getItem's argument, so a wrong-key refactor would
silently hand the Shows row back to the home checkbox, Dean's exact reported
confusion resurrected green); closed with a key-aware mock state, mutation-
verified; APPROVE round 2. Disclosed residual: the fetch-skip source-lock binds
presence, not reachability (the standing source-lock limit). Record correction:
the feature commit's message said "7651/0"; the measured count there was 7652/0.
**Dual-Node 7652/0** (Node 22.23.1 + 24.14.0).

### v1.198.1 - feat: the "Up next" rail on episode pages (next episodes in order, wrapping to E1) (2026-08-27)

Dean's closer for the TV arc: the related rail on an episode page now lists the
show's OTHER episodes rotated around the current one - everything after it in
(season, episode) order, then wrapping from episode 1; the current episode
excluded; header reads "Up next". Zero extra round-trips (rendered from the same
show-detail fetch the prev/next queue already makes). Cards mirror the video
rail's markup with per-episode art via the NEW `GET /tvthumb/:id` (the generated
ffmpeg frame, else the show's folder poster, else the SVG placeholder - never a
broken image; gated exactly like `/tvepisode`, census 227->228). Shimmer cards
seed the rail until the detail resolves, and EVERY exit clears them (the video
rail's never-strand contract).

Slim adversarial gate: round-1 REQUEST CHANGES (the un-hide was unbound - the
hide mechanism is style.display, which the .hidden asserts could not see; and
the failure path stranded the shimmer, with the empty-show axis unbound). All
closed with mutation-verified binds + a single-episode scenario; APPROVE round
2. Verified end-to-end with the live-Chromium probe (2 cards on a 3-episode
show's middle episode, real art loading, computed display block/flex).
Disclosed residuals in tech-debt #182 (the failure-arm calls are correct-by-
reading into a bound function but themselves unbound; the escape path is
exercised, not escape-bound - parity with the video rail). **Dual-Node 7650/0**
(Node 22.23.1 + 24.14.0).

### v1.198.0 - feat: the episode-page polish round (no Subscribe, File Path fixed, fake comments; poster-upload removed) (2026-08-27)

Dean's device list, every item diagnosed + verified with the live-Chromium probe
before and after (subscribeVisible/filePathShimmer/commentsCount/ambient pixels):

1. **No Subscribe button on episodes.** v1.197 un-hid the uploader panel, and the
   button's default `hidden` attribute LOSES to `.btn`'s display rule (the
   standing `[hidden]` lesson) - it showed as a dead control. Now style-hidden.
2. **The "File Path:" row shimmered forever on episodes** (a v1.197 regression -
   the un-hidden description container carries `#file-path-text`, which the tv
   path never painted). Now painted with the file's BASENAME (the full path stays
   unexposed by design); the description text is empty (the filename lived there
   and would duplicate).
3. **The v1.196 "Change poster" upload feature REMOVED end-to-end** per Dean: the
   UI control, both routes, the DATA_DIR store + override, classifications, and
   its test. Posters = the folder image (poster.jpg etc.) or the generated
   episode frame - the convention actually in use. Census 229->227.
4. **Fake retro comments on episodes**, the same machinery as every other media
   type: episode-id-scoped localStorage bucket + the deterministic mock
   selection + the posting form (which had never been wired on the tv path -
   the inline registration sat after the `?tv=` early return).

**Theatre (Dean's item 5) intentionally NOT changed:** the probe shows the
theatre button already present and visible on episode pages on DESKTOP; on
mobile it is hidden by the deliberate v1.186 rule that applies to videos too
(theatre widens the desktop layout; it has no mobile effect - fullscreen is the
mobile analog). Awaiting Dean's call on whether a mobile theatre behaviour
should be designed (for all media) before anything ships.

Slim adversarial gate: REQUEST CHANGES round 1 (two surviving mutants - the
comments un-hide bound RENDERING not VISIBILITY, and the episode-id comment
scope was unbound), both closed with mutation-verified asserts; APPROVE round 2.
**Dual-Node 7648/0** (Node 22.23.1 + 24.14.0).

### v1.197.1 - fix: ambient mode actually PAINTS on episodes (the ?tv= early-return TDZ) (2026-08-27)

Dean (device): ambient on episodes still "seemingly not working" after v1.197.0.
The v1.197.0 fix restored the cog rows and the glow ARMED - but the paint loop
died on its FIRST frame. Root cause (the v1.54 TDZ class re-striking): init()'s
`?tv=` branch returns early, so `let mediaData` - declared further down - never
executed and stayed in the temporal dead zone for the whole page; every read
throws. `setupAmbientMode`'s `isAudioItem()` reads it per paint (in a timer, out
of any try/catch) -> ReferenceError -> no reschedule -> an armed-but-EMPTY canvas.
Invisible to jsdom (real timers + real video events are stubbed there).

**Diagnosis discipline honoured: proven empirically BEFORE the fix** - a
live-Chromium Playwright probe against the real app (real server + real `?tv=`
page, a canvas captureStream fed into the persistent `<video>` so it genuinely
plays, the ambient canvas PIXELS sampled): pre-fix = the ReferenceError + an
unpainted canvas behind an is-on glow; post-fix = zero page errors + the exact
streamed test color in the canvas.

FIX: the declaration hoisted above the `?tv=` branch (it always executes now) +
initTvWatch assigns its episode descriptor (isAudioItem - the sole tv-reachable
reader - gets real truth). Bound by a comment-stripped ordering lock + a
one-live-declaration assert + an assignment lock; the slim gate's own surviving
comment-out mutant re-run RED. Slim adversarial gate APPROVE (round 2; one
disclosed residual: the standing trailing-comment source-lock porosity, no
constructible failure today; a residual pre-return-callback TDZ seam recorded as
tech-debt #181). Dual-Node 7649/0.

### v1.197.0 - feat: the TV wrap wave - episode info panel, show-as-channel, seamless background audio, ambient + dock-return fixes (2026-08-27)

Dean's four closers for the TV arc, each root-caused from code before a line was
written. Exec plan: `docs/exec-plans/completed/2026-08-27-tv-wrap-wave.md`.

1. **Episode description + the show as the "channel."** The watch page now shows
   an episode's file name and Added/Size/Type metadata (the video look, shared
   formatters), and the uploader row is the SHOW: its poster in the avatar disc,
   the name, "N seasons · M episodes" as the subscriber line (counted from the
   fetch the prev/next queue already makes - zero extra round-trips), tap ->
   back to the show. The full filesystem path never rides the payload (basename
   only, leak-asserted).
2. **Seamless background audio for episodes.** iOS suspends an inline episode on
   lock; videos have the battle-won video->hidden-audio sidecar handoff -
   episodes now run the SAME machinery. Mapped end-to-end first: the server
   grew a TV-owned extraction lane (`tv-<id>.m4a`, file-existence readiness,
   `buildAudioExtractArgs` reused verbatim) + `GET /tvaudio/:id` and
   `POST /api/tv/episode/:id/prepare-audio` (gated exactly like the video pair);
   the client needed exactly FOUR descriptor-driven URL couplings in player.js -
   the state machine, prime, keep-alive, presync, and teardown were TV-correct
   as written. Same experimental "Background audio for video" setting governs
   both.
3. **Ambient mode for episodes** - the root cause was bigger than reported: the
   TV watch path never ran `ensureCogControlsInjected`, so episodes were missing
   the ENTIRE cog set (ambient + autoplay + loop + theatre rows). All restored,
   and the five-call sequence is now source-locked (the class had struck twice).
4. **"Failed to Load Media" on mini-player return** - the dock-return built
   `/watch.html?v=<episodeId>` (a video URL); the tv descriptor now uses the
   `readerHref` seam books/music already use for this exact bug class.

**Full two-reviewer gate (the battle-won bg-audio machinery re-opened -> full,
never slim). Both seats REQUEST CHANGES with CONVERGENT blockers, fixed in one
round:** the payload omitted `ext` so the Type field always painted its fallback
(masked by a divergent test fixture - the v1.185 class); and the cog fix itself
was presence-not-binding (the adversarial seat proved reverting the exact
ambient bug left the suite green). Both now mutation-verified red. Both seats
APPROVE. **Dual-Node 7648/0** (Node 22.23.1 + 24.14.0).

**Known residuals (disclosed, tech-debt #180):** the ffmpeg-less 503 guard on
both prepare-audio routes (video + tv) is test-unbound (fail-safe; worst case a
futile repoll chain); the three ffmpeg queues' guards are read-verified only;
episodes hand off unprimed when the "custom player on mobile" setting is off
(same as ordinary videos with native controls). A fourth single-flight ffmpeg
lane joins the existing three (the shape music already added).

### v1.196.1 - fix: episodes get the era-themed custom player on mobile (not the native strip) (2026-08-27)

Dean (device): a TV episode on his phone played in iOS's bland native controls
strip instead of the era-themed custom control bar his videos use.

Root cause = a v1.196.0 (Phase A2) over-reach I introduced. On mobile, fullscreen
video defaults to iOS native controls (v1.25.2, for chapters/CC/AirPlay); the
"custom player on mobile" Setting is the opt-in that swaps in the era-themed bar,
resolved by an `/api/settings` read in `setupForMedia`. That read lives INSIDE the
mobile background-audio block - which v1.196.0 gated off for a tv source
(`!data.statusUrl`, because episodes have no `/audio` route). So a tv episode never
resolved the setting -> `mobileCustomPlayerCached` stayed false -> `applyControlsMode`
picked the native strip. Regular videos read the setting fine, hence the mismatch.

FIX: for a tv source on mobile video, a STANDALONE `/api/settings` read resolves
just `mobileCustomPlayer` and re-runs `applyControlsMode()` - no background-audio
machinery, no `/api/videos` (uses `/api/settings`, a general route the video path
also reads, so the "a tv load never hits /api/videos" invariant is intact),
load-generation-staleness-guarded, fail-safe. Episodes now honour the setting
exactly like videos. Slim adversarial gate APPROVE (no regression to video/audio;
the fix mutation-binds; invariant intact). Dual-Node 7643/0.

Note for the device pass: the era-themed bar on mobile requires Settings ->
"custom player on mobile" ON (it's the opt-in for BOTH videos and episodes; with it
off, both use iOS's native strip by design).

### v1.196.0 - feat: TV episodes play in the REAL player (mini-player, prev/next, resume) + set-poster upload (2026-08-27)

Dean's device feedback on v1.195.0: episodes opened in a bespoke `<video controls>`
element - no mini-player, no prev/next, plain HTML5 chrome, no title, and the top
clipped under the header. All ONE root cause. This wave routes episode playback
through the app's REAL shared player (`public/js/player.js`) and folds in the
deferred resume/Continue-Watching. Exec plan:
`docs/exec-plans/completed/2026-08-27-tv-player-integration.md`.

Architecture (7a): the player was already source-agnostic - `player.load(id, data,
{slot})` takes a generic descriptor and `setTrackNav` takes arbitrary closures - so
this is a reuse, not a rebuild of the battle-won code. Tapping an episode navigates
to `/watch.html?tv=<id>`; a dedicated `initTvWatch` path in the watch view builds a
descriptor (streamSrc `/tvepisode/:id`, statusUrl `/api/tv/episode/:id`, artUrl
`/tvposter/:showId`), drives the shared player, and runs NONE of the video-only
`/api/videos` hydration. This fixes Dean's items 1-5 at once:
- **mini-player/dock, custom chrome (not HTML5), lock-screen/AirPods controls** -
  free from the shared controller;
- **episode title** shown; the header no longer clips (the real watch surface);
- **prev/next + autoplay + loop** across the WHOLE show in season->episode (binge)
  order, via the same `setTrackNav` seam the video player uses;
- **resume + a "Continue watching" row** (the folded-in Phase 5): episodes remember
  where you left off (silently, like a podcast - long-form), 90%-auto-marks watched.

Also: **an admin "set show poster" upload** (item 6) - a "Change poster" control on
the show detail; stored in the app data dir (works on a read-only share), magic-byte
sniffed, traversal-safe, wins over the folder image; and a **whole-library Shows
RBAC** completeness fix (the v1.195.1 gate finding: a `{kind:library,value:tv}`
restriction is now creatable + enforced).

**The full two-reviewer gate (battle-won player + per-user state + a file upload +
RBAC -> full, never slim) caught two blocking issues, both fixed in one round:**
- the client "Change poster" control was shown to `canModifyLibrary` members but the
  server route is admin-only -> a dead button + a lying comment; aligned to admin;
- `/api/tv/continue` (an access-control aggregation surface) had a correct but
  UNBOUND visibility filter - a mutant dropping it left the suite green; now bound by
  a test proving a restricted episode never leaks into Continue.
Both seats APPROVE. **Dual-Node 7642/0** (Node 22.23.1 + 24.14.0).

**Known limits (disclosed):**
- **Background audio for episodes** (keep-playing with the screen off) is not wired *(shipped later in v1.197.0)* -
  episodes have no `/audio/:id` extraction sidecar; lock-screen play/pause/next/prev
  DO work. A future wave if wanted.
- The "up next" episode panel on the watch page and the mobile bottom-nav customizer
  "Shows" entry remain deferred (Shows is reachable via the sidebar + Playlists).
- Custom show posters are NOT carried in the backup bundle (like avatars); the
  player-side of the no-`/api/videos` invariant is regex-source-locked, not
  behaviourally bound (player.js's jsdom-harness residual); an oversized poster body
  from a member returns 413 before 403. See the tech-debt tracker.

### v1.195.1 - fix: Shows now appears in the mobile Playlists sheet + has an icon picker (2026-08-26)

Dean (device): on mobile, Shows didn't appear in the Playlists sheet, and - unlike
every other library - there was no way to change its icon.

Root cause (single): the Shows sidebar nav link WAS wired in v1.195.0
(`injectTvNavLinkIfEnabled`), but two client ROSTERS never got a `tv` arm:
- `libraryEntriesHtml()` builds the mobile Playlists sheet (the mobile library
  surface - the desktop sidebar is not it), gating each entry on its
  content-injected `[data-nav-sidebar]` marker. It had no `tv` arm, so Shows was
  effectively unreachable on mobile. **This corrects the v1.195.0 release note's
  claim that Shows was "reachable on mobile via the sidebar" - it was not.**
- `LIBRARY_GLYPH_SLOTS` (the roster the icon picker + glyph repainter iterate, and
  which the server settings allowlist `MIRRORED_SETTING_KEYS` spreads from) omitted
  `tv`, so there was no Shows row in the picker and its glyph was never assignable.

Both now include Shows, slotted after Books / before Podcasts to match the sidebar
anchor ladder. The icon SAVE works with no server change - the allowlist spreads
from the same roster, so `glyphTv` became writable automatically. Bound with a
both-axes test (Shows lists IFF a Shows library is configured) + the sheet-mirror
and roster-driven picker/repaint tests. Slim adversarial gate APPROVE (three
mutants confirm real binding; `glyphTv` round-trips 200). Dual-Node 7623/0.

Known gap carried forward (disclosed, out of this fix's scope): whole-library
Shows RESTRICTIONS are not yet creatable - `VALID_LIBRARY_VALUES` omits `'tv'` and
the setup RBAC UI has no Shows checkbox, so in blocklist mode a restricted user
sees all Shows unless each root is blocked by path. To be fixed in the next TV
wave under its full gate (it is access-control). The mobile bottom-nav CUSTOMIZER
"Shows" entry also remains deferred (Shows now reachable via the Playlists sheet).

### v1.195.0 - feat: Shows / TV as a first-class media type (browse + playback + setup) (2026-08-26)

A new **Shows** library, first-class alongside Videos / Music / Books / Podcasts.
Point FileTube at a Plex-shaped folder tree
(`<Shows root>/<Show>/<Season N | Specials>/<Show SxxEyy - Title>.<ext>`) in
Settings and it renders a **poster wall** -> a **show detail** (season sections,
each a podcast-style episode list) -> **inline episode playback**. The internal
namespace is `tv` (the UI reads "Shows"); the browse/organization layer is new,
but playback deliberately **reuses the existing video streaming + transcode
mechanism** (`sendRangeable`, the shared `TRANSCODE_DIR` cache, codec-aware
`needsTranscode`). Filename + folder parsing only (no online metadata); a
best-effort `SxxEyy` parser with a per-show "Extras" bucket for anything that
doesn't match; show-level poster from a folder image, else a generated FFmpeg
frame; per-episode FFmpeg thumbnails. Nav is **content-gated** - the Shows link
only appears once a Shows folder is configured, so the partial feature exposes no
unfinished surface.

Shipped as **Phases 1-4 + 6** of the exec plan
(`docs/exec-plans/completed/2026-08-26-shows-tv-media-type.md`): db namespace +
pure parse/scan/store core, the scan engine, the API + RBAC surface, the client
browse UI, and the Settings "Shows folders" builder.

**The full two-reviewer gate ran (a new persisted namespace + a new stream/download
surface -> full, never slim) and caught three blocking issues, all fixed in one
round before release:**
- **Data loss:** the `db.tv` namespace was omitted from the backup bundle, and
  restore wipes the doc tables wholesale then repopulates only bundled keys - so a
  routine backup -> restore would have **silently erased the entire Shows library
  and config**. Now carried in the bundle, with an AC6 round-trip test (mutation
  proves the binding).
- **Live-watch eviction race:** episode transcode renditions were served without a
  live-watch mark, so the shared transcode-cache LRU/age sweep could delete an
  episode's rendition **mid-stream**. Now `markServed`-protected like the main
  video path.
- **Codec-blind playback:** the transcode decision keyed on file extension only,
  so an HEVC-video or AC3/DTS-audio episode in a browser-native container
  (`.mp4`/`.mov`) - the most common TV-rip shape - was served raw and never
  decoded (the client retried forever). Now codec-aware (audio codec captured at
  scan time), bound behaviourally (HEVC-in-mp4 -> transcode, clean mp4 ->
  streams).

Both seats APPROVE after the one fix round. **Dual-Node 7622/0** (Node 22.23.1 +
24.14.0).

**Known gaps (disclosed):**
- **Phase 5 (per-episode resume + mark-watched + "next episode" + a
  Continue-Watching row) is DEFERRED to a v1.195.1 follow-up.** The `user_tv_*`
  tables + delete-carrier already ship (built in Phase 1); the progress
  routes/accessors + client wiring land next. Rationale: validate the browse /
  playback layout on-device first (the v1.194 jsdom-green-but-broke-on-iOS lesson),
  and keep this gate focused on the high-risk namespace/RBAC/parser/transcode
  surfaces.
- **The mobile bottom-nav CUSTOMIZER** doesn't yet offer a "Shows" entry (Shows is
  reachable on mobile via the sidebar Library link); deferred to v1.195.1 with the
  progress wave, to avoid disturbing that surface's order-authority tests
  pre-release.

### v1.194.3 - fix: mobile sideways-scroll on the inline watch page (the scaled ambient glow) (2026-08-26)

Dean (device): watching content inline (non-fullscreen) on a phone allowed horizontal
scroll, which should never happen. PRE-EXISTING (since v1.186.0), not critters (Dean
confirmed with them off), not a v1.194 regression.

Root cause (independently diagnosed + git-archaeology): `.ambient-glow` is
`transform: scale()`'d 1.18-1.42x (the v1.187 intensity ladder), so its box overflows
the viewport horizontally on mobile. Its wrapper `.watch-player-stage` sets no overflow,
and the site-wide `html { overflow-x: clip }` is honoured WEAKLY by iOS for a scaled
descendant - so the page scrolls sideways while ambient runs (dark theme + opted-in +
playing). Fix: a mobile-scoped `@media (max-width:768px){ .watch-player-stage {
overflow-x: clip } }`. overflow-y stays visible (vertical bloom preserved); desktop
untouched (the v1.188 sidebar bleed survives); `clip` (not hidden) creates no containing
block, so the fixed `.css-fullscreen`/`.audio-expanded` overlays still escape on rotate.
Tradeoff (disclosed): removes the small ~16px horizontal glow bleed on mobile only. Slim
adversarial gate APPROVE (fullscreen escape spec-verified + the two overlays confirmed
un-trapped; test mutation-bound on two axes); Dual-Node 7570/0. **DEVICE PASS PENDING.**

### v1.194.2 - fix: audio rotate-to-fullscreen was trapped behind the chrome (the audio twin of the v1.186.1 fix) (2026-08-26)

Dean (device): on mobile, rotating to landscape on the WATCH page fullscreens a
VIDEO but not an AUDIO file. A PRE-EXISTING bug (since v1.186.0 - not a v1.194
regression; Dean saw it on v1.192).

Root cause (independently diagnosed, git-archaeology): v1.186.0 introduced the
ambient `.watch-player-stage` stacking context (z-index:0), which trapped BOTH the
video and audio fixed fullscreen overlays beneath the app chrome. v1.186.1 rescued
VIDEO with `body.ft-css-fullscreen .watch-player-stage { z-index: auto }` but never
wrote the AUDIO twin. So an expanded audio overlay (position:fixed; inset:0;
z-index:var(--z-player-max) 1100, set by setAudioExpanded via body.ft-audio-expanded)
stayed confined to the stage's root z-index 0 and painted BEHIND the header (1000) /
dock (950) / bottom-nav (900). Watch-page-specific: only watch.html has
`.watch-player-stage`, so music/podcasts shells were never trapped - which is exactly
the same-page "video works, audio doesn't" contrast Dean saw.

Fix: add `body.ft-audio-expanded .watch-player-stage` to the same drop rule
(style.css). The body class is already toggled by setAudioExpanded, so NO JS change -
a purely symmetric CSS addition. Also fixes tap-to-expand on the watch page. Slim
adversarial gate APPROVE (both axes + the z-index value mutation-verified, no
regression to the z-ladder); Dual-Node 7569/0. **DEVICE PASS PENDING** - the code path
is confirmed; the visual (art covers the chrome on rotate) is Dean's device call.

### v1.194.1 - HOTFIX: revert the critter rotation-persistence (device regression); keep the text fix (2026-08-26)

v1.194.0's fix #1 (critters persist across rotation) REGRESSED on Dean's device:
turning the phone sideways left critters mis-rendered as dark clipped shapes
stacked down the left edge - portrait X-coordinates crammed into the left strip of
the wider landscape viewport, with the peek-clips gone degenerate. Root cause: the
width-keyed layout cache assumed desktop-like `window.innerWidth` semantics across
rotation; the unit tests were jsdom (NO layout engine), so this whole class was
invisible to them. Per the diagnosis-discipline rule (a shipped fix that fails on
device = WRONG diagnosis; do not patch on a theory), the rotation-persistence
feature is REVERTED to the known-good v1.193 behavior (critters simply re-scatter on
rotate - no persistence, but no craziness).

`public/js/common.js` and `test/unit/critter-mode.test.js` are restored
BYTE-IDENTICAL to v1.193 (2801d2c); the mechanical revert carries zero new code.
**Fix #2 (the iOS handoff-card `text-size-adjust:100%` pin) is RETAINED** -
Dean confirmed on device that the text fix works.

Rotation-persistence will be redesigned properly against the real iOS viewport
model (visualViewport / orientationchange), tested ON-DEVICE iteratively, in a
future wave - never shipped on a jsdom-only theory again. Tech-debt #178/#179
(the pre-existing critter-test flake classes) remain accurate about that file.

### v1.194.0 - two mobile bug-fixes: critters persist across rotation; handoff-card text no longer balloons (2026-08-26)

Two bugs Dean reported on mobile.

**1. Critters re-randomized on every phone rotation.** Root cause: the critter
layer's width-gated `resize` handler re-rolled the whole scatter from scratch
(`Math.random`, no seed, no persistence) whenever the viewport WIDTH changed - and
a rotation swaps width<->height, so rotating away AND back both tripped it. Fix: a
per-view width-keyed layout cache. Each scatter and re-glue records its layout
under the current viewport width (`rememberCritterPlacements` - the sole real
placement writer, so both paths funnel through it); a width we've already laid out
RESTORES that exact set (`restoreCritterLayoutForWidth`, rendered still) instead of
re-rolling. Navigation and settings-changes clear the cache; the resize path
preserves it so the return trip restores. A genuinely new orientation still
scatters fresh once.

**2. The "Playing on iPhone" handoff card TEXT ballooned after exiting fullscreen.**
Root cause: `-webkit-text-size-adjust` was pinned NOWHERE, so iOS Safari
font-boosts the card when the fullscreen-exit reflow (header/bottom-nav un-hide,
overflow restores) re-runs its text-autosizing pass. It only cleared on navigation
because the card is rebuilt fresh on `<body>`. Fix: pin `text-size-adjust: 100%`
(both spellings) on the `html` root - the standard iOS defeat; 100% only DISABLES
the boost, never scales down. **DEVICE PASS PENDING** - iOS font-boosting is not
reproducible off-device, so this ships disclosed and Dean's device is the arbiter.

**What the FULL two-reviewer gate caught (both seats APPROVE after three fix
rounds):** (a) the rotate-back restore could still paint a stale layout over
content that reflowed while rotated (a narrow revival of the v1.173
drift-over-text class) - fixed by declining the restore when the page height
drifted past the settle threshold, reusing the same pure drift decision the settle
ladder uses, with the baseline height measured post-render for a symmetric
comparison; (b) the funnel binding and the CSS fix were initially test-unbound
(presence-not-binding) - now source-locked and mutation-verified; (c) the wave's
own new test flaked a release-qualifying run (a module-global cache + Node's real
global `fetch`) - made deterministic (0/N under load).

**Known residuals (disclosed):** the drift gate is fail-safe but can occasionally
decline a LEGITIMATE rotate-back (the outgoing orientation's critter layer shifts
`scrollHeight` by up to ~26px), costing the persistence optimization for that one
rotation - worst case is the pre-v1.194 re-roll, never stale paint (tech-debt).
A pre-existing file-wide test-flake class (leaked timers + a separate
module-resolution race in an unrelated file) is tracked as tech-debt #178/#179;
both dual-Node runs (Node 22.23.1 and 24.14.0, 7574/0 each) came up clean.

### v1.193.0 - critters: experimental "let critters overlap a little" (light kiss) (2026-08-26)

Dean's follow-up to v1.192: with STRICT no-overlap he noticed noticeably fewer
critters on mobile at the Obscene density (the strict rule drops the most where
anchors are packed tight, which he accepted) - "let's do light kiss and make
that an experimental setting".

New per-device pref `ft-critters:kiss` - a Settings -> Critters checkbox
**"Let critters overlap a little (experimental)", default OFF**. The inter-critter
drop test became an AREA budget via a shared `critterOverlapExceeds(a, b, allow)`
used by BOTH the planner and the re-glue drift path. OFF passes `overlapAllow 0`,
which is byte-identical to the v1.192 strict rule (any positive-area overlap
dropped; tangent still allowed). ON passes `CRITTER_KISS_FRACTION` (0.25): a pair
may share up to a quarter of the SMALLER box's area, so light grazes survive
(more critters in tight spots) but a real stack never does. It changes placement,
so toggling re-scatters live like density/size.

**Gate:** full two-reviewer, both APPROVE after one fix round. QA proved the OFF
path byte-identical with a 200k-pair sweep; the adversarial seat with a 5M-pair
sweep (0 mismatches) + 0 guard violations across 19,717 kiss placements (worst
realized overlap capped at exactly 0.25 - no tower). Adversarial WARNING (fixed):
the checkbox's reflect-on-load was test-UNBOUND (presence-not-binding, the sibling
randomSound had its assertion, kiss didn't) - added the source-match assertion,
mutation-verified red. Comment/copy polish: the planner comment named the old gate
function; the setup copy's "no stack" was pairwise not global.
**Known residual:** tech-debt #177 - the kiss budget is PAIRWISE, so a light N-way
corner cluster (measured depth 3, each pair <=0.25, every critter still 75%+
visible) is reachable at Obscene; opt-in experimental, no heavy stack. Dual-Node
green (Node 22 + 24 both 7568 pass, 0 fail). Dean's on-device pass PENDING.

### v1.192.0 - critters: no overlap, fully opaque, no mobile sideways-scroll (2026-08-26)

Three Dean bug reports, one wave.

1. **Critters never literally overlap.** planCritterScatter sampled distinct
   anchors but had no inter-critter check, so a vertical thumbnail column
   (Related files) flung its peeks into one band and piled a tower of
   overlapping critters (Dean's screenshot). Both the planner and the re-glue
   drift pass now reject any placement whose box intersects an already-placed
   critter's box (skip, never nudge; buttons keep ambush priority via the
   weight-3 draw). Dean chose STRICT zero-overlap over "a light kiss".
2. **Fully opaque.** `.critter-pose` carried `opacity: 0.95` ("decorative layer
   softness") on every live critter, so uploaded transparent PNGs read faintly
   see-through (the feed was legible through them). Removed it - the resting
   state is now solid. The 0->1 arrival fade on the wrapper is untouched, and
   the built-in placeholder SVGs keep their own per-shape fill opacities.
3. **No mobile horizontal scroll (a regression).** renderCritterPlacements
   inflates each wrapper by pad = round(w*0.3) rotation-headroom on every side;
   the screen-edge invariant only clamped the BARE box, so an edge-flush
   critter's transparent pad poked past the viewport. `html{overflow-x:clip}`
   is the app's ONLY horizontal clamp and iOS honours root-propagated clip
   weakly, so it surfaced as sideways scroll on Dean's phone. Both the planner
   and re-glue guards now clamp the PADDED extent inside the viewport
   (horizontal only; vertical pad overflow just extends the legal scroll axis).

**Gate:** full two-reviewer. Both seats verified the three source fixes correct,
exact (the guard pad matches the renderer's byte-for-byte) and well-bound in the
PLANNER first pass; the adversarial seat then caught a real blocker - the two NEW
re-glue guards (pad clamp + overlap drop) shipped WITHOUT binding tests (both
mutants survived the full suite: the presence-not-binding class, on the wave's
own bug axis since the drift path fires on every content nudge). Added two
behavioural JSDOM reglue tests, mutation-verified (M2/M4 red) by me and both
seats; both re-verdicted APPROVE. Also de-flaked the v1.178 adoption test whose
a3/b3 fixture relied on Math.random seeding two non-overlapping critters on
now-colliding (300x200, 160px-apart) anchors.
**Known residuals:** tech-debt #175 - the no-overlap rule is bare-box exact, not
rotated-pose exact, so ~13% of scatters can still graze at a tilted (+-38deg,
~1.4x extent) corner, mostly transparent art (Dean's fully-overlapping tower is
gone). #176 - the v1.178 claimed-seed mutation is now probabilistic (the new
overlap guard can mask it in that closure). Dual-Node green (Node 22: 7565 pass;
Node 24: 7565 pass; 0 fail both). Dean's on-device pass PENDING.

### v1.191.0 - critters wave: buttons-behind work, hamburger re-scatter, 18 tap reactions, clearer popcorn glyph (2026-08-25)

Four Dean requests, one wave.

1. **Buttons behind critters work.** v1.188 made a tap on the whole critter BOX
   win (chirp + capture-phase swallow); a button the critter peeked from behind
   stopped working. Reverted critterTapHit to hit only the VISIBLE region (box
   minus its own anchor): a tap over the anchor goes to the button; the exposed
   peek + any overhang past the anchor still win + swallow (keeps the "obscuring
   OTHER furniture" behaviour). The v1.189.1 z-order occlusion guard + the
   keyboard `!e.detail` guard are unchanged.
2. **Hamburger re-scatters critters.** Collapsing/expanding the left bar widens
   the content column but fires no window resize, so critters hung in place. The
   menu-toggle handler now calls the same scheduleCritterScatter the theatre
   toggle uses (guarded; no-op when off).
3. **18 tap reactions** (was 6): + nod, wobble, boing, swing, pop, headshake,
   tada, rubberband, backflip, doublehop, peek, float. All transform-only, ride
   the pose's angle+flip, reduced-motion-safe.
4. **Popcorn theatre glyph** redrawn clearer + taller (evenodd striped tub +
   puffs overflowing the top/sides) and scaled to match the settings-cog footprint.

**Gate:** full two-reviewer. Functional work APPROVED clean by both seats first
pass; each seat then caught a doc/test blocker - QA: three tap comments still
described v1.188's whole-box model this wave reversed (a revert-the-fix trap);
adversarial: the reaction-pool reduced-motion test lock was VACUOUS (its haystack
swept in the class definitions, so a dropped reaction shipped a
prefers-reduced-motion regression green). Both fixed + delta-re-confirmed.
**Known residual:** tech-debt #174 - the visible-region hit-test uses the anchor's
bounding RECT, so a png sliver in a round avatar's bbox corner is untappable
(one-directional, errs safe, disclosed). Dual-Node green.

### v1.190.0 - theatre no longer clips the page bottom; toolbar pills match the feed weight (2026-08-25)

Two Dean device reports.

1. **Theatre height clip.** With the left bar collapsed AND theatre mode on, the
   player expanded to ~full viewport width and its height ran past the screen,
   clipping the bottom of the page (real YouTube caps this). `.player-container`
   was width:100% with no desktop height cap. Fix: in theatre, bound the width by
   the height the viewport can show, so the player switches from width-driven to
   HEIGHT-driven once it would overflow and centres (page bg to the sides) - exactly
   YouTube's theatre. **Gate WARNING (correct; I initially pushed back wrong):** the
   wrapper is NOT ratio-constrained here - rule 6369 `#player-wrapper:not(.audio-
   expanded)` overrides the base 16:9 to `aspect-ratio:auto` and reserves 40px for
   the control bar, so the bar + 2px border are ADDITIVE; the first cut left the bar
   ~18px under the fold. Budget corrected to subtract the 40px+2px too (~24px
   breathing now). LESSON logged: verify the property that actually drives layout
   against source (I checked the wrapper's padding but not its aspect-ratio, then
   argued a plausible-but-wrong border-box theory - the reviewer named the exact
   overriding rule). Excludes audio-expanded + both fullscreen paths; desktop-only.
2. **Pill weight.** The toolbar pills (home + books/music/podcasts/history)
   inherited the base `.btn` --fw-semibold, reading "bolder / different" than the
   modern feed chips (`.modern-chip` = normal). Set them to `normal` (active chip
   too - its inverted fill is the emphasis). Prompted a process note: when matching
   an existing component, build from its REAL css + show a side-by-side (norm saved).

**Gate:** slim (adversarial). APPROVE after the arithmetic correction + a per-line
(vh/dvh) test-lock hardening (the recurring divergent-twin class). Dual-Node green.
The theatre FEEL is Dean's on-device arbiter (collapse the bar + theatre, confirm no
bottom clip). Offered-but-not-yet-done: a single shared pill class so consistency
can't drift (Dean's call).

### v1.189.1 - critter taps respect z-order: no chirp/click-eat under an open overlay (2026-08-25)

Dean, on-device: with the notification dropdown open over a critter (peeking on a
related file), clicking IN the dropdown made the critter chirp - and, worse, the
v1.188 capture-phase swallow (stopPropagation + preventDefault) ate the dropdown
item's own click. Root cause: the v1.188 whole-box tap swallow hit-tests by
COORDINATES only, ignoring z-order. The critter layer is `z-index: 2` (correctly
painted behind overlays, which ride the `--z-*` ladder at 900+), but a click that
geometrically landed in a critter box was treated as a critter tap regardless of
what was on top.

Fix: a `critterOccludedAt(target)` guard walks from the click target up to
`<body>` and stands the tap down when any positioned ancestor is stacked STRICTLY
above the critter layer's live z-index (default 2). Wired into BOTH the capture
click handler and the mousedown selection-guard, after the cheap geometric
hit-test. Anchors the critters peek from are z-auto / below the layer by
construction (the sandwich needs the critter to paint OVER its furniture), so a
genuine peek tap never trips it; fails open in a non-DOM context.

**Gate:** FULL (both seats - the QA seat caught the last swallow edge case, so
this swallow fix earned two seats). Both APPROVE. The adversarial ran a 6-mutant
battery and empirically disproved the dangerous over-suppression regression (that
a critter could become un-tappable because its card sits high in the stack); the
QA seat machine-enumerated every `z>2` context and checked all 15 anchor
selectors. All three non-blocking SUGGESTIONs applied (bind the z default, guard
the layer read, sweep stale `z-index:-1` comments). **Known residual:** tech-debt
#173 - the `.main-content` ground-contract comment + some critter-mode test
comments still narrate the pre-v1.168 z:-1 model (stale rationale, all assertions
green); left for a follow-up sweep per gate pacing. Dual-Node green.

### v1.189.0 - modern pills extended to the books/music/podcasts/history toolbars (2026-08-25)

Follow-up to v1.188.0's home-toolbar pills (Dean: "continue on with anything left
from pill perspective for other pages"). CSS-only, additive. Applies the same
`.modern-chip` recipe + same tokens to the remaining list-page toolbar
containers: `.books-toolbar`, `.music-toolbar-actions` (used by BOTH music and
podcasts), and `.history-toolbar-actions`. Fully rounded, flat, hairline border,
hover-to-sidebar - all token-driven, so they theme with every era + light/dark
(census stays 0; this also answered Dean's "are the colors coming from the token
system?" - yes, entirely).

The one design call the home toolbar didn't need: these carry PRIMARY actions
(+Add / Subscribe), so the flat secondary fill is scoped to `:not(.btn-primary)` -
the primary keeps its `--yt-red` accent and only its SHAPE rounds. Left as-is on
purpose: the `.music-tab` underline-tab strip is a tab component, not a toolbar
button (flagged for Dean).

**Gate:** slim (adversarial seat alone - a CSS-only styling batch). APPROVE;
verified the token-only theming and the primary-accent cascade by measurement.
One non-blocking SUGGESTION applied: the new test now also binds the hover tint
(it was asymmetric with the v1.188 sibling test). Dual-Node green: 22.23.1 +
24.14.0. No known gaps.

### v1.188.0 - popcorn theatre glyph, library pills, critter/ambient polish + subs diagnostics (2026-08-25)

A six-item follow-up wave (Dean's list).

1. **Popcorn theatre glyph** - the watch-page theatre button's inline SVG was a
   generic box; now a popcorn bucket, so the control says what it does. Pure
   visual (no test binds the geometry).
2. **Library toolbar pills** - the classic home/library `.section-actions`
   toolbar (Sort / Shuffle / Rescan / View + the All/Videos/Audio and
   watched-state filter toggles) adopts the `.modern-chip` feed-pill recipe:
   fully-rounded, flat secondary fill, hairline border, hover-to-sidebar,
   inverted active state. All token-driven (census stays 0). DISCLOSED per-era
   residual: the 2009 skin paints its `.btn` fill with `background-image`, so it
   keeps its gloss (the button still rounds); a 2009-scoped override keeps the
   active label legible against that gloss (a gate WARNING - the first cut
   inverted the text to `--bg-color` and went illegible on the retained gloss).
3. **XL critter flip** - the 180deg bottom-family flip is now gated on anchor
   COVERAGE (flip only when the anchor hides >= half the critter), guarded on
   `sizeScale > 1` so tiny/normal output is BYTE-IDENTICAL to v1.187 (proven:
   28,800-case before/after diff, 0 mismatches). Kills the "derpy upside-down"
   look at large/xlarge where the whole body shows.
4. **Critter tap wins its whole area** - a tap anywhere on the critter png now
   chirps AND is swallowed (capture-phase `stopPropagation` + `preventDefault`),
   never clicking through to the card/control behind it. Reverses the old "the
   link always wins" posture. A gate WARNING caught that this also swallowed
   KEYBOARD/programmatic clicks (detail===0, coords at the viewport origin) - an
   a11y regression - fixed with an `if (!e.detail) return;` stand-down that fails
   safe on touch.
5. **Ambient over the left bar** - in dark mode the ambient glow now bleeds
   across the left sidebar instead of hard-stopping at it. Root cause was the
   opaque sidebar (z-index 99) painting over a bleed that was already there; a
   root `data-ambient-on` signal (set/cleared at the glow's own start/stop
   funnel) drops the sidebar bg + border to `transparent` while ambient runs.
6. **Subscription list-pass observability** (DIAGNOSTIC ONLY, no behaviour
   change) - Dean: subscriptions "succeed" but don't download; a 5-day-old
   normal upload was skipped and stayed skipped on re-pull (he'd switched the
   yt-dlp engine Nightly->Stable). The survivor loop had three SILENT drop paths
   (archive dedup, the date gate, premiere-defer); now every poll logs a
   one-line summary ("N listed, M new to download (dropped: ...)") plus a
   per-video line on the two rare silent paths. This is instrumentation to
   root-cause his next re-pull, NOT a fix - the actual cause still awaits his
   yt-dlp version + the log lines + the video URL.

**Gate:** full two-reviewer. Adversarial APPROVE first pass (reproduced every
claim by measurement, incl. the byte-parity and zero-behaviour-change proofs);
QA seat caught two WARNINGs (the keyboard-click swallow a11y regression, and the
2009 active-toggle illegibility WITH a mis-stated disclosure comment) - both
fixed and delta-re-confirmed by both seats. **Known gap:** item 6 is diagnostics
only; the subscription-download root cause is still open pending Dean's device
data. `progress-coalescer.test.js` has a pre-existing parallel-load timing flake
(passes 23/23 in isolation, untouched by this diff) - disclosed.

### v1.187.2 - ambient cost fix: playback paused itself on mobile (Dean device) (2026-08-25)

Dean, device: with Ambient ON, playback pauses itself ~2-3s in AND the Dynamic
Island loses its artwork - audio and video alike, consistently, other apps
force-closed. Ambient OFF: normal. Critters OFF: no change.

ATTRIBUTION IS UNCONFIRMED, and the release says so rather than claiming a fix.
Both symptoms match `releaseAudioSession()` (pause + `mediaSession.metadata =
null`), but the gate traced its only reachable path: a `pagehide` with
`persisted === false` - a page actually UNLOADING, which Dean did not report.
The equally consistent explanation is iOS killing the renderer / interrupting
the audio session, which runs NO app code and leaves that function innocent.
Calling it "one function" was an INFERENCE STATED AS MEASUREMENT, corrected in
three source comments. The decisive probe is the app's own lifecycle log
(`?debugLifecycle=1`, armed BEFORE installing this build): a `pagehide
persisted:false` entry at the pause confirms the function ran; no entry means the
pause came from outside the app entirely. That probe should have preceded the fix.

What IS certain is that Ambient ON reproduces it, so the effect's cost is cut to
a floor (ranked by actual saving on the affected device):
- DOMINANT: the CSS blur drops 64-88px -> 22-36px on a full-width composited
  layer (a large radius outsets ~3x on every side, times DPR^2), and
  `will-change` no longer pins that surface permanently.
- The loop leaves the frame loop: rAF woke the main thread ~60x/s to
  early-return for a 2fps sampler. Now a plain timer.
- SMALLEST (corrected at the gate): the canvas backing store is a fixed 32x18
  stretched by CSS instead of being resized to the player's box - ~0.09 MP
  (~350 KB) per paint on a phone, not the "~1.4 MP" first claimed (that figure
  was a desktop-theatre box, ~16x off for the affected device).

KNOWN LOOK CHANGE, disclosed: the halo is deliberately ~2.4x TIGHTER. The old
pipeline also upscaled from the same 32x18 source before blurring, so nothing new
supplies softness - the radius cut is a real trade, not a free substitution, and
`intense` no longer matches v1.186's 72px blur. Retuning levers are SRC_W/SRC_H
or --ambient-scale, NOT a per-width blur (the composited layer is LARGER on
desktop, so keeping the old radius there would preserve the heaviest cost).

Slim gate (adversarial), APPROVE after THREE rounds; 21 of 22 final mutants
killed (the survivor is correct boundary behaviour at the 40px cap). It caught:
a real latent bug (deleting `timerId = null` from stop() passed the suite and
would have left ambient dead after the first pause - timerId is also the
"already running" guard); that my falsification was unsound (the sampler decided
"is this video?" from WebKit's `videoWidth`, which an audio file with embedded
cover art can make non-zero, so the drawImage theory was never excluded - now
gated on this view's own `mediaData.type`); that my first replacement gate
(`.audio-mode`) also required extractable embedded art, so an art-extraction
failure would have fallen through anyway; that my cost figures were 16x off for
the affected device; that a "cost invariant" test bound no cost (a 16ms interval,
an intermediate canvas and a `will-change` on another rung all passed); and that
a correction I REPORTED AS LANDED was never in the tree. The seat also audited
its own prescription for what it removed, and self-corrected twice in earlier
rounds.

Tests: watch-chrome-ambient 17 -> 18 (a COST invariant: no backing-store resize,
no per-paint layout read, no rAF, blur <= 40px at every rung, no will-change on
ANY .ambient-glow rule, the audio gate bound as an exact expression). Full
`npm test` 7549/0 measured on the shipping commit. Device pass PENDING - if it
still pauses, the lifecycle log gets READ before any retreat to desktop-only
(with a `pagehide persisted:false` entry that retreat would be the wrong move).

### v1.187.1 - ambient hotfix: the glow was masked INSIDE the player (Dean device) (2026-08-25)

Dean, on device: "I see the options for ambient mode but nothing renders, at any
level." Root cause was pure geometry, and mine from v1.187. The #ambient-glow
canvas is exactly the player's box and paints BEHIND it (the player carries an
opaque letterbox-black background), so ONLY the part spilling outside the player
is ever visible. Visible reach = the mask's transparent stop x the scale. v1.187
shipped stop 76% against scales 1.18/1.25/1.30/1.42:

  subtle 0.90 | normal 0.95 | intense 0.99 | extreme 1.08

Three of four rungs sat entirely INSIDE the player's footprint and were painted
over; `extreme` was an 8% sliver the 56px blur swallowed. The mask added to fix
Dean's hard-edge complaint shrank the glow inside the footprint it had to escape
- the falloff was fixed and the feature destroyed in the same edit, because the
mask was reasoned about in isolation instead of against the one thing that makes
the glow visible at all.

FIX: the transparent stop moves 76% -> 100% (alpha still reaches zero AT the
element edge, so no hard cut returns) and the SCALE alone sets the bleed:
18/25/30/42% past the player. The solid core also widens 15% -> 40% (gate S2:
the mask ATTENUATES the escaping ring, so the ladder rendered far dimmer than its
opacity numbers implied - `subtle` was 4.7% effective, likely still "nothing" on
a phone). Effective peak alpha at the player edge is now 6.6 / 16.7 / 26.9 /
45.4%. The ramp stays 0.6 of the half-extent, and the core boundary is provably
buried inside the opaque player at every rung (innermost visible radius 0.704 >
0.40), so the visible falloff is still a pure linear ramp to zero.

Slim gate (adversarial), APPROVE after two rounds. It caught that my new REACH
invariant read only the FIRST `transparent N%` - the `-webkit-` line, which every
modern engine overrides: editing only the standard `mask-image` line re-shipped
the invisible glow with a green suite (the v1.77 divergent-spelling class landing
on the very test written to prevent this bug), and a later `.ambient-glow` rule
could shadow the mask wholesale. The test now reads BOTH declarations, requires
them to agree, refuses a second base rule, binds the ramp width, and drives its
rung loop off AMBIENT_LEVELS. 13 mutants, all dead - including three that
survived round 1. The seat also disclosed that its own S2 advice made the
mobile screen-edge run-off ~1.4x stronger, and corrected two stale numerals in my
comment.

Corrected claim: "intense restores v1.186 exactly" is TRUE of the reach (1.30)
and of its opacity/blur/saturate/scale values, but NOT of edge brightness - the
falloff necessarily dims the edge, and that dimming IS the hard-cut fix.

Known gaps DISCLOSED: (a) on a mobile full-bleed player the page's overflow clip
still cuts the halo at the screen edge at 3-36% effective alpha (reach > 1 and
zero-alpha-at-the-clip are mutually exclusive above scale 1.09; the wave chooses
visibility - a run-off at the physical screen edge reads as light leaving the
frame, unlike v1.186's ~70% mid-air cut). `extreme` on a phone is the sharpest
case and heads Dean's probe list. (b) tech-debt #172: ambient is inert in the
expanded-audio view (its fixed full-viewport overlay collapses the stage) -
pre-existing, the visible outcome is correct, and the seat agreed widening the
hotfix into that stacking path was out of scope.

Tests: watch-chrome-ambient 16 -> 17. Dual-Node 7548/7548 on v22 + v24.
Device pass PENDING.

### v1.187.0 - critter sneak-in + size choice, ambient intensity + organic falloff (Dean) (2026-08-25)

Dean's four asks, one wave:
1. SNEAK-IN: the critter arrival was ABRUPT. The fade slows 0.25s -> 1.2s
   (`--dur-critter-arrive`) and gains a subtle RISE. Opacity stays on the clipped
   WRAPPER; the rise rides the POSE (animating the wrapper would swing the clip
   cut - v1.168), so a critter rises INTO place from behind its anchor. The rise
   is PER-PLACEMENT: clamped to the wrapper pad (a fixed 7px cropped 52% of
   `tiny` critters mid-arrival) and SIGNED by peek direction (one sign pushed the
   whole bottom family TOWARD concealment). Reduced-motion keeps the fade, drops
   the movement; a re-glue stays silent on both axes.
2. AMBIENT INTENSITY (Dean: "almost too intense"): subtle/normal/intense/extreme
   in the player cog under the Ambient toggle, live-tunable while watching. The
   level rides a `data-ambient` attribute; CSS owns opacity+blur+spread per rung
   so a swap is a pure repaint (the sample loop never restarts). `intense`
   restores v1.186's look EXACTLY; DEFAULT steps down to `normal`.
3. CRITTER SIZE: tiny (0.5x) / normal / large (2x) / extra large (3x) in
   Settings -> Critters. The scale multiplies the computed size, its floor/cap
   AND the cross-axis proportion allowance - without that last part the fit rule
   shrinks every large critter back to its anchor and the option is INERT.
4. ORGANIC FALLOFF (Dean: "hard cuts where it just stops on lines"): the glow was
   an unmasked rectangle whose blurred edge still terminated on a straight line.
   It now carries a radial alpha mask under BOTH spellings, sized `closest-side`
   (the farthest-corner default left 11-45% alpha at the viewport clip - worst at
   `extreme`, the rung picked for MORE light).

FULL gate, BOTH seats APPROVE after THREE rounds - the most productive gate of
this arc. Round 1: QA + adversarial both caught a REAL defect (scaling the fit
allowance let a critter wholly ENGULF its anchor; buildCritterClip has no cut for
that topology and returns '', so the renderer applied NO clip and the critter
painted fully over its own furniture) AND that the wave's headline ruling had
ZERO test binding (three mutants making large == xlarge survived the whole
suite). Round 2: QA proved my engulf guard was too broad - inclusive containment
discarded valid tangent T-notches (1153 divergences per 75600 scale-1 scatters,
breaking byte-parity) and gutted the v1.169 micro-ambush anchors; narrowed to
strict, which is island-exact. Round 3: rebound the RIGHT half of the v1.180
screen-edge rule at 3x (my own fixture retune had unbound it). Final state: 12/12
mutants killed, 0 invariant failures across ~800k placements, 0 unclipped
placements, scale-1 output byte-identical to v1.186 (12000/12000).

Both seats also corrected THEMSELVES on the record: the adversarial's scale-1
parity oracle was a divergent fixture that never produced the tangent geometry,
and QA's round-1 percentages were read off a tree the other seat was mutating
(my scheduling error - the seats need separate trees; see the memory entry).

Known gaps, DISCLOSED: (a) large/xlarge place up to ~20-25% fewer critters -
bigger critters fit in fewer legal spots; the density setting is a ceiling, not
a quota; (b) the loss concentrates on small anchors - a 3x critter still ambushes
a 36px avatar, ~50-60% less often; (c) at large/xlarge a critter often sprawls
past a small anchor's far edges (unavoidable for the rungs asked for);
(d) tech-debt #171 - the full-bleed rule is unbound above scale 1 (subsumed by
the screen-edge guard, which leaves no survivor to assert against), so the claim
was removed from the test title rather than faked.

Tests: critter-mode 82 -> 89, watch-chrome-ambient 12 -> 16, plus the new token
in its three mandatory places. Dual-Node 7547/7547 on v22 + v24. Device pass
PENDING (Dean: the sneak speed and whether `normal` is the right ambient default
are both one-line tunes).

### v1.186.1 - watch hotfix: fullscreen trap + theatre/watch critters (Dean device) (2026-08-25)

Three on-device regressions/gaps from v1.186, caught by Dean testing:
1. ROTATE-TO-FULLSCREEN broke - the sidebar/header painted OVER the fullscreen
   video. Root cause: v1.186's ambient layering put `z-index:1` on #player-slot,
   making it a stacking context that TRAPPED the faux-fullscreen overlay
   (#player-wrapper.css-fullscreen = position:fixed z-index:var(--z-sheet)) below
   the chrome - the v1.166 "isolation traps in-view fixed overlays" class. FIX:
   the ambient stacking context moved onto .watch-player-stage (glow at
   z-index:-1), #player-slot carries NO z-index, and faux fullscreen drops the
   stage context (`body.ft-css-fullscreen .watch-player-stage { z-index:auto }`)
   so the fixed overlay escapes to root. Restores pre-v1.186 rotate behavior.
2. THEATRE toggle didn't re-place critters (they stayed put as the layout
   widened). FIX: exposed window.FileTube.scheduleCritterScatter, called from the
   theatre toggle.
3. WATCH-PAGE critters "spawned then re-shuffled to all-new spots." Root cause: a
   v1.182 gap - critterPageLoading() gated only on `.skeleton-card` (the feed
   skeleton), but the watch related sidebar loads via `.skeleton-shimmer`, so
   critters revealed early then re-scattered when it landed. FIX: gate on the
   universal `.skeleton-shimmer` too; and strip the static #video-desc-skel's
   shimmer on paint (it was hidden-not-stripped, which kept the gate stuck true
   and forced the 2.5s cap) so the fast quiet-settle path works on watch.

Slim gate (adversarial), APPROVE: it traced the full player ancestor chain
(no other stacking context traps), confirmed body.ft-css-fullscreen is set on the
ROTATE path (the actual trigger), proved the reveal cap is independent of
critterPageLoading (a forever-shimmer page still reveals), and mutation-bound
every new source-lock. Device-only surfaces (rotate/fullscreen stacking, live
layout) are source-locked; the desc-skel strip is a DOM-integration behavior
without a dedicated test (low risk, cap-backstopped). Dual-Node 7536/7536 v22 +
v24. Device pass PENDING (Dean re-testing the three).

### v1.186.0 - watch chrome consolidation + Ambient mode (Dean) (2026-08-24)

Dean's four-part watch-page wave:
1. REMOVED the page `‹Previous / Next›` buttons (+ the whole bar) - redundant
   with the player's own track-nav, which already covers feed-order + queue nav
   for video and audio (setupPrevNext -> setupTrackNavContext keeps the
   computeNeighbors -> setTrackNav registration; only the page buttons are gone).
2. THEATRE relocated to an era-style icon (#theater-btn) next to the cog,
   desktop-only (was a JS-built text button in the removed bar).
3. AUTOPLAY + LOOP moved into the player's cog menu.
4. AMBIENT MODE (new, YouTube-style): a blurred, color-sampled bloom cast behind
   the player from video frames or the audio cover art. Dark-themes-ONLY,
   default OFF (opt-in, ft-ambient), desktop + mobile. A single pure
   `ambientShouldRun` gate (prefOn AND dark AND playing AND docVisible) drives a
   hard-throttled sample loop that is torn down the instant any term goes false
   (pause, tab hidden, light theme, opt-out, view teardown) - no idle battery
   cost. Same-origin sources only (no canvas taint); a paint error permanently
   disables the loop for that view rather than breaking playback.

ARCHITECTURE: the player host template is parity-locked byte-identical across
nine shells, so the watch-only cog controls are INJECTED at watch init
(ensureCogControlsInjected, id-guarded), never baked into the shared markup -
every player-*-parity test stays green with zero shell duplication. The moved
controls are re-queried post-mount (the v1.181 lesson: pre-mount captured refs
would be null now that they live in the reparented host).

FULL two-reviewer gate, both APPROVE. Round 1 BOTH seats caught a RED integration
suite (two tests bound to the removed page buttons / the old synchronous
theater-btn id) - the recurring v1.79 "unit hook hides an integration failure"
class; I had run test:unit, not full `npm test`. Fixed: re-pointed
watch-fulllist-fetch to the player's track-nav visibility (re-proves the >60
neighbor resolution via the product path, adversarial-confirmed non-vacuous by
mutation) and dropped shell-smoke's redundant theater-btn signal. Adversarial
also caught a real WARNING: the ambient loop's paint-error stop() was undone by
an unconditional reschedule (a hardFailed flag now kills the spin - proven
load-bearing). Tests: +10 (watch-chrome-ambient). Dual-Node 7533/7533 on v22 +
v24. Known gap (tech-debt #170): the hardFailed guard is proven-by-harness but
has no in-suite test (jsdom can't drive a persistent drawImage throw). Device
pass PENDING.

### v1.185.0 - critters: "random sound each tap" preference (fixes v1.184's inert cycle) (Dean) (2026-08-24)

v1.184 shipped INERT and Dean caught it on device ("same behavior even after
pull+rebuild"). Root cause: the SERVER (buildCritterListing) already assigns every
critter a `voice` - its owned same-named file, or a stable hash-borrowed pool
member (the v1.179 "identity, not a soundboard" model) - so the client played
`voice || sound` and the "no sound -> cycle" branch was dead code on any instance
with sound files. The gate (both seats) missed it because tests fed sound=null
fixtures the real server never sends. My miss: didn't verify the client/server
interplay against SOURCE (this repo's own recurring lesson). No user action was
ever needed - it was never Dean's data.

Intake: Dean chose a PREFERENCE (not a hard behavior change) and RANDOM per tap.

- Server: /api/critters now also returns the full `voicePool` - every sound file
  as a URL, deduped + sorted, INCLUDING files no critter's name matches (the
  per-critter `voice` is a lossy hash-assignment). `collectCritterSoundMap`
  extracted as the ONE source for the owned pairing AND the pool (no drift);
  buildCritterListing's array shape is unchanged.
- Client: placements carry the OWNED `sound` (null if no same-named file) and the
  stable `voice` SEPARATELY. Tap: an owned sound ALWAYS plays; else the pref
  decides - ON -> a random pick from the full pool (variety per tap); OFF
  (default) -> the stable borrowed voice (v1.179 preserved). Chirp only when no
  sound files exist at all.
- Settings: a "Random sound each tap" checkbox in the Critters section, default
  OFF (nothing changes until opted in), localStorage `ft-critters:randomsound`,
  pure per-tap (no re-scatter on toggle).

FULL two-reviewer gate, both APPROVE. Briefed specifically on the inert failure
mode: both traced the real server->client flow and confirmed the new branch is
REACHABLE (an un-owned critter's placement carries sound=null), bound by a new
ANTI-INERT test that reddens the v1.184 collapse. Adversarial killed the
reintroduction mutants + the pool-completeness / default-OFF / random-edge
mutants. QA caught a lying comment (the seam still described the removed
round-robin) - fixed comment-only; also the 7522->7523 count slip (read before
the anti-inert test was appended). Tests: critter-mode 77 -> 81. Dual-Node
7523/7523 on both v22 + v24. Device pass PENDING.

Also shipped (rider): a CLAUDE.md stale-tracking-ref hygiene note - `git
ls-remote` is the authoritative remote list (not `git branch -a`), and
`remote.origin.prune true` / `git config --global fetch.prune true` keep a
clone's tracking refs from bloating (root-cause of a "150 stale branches" scare
that was actually stale local mirror refs; origin was clean).

### v1.184.0 - critters: voiceless critters cycle the sound pool (Dean) (2026-08-24)

Dean: a critter with no explicitly-paired voice always played the same synth
chirp - cycling the available sound files gives variety per tap.

- On tap, a voiceless critter (`hit.sound` null) plays the NEXT sound in a
  round-robin over the pool of every available sound file, instead of the chirp.
  The pool is deduped + SORTED (readdir order must not decide the sequence - the
  determinism lesson) and rebuilt once per manifest generation (the same cached-
  promise seam as `warmCritterAssets`), rotation reset on a fresh folder. A
  GLOBAL cycle, so re-tapping the same voiceless critter still varies. An
  explicit per-critter voice always wins (short-circuits the cycle); the synth
  chirp is the last resort ONLY when no sound files exist at all.
- Refactor: the play + record-why logic is now the shared `playCritterSound(url)`
  used by both paths (the v1.179.1 Voice-check instrument still records the
  failure reason inside it).

Slim gate (adversarial): APPROVE, no findings. Nine mutants killed (round-robin,
sort, dedup, voice-over-sound precedence, empty->null, tap short-circuit, both
Voice-check reason strings, the idx reset). It traced the change-folder window
and confirmed the pool always matches the displayed manifest generation (no
cross-folder wrong-sound), and that the `setCritterSoundPoolForTest` seam has no
production caller. Tests: critter-mode 74 -> 77. Dual-Node 7519/7519 on v22 +
v24. Device pass PENDING.

### v1.183.0 - critters: a tap no longer selects the text beneath it (Dean) (2026-08-24)

Dean, desktop: spam-clicking a critter's exposed sliver highlighted the text
under it - the browser's double/triple-click selection gesture. The critter
layer is pointer-events:none (taps are geometrically hit-tested by a document
listener), so the mousedown lands on the content under the peek and starts a
selection there.

- A `mousedown` listener suppresses the selection default (preventDefault) ONLY
  when the down is a REAL critter hit (`critterTapHit`), with the same
  stand-downs as the tap (caret-bearing fields - input/textarea/select/
  contenteditable - and the playback/modal exclusions). preventDefault on
  mousedown stops the selection + mousedown-focus but NOT the click, so the
  chirp still fires and any link under the sliver still navigates on click ("the
  link still wins"). mousedown-only, so touch scroll + long-press-select are
  untouched. The CLICK path is unchanged and still never preventDefaults; the
  "never preventDefault" source-lock is now scoped to the click handler, with
  new locks on the mousedown guard.

Slim gate (adversarial): APPROVE, no CRITICAL/WARNING. It mutation-tested the
four new bindings (all red their guard), behaviorally confirmed the guard fires
only on the exposed sliver (not merely near it, via the critterTapHit coverage),
and confirmed touch is untouched. Two SUGGESTIONs, both non-blocking: a tiny
disclosed edge (native drag-start is suppressed on the small sliver pixels over
a draggable image/link - decorative peeks over background, no primary action
lost); and the handler wiring is source-locked rather than jsdom-dispatched
(matches the existing pattern for this layout-dependent surface; the load-bearing
`critterTapHit` IS behaviorally tested).

Tests: critter-mode 74 (the tap source-lock test gained the mousedown
assertions). Dual-Node 7516/7516 on both v22 + v24. Device pass PENDING.

### v1.182.0 - critters: settle before reveal (no more load-in flash) (Dean) (2026-08-24)

Dean's report (desktop + mobile screenshots): critters "load, sit in odd
spots, then reconcile behind elements" - a critter floating mid-thumbnail,
critters on title text, before they settle. Root cause was structural, not a
tuning bug: the engine placed critters at a fixed +200ms against loading
skeletons / a partial feed and FADED THEM IN there, then a settle ladder +
nudge observer corrected them IN VIEW. Every such correction is watchable, so
the only real cure is to not paint a critter until its position is final. (A
skeleton card reserves a 2-line title; the real card is often 1 line, so the
column shifts up when content lands - that shift unmoored the visible critters.)

Intake: Dean chose "wait, then place once" over v1.175's "instant arrival",
with a ~2.5s cap for slow loads.

- The change is confined to the entry gate `scheduleCritterScatter`; the whole
  gate-won placement/settle/re-glue/nudge pipeline (`scatterCritters` and
  below) is byte-identical, so its invariants and tests stand.
- Mode ON now arms a WAIT phase: a dedicated observer whose every content
  mutation re-arms a 300ms quiet debounce; a leading quiet arm so a static view
  (Settings) reveals promptly; a skeleton-presence gate so the quiet timer
  never reveals against a still-loading feed; and a 2500ms hard cap that
  reveals no matter what. Reveal = one placement, one arrival fade, at the
  settled layout. The pool warms during the wait (no half-decoded-PNG flash).

The gate earned its keep. FULL two-reviewer gate. The QA seat caught a
CRITICAL the adversarial seat's first pass missed: the PREVIOUS view's
persistent nudge observer survived navigation and re-scattered onto the NEW
view's loading skeletons during its wait - the exact flash, on every SPA
navigation after the first (I reproduced it independently before fixing).
FIX: the schedule now disconnects the prior nudge observer on every navigation
(one critter observer ever live). Two WARNINGs fixed same round: the outgoing
view's critters now clear at once instead of lingering at stale coords up to
the cap (this also folded mode-OFF into an immediate inline clear, removing a
dead 200ms timer); and a false "never coexist" comment corrected. QA then
caught a flaky NEW test (a cap probe with a 130ms real-timer margin) - de-raced
to a synchronous pre-cap assertion + 2x margins. Adversarial re-verified all
bindings held after the de-race. Both seats APPROVE.

Tests: critter-mode 66 -> 74 (headline skeleton-defer-then-reveal, static
reveal under cap, cross-navigation CRITICAL regression, outgoing-clear,
functional cap via a test seam). Dual-Node 7516/7516 clean on both v22 + v24.

Known gap (disclosed): the timing tests still assert reveal after real-timer
waits (now 2x+ margins); node:test mock timers are the deterministic cure if
they ever flake in the gate (tech-debt tracker). Device pass PENDING (Dean's
probe list in the wave report).

### v1.181.0 - the settings cleanup: Troubleshooting + Experimental subpages (Dean) (2026-08-23)

Dean's cleanup pass ("the settings have just been sprawl"): centralize
diagnostics and experiments into TWO SEPARATE subpages at the bottom of
the Settings list. Intake rulings: a new Advanced nav group after Account;
visible to EVERYONE (everything moved is per-DEVICE localStorage - admin
gating would add reveal plumbing without protecting anything); the whole
background-audio family moves together; the critter Voice check MOVES,
never duplicated.

- TROUBLESHOOTING (wrench): the lifecycle debug log + the critter Voice
  check - diagnostics that observe and report, never change behavior.
- EXPERIMENTAL (new flask icon): the background-audio family (parent,
  pre-extract, pre-sync, keep-alive, audio-session-declare) + the custom
  mobile player toggle - sharp edges and battery costs stated per-setting,
  copy carried verbatim.
- Automation & Storage slims to scan/cache/transcode/prune + settled QoL;
  the Critters page is purely about the pool again. All moves markup-only:
  every control wired by id (the v1.48 rule), setup.js untouched in the
  main commit.

Slim gate (adversarial): APPROVE in two rounds. It verified the wiring
seam completely (every moved control document-wide id-wired; the reveal
path is a file-wide class selector), proved the copy moved byte-for-byte,
and its three suggestions were taken: the Voice check wiring DECOUPLED
from the critters-toggles guard into its own function with a real jsdom
click bind (the latent silent-death coupling across sections), one legacy
em dash stripped while its block moved, and a count slip in my wave record
corrected (unit suite 5671, not 5669 - the recurring assertion-vs-test
class, caught by the seat this time). Dual-Node 7508/7508 clean first
runs. Device pass PENDING (Dean: the two new rows at the bottom of
Settings, everything findable in its new home, every moved toggle still
working).

### v1.180.0 - color-faithful art + the screen-edge invariant (Dean) (2026-08-23)

Two Dean reports and one self-find, one wave. (Aside for the record: the
v1.179.1 boop investigation RESOLVED as not-a-bug - Dean's uploaded MP3s
literally contained boop sounds; the pipeline played them faithfully
throughout. The Voice check stays as a permanent diagnostic, and the
diagnosis norm gains an arm: when every link measures correct, verify
the OBSERVATION is a malfunction at all.)

- COLOR-FAITHFUL (Dean: "no gradient or color applied, right?"): the
  per-placement hue-rotate(0-360) existed to vary the five builtin
  line-art figurines but sat on the shared pose wrapper - silently
  recoloring uploaded art on every placement. His ruling: builtins only.
  Uploads now render exactly as the files are; the 95% opacity softness
  stays (deliberate).
- SCREEN-EDGE INVARIANT (his amputated pink-dress screenshot): the
  v1.169 amputation class through two side doors - horizontal overflow
  inflates scrollWidth so a visually-full-bleed card kept side peeks, and
  the old W2 trade allowed negative-x peeks to clip off-page. Now a
  critter may never CROSS the viewport's left or right edge: the planner
  skips crossings, full-bleed measures against min(scrollWidth,
  innerWidth), and the re-glue/adoption path drops off-screen slides.
- SELF-FIND: armCritterSettleCheck overwrote its stashed timer without
  cancelling (the v1.166.4 class inside the arm; masked on the
  timer/nudge paths, orphaned on direct re-glue). The arm now cancels
  first.

Slim gate (adversarial): APPROVE in two rounds. Its WARNING: my SECOND
subsumption derivation measured wrong - the screen-edge drop subsumes the
hidden-anchor guard only for the ORIGIN collapse; a width:0-AT-POSITION
collapse keeps its coordinates (15/29 positions survive) and only the
guard catches it. Re-bound at the seat's exact geometry; the false
comment corrected in place. New standing lesson: NEVER claim a guard is
subsumed from one failure geometry - enumerate the geometries or bind
the guard directly. Process disclosures in the commits: the dirty-tree
blind-checkout scar struck a THIRD time (recovered; commit-before-mutant
is now absolute), one phantom commit caught by git log, and one
PATH-clobbered shell made two mutant runs no-ops (caught via
git diff --stat before crediting). Dual-Node 7505/7505 clean first runs.
Device pass PENDING (Dean: uploaded critters keep their true colors
everywhere; no critter ever cut off at the screen's left or right edge).

### v1.179.1 - the Voice check instrument (device boops with voices assigned) (Dean) (2026-08-23)

Dean's device: every tap boops although /api/critters provably assigns
voices (his own paste) and the shipped client chain provably carries them
(his exact manifest run through sanitize + planner emits voiced
placements). Fresh Safari boops too - the stale-client theory REFUTED by
his measurement. His history narrows it: the previous NAMED sounds played
through this same pipeline; boops began after a delete-all + re-upload of
a new sound pack. Leading hypothesis: the pack's files pass the
first-bytes magic sniff but do not DECODE on iOS - and the chirp fallback
was silently eating the real error.

Instrument, not a theory-fix (the v1.161 discipline):
- The tap fallback now records WHY it chirped (rejected play + error name
  + URL / constructor threw / no voice on the placement).
- Settings -> Critters gains a "Voice check": runs the REAL manifest path
  and a REAL playback attempt, reporting totals, voiced counts (0 = a
  stale client), the builtins-fallback tell, a cold-manifest annotation
  (an iOS tap-window artifact can fake NotAllowedError - the report says
  so and hints tap-again), and the playback outcome with the exact error
  name: NotSupportedError = codec, NotAllowedError = policy, mediaError
  code = load, 8s timeout = stalled.

Slim gate (adversarial): APPROVE in two rounds (its two suggestions - the
cold-manifest tell and a mixed fixture binding the stale-client filter -
applied and mutation-confirmed). Dual-Node 7503/7503 clean first runs.
Dean's next tap of Voice check names the broken link.

### v1.179.0 - the voice pool: every critter gets a real sound (Dean) (2026-08-23)

Dean: "if a given character doesn't have an MP3 with the corresponding
name, I still want them to get a sound that is not our boop chime...
if I do arbitrarily decide to keep at least one name the same, it'll use
that file explicitly."

- The listing now carries `sound` (the OWNED exact-basename pairing,
  unchanged - the manager's note badge keeps meaning "has its own sound")
  and `voice` (the effective tap sound: owned first, else a DETERMINISTIC
  borrow - a stable hash of the critter's id picks from the folder's
  sorted sound pool, so a nameless-match critter keeps the SAME borrowed
  voice everywhere, every session). The synth chirp survives only when
  the folder has no sounds; builtins keep it. Orphan sounds stop being
  invisible waiters - they ARE the pool (copy updated in the manager and
  the folder README).

Slim gate (adversarial): APPROVE in two rounds. My own pre-gate mutant
sweep caught the SPREAD being unbound (a constant hash - everyone
sharing one voice - passed the first tests; closed before the gate,
disclosed in-commit along with a corrected assertion-vs-test-count
slip). The seat's WARNING: dual-extension same-basename sounds
(rex.mp3 + rex.wav) made both the owned pairing and the pool
order-DEPENDENT on filesystem readdir order - its one-line fix (sorted
iteration, lexicographic last-wins) applied with its repro as a
permanent fixture; the owned-pairing half was pre-existing v1.166
behavior, fixed now that determinism depends on it. Its suggestion
(a /critters/ prefix check in the manifest sanitizer) recorded as
future defense-in-depth, no new exposure. Dual-Node 7501/7501 clean
first runs. Device pass PENDING (Dean: tap critters that have no
matching MP3 - each should now speak with a consistent borrowed voice,
not the boop; exact-name pairs unchanged).

### v1.178.0 - anchor adoption: a rebuilt view keeps its critters (the flash dies) (Dean) (2026-08-23)

Dean's residual after v1.176: critters still "flash and find a second
position after the first time." Diagnosis verified in the view code:
views rebuild content wholesale on data arrival (the related rail renders
skeleton cards via innerHTML, then REPLACES them with real cards; same
pattern on the feed and comments). The anchor ELEMENT a critter chose is
replaced by an identical twin - v1.176's re-glue saw a disconnected
element, dropped the orphan, and the empty settle check full-scattered to
fresh random spots.

- ADOPTION: the collector records which pool selector matched each
  anchor; when re-glue meets a disconnected anchor it re-finds the
  replacement twin (same selector, same size class 0.5x-2x, nearest to
  the old rect within 240px, never fixed chrome, never an element another
  placement owns) and the critter re-attaches at its same edge and pose,
  riding the twin's delta. No twin: the quiet drop stands. The money
  test: an innerHTML rebuild leaves every critter at the byte-identical
  position.

Slim gate (adversarial): APPROVE in two rounds. Its WARNING was our
recurring vacuous-claim class: a test TITLED "never double-adopted" never
constructed a double-adopt attempt, and the guard it named is
load-bearing (two orphans in range of one twin would visibly STACK two
critters on one anchor without it). Closed with the seat's own repro
shapes: one-adoption-only and the claimed-seed (an orphan cannot poach a
survivor's anchor - the survivor's position asserted byte-exact). My own
pre-commit mutant sweep also caught the size-gate fixture being
distance-subsumed (survivor-geometry lesson re-applied on the spot).
Disclosed residuals -> tech-debt #168: three cosmetic refusal guards
mutation-unbound (ship-safe per the seat), and the 240px adoption radius
is a constant heuristic an extreme whole-page reflow could exceed.
Dual-Node 7500/7500 clean first runs. Device pass PENDING (Dean: the
watch/audio pages that flashed - critters should now hold their exact
spot through the content load).

### v1.177.0 - the rounded shave: cuts follow the anchor's painted corners (Dean) (2026-08-23)

Dean's Modern-2021 screenshots: square critter shoulders poking past the
ROUNDED corners of buttons and podcast art tiles - "everything being clean
proper border, edge being shaved to the actual button." The v1.170 circle
fix generalized to arbitrary border-radius:

- The collector harvests all four computed corner radii per anchor (px and
  percent spellings, clamped; era-automatic - 2005's square corners keep
  the plain clip, 2021's tokens shave).
- The renderer's ladder: true circles keep the proven radial mask; any
  corner radius over 2px gets a NEW SVG data-URI mask (an opaque wrapper
  square with the ROUNDED hole punched out via fill-rule evenodd) riding
  the same --critter-mask plumbing; square anchors keep the cheaper rect
  clip. A hole corner rounds ONLY at true anchor corners - a side extended
  to the wrapper edge stays straight, because the anchor's real corner
  lies outside.
- Shared geometry: the clip and the shave both derive from one extracted
  hidden-rect truth (the v1.174 exact-string locks rode through the
  refactor unchanged).

Slim gate (adversarial): APPROVE in two rounds. It independently
hand-derived every fixture and all four arc orientations from first
principles, proved data-URI injection impossible (all-numeric inputs),
and proved the percent-radius min-dimension approximation SAFE on real
pill buttons (over-hides only, never the poking bug - 11k+ sample points;
disclosed as a possible future x/y-radii refinement). Its WARNING was the
ORIENTATION CLASS striking a FOURTH time - the tr/br arc emits were
mutation-unbound - closed with two fixtures derived independently twice
(the seat's strings and mine matched byte-for-byte before commit); all
four orientations now exact-bound and every previously-surviving mutant
reds. Disclosed residuals: re-glue reuses placement-time radii (stale
radii clamp to the new hole - over-hide only, cosmetic on a bounded
path); percent radii approximate per-axis ellipse corners with the
conservative min dimension. Dual-Node 7498/7498 clean first runs. Device
pass PENDING (Dean: Modern 2021 - critters behind buttons/art tiles
should shave cleanly along the rounded edge, nothing poking past).

### v1.176.0 - drift corrections RE-GLUE (never re-roll) + three new tap reactions (Dean) (2026-08-23)

Dean's watch/audio report: critters appeared, then SHIFTED to brand-new
positions in under a second. Not a new bug - the v1.173 drift correction
always re-SCATTERED (fresh random spots), and v1.175's instant arrival made
that correction visible for the first time (playback UI genuinely churns
nodes; watch pages keep settling). The correction was right; the re-roll
was the jank.

- RE-GLUE: placements carry their live anchor ELEMENT; a drift correction
  re-measures each critter's own anchor and translates the critter by
  exactly the anchor's movement - same critter, same edge, same pose, no
  fade replay (a re-glue rebuild renders STILL). The common case - content
  loading BELOW the critters - now changes nothing at all. A critter whose
  anchor left the page, hid, or slid into an exclusion/past bounds is
  DROPPED, never re-homed. Same bounded 2-check budget; the content nudge
  maps identically (empty scatters, drift re-glues).
- REACTIONS (Dean: "I like that to be varied"): critter-twirl (a full
  spin), critter-duck (a shy dip), critter-squish (squash-and-stretch)
  join wiggle/shiver/hop - all transform-only, angle+flip carried in every
  frame, all in the reduced-motion arm.

Slim gate (adversarial): APPROVE across three rounds, and this one earned
its keep twice: the seat proved my "the overlap predicate subsumes the
hidden-anchor drop" claim FALSE by measurement (42/289 placements would
survive a collapsing anchor as stray near-origin critters - the drop is
LOAD-BEARING, and the record was corrected), and my first attempt at
binding it was itself too loose (any left/top peek) - the mutant died only
after deriving the exact survivor geometry (a tl-corner peek straddling
the anchor's origin). All six re-glue safety drops verified; exclusion,
bounds, and hidden drops now mutation-bound. Dual-Node 7494/7494 clean
first runs. Device pass PENDING (Dean: watch/audio pages - critters may
settle once WITH their buttons but never jump to new spots; tap around
for the three new reactions).

### v1.175.0 - critters arrive with the page (content nudge + pre-decode + fade) (Dean) (2026-08-23)

Dean: "prevent FOUC/load-in of them after other elements for a given page."
The physics stays honest - critters cannot render BEFORE their furniture
(the anchors ARE the content) - but every late-arrival source is closed:

- CONTENT NUDGE: a MutationObserver fast-forwards the settle ladder the
  moment new page content lands, so critters appear in the same beat as
  the cards instead of at the +1.5s fallback (the timers remain as the
  safety net). The nudge spends the ladder's own bounded budget (the seat
  built a formal control-flow model over adversarial interleavings and
  proved the cap holds at initial + 2 re-scatters per navigation), cancels
  stale handles, filters its own layer's churn, and exists only while the
  mode is on.
- IMAGE PRE-DECODE: the whole pool downloads and decodes once per manifest
  generation (structurally - the warm rides the cached manifest promise),
  so a critter's first paint never streams in.
- ARRIVAL FADE: every (re)appearance fades in over --dur-slow, pure
  opacity - no motion, no reduced-motion arm needed - which also softens
  the settle re-tuck on pages that reflow while loading.

Slim gate (adversarial): APPROVE in two rounds - it initially suspected a
budget-cap violation, modeled the control flow, proved the cap, and
RETRACTED the suspicion per its own discipline; its two suggestions
(navigation also cancels the nudge debounce; a porous source lock
anchored) were applied and delta-confirmed, and it disclosed its own
first-occurrence perl mutation slip, caught and redone. Hygiene fix along
the way: toggling the mode off now cancels the pending settle timer.
Disclosed residual (seat's ruling, not worth a round): the duplicate
debounce-cancel inside unwireCritterContentNudge is not independently
bound - its absence would leave a harmless no-op handle on the disable
path. Dual-Node 7492/7492 clean first runs. Device pass PENDING (Dean:
navigate around - critters should land with the content, images crisp on
first paint, arrivals fading in rather than popping).

### v1.174.0 - Critters: the clip becomes geometric truth (the floating-cut class dies) + the final name (Dean) (2026-08-23)

Dean's "one last swing": his Subscribed-button screenshot showed a critter
fragment with a hard cut floating OFF the button - the #167c over-clip
residual class, closed now instead of disclosed.

- THE CLIP IS GEOMETRIC TRUTH: buildCritterClip no longer hides the
  planner's CLAIMED cover bands (size-derived, never clamped to the
  anchor's real extent - a critter overlapping past the anchor's far edge,
  which the v1.170 cross-fit deliberately allows, got sliced where nothing
  hides it). The hidden region is now the MEASURED intersection of the
  critter box and its anchor; the complement polygon follows from topology
  (inset / corner L / C-notch / band). THE CLASS INVARIANT - every cut line
  lies ON an anchor edge - is bound by a 900-seed sweep; the seat's
  independent winding oracle proved 1306 floating cuts under the OLD clip
  became 0 under the new one on a Subscribed-style button.
- THE NAME IS JUST "CRITTERS" (Dean, twice-confirmed): no "sneaky", no
  "companions" - the v1.173 rename lasted one release; the name now matches
  every id, key, and route, so the vocabulary split is gone in the
  zero-risk direction. The generic spirit stays in the copy.

Slim gate (adversarial): APPROVE in two rounds. Round 1's WARNING was the
v1.168 orientation class RE-STRUCK: only one of four C-notch orientations
was exact-bound (in a branch today's planner cannot even reach - the seat
measured 0 notch topologies over 92k placements), and it caught my
mutation RECORD being imprecise about which test kills which mutant - both
corrected in the fix commit, all four orientations now bound and the
seat's surviving mutants re-run dead. Its oracle independently hand-derived
every topology fixture. Dual-Node 7488/7488 clean first runs. Device pass
PENDING (Dean: the Subscribed-button spot on a few watch pages - every cut
should hug a button edge).

### v1.173.0 - Sneaky companions: the settle ladder, the generic rename, and the em-dash rule (Dean) (2026-08-23)

Three follow-ups from Dean's device pass, one wave:

- SETTLE LADDER (his "Dreams of a Life" screenshot: critters floating over
  the watch page's title/views/channel-name text, unmoored 50-60px from
  their buttons). Root cause verified against the markup and skeleton CSS,
  not theorized: placements measured against LOADING skeletons (.skel-title
  is a fixed 26px; a real title is ~31px per line; the uploader panel fills
  async) go stale when real content reflows - his two "good" screenshots
  had settled before placement, the "bad" one had not. The v1.166.4
  empty-retry ladder generalized: every scatter arms the bounded +1.5s/+4s
  checks, whose fire-time decision is the pure critterSettleAction (empty /
  drift past 24px / stand-down) on LIVE placements + LIVE height.
  Never-move-mid-view holds: bounded, stashed handle, settled pages stand
  down. The gate's post-render-baseline hardening closes the wrappers'
  own-pad phantom-drift edge.
- COMPANIONS (Dean: "really this is for Companions... genericization is
  better for a product perspective"): user-facing verbiage only, per his
  scope ruling - "Sneaky companions" section/toggle, "Companion pool",
  README ("critters, characters, anything with a transparent background").
  Identifiers, /api/critters routes, and localStorage keys stay
  critter-named: saved settings survive, censuses do not churn.
- EM DASHES (Dean: "I don't want em dashes like anywhere"): the feature
  copy's &mdash; entities replaced with spaced hyphens, and the rule is now
  CODIFIED as MANDATORY in docs/CONTRIBUTING.md (entities count; legacy
  untouched text may stay until edited), bound by a test that also nets the
  hex-entity spelling.

Slim gate (adversarial): APPROVE in two rounds - it REFUTED my own named
CRITICAL-candidate by arithmetic (the pad-overflow edge is a rare,
self-correcting single re-roll, not the every-page double I feared),
downgraded it to the hardening above, and mutation-confirmed every new
bind. Disclosed residual (seat's ruling): the post-render stash ORDER is
comment-bound only - an order regression would ship green; judged
proportionate for a cosmetic hardening. Dual-Node 7487/7487 clean first
runs. Device pass PENDING (Dean: the Dreams of a Life watch page after a
fresh load - companions should hug their buttons once the page settles).

### v1.172.0 - each Settings subpage gets its own critters (md pane re-scatter) (Dean) (2026-08-23)

Dean's two Settings screenshots: the SAME critters floated over BOTH the
menu and an open section, anchored to the other pane's furniture. The
master-detail is one route - drilling in or tapping Back is a pane swap the
router never sees, so the stale scatter survived. Dean: "critter mode should
likely consider each subpage different."

- The two md transition points (selectKey - mobile drill-in AND desktop
  section switching - and the Back handler) now call the shared 200ms
  scatter scheduler; hidden panes measure zero-size, so each re-plan sees
  only the visible pane. The hook lives in the SHARED md machinery, so
  Stats and future master-detail pages inherit it.
- Wiring alone never scatters (init stays the router hook's); bound by a
  no-fire-at-init assertion plus two end-to-end behavioral binds (a seeded
  layer disappears after drill-in and after Back). Both hook-deletion
  mutants red.

Slim gate (adversarial): APPROVE, ZERO findings - it measured all five
named risks shut (no init scatter storm incl. the async admin-reveal
rebuild; one scatter per rapid burst; the disabled path never fetches the
manifest; the test observable is hook-exclusive; the v1.164 scroll-restore
order preserved). Dual-Node 7485/7485 clean first runs. Process disclosure:
the blind-checkout scar was struck TWICE this day while mutation-testing
dirty trees (both recovered, both disclosed in commits); the norm is
re-sharpened - commit first, mutate the commit. Device pass PENDING.

### v1.171.0 - the critter manager: pool management from the browser (Dean) (2026-08-23)

Dean's follow-up to the critter arc: "allow one to upload images to the pool
and upload sounds... show little icons... download all or delete all or
delete individuals. Managing this via web UI would really just be excellent."
Intake rulings: admin-only management, PERMANENT two-tap deletes, own
Settings section. Exec plan: completed/2026-08-23-critter-manager.md.

- "Sneaky critters" is its own Settings section (paw icon; a sub-page on
  mobile via the master-detail). The mode toggle + density moved there from
  Appearance, ids and wiring unchanged.
- Admin-only manager: pool grid (thumbnail, name, tap-sound note), image and
  sound uploads (the logo route's raw-body posture - mime allowlist AND
  magic bytes, tmp+rename, 25/10 MB caps; SVG deliberately not uploadable -
  a stored-XSS vector; folder drop-ins still accept it, disclosed), per-item
  and delete-all two-tap deletes, and Download all as a real zip from a
  dependency-free store-only zip writer (zlib.crc32 - no new server deps).
- The folder stays the manifest (v1.166): the web UI is a writer to
  public/critters/, so hand-drops and web uploads coexist; every mutation
  busts the manifest cache and re-scatters live critters.
- Destructive-surface hardening: unlink targets resolve ONLY from the real
  directory listing (README.md, subfolders, symlinks and their targets are
  structurally unreachable - proven behaviorally by a live-server suite
  seeded with a symlink pointing outside the folder); 4 new routes admin-
  gated on both classification axes; rbac route pin 207 -> 211.

FULL gate (destructive wave, per the standing norm). Round 1: QA REQUEST
CHANGES - its best catch was the presence-not-binding class AGAIN: the
magic-byte test only proved validators EXIST; a wrong-offset signature
would have shipped green and refused every real upload. Closed by calling
every validator with genuine and lying bytes, mutation-verified. QA also
caught the spec/implementation disagreeing on the section's menu group
(resolved by amending the spec). Adversarial APPROVE round 1 after failing
to destroy data live (member 403s, traversal 404s, symlink target
survived); its zip-local-header and behavioral-symlink suggestions were
taken. Both seats APPROVE on delta. Dual-Node 7483/7483 clean first runs
(one QA run honestly observed 7480+3 environment-conditional skips).
Device pass PENDING (Dean: phone upload, thumbnails, per-item delete,
delete-all count, the zip opening, folder drop-in still working).

### v1.170.0 - critter peek-fit polish: cross-axis fit, head-down bottom peeks, circular avatar masks (Dean) (2026-08-23)

Dean's v1.169 device pass surfaced three geometry gaps, all one family: the
sandwich clip treats every anchor as a rectangle the critter fits behind, and
that broke at the edges (his three screenshots: a critter towering over a 44px
action button as a notched cut-out; dangling FEET below elements; a straight
hard cut through a critter behind a circular channel avatar).

- CROSS-AXIS FIT: the planner caps a critter's ROTATED extent perpendicular to
  its peek at 1.15x the anchor's extent there - shrink the critter first, and
  at the 26px floor flatten the TILT instead (a 24px avatar hosts a
  near-upright critter its own size, max ~3 degrees of lean). Bound by
  300-seed sweeps plus the seat's independent 30000-placement mulberry32 sweep
  with ZERO violations and no rounding slack.
- BOTTOM-FAMILY FLIP (Dean's own suggested fix): any bottom edge/corner peek
  rotates the pose 180 degrees so the HEAD pops out below the ledge - hanging
  upside-down reads sneaky, dangling feet read severed. Bound as an
  iff-invariant (cover-from-above <=> head-down) with BOTH-base counters.
- ROUND ANCHORS: the collector marks TRUE circles (square box, radius >= half;
  pills and 25%-radius squares excluded; fails OPEN to the rect clip), and the
  renderer swaps the rect clip for a radial-gradient mask via --critter-mask +
  .critter-round (both -webkit- and standard spellings) - the cut now follows
  the avatar's curve instead of slicing through the critter.

Slim gate (adversarial): APPROVE in two rounds. Round 1 ran a 15-mutant
campaign (14 killed) and caught the ONE survivor - the sub-50% arm of circle
detection was unbound (dead code today, a misclassification trap tomorrow);
the fix round closed it mutation-verified. Honest residual, judged
non-blocking: threshold drift strictly inside (25%, 50%) is test-indistinct
by stub granularity - both semantic classes bound, no live input exists.
Dual-Node 7463/7463 clean first runs on v22.23.1 + v24.14.0. Device pass
PENDING (Dean: fit feel on small buttons, upside-down bottom peeks, curved
avatar cuts).

### v1.169.0 - the mobile feed gets integrated critters (full-bleed rule + card anchors) (Dean) (2026-08-23)

Dean's v1.168 device pass ("incredibly impressed... very very very happy") found
ONE remaining jank, on his main view: the mobile YouTube-style feed's cards are
FULL-BLEED, so side/corner peeks landed on the screen edge - amputated critters
hanging half off the viewport (his screenshots: a kitten cut at the left edge, a
bear guillotined top-left).

- FULL-BLEED RULE (view-agnostic, no special-casing): an anchor spanning >=85%
  of the document width peeks only TOP or BOTTOM - emerging between the artwork
  and the title, never off the side of the phone. Bound by a 300-seed sweep
  (zero horizontal protrusion; BOTH vertical directions asserted - the gate's
  surviving top-only mutant killed by its own 3-line prescription; narrow
  anchors keep the full 8-position pool, rate-asserted). The seat measured the
  threshold razor-sharp (0.8475 -> 200/300 side peeks; 0.8525 -> 0/300) and
  closed the desktop question by arithmetic (a content-column element reaches
  0.85 of docW only at ~2240px+, where a side peek is negligible anyway); the
  rule also quietly fixes sub-row/setup-box edge amputations on phones.
- CARD ANCHORS: `.thumbnail-container` (letterbox black - critters rise from
  behind the artwork onto the title zone) and `.card-channel-avatar` (the 24px
  byline circle - a MICRO-ambush; anchor minimum lowered 48x32 -> 24x24,
  pool-curated; the avatar gains a --thumbnail-bg disc so the ground contract
  holds while the image loads).

SLIM gate APPROVE (6 mutants: 5 killed + the top-only survivor closed by S1).
DISCLOSED (tech-debt #167c): ~6% of 24px-anchor placements over-clip past the
tiny disc's far edge (measured 30/500, <=12px strips; the cap-at-overlap
alternative would paint critter feet OVER byline text - Dean's device-pass
trade); icon-only .btn micro-anchors now qualify (in-spirit; revisit on device
feel). DUAL-NODE PENDING at time of writing.

DEVICE (Dean): the mobile feed - critters emerge from behind thumbnails onto
titles and peer down from card tops; NO more screen-edge amputations; find a
micro-critter behind a channel avatar; judge the tiny-anchor clip feel (#167c).

### v1.168.0 - go harder: corners, depth, tilt, mirrors + the SANDWICH (Dean) (2026-08-23)

Dean's two on-device beats. Beat 1 ("not really going as hard as we could"):
corner peeks join the four edges (diagonal ambushes), peek depth randomizes per
placement (30-65% exposed, was a fixed 45%), tilt widens to +-38deg, and half
the critters MIRROR (scaleX flip - two poses per PNG). Beat 2 (his
subscribe-button kitten screenshot): the peek popped over its button but was
SWALLOWED by the neighbouring hairline divider and channel box - z:-1 sat below
EVERY painted element, not just the anchor. His refined rule, now the
architecture: **a critter is behind exactly its ONE anchor and ABOVE everything
else it touches.**

THE SANDWICH: the layer paints ABOVE the in-flow furniture (z 2 - under
popovers/sticky titles/chrome/every ladder rung; the player stays excluded by
geometry), and the anchor-hidden region is CLIPPED per-critter: an axis-aligned
wrapper (inflated 30% so rotated poses never crop) carries a clip-path from the
pure buildCritterClip - edge cuts are insets landing exactly on the anchor's
edge; corner cuts hide only the shared quadrant (6-point L) - while the POSE
inside carries rotation/flip/hue, so a tilted critter still gets a straight cut
hugging its element. Reactions animate the pose (animating the wrapper would
swing the cut). The ground contract stays as belt (hiding is geometric now).

SLIM gate: REQUEST CHANGES - four surviving mutants (3 of 4 corner orientations
untested + the pose-targeting unbound; the committed GEOMETRY was correct - the
seat hand-derived every orientation first). Its 4-line closure adopted verbatim
(exact corner strings derived independently of the implementation); delta
APPROVE with each survivor red individually. The z:2 sweep found no utility
inversion; the one by-design judgment - a 0.95-opacity sliver may sit on a
NEIGHBOURING card's corner text (clicks always protected) - is flagged for
Dean's device pass. Tap-geometry asymmetries tracked (#167c).

DUAL-NODE: PENDING at time of writing.

DEVICE (Dean): the kitten (and friends) now pop over hairlines/boxes and duck
behind ONLY their own element; corner ambushes + shy-to-bold peek depths +
mirrored poses everywhere; menus/popovers still paint over critters; judge the
neighbour-overlap feel (the one call only you can make).

### v1.167.0 - critters everywhere, popping out from behind buttons (Dean) (2026-08-22)

Dean's refined intent after living with v1.166.x: less wallpaper, more AMBUSH -
critters cartoonishly popping out from behind SPECIFIC small elements (a
subscribe button, a comment), and "every page fair game". Exec plan (completed):
2026-08-22-critter-everywhere-button-peek.md, with the MACHINE-DERIVED
accept/reject table.

- Anchor pool += the per-view sweep, every entry checker-verified to paint an
  opaque token: `.btn` (buttons - PRIORITY weight 3), `.sub-row`,
  `.history-thumb`, `.book-row-cover`, `.music-artist-mosaic`,
  `.podcast-card-art`, `.comment-input-box`. Rejected as TRANSPARENT: the
  music/podcast cards (their art tiles anchor instead), history/song/stable
  rows, comment-item. The ground-contract lock TIGHTENED (transparent/none no
  longer counts as paint - the v1.166.3 gate's disclosed nit became
  load-bearing on literally `.music-artist-card { background: transparent }`).
- WEIGHTED without-replacement sampling (Efraimidis-Spirakis) - buttons win
  more of the draw, nothing starves; bound by a 600-seed statistical sweep the
  seat independently re-derived with a second RNG (~25% observed = theory).
- SCALE-TO-ANCHOR: behind small elements the critter shrinks to ~1.1-1.5x the
  anchor's height (floor 26px); big furniture keeps 44-88px.
- FIXED-SUBTREE guard: header/sidebar/bottom-nav buttons never anchor (their
  viewport-anchored rects would detach from document-anchored critters on
  scroll); fails CLOSED on unreadable styles.

SLIM gate: REQUEST CHANGES round 1 - the recurring presence-not-binding class,
TWICE: the fixed-guard CALLSITE and the weight TAGGING were each deletable with
the suite green (helper and pure planner were bound; their wiring was not). The
seat pre-verified a single collector-level test that kills both; adopted
verbatim; delta APPROVE. One disclosed surviving mutant: the fail-closed catch
polarity in critterInsideFixed is unreachable-paranoia (the #166 precedent).
Residuals -> tech-debt #167 (inner-scroller detach - a blanket overflow-skip
would delete the books shelf's WANTED anchors; lock porosity spellings).

DUAL-NODE (disclosed): v22 7454/7454 clean; v24 run 1 was 7453/7454 with ONE
failure whose name the count-only capture missed - the re-run was CLEAN (zero
not-ok lines across the full suite), consistent with the TRACKED flaky classes
(#142 you-nav / #156 books-tts load), not the new critter tests (which are
seed-deterministic). Reported as measured.

DEVICE (Dean): every view now hosts critters - subscriptions, history, books,
music, podcasts included; small critters pop out from behind action buttons
(scaled to the button); big boxes still host full-size ones; nothing anchors to
the fixed header/nav; tap chirps unchanged. More folder images still = fuller
Obscene.

### v1.166.4 - critters reach the watch page: the empty-scatter retry ladder (Dean device report) (2026-08-22)

Dean (on-device): critters everywhere EXCEPT watch pages, and Obscene not
obscene. The density half is by-design (count caps at DISTINCT critters in the
folder - he has 5; 16+ images opens the full tier; documented in the folder
README). The watch half was real: watch's anchors are ALL fetch-then-render
(loadRelatedFiles - which seeds the related-rail skeletons - runs as step 5
INSIDE the /api/videos/:id callback, and the description fills there too), so
the one-shot scatter at +200ms measured ZERO anchors on a VPN'd phone and
nothing ever retried. Two hypotheses were falsified first (watch IS a routed
view with #view-root; #fs-stage is display:none idle) - diagnosis from the
traced mechanism, not a guess.

Fix: an EMPTY scatter earns a bounded retry ladder (+1.5s, then +4s, then
stops); non-empty never retries. The gate then DEMONSTRATED a race in round 1
(a stale pending retry from a previous view fired after a new view placed
critters and re-rolled them mid-view - violating the never-move-mid-view
ruling; the shipped comment claiming "by construction" was a lying comment) and
prescribed the verified 3-line fix, applied verbatim: the retry handle is
STASHED and cancelled on every navigation, and the callback re-checks emptiness
at FIRE time. Delta APPROVE: the seat re-ran its own repro (no mid-view move),
re-verified the target scenario still works (late anchors -> 5 placed at
+1.5s), 8/8 mutants killed (all three belts bind independently), no-loop traced.

Disclosed residuals: a watch page with NO description and NO related files ends
critter-less after the ladder (nothing to hide behind); the retry binds are
source locks + the seat's out-of-band behavioural repro (jsdom needs
scrollWidth stubs for any in-suite behavioural version). Dual-Node PENDING at
time of writing.

DEVICE (Dean): open a video -> within ~2s of the page settling, critters peek
from behind the description box and related thumbnails; navigate quickly
between videos -> placed critters never jump. And to make Obscene obscene: add
more PNGs to the folder (16+ distinct images = the full 16).

### v1.166.3 - the critter folder works under Docker (the volume mount) (2026-08-22)

Dean's clerical agent dropped 5 PNGs into ~/filetube/public/critters/ on his
server and found no folder, no README, no reading code - his checkout predated
v1.166.x, AND it exposed a real deployment gap: the image BAKES public/ in and
compose mounted only data + media, so on ANY Docker deployment host-side critter
drops never reached the container. The folder-is-the-manifest contract held only
for git-checkout runs.

- docker-compose.yml now binds `./public/critters:/app/public/critters` (active,
  the ./data posture). The seat verified BOTH ends resolve inside the mount (the
  API readdir at /app/public/critters AND express.static's /critters/* byte
  serve), the bind shadows the baked README with the identical tracked one, and
  CI/scripts are untouched (the publish smoke uses plain docker run; compose is
  dockerignored, so the image is byte-identical).
- Gate S1: a LOCKSTEP unit test pairs the compose bind with server.js's folder
  path - nothing else binds the compose file, so moving the folder now forces a
  human to move both ends. S2: README notes the root-owned auto-created dir for
  compose-without-checkout users, and the plain-docker-run -v requirement.

SLIM gate APPROVE. Dual-Node PENDING at time of writing.

DEVICE (Dean): on cutecontainer - git pull in ~/filetube (the 5 PNGs are
untracked and survive), pull the v1.166.3 image, recreate with the updated
compose -> Pearl/Milo/Hazel/Maple/Biscuit replace the built-in figurines on the
next refresh.

### v1.166.2 - critters on the watch page (Dean device report) (2026-08-22)

Dean's device pass: the watch page had zero critters - it uses none of the four
original anchor selectors. Added two watch anchors: `.description-container`
(paints --bg-sidebar) and `.related-thumb` (paints letterbox black). NOT
`.related-card` - a transparent flex row: a NEW ground-contract test lock (every
anchor's base rule must PAINT a background) caught exactly that mid-wave when
the card was tried first, and it also documents why the comments section stays
un-anchored. Peeks toward the adjacent player are already skipped by the
placement-rect exclusion check.

SLIM gate APPROVE, 5/5 mutants killed (incl. re-adding the transparent card ->
red). Disclosed nits (no action): the paint lock accepts a `background: none`
spelling (no anchor uses one) and checks base rules only (a skin-level
transparent override at higher specificity would evade it - static-cascade
limit). Dual-Node PENDING at time of writing.

DEVICE (Dean): open any video's watch page with critter mode on - critters peek
from behind the description box and the related-video thumbnails; never over
the player itself.

### v1.166.1 - critters actually visible: the paint-ground fix (Dean device report) (2026-08-22)

Dean's device pass on v1.166.0: ZERO critters visible, any density, mobile AND
desktop (mobile was always in scope - nothing gated it; the bug hid them
everywhere equally). Root cause: #critter-layer lived on <body>, so its
z-index:-1 children resolved against the ROOT stacking context and painted BELOW
`.main-content`'s background - the exact jsdom-unverifiable stacking surface the
exec plan disclosed as "Dean's device pass", and it fired.

A THREE-round fix arc, each round a real adversarial catch:
- Round 1 (isolation: isolate on .main-content): CRITICAL C1 - it trapped the
  IN-SLOT player overlays (audio-expanded z1100, faux-fullscreen z1500) under
  the fixed chrome for EVERY user, critters on or off.
- Round 2 (per-mode escape arms): CRITICAL C2 - three MORE static in-view
  overlay families (podcasts sheets, subscriptions panels, reloc preview) were
  trapped the same way; per-mode arms = hand-enumerating the one-of-N class.
- Round 3 (STRUCTURAL, the seat's own prescription, taken): .main-content's
  background was REDUNDANT (body paints the identical var(--bg-color) canvas
  token in every era/skin; .app-container paints nothing - an earlier
  "two stacked wrappers" claim was a misread grep). DELETED it + the isolation +
  both arms. The critter plane now sits between the canvas and the furniture by
  plain root-context paint order - no stacking context anywhere, the entire
  trap class structurally dead. The seat verified the WHOLE branch-vs-main CSS
  behaviour delta is that single deleted declaration, and bound every regression
  arm (re-add background / re-add isolation / re-add an arm / drop body's canvas
  token / reparent to body - 5/5 mutants red). APPROVE at round 4 (the pacing
  norm's closure round).

Also: TWO more original figurines (fox, chick) -> FIVE built-ins, so densities
feel populated until Dean's art lands (his sample ask, answered with originals -
trademarked character art stays un-committed, disclosed again).

HONEST LIMIT (unchanged): jsdom renders nothing - the mechanism is verified at
the source (nothing painted between canvas and furniture remains), but critters
APPEARING is Dean's re-pass; if still invisible, the diagnosis is wrong and we
re-root-cause. Dual-Node PENDING at time of writing.

DEVICE (Dean): pull, enable Sneaky critter mode -> five figurines now VISIBLY
peek from behind cards/boxes on phone and desktop; the audio-expanded player and
faux fullscreen still cover the whole screen with no header/nav bleeding over
them; podcasts add-subscription sheet still sits above everything.

### v1.166.0 - Sneaky critter mode: the skeleton (Dean) (2026-08-22)

Dean's fun mode, OFF by default and completely optional: little critters peek out
from behind page furniture (cards, boxes, menus) at jaunty angles - never over the
video/audio surfaces - with density tiers Sparse 1 / Normal 6 / Obscene 16 (his
names, his curve). Tap a critter's exposed sliver: its own sound file (or a synth
chirp) plus one random tiny reaction (wiggle / shiver / hop; transform-only;
reduced-motion-safe). Settings -> Appearance, per-device. THE FOLDER IS THE
MANIFEST: drop any images into public/critters/ (README in the folder documents
the contract) - name-agnostic, a same-basename sound file becomes that critter's
voice, code owns display size so huge crisp renders are ideal. Empty folder ->
three built-in ORIGINAL SVG figurines (deliberate deviation, disclosed: not
committing trademarked Calico Critters art pulled from the web; Dean supplies his
own files). Exec plan: docs/exec-plans/active/critter-mode-skeleton.md.

FULL gate - BOTH seats REQUEST CHANGES round 1, every finding applied:
- The gate's sharpest catches, all measured: a peek could REACH INTO an adjacent
  player/dock (123/500 seeded runs - the placement's own rect is now checked, not
  just its anchor); a zero-clamp made ~1/3 of critters on full-bleed mobile cards
  FULLY hidden and untappable (clamp removed; off-page peeks clip instead); a
  legal double-quote filename made every tap on that critter THROW (taps resolve
  by index now - no id-built selector); the modal exclusion was one class of
  twelve (now a [class*="-backdrop"] suffix net + the tap handler stands down
  over every exclusion); iOS URL-bar resizes re-scattered mid-view (width-only
  gate now).
- Delta re-confirm: BOTH seats APPROVE; adversarial re-ran its own repro probes
  (0/377, 0/600, 0/250) and killed 10/10 new-guard mutants; QA independently ran
  the full release bar (7444/7444).
- Server surface: ONE read-only GET /api/critters (folder listing; session-gated;
  classified NO_CONTENT; RBAC route-count pin bumped with review). The v1.79
  run-full-test-first discipline caught both census nets pre-gate.

DISCLOSED residuals: tap-path guard bindings are source-locked (jsdom cannot
click real layouts); anchors measured shortly after init (a late-growing surface
may be critter-less until the next navigation); symlinked files skipped (README
says so); the backdrop net depends on the -backdrop naming convention (uniform
today, test-locked). Dual-Node PENDING at time of writing. The peek visuals are
Dean's device pass.

DEVICE (Dean): Settings -> Appearance -> enable Sneaky critter mode -> the three
placeholder figurines peek from behind cards/boxes at angles; tap one -> chirp +
a tiny reaction; density tiers change the count; NOTHING over the player, dock,
or fullscreen; OFF -> everything vanishes. Then drop PNGs into public/critters/
and refresh - they take over. Probe right-edge cards on mobile (bounds skip).

### v1.165.0 - the keyboard-shortcuts window (and the DDR toy) comes to mobile (Dean) (2026-08-22)

Dean reversed his own v1.47.8 "ignore/not display on mobile viewport" ruling: "let's
do keyboard shortcuts as the DDR bit is cute!" The shortcuts window hosts the DDR
mini-synth (v1.163) whose arrows play on CLICK/TAP - no keyboard needed - so the
phone now gets the toy. Stats -> Keyboard shortcuts is visible on phones; tapping it
opens the same window (single column, scrolls inside the modal's 85vh cap; the
two-column no-scroll layout stays desktop-only). The shortcut list rides along as
reference. Only the `?` KEY stays desktop-gated - a phone has no key to press.

Mechanics: removed `data-md-hide-mobile` from the Stats entry + the phone
`display:none` on `.shortcuts-entry`. The generic v1.152 hide-mobile mechanism is
KEPT for future sections, now bound via a synthetic marking so it stays
mutation-locked with zero production users. Two DELIBERATE test-lock inversions,
documented in-test.

SLIM gate: REQUEST CHANGES first - two WARNINGs, both this repo's recurring
classes, both taken as prescribed: (1) the new visibility lock was porous to a
selector-list CSS spelling (divergent-fixture class) - now a comment-stripped
whole-stylesheet net, spelling- and width-agnostic; (2) the Stats button became the
SOLE mobile route while its wiring was presence-only bound - deleting the listener
kept all 5586 tests green. Now bound behaviourally (click -> opens; destroy ->
unwires), and fixing it exposed WHY the suite was blind: the test fixture never had
the button, so the wiring silently skipped. Delta re-confirm APPROVE - every mutant
(including a fresh width/spelling probe and a dropped-{signal} probe) killed.
Dual-Node PENDING at time of writing.

DEVICE (Dean): phone -> Stats -> Keyboard shortcuts (now visible) -> tap it -> the
window opens; tap the four arrows -> notes play, left/right flash blue, up/down
red. The `?` key on desktop unchanged.

### v1.164.0 - settings scroll ownership: sections open at the top, Back restores your place (Dean) (2026-08-22)

Dean's device report: opening a settings section (Stats -> "Under the hood") landed
with the pane's own title and back arrow hidden under the app header - you had to
scroll just to see where you were. Root cause: on phone the master-detail push-in
swaps what fills the viewport, but the WINDOW is the scroller there (the panes
container never overflows), so the pre-existing `panes.scrollTop = 0` was a silent
no-op and the nav list's scroll offset survived into the opened section. The same
class as the v1.160 watch-page scroll-under-header fix, one layer deeper (in-page
swap vs route swap).

- Opening a section now lands at the TOP - phone AND desktop (Dean's call).
- The back arrow RESTORES the saved list offset (return to your place,
  iOS-Settings style); the save re-arms on every open, never a one-shot latch.
- ONE shared component = Settings, Stats, and Subscriptions all fixed at once;
  grep-verified there is no other open/close path that bypasses the reset.
- **Prevention (Dean's explicit ask): a new MANDATORY "scroll ownership" rule in
  docs/CONTRIBUTING.md** - any viewport swap must identify the REAL scroller by
  measurement (a container reset that doesn't overflow is exactly how this
  shipped), land forward navigation at the top, restore on back, and bind the
  VALUES behaviourally.

Bound behaviourally (stubbed scrollTo + overridden scrollY: open -> [0,0], back ->
[0,savedY], fresh-offset re-arm). SLIM gate, adversarial APPROVE - all four
briefed mutants killed; its surviving ordering mutant (restore-before-swap clamps
in a real browser, invisible to jsdom) is bound by an in-code comment where a
refactor would trip it. Dual-Node PENDING at time of writing. The rendered feel
(title + back arrow visible on arrival) is Dean's on-device arbiter.

DEVICE (Dean): phone - Stats, scroll the list down, open "Under the hood" -> the
section title + back arrow are immediately visible at the top; tap Back -> the
list is where you left it. Same on Settings and Subscriptions; desktop section
clicks also land at the top.

### v1.163.3 - captions bound inside the video frame (mobile bar + mini-player) (Dean) (2026-08-22)

Device regression (Dean, screenshots): the custom caption overlay is lifted a fixed
distance to clear the control bar, one lift per context. Two were wrong. (1) MOBILE
in-slot: the bar is the TWO-ROW 80px bar (`#player-slot .player-controls`, v1.34.1),
but video captions - routed through this overlay only since v1.124 - kept the audio-era
44px lift, so on a phone they landed ON the top (scrub) row of the controls. Added
`#player-slot .cc-overlay { bottom: 80px }` so the lift matches the real bar height,
the same pairing every other context has (desktop 40, dock 26, fullscreen 64+). (2)
MINI-PLAYER: the docked cue used the full `--fs-md` unclamped, so a 2-3 line cue grew
up out of the 160px thumbnail and covered the video. Shrunk to `--fs-xs` + clamped to
two lines with `overflow: hidden` so it's a small strip bound inside the frame (Dean's
pick: shrink-to-fit, not hide). Root cause: the seam between v1.34.1 (two-row bar) and
v1.124 (video captions through the overlay).

Bound by a MATCHED-PAIR source-lock (the in-slot mobile caption lift must EQUAL the
two-row bar height - change either alone and it reds) plus a docked shrink/clamp lock.
SLIM gate, adversarial APPROVE, zero blocking findings; dual-Node PENDING at time of
writing. Visual feel is Dean's on-device arbiter (jsdom has no layout engine).

KNOWN GAP (disclosed, tech-debt #166): a benign, unreachable CSS cascade inversion -
the new in-slot rule outranks the LEGACY fallback-fullscreen offset (pre-v1.138 shells
only, where iOS refuses element fullscreen and others have ~0 safe-area, so it merely
over-clears by 16px with no occlusion). Not fixed because the harden would risk a real
audio-expanded regression; prescription + revisit trigger recorded in the tracker.

DEVICE (Dean): on a phone, play a captioned video - the caption sits INSIDE the video,
above the two-row control bar (not over it); dock it to the mini-player - the caption
is small and stays inside the thumbnail. Desktop unchanged.

### v1.163.2 - DDR press flash by direction: left/right blue, up/down red (Dean) (2026-08-22)

Corrects what v1.163.1 mis-scoped. Dean wanted the arrow GLYPHS left alone (neutral) -
only the SQUARE that flashes when you press a key should differ by direction: up/down
flash red (as before), left/right flash BLUE. So: reverted the resting per-axis glyph
colour, and moved the axis colour onto the press state - `.shortcuts-ddr-arrow--h.ddr-hit`
lights `var(--text-link)` (blue), `--v.ddr-hit` lights `var(--yt-red)` (red). Both are
two-class rules declared after the base `.ddr-hit`, so at equal specificity left/right's
blue beats the base red while up/down keep it; the white glyph + pop animation are
unchanged. The U+FE0E / `font-variant-emoji: text` groundwork stays so iOS still can't
emoji-colour the glyph itself.

PROCESS (honest, and a repeat): this is the THIRD read of the same one-line ask - I
first heard "make them neutral", then "colour the glyphs blue/red", before Dean pinned
it: colour the PRESS FLASH by direction, not the glyph. Each attempt was gated + green;
the churn was interpretation, not defects. LESSON logged: on a terse visual tweak,
restate the exact element + state (glyph vs square, resting vs pressed) and get a yes
before building. SLIM gate, adversarial APPROVE (3 mutants: token-swap, source-order,
glyph-recolour-revert-enforced). Dual-Node PENDING at time of writing.

DEVICE (Dean): open `?`, press the arrow keys - left/right squares flash BLUE, up/down
squares flash RED; the arrow glyphs themselves stay neutral (uncoloured).

### v1.163.1 - DDR arrows: intentional left/right blue, up/down red (Dean) (2026-08-22)

Dean WANTS the DDR arrows coloured - left/right blue, up/down red (the classic pad
scheme) - not the grey the v1.163.0 stylesheet gave them. On his iPhone iOS happened
to colour them (via emoji substitution), but that is device-specific and
uncontrollable; on desktop they were grey. Make it INTENTIONAL and identical
everywhere: force the monochrome text presentation of the glyphs (U+FE0E +
`font-variant-emoji: text`) so the OS emoji palette can't interfere, then set our own
per-axis colours - `--text-link` (blue) for left/right, `--yt-red` (red) for up/down,
both theme tokens so they stay legible in light and dark. The press state (`.ddr-hit`,
red, until the window is reopened) is unchanged - Dean confirmed that was fine. The
`axis` field on each arrow drives a `.shortcuts-ddr-arrow--h/--v` class; the `.glyph`
data stays the bare arrow. No raw control byte in source (the U+FE0E constant is a
`\uFE0E` escape; tests build it from `String.fromCharCode(0xFE0E)`).

PROCESS NOTE (honest): my first read of "can we change that colour" was BACKWARDS - I
built a monochrome-grey version (gated + APPROVED) before Dean clarified he wanted the
colours kept and made intentional. Caught pre-release, so nothing shipped grey; the
text-presentation groundwork was reused, only the colour flipped from grey to
blue/red. SLIM gate (cosmetic, non-destructive). Dual-Node PENDING at time of writing.

DEVICE (Dean): open `?` - left/right arrows blue, up/down red (same on phone and
desktop); pressing an arrow still lights it red until the window is reopened.

### v1.163.0 - "FileTube FileTube Revolution" easter egg + desktop no-scroll shortcuts (Dean) (2026-08-21)

Two things in one small, fun wave. The original ask: the desktop keyboard-shortcuts
window (`?`) used to need scrolling to see every shortcut. It now flows its groups
into TWO columns and widens so the whole reference fits in one view without
scrolling; mobile is unchanged (the single 560px column). Then, the Discord homage
Dean remembered: a hidden mini-synth in the top-right of that window.

- **The DDR mini-synth**: four DDR arrows (left/down/up/right) sit top-right of the
  shortcuts window. Press the matching arrow KEY or click an arrow and it lights up
  and plays a distinct note (C5 / D5 / E5 / G5 - a C-major chord you can noodle a
  tune on). Subtitle: "Master these to be the best FileTube FileTube Revolution
  player". Built on Web Audio; silently no-ops (never throws) where audio is
  unavailable; the light-up pulse honours prefers-reduced-motion.
- **Why the arrow keys are safe** (the real engineering): arrow keys normally
  seek/scrub the player, so the synth's key handler is CAPTURE-phase (it beats
  player.js), consumes ONLY the four bare arrows (Esc / Tab / `?` / j / k / l and
  every Cmd/Ctrl/Alt+Arrow OS combo pass through), and is UNBOUND the instant the
  window closes so it can never eat arrow keys afterward.

FULL gate (both seats, not slim - the capture-phase arrow interception touches the
player's core keyboard path). Both APPROVE, one fix round. Both seats independently
flagged the same latent trap: `openShortcutsModal`'s stranded-recovery arm rebuilt
the window without unbinding a leaked capture handler - which would have eaten every
arrow key session-wide if a future code path ever stranded the backdrop. Unreachable
in the shipped tree, fixed anyway and mutation-bound (neutering ONLY the strand-arm
unbind, with close's intact, still reds a behavioural leak test - proving the strand
arm is independently the sole releaser). Also folded in: a modifier-key bail
mirroring player.js, and source-locks for the reflow-retrigger and stopPropagation
that survived round 1. Dual-Node 7411/7411 on v22.23.1 AND v24.14.0.

DEVICE (Dean): on desktop, press `?` - the whole shortcut reference fits with no
scroll; the four arrows sit top-right; press the arrow keys (or click them) and hear
four distinct notes; noodle a little tune; confirm the arrows do NOT scrub the player
while the window is open, and DO scrub again once it is closed.

### v1.162.0 - per-item delete on the Stats tables (Dean) - DESTRUCTIVE (2026-08-21)

Dean prunes his library by sorting the Stats "Videos & audio" table by size, then
searching for the item to delete it from a card. Bypass that: the tried-and-true
trash icon + two-tap confirm now lives on the Stats tables that list deletable
media, same flow as a card (DELETE /api/videos/:id -> Trash, recoverable).

- **Videos & audio + Most watched**: a per-row two-tap delete, library-write gated
  (admin OR the modify-library flag; read-only users see NO delete controls; the
  server DELETE is RBAC + visibility guarded regardless). Row removed on a confirmed
  2xx (non-optimistic).
- **Duplicates**: a per-group expand toggle -> per-copy deletes (a dup row is a
  GROUP of N copies, so you delete EXACTLY the copies you choose - zero wrong-file
  risk; the Users-access-editor full-row expando pattern). Deleting to <=1 copy
  drops the whole group row.
- No server change (ids already in the payloads; the reports are visibility-scoped).

FULL gate (destructive), both seats APPROVE, ONE docs-only fix round. The load-
bearing v1.159 re-render safety (an armed two-tap must never survive a sort into a
one-tap delete) is the closure-local armState + full row rebuild - mutation-bound
by a behavioural test. The two seats CONTRADICTED on whether resetStatsArm binds; a
self-run mutation settled it (defensive-only, adversarial correct) and the comment
was corrected. Dual-Node 7396/7396 on v22.23.1 AND v24.14.0.

ACCEPTED RESIDUAL (disclosed): an in-place Duplicates copy delete leaves the group
row's Copies/Reclaim cells stale until a re-sort (self-heals; matches the "refresh
next load" ruling; a table.update would re-collapse the expando mid-prune).

DEVICE: sort Videos & audio by size, delete the biggest (two-tap) -> lands in Trash,
restorable; Most watched delete; expand a duplicate, delete a specific copy; a
read-only account sees NO delete buttons anywhere.

### v1.161.5 - keep-alive: bound the battery footgun + damp the lock-screen position (Dean) (2026-08-21)

Dean device-confirmed the v1.161.4 keep-alive works (lock-screen play/pause past
the first cycle), and asked for two refinements after reasoning through the
second-order costs:

- **#1 paused-idle auto-stop (the battery footgun).** The keep-alive kept the
  process awake whenever a video was backgrounded - including PAUSED-and-forgotten,
  which would loop silently forever until a force-close. Now, while the sidecar is
  PAUSED in the background, a 5-min timer (`KEEPALIVE_IDLE_STOP_MS`) is armed; if it
  stays paused that long the keep-alive stops and iOS suspends (a resume after that
  legitimately won't work - if you paused 5+ min, the app sleeping is correct).
  Cancelled the instant the sidecar resumes and on any teardown. Keeps the quick
  pause->resume win, bounds the forgotten-in-pocket drain to 5 min.
- **#2 lock-screen position damp.** The silent loop competed with the sidecar for
  iOS's "now playing" timeline, so the scrubber briefly showed the loop's 0->3s
  counter (Dean saw it "reset to 0:00,01,02,03" then reconcile). A timeupdate
  listener on the keep-alive element now force-asserts the REAL sidecar position
  every tick + once on start, so iOS always shows the video's time.

SLIM gate (adversarial), APPROVE - NO findings; every binding mutation-verified (8
mutants killed), the off-path genuinely inert, no timer or position can misfire.
Dual-Node 7387/7387 on v22.23.1 AND v24.14.0.

DEVICE (keep-alive checkbox on): the lock-screen scrubber should now show the real
video time (no 0-3s counter); pausing and walking away should stop draining after
~5 min (a resume then legitimately won't work); a quick pause->resume still works.

### v1.161.4 - background keep-alive loops a long silent clip (Dean device iteration) (2026-08-21)

Dean device-tested the v1.161.3 keep-alive: it WORKED for the first pause/resume
cycle while locked, then stopped - proving the concept (keeping the process awake
does enable a locked resume) but revealing the loop source didn't sustain.

- ROOT CAUSE: the keep-alive looped `SILENT_PRIME_SRC`, an ~1ms (8-sample) clip -
  as a keep-alive it restarts its loop ~1000x/second, which iOS throttles in the
  background, so it read as not-continuously-producing-audio and the process was
  reclaimed after one cycle.
- FIX: loop a LONG (~3s), rarely-restarting silent clip built at runtime
  (`buildSilentWavDataUri` - a real mono 8-bit PCM all-silence WAV data URI, cached
  once), so iOS treats it as sustained audio. `SILENT_PRIME_SRC` keeps its original
  one-shot prime job; only the keep-alive's source changed. Still opt-in/default-off,
  same 4-site teardown safety, same no-op-when-off.

SLIM gate (adversarial), APPROVE. The generated WAV is measurably valid (header /
rate / 8-bit / mono / length / all-silence, degrade-safe) and mutation-bound; both
gate SUGGESTIONs applied (bound the RIFF-size field; fixed a stale btoa comment).
Dual-Node 7385/7385 on v22.23.1 AND v24.14.0.

DEVICE: with the "keep background video-audio controllable while locked" checkbox
on, play a video, lock, pause from AirPods, and confirm resume now survives PAST
the first cycle. If it still hits a wall after a longer stretch, that is iOS's hard
suspension ceiling and native (Capacitor/AVPlayer) is the only real fix.

### v1.161.3 - honest lock-screen glyph + opt-in background keep-alive (Dean) (2026-08-21)

Follow-up to Dean's "background video-audio pauses fine when locked but won't
resume" report. A three-agent code review (state map + resume-failure trace +
v1.161.2-delta/iOS-reality) concluded the code path is symmetric/correct - the
resume failure is iOS suspending the audio-less backgrounded process (a platform
wall, aggravated by v1.161.2 making pause genuinely stop the audio). Two
website-side responses + a reference doc:

- **Honest glyph.** The MediaSession `play` handler set `playbackState='playing'`
  unconditionally after `el.play()`, so a rejected resume (suspended session /
  gesture wall) flipped the lock screen to show Pause while nothing resumed. Now
  promise-gated: resolve -> 'playing', reject -> honest 'paused'.
- **Keep-alive (EXPERIMENTAL, Settings checkbox, default OFF).** Plays an inaudible
  loop (the existing `SILENT_PRIME_SRC`) alongside the sidecar and keeps it running
  THROUGH a background pause, so iOS keeps the process awake and the resume handler
  survives. Started on a confirmed handoff; stopped at ALL FOUR bgAudioEl-teardown
  sites (release-sidecar, release-session, teardownMediaState, close) - a force-close
  can never leave even silent audio alive. Strict no-op when off (element never
  created). Real battery cost + device-dependent effectiveness, hence opt-in.
- **`docs/references/ios-background-audio-behavior-map.md`** - the 3-state behavior
  map, root cause, fixable-vs-iOS-wall, and the native (Capacitor/AVPlayer) endgame.

SLIM gate (adversarial), ONE fix round. The seat caught a reachable orphan (the
keep-alive was stopped at only 2 of the 4 teardown sites -> a background close()
could leave a silent loop draining battery into the next foreground video); fixed
by mirroring stopBgKeepAlive at all four, bound by an exact-count source-lock,
mutation-confirmed. Every safety claim (no-op-when-off, no-leak, honest glyph,
listener isolation, key agreement) measured + mutation-verified. Dual-Node
7384/7384 on v22.23.1 AND v24.14.0.

DEVICE: the honest-glyph fix needs no action. To try the keep-alive: Settings ->
"keep background video-audio controllable while locked" -> on; then play a video,
background/lock, pause from AirPods, and see if a second squeeze now RESUMES it -
weighed against the extra battery (the app won't sleep while backgrounded). Report
back and we decide whether it earns its place or we wait for native.

### v1.161.2 - fix: AirPods/lock-screen play-pause during background play (Dean) (2026-08-21)

The v1.161.1 diagnostics paid off: Dean's lifecycle-log screenshot CONFIRMED the
bug and named the mechanism, so this is the real fix (not a theory).

- Log evidence: `bgAudio:ok playing=true` -> `msAction:play` -> `msAction:pause`.
  iOS sent PLAY on the first AirPods squeeze because its MediaSession
  `playbackState` read 'paused' while the hidden `<audio>` sidecar was actually
  playing. PLAY on an already-playing sidecar is a no-op ("nothing happened"); the
  second squeeze sent PAUSE and worked.
- ROOT CAUSE: the sidecar's play/pause listeners are guarded on
  `activeMediaElement() !== bgAudioEl` (they only touch playbackState when they are
  the active element), but the VIDEO element's playbackState listeners were
  UNGUARDED. During a background handoff the video is deliberately paused while the
  sidecar plays, so the video's unguarded `pause` stamped playbackState='paused'
  over the truth.
- FIX: the mirror guard `if (activeMediaElement() !== mediaPlayer) return;` on the
  video's play/pause playbackState listeners. Handoff sets HANDING_OFF before the
  video pause (so the late pause event is skipped); swapback resets INLINE_VIDEO
  before the video replays (+ an explicit re-assert). Common case (INLINE_VIDEO)
  the guard is a no-op - byte-unchanged.

SLIM gate (adversarial), APPROVE - every surface mutation-verified (common-case
no-op, handoff ordering, swapback, stuck-state enumeration, completeness of every
setPlaybackState site, progress-saver listeners untouched); the guard binds
(dropping it reds 110/111). ACCEPTED RESIDUAL (disclosed, self-healing): on the
rare HANDOFF_FAILED path (iOS gesture-wall rejects the sidecar play, so no audio is
playing anyway) playbackState could momentarily read stale 'playing' before the
next event's re-assert corrects it - transient, not durable. Dual-Node 7379/7379 on
v22.23.1 AND v24.14.0.

DEVICE: play a video, background it, squeeze the AirPods ONCE - it should pause on
the FIRST press now (and resume on the next). (Optional: leave Settings -> "Show
lifecycle debug log" on and confirm the first backgrounded squeeze now logs
`msAction:pause`, not `msAction:play`.)

### v1.161.1 - MediaSession-action diagnostics (AirPods play-pause bug) (Dean) (2026-08-21)

Dean device report: AirPods/lock-screen play-pause is INCONSISTENT during background
play (works in every other app). INSTRUMENTATION ONLY - no playback behaviour change;
the fix ships after the device repro names the mechanism (diagnosis discipline - the
play/pause handlers already retarget to `activeMediaElement()`, so a naive
wrong-element bug is ruled out; the two live root causes need opposite fixes).

- New pure `formatMsActionDetail({el,state,hidden})` (mirrors `formatPauseProvenance`).
- The `setMediaSessionAction` wrapper's `msAction:<name>` lifecycle-log record now
  carries WHICH element the action will act on (`bgAudio` sidecar vs paused `video`),
  the `bgAudioState`, and hidden/visible - read at the action's ARRIVAL. So one log
  screenshot distinguishes: no `msAction:pause` entry = iOS never routed the command
  (session-ownership / sibling tamm.am domain-coupling class); `el=video` = we acted
  on the wrong element (our bug); `el=bgAudio` + a following `media:pause(bgAudio)` =
  it worked that time.

SLIM gate (adversarial, instrumentation-only), APPROVE. Mutation-verified: zero
playback behaviour change, and the enrichment CANNOT throw inside a real AirPods/
lock-screen command (the arg is built before recordLifecycleEvent's flag gate, so
every read in it - activeMediaElement/bgAudioEl/bgAudioState/guarded document - is
throw-free). One negligible SUGGESTION (two side-effect-free reads run flag-off)
left as-is. Dual-Node 7378/7378 on v22.23.1 AND v24.14.0.

DEVICE: no URL needed - Settings -> "Show lifecycle debug log" (the installed PWA
drops `?debugLifecycle=1` on launch). Enable it, play a video, background it, squeeze
the AirPods to pause, then screenshot the green log strip and send it - that names
which of the two root causes to fix.

### v1.161.0 - search-clear + resume timing + notification delete + bg-speed fix (Dean) (2026-08-21)

A four-item QoL branch; one item (the notification delete) is DESTRUCTIVE, so the
whole wave took the FULL two-reviewer gate.

- **Search box clears on a successful search.** After a search that returns
  results, `#search-input` clears so the next search needs no clear-X first; a
  ZERO-result search KEEPS the query (its X still resets it). Results ride the
  `?search=` URL, so emptying the box never wipes them; the "Search results for..."
  header still shows what was searched. Pure `shouldClearSearchInputAfterResults`.
- **Configurable resume-countdown length, 0 = instant.** The v1.132 resume prompt's
  hardcoded 5s is now a Setup -> Playback field (0-30, default 5). 0 = resume
  instantly with no prompt at all - it fires the configured action's button (the
  SAME resume/beginning mapping the countdown uses, so no progress-wipe on the
  default) with no overlay shown. `resolveResumeCountdownSeconds` (player read,
  clamp) + `clampResumeSeconds` (setup write, blank -> default). Resume prompt only;
  autoplay-next untouched.
- **Delete button on video notifications (DESTRUCTIVE).** A per-video delete on
  MEDIA notification rows (podcast/engine rows excluded), a SIBLING of the row
  anchor so a tap can't navigate (no stopPropagation - the v1.153 scar), a two-tap
  "Sure?" arm (`nextArmState`), `DELETE /api/videos/:id` -> Trash (recoverable, the
  same flow a card uses), NON-OPTIMISTIC (row leaves only on a 2xx). Arm state is
  render-local so a panel reopen never inherits a hot one-tap delete (the v1.159
  Trash-arm class - the adversarial seat built the exact reopen attack and could
  not reproduce it). The row-removal + focus-keep + badge-reconcile is now a shared
  helper used by both the dismiss X and delete. 44px mobile touch floor.
- **Video background-play no longer drops 1.5x to 1x.** ROOT CAUSE (evidence, not
  theory - Dean's "the video is instantly right on foreground" was the tell): the
  hidden `<audio>` sidecar that carries background audio for VIDEO
  (`attemptBackgroundAudioHandoff`) seeked and played but never copied the rate, so
  it defaulted to 1x. Audio-only never hands off (it was immune); the video element
  keeps its own rate (instantly correct on return). Fix: carry the live rate onto
  the sidecar at handoff (after the src arm, before play; playbackRate +
  defaultPlaybackRate), guarded by a new `sanitizePlaybackRate`.

FULL gate, both seats APPROVE, ONE docs-only fix round (two non-blocking
SUGGESTIONs: a mildly-optimistic comment softened, a spec line corrected). The
adversarial seat's destroy-the-data pass found no one-tap-delete, no wrong-item
delete, no armed-survives-reopen leak, and no progress-wipe on instant resume - all
mutation-confirmed. Dual-Node 7377/7377 on v22.23.1 AND v24.14.0.

DEVICE probes: (1) search something -> the box clears; search that finds nothing ->
the query + X stay. (2) Set resume seconds to 0 -> a video resumes instantly with
no prompt; a custom value counts down that long; NOTE the 0=instant path is gated
on the resume-countdown toggle being ON (toggle off = the prompt always waits) -
confirm that matches your mental model. (3) On a video notification, the trash
button: one tap shows "Sure?", a second deletes to Trash; it never opens the video;
it is not fat-finger-close to the X. (4) Play a video at 1.5x, background it -> the
audio stays at 1.5x.

### v1.160.3 - swipe-back from anywhere, not just the left edge (Dean) (2026-08-20)

Dean: "any chance we can have the drag be from the middle versus the edge?" He
wanted the left-to-right back-swipe to start from anywhere, not a fiddly left-edge
start.

- `decideSwipeBack` drops the `startX <= 24` edge gate - a rightward,
  horizontal-dominant drag from ANYWHERE past the threshold goes back. Travel
  threshold bumped 64 -> 90px so a mid-screen start is deliberate.
- **Horizontal-scroller guard** (`isHorizontalScrollerBox` + an ancestor walk): a
  drag that BEGINS inside a sideways-scrolling box (the Stats/By-folder pill
  strips, the search toolbar strip, the books/music/chip rows) scrolls that box
  and never fires a back. The gate enumerated all six real horizontal scrollers
  and confirmed the generic walk catches each.
- The anti-shake `preventDefault` is kept but attached LAZILY - only once a drag
  is confirmed horizontal - so a vertical scroll never leaves the compositor
  fast-path (the v1.160.1 gate lesson).

SLIM gate (adversarial alone), ONE fix round, APPROVE. The seat caught a real
blocking regression (WARNING 1): the first cut LATCHED the preventDefault, so a
scroll starting with a slight rightward arc then curving down had its vertical
scroll EATEN - fixed by re-evaluating direction every move (restoring the
v1.160.1 per-move semantics), plus a shared 1.5x horizontal-dominance factor
across the claim AND fire decisions so a big diagonal is neither prevented nor
fired (no accidental back, no scroll eaten for nothing). Mutation-bound.
Dual-Node 7365/7365 on v22.23.1 AND v24.14.0.

KNOWN GAP / top device-probe (WARNING 2, disclosed): the lazy `preventDefault` is
attached mid-gesture, so on iOS the later touchmoves MAY be non-cancelable and the
`preventDefault` a no-op - in which case the no-shake guarantee rests on the CSS
belt (`html { overflow-x: clip; overscroll-behavior-x: none }`) alone, which the
gate assessed as sufficient (nothing to pan/rubber-band horizontally). If a
mid-screen swipe shakes on Dean's device, the fix is the CSS belt, NOT the
threshold. Edge-start still works (it's a subset of "anywhere"), so a fall-back to
edge is trivial if middle feels wrong.

DEVICE probes: swipe right from the MIDDLE of the screen to go back; confirm no
shake on a long page; confirm a sideways scroll (Stats pill strips, search
toolbar) still scrolls and doesn't trigger a back; confirm a diagonal scroll
doesn't accidentally navigate back.

### v1.160.2 - modern card/list toggle glyph size (Dean device report) (2026-08-20)

Dean's device pass on v1.160.1: the modern-home card/list toggle glyph "is a
little small." ROOT CAUSE: the grid/list icon is a `1em` mask (`.icon-grid` /
`.icon-list`, width/height 1em); `.modern-view-toggle` set NO `font-size`, so the
glyph inherited the ambient ~16px, while every sibling header glyph (the download
`#ytdlp-oneoff-btn`, the `.search-toggle-btn`, the `.modern-sort-btn` caret) is
`--fs-4xl` (22px) - the uniform header glyph family. Added `font-size:
var(--fs-4xl); line-height: 1;` so the glyph joins that family.

SLIM gate (adversarial alone, one-line cosmetic CSS), APPROVE, no findings in
scope. Source-lock added (library-view-prefs) binding the `--fs-4xl` sizing so it
can't silently shrink again - mutation-confirmed (reverting the font-size reds
11/12). Census 0. Dual-Node 7364/7364 on v22.23.1 AND v24.14.0.

Known cheap sweep (out of scope here, logged): the `.modern-sort-btn` comment's
"one step MORE than the download/search glyphs" is stale - those glyphs are also
22px; correct it next time style.css is touched.

DEVICE item: the modern feed's card/list toggle glyph now reads the same size as
its neighbours.

### v1.160.1 - swipe-shake + grey toggle + Subscriptions hero (Dean device report) (2026-08-20)

Three fixes from Dean's device pass on v1.160.0 (a fourth - the Activity view -
is PARKED at Dean's request: "closer but just not great, I need time to sit with
it to articulate, not on you").

- **Swipe-back no longer shakes the page.** The v1.160.0 left-edge swipe let the
  browser ALSO pan/rubber-band the page ("the whole app shakes with it"). The
  edge drag now `preventDefault`s once it commits to horizontal + rightward (new
  pure `edgeSwipeShouldClaim`, claim distance 8px), plus `overscroll-behavior-x:
  none` on the root. Edge (not middle) kept, per Dean. The gate's WARNING drove
  the real fix: a `preventDefault` needs a NON-passive touchmove, and registering
  one globally would tax EVERY vertical scroll off the compositor fast-path - so
  the non-passive listener is attached only on an edge touchstart and removed the
  instant the gesture ends (scoped, mutation-bound). Normal scrolling stays fast.
- **Modern card/list toggle no longer reads as "always selected/grey."** It
  carried the filled `.btn` look; now the transparent glyph style of its
  `.modern-sort-btn` sibling (the home-view route-gate from v1.160.0 preserved).
- **Subscriptions header block restored.** Subscriptions lost its title/explainer
  moving off the master-detail menu in v1.156; re-added the shared iOS-style
  `.md-hero` block (icon tile + "Subscriptions" + explainer). Static markup - the
  tile colours via CSS, carrying ZERO `data-md-*` attrs so the v1.156
  master-detail-drop lock still holds. The dead `.subs-title` removed.

SLIM gate (adversarial alone - a device-report hotfix), ONE fix round, APPROVE.
The seat's WARNING was a lying comment + a latent scroll-stutter (the global
non-passive listener); fixed for real, not re-worded, and the source-lock
strengthened to require the scoped `removeEventListener` (mutation-confirmed:
dropping it reds router-helpers 60/61). Dual-Node 7364/7364 on v22.23.1 AND
v24.14.0.

DEVICE items (Dean's device is the arbiter): the swipe-back should no longer
shake; scroll the modern home feed hard and confirm no new scroll stutter (the
perf face of the fix); the modern toggle no longer looks pre-selected; the
Subscriptions page shows its header block. Activity remains parked.

### v1.160.0 - navigation + clarity follow-ups (Dean's 7-item branch) (2026-08-20)

Seven follow-ups after the sortable-tables wave.

- **Most watched (Stats)** is now a sortable table (Title | Plays, biggest first)
  and **fills the screen**; **Under the hood** also fills (kept its reference-list
  look - mixed-unit metrics, nothing to sort). The 240px card cap is lifted on
  both (`.stats-table-host` for the table, `.folder-list-builder--fill` for the
  list).
- **Subscriptions Activity redo:** Download history, Download failures, AND the
  Maintenance button row are now three DEFAULT-COLLAPSED collapsible sections
  (the janky bottom buttons tucked into a `<details>`), styled like the Settings
  collapsibles. All 5 maintenance ids + 4 status spans unchanged (wiring intact).
- **Scroll-under-the-header on in-app nav - fixed.** ROOT CAUSE: the app never
  set `history.scrollRestoration`, so it defaulted to `'auto'` and the browser's
  scroll-restore overrode the app's `scrollTo(0,0)` on a pushState nav. Now
  `'manual'` in bootRouter - the app owns scroll (resets forward, restores the
  recorded scrollY on back).
- **Left-edge swipe-back** (net-new gesture): a touch from the left edge (<=24px)
  travelling right past 64px, horizontal-dominant, goes back one page - the same
  depth-aware back the Home control does (never exits the app, coalesced against
  double-pop). Home button already walked back on these SPA pages (verified).
- **Modern-home card/list toggle:** the classic toggle lived in a bar modern mode
  hides, so the modern feed honored a stored `ft-view-mode` but couldn't change
  it. Added a toggle to the modern top bar driving the same setting.

FULL two-reviewer gate, ONE fix round, both seats APPROVE. The two-seat gate
earned its keep: the QA seat caught a real orphan the adversarial missed - the
modern toggle appends to the PERSISTENT header, and home is CACHED (not
destroyed) on nav-away so its abort cleanup never fires, which would have left
the toggle stranded on watch/stats/etc with a hidden click side-effect; fixed
with the same route-CSS home-gate `.modern-sort` already uses. The adversarial
seat mutation-confirmed the swipe decision (edge/threshold/dominance), the manual
scroll, the depth>0 guard, and the wire-call, and had a vacuous coalesce
source-lock strengthened. Dual-Node 7361/7361 on v22.23.1 AND v24.14.0.

DEVICE items (no browser in the build env -> Dean's device is the arbiter): the
swipe-back FEEL/threshold and its two disclosed gaps (a horizontal-scroller
reaching the left edge; iOS-Safari's own native edge-swipe in a browser tab), and
the scroll-restoration fix. Probes: tap into Stats/Settings/Subscriptions - top
no longer hides under the bar; swipe in from the left edge to go back; Most
watched + Under the hood fill the screen; the Activity panel opens tidy; the
modern feed's new card/list toggle matches Downloads.

### v1.159.0 - the clarity wave: sortable, filterable tables (2026-08-20)

Dean: the Stats "By folder" view (and its siblings) were small on mobile and not
sortable or filterable. This turns every list-that-is-really-a-table into a real
sortable, filterable table via ONE reusable component - and fixes the layout bug
where the card was height-capped and stranded the bottom half of the screen.

- **The component** (`buildSortableTable`, common.js): tappable column headers
  (tap to sort, tap again to flip; aria-sort + a CSS caret mark the active
  column), a name-search filter, per-table sort persistence (localStorage), and
  a `renderCap` (top-N of the current sort + an honest "Showing N of M" hint) for
  large sets. Numeric columns sort by the RAW value, not the label ("9.3 GB" <
  "24.8 GB"). Mobile-first, design-token census 0.
- **Seven surfaces converted:** Stats By folder, By channel, Books folders,
  Duplicates (now sorted by RECLAIMABLE space BEFORE its 50-group cap, so the
  biggest offenders always show), and a NEW "Videos & audio" table (the whole
  library, Title/Type/Length/Size) backed by a new visibility-scoped
  `GET /api/library-items`; plus admin Users (Name/Role/Status) and Trash
  (Title/Size/Expires). The `.folder-list-builder` 240px cap is lifted on these
  (fills the screen). The A/V table is a hard cap of 300 rows + the "refine the
  filter" hint, NOT lazy infinite scroll.
- **Deferred (disclosed, tech-debt #165):** the Music tracklist. Its rows are
  coupled to the PLAY QUEUE by index (row-play, next/prev, the playing
  highlight, lock-screen, sticky drill header), so sorting the view would reorder
  the play queue itself - touching the battle-won player machinery the repo says
  to reuse, not rebuild, and raising a real sort-vs-play-order design question.
  A deliberate follow-up, not a rushed bolt-on.

FULL two-reviewer gate, ONE fix round, both seats APPROVE. The gate's catch was a
destructive-path invariant: the Trash per-item two-tap Purge arm SURVIVED a
sort/filter re-render (the "Sure?" vanished but the arm stayed live ~3s), so a
single tap could then delete with no on-screen confirmation - fixed with an
`onRender` hook that disarms on every re-render, mutation-bound. The A/V titles
endpoint was proven visibility-scoped (a restricted member can't see a hidden
title); Users/Trash actions were proven to hit the right row after a sort.
Dual-Node 7354/7354 on v22.23.1 AND v24.14.0. No browser in the build env ->
Dean's device probe is the arbiter (esp. the Users actions cell fit at 360px).

Device probes: Stats By folder/channel/Books/Duplicates + the new Videos & audio
tab - tap a header to sort, type to filter, and the table fills the screen (no
more half-empty card). Settings Users + Trash sort/filter, and every row action
still works (Trash: two taps to purge an item, one tap never deletes). Duplicates
sorts biggest-reclaimable first.

### v1.158.0 - Empty trash + trash total, You-menu disk size, admin-row shimmer (2026-08-20)

Four independent asks from Dean, one release, one full gate (Part B destroys
data - the adversarial seat was briefed to destroy it).

- **Empty trash + total (destructive).** A new `POST /api/trash/purge-all`
  permanently purges every trash item the requester can SEE, guarded exactly
  like the single-item purge (write-RBAC + read-only refusal + per-item
  visibility) and enumerating the SAME visibility-filtered set as GET, so a
  restricted member purges only their visible items. The Trash section shows a
  "N items - X GB" total (what emptying reclaims) and a two-tap "Empty trash"
  button (tap 1 arms "Sure? Deletes N (X GB)", tap 2 within ~4s wipes).
- **Total size on disk in the You menu.** A new lightweight
  `GET /api/storage-summary` returns the visibility-scoped total via the SAME
  computeLibraryStats path the Stats "Total size on disk" tile uses, so the two
  figures can never drift. Surfaced as a link into Stats above the Version row,
  shimmering while it lazily loads on menu-open.
- **Admin-section nav shimmer.** The Downloads/Users/Backup menu rows popped in a
  beat after the is-admin capability fetch un-hid them. Now a returning admin
  (last-known `ft-is-admin` flag) sees a reserved shimmer slot in the menu that
  the real row replaces with zero shift. The placeholder carries no label/icon
  (a hidden section's identity never renders - the v1.80 rule), a non-admin never
  reserves, and both the non-admin and admin-without-yt-dlp paths clear the slot
  so no shimmer strands.

FULL two-reviewer gate, ONE fix round, both seats APPROVE. The gate's catch was
the destructive-surface discipline "guard exists != guard binds": the
read-only-media guard on purge-all (and, pre-existing, on the single-item purge)
was correct but UNBOUND - a mutant survived the whole suite - now bound with a
seeded-trash refuse test (both mutants killed); the two-tap disarm timer was
likewise unbound (a stale arm could carry into a one-tap wipe) and is now
mock-timer bound; and GET /api/trash was consolidated onto the shared
`trashRecordVisibleTo` predicate so "what a member can list" == "what they can
destroy" is enforced in code, not by comment. Dual-Node 7328/7328 on v22.23.1
AND v24.14.0. No browser in the build env -> Dean's device probe is the arbiter.
(A reviewer's delta worktree vanished mid-round and its checkout fell through to
main - the v1.80/.82/.156 scar; caught by the branch==HEAD + on-disk-marker
check before release, restored, re-qualified.)

Device probes: Settings/Stats desktop unaffected by v1.157.1's fix; open Settings
as admin -> Downloads/Users/Backup shimmer then fill, no pop-in (non-admin: none);
Trash -> the total reads right, two taps to empty, one tap never wipes; the You
menu shows the on-disk size (== Stats) and taps through to Stats.

### v1.157.1 - desktop nav-gap collapse + You-avatar shimmer (2026-08-20)

Two desktop-only bugs Dean reported on his device after v1.157.

- The master-detail nav group headers (LIBRARY/SYSTEM/ACCOUNT on Settings,
  BREAKDOWNS/SYSTEM on Stats) "shifted up and stayed until refresh" the moment
  you clicked any row - desktop only, never on iOS or Subscriptions.
  RE-ROOT-CAUSED (the v1.153 `position: sticky` guess was WRONG and is deleted):
  `.md-nav` is a flex column whose `gap` is the SOLE separator between the groups
  (`.md-group` carries no margin). The desktop rule that re-shows the nav when a
  detail opens (`data-md-open="true"`, overriding the mobile hide) used
  `display: block`, which drops the flex gap - so the groups collapsed together
  and stayed collapsed while `data-md-open` stayed true. The tell that falsified
  the sticky theory was Dean's own wording: "persists until REFRESH", a
  persistent-STATE signature, not the scroll-reset a sticky box would show. Fix:
  re-show the opened nav as `flex`. One line, plus removing the dead sticky patch.
- The "You" button avatar photo painted an EMPTY disc until it loaded+decoded
  ("empty then fills"). It now shimmers the disc (.skeleton-shimmer) as a
  placeholder and reveals the <img> only once its `load` fires (CSS holds it at
  opacity:0 until `.is-loaded`); a load error drops the photo and paints the
  initials monogram, so the disc is never left blank.

SLIM gate (adversarial seat, client-only hotfix, no data at risk): APPROVE, no
CRITICAL/WARNING. It mutation-killed all four fix points (including two mutants
the commit didn't claim - the load-reveal and the error-monogram), proved the
flex override does NOT leak below 769px (mobile push-in intact), proved every
avatar caller routes through the load->is-loaded path (no stuck-invisible img),
and applied its one non-blocking test-hardening suggestion. Dual-Node 7305/7305
on v22.23.1 AND v24.14.0. No browser in the build env -> Dean's desktop probe is
the final arbiter.

Device probes (desktop): open Settings, click any nav row - the LIBRARY/SYSTEM/
ACCOUNT headers stay put (no upward shift, no persist-until-refresh); same on
Stats (BREAKDOWNS/SYSTEM). The "You" avatar shows a brief shimmer then the photo,
never an empty disc. Confirm iOS + Subscriptions are unchanged.

### v1.157.0 - cold-launch crispness sweep (2026-08-20)

Dean's #2: kill flash-of-unstyled/unloaded content + layout SHIFT on a cold PWA
launch. A codebase recon found the shell already largely crisp (grid/sidebar/You
avatar/bell/menus/theme/router all reserve or hydrate correctly); this fixes the
real offenders.

- P1 (the worst): the home "Continue watching/listening/reading" rows were
  inserted EMPTY above the grid then filled async, shoving the whole grid down
  on every cold launch for anyone with in-progress items. Now each reserves a
  PER-KIND shape-matched skeleton (buildHomeRowSkeleton byte-matches the real
  video/book/music card + cover) BEFORE its fetch - but ONLY when it had items
  last launch (a per-row localStorage flag), so an empty-continue user gets no
  phantom skeleton. Zero-shift reveal for all three rows.
- P2a: the header hamburger + the desktop-sidebar Home/Settings/Stats glyphs
  were `.icon-*` masks (iOS shows nothing until the mask decodes -> pop-in a
  beat late). Converted to inline chrome-icon <svg> across EVERY sidebar shell
  (the bottom nav was already done). Trade-off (Dean): they no longer follow the
  icon-set picker. Home-toolbar shuffle/rescan/view-mode masks left as-is
  (out of scope).
- P2b: subscriptions.html's FOUC guard gained the ft-hide-stars stamp (a
  client-only pref the server can't inject), so a hidden-stars user no longer
  flashes star markup on a direct /subscriptions load.
- P3 (the #141 in-app-nav backlog): Settings' folder list + the podcast show
  view reserve shape-matched skeletons before their fetches (cleared on success
  AND error). The reader pane is a DISCLOSED deferral - it already shows an
  "Opening book..." status, and a shimmer tangles with epub.js's iframe
  lifecycle; a careful #141 follow-up, not a rushed change.

FULL two-reviewer gate, TWO fix rounds. Round 1: adversarial caught the P1
skeleton was video-shaped (books/listening rows shifted ~46px); both caught a
podcast deep-link that stranded a shimmer on a fetch error. Round 2: QA caught
that the round-1 per-kind fix collapsed the VIDEO cover (a bare video-row-cover
span is inline; `.book-row-cover` is the sole display:block source) - byte-
matched to the real cards. Both seats APPROVE. Dual-Node 7299/7299 on v22.23.1
AND v24.14.0. No browser in the build env -> the skeleton heights are derived
from the CSS cascade; Dean's cold-launch device probe is the final arbiter.

Device probes (cold PWA launch): the home grid does NOT jump down as the
Continue rows arrive (watch/listen/read); the hamburger + sidebar icons are
there instantly on iOS (no pop-in); a direct /subscriptions load with hidden
stars shows no star flash; open Settings / a pinned podcast -> no empty-then-fill.

### v1.156.1 - remove the A-Z scrubber rail (2026-08-20)

Dean device feedback on v1.156.0: the A-Z scrubber rail read as a fat column
floating in a gap beside the list, and on his 213-channel library it was taller
than the viewport so it scrolled away instead of staying pinned (the iOS
Contacts index it aimed for stays put). His call: remove it - the search box +
the A-Z section headers are the navigation. Deleted the #sub-scrubber element,
renderScrubber() + its ref/call, and the .sub-scrubber CSS; .sub-list-body is a
plain full-width block now (the list is its only child). The A-Z grouping +
search helpers stay (they build the sections). Slim gate (adversarial): APPROVE,
no findings; the deletion leaves no dangling ref and the list/search are intact.
Dual-Node 7273/7273 on v22.23.1 AND v24.14.0. Device pass: the list is full
width with no floating rail.

### v1.156.0 - Subscriptions redesign, part 2: the pills toolbar (2026-08-20)

The final act of the Subscriptions redesign. The Following/Add/Activity
master-detail MENU is replaced by the approved prototype's compact pills
toolbar over the always-visible A-Z channel list: [Check all][One-off]
[Activity][+ Add]. Check all is an action pill (unchanged re-pull-all wiring);
One-off / Activity / + Add open iOS slide-in panels (the same .sub-sheet
push-in the per-channel settings panel uses, so desktop = mobile with no
two-rail fork, Dean Q3). The 5 power-user maintenance buttons moved into the
Activity panel under a Maintenance subsection (Dean Q3); history + failures
mount there too. The "Hide subscriptions" collapse toggle is gone (Dean Q1) -
search + A-Z replace it, and its removal also fixes the v1.155.1 residual where
the A-Z rail floated in empty space while the list was collapsed.

Built as OPTION B (a fresh pills+panel controller; stopped calling
wireMasterDetail for this page) per a codebase investigation: the shared
master-detail component has no programmatic open-a-group API and forcing
desktop=mobile under it would fork shared CSS. Setup/Stats keep master-detail
untouched. The HTML restructure (moving forms + maintenance into panels while
preserving every id) was done via a verified Python transform.

FULL two-reviewer gate. Both seats REQUEST-CHANGES/APPROVE arc: QA an Esc-
layering papercut (with the Preview modal open over the Activity panel, Esc
closed the panel underneath) + a call for behavioral controller coverage;
adversarial two WARNINGs, both coverage gaps on provably-correct code but on the
repo's two most-struck classes (presence-not-binding: the panel controller's
`sub-panel-<key>` id concat shipped green under mutation; and [hidden]-loses:
the hidden-at-rest CSS guard was unbound). Fix round: a jsdom behavioral test
that mounts the real view and drives the controller (mutation-verified - the id
concat, the backdrop guard, and the CSS guard mutants all go red), the Esc
layering fix, and a source-lock on the CSS guard. Both seats then APPROVE.
Dual-Node 7273/7273 on v22.23.1 AND v24.14.0.

Process note (honest): a reviewer subagent left the shared checkout on `main`
after its run (the v1.80/v1.82 detached-HEAD scar); caught by the pre-release
branch==HEAD check before dual-Node, restored, no work lost.

Known gap: T4 (this view's cold-launch crispness) folded into Dean's separate
full-shell crispness sweep. Device pass PENDING - probe: the four pills; each
panel slides in with a back arrow; Activity holds history/failures/maintenance;
Check all still runs; no floating A-Z rail; desktop shows the same pills+panels.

### v1.155.1 - hotfix: the collapse toggle crushed the channel list (2026-08-20)

Dean's device (213 subscriptions): every channel name in the new list wrapped
ONE LETTER PER LINE. Root-caused in code, not theory: `mountCollapseToggle`
inserts the "Hide subscriptions" toggle `beforebegin` the list container, and
v1.155 (T1) had wrapped that container in a `.sub-list-body` FLEX ROW (list +
A-Z scrubber). So the toggle landed INSIDE that row as a flex sibling of the
list, stealing its width; with the list's `min-width:0` it shrank below content
and the rows wrapped catastrophically. A regression this exact wave introduced.

Fix: `chooseCollapseToggleAnchor(listContainer)` returns the `.sub-list-body`
wrapper (via `closest`), so the toggle inserts ABOVE the whole row, never as a
flex sibling. Falls back to the list itself on an un-wrapped shell. Extracted to
module scope + exported; a jsdom test binds the anchor choice + the insertion
outcome, and (after the slim gate's SUGGESTION) a comment-stripped tripwire
binds the caller too - the first cut was porous (matched the helper's own
definition), which mutation-testing caught. Diff is subscriptions.js + tests
only; no CSS/markup change, so no new layout risk.

Slim gate (adversarial): APPROVE, no CRITICAL/WARNING - all three anchor mutants
confirmed red, the single `.sub-list-body` verified as the list's direct parent.
Dual-Node 7270/7270 on v22.23.1 AND v24.14.0. No browser in the build env, so
Dean's device is the visual arbiter. Device pass: the channel names render on
one line at full width again.

### v1.155.0 - Subscriptions redesign, part 1: scale + iOS panels (2026-08-20)

The first half of the Subscriptions redesign Dean approved via prototype, split
on his call to ship the scale fix now and device-validate before the bigger
navigation change. Answers his question: "how do we deal with 200+
subscriptions - it'd be a lot of scrolling to get to that bottom set?"

T1 - the channel list: a flat row list became iOS-Contacts-style A-Z sections
with a pointer-only A-Z scrubber rail (jump to a letter) and a live search box
that filters by channel name OR handle/URL on every keystroke. Manual
drag-to-reorder was removed with the alphabetical list (Dean's Q2); the server
`order` field + `POST /api/subscriptions/reorder` route are left intact but
client-unused (a disclosed residual). The ~2.5s status poll's in-place row
updater now keys off a queried `data-sub-id` map instead of flat child index,
so section nesting is transparent to it (the FR-1 no-re-render invariant holds).

T2 - the per-channel settings: the bottom sheet became an iOS push-in PANEL
(slides in from the right, full-height) with a nav-bar header - back chevron
pinned left, channel name centered as the title - and the avatar + subscribed
date in a centered hero below it. Every field + the save/pause/repull/delete
PATCH wiring is byte-for-byte unchanged (mutation-verified). Tapping a channel
row now opens its settings (the iOS list idiom), for every row; whole-row
playlist navigation moved onto the row's own "View as Playlist" link.

FULL two-reviewer gate. Adversarial: APPROVE (every named surface
mutation-verified - the poll-vs-sections row map, the row-tap guard both axes,
the unchanged save patch, no dangling reorder ref, the pure helpers, the
comment-porous lock, CSS/reduced-motion; tree restored byte-identical). QA:
one WARNING -> fix round -> APPROVE: dropping the reorder functions had left
three comments describing them as live (the lying-comment class), the worst a
test title that could have led a maintainer to delete `data-sub-id` and
silently break the status poll; all three repointed. Dual-Node 7266/7266 on
v22.23.1 AND v24.14.0.

Known gaps (DISCLOSED): this is T1+T2 only. T3 (the prototype's pinned toolbar
pills - Check all / One-off / Activity / + Add - replacing today's Following/
Add/Activity master-detail menu, plus moving the 5 maintenance buttons into
Activity) and T4 (this view's cold-launch crispness) are DEFERRED to v1.156, so
v1.155 still shows the current menu with the new list inside it. Sticky A-Z
section headers are a follow-up (they need the fixed-header offset measured, not
guessed). Device pass: search filters instantly on a large library; the A-Z
scrubber jumps; tap a channel -> settings slide in with centered title + back
arrow that slides back; Save/Pause/Repull/Delete still work; a download in
progress keeps updating while you search/scroll.

### v1.154.0 - iOS nav-bar detail header (2026-08-20)

Dean device feedback: inside a menu section, the detail header's title sat left,
jammed against the back button - "it just doesn't feel right." Reworked it to an
iOS nav-bar on phone: the back chevron is pinned to the left edge, the title is
CENTERED, with a hairline under it (matches his iOS 26 About/General reference).
The back label is dropped (iOS 26's back is a bare chevron; the page name lives
in the menu's header box), and the button gains an aria-label so the bare
chevron still has an accessible name. No per-sub-page explainer box - Dean agreed
that would be overkill inside a section. Desktop is unchanged (no back button
there, so the header stays a left-aligned pane heading).

Slim gate (adversarial) -> APPROVE; source-locked (phone centered + pinned back,
desktop left) and mutation-verified; its two suggestions (the aria-label + the
--size-touch token) folded in. Dual-Node 7266/7266 on v22.23.1 AND v24.14.0.
Device pass: the centered title + pinned chevron on the sub-pages (watch a long
title vs the chevron). Next up (Dean's asks): a full cold-launch crispness /
shimmer sweep, and a fresh Subscriptions-page prototype.

### v1.153.1 - Settings header width + You-menu Subscriptions (2026-08-20)

Dean's device pass on v1.153 (the You -> Settings mini-player fix CONFIRMED
working on his phone - the screenshot shows playback continuing on the Settings
page). Two follow-ups:

- **The per-page header box was narrower than the section rows on mobile.** It
  carried a 16px horizontal margin ON TOP of `.main-content`'s own 16px padding,
  so it sat 32px in while the rows sat at 16px. Dropped the horizontal margin so
  the box lines up with the rows; on desktop it is constrained to the track's
  width and centred, so header and rail+pane share the same left/right.
- **The You-menu Subscriptions row was missing** - exactly the disclosed
  cold-cache race (the account menu builds once, and on a session's first load
  the enable signal lands after it). Now the subscriptions nav-injection (which
  runs when the module confirms) also patches the built menu, inserting the row
  after Stats; it inherits the menu's in-app SPA navigation, and the revoke path
  removes it too. The build-time gate still covers the warm-cache path.

Slim gate (adversarial) -> APPROVE; the fixes are mutation-bound (idempotent
row, guards un-bypassable, revoke-path-scoped removal). Dual-Node 7264/7264 on
v22.23.1 AND v24.14.0, 0 fail. Accepted residual (tech-debt): the revoke
reconcile branch's DOM removals (sidebar/bottom-nav/account-menu) are not
jsdom-bound - a pre-existing gap, see docs/exec-plans/tech-debt-tracker.md.

### v1.153.0 - Settings menu polish + the You-menu mini-player fix (2026-08-20)

On-device feedback on the v1.152 master-detail menus (Dean, same day):

- **The mini-player bug (his screen recording cracked it).** Tapping **You ->
  Settings** on mobile stopped playback. Root cause (confirmed from the
  recording + code, not theorised): the account-menu dropdown has a
  `click -> stopPropagation` (so an in-menu Theme toggle does not close it),
  which ALSO starves the document-level SPA router of the quick-link anchor
  clicks - so they fell through to a FULL page reload that tore down the docked
  mini-player. The sidebar worked because it is not inside that container. Fix:
  the menu's own click handler now drives the router explicitly for a
  same-origin known-route anchor (close menu + in-app navigate), mirroring the
  interception guards, so ALL the quick links (Liked / History / Stats /
  Subscriptions / Settings) keep playback alive.
- **Per-page header box (reusable).** Each menu page (Settings / Stats /
  Subscriptions) opens with an iOS-Settings-style header: a large icon tile, the
  page title, and a one-line description, then the grouped list. It is
  data-driven - a NEW settings page gets one by declaring
  `data-md-title/-desc/-hero-icon`, no code. Uniform height across pages.
- **"Library settings" -> "Settings"** everywhere (sidebar, page header, back
  label, body copy). No em dashes in the new copy.
- **Stats + Subscriptions in the "You" account menu** so mobile (where the
  sidebar is a drawer) can reach them without rotating. Subscriptions shows only
  when the yt-dlp module is enabled.
- **Desktop rail "shift up on click" fix.** Pinned the category rail as an
  independently-scrolling box so its height cannot couple to the detail pane.

What the gate caught (FULL gate, both seats, 1 fix round -> both APPROVE): the
header-box title/desc escaping was correct but UNBOUND by test (added a payload
test); the account-menu Subscriptions row can miss on a session's FIRST load
(cold capability cache races the menu build) - DISCLOSED below; plus a lying
comment I had introduced (the "delegated router intercepts these" claim - the
`stopPropagation` starves it) which the recording then disproved and the fix
corrected. Notably the QA seat had earlier signed off that same comment from a
pure code-trace: the lesson is that "does the delegated handler RECEIVE this
event" is a distinct question from "does it route this path" - an upstream
`stopPropagation` invalidates the former.

DISCLOSED, PENDING DEAN'S DEVICE PASS:
- The **desktop rail-shift fix is an unreproduced hypothesis** (no browser in
  the build env); if it persists, re-root-cause from a recording.
- The **You-menu Subscriptions row can be absent on a session's very first app
  load** (the capability cache is cold, so the enable signal can land after the
  menu is built); it appears on the next load, and the sidebar exposes
  Subscriptions meanwhile.
- The header box + rail visual rendering are Dean's device pass.

Dual-Node: 7263/7263 on v22.23.1 AND v24.14.0, 0 fail on both, sequential.
Device probe: play something -> You -> Settings keeps playing; the per-page
header boxes; Stats/Subscriptions reachable from the You menu; the desktop rail
no longer shifting on click.

### v1.152.0 - the master-detail menus (2026-08-19)

Item 2 of the menus wave. Settings / Stats / Subscriptions dropped the
per-section `<details>` accordion (expand one, the page reflows, you lose your
place) for an iOS-Settings **master-detail** menu: a grouped list of sections,
each with a material-specific icon on a tinted tile, that opens ONE section at
a time - on phones a menu that pushes into the section with a back button, on
desktop a category rail beside a detail pane (living to the right of the
existing folder sidebar). The palette is tight - FileTube red plus two neutrals,
assigned per GROUP so colour tells you the group and the icon shape tells you
the row - and the **Appearance** tile is era-reactive: its badge tint + corner
shift with the active era skin (2005 -> 2021). Design was iterated to Dean's
sign-off via a clickable prototype ("Love it").

One reusable component (`wireMasterDetail`) consumes the SAME
`<details data-collapse-key>` sections the accordion used, via a `.md-root`
wrapper + additive `data-md-icon`/`data-md-group` attrs - minimal markup churn.
Admin-only sections (Users / Backup / Downloads) still ship hidden and are
revealed asynchronously for admins; the menu is built from visible sections
only, so a restricted user never sees an admin row, and a MutationObserver adds
the rows when they're revealed. Subscriptions' dynamic history/failures cards
are adopted into the menu when they load. The retired `wireCollapsibleSections`
was removed.

What the FULL gate caught (both seats, 1 fix round -> both APPROVE): (a) the
10 new design tokens were census-clean but NOT value-pinned in the token
value-authority - a later edit could silently drift a tile tint; now pinned
byte-exact. (b) Stats' "Keyboard shortcuts" section is `display:none` on phones
(Dean's directive), but the new menu ROW showed on phone and could open it -
the hide now propagates to the row + its pane. (c) the dynamic-card dedup guard
(the repo's most-repeated bug class) was correct but unbound by test - now
locked (removing it duplicates rows -> red). The privacy-critical admin-row
leak surface was mutation-bound and held.

DISCLOSED - Dean's DEVICE PASS is the VISUAL arbiter: the build environment had
no browser, so structure + behaviour + gating are gate-verified but the actual
rendering was not. Probe on-device: the phone menu->detail push-in + back; the
desktop two-rail (folder sidebar + category rail + pane) not cramped; the era
Appearance tile shifting with the skin; each section keeping its `.setup-box`
card chrome inside the pane (a cleaner "content directly in the pane" look is a
quick CSS hotfix if you prefer the prototype's exact framing); and whether
Subscriptions' uniform master-detail (one extra tap for its short list, your
call) still feels right.

Dual-Node: 7257/7257 on v22.23.1 AND v24.14.0, 0 fail on both, sequential.

### v1.151.0 - Stats keeps the mini-player playing (2026-08-19)

Dean's report: selecting Stats while something is playing STOPS it. Root
cause (traced, not theorised): `/stats.html` was the ONE shell nav
destination `deriveRouteView` returned null for, so a click fell through
to a full browser page load - which unloads the whole document, including
the persistent `#player-host` that lives OUTSIDE `#view-root`, so playback
stopped. It was never a teardown bug; Stats simply wasn't a route. Fix:
Stats now follows the setup.js/books.js routed-view contract - a lazy
`/js/stats.js` (VIEW_SCRIPT_SRC), `registerView('stats', { init, destroy })`,
a per-view AbortController that cancels the two `/api/*` fetches on
navigate-away, and the old DOMContentLoaded self-boot dropped (bootRouter
now drives init on standalone loads too, so keeping it would double-init).
An audit net now fails if ANY future sidebar/bottom-nav link would
full-reload. This is Item 1 of a two-release wave; Item 2 (the
master-detail menu redesign) follows as v1.152.

What the gate caught (FULL gate, both seats, 1 fix round -> both APPROVE):
a real regression I missed - making Stats a route made bootRouter run the
nav-HIGHLIGHT pass on it, and because `activeNavItem` had no stats case it
STRIPPED stats.html's server-rendered `active` class and lit nothing, so
Stats would have shown with no lit rail item on every entry path. Fixed
(`activeNavItem` + `SIDEBAR_HREF_BY_NAV_KEY` gain a stats entry) and locked
with a "every static sidebar link lights itself" net. The gate also caught
THREE lying comments - one authored this very wave (a comment describing a
DOMContentLoaded boot the same wave had just deleted) - plus the exec plan
still prescribing the double-init approach; all corrected. The named
critical attack surfaces (double/missed-init, AbortController
presence-not-binding, vacuous audit net) held under the adversarial seat's
mutation testing.

DISCLOSED: the end-to-end "navigate reaches swapToView instead of a full
reload" wiring has unit-level coverage (deriveRouteView + the nav nets),
not an integration/browser test - this repo has no jsdom router harness,
so Dean's device pass is the arbiter of the actual smooth-no-reload swap.

Dual-Node: 7246/7246 on v22.23.1 AND v24.14.0, 0 fail on both, sequential.
Device pass = Dean: play something, tap Stats -> it keeps playing as the
mini-player AND the Stats rail item is lit; then tap back to watch -> it
re-expands to full.

### v1.150.0 - the mobile search toolbar strip + the clear X (2026-08-19)

Dean's device report on v1.149: the scope toggle "adds a third row" on
phones (it carried no mobile order/flex rules, so it fell into the
v1.45/v1.50 toolbar's zero-slack row-1 budget and orphaned - the
v1.50.4 class, restruck). On SEARCH views only, the mobile toolbar now
collapses into ONE horizontally scrollable strip (the chip-row recipe:
full-size buttons, nothing wraps, hidden scrollbar, the scope toggle
leading); every non-search view keeps the hard-won two-row contract
byte-identical, desktop untouched. Plus his second ask: a clear X in
the search box, between the input and the Search button, on every
shell - visible only while the box carries text, one tap clears and
refocuses (select-all + delete was the friction), never navigates,
never closes the mobile search reveal.

What the gate caught (slim/adversarial, 1 fix round -> APPROVE): the
strip's overflow made the toolbar a SCROLL CONTAINER, and the sort
dropdown's below-row menu - an absolutely-positioned descendant - was
clipped inside it with both scrollbars hidden: sorting search results
on mobile, working in v1.149, would have been broken by the very wave
fixing that toolbar. Fixed with a menu-open overflow escape, locked
down to the both-axes shorthand (the subtly-wrong one-axis version
reds). Two of this wave's own censuses also fired mid-build: the
era-scrollbar engine-partition census (an unguarded scrollbar-width)
and a first draft of the clear-X helpers landing inside the document
guard where the exports could not see them - both disclosed in the
commit bodies.

DISCLOSED: (a) cosmetic residual - opening the sort menu resets the
strip's scroll position on close (the overflow flip discards
scrollLeft; the sort button must be on-screen to be tapped, so the
snap-back is harmless); (b) the strip recipe lesson: copying a
container recipe means walking the NEW container's children - the
popout child was the one nobody enumerated.

Dual-Node: 7233/7233 on v22.23.1 AND v24.14.0, 0 fail on both,
sequential. Device pass = Dean: phone search view shows ONE scrollable
toolbar row (scope toggle first), sort menu opens over it, and the X
clears the box everywhere.

### v1.149.0 - channel-aware search + the scope filter (2026-08-19)

Dean: searching a channel name should find that channel's videos. It
only worked when the on-disk folder happened to share the name - the
one search matcher checked title + folder, so the healed per-item
channel names (v1.112+) and the v1.126 folder DISPLAY names were
invisible to search. The default match is now a strict SUPERSET (title
+ folder + folder display name + channel name; existing searches only
gain results), and search views grow a third toolbar toggle -
All | Titles | Channels - the YouTube-style scope filter, FileTube-
native (Channels returns the matching channels' items). Reuses the
format/watch toggle machinery and classes wholesale: zero new CSS,
token census untouched, every non-search view byte-identical.
Deliberately unpersisted (each new search starts on All; ?searchIn=
deep links work and stay shareable). Server-side narrowing keeps
pagination honest; junk searchIn falls back to All.

What the gate caught (slim/adversarial, 1 fix round -> APPROVE): the
scope did not ride the watch page's Prev/Next/autoplay list context -
the exact v1.88 class (a Channels-scoped grid could Next onto a
title-only hit the grid never showed); now threaded and bound. Plus a
surviving deep-link mutant (the ?searchIn= init was correct but
unbound), a non-string channelName guard bound as behavior, and the
scope toggle excluded from the hand-crafted liked+search corner where
it would have been a visible no-op. RBAC measured unchanged: a
restricted member searching a hidden channel by ANY field in ANY scope
gets nothing, items and total both.

DISCLOSED: (a) case folding is toLowerCase (matches the pre-existing
search semantics; exotic unicode case pairs may not fold - unchanged
behavior, wider fields); (b) the regex source locks on main.js remain
porous in principle (#163 class) - the seat's real mutants all red
against them today.

Dual-Node: 7225/7225 on v22.23.1 AND v24.14.0, 0 fail on both,
sequential. Device pass = Dean: search a channel name that lives in a
differently-named folder; flip Titles/Channels; Prev/Next from a
Channels-scoped result.

### v1.148.0 - release integrity + dependency automation (2026-08-18)

Dean's "what's not first class about this repo" question, items 1 and 3,
full-gate by his explicit ruling. The publish pipeline now BUILDS ONCE,
smoke-tests that exact image (fresh data volume; the measured first-run
contract: /login follows to /welcome at 200, unauthenticated /api/stats
refuses with 401; failure dumps container logs and blocks the push), and
promotes THE SAME LOCAL IMAGE by identity to every tag - the shipped
artifact IS the tested artifact, with the image id + digests in each
run's summary. A workflow_dispatch DRY-RUN runs the whole pipeline with
push-side steps skipped (required validation after any pipeline edit).
Dependencies: the wave's own baseline measurement found 4 standing
advisories (1 low runtime-transitive, 3 high dev-transitives) that the
repo had no instrument to see - healed with lockfile-only bumps, and
now guarded by a fail-closed audit gate in CI AND on the release path
(high/critical fail; docs/audit-exceptions.json is the empty-by-default
reviewed escape hatch) plus weekly Dependabot PRs (npm grouped
minor+patch, the docker base image, github-actions; never auto-merged).

What the gate caught (FULL two-seat gate, 1 fix round -> both APPROVE):
QA - a FALSE fixture-provenance comment (the test claimed its
chain-reference entry came from the captured real audit document; that
entry was modeled, not captured - the lying-comment class, caught and
rewritten honestly; the false claim also stands in the T2 commit
message, disclosed here since history is immutable) and the audit gate
missing from the RELEASE path (tag pushes skip ci.yml - the exact gap
v1.123 closed for tests/secret-scan, now mirrored the same way).
Adversarial - FOUR surviving mutants against the pipeline lock test
(a smoke failure that did not exit, a raw rebuild between smoke and
push, a quoted push: smuggle, an inline-comment spelling escape - all
now bound red) and the audit CLI's exit code (the gate's actual
product) bound by no test (now spawn-level tested through a shimmed
npm), plus an unwalkable-via fail-open hardened closed.

DISCLOSED (the honest list): (a) the old buildx push attached default
provenance attestations; classic docker-push promotion publishes a
plain manifest, so provenance quietly stops shipping - consistent with
tech-debt #154(c) (supply-chain signing) remaining deferred, now stated
rather than silent; (b) an upstream advisory can red all CI overnight
with zero local changes - accepted at intake ("part of the game"); the
exceptions file is the reviewed escape hatch; (c) the dry-run shares
the branch-push concurrency lane with edge publishes (one pending slot;
edge self-heals on the next main push); (d) regex source locks on the
workflows remain porous to hostile dead-spelling smuggles (the #157
blocklist class) - the dispatch dry-run is the behavioral backstop for
the paths it reaches, and the push-side paths are bound by the hardened
locks only; (e) the smoke asserts boots-serves-refuses (terminal 200 +
401), not the /welcome hop specifically - a future pre-seeded-users
image stays green by design; (f) T1's commit said "diff is
package-lock.json only" - the commit also carried the exec plan,
disclosed a paragraph above it in the same message; phrasing, not
substance; (g) the T1 lockfile sync also re-synced the lockfile's
engines stanza to package.json's (benign, inside the counted 13/13).

Dual-Node: 7209/7209 on v22.23.1 AND v24.14.0, 0 fail on both,
sequential. No device pass needed (nothing user-facing changes); the
release-time proof is the dispatch dry-run before this very tag plus
the tag publish itself running the new pipeline.

### v1.147.0 - bigger card-corner controls on mobile (2026-08-18)

Dean: the corner action icons on cards (share/queue/delete/download/
like/reheat) were a hard press on a phone. Two levers, both mobile-only
and scoped to exactly those six so desktop stays byte-identical and no
token value changes: the glyphs grow 14px -> 18px (+30%, the scrim pill
grows with them), and an invisible inset ::after extends each button's
tap box to the 44px touch guideline. Phone LIST view scopes the vertical
extension down (thumbs are ~68px tall there - the full extension made
the bottom-left zone shadow the top-left pill's bottom edge, a silent
wrong-action tap the gate caught before it shipped). The emoji icon
set's delete/download glyphs keep their auto sizing (no empty 18px box;
they simply keep their pre-wave look under that icon set).

What the gate caught (slim/adversarial, 1 fix round -> APPROVE): the
list-view zone-shadowing mis-tap above; the lock's brace-walker was
comment-porous (5th strike of the class - a media-query spelling inside
comment prose opened a bogus range that let a trailing DESKTOP 18px rule
ship green, breaching the wave's own "without altering anything else"
contract); and per-button bindings were presence-only (a same-block
override re-shrinking one button survived). All killed and re-verified
by the seat's own mutants.

DISCLOSED: (a) tech-debt #163 - the hardened lock's anchored matching is
prefix-porous (three measured escape spellings; honest closure is an
allowlist + substring net on the next touch); (b) the two invisible tap
zones in list view still share a 0.5px hairline band (no visible pill is
ever covered); (c) under the emoji icon set, delete/download get no size
bump (auto-sized glyphs, disclosed above); (d) post-ceremony: the FIRST
v1.147.0 tag push was REFUSED by the pre-push hook - two v1.146 boot
tests were latently NETWORK-dependent (a mid-test engine reset also
cleared the fake-PyPI fetch, falling through to live pypi.org; they
passed for a day only while the live latest nightly coincidentally
equaled the fixture's self-report, and went red the moment yt-dlp
published the next nightly). Fixed before the tag ever reached the
remote (re-arm the fake after every reset + a global-fetch tripwire
whose out-of-band afterEach assertion fails ANY fallthrough's own test
with the mechanism named - the gate caught the first tripwire draft
being swallowed mute by a defensive try), which also means every earlier
green run of those two tests had silently depended on live PyPI - the
dual-Node counts below are the POST-fix re-runs. The v1.146.0 tag's
tree retains the latent (test-only) flake; published tags are never
re-pointed, and the app itself is unaffected.

Dual-Node (post-network-fix re-runs): 7183/7183 on v22.23.1 AND
v24.14.0, 0 fail on both, sequential. Device pass = Dean's pull; probe
the corner taps in BOTH grid and list view on the phone.

### v1.146.0 - the downloader engine selector (2026-08-18)

Dean's ruling (2026-08-18) overturned the Dockerfile's locked decision D5:
FileTube now has a RUNTIME downloader-engine selector. Setup gains a
"Downloads" box (admin-only; the page had no such section, so the ruling
created one) whose "Downloader engine" section shows the bundled engine,
the latest stable, and the latest nightly side by side (live PyPI
metadata; offline shows bundled and never blocks boot) and pins the
ACTIVE engine to any of the three. Stable/nightly install into a
persistent venv under the data dir via pip (exact charset-validated pins,
no shell anywhere, PyPI host pinned + size-capped); every install must
pass a health probe before activation, and a venv engine that fails at
runtime (spawn-level, or an import-time ModuleNotFoundError/ImportError/
SyntaxError crash) auto-reverts to the bundled binary - which is never
removed - with an admin-only bell. Auto-update is a daily opt-in
checkbox, DEFAULT OFF, over a 24h ledger that survives restarts; "Update
now" is always available. The channel intent survives reverts, and
unattended triggers (daily tick, boot recovery) never reinstall the
exact build that was reverted (the anti-flap guard). About/Stats reports
the ACTIVE engine as "version (channel)". The supply-chain trade
(runtime pip executes what yt-dlp publishes to PyPI; the bundled default
preserves the old posture) is disclosed in README + docs/CONFIGURATION.md.

What the gate caught (FULL two-seat gate, 2 fix rounds -> both APPROVE):
QA - a channel switch during a pending install could half-apply forever
(now refused whole + a boot heal), status surfaces claiming a venv whose
binary was gone (effective-active derivation + synchronous boot repair),
backup export downgrading engine bells to a member-visible kind, and a
falsified count prediction in the committed exec plan. Adversarial -
three full-suite-surviving mutants on the wave's own claims (the FIFO
gate wiring, the startBackground wiring, and - round 2 - a fix of mine
that neither awaited nor forced: the "forced" version-cache refresh
never beat its 6h TTL, so About could label the OLD engine's version
with the NEW channel; all three now mutation-bound), a MEASURED false
auto-revert from ungated probes racing a mid-rewrite venv (closed with
an install-phase suppression window), and the SyntaxError engine-death
shape the failure net originally missed.

DISCLOSED (the honest list): (a) the runtime failure net is deliberately
NARROW - AttributeError/TypeError tracebacks stay download failures (the
thrash surface), so an engine broken ONLY in that shape waits for the
daily check or a manual update instead of auto-reverting; (b) engine
bells ride the existing bell feature gate (yt-dlp on + at least one
subscription + bell enabled) and do not web-push; (c) Alpine's
venv/ensurepip behavior is unverified on the dev box (no docker) - the
install chain has a fallback ladder and Dean's on-device channel switch
is the empirical check; (d) tech-debt #162: the combined-body 409
atomicity is untested (the shipped UI only sends single-key bodies);
(e) the Setup box reuses the page's existing inline-style pattern.

Dual-Node: 7177/7177 on v22.23.1 AND v24.14.0, 0 fail on both,
sequential. Device pass = Dean's pull + the probe list in the report.

### v1.145.0 - yt-dlp nightly channel + the JS-runtime opt-in (2026-08-18)

Dean's live outage: downloads failing through three distinct signatures
in one evening - data-phase 403s on ~every channel (cleared on-device by
a cookies file, FILETUBE_YTDLP_COOKIES_FILE), then "Requested format is
not available" from the cookie'd web client, then "The page needs to be
reloaded" from a TV-client override. The stable yt-dlp (2026.7.4) is the
NEWEST stable that exists and is six weeks behind YouTube's enforcement
changes; no env var fixes a too-old binary. Shipped: (1) the Dockerfile
pin moves to yt-dlp's NIGHTLY channel (exact pin 2026.8.17.73947.dev0 -
reproducible builds preserved, only the channel changed; install of the
exact wheel verified locally); (2) the gate's discovery taken as code -
yt-dlp deprecated running without a JavaScript runtime ("some formats
may be missing", the signature-2 shape) and only auto-enables deno,
while the image ships node: new FILETUBE_YTDLP_JS_RUNTIMES (validated
like the player-client lever, split into repeated flags because yt-dlp
never comma-splits the value - the gate measured the comma'd form
silently degrading to NO runtime), defaulted to `node` by the image ENV,
unset on bare metal so older binaries never see the flag.

What the gate caught (slim/adversarial, 2 fix rounds -> APPROVE): the
JS-runtime deprecation itself (round 1, taken as code); the comma'd
multi-runtime form my comment and tests certified was INERT upstream
(round 2, measured against the real binary); a stale version-bearing
comment; an overconfident "already fixed in nightly" claim softened to
"believed - Dean's device pass is the verification."

DISCLOSED (the honest list): (a) nightlies can regress - rollback is
re-pinning the ARG (PyPI retains every nightly) and re-releasing;
(b) commit a8ae1ad's message misstates that CI's qualify job exercises
the image build - nothing builds the Dockerfile before the tag-push
publish step (failure direction verified safe: a broken pin fails the
build before anything is pushed); (c) commit b70d7b8's message says
"7073/7073" where the run printed 7072 - the 6th and 7th
measure-then-claim strikes in two commits (the 7th also violated the
v1.139 structural rule by chaining measurement and commit); this
release's numbers were read from standalone runs; (d) About/Stats shows
the binary's normalized self-report (2026.08.17.073947, no .dev0 - same
release, different spelling); (e) the JS-runtimes lever is
download-path-only (player-client parity) - if format failures persist
on-device, probe that lever FIRST, not another re-pin.

Dual-Node: 7072/7072 on v22.23.1 AND v24.14.0. Device pass = Dean's
morning pull; cookies stay on, the player-client override stays OFF.

### v1.144.1 - ledger census shallow-checkout hotfix (2026-08-17)

The v1.144.0 tag push went red in docker-publish's qualify job - the new
ledger census's phantom check flagged 293 entries, because its guard only
skipped a TAGLESS checkout while a TAG-push checkout is shallow WITH
exactly one tag (the ref being built). The publish gate correctly
blocked the v1.144.0 image; nothing broken shipped. Fix: the census now
skips on ANY shallow (or tagless) checkout via
`git rev-parse --is-shallow-repository` - a partial tag list can never
support a completeness census - with a diagnostic naming both signals.
Verified in a real depth-1 single-tag clone (old test reproduces the CI
red exactly; fixed test 7/7). The running-version + tone checks still
run in EVERY environment including the tag build; the full census runs
on every full clone (every dev-box hook run). Gate: slim (the same
seat), APPROVE - it measured all four environment arms, confirmed the
`--no-tags` full-clone arm still guards, and honestly scored its own
round-1 share of the miss (neither of us enumerated the qualify job's
tag-push checkout). Residual #161: the skip-guard's polarity is bound by
environment, not by a test - disclosed.

Dual-Node: 7068/7068 on v22.23.1 AND v24.14.0.

### v1.144.0 - the release ledger (2026-08-17)

Dean: releases should be "clearer into the intent organically",
retroactively, and the settings-menu version should click through to the
release's context. Shipped: docs/releases.json - user-language notes for
ALL 294 releases back to v1.0.0 (tiered: v1.31+ distilled from this
file's entries, earlier from merge subjects), machine-validated against
the tag list; a checker test that makes every future release commit
unable to ship without its note (presence, ordering, tag census, and a
jargon tripwire enforcing the pure-user-language ruling); an idempotent
CI publisher (release-notes.yml, deliberately separate from
docker-publish) that creates the GitHub Release for any ledger-bearing
tag on every tag push - the 294-release backfill is ONE manual
"Run workflow" click by Dean; and the account-menu version row is now a
link to the running build's release page. The engineering record
(ROADMAP, commits, tags) is untouched - the ledger is a new layer, not a
rewrite.

What the gate caught (slim/adversarial, 1 fix round -> APPROVE): a
CRITICAL - three ledger entries claimed victories the record refutes
(first-of-a-pair releases claiming the win their follow-up earned);
reworded as honest attempts. Also: the tone tripwire was already
escaped by two shipped titles (widened + reworded); the href-bounding
guard was deletable with a green suite (now bound by a hostile-version
case); the exec plan described a design that was deviated from
(recorded). The seat also caught a wrong test-count in MY delta message
(claimed 21/21, measured 18/18) - the measure-then-claim class's 5th
strike, recorded here per the honesty norm.

Dual-Node: 7068/7068 on v22.23.1 AND v24.14.0. Device pass PENDING
(plus Dean's one-click backfill dispatch).

### v1.143.0 - the home feed remembers your chip (2026-08-17)

Dean: pick Audio, close the app or refresh, and the feed should still be
on Audio "unless toggled off." The chip state was reborn as All on every
load - while its sibling one line below (the modern sort, v1.86.0) has
persisted per-device all along. This wave is that sibling's exact
mirror: the boot read goes through resolveModernChip (untrusted-storage
bounding: stale/invalid -> All), the chip click persists the resolved
pick, and choosing All persists the cleared state - the pill itself is
the toggle-off, so no extra checkbox/setting (Dean floated one at
intake; this recommendation shipped disclosed - say the word for the
opt-in variant).

What the gate caught (slim/adversarial, 3 tight rounds -> APPROVE): the
restored chip could FILTER correctly while PAINTING All as active (the
enabling-wire class - the mount-site hardcode survived the full suite);
a PRE-EXISTING v1.86 gap where nothing bound the chip to the fetch URL
at all (taken here rather than tech-debted); and in round 2 the seat
caught a gap in its own round-1 prescription - the builder ignoring its
parameter revived the same symptom one link deeper. All four links of
the state->paint chain are now individually locked. RESIDUAL (seat's
line, agreed): these are stripped-source locks, the accepted posture for
main.js DOM wiring - if a main.js DOM harness ever lands, this chip row
is the first candidate for behavioral conversion.

Dual-Node: 7057/7057 on v22.23.1 AND v24.14.0. Device pass PENDING.

### v1.142.0 - channel avatars for non-subscribed channels (2026-08-17)

Dean's report + on-device probe (channelId present, channelAvatarUrl
blank on a one-off download): a channel with a KNOWN `UC…` id but no
captured/validated channel URL was unprobeable - and at the capture
boundary, identity-DROPPED entirely - at every avatar populate point.
The id alone determines the canonical channel endpoint. Fix: one
pattern-gated pure helper (deriveChannelUrlFromId) wired through four
limbs - the capture boundary (a bare-id capture now keeps its identity;
hostile/junk URLs still never survive), the shared probe choke point
(refresh button + subscribe inherit it), the one-off download fold
(whose over-broad explicit-folder skip is also gone), and a NEW
automatic self-heal: every poll cycle's tail spends leftover
avatar-probe budget on channels known only from library items -
breaker-gated, freshness-gated, one attempt per channel per server run.
Dean's existing item heals within a poll cycle or two of deploying, no
button press needed; "Refresh channel avatars" covers it manually too.

What the gate caught (slim/adversarial, 1 fix round -> APPROVE): three
claimed protections were unverified-by-instrument - the refresh
batch's derive could be reverted with the FULL suite green, the sweep's
target filter had divergent-spelling survivors, and the breaker gate
was bound only by regex (a `breakerTripped = false;` insert survived
everything). All three now bound BEHAVIORALLY (route-driven batch test
from the seat's own repro; handle-URL-only sweep test; a real
tripped-breaker poll asserting zero probes). Security verified: no new
trust grant - the derived URL is a fixed template over the
already-trusted pattern-gated id; hostile bytes still cannot transit.

DISCLOSED (S1): a manual single-sub repull while a tripped breaker's
retry timer is armed still runs the item sweep with a fresh budget -
consistent with the subscription self-heal's own posture, memo-bounded.
KNOWN LIMIT: if the avatar PROBE itself fails on-device (yt-dlp/YouTube
drift), this wave makes the retry automatic and the failure visible in
the refresh batch's counts rather than fixing the probe - Dean's device
pass arbitrates which world we are in.

Dual-Node: 7050/7050 on v22.23.1 AND v24.14.0. Device pass PENDING.

### v1.141.1 - single-painter in real-fullscreen audio (2026-08-17)

Dean's device pass (both v1.140/v1.141 otherwise PASSED): a small strip
copy of the cover art near the top in fullscreen audio, gone when not
fullscreen. Root cause: the art paints TWICE in the expanded view - the
#audio-bg-art layer AND the media element's poster (the audio branch
hands the art to the <video> tag, stacked z1 over z0). Their contain-fit
boxes differ by the 52px bar clearance, so at exact-fullscreen
proportions the art copy's top edge peeked above the poster's paint. Fix:
visibility:hidden on the poster's paint, scoped to the three
API-fullscreen spellings ONLY (visibility never display - display:none
can pause media on iOS-family engines); the in-window expanded view
(mobile + the desktop refused-request degrade) keeps its exact pre-fix
paint, guard-locked.

What the gate caught (slim/adversarial, same seat as v1.141, 1 fix
round): the guard's rule-walk was @media-BLIND - an unscoped poster-hide
inside a media query shipped green (runnable evasion); the walk now
flattens media wrappers first. Tracked residual #160: non-visibility
hiders (opacity etc.) evade the guard by design - the #157/#158
blocklist-porosity class; real closure is a computed-style harness.

Dual-Node: 7028/7028 on v22.23.1 AND v24.14.0. Device pass PENDING (the
strip specifically).

### v1.141.0 - desktop audio fullscreen goes REAL (2026-08-17)

Dean: "if I go to full screen an audio thing, it doesn't actually full
screen" on desktop. Root cause: the v1.22.2 iPhone constraint (Safari
refuses requestFullscreen on non-video elements) had been applied to
EVERY platform - all audio routed to the CSS-only in-window expand. Now
an explicit desktop signal routes audio fullscreen to the REAL
Fullscreen API (the v1.138 never-moving stage) with the expanded
now-playing view rendered inside it: one press in, one press or ONE Esc
all the way out (either live surface drops both). Mobile byte-identical
(intake ruling 4). Rider fixes the wave required: enterFullscreen's
webkit video branch is a silent no-op on track-less elements and now
skips audio (desktop artless audio gains real fullscreen from the same
guard); a carried video advance no longer stamps the MOBILE faux class
over staged desktop fullscreen (which would have stranded the page in
faux after Esc); a staged+expanded CSS twin keeps the cover art's
bar-strip clearance (the v1.138 3-id restore rule out-specified it).

What the gate caught (slim/adversarial, 1 round APPROVE): S1 - the exit
half's promise-guard was unlocked (deleting the exitFullscreen .catch
survived the suite; lock extended, mutant re-killed); S2 disclosed
below. The seat independently re-derived and re-ran all 13 of my mutants
plus 9 of its own (8 killed).

DISCLOSED (S2, tech-debt #159): the expanded+staged -> video advance ->
audio advance round trip lands the second audio item BARE staged - real
fullscreen holds but the expanded view is lost (the staged video leg
carries no immersive class). Every exit works; same accepted cell as
v1.138's video->audio bare-stage look. On-device judgment is Dean's.

Dual-Node: 7027/7027 on v22.23.1 AND v24.14.0. Device pass PENDING.

### v1.140.0 - the skip chain: repeated tap-skips never pause (2026-08-17)

Dean's confirmed friction: tap #3 of a skip-skip-skip run started a
fresh classification cycle, landed as a single, and PAUSED. Now (the
YouTube convention): after any tap-skip, every tap landing while the
chain is hot (800ms, refreshed per skip) keeps skipping in the tapped
half's direction - no same-half pairing, no timing pairing - and
tap-to-pause stays suppressed until the chain cools. Serves BOTH tap
surfaces (video + audio cover art) via the shared classifier. SCOPE:
touch-only by design - desktop mouse keeps the click-pause/dblclick-skip
convention unchanged. Deliberately NOT built: slow-double "forgiveness"
(converting a late second tap into a skip would hand a genuine slow
pause-then-resume a surprise 15s seek); that row is locked as a design
decision.

What the gate caught (slim/adversarial, round 1 + a fresh-seat
confirmation round): W2 - a chain hot at a teardown/dock/close boundary
leaked onto the NEXT item (first tap skipped instead of paused; docked,
it ate the tap-to-expand tap while hiding a seek) - the chain now dies
with its surface; W1 - two silent-writer survivors forced a writer
census; then W-A - the census ITSELF was porous at divergent spellings
(a no-space respelling, a comment shadow - the repo's thrice-paid
comment-porous-lock class, and a seed relocated across the `} else {`
boundary its regex windows spanned) - rebuilt comment-blind,
spelling-tolerant, and brace-walk branch-scoped; 12 mutants (incl. a
dead-decoy dispatch replica) all killed against the final commits.

DISCLOSED (gate S-A, no code): a chain BORN on the docked surface (a
double-tap-skip while docked) eats a tap-to-expand tap for the next
800ms. It never crosses a boundary (the W2 ruling is intact) and is
arguably the feature working on that surface; on-device judgment is
Dean's - flagged in the probe list.

Dual-Node: 7015/7015 on v22.23.1 AND v24.14.0. Device pass PENDING.

### v1.139.0 - autoplay wraps a playlist back to the top (2026-08-16)

Dean, overturning the v1.30 no-wrap decision: with autoplay on, ending
the LAST item of a playlist/folder context advances back to the FIRST.
Rulings encoded pure: natural next always wins; single-item contexts
never wrap (the Loop toggle owns replay); a stale/deleted item never
teleports playback to someone else's list head; the QUEUE stays finite by
design. Gate-added guard: the wrap is COMPLETENESS-gated - a context past
the server's 10k list cap fetches a truncated prefix, and wrapping there
would loop the prefix forever while masking the truncation; those keep
the old visible stop.

OPEN RULING (disclosed, awaiting Dean): a wrap can land at the first
item's SAVED position from an earlier abandoned session (identical to
every autoplay advance since v1.24, self-healing after one playthrough) -
if "loops back to the beginning" should mean position 0 of video 1, say
so and the wrap gains a start-over hint. Also noted for device judgment:
the page's Next BUTTON still greys at the last item - autoplay wraps, the
button doesn't.

What the gate caught (slim/adversarial, 2 rounds): the truncation-mask
WARNING above; a derivation-source mutant of my own that survived the
first lock (completeness from the kind-FILTERED count would have silently
killed the wrap on mixed lists); plus the resolveEndedAction mirror-table
re-documentation verified truthful. Fourth strike of the measure-then-
claim class in a commit message (pre-claimed 7008, truth 7009) - caught
by self-check, amended, and the structural rule is now: measurement and
commit commands never share a chain.

Dual-Node: 7009/7009 on v22.23.1 AND v24.14.0.

### v1.138.0 - desktop fullscreen survives advances: the fullscreen stage (2026-08-16)

Dean: desktop fullscreen must survive autoplay/Next "just like iOS" -
v1.130's disclosed desktop gap, closed for real. Native fullscreen now
targets a never-moving shell-level #fs-stage with the player host
reparented INSIDE it: navigation can no longer force-exit fullscreen, so
advances just keep playing fullscreen. dock() no-ops while staged; every
mount (including the views' eager expand reparents) redirects to the
stage at the ONE helper; exit places the host by the current view's slot;
the fullscreen predicates know the staged shape.

What the FULL two-seat gate caught (QA + adversarial in isolated
worktrees, 1 fix round, both APPROVE) - three CRITICALs, two found
independently by both seats: (1) the views' eager expand() reparent was a
third mount seam the load-seam decisions missed - every staged autoplay
advance black-screened until re-mount (fixed at the helper, by
construction); (2) inNativeFullscreen was staged-blind - the fullscreen
button's EXIT half was broken (a one-way door), with the adversarial seat
also catching the null===null trap a naive fix would have introduced on
no-stage shells; (3) three :fullscreen CSS groups missed their staged
twins via the divergent spelling (#player-wrapper IS .player-container) -
bar-reserve strip, width-bound video, and the v1.124 caption occlusion
would all have regressed in staged fullscreen. Plus: the feature's
enabling wire was deletable with every test green (now bound), a false
machine-derived plan prediction (corrected), and a defensive
close-while-staged clear.

Known gaps (disclosed): Safari desktop and desktop-class iPads never
reach the staged branch (their video elements expose
webkitEnterFullscreen, which wins) - the v1.130 advance-exits-fullscreen
gap persists there unchanged. The staged-CSS completeness net exempts
bare-subject rules (tech-debt #158). The adversarial delta saw a 1-of-3
unattributed suite flake on its loaded worktree (#142 class); both
release dual-Node runs were clean.

SEPARATE OPEN QUESTION (Dean's report, pre-release): his Edge desktop may
not be reaching NATIVE fullscreen at all ("fullscreen in the tab") - the
classifier says Windows routes native, his eyes say otherwise. The
falsifying probe (taskbar visible? document.fullscreenElement in
console?) is on the device list; if faux is somehow winning there, that
is a second bug this wave does not touch.

Dual-Node: 7002/7002 on v22.23.1 AND v24.14.0.

### v1.137.0 - the iOS PWA lore reference (2026-08-16)

docs/references/pwa-ios-notes.md - everything the PWA audio-coupling arc
taught, captured with revisit triggers per section: the coupling evidence
timeline, the audioSession declare findings, lock/background behavior +
the sidecar quality tweak (future wave), the install-origin matrix, the
CC misroute, the native-shell assessment, and the assorted paid-for lore.

SUPERSESSION (gate S4, for the record): v1.136.0/.1's ROADMAP entries
describe the coupling as "REGISTRABLE-DOMAIN-scoped" - that hypothesis
was FALSIFIED the same day by the raw-IP install test (coupled
identically; Squoosh still didn't). The grouping criterion is UNKNOWN;
those entries stay as written (history), this line is the correction.
The player.js v1.136.1 comment carries the same stale phrase - rides the
next code wave.

What the gate caught (slim/adversarial, 3 rounds): two false SELF-claims
in a doc premised on verification (the header credited censuses with
coverage they don't have - mutation-proven; "each section ends with its
revisit trigger" false for 4 then 1 sections - the last one a python
replace that silently no-opped while my delta claimed it landed, the
claims-vs-tree class in a new costume; scripted doc edits now assert
match AND effect with independent post-state reads). Plus precision:
"months" that was one month, the ALAC-rendition nuance, the evidence
instrument documented.

Dual-Node: 6986/6986 on v22.23.1 AND v24.14.0.

### v1.136.1 - HOTFIX: audio-path declare demoted to a default-OFF toggle (2026-08-16)

Dean's same-day device test of v1.136.0 (iOS 26.6): WORSE - audio stopped
the moment he exited the app; a foregrounded same-domain sibling RESUMED
it; closing that stopped it again. The E2 experiment's honest result:
declaring the playback session at load makes backgrounded PWA audio MORE
eagerly suspended on 26.6 (the webkit.org/b/261554 class), and the
registrable-domain coupling operates in both directions. The audio-path
declare now sits behind the device-local toggle Dean originally approved
(Setup -> Playback, DEFAULT OFF = pre-v1.136 behavior byte-for-byte);
the v1.35 video arm is untouched and mutation-guarded against
over-demotion. Caveat for A/B tests: the video arm's one-way declaration
still stands within a page session - verify toggle-off music behavior in
a fresh session that didn't first arm a video.

Gate (same adversarial seat, round 3, APPROVE): default-off traced to
byte-identical pre-v1.136 behavior; N5 folded (the checkbox must store
the literal '1' the player checks - a 'true' drift left the experiment
silently dead while appearing configured). Dual-Node: 6986/6986 both.

### v1.136.0 - playback audio-session declaration for plain-audio items (2026-08-16)

The PWA audio-coupling deep dive's E2, reshaped by a code discovery:
navigator.audioSession.type='playback' (iOS's "I am a media app" signal)
has shipped since v1.35 - but only on the video background-audio arm path.
A music/podcast-only session never declared it and ran as the default
'auto' type, a credible suspect for background audio dying when iOS
rebalances audio (Dean's sibling-PWA-close symptom, now E1-diagnosed as
REGISTRABLE-DOMAIN-scoped coupling). One writer
(declarePlaybackAudioSession), two callers: the v1.35 video arm (gating
unchanged, now lock-windowed) and the plain-audio branch (the gap-close).
The ?debugLifecycle overlay gets one audioSession:declare line per page
load, always, so coupling repros carry evidence.

DEVIATION disclosed for Dean's ratification: E2 was approved as a new
toggle; shipped instead as unconditional on the audio path, matching the
v1.35 posture (the signal is already live unconditionally on video; audio
items have always background-played by design - gating them on the
unrelated video setting would be incoherent). Say the word and it becomes
a toggle.

What the gate caught (slim/adversarial, 2 rounds): my lock respell had
silently LOST the v1.35 ordering anchor (moving the video call above the
settings fetch - un-gating shipped behavior - stayed green; re-windowed);
the overlay's transition-only record could neither prove nor disprove
"declaration live during THIS repro" (30-entry persisted ring buffer; now
one line per load, always); a comment orphaned from its function; the
evidence flag's initializer unbound (N2, folded in). Disclosed: literal
count locks can't beat deliberate alias/wrapper evasion.

Dual-Node: 6986/6986 on v22.23.1 AND v24.14.0.

### v1.135.0 - architecture diagrams, checker-bound (2026-08-16)

Dean: "a diagram.md outlining the architecture visually - data model and
data flows module to module." New docs/DIAGRAMS.md: five Mermaid diagrams
(module map, data model, scan pipeline, watch/stream sequence, client SPA +
player state machine), rendered natively by GitHub. Checker-first per the
v1.129 discipline: test/unit/docs-diagrams-census.test.js live-derives from
lib/db/sqlite.js and the filesystem - named paths must exist, every
namespace/table must appear in the data-model diagram (boundary-delimited,
block-scoped), the stated counts must match the derivation, fences must
balance - so a rename turns the diagram red instead of letting it lie.
ARCHITECTURE.md links it and gets measured test counts; CLAUDE.md's map
gains the row.

The censuses earned their keep before AND during the gate: pre-gate they
caught two hand-count errors of mine and their own parser eating a comment
apostrophe; the gate (which built a real headless Mermaid parser and proved
all six blocks parse) caught the flagship watch/stream diagram lying about
the transcode fallback (truth: 503 + client poll; ?live=1 is a desktop-only
client choice), a caches node with three wrong directory names and a wrong
writer arrow, census porosity that let 11 of 53 names drop silently (now
1 disclosed residual: the `notifications` header-mask, named in the test),
and stale "measured" counts that excluded the wave's own additions.
Process: the blind-checkout scar struck AGAIN (mutants ran while the doc
carried uncommitted fix edits; caught by tree inspection, re-applied) - the
rule is now absolute: mutants never run against a file with uncommitted
edits, docs included.

Dual-Node: 6986/6986 on v22.23.1 AND v24.14.0.

### v1.134.0 - tap the video to play/pause (2026-08-16)

Dean: "I can't just tap in the middle and have it paused." Now a tap
anywhere on the picture toggles play/pause with the same fading glyph the
cover-art tap has had since v1.21 - unobtrusive, iOS-style. Rides the
existing gesture layer (the single-tap slot the video surface left empty
since v1.21), so double-tap ±15s skip and hold-to-2x are untouched; in
fullscreen with the bar hidden, the first tap reveals the controls without
pausing (the reveal-first convention), the next tap toggles.

What the gate caught - the headline save: a CRITICAL that would have
shipped "a reveal that pauses" to the device. One physical touch fires
BOTH pointerdown and touchstart, and the two invocations of the reveal
listener weren't idempotent - the first's reveal removed the class the
second's read keyed on, zeroing the consume stamp, so the tap that woke a
hidden fullscreen bar would ALSO have paused, on the feature's primary
flow, with every test green (the reviewer proved it with a runnable sim).
Fixed two-layered: single-event registration + a pure idempotent stamp
function whose double-fire sequence is now a behavioral test. Also: the
consume window's dwell arithmetic was wrong by the debounce (600 -> 1000);
a page scroll STARTING on the playing video would have paused it 350ms
after finger-lift (movement veto added - fixing the same latent trait the
audio art has had since v1.21); and three rounds of lock-porosity tennis
on the veto binding (move/add/move-below-brace variants all bound red now,
MOVE_TOL literal-locked). Runtime code unchanged after the first fix
round - the tennis was test-granularity, disclosed per the pacing norm.

Dual-Node: 6982/6982 on v22.23.1 AND v24.14.0.

### v1.133.0 - chapter-name wrap fix + Prev/Next in the player for video (2026-08-16)

Two from Dean's screenshot session. (1) A long chapter name shoved the
fullscreen button onto a clipped third bar row - a wrapping flex container
line-breaks on hypothetical (content) sizes before shrinking, and the
v1.112 mobile rule's basis:auto re-opened the v1.34.1 trap through that
one gap; short names fit, so it looked healed. Fixed with flex-basis 0 -
the label claims only leftover space, ellipsis truncates. Not tokens. (2)
The control bar's Prev/Next pair (audio-only since v1.73) now shows for
EVERY kind whenever neighbors are registered - video included, in faux
fullscreen especially (the whole point: the page's own buttons are
unreachable there). Page-level Previous/Next stay; both surfaces read the
same registration. Bonus (gate-found): the mobile order pins fix a
pre-existing prev|next|play mis-order on the music/podcasts expanded bar.

What the gate caught (slim/adversarial, 3 rounds): a divergent-spelling
mutant that silently re-hid the pair for video with the suite green
(net widened; residual blocklist limitation tracked as tech-debt #157);
three lying comments including a consult-timing claim of mine that
overstated surface agreement; narrow-window row arithmetic (volume slider
now shrinkable); the reader reset-list contract; AND - the honesty line -
a fix-round commit whose message claimed comment fixes its tree did not
contain (my mutant-cycle blind checkout ate the uncommitted edits; the
gate's tree-vs-claims diff caught it; re-committed for real, scar named
in the history).

Dual-Node: 6971/6971 on v22.23.1 AND v24.14.0.

### v1.132.0 - resume prompt auto-fires its default after a countdown (2026-08-16)

Dean: while driving or heads-down, the "Resume at..." prompt's forced
interaction is friction. The prompt's default button now ticks down 5
seconds ("Resume · 4" + a thin draining underline) and fires its OWN click
if you don't choose; any tap or keypress on the player cancels the
countdown and leaves the prompt up. Configurable in Setup -> Playback
(device-local, like the resume threshold): on/off (default ON; off =
exactly the old prompt) and the default action (resume from saved position
[default] vs start from beginning). The 5 is one constant
(RESUME_COUNTDOWN_SECONDS), single-sourced into the CSS drain.

What the gate caught (slim/adversarial, 1 fix round): the action-to-button
mapping was unbound - inverted, the default would have auto-clicked "Start
from beginning" and WIPED saved progress with the suite green; the tick
interval was the unbound half of the wall-clock duration; a cancel-count
floor had slack; plus a pre-existing keyboard-drift-lock hole (M/mute was
never bound). All closed and mutant-verified.

Known posture (disclosed): on iOS, a session's FIRST auto-fired play can be
refused without a fresh gesture (the long-standing v1.23.6 posture) - the
prompt still dismisses and the position is set; one tap plays. Cancel
boundary: a keypress anywhere cancels, but a tap OUTSIDE the player (page
scroll, sidebar) does not - the countdown fires the configured default. On
the device probe list.

Dual-Node: 6966/6966 on v22.23.1 AND v24.14.0.

### v1.131.0 - CarPlay pause-provenance diagnostics (2026-08-16)

Dean's car report: wired CarPlay + physical volume knob/steering wheel ->
playback pauses and only the in-app play button resumes it (the car's play
button does not). A web app receives no volume events on iOS, so the pause
is DELIVERED - either a MediaSession 'pause' action (car-sent transport
command) or a bare element pause (audio-session interruption, which iOS
never auto-resumes for web media). INSTRUMENTATION ONLY, per the diagnosis
discipline: no behavior change; the ?debugLifecycle=1 overlay now records
msAction:<name> on every MediaSession action arrival (one wrapper at the
registration seam) and media:pause/media:play provenance on both elements
(gesture age, handoff suppression, ended, bg-audio state). Dean's next car
repro names the mechanism; the fix ships after.

What the gate caught (slim/adversarial, 1 fix round): two surviving mutants
in the evidence path itself - a swapped element ternary would make the
`ended` bit lie (end-of-track pause wearing the interruption signature),
and a zero-age boundary mutant dressed a same-millisecond user tap as a
system pause. Both bound red. Probe protocol note: the 30-entry log evicts
after ~10 track transitions - screenshot at the repro moment, parked.

Tracker: row 156 - books-tts T8 flakes under external CPU load (two
loaded-box runs failed only there; 10/10 in isolation; reviewer's loaded
run and both release runs green).

Dual-Node: 6951/6951 on v22.23.1 AND v24.14.0.

### v1.130.0 - immersive fullscreen carries across playback continuations (2026-08-15)

Dean's iOS report: landscape faux fullscreen, video advances (autoplay or
skip-to-next) -> dumped onto the raw landscape page. Root cause: the load
teardown's unconditional v1.34.2 overlay drop is right for a fresh pick,
wrong for a continuation - and the rotate machinery only re-enters on
orientation CHANGE. Now a one-shot carry, armed at all 8 continuation seams
(autoplay-ended, queue advance, manual track next/prev, lock-screen/media-key,
Shift+N/P), keeps the immersive surface across the load; cross-kind advances
land on the NEW item's own surface (video faux fullscreen <-> expanded audio
now-playing). Keyed on immersive STATE at advance time, never orientation.

What the gate caught (slim/adversarial, 2 rounds): an artless-audio
destination would have landed in a scroll-frozen black page - twice (the
set axis in round 1, the teardown-PRESERVED class axis in round 2, the
reveal-once two-axes class); two unbound surface-swap mutants; a
comment-porous arm-count lock; scroll-keeper + adopt-branch one-shot gaps.
All fixed and mutant-verified red.

Known gaps (disclosed): cross-VIEW continuations (e.g. queue advance
video -> /music track) stay non-immersive - the SPA router's dock()
transition drops the classes before the destination captures; behavior
equals pre-wave; deferred as the v1.103 router-depth bug-magnet class.
Desktop NATIVE fullscreen across advances is browser-gesture-gated (out of
scope). Artless audio destinations degrade to the plain page by design.

Dual-Node: 6942/6942 on v22.23.1 AND v24.14.0. Dean's on-device pass
PENDING (headline probe: fullscreen video -> autoplay/skip -> stays
fullscreen).

### v1.129.0 - docs truth sweep round 2 + release mechanicals (2026-08-15)

Wave C, closing the external-review-round-2 response arc (v1.127 security,
v1.128 metadata isolation, this). The review's process finding: the v1.125
docs reset was incomplete and its own "zero violations" claim was false. This
wave's answer is CHECKER-FIRST - every sweep is now a test that lives in the
suite, so the truth can't rot back:

- **Status census** - every completed plan's first status line must be
  terminal, every observed spelling handled. On its FIRST run it caught the
  three surviving `APPROVED` plans (v1.29/30/31, now fixed with tag-derived
  facts) plus a fourth spelling nobody knew about. The 37 status-less
  early-era docs are a ratchet ceiling, not a hand-edit sweep.
- **Link census** - every relative doc link and every backtick `docs/*.md`
  reference in a living doc must resolve (frozen history scoped out). Caught
  the CONTRIBUTING shimmer-audit reference the review named.
- **Tracker truth** - the session-start hook had been injecting "42 open
  debt items" into every session while 114 were actually open (72 OPEN rows
  appended under the Closed region for weeks). The chronological region is
  now the "## Ledger" with the status cell authoritative, the hook counts
  truthfully, and a census test EXECUTES the hook and reds on drift.
- **Doc truth pass** - RELIABILITY's "CI is Node 22" corrected to the 22+24
  matrix; RELEASING's `git commit -am` replaced with explicit staging;
  Docker comments no longer describe db.json; README's egress claim now
  names the three opt-in outbound flows, the backup claim is scoped to
  app-state, the Roku section says video-first, and podcasts finally appear
  in the pitch. QUALITY_SCORE.md fully re-graded at Dean's explicit
  per-instance authorization (its banner requires exactly that) - headline:
  Security D -> B, persistence B- -> B, honest non-movements stated.
- **Release mechanicals** - the publish workflow now asserts the pushed tag
  equals package.json's version, and a concurrency group serializes
  publishes so an older run can't overwrite a newer `latest`. The heavier
  supply-chain items are bundled as tech-debt #154 ("Wave D: pre-exposure
  hardening", trigger = any plan to leave the LAN/VPN); the caption/PiP
  static inference is tracked as #155 awaiting Dean's probe.

Gate: slim (adversarial seat alone, isolated worktree - docs + workflow
config, nothing can lose data). It earned its keep: three WARNINGs, two of
them the wave's own sin class - the truth pass itself shipped a false claim
(crediting the git pre-commit hook with blocking blind staging; the real
blocker is an agent-session hook, and a plain shell has NO guard), and a
bolded **OPEN** cell silently vanished from the debt count with everything
green. Plus a real correction on GitHub concurrency semantics (a rapid tag
chain cancels the middle tag's publish - documented with a re-run note).
All fixed and re-measured, incl. the reviewer's exact mutants; APPROVE on
the delta. Dual-Node 6928/6928 (v22.23.1 + v24.14.0).

**DEVICE PASS PENDING (Dean):** nothing user-facing changed - docs, one hook,
and the publish workflow. Worth a glance: the next release's publish run
should show the new "Assert tag matches package.json version" step green.
Note for the record: QUALITY_SCORE.md was re-graded under your "Update it,
it's okay" authorization; give it a skim when convenient.

### v1.128.0 - restricted-account metadata isolation sweep (2026-08-15)

Wave B of the external-review-round-2 response. A restricted/kid account never
received protected media BYTES (v1.80/v1.81 gated those), but a machine-derived
census of every read surface found that several still leaked hidden TITLES,
folder names, absolute server PATHS, and meaningful counts. This wave closes
that class.

- **The census (machine-derived).** Four parallel read-only agents audited
  every GET route across server.js + the podcasts and yt-dlp modules (~85
  surfaces), reporting per route whether a restricted member's response exposed
  hidden data. Result: 11 leaking surfaces, 3 minor residuals deferred with
  disclosure. The census is committed as the wave's worklist.
- **The 11 fixes.** `/api/config`, `/api/books/config`, `/api/music/config`,
  and `/api/books/folders` (the sidebar-nav surfaces); `/api/scan-status`
  (counts + pending-transcode titles); `/api/duplicates` + its CSV;
  `/api/attribution-targets`; the shared playback-queue reader and its insert
  route; and the two yt-dlp "file-under-Podcasts" external-show surfaces. Each
  now filters through the one canonical visibility decision.
- **Byte-identical for everyone else.** Filtering only engages for a member who
  actually carries a restriction - an admin and a normal unrestricted member
  get the exact pre-Wave-B payload, so no folder ever vanishes from a regular
  user's sidebar. The config/report surfaces are FILTERED (not admin-gated)
  precisely because members need them for navigation.
- **An un-rottable net.** A new read-surface completeness test classifies all
  84 GET routes and fails if a future route ships unclassified - the same
  forcing-net discipline the write side has, so this census can't silently rot
  the way past sweeps did.

Deferred with tracker rows (disclosed, not silent): a podcasts show/episode
count-oracle and poll-status count-oracle (#152), the general podcasts root
path (#152), the shared yt-dlp registry job-log titles (#150 class), and the
personal-write existence-oracle tail (#153).

Gate: FULL gate (access-control - the repo's most-repeated CRITICAL class),
seats run in ISOLATED worktrees this time (the v1.127 "one tree, one seat"
scar). No CRITICALs; the adversarial seat confirmed by repro that none of the
11 fixes leak under folder-kind, path-kind, allowlist, or partial-visibility
attacks. One fix round closed both seats' WARNINGs: a byte-identity regression
where a genuinely-empty external podcast show vanished for admins (the drop was
gated on predicate-presence instead of raw-vs-visible counts), and a
presence-not-binding gap where 2 of the queue's 3 visibility drops were
untested. Both seats APPROVED after the fix round. Dual-Node 6923/6923 on
v22.23.1 + v24.14.0.

**DEVICE PASS PENDING (Dean):** as a kid-mode account, confirm nothing hidden
appears in the sidebar folders, the stats/duplicates report, the queue, the
books/music tabs, or the podcasts list - including NAMES in dropdowns and
chips. As an ADMIN, confirm the settings page, duplicates report, and
attribution dialog are still fully populated (an empty folder or empty
subscribed podcast must still show).

### v1.127.0 - close the bulk-route RBAC bypass + schema rollback floor (2026-08-15)

Origin: an external static review (round 2, comparing the v1.122 and v1.126
snapshots) that we verified against the tree before acting on. Two of its
findings were real and confirmed mechanically in-session; this wave closes
both, plus the process gap that let them through.

- **Bulk-route visibility (HIGH, verified).** `POST
  /api/videos/attribute-channel-bulk` gated the library-EDIT capability
  (v1.81) but never VISIBILITY: its selector swept every item under the target
  root, so a member with edit capability but a path/folder/allowlist
  restriction could preview counts for, rewrite attribution on, and physically
  RELOCATE media hidden from them. Same class in the library-wide yt-dlp
  reheat (`/api/ytdlp/repull-metadata` + its preview), whose per-item sibling
  got a visibility axis in v1.123 while the batch and preview did not. Both now
  filter their worklist AND their reported counts through the requester's one
  canonical visibility decision (`mediaVisiblePredicate`, the full descriptor -
  never the narrower shape that let the v1.126 bug through). An admin is
  unaffected; a restricted member's hidden items are structurally invisible to
  these routes.
- **The forcing net's own blind spot.** The route-write-classification net
  that is supposed to prevent exactly this class had classified both routes
  `n/a` - its exemption list WAS the hole. Rebuilt: the fixed routes are
  `enforced` and regression-pinned, and every remaining `n/a` now costs a
  reviewable written justification (a bare label is rejected). A shipped
  residual is disclosed: the net checks the classification LABEL, not the
  handler source (a sound scan is undecidable) - tracked as tech-debt #151.
- **Schema rollback floor (HIGH, verified with a live repro).** v1.126 added
  the `folderDisplayNames` namespace at an unchanged schema version 17, which
  silently broke downgrading: a <=v1.125 build boots and reads such a database
  but then FAILS every durable write. A repro built from the released v1.122.0
  adapter confirmed it. Released builds can't be repaired retroactively, so per
  Dean's call the fix is forward-only: schema bumped 17->18 (a marker), the
  adapter now REFUSES at boot any database newer than it understands, and the
  rollback floor (databases touched by >=v1.126 are not writable by <=v1.125)
  is documented in RELEASING.md. Any new persisted namespace must bump the
  version in the same commit from now on.
- **Secret debt closed.** The v1.123 tracked-`session-secret` finding's
  operational half is done: Dean rotated the deployed instance and re-logged-in
  (confirmed 2026-08-15). Tracker row 77 closed; the only residual is the old
  bytes in git history (repo private) - reopen on any repo-visibility change.

Gate: FULL gate (file relocation = data-loss class, never slim). The
adversarial seat was briefed to DESTROY hidden media and ran the downgrade
repro itself; it APPROVED round 1 (3 SUGGESTIONs). The QA seat REQUESTED
CHANGES on two WARNINGs - both "a task deviated from the wave's own exec plan
without disclosing it" (the reheat batch omitted a plan-specified executor
re-check; the net dropped a plan-specified mechanical handler scan). Neither
was a security hole - the batch re-check is tautological (a mid-batch hide
re-keys the item's path-derived id and dead-ends on `item-gone`; a frozen
predicate can't catch restriction drift regardless), and the scan is
undecidable - so both were resolved by verified disclosure (plan + tracker
#151), and both seats APPROVED the fix round. Dual-Node 6908/6908 on v22.23.1
+ v24.14.0. Process note for the record: round 1 ran both seats against one
working tree and their mutation churn collided - the "one tree, one seat" norm;
the delta round was clean.

**DEVICE PASS PENDING (Dean):** this wave is capability-tightening and
schema-hardening - nothing changes for an unrestricted account, so normal smoke
is enough. If you want to confirm the fix: as a restricted (kid-mode) member
with library-edit, the bulk "attribute channel" and library reheat must act
only on visible folders. Optional caption/PiP probe still open from the review
(tech-debt-adjacent, not this wave): play a captioned video, enter PiP - are
captions visible in the floating window?

### v1.126.0 - per-channel-folder display names: name the unnameable playlists (2026-08-15)

Dean: tapping a NESTALGIA link landed on "Playlist: nestalgiamusic", and the
related rail showed raw folder names - and unpin/repin couldn't fix it. Two
root causes: (1) the v1.122 header heal only ran on `?root=` views, but the
links users tap (a card's channel name, the channels bar) go to `?folder=`,
whose header rendered the raw folder name; (2) ~70 folders / ~1,217 items are
PERMANENTLY unhealable (no channelId, no URL on any item), so no per-item heal
can ever fix their names.

- **A per-folder display map** (`db.folderDisplayNames`) now backs every
  folder-label surface. "Refresh channel names" writes it automatically when a
  folder resolves to one canonical name; a **Rename pencil** on the folder-view
  header lets you name the unhealable ones by hand. The map heals the `?folder=`
  header, the channels bar, the related rail, pins, the history byline, and the
  Feed-Hidden row all at once - a captured real channel name always still wins.
- Reachable to library-edit members only; a member restricted from a folder
  can't rename (or probe) it.

Gate: FULL gate (a new persisted namespace + a new mutating route - two scarred
classes). Both seats CONVERGED on a CRITICAL in the first round: the rename
route checked visibility with a too-narrow descriptor, so a member restricted
from a folder by the path/root lane could rename (and existence-probe) a folder
they can't see. Fixed to the one canonical visibility decision (a restricted
account is now refused with a neutral 404, structurally indistinguishable from
a missing folder); both seats re-verified with runnable repros. Dual-Node
6897/6897 on v22.23.1 + v24.14.0.

Part 2 (Dean's faststart probe request): the read-only probe already ships -
`docker exec -i filetube node scripts/probe-faststart.js`. Dean's run:
122/1117 mp4s (11%) have a trailing moov (90 are one training course). NO-OP
by Dean's choice; a lossless in-place remux-on-reheat is a named future wave
(no delete/rescan needed - same path keeps the same id).

**DEVICE PASS PENDING (Dean):** tap a NESTALGIA link -> header reads
"Playlist: NESTALGIA"; open one of the raw-named folders -> pencil -> name it ->
it heals across the header, channels bar, and that folder's related-rail
entries; a folder with a real captured channel name is unaffected.

### v1.125.0 - documentation reset: the repo's AI knowledge base tells the truth again (2026-08-15)

Wave 3 of the stabilization arc (external review, 2026-08-14): stale plans and
authority docs were letting a future agent "confidently follow obsolete
information". Docs-only.

- **41 shipped plans in `docs/exec-plans/completed/` corrected** from
  in-flight statuses (ACTIVE / DESIGN / DRAFT / "in implementation" /
  DESIGNED / EXECUTING) to terminal `SHIPPED vX.Y.Z` lines - every version
  machine-verified against its ROADMAP entry before rewriting. The standing
  invariant (now stated in the plan): the first status line of every completed
  plan, matched case-insensitively, contains SHIPPED|COMPLETED|CLOSED.
- **`future/` now means genuinely-unbuilt**: its two yt-dlp plans (superseded
  by the shipped `lib/ytdlp/` since ~v1.11) and the shipped shimmer-sweep
  audit moved to a new `docs/exec-plans/archive/` with loud ARCHIVED banners.
- **`ARCHITECTURE.md` rewritten** (387 -> 250 lines): the old edition
  described the pre-v1.42 db.json era with no auth, no SQLite, no RBAC, no
  podcasts. The new one is survey-grounded current state - the SQLite adapter
  (schema v17, doc/relational split, append-only migrations), auth + RBAC +
  the forcing nets, the media pipeline and its prune guards, the four places
  + ytdlp, the client (router, battle-won player subsystems, tokens,
  PWA/push), Roku, config, CI, testing - and survived an adversarial
  fact-check of its load-bearing claims against the tree.
- Skipped, disclosed: the optional generated route inventory (the live route
  table is already machine-enumerated by the forcing-net tests).
  `QUALITY_SCORE.md` untouched (owner-frozen header - Dean's per-instance
  call).

Gate: slim (adversarial), one fix round - and it caught the wave's own
classes turned inward: the status sweep was CASE-SENSITIVE and 8 all-caps
`STATUS: DESIGNED/EXECUTING` files survived it (the divergent-spelling
class), and my first archive banners HAND-WROTE wrong version anchors (a
truth-reset writing new false history) - both corrected with measured values,
then re-verified by the seat from scratch. Suites untouched by docs; full
suite green through the pre-push hooks.

### v1.124.1 - hotfix: desktop fullscreen never armed the controls auto-hide (2026-08-15)

Dean's device pass, minutes after v1.124.0: subtitles-above-the-bar (F1) works;
the controls fade (F2) was dead on desktop fullscreen. Root cause: desktop
fullscreen is the NATIVE Fullscreen API (`requestFullscreen()`, no class),
while the fade gate only recognized the FAUX `.css-fullscreen`/`.audio-expanded`
CLASSES (the mobile mechanism) - so the timer never armed. F1 escaped the same
trap only because its CSS declared both selector forms.

Fix: the immersive gate also accepts a native fullscreen element inside the
player; a `fullscreenchange` listener arms the fade on enter (entering
fullscreen mid-playback fires no `play` event, so nothing else would) and
restores the bar on exit; native `:fullscreen` CSS twins for the fade,
reduced-motion, and cursor-hide.

Slim gate (adversarial): APPROVE, zero findings - diagnosis confirmed by code
reading, mobile/iOS path proven inert by construction (webkit fullscreen
populates neither unprefixed API), no stuck-hidden state reachable, all 8
mutants killed (including a comment-porous variant). Disclosed, pre-existing,
NOT this fix: on macOS Safari the fs-btn may route to Apple's native video
player (webkitEnterFullscreen checked first, an AC14-era branch) - if your
desktop is Safari and you see Apple's chrome instead of ours, that's that,
and it wants its own probe/decision.

**DEVICE RE-PROBE (Dean):** fullscreen a video on desktop -> controls + cursor
fade after ~3s, return on mouse move; never fade while paused/scrubbing.

### v1.124.0 - reliability hazards + desktop-player features (2026-08-14)

Two reliability fixes from the external review's item 4, plus two desktop-player
features Dean asked for with the wave.

- **Podcast enclosure downloads now honor write backpressure.** A fast feed
  origin over a slow disk (NAS/SMB) used to let Node buffer the download
  unbounded in memory - up to 2 GB per concurrent enclosure, enough to OOM a
  small box. The read now pauses when the write buffer is full and resumes on
  drain; every existing guard (size cap, idle/deadline timeout, fsync-rename,
  partial-file cleanup) is untouched, and no bytes are dropped.
- **Books under a transiently-unreadable folder are protected from pruning.** A
  momentary permission error (EACCES) or failed automount on a book SUBTREE used
  to delete every book under it AND its per-user reading position - even when the
  rest of the library was fine. Ported the guard the music scanner already had:
  a book whose file sits under a directory that errored this scan is never
  pruned. (Data-loss class - full gate.)
- **F1 (Dean): video subtitles no longer hide behind the controls bar.** Video
  captions used the browser's native rendering, which the custom control bar
  overlays in fullscreen. They now render through the same custom overlay the
  audio player already used - always above the bar, in every view including
  fullscreen. Unifies audio and video caption rendering on one path.
- **F2 (Dean): desktop controls auto-hide in fullscreen, YouTube/iOS style.** In
  the fullscreen (and audio-expanded) views the control bar now fades after ~3s
  of no activity while playing, and reappears on mouse movement (the cursor hides
  with it and returns on the next move). The normal inline player is unchanged -
  its bar sits in a reserved strip below the video, so it stays visible.

Gate: FULL gate (the book-prune fix can lose data), both seats APPROVED after one
comment-only fix round - F1 had left two stale comments in the battle-won caption
code describing the old (deleted) native-video path; corrected. No code defect was
found in any of the four - each guard was mutation-verified by both seats
independently. Dual-Node full suite **6885/6885** on v22.23.1 and v24.14.0.

**DEVICE PASS PENDING (Dean):** F1 - turn on subtitles for a video and confirm
they sit ABOVE the controls bar, including in fullscreen. F2 - fullscreen a video,
stop moving the mouse, and confirm the controls (and cursor) fade after a few
seconds and return on a mouse move; confirm they never fade while paused or mid-
scrub, and that the normal (non-fullscreen) player still shows its bar. NOTE: F2
is scoped to fullscreen/immersive - if you want the inline bar to overlay-and-hide
too, that's a follow-up layout change, your call.

### v1.123.0 - security emergency: secret rotation, object-visibility bypass, cache + publish hardening (2026-08-14)

An external adversarial codebase review graded security F on five claims. Every
claim was re-verified against the tree before any work, and one turned out worse
than reported (the repo is PUBLIC). Dean's deployment is LAN-only self-hosted,
which bounds the blast radius but not the fixes.

- **The session-signing secret was tracked in a PUBLIC repo since v1.43.** Anyone
  could read `session-secret` and forge session cookies for any instance whose
  secret matched. Untracked + gitignored; the resolver re-mints a fresh 0600
  secret on next boot. NO git-history rewrite (the secret is dead after rotation;
  rewriting main would break every tag/clone) - the historical exposure is
  disclosed here instead. **Your instance's secret lives in its DATA_DIR volume,
  almost certainly already distinct from the leaked value; to be certain, delete
  `DATA_DIR/session-secret` on the server and restart (everyone re-logs in once).**
- **The object-visibility bypass class.** A member holding the library-modify (or
  manage-subs) capability but RESTRICTED from a folder/show could still mutate
  items hidden from them BY ID. The review named one route; the audit found FIVE:
  podcast episode delete + restore, trash restore + **permanent purge** (the
  worst - irreversible deletion of a hidden item), and the shared book-cover
  write. All now 404 a restricted member, neutrally. Plus a capability×visibility
  forcing net over every mutating route.
- **RBAC-gated art was publicly cacheable; the backup wasn't cache-controlled at
  all.** Book covers, album art and podcast art (404'd per-user) now serve
  `private` so no shared/proxy cache can replay one user's art to another; the
  admin backup bundle (password hashes + all per-user state) now serves
  `no-store`.
- **Docker publish was ungated.** It fired on any push/tag with zero CI
  dependency - a red suite still shipped `latest`. Publish now `needs` an
  exact-SHA qualify job (lint + token ratchet + dual-Node 22/24 suite) plus a
  secret scan (a tag push skips ci.yml, so the released tree would otherwise never
  be scanned). CI itself is now dual-Node, matching the release ceremony it used
  to contradict.
- **Secret scanning** (pinned, checksum-verified gitleaks) now runs in CI on the
  working tree.

Gate: FULL gate, both seats (this wave forges admin sessions and permanently
destroys data - never slim). Both APPROVED after ONE fix round, which caught real
things in the wave's OWN completeness claims: the book-cover guard shipped
UNBOUND (a mutant removing it survived the entire suite); the first visibility
forcing net was an ALLOWLIST that let a NEW media namespace escape silently
(rebuilt as a denylist - the adversarial seat proved the escape end-to-end, then
proved it closed); and the audit had MISSED two live `:mediaId` ytdlp
content-mutators (metadata repull + file relocate) behind a mis-stated exclusion,
now guarded and bound. Every fix mutation-verified by both seats independently.
Dual-Node full suite **6880/6880** on v22.23.1 and v24.14.0 (0 fail; 0-3
environment-conditional skips depending on optional binaries).

Known gaps (DISCLOSED, low-severity, LAN-appropriate): tech-debt **#147** -
`private` art can still replay from the USER'S OWN browser cache on a shared
device within the day cap (matches the pre-existing `/thumbnail` posture);
**#148** - the gitleaks scan is blind to the root `test/` tree (fixtures there
carry intentional fake credentials). Both have revisit triggers.

**DEVICE PASS PENDING (Dean):** everyone re-logs in once after you pull v1.123.0
(the secret rotation). Optional hard-rotation: delete `DATA_DIR/session-secret`
and restart. Nothing else is user-visible - the rest is guard-rails.

### v1.122.0 - channel names consistent on the last folder-named surfaces (2026-08-14)

Dean (on-device, v1.121): the healed channel names (v1.115/116) show on all
cards, but the watch page's RELATED rail still said "nestalgiamusic", and tapping
the channel name landed on a folder view titled "nestalgiamusic". The recurring
enumerate-every-surface class - and the gate found a THIRD surface Dean couldn't
see (the classic home's "Continue watching" row; invisible in Modern mode).

- **The related rail** now routes through the same name resolver every card uses
  -> "NESTALGIA"; items with no name fall back to the folder exactly as before.
- **The `?root=` folder view header** retitles to the channel's display name when
  the page's items all agree on one name; a MIXED folder (a junk-drawer holding
  many channels) keeps its folder title - the header never disagrees with the
  cards below it. Honest edge (disclosed): a PARTIALLY-healed folder (some items
  still nameless on page 1) keeps the folder title, matching those cards - if
  NESTALGIA still shows the folder name, run "Refresh channel names" first.
- **The classic "Continue watching" row** (gate catch) swept to the resolver too.
- **Docs rider:** the release ceremony now codifies Dean's branch-hygiene norm -
  push main + tag only; wave branches are deleted (remote where pushed + local)
  once the tag verifies. This wave is the norm's first run.

Gate: slim gate (adversarial). One fix round - it caught a LYING COMMENT (my
badge-mechanism claim was false; corrected + the no-op call it justified removed)
plus the third surface and the honest partial-heal contract; 11/11 mutants killed
on the delta. Dual-Node full suite **6870/6870** on v22.23.1 and v24.14.0.

**DEVICE PASS PENDING (Dean):** related rail shows NESTALGIA; tapping the channel
name lands on a view titled NESTALGIA; a mixed folder keeps its folder title.

### v1.121.0 - "Instant background-audio handoff" (the lock-blip tuning) + manifest identity (2026-08-14)

Dean's on-device report: audio background play is gapless-perfect; VIDEO
background audio works (the v1.27 hidden-audio handoff) but blips ~1/4s at lock.
Root cause: preExtractAudio buffers the sidecar eagerly but FROM ZERO - the
handoff's seek to minute-N lands unbuffered and fetches at lock-time.

- **New experimental setting: "Instant background-audio handoff"** (default OFF,
  Settings -> next to the other two background-audio levers - Dean's live
  kill-switch). When ON: while a mobile video plays, the hidden background-audio
  track quietly keeps pace with the live position (a nudge at most every 10s,
  plus immediately after a scrub, only when drifted >8s), so the lock-time
  switch-over lands on already-buffered audio. The handoff machinery itself is
  byte-untouched; the sync is structurally impossible while the sidecar is live
  or handing off.
- **Manifest identity** (`id` + `scope`): the only web-side signal iOS gets for
  its Now Playing session->app attribution - the disclosed LOW-odds dice roll on
  the Control Center tap opening a sibling-domain PWA (an iOS-level
  misattribution, confirmed unfixable website-side; needs a home-screen
  delete+re-add to take). Workaround if it persists: the app switcher.

Gate: slim gate (adversarial). One fix round - all three WARNINGs were "the
kill-switch's own plumbing was deletable with the suite green" (unsavable
toggle, dead populate/save wiring, hardcodable gate signals); every mutant now
reds. Dual-Node full suite **6862/6862** on v22.23.1 and v24.14.0.

**DEVICE PASS PENDING (Dean):** toggle ON -> long video -> seek to ~minute 20 ->
lock: did the blip shrink? (?debugLifecycle=1 shows `bgAudio:presync` records if
the nudges are firing.) Plus one final delete+re-add of the home-screen icon for
the manifest dice roll.

### v1.120.0 - audio gets the full fullscreen experience (rotate-to-expand + auto-hide) (2026-08-14)

Dean: apply the v1.118/v1.119 mobile-fullscreen experience to AUDIO too. Audio has
no iOS native fullscreen (no video track); its equivalent is the EXPANDED
now-playing view (the big cover-art overlay). Full parity:

- **Rotate to landscape while a track plays -> the now-playing view EXPANDS**
  (big cover art); rotate back to portrait -> collapses. Zero taps. Pure class
  toggle -- cleaner than video (no iOS player to fight, no bounce, no pause).
- **Auto-hide the control bar** over the cover art (same machinery as video,
  generalised to cover both overlays; a tap on the art wakes the controls without
  pausing the track; stays up while paused; never fades mid-scrub). Mobile only --
  desktop keeps its bar.
- **Same bleed belt** -- the expanded overlay pinned to the visual viewport
  (100dvh/100dvw) + a black, scroll-frozen body; a hidden bar lets the art fill
  to the bottom edge.

Gate: slim gate (adversarial). APPROVE after two fix rounds - it caught that the
first "reveal without pausing" fix was DEAD on a phone (the guard sat in the mouse
'click' handler, which a touchend preventDefault suppresses on iOS); moved it onto
the real touch single-tap path. Dual-Node full suite **6854/6854** on v22.23.1 and
v24.14.0.

**DEVICE PASS PENDING** (iOS runtime arbiter). On-device: play a track -> rotate
sideways (expands to full cover art) -> let the bar fade -> tap the art (wakes
controls, no pause) -> rotate back (collapses).

### v1.119.0 - fullscreen polish: auto-hide controls + fix the iOS-landscape bleed (2026-08-14)

Dean's v1.118 device pass: the rotate-to-our-fullscreen dream WORKS. Two polish
follow-ups from the on-device screenshots.

- **The control bar auto-hides in fullscreen** (the native convention). It overlays
  the picture (v1.34.4), so keeping it up permanently blocked the bottom of the
  frame + the captions. Now it fades out after ~3s of no interaction while playing,
  reveals on any tap (video or bar), and stays up while paused (a paused frame
  keeps its scrubber). It never fades mid-scrub (the gate caught that), and the
  skip/hold gestures are untouched. Faux fullscreen only.
- **The bottom bleed is gone.** On an iOS-landscape PWA `inset:0` alone stopped at
  the layout-viewport edge, letting the page peek through a strip below the overlay;
  the overlay now pins to the visual viewport (100dvh/100dvw) and the body paints
  black, so any sliver reads as letterbox, not page content.

Gate: slim gate (adversarial). APPROVE after one round - it caught a real scrub
regression (a >3s continuous drag hid the seek bar under the finger, since a scrub
never pauses); fixed by guarding the fade on `!isScrubbing` + re-arming on the drag
commit. Dual-Node full suite **6850/6850** on v22.23.1 and v24.14.0.

**DEVICE PASS PENDING** (iOS landscape layout + the autohide feel are the arbiter).

### v1.118.0 - mobile: OUR fullscreen supersedes Apple's on rotate (zero-tap exit) (2026-08-14)

Dean (iOS PWA, custom player): playing a video and rotating to landscape hands you
to Apple's native fullscreen; exiting it dropped you into our own fullscreen
(costing an extra tap), and rotating back couldn't auto-exit. Apple's native
fullscreen CANNOT be closed by code without the video PAUSING (proven + reverted
2026-07-10) - so, Dean's call, OUR faux (CSS) fullscreen now supersedes it. CUSTOM
player mode only; native-controls mode + desktop are byte-for-byte unchanged.

- **Rotate to landscape -> our fullscreen.** The bounce that kicks iOS's auto-native
  player off-screen (it was silently failing on Dean's device) now arms our faux
  first and retries the exit through the enter transition so it reliably takes.
- **Rotate back to portrait -> auto-exits to the normal player, still playing, ZERO
  taps.** Pure CSS, so it never hits the iOS pause wall (the no-programmatic-native-
  exit-on-rotate invariant is preserved + re-asserted by the tests).
- **Safety net (Fix A):** if the bounce ever doesn't take and you end up in Apple's
  player, genuinely exiting it drops you straight to the normal player instead of
  stranding you in faux (handoff vs user-exit disambiguated by timing).

Gate: slim gate (adversarial, player lifecycle). APPROVE after a one-round belt
(reset the handoff stamp on every faux exit so a button-fullscreen can't be
spuriously closed; tightened a loose time-guard test). The iOS-pause invariant is
mutation-bound on both surfaces. Dual-Node full suite **6843/6843** on v22.23.1 and
v24.14.0.

**DEVICE PASS PENDING - THE ARBITER.** This is iOS runtime behavior no dev-env test
can reproduce; the bounce timing is a ship -> verify -> iterate loop (tech-debt
#146). On-device watch-fors: a flash of Apple's player before ours, a pause on
rotate-into-fullscreen, or a stuck-in-faux on a very fast exit.

### v1.117.0 - left sidebar consistent on every page (pins + Stats link no longer vanish) (2026-08-13)

Dean bug: on some pages the left sidebar dropped content - going to Stats made all
pins vanish, and refreshing on a video page lost the "Stats" link. Root cause was
the recurring "each shell/controller assembles its own copy of a shared surface"
class: the sidebar was built per-page, so pages that didn't rebuild a piece showed
it missing.

- **Pins now render on every page.** The pinned-sidebar boot render was only
  wired by the Home (main.js) and Watch (watch.js) controllers - so pins vanished
  on Stats/Music/History/Books/Podcasts/Subscriptions/Setup. Hoisted into
  common.js's shell-level boot (runs on every page); the redundant per-controller
  copies retired. (Bonus: this revived the warm instant-paint that had gone dead.)
- **The "Stats" link is on every sidebar page.** It lived only in index.html +
  stats.html; added the static link to the 8 shells that lacked it, so the top nav
  (Home / Library settings / Stats) is identical across all 10 sidebar pages.
- **Forcing net** (sidebar-nav-parity test): every sidebar shell must carry all
  three nav links, and the pin render must live only in common.js's boot - a new
  page or a refactor that drops either now reddens in CI, not on-device.

Gate: slim gate (adversarial, display-only). Caught a THIRD hidden boot owner
(setup.js) the first cut missed - the exact enumerate-every-surface completeness
this fix targets; fixed + the net extended to guard every controller. APPROVE on
the delta. Dual-Node full suite **6838/6838** on v22.23.1 and v24.14.0.

### v1.116.0 - "Refresh channel names" now heals MUSIC channels locally from a sibling (2026-08-13)

Dean's v1.115 device pass found NESTALGIA (and 7 other channels) still showing
"@nestalgiamusic". Root cause, proven on prod (read-only diagnostic): (1) the
v1.115 backfill hard-filtered `type:'video'` -> the whole MUSIC library (audio
items) was skipped; (2) each channel is FRAGMENTED in the DB - some items carry
the real `channelId` + name ("NESTALGIA" / UC-6oT0…), others only the "@handle"
+ a null id. This wave uses the item that already has the id as LOCAL GROUND
TRUTH and heals the fragments - no network.

- **Widened to audio.** The name backfill (and the new heal) now cover video AND
  audio via a shared `isChannelBearingMediaType` predicate.
- **Local reconciliation, folded into the "Refresh channel names" button.**
  Pressing it now runs a LOCAL pass first (instant, no yt-dlp): bucket items by
  physical folder, and for any folder with exactly ONE canonical `channelId`
  (real id + real name) plus bad-name siblings, adopt that identity UNIT
  (id + name + url + handle + avatar) onto the siblings - corroborated by the
  shared `@handle` URL so a foreign channel sharing a folder is never touched, and
  conflict folders (>1 canonical id, e.g. a junk-drawer) are skipped wholesale.
  Then the existing network probe mops up whatever is still bad, recomputed on the
  healed db so a fixed channel is not re-probed.
- **Machine-derived sizing (Dean's prod):** 8 channels / 516 items heal locally
  (NESTALGIA 332, CGTioMusic 96, heavymachinegun 66, Hungry Skull 10, +4). The
  ~1217 items with no id AND no URL still need a re-download (disclosed).
- **Survives a later scan** (persist-gate): the healed id/name/avatar are carried
  through the scan's Phase-2 merge, including OVERWRITING a wrong pre-existing id.

Gate: FULL two-reviewer gate (data-mutating). Both APPROVE after ONE fix round -
QA's persist-gate WARNING (a wrong pre-existing channelId could survive as a mixed
identity and poison its folder into a "conflict") fixed + mutation-bound (QA
further drove 270 in-process scan/heal interleaves: 0 reverts, 0 mixed); plus a
"video"->"item" copy fix and a bridge-test flake hardened to poll-until-done.
Disclosed residuals: tech-debt #144 (a no-URL item misfiled into a channel folder
heals on folder membership alone - prod-unreachable, backstopped by the 516-item
re-run) and #145 (a midscan test read-timing flake under pathological CPU
starvation - product proven correct). Dual-Node full suite **6834/6834** on
v22.23.1 and v24.14.0.

**VERIFICATION IS DEAN'S DEVICE PASS** (dev env has no yt-dlp; the live heal +
fan-out is proven on-device). Expected on pull: NESTALGIA's 332 stragglers unify
to "NESTALGIA" + the real channelId, and 7 more music channels snap into place.

### v1.115.0 - "Refresh channel names" backfill: real names for @handle/foldername channels (2026-08-13)

The ACCURATE per-channel name backfill (option A1) that v1.113/v1.114 deferred.
A new **"Refresh channel names"** button on the Subscriptions page enumerates every
DISTINCT channel whose captured name is bad (empty -> folder fallback, or the raw
"@handle"), probes each channel ONCE for its canonical display name ("mkbhd" ->
"Marques Brownlee") via the existing avatar-probe path, and fans that name out onto
every bad-name item of that channel. DATA-MUTATING -> full two-reviewer gate.

- **One probe per channel, not per video.** `collectDistinctChannelNameTargets`
  dedups the bad-name library down to one target per channel identity (channelId,
  else channelUrl/handleUrl); the probe reuses `probeChannelAvatar` (now also
  returning the canonical `channelName` from `channel`/`uploader`), so it refreshes
  the avatar as a bonus.
- **Writes are guarded and idempotent.** `applyBackfilledChannelName` only ever
  REPLACES a bad name (never a good one, never a manual attribution), keyed on the
  probed channel identity (no cross-channel bleed), bounded to 200 chars, and
  control-char/NUL stripped. Re-running writes 0.
- **Channel pins re-label too** - the pinned-sidebar snapshot label is refreshed to
  the real name, matched on the pin's full folder path (not a folder basename, so a
  same-named folder in a different root can't be cross-relabelled).
- **Survives a subsequent scan** (persist-gate/stale-snapshot class): an
  unconditional Phase-2 gap-fill adopts the live real name over the scan's stale
  bad-name snapshot, and the folder-backfill branch can no longer downgrade a
  just-backfilled name to an "@handle".

Gate: FULL two-reviewer gate (data-mutating). QA WARNING (control-char strip) +
SUGGESTION (folder-backfill reversion), adversarial WARNING (persist-gate mid-scan
revert) + 3 SUGGESTIONS (pin basename collision, fanout dedup miss, control chars)
- ALL fixed, each bound by a mutation-verified test (incl. a mid-scan-interleave
integration test the adversarial demanded, proven load-bearing against the commit).
Both APPROVE. Dual-Node full suite **6815/6815** on v22.23.1 and v24.14.0.

Known/disclosed: only channels with a probeable identity (channelId or a channel
URL/handle) get their real name - ~1000 true imports that carry NO channelId can
only get their name by re-downloading (a channelUrl-less local import has nothing
to probe). The channel-metadata-backfill exec plan CLOSES with this wave.
**VERIFICATION IS DEAN'S DEVICE PASS** (dev env has no yt-dlp, so the live probe +
fan-out is proven on-device).

### v1.114.0 - Clean "@handle" channel names + no "›" on the chapter label (2026-08-13)

Two small display-only cleanups (read-layer, no data mutation), off Dean's prod
diagnostic run + an on-device nit. The ACCURATE per-channel name backfill (option
A1) remains its own later wave.

- **"@handle"-as-the-name is cleaned everywhere.** Some channels captured the
  HANDLE as the channelName ("@Apple") and showed it verbatim. New pure
  `displayChannelName` strips a single leading "@" ("@Apple" -> "Apple") at every
  scanned-item display surface: cards/watch (resolveChannelName), the notification
  bell, the queue, the pinned sidebar, `/api/channels` (channel bar), the
  standalone History page, and the Feed-Hidden section. 136 such items on Dean's
  library fixed instantly. (Channel TARGET surfaces - subscriptions, the
  attribution picker, one-off-download identity - are deliberately untouched.)
- **The chapter-bar label dropped its leading "›"** (Dean: it "felt silly") - now
  just the plain title ("Float Islands"), matching the chapter menu.
- The channel-metadata sizing diagnostic was corrected (Dean's prod run proved the
  "@handle folder" model wrong: 0 such folders; the real bad-name set is
  missing-name + handle-as-name) and now ships correctly in the image.

Gate: slim gate (adversarial, non-data-mutating). Caught the strip-"@" sweep
missing the History page + Feed-Hidden section (their own row renderers, not the
shared card builder) - the recurring "enumerate every surface" class (v1.41.4,
v1.80, v1.113 liked/history). Swept both + a source-bound test on each; APPROVE on
the delta. Dual-Node full suite **6786/6786** on v22.23.1 and v24.14.0.

Known/disclosed: the ~1294 channels MISSING a name still show their folder name;
the accurate fix (option A1 - per-channel `channelId` -> canonical name backfill,
"mkbhd" -> "Marques Brownlee", ~491 identifiable, data-mutating, FULL gate) is the
NEXT wave. ~1000 true imports with no channelId can only get their real name by
re-downloading. The channel-metadata-backfill exec plan stays ACTIVE until A1
ships. **VERIFICATION IS DEAN'S DEVICE PASS.**

### v1.113.0 - Channel avatars in search/liked/history + shippable diagnostics (2026-08-13)

The safe, non-data-mutating HALF of the channel "@handle" investigation (Dean's
"some channels show @nestalgia, others show the real name"). The full backfill
that turns "@handle" into the real NAME is v1.114 (Fix B); this ships the avatar
half + the tooling to size the backfill.

- **Channel avatars resolve on every card surface.** `/api/videos` (search), plus
  its un-swept siblings `/api/liked` and `/api/history`, spread the raw item and
  showed a MONOGRAM where a channel's avatar is registry/subscription-resolvable,
  while `/api/home` showed the art. All three now route through the same read-only
  `resolveItemChannelAvatarUrl` as home (it also re-sanitizes a corrupted baked
  value). A source-level forcing net locks every `...item` card projection so a
  future surface can't reintroduce the gap. NOTE: this does NOT fix the "@handle"
  NAME or channels with no identity at all - that is Fix B (v1.114).
- **Ops/diagnostic scripts now ship in the Docker image** (`COPY scripts/`). They
  were never copied, so `node scripts/probe-channel-metadata.js` (the read-only
  backfill sizer added here) - and v1.111's `probe-faststart.js` - were absent
  from a deployed server. Run on prod with
  `docker exec <container> node scripts/probe-channel-metadata.js --examples 5`.
  (Dean's catch: the v1.111 device-pass note pointed at a script not in the image.)

Gate: slim gate (adversarial seat, non-data-mutating). It caught the false "search
is the ONE read surface" claim with a runnable repro - `/api/liked` + `/api/history`
had the identical bug. Swept all three, added the forcing net + a liked lock, both
mutation-verified; APPROVE on the delta. Dual-Node full suite **6779/6779** on
v22.23.1 and v24.14.0.

Known/disclosed: the "@handle" NAME itself (and channels with zero captured
identity) is UNCHANGED here - Fix B (v1.114) backfills the real channelName via the
existing reheat, plus a pin-label refresh (pins snapshot their label). The
channel-metadata-backfill exec plan stays ACTIVE (not moved to completed) until
v1.114 ships. **VERIFICATION IS DEAN'S DEVICE PASS:** the avatar improvement + the
`docker exec` diagnostic are on-device.

### v1.112.0 - Settings cog + persistent chapter-name label (2026-08-13)

Dean wanted the player's menu-ish controls centralized YouTube-style and the
current chapter name kept visible (the v1.109.1 chip flashed then faded because
it overlaid the video). Two things, framed at intake into the cleaner split:

- **Settings cog (gear)** centralizes **Speed + CC + Picture-in-Picture** off the
  control bar into one `#settings-menu` popup. Implemented by RELOCATING the
  existing `#speed-btn`/`#cc-btn`/`#pip-btn` elements (ids + every iOS-scarred
  handler unchanged) across all 9 shells that carry the player template -- not a
  rebuild. The cog joins the shared close/dock/outside-close lifecycle.
- **Persistent chapter-name label** on the bar, IN LINE with the controls (Dean's
  pick off a placement mock -- not a floating pill, not a separate line; it fills
  the space mobile's hidden mute/volume vacate). Clicking it opens the chapter
  list -- it's the sole chapters trigger now (the separate `Ch` button is gone).
  A chapter change briefly flashes it red; the loop-armed red cue moved onto it.

Also closed a latent shell-DRIFT gap the census exposed (two shells had drifted
comments; the per-control parity tests each covered only a 4-5 shell subset) --
all 9 shells are now byte-identical with a cross-shell tail-equality lock, and
every parity file asserts all nine.

Gate: full two-reviewer gate. Both seats REQUEST CHANGES (no criticals) and
caught two REAL regressions I'd have shipped: (1) with the label as the sole
trigger, the chapter list was UNREACHABLE before the first chapter for
manual/embedded chapters not starting at 0:00 (fixed -- the label now shows
"Chapters" whenever the item is chaptered); (2) the loop-armed cue was toggling a
class on the removed button, so it went dead (migrated to the label). Plus a
non-binding source-lock the adversarial seat's mutation caught (tightened) and
stale/dead CSS. All fixes mutation-verified; both seats then APPROVE, slim gate
on the cleanup APPROVE. A disclosed detached-HEAD near-miss (the harness pulled a
reviewer's worktree mid-run) was caught and re-verified -- no harm.

Dual-Node full suite **6766/6766** on both v22.23.1 and v24.14.0.

**VERIFICATION IS DEAN'S DEVICE PASS:** no browser/iOS in the dev env, so the
visual fit + feel are on-device. On-device probe list: cog opens/closes and
Speed/CC/PiP work from inside it (desktop popup + mobile bottom sheet for speed);
the chapter name sits in line with play/gear/fullscreen (desktop + the mobile
two-row bar) and never over the video; tapping it opens the chapter list; the
name shows "Chapters" before the first chapter on a chaptered item; the red flash
on chapter change + the persistent red while a chapter loop is armed.

### v1.111.0 - Faststart for new mp4 downloads (streaming Tier 1) (2026-08-13)

Dean asked about streaming robustness given the yt-dlp module downloads .mp4s.
The concrete win, no re-download: a trailing MP4 `moov` atom (the index) forces
the browser to fetch deep into the file before it can start/seek ("slow to start
on click"). This front-loads it (+faststart) so playback starts + seeks after
buffering only the start. Server-only; "new downloads only" slice (existing
library deferred to a later wave, per Dean).

- New video downloads: when the scan first ingests a genuinely-NEW `.mp4` under
  the yt-dlp download dir, the server losslessly moves its `moov` to the front
  IN PLACE (`ffmpeg -map 0 -c copy -movflags +faststart` -> a verified temp ->
  atomic rename). No re-encode, no re-download, all streams preserved.
- SAFE by construction (this is data-adjacent -- it overwrites a media file):
  it only ever touches `.mp4` (so the mp4-only `-movflags` can never reach a
  webm/mkv muxer), only a genuinely-trailing-moov file, and NEVER replaces the
  original except with a temp that verified as exit-0 + itself-faststart; on ANY
  failure it keeps the original byte-for-byte. mtime preserved.

First attempt (a yt-dlp `--postprocessor-args` flag) was REVERTED: the slim gate
caught it would spray the mp4-only option onto webm/mkv/subtitle postprocessors
and abort those downloads. The app-side remux replaced it.

Gate: full two-reviewer gate (data-adjacent), two rounds. Both seats proved the
never-lose-the-original core in-code, then REQUEST CHANGES on three cheap
findings (missing `-map 0` -> silent stream drop; a crash-left temp indexable as
a phantom card; a mutation-surviving exit-code guard) -- all fixed and
mutation-verified, both APPROVE. Dual-Node full suite **6754/6754** on v22.23.1
and v24.14.0.

Known/disclosed: `!existing` is "new-or-rebuilt", so a fresh db pointed at an
existing yt-dlp library would faststart the whole library once on that scan
(lossless, no storage cost, probe-gated). A hard-kill mid-remux leaves a
harmless (walk-excluded) temp orphan nothing sweeps -- tech-debt #143.
**VERIFICATION IS DEAN'S DEVICE PASS:** ffmpeg isn't in the dev env, so the
"moov actually moves + streams retained" proof is on-device
(`node scripts/probe-faststart.js --list` on a fresh download should NOT list it;
the file keeps its thumbnail/chapters/tracks). The "never lose a file" safety is
proven in-code.

### v1.110.0 - Timestamped sharing: per-chapter share + share-at-current-time (2026-08-12)

Dean: share the ORIGINAL YouTube link WITH a start time. Two surfaces, both
producing `...&t=<seconds>`; client-only (common.js/player.js/watch.js + CSS +
tests). Only for YouTube-derived items (the ones that already have a Share button
/ a server-resolved `watchUrl`); local files are unchanged.

- **Per-chapter share.** Each row in the custom player's chapters menu now has a
  share icon (next to Loop) that shares the video's YouTube link at THAT chapter's
  start time. Only rendered when the item has a `watchUrl`.
- **Share at current time.** The watch-page Share button now PROMPTS "Share video"
  (the plain link) vs "Share at current time (M:SS)" (the link with `?t=<now>`)
  whenever there's a meaningful position (>= 1s, non-live). Under 1s / live it
  shares the plain link directly, unchanged.

Under the hood: one pure `withShareStartTime(url, seconds)` helper sets the `t=`
param on the ALREADY-server-resolved URL via the platform URL parser (never
assembles the identity client-side - the v1.52 discipline), and falls back to the
plain link for any bad input so a share can never emit a broken URL. A reusable
`showChoiceModal` (createElement + textContent, XSS-safe) drives the prompt.

Gate: full two-reviewer gate, both seats APPROVE, every binding mutation-proven
(the URL guards, the modal XSS/settle-once axes, the gating). No CRITICAL/WARNING;
the only notes were explicit non-defects (a redundant guard; a `t=0` edge
unreachable behind the >= 1s gate). Dual-Node full suite **6741/6741** on v22.23.1
and v24.14.0; lint:css TOTAL 0. **Dean's on-device pass PENDING** (share a chapter
-> YouTube opens at that second; Share mid-video -> prompt -> shares at the current
second).

### v1.109.1 - Chapter chip flashes on change instead of obstructing the video (2026-08-12)

Dean, on-device after v1.109.0: he likes the "› Chapter title" chip appearing on
a chapter change but not it "always obstructing the video." So the chip no longer
persists - it FLASHES in for 3s each time the chapter changes (and at playback
start, entering the first chapter), then fades out and stays fully out of the way
(opacity 0, pointer-events:none) until the next change. The other three surfaces
(seek-bar segments, menu highlight, hover tooltip) are unchanged.

Implementation: `.chapter-now` is opacity 0 at rest; player.js's updateChapterNowChip
(only ever called on a real chapter change or the per-load reset) adds `.visible`
then arms a single fade timer (prior timer cleared first, so rapid changes can't
stack). Fade is opacity (kept in the DOM) so display:none never kills the
transition; instant under prefers-reduced-motion. Slim gate (adversarial seat)
APPROVE; both non-blocking suggestions folded (locked the timer-clear guard,
reduced-motion override). Dual-Node 6731/6731. **Dean's on-device pass PENDING.**

### v1.109.0 - Chapter follow-along: segmented seek bar + menu highlight + title chip (2026-08-12)

Dean: "If we have content with chapters, colour the section of the chapter
actively being played so you can follow along and see what portion you're in."
On clarification he chose the full YouTube treatment - both a segmented progress
bar AND a chapters-list highlight, plus a hover tooltip and a persistent title
chip. Client-only (player.js + style.css + tests); chapters already existed
end-to-end, this wave is purely how the CURRENT chapter is surfaced on the custom
control bar. (Native iOS fullscreen video already shows chapters via the native
player, so it's out of scope - nothing to add there.)

- **Segmented seek bar.** A >1-chapter video's seek bar now shows chapter
  boundaries as gap notches, so it reads as segments; the bar's own red fill
  shows how far into the current chapter you are. Built as a JS overlay appended
  into the control strip (no shell-HTML edits) that's absolute + out of the flex
  flow - deliberately NOT wrapping `#seek-bar`, which would have moved it out of
  the mobile two-row `order` layout (the documented trap). The native fill path
  is byte-identical for a chapter-less item. A ResizeObserver keeps the overlay
  aligned across the two-row reflow.
- **Chapters-menu highlight.** The Ch menu marks the chapter you're in in red
  (the same `--yt-red` as the loop-∞ state) and walks down the list as it plays.
  The menu no longer closes when you press play (it now dismisses only the speed
  picker there), so you can open it and actually follow along.
- **Hover tooltip.** Hovering the seek bar names the chapter under the cursor
  (added to the existing scrub-preview), independent of the storyboard so an
  audio-with-chapters item still names the section.
- **Persistent title chip.** A "› Chapter title" chip floats just above the bar,
  updating live; anchored with `bottom: 100%` so it clears the 40/80/26px bar
  heights with no height arithmetic. Hidden when docked / under native controls /
  chapter-less.

Architecture: one shared `currentChapterIndex` resolver (pure, unit-tested)
drives every surface off a single answer, dispatched on the existing rAF fill
loop (no-op unless the chapter changed, so following along costs a comparison
per frame, not a DOM write).

Gate: full two-reviewer gate, both seats APPROVE, every behavioural mutant killed
(the resolver boundaries, the menu CLEAR axis, the segment math). Fix round folded
the non-blocking suggestions: removed a dead `has-seek-chapters` class and closed
a resolver test gap. **Deferred + disclosed:** the YouTube hover-*thicken* (the bar
growing on hover) - it fights the native seek-bar track across all four era themes
and is the least essential piece; the hover *name* tooltip is the hover
deliverable. Scrub deliberately keeps the chip/menu on the committed playhead
(the tooltip shows the scrub target). Dual-Node full suite **6731/6731** on
v22.23.1 and v24.14.0; lint:css TOTAL 0. **Dean's on-device pass PENDING.**

### v1.108.0 - Watch/player polish: Like heart, chapter-loop ∞, modal scroll (2026-08-12)

Three on-device polish items Dean reported, one wave. No server/schema/route
changes - client JS + CSS + tests.

- **Like button reads the right way round (watch page).** The watch-page Like
  button used the v1.30 "primary-when-actionable" convention: UN-liked was
  `btn-primary` (red, a call-to-action), liked was neutral - so red read as
  "click me" and grey as "done", backwards from the familiar YouTube heart. Now
  NOT-liked is a plain neutral/grey `.btn` and LIKED fills the heart + "Liked"
  label RED via `.btn.liked { color: var(--yt-red) }`, mirroring the card corner
  control's already-correct `.card-like-btn.liked`. `aria-pressed` unchanged. The
  card like button, and the Subscribe/Pin buttons (which keep primary-when-
  actionable deliberately), were untouched.
- **Chapter-loop toggle shows ∞ and stops shifting the row.** In the custom
  player's chapters menu, arming a chapter loop showed the word "Looping"; the
  wider word reflowed the row and nudged the button's left border out of line
  with the rows above/below (Dean: "the little line gets pushed"). Now the armed
  label is **∞** (U+221E, a Mathematical Operator with no emoji-presentation
  variant - so iOS renders it as plain text, unlike the pictographic transport
  glyphs the v1.39 lesson warns off), resting stays "Loop", and both ride a
  fixed-width label span (`min-width: 4.5ch`) so the button never resizes between
  states. The bar-level `#chapters-btn` red tint is untouched.
- **Tall modals scroll instead of clipping.** The shared `.modal-content` had no
  height cap or overflow, so the Edit-chapters editor (10-row textarea + hint +
  Save/Cancel) overflowed short viewports and its actions row was clipped AND
  unreachable. Added a `max-height` cap (`vh` fallback then a `dvh` line that
  subtracts the safe-area insets so a PWA never centres the box under the notch/
  home-indicator), `overflow-y: auto`, and a safe-area bottom pad. Shared by
  confirm/move/chapters modals; short modals never reach the cap, so it's a pure
  tall-modal improvement.

Gate: full two-reviewer gate (both seats), two rounds, both APPROVE. What the
gate caught: the adversarial seat fonttools-measured that the ∞ fix had a
**residual ~1-2px reflow** - the armed `.active` state bolded the width-reserving
label, so its `ch` reservation recomputed against the (wider) bold digit on
variable-weight fonts like Geist, nudging the very border the fix was meant to
hold. Fixed weight-invariantly: the label is pinned `font-weight: normal` and the
now-dead `.active` bold removed, so the reservation is identical in both states
(0px shift). The gate also closed a coverage gap (the `.btn.liked` CSS rule had
no source-lock) and I self-caught a vacuous lazy-regex in my own new lock
(overspanned to one of 8 other `font-weight: normal` in the sheet) and re-anchored
it block-scoped; all new locks are mutation-verified.

Known/disclosed tradeoff: the armed ∞ is no longer **bold** (that bold was the
reflow's root cause). The armed state still signals clearly via red colour + the
∞ glyph + the bar-level tint. `lint:css` TOTAL 0, ledger CLEAN. Dual-Node full
suite **6717/6717** on v22.23.1 and v24.14.0. **Dean's on-device pass PENDING**
(arm/disarm a chapter loop on the modern theme and watch the left border hold;
like/unlike a video; open Edit chapters on a short viewport).

### v1.107.0 - Modern theme font: Roboto -> Geist (2026-08-12)

Dean: the modern theme's font felt "slightly sloppy / not super modern... modern,
sleek, high quality, app-like, distinctive, unobtrusive." Swapped the MODERN
theme's face from Roboto to **Geist** (Vercel's product-UI typeface, OFL) - he
picked it from a side-by-side of Geist/Manrope/Plus Jakarta/Inter rendered in a
mock of the modern card grid. MODERN ONLY: the retro eras (2005 Verdana / 2009 &
2014 Arial) keep their own stacks.

- Self-hosted variable woff2 (`public/fonts/geist.woff2`, latin, 100-900, OFL) -
  the same self-host pattern Roboto already used. Named FIRST in the `@font-face`
  list; all 12 shells preload it. Roboto stays bundled as the graceful fallback
  (`Geist -> Roboto -> system`). `[data-theme="2021"]` + the `:root` pre-theme
  default set `--font-family`/`--logo-font`/`--heading-font` to Geist (one font
  across all elements; drops the old proprietary YouTube-Sans-first heading
  stack). `--heading-weight:500` kept - Geist is variable so 500 is a genuine
  master, not a synthesized faux-weight. `font-family` isn't a governed census
  prop, so TOTAL 0.

Gate: both seats APPROVE. The adversarial seat fonttools-verified the woff2 is a
genuine 100-900 variable (real Medium=500). Two fix rounds swept every stale
"Roboto"/"YouTube Sans" reference (the era-picker blurb, CSS comments, and 5 shell
preload comments) -> a forcing guard now fails the suite on any "Roboto" in a
shell. Dual-Node full suite 6715/6715 on v22.23.1 and v24.14.0. **Dean's on-device
pass PENDING** (the "does it feel more modern" arbiter).

### v1.106.0 - Tap-to-expand now-playing + iPad PWA header safe-area (2026-08-12)

Two Dean on-device reports in one small wave.

- **Selecting a track/episode opens the expanded now-playing view (music +
  podcasts).** Dean: stop auto-docking to the mini-player when you SELECT a
  song/episode - go straight to the now-playing view (worth landing on since
  v1.104/v1.105). A fresh select (row tap, up-next tap, shuffle, drill Play,
  continue) now mounts FULL into `#player-slot` and scrolls it into view; a NAV
  (next/prev, and end-of-track auto-advance) KEEPS the player's position -
  expanded stays expanded, docked stays docked (the v1.104/v1.105 behaviour). The
  mini-player appears when you navigate away to browse. Threaded via `playAt(i,
  opts)`; only the registered next/prev handlers pass `{keepPosition:true}`.
- **iPad PWA: the top bar ran under the status bar after exiting fullscreen.**
  Root cause (confirmed with Dean): the status-bar safe-area clearance
  (`env(safe-area-inset-top)`) was applied ONLY in the `<=768px` block. An iPad in
  landscape is >768px -> the desktop header rule, which never consumed `env`.
  Before fullscreen iPadOS RESERVES the status bar (`env`=0, header fine); exiting
  native video fullscreen flips it to OVERLAY (`env` becomes non-zero) but the
  desktop header ignored it -> the top bar got overrun. This fully explains the
  "only after fullscreen" timing with no WebKit-staleness hack. Fix: consume
  `env(safe-area-inset-top)` in the header clearance at ALL widths (base `header`,
  `.app-container`, `--sticky-bar-top`, `.sidebar`, `.ptr-indicator`) - `env` is 0
  on a real desktop (byte-identical there) and non-zero on the iPad PWA.

Gate: both seats APPROVE (no CRITICAL/WARNING; three cheap SUGGESTIONs applied -
a dead deep-link scroll + two test-quality hardenings). Dual-Node full suite
6710/6710 on v22.23.1 and v24.14.0. **Dean's on-device pass PENDING** (the iPad
header especially).

### v1.105.0 - Podcast now-playing view: metadata + show-notes + up-next (2026-08-11)

Dean: "I like it a lot. Can we do the same treatment for the Podcast player?" -
port the v1.104 music now-playing view to podcasts. Dean chose (AskUserQuestion):
include the episode SHOW-NOTES; up-next = the rest of this show's episodes.
Entirely client-side - episode `description` was ALREADY served (publicEpisode),
so no server work and no persist-gate risk. Exec plan in
`docs/exec-plans/completed/v1.105-podcast-nowplaying-view.md`.

- **Next/prev keeps the expanded view (T1):** podcast `playAt` always loaded
  `{dock:true}`, collapsing the expanded view on episode change. Now it keeps the
  player's position (expanded stays expanded; docked/closed still docks).
- **Now-playing panel (T2):** a DOM-built (`textContent`, the podcast module's
  no-raw-HTML law) `#podcast-nowplaying-panel` under `#player-slot`: episode title,
  "Show . date", the show-notes description (height-clamped + scroll), and a
  tappable "Up next" of the show's remaining downloaded episodes. Shown only when
  expanded + a podcast episode playing.
- **Dock-return determinism (T3):** podcasts had the SAME latent
  tap-the-dock-doesn't-return bug music carried before v1.103 (no `?nowplaying`
  strip) - now fixed here too.
- **Re-init reseed (T4):** a dock-tap re-inits the view; `player.getCurrentMeta()`
  was generalized (resumeMode + subId) so the panel re-seeds and rebuilds up-next
  by refetching the show.

**What the gate caught (both seats, two rounds):** a reveal-once STRAND (CRITICAL,
both seats) - the close listener bound only in the play path, not the dock-tap
reseed path, so closing the player after a dock-tap-expand stranded the panel;
and a TOCTOU where a show opened DURING the up-next rebuild fetch could clobber
the list (the `currentShow` guard was pre-await only). Both were parity misses
vs the mirrored music module, fixed + mutation-bound. Both seats APPROVED;
dual-Node full suite 6705/6705 on v22.23.1 and v24.14.0.

**Dean's on-device pass PENDING** (the final arbiter).

### v1.104.0 - Music now-playing view: metadata + up-next queue (2026-08-11)

Dean, on-device right after v1.103: "if I tap a song there's no detail about
song name/album... if I press next track it goes straight to miniplayer." Two
pre-existing gaps in the expanded now-playing view (`#player-slot`), surfaced by
the overhaul. Design wave, exec plan in
`docs/exec-plans/completed/v1.104-music-nowplaying-view.md`. Dean chose (of the
options offered) the FULL now-playing view - metadata + up-next queue.

- **Next/prev no longer collapses the view (T1):** every music track change
  loaded with `{dock:true}`, so next/prev from the expanded view dropped to the
  mini-bar. `loadTrack` now KEEPS the player's position - expanded stays expanded
  (loads into `#player-slot`), docked/closed still docks (browse-while-playing
  unchanged).
- **Now-playing panel (T2):** the shared player host shows only big album art in
  iOS background-audio mode (no track text), so a music-owned
  `#music-nowplaying-panel` under `#player-slot` now renders the metadata (title,
  artist . album) + a tappable "Up next" queue, shown ONLY while the player is
  expanded with a music track playing (hidden/cleared for docked/closed/non-
  music). Because a dock-tap RE-INITS the view (wiping in-memory state), the
  player gained a read-only `getCurrentMeta()` so the panel re-seeds its metadata
  and rebuilds up-next from the stored browse context. Also fixed a latent
  ordering bug where the "Playing from <album>" line read the PREVIOUS track
  (updateNowPlaying ran before the player's currentId updated).

**What the gate caught (both seats, two rounds, no data-loss CRITICAL):** a
race where, on the Songs tab, a dock-tap expand fired a SECOND concurrent track-
list load that desynced the rendered rows from the live queue - so tapping a row
could play the WRONG track (QA scored it CRITICAL, adversarial WARNING; a dead
`if(queue.length)` guard, since `init` fires `render()` unawaited). Fixed by
gating the rebuild on the player being expanded AND letting `render()` own the
Songs/drill queue (only grid tabs rebuild). Also: the reveal-once ERROR/CLOSE
clear on the new panel was only vacuously tested (the panel is born empty) - now
bound behaviourally (populate the panel, then drive docked + player-close, assert
it clears), the exact v1.102/v1.103 repeat class. Both seats APPROVED; dual-Node
full suite 6692/6692 on v22.23.1 and v24.14.0.

**Known residual (disclosed):** tech-debt #142 - `you-nav-tab.test.js` (an
untouched file) flaked on ONE gate run under CPU contention (both my dual-Node
release runs were clean); a contention-sensitive jsdom timing test, same class as
#135/#107. **Dean's on-device pass PENDING** (the final arbiter).

### v1.103.0 - Music page overhaul: artist mosaic + per-tab sort + dock-return fix (2026-08-11)

Dean: the Music page "feels bad on multiple fronts... not polished / not
deterministic / not nice. It's not fun to use." Intake separated the gestalt
into three nameable causes, each fixed here, plus one IA change. Design wave
(exec plan in `docs/exec-plans/completed/v1.103-music-page-overhaul.md`).

- **Artist album-art mosaic (T1-T3):** artist cards were drab text-only boxes
  ("N albums . M tracks", no artwork) clashing with the art-forward album cards.
  Now ONE unified `.music-card` chassis, and artist cards are a **2x2 mosaic of
  their album art** - the server (`groupArtists`) returns up to 4 representative
  album-art track ids (art-carrying albums first, deterministic across re-scans),
  and `data-tiles` (1-4) reflows the CSS so sparse artists still fill the square
  (1 = full bleed, 2 = side-by-side, 3 = one large + two stacked, 4 = grid).
  Subtle shadow + hover lift; each tile carries the reveal-once shimmer.
- **Per-tab sort (T4):** the sort control only affected the Songs tab; Albums and
  Artists silently ignored it (hard-sorted by name). Now every tab has a
  tab-appropriate menu (albums: title / recently-added / release-year / most-
  tracks; artists: name / recently-added / most-songs; songs: the full track set)
  with labels that read per unit, sort **persisted per tab** (sorting Songs by
  duration no longer reorders Artists), and a drill is album-order with the top
  control hidden.
- **Dock-return determinism fix (T5):** Dean's "tapping the mini-player doesn't
  always bring the player back" - root-caused. `?nowplaying=1` (the expand
  trigger) persisted in the URL, so a later dock re-tap navigated to the SAME url
  the bar already showed and the router's same-URL no-op swallowed it, stranding
  the docked player with an empty slot. Fix: strip the transient marker after each
  init consumes it, so every dock-tap is a real transition. (Distinct from the
  DISREGARDED video mini-player item under Planned - that path uses a per-video
  `?v=` url and never collides.)
- **Artists is the default landing (T5b):** browse-by-artist is Dean's primary
  path and the mosaic is the richest surface. A device with a stored tab keeps it
  until the user taps Artists once.

**What the gate caught (both seats, two rounds, no CRITICAL):** an artId
non-determinism (an album with >1 embedded-art track picked the first-seen
representative, so a re-scan could flip a tile's `/albumart` URL and bust its
cache) - fixed with a stable tiebreak + a shuffle-invariance test; and the
reveal-once ERROR/ABORT clear on the new mosaic surface was only source-locked,
not behaviourally bound (the exact v1.102 repeat class) - added a jsdom test that
rejects the artists fetch and proves the skeleton is wiped. Plus the mosaic's
skeleton shimmer-fill, the art-shimmer census (9->10 sites), a sharper
no-dead-option forcing test, and strip-before-expand robustness. Both seats
APPROVED; dual-Node full suite 6679/6679 on v22.23.1 and v24.14.0.

**KNOWN GAP (disclosed):** the exec plan's D3 - making tabs/drills URL-backed for
a working browser Back button + shareable deep links - was DEFERRED. It was
approved primarily as "the clean root-fix for the mini-player bug," but the
simpler `?nowplaying` strip fixed the bug without it, so its remaining value is
just Back/deep-linking. That needs view-level `pushState` against the SPA
router's history/depth invariants (a documented bug-magnet), so it warrants its
own gate rather than riding this wave. Candidate follow-up, Dean's call.

**Dean's on-device pass PENDING** (the final arbiter).

### v1.102.0 - Shimmer sweep tranche 4: the last blank surfaces (2026-08-11)

The final tranche of the shimmer sweep - six surfaces that still painted blank
then snapped in, now all reveal-once. Everything reuses the existing toolkit
(`.skeleton-shimmer`, `buildSkeletonGrid`, the v1.96 `data-loading` barrier);
each seed matches the real box for a zero-shift reveal.

- **Stats dashboard (T4-A):** `seedStatsSkeleton()` seeds all 11 containers before
  the `/api/stats` + `/api/duplicates` fetches (4 fixed-shape tile grids at their
  exact real counts, 7 lists at a representative count), so the whole page no
  longer grows twice as the two fetches land. Error path clears the stats-fed
  containers (duplicates owns its own).
- **Feed-mode home (T4-B):** the ONE home layout with no skeleton - `renderHomeFeed`
  now seeds a `.video-row-card`-shaped shimmer into `#home-feed-host` before
  `/api/home`; every branch (rows / empty / error) reveals once.
- **Setup automation toggles (T4-C):** the 7 `/api/settings`-fed toggles flashed
  their static default then flipped; a `data-loading` reveal-once barrier (grouped
  onto the v1.96 `.watch-actions` sweep - no duplicated literal) shimmers them
  until the single fetch settles, revealing on success AND error. Scoped strictly
  to the `/api/settings`-fed controls (home-feed / modern / push / per-page-sort /
  home-continue live in the same card but are foreign-fed and untouched).
- **Sidebar folders (T4-D):** `#sidebar-folders-list` seeds a `.sidebar-item`-shaped
  skeleton on a COLD sidebar before `/api/config`.
- **Art-decode family (T4-E):** every card image (album / song / drill / sticky
  art, podcast show/episode art, book covers, history thumbs, mobile avatar - 9
  sites) now shimmers its reserved box until the picture decodes, via a shared
  `FileTube.shimmerArt()` that clears on load/error and immediately for a cached
  image - no more flat-tint-then-pop.
- **Row action glyphs (T4-F):** the music song-row and podcast episode-row glyphs
  (queue / like / save / delete) swap `.icon-*` CSS masks for inline chrome-icon
  SVGs, killing the iOS mask-decode pop-in (the v1.87 fix, applied to these rows).

Full gate (both seats APPROVE). Both seats INDEPENDENTLY caught the same real
blocker: a total `/api/config` failure left the new cold sidebar skeleton
shimmering FOREVER (the catch cleared only the grid) - the exact reveal-once
defect this wave exists to prevent, handled on every sibling surface but this one.
Fixed with a guarded `clearSidebarSkeletonOnError` (clears only the skeleton, so a
re-nav error never wipes already-rendered real folders - a refinement over the
reviewers' unguarded prescription) plus a behavioural jsdom binding (the original
test was presence-only, which is why it slipped).

**KNOWN GAPS (disclosed):** (1) the swapped row glyphs no longer follow the
`data-icons` icon skin (a filled/emoji-skin user sees fixed inline SVGs in those
two rows) - the deliberate v1.87 mask->SVG tradeoff to kill the decode lag.
(2) The Library sidebar's PINNED-playlists section still has no cold-load shimmer
(a naive one would reverse-flash for the common no-pins user; it needs the v1.99
persist-last-known reserve, and its cache-prime is dead code) - deferred, tech-debt
#141.

Dual-Node: **Node 22.23.1 6655/6655, Node 24.14.0 6655/6655**, zero failures.
Census 0, ledger clean. **AWAITING DEAN'S ON-DEVICE PASS** - probe list: open
`/stats.html` (the whole dashboard shimmers, doesn't grow twice); a feed-mode home
(rows shimmer, not blank); Settings -> Automation (the toggles shimmer once, never
flip from a wrong default); a cold library load (the left folder rail shimmers);
scroll Music/Podcasts/Books/History (art shimmers, no tint-then-pop); and the
music song-row / podcast episode-row action glyphs should appear instantly on iOS,
not a beat late.

### v1.101.0 - Shimmer sweep tranche 3: the header-right cluster (2026-08-11)

The persistent `.header-right` shipped EMPTY and injected the account menu (after
/api/auth/me) + the notification bell (after a /api/notifications/badge probe)
AFTER their fetches, so the top-right popped in on every full page load. On mobile
the account trigger is `display:none` (account is the You tab), so the mobile
pop-in is the BELL.

- **Account avatar:** reserves a shimmering 32px `.account-avatar` placeholder
  (inside a `.account-menu-trigger`, so it inherits the mobile hide) before the
  fetch, revealed in place on resolve (signed-out / error -> removed, never
  stranded). Zero-shift; no persist (app shells are signed-in).
- **Notification bell:** persists the last-known-enabled flag and, if enabled last
  time, reserves a 22px shimmer bell disc before the badge probe; the probe
  reconciles it (enabled -> real bell; disabled -> removed). The per-device
  reserve keys (bell + v1.99 avatar-bar) now clear on BOTH sign-out AND a fresh
  login, so a shared-browser user switch (explicit OR session-expiry) starts
  clean.

Full gate (both seats APPROVE): the adversarial seat built its OWN behavioural
bell harness (strand/orphan-free across 6 badge outcomes) and mutation-killed all
5 committed tests; it caught the login-side clear gap (session-expiry, now fixed).
QA verified zero-shift from the cascade on both controls. Two non-blocking
residuals tech-debted: the bell reveal is source-locked not jsdom-bound (#139,
behaviour verified by the adversarial harness), and a pre-existing bell/queue
insert reshuffle the placeholder makes briefly visible (#140).

**KNOWN GAPS (disclosed, symmetric to v1.99):** the bell still pops in ONCE on a
first-ever device load (no flag yet), and can collapse once if the feature was
disabled since. Deferred to tranche 4: stats dashboard, feed-mode home, setup
toggles, sidebar folders, art-decode shimmer family.

Dual-Node: **Node 22.23.1 6617/6617, Node 24.14.0 6617/6617**, zero failures.
Census 0, ledger clean. **AWAITING DEAN'S ON-DEVICE PASS** - on any full page load
(mobile: watch the top-right bell; desktop: the account avatar + bell): the header
controls should shimmer in place, not pop into an empty top-right a beat late.

### v1.100.0 - Classic toolbar complete from first paint (2026-08-11)

Dean, on-device (clarifying the v1.98 "top flow flickers" report - it was NOT the
modern avatar bar v1.99 fixed, but the CLASSIC library toolbar): the All/Videos/
Audio + sort/Shuffle/Rescan/view row and the All/New/Watching/Watched + Attribute
row "start with only a few buttons" then grow.

ROOT CAUSE: the format toggle + watch-state toggle were injected in
fetchLibraryPage0 AFTER the /api/videos fetch, so the static sort/rescan/view
buttons painted first and these grew the row a beat later. But both read
SYNCHRONOUS localStorage prefs - they never needed the fetch. FIX: render them at
the TOP of loadLibrary, BEFORE the /api/config + /api/videos awaits (alongside the
grid-skeleton seed), so the toolbar is COMPLETE from first paint - no shimmer
needed (a shimmer would imply loading where there is nothing to load; the grid
below still shimmers). Scoped to the classic toolbar (modern home uses its own
chip chrome) and guarded so a re-sort / cached re-entry never removes+reinserts
them. Attribute stays post-fetch (data-dependent: needs the items to know folder
eligibility - disclosed).

Slim gate (adversarial) APPROVE - mutation-verified the new test binds, and the
modern/feed/cached-home interactions all traced clean. Two non-blocking residuals
disclosed (tech-debt #138): a pre-existing `fetchLibraryPage0` concurrency race
(a fast toggle click during the initial skeleton load can briefly show the old
filter, self-heals) that v1.100 slightly widened; and the feed-mode early render
mounting the toggles into an already-`display:none` toolbar (correctness-neutral).

Dual-Node: **Node 22.23.1 6612/6612, Node 24.14.0 6612/6612**, zero failures.
Census 0, ledger clean. **AWAITING DEAN'S ON-DEVICE PASS** - on the classic home /
a folder view: the toolbar (All/Videos/Audio, sort, Shuffle, Rescan, view + the
All/New/Watching/Watched + Attribute row) should be fully present from the first
paint, not start with a few buttons and grow.

### v1.99.0 - Shimmer sweep tranche 2 + the reveal-once contract (2026-08-11)

Dean, on-device (v1.98 feedback): the top chip-row "flow" flickers / gains-or-
loses a row. Plus: "add it to CONTRIBUTING so any new thing includes this."

- **Avatar-bar flicker (the report).** Root cause was NOT the fixed 6 chips - it's
  the mobile avatar bar ABOVE them, which shipped `hidden` then popped in after
  /api/channels, shoving the chips down (variable recent-uploader count = the
  "more or less"). FIX: persist the last-known count and RESERVE the strip with
  that many shimmer avatar discs before the fetch (the v1.53 capability-cache
  pattern) - the real discs reveal in place (true zero-shift: 56 disc + 4 gap + 14
  line = 74px, matched exactly after the gate caught a 4px miss). Cleared on
  sign-out so a shared-browser user-switch starts fresh.
- **Watch RELATED rail** now shimmers instead of a blank rail (audit row 15).
  (Audit correction: watch COMMENTS load synchronously from localStorage - no
  fetch, no skeleton needed; the audit was wrong.)
- **The CONTRACT.** A new MANDATORY CONTRIBUTING section - "Every fetch-then-render
  surface reveals ONCE - no blank-then-pop" (seed-before-await, zero-shift reuse,
  strand-safe, no flash-backward, reuse the toolkit) - the same standing as the
  design-token rules, so NEW work ships compliant from birth.

**Full gate - both seats earned their keep on the persist-and-reserve bar:** QA
caught a ~4px residual + an overstated "zero-shift" comment/test (presence-not-
binding); the adversarial caught a reverse-COLLAPSE (a stale per-device count
reserving a strip that then collapses) AND that my brand-new contract's strand
clause contradicted its own reference code, AND that a guard test used a
non-discriminating fixture. All fixed (true 14px zero-shift + real height binding;
sign-out cache-clear; reworded contract; a discriminating 3.5 guard input).

**KNOWN GAPS (disclosed):** the avatar bar still pops in ONCE on a first-ever
device load (no cache yet), and can reverse-COLLAPSE once on the paths that skip
sign-out (tab/browser switch without logout, unsubscribe-all, a warm-cache
/api/channels error) - one-time, cosmetic, strictly smaller than the pop-in they
replace. Deferred to tranche 3: header-right cluster (account+bell, structural,
every shell), stats dashboard, feed-mode home, setup toggles, sidebar, art-decode;
plus the secondary chrome-dup hypothesis to confirm on-device.

Dual-Node: **Node 22.23.1 6609/6609, Node 24.14.0 6609/6609**, zero failures.
Census 0, ledger clean. **AWAITING DEAN'S ON-DEVICE PASS** - on mobile modern home:
the top avatar strip + chips should settle in place (shimmer discs -> real), not
pop the chips down a beat late; and the watch related rail shimmers then reveals.

### v1.98.0 - Shimmer sweep, tranche 1: the library views (2026-08-11)

Dean: "any loading moment without shimmer is the defect ... shimmer is beautiful."
The four library landing places - Music, Podcasts, Books, History - painted an
EMPTY host then snapped the whole grid/list in when the fetch resolved
(blank-then-pop, the most common "not a modern app" moment). Now each seeds a
shape-matched skeleton-shimmer into its host BEFORE the fetch; the existing
`host.innerHTML = <real markup>` on resolve is the ONE reveal.

Each skeleton REUSES its view's real container + reserved-aspect box class
(`.book-cover-link` 2/3, `.music-album-art` 1/1, `.podcast-card-art` 1/1,
`.history-thumb` 16/9, the 44px `.music-song-thumb-wrap`), so the swap to real
cards is ZERO-SHIFT. Every view also now CLEARS the shimmer on a fetch error
(they had none before) - a failed first load shows the empty state, never a
forever-shimmer. Music seeds the exact shape of the tab it will reveal (album
grid / text-only artist grid / song list) and skips drills. First tranche of the
FOUC sweep (audit: docs/exec-plans/active/fouc-shimmer-audit.md - remaining
tranches queued: header-right cluster, stats, watch related+comments, feed-mode
home, setup toggles, art-decode shimmer).

**Full gate - and it earned its keep.** QA APPROVE; the adversarial seat blocked
(REQUEST CHANGES) on two ZERO-SHIFT violations the first cut glossed: (1) the
music ARTISTS tab seeded a tall album-card skeleton but artist cards are
text-only and short -> the reveal collapsed, AND it is a localStorage-persisted
COLD landing (a user who left on Artists hits it straight off a page load); (2)
the music DRILL seeded a bare song list that reserved none of the drill's large
header -> the list jumped down. Both FIXED (a dedicated text-only artist skeleton;
drills keep prior content until they paint), plus a podcasts reveal-once
flash-backward (a feed-op refresh re-shimmered already-loaded content) and a
redundant/mislabeled CSS line. Both seats APPROVE round 2, all new bindings
mutation-verified.

Dual-Node: **Node 22.23.1 6602/6602, Node 24.14.0 6602/6602**, zero failures.
Census 0, ledger clean. **AWAITING DEAN'S ON-DEVICE PASS** - open Music / Podcasts
/ Books / History (ideally on a slow connection): each should SHIMMER a
shape-matched placeholder then reveal the real grid/list in place, never blank
then snap. (Artists tab + a cold load into it: still smooth.)

### v1.97.1 - "Hidden" moves to a settings section (2026-08-11)

Dean, on-device (v1.97.0 feedback): the account-menu "Hidden from feed" row label
was too long, and its restore modal did not scroll - past ~7 hidden items the rest
were unreachable. FIX: move the whole restore surface OUT of the account menu and
into a "Hidden" SECTION on the settings page, beside Trash, mirroring that pattern.
The settings page scrolls, so any-length list is reachable, and the label is just
"Hidden". Rows: thumbnail + title + channel, single-tap Restore (un-hide).

The card "Hide from feed" affordance + Undo toast are unchanged; the routes, model
and backup carrier are unchanged (a UI relocation). Slim gate (adversarial) APPROVE
- escaping + empty-state guard mutation-verified, no dangling refs to the removed
modal. Dual-Node: **Node 22.23.1 6584/6584, Node 24.14.0 6584/6584**. Census 0,
ledger clean. **AWAITING DEAN'S ON-DEVICE PASS** - Settings now has a "Hidden"
section (by Trash) listing what you pruned from the feed, each with Restore, and
it scrolls.

### v1.97.0 - "Hide from feed" (per-user, manual, reversible) (2026-08-11)

A manual, NON-algorithmic per-user prune of the MODERN home feed. Tapping "Hide
from feed" on a modern-feed card removes that video from YOUR modern feed only -
it does NOT delete, and the item stays fully findable via search, channel,
playlist, folder, the classic/feed home views, and Liked. Daily-consumption
pruning, not filtering/sorting/recommendation.

- **Model:** a new per-user `user_feed_hidden` table (schema v17), mirroring
  `user_liked` exactly (id-keyed membership, cascade-on-purge, rekey-on-move).
  DELIBERATELY SEPARATE from the admin/global `hidden` RBAC flag (v1.79-1.81):
  different name, different table, never a permission or leak surface.
- **Filter - modern grid ONLY:** applied at the QUERY level in
  `GET /api/home?view=grid`, before the page slice, so pagination stays correct.
  Every other surface (row home feed, /api/videos, search, folder, channel,
  playlist, Liked, music) stays COMPLETE. Media-only, per-VIDEO (channel-level
  hide is a separate future feature).
- **UI:** a modern-feed-only card affordance (the YouTube card-menu spot, next to
  the title - the thumbnail corners are the configurable download/delete/like
  cluster). One tap -> the card leaves + an Undo toast. Reversible restore place
  (no one-way trap): a "Hidden from feed" You-tab (account-menu) row opens a panel
  listing pruned items, each with Restore.
- **Routes:** POST/DELETE/GET /api/feed-hidden, classified `personal` (the user's
  own state, never capability-gated); POST existence-gated + restricted-id guard;
  GET RBAC-filtered so a since-restricted item never leaks into the restore list.

**Full gate (both seats APPROVE) - and it earned its keep, again with a SEAT
SPLIT.** Round 1: QA APPROVE (2 WARNINGs), adversarial REQUEST CHANGES with a
CRITICAL the QA seat missed - the backup/restore path (a curated JSON re-export,
NOT a file copy) had no `feedHidden` field, so `POST /api/admin/restore` would
CASCADE AWAY every user's feed-hidden rows and silently never rebuild them. That
is the id-keyed-carrier persist-gate class this repo has paid for 5+ times, and
the exec plan had even flagged "verify it rides the export" - which hadn't been
done. FIX: `feedHidden` now rides the bundle exactly like `liked` (export +
restore loop + optional-field validation), mutation-verified (deleting the
restore loop turns the round-trip test red; a full HTTP backup->restore of two
users - including an id hidden by BOTH - preserves each per-user). The gate also
bound the GET /api/feed-hidden RBAC filter (the commit claimed "never leaks" but
no test proved it - now a member is restricted from a folder mid-flight and the
item's id AND title must vanish from the restore list) and mitigated a random-sort
paging dupe (de-dupe on append).

**KNOWN GAPS (disclosed):**
- The "Feeling lucky" (random) sort can SKIP a card if you hide-then-scroll in the
  same session (a seeded shuffle re-permutes over the now-smaller set). Cosmetic,
  non-data, self-heals on refresh; the dedupe kills the dupe half, and every
  stable sort (newest/oldest/title/size) is unaffected.
- A late Undo reinserts the card in the DOM at its spot but appends it to the
  client's in-memory list at the end; a subsequent client re-sort could render it
  out of place until the next server fetch (which self-heals). Client-only,
  transient.

Dual-Node: **Node 22.23.1 6580/6580, Node 24.14.0 6580/6580**, zero failures.
**AWAITING DEAN'S ON-DEVICE PASS** - deploy `1.97.0`, then on the modern feed:
(1) each card has a "Hide from feed" control (next to the title) - tap it, the
card leaves and an Undo toast appears; (2) the hidden video is GONE from the
modern feed but still shows up in search / its channel / a playlist / Liked; (3)
the You tab (account menu) has a "Hidden from feed" list with Restore; (4) another
user's feed is unaffected by what you hide.

### v1.96.0 - Watch action bar: shorter buttons + kill the load flash (2026-08-11)

Two on-device watch-page pains, both traced to how the `.watch-actions` action
row is built.

- **A1 - shorter, scoped.** v1.95's mobile `.btn { min-height: 44px }` floor made
  the watch action-row buttons too tall. `.watch-actions .btn` now drops to a new
  tunable token `--size-touch-watch-action: 39px` (5px under the floor, above the
  ~36px pre-v1.95 height), in a fresh EOF `@media (max-width:768px)` block. It
  BEATS the global floor on specificity (0,2,0 > 0,1,0), so ONLY this row shrinks -
  the v1.95 queue/notification/resume 44px controls and the prev-next/playlist
  buttons (outside `.watch-actions`) keep 44px. 39px is Dean's starting number; his
  device pass is the arbiter and the token is a one-line knob.
- **A2 - reveal-once.** The row ships 4 static buttons, then watch.js injects the
  rest (Move/Attribute/Like/Watched/Share/Reheat) after the record loads - a
  partial->full pop-in. Now `.watch-actions` ships a `data-loading` attribute
  (shimmer, every child `visibility:hidden`), and the row reveals ONCE, in final
  state. The reveal is BARRIERED on BOTH async inputs - the media record AND the
  write capability - so Move/Attribute (which mount from whichever of those
  resolves last) are present before the row ever appears.

**Full gate (both seats APPROVE) - and it earned its keep again.** The first pass
BLOCKED: both seats independently caught that Move/Attribute/Delete are gated on
`canModifyLibrary`, which resolves from an INDEPENDENT `fetchCurrentUser()` promise
- so on an admin cold load where `/api/auth/me` lost the race, the row revealed
WITHOUT them and they popped in later: the exact flash the wave targets, for Dean's
own user. The first version's "one late-mount" claim was wrong. FIX: a reveal
barrier (`maybeRevealActionBar()` drops `data-loading` only when
`actionMediaSettled && actionCapabilitySettled`; media releases in the success tail
+ catch, capability in the fetch `.then`/`.catch`/no-probe `else`). The gate also
caught: the reveal-once TEST was presence-not-binding (an `indexOf` found the
catch-path call, so deleting the success reveal stayed green - the repo's most
expensive recurring class) - replaced with a BEHAVIOURAL jsdom integration test
that drives the media-vs-capability resolution order and is mutation-verified to go
RED on a reveal-on-media-alone regression; a "zero-shift" comment that overclaimed
on mobile (corrected: the reveal is zero-shift, but the shimmer box settles ~1->2
wrapped rows under the shimmer as buttons mount invisibly during load - a single
placeholder resize, not a pop-in); and a new token that skipped the mandatory
three-place ceremony (added to the token-scale-lock CONTRACT + the contract doc).

**KNOWN GAPS (disclosed):**
- On a COLD capability cache (first tab session only), the Reheat button still
  mounts ~1 RTT after reveal, after its own yt-dlp health probe - the SOLE
  late-mount not gated by the barrier. Unchanged from before and minimized by the
  v1.53 capability cache (warm cache mounts it pre-reveal). Blocking the whole row
  on that probe would keep the common buttons non-tappable longer.
- The barrier now couples the row's reveal to `/api/auth/me` settling. A
  pathologically slow/hung auth fetch (with the media record fine) would keep the
  static buttons non-tappable under the shimmer. Bounded in practice:
  `fetchCurrentUser` is memoized and shell-primed (usually already resolved at
  init), returns null on error (never hangs on rejection), and a truly dead auth
  fetch degrades the whole page anyway. Both gate seats flagged this as an
  acceptable, non-blocking residual.

Dual-Node: **Node 22.23.1 6562/6562, Node 24.14.0 6562/6562**, zero failures. (One
unrelated jsdom-timer flake was observed once under concurrent mutation-test load,
did not reproduce, and did not touch this diff - disclosed by the QA seat.)
**AWAITING DEAN'S ON-DEVICE PASS** - deploy `1.96.0`, then on mobile: (1) the watch
Queue/Next/Download/Delete/Move/Like/Share buttons are a touch shorter (39px); (2)
opening a video no longer shows the action buttons pop in one-by-one - the row
shimmers then appears complete; (3) as an admin, the Move/Delete buttons appear
WITH the rest, never a beat later (the cold-load race the gate fixed).

### v1.95.0 - Mobile touch targets (bigger hit areas, same look) (2026-08-10)

Dean, on-device: the mobile controls are too small - day-to-day friction, you
need pixel-precise taps. His picks: **bigger HIT AREAS, same visual**, as ONE
systematic `@media (max-width:768px)` pass (not per-control one-offs), keyed on
the existing `--size-touch` (44px) token / the `.pc-btn` exemplar. Covered all
five controls he named:
- **Resume / start-over buttons** (all `.btn`): a 44px min-height floor.
- **Notification dismiss x** and **queue remove x**: pad-only -> a centered 44px
  box. These are glyph-only (`background:none`), so only the INVISIBLE tap area
  grows - the glyph is unchanged ("same look").
- **Queue up/down reorder arrows**: widen the column to 44px + each arrow fills
  it and splits the row height. Two stacked in a compact row can't each be a full
  44px without breaking the row or bleeding into the neighbour; this is a much
  bigger tap zone with no bleed.
- **THE SEEK BAR** (the one Dean stressed - he keeps missing it): the seek input
  grows to FILL the scrub row it already occupies (`#player-slot .player-controls
  #seek-bar { height: 30px }`), so a tap anywhere in that ~2x-taller band grabs
  the scrubber - no more hunting the thin thumb. The drag JS is byte-identical
  (`scrubRatioFromPointer` is rect X/width, height-independent); only the
  pointer-catch area grew.

Card-corner buttons DEFERRED (disclosed): they carry a visible scrim pill, so a
min-size would enlarge the visible button, not just the hit area (not "same look");
Dean didn't name them.

**Full gate (both seats APPROVE) - and the gate earned its keep:** the seats
SPLIT. The adversarial seat approved; the QA seat found a CRITICAL it missed and
blocked merge. The seek band first shipped as a GLOBAL `#seek-bar { height: 44px }`,
but that element is reparented between two FIXED-height bars: the in-slot
`.player-controls` (80px, a `flex-wrap` two-row budget whose own comment cites the
v1.34.1 screenshot where a third row clipped) - a 44px seek grew the scrub row
30->44 so 44+2+44=90 in a 78px `overflow:hidden` box, re-clipping the button row -
and the 26px docked mini-bar (spill + it stole the tap-to-expand gesture). Repo
lesson #7 (measure the container). FIX: scope to the in-slot player and use 30px -
the scrub row is ALREADY 30px (the `.pc-time` line-height), so the seek fills it
WITHOUT growing it (budget untouched, 30+2+44=76<=78); the dock keeps its thin
16px seek. Both seats then independently re-derived the 78px budget, confirmed the
dock is untouched, and hunted the OTHER four controls for the same
container-overflow class (none - their rows have no height cap or scroll rather
than clip). Comment-accuracy WARNING (the "only enlarges the catch area" claim was
false for the global rule) and two SUGGESTIONs also fixed. A new source-lock
(mutation-proven) forbids a regression back to the unscoped global rule.

**KNOWN GAP (disclosed):** the seek band is 30px, not the 44px ideal - the fixed
two-row bar budget can't fit a 44px scrub row without growing the whole bar (which
would change the look + move coupled offsets). 30px (~2x the old 16px, full-width)
is the budget-safe max and truest to "same look." If it still misses on Dean's
device, the escalation is a bigger visible thumb / growing the bar budget - his
device pass is the arbiter of the FEEL.

Dual-Node: **Node 22.23.1 6551/6551, Node 24.14.0 6551/6551**, zero failures.
**AWAITING DEAN'S ON-DEVICE PASS** - deploy `1.95.0`, then on mobile: the resume/
queue/notification controls are easier to tap, and (the headline) tapping near the
seek line now grabs the scrubber instead of missing it.

### v1.94.1 - Scan generates newest-first (home view fills first) (2026-08-10)

Dean's on-device finding during the v1.94.0 preview-clip backfill: the scan fills
folders in **walk order**, so his default home view's folder (`/media/ytdlp`) was
processed LAST - an empty-feeling home for the first hour while the box generated
clips for another share. Fix: a pure `orderScannedByRecency(scannedFiles,
metadata)` sorts the scan's per-file loop **newest-first** by the item's `addedAt`
(the home sort key; falls back to a new file's derived addedAt, then mtime). So
the most-recently-added videos (what the home view shows) get their thumbnail +
sprite + preview-clip sidecars generated first. Helps every future backfill and
content-add. Ordering only changes WHICH files finish first - each file is
processed independently, so the end state is unchanged.

**Slim gate (adversarial seat, APPROVE):** the whole risk was whether the scan
loop is order-dependent. The seat traced all 34 `newMetadata[...]` write sites
(each targets only the current iteration's id) and confirmed every cross-file
coupling is a COMMUTATIVE accumulator (boolean OR `dbChanged`, idempotent Sets
`consumedTombstoneIds`/`freshlyScannedIds`, an order-invariant `processed`
counter, dedup'd notification/pre-extract arrays); the mid-loop db re-check reads
the stable pre-scan snapshot. So the reorder is safe - one arbitrary order swapped
for a purposeful one. The sort is pure + unit-bound (4 mutation-killed tests:
input order != output; persisted-addedAt-wins; mtime/0 fallback). Perf: 16 ms @
1800 files, dwarfed by the per-file ffmpeg work.

Dual-Node: **Node 22.23.1 6549/6549, Node 24.14.0 6549/6549**, zero failures.
**AWAITING DEAN'S ON-DEVICE PASS** - deploy `1.94.1` (already on `:latest`); the
NEXT scan/backfill fills the home view first. (Does not re-run the pass already
in flight.)

### v1.94.0 - Animated hover preview clips (the YouTube hover feel) (2026-08-10)

Dean's realization on-device: the storyboard-STILL card hover (a slideshow of
sampled frames) never felt like YouTube because it isn't video. YouTube's hover
preview is a short **muted video clip** that plays; the storyboard STILLS are a
separate feature (for seek-bar scrubbing). So this wave gives the card hover its
own asset and keeps the scrub sprite for the scrub.

**The clip:** one per video, a **~6s muted MP4 montage** of ~4 short (~1.5s)
snippets sampled across the interior of the video (skip intro/outro), 320px,
H.264/yuv420p/`+faststart`. Generated at scan time in ONE memory-bounded ffmpeg
pass (4 fast input-seeks -> trim/scale/concat -> encode; ~4 short decoders, NOT
the 100-input trap; no temp files). Served by a new RBAC-gated `GET /preview/:id`.

**Disk-keyed, like the v1.93.2 storyboards:** the clip is a sidecar keyed by file
EXISTENCE (no persisted db flag; eligibility derived from duration). The scan
heals/converges on the on-disk clip; the `.pv.mp4` joins ALL 6 sidecar lifecycle
sites (trash/restore/move/prune/purge). It coexists with the sprite: **sprite ->
scrub, clip -> hover**, two assets for two jobs, like YouTube.

**Client:** the card hover now plays a `<video muted loop playsinline>` over the
poster - revealed only once it's actually **playing** (never a blank box; a
not-yet-generated clip 404s -> poster stays), with the ~1.5s intent delay and
the mobile 2-at-a-time cap (+ a mobile decoder-teardown so clips don't pile up
on a long scroll). The storyboard card slideshow is **retired**; the seek-bar
scrub preview is untouched.

**What the full two-reviewer gate did (both seats, two fix rounds):** every
binding mutation-proven (the 6 lifecycle sites, serve RBAC + eligibility, the
planner geometry, the 3-way scan-spawn split). Caught: a lying cross-module
comment (the storyboard code still claimed the card used it); a client fragility
(revealing on `canplay` can stall under `preload=metadata` -> switched to
reveal-on-`playing`, the correct autoplay pattern); mobile decoded-video
accumulation (now released on scroll-away); and a per-card listener-cleanup nit.
Both seats APPROVE.

**Known gaps (disclosed):** the montage ffmpeg + video playback are not runnable
on the dev box - verified by construction + the gate + Dean's device (peak
ffmpeg RSS on the 3-6.5 GB tail; iOS muted-inline autoplay; the montage's
browser/iOS playability). This is another full **backfill** (a video encode per
video, heavier than the sprite grabs, memory-bounded). Residuals in tech-debt
#137 (dead card storyboard payload; 3 unbound lifecycle sites, inherited; blind
backfill mocks, inherited).

Dual-Node: **Node 22.23.1 6545/6545, Node 24.14.0 6545/6545**, zero failures.
**AWAITING DEAN'S ON-DEVICE PASS** - deploy `1.94.0`, then let the scan generate
the clips (they're their own sidecar; the sprites you already have are untouched
- no wipe needed this time):
```
# pin the compose tag to 1.94.0, then:
docker compose pull filetube && docker compose up -d filetube
# the boot/next scan backfills a <id>.pv.mp4 per eligible video (memory-safe).
```
Probe: (1) hover/scroll a grid card -> after ~1.5s a real video clip PLAYS (the
YouTube feel), no black box on un-generated ones; (2) the seek-bar scrub is
unchanged; (3) watch peak ffmpeg RSS on your biggest files during the backfill;
(4) on mobile, scroll a long grid and confirm it stays smooth (2 clips at a time).

### v1.93.3 - Storyboard card preview: polish (delay + crossfade + sharper tiles) (2026-08-10)

Dean's on-device polish pass on the grid-card hover / in-view preview (the seek-
bar scrub preview he loves is untouched). Three tweaks:
- **Starts too fast -> a ~1.5s intent delay.** The preview begins only on
  sustained hover / in-view; a brush-past or fast scroll cancels it before it
  fires (YouTube-style).
- **"Jarring slideshow, not a preview playing" -> crossfade + calmer pace.** The
  storyboard frames are *seconds apart* in the source and were hard-cutting at
  5fps. Now two stacked layers **crossfade** (a 0.25s dissolve) at a calmer
  ~2.2fps, so distant frames read as motion instead of flipping photos.
- **Low-quality tiles -> 2x resolution.** `SB_TILE_W` 160 -> 320 for crisp
  tiles. Because sprites are keyed by file existence (v1.93.2), the *existing*
  160px sprites do not auto-upgrade - they render fine (just soft) until
  regenerated, so this release includes a **one-time sprite wipe + rescan** on
  deploy (below). The v1.93.2 load-guard is preserved (still no black box).

**Slim gate (adversarial seat, both rounds APPROVE):** caught a real WARNING -
the new start-delay timers could breach the mobile 2-card battery cap (stale
`pending` timers weren't cancelled on scroll-out); fixed (prune pending
non-winners in the IntersectionObserver, bound by construction to <=2). One
disclosed **device-to-judge** item: the current *simultaneous* crossfade dips
~25% toward the letterbox black at each midpoint - a possible subtle pulse. Left
for Dean's on-device call; if it reads as a flicker, the fix is a fade-in-on-top
dissolve (a fiddly, untestable-here rewrite, so done with eyes on it) - tech-debt
#136.

Dual-Node: **Node 22.23.1 6531/6531, Node 24.14.0 6531/6531**, zero failures. The
client animation is verified by inspection (private IIFE, no jsdom harness) +
Dean's device. **AWAITING DEAN'S ON-DEVICE PASS** - deploy `1.93.3`, then to
apply the sharper tiles regenerate the sprites (they render soft until then):
```
# in compose pin the tag to 1.93.3, then:
docker compose pull filetube && docker compose up -d filetube
docker exec filetube sh -c 'rm -f /app/data/.thumbnails/*.sb.jpg'   # drop the 160px sprites
# the boot/next scan regenerates them at 320px (fast on 1.93.x)
```
Probe: (1) hover/scroll a card -> preview starts after ~1.5s and crossfades
smoothly (watch for the darkening pulse); (2) after the rescan, tiles are crisp;
(3) no black boxes on un-generated videos.

### v1.93.2 - Storyboard sprites: disk-keyed (derived descriptor) - previews finally serve (2026-08-10)

A correctness fix for a defect the v1.92 storyboard feature carried from day one,
found by Dean's server forensics: storyboards **displayed for NO video**, on any
device, and the scan **regenerated every video forever** (never converged).
Prod db.json: **0 of 2943** records carried a `storyboard` field, 216 sprites on
disk served **0**. One root cause: the per-item descriptor was only committed at
the **END of a full scan pass**, and on a large library that finish line was
never crossed (v1.92 too slow, v1.93.0 OOM'd). Both the serve route and the
scan's "already generated?" check read that never-persisted flag - so nothing
served and the backfill churned endlessly. (The old tests passed because they
completed a full scan in-harness; prod never does - a presence-not-binding trap.)

**The fix - stop depending on the flag entirely.** A storyboard sprite is a
disk-regenerable sidecar whose grid is fully derivable from the video's persisted
duration, so it never needed a DB field. New pure `storyboardDescriptor(item)`
derives the geometry from duration+dims. Now **serving**, the **scan heal
check**, and the **client geometry** all key off the on-disk `<id>.sb.jpg` +
that derivation - the persisted field is removed. Effect on deploy: the **216
existing sprites serve immediately** (no scan needed), and the scan **converges**
(a sprite on disk = skip) with no dependence on a completed pass. The whole
persist-gate class is gone for storyboards.

**What the two-reviewer gate caught (full gate, both seats, two fix rounds):** a
real **CRITICAL** - sending the derived geometry for every eligible video made
the client build the preview overlay for un-generated videos too, and its opaque
(#000) background was revealed with no load guard -> a **black box over the
poster** on hover/scroll for the ~2727 not-yet-generated videos. Fixed: the card
(and the seek-bar scrub) preview now preloads the sprite and reveals only on a
successful load; a 404 leaves the poster. Also caught: **`/api/liked` dropped the
descriptor** (the one card surface not on the updated routes) -> Liked-view
previews regressed -> fixed + a binding test (no test had covered it). Plus a
lying "persisted on db.metadata" comment and dead code (the ignored `tileH`
computation), all corrected. Both seats APPROVE after the fix rounds; every new
test is mutation-bound (the old presence-not-binding trap is closed).

**Known gaps (disclosed):** the client load-guard is verified by inspection +
Dean's device (the StoryboardCards controller is a private IIFE with no jsdom
harness); real ffmpeg generation is Dean's device pass. A card whose sprite 404s
stays on the poster until the grid re-renders (self-heals on navigation). A
pre-existing full-suite flake in the ytdlp reheat-batch tests
(`ytdlp-repull-metadata-endpoint`) surfaces under load and is green in isolation
(tech-debt #135) - orthogonal to this change.

Dual-Node: **Node 22.23.1 6531/6531, Node 24.14.0 6531/6531**, zero failures on
both. **AWAITING DEAN'S ON-DEVICE PASS** - probe list (deploy `1.93.2`, re-pin
compose): (1) previews now SHOW - hover a grid card / scrub the seek bar on an
already-generated video; (2) no black boxes on un-generated videos (poster
stays); (3) Liked-view cards preview too; (4) let one scan complete, then a
second scan is silent (true convergence - the churn is gone).

### v1.93.1 - Storyboard sprites: bounded-memory generation (prod OOM fix) (2026-08-10)

A hotfix for a v1.93.0 memory regression caught **in prod**. v1.93.0's
seek-based generator put all of a video's frames (up to 100) into ONE ffmpeg as
N `-ss <t> -i src` inputs - fast, but ffmpeg opens all N demuxer/decoder
contexts at once, which spiked to **9.3 GB ffmpeg RSS on a large 4K source** (a
44-min episode still hit ~1.8 GB) on Dean's 11 GB host that also runs
vaultwarden - it survived only by swapping, and a 6 GB source or two overlaps
would have OOM-killed a co-tenant. Dean reverted prod to v1.92.0 (peak 120 MB)
and profiled it. This is exactly the v1.93.0 gate's disclosed WARNING 1 /
tech-debt #133, now confirmed on hardware.

**The fix - two ffmpeg stages so the source file is open at most ONCE at a
time:** (1) each frame is grabbed by its own single-input `ffmpeg -ss <t> -i src
-frames:v 1`, run **sequentially** - one decoder resident, ~v1.92's RSS
regardless of file size; (2) the grabbed frames (lossless PNG intermediates) are
tiled into the sprite by one small `image2`-sequence pass that only ever decodes
the tiny tiles, never the source. The seek-based O(framecount) TIME win is kept;
resident MEMORY is now bounded to a single decoder. Grid geometry is unchanged
(same descriptor, same tiles - not the same JPEG bytes), so sprites already on
disk stay valid and are skipped by the reuse scan. Frames live in a
deterministic per-id temp dir, `rmSync`'d in a `finally` on every path (the #110
leak lesson); a single failed grab aborts cleanly (null descriptor, no
half-written sprite).

**What the two-reviewer gate did (full gate, both seats APPROVE):** mutation-
proved the memory bound (only one `-i` per grab, sequential - removing the loop's
`await` or feeding a second `-i` goes red), the leak-free lifecycle (removing the
`finally` rmSync turns the temp-cleanup + failure-path tests red), and geometry
equivalence (`image2` reads `f000..` in seek order, `-start_number 0`); it
refuted an anamorphic-SAR worry (the dropped `setsar` was only a concat
requirement, never a correction). Fix round folded three cheap SUGGESTIONs:
lossless PNG intermediates (no double JPEG recompression - quality parity with
v1.92), a belt-clear of the temp dir after mkdir (closes a crash-leftover
fail-open), and "byte-identical"->"grid-identical" wording. Both seats
re-APPROVED the delta.

**Known gaps (disclosed):** the ffmpeg commands are not runnable on the dev box
(no ffmpeg) - the memory bound is by construction (one `-i` per grab) + gate +
Dean's device RSS probe. Sequential grabs re-open the source once per frame (N
opens; the same cost v1.93.0 already paid, now serialized) - far cheaper than
v1.92's full decode, the accepted tradeoff. Test-robustness residual: the
integration mock is blind to the grab<->assemble file-extension coupling, and the
belt-clear is defense-in-depth not test-bound (tech-debt #134).

Dual-Node: **Node 22.23.1 6527/6527, Node 24.14.0 6527/6527**, zero failures on
both (idle box). **RE-RELEASE HYGIENE:** publish `1.93.1` (versioned); `latest`
auto-follows to this FIXED build, but Dean's compose stays pinned so nothing
auto-deploys. **AWAITING DEAN'S ON-DEVICE PASS** before re-pinning prod - probe
list: (1) run the 4K source that hit 9.3 GB (and a 3-6.5 GB / trailing-moov file)
through 1.93.1 and confirm peak ffmpeg `VmRSS` stays within a few hundred MB;
(2) confirm a fresh sprite scrubs correctly; (3) one anamorphic (non-1 SAR) clip
looks right; (4) let a full first pass complete, then a second scan is silent
(the convergence question, now testable on a memory-safe build).

### v1.93.0 - Storyboard sprites: seek-based sampling (fast generation) (2026-08-10)

A performance fix for the v1.92 storyboard backfill, driven by Dean's live
profiling. v1.92 generated each sprite with FFmpeg's `fps=1/interval` filter,
which **decodes the entire file** to keep one frame per interval - O(filesize).
On Dean's server the first-run backfill measured a median of 5.3s but a brutal
size-skewed tail (p99 193s, max ~10min, and the >600s monsters fell outside the
measurement cap), leaving ~12-24h of grinding on a box pinned 6/6 - ~85-90% of
it the 158 files over 500MB.

**The fix:** replace the full-decode filter with **per-timestamp input seeks**.
Each of the `plan.count` sample points now gets its own `-ss <i*interval> -i src`
(FFmpeg seeks to the prior keyframe and decodes only forward to `t`), and those
single frames are `concat`ed in order and `tile`d into the **identical** sprite
grid. Cost drops to O(framecount) - a few dozen fast seeks, independent of file
size. Only one pure function (`buildStoryboardArgs`) changed; `planStoryboard`,
the descriptor, the `/storyboard/:id` route, and the client renderer are all
untouched. The output geometry is byte-identical, so the sprites already on disk
stay valid and are **skipped** by the reuse scan (it regenerates only on an
absent descriptor / missing file, never by content) - only the un-generated
files regenerate, on the fast path. New/changed videos get the fast path
automatically at scan time.

**What the two-reviewer gate caught (full gate, both seats APPROVE):** the
adversarial seat mutation-tested the three new fix-binding tests (9 mutants, all
killed) and confirmed by measurement that the existing sprites stay valid and
that a seek never over-runs EOF. Both seats flagged a stale documentary comment
in the scan test mock (fixed). Both also raised the one real risk below.

**Known gaps / risks (disclosed):** (1) the FFmpeg command itself is **not
runnable on the dev box** (no ffmpeg) - it's verified by the arg-array unit
tests + the gate's construction analysis, and the real generation is Dean's
device pass. (2) **The seek-based command opens the source file once per frame
(up to 100x for a long video) in a single FFmpeg run.** For a large 4K/HEVC file
that could spike memory and, worst case, get that one FFmpeg process OOM-killed -
in which case that single video silently gets no sprite (graceful: backfill
continues, app stays up, existing sprites safe). Unproven without ffmpeg;
Dean's device pass front-loads a large-file memory probe **before** the mass
backfill, and a bounded-concurrency batching fallback is designed if needed
(tech-debt).

Dual-Node: **Node 22.23.1 6524/6525**, **Node 24.14.0 6522/6525** - every failure
was a pre-existing timing/load flake (`capture-determinism`, `backup-restore`,
`modern-grid-api`), each green in isolation and none touching the changed code;
disclosed, not papered over (suite-flakiness tech-debt). All storyboard/changed
tests green on both. **AWAITING DEAN'S ON-DEVICE PASS** - probe list: (1) on the
new image, before the mass backfill, run ONE of your biggest/4K/longest videos
through it and watch the ffmpeg child's peak RSS (the memory risk above);
(2) confirm a freshly-generated sprite scrubs correctly; (3) let the backfill
finish and confirm the remaining files light up fast (target <1h vs 12-24h);
(4) trigger one more scan and confirm NO new "Restoring" lines (non-churn).

### v1.92.0 - Storyboard previews: seek-bar scrub + card autoplay (2026-08-09)

Dean's two ideas. **Idea 2 (built):** hover-preview thumbnails, YouTube-style.
One **sprite sheet per video** is generated at scan time (a single FFmpeg pass
tiles ~10-100 evenly-sampled frames into one small JPEG beside the thumbnail),
described by a new per-item `storyboard` descriptor. That one asset drives BOTH
affordances: a **seek-bar scrub preview** (hover or touch-drag the bar -> a
thumbnail of that moment + timestamp) and a **grid-card preview** (desktop
hover cycles the frames; mobile does IN-VIEW autoplay - an IntersectionObserver
animates the up-to-2 most-visible cards as you scroll, the YouTube-app feel -
honoring `prefers-reduced-motion`). Scope is **all video with a video stream**
(not mp4-only: FFmpeg reads AVI/MKV natively for frame extraction, so the same
path that already thumbnails the whole library makes sprites for it too - a
mp4-only scope would have skipped ~75% of the library for no reason). New
`GET /storyboard/:id` carries the same `mediaVisibleTo` RBAC guard as
`/thumbnail`; the sprite is a first-class id-keyed sidecar that follows the
media id through trash/restore/move/prune/purge.

**Idea 1 (playback performance): measure-first, fix DEFERRED.** The dev box is a
metadata-only mirror (no ffmpeg, non-existent filePaths), so time-to-first-frame
can't be profiled here. Shipped instead: a read-only `scripts/probe-faststart.js`
Dean runs on his server - it reports what % of his mp4s have a trailing `moov`
atom (the prime "slow to start on click" suspect). The fix (a `+faststart`
remux, or a preload/prefetch change) is its own follow-up once the data is in
(tech-debt #132).

**What the two-reviewer gate caught (full gate, both seats):** a real CRITICAL -
the **desktop card-hover preview was completely inert**: the `.card-preview`
overlay is `pointer-events:none` and a sibling of the thumbnail, so the delegated
`closest('.card-preview')` (which walks the real target's ancestors) never
matched and the animation never started. Fixed by delegating on the interactive
`.thumbnail-container` and resolving the overlay child; verified firing in a
jsdom repro. Also caught + fixed: the mobile IntersectionObserver never
unobserved detached cards (a strong-ref leak, the v1.85 scar); the 6 sprite
lifecycle sites were correct but untested (added a trash->restore->purge binding
test, mutation-verified); a rare orphaned `.sb.jpg` when a file is replaced with
a sub-2s clip; and a dead home-feed storyboard payload. Both seats APPROVE.

**Persist-gate discipline:** the new `storyboard` field is threaded through every
scan write site the `hasThumbnail` field is; a CHANGED file regenerates the
sprite from new content (so no carry-forward guard), and the whole existing
library backfills ONE sprite per item on first scan (bounded, not per-scan churn
- proven by a second-scan zero-spawn test).

**Known gaps (disclosed):** Idea-1 perf fix deferred (probe shipped); real ffmpeg
sprite generation validated by the arg-array unit test + Dean's device pass (this
box has no ffmpeg); the desktop-hover fix is verified by jsdom repro + inspection,
not a committed automated test (the controller is a private IIFE); horizontal
home-ROW cards don't animate yet (grid cards do); card in-view autoplay is a new
mobile interaction whose FEEL is Dean's device pass to judge. No-ffmpeg/failed-gen
scan churn is disclosed-parity with `restoreMissingThumbnail` (tech-debt).

Dual-Node **6522/6522** on v22.23.1 AND v24.14.0. **AWAITING DEAN'S ON-DEVICE
PASS** - probe list: (1) hover a grid card on desktop -> frames cycle; (2) scroll
the grid on your phone -> the centered card autoplays; (3) hover/drag the seek
bar -> a thumbnail of that moment pops up; (4) trash a video then restore it ->
previews still work; (5) run `node scripts/probe-faststart.js` on the server and
send me the trailing-moov %.

### v1.91.2 - Mobile account menu: right-anchored narrow card (2026-08-07)

Follow-on to the v1.91.1 footer polish. Dean (screenshot): the mobile account
menu still "felt off" - it was full-width (`left+right: --space-4`), but the rows
are short and left-aligned, so the whole right half was dead space and it read as
a stretched dropdown. Fixed: release `left` (auto), anchor to the RIGHT edge above
the nav (near the "You" tab it opens from), and cap the width (min 240px, max
min(340px, 100vw - 2*--space-4)) so it's a contained card tied to its trigger.
Desktop dropdown untouched. Slim gate APPROVE (specificity-safe, overflow-safe on
every realistic phone incl a 280px Fold, census clean, source-lock mutation-
verified). Disclosed non-blocking residual: a very long (admin-set) display name
could hard-clip without an ellipsis now that the card is capped - pre-existing
`nowrap`+`overflow:hidden`, one-liner to fix if it ever bites. Dual-Node:
6491/6491 on BOTH v22.23.1 and v24.14.0.

### v1.91.1 - Account-menu version footer alignment (2026-08-07)

Polish on the v1.90 version footer. Dean: the footer was centered under a
left-aligned menu list, so it "felt off" - the eye tracks a clean left edge down
the rows, then the version jumps to the middle. Fixed: it now reads "Version
X.Y.Z", left-aligned at the same horizontal inset (--space-6) as the menu rows,
so it's a quiet footer that belongs to the list instead of a floating centered
stamp. Structural lock (jsdom can't see the visual). Slim gate APPROVE (inset
matches the rows, no wrap/overflow on the narrow menu, census/lint clean, mutation-
verified); one stale-comment SUGGESTION fixed. Dual-Node: 6490/6490 on BOTH
v22.23.1 and v24.14.0.

### v1.91.0 - Dark-mode home-screen (PWA) icon (2026-08-07)

The third of Dean's small tweaks (the version footer + speed sheet shipped in
v1.90.0). Installing the PWA showed the logo with a WHITE box behind it, which
looks wrong on a dark OS. That white is deliberate - iOS renders web-app icon
transparency as BLACK, so `apple-touch-icon.png` is the logo composited onto
opaque white (v1.28.1). This adds a DARK counterpart: `apple-touch-icon-dark.png`
is the same logo composited onto the app's dark surface (#0f0f0f, the manifest
background), generated with no new dependency by `scripts/generate-dark-icons.js`
(reusing the repo's existing `decodePng` + `buildPng`). Every one of the 12 header
shells now links it via `<link rel="apple-touch-icon"
media="(prefers-color-scheme: dark)">`, which iOS 16.4+ honours for the installed
icon; older iOS keeps the light one (graceful, disclosed).

Scope, honest: this is the iOS install-icon half - the actual white box. The
browser TAB favicon was already dark-adaptive (v1.28.1 made it transparent), and
Android composites the transparent manifest icons onto its own surface, so both
were already fine. Android maskable/adaptive-shape icons are a separate
enhancement, deliberately not bundled (a maskable icon needs its own safe-zone
redesign) - can follow if wanted.

Slim gate (adversarial seat): APPROVE, no CRITICAL. The reviewer decoded the dark
PNG pixel-by-pixel (192x192, fully opaque - no alpha<255 black-render trap - dark
corners, white glyph), confirmed the generator reproduces the committed bytes
byte-identically (real provenance), and all 12 shells carry the byte-identical
insertion. One non-blocking WARNING (a compositor test that passed for both the
real blend and a no-op passthrough) fixed with a transparent-input assertion that
pins the exact #0f0f0f fill, mutation-verified. Dual-Node: 6489/6489 on BOTH
v22.23.1 and v24.14.0.

### v1.90.0 - Version footer + all-8 mobile speed sheet (2026-08-07)

Two small tweaks from Dean (the third, an adaptive dark PWA icon, is its own
follow-up branch):

1. **App version at a glance.** A subtle "vX.Y.Z" footer at the bottom of the
   account menu - the ONE menu the desktop header dropdown AND the mobile "You"
   bottom-nav tab both open, so it covers both surfaces. The server stamps
   `<meta name="ft-version">` into every shell's `<head>` (zero extra fetch) and
   the client reads it; absent meta -> no footer, never "vundefined".

2. **Mobile playback-speed picker shows all 8 rates, no scroll.** The inline
   speed popup is clamped to the (often short, letterboxed) video box, so on
   mobile it only showed ~4-5 of the eight rates and you scrolled for the faster
   ones. On mobile the speed button now opens a body-level BOTTOM SHEET that
   escapes the box and shows all eight at full tap size, no scroll. Desktop keeps
   the inline popup. The sheet reuses the same rate model + apply path and is
   torn down on close/teardown/dock so it never outlives its view.

Slim gate (adversarial seat): the gate EARNED ITS KEEP - it caught a real
mobile-only CRITICAL (the sheet built its backdrop but never stored the handle,
so it couldn't be dismissed - it would have trapped you behind a scrim), plus a
presence-not-binding test that passed against that defect, plus a minor post-dock
"dead first tap" WARNING. All fixed and mutation-verified before merge; final
APPROVE. Dual-Node: 6486/6486 on BOTH v22.23.1 and v24.14.0.

### v1.89.0 - The FileTube banner is the built-in default logo (2026-08-07)

Out of the box the header showed the plain "FileTube" text wordmark; the glossy
banner logo only appeared if you UPLOADED it in Settings -> Logo (the v1.32
white-label feature). Now the bundled banner IS the default, theme-aware: the
white-text banner in dark mode, the black-text banner in light mode. Uploading
your own logo still fully overrides it.

Under the hood this reuses the whole existing variant-aware `/logo` pipeline
rather than adding a new path: `GET /logo` now serves a bundled default banner
(shipped under `public/assets/brand/`, which the Docker image copies) whenever no
custom logo is uploaded, and the pre-paint `ft-custom-logo` class is stamped on
every shell unconditionally so the banner never flashes the text wordmark first.
"Remove logo" in Settings now reverts to the default banner; the text wordmark
survives only as the safety fallback if the shipped asset is ever unreadable.

Slim gate (adversarial seat): APPROVE on both the base and the fix-round delta,
no CRITICAL/WARNING. Named attack surfaces all cleared by measurement - the
reviewer defiltered the two PNGs to confirm the dark->white / light->black
mapping is legible (not inverted), proved the `.dockerignore` `/assets` rule
cannot sweep `public/assets/`, and mutation-tested every changed spec. Two
non-blocking suggestions applied: the default bytes are memoized per variant (no
per-request read on default installs), and the light/dark mapping is now bound by
a behavioral, mutation-verified test rather than a source-lock alone. Dual-Node:
6481/6481 on BOTH v22.23.1 and v24.14.0.

Note: this release ALSO carries v1.88.0 (Prev/Next respects the active home pill),
whose Docker image never published - a GitHub Actions platform incident on
2026-08-06 wedged the v1.88.0 publish runs in an uncancellable queued state. This
tag's fresh publish run supersedes it: the v1.89.0 image contains both waves.

### v1.88.0 - Prev/Next respects the active home pill (2026-08-06)

On the Modern (YouTube-style) home, the top pills - All / Videos / Audio /
Podcasts / Continue watching / Unwatched - filter a flat grid served by
`GET /api/home?view=grid&filter=<pill>`. But the browse-context the grid cards
emitted only described the CLASSIC `/api/videos` library (scope/sort/format);
the pill was invisible to it. So after opening (say) an Audio-pill track,
Prev/Next - and autoplay-at-end, and the lock-screen media keys, all three of
which share the one context re-fetch helper - walked the whole library and could
land on a video. Dean: "if I picked audio, next should go to the next audio."

Fix (client-only, no server change): a new `src:'home-grid'` browse-context
carries the pill + the Modern sort + this scroll session's shuffle seed.
`encodeListContext`/`buildContextListUrl` (common.js) learn to rebuild
`/api/home?view=grid&filter=...&sort=...&seed=...`, and `currentBrowseContextParam`
(main.js) emits it whenever Modern mode is active (which is true only on the bare
home - folder/search views render the classic grid and correctly keep the old
scope context). The watch page + autoplay re-fetch that exact query and step the
server's returned order verbatim, media-only (podcast tiles, being non-playable
in the video player, drop out of the walk - the same mixed-kind handling Liked
already uses). The `/api/home?view=grid` endpoint already paginates
deterministically by filter+sort+seed and clamps the limit to `MAX_LIMIT` (10000),
so the re-fetch reproduces the on-screen order with the same accepted bound the
classic context path has always had.

Dean's intake call: carry ALL pills, including the self-mutating Continue /
Unwatched (those lists are re-fetched fresh, so an item you just finished may
have shifted or dropped) - the most predictable behavior, always matching the
pill you picked.

Slim gate (adversarial seat): APPROVE, no CRITICAL/WARNING. All named attack
surfaces cleared by measurement + mutation tests - order parity (full-set sort
before slice), the scope-leak guard (Modern mode is bare-home-only, classic path
byte-identical when off), the mixed-kind media-only walk in both consumers, seed
currency, and the sibling music/liked/videos branches unaffected. New tests
mutation-verified as real bindings. Dual-Node: 6479/6479 on v22.23.1 AND v24.14.0.

Known gap (non-blocking, disclosed): on the All / Videos pills, when the
on-screen next tile is a podcast, the media-only walk SKIPS it to the next
playable item (a podcast can't play in the video player) - intended, same
contract as mixed Liked. On the Podcasts pill the media walk is empty, so
Prev/Next greys out cleanly (podcast cards open their own surface, never the
video player). Dean's on-device pass is the arbiter.

### v1.87.1 - The REAL cold-start pop-in fix: inline-SVG chrome glyphs (2026-08-06)

v1.87.0 did NOT fix the pop-in on Dean's device (the spacing half DID land, which
is how we knew the CSS was live and the diagnosis was wrong). Re-root-caused: the
bottom-nav + top-right glyphs use the `-webkit-mask-image` technique, and on iOS a
mask shows NOTHING until its mask image is DECODED - so on a mobile PWA cold start
the text labels paint first and the glyphs "pop in" a beat later. v1.87.0 inlined
the mask as a data-URI to kill the async FETCH; on-device the pop-in was unchanged,
proving the fetch was never the cause - the DECODE was. The notification bell +
queue never lagged because they are inline `<svg>` (they ride the text layer, no
decode gate).

Fix (Dean's call): render the shared chrome glyphs as inline `<svg>`, exactly like
the bell/queue. A `CHROME_ICON_SVG` map (path data machine-derived from the on-disk
assets, byte-bound in tests) + `chromeIconMarkup()`/`chromeIconEl()` builders.
Converted: the static bottom-nav across ALL 9 shell HTMLs (the nav is duplicated
per shell - index/books/history/music/podcasts/read/setup/stats/watch), the
JS-injected header search toggle + one-off Download button, the nav theme moon/sun
swap, and the modern-home sort caret. Also reverted v1.87.0's 15KB of data-URI
inlining (kept the spacing fix). Accepted trade-off (Dean's explicit call): the
chrome glyphs no longer follow the icon-set picker - like the bell/queue they use
ONE fixed style, ROUNDED (outlined fallback for the four glyphs with no rounded
asset: history, podcast, books, downloads).

Known gap (disclosed): the desktop SIDEBAR + the closed account-menu glyphs are
still `.icon-*` masks - they are NOT first-paint on the reported mobile surface, so
they do not pop in there; left as masks (they still follow the icon-set picker). If
a desktop sidebar pop-in ever bothers Dean, the same conversion extends to them.

Slim adversarial gate (rendering change, no data surface): APPROVE. Caught two real
WARNINGs, both closed: (1) the cross-shell glyph source-lock covered only 1 of 10
glyphs on the 8 non-index shells - a single-glyph regression to a decode-lagging
mask would have shipped green; now every shell x all 10 glyphs are byte-bound
(mutation-verified across the matrix). (2) a wrong suite count in a commit message
(4764 vs the real 4773) - corrected. Dual-Node full suite **6476/6476** on v22.23.1
AND v24.14.0; census 0, ledger clean, lint 0 errors. **Dean's device pass PENDING**
- the cold-start smoothness is the arbiter (v1.87.0 taught us headless can't prove
this one).

### v1.87.0 - Inline first-paint chrome icons (no cold-start pop-in) + even top-right spacing (2026-08-06)

Dean, on-device: on a mobile PWA cold start the bottom-nav and top-right glyphs "pop
in" a beat after their text labels - the row paints as bare words, then the icons
fill. The bell + queue never lagged because they are inline SVGs built in JS (their
markup ships in the first paint); the other glyphs are CSS mask-icons that fetch their
SVG from `/assets/icons/*.svg` asynchronously, so they arrive late. Second report: the
top-right glyphs are unevenly spaced, the search magnifier sitting too far out.

Fix (Dean's explicit choice - inline the critical icons): embed the DEFAULT-set masks
for the first-paint roster into `style.css` as `url("data:image/svg+xml,<minified-svg>")`
so they need no fetch and paint with the labels. Roster = the whole bottom-nav (home,
liked, favorites, playlists, history, podcast, music, books, downloads, theme moon+sun,
settings), the header (search, download, sort chevron), subscriptions' refresh, and the
Home-toolbar view-mode toggle (grid/list) - 17 assets / 18 classes, ~15KB of CSS. The
rounded/filled icon sets keep `url(/assets/...)` (they load only when that set is
chosen); the emoji set is untouched. Spacing: dropped the magnifier's extra
`margin-left` that stacked a second gap on the row's own `gap`, so it sat ~28px from its
neighbour while everything else was 14px apart - now the row shares one uniform gap,
magnifier still rightmost.

Slim adversarial gate (CSS/behavior, no data surface): caught one real WARNING - the
"presence not binding" class. My icon-identity tests bound byte-identity to the on-disk
asset for only 3 of the 16 originally-inlined icons (the glyph-pool members); the other
13 were guarded only by "decodes to a well-formed <svg>", which a garbled-but-valid
embed (a corrupted `d=` path that renders a BLANK mask - the AC7 blank-box class this
wave defends against) would pass in a future edit. The shipped embeds were verified
byte-correct by the reviewer; I closed the future-regression window by rewriting
`critical-icons-inlined.test.js` around a class->asset map that asserts each embed
byte-for-byte against the on-disk SVG (mutation-verified: a one-coordinate path drift
now goes red across a sample of the formerly-unbound icons). Also took the reviewer's
SUGGESTION to inline the view-toggle glyphs (the last chrome icons still fetching from
/assets). Re-confirm: APPROVE. Dual-Node full suite **6466/6466** on v22.23.1 and
v24.14.0; census 0, ledger clean, lint 0 errors. **Dean's device pass PENDING** - the
cold-start smoothness + even spacing are his call.

Known gap (disclosed): `.icon-list`/`.icon-grid` are now inlined, but other non-first-
paint icons (e.g. delete, menu, share, the folder-picker pool glyphs beyond favorites)
deliberately still fetch from /assets - they are not on the first-paint path, so
inlining them would only bloat the CSS. If any of those visibly pop in on a surface
Dean cares about, they can join the roster.

### v1.86.4 - Submitting a search closes the mobile search reveal (2026-08-06)

Dean: on mobile (modern feed), after entering a search - type + Enter, the search
button, OR a history pick - the revealed search bar stayed open; you had to tap the
magnifier again to dismiss it ("incredibly clunky"). Root: the magnifier reveals the
field via the `search-open` class on `<html>`; the history-pick path already closed
it (`wireSearchAffordances`' `onSearch` -> `closeSearch()`), but the DIRECT submit
(`performGlobalSearch`, the shell-owned Enter/search-button handler) navigated without
removing the class. Fix: `performGlobalSearch` now removes `search-open` BEFORE
navigating, so every submit path dismisses the bar. Unconditional + a proven no-op on
desktop (the bar is always visible; the class is never set).

Slim adversarial gate: APPROVE, no findings. Both submit paths (Enter + button) route
through `performGlobalSearch`; the close fires before both nav branches (mutation-
confirmed the ordering assert binds); the history-pick path is untouched. Dual-Node
full suite **6448/6448** on v22.23.1 and v24.14.0; census 0, lint clean. **Dean's device
pass PENDING** - the on-screen dismiss is his call. (Gate noted a PRE-EXISTING music.js
search double-fire, out of scope + unaffected by this fix.)

### v1.86.3 - Uniform header glyph sizes (all 22px) (2026-08-06)

Dean (from a screenshot): the header glyphs were mismatched - the bell and queue
are 22x22 inline SVGs, download/search were 20px mask-icons, and the sort ▾ was a
half-height text CARET. Now all one 22px box:
- download + search mask-icons -> `--fs-4xl` (22px), so their 1em box == the
  bell/queue inline-SVG box.
- the sort control's ▾ text character -> a `keyboard_arrow_down` MASK-ICON
  (`icon-arrow-down`), a full 1em glyph that sizes like the other icons instead of
  a half-height caret.

PROCESS NOTE: pure-render change (no logic/data). Shipped on a LIGHT path - the
human reviewer was skipped per Dean's explicit ONE-TIME approval (a visual size
match is a device-render concern the gate is blind to; his device eyeball is the
arbiter). The automated safety net still ran: dual-Node full suite **6447/6447** on
v22.23.1 and v24.14.0, census 0, source-locks updated + green, lint clean. The
normal two-reviewer gate resumes on the next change (this was NOT a standing
precedent). **Dean's device pass PENDING** - the visual size uniformity is his call;
easy to nudge any single glyph if one still reads off.

### v1.86.2 - Modern feed lazy-load + Home-scroll-to-top + card-delete revert + glyph sizes (2026-08-06)

Dean's on-device batch (all existing patterns, not new logic - Dean's framing):

- **#5 The modern feed LAZY-LOADS.** `GET /api/home?view=grid` now PAGINATES
  ({items,total,offset,limit}) instead of a hard 60-cap - it scrolls forever, like
  the classic grid. The full candidate set is sorted (random SEEDED via
  `createSeededRng` so one scroll session is a stable shuffle - no duplicates
  across appended pages) BEFORE the page slice. The client reuses the classic
  grid's exact sentinel/seed machinery (both render into #video-grid); a chip/sort
  change mints a fresh seed + resets to page 0.
- **#2 The card delete reverts to the pre-YouTube-feed inline two-tap** (Dean:
  "we had this before"). The card's confirming second tap deletes straight to
  (recoverable) Trash, dropping the v1.21 checkbox-gated hard-delete escalation for
  local files ON THE CARD - it goes to Trash either way. The watch-page delete
  keeps its own flow (scoped to the card).
- **#1 Home tap scrolls to the top** when you're already on the feed (was a silent
  no-op) - the mobile grid is ~1 card/screen tall.
- **#3 Header glyphs uniform + larger** to match the bell family: download/search
  -> ~20px, the sort ▾ caret -> ~22px (the caret char fills less of the box).

Full two-reviewer gate (it touches the DELETE path). Both seats REQUEST CHANGES on
round 1 (a shared WARNING: a stale/lying comment on the card-delete path), the
adversarial seat adding a second: the modern grid's per-user RBAC guard
(`mediaVisibleTo`) was UNBOUND by any test (pre-existing since v1.84, the
"presence-not-binding" access-control class) - I BOUND it (a restricted member's
item is now asserted absent on page 0 AND at offset>0; mutation-verified) rather
than tech-debt an access-control gap. Both re-APPROVE on the delta. The delete
stays recoverable (direct to Trash, no new permanent path) + two-tap-gated; the
pagination has no dup/gap/offset-leak (all mutation-confirmed). Dual-Node full
suite green on v22.23.1 and v24.14.0 (**6446/6446**); census 0, ledger CLEAN.
(One Node 22 run flaked 1 integration test under concurrent load - tech-debt #107;
confirmed a flake by an idle re-run at 6446/6446 + a clean Node 24 + integration-
alone.) **Dean's device pass PENDING** - probe: the feed keeps loading on scroll;
the card trash icon is the old "tap -> Sure -> tap"; Home rises to the top; the
glyphs are uniform/larger.

### v1.86.1 - Download/▾ glyph polish + pull-to-refresh horizontal-swipe lockout (2026-08-06)

Dean's on-device polish after v1.86.0:
- **Mobile Download button** now styled like the bell/search glyph buttons - dropped
  the `.btn` box (background/border/shadow), circular hit area, and bumped from
  `--fs-sm` (12px) to `--fs-lg` (15px) so it no longer reads smaller than the ~13px
  sibling glyphs. Desktop keeps the labeled `.btn`.
- **Sort ▾ caret** bumped to `--fs-3xl` (20px) - the caret character reads small at
  header size.
- **Pull-to-refresh no longer fires while swiping the subscriber-avatar circles.**
  Root cause: the PTR `touchmove` measured ONLY the vertical delta, so a horizontal
  swipe on the avatar bar / chip row (horizontal scrollers pinned at the top) with
  any downward drift armed the pull and flashed the rescan spinner constantly. Fix:
  a pure `pullIsHorizontalDrag(dx, dy, slop=12)` helper - a horizontal-dominant drag
  (past the slop AND exceeding the vertical) locks the pull out for the rest of the
  gesture. The slop keeps the first noisy px of a genuine vertical pull from being
  axis-locked.

Slim adversarial gate: APPROVE. Round 1 caught a test-completeness WARNING (the
helper's vertical-dominance clause was unbound - a "presence-not-binding" gap);
closed with mutation-verified assertions (dropping the clause, `Math.abs`, or the
slop boundary each now RED). Dual-Node full suite **6439/6439** on v22.23.1 and
v24.14.0; census 0, ledger CLEAN. **Dean's on-device pass is PENDING** - probe the
box-free/larger Download glyph, the larger ▾, and (the real fix) that swiping the
avatar circles no longer triggers the rescan spinner. Glyph sizes + the 12px
diagonal-lockout threshold are tunable device-feel calls.

### v1.86.0 - Modern-home whole-library sort ▾ + header polish (2026-08-06)

Dean's on-device follow-ups to v1.85.2:

- **A real sort on the modern home.** The modern grid only ever showed the newest
  items; Dean wanted to re-order / "mix it up". `GET /api/home?view=grid` gains a
  `sort` param and now sorts the WHOLE candidate set (via the classic
  `videoQuery.sortItems` comparator - so the two grids stay identical) BEFORE the
  60-item cap, so oldest / largest / "Feeling lucky" span the whole library, not
  just the newest snapshot. The control is a glyph-only ▾ caret, leftmost in the
  header top-right, shown only on the modern home. Its sort menu includes "Feeling
  lucky" (random, re-rolls each pick), so one caret covers ordering AND shuffle -
  no separate shuffle/rescan/list buttons (those stay gone from v1.85.2).
- **Header polish (mobile).** The one-off Download button is glyph-only on mobile
  (keeps its "Download" text on desktop); the search magnifier is pushed to the
  far-right corner, split from the queue/bell/download cluster, and a touch larger.

WHAT THE GATE CAUGHT (full two-reviewer gate, both seats): a real WARNING both
seats found independently - the header sort ▾ lives in the PERSISTENT header, and
the SPA router caches the home view on nav-away WITHOUT firing the view's abort, so
the ▾ was orphaned on Watch/Music/etc. after visiting the modern home. Fixed by
binding its visibility to the home route via `body[data-view="home"]` (display:none
elsewhere, re-shows on cache-restore); the abort listener stays as the destroy-path
teardown. Plus 3 non-blocking suggestions, all closed (the videoQuery test made a
functional bind, the abort listener made idempotent + once, "Feeling lucky" re-rolls
on every pick). Both seats APPROVE on the delta.

KNOWN GAP (disclosed, tech-debt #131): the new modern-sort functional test binds 7
of 8 keys; the `random` case is coverage-blind (set-preserving assertion only, no
seeded rng) - non-blocking, orthogonal to the fix.

Dual-Node full suite green on v22.23.1 and v24.14.0 (**6432/6432**); census 0,
ledger CLEAN. **Dean's on-device pass is PENDING** - probe the sort ▾ (leftmost
top-right, real oldest/largest/feeling-lucky), the glyph-only mobile Download, and
the corner search (eyeball its size - "ever so slightly larger" is a tunable 16px).

### v1.85.2 - One-off Download button root-cause + modern-home declutter (2026-08-06)

Three of Dean's on-device follow-ups, all root-caused before editing (the
diagnosis-discipline norm):

- **#2 (the important one) - the one-off Download button never injected on ANY
  page, both entry points (top-right header button AND the bottom-nav Download).**
  Prior CSS "fixes" failed because it was never CSS. ROOT CAUSE, found by live
  console diagnostics on Dean's device (not theory): the header-button placement
  did `headerRight.insertBefore(btn, headerRight.querySelector('a[href="/setup.html"]'))`,
  and `querySelector` matches ANY descendant. v1.82 folded the Settings link INTO
  the account-menu dropdown - an `<a href="/setup.html">` nested inside
  `#account-menu-root`, itself inside `.header-right`. So the selector matched a
  GRANDCHILD, `insertBefore` requires a direct child, and it threw NotFoundError,
  rejecting the whole injection `.then` into its silent `.catch` - building
  neither entry point. A RACE: invisible in local repros (the one-off probe won
  the race and ran before the account menu injected its link) but deterministic
  on Dean's server (account menu injects first). FIX: scope the anchor to
  `:scope > a[href="/setup.html"]` (direct child only). Mutation-bound regression
  test reproduces Dean's exact DOM. Falsification trail logged: ruled out CSS
  specificity, content blockers, HTTP caching, the health endpoint, element
  removal, and a stale bundle (his injector fingerprint matched HEAD exactly)
  before the live `NotFoundError` pinned the line.
- **#3 + #4 - the modern home showed the default folder-name heading
  ("Downloads") and the sort/shuffle/rescan/list-toggle controls bar** - clutter
  on a clean YouTube-style grid. One CSS rule `.modern-home-mode .section-title
  { display: none }` hides the wrapper that holds BOTH (they are children of the
  same `.section-title`). The modern chip row is a separate sibling above the
  grid, unaffected. Sort needed no code: `GET /api/home?view=grid` already orders
  `addedAt` DESC and the client renders that order verbatim. Source-lock test
  pins the winning selector AND asserts no `#library-content .section-title` rule
  sets `display` (which would defeat the hide at 1,1,0 - the v1.85 device-pass
  lesson applied).

Slim gate (adversarial, no data risk): APPROVE, no CRITICAL/WARNING. One
SUGGESTION: with no direct-child Settings link, the button now appends as the
LAST child of `.header-right`, so it lands to the RIGHT of the avatar - cosmetic,
disclosed to Dean rather than guessed. Both fixes mutation-verified (revert ->
red). Dual-Node full suite green on v22.23.1 and v24.14.0 (**6420/6420**); census
0, ledger CLEAN. **Dean's on-device pass is PENDING** - probe the Download button
(now visible everywhere; eyeball its position vs the avatar) and the decluttered
modern home. Still open: the DESKTOP chip-row clip (#C - awaiting Dean's
screenshot).

### v1.85.1 - Mobile hotfix: search/account menu were dead, header + Download button (2026-08-06)

Dean's v1.85 device pass FAILED on mobile - fixed and re-gated:
- **A/B (the core breakage):** the mobile search magnifier never showed, the
  header avatar stayed visible, and neither the "You" tab nor the avatar opened
  the account menu. Two root causes: a CSS **source-order cascade** bug (the v1.85
  mobile `@media` overrides sat earlier in the stylesheet than their base rules,
  and a media query adds no specificity, so the later base rules won and silently
  defeated all three - fixed by scoping under `.header-right`); and the "You"
  tab **opened-then-closed** (its click bubbled to the document outside-click
  handler - fixed with stopPropagation, mutation-bound).
- **D:** the one-off Download button is now shown in the mobile top-right (id
  selector out-specifies the v1.82 `.btn` hide) - Dean's placement call.
- **E:** the empty band under the mobile header - it reserved 96px for the logo
  row PLUS the now-hidden search row; set to the compact 56px logo-row height,
  coordinated through the one header var so the content offset follows.

Slim gate (adversarial): APPROVE after one WARNING (a stale comment #D made false)
+ minor suggestions were closed. Dual-Node full suite green on v22.23.1 and
v24.14.0 (6416/6416). **Dean's on-device pass is PENDING.** Still open for v1.86:
the DESKTOP chip-row clip (#C - awaiting Dean's screenshot; the earlier mobile
tweak was not the fix), and (from before) the chip row generally. LESSON: a CSS
source-lock that checks a rule EXISTS does not prove it WINS - the CSS-blind-gate
gap; device pass is the arbiter.

### v1.85.0 - Modern-mode polish: mobile search, "You" tab, avatar + corner fixes (2026-08-05)

Dean's four v1.84 device-pass follow-ups:
- **#4 (bug):** in Modern mode a card's bottom-left corner (e.g. Share) rendered
  empty. Root cause was DATA, not CSS (hence modern-only): the grid endpoint's
  item omitted `watchUrl`/`ext`, so any corner needing them silently vanished
  while download/delete (id-only) showed. The grid item now matches the
  /api/videos projection.
- **#3a (bug):** the mobile avatar bar showed no photo for a subscribed channel
  whose avatar lives in the channelId registry (the Subs menu showed it). Now
  /api/channels resolves via the registry. This ALSO fixed a latent v1.84 defect
  the gate's fixtures had never reached: the avatar resolver called ensureYtdlp,
  which MUTATES - on the shared read-cache that is silent corruption (the v1.42
  aliasing hazard), a 500 under the test guard. A read must not mutate; it now
  uses a read-only namespace view. (The "@handle vs display-name" folder MERGE is
  deferred - a channelId-grouping change for a later wave.)
- **#1 (feature):** a mobile search magnifier (top-right) that reveals the search
  field (hidden until tapped, YouTube-app style) and shows your recent searches -
  each individually deletable, plus a clear-all - stored PER-USER and synced
  (schema v16, retention-capped, self-XSS-safe).
- **#2 (feature):** a "You" tab at the bottom-right of the mobile nav (the
  YouTube-app slot) opening your account menu; engineered non-hideable so you
  can't strand your own account access.

Full two-reviewer gate: both APPROVE (a WARNING - a dead cache-clone + false
comment my #3a fix orphaned - plus 4 SUGGESTIONs, all closed in a fix round).
Dual-Node full suite green on v22.23.1 and v24.14.0 (6411/6411). **Dean's
on-device pass is PENDING.** Known follow-ups for v1.86 (Dean, on-device): the
modern chip row is clipped at the bottom by a Downloads banner, and the one-off
header Download button is missing on the main page + mobile (Subscriptions
one-off still works).

### v1.84.0 - Modern YouTube Mode (flat big-tile grid + chips + mobile avatar bar) (2026-08-05)

"Another loop on the YouTube feed" - a new opt-in **Modern mode** checkbox
(Settings -> Appearance), orthogonal to the era skins. When on, the bare home
becomes one **flat big-tile grid** - 3 across on desktop (4 on very wide), one
full-width card on mobile - of rich cards with the three corner action icons
restored, filtered by a one-line **chip row** (All - Videos - Audio - Podcasts -
Continue watching - Unwatched), and on mobile a **bar of your recently-active
subscriptions** in circles pinned up top. Per-card polish: a channel avatar
beside the byline (reusing the same channel-avatar registry the subscription
avatars use, so subscribed channels show their real photo), the "views - age"
line, and the red watched-progress bar. Precedence is modern > the v1.79 feed >
classic; it's a per-user, server-synced pref that composes with any era.

**The framing that shaped it:** there were already THREE home renderers (classic
grid, the v1.79 horizontal shelves - the new-user default Dean was seeing, and
now the modern grid). The chips are **server-driven** (Continue watching /
Unwatched need whole-library scope, not a filter of the loaded page), and the
new `GET /api/home?view=grid` reuses the row path's exact RBAC + hidden-folder
guards. The full two-reviewer gate mutation-confirmed every one of those guards
binds - deleting any of `mediaVisibleTo` / `podcastEpisodeVisibleTo` / the
hidden-folder filter reddens a repro - and that the delete icon on modern tiles
still 403s a `canModifyLibrary`-less member. The gate's one logic catch: the
Unwatched chip now also excludes finished-by-threshold (a 95%-watched-but-
unlatched item is no longer both "done" and "unwatched"). Both seats APPROVE.

**Disclosed:** the modern grid spans media (video+audio) + podcasts; music keeps
its own place (not a chip). The modern card skin (rounded thumbs + channel
avatar) applies wherever modern is on, including folder/search grids - on Dean's
probe list. Dual-Node full suite green on v22.23.1 and v24.14.0 (6384/6384).
**Dean's on-device pass is PENDING.**

### v1.83.0 - Avatar crop (pick any photo, pan + zoom a circle) (2026-08-05)

Dean's v1.82 device-pass wish: "wishing I could use a larger than 1MB image and
then crop / pick a section." Both wishes are one feature. Picking a photo at
either entry point (the account menu's Change photo and Settings->Account) now
opens a **circular crop modal** - drag to pan, pinch/scroll/slider to zoom - and
only the cropped 400x400 region is uploaded. Because the crop **downscales before
upload**, any source photo works (a 12 MP phone shot is fine) and the uploaded
avatar is always tens of KB - so the server route and the 1 MB cap are untouched.
Built in-house, no dependency.

**The correctness lives in three pure functions** (cover min-scale, pan clamp,
source rectangle) so a gap in the circle or an out-of-bounds read is caught by
node:test, not the device. The gate's adversarial seat swept them over **5,184
input combinations** (aspect ratios from 10000x10 to 10x10000, sources smaller
than the circle, zoom from cover to 100x, pan pushed to +/-1e9) with zero gaps
and zero out-of-bounds reads, and killed every geometry mutant. The full lifecycle
(object-URL revoke, single-settle across all exits, Cancel/Escape/backdrop upload
nothing) is bound by a canvas-stub harness. A browser without a real canvas falls
back to a raw upload (the cap then applies). Both seats APPROVE.

Dual-Node full suite green on v22.23.1 and v24.14.0. **Dean's on-device pass is
PENDING** - this one is worth driving: pick a big photo, pan/zoom, Save.

### v1.82.0 - User avatar + account menu (2026-08-05)

The v1.81 T8 fast-follow, expanded at intake into a full account surface. A
YouTube-style **avatar** sits top-right on every shell (your uploaded photo, or
an initials monogram) and opens an **account menu**: your name + role, Change
photo, Liked, History, Settings, a light/dark Theme toggle, and Sign out - one
place for everything. Sign out used to be buried on the Settings page; now it is
one tap from anywhere.

**Per-user profile photo.** Upload a PNG/JPEG/WebP from the menu OR from
Settings->Account; both hit the same self-service endpoint. Stored on disk
per-user (no schema change), served by id, magic-byte + size validated, and
cleaned up when an account is deleted or the instance is restored. A member can
only ever set their OWN photo.

**Consolidation.** The header Settings link and the header light/dark toggle are
gone from all 9 shells - the account menu carries them now. On the mobile bottom
bar, Settings + Theme move to **default-hidden but still addable** from the
customizer (they live in the account menu, which shows on mobile too).

**The gate earned its keep (full two-reviewer gate, new upload surface).** The
upload surface was clean from pass one (self-only writes, magic-byte + cap +
case-normalized allowlist, numeric-id serve with no traversal, delete + restore
cascades). The gate's blockers were: an unbound restore-wipe protection (the
guard existed but no test held it - now mutation-bound), a stale Settings
instruction pointing at the deleted header toggle, and - caught in re-round - a
mobile regression where cleaning a "dead" CSS rule actually un-hid the yt-dlp
Download button (restored). Both seats APPROVE; every fix mutation-proven.

**Deferred / disclosed:** the account menu's Theme is the light/dark toggle only
(the era/skin picker stays in Settings); other users' avatars are not surfaced
beyond your own header. Dual-Node full suite green on v22.23.1 and v24.14.0.
**Dean's on-device pass is PENDING.**

### v1.81.0 - Write-RBAC + honest-denial UI + per-user stats + empty-states (2026-08-05)

The follow-up to v1.80's visibility RBAC: v1.80 controlled what a member can
SEE; v1.81 controls what a member can DO. A new per-user capability
**`canModifyLibrary`** (default OFF for members, admin always bypasses via role)
gates every content-mutating route a member can reach: video delete / move /
chapters-edit / attribute-channel (single AND bulk), trash restore & purge, the
three library scans, cache-clear, and podcast episode delete. Downloads and the
channel registry stay under `canManageSubscriptions`; the playback auto-writes
(`/view`, `/dimensions`) stay ungated by design (Dean's call - they fire during
normal watching, not as a "modify library" intent). Existing members lose
delete/move/edit until an admin grants the flag (Dean-approved) via a new
Settings->Users "Allow edit" toggle.

**The client tells the truth now.** A member without the capability no longer
sees the delete/move/edit affordances (card corners, watch-page buttons, the
player's chapters editor - all gated on the EFFECTIVE admin-OR-flag capability
read from `/api/auth/me`, resolved non-blocking so a slow auth call never stalls
playback), and a denied action shows a plain "you don't have permission" message
with no phantom removal. **Stats are per-user** - a restricted member's
`/api/stats` inventory now shows only their visible library and their own watch
data (v1.80 had scoped the titles but left the volume counts raw - closes
#127a). And every empty video view gets the same helpful intro treatment
books/podcasts already have - no blank surfaces.

**The gate earned its keep (full two-reviewer data-safety gate).** Both seats
independently caught the same CRITICAL: the initial route enumeration MISSED
`POST /api/videos/attribute-channel-bulk` - the bulk sibling of a route that WAS
gated (the recurring "gate one route, miss its plural" scar), through which a
capability-less member could rewrite channel attribution across a whole root and
move files on disk. The adversarial seat also caught the member-mutable library
**config** routes (a member could wipe the folder list). The fix round closed
both, and added a durable **forcing net** (`route-write-classification.test.js`)
that enumerates all ~107 live mutating routes, fails on any unclassified one, and
asserts every capability-gated route refuses a member holding no capabilities -
which then caught **two more** pre-existing holes (the logo upload and the yt-dlp
download-cancel), both closed. Both seats APPROVE, every fix mutation-proven.

**Known gaps (disclosed):**
- **T8 (user avatar + account menu) SPLIT to a v1.82 fast-follow** - Dean
  pre-authorized the split; it is a net-new cross-shell UI component and keeping
  it out kept this gate focused on the write-RBAC core. Its server side is done.
- Books/music have no file-delete route, so there was nothing to gate there.
- Residual #129: a few setup.js maintenance actions (cache-clear, scans) still
  surface nothing on a 403 (non-blocking UX, both seats agreed). Residual #130:
  `POST /api/books/:id/cover` is a shared backfill labeled `personal` and lacks a
  v1.80 visibility check (out of write-RBAC scope).

Dual-Node full suite green on v22.23.1 and v24.14.0. **Dean's on-device pass is
PENDING.**

### v1.80.0 - RBAC: per-user library access control (kid-safe accounts) (2026-08-05)

The v1.44 tranche's final piece, finally built: Dean's private-YouTube goal - a
kid-safe account for his daughter and private book libraries. A per-user
visibility model over ALL FOUR libraries (video, music, podcasts, books). An
admin always sees everything; a member is narrowed by the admin. Two modes: a
**block-list** (see-all-except-checked, the default) and an **allow-list**
(see-ONLY-checked, fail-closed - the right mode for a kid, since new content is
denied by default). Restrictions cover whole libraries, video channels, podcast
shows, and path-prefix roots, and apply to BOTH listings/search/the feed AND
direct file access (a restricted item 404s on its stream/thumbnail/download URL,
so a guessed link fails). `canManageSubscriptions` is now enforced (it was
settable-but-inert), so a kid cannot manage the shared channel registry.

**Architecture:** ONE pure decision point (`lib/auth/visibility.js`) every list
and serve route consults; admin is expressed as an empty restriction index, so
there is no role branch to forget. A `user_restrictions` table (schema v14,
append-only), an admin `PUT /api/users/:id/restrictions` API, and a
Settings->Users->Access editor. No migration: existing installs (one admin, no
restrictions) are byte-unchanged.

**The gate earned its keep.** Full two-reviewer gate PLUS a dedicated
`/security-review` pass - three independent security reviews, the adversarial
seat briefed to break the kid account by any path. The byte-serving routes were
airtight and mutation-proven from the first pass, but the gate found **three
CRITICAL metadata leaks the per-library sweep missed**: `/api/notifications`,
`/api/stats` (mostWatched titles + counts), and `/api/trash` leaked the TITLES
and existence of restricted content to a restricted member - a kid could have
enumerated the names of blocked videos even though the bytes 404'd. It also
found two write-access holes (a restricted member could delete/move a restricted
item; a plain member could pull arbitrary media into the shared library) and
that the podcast subscription registry was ungated. ALL fixed and mutation-bound;
all three seats then APPROVED. This is why the wave was HELD for the gate rather
than auto-shipped.

**Deferred to v1.81 (Dean-approved, disclosed):** per-user subscription lists
(#125 - subs stay shared) and non-admin absolute-path scrubbing (#126 - server-
layout disclosure, not content access). **Low residuals (#127/#128):** the
notification badge COUNT still counts restricted items (titles are hidden); a
sparse trashed-item thumbnail edge; the full AC4 route-classification map; and
members may still modify content they CAN see (the write-RBAC roadmap item).

**Suites:** full `npm test` green on BOTH Node v22.23.1 (6292/6292) and v24.14.0
(6292/6292), 0 fail; census route-count lock at 184. **Dean's device pass
PENDING** - the on-device probe list is in the wave report.

### v1.79.1 - Home feed: the See-all links actually work now (2026-08-05)

Dean's device pass on v1.79.0: the feed itself is "really, really good," but
three of the four row "See all" links were broken/useless, which made it
"pretty untenable." Fixed:

- **New from your subscriptions** pointed at `/subscriptions` (the management
  page). Now `-> /?subs=1`, a NEW subscription-scoped browse: a `GET
  /api/videos?subs=1` filter keeps items under a subscription folder via the
  same name-based join `/api/home` uses (folderName OR channelName in
  `db.ytdlp.subscriptions[].name`; global-until-RBAC, tech-debt #122). Header
  reads "From your subscriptions"; newest-released first.
- **Recently added** pointed at bare `/`, which for a feed-enabled user just
  re-showed the feed (so it "did nothing"). Now `-> /?browse=1`, which FORCES
  the classic grid (all videos, the user's default sort).
- **From your Liked** pointed at `/playlists` (no such route -> 404). Now `->
  /?liked=1`, the real Liked grid (the Liked folder itself was always fine).
- **More from <channel>** already worked (folder view) - untouched.

Client-side, `?subs=1` is a scope (excludes bare-home) and `?browse=1`
force-selects classic, so both escape feed mode cleanly; a configured
defaultView can't clobber either. Slim adversarial gate APPROVE (no CRITICAL);
it caught a divergent-fixture coverage gap - the subs test matched via both
folderName and channelName, so the folderName arm was unbound - now fixed and
mutation-verified. Full `npm test` green on BOTH Node v22.23.1 (6262/6262) and
v24.14.0 (6262/6262), 0 fail. **Dean's device pass PENDING** on the fixed links.

### v1.79.0 - Home feed: a library with a YouTube feel (2026-08-05)

Dean's ask: a YouTube-style home feed - horizontal rows of "Continue watching,"
"New from your subscriptions," "Recently added," "More from X" - as an OPT-IN
mode, leaving the classic sortable file grid available and unchanged. The
thesis, verbatim: "What's new in the LIBRARY, not what's new to watch. It's a
library thing with a YouTube feel," not a YouTube clone.

**What it is.** A per-user, opt-in feed mode. Six deterministic, labeled rows
(no recommender, no collaborative filtering): Continue watching -> New from your
subscriptions -> Recently added -> More from <your top channels> -> From your
Liked -> Watch again. The two personal-engagement rows (continue, liked) MIX all
three player-carried kinds (video, music tracks, podcast episodes); the
library-browsing rows are the media library (which already includes yt-dlp
MP3s - the literal "mixed media" ask). Feed replaces the BARE home only -
drilling into a folder / search / liked view stays the classic grid, which is
exactly where each row's "See all ->" lands.

**Architecture (mirrors v1.78 handoff).** A pure leaf assembler
(`lib/home/feed.js`) selects ids from light per-user candidate records - no DB,
no request, no rendering, no threshold hardcoded. A new per-user `GET /api/home`
gathers the per-user reads, calls the assembler, and resolves the <=48 selected
ids to render fields SERVER-side (`resolveHomeItem`) - the client supplies
nothing, so a client-injected title/href is impossible. The classic render path
is byte-unchanged; feed mode is a purely additive branch in the home view gated
by a per-user `homeFeed` setting ('on'/'off'). The setting is OFF (=> classic)
for existing installs and SEEDED 'on' at user creation, so net-new setups get
the feed out of the box while nobody's existing home changes silently.

**What the gate caught (full two-reviewer gate; both APPROVE across two rounds,
every fix mutation-proven).** The adversarial seat found a real BLOCKING
CRITICAL: the full `npm test` suite was RED - the net-new-user seed broke a
pre-existing "fresh user starts empty" integration assertion, and it slipped
because the pre-commit hook runs the UNIT suite only, so every commit was
locally green while an integration test stayed red. Fixed, and recorded as the
lesson: run the FULL suite after any user-creation/settings change. It also
caught that the T4 client-render path shipped coverage-free (now unit-bound,
escaping mutation-proven) and that the AC7 `__proto__` security test was VACUOUS
(object-literal `__proto__` sets the prototype and doesn't survive JSON, so the
hostile item never became a candidate - rebuilt with a genuine own key). QA
caught a "New from subscriptions" row that could show only-watched items (now
hidden when nothing is unseen) and a blank-home-on-fetch-error case. Every named
attack surface - cross-user bleed, prototype pollution, client-supplied trust,
dead-link offers, classic regression, setting injection, empty/degenerate, and
the jsdom boot-leak that bit v1.78.1 - was measured and held.

**An honest mid-build correction.** The store has NO per-item view count
(`user_watched` is a boolean latch), so the intake's "Popular in your library"
row had no data to stand on. Rather than fabricate a number, it became "From
your Liked" (a real per-user signal), and per-channel rows rank by COUNT of
completed items - the truest "most-watched" the store actually carries.

**Known gaps / disclosed:**
- **"New from your subscriptions" is GLOBAL until RBAC.** Subscriptions are
  shared (not per-user) until the v1.44 tranche builds per-user lists, so this
  row is really "new from THE subscriptions" today; it becomes genuinely
  per-user for free when RBAC lands. Continue-watching, per-channel, From-Liked
  and Watch-again are already truly per-user (progress is per-user since v1.43).
- **No live browser visual smoke** - the client render path is bound by unit
  tests (builders + escaping) and integration tests (the data contract), and
  the reviewers verified classic-mode is byte-unchanged, but the actual
  four-skin + mobile render is DEAN'S DEVICE PASS to confirm (residual #124).
- **First load on a brand-new device** shows classic once before the async
  cross-device seed lands, then self-corrects (the same one-time race the stars
  pref accepts). Feed mode also hides the home Rescan/Shuffle toolbar (toggle to
  classic or use Settings). Residual #123.

**Suites:** full `npm test` green on BOTH Node v22.23.1 (6259/6259) and v24.14.0
(6259/6259), 0 fail. **Dean's device pass PENDING** (the on-device probe list is
in the wave report).

### v1.78.1 - The test suite runs again (2026-08-05)

The follow-up branch Dean asked for right after v1.78.0: "fix this leak." It
turned out to be two problems, and the one that actually broke the suite was
not the leak.

**The real blocker was a v1.78.0 regression, and it was mine.** The device-
handoff card added a 30s poll `setInterval` to `common.js`'s shared boot.
jsdom's `setInterval` returns a plain number with no `unref()`; only
`window.close()` clears it. `star-pref-seed.test.js` boots the real
`common.js` in jsdom but never closed its windows - it predates any boot-time
timer - so that interval stayed live, the test process's event loop never
drained, and under the parallel runner the worker never went idle. The whole
suite hung, deterministically, at ~804 tests. That is what forced v1.78.0 to
ship with `git push --no-verify` (the pre-push hook runs the full suite). The
fix closes the harness's jsdom windows, matching what `shell-smoke` already
did. **The shipped card code is byte-identical - a test-teardown fix, no
product change.** The culprit was pinned with `--test-timeout`, which failed
the one hung test and let the other 6213 finish and name it.

**Residual #110, closed.** ~83 of 182 test files `mkdtemp` a DATA_DIR and
never remove it; this had reached ~1.05M dirs / 91% inodes and was thrashing
the box's filesystem. Rather than edit 83 files, a preload
(`node --require test/helpers/tmp-cleanup.js`, wired into `npm test`) patches
`mkdtempSync` to clean each worker's `filetube-` temp dirs on exit -
deliberately via `--require`, not `NODE_OPTIONS`, so a test's own spawned
CLIs are left untouched (they can mkdtemp a dir the parent still needs). That
took the per-run leak 150 -> 1. The last one was a real CLI bug:
`scripts/migrate-check.js`'s `fail()` calls `process.exit(1)`, which skips its
`finally` cleanup, so the failure path leaked its own tmpDir - fixed with a
`process.on('exit')` handler. Per-run leak is now **0**.

**Gate:** adversarial slim gate, APPROVE across two rounds, every fix
mutation-proven load-bearing (revert any one and the suite hangs or leaks
again). The round-2 findings were both comment-accuracy - a wiring comment
that named `NODE_OPTIONS` where the code uses `--require` (the repo's
recurring lying-comment class), and a tmp-root scope the comment claimed but
the code did not enforce; the latter is now a real containment guard on the
`rm -rf`.

**Result:** `npm test` completes green on both Node v22.23.1 (6214) and
v24.14.0 (6217) in ~75s with **0** leftover temp dirs. The pre-push hook
works again, so v1.78.x no longer needs `--no-verify` - and this retroactively
confirms v1.78.0's suite is green on both Node versions, the one gap that
release disclosed.

### v1.78.0 - Pick up on the PC what's playing on the phone (2026-08-04)

Dean: "awareness of something playing for a user on another device,
allowing handoff or continuation - not control of the other device.
State-aware play so I can pick up on the PC what was playing on the
iPhone. YouTube has something similar - I want that."

Most of "pick up where I left off" already existed - position is near-live
server-side (a progress ping every ~4s, coalesced), the queue is already
one per-user queue, music has its own resume pointer. So this wave built
only the three things genuinely missing: **device identity**, a **presence**
concept ("playing RIGHT NOW on the iPhone" vs history's "was played"), and
the **discovery card**.

**The presence layer.** A device-tagged liveness record piggybacked on the
existing ~4s progress pings of the three player-carried kinds - video,
podcast episode, music track. Ephemeral and in-memory: no schema change, no
migration. A per-device UUID is minted client-side with an auto label
derived from the User-Agent (iPhone, iPad, Mac, PC, Android...). One new
read endpoint, `GET /api/handoff`, resolves the most-recent OTHER-device
presence and returns everything the card renders - title, thumbnail,
destination - all resolved SERVER-side from our own records, so a client
never supplies a title or a link.

**The card.** A YouTube-style "Playing on iPhone" toast, mounted in the
persistent shell (never inside the SPA view-root), bottom-left on desktop
and above the bottom bar on mobile. A live accent dot while playing; "Paused
on iPhone - 18 min ago" through the 30-minute linger window - the
sit-down-at-the-PC case. Click "Continue here" navigates to the kind-correct
surface, which resumes at the near-live position via the EXISTING resume
paths (no new position plumbing). Dismiss suppresses that item+device+state
until it changes. Shows only on the top-level list surfaces, all four era
skins, tokens only.

**Liveness, all with an injectable clock so the TTLs are tested without
sleeping:** a playing entry decays to "paused" 15s after pings stop (the
app-killed case - no beacon ever arrives, and we must not claim the phone
is still playing); an explicit pause beacon flips it immediately; a stopped
entry lingers 30 minutes then expires. Hard caps: 8 devices per user,
least-recently-seen evicted - 1000 incognito UUIDs leave the map at 8.

**What the gate caught.** Both seats APPROVED on the first pass with heavy
mutation work behind it - every TTL, cap, ordering and finished-item
boundary proven to fail its own mutant, cross-user isolation and
prototype-safety proven against two real sessions, the three progress
handlers proven byte-identical for a device-less (old-client / Roku) ping.
The most useful catch happened during implementation, not review:
mutation-testing my OWN commit found two tests that proved nothing - one
asserted "a refused ping records no presence" but would have passed even if
it DID record, because the read endpoint filtered the junk id on the way
out; the other never exercised a body-supplied user id at all. Both are now
bound on the presence map itself, both mutants stay killed. The fix round
applied the QA seat's two suggestions: the card had used an exclude-list and
so showed over the Settings form - now a default-deny include-list scoped to
the list surfaces; and a comment wrongly called the device ids "md5 hex".

**Known gaps, shipping disclosed** (tracker rows 117-120):
- Two devices playing the SAME item fight over progress, last-writer-wins
  every ~4s (true before this wave; handoff makes it easier to trigger).
- Presence is lost on server restart, by design - it degrades to plain
  history resume, and the durable progress is untouched.
- The card surfaces only the MOST RECENT other device (intake ruling 7); if
  that newest entry just finished, the card shows nothing even when an older
  device is still resumable.
- `/api/music/progress` records presence for any well-formed track id with
  no existence gate - pre-v1.78 behavior, bounded by the cap and hidden by
  the card's server-side resolve.
- Roku is out of scope for v1; device rename is deferred.

**Verification, disclosed honestly.** Unit suite 4598/4598 on BOTH
v22.23.1 and v24.14.0; the wave's handoff integration suite green on both;
every other integration file passes individually. The single-invocation
full PARALLEL integration run could not complete on this box - the test
harness's own leaked-tempdir residual (#110) had grown /tmp to ~1M
directories and thrashes the overlay filesystem's journal under 16-way
parallelism - so that one run is DEFERRED to the leak-fix branch that
follows immediately (Dean's call: the code is good, ship it and fix the
harness next). Device pass PENDING - probe list in the report, including one
to eyeball: a video->background-audio handoff must not FLASH "Paused" on the
other device (it should self-correct within one ping).

### v1.77.0 - Pick your folder's icon, in every skin (2026-08-04)

Dean: "for the folders, we have glyphs available... I'd love to be able
to change them out of a pool. For example if I have a Shows folder i'd
like a TV glyph. Additionally each glyph we choose should be out of a
set of four for the different eras." Plus a dropdown in Settings for
folders and for Books/Podcasts, and a note that Liked was "a full star
and needs more in its set".

**20 assignable glyphs**, every one carrying a real variant in all four
icon sets - outlined, rounded, filled and an emoji codepoint. Dean's
four (School, Movies, Shows, Documents) plus sixteen picked for real
home-media folders: Music, Kids, Games, Home video, Photos, Travel,
Work, Cooking, Fitness, Comedy, Pets, Cars, Archive, Radio, Favorites,
and Folder itself as a first-class choice rather than a magic default.
57 new SVGs, sourced from upstream Material.

**A picker on every folder row** in Settings > Media folders, saved
through the existing Save button. **Library icons** for all six entries
(Downloads, Music, Books, Podcasts, History) in Settings > Appearance -
per-user and server-side, so the choice follows you across devices.
Dean named Books and Podcasts; leaving three of six unconfigurable is
the half-parity this repo has been bitten by before.

**Liked got its own glyph.** It rendered `.icon-star`, a plain character
deliberately absent from every icon-set block, so alone among the chrome
it looked identical in all four skins. It now wears `.icon-liked` with a
full set of four. NOTE, since it is the one visible change to an
untouched install: everyone's Liked glyph changes, by design.

An emoji collision shipped disclosed for one gate round - Shows and
Downloads both landed on the TV - and Dean closed it before release:
"i want downloads and shows to not share". Downloads wears a
videocassette now; Shows kept the television.

**What the gate caught.** Both seats, three rounds, and it was worth
every one. Three separate times a comment or commit message claimed a
job was finished when it was not - including the wave's own headline
deliverable: a false claim about `.icon-star` survived in the exact line
the plan named, while new prose asserted it was gone. Three of the fixes
introduced fresh defects of their own: a fix that did not fix, a boot
binding traded away by adopting a prescription without checking what it
removed, and a lock loosened in precisely the way an earlier commit in
this same wave had tightened. The seats reproduced, with a fully green
suite, an invisible glyph, a solid coloured square, and one destination
wearing two different glyphs - the exact failures the wave was built to
make impossible. All closed and mutation-verified.

**Known gaps, shipping disclosed.** Ten older glyphs (heart, share,
flame, history, queue, podcast, downloads, books, grid, list) still fall
back across sets - ruled out of scope, tracker row 113. The glyph locks
bind document order, not the CSS cascade, so `!important` and
higher-specificity overrides stay invisible to them (row 116); no such
override exists today, verified directly against the stylesheet. The
token census still cannot see inline styles built into innerHTML
strings (row 115). `subscriptions.html` has no Liked entry at all -
pre-existing and unrelated (row 114).

Dual-Node 6138/6138 on both v22.23.1 and v24.14.0. Device pass PENDING.

### v1.76.0 - One drag-to-reorder gesture, everywhere (2026-08-04)

Dean asked for the Settings up/down arrows to become drag-and-drop "like
the sidebar", plus a taller directories box with room between rows.
Investigating first inverted the request. All five existing reorder
surfaces used native HTML5 drag, which does not fire on iOS touch AT
ALL - so reordering had been desktop-only since v1.15.0, and the drag
handle he called "decorative" genuinely was, on his phone. Copying that
wiring onto the bottom bar would have shipped a MOBILE reorder that
cannot be dragged on mobile. His ruling: one shared pointer-event
helper, delete the arrows, and migrate all five shipped surfaces too -
"let's triple the blast radius. Let's do it right."

`wireReorderable` (public/js/common.js) is now the ONE gesture layer:
pointer events for mouse, touch and pen in a single code path. A touch
drag arms on a 300ms long-press anywhere on the row - which is what
lets the whole row be a drag surface without stealing the list's scroll
- or immediately from the handle. Six surfaces wired: the bottom-bar
editor and the Setup directory list (both lost their up/down buttons),
both folder sidebars, the pinned sidebar and the subscriptions list.
25 native drag listeners and 5 `draggable="true"` sites deleted. The
ordering primitives (`moveArrayItem`, `computeDropIndex`,
`rebuildFullFolderOrder`), every route and every payload shape are
unchanged - this was a gesture-layer swap, not a semantics change.

Keyboard access replaces the arrows rather than dropping with them: the
drag handle is focusable, arrow keys reorder, Home/End jump to the
ends, and focus follows the item across the re-render so a second press
works. The Setup directories box grows to min(60vh, 520px) with more
gap between rows, and drags auto-scroll it at the edges.

WHAT THE GATE CAUGHT (six rounds across two seats, and most of it was
mine): a CRITICAL desktop regression invisible to the entire suite - I
disabled native drag by REMOVING the `draggable` attribute, but an
absent attribute means "UA default" and that default is TRUE for <a>
and <img>, which three of the six surfaces render their rows as; a lock
I wrote to fix an earlier finding that was itself satisfied by PROSE,
binding two of the six surfaces while claiming all six; three arming
constants no test could fail because every test imported the constant
it exercised; a failing assertion mid-drag that HUNG the process
instead of failing, which would have defeated the pre-commit hook; the
subscriptions surface migrated with zero execution binding, where
swapping two index arguments survived all 4472 unit tests; and a
comment whose stated root cause was simply false. Every one is now
bound by mutation testing rather than by reading.

KNOWN GAPS, shipped disclosed: the playback queue panel is a SEVENTH
reorderable list and still has up/down buttons - Dean's ruling did not
name it, so it was not migrated on my own authority (#111, and
docs/CONTRIBUTING.md's new MANDATORY rule names the exception rather
than asserting a universal that is false). Two surfaces have no
page-level auto-scroll, so a row can only be dragged within the visible
viewport - for the subscriptions list on DESKTOP that is a mild
capability reduction against v1.75.0, since native drag gave viewport
auto-scroll free (#112). The drag handle is a role=button that Enter
does not activate (#109). And native browser drag behaviour is the one
thing neither seat could measure - Dean's desktop pass is the arbiter.

Separately found and recorded while the wave was blocked by it: the
test suite leaks mkdtemp scratch directories - 179 files call
mkdtempSync, 38 with no cleanup - and /tmp had accumulated 1,199,739 of
them, exhausting the box's inodes and halting all work until reclaimed
by hand (#110). Bytes were never the problem; `df -h` showed 42 GB free
throughout.

Suites: 6071/6071 on BOTH node 22.23.1 and 24.14.0 (was 5957 at
v1.75.0). Device pass PENDING.

### v1.75.0 - Liked consolidation + bottom-bar freedom (2026-08-04)

Dean's three asks. (1) The per-kind Liked surfaces are gone - the
podcasts place's Liked card/lane and the music place's Liked tab both
removed - because the central mixed-kind /?liked=1 playlist already
shows everything they showed, in full, without their quirks. That
CLOSES tech-debt #93 by removal. The hearts stay everywhere (ruling
R1): they are the WRITE surfaces, the central playlist is the one READ
surface, and docs/CONTRIBUTING.md's capability 4 now records a new
kind-scoped Liked lane as a defect to add rather than a complement.
(2) The bottom bar's two hard-bound anchors retire: home and settings
were pinned first/last and un-hideable, and are now ordinary roster
entries - sortable and hidable like the rest. (3) A new Liked entry
joins them, default-HIDDEN and opt-in via Settings (ruling R3, the
v1.71/v1.72 posture), in all nine shells, wearing the same icon-star
the sidebar Liked entry wears.

THE FINDING THAT REFRAMED ASK #2, and the wave's one deliberate
behaviour change: "In bottom bar, Home is not always left-most bound"
turned out to be a BUG REPORT, not only a feature request. A
flex-`order:` ladder from v1.39.2 was pinning seven data-nav ids and
leaving the four added since (history, podcasts, music, downloads) at
the CSS default of `order: 0`, which sorts them BEFORE everything - so
History rendered to the LEFT of Home on every phone. Worse, CSS
`order` beats DOM order outright, so v1.44's reorder feature had never
been able to move any of the seven pinned items: the Settings panel
has been lying about the bar's sequence for eleven releases. No test
bound the ladder. It is deleted, and the resolver plus
applyBottomNavCustomization are now the sole authority on sequence.

CONSEQUENCE, disclosed rather than buried: an untouched device keeps
identical bar MEMBERSHIP and opt-in state, but its ORDER changes
exactly where the CSS had been overriding the resolver - History moves
from far-left to third; with yt-dlp on, Light/Dark moves left of
Download/Subs; an opted-in Books moves left of Light/Dark; and opted-in
Podcasts/Music/Downloads move RIGHT, from left-of-Home into the middle.
This partially overrides ruling R4's "the default look is unchanged".
Shipping "make it sortable" on top of a CSS layer that pinned 7 of 12
positions was the alternative. Dean's call to revert.

FULL gate, both seats, 3 rounds each (round 3 on Dean's explicit
authorisation, the pacing norm caps at 2). It found real things, most
of them in my own work:
- I INTRODUCED A REGRESSION deleting the ladder: it had also been
  pinning the two async-injected items, so Download and Subs began
  swapping between page loads, and applyBottomNavCustomization became
  non-idempotent (it re-appends visible items, then reads back its own
  output). Fixed by ranking config-unnamed ids by roster index, making
  the resolved sequence a pure function of the config.
- MY JUSTIFICATION WAS FACTUALLY WRONG: `books` was pinned at 5, not
  unpinned. Four ids were unpinned, not five. That error shipped in
  four places and left the consequence list above incomplete.
- An EMPTY-BAR HOLE in this wave's own floor: the Downloads injector
  removes a bar item without re-resolving, so a legal Downloads-only
  bar could be emptied by a config change or a transient /api/config
  failure, reproducing on every reload. Unauthorable before v1.75,
  because home/settings could not be hidden.
- THE DECISION-VS-USE STRIKE, in the fix round that named it: the new
  highlight helpers were tested as values with their only call site
  unreachable from Node; three mutants survived all 5955 tests, one
  nulling the sidebar highlight app-wide. The DOM pass is now hoisted,
  exported and jsdom-bound.
- Six invariants that the seats measured SURVIVING mutation and are now
  dead: the CSS lock missed multi-line rules, alternate selector shapes
  and `flex-direction: row-reverse`; the roster's order was unbound;
  the Settings copy could revert to its retired promise; the sidebar
  liked mapping could be deleted; and the lock's own "verified against
  real mutants" test was a COPY of the lock, so gutting the parser left
  both locks vacuous with the suite green.
- Four stale comments describing the deleted lane, one of which
  (server.js, at the /api/liked call site) flatly contradicted the
  CONTRIBUTING edit this wave exists to make; and a probe list that
  still promised "the identical bar", which would have had Dean
  correctly failing the wave against its own definition of done.
One gate suggestion was CONSIDERED AND DECLINED with the reasoning
recorded in code (resolving the Settings panel's ticks against the live
bar would make Subscriptions/Download un-tickable on a module-off
device); the adversarial seat re-derived it and withdrew the
suggestion.

Also caught, by re-deriving rather than trusting the plan: retiring the
music Liked tab would have left every device that had it SELECTED on a
permanently blank /music. The tab persists in localStorage and render()
has no else-arm. There is no ?tab= deep link - the plan's assumption -
so the stale pref was the whole exposure.

Known gaps, disclosed: #104 (no max-visible cap on the bar - Dean's
explicit call at intake; the roster grew 9 -> 12), #105 (three routes
are now client-dead and deliberately kept: GET /api/podcasts/liked,
/api/podcasts/episodes?filter=liked, /api/music?filter=liked), #106
(the DOMContentLoaded/router closure is unreachable from the
require-based test harness, so nothing binds that the router CALLS the
highlight pass - pre-existing, and this wave shrank the boundary; two
minor test-hygiene items ride along), #107 (release-qualifying suites
need an idle box). #42 (server-side bottom-nav prefs) stays open and
was explicitly out of scope.

Dual-Node: 5957/5957 pass, 0 fail, 0 skipped on BOTH v22.23.1 and
v24.14.0, sequential, reviewers idle. Reported in full: two EARLIER
Node 24 runs went red (1 fail, then 11 fail) while the box was still
draining the reviewers' mutation work - a different failing set each
time, every one an integration test whose real HTTP call hit
ECONNRESET or timed out, none in a surface this wave touches. Both
versions were then re-run on an idle box for the matched pair above.
Dean's device pass PENDING.

### v1.74.0 - Era-appropriate scrollbars (2026-08-03)

Dean's ask: every scrollbar in the app was browser-default. Now the
viewport and every inner scroller (queue, sheets, modals, reader)
theme with the active era skin, consuming ONLY existing era-palette
tokens (zero new token names, census ceiling held at 0): 2005 gets
the chunky 16px hard-edged bordered thumb of its OS era, 2009 the
same button-face at 14px in the warm grays, 2014 a flat borderless
bar, 2021 the modern floating pill (one border-radius: var(--radius-lg)
declaration renders the right shape in all four eras). Dark mode
follows automatically. Firefox rides the standard
scrollbar-color/scrollbar-width pair inside an @supports guard that
is load-bearing: Chromium 121+ discards ALL ::-webkit-scrollbar art
when either standard property applies, so the guard partitions the
engines. iOS ignores webkit scrollbar styling entirely (native
overlay bars) - this wave is DESKTOP-visible; macOS now renders
always-visible styled bars (accepted as era-appropriate).

Slim gate, 2 rounds, APPROVE: round 1 measured three real findings -
my pairing lock did not bind (two surviving mutants: a deleted
viewport-bar selector shipped green), the token census is
SELECTOR-blind to [data-theme]-scoped consumer rules (a raw hex there
passes --enforce at TOTAL 0; now ratcheted by a section-wide
tokens-only lock in era-scrollbar-css.test.js, linter gap = tech-debt
#103), and Firefox inner scrollers missed the thin width because
scrollbar-width does not inherit. All findings applied; delta round
re-measured every mutant dead. Known gaps, disclosed: #103 (the
linter blindness, guarded in-test for this section only; named-color
literals like `silver` evade both nets - exact parity with the
linter's own governed-color regex), and Firefox-side styling is
palette-only (no thumb borders/radius exist in the standard system).

Dual-Node: 5904/5904 pass, 0 fail on BOTH v22.23.1 and v24.14.0
(sequential, reviewer idle). Dean's device pass PENDING - a desktop
browser is the probe surface for this wave, not the iPhone.

### v1.73.2 - Books gets its glyph + Dean's docs housekeeping (2026-08-03)

Dean's polish find: Books was the last Library citizen wearing the
generic folder icon. A Material menu_book asset joins the pipeline
(single-asset posture, emoji set U+1F4DA included up front - the
v1.73 W2 lesson applied preemptively), switching the Library
injector, the Playlists sheet mirror, and all nine bottom-nav shells
together. Rides along: Dean's own housekeeping (four shipped exec
plans to completed/ - closing their Stops on his authority - and
four reference docs into docs/references/) with the pointer sweep it
demanded, which then pulled the thread on 13 pre-existing dead
exec-plan citations in code comments, all repointed with their
targets verified real.

Slim gate, 3 rounds (Dean invoked the round-3 rule and chose
ship-then-clean): round 1 caught the new lock binding two of its
four claimed CSS memberships (both deletion mutants survived the
full suite - now bound), a divergent fixture, and a husk-proof
asset assert; rounds 2-3 caught the sweep-completeness claim FALSE
TWICE - my grep missed LINE-SPLIT path citations. DISCLOSED PARTIAL
per the seat's approval condition: four split-line dead citations
remain in code comments (server.js:8685, videoQuery.js:7,
player.js:639, common.js:1916), two in ARCHITECTURE.md (272, 351),
and ~16 across test headers - zero runtime effect, all targets
findable; tech-debt #102 carries the split-line-aware grep as the
repro and the cleanup lands as the immediate next branch. Dual-Node:
v22.23.1 = 5890/5890, 0 fail; v24.14.0 = 5890/5890, 0 fail. Device
pass PENDING.

### v1.73.1 - The Downloads dupe dies everywhere (2026-08-03)

Dean's device find minutes after v1.73.0: the new hard "Downloads"
Library entry shipped NEXT TO the old synthetic ytdlp folder row (a
visible dupe), and the default-view picker leaked the raw directory
basename - Downloads WAS selectable as the home landing, just wearing
the wrong name. The shared sidebar filter now drops synthetic folders
(the hard entry owns the surface; DnD reorder math treats them like
hiddenFromSidebar - absolute position preserved), and the picker
labels the un-renamed synthetic folder "Downloads" while honoring a
custom rename and keeping the saved defaultView VALUE unchanged.
Nothing for users to remove - the folder stays alive in Setup and
/?root= browsing.

Slim gate (adversarial alone), 2 rounds + a one-assert closeout: it
proved the v1.41.4 class re-bit at its own documented site - the fix
missed the WATCH page's sidebar renderer (one video tap repainted the
dupe into the shared shell) and the mobile Playlists sheet, which
also needed a Downloads MIRROR in the same commit or mobile lost
access entirely; and three of the four threaded call sites were
unbound (dropped-arg mutants survived the full suite). All fixed;
nine of nine links in the threading chain now mutation-verified
bound, incl. the snapshot builder the seat's final pass caught.
Coherent design split on record: the Library entry + sheet mirror are
fixed-label "Downloads"; the picker + Setup box honor a rename.
Dual-Node: v22.23.1 = 5889/5889, 0 fail; v24.14.0 = 5889/5889, 0
fail. Device pass PENDING.

### v1.73.0 - The audio chrome converges + Downloads graduates (2026-08-03)

Dean's same-morning follow-up to v1.72.0, nine rulings. His device
bug died first: the watch page's manual Next with a podcast/track
queued hand-built /watch.html?v= and showed "Failed to Load Media" -
the LAST legacy queue arm now rides the kind-aware queueEntryHref.
The architectural ruling: one player engine already existed, the
AUDIO CHROME had forked - music now mounts the same now-playing view
podcasts got in v1.71 (dock tap -> /music?nowplaying=1, one
gesture), square covers render clean (contain + backdrop - the
side-echo is gone), and the control bar grows a queue-aware
Prev/Next pair on the kind surfaces only. Home: ONE merged Continue
listening row (music + podcasts by recency), every row capped at 8.
Downloads graduates to the FIRST hard Library entry with a
video-platform glyph (all sets incl. the U+1F4FA emoji) + an
optional default-hidden bottom-bar item. Podcast push: an episode
finishing its download notifies + pushes, deep-linking
/podcasts?play= (schema v13 - notifications.kind, its own
append-only block; the UNIQUE(media_id) cross-kind REPLACE semantics
are documented and bound).

What the gate caught (full gate, 2 rounds each seat): a genuine
CRITICAL - the merged row's toggle was implemented as a permanent OR
read and could never turn OFF (a lying Settings control, proven by a
surviving mutant); now a one-time upgrade fold with a bound matrix.
DISCLOSED interpretation of ruling 1's parenthetical: an explicit
pre-v1.73 music-row OFF stays off; the either-was-on fold applies
where the retired podcasts key exists (QA evaluated and endorsed).
Also caught: the track-button pair leaking onto the watch page's
audio items (now marker-gated), the ruled emoji glyph silently
dropped (shipped), the podcast bridge gating RECORDING where the
scan bridge gates only delivery (parity restored), and five
unbound seams incl. the headline bridge - all now killed by named
tests. Known gaps: tech-debt #101 (single-item context hides the
audio Prev/Next with a queue banked) and the inherited #95-class
unbound autoAdvanceViaTrackNav setter (adversarial M7 - noted on
row 95, five-minute lock at next touch). Dual-Node: v22.23.1 =
5885/5885, 0 fail; v24.14.0 = 5885/5885, 0 fail. Device pass
PENDING.

### v1.72.0 - First-class parity: the full scoop (2026-08-03)

Dean's overnight ruling: everything the ten-capability definition
(CONTRIBUTING) demands, for every kind, in one wave. Headline =
tech-debt #94: the Liked playlist is MIXED-KIND - /api/liked merges
all four liked carriers (videos, podcast episodes, music tracks,
books) with kind CARRIED on every item, per-id-space silent drops
preserved, kind-aware cards through the one video-card template, and
the count-gated sidebar entry spanning every id space. Also shipped:
videos' home Continue-watching row + manual mark-as-watched toggle
(POST/DELETE /api/watched/:id, the un-watch verb carrying the
history-row-delete semantics); books likes + a manual-only finished
latch + reader save/like/finished controls (schema v11 -
user_book_liked/user_book_finished, the TWELFTH carrier, all arms);
music + books in the bottom bar (default-hidden, the podcasts
posture); music save-to-device (source bytes, never a rendition) and
music in the ONE queue (entry_kind 'track' end to end); #91 fixed
(cross-kind queue advances consult autoplayNext with a post-hop
staleness re-check; same-kind unconditional); podcast shows pinnable
in the Playlists surface (schema v12 - user_podcast_pins, the
book-pins pattern, third pinSource); CONTRIBUTING now carries the
post-wave standings + the future-agent onboarding contract for new
kinds.

What the gate caught (full gate, both seats, 2 rounds each): QA found
the mixed Liked list silently breaking watch-page Prev/Next and
autoplay inside the liked context (non-media ids 404ing the watch
view - fixed with media filters at all three context consumers), a
missing staleness re-check in the #91 consult, and a tech-debt id
collision; the adversarial seat's 29-mutant battery found the book
arms of the client kind dispatch and the own-property drop guards
UNBOUND (4 surviving mutants, all now killed by named tests) while
its 13-probe destruction matrix (four-kind id collisions at every
destructive verb, hostile restores, wrong-user probes) held clean.
The pre-gate suite run itself caught a deterministic hang: the pins
table had been added by editing the already-executed v11 migration
block - the append-only law is now written at SCHEMA_VERSION, the
table moved to its own v12 block, and 11-stamped victim dbs
self-heal.

Known gaps, DISCLOSED: morning questions for Dean in tech-debt rows
96-99 (books auto-finish threshold, music played latch, music/books
delete verbs, music container pin) + row 100 (watch-detail
watchState derivation divergence, cosmetic). #90's fix shape is
marked obsolete (music is now intentionally queue-aware; any future
fix is latency-shaped). Dual-Node: v22.23.1 = 5865/5865, 0 fail;
v24.14.0 = 5865/5865, 0 fail. Device pass PENDING.

### v1.71.1 - Episode-row glyphs (2026-08-03)

Dean's device find on v1.71.0: the Queue/Save/Delete text buttons
truncated episode titles. All three are now glyph buttons (the card
corner controls' icon-queue/download/delete vocabulary on the
played/like-toggle circle chassis); the two-tap delete arms into a
pill revealing "Move to trash?" - honesty kept, width reclaimed;
title + aria-label carry the words. Slim gate (UI-only, adversarial
alone): APPROVE, zero CRITICAL/WARNING - it measured behavior parity
(all handlers byte-identical incl. stopPropagation), the confirm
reveal's specificity chain via jsdom, accessibility names, both icon
sets, and killed a CSS-block-deletion mutant against the styling
lock. Its suggestions landed as honest comments + tech-debt #95 (the
view has no DOM harness - a two-tap-guard mutant survives, the #78
class, inherited not new). Also recorded: tech-debt #94, Dean's
deferred intent that hearted episodes surface in the LIKED PLAYLIST
(/?liked=1), not only the podcasts lane - the next wave's headline.
Dual-Node: v22.23.1 = 5819/5819; v24.14.0 = 5819/5819. Device pass
PENDING.

### v1.71.0 - Podcasts everywhere: Dean's seven items (2026-08-03)

One branch, Dean's ruling, items 2-7 (item 1 shipped in v1.70.0).
Schema v10: `user_podcast_liked` (the ELEVENTH id-keyed carrier, every
arm in its birth commit) + `user_queue.entry_kind` - episode ids are
md5 hex exactly like media ids, so the kind is CARRIED, never inferred.
The six features: Podcasts as an optional bottom-bar item, OFF by
default (a new default-hidden class in the resolver; pre-v1.71 configs
untouched); episode save-to-device via the confined stream route's
`?download=1`; episode likes with a count-gated Liked lane (the music
pattern, own table - never show-level); a home Continue-listening row
(music's exact selection contract) deep-linking `/podcasts?play=`,
which opens the show, scrolls to the row and resumes in the dock; ONE
queue for all - podcast episodes ride the v1.63 queue with kind-scoped
lifecycle carriers, per-kind resolution with the silent-drop preserved,
and every consumer deriving destinations from one shared
`queueEntryHref`; and the one-tap expanded now-playing view
(`?nowplaying=1` mounts the live player FULL into /podcasts' new
`#player-slot`).

The gate, honestly: full two-seat gate, two rounds each. Adversarial
round 1 found the headline feature HALF-BUILT - a queued podcast
episode never advanced the queue (the trackNav short-circuit returned
before the queue consult); also a podcasts-to-podcasts navigation
stranded the expanded player mid-audio, and three guards (kind-scope,
route actor-identity, consumer conversions) each survived the full
5814-test suite - the decision-vs-use class three times in one wave.
All fixed and mutant-verified. QA found the deep link's promised
scroll-to-row undelivered and one comment still carrying a corrected
claim; both taken. Disclosed residuals: #89 (a docked VIDEO expands
into /podcasts via a bookmarked ?nowplaying=1), #90 (music's ended
path now AWAITS a queue read - outcome unchanged by construction,
timing changed; the round-1 "music unaffected" claim was WRONG as
stated and is corrected here), #91 (the trackNav queue advance ignores
autoplayNext - a product call for Dean), #92 (auto-advance collapses
the expanded view to the dock), #93 (Liked card count vs lane
divergence + the silent 100 cap). Process failures on the record: a
mutation-test restore clobbered an uncommitted fix (the
against-a-COMMIT norm, violated and vindicated), and one unverified
test count made it into a reviewer brief (4295; the real number was
4265). Dual-Node: v22.23.1 = 5819/5819; v24.14.0 = 5819/5819 (failure
greps empty, counts from the reporter lines). Device pass PENDING -
the exec plan stays in active/ until Dean's probes close it.

### v1.70.0 - Recoverable episode delete + the 15.5MB cover fix (2026-08-03)

Closes tech-debt #81: podcast episodes get their own trash lane. A
two-tap Delete moves the file to `<podcastsRoot>/.filetube-trash`
(atomic rename; EXDEV falls back to copy+fsync+verify+unlink), the
record flips to 'trashed' with an In-trash chip + Restore in the row,
restore refuses to clobber (409) and tombstones honestly when the
trash file has vanished (410 + per-user purge). Retention rides the
EXISTING db.settings.trashRetentionDays at boot + each poll cycle;
per-user progress/played rows survive the trash trip and retire only
on purge. Second headline: Dean's missing show art, root-caused by
live measurement - Patreon serves a 15,494,765-byte PNG and the 8MB
COVER_MAX_BYTES abort was silent and permanent (retry coupled to
pending episodes). Now 32MB, retried every poll until art lands,
failures named in the cycle status, 2-minute ceiling. Third: Dean's
translucent-sheet bug was `var(--bg-primary)` - a token that never
existed - plus four sibling undefined-token sites (two pre-existing
since v1.43/reloc); all five fixed and a new lock refuses any
fallback-less `var()` naming an undefined token.

The gate, honestly: the adversarial seat ran FOUR rounds (Dean halted
the cadence as too long - rounds 3-4 were defence-in-depth; the
pacing rule "ship on CRITICAL/WARNING closure, tech-debt the rest" is
now standing). It found 3 CRITICALs, all closed: the trash/restore
record path fields were unconfined (arbitrary file read/destroy
reachable from an admin backup bundle), the confinement ROOT itself
was bundle-controllable via settings.downloadDir, and GET /episode/:id
served a db-authored path with no confinement. Plus the v1.69
mount-loss guard re-introduced in the new sweep. Adversarial APPROVE
binds d36d731; the commits after it (its own two delta prescriptions,
then the QA fix round) were verified by the QA seat, which reviewed
the whole range fresh: W1 misattributed comments (the sweep said
v1.71), W2 a comment claiming a root-creation invariant the module
does not have, W3 the cover-cap lock tested the DECISION not the USE
(an 8MB call-site mutant survived 4244 tests), W5 restore could
report a false success when losing the serialized-write race to the
retention sweep - fixed symmetrically with DELETE, and the new
deterministic race test caught an aliasing defect in the first
version of that very fix. QA APPROVE binds b308264.

Ships DISCLOSED: #86 (EXDEV-kill partial in trash; the lost-race
move-back orphan joins this class), #87 (the delete confirm does not
state the retention window - the plan's D5 copy was dropped), #88
(the token lock counts era-only definitions as defined). Dual-Node:
v22.23.1 = 5791/5791; v24.14.0 = 5791/5791. Device pass PENDING -
exec plan stays in active/ until Dean's probes close it.

### v1.69.1 - The Podcasts zero-state door (2026-08-02)

Dean's first device probe found what four adversarial rounds + QA
missed: the Podcasts nav is content-gated (zero subscriptions = no
link, correct by design) but the only place to CREATE a subscription
is /podcasts - which nothing linked. A fresh install had no path in.
Fix: a static Podcasts box on Library settings (the music/books
pattern) with the set-FILETUBE_PODCASTS_DIR-first guidance and the
door. Slim gate (adversarial alone, UI-only): APPROVE, zero findings;
the seat killed four mutants against the new source lock and verified
the door reaches members, not just admins. Dual-Node: v22.23.1 =
5767/5767; v24.14.0 = 5767/5767. LESSON RECORDED: no instrument walks
the fresh-install path to a new place - a human does.

### v1.69.0 - Podcasts: a first-class place + private-RSS engine (2026-08-02)

Dean's ask: a true offline cache of his Patreon podcast library, grown
into a Podcasts place alongside Books and Music. Subscribe to any
podcast RSS feed - public, or private tokened ones (Patreon's "listen
in other podcast apps" URL) - with per-feed backfill policy (every
episode / latest N / new-only), a show grid -> episode drill UI,
docked playback that ALWAYS resumes, per-user played/resume state
(schema v9, the TENTH id-keyed carrier), and a per-sub "file under
Podcasts" toggle for existing yt-dlp audio subscriptions. The feed URL
is treated as a credential: stored only in a 0600 file outside the db
and outside backups, episode identities are one-way hashes, prose is
pattern-scrubbed, enclosure URLs never persist raw. Downloads ride the
(newly shared) heavy-job gate, stream through atomic .ptpart temps,
and reconcile under BOTH mount-loss guards. Designed against Dean's
real feed: 484 episodes, 42.3 GB, single-line XML, tokened enclosures
behind a CDN redirect.

WHAT THE GATE CAUGHT (full gate, 4 adversarial rounds + QA + 2 hash
re-confirms; every claim below measured, not read): a CRITICAL
mount-loss gap (a transient unmount would have tombstoned the whole
archive unrecoverably - the v1.33 empty-mountpoint lesson,
re-learned); a token leak through guid/prose persistence into
db/backup/API; the poll timer never arming until restart; /podcasts
missing the shell treatment; pre-v1.69 backups wiping the podcasts
namespace and stranding an unremovable credential; unsubscribe not
stopping a running backfill; a parser CDATA/comment interaction that
silently deleted items and paired an episode with ANOTHER episode's
audio forever; a serialization claim with no binding test. Then the
FIX round introduced two CRITICALs of its own (a quadratic parser
freeze; episode identity coupled to the global secrets map - an
unrelated new subscription re-downloaded an untouched show's archive),
and the lock for the first one initially could not fail its own
mutant. QA then found the management UI had never shipped over its
routes (unsubscribe / settings / the restored-backup token re-entry
lane) - shipped in the QA round rather than disclosed away.

KNOWN GAPS, DISCLOSED: no per-episode delete verb (the v1.65 trash
machinery is metadata-shaped; tech-debt #81) - unsubscribe keeps all
files on disk by design; no abort for the episode currently in flight
(#84, pause/unsubscribe stop at the next boundary); non-mp3 enclosures
keep their native format (#82 - Patreon serves mp3 natively, 484/484
measured); TOCTOU DNS rebinding inherited from the shared envelope
(#80); the orphan-secret sweep's synchronous-writer dependency +
presence-only catch-path reap (#85); rotated-token duplicate-add shape
(#83). Dual-Node suites: v22.23.1 = 5766/5766 pass 0 fail; v24.14.0 =
5766/5766 pass 0 fail. Dean's device pass PENDING - probes in the
session report (look/feel, dock resume on a real episode, the two-tap
unsubscribe, the first real 42.3 GB backfill).

### v1.68.3 - Design-language convergence (2026-08-02)

Dean's on-device report, three findings, one theme: surfaces
hand-rolling (or omitting) what the design system already provides.
The v1.67 card-corner pickers had shipped BARE - a className with no
CSS rule behind it, rendering browser-default beside six properly
tokened settings selects - and the sweep found two more selects bare
the same way (the move modal's, and the ytdlp failures filter's
orphan form-input class, the gate's own catch after the first sweep
miscounted it as styled). Root cause: nothing styled <select> by
default, the census only sees literals PRESENT in declarations
(absence is invisible to every instrument), and gate seats review
code, not pixels. The structural fix: a BASE tokened `select` element
rule - the styled path is now the default and the bug class dies for
every future select. Second: tapping the queue with a stale-empty
queue "loaded for a second and stopped" - an auto-close raced ahead
of the empty state; the panel now stays open with the bell-posture
message. Third: the queue panel's Clear button had drifted from the
notification panel's design language; the four chrome pairs are now
declaration-identical under a mirror lock that forces either side to
follow the other.

Codified for the future (Dean's ruling): CONTRIBUTING.md now carries
"Every rendered element must have a styling SOURCE - none is a
finding": find the existing pattern first; no pattern means prefer a
base element rule; a className with no rule binding it is a defect to
flag, for implementers and reviewers both.

Slim gate, one fix round. The blocker: the base-rule comment's own
blast-radius enumeration was measurably wrong (form-input listed as a
styled pattern; it binds no rule anywhere) - corrected to three bare
surfaces. Both round-1 surviving mutants (a respelled auto-close, a
shadowing duplicate rule) die under the strengthened locks.

DISCLOSED, pending Dean's device pass:
- An INLINED panel-close in setChrome (never using the closePanel
  token) would evade the body lock - the #78 source-lock class, the
  seat's own honest residual on its own prescription.
- The queue button still hides when the queue is empty (v1.63 ruling
  4) - the empty message shows when the panel is OPEN as it empties,
  or when a stale button is tapped; there is no persistent
  empty-queue entry point by design.
- Tech-debt #79 (pre-existing, the gate's find): music/books sort
  selects sit at 12px, so iOS focus-zoom is possible there.

Dual-Node of record: v22.23.1 5644/5644, v24.14.0 5644/5644 (0 fail
both).

### v1.68.2 - The rotate-and-back shift, actually fixed (2026-08-02)

Honesty first: v1.68.1's rotation fix was a MISS. Dean pulled 1.68.1,
re-ran the probe, and the inline rotate-and-back shift persisted - the
stale-vh box mechanism that release addressed (which the screenshots
genuinely supported) was not the operative one. His refined report
re-diagnosed it: iOS preserves the scroll offset in raw PIXELS across
a rotation, and portrait stacks ~190px more chrome above the player
than landscape (logo row + search row vs one bar), so rotate-and-back
deposits exactly that layout delta as residual scroll - the video top
tucks under the fixed header. The v1.68.1 cap nudge and dvh twins ship
on as hardening.

The fix is a CAPTURE-FREE dead-zone snap riding the same orientation
seam: after each rotation settles, a scroll position strictly between
page top and the player's own document top is a band only the bug
deposits the page into (the player is the first element in the column;
the zone is the fixed-header chrome) - snap to top. Positions at or
past the player (reading comments) stay with iOS's own content
anchoring, which is correct there. Capture-free means no dependence on
when the orientation event fires relative to iOS applying its shift.
Every guard re-checks at apply time (mobile, player mounted inline, no
native or faux fullscreen) - the C1 navigation-clobber discipline.

Slim gate, APPROVE both rounds. The seat structurally verified the
dead-zone premise (fixed header, player-first column), swept the
legitimate-states-in-the-zone question (router advances place 0;
keyboard-open lands outside; keeper interplays bounded and corrective),
and ran a 16-mutant campaign - 13 killed at the first hash, the two
suggestion-grade survivors (divergent-spelling second consumer,
vacuous coercion rows) closed with measured kills in the fix round.

DISCLOSED, pending Dean's device pass:
- Execution vacuity of the runtime wiring locks continues under
  tech-debt #78 (the DECISION is a real executed export; the wiring
  around it is source-locked - no-jsdom player IIFE precedent).
- A fullscreen exit landing within 650ms of a rotation whose keeper
  restore falls inside the dead zone would be re-snapped to top -
  requires having ENTERED fullscreen parked under the header, not a
  real parking spot; bounded and corrective if it ever fires.
- A manual mid-flick stop inside the header band followed by a
  rotation snaps to top (bounded, direction-corrective, accepted).

Dual-Node of record: v22.23.1 5636/5636, v24.14.0 5636/5636 (0 fail
both).

### v1.68.1 - Stale banners land, rotations stop cropping (2026-08-02)

Dean's fixed wave, two on-device reports, both root-caused to something
other than the reported trigger. First: tapping a push notification
"did nothing" - and the watched-filter correlation Dean observed was a
bystander. The real mechanism: banners minted BEFORE v1.67.4's ?id= to
?v= fix outlive that fix in the phone's shade; tapping one navigated to
the watch page, which found no ?v= and bounced to home. Those same
stale banners could also never retire on play (the banner-close helper
parsed only ?v=). Both readers now accept legacy ?id= as a fallback
(?v= wins when both are present), centralized in a resolveWatchMediaId
helper. Second: rotating the inline watch page to landscape and back
cropped the player until a manual scroll - measured from the
screenshots as the mobile-portrait 45vh cap re-applied with vh
resolved against STALE pre-rotation viewport metrics (WebKit never
revisits until a style invalidation, which is what the manual scroll
was). Two independent layers: a JS nudge at the orientation seam that
performs that invalidation deterministically (release the caps, force
one layout, clear - the caps re-resolve against settled metrics), and
dvh twin declarations after all four vh cap sites (dvh re-resolves on
viewport changes by spec; vh stays for browsers without it).

Slim gate (adversarial seat), one fix round. The headline catch: the
rebound builder/reader drift lock was presence-not-binding - an init
inlining an id-first read survived the ENTIRE 4110-test suite with the
helper left exported, dead, and green (the testing-a-DECISION-not-its-
USE class, again). Closed by two verified bindings: the behavioral
harness now captures WHICH id init consumes (?v= wins with both params
present, exactly once) and an exact-statement lock binds init to the
helper. The seat also found the fourth vh cap site this wave missed
(the :empty reserved-frame mirror - twinned) and killed 12 of its 14
crafted mutants against the shipped locks.

DISCLOSED, pending Dean's device pass:
- The rotation-cap-nudge locks are source-text only; nothing binds
  EXECUTION of the nudge (tech-debt #78 - inherent to the no-jsdom
  player IIFE precedent; the CSS dvh layer is the independent second
  defense, and the device pass is the arbiter).
- The S1 CSS pair assertion anchors to the first :empty block whose
  first declaration is the 45vh cap; a two-edit refactor moving the
  pair into the BASE :empty rule could hijack the anchor (adversarial
  S1-c, runnable repro on record; second-order, same anchoring
  strength as the pre-existing pair assertions - shipped disclosed on
  the seat's own recommendation).
- Old ?id= banners tapped BEFORE this release still bounced; ones
  still sitting in the shade start working (and start retiring on
  play) once the server runs v1.68.1.

Dual-Node of record: v22.23.1 5632/5632, v24.14.0 5632/5632 (0 fail
both).

### v1.68.0 - Notifications that clean up after themselves (2026-08-02)

Dean's fixed wave, three rulings plus one add. Playing a video now
retires its own notification: the bell row leaves YOUR panel and badge
(server-side, at the view ping, so every play path counts - a card tap,
a push deep-link, a queue advance) and the delivered push banner leaves
your phone's shade (the PWA half, matched by PARSING the banner's deep
link so one video's play can never close another's banner). Each bell
row also gains its own dismiss X - single tap, no confirm, per-user
(the row survives for everyone else), non-optimistic (the row leaves
only when the server confirms), with keyboard focus handed to the next
row. Clear-all stays. Under the hood: a new per-user dismissals table
(schema v7 to v8), riding every carrier seam the reads lane rides -
backup/restore included, proven by real HTTP cycles at the gate. The
add: the scroll keeper grew its NATIVE-fullscreen half, closing the
rotate-and-back door (iOS clobbers page scroll on native fullscreen
exits; v1.67.5 covered only the CSS faux flavor).

The full gate, two seats, two rounds each. The adversarial round's
headline: the new lane's cross-user isolation was UNBOUND on the write
side - every test actor was user 1, so a wrong-user write (one
person's play deleting another's bell row) survived all 5616 tests.
Now actor-bound at every layer and mutation-proof. It also caught a
genuine leak (the rekey collision scrub purged reads but not
dismissals) and two unlocked keeper guards. The QA round caught a
LYING token-exempt comment (a 36px literal citing a convention that
does not exist, where the exact control-size token was available), a
badge race beside an open panel, the keyboard focus drop, and a
born-complete schema list that had silently rotted across two
releases. Seven mutant classes, zero survivors at the final hash.

DISCLOSED, pending Dean's device pass:
- The view ping is THE play hook: web surfaces dismiss on play; a Roku
  play does not (its routes never ping).
- Banner closing is PWA-only by nature (there is no shade to clean
  elsewhere).
- A push round already in flight can still deliver a banner for a
  just-played video (cursor delivery is dismissal-blind); it closes on
  that video's next play.
- Downgrade posture: OLD FileTube code opening a v8 database works and
  loses nothing - it simply shows dismissed rows again until upgraded
  (the readers predate the table).

Dual-Node of record: v22.23.1 5620/5620, v24.14.0 5620/5620 (0 fail
both).

### v1.67.5 - The video top stops hiding under the header (2026-08-02)

Dean pinned an elusive intermittent bug to its trigger: on the mobile
CUSTOM player, exit fullscreen with the button and the page sits
partially scrolled - the video top tucked under the fixed header until
you nudge it. Root cause: custom-mode mobile fullscreen is CSS
faux-fullscreen (iPhone element-fullscreen is always the native player,
so custom mode fakes it with a fixed overlay), and its only scroll
defense was `body { overflow: hidden }` - which iOS Safari does NOT
honor for body scrolling. Every scrub, double-tap skip, and rubber-band
inside fullscreen could drift the page underneath; exit restored the
layout and never the scroll. The fix captures the pre-entry scroll when
faux-fullscreen engages and re-asserts it on exit.

The slim gate earned its seat twice over. The first cut gated the
restore on "player still fullscreen" - and the adversarial seat proved
with a runnable repro that watch-to-watch navigation (queue/autoplay
advancing to the next video, or back-button to a previous watch page)
never docks the player, so the teardown path would have stamped the OLD
page's scroll onto the NEW page: the exact reported symptom,
reintroduced by the fix meant to kill it. Restore is now opt-in per
call site - only the explicit exit button qualifies. The seat also
crafted four mutants that slipped past the first-cut source locks
(presence, not behavior); the locks are now exact-statement + ordering
assertions, and seven total mutants die with zero survivors.

DISCLOSED: the unit tier proves the scroll-plan logic and its wiring;
the iOS gesture-drift itself is device-only. Dean's probes: (1) custom
player, fullscreen, scrub around, exit with the button - the page sits
where it was; (2) enter fullscreen scrolled partway down a watch page,
let the queue auto-advance, confirm the NEXT video's page opens at the
top. Dual-Node of record: v22.23.1 5593/5593, v24.14.0 5593/5593.

### v1.67.4 - Web Push: tapping the notification opens the video (2026-08-02)

With delivery finally working (the fix was config, not code: Apple's push
service 403-rejects a VAPID `sub` it dislikes - the `mailto:...@...local`
default among them - and our delivery treats a 403 as "skip", so a bad
subject means silent nothing; setting FILETUBE_VAPID_SUBJECT to a real
address fixes it), the next thing surfaced: tapping a notification opened
the PWA to a flashing shell that never loaded the video, while tapping the
same video from a card worked. The deep link was built as
`/watch.html?id=<id>`, but the watch page - and the bell, and the cards -
read `?v=`. The watch page got no id and sat on an empty skeleton forever.

Now the notification opens `/watch.html?v=<id>` like everything else. The
URL builder is a single shared function, bound by a test that reads the
param `watch.js` actually consumes and forces the push link to match - so
the four surfaces (push, bell, cards, watch) can't drift to different param
names again. The mismatch had shipped green because the URL rides the
ENCRYPTED push body, invisible to every delivery test. Slim gate,
dual-Node 5584/5584.

### v1.67.3 - Web Push: the worker was named like an ad (2026-08-02)

The reason iOS registration failed came out of the now-visible diagnostic:
`[SecurityError: Script .../push-sw.js load failed]`. The server was proven
healthy (valid cert, right MIME, a clean 200 from outside), so the block
was on the phone - content blockers (uBlock Origin, Wipr, Vinegar) refuse
to load scripts named like push-marketing SDKs, and `push-sw.js` is a
canonical entry in their filter lists. Disabling the blockers made
registration work; the durable fix is to stop naming the worker like the
thing being blocked.

The service worker is now **`/filetube-worker.js`** (no "push" or
"notification" tokens for a blocklist to match) - this SUPERSEDES the
`ships at /push-sw.js` line in the v1.66 entry below, and the worker still
has no fetch handler and never touches cache storage. Devices that already
subscribed under the old name keep their subscription: the boot reconcile
re-registers the new script into the same scope (an in-place upgrade - the
subscription belongs to the registration, not the URL), and the cleanup
sweep spares both names during the transition. Slim gate (9 mutants, the
migration exemption verified load-bearing), dual-Node 5583/5583.

(Also note: the `?pushdebug=1` flag from the v1.67.1 entry no longer exists
- v1.67.2 made that diagnostic always-on.)

### v1.67.2 - Web Push: the diagnostic reaches the phone (2026-08-02)

Dean's device re-test on v1.67.1 worked - the button now spoke - and what
it said ("could not register with the push service") exposed one more miss:
the RAW exception detail was gated behind `?pushdebug=1`, and the installed
iOS PWA has no address bar in standalone mode, so the flag was unreachable
on the one device that has no console. The flag is REMOVED (this supersedes
the `?pushdebug=1` sentence in the v1.67.1 entry below - that flag no
longer exists); the exception name and message now ALWAYS ride the visible
message, e.g. "[AbortError: ...]". Nothing sensitive travels in a browser
DOMException, and it is exactly what a console-less device must surface.

The new runtime test drove a granted-permission click into a failing
subscribe() and asserts the bracketed exception is visible - and the
diagnostic proved itself before shipping: the test's first hand-typed
fixture key was invalid base64url, and the on-screen message correctly
named the InvalidCharacterError. The key is now constructed, never
hand-typed. Slim gate, dual-Node 5583/5583. Dean's next Enable tap will
name the exact failure; eliminated so far by his testing: DNS blocking
(Pi-hole logs clean + whitelisted), Lockdown Mode (off), and the network
path (fails identically on and off Wi-Fi).

### v1.67.1 - Web Push: the enable button stops whispering (2026-08-02)

Hotfix found by Dean's iPhone device pass on v1.66: tapping "Enable
notifications on this device" appeared to do nothing. Root cause was ours,
not iOS's - the push error line (`.field-error`) is `display:none` until
something reveals it, and the v1.66 enable flow set the message text but
never un-hid the element. So every failure - a denied permission, an iOS
`subscribe()` exception, a server refusal - was written to an invisible
node. The button was never silent; you just couldn't see what it said.

Three fixes: push errors now show like every other field error on the page;
a not-granted permission gives a specific reason ("blocked - turn on in
Settings > Notifications > FileTube" vs "dismissed - tap Enable again"); and
`?pushdebug=1` appends the raw iOS exception, since the iPhone has no console
without a Mac. The message decision is unit-tested, and - honoring the v1.66
"test the decision, not its use" lesson - a jsdom test clicks Enable under a
denied permission and asserts the message actually becomes VISIBLE (it
reddens if anyone re-mutes it). Slim gate (adversarial seat), dual-Node
5582/5582. Dean's device re-test PENDING: the button will now show WHY iOS
push is or isn't subscribing.

### v1.67.0 - Card corners, your way (2026-08-02)

Dean's request, verbatim intent: the video tiles have four corners and
you should pick what lives in each. Settings > Appearance now has three
pickers - top-left, top-right, bottom-left - each offering Download,
Delete, Like, Queue, Share, Reheat, or None. Bottom-right is reserved
for the duration badge and is not assignable: the v1.63 queue button
had been sitting literally ON that badge (both anchored bottom-right),
and this wave is the fix. The layout is per-user and SERVER-persisted
(Dean overrode the device-local recommendation), so it follows you to
every device; it rides the existing settings mirror with no schema
change and free backup coverage. A control chosen in one corner drops
from the other pickers (a duplicate is a UI bug, not a feature), and a
control that does not apply to an item - Share on a local file with no
original YouTube link, Reheat on an install without yt-dlp - renders
NOTHING in that corner, never a substitute. Card tiles only; music and
book rows are untouched. Under the hood: ONE exported corner renderer
(position split from identity in CSS), the queue glyph promoted from an
inline svg to a real `icon-queue` mask, share on cards runs the same
single share-decision helper as the watch page, and reheat fires the
same per-item endpoint with the same toast vocabulary.

The gate (full two-seat, two rounds, both APPROVE at dd63291): the
adversarial seat ran a 14-mutant campaign (all killed, including the
decision-vs-use mutant this repo shipped three times in v1.66's wave),
proved the injection/XSS chain dead at three independent layers,
verified the relocated delete two-tap arm machine and the v1.65 trash
semantics with real clicks, and proved backup/restore with a real
cycle; its two code findings (an editor picker that DISPLAYED a lie
under an injected duplicate, and a divergent ok:false-with-202 test
fixture) were applied. The QA seat's five applied findings: keyboard
focus restored after the editor's live re-filter, a test-harness header
that under-enumerated its load-bearing stubs, a stale escape-pointer
comment, `touch-action: manipulation` extended to all six card controls
(a pre-existing two-control asymmetry), and a failure toast for a card
share with no share sheet AND no clipboard (silence read as a dead
button).

DISCLOSED, pending Dean's device pass (the final arbiter):
- **The queue button is GONE from cards by default** (ruling C5) -
  assign it to a corner in Settings > Appearance to get it back. This
  is deliberate: its old fixed spot obstructed the duration badge for
  everyone.
- Default card TAB ORDER changed (download before delete, matching
  visual reading order); the rendered layout is pixel-identical.
- Card reheat offers no relocation prompt - that stays a watch-page
  affordance; the reheat itself is identical server-side.
- Two inline queue-glyph copies remain by decision (the watch page's
  Queue verb and the header's queue button - both are inline-svg chrome
  paired with inline-svg siblings).
- The reheat corner is module-gated like the watch flame, not per-item:
  an ineligible item's flame click surfaces the server's honest "no
  source to reheat from" toast.

Dual-Node of record: v22.23.1 5578/5578, v24.14.0 5578/5578 (0 fail
both).

### v1.66.0 - Web Push: your phone buzzes when a download lands (2026-08-02)

The third of the approved waves, and the first that reaches OFF the page:
when a subscription or one-off download lands in the notification bell's
feed, every subscribed device gets a real OS push notification - the
iPhone home-screen PWA included, locked screen and all. It is the bell's
delivery channel, so it inherits the bell's on/off switch and its
per-account seen/read view; the only new choices are per-device ("Enable
notifications on this device", a real button because iOS requires the
permission prompt to come from a tap) and a per-user pause that quiets
every one of your devices at once.

No new server dependency - the repo's law is ffmpeg and yt-dlp only, and
this wave held to it. VAPID request signing (RFC 8292) and the payload
encryption (RFC 8291, aes128gcm) are written in raw `node:crypto`, bound
in the tests to the RFC's own published test vector byte-for-byte. The
catch-up policy is Dean's: three or fewer missed downloads arrive as
individual notifications, more collapse to a single "N new videos" so a
phone that was off overnight during a big scan gets one buzz, not forty.
A dead subscription (the browser forgot it) is pruned on the spot; a
rate-limited one backs off and catches up on the next download. Delivery
is fire-and-forget - a slow or dead push service can never delay or fail
a download or a library scan.

The service worker is PUSH-ONLY by design and by test: it has no `fetch`
handler and never touches cache storage, which is the exact mechanism
that got the v1.26.4 offline worker removed (it broke background video on
iPhone). It ships at `/push-sw.js`, deliberately NOT the `/sw.js` the old
worker used - see below for why that distinction turned out to matter.

**What the gate caught - FOUR fix rounds across both seats, one a CRITICAL
in my own code and one defect filed TWICE before it was really bound:**

- The truncation guard I added mid-gate was a NON-TERMINATING LOOP: a
  large backfill behind an unhealthy push service made delivery re-read
  the same batch forever - measured at 314 rounds and 314 POSTs to a
  dead endpoint before it was caught, with nothing crashing and the full
  suite green. It was a defect in a defense the QA seat suggested and I
  implemented without proving it terminated; we both own it. Fixed to
  re-run only when a round actually delivered, and a second, subtler
  route to the same spin (a delivery that claimed success without moving
  its cursor) was closed in code rather than left resting on luck.

- The push worker originally registered at `/sw.js` and the boot cleanup
  was taught to spare that path - but the REMOVED v1.26.4 offline worker
  registered at exactly `/sw.js` too, so the exemption spared the very
  worker the cleanup exists to kill, quietly reopening the iPhone
  background-video regression on any install that still carried it. Three
  comments and a test fixture asserted the opposite. The worker moved to
  its own path; the original "no `/sw.js`" lock is intact again.

- A subscribe request with a malformed key HUNG the connection forever
  instead of returning an error. A notification could announce "50 new
  videos" when 120 had landed, stranding the rest. And the headline
  "don't double-notify the phone you're looking at" rule was protected by
  a substring grep, TWICE - a one-character inversion passed a green suite
  both times - until it was finally bound by a test that EXECUTES the real
  service-worker handler. A locked phone that gets no banner is exactly
  the failure this wave exists to prevent; it earns an executed test.

The crypto held up under direct attack: the adversarial seat mutated the
encryptor six ways and the signer four across every round, and the RFC
test vector killed all ten.

**Known gaps, shipping disclosed (none block; all in the tech-debt tracker):**

- A subscription pinned to a rotated signing key keeps being skipped
  silently, and Settings still shows the device as active. It is not
  hammered (one attempt per download) - it just never heals until the
  device re-enables.
- When a browser rotates a subscription on its own, the old server row
  lingers until it naturally 404s, briefly occupying one of the 10
  per-device slots.
- **NOT introduced by this wave, surfaced by it, and it needs Dean's
  call:** `session-secret`, the file that signs login cookies, has been a
  TRACKED file in this repository since v1.43 (mode 0644) - anyone with
  repo access can forge sessions for any instance still using that secret.
  Rotating it logs out every user on that instance and purging it from git
  history is a force-push, so the fix is Dean's to time. (tech-debt #77.)

Backup note: push subscriptions deliberately do NOT ride backup bundles -
they carry a shared secret and are cryptographically bound to one
instance's signing key, so a restored copy could never deliver. A device
re-registers itself automatically on its next visit, so nothing is lost.

Dual-Node green (v22.23.1 and v24.14.0, 5539 tests each). Dean's on-device
pass is the arbiter and is PENDING - headline probe: a locked iPhone
home-screen PWA receiving one banner, and the same phone NOT
double-notifying with the app open.

### v1.65.0 - Trash: deletes stop being permanent (2026-08-02)

The second of the three approved waves, and the one that closes the
2026-07-30 capture incident (tech-debt #64): a stray client tap used to
unlink a file for good, and eight files went that way - one of them
Dean's own, not re-downloadable. It cannot happen again. EVERY delete
path now moves the file into a per-library-root `.filetube-trash`
directory by atomic same-filesystem rename - the two-tap card delete,
the watch-page delete, and the scan's deferred-delete retry, which is
the nightmare shape where every guard is fooled at once. Purge, explicit
or by retention, is the only code left in the app that unlinks library
media.

Restore is full-fidelity, and that is the headline: because an item's id
is the hash of its path, trashing re-keys it and restoring re-keys it
back, so all NINE per-user carriers come home - your resume position,
your Like, the watched latch, and your queue slot, which visibly
reappears where it was. Retention is 30 days by default and configurable
in Library settings (7/14/30/90, or never), swept at boot and on the
existing scan timer with no new machinery. The Trash view lives in
Library settings: per-item Restore and a two-tap Purge, with the days
each item has left. Every delete affordance's copy now tells the truth
instead of promising permanence.

**What the gate caught - SIX rounds, both seats, 78 mutants:** a purge
racing a restore could free a file's last remaining link (measured, no
crash and no hostile actor needed); trash records rode the backup bundle
completely unvalidated into three separate unlinkers; the cross-device
copy's checksum had no test at all, and its failure mode was "corrupt
the file, then delete the original"; opening the notification bell while
an item sat in Trash destroyed every user's state for it, so restore
brought back nothing; and trashing a queued video silently bricked queue
reorder for the whole retention window. Three of the last four rounds
found defects in the FIXES, not the original wave: a confinement rule
tightened so far it refused the app's own records and let the sweep
destroy them, a binding suite that wrote into shared /tmp and faked ten
mutation verdicts inside the gate itself, a rule hand-copied to a second
site that then drifted and destroyed bytes the original refused to
touch, and two tests of mine that documented guarantees they did not
provide. The adversarial seat also retracted one of its own approved
findings after the QA seat proved a line it had called dead logic was a
live crash guard. None of this was visible from a green suite.

**Known gaps, disclosed:** a crafted admin backup bundle can still aim a
restore at a directory it also planted bytes into (tech-debt #74 -
closing it refused the app's own records, which was strictly worse); two
trash records for one original path make the scan's leftover reconcile
last-record-wins; the second restore to an occupied path is a 409 by
design, never a silent rename; and manual rescue OUT of a trash
directory must use `mv` or `cp`, never `ln`/`cp -l`/`rsync
--link-dest` - a hard-linked rescue looks exactly like a crash leftover
to the reconcile and gets cleaned away (tech-debt #75).

Dean's device pass is PENDING and is the arbiter. Dual-Node of record:
5473/5473 on v22.23.1 AND v24.14.0, sequential, reviewers idle. The
Docker pull is Dean's.

### v1.64.0 - Watch history (2026-08-01)

The first of the three approved feature waves (History -> Trash -> Web
Push). A real /history page: everything you watched or started,
per-user, newest first, with resume points - built entirely on data the
app already had (user_progress.updated_at + the v1.50 watched latch's
completed_at, which had been write-only since it shipped). Rows carry
the thumbnail, resume bar, Watched chip, relative time, and a two-tap
per-row remove; a two-tap Clear-all sits in the toolbar. Removing an
item deletes the user's own progress + latch rows (so its home
?watch filter state honestly returns to "new" - inherent to
remove-from-history, and re-watching re-adds it naturally), and every
destructive op purges the progress coalescer's staged entries in the
same synchronous handler - the design's headline hazard (a staged ping
flushing seconds after a delete and silently resurrecting the row) is
bound by a stage -> remove -> forced-flush -> still-gone repro test.
Nav: a count-gated sidebar Library entry (visible iff >=1 history item,
the Liked rule; deterministic Music > Books > History order), a History
item in the customizable bottom bar on all nine shells (default
VISIBLE - flipping to default-hidden is a cheap ruling at the Stop),
and a real Material history glyph in the icon-mask system.

**What the full gate caught (both seats REQUEST CHANGES -> APPROVE in
one fix round):** `DELETE /api/history/` - the per-item form with a
MISSING id, exactly what the client would build from a falsy data-id -
aliased onto CLEAR-ALL via Express non-strict routing and wiped the
entire history, measured live by the QA seat (now 400s server-side,
bails client-side, destroys-NOTHING test-bound); the sidebar
count-gate's always-inject mutant survived the full 5390-test suite
(now DOM-bound in jsdom against the real injector); the channel-name
escape was presence-not-binding (hostile-dirname assert added); the
collision-guard's shell list had silently missed FOUR shells incl. the
new one (all enumerated now); and a comment I wrote in this very wave
overclaimed "the ONLY deletes" on the latch table - the lying-comment
class, caught again. The seats DISAGREED on that comment (adversarial
judged it accurate); the stricter reading shipped.

Known gaps, disclosed: the sidebar entry is boot-gated - a user's
first-ever history item makes it appear on the next page load, not
live; bottom-bar customization remains device-local (tech-debt #42).
Device probes below; Dean's device pass PENDING. Dual-Node of record:
5399/5399 on v22.23.1 AND v24.14.0, sequential. Docker pull is Dean's.

### v1.63.1 - Centered phone rows + optional stars (2026-08-01)

Dean's v1.63.0 device pass ("Excellence") came back with one finding - the seven-button watch row wraps below the stars on phones, exactly where the gate's headline probe pointed. His rulings, shipped: each wrapped line now CENTERS at phone widths (the icon row as one centered line, the stars as their own centered line above; the deliberate v1.25.6 whole-row wrap stays - forcing nowrap was the old iOS shrink-to-fit zoom bug), and the stars became OPTIONAL - they are the deterministic mock, and Settings -> Appearance now carries "Hide star ratings", a per-user display pref riding the exact theme/era/icons mirror machinery (device-local truth, cross-device seed) whose hide is ONE root class + ONE CSS rule covering the watch control AND every card's rating row, so no star writer present or future can escape it. All new styling on tokens; the new checkbox is class-styled rather than extending the settings page's legacy inline-style pattern.

**What the slim gate caught (three rounds to APPROVE):** the cross-device seed was DEAD CODE on every theme-customized device - the seed sat below the "fully chosen locally" early return without joining it, proven with a runnable jsdom repro on the real file (fixed, and the repro technique is now a permanent suite killing the delete-the-seed mutant that 5368 tests had let slide); a flash-of-stars on cold loads for hidden-pref users (the inline pre-paint guard now stamps the class in all nine shells, structurally locked in the per-shell FOUC suite); a lone fitting icon row would hug left instead of centering (definite width, no min-content growth); and two of the fix round's own new tests bound vacuously (both now kill their mutants). The seat also RETRACTED one of its own mutant claims after catching its tooling editing the wrong declaration - the charter's verify-your-own-prescriptions rule cutting both ways.

Device probes: the centered row on the phone (stars shown AND hidden - the hidden case on the widest phone is the disclosed edge), the toggle flip in Settings, and stars staying hidden on a second device after its next boot. Dual-Node of record: 5368/5368 on v22.23.1 AND v24.14.0, sequential. Docker publish is Dean's.

### v1.63.0 - The queue: "think YouTube" (2026-08-01)

Dean's ask, verbatim scope: a YouTube-style playback queue - add from anywhere, reorder easily, autoplay walks it, loop stops it, nothing permanent like a playlist, but it follows you. Shipped: a per-user SERVER-persisted queue (one per account, across devices) with a pointer model - played entries stay visible and dimmed, jump-back allowed; a header icon that EXISTS only while a queue does (count badge, beside the bell) opening a panel (desktop popover / phone bottom sheet) with now-playing highlight, up/down reorder, per-row remove, and a two-tap Clear; ONE shared add verb everywhere it belongs - the fourth card corner, the watch page's Queue + Play-next buttons, ordinal toasts ("Queued - 4th") WITH Undo; and playback that follows it: loop outranks the queue ("Loop would stop it"), autoplay-on advances into the queue head before any browse context, Next/Prev and the lock screen ride the same queue-aware registration, and a "Playing from queue - 3/8" box sits where the uploader block sits. Under the hood it is the NINTH id-keyed carrier, born wired: media deletes purge it, relocations re-key it, backups round-trip it (entries, order, pointer), restores rebuild it, the test-reset wipes it.

**What the gate caught (FULL gate, three rounds, both codified seats):** the adversarial seat found the branch tip carrying a RED integration test the unit-only pre-commit hook could not see - the queue fetch GATED Prev/Next enablement, so a hung /api/queue meant dead buttons and unregistered media keys forever (fixed: context handlers arm immediately, the queue upgrades them on resolve) - and proved the music-row add button dead end-to-end (music-library tracks live in a namespace the watch page cannot play; affordance PULLED, sub-wave question to Dean). QA found the restore path untested on a data surface (the round-trip now kills the gutted-restore mutant), the ruling-3 Undo missing (implemented - the toast grew an action button), and in round 2 caught my own round-1 fix double-encoding at the one site that already encoded. Both seats converged independently on that last one - the two-seat redundancy working exactly as codified.

**Disclosed, awaiting Dean at the Stop:** SIGN-OFF 1 - cards carry "Add to queue" only ("Play next" lives on the watch page; the fourth corner was the last free one). SIGN-OFF 2 - music-library tracks are NOT queueable this wave (namespace disjoint); is a music-queue sub-wave worth scheduling? Tech-debt #72: deleting the now-playing entry's FILE resets the queue pointer to not-started (replays from the head) while an in-app remove steps back - asymmetric, disclosed. The watch action row now holds SEVEN buttons - the headline device probe. QA's one uncaptured-red unit run is disclosed; the of-record dual-Node runs were clean: 5362/5362 on v22.23.1 AND v24.14.0, sequential. Docker publish is Dean's.

### v1.62.0 - The ratchet is live: the token system defends itself now (2026-08-01)

The token effort's final tranche (G). Linter v8.1 closes the #68 blind spot - declarations spanning physical lines (six real sites hid there through eight linter versions) now buffer, evaluate complete, attribute to their start line, and honor token-exempt across every code line they span - and `--enforce` turns the census's ZERO from a report into a wall: any raw literal in a governed style property now FAILS the commit (pre-commit hook) and the build (CI), pointing at CONTRIBUTING's mandatory styling section. Before any zero may pass, a ten-category known-violation self-canary must fire - a broken linter exits loud (the vacuous-CLEAN failure mode the census-zero gate proved in ledger-check, closed at the enforcement layer). Also: docs/AGENTS.md deleted per Dean's explicit ruling - the last pipeline-era file, whose HUMAN-MAINTAINED banner had reserved the call to him.

**What the gate caught (both seats REQUEST CHANGES round 1 -> double-APPROVE):** the first canary covered four of ten categories - the adversarial seat broke a single regex and smuggled live literals past an exit-0 "enforcement" end-to-end; both seats independently found the EOF fail-open (v8.0 silently dropped an unterminated final declaration that browsers render and v7 counted); and both seats refuted my "the failure exits cannot be tested without mutating the tree" comment by driving both exits from hermetic scratch trees - that technique is now IN the suite, binding exit 1, exit 2, and the single-category-breakage case with anti-vacuity asserts. Disclosed residuals: a merged-line attribution imprecision after a buffered close-brace (diagnostics-only, commented) and one attribution-fix mutant with no binding (adversarial, non-blocking, recorded).

**The token effort, end to end:** 692 raw literals at the v1.56 audit -> 298 -> 110 -> 54 -> 19 -> 0 (v1.61.0) -> ENFORCED at 0 (this release). Every literal that remains is a token, a recognized idiom, or a reasoned exemption - and the linter that guards it is the most-tested code in the repo. Dual-Node of record, sequential: 5327/5327 on v22.23.1 AND v24.14.0. On-device probe: none - dev-tooling only; nothing renders differently.

### v1.61.0 - The census is zero (2026-08-01)

Dean closed ruling 1 ("I approve Both") and the number the token effort has chased since the 692-literal audit reads ZERO: --on-accent:#fff joins the contract as the 48th name and the final 19 sites adopt - 14 white-on-accent color sites, the autoplay knob, the two JS generated-avatar writers, plus two honest reclassifications to the EXISTING --on-overlay (.audio-player-visual canvas text and the eq bars - overlay chrome, not accent; same value, disclosed at execution). Zero visual delta: the differ reports exactly three white-vs-#ffffff keyword-textual pairs and nothing else. Baseline history: 692 -> 298 -> 110 -> 54 -> 19 -> 0.

**What the gate caught - the zero itself got the adversarial treatment it deserved:** the seat falsified the unscoped claim by feeding the linter's own parser line-joined rules, finding TWO more governed literals hiding in the multi-line blind spot (skeleton-shimmer sweep, dl-chip striped fill - now reasoned exemptions like their siblings; tech-debt #68 corrected from four known hidden declarations to six); proved ledger-check's CLEAN is VACUOUS at zero rows (a broken linter would still print CLEAN - the ratchet now requires a known-violation canary before it may flip); and enumerated the style channels the linter never scanned (setAttribute/innerHTML/HTML attrs, carrying real raws - tech-debt #71). The audit doc now states the zero's exact scope. QA verified all 19 filings per-surface (including the knob's half-time-accent caveat, now in the token comment) and the uniform +9 line-shift as evidence of no missed site. Also on the record: an initially unstaged lib/ file caught by git status review and amended in; a commit-message arithmetic slip corrected in the audit doc.

**The token system's end state:** every raw literal in the linter's declared scope is a token consumption, a recognized calc/env idiom, or a token-exempt annotation carrying its reason. What remains of the effort: the ratchet (tranche G) alone, gated on #68's parser fix + fixture + canary. On-device probe: the on-accent surfaces are zero-delta by construction - white stays white everywhere; anything that looks different is a finding. Dual-Node of record, sequential: 5323/5323 on v22.23.1 AND v24.14.0.

### v1.60.1 - Reader theme switching un-stuck (2026-08-01)

Dean's v1.60.0 device pass: "if I choose night I can't go back to either of the other colors." Root-caused in the vendored epub.js source: the reader had used themes.register()+select() since v1.37.0, which injects UNSCOPED body{} rules into per-theme style nodes in the chapter iframe - re-selection re-inserts rules into the EXISTING node at its original document position, so the last-created theme node wins the cascade until a chapter turn builds a fresh iframe. Pre-existing since the reader shipped; surfaced by the F.5 flip-all-three probe (scored honestly - F.5 changed the values' source, not the broken mechanism). Fixed with themes.override() per property (stored once, replayed onto current AND future iframes via the content hook, last call wins - the same path fontSize always used, which is why font changes were never one-way). Slim adversarial gate APPROVE; the gate also disproved my first root-cause sub-claim (the upstream injected flag is write-only dead code) and the shipped comment states the true mechanism. Disclosed behavior delta: themes now enforce via inline style on the iframe body, so a book carrying its own CLASSED body background - which previously beat the theme - now themes correctly (matching fontSize's existing behavior); book !important rules still win. Dual-Node 5323/5323 x2 sequential. On-device probe: paper -> sepia -> night -> BACK to paper, plus a chapter turn in each theme.

### v1.60.0 - Census toward zero (tokens tranche F.5) (2026-08-01)

Born from Dean's "I really wanna adopt this full concept" walkthrough of the 54 remaining raw literals, same evening as the Tier 4 device pass. The census falls 54 -> 19, and every one of the 19 survivors is a single held decision (the --on-accent white-on-accent family, awaiting Dean's ruling 1 close-out) rather than an unexamined literal. What shipped: linter v7 recognizes the two already-tokenized-in-spirit shapes it was miscounting (calc(var(--radius*) +/- Npx), pinned to the three real radius names, and ZERO-only env() safe-area fallbacks - nonzero fallbacks still count) and unifies the duplicated CSS/JS classifiers into one (tech-debt #69 closed at its own stated trigger); the three reading themes become six --reader-* tokens on their OWN axis (never era- or mode-wired, per ruling - and read.js now derives the SAME tokens via getComputedStyle for the epub chapter iframe, killing the duplicate literal copies that a separate document forces); --header-h and --sidebar-w land as the narrow, Dean-conditioned amendment to "layout geometry stays literal" - each had FOUR in-tree copies that had to stay in sync (header rule/app-container clearance/sidebar top/--sticky-bar-top; sidebar width/main-content clearance/the slide-away translateX pair), all now deriving one definition; and the 24 ruled singletons (canvas art, geometry radii, the amendment-c cc floor, ruling-B radii, player-bar reserves, off-scale pads) carry token-exempt reasons in place. Contract: 47 names, all byte-pinned in token-scale-lock.

**What the gate caught (FULL gate, both seats REQUEST CHANGES round 1 -> both delta-APPROVE):** QA caught the implementer breaking the three-place new-token rule ONE COMMIT after writing it into CONTRIBUTING (eight names missing from the contract doc), plus a second stale census sentence. The adversarial seat falsified two claims by measurement: a THIRD live 56px header copy survived on the reader chassis (its failure scenario - a future --header-h change silently overflowing the reader - is exactly the class the token exists to kill), and two of the "mutation-tested" v7 guards had surviving mutants my fixtures could not kill (the ^-anchor and a 0-vs-digit env matcher; both now have killing controls, re-verified dead). It also confirmed the strong claims at full strength: v7 is behavior-identical to v6 over the same tree except the exact six intended rows; all 24 exemption reasons fact-checked TRUE (including git-history verification of every "was 3px"); Dean's held 19 byte-identical to main.

**Disclosed:** the differ cannot see media-scoped definition contexts, so one fallback conversion is proven by token-scale-lock rather than the differ (tech-debt #70); the whole-tranche differ delta is exactly the two enumerated value-preserving transform pairs (calc(-1 * var(--sidebar-w))); a mid-gate parallel-load run showed 2 integration flakes in files this tranche never touches (both pass in isolation and in both of-record runs). On-device probe: flip all three reading themes and confirm pane AND epub-iframe surfaces change together (a missing token now fails the whole book-open loudly - deliberate). Dual-Node of record, sequential: 5323/5323 on v22.23.1 AND v24.14.0, 0 skipped. Docker publish is Dean's. Remaining: Dean's ruling-1 close-out (the last 19), then the ratchet (gated on tech-debt #68).

### v1.59.0 - The era-consistency tier (tokens Tier 4) (2026-07-31)

The tier where the era system finally applies EVERYWHERE: the nine ghost-red sites (book/reader progress fills, shelf chips, reloc warnings, the stats footer link, the armed unpin button) stop consuming an undefined --accent and adopt var(--yt-red) - visibly a change only in 2014, where they join the era's #e62117 instead of clinging to #cc0000 (the split WAS the bug, per the standing ruling that --accent is never defined); the chapters editor textarea joins Courier in 2005/2009 via var(--mono-font); all seventeen global z-index rungs adopt the --z-* ladder names with backdrop/content pairs derived by calc, exactly three resolved values moving (sub-sheet 1601 and reloc-preview 1900 to kill the two DOM-order-dependent ties, hard-delete 2201 by the enumeration's own prescription) and both deliberate inversions preserved and documented (hard-delete above toast = warning primacy; audio-expanded below modals); the eleven raw-4px R7 radii adopt the era-varying var(--radius), so thumbs, covers, skeletons, and notif chrome go square in 2005 and 2px in 2009/2014 like everything else; --thumbnail-bg is defined per Dean's ruling (ex-phantom, six consumers, now the 39th contract name in token-scale-lock); and the thirteen dead var() fallbacks are gone. Burn-down: 110 -> 54, machine-predicted per batch and measured at every commit; the z-index category is ZERO. Linter v6 rides along: the ladder-calc idiom (nine names pinned by alternation) is tokenized, everything else with a digit still counts.

**Discipline of record:** a machine-generated 110-row census ledger (generated from ledger-check's own collector - hand-enumerated sets are banned after Step 3), bound by npm run ledger:check CLEAN at every commit; per-batch and full-span differ enumeration reconciling to zero unpaired lines (12/12/12/36/36/36/36/50/50 delta lines across the 9 era/mode contexts = exactly the z + font + red + radius pair sums); FULL two-reviewer gate. **What the gate caught:** the adversarial seat proved the z re-ladder's "impossible co-open" claims are really POINTER-impossible - no overlay traps keyboard focus, so Tab-behind-the-scrim + Enter can co-open any "blocked" pair (comments + enumeration doc re-scoped; focus containment = tech-debt #67); found the linter's line-based parser blind to multi-line declarations, hiding two unexempted rgba stops in the base seek/vol tracks (now explicitly exempted as 2005-skin art; parser fix = tech-debt #68, which GATES the future ratchet flip); and caught one fictional ledger attribution (a function name that never existed - corrected to applySubAvatar). QA caught two stale comments (the dl-chip block still speaking numeric rungs; the :root radius NOTE still claiming R7 deferred) and an unexplained rigor asymmetry between the two converted z locks (both now re-derive ordering from the ladder definitions). Mid-wave process failures are on the record in the commit messages: a mutation-verify cycle ran against the uncommitted tree and its restore step ate the very edits under test (redone post-commit, all mutants killed); the ledger re-line tool scrambled nine rows' selector attribution in a way the multiset checker structurally cannot see (repaired from selector truth, tool hardened).

**Disclosed and pending:** the Tier 4 Stop - Dean's per-surface approval of the eleven radius adoptions against the era screenshots (amendment b; per-site rejection = a one-line flip back to 4px), plus his judgment on the two preserved z inversions and the transient armed-unpin state on-device. Before-baseline: the v1.58.0 image + pinned ops profile. The census's 54 is truthful modulo the #68 parser blind spot (two exempted sites it cannot yet see). Tech-debt #67/#68/#69 filed, not silent. Dual-Node of record, sequential, reviewers idle: 5321/5321 on v22.23.1 AND v24.14.0, 0 skipped. Docker publish is Dean's (the tag push auto-publishes 1.59.0 + latest). The linter ratchet (tranche G) is now the only remaining token tranche.

### v1.58.0 - The design-token consolidation (Tier 3 Step 3) (2026-07-31)

The wave the whole token effort existed for: ~130 declaration changes across eight gated batches consolidate every drifted spacing, scrim, shadow, motion, line-height, control-size, and radius value onto the 38-name token system. Spacing drift snaps to the scale (7->6, 9->8, 14->12, 18->16, 28->24, 30->32 - menus, toasts, sheets, cards, login, reader, notifications); backdrops unify on --scrim (0.55) and the heavy overlays on --scrim-heavy (0.8); five elevation shadows converge on --shadow-modal; sixteen animation durations join --dur-fast/--dur-slow (the app feels uniformly snappier - 0.2s -> 0.15s was Dean's "faster" ruling); title clamps tighten to --lh-tight; player controls and the autoplay switch adopt the control-size tokens WITH the switch's hardcoded knob travel moved in the same commit (the coupling a sweep documented - skipping it parks the ON knob 2px short); and per Dean's ruling B the radius drift band joins the ERA-VARYING --radius-lg - album art and panels are rounder in 2021, square in 2005, 2px in 2009/2014, the era system finally applying to surfaces that ignored it. Twenty-four JS-applied styles (stats/watch/setup cssText and inline styles) adopt the same tokens. Burn-down: 692 raw literals at the audit -> 110, every survivor ledgered as Tier 4 residue or a ruled exemption with its reason annotated in-place.

**Discipline of record:** every edit was GENERATED from the 298-row expected-delta ledger (machine-bound by npm run ledger:check), each batch's differ enumeration matched its ledger rows exactly (the era-varying 3g batch verified PER CONTEXT against ruling B), and the full span is exactly 80 pairs x 9 contexts = the arithmetic sum of the batches. FULL two-reviewer gate, both seats unconditional APPROVE after one fix round. **What the gate caught:** the 3g commit message's burn-down claim was wrong by three (the per-site radius literals stay counted as R7 population) - corrected via an immutable-history correction record that BOTH seats then re-derived independently; a gate-killed premise (--radius-lg as a "new token") had resurrected in companion prose and is re-killed; three spelling locks and the mobile-toast lock followed the ledger with token-scale-lock as the byte-exact value authority.

**Disclosed and pending:** Stop B - Dean's per-scene review of the visible deltas against before/after captures (packet at docs/exec-plans/completed/2026-07-31-tokens-tier3-step3-stopB.md; before-state frozen in the immutable v1.57.0 image; per-site rejection flips revert individually without reopening batches) - plus his three manual gate-blocker shots (13-toast, 04-resume, 10-audio-expanded). Timing deltas (3e) are invisible to frozen captures and are judged on-device. The remaining 110 burn-down residue is Tier 4 scope (ghost-red, mono-font, z re-ladder, R7 radii, --thumbnail-bg definition) plus deliberate exemptions. Dual-Node of record: 5320/5320 on v22.23.1 AND v24.14.0, run sequentially with reviewers idle.

### v1.57.0 - Capture-safety hardening: the harness can never mutate the library again (2026-07-30)

Born from an incident, not a feature ask: during the design-token baseline captures, the retired scene 21-hard-delete two-tapped the first home card and - because the two-tap flow deletes yt-dlp-managed items DIRECTLY with no confirmation modal - permanently deleted 8 real videos across two runs (verified gone on the NAS; one was Dean's own non-re-downloadable upload; Dean triaged them as unimportant). Detection took log forensics because the container logs no HTTP requests - the only evidence was the app's own "Deleted file from disk" lines. Dean's directive: "we need to make sure this never happens again." Shipped as defense-in-depth per the incident handoff's P0-P3: (P0) every capture browser context is now created through request-policy.js's newGuardedContext - the ONLY context factory, source-locked - which fulfills every mutating request with an inert empty 200 (never aborted: an abort demonstrably corrupted the notif-panel scene's own pixels) so nothing mutating ever reaches the instance; allowlisted POSTs (login + the read-only relocation preview) are fetched BY the guard with redirects disabled, so a redirect out of the allowlist is refused, never followed - proven by a real-Chromium integration test that replays the incident end-to-end. Expected fire-and-forget telemetry (view/progress/seen) is recorded without failing the run; any other blocked attempt exits 1. (P1) a CI scene lint bans destructive actuation, scene-21 resurrection, and action-vocabulary drift. (P2) FILETUBE_READONLY=1: the app refuses every mutating VERB with 403 except login/logout/first-run setup and the dry-run preview - deliberately distinct from FILETUBE_READ_ONLY_MEDIA, which keeps user-state writes alive; documented side-by-side in CONFIGURATION.md. (P3) every mutating request logs one structured [audit] line (ISO timestamp, method, originalUrl with its query - removeAnyway is a different delete than a bare one - status, attributed user incl. the API-token caller, and an 'incomplete' marker when the response never fully went out) on finish OR close, once-guarded, so a client that tears the socket down mid-mutation can no longer mutate invisibly.

**What the gate caught (FULL gate, three rounds; both seats APPROVE):** round 1 - the guard had NO callsite binding (deleting it left 3931 tests green and lint clean: the repo's presence-not-binding class, on the single control that mattered); the audit was silently bypassed by client disconnect in the harness's own teardown shape; the abort primitive corrupted scene 12b's baseline; the always-exit-1 alarm fired on every healthy run. Round 2 - the adversarial seat REFUTED ITS OWN round-1 redirect prescription (redirectedFrom() is never consulted: Playwright follows redirects without re-invoking the route handler) and proved my close-path test vacuously green (a synchronous 404 outraces a socket teardown); their replacement prescriptions shipped verbatim and are mutation-bound (12 mutations, zero survivors, including maxRedirects, the 3xx alarm, the once-guard, and the incomplete marker). The factory refactor's own tests caught a frozen console.log default that would have blinded every log interceptor. QA caught the fresh-instance lockout (setup POST now allowlisted under readonly), the fixed-sleep flake shape (#53/#57 class - bounded polling now), the doc gap for the twin read-only levers, and a backwards serviceWorkers comment (per playwright-core's own docs, SW traffic is structurally invisible to route interception - 'block' is load-bearing, not insurance).

Disclosed residuals: media-serving GETs still write to the transcode/rendition cache under FILETUBE_READONLY (cache-only, self-healing - tech-debt #65); the managed-delete sharp edge itself (immediate unlink, no confirm, no recycle) is UNCHANGED pending Dean's retention-policy design - tech-debt #64; the scene lint is a named-class tripwire, not the guarantee (the runtime guard is); the first real capture run remains the arbiter for scene-level fidelity. Dual-Node of record, sequential, reviewers idle: 5315/5315 on v22.23.1 AND v24.14.0, 0 skipped (the real-browser test executes, not skips). Docker publish is Dean's; the harness-side guard protects the very next capture run via git pull regardless of image version.

### v1.56.0 - Reheat all subscriber counts (2026-07-30)

Dean: "Can we have a way to reheat all subscriber counts for all channels. Right now it's only one-offs." Before this, v1.54's real subscriber counts refreshed only per-VIDEO (download capture, the flame reheat, the library-wide repull - one full metadata dump per video), so catching a whole channel up meant reheating its videos one at a time. Shipped: a "Reheat sub counts" button on the Subscriptions sheet that re-probes EVERY distinct channel with content in the library - subscriptions AND one-off-downloaded channels alike (intake ruling 1) - with ONE cheap channel-level dump per channel (`--playlist-items 0`; `channel_follower_count` rides the playlist-level info dict, verified against current yt-dlp master source, not docs) and fans the fresh count out to every video attributed to that channel: count + "as of" date stamped as a unit, superseding unconditionally per the v1.54 no-monotonicity decision. Match rule mirrors the repull's sameChannel discipline - channelId decides when both sides know one (canonical vs handle URL spellings match; an impostor behind an equal URL string does not), URL/handle equality is the fallback. The batch is the refresh-avatars shape verbatim: hard single-flight 409, 202-with-blast-radius, durable cooperative cancel with in-cell button swap, probes serialized through the shared FIFO gate, activity progress (with a videos-updated tally - one channel probe fans out to many items) riding the existing status poll and the corner chip ("Reheating sub counts"), structurally locked against ever auto-running. The channel->items writer is deps-injected and its real server.js binding is proven by a boots-the-real-app bridge test (the presence-not-binding class demands the binding be proven at HEAD, not inferred).

**What the gate caught (slim gate, adversarial seat briefed to attack the fan-out writer; APPROVE round 1 with findings, delta re-confirm APPROVE):** a comment on the fan-out writer claimed updateDatabase may retry the mutator - it runs exactly once; the comment lied and is fixed. Repro'd: pre-first-poll, one real channel can be enumerated as TWO targets (a handle-URL subscription + a canonical-URL item), double-probing it and double-counting the videos-updated tally - the batch now dedupes the fan-out by probe-returned channelId (endpoint test pins the exact repro'd shape; the reviewer's mutant deleting the dedupe was killed), while the enumeration-level double-probe itself (shared verbatim with refresh-avatars since v1.25, idempotent, self-heals on first poll) is tech-debt #62. Both seats' mutants against the core (deleting the fan-out call site; bypassing the id-decides match rule) were killed by the suite.

Disclosed: non-YouTube extractor channels report no follower count from the channel-level dump - they count "failed" in the batch and keep whatever they had (tech-debt #63); refresh stays MANUAL-only by intake ruling 3, with the poll-piggyback (counts refreshing for free on every subscription poll) recorded as #63's revisit path if staleness annoys. Dual-Node of record at the approved hash dfa173c, run sequentially with no reviewer activity in the tree: 5276/5276 on v22.23.1 AND v24.14.0. On-device probe: the Subscriptions action bar now carries FIVE cells - the adversarial seat flagged that a CSS-blind gate cannot prove the auto-fit wrap at phone widths.

### v1.55.0 - Activity language + management-page design unification (2026-07-30)

Dean's four on-device asks, one wave. (1) The corner chip now says what is actually happening: "Reheating library - 12 of 200 - <current video>", "Reheating video", "Refreshing avatars", "Attributing videos" - every batch producer already stamped a kind server-side; the client renderer had been throwing it away and printing "One-off download" with a raw "running" status. Batch rows get a REAL processed/total progress bar (single-item batches get honest text, never a fake 0%), first-class summary lines, and truthful failure wording ("1 task failed", not "1 download failed"). (2) Equal-width action bars across subscriptions/settings/stats: one grid component, capped equal columns, whole-column wrap - and each Cancel now swaps IN PLACE of its trigger instead of popping a fifth button into the row. The watch page's one-off modal lost its floating stray Retry: Retry and Download share one aligned action row (Download keeps its full modal width). (3) ONE busy/status feedback system: setActionStatus/setButtonBusy with a reserved-height status strip (busy spinner, error tone) and the app's first generic disabled-button treatment - replacing six divergent ad-hoc stylings (bare spans, bold inline styles, style.color juggling) across every management action. (4) Every long section on subscriptions/settings/stats is a collapsible card now - including the JS-mounted Download history and Download failures - with per-section state remembered per browser; everything defaults open, so the layout is unchanged until you collapse something. Capability-hidden boxes (Users/Backup) can never be revealed by a stored collapse state.

**What the gate caught (full gate, THREE rounds, both seats REQUEST CHANGES in round 1):** two of the wave's headline behaviors were UNBOUND - full-suite mutants deleting the batch-never-retryable row gate and the in-place Cancel swap both passed 3842/3842 (under the first mutant, an errored reheat offered a Retry that fired the one-shot retry route against a fixed batch id: a dead button); the fixed-id dismiss interaction silently swallowed every SECOND batch failure after one dismissal (runnable repro, now a sequence test + a one-line prune); the action-bar grid shrank the modal's big Download button to half width and - by CSS-grid spec - would have stacked the settings footer buttons vertically; the exec plan over-claimed two Track B conversions (one implemented, one recorded as a deliberate trim). Round 2's standout: the adversarial seat caught a defect in THEIR OWN round-1 prescription (the footer fix overflowed every phone at a hard 328px min-content) - the verify-the-reviewer's-prescription norm working in both directions. Round 3 approved on sight. Also on the record: the first dual-Node runs at the fix-round hash showed one failure per Node - my own new test correctly "killing" a mutant the adversarial seat was re-proving in the SAME working tree concurrently (plus the known progress-coalescer load flake); lesson recorded, and the of-record runs were re-done sequentially on the quiet final tree.

Disclosed residuals: collapse prefs are per-browser localStorage (tech-debt #42 posture); "Your subscriptions" briefly carries TWO collapse affordances (the new card + the v1.32 hide-toggle inside it - unify next wave); the three 1s-polled scan status lines deliberately drop the aria-live my conversion had newly added (per-second screen-reader chatter; event-driven lines keep theirs); the failures-card right-alignment is page-local CSS and may fall back to space-between on an in-app nav (tech-debt #34 class, cosmetic, probed). Two QA doc-only nits from the final delta (a stale plan phrase, the reducer comment not flagging its now-deliberate Set mutation) were folded into this release commit with both seats' non-blocking sign-off. Dual-Node of record at the approved hash b26f5fc: 5192/5192 on v22.23.1 AND v24.14.0, run sequentially with no reviewer activity in the tree.

### v1.54.0 - Real subscriber counts + the Subscribe/Pin FOUC fix (2026-07-30)

Dean's three asks in one wave: (1) a subscribed channel's watch page flashed "Subscribe" before settling on "Subscribed", with "Pin channel" popping in even later; (2) with a long subs label the late reflow could push the buttons down a row; (3) "Subscriber numbers. Can we grab?" - the parked, previously-approved spec. Shipped: `channel_follower_count` now rides the exact rails the day-of view counts ride - captured at download time in both print templates (YouTube + universal lanes), validated by a bounded standalone parser, persisted as a `sourceFollowerCount`/`sourceFollowerCountCapturedAt` unit through every carry-forward cell (re-init, Phase-2 adoption, gap-fill, D1a proxy-host), re-snapshotted on every reheat with DELIBERATELY no monotonicity guard (subscriber counts legitimately fall - a supersede-DOWN is tested landing), and rendered as "24K subscribers as of 2026-07-30" via a YouTube-style FLOORING compact formatter. Uncaptured items keep the deterministic mock, unchanged. View-count labels moved to the same ISO date format (Dean's "I like that date format"). The FOUC died structurally: ONE synchronous applier renders Subscribe AND Pin together - frame-one from the v1.52 seed + v1.53 capability cache on warm navs, cached-first at hydration otherwise, confirmed answers re-applying only on difference - with subs+pins fetched in parallel (the Pin pop was a serial round trip) and write-through at every mutation (subscribe/unsubscribe/pin) so the cache is seconds-fresh.

**What the gate caught (full gate, THREE rounds, both seats REQUEST CHANGES in round 1):** the headline frame-one call sat 800 lines above the `let` declarations it assigns - a TDZ ReferenceError on EVERY warm-cache navigation that the SPA router's catch swallowed, leaving painted metadata over a dead page (no player, no prev/next), with the whole suite green because the only "binding" was a source-text grep - the presence-not-binding class in its strongest form yet. The adversarial seat's runnable vm repro is now a permanent behavioral test that executes the REAL watch init. Also: `subscribeBtn.remove()` on a stale cached answer was terminal (one transient health blip could poison the 5-min cache and permanently eat the confirmed answer - cached answers now only hide; removal requires confirmation); five mutation survivors bound with `# fail`-line proofs (the D1a apply site, all three carry arms at once, the validator bounds, presentNumeric-vs-present, the repull Pass A parse); compact counts rounded where YouTube floors (999,500 rendered "1000K"); as-of dates used UTC (an evening capture dated tomorrow); the phone-width chip ellipsized away exactly the as-of date. Round 2, from the QA seat, on the fix round itself: a round-1 fix (the exported ceiling constant) was silently LOST to a mutation-proof restore and its new boundary test stayed green by `null == undefined` coercion - the claim shipped false and is now bound with a typeof guard + strictEqual + both-shapes mutants.

Disclosed residuals: existing items get real counts only via reheat (capture is download-time); no monotonicity on followers (batch reheat included; a degraded read lands only as a literal numeric 0 - null/absent parse-skip); cross-device the cache can still show one stale flip (write-through is per-browser); the cold-cache first visit keeps the additive control appearance; a reheat landing between list-fetch and tap can flip the subs label at hydration (the accepted view-count seed class); the pin write-through is merge-only with a sub-second first-toggle window (fetchAllPins backfills authoritatively). One out-of-wave observation on the record: the adversarial seat's first full-suite run hit a non-reproducing file-level failure in `content-disposition-attachment.test.js` (untouched since v1.19.0, 8/8 in isolation, clean on re-run) - added to the #53/#57 flake watch. Dual-Node green at the approved hash c2ebe6a: 5165/5165 on v22.23.1 AND v24.14.0.

### v1.53.0 - Manual channel attribution + instant capability controls (2026-07-29)

Dean: "I want to attribute a specific video that doesn't have metadata of a channel (renamed/dead link) to another... I hate seeing not attributed YouTube content under the yt-dlp folder" - ~200 MeTube-era orphans no reheat could ever fix, because their channels are gone. The escape hatch: an "Attribute..." control on unattributed watch pages (structurally absent otherwise) and an "Attribute folder..." bulk control on folder views, both feeding one picker of your subscriptions + existing library channels. Attribution writes the identity as a unit with a STICKY manual flag - every automatic writer (the scan's three consume lanes, the folder backfill, the reheat) now declines to overwrite what you set by hand - and offers the physical move into the channel's folder: per-item with a confirm, or in bulk with a write-free server-computed preview, a count-naming confirm, a single-flight latch, a cooperative cancel, and crash-resume on re-run. A reheat that later resolves a CONFLICTING identity keeps yours and says so specifically (toast on the flame button, a counter on library-wide reheats) - your "specific error so it's known" requirement, wired end-to-end. And the second half: Reheat/Subscribed/pinned (plus the Re-pull button and the Subscriptions nav link) now render instantly on refresh from a sessionStorage capability cache - optimistic paint, real-probe reconcile, no service worker, cache cleared on logout/login so per-user pins never leak across accounts in a tab.

**What the gate caught (full gate, THREE rounds - the adversarial seat briefed to destroy your data, with runnable repros):** the picker was literally INVISIBLE (a missing reveal call left an opacity-0 full-viewport click-eater whose invisible rows could fire a blind 200-file move); the bulk selector was unconfined (the reviewer's repro swept two library roots' home videos into a "channel" folder, unrecoverably - now hard-confined to configured roots); the 200-file op had none of the ceremony the 1-file op had (preview/confirm/latch/cancel all added); the mover's results were reported to nobody (the folder view now polls and toasts moved/collisions/failed honestly); batch reheats silently swallowed attribution conflicts; per-user pins leaked across a same-tab user change; and a 19-mutant audit caught the fix round itself over-claiming test bindings twice - round 3's lesson, verbatim from the reviewer: "a test named after a mutant is not the same as a test that kills it." Two masked mutants are documented as masked rather than fake-bound.

Disclosed residuals: the picker list is flat/uncapped (fine at current channel counts); the bulk mover pays a per-item db load like the boot migrator (~200 well inside the envelope); a bulk cancel's between-items check is verified by reading, not deterministically testable; the capability cache's ~1 RTT stale window (your accepted trade). Dual-Node green at the approved hash: 5142/5142 on v22.23.1 and v24.14.0.

Probes: (1) attribute a dead-link MeTube orphan - identity paints, move confirm names the destination, file lands under the channel, everything survives a rescan; (2) reheat it - the toast says your attribution was KEPT and names what the source reported; (3) the folder bulk: preview counts match reality, the confirm names the destination, the summary toast reports moved/collisions honestly, a mid-run cancel stops and a re-run resumes; (4) refresh a watch page - Reheat/Subscribed/pinned render immediately and stay correct; (5) log out, log in as another user in the same tab - no pin flash from the previous account; (6) THE DESTRUCTIVE PROBE, on a throwaway folder first: confirm the bulk move puts files exactly where the preview said.

### v1.52.0 - Instant watch: no placeholder flash, no layout shift (2026-07-29)

Dean: "I see Loading title..., 0 views, no stars, Folder uploader for about a second when picking a vid on mobile... it just ruins the immersion." Recon measured the real chain first, as promised: THREE serial round trips before the first honest pixel (the whole watch.html document fetch+parse, then /api/config, then /api/videos/:id) painting over literal placeholders, with a zero-height player slot popping the page's tallest element in at the end - and the placeholders re-flashed on EVERY in-app hop because the SPA re-parses the fragment fresh each navigation. The fix: the tapped card's in-memory data (which carries 100% of what the metadata renders - verified field-by-field) paints the watch page SYNCHRONOUSLY during the swap, the player pre-loads from the same seed (real frame, right aspect from width/height, thumbnail as poster, stream starting two round trips early), the two remaining fetches run in parallel, and hydration fills only what cards don't carry without visibly rewriting anything. Every literal placeholder is purged and test-locked out of watch.html; cold loads (deep links, refresh) get calm neutral skeletons and a reserved 16/9 frame instead of any wrong text. Seeds flow from every navigation surface: home/liked cards, related cards, prev/next and keyboard hops, autoplay advance, the docked mini-player, and notification-bell rows (partial seed - instant title/channel, skeletons for the rest).

**What the gate caught (full two-reviewer gate, THREE rounds, both seats REQUEST CHANGES twice):** both seats independently caught that the two most passive hops - autoplay advance and dock-return - were never wired despite the plan naming them (the v1.41.4 every-writer class re-striking); the adversarial seat caught the pre-load handing the player RAW unresolved chapters (bypassing the server's manual-over-embedded precedence - junk chapters an operator manually overrode would have painted); round 2 caught the fix round itself twice: the new error-path close() could fire from a dead view and kill live playback (fetches now carry the view's abort signal), and watch-to-watch hops painted the new title over the OLD video still audibly playing (a full seed now supersedes the keep-alive reparent). The gate also solved a process mystery: two "phantom" commits that vanished were the pre-commit hook (which runs the unit suite) correctly refusing two red lock tests, its refusal swallowed by backgrounded pipes - the locks were doing their job.

Disclosed residuals: a STALE cached-home seed paints values hydration then corrects (text swap, no layout shift, self-correcting); a partial bell-row seed on a hop over a still-playing video paints the new title over old audio until hydration (narrow; a partial seed cannot start the new stream); cold-load portrait items correct 16/9 to portrait when data lands (seeded portrait is right from frame one). Dual-Node green at the approved hash: 5121/5121 on v22.23.1 and v24.14.0.

Probes (this feature IS the device test): (1) tap videos from home - title/channel/views/stars appear WITH the page, no flash, no resize as the stream attaches; (2) a portrait/Shorts item frames portrait immediately; (3) related-card, prev/next, and autoplay hops paint instantly AND the audio/title switch together; (4) tap the docked mini-player - metadata appears instantly with the already-playing video; (5) paste a watch URL cold - calm skeletons, reserved frame, no literal text anywhere; (6) throttle to Slow 3G and repeat 1-5; (7) era skins - skeleton tone matches each era.

### v1.51.0 - Notification bell: real download notifications (2026-07-29)

Dean: "A notification bell that shows the number of not yet known downloaded videos... Basically the exact real experience on desktop/mobile." A YouTube-style bell now lives in the top-right of every shell once yt-dlp is enabled, at least one subscription exists, and the new instance-wide settings toggle is on (default on; turning it off hides the bell but the feed keeps accumulating, so re-enabling has no history gap). Every yt-dlp download - subscription polls and one-offs, video and audio - lands in a global feed generated at the scan's consume sites, which structurally cannot notify for reheats, re-encodes, or hand-dropped files. Per-user two-tier semantics, exactly like the real thing: opening the panel zeroes the number badge (server-persisted), each row keeps its dot until tapped (tap navigates to the item), Clear all empties your view only. Rows render channel avatar, title, thumbnail, and relative time; desktop gets a right-anchored dropdown, phones a bottom sheet. First boot seeds the newest 30 provenance items as already-read history; deleted media prunes its notifications (no tap-to-404); moves re-key them; everything rides backup/restore as the eighth id-keyed carrier. The feed's monotonic ids are the seam a future Web Push wave plugs into.

**What the gate caught (full two-reviewer gate, two rounds, both seats REQUEST CHANGES then APPROVE):** the adversarial seat REPRO'D that live notifications dated by file birthtime were wrong on both sides of the clock - yt-dlp's `.part` rename makes birthtime the download START, so a long download could be born already-seen (or even self-evict inside its own insert), and NAS clock skew made badges mark-seen-proof; they are now stamped with the consume moment. The QA seat found a feed-only backup bundle would silently destroy every user's already-tapped dots (reads now survive by media-id re-keying), and that two promised production-path tests hadn't been delivered (they now are: reheat-never-notifies via the real writer, move-re-keys via the real endpoint). Also fixed from findings: re-key collisions orphaning reads, badge/panel disagreement on phantom rows (panel now self-heal-prunes), uncapped restored feeds, duplicate-mediaId bundles dying as 500s instead of clean 400s, a future file clock poisoning day-one seeding, prototype-key mediaIds ('constructor') rendering junk rows, and pre-account history wearing dots for new users.

**Bonus: tech-debt #53 - the repo's most-observed flake - is root-caused and fixed.** Its own escalation trigger fired during release runs (failed in isolation, 1-in-3), exposing the real mechanism: intra-file interference - the same test file's `POST /api/config` kicks a fire-and-forget scan whose membership-authoritative merge could erase the thumbnail test's just-seeded item. A deterministic `scanState` drain fixed it; 10/10 isolated runs green the same day it reproduced. If #57 (the unexplained CI flake) was #53, CI failures stop here.

Known gaps (disclosed): music-namespace tracks never notify (the feed covers the main library where yt-dlp downloads land); the badge is poll-based (<=60s), push is its own future wave; a badge can transiently over-count a phantom row until the panel is first opened (self-healing); the bell stays hidden until the first subscription exists even if one-offs occur (Dean's spec). Dual-Node green: 5108/5108 on v22.23.1 and v24.14.0 - including the fixed #53 suite.

Probes: (1) bell top-right on all eight shells, badge counts, panel opens/closes (outside-click + Escape); (2) real phone: bell in the new top-right slot without colliding with the logo/search rows, panel as a full-width sheet, safe-area respected - THE headline probe, the mobile header re-show is new CSS; (3) download something, badge increments within 60s, open zeroes it, dot survives until tapped, tap lands on the item; (4) Clear all clears YOUR account only (verify with a second user); (5) settings toggle off hides the bell everywhere, on again shows history with no gap; (6) after the Docker upgrade: panel pre-populated with recent downloads, all read, badge 0.

### v1.50.5 - YouTube-ish mobile control row: fullscreen in the corner (2026-07-29)

The mobile bar's button row ran in raw DOM order, leaving fullscreen mid-row. It now reads like YouTube: transport on the left (play, mute, volume), the settings cluster pushed right (speed, CC, chapters, PiP), fullscreen anchored in the far corner. Pure flex `order` + one auto margin inside the existing mobile block - no heights, no padding, no wrapping, no DOM changes, so the two-row layout's trap history stays sealed by construction. The push margin lives on the always-rendered speed button, never the hidable CC button. Bonus: the right-anchored speed/chapters popups now open directly above their own buttons.

**What the gate caught:** the reader's now-playing bar mounts the same `#player-slot`, so the new 2-id order rules leaked in and flex-sorted the play button behind the scrub row on a book's mobile bar - the "second surface mounts the same slot" class. Fixed with an id-specificity reset of all eight buttons in the reader block (all eight, so a future unhide can't resurrect the leak), and the reviewer's mutant that survived the original lock (orders escaping the media query) now bites after the lock was scoped to the mobile block. Delta round: 4/4 mutants killed, APPROVE.

Probe: watch bar = play/mute left, cluster right, fullscreen corner (CC/chapters appear between speed and fullscreen on captioned/chaptered items); a book's now-playing bar should look byte-identical to before. Dual-Node green: 5073/5073 on v22.23.1 and v24.14.0 (the #53 flake fired once in a background run, green isolated + on re-run).

### v1.50.4 - Re-pull joins the watch row on mobile (2026-07-29)

The Re-pull button (subscribed-channel folder views) appended to the sticky toolbar with no flex order, so on phones it landed in the one-glyph-line's zero-slack budget and wrapped onto an orphaned middle row. It now carries `order: 11` and the watch group's wrap trigger relaxed from a hard `width: 100%` to a 70% grow-basis - the group still can never fit the always-full row 1 (the gate verified the flex math: joining would need a ≥1046px container inside a ≤768px query), so it still anchors row 2, but Re-pull now shares that row beside it. Alone, the group fills row 2 exactly as before.

Slim gate APPROVE, both mutations bitten by the updated locks, exhaustive writer sweep found no other orderless toolbar joiner. **Probe item (gate WARNING, CSS-blind-gate class):** on ≤360px phones in a subscribed-channel folder view the "Watching" pill label may overflow its borders by a few px - metrics-estimated, device is the arbiter; the contingent fix is a small mobile font/padding trim on the watch pills. The #53/#57 thumbnail flake fired once in the implementer's first full run (green on re-run, tracked). Dual-Node green: 5071/5071 on v22.23.1 and v24.14.0.

### v1.50.3 - speed picker with sub-1x rates + D dark/light shortcut (2026-07-29)

**Playback speed goes YouTube-complete.** The rate list widens to `0.25 - 2x` (old stored preferences are a strict subset - every one survives), and with eight rates a blind click-cycle would mean up to seven clicks through unwanted speeds, so the speed button now opens a **picker** built on the chapters-menu popup the bar already had (era theming, outside-tap dismissal, and lifecycle closes inherited for free; `1x` is labeled `Normal`, YouTube's spelling). Selection routes through the same single apply path as the `<`/`>` keys, which now genuinely slow below 1x, clamped at 0.25. The retired blind cycle is removed with a lock.

**`D` toggles dark/light** on any page (desktop, same gating as `?`) through the exact same `toggleTheme()` path as the header moon/sun button, documented in the shortcuts reference with a statement-anchored drift lock.

**What the slim gate caught - the CRITICAL was the headline feature eating itself.** The picker shared the popup class inside the same `overflow:hidden` 45vh-capped wrapper but not the v1.43.1 height clamp - on mobile portrait its TOP rows (0.25/0.5/0.75x, the very rates this release adds) rendered into the clipped band, unreachable, with no keyboard fallback on a phone. The clamp is now shared by both popups (one measurement function), applied on open and on rotate. Also: a Back-button dock (popstate - no click, so no outside-close) left the picker invisibly open and resurrected it stale on re-expand (dock() now dismisses both popups); the new D drift lock was **dead against the exact regression it documented** - its `toggleTheme()` match was satisfied by an explanatory comment, proven by a surviving deleted-call mutant (comments now stripped, statement-anchored); three stale comments including one claiming wrap behavior the code never had; the iOS touchstart dismissal belt and proper `role="menu"` ARIA joined from suggestions. Delta round: **all 8 mutants killed**, APPROVE.

Dual-Node green: 5071/5071 on v22.23.1 and v24.14.0.

### v1.50.2 - typography pass: era-accurate fonts + sentence case (2026-07-29)

Dean: "the newest Modern and Flat don't feel like YouTube text wise" - and the diagnosis was that we were historically wrong, not stylistically off:

**2014 Flat is now Arial.** The real 2012-2016 pre-Polymer YouTube desktop was Arial; Roboto only took the site with the 2017 Material redesign, so Roboto-in-2014 read as "2017 wearing a 2014 layout." **2021 Modern titles are now medium-weight** (real modern YouTube titles are YouTube Sans at medium, not bold) with slight negative tracking, via three new era tokens (`--heading-font/-weight/-tracking`) consumed by exactly the three title surfaces - test-locked at exactly three. **YouTube Sans itself cannot be bundled** (proprietary commissioned face, no open license - Roboto ships because it's Apache-licensed), but the 2021 heading stack names it FIRST: zero files distributed, and a locally-installed copy wins automatically. Spacing-safe by construction: weight/family/tracking only, no sizes or padding, and the historically fragile rows have been wrap-protected since v1.50.1.

**Sentence case app-wide** (the Material/modern-YouTube standard the sort dropdown already used): 24+ Title Case phrases converted across every shell, the yt-dlp module's own served view, and the JS writers of the same strings - "Library settings", "Resume playback?", "Recently added", the whole settings page. Proper nouns and the mock commenters untouched. A substring no-straggler sweep over both shell directories locks it.

**What the slim gate caught - three rounds, and round 2 was the one that mattered.** Round 1: the sweep had missed the yt-dlp module's own served shell entirely (and the test was structurally blind to it); my own sed ordering had shipped half-converted hybrids ("Save Book folders"); a JS writer repainted the converted heading in Title Case on every search. Round 2 (CRITICAL): my fix for a round-1 suggestion - putting the heading tokens in `:root` - silently regressed every non-2021 era's titles back to Roboto through custom-property inheritance (the var() fallback goes dead once the property is defined up-tree), with the suite green throughout; the reviewer also mutation-proved the no-straggler lock couldn't see the sidebar's icon-sibling markup shape. Both fixed with mutation-verified locks; round 3 APPROVE.

Dual-Node green: 5064/5064 on v22.23.1 and v24.14.0.

### v1.50.1 - on-device polish: squeeze-zone wrap, dimmed download chip, chapters root-caused (2026-07-29)

Dean's first v1.50 on-device pass ("It's beautiful!") came back with three small items, shipped same day under the slim gate:

**Landscape-phone toolbar overlap** - exactly the squeeze zone the v1.50 adversarial seat flagged for probing: a phone held horizontally is wider than 768px, gets the DESKTOP layout, and with the new watch group the non-shrinking actions row overflowed onto a folder-view heading ("yt-dlp" hidden behind the All button). The home sticky bar now wraps - wide desktop is unchanged; squeezed widths drop the actions to their own line.

**Collapsed download chip dimmed** - the bottom-left chip (pulsing dot, nothing more until clicked) now sits at 55% opacity so it doesn't obscure content; full opacity on hover/keyboard focus/expanded. **The gate caught the exemption that matters:** the ERROR state (the "needs attention" dark-red dot) is never dimmed - on touch there is no hover to rescue a faded attention affordance. Both the rule and the class-to-element bindings are mutation-locked.

**Chapters as "Unknown language" - root-caused, honestly deferred (tech-debt #61).** The label is iOS's native player rendering the EMBEDDED chapter track that `--embed-chapters` has ffmpeg's mov muxer create, tagged `und`. FileTube's own chapters menu and the `srclang="en"` caption track are unaffected. No ffmpeg on the dev box to verify a safe lever, a blanket `-metadata:s` would mis-tag non-English media, and existing files are never mutated - so the fix direction is recorded for a box that can verify it, not shipped blind.

Dual-Node green: 5057/5057 on v22.23.1 and v24.14.0. The #53/#57 thumbnail flake fired twice across the gate's six full-suite runs - still pre-existing and untouched, but now the most-observed open flake; its isolated-DATA_DIR fix is queued as next-wave work.

### v1.50.0 - UI wave: watched filter, era player skins, and six fixes/asks (2026-07-29)

Dean's six-item intake plus one mid-wave ask, all in one branch:

**Watched-state filter.** The home sticky bar gains a second segmented group, `All | New | Watching | Watched`, next to All/Videos/Audio - server-side (`?watch=` on both `/api/videos` AND `/api/liked`; pagination makes a client-side filter wrong across pages), per-user, with every item carrying a server-derived `watchState`. "Watched" is backed by a **sticky completion latch** (new `user_watched` table, schema v4, additive) set the first time a progress ping crosses 90% - so a looping or rewatched-from-the-start video never un-watches itself (Dean's intake flag). The latch is a full id-keyed carrier from birth: delete/prune, move re-key, backup/restore, and the test reset all carry it in the same commit that created it. **Disclosed inherent:** an autoplay chain latches each video that genuinely plays to the end - played to completion = watched.

**Era player skins.** The custom control bar now visually represents each era - same controls, same spacing, same geometry to the pixel: the base bar IS the 2005 blocky Winamp bevel; 2009 gets glossy gradient chrome matching the site's own glass buttons; 2014 goes flat with borderless ghost buttons, the era's brighter red, and a red dot scrubber; 2021 goes flat + round + crisp (circular hovers, thin pill tracks, YouTube's round red scrubber). Two hard rules, both test-locked: era rules are visual-only (never bar geometry - the mobile two-row layout's trap history stays sealed) and token/rgba-only (no hardcoded hex, so every skin is correct in both light and dark with zero mode-scoped rules).

**The doubled All/Videos/Audio row - root-caused and fixed.** The de-dupe lookup was `document.getElementById`, which cannot see the DETACHED cached home view (`homeViewCache` skips destroy; a background refresh re-renders the cached instance when a download finishes while you're off Home) - so a second toggle was appended and reattached doubled until a hard refresh. Both toolbar renderers (and the "(N items)" badge, same latent bug) now scope their lookups to the container; regression tests simulate the detached double-append AND the inverse live-row-steal hazard.

**Mobile watch row un-wrapped.** Reheat made the glyph group six buttons and pushed the whole row down (the v1.47.5 wrap safety net firing, "makes me sad"). The cosmetic "N / 5" number hides at phone widths, stars stay, desktop keeps both.

**Resume-prompt keyboard shortcuts.** `R` = Resume, `S` = Start over, live only while the prompt is showing, routed through the real buttons' `.click()` so keyboard and mouse can never diverge; documented in the `?` reference with the bidirectional drift lock extended to cover them.

**Phone landscape bounded.** Landscape non-fullscreen had NO height cap (every prior cap was portrait-scoped) - a full-width 16:9 box plus the control strip, taller than the screen. The picture now letterboxes to fit under the header; and rotate-to-fullscreen requires the media to actually be PLAYING (it used to yank a paused player fullscreen). Rotate-while-playing immersion is untouched.

**Subscriber badge (mid-wave ask).** The watch page's subscriber count is now the classic-YouTube boxed-count badge - an era-token chip, square in 2005/2009, rounded in 2021.

**What the gate caught (full two-reviewer gate - the new table is user data).** QA: `close()` never reset the resume overlay's visibility, so after Delete/Move/relocate closed the player mid-prompt, the new R/S keys kept firing clicks at a torn-down player (fixed, mirroring dock(); mutation-locked). Adversarial: a crafted string `duration` coerced through the latch division while the filter's strict number check disagreed - three readers, two answers (fixed: duration normalized once at staging; the exact repro is now an integration test). The adversarial seat's data-destruction pass - real v3→v4 upgrade repro built from actual v1.49 code, crash-mid-migration replay, downgrade round-trip, hostile `__proto__`/NUL restore bundles, FK race analysis on the hot path, full carrier sweep - found nothing; all five of its mutations were killed by shipped tests.

**Known gaps (disclosed):** iOS Safari < 16.4 drops the landscape cap selector (`:not(:fullscreen)`) - those devices keep pre-v1.50 uncapped landscape, fail-safe. The mobile watch action row's nowrap guarantee is now wrap-on-overflow (strictly better than clipping, but a behavior the old contract forbade - on-device probe item). The pre-existing thumbnail-cache flake (#53/#57) fired once in each seat's full-suite runs, untouched by this branch, re-corroborated in the tracker. Dual-Node green: 5054/5054 on v22.23.1 and v24.14.0.

### v1.49.0 - per-video reheat: force a reheat on one video from the watch page (2026-07-29)

Dean asked to force a reheat on a **specific** video rather than the whole library: check whether it is a YouTube video, associate it with its channel, refresh the view count, all of it, one video at a time. The library-wide Reheat is all-or-nothing, and a non-force run skips everything already marked, so there was no way to refresh a single item.

A small flame button now sits inline with Like/Share/Move/Download/Delete on the watch page - same size, same row, one line. It refreshes that video's channel identity, real title, view count, release date, chapters and subtitles, then **offers** to file the video under its channel folder. The move is a separate, confirmed click that states the destination and whether it is a hard link or a real cross-filesystem copy before anything is touched.

**The metadata pass was extracted, not copied.** `reheatOneItem` is now the single implementation the library batch and the per-video route both call - every precedence rule and completion-marker decision in it was paid for by a gate finding between v1.33 and v1.48, and a second copy would have been free to disagree with the first.

**Two deliberate escape hatches, both defaulting off and both scoped to the attended per-video path only.** An explicit single-video force may now write a **lower** view count (the v1.48 monotonicity guard is right for an unattended batch of thousands and wrong for one human looking at one item; tech-debt #60 stays open against the batch). And it may relocate a file you are currently watching - see below.

**What the gate caught - four CRITICALs, and two of them were "this does not work at all".**

- **The relocation half shipped unreachable.** `planImportRelocation` refuses to move any file streamed in the last ten minutes. The watch page streams the video on mount, and the watch page is this feature's only entry point - so the proposal always came back unavailable and the confirm dialog could never open. The route, the re-key navigation and the archive disclosure behind it were all dead code. **4949 tests were green while the feature's headline half never executed once**, because every server test stubbed the planner. The repo's own v1.41.6 test already asserted the behaviour that kills it. Same class as v1.47.4's dead headline fix.
- **Then the fix for the third finding was dead code in exactly the same way.** The stale-proposal re-ask refuses to open on top of an existing dialog - but the shared confirm modal tears down *before* running its callback and leaves the backdrop in the DOM for the 200ms fade, so the guard always matched the dialog that had just triggered the re-ask. It would have worked only under `prefers-reduced-motion`. Fixed with `:not(.modal-closing)`, and this is the finding that produced the wave's **first runtime test** - the adversarial seat's point being that three of four CRITICALs lived in client code that only source-text regexes cover, and this one walked straight past them.
- **A background timer could re-label an open delete confirmation into a move button.** The shared modal resolved its buttons with `document.getElementById`, which returns the first match - harmless while every caller was synchronous from a click, and reachable the moment a poll could open one. A reheat completing while a delete confirm was open bound the relocate handler on top of the delete handler: one click, both actions.
- **The confirm carried no binding to the proposal it was shown for.** Re-running the decision proves a move is legal, not that it is the move you approved - and subscribing to the channel from the very page the reheat just fixed up changes the destination folder. The client now echoes back the exact move it displayed, including the hard-link-vs-copy claim, and a mismatch is refused with the new destination so the dialog re-asks.

**Also fixed, outside the feature's own scope:** `POST /api/videos/:id/move` - the Move button - has been unlinking without closing its own read streams since v1.41.10, the DELETE_PENDING class that stranded ~180 fds in production. The delete route has awaited that since; the move never did. Now closed. **Disclosed:** an in-flight seek on a file being moved now truncates instead of finishing on its open fd.

**Known gaps, shipped disclosed.** The app was never run during this wave - every verification was tests plus static reasoning, and one manual click would have found the first CRITICAL. The flame glyph is FileTube's own drawing (not a Material asset, documented as such) and **has never been rendered in a browser** - there is no SVG renderer in the build environment, so it was verified by rasterising the path to ASCII. Most of `watch.js` remains locked by source-text presence checks rather than runtime tests; that residual is recorded with a revisit trigger. Dean's device pass is the arbiter on all three.

**Suites, stated exactly.** The release-gate run was **4985/4985 on Node 22.23.1** and **4984/4985 on Node 24.14.0** - one failure, `core-config-thumbnail-cache.test.js` "serves the real .jpg", receiving the placeholder `image/svg+xml`. That is tech-debt **#53**, the known full-suite-load-only flake, and this is its **second** appearance in this wave (an earlier gate round saw 4976/4977 on the same test). It was not taken on faith either time: three isolated runs of that file, two further full runs on this branch, and two full runs on the **pre-wave baseline** were all green, and v1.49 touches nothing in the thumbnail, cache or scan paths. An intermediate round was 4984/4984 clean on both. **This release ships with a known-flaky suite on Node 24, disclosed rather than re-rolled until green.** 25 mutants killed across the wave; **two survived first** - one on the relocate latch and one on the `browseCtx` restore - each revealing a fix that had shipped with no test.

### v1.48.0 - metadata + UX wave: full descriptions, real view counts, related 20 (2026-07-27)

Dean's six-item wave. Five shipped; **item 6 (a suspected duplicate file after a one-off download) he withdrew** - he could not reproduce a duplicate and asked not to conflate it with anything else. No duplicate-detection and no reaper work was done, which is the right outcome: this repo shipped a file-destroyer of that class once already (v1.41.6).

**Two of the six diagnoses inverted the plan before any code was written.**

- **Full descriptions needed NO reheat work at all.** The brief assumed a capture gap. The full text was always in the file (`--embed-metadata`), always read (ffprobe's 16MB buffer, raised for exactly this), always stored untruncated. The truncation was a 400-character `clip` in the *watch page's* "Embedded info" block - and worse, the description box **never rendered the description at all**: it is static self-hosting boilerplate, and the `-webkit-line-clamp` sat on *that*, so "Show more" had been expanding three lines of static text since it shipped. The clamp now lives on the description.
- **Outdated mock commenters were not a code bug.** A line-joined whole-tree scan found zero retired names in source. They were frozen in **Dean's browser localStorage**, written on each video's first view before v1.44.3 and never re-read - which is exactly why only *some* files showed them, and why no server-side fix could ever have worked. The migration keeps every comment Dean posted himself (they live in the same array) and purges by absence from the current bank, so it is name-agnostic rather than a list of nine strings.

**Real view counts** are captured from yt-dlp at download and re-snapshotted on reheat; they were previously 100% fabricated from a hash of the media id. The watch page labels them honestly - **"1.2M views when downloaded"**, or "as of \<date\>" once a reheat has refreshed them. Fake stars stay, per Dean. **Related items: 10 -> 20**, with the honest caveat that on a small library the extra slots are filled from the most-recent tail, not from genuine matches. **Appearance moved to the top of Library settings.**

**The gate ran four rounds and found more than the implementation did.** What it caught:

- **The field name would have corrupted the stats page.** `item.viewCount` was already taken - the legacy pre-v1.42 *local watch counter*, still honored as a floor by `effectiveViewCount`. A freshly-downloaded video would have reported ~12 million local plays. The field is `sourceViewCount`; no bare `viewCount` survives anywhere in the bridge.
- **The "when downloaded" label was false after a reheat.** The capture date was written by five paths and read by none, while the label was hardcoded - so the instant the re-heatable feature Dean asked for fired, the page asserted the wrong provenance. The qualifier is now derived from the stored date.
- **Six write paths had no test that would fail if the wiring broke** - including the reheat itself. Every test was a pure unit test. Closed with 18 integration tests and then mutation-verified rather than asserted; the adversarial seat re-ran an 11-mutant battery and confirmed each kill independently.
- **A test that named a branch it never reached.** The "re-init carry-forward" test passed with that branch deleted - the Phase-2 gap-fill masked it. Same class as the headline finding, in subtler form. Fixed by correcting the false comment *and* adding a test that isolates the branch.
- **A reheat could overwrite a good count with a degraded one** (a bot-check fallback reporting 0 landing over a captured 1.67 billion). Guarded, with the honest limit recorded: YouTube does audit and purge views, so this delays a genuine downward correction. Tech-debt **#60**.
- **The description bound re-imported the cost it removed** (213ms / 95MB of heap on a 16MB tag) and an out-of-range capture date rendered literal "as of Invalid Date".
- **Applying a reviewer suggestion, I deleted a load-bearing guard outright** and caught it by reading the file back rather than trusting the edit. Reported in the commit; the unit suite did not catch it, because every fixture is short.
- **All three of us leaked private names while arguing for de-identification** - the adversarial seat printed all nine into its report, and I put three into a test file, the exec plan and a source comment. All stripped.
- **One reviewer prescription refused:** seeding the stale-name fixture from the full retired set would have re-committed nine real names, undoing v1.44.3/v1.44.4. Both seats agreed the name-agnostic property is strictly stronger.

- **Known gap, shipping disclosed:** items 1 and 4 rest on **DOM wiring that `node:test` cannot exercise**. Mutation-proved across rounds: restoring the original description bug, deleting the render call, and bypassing the comment migration all leave the suite green. The pure helpers are well covered; the wiring is not, and rests on Dean's device pass.
- **The known thumbnail flake (tech-debt #53) bit during the gate** on both Node versions and was independently reproduced by the reviewer, which corroborates that #57's unidentified CI failure is just #53.
- Node 22: 4910/4910. Node 24: 4910/4910. Lint 0 errors. Dean's device is the arbiter.

### v1.47.8 - keyboard shortcuts reference (2026-07-27)

Dean: *"Can we make a keyboard shortcuts page/modal? ... mirror YouTube's or other modern apps'. Ignore/not display on mobile viewport. Keep it simple."*

`?` opens a dialog listing the shortcuts, from anywhere. Esc or a backdrop click closes it. There is also a **Keyboard shortcuts** button on the Stats/About page, because `?` alone is a secret handshake - one static element on one page rather than an injection into nine shells' sidebars, deliberately sidestepping the nav-injector idempotency class v1.47.4 had to fix.

**The rule the feature lives or dies by: every row documents a shortcut that actually exists.** The list was written by reading `player.js`'s keydown switch and `read.js`'s handler, not by copying YouTube's published set - a reference listing dead keys converts *"I don't know the shortcut"* into *"the app is broken"*. A drift-lock test asserts the list against those handlers.

**The gate took three rounds and was right every time.** What it caught:

- **CRITICAL: none of the documented playback keys work on `/music`.** The player's handler returns unless it is in `STATE_FULL`, and music always loads docked - as does any video once you navigate away from `/watch`. My note ("works while a track is open and you are not typing") was false on an entire library. Fixed by telling the truth rather than changing player behavior: making the mini-player keyboard-controllable is a real behavior change, well outside "keep it simple".
- **CRITICAL: one Escape closed up to four things at once.** Four independent document-level Escape handlers, none stopping propagation. Worst case: paste a URL into the download modal, click its body, press `?` then Esc - the download modal closes too and **the pasted URL is gone**. Fixed with capture-phase binding + `stopImmediatePropagation`, scoped to fire only while the dialog is open (Esc with no dialog is byte-identical to before, verified).
- **The player drove the media behind the open dialog** - including `0` seeking to 0% **and writing that position to the server**, pressed while reading the "0 … 9 Jump to 0%-90%" row. A help screen must not mutate persisted state.
- **`M` (mute) existed and was undocumented**; `Shift+N/P` is "next chapter" in the reader, not "next item"; the reader flipped pages behind the open dialog, losing your place.
- **The drift lock was decorative.** Mutation-proved: changing `skip(-5)` to `skip(-15)` left the dialog saying "Back 5 seconds" with every test green - and **v1.41.11 changed exactly that number**, so the lock would have shipped a lying dialog through that release. Two further false passes survived my first repair (a dead `←` read the *next* branch's seek amount; a brand-new undocumented shortcut was invisible because only the filter, not the universe, came from the handler). The lock now catches all five of the reviewer's mutations plus four of five new ones.
- **Four false comments**, one of which I wrongly reported as corrected and which then needed a third revision. Recorded honestly in the code itself.

- **Deferred, disclosed:** tech-debt **#58** (arrows double-fire in the reader while narration plays - pre-existing, but this dialog raises its visibility) and **#59** (no focus trap - the concrete harms were fixed directly; the remainder is cosmetic).
- Node 22: 4838/4838. Node 24: 4838/4838. Dean's device is the arbiter.

### v1.47.7 - hotfix: the Share glyph was invisible (2026-07-27)

Dean, immediately after v1.47.6: *"Download, Trash, move, Like are clear but the last one is a blank box."*

A mask-icon needs **two** enumerated selector lists in `style.css` - the sizing/mask block, and the `@supports` block that paints `background-color: currentColor`. `.icon-share` was added to the first and missed in the second, so it had a mask but no colour to cut: an invisible 1em box. The `@supports` gate exists deliberately (its own comment says it stops a failed/404 mask rendering as a solid square), which is exactly why a missing entry fails silently rather than loudly.

This is the repo's recurring **"enumerate every writer"** class (v1.41.4) in a new costume: I added the icon to one list and not the other, and nothing checked. So the fix is not just the one line - `icon-assets.test.js` now enforces **parity across the whole class**: every icon declaring a `mask-image` must also appear in the fill guard, so the next icon added cannot repeat this. Negative-controlled (removing the entry fails two tests).

- Also relaxed a v1.40 lock that pinned the fill guard's exact neighbour sequence (`.icon-heart, .icon-download, .icon-shuffle`). Inserting any new icon into that list broke it - an over-specified assertion that failed on correct changes while still not catching the case that matters (an icon *missing* from the list). It now asserts membership; the new class-wide parity test covers the rest.
- Node 22: 4818/4818. Node 24: 4818/4818.

### v1.47.6 - the watch action row goes icon-only on phones (2026-07-27)

Dean, on v1.47.5: the row was contained, but *"Original era, Classic era have the Share button go a line under. Flat and Modern do not. Everything else good."*

That era split is the diagnosis: Original is Verdana, Classic is Arial, Flat and Modern are Roboto - an exact font-width ordering, confirming the row was only **marginally** over budget. Five labelled buttons cannot fit a ~328px content box in a wide font; five glyphs fit any font with room to spare. So rather than tune padding until it happens to fit one typeface, the **words are dropped at phone widths and the glyphs kept** - which removes the class rather than the current instance. This is the same treatment `.section-actions` has used since v1.45.3, so it is the established pattern here rather than a new idea. Meaning is preserved: all five buttons already carry `title` **and** `aria-label`, and desktop keeps its labels.

Three of the five buttons could not be made icon-only before, which is why this had not been done: their labels were **bare text nodes** (CSS cannot target those), and Like/Share were built with `textContent =`, which wipes any child element. All five now use `<i class="icon-*"> <span class="btn-label">`.

- **Fixed a long-stale claim in the process:** the Like button used a plain unicode heart (`Liked ♥`) because its comment said *"there is no dedicated heart/like glyph in the icon-set"*. That was true when written, but `.icon-heart` has existed since **v1.40** - so the comment had been false for six minor versions. It now uses the real glyph, which also honours this repo's v1.38 lesson (*draw glyphs in CSS, never emoji codepoints* - iOS renders them inconsistently). Liked state is still carried by `btn-primary` + `aria-pressed`, so nothing depends on the hidden word.
- **New asset:** `share.svg`, base-directory only. The per-icon-set overrides are enumerated individually, so a base-only glyph falls back correctly in every set - exactly how `heart.svg` already behaves.
- **Share's "Copied!" feedback survives:** it now writes to the label span rather than the button's `textContent` (which would have destroyed the icon), and a toast was added as a belt-and-braces path. That branch is the *desktop* fallback anyway - mobile has `navigator.share` and returns to the native sheet before reaching it.
- **Wrapping from v1.47.5 is deliberately RETAINED** as the safety net: hiding labels makes overflow unlikely, `flex-wrap` makes it impossible. If a sixth button is ever added, the wrap is what still saves it.
- Node 22: 4816/4816. Node 24: 4816/4816. Dean's device is the arbiter.

### v1.47.5 - Dean's v1.47.4 on-device follow-ups (2026-07-27)

Two fixes from Dean's device pass on v1.47.4. He confirmed items 2, 3 and 4 of that wave working; these close the two he flagged.

**The PWA resume pointer now represents a POSITION.** Dean: *"if I am on a video and then go home and then force-close, it brings the video back ... it's almost a little too sticky. If it's to work it should actually represent the position."* Exactly right, and the bug was precise: `recordLastSession` **skipped** the write on a non-restorable URL instead of **clearing** it, so navigating Home left the last video stored forever. The pointer meant "the last restorable page you ever visited," which is not a position. Home now clears it, so deliberately leaving a video is remembered as leaving it. The clear is gated on standalone display mode (gate suggestion) so that where storage is shared between a browser tab and an installed app - Android/desktop Chrome, not iOS - an ordinary tab landing on `/` cannot wipe a resume the PWA legitimately stored.

**The watch action row is contained in every era.** Dean: newest era *"absolutely perfect"* on mobile, earliest era's Download/Delete/Move/Like/Share row *"goes a little too far off the right."* The **dominant cause is button count** - that group grew from 3 to 5 (markup ships Download + Delete; `watch.js` appends Move, Like, Share), which overflows a 360px viewport in Roboto too. The era asymmetry is secondary: 2005 is the sole Verdana era (~10% wider than Arial/Roboto), so it surfaces there first. Fixed structurally rather than by tuning 2005: the row was `nowrap`, whose min-content width is the **sum** of its items, so once the sum exceeds the viewport it simply overflows and per-era padding tuning would only move the breaking point. Allowing it to wrap at the phone breakpoint makes min-content the **widest single button**, which cannot overflow for any era, font, or future button. The group's own `gap` was also tightened - the one lever v1.25.4's mobile block never pulled - so the wrap stays a last resort.

- **DISCLOSED reversal:** v1.25.4's "Move must not land on an orphaned line" rule was **phone-scoped**, so this deliberately gives that guarantee up on phones. Content off-screen and unreachable is strictly worse than a second line, but it is a reversal, not a preservation. Desktop keeps `nowrap`.
- **A fix was ATTEMPTED AND DROPPED, honestly:** `--js-runtimes node` was added to chase Dean's remaining `HTTP Error 403: Forbidden`, then removed at the gate, which proved it twice-wrong. It would have been **inert in our image** (yt-dlp's node provider needs a `yt.solver.lib.js` the wheel does not vendor, and `yt-dlp-ejs` is extras-only so our bare `pip install` never pulls it - `--list-formats` was byte-identical with and without it), and the causal story behind it was **false**: an unsolvable `n` makes a format *disappear* (`continue`), it is never served un-descrambled, and with no JS runtime yt-dlp selects `android_vr`, which carries `REQUIRE_JS_PLAYER: False` - nsig has never been on FileTube's path. Better-supported explanation for the 403: `android_vr` has no PO-token policy, so yt-dlp hands out a token-less googlevideo URL, and Dean's own datapoint (a 403 that recurred then succeeded on retry) points at intermittent session/IP pressure rather than a deterministic per-video failure.
- **STILL OPEN:** the download `403 Forbidden` (item 1 of v1.47.4 got downloads *past* subtitles, but they can still fail at the media fetch). The discriminator is one datapoint - deterministic per video vs. intermittent. Next levers if intermittent: the existing cookies-file path, or `FILETUBE_YTDLP_PLAYER_CLIENT`.
- **Deferred, disclosed:** tech-debt #56 - `.section-actions` carries the identical latent overflow and was consciously left alone (Dean-approved layout, tuned across v1.45.3/45.6, no reported symptom).
- Slim adversarial gate: **REQUEST CHANGES → applied**. It also caught two false claims in my own comments (the eras differ in `--density` too, not only font family; and the v1.25.4 rule was phone-scoped). Node 22: 4811/4811. Node 24: 4811/4811.
- **Dean's device is the arbiter** - this suite is layout-blind by construction.

### v1.47.4 - UX hardening wave: subtitles, mobile chrome, download failure log (2026-07-27)

Dean's nine-item batch, mostly "small nits" - except the headline one, which was losing him videos outright.

**The subtitle fix (item 1) was a real bug wearing a cosmetic disguise.** Specific videos failed on *every* retry with `Unable to download video subtitles for 'en-en-US': HTTP Error 429`. A 429 reads as transient, so "consistently" did not fit - which is what made it worth root-causing instead of wrapping in a retry. Verified against yt-dlp 2026.07.04 source and confirmed live against Dean's repro: our `--write-auto-subs` is what switches ON YouTube's translated-caption construction, which synthesizes an `en-en-US` key (a machine translation of `en-US` back into English, redundant since we already fetch `en-US`); our `--sub-langs en.*` is REGEX-matched so it drags that track in; YouTube 429s it; and subtitles are written **before** the media download, where the error raises `DownloadError`. **The video file was never fetched at all.** Deterministic, not flaky - it depends on the video having translatable manual subs. Fixed in two layers: suppress the translated track, and retry once with subtitles stripped so the video lands even when captions cannot.

**The full two-reviewer gate found that my own containment layer did not work**, and its findings were the most valuable output of the wave:
- **CRITICAL: the retry was unreachable dead code.** `run.js`'s stderr handler built its failure list with a `{videoId, reason}` whitelist, silently dropping the `subtitleOnly` flag the retry keys on. Since that is the sole producer of that list, the condition could never be true for any input.
- **COLLATERAL, and pre-existing since v1.36.2:** that same drop means the entire *"no transcripts must be non-blocking"* fix has been **inert since it shipped** - two separate filters never filtered anything. Now live for the first time.
- **CRITICAL: Dean's exact error was never classified as a subtitle failure.** yt-dlp raises a plain `DownloadError` from `_write_subtitles`, not an `ExtractorError`, so the line carries no `[extractor] <id>:` prefix and fell to a branch whose matcher excluded the bare noun. Fixed with two verbatim source literals.
- **Why the original tests missed both:** they hand-authored `subtitleOnly: true` onto the fixture - the divergent-fixture class that burned v1.41.9. The replacement suite drives real yt-dlp stderr through the real spawn boundary and is negative-controlled (reverting either critical fails 5 tests).
- **Found while fixing the above, reported by neither seat:** the per-video matcher accepted bare nouns, so a video *titled* "How To Add Subtitles To Your Videos" whose **merge** failed classified as subtitle-only - which would have DISCOUNTED it and reported a broken download as a success. Exactly the failure mode this wave refused `--ignore-errors` for, arriving through the back door. Tightened, then tightened again at delta re-review when the adversarial seat forged the remaining bare `.vtt`/`.srt` tokens from an ordinary video title.
- Also caught: `subtitleFallback` was set even when the retry ALSO failed, labelling a video that never landed as "saved without captions"; the subscription lane recorded no caption-loss row at all (the lane Dean's report came from); unpinning while the Playlists sheet was open resurrected the pin; and `isRestorableSessionUrl` was not an origin check despite a comment saying so (`/\evil.com` resolves off-origin).

**The rest of the batch:** pinch/double-tap zoom disabled app-wide with `/read` carved out (route-driven, because `/read.html` is an SPA route so a per-shell flag would inherit the previous page's policy); the pull-to-refresh spinner now survives finger-release and is cleared by the scan poller; the Playlists sheet reaches its final height in one layout (its pins request was chained *behind* `/api/config`, costing a full round-trip, and the sheet is bottom-anchored so late content pushed everything up); a durable **Download Failures** log (new store, one unified list across both lanes, source filter, per-entry delete, clear-all); PWA session restore so an iOS eviction costs only the relaunch tap; and yt-dlp's `en-orig` marker no longer outranks a real language tag.

- **Known gaps, DISCLOSED not silent:** items 4 (top-bar icon duplication) and 5 (player touch death) ship as **hardening plus self-reporting instrumentation, NOT as claimed fixes** - both are intermittent and uncapturable, so `?debugUI=1` and `?debugTouch=1` exist to make the next occurrence name its own culprit. The failure-log delete routes carry **no permission check** (any authenticated user can clear the whole diagnostic history; inherited module posture, tech-debt #54, revisit at v1.48 RBAC), and yt-dlp stderr can retain absolute filesystem paths in the log (#55; cookies paths **are** correctly redacted, verified). Item 6 cannot prevent iOS eviction, only make it cheap - "never killed" is not deliverable and is not claimed. Item 1's translated-track suppression drops the translated-from-another-language caption fallback. Subtitle-only failures now lose *per-item* attribution in the activity/history surfaces (a run-level row is still written) - v1.36.2's intent, happening for the first time. A pre-existing full-suite-load flake in `core-config-thumbnail-cache.test.js` is logged as #53 (confirmed pre-existing by reproducing it with this wave's work stashed out).
- Both gate seats **APPROVE** after one fix round plus a delta re-review. Node 22: 4804/4804. Node 24: 4804/4804. Lint clean.
- **Dean's on-device pass is the arbiter**, especially for the two instrumented items and anything CSS/layout - this gate is layout-blind by construction.

### v1.47.2 - Roku hotfix: the 30-second restart loop (2026-07-25)

Dean on-device, within hours of v1.47.1: while watching anything, at the 30s mark (exactly the new progress-ping interval) the resume prompt appeared unbidden and the video restarted - every 30 seconds, forever. **Root cause: a feedback loop between two features that had never met.** `sendProgressPing` wrote the new position onto the item's ContentNode, which is both a live child of the grid's content AND the node held in the observed `selectedItem` field, so every ping notified that observer; the scene read it as a fresh OK press and re-entered playback with the resume prompt, using the position written a millisecond earlier.

Fixed in three independent layers: (1) in-session progress moved to a plain id-keyed AA (`progressFor`), so nothing ever writes to a grid-attached node again - the root cause removed; (2) the scene ignores selections while a video is on screen or a resume dialog is open, which cannot be genuine by construction; (3) the grid refuses to emit selections while it is off screen, which also covers page appends landing in the attached content mid-playback.

- **Slim adversarial gate: REQUEST CHANGES -> APPROVE.** It killed my own over-engineering: a "prompt at most once per item" flag added zero protection (its only call site was already blocked by layer 2) but would have **silently auto-resumed forever** any item whose prompt was once back-dismissed. Flag deleted, plain web parity restored. It also caught a **cross-user bleed**: in-session positions survived a re-login, so a second account signing in on the same TV could be seeked to the first user's position and have it persisted onto their own account (now cleared in `enterLibrary`, which covers every login path). Plus three stale/incorrect comments, two of them written during this very fix.
- Roku manifest 1.2.2. Channel-only: one sideload redeploy, no Docker pull, Node suites unaffected.
- **Nothing here is provable off-device.** The probes that matter: a >60s watch with no prompt/restart at 30/60/90s; back-dismiss-then-reselect (must prompt again); sign out and in as another user (must get their own resume position).

### v1.47.1 — Roku QoL: progress write-back, prewarm, no-sleep, faster gate (2026-07-25)

Channel-only round (no server change, no Docker pull): **watch-progress write-back** via the web player's own `POST /api/progress` (30s heartbeat + final ping on stop; a finished video records as *completed*, matching the web's progress-0 contract — start on the TV, resume on the phone); **next-item prewarm** (exactly one silent request for queueIndex+1's rendition while the current one plays — never cascades, skips audio and `needsTranscode` items so no uninvited full transcodes); gate poll 2s→1s; `disable_screensaver=1` (audio playback and idle browsing no longer dim — the TV panel's own sleep timer remains its own business); hint label de-clipped per Dean ("* filter"). Slim gate REQUEST CHANGES → APPROVE: **its CRITICAL was a beauty — the teardown progress ping fired after `m.currentItem` had already moved to the NEXT item, so every binge advance would have stamped video A's position onto video B across TV/web/phone.** Fixed with a played-item snapshot; plus completion-semantics parity (W1) and the transcode-prewarm scope guard (W2). Disclosed: exiting via the Roku Home button mid-video can lose the last ~30s of progress; a 2-byte prewarm probe marks the next item "recently served" server-side (cosmetic). Roku manifest 1.2.0.

### v1.47.0 — Roku playback wave: Dean's "TV feature-complete" list (2026-07-25)

All six capabilities from Dean's brief, plus the channels view that upgraded itself mid-intake. **Channel side:** playback is queue-aware (the grid's own growing list + index, with an `ensureLoaded` prefetch so autoplay never starves at a page boundary); **Down** opens a playback menu — Next/Previous with real titles, **Chapters** (lazy `GET /api/videos/:id` fetch; jump-to-chapter), **Loop** Off·This·All, **Autoplay** toggle, Restart; explicit selections with meaningful progress ask **Resume-or-start-over** (autoplay advances resume silently; loop replays always start from zero or a near-end resume would spin); **Right** (row edge) or **\*** cycles the All/Video/Audio **filter** via `&format=`; loop/autoplay/filter persist in the registry. **Channels:** new `GET /api/channels` groups `db.metadata` by folderName (scan-captured display name + avatar; recursive `?root=` scoping; hidden roots excluded from the default listing; auth-gated; 6 integration tests) — reachable from the Libraries picker as avatar tiles, Back climbs channel-videos → channels → grid.

- **SECURITY catch (design-time + gate C1):** channel avatars are REMOTE CDN URLs; a Poster inheriting the scene HttpAgent would send the FileTube session cookie to third-party hosts. Isolated with an explicit `roHttpAgent` (the documented mechanism — the gate proved the first attempt's `AddHeader`-on-node approach doesn't isolate per Roku's own docs) AND the URL travels only in a custom `ftAvatarUrl` field so no scene-agent consumer can ever see it. **On-device canary capture is on Dean's probe list — the isolation is per-spec but not yet hardware-proven; disclosed, not assumed.**
- **Slim adversarial gate: REQUEST CHANGES (2 CRITICAL, 7 WARNING) → all 17 findings fixed → delta APPROVE.** Besides C1: session-expiry mid-binge left live video playing over the login screen (the prefetch created the first mid-playback 401 source); loop-all wrap resumed at stale progress ("replays only the last minute forever" on a near-done single-item queue); hidden libraries surfaced on the TV; `?root=` identity diverged from `/api/videos` under nested roots; the hidden-but-focused grid processed keys during "Preparing…"; two new tasks initially lacked the v1.46 unobserve-before-replace discipline.
- **Suites:** Node 22 **4674/4674**, Node 24 **4674/4674** at the release commit. Roku manifest 1.1.0. **Docker publish is Dean's** — `/api/channels` needs the image rebuild; everything else needs one channel redeploy.
- **Disclosed residuals:** hidden-root exclusion matches by exact rootFolder (web hides by subtree — divergence only under nested-hidden-outer roots); Roku still never writes watch progress back (resume data ages while binging); channel avatars fall back to colored-initial tiles when the scan captured none.

### v1.46.1 — Roku compat: strip UNFLAGGED embedded thumbnails (2026-07-25)

On-device hotfix. v1.46.0 shipped, Dean rebuilt his container, and his failing yt-dlp mp4 **still** failed — the diagnostic dialog and a server-side ffprobe showed why: the embedded thumbnail is a **second video stream with `attached_pic=0`** (yt-dlp doesn't always set the flag), plus a `bin_data` track. The v1.46.0 verdict keyed only on `attached_pic=1`, so it judged the file "clean" and served the original, which still wedges Roku's demuxer. **The real invariant:** a Roku-clean file is exactly one video stream + audio — so strip now fires on ANY extra video stream (flagged or not) or any non-audio/video/subtitle data stream. Added a `VERDICT_VERSION` stamp to the cached verdict sidecars so files already cached "clean" under the old rules **re-probe automatically** on the next request (no manual cache wipe). The `-map 0:V:0` remux was verified (slim gate) to select the real h264, never the thumbnail, because muxers place the primary video at the lowest index — the same stream the verdict reasons about, so verdict and remux can't diverge.

- **Slim adversarial gate: APPROVE.** Confirmed the load-bearing `0:V:0` stream-selection, no over-trigger (clean stays clean; mov_text subtitle stays clean; mp3-with-art stays clean), correct version-stamp migration and concurrency. Disclosed residual: the "first non-attached-pic video by index" rule is order-dependent (a thumbnail muxed at a *lower* index than the real video would be mis-kept) — no known yt-dlp/mov path produces that.
- **Tests:** the unit fixture is built from Dean's exact 4-stream ffprobe output; +5 tests (unflagged→strip, lone-data→strip, subtitle-alone→clean, unflagged integration build, version-bump re-probe). Node 22 **4669/4669**, Node 24 **4669/4669** (one pre-existing thumbnail-SVG-fallback flake, passed on clean re-run, disclosed).
- **Docker publish is Dean's** — reaches his TV after the image rebuild + `docker compose pull`.

### v1.46.0 — Roku channel + Roku compatibility renditions (2026-07-25)

The whole Roku wave in one release, built in a single marathon day with Dean iterating on-device throughout. **(1) The channel** (`roku/`, sideloadable, zero store plumbing): keyboard login with the session cookie persisted in the registry (BrightScript trap fixed on-device: AA-literal keys are lowercased while the registry is case-sensitive), newest-first poster grid with a Libraries picker (Left) and search (Up), native Video playback with read-only resume, sidecar captions (`*` → Closed Captions), a full-screen audio now-playing view (Dean's design; native trickplay bar renders in an uncovered bottom band — the Video node's punch-through swallows graphics declared before it), official banner branding, one-command `roku/scripts/deploy.sh`, and a seamless playback gate ("Preparing…" auto-start instead of error-and-retry). **(2) The server feature**: Dean's on-device ffprobe proved the "malformed data" mp4s were yt-dlp **embedded cover-art tracks** (a `png` video stream Roku's demuxer rejects); `GET /video/:id?compat=roku` now serves cache-only renditions — a lossless remux dropping image tracks, or a rotation-baking re-encode for sideways phone videos — under Dean's hard constraint, verbatim: **zero file mutation, zero library-wide processing** (originals/downloads byte-identical, tested down to the mtime; everything fails open to the original).

- **Full two-reviewer gate, dual APPROVE after two fix rounds; it caught real ship-breakers:** QA's CRITICAL — a canceled playback gate's late result could hijack the next one (fix: unobserve-before-discard, plus a re-entry guard for the adversarial seat's double-OK repro); adversarial's CRITICAL — a cover-art **MKV** would have been remuxed to MP4 bytes under a `streamFormat=mkv` demuxer, breaking a file that plays today (fix: renditions are MP4-family sources only; MKV variants are a disclosed limitation). Plus: `finish()` idempotence against Node's documented spawn `error`+`close` double-fire (empirically proven on v22), a hung-socket failure mode the async route conversion introduced for all clients (try/catch → 500 parity), cache size/clear honesty for the new dir, boot-time cap eviction, terminal `failed` handling in the gate task, auth-expiry canceling an in-flight gate.
- **Earlier slim rounds on the channel** (4 APPROVEs) caught: `sub run` is a reserved word (compile failure at first sideload), cross-component `FindNode` (crash on every playback exit), transcoded-MKV `streamFormat`, one-shot interface fields, macOS bash 3.2 vs an apostrophe in `${VAR:?}`.
- **Disclosed gaps:** cover-art/rotated **MKVs** stay Roku-broken (tech-debt #52, with the age-sweep/orphan/oversize/mtime-preserving-replace residuals); double-fire guard not yet back-ported to the two older ffmpeg queues (#50); boot-evict/double-fire paths untested (#51); music/books not on the TV; progress is read-only from the TV; PIN pairing deferred (30-day cookie re-login instead).
- **Suites:** Node 22 **4664/4664**; Node 24 **4664/4664** (both at the release commit). **Docker publish is Dean's** — the server fix reaches his TV only after the container rebuild + one channel redeploy.

### v1.45.8 — Pull-to-refresh → rescan (revert v1.45.7) (2026-07-20)

v1.45.7's `overscroll-behavior:none` read "too un-iOS" (it removed the bounce Dean likes) → **reverted**. In its place, Dean's idea: **pull down from the top to rescan the library.** At the very top, a one-finger drag past ~70px arms it; release fires the same rescan as the toolbar button (extracted `runRescan()`, guarded so a pull while already scanning is a no-op). A fixed indicator fades/rotates with the pull.

- **Native-feeling by design:** the touch listeners are `passive` and never `preventDefault`, so they *ride* the native scroll + iOS bounce — normal scrolling is untouched (a deliberate contrast to the abandoned custom-video gesture layer that fought the OS). Touch-only by nature (inert under a mouse).
- **Full two-reviewer-style slim gate, APPROVE after one fix round.** It caught a **CRITICAL**: the `window` touch listeners aren't torn down when Home is *cached* (the SPA retains the node without calling `destroy()`), so a pull on `/music` etc. silently fired a library rescan with no feedback. Fixed by gating the whole pull path on `ptrIndicator.isConnected` (the cached Home node is detached). Plus a **WARNING**: dragging back above the start now disarms (no rescan on release). The teardown test that missed the leak was rewritten with real teeth.
- **Suites:** Node 22 **4641/4641**; Node 24 **4641/4641**. **Docker publish is Dean's.** On-device arbiter: the pull feel + iOS fixed-indicator behavior during the bounce.

### v1.45.7 — Tame the iOS top-of-page rubber-band on phones (2026-07-20)

Dean on-device: scrolling back to the top on the phone had a pronounced elastic rubber-band + spring settle. Added `overscroll-behavior-y: none` to `html, body` **inside the phone (max-width:768px) block only** — so the Mac/Surface trackpad overscroll is untouched. Note: `overscroll-behavior` has no partial setting, so this *removes* the elastic bounce rather than softening it (iOS 16+; older iOS ignores it harmlessly); if it reads too rigid on-device, revert or switch to `contain` in one line. Nested scrollers (sidebar/modals) keep their own behavior. Pure CSS, mobile-only — shipped straight to Dean's device as the arbiter (no formal gate; the CSS-blind gate can't render it). Dual-Node **4632/4632**. **Docker publish is Dean's.**

### v1.45.6 — Library view preferences: per-page sort + card/list view (2026-07-20)

Two display-preference features for the library toolbar (Dean), no data-loss surface.

- **Per-page sort (behind a Settings toggle, default off).** Sort persisted *globally* before (one key for every page). New **"Remember sort per folder"** toggle (a per-device client flag): when on, each folder / the Liked playlist / the home page keeps its own sort order; a pinned page sort outranks the server default sort. Off → the single-global-sort behaviour is byte-unchanged.
- **Card / Compact-list view toggle.** A new icon-only button in the filter bar flips between the card grid (default) and a **compact list** — the same cards reflowed (CSS-only) into dense rows (small thumbnail left, title + meta right) so more fit per screen. Persists per-device. Two new grid/list glyphs.
- **Slim adversarial gate APPROVE.** Verified the sort precedence, the off-path preservation, and the prototype-pollution guards are sound. Folded in its two cosmetic WARNINGs: the loading-skeleton now carries the `.card-media` wrapper (so list-view skeletons don't reflow), and the list-view thumbnail is vertically centred (no blank gap); tightened the mobile action-row gap to absorb the extra button.
- **Disclosed (SUGGESTIONs, accepted):** the *same* folder reached via a bare-load default vs an explicit `?root=` keys to two different sort slots ('home' vs 'root:X') — a minor per-page-sort quirk. And the extra toolbar button makes the one-line **mobile** row tighter — **Dean's probe:** on a narrow phone (~360px) with the sort set to "Feeling lucky" (shuffle button visible), confirm nothing clips; if it does, we compact the row further.
- **Suites:** Node 22 **4632/4632**; Node 24 **4632/4632** (the recurring `GET /thumbnail/:id` fs-timing flake seen once, passes on re-run — disclosed). **Docker publish is Dean's.**

### v1.45.5 — The REAL Surface fix (desktop-class OS signal) + honest custom-player label (2026-07-20)

v1.45.4's `any-pointer: fine` signal **did not fix Dean's Surface** — his on-device console showed Chromium there reports `pointer:coarse, hover:none, any-pointer:fine=false, any-hover=false, width=1341`: **media-query-identical to a phone.** No pointer/hover query sees the trackpad, so only the viewport width and the OS differ.

- **Fix (Dean's pick, "Option B"):** add a **desktop-class-OS** signal. `isDesktopClassPlatform` matches **Windows** (`navigator.platform` "Win32"/"Win64" — works on plain http/LAN — and `userAgentData.platform` "Windows") and **Chrome OS** (`userAgentData.platform` "Chrome OS" only). It **deliberately never matches** a string a phone/tablet reports: not "Mac" (iPadOS masquerades as MacIntel), not bare "Linux" (Android is "Linux armv8l"). A Windows/CrOS touch device → desktop-class laptop → desktop. **Bare iPads, iPhones, Android phones/tablets stay mobile.** The v1.45.4 `any-pointer` path stays as a second signal for hybrids that *do* expose a fine pointer. Gate verified the safety invariant against the UA-CH spec enum: no live mobile device is wrongly declassified.
- **Honest settings label:** the custom-player toggle said "for mobile video" / "native iOS video controls" — inaccurate (it applies to any touch-layout device, Android included, and does nothing on a desktop-classified touchscreen laptop). Relabelled to "Use custom player controls on touch devices," dropped the iOS-specificity, and it now states plainly that desktops (incl. touchscreen laptops) always use FileTube's controls. Behaviour unchanged.
- **DISCLOSED scope:** a **keyboardless Windows tablet** (e.g. a Surface Pro in tablet mode) now also classifies as desktop (Windows + touch) and gets the desktop video UI — within the accepted "a Windows touch device is desktop-class" direction. **Chrome OS is best-effort:** caught only via `userAgentData` (secure context); a touch Chromebook on plain http falls back to mobile (fail-safe).
- **Suites:** Node 22 **4621/4621**; Node 24 **4621/4621** (the recurring `GET /thumbnail/:id` fs-timing flake, passes isolated). Adversarial gate APPROVE (safety invariant sound; corrected a Chrome-OS comment/test accuracy point it caught). **Docker publish is Dean's. Acceptance = Dean's on-device console on the real Surface: `navigator.platform` "Win32" → now classifies desktop; custom player + desktop controls with the flag OFF.**

### v1.45.4 — Touchscreen hybrid laptops (Surface) classified as desktop (2026-07-20)

Dean on a **Surface Laptop Studio** was getting the native browser video player and the full mobile UI treatment instead of the desktop custom player. Root cause: `isMobileFormFactor()` keyed on the *primary* pointer (`pointer: coarse` + `hover: none`), and a touchscreen hybrid reports a **touch primary** even though it's driven with a trackpad — so it read as a phone. The pre-existing "touch laptop → desktop" safeguard only worked when the primary reported hover-capable, which a touch-primary device defeats.

- **Fix:** also consult `any-pointer: fine` — "is there a precise pointer (trackpad/mouse) *anywhere*, not just the primary?" — gated on a laptop-sized viewport. So a touch laptop + trackpad on a wide screen is **desktop**, while a touch-only phone, or a stylus phone (S-Pen → `any-pointer: fine`) on a **narrow** screen, stays **mobile**. `any-pointer` unsupported (old engine) reproduces the exact prior behaviour. This corrects the **whole** mobile treatment on such devices (native controls, touch-target sizing, hidden volume, tap-to-toggle, background-audio sidecar), not just the player.
- **DISCLOSED behaviour change (Dean confirmed, accepted):** the same rule necessarily reclassifies **an iPad (or any tablet > 768px) *with a mouse/trackpad attached*** to **desktop** (it was mobile) — iPadOS reports the identical signals to the Surface (touch-primary + `any-pointer: fine`, per WebKit r268086), so there is **no media-query way to separate them**. Consequence: a pointer-attached iPad gets the custom player and loses the iOS native fullscreen→lock-screen background-audio chain *while the pointer is connected*. **Bare iPad / iPhone / all touch-only phones are unchanged (stay mobile).** A Galaxy Z Fold unfolded + active S-Pen is a theoretical wide+fine edge that could flip; negligible population.
- **Suites:** Node 22 **4614/4614**; Node 24 **4614/4614** (one pre-existing `GET /thumbnail/:id` filesystem-timing flake observed once under full-suite load, passes in isolation and on re-run — disclosed, not promoted). Adversarial gate APPROVE (conditioned on the disclosure above, now written). **Docker publish is Dean's.** Real-device confirmation on the Surface (and ideally an iPad-with-Magic-Keyboard spot-check) is Dean's arbiter.

### v1.45.3 — Filter-bar sizing fix (desktop equal buttons + un-mangle mobile) (2026-07-20)

Dean's on-device pass of v1.45.2: #4 and #1a landed perfectly; #3 needed another swing.

- **Desktop:** the buttons are now equal-sized — the All/Videos/Audio pills are uniform width, and the sort dropdown / Shuffle / Rescan share a width, so Rescan no longer dwarfs the rest ("a hobble of things through time").
- **Mobile (bug fix):** the v1.45.2 swing was **mangled** — a blanket `min-width:44px` forced even the three format pills wide and the sort kept its text label, so the `nowrap` row overflowed the viewport and Rescan spilled off the edge (the gate's width math had assumed the sort would shrink; it didn't, and a CSS-blind gate can't catch that — Dean's device is the arbiter for layout). Fixed the width budget: format pills go compact, and **all** word-labels are hidden (Shuffle/Rescan *and* the sort's current-value label, leaving a compact caret), so the row genuinely fits one clean line.
- **Suites:** Node 22 **4610/4610**; Node 24 **4610/4610**. Shipped straight to Dean's device (no formal gate — pure-CSS layout the gate can't render; it approved the v1.45.2 swing that broke on-device). **Docker publish is Dean's.**

### v1.45.2 — Filter-bar cleanup + logo jumps to home-top (2026-07-20)

Dean's on-device follow-ups after v1.45.0/.1:

- **(#4) item count beside the folder name.** It had been a *third* flex child in the `space-between` `.section-title`, so on desktop it floated to the visual centre. Now the name + count are one flex item (`.section-heading`) and the count reads as **"(N items)"** right beside the name (parens via CSS, the data string is unchanged). This also frees the row on mobile.
- **(#3) one clean filter line on mobile.** `.section-actions` no longer wraps to two lines — it's a single full-width row and the Shuffle/Rescan word-labels are hidden (icon-only), so it fits one evenly-distributed line. **This revisits v1.23** (which showed the words because icon-only "read as just an emoji"): now the count is out of the row and each button keeps its `title`/`aria-label`, and **desktop keeps its labels**. Gate verified the mobile width budget fits a ~320px phone with no overflow (the sort button's value ellipsizes).
- **(#1a) the header logo jumps straight to the top of home.** Distinct from the bottom-nav/sidebar Home, which keep the v1.45.0 incremental walk-back. Classic logo→home convention: an escape hatch to the top, while Home stays your omni-back. Coalesces with a still-settling walk-back so the two affordances can't race.
- **Suites:** Node 22 **4609/4609**; Node 24 **4609/4609**. Slim adversarial gate APPROVE (one narrow cross-affordance race hardened). **Docker publish is Dean's.**
- **Still open (framed, not built):** **#1b** — Home should skip video-watches and return to the *library* context a video was launched from (its own design + full gate, next). **#2** — desktop tab-switch audio bug: with the experimental "background audio for video" ON it *stutters*, OFF it *stops entirely* (breaking the desktop cross-tab-playback contract) — a real playback regression to root-cause next.

### v1.45.1 — Sticky filter bar: flush-pin (kill the scroll jump) (2026-07-20)

Dean's on-device pass of v1.45.0 surfaced two sticky-bar quirks:

- **(A — FIXED) the scroll "jump".** The bar pinned at `top` = header height but naturally rested one `.main-content` top-padding lower (24px desktop / 16px mobile), so it slid up that padding on the first scroll before pinning — a visible shift, with the gap restored on rubber-band. Fix: the standard flush-sticky recipe — pull the box up by the content padding (`margin-top`) and give it back as inner `padding-top`, so the border-box rests exactly on the sticky line (zero pre-stick travel, no jump). Slim adversarial gate verified the box math against the CSS spec (provably zero-travel) and cleared the negative-margin/sticky recipe as safe (no iOS quirk in this block-ancestor chain).
- **(B — PARTIAL / best-effort) "cards covered by the filter after Home".** The pre-stick misalignment made a card peek awkwardly under the bar after an incremental-pop Home restored a scrolled position — that misalignment is now gone. **But the underlying behavior — an opaque sticky bar covering content you've scrolled past — is inherent to `position: sticky`, and the flush-pin's taller box actually occludes ~24px MORE below the stuck bar (16px mobile), not less.** Restoring to an exact scroll position correctly shows what you left; there's no clean alignment fix for "content under the stuck bar." **Dean's on-device pass judges B specifically** — if the residual occlusion still reads wrong, the real lever is a more compact mobile bar (a future design decision), not a margin tweak.
- **Known cosmetic (disclosed):** first-run only (zero folders configured, `#welcome-message` shown), the bar's `-24px` margin collapses with the welcome box's `20px` bottom margin to −4px, so the opaque bar clips ~4px into that empty margin. Negligible (empty margin region, first-run only); not fixed.
- **Suites:** Node 22 **4603/4603**; Node 24 **4603/4603**. Lint 0 errors. Slim adversarial gate APPROVE. **Docker publish is Dean's.**

### v1.45.0 — UX refinement (cheap-and-safe tranche): sticky filter bar, incremental-pop Home, music rotate fix (2026-07-20)

The first, no-data-loss tranche of Dean's UX push, deliberately decomposed from the umbrella "make the UX first-class" into a sequenced train ordered by risk. Three shipped; the risky/undiagnosable items parked and framed (see "Parked" below).

- **Sticky home filter/action bar (T1).** The sort control + All/Videos/Audio + Shuffle + Rescan now stay pinned below the header as you scroll the home grid, so you can re-shuffle mid-scroll without scrolling back to the top. Home-scoped (`#library-content .section-title`), solid background, `z-index:20` (above cards, below the sort-menu popover and the dock/modals), offset via a new `--sticky-bar-top` var (56px desktop / `--mobile-header-h` mobile). **Scope note (disclosed):** this pins the bar on **desktop too**, not just mobile — an intentional, useful superset of the mobile-framed ask, called out here so it doesn't ship silently.
- **Incremental-pop Home / restore-your-place (T2).** The Home affordance (header logo / sidebar Home / bottom-nav Home) now walks **up one in-app level per tap**, restoring the scroll/view you left at each level — "home" is the top of that walk — instead of jumping to a fresh top-of-feed (Dean's model, an explicit override of the always-go-home convention). Reuses the router's existing pushState/popstate scroll-restore via `history.back()`; a `depth` counter distinguishes "there's a level to pop to" from "already at the top." A fast double-tap can't pop past the app (event-based coalescing guard).
- **Music drill sticky-header rotate fix (T3).** A concrete instance of "styling breaks on rotate": the album-drill collapsing header measured the (orientation-dependent) header height once and never re-measured, so a portrait↔landscape rotate left it parked at a stale offset. Now re-measures on rotate/resize, torn down cleanly on the SPA swap.

**Gate (full two-reviewer, both APPROVE after one fix round).** Both seats independently caught the same **CRITICAL**: a deep-link → Home → Home ping-pong — the go-home path pushed home at depth+1 (across all **five** go-home sites: the Home button plus four programmatic `navigate('/')` in watch/setup), so the next Home tap resolved to `back()` and threw you back into the page you'd left, on the most common entry path (permalinks). Fixed at the `navigate()` layer (a home-root push is stamped depth 0) plus an `atHome`-first belt-and-suspenders in the decision helper. The adversarial seat additionally caught a **WARNING** the QA seat had cleared: the race guard's 2-second wall-clock could lift during a >2s main-thread jank and let a double-tap exit to the referrer — the guard is now purely event-based (cleared by popstate; can't wedge because depth>0 guarantees the popstate).

- **Suites:** Node 22 **4601/4601**; Node 24 **4601/4601** (0 failures). Lint 0 errors. **Docker publish is Dean's.**
- **Parked + framed (NOT in this release):** mobile video playback ("immaculate") — a debugging campaign needing Dean's on-device repro inventory; in-app YouTube search — parked behind a real usage number; "landscape first-class" — unframed; and the "library won't scroll in landscape" bug — recon found **no CSS cause** (the list rides the window scroll with nothing capping it), likely a fixed/fullscreen overlay covering the viewport, so it needs Dean's repro (which view, was a video playing/docked?) rather than a blind fix.
- **On-device probes (Dean's pass is the arbiter — no browser harness covers these):** (1) sticky bar on iOS Safari/PWA (the `overflow:clip` + sticky question — verified sound on paper, confirm on device); Shuffle/Rescan reachable at depth; (2) the Home-walk feel: drill home→folder→creator→video, tap Home repeatedly — one level per tap, scroll restored, terminating at home; a **deep-linked video permalink** → Home → Home must land+stay at home (not ping-pong); fast double-tap must not exit the app; (3) music album drill, rotate portrait↔landscape↔portrait — sticky header stays parked, collapse threshold correct.

### v1.44.4 — Cleanup follow-up: genericized the last two comment names (2026-07-18)

- **Finished the mock-comment name genericization.** The two names v1.44.3 left pending Dean's call are now generic labels too, matching their content: the Derby-Owner's-Club/horse-racing commenter became **"Derby Owner's Club fanatic"**, and the teasing-brother commenter became **"Ball Busting Brother"**. Comment text is unchanged; only the author labels. A whole-tree, line-joined scan (the v1.44.3 lesson — a line-oriented grep misses wrapped/section-comment names) confirms no real personal name remains anywhere in tracked source.
- **Suites:** Node 22 **4575/4575**; Node 24 **4575/4575** (0 failures). Lint 0 errors. **Docker publish is Dean's.**

### v1.44.3 — Cleanup: genericized comment names, immersive reader, "Under the hood" stats, README refresh (2026-07-18)

- **Genericized the personal names in the mock comment bank.** The real people used as mock-comment authors / the weighted persona commenter are now generic labels (Maligned Mentor, Betting Bug, Feedback Friend, My Wife, Loving Daughter, Proud Dad, and the "Polite and Unhinged" persona) with behavior byte-unchanged. Full genericization: the persona's code identifiers, internal hash-salt strings, and its test file were renamed too, so the real names appear nowhere in tracked source. (Two further names in the bank were genericized in the v1.44.4 follow-up.)
- **Immersive reader — a fuller reading page.** The /read view now hides the shell header (the FileTube logo + search box, wasted space while reading; the reader has its own topbar with Back / Contents / Aa) and reclaims its top space. It's set pre-paint on a direct load (no header flash) and toggled across in-app navigation; the reader re-measures its own height into the reclaimed viewport.
- **"Under the hood" library inventory on the Stats page.** A plain count of every persisted namespace — the same things the backup bundle carries: videos & audio, watch positions, view counts, liked items, delete tombstones, scan folders, books / reading positions / narrated books, music tracks & folders, and user accounts.
- **README refresh.** Added the Music and Books libraries to the feature list + a short "Books & music libraries" setup note; fixed a stale fact (the database is `filetube.db`, not `db.json`, since v1.42); and replaced every em-dash and en-dash (51 total) with plain hyphens.
- **The slim adversarial gate caught a real one.** My line-oriented name search missed two real names hiding in COMMENTS — "Zak Goldin" word-wrapped across two lines, and a section header carrying a child's real name and age (`// Daisy 💛 (she's 5)`). Both scrubbed; a whole-tree, line-joined re-scan (independently re-verified by the reviewer) confirms no real name remains. Two non-blocking suggestions folded in (test-variable rename; the reader's pre-paint class-add hoisted ahead of the localStorage read so a storage throw can't skip it). APPROVE after one fix round.
- **Suites:** Node 22 **4575/4575**; Node 24 **4575/4575** (0 failures on both). Lint 0 errors. **Docker publish is Dean's.**
- **Probe list for Dean:** open a book — the top logo/search strip is gone and the page reads fuller (Back/Contents/Aa still there; leaving the reader brings the header back); the Stats page has a new "Under the hood" section with the namespace counts; a downloaded video's comments show the renamed authors (no real names); the README reads clean with no em-dashes.

### v1.44.2 — Music "Spotify feel": play→dock, collapsing album header, playing-row highlight, "Playing from" (2026-07-18)

- **Tapping a song now plays in the docked mini-player (browse-while-playing), not a full player at the top.** Previously a tap expanded the FULL player into `#player-slot` at the top of `/music`, pushing the album header + tracklist down; it only docked on nav-away. Now a tap plays straight in the bottom mini-player (album art + play/pause + seek) and **highlights the tapped row** — an accent bar + a small **CSS equalizer glyph** (three animated bars, drawn in CSS, never an emoji — iOS forces blue emoji), so the album header + list stay on screen. Implemented as a new `dock:true` option on the persistent player's `load()` (a `mountInDock()` that reparents straight into the dock, avoiding a double reparent of the media element). The highlight is driven from `playAt()` — the single point every advance routes through (tap, on-page prev/next, lock-screen next, autoplay-at-end) — and is re-seeded from `player.currentId` on a nav back into `/music`.
- **A collapsing / sticky album (and artist) header on the drill-in.** At rest: large cover art + title + artist + year·track-count + prominent **Play** + **Shuffle**. As the tracklist scrolls it collapses into a slim **sticky bar** (small thumb + title + Back + Play). Driven by an **IntersectionObserver** on a sentinel — not per-frame scroll math (the "measure, don't guess" scar); the fixed header is measured once and the sticky bar parks just below it. The observer is disconnected in `destroy()` and before every re-render so it can never leak across the SPA `#view-root` swap. Only the drill-in gets this (the flat Songs/Liked tabs have no single art to anchor). Same mechanism on desktop — the header just has more room.
- **A "Playing from &lt;Album&gt;" context line** above the tracklist that reflects the currently-playing track and drills into its album on tap. It survives content re-renders and a nav-back, and correctly hides when a video/book is what's actually playing or the player is closed. (The server now surfaces the composite `albumKey` on song items so the drill-in round-trips.)
- **Also fixed a latent bug the play→dock change would have promoted:** tapping the docked _music_ mini-player used to navigate to `/watch.html?v=<trackId>` (a video route → 404, since music had no dock-return href). Music tracks now carry a `/music` dock-return. And **tech-debt #46** is closed: a same-URL in-app navigation (tapping the already-active nav item) is now a no-op (`isSameLocationNav`) instead of tearing down and rebuilding `#view-root` — which also fixes the identical shipped `/read` strand and removes a wasted re-fetch on every active-tab re-tap.
- **The slim adversarial gate (no data-loss surface) found real things — that's it working.** First pass APPROVE + 3 SUGGESTIONs (all applied). The **delta re-confirm then caught two WARNINGs in my fixes**, both fixed + re-verified: **(W1)** my "clear the stale now-playing indicators when the player is closed" listener never actually bound in the common path — `#media-player` lives inside a `<template>` until the first play clones it, so `getElementById` was null at init; fixed with a lazy guard-once bind retried after the first play. **(W2)** a raw NUL byte had slipped into `music.js` where a space was intended (the invisible-landmine the repo has a source-lock for) — and that lock excluded `public/` while its own comment claimed otherwise; fixed the byte and **closed the lock's coverage hole** (it now scans `public/`, minus vendored libs — proven fails-red). The adversarial seat verified the player reparent lifecycle, the observer-across-SPA-swap, the same-URL guard blast radius, and the lazy-bind timing against primary source.
- **Suites:** Node 22 **4570/4570**; Node 24 **4570/4570** (0 failures on both; the documented thumbnail-sendFile flake did not recur). Lint 0 errors (9 pre-existing warnings, untouched). **Docker publish is Dean's.**
- **Probe list for Dean (phone-first):** on `/music`, drill into an album — big art header at rest, collapses to a slim sticky bar as you scroll (and on an artist too); tap a song — it plays in the bottom mini-player, the row lights up with the little equalizer, and the header/list stay put so you keep browsing; the "Playing from &lt;Album&gt;" line shows and jumps to that album on tap; tap the mini-player to expand, tap Home and back — playback survives; tap the mini-player's × — the row highlight + "Playing from" clear; tapping "Music" again while playing no longer flickers the player. **Watch for:** an in-view music search may also trigger the home search (a pre-existing double-listener the gate noticed, out of this wave's scope — flag if it bugs you and I'll fix it next).

### v1.44.1 — Music hotfix: mini-player survives leaving /music, all albums/artists show, continue-listening plays the right song (2026-07-18)

- **The music mini-player now survives tapping Home (or any nav) while a track plays** (Dean's on-device report). Root cause: the router's `shouldDockOnTransition` (the pure "leaving this view should dock the persistent player" decision, duplicated in common.js + player.js) only recognized `watch` and `read` as FULL-player-hosting views — the v1.44 `/music` view mounts the player FULL into its `#player-slot` too, but wasn't listed, so leaving /music never docked the host before the `#view-root` swap and playback died. Fixed: `music` joins `watch`/`read` in both copies. Also repaired a latent bug the gate found: `music.html` was missing the `#player-dock` + `#player-host-template` block every other player-hosting shell carries (it was mirrored from the Books browse page, which never hosts the player), so a DIRECT /music load (PWA deep-link/refresh) had no player host at all — the standard block was added, with a source-lock.
- **All albums and artists show again (a regression I introduced in the v1.44.0 gate fix).** The gate fix added offset/limit pagination to `/api/music/albums` and `/api/music/artists` with a default page size of 60; the client fetched them with no limit, so only ~60 rendered (rescanning couldn't help — the tracks were all scanned; the _view_ was capped). The Songs tab escaped it (it already passed `limit=1000`). Fixed: the client requests the full set; source-locked. Proper infinite-scroll is tech-debt #48.
- **Tapping a "Continue listening" card plays THAT song, not another.** The card resumed from the resume _pointer's_ last-played queue and, when the tapped track wasn't in it, fell back to the last-played track — so any card but the single most-recent one played the wrong song. Fixed: it now builds the queue from the recently-played list (which by construction contains the tapped track) and plays it, with per-track smart-resume still applying the saved position; solo-play fallback if it aged out; source-locked against the wrong-song fallback returning.
- **Two slim adversarial gates (one per fix batch), both APPROVE**, each verified against the real player-lifecycle + queue code (dock-before-swap ordering, byte-parity of the two `shouldDockOnTransition` copies, that on-page AND lock-screen "next" walk the same recent-listening queue, the solo fallback, and that per-track smart-resume survives). Disclosed non-blockers tracked as tech-debt: **#46** a plain `music→music` nav briefly strands the FULL player (parity with the shipped `/read` view, self-healing, audio never stops); **#47** the resume pointer is retained infra for a future "resume last session" affordance; **#48** the albums/artists views fetch the full set rather than infinite-scroll.
- **Suites:** Node 22 **4550/4550**; Node 24 **4549/4550** (the single failure is the long-documented thumbnail-sendFile full-suite-load flake — standalone 6/6, not chased). Lint 0 errors. **Docker publish is Dean's.**
- **Probe list for Dean:** play a track on /music, tap Home to browse — the mini-player keeps playing and re-expands when tapped; all albums + artists present after a scan; tapping _different_ Continue-listening cards each plays the right song at its saved spot. (Known edge, if it bothers you: tapping the Music nav _again_ while a song plays full-screen briefly hides the player until the next nav — one-line fix ready if wanted, tech-debt #46.)

### v1.44.0 — Music Library: a first-class music section, nav IA rework + a customizable bottom bar (2026-07-18)

- **A proper Music library, sliced out like Books — its own everything.** A music-app experience, deliberately NOT bundled into the ytdlp module: its own `lib/music/` module, its own `db.music` SQLite namespace, its own scan-folder config, and its own `/music` section. Browse by **Albums / Artists / Songs / Liked**, search by song/artist/album, sort, album-art cards, and **Shuffle**. Tapping a song plays it **in context** (album / artist / search results) with next/prev/autoplay through that list — the v1.40 context descriptor IS the play-queue (server order used verbatim, never re-sorted). Metadata is **tags-first with fallbacks**: embedded ffprobe tags (artist/album/track/disc/albumartist added to the whitelist), falling back to `Artist/Album/NN Title` path conventions per missing field. Album art is embedded-art-first, then `cover.jpg`/`folder.jpg`, cached per-album in a music-owned `.albumart` dir.
- **Reuses the battle-won audio player — no new player.** Playback rides the existing persistent dock/mini-player, background audio, and lock-screen MediaSession (now with the track's real album tag), streaming from `/track/:id`. **Smart resume**: a song restarts from the top, but a **long track (>10 min: a mix/DJ set) resumes mid-track** like a video — one pure, unit-tested helper. Per-user liked songs, per-track positions, and a "last track + queue" resume pointer all key by `req.user.id` (the v1.43 per-user model), through a **dedicated music progress coalescer** (one transaction per flush window, the ≥5:1 write-amp and FK-poison guards mirrored from the video/book coalescers). **FLAC/WAV/MP3/M4A stream natively; ALAC transcodes on demand** (a music-owned, isolated queue; the client pre-warms the rendition so the first play never silently fails).
- **Formats/scale/safety.** MP3 + M4A/AAC + FLAC + WAV/ALAC. Designed for tens of thousands of tracks (v1.30 pagination patterns). **Music folders must be DISJOINT** from video and book folders — a three-way overlap refusal at config time, in both directions, from every config entry point (reciprocal guards in the media/book routes too). The scan's prune has both mount-loss guards (a vanished root AND an empty-scan-under-a-still-mounted-root) plus **subtree conservatism** (a transiently-unreadable folder never prunes its tracks); every id-keyed carrier (prune, backup) carries the music rows the same commit, and the **backup bundle gained the music namespace + per-user music state** (with recomputed 32 MB cap math + a near-cap restore test).
- **Nav IA rework (Dean's design).** The mobile bottom bar loses Books; **Books + Music are now entries in a renamed "Library" sidebar section** (alongside folder-playlists) and in the mobile Playlists sheet. The home page gains a **"Continue listening"** row above "Continue reading" — both individually toggleable. And a **customizable bottom bar**: show/hide and reorder the optional nav items per device (Home stays first, Settings last; a disabled module's item never appears — the module gate always wins).
- **What the two-reviewer gate caught (both seats APPROVE after one fix round + delta re-confirm; the whole wave is data-loss-sensitive so it got the FULL gate).** The adversarial seat **verified the scary surfaces hold** (restore cross-user bleed, the token_version FLOOR, the FK-poison guard, the flush deleted-track guard, the `audioPath` rendition-collision, path traversal — all safe, with runnable repros). Real findings, all fixed + regression-tested: **(CRITICAL)** the ALAC on-demand transcode's `503`-until-ready had no client consumer — an ALAC track failed silently; now the client surfaces `needsTranscode` and pre-warms the rendition (a 1-byte ranged poll, generation-guarded) with a "Preparing…" state. **(WARNING)** a _per-directory_ EACCES (a permissions blip / failed automount) would prune that subtree and **permanently delete those users' liked/progress while the files sat on disk** — now the scan records errored dirs and protects their tracks (proven with a real `chmod 000` test). **(WARNING)** `__proto__`/`constructor` ids passed the track existence checks and wrote a junk liked row into the backup — all four music routes now use a `hasOwnProperty` guard. Plus: the resume pointer is now actually consumed client-side, ALAC renditions no longer become eviction-immune under `preExtractAudio`, albums/artists paginate, stale comments corrected.
- **Known gaps, DISCLOSED (tech-debt #42–#45).** The **customizable-bottom-bar layout and the two home-row toggles are device-local (localStorage), not mirrored per-user to the server** — a deliberate deviation from the exec plan's server-authoritative design (consistent with every other display pref; only theme/era/icons mirror today). Both gate seats agreed this is a scope call for Dean, not a data-integrity issue: two people sharing one browser share those prefs, and a fresh device starts at defaults. Also filed: `rekeyMusicState` is a proactively-built carrier with no caller yet (no move-a-track feature), an EXTREME ~30k-video+30k-track+dual-logo instance could exceed the 32 MB restore cap, and the config-overlap loops re-read the DB per folder.
- **Suites:** Node 22 **4546/4546**; Node 24 **4546/4546** (0 failures on both; the documented thumbnail-sendFile flake did not recur). Lint 0 errors (9 pre-existing warnings, untouched). **Docker publish is Dean's.**
- **Probe list for Dean (on-device is the arbiter):** album art on the cards; **PWA background playback with lock-screen art + controls** (play/pause/next/prev from the lock screen); search + context next/prev + shuffle; smart resume (a short song restarts, a >10-min mix resumes); **FLAC/WAV playback on-device** (and, if you have any, an ALAC file — confirm the "Preparing…" → plays flow, and eyeball the pre-warm poll's network tab); the nav IA (Books + Music in the Library section, Books gone from the bottom bar); the customizable bottom bar (toggle/reorder); and a **backup → restore round-trip that brings music + per-user music state back**.

### v1.43.1 — Restore un-413'd, admin password recovery, login de-box, mobile fixes + an adversarial auth health review (2026-07-17)

- **Restoring a real backup works again (CRITICAL bug since v1.42).** Every real-world restore died with `413 request body too large`: the GLOBAL `express.json()` (default 100 kb cap) ran before the restore route, so the route's own larger limit had been **dead code since v1.42** — masked by a few-KB test fixture. Fixed at the root: the global parser now skips `POST /api/admin/restore` (method- and spelling-normalized, verified against Express/path-to-regexp source), the route owns its body with a **32mb** cap (Dean-approved: ~12 MB realistic worst case × ~2.5 headroom, math in the route comment), and — the security half — the **auth gate + an admin check now run BEFORE any multi-MB parse**: unauthenticated → 401 and members → 403 without the server buffering a byte, so the big-parse allowance can't be a pre-auth (or member-reachable) memory/CPU amplifier. New tests pin all of it: a 3000-item prod-scale round-trip, a ~28 MB near-cap restore (a silent revert to the old dead 16mb now FAILS the suite), an over-cap clean-JSON 413, member-oversized→403-never-413, and unauth→gate-401.
- **`scripts/reset-admin.js` — the recovery path that didn't exist.** A forgotten sole-admin password now has an operator-run fix (Dean's intake call: script only, NO env lever — a standing reset env is a backdoor). It reuses the real auth stack end-to-end (crypto/store/adapter), bumps `token_version` on every reset (all sessions for that user die instantly; WAL makes it visible to a RUNNING server, no restart), bootstraps a first admin only when the users table is empty (same count-guarded insert as /welcome — can't race it), never promotes a non-admin, requires an explicit `--enable` to un-disable, refuses a DATA_DIR with no database rather than minting an empty one, and never takes the password on argv. Documented in the README's new **Accounts & signing in** section (another gap: v1.43.0 shipped with no auth docs at all).
- **Login/welcome de-boxed** (Dean: "feels constrained"): the bordered card is gone — the form sits open on the page at 420px, and the inputs become distinct secondary-background wells so they stay legible without the card (dark mode included). Approved by Dean from a rendered before/after preview across eras/modes before ship.
- **Mobile chapters list no longer clips its top entries.** Root cause found by measurement, not guessing: the popup opens upward inside `#player-wrapper` (overflow:hidden, 45vh portrait cap) while the menu's own cap was 50vh — the first rows rendered into the clipped band above the wrapper, reachable only mid-rubber-band (fullscreen "fixed" it because it releases the cap). Now a pure, unit-tested resolver clamps the menu to the measured room above the bar on open/rebuild/rotate; desktop geometry untouched.
- **Space no longer re-fires the last-tapped player control.** The shortcut switch was already guarded for typing since v1.16 — the live mechanism was subtler: a pointer click leaves a control button FOCUSED, and the switch deliberately stands down on focused buttons (keyboard a11y), so the browser's click-the-focused-button default re-fired it on the next Space — pause being the most common. Pointer-driven clicks now blur the button (keyboard activations keep focus). Also fixed the one genuinely unguarded global key surface: the book reader's arrow keys flipped pages while typing in search. **Honest scope note:** this provably kills the desktop/keyboard mechanism; phones have no Space key, so whether it was Dean's exact mobile symptom is his on-device call — if it persists, we need his precise repro (which field, which keyboard).
- **The adversarial auth health review (Group C) + what the gate caught.** Full two-seat gate over the wave AND the whole v1.43 auth/multiuser layer (threat model: mutually adversarial household accounts), verified against express/body-parser/node:crypto/node:sqlite primary sources. The adversarial seat found two real WARNINGs, both fixed + regression-tested: (1) the restore parse ran before the admin check (members could trigger 32 MB parses — now 403-before-parse); (2) **`parseCookies` threw `URIError` on any malformed `%`-sequence in ANY cookie**, and since the only error middleware sits before the gate, one corrupt cookie value 500'd every request app-wide instead of a clean deny (now: non-decodable values stay raw → fail HMAC → clean 401/redirect; live-repro'd both ways). What held up under attack, verified: the tv-floor restore invalidation, session HMAC canonicalization, the full login/welcome asset allowlist, per-user row scoping on every read/write, id-keyed carriers, `__proto__` hardening, and the parser-skip's spelling-equivalence with Express's own route matching. Suggestions all applied: shared `MIN_PASSWORD_LENGTH` (crypto.js → three routes + the script), XFF-sanitizing-proxy note at the rate limiter + **tech-debt #41** (per-(ip,username) bucket residuals → v1.44 hardening). Both seats **APPROVE** after one fix round + delta re-confirmation.
- **Suites:** Node 22 **4443/4443**; Node 24 run 1 **4443/4443**, run 2 4442/4443 with the single failure being the long-documented thumbnail-sendFile full-suite-load flake (standalone 6/6 — disclosed, not chased). Lint 0 errors (9 pre-existing warnings, untouched).
- **Probe list for Dean:** re-test both mobile bugs (chapters top rows reachable without rubber-band; the space-while-typing symptom) and the de-boxed login on the iPhone; run a REAL prod-bundle restore (the actual failing bundle from this bug report); optionally rehearse `reset-admin.js` against a throwaway account. The v1.43.0 probes (iOS PWA cookie survival, per-user bleed check) still stand if not yet run.

### v1.43.0 — Users + auth: the private-instance auth wall + per-user library state (2026-07-17)

- **FileTube now has accounts.** A cookie-session auth wall (zero new deps: `node:crypto` scrypt hashing, an HMAC-SHA256 signed HttpOnly cookie with a per-request user-row re-check for instant revocation) gates **every** route, static asset, and byte stream behind one middleware — proven by a route-census test that enumerates the live Express router at runtime and asserts each of the ~83 routes is gated except an exact allowlist. First boot with zero users serves a themed **/welcome** create-admin page; everyone else signs in at a period-styled **/login** card (both honor the era/theme/custom-logo system). Dean's existing watch progress, likes, book positions and pins **adopt** into his new admin account on first setup. **A scoped iOS-Shortcut API token** (`FILETUBE_API_TOKEN`) keeps the share-sheet one-off download working without a cookie login. Behind a reverse proxy set `FILETUBE_TRUST_PROXY=1` so the cookie carries `Secure`.
- **Watch progress, likes, book reading positions, book-shelf pins and channel pins are now PER-USER** — each account gets its own, keyed in relational SQLite tables. The battle-won progress/book coalescers were reworked to key by user and flush one transaction per window (the ≥5:1 write-amplification contract intact); every id-keyed carrier (move re-key, delete, media + book scan prunes) carries the per-user rows too, in the same commit that touches its sibling namespaces (the v1.41.6 liked-drop class, defended). The old flat namespaces are frozen as the pre-auth record and never read again post-adoption.
- **Admin user management** in Settings (create/reset-password/disable/role/subscriptions-flag/delete), all server-enforced admin-only, with self-lockout guards (you can't disable/delete yourself or the last enabled admin, and the guards refuse rather than brick the instance). Password reset and disable revoke every existing session **instantly**. Theme/era/icon prefs mirror to your account so a fresh device inherits them on first sign-in (localStorage stays the device-local, pre-paint source of truth).
- **Backup now carries accounts.** `GET /api/admin/backup` / `POST /api/admin/restore` are admin-only; the bundle includes every account (password hashes — the download UI flags the file sensitive) and all per-user state; restore replaces users atomically with the doc tables, refuses a bundle that doesn't contain the restoring admin as an enabled admin (self-lockout guard), and **the session secret never rides the bundle**.
- **What the full two-seat gate caught:** the adversarial seat found a **CRITICAL** — a user-replacing restore reassigns account ids, and because the session token binds only `{uid, tv}`, a third party's live cookie would authenticate as whoever now occupies its id (silent cross-user data bleed **and** privilege escalation). Fixed with a pre-wipe `token_version` floor that provably invalidates every pre-restore cookie (and, unlike secret rotation, survives a restart and an env-pinned secret). The QA seat's missing route-census test (an explicit acceptance criterion) then caught a **second CRITICAL both reviewers had missed**: `/js/login.js` — the login/create-admin form-submit handler — wasn't allowlisted, so a logged-out browser could never actually sign in; the API-level tests missed it because they never load the browser JS. Plus: a flush-batch FK-poison that could destroy co-users' watch positions when a user was deleted mid-window, an un-normalized restore username, and a transaction-guard bypass — all fixed, both seats **APPROVE** after one fix round. Suites **4416/4416 on Node 22 + 24**.
- **Known gaps (DISCLOSED):** everyone signed in still sees the **same library** — per-user library scoping, the kid-safe account, per-user subscriptions and path scrubbing are **v1.44 (RBAC)**. The `canManageSubscriptions` flag is settable in the admin UI but **not yet enforced** (a member can currently reach the subscription/download routes — v1.44 enforces it). The instance backup still exports the frozen top-level `progress`/`liked`/`books.progress`/`ytdlp.pins` namespaces, which are **historical-only after setup** (the live data rides `bundle.users[]`); harmless, but don't script against them. Dean's **on-device pass — especially iOS PWA cookie survival in standalone mode** — is the final arbiter.

### v1.42.0 — SQLite persistence + instance backup/restore (the multiuser foundation) (2026-07-17)

- **The storage engine moved: `db.json` → `DATA_DIR/filetube.db`** (SQLite via the built-in `node:sqlite` — zero new dependencies, source-locked to one adapter module with a documented better-sqlite3 fallback trigger). The migration is **automatic and non-destructive**: first boot imports db.json in one WAL-safe transaction and then never touches it — byte-for-byte, hash-asserted, forever (the parallel-run contract: an old tag keeps working against db.json while the new tag runs beside it). A corrupt db.json aborts boot loudly creating NOTHING (it can never silently strand the library behind an empty store), and `scripts/migrate-check.js` dry-runs the real import code against your actual db.json before you upgrade. Writes went from 175 KB whole-file rewrites to per-row diffed transactions; the v1.43/44 user tables are born in the schema so auth lands as additive migrations. **viewCount extracted** out of metadata items into its own `viewCounts` namespace — the one non-rebuildable field the scan could clobber (a view recorded mid-scan used to be silently reverted; now locked by a regression test). **Instance backup/restore** (`GET /api/admin/backup` / `POST /api/admin/restore`): every namespace + the custom logo bytes, strict refuse-don't-drop validation, coherent wipe-and-replace (open as the rest of the API until v1.43 auth — disclosed). **Beta safe mode** (`FILETUBE_READ_ONLY_MEDIA=1`): deletes/moves/downloads/reheat/skip-list refuse with honest 403s, the scheduled poll no-ops, and the scan can never unlink a tombstone-matched shared file — the parallel-run rules enforced, not remembered. **BREAKING:** Node floor is now 22.13 (Docker image unaffected). **What the full two-seat gate caught** (design-delta round: 2 CRITICALs incl. the beta-boot-scan tombstone unlink of a live prod file + the corrupt-import permanent-stranding; code round: 2 more CRITICALs — every move silently ZEROED the moved video's view count (the v1.41.6 liked-drop class, striking the very field this release protects), and a `__proto__` row key was a prototype write (silent row loss + pollution) — plus orphaned-count reaping, a restore-during-scan resurrection guard, a real kill-9 WAL crash test demanded and added, and a restore logo magic-byte gap. All findings applied, dual APPROVE. **Also disclosed:** the coordinator's own tooling emitted invisible NUL bytes into source three times this release — caught by a new repo-wide no-raw-control-bytes lock, which then exposed that node:sqlite silently truncates TEXT at embedded NULs (hostile NUL-bearing keys are now refused loudly). Suites 4346/4346 on Node 22 + 24. Dean's beta parallel-run against his real prod db.json is the final arbiter.

### v1.41.19 — Codify lean mode; retire the pipeline's last conflicting remnants (2026-07-16)

- Process/docs release, no runtime behavior change. `CLAUDE.md` had contradicted itself since the v1.37.2 handoff — a banner declaring lean mode authoritative sat directly above seeded instructions ordering every session into the retired multi-agent pipeline, and the session-start hook was injecting a feature state ("v1.31, stage: discovery") ten releases stale. Now: `CLAUDE.md` codifies the lean-mode contract (lifecycle, two-reviewer gate, honesty norms, release ceremony); the pipeline reference is archived in `docs/references/legacy-agent-pipeline.md`; `.state/` is deleted + gitignored and the hook reports only live signals (branch, plans, tech debt). Two new reference docs generalize the method beyond this repo: `lean-mode-methodology.md` (portable spec for seeding other repos) and `handoff-harness-v2-proposal.md` (a "lean harness" revision of [handoff-harness](https://github.com/dtammam/handoff-harness): keep install/seed/docs-skeleton, retire role agents + stage approvals + `.state`, add the gate/`/release`/adversarial-reviewer as first-class). **What the gate caught (slim gate, adversarial seat):** the release's own defect class left standing — retired agent/command _descriptions_ still self-routed sessions into the dead pipeline via the tool roster, independent of CLAUDE.md ("Use PROACTIVELY… master SDLC orchestrator"), plus a present-tense ROADMAP claim that the pipeline was "in active use," an inflated "~90 releases" stat (actual: ~65), a GFM table broken by unescaped pipes, and a stale `.state` path in a code comment. All findings applied; all 5 retired agents + 17 retired commands now carry LEGACY markers. **Known gap (disclosed):** `docs/AGENTS.md` still reads as operative pipeline procedure but is human-maintained (agents may not edit it) — awaiting Dean's own edit or retirement.

### v1.41.18 — Header logo FOUC: fix it at the source (server-side) (2026-07-16)

- v1.41.17's client-side approach didn't actually stop the flash: the `localStorage` flag it relied on is only written *after* a first successful load, so it can never cover the very first paint, and it collapses entirely if storage is cleared/blocked or a stale asset is served. Dean still saw the text "FileTube" logo on every refresh. Fixed at the source: the server now bakes `ft-custom-logo` onto the `<html>` tag **at serve time** whenever a custom logo is configured, so the wordmark-hiding CSS is in force before the browser parses anything — zero flash, no bootstrap, no dependency on client storage. The HTML is served `no-cache` (revalidated each load), so it's always current, and the injection is withdrawn the moment the logo is deleted (text returns). A shared `sendShellHtml` helper covers all six public shells plus the yt-dlp module's gated `/subscriptions` page (dep-injected, so its 404-when-disabled behavior is preserved). The v1.41.17 client flag stays as harmless defense-in-depth.

### v1.41.17 — Kill the header FOUC (logo + theme) on refresh (2026-07-16)

- Dean noticed the "FileTube" text logo flashes on page refresh before his custom uploaded logo swaps in. Root cause: the header shells are static HTML served verbatim, so the text wordmark always paints first; `applyCustomLogoIfSet` only swaps the image in after an async `/logo` probe. Fix: `common.js` now records a `localStorage` flag when a custom logo is confirmed present, and a tiny **pre-paint** head script stamps `html.ft-custom-logo` so CSS hides the wordmark (via `visibility`, keeping the type-scale-token lock intact) before it can paint — the text never flashes. The flag self-heals: a 404 or an undecodable image clears it and restores the text, so removing a logo brings "FileTube" back on the next refresh.
- **While there ("are there other things hit by this pattern?"):** the same static-default-then-JS-swap pattern also drives the theme/era/dark-mode/icon-set, guarded by a pre-paint script on four shells — but `read.html` and `books.html` were shipped **without** it, so a dark-mode or retro-era user flashed the default light/2021 theme on every refresh of the reader/books pages. Added the full guard (theme + logo) to both. A new source-lock test now asserts every header-bearing shell carries both guards before `<body>`, so a future shell can't ship without them.

### v1.41.16 — Long-title downloads no longer fail (ENAMETOOLONG) (2026-07-16)

- Dean hit `[Errno 36] Filename too long` downloading a Facebook video. A non-YouTube "title" is often the full post/video **description** — hundreds of characters — and the universal filename template used it whole, overrunning the filesystem's 255-byte filename limit. Fixed: the universal template now caps the title at 100 characters (`%(title).100s`), with the `[id]` bracket and extension still intact, so the id/delete machinery is unaffected. The **displayed** title is untouched — it comes from the captured full title, not the on-disk filename. (The folder in Dean's error — `s34nvideos` — confirms the v1.41.14 per-uploader folder fix is working.) YouTube's own template is left uncapped (YouTube caps titles near 100 chars anyway), keeping it byte-identical.

### v1.41.15 — Facebook share links that serve a JS interstitial (Dean's on-device pass) (2026-07-16)

- Dean's second test found a Facebook share link (`facebook.com/share/r/…`) still failing "No suitable extractor found", even though v1.41.14 handles share links. Root cause: this link (unlike the first one, which HTTP-redirected) is served by Facebook as a **200 HTML page, not a redirect** — a JS interstitial — so the redirect-only resolver couldn't reach the real video. But the real reel URL *is* embedded in that page's HTML. Fix: the D6 resolver now, on a terminal HTML page, reads a **bounded** slice of the body (512 KB cap, hard wall-clock deadline) and extracts the canonical video URL (`og:url`, or a same-host `/reel/<id>` path), then hands that to yt-dlp. Same-host-confined and re-run through the full SSRF guard, so it can never be steered to an internal or off-site address. Reviewed by a focused adversarial SSRF/DoS pass (SAFE-TO-SHIP; the one slow-drip-DoS finding was fixed in the same change with an absolute read deadline).
- Also clarified (not bugs): non-YouTube downloads briefly show the fallback folder label *while downloading* then land in their real per-uploader folder (the folder comes from the download's own metadata, known only once yt-dlp runs); and the watch-page avatar is a colored monogram letter for non-YouTube items because yt-dlp exposes no channel-avatar field for those sites (only the video thumbnail), so there's no image to show without per-site scraping.

### v1.41.14 — Universal one-offs: per-uploader folders + Reddit share links (Dean's on-device pass) (2026-07-16)

- Dean tested v1.41.13 and found three things. **(1) Everything landed in one "Uncategorized" folder** — the design intended per-uploader folders but the implementation dumped every non-YouTube download into the fallback folder, so they never grouped as pseudo-channels. Fixed: a universal one-off with no explicit folder now folds by `%(uploader)s` (fallback uploader-id, then the extractor name) at the download root, so a SoundCloud track by an artist and a Facebook creator's video each get their own channel-folder and group/sort like YouTube channels. Doubly confined — yt-dlp sanitizes the folder name (no traversal) and the post-download check independently verifies the file is under the download root. An explicit folder override still wins. **(2) A Reddit share link failed** (`reddit.com/r/…/s/…` → "No suitable extractor"): the D6 resolver didn't recognize Reddit's `/s/` share shape, and its request user-agent got a `403` from Reddit — both fixed (Reddit share links 301-redirect to the real `/comments/` URL yt-dlp handles, but only for a browser-like user-agent, which the resolver now sends). **(3) No avatar on the tiles** — expected: home tiles show no channel avatar for *any* item (YouTube included); the pseudo-channel monogram avatar appears on the watch page and channel sidebar, and now that items fold by uploader, that's where it shows.
- Note: the fix applies to *new* downloads; the two files already in "Uncategorized" stay put (delete + re-download to re-file them, or leave them).

### v1.41.13 — Universal one-off downloads: any yt-dlp-supported site, not just YouTube (2026-07-16)

- Dean: "make the URLs supported by yt-dlp all supported by FileTube… I won't be limited to just YouTube." The one-off download box (both the page modal and the API/iOS-Shortcut route — they share one endpoint) now accepts any URL a **named** yt-dlp extractor supports (~1,800 sites: Vimeo, SoundCloud, Bandcamp, Facebook, …). Paste it, it downloads, indexes, plays, and deletes cleanly — and non-YouTube items **group and sort by their uploader as a pseudo-channel, exactly as if it were YouTube** (Dean's ask), with a generated monogram avatar. YouTube behavior is byte-for-byte unchanged throughout.
- **Facebook share links work** (Dean's exact case): a `facebook.com/share/r/…` shortlink matches no named extractor (stock yt-dlp only follows it via its generic scraper, which FileTube blocks for security). Instead FileTube follows the redirect itself through a **bounded, SSRF-hardened resolver** — max 3 hops, no cookies, manual redirect handling, and every hop's target re-checked against private/loopback/link-local addresses *and* DNS-resolved to confirm it isn't a public name pointing inward — then hands the resolved `/reel/…` URL to the named extractor. Stronger than yt-dlp's own redirect following, which has no such guard.
- **Security posture (SSRF):** the generic "scrape any page" extractor stays off, so the server never fetches an arbitrary URL on demand. A load-bearing address guard refuses any URL (or redirect hop) targeting a private/loopback/link-local/cloud-metadata address, across every IPv4 encoding (decimal/octal/hex/short) and IPv6 form (compressed, IPv4-mapped, NAT64, link-local, ULA).
- **The design and the data-loss surface** got unusual scrutiny — this touches the id/delete/tombstone/archive machinery where every historical data-loss bug in this repo lived. The design went through **three adversarial review rounds against yt-dlp's actual source** before any code; the implementation then went through a **multi-agent data-loss-briefed gate** that confirmed 8 findings, all fixed — **two CRITICAL**: an IPv4-mapped-IPv6 SSRF bypass that reached cloud-metadata (`http://[::ffff:169.254.169.254]/…`), and a wrong-content bug where the YouTube query normalizer was stripping non-YouTube resource identity (a Bilibili `?p=3` part selector → downloaded the wrong part); plus a latent delete-resurrect data-loss path (a rescan clobbering the authoritative raw source id with the sanitized on-disk form). Non-YouTube ids are matched by a new `[Extractor=id]` filename bracket kept disjoint from the legacy YouTube shape, with the raw id authoritative in metadata + the archive and the bracket a same-folder recovery hint — the delete/tombstone/SEAM machinery generalized with the identical cross-folder-safety confinement the YouTube path uses (a different copy of the same id in another folder is never reaped).
- **Non-goals (disclosed):** non-YouTube subscriptions/channel-polling (this is one-offs only; the poller stays YouTube-tuned); the generic extractor (SSRF); per-site real channel avatars (no general yt-dlp field exists — the monogram fallback covers every site). Residuals: a DNS-rebinding TOCTOU window on the redirect resolver, and playlist URLs reduced to a single item — both noted, revisit at the multi-user tranche.

### v1.41.12 — Chapter loop: loop one section of a video or audio item (2026-07-16)

- Dean: loop a specific chapter — "helpful if it's like a music album." Every row in the chapters menu now carries a **Loop** toggle (a word, deliberately not a glyph — the iOS forced-emoji lesson): tap to loop that section, tap again to stop, tap a different chapter to move playback and the loop there together. The chapters button tints while a loop is armed. Session-only by design: cleared on every new item, on chapter edits, and on player close. It works on the lock screen (the boundary clamp rides both media elements, so a background-audio album track loops exactly like the foreground one), respects the live-transcode seek contract, and at the last chapter it outranks both the whole-video loop and autoplay-next — a looping track never zeroes its progress or advances.
- **Escape hatch (gate-driven design):** any explicit seek that lands outside the looped section — dragging the seek bar, J/L/arrows, a digit jump, or **the lock-screen scrubber** — disarms the loop. Pre-fix, the next timeupdate yanked you back within a quarter second, and a docked mini-player (chapters hidden there) had no escape at all.
- Full two-reviewer gate, three rounds. Round 1, both seats convergent on a CRITICAL: arming the loop consulted the media element's duration during a live transcode — the transcoded-so-far segment, not the video, violating a contract this file documents three times — so a last-chapter loop on an AVI silently refused to arm, or armed truncated and respawned ffmpeg every ~25 seconds. Round 2 (adversarial, mutation-proven): two of my test locks were satisfiable by lookalike neighbor lines — deleting the loop branch's own safety lines passed the suite green — and the lock-screen scrubber was the sixth seek surface missing the disarm. All fixed and mutation-verified dead; both seats delta-APPROVE. A refused loop is now a visible toast, never a silent no-op (the silence had masked the CRITICAL).
- **Disclosed:** one non-reproducing Node 22 full-suite failure of the documented thumbnail-sendFile flake (standalone 6/6); sub-half-second chapters refuse to loop (epsilon guard); tech-debt #40 filed for a pre-existing, unrelated seekto/liveMode basis limitation the QA seat spotted while verifying. Also on this branch: the v1.42.0 universal-downloads design plan, taken through two adversarial design-review rounds to APPROVE (see docs/exec-plans/completed/2026-07-16-v1.41.13-universal-oneoffs.md).

### v1.41.11 — Mobile chapters polish, duplicates report, YouTube keyboard shortcuts, quality scorecard (2026-07-16)

- Dean's overnight four-item wave, scoped at intake (all recommendations accepted) and run autonomously end-to-end.
- **Chapters on mobile + miniplayer:** the chapter picker was "compressed and small" on phones — its popup was sized for a wide desktop player (220px min-width, ellipsis-heavy rows). At the mobile breakpoint it now spans the player's width with 44px tap targets and two-line wrapped titles; in the 160–280px docked mini-player, chapters are hidden entirely (Dean's pick — mini stays minimal), with `dock()` closing the menu so ARIA stays truthful.
- **Duplicates report (Stats page + CSV export):** same-filename groups (NFC-normalization-aware, so NFD/NFC spellings of one name group together) plus same-video-id-different-filename groups (the cross-folder copy class), with sizes and a keep-the-largest reclaim estimate, biggest first. **Strictly read-only** — nothing on the page deletes anything (the no-data-loss norm); cleanup is by hand, guided by the CSV export (spreadsheet-safe: formula-injection defusal for hostile YouTube titles, and the per-group reclaim appears once so a naive column SUM is the true total).
- **YouTube-style keyboard shortcuts + working media keys:** K/Space, J/L ±10s, ← / → ±5s (**behavior change, disclosed:** arrows previously skipped 15s; the on-player buttons and double-tap keep 15s), ↑/↓ and scroll-wheel-over-the-volume-slider for volume, M mute, C captions, < / > speed (clamped at the ends — no wrap-around surprise), 0–9 percent-jump, F fullscreen, Shift+N/P next/prev. The real fix for "only play/pause works on my keyboard": browsers auto-wire only play/pause — previous/next need explicit MediaSession handlers, and the watch page now registers its context-aware neighbors with the player's trackNav seam, powering hardware media keys, the lock screen, and Shift+N/P through one registration.
- **Quality scorecard:** `docs/QUALITY_SCORE.md` populated with per-domain grades and concrete actions for every C/D — at Dean's explicit override of the file's human-maintained guard, recorded in its header.
- Full two-reviewer gate; **both seats returned REQUEST CHANGES on the first round** and both delta-APPROVEd after one fix round. What they caught: a stale-closure race where a slow list fetch from a departed watch page could hijack the media-key handlers of whatever played next (including a book narration); the skip ripple flashing a hard-coded "15s" over a 5s arrow skip; the digit percent-seek bypassing the live-transcode seek path (with a corrupted-resume-position consequence); `<` at 1x wrapping around to 2x (intent inversion); CSV formula injection; and several honesty defects in the new quality doc's own claims (inflated line count, overstated flake count) — fitting, for a document whose premise is honesty.
- **Known residuals (disclosed):** holding ← / → autorepeats an unthrottled progress-save POST per step (tech-debt #39 — bounded by the server-side write coalescer; fix deferred as its own gated change); a possible one-line-sliver cosmetic quirk in the mobile chapter list's two-line clamp on iOS (Dean's on-device probe); video-id duplicate groups match by the filename `[id]`, so groups deserve a glance before deleting (also stated on the page).

### v1.41.10 — Fix: the "undeletable" videos were pinned by FileTube's own leaked streaming handles (2026-07-16)

- The three "undeletable" emoji/full-width-named videos (vanishing from the UI, then resurrecting after every rescan, with `rm`/`unlink` reporting ENOENT on a file that plainly existed) were diagnosed LIVE against the NAS with an independent SMB client — and the filenames were innocent. FileTube's own node process held **~180 leaked open file handles** on exactly those files: every browser seek aborts its in-flight Range request, and `.pipe()` never destroys the source read stream on a client abort, stranding one open fd per seek, forever. On SMB/CIFS, deleting a file that has open handles puts it into server-side **delete-pending**: the directory keeps listing it until the *last* handle closes, every new open (including the unlink's own open-for-delete) is refused with a status the kernel reports as ENOENT, the delete route concluded "already gone" (fake success), and the scan's deferred retry burned the tombstone and re-indexed the still-listed survivor — the infinite loop. (Restarting the container released the handles and the NAS executed the pending deletes by itself — that's how the three stuck files were finally freed, original names intact.)
- Four fixes, one per link in the chain: **(1)** media streaming (`/video/:id`, `/audio/:id`, downloads, transcodes) now pipes via `stream.pipeline`, which destroys the read stream the moment the response goes away — no stranded fds (and a mid-stream disk read error, previously an unhandled `'error'` event that would crash the process, now tears down cleanly); **(2)** a live-stream registry lets DELETE destroy this process's own streams on the file and its sidecars, and wait for the fds to actually close, *before* unlinking — deleting a video mid-playback can no longer self-inflict delete-pending; **(3)** after any "it's gone" conclusion, the delete re-checks the parent directory's raw-byte listing and reports a still-pinned file honestly (`deletePending`) instead of faking success — and the UI now *shows* that (both delete flows previously toasted a hardcoded "File deleted." for every shape, so every honest server message was dead code); **(4)** the scan's deferred retry keeps the tombstone and keeps the file hidden for as long as the pending state lasts (90-day prune as the backstop), instead of consuming the tombstone and resurrecting the card.
- Full two-reviewer gate (the delete path is a data-loss surface). **The gate caught a CRITICAL in this fix's own first round**: the post-verify treated "still listed after the unlink" as proof of delete-pending — but a brand-new file recreated at the same path inside that window (an in-flight re-download finishing, a sync-client restore) would have been tombstoned, and the next scan would have **destroyed content the user never deleted** (yt-dlp's backdated mtimes defeat the restore check; proven with a runnable repro that main survives). Fixed per the reviewer's prescription: probe the survivor's **openability** — a delete-pending file refuses every open (verified against the production NAS), a recreated file opens fine and is left alone, untombstoned. Locked by a mutation-tested regression test replaying the exact repro (backdated mtime and all). Both seats delta-APPROVE.
- **Known residuals (disclosed):** a stale client-side directory cache can hide a pinned survivor from the post-verify once — it re-indexes on the next scan, and the second delete catches it via the ENOENT shape (one extra delete, never data loss); live-transcode (`?live=1`) ffmpeg fds are outside the registry (tech-debt #38) but fully covered by the honest-pending + scan-suppress net; an enumerated-but-permission-denied survivor is misread as pending (double-contrived, and the scan-side reap still re-checks mtime + fresh-db guards). One reviewer full-suite run hit a single non-reproducing failure of the documented full-suite-load flake class; the suite passed 4190/4190 twice on Node 22 and once on Node 24, and the 15 new/updated delete-path tests passed in every run.

### v1.41.9 — Fix (for real this time): deleted yt-dlp videos reappeared after a rescan (2026-07-15)

- Dean's long-standing bug, "fixed" in v1.37.5 and v1.41.3 and *still* happening: delete a yt-dlp video, rescan, and it comes back — only yt-dlp files, only some. Root cause, finally proven with a runnable repro: FileTube keys every video by an MD5 of its **stored file path**, but a yt-dlp file can sit on disk under a spelling that differs from what's stored (full-width characters, emoji with zero-width joiners, invalid UTF-8 bytes, or the computed name the v1.41.6 relocation writes). When that happens the delete can't find the file by its stored name, reports "already gone" **without actually removing it**, and files a deletion tombstone under `md5(stored path)` — but the scanner re-discovers the file under `md5(real path)`, a *different* key, so the tombstone never matches and the video is re-added. **Both prior fixes missed it because the tombstone test re-created the "surviving" file at the same spelling as the stored path**, which makes the two keys match — so the test passed while the actual divergent-spelling case (the whole bug) was never exercised. Green test, broken feature.
- Fix, three seams: (1) **root** — when delete can't find the file by exact or accent-variant match, it now recovers the real on-disk file by its stable `[videoid]` bracket + extension (including a raw-byte pass for invalid-UTF-8 names) and unlinks *that* — so the delete genuinely removes the file and there's nothing to re-add; (2) **backstop** — tombstones now record the video id so the scanner can reap a survivor by identity, not just by path-hash; (3) the test now re-creates the survivor at a *divergent* spelling, locking the real bug (it fails on the old code, passes on the new).
- This deletes files, so it took the **full two-reviewer gate**. The gate caught a CRITICAL in the backstop (SEAM 2): as first written it reaped by "same video id anywhere under the download root," so deleting one copy of a video could delete a *different* copy in another folder — proven with a repro, and the mtime guard that was supposed to prevent it is unsound (yt-dlp back-dates downloaded files' mtime to the video's upload date). Fixed by confining the backstop to the *same folder and extension* — which still covers the real bug (the divergence is in the filename, the folder is unchanged) and eliminates the cross-folder delete entirely (mutation-verified). Both seats APPROVE.
- **Known residual (disclosed):** id-based recovery cannot distinguish two genuinely different files that share one YouTube id in the same folder with the same extension — byte-for-byte indistinguishable from the legitimate divergent-spelling case it exists to bridge. yt-dlp's download-archive de-dup normally prevents that state; no stronger guard is possible without content inspection. Not the reported class, and narrow. Full suite green on Node v22 + v24.

### v1.41.8 — Fix: the "Preview changes" modal never appeared on in-app navigation (2026-07-15)

- Dean reported that clicking "Preview changes" flashed "Computing preview…" for a moment and then showed nothing. Root cause: the v1.41.7 modal's markup (`#reloc-preview-backdrop`) lived *outside* `#view-root` and its `.reloc-preview-*` styles lived in a page-local `<head><style>` block — but the SPA router's `extractViewFragment` swaps in *only* the `#view-root` subtree on in-app navigation, so on a nav-link visit (as opposed to a hard page refresh) the modal element was never mounted and its open silently no-opped. The Reheat button worked because it *was* inside `#view-root`; the modal wasn't. This is tech-debt #34 / the known "page-local styles are lost on the SPA swap" class, which the new modal landed squarely in.
- Fix (mirrors the working `#playlists-sheet` overlay pattern): the modal markup moved *inside* `#view-root` so the swap mounts it, and the `.reloc-preview-*` rules moved into `public/css/style.css` so they survive the swap (font sizes tokenized to `--fs-*` per the type-scale rule; rendered sizes unchanged, colors/layout identical). Verified no `#view-root` ancestor carries a `transform`/`filter` that would break the modal's `position: fixed`. A regression test locks all four modal IDs as `#view-root` descendants and the styles as present in style.css (mutation-tested: reverting either half turns it red). Closes the v1.41.7 portion of tech-debt #34. Adversarial slim gate APPROVE; full suite green on Node v22 + v24.

### v1.41.7 — Reheat "Preview changes" + checksum-verified cross-filesystem moves (2026-07-14)

- The safety net for v1.41.6's relocation, built because the owner **cannot back up** his media folder — so a bulk, irreversible file operation needed to be inspectable and provably non-destructive before it runs.
- **"Preview changes" button** (next to Reheat on the Subscriptions page): shows exactly what a reheat would do and **moves nothing, writes nothing, makes no network calls** (both reviewers traced and mutation-verified this). Each item is classified in plain language: *hard-linked into a channel folder (no data copied)*, *copied across filesystems (X GB, original removed after a checksum match)*, *metadata refreshed but file stays put*, *not touched*, or *would hydrate first*. The top-line summary tells you at a glance whether your setup is the safe all-hard-link case or involves cross-filesystem copies — the single fact you need before committing. The preview shares **one decision function** with the real mover, so it cannot describe one thing and then do another (mutation-tested: making the executor diverge from the plan fails the anti-drift test).
- **Checksum-verified cross-filesystem moves:** on the same filesystem a move is a hard link (same bytes, nothing copied — inherently safe). Across filesystems it becomes a copy, and the original is now deleted **only after a streaming SHA-256 of source and destination match exactly** (was size-only). A silently-corrupted copy that happened to land at the right size can no longer cost the original. Hashing is chunked (constant memory regardless of file size); the hard-link path never pays it.
- Honesty, since this is a safety feature: the hard-link/copy prediction is disclosed as **best-effort** (device-id based; the real method is decided at move time), with a note that any copy is checksum-verified regardless — so a file is safe no matter how a row is classified. The preview reflects a normal (non-force) reheat, and cross-filesystem moves read each file twice (disclosed).
- Full two-reviewer gate (it touches the file-move path): QA caught a real blocker — the preview re-parsed the entire database once *per item*, freezing the whole server for ~11s on a large library; fixed by threading a single snapshot (**~11,000 ms → ~20 ms**, and both seats re-verified the decisions stayed byte-identical, so no drift). Both seats also caught wording that overstated what "untouched" items get (they still receive a read-only tag re-check) — corrected. Both APPROVE. Full suite green on Node v22 + v24.

### v1.41.6 — Relocate hydrated imports into their real channel folders (2026-07-14)

- Completes what v1.41.5 started. Hydration gave a MeTube-imported video its real channel *name* and avatar, but the card's channel **link** still pointed at whatever folder the file happened to sit in — because in FileTube a sidebar "channel" *is* a folder. v1.41.6 closes that: after hydration, the Reheat batch physically **moves** the file into its per-channel folder under the yt-dlp download dir, renames it to the native `<title> [<id>].<ext>` shape, re-keys its library identity, and records it in the download archive so a subscription poll never re-downloads it. An import becomes indistinguishable from a native download — sidebar folder, pins, working channel link. Default-ON settings toggle; genuine local media (no embedded YouTube URL) is never moved and never network-touched.
- **This is the first feature that relocates the user's own irreplaceable media, so it took the full two-reviewer gate and THREE fix rounds.** What the gate caught, in order of severity:
  - **The scan would have DELETED the relocated file** — proven with a runnable repro, and *no crash required*. v1.41.3's delete-tombstones unlink a re-discovered file whose mtime predates its delete; `linkSync` preserves mtime; so a file relocated onto a path carrying a live tombstone looked exactly like a deleted survivor and the next periodic scan reaped it. The source was already gone. **Neither release was wrong alone — the bug lived in the seam between them, and the test suite was green the entire time.** Fixed both ways: the destination tombstone is now retired in its own committed write *before any byte moves*, and the scan re-reads a fresh database immediately before any tombstone unlink, refusing to remove a path a live entry claims (failing closed on any doubt).
  - **A subscribed channel's library would have split in two, permanently** — a subscription's folder is named from the subscription (usually the `@handle`) while a hydrated item carries YouTube's canonical `/channel/UC…`, and the join couldn't compare them whenever either side lacked a channel id (which `addSubscription` never writes). Fixed by deriving the id from the canonical URL itself and by making ambiguity a question of *comparability*: when the two genuinely cannot be compared, the move is **skipped**, never guessed. A skipped file is recoverable; a split library is not.
  - A crash mid-move could lose a video's history (progress, Like, chapters) → the database is now re-keyed *before* the source is unlinked. A concurrent delete could resurrect the deleted video into a channel folder → the destination is now rolled back on every failure path. CJK/emoji titles silently failed to move (the length cap counted characters; the kernel counts bytes). Moving a file mid-watch dropped the viewing position. In-flight transcodes left an item permanently unplayable. All fixed.
  - **Pre-existing bugs this work exposed and fixed:** every file move since v1.30 (the move button, the v1.25 one-off migration) **silently dropped the item's Like** — `db.liked` is id-keyed and the re-key never updated it. The `.m4a` audio sidecar, `rootFolder`, and multi-language subtitle sidecars were likewise stranded.
- Safety posture: exclusive create (never clobbers), size-verify before unlink, cross-filesystem copies never delete the source until the destination is verified, and rollback on every failure path — the reviewer instrumented all three exit paths and confirmed the source and destination unlinks are mutually exclusive by control flow, so the last link to a file can never be removed. Every attack reproduction is now a permanent regression test, each mutation-verified to fail when its fix is reverted.
- **Known limits (disclosed):** cross-volume copies are verified by **size, not checksum**. The "don't move what's being watched" guard is a 10-minute heuristic, not a proof. Files already inside the download dir are left where they are (never re-canonicalized). Both seats APPROVE. Full suite green on Node v22 + v24.

### v1.41.5 — Hydrate imported (MeTube/foreign) videos with their real channel (2026-07-14)

- Dean's ask: a library folder of .mp3/.mp4 files downloaded years ago with **MeTube** showed a generic folder-name channel — no real channel, no avatar, no Subscribe button. They live in a normal library root (not FileTube's own download dir) and have no `[videoid]` in the filename, but they *do* carry the YouTube URL in their embedded `comment`/`purl` tag.
- The good news the investigation found: FileTube **already** derives `youtubeId` from that embedded tag with no folder restriction, so those items were sitting on their own hydration key. Two things blocked using it: the reheat's candidate list hard-required files to be under the yt-dlp download root, and the metadata re-pull read only `title`/`release_date`/`chapters` out of a `--dump-json` response that **already contained** `channel_url`/`channel_id`/`channel`. So this is a widening, not a new subsystem: the existing **"Reheat metadata & channels"** button (Subscriptions page) is now root-agnostic and writes real channel identity + avatar (one avatar probe per distinct channel, not per item). Result: correct channel name, avatar, and a working Subscribe button that reads "Subscribed" for channels already followed — from any folder, with no filename requirement. Genuine local media (no embedded YouTube URL) is never network-touched.
- **The gate caught two CRITICALs, both reproduced with failing tests.** (1) Widening the candidate list dragged a pre-existing *supersede* along with it: every non-YouTube file in the library would have had its **displayed title and release date silently overwritten** by its own embedded tags (a ripped CD track → "Track 05"), with no undo — no title-edit endpoint exists. Now the embedded-tag fallbacks are trusted only for items with a YouTube identity or inside the download root. (2) The **persist-gate/stale-snapshot class struck a sixth time**: the Phase-2 re-read-merge did not adopt the new channel fields, so a reheat landing mid-scan lost the hydration *permanently* (the "already reheated" marker survived while the identity didn't, so it would never retry). Also fixed: an avatar could be stapled onto an item whose identity the never-overwrite guard had correctly declined; a transient NAS/realpath blip could permanently mark an in-root item complete with no subtitles.
- **Known behavior (disclosed):** the first widened reheat enumerates the whole library — one local probe per item, one network fetch per YouTube-id-bearing item, serialized on the shared yt-dlp queue, so **downloads and subscription checks wait until it finishes** (Cancel stops it between items). The UI now says so. Also unchanged by design: a card's channel *link* still points at the file's folder, because a FileTube sidebar "channel" is a folder — hydrated imports show the right name and avatar but clicking through goes to the folder, not an all-videos-by-this-channel view.
- Adversarial gate: REQUEST CHANGES → all 7 findings applied → delta APPROVE (the reviewer applied its own prescribed fix for CRITICAL 2, found it regressed a legitimate case, and confirmed the implementer's deviation was the correct one). Both reproductions are now permanent regression tests. Full suite green on Node v22 + v24 (4049 tests).

### v1.41.4 — Hidden folders stay hidden on the watch page (2026-07-14)

- Fixes Dean's report: folders configured NOT to show in the sidebar were correctly hidden on Home, but opening any video re-showed **all** of them in the watch page's sidebar.
- Root cause, one seat out of four: the sidebar-visibility rule lives in one shared pure helper (`visibleSidebarFolders(folders, settings)`, common.js) which Home, the Setup list, and the mobile Playlists sheet all route through — but `watch.js`'s `renderSidebarFolders` mapped the **raw** `folders` array, so `folderSettings[path].hiddenFromSidebar` was simply never consulted there. The fix routes both the empty-check and the link map through the same shared helper (no duplicated filter); watch was the last unfiltered seat (every writer to `#sidebar-folders-list` was enumerated to confirm).
- Slim gate: APPROVE, no blocking findings. It mutation-tested the new tests (reverting the fix fails 3 of 4 — they are not vacuous source-greps), disproved a hypothesized active-highlight index bug, and verified `common.js` loads before `watch.js` on every HTML entry. Its one nit (a brittle regex window that could falsely fail if a comment grew) was fixed. Full suite green on Node v22 + v24 (4014 tests); one unrelated espeak-ng flake appeared in a single Node 22 run and did not reproduce (passes standalone on this branch AND on clean main, green on Node 24) — same known full-suite-load flake class, not a regression.

### v1.41.3 — Delete stays gone: deletion tombstones + scan deferred retry (2026-07-14)

- Fixes Dean's report: some yt-dlp videos "successfully deleted" came back after a re-scan. Root cause is the class tech-debt #32/#35a documented: any `DELETE /api/videos/:id` path that reports success **without a verified unlink** (the resolver concluding "already gone" on a stored name that doesn't round-trip to disk, or an opt-in `removeAnyway` on a transient EBUSY) leaves the file on disk, and the next scan re-discovered it under the same path-hashed id. v1.37.5 fixed the NFC/NFD variant of this; these were the remaining siblings.
- The fix makes deletion authoritative against the **scanner** (complementing v1.36.2, which made it authoritative against yt-dlp re-downloads): an unverified-success delete mints a `db.deleteTombstones[id]` entry, and when a scan re-discovers that id it retries the unlink **at its own enumerated path** (which by construction round-trips) — file gone stays gone. A file put back deliberately (mtime newer than the delete) is re-indexed normally; an undeletable file is re-indexed honestly with a log line (one retry per delete, never a silent suppress-list). Tombstones are pruned (90-day age + 500-entry FIFO cap).
- The adversarial slim gate caught a CRITICAL in the first cut: tombstoning **verified** unlinks too would have armed a 90-day unlink trap at every normally-deleted path for mtime-preserving restores (rsync -a/Syncthing). Fixed: verified deletes mint nothing (regression-tested). It also caught that yt-dlp can be configured (or old versions default) to back-date download mtimes to the upload date, which would make a deliberate re-download look "older than the delete" — `--no-mtime` is now pinned in the download argv (a no-op on the bundled 2026.7.4 binary). Plus: `/api/scan-status` progress accuracy on reap passes, `.vtt` sidecar sweep at the scan retry, and stale comment/UI-copy fixes.
- Also closes tech-debt #5 (manual delete now clears its `persistedServedAt` entry, mirroring the scan-prune path). Known residuals: tech-debt #35's resolver edges remain (their resurrect consequence is now neutralized by the tombstone), #36 unchanged. Full suite green on Node v22 + v24.

### v1.41.2 — Uniform filter row: custom sort dropdown (2026-07-14)

- The All/Videos/Audio pills, the sort control, and Shuffle/Rescan are now all the same font and size (Dean). The blocker: a native `<select>` under 16px triggers iOS's focus-zoom, so the sort control was pinned to 16px — a size larger than the 12px pills. v1.41.0 wrongly matched everything *up* to 16px (too chunky). The fix replaces the native `<select>` with a **custom button-styled dropdown** (`.btn.sort-select-btn` + a `.sort-menu` list): being a `<button>`, it never triggers the zoom, so the whole row is uniform at 12px with no tradeoff. Full keyboard support (arrow keys / Enter / Escape / roving focus), non-optimistic same-effects wiring as the old select (persist + shuffle-visibility + refetch), and a guard so a tampered `filetube_sort` can't crash the view.
- Two-reviewer gate: both APPROVE (goal verified met — identical 12px/600/padding across all three control types, desktop and mobile, no zoom). Their follow-ups (keyboard nav, localStorage crash guard, a stale comment) all addressed. Full suite green on Node v22 + v24 (3999 tests).

### v1.41.1 — Subtitles render bottom-center (2026-07-14)

- Captions were rendering bottom-left / left-justified (Dean). A WebVTT cue's horizontal position + text justification come from per-cue *settings* on the timing line (`position`/`align`); CSS `::cue` can restyle the text but can't move the cue box. Video captions use the native `<track>` (browser-drawn), and cues from SRT (no settings → browser default) or yt-dlp `.vtt` sidecars (often author-positioned) landed off-center. Fix: the `/api/subtitles` route now normalizes every served cue's settings to `position:50% align:center` (new pure `centerVttCues`, cue-block-aware like `shiftVttCues`), so all captions sit bottom-center — inline, fullscreen, desktop, and mobile-native alike (the audio-mode custom overlay was already centered). This overrides any author positioning in `.vtt` sidecars, which is the intended global behavior. Full suite green on Node v22 + v24.

### v1.41.0 — Stats page: About/versions, books inventory, uniform sort control (2026-07-14)

The Stats page becomes the whole-library + About hub (Dean), run through the two-reviewer gate (both APPROVE, no fix round needed).

- **About FileTube section:** shows the **FileTube version** (links to its own GitHub release tag), the **yt-dlp version**, and the **TTS engine + version**, plus GitHub links (repository / releases / report-an-issue). Rows hide themselves when a component isn't installed (yt-dlp not enabled → no row; TTS unavailable → no row). FileTube's version is now surfaced to the client for the first time (`require('./package.json').version`).
- **yt-dlp version moved here** from the Subscriptions page (it lived only there before) — one home for version info. The Subscriptions page keeps its breaker banner. yt-dlp's version was already probed + cached; a new `getCachedYtdlpVersion()` accessor feeds Stats (spawn-free, TTL-guarded).
- **TTS engine version:** the boot probe already ran `--version`; it now captures the output and parses a version for **espeak-ng** (the baked-in default). Piper's `--version` output isn't trustworthy (the v1.38 gate lesson), so it shows just the engine name.
- **Books inventory:** books are part of the same library, so Stats now aggregates them too — total books, total size, EPUB/PDF split, how many have TTS narration generated, and a per-folder breakdown (`computeBookStats` over `db.books`, mirroring the video stats).
- **Uniform sort control:** the "Release date" sort dropdown now matches the size/font of the All/Videos/Audio filter pills (padding aligned to `.btn`; on mobile the pills match the select's 16px iOS no-zoom floor rather than shrinking the select, which could reintroduce focus-zoom).
- Full suite green on Node v22 + v24 (3991 tests).

### v1.40.1 — Fix: portrait/Shorts cards rendered oversized (v1.40.0 regression) (2026-07-14)

- The v1.40.0 `.card-media` wrapper (added so the Like heart anchors to the thumbnail) was a plain block, which broke thumbnail sizing for portrait/Shorts videos: `.thumbnail-container`'s `aspect-ratio: 16/9` height is only *definite* — so its `.thumbnail-img { height: 100% }` resolves and crops to 16:9 — when the container is a **flex item** (as it was as a direct child of `.video-card`). Under a block wrapper the height went indefinite, `height: 100%` collapsed to `auto`, and a portrait thumbnail rendered at its full natural height (a giant card). Fix: `.card-media` is now `display: flex; flex-direction: column`, restoring the flex-item context. Regression-locked in tests. Full suite green on Node v22 + v24.

### v1.40.0 — Card Like button + context-aware Next/Prev (2026-07-14)

Two features (Dean), built together and run through the two-reviewer adversarial gate.

- **Per-card Like control.** Every video card gets a heart in the **bottom-left** corner, mirroring the existing Download (top-left) / Delete (top-right) corner controls. It toggles the same `db.liked` membership the watch-page Like button uses (`POST`/`DELETE /api/liked/:id`), non-optimistically (the heart flips only after the request succeeds), and fills **red** when liked. The heart is a real SVG mask (`heart.svg` + `.icon-heart`), painted in `currentColor` like every other icon — deliberately not the U+2665 codepoint (which iOS renders as the red-heart emoji). `GET /api/videos` now tags each item with `liked` so cards render their initial state. The thumbnail + its three overlays are wrapped in a `.card-media` box so the corner controls anchor to the thumbnail, not the whole card.
- **Context-aware Next/Prev.** Opening a video from a browsing view now makes Prev/Next (and autoplay-at-end) walk **that view's exact on-screen order** — the folder/search/liked scope, the sort, **and** the server shuffle seed — instead of the item's own channel folder. A compact `ctx` param travels with the card link (and across every hop, and into the docked player for autoplay); the watch page re-fetches the same list-API query and steps through the **server response order verbatim** (never re-derived client-side, which would re-shuffle a `random` list differently than what was on screen). Channel/folder order stays the fallback when no context travels with the link (related-card hops, old bookmarks). Shared encode/decode/URL helpers live in common.js.
- **Gate:** two adversarial reviewers, both APPROVE after one fix round. They caught: a `ctx` percent-encoding layering bug that would have silently dropped context mid-session for common search terms (`R&B`, `50% off`); the Like heart anchoring to the card instead of the thumbnail; and a stale-context case on same-video re-entry. All fixed; new URL round-trip tests lock the encoding. Full suite green on Node v22 + v24 (3982 tests).

### v1.39.5 — Muted volume-slider glyph recentered (2026-07-13)

- The diagonal "muted" slash over the speaker icon sat off the glyph (Dean's report). It was drawn from a `top-left` transform origin with a hand-tuned `left: 5px` offset — fragile. Recentered it on the icon box (`left/top: 50%` + `translate(-50%, -50%)`, height ≈ the box diagonal so it crosses the speaker corner-to-corner). Pure CSS, no magic offset.

### v1.39.4 — Book narration bar: chapter glyphs in line with the controls (2026-07-13)

- The ⏮/⏭ chapter buttons rendered ~20px lower than the play/seek/time control bar. Cause: the base `#player-wrapper:not(.audio-expanded)` rule reserves a 40px `padding-bottom` strip for the player's *absolutely-positioned* control bar — but the reader makes that bar `position:static`, so the reservation became an empty band below the controls, leaving the mount slot ~80px tall with the controls pinned to its top while the center-aligned chapter buttons sat at the slot's true middle. That padding was only killed on mobile (2-ID rule inside the phone media query); on desktop `#player-wrapper` (1 ID) still out-specified the reader's 2-class container rule.
- **Fix**: kill the strip padding in the reader at the base (non-media) level with a 2-ID selector, so the mount slot collapses to the control-bar height on **both** desktop and mobile and the chapter glyphs line up with the transport. Removed the now-redundant mobile-only copy. Full unit suite green on Node v22 + v24.

### v1.39.3 — Book narration bar: reading-% stays visible (measured, not guessed) (2026-07-13)

- The v1.39.2 attempt to keep the reading-% bar above the now-playing bar didn't work: the reader chassis height is set **inline by JS** (`sizeReader()`, the v1.37.2 "measure the real available space" fix), which overrode the CSS class it relied on — and the reservation was both a guessed pixel value and scoped mobile-only, so it was still covered on desktop *and* mobile.
- **Fix (Dean's steer — pixel/percent guessing doesn't scale): measure the bar.** `sizeReader()` already measures the header offset and the nav's live `offsetHeight`; it now also subtracts the now-playing bar's real rendered `offsetHeight` when it's visible. Zero magic numbers, self-adjusting to any device / font size / bar layout, and correct on both form factors (the desktop bar sits at `bottom:0`, the mobile bar above the nav — measurement handles both). The reveal path re-fits the surface (`requestAnimationFrame` → `sizeReader()` + `refit()`) so the reader re-paginates to the reduced height the moment narration starts. The dead CSS px-guess rule was removed.
- Full unit suite + typography lock green on Node v22 + v24.

### v1.39.2 — Book narration bar: glyphs, progress bar, nav order (2026-07-13)

- Follow-up to v1.39.1 from Dean's on-device pass (all visual/CSS, no logic beyond one class toggle):
  - **Chapter glyphs now render.** In v1.39.1 the CSS-drawn ⏮/⏭ were keyed off `.reader-np-next`/`.reader-np-prev` **class** selectors, but those are element **IDs** — so the `::before`/`::after` triangles never generated and the buttons showed as empty boxes. Switched to `#reader-np-next`/`#reader-np-prev`.
  - **Reading-% bar stays visible.** The fixed now-playing bar covered the reader's own bottom progress bar. read.js now adds `.reader-np-active` to the chassis when the bar is shown, and (mobile only) the chassis shrinks by the bar's footprint so the reading-% bar sits above it. Driven by a JS class toggle, not `:has()`, for iOS reliability.
  - **More intuitive mobile bottom-nav order**: `Home · Playlists · Download · Subs · Books · Light/Dark · Settings`. The base items ship in HTML and Subs/Books/Download are JS-injected relative to Settings, so DOM order varies — pinned with CSS `order` on the flex children (mobile only), injection-agnostic.
- Desktop untouched. Full unit suite + typography lock green on Node v22 + v24.

### v1.39.1 — Book narration bar: mobile polish (2026-07-13)

- Visual follow-up to v1.39.0 (no logic change). On mobile the now-playing bar looked "ugly as sin" and covered the page: it mounts the app's **FULL** player, which on phones deliberately blooms into a two-row 80px control bar plus an 80px reserved cover-art strip (v1.34.1) — so the bar inherited that whole tall block with an empty art band, unlike the compact desktop bar.
- **Fix, following the app's own control conventions**: reader-scoped overrides (2 IDs + a class, so they outrank the mobile FULL-player rules) collapse the transport back to a **single compact row** and drop the reserved art strip — matching desktop and the docked mini-player. And the **⏮/⏭ chapter buttons no longer render as blue iOS emoji**: they used the U+23EE/U+23ED media-control codepoints iOS force-presents as color emoji. They're now **CSS-drawn** (a border-triangle + bar, the same technique as the player's `.pp-icon-play`) inside the app's beveled `.pc-btn`, so they match the play button — monochrome and theme-aware, on desktop and mobile.
- Desktop is untouched (the collapse rules are mobile-only). Visual-only change on the already-gated v1.39.0 → on-device-iteration class. Typography lock + full unit suite green on Node v22 + v24.

### v1.39.0 — Book narration: in-reader now-playing bar + chapter nav + lock screen (2026-07-13)

- The proper redesign of TTS playback (superseding the v1.38.2/.3/.4 patches, which were symptom-patching). Investigation-first: the transport controls **already existed** in the player's FULL audio bar — docking them into the 160px chip is what hid them. So: mount the player FULL as a real bottom **now-playing bar** in the reader (play/pause + scrub + elapsed/total time, reused from the shared player), with reader-owned **⏮/⏭ chapter** buttons + a cover and chapter label, plus **iOS lock-screen** controls (play/pause/seek + prev/next chapter).
- **Prev/next = next/previous chapter**: advances the narration *and* follows the reader page; bounded by the spine; the page only follows once the chapter actually starts playing.
- **Reliable iOS start**: `play()` is attempted immediately and *observed*; on the autoplay block the reading pane becomes "▶ Tap to start listening" (a fresh gesture that always plays and unlocks the session). Fixes a real dead-end in the prior patch where play was gated behind an event iOS may never fire.
- **Reuse, not rebuild**: the only shared-player changes are two additive seams — `setTrackNav` (lock-screen prev/next) and a `suppressProgress` read-gate (no `/api/progress` for the synthetic book id) — plus `'read'` joining `'watch'` as a view whose player docks on navigate-away (so narration keeps playing in the mini-player when you leave the reader).
- **Gate:** full two-reviewer gate. Both reviewers independently caught a would-be fourth-wrong-ship CRITICAL — the bar was placed outside `#view-root`, so it never mounted on the normal click-into-a-book path (SPA swaps only `#view-root`) — plus the missing dock-on-leave (a ghost bar). Both fixed (bar moved inside `#view-root`, `'read'` added to `shouldDockOnTransition`), delta re-confirmed APPROVE. Full suite green on Node v22 + v24. The bar's exact look + iOS lock-screen behavior are Dean's on-device call.

### v1.38.4 — Listen from Here on iPhone: reliable "Tap to play" (2026-07-13)

- v1.38.3 fixed the mount (desktop confirmed working), but iOS still didn't play: the in-gesture silent-clip "unlock" wasn't blessing the element (likely the 8-bit WAV data URI iOS won't decode). Rather than chase a fragile unlock that can't be tested off-device, the reader now drives `play()` itself and OBSERVES the autoplay-blocked rejection: when iOS refuses, the whole reading pane becomes a big **"▶ Tap to start listening"** target. That tap is a fresh gesture with the audio already loaded, so it always plays — and the first successful user-initiated play unlocks the persistent media element, so every later chapter auto-plays (the player's own documented behavior). Desktop is unaffected (autoplay succeeds → no prompt). The fragile silent-clip unlock was removed.

### v1.38.3 — Listen from Here: the player actually mounts now (the real oversight) (2026-07-13)

- Dean: the now-playing bar never appeared — on **desktop** either, so it wasn't just the iOS autoplay wall. Root cause: `player.load(id, data, {})` with **no slot** is a silent no-op — `mountInSlot` bails without a slot, so the persistent player host (and its `<audio>`) is created but **never attached to the DOM**. No bar, nothing plays, and the v1.38.2 "unlock" couldn't even find the element. The docked mini-player only appears if you `load` into a `#player-slot` and then `dock()`.
- Fix (reader wiring): read.html gains a `#player-slot` mount point; read.js loads the audio into it and calls `player.dock()` to show the mini bar. Media ids are now **per-chapter** (`booktts:<book>:<spineIndex>`) so the player's adopt-by-id fast-path doesn't skip loading the next chapter; a constant unlock id + `suppressProgress` flag avoid adopt on the in-gesture silent-clip unlock and keep the player from writing `/api/progress` rows for a synthetic id; the dock's tap-to-expand carries a `readerHref` so it returns to the reader, not a video watch page. Combined with the v1.38.2 in-gesture unlock, playback should start and continue on the lock screen. 443 player/reader tests green.
- Honest note: this is DOM/iOS runtime behavior a code gate can't exercise — **the desktop bar appearing is the fast confirmation of the mount fix; iOS lock-screen playback is Dean's on-device call.**

### v1.38.2 — Listen from Here now actually plays on iPhone (iOS autoplay unlock) (2026-07-13)

- Dean's report: tap Listen → "Preparing audio…" flashes and disappears, but no sound; a second tap clears instantly with still no audio. Root cause: the **iOS autoplay gesture wall**. The chapter's `play()` fires *seconds* after the tap (synthesis → status poll → blocks fetch), so it's outside the user gesture and iOS silently blocks it (the swallowed `NotAllowedError`); the status text clears because the code assumed playback started.
- Fix (reader client only): on the Listen tap, a brief **silent clip** is loaded and played on the shared media element *within the gesture* — this "blesses" the element (the unlock is scoped to the element, not the src, matching player.js's own iOS handling), so the real narration then plays when it swaps in. No change to the battle-won player internals; all 443 player/reader unit tests still green. This is an iOS-runtime fix a code gate can't exercise — pending Dean's on-device confirmation (ship, test, iterate).

### v1.38.1 — TTS works out of the box (espeak-ng baked into the image) (2026-07-13)

- Following v1.38.0, "Listen from Here" was strictly opt-in (you had to provide a Piper binary + voice model). Now the Docker image bakes in **espeak-ng** (Alpine `community`, ~a few MB, pure musl — the same repo ffmpeg already comes from) and defaults `FILETUBE_TTS_ENGINE` to it, so the reader's **Listen** button lights up with zero configuration — the yt-dlp "the binary's already there" posture. The voice is clear but robotic.
- **Piper stays the opt-in quality upgrade** — it can't be baked on Alpine (its `onnxruntime` dependency has no musl wheels and would add ~300 MB nobody on the default needs), so mount a `.onnx` model and set `FILETUBE_TTS_ENGINE=piper` + `FILETUBE_TTS_PIPER_MODEL` to get the natural voice (a runtime `-e` overrides the image default). Upgraders who ran Piper via only the model env now also need `FILETUBE_TTS_ENGINE=piper` (README note).
- No app code changed — the espeak-ng path was built and gate-approved in v1.38.0; this is a Dockerfile + README change. Slim adversarial gate APPROVE (Alpine package + voice data, espeak-ng's headless `--stdin`/`-w` flags, and its PCM WAV output all verified against source).

### v1.38.0 — TTS "Listen from Here" + book-folders Settings UI (2026-07-13)

- **Listen from Here.** Open an EPUB in the reader, tap **Listen**, and FileTube reads it aloud *from the paragraph you're on* — playback continues on the lock screen with the book cover as artwork, reusing the battle-won background-audio machinery. The server splits the chapter's text into blocks by the *exact* rule the reader uses to track your position (one shared source of truth, version-locked so audio can never silently desync from text), synthesizes each block, and maps block → second-offset so the seek lands on the right words. It prepares one chapter ahead, never the whole book.
- **Piper, strictly opt-in** (yt-dlp posture): set `FILETUBE_TTS_PIPER_BIN` + `FILETUBE_TTS_PIPER_MODEL` in your image and the Listen control lights; absent, books work exactly as before and the control stays dark. `espeak-ng` is a config-selectable fallback engine. One default voice (the settings shape reserves selectable voices/rate for later).
- **Less-spiky by design:** TTS synthesis defers while a yt-dlp download/poll is running, so the two never both hammer the CPU/disk (one-directional — downloads never wait for TTS).
- **Book folders in Settings** (Part A): a "Book Folders" section on the setup page over the existing (previously API-only) book-config routes, closing the v1.37.0 disclosed gap.
- **Gate:** full three-reviewer gate (QA + **two** adversarial seats). The engine-focused seat caught a genuine dead-on-arrival bug by reading Piper's actual source — `--quiet` is treated as *spoken text* by the maintained `piper1-gpl` fork (removed). Others caught an image-only-chapter hang (now an honest "unavailable"), a mid-prune cache leak, and a cache-key/route index mismatch — all fixed with tests. The block-contract adversary could not produce a wrong-paragraph jump from valid EPUB XHTML. Full suite green on Node v22 + v24.
- **Known gap (disclosed):** the TTS audio cache has no automatic age/size eviction yet — it's bounded by book-prune and "Clear cache now" (tech-debt #37). A speech chapter is small (mono 96k); revisit if the cache grows.

### v1.37.5 — deletes that stick, and a permanent "Skip" for failed downloads (2026-07-13)

- **Delete now actually deletes.** A small % of deletes "vanished from the list but came back after a rescan" — the file survived on disk, and it was never a permissions issue. Root cause: an item's id is the md5 of its exact path bytes, but a file's on-disk name can carry a different Unicode normalization than what FileTube stored (NFC vs NFD — macOS/APFS and many SMB shares emit NFD), so `existsSync` missed the real file and the old handler dropped the library entry anyway while returning success. The delete route now resolves the stored path to the real on-disk entry one path component at a time by NFC-normalized match (per-channel FOLDER names as much as filenames — Beyoncé/Motörhead), unlinks the real file, and when it genuinely can't confirm removal (an unreadable folder) returns an honest recoverable error instead of a fake success. Genuinely-absent files still succeed (the v1.36.2 already-gone contract).
- **"Skip" a failing download for good.** Each failed-download row on the Subscriptions page now shows a per-video Skip button; clicking it records the video id to a new, permanent skip list (`.ytdlp-skiplist.txt`, kept separate from the download archive) so no future poll re-attempts it, for any channel. Failures yt-dlp couldn't attribute to a specific id render without a button. Skip takes effect from the next poll cycle (a cycle already in flight keeps its snapshot).
- **Gate:** full two-reviewer gate PLUS a second adversarial seat (three reviewers, at Dean's request). The delete-seat caught a real gap — the first pass de-normalized only the filename, missing an NFD *folder* name (fixed: full-path component walk, with a dedicated test). QA caught a signature-collision risk in the failure-row change-detection (fixed: JSON-based signature; it had also been written with raw control-byte separators) and a missing test for its no-op path (added). Known residuals filed as tech-debt #35 (invalid-UTF-8 / NFC-collision delete edges) and #36 (a sidecar-unlink errno can misreport a completed delete as a 409). Full suite green on Node v22 + v24.

### v1.37.4 — Continue-reading row no longer widens the page (2026-07-13)

- The home book row scrolls internally but its content width was still setting the flex minimum of the main content area, widening the whole page past the mobile viewport (pinch-to-zoom symptom). Classic min-width:auto flex floor — removed, with max-width guards on the row. CSS-only; gate skipped (token economy), on-device is the arbiter.

### v1.37.3 — reader pagination fixed at the root (2026-07-13)

- Every on-device pagination symptom (whole chapters as one giant page, overflow past the border, arrows skipping chapters, per-page size drift, text vanishing on arrow, chapter-granular progress, desktop pages blank until tapped) traced to ONE root cause: epub.js was handed percentage dimensions and measured an unsettled container, silently degrading to un-columned rendering. The reader now waits for settled layout and always passes explicit measured pixels (open, resize, and a one-frame post-display repaint nudge); phones are strictly single-page, wide panes get two; the pane clips residual overflow. Slim adversarial gate: APPROVE — diagnosis and all four fix mechanics verified line-by-line against the vendored epub.js source.

### v1.37.2 — reader layout scales with the device (2026-07-13)

- The reading area now measures its real available space (actual header offset + live bottom-nav height) on open and on every resize/rotation instead of guessing with CSS vars -- fixes the clipped Contents/Aa buttons on desktop and the unusable sizing on mobile. epub.js renders two pages side-by-side when the pane is wide, one when narrow (spread auto), refitting on resize; the topbar wraps rather than ever clipping. Gate skipped by owner request (token economy) -- on-device pass is the arbiter.

### v1.37.0 — Books: library + reader + progress (2026-07-13)

- FileTube becomes a media platform for text too: EPUB + PDF libraries scanned from configured book folders into a new Books page (portrait cover cards, shelf chips, sort, era styling), with an in-app reader (themes, font size, TOC, tap/keyboard paging, exact resume) and per-book position/percent progress feeding a continue-reading row on home and books-in-search.
- Zero new server dependencies: EPUB metadata/covers come from a hand-rolled, capped, hostile-input-hardened zip + OPF pipeline; the reader vendors epub.js/JSZip/pdf.js as lazy client assets. PDFs backfill their own cover from page 1 on first open.
- Everything lives in a books-owned db namespace (structurally immune to the media scan's merge), with the media scanner's hard lessons ported on day one: cooperative-async walking, mount-loss + empty-mountpoint prune guards, folder-overlap rejection in BOTH directions, a books-owned progress coalescer.
- Shelves join the pinned-playlists sidebar; every pinned row (channels AND shelves) now carries its own unpin control — orphaned pins are no longer permanent (Dean's report).
- KNOWN GAP: book folders are configured via API only this release (POST /api/books/config) — the Settings-page UI ships in v1.37.1 alongside TTS.
- Gate: QA + adversarial both REQUEST CHANGES (2 CRITICALs: source-scoped pin reorder; the Option-C mountpoint guard) -> full fix round -> both delta-APPROVED. 3897/3897 on Node 22 + 24.

### v1.36.2 — four minors + gate hardenings (2026-07-13)

- Liked is a real prev/next context: cards opened from the Liked view carry it into the player, the arrows walk the Liked list in grid order, and stepping stays inside it.
- PWA fix: the native video controls layer is re-armed (attribute cycle) on every return to the app — no more dead controls after an app switch.
- Transcripts are non-blocking everywhere: subtitle fetch/convert failures no longer fail or red-flag subscription downloads OR one-offs; success credit is corroborated by per-download evidence so a real failure can never masquerade as success.
- Deletes unstick: busy/locked files (EBUSY/EPERM) get the actionable remove-anyway flow instead of a dead-end 500, and deleting a yt-dlp item records its id in the download archive itself — 'stays gone' no longer depends on the original download having archived it. Subtitle sidecars cleaned up. Residual (removeAnyway + rescan) filed as tech-debt #32.
- Slim adversarial gate: APPROVE across three rounds (two hardenings applied same-day). 3831/3831 on Node 22 + 24.

### v1.36.1 — shorts exclusion made shape-aware (2026-07-13)

- Dean's on-device report confirmed: skipShorts subs downloaded Shorts after v1.36 — the detector keyed only on a /shorts/ URL marker the UU uploads-feed listing does not reliably carry. rules.isShort now adds YouTube's own classification rule as a fallback (<= 3 minutes AND vertical-or-square), fail-open on missing fields; the yt-dlp-side defense filter (inert since v1.15 — it keyed on webpage_url, which yt-dlp always canonicalizes) now keys on original_url and genuinely works where the marker exists. skipShorts=false subs untouched. Slim adversarial gate: APPROVE (heuristic verified as YouTube's post-Oct-2024 auto-classification rule; original_url entry-URL semantics verified in yt-dlp source).

### v1.36.0 — subscription-poll starvation fix (2026-07-13)

- Root cause of the "same channels time out every poll" loop found and fixed: the list pass full-extracted a channel's entire never-downloaded back catalog on every run (--dateafter filters but never stops), so large-catalog channels deterministically blew the 5.1m budget. The list pass now targets the channel's combined UU uploads feed and STOPS at the first pre-cutoff video (--break-match-filters with a 7-day out-of-order slack; exit 101 mapped to success), with a 200-entry scan-cap backstop (FILETUBE_YTDLP_LIST_SCAN_CAP) and a budget that scales with what the argv can actually walk. Playlist subs and channelId-less fresh subs use the old bounded walk; channel subs self-heal their channelId from their first listing. The authoritative date gate moved into the survivor loop (rules.isBeforeCutoff).
- Per-channel failure backoff: a failing channel cools down exponentially (30m..6h, success clears, explicit retry bypasses) instead of squatting at the head of every walk and feeding the breaker; the "next check ~" estimate reflects the window.
- The hourly scheduler now yields to an armed breaker resume instead of steamrolling the deferred tail every interval; a resume whose whole deferred set became ineligible clears the breaker instead of stranding "retrying at <past>".
- Gate: two rounds — QA CRITICAL (budget still wired to the dormant maxVideos) + adversarial CRITICALs verified against yt-dlp source (--dateafter masks break filters; bare channel URLs expand to separate video/stream/short tabs a break would truncate). Both delta-APPROVED. 3808/3808 on Node 22 + 24.

### v1.35.0 — deterministic background audio (2026-07-13)

- The lock-screen/app-switch background-audio handoff hardened at every layer: a `playback` audio-session declaration (Safari 16.4+ — the background-continuation entitlement; plays through the silent switch like a media app), the sidecar src pre-assigned at load (the risky step leaves iOS's transition window), and MediaSession metadata/handlers re-asserted across every swap.
- New **Pre-extract background audio** setting (experimental, off): new downloads get their audio track extracted at scan time, played items' sidecars are pinned from cache eviction, and the sidecar is fully pre-buffered per watch — the maximum-determinism config. Base toggle alone gets the session + pre-assignment improvements with zero added network cost.
- Gate: adversarial REQUEST CHANGES (eager fetch initially rode the wrong setting — re-gated onto the disclosed-cost lever) + QA APPROVE w/ an enforced live-playback guard; both delta-APPROVED. 3767/3767 on Node 22 + 24.

### v1.34.6 — audio expanded-view polish + custom-video findings doc (2026-07-13): the now-playing bar sits flush at the true bottom edge (safe-area padding inside the bar) and the cover art canvas ends ABOVE the bar (art never covered, worst-case landscape fixed); the custom mobile VIDEO effort is PAUSED per Dean — full honest record in [docs/references/mobile-custom-player-findings.md](docs/references/mobile-custom-player-findings.md) (what works, the three iOS platform walls, lessons, and the recommended future swing: adopt media-chrome/Vidstack or hybrid custom-inline/native-fullscreen instead of more hand-rolling).

### v1.34.5 — mobile player round 5 (2026-07-13): iOS's rotate-to-landscape native-fullscreen hijack is bounced into faux fullscreen in custom mode (rotation = the fullscreen gesture, FileTube controls kept); fullscreen bar blends into black.

### v1.34.4 — mobile player round 4 (2026-07-13): faux fullscreen now covers the app chrome (z-order: it sat under the fixed header/nav — the visible search bar + the landscape gap), page scroll frozen while fullscreen, bar overlays the picture and grows for the safe area (the missing buttons row).

### v1.34.3 — mobile player round 3 (2026-07-13): the dismissal root cause (display:flex silently overrode [hidden] — no close path could ever work), a structural flex line-break for the scrub row, faux-fullscreen height-clamp release + active-surface trigger.

### v1.34.2 — mobile player round 2 (2026-07-13, on-device iteration)

- Scrub row is exclusive (buttons can no longer squeeze onto it); chapters menu gained an explicit ✕ close + iOS dismissal braces; custom-mode mobile fullscreen is now a CSS faux-fullscreen keeping FileTube's own bar (iPhone element-fullscreen is native-only by platform rule).

### v1.34.1 — mobile player usability (2026-07-13, on-device iteration)

- Two-row mobile control bar: full-width scrub row (the seek bar was an unusable sliver), buttons below; Ch button only shows on mobile when the item has chapters; the chapters menu dismisses on tap-outside (iOS click-synthesis quirk fixed with pointerdown).

### v1.34.0 — player quality wave: shorts, CC sync, chapters, scrubbing, custom-mobile option, default sort, stuck one-shots (2026-07-13)

- **Shorts same footprint**: portrait videos render in the standard 16:9 player box (pillarboxed) on desktop AND mobile — no more oversized Shorts.
- **Desktop CC sync (root-caused)**: live-transcoded playback restarts its clock on seek while captions used absolute times — captions drifted by the seek offset. Fixed with server-side cue-shifted VTT (`?offset=`) re-pointed per live seek; hardened against timestamp-shaped caption text (cue-block context tracking, both branches).
- **Chapters**: embedded file chapters captured at scan/reheat (`-show_chapters`), description "0:00 Intro" lists parsed as fallback (YouTube's own convention gate), per-video textarea editor (manual ALWAYS wins), Chapters button + picker on the custom control bar (five-shell parity), `--embed-chapters` on all new downloads. The new fields survived the full stale-snapshot guard treatment — and the gate caught the bug class's FIFTH strike (both halves: persist gate + Phase-2 merge) before ship.
- **Drag scrubbing**: proper pointer-capture drag on the seek bar (was tap-only on iOS — touch-action scroll-steal), time preview while dragging, one commit on release, live-transcode reload-seek preserved, off-element release backstopped.
- **Custom mobile player option**: "Use custom player controls for mobile video" Settings checkbox (default OFF = native, unchanged) — the trial lever for the custom mobile experience.
- **Default sort**: release-date out of the box + a "Default sort order" Settings dropdown ('random' deliberately excluded as a site-wide default — prev/next would be nondeterministic).
- **Stuck one-shot downloads fixed** (root-caused): the post-download metadata persist was unbounded and ran after the process handle was released — a wedge left entries "running" forever, un-cancellable, wedged the download queue, and re-wedged on every restart. Now: persist time-bounded, childless entries cancellable (no more "may have already finished" dead end), cancelled-while-queued jobs never spawn, and a watchdog sweeps genuinely wedged entries to a visible failed state.
- Gate: two-reviewer, both REQUEST CHANGES → fix round (both CRITICALs were the two halves of the same fifth-strike chapters bug) → delta round (one residual VTT asymmetry) → both APPROVE. 3753/3753 on Node 22.23.1 + 24.14.0.

### v1.33.1 — Liked everywhere + light/dark logos (2026-07-12)

- **Liked entry on every sidebar** (Dean: it was home-only): the built-in Liked link moved into a shared, count-gated helper — visible on home/watch/setup/stats/subscriptions sidebars and the mobile Playlists sheet iff at least one liked video exists; appears/disappears live on like/unlike/delete (no reload). Transient count-fetch failures are never cached.
- **Per-mode header logos**: upload a separate light-mode and dark-mode logo in Settings; with only one uploaded it serves both modes (server-side cross-fallback); the header swaps live with the moon/sun toggle and after uploads. v1.32 single-logo installs unchanged.
- Slim two-reviewer gate: both APPROVE (fix round: uncached transient failures, delete-refresh hook, replaced-logo live swap). 3715/3715 on Node 22.23.1 + 24.14.0.

### v1.33.0 — release-date trust chain, Share button, emoji titles, prune Option C, vegetables (2026-07-12)

- **Release-date trust chain**: `youtubeId` persisted per item — filename `[id]` bracket (yt-dlp-rooted) or the embedded `purl`/`comment` source URL (the only id source for bracket-less metube-era imports), always through the hardened `classifySingleVideo` gate; schema-only backfill for pre-existing items (no re-probe). **Reheat gained a LOCAL ffprobe tags pass** — embedded date/source-URL/real-title, run before the network pull; network fetch only where an id is derivable; precedence network > embedded tag > mtime. Transient probe failures stay retryable; only a successful probe-with-nothing marks an item exhausted (honestly counted skipped, never done).
- **Share button** (watch page): native share sheet with the ORIGINAL YouTube link (server-derived `watchUrl`, re-validated at serve time), clipboard + "Copied!" fallback; only shown when a link is derivable.
- **Emoji-preserving display titles**: the real title is captured off the download's FTCHMETA print line (`sourceTitle`, control-stripped/code-point-capped, emoji intact), supersedes the `--restrict-filenames`-mangled filename title, survives changed-file rescans, and is backfilled by Reheat for the existing library.
- **Tech-debt #10 Option C (global)**: `detectVanishedRoots` — a configured root whose entire prior content vanished while the directory still exists is treated as an unmounted/empty mountpoint (nothing pruned, watch progress preserved, loud warning); one surviving or new file defuses it, so individual deletions prune normally.
- **"Eat our vegetables" coverage**: the transcode execution path tested for the first time via a stub-ffmpeg-on-PATH harness (lazy 503 → drain → atomic finalize → Range; failure cleanup; live pipe; download bypass; reconcileTranscode healing) + config-validation/thumbnail/cache-clear hardening tests.
- **Gate**: two-reviewer (QA + adversarial), both REQUEST CHANGES → fix round (F1-pattern reheat-vs-scan freshness guard — the stale-snapshot bug class's FOURTH strike, caught in-gate this time; changed-file identity carry-forward; transient-probe/exhausted honesty) → both delta-APPROVE. 3705/3705 tests on Node 22.23.1 + 24.14.0.


### v1.32.0 — breaker starvation fix, diagnosable history, Liked view, custom logo (2026-07-12)

Driven directly by Dean's live v1.31 production data (the breaker retry
restarting from the top let 4 chronic slow channels starve the other 177
forever) plus his UX punchlist:

- **Breaker resume targets the deferred channels** (id-array runPoll) —
  chronic burners rotate to the next scheduled poll, the tail never starves;
  paused-during-backoff subs excluded (FR-D); clean resume clears the breaker.
- **History rows always explain themselves** — run-level reasons render when
  there are no per-item failures (no more bare "Failed").
- **Chip noise cut, honestly** — list-pass ("check") failures are muted off
  the badge entirely (rows + history keep the reason), download failures stay
  sticky red, and a tripped breaker shows one compact sitewide line
  ("Downloads paused — retrying at HH:MM") so a systemic storm is never
  silent. Stale failureKind tags are explicitly cleared on every error write
  (adversarial-gate CRITICAL). 'Dismiss all' on the chip panel.
- **Subscriptions page QoL** — yt-dlp version line at the top; the list is
  collapsible (persisted) so history/details need no 180-row scroll.
- **Liked playlist surfaced** — built-in sidebar + Playlists-sheet entries;
  ?liked=1 scopes the grid to GET /api/liked (format toggle honored).
- **Custom header logo ("white-label")** — Settings upload (PNG/JPEG/WebP,
  magic-byte sniffed, 1MB cap, no SVG, nosniff-served, race-free
  single-writer persistence), bounded header swap on all five shells,
  one-click reset. README hero updated to the full-res art.

LEAN-MODE wave; two-reviewer gate passed after one fix round (QA + adversarial
re-confirmed). 3645 tests on Node 22.23.1 + 24.14.0.

**Dean's on-device ledger:** breaker banner + chip line during a throttled
run; a paused chronic channel staying paused through a resume; the collapse
toggle; Liked view; logo upload/reset from Settings.

### v1.31.0 — yt-dlp download hardening (2026-07-12)

The wave that ends the "downloads fail for no reason" era. Root cause of Dean's
production 20-channel cascade (every channel dying with the identical bare
"yt-dlp timed out and was killed"): v1.29's pacing flags slowed the LIST pass
past its unchanged hardcoded 5-minute budget, and under YouTube tarpitting each
hung socket burned the clock (H0, confirmed).

- **P0 (H0 fix):** `--socket-timeout` (default 15s) on every pass — dead
  sockets fail fast and retry; the list budget is configurable AND scales with
  `maxVideos` × `sleep-requests`; every timeout kill now names its phase +
  budget ("list pass timed out after 5.1m…") — the bare string is gone.
- **P3 stall watchdog:** no output for 10m (config, 0=off) → killed with a
  specific "stalled" reason instead of holding the queue up to 3h.
- **P1 queue decomposition:** per-channel gate jobs — a one-shot submitted
  mid-poll starts within ≤1 channel (was: invisibly behind the whole run);
  strict-serial spawning + the archive single-writer invariant preserved.
- **P2 circuit breaker:** N consecutive channel failures (default 4) abort the
  run honestly ("paused… retrying at HH:MM" banner + runlog record) with an
  automatic backoff retry — no more burning every channel against a throttled
  session.
- **P4 durable one-shots:** accepted jobs persist to disk; a restart requeues
  them (re-validated, "requeued" history line) — never silently lost.
- **P5 visibility:** "Queued — N ahead" on queued one-shots AND subscriptions;
  repull busy/not-found surfaced as toasts/button labels; breaker banner.
- **P6:** yt-dlp binary version in the footer with a >90-day staleness warning
  + the documented Dockerfile pin-bump update path (D5: no auto-update).

LEAN-MODE wave (Dean's call): direct implementation against the plan's 61 ACs,
keeping the two-reviewer gate — which earned its keep again: QA + adversarial
both returned REQUEST CHANGES (incl. a genuine CRITICAL: a single-channel
repull silently disarmed a tripped breaker's backoff retry); every finding
fixed + locked in the gate-fix round, both reviewers re-confirmed. One
deliberate reversion recorded: reserve-at-submit for one-shot gate slots
violated FIX 2's hung-probe lock and was rolled back with the bounded
tradeoff documented. 3626 tests + lint clean on Node 22.23.1 and 24.14.0.

**Dean's on-device ledger:** the real-world arbiter — repull a few channels,
fire Shortcut one-shots mid-poll (watch them start within a channel), watch a
throttled run trip the breaker honestly, and confirm the history page explains
every failure in plain words.

- [x] **Scale Performance + Polish Wave (v1.30.0)** — makes FileTube feel instant at 1,300+ items and lands the visual-polish cluster, in one combined release (13 tasks across 3 lanes, each through an independent build gate). **Lane A — performance at scale:** killed the O(N²) subtitle-sidecar re-detection with a per-scan `readdir` cache (A1); made the scan **cooperative + non-blocking** — `POST /api/scan` returns `202` immediately, an async batch-yielding walk keeps the event loop responsive (heartbeat-proxy tested ≤50 ms/stretch on a synthetic 1,300-item rescan), the boot scan no longer gates first responses, and the client polls `/api/scan-status` + refreshes the grid **in place** (never a reload) (A2/A3-client); an **in-memory DB read cache** (`getCachedDatabase`) so hot routes (thumbnail/video/audio/videos) stop re-parsing the whole `db.json` per request, coherent with the `updateDatabase` re-read-merge mutex (A3); a **progress-write coalescer** batching the 4 s watch-position pings (≥5:1 fewer whole-file writes, ≤5 s bounded loss) while every real mutation keeps its 1:1 atomic write+fsync (A4); and **paginated `/api/videos`** (`{items,total,offset,limit}`) with a new pure `lib/videoQuery.js` (server-authoritative sort/filter, seeded shuffle) + a client `IntersectionObserver` sentinel that renders the first page fast and appends on scroll (A5). **Lane B — download UX:** a completed **one-shot download now appears in the grid with no manual action** across all three surfaces (on-home, off-home-return via a dirty-flag reconcile, backgrounded-PWA-resume via a retained pending marker), never a reload, without regressing the v1.29 BUG-2 contract (B1); the corner **active-downloads chip** conformed + locked to show only what's actually downloading (B2). **Lane C — visual polish:** a token-driven **type scale** (`--fs-*`) tokenizing every `font-size` while preserving the 16 px input floor + era character (C1); **like → a server-side "Liked" playlist** (`db.liked` membership as the single source of truth, 1:1-atomic routes, watch-page button) (C2); **deterministic avatars everywhere** the letter-avatar was — first-letter glyph + hash-based color, real captured avatar wins, subscriptions/settings-header routed through the shared resolver (C3/C5); and conservative **button polish** (C4). **SQLite deferred (tech-debt #28):** authorized by Dean, but the evidence showed the bottlenecks were algorithmic/read-storm/write-amplification, all better solved by A1–A5; deferral is tracked with measurable revisit triggers (native-addon ABI risk to the Node-24 gate weighed against a single-user LAN box). **Gate story:** two-reviewer gate — QA APPROVE + adversarial APPROVE (both independently verified AC8.4 exercised-not-present across every both-directions guard); one adopted follow-up (GD-1: the T12 hash-letter avatar glyph was reverted to first-letter per unanimous reviewer consensus, restoring the "Alice→A" mnemonic while keeping deterministic color) applied as a one-item fix round (GF1) + adversarial delta-confirm. Full suite green on **Node 22.23.1 (3593/3593)** and **Node 24.14.0 (3593/3593)**, lint clean; PM acceptance ACCEPT (37/39 documented ACs PASS). See the completed exec plan in `docs/exec-plans/completed/`. **_Dean-on-device ledger (ship now, his iPhone pass is the arbiter):_** AC7.6 (elegant buttons + overall typography feel); GD-1 (avatar glyph — adopted per reviewer consensus, Dean may re-open); and the carried-over v1.29 AC4.5 (navigate-during-download feel — code-complete + test-verified, not regressed here).
- [x] **Downloads Reliability Wave (v1.29.0)** — makes downloads trustworthy end-to-end. **Real failure reasons**: the actual yt-dlp stderr reason (bot-check/429/age-gate/members-only) is now surfaced live AND persisted in `lastStatus` across restart, instead of a generic "exit code 1" (T0). **Honest partial-success**: one failed video no longer marks the whole channel failed — a run reports "downloaded N, M failed: [reasons]" via a new pure `computeDownloadOutcome`, with both-directions failure-masking locked by tests (a total/all-unattributed failure still surfaces as an error; a genuine partial is never a false success) (T3a). **Durable history**: a capped (500-line, atomic) JSONL run log under `data/` (`runlog.js`, T0) rendered as a download-history view on `/subscriptions` (T4). **Retry that retries**: Retry buttons on errored/partial subscription rows + one-shot rows + the one-off modal error state, with visible "queued behind current run" busy-coalescing instead of a silent no-op (T1/T5/T6). **Non-blocking one-shot**: submit → the modal minimizes into the corner chip → the user keeps browsing → on done the library grid refreshes IN PLACE via `loadLibrary()` (never a page reload — the BUG-2 contract), so a new video appears without a manual rescan (T8). **Anti-bot pacing**: `--sleep-requests`/`--sleep-interval`/`--max-sleep-interval`/`--retries` argv flags with bounds-checked `FILETUBE_YTDLP_*` env overrides (README-documented) + an unset-by-default `FILETUBE_YTDLP_PLAYER_CLIENT` lever, all preserving the byte-identical injection-guard/`shell:false` posture (T7); plus a loud warning when a cookies file is configured but missing (T3c). Also closed tech-debt #17 (no stale `downloadMeta` for failed ids). **Gate story**: two-reviewer gate (QA APPROVE + adversarial) surfaced 3 findings then a CRITICAL on the first partial-success fix (byte-identical templated stderr like a shared 429 message collapsing distinct-video failures into phantom successes) — resolved across three focused fix rounds under Dean's Direction-A-safety preference (all-unattributed/zero-attributed → error; conservative `remaining===1` boundary), final adversarial APPROVE, PM acceptance 27/27 non-manual ACs. Full suite green on Node 22 (3420/3420). See the completed exec plan in `docs/exec-plans/completed/`. _(open item: AC4.5 navigate-during-download feel awaits Dean's on-device pass.)_
- [x] **Optional yt-dlp integration module (v1.11.0–v1.12.0)** — native, toggleable, off-by-default yt-dlp module: subscribe to channels → poll → download into the media dir → the existing UI surfaces them; per-channel audio/video + quality dropdowns + "download last N"; dedupe via yt-dlp's download-archive; members-only skip toggle; poll-and-defer premieres; pause/edit subscriptions; a one-shot URL download endpoint (`POST /api/ytdlp/download`, single-video, for the iOS-Shortcut workflow); live download status via polling; clean display titles; duplicate-entry fix + display-only synthetic download folder; embedded metadata/thumbnails; pinned in-container yt-dlp. Two-reviewer gate on every risky task (it caught a data-loss blocker + a maxBuffer bug on large channels among many). See the completed exec plans in `docs/exec-plans/completed/`.
- [x] **Real icon assets** — replaced the emoji `.icon-*` set + raw inline emojis with self-hosted Google Material Symbols (Apache-2.0), themed via `currentColor`, plus an icon-set system (Outlined/Rounded/Filled/Emoji + auto-per-era).
- [x] **Agent SDLC pipeline (handoff-harness)** — the multi-agent engineering pipeline (`.claude/agents` + commands + `.state`) that drove the early releases; retired in favor of lean mode around v1.26 and formally archived at v1.41.19 (see `docs/references/legacy-agent-pipeline.md`).

- [x] **YouTube-style player** — inline iOS playback (no forced fullscreen); ±15s skip via on-player buttons and double-tap (← / → keys skip 5s and J/L 10s since v1.41.11's YouTube-shortcut set); buttons hidden on mobile; autoplay disabled on mobile.
- [x] **AVI playback (hybrid + lazy)** — desktop streams a live transcode (instant); mobile/iOS plays a seekable pre-transcoded MP4. Transcoding is **lazy** — only AVIs actually watched on mobile are cached (not the whole library), with a "Preparing video" overlay + live %.
- [x] **Simplified audio player** — no spinning vinyl; embedded cover art (or placeholder) as a still with native controls that work on desktop and iOS.
- [x] **Custom folder display names** — friendly per-folder name shown in the sidebar (set in Setup).
- [x] **Recursive folder view** — opening a mapped folder shows everything under it, including subfolders.
- [x] **Reorder sidebar folders** — up/down ordering in Setup drives the sidebar order.
- [x] **Hidden folders** — per-folder "Hide from home" toggle keeps a folder's whole subtree out of the home/recent view (still browsable directly).
- [x] **Channel names** — uploader shows the folder's friendly name, else the file's artist tag, else the folder name.
- [x] **Clearer scan feedback** — Setup polls scan status and shows live file counts.
- [x] **Sort options** — home library sorts by newest/oldest/title/size (persisted).
- [x] **Caching fix** — static assets served `Cache-Control: no-cache` so updates aren't served stale by browsers/nginx.
- [x] **Mobile search bar** — no longer overflows off-screen; tightened mobile header.
- [x] **Description + file type** — fixed odd indentation; file type shown next to file size.
- [x] **Bigger mock comments** — larger pool of silly retro comments/usernames.
- [x] **Icon + favicon + PWA manifest** — solid-red full-bleed SVG icon across all pages; web manifest wired.
- [x] **Screenshots** — real desktop + iPhone screenshots in `assets/images/`, shown in the README.
- [x] **Standardized README** — icon, badges, screenshots, tidied structure.
- [x] **Transcode cache safety** — size-capped LRU eviction for `data/transcoded/` (default 5 GB, `TRANSCODE_CACHE_MAX_BYTES`) with startup orphan `.tmp.mp4` cleanup and recently-served protection.
- [x] **Automation & Storage settings (v1.8.0)** — configurable auto-scan interval (Off/30m/1h/6h/12h/24h, default 30m, with an overlap guard and a "Scan now" button); a "Remove entries for deleted files during scan" toggle (default on) with a mandatory mount-loss guard so an unmounted folder is never mistaken for a deletion; transcode-cache age-retention (Off/7/14/30/90 days, default 30, keyed off a last-served timestamp rather than raw filesystem atime) layered on top of the existing size cap; and a cache-size display with "Clear cache now". All server-side, persisted in `db.json`.
- [x] **Atomic `db.json` writes + write-concurrency hardening (v1.9.0)** — all `db.json` writers route through one serialized in-process `updateDatabase` primitive (fresh-read-inside-lock -> mutate -> atomic write-temp-then-rename), structurally eliminating the read-modify-write clobber class the v1.8.0 remediation had patched finding-by-finding. A crash mid-write can no longer truncate/corrupt `db.json` (temp + `fsync` + rename, original left intact on failure); the scan's re-read-merge is collapsed under the lock without regressing the mount-loss guard / lastServedAt authority / transcodeStatus seed; a concurrent DELETE during a scan is no longer resurrected; and a dropped rescan tail is now deferred via a single `unref()`'d timer. Includes the error-handling remediation (async-route 500s, `saveDatabase` error propagation, streaming-hot-path throttle, partial-DB backfill, orphan-temp sweep). Two-reviewer QA gate; converged.
- [x] **Mobile logo top-left (v1.9.0)** — on mobile, the logo now sits top-left on both the home and watch pages (matching desktop), with the search full-width on the row below; desktop, a11y, safe-area, and the bottom-nav app-shell unchanged.
- [x] **Related-items fuzzy ranking (v1.10.0)** — the watch page's "Related Files" list now ranks by lightweight content similarity instead of being effectively most-recent. A pure, unit-tested `rankRelated` scores other items by title/filename/tags token overlap (primary), shared folder (secondary), and cross-folder same-channel (tertiary), with a deterministic total-order tie-break, and falls back to most-recent so the list is never empty or worse than before. Weights and the similarity floor are named constants (retunable). No new endpoint, DB field, or dependency; QA-approved.
- [x] **Audio thumbnail-as-background art (v1.10.0)** — audio-only playback now shows the item's thumbnail as cover-framed background art behind the player (a CSS `#audio-bg-art` layer + transparent player in `.audio-mode`) so audio reads like a video is playing, without touching video-frame display, `playsinline`, iOS background-audio, or the lock-screen Media Session. iOS in-page rendering during playback is the on-device arbiter: if iOS paints black regardless, a one-line `AUDIO_PLAYER_MODE='visualizer'` flip falls back to the retained vinyl/cover-art view. Nice-to-have: an optional iOS-only UA-gate could keep desktop art while forcing the iOS fallback simultaneously.
- [x] **yt-dlp parity + quick wins + polish (v1.11.0–v1.15.1)** — mini-MeTube parity (one-shot URL download endpoint, format/quality/filetype dropdowns, per-channel "download last N", pause/edit subs, live status); random "feeling lucky" sort + shuffle; mobile wordmark; hide-a-sidebar-entry; default landing view; folder drag-and-drop; skip-YouTube-Shorts toggle; nicer on-disk filenames (`--windows-filenames`); one-off re-download of already-downloaded content; configurable transcode dir + CRF; PWA PNG icons; one-off download header button + modal (reachable on mobile); graceful delete on read-only mounts; embedded-metadata scan exclusion + configurable download timeout; iOS-Shortcut/share-sheet URL support. Node 22 standardized. Two-reviewer gate throughout.
- [x] **Watch experience — docked mini-player + SPA-lite nav (v1.16.0)** — persistent app shell so a video keeps playing (docked to a corner) while you navigate home/browse/search on mobile — no reload; watch page unchanged, desktop unencumbered. Plus prev/next navigation (home sort order), an autoplay-next Setting, home view+scroll retention on back-nav, and share-URL validator robustness (iOS YouTube share-sheet). Heavy two-reviewer gate on the shell/router/player + a release-blocking URL-ordering bug caught and fixed.
- [x] **Polish round (v1.17.0 + v1.17.1)** — mobile page-sizing root-cause (sort-select + safe-area de-dup; then embedded-metadata/long-path overflow in v1.17.1); quicker delete (no success modal + card trash-can with tap-to-arm→confirm); watch-page autoplay toggle + skip-resume-on-advance + reset-to-0 on end; PWA lifecycle (music keeps playing on lock, video pauses, clean resume); stuck one-off modal fix; proper themed download icon; new-subscription default 25→3.
- [x] **iOS playability + player polish (v1.18.0)** — yt-dlp downloads prefer H.264/AAC (`-S`) so they play on iOS; codec-based transcode detection (ffprobe) so HEVC/VP9/AV1/AC-3 files in web containers transcode instead of appearing-but-not-playing (lazy/on-watch); player poster/FOUC reset on load; rescan surfaces the pending-transcode list.
- [x] **UI polish + download-to-device (v1.19.0)** — one-off modal oversized-select fix; larger subscriptions list box; download-to-device button (original file, `?download=1`, header-injection-safe Content-Disposition); synthetic Downloads folder remove-button disabled with tooltip; mobile search-heading overflow fix; **fixed the v1.18 thumbnail-regeneration regression** (probe-only codec backfill preserves thumbnails); both ffmpeg thumbnail spawns hardened exec→execFile.
- [x] **Thumbnail heal-on-rescan (v1.19.1)** — the reuse fast-path now regenerates a genuinely-missing thumbnail for video items, so a single rescan restored icons the v1.18 upgrade scan had lost (zero data loss).
- [x] **Subscribe button — real subscriptions from downloads (v1.20.0)** — the cosmetic Subscribe button became a real yt-dlp-subscription toggle driven by each download's captured creator metadata: subscribe (with a compact options modal) / one-tap unsubscribe from a downloaded video's watch page; channel identity captured at download time via a fixed-literal `--print` JSON template (injection-proof, stdout-only, every URL through the unchanged validator); per-channel "View as Playlist"; hidden when there's no channel; default download count 3→2.
- [x] **The Polish Release (v1.21.0)** — the biggest single release (10 FRs): **custom blocky audio/video player** (replaced native controls → theme-aware/dark-mode, blocky, click-cover-art-to-play + double-tap-skip/hold-2x, persisted volume, rAF seek, fullscreen retarget — all persistent-player features preserved); **subscriptions-first rearchitect** (list primary, settings bottom-sheet — which also fixed the count-edit-revert bug — subscribed date + clickable channel link); **channel pins** (persistent Playlists shortcut, gated store, never in db.folders); library **2-column mobile grid**; **deliberate hard-confirm delete** for irreplaceable local files; one-shot **download retry** + bottom-left **status chip**; **theatre mode**; README refresh. Two-reviewer gate caught+fixed an audio-gesture regression, a link double-nav, and a docked-audio regression the first fix introduced.
- [x] **Player Parity + Roadmap (v1.22.0)** — 10 FRs led by the **mobile-player native-parity fix**: mobile VIDEO uses native controls (full-screen/speed/download/AirPlay/PiP restored) + our tap/hold/skip gestures, while desktop and mobile AUDIO keep the loved v1.21 custom bar (mobile audio drops the redundant volume slider); hold-to-speed text-selection glitch fixed; desktop mute-slash re-anchored. Plus **retroactive creator re-association** (existing yt-dlp videos gain their Subscribe button + real creator name from their download folder, no re-download); **creator-name → /subscriptions** link; **era light-mode contrast** fixes (button chrome was near-invisible on the panel); **channel pins in the desktop sidebar**; **configurable max-duration download gate** (default 2h, per-sub, unknown-length items deliberately skipped); **loop/repeat toggle**; **desktop cross-tab playback + native Picture-in-Picture**; **card-level download-to-device**; watch-scroll re-verified resolved. Two-reviewer gate caught+fixed a docked-mobile-video controls regression (with a new DOCKED-state test) before ship.
- [x] **Mobile-player fixes (v1.22.1)** — five on-device bugs Dean found in v1.22.0's responsive player. **Mobile VIDEO had no visible controls** (v1.22.0 made the iOS native strip the sole surface with no fallback, and iOS's inline-native-controls auto-hide/re-reveal fails under our gesture layer) → **retired the native path, routed mobile video through the same custom bar** as desktop/mobile-audio (44px touch targets; native iOS fullscreen still one tap away via the fullscreen button). Removed the dead mobile-audio fullscreen button; fixed hold-2x (thumb jitter cancelled the hold). **New persistent playback-speed control** (1×→2× cycle) on the custom bar everywhere — desktop + mobile, audio + video — surviving navigation/live-skip via `defaultPlaybackRate`. Desktop **click-video-to-pause**. Rotate-to-fullscreen confirmed an iPhone Safari platform limit (programmatic fullscreen needs a user gesture) — accepted; the manual fullscreen button is the path. Two-reviewer gate caught+fixed a rate-persistence bug and a docked speed-button glitch before ship.
- [x] **Audio fullscreen + favicon + rating-wrap (v1.22.2)** — three on-device follow-ups. **Fullscreen for AUDIO**, done the way that actually works on iPhone: a CSS full-viewport "expanded now-playing" view (the native Fullscreen API no-ops for audio on iOS and iPhone Safari won't apply it to non-video elements), reusing the fullscreen button, force-cleared on dock/close so it can't get stuck, filling the viewport (overrides the phone-portrait 45vh cap) with the exit bar clear of the iOS home indicator. **Favicon consistency** — added PNG `rel="icon"` fallbacks across all four shells (SVG-only was the "tab yes, bookmark no" cause). **Star-rating "N/5"** no longer wraps. Two-reviewer gate caught+fixed a critical iPhone-portrait 45vh cap (would have covered only the top 45%) before ship. _(Not done by Dean's call: audio hold-2x — uses the speed button instead; rotate-to-fullscreen — iPhone platform limit.)_
- [x] **Mobile-video fullscreen + audio-expand fit hotfix (v1.22.3)** — two mobile fullscreen fixes. (1) Mobile-video `#fs-btn` → `enterFullscreen()` called iOS `webkitEnterFullscreen()` unconditionally, which silently no-ops unless `webkitSupportsFullscreen` is true (video track loaded) — so on iPhone the fullscreen button did nothing (regression since v1.22.1 retired the native controls' own fullscreen button); now guards on `webkitSupportsFullscreen` and defers to `loadedmetadata` when tapped before the track is ready. (2) The v1.22.2 audio-expand view showed the cover art `background-size: cover` (zoomed/cropped); expanded scope now uses `contain` on a black backdrop so the whole image fits to the viewport with black letterbox bars, like a normal fullscreen. Direct hotfix (no full pipeline, per Dean's budget); Dean's iPhone is the arbiter. _(shipped)_
- [x] **Mobile zoom + shuffle-label quick wins (v1.23.0)** — two on-device mobile-polish quick wins (direct, no pipeline). (1) **Kill iOS double-tap-to-zoom** — a global `touch-action: manipulation` on interactive controls (links/buttons/selects/nav/cards) drops iOS Safari's legacy double-tap-zoom gesture that was firing on taps (download button, double-tap Home/Playlists, subs-page tap) while keeping normal taps + two-finger pinch-zoom (a11y preserved). (2) **Shuffle shows its word again** — the mobile `.section-actions .btn-label { display:none }` icon-only rule (which made Shuffle read as just an emoji) is retired; the row already wraps at `width:100%`, so the "Shuffle again"/"Rescan Files" words now show with a 44px tap-target floor. Note: the bottom-nav Playlists button already carries a "Playlists" label; the subs-page base-zoom (if any remains beyond the tap-zoom) is a separate horizontal-overflow follow-up. _(shipped)_
- [x] **Mobile action-row labels + retro bar-below-picture player (v1.23.1–v1.23.5)** — a run of on-device polish: shortened the random-sort label to "Feeling lucky" and the home action buttons to one-word "Shuffle"/"Rescan" so the mobile actions row fits one line (full names kept in aria-labels); mobile-video fullscreen fixed (guard iOS `webkitEnterFullscreen` on `webkitSupportsFullscreen`); audio-expand art switched to `contain` on black. Then the headline: the inline control bar no longer overlays the picture — it now sits in a **reserved strip BELOW the 16/9 content** (container `aspect-ratio:auto` + `padding-bottom` matching the bar height, border-box exact), giving one **consistent retro media-player layout for video + audio across desktop + mobile** (picture/cover-art fully visible, blocky bar directly beneath). Docked mini-player, desktop/native fullscreen, and the audio-expand overlay explicitly kept on their prior layouts. _(shipped)_
- [x] **v1.23.x polish run (v1.23.6–v1.23.10)** — a rapid on-device polish streak: **tap-to-play on mobile** (picking a song/video auto-starts; iOS unlocks after the first manual tap); **docked MiniPlayer** joined the bar-below layout; **creator/channel name → that item's folder content view** (`/?root=`, replacing the generic /subscriptions link); **Prev/Next + autoplay-next now walk the item's folder** (shared `parentFolder` helper) instead of the whole library, which also fixed prev/next being greyed out for Hide-from-home folders; **mobile Playlists sheet auto-closes** when you pick one; and a **delete fail-safe** — deleting an item whose file is already gone (ENOENT) now succeeds and removes the orphaned entry instead of 500-ing and leaving it stuck in the list. _(shipped)_
- [x] **UX Round — Wave 1 (v1.24.0)** — first increment of the in-progress v1.24 UX round: real multi-res `favicon.ico` byte-identical across all shells; more elegant (less blocky) buttons per era; per-view **item-count** badge + a **videos/audio/both** format toggle + an available **"Release date"** sort option; **local-file release-date capture** (additive scan backfill, hard-tested zero re-processing); consistent deterministic uploader/comment **avatars**; the **Polite and Unhinged** mock commenter (87% polite / 10% unhinged / 3% conspiracy). Player.js untouched. **Waves 2–7 remain** (subscriptions · download-failure visibility + cancel + poll-timing · multi-site one-off URLs · reconcile one-offs · subtitles/CC · move-files · stats · release-date yt-dlp capture · DnD reorder · pin-from-video · player-adjacent + mobile-polish fixes) — fully planned in `docs/exec-plans/completed/2026-07-09-v1.24-ux-round.md`, resume at Wave 2. _(shipped; round in progress)_
- [x] **UX Round — Wave 2: Subscriptions (v1.24.1)** — second increment of the v1.24 round, all in the yt-dlp module and behind its enable gate: a **prominent "re-pull all channels"** button lifted out of the buried "add subscription" `<details>`; a **per-channel "re-pull this channel now"** button that appears on any subscribed channel's folder view — relocated into the SPA router lifecycle (`common.js`) so it's **airtight across every entry point** (a shared-video-link session that navigates into a channel folder gets it too), health-probe-gated inert when the module is off, no double-inject / observer-leak / fetch-storm; **poll-timing display** (last-checked + next-check estimate) driven off the existing ~2.5s status poll (additive `pollMinutes`/`lastCheckedAt`/`nextPollDue`, no client date math); **pin-from-video** straight from the watch page (reuses the existing pins route, identical `{channelDir,label}` shape); and **drag-and-drop subscription reorder** persisted via a new `order` field + `POST /api/subscriptions/reorder` (reuses the existing folder-sidebar DnD helpers, no forked logic, no new deps). Two-reviewer gate + a focused delta re-gate on the router change; caught and fixed an `order`-gap regression (a new sub landing mid-list after a deletion → `order = max(existing)+1`). 1921 tests green; disabled-module no-op and `db.folders` boundary regression-locked. **Waves 3–7 remain.** _(shipped; round in progress)_
- [x] **UX Round — Wave 3: Library data (v1.24.2)** — third increment of the v1.24 round. **Move files between folders**: `POST /api/videos/:id/move` with pre-flight lexical path confinement (never escapes configured mounts) and — the load-bearing bit — an **atomic single-`updateDatabase` id re-key migration** (media id = md5 of path, so a move re-keys the item; metadata + watch-progress + thumbnail + transcode + subtitle sidecars all migrate `getMediaId(old)→getMediaId(new)` so the next scan takes the reuse fast-path, NOT delete+new-add — watch history survives, hard-locked by a regression test). Cross-device `EXDEV` copy fallback, and an **atomic-exclusive write** (`link`/`COPYFILE_EXCL`) so a move can never silently clobber an existing destination file. Per-item **"Move to…" picker** on cards + the watch page (which stops the player first, since the id re-keys). **Fun stats dashboard** (`/stats.html`): live counts / total duration / total size, breakdowns by folder/channel/type, longest/shortest/newest, and most-watched via an additive `viewCount` (a dedicated once-per-watch-open ping, never per-progress/serve). **yt-dlp release-date + channel-avatar capture**: fixed-literal print-template widening (`upload_date`/`release_date`/`channel_thumbnail`) → validated/bounded (`YYYYMMDD`→epoch-ms; `https:`-only, credential-rejecting, length-capped avatar URL) → `db.metadata` via the real scan bridge, so the "Release date" sort works on yt-dlp items and captured **channel avatars now render as the folder icon** (sidebar/playlists, via read-time `/api/subscriptions/pins` enrichment). Also completed the shipped-in-v1.24.1 **subscription drag-reorder** by adding its missing CSS (grab cursor + drop indicators). Two-reviewer gate on the move re-key: no critical; path-confinement, the re-key invariant, yt-dlp injection safety, and avatar stored-XSS all independently probe-verified sound; a HIGH TOCTOU-overwrite race was found + fixed + re-confirmed by probe. 2076 tests green; disabled-module no-op preserved. Subscriptions-list avatar deferred to a follow-up (tracked). **Waves 4–7 remain.** _(shipped; round in progress)_
- [x] **UX Round — Wave 3 follow-up (v1.24.3)** — on-device polish after Dean's v1.24.2 pass. **Drag-and-drop reorder for PINNED channels**: the sidebar "Pinned" yt-dlp channel icons now reorder with the same desktop drag as folders/subscriptions — a new persisted pin `order` field (order-gap-safe `1+max` tail placement, mirroring the v1.24.1 subscription fix), a gated `POST /api/subscriptions/pins/reorder` route, client DnD reusing the shared `moveArrayItem`/`computeDropIndex` helpers + the existing `.sidebar-item` drag CSS, and the read-time pin avatar-enrichment refactored into one shared helper feeding both the GET and reorder responses. **Removed the per-card "Move to…" button** from the home grid — move stays on the watch page (the cleaner spot). Focused adversarial review (disabled-module no-op, `db.folders` invariant, order-gap, avatar-enrichment parity): SHIP, no defects; 2092 tests green. Two on-device findings backlogged for later waves: the "Release date" sort not visibly working, and yt-dlp display titles losing original emojis to filename sanitization. **Waves 4–7 remain.** _(shipped; round in progress)_
- [x] **UX Round — Wave 4: Player-adjacent (v1.24.4)** — fourth increment; player-adjacent UX (deliberately NOT the control bar). **Prev/Next flash fix (D1):** the persistent `<video>` host no longer blanks for ~¼s on SPA Prev/Next — root cause was the SPA router detaching the outgoing view before the new watch view's async `/api/config`+`/api/videos/:id` fetches reparented the host; a new pure `resolveWatchEntryReparentAction` helper now reparents the host synchronously (via the existing `expand(slot)`) in the same task as the router swap, so it's never detached. Reparenting model structurally unchanged. **Resume-prompt threshold + Setting (D2):** the "Resume at…" prompt now skips short saved progress — a configurable threshold (default 60s; `0` = always prompt) read live from `localStorage` so it applies with no page reload, with the control on the Setup page. **Docked resume (D3):** a pure `resolveDockedResumeAction` picks one deterministic behavior — while DOCKED the too-small overlay is suppressed and the video auto-resumes in the mini-player; FULL still prompts as before. Focused player-non-regression review: SHIP; closed one LOW at the gate (a `threshold=0` opt-in would have surfaced a pointless "Resume at 0:00" on never-watched videos — added a `savedProgress > 0` guard + test). 2117 tests green. **Waves 5–7 remain.** _(shipped; round in progress)_
- [x] **UX Round — Wave 4 fast-follow (v1.24.5)** — on-device fixes after Dean's v1.24.4 pass. **Mobile watch-page horizontal overflow** — a PRE-EXISTING bug (v1.24.4 changed no CSS; the T12 flash fix merely made the overflowing player visible during Prev/Next where it used to be blank, so it got noticed): the `.watch-actions` (★/Download/Delete) and `.uploader-info-panel`/`.uploader-profile` (channel name + Subscribed/Pinned) rows now `flex-wrap` + `min-width:0` so they no longer exceed the viewport — which removes the iOS fit-to-width that made the page "open slightly larger / need a zoom-out / get big for a second then resize." The seek bar `.pc-range` got `min-width:0` so the trailing `1×`/fullscreen/PiP buttons stop being pushed past the clipped container edge (a one-line contained overflow fix, no control-bar redesign). **Docked resume overlay** no longer rides into the mini-player oversized: `dock()` now dismisses an already-showing "Resume at…" prompt and auto-resumes directly in the mini-player — covering the "prompt up in FULL, then navigate away" case D3 didn't (its auto-resume only fired for a decision made while already docked) — plus a CSS belt so neither the resume nor the transcode overlay can ever render full-size in the 160/280px dock. 2121 tests green. **Waves 5–7 remain.** _(shipped; round in progress)_
- [x] **UX Round — Wave 4 fast-follow #2 (v1.24.6)** — fixed the inconsistent **per-page mobile zoom** (Dean, on-device): iOS Safari shrinks the whole page to fit whenever any element exceeds the viewport, and each page overflowed by a different amount — so the (position-)fixed bottom-nav icons rendered at different sizes on Home vs the watch page vs Subscriptions ("subs always most zoomed-out"), and navigation "jerked" as the zoom recomputed mid-transition. Root causes fixed at source: (1) the DOMINANT one — a **stale `.mobile-logo` favicon `<img>`** left behind on ONLY the subscriptions shell (an unstyled, uncapped 512px SVG that blew the subs header past the viewport) — deleted, restoring four-shell header parity (and the `mobile-wordmark` parity test now covers that 4th shell, which it wasn't before, so it can't regress); (2) `.sub-row-info` drops its 240px desktop min-width on mobile; (3) `.watch-prevnext` now `flex-wrap`s; (4) `.comment-input-box` gets `min-width:0`. Plus a shell-level `html { overflow-x: clip }` insurance guard (`clip`, so no scroll-container / `position:fixed` / safe-area side effects — the dock, bottom nav, and modals are unaffected) that pins every page and load-state to 1.0 zoom, so nothing can re-trigger the fit-to-width shrink and the navigation jerk is gone. Resolves the long-standing ROADMAP subscriptions-page base-zoom item. 2121 tests green. **Waves 5–7 remain.** _(shipped; round in progress)_
- [x] **UX Round — Wave 5: yt-dlp errors / cancel / subtitles (v1.24.7)** — the "see it · stop it · know why it failed" wave. **Per-item download failure attribution (A2):** yt-dlp's aggregate stderr is parsed and each failure attributed to the SPECIFIC video — which channel, which video, why ("members-only", "Video unavailable", geo, etc.) — CONFIDENTLY (a byte-for-byte id match against that cycle's own targeted survivor ids; an unattributable failure is surfaced, never guessed/misattributed), shown on the home status chip + the subscriptions page (`textContent`, control-char-stripped + length-capped + cookies-path-redacted, bounded buffer). **Cancel an in-progress download (A3):** a cancel control on the status chip SIGKILLs the one-shot job, marks it `cancelled` (a new terminal state that TTL-prunes), and reaps the partial — with a durable latch so a cancel can never be clobbered back to `error` by a late progress line, and the button only shows while actually cancellable. **Subtitles + closed captions (A6, the one approved control-bar exception):** grab subs on download (fixed-literal flags, no new dependency), a yt-dlp-INDEPENDENT `GET /api/subtitles/:id` serve route (on-the-fly `.srt`→`.vtt`, same path-confinement as the media serve, works with the module disabled), an additive `hasSubtitles` scan (no re-processing), and a `#cc-btn` that appears only when captions exist — `<track>`/`#cc-btn` byte-identical across all FIVE player-host shells. Plus the **Delete / Move button relabels**. Two-reviewer gate: no critical/security — attribution never-misattributes, the serve route has no traversal, and the disabled-module no-op all held under adversarial probing; fixed 3 correctness bugs at the gate (a cancel→`error` race, a subtitle-sidecar sibling mis-bind that could orphan the wrong `.vtt` on a move, and stale failures leaking across error→error cycles) + 2 UI gaps, all re-confirmed by probe. 2241 tests green. **NOTE:** this makes failures VISIBLE and downloads CANCELLABLE; the noisy aggregate "193 downloading · 0%" count itself (real per-item / queued-vs-active progress) is a distinct follow-on, still tracked under "Clearer download progress". **Waves 6–7 remain.** _(shipped; round in progress)_
- [x] **UX Round — Wave 5 follow-on: see + STOP subscription downloads (v1.24.8)** — from Dean's on-device pass (his 192 queued subscription downloads showed as opaque, uncancellable "Subscription download · queued · 0%" rows — v1.24.7's cancel was one-off-only). Now the download status chip is honest and controllable: every row is **labeled by channel** (channel `name` added to the status payload, so even the 191 queued rows are named); the aggregate reads **"1 downloading (47%) · 191 queued"** (percent averaged over ONLY actively-downloading items) instead of the misleading "192 · 0%"; the active row surfaces the video title + **N of M** + real %; and there are **Stop controls** — a global **Stop all** plus a per-row **Cancel** for subscription downloads (reusing v1.24.7's SIGKILL + durable-`cancelled`-latch machinery: a per-subscription child registry + a poll-bounded latch that also stops still-QUEUED subs from spawning, with the same race discipline as the one-shot path). Architecture reality surfaced: downloads are **serialized to one subscription at a time**, so "real % on every row" is impossible — only the single active row can show live progress. Two-reviewer gate (spawn-lifecycle + cancel/poll race): the race, latch-bounding, process-leak safety, stop-all completeness, and route/gate safety all probe-verified SOUND; caught + fixed a **cancel+delete ghost-resurrection** (the existence check now runs before the cancel-latch, so a deleted sub is never re-created as a no-TTL ghost row), a **`listing`-phase Cancel that faked success** (now honestly returns `{cancelled:false}` and the button is gated to queued/downloading), a **misleading persisted `error` status** for a cancelled sub (now `cancelled`), and a **"failed" vs "stopped"** wording mix-up — all re-confirmed by live probe. 2283 tests green. **NOTE:** Stop cancels the CURRENT backlog; the periodic poll re-checks at the next interval — cancel is deliberately NOT pause (use pause / manual poll to stay stopped). **Waves 6–7 remain.** _(shipped; round in progress)_
- [x] **QoL Wave — increment 1 (v1.25.0)** — first slice of a large quality-of-life round (7 items Dean batched). **New brand icon:** replaced the favicon + PWA/home-screen icons with the red play-button-with-file mark — multi-res `favicon.ico` (16/32/48 BMP-DIB), 192/512 PNGs, and an SVG, all on a white safe-zone background (text-logo update comes later). **Button consistency:** unified the action buttons into a glyph + short Title-Case-label family — the watch-page **Move** button gained an `icon-folder` glyph (matching its own folder-picker modal) and no longer wraps onto its own line on mobile; Download/Delete got descriptive `aria-label`s; the home **Shuffle/Rescan** buttons now render at full `.btn` size (a vestigial `btn-sm` + inline style had been shrinking only those two) with consistent casing. **iOS lock-screen Play fix:** wired the previously-**missing** `MediaSession` action handlers (`play`/`pause`/`seekto`/`seek±`, reusing the existing `skip()`) — the app registered ZERO, so iOS was guessing which element to control (the flaky lock-screen Play); bound once over the persistent `<video>`, no reparenting/control-bar change. Plus the dormant `cutoffDate` subscription schema (the foundation for the date-based download model landing next; existing subs migrate to their last-checked date so nothing is missed). 2308 tests green. _(shipped; QoL wave in progress — download re-architecture, native-mobile-controls, and metadata/release-date fixes next)_
- [x] **QoL Wave — increment 2: download re-architecture (v1.25.1)** — reworked how yt-dlp downloads are bounded and foldered, per Dean's decisions. **Date cutoff replaces the count cap:** every subscription now downloads everything published on/after a per-channel **cutoff date** (yt-dlp `--dateafter`) instead of a "last N videos" cap — new subs default to **yesterday** (new-only going forward), and the cutoff is editable per-channel via a date-picker in all three subscribe surfaces (add form, settings sheet, watch-page Subscribe modal). To keep the poll cost bounded, the cutoff **advances to "today" after each fully-successful poll** — so setting an old date does a one-time history pull, then the window narrows to "since the last check" (a partial/failed download never advances, so nothing is silently skipped). **All downloads land in per-channel folders:** one-off downloads now probe the channel (a metadata-only `--dump-json` spawn, off the request path and outside the download lock, 30s-bounded, falling back to an `Uncategorized` folder) and route into that channel's folder — a manual folder field remains as an optional override. **Retroactive migration:** a one-time, idempotent startup pass moves the existing **flat one-off pile** (root-level + the legacy `One-Off` folder only — subscription libraries are left untouched) into per-channel folders via the atomic id-re-key, preserving watch history + thumbnails + subtitles. Two-reviewer gate (QA + adversarial, with an adversarial re-confirm) — caught and fixed the unbounded-poll-cost blocker, a 5-min probe head-of-line-blocking the download FIFO, and an over-broad migration predicate that would have split subscription libraries; confirmed no data-loss, no path-escape, no injection. 2367 tests green. _(shipped)_
- [x] **QoL Wave — increment 3: native iOS controls for mobile video / PWA background-audio (v1.25.2)** — addresses Dean's confirmed on-device finding that background audio only survives via the **native iOS fullscreen player** (the inline custom-bar `<video>` gets suspended on background — the fundamental inline-web-video limitation), and lock-screen Play was flaky (the MediaSession handlers were wired in v1.25.0). The approved fix: mobile **video** now uses **native iOS controls** in FULL state (audio + desktop stay on the custom bar), so the native fullscreen/PiP button — and thus the reliable background-audio path — is actually reachable. Under the new `.native-controls` state the custom control bar + the mobile gesture layer (double-tap seek / tap-to-play / press-hold-2×) are suppressed so they can't fight the native strip (the exact failure mode that retired native controls in v1.22.1 — countered here by FULL-only scope + disabling the competing gesture layer). The background lifecycle no longer auto-pauses when the video is in **native fullscreen/PiP** (so iOS can sustain background audio), while inline (non-fullscreen) background behavior is byte-for-byte unchanged (inline video still pauses + saves position; audio still keeps playing). Two-reviewer gate (QA + adversarial, both probe-verified no reachable "no controls", "double controls", or "video won't pause/save on background" state) plus a hardening pass: the native-presentation guard is tied to the video element's own fullscreen identity (a latent won't-pause/save gap closed), progress is now checkpointed on background even when playback continues in native presentation (so a hard-kill resumes correctly), and two minor CSS/hygiene edges. 2402 tests green. **iOS background-audio itself + native-strip interactivity are on-device-only — Dean's pass is the arbiter.** _(shipped; the optional custom-vs-native mobile control-style setting remains a deferred roadmap item)_
- [x] **QoL Wave — increment 4: metadata + subtitle re-pull for existing downloads (v1.25.3)** — a **deliberate, user-triggered** backfill (a "Reheat metadata" button on the subscriptions page — never automatic; the thumbnail-backfill-regression lesson) that, for yt-dlp items FileTube already downloaded, re-fetches the accurate YouTube **upload/publish date** + **channel avatar** and grabs **subtitles**, all WITHOUT re-downloading the video. Per item: a two-pass yt-dlp spawn (`--dump-json --skip-download` for metadata; `--write-subs --write-auto-subs … --skip-download` with the output template pinned to the existing on-disk basename for the sidecar), serialized one-at-a-time through the shared download FIFO (never storms, never runs with a poll), cancelable, idempotent/resumable (a per-item done-marker, only set when the subtitle pass actually completed so a transient failure retries), disabled-module 404, and a strict no-op on boot/scan. Persistence writes `releaseDate`/`channelAvatarUrl`/`hasSubtitles` straight onto `db.metadata` with **no id re-key** (watch history/thumbnails/transcodes preserved) — which lights up the **release-date sort** (the sort code was already correct; it "didn't work" purely because existing items had no accurate date) and the **CC button** (the subtitle serve + `<track>` shipped in v1.24.7, so the sidecar landing is the whole subtitle ask — zero new player code). Release date is decoupled from the channel-URL validator so a good date is never dropped. Two-reviewer gate (QA + adversarial, probe-verified the three load-bearing guarantees: **never auto-runs, `-o` write stays confined, no re-key**) — caught + fixed a real `%(…)s` output-template re-expansion via the on-disk basename (`--windows-filenames` allows literal `%`, now escaped `%%`), a transient-subtitle-failure "done" marker that would strand subs, and hardened the never-auto-run structural lock. **Eligibility reality (important):** only items FileTube downloaded itself are re-pullable (their filename carries the `[<id>]` suffix that recovers the YouTube URL) — items imported from MeTube/elsewhere have no recoverable source and are reported as "not re-pullable"; the button shows the eligible/ineligible counts so the blast radius is explicit. **Known limitation (deferred):** a hand-named local file that coincidentally carries an 11-char `[bracket]` under the download root would be treated as a real video id (a foreign fetch) — contrived, by-design-consistent with the scan's id handling, tracked not fixed. 2486 tests green. **Whether re-pulled dates are accurate + captions render is Dean's on-device pass.** _(shipped)_
- [x] **QoL Wave — on-device fixes round (v1.25.4)** — six issues Dean caught testing v1.25.0–.3 on his iPhone (two big wins confirmed on-device first: **PWA video background audio "much better"** and **CC/subtitles working**). **(1) One-off download modal froze after "Done"** (had to force-quit the PWA) — root cause was a full-page `window.location.reload()` on completion that hung under load (the `POST /api/scan` 409s instantly when a scan's already running → `.then(reload)` fires → navigation stalls against the saturated server, starving the X handler + auto-close). Removed the reload (the server already rescans after a one-off); the modal now just closes. **(2) One-off percent frozen at 0% → Done** — the percent only reflects yt-dlp's brief byte-transfer phase (extraction/merge phases emit none) and the 2.5s poll under-samples it; now shows an honest phase label ("Preparing…/Downloading…") instead of a misleading frozen `0%`. **(3) No channel avatars anywhere** — a genuine bug: capture read `channel_thumbnail`, which does NOT exist on a yt-dlp per-video dict (verified live against yt-dlp 2026.07.04; every test had mocked the field). Fixed by fetching the avatar from the CHANNEL endpoint (`--dump-single-json --playlist-items 0`, selecting the square avatar over the banner) via a new `probeChannelAvatar` seam — populated on subscribe + self-healed on poll (throttled to 8/poll so it never hogs the download gate) + a serve-time item→subscription join for the watch page, with the dead field removed. Adversarial gate: no storm, no spawn injection, no wrong-avatar leak. **(4) Watch-page action buttons wrapped** (Move orphaned to a second row) → tightened to a single row on mobile. **(5) Shuffle icon rendered as a raw emoji** in non-emoji themes (a stray hardcoded `content:"\1F500"` outside the icon-set system) → now a themed Material-Symbol mask glyph like the others. **(6) Modal inputs zoomed in on tap (iOS)** — focusable fields under 16px trigger iOS auto-zoom; bumped the one-off/subscribe/settings/per-sub/add-subscription inputs to 16px. 2568 tests green. _(shipped)_
- [x] **QoL Wave — avatars round 2 + polish (v1.25.5)** — follow-ups after Dean's on-device avatar testing (the v1.25.4 avatar capture worked — his Reheat found **491** eligible items, confirming his library is real FileTube downloads). **(1) Pinned avatars rendered unbounded/huge** (the real `<img>` had zero CSS now that avatars actually load) → bounded to a small 18px uniform circle matching the pinned rows' existing icon box (sidebar + Playlists sheet). **(2) Watch-page action buttons still wrapped** (Move orphaned) → forced `flex-wrap: nowrap` on mobile so Download/Delete/Move stay on one row (the v1.25.4 tightening kept a `wrap` fallback that still triggered). **(3) "Refresh channel avatars" button** on the subscriptions page — a triggered batch (`POST /api/ytdlp/refresh-avatars`) that pulls ALL subscription avatars now instead of waiting for the throttled 8/poll self-heal; mirrors the reheat's serialized-`runExclusive`/single-flight/cancel/activity-progress/never-auto-run pattern (adversarially gated: no storm — one probe at a time, releases the gate between each). **(4) One-off downloads now pull the channel avatar too** — after a non-manual-folder one-off download, the channel's avatar is probed (from the download's OWN captured channel metadata, keyed on its videoId) and folded onto the item via the existing scan-time bridge, so a one-off of a non-subscribed channel gets its avatar on the watch page; off the response path, bounded, download-safe. **(5) Real avatars in the subscriptions-LIST rows + per-sub settings sheet** (the last wired surface still on the first-letter/`@` fallback — the F1 ROADMAP tail) → `createSubscriptionRow`/`buildSettingsSheet` render the real `<img>` when present, letter fallback otherwise. Adversarial gate confirmed F1 storm-boundedness + no-auto-run and F2 right-avatar-on-right-item + non-blocking + download-safety. 2630 tests green. _(shipped)_
- [x] **Hotfix — watch-page zoom regression (v1.25.6)** — v1.25.5's `.watch-actions { flex-wrap: nowrap }` (to keep the action buttons on one row) caused a whole-page iOS shrink-to-fit "zoom in/out" on BOTH the audio and video watch pages: the reasoning only counted the three buttons, but `.watch-actions`'s first child is the read-only `.star-rating` (five non-shrinking 20px stars + "N/5"), so the nowrap row's min-content (~380px) exceeded the phone viewport → horizontal overflow → iOS zooms the page rather than scrolling (the `html { overflow-x: clip }` guard doesn't stop iOS's preferred-width shrink). Fix: put Download/Delete/Move in their own `.watch-action-btns { flex-wrap: nowrap }` sub-group and REVERT the outer `.watch-actions` to `flex-wrap: wrap` — the row wraps the star-rating vs. the button group (never exceeds viewport), while the three buttons still stay single-row (viewport-width-independent, also preserving the v1.25.4 Move-orphan fix). Regression test asserts the outer row is never forced `nowrap`. _(shipped)_
- [x] **Per-channel avatar registry — fixes blank video-page avatars (v1.25.7)** — root-caused Dean's "avatar shows on the subs page but the video page is blank for older/@handle-subscribed and one-off channels": the serve-time video→sub avatar join keyed on an EXACT `channelUrl` string, and its channelId branch was dead code because `sub.channelId` was never stored — so an item captured as `/channel/UC…` never matched a subscription added as `@handle` = permanent blank (recent subs happened to work only when the URL forms coincided). Fix = a channelId-keyed **registry** (`db.ytdlp.channelAvatars[channelId]`, FIFO-capped, 90-day TTL): `probeChannelAvatar` now also returns the stable `channel_id`; every channel is registered ONCE (on subscribe, on any download completing, on poll self-heal, and via the "Refresh channel avatars" button — which now sweeps distinct channels from BOTH subscriptions AND all downloaded items, deduped so a channel with N items is probed once); and `resolveItemChannelAvatarUrl` now resolves by the stable `item.channelId → registry` before falling back to URL-match then the old sub-join. So the same icon now shows on the video page for ANY channel you've subscribed to or downloaded from, regardless of URL form or subscription recency — hit **Refresh channel avatars** once to backfill your library. Two-reviewer gate (QA + adversarial, probe-verified): the item-sweep is dedup-bounded (no storm — ~distinct-channels not per-item), the resolve can't serve a wrong avatar (exact channelId key, empties can't cross-match, every URL re-sanitized), the registry is bounded/non-destructive/write-once, no auto-run, no circular require. Fixed 3 gate findings (a mixed-id/no-id dedup double-probe, folded the poll self-heal into the registry, a null-guard). Residual (accepted): truly identity-less legacy/imported items with no channelId stay on the letter fallback. 2681 tests green. _(shipped)_
- [x] **Active-downloads chip reframe (v1.25.8)** — the corner download chip constantly read a noisy "192 queued" that Dean couldn't (and didn't want to) act on — it's really "how many subscriptions are waiting to be CHECKED" (the server marks every targeted sub `queued` before the serialized poll; most find nothing new and never download a byte; only ~1 is ever genuinely `downloading` at a time). Reframed into an ACTIVE-DOWNLOADS indicator (client-only, no server change — the server already exposes the active job's channel/video/percent): the chip now excludes merely-`queued`/`listing` subscriptions from its count, so it stays HIDDEN through the poll churn and only appears when something is genuinely `downloading` — showing that one item's channel + progress inline (`"<Channel> — 3 of 12 — 47%"`); the word "queued" no longer appears anywhere in the summary (regression-locked). Dropped the un-wanted per-sub Cancel + "Stop all subscription downloads" affordances (Dean pauses subs on the subscriptions page instead, and explicitly declined a queued-item cancel) while keeping the one-off's OWN Cancel and the sticky-error Retry/Dismiss. 2670 tests green. _(shipped)_
- [x] **Rotation no longer pauses a playing video (v1.25.9)** — player-lifecycle tranche #1. On-device: playing a video and rotating to landscape auto-enters iOS native fullscreen (keeps playing); rotating BACK to portrait called `webkitExitFullscreen()`, and iOS PAUSES as a side effect of exiting native fullscreen (no explicit `.pause()` in our code). Fix: in `onOrientationChange`'s landscape→portrait branch, capture `wasPlaying` before the exit and arm a `resumeAfterFsExit` flag; `onFsChange` consumes it on the actual fullscreen-exit signal and re-asserts `mediaPlayer.play()` (mirrors the existing reparent re-assert pattern). Strictly scoped to the rotate-driven exit — a deliberate user pause or a normal "Done" fullscreen exit is never force-resumed. **On-device arbiter (Dean):** iOS may reject a programmatic `play()` outside a user gesture (the `.catch` keeps it safe but resume isn't guaranteed) — his rotate-landscape-then-portrait pass while playing is the confirm. 2679 tests green. _(shipped)_ **UPDATE: v1.25.9's play()-re-assert did NOT work on-device — iOS rejects the programmatic resume (no user gesture). Superseded by v1.25.11's stay-fullscreen approach (don't auto-exit on portrait rotate).**
- [x] **Force-close-stops-audio (conservative) + gated lifecycle log + search-box zoom fix (v1.25.10)** — player-lifecycle tranche #2. **Force-close:** v1.25.2 made background video keep playing, but nothing STOPPED/released the audio session on a hard app-kill. Added a conservative teardown: a pure `shouldReleaseForLifecycleEvent(eventType, ctx)` returns true ONLY for a terminal `pagehide` with `event.persisted === false` (a genuine unload, not a bfcache-suspend) → then `pause()` + clear MediaSession metadata + `setPlaybackState('none')`, checkpointing progress first. STRICTLY additive — `shouldPauseForLifecycleEvent` is byte-for-byte unchanged, so ordinary backgrounding (visibilitychange→hidden, or any non-terminal pagehide) still keeps audio playing (no regression to the feature). **On-device arbiter (Dean):** the honest unknown is whether iOS fires `pagehide{persisted:false}` on a swipe-away kill at all (it may fire NO event → an OS artifact we can't reach) — so shipped a **gated on-screen lifecycle log**: visit `?debugLifecycle=1`, then background-vs-kill and read the overlay (localStorage-backed, survives the kill). **Also:** the header **search box** (`.search-input`, 13px on mobile) triggered iOS focus-auto-zoom on tap — bumped to 16px (same fix as the v1.25.4 modal/form inputs; the one input deliberately left out then). 2712 tests green. _(shipped)_
- [x] **Rotation re-fix — stay fullscreen instead of pausing (v1.25.11)** — v1.25.9's approach (re-assert `play()` after the portrait-rotate auto-exited fullscreen) did NOT work on-device: iOS rejects a programmatic `play()` without a user gesture, so it stayed paused. Per Dean's choice, switched to the reliable behavior: **don't auto-exit fullscreen on the landscape→portrait rotate at all** — the video stays in the iOS native fullscreen player (still playing), and the user taps the native Done/X to return to inline (a real gesture, so iOS keeps it playing on exit). Removed the dead v1.25.9 resume machinery (`resumeAfterFsExit` flag, `shouldResumeAfterOrientationFsExit` helper, the `onFsChange` re-assert). Portrait→landscape still auto-enters fullscreen (guarded against double-enter); `onFsChange` still resets `autoFullscreen` on a real exit. YouTube-style: rotate to fullscreen, tap Done to exit. 2710 tests green. _(shipped)_
- [x] **Transparent icon backgrounds (v1.28.1)** — Dean: the favicon showed a baked-in WHITE box in browser tabs / dark UIs. Diagnosis: every icon asset was opaque white — both PWA PNGs, all three sizes inside `favicon.ico`, and `favicon.svg` itself (a raster in disguise: an `<svg><image>` wrapper around a white-backed 512px PNG — the glossy play-button art exists ONLY as that raster; `assets/images/filetube_icon.svg` + `generate-pwa-icons.js` are the OLD flat design and would clobber the glossy art if re-run). Fix: new committed one-shot `scripts/strip-icon-background.js` (pure node, reuses the repo's own PNG builder) — **edge-connected flood fill** (the white page glyph in the button's center is enclosed by red so the fill can never reach it) + rim **un-compositing from white** (`a = 1 - min(g,b)/255` recovers alpha+true color for both red edges and gray shadows — no white halo on dark tabs), then regenerates `icon-512.png`, `icon-192.png` (box-downscaled premultiplied), the PNG inside `favicon.svg`, and `favicon.ico` (16/32/48 32bpp BMP entries with REAL alpha, same structure the pwa-icons tests lock). **Deliberate exception:** a new dedicated `public/icons/apple-touch-icon.png` PRESERVES the opaque white art and all 5 shells' `apple-touch-icon` link now points at it — iOS composites home-screen-icon transparency onto BLACK, so transparent there would have been a regression, not a fix. 4 new regression locks (transparent corners in every tab-facing asset + the apple-touch-icon opaque ON PURPOSE). 3229 tests green. _(shipped)_
- [x] **Share-sheet / iOS-Shortcut one-off download fix (v1.28.0)** — Dean's share-sheet Shortcut always failed with `channelUrl contains whitespace or disallowed characters` for BOTH Shorts and regular videos, while the SAME link worked in the in-app one-off form. Investigation (real payloads against the real endpoint) found THREE stacked causes: the spawn-guard's `FORBIDDEN_CHARS` rejecting glued quote characters (the classic Shortcut mistake of typing quotes around the JSON variable) and the `&` in any two-param share URL (`&feature=share`, `&t=`); `/shorts/` never recognized as a single video in ANY path; and malformed/oversized bodies rendering an HTML stack page (path disclosure) instead of a JSON error. **Fix — a normalization pre-step in FRONT of the byte-identical injection guard** (`validateChannelUrl`, `lib/ytdlp/url.js`): strip wrapping/glued punctuation (quotes/brackets/parens, curly quotes) both ends, extract the first `http(s)` URL from mixed text (case-insensitive), truncate at the first backslash, strip the `#` fragment, and rebuild the query allowlist-style (keep only `v`, or `list` on a `/playlist` path, else drop the query — so no `&` ever reaches FORBIDDEN_CHARS). The guard chain itself is UNCHANGED and runs on the normalized candidate; the spawn target is still always `buildWatchUrl(<charset-bounded id>)`, never the user string. **Plus:** `/shorts/`, `/live/`, `/embed/` recognized as single videos — gated behind `allowSingleVideoShapes` so ONLY the explicit one-off path accepts them (never subscription-add), length-capped, `videoseries` excluded; **self-diagnosing errors** that name the offending character; `text/plain` bodies accepted and a shared body-parser-error mapper (`lib/bodyParserErrors.js`) turns oversized/malformed JSON *and* text bodies into JSON 4xx (no more HTML stack page on either surface). Two-reviewer spawn-guard gate — 2 QA + 2 adversarial, unanimous APPROVE; the guard held against ~600k differential+fuzz hostile inputs with ZERO smuggled to the argv; FORBIDDEN_CHARS byte-identical (source-locked); SDE correctly refused a spec instruction that would have regressed the `; rm -rf /` rejection. 9 findings (all hardening/consistency, none security), all fixed. 3225 tests green (+67 across the release). **Dean's Shortcut needs NO change** — same POST, same fields; regular videos AND Shorts now work, glued-quote payloads self-normalize. _(shipped)_
- [x] **Pre-pause candidate bridge + service worker REMOVED (v1.27.2)** — Dean's v1.27.1 re-test: fullscreen background play STILL broken (the v1.27.1 prime/MediaSession theory was wrong or incomplete), and his first overlay screenshot was decisive — every `vis=hidden` arrived with `playing=false` and ZERO `bgAudio:*` lines: **iOS system-pauses the inline video BEFORE the visibility event, and dispatches that pause while the page still reads 'visible'** — so BOTH v1.27.1 handoff triggers were structurally blind. **(1) The candidate bridge:** an unsuppressed, otherwise-eligible pause arriving while 'visible' ARMS a 1.5s candidate (`bgAudio:candidate`); `visibilitychangeHidden` CONSUMES it (only that event — a bfcache pagehide/freeze zeroes without attempting) and attempts the handoff from the already-paused video. **User-intent guards (two-reviewer gate — both reviewers independently found the BLOCKER):** a pause following a recent in-page gesture (≤800ms) NEVER arms — the gesture stamp (host-level capture touchstart/mousedown/click + togglePlayPause, spacebar unified through it) is the signal that distinguishes every USER pause (custom bar, native-controls tap, art tap, dock, keyboard) from an iOS SYSTEM pause, killing the pause-then-quick-lock-resumes-audio false positive; an ENDED video never arms (HTML fires 'pause' before 'ended' — without this, locking right as a video finished restarted its audio from 0:00; the completion cascade also clears the candidate). False negatives (missed handoffs) deliberately preferred over intent violations. **(2) SERVICE WORKER REMOVED ENTIRELY (Dean's call: "let's get rid of it"):** research surfaced documented WebKit behavior invalidating v1.26.4's core assumption — media byte-range requests DISPATCH through a registered SW's fetch handler even when it never calls respondWith (WebKit #184447: a pure pass-through SW broke mp4 playback), and iOS suspends SW processes on lock, making the SW the co-prime suspect for the fullscreen regression (Dean is on HTTPS via reverse proxy, so his SW was LIVE). `sw.js`/`offline.html` deleted; boot now ACTIVELY UNREGISTERS any previously-installed SW (existing installs shed it automatically on first visit); rationale + WebKit reference documented at the cleanup site; removal locked by tests. **(3) Diagnostics completed:** one `bgAudio:` line per lock event even when nothing is attempted (`not-mobile`/`native-presentation`/`state-*`/`not-playing-no-candidate`), arm line on EVERY mobile video load (`status-*` / `setting-off` / `setting-unknown-fetch-failed`), `vetoed-user-gesture` visibility. Implemented by the ORCHESTRATOR directly (Dean-approved after subagent permission blocks); two-reviewer gate with zero-deference instructions → 1 BLOCKER + 1 real bug (ended restart) + 2 hardenings, all fixed. 3158 tests green. **DEAN'S DECISIVE TEST:** pull → ① fullscreen + lock, checkbox OFF (SW is auto-gone — if fullscreen background works again, the SW was the killer; if not, the hunt continues with a clean board) ② checkbox ON + debug overlay ON → play inline → lock → the overlay now names the outcome every time (`candidate`→`handoff`→`ok`, or the exact skip/veto/fail reason). _(shipped — awaiting on-device arbiter)_
- [x] **v1.27.0 regression fixes + handoff diagnostics + PWA debug toggle (v1.27.1)** — Dean's first on-device pass found v1.27.0's background-audio never engaged AND — worse — **fullscreen-native background play (the v1.25.2 headline) regressed**, even with the setting OFF. Investigation (proven in code; the iOS-side effect is the one inference his re-test confirms): the v1.27.0 gesture-prime played a muted silent WAV on the hidden sidecar element on the FIRST touch of any video regardless of the setting, and the sidecar's play/pause listeners were UNGATED — so the prime's own play→pause cycle set MediaSession `playbackState='paused'` AFTER the video set 'playing' (its promise always resolves last), poisoning the now-playing state iOS consults for fullscreen background continuation, and also killing the 4s progress saver mid-playback. **Fixes:** (A) all four sidecar listeners gated on `activeMediaElement() === bgAudioEl`; (B) the prime now requires the setting ON (deliberately reverses the "always-prime" call — the race it defended against is strictly cheaper than breaking default installs); (C) **first-watch handoff was structurally impossible** (sidecar status snapshotted ONCE at load; never refreshed after extraction finished) → bounded prepare-audio re-poll (5s × 12, generation-guarded, timer cleared on teardown); (D) a second handoff trigger for iOS's system-pause-BEFORE-visibilitychange ordering (`'pause'` event + `visibilityState==='hidden'`, consume-once suppress flag around every self-inflicted pause INCLUDING the lock-screen MediaSession Pause handler — both gate reviewers independently caught that an explicit lock-screen Pause could otherwise trigger an unwanted un-pause). **Diagnostics:** every handoff decision now records into the lifecycle overlay (`bgAudio:arm/skip(reason)/prime/handoff(trigger)/ok/fail(err)/swapback`, detail field, cap 30, corrupt-storage self-heal — the overlay could previously brick silently), and a **Settings toggle "Show lifecycle debug log"** finally makes the overlay enableable from inside the installed PWA (the `?debugLifecycle=1` URL was unreachable there — no address bar; Safari-tab storage is separate). Two-reviewer gate → 1 MAJOR (the lock-screen-pause trap, found independently by both) + 6 more, all fixed. 3164 tests green (+54). **DEAN'S RE-TEST LOOP:** ① fullscreen a video → minimize → should keep playing again (no settings needed — this confirms the regression fix) ② Settings → enable BOTH "Background audio for video" and "Show lifecycle debug log" → play inline → lock → read the green overlay (or report it): `bgAudio:ok` = works; `fail:NotAllowedError` = the iOS gesture wall (next iteration target); `skip:status-pending` = extraction latency (wait ~1min on first watch, retry). _(shipped — awaiting on-device arbiter)_
- [x] **Background audio for video — EXPERIMENTAL, default OFF (v1.27.0)** — the branch capstone: YouTube-Premium-style background play for inline mobile VIDEO, built without waiting on the force-close on-device verification by containing the risk behind an opt-in setting. **Server:** an audio-extract pipeline mirroring the transcode pattern exactly — `audioPath(id)` `.m4a` sidecars in the SAME LRU/age-swept cache (predicates widened; live-watch protection covers actively-streamed sidecars; `.tmp.m4a` orphan cleanup; deletion now eagerly clears `audioStatus` so a stale 'ready' can't defeat the prewarm — gate finding), a second independent single-worker FFmpeg queue (arg-array spawn, `-vn` AAC 160k, atomic rename; up to 2 concurrent FFmpeg total — documented in ARCHITECTURE.md), `GET /audio/:id` (Range-serving via a `sendRangeable` helper factored from `/video/:id` — **proven byte-identical** against a booted pre-refactor server; malformed-Range 416 guard added, fixing a pre-existing 500+stack-trace leak on BOTH routes), `POST /api/videos/:id/prepare-audio` prewarm (validated, dedupe-bounded, heals stale statuses). **Client:** a hidden `<audio>` element riding the persistent host + a pure state machine (`INLINE_VIDEO → HANDING_OFF → BACKGROUND_AUDIO → SWAP_BACK`) hooked into the exact branch where mobile inline video pauses today; `activeMediaElement()` indirection retargets MediaSession handlers/position/skip/progress-saver; force-close teardown kills BOTH elements (v1.25.10 contract); mutual exclusion with the native-fullscreen path is structural; gesture-prime uses a 52-byte silent data-URI WAV (element-level iOS blessing survives the src swap) so a DISABLED install provably never requests `/audio/` or enqueues extraction (gate follow-up); `ended`-while-backgrounded runs the shared completion cascade (loop replays via the audio element; autoplay-next defers to foreground — iOS would suspend a mid-flight SPA navigation); every failure path degrades to today's plain pause, never breaks playback. Two-reviewer gate (adversarial: spawn-injection/endpoint-abuse/hostile-cache/range-matrix/state-interleavings — NO majors; QA: 2 MAJORs + 5 more) → 9 findings, all fixed. 3110 tests green (+118 across the release). **ON-DEVICE CHECKLIST (Dean):** ① Settings → enable "Background audio for video (experimental)" ② play a video inline → lock or app-switch → audio should CONTINUE within a beat ③ return → video resumes in sync ④ known fragilities: first-ever watch of an item may not hand off (sidecar still extracting — the second watch will); if your very first interaction is via lock-screen controls the gesture-prime may not have run (falls back to pause; next cycle works); `?debugLifecycle=1` overlay now reports the ACTIVE element truthfully ⑤ force-close while backgrounded-playing → audio should stop (the v1.25.10 teardown covers the swap element — this doubles as the deferred kill-switch verification). _(shipped — awaiting on-device arbiter)_
- [x] **Loading/empty/error states + offline SW + audio-CC freeze fix + jsdom shell smoke harness (v1.26.4)** — Dean's picked polish items plus two on-device follow-ups. **(1) No more blank-then-pop:** skeleton cards/rows (shimmer, reduced-motion-aware, real-card box model = zero shift) paint before the first fetch on home + subscriptions; styled `.empty-state`/`.error-state` cards with Retry replace raw red text (home, subs); the Playlists sheet finally has a zero-pins message — gated on _provable_ module-enabled (`r.ok` threading) so a disabled install leaks no new UI. **(2) Minimal offline service worker** (`public/sw.js`, network-first): NEVER intercepts `/api|/video|/audio|/thumbnail`/non-GET/cross-origin; static assets network-first with `event.waitUntil`'d cache writes (gate: status 200 + basic); **navigations are never cached** — offline navigation serves a self-contained `offline.html` card, which kills the unbounded per-URL cache-growth class outright; versioned `filetube-shell-v2` cache, activate scoped to `filetube-shell-*`, offline-card precache retried in activate, `skipWaiting`+`claim`. NOTE for on-device: SW requires a secure context — on plain `http://<LAN-IP>` iOS exposes no serviceWorker and the feature silently no-ops (environment, not regression). **(3) Audio-CC freeze fixed (Dean's report: first line renders, never advances):** root cause is a documented iOS WebKit bug — Safari does not fire `cuechange` for `mode='hidden'` tracks during playback on recent iPhones (Apple Dev Forums #704536; unfixed) and the v1.26.1 overlay had no other data path. Fix is defensive by construction: a `timeupdate`-driven render reading `activeCues` fresh each tick (~4×/s, zero reliance on `cuechange`), dual element+TextTrack `cuechange` binding (survives track-object replacement), and an idempotent string-compare render making the redundancy free; teardown/close reset locked by regression tests. **(4) The "dropped balls" remedy:** `test/integration/shell-smoke.test.js` (jsdom devDependency) boots all five shells with their REAL scripts and fails on any uncaught load-time error + asserts per-shell boot signals — proven against the v1.26.0 const collision, and it caught a brand-new real bug during its own construction (a premature `renderIconPicker()` call on direct `/setup.html` loads threw and aborted the whole boot handler — fixed with a lossless guard). Two-reviewer gate (QA + adversarial executing the real sw.js in a mock SW scope, 39 assertions + hostile URL matrix) → 1 MAJOR (fire-and-forget cache writes) + 7 minors, all fixed. 2992 tests green (~60 new). _(shipped)_
- [x] **HOTFIX — subscriptions page rendered EMPTY (v1.26.3)** — Dean's on-device report ("subs not showing in the subs tab, pins fine, videos fine") root-caused to a **fatal cross-file global collision shipped in v1.26.0**: the F4 review fix deliberately duplicated `const ACTIVE_ENTRY_STALE_MS` into BOTH `public/js/common.js` and `lib/ytdlp/client/subscriptions.js` ("duplicated, not shared") — but classic `<script>` tags share ONE global lexical scope, so on the one page that loads both (`/subscriptions`) the second `const` is a SyntaxError at script instantiation and **the entire subscriptions.js never ran**: no `registerView`, no fetch, no rows, no error message (the error-rendering code was in the dead script). Everything else was untouched (index.html doesn't load subscriptions.js; server-side polling/downloads kept working — hence "still published"). Fix: renamed the subs-side const (`SUBS_ACTIVE_ENTRY_STALE_MS`; export key kept stable for tests). **Systemic kill:** new `test/unit/shell-script-global-collisions.test.js` compiles every shell's full script set in ONE shared scope (vm.Script, compile-only) — any future cross-file top-level `const`/`let`/`class` collision fails `npm test` with the shell named; verified it catches the shipped v1.26.2 code. (Nothing caught this before: eslint + `node --check` are per-file, unit tests `require()` into isolated module scopes, and the duplicate `function` declarations alongside were legal — only the `const` was fatal.) This is the multi-shell/duplicated-helper fragility pattern from this branch's audit biting for real: "deliberately duplicated" helpers are only safe when they're `function`/`var`, never lexical. Affected v1.26.0→v1.26.2. Broke during: v1.26.0's gate fix pass. 2929 tests green (5 new). _(shipped)_
- [x] **CSS polish wave — fonts, layout stability, input-zoom kill, transitions, PWA chrome (v1.26.2)** — polish-branch punchlist #4 and #5 plus Dean's picked systemic/polish items. **(1) Subs font unified:** `.sub-row-name`/`.sub-sheet-name` dropped their `--mono-font` (Courier) for the app font — the last divergent text on the subs page. **(2) Reheat/Rescan "trailing line" fixed at the root:** the status spans lived INSIDE the header's flex-wrap button row and started empty — populating them re-wrapped the row (a text line appearing "between" the buttons); they now have a dedicated reserved full-width status row (line-height 1.25 × 12px = exact 15px reserve), and `#rescan-library-btn` got min-width so the "Scanning..." label swap can't shift its row. **(3) The iOS input-zoom class KILLED systemically:** a global mobile `input, select, textarea { font-size: 16px }` rule + explicit overrides for the class-specificity stragglers (`.comment-input-box`, `.sort-select`, `.folder-name-input`) + removed the inline 12px that beat all CSS (setup.js folder-name input) — no more per-surface whack-a-mole; audit-confirmed every focusable control ≥16px on mobile incl. the unclassed Move-modal select. **(4) Sheet/modal transitions:** shared `openOverlay`/`closeOverlayThen` helpers (two-step reveal, transitionend+`transitioncancel`+timeout close, `prefers-reduced-motion` collapse) animate the Playlists sheet, subs settings sheet, confirm modal, and Move modal (slide-up sheets, fade+scale modals) instead of teleporting. QA gate caught a BLOCKER (reopening the persistent Playlists sheet within ~300ms of closing let the stale close-timer hide it — fixed with a per-element WeakMap generation counter that cancels pending closes) and a MAJOR (Confirm stayed clickable during the close fade → a double-tap could fire performMediaDelete TWICE; the pre-wave synchronous teardown made that impossible — fixed with settled/busy guards + disabled buttons + `.modal-closing { pointer-events:none }`, with a `reenable` path so a failed Move can be retried). **(5) PWA chrome:** `apple-mobile-web-app-status-bar-style` meta on all 5 shells (chose `default` over `black-translucent` — the latter forces white status-bar icons, illegible on the light era themes), Roboto woff2 preload on all 5 shells (kills the font-swap reflow), toast honors the home-indicator safe area. 2924 tests green (51 new). _(shipped)_
- [x] **Dimension-aware player + audio caption overlay (v1.26.1)** — polish-branch punchlist #2 and #3. **Shorts size-jump killed at the root:** the player box was hardcoded `aspect-ratio: 16/9` and nothing in the system knew a video's real dimensions (ffprobe never requested width/height; the DB stored none) — the ~1s shift was the `.native-controls` geometry override + transcode swap reflowing after paint. Now: ffprobe captures `width`/`height` at scan for NEW/changed items only (**rotation-aware** — `stream_side_data=rotation` swaps coded dims when |rotation|%180==90, so phone-shot portrait files are right; additive, hard-gated regression test proves ZERO re-probe of existing items on upgrade — thumbnail-backfill lesson honored); legacy items lazily self-heal via a validated no-clobber `POST /api/videos/:id/dimensions` fired from `loadedmetadata` (load-generation-guarded against fast prev/next races; primitive-only input guard; the scan's final merge carries fresh dims forward mirroring the FR3.3 `transcodeStatus` pattern so a mid-scan backfill can't be silently reverted — gate finding); the client reserves the TRUE aspect via `--media-aspect` BEFORE src is set (portrait clamped ~78vh on mobile; dock pinned 16/9; the `.native-controls` intrinsic-size override removed entirely — it was itself a jump source). **Audio CC overlay (Dean's choice over the native-audio pivot):** iOS can't paint native `<track>` cues over the transparent audio-mode video box, so audio CC now uses `track.mode='hidden'` + a `cuechange`-driven JS-created overlay (active cues → VTT-tag-stripped → textContent-only) positioned above the control strip in all three views (in-slot 40/44px, dock 26px, expanded + safe-area); the video CC path is byte-identical. Two-reviewer gate (QA + adversarial with live-server fuzzing — prototype pollution, coercion, traversal, XSS cues, concurrency all defended) → 1 MAJOR (scan-merge clobber) + rotation completeness + 2 nits, all fixed. 2873 tests green (82 new). _(shipped)_
- [x] **Download progress with real motion (v1.26.0)** — polish-branch punchlist #1 (Dean's top annoyance: a download went queued → preparing → sat frozen → done). Root causes found by tracing the whole pipeline: the server parsed EVERY yt-dlp percent line into the activity map with no throttling — but the clients sampled it at 2.5s/5s while the byte-transfer window (the only percent-producing phase) often finishes in under one interval, and the extraction/merge phases emit no percent at all and rendered as static text over a bar with zero animation. Fix: **(1) adaptive fast poll** (~700ms while a download is genuinely active — with a 10s `updatedAt` staleness cutoff so a wedged yt-dlp can't hold clients at 700ms for hours — base 2.5s/5s cadence when idle, failure backoff floored at base so errors never retry from the fast cadence); **(2) postprocess phase parsing** (`[Merger]`/`[Fixup*]` → "Merging…", `[ExtractAudio]`/`[VideoConvertor]`/`[VideoRemuxer]` → "Converting…") so the silent post-download window says what it's doing; **(3) sticky-percent fixes** — a new stream's `Destination:` resets percent (no more frozen-at-100% between video and audio streams), and every non-percent branch + cycle-start/terminal writes explicitly clear `phase` (shallow-merge semantics; the two-reviewer gate demonstrated stale "Merging…" leaking across items AND into the next subscription cycle without this); **(4) a real progress bar in the one-off modal** (was text-only) + width transitions and an animated barber-pole `.indeterminate` state for percent-less phases (`prefers-reduced-motion` honored); **(5) in-place DOM updates** for the chip panel + one-shot rows (keyed row reuse — the gate proved the old rebuild-every-tick killed the CSS transition entirely and churned the Cancel button under the user's finger); **(6) hardening** — `DESTINATION_RE` anchored to line start (hostile-title probe), hidden-tab guard on the modal poller, real backoff for the modal poll. Verified against the real yt-dlp binary (v2026.07.04, real downloads). Two-reviewer gate (QA + adversarial with runnable probes) → 7 findings, all fixed. 2791 tests green (81 new). _(shipped)_
