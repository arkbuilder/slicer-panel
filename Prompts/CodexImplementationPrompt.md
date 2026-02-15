# Codex Implementation Prompt — Astromech Slicer Panel

> **Purpose:** Send this prompt to OpenAI Codex (or any agentic coding assistant) so it can autonomously complete every plan document and implement the entire Astromech Slicer Panel from scratch. Nothing should be skipped or forgotten.

---

## Context & Rules

You are implementing the **Astromech Slicer Panel** — a sci-fi audio data visualization web app that analyzes an uploaded WAV/audio file and presents 6 coordinated charts styled like a Star Wars astromech hacking console.

**Hard constraints:**
- **Vanilla HTML + CSS + JavaScript only.** No frameworks (no React, Vue, Angular). No build step (no Vite, Webpack, Rollup). No npm. No TypeScript. No preprocessors. Open `index.html` in a browser and it works.
- **ES Modules** (`<script type="module">`) for code organization.
- **No external CDN dependencies.** Everything is self-contained in this repo.
- The original upstream file `index.html` (or `index_v1.html`) is preserved as a reference. Do NOT modify it. Create the new app as fresh files alongside it.

**Key technical decisions (already locked in):**
- **FFT:** Pure JavaScript radix-2 Cooley-Tukey FFT in `lib/fft.js`. No WASM.
- **Audio playback:** Audible playback via `AudioBufferSourceNode` + `GainNode` with a mute toggle. Not silent analysis — the user hears the audio.
- **Precompute:** All heavy computation (FFT, bands, RMS, faults) runs in a Web Worker (`workers/precompute-worker.js`), off the main thread.
- **Rendering:** Canvas 2D for all charts. DOM elements for the fault log (semantic HTML).
- **State:** Custom lightweight pub/sub event bus + simple state store. No reactive framework.
- **STFT parameters:** FFT size 2048, hop size 512, Hann window, 40 logarithmic frequency bands (20 Hz–20 kHz).

---

## Workspace Structure

The workspace is at the root of this repository. The planned file structure is:

```
slicer-panel/
├── index.html                    # Main app shell (new file)
├── index_v1.html                 # Original upstream (DO NOT MODIFY)
├── css/
│   └── slicer.css                # All styles (sci-fi theme, layout, responsive)
├── js/
│   ├── main.js                   # Entry point: wires up modules, boot sequence
│   ├── bus.js                    # Event bus (pub/sub)
│   ├── state.js                  # Global state store
│   ├── audio-decode.js           # File upload + decodeAudioData
│   ├── audio-playback.js         # AudioBufferSourceNode playback engine
│   ├── precompute.js             # Web Worker orchestrator
│   ├── touch-utils.js            # Unified pointer/touch event helpers
│   ├── charts/
│   │   ├── overview-waveform.js  # Full-track waveform with brush-to-zoom
│   │   ├── spectrogram.js        # Frequency×time heatmap
│   │   ├── band-heatmap.js       # 40-band energy heatmap
│   │   ├── decryption-ring.js    # Radial 40-arc band view
│   │   ├── instant-spectrum.js   # 40-bar vertical spectrum
│   │   └── fault-log.js          # Fault event list (DOM-based)
│   ├── interactions.js           # Cross-chart linking, Reroute Power, bookmarks
│   └── theme.js                  # Decryption animation, scanline FX, corner marks
├── workers/
│   └── precompute-worker.js      # Web Worker: FFT, bands, RMS, faults
├── lib/
│   └── fft.js                    # Radix-2 FFT implementation
├── Plans/                        # Planning docs (read these, implement from them)
│   ├── 00-Architecture-Overview.md
│   ├── 01-Audio-Pipeline.md
│   ├── 02-State-And-EventBus.md
│   ├── 03-App-Shell-Layout.md
│   ├── 04-Playback-Transport.md
│   ├── 05-Overview-Waveform.md   # ⚠️ STUB — must be fleshed out first
│   ├── 06-Spectrogram.md         # ⚠️ STUB — must be fleshed out first
│   ├── 07-Band-Heatmap.md        # ⚠️ STUB — must be fleshed out first
│   ├── 08-Decryption-Ring.md     # ⚠️ STUB — must be fleshed out first
│   ├── 09-Instant-Spectrum.md    # ⚠️ STUB — must be fleshed out first
│   ├── 10-Fault-Log.md           # ⚠️ STUB — must be fleshed out first
│   ├── 11-Interactions-Linking.md # ⚠️ STUB — must be fleshed out first
│   ├── 12-SciFi-Theme.md         # Complete
│   └── 13-Mobile-Support.md      # Complete
└── README.md
```

