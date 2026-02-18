#!/usr/bin/env python3
"""
Singlet lens analysis with rayoptics: surface data -> sequential ray trace,
focal length, and spot diagram.
"""

import numpy as np
from rayoptics.optical.opticalmodel import OpticalModel
from rayoptics.raytr import trace
from rayoptics.raytr import sampler
from rayoptics.raytr import analyses


def build_singlet_from_surface_data(surf_data_list, wvl_nm=587.6, radius_mode=False,
                                    epd=None, object_distance=1e10,
                                    surface_diameters=None):
    """
    Build an OpticalModel for a singlet from a list of surface data.

    surf_data_list: list of [curvature_or_radius, thickness, n, v] per surface.
        For radius_mode=True, first column is radius (1/radius -> curvature).
    wvl_nm: design wavelength (nm).
    radius_mode: if True, surf_data_list uses radius instead of curvature.
    epd: entrance pupil diameter (mm). If None, taken from paraxial model later.
    object_distance: thickness of object gap (mm). Use large value for infinity.
    surface_diameters: optional list of diameter (mm) per surface; sets aperture.

    Returns:
        opt_model: OpticalModel with seq_model built and parax_data updated.
    """
    opt_model = OpticalModel(radius_mode=radius_mode, specsheet=None, do_init=True)
    sm = opt_model.seq_model

    # Object space: set object gap thickness (e.g. infinity)
    sm.gaps[0].thi = object_distance

    # Add each surface: [curvature, thickness, n, v] (or radius if radius_mode)
    for surf_data in surf_data_list:
        sm.add_surface(surf_data, wvl=wvl_nm)

    # Set surface diameters (semi-diameter = diameter/2) if provided
    if surface_diameters:
        for i, d in enumerate(surface_diameters):
            if d is not None and d > 0 and i + 1 < len(sm.ifcs):
                sm.ifcs[i + 1].set_max_aperture(d / 2.0)
        if epd is None and surface_diameters and surface_diameters[0] and surface_diameters[0] > 0:
            epd = surface_diameters[0]

    # Stop at first real surface (index 1)
    sm.cur_surface = 1
    sm.set_stop()

    # Set wavelength for optical spec
    osp = opt_model.optical_spec
    if not hasattr(osp.spectral_region, 'wavelengths') or not osp.spectral_region.wavelengths:
        osp.spectral_region.set_from_list([('d', 1.0)])
    osp.spectral_region.central_wvl = wvl_nm
    if epd is not None:
        osp.pupil.value = epd

    # Sync seq_model (rndx, delta_n, transforms) before paraxial computation
    opt_model.update_model()

    # Compute paraxial data (needed for focal length and for ray tracing)
    opt_model.optical_spec.update_optical_properties()

    return opt_model


def get_focal_length(opt_model):
    """Return effective focal length (mm) and first-order summary."""
    parax = opt_model['analysis_results']['parax_data']
    if parax is None:
        return None, None
    fod = parax.fod
    return fod.efl, fod


