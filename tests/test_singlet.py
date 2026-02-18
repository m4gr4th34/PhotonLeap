"""Integration tests for singlet_rayoptics."""
import logging
import pytest

logger = logging.getLogger(__name__)

# Skip if rayoptics/singlet cannot be imported
try:
    from singlet_rayoptics import (
        build_singlet_from_surface_data,
        get_focal_length,
        calculate_and_format_results,
        run_spot_diagram,
    )
    RAYOPTICS_AVAILABLE = True
except ImportError:
    RAYOPTICS_AVAILABLE = False

pytestmark = pytest.mark.skipif(
    not RAYOPTICS_AVAILABLE,
    reason="rayoptics/singlet import failed",
)


@pytest.fixture
def simple_singlet_data():
    """Standard singlet: R=100 front, R=-100 back, 5mm thick, N-BK7."""
    return [
        [0.01, 5.0, 1.5168, 64.2],
        [-0.01, 95.0, 1.0, 0.0],
    ]


class TestBuildSinglet:
    """Tests for build_singlet_from_surface_data and calculate_and_format_results."""

    def test_build_simple_singlet(self, simple_singlet_data):
        opt_model = build_singlet_from_surface_data(
            simple_singlet_data, wvl_nm=587.6, radius_mode=False
        )
        efl, fod = get_focal_length(opt_model)
        assert efl is not None
        assert abs(efl) > 0
        assert fod.bfl > 0
        logger.info("Simple singlet: EFL=%.2f, BFL=%.2f", efl, fod.bfl)

    def test_calculate_and_format_returns_string(self, simple_singlet_data):
        result = calculate_and_format_results(simple_singlet_data, wvl_nm=587.6)
        assert isinstance(result, str)
        assert "Focal length" in result
        assert "BFL" in result or "Back focal" in result
        logger.info("calculate_and_format_results returns %d chars", len(result))

    def test_spot_diagram_shape(self, simple_singlet_data):
        opt_model = build_singlet_from_surface_data(
            simple_singlet_data, wvl_nm=587.6
        )
        spot_xy, dxdy = run_spot_diagram(opt_model, num_rays=9)
        assert spot_xy.shape[0] > 0
        assert spot_xy.shape[1] == 2
        assert dxdy.shape == spot_xy.shape
        logger.info("Spot diagram: %d rays", spot_xy.shape[0])
