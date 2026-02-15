# Plan 06 - Spectrogram

> **Owner:** Engineer C
> **Dependencies:** Plan 01 (40-band data), Plan 02 (state + bus), Plan 03 (spectrogram panel shell), Plan 05 (brush semantics)
> **Estimated effort:** 3-5 hours
> **Files to create:** `js/charts/spectrogram.js`

---

## Objective

Render a frequency-time spectrogram on `#spectrogram-canvas` using `bandsLeft` data (`Uint8Array[numFrames * 40]`). Pre-render the full image once, then display either the full range or brushed frame window for fast interactions. Support click-to-seek, hover cross-linking, and playhead overlay.

---

## Interface

```js
/**
 * Initialize spectrogram chart.
 * @param {string} canvasId - Target spectrogram canvas id.
 * @param {EventBus} bus - Shared bus instance.
 * @param {AppState} state - App state store.
 * @returns {Function} cleanup
 */
export function initSpectrogram(canvasId, bus, state) { ... }
```

---

## Implementation Details

### 1. Module State

Track:

- `canvas`, `ctx`
- `offscreenFull` canvas storing full spectrogram render
- `fullWidth = numFrames`, `fullHeight = 40` pixel-space source image
- `viewStartFrame`, `viewEndFrame` (derived from brush)
- `hoverBandIndex`, `hoverFrame`
- `currentFrame`
- cached color lookup table `colorLut[256] -> [r,g,b]`

### 2. Color Ramp

Implement piecewise interpolation across stops:

- `0 -> #060a10`
- `64 -> #0044aa`
- `128 -> #00bbcc`
- `192 -> #ffaa00`
- `255 -> #ffffff`

Build once:

```js
const lut = new Uint8ClampedArray(256 * 3);
```

### 3. Full Image Pre-render on `data-ready`

Input: `bandsLeft` where each row is frame-major with 40 bands.

Create `ImageData(numFrames, 40)` and map each source cell:

- source index: `src = frame * 40 + band`
- y mapping: low band at bottom, so `dstY = 39 - band`
- color from LUT
- alpha = 255

Then `putImageData` into offscreen full canvas.

### 4. View Range / Brush Sync

Default view:

- `viewStartFrame = 0`
- `viewEndFrame = numFrames - 1`

On `brush-change`:

- if null -> full range
- else clamp/sort start/end and set view range

Render visible slice by drawing from `offscreenFull` source rect to display canvas:

```js
ctx.drawImage(offscreenFull,
  srcX, 0, srcW, 40,
  0, 0, canvasWidth, canvasHeight
);
```

### 5. Overlay Pass

After base image draw:

1. Draw optional hover-frame crosshair (dim cyan line).
2. Draw optional hover-band horizontal guide.
3. Draw playhead vertical line in amber if current frame is in visible range.
4. Optional border frame.

### 6. Click / Hover Interaction

#### Click seek

Convert x coordinate to visible frame and emit:

```js
bus.emit('playhead-seek', { time });
```

#### Hover linking

On pointer move:

- map x -> frame in current view
- map y -> band index with bottom=0 orientation
- emit both:

```js
bus.emit('hover-frame', { frame });
bus.emit('hover-band', { bandIndex });
```

On leave:

```js
bus.emit('hover-frame', null);
bus.emit('hover-band', null);
```

### 7. Power Routing

On `power-change`, apply sensors weight to render intensity:

- multiply output alpha or overlay brightness by `weights.sensors`
- clamp to sensible range (for example `0.3..1.5`)

### 8. Resize Handling

On `resize` event:

- update DPR-scaled canvas dimensions
- redraw current view using already cached offscreen image

### 9. Performance Rules

- Never loop all frames during `playhead-update`.
- Full `ImageData` build only on `data-ready` (or when source changes).
- Brush updates should only change source clipping window.

---

## Bus Events

| Event | Payload | Direction | Behavior |
|---|---|---|---|
| `data-ready` | `void` | listens | Build full spectrogram offscreen image |
| `playhead-update` | `{ frame, time }` | listens | Update playhead overlay |
| `brush-change` | `{ startFrame, endFrame } \| null` | listens | Set visible frame window |
| `hover-band` | `{ bandIndex } \| null` | listens + emits | Highlight shared band + emit local hover |
| `hover-frame` | `{ frame } \| null` | listens + emits | Highlight shared frame + emit local hover |
| `resize` | `void` | listens | Recalculate canvas metrics and redraw |
| `power-change` | `{ weights }` | listens | Scale brightness/alpha |
| `playhead-seek` | `{ time }` | emits | Seek on click/tap |

---

## Testing / Verification

- [ ] `data-ready` renders non-empty spectrogram image.
- [ ] Low frequencies appear at bottom, highs at top.
- [ ] Brushing overview zooms spectrogram to brushed range.
- [ ] Click seeks playback to matching time.
- [ ] Hover emits `hover-frame` and `hover-band` and clears on leave.
- [ ] Playhead line tracks playback in amber.
- [ ] Resize redraw is crisp and does not rebuild full data unnecessarily.
- [ ] Power slider Sensors visibly affects chart strength.

---

## Acceptance Criteria

- [ ] Uses `state.getPrecomputed().bandsLeft` as primary source.
- [ ] Uses LUT + `ImageData` / `putImageData` approach (no per-cell `fillRect` loop for full draw).
- [ ] Supports full-range and brushed-range rendering.
- [ ] Implements click-to-seek and hover cross-link events.
- [ ] Handles `hover-band`/`hover-frame` from other modules.
- [ ] Maintains smooth playback overlay updates.
- [ ] No runtime errors when precomputed data is missing.
