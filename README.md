# RSX-2 Reference Spectrum Analyzer

<img src="Screenshot 2026-02-13 014805.png" >
My second week 1 submission for Data Visualizations and Interaction is

[A professional-grade audio FFT visualizer designed to look and feel like high-end studio hardware. The RSX-2 features a brushed aluminum faceplate, precision rotary controls, and real-time stereo spectrum analysis with LED-style display bars.](https://kylephoto.blob.core.windows.net/spring-into-ai/fft/index.html)

## Features

### Visual Design
- **Hardware-inspired aesthetics** - Brushed metal texture, corner fasteners, and recessed glass display
- **Dual-channel visualization** - Independent left and right channel spectrum analyzers
- **20-band logarithmic FFT** - Frequency range from 20Hz to 20kHz
- **LED-style bars** - White gradient bars with amber peak indicators
- **Subtle grid overlay** - Professional measurement reference lines

### Interactive Controls

#### Decay Knob
- Controls the fall rate of spectrum bars (1-20)
- Orbital drag interaction - move mouse in circular motion around knob
- Adjusts visual persistence of frequency data

#### Monitor Knob
- Master volume control (-30dB to +10dB)
- Affects both left and right channels
- **Double-click to reset to 0dB** (unity gain)
- Orbital drag interaction

#### Transport Controls
- **Play/Pause** - Start/stop audio playback
- **Restart** - Jump back to beginning
- **Progress bar** - Seek to any position in the track
- **Time display** - Current time and total duration

### Hover Tooltips
Hover over any frequency bar to see:
- **Frequency range** (e.g., "120-250 Hz" or "5.0-10.5 kHz")
- **Current amplitude** (0-255 scale)
- **Energy percentage** - Relative energy contribution to total spectrum

## Usage

1. **Load Audio File**
   - Click "Select File" or drag & drop an MP3/audio file onto the drop zone
   - Supported formats: MP3, WAV, and other browser-compatible audio formats

2. **Control Playback**
   - Click the play button to start
   - Adjust the Monitor knob to control volume
   - Use the progress bar to seek through the track

3. **Adjust Visualization**
   - Turn the Decay knob to control how quickly bars fall
   - Higher values = slower decay (more "sticky" visualization)
   - Lower values = faster decay (more responsive)

4. **Analyze Frequencies**
   - Hover over bars to see detailed frequency information
   - Left and right channels are analyzed independently
   - Watch for amplitude differences between channels

## Technical Details

- **FFT Size**: 2048 samples
- **Frequency Bands**: 20 logarithmic bands
- **Frequency Range**: 20Hz - 20kHz
- **Sample Rate**: Derived from audio source
- **Smoothing**: 0.8 time constant on frequency analysis
- **Stereo Processing**: Independent left/right channel analysis via Web Audio API

## Audio Graph

```
Audio Element
    ↓
Media Element Source
    ↓
Gain Node (Monitor control)
    ↓
Channel Splitter
    ├─→ Analyzer (Left) → Visualizer
    └─→ Analyzer (Right) → Visualizer
```

## Requirements

- Modern web browser with Web Audio API support (Chrome, Firefox, Safari, Edge)
- Local audio files (MP3, WAV, etc.)
- `brushed-metal-texture.png` for hardware aesthetic

## File Structure

```
fft/
├── index.html              # Complete single-file application
├── brushed-metal-texture.png  # Brushed metal background texture
└── README.md               # This file
```

## Controls Summary

| Control | Action | Function |
|---------|--------|----------|
| **Decay Knob** | Orbital drag | Adjust bar fall rate (1-20) |
| **Monitor Knob** | Orbital drag | Adjust volume (-30dB to +10dB) |
| **Monitor Knob** | Double-click | Reset to 0dB |
| **Play/Pause** | Click | Toggle playback |
| **Restart** | Click | Return to start |
| **Progress Bar** | Click/drag | Seek to position |
| **Spectrum Bars** | Hover | Show frequency details |

## Design Philosophy

The RSX-2 is designed to feel less like a software widget and more like a precision instrument built for a mastering room. The brushed aluminum faceplate, exposed black fasteners, and machined control knobs communicate weight and permanence, while the recessed glass display window gives the LED spectrum bars a sense of depth and focus. Each channel is presented symmetrically for critical stereo evaluation, with restrained white LED ladders and subtle amber peak indicators emphasizing accuracy over flash. The rotary gain and decay controls evoke analog signal flow, reinforcing the idea that this is not just a visualizer, but a monitoring tool intended for deliberate listening.

---

Built with vanilla JavaScript and the Web Audio API. No frameworks, no dependencies.
