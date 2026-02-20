# Contributing to MacOptics

Help us push the boundaries of browser-based optical engineering.

---

## The "Neural Link" Architecture

MacOptics uses a **hybrid React–Pyodide** architecture. The React frontend (UI) communicates with the Python physics engine (WASM) through a Web Worker bridge—the **Neural Link**.

```
┌─────────────────────────────────────────────────────────────────┐
│  React (Body)                                                    │
│  OpticalViewport, SystemEditor, etc.                              │
└───────────────────────────┬─────────────────────────────────────┘
                            │ traceViaPyodide()
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  pythonBridge.ts (Nerves)                                        │
│  postMessage({ type: 'trace', payload: optical_stack })           │
└───────────────────────────┬─────────────────────────────────────┘
                            │ postMessage
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  worker.js (Worker)                                              │
│  Loads Pyodide, fetches trace.py, runs Python                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │ pyodide.runPythonAsync()
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  trace.py (Brain)                                                │
│  run_trace(optical_stack) → { rays, surfaces, focusZ, ... }      │
└─────────────────────────────────────────────────────────────────┘
```

**Flow:**

1. User clicks **Trace** → React calls `traceOpticalStack()` in `src/api/trace.ts`.
2. When `VITE_USE_PYODIDE=true`, the API delegates to `traceViaPyodide()` in `pythonBridge.ts`.
3. The bridge posts `{ type: 'trace', id, payload }` to the worker.
4. The worker decodes the payload, calls `run_trace()` in Python, and posts `{ type: 'trace', id, result }` back.
5. The bridge resolves the Promise; React receives the trace result and renders rays in the viewport.

---

## File Map

| Role | Location | Purpose |
|------|----------|---------|
| **Brain** | `web-app/public/pyodide/trace.py` | Python physics: ray trace, Sellmeier, surface profiles |
| **Nerves** | `web-app/src/lib/pythonBridge.ts` | React ↔ Worker bridge; `traceViaPyodide()`, `isPyodideEnabled()` |
| **Worker** | `web-app/public/pyodide/worker.js` | Loads Pyodide, loads `trace.py`, handles `init` / `trace` / `ping` |
| **Body** | `web-app/src/components/` | UI: OpticalViewport, SystemEditor, CoatingLab, etc. |
| **API** | `web-app/src/api/trace.ts` | Chooses Pyodide vs HTTP based on env |
| **Types** | `web-app/src/types/system.ts`, `web-app/src/api/trace.ts` | `TraceResult`, `TraceResponse` |

---

## Core Guidelines

### Python Changes

Any changes to the **physics logic** must be made in `web-app/public/pyodide/trace.py`.

- You only have access to libraries supported by Pyodide: **numpy**, **scipy**, and the [Pyodide package index](https://pyodide.org/en/stable/usage/packages-in-pyodide.html).
- Avoid `rayoptics` and other heavy packages—they may not be available. The current engine uses a simplified paraxial trace with Snell's law.
- The `run_trace(optical_stack)` function must return a dict matching the `TraceResponse` shape (see Type Safety below).

### Type Safety

Changes to **data shapes** must be updated in **both** places:

1. **Python** — The dict returned by `run_trace()` in `trace.py`.
2. **TypeScript** — The interfaces in `src/types/system.ts` (`TraceResult`) and `src/api/trace.ts` (`TraceResponse`).

Example: if you add `chromaticAberration` to the trace result:

- In `trace.py`: `return { ..., "chromaticAberration": [...] }`
- In `src/api/trace.ts`: `export type TraceResponse = { ... chromaticAberration?: number[] }`
- In `src/types/system.ts`: Add to `TraceResult` if used in UI state.

### Testing

New physics features require an updated test in `web-app/tests/pyodide-engine.spec.ts`.

- This Playwright spec runs the app in Pyodide mode and verifies that the trace produces valid rays and surfaces.
- Add assertions for new fields (e.g. `chromaticAberration`) when you extend the trace output.

---

## Development Workflow (Pyodide Mode)

```bash
# 1. Build with Pyodide enabled
cd web-app
VITE_USE_PYODIDE=true npm run build

# 2. Serve the dist folder (required for workers)
npx serve dist
# or: cd dist && python -m http.server 8000

# 3. Open http://localhost:3000 (or 8000)
```

For **live reload** during development, you can run the dev server with Pyodide env:

```bash
cd web-app
VITE_USE_PYODIDE=true npm run dev
```

Then open `http://localhost:5173`. The worker will load from the dev server; ensure `public/pyodide/` is accessible.

---

## Lens-X

The **Lens-X** interchange format (`LENS_X_SPEC.md`) is the glue holding the ecosystem together. Import/export, coating portability, and manufacturing tolerances all flow through a single JSON schema. When extending the trace or UI, keep Lens-X compatibility in mind.

---

## Questions?

Open an issue or discussion on GitHub. We welcome contributions from Pythonistas, frontend engineers, and optical designers alike.
