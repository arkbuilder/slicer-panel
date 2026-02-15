import { BUS_EVENTS, formatTime } from './state.js';

let audioCtx = null;
let gainNode = null;
let sourceNode = null;
let audioBuffer = null;
let activeDecodedRef = null;
let startOffset = 0;
let startTime = 0;
let wallClockStartMs = 0;
let rafId = null;
let loopRegion = null;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function ensureAudioContext() {
  if (audioCtx && audioCtx.state !== 'closed') {
    return audioCtx;
  }

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    return null;
  }

  audioCtx = new AudioCtx();
  return audioCtx;
}

function ensureGainNode(state) {
  if (!audioCtx) {
    return null;
  }

  if (!gainNode) {
    gainNode = audioCtx.createGain();
    gainNode.connect(audioCtx.destination);
  }

  gainNode.gain.value = state.isMuted() ? 0 : 1;
  return gainNode;
}

function stopSourceNode() {
  if (!sourceNode) {
    return;
  }

  const node = sourceNode;
  sourceNode = null;
  node.onended = null;
  try {
    node.stop();
  } catch (error) {
    // One-shot source may already be stopped.
  }
  node.disconnect();
}

function stopRafLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function sanitizeLoopRegion(region, duration) {
  if (!region || !Number.isFinite(region.startTime) || !Number.isFinite(region.endTime)) {
    return null;
  }

  const startTime = clamp(Math.min(region.startTime, region.endTime), 0, duration);
  const endTime = clamp(Math.max(region.startTime, region.endTime), 0, duration);
  if (endTime <= startTime) {
    return null;
  }
  return { startTime, endTime };
}

function shouldHandleKey(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return true;
  }

  if (target.isContentEditable) {
    return false;
  }

  const tagName = target.tagName;
  return tagName !== 'INPUT' && tagName !== 'TEXTAREA' && tagName !== 'SELECT';
}

function updatePlayButton(playing) {
  const button = document.getElementById('btn-play');
  if (!button) {
    return;
  }
  button.textContent = playing ? 'PAUSE' : 'PLAY';
}

function updateMuteButton(muted) {
  const button = document.getElementById('btn-mute');
  if (!button) {
    return;
  }
  button.textContent = muted ? 'UNMUTE' : 'MUTE';
  button.classList.toggle('is-muted', muted);
}

function setTransportEnabled(enabled) {
  for (const id of ['btn-play', 'btn-restart', 'btn-mute']) {
    const node = document.getElementById(id);
    if (node) {
      node.disabled = !enabled;
    }
  }
}

function updateTimeDisplay(current, total) {
  const currentNode = document.getElementById('time-current');
  const totalNode = document.getElementById('time-total');

  if (currentNode) {
    currentNode.textContent = formatTime(current);
  }
  if (totalNode) {
    totalNode.textContent = formatTime(total);
  }
}

function createAudioBufferFromDecoded(decoded, state) {
  const context = ensureAudioContext();
  if (!context || !decoded) {
    return null;
  }

  ensureGainNode(state);

  const sampleRate = Number(decoded.sampleRate) || 0;
  const numSamples = Number(decoded.numSamples) || 0;
  if (!sampleRate || !numSamples) {
    return null;
  }

  const left = decoded.left instanceof Float32Array ? decoded.left : new Float32Array(decoded.left || []);
  const right = decoded.right instanceof Float32Array ? decoded.right : new Float32Array(decoded.right || []);

  const safeSamples = Math.min(numSamples, left.length, right.length || left.length);
  const out = context.createBuffer(2, safeSamples, sampleRate);
  out.copyToChannel(left.subarray(0, safeSamples), 0);
  out.copyToChannel((right.length ? right : left).subarray(0, safeSamples), 1);
  return out;
}

