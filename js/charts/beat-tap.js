/**
 * Beat Tap Challenge — "SIGNAL SYNC" rhythm game layer.
 *
 * Detected onsets scroll right-to-left toward a strike zone.
 * Player taps/clicks the lane (or presses F / J) in time.
 * Scored with SIGNAL LOCK / NEAR LOCK / DRIFT ratings + combo multiplier.
 */
import { BUS_EVENTS } from '../state.js';
import { addPointerHandlers } from '../touch-utils.js';

/* ── Scoring windows (seconds) ───────────────────────────── */
const LOCK_WINDOW  = 0.050;   // ±50 ms  → SIGNAL LOCK
const NEAR_WINDOW  = 0.120;   // ±120 ms → NEAR LOCK
const MISS_WINDOW  = 0.200;   // ±200 ms → DRIFT (weak hit)

/* ── Points ──────────────────────────────────────────────── */
const LOCK_POINTS  = 100;
const NEAR_POINTS  = 50;
const DRIFT_POINTS = 10;

/* ── Combo tiers ─────────────────────────────────────────── */
const COMBO_TIERS = [
  { threshold: 20, multiplier: 8 },
  { threshold: 10, multiplier: 4 },
  { threshold:  5, multiplier: 2 },
  { threshold:  0, multiplier: 1 },
];

/* ── Visual constants ────────────────────────────────────── */
const LOOKAHEAD_SEC    = 2.0;
const STRIKE_ZONE_X    = 0.15;
const BG_COLOR         = '#060a0f';
const LANE_LINE        = 'rgba(0, 212, 255, 0.04)';
const STRIKE_GLOW      = 'rgba(0, 212, 255, 0.6)';
const BEAT_COLOR       = '#00d4ff';
const BEAT_GLOW        = 'rgba(0, 212, 255, 0.5)';
const LOCK_COLOR       = '#00ffff';
const NEAR_COLOR       = '#ffaa00';
const MISS_COLOR       = '#ff3333';
const DRIFT_COLOR      = 'rgba(136, 170, 200, 0.4)';
const SCORE_COLOR      = '#ffaa00';
const COMBO_COLOR      = '#00d4ff';
const TEXT_DIM         = 'rgba(136, 170, 200, 0.5)';

/* ── Helpers ─────────────────────────────────────────────── */
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function comboMultiplier(combo) {
  for (const t of COMBO_TIERS) {
    if (combo >= t.threshold) return t.multiplier;
  }
  return 1;
}

/* ═══════════════════════════════════════════════════════════ */

