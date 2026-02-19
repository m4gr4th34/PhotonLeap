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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import after path/numpy setup - backend dir must be on path
_root = os.path.dirname(os.path.abspath(__file__))
if _root not in sys.path:
    sys.path.insert(0, _root)
from trace_service import run_trace

app = FastAPI(title="Optics Trace API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SurfaceSchema(BaseModel):
    """Surface shape matching frontend (shared keys: id, radius, thickness, material, refractiveIndex, diameter, type, description, tolerances)."""
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


@app.get("/api/health")
def health():
    return {"status": "ok"}
