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
import { initFaultLog } from './charts/fault-log.js';
import { initInteractions } from './interactions.js';
import { initTheme } from './theme.js';

function getCappedDpr() {
  const dpr = window.devicePixelRatio || 1;
  if (window.innerWidth < 600) {
    return Math.min(dpr, 2);
  }
  if (window.innerWidth < 1024) {
    return Math.min(dpr, 2.5);
  }
  return Math.min(dpr, 3);
}

function setupCanvasResize(bus) {
  const resizeCanvases = () => {
    const dpr = getCappedDpr();
    const canvases = document.querySelectorAll('canvas.chart-canvas');

    for (const canvas of canvases) {
      if (!(canvas instanceof HTMLCanvasElement)) {
        continue;
      }

      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }

    bus.emit(BUS_EVENTS.RESIZE);
  };

  let rafId = null;
  const onResize = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }

    rafId = requestAnimationFrame(() => {
      rafId = null;
      resizeCanvases();
    });
  };

  window.addEventListener('resize', onResize);
  resizeCanvases();

  return () => {
    window.removeEventListener('resize', onResize);
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }
  };
}

function setupFaultDrawerToggle() {
  const drawer = document.getElementById('fault-drawer');
  const toggle = document.getElementById('fault-drawer-toggle');

  if (!(drawer instanceof HTMLElement) || !(toggle instanceof HTMLButtonElement)) {
    return () => {};
  }

  const onToggle = () => {
    const expanded = drawer.classList.toggle('expanded');
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  };

  toggle.addEventListener('click', onToggle);
  return () => toggle.removeEventListener('click', onToggle);
}

function setupOrientationHint() {
  const hint = document.getElementById('orientation-hint');
  if (!(hint instanceof HTMLElement)) {
    return () => {};
  }

  const updateHint = () => {
    const isPhone = window.innerWidth < 768;
    const isPortrait = window.matchMedia('(orientation: portrait)').matches;
    document.body.classList.toggle('show-orientation-hint', isPhone && isPortrait);
  };

  window.addEventListener('resize', updateHint);
  updateHint();

  return () => {
    window.removeEventListener('resize', updateHint);
  };
}

function setupOverlayBindings(bus, state) {
  const loadingOverlay = document.getElementById('loading-overlay');
  const progressOverlay = document.getElementById('progress-overlay');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressStage = document.getElementById('progress-stage');
  const fileInfo = document.getElementById('file-info');
  const currentTimeNode = document.getElementById('time-current');
  const totalTimeNode = document.getElementById('time-total');

  const off = [
    bus.on(BUS_EVENTS.FILE_LOADED, ({ fileName, duration, sampleRate }) => {
      if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
      }
      if (progressOverlay) {
        progressOverlay.classList.remove('hidden');
        progressOverlay.classList.remove('is-error');
      }
      if (progressBarFill) {
        progressBarFill.style.width = '0%';
      }
      if (progressStage) {
        progressStage.textContent = 'Decoding complete. Starting precompute...';
      }

      if (fileInfo) {
        const sr = Number(sampleRate) || 0;
        const srText = sr ? `${(sr / 1000).toFixed(1)} kHz` : 'Unknown SR';
        fileInfo.textContent = `${fileName || 'Unknown file'} | ${srText}`;
      }

      if (currentTimeNode) {
        currentTimeNode.textContent = '0:00.0';
      }
      if (totalTimeNode) {
        totalTimeNode.textContent = formatTime(Number(duration) || 0);
      }
    }),

    bus.on(BUS_EVENTS.PRECOMPUTE_PROGRESS, ({ percent, stage }) => {
      const safePercent = clamp(Number(percent) || 0, 0, 100);
      if (progressBarFill) {
        progressBarFill.style.width = `${safePercent}%`;
      }
      if (progressStage) {
        progressStage.textContent = stage || 'Processing...';
      }
    }),

    bus.on(BUS_EVENTS.DATA_READY, () => {
      if (progressOverlay) {
        progressOverlay.classList.add('hidden');
        progressOverlay.classList.remove('is-error');
      }

      const precomputed = state.getPrecomputed();
      if (totalTimeNode && precomputed?.duration) {
        totalTimeNode.textContent = formatTime(precomputed.duration);
      }
    }),

    bus.on(BUS_EVENTS.PRECOMPUTE_ERROR, ({ message }) => {
      if (progressOverlay) {
        progressOverlay.classList.remove('hidden');
        progressOverlay.classList.add('is-error');
      }
      if (progressBarFill) {
        progressBarFill.style.width = '100%';
      }
      if (progressStage) {
        progressStage.textContent = message || 'Precompute failed.';
      }
    }),

    bus.on(BUS_EVENTS.PLAYHEAD_UPDATE, ({ time }) => {
      if (currentTimeNode) {
        currentTimeNode.textContent = formatTime(Number(time) || 0);
      }
    }),
  ];

  return () => {
    for (const unsubscribe of off) {
      unsubscribe();
    }
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function boot() {
  const bus = createBus();
  const state = createState();

  const cleanups = [
    setupOverlayBindings(bus, state),
    setupFaultDrawerToggle(),
    setupOrientationHint(),
    setupCanvasResize(bus),
    initTheme(bus, state),
    initDecode(bus, state),
    initPrecompute(bus, state),
    initPlayback(bus, state),
    initOverviewWaveform('overview-canvas', bus, state),
    initSpectrogram('spectrogram-canvas', bus, state),
    initBandHeatmap('heatmap-canvas', bus, state),
    initDecryptionRing('ring-canvas', bus, state),
    initInstantSpectrum('spectrum-canvas', bus, state),
    initFaultLog('fault-list', bus, state),
    initInteractions(bus, state),
  ];

  window.addEventListener('beforeunload', () => {
    for (const cleanup of cleanups) {
      if (typeof cleanup === 'function') {
        cleanup();
      }
    }
  });

  bus.emit(BUS_EVENTS.RESIZE);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
