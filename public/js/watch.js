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

  // Initialize page
  async function init() {
    try {
      // 1. Get configurations for sidebar
      const configRes = await fetch('/api/config');
      const configData = await configRes.json();
      renderSidebarFolders(configData.folders || []);

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
    
    viewsCount.textContent = getMockViews(mediaData.id, mediaData.size);
    uploaderAvatar.textContent = (mediaData.folderName[0] || 'F').toUpperCase();
    uploaderChannelName.textContent = mediaData.folderName;
    uploaderSubsCount.textContent = `${getMockSubCount(mediaData.folderName)} subscribers`;
    
    addedDateText.textContent = formatRelativeTime(mediaData.addedAt);
    fileSizeText.textContent = formatFileSize(mediaData.size);
    filePathText.textContent = mediaData.filePath;
  }

  // Configure Player
  function setupPlayer() {
    const streamUrl = `/video/${mediaId}`;
    
    if (mediaData.type === 'audio') {
      // Audio File
      audioVisualizer.style.display = 'flex';
      mediaPlayer.style.display = 'block'; // Keep it block but style it small under visualizer, or overlay
      
      // Let's overlay the audioVisualizer on top and make video player act as audio
      mediaPlayer.src = streamUrl;
      mediaPlayer.style.width = '100%';
      mediaPlayer.style.height = '42px'; // Height of typical HTML5 audio controls
      
      // Sync spin states
      mediaPlayer.addEventListener('play', () => {
        audioVisualizer.classList.add('playing');
      });
      mediaPlayer.addEventListener('pause', () => {
        audioVisualizer.classList.remove('playing');
      });
      mediaPlayer.addEventListener('ended', () => {
        audioVisualizer.classList.remove('playing');
      });

      audioVisualTitle.textContent = mediaData.title;
      audioVisualFolder.textContent = `Folder: ${mediaData.folderName}`;
    } else {
      // Video File
      mediaPlayer.style.display = 'block';
      mediaPlayer.src = streamUrl;
      setupSkipControls();
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
    const dur = mediaPlayer.duration;
    if (!isFinite(dur) || dur <= 0) return;
    mediaPlayer.currentTime = Math.max(0, Math.min(dur, mediaPlayer.currentTime + delta));
    flashRipple(delta < 0 ? skipRippleLeft : skipRippleRight);
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
    skipRevealTimer = setTimeout(() => skipControls.classList.remove('skip-visible'), 3000);
  }

  function setupSkipControls() {
    if (!skipControls) return;
    skipControls.style.display = 'block';

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

  // Handle Playback resume
  async function handleResumePlayback() {
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
      } else {
        // Safe to auto play
        mediaPlayer.play().catch(() => {});
      }
    } catch (e) {
      console.error('Error fetching progress:', e);
    }
  }

  // Resume button choices
  resumeYesBtn.addEventListener('click', () => {
    resumeOverlay.style.display = 'none';
    mediaPlayer.currentTime = savedProgress;
    mediaPlayer.play().catch(() => {});
  });

  resumeNoBtn.addEventListener('click', () => {
    resumeOverlay.style.display = 'none';
    mediaPlayer.currentTime = 0;
    mediaPlayer.play().catch(() => {});
    // Clear progress
    saveProgressToServer(0);
  });

  // Periodical progress saving logic
  function startProgressSaver() {
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = setInterval(() => {
      if (!mediaPlayer.paused && mediaPlayer.currentTime > 0) {
        saveProgressToServer(mediaPlayer.currentTime);
      }
    }, 4000); // Save progress every 4 seconds
  }

  function stopProgressSaver() {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
    if (mediaPlayer.currentTime > 0) {
      saveProgressToServer(mediaPlayer.currentTime);
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
          duration: mediaPlayer.duration || mediaData.duration || 0
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
      { author: 'audio_phile', text: 'Great audio upload, sound quality is pristine.', timeStr: '5 days ago' }
    ];
    
    // Choose 3 comments deterministically based on media ID
    const seed = mediaId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const selected = [];
    for (let i = 0; i < 3; i++) {
      const idx = (seed + i * 7) % commentBank.length;
      const comment = commentBank[idx];
      // Slightly vary relative times
      selected.push({
        author: comment.author,
        text: comment.text,
        timeStr: comment.timeStr
      });
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
  function renderSidebarFolders(folders) {
    if (folders.length === 0) {
      sidebarFoldersList.innerHTML = '<div style="padding: 6px 24px; font-style: italic; color: var(--text-secondary);">None</div>';
      return;
    }
    sidebarFoldersList.innerHTML = folders.map(f => {
      const folderName = f.split(/[\\/]/).pop() || f;
      return `
        <a href="/?folder=${encodeURIComponent(folderName)}" class="sidebar-item">
          <i class="icon-folder"></i> ${escapeHtml(folderName)}
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
