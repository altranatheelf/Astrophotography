"""Radiant geometry scoring (§3.7) — advisory only, never a hard filter.

The streak is back-projected as a great circle; the angular miss-distance
from the (epoch-corrected) shower radiant decides the ``likely_perseid``
flag.  Published Perseid radiant scatter is ~3.3 deg RA / 2.3 deg Dec and
faint meteors scatter much wider, so a strict cut would wrongly reject real
Perseids — the human decides.
"""

from __future__ import annotations

from datetime import datetime, timezone

import numpy as np


def radiant_at_epoch(cfg, epoch: datetime) -> tuple[float, float]:
    """Shower radiant (RA, Dec) corrected for daily drift from the config
    epoch (Perseids: +1.40 deg/day RA, +0.20 deg/day Dec)."""
    t0 = datetime.fromisoformat(cfg.radiant_epoch)
    if t0.tzinfo is None:
        t0 = t0.replace(tzinfo=timezone.utc)
    if epoch.tzinfo is None:
        epoch = epoch.replace(tzinfo=timezone.utc)
    days = (epoch - t0).total_seconds() / 86400.0
    return (cfg.radiant_ra_deg + cfg.radiant_dra_deg_per_day * days,
            cfg.radiant_dec_deg + cfg.radiant_ddec_deg_per_day * days)


def _unit(ra_deg: float, dec_deg: float) -> np.ndarray:
    ra, dec = np.deg2rad(ra_deg), np.deg2rad(dec_deg)
    return np.array([np.cos(dec) * np.cos(ra),
                     np.cos(dec) * np.sin(ra),
                     np.sin(dec)])


def radiant_miss_deg(end0_radec, end1_radec, radiant_radec) -> float:
    """Angular distance from the radiant to the streak's great circle."""
    a, b = _unit(*end0_radec), _unit(*end1_radec)
    n = np.cross(a, b)
    norm = np.linalg.norm(n)
    if norm < 1e-12:
        return 90.0
    r = _unit(*radiant_radec)
    return float(abs(np.rad2deg(np.arcsin(np.clip(n @ r / norm, -1, 1)))))
