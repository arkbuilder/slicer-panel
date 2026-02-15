# Plan 00 — Architecture Overview & File Structure

> **Owner:** Tech Lead / Any engineer (read-first doc for all contributors)
> **Dependencies:** None (this is the root doc)
> **Estimated effort:** 2 hours (scaffold only)

---

## Context

We're building the **Astromech Slicer Panel** — a sci-fi audio data visualization that analyzes an uploaded WAV file and presents 6–8 coordinated charts styled like a Star Wars astromech hacking console.

This is **vanilla HTML + CSS + JavaScript**. No frameworks, no build step, no bundler. Open `index.html` in a browser and it works. This matches the upstream project (seabass223/spectrum-analyzer) which is a single 2015-line HTML file.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | None (vanilla JS) | Matches upstream; zero build step; maximal portability |
| Module pattern | ES Modules (`<script type="module">`) | Clean file separation without bundler; native browser support |
| State management | Custom pub/sub event bus (`SlicerBus`) | Lightweight; decouples charts from each other; see Plan 02 |
| Rendering | Canvas 2D for all charts; DOM for fault log | Performance + sci-fi glow effects; fault log needs semantic HTML |
| Audio decode | `AudioContext.decodeAudioData()` | Browser-native; handles WAV/MP3/FLAC/OGG |
| FFT | Pure JS in Web Worker (`fft.js` or hand-rolled radix-2) | No WASM build step; fast enough for offline precompute |
| Styling | CSS custom properties for theme; single CSS file | Easy sci-fi theme tuning; no preprocessor needed |
| Mobile | Touch support + responsive layout | See Plan 13 |

---

## File Structure

```
slicer-panel/
├── index.html                    # Main app shell (layout, DOM structure)
├── css/
│   └── slicer.css                # All styles (sci-fi theme, layout, responsive)
├── js/
│   ├── main.js                   # Entry point: wires up modules, boot sequence
│   ├── bus.js                    # Event bus (pub/sub) — Plan 02
│   ├── state.js                  # Global state store — Plan 02
│   ├── audio-decode.js           # WAV upload + decodeAudioData — Plan 01
│   ├── audio-playback.js         # AudioBufferSourceNode playback — Plan 04
│   ├── precompute.js             # Kicks off Web Worker, receives results — Plan 01
│   ├── charts/
│   │   ├── overview-waveform.js  # Full-track waveform — Plan 05
│   │   ├── spectrogram.js        # Freq×time heatmap — Plan 06
│   │   ├── band-heatmap.js       # 40-band energy history — Plan 07
│   │   ├── decryption-ring.js    # Radial band view — Plan 08
│   │   ├── instant-spectrum.js   # 40-bar realtime spectrum — Plan 09
│   │   └── fault-log.js          # Fault event list — Plan 10
│   ├── interactions.js           # Cross-chart linking, reroute power — Plan 11
│   └── theme.js                  # Decryption animation, scanline FX — Plan 12
├── workers/
│   └── precompute-worker.js      # Web Worker: FFT, bands, RMS, faults — Plan 01
├── lib/
│   └── fft.js                    # Radix-2 FFT implementation (vendored)
├── assets/
│   ├── brushed-metal-texture.jpg # From original repo
│   └── favicon.ico               # From original repo
├── Prompts/
│   └── InitialPlanningPrompt.md  # Original planning prompt
├── Plans/
│   ├── 00-Architecture-Overview.md   # ← this file
│   ├── 01-Audio-Pipeline.md
│   ├── 02-State-And-EventBus.md
│   ├── 03-App-Shell-Layout.md
│   ├── 04-Playback-Transport.md
│   ├── 05-Overview-Waveform.md
│   ├── 06-Spectrogram.md
│   ├── 07-Band-Heatmap.md
│   ├── 08-Decryption-Ring.md
│   ├── 09-Instant-Spectrum.md
│   ├── 10-Fault-Log.md
│   ├── 11-Interactions-Linking.md
│   ├── 12-SciFi-Theme.md
│   └── 13-Mobile-Support.md
└── README.md
```

---

## Data Flow (ASCII)

```
WAV FILE (drag-drop / file picker)
    │
    ▼
┌──────────────────────┐
│  audio-decode.js     │  decodeAudioData() → AudioBuffer
│  (main thread)       │  → Float32Array per channel
└──────┬───────────────┘
       │ postMessage(samples)
       ▼
┌──────────────────────────────────────────────────────────┐
│  precompute-worker.js  (Web Worker)                      │
│                                                          │
│  1. Downsample → LOD waveforms   Float32[N/k × 2]       │
│  2. RMS envelope                 Float32[F]              │
│  3. STFT (Hann 2048, hop 512)    → magnitudes per frame  │
│  4. 40 log bands per frame       Uint8[F × 40]          │
│  5. Spectral flux + onsets       Float32[F] + indices    │
│  6. Phase correlation            Float32[F]              │
│  7. Fault detection              Event[]                 │
│                                                          │
│  F = numFrames ≈ (N − 2048) / 512 + 1                   │
│  Posts results back via Transferable arrays               │
└──────────┬───────────────────────────────────────────────┘
           │ onmessage (results)
           ▼
┌──────────────────────┐
│  state.js            │  Stores all precomputed arrays
│  (main thread)       │  Emits 'data-ready' via bus
└──────┬───────────────┘
       │ bus events
       ▼
┌──────────────────────────────────────────────┐
│  CHART MODULES (each listens to bus)         │
│                                              │
│  overview-waveform.js ←── LOD waveforms      │
│  spectrogram.js       ←── STFT / band data   │
│  band-heatmap.js      ←── 40-band matrix     │
│  decryption-ring.js   ←── bands[frame]       │
│  instant-spectrum.js  ←── bands[frame]       │
│  fault-log.js         ←── fault events       │
│                                              │
│  All listen to: playhead-update, brush-change│
│  All post to: playhead-seek, selection-change│
└──────────────────────────────────────────────┘
```

