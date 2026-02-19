"""
CoatingService: Comprehensive coating library with 50+ standard coatings.
Pre-populated with AR, HR, beamsplitters, and specialty coatings.
Merges built-in library with user-defined coatings from database.
"""

from typing import Any, Callable, Dict, List, Optional

# Coating categories
CATEGORY_AR = "AR"
CATEGORY_HR = "HR"
CATEGORY_BEAMSPLITTER = "Beamsplitter"
CATEGORY_SPECIALTY = "Specialty"
CATEGORY_BASE = "Base"

# Data types for custom coatings
DATA_TYPE_CONSTANT = "constant"
DATA_TYPE_TABLE = "table"


def _r_mgf2(lam: float) -> float:
    """MgF2 single-layer AR: ~1.3% R at 550 nm."""
    t = lam / 550.0
    return 0.013 * (1.0 + 0.1 * (t - 1) ** 2)


def _r_bbar(lam: float) -> float:
    """BBAR: broadband AR 400–700 nm."""
    if 400 <= lam <= 700:
        return 0.004 + 0.001 * abs(lam - 550) / 150
    return 0.01


def _r_uv_ar(lam: float) -> float:
    """UV-AR: 250–400 nm."""
    if 250 <= lam <= 400:
        return 0.003 + 0.002 * abs(lam - 325) / 75
    return 0.02


def _r_ir_ar(lam: float) -> float:
    """IR-AR: 700–2000 nm."""
    if 700 <= lam <= 2000:
        return 0.005 + 0.003 * abs(lam - 1350) / 650
    return 0.02


def _r_vcoat(lam: float, center: float, half_width: float = 50) -> float:
    """Generic V-coat: low R at center wavelength."""
    d = abs(lam - center)
    return 0.0025 + 0.01 * min(d / half_width, 1.0)


def _r_hr(lam: float) -> float:
    """HR: >99.5%."""
    return 0.995


def _r_protected_al(lam: float) -> float:
    """Protected Aluminum: ~92% R."""
    return 0.92


def _r_enhanced_silver(lam: float) -> float:
    """Enhanced Silver: ~98.5% R."""
    return 0.985


def _r_protected_gold(lam: float) -> float:
    """Protected Gold: ~98% R."""
    return 0.98


def _r_uncoated(lam: float) -> float:
    """Uncoated: Fresnel ~4%."""
    return 0.04


def _r_beamsplitter(lam: float, r_target: float) -> float:
    """Beamsplitter with target R (rest is T)."""
    return r_target


def _r_hot_mirror(lam: float) -> float:
    """Hot mirror: reflects IR (700+ nm), transmits visible."""
    if lam >= 700:
        return 0.95
    return 0.02


def _r_cold_mirror(lam: float) -> float:
    """Cold mirror: reflects visible (400–700 nm), transmits IR."""
    if 400 <= lam <= 700:
        return 0.95
    return 0.02


def _r_dichroic(lam: float, low: float, high: float) -> float:
    """Dichroic: high R in band [low, high], low elsewhere."""
    if low <= lam <= high:
        return 0.93
    return 0.03


def _r_dielectric_max_reflect(lam: float) -> float:
    """Dielectric MaxReflect: >99.9% at design wavelength."""
    return 0.999