def get_ray_trace_table(opt_model, num_rays=11, fld=0, wvl=None, foc=0.0):
    """
    Return ray-trace data as a list of dicts for DataFrame display.
    Columns: Ray, Pupil X, Pupil Y, Y at S1 (mm), Slope (1/mm), Angle (deg),
             Spot X (mm), Spot Y (mm), Trans DX (mm), Trans DY (mm).
    """
    from rayoptics.optical import model_constants as mc
    osp = opt_model.optical_spec
    fld_obj = osp.field_of_view.fields[fld]
    wvl = wvl or osp.spectral_region.central_wvl
    tfrms = opt_model.seq_model.gbl_tfrms

    grid_def = [np.array([-1., -1.]), np.array([1., 1.]), num_rays]
    pupil_coords = list(sampler.grid_ray_generator(grid_def))
    ray_list = analyses.trace_ray_list(
        opt_model, pupil_coords, fld_obj, wvl, foc, check_apertures=True
    )
    ray_list_data = analyses.focus_pupil_coords(
        opt_model, ray_list, fld_obj, wvl, foc
    )
    ref_sphere, _ = trace.setup_pupil_coords(opt_model, fld_obj, wvl, foc)
    ref_pt = ref_sphere[0]
    dxdy = np.array([r[:2] for r in ray_list_data])
    spot_xy = ref_pt[:2] + dxdy

    rows = []
    for idx, (_, _, ray_result) in enumerate(ray_list):
        if ray_result is None:
            continue
        px, py = pupil_coords[idx]
        ray = ray_result[mc.ray]
        if len(ray) < 2 or idx >= len(spot_xy):
            continue
        # First real surface intercept (segment 1)
        seg = ray[1]
        p = seg[mc.p]
        d = seg[mc.d]
        rot, trns = tfrms[1]
        p_glob = rot.dot(p) + trns
        y_s1 = p_glob[1]
        dz, dy = rot.dot(d)[2], rot.dot(d)[1]
        slope = (dy / dz) if abs(dz) > 1e-12 else np.nan
        angle_deg = np.degrees(np.arctan(slope)) if np.isfinite(slope) else np.nan

        rows.append({
            "Ray": idx + 1,
            "Pupil X": round(px, 4),
            "Pupil Y": round(py, 4),
            "Y at S1 (mm)": round(y_s1, 4),
            "Slope (1/mm)": round(slope, 6) if np.isfinite(slope) else np.nan,
            "Angle (deg)": round(angle_deg, 4) if np.isfinite(angle_deg) else np.nan,
            "Spot X (mm)": round(spot_xy[idx, 0], 6),
            "Spot Y (mm)": round(spot_xy[idx, 1], 6),
            "Trans DX (mm)": round(dxdy[idx, 0], 6),
            "Trans DY (mm)": round(dxdy[idx, 1], 6),
        })
    return rows


def run_spot_diagram(opt_model, num_rays=21, fld=0, wvl=None, foc=0.0):
    """
    Run sequential ray trace for a grid in the pupil; return spot (x,y) and dx,dy.

    Returns:
        spot_xy: (N, 2) array of spot positions (x, y) in image plane (mm).
        spot_dxdy: (N, 2) transverse aberration (dx, dy) vs chief ray.
    """
    osp = opt_model.optical_spec
    fld_obj = osp.field_of_view.fields[fld]
    wvl = wvl or osp.spectral_region.central_wvl

    # Grid of rays in pupil (normalized -1..1)
    grid_def = [np.array([-1., -1.]), np.array([1., 1.]), num_rays]
    pupil_coords = list(sampler.grid_ray_generator(grid_def))

    # Trace and refocus to get spot positions and transverse aberration
    ray_list = analyses.trace_ray_list(
        opt_model, pupil_coords, fld_obj, wvl, foc, check_apertures=True
    )
    ray_list_data = analyses.focus_pupil_coords(
        opt_model, ray_list, fld_obj, wvl, foc
    )
    # ray_list_data: (N, 3) with last dim = (dx, dy, opd); we want (x,y) = ref + (dx,dy)
    ref_sphere, _ = trace.setup_pupil_coords(opt_model, fld_obj, wvl, foc)
    ref_pt = ref_sphere[0]
    dxdy = np.array([r[:2] for r in ray_list_data])
    spot_xy = ref_pt[:2] + dxdy
    return spot_xy, dxdy


