# LENS-X Schema Definition

> **⚠️ GROUND TRUTH FOR AI DEVELOPERS**  
> This document is the authoritative specification for the LENS-X optical lens interchange format. Any changes to import/export logic in `web-app/src/lib/lensX.ts`, `backend/optical_importer.py`, `backend/lens_x_export.py`, or related modules **must be reflected here first**. Keep this spec in sync with implementation.

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/export/lens-x` | POST | Generate LENS-X JSON from optical stack. Request: `{ surfaces, projectName?, date?, drawnBy?, entrancePupilDiameter }`. Every surface exports radius, thickness, material, coating. |
| `/api/import/lens-system` | POST | Import lens system from .json or .svg. Prioritizes LENS-X; loads sellmeier and coating directly when present. |

---

## Units

| Quantity | Unit | Notes |
|----------|------|-------|
| **Geometry** (radius, thickness, aperture, diameter) | **millimeters (mm)** | All linear dimensions |
| **Wavelength** (λ in Sellmeier, dispersion) | **micrometers (µm)** | Unless otherwise specified; e.g. 0.5876 µm = 587.6 nm |
| **Wavelength** (in API/trace context) | nanometers (nm) | Backend trace uses nm; convert to µm for Sellmeier |
| **Angles** (tilt tolerance) | degrees (°) | Manufacturing tilt tolerance |

---

## Document Structure

```json
{
  "lens_x_version": "1.0",
  "metadata": {
    "project_name": "string",
    "date": "YYYY-MM-DD",
    "drawn_by": "string"
  },
  "optics": {
    "surfaces": [ /* LensXSurface[] */ ],
    "entrance_pupil_diameter": 10
  },
  "geometry": {
    "svg_path": "string"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `lens_x_version` | string | Yes | Schema version; `"1.0"` |
| `metadata` | object | No | Project metadata |
| `metadata.project_name` | string | No | Project title |
| `metadata.date` | string | No | ISO date |
| `metadata.drawn_by` | string | No | Author/tool name |
| `optics` | object | Yes | Optical definition |
| `optics.surfaces` | array | Yes | Ordered list of surfaces |
| `optics.entrance_pupil_diameter` | number | No | mm; default 10 |
| `geometry` | object | No | 2D representation |
| `geometry.svg_path` | string | No | Full SVG markup (ISO 10110 blueprint) |

---

## Geometry (per surface)

All geometric values are in **millimeters (mm)**.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `radius` | number | Yes | Radius of curvature (mm). Use `0` or `"infinity"`/`"inf"`/`"flat"` for plano |
| `thickness` | number | Yes | Center thickness to next surface (mm) |
| `aperture` | number | Yes | **Semi-diameter** (half of clear aperture) in mm. Diameter = 2 × aperture |

**Strict types:**
- `radius`: `number` — positive = convex toward +z, negative = concave
- `thickness`: `number` — ≥ 0
- `aperture`: `number` — > 0; typically 12.5 mm default (25 mm diameter)

---

## Physics (per surface)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `material` | string | Yes | Glass name (e.g. `"N-BK7"`, `"Fused Silica"`) or `"Air"` |
| `type` | `"Glass"` \| `"Air"` | No | Default `"Glass"` if n > 1.01 |
| `description` | string | No | Human-readable label |
| `physics` | object | No | Dispersion and coating |
| `physics.sellmeier` | object | No | Sellmeier coefficients for n(λ) |
| `physics.sellmeier.B` | number[] | No | B₁, B₂, B₃ (length 3) |
| `physics.sellmeier.C` | number[] | No | C₁, C₂, C₃ (length 3); λ in µm |
| `physics.refractive_index` | number | No | n at reference λ if no Sellmeier |
| `physics.coating` | string | No | Coating ID (e.g. `"MgF2"`, `"BBAR"`, `"Uncoated"`) |

### Sellmeier Equation

```
n²(λ) = 1 + Σᵢ Bᵢ λ² / (λ² − Cᵢ)
```

- **λ in micrometers (µm)**. Convert nm → µm: `λ_µm = λ_nm × 10⁻³`
- B and C are dimensionless; C typically in µm²
- If `physics.sellmeier` is present, it overrides `refractive_index` for dispersion
- If material is in glass library and no Sellmeier given, use library coefficients

### Coating

- Values: `"Uncoated"`, `"None"`, `"MgF2"`, `"BBAR"`, `"V-Coat 532"`, `"V-Coat 1064"`, `"Protected Silver"`, `"Protected Gold"`, `"Protected Aluminum"`, `"HR"`
- `"HR"` → surface reflects instead of refracts (mirror)
- Affects power loss: P_new = P_old × (1 − R(λ)) for transmit; P_new = P_old × R(λ) for HR

---

## Manufacturing (ISO 10110 mapping)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `manufacturing` | object | No | ISO 10110 manufacturing data |
| `manufacturing.surface_quality` | string | No | Scratch/dig per ISO 10110; e.g. `"3/2"` |
| `manufacturing.radius_tolerance` | number | No | ± radius tolerance (mm) |
| `manufacturing.thickness_tolerance` | number | No | ± thickness tolerance (mm) |
| `manufacturing.tilt_tolerance` | number | No | ± tilt tolerance (degrees) |

### ISO 10110 Surface Quality

- Format: `"S/D"` or `"S/D(tolerance)"` — e.g. `"3/2"`, `"3/2(0.5)"`
- S = scratch width (µm), D = dig diameter (0.1 mm)
- Tolerance in mm when specified

---

## LensXSurface (strict type)

```typescript
interface LensXSurface {
  radius: number           // mm
  thickness: number       // mm
  aperture: number        // mm (semi-diameter)
  material: string
  type?: 'Glass' | 'Air'
  description?: string
  physics?: {
    sellmeier?: { B: number[]; C: number[] }
    refractive_index?: number
    coating?: string
  }
  manufacturing?: {
    surface_quality?: string
    radius_tolerance?: number
    thickness_tolerance?: number
    tilt_tolerance?: number
  }
}
```

---

## Import/Export Mapping

| LENS-X | Internal (Surface) |
|--------|-------------------|
| `radius` | `radius` |
| `thickness` | `thickness` |
| `aperture` | `diameter / 2` (diameter = 2 × aperture) |
| `material` | `material` |
| `type` | `type` |
| `physics.sellmeier` | `sellmeierCoefficients` |
| `physics.refractive_index` | `refractiveIndex` (fallback) |
| `physics.coating` | `coating` |
| `manufacturing.surface_quality` | `surfaceQuality` |
| `manufacturing.radius_tolerance` | `radiusTolerance` |
| `manufacturing.thickness_tolerance` | `thicknessTolerance` |
| `manufacturing.tilt_tolerance` | `tiltTolerance` |

---

## Detection

A JSON document is LENS-X if:
- `lens_x_version` is present, or
- `optics` exists and `optics.surfaces` is an array

---

## Example

```json
{
  "lens_x_version": "1.0",
  "metadata": {
    "project_name": "Singlet 100mm",
    "date": "2026-02-15",
    "drawn_by": "MacOptics"
  },
  "optics": {
    "surfaces": [
      {
        "radius": 100,
        "thickness": 5,
        "aperture": 12.5,
        "material": "N-BK7",
        "type": "Glass",
        "description": "Front surface",
        "physics": {
          "refractive_index": 1.5168,
          "coating": "MgF2"
        },
        "manufacturing": {
          "surface_quality": "3/2",
          "radius_tolerance": 0.1,
          "thickness_tolerance": 0.05
        }
      },
      {
        "radius": -100,
        "thickness": 95,
        "aperture": 12.5,
        "material": "Air",
        "type": "Air",
        "description": "Back surface"
      }
    ],
    "entrance_pupil_diameter": 10
  },
  "geometry": {
    "svg_path": "<svg>...</svg>"
  }
}
```
