"""Unit tests for Snell's law refraction angle calculation."""

import math
import pytest
from backend.rayoptics_utils import snell_law


class TestSnellLaw:
    """Tests for snell_law function."""

    def test_normal_incidence_returns_zero(self):
        """Normal incidence (theta1=0) should give theta2=0 regardless of n1, n2."""
        assert snell_law(1.0, 1.5, 0.0) == 0.0
        assert snell_law(1.5, 1.0, 0.0) == 0.0
        assert snell_law(1.0, 1.5168, 0.0) == 0.0

    def test_air_to_glass_refraction(self):
        """Ray from air (n=1) into glass (n≈1.5) bends toward normal."""
        theta1 = math.radians(30)
        theta2 = snell_law(1.0, 1.5, theta1)
        assert theta2 is not None
        assert abs(theta2) < abs(theta1)
        # n1*sin(theta1) = n2*sin(theta2)
        assert abs(1.0 * math.sin(theta1) - 1.5 * math.sin(theta2)) < 1e-10

    def test_glass_to_air_refraction(self):
        """Ray from glass (n≈1.5) into air (n=1) bends away from normal."""
        theta1 = math.radians(20)
        theta2 = snell_law(1.5, 1.0, theta1)
        assert theta2 is not None
        assert abs(theta2) > abs(theta1)
        assert abs(1.5 * math.sin(theta1) - 1.0 * math.sin(theta2)) < 1e-10

    def test_same_index_no_refraction(self):
        """When n1 == n2, theta2 == theta1."""
        theta1 = math.radians(45)
        theta2 = snell_law(1.0, 1.0, theta1)
        assert theta2 is not None
        assert abs(theta2 - theta1) < 1e-10

    def test_total_internal_reflection_returns_none(self):
        """When sin(theta2) would exceed 1, total internal reflection -> None."""
        # Critical angle for glass (1.5) to air (1): theta_c = arcsin(1/1.5) ≈ 41.8°
        theta1 = math.radians(50)  # Beyond critical angle
        theta2 = snell_law(1.5, 1.0, theta1)
        assert theta2 is None

    def test_below_critical_angle_succeeds(self):
        """Just below critical angle should succeed (no total internal reflection)."""
        theta_crit = math.asin(1.0 / 1.5)  # ~41.8°
        theta1 = theta_crit - 0.01
        theta2 = snell_law(1.5, 1.0, theta1)
        assert theta2 is not None
        # Refraction angle should be valid and satisfy Snell's law
        assert abs(1.5 * math.sin(theta1) - 1.0 * math.sin(theta2)) < 1e-10

    def test_negative_angle_symmetry(self):
        """Negative incidence angle should give symmetric negative refraction."""
        theta1_pos = math.radians(30)
        theta1_neg = -theta1_pos
        theta2_pos = snell_law(1.0, 1.5, theta1_pos)
        theta2_neg = snell_law(1.0, 1.5, theta1_neg)
        assert theta2_pos is not None and theta2_neg is not None
        assert abs(theta2_neg - (-theta2_pos)) < 1e-10

    def test_nbk7_typical_angle(self):
        """N-BK7 (n≈1.5168) at 30° from air."""
        theta1 = math.radians(30)
        theta2 = snell_law(1.0, 1.5168, theta1)
        assert theta2 is not None
        # Expected: sin(theta2) = sin(30°)/1.5168 ≈ 0.3297 -> theta2 ≈ 19.25°
        expected = math.asin(math.sin(theta1) / 1.5168)
        assert abs(theta2 - expected) < 1e-10