---

## PHASE 1: Complete All Stub Plan Documents

**Before writing any implementation code**, you must first flesh out the 7 stub plan documents (Plans 05–11). Each is currently a placeholder with only a title and "reserved for implementation details" text.

Read the completed plans (00–04, 12, 13) to understand the format, level of detail, conventions, event bus catalog, and state interface. Then write each stub plan to the same level of detail.

### Plan 05 — Overview Waveform (`Plans/05-Overview-Waveform.md`)

Write a complete plan for `js/charts/overview-waveform.js`. Must include:

- **Objective:** Full-track waveform rendered on `#overview-canvas` using LOD (Level of Detail) data from the precompute worker. Shows the entire audio file at a glance.
- **Interface:** `export function initOverviewWaveform(canvasId, bus, state) { ... }`
- **Data source:** `state.getPrecomputed().waveformLODs` — pick the LOD scale that best matches the canvas pixel width. LODs are interleaved `[min, max, min, max, ...]` for each chunk.
- **Drawing algorithm:**
  - Fill the canvas width with vertical bars from each LOD chunk's `min` to `max`
  - Color: `--sl-cyan` for the waveform fill, subtle `--sl-cyan-dim` for the outline
  - Draw a horizontal zero-line
  - If a brush selection exists (`state.getBrush()`), dim the out-of-range area and highlight the selected range
  - Draw the playhead as a vertical `--sl-amber` line at the current frame position
  - Draw bookmark flags at their time positions
- **Interactions:**
  - **Click** = seek playhead to that time position (`bus.emit('playhead-seek', { time })`)
  - **Click + drag** = brush-select a time range (`bus.emit('brush-change', { startFrame, endFrame })`)
  - **Double-click** = clear brush selection (`bus.emit('brush-change', null)`)
  - **Shift + drag** = set loop region (`bus.emit('loop-change', { startTime, endTime })`)
  - The brush region should be visually highlighted (lighter background, border marks)
- **Bus events listened to:** `data-ready`, `playhead-update`, `brush-change`, `loop-change`, `bookmark-add`, `resize`, `power-change`
- **Bus events emitted:** `playhead-seek`, `brush-change`, `loop-change`
- **Performance:** Cache the waveform background as an offscreen canvas (`OffscreenCanvas` or a hidden canvas). Only re-render the background on `data-ready`, `brush-change`, or `resize`. On `playhead-update`, only redraw the playhead line overlay.
- **Testing/Verification** and **Acceptance Criteria** sections (checkboxes)

### Plan 06 — Spectrogram (`Plans/06-Spectrogram.md`)

Write a complete plan for `js/charts/spectrogram.js`. Must include:

- **Objective:** Frequency×time heatmap on `#spectrogram-canvas`. Shows spectral content over time as a scrolling/zoomed image.
- **Interface:** `export function initSpectrogram(canvasId, bus, state) { ... }`
- **Data source:** `state.getPrecomputed().bandsLeft` (or `bandsRight`) — `Uint8Array[numFrames × 40]`. Each value 0–255 represents energy in that band at that frame.
- **View range:** Defaults to the full track. When a brush is active (`brush-change`), zoom to show only the brushed frame range.
- **Drawing algorithm:**
  - X-axis = time (frames), Y-axis = frequency bands (0=low at bottom, 39=high at top)
  - Each cell (frame × band) gets a color from a sci-fi color ramp:
    - 0 → `#060a10` (black/dark blue)
    - 64 → `#0044aa` (deep blue)
    - 128 → `#00bbcc` (cyan)
    - 192 → `#ffaa00` (amber)
    - 255 → `#ffffff` (white)
  - Use `ImageData` and `putImageData` for performance (not individual `fillRect` calls)
  - Vertical playhead line in `--sl-amber`
- **Interactions:**
  - **Click** = seek to that time
  - **Hover** = emit `hover-frame` and `hover-band` for cross-chart highlighting
  - **Mouse leave** = emit `hover-frame(null)` and `hover-band(null)`
