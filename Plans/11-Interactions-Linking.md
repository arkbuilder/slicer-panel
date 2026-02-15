# Plan 11 - Interactions and Linking

> **Owner:** Engineer E
> **Dependencies:** Plan 02 (event bus/state), Plan 03 (power-controls container), Plan 05-10 (chart hover emitters), Plan 13 (touch-safe tooltip behavior)
> **Estimated effort:** 4-6 hours
> **Files to create:** `js/interactions.js`

---

## Objective

Implement cross-chart coordination logic that is not owned by any one visualization module. This includes shared hover propagation behavior, a single global tooltip, zero-sum power routing controls, and keyboard bookmark workflows. The module operates as orchestration glue between charts, transport, and state.

---

## Interface

```js
/**
 * Initialize interaction orchestration layer.
 * @param {EventBus} bus - Shared event bus.
 * @param {AppState} state - Shared state store.
 * @returns {Function} cleanup
 */
export function initInteractions(bus, state) { ... }
```

---

## Implementation Details

### Part A: Cross-Chart Hover Linking

#### 1. Debounced hover relay

To avoid flooding, rate-limit outbound hover fan-out to ~30 Hz:

- store latest `hover-band` and `hover-frame` payloads
- flush with timer every `33ms`
- if payload unchanged, skip emit

Charts still listen to canonical events (`hover-band`, `hover-frame`), but this module can own optional throttled "relay" events if needed.

#### 2. Shared active hover state

Track in state-like local object:

- `activeBandIndex`
- `activeFrame`

Update these on bus events and expose via CSS classes/tooltip content.

### Part B: Shared Tooltip

#### 1. DOM creation

Inject once:

```html
<div id="shared-tooltip" class="shared-tooltip hidden"></div>
```

Append to `document.body`.

#### 2. Show/hide channel

Support bus API:

- `tooltip-show` payload `{ x, y, text?, html?, source? }`
- `tooltip-hide` payload optional

Behavior:

- position near pointer with viewport clamping
- hide on `mouseleave` timeout if no chart still hovered
- ignore stale show requests older than latest move sequence

Tooltip content fields can include:

- band frequency range
- energy/dB value
- time position
- fault summary when relevant

### Part C: Reroute Power Controls

#### 1. Build sliders in `#power-controls`

Create four rows:

- Sensors
- Comms
- Targeting
- Diagnostics

Control settings:

- min `0.0`
- max `2.0`
- step `0.01`
- default `1.0`

#### 2. Zero-sum algorithm (total fixed at 4.0)

When one slider changes:

1. Clamp changed value to `[0,2]`.
2. Compute remaining budget `4 - changed`.
3. Redistribute across other three proportionally to their previous values.
4. If proportional sum is zero, split evenly.
5. Clamp each to `[0,2]`, then normalize tiny drift so total is exactly 4.0.

Emit on each committed update:

```js
bus.emit('power-change', {
  weights: { sensors, comms, targeting, diagnostics }
});
```

Persist in state via `state.setPowerWeights(weights)`.

#### 3. Styling hooks

Assign classes (`power-row`, `power-slider`, `power-value`) for sci-fi slider skin from CSS.

### Part D: Bookmarks

#### 1. Add bookmark with keyboard

On `keydown` for `KeyB` outside text inputs:

- read current time from state (`currentFrame` -> time)
- create label like `BK-1`, `BK-2`, ...
- store `state.addBookmark({ time, label })`
- emit:

```js
bus.emit('bookmark-add', { time, label });
```

#### 2. Jump bookmarks with 1-9

On key `Digit1`..`Digit9`:

- find bookmark at index `n-1`
- emit:

```js
bus.emit('bookmark-jump', { time: bookmark.time });
bus.emit('playhead-seek', { time: bookmark.time });
```

#### 3. Optional bookmark list UI

Render small list in power panel footer or tooltip:

- index + label + formatted time
- click to jump

### Part E: Cleanup

Return cleanup function removing:

- keydown listener
- slider listeners
- tooltip node
- all bus subscriptions

---

## Bus Events

| Event | Payload | Direction | Behavior |
|---|---|---|---|
| `hover-band` | `{ bandIndex } \| null` | listens + emits | Cross-chart band focus linking |
| `hover-frame` | `{ frame } \| null` | listens + emits | Cross-chart frame focus linking |
| `tooltip-show` | `{ x, y, text/html, ... }` | listens | Show and place shared tooltip |
| `tooltip-hide` | `void` | listens | Hide shared tooltip |
| `power-change` | `{ weights }` | emits | Publish zero-sum slider weights |
| `bookmark-add` | `{ time, label }` | emits | Add new bookmark marker |
| `bookmark-jump` | `{ time }` | emits | Announce bookmark jump event |
| `playhead-seek` | `{ time }` | emits | Trigger playback jump for bookmark |

---

## Testing / Verification

- [ ] Hovering one chart causes matching band/frame highlights in other charts.
- [ ] Hover event rate is capped and does not flood redraw path.
- [ ] Tooltip appears near cursor with clamped viewport positioning.
- [ ] Tooltip hides reliably after leaving chart surfaces.
- [ ] Power sliders always sum to exactly 4.0.
- [ ] Increasing one slider reduces others proportionally.
- [ ] `power-change` emits expected payload shape.
- [ ] Pressing `B` adds bookmarks and overview markers.
- [ ] Pressing `1-9` seeks to corresponding bookmarks.

---

## Acceptance Criteria

- [ ] Implements shared hover coordination and debounce behavior.
- [ ] Provides single shared tooltip infrastructure.
- [ ] Builds four reroute-power sliders with zero-sum constraint.
- [ ] Emits canonical `power-change` payload on updates.
- [ ] Adds keyboard bookmark create and jump workflows.
- [ ] Keeps module decoupled from chart drawing internals.
- [ ] Cleans up all listeners/subscriptions on teardown.
