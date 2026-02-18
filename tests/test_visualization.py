"""Tests for optics_visualization."""
import logging
import pytest

logger = logging.getLogger(__name__)

try:
    from singlet_rayoptics import build_singlet_from_surface_data
    from optics_visualization import render_optical_layout
    RAYOPTICS_AVAILABLE = True
except ImportError:
    RAYOPTICS_AVAILABLE = False

pytestmark = pytest.mark.skipif(
    not RAYOPTICS_AVAILABLE,
    reason="rayoptics/optics_visualization import failed (circular import in headless mode)",
)


@pytest.fixture
def simple_opt_model():
    """Build a minimal opt_model for visualization tests."""
    surf_data = [
        [0.01, 5.0, 1.5168, 64.2],
        [-0.01, 95.0, 1.0, 0.0],
    ]
    return build_singlet_from_surface_data(surf_data, wvl_nm=587.6)


class TestRenderOpticalLayout:
    """Tests for render_optical_layout."""

    def test_render_returns_png_buffer(self, simple_opt_model):
        buf = render_optical_layout(simple_opt_model, wvl_nm=587.6, num_rays=5)
        assert buf is not None
        assert len(buf) > 100
        assert buf[:8] == b"\x89PNG\r\n\x1a\n"
        logger.info("render_optical_layout returned PNG buffer of %d bytes", len(buf))

    def test_render_to_file(self, simple_opt_model, tmp_path):
        out_path = tmp_path / "layout.png"
        result = render_optical_layout(
            simple_opt_model, wvl_nm=587.6, output_path=str(out_path)
        )
        assert out_path.exists()
        assert out_path.stat().st_size > 100
        logger.info("Rendered to %s (%d bytes)", out_path, out_path.stat().st_size)
