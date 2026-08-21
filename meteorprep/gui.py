"""Thin PySide6 drag-and-drop wrapper (§1.4, Phase 4).

One window: a drop target, a "Prepare" button, a progress bar and four
checkboxes.  The GUI only builds a Config and calls
``meteorprep.pipeline.run`` on a worker thread — all logic lives in the
CLI-core library.  Requires the ``gui`` extra (PySide6).
"""

from __future__ import annotations

import sys
import traceback


def main() -> int:
    try:
        from PySide6.QtCore import Qt, QThread, Signal
        from PySide6.QtWidgets import (QApplication, QCheckBox, QComboBox,
                                       QFileDialog, QHBoxLayout, QLabel,
                                       QLineEdit, QMainWindow, QProgressBar,
                                       QPushButton, QVBoxLayout, QWidget)
    except ImportError:
        print("PySide6 is not installed: pip install 'meteorprep[gui]'",
              file=sys.stderr)
        return 1

    from meteorprep.config import Config
    from meteorprep.pipeline import run as run_pipeline

    class Worker(QThread):
        progressed = Signal(int, str)
        finished_ok = Signal(dict)
        failed = Signal(str)

        def __init__(self, cfg):
            super().__init__()
            self.cfg = cfg

        def run(self):
            try:
                result = run_pipeline(
                    self.cfg,
                    progress=lambda f, m: self.progressed.emit(int(f * 100), m))
                self.finished_ok.emit(result)
            except Exception:
                self.failed.emit(traceback.format_exc())

    class SelfTestWorker(QThread):
        progressed = Signal(str)
        done = Signal(bool, str)

        def run(self):
            try:
                from meteorprep.selftest import format_report, run_self_test
                result = run_self_test(progress=self.progressed.emit)
                print(format_report(result))
                self.done.emit(result["ok"], result["verdict"])
            except Exception:
                self.done.emit(False, "Self-test crashed — see console.")
                traceback.print_exc()

    STYLE = """
    QMainWindow, QWidget { background: #161a20; color: #dde3ea;
                           font-size: 13px; }
    QLabel { color: #dde3ea; }
    QCheckBox { spacing: 8px; padding: 2px 0; }
    QLineEdit, QComboBox { background: #1e242d; border: 1px solid #333a44;
                           border-radius: 6px; padding: 5px 8px; }
    QPushButton { background: #2a3340; border: 1px solid #3a4657;
                  border-radius: 8px; padding: 9px 16px; font-weight: 600; }
    QPushButton:hover { background: #33404f; }
    QPushButton:disabled { color: #667; background: #1d232b; }
    QPushButton#primary { background: #2f6fd6; border-color: #2f6fd6;
                          color: white; font-size: 15px; }
    QPushButton#primary:hover { background: #3c7de4; }
    QPushButton#primary:disabled { background: #253248; color: #778;
                                   border-color: #253248; }
    QProgressBar { background: #1e242d; border: none; border-radius: 6px;
                   height: 12px; text-align: center; color: transparent; }
    QProgressBar::chunk { background: #2f6fd6; border-radius: 6px; }
    """

    class Window(QMainWindow):
        def __init__(self):
            super().__init__()
            from PySide6.QtCore import QSettings
            from meteorprep import __version__
            self.setWindowTitle(f"METEORPREP {__version__}")
            self.setAcceptDrops(True)
            self.folder = None
            self.worker = None
            self._settings = QSettings("meteorprep", "gui")

            central = QWidget()
            layout = QVBoxLayout(central)
            layout.setSpacing(10)
            self.drop_label = QLabel(
                "Drop your meteor-photo folder here\n(or click to browse)")
            self.drop_label.setAlignment(Qt.AlignCenter)
            self.drop_label.setMinimumHeight(150)
            self._drop_css = ("border: 2px dashed #4a5666; border-radius: "
                              "12px; font-size: 15px; color: #9aa7b5;")
            self._drop_css_hot = ("border: 2px dashed #2f6fd6; border-radius:"
                                  " 12px; font-size: 15px; color: #cfe0ff;"
                                  " background: #1b2432;")
            self.drop_label.setStyleSheet(self._drop_css)
            self.drop_label.mousePressEvent = self._browse
            layout.addWidget(self.drop_label)

            pointing_row = QHBoxLayout()
            pointing_row.addWidget(QLabel("Camera faced (optional):"))
            self.compass = QComboBox()
            self.compass.addItems(["not sure", "N", "NE", "E", "SE",
                                   "S", "SW", "W", "NW"])
            pointing_row.addWidget(self.compass)
            pointing_row.addWidget(QLabel("aimed:"))
            self.elevation = QComboBox()
            self.elevation.addItems(["halfway up", "low (near horizon)",
                                     "high (near overhead)"])
            pointing_row.addWidget(self.elevation)
            layout.addLayout(pointing_row)

            site_row = QHBoxLayout()
            site_row.addWidget(QLabel("Where (lat, lon):"))
            self.site = QLineEdit()
            self.site.setPlaceholderText(
                "example: 44.3275, -72.1725  (optional — adds meteor "
                "height, distance and duration)")
            self.site.setToolTip(
                "Find yours in Apple Maps: press and hold your spot, the "
                "numbers appear on the place card. Rough is fine.\n\n"
                "Fill this in and each meteor also gets how high it "
                "burned, how far away it was and how long it lasted. "
                "Leave it empty and everything else still works — those "
                "three numbers are simply left out rather than guessed. "
                "(If your camera's GPS was on, they come from the photos "
                "and you can ignore this box.)")
            site_row.addWidget(self.site)
            layout.addLayout(site_row)

            self.cb_draft = QCheckBox(
                "Quick draft first (about half the time; a look-at-it "
                "picture, no Photoshop file)")
            self.cb_draft.setToolTip(
                "A draft searches every photo exactly as the full run "
                "does, so the meteors it finds are the real answer. What "
                "it skips is the expensive half: the picture comes out at "
                "half resolution, there is no layered Photoshop file, the "
                "second look for the very faintest meteors is left out, "
                "and on a long night the background sky is built from a "
                "few dozen photos instead of all of them. It lands in a "
                "draft/ folder of its own, and running again without this "
                "box ticked reuses everything it worked out.")
            self.cb_png = QCheckBox("Also emit PNG + Photoshop script "
                                    "(auto if the .psd fails; ~0.5 GB extra)")
            self.cb_png.setChecked(False)
            self.cb_trail = QCheckBox("Emit star-trail render")
            self.cb_sheet = QCheckBox("Emit contact sheet")
            self.cb_sheet.setChecked(True)
            self.cb_half = QCheckBox(
                "Fast mode: half-resolution result (quicker; smaller file)")
            self.cb_force = QCheckBox("Force re-run (ignore cache)")
            for cb in (self.cb_draft, self.cb_png, self.cb_trail,
                       self.cb_sheet, self.cb_half, self.cb_force):
                layout.addWidget(cb)

            self.button = QPushButton("Prepare")
            self.button.setObjectName("primary")
            self.button.setEnabled(False)
            self.button.clicked.connect(self._start)
            layout.addWidget(self.button)

            self.test_button = QPushButton(
                "Test my setup (~2 min, no photos needed)")
            self.test_button.setFlat(True)
            self.test_button.clicked.connect(self._self_test)
            layout.addWidget(self.test_button)

            self.bar = QProgressBar()
            self.status = QLabel("")
            self.status.setWordWrap(True)
            layout.addWidget(self.bar)
            layout.addWidget(self.status)

            # revealed when a run finishes
            done_row = QHBoxLayout()
            self.open_report_btn = QPushButton("Open the report")
            self.open_folder_btn = QPushButton("Show the files")
            for b in (self.open_report_btn, self.open_folder_btn):
                b.setVisible(False)
                done_row.addWidget(b)
            self.open_report_btn.clicked.connect(
                lambda: self._open_path(getattr(self, "_report_path", None)))
            self.open_folder_btn.clicked.connect(
                lambda: self._open_path(getattr(self, "_result_dir", None)))
            layout.addLayout(done_row)

            self.setCentralWidget(central)
            self.resize(480, 480)
            self._restore_settings()

            # heartbeat: if a step goes quiet, show a live elapsed timer so
            # a long stage never looks frozen
            import time as _time
            from PySide6.QtCore import QTimer
            self._time = _time
            self._last_msg = ""
            self._msg_at = _time.time()
            self._hb = QTimer(self)
            self._hb.setInterval(1000)
            self._hb.timeout.connect(self._heartbeat)

        def _heartbeat(self):
            if self.worker is None or not self.worker.isRunning():
                return
            quiet = self._time.time() - self._msg_at
            if quiet > 4 and self._last_msg:
                m, s = divmod(int(quiet), 60)
                self.status.setText(
                    f"{self._last_msg}  —  still working "
                    f"({m}m {s:02d}s in this step)")

        def _restore_settings(self):
            s = self._settings
            folder = s.value("folder", "")
            if folder:
                import os
                if os.path.isdir(folder):
                    self._set_folder(folder)
            for cb, key in ((self.cb_png, "png"), (self.cb_trail, "trail"),
                            (self.cb_sheet, "sheet"), (self.cb_half, "half"),
                            (self.cb_draft, "draft")):
                v = s.value(key)
                if v is not None:
                    cb.setChecked(v in (True, "true", "1"))
            self.site.setText(str(s.value("site", "")))
            for combo, key in ((self.compass, "compass"),
                               (self.elevation, "elevation")):
                v = str(s.value(key, ""))
                if v and combo.findText(v) >= 0:
                    combo.setCurrentText(v)

        def _save_settings(self):
            s = self._settings
            s.setValue("folder", self.folder or "")
            for cb, key in ((self.cb_png, "png"), (self.cb_trail, "trail"),
                            (self.cb_sheet, "sheet"), (self.cb_half, "half"),
                            (self.cb_draft, "draft")):
                s.setValue(key, cb.isChecked())
            s.setValue("site", self.site.text())
            s.setValue("compass", self.compass.currentText())
            s.setValue("elevation", self.elevation.currentText())

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
            self.drop_label.setStyleSheet(self._drop_css)
            for url in e.mimeData().urls():
                self._set_folder(url.toLocalFile())
                break

        def _browse(self, _event):
            folder = QFileDialog.getExistingDirectory(self, "Choose frame folder")
            if folder:
                self._set_folder(folder)

        def _set_folder(self, folder):
            self.folder = folder
            self.drop_label.setText(folder)
            # never re-arm Prepare while a run is active
            if self.worker is None or not self.worker.isRunning():
                self.button.setEnabled(True)

        def _start(self):
            import os
            elev = {"halfway up": 45.0, "low (near horizon)": 25.0,
                    "high (near overhead)": 65.0}[self.elevation.currentText()]
            compass = self.compass.currentText()
            try:
                lat, lon = (float(v) for v in self.site.text().split(","))
                site_given = True
            except ValueError:
                # blank or unparseable: harmless for the solver seed, but
                # it must not be mistaken for the real observing site
                lat, lon = 44.3275, -72.1725
                site_given = False
            cfg = Config(
                input_dir=self.folder,
                output_dir=str(self.folder) + "_meteorprep",
                emit_pngjsx=self.cb_png.isChecked(),
                emit_startrail=self.cb_trail.isChecked(),
                emit_contact_sheet=self.cb_sheet.isChecked(),
                half_size=self.cb_half.isChecked(),
                draft=self.cb_draft.isChecked(),
                force=self.cb_force.isChecked(),
                jobs=max((os.cpu_count() or 2) - 1, 1),
                cleanup_cache=True,
                site_lat=lat, site_lon=lon, site_explicit=site_given,
                pointed_compass="" if compass == "not sure" else compass,
                pointed_elevation_deg=elev,
            )
            self._save_settings()
            self._set_running(True)
            self.worker = Worker(cfg)
            self.worker.progressed.connect(self._on_progress)
            self.worker.finished_ok.connect(self._on_done)
            self.worker.failed.connect(self._on_fail)
            self._last_msg = "starting up"
            self._msg_at = self._time.time()
            self._run_t0 = self._time.time()
            self._hb.start()
            self.worker.start()

        def _set_running(self, running: bool):
            self.button.setEnabled(not running and self.folder is not None)
            self.button.setText("Working…" if running else "Prepare")
            self.test_button.setEnabled(not running)
            for wdg in (self.cb_draft, self.cb_png, self.cb_trail,
                        self.cb_sheet, self.cb_half, self.cb_force,
                        self.site, self.compass, self.elevation):
                wdg.setEnabled(not running)
            if running:
                self.open_report_btn.setVisible(False)
                self.open_folder_btn.setVisible(False)

        def _self_test(self):
            self.test_button.setEnabled(False)
            self.button.setEnabled(False)
            self.status.setWordWrap(True)
            self.tester = SelfTestWorker()
            self.tester.progressed.connect(self.status.setText)

            def finish(ok, verdict):
                self.status.setText(("✓ " if ok else "✗ ") + verdict)
                self.test_button.setEnabled(True)
                self.button.setEnabled(self.folder is not None)
            self.tester.done.connect(finish)
            self.tester.start()

        def _on_progress(self, pct, msg):
            self.bar.setValue(pct)
            # rough time remaining once the run has enough history
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
            total = sum(g["n_meteors"] for g in result["groups"])
            quality = ", ".join(g["alignment_quality"] for g in result["groups"])
            banner = "" if "degraded" not in quality else "  ⚠ ALIGNMENT DEGRADED"
            mins = (self._time.time() - getattr(self, "_run_t0",
                                                self._time.time())) / 60
            self.status.setText(
                f"Done in {mins:.0f} min: {total} meteor(s).{banner}  "
                f"Opening your results…")
            # open the run report (falls back to the folder) so the result
            # is one glance away, not a folder hunt
            try:
                from pathlib import Path as _P
                target = None
                for g in result["groups"]:
                    target = g.get("outputs", {}).get("report") or target
                if target is None and result["groups"]:
                    target = str(_P(next(iter(
                        result["groups"][0]["outputs"].values()))).parent)
                if target:
                    self._report_path = target
                    self._result_dir = str(_P(target).parent)
                    self.open_report_btn.setVisible(True)
                    self.open_folder_btn.setVisible(True)
                    self._open_path(target)
            except Exception:
                pass

        def _on_fail(self, tb):
            self._hb.stop()
            self._set_running(False)
            # show the human-readable message (last line) in the window —
            # a Finder-launched app has no console to "see"
            last = [l for l in tb.strip().splitlines() if l.strip()][-1]
            last = last.split(":", 1)[-1].strip() if ":" in last else last
            self.status.setText(last[:600])
            self.status.setWordWrap(True)
            print(tb, file=sys.stderr)

        def closeEvent(self, event):
            # keep the worker reference alive: dropping the only Python
            # reference to a live QThread lets GC destroy it mid-run
            if (self.worker is not None and self.worker.isRunning()
                    and not getattr(self, "_quit_asked", False)):
                self._quit_asked = True
                self.status.setText(
                    "Still working — quit again to stop the run.")
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
