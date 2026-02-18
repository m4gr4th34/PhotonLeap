#!/usr/bin/env python3
"""
Streamlit web app for lens ray-optics analysis.
Inputs in sidebar; main area dedicated to optical layout visualization.
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
from parsing import parse_radius, parse_material, parse_thickness, parse_wavelength, parse_diameter


def build_surf_data_from_inputs(s1_radius, s1_thick, s1_n, s1_v, s1_diam,
                                s2_radius, s2_thick, s2_n, s2_v, s2_diam):
    """Build surf_data_list and surface_diameters from sidebar inputs."""
    c1 = parse_radius(str(s1_radius) if s1_radius is not None else "0")
    t1 = parse_thickness(str(s1_thick) if s1_thick is not None else "5")
    n1, v1 = parse_material(str(s1_n) if s1_n is not None else "1.5168")
    if s1_v is not None:
        v1 = float(s1_v)
    d1 = parse_diameter(str(s1_diam) if s1_diam is not None else "")

    c2 = parse_radius(str(s2_radius) if s2_radius is not None else "0")
    t2 = parse_thickness(str(s2_thick) if s2_thick is not None else "95")
    n2, v2 = parse_material(str(s2_n) if s2_n is not None else "1")
    if s2_v is not None:
        v2 = float(s2_v)
    d2 = parse_diameter(str(s2_diam) if s2_diam is not None else "")

    surf_data_list = [[c1, t1, n1, v1], [c2, t2, n2, v2]]
    surface_diameters = [d1, d2]
    return surf_data_list, surface_diameters


st.set_page_config(page_title="Lens Ray-Optics Calculator", layout="wide")

# --- Sidebar: all inputs ---
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
    st.subheader("Surface 1 (front)")
    s1_radius = st.number_input("Radius (mm)", value=100.0, step=1.0, key="s1_r")
    s1_thick = st.number_input("Thickness (mm)", value=5.0, step=0.5, key="s1_t")
    s1_n = st.number_input("Refractive index n", value=1.5168, step=0.01, key="s1_n")
    s1_v = st.number_input("Abbe number V", value=64.2, step=0.1, key="s1_v")
    s1_diam = st.number_input("Diameter (mm)", value=10.0, step=1.0, key="s1_d")

    st.divider()
    st.subheader("Surface 2 (back)")
    s2_radius = st.number_input("Radius (mm)", value=-100.0, step=1.0, key="s2_r")
    s2_thick = st.number_input("Thickness (mm)", value=95.0, step=1.0, key="s2_t")
    s2_n = st.number_input("Refractive index n", value=1.0, step=0.01, key="s2_n")
    s2_v = st.number_input("Abbe number V", value=0.0, step=0.1, key="s2_v")
    s2_diam = st.number_input("Diameter (mm)", value=10.0, step=1.0, key="s2_d")

# --- Main area: header + visualization ---
st.title("Lens Ray-Optics Calculator")
st.markdown(
    "Interactive optical layout and ray trace for a singlet lens. "
    "Adjust parameters in the sidebar to explore focal length, back focal length, "
    "and ray propagation through the system."
)
st.markdown("---")

# Build model and render
try:
    surf_data_list, surface_diameters = build_surf_data_from_inputs(
        s1_radius, s1_thick, s1_n, s1_v, s1_diam,
        s2_radius, s2_thick, s2_n, s2_v, s2_diam,
    )

    from singlet_rayoptics import (
        build_singlet_from_surface_data,
        calculate_and_format_results,
        get_ray_trace_table,
    )
    from optics_visualization import render_optical_layout
    import pandas as pd

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

    st.plotly_chart(fig, use_container_width=True)

    with st.expander("Numerical results"):
        st.code(results_text, language=None)

    with st.expander("Technical Specifications", expanded=False):
        ray_table = get_ray_trace_table(opt_model, num_rays=num_rays, wvl=wvl_nm)
        if ray_table:
            df = pd.DataFrame(ray_table)
            st.dataframe(df, use_container_width=True, hide_index=True)
        else:
            st.info("No ray-trace data available.")

except Exception as e:
    st.error(f"Error: {e}")
    st.info("Check that radius, thickness, and refractive index are valid. Use n=1 for air.")
