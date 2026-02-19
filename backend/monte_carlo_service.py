"""
Monte Carlo sensitivity analysis: run N iterations with jittered surface parameters
within tolerance, return spot positions at image plane for point cloud visualization.
"""

import sys
import os
import random
import numpy as np

_backend_dir = os.path.dirname(os.path.abspath(__file__))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from trace_service import optical_stack_to_surf_data
from singlet_rayoptics import build_singlet_from_surface_data, get_focal_length, run_spot_diagram


def _jitter_surfaces(surfaces, rng=None, only_surface_idx=None):
    """
    Create a copy of surfaces with radius and thickness jittered within their tolerances.
    Uses uniform distribution in [-tolerance, +tolerance].
    If only_surface_idx is set, jitter only that surface (for sensitivity analysis).
    """
    rng = rng or random.Random()
    jittered = []
    for i, s in enumerate(surfaces):
        surf = dict(s)
        if only_surface_idx is not None and i != only_surface_idx:
            jittered.append(surf)
            continue
        r_tol = float(s.get("radiusTolerance") or 0)
        t_tol = float(s.get("thicknessTolerance") or 0)
        if r_tol > 0:
            surf["radius"] = float(s["radius"]) + rng.uniform(-r_tol, r_tol)
        if t_tol > 0:
            surf["thickness"] = float(s["thickness"]) + rng.uniform(-t_tol, t_tol)
            surf["thickness"] = max(0.01, surf["thickness"])
        jittered.append(surf)
    return jittered


def _run_single_monte_carlo(optical_stack, surfaces_list, rng, num_rays, epd, wvl_nm, field_angles):
    """Run one Monte Carlo iteration and return spots + focus_z. Returns (spots, focus_z) or (None, 0)."""
    surf_data_list = optical_stack_to_surf_data(surfaces_list, wvl_nm=wvl_nm)
    surface_diameters = [float(s.get("diameter", 25) or 25) for s in surfaces_list]
    try:
        opt_model = build_singlet_from_surface_data(
            surf_data_list,
            wvl_nm=wvl_nm,
            radius_mode=False,
            object_distance=1e10,
            epd=epd,
            surface_diameters=surface_diameters,
        )
    except Exception:
        return None, 0.0
    if field_angles:
        osp = opt_model.optical_spec
        fov = osp.field_of_view
        fov.set_from_list([float(a) for a in field_angles])
        if fov.value == 0:
            fov.value = 1.0
        opt_model.update_model()
        opt_model.optical_spec.update_optical_properties()
    try:
        spot_xy, dxdy = run_spot_diagram(
            opt_model, num_rays=num_rays, fld=0, wvl=wvl_nm, foc=0.0
        )
    except Exception:
        return None, 0.0
    valid = ~np.isnan(dxdy[:, 0])
    spots = [[float(spot_xy[idx, 0]), float(spot_xy[idx, 1])] for idx in range(len(spot_xy)) if valid[idx]]
    sm = opt_model.seq_model
    tfrms = sm.gbl_tfrms
    z_origin = tfrms[1][1][2] if len(tfrms) > 1 else 0
    efl, fod = get_focal_length(opt_model)
    bfl = fod.bfl if (fod and fod.efl != 0) else 50.0
    if not np.isfinite(bfl):
        bfl = 50.0
    last_surf_z = tfrms[-2][1][2] if len(tfrms) >= 2 else tfrms[-1][1][2]
    focus_z = last_surf_z + bfl - z_origin
    return spots, focus_z


def run_monte_carlo(optical_stack: dict, iterations: int = 100) -> dict:
    """
    Run Monte Carlo sensitivity analysis.

    For each iteration:
      - Jitter radius and thickness for each surface within their tolerances
      - Build optical model and run spot diagram
      - Collect spot (x,y) positions at image plane for all rays

    Returns:
        spots: list of [x, y] in mm at image plane (one per ray per iteration)
        focusZ: nominal focus Z (mm), relative to zOrigin
        imagePlaneZ: Z position of image plane
        rmsSpread: RMS radius of the point cloud (mm)
        numValid: number of valid rays across all iterations
        error: optional error message if something failed
    """
    surfaces = optical_stack.get("surfaces", [])
    if not surfaces:
        return {"error": "No surfaces", "spots": [], "focusZ": 0, "imagePlaneZ": 0, "rmsSpread": 0, "numValid": 0}

    num_rays = int(optical_stack.get("numRays", 9) or 9)
    epd = float(optical_stack.get("entrancePupilDiameter", 10) or 10)
    wvl_nm = float(optical_stack.get("wavelengths", [587.6])[0] or 587.6)
    rng = random.Random(42)

    all_spots = []
    focus_z = 0.0
    z_origin = 0.0
    last_error = None

    field_angles = optical_stack.get("fieldAngles", [0])
    for i in range(iterations):
        jittered_surfaces = _jitter_surfaces(surfaces, rng)
        spots, foc_z = _run_single_monte_carlo(
            optical_stack, jittered_surfaces, rng, num_rays, epd, wvl_nm, field_angles
        )
        if spots is None:
            last_error = "Trace failed"
            continue
        all_spots.extend(spots)
        if i == 0:
            focus_z = foc_z

    if not all_spots:
        return {
            "error": last_error or "No valid traces",
            "spots": [],
            "focusZ": focus_z,
            "imagePlaneZ": focus_z,
            "rmsSpread": 0.0,
            "numValid": 0,
        }

    spots_arr = np.array(all_spots)
    cx = float(np.mean(spots_arr[:, 0]))
    cy = float(np.mean(spots_arr[:, 1]))
    rms_spread = float(np.sqrt(np.mean((spots_arr[:, 0] - cx) ** 2 + (spots_arr[:, 1] - cy) ** 2)))

    # Per-surface sensitivity: jitter one surface at a time, measure RMS spread
    sensitivity_iterations = 20
    sensitivity_by_surface = [0.0] * len(surfaces)
    for surf_idx in range(len(surfaces)):
        s = surfaces[surf_idx]
        if (float(s.get("radiusTolerance") or 0) <= 0 and float(s.get("thicknessTolerance") or 0) <= 0:
            continue
        surf_spots = []
        for _ in range(sensitivity_iterations):
            jittered = _jitter_surfaces(surfaces, rng, only_surface_idx=surf_idx)
            spots_single, _ = _run_single_monte_carlo(
                optical_stack, jittered, rng, num_rays, epd, wvl_nm, field_angles
            )
            if spots_single:
                surf_spots.extend(spots_single)
        if surf_spots:
            arr = np.array(surf_spots)
            scx = float(np.mean(arr[:, 0]))
            scy = float(np.mean(arr[:, 1]))
            sensitivity_by_surface[surf_idx] = float(
                np.sqrt(np.mean((arr[:, 0] - scx) ** 2 + (arr[:, 1] - scy) ** 2))
            )

    return {
        "spots": [[float(p[0]), float(p[1])] for p in all_spots],
        "focusZ": focus_z,
        "imagePlaneZ": focus_z,
        "rmsSpread": rms_spread,
        "numValid": len(all_spots),
        "sensitivityBySurface": sensitivity_by_surface,
    }
