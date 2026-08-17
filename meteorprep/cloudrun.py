"""Cloud/assistant-driven runs: turn a pile of frames (a folder, a zip, or
a share-link URL) into the finished layered result, with photographer-
friendly progress, then bundle everything for sending back to a phone.

Also provides the "where did you point the camera?" helper: a compass
direction and an elevation ("northeast, about halfway up") plus the site
and the EXIF timestamp is enough to seed the plate solver — no sky
coordinates needed from the photographer.
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

log = logging.getLogger("meteorprep")

COMPASS = {"N": 0.0, "NNE": 22.5, "NE": 45.0, "ENE": 67.5, "E": 90.0,
           "ESE": 112.5, "SE": 135.0, "SSE": 157.5, "S": 180.0,
           "SSW": 202.5, "SW": 225.0, "WSW": 247.5, "W": 270.0,
           "WNW": 292.5, "NW": 315.0, "NNW": 337.5}


def altaz_seed(lat_deg: float, lon_deg: float, iso_time: str,
               az_deg: float, alt_deg: float) -> tuple[float, float]:
    """RA/Dec of the pointing direction at the given site and time.

    Works offline: sub-degree accuracy is plenty for a solver seed, so IERS
    auto-download is disabled.
    """
    from datetime import datetime, timezone

    import astropy.units as u
    from astropy.coordinates import AltAz, EarthLocation, SkyCoord
    from astropy.time import Time
    from astropy.utils import iers

    iers.conf.auto_download = False
    dt = datetime.fromisoformat(iso_time)
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    loc = EarthLocation(lat=lat_deg * u.deg, lon=lon_deg * u.deg)
    frame = AltAz(obstime=Time(dt, scale="utc"), location=loc,
                  az=az_deg * u.deg, alt=alt_deg * u.deg)
    icrs = SkyCoord(frame).icrs
    return float(icrs.ra.deg), float(icrs.dec.deg)


def parse_pointing(text: str) -> float:
    """'NE' / 'northeast' / '45' -> azimuth degrees."""
    t = text.strip().upper().replace("NORTH", "N").replace("SOUTH", "S") \
        .replace("EAST", "E").replace("WEST", "W").replace("-", "").replace(" ", "")
    if t in COMPASS:
        return COMPASS[t]
    return float(text)


def gather(src: str, dest: Path) -> Path:
    """Collect frames from a directory, a zip file, or a URL into ``dest``."""
    dest.mkdir(parents=True, exist_ok=True)
    p = Path(src)
    if src.startswith(("http://", "https://")):
        # normalise common share links to direct-download form
        url = src.replace("?dl=0", "?dl=1")
        if "drive.google.com/file/d/" in url:
            fid = url.split("/file/d/")[1].split("/")[0]
            url = f"https://drive.google.com/uc?export=download&id={fid}"
        target = dest / "download.zip"
        log.info("downloading %s", url)
        with urllib.request.urlopen(url, timeout=600) as r, open(target, "wb") as fh:
            shutil.copyfileobj(r, fh, 1024 * 1024)
        p = target
    if p.is_file() and p.suffix.lower() == ".zip":
        log.info("unpacking %s", p.name)
        with zipfile.ZipFile(p) as z:
            for info in z.infolist():
                name = Path(info.filename).name  # flatten, ignore dot-cruft
                if not name or name.startswith(".") or info.is_dir():
                    continue
                with z.open(info) as src_fh, open(dest / name, "wb") as out_fh:
                    shutil.copyfileobj(src_fh, out_fh)
        return dest
    if p.is_dir():
        return p
    raise SystemExit(f"can't use source: {src}")


def bundle(output_dir: Path, zip_path: Path) -> Path:
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(output_dir.rglob("*")):
            if f.is_file() and "cache" not in f.parts:
                z.write(f, f.relative_to(output_dir))
    return zip_path


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    ap = argparse.ArgumentParser(
        prog="meteorprep-cloud",
        description="Run METEORPREP on a folder, zip, or share-link URL and "
                    "bundle the results for sending back.")
    ap.add_argument("src", help="frames folder, .zip, or https share link")
    ap.add_argument("-o", "--out", default="cloudrun_out")
    ap.add_argument("--site-lat", type=float, default=44.3275)
    ap.add_argument("--site-lon", type=float, default=-72.1725)
    ap.add_argument("--pointed", default=None,
                    help="compass direction the camera faced, e.g. NE")
    ap.add_argument("--elevation", type=float, default=45.0,
                    help="how high the camera aimed, degrees above horizon "
                         "(45 = halfway up)")
    ap.add_argument("--when", default=None,
                    help="ISO time of the session middle (default: read from "
                         "the frames' own timestamps)")
    ap.add_argument("--seed-ra", type=float, default=None)
    ap.add_argument("--seed-dec", type=float, default=None)
    args = ap.parse_args(argv)

    from meteorprep.config import Config
    from meteorprep.pipeline import run
    from meteorprep.webapp import _friendly

    workdir = Path(args.out)
    frames_dir = gather(args.src, workdir / "frames")

    cfg = Config(input_dir=str(frames_dir),
                 output_dir=str(workdir / "output"),
                 site_lat=args.site_lat, site_lon=args.site_lon,
                 jobs=max((__import__("os").cpu_count() or 2) - 1, 1),
                 cleanup_cache=True)

    if args.seed_ra is not None and args.seed_dec is not None:
        cfg.seed_ra_deg, cfg.seed_dec_deg = args.seed_ra, args.seed_dec
    elif args.pointed:
        when = args.when
        if when is None:
            from meteorprep.ingest.exif import read_metadata, scan_input_dir
            paths = scan_input_dir(frames_dir, cfg.raw_extensions)
            metas = read_metadata(paths)
            when = metas[len(metas) // 2].epoch_mid.isoformat()
        az = parse_pointing(args.pointed)
        ra, dec = altaz_seed(args.site_lat, args.site_lon, when,
                             az, args.elevation)
        cfg.seed_ra_deg, cfg.seed_dec_deg = ra, dec
        log.info("pointing %s at %.0f° up on %s -> solver seed "
                 "RA %.1f°, Dec %.1f°", args.pointed, args.elevation,
                 when, ra, dec)

    result = run(cfg, progress=lambda f, m: log.info(
        "[%3d%%] %s", int(f * 100), _friendly(str(m))))

    zip_path = bundle(Path(cfg.output_dir), workdir / "meteorprep_result.zip")
    for g in result["groups"]:
        print(f"group {g['group']}: {g['n_meteors']} meteor(s), "
              f"{g['n_flagged']} flagged, alignment={g['alignment_quality']}")
    print(f"bundle: {zip_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
