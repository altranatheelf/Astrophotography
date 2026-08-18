#!/bin/bash
# Double-click fallback launcher: opens a Terminal window with the log
# visible. Same behaviour as MeteorPrep.app otherwise.
set -u
cd "$(dirname "$0")"
PY="/Library/Frameworks/Python.framework/Versions/3.13/bin/python3"
[ -x "$PY" ] || PY="$(command -v python3 || true)"
if [ -z "${PY:-}" ]; then
    echo "Python 3 was not found. Install it from python.org and run this again."
    read -r -p "Press Return to close."; exit 1
fi
if ! "$PY" -c "import PySide6, numpy, astropy, cv2, rawpy, reproject" >/dev/null 2>&1; then
    echo "First-time setup: installing MeteorPrep's components (a few minutes)..."
    "$PY" -m pip install ".[gui]" || {
        echo "Setup failed — copy the text above to Claude and it will sort it out.";
        read -r -p "Press Return to close."; exit 1; }
fi
exec "$PY" -m meteorprep.gui
