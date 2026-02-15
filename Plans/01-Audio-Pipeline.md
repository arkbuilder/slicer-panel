# Plan 01 — Audio Pipeline (Decode + Precompute)

> **Owner:** Engineer A
> **Dependencies:** Plan 00 (file structure)
> **Estimated effort:** 4–6 hours
> **Files to create:** `js/audio-decode.js`, `js/precompute.js`, `workers/precompute-worker.js`, `lib/fft.js`

---

## Objective

Upload a WAV/MP3/audio file → decode to raw PCM → run a Web Worker that precomputes all derived datasets (waveform LODs, RMS, STFT, 40-band matrix, spectral flux, onsets, phase correlation, fault events). Store results in state and emit `data-ready`.

---

## Part A: Audio Decode (`js/audio-decode.js`)

### Interface

```js
/**
 * Decodes an audio file (WAV, MP3, etc.) into raw PCM data.
 * @param {File} file - The uploaded File object
 * @returns {Promise<DecodedAudio>}
 */
export async function decodeAudioFile(file) { ... }

/**
 * @typedef {Object} DecodedAudio
 * @property {Float32Array} left      - Left channel samples [-1, 1]
 * @property {Float32Array} right     - Right channel samples [-1, 1] (duplicated from left if mono)
 * @property {number} sampleRate      - e.g. 44100
 * @property {number} numSamples      - total samples per channel
 * @property {number} duration        - seconds
 * @property {number} numChannels     - 1 or 2 (original)
 */
```

### Implementation Steps

1. Read the `File` as `ArrayBuffer` via `FileReader` (or `file.arrayBuffer()`)
2. Create an `AudioContext` (or reuse a global one)
3. Call `audioContext.decodeAudioData(arrayBuffer)` → `AudioBuffer`
4. Extract channels:
   - `audioBuffer.getChannelData(0)` → left
   - If stereo: `audioBuffer.getChannelData(1)` → right
   - If mono: copy left → right
5. Return `DecodedAudio` object
6. Emit `bus.emit('file-loaded', { fileName, duration, sampleRate })` so the UI can update

### Constraints

- **Max file size:** Show warning if file > 200MB. Hard reject > 500MB.
- **AudioContext resume:** Browsers require user gesture before audio context can start. The decode must happen after a click/drop event.
- **Memory:** A 5-min stereo 44.1kHz file ≈ 100MB as Float32. This is fine for desktop. On mobile, warn if > 3 min.

---

## Part B: Precompute Orchestrator (`js/precompute.js`)

### Interface

```js
/**
 * Sends decoded audio to the Web Worker for precomputation.
 * @param {DecodedAudio} decoded
 * @param {EventBus} bus - to emit progress and completion
 * @param {AppState} state - to store results
 */
export function startPrecompute(decoded, bus, state) { ... }
```

### Implementation Steps

1. Create a `Worker('workers/precompute-worker.js', { type: 'module' })`
2. Transfer `left` and `right` Float32Arrays to the worker (Transferable — zero-copy)
3. Listen for worker messages:
   - `{ type: 'progress', percent: number, stage: string }` → emit `bus.emit('precompute-progress', { percent, stage })`
   - `{ type: 'result', data: PrecomputedData }` → store in `state.setPrecomputed(data)`, emit `bus.emit('data-ready')`
   - `{ type: 'error', message: string }` → emit `bus.emit('precompute-error', { message })`
4. Handle worker termination / cleanup

---

## Part C: Precompute Worker (`workers/precompute-worker.js`)

This is the heavy-lifting module. It runs entirely off the main thread.

### Input (via `postMessage`)

```js
// Main thread sends:
worker.postMessage({
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  numSamples: number,
  fftSize: 2048,
  hopSize: 512,
  numBands: 40
}, [left.buffer, right.buffer]); // Transferable
```

### Pipeline Steps

#### Step 1: Downsample LODs (Waveform)
- For each LOD scale `k` in `[64, 256, 1024, 4096]`:
  - Walk the samples array in chunks of `k`
  - For each chunk, compute `min` and `max` → store as interleaved `[min, max, min, max, ...]`
  - Output: `Float32Array` of length `ceil(N/k) × 2`
