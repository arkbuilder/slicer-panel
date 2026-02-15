import { BUS_EVENTS } from './state.js';

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function ensureFlashContainer() {
  let node = document.getElementById('flash-messages');
  if (node) {
    return node;
  }

  node = document.createElement('div');
  node.id = 'flash-messages';
  node.className = 'flash-messages';
  document.body.appendChild(node);
  return node;
}

function setStatus(text) {
  const node = document.getElementById('status-indicator');
  if (node) {
    node.textContent = text;
  }
}

function injectPanelCorners() {
  const panels = document.querySelectorAll('.panel');
  for (const panel of panels) {
    if (!(panel instanceof HTMLElement)) {
      continue;
    }
    if (panel.querySelector('.panel-corner')) {
      continue;
    }

    const corners = ['tl', 'tr', 'bl', 'br'];
    for (const corner of corners) {
      const el = document.createElement('span');
      el.className = `panel-corner panel-corner-${corner}`;
      panel.appendChild(el);
    }
  }
}

function showFlash(container, level, message, durationMs = 1800) {
  const node = document.createElement('div');
  node.className = `flash-message flash-${level}`;
  node.textContent = message;
  container.appendChild(node);

  window.setTimeout(() => {
    node.classList.add('leaving');
    window.setTimeout(() => {
      node.remove();
    }, 260);
  }, durationMs);
}

export function initTheme(bus, state) {
  const overlay = document.getElementById('loading-overlay');
  const progressOverlay = document.getElementById('progress-overlay');
  const overlayChooseFile = document.getElementById('overlay-choose-file');
  const fileInput = document.getElementById('file-input');
  const flashContainer = ensureFlashContainer();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  injectPanelCorners();

  const panels = Array.from(document.querySelectorAll('.panel'));

  const hideOverlay = () => {
    if (overlay) {
      overlay.classList.add('hidden');
    }
    setStatus('AWAITING UPLOAD');
  };

  const onOverlayChooseFile = () => {
    if (!(fileInput instanceof HTMLInputElement)) {
      return;
    }
    hideOverlay();
    fileInput.click();
  };

  if (overlayChooseFile) {
    overlayChooseFile.addEventListener('click', onOverlayChooseFile);
  }

  // Keep startup non-blocking; upload controls are always visible in header.
  hideOverlay();

  const decryptSequence = async () => {
    const sequence = [
      { selector: '.panel--overview', delay: 200 },
      { selector: '.panel--spectrogram', delay: 600 },
      { selector: '.panel--heatmap', delay: 1000 },
      { selector: '.panel--ring', delay: 1400 },
      { selector: '.panel--spectrum', delay: 1800 },
      { selector: '.panel--power', delay: 2200 },
      { selector: '#fault-drawer', delay: 2400, drawer: true },
    ];

    if (progressOverlay) {
      progressOverlay.classList.add('hidden');
    }

    if (overlay) {
      overlay.classList.add('hidden');
    }

    const startedAt = performance.now();

    for (const item of sequence) {
      const wait = reducedMotion ? 0 : Math.max(0, item.delay - (performance.now() - startedAt));
      if (wait > 0) {
        await sleep(wait);
      }

      if (item.drawer) {
        const drawer = document.getElementById('fault-drawer');
        if (drawer && state.getPrecomputed()?.faults?.some((fault) => fault.severity === 'CRIT')) {
          drawer.classList.add('expanded');
        }
        continue;
      }

      const panel = document.querySelector(item.selector);
      if (!(panel instanceof HTMLElement)) {
        continue;
      }

      panel.classList.remove('encrypted');
      panel.classList.add('decrypted');
    }

    showFlash(flashContainer, 'ok', 'DECRYPTION COMPLETE', 1800);
    setStatus('DECRYPTION COMPLETE');
  };

  const off = [
    bus.on(BUS_EVENTS.FILE_LOADED, ({ fileName }) => {
      setStatus(`ANALYZING ${String(fileName || 'SIGNAL').toUpperCase()}`);
      hideOverlay();
      for (const panel of panels) {
        panel.classList.add('encrypted');
        panel.classList.remove('decrypted');
      }
    }),
    bus.on(BUS_EVENTS.PRECOMPUTE_PROGRESS, ({ stage }) => {
      setStatus(stage ? String(stage).toUpperCase() : 'PRECOMPUTING');
    }),
    bus.on(BUS_EVENTS.DATA_READY, () => {
      void decryptSequence();
    }),
    bus.on(BUS_EVENTS.PRECOMPUTE_ERROR, ({ message }) => {
      setStatus('ANALYSIS FAULT');
      showFlash(flashContainer, 'error', message || 'PRECOMPUTE FAILED', 2600);
    }),
    bus.on(BUS_EVENTS.FILE_WARNING, ({ message }) => {
      showFlash(flashContainer, 'warn', message || 'FILE WARNING', 2200);
    }),
    bus.on(BUS_EVENTS.FLASH_MESSAGE, ({ level, message }) => {
      showFlash(flashContainer, level || 'ok', message || '', 1800);
    }),
    bus.on(BUS_EVENTS.PLAYBACK_STARTED, () => {
      document.body.classList.add('is-playing-glow');
      setStatus('PLAYBACK ONLINE');
    }),
    bus.on(BUS_EVENTS.PLAYBACK_PAUSED, () => {
      document.body.classList.remove('is-playing-glow');
      setStatus('PLAYBACK PAUSED');
    }),
    bus.on(BUS_EVENTS.PLAYBACK_ENDED, () => {
      document.body.classList.remove('is-playing-glow');
      setStatus('PLAYBACK ENDED');
    }),
  ];

  bus.emit(BUS_EVENTS.THEME_LOADED);

  return () => {
    if (overlayChooseFile) {
      overlayChooseFile.removeEventListener('click', onOverlayChooseFile);
    }
    for (const unsubscribe of off) {
      unsubscribe();
    }
  };
}
