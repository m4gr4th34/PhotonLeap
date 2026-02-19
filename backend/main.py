"""
FastAPI backend for optical ray-tracing.
Accepts optical_stack JSON, runs rayoptics trace, returns (z,y) coords for rays and surfaces.
"""

import sys
import os

# NumPy 2.0 fix for rayoptics
import numpy as np
if not hasattr(np, "NaN"):
    np.NaN = np.nan

from typing import Optional, List, Dict, Any

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import after path/numpy setup - backend dir must be on path
_root = os.path.dirname(os.path.abspath(__file__))
if _root not in sys.path:
    sys.path.insert(0, _root)
from trace_service import run_trace, run_chromatic_shift

app = FastAPI(title="Optics Trace API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SurfaceSchema(BaseModel):
    """Surface shape matching frontend (shared keys: id, radius, thickness, material, refractiveIndex, diameter, type, description, tolerances, coating)."""
    id: str
    type: str
    radius: float
    thickness: float
    refractiveIndex: float
    diameter: float
    material: str
    description: str
    radiusTolerance: Optional[float] = None
    thicknessTolerance: Optional[float] = None
    tiltTolerance: Optional[float] = None
    coating: Optional[str] = None


class CoatingItem(BaseModel):
    """Coating for dropdown."""
    name: str
    description: str
    is_hr: bool


@app.get("/api/coatings", response_model=List[CoatingItem])
def get_coatings():
    """
    Return the coating library for the optical design system.
    Used for surface coating dropdown (MgF₂, BBAR, V-Coat, mirrors, HR).
    """
    from coating_engine import get_all_coatings
    coatings = get_all_coatings()
    return [
        CoatingItem(
            name=c.get("name", ""),
            description=c.get("description", ""),
            is_hr=c.get("is_hr", False),
        )
        for c in coatings
    ]


class GlassMaterial(BaseModel):
    """Optical glass material with Sellmeier dispersion."""
    name: str
    dispersion_formula: str
    coefficients: Dict[str, Any]


@app.get("/api/materials", response_model=List[GlassMaterial])
def get_materials():
    """
    Return the material library for the optical design system.
    Includes Sellmeier coefficients for n(λ) calculation.
    """
    from glass_materials import get_all_materials
    materials = get_all_materials()
    return [
        GlassMaterial(
            name=m.get("name", ""),
            dispersion_formula=m.get("dispersion_formula", "constant"),
            coefficients=m.get("coefficients", {}),
        )
        for m in materials
    ]


class OpticalStackRequest(BaseModel):
    """Optical stack from React frontend."""
    surfaces: List[SurfaceSchema]
    entrancePupilDiameter: float = 10
    wavelengths: List[float] = [587.6]
    fieldAngles: List[float] = [0]
    numRays: int = 9
    focusMode: str = "On-Axis"  # 'On-Axis' | 'Balanced'
    m2Factor: float = 1.0  # Laser M² factor for Gaussian beam
    iterations: Optional[int] = None  # Monte Carlo iterations (default 100)


@app.post("/api/trace")
def trace_rays(req: OpticalStackRequest):
    """
    Run ray trace on optical_stack.
    Returns rays as list of [[z,y], ...] polylines, surface curves, focusZ, performance.
    """
    optical_stack = req.model_dump()
    return run_trace(optical_stack)


class ChromaticShiftRequest(OpticalStackRequest):
    """Optical stack + optional wavelength range for chromatic analysis."""
    wavelength_min_nm: float = 400.0
    wavelength_max_nm: float = 1100.0
    wavelength_step_nm: float = 10.0


@app.post("/api/analysis/optimize-colors")
def optimize_colors(req: OpticalStackRequest):
    """
    Local search to find a second glass that, when paired with the current lens
    in a doublet configuration, minimizes Longitudinal Chromatic Aberration
    (BFL_max - BFL_min) between 486 nm and 656 nm.
    Returns: { recommended_glass: str, estimated_lca_reduction: number }
    """
    from optimize_colors import run_optimize_colors
    optical_stack = req.model_dump()
    return run_optimize_colors(optical_stack)


@app.post("/api/analysis/chromatic-shift")
def chromatic_shift(req: ChromaticShiftRequest):
    """
    Chromatic focus shift: for each wavelength in range (default 400–1100 nm, 10 nm steps),
    recalculate refractive index for every lens material via Sellmeier and return
    paraxial focus distance from last surface (BFL).
    Returns: [{ wavelength: number, focus_shift: number }, ...]
    """
    optical_stack = req.model_dump()
    return run_chromatic_shift(
        optical_stack,
        wavelength_min_nm=req.wavelength_min_nm,
        wavelength_max_nm=req.wavelength_max_nm,
        wavelength_step_nm=req.wavelength_step_nm,
    )


@app.post("/api/monte-carlo")
def monte_carlo(req: OpticalStackRequest):
    """
    Run Monte Carlo sensitivity analysis: N iterations with jittered surface
    parameters within tolerances. Returns spot positions at image plane for
    point cloud (spot diagram) visualization.
    """
    from monte_carlo_service import run_monte_carlo
    optical_stack = req.model_dump()
    iterations = optical_stack.pop("iterations", None) or 100
    return run_monte_carlo(optical_stack, iterations=iterations)


@app.post("/api/import/lens-system")
async def import_lens_system(file: UploadFile = File(...)):
    """
    Import lens system from .json (Zemax-style) or .svg file.
    Returns { surfaces: Surface[] } ready for the frontend.
    """
    from optical_importer import import_lens_system as do_import

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    try:
        surfaces = do_import(content, file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except ImportError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"surfaces": surfaces}


@app.get("/api/materials/n")
def get_refractive_index(material: str, wavelength_nm: float):
    """
    Refractive index n at wavelength (nm) for verification.
    Example: ?material=N-BK7&wavelength_nm=587 → n≈1.517
    """
    from glass_materials import refractive_index_at_wavelength
    n = refractive_index_at_wavelength(wavelength_nm, material, 1.5)
    return {"material": material, "wavelength_nm": wavelength_nm, "n": round(n, 6)}
