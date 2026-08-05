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
- [ ] **"Playlists" label clarify** — Dean asked for the Playlists control to show a word; the bottom-nav Playlists button already renders a "Playlists" text label under its icon. Confirm with Dean whether he meant that control (already labelled) or a different affordance before changing anything. _(clarify)_
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

- [ ] **Multi-user + permission-gated deletion (finally adds auth)** — FileTube currently has **NO AUTH** (LAN-only by design; anyone who can reach it can download / delete / change config). Dean wants **multi-user accounts** where destructive actions — especially **deletion** (and likely config changes / downloads) — are **gated behind certain accounts / roles**. This is the long-standing security gap made real: login/session, a permission model (e.g. admin vs. viewer), and fail-safe gating so a non-privileged account can browse + play but never delete. Significant, foundational — scope carefully (session store, password hashing, migration for existing single-user installs, and keep the current LAN-only no-auth mode available as an explicit option so nobody's existing setup breaks). _(Dean)_

### 🧪 Testing / infra

- [x] **Broaden core test coverage** — ✅ MAJOR PASS SHIPPED v1.33.0 ("eat our vegetables"): the transcode EXECUTION path finally tested (stub-ffmpeg-on-PATH harness — CI has no ffmpeg, which is why it was never covered): lazy 503 → queue drain → atomic finalize → Range, corrupt-source failure, live pipe, download bypass, reconcileTranscode healing; plus config validation, thumbnail fallback/escaping, cache-clear in-flight protection. Remaining thin spots (settings side-effect matrix, subtitles endpoint wiring) tracked as ordinary follow-ups. — the core app's scan/config/transcode logic + HTTP endpoints have thinner coverage than the yt-dlp module. Backfill unit + smoke tests. _(partially progressed)_

### 🧹 Tech-debt (see [docs/exec-plans/tech-debt-tracker.md](docs/exec-plans/tech-debt-tracker.md))

- [x] **yt-dlp prune/mount-loss deep redesign** (#10) — ✅ PARTIALLY CLOSED v1.33.0: Dean's Option C shipped globally (`detectVanishedRoots` — empty-but-present mountpoint = unmount signature, protect don't reap; escape hatch = remove the folder from Settings). Cases 2–3 (changed download-dir orphaning, disabled+transient unmount) remain in the tracker. — treat "a root's entire content vanished at once" as an unmount signature globally so an empty-but-present mountpoint can't reap library entries/watch-progress.
- [ ] **yt-dlp narrow-config edges** (#12–14) — dedup-collapse discards a duplicate alias's ephemeral progress; download-dir == a mapped folder loses its mount-loss row; cosmetic title-clean when the download dir is an ancestor of a library folder. Mitigated by "use a dedicated download dir."
- [ ] **v1.20.0 channel-capture edges** (#16–18) — a manually-named `[<id>].mp4` under the download root can absorb an unconsumed channel identity; the subscription fallback records identity for failed-download survivors; `channelDir` discloses an absolute server path. All LOW/bounded.
- [ ] **v1.22.0 FR-2 folder-match hardening** — the creator re-association matches an item's parent dir to a subscription's `channelDir` by exact string equality with neither side `realpath`-resolved, so a symlinked download dir silently no-ops the backfill (safe under the never-overwrite guard — a missed heal, not corruption); and two subscription names that sanitize to the same folder can first-match mis-attribute. Both LOW. _(adversarial-review follow-up, v1.22.0)_

## Shipped

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

**Disclosed and pending:** Stop B - Dean's per-scene review of the visible deltas against before/after captures (packet at docs/exec-plans/active/tokens-tier3-step3-stopB.md; before-state frozen in the immutable v1.57.0 image; per-site rejection flips revert individually without reopening batches) - plus his three manual gate-blocker shots (13-toast, 04-resume, 10-audio-expanded). Timing deltas (3e) are invisible to frozen captures and are judged on-device. The remaining 110 burn-down residue is Tier 4 scope (ghost-red, mono-font, z re-ladder, R7 radii, --thumbnail-bg definition) plus deliberate exemptions. Dual-Node of record: 5320/5320 on v22.23.1 AND v24.14.0, run sequentially with reviewers idle.

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
- **Disclosed:** one non-reproducing Node 22 full-suite failure of the documented thumbnail-sendFile flake (standalone 6/6); sub-half-second chapters refuse to loop (epsilon guard); tech-debt #40 filed for a pre-existing, unrelated seekto/liveMode basis limitation the QA seat spotted while verifying. Also on this branch: the v1.42.0 universal-downloads design plan, taken through two adversarial design-review rounds to APPROVE (see docs/exec-plans/active/v1.42.0-universal-oneoffs.md).

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
- [x] **UX Round — Wave 1 (v1.24.0)** — first increment of the in-progress v1.24 UX round: real multi-res `favicon.ico` byte-identical across all shells; more elegant (less blocky) buttons per era; per-view **item-count** badge + a **videos/audio/both** format toggle + an available **"Release date"** sort option; **local-file release-date capture** (additive scan backfill, hard-tested zero re-processing); consistent deterministic uploader/comment **avatars**; the **Polite and Unhinged** mock commenter (87% polite / 10% unhinged / 3% conspiracy). Player.js untouched. **Waves 2–7 remain** (subscriptions · download-failure visibility + cancel + poll-timing · multi-site one-off URLs · reconcile one-offs · subtitles/CC · move-files · stats · release-date yt-dlp capture · DnD reorder · pin-from-video · player-adjacent + mobile-polish fixes) — fully planned in `docs/exec-plans/active/2026-07-09-v1.24-ux-round.md`, resume at Wave 2. _(shipped; round in progress)_
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
