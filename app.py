#!/usr/bin/env python3
"""
Streamlit web app for lens ray-optics analysis.
Dynamic multi-surface editor; main area dedicated to optical layout visualization.
"""

import sys
import os
import types

# Ensure script directory is on path
_script_dir = os.path.dirname(os.path.abspath(__file__))
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

# Stub rayoptics.gui.appcmds before any opticalmodel import (breaks circular import)
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

# NumPy 2.0 fix for rayoptics
import numpy as np
if not hasattr(np, "NaN"):
    np.NaN = np.nan

import streamlit as st
import pandas as pd

def recalc_z_positions(optical_stack):
    """
    Recalculate Z-Position for every surface as sum of preceding thicknesses.
    Updates surfaces in place. Surface 0: Z=0, Surface 1: Z=t0, Surface 2: Z=t0+t1, ...
    """
    z = 0.0
    for s in optical_stack:
        s["Z-Position"] = round(z, 4)
        z += float(s.get("Thickness", 0) or 0)


def add_surface(index, radius, thickness, material):
    """
    Insert a surface at the given index in optical_stack using list.insert().
    material: "Glass" (n=1.5168), "Air" (n=1.0), or numeric refractive index.
    """
    n_map = {"Glass": 1.5168, "Air": 1.0}
    try:
        n = n_map.get(material, float(material)) if isinstance(material, str) else float(material)
    except (TypeError, ValueError):
        n = 1.0
    surf_type = "Glass" if n > 1.01 else "Air"
    new_element = {"Type": surf_type, "Radius": float(radius), "Thickness": float(thickness), "Refractive Index": n}
    st.session_state.optical_stack.insert(index, new_element)


def sort_by_z_position(optical_stack):
    """
    Reorder surfaces by cumulative Z (distance from source).
    Z = sum of thicknesses of all preceding surfaces.
    """
    if len(optical_stack) <= 1:
        return optical_stack
    z_and_surf = []
    z = 0.0
    for s in optical_stack:
        z_and_surf.append((z, dict(s)))
        z += float(s.get("Thickness", 0) or 0)
    return [s for _, s in sorted(z_and_surf, key=lambda x: x[0])]


def _safe_float(val, default):
    """Extract float from value; use default only when missing or invalid."""
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return default
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _normalize_record(r):
    """Ensure a record has valid defaults for all fields (handles new rows from + button)."""
    if not isinstance(r, dict):
        return {"Type": "Air", "Radius": 0.0, "Thickness": 10.0, "Refractive Index": 1.0}
    t = r.get("Type")
    return {
        "Type": t if t in ("Glass", "Air") else "Air",
        "Radius": _safe_float(r.get("Radius"), 0.0),
        "Thickness": _safe_float(r.get("Thickness"), 10.0),
        "Refractive Index": _safe_float(r.get("Refractive Index"), 1.0),
    }


def surfaces_to_surf_data(surfaces):
    surf_data_list = []
    for row in surfaces:
        r = float(row.get("Radius", 0) or 0)
        t = float(row.get("Thickness", 0) or 0)
        n = float(row.get("Refractive Index", 1) or 1)
        curvature = 1.0 / r if r != 0 else 0.0
        v = 64.2 if (row.get("Type") == "Glass") else 0.0
        surf_data_list.append([curvature, t, n, v])
    return surf_data_list


st.set_page_config(page_title="Lens Ray-Optics Calculator", layout="wide")

# --- Session state: optical_stack (single source of truth) ---
if "optical_stack" not in st.session_state:
    st.session_state.optical_stack = [
        {"Type": "Glass", "Radius": 100.0, "Thickness": 5.0, "Refractive Index": 1.5168},
        {"Type": "Air", "Radius": -100.0, "Thickness": 95.0, "Refractive Index": 1.0},
    ]
    recalc_z_positions(st.session_state.optical_stack)

# Trace only runs when user clicks "Trace Rays" (avoids flicker while typing)
if "trace_requested" not in st.session_state:
    st.session_state.trace_requested = True

