const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');
const mime = require('mime-types');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Dynamic data directory for Docker volume persistence
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : (fs.existsSync('/app/data') ? '/app/data' : __dirname);
const DB_FILE = path.join(DATA_DIR, 'db.json');
const THUMBNAIL_DIR = path.join(DATA_DIR, '.thumbnails');
// Browser-incompatible containers (e.g. AVI) are pre-transcoded to MP4 here on scan.
const TRANSCODE_DIR = path.join(DATA_DIR, 'transcoded');

// Create directories if they don't exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(THUMBNAIL_DIR)) {
  fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
}
if (!fs.existsSync(TRANSCODE_DIR)) {
  fs.mkdirSync(TRANSCODE_DIR, { recursive: true });
}

// Ensure database file exists
function loadDatabase() {
  if (!fs.existsSync(DB_FILE)) {
    const initialDb = {
      folders: [],
      folderSettings: {},
      progress: {},
      metadata: {}
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2), 'utf8');
    return initialDb;
  }
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    const db = JSON.parse(data);
    if (!db.folderSettings) db.folderSettings = {}; // backfill for older databases
    return db;
  } catch (err) {
    console.error('Error reading db.json, resetting database:', err);
    return { folders: [], folderSettings: {}, progress: {}, metadata: {} };
  }
}

function saveDatabase(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving db.json:', err);
  }
}

// Media extensions
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v'];
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];
const ALL_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS];

// Containers browsers can't decode natively — pre-transcoded to MP4 on scan.
// (Extend this list if other formats fail to play in the browser.)
const TRANSCODE_EXTENSIONS = ['.avi', '.flv', '.wmv', '.mpg', '.mpeg'];

function needsTranscode(ext) {
  return TRANSCODE_EXTENSIONS.includes(ext);
}
function transcodedPath(id) {
  return path.join(TRANSCODE_DIR, `${id}.mp4`);
}

// Which configured folder does this file live under? (longest matching prefix)
function matchRootFolder(filePath, folders) {
  let best = null;
  for (const f of folders) {
    if (filePath === f || filePath.startsWith(f + '/') || filePath.startsWith(f + '\\')) {
      if (!best || f.length > best.length) best = f;
    }
  }
  return best;
}

// Generate deterministic ID from filepath
function getMediaId(filePath) {
  return crypto.createHash('md5').update(filePath).digest('hex');
}

// Check if ffmpeg is available
let ffmpegAvailable = false;
exec('ffmpeg -version', (error) => {
  if (!error) {
    ffmpegAvailable = true;
    console.log('FFmpeg is available in system PATH');
  } else {
    console.log('FFmpeg is not available in system PATH. Will fall back to dynamic SVG templates for thumbnails.');
  }
});

// ---- Pre-transcode queue (AVI and other non-web containers -> MP4) ----
// Jobs run one at a time to avoid overloading a home server with parallel FFmpeg runs.
const transcodeQueue = [];
let transcodeBusy = false;
const transcodeProgress = {}; // id -> percent complete (0-100) while a job runs

// Persist a media item's transcode status without clobbering unrelated db changes.
function setTranscodeStatus(id, status) {
  const db = loadDatabase();
  if (db.metadata[id] && db.metadata[id].transcodeStatus !== status) {
    db.metadata[id].transcodeStatus = status;
    saveDatabase(db);
  }
}

function queueTranscode(id, srcPath) {
  if (!ffmpegAvailable) return;
  if (transcodeQueue.some(job => job.id === id)) return; // already queued
  transcodeQueue.push({ id, srcPath });
  processTranscodeQueue();
}

