You are a senior front-end + data-viz engineer and creative director. You are helping me plan a fork of this project:
https://github.com/seabass223/spectrum-analyzer

Goal: a novel “Astromech Slicer Panel” sci-fi data visualization where an uploaded WAV file is the primary input. The UI should feel like a Star Wars astromech hacking/decrypting a signal. This is a data visualization project first: multiple coordinated charts visualizing the same WAV data across different time dimensions and transforms.

Constraints:
- Keep the existing audio pipeline concepts where useful (FFT, 40 log bands, stereo split, decay/monitor concepts), but expand to offline analysis of an uploaded WAV.
- Web app (React/TS preferred). Focus on deterministic playback/analysis from the WAV file (not mic input).
- Visuals must be “sci-fi control pad” but the charts must be real, legible, and informative.
- We want novelty: coordinated views + interactions + narrative affordances (fault log, reroute power) without faking the underlying data.
- No backend required (client-side processing). Assume typical browser constraints.

Planning task:
1) Propose 3 alternative product concepts (“Astromech Slicer Panel” variants) each with:
   - Core user experience in 3 bullets
   - What’s novel vs the original repo
   - What charts it includes and why they matter

2) Pick the best concept and write a one-page plan with:
   - Information architecture (panels/screens)
   - Chart list (at least 5) that cover different time dimensions, e.g.:
     * full-track overview
     * medium window (seconds)
     * short window (ms)
     * frequency-time (spectrogram/waterfall)
     * band-energy history (40 log bands)
     * stereo field / phase correlation
     * transient detector / onset map
     * “decryption ring” radial band view
   - For each chart: data source, aggregation/windowing strategy, and interactions (brush/zoom/scrub, linked highlighting)
   - Global interactions: scrub playhead, loop selection, time brush, “reroute power” (visual re-weighting), bookmarks, annotations
   - “Slicer feel” layer: fault log rules triggered by real signal properties (peaks, clipping, silence, sudden spectrum change)

3) Technical architecture:
   - WAV decoding approach (Web Audio decodeAudioData vs custom parser), memory considerations
   - Precompute pipeline steps (downsampled waveform, RMS envelope, FFT windows, mel/log bands, spectrogram tiles)
   - Performance plan (web workers, offscreen canvas, typed arrays, progressive rendering)
   - Data model: define key arrays with shapes (samples, frames, bands)
   - Rendering approach per chart (Canvas vs SVG), and why

4) Milestones:
   - MVP in 3 days: minimal charts + stable interactions
   - “Wow” in 7 days: full slicer panel theme + advanced views
   - Polish in 14 days: performance, accessibility, export/share, documentation

Output format:
- Use crisp headings and bullet lists.
- Include one diagram in ASCII showing data flow from WAV → derived datasets → charts.
- Finish with a risk list (top 5) + mitigations.
- End by asking me 3 high-impact questions that force decisions (not open-ended fluff).

>> new I've had a few margaritas constraint added::

no react-let's make it a challenge. HTML, CSS and Javascript ONLY. NIGHTMARE MODE LET'S GO~!