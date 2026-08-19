"""Physics annotations for a detected streak (2.0 plan, Phase 4).

A single fixed camera cannot triangulate: it measures direction, not
distance.  So nothing here is presented as measured.  Each streak's
sky position and angular length ARE measured; combined with two stated
assumptions — meteors of a known shower burn at a known height and
arrive at a known speed — they give the numbers a photographer actually
wants in a caption: how high it burned, how far away it was, and how
long it lasted.  Every value ships with the assumption that produced it,
and the geometry check below refuses to answer when the assumption is
plainly wrong for the object in question.
"""

from __future__ import annotations

from datetime import datetime, timezone

import numpy as np

EARTH_RADIUS_KM = 6371.0
# Perseids arrive at ~59 km/s and ablate between roughly 80 and 120 km;
# 95 km is the mid-band commonly quoted for their peak brightness.
DEFAULT_ABLATION_KM = 95.0
DEFAULT_ENTRY_KM_S = 59.0


def _precess_from_j2000(ra_deg: float, dec_deg: float, jd: float):
    """Rotate a J2000 position to the mean equinox of date (IAU 1976).

    The catalog, and therefore every position this tool measures, is
    J2000; the sidereal-time formula below is in coordinates of date.
    Skipping this step is a ~0.4 deg error by 2026 — small on the sky,
    but it is a systematic one and it costs ten lines to remove.
    """
    t = (jd - 2451545.0) / 36525.0
    sec = np.deg2rad(1.0 / 3600.0)
    zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t ** 3) * sec
    z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t ** 3) * sec
    theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t ** 3) * sec
    ra, dec = np.deg2rad(ra_deg), np.deg2rad(dec_deg)
    v = np.array([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra),
                  np.sin(dec)])

    def rz(a):
        c, s_ = np.cos(a), np.sin(a)
        return np.array([[c, -s_, 0.0], [s_, c, 0.0], [0.0, 0.0, 1.0]])

    def ry(a):
        c, s_ = np.cos(a), np.sin(a)
        return np.array([[c, 0.0, s_], [0.0, 1.0, 0.0], [-s_, 0.0, c]])

    w = rz(z) @ ry(-theta) @ rz(zeta) @ v
    return (float(np.rad2deg(np.arctan2(w[1], w[0])) % 360.0),
            float(np.rad2deg(np.arcsin(np.clip(w[2], -1, 1)))))


def altaz_from_radec(ra_deg: float, dec_deg: float, lat_deg: float,
                     lon_deg: float, when: datetime) -> tuple[float, float]:
    """Local altitude and azimuth (degrees) of a J2000 sky position, from
    the site and the moment.  Plain spherical astronomy — no refraction,
    which matters only within a couple of degrees of the horizon."""
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    jd = when.timestamp() / 86400.0 + 2440587.5
    ra_deg, dec_deg = _precess_from_j2000(ra_deg, dec_deg, jd)
    # Greenwich mean sidereal time (Meeus 12.4), good to ~0.1 s here
    t = (jd - 2451545.0) / 36525.0
    gmst = (280.46061837 + 360.98564736629 * (jd - 2451545.0)
            + 0.000387933 * t * t - t * t * t / 38710000.0) % 360.0
    ha = np.deg2rad((gmst + lon_deg - ra_deg) % 360.0)
    dec = np.deg2rad(dec_deg)
    lat = np.deg2rad(lat_deg)
    sin_alt = (np.sin(dec) * np.sin(lat)
               + np.cos(dec) * np.cos(lat) * np.cos(ha))
    alt = np.arcsin(np.clip(sin_alt, -1, 1))
    # both terms carry a factor cos(lat) > 0, which atan2 divides out
    az = np.arctan2(-np.cos(dec) * np.cos(lat) * np.sin(ha),
                    np.sin(dec) - np.sin(lat) * sin_alt)
    return float(np.rad2deg(alt)), float(np.rad2deg(az) % 360.0)


def slant_range_km(alt_deg: float, height_km: float) -> float:
    """Distance along the line of sight to a point ``height_km`` above a
    spherical Earth, seen at altitude ``alt_deg``.  The spherical form
    matters: near the horizon the flat h/sin(alt) answer runs away to
    thousands of km, which is where meteors most often appear."""
    a = np.deg2rad(max(alt_deg, -0.5))
    r = EARTH_RADIUS_KM
    s = r * np.sin(a)
    return float(-s + np.sqrt(s * s + 2 * r * height_km + height_km ** 2))


def annotate(cand, lat_deg: float, lon_deg: float, when: datetime,
             exposure_s: float,
             ablation_km: float = DEFAULT_ABLATION_KM,
             entry_km_s: float = DEFAULT_ENTRY_KM_S,
             meteor_assumptions: bool = True) -> dict:
    """Physics estimates for one candidate.  Returns {} when the streak
    has no usable sky geometry.

    Where it points is measured and always reported.  How high, how far
    and how long only follow from the shower assumptions, so they are
    withheld for anything already identified as a satellite or aircraft:
    those fly at a few hundred km and a few km/s, and running them
    through meteor numbers would print a confident fiction.
    """
    segs = cand.endpoints_world or []
    if not segs or cand.length_deg <= 0:
        return {}
    (ra0, dec0), (ra1, dec1) = segs[0][0], segs[-1][1]
    ra_mid = float(np.rad2deg(np.arctan2(
        np.sin(np.deg2rad(ra0)) + np.sin(np.deg2rad(ra1)),
        np.cos(np.deg2rad(ra0)) + np.cos(np.deg2rad(ra1)))) % 360.0)
    dec_mid = 0.5 * (float(dec0) + float(dec1))
    alt, az = altaz_from_radec(ra_mid, dec_mid, lat_deg, lon_deg, when)
    out = {"elevation_deg": round(alt, 1), "azimuth_deg": round(az, 1)}
    if alt <= 0.5:                 # below the horizon: no honest geometry
        return out
    if not meteor_assumptions:
        out["note"] = ("height and distance not estimated: this is not a "
                       "meteor, so the shower's speed and burn height "
                       "do not apply")
        return out
    rng = slant_range_km(alt, ablation_km)
    path_km = 2.0 * rng * float(np.sin(np.deg2rad(cand.length_deg) / 2.0))
    dur = path_km / max(entry_km_s, 1e-3)
    out.update({
        "assumed_ablation_km": ablation_km,
        "assumed_entry_km_s": entry_km_s,
        "est_range_km": round(rng),
        "est_path_km": round(path_km, 1),
        "est_duration_s": round(dur, 2),
        "est_angular_speed_deg_s": round(cand.length_deg / max(dur, 1e-6), 1),
    })
    # Sanity, not decoration.  A meteor cannot have taken longer to cross
    # the sky than the frame it was caught in; if the assumed geometry
    # says otherwise, the assumption is wrong for this streak (a very long
    # trail low on the horizon is the usual way to get here).  Say so
    # rather than printing a confident wrong number.
    out["geometry_consistent"] = not (exposure_s and dur > float(exposure_s))
    if not out["geometry_consistent"]:
        out["note"] = ("the shower assumptions cannot hold here: they "
                       "imply a streak longer-lived than the exposure "
                       "that recorded it")
    return out
