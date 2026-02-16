# Agents — Astromech Slicer Panel

This document describes the AI-assisted development process used to build the Astromech Slicer Panel. The entire project — from initial concept to fully implemented multi-chart audio visualization — was designed, planned, and coded with the help of AI coding agents.

---

## Project Origin

The Slicer Panel started as a fork of [seabass223/spectrum-analyzer](https://github.com/seabass223/spectrum-analyzer), a single-file HTML spectrum analyzer (the "RSX-2"). The goal was to transform it into a multi-chart, coordinated audio analysis dashboard with a Star Wars astromech hacking aesthetic — while keeping the constraint of **zero frameworks, zero build steps, zero dependencies**.

The original upstream project is preserved as `index_v1.html` for reference.

---

## Agent Workflow

### Phase 1: Planning (AI-Generated Architecture)

The project began with a detailed planning prompt (`Prompts/InitialPlanningPrompt.md`) sent to an AI assistant. The prompt specified:

- The sci-fi "Astromech Slicer Panel" concept and aesthetic goals
- Hard constraints: vanilla HTML/CSS/JS only, no frameworks, no build tools
- Requirements for multiple coordinated data visualizations across time/frequency domains
- The need for real, informative charts (not fake animations)

The AI produced **14 detailed plan documents** (`Plans/00-Architecture-Overview.md` through `Plans/13-Mobile-Support.md`), each covering a specific subsystem:

| Plan | Scope |
|------|-------|
| 00 | Architecture overview, file structure, data flow |
| 01 | Audio pipeline (decode, FFT, precompute) |
| 02 | State management & event bus |
| 03 | App shell layout |
| 04 | Playback & transport controls |
| 05 | Overview waveform chart |
| 06 | Spectrogram chart |
| 07 | Band heatmap chart |
| 08 | Decryption ring chart |
| 09 | Instant spectrum chart |
| 10 | Fault log system |
| 11 | Cross-chart interactions & linking |
| 12 | Sci-fi theme & visual effects |
| 13 | Mobile & touch support |

These plans defined module interfaces, event contracts, CSS custom properties, data shapes, and dependency ordering — forming a complete specification before any code was written.

### Phase 2: Implementation (AI-Driven Coding)

A second prompt (`Prompts/CodexImplementationPrompt.md`) was crafted to instruct an agentic AI coding assistant (OpenAI Codex / similar) to autonomously implement the entire application from the plan documents. Key aspects of this prompt:

- Provided the full workspace structure and all plan files as context
- Specified hard constraints (no frameworks, ES Modules, no external CDNs)
- Locked in technical decisions (FFT parameters, Web Worker strategy, Canvas 2D rendering)
- Defined the implementation order based on the plan dependency graph
- Required the agent to read each plan and implement it completely

The agent worked through the plans in dependency order:
1. **Foundation** — Event bus, state store, app shell HTML/CSS
2. **Audio pipeline** — File decode, Web Worker precomputation, playback engine
3. **Charts** — Each visualization module implemented against the `init(canvasId, bus, state)` interface
4. **Interactions** — Cross-chart linking, power reroute, EQ dials
5. **Theme & polish** — Sci-fi visual effects, scanlines, glow animations

### Phase 3: Iteration & Live Mode

After the core Panel View was complete, additional features were developed through continued AI-assisted iteration:

- **Live Mode** (`Live.html` / `js/live-main.js`) — A full-screen performance visualization that reuses all chart modules with beat-synced transitions
- **Beat Tap / Signal Sync** — A rhythm game layer synced to onset detection
- **Phase Scope & Oscilloscope** — Additional real-time visualizations
- **5-Band EQ** — Orbital dial controls with `BiquadFilterNode` integration

---

## How the Agent Architecture Works

The project's modular design was intentionally optimized for AI-assisted development:

- **Consistent module interface** — Every chart module exports a single `init*()` function with the same signature `(canvasId, bus, state)`. This pattern is simple enough for an AI to implement reliably across many modules.
- **Event-driven decoupling** — Modules never call each other directly. The pub/sub bus means the AI could implement each module independently without tracking cross-module dependencies.
- **Plan-driven development** — Each plan document served as a self-contained specification. The AI could implement one plan at a time, test it against the spec, and move on.
- **No build tooling** — Eliminating bundlers, transpilers, and package managers removed an entire category of failure modes for AI-generated code. Open `index.html` and see if it works.

---

## Lessons Learned

1. **Detailed plans produce better agent output.** The 14-plan architecture doc set was the single most important investment. Vague prompts produce vague code.

2. **Constraints help agents.** "No frameworks, no build step" actually made the AI's job easier — fewer abstractions to get wrong, fewer config files to manage.

3. **Consistent patterns compound.** Once the first chart module worked (`overview-waveform.js`), the AI could replicate the pattern across all other charts with high reliability.

4. **Pub/sub is agent-friendly.** The event bus pattern eliminates the hardest part of multi-module development — managing direct dependencies and call sequences.

5. **Vanilla JS is underrated.** The final application has zero `node_modules`, loads instantly, and the entire codebase is readable in a single session. No framework churn, no version conflicts.

---

## Tools Used

- **AI Planning Agent** — Generated architecture documents, data flow diagrams, and module specifications
- **AI Coding Agent (Codex-class)** — Implemented all JavaScript modules, HTML structure, and CSS styling from plan documents
- **AI Iteration Agent (Copilot-class)** — Refinements, bug fixes, new features (Live Mode, additional charts), and documentation

All AI-generated code was reviewed and tested in-browser. The planning prompts and implementation prompts are preserved in the `Prompts/` directory for reproducibility.