export function initBeatTap(canvasId, bus, state) {
  const canvas = document.getElementById(canvasId);
  if (!(canvas instanceof HTMLCanvasElement)) return () => {};
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return () => {};

  const scoreEl  = document.getElementById('beat-tap-score');
  const statusEl = document.getElementById('beat-tap-status');

  /* ── game state ──────────────────────────────────────────── */
  let onsetTimes = [];          // sorted seconds
  let judgments  = [];           // null | 'lock' | 'near' | 'drift' | 'miss'
  let score      = 0;
  let combo      = 0;
  let maxCombo   = 0;
  let locks = 0, nears = 0, drifts = 0, misses = 0;
  let isActive   = false;
  let gameOver   = false;

  /* time interpolation from PLAYHEAD_UPDATE */
  let lastTime     = 0;
  let lastPerfNow  = performance.now();

  /* visual hit-flash queue */
  let flashes = [];             // { type, x, startMs }
  let rafId   = null;

  /* ── dims ────────────────────────────────────────────────── */
  const dims = () => ({ w: canvas.width, h: canvas.height });

  /* ── precise time at tap instant ─────────────────────────── */
  function now() {
    if (!isActive) return lastTime;
    return lastTime + (performance.now() - lastPerfNow) / 1000;
  }

  /* ── HUD updates ─────────────────────────────────────────── */
  function updateHud() {
    if (scoreEl) scoreEl.textContent = String(score);
    if (!statusEl) return;
    if (gameOver) {
      const total = onsetTimes.length || 1;
      const acc = Math.round(((locks + nears * 0.5) / total) * 100);
      statusEl.textContent = `${acc}% ACCURACY`;
    } else if (isActive) {
      statusEl.textContent = combo > 1
        ? `×${comboMultiplier(combo)} COMBO ${combo}`
        : 'ACTIVE';
    } else {
      statusEl.textContent = onsetTimes.length ? 'READY' : 'STANDBY';
    }
  }

  /* ── reset ───────────────────────────────────────────────── */
  function resetGame() {
    judgments = new Array(onsetTimes.length).fill(null);
    score = combo = maxCombo = locks = nears = drifts = misses = 0;
    flashes = [];
    gameOver = false;
    updateHud();
  }

  /* ── judgment logic ──────────────────────────────────────── */
  function judgeHit(idx, type) {
    judgments[idx] = type;
    const pts = type === 'lock' ? LOCK_POINTS
              : type === 'near' ? NEAR_POINTS
              : DRIFT_POINTS;

    if (type === 'lock' || type === 'near') {
      combo++;
      if (combo > maxCombo) maxCombo = combo;
    } else {
      combo = 0;
    }

    score += pts * comboMultiplier(combo);
    if (type === 'lock') locks++;
    else if (type === 'near') nears++;
    else drifts++;
    updateHud();
  }

  function judgeMiss(idx) {
    judgments[idx] = 'miss';
    combo = 0;
    misses++;
    updateHud();
  }

  /* ── tap handler ─────────────────────────────────────────── */
  function handleTap() {
    if (!isActive || gameOver) return;
    const t = now();

    let bestIdx = -1;
    let bestDelta = Infinity;

    for (let i = 0; i < onsetTimes.length; i++) {
      if (judgments[i] !== null) continue;
      const d = Math.abs(t - onsetTimes[i]);
      if (d < bestDelta) { bestDelta = d; bestIdx = i; }
      if (onsetTimes[i] > t + MISS_WINDOW) break;
    }

    if (bestIdx < 0 || bestDelta > MISS_WINDOW) return;

    const type = bestDelta <= LOCK_WINDOW ? 'lock'
               : bestDelta <= NEAR_WINDOW ? 'near'
               : 'drift';
    judgeHit(bestIdx, type);

    const { w } = dims();
    flashes.push({ type, x: w * STRIKE_ZONE_X, startMs: performance.now() });
  }

  /* ── auto-miss passed onsets ─────────────────────────────── */
  function autoMiss(t) {
    const { w } = dims();
    for (let i = 0; i < onsetTimes.length; i++) {
      if (judgments[i] !== null) continue;
      if (t - onsetTimes[i] > MISS_WINDOW) {
        judgeMiss(i);
        flashes.push({ type: 'miss', x: w * STRIKE_ZONE_X, startMs: performance.now() });
      }
      if (onsetTimes[i] > t) break;
    }
  }

  /* ═══════════════════════════════════════════════════════════
     RENDERING
     ═══════════════════════════════════════════════════════════ */

  function drawBg() {
    const { w, h } = dims();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    // center lane line
    ctx.strokeStyle = LANE_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w, h * 0.5);
    ctx.stroke();
  }

  function drawStrikeZone() {
    const { w, h } = dims();
    const x = w * STRIKE_ZONE_X;

    // glow band
    const g = ctx.createLinearGradient(x - 24, 0, x + 24, 0);
    g.addColorStop(0,   'rgba(0, 212, 255, 0)');
    g.addColorStop(0.3, 'rgba(0, 212, 255, 0.07)');
    g.addColorStop(0.5, 'rgba(0, 212, 255, 0.14)');
    g.addColorStop(0.7, 'rgba(0, 212, 255, 0.07)');
    g.addColorStop(1,   'rgba(0, 212, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 24, 0, 48, h);

    // vertical strike line
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.shadowColor = STRIKE_GLOW;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.restore();

    // arrows
    ctx.fillStyle = TEXT_DIM;
    const fs = Math.max(9, Math.round(h * 0.13));
    ctx.font = `${fs}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('▼', x, h * 0.16);
    ctx.fillText('▲', x, h * 0.92);
  }

  function drawBeats(t) {
    const { w, h } = dims();
    const sx = w * STRIKE_ZONE_X;
    const pxPerSec = (w - sx) / LOOKAHEAD_SEC;
    const cy = h * 0.5;
    const br = Math.max(5, Math.round(h * 0.16));

    for (let i = 0; i < onsetTimes.length; i++) {
      const dt = onsetTimes[i] - t;
      if (dt < -0.5) continue;
      if (dt > LOOKAHEAD_SEC + 0.3) break;

      const x = sx + dt * pxPerSec;
      if (x < -br || x > w + br) continue;

      const j = judgments[i];

      /* ── already missed ───────────── */
      if (j === 'miss') {
        ctx.globalAlpha = Math.max(0, 1 - Math.abs(dt) * 4);
        ctx.strokeStyle = MISS_COLOR;
        ctx.lineWidth = 2;
        const s = br * 0.45;
        ctx.beginPath();
        ctx.moveTo(x - s, cy - s); ctx.lineTo(x + s, cy + s);
        ctx.moveTo(x + s, cy - s); ctx.lineTo(x - s, cy + s);
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }

      /* ── already hit ──────────────── */
      if (j !== null) {
        ctx.globalAlpha = Math.max(0, 0.35 - Math.abs(dt) * 2);
        ctx.fillStyle = j === 'lock' ? LOCK_COLOR
                      : j === 'near' ? NEAR_COLOR
                      : DRIFT_COLOR;
        ctx.beginPath();
        ctx.arc(x, cy, br * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }

      /* ── approaching (unjudged) ───── */
      const prox = 1 - clamp(Math.abs(dt) / LOOKAHEAD_SEC, 0, 1);

      ctx.save();
      ctx.shadowColor = BEAT_GLOW;
      ctx.shadowBlur = 6 + prox * 14;
      ctx.fillStyle = BEAT_COLOR;
      ctx.globalAlpha = 0.3 + prox * 0.7;

      // diamond
      ctx.beginPath();
      ctx.moveTo(x, cy - br);
      ctx.lineTo(x + br * 0.55, cy);
      ctx.lineTo(x, cy + br);
      ctx.lineTo(x - br * 0.55, cy);
      ctx.closePath();
      ctx.fill();

      // bright core
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = prox * 0.55;
      ctx.beginPath();
      ctx.arc(x, cy, br * 0.18, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  function drawFlashes() {
    const { h } = dims();
    const cy = h * 0.5;
    const perfNow = performance.now();

    flashes = flashes.filter(f => {
      const age = perfNow - f.startMs;
      if (age > 500) return false;

      const p = age / 500;
      const r = 10 + p * 44;
      const a = 1 - p;

      const c = f.type === 'lock' ? LOCK_COLOR
              : f.type === 'near' ? NEAR_COLOR
              : f.type === 'miss' ? MISS_COLOR
              : DRIFT_COLOR;

      ctx.save();
      ctx.globalAlpha = a * 0.65;
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.shadowColor = c;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(f.x, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // text label
      if (age < 320) {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = c;
        const fs = Math.max(10, Math.round(h * 0.18));
        ctx.font = `bold ${fs}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        const lbl = f.type === 'lock' ? 'LOCK'
                  : f.type === 'near' ? 'NEAR'
                  : f.type === 'miss' ? 'MISS'
                  : 'DRIFT';
        ctx.fillText(lbl, f.x, cy - 22 - p * 16);
        ctx.restore();
      }
      return true;
    });
  }

  function drawHud() {
    const { w, h } = dims();

    // score — top right
    ctx.fillStyle = SCORE_COLOR;
    const sfs = Math.max(11, Math.round(h * 0.17));
    ctx.font = `bold ${sfs}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(String(score), w - 10, h * 0.3);

    // combo — top left past strike zone
    if (combo > 0) {
      const m = comboMultiplier(combo);
      ctx.fillStyle = COMBO_COLOR;
      const cfs = Math.max(10, Math.round(h * 0.15));
      ctx.font = `bold ${cfs}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'left';
      ctx.globalAlpha = 0.85;
      ctx.fillText(`×${m}`, 8, h * 0.3);

      if (combo > 1) {
        ctx.font = `${Math.max(8, Math.round(h * 0.1))}px "JetBrains Mono", monospace`;
        ctx.fillStyle = TEXT_DIM;
        ctx.fillText(`${combo} STREAK`, 8, h * 0.52);
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawGameOver() {
    const { w, h } = dims();
    const total = onsetTimes.length || 1;
    const acc = Math.round(((locks + nears * 0.5) / total) * 100);

    ctx.fillStyle = 'rgba(6, 10, 15, 0.78)';
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5;
    ctx.textAlign = 'center';

    ctx.fillStyle = SCORE_COLOR;
    ctx.font = `bold ${Math.max(14, Math.round(h * 0.22))}px "JetBrains Mono", monospace`;
    ctx.fillText(`SCORE: ${score}`, cx, h * 0.36);

    ctx.fillStyle = COMBO_COLOR;
    ctx.font = `${Math.max(10, Math.round(h * 0.14))}px "JetBrains Mono", monospace`;
    ctx.fillText(`${acc}% ACCURACY  |  MAX COMBO: ${maxCombo}`, cx, h * 0.58);

    ctx.fillStyle = TEXT_DIM;
    ctx.font = `${Math.max(9, Math.round(h * 0.11))}px "JetBrains Mono", monospace`;
    ctx.fillText(
      `LOCK: ${locks}  NEAR: ${nears}  DRIFT: ${drifts}  MISS: ${misses}`,
      cx, h * 0.78
    );
  }

  function drawIdle() {
    const { w, h } = dims();
    drawBg();
    drawStrikeZone();
    ctx.textAlign = 'center';
    ctx.fillStyle = TEXT_DIM;
    ctx.font = `${Math.max(10, Math.round(h * 0.13))}px "JetBrains Mono", monospace`;
    const msg = onsetTimes.length
      ? 'TAP BEATS IN TIME  ▸  PRESS PLAY TO START'
      : 'LOAD AUDIO TO BEGIN SIGNAL SYNC';
    ctx.fillText(msg, w * 0.55, h * 0.55);
  }

  /* ── render loop ─────────────────────────────────────────── */
  function render() {
    rafId = null;

    if (!isActive) {
      if (gameOver) {
        drawBg();
        drawStrikeZone();
        drawBeats(lastTime);
        drawGameOver();
      } else {
        drawIdle();
      }
      return;
    }

    const t = now();
    autoMiss(t);
    drawBg();
    drawStrikeZone();
    drawBeats(t);
    drawFlashes();
    drawHud();
    schedule();
  }

  function schedule() {
    if (rafId === null) rafId = requestAnimationFrame(render);
  }

  /* ── input wiring ────────────────────────────────────────── */
  const cleanupPtr = addPointerHandlers(canvas, {
    onPointerDown: () => handleTap(),
  });

  const onKey = (e) => {
    if (e.code === 'KeyF' || e.code === 'KeyJ') {
      e.preventDefault();
      handleTap();
    }
  };
  document.addEventListener('keydown', onKey);

  /* ── bus subscriptions ───────────────────────────────────── */
  const unsubs = [];

  unsubs.push(bus.on(BUS_EVENTS.DATA_READY, () => {
    const pre = state.getPrecomputed();
    if (!pre || !pre.onsets || pre.onsets.length === 0) {
      onsetTimes = [];
    } else {
      onsetTimes = Array.from(pre.onsets).map(f => state.frameToTime(f));
    }
    resetGame();
    schedule();
  }));

  unsubs.push(bus.on(BUS_EVENTS.PLAYBACK_STARTED, () => {
    isActive = true;
    gameOver = false;
    if (now() < 0.1) resetGame();
    schedule();
  }));

  unsubs.push(bus.on(BUS_EVENTS.PLAYBACK_PAUSED, () => {
    isActive = false;
    schedule();
  }));

  unsubs.push(bus.on(BUS_EVENTS.PLAYBACK_ENDED, () => {
    isActive = false;
    gameOver = true;
    for (let i = 0; i < onsetTimes.length; i++) {
      if (judgments[i] === null) judgeMiss(i);
    }
    updateHud();
    schedule();
  }));

  unsubs.push(bus.on(BUS_EVENTS.PLAYHEAD_UPDATE, ({ time }) => {
    lastTime = time;
    lastPerfNow = performance.now();
    if (isActive) schedule();
  }));

  unsubs.push(bus.on(BUS_EVENTS.PLAYHEAD_SEEK, () => {
    resetGame();
    schedule();
  }));

  unsubs.push(bus.on(BUS_EVENTS.RESIZE, () => schedule()));

  /* initial paint */
  drawIdle();

  return () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    cleanupPtr();
    document.removeEventListener('keydown', onKey);
    for (const fn of unsubs) fn();
  };
}
