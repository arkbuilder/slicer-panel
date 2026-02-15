/**
 * live-main.js — Full-screen beat-synced visualisation mode.
 *
 * Reuses every chart module from the main Slicer Panel but displays
 * one chart at a time, switching on each detected onset/beat.
 */

import { createBus } from './bus.js';
import { createState, BUS_EVENTS, formatTime } from './state.js';
import { initDecode } from './audio-decode.js';
import { initPrecompute } from './precompute.js';
import { initPlayback } from './audio-playback.js';
import { initOverviewWaveform } from './charts/overview-waveform.js';
import { initSpectrogram } from './charts/spectrogram.js';
import { initBandHeatmap } from './charts/band-heatmap.js';
import { initDecryptionRing } from './charts/decryption-ring.js';
import { initInstantSpectrum } from './charts/instant-spectrum.js';
import { initPhaseScope } from './charts/phase-scope.js';
import { initOscilloscope } from './charts/oscilloscope.js';

/* ── helpers ──────────────────────────────────────────────── */

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

/* ── boot ─────────────────────────────────────────────────── */

function boot() {
  const bus  = createBus();
  const state = createState();

  /* ── DOM refs ────────────────────────────────────────────── */
  const uploadOverlay   = document.getElementById('live-upload-overlay');
  const chooseBtn       = document.getElementById('live-choose-file');
  const fileInput       = document.getElementById('live-file-input');
  const progressOverlay = document.getElementById('live-progress-overlay');
  const progressFill    = document.getElementById('live-progress-fill');
  const progressStage   = document.getElementById('live-progress-stage');
  const hud             = document.getElementById('live-hud');
  const hudBeat         = document.getElementById('hud-beat');
  const hudTime         = document.getElementById('hud-time');
  const chartLabel      = document.getElementById('chart-label');
  const beatFlash       = document.getElementById('beat-flash');
  const playBtn         = document.getElementById('live-play');
  const timeDisplay     = document.getElementById('live-time');
  const fullscreenBtn   = document.getElementById('live-fullscreen');
  const backBtn         = document.getElementById('live-back');
  const controlsBar     = document.getElementById('live-controls');
  const layers          = Array.from(document.querySelectorAll('.live-layer'));

  /* ── Canvas resize (fill viewport) ──────────────────────── */
  const resizeCanvases = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const layer of layers) {
      const canvas = layer.querySelector('canvas');
      if (!(canvas instanceof HTMLCanvasElement)) continue;
      const w = Math.max(1, Math.round(window.innerWidth  * dpr));
      const h = Math.max(1, Math.round(window.innerHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
      }
    }
    bus.emit(BUS_EVENTS.RESIZE);
  };

  let resizeRaf = null;
  window.addEventListener('resize', () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => { resizeRaf = null; resizeCanvases(); });
  });
  resizeCanvases();

  /* ── File upload (drag-drop + click) ────────────────────── */
  const nativeFileInput = document.getElementById('file-input');
  const nativeDropZone  = document.getElementById('drop-zone');

  chooseBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
      // Copy file to the native input that initDecode watches
      const dt = new DataTransfer();
      dt.items.add(fileInput.files[0]);
      nativeFileInput.files = dt.files;
      nativeFileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  // Drag-drop on entire page → forward to native file input
  document.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  document.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      const dt = new DataTransfer();
      dt.items.add(file);
      nativeFileInput.files = dt.files;
      nativeFileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  /* ── Init core pipeline ─────────────────────────────────── */
  const nativePlayBtn = document.getElementById('btn-play');

  const cleanups = [
    initDecode(bus, state),
    initPrecompute(bus, state),
    initPlayback(bus, state),
  ];

  /* ── Init chart modules ─────────────────────────────────── */
  cleanups.push(
    initDecryptionRing('ring-canvas', bus, state),
    initInstantSpectrum('spectrum-canvas', bus, state),
    initSpectrogram('spectrogram-canvas', bus, state),
    initBandHeatmap('heatmap-canvas', bus, state),
    initPhaseScope('phase-scope-canvas', bus, state),
    initOscilloscope('oscilloscope-canvas', bus, state),
    initOverviewWaveform('overview-canvas', bus, state),
  );

  /* ── Overlay / progress wiring ──────────────────────────── */

  // As soon as user picks a file, show progress (decode starts immediately)
  fileInput.addEventListener('change', () => {
    uploadOverlay.classList.add('hidden');
    progressOverlay.classList.remove('hidden');
    if (progressFill) progressFill.style.width = '0%';
    if (progressStage) progressStage.textContent = 'Decoding audio...';
  });

  bus.on(BUS_EVENTS.PRECOMPUTE_PROGRESS, ({ percent, stage }) => {
    if (progressFill) progressFill.style.width = `${clamp(percent || 0, 0, 100)}%`;
    if (progressStage) progressStage.textContent = stage || 'Processing...';
  });

  bus.on(BUS_EVENTS.DATA_READY, () => {
    progressOverlay.classList.add('hidden');
    playBtn.disabled = false;
    hud.classList.add('visible');
    controlsBar.classList.add('visible');

    // Build onset times for beat switching
    buildOnsetSchedule();
    resizeCanvases();

    // Auto-play
    setTimeout(() => { if (nativePlayBtn) nativePlayBtn.click(); }, 300);
  });

  bus.on(BUS_EVENTS.PRECOMPUTE_ERROR, ({ message }) => {
    if (progressStage) progressStage.textContent = message || 'Analysis failed.';
  });

  /* ── Beat schedule ──────────────────────────────────────── */

  let onsetTimes = [];   // sorted seconds
  let nextOnsetIdx = 0;
  const MIN_SWITCH_GAP = 5.0; // minimum 5 seconds per chart
  let lastSwitchTime = -Infinity;
  let beatCount = 0;

  function buildOnsetSchedule() {
    const pre = state.getPrecomputed();
    if (!pre || !pre.onsets || pre.onsets.length === 0) {
      onsetTimes = [];
      return;
    }
    onsetTimes = Array.from(pre.onsets).map((f) => state.frameToTime(f));
    nextOnsetIdx = 0;
    beatCount = 0;
  }

  /* ── Transition effects registry ────────────────────────── */

  const TRANSITION_EFFECTS = [
    { enter: 'fx-glitch-enter',      exit: 'fx-glitch-exit' },
    { enter: 'fx-zoom-rotate-enter', exit: 'fx-zoom-rotate-exit' },
    { enter: 'fx-slide-enter',       exit: 'fx-slide-exit' },
    { enter: 'fx-iris-enter',        exit: 'fx-iris-exit' },
    { enter: 'fx-scan-enter',        exit: 'fx-scan-exit' },
    { enter: 'fx-blur-flash-enter',  exit: 'fx-blur-flash-exit' },
    { enter: 'fx-diamond-enter',     exit: 'fx-diamond-exit' },
    { enter: 'fx-pixel-enter',       exit: 'fx-pixel-exit' },
  ];

  const ALL_FX_CLASSES = TRANSITION_EFFECTS.flatMap(e => [e.enter, e.exit]);
  let lastEffectIdx = -1;
  let transitionInProgress = false;

  function pickEffect() {
    let idx;
    do {
      idx = Math.floor(Math.random() * TRANSITION_EFFECTS.length);
    } while (idx === lastEffectIdx && TRANSITION_EFFECTS.length > 1);
    lastEffectIdx = idx;
    return TRANSITION_EFFECTS[idx];
  }

  function stripFxClasses(el) {
    el.classList.remove(...ALL_FX_CLASSES);
  }

  /* ── Chart switching ────────────────────────────────────── */

  let currentLayerIdx = 0;
  let chartLabelTimer = null;

  function activateLayer(idx) {
    if (idx === currentLayerIdx || transitionInProgress) return;
    transitionInProgress = true;

    const outgoing = layers[currentLayerIdx];
    const incoming = layers[idx];
    const effect   = pickEffect();

    // Clean any leftover FX classes
    for (const l of layers) stripFxClasses(l);

    // Incoming starts above outgoing
    incoming.style.zIndex = '3';
    outgoing.style.zIndex = '2';
    incoming.classList.add('active');

    // Apply animation classes
    incoming.classList.add(effect.enter);
    outgoing.classList.add(effect.exit);

    // When enter animation ends, clean up
    const onEnd = () => {
      incoming.removeEventListener('animationend', onEnd);
      outgoing.classList.remove('active');
      stripFxClasses(incoming);
      stripFxClasses(outgoing);
      incoming.style.zIndex = '';
      outgoing.style.zIndex = '';
      transitionInProgress = false;
    };
    incoming.addEventListener('animationend', onEnd, { once: true });

    // Safety fallback — force cleanup after 1.2s
    setTimeout(() => {
      if (transitionInProgress) onEnd();
    }, 1200);

    currentLayerIdx = idx;

    // Show label briefly
    const label = layers[idx]?.dataset.label || '';
    if (chartLabel) {
      chartLabel.textContent = label;
      chartLabel.classList.add('visible');
      clearTimeout(chartLabelTimer);
      chartLabelTimer = setTimeout(() => chartLabel.classList.remove('visible'), 1800);
    }
  }

  // Pick a random next layer (avoid repeating same)
  function pickNextLayer() {
    if (layers.length <= 1) return 0;
    let next;
    do {
      next = Math.floor(Math.random() * layers.length);
    } while (next === currentLayerIdx);
    return next;
  }

  // Flash a border/edge glow on beat (fires on EVERY beat, not just switches)
  let flashTimer = null;
  function flashBeat() {
    if (!beatFlash) return;

    // Pick a colour from the active chart's palette
    const colours = [
      'radial-gradient(ellipse at center, rgba(0,212,255,0.12) 0%, transparent 70%)',
      'radial-gradient(ellipse at center, rgba(255,170,0,0.10) 0%, transparent 70%)',
      'radial-gradient(ellipse at center, rgba(78,225,152,0.10) 0%, transparent 70%)',
      'radial-gradient(ellipse at center, rgba(255,51,68,0.08) 0%, transparent 70%)',
    ];
    beatFlash.style.background = colours[beatCount % colours.length];
    beatFlash.classList.add('flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => beatFlash.classList.remove('flash'), 100);
  }

  // Show first layer
  activateLayer(0);
  // Reset — first layer activation guard
  currentLayerIdx = 0;
  layers[0].classList.add('active');
  transitionInProgress = false;

  /* ── Playhead tracking — fire beat switches ─────────────── */

  bus.on(BUS_EVENTS.PLAYHEAD_UPDATE, ({ time }) => {
    const t = Number(time) || 0;

    // Update HUD time
    const dur = state.getPrecomputed()?.duration || 0;
    if (hudTime) hudTime.textContent = `${formatTime(t)} / ${formatTime(dur)}`;
    if (timeDisplay) timeDisplay.textContent = `${formatTime(t)} / ${formatTime(dur)}`;

    // Check if we crossed an onset
    while (nextOnsetIdx < onsetTimes.length && onsetTimes[nextOnsetIdx] <= t) {
      const onsetT = onsetTimes[nextOnsetIdx];
      nextOnsetIdx++;
      if (t - onsetT < 0.35) {
        beatCount++;
        flashBeat();  // flash on EVERY beat for visual energy
        if (hudBeat) hudBeat.textContent = `BEAT ${beatCount}`;

        // Only switch chart if enough time has passed
        if (t - lastSwitchTime >= MIN_SWITCH_GAP) {
          lastSwitchTime = t;
          activateLayer(pickNextLayer());
        }
      }
    }
  });

  bus.on(BUS_EVENTS.PLAYHEAD_SEEK, () => {
    // Reset onset pointer after seek
    const t = (state.getPrecomputed()?.duration || 0) > 0
      ? state.frameToTime(state.getCurrentFrame())
      : 0;
    nextOnsetIdx = onsetTimes.findIndex((ot) => ot > t);
    if (nextOnsetIdx < 0) nextOnsetIdx = onsetTimes.length;
  });

  bus.on(BUS_EVENTS.PLAYBACK_STARTED, () => {
    const t = state.frameToTime(state.getCurrentFrame());
    nextOnsetIdx = onsetTimes.findIndex((ot) => ot > t);
    if (nextOnsetIdx < 0) nextOnsetIdx = onsetTimes.length;
  });

  bus.on(BUS_EVENTS.PLAYBACK_ENDED, () => {
    nextOnsetIdx = 0;
    beatCount = 0;
  });

  /* ── Transport controls ─────────────────────────────────── */

  const triggerPlay = () => {
    if (nativePlayBtn) nativePlayBtn.click();
  };

  playBtn.addEventListener('click', triggerPlay);

  bus.on(BUS_EVENTS.PLAYBACK_STARTED, () => { playBtn.textContent = 'PAUSE'; });
  bus.on(BUS_EVENTS.PLAYBACK_PAUSED,  () => { playBtn.textContent = 'PLAY'; });
  bus.on(BUS_EVENTS.PLAYBACK_ENDED,   () => { playBtn.textContent = 'PLAY'; });

  /* ── Fullscreen ─────────────────────────────────────────── */

  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  /* ── Back to panel view ─────────────────────────────────── */
  backBtn.addEventListener('click', () => {
    window.location.href = 'index.html';
  });

  /* ── Show/hide controls on mouse movement ───────────────── */

  let cursorTimer = null;
  const showControls = () => {
    document.body.classList.add('show-cursor');
    controlsBar.classList.add('visible');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => {
      if (state.isPlaying()) {
        document.body.classList.remove('show-cursor');
        // Don't hide controls bar entirely — just let it fade
      }
    }, 3000);
  };

  document.addEventListener('mousemove', showControls);
  document.addEventListener('pointerdown', showControls);

  /* ── Keyboard shortcuts ─────────────────────────────────── */

  document.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      triggerPlay();
    }
    if (e.key === 'f' || e.key === 'F') {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
    if (e.key === 'ArrowRight') {
      activateLayer(pickNextLayer());
    }
    if (e.key === 'Escape' && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  });

  /* ── Cleanup on unload ──────────────────────────────────── */

  window.addEventListener('beforeunload', () => {
    for (const fn of cleanups) {
      if (typeof fn === 'function') fn();
    }
  });

  bus.emit(BUS_EVENTS.RESIZE);
}

/* ── Entry point ──────────────────────────────────────────── */

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
