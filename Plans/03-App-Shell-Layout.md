# Plan 03 — App Shell & Layout

> **Owner:** Engineer B (or any front-end engineer)
> **Dependencies:** Plan 00 (file structure), Plan 02 (bus/state created in main.js)
> **Estimated effort:** 3–4 hours
> **Files to create:** `index.html` (rewrite), `css/slicer.css`, `js/main.js`

---

## Objective

Build the HTML structure and CSS layout for the Slicer Panel. This is the skeleton that all chart modules plug into. It must be responsive down to tablet width (1024px) and include placeholder panels for every chart.

---

## Layout Specification

### Desktop (≥1280px)

```
┌─────────────────────────────────────────────────────────────┐
│  HEADER BAR (fixed height 56px)                             │
│  [Slicer Title]  [File Drop Zone]  [Transport]  [Mute]      │
├───────────────────────┬─────────────────────────────────────┤
│  LEFT COL (30%, min   │  RIGHT COL (70%)                    │
│  320px)               │                                     │
│                       │  ┌────────────────────────────────┐ │
│  ┌─────────────────┐  │  │ overview-waveform-canvas       │ │
│  │ ring-canvas     │  │  │ (height: 120px)                │ │
│  │ (aspect 1:1,    │  │  └────────────────────────────────┘ │
│  │  max 320×320)   │  │  ┌────────────────────────────────┐ │
│  └─────────────────┘  │  │ spectrogram-canvas             │ │
│                       │  │ (height: 200px)                │ │
│  ┌─────────────────┐  │  └────────────────────────────────┘ │
│  │ spectrum-canvas │  │  ┌────────────────────────────────┐ │
│  │ (height: 200px) │  │  │ heatmap-canvas                │ │
│  └─────────────────┘  │  │ (height: 160px)                │ │
│                       │  └────────────────────────────────┘ │
│  ┌─────────────────┐  │                                     │
│  │ Power Routing   │  │                                     │
│  │ (4 sliders)     │  │                                     │
│  └─────────────────┘  │                                     │
├───────────────────────┴─────────────────────────────────────┤
│  FAULT LOG (collapsible drawer, max-height 200px)           │
│  [CRIT] Signal overload...  [WARN] Carrier dropout...       │
└─────────────────────────────────────────────────────────────┘
```

### Tablet (1024px–1279px)
- Left column collapses: Ring and Spectrum stack vertically in a scrollable sidebar (width 280px)
- Right column charts fill remaining width

### Mobile (< 1024px)
- Single column, full width
- Charts stack vertically: Overview → Spectrogram → Heatmap → Ring → Spectrum
- Fault log becomes a bottom sheet
- See Plan 13 for full mobile details

---

## HTML Structure (`index.html`)

The new `index.html` replaces the original. Keep the original as `index_original.html` for reference.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Astromech Slicer Panel</title>
  <link rel="icon" type="image/x-icon" href="assets/favicon.ico">
  <link rel="stylesheet" href="css/slicer.css">
