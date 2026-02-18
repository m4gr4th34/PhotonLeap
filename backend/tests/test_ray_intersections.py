"""Unit tests for ray intersection calculations."""

import pytest

# Skip if trace_service cannot be imported (rayoptics dependency)
try:
    from backend.trace_service import run_trace
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
