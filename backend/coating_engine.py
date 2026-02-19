"""
CoatingEngine: Library of optical coatings with reflectivity R(λ).
Used for power-loss calculation in ray tracing.
"""

from typing import Any, Dict, List, Optional

# Coating library: name -> R(λ) function (lambda_nm -> reflectivity 0..1)
# R(λ) = reflectivity at wavelength λ (nm)

_COATINGS: Dict[str, Dict[str, Any]] = {}


def _r_mgf2(lambda_nm: float) -> float:
    """MgF2 single-layer AR: ~1.3% R at 550 nm, low across visible."""
    lam = lambda_nm / 550.0
    return 0.013 * (1.0 + 0.1 * (lam - 1) ** 2)


def _r_bbar(lambda_nm: float) -> float:
    """Broadband AR: <0.5% across 400–700 nm."""
    if 400 <= lambda_nm <= 700:
        return 0.004 + 0.001 * abs(lambda_nm - 550) / 150
    return 0.01


def _r_vcoat_532(lambda_nm: float) -> float:
    """V-Coat 532: optimized for 532 nm, R < 0.25% at 532."""
    d = abs(lambda_nm - 532)
    return 0.0025 + 0.01 * min(d / 50, 1.0)


def _r_vcoat_1064(lambda_nm: float) -> float:
    """V-Coat 1064: optimized for 1064 nm."""
    d = abs(lambda_nm - 1064)
    return 0.0025 + 0.01 * min(d / 100, 1.0)


def _r_protected_silver(lambda_nm: float) -> float:
    """Protected Silver: ~97.5% R in visible/NIR."""
    return 0.975


def _r_protected_gold(lambda_nm: float) -> float:
    """Protected Gold: ~98% R, better in IR."""
    return 0.98


def _r_protected_aluminum(lambda_nm: float) -> float:
    """Protected Aluminum: ~92% R in visible."""
    return 0.92


def _r_hr(lambda_nm: float) -> float:
    """HR (High Reflectivity): >99.5% — ray reflects instead of refracts."""
    return 0.995


def _r_none(lambda_nm: float) -> float:
    """No coating: Fresnel ~4% per surface (simplified)."""
    return 0.04


def _init_coatings() -> None:
    global _COATINGS
    if _COATINGS:
        return
    _COATINGS["None"] = {
        "name": "None",
        "description": "Uncoated (Fresnel ~4%)",
        "reflectivity": _r_none,
        "is_hr": False,
    }
    _COATINGS["MgF2"] = {
        "name": "MgF2",
        "description": "Single-layer MgF₂ AR coating",
        "reflectivity": _r_mgf2,
        "is_hr": False,
    }
    _COATINGS["BBAR"] = {
        "name": "BBAR",
        "description": "Broadband anti-reflection (400–700 nm)",
        "reflectivity": _r_bbar,
        "is_hr": False,
    }
    _COATINGS["V-Coat 532"] = {
        "name": "V-Coat 532",
        "description": "V-coat optimized for 532 nm",
        "reflectivity": _r_vcoat_532,
        "is_hr": False,
    }
    _COATINGS["V-Coat 1064"] = {
        "name": "V-Coat 1064",
        "description": "V-coat optimized for 1064 nm",
        "reflectivity": _r_vcoat_1064,
        "is_hr": False,
    }
    _COATINGS["Protected Silver"] = {
        "name": "Protected Silver",
        "description": "Protected silver mirror (~97.5% R)",
        "reflectivity": _r_protected_silver,
        "is_hr": False,
    }
    _COATINGS["Protected Gold"] = {
        "name": "Protected Gold",
        "description": "Protected gold mirror (~98% R)",
        "reflectivity": _r_protected_gold,
        "is_hr": False,
    }
    _COATINGS["Protected Aluminum"] = {
        "name": "Protected Aluminum",
        "description": "Protected aluminum mirror (~92% R)",
        "reflectivity": _r_protected_aluminum,
        "is_hr": False,
    }
    _COATINGS["HR"] = {
        "name": "HR",
        "description": "High reflectivity mirror (>99.5%) — reflects instead of refracts",
        "reflectivity": _r_hr,
        "is_hr": True,
    }


def get_reflectivity(coating_name: Optional[str], lambda_nm: float) -> float:
    """
    Return R(λ) for coating. 0 if coating is None or unknown.
    """
    _init_coatings()
    if not coating_name or not str(coating_name).strip():
        return _r_none(lambda_nm)
    c = _COATINGS.get(str(coating_name).strip())
    if c is None:
        return _r_none(lambda_nm)
    return float(c["reflectivity"](lambda_nm))


def is_hr_coating(coating_name: Optional[str]) -> bool:
    """True if coating is HR (reflects instead of refracts)."""
    _init_coatings()
    if not coating_name or not str(coating_name).strip():
        return False
    c = _COATINGS.get(str(coating_name).strip())
    return c is not None and c.get("is_hr", False)


def get_all_coatings() -> List[Dict[str, Any]]:
    """Return coating library for dropdown."""
    _init_coatings()
    return [
        {
            "name": c["name"],
            "description": c.get("description", ""),
            "is_hr": c.get("is_hr", False),
        }
        for c in _COATINGS.values()
    ]
