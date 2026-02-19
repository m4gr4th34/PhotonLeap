"""
Coatings service: Library of optical coatings with reflectivity R(λ).
Each coating stores name, type (AR/HR), and a simplified reflectivity function R(λ).
Used for power-loss calculation in ray tracing and LENS-X export.
"""

from typing import Any, Callable, Dict, List, Optional

# Coating type: AR = anti-reflection (transmit), HR = high-reflectivity (reflect)
COATING_TYPE_AR = "AR"
COATING_TYPE_HR = "HR"

# Coating entry: name, type, description, R(λ) function (lambda_nm -> 0..1)
_COATINGS: Dict[str, Dict[str, Any]] = {}


def _r_mgf2(lam_nm: float) -> float:
    """MgF2 single-layer AR: ~1.3% R at 550 nm."""
    t = lam_nm / 550.0
    return 0.013 * (1.0 + 0.1 * (t - 1) ** 2)


def _r_bbar(lam_nm: float) -> float:
    """BBAR: broadband AR 400–700 nm."""
    if 400 <= lam_nm <= 700:
        return 0.004 + 0.001 * abs(lam_nm - 550) / 150
    return 0.01


def _r_vcoat_532(lam_nm: float) -> float:
    """V-Coat 532 nm: optimized for 532 nm."""
    d = abs(lam_nm - 532)
    return 0.0025 + 0.01 * min(d / 50, 1.0)


def _r_vcoat_1064(lam_nm: float) -> float:
    """V-Coat 1064 nm: optimized for 1064 nm."""
    d = abs(lam_nm - 1064)
    return 0.0025 + 0.01 * min(d / 100, 1.0)


def _r_protected_gold(lam_nm: float) -> float:
    """Protected Gold: ~98% R."""
    return 0.98


def _r_protected_silver(lam_nm: float) -> float:
    """Protected Silver: ~97.5% R."""
    return 0.975


def _r_uncoated(lam_nm: float) -> float:
    """Uncoated: Fresnel ~4%."""
    return 0.04


def _r_hr(lam_nm: float) -> float:
    """HR: >99.5% — reflects instead of refracts."""
    return 0.995


def _init() -> None:
    global _COATINGS
    if _COATINGS:
        return
    _COATINGS["MgF2"] = {
        "name": "MgF2",
        "type": COATING_TYPE_AR,
        "description": "Single-layer MgF₂ AR coating",
        "reflectivity": _r_mgf2,
    }
    _COATINGS["BBAR"] = {
        "name": "BBAR",
        "type": COATING_TYPE_AR,
        "description": "Broadband anti-reflection (400–700 nm)",
        "reflectivity": _r_bbar,
    }
    _COATINGS["V-Coat 532"] = {
        "name": "V-Coat 532",
        "type": COATING_TYPE_AR,
        "description": "V-coat optimized for 532 nm",
        "reflectivity": _r_vcoat_532,
    }
    _COATINGS["V-Coat 1064"] = {
        "name": "V-Coat 1064",
        "type": COATING_TYPE_AR,
        "description": "V-coat optimized for 1064 nm",
        "reflectivity": _r_vcoat_1064,
    }
    _COATINGS["Protected Gold"] = {
        "name": "Protected Gold",
        "type": COATING_TYPE_AR,
        "description": "Protected gold mirror (~98% R)",
        "reflectivity": _r_protected_gold,
    }
    _COATINGS["Protected Silver"] = {
        "name": "Protected Silver",
        "type": COATING_TYPE_AR,
        "description": "Protected silver mirror (~97.5% R)",
        "reflectivity": _r_protected_silver,
    }
    _COATINGS["Uncoated"] = {
        "name": "Uncoated",
        "type": COATING_TYPE_AR,
        "description": "Uncoated (Fresnel ~4% R for glass)",
        "reflectivity": _r_uncoated,
    }
    _COATINGS["None"] = {
        "name": "None",
        "type": COATING_TYPE_AR,
        "description": "Uncoated (Fresnel ~4%)",
        "reflectivity": _r_uncoated,
    }
    _COATINGS["Protected Aluminum"] = {
        "name": "Protected Aluminum",
        "type": COATING_TYPE_AR,
        "description": "Protected aluminum mirror (~92% R)",
        "reflectivity": lambda lam: 0.92,
    }
    _COATINGS["HR"] = {
        "name": "HR",
        "type": COATING_TYPE_HR,
        "description": "High reflectivity mirror (>99.5%) — reflects instead of refracts",
        "reflectivity": _r_hr,
    }


def get_reflectivity(coating_name: Optional[str], lambda_nm: float) -> float:
    """Return R(λ) for coating. Uses uncoated ~4% if unknown."""
    _init()
    if not coating_name or not str(coating_name).strip():
        return _r_uncoated(lambda_nm)
    c = _COATINGS.get(str(coating_name).strip())
    if c is None:
        return _r_uncoated(lambda_nm)
    return float(c["reflectivity"](lambda_nm))


def is_hr_coating(coating_name: Optional[str]) -> bool:
    """True if coating is HR (reflects instead of refracts)."""
    _init()
    if not coating_name or not str(coating_name).strip():
        return False
    c = _COATINGS.get(str(coating_name).strip())
    return c is not None and c.get("type") == COATING_TYPE_HR


def get_all_coatings() -> List[Dict[str, Any]]:
    """Return coating library for dropdown."""
    _init()
    return [
        {
            "name": c["name"],
            "description": c.get("description", ""),
            "is_hr": c.get("type") == COATING_TYPE_HR,
        }
        for c in _COATINGS.values()
    ]
