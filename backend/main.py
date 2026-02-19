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
    """Surface shape matching frontend (shared keys: id, radius, thickness, material, refractiveIndex, diameter, type, description, tolerances, coating, sellmeierCoefficients, surfaceQuality). Inline coating data for portability: coating_r_table, coating_constant_r, coating_is_hr."""
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
    sellmeierCoefficients: Optional[Dict[str, Any]] = None
    surfaceQuality: Optional[str] = None
    coating_r_table: Optional[List[Dict[str, float]]] = None
    coating_constant_r: Optional[float] = None
    coating_is_hr: Optional[bool] = None


class CoatingItem(BaseModel):
    """Coating for dropdown."""
    name: str
    description: str
    is_hr: bool


class CoatingLibraryItem(BaseModel):
    """Coating with category and source for library view."""
    name: str
    category: str
    description: str
    is_hr: bool
    source: str  # "builtin" | "custom"


class UserCoatingCreate(BaseModel):
    """Request body for creating a user-defined coating."""
    name: str
    category: str = "Custom"
    data_type: str  # "constant" | "table"
    constant_value: Optional[float] = None  # for data_type=constant
    data_points: Optional[List[Dict[str, float]]] = None  # [{wavelength, reflectivity}, ...] for data_type=table
    description: str = ""
    is_hr: bool = False


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


@app.get("/api/coatings/library", response_model=List[CoatingLibraryItem])
def get_coatings_library():
    """
    Return full coating library (50+ built-in + user-defined) with category and source.
    """
    from coating_service import get_coating_service
    from coating_db import get_all_user_coatings
    user = get_all_user_coatings()
    svc = get_coating_service(user)
    lib = svc.get_library()
    return [
        CoatingLibraryItem(
            name=c.get("name", ""),
            category=c.get("category", "Custom"),
            description=c.get("description", ""),
            is_hr=c.get("is_hr", False),
            source=c.get("source", "builtin"),
        )
        for c in lib
    ]


@app.post("/api/coatings/custom")
def create_custom_coating(req: UserCoatingCreate):
    """
    Save a new user-defined coating. data_type: 'constant' (single R value) or 'table' (wavelength/reflectivity pairs).
    """
    from coating_db import insert_user_coating
    if req.data_type not in ("constant", "table"):
        raise HTTPException(status_code=400, detail="data_type must be 'constant' or 'table'")
    if req.data_type == "constant":
        if req.constant_value is None:
            raise HTTPException(status_code=400, detail="constant_value required for data_type=constant")
        val = max(0.0, min(1.0, float(req.constant_value)))
        created = insert_user_coating(
            name=req.name,
            category=req.category,
            data_type="constant",
            constant_value=val,
            description=req.description,
            is_hr=req.is_hr,
        )
    else:
        if not req.data_points or not isinstance(req.data_points, list):
            raise HTTPException(status_code=400, detail="data_points required for data_type=table (list of {wavelength, reflectivity})")
        pts = []
        for p in req.data_points:
            if isinstance(p, dict) and "wavelength" in p and "reflectivity" in p:
                pts.append({
                    "wavelength": float(p["wavelength"]),
                    "reflectivity": max(0.0, min(1.0, float(p["reflectivity"]))),
                })
        if not pts:
            raise HTTPException(status_code=400, detail="At least one valid data point required")
        created = insert_user_coating(
            name=req.name,
            category=req.category,
            data_type="table",
            data_points=pts,
            description=req.description,
            is_hr=req.is_hr,
        )
    return created


@app.get("/api/coatings/{coating_name}/reflectivity")
def get_coating_reflectivity(
    coating_name: str,
    min_nm: float = 400.0,
    max_nm: float = 700.0,
    step_nm: float = 5.0,
):
    """
    Return R(λ) curve for a coating across wavelength range.
    Used for reflectivity graph in coating dropdown.
    """
    from coating_engine import get_reflectivity
    points = []
    w = min_nm
    while w <= max_nm:
        r = get_reflectivity(coating_name or None, w)
        points.append({"wavelength": round(w, 1), "reflectivity": round(r, 6)})
        w += step_nm
    return {"coating": coating_name, "points": points}


@app.get("/api/coatings/{coating_name}/definition")
def get_coating_definition(coating_name: str):
    """
    Return full definition for a custom coating (data_type, constant_value, data_points, is_hr).
    Used by Lens-X export to embed custom R(λ) tables for portability.
    Returns 404 if coating is built-in or not found.
    """
    from coating_db import get_coating_by_name
    definition = get_coating_by_name(coating_name)
    if definition is None:
        raise HTTPException(status_code=404, detail=f"Custom coating '{coating_name}' not found")
    return {
        "name": definition["name"],
        "data_type": definition["data_type"],
        "constant_value": definition.get("constant_value"),
        "data_points": definition.get("data_points"),
        "is_hr": definition.get("is_hr", False),
    }


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


class LensXExportRequest(BaseModel):
    """Request body for LENS-X export."""
    surfaces: List[SurfaceSchema]
    projectName: Optional[str] = "Untitled"
    date: Optional[str] = None
    drawnBy: Optional[str] = "MacOptics"
    entrancePupilDiameter: float = 10


@app.post("/api/export/lens-x")
def export_lens_x(req: LensXExportRequest):
    """
    Generate valid LENS-X JSON from optical stack.
    Every surface exports radius, thickness, material, and coating.
    """
    from lens_x_export import to_lens_x
    from datetime import date
    surfaces = [s.model_dump() for s in req.surfaces]
    return to_lens_x(
        surfaces,
        project_name=req.projectName or "Untitled",
        date_str=req.date or str(date.today()),
        drawn_by=req.drawnBy or "MacOptics",
        entrance_pupil_diameter=req.entrancePupilDiameter,
    )


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
