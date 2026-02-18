"""Pytest configuration and fixtures."""
import logging
import os
import sys
import types

# Ensure project root is on PYTHONPATH for backend imports
_project_root = os.path.dirname(os.path.abspath(__file__))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

# NumPy 2.0 removed np.NaN; rayoptics uses it. Restore alias.
import numpy as _np
if not hasattr(_np, "NaN"):
    _np.NaN = _np.nan

# Break rayoptics circular import: stub appcmds before opticalmodel loads.
# Must run before any test imports singlet_rayoptics.
if "rayoptics.gui.appcmds" not in sys.modules:
    try:
        _ro = __import__("rayoptics", fromlist=[])
        _gui_dir = os.path.join(os.path.dirname(_ro.__file__), "gui")
        if sys.modules.get("rayoptics.gui") is None:
            _gui_mod = types.ModuleType("rayoptics.gui")
            _gui_mod.__path__ = [_gui_dir]
            sys.modules["rayoptics.gui"] = _gui_mod
        _stub = types.ModuleType("rayoptics.gui.appcmds")
        def _open_model_stub(*args, **kwargs):
            raise NotImplementedError("open_model not available in test mode")
        _stub.open_model = _open_model_stub
        sys.modules["rayoptics.gui.appcmds"] = _stub
    except Exception:
        pass


def pytest_configure(config):
    """Configure logging for test runs."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )
    logging.getLogger().setLevel(logging.INFO)
