"""Command-line entrypoint: ``meteorprep <input_dir> [options]``."""

from __future__ import annotations

import argparse
import sys

from meteorprep import modes as _M
from meteorprep.config import Config


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="meteorprep",
        description="Turn a folder of fixed-tripod RAW meteor-shower frames "
                    "into a layered, geometry-corrected PSD.")
    p.add_argument("input_dir", nargs="?", default=None,
                   help="folder of RAW/TIFF frames (recursive)")
    p.add_argument("--self-test", action="store_true",
                   help="verify the whole setup on a tiny synthetic night "
                        "(~2 min), no real photos needed")
    p.add_argument("-o", "--out", default="meteorprep_out", help="output folder")
    p.add_argument("--align-mode", choices=["reproject_tan", "rotate2d"],
                   default="reproject_tan",
                   help="rotate2d is a DEGRADED fallback (~720 px/hr corner error)")
    p.add_argument("--seed-ra", type=float, default=None,
                   help="rough base-frame center RA (deg) to seed the solver")
    p.add_argument("--seed-dec", type=float, default=None,
                   help="rough base-frame center Dec (deg)")
    p.add_argument("--seed-rotation", type=float, default=0.0,
                   help="rough camera rotation (deg E of N)")
    p.add_argument("--catalog", default="",
                   help="local (N,2) RA/Dec .npy star catalog for offline solving")
    p.add_argument("--site-lat", type=float, default=None,
                   help="observing latitude in degrees (also read from "
                        "photo GPS when the camera recorded it)")
    p.add_argument("--site-lon", type=float, default=None,
                   help="observing longitude in degrees")
    p.add_argument("--solve-every-k", type=int, default=10)
    p.add_argument("--no-psd", action="store_true",
                   help="do not write the layered Photoshop file")
    p.add_argument("--no-pngjsx", action="store_true",
                   help="do not write the PNG + Photoshop-script rescue "
                        "copy (it is written automatically anyway if the "
                        ".psd cannot be produced)")
    p.add_argument("--no-contact-sheet", action="store_true",
                   help="do not write the sheet of candidate thumbnails")
    p.add_argument("--startrail", "--emit-startrail", action="store_true",
                   dest="emit_startrail",
                   help="also write the classic star-trail photo")
    p.add_argument("--mode", choices=[m.key for m in _M.MODES],
                   default=_M.DEFAULT,
                   help="what to produce; "
                        + " | ".join(f"'{m.key}' = {m.blurb}"
                                     for m in _M.MODES))
    p.add_argument("--draft", action="store_true",
                   help=argparse.SUPPRESS)      # the old name for --mode quick
    p.add_argument("--jobs", type=int, default=1)
    p.add_argument("--force", action="store_true",
                   help="re-run all stages even when cached results match")
    return p


def config_from_args(args) -> Config:
    cfg = Config(
        input_dir=args.input_dir, output_dir=args.out,
        align_mode=args.align_mode,
        **({"site_lat": args.site_lat, "site_lon": args.site_lon,
            "site_explicit": True}
           if args.site_lat is not None and args.site_lon is not None
           else {}),
        catalog_file=args.catalog,
        solve_every_k=args.solve_every_k,
        emit_psd=not args.no_psd,
        emit_pngjsx=not args.no_pngjsx,
        emit_contact_sheet=not args.no_contact_sheet,
        emit_startrail=args.emit_startrail,
        jobs=args.jobs, force=args.force,
        seed_rotation_deg=args.seed_rotation,
        **_M.config_kwargs("quick" if getattr(args, "draft", False)
                           else getattr(args, "mode", _M.DEFAULT)),
    )
    if args.seed_ra is not None:
        cfg.seed_ra_deg = args.seed_ra
    if args.seed_dec is not None:
        cfg.seed_dec_deg = args.seed_dec
    return cfg


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.self_test:
        from meteorprep.selftest import main as selftest_main
        return selftest_main()
    if args.input_dir is None:
        build_parser().error("input_dir is required (or use --self-test)")
    cfg = config_from_args(args)
    from meteorprep.pipeline import run
    try:
        result = run(cfg)
    except (FileNotFoundError, RuntimeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    for g in result["groups"]:
        print(f"group {g['group']}: {g['n_meteors']} meteor(s), "
              f"{g['n_flagged']} flagged, alignment={g['alignment_quality']}")
        for kind, path in g["outputs"].items():
            print(f"  {kind}: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
