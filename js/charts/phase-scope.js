/**
 * Stereo Phase Scope (Lissajous) visualization.
 *
 * Plots left channel vs right channel as an X-Y scatter with
 * glowing trails — the classic club / studio stereo-field display.
 */
import { BUS_EVENTS } from '../state.js';

const SAMPLE_WINDOW = 4096;        // samples around playhead to plot
const DOT_ALPHA_BASE = 0.55;       // base dot opacity
const TRAIL_DECAY = 0.12;          // canvas fade-out per frame (lower = longer trails)
const CROSSHAIR_ALPHA = 0.12;
const GLOW_COLOR = 'rgba(0, 212, 255, 0.7)';
const DOT_COLOR_CORE = '#00d4ff';
const DOT_COLOR_HOT = '#ffffff';
const RETICLE_COLOR = 'rgba(255, 170, 0, 0.18)';
const IDLE_NOISE_DOTS = 80;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function initPhaseScope(canvasId, bus, state) {
  const canvas = document.getElementById(canvasId);
  if (!(canvas instanceof HTMLCanvasElement)) return () => {};
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return () => {};

  const statusEl = document.getElementById('phase-scope-status');

  let rafId = null;
  let isPlaying = false;
  let needsPaint = true;

  /* ── helpers ─────────────────────────────────────────────── */

  function dims() {
    return { w: canvas.width, h: canvas.height };
  }

  function drawBackground() {
    const { w, h } = dims();
    ctx.fillStyle = '#060a0f';
    ctx.fillRect(0, 0, w, h);
  }

  function drawReticle() {
    const { w, h } = dims();
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) * 0.92;

    ctx.strokeStyle = RETICLE_COLOR;
    ctx.lineWidth = 1;

    // circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    // crosshairs
    ctx.globalAlpha = CROSSHAIR_ALPHA;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);

    // diagonals (M/S axes)
    const d = r * 0.7071;
    ctx.moveTo(cx - d, cy - d);
    ctx.lineTo(cx + d, cy + d);
    ctx.moveTo(cx - d, cy + d);
    ctx.lineTo(cx + d, cy - d);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // axis labels
    ctx.fillStyle = 'rgba(255, 170, 0, 0.35)';
    ctx.font = `${Math.max(10, Math.round(w * 0.025))}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('L', cx - r - 10, cy + 4);
    ctx.fillText('R', cx + r + 10, cy + 4);
    ctx.fillText('M', cx, cy - r - 6);
    ctx.fillText('S', cx, cy + r + 14);
  }

  function drawIdleNoise() {
    const { w, h } = dims();
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) * 0.15;

    ctx.save();
    ctx.shadowColor = GLOW_COLOR;
    ctx.shadowBlur = 6;

    for (let i = 0; i < IDLE_NOISE_DOTS; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * r;
      const x = cx + Math.cos(angle) * dist;
      const y = cy + Math.sin(angle) * dist;
      const a = 0.15 + Math.random() * 0.25;

      ctx.fillStyle = `rgba(0, 212, 255, ${a})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    ctx.restore();
  }

  function drawScope(leftSamples, rightSamples, startIdx, count) {
    const { w, h } = dims();
    const cx = w / 2;
    const cy = h / 2;
    const scale = Math.min(cx, cy) * 0.88;

    // fade previous frame for trail effect
    ctx.fillStyle = `rgba(6, 10, 15, ${TRAIL_DECAY})`;
    ctx.fillRect(0, 0, w, h);

    // draw reticle faintly each frame (underneath trails)
    drawReticle();

    ctx.save();
    ctx.shadowColor = GLOW_COLOR;
    ctx.shadowBlur = 4;

    for (let i = 0; i < count; i++) {
      const idx = startIdx + i;
      if (idx < 0 || idx >= leftSamples.length) continue;

      const l = leftSamples[idx];
      const r = rightSamples[idx];

      // X = right, Y = -left (scope convention: up = in-phase)
      const x = cx + r * scale;
      const y = cy - l * scale;

      // intensity based on amplitude
      const amp = Math.sqrt(l * l + r * r);
      const intensity = clamp(amp * 2.5, 0, 1);

      if (intensity > 0.7) {
        ctx.fillStyle = DOT_COLOR_HOT;
        ctx.globalAlpha = DOT_ALPHA_BASE + intensity * 0.35;
        ctx.fillRect(x - 0.5, y - 0.5, 2, 2);
      } else {
        ctx.fillStyle = DOT_COLOR_CORE;
        ctx.globalAlpha = DOT_ALPHA_BASE * (0.3 + intensity * 0.7);
        ctx.fillRect(x, y, 1.5, 1.5);
      }
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ── render loop ────────────────────────────────────────── */

  function renderFrame() {
    rafId = null;

    const decoded = state.getDecoded();
    if (!decoded || !decoded.left || !decoded.right) {
      drawBackground();
      drawReticle();
      drawIdleNoise();
      scheduleFrame();
      return;
    }

    const currentFrame = state.getCurrentFrame();
    const hopSize = 512;
    const centerSample = currentFrame * hopSize;

    const startIdx = Math.max(0, centerSample - Math.floor(SAMPLE_WINDOW / 2));
    const count = Math.min(SAMPLE_WINDOW, decoded.left.length - startIdx);

    if (count <= 0) {
      drawBackground();
      drawReticle();
      drawIdleNoise();
      scheduleFrame();
      return;
    }

    drawScope(decoded.left, decoded.right, startIdx, count);

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
    needsPaint = true;
    if (statusEl) statusEl.textContent = 'READY';
    scheduleFrame();
  }));

  unsubs.push(bus.on(BUS_EVENTS.PLAYHEAD_UPDATE, () => {
    isPlaying = true;
    needsPaint = true;
  }));

  unsubs.push(bus.on(BUS_EVENTS.RESIZE, () => {
    needsPaint = true;
    // full redraw on resize
    drawBackground();
    drawReticle();
    scheduleFrame();
  }));

  // Start the render loop
  drawBackground();
  drawReticle();
  scheduleFrame();

  return () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    for (const fn of unsubs) fn();
  };
}
