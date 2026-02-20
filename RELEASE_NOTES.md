# MacOptics v2.0: The Zero-Install Revolution. Physics at the Edge.

**Release codename:** *The Photon Leap*

---

## 🌟 The Breakthrough

We've moved to a **Pyodide-powered WebAssembly (WASM)** architecture. The entire Python physics engine—ray tracing, Sellmeier dispersion, Monte Carlo tolerance analysis—now runs **directly in the user's browser**. No server. No install. No compromise.

| Before | After |
|--------|-------|
| Python + Node + uvicorn required | **Double-click `index.html`** |
| Designs sent over HTTP | **Calculations in RAM** |
| Network round-trips for every trace | **Zero latency** |

---

## ✨ Key Benefits for Users

### 🚫 No Python/Node Required

Just double-click the `index.html` in the standalone ZIP. The app loads, Pyodide fetches the Python runtime from CDN, and you're designing lenses in seconds. Perfect for students, labs, and non-technical stakeholders.

### 🔒 Air-Gapped Privacy

Optical designs **never leave your local machine**. All ray-trace and Monte Carlo calculations happen in browser RAM. Ideal for proprietary designs, classified work, or simply peace of mind.

### ⚡ Instant Interaction

Zero network latency for ray-tracing and Monte Carlo simulations. Click **Trace** and see results immediately. The physics engine runs in a Web Worker—your UI stays responsive while Python crunches numbers in the background.

---

## 🔧 How to Run

| User Type | Steps |
|-----------|-------|
| **Non-tech** | 1. Download `macoptics-standalone.zip`<br>2. Extract<br>3. Double-click `index.html`<br>4. *(If blocked: run `npx serve .` in the folder, then open the URL)* |
| **Developer** | 1. `cd web-app && npm run build:standalone`<br>2. `npx serve dist` or `cd dist && python -m http.server`<br>3. Open `http://localhost:3000` (or 8000) |
| **Full stack** | 1. Backend: `uvicorn backend.main:app --reload --port 8000`<br>2. Frontend: `cd web-app && npm run dev`<br>3. Open `http://localhost:5173` |

---

## 🤝 Call to Action for Contributors

### 🐍 Pythonistas

The trace engine is now **browser-native**. Help us optimize `web-app/public/pyodide/trace.py`—port more of the rayoptics logic, improve Sellmeier accuracy, or add Gaussian beam propagation. Every line of Python runs in WebAssembly; your expertise shapes the future of in-browser optics.

### ⚛️ Frontend Engineers

The **Neural Link**—our Web Worker bridge in `src/lib/pythonBridge.ts`—connects React to Pyodide. Help refine message passing, error handling, and loading states. We want the transition from "Trace" click to ray visualization to feel instantaneous.

### 📐 Lens-X: The Glue

The **Lens-X** standard holds the ecosystem together. Import/export, coating portability, and manufacturing tolerances all flow through a single JSON schema. See `LENS_X_SPEC.md` and contribute to the interchange format that makes zero-install optics possible.

---

## 📦 What's Included in v2.0

- **Pyodide worker** (`public/pyodide/worker.js`) — Loads Python + NumPy, executes trace
- **In-browser trace** (`public/pyodide/trace.py`) — Paraxial ray trace, Sellmeier, surface profiles
- **Neural Link** (`src/lib/pythonBridge.ts`) — postMessage bridge for React ↔ Python
- **Standalone build** — `npm run build:standalone` and `npm run build:zip`
- **Lens-X** — Full import/export compatibility; no backend required

---

## 🚀 Upgrade Path

| From | To |
|------|-----|
| v1.x (backend-only) | Keep using `npm run dev` + uvicorn; backend unchanged |
| New user | Download ZIP, extract, open `index.html` |
| Contributor | Clone repo, run `npm run build:standalone`, serve `dist/` |

---

*MacOptics v2.0 — Physics at the Edge.*
