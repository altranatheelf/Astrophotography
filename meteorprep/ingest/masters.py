"""Calibration frames: what the sensor and the lens did to the picture,
measured from the photographer's own shots and undone before anything
else looks at the data.

Two things are worth removing on a modern DSLR shooting twenty-second
nightscapes, and they are not the two people expect.

*Flats* earn their place.  A fast wide lens at full aperture darkens its
own corners by a stop or more and prints every speck of dust on the
sensor; stacking makes both **more** visible, not less, because the sky
noise averages down while the shading stays exactly where it is.  Nothing
else in this pipeline removes them.

*Darks* mostly do not.  At 20 s the dark signal on a body like the 6D is
a few tens of electrons against a sky of several hundred, so a dark frame
removes a pattern that was already far below the shot noise while adding
read noise of its own.  Its one real job — hot pixels — is already done,
and done better, by the bad-pixel map in ``raw.py``, which also repairs
pixels that read *low*, something no dark can fix.  So darks are
supported, because some nights and some bodies want them, but they are
never asked for.

Everything here happens on the CFA mosaic, before demosaicing, because
subtraction does not commute with a non-linear demosaic: interpolation
weights depend on the local gradient, the defect changes the gradient,
and a hot pixel subtracted after demosaic leaves a cross of residue
instead of nothing at all.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

log = logging.getLogger("meteorprep")

# folder names, beside the night's photographs, that hold calibration
# frames rather than pictures of the sky
DARK_DIRS = ("darks", "dark")
FLAT_DIRS = ("flats", "flat")
BIAS_DIRS = ("bias", "biases", "offset")
CAL_DIRS = DARK_DIRS + FLAT_DIRS + BIAS_DIRS

# below this many frames a master is noisier than the thing it corrects
WARN_BELOW = 10
REFUSE_BELOW = 5


def is_calibration_path(path: Path, root: Path) -> bool:
    """True when ``path`` sits inside a calibration subfolder of ``root``."""
    try:
        rel = Path(path).resolve().relative_to(Path(root).resolve())
    except (ValueError, OSError):
        return False
    return any(part.lower() in CAL_DIRS for part in rel.parts[:-1])


def find_calibration_dirs(root: Path) -> dict[str, Path]:
    """The ``darks``/``flats``/``bias`` folders that actually exist."""
    out: dict[str, Path] = {}
    root = Path(root)
    if not root.is_dir():
        return out
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        name = child.name.lower()
        for kind, names in (("dark", DARK_DIRS), ("flat", FLAT_DIRS),
                            ("bias", BIAS_DIRS)):
            if name in names and kind not in out:
                out[kind] = child
    return out


# ------------------------------------------------------------------ frames
def _cal_frames(folder: Path, extensions) -> list[Path]:
    exts = {e.lower() for e in extensions}
    return [p for p in sorted(Path(folder).rglob("*"))
            if p.is_file() and p.suffix.lower() in exts]


def _open_geometry(path: Path):
    """Sensor geometry and levels, read once from the first frame."""
    import rawpy
    with rawpy.imread(str(path)) as raw:
        return (raw.raw_image_visible.shape,
                np.asarray(raw.black_level_per_channel, np.float32),
                np.asarray(raw.raw_colors_visible, np.uint8).copy(),
                float(raw.white_level))


def _stream_master(paths: list[Path], shape, sigma: float = 3.0,
                   label: str = "master") -> np.ndarray:
    """Sigma-clipped mean of the raw CFA planes, in two streaming passes.

    A clipped average beats a median here: the median only reaches
    0.8*sqrt(N) of the noise reduction an average gets, and with ten or
    more frames the outliers a median exists to reject (a satellite
    across a sky flat, a cosmic ray in a dark) are better handled by
    clipping them explicitly.  Two passes, one frame resident at a time,
    so a twenty-megapixel master costs a few hundred megabytes rather
    than a gigabyte per ten frames.
    """
    import rawpy
    n = len(paths)
    total = np.zeros(shape, np.float64)
    totsq = np.zeros(shape, np.float64)
    used = 0
    for p in paths:
        try:
            with rawpy.imread(str(p)) as raw:
                v = raw.raw_image_visible
                if v.shape != shape:
                    log.warning("%s: %s is %s, expected %s — skipped",
                                label, p.name, v.shape, shape)
                    continue
                x = v.astype(np.float32)
        except Exception as exc:
            log.warning("%s: could not read %s (%s) — skipped",
                        label, p.name, exc)
            continue
        total += x
        totsq += np.square(x, dtype=np.float64)
        used += 1
    if used == 0:
        raise ValueError(f"no usable frames for the {label}")
    mean = (total / used).astype(np.float32)
    if used < 3:                       # nothing to clip against
        return mean
    var = totsq / used - np.square(total / used)
    std = np.sqrt(np.maximum(var, 0.0), dtype=np.float64).astype(np.float32)
    del total, totsq, var
    lo, hi = mean - sigma * std, mean + sigma * std
    del std

    keep_sum = np.zeros(shape, np.float32)
    keep_n = np.zeros(shape, np.uint16)
    for p in paths:
        try:
            with rawpy.imread(str(p)) as raw:
                v = raw.raw_image_visible
                if v.shape != shape:
                    continue
                x = v.astype(np.float32)
        except Exception:
            continue
        good = (x >= lo) & (x <= hi)
        keep_sum += np.where(good, x, 0.0)
        keep_n += good
    # a pixel every frame disagreed about keeps its plain mean
    out = np.where(keep_n > 0, keep_sum / np.maximum(keep_n, 1), mean)
    rejected = float(n * shape[0] * shape[1] - keep_n.sum()) / (n * shape[0] * shape[1])
    log.info("%s: %d frame(s) combined, %.2f%% of samples clipped",
             label, used, 100.0 * rejected)
    return out.astype(np.float32)


# ----------------------------------------------------------------- masters
def build_dark(paths, shape, label="master dark") -> np.ndarray:
    """The dark stays in raw ADU with its pedestal intact — subtracting it
    from a light removes the black level as a side effect, which is
    exactly once, which is right."""
    return _stream_master(list(paths), shape, label=label)


def build_flat(paths, shape, black, colors, dark=None,
               label="master flat") -> np.ndarray:
    """A flat normalised per CFA colour to a median of 1.

    Per colour, not globally: a global normalisation would fold the
    flat's own colour cast — the light source's, not the lens's — into
    every frame and quietly shift the white balance.
    """
    flat = _stream_master(list(paths), shape, label=label)
    if dark is not None:
        flat = flat - dark
    else:
        flat = flat - black[colors]
    # Normalise to the BRIGHTEST part of the field, not the median, so
    # that dividing by this flat only ever lifts the corners and never
    # dims the middle.  The usual median convention would darken the
    # centre by a fifth, and the meteor search has an absolute floor in
    # ADU: a real meteor near the middle of the frame would be dimmed
    # straight through it.  Measured on the reference night, the median
    # convention lost both meteors; this one keeps them.  Only the
    # *ratios* matter to flat-fielding, and those are unchanged.
    for c in range(4):
        m = colors == c
        if not m.any():
            continue
        med = float(np.percentile(flat[m], 99.5))
        if med <= 1.0:
            raise ValueError(
                "the flat frames are too dark to divide by — they should be "
                "exposed about a third of the way up the histogram")
        flat[m] /= med
    # a flat is a gentle thing; anything outside this is a defect, not
    # shading — and nothing may exceed 1, or the frame would be dimmed
    np.clip(flat, 0.05, 1.0, out=flat)
    return flat.astype(np.float32)


# ------------------------------------------------------------------- Calib
class Calib:
    """Everything ``decode`` needs to undo before it reads a photograph:
    the hot-pixel map, and the paths to whatever masters were built.

    The masters are held as *paths*, not arrays.  This object is pickled
    to every worker process, and a pair of twenty-megapixel float32
    planes is 160 MB that would otherwise be copied to each of them; each
    process loads them once, on first use, and memoises.
    """

    __slots__ = ("bad_pixels", "dark_path", "flat_path", "ref_max", "_memo")

    def __init__(self, bad_pixels=None, dark_path=None, flat_path=None,
                 ref_max=0.0):
        self.bad_pixels = bad_pixels
        self.dark_path = str(dark_path) if dark_path else None
        self.flat_path = str(flat_path) if flat_path else None
        # the night's brightest raw value, measured once; see apply()
        self.ref_max = float(ref_max)
        self._memo = {}

    # pickling: send the paths, never the loaded planes
    def __getstate__(self):
        return (self.bad_pixels, self.dark_path, self.flat_path, self.ref_max)

    def __setstate__(self, state):
        (self.bad_pixels, self.dark_path, self.flat_path,
         self.ref_max) = state
        self._memo = {}

    def __bool__(self) -> bool:
        return bool(self.dark_path or self.flat_path
                    or (self.bad_pixels is not None and len(self.bad_pixels)))

    @property
    def calibrates(self) -> bool:
        """True when there is a master to apply (a hot-pixel map alone is
        repair, not calibration)."""
        return bool(self.dark_path or self.flat_path)

    def _plane(self, which: str):
        if which in self._memo:
            return self._memo[which]
        path = self.dark_path if which == "dark" else self.flat_path
        arr = None
        if path:
            try:
                arr = np.load(path).astype(np.float32, copy=False)
            except (OSError, ValueError) as exc:
                log.warning("master %s could not be read (%s) — "
                            "continuing without it", which, exc)
                arr = None
        self._memo[which] = arr
        return arr

    def apply(self, raw) -> None:
        """Calibrate one opened RAW in place, on its CFA mosaic.

        ``L`` still carries the black pedestal, and LibRaw will subtract
        the pedestal again when it demosaics, so the pedestal has to be
        put back afterwards: with a dark, ``(L - D) / f + black``; with a
        flat alone, ``(L - black) / f + black``.  Subtracting black here
        *and* letting LibRaw subtract it again would take it off twice.
        """
        dark = self._plane("dark")
        flat = self._plane("flat")
        if dark is None and flat is None:
            return
        view = raw.raw_image_visible
        shape = view.shape
        if dark is not None and dark.shape != shape:
            log.warning("master dark is %s but this frame is %s — ignored",
                        dark.shape, shape)
            dark = None
        if flat is not None and flat.shape != shape:
            log.warning("master flat is %s but this frame is %s — ignored",
                        flat.shape, shape)
            flat = None
        if dark is None and flat is None:
            return
        black = np.asarray(raw.black_level_per_channel,
                           np.float32)[raw.raw_colors_visible]
        x = view.astype(np.float32)
        x -= dark if dark is not None else black
        if flat is not None:
            x /= flat
        # Put the result back on the scale the meteor search was measured
        # against.  An uncalibrated decode lets LibRaw set the top of the
        # 16-bit range from the frame's own brightest pixel; a calibrated
        # one pins it to the sensor's white level, which is further up, so
        # everything would come out proportionally darker and the search's
        # floor — an absolute number in ADU — would quietly become
        # stricter.  Squeezing the data into the same fraction of the
        # sensor's range cancels that exactly, with one constant measured
        # once for the night rather than one per frame.
        white = float(getattr(raw, "white_level", 0) or 0)
        if self.ref_max > 0 and white > 0:
            b0 = float(np.mean(black))
            span = max(white - b0, 1.0)
            x *= max(self.ref_max - b0, 1.0) / span
        x += black
        np.clip(x, 0.0, 65535.0, out=x)
        view[:] = np.rint(x).astype(np.uint16)


def as_calib(obj) -> Calib:
    """Accept either a ``Calib`` or a bare hot-pixel array — the argument
    that used to be only a hot-pixel map now carries the masters too, and
    every old caller keeps working."""
    if isinstance(obj, Calib):
        return obj
    return Calib(obj)




# ------------------------------------------------------- checks and warnings
def _digest(paths: list[Path]) -> str:
    import hashlib
    h = hashlib.sha256()
    for q in paths:
        try:
            st = q.stat()
            h.update(f"{q.name}:{st.st_size}:{int(st.st_mtime)}|".encode())
        except OSError:
            h.update(f"{q.name}:?|".encode())
    return h.hexdigest()[:16]


def _iso_exp(metas):
    return ({m.iso for m in metas if m.iso},
            {round(float(m.exposure_s), 3) for m in metas if m.exposure_s})


def check_darks(cal_metas, light_metas) -> tuple[list[str], list[str]]:
    """(fatal, advisory).  A dark has to have been taken by the same body
    at the same ISO for the same length of time; anything else subtracts
    the wrong amount of the wrong thing."""
    bad, warn = [], []
    ci, ce = _iso_exp(cal_metas)
    li, le = _iso_exp(light_metas)
    if ci and li and ci != li:
        bad.append(f"the darks are ISO {sorted(ci)} but the photographs are "
                   f"ISO {sorted(li)}")
    if ce and le and ce != le:
        bad.append(f"the darks are {sorted(ce)} s but the photographs are "
                   f"{sorted(le)} s")
    cm = {m.model for m in cal_metas if m.model}
    lm = {m.model for m in light_metas if m.model}
    if cm and lm and cm != lm:
        bad.append(f"the darks came from {sorted(cm)}, the photographs from "
                   f"{sorted(lm)}")
    return bad, warn


def check_flats(cal_metas, light_metas) -> tuple[list[str], list[str]]:
    """(fatal, advisory).  A flat measures one lens at one aperture at one
    focus; change any of those and it corrects a shading pattern the
    photographs never had."""
    bad, warn = [], []
    for attr, name, fatal in (("fnumber", "aperture", True),
                              ("focal_mm", "focal length", True),
                              ("iso", "ISO", False),
                              ("lens_model", "lens", False)):
        cv = {getattr(m, attr) for m in cal_metas if getattr(m, attr, None)}
        lv = {getattr(m, attr) for m in light_metas if getattr(m, attr, None)}
        if cv and lv and cv != lv:
            msg = (f"the flats were shot at {name} {sorted(cv)} but the "
                   f"photographs at {sorted(lv)}")
            (bad if fatal else warn).append(msg)
    return bad, warn


def check_master_flat(flat: np.ndarray) -> list[str]:
    warn = []
    hi = float(np.percentile(flat, 99.9))
    lo = float(np.percentile(flat, 0.1))
    if hi > 3.0 or lo < 0.15:
        warn.append("the flat frames correct by more than a factor of three "
                    "in places, which usually means they were not evenly lit")
    return warn


def check_raw_flat_levels(paths: list[Path], white: float) -> list[str]:
    """A clipped flat cannot be un-clipped: where it saturated it says
    'no falloff here', and dividing by it brightens the corners instead
    of fixing them."""
    import rawpy
    warn = []
    try:
        with rawpy.imread(str(paths[0])) as raw:
            v = raw.raw_image_visible
            p999 = float(np.percentile(v[::8, ::8], 99.9))
            med = float(np.median(v[::8, ::8]))
    except Exception:
        return warn
    if p999 >= 0.95 * white:
        warn.append("the flat frames are clipped — they were exposed too "
                    "brightly, and the corner correction will be wrong")
    elif med < 0.15 * white:
        warn.append("the flat frames are very dark; aim for the histogram "
                    "hump about a third of the way across")
    return warn


def check_master_dark(dark: np.ndarray, black) -> list[str]:
    """A dark should be flat.  A tilt across it is light that got in —
    almost always through the viewfinder — and subtracting it would print
    the leak, inverted, onto every photograph."""
    warn = []
    d = dark[::16, ::16].astype(np.float32)
    h, w = d.shape
    if h < 8 or w < 8:
        return warn
    top, bot = float(d[:h // 4].mean()), float(d[-h // 4:].mean())
    lef, rig = float(d[:, :w // 4].mean()), float(d[:, -w // 4:].mean())
    base = max(float(np.median(d)) - float(np.mean(black)), 1.0)
    if max(abs(top - bot), abs(lef - rig)) > max(0.5 * base, 8.0):
        warn.append("the dark frames are brighter on one side — light got "
                    "in, most likely through the viewfinder; cover the "
                    "eyepiece and shoot them again")
    return warn


# ------------------------------------------------------------- the whole job
def prepare(cfg, light_metas, bad_pixels=None, notify=None) -> Calib:
    """Find the night's calibration folders, check them against the
    photographs, build the masters, and hand back the thing ``decode``
    needs.  Refuses nothing silently: every reason is logged in the words
    a photographer would use."""
    calib = Calib(bad_pixels)
    root = Path(cfg.input_dir)
    if not getattr(cfg, "calibrate", True):
        return calib
    dirs = find_calibration_dirs(root)
    if not dirs:
        return calib
    from meteorprep.ingest.exif import read_metadata

    cache = Path(cfg.cache_path)
    cache.mkdir(parents=True, exist_ok=True)
    geom = None
    built: dict[str, Path] = {}
    dark_plane = None

    for kind in ("dark", "flat"):          # dark first: the flat wants it
        folder = dirs.get(kind)
        if folder is None:
            continue
        paths = _cal_frames(folder, cfg.raw_extensions)
        word = "dark" if kind == "dark" else "flat"
        if len(paths) < REFUSE_BELOW:
            log.warning("only %d %s frame(s) in %s — at least %d are needed, "
                        "so they are being ignored", len(paths), word,
                        folder.name, REFUSE_BELOW)
            continue
        if len(paths) < WARN_BELOW:
            log.warning("only %d %s frame(s): a master built from so few "
                        "adds noise of its own", len(paths), word)
        try:
            metas = read_metadata(paths)
        except Exception as exc:
            log.warning("could not read the %s frames' details (%s)", word, exc)
            metas = []
        checker = check_darks if kind == "dark" else check_flats
        fatal, advisory = checker(metas, light_metas) if metas else ([], [])
        for m in advisory:
            log.warning("%s", m)
        if fatal:
            for m in fatal:
                log.warning("ignoring the %s frames: %s", word, m)
            continue
        if geom is None:
            try:
                geom = _open_geometry(paths[0])
            except Exception as exc:
                log.warning("could not read %s (%s) — calibration skipped",
                            paths[0].name, exc)
                return calib
        shape, black, colors, white = geom
        if kind == "flat":
            for m in check_raw_flat_levels(paths, white):
                log.warning("%s", m)

        key = f"{kind}|{len(paths)}|{_digest(paths)}|{shape}"
        npy = cache / f"master_{kind}.npy"
        keyf = cache / f"master_{kind}.key"
        plane = None
        if (not cfg.force and npy.exists() and keyf.exists()
                and keyf.read_text() == key):
            try:
                plane = np.load(npy)
                log.info("master %s reused from cache (%d frames)",
                         word, len(paths))
            except (OSError, ValueError):
                npy.unlink(missing_ok=True)
                plane = None
        if plane is None:
            if notify:
                notify(0.03, f"combining {len(paths)} {word} frames")
            try:
                if kind == "dark":
                    plane = build_dark(paths, shape)
                else:
                    plane = build_flat(paths, shape, black, colors,
                                       dark=dark_plane)
            except Exception as exc:
                log.warning("could not build the master %s (%s)", word, exc)
                continue
            _save_atomic(npy, plane)
            keyf.write_text(key)
        for m in (check_master_dark(plane, black) if kind == "dark"
                  else check_master_flat(plane)):
            log.warning("%s", m)
        if kind == "dark":
            dark_plane = plane
        built[kind] = npy

    if not built:
        return calib
    ref_max = _reference_max([m.path for m in light_metas])
    log.info("calibrating with %s (frame scale pinned at %d ADU)",
             " and ".join(f"a master {k}" for k in built), int(ref_max))
    return Calib(bad_pixels, built.get("dark"), built.get("flat"), ref_max)


def _reference_max(paths, sample: int = 6) -> float:
    """The brightest raw value of the night, over a sample of frames.

    This is the number LibRaw would otherwise pick per frame; measuring
    it once and using it for all of them is the whole point — the scale
    stops depending on whether a given frame happened to contain a
    saturated star.
    """
    import rawpy
    if not paths:
        return 0.0
    step = max(1, len(paths) // sample)
    best = 0.0
    for q in list(paths)[::step][:sample]:
        try:
            with rawpy.imread(str(q)) as raw:
                best = max(best, float(raw.raw_image_visible.max()))
        except Exception:
            continue
    return best


def _save_atomic(path: Path, arr: np.ndarray) -> None:
    tmp = path.with_suffix(".part.npy")
    np.save(tmp, arr)
    tmp.replace(path)

__all__ = ["Calib", "prepare", "as_calib", "build_dark", "build_flat", "CAL_DIRS",
           "find_calibration_dirs", "is_calibration_path",
           "_cal_frames", "_open_geometry", "WARN_BELOW", "REFUSE_BELOW"]
