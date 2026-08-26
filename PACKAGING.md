# Turning METEORPREP into a sellable Mac app

What ships today already works with nothing pre-installed: the buyer
unzips, double-clicks **MeteorPrep.app**, and on first launch it fetches
its own private Python into `~/Library/Application Support/MeteorPrep`
and installs its components there — no admin password, no terminal, and
uninstalling is deleting two folders.  This file is the recipe for the
step beyond that: one signed, notarized `.app` with everything inside,
the kind you put behind a Buy button.

## 1. Build the self-contained app (on a Mac)

```bash
python3 -m pip install pyinstaller
./build_mac_app.sh          # produces dist/MeteorPrep.app (~400 MB)
```

The script bundles Python, numpy/OpenCV/astropy, the RAW decoder, the
window, the star catalog and the icon into one .app.  exiftool is NOT
required — capture times come from the built-in reader — but if you drop
an `exiftool` binary into `vendor/` before building it will be bundled
and preferred.

Build on the oldest macOS you intend to support (a binary built on
macOS 15 runs on 15+; built on 12, runs on 12+).  Build once on an
Apple-Silicon Mac; Intel buyers are served fine by Rosetta, or do a
second build on an Intel machine for a universal release.

## 2. Sign and notarize (the once-a-year chores)

Without this, buyers get the "unidentified developer" scare screen.

1. Join the Apple Developer Program ($99/yr): developer.apple.com.
2. In Xcode (or developer.apple.com), create a **Developer ID
   Application** certificate; it lands in your Keychain.
3. Sign, notarize, staple:

```bash
codesign --deep --force --options runtime \
  --sign "Developer ID Application: YOUR NAME (TEAMID)" dist/MeteorPrep.app
ditto -c -k --keepParent dist/MeteorPrep.app MeteorPrep.zip
xcrun notarytool submit MeteorPrep.zip --apple-id you@example.com \
  --team-id TEAMID --password app-specific-password --wait
xcrun stapler staple dist/MeteorPrep.app
```

4. Ship it as a `.dmg` (nice) or `.zip` (fine):
   `hdiutil create -volname MeteorPrep -srcfolder dist/MeteorPrep.app \
      -ov -format UDZO MeteorPrep.dmg`

## 3. Actually selling it

- **Storefront**: Gumroad, Lemon Squeezy or Paddle — they handle
  payment, VAT/sales tax, download delivery and license keys with zero
  code.  (The Mac App Store is possible but sandboxing a tool that
  reads arbitrary folders and writes PSDs next to them is real work —
  start direct.)
- **Price signal**: comparable niche astro tools (Sequator is free on
  Windows; Starry Landscape Stacker is $40 on Mac; PixInsight ~$300)
  put a fair opening price at **$29–49** with a watermark-free trial or
  14-day refund promise.
- **A page that sells it**: one scrolling page — the hero composite,
  a 60-second screen recording of drag → button → layered PSD opening
  in Photoshop, the three checkboxes, and the receipts angle ("every
  pixel measured, nothing invented — the evidence folder proves it").
- **Trial**: simplest honest model — full app free for 3 nights of
  photos, license key removes the limit.  The key check can be an
  offline signed string; Gumroad/Lemon Squeezy generate them.
- **Support**: a single support@ address and the run_log.txt story —
  every failure message in the app already says what file to send.
- **A name to own**: "METEORPREP" describes the meteor half only; the
  app now builds night-sky composites first.  Renaming (with the .psd
  files, folder names and docs following) is a decision to make before
  the first paying customer, not after.

## 4. What is deliberately NOT here yet

- Auto-update (Sparkle framework — add once there are users to update).
- Windows build (PyInstaller works there too; exiftool bundling and the
  launcher differ; do it when a Windows buyer actually asks).
- In-app purchase of any kind.