function processTranscodeQueue() {
  if (transcodeBusy || transcodeQueue.length === 0) return;
  const { id, srcPath } = transcodeQueue.shift();

  // Skip if the source vanished or a finished MP4 already exists.
  if (!fs.existsSync(srcPath)) { processTranscodeQueue(); return; }
  const outPath = transcodedPath(id);
  if (fs.existsSync(outPath)) { setTranscodeStatus(id, 'ready'); processTranscodeQueue(); return; }

  transcodeBusy = true;
  const tmpPath = outPath + '.tmp.mp4';
  setTranscodeStatus(id, 'processing');
  transcodeProgress[id] = 0;
  // Total duration (from the scan's ffprobe) lets us turn FFmpeg's time= into a percentage.
  const srcMeta = loadDatabase().metadata[id];
  const totalDuration = (srcMeta && srcMeta.duration) || 0;
  console.log(`Transcoding to MP4: ${srcPath}`);

  // H.264 + AAC in an MP4 with a front-loaded moov atom (+faststart) for smooth streaming.
  const args = [
    '-i', srcPath,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '160k',
    '-movflags', '+faststart',
    '-y', tmpPath
  ];

  let proc;
  try {
    proc = spawn('ffmpeg', args);
  } catch (e) {
    console.error(`Failed to start FFmpeg for ${srcPath}:`, e.message);
    setTranscodeStatus(id, 'failed');
    transcodeBusy = false;
    processTranscodeQueue();
    return;
  }

  let errTail = '';
  proc.stderr.on('data', d => {
    const text = d.toString();
    errTail = (errTail + text).slice(-1500);
    // FFmpeg reports progress on stderr as "time=HH:MM:SS.xx"; convert to a percent.
    if (totalDuration > 0) {
      const m = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g);
      if (m && m.length) {
        const last = m[m.length - 1].match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        const secs = (+last[1]) * 3600 + (+last[2]) * 60 + parseFloat(last[3]);
        transcodeProgress[id] = Math.max(0, Math.min(99, Math.round((secs / totalDuration) * 100)));
      }
    }
  });

  proc.on('error', (e) => {
    console.error(`FFmpeg error for ${srcPath}:`, e.message);
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    delete transcodeProgress[id];
    setTranscodeStatus(id, 'failed');
    transcodeBusy = false;
    processTranscodeQueue();
  });

  proc.on('close', (code) => {
    if (code === 0 && fs.existsSync(tmpPath)) {
      try {
        fs.renameSync(tmpPath, outPath); // atomic: never serve a half-written file
        setTranscodeStatus(id, 'ready');
        console.log(`Transcode ready: ${outPath}`);
      } catch (e) {
        console.error(`Failed to finalize transcode for ${srcPath}:`, e.message);
        setTranscodeStatus(id, 'failed');
      }
    } else {
      console.error(`Transcode failed (exit ${code}) for ${srcPath}:\n${errTail}`);
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
      setTranscodeStatus(id, 'failed');
    }
    delete transcodeProgress[id];
    transcodeBusy = false;
    processTranscodeQueue();
  });
}

// Ensure a video that needs transcoding has an up-to-date status, queuing work if missing.
// Mutates the item in place; returns true if the status changed.
function reconcileTranscode(item) {
  if (!item || item.type === 'audio') {
    if (item && item.transcodeStatus !== undefined) { delete item.transcodeStatus; return true; }
    return false;
  }
  const want = needsTranscode(item.ext);
  let changed = false;
  if (item.needsTranscode !== want) { item.needsTranscode = want; changed = true; }
  // Live transcode is on demand now — clear any legacy pre-transcode status field.
  if (item.transcodeStatus !== undefined) { delete item.transcodeStatus; changed = true; }
  return changed;
}

// Extract duration and thumbnail using FFmpeg
function extractMetadataAndThumbnail(filePath, mediaId, isAudio) {
  return new Promise((resolve) => {
    const thumbName = `${mediaId}.jpg`;
    const thumbPath = path.join(THUMBNAIL_DIR, thumbName);
    
    if (!ffmpegAvailable) {
      return resolve({ duration: 0, hasThumbnail: false });
    }

    // Get duration first
    const ffprobeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
    exec(ffprobeCmd, (err, stdout) => {
      let duration = 0;
      if (!err && stdout) {
        duration = parseFloat(stdout.trim()) || 0;
      }

      if (isAudio) {
        // Try to extract embedded audio artwork
        const extractArtCmd = `ffmpeg -i "${filePath}" -an -vcodec copy -y "${thumbPath}"`;
        exec(extractArtCmd, (artErr) => {
          if (!artErr && fs.existsSync(thumbPath)) {
            resolve({ duration, hasThumbnail: true });
          } else {
            // No cover art
            resolve({ duration, hasThumbnail: false });
          }
        });
      } else {
        // Extract video frame (at 2 seconds or 10% of duration, whichever is smaller)
        const timestamp = duration > 5 ? 2 : Math.max(0, duration / 2);
        const extractFrameCmd = `ffmpeg -ss ${timestamp} -i "${filePath}" -vframes 1 -q:v 2 -y "${thumbPath}"`;
        exec(extractFrameCmd, (frameErr) => {
          if (!frameErr && fs.existsSync(thumbPath)) {
            resolve({ duration, hasThumbnail: true });
          } else {
            resolve({ duration, hasThumbnail: false });
          }
        });
      }
    });
  });
}

