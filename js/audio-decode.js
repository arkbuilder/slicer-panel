import { BUS_EVENTS } from './state.js';

const WARNING_FILE_SIZE_BYTES = 200 * 1024 * 1024;
const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;
const MOBILE_DURATION_WARNING_SECONDS = 180;

let sharedDecodeContext = null;

function getAudioContext() {
  if (!sharedDecodeContext || sharedDecodeContext.state === 'closed') {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      throw new Error('Web Audio API is not available in this browser.');
    }
    sharedDecodeContext = new AudioCtx();
  }
  return sharedDecodeContext;
}

async function ensureContextReady(context) {
  if (context.state === 'suspended') {
    try {
      await context.resume();
    } catch (error) {
      // iOS can reject resume until strict user gesture timing; decode may still work.
    }
  }
}

function isMobileDevice() {
  const ua = navigator.userAgent || '';
  return /android|iphone|ipad|ipod|mobile/i.test(ua);
}

function readArrayBuffer(file) {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read file data.'));
    reader.readAsArrayBuffer(file);
  });
}

function decodeBuffer(context, arrayBuffer) {
  if (context.decodeAudioData.length >= 2) {
    return new Promise((resolve, reject) => {
      context.decodeAudioData(arrayBuffer, resolve, reject);
    });
  }
  return context.decodeAudioData(arrayBuffer);
}

/**
 * Decode an uploaded audio file into PCM channel arrays.
 * @param {File} file
 * @returns {Promise<{
 *   left: Float32Array,
 *   right: Float32Array,
 *   sampleRate: number,
 *   numSamples: number,
 *   duration: number,
 *   numChannels: number
 * }>}
 */
export async function decodeAudioFile(file) {
  if (!(file instanceof File)) {
    throw new Error('decodeAudioFile requires a File instance.');
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Maximum supported size is 500 MB.`
    );
  }

  const context = getAudioContext();
  await ensureContextReady(context);

  const arrayBuffer = await readArrayBuffer(file);
  const decoded = await decodeBuffer(context, arrayBuffer);

  const left = new Float32Array(decoded.length);
  left.set(decoded.getChannelData(0));

  let right;
  if (decoded.numberOfChannels > 1) {
    right = new Float32Array(decoded.length);
    right.set(decoded.getChannelData(1));
  } else {
    right = new Float32Array(left);
  }

  return {
    left,
    right,
    sampleRate: decoded.sampleRate,
    numSamples: decoded.length,
    duration: decoded.duration,
    numChannels: decoded.numberOfChannels,
  };
}

function emitWarning(bus, message) {
  console.warn(`[decode] ${message}`);
  bus.emit(BUS_EVENTS.FILE_WARNING, { message });
  bus.emit(BUS_EVENTS.FLASH_MESSAGE, { level: 'warn', message });
}

export function initDecode(bus, state) {
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');

  if (!fileInput || !dropZone) {
    console.warn('[decode] missing #file-input or #drop-zone.');
    return () => {};
  }

  let activeToken = 0;

  const dragEnter = (event) => {
    event.preventDefault();
    dropZone.classList.add('drag-over');
  };

  const dragLeave = (event) => {
    event.preventDefault();
    dropZone.classList.remove('drag-over');
  };

  const blockEvent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  async function processFile(file) {
    if (!(file instanceof File)) {
      return;
    }

    const token = ++activeToken;
    bus.emit(BUS_EVENTS.PRECOMPUTE_PROGRESS, {
      percent: 0,
      stage: 'Decoding audio',
    });

    if (file.size > WARNING_FILE_SIZE_BYTES) {
      emitWarning(
        bus,
        `Large file ${(file.size / (1024 * 1024)).toFixed(1)} MB may take longer to process.`
      );
    }

    try {
      const decoded = await decodeAudioFile(file);
      if (token !== activeToken) {
        return;
      }

      if (isMobileDevice() && decoded.duration > MOBILE_DURATION_WARNING_SECONDS) {
        emitWarning(
          bus,
          `File duration ${decoded.duration.toFixed(1)}s may reduce mobile performance.`
        );
      }

      state.setDecoded(decoded);
      state.setPrecomputed(null);
      state.setCurrentFrame(0);
      state.setBrush(null);
      state.setLoop(null);
      state.clearBookmarks();
      state.setFileMeta({
        fileName: file.name,
        duration: decoded.duration,
        sampleRate: decoded.sampleRate,
      });

      bus.emit(BUS_EVENTS.FILE_LOADED, {
        fileName: file.name,
        duration: decoded.duration,
        sampleRate: decoded.sampleRate,
      });
    } catch (error) {
      if (token !== activeToken) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      bus.emit(BUS_EVENTS.PRECOMPUTE_ERROR, { message });
      bus.emit(BUS_EVENTS.FLASH_MESSAGE, { level: 'error', message });
    } finally {
      fileInput.value = '';
    }
  }

  const onInput = () => {
    const file = fileInput.files?.[0];
    void processFile(file);
  };

  const onDrop = (event) => {
    blockEvent(event);
    dropZone.classList.remove('drag-over');
    const file = event.dataTransfer?.files?.[0];
    void processFile(file);
  };

  const onDropZoneClick = (event) => {
    const target = event.target;
    if (target === fileInput) {
      return;
    }
    fileInput.click();
  };

  const onDropZoneKeyDown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    fileInput.click();
  };

  fileInput.addEventListener('change', onInput);
  dropZone.addEventListener('click', onDropZoneClick);
  dropZone.addEventListener('keydown', onDropZoneKeyDown);

  for (const eventName of ['dragenter', 'dragover']) {
    dropZone.addEventListener(eventName, dragEnter);
    dropZone.addEventListener(eventName, blockEvent);
  }

  for (const eventName of ['dragleave', 'drop']) {
    dropZone.addEventListener(eventName, dragLeave);
  }

  dropZone.addEventListener('drop', onDrop);

  return () => {
    activeToken += 1;
    fileInput.removeEventListener('change', onInput);
    dropZone.removeEventListener('click', onDropZoneClick);
    dropZone.removeEventListener('keydown', onDropZoneKeyDown);

    for (const eventName of ['dragenter', 'dragover']) {
      dropZone.removeEventListener(eventName, dragEnter);
      dropZone.removeEventListener(eventName, blockEvent);
    }

    for (const eventName of ['dragleave', 'drop']) {
      dropZone.removeEventListener(eventName, dragLeave);
    }

    dropZone.removeEventListener('drop', onDrop);
  };
}