- **Bus events listened to:** `data-ready`, `playhead-update`, `brush-change`, `hover-band`, `hover-frame`, `resize`, `power-change`
- **Bus events emitted:** `playhead-seek`, `hover-frame`, `hover-band`
- **Performance:** Pre-render the full spectrogram as an `ImageData` (or offscreen canvas) on `data-ready`. On brush-change, draw just the visible slice. On playhead-update, overlay the playhead line.
- **Testing/Verification** and **Acceptance Criteria** sections

### Plan 07 — Band Heatmap (`Plans/07-Band-Heatmap.md`)

Write a complete plan for `js/charts/band-heatmap.js`. Must include:

- **Objective:** 40-row heatmap on `#heatmap-canvas`. Rows = bands (low freq at bottom), columns = frames. Intensity = amber brightness. This is similar to the spectrogram but uses a single-hue (amber) intensity ramp instead of a multi-hue color ramp, emphasizing energy structure.
- **Interface:** `export function initBandHeatmap(canvasId, bus, state) { ... }`
- **Data source:** `state.getPrecomputed().bandsLeft` — same as spectrogram but different color mapping
- **Color ramp:** Single hue amber — `0 → #0a0e14` (background), `128 → #553300`, `255 → #ffaa00` (full amber)
- **View range:** Synced with brush from overview
- **Interactions:** Click-to-seek, hover for cross-chart band/frame highlighting
- **Bus events listened to:** `data-ready`, `playhead-update`, `brush-change`, `hover-band`, `hover-frame`, `resize`, `power-change`
- **Bus events emitted:** `playhead-seek`, `hover-frame`, `hover-band`
- **Band labels:** On the left Y-axis, label a few bands with their center frequency (e.g., "100 Hz", "1 kHz", "10 kHz") using `state.getPrecomputed().bandFrequencies`
- **Performance:** Same strategy as spectrogram — pre-render full image, clip visible range
- **Testing/Verification** and **Acceptance Criteria** sections

### Plan 08 — Decryption Ring (`Plans/08-Decryption-Ring.md`)

Write a complete plan for `js/charts/decryption-ring.js`. Must include:

- **Objective:** Radial visualization on `#ring-canvas` (square, aspect 1:1). 40 arcs arranged in a ring, each representing one frequency band at the current frame. The ring rotates slowly during playback. Ghost trails show the previous 5 frames fading out.
- **Interface:** `export function initDecryptionRing(canvasId, bus, state) { ... }`
- **Data source:** `state.getPrecomputed().bandsLeft[currentFrame * 40 ... currentFrame * 40 + 39]`
- **Drawing algorithm:**
  - Center the ring in the canvas. Outer radius = 90% of min(width, height) / 2. Inner radius = 40% of outer.
  - Each of 40 arcs spans `2π / 40` radians (9° each). Arc length (radial extent outward) is proportional to band energy (0–255 scaled to inner→outer radius range).
  - Color: `--sl-cyan` with alpha based on energy (0 → 0.1 alpha, 255 → 1.0 alpha)
  - **Ghost trails:** Draw the previous 5 frames' rings underneath with decreasing opacity (frame-4 at 0.1 alpha, frame-1 at 0.4 alpha). This creates a trailing/echo effect.
  - **Rotation:** Offset all arc angles by `currentFrame * 0.01` radians so the ring slowly rotates as the playhead advances.
  - **Center element:** A pulsing dot in the center whose size oscillates with the RMS energy of the current frame. Color: `--sl-amber`. Glow effect.
  - **Ring status text:** Update `#ring-status` DOM element: "STANDBY" before data, "DECRYPTING..." during playback, "SIGNAL LOCKED" when paused with data.
- **Interactions:**
  - **Hover over arc** → emit `hover-band` with that band index
  - **Mouse leave** → emit `hover-band(null)`
- **Bus events listened to:** `data-ready`, `playhead-update`, `hover-band`, `resize`, `power-change`
- **Bus events emitted:** `hover-band`
- **Performance:** The ring redraws entirely on each `playhead-update` (40 arcs + 5 ghost frames = ~240 arcs per frame). This should be fast enough for 60fps on Canvas 2D. On mobile, skip ghost trails (per Plan 13).
- **Testing/Verification** and **Acceptance Criteria** sections

### Plan 09 — Instant Spectrum (`Plans/09-Instant-Spectrum.md`)

Write a complete plan for `js/charts/instant-spectrum.js`. Must include:

