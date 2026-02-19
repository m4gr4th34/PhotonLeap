"""
OpticalImporter: Import lens systems from JSON (Zemax-style) and SVG files.
Maps imported data to the Surface model (Radius, Thickness, Material, Aperture).
"""

import json
import logging
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

from glass_materials import get_material_by_name, refractive_index_at_wavelength

# Default wavelength for refractive index lookup
_DEFAULT_WVL_NM = 587.6
_DEFAULT_APERTURE_RADIUS = 12.5  # mm; diameter = 2 * aperture_radius

logger = logging.getLogger(__name__)


def _parse_radius(v: Any) -> float:
    """
    Parse radius from JSON. Accepts numbers and string 'infinity'/'inf'/'flat'.
    Maps infinity to 0 (flat surface; curvature = 0 in ray-tracing).
    """
    if v is None or v == "":
        return 0.0
    if isinstance(v, str):
        s = str(v).strip().lower()
        if s in ("infinity", "inf", "flat"):
            return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _surface_from_dict(
    raw: Dict[str, Any],
    idx: int,
) -> Dict[str, Any]:
    """
    Map a raw surface dict to our Surface model.
    Supports flexible keys: Radius/radius, Thickness/thickness, Material/material,
    Diameter/diameter, Type/type, etc.
    Prioritizes LENS-X-style physics (sellmeier, coating) when present.
    """
    def get_float(d: Dict, *keys: str, default: float = 0.0) -> float:
        for k in keys:
            v = d.get(k)
            if v is not None and v != "":
                try:
                    return float(v)
                except (TypeError, ValueError):
                    pass
        return default

    def get_str(d: Dict, *keys: str, default: str = "") -> str:
        for k in keys:
            v = d.get(k)
            if v is not None and v != "":
                return str(v).strip()
        return default

    # Radius: accept number or string 'infinity'/'inf'/'flat' -> 0 (flat)
    radius_raw = raw.get("Radius") or raw.get("radius") or raw.get("R")
    if radius_raw is None:
        curv = get_float(raw, "Curvature", "curvature", "CURV", default=0.0)
        radius = 1.0 / curv if curv != 0 else 0.0
    else:
        radius = _parse_radius(radius_raw)
    if radius == 0:
        curv = get_float(raw, "Curvature", "curvature", "CURV", default=0.0)
        if curv != 0:
            radius = 1.0 / curv

    thickness = get_float(raw, "Thickness", "thickness", "T", "spacing", default=0.0)
    # Diameter: prefer explicit diameter/aperture; else 2 * aperture_radius (default 12.5)
    diameter = get_float(raw, "Diameter", "diameter", "DIAM", "aperture", default=0.0)
    if diameter <= 0:
        ar = get_float(raw, "aperture_radius", "ApertureRadius", "APERTURE_RADIUS", default=_DEFAULT_APERTURE_RADIUS)
        diameter = 2 * ar
    diameter = max(0.1, diameter)
    material_raw = get_str(raw, "Material", "material", "Glass", "GLASS")
    surf_type = get_str(raw, "Type", "type", default="Glass").lower()
    if surf_type in ("air", "object", "image", "stop"):
        surf_type = "Air"
        material = "Air"
        n = 1.0
    else:
        surf_type = "Glass"
        material = material_raw or "N-BK7"
        mat = get_material_by_name(material)
        n = (
            refractive_index_at_wavelength(_DEFAULT_WVL_NM, material, 1.52)
            if mat
            else 1.52
        )

    result: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "type": surf_type,
        "radius": radius,
        "thickness": thickness,
        "refractiveIndex": n,
        "diameter": max(0.1, diameter),
        "material": material,
        "description": get_str(raw, "Comment", "comment", "description") or f"Surface {idx + 1}",
    }
    # LENS-X-style physics: load sellmeier and coating directly when present
    physics = raw.get("physics")
    if isinstance(physics, dict):
        sellmeier = physics.get("sellmeier")
        if sellmeier and isinstance(sellmeier, dict):
            from glass_materials import n_from_sellmeier
            B = sellmeier.get("B", [0, 0, 0])
            C = sellmeier.get("C", [1, 1, 1])
            result["refractiveIndex"] = n_from_sellmeier(_DEFAULT_WVL_NM, {"B": B, "C": C})
            result["sellmeierCoefficients"] = sellmeier
        coating = physics.get("coating")
        if coating and isinstance(coating, str):
            result["coating"] = str(coating).strip()
    mfg = raw.get("manufacturing")
    if isinstance(mfg, dict):
        if mfg.get("surface_quality"):
            result["surfaceQuality"] = str(mfg["surface_quality"])
        if mfg.get("radius_tolerance") is not None:
            result["radiusTolerance"] = float(mfg["radius_tolerance"])
        if mfg.get("thickness_tolerance") is not None:
            result["thicknessTolerance"] = float(mfg["thickness_tolerance"])
        if mfg.get("tilt_tolerance") is not None:
            result["tiltTolerance"] = float(mfg["tilt_tolerance"])
    return result


