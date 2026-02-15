# Plan 04 — Playback & Transport Controls

> **Owner:** Engineer B
> **Dependencies:** Plan 01 (decoded AudioBuffer), Plan 02 (bus/state), Plan 03 (transport DOM elements)
> **Estimated effort:** 3–4 hours
> **Files to create:** `js/audio-playback.js`

---

## Objective

Play the decoded audio through speakers, synced to the playhead that drives all charts. Support play/pause, seek, restart, mute, and loop region. Emit `playhead-update` events at ~60fps during playback so charts can animate.

---

## Architecture

Unlike the original (which uses `MediaElementSourceNode` from an `<audio>` tag), we use `AudioBufferSourceNode` which allows us to play directly from the decoded `AudioBuffer`. This gives us:

- Precise seek (sample-accurate)
- Loop regions
- No dependency on `<audio>` element
- The same `AudioBuffer` is also used by precompute (no double-decode)

### Audio Graph

```
AudioBufferSourceNode (re-created on each play)
    → GainNode (mute/volume)
        → AudioContext.destination (speakers)
```

---

## Interface

```js
/**
 * Initialize the playback engine.
 * Listens for bus events, binds to transport DOM buttons.
 * @param {EventBus} bus
 * @param {AppState} state
 */
export function initPlayback(bus, state) { ... }
```

---

## Implementation Details

### State Variables (module-scoped)

```js
let audioCtx = null;          // AudioContext (created on first user gesture)
let gainNode = null;           // GainNode for mute/volume
let sourceNode = null;         // AudioBufferSourceNode (recreated per play)
let audioBuffer = null;        // The decoded AudioBuffer
let startTime = 0;             // audioCtx.currentTime when playback started
let startOffset = 0;           // where in the buffer we started (seconds)
let rafId = null;              // requestAnimationFrame ID
let loopRegion = null;         // { startTime, endTime } or null
```

### Initialization

```js
export function initPlayback(bus, state) {
  // Store reference to audio buffer when file is decoded
  bus.on('data-ready', () => {
    const decoded = state.getDecoded();
    if (!decoded) return;

    // Create AudioBuffer from raw channel data
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioBuffer = audioCtx.createBuffer(
      2, decoded.numSamples, decoded.sampleRate
    );
    audioBuffer.copyToChannel(decoded.left, 0);
    audioBuffer.copyToChannel(decoded.right, 1);

    gainNode = audioCtx.createGain();
    gainNode.connect(audioCtx.destination);

    // Enable transport buttons
    document.getElementById('btn-play').disabled = false;
    document.getElementById('btn-restart').disabled = false;
    document.getElementById('btn-mute').disabled = false;
  });

  // Transport button handlers
  document.getElementById('btn-play').addEventListener('click', () => togglePlay(bus, state));
  document.getElementById('btn-restart').addEventListener('click', () => restart(bus, state));
  document.getElementById('btn-mute').addEventListener('click', () => toggleMute(bus, state));

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlay(bus, state);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        nudge(bus, state, e.shiftKey ? -10 : -1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        nudge(bus, state, e.shiftKey ? 10 : 1);
        break;
      case 'Home':
        e.preventDefault();
        seekTo(bus, state, 0);
        break;
      case 'End':
        e.preventDefault();
        seekTo(bus, state, audioBuffer?.duration || 0);
        break;
    }
  });

  // Seek requests from other modules
  bus.on('playhead-seek', ({ time }) => seekTo(bus, state, time));

  // Loop region changes from overview brush
  bus.on('loop-change', (region) => {
    loopRegion = region;
    // If currently playing and we've gone past the loop end, wrap back
    if (state.isPlaying() && loopRegion) {
      const current = getCurrentTime();
      if (current > loopRegion.endTime) {
        seekTo(bus, state, loopRegion.startTime);
      }
    }
  });

  // Mute toggle from bus
  bus.on('mute-toggle', ({ muted }) => {
    state.setMuted(muted);
    if (gainNode) gainNode.gain.value = muted ? 0 : 1;
    updateMuteButton(muted);
  });
}
```

### Play / Pause

```js
function togglePlay(bus, state) {
  if (state.isPlaying()) {
    pause(bus, state);
  } else {
    play(bus, state);
  }
}

function play(bus, state) {
  if (!audioBuffer || !audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  // Create a new source node (they are one-shot)
  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = audioBuffer;
  sourceNode.connect(gainNode);

  // Handle end of playback
  sourceNode.onended = () => {
    if (state.isPlaying()) {
      // If looping, wrap around
      if (loopRegion) {
        startOffset = loopRegion.startTime;
        play(bus, state);
        return;
      }
      pause(bus, state);
      bus.emit('playback-ended');
    }
  };

  startTime = audioCtx.currentTime;
  const offset = startOffset;

  if (loopRegion) {
    const duration = loopRegion.endTime - Math.max(offset, loopRegion.startTime);
    sourceNode.start(0, Math.max(offset, loopRegion.startTime), duration > 0 ? duration : undefined);
  } else {
    sourceNode.start(0, offset);
  }

  state.setPlaying(true);
  bus.emit('playback-started');
  updatePlayButton(true);
  startPlayheadLoop(bus, state);
}

function pause(bus, state) {
  if (sourceNode) {
    startOffset = getCurrentTime();
    try { sourceNode.stop(); } catch (e) { /* already stopped */ }
    sourceNode.disconnect();
    sourceNode = null;
  }
  state.setPlaying(false);
  cancelAnimationFrame(rafId);
  bus.emit('playback-paused');
  updatePlayButton(false);
}
```

