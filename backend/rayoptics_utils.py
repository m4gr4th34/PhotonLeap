"""
Optical utility functions for ray tracing.
"""

from typing import Optional

import numpy as np


def snell_law(n1: float, n2: float, theta1_rad: float) -> Optional[float]:
    """
    Compute refraction angle (theta2) from Snell's law: n1*sin(theta1) = n2*sin(theta2).

    Args:
        n1: Refractive index of incident medium
        n2: Refractive index of transmitted medium
        theta1_rad: Angle of incidence in radians (0 = normal incidence)

    Returns:
        Angle of refraction in radians, or None if total internal reflection occurs.
    """
    sin_theta1 = np.sin(theta1_rad)
    sin_theta2 = n1 * sin_theta1 / n2
    if sin_theta2 > 1.0 or sin_theta2 < -1.0:
        return None  # Total internal reflection
    return np.arcsin(sin_theta2)
