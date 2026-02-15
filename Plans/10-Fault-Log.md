# Plan 10 - Fault Log

> **Owner:** Engineer D
> **Dependencies:** Plan 01 (fault detection output), Plan 02 (state + bus), Plan 03 (fault drawer shell)
> **Estimated effort:** 2-3 hours
> **Files to create:** `js/charts/fault-log.js`

---

## Objective

Render a diagnostic fault list in `#fault-list` using semantic DOM entries rather than Canvas. The log presents severity, time ranges, type, and message for each detected event, with click-to-seek and live playhead-follow highlighting. It should feel like a compact terminal diagnostics panel.

---

## Interface

```js
/**
 * Initialize fault log module.
 * @param {string} containerId - DOM id for fault list container.
 * @param {EventBus} bus - Shared event bus.
 * @param {AppState} state - Shared state.
 * @returns {Function} cleanup
 */
export function initFaultLog(containerId, bus, state) { ... }
```

---

## Implementation Details

### 1. Data Model

Source array: `state.getPrecomputed().faults`

```js
{
  type,
  severity, // CRIT | WARN | INFO
  frameStart,
  frameEnd,
  message
}
```

Sort ascending by `frameStart` before render.

### 2. DOM Entry Structure

Each entry:

```html
<div class="fault-entry fault-entry--crit" data-index="...">
  <span class="fault-severity">CRIT</span>
  <span class="fault-range">0:12.3 - 0:14.0</span>
  <span class="fault-type">CLIPPING</span>
  <span class="fault-message">Clipping detected ...</span>
</div>
```

Severity color mapping:

- `CRIT -> --sl-red`
- `WARN -> --sl-amber`
- `INFO -> --sl-cyan`

Update `#fault-count` with total fault count.

### 3. Time Formatting

Convert frames to seconds via state helpers (`frameToTime`) and format as `M:SS.s`.

### 4. Click Interaction

On entry click:

1. seek to fault start:

```js
bus.emit('playhead-seek', { time: startTime });
```

2. set brush region to fault range:

```js
bus.emit('brush-change', { startFrame, endFrame });
```

3. emit telemetry event:

```js
bus.emit('fault-click', { time: startTime });
```

### 5. Playhead Tracking

On `playhead-update`:

- convert current frame/time
- find fault entry nearest to or containing current frame
- apply `.active` class to matching entry
- remove from previous active entry
- ensure active row stays visible using `scrollIntoView({ block: 'nearest' })`

### 6. Empty and Error States

If no faults:

- render one muted row: `NO FAULTS DETECTED`
- set count to `0`

If precompute missing:

- keep container empty placeholder

### 7. Styling Contract (CSS)

Expected styles:

- monospace 9-10px text
- alternating row backgrounds
- severity badges with color
- `.active` row left border glow by severity class
- scrollable container with max-height from drawer CSS

### 8. Cleanup

- remove delegated click listener
- unsubscribe bus listeners

---

## Bus Events

| Event | Payload | Direction | Behavior |
|---|---|---|---|
| `data-ready` | `void` | listens | Build and render fault entries from precompute output |
| `playhead-update` | `{ frame, time }` | listens | Highlight nearest/active fault row |
| `playhead-seek` | `{ time }` | emits | Jump to clicked fault start |
| `brush-change` | `{ startFrame, endFrame }` | emits | Zoom to clicked fault region |
| `fault-click` | `{ time }` | emits | Signal user navigation from fault log |

---

## Testing / Verification

- [ ] Data-ready populates entries sorted by time.
- [ ] Severity badges use CRIT/WARN/INFO color mapping.
- [ ] `#fault-count` reflects exact rendered count.
- [ ] Clicking an entry seeks playback and sets brush range.
- [ ] Active entry tracks playhead movement.
- [ ] Active row auto-scroll keeps row visible in long logs.
- [ ] Empty fault set renders clear no-events message.

---

## Acceptance Criteria

- [ ] Uses DOM rendering (not Canvas) under `#fault-list`.
- [ ] Renders severity, time range, type label, and message.
- [ ] Updates `#fault-count` every rebuild.
- [ ] Emits `playhead-seek`, `brush-change`, and `fault-click` on row click.
- [ ] Tracks playhead and highlights nearest/current fault row.
- [ ] Supports large fault lists with scrollable performance.
- [ ] Handles missing/empty fault arrays safely.