- **Objective:** 40-bar vertical bar chart on `#spectrum-canvas` showing the frequency band energies for the current frame. Classic spectrum analyzer look with sci-fi LED segment styling.
- **Interface:** `export function initInstantSpectrum(canvasId, bus, state) { ... }`
- **Data source:** `state.getPrecomputed().bandsLeft[currentFrame * 40 ... currentFrame * 40 + 39]`
- **Drawing algorithm:**
  - 40 vertical bars, evenly spaced across the canvas width, with small gaps between them
  - Bar height proportional to band energy (0–255 mapped to 0–canvas height)
  - **LED segment effect:** Each bar is drawn as stacked horizontal segments (~3px tall with 1px gap), not a solid fill. Gives a retro LED meter look.
  - **Color gradient per bar:** Bottom segments = `--sl-cyan`, middle segments transition to `--sl-amber`, top segments (high energy) = `--sl-red`
  - **Peak hold:** Track the maximum value each bar has reached over the last ~30 frames. Draw a single bright pixel/segment at the peak position that slowly decays (falls by 1 unit per frame).
  - **Decay:** Bars don't snap to new values — apply a smoothing factor: `displayed = displayed * 0.85 + actual * 0.15` (similar to the original repo's smoothing)
- **Interactions:**
  - **Hover over bar** → emit `hover-band` with that band index. Show a tooltip with the band's frequency range (e.g., "283 Hz – 353 Hz") and current dB value
  - **Mouse leave** → emit `hover-band(null)`
  - When a `hover-band` event is received from another chart, highlight that bar (brighter outline or glow)
- **Bus events listened to:** `data-ready`, `playhead-update`, `hover-band`, `resize`, `power-change`
- **Bus events emitted:** `hover-band`
- **Animation:** This chart animates continuously during playback (rAF loop driven by `playhead-update`). The decay and peak-hold logic runs per frame.
- **Testing/Verification** and **Acceptance Criteria** sections

### Plan 10 — Fault Log (`Plans/10-Fault-Log.md`)

Write a complete plan for `js/charts/fault-log.js`. Must include:

- **Objective:** A DOM-based scrollable list in `#fault-list` showing fault events detected during precomputation. Each fault has a type, severity, time range, and message. Styled like a diagnostic terminal readout.
- **Interface:** `export function initFaultLog(containerId, bus, state) { ... }`
- **Data source:** `state.getPrecomputed().faults` — array of `FaultEvent` objects:
  ```
  {
    type: 'clipping' | 'silence' | 'dc_offset' | 'spectral_anomaly' | 'phase_inversion' | 'dynamic_range' | 'mono_segment',
    severity: 'CRIT' | 'WARN' | 'INFO',
    frameStart: number,
    frameEnd: number,
    message: string
  }
  ```
- **Rendering (DOM, not Canvas):**
  - Each fault is a `<div class="fault-entry">` with:
    - Severity badge: `CRIT` = red (`--sl-red`), `WARN` = amber (`--sl-amber`), `INFO` = cyan (`--sl-cyan`)
    - Time range: formatted as `M:SS.s – M:SS.s`
    - Type label (uppercase)
    - Message text
  - Sort by time (earliest first)
  - Update the `#fault-count` badge in the drawer header with the total count
- **Interactions:**
  - **Click on a fault entry** → `bus.emit('playhead-seek', { time })` to jump to that fault's start time. Also `bus.emit('brush-change', { startFrame, endFrame })` to zoom the overview to that region.
  - **Playhead tracking:** As playback advances, highlight the fault entry closest to the current time (add an `active` class). Auto-scroll the list to keep the active entry visible.
- **Bus events listened to:** `data-ready`, `playhead-update`
- **Bus events emitted:** `playhead-seek`, `brush-change`, `fault-click`
- **Styling:**
  - Monospace font, small text (9–10px)
  - Alternating row backgrounds for readability
  - Active fault has a left border glow matching its severity color
  - Scrollable container, max-height set by the fault drawer CSS
- **Testing/Verification** and **Acceptance Criteria** sections

### Plan 11 — Interactions & Linking (`Plans/11-Interactions-Linking.md`)

Write a complete plan for `js/interactions.js`. Must include:

- **Objective:** Wire up cross-chart coordination and the "Reroute Power" controls. This module doesn't own a canvas — it orchestrates communication patterns between charts and builds the power routing UI.
- **Interface:** `export function initInteractions(bus, state) { ... }`
- **Part A: Cross-Chart Hover Linking**
  - When `hover-band` fires, all band-aware charts (heatmap, spectrum, ring) highlight the same band index
  - When `hover-frame` fires, all time-axis charts (overview, spectrogram, heatmap) show a crosshair at that frame
  - Debounce hover events to avoid flooding the bus (max ~30 events/sec)
