import { fft } from "../lib/fft.js";

const DEFAULT_FFT_SIZE = 2048;
const DEFAULT_HOP_SIZE = 512;
const DEFAULT_NUM_BANDS = 40;
const WAVEFORM_SCALES = [64, 256, 1024, 4096];
const TILE_SIZE = 1000;
const EPSILON = 1e-12;
const SPECTROGRAM_MIN_DB = -100;

self.onmessage = (event) => {
  try {
    const result = runPrecompute(event.data ?? {});
    const transferables = collectTransferables(result);

    self.postMessage(
      {
        type: "result",
        data: result,
      },
      transferables
    );
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

function runPrecompute(payload) {
  let left = toFloat32Array(payload.left, "left");
  let right = payload.right ? toFloat32Array(payload.right, "right") : new Float32Array(left);

  const sampleRate = Number(payload.sampleRate) || 44100;
  const fftSize = sanitizePowerOfTwo(payload.fftSize, DEFAULT_FFT_SIZE);
  const hopSize = Math.max(1, Number(payload.hopSize) || DEFAULT_HOP_SIZE);
  const numBands = Math.max(1, Number(payload.numBands) || DEFAULT_NUM_BANDS);

  let numSamples = Number(payload.numSamples);
  if (!Number.isFinite(numSamples) || numSamples <= 0) {
    numSamples = Math.min(left.length, right.length);
  }
  numSamples = Math.min(numSamples, left.length, right.length);
  if (numSamples < 1) {
    throw new Error("Audio payload has no samples.");
  }

  if (left.length !== numSamples) {
    left = left.slice(0, numSamples);
  }
  if (right.length !== numSamples) {
    right = right.slice(0, numSamples);
  }

  const duration = numSamples / sampleRate;
  const numFrames = Math.max(1, Math.floor((numSamples - fftSize) / hopSize) + 1);
  const numBins = fftSize >> 1;
  const bandFrequencies = computeBandFrequencies(numBands, sampleRate);
  const bandBinRanges = computeBandBinRanges(bandFrequencies, sampleRate, fftSize, numBins);

  postProgress(2, "Initializing precompute");

  const waveformLODsLeft = computeWaveformLODs(left, WAVEFORM_SCALES);
  const waveformLODsRight = computeWaveformLODs(right, WAVEFORM_SCALES);
  postProgress(10, "Downsampled waveform LODs");

  const rmsLeft = computeRmsEnvelope(left, numFrames, hopSize);
  const rmsRight = computeRmsEnvelope(right, numFrames, hopSize);
  postProgress(20, "Computed RMS envelope");

  const hannWindow = createHannWindow(fftSize);
  const bandsLeft = new Uint8Array(numFrames * numBands);
  const bandsRight = new Uint8Array(numFrames * numBands);
  const spectralFlux = new Float32Array(numFrames);

  const spectrogramTilesLeft = createSpectrogramTiles(numFrames, numBins, TILE_SIZE);
  const spectrogramTilesRight = createSpectrogramTiles(numFrames, numBins, TILE_SIZE);

  const reLeft = new Float32Array(fftSize);
  const imLeft = new Float32Array(fftSize);
  const reRight = new Float32Array(fftSize);
  const imRight = new Float32Array(fftSize);
  const magnitudesLeft = new Float32Array(numBins);
  const magnitudesRight = new Float32Array(numBins);

  let prevMixedMagnitudes = new Float32Array(numBins);
  let currMixedMagnitudes = new Float32Array(numBins);

  postProgress(21, "Running STFT");
  for (let frame = 0; frame < numFrames; frame += 1) {
    const frameStart = frame * hopSize;

    fillWindowedSignal(reLeft, left, frameStart, fftSize, hannWindow);
    imLeft.fill(0);
    fft(reLeft, imLeft, false);
    const peakLeft = fillMagnitudes(reLeft, imLeft, magnitudesLeft);

    fillWindowedSignal(reRight, right, frameStart, fftSize, hannWindow);
    imRight.fill(0);
    fft(reRight, imRight, false);
    const peakRight = fillMagnitudes(reRight, imRight, magnitudesRight);

    writeBandFrame(bandsLeft, frame, magnitudesLeft, peakLeft, bandBinRanges);
    writeBandFrame(bandsRight, frame, magnitudesRight, peakRight, bandBinRanges);

    writeSpectrogramFrame(spectrogramTilesLeft, frame, magnitudesLeft, peakLeft, numBins, TILE_SIZE);
    writeSpectrogramFrame(spectrogramTilesRight, frame, magnitudesRight, peakRight, numBins, TILE_SIZE);

    let flux = 0;
    for (let bin = 0; bin < numBins; bin += 1) {
      const mixedMagnitude = 0.5 * (magnitudesLeft[bin] + magnitudesRight[bin]);
      currMixedMagnitudes[bin] = mixedMagnitude;
      if (frame > 0) {
        const delta = mixedMagnitude - prevMixedMagnitudes[bin];
        if (delta > 0) {
          flux += delta;
        }
      }
    }
    spectralFlux[frame] = flux / numBins;

    const swapBuffer = prevMixedMagnitudes;
    prevMixedMagnitudes = currMixedMagnitudes;
    currMixedMagnitudes = swapBuffer;

    if ((frame & 31) === 0 || frame === numFrames - 1) {
      const progress = 20 + ((frame + 1) / numFrames) * 50;
      postProgress(progress, "Running STFT");
    }
  }
  postProgress(75, "Computed logarithmic bands");

  const fluxMedians = computeRunningMedian(spectralFlux, 10);
  const onsets = detectOnsets(spectralFlux, fluxMedians);
  postProgress(80, "Computed spectral flux and onsets");

  const phaseCorrelation = computePhaseCorrelation(left, right, numFrames, hopSize);
  postProgress(85, "Computed phase correlation");

  const faults = detectFaults({
    left,
    right,
    numSamples,
    numFrames,
    sampleRate,
    hopSize,
    rmsLeft,
    rmsRight,
    spectralFlux,
    fluxMedians,
    phaseCorrelation,
  });
  postProgress(95, "Detected signal faults");
  postProgress(100, "Precompute complete");

  return {
    sampleRate,
    numSamples,
    numFrames,
    duration,
    fftSize,
    hopSize,
    numBands,
    waveformLODs: {
      left: waveformLODsLeft,
      right: waveformLODsRight,
      scales: [...WAVEFORM_SCALES],
    },
    rmsLeft,
    rmsRight,
    bandsLeft,
    bandsRight,
    spectralFlux,
    onsets,
    phaseCorrelation,
    spectrogramTilesLeft,
    spectrogramTilesRight,
    tileSize: TILE_SIZE,
    faults,
    bandFrequencies,
  };
}

function postProgress(percent, stage) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  self.postMessage({
    type: "progress",
    percent: value,
    stage,
  });
}

function toFloat32Array(value, name) {
  if (value instanceof Float32Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Float32Array(value);
  }
  throw new Error(`Expected Float32Array for "${name}".`);
}

function sanitizePowerOfTwo(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 2) {
    return fallback;
  }
  if ((parsed & (parsed - 1)) !== 0) {
    return fallback;
  }
  return parsed;
}