// Live scan state, surfaced via /api/scan-status for the setup/home UI.
let scanState = { scanning: false, lastScan: null };

// Public entry point: tracks scanning state around the actual scan.
async function scanDirectories() {
  scanState.scanning = true;
  try {
    await runScanDirectories();
  } finally {
    scanState.scanning = false;
    scanState.lastScan = new Date().toISOString();
  }
}

// Scan directories and sync with database
async function runScanDirectories() {
  const db = loadDatabase();
  const currentFolders = db.folders || [];
  const scannedFiles = new Map(); // path -> file info

  for (const folder of currentFolders) {
    if (!fs.existsSync(folder)) {
      console.warn(`Configured folder does not exist: ${folder}`);
      continue;
    }
    scanDirRecursive(folder, folder, scannedFiles);
  }

  // Update db.metadata
  const newMetadata = {};
  let dbChanged = false;

  for (const [filePath, info] of scannedFiles.entries()) {
    const id = getMediaId(filePath);
    
    // If metadata already exists and file hasn't changed (based on size/mtime), reuse it
    if (db.metadata[id] && db.metadata[id].filePath === filePath && db.metadata[id].size === info.size) {
      newMetadata[id] = db.metadata[id];
    } else {
      // New or updated file
      console.log(`Scanning new/updated file: ${info.name}`);
      const isAudio = AUDIO_EXTENSIONS.includes(info.ext);
      
      // Initialize metadata entry
      newMetadata[id] = {
        id,
        name: info.name,
        title: path.basename(info.name, info.ext),
        filePath,
        folderName: info.folderName,
        size: info.size,
        ext: info.ext,
        type: isAudio ? 'audio' : 'video',
        addedAt: info.addedAt,
        duration: 0,
        hasThumbnail: false,
        needsTranscode: !isAudio && needsTranscode(info.ext)
      };

      try {
        const meta = await extractMetadataAndThumbnail(filePath, id, isAudio);
        newMetadata[id].duration = meta.duration;
        newMetadata[id].hasThumbnail = meta.hasThumbnail;
      } catch (err) {
        console.error(`Error extracting metadata for ${info.name}:`, err);
      }
      dbChanged = true;
    }
  }

  // Check if any files were deleted
  const oldIds = Object.keys(db.metadata);
  const newIds = Object.keys(newMetadata);
  if (oldIds.length !== newIds.length || oldIds.some(id => !newMetadata[id])) {
    dbChanged = true;
    // Clean up thumbnails for deleted files
    for (const oldId of oldIds) {
      if (!newMetadata[oldId]) {
        const thumbPath = path.join(THUMBNAIL_DIR, `${oldId}.jpg`);
        if (fs.existsSync(thumbPath)) {
          try {
            fs.unlinkSync(thumbPath);
          } catch (e) {
            console.error('Failed to delete obsolete thumbnail:', e);
          }
        }
        // Remove any transcoded MP4 sidecar
        const oldTranscode = transcodedPath(oldId);
        if (fs.existsSync(oldTranscode)) {
          try {
            fs.unlinkSync(oldTranscode);
          } catch (e) {
            console.error('Failed to delete obsolete transcode:', e);
          }
        }
        // Also remove watch progress
        if (db.progress[oldId]) {
          delete db.progress[oldId];
        }
      }
    }
  }

  // Backfill each item's configured root folder (for hidden-folder filtering) and
  // reconcile transcode state for browser-incompatible videos (queues jobs as needed).
  for (const item of Object.values(newMetadata)) {
    const newRoot = matchRootFolder(item.filePath, currentFolders);
    if (item.rootFolder !== newRoot) { item.rootFolder = newRoot; dbChanged = true; }
    if (reconcileTranscode(item)) dbChanged = true;
  }

  if (dbChanged) {
    db.metadata = newMetadata;
    saveDatabase(db);
    console.log('Database synced successfully.');
  }
}