- **Part B: Shared Tooltip**
  - Create a single floating `<div id="shared-tooltip">` positioned near the cursor
  - Charts populate tooltip content via a `tooltip-show` / `tooltip-hide` bus event (or directly via a shared function)
  - Tooltip shows: band frequency range, energy value, time position, fault info if applicable
  - Auto-hide after mouse leaves all charts
- **Part C: Reroute Power Controls**
  - Build 4 slider controls inside `#power-controls`:
    - **Sensors** (affects spectrogram + heatmap brightness/opacity)
    - **Comms** (affects stereo/phase-related displays)
    - **Targeting** (affects ring + spectrum bar scaling)
    - **Diagnostics** (affects fault log visibility/filtering)
  - Each slider ranges 0.0 to 2.0, default 1.0
  - **Zero-sum constraint:** When one slider goes up, the others go down proportionally so the total always equals 4.0. This creates a "power rerouting" mechanic.
  - On change: `bus.emit('power-change', { weights: { sensors, comms, targeting, diagnostics } })`
  - Chart modules listen to `power-change` and scale their rendering (e.g., multiply canvas globalAlpha by the weight, or scale bar heights)
  - Style sliders with sci-fi appearance: amber track, cyan thumb, labels in monospace
- **Part D: Bookmarks**
  - Press `B` key to add a bookmark at the current playhead time → `bus.emit('bookmark-add', { time, label })`
  - Press `1`–`9` to jump to bookmark 1–9 → `bus.emit('bookmark-jump', { time })`
  - Bookmarks are stored via `state.addBookmark()`
  - Overview waveform draws bookmark flags (small triangles/markers)
  - Bookmarks list in a small UI element (or tooltip)
- **Testing/Verification** and **Acceptance Criteria** sections

---

### Format Requirements for Plan Documents

Each plan document must follow this exact structure (match the style of Plans 00–04, 12, 13):

```markdown
# Plan XX — Title

> **Owner:** Engineer [letter]
> **Dependencies:** Plan [numbers] (brief description)
> **Estimated effort:** X–Y hours
> **Files to create:** `path/to/file.js`

---

## Objective
[2–3 sentence summary]

---

## Interface
[Exported function signature with JSDoc]

---

## Implementation Details
[Detailed step-by-step with code snippets, algorithms, data structures]

---

## Bus Events
[Table: event name, payload, direction (listened/emitted)]

---

## Testing / Verification
[Checkboxes for manual testing steps]

---

## Acceptance Criteria
[Checkboxes for pass/fail criteria]
```

---

## PHASE 2: Implement All Code

After all 14 plan documents are complete and detailed, implement every file specified in the file structure. Work through the plans in dependency order:

### Layer 1: Foundation (implement first, in this order)

1. **`lib/fft.js`** — Radix-2 Cooley-Tukey FFT (Plan 01, Part D)
   - Export `fft(re, im, inverse)` function
   - Bit-reversal permutation + butterfly operations
   - Pre-compute twiddle factors for size 2048
   - ~50 lines of well-commented code

2. **`js/bus.js`** — Event bus (Plan 02, Part A)
   - Export `createBus()` returning `{ on, emit, off, clear }`
   - `Map<string, Set<Function>>` internally
   - Error-catching in handlers
   - Unsubscribe returned from `on()`

3. **`js/state.js`** — State store (Plan 02, Part C)
   - Export `createState()` with all getters/setters per Plan 02
   - Include `frameToTime()`, `timeToFrame()`, `formatTime()` utilities
   - Export a `BUS_EVENTS` constant object documenting all event names

4. **`js/touch-utils.js`** — Unified pointer handlers (Plan 13, Part B)
   - Export `addPointerHandlers(canvas, { onPointerDown, onPointerMove, onPointerUp, onTap })`
   - Handle mouse + touch with consistent `(x, y, event)` interface
   - Tap detection (short press, no significant movement)

