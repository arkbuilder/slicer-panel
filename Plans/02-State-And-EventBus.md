# Plan 02 — State Management & Event Bus

> **Owner:** Engineer B
> **Dependencies:** Plan 00 (conventions)
> **Estimated effort:** 2–3 hours
> **Files to create:** `js/bus.js`, `js/state.js`

---

## Objective

Build the communication backbone for the app: a lightweight pub/sub event bus and a centralized state store. Every chart module, the playback engine, and the interaction layer talk through these two modules — never directly to each other.

---

## Part A: Event Bus (`js/bus.js`)

### Interface

```js
/**
 * Creates a new event bus instance.
 * @returns {EventBus}
 */
export function createBus() { ... }

/**
 * @typedef {Object} EventBus
 * @property {function(event: string, handler: Function): Function} on
 *   Subscribe to an event. Returns an unsubscribe function.
 * @property {function(event: string, data?: any): void} emit
 *   Emit an event with optional payload.
 * @property {function(event: string, handler: Function): void} off
 *   Remove a specific handler.
 * @property {function(): void} clear
 *   Remove all handlers (for cleanup/testing).
 */
```

### Implementation

```js
export function createBus() {
  const listeners = new Map(); // event → Set<handler>

  return {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => listeners.get(event)?.delete(handler); // unsubscribe
    },

    emit(event, data) {
      if (!listeners.has(event)) return;
      for (const handler of listeners.get(event)) {
        try { handler(data); }
        catch (e) { console.error(`[Bus] Error in handler for "${event}":`, e); }
      }
    },

    off(event, handler) {
      listeners.get(event)?.delete(handler);
    },

    clear() {
      listeners.clear();
    }
  };
}
```

### Design Notes

- Synchronous dispatch (no microtask queueing). Keeps things predictable.
- Handlers that throw are caught and logged — one bad handler doesn't break others.
- The unsubscribe pattern (`on` returns a function) makes cleanup easy for chart modules.

---

## Part B: Event Catalog

All bus events, their payloads, and who emits/listens. **Every engineer should reference this table.**

| Event | Payload | Emitter(s) | Listener(s) |
|---|---|---|---|
| `file-loaded` | `{ fileName: string, duration: number, sampleRate: number }` | audio-decode | app shell (show file info), transport (enable controls) |
| `precompute-progress` | `{ percent: number, stage: string }` | precompute | app shell (progress bar) |
| `precompute-error` | `{ message: string }` | precompute | app shell (error display) |
| `data-ready` | `void` | precompute | all charts (trigger initial draw) |
| `playback-started` | `void` | audio-playback | transport (update button state) |
| `playback-paused` | `void` | audio-playback | transport (update button state) |
| `playback-ended` | `void` | audio-playback | transport (reset state) |
| `playhead-update` | `{ frame: number, time: number }` | audio-playback (rAF loop) | all charts (update current position) |
| `playhead-seek` | `{ time: number }` | any chart, transport, fault log | audio-playback (seek to time) |
| `brush-change` | `{ startFrame: number, endFrame: number }` | overview waveform | spectrogram, heatmap, onset map (zoom to range) |
| `loop-change` | `{ startTime: number, endTime: number } \| null` | overview waveform | audio-playback (loop region) |
| `hover-band` | `{ bandIndex: number } \| null` | heatmap, spectrum, ring | heatmap, spectrum, ring (highlight linked band) |
| `hover-frame` | `{ frame: number } \| null` | spectrogram, heatmap | all time-axis charts (crosshair) |
| `power-change` | `{ weights: Record<string, number> }` | reroute controls | all charts (adjust visual emphasis) |
| `fault-click` | `{ time: number }` | fault log | playhead-seek handler |
| `bookmark-add` | `{ time: number, label?: string }` | user action | overview (draw flag), bookmark list |
| `bookmark-jump` | `{ time: number }` | bookmark list | playhead-seek handler |
| `mute-toggle` | `{ muted: boolean }` | transport | audio-playback |
| `theme-loaded` | `void` | theme.js | app shell (remove loading overlay) |

---

## Part C: State Store (`js/state.js`)

### Interface

