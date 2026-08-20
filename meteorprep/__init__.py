"""METEORPREP — turn a folder of fixed-tripod RAW meteor-shower frames into a
layered, geometry-corrected PSD.

CLI-core library; see :func:`meteorprep.pipeline.run`.
"""

__version__ = "1.18.0"

from meteorprep.config import Config  # noqa: F401


def run(config):
    """Run the full pipeline for a :class:`~meteorprep.config.Config`."""
    from meteorprep.pipeline import run as _run

    return _run(config)
