"""Unit tests for ray intersection calculations."""

import pytest

# Skip if trace_service cannot be imported (rayoptics dependency)
try:
    from backend.trace_service import run_trace, get_metrics_at_z
    TRACE_AVAILABLE = True
except ImportError:
    TRACE_AVAILABLE = False

pytestmark = pytest.mark.skipif(
    not TRACE_AVAILABLE,
    reason="trace_service/rayoptics import failed",
)


@pytest.fixture
def three_surface_optical_stack():
    """Optical system with 3 surfaces: plano-convex, plano, image."""
    return {
        "surfaces": [
            {
                "id": "s1",
                "type": "Glass",
                "radius": 100,
                "thickness": 5,
                "refractiveIndex": 1.5168,
                "diameter": 25,
                "material": "N-BK7",
                "description": "Front surface",
            },
            {
                "id": "s2",
                "type": "Air",
                "radius": -100,
                "thickness": 2,
                "refractiveIndex": 1.0,
                "diameter": 25,
                "material": "Air",
                "description": "Back surface",
            },
            {
                "id": "s3",
                "type": "Air",
                "radius": 0,
                "thickness": 93,
                "refractiveIndex": 1.0,
                "diameter": 25,
                "material": "Air",
                "description": "Image plane",
            },
        ],
        "entrancePupilDiameter": 10,
        "wavelengths": [587.6],
        "fieldAngles": [0],
        "numRays": 9,
    }


class TestThreeSurfaceRayIntersections:
    """Tests that a 3-surface system correctly calculates ray intersections (z, y)."""

    def test_run_trace_returns_rays_and_surfaces(self, three_surface_optical_stack):
        """run_trace should return rays and surfaces without error."""
        result = run_trace(three_surface_optical_stack)
        assert "error" not in result or result.get("error") is None
        assert "rays" in result
        assert "surfaces" in result
        assert isinstance(result["rays"], list)
        assert isinstance(result["surfaces"], list)

    def test_ray_count_matches_request(self, three_surface_optical_stack):
        """Number of rays should be consistent with numRays (grid produces multiple rays)."""
        result = run_trace(three_surface_optical_stack)
        num_rays = three_surface_optical_stack["numRays"]
        # Grid ray generator produces num_rays^2 or similar; expect at least num_rays rays
        assert len(result["rays"]) >= num_rays

    def test_each_ray_has_z_y_coordinates(self, three_surface_optical_stack):
        """Each ray should be a list of [z, y] points."""
        result = run_trace(three_surface_optical_stack)
        for ray in result["rays"]:
            assert isinstance(ray, list)
            assert len(ray) >= 2
            for pt in ray:
                assert len(pt) == 2
                z, y = pt
                assert isinstance(z, (int, float))
                assert isinstance(y, (int, float))

    def test_z_coordinates_increase_along_optical_axis(self, three_surface_optical_stack):
        """Ray z values should increase monotonically (left to right along optical axis)."""
        result = run_trace(three_surface_optical_stack)
        for ray in result["rays"]:
            z_vals = [pt[0] for pt in ray]
            for i in range(1, len(z_vals)):
                assert z_vals[i] >= z_vals[i - 1] - 0.01  # Allow small tolerance

    def test_entrance_pupil_diameter_respected(self, three_surface_optical_stack):
        """First ray segment y values should be within ±EPD/2."""
        epd = three_surface_optical_stack["entrancePupilDiameter"]
        half_epd = epd / 2
        result = run_trace(three_surface_optical_stack)
        for ray in result["rays"]:
            # First point(s) represent entrance pupil; y should be within aperture
            y_vals = [pt[1] for pt in ray[:3]]  # Check first few points
            for y in y_vals:
                assert abs(y) <= half_epd + 1.0  # Small tolerance for extended rays

    def test_surface_curves_returned_for_three_surfaces(self, three_surface_optical_stack):
        """Should return surface profile curves for all 3 surfaces."""
        result = run_trace(three_surface_optical_stack)
        surfaces = result["surfaces"]
        assert len(surfaces) >= 2  # At least 2 refractive surfaces
        for surf in surfaces:
            assert isinstance(surf, list)
            assert len(surf) >= 2
            for pt in surf:
                assert len(pt) == 2
                assert isinstance(pt[0], (int, float))
                assert isinstance(pt[1], (int, float))

    def test_focus_z_returned(self, three_surface_optical_stack):
        """Result should include focusZ."""
        result = run_trace(three_surface_optical_stack)
        assert "focusZ" in result
        assert isinstance(result["focusZ"], (int, float))
        assert result["focusZ"] > 0

    def test_metrics_sweep_returned(self, three_surface_optical_stack):
        """Result should include metricsSweep with 100 precomputed points."""
        result = run_trace(three_surface_optical_stack)
        assert "metricsSweep" in result
        sweep = result["metricsSweep"]
        assert isinstance(sweep, list)
        assert len(sweep) == 100
        for pt in sweep:
            assert "z" in pt
            assert "rmsRadius" in pt
            assert "beamWidth" in pt
            assert "chiefRayAngle" in pt
            assert "yCentroid" in pt
            assert "numRays" in pt


class TestGetMetricsAtZ:
    """Tests for get_metrics_at_z interpolation and metrics calculation."""

    def test_rms_radius_formula(self):
        """RMS = sqrt(1/N * sum((y_i - y_centroid)^2))."""
        # Simple ray data: 3 rays at z=10 with y = -1, 0, 1 -> centroid=0, RMS=sqrt(2/3)
        rays = [
            [[0, -1], [20, -1]],
            [[0, 0], [20, 0]],
            [[0, 1], [20, 1]],
        ]
        m = get_metrics_at_z(10, rays)
        assert m["rmsRadius"] is not None
        expected_rms = (2 / 3) ** 0.5  # variance = 2/3, RMS = sqrt(2/3)
        assert abs(m["rmsRadius"] - expected_rms) < 1e-6
        assert m["yCentroid"] == 0.0

    def test_beam_width(self):
        """Beam width = max Y - min Y."""
        rays = [
            [[0, -2], [20, -2]],
            [[0, 3], [20, 3]],
        ]
        m = get_metrics_at_z(10, rays)
        assert m["beamWidth"] == 5.0

    def test_chief_ray_angle(self):
        """Chief ray (smallest |y| at start) angle in degrees."""
        rays = [
            [[0, -5], [10, -3]],   # slope = 0.2
            [[0, 0], [10, 2]],     # chief ray, slope = 0.2
            [[0, 5], [10, 7]],
        ]
        m = get_metrics_at_z(5, rays)
        assert m["chiefRayAngle"] is not None
        import math
        expected_deg = math.degrees(math.atan(0.2))
        assert abs(m["chiefRayAngle"] - expected_deg) < 0.01

    def test_empty_rays_returns_none(self):
        """Empty ray data returns None metrics."""
        m = get_metrics_at_z(10, [])
        assert m["rmsRadius"] is None
        assert m["beamWidth"] is None
        assert m["chiefRayAngle"] is None
        assert m["numRays"] == 0
