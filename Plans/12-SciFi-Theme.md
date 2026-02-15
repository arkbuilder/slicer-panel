# Plan 12 — Sci-Fi Theme & Decryption Animation

> **Owner:** Engineer E (or creative lead)
> **Dependencies:** Plan 03 (app shell), Plan 02 (bus events)
> **Estimated effort:** 3–4 hours
> **Files to create/edit:** `js/theme.js`, additions to `css/slicer.css`

---

## Objective

Apply the "Astromech Slicer Panel" sci-fi identity layer on top of the functional chart layout. This includes: the decryption loading sequence (progressive reveal), scanline/CRT effects, glow effects, panel corner details, ambient animation, and audio-reactive accents. None of this changes the underlying data — it's a cosmetic and narrative layer.

---

## Part A: Decryption Loading Sequence

When a file finishes precomputation (`data-ready` fires), don't reveal all charts at once. Instead, run a timed "decryption" animation that reveals charts one by one, as if the astromech is unlocking each subsystem.

### Sequence (total ~3 seconds)

| Time (ms) | Action |
|---|---|
| 0 | Progress overlay fades out. App shell visible but all chart panels show "ENCRYPTED" placeholder |
| 200 | Overview Waveform panel "decrypts" — brief white flash, then waveform draws in |
| 600 | Spectrogram panel decrypts |
| 1000 | Band Heatmap panel decrypts |
| 1400 | Decryption Ring panel decrypts (ring spins up from zero) |
| 1800 | Instant Spectrum panel decrypts |
| 2200 | Fault Log drawer slides open if there are CRIT events |
| 2600 | All panels fully live. "DECRYPTION COMPLETE" flash in header |

### Implementation

```js
export function initTheme(bus, state) {
  // Add 'encrypted' class to all panels initially
  const panels = document.querySelectorAll('.panel');
  panels.forEach(p => p.classList.add('encrypted'));

  bus.on('data-ready', () => {
    const sequence = [
      { selector: '.panel--overview', delay: 200 },
      { selector: '.panel--spectrogram', delay: 600 },
      { selector: '.panel--heatmap', delay: 1000 },
      { selector: '.panel--ring', delay: 1400 },
      { selector: '.panel--spectrum', delay: 1800 },
      { selector: '.fault-drawer', delay: 2200 },
    ];

    for (const { selector, delay } of sequence) {
      setTimeout(() => {
        const panel = document.querySelector(selector);
        if (panel) {
          panel.classList.remove('encrypted');
          panel.classList.add('decrypting');
          setTimeout(() => {
            panel.classList.remove('decrypting');
            panel.classList.add('decrypted');
          }, 300);
        }
      }, delay);
    }

    // Final flash
    setTimeout(() => {
      showFlash('DECRYPTION COMPLETE');
      bus.emit('theme-loaded');
    }, 2600);
  });
}
```

### CSS for Decryption States

```css
/* Encrypted: panel contents hidden */
.panel.encrypted .chart-canvas,
.panel.encrypted .panel-header .panel-status {
  visibility: hidden;
}
.panel.encrypted::after {
  content: '▒▒▒ ENCRYPTED ▒▒▒';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-family: var(--sl-font);
  font-size: 11px;
  letter-spacing: 3px;
  color: var(--sl-text-dim);
  animation: flicker 0.5s infinite;
}

/* Decrypting: brief white flash */
.panel.decrypting {
  animation: decrypt-flash 0.3s ease-out;
}
.panel.decrypting::after {
  display: none;
}

@keyframes decrypt-flash {
  0% { background: #ffffff20; border-color: var(--sl-amber); }
  100% { background: var(--sl-panel); border-color: var(--sl-border); }
}

/* Decrypted: normal state */
.panel.decrypted .chart-canvas {
  visibility: visible;
}
.panel.decrypted::after {
  display: none;
}

@keyframes flicker {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.3; }
}
```

---

## Part B: Scanline / CRT Effect

A subtle full-screen scanline overlay that gives the entire UI a monitor feel.

```css
body::after {
  content: '';
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 1000;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 0.03) 2px,
    rgba(0, 0, 0, 0.03) 4px
  );
  mix-blend-mode: multiply;
}
```

**Important:** This must be very subtle (3% opacity). Too strong and it hurts legibility.

Option to disable via a CSS class on `body`:

```css
body.no-scanlines::after { display: none; }
```

---

## Part C: Panel Corner Details

Sci-fi panel corners — small decorative marks at the corners of each panel:

```css
.panel {
  position: relative;
}

.panel::before {
  content: '';
  position: absolute;
  top: -1px;
  left: -1px;
  width: 12px;
  height: 12px;
  border-top: 2px solid var(--sl-amber-dim);
  border-left: 2px solid var(--sl-amber-dim);
  pointer-events: none;
  z-index: 1;
}

/* Note: since ::after is used for encrypted state, corners use a
   child element or only the ::before pseudo for top-left.
   For full corners, add 4 small <span> elements per panel via JS. */
```

Alternative: Add corner spans via `theme.js`:

```js
function addCornerMarks() {
  document.querySelectorAll('.panel').forEach(panel => {
    ['tl', 'tr', 'bl', 'br'].forEach(pos => {
      const mark = document.createElement('span');
      mark.className = `corner-mark corner-mark--${pos}`;
      panel.appendChild(mark);
    });
  });
}
```

