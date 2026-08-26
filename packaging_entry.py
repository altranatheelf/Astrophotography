"""PyInstaller entry point: the window, nothing else.

Exists because ``python -m meteorprep.gui`` has no file for PyInstaller
to point at.  A bundled app also carries its own exiftool when the
builder put one in vendor/ — announce it via PATH so find_exiftool sees
it before the built-in reader takes over.
"""
import os
import sys

if getattr(sys, "frozen", False):
    bundled = os.path.join(sys._MEIPASS, "exiftool")
    if os.path.exists(bundled):
        os.environ["PATH"] = sys._MEIPASS + os.pathsep + \
            os.environ.get("PATH", "")

from meteorprep.gui import main

sys.exit(main())
