"""PyInstaller entry point: the window, nothing else.

Exists because ``python -m meteorprep.gui`` has no file for PyInstaller
to point at.  Two lines here are load-bearing for a FROZEN app and easy
to lose: ``freeze_support()`` and the ``__main__`` guard.  The stacking
pools use the spawn start method, which re-imports this module in every
worker — unguarded, each worker would have relaunched the whole app,
forever.  (Caught for real: the offscreen demo-night test did exactly
that through an unguarded harness.)

A bundled app also carries its own exiftool when the builder put one in
vendor/ — announce it via PATH so find_exiftool sees it.
"""
import multiprocessing
import os
import sys


def _main() -> int:
    if getattr(sys, "frozen", False):
        bundled = os.path.join(sys._MEIPASS, "exiftool")
        if os.path.exists(bundled):
            os.environ["PATH"] = sys._MEIPASS + os.pathsep + \
                os.environ.get("PATH", "")
    from meteorprep.gui import main
    return main()


if __name__ == "__main__":
    multiprocessing.freeze_support()
    sys.exit(_main())
