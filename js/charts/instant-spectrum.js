import { BUS_EVENTS } from '../state.js';
import { addPointerHandlers } from '../touch-utils.js';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatFrequencyRange(range) {
  if (!range) {
    return 'Unknown';
  }

  const low = range.low || 0;
  const high = range.high || 0;

  const fmt = (hz) => {
    if (hz >= 1000) {
      const k = hz / 1000;
      return `${k >= 10 ? k.toFixed(0) : k.toFixed(1)} kHz`;
    }
    return `${Math.round(hz)} Hz`;
  };

  return `${fmt(low)} - ${fmt(high)}`;
}

function valueToDb(value) {
  const normalized = clamp(value / 255, 0, 1);
  if (normalized <= 0) {
    return -120;
  }
  return 20 * Math.log10(normalized);
}

export function initInstantSpectrum(canvasId, bus, state) {
  const canvas = document.getElementById(canvasId);
  if (!(canvas instanceof HTMLCanvasElement)) {
    return () => {};
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return () => {};
  }

  const BAND_COUNT = 40;
  const displayed = new Float32Array(BAND_COUNT);
  const actual = new Float32Array(BAND_COUNT);
  const peaks = new Float32Array(BAND_COUNT);
  const peakHoldFrames = new Uint8Array(BAND_COUNT);

  let width = 1;
  let height = 1;
  let dpr = 1;
  let currentFrame = 0;
  let hoverBand = null;
  let targetingWeight = 1;
  let rafId = null;

  // Live analyser: reusable buffer and bin→band mapping
  let liveFreqData = null;
  let bandBinMap = null;  // [{lowBin, highBin}, ...] for 40 log-spaced bands

  const buildBandBinMap = () => {
    const analysers = state.getAnalysers();
    if (!analysers || !analysers.mono) return null;
    const fftSize = analysers.mono.fftSize;
    const sampleRate = analysers.mono.context.sampleRate;
    const numBins = fftSize / 2;
    const binWidth = sampleRate / fftSize;
    const minFreq = 20;
    const nyquist = sampleRate / 2;
    const maxFreq = Math.min(20000, nyquist);
    const map = new Array(BAND_COUNT);
    for (let i = 0; i < BAND_COUNT; i++) {
      const low = minFreq * Math.pow(maxFreq / minFreq, i / BAND_COUNT);
      const high = minFreq * Math.pow(maxFreq / minFreq, (i + 1) / BAND_COUNT);
      const lowBin = clamp(Math.floor(low / binWidth), 0, numBins - 1);
      const highBin = clamp(Math.floor(high / binWidth), lowBin, numBins - 1);
      map[i] = { lowBin, highBin };
    }
    return map;
  };

  const updateActualFromAnalyser = () => {
    const analysers = state.getAnalysers();
    if (!analysers || !analysers.mono) return false;

    if (!bandBinMap) bandBinMap = buildBandBinMap();
    if (!bandBinMap) return false;

    const analyser = analysers.mono;
    const numBins = analyser.frequencyBinCount;
    if (!liveFreqData || liveFreqData.length !== numBins) {
      liveFreqData = new Uint8Array(numBins);
    }
    analyser.getByteFrequencyData(liveFreqData);

    for (let i = 0; i < BAND_COUNT; i++) {
      const { lowBin, highBin } = bandBinMap[i];
      let sum = 0;
      const count = highBin - lowBin + 1;
      for (let b = lowBin; b <= highBin; b++) {
        sum += liveFreqData[b];
      }
      actual[i] = count > 0 ? sum / count : 0;
    }
    return true;
  };

  const updateMetrics = () => {
    const nextDpr = window.devicePixelRatio || 1;
    const cssWidth = Math.max(1, Math.floor(canvas.clientWidth));
    const cssHeight = Math.max(1, Math.floor(canvas.clientHeight));
    const nextWidth = Math.max(1, Math.round(cssWidth * nextDpr));
    const nextHeight = Math.max(1, Math.round(cssHeight * nextDpr));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    width = nextWidth;
    height = nextHeight;
    dpr = nextDpr;
  };

  const updateActualFromFrame = () => {
    // Prefer live analyser data when playing (reflects EQ changes)
    if (state.isPlaying() && updateActualFromAnalyser()) {
      return;
    }

    const precomputed = state.getPrecomputed();
    if (!precomputed?.bandsLeft || !precomputed?.numFrames) {
      actual.fill(0);
      return;
    }

    const frame = clamp(currentFrame, 0, precomputed.numFrames - 1);
    const offset = frame * BAND_COUNT;

    for (let i = 0; i < BAND_COUNT; i += 1) {
      actual[i] = precomputed.bandsLeft[offset + i] || 0;
    }
  };

  const updateDynamics = () => {
    for (let i = 0; i < BAND_COUNT; i += 1) {
      displayed[i] = displayed[i] * 0.85 + actual[i] * 0.15;

      if (displayed[i] >= peaks[i]) {
        peaks[i] = displayed[i];
        peakHoldFrames[i] = 30;
      } else if (peakHoldFrames[i] > 0) {
        peakHoldFrames[i] -= 1;
      } else {
        peaks[i] = Math.max(displayed[i], peaks[i] - 1);
      }
    }
  };

  const drawBarSegments = (x, barWidth, value, peakValue, highlighted) => {
    const heightScale = clamp(0.55 + 0.85 * (targetingWeight / 2), 0.35, 1.5);
    const maxHeight = height * heightScale;
    const valueHeight = clamp((value / 255) * maxHeight, 0, height);
    const segmentHeight = Math.max(2, Math.round(3 * dpr));
    const segmentGap = Math.max(1, Math.round(1 * dpr));
    const step = segmentHeight + segmentGap;

    const litSegments = Math.floor(valueHeight / step);
    const totalSegments = Math.floor(height / step);

    for (let segment = 0; segment < totalSegments; segment += 1) {
      const y = height - (segment + 1) * step;
      if (segment >= litSegments) {
        ctx.fillStyle = 'rgba(12, 18, 28, 0.75)';
        ctx.fillRect(x, y, barWidth, segmentHeight);
        continue;
      }

      const t = segment / Math.max(1, totalSegments - 1);
      let color;
      if (t < 0.55) {
        color = 'rgba(0, 212, 255, 0.95)';
      } else if (t < 0.82) {
        color = 'rgba(255, 170, 0, 0.95)';
      } else {
        color = 'rgba(255, 51, 68, 0.95)';
      }

      ctx.fillStyle = color;
      ctx.fillRect(x, y, barWidth, segmentHeight);
    }

    const peakY = clamp(height - (peakValue / 255) * maxHeight, 0, height - 1);
    ctx.fillStyle = highlighted ? 'rgba(255, 255, 255, 0.98)' : 'rgba(255, 230, 180, 0.95)';
    ctx.fillRect(x, peakY, barWidth, Math.max(2, Math.round(2 * dpr)));

    if (highlighted) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = Math.max(1, dpr);
      ctx.strokeRect(x - 0.5, 0.5, barWidth + 1, height - 1);
    }
  };

  const draw = () => {
    updateMetrics();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(7, 12, 18, 1)';
    ctx.fillRect(0, 0, width, height);

    const gap = Math.max(1, Math.round(1.5 * dpr));
    const totalGap = gap * (BAND_COUNT + 1);
    const barWidth = Math.max(1, Math.floor((width - totalGap) / BAND_COUNT));

    for (let i = 0; i < BAND_COUNT; i += 1) {
      const x = gap + i * (barWidth + gap);
      drawBarSegments(x, barWidth, displayed[i], peaks[i], i === hoverBand);
    }

    ctx.strokeStyle = 'rgba(38, 58, 78, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  };

  const tick = () => {
    updateActualFromFrame();
    updateDynamics();
    draw();

    if (state.isPlaying()) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = null;
    }
  };

  const ensureAnimation = () => {
    if (rafId !== null) {
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  const stopAnimation = () => {
    if (rafId === null) {
      return;
    }
    cancelAnimationFrame(rafId);
    rafId = null;
  };

  const xToBand = (x) => {
    const gap = Math.max(1, Math.round(1.5 * dpr));
    const totalGap = gap * (BAND_COUNT + 1);
    const barWidth = Math.max(1, Math.floor((width - totalGap) / BAND_COUNT));
    const normalized = clamp(x, 0, width - 1);

    for (let i = 0; i < BAND_COUNT; i += 1) {
      const barX = gap + i * (barWidth + gap);
      if (normalized >= barX && normalized <= barX + barWidth) {
        return i;
      }
    }

    return null;
  };

  const pointerCleanup = addPointerHandlers(canvas, {
    onPointerMove(x, y, event) {
      const bandIndex = xToBand(x * dpr);
      if (!Number.isFinite(bandIndex)) {
        bus.emit(BUS_EVENTS.HOVER_BAND, null);
        bus.emit(BUS_EVENTS.TOOLTIP_HIDE);
        return;
      }

      bus.emit(BUS_EVENTS.HOVER_BAND, { bandIndex });

      const precomputed = state.getPrecomputed();
      const range = precomputed?.bandFrequencies?.[bandIndex] || null;
      const db = valueToDb(displayed[bandIndex]);
      const freqRange = formatFrequencyRange(range);

      bus.emit(BUS_EVENTS.TOOLTIP_SHOW, {
        x: event.clientX,
        y: event.clientY,
        text: `${freqRange} | ${db.toFixed(1)} dB`,
      });
    },
  });

  const onLeave = () => {
    bus.emit(BUS_EVENTS.HOVER_BAND, null);
    bus.emit(BUS_EVENTS.TOOLTIP_HIDE);
  };

  canvas.addEventListener('mouseleave', onLeave);

  const off = [
    bus.on(BUS_EVENTS.DATA_READY, () => {
      displayed.fill(0);
      actual.fill(0);
      peaks.fill(0);
      peakHoldFrames.fill(0);
      currentFrame = 0;
      bandBinMap = null;  // rebuild on next use (sample rate may differ)
      updateActualFromFrame();
      draw();
    }),
    bus.on(BUS_EVENTS.PLAYHEAD_UPDATE, (payload) => {
      currentFrame = Number(payload?.frame) || 0;
      updateActualFromFrame();
      if (!state.isPlaying()) {
        updateDynamics();
        draw();
      }
    }),
    bus.on(BUS_EVENTS.HOVER_BAND, (payload) => {
      hoverBand = payload && Number.isFinite(payload.bandIndex) ? payload.bandIndex : null;
      if (!state.isPlaying()) {
        draw();
      }
    }),
    bus.on(BUS_EVENTS.POWER_CHANGE, (payload) => {
      const next = Number(payload?.weights?.targeting);
      targetingWeight = Number.isFinite(next) ? next : 1;
      draw();
    }),
    bus.on(BUS_EVENTS.RESIZE, () => {
      draw();
    }),
    bus.on(BUS_EVENTS.PLAYBACK_STARTED, () => {
      ensureAnimation();
    }),
    bus.on(BUS_EVENTS.PLAYBACK_PAUSED, () => {
      stopAnimation();
      draw();
    }),
    bus.on(BUS_EVENTS.PLAYBACK_ENDED, () => {
      stopAnimation();
      draw();
    }),
  ];

  draw();

  return () => {
    for (const unsubscribe of off) {
      unsubscribe();
    }
    stopAnimation();
    pointerCleanup();
    canvas.removeEventListener('mouseleave', onLeave);
  };
}