# Pre-populated coating library (50+ coatings)
_BUILTIN_COATINGS: List[Dict[str, Any]] = [
    # Base
    {"name": "Uncoated", "category": CATEGORY_BASE, "type": CATEGORY_AR, "description": "Uncoated (Fresnel ~4% R for glass)", "reflectivity_fn": _r_uncoated},
    {"name": "None", "category": CATEGORY_BASE, "type": CATEGORY_AR, "description": "Uncoated (Fresnel ~4%)", "reflectivity_fn": _r_uncoated},
    # AR
    {"name": "MgF2", "category": CATEGORY_AR, "type": CATEGORY_AR, "description": "Single-layer MgF₂ AR coating", "reflectivity_fn": _r_mgf2},
    {"name": "BBAR", "category": CATEGORY_AR, "type": CATEGORY_AR, "description": "Broadband anti-reflection (400–700 nm)", "reflectivity_fn": _r_bbar},
    {"name": "UV-AR", "category": CATEGORY_AR, "type": CATEGORY_AR, "description": "UV anti-reflection (250–400 nm)", "reflectivity_fn": _r_uv_ar},
    {"name": "IR-AR", "category": CATEGORY_AR, "type": CATEGORY_AR, "description": "IR anti-reflection (700–2000 nm)", "reflectivity_fn": _r_ir_ar},
    {"name": "V-Coat 355", "category": CATEGORY_AR, "type": CATEGORY_AR, "description": "V-coat optimized for 355 nm", "reflectivity_fn": lambda l: _r_vcoat(l, 355, 30)},
    {"name": "V-Coat 532", "category": CATEGORY_AR, "type": CATEGORY_AR, "description": "V-coat optimized for 532 nm", "reflectivity_fn": lambda l: _r_vcoat(l, 532, 50)},
    {"name": "V-Coat 633", "category": CATEGORY_AR, "type": CATEGORY_AR, "description": "V-coat optimized for 633 nm", "reflectivity_fn": lambda l: _r_vcoat(l, 633, 50)},
    {"name": "V-Coat 1064", "category": CATEGORY_AR, "type": CATEGORY_AR, "description": "V-coat optimized for 1064 nm", "reflectivity_fn": lambda l: _r_vcoat(l, 1064, 100)},
    {"name": "V-Coat 1550", "category": CATEGORY_AR, "type": CATEGORY_AR, "description": "V-coat optimized for 1550 nm", "reflectivity_fn": lambda l: _r_vcoat(l, 1550, 100)},
    {"name": "V-Coat 2µm", "category": CATEGORY_AR, "type": CATEGORY_AR, "description": "V-coat optimized for 2000 nm", "reflectivity_fn": lambda l: _r_vcoat(l, 2000, 150)},
    # HR
    {"name": "HR", "category": CATEGORY_HR, "type": CATEGORY_HR, "description": "High reflectivity mirror (>99.5%)", "reflectivity_fn": _r_hr},
    {"name": "Dielectric MaxReflect", "category": CATEGORY_HR, "type": CATEGORY_HR, "description": "Dielectric stack >99.9% R", "reflectivity_fn": _r_dielectric_max_reflect},
    {"name": "Protected Aluminum", "category": CATEGORY_HR, "type": CATEGORY_HR, "description": "Protected aluminum mirror (~92% R)", "reflectivity_fn": _r_protected_al},
    {"name": "Enhanced Silver", "category": CATEGORY_HR, "type": CATEGORY_HR, "description": "Enhanced silver mirror (~98.5% R)", "reflectivity_fn": _r_enhanced_silver},
    {"name": "Protected Gold", "category": CATEGORY_HR, "type": CATEGORY_HR, "description": "Protected gold mirror (~98% R)", "reflectivity_fn": _r_protected_gold},
    {"name": "Protected Silver", "category": CATEGORY_HR, "type": CATEGORY_HR, "description": "Protected silver mirror (~97.5% R)", "reflectivity_fn": lambda l: 0.975},
    {"name": "HR 355", "category": CATEGORY_HR, "type": CATEGORY_HR, "description": "HR optimized 355 nm", "reflectivity_fn": _r_hr},
    {"name": "HR 532", "category": CATEGORY_HR, "type": CATEGORY_HR, "description": "HR optimized 532 nm", "reflectivity_fn": _r_hr},
    {"name": "HR 633", "category": CATEGORY_HR, "type": CATEGORY_HR, "description": "HR optimized 633 nm", "reflectivity_fn": _r_hr},
    {"name": "HR 1064", "category": CATEGORY_HR, "type": CATEGORY_HR, "description": "HR optimized 1064 nm", "reflectivity_fn": _r_hr},
    # Beamsplitters
    {"name": "Beamsplitter 50/50", "category": CATEGORY_BEAMSPLITTER, "type": CATEGORY_AR, "description": "50% R / 50% T", "reflectivity_fn": lambda l: _r_beamsplitter(l, 0.5)},
    {"name": "Beamsplitter 70/30", "category": CATEGORY_BEAMSPLITTER, "type": CATEGORY_AR, "description": "70% R / 30% T", "reflectivity_fn": lambda l: _r_beamsplitter(l, 0.7)},
    {"name": "Beamsplitter 90/10", "category": CATEGORY_BEAMSPLITTER, "type": CATEGORY_AR, "description": "90% R / 10% T", "reflectivity_fn": lambda l: _r_beamsplitter(l, 0.9)},
    {"name": "Beamsplitter 60/40", "category": CATEGORY_BEAMSPLITTER, "type": CATEGORY_AR, "description": "60% R / 40% T", "reflectivity_fn": lambda l: _r_beamsplitter(l, 0.6)},
    {"name": "Beamsplitter 80/20", "category": CATEGORY_BEAMSPLITTER, "type": CATEGORY_AR, "description": "80% R / 20% T", "reflectivity_fn": lambda l: _r_beamsplitter(l, 0.8)},
    {"name": "Beamsplitter 30/70", "category": CATEGORY_BEAMSPLITTER, "type": CATEGORY_AR, "description": "30% R / 70% T", "reflectivity_fn": lambda l: _r_beamsplitter(l, 0.3)},
    {"name": "Beamsplitter 10/90", "category": CATEGORY_BEAMSPLITTER, "type": CATEGORY_AR, "description": "10% R / 90% T", "reflectivity_fn": lambda l: _r_beamsplitter(l, 0.1)},
    # Specialty
    {"name": "Hot Mirror", "category": CATEGORY_SPECIALTY, "type": CATEGORY_HR, "description": "Reflects IR, transmits visible", "reflectivity_fn": _r_hot_mirror},
    {"name": "Cold Mirror", "category": CATEGORY_SPECIALTY, "type": CATEGORY_HR, "description": "Reflects visible, transmits IR", "reflectivity_fn": _r_cold_mirror},
    {"name": "Dichroic 400-500", "category": CATEGORY_SPECIALTY, "type": CATEGORY_HR, "description": "Reflects 400–500 nm", "reflectivity_fn": lambda l: _r_dichroic(l, 400, 500)},
    {"name": "Dichroic 500-600", "category": CATEGORY_SPECIALTY, "type": CATEGORY_HR, "description": "Reflects 500–600 nm", "reflectivity_fn": lambda l: _r_dichroic(l, 500, 600)},
    {"name": "Dichroic 600-700", "category": CATEGORY_SPECIALTY, "type": CATEGORY_HR, "description": "Reflects 600–700 nm", "reflectivity_fn": lambda l: _r_dichroic(l, 600, 700)},
    {"name": "Dichroic 532/1064", "category": CATEGORY_SPECIALTY, "type": CATEGORY_HR, "description": "Reflects 532 nm, transmits 1064 nm", "reflectivity_fn": lambda l: 0.95 if 500 <= l <= 560 else 0.02},
    {"name": "Dichroic 1064/532", "category": CATEGORY_SPECIALTY, "type": CATEGORY_HR, "description": "Reflects 1064 nm, transmits 532 nm", "reflectivity_fn": lambda l: 0.95 if 1000 <= l <= 1100 else 0.02},
    {"name": "Longpass 550", "category": CATEGORY_SPECIALTY, "type": CATEGORY_AR, "description": "Transmits λ>550 nm, reflects shorter", "reflectivity_fn": lambda l: 0.9 if l < 550 else 0.02},
    {"name": "Shortpass 550", "category": CATEGORY_SPECIALTY, "type": CATEGORY_AR, "description": "Transmits λ<550 nm, reflects longer", "reflectivity_fn": lambda l: 0.02 if l < 550 else 0.9},
    {"name": "Longpass 650", "category": CATEGORY_SPECIALTY, "type": CATEGORY_AR, "description": "Transmits λ>650 nm", "reflectivity_fn": lambda l: 0.9 if l < 650 else 0.02},
    {"name": "Shortpass 450", "category": CATEGORY_SPECIALTY, "type": CATEGORY_AR, "description": "Transmits λ<450 nm", "reflectivity_fn": lambda l: 0.02 if l < 450 else 0.9},
    # Additional AR variants
    {"name": "BBAR-VIS-NIR", "category": CATEGORY_AR, "type": CATEGORY_AR, "description": "Broadband AR 400–1100 nm", "reflectivity_fn": lambda l: 0.006 + 0.002 * abs(l - 750) / 350 if 400 <= l <= 1100 else 0.02},
    {"name": "NIR-AR", "category": CATEGORY_AR, "type": CATEGORY_AR, "description": "NIR AR 900–1700 nm", "reflectivity_fn": lambda l: 0.004 + 0.003 * abs(l - 1300) / 400 if 900 <= l <= 1700 else 0.02},
    {"name": "SWIR-AR", "category": CATEGORY_AR, "type": CATEGORY_AR, "description": "SWIR AR 1.5–2.5 µm", "reflectivity_fn": lambda l: 0.005 if 1500 <= l <= 2500 else 0.02},
    # Additional HR variants
    {"name": "HR 355nm", "category": CATEGORY_HR, "type": CATEGORY_HR, "description": "HR @ 355 nm", "reflectivity_fn": _r_hr},
    {"name": "HR 1064nm", "category": CATEGORY_HR, "type": CATEGORY_HR, "description": "HR @ 1064 nm", "reflectivity_fn": _r_hr},
    {"name": "HR Broadband", "category": CATEGORY_HR, "type": CATEGORY_HR, "description": "Broadband HR 400–1100 nm", "reflectivity_fn": _r_hr},
    # More beamsplitters
    {"name": "Pellicle 8%", "category": CATEGORY_BEAMSPLITTER, "type": CATEGORY_AR, "description": "Pellicle ~8% R", "reflectivity_fn": lambda l: 0.08},
    {"name": "Pellicle 45%", "category": CATEGORY_BEAMSPLITTER, "type": CATEGORY_AR, "description": "Pellicle ~45% R", "reflectivity_fn": lambda l: 0.45},
    {"name": "Cube 50/50", "category": CATEGORY_BEAMSPLITTER, "type": CATEGORY_AR, "description": "Cube beamsplitter 50/50", "reflectivity_fn": lambda l: 0.5},
    {"name": "Cube 70/30", "category": CATEGORY_BEAMSPLITTER, "type": CATEGORY_AR, "description": "Cube beamsplitter 70/30", "reflectivity_fn": lambda l: 0.7},
    # More specialty
    {"name": "Notch 532", "category": CATEGORY_SPECIALTY, "type": CATEGORY_HR, "description": "Notch filter @ 532 nm", "reflectivity_fn": lambda l: 0.95 if 520 <= l <= 544 else 0.02},
    {"name": "Notch 1064", "category": CATEGORY_SPECIALTY, "type": CATEGORY_HR, "description": "Notch filter @ 1064 nm", "reflectivity_fn": lambda l: 0.95 if 1050 <= l <= 1080 else 0.02},
    {"name": "Bandpass 532±5", "category": CATEGORY_SPECIALTY, "type": CATEGORY_AR, "description": "Bandpass 527–537 nm", "reflectivity_fn": lambda l: 0.02 if 527 <= l <= 537 else 0.9},
    {"name": "Neutral Density 50%", "category": CATEGORY_SPECIALTY, "type": CATEGORY_AR, "description": "ND 50% transmission", "reflectivity_fn": lambda l: 0.25},
    {"name": "Neutral Density 10%", "category": CATEGORY_SPECIALTY, "type": CATEGORY_AR, "description": "ND 10% transmission", "reflectivity_fn": lambda l: 0.45},
    {"name": "Neutral Density 1%", "category": CATEGORY_SPECIALTY, "type": CATEGORY_AR, "description": "ND 1% transmission", "reflectivity_fn": lambda l: 0.495},
]