function computeWaveformLODs(samples, scales) {
  const lods = [];
  for (const scale of scales) {
    const chunkCount = Math.ceil(samples.length / scale);
    const lod = new Float32Array(chunkCount * 2);
    let writeIndex = 0;

    for (let start = 0; start < samples.length; start += scale) {
      const end = Math.min(samples.length, start + scale);
      let min = Infinity;
      let max = -Infinity;

      for (let i = start; i < end; i += 1) {
        const sample = samples[i];
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }

      lod[writeIndex] = Number.isFinite(min) ? min : 0;
      lod[writeIndex + 1] = Number.isFinite(max) ? max : 0;
      writeIndex += 2;
    }

    lods.push(lod);
  }
  return lods;
}

function computeRmsEnvelope(samples, numFrames, hopSize) {
  const rms = new Float32Array(numFrames);

  for (let frame = 0; frame < numFrames; frame += 1) {
    const start = frame * hopSize;
    if (start >= samples.length) {
      rms[frame] = 0;
      continue;
    }

    const end = Math.min(samples.length, start + hopSize);
    let sumSquares = 0;
    for (let i = start; i < end; i += 1) {
      const value = samples[i];
      sumSquares += value * value;
    }
    rms[frame] = Math.sqrt(sumSquares / Math.max(1, end - start));
  }

  return rms;
}

function createHannWindow(size) {
  const window = new Float32Array(size);
  const denominator = size - 1;
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denominator));
  }
  return window;
}

function fillWindowedSignal(target, samples, start, fftSize, window) {
  for (let i = 0; i < fftSize; i += 1) {
    const index = start + i;
    target[i] = index < samples.length ? samples[index] * window[i] : 0;
  }
}

function fillMagnitudes(re, im, out) {
  let peak = 0;
  for (let i = 0; i < out.length; i += 1) {
    const magnitude = Math.hypot(re[i], im[i]);
    out[i] = magnitude;
    if (magnitude > peak) {
      peak = magnitude;
    }
  }
  return peak;
}

