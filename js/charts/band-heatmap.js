import { BUS_EVENTS } from '../state.js';
import { addPointerHandlers } from '../touch-utils.js';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createOffscreenCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function buildAmberLut() {
  const stops = [
    { t: 0, color: '#0a0e14' },
    { t: 128, color: '#553300' },
    { t: 255, color: '#ffaa00' },
  ];

  const lut = new Uint8ClampedArray(256 * 3);

  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    const ca = hexToRgb(a.color);
    const cb = hexToRgb(b.color);
    const span = Math.max(1, b.t - a.t);

    for (let v = a.t; v <= b.t; v += 1) {
      const p = (v - a.t) / span;
      const idx = v * 3;
      lut[idx] = Math.round(ca.r + (cb.r - ca.r) * p);
      lut[idx + 1] = Math.round(ca.g + (cb.g - ca.g) * p);
      lut[idx + 2] = Math.round(ca.b + (cb.b - ca.b) * p);
    }
  }

  return lut;
}

function formatFrequency(hz) {
  if (hz >= 1000) {
    const khz = hz / 1000;
    return `${khz >= 10 ? khz.toFixed(0) : khz.toFixed(1)} kHz`;
  }
  return `${Math.round(hz)} Hz`;
}

function pickLabelBands(bandFrequencies) {
  if (!Array.isArray(bandFrequencies) || bandFrequencies.length === 0) {
    return [0, 10, 20, 30, 39];
  }

  const targets = [100, 1000, 10000];
  const picks = new Set([0, bandFrequencies.length - 1]);

  for (const target of targets) {
    let best = 0;
    let bestDelta = Number.POSITIVE_INFINITY;

    for (let i = 0; i < bandFrequencies.length; i += 1) {
      const f = bandFrequencies[i];
      const center = Math.sqrt((f.low || 1) * (f.high || 1));
      const delta = Math.abs(center - target);
      if (delta < bestDelta) {
        best = i;
        bestDelta = delta;
      }
    }

    picks.add(best);
  }

  return Array.from(picks).sort((a, b) => a - b);
}