// Recursive directory scanning helper
function scanDirRecursive(rootFolder, dirPath, results) {
  let files;
  try {
    files = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    console.error(`Error reading directory ${dirPath}:`, err);
    return;
  }

  for (const file of files) {
    const fullPath = path.join(dirPath, file.name);
    if (file.isDirectory()) {
      scanDirRecursive(rootFolder, fullPath, results);
    } else if (file.isFile()) {
      const ext = path.extname(file.name).toLowerCase();
      if (ALL_EXTENSIONS.includes(ext)) {
        try {
          const stats = fs.statSync(fullPath);
          // Folder name serves as the "channel name"
          // We can use the immediate parent directory name, or relative folder name from root
          let folderName = path.basename(dirPath);
          if (dirPath === rootFolder) {
            folderName = path.basename(rootFolder) || 'Library';
          }
          
          results.set(fullPath, {
            name: file.name,
            ext,
            size: stats.size,
            addedAt: stats.birthtimeMs || stats.mtimeMs,
            folderName
          });
        } catch (err) {
          console.error(`Error stating file ${fullPath}:`, err);
        }
      }
    }
  }
}

// Middleware
app.use(express.json());
// Serve the app assets with revalidation (no-cache) so updated HTML/JS/CSS show up
// immediately behind caches (browsers, nginx) instead of serving stale files.
// ETag/Last-Modified still allow cheap 304s when nothing changed.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache');
  }
}));

// Run scans periodically (every 10 minutes) and on startup
scanDirectories().catch(console.error);
setInterval(() => {
  scanDirectories().catch(console.error);
}, 10 * 60 * 1000);

// API: Get library folders list
app.get('/api/config', (req, res) => {
  const db = loadDatabase();
  res.json({ folders: db.folders || [], folderSettings: db.folderSettings || {} });
});

// API: Save folder configuration
app.post('/api/config', async (req, res) => {
  const { folders, folderSettings } = req.body;
  if (!Array.isArray(folders)) {
    return res.status(400).json({ error: 'folders must be an array of paths' });
  }

  // Validate that folders exist locally
  const validFolders = [];
  for (const folder of folders) {
    const trimmed = folder.trim();
    if (trimmed && fs.existsSync(trimmed)) {
      validFolders.push(trimmed);
    }
  }

  // Keep per-folder settings (display name / hidden), pruned to folders that still exist.
  const cleanSettings = {};
  if (folderSettings && typeof folderSettings === 'object') {
    for (const folder of validFolders) {
      const s = folderSettings[folder];
      if (s && typeof s === 'object') {
        cleanSettings[folder] = {
          name: typeof s.name === 'string' ? s.name.trim() : '',
          hidden: !!s.hidden
        };
      }
    }
  }

  const db = loadDatabase();
  db.folders = validFolders;
  db.folderSettings = cleanSettings;
  saveDatabase(db);

  res.json({ success: true, folders: db.folders, folderSettings: db.folderSettings });

  // Sync directories asynchronously in background
  scanDirectories().catch(console.error);
});