### Playhead Animation Loop

```js
function startPlayheadLoop(bus, state) {
  function tick() {
    if (!state.isPlaying()) return;

    const time = getCurrentTime();
    const precomputed = state.getPrecomputed();
    if (!precomputed) return;

    // Loop wrap check
    if (loopRegion && time >= loopRegion.endTime) {
      startOffset = loopRegion.startTime;
      // Source will end and trigger onended → replay
      return;
    }

    // End of track check
    if (time >= audioBuffer.duration) {
      pause(bus, state);
      bus.emit('playback-ended');
      return;
    }

    // Compute current frame
    const frame = Math.floor((time * precomputed.sampleRate) / precomputed.hopSize);
    state.setCurrentFrame(frame);

    // Emit to all charts
    bus.emit('playhead-update', { frame, time });

    // Update time display
    updateTimeDisplay(time, audioBuffer.duration);

    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

function getCurrentTime() {
  if (!audioCtx || !state?.isPlaying()) return startOffset;
  return startOffset + (audioCtx.currentTime - startTime);
}
```

### Seek

```js
function seekTo(bus, state, time) {
  time = Math.max(0, Math.min(time, audioBuffer?.duration || 0));
  const wasPlaying = state.isPlaying();

  if (wasPlaying) {
    pause(bus, state);
  }

  startOffset = time;

  // Update frame and emit even when paused
  const precomputed = state.getPrecomputed();
  if (precomputed) {
    const frame = Math.floor((time * precomputed.sampleRate) / precomputed.hopSize);
    state.setCurrentFrame(frame);
    bus.emit('playhead-update', { frame, time });
  }

  updateTimeDisplay(time, audioBuffer?.duration || 0);

  if (wasPlaying) {
    play(bus, state);
  }
}

function nudge(bus, state, frames) {
  const precomputed = state.getPrecomputed();
  if (!precomputed) return;
  const currentFrame = state.getCurrentFrame();
  const newFrame = Math.max(0, Math.min(currentFrame + frames, precomputed.numFrames - 1));
  const newTime = (newFrame * precomputed.hopSize) / precomputed.sampleRate;
  seekTo(bus, state, newTime);
}

function restart(bus, state) {
  seekTo(bus, state, 0);
  if (!state.isPlaying()) {
    play(bus, state);
  }
}
```

### Mute

```js
function toggleMute(bus, state) {
  const muted = !state.isMuted();
  state.setMuted(muted);
  if (gainNode) gainNode.gain.value = muted ? 0 : 1;
  updateMuteButton(muted);
  bus.emit('mute-toggle', { muted });
}
```

### DOM Updates (helpers)

```js
function updatePlayButton(playing) {
  const btn = document.getElementById('btn-play');
  btn.textContent = playing ? '⏸' : '▶';
  btn.title = playing ? 'Pause' : 'Play';
}

function updateMuteButton(muted) {
  const btn = document.getElementById('btn-mute');
  btn.textContent = muted ? '🔇' : '🔊';
}

function updateTimeDisplay(current, total) {
  document.getElementById('time-current').textContent = formatTime(current);
  document.getElementById('time-total').textContent = formatTime(total);
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`;
}
```

---

## Edge Cases

| Case | Handling |
|---|---|
| User presses play before data-ready | Button is disabled until `data-ready` |
| AudioContext suspended (browser policy) | Call `audioCtx.resume()` on play |
| Seek while paused | Update playhead position but don't start playback |
| Seek past end of file | Clamp to `duration` |
| Loop region removed during playback | Continue playing to end of track normally |
| Very short file (<1s) | Works fine — loop region may be tiny |
| Browser tab hidden | `requestAnimationFrame` throttles; audio continues but chart updates pause. Resume on tab focus. |

---

## Testing / Verification

- [ ] Upload a WAV file → press Play → audio plays through speakers
- [ ] Press Pause → audio stops, playhead freezes
- [ ] Press Play again → resumes from where it left off
- [ ] Click Restart → playback jumps to 0:00 and plays
- [ ] Mute → audio silent, charts still animate
- [ ] Seek to middle of track (via `playhead-seek` event) → audio plays from new position
- [ ] Arrow keys nudge playhead by 1 / 10 frames
- [ ] Space bar toggles play/pause
- [ ] Loop region set → audio loops within region
- [ ] Time display updates during playback

---

## Acceptance Criteria

- [ ] Audio plays through speakers with correct pitch and timing
- [ ] `playhead-update` events fire at ~60fps during playback with accurate `frame` and `time`
- [ ] Seek is sample-accurate (no audible glitch on resume)
- [ ] Mute toggle works without disrupting playback position
- [ ] Loop region correctly wraps playback
- [ ] All keyboard shortcuts work (Space, arrows, Home, End)
- [ ] Transport buttons update visual state correctly
- [ ] No memory leaks from `AudioBufferSourceNode` recreation
