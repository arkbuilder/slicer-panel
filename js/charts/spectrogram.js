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

function buildColorLut() {
  const stops = [
    { t: 0, color: '#060a10' },
    { t: 64, color: '#0044aa' },
    { t: 128, color: '#00bbcc' },
    { t: 192, color: '#ffaa00' },
    { t: 255, color: '#ffffff' },
  ];

  const lut = new Uint8ClampedArray(256 * 3);

  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i];
    const b = stops[i + 1];
    const ca = hexToRgb(a.color);
    const cb = hexToRgb(b.color);

    const range = Math.max(1, b.t - a.t);
    for (let v = a.t; v <= b.t; v += 1) {
      const p = (v - a.t) / range;
      const r = Math.round(ca.r + (cb.r - ca.r) * p);
      const g = Math.round(ca.g + (cb.g - ca.g) * p);
      const bch = Math.round(ca.b + (cb.b - ca.b) * p);

      const index = v * 3;
      lut[index] = r;
      lut[index + 1] = g;
      lut[index + 2] = bch;
    }
  }

  return lut;
}

export function initSpectrogram(canvasId, bus, state) {
  const canvas = document.getElementById(canvasId);
  if (!(canvas instanceof HTMLCanvasElement)) {
    return () => {};
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return () => {};
  }

  const colorLut = buildColorLut();

  let width = 1;
  let height = 1;
  let dpr = 1;
  let offscreen = null;
  let offscreenWidth = 0;
  let viewStartFrame = 0;
  let viewEndFrame = 0;
  let currentFrame = 0;
  let hoverFrame = null;
  let hoverBand = null;
  let sensorsWeight = 1;

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

  const getPrecomputed = () => state.getPrecomputed();

  const setViewFromBrush = () => {
    const precomputed = getPrecomputed();
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
    const precomputed = getPrecomputed();
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

    for (let frame = 0; frame < numFrames; frame += 1) {
      for (let band = 0; band < numBands; band += 1) {
        const value = bands[frame * numBands + band] || 0;
        const y = numBands - 1 - band;
        const pixelIndex = (y * numFrames + frame) * 4;
        const lutIndex = value * 3;

        image.data[pixelIndex] = colorLut[lutIndex];
        image.data[pixelIndex + 1] = colorLut[lutIndex + 1];
        image.data[pixelIndex + 2] = colorLut[lutIndex + 2];
        image.data[pixelIndex + 3] = 255;
      }
    }

    offCtx.putImageData(image, 0, 0);
    setViewFromBrush();
  };

  const frameToX = (frame) => {
    const span = Math.max(1, viewEndFrame - viewStartFrame);
    return ((frame - viewStartFrame) / span) * width;
  };

  const xToFrame = (x) => {
    const span = Math.max(1, viewEndFrame - viewStartFrame);
    const normalized = clamp(x / width, 0, 1);
    return clamp(Math.round(viewStartFrame + normalized * span), viewStartFrame, viewEndFrame);
  };

  const yToBand = (y) => {
    const normalized = clamp(y / height, 0, 0.99999);
    const visualBand = Math.floor(normalized * 40);
    return clamp(39 - visualBand, 0, 39);
  };

  const drawBase = () => {
    updateMetrics();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(7, 11, 18, 1)';
    ctx.fillRect(0, 0, width, height);

    if (!offscreen || offscreenWidth <= 0) {
      ctx.fillStyle = 'rgba(128, 148, 164, 0.9)';
      ctx.font = `${Math.max(10, 11 * dpr)}px monospace`;
      ctx.fillText('SPECTROGRAM READY WHEN DATA LOADS', 10 * dpr, 18 * dpr);
      return;
    }

    const srcX = clamp(viewStartFrame, 0, offscreenWidth - 1);
    const srcW = Math.max(1, viewEndFrame - viewStartFrame + 1);

    ctx.save();
    ctx.globalAlpha = clamp(0.35 + 0.65 * (sensorsWeight / 2), 0.2, 1.2);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen, srcX, 0, srcW, 40, 0, 0, width, height);
    ctx.restore();
  };

  const drawOverlay = () => {
    const precomputed = getPrecomputed();
    if (!precomputed?.numFrames) {
      return;
    }

    if (Number.isFinite(hoverBand)) {
      const bandTop = (39 - hoverBand) * (height / 40);
      ctx.fillStyle = 'rgba(0, 212, 255, 0.18)';
      ctx.fillRect(0, bandTop, width, Math.ceil(height / 40));
    }

    if (Number.isFinite(hoverFrame)) {
      const hoverX = frameToX(hoverFrame);
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hoverX + 0.5, 0);
      ctx.lineTo(hoverX + 0.5, height);
      ctx.stroke();
    }

    const playheadX = frameToX(currentFrame);
    const amber = getComputedStyle(document.documentElement).getPropertyValue('--sl-amber').trim() || '#ffaa00';

    ctx.strokeStyle = amber;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    ctx.moveTo(playheadX + 0.5, 0);
    ctx.lineTo(playheadX + 0.5, height);
    ctx.stroke();
  };

  const render = () => {
    drawBase();
    drawOverlay();
  };

  const pointerCleanup = addPointerHandlers(canvas, {
    onPointerMove(x, y, event) {
      const precomputed = getPrecomputed();
      if (!precomputed?.numFrames) {
        return;
      }

      const frame = xToFrame(x * dpr);
      const bandIndex = yToBand(y * dpr);

      bus.emit(BUS_EVENTS.HOVER_FRAME, { frame });
      bus.emit(BUS_EVENTS.HOVER_BAND, { bandIndex });

      const value = precomputed.bandsLeft[frame * 40 + bandIndex] || 0;
      const time = state.frameToTime(frame);

      bus.emit(BUS_EVENTS.TOOLTIP_SHOW, {
        x: event.clientX,
        y: event.clientY,
        text: `T ${time.toFixed(2)}s | B${bandIndex} | V ${value}`,
      });
    },
  });

  const onCanvasClick = (event) => {
    const precomputed = getPrecomputed();
    if (!precomputed?.numFrames) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * dpr;
    const frame = xToFrame(x);
    bus.emit(BUS_EVENTS.PLAYHEAD_SEEK, { time: state.frameToTime(frame) });
  };

  const onCanvasLeave = () => {
    bus.emit(BUS_EVENTS.HOVER_FRAME, null);
    bus.emit(BUS_EVENTS.HOVER_BAND, null);
    bus.emit(BUS_EVENTS.TOOLTIP_HIDE);
  };

  canvas.addEventListener('click', onCanvasClick);
  canvas.addEventListener('mouseleave', onCanvasLeave);

  const off = [
    bus.on(BUS_EVENTS.DATA_READY, () => {
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
  ];

  render();

  return () => {
    for (const unsubscribe of off) {
      unsubscribe();
    }
    pointerCleanup();
    canvas.removeEventListener('click', onCanvasClick);
    canvas.removeEventListener('mouseleave', onCanvasLeave);
  };
}