5. **`workers/precompute-worker.js`** — Web Worker (Plan 01, Part C)
   - Import `lib/fft.js` (workers support ES module imports)
   - Receive `{ left, right, sampleRate, numSamples, fftSize, hopSize, numBands }` via `postMessage`
   - Implement all 8 pipeline steps from Plan 01:
     1. Downsample LODs (scales 64, 256, 1024, 4096)
     2. RMS envelope
     3. STFT with Hann window
     4. 40 logarithmic bands (Uint8 quantized)
     5. Spectral flux + onset detection
     6. Phase correlation
     7. Fault detection (7 rules: clipping, silence, DC offset, spectral anomaly, phase inversion, dynamic range, mono segment)
     8. Band frequency metadata
   - Post `{ type: 'progress', percent, stage }` at each step
   - Post `{ type: 'result', data: { ... } }` with ALL fields from Plan 01's output spec
   - Transfer typed arrays as Transferable objects

6. **`js/audio-decode.js`** — File decode (Plan 01, Part A)
   - Export `initDecode(bus, state)` which wires up file input + drag-drop
   - Handle `<input type="file">` change and drag-drop on `#drop-zone`
   - Decode via `AudioContext.decodeAudioData()`
   - Extract left/right channels (mono → duplicate to right)
   - Store decoded audio in `state.setDecoded()`
   - Emit `bus.emit('file-loaded', { fileName, duration, sampleRate })`
   - File size warnings per Plan 01 constraints
   - iOS AudioContext handling per Plan 13

7. **`js/precompute.js`** — Worker orchestrator (Plan 01, Part B)
   - Export `initPrecompute(bus, state)` (or `startPrecompute`)
   - Listen for `file-loaded` → create Worker, transfer data
   - Forward `progress` messages to bus
   - On `result` → store in `state.setPrecomputed()`, emit `data-ready`
   - Handle errors

8. **`js/audio-playback.js`** — Playback engine (Plan 04)
   - Export `initPlayback(bus, state)`
   - `AudioBufferSourceNode` → `GainNode` → `destination`
   - Play/pause/seek/restart/mute/nudge/loop
   - Keyboard shortcuts: Space, Arrow Left/Right (±1/±10 frames with Shift), Home, End
   - `playhead-update` at ~60fps via rAF during playback
   - Respond to `playhead-seek`, `loop-change`, `mute-toggle` bus events

### Layer 2: App Shell (can start in parallel with Layer 1)

9. **`css/slicer.css`** — All styles (Plan 03 + Plan 12 + Plan 13)
   - CSS custom properties (design tokens) from Plan 03
   - Layout: CSS Grid for app container, flexbox for columns
   - Panel styling, chart canvas sizing
   - Header bar, transport controls, drop zone
   - Fault drawer (collapsible)
   - Overlay styles (loading, progress)
   - Scanline CRT effect (Plan 12, Part B)
   - Panel corner marks (Plan 12, Part C)
   - Ambient glow during playback (Plan 12, Part D)
   - Flash message styling (Plan 12, Part E)
   - Status indicators (Plan 12, Part F)
   - Drop zone hover/drag-over (Plan 12, Part H)
   - Reduced-motion support (Plan 12, Part I)
   - All 5 responsive breakpoints from Plan 13
   - Phone bottom transport bar (Plan 13, Part C)
   - Orientation hint (Plan 13, Part F)

10. **`index.html`** — App shell (Plan 03)
    - Full HTML structure per Plan 03's specification
    - Loading overlay, progress overlay, header bar, main grid, left column (ring, spectrum, power controls), right column (overview, spectrogram, heatmap), fault drawer
    - `<script type="module" src="js/main.js">`
    - Viewport meta tag with `maximum-scale=1.0, user-scalable=no`
    - Orientation hint element for mobile

### Layer 3: Charts (implement after Layer 1 foundation exists)

11. **`js/charts/overview-waveform.js`** — Plan 05
    - LOD-based waveform rendering
    - Brush-to-zoom (drag to select range)
    - Click-to-seek
    - Shift+drag for loop region
    - Double-click to clear brush
    - Cached background via offscreen canvas
    - Playhead line overlay
    - Bookmark flags
    - Responds to `data-ready`, `playhead-update`, `brush-change`, `loop-change`, `bookmark-add`, `resize`, `power-change`

12. **`js/charts/spectrogram.js`** — Plan 06
    - 40-band × frames heatmap using `ImageData`
    - Sci-fi color ramp (black → blue → cyan → amber → white)
    - Synced with brush (zoom to selected range)
    - Click-to-seek, hover for cross-chart highlighting
    - Pre-rendered full spectrogram image

13. **`js/charts/band-heatmap.js`** — Plan 07
    - 40-row heatmap with amber intensity ramp
    - Band frequency labels on Y-axis
    - Synced with brush
    - Click-to-seek, hover linking