def _parse_json_surfaces(data: Any) -> List[Dict[str, Any]]:
    """Extract surfaces array from JSON. Supports various structures."""
    surfaces_raw: List[Dict[str, Any]] = []

    if isinstance(data, list):
        surfaces_raw = data
    elif isinstance(data, dict):
        for key in ("surfaces", "Surfaces", "sequence", "Surf", "elements"):
            arr = data.get(key)
            if isinstance(arr, list):
                surfaces_raw = arr
                break
        if not surfaces_raw and "surface" in data:
            s = data["surface"]
            if isinstance(s, dict):
                surfaces_raw = [s]
            elif isinstance(s, list):
                surfaces_raw = s

    if not surfaces_raw:
        return []

    result: List[Dict[str, Any]] = []
    for i, raw in enumerate(surfaces_raw):
        if not isinstance(raw, dict):
            logger.warning("Surface %d: expected dict, got %s", i + 1, type(raw).__name__)
            continue
        try:
            surf = _surface_from_dict(raw, i)
            result.append(surf)
        except (KeyError, TypeError, ValueError) as e:
            logger.exception("Surface %d parse error: %s (raw keys: %s)", i + 1, e, list(raw.keys()) if raw else [])
            raise
    return result


def _is_lens_x(data: Any) -> bool:
    """Check if JSON is LENS-X format."""
    if not isinstance(data, dict):
        return False
    if data.get("lens_x_version"):
        return True
    if "optics" in data and isinstance(data["optics"], dict):
        return "surfaces" in data["optics"]
    return False


def _surface_from_lens_x(raw: Dict[str, Any], idx: int) -> Dict[str, Any]:
    """
    Map LENS-X surface to our Surface model.
    Maps physics.sellmeier into sellmeierCoefficients for material engine.
    Ensures radius, thickness, aperture (diameter) for every surface.
    """
    from glass_materials import n_from_sellmeier

    radius = _parse_radius(raw.get("radius"))
    thickness = float(raw.get("thickness") or 0)
    aperture = float(raw.get("aperture") or 12.5)
    diameter = 2 * aperture
    material = str(raw.get("material") or "N-BK7").strip()
    surf_type = str(raw.get("type") or "Glass").strip()
    coating = None
    if surf_type.lower() in ("air", "object", "image", "stop"):
        surf_type = "Air"
        material = "Air"
        n = 1.0
        sellmeier = None
    else:
        surf_type = "Glass"
        physics = raw.get("physics") or {}
        sellmeier = physics.get("sellmeier")
        coating = physics.get("coating")
        if sellmeier and isinstance(sellmeier, dict):
            B = sellmeier.get("B", [0, 0, 0])
            C = sellmeier.get("C", [1, 1, 1])
            n = n_from_sellmeier(_DEFAULT_WVL_NM, {"B": B, "C": C})
        else:
            n = float(physics.get("refractive_index") or raw.get("refractive_index") or 1.52)
            mat = get_material_by_name(material)
            if mat:
                n = refractive_index_at_wavelength(_DEFAULT_WVL_NM, material, n)

    mfg = raw.get("manufacturing") or {}
    result: Dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "type": surf_type,
        "radius": radius,
        "thickness": thickness,
        "refractiveIndex": n,
        "diameter": max(0.1, diameter),
        "material": material,
        "description": str(raw.get("description") or f"Surface {idx + 1}"),
    }
    if sellmeier:
        result["sellmeierCoefficients"] = sellmeier
    if coating and isinstance(coating, str):
        result["coating"] = str(coating).strip()
    if mfg.get("surface_quality"):
        result["surfaceQuality"] = str(mfg["surface_quality"])
    if mfg.get("radius_tolerance") is not None:
        result["radiusTolerance"] = float(mfg["radius_tolerance"])
    if mfg.get("thickness_tolerance") is not None:
        result["thicknessTolerance"] = float(mfg["thickness_tolerance"])
    if mfg.get("tilt_tolerance") is not None:
        result["tiltTolerance"] = float(mfg["tilt_tolerance"])
    return result