// API: Scan files on demand
app.post('/api/scan', async (req, res) => {
  try {
    await scanDirectories();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Live scan/transcode status for progress feedback in the UI
app.get('/api/scan-status', (req, res) => {
  const db = loadDatabase();
  const items = Object.values(db.metadata);
  const transcoding = items.filter(i =>
    i.needsTranscode && i.transcodeStatus && i.transcodeStatus !== 'ready' && i.transcodeStatus !== 'failed'
  ).length;
  res.json({
    scanning: scanState.scanning,
    lastScan: scanState.lastScan,
    fileCount: items.length,
    folderCount: (db.folders || []).length,
    transcoding
  });
});

// API: Get list of videos/audio
app.get('/api/videos', (req, res) => {
  const db = loadDatabase();
  const search = (req.query.search || '').toLowerCase().trim();
  const folderFilter = req.query.folder || '';
  
  let list = Object.values(db.metadata);

  // On the default (home/recent) view — no search, no folder filter — hide files from
  // folders the user marked hidden. Explicitly opening a folder still shows everything.
  if (!search && !folderFilter) {
    const settings = db.folderSettings || {};
    const hiddenRoots = new Set(Object.keys(settings).filter(f => settings[f] && settings[f].hidden));
    if (hiddenRoots.size > 0) {
      list = list.filter(item => !hiddenRoots.has(item.rootFolder));
    }
  }

  // Search filter
  if (search) {
    list = list.filter(item => item.title.toLowerCase().includes(search) || item.folderName.toLowerCase().includes(search));
  }

  // Folder uploader filter
  if (folderFilter) {
    list = list.filter(item => item.folderName === folderFilter);
  }

  // Map progress to lists
  const resultList = list.map(item => {
    const progress = db.progress[item.id] || { timestamp: 0, duration: 0 };
    return {
      ...item,
      progress: progress.timestamp,
      progressPercent: progress.duration > 0 ? (progress.timestamp / progress.duration) * 100 : 0
    };
  });

  // Sort by date added descending (newest first)
  resultList.sort((a, b) => b.addedAt - a.addedAt);

  res.json(resultList);
});

// API: Get details for single video/audio
app.get('/api/videos/:id', (req, res) => {
  const db = loadDatabase();
  const item = db.metadata[req.params.id];
  if (!item) {
    return res.status(404).json({ error: 'Media file not found' });
  }

  const progress = db.progress[item.id] || { timestamp: 0 };
  res.json({
    ...item,
    progress: progress.timestamp,
    transcodeProgress: transcodeProgress[item.id] || 0
  });
});

// API: Get watch progress
app.get('/api/progress/:id', (req, res) => {
  const db = loadDatabase();
  const progress = db.progress[req.params.id] || { timestamp: 0 };
  res.json(progress);
});

// API: Save watch progress
app.post('/api/progress', (req, res) => {
  const { id, timestamp, duration } = req.body;
  if (!id || typeof timestamp !== 'number') {
    return res.status(400).json({ error: 'id and numeric timestamp are required' });
  }

  const db = loadDatabase();
  // Verify it exists
  if (!db.metadata[id]) {
    return res.status(404).json({ error: 'Media not found' });
  }

  db.progress[id] = {
    timestamp,
    duration: duration || db.metadata[id].duration || 0,
    updatedAt: new Date().toISOString()
  };
  saveDatabase(db);
  res.json({ success: true });
});

// API: Delete video/audio file
app.delete('/api/videos/:id', (req, res) => {
  const db = loadDatabase();
  const item = db.metadata[req.params.id];
  if (!item) {
    return res.status(404).json({ error: 'Media file not found' });
  }

  const filePath = item.filePath;
  
  try {
    // Delete actual file from filesystem
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted file from disk: ${filePath}`);
    } else {
      console.warn(`File did not exist on disk when trying to delete: ${filePath}`);
    }

    // Clean up thumbnail
    const thumbPath = path.join(THUMBNAIL_DIR, `${item.id}.jpg`);
    if (fs.existsSync(thumbPath)) {
      fs.unlinkSync(thumbPath);
    }

    // Clean up transcoded MP4 sidecar, if any
    const transcodeFile = transcodedPath(item.id);
    if (fs.existsSync(transcodeFile)) {
      fs.unlinkSync(transcodeFile);
    }

    // Clean up database entries
    delete db.metadata[item.id];
    delete db.progress[item.id];
    saveDatabase(db);

    res.json({ success: true, message: 'File deleted successfully' });
  } catch (err) {
    console.error(`Error deleting file ${filePath}:`, err);
    res.status(500).json({ error: `Could not delete file: ${err.message}` });
  }
});

// Serve extracted thumbnail or fallback placeholder
app.get('/thumbnail/:id', (req, res) => {
  const db = loadDatabase();
  const item = db.metadata[req.params.id];
  const thumbPath = path.join(THUMBNAIL_DIR, `${req.params.id}.jpg`);

  if (item && item.hasThumbnail && fs.existsSync(thumbPath)) {
    return res.sendFile(thumbPath);
  }

  // Fallback: Generate SVG placeholder based on whether it is audio or video
  const isAudio = item ? item.type === 'audio' : false;
  const title = item ? item.title : 'Media';
  const bgColor = isAudio ? '#2b3e50' : '#4a154b';
  const icon = isAudio ? 
    `<path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" fill="#ffffff"/>` : 
    `<path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" fill="#ffffff"/>`;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" width="160" height="90">
      <rect width="160" height="90" fill="${bgColor}"/>
      <g transform="translate(68, 20) scale(1.2)">
        ${icon}
      </g>
      <text x="80" y="70" font-family="Arial, sans-serif" font-size="7" fill="#cccccc" text-anchor="middle" font-weight="bold">
        ${escapeHtml(title.length > 25 ? title.substring(0, 22) + '...' : title)}
      </text>
      <text x="80" y="80" font-family="Arial, sans-serif" font-size="5" fill="#888888" text-anchor="middle">
        ${isAudio ? 'AUDIO' : 'VIDEO'}
      </text>
    </svg>
  `;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svg);
});

// HTML escaping helper
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Live on-demand transcode for AVI-class files: pipe a fragmented MP4 (H.264/AAC)
// from FFmpeg straight to the client. Not byte-seekable — the client seeks by
// reloading the stream at ?t=<seconds> (fast input seek via -ss before -i).
function streamLiveTranscode(req, res, item) {
  if (!ffmpegAvailable) {
    return res.status(503).json({ error: 'FFmpeg is not available for transcoding' });
  }
  const srcPath = item.filePath;
  if (!fs.existsSync(srcPath)) {
    return res.status(404).json({ error: 'File does not exist on disk' });
  }

  const start = Math.max(0, parseFloat(req.query.t) || 0);

  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive'
    // No Content-Length / Accept-Ranges: this is a live, non-seekable stream.
  });

  const args = [];
  if (start > 0) args.push('-ss', String(start)); // fast seek before input
  args.push(
    '-i', srcPath,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', 'pipe:1'
  );

  let proc;
  try {
    proc = spawn('ffmpeg', args);
  } catch (e) {
    console.error(`Live transcode failed to start for ${srcPath}:`, e.message);
    return res.status(500).end();
  }

  proc.stdout.pipe(res);

  let errTail = '';
  proc.stderr.on('data', d => { errTail = (errTail + d.toString()).slice(-800); });
  proc.on('error', (e) => {
    console.error(`Live transcode error for ${srcPath}:`, e.message);
    try { res.end(); } catch (_) {}
  });
  proc.on('close', (code) => {
    // 255 / SIGKILL are expected when the client disconnects mid-stream.
    if (code && code !== 0 && code !== 255) {
      console.error(`Live transcode exit ${code} for ${srcPath}:\n${errTail}`);
    }
    try { res.end(); } catch (_) {}
  });

  // Stop FFmpeg as soon as the client goes away (seek, pause-then-close, navigation).
  req.on('close', () => { proc.kill('SIGKILL'); });
}

// Media streaming endpoint supporting Range requests (highly important for HTML5 seeking/skipping)
app.get('/video/:id', (req, res) => {
  const db = loadDatabase();
  const item = db.metadata[req.params.id];
  if (!item) {
    return res.status(404).json({ error: 'Media file not found' });
  }

  // Browser-incompatible containers (AVI, etc.) are transcoded live on demand.
  // Seeking is done by the client restarting the stream at ?t=<seconds>.
  if (item.needsTranscode) {
    return streamLiveTranscode(req, res, item);
  }

  const filePath = item.filePath;
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File does not exist on disk' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const contentType = mime.lookup(filePath) || (item.type === 'audio' ? 'audio/mpeg' : 'video/mp4');

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize) {
      res.status(416).send('Requested range not satisfiable\n' + start + ' >= ' + fileSize);
      return;
    }

    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    };

    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': contentType,
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`==================================================`);
  console.log(`  FileTube server running at http://localhost:${PORT}`);
  console.log(`==================================================`);
});