function computeBandFrequencies(numBands, sampleRate) {
  const minFreq = 20;
  const nyquist = Math.max(20, sampleRate / 2);
  const maxFreq = Math.max(minFreq, Math.min(20000, nyquist));
  const frequencies = new Array(numBands);

  for (let i = 0; i < numBands; i += 1) {
    const low = minFreq * Math.pow(maxFreq / minFreq, i / numBands);
    const high = minFreq * Math.pow(maxFreq / minFreq, (i + 1) / numBands);
    frequencies[i] = { low, high };
  }

  return frequencies;
}

function computeBandBinRanges(bandFrequencies, sampleRate, fftSize, numBins) {
  const ranges = new Array(bandFrequencies.length);
  const binWidth = sampleRate / fftSize;

  for (let i = 0; i < bandFrequencies.length; i += 1) {
    const band = bandFrequencies[i];
    const lowBin = clampInt(Math.floor(band.low / binWidth), 0, numBins - 1);
    const highBin = clampInt(Math.floor(band.high / binWidth), lowBin, numBins - 1);
    ranges[i] = { lowBin, highBin };
  }

  return ranges;
}

function writeBandFrame(destination, frameIndex, magnitudes, peak, bandRanges) {
  const offset = frameIndex * bandRanges.length;
  if (peak <= EPSILON) {
    destination.fill(0, offset, offset + bandRanges.length);
    return;
  }

  for (let bandIndex = 0; bandIndex < bandRanges.length; bandIndex += 1) {
    const range = bandRanges[bandIndex];
    let sum = 0;
    for (let bin = range.lowBin; bin <= range.highBin; bin += 1) {
      sum += magnitudes[bin];
    }

    const count = range.highBin - range.lowBin + 1;
    const average = sum / count;
    const normalized = Math.min(1, average / peak);
    destination[offset + bandIndex] = clampInt(Math.round(Math.sqrt(normalized) * 255), 0, 255);
  }
}

function createSpectrogramTiles(numFrames, numBins, tileSize) {
  const tileCount = Math.max(1, Math.ceil(numFrames / tileSize));
  const tiles = new Array(tileCount);

  for (let tile = 0; tile < tileCount; tile += 1) {
    const framesInTile = Math.min(tileSize, numFrames - tile * tileSize);
    tiles[tile] = new Uint8Array(framesInTile * numBins);
  }

  return tiles;
}

function writeSpectrogramFrame(tiles, frameIndex, magnitudes, peak, numBins, tileSize) {
  const tileIndex = Math.floor(frameIndex / tileSize);
  const tile = tiles[tileIndex];
  const frameInTile = frameIndex % tileSize;
  const rowOffset = frameInTile * numBins;

  if (!tile) {
    return;
  }
  if (peak <= EPSILON) {
    tile.fill(0, rowOffset, rowOffset + numBins);
    return;
  }

  for (let bin = 0; bin < numBins; bin += 1) {
    const ratio = magnitudes[bin] / peak;
    const db = 20 * Math.log10(Math.max(ratio, EPSILON));
    const normalized = (db - SPECTROGRAM_MIN_DB) / -SPECTROGRAM_MIN_DB;
    tile[rowOffset + bin] = clampInt(Math.round(normalized * 255), 0, 255);
  }
}

function computeRunningMedian(values, radius) {
  const medians = new Float32Array(values.length);
  const window = [];

  for (let i = 0; i < values.length; i += 1) {
    window.length = 0;
    const start = Math.max(0, i - radius);
    const end = Math.min(values.length - 1, i + radius);

    for (let j = start; j <= end; j += 1) {
      window.push(values[j]);
    }

    window.sort((a, b) => a - b);
    medians[i] = window[Math.floor(window.length / 2)] ?? 0;
  }

  return medians;
}

function detectOnsets(flux, medians) {
  const indexes = [];

  for (let i = 1; i < flux.length; i += 1) {
    const threshold = 4 * Math.max(medians[i], 1e-6);
    if (flux[i] <= threshold) {
      continue;
    }

    const prev = flux[i - 1] ?? 0;
    const next = flux[i + 1] ?? 0;
    if (flux[i] >= prev && flux[i] >= next) {
      indexes.push(i);
    }
  }

  return new Uint32Array(indexes);
}

