import { BUS_EVENTS } from '../state.js';
import { addPointerHandlers } from '../touch-utils.js';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parseRgbFromCssVar(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const hex = raw.startsWith('#') ? raw.slice(1) : '';
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return { r: 0, g: 212, b: 255 };
}

function isMobileTrailMode() {
  if (window.matchMedia) {
    return window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;
  }
  return window.innerWidth < 768;
}

export function initDecryptionRing(canvasId, bus, state) {
  const canvas = document.getElementById(canvasId);
  if (!(canvas instanceof HTMLCanvasElement)) {
    return () => {};
  }

  const statusNode = document.getElementById('ring-status');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return () => {};
  }

  let width = 1;
  let height = 1;
  let dpr = 1;
  let currentFrame = 0;
  let hoverBand = null;
  let targetingWeight = 1;

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

  const getStatusText = () => {
    if (!state.getPrecomputed()) {
      return 'STANDBY';
    }
    if (state.isPlaying()) {
      return 'DECRYPTING...';
    }
    return 'SIGNAL LOCKED';
  };

  const updateStatus = () => {
    if (statusNode) {
      statusNode.textContent = getStatusText();
    }
  };

  const drawRingFrame = (frameIndex, alphaScale, rotation, innerRadius, outerRadius, cx, cy, data) => {
    if (!data || frameIndex < 0 || frameIndex >= data.numFrames) {
      return;
    }

    const bands = data.bandsLeft;
    const rgb = parseRgbFromCssVar('--sl-cyan', '#00d4ff');
    const arcCount = 40;
    const arcStep = (Math.PI * 2) / arcCount;
    const radialScale = clamp(0.7 + 0.6 * (targetingWeight / 2), 0.5, 1.6);

    for (let band = 0; band < arcCount; band += 1) {
      const value = bands[frameIndex * arcCount + band] || 0;
      const normalized = value / 255;
      const radius = innerRadius + normalized * (outerRadius - innerRadius) * radialScale;
      const alpha = clamp((0.1 + normalized * 0.9) * alphaScale, 0, 1);
      if (alpha <= 0.005) {
        continue;
      }

      const start = band * arcStep + rotation;
      const end = start + arcStep * 0.9;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, end, false);
      ctx.arc(cx, cy, innerRadius, end, start, true);
      ctx.closePath();
      ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha.toFixed(4)})`;
      ctx.fill();
    }
  };

  const render = () => {
    updateMetrics();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(8, 13, 20, 1)';
    ctx.fillRect(0, 0, width, height);

    const precomputed = state.getPrecomputed();
    if (!precomputed?.bandsLeft || !precomputed.numFrames) {
      ctx.fillStyle = 'rgba(142, 159, 176, 0.92)';
      ctx.font = `${Math.max(10, 12 * dpr)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('RING ONLINE AFTER DATA READY', width / 2, height / 2);
      updateStatus();
      return;
    }

    currentFrame = clamp(currentFrame, 0, precomputed.numFrames - 1);

    const size = Math.min(width, height);
    const cx = width * 0.5;
    const cy = height * 0.5;
    const outerRadius = 0.9 * size * 0.5;
    const innerRadius = outerRadius * 0.4;
    const rotation = currentFrame * 0.01;

    if (!isMobileTrailMode()) {
      const trailAlphas = [0.1, 0.16, 0.24, 0.32, 0.4];
      for (let i = trailAlphas.length - 1; i >= 0; i -= 1) {
        drawRingFrame(currentFrame - (i + 1), trailAlphas[i], rotation, innerRadius, outerRadius, cx, cy, precomputed);
      }
    }

    drawRingFrame(currentFrame, 1, rotation, innerRadius, outerRadius, cx, cy, precomputed);

    if (Number.isFinite(hoverBand)) {
      const arcStep = (Math.PI * 2) / 40;
      const start = hoverBand * arcStep + rotation;
      const end = start + arcStep * 0.9;

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = Math.max(1.5 * dpr, 1);
      ctx.beginPath();
      ctx.arc(cx, cy, outerRadius + 2 * dpr, start, end, false);
      ctx.stroke();
    }

    const rms = precomputed.rmsLeft?.[currentFrame] || 0;
    const pulseBase = 6 * dpr;
    const pulseRadius = pulseBase + clamp(rms * 26 * dpr, 0, 28 * dpr);

    const amber = getComputedStyle(document.documentElement).getPropertyValue('--sl-amber').trim() || '#ffaa00';
    ctx.save();
    ctx.shadowColor = amber;
    ctx.shadowBlur = 14 * dpr;
    ctx.fillStyle = amber;
    ctx.beginPath();
    ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(28, 50, 70, 0.9)';
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    ctx.arc(cx, cy, outerRadius + 0.5, 0, Math.PI * 2);
    ctx.stroke();

    updateStatus();
  };

  const pointerCleanup = addPointerHandlers(canvas, {
    onPointerMove(x, y, event) {
      const precomputed = state.getPrecomputed();
      if (!precomputed?.numFrames) {
        return;
      }

      const px = x * dpr;
      const py = y * dpr;
      const cx = width * 0.5;
      const cy = height * 0.5;
      const size = Math.min(width, height);
      const outerRadius = 0.9 * size * 0.5;
      const innerRadius = outerRadius * 0.4;

      const dx = px - cx;
      const dy = py - cy;
      const distance = Math.hypot(dx, dy);
      if (distance < innerRadius || distance > outerRadius + 8 * dpr) {
        bus.emit(BUS_EVENTS.HOVER_BAND, null);
        bus.emit(BUS_EVENTS.TOOLTIP_HIDE);
        return;
      }

      const arcStep = (Math.PI * 2) / 40;
      const rotation = currentFrame * 0.01;

      let angle = Math.atan2(dy, dx) - rotation;
      while (angle < 0) {
        angle += Math.PI * 2;
      }
      while (angle >= Math.PI * 2) {
        angle -= Math.PI * 2;
      }

      const bandIndex = clamp(Math.floor(angle / arcStep), 0, 39);
      bus.emit(BUS_EVENTS.HOVER_BAND, { bandIndex });

      const freq = precomputed.bandFrequencies?.[bandIndex];
      const freqText = freq
        ? `${Math.round(freq.low)}-${Math.round(freq.high)} Hz`
        : `Band ${bandIndex}`;

      bus.emit(BUS_EVENTS.TOOLTIP_SHOW, {
        x: event.clientX,
        y: event.clientY,
        text: `${freqText}`,
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
      currentFrame = 0;
      render();
      updateStatus();
    }),
    bus.on(BUS_EVENTS.PLAYHEAD_UPDATE, (payload) => {
      currentFrame = Number(payload?.frame) || 0;
      render();
    }),
    bus.on(BUS_EVENTS.HOVER_BAND, (payload) => {
      hoverBand = payload && Number.isFinite(payload.bandIndex) ? payload.bandIndex : null;
      render();
    }),
    bus.on(BUS_EVENTS.POWER_CHANGE, (payload) => {
      const next = Number(payload?.weights?.targeting);
      targetingWeight = Number.isFinite(next) ? next : 1;
      render();
    }),
    bus.on(BUS_EVENTS.RESIZE, () => {
      render();
    }),
    bus.on(BUS_EVENTS.PLAYBACK_STARTED, updateStatus),
    bus.on(BUS_EVENTS.PLAYBACK_PAUSED, updateStatus),
    bus.on(BUS_EVENTS.PLAYBACK_ENDED, updateStatus),
  ];

  render();
  updateStatus();

  return () => {
    for (const unsubscribe of off) {
      unsubscribe();
    }
    pointerCleanup();
    canvas.removeEventListener('mouseleave', onLeave);
  };
}