export function initBandHeatmap(canvasId, bus, state) {
  const canvas = document.getElementById(canvasId);
  if (!(canvas instanceof HTMLCanvasElement)) {
    return () => {};
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return () => {};
  }

  const lut = buildAmberLut();

  let width = 1;
  let height = 1;
  let dpr = 1;
  let labelGutter = 44;
  let offscreen = null;
  let offscreenWidth = 0;
  let viewStartFrame = 0;
  let viewEndFrame = 0;
  let currentFrame = 0;
  let hoverFrame = null;
  let hoverBand = null;
  let sensorsWeight = 1;
  let eqGainCurve = null; // Float32Array(40) linear gain per band

  const computeEqGainCurve = () => {
    const precomputed = state.getPrecomputed();
    if (!precomputed?.bandFrequencies?.length) return null;
    const eqBands = state.getEqBands();
    const allFlat = eqBands.every((b) => Math.abs(b.gain) < 0.01);
    if (allFlat) return null;

    const numBands = precomputed.bandFrequencies.length;
    const freqs = new Float32Array(numBands);
    for (let i = 0; i < numBands; i++) {
      freqs[i] = Math.sqrt(
        Math.max(1, precomputed.bandFrequencies[i].low) *
        Math.max(1, precomputed.bandFrequencies[i].high)
      );
    }

    const sr = precomputed.sampleRate || 44100;
    const offline = new OfflineAudioContext(1, 1, sr);
    const combined = new Float32Array(numBands).fill(1);
    const magBuf = new Float32Array(numBands);
    const phaseBuf = new Float32Array(numBands);

    for (const band of eqBands) {
      const f = offline.createBiquadFilter();
      f.type = band.type;
      f.frequency.value = band.freq;
      f.gain.value = band.gain;
      if (band.type === 'peaking') f.Q.value = band.Q || 1;
      f.getFrequencyResponse(freqs, magBuf, phaseBuf);
      for (let i = 0; i < numBands; i++) combined[i] *= magBuf[i];
    }
    return combined;
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
    labelGutter = Math.round(44 * dpr);
  };

  const setViewFromBrush = () => {
    const precomputed = state.getPrecomputed();
    if (!precomputed?.numFrames) {
      viewStartFrame = 0;
      viewEndFrame = 0;
      return;
    }

    const brush = state.getBrush();
    if (!brush) {
      viewStartFrame = 0;
      viewEndFrame = precomputed.numFrames - 1;
      return;
    }

    viewStartFrame = clamp(brush.startFrame, 0, precomputed.numFrames - 1);
    viewEndFrame = clamp(brush.endFrame, viewStartFrame, precomputed.numFrames - 1);
  };

  const buildOffscreen = () => {
    const precomputed = state.getPrecomputed();
    if (!precomputed?.bandsLeft || !precomputed?.numFrames) {
      offscreen = null;
      offscreenWidth = 0;
      return;
    }

    const numFrames = precomputed.numFrames;
    const numBands = 40;
    offscreen = createOffscreenCanvas(numFrames, numBands);
    offscreenWidth = numFrames;

    const offCtx = offscreen.getContext('2d');
    if (!offCtx) {
      offscreen = null;
      offscreenWidth = 0;
      return;
    }

    const image = offCtx.createImageData(numFrames, numBands);
    const bands = precomputed.bandsLeft;
    const gains = eqGainCurve; // may be null if EQ is flat

    for (let frame = 0; frame < numFrames; frame += 1) {
      for (let band = 0; band < numBands; band += 1) {
        let value = bands[frame * numBands + band] || 0;
        if (gains) value = clamp(Math.round(value * gains[band]), 0, 255);
        const y = numBands - 1 - band;
        const pixel = (y * numFrames + frame) * 4;
        const lutIndex = value * 3;

        image.data[pixel] = lut[lutIndex];
        image.data[pixel + 1] = lut[lutIndex + 1];
        image.data[pixel + 2] = lut[lutIndex + 2];
        image.data[pixel + 3] = 255;
      }
    }

    offCtx.putImageData(image, 0, 0);
    setViewFromBrush();
  };

  const plotWidth = () => Math.max(1, width - labelGutter);

  const frameToX = (frame) => {
    const span = Math.max(1, viewEndFrame - viewStartFrame);
    return labelGutter + ((frame - viewStartFrame) / span) * plotWidth();
  };

  const xToFrame = (x) => {
    const span = Math.max(1, viewEndFrame - viewStartFrame);
    const normalized = clamp((x - labelGutter) / plotWidth(), 0, 1);
    return clamp(Math.round(viewStartFrame + normalized * span), viewStartFrame, viewEndFrame);
  };

  const yToBand = (y) => {
    const normalized = clamp(y / height, 0, 0.99999);
    const visualBand = Math.floor(normalized * 40);
    return clamp(39 - visualBand, 0, 39);
  };

  const drawLabels = () => {
    const precomputed = state.getPrecomputed();
    const bands = pickLabelBands(precomputed?.bandFrequencies || []);

    ctx.fillStyle = 'rgba(9, 14, 22, 0.95)';
    ctx.fillRect(0, 0, labelGutter, height);

    ctx.strokeStyle = 'rgba(46, 65, 84, 0.8)';
    ctx.beginPath();
    ctx.moveTo(labelGutter + 0.5, 0);
    ctx.lineTo(labelGutter + 0.5, height);
    ctx.stroke();

    ctx.fillStyle = 'rgba(139, 157, 173, 0.95)';
    ctx.font = `${Math.max(8, 9 * dpr)}px monospace`;
    ctx.textAlign = 'left';

    for (const bandIndex of bands) {
      const bandData = precomputed?.bandFrequencies?.[bandIndex];
      const center = bandData
        ? Math.sqrt(Math.max(1, bandData.low) * Math.max(1, bandData.high))
        : 0;
      const text = center ? formatFrequency(center) : `B${bandIndex}`;
      const y = ((39 - bandIndex + 0.5) / 40) * height;
      ctx.fillText(text, 4 * dpr, y + 3 * dpr);
    }
  };

  const drawBase = () => {
    updateMetrics();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(7, 11, 18, 1)';
    ctx.fillRect(0, 0, width, height);

    if (offscreen && offscreenWidth > 0) {
      const srcX = clamp(viewStartFrame, 0, offscreenWidth - 1);
      const srcW = Math.max(1, viewEndFrame - viewStartFrame + 1);

      ctx.save();
      ctx.globalAlpha = clamp(0.35 + 0.65 * (sensorsWeight / 2), 0.2, 1.2);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(offscreen, srcX, 0, srcW, 40, labelGutter, 0, plotWidth(), height);
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(128, 148, 164, 0.9)';
      ctx.font = `${Math.max(10, 11 * dpr)}px monospace`;
      ctx.fillText('HEATMAP READY WHEN DATA LOADS', 12 * dpr, 18 * dpr);
    }

    drawLabels();
  };

  const drawOverlay = () => {
    const precomputed = state.getPrecomputed();
    if (!precomputed?.numFrames) {
      return;
    }

    if (Number.isFinite(hoverBand)) {
      const y = ((39 - hoverBand) / 40) * height;
      ctx.fillStyle = 'rgba(0, 212, 255, 0.18)';
      ctx.fillRect(labelGutter, y, plotWidth(), Math.ceil(height / 40));
    }

    if (Number.isFinite(hoverFrame)) {
      const x = frameToX(hoverFrame);
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }

    const x = frameToX(currentFrame);
    const amber = getComputedStyle(document.documentElement).getPropertyValue('--sl-amber').trim() || '#ffaa00';
    ctx.strokeStyle = amber;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  };

  const render = () => {
    drawBase();
    drawOverlay();
  };

  const pointerCleanup = addPointerHandlers(canvas, {
    onPointerMove(x, y, event) {
      const precomputed = state.getPrecomputed();
      if (!precomputed?.numFrames) {
        return;
      }

      const px = x * dpr;
      if (px < labelGutter) {
        return;
      }

      const frame = xToFrame(px);
      const bandIndex = yToBand(y * dpr);
      const value = precomputed.bandsLeft[frame * 40 + bandIndex] || 0;
      const time = state.frameToTime(frame);

      bus.emit(BUS_EVENTS.HOVER_FRAME, { frame });
      bus.emit(BUS_EVENTS.HOVER_BAND, { bandIndex });
      bus.emit(BUS_EVENTS.TOOLTIP_SHOW, {
        x: event.clientX,
        y: event.clientY,
        text: `${formatFrequency(Math.sqrt((precomputed.bandFrequencies?.[bandIndex]?.low || 1) * (precomputed.bandFrequencies?.[bandIndex]?.high || 1)))} | ${value} | ${time.toFixed(2)}s`,
      });
    },
  });

  const onClick = (event) => {
    const precomputed = state.getPrecomputed();
    if (!precomputed?.numFrames) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * dpr;
    if (x < labelGutter) {
      return;
    }

    const frame = xToFrame(x);
    bus.emit(BUS_EVENTS.PLAYHEAD_SEEK, { time: state.frameToTime(frame) });
  };

  const onLeave = () => {
    bus.emit(BUS_EVENTS.HOVER_FRAME, null);
    bus.emit(BUS_EVENTS.HOVER_BAND, null);
    bus.emit(BUS_EVENTS.TOOLTIP_HIDE);
  };

  canvas.addEventListener('click', onClick);
  canvas.addEventListener('mouseleave', onLeave);

  const off = [
    bus.on(BUS_EVENTS.DATA_READY, () => {
      eqGainCurve = computeEqGainCurve();
      buildOffscreen();
      render();
    }),
    bus.on(BUS_EVENTS.BRUSH_CHANGE, () => {
      setViewFromBrush();
      render();
    }),
    bus.on(BUS_EVENTS.PLAYHEAD_UPDATE, (payload) => {
      currentFrame = Number(payload?.frame) || 0;
      render();
    }),
    bus.on(BUS_EVENTS.HOVER_BAND, (payload) => {
      hoverBand = payload && Number.isFinite(payload.bandIndex) ? payload.bandIndex : null;
      render();
    }),
    bus.on(BUS_EVENTS.HOVER_FRAME, (payload) => {
      hoverFrame = payload && Number.isFinite(payload.frame) ? payload.frame : null;
      render();
    }),
    bus.on(BUS_EVENTS.POWER_CHANGE, (payload) => {
      const next = Number(payload?.weights?.sensors);
      sensorsWeight = Number.isFinite(next) ? next : 1;
      render();
    }),
    bus.on(BUS_EVENTS.RESIZE, () => {
      render();
    }),
    bus.on(BUS_EVENTS.EQ_CHANGE, () => {
      eqGainCurve = computeEqGainCurve();
      buildOffscreen();
      render();
    }),
  ];

  render();

  return () => {
    for (const unsubscribe of off) {
      unsubscribe();
    }
    pointerCleanup();
    canvas.removeEventListener('click', onClick);
    canvas.removeEventListener('mouseleave', onLeave);
  };
}
