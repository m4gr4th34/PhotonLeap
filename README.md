<div align="center">
  <a href="http://localhost:5173">
    <img src="assets/banner.png" alt="MacOptics" width="100%" style="max-width: 100%;" />
  </a>
  <br /><br />
  <a href="http://localhost:5173" style="display: inline-block; background: linear-gradient(135deg, #22D3EE 0%, #6366F1 100%); color: white; font-weight: bold; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-decoration: none; border-radius: 8px; padding: 12px 24px; margin: 20px 0;">
    🚀 View Live Demo
  </a>
  <br /><br /><br />
</div>

<br /><br />

# MacOptics — Optical Ray Tracing

Open-source, license-free optical design software with a **React + FastAPI** architecture. Design singlet lenses, run ray traces, and visualize performance metrics.

![Lens Designer screenshot](docs/screenshot.png)

---

## Tech Stack

![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-38B2AC?style=flat-square&logo=tailwind-css)
![Framer Motion](https://img.shields.io/badge/Framer_Motion-11-0055FF?style=flat-square&logo=framer)
![FastAPI](https://img.shields.io/badge/FastAPI-0.109-009688?style=flat-square&logo=fastapi)
![NumPy](https://img.shields.io/badge/NumPy-2-013243?style=flat-square&logo=numpy)

**Platform Support** — Dynamic Alt / ⌥ Option key labels for Override Snap-to-Focus; adapts to Windows and macOS.

---

## Project Goals

- Deliver a modern, free optical design tool for students, researchers, and small teams
- Bridge laser and ultrafast optics (Gaussian beams, dispersion) with manufacturing-grade reliability analysis
- Provide a clean workflow from design through trace to ISO 10110 export—without vendor lock-in

---

## 🚀 Powered by Lens-X

MacOptics uses **Lens-X**, a physics-aware optical interchange format that goes beyond legacy ISO 10110 flat drawings. Instead of a static blueprint, Lens-X embeds geometry, glass chemistry (Sellmeier), coating data, and manufacturing tolerances in a single JSON file—enabling a true **Digital Twin** of your optical system.

| Aspect | Legacy ISO 10110 | Lens-X (Digital Twin) |
|--------|------------------|------------------------|
| **Output** | Flat 2D drawing (SVG/PDF) | JSON + optional drawing |
| **Geometry** | Cross-section only | Radius, thickness, aperture (mm) |
| **Glass** | Material name only | Sellmeier coefficients for n(λ) |
| **Coatings** | Not specified | MgF₂, BBAR, V-Coat, mirrors, HR |
| **Tolerances** | S/D, R±, T± in drawing | Structured in `manufacturing` |
| **Reusability** | Manual re-entry | Import → trace → export round-trip |
| **Simulation** | Requires separate tools | Same file drives ray trace |

Export your design as Lens-X JSON to share a complete, executable specification. Import Lens-X files to restore geometry, materials, and coatings without re-typing. See `LENS_X_SPEC.md` for the schema.

---

## 🌈 Coating Lab & Spectral Analysis

The **Coating Lab** is a professional-grade suite for managing thin-film performance.

**Features**

- **Pre-populated catalog** — 50+ coatings across AR, HR, metallic mirrors, beamsplitters, and dichroics (V-Coat, BBAR, Protected Silver/Gold/Aluminum, notch filters)
- **Custom wizard** — Define user coatings from CSV spectral data; constant R or wavelength-dependent R(λ) tables
- **Live graphing** — R(λ) curves visualized in the coating dropdown; reflectivity at primary wavelength
- **Ray-trace integration** — Power loss per surface: I_new = I_old × (1 − R); HR coatings follow reflected ray
- **Full portability** — Custom R(λ) tables embedded in Lens-X export; projects work on any machine without local coating library

| Capability | Standard (Catalog) | Custom (Wizard) |
|------------|-------------------|-----------------|
| **Source** | Built-in library | CSV upload, constant R |
| **R(λ)** | Analytic formulas | Table interpolation |
| **Lens-X export** | Coating name only | Full R(λ) table serialized |
| **Use case** | Quick design, common coatings | Measured data, proprietary specs |

**Engineering impact** — The Coating Lab allows designers to move beyond geometric optics and account for energy loss and spectral filtering, essential for high-power laser and multi-spectral sensor design.

---

## Installation

**Backend (FastAPI / Python)**

```bash
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

**Frontend (Vite / React)**

```bash
cd web-app
npm install
```

### Quick Start

Run both services in two terminal windows:

```bash
# Terminal 1 — Backend
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

```bash
# Terminal 2 — Frontend
cd web-app && npm run dev
```

Then open **http://localhost:5173**

---

## Killer Features

Once you're up and running, here's what you get:

- **High-precision ray tracing** — Sequential ray optics via rayoptics; spot diagrams, RMS radius, and focus metrics at the image plane
- **Real-time SVG viewport** — Interactive cross-section with zoom, pan, and through-focus scan line; dynamic optical_stack management
- **Gaussian beam propagation** — Beam waist (w₀), Rayleigh range (z_R), M² analysis; ABCD matrix envelope visualization
- **Femtosecond dispersion** — GDD/TOD in the Ultrafast HUD; thermal lensing heat map for high-power CW
- **Monte Carlo reliability** — Tolerance jitter (R±, T±, Tilt±); point cloud yield map; sensitivity heatmap in System Editor
- **ISO 10110 export** — Cross-section, dimension lines (CT), data table (Surf, S/D, Material), title block; SVG and PDF
- **Magnetic snapping** — Scan line snaps to best focus and surface boundaries; Space+Drag pan; platform-aware Alt/⌥ keybindings

---

## Architecture

```
MacOpticsApp/
├── backend/                 # FastAPI Python backend
│   ├── main.py              # API routes, CORS, request models
│   ├── trace_service.py     # Ray-tracing logic (rayoptics)
│   └── singlet_rayoptics.py # Optical model building
├── web-app/                 # React + Vite frontend
│   └── src/
│       ├── components/      # UI components
│       ├── api/             # Trace API client
│       ├── types/           # TypeScript types
│       ├── lib/             # Materials, config
│       └── config.ts        # App settings
├── tests/                   # Pytest integration tests
├── requirements.txt         # Python dependencies
└── README_API.md            # API reference
```

### Frontend (React + Vite)

- **Lens Designer** — Canvas with optical viewport; add/edit/reorder surfaces, run trace
- **System Editor** — Table of surfaces (radius, thickness, material, diameter)
- **System Properties** — Entrance pupil, wavelengths, field angles, ray count
- **State** — Single source of truth in `App.tsx`; surfaces identified by unique `id`

### Backend (FastAPI)

- **POST /api/trace** — Accepts `optical_stack` JSON, runs rayoptics, returns rays and surface curves as `(z, y)` coordinates
- **GET /api/health** — Health check
- Uses `rayoptics` for sequential ray tracing and spot diagrams

### Data Flow

1. User edits surfaces in React → state updates
2. User clicks **Trace** → frontend sends `optical_stack` to `/api/trace`
3. Backend builds optical model, traces rays, returns `{ rays, surfaces, focusZ, performance }`
4. Frontend renders rays and lens profiles in SVG viewport

## Configuration

- **API URL** — Set `VITE_API_URL` (default: `http://localhost:8000`) or edit `web-app/src/config.ts`
- **Viewport / ray defaults** — See `web-app/src/config.ts`

## Tests

```bash
pytest tests/ -v
```

## API Details

See [README_API.md](README_API.md) for endpoint specs and response format.
