import { BUS_EVENTS } from './state.js';

const EQ_BANDS = [
  { label: 'SUB',  freq: '60 Hz' },
  { label: 'LOW',  freq: '250 Hz' },
  { label: 'MID',  freq: '1 kHz' },
  { label: 'HIGH', freq: '4 kHz' },
  { label: 'AIR',  freq: '12 kHz' },
];

const MIN_DB = -12;
const MAX_DB = 12;
const STEPS = 48;          // total click stops across the range
const STEP_DB = (MAX_DB - MIN_DB) / STEPS;
const ROTATION_RANGE = 270; // degrees of dial travel

// ── Click Sound Generator ──────────────────────────────────────────────

let clickCtx = null;

function playClick(intensity) {
  // Create or reuse a lightweight AudioContext for UI feedback
  if (!clickCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    clickCtx = new AC();
  }
  if (clickCtx.state === 'suspended') {
    clickCtx.resume().catch(() => {});
  }

  const now = clickCtx.currentTime;
  const gain = clickCtx.createGain();
  gain.connect(clickCtx.destination);

  // Sharper click = short noise burst via oscillator at high freq
  const osc = clickCtx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = 3200 + Math.random() * 800;

  const clickGain = 0.03 + Math.min(intensity, 1) * 0.04;
  gain.gain.setValueAtTime(clickGain, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);

  osc.connect(gain);
  osc.start(now);
  osc.stop(now + 0.03);
}

// ── Dial Renderer ──────────────────────────────────────────────────────