</head>
<body>
  <!-- Loading Overlay (shown until first interaction) -->
  <div id="loading-overlay" class="overlay">
    <div class="overlay-content">
      <div class="slicer-logo">⬡ SLICER PANEL</div>
      <p class="overlay-hint">UPLOAD SIGNAL TO BEGIN DECRYPTION</p>
    </div>
  </div>

  <!-- Precompute Progress Overlay -->
  <div id="progress-overlay" class="overlay hidden">
    <div class="overlay-content">
      <div class="progress-label">ANALYZING SIGNAL...</div>
      <div class="progress-bar-track">
        <div id="progress-bar-fill" class="progress-bar-fill"></div>
      </div>
      <div id="progress-stage" class="progress-stage">Initializing...</div>
    </div>
  </div>

  <!-- Main App -->
  <div id="app" class="app-container">

    <!-- Header Bar -->
    <header class="header-bar">
      <div class="header-left">
        <h1 class="slicer-title">ASTROMECH SLICER PANEL</h1>
        <span id="file-info" class="file-info"></span>
      </div>

      <div class="header-center">
        <!-- File Upload (inline drop zone) -->
        <div id="drop-zone" class="drop-zone">
          <input type="file" id="file-input" accept="audio/*" hidden>
          <label for="file-input" class="drop-zone-label">
            <span class="drop-zone-icon">⬡</span>
            <span class="drop-zone-text">DROP SIGNAL FILE</span>
          </label>
        </div>
      </div>

      <div class="header-right">
        <!-- Transport Controls -->
        <div class="transport-controls">
          <button id="btn-restart" class="transport-btn" disabled title="Restart">⏮</button>
          <button id="btn-play" class="transport-btn transport-btn--primary" disabled title="Play/Pause">▶</button>
          <button id="btn-mute" class="transport-btn" disabled title="Mute">🔊</button>
        </div>
        <div class="time-display">
          <span id="time-current" class="time-value">0:00.0</span>
          <span class="time-separator">/</span>
          <span id="time-total" class="time-value">0:00.0</span>
        </div>
      </div>
    </header>

    <!-- Main Content Grid -->
    <main class="main-grid">

      <!-- Left Column -->
      <aside class="left-column">
        <section class="panel panel--ring">
          <div class="panel-header">
            <span class="panel-label">DECRYPTION RING</span>
            <span class="panel-status" id="ring-status">STANDBY</span>
          </div>
          <canvas id="ring-canvas" class="chart-canvas chart-canvas--square"></canvas>
        </section>

        <section class="panel panel--spectrum">
          <div class="panel-header">
            <span class="panel-label">BAND SPECTRUM</span>
          </div>
          <canvas id="spectrum-canvas" class="chart-canvas"></canvas>
        </section>

        <section class="panel panel--power">
          <div class="panel-header">
            <span class="panel-label">REROUTE POWER</span>
          </div>
          <div id="power-controls" class="power-controls">
            <!-- 4 sliders generated by interactions.js -->
          </div>
        </section>
      </aside>

      <!-- Right Column -->
      <div class="right-column">
        <section class="panel panel--overview">
          <div class="panel-header">
            <span class="panel-label">SIGNAL OVERVIEW</span>
            <span class="panel-badge" id="overview-badge"></span>
          </div>
          <canvas id="overview-canvas" class="chart-canvas"></canvas>
        </section>

        <section class="panel panel--spectrogram">
          <div class="panel-header">
            <span class="panel-label">SPECTROGRAM</span>
            <span class="panel-badge" id="spectro-badge"></span>
          </div>
          <canvas id="spectrogram-canvas" class="chart-canvas"></canvas>
        </section>

        <section class="panel panel--heatmap">
          <div class="panel-header">
            <span class="panel-label">BAND ENERGY</span>
          </div>
          <canvas id="heatmap-canvas" class="chart-canvas"></canvas>
        </section>
      </div>
    </main>

    <!-- Fault Log Drawer -->
    <footer class="fault-drawer">
      <div class="fault-drawer-header" id="fault-drawer-toggle">
        <span class="panel-label">FAULT LOG</span>
        <span id="fault-count" class="fault-count">0 EVENTS</span>
        <span class="drawer-chevron">▲</span>
      </div>
      <div id="fault-list" class="fault-list">
        <!-- Populated by fault-log.js -->
      </div>
    </footer>
  </div>

  <!-- Scripts -->
  <script type="module" src="js/main.js"></script>
</body>
</html>
```

---

## CSS Foundation (`css/slicer.css`)

### Key Design Tokens

```css
:root {
  /* Palette */
  --sl-bg:         #060a10;
  --sl-panel:      #0c1018;
  --sl-panel-alt:  #101820;
  --sl-border:     #1a2535;
  --sl-border-glow:#1a3550;

  /* Signal colors */
  --sl-amber:      #ffaa00;
  --sl-amber-dim:  #aa7700;
  --sl-cyan:       #00d4ff;
  --sl-cyan-dim:   #007799;
  --sl-red:        #ff3344;
  --sl-green:      #33ff88;
  --sl-text:       #889aaa;
  --sl-text-dim:   #556677;
  --sl-white:      #ccdde8;

  /* Spacing */
  --sl-gap:        8px;
  --sl-radius:     4px;

  /* Typography */
  --sl-font:       'Courier New', 'Consolas', monospace;
  --sl-font-size:  11px;

  /* Sizes */
  --header-height: 56px;
  --left-col-width: 320px;
  --fault-drawer-h: 40px;  /* collapsed */
}
```

### Layout Rules

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--sl-font);
  font-size: var(--sl-font-size);
  background: var(--sl-bg);
  color: var(--sl-text);
  min-height: 100vh;
  overflow-x: hidden;
}

.app-container {
  display: grid;
  grid-template-rows: var(--header-height) 1fr var(--fault-drawer-h);
  height: 100vh;
  width: 100%;
}

.header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: var(--sl-panel);
  border-bottom: 1px solid var(--sl-border);
  gap: 16px;
  z-index: 10;
}

.main-grid {
  display: grid;
  grid-template-columns: var(--left-col-width) 1fr;
  gap: var(--sl-gap);
  padding: var(--sl-gap);
  overflow: hidden;
}

.left-column {
  display: flex;
  flex-direction: column;
  gap: var(--sl-gap);
  overflow-y: auto;
}

.right-column {
  display: flex;
  flex-direction: column;
  gap: var(--sl-gap);
  min-height: 0; /* allow flex children to shrink */
}

/* Panels */
.panel {
  background: var(--sl-panel);
  border: 1px solid var(--sl-border);
  border-radius: var(--sl-radius);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--sl-border);
  background: var(--sl-panel-alt);
}

.panel-label {
  font-size: 9px;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--sl-text-dim);
}

/* Canvas sizing */
.chart-canvas {
  width: 100%;
  display: block;
}

.panel--overview   .chart-canvas { height: 120px; }
.panel--spectrogram .chart-canvas { height: 200px; }
.panel--heatmap    .chart-canvas { height: 160px; }
.panel--spectrum   .chart-canvas { height: 200px; }
.chart-canvas--square { aspect-ratio: 1; max-height: 320px; }

/* Fault Drawer */
.fault-drawer {
  background: var(--sl-panel);
  border-top: 1px solid var(--sl-border);
  overflow: hidden;
  transition: max-height 0.3s ease;
}
.fault-drawer.expanded {
  max-height: 240px;
}
.fault-drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  cursor: pointer;
}
.fault-list {
  overflow-y: auto;
  max-height: 200px;
  padding: 0 16px 8px;
}
```