14. **`js/charts/decryption-ring.js`** — Plan 08
    - 40 arcs in a ring, energy controls arc extent
    - Ghost trails (previous 5 frames with fading opacity)
    - Slow rotation during playback
    - Center pulsing dot (RMS-driven)
    - Ring status text updates
    - Hover-to-highlight band

15. **`js/charts/instant-spectrum.js`** — Plan 09
    - 40 vertical bars with LED segment effect
    - Color gradient (cyan → amber → red)
    - Peak hold with slow decay
    - Smoothed bar values (exponential decay)
    - Hover tooltip with frequency range
    - Cross-chart band highlighting

16. **`js/charts/fault-log.js`** — Plan 10
    - DOM rendering of fault entries with severity badges
    - Click-to-seek + brush to fault region
    - Playhead tracking (highlight active fault, auto-scroll)
    - Fault count badge update

### Layer 4: Integration (implement after all charts exist)

17. **`js/interactions.js`** — Plan 11
    - Cross-chart hover linking (debounced)
    - Shared tooltip
    - Reroute Power: 4 zero-sum sliders (total = 4.0)
    - Bookmarks: B key to add, 1–9 to jump

18. **`js/theme.js`** — Plan 12
    - Decryption loading sequence: staggered panel reveal over ~3 seconds
    - Panel encryption/decryption CSS class toggle
    - Flash message system
    - Corner mark injection
    - Playback glow toggle
    - Status indicator updates

19. **`js/main.js`** — Plan 03 (boot sequence)
    - Import and wire everything: `createBus()`, `createState()`, all `init*()` functions
    - DPI-aware canvas resizing
    - Overlay logic (loading → progress → data-ready)
    - Fault drawer toggle
    - Resize handler
    - Mobile DPR capping per Plan 13

---

## Implementation Checklist

Use this checklist to track progress. Do NOT skip any item. Mark each done as you complete it.

### Phase 1: Plan Documents
- [ ] Plan 05 — Overview Waveform: fully written with all sections
- [ ] Plan 06 — Spectrogram: fully written with all sections
- [ ] Plan 07 — Band Heatmap: fully written with all sections
- [ ] Plan 08 — Decryption Ring: fully written with all sections
- [ ] Plan 09 — Instant Spectrum: fully written with all sections
- [ ] Plan 10 — Fault Log: fully written with all sections
- [ ] Plan 11 — Interactions & Linking: fully written with all sections

### Phase 2: Foundation
- [ ] `lib/fft.js` created and exports `fft()`
- [ ] `js/bus.js` created and exports `createBus()`
- [ ] `js/state.js` created and exports `createState()`, utilities, `BUS_EVENTS`
- [ ] `js/touch-utils.js` created and exports `addPointerHandlers()`
- [ ] `workers/precompute-worker.js` created with all 8 pipeline steps
- [ ] `js/audio-decode.js` created with file upload + drag-drop + decode
- [ ] `js/precompute.js` created with worker orchestration
- [ ] `js/audio-playback.js` created with full playback engine

### Phase 3: Shell & Styles
- [ ] `css/slicer.css` created with all tokens, layout, responsive, theme effects
- [ ] `index.html` created with full DOM structure

### Phase 4: Charts
- [ ] `js/charts/overview-waveform.js` implemented
- [ ] `js/charts/spectrogram.js` implemented
- [ ] `js/charts/band-heatmap.js` implemented
- [ ] `js/charts/decryption-ring.js` implemented
- [ ] `js/charts/instant-spectrum.js` implemented
- [ ] `js/charts/fault-log.js` implemented

### Phase 5: Integration
- [ ] `js/interactions.js` implemented (hover linking, tooltip, power routing, bookmarks)
- [ ] `js/theme.js` implemented (decryption sequence, corner marks, glow, flash)
- [ ] `js/main.js` implemented (boot sequence, canvas resize, overlay logic)

