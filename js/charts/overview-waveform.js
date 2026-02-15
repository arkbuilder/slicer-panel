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

function getCssColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function drawPlaceholder(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(7, 12, 18, 1)';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(25, 40, 58, 1)';
  ctx.beginPath();
  ctx.moveTo(0, height * 0.5);
  ctx.lineTo(width, height * 0.5);
  ctx.stroke();

  ctx.fillStyle = 'rgba(125, 143, 159, 0.9)';
  ctx.font = '12px monospace';
  ctx.fillText('UPLOAD SIGNAL TO RENDER OVERVIEW', 12, 20);
}

function pickLodIndex(waveformLods, width, numSamples) {
  const scales = waveformLods.scales || [];
  const lods = waveformLods.left || [];
  if (!Array.isArray(scales) || !Array.isArray(lods) || scales.length === 0) {
    return 0;
  }

  let bestIndex = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < scales.length; i += 1) {
    const chunkCount = numSamples / Math.max(1, scales[i]);
    const score = Math.abs(chunkCount - width);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

export function initOverviewWaveform(canvasId, bus, state) {
  const canvas = document.getElementById(canvasId);
  if (!(canvas instanceof HTMLCanvasElement)) {
    return () => {};
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return () => {};
  }

  let dpr = 1;
  let width = 1;
  let height = 1;
  let backgroundCanvas = createOffscreenCanvas(1, 1);
  let backgroundCtx = backgroundCanvas.getContext('2d');
  let backgroundDirty = true;
  let currentFrame = 0;
  let hoverFrame = null;
  let powerWeight = 1;

  let dragStartX = 0;
  let dragMode = null;
  let dragging = false;
  let pointerDown = false;

  const updateMetrics = () => {
    const nextDpr = window.devicePixelRatio || 1;
    const cssWidth = Math.max(1, Math.floor(canvas.clientWidth));
    const cssHeight = Math.max(1, Math.floor(canvas.clientHeight));
    const nextWidth = Math.max(1, Math.round(cssWidth * nextDpr));
    const nextHeight = Math.max(1, Math.round(cssHeight * nextDpr));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      backgroundDirty = true;
    }

    if (width !== nextWidth || height !== nextHeight || dpr !== nextDpr) {
      width = nextWidth;
      height = nextHeight;
      dpr = nextDpr;
      backgroundCanvas = createOffscreenCanvas(width, height);
      backgroundCtx = backgroundCanvas.getContext('2d');
      backgroundDirty = true;
    }
  };

  const frameToX = (frame, numFrames) => {
    if (numFrames <= 1) {
      return 0;
    }
    return (frame / (numFrames - 1)) * width;
  };

  const xToFrame = (x, numFrames) => {
    if (numFrames <= 1) {
      return 0;
    }
    return clamp(Math.round((x / width) * (numFrames - 1)), 0, numFrames - 1);
  };

  const xToTime = (x, precomputed) => {
    const frame = xToFrame(x, precomputed.numFrames || 1);
    return state.frameToTime(frame);
  };

  const drawWaveformBackground = () => {
    updateMetrics();

    if (!backgroundCtx) {
      return;
    }

    const precomputed = state.getPrecomputed();
    const g = backgroundCtx;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, width, height);

    if (!precomputed?.waveformLODs?.left || !precomputed.numSamples) {
      drawPlaceholder(g, width, height);
      backgroundDirty = false;
      return;
    }

    const cyan = getCssColor('--sl-cyan', '#00d4ff');
    const cyanDim = getCssColor('--sl-cyan-dim', '#3e8190');

    g.fillStyle = 'rgba(8, 12, 18, 0.98)';
    g.fillRect(0, 0, width, height);

    const midY = height * 0.5;
    g.strokeStyle = 'rgba(110, 136, 157, 0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, midY + 0.5);
    g.lineTo(width, midY + 0.5);
    g.stroke();

    const lodIndex = pickLodIndex(precomputed.waveformLODs, width, precomputed.numSamples);
    const lod = precomputed.waveformLODs.left[lodIndex];
    const chunkCount = Math.max(1, Math.floor(lod.length / 2));

    const alpha = clamp(0.35 + (powerWeight / 2) * 0.65, 0.2, 1);
    g.strokeStyle = cyanDim;
    g.fillStyle = cyan;
    g.globalAlpha = alpha;

    for (let x = 0; x < width; x += 1) {
      const chunkIndex = clamp(Math.floor((x / width) * chunkCount), 0, chunkCount - 1);
      const min = lod[chunkIndex * 2] || 0;
      const max = lod[chunkIndex * 2 + 1] || 0;
      const yMin = clamp((1 - max) * 0.5 * height, 0, height - 1);
      const yMax = clamp((1 - min) * 0.5 * height, 0, height - 1);
      const barHeight = Math.max(1, yMax - yMin);
      g.fillRect(x, yMin, 1, barHeight);
    }

    g.globalAlpha = 1;

    const brush = state.getBrush();
    if (brush && precomputed.numFrames > 1) {
      const brushStartX = frameToX(brush.startFrame, precomputed.numFrames);
      const brushEndX = frameToX(brush.endFrame, precomputed.numFrames);
      const leftX = Math.min(brushStartX, brushEndX);
      const rightX = Math.max(brushStartX, brushEndX);

      g.fillStyle = 'rgba(0, 0, 0, 0.42)';
      g.fillRect(0, 0, leftX, height);
      g.fillRect(rightX, 0, width - rightX, height);

      g.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      g.setLineDash([5, 4]);
      g.strokeRect(leftX + 0.5, 0.5, Math.max(1, rightX - leftX - 1), height - 1);
      g.setLineDash([]);
    }

    const loop = state.getLoop();
    if (loop && Number.isFinite(loop.startTime) && Number.isFinite(loop.endTime)) {
      const startFrame = state.timeToFrame(loop.startTime);
      const endFrame = state.timeToFrame(loop.endTime);
      const x1 = frameToX(startFrame, precomputed.numFrames);
      const x2 = frameToX(endFrame, precomputed.numFrames);

      g.strokeStyle = 'rgba(255, 170, 0, 0.75)';
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(x1 + 0.5, 0);
      g.lineTo(x1 + 0.5, height);
      g.moveTo(x2 + 0.5, 0);
      g.lineTo(x2 + 0.5, height);
      g.stroke();
      g.setLineDash([]);
    }

    const bookmarks = state.getBookmarks();
    if (bookmarks.length) {
      g.fillStyle = 'rgba(255, 170, 0, 0.95)';
      for (const bookmark of bookmarks) {
        const frame = state.timeToFrame(bookmark.time);
        const x = frameToX(frame, precomputed.numFrames);
        g.beginPath();
        g.moveTo(x, 2);
        g.lineTo(x + 5 * dpr, 12 * dpr);
        g.lineTo(x - 5 * dpr, 12 * dpr);
        g.closePath();
        g.fill();
      }
    }

    backgroundDirty = false;
  };

  const render = (fullRedraw = false) => {
    updateMetrics();
    if (fullRedraw || backgroundDirty) {
      drawWaveformBackground();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(backgroundCanvas, 0, 0, width, height);

    const precomputed = state.getPrecomputed();
    if (!precomputed?.numFrames) {
      return;
    }

    const amber = getCssColor('--sl-amber', '#ffaa00');
    const playheadX = frameToX(currentFrame, precomputed.numFrames);

    ctx.strokeStyle = amber;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    ctx.moveTo(playheadX + 0.5, 0);
    ctx.lineTo(playheadX + 0.5, height);
    ctx.stroke();

    if (Number.isFinite(hoverFrame)) {
      const hoverX = frameToX(hoverFrame, precomputed.numFrames);
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hoverX + 0.5, 0);
      ctx.lineTo(hoverX + 0.5, height);
      ctx.stroke();
    }
  };

  const pointerCleanup = addPointerHandlers(canvas, {
    onPointerDown(x, y, event) {
      const precomputed = state.getPrecomputed();
      if (!precomputed?.numFrames) {
        return;
      }

      pointerDown = true;
      dragging = false;
      dragStartX = clamp(x * dpr, 0, width);
      dragMode = event.shiftKey ? 'loop' : 'brush';
    },

    onPointerMove(x, y, event) {
      const precomputed = state.getPrecomputed();
      if (!pointerDown || !precomputed?.numFrames) {
        return;
      }

      const currentX = clamp(x * dpr, 0, width);
      const distance = Math.abs(currentX - dragStartX);
      if (distance < 4 * dpr) {
        return;
      }

      dragging = true;

      const startFrame = xToFrame(dragStartX, precomputed.numFrames);
      const endFrame = xToFrame(currentX, precomputed.numFrames);

      if (dragMode === 'loop' || event.shiftKey) {
        const startTime = state.frameToTime(Math.min(startFrame, endFrame));
        const endTime = state.frameToTime(Math.max(startFrame, endFrame));

        if (endTime - startTime <= 0.001) {
          bus.emit(BUS_EVENTS.LOOP_CHANGE, null);
        } else {
          bus.emit(BUS_EVENTS.LOOP_CHANGE, { startTime, endTime });
        }
      } else {
        bus.emit(BUS_EVENTS.BRUSH_CHANGE, {
          startFrame: Math.min(startFrame, endFrame),
          endFrame: Math.max(startFrame, endFrame),
        });
      }
    },

    onPointerUp(x, y) {
      const precomputed = state.getPrecomputed();
      if (!precomputed?.numFrames) {
        pointerDown = false;
        dragging = false;
        dragMode = null;
        return;
      }

      const upX = clamp(x * dpr, 0, width);

      if (!dragging) {
        const time = xToTime(upX, precomputed);
        bus.emit(BUS_EVENTS.PLAYHEAD_SEEK, { time });
      }

      pointerDown = false;
      dragging = false;
      dragMode = null;
    },
  });

  const onDoubleClick = () => {
    bus.emit(BUS_EVENTS.BRUSH_CHANGE, null);
  };

  canvas.addEventListener('dblclick', onDoubleClick);

  const off = [
    bus.on(BUS_EVENTS.DATA_READY, () => {
      backgroundDirty = true;
      render(true);
    }),
    bus.on(BUS_EVENTS.PLAYHEAD_UPDATE, (payload) => {
      currentFrame = Number(payload?.frame) || 0;
      render(false);
    }),
    bus.on(BUS_EVENTS.BRUSH_CHANGE, (payload) => {
      state.setBrush(payload || null);
      backgroundDirty = true;
      render(true);
    }),
    bus.on(BUS_EVENTS.LOOP_CHANGE, (payload) => {
      state.setLoop(payload || null);
      backgroundDirty = true;
      render(true);
    }),
    bus.on(BUS_EVENTS.BOOKMARK_ADD, () => {
      backgroundDirty = true;
      render(true);
    }),
    bus.on(BUS_EVENTS.HOVER_FRAME, (payload) => {
      hoverFrame = payload && Number.isFinite(payload.frame) ? payload.frame : null;
      render(false);
    }),
    bus.on(BUS_EVENTS.RESIZE, () => {
      backgroundDirty = true;
      render(true);
    }),
    bus.on(BUS_EVENTS.POWER_CHANGE, (payload) => {
      const next = Number(payload?.weights?.sensors);
      powerWeight = Number.isFinite(next) ? next : 1;
      backgroundDirty = true;
      render(true);
    }),
  ];

  render(true);

  return () => {
    for (const unsubscribe of off) {
      unsubscribe();
    }
    pointerCleanup();
    canvas.removeEventListener('dblclick', onDoubleClick);
  };
}