function computePhaseCorrelation(left, right, numFrames, hopSize) {
  const correlation = new Float32Array(numFrames);

  for (let frame = 0; frame < numFrames; frame += 1) {
    const start = frame * hopSize;
    if (start >= left.length) {
      correlation[frame] = 0;
      continue;
    }

    const end = Math.min(left.length, start + hopSize);
    let sumProduct = 0;
    let sumLeftSquares = 0;
    let sumRightSquares = 0;

    for (let i = start; i < end; i += 1) {
      const l = left[i];
      const r = right[i];
      sumProduct += l * r;
      sumLeftSquares += l * l;
      sumRightSquares += r * r;
    }

    const denominator = Math.sqrt(sumLeftSquares * sumRightSquares);
    if (denominator <= EPSILON) {
      correlation[frame] = 0;
    } else {
      correlation[frame] = Math.max(-1, Math.min(1, sumProduct / denominator));
    }
  }

  return correlation;
}

function detectFaults({
  left,
  right,
  numSamples,
  numFrames,
  sampleRate,
  hopSize,
  rmsLeft,
  rmsRight,
  spectralFlux,
  fluxMedians,
  phaseCorrelation,
}) {
  const faults = [];

  detectClippingFaults(faults, left, right, sampleRate, hopSize);
  detectSilenceFaults(faults, rmsLeft, rmsRight, sampleRate, hopSize);
  detectDcOffsetFault(faults, left, right, numFrames);
  detectSpectralAnomalies(faults, spectralFlux, fluxMedians);
  detectPhaseInversionFaults(faults, phaseCorrelation, sampleRate, hopSize);
  detectDynamicRangeFault(faults, left, right, numSamples, numFrames);
  detectMonoSegmentFaults(faults, left, right, numFrames, sampleRate, hopSize);

  return faults;
}

function detectClippingFaults(faults, left, right, sampleRate, hopSize) {
  const threshold = 0.99;
  let runStart = -1;

  for (let i = 0; i < left.length; i += 1) {
    const clipped = Math.abs(left[i]) >= threshold || Math.abs(right[i]) >= threshold;
    if (clipped) {
      if (runStart < 0) {
        runStart = i;
      }
      continue;
    }

    if (runStart >= 0) {
      const runLength = i - runStart;
      if (runLength >= 2) {
        const frameStart = Math.floor(runStart / hopSize);
        const frameEnd = Math.floor((i - 1) / hopSize);
        const startSeconds = (runStart / sampleRate).toFixed(3);
        const endSeconds = ((i - 1) / sampleRate).toFixed(3);
        faults.push({
          type: "clipping",
          severity: "CRIT",
          frameStart,
          frameEnd,
          message: `Clipping from ${startSeconds}s to ${endSeconds}s (${runLength} samples >= 0.99).`,
        });
      }
      runStart = -1;
    }
  }

  if (runStart >= 0) {
    const runLength = left.length - runStart;
    if (runLength >= 2) {
      const frameStart = Math.floor(runStart / hopSize);
      const frameEnd = Math.floor((left.length - 1) / hopSize);
      const startSeconds = (runStart / sampleRate).toFixed(3);
      const endSeconds = ((left.length - 1) / sampleRate).toFixed(3);
      faults.push({
        type: "clipping",
        severity: "CRIT",
        frameStart,
        frameEnd,
        message: `Clipping from ${startSeconds}s to ${endSeconds}s (${runLength} samples >= 0.99).`,
      });
    }
  }
}

function detectSilenceFaults(faults, rmsLeft, rmsRight, sampleRate, hopSize) {
  const silenceThreshold = 0.001;
  const minFrames = Math.max(1, Math.ceil((0.5 * sampleRate) / hopSize));
  const combined = new Float32Array(rmsLeft.length);

  for (let i = 0; i < rmsLeft.length; i += 1) {
    combined[i] = 0.5 * (rmsLeft[i] + rmsRight[i]);
  }

  const runs = collectRuns(combined, (value) => value < silenceThreshold, minFrames);
  for (const [start, end] of runs) {
    faults.push({
      type: "silence",
      severity: "WARN",
      frameStart: start,
      frameEnd: end,
      message: `Silence detected for ${(framesToSeconds(end - start + 1, hopSize, sampleRate)).toFixed(2)}s.`,
    });
  }
}

function detectDcOffsetFault(faults, left, right, numFrames) {
  let sum = 0;
  for (let i = 0; i < left.length; i += 1) {
    sum += 0.5 * (left[i] + right[i]);
  }
  const mean = sum / left.length;
  if (Math.abs(mean) > 0.01) {
    faults.push({
      type: "dc_offset",
      severity: "INFO",
      frameStart: 0,
      frameEnd: Math.max(0, numFrames - 1),
      message: `DC offset mean is ${mean.toFixed(5)} (threshold 0.01).`,
    });
  }
}