### Phase 6: Verification
- [ ] Open `index.html` in browser via local server — no console errors
- [ ] Upload a WAV file — decoding + precompute completes with progress bar
- [ ] Decryption sequence animates panels one by one
- [ ] Press Play — audio plays, all charts animate
- [ ] Overview waveform shows full track, playhead moves
- [ ] Spectrogram shows frequency×time heatmap with correct color ramp
- [ ] Band heatmap shows amber intensity grid
- [ ] Decryption ring rotates with ghost trails
- [ ] Instant spectrum shows bouncing bars with LED segments and peak hold
- [ ] Fault log populates with detected faults
- [ ] Click on fault entry → seeks to that time
- [ ] Brush-select on overview → spectrogram and heatmap zoom
- [ ] Hover on one chart → other charts highlight same band/frame
- [ ] Reroute Power sliders affect chart rendering
- [ ] Mute button silences audio without stopping playback
- [ ] Keyboard shortcuts work (Space, arrows, Home, End, B, 1–9)
- [ ] Resize browser → layout adjusts, canvases re-render crisply
- [ ] Reduced-motion media query disables animations
- [ ] Mobile viewport (< 600px) shows single-column layout with bottom transport

---

## Critical Bus Event Catalog (Reference)

Every module must use these exact event names:

| Event | Payload | Direction |
|---|---|---|
| `file-loaded` | `{ fileName, duration, sampleRate }` | decode → shell, transport |
| `precompute-progress` | `{ percent, stage }` | precompute → shell |
| `precompute-error` | `{ message }` | precompute → shell |
| `data-ready` | `void` | precompute → all charts |
| `playback-started` | `void` | playback → transport |
| `playback-paused` | `void` | playback → transport |
| `playback-ended` | `void` | playback → transport |
| `playhead-update` | `{ frame, time }` | playback → all charts |
| `playhead-seek` | `{ time }` | any → playback |
| `brush-change` | `{ startFrame, endFrame } \| null` | overview → time-axis charts |
| `loop-change` | `{ startTime, endTime } \| null` | overview → playback |
| `hover-band` | `{ bandIndex } \| null` | any band chart → others |
| `hover-frame` | `{ frame } \| null` | any time chart → others |
| `power-change` | `{ weights: { sensors, comms, targeting, diagnostics } }` | interactions → all charts |
| `fault-click` | `{ time }` | fault log → playhead |
| `bookmark-add` | `{ time, label? }` | user → overview |
| `bookmark-jump` | `{ time }` | bookmark → playhead |
| `mute-toggle` | `{ muted }` | transport → playback |
| `theme-loaded` | `void` | theme → shell |
| `resize` | `void` | main → all charts |

---

## Precomputed Data Shape (Reference)

The `state.getPrecomputed()` object has this shape — all charts depend on it:

```js
{
  sampleRate: 44100,
  numSamples: 2646000,        // total samples per channel
  numFrames: 5161,             // ≈ (numSamples - 2048) / 512 + 1
  duration: 60.0,              // seconds
  fftSize: 2048,
  hopSize: 512,
  numBands: 40,

  waveformLODs: {
    left: [Float32Array, Float32Array, Float32Array, Float32Array],
    right: [Float32Array, Float32Array, Float32Array, Float32Array],
    scales: [64, 256, 1024, 4096]
  },

  rmsLeft: Float32Array,         // [numFrames]
  rmsRight: Float32Array,        // [numFrames]
  bandsLeft: Uint8Array,         // [numFrames × 40], row-major
  bandsRight: Uint8Array,        // [numFrames × 40], row-major
  spectralFlux: Float32Array,    // [numFrames]
  onsets: Uint32Array,           // [numOnsets] frame indices
  phaseCorrelation: Float32Array,// [numFrames]
  faults: Array<{               // FaultEvent objects
    type: string,
    severity: 'CRIT' | 'WARN' | 'INFO',
    frameStart: number,
    frameEnd: number,
    message: string
  }>,
  bandFrequencies: Array<{ low: number, high: number }>  // [40]
}
```

---

## Final Instructions

1. **Do NOT skip any file.** Every file in the file structure must be created.
2. **Do NOT leave TODO or placeholder comments** in the code. Write complete, working implementations.
3. **Test mentally** as you go: after creating each module, check that its imports resolve and its bus events match the catalog.
4. **Use consistent code style:** 2-space indentation, single quotes for strings, semicolons, `const`/`let` (no `var`).
5. **Comment complex algorithms** (FFT, STFT, LOD selection, fault detection rules) but don't over-comment obvious code.
6. **Handle edge cases:** empty files, mono audio, very short files, browser tab hidden during playback, AudioContext suspended.
7. If the existing `index.html` has not been renamed yet, rename it to `index_v1.html` before creating the new one.
8. **Work until completely done.** Do not stop partway. Every checkbox above must be checked.
