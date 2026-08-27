#!/bin/bash
# Double-click fallback launcher: same behaviour as MeteorPrep.app but in
# a Terminal window, so anything that goes wrong is visible on screen.
set -u
cd "$(dirname "$0")" || exit 1
DIR="$(pwd)"

# macOS guards Downloads (and Desktop/Documents) with a privacy gate:
# when it is closed, every later step dies with cryptic "Operation not
# permitted" errors. Probe with a real read and say the fix in words.
if ! head -c 1 "$DIR/meteorprep/__init__.py" >/dev/null 2>&1; then
    echo "macOS is not letting this window read the METEORPREP folder here:"
    echo "  $DIR"
    echo
    echo "The fix takes 30 seconds: drag the whole METEORPREP folder into"
    echo "your home folder (house icon in Finder) or into Applications,"
    echo "then double-click 'Start MeteorPrep.command' from there."
    read -r -p "Press Return to close."; exit 1
fi
# every module a real run needs — the window, the RAW decoder, the
# image writers.  Probing only for PySide6 and the package itself
# passed on an install with no rawpy, and first-time setup was
# skipped on exactly the machine that needed it.
NEEDS="import PySide6, rawpy, cv2, tifffile, PIL, astropy, meteorprep.pipeline"

# clear the download quarantine on this folder so double-clicking
# MeteorPrep.app afterwards runs in place (macOS otherwise relaunches
# downloaded apps from a read-only temporary copy that cannot see these
# files — "App Translocation")
xattr -dr com.apple.quarantine "$(pwd)" 2>/dev/null || true

PRIVATE_PY_DIR="$HOME/Library/Application Support/MeteorPrep/python"
CANDIDATES=""
# a Python that MeteorPrep.app downloaded for itself on a previous
# launch works here too
[ -x "$PRIVATE_PY_DIR/bin/python3" ] && \
    CANDIDATES="$CANDIDATES $PRIVATE_PY_DIR/bin/python3"
for v in 3.13 3.12 3.11 3.14; do
    p="/Library/Frameworks/Python.framework/Versions/$v/bin/python3"
    [ -x "$p" ] && CANDIDATES="$CANDIDATES $p"
done
for p in "$(command -v python3 || true)" /opt/homebrew/bin/python3 \
         /usr/local/bin/python3; do
    [ -n "$p" ] && [ -x "$p" ] && CANDIDATES="$CANDIDATES $p"
done

echo "Looking for a ready Python..."
for p in $CANDIDATES; do
    printf '  %s ... ' "$p"
    if "$p" -c "$NEEDS" >/dev/null 2>&1; then
        echo "ready — starting MeteorPrep"
        exec "$p" -m meteorprep.gui
    fi
    echo "missing some components"
done

PY=""
for p in $CANDIDATES; do PY="$p"; break; done
if [ -z "$PY" ]; then
    echo "Python 3 was not found. Install it from python.org and run this again."
    read -r -p "Press Return to close."; exit 1
fi

echo
echo "First-time setup: installing MeteorPrep's components into"
echo "  $PY"
echo "(this takes a few minutes; leave this window open)"
echo
# pip always runs from the home folder with the absolute path: pip
# reads its working directory before doing anything else, and on a
# privacy-guarded folder that one call is what used to kill setup
cd "$HOME" || cd /
"$PY" -m pip install --upgrade pip
if ! "$PY" -m pip install "$DIR"'[gui]'; then
    echo "Retrying as a per-user install..."
    "$PY" -m pip install --user "$DIR"'[gui]' || true
fi
cd "$DIR" || exit 1

if "$PY" -c "$NEEDS" >/dev/null 2>&1; then
    exec "$PY" -m meteorprep.gui
fi
echo
echo "Setup did not finish. Copy the messages above (or screenshot them)"
echo "and send them to Claude — that text says exactly what is missing."
read -r -p "Press Return to close."
exit 1
