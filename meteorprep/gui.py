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

    class Window(QMainWindow):
        def __init__(self):
            super().__init__()
            from meteorprep import __version__
            self.setWindowTitle(f"METEORPREP {__version__}")
            self.setAcceptDrops(True)
            self.folder = None
            self.worker = None

            central = QWidget()
            layout = QVBoxLayout(central)
            self.drop_label = QLabel(
                "Drop your meteor-frame folder here\n(or click to browse)")
            self.drop_label.setAlignment(Qt.AlignCenter)
            self.drop_label.setMinimumHeight(160)
            self.drop_label.setStyleSheet(
                "border: 2px dashed #888; border-radius: 12px; font-size: 15px;")
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
            self.site.setPlaceholderText("example: 44.3275, -72.1725  (optional)")
            self.site.setToolTip(
                "Find yours in Apple Maps: press and hold your spot, the "
                "numbers appear on the place card. Rough is fine — and "
                "leaving this empty is fine too.")
            site_row.addWidget(self.site)
            layout.addLayout(site_row)

            self.cb_png = QCheckBox("Emit PNG + Photoshop script fallback")
            self.cb_png.setChecked(True)
            self.cb_trail = QCheckBox("Emit star-trail render")
            self.cb_sheet = QCheckBox("Emit contact sheet")
            self.cb_sheet.setChecked(True)
            self.cb_half = QCheckBox(
                "Fast mode: half-resolution result (quicker; smaller file)")
            self.cb_force = QCheckBox("Force re-run (ignore cache)")
            for cb in (self.cb_png, self.cb_trail, self.cb_sheet,
                       self.cb_half, self.cb_force):
                layout.addWidget(cb)

            self.button = QPushButton("Prepare")
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
            layout.addWidget(self.bar)
            layout.addWidget(self.status)
            self.setCentralWidget(central)
            self.resize(460, 420)

        def dragEnterEvent(self, e):
            if e.mimeData().hasUrls():
                e.acceptProposedAction()

        def dropEvent(self, e):
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
            self.button.setEnabled(True)

        def _start(self):
            import os
            elev = {"halfway up": 45.0, "low (near horizon)": 25.0,
                    "high (near overhead)": 65.0}[self.elevation.currentText()]
            compass = self.compass.currentText()
            try:
                lat, lon = (float(v) for v in self.site.text().split(","))
            except ValueError:
                lat, lon = 44.3275, -72.1725   # blank/invalid: harmless default
            cfg = Config(
                input_dir=self.folder,
                output_dir=str(self.folder) + "_meteorprep",
                emit_pngjsx=self.cb_png.isChecked(),
                emit_startrail=self.cb_trail.isChecked(),
                emit_contact_sheet=self.cb_sheet.isChecked(),
                half_size=self.cb_half.isChecked(),
                force=self.cb_force.isChecked(),
                jobs=max((os.cpu_count() or 2) - 1, 1),
                cleanup_cache=True,
                site_lat=lat, site_lon=lon,
                pointed_compass="" if compass == "not sure" else compass,
                pointed_elevation_deg=elev,
            )
            self.button.setEnabled(False)
            self.worker = Worker(cfg)
            self.worker.progressed.connect(self._on_progress)
            self.worker.finished_ok.connect(self._on_done)
            self.worker.failed.connect(self._on_fail)
            self.worker.start()

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
            self.status.setText(msg)

        def _on_done(self, result):
            total = sum(g["n_meteors"] for g in result["groups"])
            quality = ", ".join(g["alignment_quality"] for g in result["groups"])
            banner = "" if "degraded" not in quality else "  ⚠ ALIGNMENT DEGRADED"
            self.status.setText(f"Done: {total} meteor(s).{banner}")
            self.button.setEnabled(True)

        def _on_fail(self, tb):
            # show the human-readable message (last line) in the window —
            # a Finder-launched app has no console to "see"
            last = [l for l in tb.strip().splitlines() if l.strip()][-1]
            last = last.split(":", 1)[-1].strip() if ":" in last else last
            self.status.setText(last[:600])
            self.status.setWordWrap(True)
            print(tb, file=sys.stderr)
            self.button.setEnabled(True)

        def closeEvent(self, event):
            if self.worker is not None and self.worker.isRunning():
                self.status.setText(
                    "Still working — quit again to stop the run.")
                self.worker.requestInterruption()
                self.worker = None
                event.ignore()
                return
            event.accept()

    app = QApplication(sys.argv)
    win = Window()
    win.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
