# Plan 09 - Instant Spectrum

> **Owner:** Engineer D
> **Dependencies:** Plan 01 (band-frequency metadata), Plan 02 (state + bus), Plan 03 (spectrum panel shell), Plan 11 (shared tooltip channel)
> **Estimated effort:** 4-5 hours
> **Files to create:** `js/charts/instant-spectrum.js`

---

## Objective

Render a 40-bar instantaneous spectrum analyzer on `#spectrum-canvas` using per-frame band energies. Use segmented LED-style bars, peak-hold markers, and temporal smoothing for a retro instrument look. Support hover-based band linking and tooltip details.

---

## Interface

```js
/**
 * Initialize instant spectrum chart.
 * @param {string} canvasId - Spectrum canvas id.
 * @param {EventBus} bus - Shared event bus.
 * @param {AppState} state - Shared app state.
 * @returns {Function} cleanup
 */
export function initInstantSpectrum(canvasId, bus, state) { ... }
```

---

## Implementation Details

### 1. Chart State

Maintain per-band arrays (length 40):

- `displayed` current smoothed values
- `peaks` peak-hold values
- `peakHoldFrames` remaining hold counter

Track:

- `hoverBandIndex`
- `currentFrame`
- animation flags and rAF id

### 2. Signal Update Rules

At each frame update:

- `actual = bandsLeft[currentFrame * 40 + i]`
- smoothing:

```js
displayed[i] = displayed[i] * 0.85 + actual * 0.15;
```

- peak hold:
  - if `displayed[i] > peaks[i]`, set `peaks[i] = displayed[i]`, hold counter `= 30`
  - else decrement hold counter; once zero, decay `peaks[i] -= 1` per update (clamp >= displayed)

### 3. LED Segment Rendering

Canvas geometry:

- 40 bars evenly spaced
- small bar gap (for example 1-2 css px)

Each bar draw:

1. Convert normalized value to bar height.
2. Draw stacked horizontal segments:
   - segment height ~3px
   - segment gap ~1px
3. Color by vertical position:
   - bottom: cyan
   - middle: amber
   - top: red

Use direct fill rectangles per segment for stylized look.

### 4. Peak Marker

For each bar draw one bright segment at `peaks[i]` height.

- white or bright amber marker
- subtle glow via shadowBlur or additional stroke

### 5. Hover + Tooltip

On pointer move:

- detect hovered bar index from x coordinate
- emit:

```js
bus.emit('hover-band', { bandIndex });
```

- build tooltip payload including:
  - band frequency range from `bandFrequencies[bandIndex]`
  - current level (convert 0-255 to approximate dB for display)

Example payload:

```js
bus.emit('tooltip-show', {
  x, y,
  html: 'Band 12: 283 Hz - 353 Hz<br>-18.4 dB'
});
```

On leave:

- emit `hover-band(null)`
- emit `tooltip-hide`

When receiving external `hover-band`, highlight that bar with outline/glow.

### 6. Animation Loop

Use rAF loop while playback active:

- updates smoothing/peaks continuously
- redraws full chart each frame

Start loop on `playback-started`, stop on `playback-paused` / `playback-ended`.

Fallback: also redraw on discrete `playhead-update` if not continuously running.

### 7. Power Routing

Use `weights.targeting` to scale bar height and/or glow intensity.

### 8. Resize

On `resize`:

- update DPR dimensions
- recompute bar geometry
- redraw current state

### 9. Cleanup

- cancel rAF
- remove pointer listeners
- unsubscribe bus handlers

---

## Bus Events

| Event | Payload | Direction | Behavior |
|---|---|---|---|
| `data-ready` | `void` | listens | Initialize arrays and first draw |
| `playhead-update` | `{ frame, time }` | listens | Update current frame source data |
| `hover-band` | `{ bandIndex } \| null` | listens + emits | Shared band highlighting |
| `resize` | `void` | listens | Recompute geometry and redraw |
| `power-change` | `{ weights }` | listens | Targeting-weight visual scaling |
| `playback-started` | `void` | listens | Start continuous rAF animation |
| `playback-paused` | `void` | listens | Stop rAF animation |
| `playback-ended` | `void` | listens | Stop rAF animation |
| `tooltip-show` | tooltip payload | emits | Display shared tooltip |
| `tooltip-hide` | `void` | emits | Hide shared tooltip |

---

## Testing / Verification

- [ ] 40 bars render with segmented LED look.
- [ ] Smoothed bar motion is visible (no hard snapping).
- [ ] Peak markers hold and decay gradually.
- [ ] Color transitions from cyan to amber to red across height.
- [ ] Hover emits `hover-band` and tooltip data; leave clears both.
- [ ] External `hover-band` highlights matching bar.
- [ ] Targeting power slider scales bar behavior.
- [ ] Playback pause freezes animation without errors.

---

## Acceptance Criteria

- [ ] Uses current-frame 40-band source data from precompute state.
- [ ] Implements segmented (not solid) bar rendering.
- [ ] Applies smoothing formula `displayed = displayed * 0.85 + actual * 0.15`.
- [ ] Implements peak-hold with delayed decay.
- [ ] Emits and consumes `hover-band` for cross-linking.
- [ ] Exposes tooltip show/hide integration.
- [ ] Maintains stable frame-rate rendering in playback mode.