- Do this for both left and right channels
- Post progress: 10%

#### Step 2: RMS Envelope
- Hop through the signal with window = `hopSize` (512 samples)
- For each window: `rms = sqrt(mean(samples^2))`
- Output: `Float32Array[numFrames]` for left and right
- Post progress: 20%

#### Step 3: STFT (Short-Time Fourier Transform)
- Import `lib/fft.js` (radix-2 FFT)
- For each frame `f` from 0 to `numFrames - 1`:
  - Extract `fftSize` (2048) samples starting at `f * hopSize`
  - Apply Hann window: `sample[i] *= 0.5 * (1 - cos(2π * i / (N-1)))`
  - Run FFT → complex output `[re, im]` pairs
  - Compute magnitude: `mag[i] = sqrt(re[i]^2 + im[i]^2)` for bins 0..1023
  - Convert to dB (optional, for spectrogram): `dB = 20 * log10(mag / maxMag)`
- **Memory strategy:** Do NOT store the full STFT matrix permanently. Instead:
  - Compute each frame, immediately derive the 40-band averages and spectral flux (Steps 4–5)
  - For the spectrogram, quantize magnitudes to `Uint8` and store as tiles (chunks of 1000 frames). Each tile = `Uint8Array[1000 × 1024]`
  - Alternatively, re-derive spectrogram tiles lazily (store only the 40-band output)
- Post progress: 20% → 70% (bulk of compute time)

#### Step 4: 40 Logarithmic Bands
- For each frame, map the 1024 magnitude bins to 40 log-spaced bands:
  ```
  f_low(i) = 20 * (20000/20)^(i/40)
  f_high(i) = 20 * (20000/20)^((i+1)/40)
  bin_low = floor(f_low / binWidth)
  bin_high = floor(f_high / binWidth)
  bandValue = average of magnitudes in [bin_low, bin_high]
  ```
- Scale to 0–255 → `Uint8`
- Output: `Uint8Array[numFrames × 40]` (row-major: frame 0 bands 0–39, frame 1 bands 0–39, ...)
- Same for left and right channels
- Post progress: 75%

#### Step 5: Spectral Flux + Onset Detection
- For each frame `f > 0`:
  - `flux[f] = sum(max(0, |mag_f[bin]| - |mag_{f-1}[bin]|))` across all bins
- Onset detection:
  - Compute running median of flux over a window of ±10 frames
  - Onset = frames where `flux[f] > 4 * median`
- Output: `Float32Array[numFrames]` (flux) + `Uint32Array[numOnsets]` (frame indices)
- Post progress: 80%

#### Step 6: Phase Correlation
- For each frame (hop window of raw samples):
  - `L` = left samples for this window, `R` = right samples
  - `correlation = sum(L[i] * R[i]) / sqrt(sum(L[i]^2) * sum(R[i]^2))`
  - Result is −1 (antiphase) to +1 (identical)
- Output: `Float32Array[numFrames]`
- Post progress: 85%

#### Step 7: Fault Detection
- Scan the entire signal and precomputed data for anomalies:

| Rule | Input | Detection | Output |
|---|---|---|---|
| Clipping | raw samples | `abs(sample) >= 0.99` for ≥ 2 consecutive samples | `{ type: 'clipping', severity: 'CRIT', frameStart, frameEnd, message }` |
| Silence | RMS envelope | `rms < 0.001` (≈ −60dB) for > 500ms worth of frames | `{ type: 'silence', severity: 'WARN', ... }` |
| DC Offset | raw samples | `abs(mean(allSamples)) > 0.01` | `{ type: 'dc_offset', severity: 'INFO', ... }` |
| Spectral Anomaly | spectral flux | `flux > 4 × running median` | `{ type: 'spectral_anomaly', severity: 'WARN', ... }` |
| Phase Inversion | phase correlation | `correlation < -0.5` for > 200ms of frames | `{ type: 'phase_inversion', severity: 'WARN', ... }` |
| Dynamic Range | RMS + peaks | `crestFactor = 20*log10(peak/rms)` for full track | `{ type: 'dynamic_range', severity: 'INFO', ... }` |
| Mono Segment | L−R diff | `rms(L−R) < 0.0001` for > 2 seconds | `{ type: 'mono_segment', severity: 'INFO', ... }` |

