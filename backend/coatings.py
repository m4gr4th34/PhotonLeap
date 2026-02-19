"""
Coatings service: Backward-compatible wrapper around CoatingService.
Import from coating_service for new code. Uses comprehensive 50+ coating library
and user-defined coatings from database.
"""

from typing import Any, Dict, List, Optional

from coating_service import CoatingService, get_coating_service, _interpolate_table
from coating_db import get_all_user_coatings

# Re-export for compatibility
COATING_TYPE_AR = "AR"
COATING_TYPE_HR = "HR"


def reflectivity_from_surface(surface: Dict[str, Any], lambda_nm: float) -> Optional[float]:
    """
    If surface has inline coating data (coating_r_table or coating_constant_r), return R(λ).
    Otherwise return None so caller uses get_reflectivity by name.
    """
    table = surface.get("coating_r_table") or surface.get("coatingRTable") or surface.get("coatingDataPoints")
    if table and isinstance(table, list) and len(table) > 0:
        pts = [
            {"wavelength": float(p.get("wavelength", 0)), "reflectivity": float(p.get("reflectivity", 0))}
            for p in table
            if isinstance(p, dict)
        ]
        if pts:
            return float(_interpolate_table(pts, lambda_nm))
    cv = surface.get("coating_constant_r") or surface.get("coatingConstantR") or surface.get("coatingConstantValue")
    if cv is not None:
        return float(cv)
    return None


def is_hr_from_surface(surface: Dict[str, Any]) -> Optional[bool]:
    """
    If surface has inline coating_is_hr, return it. Otherwise return None.
    """
    val = surface.get("coating_is_hr") or surface.get("coatingIsHr")
    if val is not None:
        return bool(val)
    return None


def get_reflectivity(coating_name: Optional[str], lambda_nm: float) -> float:
    """Return R(λ) for coating. Uses uncoated ~4% if unknown."""
    user = get_all_user_coatings()
    svc = get_coating_service(user)
    return svc.get_reflectivity(coating_name, lambda_nm)


def is_hr_coating(coating_name: Optional[str]) -> bool:
    """True if coating is HR (reflects instead of refracts)."""
    user = get_all_user_coatings()
    svc = get_coating_service(user)
    return svc.is_hr_coating(coating_name)


def get_all_coatings() -> List[Dict[str, Any]]:
    """Return coating library for dropdown (built-in + user)."""
    user = get_all_user_coatings()
    svc = get_coating_service(user)
    lib = svc.get_library()
    return [
        {"name": c["name"], "description": c.get("description", ""), "is_hr": c.get("is_hr", False)}
        for c in lib
    ]
