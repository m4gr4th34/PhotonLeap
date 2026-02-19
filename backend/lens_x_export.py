"""
LENS-X export: Generate valid LENS-X JSON from optical stack.
Ensures every surface exports radius, thickness, material, and coating.
See LENS_X_SPEC.md for schema.
"""

from typing import Any, Dict, List, Optional
from datetime import date


def _surface_to_lens_x(s: Dict[str, Any]) -> Dict[str, Any]:
    """
    Map internal Surface to LENS-X surface.
    Crucially: always include radius, thickness, material, coating.
    """
    radius = float(s.get("radius") if s.get("radius") is not None else 0)
    thickness = float(s.get("thickness") if s.get("thickness") is not None else 0)
    diameter = float(s.get("diameter") if s.get("diameter") is not None else 25)
    aperture = diameter / 2.0
    material = str(s.get("material") or (s.get("type") == "Air" and "Air") or "N-BK7")
    surf_type = "Air" if (s.get("type") == "Air" or material == "Air") else "Glass"
    description = str(s.get("description") or "")

    physics: Dict[str, Any] = {}
    if s.get("refractiveIndex") is not None:
        physics["refractive_index"] = float(s["refractiveIndex"])
    if s.get("sellmeierCoefficients") and isinstance(s["sellmeierCoefficients"], dict):
        physics["sellmeier"] = s["sellmeierCoefficients"]
    if s.get("coating") and str(s["coating"]).strip():
        physics["coating"] = str(s["coating"]).strip()

    manufacturing: Dict[str, Any] = {}
    if s.get("surfaceQuality") is not None:
        manufacturing["surface_quality"] = str(s["surfaceQuality"])
    if s.get("radiusTolerance") is not None:
        manufacturing["radius_tolerance"] = float(s["radiusTolerance"])
    if s.get("thicknessTolerance") is not None:
        manufacturing["thickness_tolerance"] = float(s["thicknessTolerance"])
    if s.get("tiltTolerance") is not None:
        manufacturing["tilt_tolerance"] = float(s["tiltTolerance"])

    out: Dict[str, Any] = {
        "radius": radius,
        "thickness": thickness,
        "aperture": aperture,
        "material": material,
        "type": surf_type,
        "description": description,
    }
    if physics:
        out["physics"] = physics
    if manufacturing:
        out["manufacturing"] = manufacturing
    return out


def to_lens_x(
    surfaces: List[Dict[str, Any]],
    *,
    project_name: str = "Untitled",
    date_str: Optional[str] = None,
    drawn_by: str = "MacOptics",
    entrance_pupil_diameter: float = 10,
) -> Dict[str, Any]:
    """
    Generate LENS-X JSON document.
    Every surface has radius, thickness, material, coating (when present).
    """
    date_str = date_str or str(date.today())
    lens_surfaces = [_surface_to_lens_x(s) for s in surfaces]
    return {
        "lens_x_version": "1.0",
        "metadata": {
            "project_name": project_name,
            "date": date_str,
            "drawn_by": drawn_by,
        },
        "optics": {
            "surfaces": lens_surfaces,
            "entrance_pupil_diameter": entrance_pupil_diameter,
        },
        "geometry": {"svg_path": ""},
    }
