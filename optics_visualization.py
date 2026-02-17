#!/usr/bin/env python3
"""
Generate a 2D visualization of the optical setup: lenses, wave propagation,
and traced rays extending to the focal point.
"""

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

from rayoptics.optical import model_constants as mc
from rayoptics.raytr import sampler
from rayoptics.raytr import analyses


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
    """
    Convert ray segments to (z, y) polyline in display coords (z relative to z_origin).
    Skips object-at-infinity; extends backward from first surface and forward to focus.
    Uses incoming direction (segment 0) for parallel backward extension.
    """
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
        pts.append([z_disp, p_glob[1]])
        if i == 1 and extend_parallel_back > 0 and len(pts) == 1:
            # Use incoming direction from segment 0 (object->surface 1), not refracted
            d_in = ray[0][mc.d] if len(ray) > 0 else d
            rot0, _ = tfrms[0]
            d_glob = rot0.dot(d_in)
            dz, dy = d_glob[2], d_glob[1]
            if abs(dz) > 1e-6:
                z0, y0 = z_disp, p_glob[1]
                z_back = z0 - extend_parallel_back * (dz / abs(dz))
                y_back = y0 - extend_parallel_back * (dy / abs(dz))
                pts.insert(0, [z_back, y_back])
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
    return pts


def render_optical_layout(opt_model, wvl_nm=None, num_rays=9, output_path=None,
                          figsize=(10, 5), dpi=100):
    """
    Render optical layout: filled lens elements, wave propagation (wavefronts),
    traced rays, extending to the focal point.
    Uses first real surface as z=0 to avoid object-at-infinity scale issues.
    """
    sm = opt_model.seq_model
    osp = opt_model.optical_spec
    wvl = wvl_nm or osp.spectral_region.central_wvl
    tfrms = sm.gbl_tfrms

    fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
    ax.set_facecolor('#fafafa')

    z_origin = tfrms[1][1][2] if len(tfrms) > 1 else 0
    try:
        parax = opt_model['analysis_results']['parax_data']
        fod = parax.fod if parax else None
    except (KeyError, TypeError):
        fod = None
    bfl = fod.bfl if (fod and fod.efl != 0) else 50.0
    if not np.isfinite(bfl) or bfl <= 0:
        bfl = 50.0
    # Focal point: paraxial focus (last surface + BFL), not image plane
    last_surf_z = tfrms[-2][1][2] if len(tfrms) >= 2 else tfrms[-1][1][2]
    focus_z = (last_surf_z + bfl - z_origin) if tfrms else 0

    z_min, z_max = 0, 0
    y_extent = 5.0
    lens_idx = 0

    # 1. Draw lens elements as filled polygons (glass regions)
    for i in range(len(sm.ifcs) - 1):
        if i >= len(tfrms) or i >= len(sm.gaps):
            break
        gap = sm.gaps[i]
        try:
            n = gap.medium.rindex(wvl)
        except Exception:
            n = 1.0
        if n < 1.01:
            continue
        ifc1, ifc2 = sm.ifcs[i], sm.ifcs[i + 1]
        if ifc1.interact_mode == 'dummy' or ifc2.interact_mode == 'dummy':
            continue
        try:
            sd1 = ifc1.surface_od()
            sd2 = ifc2.surface_od()
        except Exception:
            sd1 = sd2 = 5.0
        sd = min(sd1, sd2, 100.0)
        if sd <= 0:
            sd = 5.0

        pts1 = _profile_points(ifc1, sd)
        pts2 = _profile_points(ifc2, sd)
        if pts1 is None or pts2 is None or len(pts1) < 2 or len(pts2) < 2:
            continue

        gbl1 = _transform_profile(pts1, tfrms[i][0], tfrms[i][1])
        gbl2 = _transform_profile(pts2, tfrms[i + 1][0], tfrms[i + 1][1])
        gbl1[:, 0] -= z_origin
        gbl2[:, 0] -= z_origin
        poly = np.vstack([gbl1, gbl2[::-1]])
        ax.fill(poly[:, 0], poly[:, 1], color='#87ceeb', alpha=0.5,
                edgecolor='#2c5282', linewidth=1.5, zorder=3)
        lens_idx += 1
        lens_z = (gbl1[0, 0] + gbl2[0, 0]) / 2
        ax.text(lens_z, 0, 'Lens {}'.format(lens_idx), fontsize=8,
                color='#2c5282', ha='center', va='center', zorder=7)

        for z_pos in [tfrms[i][1][2], tfrms[i + 1][1][2]]:
            if abs(z_pos) <= 1e6:
                z_d = z_pos - z_origin
                z_min = min(z_min, z_d - sd)
                z_max = max(z_max, z_d + sd)
        y_extent = max(y_extent, sd * 1.3)

    # 2. Draw surface outlines (for any surfaces not part of filled lens)
    for i, ifc in enumerate(sm.ifcs):
        if i >= len(tfrms):
            break
        if ifc.interact_mode == 'dummy':
            continue
        try:
            sd = ifc.surface_od()
        except Exception:
            sd = 5.0
        if sd <= 0:
            sd = 5.0
        sd = min(sd, 100.0)
        pts = _profile_points(ifc, sd)
        if pts is None or len(pts) < 2:
            continue
        rot, trns = tfrms[i]
        gbl = _transform_profile(pts, rot, trns)
        gbl[:, 0] -= z_origin
        ax.plot(gbl[:, 0], gbl[:, 1], 'k-', linewidth=1.2, zorder=4)

    for i in range(len(tfrms)):
        z_pos = tfrms[i][1][2]
        if abs(z_pos) <= 1e6:
            z_d = z_pos - z_origin
            z_min = min(z_min, z_d)
            z_max = max(z_max, z_d)

    system_length = max(z_max - z_min, 10.0)
    extend_left = system_length * 0.3
    extend_right = bfl + system_length * 0.1
    z_min -= extend_left
    z_max = max(z_max, focus_z + extend_right)

    # 3. Trace rays
    fld = osp.field_of_view.fields[0]
    grid_def = [np.array([-1., -1.]), np.array([1., 1.]), num_rays]
    pupil_coords = list(sampler.grid_ray_generator(grid_def))
    ray_list = analyses.trace_ray_list(
        opt_model, pupil_coords, fld, wvl, foc=0.0,
        check_apertures=True
    )

    # 4. Draw wave propagation: input wavefront (vertical line)
    wavefront_z = -extend_left * 0.5
    ax.axvline(wavefront_z, color='#3b82f6', linestyle='-', linewidth=1.2,
               alpha=0.7, zorder=2)

    ray_polys = []
    for _, _, ray_result in ray_list:
        if ray_result is None:
            continue
        ray = ray_result[mc.ray]
        poly = _ray_to_polyline(ray, tfrms, extend_parallel_back=extend_left,
                                extend_to_focus=True, focus_z=focus_z,
                                z_origin=z_origin)
        if len(poly) > 1:
            ray_polys.append(poly)
            ax.plot(poly[:, 0], poly[:, 1], color='#2563eb', alpha=0.7,
                    linewidth=1.0, zorder=5)

    # Extend y_extent to include all rays
    if ray_polys:
        max_ray_y = max(np.max(np.abs(p[:, 1])) for p in ray_polys)
        y_extent = max(y_extent, max_ray_y * 1.2, 5.0)

    # 5. Draw output wavefront (spherical, converging to focus) as arc
    if focus_z is not None and len(ray_polys) > 0:
        r = bfl * 0.3
        theta = np.linspace(-np.pi / 2.5, np.pi / 2.5, 25)
        wf_z = focus_z - r * np.cos(theta)
        wf_y = r * np.sin(theta)
        ax.plot(wf_z, wf_y, color='#059669', linestyle='-', linewidth=1.2,
                alpha=0.8, zorder=2)

    # 6. Focal point marker
    ax.axvline(focus_z, color='#dc2626', linestyle='--', linewidth=1.0,
               alpha=0.8, zorder=2)
    ax.scatter([focus_z], [0], color='#dc2626', s=30, zorder=6, marker='o')

    ax.axhline(0, color='#6b7280', linestyle='--', linewidth=0.8, zorder=1)

    # 7. Labels
    ax.text(wavefront_z - 5, y_extent * 0.85, 'Input\nwavefront',
            fontsize=8, color='#3b82f6', ha='right', va='top')
    if ray_polys:
        mid_z = (wavefront_z + focus_z) / 2
        ax.text(mid_z, y_extent * 0.9, 'Rays', fontsize=8, color='#2563eb',
                ha='center', va='top')
    ax.text(focus_z + 5, 0, 'Focus', fontsize=8, color='#dc2626',
            ha='left', va='center')
    if focus_z is not None and len(ray_polys) > 0:
        wf_mid_z = focus_z - bfl * 0.15
        ax.text(wf_mid_z, y_extent * 0.85, 'Output\nwavefront',
                fontsize=8, color='#059669', ha='center', va='top')

    z_margin = (z_max - z_min) * 0.02 if z_max > z_min else 1.0
    ax.set_xlim(z_min - z_margin, z_max + z_margin)
    ax.set_ylim(-y_extent, y_extent)
    ax.set_xlabel('z (mm)')
    ax.set_ylabel('y (mm)')
    ax.set_title('Optical layout: lenses, wave propagation, rays to focus')
    ax.set_aspect('auto')
    plt.tight_layout()

    if output_path:
        fig.savefig(output_path, dpi=dpi, bbox_inches='tight')
        plt.close(fig)
        return output_path
    else:
        import io
        buf = io.BytesIO()
        fig.savefig(buf, format='png', dpi=dpi, bbox_inches='tight')
        plt.close(fig)
        return buf.getvalue()