# --- Sidebar: global params + surface table ---
with st.sidebar:
    st.header("Lens Parameters")
    st.markdown("Configure the optical system. Radius in mm (0 = flat).")

    wvl_nm = st.number_input(
        "Wavelength (nm)",
        min_value=300.0,
        max_value=2000.0,
        value=587.6,
        step=1.0,
        help="Design wavelength, e.g. 587.6 for d-line",
    )
    num_rays = st.slider("Number of rays", 3, 21, 11, 2)
    show_grid = st.toggle("Toggle Grid", value=True, help="Show technical grid / clean canvas")

    st.divider()
    st.subheader("Surfaces")

    stack = st.session_state.optical_stack
    recalc_z_positions(stack)

    # Insert Surface toolbar
    insert_options = [f"Insert after surface {i}" for i in range(len(stack))]
    if not insert_options:
        insert_options = ["Insert at position 0"]
    insert_col, plus_col, clear_col, sort_col = st.columns([2, 1, 1, 1])
    with insert_col:
        insert_after = st.selectbox(
            "Insert after surface…",
            options=insert_options,
            index=len(insert_options) - 1 if insert_options else 0,
            key="insert_surface_select",
        )
    with plus_col:
        insert_clicked = st.button("➕", help="Insert surface at selected position", key="insert_plus")
    with clear_col:
        clear_clicked = st.button("Clear All", width="stretch")
    with sort_col:
        sort_clicked = st.button("Sort by Z", width="stretch", help="Sort by distance from source")

    def _invalidate_cache():
        for k in ("cached_fig", "cached_results", "cached_ray_table", "cached_error"):
            st.session_state.pop(k, None)

    if insert_clicked:
        if len(stack) == 0:
            add_surface(0, 0.0, 10.0, "Air")
        else:
            idx = insert_options.index(insert_after)
            add_surface(idx + 1, 0.0, 10.0, "Air")
        recalc_z_positions(st.session_state.optical_stack)
        if "my_editor" in st.session_state:
            del st.session_state["my_editor"]
        _invalidate_cache()
        st.rerun()
    if clear_clicked:
        st.session_state.optical_stack = [
            {"Type": "Air", "Radius": 0.0, "Thickness": 10.0, "Refractive Index": 1.0},
        ]
        recalc_z_positions(st.session_state.optical_stack)
        if "my_editor" in st.session_state:
            del st.session_state["my_editor"]
        _invalidate_cache()
        st.rerun()
    if sort_clicked:
        st.session_state.optical_stack = sort_by_z_position(st.session_state.optical_stack)
        recalc_z_positions(st.session_state.optical_stack)
        if "my_editor" in st.session_state:
            del st.session_state["my_editor"]
        _invalidate_cache()
        st.rerun()

    df = pd.DataFrame(st.session_state.optical_stack)
    with st.container():
        edited_df = st.data_editor(
            df,
            key="my_editor",
            column_config={
                "Z-Position": st.column_config.NumberColumn(
                    "Z-Position (mm)",
                    format="%.2f",
                    help="Calculated from preceding thicknesses (read-only)",
                ),
                "Type": st.column_config.SelectboxColumn(
                    "Type",
                    options=["Glass", "Air"],
                    required=True,
                ),
                "Radius": st.column_config.NumberColumn(
                    "Radius (mm)",
                    format="%.2f",
                    default=0.0,
                ),
                "Thickness": st.column_config.NumberColumn(
                    "Thickness (mm)",
                    format="%.2f",
                    default=10.0,
                ),
                "Refractive Index": st.column_config.NumberColumn(
                    "Refractive Index",
                    format="%.3f",
                    default=1.0,
                ),
            },
            column_order=["Z-Position", "Type", "Radius", "Thickness", "Refractive Index"],
            disabled=["Z-Position"],
            width="stretch",
            hide_index=True,
            num_rows="dynamic",
        )

    # Sync from data_editor return value (reliable; on_change was receiving stale data)
    if edited_df is not None:
        if len(edited_df) == 0:
            st.session_state.optical_stack = []
        else:
            records_raw = edited_df.to_dict("records")
            records = [_normalize_record(r) for r in records_raw if r is not None]
            st.session_state.optical_stack = records
            recalc_z_positions(st.session_state.optical_stack)

# --- Main area: header + visualization ---
st.title("Lens Ray-Optics Calculator")
st.markdown(
    "Edit the surface table in the sidebar, then click **Trace Rays** to run the analysis. "
    "The visualization updates only when you trace, so you can type without flickering."
)
st.markdown("---")

# Trace Rays button: triggers ray-trace (does not run on every keystroke)
trace_clicked = st.button("Trace Rays", type="primary")
if trace_clicked:
    st.session_state.trace_requested = True

surfaces = st.session_state.optical_stack
if not surfaces:
    st.warning("Add at least one surface to run the analysis.")
elif st.session_state.trace_requested:
    st.session_state.trace_requested = False
    try:
        surf_data_list = surfaces_to_surf_data(surfaces)
        surface_diameters = [10.0] * len(surfaces)

        from singlet_rayoptics import (
            build_singlet_from_surface_data,
            calculate_and_format_results,
            get_ray_trace_table,
        )
        from optics_visualization import render_optical_layout

        opt_model = build_singlet_from_surface_data(
            surf_data_list, wvl_nm=wvl_nm, surface_diameters=surface_diameters
        )
        results_text = calculate_and_format_results(
            surf_data_list, wvl_nm=wvl_nm, surface_diameters=surface_diameters
        )
        fig = render_optical_layout(
            opt_model, wvl_nm=wvl_nm, num_rays=num_rays,
            return_figure=True, figsize=(12, 6), show_grid=show_grid
        )
        ray_table = get_ray_trace_table(opt_model, num_rays=num_rays, wvl=wvl_nm)

        st.session_state.cached_fig = fig
        st.session_state.cached_results = results_text
        st.session_state.cached_ray_table = ray_table
        st.session_state.cached_error = None
    except Exception as e:
        st.session_state.cached_error = str(e)
        st.session_state.cached_fig = None
        st.session_state.cached_results = None
        st.session_state.cached_ray_table = None

# Show cached results (or error)
if surfaces:
    if "cached_error" in st.session_state and st.session_state.cached_error:
        st.error(st.session_state.cached_error)
        st.info("Check that radius, thickness, and refractive index are valid. Use n=1 for air.")
    elif "cached_fig" in st.session_state and st.session_state.cached_fig is not None:
        st.plotly_chart(st.session_state.cached_fig, width="stretch")
        with st.expander("Numerical results"):
            st.code(st.session_state.cached_results, language=None)
        with st.expander("Technical Specifications", expanded=False):
            if st.session_state.cached_ray_table:
                st.dataframe(pd.DataFrame(st.session_state.cached_ray_table), width="stretch", hide_index=True)
            else:
                st.info("No ray-trace data available.")
    else:
        st.info("Click **Trace Rays** to run the analysis.")