```js
/**
 * Creates the global state store.
 * @returns {AppState}
 */
export function createState() { ... }

/**
 * @typedef {Object} AppState
 * @property {function(): PrecomputedData | null} getPrecomputed
 * @property {function(data: PrecomputedData): void} setPrecomputed
 * @property {function(): DecodedAudio | null} getDecoded
 * @property {function(decoded: DecodedAudio): void} setDecoded
 * @property {function(): number} getCurrentFrame
 * @property {function(frame: number): void} setCurrentFrame
 * @property {function(): BrushRange | null} getBrush
 * @property {function(range: BrushRange | null): void} setBrush
 * @property {function(): LoopRange | null} getLoop
 * @property {function(range: LoopRange | null): void} setLoop
 * @property {function(): Record<string, number>} getPowerWeights
 * @property {function(weights: Record<string, number>): void} setPowerWeights
 * @property {function(): Bookmark[]} getBookmarks
 * @property {function(bookmark: Bookmark): void} addBookmark
 * @property {function(index: number): void} removeBookmark
 * @property {function(): boolean} isPlaying
 * @property {function(playing: boolean): void} setPlaying
 * @property {function(): boolean} isMuted
 * @property {function(muted: boolean): void} setMuted
 */

/**
 * @typedef {{ startFrame: number, endFrame: number }} BrushRange
 * @typedef {{ startTime: number, endTime: number }} LoopRange
 * @typedef {{ time: number, label: string }} Bookmark
 */
```

### Implementation

Simple getter/setter module with private variables. No reactivity — charts subscribe to bus events, not state changes.

```js
export function createState() {
  let precomputed = null;
  let decoded = null;
  let currentFrame = 0;
  let brush = null;
  let loop = null;
  let playing = false;
  let muted = false;
  let bookmarks = [];
  let powerWeights = {
    sensors: 1.0,   // spectrogram + heatmap
    comms: 1.0,     // stereo / phase
    targeting: 1.0, // ring + spectrum
    diagnostics: 1.0 // fault log
  };

  return {
    getPrecomputed: () => precomputed,
    setPrecomputed: (data) => { precomputed = data; },
    getDecoded: () => decoded,
    setDecoded: (d) => { decoded = d; },
    getCurrentFrame: () => currentFrame,
    setCurrentFrame: (f) => { currentFrame = f; },
    getBrush: () => brush,
    setBrush: (r) => { brush = r; },
    getLoop: () => loop,
    setLoop: (r) => { loop = r; },
    getPowerWeights: () => ({ ...powerWeights }),
    setPowerWeights: (w) => { powerWeights = { ...powerWeights, ...w }; },
    getBookmarks: () => [...bookmarks],
    addBookmark: (b) => { bookmarks.push(b); },
    removeBookmark: (i) => { bookmarks.splice(i, 1); },
    isPlaying: () => playing,
    setPlaying: (p) => { playing = p; },
    isMuted: () => muted,
    setMuted: (m) => { muted = m; }
  };
}
```

### Design Notes

- State is **not reactive**. The bus is the notification mechanism. When you call `state.setCurrentFrame(f)`, no listener is auto-notified. The caller (audio-playback) is responsible for also emitting `bus.emit('playhead-update', ...)`.
- This keeps the state module dead simple and avoids double-dispatch issues.
- All getters return copies for objects/arrays to prevent mutation bugs.

---

## Part D: Wiring in `main.js`

```js
// js/main.js
import { createBus } from './bus.js';
import { createState } from './state.js';

const bus = createBus();
const state = createState();

// Pass bus + state to every module's init()
// (each plan's module receives these as arguments)
```

---

## Helper: Frame ↔ Time Conversion

Include these utilities in `state.js` (or a small `js/utils.js`):

```js
/**
 * Convert a frame index to time in seconds.
 */
export function frameToTime(frame, hopSize, sampleRate) {
  return (frame * hopSize) / sampleRate;
}

/**
 * Convert time in seconds to the nearest frame index.
 */
export function timeToFrame(time, hopSize, sampleRate) {
  return Math.round((time * sampleRate) / hopSize);
}

/**
 * Convert time in seconds to a sample index.
 */
export function timeToSample(time, sampleRate) {
  return Math.round(time * sampleRate);
}

/**
 * Format seconds as "M:SS.s" (e.g., "2:05.3")
 */
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m}:${s.padStart(4, '0')}`;
}
```

---

## Testing / Verification

- [ ] `createBus()` — emit an event with a listener attached → listener fires with correct payload
- [ ] `createBus()` — unsubscribe → listener does NOT fire on subsequent emit
- [ ] `createBus()` — handler that throws does not prevent other handlers from running
- [ ] `createState()` — set and get precomputed data round-trips correctly
- [ ] `createState()` — `getBookmarks()` returns a copy (mutating it doesn't affect state)
- [ ] Frame/time utilities: `timeToFrame(1.0, 512, 44100)` → `86`, `frameToTime(86, 512, 44100)` → `≈1.0`

---

## Acceptance Criteria

- [ ] `bus.js` exports `createBus()` with `on`, `emit`, `off`, `clear` methods
- [ ] `state.js` exports `createState()` with all getters/setters listed above
- [ ] Both modules work as ES modules (`import`/`export`)
- [ ] Zero external dependencies
- [ ] All event names from the catalog are documented in a `BUS_EVENTS` constant object for discoverability
