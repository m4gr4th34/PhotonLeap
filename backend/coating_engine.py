"""
CoatingEngine: Backward-compatible wrapper around coatings service.
Import from coatings.py for new code.
"""

from coatings import get_reflectivity, is_hr_coating, get_all_coatings

__all__ = ["get_reflectivity", "is_hr_coating", "get_all_coatings"]
