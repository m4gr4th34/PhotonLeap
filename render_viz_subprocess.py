#!/usr/bin/env python3
"""
Standalone script to render optical layout to PNG. Run as subprocess to isolate
Kaleido/Chromium from the main app (avoids app relaunch when Kaleido spawns browser).
Usage: python render_viz_subprocess.py <input.json> <output.png>
"""

import sys
import os
import json

# Ensure script directory is on path
_script_dir = os.path.dirname(os.path.abspath(__file__))
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

if __name__ != "__main__":
    sys.exit(1)

if len(sys.argv) != 3:
    sys.stderr.write("Usage: render_viz_subprocess.py <input.json> <output.png>\n")
    sys.exit(2)

input_path = sys.argv[1]
output_path = sys.argv[2]

try:
    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)
except Exception as e:
    sys.stderr.write("Failed to read input: {}\n".format(e))
    sys.exit(3)

surf_data_list = data["surf_data_list"]
wvl_nm = data["wvl_nm"]
surface_diameters = data.get("surface_diameters")

# NumPy 2.0 fix
import numpy as _np
if not hasattr(_np, "NaN"):
    _np.NaN = _np.nan

# Stub rayoptics.gui.appcmds before any opticalmodel import
import types
if "rayoptics.gui.appcmds" not in sys.modules:
    gui_mod = sys.modules.get("rayoptics.gui")
    if gui_mod is None:
        gui_mod = types.ModuleType("rayoptics.gui")
        import rayoptics
        gui_mod.__path__ = [os.path.join(os.path.dirname(rayoptics.__file__), "gui")]
        sys.modules["rayoptics.gui"] = gui_mod
    stub = types.ModuleType("rayoptics.gui.appcmds")
    stub.open_model = lambda *a, **k: (_ for _ in ()).throw(NotImplementedError("headless"))
    sys.modules["rayoptics.gui.appcmds"] = stub

from singlet_rayoptics import build_singlet_from_surface_data
from optics_visualization import render_optical_layout

opt_model = build_singlet_from_surface_data(
    surf_data_list, wvl_nm=wvl_nm, surface_diameters=surface_diameters
)
render_optical_layout(
    opt_model, wvl_nm=wvl_nm, num_rays=11,
    output_path=output_path, figsize=(8, 4), dpi=100
)
sys.exit(0)
