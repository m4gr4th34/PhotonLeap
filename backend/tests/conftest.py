"""Pytest configuration for backend tests."""

import os
import sys

# Ensure project root is on PYTHONPATH for backend imports
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)