---

## Key Conventions

### Module Interface Pattern

Every chart module exports an `init(canvasId, bus, state)` function and manages its own Canvas. Example:

```js
// js/charts/overview-waveform.js
export function init(canvasId, bus, state) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');

  bus.on('data-ready', () => draw(ctx, state));
  bus.on('playhead-update', (frame) => drawPlayhead(ctx, frame));
  // ... touch/mouse handlers
}
```

### Bus Event Names (see Plan 02 for full spec)

| Event | Payload | Emitter → Listener |
|---|---|---|
| `data-ready` | `void` | precompute → all charts |
| `playhead-update` | `{ frame: number, time: number }` | playback/transport → all charts |
| `playhead-seek` | `{ time: number }` | any chart → playback |
| `brush-change` | `{ startFrame, endFrame }` | overview → time-axis charts |
| `loop-change` | `{ startTime, endTime }` | overview → playback |
| `hover-band` | `{ bandIndex }` | any band chart → ring, spectrum, heatmap |
| `power-change` | `{ weights: number[] }` | reroute → all charts |
| `fault-click` | `{ time: number }` | fault log → playhead |

### CSS Custom Properties (see Plan 12)

```css
:root {
  --slicer-bg: #0a0e14;
  --slicer-panel: #0d1117;
  --slicer-border: #1a2332;
  --slicer-amber: #ffaa00;
  --slicer-cyan: #00e5ff;
  --slicer-red: #ff3333;
  --slicer-text: #8899aa;
  --slicer-glow: 0 0 8px rgba(255, 170, 0, 0.4);
}
```

---

## Dependency Graph Between Plans

```
Plan 00 (this doc) ─── read first ───────────────────────┐
                                                          │
Plan 01 (Audio Pipeline) ──┐                              │
Plan 02 (State & Bus) ─────┤── foundation layer           │
Plan 03 (App Shell) ───────┘    (build in parallel)       │
                                                          │
Plan 04 (Playback) ←── needs 01, 02, 03                  │
                                                          │
Plan 05 (Overview) ──┐                                    │
Plan 06 (Spectro.) ──┤                                    │
Plan 07 (Heatmap) ───┤── chart layer (parallel)           │
Plan 08 (Ring) ───────┤   each needs 02, 03               │
Plan 09 (Spectrum) ───┤                                    │
Plan 10 (Fault Log) ──┘                                    │
                                                          │
Plan 11 (Interactions) ←── needs all charts               │
Plan 12 (Sci-Fi Theme) ←── can start after 03             │
Plan 13 (Mobile) ←── can start after 03                   │
```

**Parallel work streams:**
- **Engineer A:** Plans 01 + 05 + 06 (audio pipeline → waveform → spectrogram)
- **Engineer B:** Plans 02 + 03 + 04 (state bus → shell → playback)
- **Engineer C:** Plans 07 + 08 + 09 (heatmap → ring → spectrum)
- **Engineer D:** Plans 10 + 11 (fault log → interactions)
- **Engineer E:** Plans 12 + 13 (theme → mobile)

---

## Milestones (revised for vanilla JS)

| Milestone | Day | Deliverables |
|---|---|---|
| **Foundation** | 1–2 | Plans 01, 02, 03: File upload → decode → precompute → data in state. App shell with placeholder panels. Event bus wired. |
| **MVP** | 3–4 | Plans 04, 05, 09: Audible playback + mute. Overview waveform with brush. Instantaneous spectrum. Linked playhead across both. |
| **Core Charts** | 5–6 | Plans 06, 07, 08: Spectrogram waterfall, band-energy heatmap, decryption ring. All linked to overview brush + playhead. |
| **Narrative** | 7–8 | Plans 10, 11, 12: Fault log, cross-chart interactions, Reroute Power, decryption animation, sci-fi polish. |
| **Mobile + Polish** | 9–14 | Plan 13: Touch events, responsive layout. Performance profiling. A11y. Export. Docs. |

---

## Acceptance Criteria (for this plan)

- [x] File structure created as specified above
- [x] `index.html` loads with `<script type="module" src="js/main.js">`
- [x] Opening `index.html` directly in browser (via `file://` or simple HTTP server) shows the app shell
- [ ] All engineers have read this doc and understand the module interface pattern

Team-process note: the final checklist item remains a manual confirmation step.