def calculate_and_format_results(surf_data_list, wvl_nm=587.6, return_opt_model=False,
                                 surface_diameters=None):
    """
    Build model from surface data, run analysis, return formatted result string.
    surf_data_list: list of [curvature, thickness, n, v] per surface.
    return_opt_model: if True, return (result_string, opt_model); else result_string.
    surface_diameters: optional list of diameter (mm) per surface.
    Returns multi-line string suitable for display in GUI.
    """
    lines = []
    try:
        lines.append("Wavelength: {:.1f} nm".format(wvl_nm))
        lines.append("")
        opt_model = build_singlet_from_surface_data(
            surf_data_list, wvl_nm=wvl_nm, radius_mode=False, object_distance=1e10,
            surface_diameters=surface_diameters
        )
        efl, fod = get_focal_length(opt_model)
        if efl is not None:
            sm = opt_model.seq_model
            last_surf_z = sm.gbl_tfrms[-2][1][2] if len(sm.gbl_tfrms) >= 2 else 0
            focal_point_z = last_surf_z + fod.bfl
            lines.append("Focal length (EFL): {:.4f} mm".format(efl))
            lines.append("Back focal length (BFL): {:.4f} mm".format(fod.bfl))
            lines.append("Front focal length (FFL): {:.4f} mm".format(fod.ffl))
            lines.append("F-number: {:.4f}".format(fod.fno))
            lines.append("Focal point (z): {:.4f} mm  (from 1st surface; matches BFL)".format(focal_point_z))
        spot_xy, dxdy = run_spot_diagram(opt_model, num_rays=11, fld=0, wvl=wvl_nm)
        valid = ~np.isnan(dxdy[:, 0])
        if np.any(valid):
            lines.append("")
            lines.append("Spot diagram:")
            lines.append("  Spot X (mm): min={:.6f} max={:.6f}".format(
                np.nanmin(spot_xy[valid, 0]), np.nanmax(spot_xy[valid, 0])))
            lines.append("  Spot Y (mm): min={:.6f} max={:.6f}".format(
                np.nanmin(spot_xy[valid, 1]), np.nanmax(spot_xy[valid, 1])))
            lines.append("  Transverse aberration DX (mm) RMS: {:.6f}".format(
                np.sqrt(np.nanmean(dxdy[valid, 0]**2))))
            lines.append("  Transverse aberration DY (mm) RMS: {:.6f}".format(
                np.sqrt(np.nanmean(dxdy[valid, 1]**2))))
        result = "\n".join(lines)
        if not result.strip():
            result = "No results: focal length or spot data unavailable.\nCheck surface data (radius, thickness, material) and try 1–2 real surfaces."
        if return_opt_model:
            return result, opt_model
        return result
    except ZeroDivisionError as e:
        msg = (
            "Division by zero: the optical configuration may be invalid.\n\n"
            "Common causes:\n"
            "• Afocal system (parallel in, parallel out)\n"
            "• Zero or infinite focal length\n"
            "• Use n=1 for air gaps between lenses (not n=2)\n\n"
            "Check material values: air should be 1, glass typically 1.5–1.7."
        )
        if return_opt_model:
            return msg, None
        return msg
    except Exception as e:
        if return_opt_model:
            return "Error: " + str(e), None
        return "Error: " + str(e)


def main():
    # Example: singlet with two surfaces
    # [curvature (1/mm), thickness (mm), n, V]
    # Front: R=100 mm -> c=0.01; center thickness 5 mm; N-BK7 n≈1.5168, V≈64.2
    # Back:  R=-100 mm; BFL ~95 mm
    singlet_surf_data = [
        [0.01,  5.0,  1.5168, 64.2],   # front surface, center thickness
        [-0.01, 95.0, 1.0,    0.0],   # back surface, thickness to image
    ]

    wvl = 587.6  # nm
    opt_model = build_singlet_from_surface_data(
        singlet_surf_data, wvl_nm=wvl, radius_mode=False, object_distance=1e10
    )

    # Focal length
    efl, fod = get_focal_length(opt_model)
    if efl is not None:
        print("Focal length (efl): {:.4f} mm".format(efl))
        print("BFL: {:.4f} mm".format(fod.bfl))
        print("FFL: {:.4f} mm".format(fod.ffl))

    # Spot diagram (sequential ray trace)
    spot_xy, dxdy = run_spot_diagram(opt_model, num_rays=11, fld=0, wvl=wvl)
    valid = ~np.isnan(dxdy[:, 0])
    if np.any(valid):
        print("\nSpot diagram (sample):")
        print("  Spot X (mm): min={:.6f} max={:.6f}".format(
            np.nanmin(spot_xy[valid, 0]), np.nanmax(spot_xy[valid, 0])))
        print("  Spot Y (mm): min={:.6f} max={:.6f}".format(
            np.nanmin(spot_xy[valid, 1]), np.nanmax(spot_xy[valid, 1])))
        print("  Transverse aberration DX (mm): RMS={:.6f}".format(
            np.sqrt(np.nanmean(dxdy[valid, 0]**2))))
        print("  Transverse aberration DY (mm): RMS={:.6f}".format(
            np.sqrt(np.nanmean(dxdy[valid, 1]**2))))


if __name__ == "__main__":
    main()
