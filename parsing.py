#!/usr/bin/env python3
"""
Parsing utilities for surface input fields. Extracted for testability.
"""


def parse_material(s):
    """Parse material string 'n' or 'n,V' -> (n, V). Default V=0."""
    s = (s or "").strip()
    if not s:
        return 1.0, 0.0
    parts = [p.strip() for p in s.replace(",", " ").split()]
    n = float(parts[0]) if parts else 1.0
    v = float(parts[1]) if len(parts) > 1 else 0.0
    return n, v


def parse_radius(s):
    """Parse radius (mm). 0 or empty -> curvature 0 (flat)."""
    s = (s or "").strip()
    if not s:
        return 0.0
    r = float(s)
    if r == 0:
        return 0.0
    return 1.0 / r


def parse_thickness(s):
    """Parse thickness (mm)."""
    s = (s or "").strip()
    return float(s) if s else 0.0


def parse_wavelength(s):
    """Parse wavelength (nm). Default 587.6 (d-line)."""
    s = (s or "").strip()
    if not s:
        return 587.6
    return float(s)


def parse_diameter(s):
    """Parse diameter (mm). None if empty (use model default)."""
    s = (s or "").strip()
    if not s:
        return None
    return float(s)
