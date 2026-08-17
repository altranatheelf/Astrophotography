"""True north-celestial-pole pixel coordinates from the solved WCS.

Never derive the pivot from Polaris: in 2026 Polaris is ~0.64 deg
(~27-28 px at 84.4 arcsec/px) from the true pole.
"""

from __future__ import annotations

from astropy.coordinates import SkyCoord
import astropy.units as u


def pole_pixel_xy(wcs) -> tuple[float, float]:
    """Pixel (x, y) of the true NCP in the given WCS."""
    ncp = SkyCoord(ra=0 * u.deg, dec=90 * u.deg, frame="icrs")
    x, y = wcs.world_to_pixel(ncp)
    return float(x), float(y)
