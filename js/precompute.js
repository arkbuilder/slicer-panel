import { BUS_EVENTS } from './state.js';

const WORKER_URL = new URL('../workers/precompute-worker.js', import.meta.url);

let activeWorker = null;

function terminateActiveWorker() {
  if (!activeWorker) {
    return;
  }

  activeWorker.onmessage = null;
  activeWorker.onerror = null;
  activeWorker.onmessageerror = null;
  activeWorker.terminate();
  activeWorker = null;
}

export function startPrecompute(decoded, bus, state) {
  if (!decoded || !(decoded.left instanceof Float32Array) || !(decoded.right instanceof Float32Array)) {
    throw new Error('startPrecompute requires decoded left/right Float32Array data.');
  }

  terminateActiveWorker();

  if (typeof Worker === 'undefined') {
    const message = 'Web Workers are not supported in this browser.';
    bus.emit(BUS_EVENTS.PRECOMPUTE_ERROR, { message });
    throw new Error(message);
  }

  const worker = new Worker(WORKER_URL, { type: 'module' });
  activeWorker = worker;

  const left = new Float32Array(decoded.left);
  const right = new Float32Array(decoded.right);

  bus.emit(BUS_EVENTS.PRECOMPUTE_PROGRESS, {
    percent: 1,
    stage: 'Starting worker',
  });

  worker.onmessage = (event) => {
    const message = event.data || {};

    if (message.type === 'progress') {
      bus.emit(BUS_EVENTS.PRECOMPUTE_PROGRESS, {
        percent: Number(message.percent) || 0,
        stage: String(message.stage || 'Processing'),
      });
      return;
    }

    if (message.type === 'result') {
      state.setPrecomputed(message.data || null);
      state.setCurrentFrame(0);
      bus.emit(BUS_EVENTS.DATA_READY);
      bus.emit(BUS_EVENTS.PLAYHEAD_UPDATE, { frame: 0, time: 0 });
      terminateActiveWorker();
      return;
    }

    if (message.type === 'error') {
      bus.emit(BUS_EVENTS.PRECOMPUTE_ERROR, {
        message: String(message.message || 'Unknown worker error.'),
      });
      terminateActiveWorker();
    }
  };

  worker.onerror = (event) => {
    bus.emit(BUS_EVENTS.PRECOMPUTE_ERROR, {
      message: event.message || 'Precompute worker crashed.',
    });
    terminateActiveWorker();
  };

  worker.onmessageerror = () => {
    bus.emit(BUS_EVENTS.PRECOMPUTE_ERROR, {
      message: 'Precompute worker sent unreadable data.',
    });
    terminateActiveWorker();
  };

  worker.postMessage(
    {
      left,
      right,
      sampleRate: decoded.sampleRate,
      numSamples: decoded.numSamples,
      fftSize: 2048,
      hopSize: 512,
      numBands: 40,
    },
    [left.buffer, right.buffer]
  );

  return {
    worker,
    terminate: terminateActiveWorker,
  };
}

export function initPrecompute(bus, state) {
  const offFileLoaded = bus.on(BUS_EVENTS.FILE_LOADED, () => {
    const decoded = state.getDecoded();
    if (!decoded) {
      bus.emit(BUS_EVENTS.PRECOMPUTE_ERROR, {
        message: 'Cannot start precompute before decode completes.',
      });
      return;
    }

    try {
      startPrecompute(decoded, bus, state);
    } catch (error) {
      bus.emit(BUS_EVENTS.PRECOMPUTE_ERROR, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return () => {
    offFileLoaded();
    terminateActiveWorker();
  };
}

export function cancelPrecompute() {
  terminateActiveWorker();
}
