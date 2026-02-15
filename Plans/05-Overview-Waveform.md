# Plan 05 - Overview Waveform

> **Owner:** Engineer C
> **Dependencies:** Plan 01 (waveform LOD precompute), Plan 02 (state + bus), Plan 03 (overview canvas shell), Plan 13 (touch interactions)
> **Estimated effort:** 3-4 hours
> **Files to create:** `js/charts/overview-waveform.js`

---

## Objective

Render the full-track waveform on `#overview-canvas` using precomputed level-of-detail (LOD) min/max pairs so large files remain responsive. Support seek, brush selection, loop-range gestures, and bookmark markers while keeping playhead updates lightweight. The chart is the primary time navigation surface for the app.

---

## Interface

```js
/**
 * Initialize the overview waveform chart.
 * @param {string} canvasId - DOM id for the waveform canvas.
 * @param {EventBus} bus - Shared pub/sub event bus.
 * @param {AppState} state - Central state store.
 * @returns {Function} cleanup
 */
export function initOverviewWaveform(canvasId, bus, state) { ... }
```

---

## Implementation Details

### 1. Module State and Setup

Create local module state:

- `canvas`, `ctx`
- `dpr`, `cssWidth`, `cssHeight`, `pxWidth`, `pxHeight`
- `backgroundCanvas` + `backgroundCtx` (use `OffscreenCanvas` if available, fallback hidden in-memory `<canvas>`)
- `needsBackgroundRedraw` flag
- `currentFrame` and `lastPlayheadX`
- `hoverFrame` (for optional crosshair)
- drag state:
  - `dragStartX`
  - `dragMode: 'seek' | 'brush' | 'loop' | null`
  - `isDragging`

On init:

1. Resolve canvas by id.
2. Resolve 2D context with `{ alpha: true }`.
3. Read CSS variables once per draw pass:
   - `--sl-cyan`
   - `--sl-cyan-dim`
   - `--sl-amber`
4. Bind pointer/mouse handlers and bus subscriptions.
5. Trigger initial render (empty state placeholder if no data).

### 2. LOD Selection Strategy

Source: `state.getPrecomputed().waveformLODs` where each LOD is interleaved min/max:

- `left[i * 2] = min`
- `left[i * 2 + 1] = max`

Selection rule:

```js
function pickLodForWidth(scales, lodArrays, numSamples, targetPixels) {
  // target chunk count near pixel width for 1 column per chunk.
  // chunkCount ~= numSamples / scale
  // choose scale with smallest abs(chunkCount - targetPixels)
}
```

If no precomputed data or malformed arrays, render a fallback baseline and return.

### 3. Background Render (Cached)

Background redraw happens only on:

- `data-ready`
- `brush-change`
- `resize`
- `bookmark-add`
- `power-change` (if opacity scaling is applied)

Render order inside background cache:

1. Clear and fill panel backdrop.
2. Draw horizontal zero-line at `midY`.
3. Draw waveform min/max bars:
   - Map each chunk index to x coordinate across canvas width.
   - For each chunk, compute `yMin` and `yMax` in pixel space.
   - Draw vertical segment/bar in `--sl-cyan`.
   - Optional thin outline in `--sl-cyan-dim`.
4. Draw brush highlight:
   - If brush exists, dim out-of-range regions with translucent overlay.
   - Draw selection bounds with brighter border marks.
5. Draw loop region marks if loop exists:
   - vertical dashed lines at loop start/end.
6. Draw bookmarks:
   - For each bookmark from `state.getBookmarks()` draw small triangular flag near top edge.

### 4. Playhead Overlay Render

Fast path for `playhead-update`:

1. Copy cached background canvas onto visible canvas.
2. Draw playhead line at frame -> x mapping using `--sl-amber`.
3. Optional glow pass (1 extra translucent stroke).

No full waveform recomputation in this path.

### 5. Coordinate Mapping

Use precompute metadata:

- `numFrames`
- `duration`

Helpers:

```js
xToFrame(x) => clamp(round((x / width) * (numFrames - 1)))
frameToX(frame) => (frame / max(1, numFrames - 1)) * width
frameToTime(frame) => state.frameToTime(frame) or derived from hop/sampleRate
```

### 6. Interactions

#### Click (seek)

- Pointer down then up with minimal movement and no modifier.
- Emit:

```js
bus.emit('playhead-seek', { time });
```

#### Click + Drag (brush)

- On drag start without Shift: `dragMode='brush'`.
- While dragging, compute `startFrame`, `endFrame` sorted.
- Emit incremental updates:

```js
bus.emit('brush-change', { startFrame, endFrame });
```

#### Shift + Drag (loop)

- On drag with `event.shiftKey`: `dragMode='loop'`.
- Convert endpoints to times.
- Emit:

```js
bus.emit('loop-change', { startTime, endTime });
```

If region too small, emit `null`.

#### Double-click

- Clear brush:

```js
bus.emit('brush-change', null);
```

### 7. Touch Support

Use shared helper from `js/touch-utils.js` to normalize pointer/touch coordinates and tap detection.

- Tap -> seek
- Drag -> brush/loop based on modifier equivalent (mobile loop can be long-press toggle or omitted)

### 8. Power Routing Integration

On `power-change`, read `weights.sensors` and scale waveform/global overlay alpha (for example `0.35 + 0.65 * clamp(weight,0,2)/2`). Mark background dirty and redraw.

### 9. Cleanup

Return cleanup function that:

- Removes pointer/touch listeners
- Unsubscribes all bus handlers
- Nulls temporary canvases/references

---

## Bus Events

| Event | Payload | Direction | Behavior |
|---|---|---|---|
| `data-ready` | `void` | listens | Build cached background from LOD data |
| `playhead-update` | `{ frame, time }` | listens | Redraw playhead overlay only |
| `brush-change` | `{ startFrame, endFrame } \| null` | listens + emits | Repaint selection, and emit during drag |
| `loop-change` | `{ startTime, endTime } \| null` | listens + emits | Repaint loop guides, and emit during Shift-drag |
| `bookmark-add` | `{ time, label? }` | listens | Rebuild bookmark markers |
| `resize` | `void` | listens | Resize + rebuild background cache |
| `power-change` | `{ weights }` | listens | Adjust opacity/strength and repaint |
| `playhead-seek` | `{ time }` | emits | Seek on click/tap |

---

## Testing / Verification

- [ ] Load a file and verify waveform covers full duration.
- [ ] Resize window and confirm waveform remains crisp (DPR aware).
- [ ] Click several points and verify playback seeks correctly.
- [ ] Drag to create brush; verify dimmed outside region and synced zoom in time charts.
- [ ] Shift-drag loop region; verify playback loops between boundaries.
- [ ] Double-click clears brush and returns full-range view.
- [ ] Add bookmarks and verify flags render in correct positions.
- [ ] During playback, verify playhead moves smoothly without visible redraw stutter.

---

## Acceptance Criteria

- [ ] Uses precomputed LOD min/max arrays instead of raw per-sample drawing.
- [ ] Chooses LOD level based on canvas pixel width.
- [ ] Draws zero-line, waveform bars, brush region, playhead, and bookmarks.
- [ ] Supports click seek, drag brush, shift-drag loop, and double-click clear.
- [ ] Emits only `playhead-seek`, `brush-change`, and `loop-change` for interactions.
- [ ] Background is cached and not fully redrawn on every `playhead-update`.
- [ ] Handles empty/no-data state without throwing errors.