```css
.corner-mark {
  position: absolute;
  width: 10px;
  height: 10px;
  pointer-events: none;
  z-index: 2;
}
.corner-mark--tl { top: -1px; left: -1px; border-top: 2px solid var(--sl-amber-dim); border-left: 2px solid var(--sl-amber-dim); }
.corner-mark--tr { top: -1px; right: -1px; border-top: 2px solid var(--sl-amber-dim); border-right: 2px solid var(--sl-amber-dim); }
.corner-mark--bl { bottom: -1px; left: -1px; border-bottom: 2px solid var(--sl-amber-dim); border-left: 2px solid var(--sl-amber-dim); }
.corner-mark--br { bottom: -1px; right: -1px; border-bottom: 2px solid var(--sl-amber-dim); border-right: 2px solid var(--sl-amber-dim); }
```

---

## Part D: Ambient Glow & Border Effects

Panels get a subtle glow border when their data is "active" (during playback):

```css
.panel.active-glow {
  border-color: var(--sl-border-glow);
  box-shadow: 0 0 12px rgba(0, 212, 255, 0.06),
              inset 0 0 12px rgba(0, 212, 255, 0.03);
}
```

Toggle via JS during playback:

```js
bus.on('playback-started', () => {
  document.querySelectorAll('.panel').forEach(p => p.classList.add('active-glow'));
});
bus.on('playback-paused', () => {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active-glow'));
});
```

---

## Part E: Header Flash Messages

A brief text flash that appears in the header for status messages:

```js
function showFlash(message) {
  const flash = document.createElement('div');
  flash.className = 'header-flash';
  flash.textContent = message;
  document.querySelector('.header-bar').appendChild(flash);

  setTimeout(() => flash.classList.add('visible'), 10);
  setTimeout(() => {
    flash.classList.remove('visible');
    setTimeout(() => flash.remove(), 500);
  }, 2000);
}
```

```css
.header-flash {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-family: var(--sl-font);
  font-size: 12px;
  letter-spacing: 4px;
  color: var(--sl-amber);
  text-shadow: 0 0 12px rgba(255, 170, 0, 0.6);
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
  z-index: 20;
}
.header-flash.visible {
  opacity: 1;
}
```

---

## Part F: Status Indicators

Small animated indicators in panel headers:

```css
.panel-status {
  font-size: 8px;
  letter-spacing: 2px;
  color: var(--sl-text-dim);
  text-transform: uppercase;
}

.panel-status.active {
  color: var(--sl-amber);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1.0; }
}
```

---

## Part G: Loading Overlay Styling

```css
.overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: var(--sl-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  transition: opacity 0.5s ease;
}
.overlay.hidden {
  opacity: 0;
  pointer-events: none;
}

.overlay-content {
  text-align: center;
}

.slicer-logo {
  font-family: var(--sl-font);
  font-size: 24px;
  letter-spacing: 6px;
  color: var(--sl-amber);
  text-shadow: 0 0 20px rgba(255, 170, 0, 0.4);
  margin-bottom: 16px;
}

.overlay-hint {
  font-size: 10px;
  letter-spacing: 3px;
  color: var(--sl-text-dim);
  animation: flicker 3s infinite;
}

.progress-bar-track {
  width: 300px;
  height: 4px;
  background: var(--sl-border);
  border-radius: 2px;
  margin: 16px auto;
  overflow: hidden;
}
.progress-bar-fill {
  height: 100%;
  width: 0%;
  background: var(--sl-amber);
  transition: width 0.3s ease;
  box-shadow: 0 0 8px rgba(255, 170, 0, 0.6);
}

.progress-stage {
  font-size: 9px;
  letter-spacing: 2px;
  color: var(--sl-text-dim);
}
```

---

## Part H: Drop Zone Enhancement

```css
.drop-zone {
  border: 1px dashed var(--sl-border);
  border-radius: var(--sl-radius);
  padding: 8px 16px;
  cursor: pointer;
  transition: all 0.3s ease;
  background: transparent;
}

.drop-zone:hover,
.drop-zone.drag-over {
  border-color: var(--sl-amber);
  background: rgba(255, 170, 0, 0.05);
  box-shadow: 0 0 12px rgba(255, 170, 0, 0.1);
}

.drop-zone-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.drop-zone-icon {
  color: var(--sl-amber-dim);
  font-size: 14px;
}

.drop-zone-text {
  font-size: 9px;
  letter-spacing: 2px;
  color: var(--sl-text-dim);
}
```

---

## Part I: Reduced Motion Support

```css
@media (prefers-reduced-motion: reduce) {
  body::after { display: none; }
  .corner-mark { display: none; }

  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Testing / Verification

- [ ] First load shows loading overlay with slicer logo and flickering hint
- [ ] After file upload, progress overlay shows with advancing bar
- [ ] After data-ready, panels decrypt one by one with flash animation
- [ ] "DECRYPTION COMPLETE" flashes in header after sequence finishes
- [ ] Scanlines are barely visible (subtle but present)
- [ ] Panel corners have amber accent marks
- [ ] Panels glow during playback, stop glowing when paused
- [ ] `prefers-reduced-motion` disables all animations
- [ ] Drop zone highlights on drag-over

---

## Acceptance Criteria

- [ ] Decryption loading sequence runs on data-ready (staggered panel reveal)
- [ ] Scanline effect is present but does not reduce chart legibility
- [ ] Panel corner decorations visible
- [ ] Panels glow during playback
- [ ] Flash message system works
- [ ] Loading + progress overlays styled correctly
- [ ] Drop zone has hover/drag-over feedback
- [ ] Reduced-motion media query respects user preference

## Objective

This file is reserved for implementation details in the next execution pass.

## Acceptance Criteria

- [ ] Detailed implementation steps are defined
- [ ] Validation checklist is added