function detectSpectralAnomalies(faults, flux, medians) {
  const runs = collectRuns(
    flux,
    (value, index) => value > 4 * Math.max(medians[index], 1e-6),
    1
  );

  for (const [start, end] of runs) {
    faults.push({
      type: "spectral_anomaly",
      severity: "WARN",
      frameStart: start,
      frameEnd: end,
      message: `Spectral flux exceeded threshold between frames ${start} and ${end}.`,
    });
  }
}

function detectPhaseInversionFaults(faults, phaseCorrelation, sampleRate, hopSize) {
  const threshold = -0.5;
  const minFrames = Math.max(1, Math.ceil((0.2 * sampleRate) / hopSize));
  const runs = collectRuns(phaseCorrelation, (value) => value < threshold, minFrames);

  for (const [start, end] of runs) {
    faults.push({
      type: "phase_inversion",
      severity: "WARN",
      frameStart: start,
      frameEnd: end,
      message: `Phase inversion likely between frames ${start} and ${end} (correlation < -0.5).`,
    });
  }
}

function detectDynamicRangeFault(faults, left, right, numSamples, numFrames) {
  let peak = 0;
  let sumSquares = 0;

  for (let i = 0; i < numSamples; i += 1) {
    const l = left[i];
    const r = right[i];
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    sumSquares += 0.5 * (l * l + r * r);
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, numSamples));
  const crestFactor = peak <= EPSILON ? 0 : 20 * Math.log10(peak / Math.max(rms, EPSILON));
  faults.push({
    type: "dynamic_range",
    severity: "INFO",
    frameStart: 0,
    frameEnd: Math.max(0, numFrames - 1),
    message: `Track crest factor is ${crestFactor.toFixed(2)} dB.`,
    crestFactorDb: crestFactor,
  });
}

function detectMonoSegmentFaults(faults, left, right, numFrames, sampleRate, hopSize) {
  const diffRmsByFrame = new Float32Array(numFrames);

  for (let frame = 0; frame < numFrames; frame += 1) {
    const start = frame * hopSize;
    if (start >= left.length) {
      diffRmsByFrame[frame] = 0;
      continue;
    }

    const end = Math.min(left.length, start + hopSize);
    let sumSquares = 0;

    for (let i = start; i < end; i += 1) {
      const diff = left[i] - right[i];
      sumSquares += diff * diff;
    }

    diffRmsByFrame[frame] = Math.sqrt(sumSquares / Math.max(1, end - start));
  }

  const minFrames = Math.max(1, Math.ceil((2 * sampleRate) / hopSize));
  const runs = collectRuns(diffRmsByFrame, (value) => value < 0.0001, minFrames);
  for (const [start, end] of runs) {
    faults.push({
      type: "mono_segment",
      severity: "INFO",
      frameStart: start,
      frameEnd: end,
      message: `Stereo collapse (mono segment) detected between frames ${start} and ${end}.`,
    });
  }
}

function collectRuns(values, predicate, minLength) {
  const runs = [];
  let start = -1;

  for (let i = 0; i < values.length; i += 1) {
    if (predicate(values[i], i)) {
      if (start < 0) {
        start = i;
      }
    } else if (start >= 0) {
      if (i - start >= minLength) {
        runs.push([start, i - 1]);
      }
      start = -1;
    }
  }

  if (start >= 0 && values.length - start >= minLength) {
    runs.push([start, values.length - 1]);
  }

  return runs;
}

function framesToSeconds(frameCount, hopSize, sampleRate) {
  return (frameCount * hopSize) / sampleRate;
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function collectTransferables(result) {
  const transferables = [];

  for (const lod of result.waveformLODs.left) {
    transferables.push(lod.buffer);
  }
  for (const lod of result.waveformLODs.right) {
    transferables.push(lod.buffer);
  }

  transferables.push(result.rmsLeft.buffer);
  transferables.push(result.rmsRight.buffer);
  transferables.push(result.bandsLeft.buffer);
  transferables.push(result.bandsRight.buffer);
  transferables.push(result.spectralFlux.buffer);
  transferables.push(result.onsets.buffer);
  transferables.push(result.phaseCorrelation.buffer);

  for (const tile of result.spectrogramTilesLeft) {
    transferables.push(tile.buffer);
  }
  for (const tile of result.spectrogramTilesRight) {
    transferables.push(tile.buffer);
  }

  return transferables;
}