export function initPlayback(bus, state) {
  const offHandlers = [];

  let keyHandler = null;

  const getDuration = () => (audioBuffer ? audioBuffer.duration : 0);

  const getCurrentTime = () => {
    if (!state.isPlaying()) {
      return startOffset;
    }

    const wallClockSeconds = startOffset + Math.max(0, (performance.now() - wallClockStartMs) / 1000);
    if (!audioCtx) {
      return wallClockSeconds;
    }

    const audioSeconds = startOffset + Math.max(0, audioCtx.currentTime - startTime);
    if (audioCtx.state !== 'running') {
      return wallClockSeconds;
    }

    // Some environments can stall the audio clock (headless, hidden tabs).
    return Math.max(audioSeconds, wallClockSeconds);
  };

  const emitPlayhead = (time) => {
    const duration = getDuration();
    const safeTime = clamp(time, 0, duration);
    const frame = state.timeToFrame(safeTime);
    state.setCurrentFrame(frame);
    bus.emit(BUS_EVENTS.PLAYHEAD_UPDATE, {
      frame,
      time: safeTime,
    });
    updateTimeDisplay(safeTime, duration);
  };

  const stopPlaybackState = (emitPausedEvent) => {
    const wasPlaying = state.isPlaying();
    const time = clamp(getCurrentTime(), 0, getDuration());
    startOffset = time;

    stopRafLoop();
    stopSourceNode();

    state.setPlaying(false);
    updatePlayButton(false);

    if (emitPausedEvent && wasPlaying) {
      bus.emit(BUS_EVENTS.PLAYBACK_PAUSED);
    }
  };

  const runPlayheadLoop = () => {
    stopRafLoop();

    const tick = () => {
      if (!state.isPlaying()) {
        rafId = null;
        return;
      }

      const duration = getDuration();
      const time = clamp(getCurrentTime(), 0, duration);

      if (loopRegion && time >= loopRegion.endTime) {
        seekTo(loopRegion.startTime);
        rafId = requestAnimationFrame(tick);
        return;
      }

      if (time >= duration) {
        stopPlaybackState(false);
        startOffset = duration;
        emitPlayhead(duration);
        bus.emit(BUS_EVENTS.PLAYBACK_ENDED);
        return;
      }

      emitPlayhead(time);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
  };

  const startSourceAt = async (offsetTime) => {
    if (!audioBuffer) {
      return false;
    }

    const context = ensureAudioContext();
    const gain = ensureGainNode(state);
    if (!context || !gain) {
      return false;
    }

    if (context.state === 'suspended') {
      try {
        await context.resume();
      } catch (error) {
        console.warn('[playback] Unable to resume AudioContext.', error);
      }
    }

    let offset = clamp(offsetTime, 0, audioBuffer.duration);

    if (loopRegion) {
      if (offset < loopRegion.startTime || offset >= loopRegion.endTime) {
        offset = loopRegion.startTime;
      }
    }

    const node = context.createBufferSource();
    node.buffer = audioBuffer;
    node.connect(gain);

    node.onended = () => {
      if (sourceNode !== node) {
        return;
      }
      sourceNode = null;

      if (!state.isPlaying()) {
        return;
      }

      if (loopRegion) {
        startOffset = loopRegion.startTime;
        void startSourceAt(startOffset);
        return;
      }

      stopPlaybackState(false);
      startOffset = getDuration();
      emitPlayhead(startOffset);
      bus.emit(BUS_EVENTS.PLAYBACK_ENDED);
    };

    sourceNode = node;
    startOffset = offset;
    startTime = context.currentTime;
    wallClockStartMs = performance.now();

    if (loopRegion) {
      const regionDuration = Math.max(0.001, loopRegion.endTime - offset);
      node.start(0, offset, regionDuration);
    } else {
      node.start(0, offset);
    }

    return true;
  };

  const play = async () => {
    if (!audioBuffer || state.isPlaying()) {
      return;
    }

    stopSourceNode();

    if (startOffset >= getDuration()) {
      startOffset = loopRegion ? loopRegion.startTime : 0;
    }

    const started = await startSourceAt(startOffset);
    if (!started) {
      state.setPlaying(false);
      updatePlayButton(false);
      return;
    }

    state.setPlaying(true);
    updatePlayButton(true);
    bus.emit(BUS_EVENTS.PLAYBACK_STARTED);
    runPlayheadLoop();
  };

  const pause = () => {
    stopPlaybackState(true);
    emitPlayhead(startOffset);
  };

  const seekTo = async (time) => {
    const duration = getDuration();
    const nextTime = clamp(Number(time) || 0, 0, duration);
    const wasPlaying = state.isPlaying();

    stopPlaybackState(false);
    startOffset = nextTime;
    emitPlayhead(nextTime);

    if (wasPlaying) {
      await play();
    }
  };

  const nudge = async (frameDelta) => {
    const precomputed = state.getPrecomputed();
    if (!precomputed || !Number.isFinite(precomputed.numFrames) || precomputed.numFrames <= 0) {
      return;
    }

    const current = clamp(state.getCurrentFrame(), 0, precomputed.numFrames - 1);
    const nextFrame = clamp(current + frameDelta, 0, precomputed.numFrames - 1);
    const nextTime = state.frameToTime(nextFrame);
    await seekTo(nextTime);
  };

  const restart = async () => {
    await seekTo(0);
    if (!state.isPlaying()) {
      await play();
    }
  };

  const setMuted = (muted) => {
    const safeMuted = Boolean(muted);
    state.setMuted(safeMuted);
    if (gainNode) {
      gainNode.gain.value = safeMuted ? 0 : 1;
    }
    updateMuteButton(safeMuted);
  };

  const toggleMute = () => {
    const next = !state.isMuted();
    setMuted(next);
    bus.emit(BUS_EVENTS.MUTE_TOGGLE, { muted: next });
  };

  const prepareFromState = () => {
    const decoded = state.getDecoded();
    if (!decoded) {
      return;
    }

    if (decoded !== activeDecodedRef) {
      audioBuffer = createAudioBufferFromDecoded(decoded, state);
      activeDecodedRef = decoded;
      startOffset = 0;
      loopRegion = sanitizeLoopRegion(state.getLoop(), getDuration());
      state.setCurrentFrame(0);
    }

    setMuted(state.isMuted());
    updateTimeDisplay(startOffset, getDuration());
    setTransportEnabled(Boolean(audioBuffer));
  };

  const onPlayClick = () => {
    if (state.isPlaying()) {
      pause();
    } else {
      void play();
    }
  };

  const onRestartClick = () => {
    void restart();
  };

  const onMuteClick = () => {
    toggleMute();
  };

  const playButton = document.getElementById('btn-play');
  const restartButton = document.getElementById('btn-restart');
  const muteButton = document.getElementById('btn-mute');

  playButton?.addEventListener('click', onPlayClick);
  restartButton?.addEventListener('click', onRestartClick);
  muteButton?.addEventListener('click', onMuteClick);

  keyHandler = (event) => {
    if (!shouldHandleKey(event)) {
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      onPlayClick();
      return;
    }

    if (event.code === 'ArrowLeft') {
      event.preventDefault();
      void nudge(event.shiftKey ? -10 : -1);
      return;
    }

    if (event.code === 'ArrowRight') {
      event.preventDefault();
      void nudge(event.shiftKey ? 10 : 1);
      return;
    }

    if (event.code === 'Home') {
      event.preventDefault();
      void seekTo(0);
      return;
    }

    if (event.code === 'End') {
      event.preventDefault();
      void seekTo(getDuration());
    }
  };

  document.addEventListener('keydown', keyHandler);

  offHandlers.push(bus.on(BUS_EVENTS.DATA_READY, () => {
    prepareFromState();
    emitPlayhead(0);
  }));

  offHandlers.push(bus.on(BUS_EVENTS.FILE_LOADED, (payload) => {
    updateTimeDisplay(0, Number(payload?.duration) || 0);
  }));

  offHandlers.push(bus.on(BUS_EVENTS.PLAYHEAD_SEEK, (payload) => {
    void seekTo(payload?.time);
  }));

  offHandlers.push(bus.on(BUS_EVENTS.BOOKMARK_JUMP, (payload) => {
    void seekTo(payload?.time);
  }));

  offHandlers.push(bus.on(BUS_EVENTS.LOOP_CHANGE, (payload) => {
    loopRegion = sanitizeLoopRegion(payload, getDuration());
    state.setLoop(loopRegion);

    if (state.isPlaying() && loopRegion) {
      const current = getCurrentTime();
      if (current < loopRegion.startTime || current >= loopRegion.endTime) {
        void seekTo(loopRegion.startTime);
      }
    }
  }));

  offHandlers.push(bus.on(BUS_EVENTS.MUTE_TOGGLE, (payload) => {
    if (!payload || typeof payload.muted === 'undefined') {
      return;
    }
    setMuted(payload.muted);
  }));

  offHandlers.push(bus.on(BUS_EVENTS.FILE_LOADED, () => {
    setTransportEnabled(false);
  }));

  setTransportEnabled(false);
  updatePlayButton(false);
  updateMuteButton(state.isMuted());

  return () => {
    for (const off of offHandlers) {
      off();
    }

    playButton?.removeEventListener('click', onPlayClick);
    restartButton?.removeEventListener('click', onRestartClick);
    muteButton?.removeEventListener('click', onMuteClick);

    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler);
    }

    stopPlaybackState(false);
  };
}
