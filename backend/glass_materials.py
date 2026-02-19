"""
Material library for optical design: Sellmeier dispersion and n(λ) calculation.
Loads from glass_library.json; used by trace_service for wavelength-dependent refractive index.
"""

import json
import os
from typing import Dict, List, Optional, Any

_backend_dir = os.path.dirname(os.path.abspath(__file__))
_LIBRARY_PATH = os.path.join(_backend_dir, "glass_library.json")

# Cache loaded materials
_materials_cache: Optional[List[Dict[str, Any]]] = None
_name_to_material: Optional[Dict[str, Dict[str, Any]]] = None


def _load_library() -> List[Dict[str, Any]]:
    """Load glass library from JSON."""
    global _materials_cache
    if _materials_cache is not None:
        return _materials_cache
    with open(_LIBRARY_PATH, encoding="utf-8") as f:
        data = json.load(f)
    _materials_cache = data.get("materials", [])
    return _materials_cache


# Common material name aliases (lowercase -> canonical)
_ALIASES: Dict[str, str] = {
    "bk7": "N-BK7", "nbk7": "N-BK7",
    "sf11": "N-SF11", "sf5": "N-SF5", "sf6": "N-SF6", "sf10": "N-SF10",
    "sf14": "N-SF14", "sf15": "N-SF15", "sf57": "N-SF57", "sf66": "N-SF66",
    "f2": "N-F2", "sk2": "N-SK2", "sk16": "N-SK16", "k5": "N-K5",
    "baf10": "N-BAF10", "baf4": "N-BAF4",
    "lak9": "N-LAK9", "lak14": "N-LAK14",
    "silica": "Fused Silica", "fused-silica": "Fused Silica", "fused silica": "Fused Silica",
    "caf2": "Calcium Fluoride", "calcium fluoride": "Calcium Fluoride",
    "mgf2": "Magnesium Fluoride", "magnesium fluoride": "Magnesium Fluoride",
}


def _build_name_index() -> Dict[str, Dict[str, Any]]:
    """Build lowercase name -> material index for lookup."""
    global _name_to_material
    if _name_to_material is not None:
        return _name_to_material
    materials = _load_library()
    name_to_mat = {m.get("name", "").lower().strip(): m for m in materials if m.get("name")}
    for alias, canonical in _ALIASES.items():
        if canonical.lower() in name_to_mat and alias not in name_to_mat:
            name_to_mat[alias] = name_to_mat[canonical.lower()]
    for m in materials:
        name = m.get("name", "")
        if name and name.startswith("N-"):
            short = name[2:].lower().strip()
            if short not in name_to_mat:
                name_to_mat[short] = m
    _name_to_material = name_to_mat
    return _name_to_material


def n_from_sellmeier(lambda_nm: float, coeffs: Dict[str, List[float]]) -> float:
    """
    Refractive index from Sellmeier equation.
    n² = 1 + Σ Bᵢλ²/(λ² - Cᵢ), λ in µm.
    """
    lam_um = lambda_nm * 1e-3
    lam2 = lam_um * lam_um
    B = coeffs.get("B", [0, 0, 0])
    C = coeffs.get("C", [1, 1, 1])  # avoid division by zero
    n2 = 1.0
    for i in range(min(3, len(B), len(C))):
        n2 += (B[i] * lam2) / (lam2 - C[i])
    return (max(n2, 1.0)) ** 0.5


def refractive_index_at_wavelength(
    lambda_nm: float,
    material_name: Optional[str],
    refractive_index_fallback: float,
) -> float:
    """
    Get refractive index at wavelength λ (nm).
    If material_name is in the library, use Sellmeier; otherwise use refractive_index_fallback.
    """
    if not material_name or not material_name.strip():
        return refractive_index_fallback
    if refractive_index_fallback <= 1.001:
        return 1.0  # Air
    index = _build_name_index()
    mat = index.get(material_name.lower().strip())
    if mat is None:
        return refractive_index_fallback
    formula = mat.get("dispersion_formula", "constant")
    coeffs = mat.get("coefficients", {})
    if formula == "sellmeier" and coeffs:
        return n_from_sellmeier(lambda_nm, coeffs)
    if formula == "constant":
        return float(coeffs.get("n", refractive_index_fallback))
    return refractive_index_fallback


def get_all_materials() -> List[Dict[str, Any]]:
    """Return full material library for API."""
    return _load_library()


def get_material_by_name(name: str) -> Optional[Dict[str, Any]]:
    """Look up material by name (case-insensitive)."""
    index = _build_name_index()
    return index.get(name.lower().strip())
