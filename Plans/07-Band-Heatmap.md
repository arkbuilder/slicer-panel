# Plan 07 - Band Heatmap

> **Owner:** Engineer C
> **Dependencies:** Plan 01 (band data + band frequencies), Plan 02 (state + bus), Plan 03 (heatmap panel), Plan 05 (brush range behavior)
> **Estimated effort:** 3-4 hours
> **Files to create:** `js/charts/band-heatmap.js`

---

## Objective

Render a 40-row amber-intensity heatmap on `#heatmap-canvas` that emphasizes energy structure without multi-hue coloring. The chart must stay synchronized with overview brush range, playback playhead, and shared hover states. It also includes sparse frequency labels on the left edge using precomputed band metadata.

---

## Interface

```js
/**
 * Initialize the amber band heatmap chart.
 * @param {string} canvasId - Canvas id for heatmap surface.
 * @param {EventBus} bus - Shared event bus.
 * @param {AppState} state - Shared app state.
 * @returns {Function} cleanup
 */
export function initBandHeatmap(canvasId, bus, state) { ... }
```

---

## Implementation Details

### 1. Data and View Model

- Source: `precomputed.bandsLeft` (`numFrames * 40`)
- Metadata: `precomputed.bandFrequencies`
- Visible time window from brush:
  - Full window if brush is null
  - Sub-window if brush exists

Maintain:

- `offscreenFull` canvas with full heatmap image
- `viewStartFrame`, `viewEndFrame`
- `hoverBandIndex`, `hoverFrame`, `currentFrame`
- left gutter width for labels (for example 44 px CSS)

### 2. Amber Ramp LUT

Single hue ramp points:

- `0 -> #0a0e14`
- `128 -> #553300`
- `255 -> #ffaa00`

Interpolate to `Uint8ClampedArray(256 * 3)`.

### 3. Full Heatmap Render

On `data-ready`:

1. Build `ImageData(numFrames, 40)`.
2. For each frame-band value:
   - y invert so band 0 is bottom.
   - color = LUT[value]
3. `putImageData` to offscreen full canvas.

### 4. Display Render

Visible canvas draw order:

1. Clear panel and fill background.
2. Draw clipped time slice from offscreen full image into plot region (excluding label gutter).
3. Draw vertical playhead line (amber).
4. Draw hover frame/band guides (cyan dim).
5. Draw label gutter background and frequency labels.

Label strategy:

- Choose representative bands near meaningful centers (for example nearest to 100 Hz, 1 kHz, 10 kHz).
- Derive center frequency per band:

```js
centerHz = Math.sqrt(low * high)
```

- Format as `100 Hz`, `1.0 kHz`, `10 kHz`.

### 5. Interaction Behavior

#### Click seek

Map pointer x to frame in visible window and emit:

```js
bus.emit('playhead-seek', { time });
```

#### Hover

On pointer move over plot area:

- emit `hover-frame` and `hover-band`

On pointer leave:

- emit null for both

### 6. External Highlight Sync

On bus events `hover-band` and `hover-frame`, update local highlight overlay without rebuilding base image.

### 7. Power Routing

Respond to `power-change` using `weights.sensors`:

- scale plot alpha/contrast for heatmap layer
- keep label gutter readable

### 8. Resize

On `resize`:

- update DPR canvas dimensions
- recompute plot/gutter geometry
- redraw from offscreen cached full image

### 9. Performance

- Full `ImageData` generation only on `data-ready`.
- Brush/hover/playhead updates should draw clipped slices + overlays only.

---

## Bus Events

| Event | Payload | Direction | Behavior |
|---|---|---|---|
| `data-ready` | `void` | listens | Build full amber heatmap cache |
| `playhead-update` | `{ frame, time }` | listens | Move playhead overlay |
| `brush-change` | `{ startFrame, endFrame } \| null` | listens | Set visible frame range |
| `hover-band` | `{ bandIndex } \| null` | listens + emits | Shared band highlighting |
| `hover-frame` | `{ frame } \| null` | listens + emits | Shared frame highlighting |
| `resize` | `void` | listens | Recalculate geometry and redraw |
| `power-change` | `{ weights }` | listens | Sensors-weight brightness scaling |
| `playhead-seek` | `{ time }` | emits | Seek on click/tap |

---

## Testing / Verification

- [ ] Heatmap draws 40 rows with low band at bottom.
- [ ] Amber-only ramp is used (no blue/cyan multi-hue palette).
- [ ] Brush selection from overview zooms heatmap x-range.
- [ ] Click seeking lands near expected time.
- [ ] Hovering emits band/frame events and clears on leave.
- [ ] Frequency labels appear in left gutter with readable units.
- [ ] Playhead and hover overlays update smoothly.
- [ ] Sensors power routing visibly scales intensity.

---

## Acceptance Criteria

- [ ] Uses `bandsLeft` and `bandFrequencies` from precompute state.
- [ ] Implements amber LUT with required anchor colors.
- [ ] Syncs visible range with brush state.
- [ ] Emits and listens to hover events for cross-chart linking.
- [ ] Includes frequency labels using center-frequency formatting.
- [ ] Uses offscreen pre-render + clipped draws for runtime performance.
- [ ] Handles missing data gracefully.
