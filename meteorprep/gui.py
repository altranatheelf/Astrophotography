"""The METEORPREP window: drop a folder, pick what you want, press go.

The GUI only builds a Config and calls ``meteorprep.pipeline.run`` on a
worker thread — all logic lives in the CLI-core library.  Requires the
``gui`` extra (PySide6).

The one rule this window is built around: a person should be able to
answer "what am I about to get, and how long will it take" without
reading anything twice.  What it replaced could not — it offered a
"Quick draft first" checkbox beside a "Fast mode: half-resolution
result" checkbox, where the first already implied the second, and the
word "preview" named both of them and an output file besides.  There is
now one list of three things you can ask for (meteorprep/modes.py), and
everything else on the window is either about your night or tucked
behind a disclosure.
"""

from __future__ import annotations

import sys
import traceback

ELEV_CHOICES = {
    "halfway up the sky": 45.0,
    "low, near the horizon": 25.0,
    "high, near overhead": 65.0,
}


def main() -> int:
    try:
        from PySide6.QtCore import Qt, QThread, Signal
        from PySide6.QtWidgets import (QApplication, QButtonGroup, QCheckBox,
                                       QComboBox, QFileDialog, QFrame,
                                       QHBoxLayout, QLabel, QLineEdit,
                                       QMainWindow, QProgressBar, QPushButton,
                                       QRadioButton, QScrollArea, QVBoxLayout,
                                       QWidget)
    except ImportError:
        print("PySide6 is not installed: pip install 'meteorprep[gui]'",
              file=sys.stderr)
        return 1

    from meteorprep import modes as M
    from meteorprep.config import Config
    from meteorprep.pipeline import run as run_pipeline

    class Cancelled(Exception):
        """Raised out of the progress callback to unwind a run."""

    class Worker(QThread):
        progressed = Signal(int, str)
        finished_ok = Signal(dict)
        failed = Signal(str)
        stopped = Signal()

        def __init__(self, cfg):
            super().__init__()
            self.cfg = cfg
            self._cancel = False

        def cancel(self):
            """Ask the run to stop at its next progress report.  The
            pipeline reports often enough that this lands within a photo
            or two, and it unwinds through run()'s own cleanup, so the
            worker pools and shared memory go away properly."""
            self._cancel = True

        def _progress(self, frac, msg):
            if self._cancel:
                raise Cancelled()
            self.progressed.emit(int(frac * 100), msg)

        def run(self):
            try:
                result = run_pipeline(self.cfg, progress=self._progress)
                self.finished_ok.emit(result)
            except Cancelled:
                self.stopped.emit()
            except Exception:
                if self._cancel:      # a stop can surface as anything
                    self.stopped.emit()
                else:
                    self.failed.emit(traceback.format_exc())

    class SelfTestWorker(QThread):
        progressed = Signal(str)
        report = Signal(str)
        done = Signal(bool, str)

        def run(self):
            # Launched from the .app there is no console, so "see the
            # lines above" pointed at nothing.  The full report goes to a
            # file the window can open.
            try:
                from meteorprep.selftest import format_report, run_self_test
                result = run_self_test(progress=self.progressed.emit)
                text = format_report(result)
                print(text)
                self.report.emit(text)
                self.done.emit(result["ok"], result["verdict"])
            except Exception:
                tb = traceback.format_exc()
                print(tb, file=sys.stderr)
                self.report.emit("The setup check itself crashed:\n\n" + tb)
                self.done.emit(False, "The setup check could not finish.")

    class CountWorker(QThread):
        """Counting photos means walking the folder, which is instant on
        an SSD and several seconds on a memory card or a network drive —
        so it does not happen on the UI thread."""
        counted = Signal(str, int)

        def __init__(self, folder):
            super().__init__()
            self.folder = folder

        def run(self):
            try:
                from pathlib import Path

                from meteorprep.config import Config as _C
                from meteorprep.ingest.exif import scan_input_dir
                n = len(scan_input_dir(Path(self.folder), _C().raw_extensions))
            except Exception:
                n = -1
            self.counted.emit(self.folder, n)

    INK = "#dde3ea"
    DIM = "#94a3b4"
    STYLE = f"""
    QMainWindow, QScrollArea, QWidget#page {{ background: #12161c; }}
    QWidget {{ color: {INK}; font-size: 13px; }}
    QLabel#h {{ font-size: 12px; font-weight: 700; color: {DIM};
                letter-spacing: 1px; }}
    QLabel#sub {{ color: {DIM}; font-size: 12px; }}
    QLabel#summary {{ color: #cfe0ff; font-size: 13px; }}
    QFrame#card {{ background: #1a2029; border: 1px solid #262f3b;
                   border-radius: 10px; }}
    QFrame#card[picked="true"] {{ border: 1px solid #2f6fd6;
                                  background: #1b2434; }}
    QCheckBox, QRadioButton {{ spacing: 9px; padding: 1px 0;
                               background: transparent; }}
    QRadioButton {{ font-size: 14px; font-weight: 600; }}
    QLineEdit, QComboBox {{ background: #1a2029; border: 1px solid #2b3542;
                            border-radius: 7px; padding: 6px 9px;
                            selection-background-color: #2f6fd6; }}
    QLineEdit:focus, QComboBox:focus {{ border-color: #2f6fd6; }}
    QPushButton {{ background: #232c38; border: 1px solid #34404f;
                   border-radius: 8px; padding: 8px 15px; }}
    QPushButton:hover {{ background: #2c3845; }}
    QPushButton:disabled {{ color: #5a6675; background: #171d24;
                            border-color: #222a34; }}
    QPushButton#primary {{ background: #2f6fd6; border-color: #2f6fd6;
                           color: white; font-size: 16px; font-weight: 700;
                           padding: 13px 18px; }}
    QPushButton#primary:hover {{ background: #3d80ea; }}
    QPushButton#primary:disabled {{ background: #202b3c; color: #66738a;
                                    border-color: #202b3c; }}
    QPushButton#link {{ background: transparent; border: none; color: {DIM};
                        text-align: left; padding: 4px 0; }}
    QPushButton#link:hover {{ color: {INK}; }}
    QProgressBar {{ background: #1a2029; border: none; border-radius: 5px;
                    height: 10px; text-align: center; color: transparent; }}
    QProgressBar::chunk {{ background: #2f6fd6; border-radius: 5px; }}
    """

    def _heading(text):
        lab = QLabel(text.upper())
        lab.setObjectName("h")
        return lab

    def _sub(text):
        lab = QLabel(text)
        lab.setObjectName("sub")
        lab.setWordWrap(True)
        return lab

    class Disclosure(QWidget):
        """A labelled toggle with a body that starts hidden.  Everything
        a photographer does not need on a normal night lives in one of
        these, so the window opens short."""

        def __init__(self, label, parent=None):
            super().__init__(parent)
            lay = QVBoxLayout(self)
            lay.setContentsMargins(0, 0, 0, 0)
            lay.setSpacing(4)
            self._label = label
            self.head = QPushButton("▸  " + label)
            self.head.setObjectName("link")
            self.head.setCheckable(True)
            self.head.clicked.connect(self._toggle)
            lay.addWidget(self.head)
            self.body = QWidget()
            self.body_layout = QVBoxLayout(self.body)
            self.body_layout.setContentsMargins(16, 2, 0, 6)
            self.body_layout.setSpacing(8)
            self.body.setVisible(False)
            lay.addWidget(self.body)

        def _toggle(self, on):
            self.body.setVisible(on)
            self.head.setText(("▾  " if on else "▸  ") + self._label)

        def add(self, widget):
            self.body_layout.addWidget(widget)

        def add_layout(self, layout):
            self.body_layout.addLayout(layout)

    class ModeCard(QFrame):
        """One of the three things you can ask for: a title, a line about
        what you get, and — once a folder is chosen — how long it takes."""

        def __init__(self, mode, group, on_pick):
            super().__init__()
            self.setObjectName("card")
            self.mode = mode
            lay = QVBoxLayout(self)
            lay.setContentsMargins(13, 10, 13, 11)
            lay.setSpacing(2)
            self.radio = QRadioButton(mode.title)
            self.radio.setToolTip(mode.detail)
            group.addButton(self.radio)
            self.radio.toggled.connect(lambda on: on and on_pick())
            lay.addWidget(self.radio)
            self.blurb = _sub(mode.blurb)
            self.blurb.setContentsMargins(25, 0, 0, 0)
            self.blurb.setToolTip(mode.detail)
            lay.addWidget(self.blurb)

        def mousePressEvent(self, _e):
            self.radio.setChecked(True)

        def set_estimate(self, text):
            self.blurb.setText(self.mode.blurb + (f"   ·   {text}"
                                                  if text else ""))

        def set_picked(self, picked):
            self.setProperty("picked", "true" if picked else "false")
            self.style().unpolish(self)
            self.style().polish(self)

    class Window(QMainWindow):
        def __init__(self):
            super().__init__()
            from PySide6.QtCore import QSettings

            from meteorprep import __version__
            self.setWindowTitle(f"METEORPREP {__version__}")
            self.setAcceptDrops(True)
            self.folder = None
            self.worker = None
            self._counters = []
            self.n_photos = 0
            self._settings = QSettings("meteorprep", "gui")

            page = QWidget()
            page.setObjectName("page")
            layout = QVBoxLayout(page)
            layout.setContentsMargins(20, 18, 20, 18)
            layout.setSpacing(9)

            # ---- 1. the folder --------------------------------------
            self.drop_label = QLabel(
                "Drop the folder of photos here\n(or click to choose one)")
            self.drop_label.setAlignment(Qt.AlignCenter)
            self.drop_label.setMinimumHeight(120)
            self.drop_label.setWordWrap(True)
            self._drop_css = ("border: 2px dashed #34404f; border-radius: "
                              "12px; font-size: 15px; color: #8b97a7;")
            self._drop_css_hot = ("border: 2px dashed #2f6fd6; border-radius:"
                                  " 12px; font-size: 15px; color: #cfe0ff;"
                                  " background: #182233;")
            self.drop_label.setStyleSheet(self._drop_css)
            self.drop_label.mousePressEvent = self._browse
            layout.addWidget(self.drop_label)

            self.summary = QLabel("")
            self.summary.setObjectName("summary")
            self.summary.setWordWrap(True)
            self.summary.setVisible(False)
            layout.addWidget(self.summary)

            # ---- 2. what you want -----------------------------------
            layout.addSpacing(4)
            layout.addWidget(_heading("What do you want?"))
            self.mode_group = QButtonGroup(self)
            self.cards = {}
            for mode in M.MODES:
                card = ModeCard(mode, self.mode_group, self._mode_changed)
                self.cards[mode.key] = card
                layout.addWidget(card)

            # ---- 3. extras ------------------------------------------
            layout.addSpacing(6)
            self.extras = Disclosure("Also make… (optional)")
            self.cb_trail = QCheckBox("Star-trail photo")
            self.cb_trail.setToolTip(
                "The classic one: every frame's brightest pixel kept, so "
                "the stars draw circles around the pole. Built from the "
                "photos you already have, at no extra reading cost.")
            self.cb_sheet = QCheckBox(
                "Contact sheet — one thumbnail of everything it found")
            self.cb_sheet.setChecked(True)
            self.cb_sheet.setToolTip(
                "A single image with every candidate on it, labelled "
                "meteor or plane or satellite. The quickest way to check "
                "its work.")
            self.cb_png = QCheckBox(
                "Photoshop rescue script (only if the .psd won't open)")
            self.cb_png.setToolTip(
                "Writes every layer as a PNG plus a script that rebuilds "
                "the document inside Photoshop. It is a fallback for a "
                "Photoshop that refuses the .psd, and it adds about half "
                "a gigabyte. Normally leave this off — if the .psd fails "
                "to write, this is produced automatically anyway.")
            for cb in (self.cb_trail, self.cb_sheet, self.cb_png):
                self.extras.add(cb)
            layout.addWidget(self.extras)

            # ---- 4. about your night --------------------------------
            self.night = Disclosure("About your night (optional)")
            self.night.add(_sub(
                "Everything here is optional. Skip it and the run still "
                "works — these only help the star lock start closer, and "
                "unlock the height/distance estimates."))
            point_row = QHBoxLayout()
            point_row.addWidget(QLabel("The camera faced"))
            self.compass = QComboBox()
            self.compass.addItems(["not sure", "N", "NE", "E", "SE",
                                   "S", "SW", "W", "NW"])
            point_row.addWidget(self.compass)
            point_row.addWidget(QLabel("and was aimed"))
            self.elevation = QComboBox()
            self.elevation.addItems(list(ELEV_CHOICES))
            point_row.addWidget(self.elevation)
            point_row.addStretch(1)
            self.night.add_layout(point_row)
            site_row = QHBoxLayout()
            site_row.addWidget(QLabel("You were at"))
            self.site = QLineEdit()
            self.site.setPlaceholderText("44.3275, -72.1725")
            self.site.setToolTip(
                "Find yours in Apple Maps: press and hold your spot and "
                "the numbers appear on the place card. Rough is fine.\n\n"
                "Fill this in and each meteor also gets how high it "
                "burned, how far away it was and how long it lasted. "
                "Leave it empty and everything else still works — those "
                "three numbers are left out rather than guessed. If your "
                "camera's GPS was on they come from the photos and you "
                "can ignore this.")
            site_row.addWidget(self.site)
            self.night.add_layout(site_row)
            self.night.add(_sub(
                "latitude, longitude — adds how high each meteor burned, "
                "how far away it was and how long it lasted"))
            layout.addWidget(self.night)

            # ---- 5. advanced ----------------------------------------
            self.advanced = Disclosure("Advanced")
            self.cb_force = QCheckBox(
                "Start over — ignore everything the last run worked out")
            self.cb_force.setToolTip(
                "Normally a second run on the same folder reuses the "
                "scan, the star lock and the meteor search, which is most "
                "of the time. Tick this to redo all of it from the "
                "photos — worth doing if you have changed the folder's "
                "contents, or if a run looks wrong and you want a clean "
                "one.")
            self.advanced.add(self.cb_force)
            layout.addWidget(self.advanced)

            # ---- 6. go ----------------------------------------------
            layout.addSpacing(8)
            self.button = QPushButton("Find my meteors")
            self.button.setObjectName("primary")
            self.button.setEnabled(False)
            self.button.clicked.connect(self._primary_clicked)
            layout.addWidget(self.button)

            self.bar = QProgressBar()
            self.bar.setVisible(False)
            layout.addWidget(self.bar)
            self.status = QLabel("")
            self.status.setWordWrap(True)
            self.status.setObjectName("sub")
            layout.addWidget(self.status)

            done_row = QHBoxLayout()
            self.open_report_btn = QPushButton("Open the report")
            self.open_folder_btn = QPushButton("Show the files")
            for b in (self.open_report_btn, self.open_folder_btn):
                b.setVisible(False)
                done_row.addWidget(b)
            done_row.addStretch(1)
            self.open_report_btn.clicked.connect(
                lambda: self._open_path(getattr(self, "_report_path", None)))
            self.open_folder_btn.clicked.connect(
                lambda: self._open_path(getattr(self, "_result_dir", None)))
            layout.addLayout(done_row)

            layout.addStretch(1)
            sep = QFrame()
            sep.setFrameShape(QFrame.HLine)
            sep.setStyleSheet("color: #232c38;")
            layout.addWidget(sep)
            self.test_button = QPushButton(
                "Check this Mac can run it  (~2 min, no photos needed)")
            self.test_button.setObjectName("link")
            self.test_button.clicked.connect(self._self_test)
            layout.addWidget(self.test_button)

            scroll = QScrollArea()
            scroll.setWidget(page)
            scroll.setWidgetResizable(True)
            scroll.setFrameShape(QFrame.NoFrame)
            self.setCentralWidget(scroll)
            self.resize(560, 760)
            self.setMinimumWidth(480)
            self._restore_settings()
            self._mode_changed()

            import time as _time
            from PySide6.QtCore import QTimer
            self._time = _time
            self._last_msg = ""
            self._msg_at = _time.time()
            self._hb = QTimer(self)
            self._hb.setInterval(1000)
            self._hb.timeout.connect(self._heartbeat)

        # ---------------- mode + folder ---------------------------------

        def _mode_key(self):
            for key, card in self.cards.items():
                if card.radio.isChecked():
                    return key
            return M.DEFAULT

        def _mode_changed(self):
            key = self._mode_key()
            for k, card in self.cards.items():
                card.set_picked(k == key)
                measured = self._settings.value(f"rate_{k}")
                try:
                    measured = float(measured) if measured else None
                except (TypeError, ValueError):
                    measured = None
                card.set_estimate(M.estimate(k, self.n_photos, measured))

        def _set_folder(self, folder):
            import os
            if not folder or not os.path.isdir(folder):
                return
            # Normalise once, here.  A path from a drag-and-drop can
            # arrive with a trailing separator, and "/photos/" +
            # "_meteorprep" is /photos/_meteorprep — the results written
            # INSIDE the photo folder, where the next run would scan them.
            folder = os.path.abspath(folder)
            self.folder = folder
            self.drop_label.setText(os.path.basename(folder) or folder)
            self.summary.setText("counting the photos…")
            self.summary.setVisible(True)
            self.n_photos = 0
            self._mode_changed()
            # stays off until the count comes back: pressing go on a
            # folder with no photos in it only produces an error
            self.button.setEnabled(False)
            # a folder on a memory card can take seconds to walk, and
            # dropping a second folder meanwhile must not drop the only
            # reference to a running QThread — that is how a live thread
            # gets garbage-collected out from under itself
            counter = CountWorker(folder)
            self._counters.append(counter)
            counter.counted.connect(self._on_counted)
            counter.finished.connect(
                lambda c=counter: self._counters.remove(c)
                if c in self._counters else None)
            counter.start()

        def _on_counted(self, folder, n):
            if folder != self.folder:
                return                      # a newer folder won the race
            self.n_photos = max(n, 0)
            if n < 0:
                self.summary.setText("could not read that folder")
            elif n == 0:
                self.summary.setText(
                    "No photos in there. This wants the folder holding "
                    "your RAW files (.CR2, .CR3, .NEF, .ARW, .DNG…) — "
                    "subfolders are fine.")
            else:
                self.summary.setText(
                    f"{n} photo{'s' if n != 1 else ''} · results go to "
                    f"{self._out_name()}")
            if self.worker is None or not self.worker.isRunning():
                self.button.setEnabled(n > 0)
            self._mode_changed()

        def _out_dir(self):
            """The one place the results folder is decided."""
            import os
            return os.path.abspath(str(self.folder)) + "_meteorprep"

        def _out_name(self):
            import os
            return os.path.basename(self._out_dir())

        # ---------------- settings --------------------------------------

        _CBS = (("trail", "cb_trail"), ("sheet", "cb_sheet"),
                ("png", "cb_png"), ("force", "cb_force"))

        def _restore_settings(self):
            s = self._settings
            key = str(s.value("mode", M.DEFAULT))
            self.cards.get(key, self.cards[M.DEFAULT]).radio.setChecked(True)
            for name, attr in self._CBS:
                v = s.value(name)
                if v is not None:
                    getattr(self, attr).setChecked(v in (True, "true", "1"))
            self.site.setText(str(s.value("site", "")))
            for combo, name in ((self.compass, "compass"),
                                (self.elevation, "elevation")):
                v = str(s.value(name, ""))
                if v and combo.findText(v) >= 0:
                    combo.setCurrentText(v)
            if str(s.value("site", "")) or str(s.value("compass", "")):
                self.night.head.setChecked(True)
                self.night._toggle(True)
            folder = s.value("folder", "")
            if folder:
                self._set_folder(str(folder))

        def _save_settings(self):
            s = self._settings
            s.setValue("folder", self.folder or "")
            s.setValue("mode", self._mode_key())
            for name, attr in self._CBS:
                s.setValue(name, getattr(self, attr).isChecked())
            s.setValue("site", self.site.text())
            s.setValue("compass", self.compass.currentText())
            s.setValue("elevation", self.elevation.currentText())

        # ---------------- housekeeping ----------------------------------

        def _open_path(self, target):
            if not target:
                return
            try:
                import subprocess
                if sys.platform == "darwin":
                    subprocess.Popen(["open", str(target)])
                elif sys.platform.startswith("linux"):
                    subprocess.Popen(["xdg-open", str(target)])
                else:
                    import os
                    os.startfile(str(target))  # type: ignore[attr-defined]
            except Exception:
                pass

        def dragEnterEvent(self, e):
            if e.mimeData().hasUrls():
                self.drop_label.setStyleSheet(self._drop_css_hot)
                e.acceptProposedAction()

        def dragLeaveEvent(self, e):
            self.drop_label.setStyleSheet(self._drop_css)

        def dropEvent(self, e):
            import os
            self.drop_label.setStyleSheet(self._drop_css)
            e.acceptProposedAction()
            for url in e.mimeData().urls():
                path = url.toLocalFile()
                if os.path.isdir(path):
                    self._set_folder(path)
                elif os.path.isfile(path):
                    # dropping one of the photos is an easy mistake and
                    # the answer is obvious: use the folder it is in
                    self._set_folder(os.path.dirname(path))
                else:
                    self.summary.setText(
                        "That is not a folder I can read — drop the "
                        "folder your photos are in.")
                    self.summary.setVisible(True)
                break

        def _browse(self, _event):
            folder = QFileDialog.getExistingDirectory(
                self, "Choose the folder of photos")
            if folder:
                self._set_folder(folder)

        # ---------------- the run ---------------------------------------

        def _primary_clicked(self):
            """One big button, two jobs.  While a run is going it says
            Stop, because the only way to change your mind used to be
            closing the window twice — an affordance nobody finds."""
            if self.worker is not None and self.worker.isRunning():
                self._stop()
            else:
                self._start()

        def _stop(self):
            if self.worker is None or not self.worker.isRunning():
                return
            self.button.setEnabled(False)
            self.button.setText("Stopping…")
            self.status.setText(
                "Stopping — finishing the photo it is on. Everything "
                "worked out so far is kept.")
            self.worker.cancel()

        def _start(self):
            import os
            # Replacing self.worker while the old one runs drops the only
            # Python reference to a live QThread, and Qt aborts the whole
            # app when that gets collected.  Every path that can re-arm
            # this button is guarded, but the guard belongs here too.
            if self.worker is not None and self.worker.isRunning():
                return
            if getattr(self, "tester", None) is not None \
                    and self.tester.isRunning():
                self.status.setText(
                    "Finishing the setup check first — try again in a "
                    "moment.")
                return
            elev = ELEV_CHOICES.get(self.elevation.currentText(), 45.0)
            compass = self.compass.currentText()
            try:
                lat, lon = (float(v) for v in self.site.text().split(","))
                site_given = True
            except ValueError:
                # blank or unparseable: harmless for the solver seed, but
                # it must not be mistaken for the real observing site
                lat, lon = 44.3275, -72.1725
                site_given = False
            mode = self._mode_key()
            cfg = Config(
                input_dir=self.folder,
                output_dir=self._out_dir(),
                emit_pngjsx=self.cb_png.isChecked(),
                emit_startrail=self.cb_trail.isChecked(),
                emit_contact_sheet=self.cb_sheet.isChecked(),
                force=self.cb_force.isChecked(),
                jobs=max((os.cpu_count() or 2) - 1, 1),
                cleanup_cache=True,
                site_lat=lat, site_lon=lon, site_explicit=site_given,
                pointed_compass="" if compass == "not sure" else compass,
                pointed_elevation_deg=elev,
                **M.config_kwargs(mode),
            )
            self._run_mode = mode
            self.open_report_btn.setText("Open the report")
            self._save_settings()
            self._set_running(True)
            self.worker = Worker(cfg)
            self.worker.progressed.connect(self._on_progress)
            self.worker.finished_ok.connect(self._on_done)
            self.worker.failed.connect(self._on_fail)
            self.worker.stopped.connect(self._on_stopped)
            self._last_msg = "starting up"
            self._msg_at = self._time.time()
            self._run_t0 = self._time.time()
            self._hb.start()
            self.worker.start()

        def _set_running(self, running):
            if running:
                self.button.setEnabled(True)
                self.button.setText("Stop")
            else:
                self.button.setEnabled(bool(self.folder)
                                       and self.n_photos > 0)
                self.button.setText("Find my meteors")
            self.test_button.setEnabled(not running)
            self.bar.setVisible(running)
            for wdg in (self.cb_trail, self.cb_sheet, self.cb_png,
                        self.cb_force, self.site, self.compass,
                        self.elevation, self.drop_label):
                wdg.setEnabled(not running)
            for card in self.cards.values():
                card.setEnabled(not running)
            if running:
                self.open_report_btn.setVisible(False)
                self.open_folder_btn.setVisible(False)

        def _heartbeat(self):
            if self.worker is None or not self.worker.isRunning():
                return
            quiet = self._time.time() - self._msg_at
            if quiet > 4 and self._last_msg:
                m, s = divmod(int(quiet), 60)
                self.status.setText(
                    f"{self._last_msg}  —  still working "
                    f"({m}m {s:02d}s in this step)")

        def _self_test(self):
            if self.worker is not None and self.worker.isRunning():
                return
            self.test_button.setEnabled(False)
            self.button.setEnabled(False)
            self.status.setText("checking…")
            self.tester = SelfTestWorker()
            self.tester.report.connect(self._keep_selftest_report)
            self.tester.progressed.connect(self.status.setText)

            def finish(ok, verdict):
                self._show_selftest(ok, verdict)
                running = (self.worker is not None
                           and self.worker.isRunning())
                self.test_button.setEnabled(not running)
                self.button.setEnabled(not running and bool(self.folder)
                                       and self.n_photos > 0)
            self.tester.done.connect(finish)
            self.tester.start()

        def _on_progress(self, pct, msg):
            self.bar.setValue(pct)
            t0 = getattr(self, "_run_t0", None)
            if t0 is not None and 8 <= pct < 100:
                left = (self._time.time() - t0) * (100 - pct) / pct
                m = int(left // 60)
                eta = (f"   (~{m + 1} min left)" if m >= 1
                       else "   (under a minute left)")
                msg = msg + eta
            self.status.setText(msg)
            self._last_msg = msg
            self._msg_at = self._time.time()

        def _on_done(self, result):
            self._hb.stop()
            self._set_running(False)
            self.bar.setValue(100)
            self.bar.setVisible(True)
            groups = result.get("groups", [])
            meteors = sum(g["n_meteors"] for g in groups)
            flagged = sum(g.get("n_flagged", 0) for g in groups)
            quality = ", ".join(g["alignment_quality"] for g in groups)
            secs = self._time.time() - getattr(self, "_run_t0",
                                               self._time.time())
            # remember this machine's own pace, so the next estimate is
            # its number rather than a guess from someone else's laptop
            mode = getattr(self, "_run_mode", M.DEFAULT)
            if self.n_photos > 0 and secs > 5:
                rate = max(secs - M.by_key(mode).overhead_s, 1.0) \
                    / self.n_photos
                self._settings.setValue(f"rate_{mode}", rate)
                self._mode_changed()
            mins = secs / 60.0
            when = (f"{secs:.0f} seconds" if secs < 90
                    else f"{mins:.0f} minutes")
            bits = [f"Found {meteors} meteor{'' if meteors == 1 else 's'}"]
            if flagged:
                bits.append(f"{flagged} plane/satellite trail"
                            f"{'' if flagged == 1 else 's'} flagged")
            line = " · ".join(bits) + f" · {when}."
            if "degraded" in quality:
                line += ("  ⚠ The star lock was shaky on this night, so "
                         "the layers may not line up perfectly — the "
                         "report says what happened.")
            self.status.setText(line + "  Opening the report…")
            try:
                from pathlib import Path as _P
                target = None
                for g in groups:
                    target = g.get("outputs", {}).get("report") or target
                if target is None and groups:
                    target = str(_P(next(iter(
                        groups[0]["outputs"].values()))).parent)
                if target:
                    self._report_path = target
                    self._result_dir = str(_P(target).parent)
                    self.open_report_btn.setVisible(True)
                    self.open_folder_btn.setVisible(True)
                    self._open_path(target)
            except Exception:
                pass

        def _keep_selftest_report(self, text):
            """Park the setup-check report where a person can open it —
            under the .app there is no console for it to go to."""
            from pathlib import Path as _P
            for folder in (_P.home() / "Desktop", _P.home(), _P(".")):
                try:
                    if not folder.is_dir():
                        continue
                    dest = folder / "MeteorPrep setup check.txt"
                    dest.write_text(text, encoding="utf-8")
                    self._selftest_report = str(dest)
                    return
                except OSError:
                    continue

        def _show_selftest(self, ok, verdict):
            self.status.setText(("✓ " if ok else "✗ ") + verdict)
            path = getattr(self, "_selftest_report", None)
            if path:
                self.status.setText(
                    self.status.text()
                    + f"\n\nThe details are in {path} — send that file if "
                      "anything is missing.")
                self._report_path = path
                self.open_report_btn.setText("Open the setup check")
                self.open_report_btn.setVisible(True)

        def _on_stopped(self):
            self._hb.stop()
            self._set_running(False)
            self.bar.setVisible(False)
            self.status.setText(
                "Stopped. What it had already worked out is kept — run "
                "the same folder again and it picks up from there.")

        def _on_fail(self, tb):
            self._hb.stop()
            self._set_running(False)
            self.bar.setVisible(False)
            # The messages this program raises are written for a person
            # and several of them are a paragraph long — "your disk is
            # full, here is what to do".  Keeping only the last line of
            # the traceback threw the explanation away and then stripped
            # the label off what was left.
            lines = [ln for ln in tb.strip().splitlines() if ln.strip()]
            msg = ""
            for k, ln in enumerate(lines):
                if ln.startswith(("Traceback", "  ", "\t")):
                    continue
                msg = "\n".join(lines[k:]).strip()
                break
            if ":" in msg.split("\n")[0]:
                head, rest = msg.split(":", 1)
                if head.replace(".", "").replace("_", "").isalnum():
                    msg = rest.strip()      # drop only the exception name
            self.status.setText(
                (msg[:1200] or "The run stopped early.")
                + "\n\nThe full diary is in run_log.txt inside the results "
                  "folder — that is the file to send if this looks wrong.")
            print(tb, file=sys.stderr)

        def closeEvent(self, event):
            for c in list(self._counters):
                c.wait(2000)
            if self.worker is not None and self.worker.isRunning():
                if not getattr(self, "_quit_asked", False):
                    self._quit_asked = True
                    self.status.setText(
                        "Still working — press Stop, or close this window "
                        "again, to end the run. Whatever it has finished "
                        "is kept, and running the folder again picks up "
                        "from there.")
                    event.ignore()
                    return
                # Second ask: stop for real.  Letting the window close
                # with a live QThread is not "cancel" — Qt aborts the
                # process when the thread object is collected, which
                # looks to a person like the app crashed on the way out.
                # The pipeline checks the flag on its next progress
                # report and unwinds through its own cleanup.
                self.status.setText("Stopping…")
                self.worker.cancel()
                if not self.worker.wait(15000):
                    self.status.setText(
                        "The current step will not stop cleanly; leave "
                        "the window open until it finishes.")
                    self._quit_asked = False
                    event.ignore()
                    return
            event.accept()

    app = QApplication.instance() or QApplication(sys.argv)
    app.setStyleSheet(STYLE)
    win = Window()
    win.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