function createDial(index, band, initialDb, bus) {
  let currentDb = initialDb;

  const container = document.createElement('div');
  container.className = 'eq-dial-group';

  // Label
  const label = document.createElement('div');
  label.className = 'eq-dial-label';
  label.textContent = band.label;

  // Frequency sublabel
  const freqLabel = document.createElement('div');
  freqLabel.className = 'eq-dial-freq';
  freqLabel.textContent = band.freq;

  // Dial body
  const dialOuter = document.createElement('div');
  dialOuter.className = 'eq-dial-outer';
  dialOuter.setAttribute('role', 'slider');
  dialOuter.setAttribute('aria-label', `${band.label} EQ (${band.freq})`);
  dialOuter.setAttribute('aria-valuemin', String(MIN_DB));
  dialOuter.setAttribute('aria-valuemax', String(MAX_DB));
  dialOuter.setAttribute('aria-valuenow', String(currentDb));
  dialOuter.tabIndex = 0;

  const dialInner = document.createElement('div');
  dialInner.className = 'eq-dial-inner';

  const indicator = document.createElement('div');
  indicator.className = 'eq-dial-indicator';

  dialInner.appendChild(indicator);
  dialOuter.appendChild(dialInner);

  // dB readout
  const readout = document.createElement('div');
  readout.className = 'eq-dial-readout';
  readout.textContent = formatDb(currentDb);

  // Tick marks ring (rendered via CSS gradient on the outer)
  // We draw them with a conic gradient

  container.append(label, dialOuter, readout, freqLabel);

  // ── Rotation helpers ──────────────────────────────────────────
  function dbToAngle(db) {
    const ratio = (db - MIN_DB) / (MAX_DB - MIN_DB);
    return -ROTATION_RANGE / 2 + ratio * ROTATION_RANGE;
  }

  function angleToDegree(angle) {
    return angle; // already in degrees
  }

  function setDialValue(db, emitEvent) {
    const clamped = Math.max(MIN_DB, Math.min(MAX_DB, db));
    // Snap to nearest step
    const snapped = Math.round((clamped - MIN_DB) / STEP_DB) * STEP_DB + MIN_DB;
    const rounded = Math.round(snapped * 10) / 10;

    if (rounded === currentDb) return;

    const prevDb = currentDb;
    currentDb = rounded;

    const angle = dbToAngle(currentDb);
    dialInner.style.transform = `rotate(${angle}deg)`;
    readout.textContent = formatDb(currentDb);
    dialOuter.setAttribute('aria-valuenow', String(currentDb));

    // Determine intensity based on step magnitude
    const stepsMoved = Math.abs(currentDb - prevDb) / STEP_DB;
    playClick(Math.min(stepsMoved / 3, 1));

    if (emitEvent) {
      bus.emit(BUS_EVENTS.EQ_CHANGE, { index, gain: currentDb });
    }
  }

  // Set initial rotation
  dialInner.style.transform = `rotate(${dbToAngle(currentDb)}deg)`;

  // ── Mouse drag ────────────────────────────────────────────────
  let dragging = false;
  let dragStartY = 0;
  let dragStartDb = 0;

  function onPointerDown(e) {
    e.preventDefault();
    dragging = true;
    dragStartY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    dragStartDb = currentDb;
    document.body.style.cursor = 'ns-resize';
    document.body.classList.add('dial-dragging');
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    const dy = dragStartY - clientY; // up = positive
    const sensitivity = e.shiftKey ? 0.05 : 0.15; // dB per pixel
    const newDb = dragStartDb + dy * sensitivity;
    setDialValue(newDb, true);
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.classList.remove('dial-dragging');
  }

  dialOuter.addEventListener('mousedown', onPointerDown);
  dialOuter.addEventListener('touchstart', (e) => {
    e.preventDefault();
    onPointerDown(e);
  }, { passive: false });

  document.addEventListener('mousemove', onPointerMove);
  document.addEventListener('touchmove', onPointerMove, { passive: false });
  document.addEventListener('mouseup', onPointerUp);
  document.addEventListener('touchend', onPointerUp);

  // ── Scroll wheel ──────────────────────────────────────────────
  dialOuter.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? STEP_DB : -STEP_DB;
    setDialValue(currentDb + delta, true);
  }, { passive: false });

  // ── Keyboard ──────────────────────────────────────────────────
  dialOuter.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowUp' || e.code === 'ArrowRight') {
      e.preventDefault();
      setDialValue(currentDb + STEP_DB, true);
    } else if (e.code === 'ArrowDown' || e.code === 'ArrowLeft') {
      e.preventDefault();
      setDialValue(currentDb - STEP_DB, true);
    } else if (e.code === 'Home') {
      e.preventDefault();
      setDialValue(0, true); // reset to center
    }
  });

  // Double-click to reset
  dialOuter.addEventListener('dblclick', (e) => {
    e.preventDefault();
    setDialValue(0, true);
  });

  // Cleanup
  const cleanup = () => {
    document.removeEventListener('mousemove', onPointerMove);
    document.removeEventListener('touchmove', onPointerMove);
    document.removeEventListener('mouseup', onPointerUp);
    document.removeEventListener('touchend', onPointerUp);
  };

  return { element: container, cleanup };
}

function formatDb(db) {
  if (db === 0) return '0 dB';
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

// ── Public init ────────────────────────────────────────────────────────

export function initEqDials(bus, state) {
  const container = document.getElementById('eq-controls');
  if (!container) return () => {};

  const statusEl = document.querySelector('.eq-status');
  const bands = state.getEqBands();
  const cleanups = [];

  function updateStatus() {
    if (!statusEl) return;
    const eqBands = state.getEqBands();
    const allFlat = eqBands.every((b) => b.gain === 0);
    statusEl.textContent = allFlat ? 'FLAT' : 'ACTIVE';
    statusEl.style.color = allFlat ? '' : 'var(--sl-amber)';
  }

  // Listen for EQ changes (including from our own dials) to update status
  cleanups.push(bus.on(BUS_EVENTS.EQ_CHANGE, () => updateStatus()));

  for (let i = 0; i < EQ_BANDS.length; i++) {
    const initialDb = bands[i] ? bands[i].gain : 0;
    const { element, cleanup } = createDial(i, EQ_BANDS[i], initialDb, bus);
    container.appendChild(element);
    cleanups.push(cleanup);
  }

  updateStatus();

  return () => {
    for (const fn of cleanups) fn();
    container.innerHTML = '';
  };
}
