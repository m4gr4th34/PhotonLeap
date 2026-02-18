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
        return {"error": "No surfaces provided", "rays": [], "surfaces": [], "focusZ": 0}

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
        return {"error": str(e), "rays": [], "surfaces": [], "focusZ": 0}

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
    }
