# Plan 13 — Mobile & Touch Support

> **Owner:** Engineer E
> **Dependencies:** Plan 03 (app shell layout), Plan 05–09 (chart modules)
> **Estimated effort:** 4–5 hours
> **Files to create/edit:** additions to `css/slicer.css`, touch handlers in each chart module

---

## Objective

Make the Slicer Panel usable on tablets and phones. Audio data visualization is inherently a desktop-first experience, but the panel should be functional (not just "not broken") on touch devices down to 375px width. Key interactions — playback, scrub, chart browsing — must work with touch.

---

## Breakpoint Strategy

| Breakpoint | Layout | Target Devices |
|---|---|---|
| ≥ 1280px | Two-column (left sidebar + right charts) | Desktop, large laptop |
| 1024–1279px | Narrower sidebar (280px) | Small laptop, iPad landscape |
| 768–1023px | Single-column, ring+spectrum side-by-side | iPad portrait, large tablets |
| 600–767px | Single-column, all full-width | Small tablet, large phone landscape |
| < 600px | Single-column, compact header, stacked | Phone portrait |

---

## Part A: Responsive Layout

### Single-Column Flow (< 1024px)

```css
@media (max-width: 1023px) {
  .main-grid {
    grid-template-columns: 1fr;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  /* Ring and spectrum sit side-by-side on medium screens */
  .left-column {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sl-gap);
    order: 2; /* Move below overview on small screens */
  }

  /* Power controls span full width below */
  .panel--power {
    grid-column: 1 / -1;
  }

  .right-column {
    order: 1; /* Overview + spectrogram first */
  }

  /* Chart heights adapt */
  .panel--overview .chart-canvas { height: 100px; }
  .panel--spectrogram .chart-canvas { height: 160px; }
  .panel--heatmap .chart-canvas { height: 120px; }
  .chart-canvas--square { max-height: 250px; }
}
```

### Phone Layout (< 600px)

```css
@media (max-width: 600px) {
  :root {
    --header-height: auto;
    --sl-gap: 4px;
  }

  .header-bar {
    flex-direction: column;
    align-items: stretch;
    padding: 8px;
    gap: 6px;
  }

  .header-left {
    text-align: center;
  }

  .header-right {
    display: flex;
    justify-content: center;
    gap: 8px;
  }

  .slicer-title {
    font-size: 10px;
    letter-spacing: 2px;
  }

  .left-column {
    grid-template-columns: 1fr;
  }

  .panel--overview .chart-canvas { height: 80px; }
  .panel--spectrogram .chart-canvas { height: 140px; }
  .panel--heatmap .chart-canvas { height: 100px; }
  .panel--spectrum .chart-canvas { height: 150px; }
  .chart-canvas--square { max-height: 200px; }

  /* Fault drawer takes more space on mobile */
  .fault-drawer.expanded {
    max-height: 50vh;
  }

  /* Hide Reroute Power on phone (too cramped) */
  .panel--power {
    display: none;
  }
}
```

---

## Part B: Touch Event Handling

### Touch-Aware Canvas Interactions

Each chart module needs to handle touch events alongside mouse events. Create a shared utility:

