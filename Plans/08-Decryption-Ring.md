# Plan 08 - Decryption Ring

> **Owner:** Engineer D
> **Dependencies:** Plan 01 (band + RMS data), Plan 02 (state + bus), Plan 03 (ring panel shell), Plan 13 (mobile behavior)
> **Estimated effort:** 3-5 hours
> **Files to create:** `js/charts/decryption-ring.js`

---

## Objective

Render a radial 40-band "decryption ring" on `#ring-canvas` that reacts to the current playhead frame. Each arc represents one frequency band, with radial extent and alpha tied to energy. Add slow rotational drift, ghost trails for recent frames, and a pulsing RMS center core for the sci-fi console effect.

---

## Interface

```js
/**
 * Initialize radial decryption ring chart.
 * @param {string} canvasId - Ring canvas id.
 * @param {EventBus} bus - Shared bus.
 * @param {AppState} state - Shared app state.
 * @returns {Function} cleanup
 */
export function initDecryptionRing(canvasId, bus, state) { ... }
```

---

## Implementation Details

### 1. Geometry

For each render:

- `size = min(width, height)`
- center: `(cx, cy)`
- `outerRadius = 0.9 * size / 2`
- `innerRadius = 0.4 * outerRadius`
- band count fixed at `40`
- `arcStep = (Math.PI * 2) / 40` (9 degrees)

### 2. Frame Data Extraction

Given `currentFrame`, sample band energy row:

```js
rowOffset = currentFrame * 40
energy = bandsLeft[rowOffset + bandIndex] // 0..255
```

RMS source for center pulse:

```js
rms = precomputed.rmsLeft[currentFrame] || 0
```

### 3. Arc Rendering

For each band index:

1. Compute angle segment with global rotation offset:
   - `angleOffset = currentFrame * 0.01`
   - `start = band * arcStep + angleOffset`
   - `end = start + arcStep * 0.9`
2. Map energy to outer radial extent:
   - `t = energy / 255`
   - `radius = innerRadius + t * (outerRadius - innerRadius)`
3. Fill wedge between innerRadius and `radius`.
4. Color in cyan with alpha from energy:
   - `alpha = 0.1 + 0.9 * t`

### 4. Ghost Trails

Render up to 5 prior frames under current frame:

- frame `-1` alpha multiplier `0.4`
- frame `-2` alpha multiplier `0.3`
- frame `-3` alpha multiplier `0.2`
- frame `-4` alpha multiplier `0.1`
- frame `-5` alpha multiplier `0.08` (or omit)

Mobile optimization (Plan 13):

- detect narrow viewport or coarse pointer and skip ghost draws.

### 5. Center Pulse Element

Draw center core:

- base radius small (`6-10 px css`)
- pulse radius scale from RMS:

```js
pulse = base + rms * gain
```

- amber fill + soft shadow blur for glow.

### 6. Ring Status Text

Update `#ring-status` by lifecycle:

- no data: `STANDBY`
- playback active: `DECRYPTING...`
- paused with data: `SIGNAL LOCKED`

Driven by `data-ready`, `playhead-update`, `playback-started`, `playback-paused`.

### 7. Hover Interaction

Map pointer angle to band index:

1. transform pointer to polar angle around center
2. subtract current rotation offset
3. normalize to `[0, 2pi)`
4. index = `floor(angle / arcStep)`

Emit:

```js
bus.emit('hover-band', { bandIndex });
```

On leave emit null.

When receiving external `hover-band`, highlight selected arc with brighter stroke.

### 8. Power Routing

Respond to `power-change` using `weights.targeting`:

- scale radial extent and/or global alpha
- clamp to prevent clipping

### 9. Redraw Model

Unlike image-based charts, ring redraws full scene each `playhead-update`:

- 40 current arcs + ghost arcs + center pulse
- acceptable at 60fps on Canvas2D

### 10. Cleanup

- remove pointer handlers
- unsubscribe bus listeners
- clear status text references

---

## Bus Events

| Event | Payload | Direction | Behavior |
|---|---|---|---|
| `data-ready` | `void` | listens | Reset status and first render |
| `playhead-update` | `{ frame, time }` | listens | Redraw ring at current frame |
| `hover-band` | `{ bandIndex } \| null` | listens + emits | Shared band highlight |
| `resize` | `void` | listens | Recompute square canvas geometry |
| `power-change` | `{ weights }` | listens | Targeting-weight scale changes |
| `playback-started` | `void` | listens | Set status to `DECRYPTING...` |
| `playback-paused` | `void` | listens | Set status to `SIGNAL LOCKED` |

---

## Testing / Verification

- [ ] Ring draws 40 arcs and rotates gradually during playback.
- [ ] Arc radial extent tracks per-band energy changes.
- [ ] Ghost trails for previous frames are visible on desktop.
- [ ] Center pulse grows/shrinks with RMS energy.
- [ ] `#ring-status` transitions between standby, decrypting, locked.
- [ ] Hovering arcs emits `hover-band`; leave emits null.
- [ ] External `hover-band` highlights matching arc.
- [ ] Mobile mode disables ghost trails and stays responsive.

---

## Acceptance Criteria

- [ ] Uses current-frame `bandsLeft` data and `rmsLeft` metadata.
- [ ] Draws ring with required inner/outer radius proportions.
- [ ] Applies rotation offset `currentFrame * 0.01`.
- [ ] Implements previous-frame ghost trails (desktop) and skips on mobile.
- [ ] Emits and consumes `hover-band` correctly.
- [ ] Updates `#ring-status` with required copy states.
- [ ] Renders smoothly at playback update cadence.