- Output: `FaultEvent[]`
- Post progress: 95%

#### Step 8: Compute Band Frequency Ranges (metadata)
- Precompute the 40 `{ low, high }` frequency pairs for tooltips
- Output: `Array[40]` of `{ low: number, high: number }`
- Post progress: 100%

### Output (via `postMessage`)

```js
self.postMessage({
  type: 'result',
  data: {
    sampleRate,
    numSamples,
    numFrames,
    duration,
    fftSize: 2048,
    hopSize: 512,
    numBands: 40,

    // Waveform LODs (per channel)
    waveformLODs: {
      left: [Float32Array, Float32Array, Float32Array, Float32Array],
      right: [Float32Array, Float32Array, Float32Array, Float32Array],
      scales: [64, 256, 1024, 4096]
    },

    // Per-frame data
    rmsLeft: Float32Array,        // [numFrames]
    rmsRight: Float32Array,       // [numFrames]
    bandsLeft: Uint8Array,        // [numFrames × 40]
    bandsRight: Uint8Array,       // [numFrames × 40]
    spectralFlux: Float32Array,   // [numFrames]
    onsets: Uint32Array,          // [numOnsets]
    phaseCorrelation: Float32Array, // [numFrames]

    // Spectrogram tiles (Uint8 quantized magnitudes)
    spectrogramTilesLeft: Uint8Array[],   // each [tileFrames × 1024]
    spectrogramTilesRight: Uint8Array[],
    tileSize: 1000,

    // Fault events
    faults: FaultEvent[],

    // Metadata
    bandFrequencies: { low: number, high: number }[]  // [40]
  }
}, transferableArrays);
```

Transfer all typed arrays as `Transferable` to avoid copying.

---

## Part D: FFT Library (`lib/fft.js`)

Use a minimal radix-2 Cooley-Tukey FFT. The module should export:

```js
/**
 * In-place radix-2 FFT.
 * @param {Float32Array} re - Real part (length must be power of 2)
 * @param {Float32Array} im - Imaginary part (same length)
 * @param {boolean} inverse - true for IFFT
 */
export function fft(re, im, inverse = false) { ... }
```

Implementation notes:
- Bit-reversal permutation
- Butterfly operations
- Pre-compute twiddle factors for size 2048 (reuse across frames)
- ~50 lines of code. Well-known algorithm.

### Hann Window (precomputed)

```js
const hannWindow = new Float32Array(2048);
for (let i = 0; i < 2048; i++) {
  hannWindow[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / 2047));
}
```

---

## Testing / Verification

- [ ] Upload a known WAV file (e.g., 1kHz sine wave, 1 second, 44100 Hz stereo)
- [ ] Verify `decodeAudioFile()` returns correct `sampleRate`, `numSamples`, `duration`
- [ ] Verify the 40-band output shows energy concentrated in the band containing 1kHz
- [ ] Verify RMS is approximately `1/√2 ≈ 0.707` for a full-scale sine
- [ ] Verify a clipping test file triggers the clipping fault rule
- [ ] Verify progress events fire from 0% to 100%
- [ ] Measure compute time for a 3-minute WAV (target: < 5 seconds on a mid-range laptop)

---

## Acceptance Criteria

- [ ] `decodeAudioFile(file)` returns `DecodedAudio` for WAV, MP3, and OGG files
- [ ] Mono files are correctly expanded to stereo (left duplicated to right)
- [ ] Web Worker runs to completion and posts `{ type: 'result' }` with all fields populated
- [ ] Progress events fire at least 5 times during compute
- [ ] All typed arrays are transferred (not copied) back to the main thread
- [ ] No main-thread jank during precompute (UI stays responsive)
- [ ] Files > 200MB show a warning; files > 500MB are rejected with an error message
