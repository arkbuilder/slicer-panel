import { BUS_EVENTS, formatTime } from '../state.js';

function severityClass(severity) {
  const safe = String(severity || 'INFO').toUpperCase();
  if (safe === 'CRIT') {
    return 'fault-entry--crit';
  }
  if (safe === 'WARN') {
    return 'fault-entry--warn';
  }
  return 'fault-entry--info';
}

function faultTypeLabel(type) {
  return String(type || 'unknown').replace(/_/g, ' ').toUpperCase();
}

export function initFaultLog(containerId, bus, state) {
  const container = document.getElementById(containerId);
  const countNode = document.getElementById('fault-count');

  if (!(container instanceof HTMLElement)) {
    return () => {};
  }

  let entries = [];
  let activeIndex = -1;

  const updateCount = () => {
    if (!countNode) {
      return;
    }
    const count = entries.length;
    countNode.textContent = `${count} ${count === 1 ? 'EVENT' : 'EVENTS'}`;
  };

  const clearActive = () => {
    if (activeIndex < 0 || activeIndex >= entries.length) {
      activeIndex = -1;
      return;
    }
    entries[activeIndex].element.classList.remove('active');
    activeIndex = -1;
  };

  const setActive = (index) => {
    if (index === activeIndex) {
      return;
    }

    clearActive();

    if (index < 0 || index >= entries.length) {
      return;
    }

    activeIndex = index;
    const entry = entries[index];
    entry.element.classList.add('active');
    entry.element.scrollIntoView({ block: 'nearest' });
  };

  const renderFaults = () => {
    const precomputed = state.getPrecomputed();
    const faults = Array.isArray(precomputed?.faults)
      ? [...precomputed.faults].sort((a, b) => (a.frameStart || 0) - (b.frameStart || 0))
      : [];

    container.innerHTML = '';
    entries = [];
    activeIndex = -1;

    if (faults.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fault-empty';
      empty.textContent = 'NO FAULTS DETECTED';
      container.appendChild(empty);
      updateCount();
      return;
    }

    for (let i = 0; i < faults.length; i += 1) {
      const fault = faults[i];
      const startFrame = Math.max(0, Number(fault.frameStart) || 0);
      const endFrame = Math.max(startFrame, Number(fault.frameEnd) || startFrame);
      const startTime = state.frameToTime(startFrame);
      const endTime = state.frameToTime(endFrame);

      const row = document.createElement('div');
      row.className = `fault-entry ${severityClass(fault.severity)}`;
      row.dataset.index = String(i);
      row.dataset.frameStart = String(startFrame);
      row.dataset.frameEnd = String(endFrame);
      row.dataset.timeStart = String(startTime);

      const severity = document.createElement('span');
      severity.className = 'fault-severity';
      severity.textContent = String(fault.severity || 'INFO').toUpperCase();

      const range = document.createElement('span');
      range.className = 'fault-range';
      range.textContent = `${formatTime(startTime)} - ${formatTime(endTime)}`;

      const type = document.createElement('span');
      type.className = 'fault-type';
      type.textContent = faultTypeLabel(fault.type);

      const message = document.createElement('span');
      message.className = 'fault-message';
      message.textContent = String(fault.message || 'No detail.');

      row.append(severity, range, type, message);
      container.appendChild(row);

      entries.push({
        element: row,
        fault,
        startFrame,
        endFrame,
        startTime,
      });
    }

    updateCount();
  };

  const onClick = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const row = target.closest('.fault-entry');
    if (!(row instanceof HTMLElement)) {
      return;
    }

    const startFrame = Number(row.dataset.frameStart) || 0;
    const endFrame = Number(row.dataset.frameEnd) || startFrame;
    const time = Number(row.dataset.timeStart) || state.frameToTime(startFrame);

    bus.emit(BUS_EVENTS.PLAYHEAD_SEEK, { time });
    bus.emit(BUS_EVENTS.BRUSH_CHANGE, { startFrame, endFrame });
    bus.emit(BUS_EVENTS.FAULT_CLICK, { time });
  };

  const updateActiveFromPlayhead = (frame) => {
    if (!entries.length) {
      return;
    }

    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (frame >= entry.startFrame && frame <= entry.endFrame) {
        bestIndex = i;
        break;
      }

      const distance = Math.abs(frame - entry.startFrame);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    setActive(bestIndex);
  };

  container.addEventListener('click', onClick);

  const off = [
    bus.on(BUS_EVENTS.DATA_READY, renderFaults),
    bus.on(BUS_EVENTS.PLAYHEAD_UPDATE, (payload) => {
      updateActiveFromPlayhead(Number(payload?.frame) || 0);
    }),
    bus.on(BUS_EVENTS.POWER_CHANGE, (payload) => {
      const diagnostics = Number(payload?.weights?.diagnostics);
      const alpha = Number.isFinite(diagnostics)
        ? clamp(0.35 + (diagnostics / 2) * 0.65, 0.2, 1)
        : 1;
      container.style.opacity = String(alpha);
    }),
  ];

  renderFaults();

  return () => {
    for (const unsubscribe of off) {
      unsubscribe();
    }
    container.removeEventListener('click', onClick);
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
