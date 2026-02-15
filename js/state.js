export const BUS_EVENTS = Object.freeze({
  FILE_LOADED: 'file-loaded',
  PRECOMPUTE_PROGRESS: 'precompute-progress',
  PRECOMPUTE_ERROR: 'precompute-error',
  DATA_READY: 'data-ready',
  PLAYBACK_STARTED: 'playback-started',
  PLAYBACK_PAUSED: 'playback-paused',
  PLAYBACK_ENDED: 'playback-ended',
  PLAYHEAD_UPDATE: 'playhead-update',
  PLAYHEAD_SEEK: 'playhead-seek',
  BRUSH_CHANGE: 'brush-change',
  LOOP_CHANGE: 'loop-change',
  HOVER_BAND: 'hover-band',
  HOVER_FRAME: 'hover-frame',
  POWER_CHANGE: 'power-change',
  FAULT_CLICK: 'fault-click',
  BOOKMARK_ADD: 'bookmark-add',
  BOOKMARK_JUMP: 'bookmark-jump',
  MUTE_TOGGLE: 'mute-toggle',
  THEME_LOADED: 'theme-loaded',
  RESIZE: 'resize',
  TOOLTIP_SHOW: 'tooltip-show',
  TOOLTIP_HIDE: 'tooltip-hide',
  FILE_WARNING: 'file-warning',
  FLASH_MESSAGE: 'flash-message',
});

const DEFAULT_POWER_WEIGHTS = Object.freeze({
  sensors: 1,
  comms: 1,
  targeting: 1,
  diagnostics: 1,
});

export function frameToTime(frame, hopSize, sampleRate) {
  if (!Number.isFinite(frame) || !hopSize || !sampleRate) {
    return 0;
  }
  return (frame * hopSize) / sampleRate;
}

export function timeToFrame(time, hopSize, sampleRate) {
  if (!Number.isFinite(time) || !hopSize || !sampleRate) {
    return 0;
  }
  return Math.max(0, Math.round((time * sampleRate) / hopSize));
}

export function timeToSample(time, sampleRate) {
  if (!Number.isFinite(time) || !sampleRate) {
    return 0;
  }
  return Math.max(0, Math.round(time * sampleRate));
}

export function formatTime(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const secs = (safeSeconds % 60).toFixed(1).padStart(4, '0');
  return `${minutes}:${secs}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sanitizeBrush(range) {
  if (!range || !Number.isFinite(range.startFrame) || !Number.isFinite(range.endFrame)) {
    return null;
  }
  const startFrame = Math.floor(Math.min(range.startFrame, range.endFrame));
  const endFrame = Math.floor(Math.max(range.startFrame, range.endFrame));
  return {
    startFrame: Math.max(0, startFrame),
    endFrame: Math.max(0, endFrame),
  };
}

function sanitizeLoop(range) {
  if (!range || !Number.isFinite(range.startTime) || !Number.isFinite(range.endTime)) {
    return null;
  }
  const startTime = Math.max(0, Math.min(range.startTime, range.endTime));
  const endTime = Math.max(0, Math.max(range.startTime, range.endTime));
  if (endTime <= startTime) {
    return null;
  }
  return { startTime, endTime };
}

export function createState() {
  let precomputed = null;
  let decoded = null;
  let fileMeta = null;
  let currentFrame = 0;
  let brush = null;
  let loop = null;
  let playing = false;
  let muted = false;
  let bookmarks = [];
  let powerWeights = { ...DEFAULT_POWER_WEIGHTS };

  function getTimingReference() {
    if (precomputed?.hopSize && precomputed?.sampleRate) {
      return {
        hopSize: precomputed.hopSize,
        sampleRate: precomputed.sampleRate,
        numFrames: precomputed.numFrames,
      };
    }

    if (decoded?.sampleRate) {
      return {
        hopSize: 512,
        sampleRate: decoded.sampleRate,
        numFrames: null,
      };
    }

    return null;
  }

  return {
    getPrecomputed() {
      return precomputed;
    },
    setPrecomputed(data) {
      precomputed = data || null;
      if (precomputed && Number.isFinite(precomputed.numFrames)) {
        currentFrame = clamp(currentFrame, 0, Math.max(0, precomputed.numFrames - 1));
      } else {
        currentFrame = 0;
      }
    },

    getDecoded() {
      return decoded;
    },
    setDecoded(data) {
      decoded = data || null;
      currentFrame = 0;
      brush = null;
      loop = null;
    },

    getFileMeta() {
      return fileMeta ? { ...fileMeta } : null;
    },
    setFileMeta(meta) {
      fileMeta = meta ? { ...meta } : null;
    },

    getCurrentFrame() {
      return currentFrame;
    },
    setCurrentFrame(frame) {
      const timing = getTimingReference();
      const raw = Number.isFinite(frame) ? Math.floor(frame) : 0;
      if (timing?.numFrames) {
        currentFrame = clamp(raw, 0, Math.max(0, timing.numFrames - 1));
      } else {
        currentFrame = Math.max(0, raw);
      }
    },

    frameToTime(frame = currentFrame) {
      const timing = getTimingReference();
      if (!timing) {
        return 0;
      }
      return frameToTime(frame, timing.hopSize, timing.sampleRate);
    },

    timeToFrame(time) {
      const timing = getTimingReference();
      if (!timing) {
        return 0;
      }
      const frame = timeToFrame(time, timing.hopSize, timing.sampleRate);
      if (timing.numFrames) {
        return clamp(frame, 0, Math.max(0, timing.numFrames - 1));
      }
      return frame;
    },

    formatTime,

    getBrush() {
      return brush ? { ...brush } : null;
    },
    setBrush(range) {
      brush = sanitizeBrush(range);
    },

    getLoop() {
      return loop ? { ...loop } : null;
    },
    setLoop(range) {
      loop = sanitizeLoop(range);
    },

    getPowerWeights() {
      return { ...powerWeights };
    },
    setPowerWeights(weights) {
      powerWeights = {
        ...powerWeights,
        ...weights,
      };
    },

    getBookmarks() {
      return bookmarks.map((bookmark) => ({ ...bookmark }));
    },
    addBookmark(bookmark) {
      if (!bookmark || !Number.isFinite(bookmark.time)) {
        return null;
      }
      const safe = {
        time: Math.max(0, bookmark.time),
        label: String(bookmark.label || `BK-${bookmarks.length + 1}`),
      };
      bookmarks.push(safe);
      bookmarks.sort((a, b) => a.time - b.time);
      return { ...safe };
    },
    removeBookmark(index) {
      if (!Number.isInteger(index)) {
        return;
      }
      if (index < 0 || index >= bookmarks.length) {
        return;
      }
      bookmarks.splice(index, 1);
    },
    clearBookmarks() {
      bookmarks = [];
    },

    isPlaying() {
      return playing;
    },
    setPlaying(value) {
      playing = Boolean(value);
    },

    isMuted() {
      return muted;
    },
    setMuted(value) {
      muted = Boolean(value);
    },
  };
}
