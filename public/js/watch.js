// FileTube Watch Page Logic

document.addEventListener('DOMContentLoaded', () => {
  const mediaPlayer = document.getElementById('media-player');
  const playerWrapper = document.getElementById('player-wrapper');
  const audioVisualizer = document.getElementById('audio-visualizer');
  const vinylDisc = document.getElementById('vinyl-disc');
  const audioVisualTitle = document.getElementById('audio-visual-title');
  const audioVisualFolder = document.getElementById('audio-visual-folder');

  const skipControls = document.getElementById('skip-controls');
  const skipBackBtn = document.getElementById('skip-back-btn');
  const skipFwdBtn = document.getElementById('skip-fwd-btn');
  const skipRippleLeft = document.getElementById('skip-ripple-left');
  const skipRippleRight = document.getElementById('skip-ripple-right');

  const transcodeOverlay = document.getElementById('transcode-overlay');
  const transcodeSpinner = document.getElementById('transcode-spinner');
  const transcodeTitle = document.getElementById('transcode-title');
  const transcodeMessage = document.getElementById('transcode-message');

  const resumeOverlay = document.getElementById('resume-overlay');
  const resumeTimeStr = document.getElementById('resume-time-str');
  const resumeYesBtn = document.getElementById('resume-yes-btn');
  const resumeNoBtn = document.getElementById('resume-no-btn');

  const mediaTitle = document.getElementById('media-title');
  const viewsCount = document.getElementById('views-count');
  const deleteBtn = document.getElementById('delete-media-btn');
  const uploaderAvatar = document.getElementById('uploader-avatar-letter');
  const uploaderChannelName = document.getElementById('uploader-channel-name');
  const uploaderSubsCount = document.getElementById('uploader-subs-count');
  
  const addedDateText = document.getElementById('added-date-text');
  const fileSizeText = document.getElementById('file-size-text');
  const fileTypeText = document.getElementById('file-type-text');
  const filePathText = document.getElementById('file-path-text');
  
  const descriptionParagraph = document.getElementById('description-paragraph');
  const expandDescBtn = document.getElementById('expand-desc-btn');
  
  const commentCountBadge = document.getElementById('comment-count-badge');
  const commentsContainer = document.getElementById('comments-container');
  const newCommentText = document.getElementById('new-comment-text');
  const postCommentBtn = document.getElementById('post-comment-btn');
  
  const starRatingControl = document.getElementById('star-rating-control');
  const ratingText = document.getElementById('rating-text');
  
  const sidebarFoldersList = document.getElementById('sidebar-folders-list');
  const relatedContainer = document.getElementById('related-files-container');
  
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');

  // Parse media ID
  const urlParams = new URLSearchParams(window.location.search);
  const mediaId = urlParams.get('v');

  if (!mediaId) {
    window.location.href = '/';
    return;
  }

  let mediaData = null;
  let savedProgress = 0;
  let progressInterval = null;
  let awaitingTranscode = false;
  let folderSettings = {};   // { "<path>": { name, hidden } } — for channel display name
  let liveMode = false;      // desktop AVI: live transcode (seek = restart stream)
  let liveOffset = 0;        // seconds into the source that the current live stream started at

  // Absolute position in the source, accounting for live-stream restart offsets.
  function currentAbsTime() {
    return liveMode ? liveOffset + (mediaPlayer.currentTime || 0) : mediaPlayer.currentTime;
  }

  // (Re)start a desktop live transcode at t seconds into the source.
  function startLiveStream(t, autoplay) {
    liveOffset = Math.max(0, Math.floor(t || 0));
    mediaPlayer.style.display = 'block';
    mediaPlayer.src = `/video/${mediaId}?live=1&t=${liveOffset}`;
    mediaPlayer.load();
    if (autoplay) mediaPlayer.play().catch(() => {});
  }

  // Narrow (phone) viewport — used to tailor mobile-only player behavior.
  function isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  // Initialize page
  async function init() {
    try {
      // 1. Get configurations for sidebar
      const configRes = await fetch('/api/config');
      const configData = await configRes.json();
      folderSettings = configData.folderSettings || {};
      renderSidebarFolders(configData.folders || [], folderSettings);

      // 2. Fetch media details
      const mediaRes = await fetch(`/api/videos/${mediaId}`);
      if (!mediaRes.ok) {
        throw new Error('Media file not found');
      }
      mediaData = await mediaRes.json();
      
      // 3. Populate metadata details
      populateMetadata();

      // 4. Setup media player (audio vs video)
      setupPlayer();

      // 5. Check and handle resume playback
      await handleResumePlayback();

      // 6. Load related sidebar
      loadRelatedFiles();

      // 7. Load comments
      loadComments();

      // 8. Initialize ratings
      initRatings();

    } catch (err) {
      console.error(err);
      mediaTitle.textContent = 'Error loading file details';
      mediaTitle.style.color = 'var(--yt-red)';
      playerWrapper.innerHTML = `
        <div style="display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100%; color: white; background: #000; padding: 20px; text-align: center;">
          <h3 style="margin-bottom: 12px;">Failed to Load Media</h3>
          <p style="color: #888;">The file may have been moved, deleted, or the format is unsupported by your browser.</p>
          <a href="/" class="btn" style="margin-top: 16px; color: white; border-color: #444;">Back to Home</a>
        </div>
      `;
    }
  }

  // Populate metadata to DOM
  function populateMetadata() {
    mediaTitle.textContent = mediaData.title;
    document.title = `${mediaData.title} - FileTube`;
    
    // Channel name: the mapped folder's friendly display name (if set), else the
    // artist tag from the file's metadata, else the immediate folder name.
    const mappedName = folderSettings[mediaData.rootFolder] && folderSettings[mediaData.rootFolder].name;
    const channelName = mappedName || mediaData.artist || mediaData.folderName;
    viewsCount.textContent = getMockViews(mediaData.id, mediaData.size);
    uploaderAvatar.textContent = (channelName[0] || 'F').toUpperCase();
    uploaderChannelName.textContent = channelName;
    uploaderSubsCount.textContent = `${getMockSubCount(channelName)} subscribers`;
    
    addedDateText.textContent = formatRelativeTime(mediaData.addedAt);
    fileSizeText.textContent = formatFileSize(mediaData.size);
    // File type from the extension (e.g. ".mp4" -> "MP4")
    fileTypeText.textContent = (mediaData.ext || '').replace('.', '').toUpperCase() || 'Unknown';
    filePathText.textContent = mediaData.filePath;
  }

  // Configure Player
  function setupPlayer() {
    const streamUrl = `/video/${mediaId}`;
    
    if (mediaData.type === 'audio') {
      // Simple audio player: show the cover art (or placeholder) as a still poster
      // with the browser's native controls. Works consistently on iOS and desktop;
      // no spinning visualizer.
      audioVisualizer.style.display = 'none';
      mediaPlayer.style.display = 'block';
      mediaPlayer.poster = `/thumbnail/${mediaId}`;
      mediaPlayer.src = streamUrl;
    } else {
      // Video File
      mediaPlayer.style.display = 'block';
      setupSkipControls();

      if (mediaData.needsTranscode) {
        if (!isMobileViewport()) {
          // Desktop: live transcode for instant playback (seek = restart stream).
          // Playback is kicked off by handleResumePlayback() -> startLiveStream().
          liveMode = true;
        } else if (mediaData.transcodeStatus === 'ready') {
          // Mobile with the pre-transcoded MP4 ready: play it (seekable, iOS-safe).
          mediaPlayer.src = streamUrl;
        } else {
          // Mobile, no cached MP4 yet: transcode is lazy, so hitting /video/:id kicks
          // it off on the server. Hide the empty <video> (mobile shows a "can't play"
          // icon), show the "preparing" overlay, and poll until it's ready.
          awaitingTranscode = true;
          mediaPlayer.style.display = 'none';
          showTranscodeOverlay();
          fetch(`/video/${mediaId}`).catch(() => {}); // trigger the on-demand transcode
          pollTranscodeUntilReady();
        }
      } else {
        mediaPlayer.src = streamUrl;
      }
    }

    // Set up progress tracking while media is playing
    mediaPlayer.addEventListener('play', startProgressSaver);
    mediaPlayer.addEventListener('pause', stopProgressSaver);
    mediaPlayer.addEventListener('ended', () => {
      // Clear progress on end so it starts fresh next time
      saveProgressToServer(0);
      stopProgressSaver();
    });
  }

  // ---- YouTube-style ±15s skipping (buttons, double-tap, keyboard) ----
  const SKIP_SECONDS = 15;
  let skipRevealTimer = null;

  // Seek by delta seconds, clamped to the media length, with visual feedback.
  function skip(delta) {
    flashRipple(delta < 0 ? skipRippleLeft : skipRippleRight);
    if (liveMode) {
      // Live stream isn't byte-seekable: restart the transcode at the new offset.
      const total = mediaData.duration || Infinity;
      const target = Math.max(0, Math.min(total, currentAbsTime() + delta));
      startLiveStream(target, true);
      saveProgressToServer(target);
      return;
    }
    const dur = mediaPlayer.duration;
    if (!isFinite(dur) || dur <= 0) return;
    mediaPlayer.currentTime = Math.max(0, Math.min(dur, mediaPlayer.currentTime + delta));
    saveProgressToServer(mediaPlayer.currentTime);
  }

  // Briefly pulse the left/right ripple overlay.
  function flashRipple(el) {
    if (!el) return;
    el.classList.remove('active');
    void el.offsetWidth; // force reflow so rapid repeats re-trigger the animation
    el.classList.add('active');
  }

  // Touch devices have no hover — reveal the skip buttons for a few seconds after a tap.
  function revealSkipButtons() {
    if (!skipControls) return;
    skipControls.classList.add('skip-visible');
    if (skipRevealTimer) clearTimeout(skipRevealTimer);
    skipRevealTimer = setTimeout(() => skipControls.classList.remove('skip-visible'), 2500);
  }

  function hideSkipButtons() {
    if (!skipControls) return;
    if (skipRevealTimer) clearTimeout(skipRevealTimer);
    skipControls.classList.remove('skip-visible');
  }

  function setupSkipControls() {
    if (!skipControls) return;
    skipControls.style.display = 'block';

    // Reveal on pointer activity over the player (desktop), then auto-hide; hide at once on leave.
    playerWrapper.addEventListener('mousemove', revealSkipButtons);
    playerWrapper.addEventListener('mouseleave', hideSkipButtons);

    skipBackBtn.addEventListener('click', () => { skip(-SKIP_SECONDS); revealSkipButtons(); });
    skipFwdBtn.addEventListener('click', () => { skip(SKIP_SECONDS); revealSkipButtons(); });

    // Desktop: double-click seeks based on which half was clicked, and we suppress
    // the browser's default double-click-to-fullscreen so it feels like YouTube.
    mediaPlayer.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const rect = mediaPlayer.getBoundingClientRect();
      const onLeft = (e.clientX - rect.left) < rect.width / 2;
      skip(onLeft ? -SKIP_SECONDS : SKIP_SECONDS);
    });

    // Mobile: detect a double-tap on the same half of the video.
    let lastTapTime = 0;
    let lastTapLeft = false;
    mediaPlayer.addEventListener('touchend', (e) => {
      const touch = e.changedTouches[0];
      const rect = mediaPlayer.getBoundingClientRect();
      const onLeft = (touch.clientX - rect.left) < rect.width / 2;
      const now = Date.now();
      const gap = now - lastTapTime;
      if (gap > 0 && gap < 350 && onLeft === lastTapLeft) {
        e.preventDefault(); // stop the native single-tap behavior on the seek tap
        skip(onLeft ? -SKIP_SECONDS : SKIP_SECONDS);
        lastTapTime = 0; // reset so a third tap doesn't chain
      } else {
        lastTapTime = now;
        lastTapLeft = onLeft;
        revealSkipButtons();
      }
    }, { passive: false });
  }

  // Desktop keyboard: ← / → jump 15s (ignored while typing in a field).
  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); skip(-SKIP_SECONDS); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); skip(SKIP_SECONDS); }
  });

  // ---- Transcode ("Preparing video") handling for AVI-class files ----
  function showTranscodeOverlay() {
    if (transcodeOverlay) transcodeOverlay.style.display = 'flex';
  }
  function hideTranscodeOverlay() {
    if (transcodeOverlay) transcodeOverlay.style.display = 'none';
  }
  function showTranscodeFailed() {
    if (transcodeSpinner) transcodeSpinner.classList.add('failed');
    if (transcodeTitle) transcodeTitle.textContent = 'Could not prepare this video';
    if (transcodeMessage) transcodeMessage.textContent = 'FileTube was unable to convert this file to a playable format. The original may be corrupt or use an unsupported codec.';
  }

  // Poll the server until the MP4 transcode is ready, then load and play it.
  async function pollTranscodeUntilReady() {
    try {
      const res = await fetch(`/api/videos/${mediaId}`);
      const data = await res.json();
      if (data.transcodeStatus === 'ready') {
        awaitingTranscode = false;
        hideTranscodeOverlay();
        mediaPlayer.style.display = 'block';
        mediaPlayer.src = `/video/${mediaId}`;
        handleResumePlayback();
        return;
      }
      if (data.transcodeStatus === 'failed') {
        showTranscodeFailed();
        return;
      }
      // still pending/processing — surface progress if the server has it
      const pct = Math.round(data.transcodeProgress || 0);
      if (transcodeTitle) {
        transcodeTitle.textContent = pct > 0 ? `Preparing this video… ${pct}%` : 'Preparing this video…';
      }
      setTimeout(pollTranscodeUntilReady, 2000);
    } catch (e) {
      console.error('Error polling transcode status:', e);
      setTimeout(pollTranscodeUntilReady, 5000);
    }
  }

  // Handle Playback resume
  async function handleResumePlayback() {
    if (awaitingTranscode) return; // wait until the transcoded MP4 is ready
    try {
      const res = await fetch(`/api/progress/${mediaId}`);
      const data = await res.json();
      savedProgress = data.timestamp || 0;

      // Only prompt if watched more than 5 seconds and not finished
      if (savedProgress > 5) {
        resumeTimeStr.textContent = formatDuration(savedProgress);
        resumeOverlay.style.display = 'flex';
        // Disable auto-play until overlay choice
        mediaPlayer.autoplay = false;
      } else if (liveMode) {
        // Desktop live stream: start from the beginning (autoplays on desktop).
        startLiveStream(0, true);
      } else if (!isMobileViewport()) {
        // Auto-play on desktop only. On mobile, autoplay can trigger the native
        // fullscreen "zoom" — let the user start playback with a tap instead.
        mediaPlayer.play().catch(() => {});
      }
    } catch (e) {
      console.error('Error fetching progress:', e);
    }
  }

  // Resume button choices (user gesture — play() is allowed even on mobile)
  resumeYesBtn.addEventListener('click', () => {
    resumeOverlay.style.display = 'none';
    if (liveMode) {
      startLiveStream(savedProgress, true);
    } else {
      mediaPlayer.currentTime = savedProgress;
      mediaPlayer.play().catch(() => {});
    }
  });

  resumeNoBtn.addEventListener('click', () => {
    resumeOverlay.style.display = 'none';
    if (liveMode) {
      startLiveStream(0, true);
    } else {
      mediaPlayer.currentTime = 0;
      mediaPlayer.play().catch(() => {});
    }
    // Clear progress
    saveProgressToServer(0);
  });

  // Periodical progress saving logic
  function startProgressSaver() {
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = setInterval(() => {
      if (!mediaPlayer.paused && currentAbsTime() > 0) {
        saveProgressToServer(currentAbsTime());
      }
    }, 4000); // Save progress every 4 seconds
  }

  function stopProgressSaver() {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
    if (currentAbsTime() > 0) {
      saveProgressToServer(currentAbsTime());
    }
  }

  async function saveProgressToServer(time) {
    try {
      await fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: mediaId,
          timestamp: time,
          duration: (isFinite(mediaPlayer.duration) ? mediaPlayer.duration : 0) || mediaData.duration || 0
        })
      });
    } catch (e) {
      console.error('Error auto-saving progress:', e);
    }
  }

  // Load related files
  async function loadRelatedFiles() {
    try {
      const res = await fetch('/api/videos');
      const allFiles = await res.json();
      
      // Filter out current file
      const filtered = allFiles.filter(f => f.id !== mediaId);

      // Prioritize files in the same folder, then other folders
      const sameFolder = filtered.filter(f => f.folderName === mediaData.folderName);
      const otherFolders = filtered.filter(f => f.folderName !== mediaData.folderName);
      
      const related = [...sameFolder, ...otherFolders].slice(0, 10);

      if (related.length === 0) {
        relatedContainer.innerHTML = '<div style="color: var(--text-secondary); font-style: italic;">No other files found.</div>';
        return;
      }

      relatedContainer.innerHTML = related.map(item => {
        const durationStr = item.duration > 0 ? formatDuration(item.duration) : (item.type === 'audio' ? 'Audio' : '');
        const durationBadge = durationStr ? `<div class="duration-badge">${durationStr}</div>` : '';
        const views = getMockViews(item.id, item.size);

        return `
          <a href="/watch.html?v=${item.id}" class="related-card">
            <div class="related-thumb">
              <img src="/thumbnail/${item.id}" style="width:100%; height:100%; object-fit:cover;" loading="lazy" />
              ${durationBadge}
            </div>
            <div class="related-info">
              <div class="related-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
              <div class="related-uploader">${escapeHtml(item.folderName)}</div>
              <div class="related-meta">${views}</div>
            </div>
          </a>
        `;
      }).join('');

    } catch (e) {
      console.error('Error loading related files:', e);
      relatedContainer.innerHTML = '<div style="color: var(--yt-red);">Error loading related files.</div>';
    }
  }

  // Local ratings setup
  function initRatings() {
    const savedRatingKey = `rating_${mediaId}`;
    let userRating = localStorage.getItem(savedRatingKey) || 0;
    
    // Draw stars
    drawStars(userRating);

    starRatingControl.addEventListener('mousemove', (e) => {
      if (e.target.classList.contains('star')) {
        const hoverVal = parseInt(e.target.dataset.value);
        highlightStars(hoverVal);
      }
    });

    starRatingControl.addEventListener('mouseleave', () => {
      drawStars(userRating);
    });

    starRatingControl.addEventListener('click', (e) => {
      if (e.target.classList.contains('star')) {
        const val = parseInt(e.target.dataset.value);
        userRating = val;
        localStorage.setItem(savedRatingKey, val);
        drawStars(val);
        ratingText.textContent = `Rated: ${val}/5!`;
      }
    });
  }

  function highlightStars(count) {
    const stars = starRatingControl.querySelectorAll('.star');
    stars.forEach(star => {
      const val = parseInt(star.dataset.value);
      if (val <= count) {
        star.classList.add('active');
      } else {
        star.classList.remove('active');
      }
    });
  }

  function drawStars(count) {
    highlightStars(count);
    ratingText.textContent = count > 0 ? `Rating: ${count}/5` : 'Rate this';
  }

  // Load comments
  function loadComments() {
    const savedCommentsKey = `comments_${mediaId}`;
    let comments = [];

    try {
      const localComments = localStorage.getItem(savedCommentsKey);
      if (localComments) {
        comments = JSON.parse(localComments);
      } else {
        // Prepopulate with a few classic YouTube comments to keep the aesthetic alive!
        comments = getMockInitialComments();
        localStorage.setItem(savedCommentsKey, JSON.stringify(comments));
      }
    } catch (e) {
      console.error(e);
      comments = getMockInitialComments();
    }

    renderComments(comments);
  }

  function renderComments(comments) {
    commentCountBadge.textContent = comments.length;
    
    if (comments.length === 0) {
      commentsContainer.innerHTML = '<div style="color: var(--text-secondary); text-align: center; padding: 12px 0;">No comments yet. Be the first to comment!</div>';
      return;
    }

    commentsContainer.innerHTML = comments.map(c => {
      return `
        <div class="comment-item">
          <div class="comment-avatar">${escapeHtml(c.author[0].toUpperCase())}</div>
          <div class="comment-body">
            <div class="comment-author-meta">
              <span class="comment-author-name">${escapeHtml(c.author)}</span>
              <span class="comment-time">${escapeHtml(c.timeStr)}</span>
            </div>
            <div class="comment-content">${escapeHtml(c.text)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  postCommentBtn.addEventListener('click', () => {
    const text = newCommentText.value.trim();
    if (!text) return;

    const savedCommentsKey = `comments_${mediaId}`;
    let comments = [];
    try {
      comments = JSON.parse(localStorage.getItem(savedCommentsKey)) || [];
    } catch (e) {}

    const newComment = {
      author: 'You',
      timeStr: 'just now',
      text: text
    };

    comments.unshift(newComment);
    localStorage.setItem(savedCommentsKey, JSON.stringify(comments));
    renderComments(comments);
    newCommentText.value = '';
  });

  // Prepopulated mock retro comments
  function getMockInitialComments() {
    const commentBank = [
      { author: 'xX_GuitarHero_Xx', text: 'Unbelievable quality! Saved this to my hard drive immediately. Thanks for uploading!', timeStr: '2 years ago' },
      { author: 'RetroLover99', text: 'Wow, this brings back so many memories. HTML5 streaming is super smooth on my phone!', timeStr: '1 year ago' },
      { author: 'buffering_fan', text: 'First! Anyone else watching in 2026? 😂', timeStr: '6 months ago' },
      { author: 'code_runner', text: 'This FileTube container works flawlessly. Glad we can self-host this.', timeStr: '3 months ago' },
      { author: 'anonymous_user', text: 'Is it possible to download? Oh wait, it is already on my disk. Lol.', timeStr: '2 weeks ago' },
      { author: 'audio_phile', text: 'Great audio upload, sound quality is pristine.', timeStr: '5 days ago' },
      { author: 'MLG_toaster', text: 'who else is scrolling comments instead of watching 🙋', timeStr: '4 years ago' },
      { author: 'SubToMePls', text: 'thumbs up if u came here from the homepage', timeStr: '8 months ago' },
      { author: 'dial_up_survivor', text: 'buffered instantly?? in MY house?? we live in the future', timeStr: '1 year ago' },
      { author: 'CerealKiller2007', text: 'i showed this to my cat. no reaction. still a banger.', timeStr: '3 weeks ago' },
      { author: 'notabot_promise', text: 'the algorithm blessed me tonight 🙏', timeStr: '2 days ago' },
      { author: 'grainy480p_gang', text: 'came for the nostalgia, stayed for the vibes', timeStr: '5 months ago' },
      { author: 'LocalManYells', text: '0:32 you can literally hear the compression and i love it', timeStr: '11 months ago' },
      { author: 'ProSkater_1999', text: 'this belongs in a museum. or at least my flash drive.', timeStr: '7 months ago' },
      { author: 'keyboard_warrior_lite', text: 'im not crying you\'re crying', timeStr: '1 month ago' },
      { author: 'ServerRoomGremlin', text: 'self-hosted and DRM-free? based.', timeStr: '9 days ago' },
      { author: 'quantum_potato', text: 'my ISP is shaking rn', timeStr: '6 hours ago' },
      { author: 'VHS_Wizard', text: 'be right back, adding this to 14 playlists', timeStr: '2 years ago' },
      { author: 'lurk_mode_off', text: 'first comment in 6 years of watching. worth it.', timeStr: '4 months ago' },
      { author: 'CtrlAltDefeat', text: 'the resolution is low but my expectations were lower and it STILL exceeded them', timeStr: '3 days ago' },
      { author: 'SnackTimeSam', text: 'watching this instead of doing my homework, no regrets', timeStr: '1 week ago' },
      { author: 'aggressively_average', text: 'skipped the intro like a coward. do not recommend. 10/10.', timeStr: '5 weeks ago' },
      { author: 'MemoryLeakLarry', text: 'i have watched this 47 times and my RAM has not forgiven me', timeStr: '2 months ago' },
      { author: 'ohno_its_dave', text: 'the double-tap skip is smoother than my dance moves', timeStr: '10 days ago' },
      { author: 'PacketLossPaul', text: 'no ads, no tracking, no login wall. i forgot the internet could feel like this', timeStr: '3 months ago' },
      { author: 'ffmpeg_enjoyer', text: 'transcoded perfectly on the first try, which never happens. black magic.', timeStr: '1 year ago' },
      { author: '404_brain_not_found', text: 'clicked this at 2am and have zero regrets and even less sleep', timeStr: '4 days ago' },
      { author: 'CapsLockKaren', text: 'WHY IS THIS SO GOOD I CANT EVEN TURN OFF MY CAPS', timeStr: '6 months ago' },
      { author: 'reverse_engineer_rick', text: 'checked the network tab just to make sure it wasnt phoning home. it isnt. legend.', timeStr: '2 weeks ago' },
      { author: 'nostalgic_noodle', text: 'this is the digital equivalent of finding $20 in an old jacket', timeStr: '8 months ago' },
      { author: 'BandwidthBandit', text: 'streaming this on my toaster and it STILL loads faster than the big platforms', timeStr: '5 days ago' },
      { author: 'ctrl_z_forever', text: 'undid my whole afternoon to watch this. cant undo it back. worth it.', timeStr: '3 weeks ago' },
      { author: 'MidiFileMike', text: 'the audio slaps harder than a 90s ringtone', timeStr: '1 year ago' },
      { author: 'sudo_make_me_a_sandwich', text: 'ran this on my homelab and my wife asked why im smiling at the router', timeStr: '2 months ago' },
      { author: 'GifNotJif', text: 'i will die on the hill that this is peak content', timeStr: '11 months ago' },
      { author: 'lowpoly_larry', text: 'the pixels are fighting for their lives and i respect the hustle', timeStr: '4 months ago' },
      { author: 'TabHoarder3000', text: 'this is now permanently open in tab 47 of 231', timeStr: '9 days ago' },
      { author: 'cache_me_ousside', text: 'loaded from cache before i even finished blinking', timeStr: '6 hours ago' },
      { author: 'DefinitelyHuman__', text: 'beep boop i mean wow great video fellow human', timeStr: '1 month ago' },
      { author: 'compression_artist', text: 'those jpeg artifacts are basically abstract art at this point', timeStr: '7 months ago' },
      { author: 'yeet_the_skip', text: 'the skip button responds faster than my will to live on a monday', timeStr: '5 weeks ago' },
      { author: 'Rj45_romantic', text: 'plugged in an ethernet cable just to honor this upload', timeStr: '3 months ago' },
      { author: 'segfault_sally', text: 'watched it, cried, watched it again, cried professionally this time', timeStr: '2 days ago' },
      { author: 'ThumbnailLiar', text: 'thumbnail promised nothing and delivered everything. rare.', timeStr: '10 months ago' },
      { author: 'localhost_hero', text: 'runs on 127.0.0.1 and lives in my heart', timeStr: '1 week ago' },
      { author: 'bit_rot_betty', text: 'archived this before the heat death of the universe just to be safe', timeStr: '4 years ago' },
      { author: 'TerabyteTerry', text: 'my NAS thanks you, this is going in the good folder', timeStr: '6 months ago' },
      { author: 'off_by_one_ollie', text: 'watched it 1 too many times and 1 too few at the same time', timeStr: '3 days ago' },
      { author: 'RanchDressingFan', text: 'no thoughts. just vibes and mild buffering (jk it never buffered)', timeStr: '2 weeks ago' },
      { author: 'kernel_panic_kim', text: 'the only thing that crashed today was my composure watching this', timeStr: '8 months ago' },
      { author: 'ThreadRipperTina', text: 'used 1 core out of 32 to watch this and felt powerful', timeStr: '5 months ago' },
      { author: 'perpetual_beta', text: 'this is more stable than any app ive ever shipped', timeStr: '1 year ago' },
      { author: 'wget_wanderer', text: 'wget-ed the whole thing out of respect for the craft', timeStr: '9 days ago' },
      { author: 'BlinkTagBrenda', text: 'somewhere a 2004 webmaster is smiling', timeStr: '11 months ago' },
      { author: 'nullpointer_nate', text: 'expected nothing, got everything, threw no exceptions', timeStr: '4 days ago' },
      { author: 'RaidZeroRegret', text: 'backed this up to a drive with no redundancy. living dangerously.', timeStr: '2 months ago' },
      { author: 'silent_scroll', text: 'been watching for years, finally commenting, immediately regret the pressure', timeStr: '7 months ago' },
      { author: 'ohm_my_god', text: 'the resistance to closing this tab is futile', timeStr: '3 weeks ago' },
      { author: 'DownloadFinished', text: '99%... 99%... 100%. best 3 seconds of anticipation of my life.', timeStr: '6 months ago' },
      { author: 'legacy_browser_lou', text: 'works on the browser i refuse to update. miracle.', timeStr: '1 month ago' },
      { author: 'the_real_admin', text: 'i host this and even i keep coming back to watch it', timeStr: '5 days ago' },

      { author: 'JpegDreams', text: 'i can see individual pixels and i have named each one', timeStr: '3 days ago' },
      { author: 'uptime_uwu', text: '99.99% uptime and 100% serotonin', timeStr: '1 week ago' },
      { author: 'CronJobCarl', text: 'scheduled my entire evening around rewatching this', timeStr: '2 months ago' },
      { author: 'ping_of_death', text: 'latency so low i watched it before i clicked', timeStr: '5 hours ago' },
      { author: 'DarkModeDenise', text: 'toggled dark mode and ascended to a higher plane', timeStr: '4 days ago' },
      { author: 'YAMLwrangler', text: 'no indentation errors were harmed in the making of this comment', timeStr: '6 months ago' },
      { author: 'sneakernet_steve', text: 'almost drove a hard drive to my friends house before remembering this exists', timeStr: '2 weeks ago' },
      { author: 'RegexRhonda', text: 'this video matches /.*perfection.*/gi', timeStr: '9 days ago' },
      { author: 'buffer_underrun', text: 'my thumbnail loaded so fast i got startled', timeStr: '1 month ago' },
      { author: 'GrandpaOnDialup', text: 'in MY day we waited 40 minutes for a single gif. you kids are spoiled.', timeStr: '3 weeks ago' },
      { author: 'semicolon_survivor', text: 'no missing semicolons detected. we thrive.', timeStr: '7 months ago' },
      { author: 'ETL_enthusiast', text: 'extracted joy, transformed my mood, loaded it straight into my heart', timeStr: '4 days ago' },
      { author: 'mount_point_marie', text: 'mounted this directly into my soul, read-write', timeStr: '5 weeks ago' },
      { author: 'HeapOverflowHarry', text: 'allocated way too much memory to how much i love this', timeStr: '2 days ago' },
      { author: 'the_lag_is_gone', text: 'the buffering wheel walked so this could run', timeStr: '11 months ago' },

      // Friends
      { author: 'Joe Dowden', text: 'cool. touch grass.', timeStr: '2 days ago' },
      { author: 'Joe Dowden', text: 'you spent HOW long on this. the outdoors is free, you know.', timeStr: '5 days ago' },
      { author: 'Joe Dowden', text: 'please tell me a human wrote this and not some chatbot', timeStr: '1 week ago' },
      { author: 'Joe Dowden', text: 'impressive, i guess. the sun still exists though.', timeStr: '3 days ago' },
      { author: 'Joe Dowden', text: 'neat. go outside.', timeStr: '4 days ago' },
      { author: 'Jesahel Vallejo', text: 'lil b really built his own youtube 😤', timeStr: '2 days ago' },
      { author: 'Jesahel Vallejo', text: 'clean work lil b. anyway i got the Lakers +4 tonight', timeStr: '5 days ago' },
      { author: 'Jesahel Vallejo', text: 'lil b i\'m 3 legs into a 5 leg parlay and STILL watching this', timeStr: '1 week ago' },
      { author: 'Jesahel Vallejo', text: '10/10 lil b. hits better than cashing a same-game parlay', timeStr: '3 days ago' },
      { author: 'Jesahel Vallejo', text: 'solid lil b. might put the whole bankroll on this app', timeStr: '4 days ago' },
      { author: 'Jesse Torres', text: 'nice work. consider a service worker for offline playback next.', timeStr: '2 days ago' },
      { author: 'Jesse Torres', text: 'solid. i\'d add rate limiting on the transcode endpoint though.', timeStr: '5 days ago' },
      { author: 'Jesse Torres', text: 'clean. throw some integration tests on the scan logic.', timeStr: '1 week ago' },
      { author: 'Jesse Torres', text: 'good stuff. debounce the progress saves to cut disk writes.', timeStr: '3 days ago' },
      { author: 'Jesse Torres', text: 'works well. extract that transcode queue into its own module.', timeStr: '4 days ago' },
      { author: 'TFR', text: 'solid. now boot up Derby Owner\'s Club and let\'s run a few races 🐎', timeStr: '2 days ago' },
      { author: 'TFR', text: 'good but it needs more Derby Owner\'s Club if we\'re being honest', timeStr: '5 days ago' },
      { author: 'TFR', text: '10/10 would watch between DOC sessions', timeStr: '1 week ago' },
      { author: 'TFR', text: 'my horse would approve of this upload 🏇', timeStr: '3 days ago' },

      // Family
      { author: 'Ray Tammam', text: 'oh good, another project instead of answering my texts', timeStr: '2 days ago' },
      { author: 'Ray Tammam', text: 'you invented youtube. truly no one has ever done this before.', timeStr: '5 days ago' },
      { author: 'Ray Tammam', text: 'impressive. anyway you still owe me for lunch.', timeStr: '1 week ago' },
      { author: 'Ray Tammam', text: 'cool app. still only the second funniest person in the family though.', timeStr: '3 days ago' },
      { author: 'Ray Tammam', text: 'so THIS is what "im busy" meant', timeStr: '4 days ago' },
      { author: 'Marcy Tammam', text: 'babe it is 2am. the server will still be here tomorrow.', timeStr: '2 hours ago' },
      { author: 'Marcy Tammam', text: 'very impressive. now do the dishes you promised 😘', timeStr: '1 day ago' },
      { author: 'Marcy Tammam', text: '10/10 but you STILL haven\'t watched the Calico Critters episode with me', timeStr: '3 days ago' },
      { author: 'Marcy Tammam', text: 'cute. the Calico Critters have a nicer house than we do though 🐰', timeStr: '5 days ago' },
      { author: 'Marcy Tammam', text: 'you named a git branch instead of taking out the trash didn\'t you', timeStr: '4 days ago' },
      { author: 'Marcy Tammam', text: 'love it honey. putting it on the shelf next to my Calico Critters 💕', timeStr: '1 week ago' },
      { author: 'Zouhir Tammam', text: 'Very thorough assessment son. I wish I was next to you to help you with all these projects. Love you.', timeStr: '2 days ago' },
      { author: 'Zouhir Tammam', text: 'Excellent work my son. So very proud of you. Love you.', timeStr: '5 days ago' },
      { author: 'Zouhir Tammam', text: 'This is wonderful. You were always so talented. Call me and show me how it works. Love you son.', timeStr: '1 week ago' },
      { author: 'Zouhir Tammam', text: 'Beautiful project son. I wish I could sit beside you and build these with you. Love you.', timeStr: '3 days ago' },

      // Daisy 💛 (she's 5)
      { author: 'Daisy Tammam', text: 'hi daddy i luv u 💖', timeStr: '2 hours ago' },
      { author: 'Daisy Tammam', text: 'dis is the BEST vidyo EVER!!!', timeStr: '1 day ago' },
      { author: 'Daisy Tammam', text: 'daddy ur so smart!!!', timeStr: '3 hours ago' },
      { author: 'Daisy Tammam', text: 'i wach it a HUNDRED times 🥰', timeStr: '5 hours ago' },
      { author: 'Daisy Tammam', text: 'can we hav ice cream after pleez 🍦', timeStr: '4 days ago' },
      { author: 'Daisy Tammam', text: 'i luv u dad to the moon 🌙', timeStr: 'just now' },
      { author: 'Daisy Tammam', text: 'my daddy maded dis!!!', timeStr: '2 days ago' },
      { author: 'Daisy Tammam', text: 'SO GOOD i clapd 👏', timeStr: '6 hours ago' },
      { author: 'Daisy Tammam', text: 'daddy is the best on the hole erf', timeStr: '1 day ago' },
      { author: 'Daisy Tammam', text: 'i drawed u a picsher 🎨', timeStr: '3 days ago' },
      { author: 'Daisy Tammam', text: 'yaaay daddy!!! 🎉', timeStr: '5 days ago' },
      { author: 'Daisy Tammam', text: 'wach wif me daddy pleeez', timeStr: '1 week ago' }
    ];

    // Choose 4 comments deterministically based on media ID
    const seed = mediaId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const selected = [];
    const used = new Set();
    for (let i = 0; i < 4; i++) {
      let idx = (seed + i * 7) % commentBank.length;
      while (used.has(idx)) idx = (idx + 1) % commentBank.length;
      used.add(idx);
      selected.push(commentBank[idx]);
    }
    return selected;
  }

  // Deletion logic
  deleteBtn.addEventListener('click', () => {
    showConfirmModal(
      'Confirm Permanent Deletion',
      `Are you sure you want to permanently delete <strong>${escapeHtml(mediaData.title)}</strong>?<br><br><span style="color:var(--yt-red); font-weight:bold;">Warning: This will delete the actual file from your computer's disk:</span><br><code style="word-break:break-all; font-size:11px;">${escapeHtml(mediaData.filePath)}</code>`,
      async () => {
        try {
          if (progressInterval) clearInterval(progressInterval);
          
          const res = await fetch(`/api/videos/${mediaId}`, { method: 'DELETE' });
          const data = await res.json();
          
          if (data.success) {
            alert('File deleted successfully.');
            window.location.href = '/';
          } else {
            alert('Error deleting file: ' + data.error);
          }
        } catch (err) {
          console.error(err);
          alert('Network error occurred while trying to delete file.');
        }
      }
    );
  });

  // Description expand/collapse toggle
  expandDescBtn.addEventListener('click', () => {
    const isExpanded = descriptionParagraph.classList.toggle('expanded');
    expandDescBtn.textContent = isExpanded ? 'Show less' : 'Show more';
  });

  // Header folder list rendering
  function renderSidebarFolders(folders, settings = {}) {
    if (folders.length === 0) {
      sidebarFoldersList.innerHTML = '<div style="padding: 6px 24px; font-style: italic; color: var(--text-secondary);">None</div>';
      return;
    }
    sidebarFoldersList.innerHTML = folders.map(f => {
      const folderName = f.split(/[\\/]/).pop() || f;
      const label = (settings[f] && settings[f].name) || folderName;
      // ?root= shows everything under the mapped folder, including subfolders.
      return `
        <a href="/?root=${encodeURIComponent(f)}" class="sidebar-item" title="${escapeHtml(f)}">
          <i class="icon-folder"></i> ${escapeHtml(label)}
        </a>
      `;
    }).join('');
  }

  // Search routing
  function performSearch() {
    const query = searchInput.value.trim();
    if (query) {
      window.location.href = `/?search=${encodeURIComponent(query)}`;
    } else {
      window.location.href = '/';
    }
  }

  searchBtn.addEventListener('click', performSearch);
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
  });

  // Local escape HTML helper
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Run start
  init();
});
