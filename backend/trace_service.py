"""
Optical trace service: converts frontend optical_stack to rayoptics format,
runs ray trace, returns (z,y) coordinates for rays and lens surface curves.
"""

import sys
import os
import types

# NumPy 2.0 fix for rayoptics (np.NaN removed)
import numpy as np
if not hasattr(np, "NaN"):
    np.NaN = np.nan

# Ensure backend directory is on path for singlet_rayoptics import
_backend_dir = os.path.dirname(os.path.abspath(__file__))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

# Stub rayoptics.gui.appcmds before any opticalmodel import
if "rayoptics.gui.appcmds" not in sys.modules:
    _ro = __import__("rayoptics", fromlist=[])
    _gui_dir = os.path.join(os.path.dirname(_ro.__file__), "gui")
    if sys.modules.get("rayoptics.gui") is None:
        _gui_mod = types.ModuleType("rayoptics.gui")
        _gui_mod.__path__ = [_gui_dir]
        sys.modules["rayoptics.gui"] = _gui_mod
    _stub = types.ModuleType("rayoptics.gui.appcmds")
    _stub.open_model = lambda *a, **k: (_ for _ in ()).throw(NotImplementedError("headless"))
    sys.modules["rayoptics.gui.appcmds"] = _stub

import numpy as np
from rayoptics.optical import model_constants as mc
from rayoptics.raytr import sampler, analyses


