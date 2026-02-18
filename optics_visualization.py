#!/usr/bin/env python3
"""
Generate a 2D visualization of the optical setup: lenses, wave propagation,
and traced rays extending to the focal point.
Uses Plotly (graph_objects) for modern, interactive rendering.
"""

import io
import numpy as np
import plotly.graph_objects as go

from rayoptics.optical import model_constants as mc
from rayoptics.raytr import sampler
from rayoptics.raytr import analyses


# Light blue glass color with 0.3 opacity
LENS_FILL = "rgba(135, 206, 235, 0.3)"  # light blue, semi-transparent
LENS_LINE = "rgba(44, 82, 130, 0.8)"


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


def _ray_slope_intercept(poly):
    """Compute slope (dy/dz) and y-intercept for a ray polyline. Uses first two points."""
    if len(poly) < 2:
        return None, None
    z1, y1 = poly[0, 0], poly[0, 1]
    z2, y2 = poly[1, 0], poly[1, 1]
    dz = z2 - z1
    if abs(dz) < 1e-12:
        return None, y1
    slope = (y2 - y1) / dz
    y_intercept = y1 - slope * z1
    return slope, y_intercept


def render_optical_layout(opt_model, wvl_nm=None, num_rays=9, output_path=None,
                          figsize=(10, 5), dpi=100, template="plotly_white", return_html=False):
    """
    Render optical layout: filled lens elements, wave propagation (wavefronts),
    traced rays, extending to the focal point.
    Uses Plotly graph_objects for modern, interactive visualization.

    Styling:
    - Lenses: light blue semi-transparent glass (opacity=0.3)
    - Rays: individual traces with hover showing slope and y-intercept
    - Focus: glowing red dot with halo effect
    - Grid: subtle dot grid (gridcolor='lightgray')
    - Fixed 1:1 aspect ratio for y and z axes
    - Template: 'plotly_white' (default) or 'plotly_dark'
    """
    sm = opt_model.seq_model
    osp = opt_model.optical_spec
    wvl = wvl_nm or osp.spectral_region.central_wvl
    tfrms = sm.gbl_tfrms

    z_origin = tfrms[1][1][2] if len(tfrms) > 1 else 0
    try:
        parax = opt_model['analysis_results']['parax_data']
        fod = parax.fod if parax else None
    except (KeyError, TypeError):
        fod = None
    bfl = fod.bfl if (fod and fod.efl != 0) else 50.0
    if not np.isfinite(bfl):
        bfl = 50.0
    last_surf_z = tfrms[-2][1][2] if len(tfrms) >= 2 else tfrms[-1][1][2]
    image_plane_z = tfrms[-1][1][2] - z_origin if tfrms else 0

    # Focal point
    focus_z = None
    if bfl > 0:
        focus_z = last_surf_z + bfl - z_origin
    elif parax is not None and len(parax) >= 1:
        ax_ray = parax[0]
        crossings = []
        for i in range(1, min(len(ax_ray), len(tfrms)) - 1):
            h0, h1 = ax_ray[i][mc.ht], ax_ray[i + 1][mc.ht]
            if h0 * h1 <= 0 and (h0 != 0 or h1 != 0):
                z0 = tfrms[i][1][2] - z_origin
                z1 = tfrms[i + 1][1][2] - z_origin
                if abs(h1 - h0) > 1e-12:
                    z_cross = z0 - h0 * (z1 - z0) / (h1 - h0)
                else:
                    z_cross = (z0 + z1) / 2
                crossings.append(z_cross)
        if crossings:
            focus_z = crossings[0]
    if focus_z is None:
        focus_z = (last_surf_z + bfl - z_origin) if bfl > 0 else image_plane_z

    z_min, z_max = 0, 0
    y_extent = 5.0
    lens_idx = 0

    fig = go.Figure()

    # 1. Lens elements as filled polygons (glass look, opacity=0.3)
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
        # Close polygon for fill='toself'
        poly_closed = np.vstack([poly, poly[0:1]])

        fig.add_trace(go.Scatter(
            x=poly_closed[:, 0],
            y=poly_closed[:, 1],
            mode="lines",
            fill="toself",
            fillcolor=LENS_FILL,
            line=dict(color=LENS_LINE, width=1.5),
            name=f"Lens {lens_idx + 1}",
            showlegend=False,
        ))
        lens_idx += 1

        for z_pos in [tfrms[i][1][2], tfrms[i + 1][1][2]]:
            if abs(z_pos) <= 1e6:
                z_d = z_pos - z_origin
                z_min = min(z_min, z_d - sd)
                z_max = max(z_max, z_d + sd)
        y_extent = max(y_extent, sd * 1.3)

    # 2. Surface outlines
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
        fig.add_trace(go.Scatter(
            x=gbl[:, 0],
            y=gbl[:, 1],
            mode="lines",
            line=dict(color="rgba(0,0,0,0.8)", width=1.2),
            showlegend=False,
            hoverinfo="skip",
        ))

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

    wavefront_z = -extend_left * 0.5

    def _ray_inside_all_apertures(ray):
        for i, seg in enumerate(ray):
            if i >= len(sm.ifcs) or i >= len(tfrms):
                break
            ifc = sm.ifcs[i]
            if ifc.interact_mode == 'dummy':
                continue
            try:
                p = seg[mc.p]
                rot, trns = tfrms[i]
                p_glob = rot.dot(p) + trns
                r = np.sqrt(p_glob[0]**2 + p_glob[1]**2)
                sd = ifc.surface_od()
                if r > sd + 1e-6:
                    return False
            except (IndexError, TypeError, AttributeError, ZeroDivisionError):
                continue
        return True

    ray_polys = []
    for ray_idx, (_, _, ray_result) in enumerate(ray_list):
        if ray_result is None:
            continue
        ray = ray_result[mc.ray]
        if not _ray_inside_all_apertures(ray):
            continue
        poly = _ray_to_polyline(ray, tfrms, extend_parallel_back=extend_left,
                                extend_to_focus=True, focus_z=focus_z,
                                z_origin=z_origin)
        if len(poly) > 1:
            ray_polys.append(poly)
            slope, y_int = _ray_slope_intercept(poly)
            slope_str = f"{slope:.4f}" if slope is not None else "—"
            y_int_str = f"{y_int:.4f} mm" if y_int is not None else "—"
            hover = f"Ray {ray_idx + 1}<br>Slope: {slope_str}<br>y-intercept: {y_int_str}"
            fig.add_trace(go.Scatter(
                x=poly[:, 0],
                y=poly[:, 1],
                mode="lines",
                line=dict(color="rgba(37, 99, 235, 0.8)", width=1.2),
                name=f"Ray {ray_idx + 1}",
                customdata=[[slope_str, y_int_str]],
                hovertemplate=hover + "<extra></extra>",
                showlegend=False,
            ))

    if ray_polys:
        max_ray_y = max(np.max(np.abs(p[:, 1])) for p in ray_polys)
        y_extent = max(y_extent, max_ray_y * 1.2, 5.0)

    # 4. Input wavefront (vertical line)
    fig.add_trace(go.Scatter(
        x=[wavefront_z, wavefront_z],
        y=[-y_extent, y_extent],
        mode="lines",
        line=dict(color="rgba(59, 130, 246, 0.7)", width=1.2),
        showlegend=False,
        hoverinfo="skip",
    ))

    # 5. Output wavefront arc
    if focus_z is not None and len(ray_polys) > 0:
        r = abs(bfl) * 0.3
        theta = np.linspace(-np.pi / 2.5, np.pi / 2.5, 25)
        wf_z = focus_z - r * np.cos(theta)
        wf_y = r * np.sin(theta)
        fig.add_trace(go.Scatter(
            x=wf_z,
            y=wf_y,
            mode="lines",
            line=dict(color="rgba(5, 150, 105, 0.8)", width=1.2),
            showlegend=False,
            hoverinfo="skip",
        ))

    # 6. Optical axis
    fig.add_trace(go.Scatter(
        x=[z_min, z_max],
        y=[0, 0],
        mode="lines",
        line=dict(color="rgba(107, 114, 128, 0.6)", width=0.8, dash="dot"),
        showlegend=False,
        hoverinfo="skip",
    ))

    # 7. Focal point: halo + glowing dot
    halo_size = 20
    fig.add_trace(go.Scatter(
        x=[focus_z],
        y=[0],
        mode="markers",
        marker=dict(
            size=halo_size,
            color="rgba(220, 38, 38, 0.35)",
            line=dict(width=0),
            symbol="circle",
        ),
        name="Focus (halo)",
        showlegend=False,
        hoverinfo="skip",
    ))
    fig.add_trace(go.Scatter(
        x=[focus_z],
        y=[0],
        mode="markers",
        marker=dict(
            size=10,
            color="rgb(220, 38, 38)",
            line=dict(width=2, color="rgba(255, 100, 100, 0.8)"),
            symbol="circle",
        ),
        name="Focus",
        hovertemplate="Focus<br>z = %{x:.2f} mm<extra></extra>",
        showlegend=False,
    ))

    z_margin = (z_max - z_min) * 0.02 if z_max > z_min else 1.0
    x_range = [z_min - z_margin, z_max + z_margin]
    y_range = [-y_extent, y_extent]

    # Layout: modern grid, fixed aspect, template
    fig.update_layout(
        template=template,
        xaxis=dict(
            title="z (mm)",
            range=x_range,
            scaleanchor="y",
            scaleratio=1,
            gridcolor="lightgray",
            griddash="dot",
            zeroline=False,
            showgrid=True,
        ),
        yaxis=dict(
            title="y (mm)",
            range=y_range,
            gridcolor="lightgray",
            griddash="dot",
            zeroline=False,
            showgrid=True,
        ),
        plot_bgcolor="white" if template == "plotly_white" else None,
        paper_bgcolor="white" if template == "plotly_white" else None,
        margin=dict(l=60, r=40, t=50, b=50),
        title="Optical layout: lenses, wave propagation, rays to focus",
        showlegend=False,
    )

    # Export: HTML for WebView (no Kaleido) or PNG for file/tests
    width_px = int(figsize[0] * dpi)
    height_px = int(figsize[1] * dpi)

    if return_html:
        # to_html() needs no Kaleido/Chromium - safe for embedded WebView
        return fig.to_html(include_plotlyjs=True, full_html=True,
                          config={"responsive": True})
    if output_path:
        fig.write_image(output_path, width=width_px, height=height_px, scale=1)
        return output_path
    buf = io.BytesIO()
    fig.write_image(buf, format="png", width=width_px, height=height_px, scale=1)
    return buf.getvalue()