def _parse_lens_x(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Parse LENS-X document. Returns list of Surface objects."""
    optics = data.get("optics") or {}
    surfaces_raw = optics.get("surfaces") or []
    if not isinstance(surfaces_raw, list):
        return []
    result: List[Dict[str, Any]] = []
    for i, raw in enumerate(surfaces_raw):
        if not isinstance(raw, dict):
            continue
        result.append(_surface_from_lens_x(raw, i))
    return result


def import_from_json(content: bytes) -> List[Dict[str, Any]]:
    """
    Parse JSON lens system. Prefers LENS-X format; falls back to Zemax-style/generic.
    LENS-X: maps physics.sellmeier into material engine.
    """
    try:
        data = json.loads(content.decode("utf-8"))
    except json.JSONDecodeError as e:
        logger.exception("JSON parse error: %s", e)
        raise ValueError(f"Invalid JSON: {e}") from e
    except Exception as e:
        logger.exception("Unexpected error parsing JSON: %s", e)
        raise ValueError(f"Invalid JSON: {e}") from e

    try:
        if _is_lens_x(data):
            surfaces = _parse_lens_x(data)
        else:
            surfaces = _parse_json_surfaces(data)
    except (KeyError, TypeError, ValueError) as e:
        logger.exception("Surface parsing error (KeyError/TypeError/ValueError): %s", e)
        raise ValueError(f"Failed to parse surfaces: {e}") from e
    except Exception as e:
        logger.exception("Unexpected error parsing surfaces: %s", e)
        raise ValueError(f"Failed to parse surfaces: {e}") from e

    if not surfaces:
        raise ValueError("No surfaces found in JSON. Expected LENS-X optics.surfaces or surfaces array.")
    return surfaces


def _extract_surface_info_from_path(path) -> Tuple[Optional[float], float, float]:
    """
    Extract (radius, center_x, diameter) from an svgpathtools Path.
    - radius: from Arc segments (geometric mean of rx, ry for ellipse; inf for flat)
    - center_x: centroid x (optical axis position)
    - diameter: extent in y direction
    """
    from svgpathtools import Path

    radii: List[float] = []
    pts: List[complex] = []
    for seg in path:
        if hasattr(seg, "radius"):
            rx = abs(seg.radius.real)
            ry = abs(seg.radius.imag)
            r = (rx * ry) ** 0.5 if (rx > 0 and ry > 0) else max(rx, ry)
            if r > 1e-6:
                radii.append(r)
        # Collect points for centroid and extent
        if hasattr(seg, "start"):
            pts.append(seg.start)
        if hasattr(seg, "end"):
            pts.append(seg.end)
        # Sample a few points for curves
        if hasattr(seg, "point"):
            for t in (0, 0.5, 1):
                try:
                    pts.append(seg.point(t))
                except Exception:
                    pass

    if not pts:
        return None, 0.0, 25.0

    xs = [p.real for p in pts]
    ys = [p.imag for p in pts]
    center_x = (min(xs) + max(xs)) / 2
    diameter = max(ys) - min(ys) if ys else 25.0
    diameter = max(0.1, diameter)

    radius = (sum(radii) / len(radii)) if radii else None  # None = flat
    return radius, center_x, diameter


# Default pixel values when SVG uses percentages (avoids float("100%") crash)
_DEFAULT_SVG_WIDTH = 800
_DEFAULT_SVG_HEIGHT = 600

# SVG noise filters
_MIN_PATH_LENGTH = 5.0  # Ignore paths shorter than this (arrows, text fragments)
_DEDUP_TOLERANCE = 0.1  # Paths within this distance are considered duplicates
_MIN_STROKE_WIDTH = 0.5  # Paths with stroke-width below this are likely annotations


def _sanitize_svg_for_parsing(svg_str: str) -> str:
    """
    Sanitize SVG string before passing to svgpathtools.
    - Replaces width/height="100%" with pixel defaults (800x600); strips % from other values
    - Replaces viewBox percentages with defaults
    - Strips '%' from all numeric attribute values (cx, cy, r, etc.) so float() won't fail
    """
    # width="100%" or width='100%' -> width="800"; other width="N%" -> width="N"
    def _replace_width(m: re.Match) -> str:
        val = (m.group(1) or "").strip()
        if val in ("100", "100.0", "100.00"):
            return f'width="{_DEFAULT_SVG_WIDTH}"'
        return f'width="{val}"' if val else f'width="{_DEFAULT_SVG_WIDTH}"'

    svg_str = re.sub(
        r'\bwidth\s*=\s*["\']([^"\']*?)%["\']',
        lambda m: _replace_width(m),
        svg_str,
        flags=re.IGNORECASE,
    )
    # height: same logic
    def _replace_height(m: re.Match) -> str:
        val = (m.group(1) or "").strip()
        if val in ("100", "100.0", "100.00"):
            return f'height="{_DEFAULT_SVG_HEIGHT}"'
        return f'height="{val}"' if val else f'height="{_DEFAULT_SVG_HEIGHT}"'

    svg_str = re.sub(
        r'\bheight\s*=\s*["\']([^"\']*?)%["\']',
        lambda m: _replace_height(m),
        svg_str,
        flags=re.IGNORECASE,
    )
    # viewBox="0 0 100% 100%" -> "0 0 800 600"
    svg_str = re.sub(
        r'\bviewBox\s*=\s*["\']0\s+0\s+\d*\.?\d*%\s+\d*\.?\d*%["\']',
        f'viewBox="0 0 {_DEFAULT_SVG_WIDTH} {_DEFAULT_SVG_HEIGHT}"',
        svg_str,
        flags=re.IGNORECASE,
    )
    # Strip % from remaining numeric attribute values: ="50%" -> ="50"
    # Handles cx, cy, r, rx, ry, x, y in path/circle/ellipse
    svg_str = re.sub(r'=\s*["\'](\d*\.?\d+)%["\']', r'="\1"', svg_str)
    return svg_str


def _get_viewport_from_svg(svg_str: str) -> Tuple[float, float]:
    """Extract viewport width and height from viewBox or width/height attributes."""
    # viewBox="0 0 W H" or viewBox="minX minY W H"
    m = re.search(r'\bviewBox\s*=\s*["\']([^"\']+)["\']', svg_str, re.IGNORECASE)
    if m:
        parts = m.group(1).split()
        if len(parts) >= 4:
            try:
                w, h = float(parts[2]), float(parts[3])
                if w > 0 and h > 0:
                    return w, h
            except (ValueError, IndexError):
                pass
    # width/height attributes
    wm = re.search(r'\bwidth\s*=\s*["\']([^"\']+)["\']', svg_str, re.IGNORECASE)
    hm = re.search(r'\bheight\s*=\s*["\']([^"\']+)["\']', svg_str, re.IGNORECASE)
    w = _DEFAULT_SVG_WIDTH
    h = _DEFAULT_SVG_HEIGHT
    if wm:
        try:
            w = float(re.sub(r'[^\d.]', '', wm.group(1)) or w)
        except ValueError:
            pass
    if hm:
        try:
            h = float(re.sub(r'[^\d.]', '', hm.group(1)) or h)
        except ValueError:
            pass
    return w, h


def _path_has_curvature(path) -> bool:
    """True if path contains Arc, QuadraticBezier, or CubicBezier segments."""
    for seg in path:
        name = type(seg).__name__
        if name in ('Arc', 'QuadraticBezier', 'CubicBezier'):
            return True
    return False


def _path_is_straight_horizontal(path) -> bool:
    """True if path is only Line segments and all points share the same y."""
    if _path_has_curvature(path):
        return False
    ys: List[float] = []
    for seg in path:
        if hasattr(seg, 'start'):
            ys.append(seg.start.imag)
        if hasattr(seg, 'end'):
            ys.append(seg.end.imag)
    if not ys:
        return False
    y0 = ys[0]
    return all(abs(y - y0) < 1e-6 for y in ys)


def _path_intersects_centerline(path, centerline_y: float) -> bool:
    """True if path bbox spans the horizontal centerline (optical axis)."""
    try:
        bbox = path.bbox()
        if bbox is None:
            return True  # Unknown bbox, allow
        # bbox is (xmin, xmax, ymin, ymax)
        ymin, ymax = float(bbox[2]), float(bbox[3])
        return ymin <= centerline_y <= ymax
    except Exception:
        return True


def _path_has_optical_surface_tag(attrs: Dict[str, Any]) -> bool:
    """True if path has data-type='optical-surface' (LENS-X tagged SVG)."""
    if not attrs:
        return False
    for key in ("data-type", "data_type", "dataType"):
        v = attrs.get(key)
        if v and str(v).strip().lower() == "optical-surface":
            return True
    return False


def _path_should_ignore_style(attrs: Dict[str, Any]) -> bool:
    """True if path has dashed stroke or very thin stroke (annotation style)."""
    if not attrs:
        return False
    # stroke-dasharray indicates dashed line (dimension, axis)
    for key in ('stroke-dasharray', 'stroke_dasharray'):
        if attrs.get(key):
            return True
    # stroke in style attribute
    style = attrs.get('style', '') or ''
    if 'stroke-dasharray' in style.lower():
        return True
    # stroke-width: thin lines are often annotations
    for key in ('stroke-width', 'stroke_width'):
        v = attrs.get(key)
        if v is not None:
            try:
                w = float(re.sub(r'[^\d.]', '', str(v)) or 0)
                if 0 < w < _MIN_STROKE_WIDTH:
                    return True
            except ValueError:
                pass
    # stroke-width in style
    sw = re.search(r'stroke-width\s*:\s*([^;]+)', style, re.IGNORECASE)
    if sw:
        try:
            w = float(re.sub(r'[^\d.]', '', sw.group(1)) or 0)
            if 0 < w < _MIN_STROKE_WIDTH:
                return True
        except ValueError:
            pass
    return False


def _deduplicate_path_infos(
    indexed: List[Tuple[int, Tuple[Optional[float], float, float]]],
    tolerance: float = _DEDUP_TOLERANCE,
) -> List[Tuple[int, Tuple[Optional[float], float, float]]]:
    """
    Remove paths that are nearly identical (center_x and extent within tolerance).
    When duplicates exist, prefer the one with curvature (radius) over flat.
    """
    if len(indexed) <= 1:
        return indexed
    result: List[Tuple[int, Tuple[Optional[float], float, float]]] = []
    for idx, (radius, center_x, diameter) in indexed:
        found_dup = False
        for j, (_, (r2, cx2, d2)) in enumerate(result):
            if (abs(center_x - cx2) < tolerance and
                    abs(diameter - d2) < tolerance and
                    (radius is None or r2 is None or abs((radius or 0) - (r2 or 0)) < tolerance)):
                # Prefer path with curvature (radius) over flat
                if radius is not None and r2 is None:
                    result[j] = (idx, (radius, center_x, diameter))
                found_dup = True
                break
        if not found_dup:
            result.append((idx, (radius, center_x, diameter)))
    return result


def import_from_svg(content: bytes) -> List[Dict[str, Any]]:
    """
    Parse SVG lens cross-section using svgpathtools.
    Extracts curvatures from arcs and thicknesses from distances between paths.
    Filters out annotations (arrows, text, axes) by length, axis intersection,
    shape heuristics, and style. Deduplicates near-identical paths.
    """
    try:
        from svgpathtools import svgstr2paths
    except ImportError as e:
        raise ImportError(
            "svgpathtools is required for SVG import. Install with: pip install svgpathtools"
        ) from e

    svg_str = content.decode("utf-8", errors="replace")
    svg_str = _sanitize_svg_for_parsing(svg_str)
    try:
        paths, path_attrs = svgstr2paths(svg_str)
    except Exception as e:
        raise ValueError(f"Failed to parse SVG paths: {e}") from e

    if not paths:
        raise ValueError("No paths found in SVG.")

    # Get viewport for centerline (optical axis)
    vp_w, vp_h = _get_viewport_from_svg(svg_str)
    centerline_y = vp_h / 2.0

    # Ensure path_attrs aligns with paths (svgstr2paths may convert circles/etc to paths)
    attrs_list = path_attrs if len(path_attrs) >= len(paths) else [{}] * len(paths)

    # Heuristic filter: if any path has data-type="optical-surface", ONLY use those (legacy SVG)
    optical_tagged: List[Tuple[int, Any, Dict[str, Any]]] = []
    for i in range(len(paths)):
        attrs = attrs_list[i] if i < len(attrs_list) else {}
        if _path_has_optical_surface_tag(attrs):
            optical_tagged.append((i, paths[i], attrs))

    if optical_tagged:
        # LENS-X tagged SVG: only use paths with data-type="optical-surface"
        length_ok_paths = []
        for i, path, attrs in optical_tagged:
            try:
                plen = path.length()
            except Exception:
                plen = 0.0
            if plen >= _MIN_PATH_LENGTH:
                length_ok_paths.append((i, path, attrs))
        if not length_ok_paths:
            length_ok_paths = list(optical_tagged)
    else:
        # Legacy SVG: heuristic filter (length, centerline, shape, style)
        length_ok_paths = []
        ymin_curv, ymax_curv = float('inf'), float('-inf')
        for i, path in enumerate(paths):
            attrs = attrs_list[i] if i < len(attrs_list) else {}
            try:
                plen = path.length()
            except Exception:
                plen = 0.0
            if plen < _MIN_PATH_LENGTH:
                continue
            if _path_has_curvature(path) and not _path_should_ignore_style(attrs):
                try:
                    bbox = path.bbox()
                    if bbox:
                        ymin_curv = min(ymin_curv, float(bbox[2]))
                        ymax_curv = max(ymax_curv, float(bbox[3]))
                except Exception:
                    pass
            length_ok_paths.append((i, path, attrs))

        # Use centerline from curvature paths (lens) if any; else viewport center
        if ymin_curv <= ymax_curv:
            centerline_y = (ymin_curv + ymax_curv) / 2.0

    # Filter: for legacy SVG, apply axis intersection, shape, style; for tagged SVG, use as-is
    filtered_paths: List[Any] = []
    if optical_tagged:
        filtered_paths = [p for _, p, _ in length_ok_paths]
    else:
        for i, path, attrs in length_ok_paths:
            if not _path_intersects_centerline(path, centerline_y):
                continue
            if _path_is_straight_horizontal(path):
                continue
            if _path_should_ignore_style(attrs):
                continue
            filtered_paths.append(path)

    # Extract infos from filtered paths
    infos: List[Tuple[Optional[float], float, float]] = []
    for path in filtered_paths:
        r, cx, d = _extract_surface_info_from_path(path)
        infos.append((r, cx, d))

    # Deduplication: remove nearly identical paths
    indexed = list(enumerate(infos))
    indexed = _deduplicate_path_infos(indexed)

    if not indexed:
        raise ValueError(
            "No lens surfaces found after filtering annotations. "
            "Ensure lens paths cross the drawing centerline and have length ≥ 5 units."
        )

    # Sort by center_x (optical axis position, left to right)
    indexed.sort(key=lambda x: x[1][1])

    surfaces: List[Dict[str, Any]] = []
    for i, (_, (radius, center_x, diameter)) in enumerate(indexed):
        # Radius: positive = convex toward object (left), negative = concave
        # SVG y increases downward; arc orientation may need sign. Use positive by default.
        r_mm = radius if radius is not None else 0.0  # 0 = flat (infinite radius)
        # Thickness: distance to next surface
        thickness = 0.0
        if i + 1 < len(indexed):
            next_cx = indexed[i + 1][1][1]
            thickness = abs(next_cx - center_x)

        # Alternate Glass / Air for typical lens layout
        surf_type = "Glass" if (i % 2 == 0 and i < len(indexed) - 1) else "Air"
        material = "N-BK7" if surf_type == "Glass" else "Air"
        n = (
            refractive_index_at_wavelength(_DEFAULT_WVL_NM, material, 1.52)
            if surf_type == "Glass"
            else 1.0
        )

        surfaces.append({
            "id": str(uuid.uuid4()),
            "type": surf_type,
            "radius": r_mm,
            "thickness": thickness,
            "refractiveIndex": n,
            "diameter": diameter,
            "material": material,
            "description": f"Surface {i + 1} (from SVG)",
        })

    # Last surface typically has 0 thickness (image plane)
    if surfaces:
        surfaces[-1]["thickness"] = 0.0

    return surfaces


def import_lens_system(content: bytes, filename: str) -> List[Dict[str, Any]]:
    """
    Import lens system from file content. Infers format from filename extension.
    Returns array of Surface objects for the frontend.
    """
    ext = (filename or "").lower().split(".")[-1]
    if ext == "json":
        return import_from_json(content)
    if ext == "svg":
        return import_from_svg(content)
    raise ValueError(
        f"Unsupported file type '.{ext}'. Use .json (Zemax-style) or .svg."
    )
