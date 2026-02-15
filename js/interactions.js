import { BUS_EVENTS, formatTime } from './state.js';

const POWER_KEYS = ['sensors', 'comms', 'targeting', 'diagnostics'];
const POWER_LABELS = {
  sensors: 'SENSORS',
  comms: 'COMMS',
  targeting: 'TARGETING',
  diagnostics: 'DIAGNOSTICS',
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function patchHoverDebounce(bus) {
  const originalEmit = bus.emit.bind(bus);
  const intervalMs = 33;

  let lastBandAt = 0;
  let lastFrameAt = 0;
  let pendingBand;
  let pendingFrame;
  let bandTimer = null;
  let frameTimer = null;

  const flushBand = () => {
    bandTimer = null;
    if (typeof pendingBand === 'undefined') {
      return;
    }
    const payload = pendingBand;
    pendingBand = undefined;
    lastBandAt = performance.now();
    originalEmit(BUS_EVENTS.HOVER_BAND, payload);
  };

  const flushFrame = () => {
    frameTimer = null;
    if (typeof pendingFrame === 'undefined') {
      return;
    }
    const payload = pendingFrame;
    pendingFrame = undefined;
    lastFrameAt = performance.now();
    originalEmit(BUS_EVENTS.HOVER_FRAME, payload);
  };

  bus.emit = (event, payload) => {
    if (event === BUS_EVENTS.HOVER_BAND) {
      if (payload === null) {
        pendingBand = undefined;
        if (bandTimer) {
          clearTimeout(bandTimer);
          bandTimer = null;
        }
        lastBandAt = performance.now();
        originalEmit(event, payload);
        return;
      }

      const now = performance.now();
      const delta = now - lastBandAt;
      if (delta >= intervalMs) {
        lastBandAt = now;
        originalEmit(event, payload);
      } else {
        pendingBand = payload;
        if (!bandTimer) {
          bandTimer = window.setTimeout(flushBand, intervalMs - delta);
        }
      }
      return;
    }

    if (event === BUS_EVENTS.HOVER_FRAME) {
      if (payload === null) {
        pendingFrame = undefined;
        if (frameTimer) {
          clearTimeout(frameTimer);
          frameTimer = null;
        }
        lastFrameAt = performance.now();
        originalEmit(event, payload);
        return;
      }

      const now = performance.now();
      const delta = now - lastFrameAt;
      if (delta >= intervalMs) {
        lastFrameAt = now;
        originalEmit(event, payload);
      } else {
        pendingFrame = payload;
        if (!frameTimer) {
          frameTimer = window.setTimeout(flushFrame, intervalMs - delta);
        }
      }
      return;
    }

    originalEmit(event, payload);
  };

  return () => {
    if (bandTimer) {
      clearTimeout(bandTimer);
    }
    if (frameTimer) {
      clearTimeout(frameTimer);
    }
    bus.emit = originalEmit;
  };
}

function ensureTooltip() {
  let tooltip = document.getElementById('shared-tooltip');
  if (tooltip) {
    return tooltip;
  }

  tooltip = document.createElement('div');
  tooltip.id = 'shared-tooltip';
  tooltip.className = 'shared-tooltip hidden';
  document.body.appendChild(tooltip);
  return tooltip;
}

function positionTooltip(node, x, y) {
  const offset = 12;
  const maxX = window.innerWidth - node.offsetWidth - 6;
  const maxY = window.innerHeight - node.offsetHeight - 6;
  const left = clamp(x + offset, 6, Math.max(6, maxX));
  const top = clamp(y + offset, 6, Math.max(6, maxY));

  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

function normalizeWeights(current, changedKey, changedValue) {
  const next = {};
  for (const key of POWER_KEYS) {
    next[key] = clamp(Number(current[key]) || 1, 0, 2);
  }

  next[changedKey] = clamp(Number(changedValue) || 0, 0, 2);

  const otherKeys = POWER_KEYS.filter((key) => key !== changedKey);
  const remaining = clamp(4 - next[changedKey], 0, 6);

  const previousSum = otherKeys.reduce((sum, key) => sum + next[key], 0);

  if (previousSum <= 0.000001) {
    const equal = remaining / otherKeys.length;
    for (const key of otherKeys) {
      next[key] = clamp(equal, 0, 2);
    }
  } else {
    for (const key of otherKeys) {
      next[key] = clamp((next[key] / previousSum) * remaining, 0, 2);
    }
  }

  // Correct clamping drift while preserving changed key.
  for (let i = 0; i < 8; i += 1) {
    const total = POWER_KEYS.reduce((sum, key) => sum + next[key], 0);
    const diff = 4 - total;
    if (Math.abs(diff) < 0.00001) {
      break;
    }

    const adjustable = otherKeys.filter((key) => (diff > 0 ? next[key] < 2 : next[key] > 0));
    if (!adjustable.length) {
      break;
    }

    const share = diff / adjustable.length;
    for (const key of adjustable) {
      next[key] = clamp(next[key] + share, 0, 2);
    }
  }

  return next;
}

function isTextEntryTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }

  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function initInteractions(bus, state) {
  const cleanupFns = [];
  const powerContainer = document.getElementById('power-controls');
  const bookmarkList = document.getElementById('bookmark-list');

  cleanupFns.push(patchHoverDebounce(bus));

  const tooltip = ensureTooltip();
  let hideTooltipTimer = null;

  const hideTooltip = () => {
    tooltip.classList.add('hidden');
    tooltip.innerHTML = '';
  };

  const scheduleTooltipHide = (delayMs = 80) => {
    if (hideTooltipTimer) {
      clearTimeout(hideTooltipTimer);
    }
    hideTooltipTimer = window.setTimeout(() => {
      hideTooltip();
      hideTooltipTimer = null;
    }, delayMs);
  };

  cleanupFns.push(bus.on(BUS_EVENTS.TOOLTIP_SHOW, (payload) => {
    if (!payload) {
      return;
    }

    if (hideTooltipTimer) {
      clearTimeout(hideTooltipTimer);
      hideTooltipTimer = null;
    }

    if (payload.html) {
      tooltip.innerHTML = payload.html;
    } else {
      tooltip.textContent = payload.text || '';
    }

    tooltip.classList.remove('hidden');
    positionTooltip(tooltip, Number(payload.x) || 0, Number(payload.y) || 0);
  }));

  cleanupFns.push(bus.on(BUS_EVENTS.TOOLTIP_HIDE, () => {
    scheduleTooltipHide();
  }));

  let weights = {
    sensors: 1,
    comms: 1,
    targeting: 1,
    diagnostics: 1,
    ...state.getPowerWeights(),
  };

  const sliders = new Map();

  const renderPowerRows = () => {
    if (!(powerContainer instanceof HTMLElement)) {
      return;
    }

    powerContainer.innerHTML = '';

    for (const key of POWER_KEYS) {
      const row = document.createElement('div');
      row.className = 'power-row';

      const label = document.createElement('label');
      label.className = 'power-label';
      label.textContent = POWER_LABELS[key];

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'power-slider';
      slider.min = '0';
      slider.max = '2';
      slider.step = '0.01';
      slider.value = String(weights[key].toFixed(2));

      const value = document.createElement('span');
      value.className = 'power-value';
      value.textContent = weights[key].toFixed(2);

      const onInput = () => {
        weights = normalizeWeights(weights, key, Number(slider.value));

        for (const syncKey of POWER_KEYS) {
          const controls = sliders.get(syncKey);
          if (!controls) {
            continue;
          }

          controls.slider.value = weights[syncKey].toFixed(2);
          controls.value.textContent = weights[syncKey].toFixed(2);
        }

        state.setPowerWeights(weights);
        bus.emit(BUS_EVENTS.POWER_CHANGE, { weights: { ...weights } });
      };

      slider.addEventListener('input', onInput);

      row.append(label, slider, value);
      powerContainer.appendChild(row);

      sliders.set(key, { slider, value, onInput });
    }
  };

  renderPowerRows();
  state.setPowerWeights(weights);
  bus.emit(BUS_EVENTS.POWER_CHANGE, { weights: { ...weights } });

  const renderBookmarks = () => {
    if (!(bookmarkList instanceof HTMLElement)) {
      return;
    }

    const bookmarks = state.getBookmarks();
    bookmarkList.innerHTML = '';

    if (!bookmarks.length) {
      const empty = document.createElement('div');
      empty.className = 'bookmark-empty';
      empty.textContent = 'NO BOOKMARKS';
      bookmarkList.appendChild(empty);
      return;
    }

    for (let i = 0; i < bookmarks.length; i += 1) {
      const bookmark = bookmarks[i];
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'bookmark-row';
      row.dataset.index = String(i);
      row.textContent = `${i + 1}. ${bookmark.label || `BK-${i + 1}`} @ ${formatTime(bookmark.time)}`;
      bookmarkList.appendChild(row);
    }
  };

  const onBookmarkClick = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const row = target.closest('.bookmark-row');
    if (!(row instanceof HTMLElement)) {
      return;
    }

    const index = Number(row.dataset.index);
    const bookmark = state.getBookmarks()[index];
    if (!bookmark) {
      return;
    }

    bus.emit(BUS_EVENTS.BOOKMARK_JUMP, { time: bookmark.time });
    bus.emit(BUS_EVENTS.PLAYHEAD_SEEK, { time: bookmark.time });
  };

  bookmarkList?.addEventListener('click', onBookmarkClick);

  const onKeyDown = (event) => {
    if (isTextEntryTarget(event.target)) {
      return;
    }

    if (event.code === 'KeyB') {
      event.preventDefault();
      const time = state.frameToTime(state.getCurrentFrame());
      const nextIndex = state.getBookmarks().length + 1;
      const bookmark = state.addBookmark({
        time,
        label: `BK-${nextIndex}`,
      });

      if (bookmark) {
        bus.emit(BUS_EVENTS.BOOKMARK_ADD, { ...bookmark });
      }
      return;
    }

    if (/^Digit[1-9]$/.test(event.code)) {
      event.preventDefault();
      const index = Number(event.code.slice(-1)) - 1;
      const bookmark = state.getBookmarks()[index];
      if (!bookmark) {
        return;
      }

      bus.emit(BUS_EVENTS.BOOKMARK_JUMP, { time: bookmark.time });
      bus.emit(BUS_EVENTS.PLAYHEAD_SEEK, { time: bookmark.time });
    }
  };

  document.addEventListener('keydown', onKeyDown);

  cleanupFns.push(bus.on(BUS_EVENTS.BOOKMARK_ADD, () => {
    renderBookmarks();
  }));

  cleanupFns.push(bus.on(BUS_EVENTS.FILE_LOADED, () => {
    renderBookmarks();
  }));

  renderBookmarks();

  return () => {
    for (const key of POWER_KEYS) {
      const controls = sliders.get(key);
      if (controls) {
        controls.slider.removeEventListener('input', controls.onInput);
      }
    }

    bookmarkList?.removeEventListener('click', onBookmarkClick);
    document.removeEventListener('keydown', onKeyDown);

    if (hideTooltipTimer) {
      clearTimeout(hideTooltipTimer);
    }

    for (const fn of cleanupFns) {
      fn();
    }

    if (tooltip.parentElement) {
      tooltip.parentElement.removeChild(tooltip);
    }
  };
}