def _interpolate_table(data_points: List[Dict[str, Any]], lambda_nm: float) -> float:
    """Interpolate R(λ) from wavelength/reflectivity table."""
    if not data_points:
        return 0.04
    sorted_pts = sorted(data_points, key=lambda p: p["wavelength"])
    wl = [p["wavelength"] for p in sorted_pts]
    rv = [p["reflectivity"] for p in sorted_pts]
    if lambda_nm <= wl[0]:
        return rv[0]
    if lambda_nm >= wl[-1]:
        return rv[-1]
    for i in range(len(wl) - 1):
        if wl[i] <= lambda_nm <= wl[i + 1]:
            t = (lambda_nm - wl[i]) / (wl[i + 1] - wl[i]) if wl[i + 1] != wl[i] else 0
            return rv[i] + t * (rv[i + 1] - rv[i])
    return rv[-1]


class CoatingService:
    """Service for coating library and reflectivity lookup."""

    def __init__(self, user_coatings: Optional[List[Dict[str, Any]]] = None):
        self._builtin: Dict[str, Dict[str, Any]] = {c["name"]: c for c in _BUILTIN_COATINGS}
        self._user: Dict[str, Dict[str, Any]] = {}
        if user_coatings:
            for uc in user_coatings:
                self._user[uc["name"]] = uc

    def get_reflectivity(self, coating_name: Optional[str], lambda_nm: float) -> float:
        """Return R(λ) for coating. Uses uncoated ~4% if unknown."""
        if not coating_name or not str(coating_name).strip():
            return _r_uncoated(lambda_nm)
        name = str(coating_name).strip()
        # User coatings take precedence
        if name in self._user:
            uc = self._user[name]
            dt = uc.get("data_type", DATA_TYPE_CONSTANT)
            if dt == DATA_TYPE_CONSTANT:
                return float(uc.get("constant_value", 0.04))
            if dt == DATA_TYPE_TABLE:
                pts = uc.get("data_points", [])
                return _interpolate_table(pts, lambda_nm)
        if name in self._builtin:
            fn = self._builtin[name]["reflectivity_fn"]
            return float(fn(lambda_nm))
        return _r_uncoated(lambda_nm)

    def is_hr_coating(self, coating_name: Optional[str]) -> bool:
        """True if coating is HR (reflects instead of refracts)."""
        if not coating_name or not str(coating_name).strip():
            return False
        name = str(coating_name).strip()
        if name in self._user:
            return self._user[name].get("type") == CATEGORY_HR
        if name in self._builtin:
            return self._builtin[name].get("type") == CATEGORY_HR
        return False

    def get_library(self) -> List[Dict[str, Any]]:
        """Return full coating library (built-in + user) for dropdown."""
        result: List[Dict[str, Any]] = []
        seen = set()
        for c in _BUILTIN_COATINGS:
            result.append({
                "name": c["name"],
                "category": c["category"],
                "description": c.get("description", ""),
                "is_hr": c.get("type") == CATEGORY_HR,
                "source": "builtin",
            })
            seen.add(c["name"])
        for uc in self._user.values():
            if uc["name"] not in seen:
                result.append({
                    "name": uc["name"],
                    "category": uc.get("category", "Custom"),
                    "description": uc.get("description", ""),
                    "is_hr": uc.get("type") == CATEGORY_HR,
                    "source": "custom",
                })
                seen.add(uc["name"])
        return result


# Singleton with no user coatings (for backward compatibility)
_default_service: Optional[CoatingService] = None


def get_coating_service(user_coatings: Optional[List[Dict[str, Any]]] = None) -> CoatingService:
    """Get CoatingService instance, optionally with user coatings from DB."""
    global _default_service
    if user_coatings is None and _default_service is not None:
        return _default_service
    svc = CoatingService(user_coatings)
    if user_coatings is None:
        _default_service = svc
    return svc