```js
// js/touch-utils.js

/**
 * Adds unified pointer handlers to a canvas.
 * Handles mouse + touch with a consistent interface.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Object} handlers
 * @param {function(x, y, e)} handlers.onPointerDown
 * @param {function(x, y, e)} handlers.onPointerMove
 * @param {function(x, y, e)} handlers.onPointerUp
 * @param {function(x, y, e)} handlers.onTap  - short press, no significant movement
 */
export function addPointerHandlers(canvas, handlers) {
  let startX = 0, startY = 0;
  let startTime = 0;
  let moved = false;
  const TAP_THRESHOLD = 8; // px
  const TAP_MAX_DURATION = 300; // ms

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    if (e.touches) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top
      };
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  function onDown(e) {
    const pos = getPos(e);
    startX = pos.x;
    startY = pos.y;
    startTime = Date.now();
    moved = false;
    handlers.onPointerDown?.(pos.x, pos.y, e);
  }

  function onMove(e) {
    const pos = getPos(e);
    const dx = pos.x - startX;
    const dy = pos.y - startY;
    if (Math.abs(dx) > TAP_THRESHOLD || Math.abs(dy) > TAP_THRESHOLD) {
      moved = true;
    }
    handlers.onPointerMove?.(pos.x, pos.y, e);
  }

  function onUp(e) {
    const pos = e.changedTouches
      ? { x: e.changedTouches[0].clientX - canvas.getBoundingClientRect().left,
          y: e.changedTouches[0].clientY - canvas.getBoundingClientRect().top }
      : getPos(e);

    handlers.onPointerUp?.(pos.x, pos.y, e);

    if (!moved && (Date.now() - startTime) < TAP_MAX_DURATION) {
      handlers.onTap?.(pos.x, pos.y, e);
    }
  }

  // Mouse events
  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseup', onUp);
  canvas.addEventListener('mouseleave', () => {
    handlers.onPointerUp?.(-1, -1, null);
  });

  // Touch events
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Prevent scroll while interacting with chart
    onDown(e);
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    onMove(e);
  }, { passive: false });
  canvas.addEventListener('touchend', onUp);
  canvas.addEventListener('touchcancel', () => {
    handlers.onPointerUp?.(-1, -1, null);
  });
}
```

### Per-Chart Touch Behaviors

| Chart | Tap | Drag | Pinch (stretch) |
|---|---|---|---|
| **Overview Waveform** | Seek to tapped time | Brush select region | — |
| **Spectrogram** | Seek to tapped time | Scroll time axis | — |
| **Band Heatmap** | Seek to tapped time | Scroll time axis | — |
| **Decryption Ring** | — (no time axis) | — | — |
| **Instant Spectrum** | Show tooltip for tapped bar | — | — |

### Preventing Page Scroll on Chart Touch

Charts must call `e.preventDefault()` on `touchstart`/`touchmove` to prevent the page from scrolling while the user interacts with a chart. However, the page itself must scroll between charts in single-column mode.

Strategy:
- Only prevent default on chart canvases, not on the overall page
- Add `touch-action: none` CSS to chart canvases:

```css
.chart-canvas {
  touch-action: none; /* We handle touch ourselves */
}
```

---

## Part C: Transport Controls for Touch

