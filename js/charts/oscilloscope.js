/**
 * Oscilloscope visualization.
 *
 * Renders the raw waveform at the current playhead position
 * as a neon-glowing wave with persistence trails — club style.
 */
import { BUS_EVENTS } from '../state.js';

const SAMPLE_WINDOW = 2048;       // samples to display
const TRAIL_DECAY = 0.15;         // lower = longer trails
const LINE_WIDTH = 2;
const GLOW_BLUR = 12;
const GRID_LINES_H = 6;
const GRID_LINES_V = 8;
const GRID_COLOR = 'rgba(0, 212, 255, 0.06)';
const WAVE_COLOR_L = '#00d4ff';   // left / mono channel - cyan
const WAVE_COLOR_R = '#ff6a00';   // right channel - amber
const GLOW_COLOR_L = 'rgba(0, 212, 255, 0.6)';
const GLOW_COLOR_R = 'rgba(255, 106, 0, 0.5)';
const CENTER_LINE = 'rgba(255, 170, 0, 0.15)';
const BG_COLOR = '#060a0f';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function initOscilloscope(canvasId, bus, state) {
  const canvas = document.getElementById(canvasId);
  if (!(canvas instanceof HTMLCanvasElement)) return () => {};
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return () => {};

  const statusEl = document.getElementById('oscilloscope-status');

  let rafId = null;
  let isPlaying = false;

  function dims() {
    return { w: canvas.width, h: canvas.height };
  }

  /* ── grid / background ──────────────────────────────────── */

  function drawBackground() {
    const { w, h } = dims();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);
  }

  function drawGrid() {
    const { w, h } = dims();
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let i = 1; i < GRID_LINES_H; i++) {
      const y = (h / GRID_LINES_H) * i;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    for (let i = 1; i < GRID_LINES_V; i++) {
      const x = (w / GRID_LINES_V) * i;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    ctx.stroke();

    // center line
    ctx.strokeStyle = CENTER_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
  }

  function drawAxisLabels() {
    const { w, h } = dims();
    ctx.fillStyle = 'rgba(0, 212, 255, 0.25)';
    ctx.font = `${Math.max(9, Math.round(h * 0.035))}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'left';
    ctx.fillText('+1', 4, Math.round(h * 0.08));
    ctx.fillText(' 0', 4, Math.round(h * 0.52));
    ctx.fillText('-1', 4, Math.round(h * 0.96));
  }

  /* ── waveform drawing ───────────────────────────────────── */

  function drawWave(samples, startIdx, count, color, glowColor, yOffset) {
    const { w, h } = dims();
    if (count <= 1) return;

    const halfH = h * 0.45;  // ±1 maps to 45% of height
    const centerY = h / 2 + yOffset;

    ctx.save();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = GLOW_BLUR;
    ctx.strokeStyle = color;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.beginPath();

    for (let i = 0; i < count; i++) {
      const idx = startIdx + i;
      if (idx < 0 || idx >= samples.length) continue;

      const x = (i / (count - 1)) * w;
      const y = centerY - clamp(samples[idx], -1, 1) * halfH;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();

    // second pass without glow for crisp inner line
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = LINE_WIDTH * 0.5;
    ctx.stroke();

    ctx.restore();
  }

  /* ── render ─────────────────────────────────────────────── */

  function renderFrame() {
    rafId = null;

    const decoded = state.getDecoded();
    if (!decoded || !decoded.left) {
      drawBackground();
      drawGrid();
      drawAxisLabels();
      scheduleFrame();
      return;
    }

    const { w, h } = dims();

    // trail fade
    ctx.fillStyle = `rgba(6, 10, 15, ${TRAIL_DECAY})`;
    ctx.fillRect(0, 0, w, h);

    drawGrid();

    const currentFrame = state.getCurrentFrame();
    const hopSize = 512;
    const centerSample = currentFrame * hopSize;
    const startIdx = Math.max(0, centerSample - Math.floor(SAMPLE_WINDOW / 2));
    const count = Math.min(SAMPLE_WINDOW, decoded.left.length - startIdx);

    if (count > 1) {
      const isStereo = decoded.right && decoded.right.length > 0;

      if (isStereo) {
        // stereo: two overlapping waves, slight vertical offset
        drawWave(decoded.left, startIdx, count, WAVE_COLOR_L, GLOW_COLOR_L, -h * 0.02);
        drawWave(decoded.right, startIdx, count, WAVE_COLOR_R, GLOW_COLOR_R, h * 0.02);
      } else {
        drawWave(decoded.left, startIdx, count, WAVE_COLOR_L, GLOW_COLOR_L, 0);
      }
    }

    drawAxisLabels();

    if (statusEl) {
      statusEl.textContent = isPlaying ? 'TRACKING' : 'PAUSED';
    }

    scheduleFrame();
  }

  function scheduleFrame() {
    if (rafId === null) {
      rafId = requestAnimationFrame(renderFrame);
    }
  }

  /* ── bus wiring ─────────────────────────────────────────── */

  const unsubs = [];

  unsubs.push(bus.on(BUS_EVENTS.DATA_READY, () => {
    if (statusEl) statusEl.textContent = 'READY';
    scheduleFrame();
  }));

  unsubs.push(bus.on(BUS_EVENTS.PLAYHEAD_UPDATE, () => {
    isPlaying = true;
  }));

  unsubs.push(bus.on(BUS_EVENTS.RESIZE, () => {
    drawBackground();
    drawGrid();
    drawAxisLabels();
    scheduleFrame();
  }));

  // initial paint
  drawBackground();
  drawGrid();
  drawAxisLabels();
  scheduleFrame();

  return () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    for (const fn of unsubs) fn();
  };
}