def _profile_points(ifc, sd, n_pts=31):
    """Return (z, y) points for a 2D surface profile in local coords."""
    try:
        prf = ifc.profile.profile([sd], dir=1, steps=max(n_pts // 2, 4))
        if prf:
            return np.array(prf)
    except Exception:
        pass
    cv = ifc.profile_cv
    if cv == 0:
        return np.array([[0, -sd], [0, sd]])
    R = 1.0 / cv
    y_vals = np.linspace(-sd, sd, n_pts)
    radicand = np.maximum(R * R - y_vals * y_vals, 0)
    z_vals = R - np.sign(R) * np.sqrt(radicand)
    return np.column_stack([z_vals, y_vals])


def _transform_profile(points, rot, trns):
    """Transform profile points to global coords. points: (N, 2) as (z, y)."""
    pts_3d = np.zeros((len(points), 3))
    pts_3d[:, 0] = 0
    pts_3d[:, 1] = points[:, 1]
    pts_3d[:, 2] = points[:, 0]
    transformed = (rot.dot(pts_3d.T)).T + trns
    return np.column_stack([transformed[:, 2], transformed[:, 1]])


def _ray_to_polyline(ray, tfrms, extend_parallel_back=50.0, extend_to_focus=True,
                     focus_z=None, z_origin=0):
    """Convert ray segments to (z, y) polyline. Returns list of [z, y]."""
    pts = []
    for i, seg in enumerate(ray):
        if i >= len(tfrms):
            break
        rot, trns = tfrms[i]
        p = seg[mc.p]
        d = seg[mc.d]
        p_glob = rot.dot(p) + trns
        d_glob = rot.dot(d)
        z_disp = p_glob[2] - z_origin
        if abs(p_glob[2]) > 1e6:
            continue
        pts.append([float(z_disp), float(p_glob[1])])
        if i == 1 and extend_parallel_back > 0 and len(pts) == 1:
            d_in = ray[0][mc.d] if len(ray) > 0 else d
            rot0, _ = tfrms[0]
            d_glob = rot0.dot(d_in)
            dz, dy = d_glob[2], d_glob[1]
            if abs(dz) > 1e-6:
                z0, y0 = z_disp, p_glob[1]
                z_back = z0 - extend_parallel_back * (dz / abs(dz))
                y_back = y0 - extend_parallel_back * (dy / abs(dz))
                pts.insert(0, [float(z_back), float(y_back)])
    pts = np.array(pts) if pts else np.zeros((0, 2))

    if extend_to_focus and len(pts) >= 2 and focus_z is not None:
        z_last, y_last = pts[-1, 0], pts[-1, 1]
        if z_last < focus_z - 0.1:
            d = ray[-1][mc.d] if len(ray) > 0 else None
            if d is not None:
                rot, trns = tfrms[min(len(ray) - 1, len(tfrms) - 1)]
                d_glob = rot.dot(d)
                dz, dy = d_glob[2], d_glob[1]
                if abs(dz) > 1e-6:
                    dist = focus_z - z_last
                    z_foc = focus_z
                    y_foc = y_last + dist * (dy / dz)
                    pts = np.vstack([pts, [[z_foc, y_foc]]])
    return [[float(p[0]), float(p[1])] for p in pts]


def _interpolate_ray_at_z(ray, z_pos):
    """
    Interpolate (y, slope) of a ray at a specific Z position.
    Ray format: list of [z, y] points. Returns (y, slope) or (None, None) if ray is empty.
    """
    if not ray or len(ray) < 2:
        return None, None
    pts = np.array(ray)
    z_vals = pts[:, 0]
    y_vals = pts[:, 1]
    z_min, z_max = float(z_vals.min()), float(z_vals.max())
    if z_pos <= z_min:
        dz = z_vals[1] - z_vals[0]
        dy = y_vals[1] - y_vals[0]
        slope = dy / dz if abs(dz) > 1e-12 else 0.0
        y = y_vals[0] + slope * (z_pos - z_vals[0])
        return float(y), float(slope)
    if z_pos >= z_max:
        dz = z_vals[-1] - z_vals[-2]
        dy = y_vals[-1] - y_vals[-2]
        slope = dy / dz if abs(dz) > 1e-12 else 0.0
        y = y_vals[-1] + slope * (z_pos - z_vals[-1])
        return float(y), float(slope)
    for i in range(len(pts) - 1):
        z0, z1 = z_vals[i], z_vals[i + 1]
        if z0 <= z_pos <= z1:
            dz = z1 - z0
            dy = y_vals[i + 1] - y_vals[i]
            slope = dy / dz if abs(dz) > 1e-12 else 0.0
            t = (z_pos - z0) / dz if abs(dz) > 1e-12 else 0.0
            y = y_vals[i] + t * dy
            return float(y), float(slope)
    return None, None


def get_metrics_at_z(z_pos, ray_data):
    """
    Compute optical metrics at an arbitrary Z position by interpolating ray data.

    Args:
        z_pos: Z position (mm) at which to evaluate metrics
        ray_data: List of rays, each ray is [[z,y], [z,y], ...]

    Returns:
        dict with rmsRadius (mm), beamWidth (mm), chiefRayAngle (degrees),
        yCentroid (mm), numRays (int). Values are None if no valid rays.
    """
    interpolated = []
    for ray in ray_data:
        y, slope = _interpolate_ray_at_z(ray, z_pos)
        if y is not None:
            interpolated.append((y, slope))

    if not interpolated:
        return {
            "rmsRadius": None,
            "beamWidth": None,
            "chiefRayAngle": None,
            "yCentroid": None,
            "numRays": 0,
        }

    y_vals = np.array([p[0] for p in interpolated])
    n = len(y_vals)
    y_centroid = float(np.mean(y_vals))

    # RMS Radius: sqrt(1/N * sum((y_i - y_centroid)^2))
    rms_radius = float(np.sqrt(np.mean((y_vals - y_centroid) ** 2)))

    # Beam Width: max Y - min Y
    beam_width = float(np.max(y_vals) - np.min(y_vals))

    # Chief ray: the one starting at (0,0) in pupil = smallest |y| at first point
    chief_idx = min(range(len(ray_data)), key=lambda i: abs(ray_data[i][0][1]) if ray_data[i] else float("inf"))
    _, chief_slope = _interpolate_ray_at_z(ray_data[chief_idx], z_pos)
    chief_ray_angle = np.degrees(np.arctan(chief_slope)) if chief_slope is not None else None

    return {
        "rmsRadius": rms_radius,
        "beamWidth": beam_width,
        "chiefRayAngle": float(chief_ray_angle) if chief_ray_angle is not None else None,
        "yCentroid": y_centroid,
        "numRays": n,
    }


def _precompute_metrics_sweep(rays, num_points=100):
    """
    Pre-compute metrics at num_points Z positions for instant frontend scrubbing.
    Returns list of {z, rmsRadius, beamWidth, chiefRayAngle, yCentroid, numRays}.
    """
    if not rays:
        return []
    all_z = []
    for ray in rays:
        for pt in ray:
            all_z.append(pt[0])
    z_min = min(all_z)
    z_max = max(all_z)
    if z_max <= z_min:
        z_max = z_min + 1.0
    z_positions = np.linspace(z_min, z_max, num_points)
    return [
        {"z": float(z), **get_metrics_at_z(z, rays)}
        for z in z_positions
    ]


def optical_stack_to_surf_data(surfaces):
    """
    Convert frontend surfaces to rayoptics surf_data_list [curvature, thickness, n, v].

    Each row provides 'n' (refractive index) for the medium after that surface.
    At each interface, Snell's Law (n₁sinθ₁ = n₂sinθ₂) is applied using:
    - n₁ = n from the previous row (medium before the surface)
    - n₂ = n from the current row (medium after the surface)
    Object space is assumed n=1 (air).
    """
    surf_data_list = []
    for s in surfaces:
        r = float(s.get("radius", 0) or 0)
        t = float(s.get("thickness", 0) or 0)
        n = float(s.get("refractiveIndex", 1) or 1)
        curvature = 1.0 / r if r != 0 else 0.0
        v = 64.2 if (s.get("type") == "Glass" and n > 1.01) else 0.0
        surf_data_list.append([curvature, t, n, v])
    return surf_data_list


def run_trace(optical_stack: dict) -> dict:
    """
    Run ray trace on optical_stack from frontend.
    Returns: { rays: [[[z,y], ...], ...], surfaces: [[[z,y], ...], ...], focusZ, performance }
    """
    from singlet_rayoptics import build_singlet_from_surface_data, get_focal_length, run_spot_diagram

    surfaces = optical_stack.get("surfaces", [])
    if not surfaces:
        return {"error": "No surfaces provided", "rays": [], "surfaces": [], "focusZ": 0, "metricsSweep": []}

    epd = float(optical_stack.get("entrancePupilDiameter", 10) or 10)
    wvl_nm = float(optical_stack.get("wavelengths", [587.6])[0] or 587.6)
    num_rays = int(optical_stack.get("numRays", 9) or 9)
    field_angles = optical_stack.get("fieldAngles", [0])

    surf_data_list = optical_stack_to_surf_data(surfaces)
    surface_diameters = [float(s.get("diameter", 25) or 25) for s in surfaces]  # diameter in mm

    try:
        opt_model = build_singlet_from_surface_data(
            surf_data_list,
            wvl_nm=wvl_nm,
            radius_mode=False,
            object_distance=1e10,
            epd=epd,
            surface_diameters=surface_diameters,
        )
    except Exception as e:
        return {"error": str(e), "rays": [], "surfaces": [], "focusZ": 0, "metricsSweep": []}

    sm = opt_model.seq_model
    tfrms = sm.gbl_tfrms
    osp = opt_model.optical_spec
    z_origin = tfrms[1][1][2] if len(tfrms) > 1 else 0

    # Focal point
    efl, fod = get_focal_length(opt_model)
    bfl = fod.bfl if (fod and fod.efl != 0) else 50.0
    if not np.isfinite(bfl):
        bfl = 50.0
    last_surf_z = tfrms[-2][1][2] if len(tfrms) >= 2 else tfrms[-1][1][2]
    focus_z = last_surf_z + bfl - z_origin

    # Lens surface curves (2D profiles in z,y)
    surface_curves = []
    for i, ifc in enumerate(sm.ifcs):
        if i >= len(tfrms):
            break
        if ifc.interact_mode == "dummy":
            continue
        try:
            sd = ifc.surface_od()
        except Exception:
            sd = epd / 2.0
        if sd <= 0:
            sd = epd / 2.0
        sd = min(sd, 100.0)
        pts = _profile_points(ifc, sd)
        if pts is None or len(pts) < 2:
            continue
        rot, trns = tfrms[i]
        gbl = _transform_profile(pts, rot, trns)
        gbl[:, 0] -= z_origin
        surface_curves.append([[float(p[0]), float(p[1])] for p in gbl])

    # Ray polylines
    fld = osp.field_of_view.fields[0]
    grid_def = [np.array([-1.0, -1.0]), np.array([1.0, 1.0]), num_rays]
    pupil_coords = list(sampler.grid_ray_generator(grid_def))
    ray_list = analyses.trace_ray_list(
        opt_model, pupil_coords, fld, wvl_nm, foc=0.0, check_apertures=True
    )

    extend_left = 50.0
    rays = []
    for _, _, ray_result in ray_list:
        if ray_result is None:
            continue
        ray = ray_result[mc.ray]
        poly = _ray_to_polyline(
            ray,
            tfrms,
            extend_parallel_back=extend_left,
            extend_to_focus=True,
            focus_z=focus_z,
            z_origin=z_origin,
        )
        if len(poly) > 1:
            rays.append(poly)

    # Performance
    spot_xy, dxdy = run_spot_diagram(opt_model, num_rays=num_rays, fld=0, wvl=wvl_nm)
    valid = ~np.isnan(dxdy[:, 0])
    rms_x = float(np.sqrt(np.nanmean(dxdy[valid, 0] ** 2))) if np.any(valid) else 0.0
    rms_y = float(np.sqrt(np.nanmean(dxdy[valid, 1] ** 2))) if np.any(valid) else 0.0
    rms_spot_radius = float(np.sqrt(rms_x**2 + rms_y**2))
    total_length = float(sum(s[1] for s in surf_data_list))
    f_number = float(fod.fno) if fod and fod.efl != 0 else 0.0

    metrics_sweep = _precompute_metrics_sweep(rays, num_points=100)

    return {
        "rays": rays,
        "surfaces": surface_curves,
        "focusZ": float(focus_z),
        "zOrigin": float(z_origin),
        "performance": {
            "rmsSpotRadius": rms_spot_radius,
            "totalLength": total_length,
            "fNumber": f_number,
        },
        "metricsSweep": metrics_sweep,
    }