The transport buttons work fine on touch (they're `<button>` elements). But additional mobile-friendly affordances:

### Swipe-to-Scrub on Overview

On the overview waveform, horizontal drag = scrub the playhead (in addition to brush-select):
- If touch starts near the playhead line (±20px), drag = scrub
- Otherwise, drag = brush select

### Bottom Transport Bar (Phone)

On phone-width screens, pin the transport controls at the bottom as a fixed bar:

```css
@media (max-width: 600px) {
  .transport-controls {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--sl-panel);
    border-top: 1px solid var(--sl-border);
    padding: 8px 16px;
    display: flex;
    justify-content: center;
    gap: 16px;
    z-index: 30;
  }

  /* Add bottom padding to app so content isn't hidden behind fixed bar */
  .app-container {
    padding-bottom: 56px;
  }
}
```

---

## Part D: DPI & Canvas Sizing

Mobile devices typically have high DPR (2x–3x). The `resizeCanvases()` function in `main.js` already handles this, but ensure:

- Canvas `width`/`height` attributes are set to `cssWidth × dpr` / `cssHeight × dpr`
- All drawing commands use CSS coordinates (the `ctx.scale(dpr, dpr)` in main.js handles this)
- Test at DPR 2 and 3

### Performance Concern: High-DPR Canvases

On a 3× DPR phone, a 375px-wide canvas becomes 1125px wide. For 6 canvases, that's significant. Mitigate:

- Cap DPR at 2 for mobile:
  ```js
  const dpr = Math.min(window.devicePixelRatio || 1, isMobile() ? 2 : 3);
  ```
- Or use a lower render resolution and upscale via CSS (acceptable for data viz)

```js
function isMobile() {
  return window.matchMedia('(max-width: 1023px)').matches
    || ('ontouchstart' in window);
}
```

---

## Part E: Audio on Mobile

### iOS AudioContext Restriction

iOS requires a user gesture to create/resume an `AudioContext`. The playback module (Plan 04) already handles this with `audioCtx.resume()` on play. But on iOS, the `AudioContext` must be created *inside* a touch/click handler.

```js
// In audio-decode.js, defer AudioContext creation:
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

// Call getAudioContext() only inside the file-input change handler or drop handler
```

### File Input on Mobile

The file picker (`<input type="file">`) works on iOS/Android. But some browsers limit accepted formats. Use:

```html
<input type="file" id="file-input" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac">
```

### Memory Limits

Mobile browsers have tighter memory limits (~1–2GB). A 5-minute stereo WAV is ~100MB as Float32. Add warnings:

```js
function checkMemoryWarning(file) {
  const estimatedMB = file.size / (1024 * 1024);
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  if (isMobile && estimatedMB > 50) {
    return `Large file (${estimatedMB.toFixed(0)}MB). May be slow on this device.`;
  }
  if (estimatedMB > 200) {
    return `Very large file (${estimatedMB.toFixed(0)}MB). Consider a shorter clip.`;
  }
  return null;
}
```

---

## Part F: Orientation Handling

On tablets, lock to landscape if possible (more horizontal space for time-axis charts):

```js
// Best-effort: not all browsers support this
if (screen.orientation?.lock) {
  screen.orientation.lock('landscape').catch(() => {
    // Silently fail — many browsers restrict this
  });
}
```

Show a hint if in portrait on a mobile device:

```css
@media (max-width: 767px) and (orientation: portrait) {
  .orientation-hint {
    display: flex;
    position: fixed;
    bottom: 60px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--sl-panel);
    border: 1px solid var(--sl-border);
    padding: 8px 16px;
    font-size: 9px;
    letter-spacing: 2px;
    color: var(--sl-text-dim);
    z-index: 30;
    border-radius: var(--sl-radius);
  }
}
@media (orientation: landscape), (min-width: 768px) {
  .orientation-hint { display: none; }
}
```

---

## Part G: Performance Optimizations for Mobile

| Optimization | Description |
|---|---|
| Throttle playhead updates | On mobile, emit `playhead-update` at 30fps instead of 60fps |
| Reduce chart count | On < 600px, consider hiding the heatmap by default (toggle to show) |
| Smaller spectrogram images | Cap spectrogram `ImageData` width to 1000 on mobile (vs 2000 desktop) |
| Debounce resize | Resize handler debounced to 200ms (not every frame) |
| Disable ghost trails | On mobile, skip the ring ghost trail rendering (5 extra ring draws per frame) |

```js
const MOBILE = isMobile();
const PLAYHEAD_INTERVAL = MOBILE ? 33 : 16; // ~30fps vs ~60fps
const MAX_SPECTROGRAM_WIDTH = MOBILE ? 1000 : 2000;
const ENABLE_GHOST_TRAILS = !MOBILE;
```

---

## Testing / Verification

- [ ] iPad landscape: two-column layout, all charts visible, touch interactions work
- [ ] iPad portrait: single-column, charts stack vertically, scrollable
- [ ] iPhone 14 Pro: single-column, compact header, transport bar at bottom, charts legible
- [ ] Tap on overview → seeks to that position
- [ ] Drag on overview → brush selects a region
- [ ] Playback works on iOS Safari (AudioContext resumes correctly)
- [ ] File picker opens and accepts .wav and .mp3 on iOS and Android
- [ ] No janky scrolling (charts don't intercept page scroll)
- [ ] High-DPI displays render crisp canvases

---

## Acceptance Criteria

- [ ] Layout is responsive at all 5 breakpoints (1280+, 1024, 768, 600, <600)
- [ ] Touch events work on all chart canvases (tap, drag)
- [ ] No page scroll jank when interacting with charts
- [ ] AudioContext works on iOS Safari
- [ ] File upload works on iOS and Android
- [ ] High-DPI canvases are crisp (DPR capped at 2 on mobile)
- [ ] Performance is acceptable on a mid-range phone (no dropped frames at 30fps)
- [ ] Memory warning shown for large files on mobile
- [ ] Transport controls are bottom-pinned on phone screens
- [ ] Orientation hint shown in phone portrait mode

## Objective

This file is reserved for implementation details in the next execution pass.

## Acceptance Criteria

- [ ] Detailed implementation steps are defined
- [ ] Validation checklist is added