### Responsive Breakpoints

```css
@media (max-width: 1279px) {
  .main-grid {
    grid-template-columns: 280px 1fr;
  }
  :root { --left-col-width: 280px; }
}

@media (max-width: 1023px) {
  .main-grid {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
  .left-column {
    flex-direction: row;
    flex-wrap: wrap;
    gap: var(--sl-gap);
  }
  .left-column .panel {
    flex: 1 1 45%;
    min-width: 200px;
  }
}

@media (max-width: 600px) {
  .header-bar {
    flex-wrap: wrap;
    height: auto;
    padding: 8px;
    gap: 8px;
  }
  .left-column .panel {
    flex: 1 1 100%;
  }
}
```

---

## `js/main.js` — Boot Sequence

```js
import { createBus } from './bus.js';
import { createState } from './state.js';
import { initDecode } from './audio-decode.js';
import { initPlayback } from './audio-playback.js';
import { startPrecompute } from './precompute.js';
import { initOverviewWaveform } from './charts/overview-waveform.js';
import { initSpectrogram } from './charts/spectrogram.js';
import { initBandHeatmap } from './charts/band-heatmap.js';
import { initDecryptionRing } from './charts/decryption-ring.js';
import { initInstantSpectrum } from './charts/instant-spectrum.js';
import { initFaultLog } from './charts/fault-log.js';
import { initInteractions } from './interactions.js';
import { initTheme } from './theme.js';

const bus = createBus();
const state = createState();

// 1. Wire up file upload
initDecode(bus, state);

// 2. Wire up playback engine
initPlayback(bus, state);

// 3. Initialize all chart modules (they wait for 'data-ready')
initOverviewWaveform('overview-canvas', bus, state);
initSpectrogram('spectrogram-canvas', bus, state);
initBandHeatmap('heatmap-canvas', bus, state);
initDecryptionRing('ring-canvas', bus, state);
initInstantSpectrum('spectrum-canvas', bus, state);
initFaultLog('fault-list', bus, state);

// 4. Cross-chart interactions + Reroute Power
initInteractions(bus, state);

// 5. Sci-fi theme effects
initTheme(bus, state);

// 6. Fault drawer toggle
document.getElementById('fault-drawer-toggle').addEventListener('click', () => {
  document.querySelector('.fault-drawer').classList.toggle('expanded');
});

// 7. Handle DPI scaling for all canvases
function resizeCanvases() {
  const dpr = window.devicePixelRatio || 1;
  document.querySelectorAll('.chart-canvas').forEach(canvas => {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
  });
  bus.emit('resize');
}

window.addEventListener('resize', resizeCanvases);
resizeCanvases();
```

---

## Overlay Logic

```js
// In main.js or a small overlay module:

bus.on('file-loaded', ({ fileName, duration, sampleRate }) => {
  document.getElementById('loading-overlay').classList.add('hidden');
  document.getElementById('progress-overlay').classList.remove('hidden');
  document.getElementById('file-info').textContent =
    `${fileName} · ${(sampleRate/1000).toFixed(1)}kHz`;
});

bus.on('precompute-progress', ({ percent, stage }) => {
  document.getElementById('progress-bar-fill').style.width = `${percent}%`;
  document.getElementById('progress-stage').textContent = stage;
});

bus.on('data-ready', () => {
  document.getElementById('progress-overlay').classList.add('hidden');
});
```

---

## Testing / Verification

- [ ] Open `index.html` via a local HTTP server (`npx serve .` or `python -m http.server`)
- [ ] All panels are visible with correct layout at 1440px width
- [ ] Resizing to 1024px collapses left column
- [ ] Resizing to 600px stacks everything single-column
- [ ] Loading overlay is visible on first load
- [ ] Clicking the fault drawer header toggles expansion
- [ ] All canvas elements resize correctly (no blur on Retina displays)
- [ ] Console shows no errors from module imports

---

## Acceptance Criteria

- [ ] `index.html` loads all modules via ES module `<script type="module">`
- [ ] Layout matches the specification at desktop, tablet, and mobile breakpoints
- [ ] All chart canvases render at the correct DPI (`width`/`height` attributes = CSS size × devicePixelRatio)
- [ ] Header shows file info after upload
- [ ] Progress overlay shows during precompute with a progress bar
- [ ] Fault drawer is collapsible
- [ ] No external dependencies (no CDN links, no npm packages)
