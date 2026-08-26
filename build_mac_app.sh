#!/bin/bash
# Build the self-contained MeteorPrep.app with PyInstaller (run on macOS).
set -euo pipefail
cd "$(dirname "$0")"

python3 -m PyInstaller --noconfirm --clean --windowed \
  --name MeteorPrep \
  --icon MeteorPrep.app/Contents/Resources/MeteorPrep.icns \
  --collect-data meteorprep \
  --collect-submodules meteorprep \
  --hidden-import rawpy --hidden-import tifffile \
  --collect-data astropy \
  $( [ -x vendor/exiftool ] && echo "--add-binary vendor/exiftool:." ) \
  --osx-bundle-identifier com.meteorprep.app \
  packaging_entry.py

echo
echo "Built dist/MeteorPrep.app — next: sign + notarize (see PACKAGING.md)"
