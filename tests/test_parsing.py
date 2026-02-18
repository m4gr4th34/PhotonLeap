"""Tests for parsing utilities."""
import logging
import pytest
from parsing import (
    parse_material,
    parse_radius,
    parse_thickness,
    parse_wavelength,
    parse_diameter,
)

logger = logging.getLogger(__name__)


class TestParseMaterial:
    """Tests for parse_material."""

    def test_empty_returns_air(self):
        n, v = parse_material("")
        assert n == 1.0
        assert v == 0.0
        logger.info("parse_material('') -> (1.0, 0.0)")

    def test_n_only(self):
        n, v = parse_material("1.5168")
        assert n == 1.5168
        assert v == 0.0
        logger.info("parse_material('1.5168') -> (1.5168, 0.0)")

    def test_n_and_v_comma(self):
        n, v = parse_material("1.5168,64.2")
        assert n == 1.5168
        assert v == 64.2
        logger.info("parse_material('1.5168,64.2') -> (1.5168, 64.2)")

    def test_n_and_v_space(self):
        n, v = parse_material("1.5168 64.2")
        assert n == 1.5168
        assert v == 64.2

    def test_whitespace_stripped(self):
        n, v = parse_material("  1.5 , 60  ")
        assert n == 1.5
        assert v == 60.0


class TestParseRadius:
    """Tests for parse_radius."""

    def test_empty_returns_zero(self):
        assert parse_radius("") == 0.0
        logger.info("parse_radius('') -> 0.0")

    def test_zero_returns_zero(self):
        assert parse_radius("0") == 0.0

    def test_positive_radius(self):
        c = parse_radius("100")
        assert abs(c - 0.01) < 1e-9

    def test_negative_radius(self):
        c = parse_radius("-25.84")
        assert abs(c - (-1 / 25.84)) < 1e-9


class TestParseThickness:
    """Tests for parse_thickness."""

    def test_empty_returns_zero(self):
        assert parse_thickness("") == 0.0
        logger.info("parse_thickness('') -> 0.0")

    def test_valid_thickness(self):
        assert parse_thickness("5") == 5.0
        assert parse_thickness("43.594") == 43.594


class TestParseWavelength:
    """Tests for parse_wavelength."""

    def test_empty_returns_default(self):
        assert parse_wavelength("") == 587.6
        logger.info("parse_wavelength('') -> 587.6")

    def test_valid_wavelength(self):
        assert parse_wavelength("587.6") == 587.6
        assert parse_wavelength("656.3") == 656.3


class TestParseDiameter:
    """Tests for parse_diameter."""

    def test_empty_returns_none(self):
        assert parse_diameter("") is None
        logger.info("parse_diameter('') -> None")

    def test_valid_diameter(self):
        assert parse_diameter("25") == 25.0
        assert parse_diameter("10.5") == 10.5
